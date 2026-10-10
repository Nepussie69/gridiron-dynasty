// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B7): the live view — settings resolution, the session
// top-down fallback, and (from an async factory) the composed 2.5D view:
// BroadcastRenderer + ActorLayer + GraphicsLayer + the B5a camera director,
// with the B7 quality profile, frame pacer and Auto detector applied at the
// single draw call site. B8 only has to mount this in MatchView.
//
// Nothing here touches the sim, rng or saves: it reads the recorded PlayAnim /
// Play, and view settings live in localStorage (viewSettings.ts).
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useSyncExternalStore } from 'react'
import type { Play } from '../../game/engine/playsim'
import type { Player } from '../../game/types'
import { NFL_TEAMS } from '../../game/data/nflTeams'
import { FIELD_WIDTH, MID_WIDTH, offenseToWorld, offenseXToWorld, type CameraPose, type Direction } from './camera.ts'
import type { BroadcastAnim } from './animData'
import type { PlayAnim } from '../playAnim'
import { posAt, snapYard } from '../playAnim'
import { effectiveQuality, QUALITY, AUTO_TOO_SLOW_P95, AutoQuality, FramePacer, type AutoQualityState, type QualityLevel } from './quality.ts'
import { CAMERA_PROFILES, createProfileApplier, type ProfileCtx } from './phoneCamera.ts'
import { BroadcastRenderer, FrameWindow, type BroadcastFrame, type FrameStats, type LayerHook } from './renderer'
import { ActorLayer, type ActorPlay } from './actors'
import { GraphicsLayer, readGfxTokens } from './graphicsDraw'
import { buildGraphicsTimeline, type GraphicsTimeline, type PersonInfo } from './graphics'
import { createDirector, type Director, type DirectorProfile } from './director'
import { useViewSettings, usePhone, deviceKey, type ViewSettings, type AutoQState, type QualitySetting } from './viewSettings'

// ── B4 hook: the real ball + effects (merged into main after this branch) ────
//
// B4 owns ball.ts / ballFx.ts / fxDraw.ts / fxSchedule.ts / ballDraw.ts; their
// API is documented in ~/gridiron-work/logs/b4-verify.out:
//   createBallFx({anim, offenseClub, defenseClub, reducedMotion, quality})
//     -> { ground, air, items, shakePose, attach }
//   withBallFx(layer, fx, getT) -> LayerHook   (attaches fx to B3's layer)
// This worktree branched before main merged B4, so the import is deferred and
// typed structurally; after the orchestrator merges main it resolves to the real
// module and live games get the recorded ball arc and the effect beats.
// TODO(B4-merge): replace loadBallFx() with a static
//   `import { createBallFx, withBallFx } from './ballFx'` once main is the base.
interface BallFxLike {
  shakePose(pose: CameraPose, t: number): CameraPose
}
interface BallFxModule {
  createBallFx(o: {
    anim: BroadcastAnim
    offenseClub: unknown
    defenseClub: unknown
    reducedMotion?: boolean
    quality?: QualityLevel
    thrower?: { thp?: number; tha?: number }
    pressured?: boolean
  }): BallFxLike
  withBallFx(layer: ActorLayer, fx: BallFxLike, getT: () => number): LayerHook
}

async function loadBallFx(): Promise<BallFxModule | null> {
  try {
    // Vite rewrites import.meta.glob() at build time; the node loader leaves it
    // undefined, so this function simply yields null there (it is only called
    // once the live view mounts).
    const glob = (import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<unknown>> }).glob
    if (typeof glob !== 'function') return null
    const mods = glob('./ballFx.ts')
    const importer = mods['./ballFx.ts']
    if (!importer) return null
    return (await importer()) as BallFxModule
  } catch {
    return null
  }
}

// ── resolution ───────────────────────────────────────────────────────────────

export type Fallback = null | 'no-canvas' | 'render-error' | 'too-slow'

export interface LiveViewState {
  /** The live (in-play) view. */
  live: 'broadcast' | 'topdown'
  /** Whether replays use the 2.5D view. */
  replayView: 'broadcast' | 'off'
  replayPolicy: 'big' | 'all' | 'off'
  quality: QualityLevel
  qualitySource: 'auto' | 'user'
  cameraProfile: 'main' | 'phone'
  fallback: Fallback
}

/**
 * Defaults by device:
 *   auto       → 2.5D live on ≥ 768 px; top-down live on phones (2.5D replays)
 *   broadcast  → 2.5D live everywhere (phone lens on a phone)
 *   topdown    → top-down live everywhere; 2.5D replays follow the Replays setting
 * A session fallback always forces the live view top-down.
 */
export function resolveLiveView(settings: ViewSettings, phone: boolean, quality: QualityLevel, fallback: Fallback): LiveViewState {
  const explicit = settings.game
  let live: 'broadcast' | 'topdown'
  if (explicit === 'broadcast') live = 'broadcast'
  else if (explicit === 'topdown') live = 'topdown'
  else live = phone ? 'topdown' : 'broadcast'
  if (fallback) live = 'topdown'
  return {
    live,
    replayView: settings.replays === 'off' ? 'off' : 'broadcast',
    replayPolicy: settings.replays,
    quality,
    qualitySource: settings.quality === 'auto' ? 'auto' : 'user',
    cameraProfile: phone ? 'phone' : 'main',
    fallback,
  }
}

// ── session fallback store (never persisted) ────────────────────────────────

let fallbackState: Fallback = null
const fbListeners = new Set<() => void>()

export function getFallback(): Fallback {
  return fallbackState
}

export function subscribeFallback(cb: () => void): () => void {
  fbListeners.add(cb)
  return () => {
    fbListeners.delete(cb)
  }
}

/** Report a fallback; the first one wins for the session (shown once, quietly). */
export function reportFallback(f: Exclude<Fallback, null>): void {
  if (fallbackState) return
  fallbackState = f
  for (const l of fbListeners) l()
}

export function clearFallback(): void {
  if (fallbackState == null) return
  fallbackState = null
  for (const l of fbListeners) l()
}

/** The reactive resolution for a live game view. */
export function useLiveView(): LiveViewState {
  const settings = useViewSettings()
  const phone = usePhone()
  const fallback = useSyncExternalStore(subscribeFallback, getFallback, () => null as Fallback)
  const quality = effectiveQuality(settings.quality, settings.autoQ)
  return useMemo(() => resolveLiveView(settings, phone, quality, fallback), [settings, phone, quality, fallback])
}

/**
 * Latch the resolved live view to a play key so a width / setting change never
 * swaps the view mid-play: the new resolution takes effect at the next play
 * boundary. A fallback always switches to top-down at once. Render-safe (no
 * React state): the caller re-computes it on each render and the value only
 * moves when `key` changes.
 */
let latchedKey = ''
let latchedLive: 'broadcast' | 'topdown' = 'broadcast'
export function latchLiveView(key: string, resolved: 'broadcast' | 'topdown', fallback: boolean): 'broadcast' | 'topdown' {
  if (fallback) {
    latchedKey = key
    latchedLive = 'topdown'
    return 'topdown'
  }
  if (key !== latchedKey) {
    latchedKey = key
    latchedLive = resolved
  }
  return latchedLive
}

// ── building one live play (pure; MatchView supplies its own anim/maps) ──────

const ORD = (n: number) => (n === 1 ? '1ST' : n === 2 ? '2ND' : n === 3 ? '3RD' : `${n}TH`)

export interface LivePlay {
  play: Play
  anim: BroadcastAnim
  actorPlay: ActorPlay
  tl: GraphicsTimeline | null
  dir: Direction
  los: number | null
  firstDown: number | null
  turfText: string | null
  possession: 'home' | 'away'
  /** Strong-side aim point in world y (for the phone lens). */
  strongSideY: number
}

export interface LivePlayInput {
  play: Play
  anim: PlayAnim
  homeId: string
  awayId: string
  actors: Map<string, Player>
  numbers: Map<string, number>
}

/** Strong side: the B1 camera hint, else the side with more eligible receivers. */
function strongSideWorldY(anim: BroadcastAnim, dir: Direction): number {
  const hint = anim.camera
  let sign: 1 | -1
  if (hint?.strongSide === 'high') sign = 1
  else if (hint?.strongSide === 'low') sign = -1
  else {
    let low = 0
    let high = 0
    for (const a of anim.actors) {
      if (a.side !== 'off') continue
      if (a.role !== 'WR' && a.role !== 'TE' && a.role !== 'RB' && a.role !== 'FB' && a.role !== 'SLOT') continue
      const y = posAt(a.path, 0).y
      if (y >= 22 && y <= 31.3) continue
      if (y < MID_WIDTH) low++
      else high++
    }
    sign = high >= low ? 1 : -1
  }
  const offenseY = Math.max(2, Math.min(FIELD_WIDTH - 2, MID_WIDTH + sign * 5.85))
  return dir === 1 ? offenseY : FIELD_WIDTH - offenseY
}

/** Everything the 2.5D view needs for one recorded play (presentation only). */
export function buildLivePlay(input: LivePlayInput): LivePlay {
  const { play, homeId, awayId } = input
  const anim = input.anim as BroadcastAnim
  const offId = play.offId
  const defId = offId === homeId ? awayId : homeId
  const offHome = offId === homeId
  const club = (id: string) => NFL_TEAMS.find((t) => t.id === id) ?? NFL_TEAMS[0]
  const nums: Record<string, number> = {}
  const people: Record<string, PersonInfo> = {}
  for (const a of anim.actors) {
    const p = input.actors.get(a.key)
    if (!p) continue
    const n = input.numbers.get(p.id)
    if (n != null) nums[a.key] = n
    people[a.key] = { name: p.name, pos: p.pos, number: n }
  }
  const tl = buildGraphicsTimeline({ anim, play, offense: club(offId), defense: club(defId), people })
  const dir: Direction = offHome ? 1 : -1
  const scrimmage = play.type === 'run' || play.type === 'pass'
  const los = play.type === 'kickoff' ? null : 10 + snapYard(play)
  const fdRaw = scrimmage && play.down != null && play.distance != null ? Math.min(110, 10 + play.startYard + play.distance) : null
  return {
    play,
    anim,
    actorPlay: { anim, offClub: club(offId), defClub: club(defId), offHome, numbers: nums },
    tl,
    dir,
    los,
    firstDown: fdRaw != null && fdRaw < 110 ? fdRaw : null,
    turfText: scrimmage && play.down != null && play.distance != null ? `${ORD(play.down)} & ${play.startYard + play.distance >= 100 ? 'GOAL' : play.distance}` : null,
    possession: offHome ? 'home' : 'away',
    strongSideY: strongSideWorldY(anim, dir),
  }
}

// ── the composed live view ───────────────────────────────────────────────────

export interface LiveBroadcastOptions {
  homeTeamId: string
  awayTeamId: string
  /** Which camera lens to use (phone on narrow viewports). */
  profile: 'main' | 'phone'
  phase: 'live' | 'replay'
  qualitySetting: QualitySetting
  /** Starting level for Auto (the stored result for this device, else 'full'). */
  qualityStart?: QualityLevel
  reducedMotion?: boolean
  /** The resolved live view, echoed into the DEV stats hook. */
  live?: 'broadcast' | 'topdown'
  onQuality?: (q: QualityLevel, auto: AutoQualityState | null) => void
  onFallback?: (f: Exclude<Fallback, null>) => void
  onAutoQ?: (a: AutoQState) => void
}

function mirrorPose(p: CameraPose, dir: Direction): CameraPose {
  if (dir === 1) return p
  const a = offenseToWorld(p.pos[0], p.pos[1], dir)
  const b = offenseToWorld(p.target[0], p.target[1], dir)
  return { pos: [a.x, a.y, p.pos[2]], target: [b.x, b.y, p.target[2]], fovDeg: p.fovDeg }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export class LiveBroadcast {
  readonly renderer: BroadcastRenderer
  readonly layer: ActorLayer
  readonly gfx: GraphicsLayer

  private opts: LiveBroadcastOptions
  private director: Director | null = null
  private applier = createProfileApplier(CAMERA_PROFILES.phone)
  private play: LivePlay | null = null
  private t = 0
  private quality: QualityLevel
  private pacer: FramePacer
  private auto: AutoQuality | null
  private win = new FrameWindow(120)
  private iv = new FrameWindow(120)
  private drawStamps: number[] = []
  private lastDrawAt = 0
  private lastSig = ''
  private slow: number[] = []
  private slowActive = false
  private reported = false
  private drawTotal = 0
  private raf = 0
  private destroyed = false
  private ballFx: BallFxLike | null = null
  private ballFxKey = ''

  constructor(canvas: HTMLCanvasElement, opts: LiveBroadcastOptions) {
    this.opts = opts
    this.quality = opts.qualitySetting === 'auto' ? (opts.qualityStart ?? 'full') : opts.qualitySetting
    this.auto = opts.qualitySetting === 'auto' ? new AutoQuality(this.quality) : null
    this.pacer = new FramePacer(QUALITY[this.quality].fps)
    // GraphicsLayer paints the vignette (B6a); the renderer's own stays off.
    this.renderer = new BroadcastRenderer(canvas, { goalposts: false, vignette: false })
    this.layer = new ActorLayer()
    this.gfx = new GraphicsLayer(this.layer, readGfxTokens(canvas))
    this.gfx.vignette = QUALITY[this.quality].vignette
    this.renderer.hooks.actors = this.layer.hook
    this.renderer.hooks.overlay = this.gfx.hook
    this.renderer.onFrame = (s) => this.onFrame(s)
    this.renderer.setDprCap(QUALITY[this.quality].dprCap)
    this.renderer.setQuality(this.quality)
    this.loop = this.loop.bind(this)
    this.raf = requestAnimationFrame(this.loop)
  }

  private directorProfile(): DirectorProfile {
    return this.opts.profile === 'phone' ? 'phone' : this.opts.phase === 'replay' ? 'replay' : 'live'
  }

  /** Load one recorded play. */
  setPlay(lp: LivePlay): void {
    this.play = lp
    this.layer.setPlay(lp.actorPlay)
    this.gfx.setTimeline(lp.tl)
    const cv = this.renderer.canvas
    this.director = createDirector({ profile: this.directorProfile(), viewport: { w: Math.max(1, cv.clientWidth), h: Math.max(1, cv.clientHeight) } })
    this.director.reset(lp.play, lp.anim)
    this.applier.reset()
    this.pacer.reset()
    this.lastSig = ''
    this.gfx.sec = 0
    // B4: (re)compose the ball + effects for this recorded play (no-op until the
    // main merge supplies ballFx.ts).
    void this.attachBallFx(lp)
  }

  private async attachBallFx(lp: LivePlay): Promise<void> {
    const key = `${lp.play.n}`
    this.ballFxKey = key
    const mod = await loadBallFx()
    if (!mod || this.destroyed || this.ballFxKey !== key) return
    const fx = mod.createBallFx({
      anim: lp.anim,
      offenseClub: lp.actorPlay.offClub,
      defenseClub: lp.actorPlay.defClub,
      reducedMotion: !!this.opts.reducedMotion,
      quality: this.quality,
    })
    this.ballFx = fx
    this.renderer.hooks.actors = mod.withBallFx(this.layer, fx, () => this.layer.t)
  }

  /** MatchView's animation clock (0..1 of the play). */
  setTime(t: number): void {
    this.t = clamp01(t)
  }

  setQuality(q: QualityLevel): void {
    if (q === this.quality && this.pacer) return
    this.quality = q
    this.renderer.setQuality(q)
    this.renderer.setDprCap(QUALITY[q].dprCap)
    this.gfx.vignette = QUALITY[q].vignette
    this.pacer = new FramePacer(QUALITY[q].fps)
    this.opts.onQuality?.(q, this.auto?.snapshot() ?? null)
    // Re-compose B4's effects at the new level (pure function of the anim).
    if (this.play) void this.attachBallFx(this.play)
    this.publish()
  }

  get currentQuality(): QualityLevel {
    return this.quality
  }

  /** One synchronous draw (used by the render loop and by probes). */
  draw(): FrameStats | null {
    const lp = this.play
    const dir = lp?.dir ?? 1
    const cv = this.renderer.canvas
    const cssW = Math.max(1, cv.clientWidth || 320)
    const cssH = Math.max(1, cv.clientHeight || 180)
    const t = this.t
    this.layer.t = t
    this.gfx.sec = lp ? t * Math.max(0.05, lp.anim.duration / 1000) : 0
    this.gfx.mode = 'full'
    this.gfx.reducedMotion = !!this.opts.reducedMotion
    let camera: CameraPose
    if (lp && this.director) {
      camera = this.director.toCamera(this.director.shotAt(t))
      camera = mirrorPose(camera, dir)
      if (this.opts.profile === 'phone') {
        const holder = this.layer.holderAt(t)
        const carrier = holder ? this.layer.worldOf(holder, t, dir) : null
        const ball = this.layer.ballAt(t, dir)
        const ctx: ProfileCtx = {
          strongSideY: lp.strongSideY,
          carrier,
          ball,
          losX: offenseXToWorld(lp.los ?? 60, dir),
          direction: dir,
          phase: this.opts.phase,
          viewport: { w: cssW, h: cssH },
        }
        camera = this.applier.apply(camera, ctx, `${lp.play.n}`)
      }
    } else {
      camera = { pos: [60, -30, 20], target: [60, MID_WIDTH, 0], fovDeg: 43 }
    }
    // B4 camera shake on top of the final pose (bounded; 0 under reduced motion).
    if (this.ballFx && lp) camera = this.ballFx.shakePose(camera, t)
    const frame: BroadcastFrame = {
      camera,
      losYard: lp?.los ?? null,
      firstDownYard: lp?.firstDown ?? null,
      direction: dir,
      homeTeamId: this.opts.homeTeamId,
      awayTeamId: this.opts.awayTeamId,
      possession: lp?.possession ?? 'home',
      turfText: lp?.turfText ?? null,
      turfTextAlpha: Math.max(0, 1 - t * 8),
      time: t,
    }
    return this.renderer.draw(frame)
  }

  private onFrame(s: FrameStats): void {
    this.win.push(s.ms)
    const a = this.auto
    if (a && !a.decided) {
      const st = a.push(s)
      if (st.decided) {
        this.setQuality(st.result)
        this.opts.onAutoQ?.({ result: st.result, p95: st.p95, frames: st.frames, key: deviceKey(), at: new Date().toISOString() })
        if (st.result === 'lite') {
          this.slowActive = true
          this.slow = []
        }
      }
    } else if (this.slowActive && !this.reported) {
      this.slow.push(s.ms)
      if (this.slow.length >= 60) {
        const p95 = [...this.slow].sort((x, y) => x - y)[Math.min(this.slow.length - 1, Math.floor(this.slow.length * 0.95))]
        if (p95 > AUTO_TOO_SLOW_P95) {
          this.reported = true
          this.opts.onFallback?.('too-slow')
        } else {
          this.slowActive = false
        }
      }
    }
    this.publish()
  }

  private publish(): void {
    if (!import.meta.env.DEV || typeof window === 'undefined') return
    const avg = this.iv.avg
    ;(window as unknown as Record<string, unknown>).__gdBroadcast = {
      frames: this.win.count,
      p95: Math.round(this.win.p95 * 100) / 100,
      worst: Math.round(this.win.worst * 100) / 100,
      quality: this.quality,
      live: this.opts.live ?? 'broadcast',
      fallback: getFallback(),
      fps: avg > 0 ? Math.round(1000 / avg) : 0,
      intervalP95: Math.round(this.iv.p95 * 100) / 100,
      draws: this.drawStamps.length,
      drawTotal: this.drawTotal,
      autoResult: this.auto?.snapshot() ?? null,
      intervals: this.drawStamps.slice(-300),
    }
  }

  private loop(now: number): void {
    if (this.destroyed) return
    this.raf = requestAnimationFrame(this.loop)
    if (typeof document !== 'undefined' && document.hidden) return
    const lp = this.play
    const sig = `${lp?.play.n ?? -1}|${this.t}|${this.quality}|${this.opts.phase}|${this.renderer.canvas.clientWidth}x${this.renderer.canvas.clientHeight}`
    const dirty = sig !== this.lastSig
    if (!dirty) return
    if (!this.pacer.shouldDraw(now)) return
    this.lastSig = sig
    if (this.lastDrawAt > 0) this.iv.push(now - this.lastDrawAt)
    this.lastDrawAt = now
    this.drawStamps.push(now)
    this.drawTotal++
    if (this.drawStamps.length > 300) this.drawStamps.shift()
    try {
      this.draw()
    } catch (err) {
      // Keep the game running: report once and stop drawing (top-down takes over).
      if (!this.reported) {
        this.reported = true
        if (typeof console !== 'undefined') console.warn('Broadcast 2.5D draw failed; falling back to top-down.', err)
        this.opts.onFallback?.('render-error')
      }
    }
  }

  destroy(): void {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    this.renderer.destroy()
    this.layer.dispose()
  }
}

/** Mount the composed live view on a canvas. Never throws for a missing context. */
export function createLiveBroadcast(canvas: HTMLCanvasElement, opts: LiveBroadcastOptions): LiveBroadcast | null {
  try {
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      opts.onFallback?.('no-canvas')
      return null
    }
    return new LiveBroadcast(canvas, opts)
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('Broadcast 2.5D init failed; falling back to top-down.', err)
    opts.onFallback?.('render-error')
    return null
  }
}

/** Human-readable Auto hint for the settings row, or null. */
export function autoQualityHint(a: AutoQState | null, currentKey: string): string | null {
  if (!a || !a.result) return null
  const same = !currentKey || a.key === currentKey
  const label = a.result === 'lite' ? 'Lite' : 'Full'
  return same ? `Auto picked ${label} on this device (p95 ${a.p95.toFixed(1)} ms)` : `Auto last picked ${label} (p95 ${a.p95.toFixed(1)} ms on another device)`
}

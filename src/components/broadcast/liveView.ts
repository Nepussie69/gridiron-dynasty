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
import { createBallFx, withBallFx } from './ballFx'
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
import { ActorLayer, type ActorPlay, type SubPlan } from './actors'
import { SidelineLayer } from './sideline'
import { WeatherLayer, type FieldWeather } from './weatherFx'
import { GraphicsLayer, readGfxTokens } from './graphicsDraw'
import { buildGraphicsTimeline, type GraphicsTimeline, type PersonInfo } from './graphics'
import { type CameraAngleMode, type Director, type DirectorProfile } from './director'
import { createBroadcastDirector } from './directorRules'
import { ReplayPlayer, liveRouteTraces, liveTelestrations, type ReplayFrame, type ReplayPhase, type ReplayPlan } from './replay'
import { TelestratorLayer, attachTelestrator, composeHooks } from './telestrator'
import { QbConeLayer } from './visionCone'
import { useViewSettings, usePhone, getViewSettings, qbConeOn, deviceKey, type ViewSettings, type AutoQState, type QualitySetting } from './viewSettings'

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
  // B4 is on main now: a static import (kept async so callers stay unchanged).
  return { createBallFx: createBallFx as unknown as BallFxModule['createBallFx'], withBallFx: withBallFx as unknown as BallFxModule['withBallFx'] }
}

// ── resolution ───────────────────────────────────────────────────────────────

export type Fallback = null | 'no-canvas' | 'render-error' | 'too-slow'

export interface LiveViewState {
  /** The live (in-play) view. */
  live: 'broadcast' | 'topdown'
  /** Whether replays use the 2.5D view. */
  replayView: 'broadcast' | 'off'
  replayPolicy: ViewSettings['replays']
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
  /** animflow 6b-wx: the game's field weather (null: indoors, weather off or none). */
  weather: FieldWeather | null
  /** The passer, for the QB cone's rating-derived fallback. */
  qb?: Player
}

export interface LivePlayInput {
  play: Play
  anim: PlayAnim
  homeId: string
  awayId: string
  actors: Map<string, Player>
  numbers: Map<string, number>
  /** animflow r6b: the next play (its recorded personnel drives the substitutions). */
  next?: Play
  /** animflow 6b-wx: the game's field weather (`fieldWeather(...)`; null/absent draws none). */
  weather?: FieldWeather | null
}

/**
 * animflow r6b (item 4): the substitutions between this snap and the next
 * (same possession, both scrimmage snaps with recorded personnel): the drawn
 * men who are not on the field next play jog off, the men who come in jog on
 * (at most four per side). Benches: home near sideline, visitors far (SL1).
 */
export function subPlan(play: Play, next: Play | undefined, actors: Map<string, Player>, numbers: Map<string, number>, offHome: boolean): SubPlan | undefined {
  if (!next || next.offId !== play.offId) return undefined
  const scrim = (p: Play) => (p.type === 'run' || p.type === 'pass') && !!p.onFieldOff?.length && !!p.onFieldDef?.length
  if (!scrim(play) || !scrim(next)) return undefined
  const nowOff = new Set(play.onFieldOff)
  const nowDef = new Set(play.onFieldDef)
  const nextOff = new Set(next.onFieldOff)
  const nextDef = new Set(next.onFieldDef)
  const out: string[] = []
  const counts = { off: 0, def: 0 }
  for (const [key, p] of actors) {
    const side = nowOff.has(p.id) ? 'off' : nowDef.has(p.id) ? 'def' : null
    if (!side) continue
    const stays = side === 'off' ? nextOff.has(p.id) : nextDef.has(p.id)
    if (!stays && counts[side] < 4) { out.push(key); counts[side]++ }
  }
  const inn: SubPlan['in'] = []
  for (const [side, ids, now] of [['off', next.onFieldOff!, nowOff], ['def', next.onFieldDef!, nowDef]] as const) {
    let c = 0
    for (const id of ids) {
      if (now.has(id) || c >= 4) continue
      const n = numbers.get(id)
      if (n == null) continue
      inn.push({ side, number: n })
      c++
    }
  }
  if (!out.length && !inn.length) return undefined
  const near = -3
  const far = FIELD_WIDTH + 3
  return { out: out.sort(), in: inn, benchY: { off: offHome ? near : far, def: offHome ? far : near } }
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
    actorPlay: { anim, offClub: club(offId), defClub: club(defId), offHome, numbers: nums, subs: subPlan(play, input.next, input.actors, input.numbers, offHome) },
    tl,
    dir,
    los,
    firstDown: fdRaw != null && fdRaw < 110 ? fdRaw : null,
    turfText: scrimmage && play.down != null && play.distance != null ? `${ORD(play.down)} & ${play.startYard + play.distance >= 100 ? 'GOAL' : play.distance}` : null,
    possession: offHome ? 'home' : 'away',
    strongSideY: strongSideWorldY(anim, dir),
    weather: input.weather ?? null,
    qb: input.actors.get('qb'),
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
  /** CSS px the HUD (lower third / toast) keeps clear at the bottom (DOM controls). */
  hudBottomInset?: number
  /** The resolved live view, echoed into the DEV stats hook. */
  live?: 'broadcast' | 'topdown'
  onQuality?: (q: QualityLevel, auto: AutoQualityState | null) => void
  onFallback?: (f: Exclude<Fallback, null>) => void
  onAutoQ?: (a: AutoQState) => void
  /**
   * Backlog 357: 'fixed' (default) holds one camera angle — pan + zoom only,
   * replays keep the live angle, no camera shake; 'dynamic' = the B5b director.
   */
  cameraAngle?: CameraAngleMode
}

function mirrorPose(p: CameraPose, dir: Direction): CameraPose {
  if (dir === 1) return p
  const a = offenseToWorld(p.pos[0], p.pos[1], dir)
  const b = offenseToWorld(p.target[0], p.target[1], dir)
  return { pos: [a.x, a.y, p.pos[2]], target: [b.x, b.y, p.target[2]], fovDeg: p.fovDeg }
}

/** A replay's phase as Game Day sees it: 'lead' is the beat before the wipe. */
export type LiveReplayPhase = ReplayPhase | 'lead'

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export class LiveBroadcast {
  readonly renderer: BroadcastRenderer
  readonly layer: ActorLayer
  readonly gfx: GraphicsLayer
  /** SL1: team areas, officials and the chain crew. */
  readonly sideline: SidelineLayer
  /** animflow 6b-wx: rain / snow / breath / wind on the field. */
  readonly weather: WeatherLayer
  /** QB vision cone + placement circle (ground plane; off by default in 2.5D). */
  readonly qbCone = new QbConeLayer()

  private opts: LiveBroadcastOptions
  private director: Director | null = null
  private applier: ReturnType<typeof createProfileApplier>
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
  // B8: the telestrator replay (B6b) on this canvas.
  readonly tele: TelestratorLayer
  private rp: ReplayPlayer | null = null
  private rpDirector: Director | null = null
  private rpPhase: LiveReplayPhase | null = null
  /** Seconds the live end frame (and its result toast) holds before the wipe. */
  private rpLead = 0
  /** Seconds the live play has sat on its last frame: the result toast's hold (B6a 'post'). */
  private endHold = 0
  private endHoldAt = 0
  private rpLastNow = 0
  private rpPaused = false
  private rpSpeed = 1
  /** Sim to end: live telestrations are off (fast playback), like a replay's 'fast'. */
  private simming = false
  /** Called when the replay phase changes (null = no replay on screen). */
  onReplay: ((phase: LiveReplayPhase | null) => void) | null = null

  constructor(canvas: HTMLCanvasElement, opts: LiveBroadcastOptions) {
    this.opts = opts
    this.applier = createProfileApplier(CAMERA_PROFILES.phone, { fixed: this.fixedAngle })
    this.quality = opts.qualitySetting === 'auto' ? (opts.qualityStart ?? 'full') : opts.qualitySetting
    this.auto = opts.qualitySetting === 'auto' ? new AutoQuality(this.quality) : null
    this.pacer = new FramePacer(QUALITY[this.quality].fps)
    // GraphicsLayer paints the vignette (B6a); the renderer's own stays off.
    this.renderer = new BroadcastRenderer(canvas, { goalposts: false, vignette: false })
    this.layer = new ActorLayer()
    this.sideline = new SidelineLayer()
    this.sideline.quality = this.quality
    this.layer.ringPulse = this.quality !== 'lite' && !opts.reducedMotion
    this.weather = new WeatherLayer(this.layer)
    this.weather.quality = this.quality
    this.weather.reducedMotion = !!opts.reducedMotion
    this.layer.people = (scene, out) => {
      this.sideline.items(scene, out)
      this.weather.items(scene, out)
    }
    this.gfx = new GraphicsLayer(this.layer, readGfxTokens(canvas))
    this.gfx.bottomInset = opts.hudBottomInset ?? 0
    this.renderer.hooks.actors = this.layer.hook
    this.renderer.hooks.ground = composeHooks(this.weather.ground, this.qbCone.hook)
    this.renderer.hooks.weather = this.weather.air
    this.renderer.hooks.overlay = this.gfx.hook
    // B8: telestrations under the HUD, the REPLAY bug + wipe over it. The
    // telestrator owns the vignette (so it stays under the strokes).
    this.tele = new TelestratorLayer(readGfxTokens(canvas), this.layer)
    this.gfx.vignette = false
    attachTelestrator(this.renderer, this.tele, this.gfx)
    this.tele.vignette = QUALITY[this.quality].vignette
    this.renderer.onFrame = (s) => this.onFrame(s)
    this.renderer.setDprCap(QUALITY[this.quality].dprCap)
    this.renderer.setQuality(this.quality)
    this.loop = this.loop.bind(this)
    this.raf = requestAnimationFrame(this.loop)
  }

  private get fixedAngle(): boolean {
    return (this.opts.cameraAngle ?? 'fixed') === 'fixed'
  }

  private get angle(): CameraAngleMode {
    return this.fixedAngle ? 'fixed' : 'dynamic'
  }

  private directorProfile(phase: 'live' | 'replay' = this.opts.phase): DirectorProfile {
    // Backlog 357: with a fixed angle a replay keeps the live rig (it may slow down / zoom, not re-angle).
    return this.opts.profile === 'phone' ? 'phone' : phase === 'replay' && !this.fixedAngle ? 'replay' : 'live'
  }

  private viewport(): { w: number; h: number } {
    const cv = this.renderer.canvas
    return { w: Math.max(1, cv.clientWidth), h: Math.max(1, cv.clientHeight) }
  }

  // ── B8: the telestrator replay ────────────────────────────────────────────

  /**
   * Start the replay of the loaded play (the plan comes from replayPlan with
   * the user's Replays setting, or force for the Replay button). Returns false
   * (and draws nothing new) when the plan has no replay.
   */
  startReplay(plan: ReplayPlan, leadSec = 0): boolean {
    const lp = this.play
    if (!lp || !plan.replay) return false
    this.rp = new ReplayPlayer(plan)
    // The replay director: the higher replay rig (the phone rig + the phone
    // lens's replay variant on a phone), with B5b's special-teams rules.
    this.rpDirector = createBroadcastDirector({ profile: this.directorProfile('replay'), viewport: this.viewport(), bottomClearPx: this.opts.hudBottomInset, angle: this.angle })
    this.rpDirector.reset(lp.play, lp.anim)
    this.tele.setReplay(plan, lp.anim, lp.actorPlay.offClub, lp.actorPlay.defClub, lp.actorPlay.numbers)
    this.rpLead = Math.max(0, leadSec)
    this.tele.frame = this.rpLead > 0 ? null : this.rp.frame()
    this.rpLastNow = 0
    this.applier.reset()
    this.lastSig = ''
    this.setReplayPhase(this.tele.frame ? this.tele.frame.phase : 'lead')
    return true
  }

  /** End the replay at once (the Skip control, Space / Escape). */
  skipReplay(): void {
    if (!this.rp) return
    this.rp.skip()
    this.endReplay()
  }

  /** Hold the replay (the game is paused) and its playback speed. */
  setReplayClock(paused: boolean, speed: number): void {
    this.rpPaused = paused
    this.rpSpeed = Math.max(0.25, Math.min(4, speed || 1))
  }

  get replaying(): boolean {
    return !!this.rp
  }

  /** The replay's current frame (probes / debugging). */
  get replayFrame(): ReplayFrame | null {
    return this.rp ? this.tele.frame : null
  }

  private endReplay(): void {
    if (!this.rp && !this.rpPhase) return
    this.rp = null
    this.rpDirector = null
    this.rpLead = 0
    this.tele.frame = null
    this.tele.setReplay(null, null)
    this.applier.reset()
    this.lastSig = ''
    this.setReplayPhase(null)
  }

  private setReplayPhase(p: LiveReplayPhase | null): void {
    const v = p === 'done' ? null : p
    if (v === this.rpPhase) return
    this.rpPhase = v
    this.onReplay?.(v)
  }

  /** Advance the replay clock (real time × the game speed; held while paused). */
  private tickReplay(now: number): void {
    const rp = this.rp
    if (!rp) return
    const dt = this.rpLastNow > 0 ? Math.min(0.1, Math.max(0, (now - this.rpLastNow) / 1000)) : 0
    this.rpLastNow = now
    const step = this.rpPaused ? 0 : dt * this.rpSpeed
    if (this.rpLead > 0) {
      // The live end frame + result toast hold a beat before the wipe.
      this.rpLead -= step
      if (this.rpLead > 0) return
    }
    const f = rp.advance(step)
    if (f.phase === 'done') {
      this.endReplay()
      return
    }
    this.tele.frame = f
    this.setReplayPhase(f.phase)
  }

  /**
   * The live play's telestrations (the Drawings setting, default every play):
   * the same set a replay of the play would build, painted in live anim time.
   * Cleared for 'Replays only' / 'Off', for sim to end, and on the replay-only
   * overlay canvas (which never shows the live view).
   */
  private setupLiveTele(lp: LivePlay): void {
    if (this.opts.phase === 'replay') {
      this.tele.setLive(null, null)
      return
    }
    const opts = {
      setting: getViewSettings().drawings,
      playback: (this.simming ? 'fast' : 'live') as 'fast' | 'live',
      reducedMotion: !!this.opts.reducedMotion,
    }
    const items = liveTelestrations(lp.play, lp.anim, opts)
    // livetele3: every route runner's own plain trace, live (the target is only
    // highlighted at the release, inside the item set).
    const traces = liveRouteTraces(lp.play, lp.anim, opts)
    this.tele.setLive(items, items.length || traces.length ? lp.anim : null, lp.actorPlay.numbers, traces)
  }

  /** Re-read the Drawings setting for the play on screen (the setting changed). */
  refreshLiveTele(): void {
    if (!this.play) return
    this.setupLiveTele(this.play)
    this.lastSig = ''
  }

  /** Sim to end: live drawings are off (fast playback), like a replay's 'fast'. */
  setSimming(on: boolean): void {
    if (on === this.simming) return
    this.simming = on
    this.refreshLiveTele()
  }

  /** Load one recorded play. */
  setPlay(lp: LivePlay): void {
    // A new play always ends a replay of the previous one (never blocks the game).
    if (this.rp) this.endReplay()
    this.play = lp
    this.layer.setPlay(lp.actorPlay)
    const club = (id: string) => NFL_TEAMS.find((c) => c.id === id) ?? NFL_TEAMS[0]
    this.sideline.setPlay({
      play: lp.play,
      anim: lp.anim,
      dir: lp.dir,
      los: lp.los,
      firstDown: lp.firstDown,
      homeClub: club(this.opts.homeTeamId),
      awayClub: club(this.opts.awayTeamId),
      homeId: this.opts.homeTeamId,
    })
    this.gfx.setTimeline(lp.tl)
    this.weather.weather = lp.weather
    this.qbCone.set(lp.play, lp.anim, lp.qb)
    this.weather.qtr = lp.play.qtr ?? 1
    this.weather.club = club(this.opts.homeTeamId)
    // B5 director with B5b's special-teams rules (kicks, returns, FG/PAT).
    this.director = createBroadcastDirector({ profile: this.directorProfile(), viewport: this.viewport(), bottomClearPx: this.opts.hudBottomInset, angle: this.angle })
    this.director.reset(lp.play, lp.anim)
    this.applier.reset()
    this.pacer.reset()
    this.lastSig = ''
    this.endHold = 0
    this.endHoldAt = 0
    this.gfx.sec = 0
    // B4: (re)compose the ball + effects for this recorded play (no-op until the
    // main merge supplies ballFx.ts).
    void this.attachBallFx(lp)
    // Live telestrations (the Drawings setting; a new snap replaces the last).
    this.setupLiveTele(lp)
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
    this.sideline.quality = q
    this.weather.quality = q
    this.layer.ringPulse = q !== 'lite' && !this.opts.reducedMotion
    this.renderer.setDprCap(QUALITY[q].dprCap)
    this.tele.vignette = QUALITY[q].vignette
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
    // B8: while a replay shows, it owns the clock and the camera; before its
    // cut and after the wipe-out midpoint the live frame shows (under the wipe).
    const rf = this.rp ? this.tele.frame : null
    const inReplay = !!(rf && rf.showReplay && this.rpDirector)
    const t = inReplay && rf ? rf.t : this.t
    const phase: 'live' | 'replay' = inReplay ? 'replay' : this.opts.phase
    this.layer.t = t
    this.qbCone.t = t
    this.qbCone.enabled = qbConeOn(getViewSettings(), 'broadcast')
    // Live telestrations sample the live anim time (a replay owns its own clock).
    this.tele.setLiveTime(t)
    // animflow r6b: the live end frame's hold drives the substitutions' jog.
    this.layer.post = inReplay ? 0 : this.endHold
    // Live: once the play ends, the graphics clock runs on into the result
    // toast's hold (the toast enters at the whistle and holds `post` seconds).
    this.gfx.sec = lp ? t * Math.max(0.05, lp.anim.duration / 1000) + (inReplay ? 0 : this.endHold) : 0
    this.sideline.sec = this.gfx.sec
    this.weather.sec = this.gfx.sec
    // The replay: chip only (no live callouts / toast over the telestrations).
    this.gfx.mode = inReplay ? 'fast' : 'full'
    this.gfx.reducedMotion = !!this.opts.reducedMotion
    this.tele.mode = 'full'
    this.tele.reducedMotion = !!this.opts.reducedMotion
    let camera: CameraPose
    const dirn = inReplay && this.rpDirector ? this.rpDirector : this.director
    if (lp && dirn) {
      camera = dirn.toCamera(dirn.shotAt(t))
      camera = mirrorPose(camera, dir)
      if (this.opts.profile === 'phone') {
        const holder = this.layer.holderAt(t)
        const carrier = holder ? this.layer.worldOf(holder, t, dir) : null
        const ball = this.layer.ballAt(t, dir)
        const ctx: ProfileCtx = {
          // B8: a phone replay leans toward the action (the carrier, else the
          // ball), not the formation's strong side: the portrait frame is only
          // ~20 yd wide, and a sideline catch otherwise sits on the frame edge.
          strongSideY: inReplay ? (carrier?.y ?? ball.y) : lp.strongSideY,
          carrier,
          ball,
          losX: offenseXToWorld(lp.los ?? 60, dir),
          direction: dir,
          phase,
          viewport: { w: cssW, h: cssH },
          // animflow r6a: open the phone lens at the snap, easing in over 1 s.
          wide: inReplay ? 0 : clamp01Num(1 - (t * (lp.anim.duration / 1000) - 0.14) / 1.0),
          // Backlog 357: the fixed lens keeps the action above the playback controls.
          bottomClear: this.fixedAngle ? (this.opts.hudBottomInset ?? 0) : undefined,
        }
        camera = this.applier.apply(camera, ctx, `${lp.play.n}:${inReplay ? 'r' : 'l'}`)
      }
    } else {
      camera = { pos: [60, -30, 20], target: [60, MID_WIDTH, 0], fovDeg: 43 }
    }
    // B4 camera shake on top of the final pose (bounded; 0 under reduced motion).
    // Backlog 357: a fixed angle stays still (no shake).
    if (this.ballFx && lp && !this.fixedAngle) camera = this.ballFx.shakePose(camera, t)
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

  private lastMs = 0
  private onFrame(s: FrameStats): void {
    this.lastMs = s.ms
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
    ;(window as unknown as Record<string, unknown>)[this.opts.live === 'topdown' ? '__gdReplayView' : '__gdLive'] = this
    ;(window as unknown as Record<string, unknown>).__gdBroadcast = {
      frames: this.win.count,
      avgMs: Math.round(this.win.avg * 100) / 100,
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
      replay: this.rpPhase,
      replaySec: this.rp ? Math.round(this.rp.sec * 100) / 100 : null,
      teleMs: Math.round(this.tele.stats.ms * 1000) / 1000,
      teleLabels: this.tele.stats.labels,
      sideline: { ...this.sideline.stats, ms: Math.round(this.sideline.stats.ms * 1000) / 1000 },
      weather: { on: this.weather.active, ...this.weather.stats, ms: Math.round(this.weather.stats.ms * 1000) / 1000 },
      lastMs: Math.round((this.win.count ? this.lastMs : 0) * 1000) / 1000,
      intervals: this.drawStamps.slice(-300),
    }
  }

  private loop(now: number): void {
    if (this.destroyed) return
    this.raf = requestAnimationFrame(this.loop)
    if (typeof document !== 'undefined' && document.hidden) return
    this.tickReplay(now)
    // The result toast's hold after the last frame (real time; capped at the timeline's post).
    const post = this.play?.tl?.post ?? 0
    if (this.t >= 1 && post > 0) {
      if (this.endHoldAt > 0) this.endHold = Math.min(post, this.endHold + Math.min(0.1, (now - this.endHoldAt) / 1000))
      this.endHoldAt = now
    } else {
      this.endHold = 0
      this.endHoldAt = 0
    }
    const lp = this.play
    const sig = `${lp?.play.n ?? -1}|${this.t}|${this.endHold}|${this.rp && this.tele.frame ? this.rp.sec : -1}|${this.quality}|${this.opts.phase}|${this.renderer.canvas.clientWidth}x${this.renderer.canvas.clientHeight}`
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
    this.onReplay = null
    this.rp = null
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

function clamp01Num(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

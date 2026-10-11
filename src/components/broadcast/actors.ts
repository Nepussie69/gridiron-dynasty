// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B3): the actor layer — players, goalposts and the ball in
// one depth-sorted pass, for BroadcastRenderer.hooks.actors.
//
//   const layer = new ActorLayer()
//   const r = new BroadcastRenderer(canvas, { goalposts: false })  // posts join the sort
//   r.hooks.actors = layer.hook
//   layer.setPlay({ anim, offClub, defClub, offHome, numbers })
//   layer.t = 0.42                                                  // 0..1 play time
//   r.draw(frame)                                                   // frame.direction maps offense → world
//
// setPlay() samples every actor once (60 Hz of play time): position, ground
// speed, run-cycle phase advanced by distance (stride grows with speed) and a
// smoothed heading from animData facing windows. Per frame: pose from the
// animData pose windows (blended over 0.16 s from what was actually drawn),
// project, cull, shadows (one batched fill), then figures + goalposts + ball
// (+ B4 items) far → near.
//
// API for later phases:
//   B4 (ball / effects): set `drawBall = false` and push your own SceneItems in
//     `addItems(scene, out)` — each item has a camera depth and a draw(ctx);
//     they are sorted with the figures (stable). `ground(scene)` draws on the
//     turf under every body (rings, trails) after the shadows.
//     `scene.ball` is this frame's ball {x, y, z, carried, depth} — the same
//     height clamp (carrier going to ground) and depth rule (carried: just in
//     front of the carrier) the placeholder uses; scene.ballWorld(t) for any t.
//   B6 (callouts): `screen` holds, after each frame, every visible actor's
//     canvas-pixel feet / helmet centre (headX, headY — follows a falling
//     body) / helmet top / depth / scale / pose (divide by `info.dpr` —
//     `lastDpr` — for CSS pixels); `screenOf(key)` reads one.
//   B5 (camera), no drawing needed: `worldOf(key, t, dir)` an actor's world
//     position, `sampleOf(key, t)` its offense-frame sample (speed, phase,
//     heading), `ballAt(t, dir)` the ball (world, clamped height) and
//     `holderAt(t)` the carrier's key.
// ─────────────────────────────────────────────────────────────────────────────
import { ballZAt, facingAt, type BroadcastAnim, type PoseState, type PoseWindow } from './animData.ts'
import { FIELD_LENGTH, MID_WIDTH, offenseToWorld, project, type Camera, type Direction } from './camera.ts'
import { drawGoalposts } from './field.ts'

/** Goalposts closer than this (yd, ground distance to the camera) are not drawn. */
const POST_NEAR_YD = 22
import {
  blendPose,
  clubKit,
  cycleLength,
  depthSort,
  drawFigure,
  drawShadows,
  fallbackNumber,
  FIG_ART,
  figureHead,
  figureScreen,
  HELMET_R,
  newPose,
  POSE_BLEND,
  POSE_LIBRARY,
  poseParams,
  skinFor,
  type DepthItem,
  type DrawOpts,
  type Figure,
  type FigureScreen,
  type Kit,
  type PoseParams,
} from './figures.ts'
import { holderAt, posAt } from './interp.ts'
import type { ClubLike } from './palette.ts'
import type { BroadcastFrame, LayerHook, LayerInfo } from './renderer.ts'
import { SpriteCache } from './sprites.ts'

export { cycleLength }

/** Sampling rate of the precomputed tracks (samples per second of play time). */
const HZ = 60
/** Below this height a held ball sorts with (just in front of) its carrier. */
const CARRIED_Z = 2.5
/** Pose blends chain back at most this many windows (short windows in a row). */
const BLEND_DEPTH = 3

interface Track {
  key: string
  side: 'off' | 'def'
  role: string
  order: number
  number: number
  skin: string
  /** Offense-frame samples. */
  X: Float32Array
  Y: Float32Array
  /** Ground speed (yd/s). */
  V: Float32Array
  /** Run-cycle phase (radians). */
  PH: Float32Array
  /** Smoothed heading (offense frame, radians). */
  HD: Float32Array
  poses: PoseWindow[]
  /** Reused per frame. */
  fig: Figure
  scr: FigureScreen | null
}

export interface ActorPlay {
  anim: BroadcastAnim
  /** The club whose actors have side 'off' (play.offId; the receiving club on a kickoff). */
  offClub: ClubLike
  defClub: ClubLike
  /** True when the 'off' club is the home club (home wears colour, visitors white). */
  offHome: boolean
  /** Jersey number per actor key (fallback: a number from the role's range). */
  numbers?: Record<string, number>
}

/** One visible actor on screen after a frame (canvas pixels). */
export interface ActorScreen {
  key: string
  side: 'off' | 'def'
  role: string
  /** Feet. */
  x: number
  y: number
  /** Helmet centre (follows the body when it falls / lies sideways). */
  headX: number
  headY: number
  /** Helmet top (headY − helmet radius). */
  top: number
  depth: number
  /** Pixels per figure unit (projected 2 yd). */
  scale: number
  pose: PoseState
  holder: boolean
}

/** An actor's offense-frame sample at a play time. */
export interface ActorSample {
  x: number
  y: number
  /** Ground speed (yd/s). */
  v: number
  /** Run-cycle phase (radians). */
  ph: number
  /** Smoothed heading (offense frame, radians). */
  hd: number
}

export interface BallState {
  /** World position (yards). */
  x: number
  y: number
  /** Height above the turf (yards), clamped down with a carrier going to ground. */
  z: number
  /** Held low by its carrier (sorts with him) rather than loose / in flight. */
  carried: boolean
  /** Camera depth for the painter's sort (−Infinity when its ground point is behind the camera). */
  depth: number
}

/** What B4 items get to work with. */
export interface Scene {
  ctx: CanvasRenderingContext2D
  cam: Camera
  frame: BroadcastFrame
  info: LayerInfo
  anim: BroadcastAnim
  /** Play time 0..1 and seconds since the play began. */
  t: number
  seconds: number
  direction: Direction
  /** Offense frame → world. */
  toWorld(x: number, y: number): { x: number; y: number }
  /** This frame's ball (position, clamped height, sort depth). */
  ball: BallState
  /** The ball in world coordinates (z = height, yards, same clamp as `ball`) at play time t. */
  ballWorld(t: number): { x: number; y: number; z: number }
  holder: string | null
  screenOf(key: string): ActorScreen | undefined
}

export interface SceneItem extends DepthItem {
  draw(ctx: CanvasRenderingContext2D): void
}

/** One drawn item in painter's order (filled when `trace` is on; for checks). */
export interface TraceItem {
  kind: 'fig' | 'post' | 'ball' | 'extra'
  key: string
  depth: number
}

export interface ActorFrameStats {
  /** Actor layer time this frame (ms). */
  ms: number
  figures: number
  drawn: number
  spriteHits: number
  spriteMisses: number
  spriteEntries: number
}

// ── helpers ──────────────────────────────────────────────────────────────────

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const TAU = Math.PI * 2

function angLerp(a: number, b: number, u: number): number {
  let d = b - a
  while (d > Math.PI) d -= TAU
  while (d < -Math.PI) d += TAU
  return a + d * u
}

function buildTrack(anim: BroadcastAnim, a: BroadcastAnim['actors'][number], order: number, D: number, n: number, num: number): Track {
  const N = Math.max(2, Math.ceil(D * HZ) + 1)
  const X = new Float32Array(N)
  const Y = new Float32Array(N)
  const V = new Float32Array(N)
  const PH = new Float32Array(N)
  const HD = new Float32Array(N)
  const path = a.path ?? []
  // Positions in one walk.
  let seg = 0
  for (let i = 0; i < N; i++) {
    const t = Math.min(1, i / HZ / D)
    if (!path.length) {
      X[i] = 60
      Y[i] = MID_WIDTH
      continue
    }
    if (t <= path[0].t) {
      X[i] = path[0].x
      Y[i] = path[0].y
      continue
    }
    while (seg < path.length - 2 && path[seg + 1].t < t) seg++
    const p = path[seg]
    const q = path[Math.min(path.length - 1, seg + 1)]
    if (t >= q.t) {
      X[i] = q.x
      Y[i] = q.y
      continue
    }
    const sp = q.t - p.t
    const u = sp <= 0 ? 1 : (t - p.t) / sp
    X[i] = p.x + (q.x - p.x) * u
    Y[i] = p.y + (q.y - p.y) * u
  }
  // Speed: central difference over ±2 samples.
  for (let i = 0; i < N; i++) {
    const lo = Math.max(0, i - 2)
    const hi = Math.min(N - 1, i + 2)
    const dt = (hi - lo) / HZ
    V[i] = dt > 0 ? Math.hypot(X[hi] - X[lo], Y[hi] - Y[lo]) / dt : 0
  }
  // Phase by distance travelled.
  let ph = (n % 7) * 0.9
  PH[0] = ph
  for (let i = 1; i < N; i++) {
    const ds = Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1])
    ph += (ds / cycleLength(V[i])) * TAU
    PH[i] = ph
  }
  // Heading: animData facing, smoothed (no snapping on window changes).
  let h = 0
  for (let i = 0; i < N; i++) {
    const t = Math.min(1, i / HZ / D)
    const raw = facingAt(anim, a.key, t)
    h = i === 0 ? raw : angLerp(h, raw, 0.16)
    HD[i] = h
  }
  return {
    key: a.key,
    side: a.side,
    role: a.role,
    order,
    number: num,
    skin: skinFor(a.key, num),
    X,
    Y,
    V,
    PH,
    HD,
    poses: anim.poses[a.key] ?? [],
    fig: {
      key: a.key,
      side: a.side,
      x: 0,
      y: 0,
      heading: 0,
      speed: 0,
      phase: 0,
      pose: newPose(),
      fallDir: null,
      kit: null as unknown as Kit,
      number: num,
      skin: skinFor(a.key, num),
      alpha: 1,
      order,
    },
    scr: null,
  }
}

/** Index of the pose window containing t (binary search on t1). */
function windowIndex(ws: PoseWindow[], t: number): number {
  let lo = 0
  let hi = ws.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (t <= ws[mid].t1 + 1e-6) hi = mid
    else lo = mid + 1
  }
  return lo
}

// ── the layer ────────────────────────────────────────────────────────────────

interface Item extends SceneItem {
  kind: TraceItem['kind']
  key: string
}

export class ActorLayer {
  /** Play time 0..1. */
  t = 0
  /** Draw the placeholder ball (B4 turns this off and draws its own). */
  drawBall = true
  /** Use pre-rendered sprite parts (off = paint every part directly; for comparison). */
  useSprites = true
  /** Record the painter's order of each frame in `lastOrder` (checks / debugging). */
  trace = false
  readonly lastOrder: TraceItem[] = []
  /** B4: extra depth-sorted items (ball, effects). */
  addItems?: (scene: Scene, out: SceneItem[]) => void
  /** B4: turf-level drawing under every body, after the shadows. */
  ground?: (scene: Scene) => void
  /** SL1: sideline people (team areas, officials, chain crew), depth-sorted with the figures. */
  people?: (scene: Scene, out: SceneItem[]) => void
  /** B6: visible actors after the last frame (canvas px). */
  readonly screen = new Map<string, ActorScreen>()
  lastDpr = 1
  stats: ActorFrameStats = { ms: 0, figures: 0, drawn: 0, spriteHits: 0, spriteMisses: 0, spriteEntries: 0 }
  readonly sprites: SpriteCache

  private play: ActorPlay | null = null
  private tracks: Track[] = []
  private byKey = new Map<string, Track>()
  private D = 1
  private kits: { off: Kit; def: Kit } | null = null
  private clubKey = ''
  private items: Item[] = []
  private figs: Figure[] = []
  /** Blend sources per recursion depth (no per-frame allocation). */
  private scratch: PoseParams[] = Array.from({ length: BLEND_DEPTH }, () => newPose())
  private ballPose = newPose()
  /** Reused draw options (the font is the sprite cache's, read once — no per-frame style reads). */
  private opts: DrawOpts

  constructor(sprites?: SpriteCache) {
    this.sprites = sprites ?? new SpriteCache()
    this.opts = { dpr: 1, font: this.sprites.font, sprites: null, time: 0 }
  }

  /** Load a play (samples every actor once). */
  setPlay(p: ActorPlay): void {
    this.play = p
    const anim = p.anim
    this.D = Math.max(0.05, (anim.duration || 0) / 1000)
    this.tracks = anim.actors.map((a, i) => {
      const num = p.numbers?.[a.key] ?? fallbackNumber(a.key, a.role)
      return buildTrack(anim, a, i, this.D, i, num)
    })
    this.byKey = new Map(this.tracks.map((tr) => [tr.key, tr]))
    const off = clubKit(p.offClub, p.offHome)
    const def = clubKit(p.defClub, !p.offHome)
    // Clear only on a new matchup / new colours: a possession change swaps
    // off/def but every cached part (keyed by kit id) is still valid.
    const ck = [off.id, def.id].sort().join('||')
    if (ck !== this.clubKey) {
      this.clubKey = ck
      this.sprites.clear()
    }
    this.kits = { off, def }
    this.sprites.refreshFont()
    for (const tr of this.tracks) tr.fig.kit = tr.side === 'off' ? off : def
    this.screen.clear()
  }

  get anim(): BroadcastAnim | null {
    return this.play?.anim ?? null
  }

  /** Seconds of play time. */
  get duration(): number {
    return this.D
  }

  get kitsInUse(): { off: Kit; def: Kit } | null {
    return this.kits
  }

  dispose(): void {
    this.sprites.dispose()
  }

  /** An actor's world position at play time t. */
  worldOf(key: string, t: number, dir: Direction): { x: number; y: number } | null {
    const tr = this.byKey.get(key)
    if (!tr) return null
    const s = this.sample(tr, t)
    return offenseToWorld(s.x, s.y, dir)
  }

  /** An actor's offense-frame sample (position, speed, run phase, heading) at play time t. */
  sampleOf(key: string, t: number): ActorSample | null {
    const tr = this.byKey.get(key)
    return tr ? this.sample(tr, t) : null
  }

  /** Who carries the ball at play time t. */
  holderAt(t: number): string | null {
    return this.play ? holderAt(this.play.anim.holders, t) : null
  }

  /** The ball in world coordinates at play time t (z clamped with a carrier going to ground). No drawing. */
  ballAt(t: number, dir: Direction): { x: number; y: number; z: number } {
    const b = this.ballCore(t, dir)
    return { x: b.x, y: b.y, z: b.z }
  }

  screenOf(key: string): ActorScreen | undefined {
    return this.screen.get(key)
  }

  /** The renderer hook. */
  readonly hook: LayerHook = (ctx, cam, frame, info) => this.draw(ctx, cam, frame, info)

  private sample(tr: Track, t: number): ActorSample {
    const f = Math.max(0, t) * this.D * HZ
    const N = tr.X.length
    const i = Math.min(N - 1, Math.floor(f))
    const j = Math.min(N - 1, i + 1)
    const u = Math.min(1, f - i)
    return {
      x: tr.X[i] + (tr.X[j] - tr.X[i]) * u,
      y: tr.Y[i] + (tr.Y[j] - tr.Y[i]) * u,
      v: tr.V[i] + (tr.V[j] - tr.V[i]) * u,
      ph: tr.PH[i] + (tr.PH[j] - tr.PH[i]) * u,
      hd: angLerp(tr.HD[i], tr.HD[j], u),
    }
  }

  private headingAt(tr: Track, t: number): number {
    return this.sample(tr, t).hd
  }

  /**
   * Pose of window i at t, blended in from what window i−1 drew at the same t
   * (recursively, so a window shorter than POSE_BLEND does not make the next
   * one jump). Deterministic in t and continuous at every window start.
   */
  private poseInto(ws: PoseWindow[], i: number, t: number, out: PoseParams, depth: number): void {
    const w = ws[i]
    const D = this.D
    const age = (t - w.t0) * D
    poseParams(w.state, age, (w.t1 - w.t0) * D, out)
    if (i > 0 && age < POSE_BLEND && depth < BLEND_DEPTH) {
      const src = this.scratch[depth]
      this.poseInto(ws, i - 1, t, src, depth + 1)
      const u = clamp01(age / POSE_BLEND)
      blendPose(src, out, u * u * (3 - 2 * u), out)
    }
  }

  /** Pose (blended) and fall direction (offense frame) for a track at t. */
  private poseFor(tr: Track, t: number, out: Figure): PoseState {
    const ws = tr.poses
    if (!ws.length) {
      poseParams('stand', 0, 0, out.pose)
      out.fallDir = null
      return 'stand'
    }
    const i = windowIndex(ws, t)
    const w = ws[i]
    this.poseInto(ws, i, t, out.pose, 0)
    const age = (t - w.t0) * this.D
    const fd = POSE_LIBRARY[w.state]?.fallDir ?? 'none'
    let src = fd
    if (fd === 'none' && i > 0 && age < POSE_BLEND) src = POSE_LIBRARY[ws[i - 1].state]?.fallDir ?? 'none'
    out.fallDir = src === 'none' ? null : src === 'start' ? this.headingAt(tr, w.t0) : this.headingAt(tr, t)
    return w.state
  }

  /** The ball at t without a camera: world position, clamped height, carried flag and holder. */
  private ballCore(t: number, dir: Direction): { x: number; y: number; z: number; carried: boolean; holder: string | null } {
    const a = this.play?.anim
    if (!a) return { ...offenseToWorld(60, MID_WIDTH, dir), z: 0, carried: false, holder: null }
    const p0 = posAt(a.ball, t)
    const p = { x: p0.x, y: p0.y }
    let z = ballZAt(a, t)
    const holder = holderAt(a.holders, t)
    const carried = holder != null && z < CARRIED_Z
    if (carried) {
      // Carried by a man going to ground: the ball goes down with him — and
      // stays in his arms: his body lies along the fall direction from his
      // feet, so the ball moves with his chest, not left at his feet on the
      // turf beside the pile (animflow r4).
      const ht = this.byKey.get(holder)
      if (ht && ht.poses.length) {
        const i = windowIndex(ht.poses, t)
        this.poseInto(ht.poses, i, t, this.ballPose, 0)
        const fall = this.ballPose.fall
        z = Math.min(z, 1.05 * (1 - 0.72 * fall))
        if (fall > 0.01) {
          const wn = ht.poses[i]
          const fd = POSE_LIBRARY[wn.state]?.fallDir ?? 'none'
          const hd = fd === 'start' ? this.headingAt(ht, wn.t0) : this.headingAt(ht, t)
          p.x += Math.cos(hd) * 0.85 * fall
          p.y += Math.sin(hd) * 0.85 * fall
        }
      }
    }
    const w = offenseToWorld(p.x, p.y, dir)
    return { x: w.x, y: w.y, z, carried, holder }
  }

  private draw(ctx: CanvasRenderingContext2D, cam: Camera, frame: BroadcastFrame, info: LayerInfo): void {
    const t0 = performance.now()
    this.lastDpr = info.dpr
    this.screen.clear()
    const items = this.items
    items.length = 0
    let order = 0
    // Goalposts join the sort at their crossbar.
    for (const [gx, end] of [
      [0, 'left'],
      [FIELD_LENGTH, 'right'],
    ] as const) {
      const p = project(cam, gx, MID_WIDTH, 0)
      if (!p) continue
      // B8: a camera right behind an end line (a play backed up to its own goal
      // line, the replay rig) would put the posts across the whole frame: drop
      // posts this close to the lens.
      if (Math.hypot(cam.px - gx, cam.py - MID_WIDTH) < POST_NEAR_YD) continue
      items.push({ kind: 'post', key: end, depth: p.depth, order: order++, draw: (g) => drawGoalposts(g, cam, end) })
    }
    const play = this.play
    if (!play) {
      this.paint(ctx, items)
      this.stats = { ms: performance.now() - t0, figures: 0, drawn: 0, spriteHits: 0, spriteMisses: 0, spriteEntries: this.sprites.stats.entries }
      return
    }
    const dir = frame.direction
    const t = clamp01(this.t)
    const seconds = t * this.D
    const holder = holderAt(play.anim.holders, t)
    const W = info.width
    const H = info.height
    const figs = this.figs
    figs.length = 0
    const sp = this.useSprites && this.sprites.ready ? this.sprites : null
    sp?.beginFrame()
    const h0 = this.sprites.stats.hits
    const m0 = this.sprites.stats.misses
    const opts = this.opts
    opts.dpr = info.dpr
    opts.font = this.sprites.font
    opts.sprites = sp
    opts.time = seconds
    let drawn = 0
    for (const tr of this.tracks) {
      const s = this.sample(tr, t)
      const f = tr.fig
      const w = offenseToWorld(s.x, s.y, dir)
      f.x = w.x
      f.y = w.y
      f.speed = s.v
      f.phase = s.ph
      f.heading = dir === 1 ? s.hd : s.hd + Math.PI
      const st = this.poseFor(tr, t, f)
      if (f.fallDir != null && dir === -1) f.fallDir += Math.PI
      figs.push(f)
      const scr = figureScreen(cam, f.x, f.y)
      tr.scr = null
      if (!scr || scr.h < 2) continue
      // Cull off-screen (generous: lying figures reach sideways).
      if (scr.x + scr.h < 0 || scr.x - scr.h > W || scr.y - scr.h > H || scr.y + scr.h * 0.3 < 0) continue
      tr.scr = scr
      const head = figureHead(cam, f, scr, seconds)
      this.screen.set(tr.key, {
        key: tr.key,
        side: tr.side,
        role: tr.role,
        x: scr.x,
        y: scr.y,
        headX: head.x,
        headY: head.y,
        top: head.y - HELMET_R * scr.h,
        depth: scr.depth,
        scale: scr.h,
        pose: st,
        holder: holder === tr.key,
      })
      items.push({
        kind: 'fig',
        key: tr.key,
        depth: scr.depth,
        order: 100 + tr.order,
        draw: (g) => {
          drawFigure(g, cam, f, scr, opts)
          drawn++
        },
      })
    }
    // The ball: one rule for the placeholder and B4 (clamped height; carried →
    // just in front of its carrier, else its own ground point).
    const bc = this.ballCore(t, dir)
    const bp = project(cam, bc.x, bc.y, 0)
    const hs = bc.carried && bc.holder ? this.screen.get(bc.holder) : undefined
    const ball: BallState = { x: bc.x, y: bc.y, z: bc.z, carried: bc.carried, depth: hs ? hs.depth - 0.05 : bp ? bp.depth : -Infinity }
    // Scene for hooks.
    const scene: Scene = {
      ctx,
      cam,
      frame,
      info,
      anim: play.anim,
      t,
      seconds,
      direction: dir,
      toWorld: (x, y) => offenseToWorld(x, y, dir),
      ball,
      ballWorld: (tt) => this.ballAt(tt, dir),
      holder,
      screenOf: (k) => this.screen.get(k),
    }
    // Shadows on the turf, under everything.
    drawShadows(ctx, cam, figs)
    if (this.drawBall) drawBallShadow(ctx, cam, ball)
    this.ground?.(scene)
    if (this.drawBall && bp) items.push({ kind: 'ball', key: 'ball', depth: ball.depth, order: 1000, draw: (g) => drawBallPlaceholder(g, cam, ball, info.dpr) })
    if (this.addItems) {
      const extra: SceneItem[] = []
      this.addItems(scene, extra)
      let k = 0
      for (const e of extra) items.push({ kind: 'extra', key: `extra${k++}`, depth: e.depth, order: 2000 + e.order, draw: (g) => e.draw(g) })
    }
    if (this.people) {
      const extra: SceneItem[] = []
      this.people(scene, extra)
      for (const e of extra) items.push({ kind: 'extra', key: 'people', depth: e.depth, order: 3000 + e.order, draw: (g) => e.draw(g) })
    }
    this.paint(ctx, items)
    this.stats = {
      ms: performance.now() - t0,
      figures: this.tracks.length,
      drawn,
      spriteHits: this.sprites.stats.hits - h0,
      spriteMisses: this.sprites.stats.misses - m0,
      spriteEntries: this.sprites.stats.entries,
    }
  }

  /** Sort far → near and draw (recording the order when tracing). */
  private paint(ctx: CanvasRenderingContext2D, items: Item[]): void {
    depthSort(items)
    if (this.trace) {
      this.lastOrder.length = 0
      for (const it of items) this.lastOrder.push({ kind: it.kind, key: it.key, depth: it.depth })
    }
    for (const it of items) {
      ctx.save()
      it.draw(ctx)
      ctx.restore()
    }
  }
}

// ── ball placeholder (B4 replaces) ───────────────────────────────────────────

function drawBallShadow(g: CanvasRenderingContext2D, c: Camera, b: { x: number; y: number; z: number }): void {
  const p = project(c, b.x - 0.55 * b.z * 0.12, b.y - 0.6 * b.z * 0.12, 0)
  if (!p) return
  const k = c.focal / p.depth
  const squash = Math.max(0.12, Math.min(1, c.pz / Math.hypot(b.x - c.px, b.y - c.py, c.pz)))
  g.beginPath()
  g.ellipse(p.x, p.y, (0.2 + b.z * 0.03) * k, (0.13 + b.z * 0.02) * k * squash, 0, 0, TAU)
  g.globalAlpha = Math.max(0.18, Math.min(0.5, 0.5 - b.z * 0.05))
  g.fillStyle = FIG_ART.contact
  g.fill()
  g.globalAlpha = 1
}

function drawBallPlaceholder(g: CanvasRenderingContext2D, c: Camera, b: { x: number; y: number; z: number }, dpr: number): void {
  const p = project(c, b.x, b.y, b.z)
  if (!p) return
  const k = c.focal / p.depth
  const len = Math.max(4 * dpr, 0.34 * k)
  const wid = len * 0.6
  g.translate(p.x, p.y)
  g.rotate(-0.35)
  const gr = g.createLinearGradient(0, -wid / 2, 0, wid / 2)
  gr.addColorStop(0, FIG_ART.ballLight)
  gr.addColorStop(0.5, FIG_ART.ballMid)
  gr.addColorStop(1, FIG_ART.ballDark)
  g.beginPath()
  g.ellipse(0, 0, len / 2, wid / 2, 0, 0, TAU)
  g.fillStyle = gr
  g.fill()
  g.lineWidth = Math.max(1, len * 0.07)
  g.strokeStyle = FIG_ART.outline
  g.stroke()
  g.strokeStyle = FIG_ART.lace
  g.lineWidth = Math.max(0.8, len * 0.06)
  g.beginPath()
  g.moveTo(-len * 0.16, -wid * 0.12)
  g.lineTo(len * 0.16, -wid * 0.12)
  g.stroke()
}

// ─────────────────────────────────────────────────────────────────────────────
// Play animation for the game-day field.
//
// Turns one simulated play into keyframed paths for all 22 players and the
// ball. It is purely visual: every position and every timing is derived from
// the play's recorded result, and the *motion* of each dot follows that real
// player's ratings (L12.10 B5) — speed and acceleration set his pace, route
// running sharpens his breaks, pass rush gets him home, and so on. Nothing
// here feeds back into the sim: the end spot, catch spot, yards and outcome
// are exactly what the sim recorded; ratings only change how a player gets
// there. Everything is deterministic (stable per-play hash, never rng).
//
// animflow: nobody stands still mid-play. Runs play out on the live field
// (playLive.ts: engaged pairs drawn touching that keep driving, combo double
// teams that climb, stalk blocks, read-and-pursue defenders); pass protection
// is a live pocket (pocketPair); a carry ends with the tackler meeting the
// carrier short of the recorded spot and the pile going forward to it.
//
// Coordinates are in the offense's frame: its own goal line at x = 10, attacking
// toward x = 110; y runs 0..53.3 across the field. MatchView mirrors the frame
// when the away club has the ball.
// ─────────────────────────────────────────────────────────────────────────────

import type { Play } from '../game/engine/playsim'
import type { Player } from '../game/types'
import { styleProfile } from '../game/engine/style'
import { ROUTES, type RouteDef, type WP } from '../game/data/routes'
import { formationForConcept, formationHasFullback, playbookPlay, treeFor } from '../game/data/playbookData'
import { kickFlight, presentAnim, throwHand, THROW_TIMING, type BroadcastAnim, type ThrowStyle } from './broadcast/animData'
import { LiveField, pursue, phases, holdSpot, livePos, type Brain, type PairPlan } from './playLive'
import { runReturnField, returnLine, returnScheme } from './playReturn.ts'
import { carrierMove, effAttrs, effRating, fatigueMap, fatiguePace } from './animRatings'
import { planOf } from './jersey'

export const FIELD_W = 120
export const FIELD_H = 53.3
export const MID_Y = 26.65

export type { WP, RouteDef }

export interface Actor {
  key: string
  side: 'off' | 'def'
  role: string
  path: WP[]
}

export interface PlayAnim {
  /** Milliseconds at 1× speed. */
  duration: number
  actors: Actor[]
  /** The ball's path. Where it's carried, it shadows the carrier's path. */
  ball: WP[]
  /** Who holds the ball over time (actor key), for the carrier highlight. */
  holders: { t: number; key: string | null }[]
  /** Ball flights (throws, kicks): the ball is drawn lifted between t0 and t1. */
  flights: { t0: number; t1: number; height: number }[]
  /** A penalty flag thrown at (x, y) from time t. */
  flag?: { t: number; x: number; y: number }
  /** Goalposts to draw, for kicks. */
  posts?: boolean
  /** Recorded blocking / tackling engagements (B1). Times 0..1 like paths. */
  engagements?: Engagement[]
  /** Recorded beats of the play, in time order (B1). */
  events?: AnimEvent[]
  /** A field goal / PAT ball's height (yd) over its flight, times 0..1 (animflow r4). */
  kickZ?: { t: number; z: number }[]
  /** How the quarterback throws (animflow round 3; passes only). */
  throwStyle?: ThrowStyle
  /** animflow r6c: a defender beating his block (the move, his blocker(s), the window). Times 0..1. */
  sheds?: Shed[]
  /** animflow r6c2 (302): the route the pass target runs (the catch is in stride unless it is a stop route). */
  catchRoute?: string
}

/**
 * animflow r6c: how a defender gets off a block. Pass rush: speed (dip and rip
 * round the edge), bull (drive the man back, then shed him), swim (arm over,
 * inside), spin. Run: rip (rip off and close).
 */
export type ShedMove = 'speed' | 'bull' | 'swim' | 'spin' | 'rip'

/** animflow r6c: one shed. `def` beats `blk` between t0 (the move starts) and t1 (clear of him). */
export interface Shed {
  def: string
  blk: string[]
  t0: number
  t1: number
  move: ShedMove
}

export interface AnimContext {
  /** The next play, used to place returns where the next possession really started. */
  next?: Play
  /** Position of the targeted receiver (WR / TE / RB), when known. */
  targetPos?: string
  /** True when the ball carrier on a run was the quarterback. */
  carrierIsQB?: boolean
  /** The real player each animation key (qb, rb, wr0…, s1) stands for. */
  actors?: Map<string, Player>
  /** animflow r6b: in-game fatigue at the snap per player id (from Play.fatOn). */
  fat?: Map<string, number>
}

// ── recorded engagements and events (B1) ─────────────────────────────────────
// The builders already know every block, tackle and beat of a play. These record
// that knowledge alongside the motion — for the Broadcast 2.5D view — without
// changing a single waypoint, time or recorded result. Everything is derived from
// data the builder already computes, so it stays deterministic.

export type EngageKind = 'block' | 'double' | 'chip' | 'missedTackle' | 'tackle'

/** a = the man acting (blocker / tackler / missed tackler), b = the man blocked or tackled. Times 0..1 like paths. */
export interface Engagement {
  a: string
  b: string
  t0: number
  t1: number
  kind: EngageKind
}

export type AnimEventKind =
  | 'snap' | 'playAction' | 'scramble' | 'break' | 'throw' | 'catch' | 'incomplete' | 'interception'
  | 'brokenTackle' | 'contact' | 'tackle' | 'sack' | 'outOfBounds' | 'down' | 'firstDown' | 'score'
  | 'safety' | 'turnover' | 'fumble' | 'kick' | 'fairCatch' | 'touchback' | 'kickGood' | 'kickMiss' | 'flag'

export interface AnimEvent {
  t: number
  kind: AnimEventKind
  keys: string[]
  spot: { x: number; y: number }
}

/** The man-and-window a builder plans, in seconds; finish() trims it to real contact. */
interface RecEng {
  a: string
  b: string
  t0: number
  t1: number
  kind: EngageKind
}

/** One play's recording. Filled in seconds by a builder, consumed and released by finish(). */
let REC: { eng: RecEng[]; ev: AnimEvent[]; shed: Shed[] } | null = null

/** Pre-snap fouls throw no snap (false start / offside / delay of game). */
const PRE_SNAP_PENALTY = new Set(['falseStart', 'offside', 'delay'])

/** Which kinds close a play: exactly one of these ends every anim, in time order. */
const TERMINAL_EVENT = new Set<AnimEventKind>(['tackle', 'sack', 'outOfBounds', 'down', 'score', 'incomplete', 'safety', 'kickGood', 'kickMiss', 'touchback', 'fairCatch'])

/** Begin recording for one play (the first line of every builder). */
function recStart(): void {
  REC = { eng: [], ev: [], shed: [] }
}

/** animflow r6c: record a shed (seconds); finish() normalises it. */
function recShed(def: string, blk: string[], t0: number, t1: number, move: ShedMove): void {
  if (REC && t1 > t0 && Number.isFinite(t0) && Number.isFinite(t1) && blk.length) REC.shed.push({ def, blk: blk.slice(), t0, t1, move })
}

/** Plan an engagement in seconds; finish() trims it to the span the two men are in contact. */
function recEng(a: string, b: string, t0: number, t1: number, kind: EngageKind): void {
  if (REC && t1 > t0 && Number.isFinite(t0) && Number.isFinite(t1)) REC.eng.push({ a, b, t0, t1, kind })
}

/** Record one beat of the play at `t` (seconds); finish() normalises it like the paths. */
function recEv(t: number, kind: AnimEventKind, keys: string[], spot: Pt): void {
  if (REC && Number.isFinite(t) && Number.isFinite(spot.x) && Number.isFinite(spot.y)) {
    REC.ev.push({ t, kind, keys: keys.slice(), spot: { x: spot.x, y: spot.y } })
  }
}

/** The dot key a recorded player id stands for, within `pool`. */
function keyOf(ctx: AnimContext, id: string | undefined, pool: string[]): string | undefined {
  if (!id) return undefined
  for (const k of pool) if (ctx.actors?.get(k)?.id === id) return k
  return undefined
}

/** The scrimmage snap: the ball leaves the centre's spot for the quarterback. */
function recSnap(los: number): void {
  recEv(SNAP, 'snap', ['ol2', 'qb'], { x: los, y: MID_Y })
}

/** The first time in [from, to] one of `defKeys` is within `thr` yards of the carrier. */
function firstContact(
  m: Record<string, Mover>,
  defKeys: string[],
  carrierKey: string,
  from: number,
  to: number,
  thr = 1.0,
  busy?: (k: string, t: number) => boolean,
): { t: number; key: string } | null {
  if (to <= from) return null
  const steps = Math.max(1, Math.ceil((to - from) / 0.02))
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps
    const cp = posAt(m[carrierKey].path, t)
    let best = ''
    let bd = Infinity
    for (const k of defKeys) {
      if (k === carrierKey || !m[k] || busy?.(k, t)) continue
      const p = posAt(m[k].path, t)
      const d = Math.hypot(p.x - cp.x, p.y - cp.y)
      if (d < bd) {
        bd = d
        best = k
      }
    }
    if (best && bd <= thr) return { t, key: best }
  }
  return null
}

/** The first time in [from, to] the mover crosses x (dir +1 rising, −1 falling). */
function crossX(mv: Mover, x: number, from: number, to: number, dir: 1 | -1): number | null {
  if (to <= from) return null
  const steps = Math.max(1, Math.ceil((to - from) / 0.02))
  let prev = posAt(mv.path, from).x
  for (let i = 1; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps
    const cx = posAt(mv.path, t).x
    if (dir > 0 ? prev < x && cx >= x : prev > x && cx <= x) return t
    prev = cx
  }
  return null
}

/** The first time in [from, to] the mover's y departs from `y` by more than `d`. */
function firstDeviation(mv: Mover, y: number, d: number, from: number, to: number): number | null {
  if (to <= from) return null
  const steps = Math.max(1, Math.ceil((to - from) / 0.02))
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps
    if (Math.abs(posAt(mv.path, t).y - y) > d) return t
  }
  return null
}

/** The time in [from, to] the mover is closest to `pt`. */
function timeNearest(mv: Mover, pt: Pt, from: number, to: number): number {
  if (to <= from) return from
  const steps = Math.max(1, Math.ceil((to - from) / 0.02))
  let best = from
  let bd = Infinity
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps
    const p = posAt(mv.path, t)
    const d = Math.hypot(p.x - pt.x, p.y - pt.y)
    if (d < bd) {
      bd = d
      best = t
    }
  }
  return best
}

/** R5: each defender who missed a tackle is a stumble and a missedTackle engagement. */
function recMissedTackles(
  play: Play,
  ctx: AnimContext,
  carrierKey: string,
  from: number,
  to: number,
  m: Record<string, Mover>,
  pool: string[],
): void {
  const ids = play.missedTackleIds ?? []
  if (!ids.length || to <= from) return
  ids.forEach((id, i) => {
    const dk = keyOf(ctx, id, pool)
    if (!dk || dk === carrierKey) return
    const t = clampN(from + (to - from) * (0.62 + i * 0.08), from, to)
    recEv(t, 'brokenTackle', [carrierKey, dk], posAt(m[carrierKey].path, t))
    recEng(dk, carrierKey, Math.max(0, t - 0.18), t + 0.06, 'missedTackle')
  })
}

/**
 * The close of a carry / return: first contact, the first-down or goal line, the
 * tackling engagements (the recorded tackler and any gang tackle) and the single
 * terminal event. `opts.from` is when the carrier really has the ball.
 */
/** animflow r8: warp a tackler's last strides so he ends a body's width off the carrier at `endSec`. */
function closeOnCarrier(tk: Mover, endPos: Pt, endSec: number): void {
  const q = posAt(tk.path, endSec)
  const d = Math.hypot(q.x - endPos.x, q.y - endPos.y)
  if (d <= 1.0) return
  const ux = (q.x - endPos.x) / d
  const uy = (q.y - endPos.y) / d
  const dx = endPos.x + ux * 0.75 - q.x
  const dy = endPos.y + uy * 0.75 - q.y
  const w = clampN(d / 4, 0.35, 1.1)
  const t0 = Math.max(0, endSec - w)
  const src: WP[] = tk.path.slice()
  const lastSrc = src[src.length - 1]
  if (lastSrc.t < endSec) src.push({ t: endSec, x: lastSrc.x, y: lastSrc.y })
  const base = src.slice()
  const knots = new Set(base.map((p) => p.t))
  // knots through the warp window so it is a smooth ease, not one long straight jump
  for (let t = t0 + 0.05; t < endSec; t += 0.05) if (!knots.has(t)) src.push({ t, ...posAt(base, t) })
  if (!knots.has(endSec)) src.push({ t: endSec, ...posAt(base, endSec) })
  src.sort((a, b) => a.t - b.t)
  const out: WP[] = src.filter((p) => p.t < t0)
  out.push({ t: t0, ...posAt(base, t0) })
  for (const p of src) {
    if (p.t <= t0) continue
    const u = clampN((p.t - t0) / Math.max(1e-6, endSec - t0), 0, 1)
    const e = u * u * (3 - 2 * u)
    out.push({ t: p.t, x: clampX(p.x + dx * e), y: clampY(p.y + dy * e) })
  }
  tk.path = out
  const last = out[out.length - 1]
  tk.x = last.x
  tk.y = last.y
  tk.t = last.t
}

function recClose(
  m: Record<string, Mover>,
  carrierKey: string,
  tackler: string,
  endSec: number,
  defenders: string[],
  opts: {
    play?: Play
    los?: number
    from?: number
    td?: boolean
    tdX?: number
    tdDir?: 1 | -1
    safety?: boolean
    outOfBounds?: boolean
  },
): void {
  const carrier = m[carrierKey]
  if (!carrier || !(endSec > 0)) return
  const from = Math.max(0.05, Math.min(opts.from ?? 0.2, endSec))
  const endPos = posAt(carrier.path, endSec)
  // animflow r8: a tackle is never the carrier stopping alone, on any sim stream - when the
  // tackler's own chase leaves him short at the whistle, his last strides close the gap (a lunge
  // into the carrier from the side he came from). Results / spot / credited man unchanged.
  if (!opts.td && !opts.outOfBounds && m[tackler] && tackler !== carrierKey) closeOnCarrier(m[tackler], endPos, endSec)
  // A man still locked up on a block who brushes the carrier as he goes by is
  // not the first contact (animflow): only free defenders count.
  const blocks = (REC?.eng ?? []).filter((e) => e.kind === 'block' || e.kind === 'double' || e.kind === 'chip')
  const busy = (k: string, t: number) => blocks.some((e) => (e.a === k || e.b === k) && t >= e.t0 && t <= e.t1)
  const contact = firstContact(m, defenders, carrierKey, from, endSec, 1.0, busy)
  if (contact && contact.t < endSec - 0.02) recEv(contact.t, 'contact', [carrierKey, contact.key], posAt(carrier.path, contact.t))
  const play = opts.play
  if (play && !opts.td && !opts.safety && play.distance != null && opts.los != null && play.endYard - play.startYard >= play.distance) {
    const tx = opts.los + play.distance
    const t = crossX(carrier, tx, from, endSec, 1)
    if (t != null) recEv(t, 'firstDown', [carrierKey], { x: tx, y: posAt(carrier.path, t).y })
  }
  recEng(tackler, carrierKey, Math.max(0, endSec - 0.5), endSec + 0.05, 'tackle')
  for (const k of defenders) {
    if (k === tackler || k === carrierKey || !m[k]) continue
    const p = posAt(m[k].path, endSec)
    if (Math.hypot(p.x - endPos.x, p.y - endPos.y) <= 1.2) recEng(k, carrierKey, Math.max(0, endSec - 0.35), endSec + 0.05, 'tackle')
  }
  if (opts.td && opts.tdX != null) {
    const t = crossX(carrier, opts.tdX, from, endSec, opts.tdDir ?? 1) ?? endSec
    recEv(t, 'score', [carrierKey], posAt(carrier.path, t))
  } else if (opts.safety) {
    recEv(endSec, 'safety', [tackler, carrierKey], endPos)
  } else if (opts.outOfBounds) {
    recEv(endSec, 'outOfBounds', [carrierKey], endPos)
  } else {
    recEv(endSec, 'tackle', [tackler, carrierKey], endPos)
  }
}

/** How far apart the two men of an engagement may stand and still count as in contact. */
const ENGAGE_LIMIT: Record<EngageKind, number> = {
  block: 1.3, // engaged pairs are drawn touching (~0.9 yd, playLive PAIR_GAP)
  double: 1.45,
  chip: 1.6,
  missedTackle: 1.2,
  tackle: 1.2,
}

/** Trim one planned engagement to the span where the two settled paths are in contact. */
function trimEngagements(rec: RecEng[], movers: Record<string, Mover>, frac: (t: number) => number, maxT: number): Engagement[] {
  const step = 0.02
  const out: Engagement[] = []
  for (const e of rec) {
    const a = movers[e.a]
    const b = movers[e.b]
    if (!a || !b) continue
    const thr = ENGAGE_LIMIT[e.kind]
    const lo = Math.max(0, e.t0)
    const hi = Math.min(e.t1, maxT)
    if (!(hi > lo)) continue
    const n = Math.max(1, Math.ceil((hi - lo) / step))
    const at = (i: number) => (i >= n ? hi : lo + i * step)
    const close: boolean[] = []
    for (let i = 0; i <= n; i++) {
      const t = at(i)
      const pa = posAt(a.path, t)
      const pb = posAt(b.path, t)
      close.push(Math.hypot(pa.x - pb.x, pa.y - pb.y) <= thr)
    }
    let s = -1
    let bestS = -1
    let bestE = -1
    let bestLen = 0
    for (let i = 0; i <= n; i++) {
      if (close[i]) {
        if (s < 0) s = i
        const len = at(i) - at(s)
        if (len > bestLen) {
          bestLen = len
          bestS = at(s)
          bestE = at(i)
        }
      } else s = -1
    }
    // A tackle ends on the recorded tackle: keep the contact window running into
    // that beat (the tackler is on the carrier when the whistle goes), so the
    // window stays a real contact rather than a fixed tail that never touches.
    if (e.kind === 'tackle' && close[n]) {
      let k = n
      while (k >= 0 && close[k]) k--
      bestS = at(k + 1)
      bestE = hi
      bestLen = bestE - bestS
    }
    if (bestS < 0 || bestLen < (e.kind === 'tackle' ? 0.02 : 0.08)) continue
    let t0 = frac(bestS)
    let t1 = frac(bestE)
    if (!(t1 > t0)) {
      t0 = clampN(t0, 0, 1 - 1e-4)
      t1 = Math.min(1, t0 + 1e-4)
    }
    if (!(t1 > t0)) continue
    out.push({ a: e.a, b: e.b, t0, t1, kind: e.kind })
  }
  return out
}

/** Release the recorded events: normalise by the same frac, then sort by time. */
function takeEvents(rec: AnimEvent[], frac: (t: number) => number): AnimEvent[] {
  const out = rec.map((e) => ({ t: frac(e.t), kind: e.kind, keys: e.keys, spot: e.spot }))
  // The terminal event is the last beat of the play; nothing is recorded after it.
  let termT = 0
  for (const e of out) if (TERMINAL_EVENT.has(e.kind)) termT = Math.max(termT, e.t)
  for (const e of out) if (!TERMINAL_EVENT.has(e.kind) && e.t > termT) e.t = termT
  out.sort((x, y) => x.t - y.t || (TERMINAL_EVENT.has(x.kind) ? 1 : 0) - (TERMINAL_EVENT.has(y.kind) ? 1 : 0))
  return out
}

// ── helpers ──────────────────────────────────────────────────────────────────
function hash(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const clampY = (y: number) => clampN(y, 1.2, FIELD_H - 1.2)
const clampX = (x: number) => clampN(x, 1, FIELD_W - 1)
/** animflow r6c2: one time step, kept on the field without snapping a man who starts outside the clamp (a deep safety behind the end line) back in a frame. */
const stepIn = (p: Pt, v: Pt, dt: number): Pt => {
  const x = p.x + v.x * dt
  const y = p.y + v.y * dt
  return { x: clampN(x, Math.min(1, p.x), Math.max(FIELD_W - 1, p.x)), y: clampN(y, Math.min(1.2, p.y), Math.max(FIELD_H - 1.2, p.y)) }
}
/** The snap beat: the ball leaves the LOS for the QB. */
const SNAP = 0.14

export interface Pt {
  x: number
  y: number
}

/**
 * Position along a keyframed path at time t (0..1 in the finished animation).
 * Between waypoints the actor moves at constant speed; the sampled knots carry
 * the speed profile, so no easing flags are needed.
 */
export function posAt(path: WP[], t: number): { x: number; y: number } {
  if (!path.length) return { x: 0, y: 0 }
  if (t <= path[0].t) return { x: path[0].x, y: path[0].y }
  for (let i = 1; i < path.length; i++) {
    const b = path[i]
    if (t <= b.t) {
      const a = path[i - 1]
      const span = b.t - a.t
      const u = span <= 0 ? 1 : (t - a.t) / span
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
    }
  }
  const last = path[path.length - 1]
  return { x: last.x, y: last.y }
}

/** The ball's lift (0..1) at time t, for drawing it in the air. */
export function liftAt(anim: PlayAnim, t: number): number {
  // A field goal / PAT: its real height (animflow r4), so the top-down ball is
  // still high as it crosses the crossbar instead of sinking to the turf.
  const kz = anim.kickZ
  if (kz && kz.length && t > kz[0].t && t < kz[kz.length - 1].t) {
    let i = 1
    while (i < kz.length - 1 && kz[i].t < t) i++
    const a = kz[i - 1]
    const b = kz[i]
    const z = a.z + (b.z - a.z) * ((t - a.t) / Math.max(1e-9, b.t - a.t))
    return Math.max(0, z - 0.15) / 8
  }
  for (const f of anim.flights) {
    if (t > f.t0 && t < f.t1) return Math.sin(Math.PI * ((t - f.t0) / (f.t1 - f.t0))) * f.height
  }
  return 0
}

/**
 * Top-down view of the QB's throw (animflow round 3): the throwing arm (from the
 * shoulder to the hand) and the off arm, in the offense frame, through the same
 * wind-up / release / follow-through as the 2.5D figure (THROW_TIMING), and
 * where the ball is drawn: in the hand until the release, then easing onto its
 * flight in the first 0.12 s. Null outside the throw.
 */
export function qbThrowAt(anim: PlayAnim, t: number): {
  shoulder: Pt; hand: Pt; off: Pt | null; offShoulder: Pt; ball: Pt | null; ballMix: number
} | null {
  const style = anim.throwStyle
  const f = anim.flights[0]
  const qb = anim.actors.find((a) => a.key === 'qb')
  if (!style || !f || !qb) return null
  const D = Math.max(0.05, anim.duration / 1000)
  const T = THROW_TIMING[style]
  const age = (t - f.t0) * D + T.wind
  if (age < 0 || age > T.wind + T.follow) return null
  const sm = (u: number) => { const v = u < 0 ? 0 : u > 1 ? 1 : u; return v * v * (3 - 2 * v) }
  const cock = sm(age / (T.wind * 0.75))
  const rel = sm((age - (T.wind - 0.07)) / 0.13)
  const thf = sm((age - (T.wind + 0.04)) / Math.max(0.1, T.follow - 0.1))
  const oa = sm(age / (T.wind * 0.6)) * (1 - thf)
  const q = posAt(qb.path, t)
  const c = posAt(anim.ball, f.t1)
  const l = Math.hypot(c.x - q.x, c.y - q.y) || 1
  const u = { x: (c.x - q.x) / l, y: (c.y - q.y) / l }
  const n = { x: u.y, y: -u.x } // throwing side
  const at = (a: number, b: number): Pt => ({ x: q.x + u.x * a + n.x * b, y: q.y + u.y * a + n.y * b })
  const quick = style === 'quick' || style === 'hurry' ? 0.75 : 1
  const lerpN = (a: number, b: number, k: number) => a + (b - a) * k
  // along / across: carry → ear (back and out) → over the top → across the body
  let fa = lerpN(0.7, -1.2 * quick, cock)
  let fb = lerpN(0.5, 1.3, cock)
  fa = lerpN(fa, 2.5 * quick, rel)
  fb = lerpN(fb, style === 'quick' ? 1.1 : 0.5, rel)
  fa = lerpN(fa, 1.3, thf)
  fb = lerpN(fb, -1.5, thf)
  const hand = at(fa, fb)
  const off = oa > 0.05 ? at(lerpN(0.4, 2.3, oa), lerpN(-0.6, -0.5, oa)) : null
  const tRel = f.t0
  const mix = t <= tRel ? 1 : Math.max(0, 1 - ((t - tRel) * D) / 0.12)
  return { shoulder: at(0, 0.9), hand, off, offShoulder: at(0, -0.9), ball: mix > 0 ? hand : null, ballMix: mix }
}

export function holderAt(anim: PlayAnim, t: number): string | null {
  let key: string | null = null
  for (const h of anim.holders) if (t >= h.t) key = h.key
  return key
}

/** Follow another path from time `from` on. */
function shadow(path: WP[], from: number, to?: number): WP[] {
  const t0 = path.length ? path[0].t : 0
  const t1 = path.length ? path[path.length - 1].t : 0
  const a = clampN(from, t0, t1)
  const b = clampN(to ?? t1, a, t1)
  if (b <= a) {
    const p = posAt(path, a)
    return [{ t: a, x: p.x, y: p.y }]
  }
  const out: WP[] = [{ t: a, ...posAt(path, a) }]
  for (const w of path) if (w.t > a && w.t < b) out.push({ ...w })
  out.push({ t: b, ...posAt(path, b) })
  return out
}

/** Keep one waypoint per time, then sort. Prevents zero-span jumps in posAt. */
function compact(path: WP[]): void {
  const seen = new Map<number, WP>()
  for (const w of path) seen.set(Math.round(w.t * 1e6), w)
  const keep = [...seen.values()].sort((a, b) => a.t - b.t)
  path.length = 0
  for (const w of keep) path.push(w)
}

// ── ratings → pace ───────────────────────────────────────────────────────────
/** Read an attribute, falling back to overall (league average when no player). */
export function attrOf(p: Player | undefined, key: string, fallback = 70): number {
  if (!p) return fallback
  // animflow r6b: the sim's effective rating (playerAttrs), not the raw attrs.
  const v = effAttrs(p)[key]
  if (typeof v === 'number') return v
  return typeof p.ovr === 'number' ? p.ovr : fallback
}

export interface Pace {
  /** Top speed in yards per second. */
  top: number
  /** Acceleration in yards per second squared. */
  acc: number
}

/**
 * animflow r6a: real acceleration caps (yd/s²), the BDB p95 of speed gain per
 * position with the game harness's own definition (positions smoothed over
 * 0.3 s, d(speed)/dt over 0.2 s, > 0.5): BDB 2021 wk1-3 (2018 pass plays)
 * WR/TE 6.03 (n 269k), RB 5.31, DB 4.56, LB 5.22, QB 4.16; BDB 2023 wk1-2 OL
 * 3.58 (n 164k), DL 4.82. (Round 5's "NFL" caps came from a different, heavily
 * smoothed definition and were ~1.5x too low.)
 */
const ACC_CAP: Record<string, number> = {
  OL: 3.6, K: 3.4, P: 3.4, QB: 4.2, RB: 5.3, FB: 5.0, WR: 6.0, SLOT: 6.0, TE: 5.4, DL: 4.8, LB: 5.2, CB: 4.6, S: 4.6,
}
const ACC_CAP_K = 1
// animflow r8: NFL tracking play-max bands (yd/s): WR / CB ~8-9.5 (the fastest ~10), RB ~9-9.8,
// S ~8.5-9.5, LB / TE ~7.5-9, DL ~7-8.5, OL ~5.5-6.8.
const ROLE_CAP: Record<string, number> = {
  OL: 6.8, K: 7.0, P: 7.0, QB: 9.4, RB: 9.9, FB: 8.2,
  WR: 10.2, SLOT: 10.2, TE: 9.0, DL: 8.6, LB: 9.2, CB: 10.0, S: 9.8,
}

/**
 * Top speed from SPD (`5.6 + (SPD − 60) × 0.085`: 99 ≈ 8.9, 70 ≈ 6.5) and
 * acceleration from ACC (0.45 s to top at 99 … 1.1 s at 60).
 */
export function paceFor(p: Player | undefined, role = ''): Pace {
  const spd = attrOf(p, 'SPD')
  const acc = attrOf(p, 'ACC')
  const cap = ROLE_CAP[role] ?? 9.6
  // animflow r8: 6.6 + (SPD - 60) x 0.088: 99 ~ 10.0, 90 ~ 9.2, 80 ~ 8.4, 70 ~ 7.5 yd/s (was 5.6 + ...
  // x 0.085: a 70-speed man topped out at 6.5 yd/s, 13 mph - a jog for an NFL skill player).
  const top = clampN(6.6 + (spd - 60) * 0.088, 3.4, cap)
  const ramp = clampN(1.1 - (acc - 60) * (0.65 / 39), 0.45, 1.1)
  // animflow r5: real acceleration caps (NFL tracking p95 ~2.3-3.9 yd/s²; the
  // caps sit a little above, ACC still orders players under them).
  const capA = (ACC_CAP[role] ?? 4.2) * ACC_CAP_K
  return { top, acc: Math.min(top / ramp, capA * (0.85 + 0.15 * clampN((acc - 60) / 39, 0, 1))) }
}

/** Speed-profiled, distance-timed motion along a polyline (times in seconds). */
function baseLine(pts: Pt[], pace: Pace, opts: { v0?: number; stop?: boolean; vEnd?: number } = {}) {
  const out: { t: number; x: number; y: number }[] = []
  if (!pts.length) return out
  out.push({ t: 0, x: pts[0].x, y: pts[0].y })
  if (pts.length < 2) return out
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  const L = cum[cum.length - 1]
  if (L < 1e-6) return out
  const v0 = Math.max(0, opts.v0 ?? 0)
  const stop = !!opts.stop
  const floor = 0.7
  const acc = Math.max(0.5, pace.acc)
  const vEnd = opts.vEnd
  // animflow r8 (user: "slow at the very start"): a tapered launch - the drive steps accelerate
  // hardest (~1.2x the man's rate) and it fades as he nears top speed (~0.5x), as in NFL tracking
  // (skill players ~60-70% of top in ~1 s, ~90% by ~2 s), instead of one flat rate. ACC still
  // orders players (it scales the whole curve).
  const H = 0.05
  const nH = Math.min(4000, Math.ceil(L / H) + 2)
  const accV = new Float64Array(nH + 1)
  accV[0] = v0
  for (let i = 1; i <= nH; i++) {
    const v = accV[i - 1]
    const ai = acc * Math.max(0.35, LAUNCH_HI - LAUNCH_FADE * Math.min(1, v / Math.max(0.1, pace.top)))
    accV[i] = Math.min(pace.top, Math.sqrt(v * v + 2 * ai * H))
  }
  const launch = (s: number) => {
    const f = Math.max(0, s) / H
    const i = Math.min(nH - 1, Math.floor(f))
    return accV[i] + (accV[i + 1] - accV[i]) * Math.min(1, f - i)
  }
  const speedAt = (s: number) => {
    const a = Math.min(pace.top, v0 >= pace.top ? v0 : launch(s))
    // animflow r4: brake into a cut and come out of it at vEnd (a cut costs speed).
    if (!stop && vEnd != null) return Math.max(floor, Math.min(a, Math.sqrt(vEnd * vEnd + 2 * acc * Math.max(0, L - s))))
    if (!stop) return Math.max(floor, a)
    const d = Math.sqrt(Math.max(0, 2 * acc * Math.max(0, L - s)))
    return Math.max(floor, Math.min(a, d))
  }
  const steps = Math.max(1, Math.min(700, Math.ceil(L / 0.3)))
  const ds = L / steps
  let t = 0
  for (let i = 1; i <= steps; i++) {
    t += ds / speedAt((i - 0.5) * ds)
    const s = i * ds
    // walk the polyline to arc length s
    let lo = 0
    while (lo < cum.length - 2 && cum[lo + 1] < s) lo++
    const seg = cum[lo + 1] - cum[lo]
    const fr = seg <= 1e-9 ? 0 : (s - cum[lo]) / seg
    out.push({
      t,
      x: pts[lo].x + (pts[lo + 1].x - pts[lo].x) * fr,
      y: pts[lo].y + (pts[lo + 1].y - pts[lo].y) * fr,
    })
  }
  return out
}

/** cos of the turn angle that counts as a plant (≈ 40°). */
const TURN_COS = Math.cos(0.7)
/** animflow r5: share of the cornering speed kept through a cut (0 = the old stop at every corner). */
const CORNER_KEEP = 1

/**
 * Time a polyline at a player's pace, slowing into any sharp change of direction
 * (a route cut, a plant) so the speed never jumps — a real player can't reverse
 * at full speed. Each corner is crossed at a near-stop, then re-accelerated.
 */
function timedLine(pts: Pt[], pace: Pace, opts: { v0?: number; stop?: boolean; vEnd?: number } = {}) {
  if (pts.length < 3) return baseLine(pts, pace, opts)
  const corners: number[] = []
  for (let i = 1; i < pts.length - 1; i++) {
    const ax = pts[i].x - pts[i - 1].x
    const ay = pts[i].y - pts[i - 1].y
    const bx = pts[i + 1].x - pts[i].x
    const by = pts[i + 1].y - pts[i].y
    const la = Math.hypot(ax, ay)
    const lb = Math.hypot(bx, by)
    if (la < 1e-6 || lb < 1e-6) continue
    if ((ax * bx + ay * by) / (la * lb) < TURN_COS) corners.push(i)
  }
  if (!corners.length) return baseLine(pts, pace, opts)
  const out: { t: number; x: number; y: number }[] = []
  let start = 0
  let t0 = 0
  let v0 = Math.max(0, opts.v0 ?? 0)
  for (const c of corners) {
    // animflow r5: brake into a cut to a cornering speed set by the turn (NFL:
    // ~50% of the speed kept through a 45-90 deg cut), not to a dead stop.
    const ax = pts[c].x - pts[c - 1].x
    const ay = pts[c].y - pts[c - 1].y
    const bx = pts[c + 1].x - pts[c].x
    const by = pts[c + 1].y - pts[c].y
    const cos = (ax * bx + ay * by) / Math.max(1e-9, Math.hypot(ax, ay) * Math.hypot(bx, by))
    const vc = pace.top * CORNER_KEEP * clampN(0.2 + 0.25 * (1 + cos), 0, 0.7)
    const k = vc > 0 ? baseLine(pts.slice(start, c + 1), pace, { v0, vEnd: vc }) : baseLine(pts.slice(start, c + 1), pace, { v0, stop: true })
    for (let i = out.length ? 1 : 0; i < k.length; i++) out.push({ t: t0 + k[i].t, x: k[i].x, y: k[i].y })
    t0 += k[k.length - 1].t
    start = c
    v0 = vc
  }
  const k = baseLine(pts.slice(start), pace, { v0, stop: opts.stop, vEnd: opts.vEnd })
  for (let i = 1; i < k.length; i++) out.push({ t: t0 + k[i].t, x: k[i].x, y: k[i].y })
  return out
}

/** One actor's timeline, built in seconds, then normalised by `finish`. */
class Mover {
  key: string
  role: string
  pace: Pace
  player?: Player
  t = 0
  x: number
  y: number
  path: WP[]
  lastStop = true
  /** Heading the mover was carrying when last truncated (for a plant). */
  inHeading?: Pt
  constructor(key: string, role: string, pace: Pace, x: number, y: number, player?: Player) {
    this.key = key
    this.role = role
    this.pace = pace
    this.x = x
    this.y = y
    this.player = player
    this.path = [{ t: 0, x, y }]
  }
  hold(dt: number) {
    if (dt > 0.0001) {
      if (!this.lastStop) settle(this)
      this.t += dt
      this.path.push({ t: this.t, x: this.x, y: this.y })
    }
  }
  /** Move along a polyline (the first point is the *next* waypoint). */
  run(pts: Pt[], opts: { v0?: number; stop?: boolean; vEnd?: number; cut?: boolean } = {}): number {
    this.lastStop = !!opts.stop
    if (!pts.length) return this.t
    let v0 = Math.max(0, opts.v0 ?? 0)
    const inH = this.inHeading
    this.inHeading = undefined
    // Drop leading samples coincident with the mover (e.g. a curve whose first
    // knot sits on the start): a zero-length leg would otherwise read as a
    // sharp corner and spike the speed from full pace to a standstill.
    let skip = 0
    while (skip < pts.length && Math.hypot(pts[skip].x - this.x, pts[skip].y - this.y) < 0.05) skip++
    if (skip) pts = pts.slice(skip)
    if (!pts.length) {
      this.lastStop = !!opts.stop
      return this.t
    }
    // A sharp change of direction across two separate moves is a plant: the
    // player decelerates in his current heading, then re-accelerates. Without
    // it a reversal would traverse the corner at full speed (a speed spike).
    // `cut`: he already braked into this turn (vEnd) and plants on the spot.
    if (v0 > 1 && this.path.length >= 2 && !opts.cut) {
      let hx = 0
      let hy = 0
      if (inH) {
        hx = inH.x
        hy = inH.y
      } else {
        const a = this.path[this.path.length - 2]
        const b = this.path[this.path.length - 1]
        hx = b.x - a.x
        hy = b.y - a.y
      }
      const hl = Math.hypot(hx, hy)
      const nx = pts[0].x - this.x
      const ny = pts[0].y - this.y
      const nl = Math.hypot(nx, ny)
      if (hl > 1e-6 && nl > 1e-6 && (hx * nx + hy * ny) / (hl * nl) < TURN_COS) {
        const brake = Math.min(1.5, (v0 * v0) / (2 * this.pace.acc))
        const tmp: Pace = { top: v0, acc: (v0 * v0) / (2 * Math.max(0.05, brake)) }
        const k = baseLine([{ x: this.x, y: this.y }, { x: clampX(this.x + (hx / hl) * brake), y: clampY(this.y + (hy / hl) * brake) }], tmp, { v0, stop: true })
        for (let i = 1; i < k.length; i++) this.path.push({ t: this.t + k[i].t, x: k[i].x, y: k[i].y })
        this.t += k[k.length - 1].t
        this.x = k[k.length - 1].x
        this.y = k[k.length - 1].y
        v0 = 0
      }
    }
    const all: Pt[] = [{ x: this.x, y: this.y }, ...pts]
    const k = timedLine(all, this.pace, { ...opts, v0 })
    for (let i = 1; i < k.length; i++) this.path.push({ t: this.t + k[i].t, x: k[i].x, y: k[i].y })
    const last = k[k.length - 1]
    this.t += last.t
    this.x = last.x
    this.y = last.y
    return this.t
  }
  reset(x = this.x, y = this.y) {
    this.t = 0
    this.x = x
    this.y = y
    this.path = [{ t: 0, x, y }]
    this.lastStop = true
    this.inHeading = undefined
  }
}

/**
 * animflow r8: a deliberate step-out to stop the clock (end of a half, two minutes or less) -
 * any other out-of-bounds end is drawn as forced by a defender.
 */
export function clockStepOut(play: Play): boolean {
  const [mm, ss] = String(play.clock ?? '').split(':').map(Number)
  const secs = Number.isFinite(mm) && Number.isFinite(ss) ? mm * 60 + ss : Infinity
  return (play.qtr === 2 || play.qtr >= 4) && secs <= 120
}

/** Truncate a mover at time t, returning the speed it was carrying into t. */
function seek(mv: Mover, t: number): number {
  if (mv.t <= t) {
    if (!mv.lastStop) settle(mv)
    mv.hold(t - mv.t)
    mv.inHeading = undefined
    return 0
  }
  const dt = 0.05
  const a = posAt(mv.path, Math.max(0, t - dt))
  const b = posAt(mv.path, t)
  const v = t > dt ? Math.hypot(b.x - a.x, b.y - a.y) / dt : 0
  mv.inHeading = { x: b.x - a.x, y: b.y - a.y }
  mv.path = mv.path.filter((w) => w.t < t)
  mv.path.push({ t, x: b.x, y: b.y })
  mv.t = t
  mv.x = b.x
  mv.y = b.y
  mv.lastStop = false
  return clampN(v, 0, mv.pace.top)
}

/** Ease any actor still moving at the final knot to a stop (smooth last frame). */
function settle(mv: Mover) {
  if (mv.lastStop || mv.path.length < 2) return
  const a = mv.path[mv.path.length - 2]
  const b = mv.path[mv.path.length - 1]
  const d = Math.hypot(b.x - a.x, b.y - a.y)
  const dt = b.t - a.t
  const v = dt > 1e-6 ? d / dt : 0
  if (v <= 1.0) return
  const stopD = (v * v) / (2 * Math.max(0.5, mv.pace.acc))
  const ux = d > 1e-6 ? (b.x - a.x) / d : 0
  const uy = d > 1e-6 ? (b.y - a.y) / d : 0
  mv.run([{ x: clampX(b.x + ux * stopD), y: clampY(b.y + uy * stopD) }], { v0: v, stop: true })
}

/** Spot (offense frame) where the next possession started, if the other club has it. */
export function changeSpot(play: Play, next?: Play): number | null {
  if (!next || next.offId === play.offId) return null
  if (next.type === 'end') return null
  return 10 + (100 - next.startYard)
}

/**
 * The yard line (offense frame, 0–100) the ball is snapped from. Extra points are
 * recorded at yard 2 by the sim; they're kicked from the 15 (the 85).
 */
export function snapYard(play: Play): number {
  if (play.type === 'pat' && play.concept !== 'Two-point try') return 85
  return play.startYard
}

// ── formation ────────────────────────────────────────────────────────────────
interface Formation {
  [key: string]: { x: number; y: number; side: 'off' | 'def'; role: string }
}

/**
 * animflow r6c2 (295): how the ball is snapped, from the play's formation in
 * the playbook — shotgun (QB 5 yd deep), pistol (4 yd, back behind him) or
 * under centre (singleback, I-form, goal line, jumbo).
 */
export type SnapKind = 'gun' | 'pistol' | 'under'
export function snapKindFor(concept: string): SnapKind {
  // animflow r6d (J6): a kneel and a spike are taken under centre.
  if (/Kneel|Spike/.test(concept)) return 'under'
  const fm = formationForConcept(concept)
  if (/^Gun/.test(fm)) return 'gun'
  if (fm === 'Pistol') return 'pistol'
  return 'under'
}

function formation(los: number, fb = false, snap: SnapKind = 'gun'): Formation {
  const f: Formation = {}
  ;[-2.6, -1.3, 0, 1.3, 2.6].forEach((d, i) => (f[`ol${i}`] = { x: los - 0.6, y: MID_Y + d, side: 'off', role: 'OL' }))
  f.qb = { x: snap === 'under' ? los - 1.0 : snap === 'pistol' ? los - 4 : los - 5, y: MID_Y, side: 'off', role: 'QB' }
  // Shotgun: the back offset beside / behind the passer; pistol and under
  // centre: straight behind him (an I with a fullback in front of him).
  f.rb = snap === 'gun' ? { x: los - 7, y: MID_Y + 2.5, side: 'off', role: 'RB' } : { x: los - 7, y: MID_Y, side: 'off', role: 'RB' }
  if (fb) f.fb = snap === 'under' ? { x: los - 4.3, y: MID_Y, side: 'off', role: 'FB' } : { x: los - 8.5, y: MID_Y + 0.8, side: 'off', role: 'FB' }
  f.wr0 = { x: los - 0.6, y: 5, side: 'off', role: 'WR' }
  f.wr1 = { x: los - 0.6, y: 48.3, side: 'off', role: 'WR' }
  // animflow r6b: eleven on offense — a fullback set trades the slot for the FB.
  if (!fb) f.wr2 = { x: los - 1.2, y: 13, side: 'off', role: 'SLOT' }
  f.te = { x: los - 0.8, y: MID_Y + 4.4, side: 'off', role: 'TE' }
  ;[-4.3, -1.4, 1.4, 4.3].forEach((d, i) => (f[`dl${i}`] = { x: los + 1.2, y: MID_Y + d, side: 'def', role: 'DL' }))
  ;[-6, 0, 6].forEach((d, i) => (f[`lb${i}`] = { x: los + 5.5, y: MID_Y + d, side: 'def', role: 'LB' }))
  f.cb0 = { x: los + 5, y: 5.6, side: 'def', role: 'CB' }
  f.cb1 = { x: los + 5, y: 47.7, side: 'def', role: 'CB' }
  f.s0 = { x: los + 13, y: 17, side: 'def', role: 'S' }
  f.s1 = { x: los + 13, y: 36, side: 'def', role: 'S' }
  return f
}

const OFF_KEYS = ['ol0', 'ol1', 'ol2', 'ol3', 'ol4', 'qb', 'rb', 'wr0', 'wr1', 'wr2', 'te']
const DEF_KEYS = ['dl0', 'dl1', 'dl2', 'dl3', 'lb0', 'lb1', 'lb2', 'cb0', 'cb1', 's0', 's1']
const ALL_KEYS = (f: Formation) => [...OFF_KEYS.filter((k) => f[k]), ...(f.fb ? ['fb'] : []), ...DEF_KEYS]

function startMovers(f: Formation, ctx: AnimContext): Record<string, Mover> {
  const out: Record<string, Mover> = {}
  for (const [k, v] of Object.entries(f)) {
    const pl = ctx.actors?.get(k)
    const pace = paceFor(pl, v.role)
    // animflow r6b (item 4): a tired man (sim fatigue at the snap) has less top
    // speed and less burst.
    const fp = fatiguePace(pl ? ctx.fat?.get(pl.id) : undefined)
    out[k] = new Mover(k, v.role, fp.top < 1 ? { top: pace.top * fp.top, acc: pace.acc * fp.acc } : pace, v.x, v.y, pl)
  }
  return out
}

/** Convert second-based motion into the finished 0..1 timeline. */
function finish(
  f: Formation,
  movers: Record<string, Mover>,
  rest: {
    ball: WP[]
    holders: { t: number; key: string | null }[]
    flights: { t0: number; t1: number; height: number }[]
    flag?: { t: number; x: number; y: number }
    posts?: boolean
    /** Ball height (yd) over a kick's flight, in seconds (animflow r4: FG / PAT). */
    kickZ?: { t: number; z: number }[]
  },
): PlayAnim {
  const keys = ALL_KEYS(f)
  for (const k of keys) settle(movers[k])
  let maxT = 0.2
  for (const k of keys) {
    const p = movers[k].path
    if (p.length) maxT = Math.max(maxT, p[p.length - 1].t)
  }
  if (rest.ball.length) maxT = Math.max(maxT, rest.ball[rest.ball.length - 1].t)
  const frac = (t: number) => clampN(t / maxT, 0, 1)
  const rec = REC
  REC = null
  const engagements = rec ? trimEngagements(rec.eng, movers, frac, maxT) : []
  const events = rec ? takeEvents(rec.ev, frac) : []
  const sheds = rec ? rec.shed.filter((sh) => sh.t0 < maxT).map((sh) => ({ ...sh, t0: frac(sh.t0), t1: frac(Math.min(sh.t1, maxT)) })) : []
  const actors: Actor[] = keys.map((k) => {
    const p = movers[k].path.map((w) => ({ t: frac(w.t), x: w.x, y: w.y }))
    compact(p)
    return { key: k, side: f[k].side, role: f[k].role, path: p }
  })
  const ball = rest.ball.map((w) => ({ t: frac(w.t), x: w.x, y: w.y }))
  compact(ball)
  return {
    duration: Math.round(maxT * 1000),
    actors,
    ball,
    holders: rest.holders.map((h) => ({ t: frac(h.t), key: h.key })),
    flights: rest.flights.map((fl) => ({ t0: frac(fl.t0), t1: frac(fl.t1), height: fl.height })),
    flag: rest.flag ? { t: frac(rest.flag.t), x: rest.flag.x, y: rest.flag.y } : undefined,
    kickZ: rest.kickZ ? rest.kickZ.map((k) => ({ t: frac(k.t), z: k.z })) : undefined,
    posts: rest.posts,
    engagements,
    events,
    ...(sheds.length ? { sheds } : {}),
  }
}

/** The ball from the snap at `los` to the QB, then following him to `toSec`. */
function snapBall(m: Record<string, Mover>, los: number, toSec: number): WP[] {
  const p: WP[] = [{ t: 0, x: los, y: MID_Y }, { t: SNAP, ...posAt(m.qb.path, SNAP) }]
  p.push(...shadow(m.qb.path, SNAP, Math.max(SNAP, toSec)).slice(1))
  return p
}

/** Nearest defender (by position at time t) to a spot. */
function nearestKey(m: Record<string, Mover>, keys: string[], spot: Pt, t: number): string {
  return keys
    .map((k) => ({ k, d: Math.hypot(posAt(m[k].path, t).x - spot.x, posAt(m[k].path, t).y - spot.y) }))
    .sort((a, b) => a.d - b.d)[0].k
}

/**
 * Defenders close on a spot at their own pace (L12.10 B5): a fast safety gets
 * there, a slow LB trails. Pursuit (PUR) buys a small angle ahead of the runner.
 */
function pursueRun(m: Record<string, Mover>, keys: string[], fromSec: number, spot: Pt, arriveSec: number, seed = 0, lead?: Pt) {
  const ranked = keys
    .map((k) => {
      const p = posAt(m[k].path, fromSec)
      return { k, d: Math.hypot(p.x - spot.x, p.y - spot.y), pur: attrOf(m[k].player, 'PUR') }
    })
    .sort((a, b) => a.d - b.d)
  ranked.forEach(({ k, pur }, i) => {
    const v0 = seek(m[k], fromSec)
    const ang = hash(seed + i * 3.1) * Math.PI * 2
    const r = i === 0 ? 0.5 : 0.8 + i * 0.15
    let tx = spot.x + Math.cos(ang) * r
    let ty = spot.y + Math.sin(ang) * r
    if (lead) {
      const L = Math.hypot(lead.x, lead.y) || 1
      const ahead = Math.max(0, (pur - 60) * 0.03)
      tx += (lead.x / L) * ahead
      ty += (lead.y / L) * ahead
    }
    const s = posAt(m[k].path, fromSec)
    const avail = Math.max(0.08, arriveSec - fromSec)
    const reach = m[k].pace.top * avail * 0.8
    const d = Math.hypot(tx - s.x, ty - s.y)
    if (d <= reach) {
      m[k].run([{ x: clampX(tx), y: clampY(ty) }], { v0, stop: true })
    } else {
      const fr = reach / d
      m[k].run([{ x: clampX(s.x + (tx - s.x) * fr), y: clampY(s.y + (ty - s.y) * fr) }], { v0, stop: true })
    }
    if (m[k].t < arriveSec) m[k].hold(arriveSec - m[k].t)
  })
}

// ── visible catches, tackles and coverage pursuit ────────────────────────────
// Backlog 128–129. A kick/punt/pass must not simply end with a motionless
// carrier and distant defenders: the ball meets the real catcher, the holder
// changes there, coverage chases the moving carrier, and one eligible defender
// reaches the recorded stop as the carrier arrives. All of it is timing and
// geometry — no simulated value changes.

/** Time (s) to run a straight, stopped line of length `d` at a pace from v0. */
function straightTime(pace: Pace, d: number, v0 = 0): number {
  if (d < 1e-6) return 0
  const k = baseLine([{ x: 0, y: 0 }, { x: d, y: 0 }], pace, { v0, stop: true })
  return k.length ? k[k.length - 1].t : 0
}

/** A smooth single-bow polyline from a to b, `amp` yards to one side. */
function bowPts(a: Pt, b: Pt, amp: number): Pt[] {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const L = Math.hypot(dx, dy)
  // Coincident ends: bow along y so the mover still takes a real step/loop.
  const nx = L > 1e-6 ? -dy / L : 0
  const ny = L > 1e-6 ? dx / L : 1
  const out: Pt[] = []
  const N = 16
  for (let i = 1; i <= N; i++) {
    const s = i / N
    const off = Math.sin(Math.PI * s) * amp
    out.push({ x: clampX(a.x + dx * s + nx * off), y: clampY(a.y + dy * s + ny * off) })
  }
  if (out.length) {
    out[out.length - 1] = { x: b.x, y: b.y }
  }
  return out
}

/** animflow r7a: a quadratic Bezier a -> ctrl -> b as `n` points (a excluded). Lateral speed changes sign at most once. */
function quadPts(a: Pt, ctrl: Pt, b: Pt, n: number): Pt[] {
  const out: Pt[] = []
  for (let i = 1; i <= n; i++) {
    const u = i / n
    out.push({
      x: clampX((1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * ctrl.x + u * u * b.x),
      y: clampY((1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * ctrl.y + u * u * b.y),
    })
  }
  out[out.length - 1] = { x: b.x, y: b.y }
  return out
}

/**
 * animflow r7a: `pts` (from a) widened to one side by a single sine bow — to the
 * side he is already moving (`heading`), so the bow adds no second turn — until
 * the run takes ~`target` s at `pace`. The bow is bounded (<= 15% of the length,
 * 2.5 yd): he may arrive a touch early, but never loops back or weaves.
 */
function widenByTime(a: Pt, line: Pt[], pace: Pace, v0: number, target: number, heading: Pt): Pt[] {
  const end = line[line.length - 1]
  const L = Math.hypot(end.x - a.x, end.y - a.y)
  if (L < 0.5) return line
  const nx = -(end.y - a.y) / L
  const ny = (end.x - a.x) / L
  const sgn = heading.x * nx + heading.y * ny >= 0 ? 1 : -1
  // Resample (<= 0.5 yd steps) so a sparse line still bows smoothly.
  const pts: Pt[] = []
  const src = [a, ...line]
  for (let i = 1; i < src.length; i++) {
    const s0 = src[i - 1]
    const s1 = src[i]
    const k = Math.max(1, Math.ceil(Math.hypot(s1.x - s0.x, s1.y - s0.y) / 0.5))
    for (let j = 1; j <= k; j++) pts.push({ x: s0.x + ((s1.x - s0.x) * j) / k, y: s0.y + ((s1.y - s0.y) * j) / k })
  }
  const cum: number[] = []
  let run = 0
  let prev = a
  for (const p of pts) {
    run += Math.hypot(p.x - prev.x, p.y - prev.y)
    cum.push(run)
    prev = p
  }
  const tot = run || 1
  const make = (amp: number) =>
    pts.map((p, i) => {
      if (i === pts.length - 1) return { x: end.x, y: end.y }
      const off = Math.sin(Math.PI * (cum[i] / tot)) * amp * sgn
      return { x: clampX(p.x + nx * off), y: clampY(p.y + ny * off) }
    })
  const timeOf = (amp: number) => timedLine([a, ...make(amp)], pace, { v0, stop: false }).slice(-1)[0]?.t ?? 0
  // <= ~25 deg off his line at the start: a wider first step reads as a plant
  // (Mover.run brakes along the old heading, then comes back = a weave).
  const maxAmp = Math.min(2.5, L * 0.15)
  if (timeOf(maxAmp) <= target) return make(maxAmp)
  let lo = 0
  let hi = maxAmp
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2
    if (timeOf(mid) >= target) hi = mid
    else lo = mid
  }
  return make(hi)
}

/** Time the [a, ...bow] route at a pace with the given speed profile. */
function bowTime(a: Pt, b: Pt, pace: Pace, v0: number, amp: number): number {
  if (amp <= 1e-4) return straightTime(pace, Math.hypot(b.x - a.x, b.y - a.y), v0)
  const k = timedLine([a, ...bowPts(a, b, amp)], pace, { v0, stop: true })
  return k.length ? k[k.length - 1].t : 0
}

/**
 * A route from a to b that takes ≈ `target` seconds: straight when it already
 * does, otherwise a smooth pursuit bow deep enough to fill the time. `minBow`
 * keeps a visible sideways cut even when the straight run is quick enough.
 * Never teleports; the destination is always exactly b.
 */
function routeByTime(a: Pt, b: Pt, pace: Pace, v0: number, target: number, minBow = 0): Pt[] {
  const d = Math.hypot(b.x - a.x, b.y - a.y)
  const straight = straightTime(pace, d, v0)
  if (straight >= target - 0.02 && d > 1e-6) {
    return minBow > 0.2 ? bowPts(a, b, minBow) : [b]
  }
  let hi = Math.max(0.5, minBow)
  while (bowTime(a, b, pace, v0, hi) < target && hi < 16) hi *= 1.7
  if (bowTime(a, b, pace, v0, hi) < target) return bowPts(a, b, hi)
  let lo = 0
  let best = bowPts(a, b, hi)
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2
    if (bowTime(a, b, pace, v0, mid) >= target) {
      best = bowPts(a, b, mid)
      hi = mid
    } else lo = mid
  }
  return best
}

/** The eligible defender who is closest to `spot` at time `atSec`. */
function closestKey(m: Record<string, Mover>, keys: string[], spot: Pt, atSec: number): string {
  return keys
    .map((k) => ({ k, d: Math.hypot(posAt(m[k].path, atSec).x - spot.x, posAt(m[k].path, atSec).y - spot.y) }))
    .sort((a, b) => a.d - b.d)[0].k
}

/**
 * Run each defender in `keys` (except `tackler`) along the carrier's moving
 * path, fanning out behind him by rank so they trail in rather than stack, then
 * settle where they get to. This is the "coverage pursues the moving carrier".
 */
function chaseCarrier(
  m: Record<string, Mover>,
  keys: string[],
  fromSec: number,
  carrier: Mover,
  toSec: number,
  seed: number,
) {
  keys.forEach((k, i) => {
    const v0 = seek(m[k], fromSec)
    const avail = Math.max(0.1, toSec - fromSec)
    const reach = m[k].pace.top * avail * 0.85
    const start = posAt(m[k].path, fromSec)
    const lag = 0.08 + i * 0.03
    // Converge on the nearest point of the carrier's line first, so a defender
    // who is already ahead of the return runs to the stop instead of reversing
    // back to the catch. Then follow the carrier from there.
    let t0 = fromSec
    let bestD = Infinity
    const probe = 8
    for (let j = 0; j <= probe; j++) {
      const tt = fromSec + (toSec - fromSec) * (j / probe)
      const p = posAt(carrier.path, tt)
      const d = Math.hypot(p.x - start.x, p.y - start.y)
      if (d < bestD) { bestD = d; t0 = tt }
    }
    // One constant sideways offset per defender (rank-fanned), so his route
    // follows the carrier's smooth line instead of zig-zagging.
    const ang = hash(seed + i * 2.3) * Math.PI * 2
    const ox = Math.cos(ang) * (0.5 + i * 0.12)
    const oy = Math.sin(ang) * (0.5 + i * 0.12)
    const pts: Pt[] = []
    const steps = 4
    for (let j = 1; j <= steps; j++) {
      const tt = t0 + (toSec - t0) * (j / steps)
      const p = posAt(carrier.path, Math.max(0, tt - lag))
      const q = { x: clampX(p.x + ox), y: clampY(p.y + oy) }
      // Keep only what he can reach in the time available (trailing coverage
      // stops short instead of stretching the whole play).
      if (Math.hypot(q.x - start.x, q.y - start.y) <= reach) pts.push(q)
    }
    if (!pts.length) {
      const p = posAt(carrier.path, t0)
      const d = Math.hypot(p.x - start.x, p.y - start.y) || 1
      const fr = reach / d
      m[k].run([{ x: clampX(start.x + (p.x - start.x) * fr), y: clampY(start.y + (p.y - start.y) * fr) }], { v0, stop: true })
      return
    }
    m[k].run(pts, { v0, stop: true })
  })
}

/**
 * animflow r6a: pursuit to a tackle with real gang-tackle timing (BDB 2021,
 * 2018 pass plays, n 3.6k tackles after a catch): defenders within 1.5 yd by
 * the tackle median 2 (p90 3) — a 2nd man arrives on 62% of tackles, a median
 * 0.6 s after first contact, a 3rd on 23%, ~1.1 s after. Every other pursuer
 * closes on an angle but stays off the pile (>= 1.6 yd), so first contact is
 * the tackler's hit, not a chaser brushing the carrier. Time-stepped steering
 * (top speed and acceleration of each man), presentation only.
 */
function gangPursuit(m: Record<string, Mover>, keys: string[], fromSec: number, carrier: Mover, toSec: number, contactT: number, tackler: string, seed: number) {
  const others = keys.filter((k) => m[k] && k !== tackler && m[k] !== carrier)
  const endP = posAt(carrier.path, toSec)
  const rank = [...others].sort((a, b) => natTo(m[a], endP, fromSec) - natTo(m[b], endP, fromSec))
  const dur = Math.max(0.1, toSec - contactT)
  const g2 = hash(seed + 401) < 0.62
  const g3 = g2 && hash(seed + 403) < 0.37
  const arrive: Record<string, number> = {}
  if (rank[0] && g2) arrive[rank[0]] = contactT + Math.min(0.6 * (0.5 + hash(seed + 405)), dur * 0.9)
  if (rank[1] && g3) arrive[rank[1]] = contactT + Math.min(1.1 * (0.6 + 0.8 * hash(seed + 407)), dur * 0.95)
  const dt = 0.05
  for (const k of [...(m[tackler] ? [tackler] : []), ...rank]) {
    const mv = m[k]
    seek(mv, fromSec)
    let p = { x: mv.x, y: mv.y }
    let v = mv.path.length > 1 ? speedVec(mv.path, mv.t) : { x: 0, y: 0 }
    const top = mv.pace.top
    const acc = Math.max(3, mv.pace.acc)
    const ri = rank.indexOf(k)
    const hold = k === tackler ? 3.0 : 1.9 + 0.5 * Math.max(0, ri)
    const ta = arrive[k]
    const endT = k === tackler ? Math.max(fromSec, contactT - 0.8) : toSec
    let t = mv.t
    while (t + dt <= endT + 1e-6) {
      t += dt
      const c = posAt(carrier.path, t)
      const cv = speedVec(carrier.path, t)
      // Off the pile is measured from the carrier himself; the approach side
      // leads him a little (a pursuit angle), never sits in his running lane.
      const aim = { x: c.x + cv.x * 0.3, y: c.y + cv.y * 0.3 }
      const d = Math.hypot(p.x - c.x, p.y - c.y) || 1e-6
      const dx = (p.x - aim.x) * 0.5 + (p.x - c.x) * 0.5
      const dy = (p.y - aim.y) * 0.5 + (p.y - c.y) * 0.5
      const dn = Math.hypot(dx, dy) || 1e-6
      let gap = hold
      if (ta != null && t >= ta - 0.35) gap = 0.85 + (hold - 0.85) * clampN((ta - t) / 0.35, 0, 1)
      else if (k !== tackler) gap = Math.max(1.6, Math.min(gap, Math.max(d, 1.6)))
      const want = { x: c.x + (dx / dn) * gap, y: c.y + (dy / dn) * gap }
      let dvx = (want.x - p.x) / 0.4 + cv.x
      let dvy = (want.y - p.y) / 0.4 + cv.y
      if (d > gap + 3) {
        // animflow r6c2 (297): still well off him — run the pursuit angle.
        const I = interceptPt(carrier.path, p, t, top, toSec, gap)
        const il = Math.hypot(I.x - p.x, I.y - p.y) || 1e-6
        dvx = ((I.x - p.x) / il) * top
        dvy = ((I.y - p.y) / il) * top
      }
      const dl = Math.hypot(dvx, dvy)
      if (dl > top) { dvx *= top / dl; dvy *= top / dl }
      let ax = (dvx - v.x) / dt
      let ay = (dvy - v.y) / dt
      const al = Math.hypot(ax, ay)
      if (al > acc) { ax *= acc / al; ay *= acc / al }
      v = { x: v.x + ax * dt, y: v.y + ay * dt }
      p = stepIn(p, v, dt)
      mv.path.push({ t, x: p.x, y: p.y })
    }
    mv.t = t
    mv.x = p.x
    mv.y = p.y
    // The tackler hands straight over to hitAndRide (which reads his velocity
    // off the path): no settle tail in between.
    mv.lastStop = k === tackler || Math.hypot(v.x, v.y) < 1
    mv.inHeading = undefined
  }
}

/** Slow the coverage in during the kick/punt flight so it arrives near the ball. */
function loftCoverage(
  m: Record<string, Mover>,
  keys: string[],
  fromSec: number,
  toSec: number,
  toward: Pt,
  seed: number,
) {
  keys.forEach((k, i) => {
    const s = posAt(m[k].path, fromSec)
    const dx = toward.x - s.x
    const dy = toward.y - s.y
    const d = Math.hypot(dx, dy) || 1
    const reach = m[k].pace.top * Math.max(0.1, toSec - fromSec) * 0.9
    const fr = Math.min(0.95, reach / d)
    const ang = hash(seed + i * 3.7) * Math.PI * 2
    const r = 0.8 + i * 0.2
    m[k].run(
      [{ x: clampX(s.x + dx * fr + Math.cos(ang) * r), y: clampY(s.y + dy * fr + Math.sin(ang) * r) }],
      { stop: false },
    )
  })
}

/** Speed a mover is carrying at the end of his current path (yd/s). */
function carrySpeed(mv: Mover): number {
  const p = mv.path
  if (p.length < 2) return 0
  const a = p[p.length - 2]
  const b = p[p.length - 1]
  const dt = b.t - a.t
  return dt > 1e-6 ? clampN(Math.hypot(b.x - a.x, b.y - a.y) / dt, 0, mv.pace.top) : 0
}

/** Speed (yd/s) along a path just before time t. */
function speedAtTime(path: WP[], t: number): number {
  const dt = 0.03
  const a = posAt(path, Math.max(0, t - dt))
  const b = posAt(path, t)
  return Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1e-6, t - Math.max(0, t - dt))
}

/**
 * End a mover's timeline at `t`: settle a still-moving dot and wait, or
 * truncate one that would run past the recorded play. Leaves no settle tail in
 * `finish`, so the play (and every dot) really ends at `t`.
 */
function capAt(mv: Mover, t: number) {
  mv.inHeading = undefined
  if (!mv.lastStop) settle(mv)
  if (mv.t > t + 1e-4) {
    // Cut before the path naturally ends: decelerate into `t` so a defender
    // never pops from full speed straight to a frozen stop. A uniform brake
    // over Tb from his speed then, in his heading, stopping exactly at `t`.
    const v = speedAtTime(mv.path, t)
    if (v > 0.8) {
      const Tb = clampN(v / Math.max(4, mv.pace.acc), 0.15, 0.7)
      const tStart = Math.max(mv.path[0].t, t - Tb)
      const span = t - tStart
      const vStart = speedAtTime(mv.path, tStart)
      const pStart = posAt(mv.path, tStart)
      const h = speedVec(mv.path, tStart)
      const hl = Math.hypot(h.x, h.y)
      if (span > 0.05 && vStart > 0.3 && hl > 1e-6) {
        mv.path = mv.path.filter((w) => w.t < tStart)
        const n = Math.max(2, Math.ceil(span / 0.04))
        for (let i = 0; i <= n; i++) {
          const u = i / n
          const d = vStart * span * (u - (u * u) / 2)
          mv.path.push({ t: tStart + span * u, x: clampN(pStart.x + (h.x / hl) * d, Math.min(1, pStart.x), Math.max(FIELD_W - 1, pStart.x)), y: clampN(pStart.y + (h.y / hl) * d, Math.min(1.2, pStart.y), Math.max(FIELD_H - 1.2, pStart.y)) })
        }
        const last = mv.path[mv.path.length - 1]
        mv.t = last.t
        mv.x = last.x
        mv.y = last.y
      }
    }
  }
  if (mv.t > t + 1e-4) {
    const p = posAt(mv.path, t)
    mv.path = mv.path.filter((w) => w.t < t)
    mv.path.push({ t, x: p.x, y: p.y })
    mv.t = t
    mv.x = p.x
    mv.y = p.y
  } else if (mv.t < t) {
    mv.hold(t - mv.t)
  }
  mv.lastStop = true
  mv.inHeading = undefined
}

interface BlockPlan {
  b: string
  c: string
  p: Pt
  te: number
  off: number
}

/**
 * Request 133: plan ten return-blocker / cover-defender engagements. Each
 * meeting point is balanced between the two men by pace so they can arrive
 * together, and its arrival time is returned so the caller can give the play
 * enough time for the blocks to actually happen (never a teleport).
 */
function planBlocks(
  m: Record<string, Mover>,
  blkKeys: string[],
  covKeys: string[],
  liveFrom: number,
  seed: number,
): BlockPlan[] {
  const n = Math.min(blkKeys.length, covKeys.length)
  const out: BlockPlan[] = []
  for (let i = 0; i < n; i++) {
    const b = blkKeys[i]
    const c = covKeys[i]
    const bs: Pt = { x: m[b].x, y: m[b].y }
    const cs: Pt = { x: m[c].x, y: m[c].y }
    const vb = Math.max(0.5, m[b].pace.top)
    const vc = Math.max(0.5, m[c].pace.top)
    // Balance the run so both arrive at roughly the same instant, then nudge
    // the lanes toward each other so the block happens in the return lane.
    const f = vb / (vb + vc)
    const midY = (bs.y + cs.y) / 2
    const p: Pt = {
      x: clampX(bs.x + (cs.x - bs.x) * f),
      y: clampY(midY + (hash(seed + i * 2.9) - 0.5) * 3),
    }
    const bNat = straightTime(m[b].pace, Math.hypot(p.x - bs.x, p.y - bs.y), 0)
    const cNat = straightTime(m[c].pace, Math.hypot(p.x - cs.x, p.y - cs.y), 0)
    const te = Math.max(bNat, cNat, liveFrom + 0.2) + (i % 3) * 0.12
    out.push({ b, c, p, te, off: (i % 2 === 0 ? 1 : -1) * (3 + (i % 3) * 1.6) })
  }
  return out
}

/**
 * Apply a block plan: both men time their run to arrive at the meeting point
 * together, square up a body's width apart and hand-fight there for a beat (a
 * real, timed engagement that keeps moving), then the cover man gets off and
 * resumes pursuit along the returner's line while the blocker runs with the
 * return (animflow).
 */
function applyBlockEngagements(
  m: Record<string, Mover>,
  plan: BlockPlan[],
  returner: Mover,
  total: number,
  seed: number,
): void {
  plan.forEach(({ b, c, p, te, off }, i) => {
    const tt = Math.min(te, total - 0.35)
    // Square up a body's width apart on the line between the two men, both
    // still on the move as they arrive (no early arrival and a wait).
    const bs = { x: m[b].x, y: m[b].y }
    const cs = { x: m[c].x, y: m[c].y }
    let ax = cs.x - bs.x
    let ay = cs.y - bs.y
    const al = Math.hypot(ax, ay) || 1
    ax /= al
    ay /= al
    const g = 0.45
    runTimed(m[b], [{ x: clampX(p.x - ax * g), y: clampY(p.y - ay * g) }], m[b].t, tt, false, true)
    runTimed(m[c], [{ x: clampX(p.x + ax * g), y: clampY(p.y + ay * g) }], m[c].t, tt, false, true)
    // Engaged: they hand-fight and move together, then the cover man gets off.
    const shed = Math.min(Math.max(m[b].t, m[c].t) + 0.6 + hash(seed + i * 3.3) * 0.9, total - 0.15)
    recEng(b, c, Math.max(0.2, tt - 0.1), shed, 'block')
    pocketPair(m, c, [b], Math.max(m[b].t, m[c].t), shed, (hash(seed + i * 1.7) - 0.6) * 0.8, seed + i * 5, { x: ax, y: ay })
    // The blocker turns and runs with the return; the cover man resumes pursuit.
    const rp = posAt(returner.path, Math.min(total, m[b].t + 0.8))
    jogTo(m[b], { x: clampX(m[b].x + (rp.x - m[b].x) * 0.35 + (seed % 2 ? 1 : -1)), y: clampY(m[b].y + (rp.y - m[b].y) * 0.35 + off * 0.15) }, 3.4)
    const follow: Pt[] = []
    const steps = 5
    const from = m[c].t
    for (let j = 1; j <= steps; j++) {
      const tt2 = from + Math.max(0.01, total - from) * (j / steps)
      const rp2 = posAt(returner.path, Math.min(tt2, total))
      follow.push({ x: clampX(rp2.x + off * 0.6), y: clampY(rp2.y + off * 0.9) })
    }
    m[c].run(follow, { v0: carrySpeed(m[c]), stop: true })
    capAt(m[c], total)
    capAt(m[b], total)
  })
}

// ── plays ────────────────────────────────────────────────────────────────────
/** buildPass's throw style (the builders return finish()'s PlayAnim). */
let LAST_THROW_STYLE: ThrowStyle | undefined
let LAST_CATCH_ROUTE: string | undefined
export function buildPlayAnim(play: Play, ctx0: AnimContext = {}): BroadcastAnim {
  // animflow r6b: the sim's fatigue at the snap rides along (tired gait / poses).
  const fat = ctx0.fat ?? fatigueMap(play)
  const ctx: AnimContext = fat.size ? { ...ctx0, fat } : ctx0
  const buildRaw = (): PlayAnim => {
    switch (play.type) {
      case 'run':
        // animflow r6d (J6): a victory-formation kneel is its own snap, not a run.
        if (play.kneel) return buildKneel(play, ctx)
        return buildRun(play, ctx)
      case 'pass':
        if (play.result.startsWith('Sack')) return buildSack(play, ctx)
        if (play.spike) {
          LAST_THROW_STYLE = 'quick'
          const a = buildSpike(play, ctx)
          LAST_THROW_STYLE = undefined
          return { ...a, throwStyle: 'quick' }
        }
        LAST_THROW_STYLE = undefined
        {
          const a = buildPass(play, ctx)
          const r = LAST_CATCH_ROUTE
          LAST_CATCH_ROUTE = undefined
          return LAST_THROW_STYLE || r ? { ...a, ...(LAST_THROW_STYLE ? { throwStyle: LAST_THROW_STYLE } : {}), ...(r ? { catchRoute: r } : {}) } : a
        }
      case 'punt':
        return buildPunt(play, ctx)
      case 'fg':
      case 'pat':
        return play.concept === 'Two-point try' ? buildRun(play, ctx) : buildKick(play, ctx)
      case 'kickoff':
        return buildKickoff(play, ctx)
      case 'penalty':
        return buildPenalty(play, ctx)
      default:
        return buildStatic(play, ctx)
    }
  }
  return presentAnim(buildRaw(), play, ctx)
}

/** A numeric attribute, or `fallback` when the player does not carry it (never
 *  the overall: a missing route/block rating is league average, as in the sim). */
function attrNum(p: Player | undefined, key: string, fallback = 70): number {
  return effRating(p, key, fallback)
}

/** Best of a set of attributes (a rusher's best move, a blocker's protection). */
function bestAttr(p: Player | undefined, keys: string[], fallback = 70): number {
  let best = fallback
  let any = false
  const a = p ? effAttrs(p) : undefined
  for (const k of keys) {
    const v = a?.[k]
    if (typeof v === 'number') {
      best = any ? Math.max(best, v) : v
      any = true
    }
  }
  return any ? best : fallback
}

// ── pass protection (backlog 152) ────────────────────────────────────────────
// The pocket is planned as real engagements. The best pass rusher among the
// front (highest PRS / power / finesse move) is doubled by the two linemen
// closest to his alignment; the rest are single-blocked; a blitzer the slide
// does not pick up comes free. Blockers stand on a wall and each rusher attacks
// one contact-distance in front of it, so a rusher's x is never behind a
// blocker's and the two centres cannot overlap. A recorded sack or pressure
// still looks earned: the credited rusher — and only he — beats his blocker(s)
// home (splitting a double between the pair), while the men who stay blocked
// never reach the quarterback. Presentation only.

/** animflow r6c: how long a run defender's rip off the block takes (s). */
const RIP_SEC = 0.3
/** animflow r8: a credited run tackler is off his block at least this long before the hit (s). */
const RUN_FREE_MIN = 0.36
/** animflow r8 (302): an in-stride catch is made at >= this speed (yd/s), else the run-up is re-timed. */
const STRIDE_V = 4.2
/** animflow r8 (302): the run-up (yd) into an in-stride catch from a settled window. */
const STRIDE_RUNUP = 3.2
/** animflow r8: the slowest stem pace (share of top speed) any route is run at (NFL ~0.85-1). */
const ROUTE_PACE_MIN = 0.85
/** animflow r8: the tapered launch - acceleration = rate x (LAUNCH_HI - LAUNCH_FADE x v / top). */
const LAUNCH_HI = 1.2
const LAUNCH_FADE = 0.55
/** animflow r6c: a pass rusher's speed coming out of his move (yd/s; BDB 2023 pressures: 3.6 at the shed). */
const SHED_V0 = 3.6
const CONTACT = 0.9 // yd between a blocker's and his rusher's centres (hands on, leaning in)
/**
 * animflow r6a: pass-set depth behind the ball (yd) by time after the snap (s),
 * BDB 2023 tracking medians (2021 NFL pass plays wk 1-8: tackles n 17.1k,
 * guards n 17.1k, centres n 8.5k at 0.5 s). The pocket is a cup that keeps
 * giving ground (~2 yd/s), tackles deepest, the centre shallowest.
 */
const SET_DEPTH: Record<'T' | 'G' | 'C', [number, number][]> = {
  T: [[0, 0.6], [0.5, 1.41], [1, 2.31], [1.5, 3.55], [2, 4.8], [2.5, 5.78], [3, 6.29], [4, 6.9]],
  G: [[0, 0.6], [0.5, 1.02], [1, 1.55], [1.5, 2.46], [2, 3.42], [2.5, 4.18], [3, 4.62], [4, 5.1]],
  C: [[0, 0.6], [0.5, 0.62], [1, 1.35], [1.5, 2.3], [2, 3.17], [2.5, 3.75], [3, 4.03], [4, 4.4]],
}
/** Outward kick-slide (yd, + = away from the ball) by time after the snap; the cup then closes (BDB 2023 medians). */
const SET_LAT: Record<'T' | 'G' | 'C', [number, number][]> = {
  T: [[0, 0], [0.5, 0.17], [1, 0.49], [1.5, 0.55], [2, 0.22], [2.5, -0.26], [3, -0.59], [4, -0.9]],
  G: [[0, 0], [0.5, 0.09], [1, 0.25], [1.5, 0.3], [2, 0.13], [2.5, -0.03], [3, -0.16], [4, -0.3]],
  C: [[0, 0], [4, 0]],
}
function curveAt(tab: [number, number][], t: number): number {
  if (t <= tab[0][0]) return tab[0][1]
  for (let i = 1; i < tab.length; i++) {
    if (t <= tab[i][0]) {
      const [t0, v0] = tab[i - 1]
      const [t1, v1] = tab[i]
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0)
    }
  }
  return tab[tab.length - 1][1]
}
const setSpot = (k: string): 'T' | 'G' | 'C' => (k === 'ol0' || k === 'ol4' ? 'T' : k === 'ol2' ? 'C' : 'G')
/** Time after the snap at which the line is set (hands on): the cup curves are measured from here. */
const SET_T = 0.45
const LANE_GAP = 1.8 // min y between two blockers on the wall
const DOUBLE_GAP = 1.2 // y between the two blockers doubling one rusher (shoulder to shoulder)

/** The best y near `y` that is at least `d` from every lane (avoid packed bodies). */
function clearY(y: number, lanes: number[], d: number): number {
  if (!lanes.length) return clampY(y)
  const L = [...lanes].sort((a, b) => a - b)
  const cands = [L[0] - d, L[L.length - 1] + d]
  for (let i = 0; i < L.length - 1; i++) if (L[i + 1] - L[i] >= 2 * d) cands.push((L[i] + L[i + 1]) / 2)
  let best = cands[0]
  let bd = Infinity
  for (const c of cands) {
    const dd = Math.abs(c - y)
    if (dd < bd) {
      bd = dd
      best = c
    }
  }
  return clampY(best)
}

/**
 * A rusher breaking home: straight back in his own lane to behind the wall,
 * then an eased bend to `target`. The bend starts with no sideways heading (so
 * there is no right-angle plant) yet the sideways cut happens well behind every
 * blocker, and the path finishes exactly on `target`.
 */
function breakHome(wallX: number, qY: number, target: Pt, floorX = -Infinity): Pt[] {
  const g1 = { x: clampX(Math.max(floorX, wallX - 1.7)), y: qY }
  const out: Pt[] = [{ x: clampX(Math.max(floorX + 0.4, wallX - 0.7)), y: qY }, g1]
  const n = 6
  for (let i = 1; i <= n; i++) {
    const s = i / n
    out.push({ x: clampX(g1.x + (target.x - g1.x) * s), y: clampY(qY + (target.y - qY) * s * s) })
  }
  out[out.length - 1] = target
  return out
}

/**
 * Plan and run the pass protection. `rushers` are the front plus any blitzers,
 * `blockers` the linemen (and a back/tight end staying in). The best rusher is
 * doubled by the two linemen closest to his alignment; a man left over on a
 * blitz comes free; the recorded sacker / pressure rusher beats his block
 * (splitting the double) home. Blockers hold a wall and each rusher attacks one
 * contact-distance in front of it, so the pairs never overlap. Returns the
 * doubled and free keys for the probe. Presentation only.
 */
function passProtect(
  m: Record<string, Mover>,
  f: Formation,
  los: number,
  opts: { rushers: string[]; blockers: string[]; winner?: string; qbTarget: Pt; arriveSec: number; holdTo?: number; seed?: number; beaten?: string; primary?: string; double?: boolean },
): { doubled: string[]; free: string[]; pairs: { r: string; bs: string[] }[]; wallX: number } {
  const R = opts.rushers.filter((k) => m[k] && f[k])
  const B = opts.blockers.filter((k, i, a) => m[k] && f[k] && a.indexOf(k) === i)
  if (!R.length) return { doubled: [], free: [], pairs: [], wallX: los - 0.6 }
  const holdTo = Math.max(opts.arriveSec, opts.holdTo ?? opts.arriveSec)
  const pseed = opts.seed ?? los * 3
  const rush = (k: string) => bestAttr(m[k].player, ['PRS', 'PMV', 'FMV'])
  const prot = (k: string) => bestAttr(m[k].player, ['PBK', 'PBP', 'PBF'])
  const rank = [...R].sort((a, b) => rush(b) - rush(a))
  // animflow r6d (J12): the sim's game plan names the rusher the protection commits to (DOUBLE: two
  // linemen on him every dropback; CHIP: one, the back chips him on his way out).
  if (opts.primary && rank.includes(opts.primary)) rank.splice(0, rank.length, opts.primary, ...rank.filter((k) => k !== opts.primary))
  const primary = rank[0]

  // Assign blockers: the primary is doubled on most dropbacks (occasionally
  // singled); each other rusher takes the nearest free man, and a rusher left
  // over comes free.
  const usedB = new Set<string>()
  const pairs: { r: string; bs: string[] }[] = []
  const near = [...B].sort((a, b) => Math.abs(f[a].y - f[primary].y) - Math.abs(f[b].y - f[primary].y))
  const want = opts.double != null ? (opts.double ? 2 : 1) : hash(los * 7 + opts.rushers.length * 3 + 19) < 0.82 ? 2 : 1
  const pbs: string[] = []
  for (const b of near) {
    if (pbs.length < want) {
      pbs.push(b)
      usedB.add(b)
    }
  }
  pairs.push({ r: primary, bs: pbs })
  for (const r of rank.slice(1)) {
    const avail = B.filter((b) => !usedB.has(b))
    if (!avail.length) {
      pairs.push({ r, bs: [] })
      continue
    }
    const b = avail.reduce((a, c) => (Math.abs(f[c].y - f[r].y) < Math.abs(f[a].y - f[r].y) ? c : a))
    usedB.add(b)
    pairs.push({ r, bs: [b] })
  }
  // animflow r6c2: the sim's own rep (J8b) names the blocker the credited
  // rusher beat — he is the man on him (taken from whoever had him). A
  // winner who starts so deep (a corner / safety blitz) that he could not reach
  // the wall and still beat a block before the recorded moment comes free.
  const wp = opts.winner ? pairs.find((p) => p.r === opts.winner) : undefined
  // (Only when the drawn line puts that man across from him: the sim's blocker
  // order need not match the drawn alignment, and a rusher must never cross
  // the formation to reach "his" man.)
  const nearB = wp ? [...B].sort((a, b) => Math.abs(f[a].y - f[wp.r].y) - Math.abs(f[b].y - f[wp.r].y)).slice(0, 2) : []
  if (wp && opts.beaten && nearB.includes(opts.beaten) && !(wp.bs.length === 1 && wp.bs[0] === opts.beaten)) {
    const had = pairs.find((p) => p !== wp && p.bs.includes(opts.beaten!))
    const old = wp.bs
    wp.bs = [opts.beaten]
    if (had) {
      had.bs = had.bs.filter((b) => b !== opts.beaten)
      const give = old.find((b) => b !== opts.beaten && !had.bs.includes(b))
      if (!had.bs.length && give) had.bs = [give]
    }
  }
  if (wp && wp.bs.length && f[wp.r] && /^(cb|s)/.test(wp.r)) {
    const reach = Math.hypot(f[wp.r].x - opts.qbTarget.x, f[wp.r].y - opts.qbTarget.y) / Math.max(4, m[wp.r].pace.top * 0.85) + 0.3
    if (reach > opts.arriveSec - 0.7) wp.bs = []
  }
  // Record the protection matchups: a doubled rusher is a 'double' for each of
  // his two blockers, everyone else a single 'block'. finish() trims each to the
  // span the two men are actually in contact.
  for (const pr of pairs) {
    const kind: EngageKind = pr.bs.length >= 2 ? 'double' : 'block'
    // animflow r6c: the winner's block is recorded where he sheds it (below).
    if (pr.r !== opts.winner) for (const b of pr.bs) recEng(b, pr.r, 0.2, holdTo, kind)
  }

  // Lane layout. Every blocker stands on the wall at a y, spaced so the bodies
  // stay apart; a double is 2.4 yd wide so the rusher can split it.
  const lane: Record<string, number> = {}
  for (const b of B) lane[b] = clampY(f[b].y)
  const pairId: Record<string, number> = {}
  pairs.forEach((pr, i) => {
    if (pr.bs.length >= 2) for (const b of pr.bs) pairId[b] = i
  })
  const samePair = (a: string, b: string) => pairId[a] !== undefined && pairId[a] === pairId[b]
  for (const pr of pairs) {
    if (pr.bs.length < 2) continue
    const [a, b] = pr.bs
    const mid = (lane[a] + lane[b]) / 2
    // Keep each man on the side he started on, so the pair opens outward and the
    // two blockers never swap places (which would cross the rusher's line).
    const lo = lane[a] <= lane[b] ? a : b
    const hi = lo === a ? b : a
    lane[lo] = mid - DOUBLE_GAP / 2
    lane[hi] = mid + DOUBLE_GAP / 2
  }
  const order = [...B].sort((a, b) => lane[a] - lane[b])
  for (let it = 0; it < 8; it++) {
    for (let i = 1; i < order.length; i++) {
      const gap = samePair(order[i - 1], order[i]) ? DOUBLE_GAP : LANE_GAP
      if (lane[order[i]] - lane[order[i - 1]] < gap) lane[order[i]] = lane[order[i - 1]] + gap
    }
    for (let i = order.length - 2; i >= 0; i--) {
      const gap = samePair(order[i], order[i + 1]) ? DOUBLE_GAP : LANE_GAP
      if (lane[order[i + 1]] - lane[order[i]] < gap) lane[order[i]] = lane[order[i + 1]] - gap
    }
  }
  for (const b of B) lane[b] = clampY(lane[b])
  const allLanes = B.map((b) => lane[b])

  // The wall holds its shape and gives ground together, in proportion to the
  // primary matchup; every rusher attacks a contact-distance in front of it.
  // Keep the wall a body's length in front of where the passer ends, so a free
  // rusher coming home through the pocket cannot clip a blocker on a goal-line
  // play (a safety, where the passer's spot is barely behind the line).
  const give = clampN((rush(primary) - prot(pbs[0] ?? primary)) * 0.025, -0.3, 1.1)
  const wallX = clampX(Math.max(los - 0.6 - give, opts.qbTarget.x + 1.4))
  const contactX = clampX(wallX + CONTACT)
  // animflow r6a: the cup. Each blocker sets at his spot's depth (tackles kick
  // deepest, the centre shallowest) and the whole pocket keeps giving ground on
  // the BDB depth curves (a losing matchup faster), never into the passer.
  const qbAt = (t: number) => (m.qb ? posAt(m.qb.path, t) : opts.qbTarget)
  const floorAt = (t: number) => qbAt(Math.min(t, Math.max(opts.arriveSec, holdTo))).x + 1.5
  const outSign = (b: string) => (f[b].y >= (f.ol2?.y ?? MID_Y) ? 1 : -1)
  const setX: Record<string, number> = {}
  for (const b of B) setX[b] = clampX(Math.max(los - curveAt(SET_DEPTH[setSpot(b)], SET_T) - give * 0.5, opts.qbTarget.x + 1.4))
  const pairX = (bs: string[]) => (bs.length ? bs.reduce((a, b) => a + setX[b], 0) / bs.length : wallX)
  const kOf = (r: string | null, bs: string[]) =>
    !r || !bs.length ? 1 : clampN(1 + (rush(r) - Math.max(...bs.map(prot))) * 0.012, 0.75, 1.35) * (bs.length > 1 ? 0.85 : 1)
  const pairDrift = (bs: string[], k: number) => (t: number): Pt => {
    if (!bs.length) return { x: 0, y: 0 }
    const u = t - SNAP
    let dx = 0
    let dy = 0
    for (const b of bs) {
      const sp = setSpot(b)
      dx -= (curveAt(SET_DEPTH[sp], u) - curveAt(SET_DEPTH[sp], SET_T)) * k
      dy += outSign(b) * (curveAt(SET_LAT[sp], u) - curveAt(SET_LAT[sp], SET_T))
    }
    dx /= bs.length
    dy /= bs.length
    dx = Math.min(0, Math.max(dx, floorAt(t) - pairX(bs)))
    return { x: dx, y: dy }
  }
  // How the recorded winner wins (BDB 2023 pressures n 4.2k: speed 44%, bull 41%,
  // spin 2%): power rushers drive the man back into the pocket, finesse rushers
  // bend the edge, now and then with a spin.
  // animflow r6c: the move is his best rush tool on the sim's effective
  // ratings, with a per-play draw so a man with two good moves mixes them
  // (BDB 2023 pressures n 1.8k: round the edge 39%, inside 43%, through 17%).
  // A speed rush needs the edge: only a man with no blocker outside him.
  const winMove = (r: string, edge: boolean): ShedMove => {
    const pl = m[r]?.player
    const pmv = attrNum(pl, 'PMV')
    const fmv = attrNum(pl, 'FMV')
    const spd = attrNum(pl, 'SPD')
    const str = attrNum(pl, 'STR')
    const agi = attrNum(pl, 'AGI')
    const n = (i: number) => (hash(pseed + 53 + i * 7.7) - 0.5) * 14
    const cand: [ShedMove, number][] = [
      ['bull', pmv * 0.6 + str * 0.4 - 14 + n(1)],
      ['swim', fmv * 0.7 + agi * 0.3 + 5 + n(2)],
      ['spin', fmv * 0.6 + agi * 0.4 - 6 + n(3)],
    ]
    if (edge) cand.push(['speed', fmv * 0.55 + spd * 0.45 + 4 + n(4)])
    return cand.reduce((a, c) => (c[1] > a[1] ? c : a))[0]
  }

  // Plan each pair: the lane a rusher attacks, the contact point, and — for the
  // recorded winner — the burst home. A double's gap and every assigned lane are
  // treated as occupied, so a free man or the winner's swim is never sent to
  // stand on a teammate (backlog 152 follow-up).
  const pairMid = pairs.map((pr) => (pr.bs.length >= 2 ? (lane[pr.bs[0]] + lane[pr.bs[1]]) / 2 : NaN))
  const occupied = [...allLanes]
  for (const midY of pairMid) if (Number.isFinite(midY)) occupied.push(midY)
  const plan: { r: string; bs: string[]; pts: Pt[]; burst: Pt[]; after: Pt[]; teP: number }[] = []
  // animflow r6a: the depth a blocker has reached by time t (s) on his spot's curve.
  const setXAt = (b: string, t: number) => clampX(Math.max(los - curveAt(SET_DEPTH[setSpot(b)], Math.max(SET_T, t - SNAP)) - give * 0.5, opts.qbTarget.x + 1.4))
  const teCap0 = Math.max(0.1, opts.arriveSec - 0.1)
  let teAll = 0.12
  for (let pi = 0; pi < pairs.length; pi++) {
    const { r } = pairs[pi]
    const bs = pairs[pi].bs
    // The lane the rusher attacks: his blocker's lane, the gap of a double, a
    // clear gap for a free man, or (the recorded winner, singled) his blocker's
    // outside shoulder kept clear of everyone else.
    let qY: number
    if (bs.length >= 2) qY = pairMid[pi]
    else if (!bs.length) {
      // A free man keeps his own alignment lane (so he never crosses the wall on
      // the way in); only if that lane is packed does he step to a clear one.
      qY = clampY(f[r].y)
      if (occupied.some((l) => Math.abs(l - qY) < 1.0)) qY = clearY(qY, occupied, 1.0)
      occupied.push(qY)
    } else if (r === opts.winner) {
      // Swim to the blocker's outside shoulder, but only to a lane that is
      // clear of everyone (including double gaps and other rushers' lanes), so
      // he never crosses a body at the wall.
      const side = f[r].y >= lane[bs[0]] ? 1 : -1
      qY = clearY(clampY(lane[bs[0]] + side * 1.15), occupied, 1.3)
      occupied.push(qY)
    } else qY = lane[bs[0]]
    qY = clampY(qY)
    // Attack in a straight line to the contact point, so the rusher's x is never
    // behind a blocker's and the centres cannot overlap. The winner is left out
    // of the shared pocket time: his own burst sets when he breaks free.
    const pts: Pt[] = [{ x: clampX(bs.length ? pairX(bs) + CONTACT : contactX), y: qY }]
    const approach = straightTime(m[r].pace, Math.hypot(pts[0].x - m[r].x, pts[0].y - m[r].y), 0) + 0.12
    if (r !== opts.winner) teAll = Math.max(teAll, approach)
    for (const b of bs) teAll = Math.max(teAll, straightTime(m[b].pace, Math.hypot(setX[b] - m[b].x, lane[b] - m[b].y), 0) + 0.06)
    // animflow r6a: each pair engages when its own men get there (BDB: hands on
    // ~0.4-0.6 s after the snap), not when the slowest man on the line does.
    let teP = m[r].t + approach
    for (const b of bs) teP = Math.max(teP, m[b].t + straightTime(m[b].pace, Math.hypot(setX[b] - m[b].x, lane[b] - m[b].y), 0) + 0.06)
    teP = clampN(teP, 0.1, teCap0)
    if (bs.length) {
      for (const b of bs) setX[b] = setXAt(b, teP)
      pts[0] = { x: clampX(pairX(bs) + CONTACT), y: qY }
    }
    // A free man keeps his clear lane past the wall, then turns for the pocket.
    const after: Pt[] = []
    if (!bs.length) {
      after.push(...breakHome(wallX, qY, { x: clampX(opts.qbTarget.x), y: clampY(opts.qbTarget.y + ((plan.length % 2) - 0.5) * 1.8) }))
    }
    // The recorded winner's burst home: straight back through his lane (a
    // double's gap, his outside shoulder, or a free lane), then an eased bend to
    // the passer — no right-angle plant, and it ends exactly on him.
    const burst: Pt[] = opts.winner === r ? breakHome(wallX, qY, opts.qbTarget) : []
    plan.push({ r, bs, pts, burst, after, teP })
  }
  const teCap = Math.max(0.1, opts.arriveSec - 0.1)
  const te = Math.min(teAll, teCap)

  // Every blocker — even one left without a man — steps on to the wall once,
  // and every rusher gets his hands on his man there. Then the pocket is live:
  // each pair hand-fights and gives ground together (pocketPair) until the
  // rusher wins, the ball is gone or the play is over.
  const teOf: Record<string, number> = {}
  for (const pl of plan) for (const b of pl.bs) teOf[b] = pl.teP
  for (const b of B) {
    if (teOf[b] == null) {
      teOf[b] = clampN(m[b].t + straightTime(m[b].pace, Math.hypot(setX[b] - m[b].x, lane[b] - m[b].y), 0) + 0.06, 0.1, teCap0)
      setX[b] = setXAt(b, teOf[b])
    }
    runTimed(m[b], [{ x: setX[b], y: lane[b] }], m[b].t, teOf[b], false, true)
  }
  const busy = new Set<string>()
  const pushOf = (r: string, bs: string[]) =>
    clampN(0.45 + (rush(r) - (bs.length ? Math.max(...bs.map(prot)) : 70)) * 0.03 - (bs.length > 1 ? 0.3 : 0), 0.15, 1.4)
  // animflow r6c: the recorded winner beats his block with a move. He fights
  // his man head-up (a bull rush drives him back toward the passer), then at
  // the shed works past the blocker's shoulder — dip and rip round the edge,
  // swim over the top inside, spin off the hip, or shed the man he has driven
  // back — and is clear of him at once (BDB: 1.8 yd apart 0.3 s after the
  // shed). The beaten blocker is turned / over-extended and left behind, then
  // chases. He still arrives on the passer at the recorded moment.
  const winShed = (pl: (typeof plan)[number], pi: number, engage0: number) => {
    const r = pl.r
    const bs = pl.bs
    const dbl = bs.length >= 2
    const outside = (y: number) => (y >= (f.ol2?.y ?? MID_Y) ? 1 : -1)
    const bY = dbl ? pl.pts[0].y : lane[bs[0]]
    const others = B.filter((b) => !bs.includes(b)).map((b) => lane[b])
    const clear = (y: number) => others.every((l) => Math.abs(l - y) >= 0.9)
    const sOut = outside(bY)
    const edge = !dbl && clear(bY + sOut * 0.9)
    let mv: ShedMove = dbl ? (attrNum(m[r].player, 'PMV') >= attrNum(m[r].player, 'FMV') ? 'bull' : 'swim') : winMove(r, edge)
    // Which shoulder he beats: the edge for a speed rush, inside for a swim /
    // spin when there is room, else whichever side is clear.
    let s = mv === 'speed' ? sOut : -sOut
    if (!dbl && !clear(bY + s * 0.85)) s = -s
    if (!dbl && !clear(bY + s * 0.85) && mv !== 'bull') mv = 'bull'
    const off = dbl ? 0 : mv === 'bull' ? 0.45 : mv === 'swim' ? 0.75 : mv === 'spin' ? 0.7 : 0.85
    const k = kOf(r, bs) * (mv === 'bull' ? 1.9 : 1)
    const drift = pairDrift(bs, k)
    // Where the blockers stand at time t (the pocket gives ground).
    const bAt = (t: number): Pt => {
      const d = drift(t)
      const d0 = drift(pl.teP)
      return { x: pairX(bs) + (d.x - d0.x), y: bY + (d.y - d0.y) }
    }
    const legFrom = (b: Pt): Pt[] => {
      const yS = clampY(b.y + s * off)
      const pre: Pt[] = dbl ? [] : mv === 'speed' ? [{ x: clampX(b.x + 0.3), y: clampY(b.y + s * 0.7) }]
        : mv === 'swim' ? [{ x: clampX(b.x + 0.55), y: clampY(b.y + s * 0.5) }]
          : mv === 'bull' ? [{ x: clampX(b.x + 0.35), y: clampY(b.y + s * 0.3) }]
            : []
      return [...pre, ...breakHome(b.x, yS, opts.qbTarget, opts.qbTarget.x + 0.5)]
    }
    // Shed time: the leg home at his pace ends on the recorded arrival.
    let engage = engage0
    for (let it = 0; it < 3; it++) {
      const b = bAt(engage)
      const kk = timedLine([{ x: b.x + CONTACT, y: b.y }, ...legFrom(b)], m[r].pace, { v0: SHED_V0, stop: true })
      const dur = kk.length ? kk[kk.length - 1].t : 0
      engage = clampN(opts.arriveSec - dur - (mv === 'spin' ? 0.3 : 0), pl.teP + 0.12, Math.max(pl.teP + 0.12, opts.arriveSec - 0.35))
    }
    const headY = dbl ? pl.pts[0].y : lane[bs[0]]
    runTimed(m[r], [{ x: pl.pts[0].x, y: headY }], m[r].t, pl.teP, false, true)
    pocketPair(m, r, bs, pl.teP, engage, pushOf(r, bs), pseed + pi * 7, undefined, drift)
    // animflow r6c2: never later than the move needs to get him off the block
    // before the recorded moment, whatever the pocket did (a long hand-fight).
    const t0 = Math.min(Math.max(m[r].t, engage), Math.max(pl.teP + 0.05, opts.arriveSec - 0.35))
    if (m[r].t > t0) seek(m[r], t0)
    const bm = bs.reduce((a, b) => ({ x: a.x + m[b].x / bs.length, y: a.y + m[b].y / bs.length }), { x: 0, y: 0 })
    let leg = legFrom({ x: Math.min(bm.x, m[r].x - 0.5), y: bm.y })
    if (mv === 'spin') {
      // A spin: a full turn off the blocker's hip, then home.
      const c = { x: m[r].x - 0.45, y: m[r].y + s * 0.3 }
      const loop: Pt[] = []
      for (let j = 1; j <= 8; j++) {
        const a = Math.atan2(m[r].y - c.y, m[r].x - c.x) + (s * 2 * Math.PI * j) / 8
        loop.push({ x: clampX(c.x + Math.cos(a) * 0.45), y: clampY(c.y + Math.sin(a) * 0.45) })
      }
      leg = [...loop, ...leg]
    }
    // Out of the move at speed, already heading into it (no plant on the hand-fight sway).
    m[r].inHeading = { x: leg[0].x - m[r].x, y: leg[0].y - m[r].y }
    runTimed(m[r], leg, t0, opts.arriveSec, false, true, 1.6, SHED_V0)
    const shedLen = mv === 'spin' ? 0.45 : mv === 'bull' ? 0.35 : 0.32
    const kind: EngageKind = dbl ? 'double' : 'block'
    for (const b of bs) recEng(b, r, 0.2, t0 + 0.08, kind)
    recShed(r, bs, t0, t0 + shedLen, mv)
    // The beaten blocker(s): turned and left behind, then they chase.
    bs.forEach((b, i) => {
      const mb = m[b]
      if (mb.t < t0) mb.hold(t0 - mb.t)
      else if (mb.t > t0) seek(mb, t0)
      const away = dbl ? (mb.y >= bm.y ? 1 : -1) : -s
      const lurch: Pt = mv === 'bull' || dbl ? { x: mb.x - 0.2, y: mb.y + away * 0.75 } // shoved aside, off balance
        : mv === 'speed' ? { x: mb.x - 0.25, y: mb.y - s * 0.2 } // turned, his hips open: the edge is gone
          : { x: mb.x + 0.45, y: mb.y - s * 0.2 } // over-extended into the space his man left
      runTimed(mb, [{ x: clampX(lurch.x), y: clampY(lurch.y) }], t0, t0 + 0.45 + i * 0.05, false, true)
      const q = opts.qbTarget
      const d = Math.hypot(q.x - mb.x, q.y - mb.y)
      if (d > 2.6) jogTo(mb, { x: mb.x + ((q.x - mb.x) * (d - 2.4)) / d, y: mb.y + ((q.y - mb.y) * (d - 2.4)) / d }, 2.8)
    })
  }
  plan.forEach((pl, pi) => {
    // animflow r6c2: the recorded winner whose block could only start in the
    // last half-second before the moment (a quick throw, a long walk to the
    // wall) has no time to beat it with a move: he is the man the protection
    // never got a hand on — straight past the blocker's shoulder, untouched.
    if (pl.r === opts.winner && pl.bs.length && pl.teP + 0.5 > opts.arriveSec) {
      runTimed(m[pl.r], pl.burst.length ? pl.burst : pl.after, m[pl.r].t, opts.arriveSec, false, true, 1.6)
      return
    }
    for (const b of pl.bs) busy.add(b)
    const final = pl.r === opts.winner ? pl.burst : pl.after
    if (!final.length) {
      // Blocked, and not the recorded winner: he never reaches the passer.
      runTimed(m[pl.r], pl.pts, m[pl.r].t, pl.teP, false, true)
      pocketPair(m, pl.r, pl.bs, pl.teP, holdTo, pushOf(pl.r, pl.bs), pseed + pi * 7, undefined, pairDrift(pl.bs, kOf(pl.r, pl.bs)))
      return
    }
    // Time the leg that gets home at the recorded arrival, then engage only
    // long enough to start it so he arrives on time: a short window never skips
    // it (backlog 152 follow-up). The winner ends exactly on the passer; a free
    // teammate is nudged a body's width aside so the two never share a lane.
    const k = timedLine([pl.pts[0], ...final], m[pl.r].pace, { v0: 0, stop: true })
    const dur = k.length ? k[k.length - 1].t : 0
    const engage = clampN(opts.arriveSec - dur, 0.1, teCap)
    let leg = final
    if (pl.bs.length && pl.r === opts.winner) {
      winShed(pl, pi, engage)
      return
    }
    if (pl.bs.length && engage > pl.teP + 0.25) {
      const headY = pl.bs.length >= 2 ? pl.pts[0].y : lane[pl.bs[0]]
      runTimed(m[pl.r], [{ x: pl.pts[0].x, y: headY }], m[pl.r].t, pl.teP, false, true)
      pocketPair(m, pl.r, pl.bs, pl.teP, engage, pushOf(pl.r, pl.bs), pseed + pi * 7, undefined, pairDrift(pl.bs, kOf(pl.r, pl.bs)))
    } else {
      runTimed(m[pl.r], pl.pts, m[pl.r].t, engage, false, true)
    }
    runTimed(m[pl.r], leg, m[pl.r].t, opts.arriveSec, false, true, 1.6)
  })
  // A blocker with no man looks for work: he mirrors the pocket.
  B.forEach((b, i) => {
    if (!busy.has(b)) pocketPair(m, null, [b], teOf[b] ?? te, holdTo, 0.5, pseed + 50 + i, undefined, pairDrift([b], 1))
  })
  return {
    doubled: pairs.filter((p) => p.bs.length >= 2).map((p) => p.r),
    free: pairs.filter((p) => !p.bs.length).map((p) => p.r),
    pairs,
    wallX,
  }
}

/** Run to `pt` at an easy pace (a lineman releasing, a passer drifting). */
function jogTo(mv: Mover, pt: Pt, speed: number) {
  const saved = mv.pace
  const v0 = Math.min(speed, carrySpeed(mv))
  mv.pace = { top: Math.min(saved.top, speed), acc: Math.min(saved.acc, 5) }
  mv.run([{ x: clampX(pt.x), y: clampY(pt.y) }], { v0, stop: true })
  mv.pace = saved
}

/**
 * An engaged pass-pro pair in the pocket (animflow): rusher and blocker(s) stay
 * in contact (centres ~0.9 yd apart, a double shoulder to shoulder) and move
 * together — the rush pushes the pocket back by `push` yd over the rep, the pair
 * sways with the hand-fight. `r` null: a blocker with no man mirrors the pocket.
 */
function pocketPair(m: Record<string, Mover>, r: string | null, bs: string[], t0: number, t1: number, push: number, seed: number, axis: Pt = { x: 1, y: 0 }, drift?: (t: number) => Pt) {
  const keys = [...(r ? [r] : []), ...bs].filter((k) => m[k])
  if (!keys.length) return
  // Contact is made when the last of them gets there (a late blitzer is met
  // where he arrives, never pulled in).
  for (const k of keys) t0 = Math.max(t0, m[k].t)
  if (t1 <= t0 + 0.06) return
  for (const k of keys) {
    const mv = m[k]
    if (mv.t < t0) mv.hold(t0 - mv.t)
    mv.lastStop = true
  }
  const P0: Record<string, Pt> = {}
  for (const k of keys) P0[k] = { x: m[k].x, y: m[k].y }
  const bMean = bs.length ? { x: bs.reduce((a, k) => a + P0[k].x, 0) / bs.length, y: bs.reduce((a, k) => a + P0[k].y, 0) / bs.length } : P0[keys[0]]
  const c0 = r ? { x: (P0[r].x + bMean.x) / 2, y: (P0[r].y + bMean.y) / 2 } : bMean
  const ph = hash(seed) * Math.PI * 2
  const order = [...bs].sort((a, b) => (P0[a].y - P0[b].y) * axis.x - (P0[a].x - P0[b].x) * axis.y)
  // Local frame: `ax` from the blocker(s) to the rusher, `px` across it.
  const al = Math.hypot(axis.x, axis.y) || 1
  const ax = { x: axis.x / al, y: axis.y / al }
  const px = { x: -ax.y, y: ax.x }
  const at = (o: Pt, a: number, b: number): Pt => ({ x: o.x + ax.x * a + px.x * b, y: o.y + ax.y * a + px.y * b })
  const slot = (k: string, u: number): Pt => {
    // animflow r6a: a drift (absolute displacement since t0, from the BDB pocket
    // depth curves) replaces the exponential push along the axis.
    const rec = drift ? 0 : push * (1 - Math.exp(-u / 1.1))
    const sway = (Math.sin(ph + u * 6.5) * 0.13 + Math.sin(ph * 1.3 + u * 2.1) * 0.09) * clampN(u / 0.3, 0, 1)
    const g = 0.88 + Math.sin(ph * 0.7 + u * 8.5) * 0.05
    if (!r) return at(P0[k], -rec, sway)
    if (k === r) return at(c0, g / 2 - rec, sway)
    if (order.length < 2) return at(c0, -g / 2 - rec, sway)
    const back = Math.sqrt(Math.max(0.1, g * g - 0.36))
    return at(c0, g / 2 - back - rec, sway + (order.indexOf(k) === 0 ? -0.6 : 0.6))
  }
  const off: Record<string, Pt> = {}
  for (const k of keys) {
    const s0 = slot(k, 0)
    off[k] = { x: P0[k].x - s0.x, y: P0[k].y - s0.y }
  }
  const dt = 0.05
  const d0 = drift ? drift(t0) : { x: 0, y: 0 }
  for (let t = t0 + dt; t < t1 + 1e-6; t += dt) {
    const u = t - t0
    const e = clampN(u / 0.25, 0, 1)
    const fade = 1 - e * e * (3 - 2 * e)
    const dv = drift ? { x: drift(t).x - d0.x, y: drift(t).y - d0.y } : { x: 0, y: 0 }
    for (const k of keys) {
      const s = slot(k, u)
      m[k].path.push({ t, x: clampX(s.x + off[k].x * fade + dv.x), y: clampY(s.y + off[k].y * fade + dv.y) })
    }
  }
  for (const k of keys) {
    const mv = m[k]
    const last = mv.path[mv.path.length - 1]
    mv.t = last.t
    mv.x = last.x
    mv.y = last.y
    mv.lastStop = true
    mv.inHeading = undefined
  }
}

// ── run play: the live field (animflow) ──────────────────────────────────────
// The carrier's path is scripted from the recorded result; everyone else plays
// the snap out on the live field (playLive.ts): the line gets hands on at the
// snap and drives (zone steps flow to the play side, power seals away from the
// hole), a combo double team climbs to a backer, receivers stalk-block the
// defensive backs, backers and safeties read and fill, and every defender who
// gets off his block pursues on an angle. Nobody reaches the carrier before
// the tackle phase (resolveCarry), so the recorded result is untouched.

/** Who blocks whom on a run: single / double (with a climb), stalks, a puller. */
interface RunAssign {
  /** blocker -> defender at the snap. */
  first: Record<string, string>
  /** blocker -> backer he climbs to when he leaves a double (or goes to at once). */
  climb: Record<string, string>
  /** The pulling guard (power), who runs behind the line to the hole first. */
  puller?: string
}

function runAssignments(power: boolean, side: number, fb: boolean): RunAssign {
  const first: Record<string, string> = { ol0: 'dl0', te: 'dl3', wr0: 'cb0', wr1: 'cb1', wr2: 's0' }
  const climb: Record<string, string> = {}
  const psLB = side > 0 ? 'lb2' : 'lb0'
  const bsLB = side > 0 ? 'lb0' : 'lb2'
  if (fb) {
    first.fb = psLB
    delete first.wr2 // animflow r6b: no slot in a fullback set
  }
  if (!power) {
    // Zone: a combo on the play-side interior man; the centre climbs to the mike.
    if (side > 0) {
      Object.assign(first, { ol1: 'dl1', ol2: 'dl2', ol3: 'dl2', ol4: 'dl3' })
      climb.ol2 = 'lb1'
      climb.ol4 = fb ? bsLB : psLB
    } else {
      Object.assign(first, { ol1: 'dl1', ol2: 'dl1', ol3: 'dl2', ol4: 'dl3' })
      climb.ol2 = 'lb1'
      climb.ol4 = bsLB
    }
    return { first, climb }
  }
  // Power: the backside guard pulls through the hole to the play-side backer;
  // the centre back-blocks his man; a play-side double climbs to the mike.
  if (side > 0) {
    Object.assign(first, { ol1: psLB, ol2: 'dl1', ol3: 'dl2', ol4: 'dl2' })
    climb.ol4 = 'lb1'
    if (fb) first.fb = 'lb1'
    return { first, climb, puller: 'ol1' }
  }
  Object.assign(first, { ol3: psLB, ol2: 'dl2', ol1: 'dl1', ol4: 'dl3' })
  if (fb) first.fb = 'dl0'
  else first.ol0 = 'dl0'
  climb.ol4 = bsLB
  first.te = 'dl3'
  return { first, climb, puller: 'ol3' }
}

/** Rating of a blocker against a man (run block or pass block). */
function blockOf(p: Player | undefined, pass: boolean): number {
  return pass ? bestAttr(p, ['PBK', 'PBP', 'PBF']) : bestAttr(p, ['RBK', 'RBP', 'RBF', 'IMP'])
}

/** Seconds a man needs to read the play (play recognition / awareness). */
function readTime(p: Player | undefined, base: number, seed: number): number {
  const prc = attrNum(p, 'PRC', attrNum(p, 'AWR', 70))
  return clampN(base + (85 - prc) * 0.011 + hash(seed) * 0.15, base - 0.1, base + 0.75)
}

function buildRun(play: Play, ctx: AnimContext, slow = 1): PlayAnim {
  recStart()
  const los = 10 + play.startYard
  const hasFb = formationHasFullback(formationForConcept(play.concept))
  const snapK = snapKindFor(play.concept)
  const f = formation(los, hasFb, snapK)
  const seed = play.n * 7 + play.startYard
  const qbRun = !!ctx.carrierIsQB || /QB Draw|Scramble|Sneak/.test(play.concept)
  // animflow r8 (J38): a WILDCAT is a direct snap to the back (he lines up in the gun spot, the
  // quarterback split out wide as a decoy); a JET SWEEP is a receiver in full-speed jet motion
  // across the formation at the snap, handed the ball as he passes the quarterback.
  const wildcat = !qbRun && play.featured === 'wildcat'
  const jet = !qbRun && !wildcat && (play.featured === 'jet' || play.concept === 'Jet Sweep')
  const side0 = hash(seed) < 0.5 ? -1 : 1
  const carRole = ctx.actors?.get('rb')?.pos === 'WR' ? 'WR' : 'RB'
  if (wildcat) {
    f.rb = { x: los - 5, y: MID_Y, side: 'off', role: carRole }
    f.qb = { x: los - 1.0, y: clampY(MID_Y - side0 * 10.5), side: 'off', role: 'QB' }
  }
  const jetMeshX = snapK === 'under' ? f.qb.x - 0.6 : f.qb.x + 1.1
  if (jet) f.rb = { x: jetMeshX, y: clampY(MID_Y - side0 * 6.5), side: 'off', role: carRole }
  const m = startMovers(f, ctx)
  recSnap(los)
  const wide = /Outside|Toss|Sweep|Stretch|Pitch|Bubble/.test(play.concept)
  const power = /Power|Counter|Trap|Iso|Dive/.test(play.concept)
  const side = hash(seed) < 0.5 ? -1 : 1
  // Inside holes sit between the guards and tackles (NFL R4: inside runs cross
  // the line ~1.5 yd from the ball); designed outside runs bend to the edge.
  const holeY = MID_Y + side * (wide ? 11 + hash(seed + 1) * 4 : 0.8 + hash(seed + 1) * 2.8)
  const endX = clampX(10 + play.endYard)
  const fumble = !!play.turnover
  // ── the carrier's line (animflow r4: NFL tracking targets, logs/nfl-motion-reference.out) ──
  // He presses the hole, makes ONE decisive cut, then gets north-south: a single
  // smooth arc with no weave (lateral velocity changes sign at most once, at the
  // cut), drifting <= ~1.6 yd per 5 yd downfield after the line (R1-R3). Lateral
  // travel is spent behind the line: inside runs cross within ~1.5 yd of the
  // hole, designed outside runs bend wide and turn up past the edge (R4). A
  // sharp cut costs speed (he keeps ~half of it through a > 45 deg cut, R7).
  const gain = endX - los
  const cutback = !wide && !power && !qbRun && hash(seed + 6) < 0.2
  // The lane he finishes in: the hole, or the back side on a cutback.
  const lane = cutback ? clampY(holeY - side * (2.5 + hash(seed + 8) * 2)) : holeY
  // Drift after the line keeps going the way he cut (never back): per NFL R3.
  const driftDir = cutback ? -side : side
  const drift = Math.max(0, gain) * (wide ? 0.32 : 0.24) * (0.4 + hash(seed + 2) * 0.6) + (Math.abs(play.yards) > 12 ? hash(seed + 9) * 4 : 0)
  // T2M: a run that went out of bounds finishes against the sideline, not in the
  // middle of the field. The end spot (x) is unchanged.
  const endY = play.outOfBounds
    ? (side < 0 ? 1.6 : FIELD_H - 1.6)
    : clampY(lane + driftDir * drift)
  const carrier = qbRun ? 'qb' : 'rb'
  const holeX = los - (play.yards < 0 ? 0.5 : -0.4)
  // Under centre the QB opens and gets back to the mesh ~3.5 yd deep (animflow r6c2).
  const meshX = snapK === 'under' ? (qbRun ? f.qb.x - 0.6 : los - 3.4) : qbRun ? f.qb.x - 1 : f.qb.x + 0.7
  const meshY = qbRun ? MID_Y : MID_Y + side * 1.4

  // The run after the hole: one arc toward the end spot, bowed (a little) only
  // in the direction he is already drifting, so it never snakes back.
  const bow = (endY - lane) * 0.12
  const ctrl = { x: (holeX + endX) / 2, y: (lane + endY) / 2 + bow }
  const curve: Pt[] = []
  const SAMPLES = 24
  for (let i = 0; i <= SAMPLES; i++) {
    const u = i / SAMPLES
    curve.push({
      x: clampX((1 - u) * (1 - u) * holeX + 2 * (1 - u) * u * ctrl.x + u * u * endX),
      y: clampY((1 - u) * (1 - u) * lane + 2 * (1 - u) * u * ctrl.y + u * u * endY),
    })
  }

  // R5: a broken tackle is one sidestep away from the man (a jump cut that
  // carries on in the new lane), not a swerve that comes back.
  if ((play.missedTackleIds?.length ?? 0) > 0) {
    // animflow r6b (item 5): the cut's size follows the move he makes (same
    // pick as the broadcast pose): a juke steps well across, a spin a little, a
    // stiff arm / truck goes through the man nearly straight.
    const mv = carrierMove(ctx.actors?.get(carrier), (play.n ?? 0) * 7.31 + (play.startYard ?? 0))
    const jd = driftDir * (mv === 'juke' ? 1.3 : mv === 'spin' ? 0.6 : mv === 'stiffArm' ? 0.35 : 0.15)
    for (let i = 0; i < curve.length; i++) {
      const u = i / (curve.length - 1)
      if (u > 0.6) curve[i].y = clampY(curve[i].y + jd * clampN((u - 0.6) / 0.16, 0, 1) ** 2 * (3 - 2 * clampN((u - 0.6) / 0.16, 0, 1)))
    }
  }

  // ── the scripted backfield: mesh, handoff, the carry ──────────────────────
  // The back takes his open step and is already moving (~4-5 yd/s) through the
  // mesh: the handoff comes ~1.1-1.3 s after the snap, ~4 yd deep (R5).
  let handoffT = 0
  if (qbRun) {
    m.rb.run([{ x: los - 1, y: MID_Y - side * 5 }], { stop: true })
  } else if (wildcat) {
    // The snap comes straight to him; the split-out quarterback releases as a decoy.
    m.rb.hold(SNAP)
    handoffT = SNAP
    m.qb.run([{ x: los + 0.6, y: f.qb.y }, { x: los + 4.5, y: clampY(f.qb.y - side * 1.5) }], { stop: true })
  } else if (jet) {
    // Already flying across at the snap; the quarterback takes the snap and hands it to him
    // as he passes, then carries out his fake the other way.
    const rbPace = m.rb.pace
    const vJet = rbPace.top * 0.86
    m.rb.pace = { top: vJet, acc: rbPace.acc }
    m.rb.run([{ x: jetMeshX, y: MID_Y + side * 0.6 }], { v0: vJet, stop: false })
    m.rb.pace = rbPace
    handoffT = Math.max(m.rb.t, SNAP + 0.3)
    m.qb.run([{ x: snapK === 'under' ? f.qb.x - 0.5 : f.qb.x + 0.3, y: MID_Y }], { stop: true })
    m.qb.hold(Math.max(0, handoffT - m.qb.t))
    m.qb.run([{ x: (snapK === 'under' ? f.qb.x - 0.5 : f.qb.x) - 1.5, y: MID_Y - side * 4 }], { stop: false })
  } else {
    const meshPt = { x: meshX, y: meshY }
    m.qb.run([meshPt], { stop: true })
    const qbT = m.qb.t
    const delay = 0.05 + hash(seed + 10) * 0.15
    // A back accelerates at ~3.5 yd/s² (NFL E1), not the sprint ramp: he is at
    // mesh speed (~4.5 yd/s) when he takes the ball.
    const rbPace = m.rb.pace
    const approach = () => {
      m.rb.pace = { top: rbPace.top * 0.62, acc: Math.min(rbPace.acc, 3.6) }
      m.rb.run([meshPt], { stop: false })
      m.rb.pace = rbPace
    }
    m.rb.hold(delay)
    approach()
    if (m.rb.t < qbT + 0.05) {
      // He would beat the quarterback to the mesh: leave a beat later.
      const late = qbT + 0.05 - m.rb.t
      m.rb.reset(f.rb.x, f.rb.y)
      m.rb.hold(delay + late)
      approach()
    }
    handoffT = m.rb.t
    m.qb.hold(handoffT - m.qb.t)
    m.qb.run([{ x: (snapK === 'under' ? meshX : f.qb.x) - 1.5, y: MID_Y - side * 4 }], { stop: false })
  }
  // animflow r8 (J38): the snap - to the quarterback, or on a wildcat straight back to the runner.
  const runSnap = (toSec: number): WP[] => (wildcat ? [{ t: 0, x: los, y: MID_Y }, { t: SNAP, ...posAt(m.rb.path, SNAP) }] : snapBall(m, los, toSec))
  // Press and cut: he presses the play side under control (vision, ~3/4 pace),
  // brakes into his one cut and comes out of it into the lane.
  // The carry pace: inside runs are run at a modest speed (NFL R6: inside peak
  // ~4 yd/s, outside ~6, breakaways 8-9), long gains open up to full speed,
  // and a back builds speed at ~4 yd/s² (E1), not in a few steps.
  const carryK = clampN(0.6 + 0.012 * Math.max(0, gain) + (wide ? 0.1 : 0) + (jet ? 0.15 : 0), 0.6, 1) * slow
  // Burst by rating: ~3.2 yd/s² (ACC 65) to ~4.6 (ACC 99), the NFL band.
  const accCap = (mv: Mover) => clampN(3.4 + (attrNum(mv.player, 'ACC', 75) - 70) * 0.045, 3.0, 4.8)
  const press = (mv: Mover) => {
    const orig = mv.pace
    const saved = { top: mv.pace.top * carryK, acc: Math.min(mv.pace.acc, accCap(mv)) }
    const vis = attrNum(mv.player, 'BCV', 70)
    // animflow r8 (J38): the jet man takes the ball at full speed and keeps it to the edge.
    const pressK = jet ? 0.95 : clampN(0.66 + (vis - 70) * 0.004, 0.6, 0.8)
    // Inside: press at the hole's shoulder; outside: bend to the edge, then turn up.
    const P = wide
      ? { x: holeX - 1.3, y: clampY(holeY - side * 1.0) }
      : cutback ? { x: holeX - 1.4, y: clampY(holeY + side * 0.4) } : { x: holeX - 1.4, y: clampY(holeY - side * 0.25) }
    // animflow r7a: an outside run turns up AT the edge (lane), not 0.3 yd past it and
    // back (that hook was a second lateral reversal at the hole).
    const H = { x: holeX, y: lane }
    const a0 = Math.atan2(P.y - mv.y, P.x - mv.x)
    const a1 = Math.atan2(H.y - P.y, H.x - P.x)
    let cut = Math.abs(a1 - a0)
    if (cut > Math.PI) cut = 2 * Math.PI - cut
    const keep = cut > Math.PI / 4 ? 0.5 : cut > Math.PI / 6 ? 0.72 : 0.95
    mv.pace = { top: saved.top * pressK, acc: saved.acc * 0.8 }
    const vIn = carrySpeed(mv)
    const vCut = saved.top * pressK * keep
    // Into the hole: a second bend (outside runs turning up, a cutback
    // squaring up downhill) is taken under control too.
    const a2 = Math.atan2(curve[Math.min(2, curve.length - 1)].y - H.y, curve[Math.min(2, curve.length - 1)].x - H.x)
    let bend = Math.abs(a2 - a1)
    if (bend > Math.PI) bend = 2 * Math.PI - bend
    const vH = bend > Math.PI / 4.5 ? Math.max(vCut, saved.top * 0.5) : undefined
    mv.run([P], { v0: vIn, stop: false, vEnd: vCut, cut: true })
    mv.pace = saved
    mv.run([H], { v0: vCut, stop: false, vEnd: vH, cut: true })
    mv.pace = orig
  }
  if (qbRun) {
    if (/Sneak/.test(play.concept)) m.qb.run([{ x: holeX, y: holeY }], { stop: false })
    else press(m.qb)
  } else {
    press(m.rb)
  }
  {
    const mv = m[carrier]
    mv.pace = { top: mv.pace.top * carryK, acc: Math.min(mv.pace.acc, accCap(mv)) }
  }
  const holeT = m[carrier].t
  const holeSpeed = carrySpeed(m[carrier])
  // The carry: the curve to a yard or two short of the recorded stop, where the
  // tackler meets him, then the pile goes forward to exactly that spot. A
  // fumble is a loose ball at the recorded spot, so there the carrier runs the
  // full curve and truly reaches it before the ball comes out; a touchdown runs
  // through the goal line.
  const scoreRun = endX >= 110
  let contactT: number
  if (fumble || scoreRun) {
    m[carrier].run(curve.slice(1), { v0: holeSpeed, stop: !scoreRun, cut: true })
    contactT = m[carrier].t
    // animflow r6c2 (297): a score is run through the line, not stopped on it.
    if (scoreRun) runThroughGoal(m[carrier], 110, 1)
  } else {
    const ac = yardsAfterContact(m[carrier].player, polyLen(curve[0], curve.slice(1)), seed)
    const { pre, post } = splitPolyline(curve[0], curve.slice(1), Math.max(0, polyLen(curve[0], curve.slice(1)) - ac))
    m[carrier].run(pre, { v0: holeSpeed, stop: false, cut: true })
    contactT = m[carrier].t
    pileDrive(m[carrier], post, carrySpeed(m[carrier]))
  }
  const endSec = m[carrier].t
  const popT = fumble ? Math.max(holeT + 0.1, endSec * 0.9) : endSec
  const liveTo = fumble ? popT : contactT
  const tackleFrom = Math.max(holeT * 0.5, liveTo - 1.4)

  // ── the live field ────────────────────────────────────────────────────────
  const credited = play.tackleIds?.[0]
  const creditedKey = credited ? DEF_KEYS.find((k) => ctx.actors?.get(k)?.id === credited) : undefined
  const missKeys = (play.missedTackleIds ?? []).map((id) => keyOf(ctx, id, DEF_KEYS)).filter((k): k is string => !!k)
  const missAt = (k: string) => holeT + (liveTo - holeT) * (0.62 + missKeys.indexOf(k) * 0.08)
  const as = runAssignments(power, side, !!m.fb)
  const rate = (k: string) => m[k]?.player
  // A shrinking keep-out ring: pursuers close in as the tackle nears, but nobody
  // gets to the carrier before the tackle phase (contact is recorded at <= 1 yd).
  const keepFor = (k: string) => (t: number) => {
    // After the hit a man or two piles on; the rest close to a step away.
    const pile = hash(seed + DEF_KEYS.indexOf(k) * 2.7) < 0.28 ? 1.05 : 1.5
    const base = t <= liveTo ? 1.3 + 1.1 * clampN((liveTo - t) / 1.5, 0, 1) : 1.3 + (pile - 1.3) * clampN((t - liveTo) / Math.max(0.2, endSec - liveTo), 0, 1)
    if (missKeys.includes(k)) {
      const dm = Math.abs(t - missAt(k))
      if (dm < 0.3) return Math.min(base, 1.1)
      if (t > missAt(k)) return Math.max(base, 2.2)
    }
    return base
  }
  // animflow r6c: the side a run defender rips to (+1 / -1 across the pair axis): toward the ball.
  const ripSide = (fl: LiveField, pr: { def: string; ax: number; ay: number }) => {
    const a = fl.agents.get(pr.def)
    const c = fl.where(carrier)
    if (!a || !c) return side
    return Math.sign((c.x - a.x) * -pr.ay + (c.y - a.y) * pr.ax) || side
  }
  const credFree = clampN(0.2 + (bestAttr(rate(creditedKey ?? ''), ['BSH']) - 65) * 0.008 + hash(seed + 41) * 0.15, 0.1, 0.45)
  let credShed: number | null = null
  const pursueBrain = (k: string, i: number) => pursue(carrier, { keep: keepFor(k), lead: 0.8 + clampN((attrNum(rate(k), 'PUR') - 60) * 0.01, 0, 0.4), side: (hash(seed + i * 4.1) - 0.5) * 1.6, intercept: true })
  const hasCarrier = (t: number) => t >= (qbRun ? SNAP : handoffT)
  const field = new LiveField(0, {
    rec: (a, b, t0, t1, kind) => recEng(a, b, t0, t1, kind),
    plan: (blk, def, t, fl) => {
      const off = blockOf(rate(blk), false)
      const dfn = bestAttr(rate(def), ['BSH', 'STR'])
      const dl = def.startsWith('dl')
      const diff = clampN((off - dfn) * 0.035, -1.1, 1.1)
      // Forward push (yd/s): a winning blocker moves his man 1-3 yd over the
      // block; a losing one is pushed back into the backfield.
      const fwd = dl ? 0.3 + diff * 0.55 : 0.25 + diff * 0.4
      const pairPt = livePos(m[def].path, t)
      const pairY = pairPt.y
      const lat = wide || !power ? side * (wide ? 1.1 : 0.7) : Math.sign(pairY - holeY || side) * 0.55
      const doubled = Object.entries(as.first).filter(([, d]) => d === def).length > 1
      let hold = clampN((dl ? 1.5 : 1.0) + (off - dfn) * 0.025 + hash(seed + def.length * 7 + blk.length * 3) * 0.7 + (doubled ? 0.5 : 0), 0.6, 2.8)
      // A man in the hole holds until the carrier is by (a short / lost run is
      // the defense winning, and the credited tackler gets off in time).
      if (dl && Math.abs(pairY - holeY) < 3 && play.yards > 2) hold = Math.max(hold, holeT + 0.25 - t)
      // animflow r6c: the credited tackler sheds late enough that he is seen
      // ripping off the block and closing (not drifting beside his blocker for
      // 1.5 s): the time to cover the ground to the hit at a closing burst,
      // plus a beat — a little earlier for a better block shedder.
      if (def === creditedKey) {
        const cp = posAt(m[carrier].path, contactT)
        const free = clampN(Math.hypot(cp.x - pairPt.x, cp.y - pairPt.y) / 4.2 + credFree, 0.6, 1.8)
        hold = Math.min(hold, Math.max(0.3, Math.min(tackleFrom + 0.6, contactT - free) - t))
        // animflow r8: always clear of the block >= RUN_FREE_MIN s before the hit (the 0.3 s floor
        // above could leave him on it to ~0.28 s out when the pair formed late) - on any sim stream.
        hold = Math.min(hold, Math.max(0.08, contactT - RUN_FREE_MIN - t))
      }
      if (missKeys.includes(def)) hold = Math.min(hold, Math.max(0.3, missAt(def) - 1.0 - t))
      const shedAt = t + hold
      const climbAt = Object.keys(as.climb).some((b) => as.first[b] === def) ? t + 0.55 + hash(seed + 11) * 0.35 : undefined
      return {
        shedAt,
        climbAt,
        drive: (tt: number) => {
          const fade = 1 - 0.6 * clampN((tt - (shedAt - 0.5)) / 0.5, 0, 1)
          let vx = fwd * fade
          let vy = lat * fade
          // Open the hole: a pair in the carrier's lane is turned out of it.
          if (hasCarrier(tt)) {
            const p = fl.where(def) ?? { x: 0, y: 0 }
            for (const dt of [0, 0.35, 0.7]) {
              const c = livePos(m[carrier].path, tt + dt)
              const d = Math.hypot(c.x - p.x, c.y - p.y)
              if (d < 2.4) {
                vy += Math.sign(p.y - c.y || side) * (2.4 - d) * 1.1
                break
              }
            }
          }
          return { x: vx, y: vy }
        },
      } as PairPlan
    },
    onShed: (def, t, fl, pr) => {
      const a = fl.agents.get(def)
      if (!a) return
      // animflow r6c: he rips off the block — across the blocker's face to the
      // side of the ball and past his hip — then closes on the carrier.
      const c = fl.where(carrier) ?? { x: a.x, y: a.y }
      const s = ripSide(fl, pr)
      // A direction, not a spot (no braking into it): off the blocker's
      // shoulder on the ball side, aimed where the carrier is heading.
      const cv = fl.velOf(carrier, t)
      const lead = { x: c.x + cv.x * 0.4 - a.x, y: c.y + cv.y * 0.4 - a.y }
      const ll = Math.hypot(lead.x, lead.y) || 1
      // animflow r6d: the rip clears the blocker's hip harder (more across his face, a sharper first
      // step) — run sheds were 0.9 yd off the blocker 0.3 s after the shed vs the NFL's ~1.8 (BDB).
      const dx = -pr.ay * s * 1.6 + (lead.x / ll) * 0.9
      const dy = pr.ax * s * 1.6 + (lead.y / ll) * 0.9
      const dl = Math.hypot(dx, dy) || 1
      const rip = { x: a.x + (dx / dl) * 6, y: a.y + (dy / dl) * 6 }
      const close = pursueBrain(def, DEF_KEYS.indexOf(def))
      const t1 = t + RIP_SEC
      a.brain = (tt, me, f2) => (tt < t1 ? { x: rip.x, y: rip.y, speed: Math.max(6, me.mv.pace.top * 0.95), burst: 5.5 } : close(tt, me, f2))
      if (def === creditedKey) {
        credShed = t
        a.noBlock = true
      }
      recShed(def, pr.blk, t, t1 + 0.1, 'rip')
    },
    onRelease: (blk, t, fl, pr, beaten) => {
      const a = fl.agents.get(blk)
      if (!a || a.climb) return
      // Off his man: turn and run with the play, looking for work.
      const look = pursue(carrier, { keep: () => 3.2, speed: 0.55, lead: 0.3 })
      if (!beaten) {
        a.brain = look
        return
      }
      // animflow r6c: beaten — his weight carries him on into the space his
      // man left (over-extended, turned), then he turns and chases.
      const s = ripSide(fl, pr)
      // animflow r6d: he falls off the other way (his momentum was into the man who just left him).
      const lunge = { x: clampX(a.x + pr.ax * 0.8 + pr.ay * s * 0.9), y: clampY(a.y + pr.ay * 0.8 - pr.ax * s * 0.9) }
      a.recover = 0
      const chase = pursue(carrier, { keep: () => 3.4, speed: 0.45, lead: 0.3 })
      a.brain = (tt, me, f2) => (tt < t + 0.7 ? { x: lunge.x, y: lunge.y, speed: 3, burst: 2.5 } : chase(tt, me, f2))
    },
  }, seed)
  field.script(m[carrier])
  field.avoid = { key: carrier, r: 1.3, from: qbRun ? SNAP : Math.max(SNAP, handoffT - 0.3) }

  // Offense: the line, tight end, fullback and receivers block.
  for (const k of ['ol0', 'ol1', 'ol2', 'ol3', 'ol4', 'te', 'wr0', 'wr1', 'wr2', 'fb'].filter((x) => m[x])) {
    const target = as.first[k] ?? as.climb[k] ?? null
    const firstIsClimb = !as.first[k] && !!as.climb[k]
    const brain: Brain = pursue(carrier, { keep: () => 3.2, speed: 0.55, lead: 0.3 })
    const ag = field.add(m[k], 'off', brain, k === as.puller ? null : firstIsClimb ? null : target)
    if (as.climb[k] && !firstIsClimb) ag.climb = as.climb[k]
    if (k === as.puller) {
      // He finds his man once he is through the line.
      const want = target
      ag.brain = phases([
        { from: 0, brain: holdSpot({ x: los - 1.6, y: clampY(holeY - side * 0.8) }, m[k].pace.top) },
        { from: 0.75, brain: (t, me, fl) => { if (!me.target && want && !fl.engaged(want)) me.target = want; return holdSpot({ x: los + 1.5, y: holeY }, me.mv.pace.top)(t, me, fl) } },
      ])
    }
    if (firstIsClimb) {
      // Straight to the second level after a short set.
      const want = target
      ag.brain = (t, me, fl) => {
        if (t > 0.35 && !me.target && !me.pair && want && !fl.engaged(want) && t - me.freedAt > 1) me.target = want
        return { x: me.x + 0.6, y: me.y + side * 0.4, speed: 2.5 }
      }
    }
  }
  // Defense: the front fires off, backers read and fill, the secondary reads and comes down.
  // animflow r6d (J8a-2): the sim's per-defender reads. A man who BIT (biteIds) takes his first steps
  // the wrong way (with the backfield's flow / the fake, away from the hole) and reads late; the READ
  // KEY (readKeyId) diagnoses it fast and steps straight into the hole; the alley FILLER (fillId, a
  // safety) comes downhill into the alley outside the hole at once instead of reading from depth.
  const biteK = new Set((play.biteIds ?? []).map((id) => keyOf(ctx, id, DEF_KEYS)).filter((k): k is string => !!k))
  const readK = keyOf(ctx, play.readKeyId, DEF_KEYS)
  const fillK = keyOf(ctx, play.fillId, DEF_KEYS)
  DEF_KEYS.forEach((k, i) => {
    const p = rate(k)
    const start = { x: f[k].x, y: f[k].y }
    let brain: Brain
    const bit = biteK.has(k) && k !== readK
    if (k.startsWith('dl')) {
      brain = phases([
        bit
          // Bit: up the field and across the wrong shoulder, away from the play.
          ? { from: 0, brain: () => ({ x: los + 0.2, y: start.y - side * 1.6, speed: m[k].pace.top * 0.75 }) }
          : k === readK
            // Read it: squeeze inside toward the hole off the snap.
            ? { from: 0, brain: () => ({ x: los - 0.6, y: start.y + (holeY - start.y) * 0.45, speed: m[k].pace.top * 0.85 }) }
            : { from: 0, brain: () => ({ x: los - 0.6, y: start.y + side * 0.3, speed: m[k].pace.top * 0.8 }) },
        { from: bit ? 1.45 : k === readK ? 0.95 : 1.2, brain: pursueBrain(k, i) },
      ])
    } else if (k.startsWith('lb')) {
      const rt0 = readTime(p, 0.35, seed + i)
      const rt = bit ? rt0 + 0.35 : k === readK ? Math.max(0.2, rt0 * 0.6) : rt0
      brain = phases([
        bit
          // False step: flows two yards with the fake before he recovers.
          ? { from: 0, brain: () => ({ x: start.x + 0.6, y: start.y - side * 2.4, speed: 3.6 }) }
          : k === readK
            // Downhill into his gap from the first step.
            ? { from: 0, brain: () => ({ x: Math.max(holeX + 1.2, start.x - 2.5), y: start.y + (holeY - start.y) * 0.6, speed: 4.2 }) }
            // Read step: shuffle with the flow, eyes in the backfield.
            : { from: 0, brain: () => ({ x: start.x + 0.4, y: start.y + (holeY - start.y) * 0.25, speed: 2.2 }) },
        { from: rt, brain: pursueBrain(k, i) },
      ])
    } else if (k.startsWith('s')) {
      const rt = readTime(p, 0.55, seed + i)
      brain = k === fillK
        ? phases([
          // The alley: downhill outside the hole at a sprint, then he takes his angle on the ball.
          { from: 0, brain: () => ({ x: holeX + 4.5, y: clampY(holeY + side * 3), speed: m[k].pace.top * 0.85 }) },
          { from: Math.max(0.35, rt - 0.2), brain: pursueBrain(k, i) },
        ])
        : phases([
          { from: 0, brain: () => ({ x: start.x + 1.5, y: start.y + (holeY - start.y) * 0.1, speed: 2.4 }) },
          { from: rt, brain: pursueBrain(k, i) },
        ])
    } else {
      const rt = readTime(p, 0.5, seed + i)
      brain = phases([
        // Corners bail with their man, then come up to fill.
        { from: 0, brain: () => ({ x: start.x + 2.5, y: start.y, speed: 2.8 }) },
        { from: rt, brain: pursueBrain(k, i) },
      ])
    }
    field.add(m[k], 'def', brain)
  })
  // The passer carries out his fake, then drifts with the play.
  if (!qbRun) {
    const qbFree = m.qb.t
    field.run(Math.min(qbFree, liveTo))
    field.add(m.qb, 'off', pursue(carrier, { keep: () => 9, speed: 0.3, lead: 0 }))
  } else {
    field.run(Math.min(m.rb.t, liveTo))
    field.add(m.rb, 'off', pursue(carrier, { keep: () => 2.5, speed: 0.7, lead: 0.4 }))
  }
  field.run(tackleFrom)
  field.noContactAfter = tackleFrom
  // Who is still on a block when the tackle phase starts stays on it.
  const stillEngaged = new Set(DEF_KEYS.filter((k) => field.engaged(k) && k !== creditedKey))
  field.run(endSec + 0.6)
  field.closeAll(endSec + 0.6)

  if (fumble) {
    const spotX = changeSpot(play, ctx.next) ?? endX + 1
    const loose = { x: clampX(endX + 2), y: clampY(endY + (hash(seed + 5) - 0.5) * 6) }
    const free = DEF_KEYS.filter((k) => !stillEngaged.has(k))
    const recover = nearestKey(m, free.length ? free : DEF_KEYS, loose, popT)
    m[recover].run([{ x: loose.x, y: loose.y }, { x: clampX(spotX), y: loose.y }], { v0: seek(m[recover], popT), stop: true })
    const recT = m[recover].t
    recEv(popT, 'fumble', [carrier, recover], { x: loose.x, y: loose.y })
    recEv(popT + 0.02, 'turnover', [recover], { x: loose.x, y: loose.y })
    recEv(recT, 'down', [recover], { x: clampX(spotX), y: loose.y })
    recMissedTackles(play, ctx, carrier, holeT, popT, m, DEF_KEYS)
    pursueRun(m, free.filter((k) => k !== recover), popT, { x: endX, y: endY }, popT + 0.4, seed)
    capAll(m, ALL_KEYS(f), Math.max(recT, popT + 0.4))
    const ball: WP[] = [
      ...(qbRun ? snapBall(m, los, popT) : [...runSnap(handoffT), ...shadow(m[carrier].path, handoffT, popT).slice(1)]),
      { t: popT, x: loose.x, y: loose.y },
      ...shadow(m[recover].path, popT).slice(1),
    ]
    return finish(f, m, {
      ball,
      holders: [
        { t: 0, key: null },
        ...(wildcat ? [] : [{ t: SNAP, key: 'qb' }]),
        ...(qbRun ? [] : [{ t: handoffT, key: carrier }]),
        { t: popT, key: null },
        { t: recT, key: recover },
      ],
      flights: [{ t0: popT, t1: Math.min(recT, popT + 0.5), height: 0.4 }],
    })
  }

  const tacklers = DEF_KEYS.filter((k) => !stillEngaged.has(k))
  const cPt = posAt(m[carrier].path, contactT)
  // animflow r5: with real acceleration caps the credited man is often a beat
  // late; on a run he still makes it (hitAndRide meets the pile where it is).
  let tackler = chooseTackler(m, tacklers, creditedKey, cPt, tackleFrom, contactT - tackleFrom + 1.2)
  // A touchdown is chased, never forced: the closest man just runs with him.
  // animflow r6c: a credited man who shed inside the tackle phase closes from his rip.
  let hitFrom = tackler === creditedKey && credShed != null && credShed + 0.15 > tackleFrom ? Math.min(contactT - 0.2, credShed + 0.15) : tackleFrom
  if (!scoreRun && contactT - holeT > 0.6) {
    // animflow r6c2 (297): on a longer run the tackler has to be able to get
    // there. He leaves on his pursuit angle as early as he must (once off any
    // block); when even that is too late the carrier is drawn picking his way
    // a little slower (re-run, same result), so the credited man explains the
    // spot instead of the carrier stopping on his own.
    const busy = (k: string, t: number) => (REC?.eng ?? []).some((e) => (e.a === k || e.b === k) && (e.kind === 'block' || e.kind === 'double') && t >= e.t0 && t <= e.t1)
    const late = Math.min(contactT + 0.45, endSec - 0.15)
    const leave = (k: string, from: number): { s: number | null; best: number } => {
      let best = Infinity
      for (let s0 = from; s0 >= Math.max(holeT * 0.6, from - 2.6) - 1e-6; s0 -= 0.2) {
        if (busy(k, s0)) break
        const d = catchDist(m[k], m[carrier].path, s0, late)
        best = Math.min(best, d)
        if (d <= 2.0) return { s: s0, best: d }
      }
      return { s: null, best }
    }
    const mine = leave(tackler, hitFrom)
    if (mine.s != null) hitFrom = mine.s
    else if (slow > 0.75 && mine.best < Infinity) return buildRun(play, ctx, slow - 0.14)
    else {
      // Nobody credited can get there: the man who can makes the hit.
      let alt: { k: string; s: number; d: number } | null = null
      for (const k of tacklers) {
        if (k === tackler || !m[k] || missKeys.includes(k)) continue
        const r = leave(k, tackleFrom)
        if (r.s != null && (!alt || r.best < alt.d)) alt = { k, s: r.s, d: r.best }
      }
      if (alt) {
        tackler = alt.k
        hitFrom = alt.s
      }
    }
  }
  if (!scoreRun) hitAndRide(m[tackler], m[carrier], hitFrom, contactT, endSec)
  const res = { tackler, endSec }
  capAll(m, ALL_KEYS(f), res.endSec)
  if (play.outOfBounds && !scoreRun) stepOut(m[carrier], tackler ? [m[tackler]] : [])
  recMissedTackles(play, ctx, carrier, holeT, res.endSec, m, DEF_KEYS)
  recClose(m, carrier, res.tackler, res.endSec, DEF_KEYS, {
    play,
    los,
    from: 0.2,
    td: endX >= 110,
    tdX: 110,
    tdDir: 1,
    safety: !!play.safety,
    outOfBounds: !!play.outOfBounds,
  })
  const ball: WP[] = qbRun
    ? snapBall(m, los, res.endSec)
    : [...runSnap(handoffT), ...shadow(m[carrier].path, handoffT, res.endSec).slice(1)]
  return finish(f, m, {
    ball,
    holders: [
      { t: 0, key: null },
      ...(wildcat ? [] : [{ t: SNAP, key: 'qb' }]),
      ...(qbRun ? [] : [{ t: handoffT, key: carrier }]),
    ],
    flights: [],
  })
}

/** Which receiver dot the throw goes to. */
export function targetKey(play: Play, ctx: AnimContext): string {
  if (ctx.targetPos === 'RB') return 'rb'
  if (ctx.targetPos === 'TE') return 'te'
  if (/Screen/.test(play.concept)) return 'rb'
  // animflow r6b: a fullback set has no slot receiver (eleven on offense).
  if (formationHasFullback(formationForConcept(play.concept))) return ['wr0', 'wr1'][Math.floor(hash(play.n * 13 + play.startYard) * 2)]
  return ['wr0', 'wr1', 'wr2'][Math.floor(hash(play.n * 13 + play.startYard) * 3)]
}

// ── route tree ───────────────────────────────────────────────────────────────
// The route shapes live in `src/game/data/routes.ts` and the per-concept
// assignments in `src/game/data/playbookData.ts`. Any play in the book animates
// from its own assignments; an unknown concept falls back to a standard tree.

/** Route per receiver key for a concept. Every concept defines all five keys. */
function conceptTree(concept: string, rollSide: number): Record<string, string> {
  const play = playbookPlay(concept)
  const tree = play ? treeFor(play) : {}
  if (concept === 'Bootleg') {
    const roll = rollSide < 0 ? 'wr0' : 'wr1'
    const back = rollSide < 0 ? 'wr1' : 'wr0'
    return { [roll]: tree.wr0 ?? 'comeback', [back]: tree.wr1 ?? 'over', wr2: tree.wr2 ?? 'stick', te: tree.te ?? 'drag', rb: tree.rb ?? 'block' }
  }
  const fallback = { wr0: 'slant', wr1: 'go', wr2: 'quickOut', te: 'dig', rb: 'check' }
  return Object.keys(tree).length ? { ...fallback, ...tree } : fallback
}

/** animflow r6b: route rating at which a break is a crisp plant (effective-rating median). */
export const CRISP_RR = 75

/** Route running by depth: the same split the sim uses (SRR short, MRR 8–14, DRR 15+). */
function routeRunRating(p: Player | undefined, depth: number): number {
  return attrNum(p, depth > 14 ? 'DRR' : depth > 7 ? 'MRR' : 'SRR', 70)
}

/** Run a route: high route running = a crisp near-stop cut, low = a rounded drift. */
function runRoute(mv: Mover, pts: Pt[], breakIdx: number, rr: number, stemPace = 1, through = 0, flat = false, vIn = 0) {
  // animflow r8: out of the release he is already moving (no stop between the jab and the stem).
  const v0 = vIn
  const saved = mv.pace
  // The stem can be run under control (animflow round 2: timed to the drop);
  // out of the break he is at full speed again.
  const stem = () => { if (stemPace < 1) mv.pace = { top: saved.top * stemPace, acc: saved.acc * Math.min(1, stemPace + 0.1) } }
  // animflow r6c2 (302): a route the ball meets in stride is run on through
  // its last point (`through` yd more along the final leg), not braked onto it.
  const ext = (seg: Pt[], from: Pt): Pt[] => {
    if (!through || !seg.length) return seg
    const b = seg[seg.length - 1]
    const a = seg.length >= 2 ? seg[seg.length - 2] : from
    // `flat`: no room left before the recorded spot — he carries on across, not upfield.
    const ax = flat ? (b.x - a.x) * 0.15 : b.x - a.x
    const L = Math.hypot(ax, b.y - a.y) || 1
    const e = { x: clampX(b.x + (ax / L) * through), y: clampY(b.y + ((b.y - a.y) / L) * through) }
    const got = Math.hypot(e.x - b.x, e.y - b.y)
    // Running out of field (an out at the sideline): he turns up it.
    if (got < through * 0.5) {
      const c = { x: clampX(b.x + (ax / L) * Math.min(got, 1.2)), y: clampY(b.y + ((b.y - a.y) / L) * Math.min(got, 1.2)) }
      return [...seg, c, { x: clampX(c.x + 1.6), y: clampY(c.y + (MID_Y - c.y) * 0.05) }, { x: clampX(c.x + through * 0.8), y: c.y }]
    }
    return [...seg, e]
  }
  if (breakIdx <= 0 || breakIdx >= pts.length - 1) {
    stem()
    mv.run(ext(pts, { x: mv.x, y: mv.y }), { v0, stop: true })
    mv.pace = saved
    return
  }
  // animflow r6b: re-tuned on the sim's effective ratings (WR SRR/MRR/DRR p10/50/90
  // 66/75/87; before every real WR read 70 and never cut crisp): the upper half
  // of the league plants and snaps, the lower half rounds the break.
  const crisp = rr >= CRISP_RR
  stem()
  // animflow r8: he sinks his hips and cuts at speed - a crisp route runner drops to ~a third of his
  // speed in the plant and is out of it fast; a rounded break keeps more speed but drifts (was a
  // full stop at every break: routes read as stop-and-go jogging).
  const vCut = saved.top * (crisp ? clampN(0.36 - (rr - CRISP_RR) * 0.004, 0.28, 0.36) : 0.5)
  mv.run(pts.slice(0, breakIdx + 1), { v0, stop: false, vEnd: Math.min(vCut, mv.pace.top) })
  const vOut = Math.min(vCut, mv.pace.top)
  mv.pace = saved
  mv.run(ext(pts.slice(breakIdx + 1), pts[breakIdx]), { v0: vOut, stop: true, cut: true })
}

// ── coverage look (backlog 151) ───────────────────────────────────────────────
// Every eligible receiver who runs a route has a visible defender or a zone
// responsibility: corners/slot cover the wideouts, backers take the tight end
// and back, safeties stay over the top — man in the hip pocket or zone drops
// with elbows on the QB. The scheme is the play's recorded call when it has one,
// otherwise a deterministic look per play. Presentation only.

/** Total length of an actor path (yd). */
function pathLen(path: WP[]): number {
  let s = 0
  for (let i = 1; i < path.length; i++) s += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
  return s
}

/** The defensive look: the recorded call, else a stable pick per play. */
/**
 * animflow r6d: a pre-snap alignment that is not where the man's scripted path starts (a disguised
 * shell, a safety rotating down, a corner travelling with the WR1). He stands at `pre` until the snap,
 * then the offset bleeds out (smoothstep) over a rotation window long enough to keep it under ~7 yd/s
 * on top of his own motion, so his path from the snap on is unchanged once the window is over.
 */
function presnapShift(mv: Mover, pre: Pt, maxEnd = Infinity, minDur = 0.8): void {
  const p0 = mv.path[0]
  let dx = clampX(pre.x) - p0.x
  let dy = clampY(pre.y) - p0.y
  const d = Math.hypot(dx, dy)
  if (d < 0.05 || maxEnd < SNAP + minDur) return
  // He must be back on his scripted path by `maxEnd` (his catch / pressure moment): a late, far
  // rotation is cut short (he shows less of the other look) rather than run faster than ~7 yd/s.
  const dur = Math.min(Math.max(minDur, d / 4.6), maxEnd - SNAP)
  const k0 = Math.min(1, (4.6 * dur) / d)
  dx *= k0
  dy *= k0
  pre = { x: p0.x + dx, y: p0.y + dy }
  const t1 = SNAP + dur
  // Resample the window so the offset is applied smoothly between sparse knots.
  const out: WP[] = [{ t: 0, x: pre.x, y: pre.y }, { t: SNAP, x: posAt(mv.path, SNAP).x + dx, y: posAt(mv.path, SNAP).y + dy }]
  const end = mv.path[mv.path.length - 1].t
  for (let t = SNAP + 0.05; t < Math.min(t1, end); t += 0.05) {
    const u = (t - SNAP) / dur
    const k = 1 - u * u * (3 - 2 * u)
    const q = posAt(mv.path, t)
    out.push({ t, x: clampX(q.x + dx * k), y: clampY(q.y + dy * k) })
  }
  for (const w of mv.path) if (w.t >= t1) out.push(w)
  if (end < t1) {
    // He never moved after the snap: walk the rest of the way to his spot.
    out.push({ t: t1, x: mv.path[mv.path.length - 1].x, y: mv.path[mv.path.length - 1].y })
    if (mv.t < t1) mv.t = t1
  }
  mv.path = out
}
/**
 * animflow r6d (J6 / T2M): a carrier who went out of bounds steps over the sideline instead of
 * stopping a yard and a half inside it. The last ~0.45 s of his path (and of a man riding him out)
 * bends out to ~0.8 yd past the line; x is untouched, so the end spot is the same.
 */
function stepOut(mv: Mover, riders: Mover[] = [], win = 0.45): void {
  const end = mv.path[mv.path.length - 1]
  const tEnd = end.t
  const side = end.y < MID_Y ? -1 : 1
  const edge = side < 0 ? 0 : FIELD_H
  if (Math.abs(end.y - edge) > 3.2) return
  const dy = (side < 0 ? -0.8 : FIELD_H + 0.8) - end.y
  const bend = (who: Mover) => {
    const t0 = Math.max(0, tEnd - win)
    const out: WP[] = who.path.filter((w) => w.t < t0)
    out.push({ t: t0, ...posAt(who.path, t0) })
    for (let t = t0 + 0.05; t < tEnd + 1e-6; t += 0.05) {
      const u = Math.min(1, (t - t0) / win)
      const q = posAt(who.path, t)
      out.push({ t, x: q.x, y: q.y + dy * u * u * (3 - 2 * u) })
    }
    const last = who.path[who.path.length - 1]
    if (last.t > tEnd + 1e-6) {
      for (const w of who.path) if (w.t > tEnd + 1e-6) out.push({ t: w.t, x: w.x, y: w.y + dy })
    } else {
      const q = posAt(who.path, tEnd)
      if (out[out.length - 1].t < tEnd - 1e-6) out.push({ t: tEnd, x: q.x, y: q.y + dy })
      else out[out.length - 1] = { t: tEnd, x: q.x, y: q.y + dy }
    }
    who.path = out
    const l = out[out.length - 1]
    who.x = l.x
    who.y = l.y
  }
  bend(mv)
  for (const r of riders) {
    const q = posAt(r.path, tEnd)
    if (Math.hypot(q.x - end.x, q.y - end.y) < 2.2) bend(r)
  }
}

function coverageScheme(play: Play, seed: number): 'man' | 'zone' | 'blitz' | 'twoHigh' | 'stack' {
  if (play.defCall) return play.defCall
  if (play.blitz) return 'blitz'
  const h = hash(seed + 71)
  if (h < 0.42) return 'man'
  if (h < 0.74) return 'zone'
  if (h < 0.87) return 'twoHigh'
  return 'blitz'
}

interface RouteInfo { depth: number; vert: boolean; inBreak: boolean }

/** Rough classification of a route from its tree entry. */
function routeInfo(name: string): RouteInfo {
  const depth = ROUTES[name]?.depth ?? 8
  const vert = depth >= 15
  const inBreak = /slant|dig|cross|drag|mesh|in\b|post|angle|choice/i.test(name)
  return { depth, vert, inBreak }
}

/**
 * Run a coverage shape so it lasts until `toSec`. A defender faster than the
 * receiver is slowed onto the receiver's own schedule, so he stays in phase and
 * keeps moving through the catch instead of arriving early and standing still.
 * A defender slower than the shape keeps his full pace (he trails — a genuine
 * blown coverage, matching a recorded big gain).
 */
function runTimed(mv: Mover, pts: Pt[], fromSec: number, toSec: number, drift = true, stop = false, maxBoost = 1, v0 = 0) {
  if (!pts.length) return
  const all = [{ x: mv.x, y: mv.y }, ...pts]
  const T = Math.max(0.05, toSec - fromSec)
  const saved = mv.pace
  // Scale the pace so the move spans exactly the window. A pure trial timing is
  // bisected, because the true traversal includes the acceleration ramp and any
  // plant: the closed-form estimate misses by half a ramp, which left a cover
  // defender arriving a fraction of a second late (a visibly loose catch). A
  // cover defender may be boosted a little (technique) so his rating, not raw
  // speed, sets the gap; the cap is the boost limit.
  const timeFor = (f: number) => {
    const k = timedLine(all, { top: saved.top * f, acc: Math.max(0.05, saved.acc * f) }, { v0, stop })
    return k.length ? k[k.length - 1].t : 0
  }
  let f: number
  if (timeFor(maxBoost) >= T) f = maxBoost
  else if (timeFor(0.03) <= T) f = 0.03
  else {
    let lo = 0.03
    let hi = maxBoost
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2
      if (timeFor(mid) > T) lo = mid
      else hi = mid
    }
    f = (lo + hi) / 2
  }
  if (Math.abs(f - 1) > 1e-6) mv.pace = { top: saved.top * f, acc: Math.max(0.05, saved.acc * f) }
  mv.run(pts, { v0, stop })
  mv.pace = saved
  if (!drift) {
    void fromSec
    return
  }
  // Last resort: if he still came up short, keep a live drift to the catch so
  // capAt does not freeze him mid-window (v0 carried so there is no speed cliff).
  for (let g = 0; g < 2 && toSec - mv.t > 0.04; g++) {
    const a = mv.path[mv.path.length - 2]
    const b = mv.path[mv.path.length - 1]
    if (!a) break
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    if (d < 1e-4) break
    const rem = toSec - mv.t
    const v0 = carrySpeed(mv)
    const speed = Math.max(0.9, v0 * 0.4)
    mv.pace = { top: speed, acc: Math.max(1, speed / Math.max(0.08, rem)) }
    mv.run([{ x: clampX(mv.x + ((b.x - a.x) / d) * speed * rem), y: clampY(mv.y + ((b.y - a.y) / d) * speed * rem) }], { v0, stop: false })
    mv.pace = saved
  }
  void fromSec
}

/**
 * Keep a coverage defender's feet moving through the whole window: a small
 * shuffle (zero at both ends, so alignment and the catch point are unchanged)
 * so he never reads as frozen when his man has run out of route or a zone
 * landmark is reached. Presentation only.
 */
function keepLive(shape: Pt[], fromSec: number, toSec: number) {
  if (shape.length < 3) return
  const T = Math.max(0.1, toSec - fromSec)
  // A constant-rate zigzag (zero at both ends) so the shuffle's own speed is a
  // steady ~0.9 yd/s and cannot itself spike: 4*amp/T.
  const amp = clampN(0.22 * T, 0.15, 0.9)
  const n = shape.length - 1
  for (let i = 1; i < n; i++) {
    const u = i / n
    const tri = u <= 0.25 ? u / 0.25 : u <= 0.75 ? 1 - ((u - 0.25) / 0.5) * 2 : (u - 0.75) / 0.25 - 1
    const s = tri * amp
    shape[i] = { x: clampX(shape[i].x + s * 0.25), y: clampY(shape[i].y + s) }
  }
}

/**
 * A man defender running with a receiver (backlog 153). He aligns 1–7 yd off
 * (press for a good corner, off for a poor one), then mirrors the route: the
 * separation he gives up at the break comes from the receiver's route running
 * for that depth (SRR short / MRR 8–14 / DRR deep) against the corner's man
 * coverage (plus a step of speed/acceleration on verticals). A superior route
 * runner breaks free by a step or more, an even matchup stays in phase, a
 * superior cover man mirrors the cut and stays in the hip pocket. The gap then
 * closes on whatever the recorded result needs at the catch.
 */
/** animflow r6a: nearest-defender separation at a completed catch (yd) by quantile, BDB 2021 by air depth. */
const SEP_CATCH_SHORT: [number, number][] = [[0, 0.8], [0.1, 1.84], [0.25, 3.09], [0.5, 4.92], [0.75, 7.31], [0.9, 9.0], [1, 10]]
const SEP_CATCH_MID: [number, number][] = [[0, 0.45], [0.1, 0.88], [0.25, 1.46], [0.5, 2.44], [0.75, 3.94], [0.9, 5.64], [1, 7]]
const SEP_CATCH_DEEP: [number, number][] = [[0, 0.45], [0.1, 0.77], [0.25, 1.27], [0.5, 2.35], [0.75, 4.2], [0.9, 5.94], [1, 7]]
function manTrail(
  def: Mover,
  recvKey: string,
  recv: Mover,
  opts: {
    fromSec: number
    toSec: number
    los: number
    cov: number
    inw: number
    tightness: number
    seed: number
    routeName: string
    zone?: boolean
    isTarget?: boolean
    result?: string
    gain?: number
  },
) {
  const { fromSec, toSec, los, cov, inw, seed } = opts
  const ri = routeInfo(opts.routeName)
  // Matchup: route running for this depth vs the defender's man coverage; a
  // step for speed/acceleration on a vertical route.
  const rr = routeRunRating(recv.player, ri.depth)
  const mcv = attrNum(def.player, 'MCV')
  let adv = rr - mcv
  if (ri.vert) {
    adv += (attrNum(recv.player, 'SPD') - attrNum(def.player, 'SPD')) * 0.5
    adv += (attrNum(recv.player, 'ACC') - attrNum(def.player, 'ACC')) * 0.25
  }
  // Separation the receiver wins at the break, from the matchup.
  let sepBreak = clampN(1.05 + adv * 0.115, 0.3, 3.0)
  // The gap at the catch is set by the recorded result.
  let sepCatch = clampN(0.5 + adv * 0.025, 0.3, 1.3)
  // animflow r6a: on a completion the beaten man is often trailing at the catch
  // (BDB 2021: 54% of first contacts after a catch come from behind).
  let trail = false
  if (opts.zone) {
    sepBreak = clampN(sepBreak + 0.35, 0.4, 3.2)
    sepCatch = clampN(sepCatch + 0.25, 0.4, 1.6)
  }
  if (opts.isTarget) {
    // Converge on the recorded result: a pick needs the defender at the ball; a
    // big gain leaves him trailing; other completions are contested; an
    // incomplete can still show a step of separation (a drop) when the receiver
    // had won the matchup.
    const gain = opts.gain ?? 0
    if (/Interception/.test(opts.result ?? '')) {
      // A pick: the defender is at the ball.
      sepBreak = Math.min(sepBreak, 1.0)
      sepCatch = 0.35
    } else if (/Incomplete/.test(opts.result ?? '')) {
      // A breakup / near-miss: tight, but a receiver who won the matchup can
      // still show a step (a drop).
      sepCatch = clampN(Math.max(sepCatch, sepBreak * 0.5) + opts.tightness * 0.2, 0.3, 1.4)
    } else {
      // animflow r6a: a completion is caught with real separation from the
      // nearest defender (BDB 2021 n 7.4k catches: median 4.9 yd under 5 air
      // yards, 2.4 at 5-15, 2.35 at 15+), the matchup and a big gain shifting
      // the draw; the defender gives the gap up over the route, never by
      // out-running the receiver.
      const air = posAt(recv.path, toSec).x - los
      const tab = air < 5 ? SEP_CATCH_SHORT : air < 15 ? SEP_CATCH_MID : SEP_CATCH_DEEP
      const u = clampN(hash(seed + 29) * 0.9 + 0.05 + adv * 0.006 + (gain >= 20 ? 0.25 : 0) + opts.tightness * 0.1, 0, 1)
      sepCatch = Math.min(4.5, curveAt(tab, u))
      // A man within a yard at the catch makes the tackle there: a long run
      // after the catch starts with him at least a step away.
      if ((opts.gain ?? 0) - air > 3) sepCatch = Math.max(sepCatch, 1.3)
      sepBreak = Math.max(sepBreak, sepCatch)
      trail = hash(seed + 33) < 0.55
    }
  }
  // The cushion only ever shrinks, so the defender never has to out-run the
  // receiver to close the gap: his path is no longer than the receiver's.
  sepCatch = Math.min(sepCatch, sepBreak)
  const cushBase = opts.zone ? 1.5 : 1
  // Underneath/quick routes are covered tight (press or off); only vertical
  // routes get a deep cushion. This keeps the defender close from the snap.
  const base = clampN(7 - (cov - 60) * 0.09, 1.5, 7) * cushBase * (0.55 + hash(seed + 5) * 0.45)
  const sep0 = clampN(Math.max(base, sepBreak + 1.1), 1.4, 8)
  const perp = ri.vert ? 0 : ri.inBreak ? inw * 0.8 : -inw * 0.3
  const steps = 26
  const shape: Pt[] = []
  // animflow r6a: the cover man reads the break ~0.3 s late (BDB 2021 n 1.2k
  // breaks: median 0.3 s, p90 0.6): through the route he keeps running where
  // the receiver was heading L seconds ago, then closes on the recorded catch.
  const lagS = clampN(0.3 + (70 - mcv) * 0.006 + (hash(seed + 13) - 0.5) * 0.2, 0.12, 0.55)
  const lagged = (t: number): Pt => {
    const a = posAt(recv.path, Math.max(fromSec, t - lagS))
    const b = posAt(recv.path, Math.max(fromSec, t - lagS - 0.4))
    return { x: a.x + ((a.x - b.x) / 0.4) * lagS, y: a.y + ((a.y - b.y) / 0.4) * lagS }
  }
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    const t = fromSec + (toSec - fromSec) * u
    const rNow = posAt(recv.path, t)
    const wl = clampN((u - 0.15) / 0.1, 0, 1) * clampN((0.86 - u) / 0.1, 0, 1)
    const rl = wl > 0 ? lagged(t) : rNow
    // Lateral read only: a hitch / comeback is not over-run (that would be a
    // plant and re-launch beyond a DB's real acceleration).
    const rp = { x: rNow.x + (Math.max(rl.x, rNow.x) - rNow.x) * wl * 0.5, y: rNow.y + (rl.y - rNow.y) * wl }
    // A cushion ahead that closes to the break gap, holds it through the cut,
    // then converges on what the recorded result needs at the catch.
    const sep = u <= 0.5
      ? sep0 + (sepBreak - sep0) * (u / 0.5)
      : u <= 0.78
        ? sepBreak
        : sepBreak + (sepCatch - sepBreak) * ((u - 0.78) / 0.22)
    if (trail && u > 0.5) {
      const e0 = clampN((u - 0.5) / 0.5, 0, 1)
      const e = e0 * e0 * (3 - 2 * e0)
      const sd = perp !== 0 ? Math.sign(perp) : hash(seed + 35) < 0.5 ? -1 : 1
      shape.push({ x: clampX(rp.x + sep * (1 - e) - 0.45 * sep * e), y: clampY(rp.y + perp * (1 - e) + sd * 0.9 * sep * e) })
    } else shape.push({ x: clampX(rp.x + sep), y: clampY(rp.y + perp) })
  }
  // Align on the receiver he is covering (a cushion off him), not on the line:
  // a back or tight end who lines up behind the line would otherwise be left
  // "open" while his man starts ten yards downfield.
  keepLive(shape, fromSec, toSec)
  def.reset(shape[0].x, shape[0].y)
  runTimed(def, shape, fromSec, toSec, true, false, 1.1)
  void recvKey
  void los
}

/**
 * A safety: backpedals to his deep responsibility, rotates with the deepest
 * threat, and drives on the throw — he never stands still before the catch.
 */
function safetyRoam(
  def: Mover,
  opts: { fromSec: number; toSec: number; releaseSec: number; los: number; deep: Mover | null; depth: number; catchPt: Pt; side: number; start: Pt },
) {
  const { fromSec, toSec, releaseSec, los, deep, depth, catchPt, side, start } = opts
  const back = los + Math.max(15, depth + 5)
  const half = side * 7
  const steps = 20
  const shape: Pt[] = []
  for (let i = 1; i <= steps; i++) {
    const t = fromSec + (toSec - fromSec) * (i / steps)
    const u = i / steps
    const deepP = deep ? posAt(deep.path, t) : { x: back, y: MID_Y + half }
    const tx = start.x + (back - start.x) * clampN(u * 1.7, 0, 1)
    const ty = start.y + (deepP.y + half - start.y) * (0.3 + 0.5 * u)
    const drive = t > releaseSec ? clampN((t - releaseSec) / Math.max(0.15, toSec - releaseSec), 0, 1) : 0
    shape.push({
      x: clampX(tx + (catchPt.x - tx) * drive * 0.6),
      y: clampY(ty + (catchPt.y - ty) * drive * 0.6),
    })
  }
  keepLive(shape, fromSec, toSec)
  runTimed(def, shape, fromSec, toSec)
}

/**
 * A zone defender: drops to a sensible landmark with a ZCV-set depth, keeps
 * his eyes on the nearest threat, closes as a receiver enters the zone and
 * breaks on the ball after the release.
 */
function zoneDrop(
  def: Mover,
  opts: { fromSec: number; toSec: number; releaseSec: number; landmark: Pt; zcv: number; threat: Mover | null; catchPt: Pt },
) {
  const { fromSec, toSec, releaseSec, landmark, zcv, threat, catchPt } = opts
  const sx = def.x
  const sy = def.y
  const sink = clampN((zcv - 60) * 0.05, -0.3, 1.6)
  const steps = 20
  const shape: Pt[] = []
  for (let i = 1; i <= steps; i++) {
    const t = fromSec + (toSec - fromSec) * (i / steps)
    const u = i / steps
    const bx = landmark.x + sink
    let tx = sx + (bx - sx) * clampN(u * 1.8, 0, 1)
    let ty = sy + (landmark.y - sy) * clampN(u * 1.8, 0, 1)
    if (threat) {
      const tp = posAt(threat.path, t)
      const w = clampN(1 - Math.hypot(tp.x - bx, tp.y - landmark.y) / 16, 0, 0.55)
      tx += (tp.x - tx) * w * u
      ty += (tp.y - ty) * w * u
    }
    if (t > releaseSec && threat) {
      const tp = posAt(threat.path, t)
      const near = clampN(1 - Math.hypot(tp.x - catchPt.x, tp.y - catchPt.y) / 11, 0, 1)
      const drive = clampN((t - releaseSec) / Math.max(0.15, toSec - releaseSec), 0, 1)
      tx += (catchPt.x - tx) * drive * (0.25 + 0.45 * near)
      ty += (catchPt.y - ty) * drive * (0.25 + 0.45 * near)
    }
    shape.push({ x: clampX(tx), y: clampY(ty) })
  }
  keepLive(shape, fromSec, toSec)
  runTimed(def, shape, fromSec, toSec)
}

/** Cap every actor's timeline at the play's end so no dot stands after the ball. */
function capAll(m: Record<string, Mover>, keys: string[], t: number) {
  for (const k of keys) if (m[k]) capAt(m[k], t)
}

// ── contact and the pile (animflow) ──────────────────────────────────────────
// A carry ends the way a real one does: the tackler squares up and meets the
// carrier a yard or two short of the recorded spot, the hit slows him, and the
// pile goes forward to exactly that spot (yards after contact from the
// carrier's power). No bow-and-loop to fill time, so no "pause, then tackle".

/** Yards a carrier drives the pile after first contact (power vs a short run). */
const YAC_CONTACT_Q: [number, number][] = [[0, -1], [0.1, -0.54], [0.25, 0.53], [0.5, 1.76], [0.75, 3.28], [0.9, 5.57], [1, 8]]
function yardsAfterContact(carrier: Player | undefined, total: number, seed: number): number {
  // animflow r6a: drawn from the NFL yards-after-contact shape (BDB 2021 n 3.6k:
  // p10 -0.5, median 1.8, p90 5.6; 16% stopped dead), the carrier's power
  // shifting the draw; never more than 60% of the carry.
  const pw = bestAttr(carrier, ['TRK', 'BTK', 'STR'])
  const u = clampN(hash(seed + 41) + (pw - 75) * 0.006, 0, 1)
  const ac = clampN(curveAt(YAC_CONTACT_Q, u), 0.3, 6)
  return Math.min(ac, Math.max(0.3, total * 0.6))
}

/** Arc length of the polyline a → pts. */
function polyLen(a: Pt, pts: Pt[]): number {
  let s = 0
  let p = a
  for (const q of pts) {
    s += Math.hypot(q.x - p.x, q.y - p.y)
    p = q
  }
  return s
}

/** Split the polyline a → pts at arc length `at`: points to the cut (ending on it), then on to the end. */
function splitPolyline(a: Pt, pts: Pt[], at: number): { pre: Pt[]; post: Pt[]; c: Pt } {
  const pre: Pt[] = []
  let s = 0
  let p = a
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i]
    const d = Math.hypot(q.x - p.x, q.y - p.y)
    if (s + d >= at) {
      const u = d > 1e-9 ? (at - s) / d : 1
      const c = { x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u }
      pre.push(c)
      return { pre, post: pts.slice(i), c }
    }
    pre.push(q)
    s += d
    p = q
  }
  const c = pts.length ? pts[pts.length - 1] : a
  return { pre, post: [], c }
}

/**
 * Contact: the hit takes the carrier's speed down hard, then he drives the pile
 * on along `pts` at a grinding pace and stops exactly on the last point.
 */
function pileDrive(mv: Mover, pts: Pt[], v0: number) {
  const L = polyLen({ x: mv.x, y: mv.y }, pts)
  if (L < 0.02 || !pts.length) {
    mv.lastStop = true
    return
  }
  const all = [{ x: mv.x, y: mv.y }, ...pts]
  const cum = [0]
  for (let i = 1; i < all.length; i++) cum.push(cum[i - 1] + Math.hypot(all[i].x - all[i - 1].x, all[i].y - all[i - 1].y))
  const at = (s: number): Pt => {
    let i = 0
    while (i < cum.length - 2 && cum[i + 1] < s) i++
    const seg = cum[i + 1] - cum[i]
    const u = seg > 1e-9 ? (s - cum[i]) / seg : 1
    return { x: all[i].x + (all[i + 1].x - all[i].x) * u, y: all[i].y + (all[i + 1].y - all[i].y) * u }
  }
  const drive = clampN(2.3 + (mv.pace.top - 7) * 0.25, 1.8, 3.2)
  const dt = 0.04
  let s = 0
  // animflow r6a: he falls forward with his legs still going (BDB 2021 n 3.3k:
  // carrier 4.7 yd/s at first contact, 3.7 yd/s 0.5 s later; contact to the
  // tackle median 0.9 s): an even slow-down over the yards after contact.
  let v = Math.max(drive, v0)
  const dec = clampN((v * v) / (2 * Math.max(0.3, L)), 0.8, 12)
  let t = 0
  while (s < L - 1e-4 && t < 4) {
    v = Math.max(1.2, v - dec * dt)
    const vEnd = Math.sqrt(2 * dec * Math.max(0, L - s)) + 0.15
    const sp = Math.min(v, vEnd)
    s = Math.min(L, s + sp * dt)
    t += dt
    const p = at(s)
    mv.path.push({ t: mv.t + t, x: p.x, y: p.y })
  }
  mv.t += t
  const end = all[all.length - 1]
  mv.x = end.x
  mv.y = end.y
  mv.path[mv.path.length - 1] = { t: mv.t, x: end.x, y: end.y }
  mv.lastStop = true
  mv.inHeading = undefined
}

/** Can-he-get-there time (s) from `fromSec` to `pt`, carrying his speed. */
function natTo(mv: Mover, pt: Pt, fromSec: number): number {
  const p = posAt(mv.path, fromSec)
  return straightTime(mv.pace, Math.hypot(pt.x - p.x, pt.y - p.y), Math.min(mv.pace.top, speedAtTime(mv.path, fromSec)))
}

/** The tackler who can make the contact in time: the credited man when he can, else the quickest. */
/** How late (s) the sim's credited tackler may be and still be drawn making the tackle. */
const TACKLE_SLACK = 0.6
function chooseTackler(m: Record<string, Mover>, keys: string[], prefer: string | undefined, c: Pt, fromSec: number, window: number): string {
  const cand = keys.filter((k) => m[k]).map((k) => ({ k, nat: natTo(m[k], c, fromSec) })).sort((a, b) => a.nat - b.nat)
  if (!cand.length) return keys[0]
  const pk = prefer ? cand.find((x) => x.k === prefer) : undefined
  if (pk && pk.nat <= window + TACKLE_SLACK) return pk.k
  return cand[0].k
}

/**
 * The tackler: from `fromSec` he times his run to meet the carrier at the
 * contact (squared up, a body's width off him on his own side), then rides the
 * carrier through the pile to the spot.
 */
function hitAndRide(tk: Mover, carrier: Mover, fromSec: number, contactT: number, endSec: number, vHit = 2.2) {
  let v0 = seek(tk, fromSec)
  let direct = false
  // animflow r6c2 (297): a man still well off the carrier runs his pursuit
  // angle at full speed first; the squared-up hit is only the last step.
  {
    const c0 = posAt(carrier.path, contactT)
    const until = contactT - 0.35
    if (until - fromSec > 0.2 && Math.hypot(c0.x - tk.x, c0.y - tk.y) > 3.5) {
      pursuitLeg(tk, carrier.path, until, 2.0, contactT)
      // Still not there: he keeps chasing into the pile (it is slowing).
      const cNow = posAt(carrier.path, tk.t)
      if (Math.hypot(cNow.x - tk.x, cNow.y - tk.y) > 2.6 && endSec - 0.12 > tk.t + 0.1) {
        // He runs him down in the pile: straight into the ride, no break-down step.
        pursuitLeg(tk, carrier.path, endSec - 0.12, 0.75, endSec)
        const cE = posAt(carrier.path, tk.t)
        if (Math.hypot(cE.x - tk.x, cE.y - tk.y) <= 1.1) direct = true
      }
      fromSec = tk.t
      const sv = speedVec(tk.path, tk.t)
      v0 = Math.min(tk.pace.top, Math.hypot(sv.x, sv.y))
      // Arriving from a chase he hits at speed (a closing tackle), not broken down.
      vHit = Math.max(vHit, v0 - 2)
    }
  }
  const start = { x: tk.x, y: tk.y }
  // A tackler who can't be there at the planned contact meets the carrier
  // where the carrier is when he does get there (the pile is already moving).
  let hitT = direct ? Math.max(contactT, tk.t) : contactT
  for (let i = 0; i < 3 && !direct; i++) {
    const cc = posAt(carrier.path, hitT)
    const nat = straightTime(tk.pace, Math.max(0, Math.hypot(cc.x - start.x, cc.y - start.y) - 0.6), Math.min(tk.pace.top, v0))
    hitT = clampN(Math.max(contactT, fromSec + nat), contactT, Math.max(contactT, endSec - 0.12))
  }
  contactT = hitT
  const c = posAt(carrier.path, contactT)
  let ux = start.x - c.x
  let uy = start.y - c.y
  let ul = Math.hypot(ux, uy)
  if (ul < 0.3) {
    const h = speedVec(carrier.path, contactT)
    ux = h.x
    uy = h.y
    ul = Math.hypot(ux, uy) || 1
  }
  ux /= ul
  uy /= ul
  const gap = 0.62
  const P = { x: clampX(c.x + ux * gap), y: clampY(c.y + uy * gap) }
  if (!direct) glideTo(tk, P, Math.max(0.08, contactT - fromSec), vHit)
  if (tk.t > endSec) {
    // animflow r6c2 (297): a beat late — he is into the pile as the whistle
    // goes (cut there, not braked back off it by the end-of-play cap).
    const q = posAt(tk.path, endSec)
    tk.path = tk.path.filter((w) => w.t < endSec)
    tk.path.push({ t: endSec, x: q.x, y: q.y })
    tk.t = endSec
    tk.x = q.x
    tk.y = q.y
    tk.lastStop = true
    tk.inHeading = undefined
    return
  }
  if (tk.t < contactT) tk.hold(contactT - tk.t)
  // animflow r6c2: the glide came up short of a carrier who kept going — he
  // chases him down into the pile instead of sliding the gap in a frame.
  {
    const cc = posAt(carrier.path, tk.t)
    if (Math.hypot(cc.x - tk.x, cc.y - tk.y) > 1.5 && endSec - tk.t > 0.12) {
      pursuitLeg(tk, carrier.path, endSec - 0.04, 0.75, endSec)
      const ce = posAt(carrier.path, tk.t)
      let vx = tk.x - ce.x
      let vy = tk.y - ce.y
      const vl = Math.hypot(vx, vy)
      if (vl > 0.3) {
        vx /= vl
        vy /= vl
        ux = vx
        uy = vy
      }
    }
  }
  // Ride the carrier to the spot (blend in over the first beat, no snap).
  const t0 = tk.t
  const from = { x: tk.x, y: tk.y }
  const tooFar = Math.hypot(posAt(carrier.path, t0).x + ux * gap - from.x, posAt(carrier.path, t0).y + uy * gap - from.y) > 1.5
  const dt = 0.04
  for (let t = t0 + dt; t < endSec + 1e-6 && !tooFar; t += dt) {
    const cp = posAt(carrier.path, t)
    const g = gap - 0.14 * clampN((t - t0) / 0.6, 0, 1)
    const want = { x: cp.x + ux * g, y: cp.y + uy * g }
    const e0 = clampN((t - t0) / 0.2, 0, 1)
    const e = e0 * e0 * (3 - 2 * e0)
    tk.path.push({ t, x: from.x + (want.x - from.x) * e, y: from.y + (want.y - from.y) * e })
  }
  const last = tk.path[tk.path.length - 1]
  tk.t = Math.max(tk.t, last.t)
  tk.x = last.x
  tk.y = last.y
  tk.lastStop = true
  tk.inHeading = undefined
}

/**
 * Glide from where the mover is (carrying his speed and heading) to `P` in
 * about `T` seconds, arriving at ~`vEnd` yd/s: a smooth curve that bends out of
 * his current heading, with a speed that changes evenly — no plant, no loop,
 * no early arrival and wait. Slower men simply arrive a little late.
 */
function glideTo(mv: Mover, P: Pt, T: number, vEnd: number) {
  const s0 = { x: mv.x, y: mv.y }
  const v = mv.path.length > 1 ? speedVec(mv.path, mv.t) : { x: 0, y: 0 }
  const sp = Math.min(mv.pace.top, Math.hypot(v.x, v.y))
  const D = Math.hypot(P.x - s0.x, P.y - s0.y)
  if (D < 0.05) {
    mv.hold(T)
    return
  }
  const dir = sp > 0.3 ? { x: v.x / sp, y: v.y / sp } : { x: (P.x - s0.x) / D, y: (P.y - s0.y) / D }
  const curve = (k: number) => {
    const C = { x: s0.x + dir.x * k, y: s0.y + dir.y * k }
    const pts: Pt[] = []
    for (let i = 0; i <= 24; i++) {
      const u = i / 24
      pts.push({ x: (1 - u) * (1 - u) * s0.x + 2 * (1 - u) * u * C.x + u * u * P.x, y: (1 - u) * (1 - u) * s0.y + 2 * (1 - u) * u * C.y + u * u * P.y })
    }
    return pts
  }
  const lenOf = (pts: Pt[]) => polyLen(pts[0], pts.slice(1))
  let k = clampN(sp * T * 0.3, 0, D * 0.5)
  let pts = curve(k)
  let L = lenOf(pts)
  // Too much time for the straight line: bend wider along his heading.
  for (let i = 0; i < 4 && (sp + vEnd) * 0.5 * T > L * 1.15 && k < 6; i++) {
    k = k * 1.6 + 0.5
    pts = curve(k)
    L = lenOf(pts)
  }
  // He breaks down to make the tackle: never arrives flat out.
  let v1 = clampN((2 * L) / T - sp, 0.6, Math.min(mv.pace.top * 1.1, vEnd + 2.6))
  let Tg = (2 * L) / Math.max(0.3, sp + v1)
  if (Tg < 0.04) {
    v1 = vEnd
    Tg = 0.04
  }
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  const at = (s: number): Pt => {
    let i = 0
    while (i < cum.length - 2 && cum[i + 1] < s) i++
    const seg = cum[i + 1] - cum[i]
    const u = seg > 1e-9 ? (s - cum[i]) / seg : 1
    return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * u, y: pts[i].y + (pts[i + 1].y - pts[i].y) * u }
  }
  const n = Math.max(2, Math.ceil(Tg / 0.04))
  for (let i = 1; i <= n; i++) {
    const t = (Tg * i) / n
    const sdist = Math.min(L, sp * t + ((v1 - sp) * t * t) / (2 * Tg))
    const q = at(sdist)
    mv.path.push({ t: mv.t + t, x: clampN(q.x, Math.min(1, s0.x), Math.max(FIELD_W - 1, s0.x)), y: clampN(q.y, Math.min(1.2, s0.y), Math.max(FIELD_H - 1.2, s0.y)) })
  }
  mv.t += Tg
  mv.x = P.x
  mv.y = P.y
  mv.path[mv.path.length - 1] = { t: mv.t, x: clampX(P.x), y: clampY(P.y) }
  mv.lastStop = v1 < 1
  mv.inHeading = undefined
}

/** Velocity (yd/s) along a path just before t. */
function speedVec(path: WP[], t: number): Pt {
  const dt = 0.04
  const a = posAt(path, Math.max(0, t - dt))
  const b = posAt(path, t)
  return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt }
}

/**
 * animflow r6c2 (backlog 297): the pursuit angle. The earliest point on the
 * carrier's (already scripted) path that a man at `p` running at `top` can
 * reach by the time the carrier gets there — not where the carrier is now (a
 * tail chase). When nobody could get there before `tMax` he runs at the end of
 * the path (the spot, the pylon).
 */
function interceptPt(carrierPath: WP[], p: Pt, t: number, top: number, tMax: number, reach = 0.8): Pt {
  for (let tau = t; tau <= tMax + 1e-6; tau += 0.05) {
    const c = posAt(carrierPath, tau)
    if (Math.hypot(c.x - p.x, c.y - p.y) - reach <= top * (tau - t)) return c
  }
  return posAt(carrierPath, tMax)
}

/**
 * animflow r6c2 (297): a full-speed pursuit leg on the intercept angle (time
 * stepped, his own top speed and acceleration) until he is `near` the carrier
 * or `untilSec`. A far-off tackler used to glide in at a breaking-down pace and
 * arrive after the whistle, leaving the carrier to stop on his own.
 */
function pursuitLeg(mv: Mover, carrierPath: WP[], untilSec: number, near: number, tAim: number) {
  let p = { x: mv.x, y: mv.y }
  let v = mv.path.length > 1 ? speedVec(mv.path, mv.t) : { x: 0, y: 0 }
  const top = mv.pace.top
  const acc = Math.max(3, mv.pace.acc)
  const dt = 0.05
  let t = mv.t
  while (t + dt <= untilSec + 1e-6) {
    const c = posAt(carrierPath, t)
    const d = Math.hypot(c.x - p.x, c.y - p.y)
    let want: Pt
    if (d <= near) {
      // Closed: run with him a step off on his own side until the hit.
      const cv = speedVec(carrierPath, t)
      const ux = d > 1e-6 ? (p.x - c.x) / d : 0
      const uy = d > 1e-6 ? (p.y - c.y) / d : 1
      want = { x: (c.x + ux * near - p.x) / 0.3 + cv.x, y: (c.y + uy * near - p.y) / 0.3 + cv.y }
      const wl = Math.hypot(want.x, want.y)
      if (wl > top) { want.x *= top / wl; want.y *= top / wl }
    } else {
      // The meeting point: the earliest spot on the carrier's line he can
      // reach, but no earlier than just before the planned hit (he does not
      // arrive early and brush the carrier — no phantom contact); he runs to
      // it at the pace that gets him there on time, flat out when he must.
      let aT = tAim
      for (let tau = t; tau <= tAim + 1e-6; tau += 0.05) {
        const q = posAt(carrierPath, tau)
        if (Math.hypot(q.x - p.x, q.y - p.y) - 0.8 <= top * (tau - t)) { aT = tau; break }
      }
      aT = Math.max(aT, tAim - 0.35)
      const aim = posAt(carrierPath, aT)
      const dx = aim.x - p.x
      const dy = aim.y - p.y
      const dl = Math.hypot(dx, dy) || 1e-6
      const sp = Math.min(top, Math.max(dl / Math.max(0.1, aT - t), 2.5))
      want = { x: (dx / dl) * sp, y: (dy / dl) * sp }
    }
    let ax = (want.x - v.x) / dt
    let ay = (want.y - v.y) / dt
    const al = Math.hypot(ax, ay)
    if (al > acc) { ax *= acc / al; ay *= acc / al }
    v = { x: v.x + ax * dt, y: v.y + ay * dt }
    t += dt
    p = stepIn(p, v, dt)
    mv.path.push({ t, x: p.x, y: p.y })
  }
  mv.t = t
  mv.x = p.x
  mv.y = p.y
  mv.lastStop = Math.hypot(v.x, v.y) < 1
  mv.inHeading = undefined
}

/** How far off the carrier a man still is at `byT` if he leaves on his pursuit angle at `s0` (dry run). */
function catchDist(mv: Mover, carrierPath: WP[], s0: number, byT: number): number {
  const c = new Mover(mv.key, mv.role, mv.pace, mv.x, mv.y, mv.player)
  c.path = mv.path.filter((w) => w.t <= s0 + 1e-9)
  if (!c.path.length) return Infinity
  const last = posAt(mv.path, s0)
  if (c.path[c.path.length - 1].t < s0 - 1e-9) c.path.push({ t: s0, x: last.x, y: last.y })
  c.t = s0
  c.x = last.x
  c.y = last.y
  pursuitLeg(c, carrierPath, byT, 1.0, byT)
  const cp = posAt(carrierPath, c.t)
  return Math.hypot(cp.x - c.x, cp.y - c.y)
}

/**
 * animflow r6c2 (297): coverage chasing a carrier nobody tackles (a score, a
 * step out of bounds). Each man runs his pursuit angle at his own speed — the
 * fast ones close and run alongside a body's width off, the slow ones angle at
 * the pylon / the spot and give up the ground they cannot make.
 */
function angleChase(m: Record<string, Mover>, keys: string[], fromSec: number, carrier: Mover, toSec: number, seed: number) {
  keys.forEach((k, i) => {
    const mv = m[k]
    if (!mv || mv === carrier) return
    seek(mv, fromSec)
    let p = { x: mv.x, y: mv.y }
    let v = mv.path.length > 1 ? speedVec(mv.path, mv.t) : { x: 0, y: 0 }
    const top = mv.pace.top
    const acc = Math.max(3, mv.pace.acc)
    const gap = 2.0 + hash(seed + i * 1.7) * 0.8
    const dt = 0.05
    let t = mv.t
    while (t + dt <= toSec + 1e-6) {
      const c = posAt(carrier.path, t)
      const cv = speedVec(carrier.path, t)
      const d = Math.hypot(c.x - p.x, c.y - p.y)
      let want: Pt
      if (d < gap + 1.2) {
        // Alongside: a body's width off on his own side, matching the carrier.
        const ux = d > 1e-6 ? (p.x - c.x) / d : 0
        const uy = d > 1e-6 ? (p.y - c.y) / d : 1
        const tgt = { x: c.x + ux * gap, y: c.y + uy * gap }
        want = { x: (tgt.x - p.x) / 0.3 + cv.x, y: (tgt.y - p.y) / 0.3 + cv.y }
      } else {
        const aim = interceptPt(carrier.path, p, t, top, toSec, gap)
        const dx = aim.x - p.x
        const dy = aim.y - p.y
        const dl = Math.hypot(dx, dy) || 1e-6
        const sp = dl < 1 ? dl * top : top
        want = { x: (dx / dl) * sp, y: (dy / dl) * sp }
      }
      const wl = Math.hypot(want.x, want.y)
      if (wl > top) { want.x *= top / wl; want.y *= top / wl }
      let ax = (want.x - v.x) / dt
      let ay = (want.y - v.y) / dt
      const al = Math.hypot(ax, ay)
      if (al > acc) { ax *= acc / al; ay *= acc / al }
      v = { x: v.x + ax * dt, y: v.y + ay * dt }
      t += dt
      p = stepIn(p, v, dt)
      mv.path.push({ t, x: p.x, y: p.y })
    }
    mv.t = t
    mv.x = p.x
    mv.y = p.y
    mv.lastStop = Math.hypot(v.x, v.y) < 1
    mv.inHeading = undefined
  })
}

/**
 * animflow r6c2 (297): a score is run through the goal line at speed, then he
 * eases up in the end zone (never a stop on the line, never a fall).
 */
function runThroughGoal(mv: Mover, goalX: number, dir: 1 | -1) {
  const h = mv.path.length > 1 ? speedVec(mv.path, mv.t) : { x: dir, y: 0 }
  const v = Math.min(mv.pace.top, Math.hypot(h.x, h.y))
  const hl = Math.hypot(h.x, h.y) || 1
  const d = clampN((v * v) / (2 * 4.5), 1.5, 7.5)
  const ux = Math.abs(h.x / hl) > 0.3 ? h.x / hl : dir * 0.7
  const uy = Math.abs(h.x / hl) > 0.3 ? h.y / hl : 0.7 * Math.sign(h.y || 1)
  const end = { x: clampN(mv.x + ux * d, dir > 0 ? goalX + 1 : 1, dir > 0 ? FIELD_W - 1 : goalX - 1), y: clampY(mv.y + uy * d) }
  mv.run([end], { v0: v, stop: true, cut: true })
}

/**
 * Bring a carry (a catch-and-run, a return of a pick) to a visible close: from
 * where he is now the carrier keeps running at his ratings' pace; the tackler
 * who can get there (the sim's credited man when he can) meets him a yard or
 * two short of the recorded spot and the pile goes forward to exactly that spot.
 * The carrier is only slowed (a wider line) when nobody could otherwise arrive.
 * Every other defender keeps converging on him.
 */
function resolveCarry(opts: {
  m: Record<string, Mover>
  carrierKey: string
  spot: Pt
  tacklerKeys: string[]
  prefer?: string
  seed: number
  /** A catch-and-run: turn upfield and stay north-south (a slight bow at most). */
  northSouth?: boolean
}): { tackler: string; endSec: number } {
  const { m, carrierKey, spot, tacklerKeys, prefer, seed } = opts
  const carrier = m[carrierKey]
  const fromSec = carrier.t
  const cPos = { x: carrier.x, y: carrier.y }
  const cV0 = carrySpeed(carrier)
  const total = Math.hypot(spot.x - cPos.x, spot.y - cPos.y)
  const ac = yardsAfterContact(carrier.player, total, seed)
  const bend = total > 4 ? (hash(seed + 3) - 0.5) * Math.min(opts.northSouth ? 1.2 : 3, total * (opts.northSouth ? 0.05 : 0.12)) : 0
  // animflow r7a: a catch-and-run carries the catch's momentum into ONE smooth
  // turn upfield (a quadratic arc that leaves along his heading), so his lateral
  // speed changes sign at most once: no snap turn, no S-bend.
  const hv = opts.northSouth && carrier.path.length > 1 ? speedVec(carrier.path, fromSec) : { x: 0, y: 0 }
  const hsp = Math.hypot(hv.x, hv.y)
  let line: Pt[]
  if (opts.northSouth && hsp > 1.5 && total > 1.2) {
    const reach = Math.min(3, total * 0.4, hsp * 0.4)
    line = quadPts(cPos, { x: clampX(cPos.x + (hv.x / hsp) * reach), y: clampY(cPos.y + (hv.y / hsp) * reach) }, spot, 14)
  } else line = Math.abs(bend) > 0.2 ? bowPts(cPos, spot, bend) : [spot]
  const { pre, post, c } = splitPolyline(cPos, line, Math.max(0, polyLen(cPos, line) - ac))
  const preNat = pre.length ? timedLine([cPos, ...pre], carrier.pace, { v0: cV0, stop: false }).slice(-1)[0]?.t ?? 0 : 0
  const tk = chooseTackler(m, tacklerKeys, prefer, c, fromSec, preNat + (opts.northSouth ? 2.0 : 1.4))
  const need = natTo(m[tk], c, fromSec)
  if (need > preNat + 0.05 && pre.length && opts.northSouth) {
    // A catch-and-run stays north-south: he runs it slower (picking his way,
    // down to 60% of his top speed) before any bow is added to the line.
    const saved = carrier.pace
    let k = 1
    const natK = (kk: number) => timedLine([cPos, ...pre], { top: saved.top * kk, acc: saved.acc }, { v0: Math.min(cV0, saved.top * kk), stop: false }).slice(-1)[0]?.t ?? 0
    while (k > 0.32 && natK(k) < need) k -= 0.03
    carrier.pace = { top: saved.top * k, acc: saved.acc }
    const v0k = Math.min(cV0, carrier.pace.top)
    // animflow r7a: still early at a cautious pace -> the same line widened to one
    // side (bounded; never a loop back or a second bow that S-bends).
    carrier.run(natK(k) >= need - 0.05 ? pre : widenByTime(cPos, pre, carrier.pace, v0k, need, hv), { v0: v0k, stop: false })
    carrier.pace = saved
  } else if (need > preNat + 0.05 && pre.length) {
    // Nobody could get there yet: he runs a wider line (never a loop) to give
    // the tackler time to arrive.
    carrier.run(routeByTime(cPos, c, carrier.pace, cV0, need, 0), { v0: cV0, stop: false })
  } else if (pre.length) {
    carrier.run(pre, { v0: cV0, stop: false })
  }
  const contactT = carrier.t
  pileDrive(carrier, post, carrySpeed(carrier))
  const endSec = carrier.t
  gangPursuit(m, tacklerKeys, fromSec, carrier, endSec, contactT, tk, seed)
  // animflow r6c2 (297): a tackler who starts well off the ball carrier runs
  // his pursuit angle from the catch, not a late burst from where the pack left him.
  const tk0 = posAt(m[tk].path, fromSec)
  const far = Math.hypot(tk0.x - c.x, tk0.y - c.y) > 6
  hitAndRide(m[tk], carrier, far ? fromSec : Math.max(fromSec, contactT - 0.8), contactT, endSec, 4.5)
  return { tackler: tk, endSec }
}

/**
 * Yards after the catch to draw for a completion (animflow r5), from the NFL
 * shape by the concept's air-yards bucket (nflverse pbp 2021-25): the share
 * tackled at the catch (YAC <= 0), else 0.5 yd + an exponential tail scaled so
 * the bucket mean matches. Capped by the gain (catch never behind the bucket's
 * shallowest sensible spot).
 */
/**
 * QB mobility 0..1 from his ratings (SPD, ACC, AGI) and the scrambler /
 * improviser / dual-threat style (animflow r5): Lamar Jackson ~1, a Burrow ~0.4,
 * a Goff / Flacco 0. Tiers: mobile >= 0.6, pocket <= 0.3.
 */
export function qbMobility(p: Player | undefined): number {
  if (!p) return 0.4
  const score = attrOf(p, 'SPD') * 0.5 + attrOf(p, 'ACC') * 0.25 + attrOf(p, 'AGI') * 0.25 + (styleProfile(p).scramble ?? 0) * 3
  return clampN((score - 76) / 20, 0, 1)
}
export const qbTier = (mob: number): 'mobile' | 'average' | 'pocket' => (mob >= 0.6 ? 'mobile' : mob <= 0.3 ? 'pocket' : 'average')

const YAC_NFL: [maxDepth: number, zeroShare: number, mean: number][] = [
  [0, 0.055, 9.05], [5, 0.214, 4.75], [10, 0.336, 3.33], [20, 0.401, 3.68], [Infinity, 0.289, 5.6],
]
export function yacTarget(conceptDepth: number, gain: number, u: number): number {
  const [, p0, mean] = YAC_NFL.find(([d]) => conceptDepth < d) ?? YAC_NFL[YAC_NFL.length - 1]
  if (gain <= 0) return 0
  if (u < p0) return 0.3 * (u / p0)
  const s = mean / (1 - p0) - 0.5
  const v = (u - p0) / (1 - p0)
  return Math.min(gain, 0.5 + s * -Math.log(1 - Math.min(0.995, v)))
}

function buildPass(play: Play, ctx: AnimContext): PlayAnim {
  recStart()
  const los = 10 + play.startYard
  const snapK = snapKindFor(play.concept)
  const f = formation(los, formationHasFullback(formationForConcept(play.concept)), snapK)
  const m = startMovers(f, ctx)
  recSnap(los)
  const seed = play.n * 11 + play.startYard
  const inc = play.result === 'Incomplete'
  const int = play.result.startsWith('Interception')
  // animflow r6d (J12): the snap's game plan (the sim's own call, see jersey planOf).
  const plan = planOf(ctx.actors)
  const ovrOf = (k: string) => m[k]?.player?.ovr ?? 0
  // SHADOW: the best corner on the field travels with the best wideout (aligns across from him).
  let shadowPlan: { cb: string; wr: string } | undefined
  if (plan?.def === 'shadowWR1') {
    const wr = ['wr0', 'wr1', 'wr2'].filter((k) => m[k]?.player).reduce<string | undefined>((a, k) => (!a || ovrOf(k) > ovrOf(a) ? k : a), undefined)
    const cb = ['cb0', 'cb1'].filter((k) => m[k]?.player).reduce<string | undefined>((a, k) => (!a || ovrOf(k) > ovrOf(a) ? k : a), undefined)
    if (wr && cb) shadowPlan = { cb, wr }
  }
  if (shadowPlan) {
    // He lines up across from his man before the snap (a swap of the corners' spots when the WR1 is
    // the far wideout; over the slot when he is in the slot). Nothing has moved yet.
    const nat = shadowPlan.wr === 'wr0' ? 'cb0' : shadowPlan.wr === 'wr1' ? 'cb1' : undefined
    if (nat && nat !== shadowPlan.cb) {
      const a = f[nat]
      const b = f[shadowPlan.cb]
      f[nat] = { ...a, x: b.x, y: b.y }
      f[shadowPlan.cb] = { ...b, x: a.x, y: a.y }
    } else if (!nat) {
      f[shadowPlan.cb] = { ...f[shadowPlan.cb], x: los + 4, y: clampY(f[shadowPlan.wr].y + (f[shadowPlan.wr].y < MID_Y ? 1 : -1)) }
    }
    for (const k of ['cb0', 'cb1']) m[k].reset(f[k].x, f[k].y)
  }
  // A completion is drawn as a throw no deeper than the gain allows (plus a
  // little run after the catch): a 1-yard completion is a flat or bubble, not
  // a 15-yard dig caught and run back to the line.
  const gainYds = play.endYard - play.startYard
  const simDepth = Math.max(-2, Math.min(45, play.passDepth ?? 8))
  const depth = inc || int ? simDepth : Math.min(simDepth, Math.max(1, gainYds + 3))
  // Run after the catch (animflow r5): the drawn YAC follows the NFL shape for
  // the concept's air-yards bucket (nflverse pbp 2021-25: share tackled at the
  // catch, then an exponential tail at the bucket's mean), and the catch is
  // drawn that far short of the recorded end spot, so catch + YAC = the spot.
  // animflow r8 (J3b): with the sim's per-throw air yards (passDepth, emitted with passConceptDepth
  // while the air model is on) the ball is caught AT those air yards (capped by the gain) and the
  // run after it is the rest of the gain; without them the drawn YAC follows the NFL shape (r5).
  const simAir = !inc && !int && play.passConceptDepth != null && play.passDepth != null
  const yacT = inc || int ? 0 : simAir ? Math.max(0, gainYds - Math.min(simDepth, gainYds)) : yacTarget(simDepth, gainYds, hash(seed + 71))
  const catchDepth = inc || int ? depth : simAir ? Math.min(simDepth, gainYds) : clampN(gainYds - yacT, Math.min(gainYds, simDepth <= 0 ? simDepth - 1 : simDepth >= 5 ? 2 : 0), Math.max(Math.min(gainYds, simDepth <= 0 ? simDepth - 1 : simDepth >= 5 ? 2 : 0), simDepth + 1))
  const tgt = targetKey(play, ctx)
  // animflow r8 (J36): a throw steered at a scouted cover defender (scoutTarget = the recorded cover
  // man) goes at HIM: he is the corner lined up over the receiver the ball is thrown to.
  const steerK = play.scoutTarget && play.scoutTarget === play.coverId && !shadowPlan && /^wr/.test(tgt)
    ? ['cb0', 'cb1'].find((k) => ctx.actors?.get(k)?.id === play.scoutTarget)
    : undefined
  if (steerK) {
    const nat = tgt === 'wr0' ? 'cb0' : tgt === 'wr1' ? 'cb1' : undefined
    if (nat && nat !== steerK) {
      const a = f[nat]
      const b = f[steerK]
      f[nat] = { ...a, x: b.x, y: b.y }
      f[steerK] = { ...b, x: a.x, y: a.y }
    } else if (!nat) {
      f[steerK] = { ...f[steerK], x: los + 4, y: clampY(f[tgt].y + (f[tgt].y < MID_Y ? 1 : -1)) }
    }
    for (const k of ['cb0', 'cb1']) m[k].reset(f[k].x, f[k].y)
  }
  const scramble = !!play.pressure
  const rollSide = hash(seed + 9) < 0.5 ? -1 : 1
  const concept = play.concept
  const boot = concept === 'Bootleg'
  const quick = depth <= 8
  const pa = /Play Action|PA Cross|RPO/.test(concept)
  const side = hash(seed + 3) < 0.5 ? -1 : 1

  // Pocket: OL anchor by PBK, DL rush by PMV/FMV, so the better unit wins. The
  // protection itself is planned later (backlog 152), once the drop and the
  // throw are known, so a doubled rusher can be shown splitting the block.

  // ── timing by concept (animflow round 2) ─────────────────────────────────
  // A real dropback develops: the QB takes a drop that fits the concept (quick
  // game a hitch from the gun, a 3-/5-/7-step equivalent, a play-action fake
  // first), receivers fight to get off the line, routes are run at a stem pace
  // the route runner can break from, and the ball comes out after the drop is
  // finished. Catch spot / receiver / result are unchanged; only when.
  const screen = /Screen/.test(concept)
  const quickGame = !screen && !pa && !boot && (/Slant|Bubble|Hitch|Stick|Quick|Flat/.test(concept) || depth <= 4)
  const bucket: 'screen' | 'quick' | 'dropback' | 'deep' | 'pa' = screen ? 'screen' : pa || boot ? 'pa' : quickGame ? 'quick' : depth >= 18 ? 'deep' : 'dropback'
  // Drop depth (yd behind the shotgun spot) and its duration (s).
  // animflow r6a: screens come out fast (BDB 2021 n 1.2k screens: snap to
  // release median 1.7 s, p25 1.3): a short, quick drop, then the dump-off.
  // animflow r6c2 (295): from under centre a real 3- / 5- / 7-step drop (QB
  // ~5 / 7 / 8.5 yd deep at ~1.0 / 1.35 / 1.7 s); from the gun a 1- / 3- / 5-
  // step (the old values); the pistol in between.
  const drop = snapK === 'under'
    ? { screen: 5.0, quick: 4.0, dropback: 6.0, deep: 7.5, pa: 6.5 }[bucket]
    : snapK === 'pistol'
      ? { screen: 3.0, quick: 1.6, dropback: 3.4, deep: 4.6, pa: 3.6 }[bucket]
      : { screen: 2.4, quick: 1.0, dropback: 2.6, deep: 3.8, pa: 2.8 }[bucket]
  const dropT = snapK === 'under'
    ? { screen: 1.0, quick: 0.95, dropback: 1.35, deep: 1.7, pa: 1.75 }[bucket]
    : snapK === 'pistol'
      ? { screen: 0.9, quick: 0.7, dropback: 1.25, deep: 1.55, pa: 1.6 }[bucket]
      : { screen: 0.85, quick: 0.62, dropback: 1.2, deep: 1.5, pa: 1.55 }[bucket]
  // When the ball should come out (s after the snap), with a little spread.
  // animflow r6a: all dropbacks 0.1 s quicker (BDB snap to release median 2.6-2.7 s, n 13.4k / 7.6k).
  let wantRel = SNAP + { screen: 1.75, quick: 1.65, dropback: 2.45, deep: 2.7, pa: 2.65 }[bucket] + (hash(seed + 61) - 0.5) * 0.4
  // Run fake (play-action / RPO / bootleg): QB and back mesh before the drop.
  const qbPts: Pt[] = []
  // Under centre the fake is a reverse pivot back to the back at the mesh.
  if (pa) qbPts.push({ x: snapK === 'under' ? f.qb.x - 3.2 : snapK === 'pistol' ? f.qb.x - 0.3 : f.qb.x + 0.5, y: MID_Y + side * 1.2 })
  if (boot) qbPts.push({ x: snapK === 'under' ? f.qb.x - 3.6 : f.qb.x - 1.2, y: MID_Y - rollSide * 1.2 })
  // Under pressure the pocket movement comes from the QB's legs (animflow r5;
  // NFL tracking: escape ~4.7 yd wide at ~7 yd deep, ~5 yd/s, throw ~1.1 s
  // later; mobile QBs p90 ~10 yd wide): a mobile QB breaks the pocket early and
  // wide and extends the play; a pocket QB climbs / slides 1-2 yd and throws
  // hurried; an average QB slides a few yards.
  const mob = qbMobility(ctx.actors?.get('qb'))
  const tier = qbTier(mob)
  const press = scramble && !boot
  // A mobile QB extends the play outside the pocket (NFL: escape ~3.4-4.1 s, throw ~1.1 s later).
  if (press && tier === 'mobile' && bucket !== 'screen' && bucket !== 'quick') wantRel += 0.25 + 0.4 * mob
  const rollMag = boot ? 9 : press
    ? (tier === 'mobile' ? 4.5 + mob * 2 + hash(seed + 2) * 2.5 : tier === 'pocket' ? 0.6 + hash(seed + 2) * 1.0 : 3.2 + hash(seed + 2) * 2)
    : quick ? 3 : 6 + hash(seed + 2) * 3
  const rollY = clampY(MID_Y + (boot ? -rollSide : rollSide) * rollMag)
  qbPts.push({ x: f.qb.x - drop, y: MID_Y })
  if (press && tier === 'pocket') {
    // Climb: a step up into the pocket and a short slide away from the pressure.
    qbPts.push({ x: f.qb.x - drop + 1.2 + hash(seed + 5) * 0.8, y: rollY })
    m.qb.run(qbPts, { stop: true })
  } else if (press) {
    // Break the pocket: a hitch, then out the side at a run (mobile QBs wider, keeping depth).
    const climb = tier === 'mobile' ? 0.6 : 1.2
    qbPts.push({ x: f.qb.x - drop + 0.4, y: MID_Y + (rollY - MID_Y) * 0.2 }, { x: f.qb.x - drop + climb, y: rollY })
    m.qb.run(qbPts, { stop: true })
  } else if (scramble || boot) {
    qbPts.push({ x: f.qb.x - drop - 0.5 + (scramble ? 1.5 : 0), y: MID_Y + (rollY - MID_Y) * 0.15 }, { x: f.qb.x - drop + 1.5, y: rollY })
    m.qb.run(qbPts, { stop: true })
  } else {
    // The drop at a drop's pace (not a sprint): done at dropT.
    runTimed(m.qb, qbPts, 0, dropT, false, true)
  }
  const dropEnd = m.qb.t
  if (pa || boot) recEv(0.34, 'playAction', ['qb', 'rb'], posAt(m.qb.path, 0.34))

  // Route tree; the target runs the route whose depth best matches the throw.
  const routeMap = conceptTree(concept, rollSide)
  const inwOf = (k: string) => (f[k].y < MID_Y ? 1 : -1)
  let pick = tgt
  let best = Math.abs((ROUTES[routeMap[tgt]]?.depth ?? 0) - catchDepth)
  for (const k of Object.keys(routeMap)) {
    const d = Math.abs((ROUTES[routeMap[k]]?.depth ?? 0) - catchDepth)
    if (d < best) {
      best = d
      pick = k
    }
  }
  // animflow r8 (J38): a featured throw runs its own route - the back-shoulder fade, the tight
  // end's seam, the back's wheel - whatever the depth match would pick.
  const featRoute = play.featured === 'fade' ? 'fade' : play.featured === 'seam' ? 'seam' : play.featured === 'wheel' ? 'wheel' : undefined
  if (featRoute) pick = tgt
  if (pick !== tgt) {
    const tmp = routeMap[tgt]
    routeMap[tgt] = routeMap[pick]
    routeMap[pick] = tmp
  }
  // No route in the concept is short enough for this completion: the target
  // runs the natural short option instead (bubble/flat, quick out/check-down).
  const blockingRoute = /^(stalk|runFake|block|passBlock)$/.test(routeMap[tgt] ?? '')
  if (!inc && !int && (blockingRoute || (ROUTES[routeMap[tgt]]?.depth ?? 0) > (gainYds <= 0 ? 1 : gainYds + 2))) {
    const back = tgt === 'rb' || tgt === 'te' || tgt === 'fb'
    const short = gainYds <= 0
      ? (tgt === 'rb' || tgt === 'fb' ? 'swing' : 'screen')
      : gainYds <= 1 ? (back ? 'flat' : 'bubble') : gainYds <= 6 ? (back ? 'check' : 'quickOut') : blockingRoute ? (back ? 'angle' : 'slant') : null
    if (short) routeMap[tgt] = short
  }
  if (featRoute && (inc || int || gainYds >= 4)) routeMap[tgt] = featRoute

  LAST_CATCH_ROUTE = routeMap[tgt]
  const receivers = ['wr0', 'wr1', 'wr2', 'te', 'rb'].filter((k) => m[k])
  // Only a tight end / back assigned to pass-protect (block/passBlock) stays in
  // (backlog 152); a screen "stalk" or a play-action "runFake" is a route, not
  // protection, and runs like everyone else (backlog 152 follow-up).
  // animflow r6d (J12): DOUBLE / CHIP commit protection to the defence's best rusher (the sim's rep
  // edge: max of his power / finesse move) — the back stays in on a DOUBLE, chips him on a CHIP.
  const bestRusher = plan?.off === 'doubleRusher' || plan?.off === 'chipEdge'
    ? ['dl0', 'dl1', 'dl2', 'dl3'].filter((k) => m[k]).reduce((a, k) => (Math.max(attrOf(m[k].player, 'PMV'), attrOf(m[k].player, 'FMV')) > Math.max(attrOf(m[a].player, 'PMV'), attrOf(m[a].player, 'FMV')) ? k : a), 'dl0')
    : undefined
  if (plan?.off === 'doubleRusher' && m.rb && tgt !== 'rb' && routeMap.rb !== 'runFake') routeMap.rb = 'passBlock'
  const stayIn = new Set(receivers.filter((k) => k !== tgt && (k === 'te' || k === 'rb' || k === 'fb') && /^(block|passBlock)$/.test(routeMap[k] ?? '')))
  // A back chips an edge or blitzer before releasing into his route — but a back
  // selling a run fake (play-action / RPO) has a fake to run, not a chip.
  const chipPlan = plan?.off === 'chipEdge' && !!bestRusher
  if ((play.blitz || chipPlan) && m.rb && tgt !== 'rb' && !stayIn.has('rb') && routeMap.rb !== 'runFake') {
    const chipR = chipPlan ? bestRusher! : blitzKeys(seed).reduce((a, k) => (Math.abs(f[k].y - f.rb.y) < Math.abs(f[a].y - f.rb.y) ? k : a))
    const dir = f.rb.y >= f[chipR].y ? 1 : -1
    m.rb.run([{ x: clampX(los - 1.6), y: clampY(f[chipR].y + dir * 1.1) }], { stop: true })
    m.rb.hold(0.1)
    recEng('rb', chipR, 0.15, m.rb.t, 'chip')
  }
  let catchPt: Pt = { x: los, y: MID_Y }
  let catchSec = 0.4
  const breaks: { k: string; t: number; pt: Pt }[] = []
  const chipped = m.rb.t > 0
  const routePts = (k: string): Pt[] => {
    const def = ROUTES[routeMap[k]] ?? ROUTES.check
    const inw = inwOf(k)
    let raw = def.wps(f[k].y, los, 1, inw, -inw, side)
    // animflow r8 (302): a crosser drawn into the sideline (a mesh / cross from an outside spot ran
    // its lateral leg out of the field and braked against the line) crosses the field instead.
    const endY = raw[raw.length - 1]?.y ?? f[k].y
    if (/^(meshIn|cross|drag|shallow)$/.test(routeMap[k] ?? '') && (endY < 1.2 - 1.5 || endY > FIELD_H - 1.2 + 1.5)) {
      raw = raw.map((w) => ({ ...w, y: 2 * f[k].y - w.y }))
    }
    const pts = raw.map((w) => ({ x: clampX(w.x), y: clampY(w.y) }))
    if (k !== tgt || !backShoulder) return pts
    // animflow r8 (J38): a back-shoulder fade - he stems the fade to the throw's depth, then plants
    // and turns back to the ball, which is thrown behind his back (sideline-side) shoulder.
    const xs = los + Math.max(6, catchDepth) + 1.2
    const out: Pt[] = []
    let prev: Pt = { x: f[k].x, y: f[k].y }
    for (const p of pts) {
      if (p.x >= xs) {
        const u = (xs - prev.x) / Math.max(1e-6, p.x - prev.x)
        out.push({ x: clampX(xs), y: clampY(prev.y + (p.y - prev.y) * u) })
        break
      }
      out.push(p)
      prev = p
    }
    const e = out[out.length - 1] ?? prev
    out.push({ x: clampX(e.x - 1.2), y: clampY(e.y + (e.y < MID_Y ? -0.7 : 0.7)) })
    return out
  }
  // Getting off the line: a wideout fights the jam (release vs his rating), a
  // back or tight end checks his protection first; a screen's men just go.
  const releaseOf = (k: string): number => {
    if (screen || (k === 'rb' && chipped)) return 0
    const rls = attrNum(m[k].player, 'RLS', 70)
    // animflow r8: a quicker release (he is into his stem at speed ~1 s after the snap, NFL), and
    // each man his own draw (the hash used to give wr0 / wr1 / wr2 the same one).
    const base = k === 'rb' || k === 'te' || k === 'fb' ? 0.26 : bucket === 'quick' ? 0.1 : 0.2
    return clampN(base - (rls - 75) * 0.005 + hash(seed + k.charCodeAt(k.length - 1) * 3.7 + k.length * 13 + 7) * 0.14, 0.05, 0.5)
  }
  /** Run receiver k: the release at the line, then his route at `pace` of his speed. */
  const runRecv = (k: string, pace: number, through = 0, flat = false) => {
    const pts = routePts(k)
    if (!(k === 'rb' && chipped)) m[k].reset(f[k].x, f[k].y)
    const rel = releaseOf(k)
    if (rel > 0.04) {
      // Hand-fight / jab step: a half-yard of foot work, never standing.
      const jab = (hash(seed + k.length * 5) < 0.5 ? -1 : 1) * 0.55
      runTimed(m[k], [{ x: clampX(f[k].x + 0.35), y: clampY(f[k].y + jab) }, { x: clampX(f[k].x + 0.8), y: clampY(f[k].y + jab * 0.3) }], m[k].t, m[k].t + rel, false, false)
    }
    const def = ROUTES[routeMap[k]] ?? ROUTES.check
    const breakIdx = pts.length >= 3 ? pts.length - 2 : -1
    runRoute(m[k], pts, breakIdx, routeRunRating(m[k].player, def.depth), pace, through, flat, rel > 0.04 ? carrySpeed(m[k]) : 0)
    return { pts, breakIdx }
  }
  const endX0 = clampX(10 + play.endYard)
  // animflow r6c2 (302): the ball meets a receiver in stride (crossers, slants,
  // verticals, outs: he keeps his speed through the catch); only a stop route
  // (hitch, curl, comeback, stick / sit, a back's check-down) or a back-shoulder
  // fade is caught standing.
  const tgtRoute = routeMap[tgt] ?? ''
  const backShoulder = tgtRoute === 'fade' && (play.featured === 'fade' || hash(seed + 83) < 0.3)
  const stride = !screen && !backShoulder && !/^(hitch|curl|comeback|stick|sit|check|stalk|runFake|block|passBlock)$/.test(tgtRoute)
  /** The target at a stem pace: where and when the ball meets him, and when it must leave. */
  const planTarget = (pace: number) => {
    const room = !inc && !int ? endX0 - Math.min(yacT, Math.max(0, endX0 - los - 0.5)) - (routePts(tgt).slice(-1)[0]?.x ?? 0) : Infinity
    const { pts, breakIdx } = runRecv(tgt, pace, stride ? 16 : 0, room < 4)
    let cPt = pts[pts.length - 1]
    let cSec = stride ? timeNearest(m[tgt], cPt, 0, m[tgt].t) : m[tgt].t
    let v0 = 0
    let fixed = false
    // A completion that gains less than the route's depth: the ball arrives
    // earlier on the route, short of the end spot, so the run after the catch
    // goes forward (or across), never back toward the line like a real NFL catch.
    let xMax = Infinity
    if (!inc && !int) {
      const gain = endX0 - los
      const yacMin = gain > 0 ? Math.min(yacT, Math.max(0, gain - 0.5)) : 0
      xMax = endX0 - yacMin
      if (cPt.x > endX0 - yacMin) {
        for (let t = cSec; t >= 0.35; t -= 0.02) {
          if (posAt(m[tgt].path, t).x <= endX0 - yacMin) {
            // In stride: not in his brake into the break.
            if (stride) while (t > 0.6 && speedAtTime(m[tgt].path, t) < 3.5) t -= 0.04
            cPt = posAt(m[tgt].path, t)
            v0 = seek(m[tgt], t)
            cSec = t
            fixed = true
            break
          }
        }
      }
    }
    if (stride && !fixed) {
      // Too early for the QB: the ball meets him further along his line (still
      // running), as long as that stays short of the recorded spot.
      const goal = Math.max(minRel, wantRel - 0.3)
      const airAt = (p: Pt) => Math.hypot(p.x - (f.qb.x - drop), p.y - MID_Y)
      if (cSec - flightFor(airAt(cPt)) < goal) {
        // (never in the slow-down at the end of his line)
        for (let t = cSec; t <= m[tgt].t - 1.0; t += 0.04) {
          const p = posAt(m[tgt].path, t)
          if (p.x > xMax + 0.3) break
          if (t - flightFor(airAt(p)) >= goal) {
            cPt = p
            cSec = t
            break
          }
        }
      }
      v0 = seek(m[tgt], cSec)
    }
    cSec = Math.max(cSec, 0.35)
    if (screen) {
      // animflow r6a: a screen is thrown as soon as the back has turned up and
      // the QB is set (BDB 2021 screens: release median 1.7 s), caught on the
      // move part-way along his release, not at the end of a full swing.
      for (let t = Math.max(0.6, cSec * 0.55); t < cSec - 0.05; t += 0.02) {
        const p = posAt(m[tgt].path, t)
        const a = Math.hypot(p.x - (f.qb.x - drop), p.y - MID_Y)
        if (t - flightFor(a) >= Math.max(minRel, wantRel - 0.15)) {
          cPt = p
          v0 = seek(m[tgt], t)
          cSec = t
          break
        }
      }
    }
    const air = Math.hypot(cPt.x - (f.qb.x - drop), cPt.y - MID_Y)
    return { pts, breakIdx, cPt, cSec, v0, rel: cSec - flightFor(air) }
  }
  // Release and flight: throw power sets a bullet vs a floater. Ball speed ~19
  // yd/s off a strong arm, plus loft on deep balls (a slant is a ~0.5 s dart).
  const qb = ctx.actors?.get('qb')
  const thp = attrOf(qb, 'THP')
  const tup = attrOf(qb, 'TUP')
  const pac = attrOf(qb, 'PAC')
  const flightFor = (air: number) =>
    clampN(0.12 + air / (18.5 + (thp - 70) * 0.18) + Math.max(0, depth - 15) * 0.014 + (tup - 70) * 0.003 + (pa ? (pac - 70) * 0.002 : 0), 0.35, 2.8)
  // The ball never comes out before the drop is done (a hitch to set).
  const minRel = scramble || boot ? SNAP + 1.2 : dropEnd + (bucket === 'quick' ? 0.08 : 0.15)
  // Pick the stem pace (route runners at 50-100% of top speed on the stem) that brings the
  // target open when the QB wants to throw.
  let bestPace = 1
  let bestErr = Infinity
  // animflow r8 (user: "route running looks slow"): routes are run at NFL route speed (>= 85% of
  // top on the stem); a man open early settles in the window / the ball comes out as he is open.
  for (let pace = 1; pace >= ROUTE_PACE_MIN - 1e-9; pace -= 0.03) {
    const r = planTarget(pace).rel
    const err = Math.abs(r - Math.max(wantRel, minRel)) + (r < minRel ? 5 + (minRel - r) : 0)
    if (err < bestErr) {
      bestErr = err
      bestPace = pace
    }
  }
  const tp = planTarget(bestPace)
  catchPt = tp.cPt
  catchSec = tp.cSec
  let catchV0 = tp.v0
  if (tp.breakIdx > 0) breaks.push({ k: tgt, t: timeNearest(m[tgt], tp.pts[tp.breakIdx], 0, m[tgt].t), pt: tp.pts[tp.breakIdx] })
  // Even at an easy stem he would be there well before the QB is ready (a short
  // route, or a catch early on it): he settles in the window (feet alive) until
  // the ball arrives, so the throw still comes after a full drop and a hitch.
  // animflow r8 (302): an in-stride receiver is never parked to suit the QB's preferred rhythm -
  // once the drop is done (minRel) the ball comes out as he comes open; he only throttles down
  // when he would be open before the QB has finished his drop.
  const relGoal = stride ? minRel : Math.max(minRel, wantRel - 0.3)
  if (tp.rel < relGoal) {
    const late = relGoal + flightFor(Math.hypot(catchPt.x - (f.qb.x - drop), catchPt.y - MID_Y))
    const v = seek(m[tgt], catchSec)
    if (stride && late - catchSec > 0.2) {
      // animflow r6c2 (302): a crosser / vertical early for the QB throttles
      // down and keeps working across (no stop in the open): the ball meets him
      // on the move. Across, not upfield, so the catch stays short of the spot.
      const h = m[tgt].path.length > 1 ? speedVec(m[tgt].path, m[tgt].t) : { x: 0, y: 1 }
      let hx = h.x * 0.2
      let hy = Math.abs(h.y) > 0.3 ? h.y : (m[tgt].y < MID_Y ? 1 : -1)
      const hl = Math.hypot(hx, hy) || 1
      hx /= hl
      hy /= hl
      const jog = 5.6
      let d = jog * (late - catchSec)
      // Room before the sideline: turn back inside rather than run out.
      const yRoom = hy > 0 ? FIELD_H - 2 - m[tgt].y : m[tgt].y - 2
      if (d * Math.abs(hy) > yRoom) d = Math.max(0.5, yRoom / Math.max(0.2, Math.abs(hy)))
      const saved = m[tgt].pace
      m[tgt].pace = { top: Math.min(saved.top, Math.max(jog, v * 0.8)), acc: Math.min(saved.acc, 5) }
      m[tgt].run([{ x: clampX(m[tgt].x + hx * d), y: clampY(m[tgt].y + hy * d) }], { v0: Math.min(v, m[tgt].pace.top), stop: false })
      m[tgt].pace = saved
      const tEnd = Math.min(m[tgt].t, late)
      // (seek() at his last knot would read 0: he is still moving there)
      catchV0 = tEnd < m[tgt].t - 1e-6 ? seek(m[tgt], tEnd) : carrySpeed(m[tgt])
      catchSec = m[tgt].t
      catchPt = { x: m[tgt].x, y: m[tgt].y }
      // animflow r8: short of room (the sideline) but past the drop: the throw meets him on the move.
      const minCatch = minRel + flightFor(Math.hypot(catchPt.x - (f.qb.x - drop), catchPt.y - MID_Y))
      if (late - catchSec > 0.05 && catchSec < minCatch - 0.02) {
        pocketPair(m, null, [tgt], catchSec, late, 0, seed + 91)
        catchSec = m[tgt].t
        catchPt = { x: m[tgt].x, y: m[tgt].y }
        catchV0 = 0
      }
    } else {
      pocketPair(m, null, [tgt], catchSec, late, 0, seed + 91)
      catchSec = m[tgt].t
      catchPt = { x: m[tgt].x, y: m[tgt].y }
      catchV0 = 0
    }
  }
  // animflow r8 (302): an in-stride route is never caught standing or at a jog, whatever the sim
  // stream: when the plan above leaves him slow at the catch (early for the QB and waiting, or a
  // catch spot in his brake), he throttles down a few yards short of the spot on his own line,
  // keeps his feet alive in the window, and comes back to full stride into the ball - arriving
  // at the same spot at the same moment (catch spot / time / release unchanged).
  if (stride && !int && catchV0 < STRIDE_V) {
    // First choice: the ball meets him a beat earlier on his own line, while he is still at speed
    // (braking at the end of his line by the sideline) - as long as the QB has finished his drop.
    const airAt = (p: Pt) => Math.hypot(p.x - (f.qb.x - drop), p.y - MID_Y)
    for (let t = catchSec - 0.04; t >= catchSec - 0.9 && t > 0.4; t -= 0.04) {
      const p = posAt(m[tgt].path, t)
      if (p.x > catchPt.x + 0.3 || t - flightFor(airAt(p)) < minRel) break
      if (speedAtTime(m[tgt].path, t) >= STRIDE_V) {
        catchV0 = seek(m[tgt], t)
        catchSec = t
        catchPt = { x: m[tgt].x, y: m[tgt].y }
        break
      }
    }
  }
  if (stride && !int && catchV0 < STRIDE_V) {
    // Second: the end of his line pulled him up just as the ball arrives - he runs on through it at
    // the speed he had (the catch a yard or so further along, still short of the recorded spot).
    let t2 = catchSec
    while (t2 > catchSec - 1.2 && t2 > 0.4 && speedAtTime(m[tgt].path, t2) < STRIDE_V) t2 -= 0.04
    const v2 = speedAtTime(m[tgt].path, t2)
    const h2 = speedVec(m[tgt].path, t2)
    const l2 = Math.hypot(h2.x, h2.y)
    if (v2 >= STRIDE_V && l2 > 1) {
      const p2 = posAt(m[tgt].path, t2)
      const d2 = v2 * (catchSec - t2)
      const e2 = { x: p2.x + (h2.x / l2) * d2, y: p2.y + (h2.y / l2) * d2 }
      if (e2.y > 1.3 && e2.y < FIELD_H - 1.3 && e2.x < FIELD_W - 1 && (inc || e2.x <= endX0 - 0.3)) {
        const v = seek(m[tgt], t2)
        const saved = m[tgt].pace
        m[tgt].pace = { top: Math.max(saved.top, v), acc: saved.acc }
        m[tgt].run([e2], { v0: v, stop: false })
        m[tgt].pace = saved
        catchSec = m[tgt].t
        catchPt = { x: m[tgt].x, y: m[tgt].y }
        catchV0 = carrySpeed(m[tgt])
      }
    }
  }
  if (stride && !int && catchV0 < STRIDE_V) {
    let ts = catchSec
    while (ts > 0.3 && speedAtTime(m[tgt].path, ts) < 3.0) ts -= 0.04
    const h = speedVec(m[tgt].path, ts)
    const hl = Math.hypot(h.x, h.y)
    if (hl > 1) {
      const u = { x: h.x / hl, y: h.y / hl }
      const vS = speedAtTime(m[tgt].path, ts)
      const stopD = clampN((vS * vS) / (2 * Math.max(3, m[tgt].pace.acc)), 0.4, 4)
      const W = { x: clampX(catchPt.x - u.x * STRIDE_RUNUP), y: clampY(catchPt.y - u.y * STRIDE_RUNUP) }
      const S = { x: clampX(W.x - u.x * stopD), y: clampY(W.y - u.y * stopD) }
      const tS = timeNearest(m[tgt], S, 0, ts + 0.05)
      const pS = posAt(m[tgt].path, tS)
      const ta = timedLine([W, catchPt], m[tgt].pace, { v0: 0, stop: false }).slice(-1)[0]?.t ?? 0
      const go = catchSec - ta + 0.02
      const fits = Math.hypot(pS.x - S.x, pS.y - S.y) < 0.9 && Math.hypot(W.x - catchPt.x, W.y - catchPt.y) > STRIDE_RUNUP - 0.3 &&
        go >= tS + (2 * stopD) / Math.max(1, vS) + 0.12
      if (fits) {
        const v = seek(m[tgt], tS)
        m[tgt].run([W], { v0: v, stop: true })
        if (go > m[tgt].t + 0.02) pocketPair(m, null, [tgt], m[tgt].t, go, 0, seed + 93)
        m[tgt].run([catchPt], { v0: 0, stop: false })
        catchSec = m[tgt].t
        catchV0 = carrySpeed(m[tgt])
      }
    }
  }
  for (const k of receivers) {
    if (stayIn.has(k) || k === tgt) continue
    const { pts, breakIdx } = runRecv(k, Math.min(1, bestPace + 0.05))
    if (breakIdx > 0) breaks.push({ k, t: timeNearest(m[k], pts[breakIdx], 0, m[k].t), pt: pts[breakIdx] })
    if (routeMap[k] === 'stalk') {
      // A stalk block: he squares up on his man (engaged below, with coverage).
    } else {
      const a = pts[pts.length - 2] ?? pts[pts.length - 1]
      const b = pts[pts.length - 1]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy) || 1
      // Keep working: carry on through the route, then find space.
      m[k].run([{ x: clampX(b.x + (dx / len) * 2.5), y: clampY(b.y + (dy / len) * 2.5) }], { stop: true })
      if (m[k].t < catchSec) jogTo(m[k], { x: clampX(m[k].x + 2), y: clampY(m[k].y + (MID_Y - m[k].y) * 0.25) }, 4)
    }
  }
  if (m.fb) m.fb.run([{ x: los - 3, y: MID_Y + 1 }, { x: los - 1, y: MID_Y + side * 4 }], { stop: true })

  // Release and flight: throw power sets a bullet vs a floater.
  const flightSec = flightFor(Math.hypot(catchPt.x - (f.qb.x - drop), catchPt.y - MID_Y))
  const releaseSec = Math.max(minRel, catchSec - flightSec)
  // Set in the pocket until the throw: he hitches up and keeps his feet alive.
  // A bootleg (or a scramble that is still escaping) throws on the move: he
  // keeps rolling through the release (animflow round 3).
  const rollOn = boot || (scramble && releaseSec - m.qb.t < 0.7)
  if (rollOn && m.qb.t < releaseSec - 0.05) {
    const ry = rollY > MID_Y ? 1 : -1
    const dist = (releaseSec + 0.3 - m.qb.t) * 3.2
    runTimed(m.qb, [{ x: clampX(m.qb.x + dist * 0.35), y: clampY(m.qb.y + ry * dist * 0.94) }], m.qb.t, releaseSec + 0.3, false, false)
  } else if (m.qb.t < releaseSec - 0.1) {
    // animflow r6a: the step-up (BDB 2023 n 7.5k: median 0.0 yd, 23% > 0.5 yd,
    // p90 1.6) - most passers hold their spot, about one in four climbs.
    const su = hash(seed + 79)
    const up = su < 0.55 ? su * 0.15 : su < 0.77 ? 0.25 + (su - 0.55) * 1.4 : 0.6 + (su - 0.77) * 4.3
    pocketPair(m, null, ['qb'], m.qb.t, releaseSec, -up * 1.15, seed + 77)
  }
  const releasePos = posAt(m.qb.path, releaseSec)
  recEv(releaseSec, 'throw', ['qb', tgt], releasePos)
  if (scramble) {
    const dev = firstDeviation(m.qb, MID_Y, 0.5, SNAP, releaseSec)
    const st = clampN(dev ?? releaseSec - 0.05, SNAP, Math.max(SNAP, releaseSec - 0.02))
    recEv(st, 'scramble', ['qb'], posAt(m.qb.path, st))
  }
  const accKey = depth >= 15 ? 'DAC' : depth >= 9 ? 'MAC' : 'SAC'
  const accuracy = attrOf(qb, accKey)

  // ── pass protection (backlog 152) ─────────────────────────────────────────
  // The front plus any blitzers rush; the line (and a back/tight end staying
  // in) slides and doubles the best rusher. The recorded pressure rusher beats
  // his block home; anyone the slide does not pick up comes free.
  // animflow r6c2 (J7): the man the sim says covered the target is in coverage, not on the blitz.
  const coverK0 = play.coverId ? DEF_KEYS.find((k) => ctx.actors?.get(k)?.id === play.coverId) : undefined
  const blitzK = (play.blitz ? blitzKeys(seed) : []).filter((k) => k !== coverK0 || play.pressureId === play.coverId)
  const pressureKey = play.pressureId ? DEF_KEYS.find((k) => ctx.actors?.get(k)?.id === play.pressureId) : undefined
  // The recorded pressure rusher always rushes, even when the sim credited a
  // linebacker the slide never sent (backlog 152 follow-up).
  const rushers = ['dl0', 'dl1', 'dl2', 'dl3', ...blitzK]
  if (pressureKey && !rushers.includes(pressureKey)) rushers.push(pressureKey)
  // The pocket holds until just after the ball is out; then the rushers turn
  // and chase the throw and the linemen release downfield (animflow).
  const holdTo = Math.min(catchSec + 0.1, releaseSec + 0.25 + hash(seed + 23) * 0.3)
  const prot = passProtect(m, f, los, {
    rushers,
    blockers: ['ol0', 'ol1', 'ol2', 'ol3', 'ol4', ...stayIn],
    winner: pressureKey,
    qbTarget: posAt(m.qb.path, releaseSec),
    beaten: play.beatenBlockerId ? [...(ctx.actors?.entries() ?? [])].find(([, p]) => p.id === play.beatenBlockerId)?.[0] : undefined,
    arriveSec: releaseSec,
    holdTo,
    seed,
    ...(bestRusher ? { primary: bestRusher, double: plan?.off === 'doubleRusher' } : {}),
  })
  for (const pr of prot.pairs) {
    if (pr.r !== pressureKey && m[pr.r].t <= holdTo + 0.06) {
      // Off the block once the ball is gone: turn and run to the throw.
      const r = m[pr.r]
      jogTo(r, { x: r.x + (catchPt.x - r.x) * 0.45, y: r.y + (catchPt.y - r.y) * 0.45 }, r.pace.top * 0.8)
    }
  }
  // Where the play is headed (the recorded end spot on a catch).
  const playTo: Pt = inc || int ? catchPt : { x: clampX(Math.max(catchPt.x, 10 + play.endYard)), y: catchPt.y }
  for (const b of ['ol0', 'ol1', 'ol2', 'ol3', 'ol4', ...stayIn]) {
    const mv = m[b]
    // Linemen release downfield toward the ball.
    jogTo(mv, { x: clampX(Math.max(mv.x + 3, playTo.x - 4)), y: mv.y + (playTo.y - mv.y) * 0.45 }, 3.6)
  }
  // ── the throw (animflow round 3) ──────────────────────────────────────────
  // How he throws: on the move (boot / scramble / still running at the
  // release), hurried (a rusher on him), a deep shot, quick game, or a normal
  // dropback throw. The motion is timed to the release set above.
  const qbSpdAt = (t: number) => {
    const a = posAt(m.qb.path, Math.max(0, t - 0.06))
    const b = posAt(m.qb.path, t + 0.06)
    return Math.hypot(b.x - a.x, b.y - a.y) / 0.12
  }
  const rushGap = Math.min(...rushers.map((k) => {
    const p = posAt(m[k].path, releaseSec)
    return Math.hypot(p.x - releasePos.x, p.y - releasePos.y)
  }))
  // 'run' only when he is genuinely outside the pocket and moving at the release
  // (a bootleg / rollout, a real scramble past the tackle box); a recorded
  // pressure throw from inside it is a hurried pocket throw (animflow r4).
  const outsidePocket = Math.abs(releasePos.y - MID_Y) > 4.2
  const throwStyle: ThrowStyle = (boot || outsidePocket) && qbSpdAt(releaseSec) > 1.2 ? 'run'
    : scramble || rushGap < 1.9 || play.pressureType === 'hit' || play.pressureType === 'hurry' ? 'hurry'
    : depth >= 20 ? 'deep'
    : bucket === 'quick' || bucket === 'screen' ? 'quick' : 'normal'
  const thT = THROW_TIMING[throwStyle]
  LAST_THROW_STYLE = throwStyle
  const toTgt = (() => {
    const dx = catchPt.x - releasePos.x
    const dy = catchPt.y - releasePos.y
    const l = Math.hypot(dx, dy) || 1
    return { x: dx / l, y: dy / l }
  })()
  // The passer: a step toward the target into the release (a fade away from
  // the rush when hurried; none on the run), the follow-through with his feet
  // set, then he drifts toward the throw watching the ball.
  {
    const q = m.qb
    if (throwStyle !== 'run') {
      const t0 = releaseSec - 0.12
      if (q.t < t0) q.hold(t0 - q.t)
      else seek(q, t0)
      const stepLen = throwStyle === 'hurry' ? -0.45 : throwStyle === 'quick' ? 0.3 : 0.42
      const sx = throwStyle === 'hurry' ? -1 : toTgt.x
      const sy = throwStyle === 'hurry' ? 0 : toTgt.y
      runTimed(q, [{ x: clampX(q.x + sx * Math.abs(stepLen)), y: clampY(q.y + sy * Math.abs(stepLen)) }], q.t, releaseSec + 0.1, false, true)
      q.hold(Math.max(0, releaseSec + thT.follow - q.t))
    } else {
      // On the run: he carries his momentum through the release.
      const ry = rollY > MID_Y ? 1 : -1
      if (q.t < releaseSec) q.hold(releaseSec - q.t)
      else seek(q, releaseSec)
      jogTo(q, { x: clampX(q.x + 0.5), y: clampY(q.y + ry * 1.1) }, 2.6)
    }
    jogTo(q, { x: q.x + 1.2, y: q.y + (catchPt.y - q.y) * 0.05 }, 2.0)
    jogTo(q, { x: q.x + Math.max(3, (playTo.x - q.x) * 0.35), y: q.y + (playTo.y - q.y) * 0.35 }, 2.4)
  }

  // The ball rides in his hand: back to the ear through the wind-up, then out
  // over the top; the flight leaves from the hand at the release frame.
  const handAt = (t: number): Pt => {
    const p = posAt(m.qb.path, t)
    const off = throwHand(throwStyle, releaseSec - t).off
    return { x: clampX(p.x + toTgt.x * off), y: clampY(p.y + toTgt.y * off) }
  }
  const windT0 = Math.max(SNAP + 0.05, releaseSec - thT.wind)
  const ball: WP[] = snapBall(m, los, windT0)
  for (let i = 1; i <= 8; i++) {
    const t = windT0 + (releaseSec - windT0) * (i / 8)
    ball.push({ t, ...handAt(t) })
  }
  const handRel = handAt(releaseSec)
  const bias = clampN((70 - accuracy) * 0.03, -0.5, 1.0)
  ball.push(
    { t: (releaseSec + catchSec) / 2, x: clampX((handRel.x + catchPt.x) / 2 + bias), y: clampY((handRel.y + catchPt.y) / 2) },
    { t: catchSec, x: catchPt.x, y: catchPt.y },
  )
  const flights = [{ t0: releaseSec, t1: catchSec, height: Math.min(1, 0.35 + depth / 40) }]
  const holders: PlayAnim['holders'] = [{ t: 0, key: null }, { t: SNAP, key: 'qb' }, { t: releaseSec, key: null }]

  // ── coverage (backlog 151) ─────────────────────────────────────────────────
  // Every receiver who runs a route gets a defender or a zone responsibility.
  // The look is the play's recorded call when the sim gives one, else a
  // deterministic pick. Man defenders sit in the hip pocket (a short MCV-lag
  // mirror), zone defenders drop to ZCV-set landmarks and break on the ball.
  const trailEnd = catchSec
  const covOf = (k: string) => Math.max(attrOf(m[k].player, 'MCV'), attrOf(m[k].player, 'ZCV'))
  const creditId = play.tackleIds?.[0] ?? play.fumbleId
  const creditKey = creditId ? DEF_KEYS.find((k) => ctx.actors?.get(k)?.id === creditId) : undefined
  const coverId = play.coverId
  const coverKey = coverId ? DEF_KEYS.find((k) => ctx.actors?.get(k)?.id === coverId) : undefined
  const scheme = coverageScheme(play, seed)
  // Blitzers were already moved as part of the protection (backlog 152); here
  // the set is only used to keep them out of the coverage pool (151). The
  // recorded pressure rusher counts as a blitzer so he is never sent to cover.
  const blitzers = pressureKey && !blitzK.includes(pressureKey) ? [...blitzK, pressureKey] : blitzK
  const isBlitzer = (k: string) => blitzers.includes(k)
  // Pursuit after the catch: the coverage players converge on the ball carrier.
  // Pass rushers stay in the pocket behind the wall instead of chasing upfield
  // through the line (which would clip a blocker).
  const pursuers = DEF_KEYS.filter((k) => !isBlitzer(k))
  const runners = receivers.filter((k) => pathLen(m[k].path) > 3.5)
  // Separation should match the recorded result: hip-pocket tight on short and
  // contested plays, looser on a recorded big gain (a blown coverage).
  const bigGain = gainYds >= 20
  const tightness = int ? 0 : inc ? 0 : bigGain ? (hash(seed + 17) < 0.55 ? 1.0 : 0.55) : 0.15
  const deepKey = receivers.reduce((a, k) => ((ROUTES[routeMap[k]]?.depth ?? 0) > (ROUTES[routeMap[a]]?.depth ?? 0) ? k : a), receivers[0])
  const deepInfo = routeInfo(routeMap[deepKey] ?? '')
  const manPos: Record<string, string> = { wr0: 'cb0', wr1: 'cb1', wr2: 's1', te: 'lb0', rb: 'lb1', fb: 'lb2' }
  // animflow r6d (J12 SHADOW): the shadow corner has the WR1; his old man goes to the WR1's old defender.
  if (shadowPlan && manPos[shadowPlan.wr] !== shadowPlan.cb) {
    const was = Object.keys(manPos).find((r) => manPos[r] === shadowPlan!.cb)
    if (was) manPos[was] = manPos[shadowPlan.wr]
    manPos[shadowPlan.wr] = shadowPlan.cb
  }
  const zoneLook = scheme === 'zone' || scheme === 'twoHigh' || scheme === 'stack'
  const poolAll = ['cb0', 'cb1', 's1', 'lb0', 'lb1', 'lb2', 's0']
  // The sim's recorded coverage defender on the target (else the credited
  // tackler when he is a coverage player) carries him in man.
  const tgtManRaw = coverKey ?? (creditKey && /^(cb|lb|s)/.test(creditKey) ? creditKey : undefined)
  const tgtMan = tgtManRaw && !isBlitzer(tgtManRaw) ? tgtManRaw : undefined
  // Man-up: every route runner gets a defender who trails in his hip pocket
  // (over the top on verticals). A zone look just aligns them further off with
  // their eyes on the ball; the underneath/safety defenders not on a man run
  // the zone drops (backlog 151).
  const assign: Record<string, string> = {}
  const used = new Set<string>()
  const pool = poolAll.filter((k) => !isBlitzer(k))
  const take = (recv: string, prefer?: string) => {
    let d = prefer && !used.has(prefer) && !isBlitzer(prefer) ? prefer : manPos[recv]
    if (!d || used.has(d) || isBlitzer(d)) d = pool.find((x) => !used.has(x)) ?? d
    // Never hand a receiver to a rusher (that would erase the blitz) or double
    // up a defender that is already in coverage: leave him to the zone help.
    if (!d || used.has(d) || isBlitzer(d)) return
    used.add(d)
    assign[recv] = d
  }
  // animflow r6d (J12 SPY): the fastest linebacker not rushing / not the recorded cover man stays home
  // and mirrors the quarterback ~5 yd off the ball instead of dropping.
  let spyK: string | undefined
  if (plan?.def === 'spyQB') {
    const cands = ['lb0', 'lb1', 'lb2'].filter((k) => m[k] && !isBlitzer(k) && k !== tgtMan && k !== coverKey)
    spyK = cands.reduce<string | undefined>((a, k) => (!a || attrOf(m[k].player, 'SPD') > attrOf(m[a].player, 'SPD') ? k : a), undefined)
    if (spyK) used.add(spyK)
  }
  if (runners.includes(tgt)) take(tgt, tgtMan)
  for (const k of runners) if (!assign[k]) take(k)
  for (const recv of Object.keys(assign)) {
    manTrail(m[assign[recv]], recv, m[recv], { fromSec: 0.1, toSec: trailEnd, los, cov: covOf(assign[recv]), inw: inwOf(recv), tightness, seed, routeName: routeMap[recv] ?? '', zone: zoneLook, isTarget: recv === tgt, result: play.result, gain: gainYds })
  }
  // Stalk blocks (screens): the receiver gets his hands on his man and drives
  // him off the ball until the defender gets off it at the catch.
  for (const recv of receivers) {
    const dk = assign[recv]
    if (routeMap[recv] !== 'stalk' || recv === tgt || !dk) continue
    const t0 = Math.max(0.5, m[recv].t)
    const t1 = t0 + 1.6 + hash(seed + recv.length * 3) * 0.8
    seek(m[dk], t0)
    pocketPair(m, dk, [recv], t0, t1, -0.5, seed + 31 + recv.length)
    recEng(recv, dk, t0, t1, 'block')
    jogTo(m[recv], { x: clampX(m[recv].x + 4), y: m[recv].y + (MID_Y - m[recv].y) * 0.3 }, 3.5)
  }
  // Each route's cut, with the man defender when the look is man.
  for (const br of breaks) {
    const man = assign[br.k]
    recEv(br.t, 'break', man ? [br.k, man] : [br.k], br.pt)
  }
  // Unassigned defenders: safeties over the top, the rest rob / drop into a zone.
  for (const dk of poolAll) {
    if (isBlitzer(dk) || used.has(dk)) continue
    if (dk.startsWith('s')) safetyRoam(m[dk], { fromSec: 0.1, toSec: trailEnd, releaseSec, los, deep: m[deepKey], depth: deepInfo.depth, catchPt, side: dk === 's0' ? -1 : 1, start: { x: m[dk].x, y: m[dk].y } })
    else zoneDrop(m[dk], { fromSec: 0.1, toSec: trailEnd, releaseSec, landmark: { x: los + 8, y: dk === 'cb0' ? 8 : dk === 'cb1' ? FIELD_H - 8 : MID_Y + (dk === 'lb0' ? -8 : dk === 'lb2' ? 8 : 0) }, zcv: attrOf(m[dk].player, 'ZCV'), threat: m[deepKey], catchPt })
  }

  // animflow r6d (J12 disguise): the shell the offence sees before the snap. The post-snap shell is
  // what the safeties actually do (one rolled down to a man / the blitz = single high; both deep = two
  // high). An honest look shows it; a disguised one (play.disguised) shows the other and rotates at the
  // snap — two-high rolling to single-high, or a safety walked down to the box bailing to his half.
  const preSpots: Record<string, Pt> = {}
  {
    const down = (k: string) => used.has(k) || isBlitzer(k)
    const sDown = ['s0', 's1'].filter((k) => m[k] && down(k))
    const postSingle = sDown.length === 1
    const postTwo = sDown.length === 0
    const showSingle = play.disguised ? postTwo : postSingle
    if (showSingle && !postSingle) {
      // Two-high played, single-high shown: s1 walked down into the box, s0 in the middle.
      const side = f.s1.y < MID_Y ? -1 : 1
      preSpots.s1 = { x: los + 7.5, y: clampY(MID_Y + side * 8) }
      preSpots.s0 = { x: f.s0.x, y: clampY(MID_Y - side * 1.5) }
    } else if (showSingle) {
      // Honest single-high: the man coming down already shows it (his man / blitz alignment); the
      // other safety sits in the middle of the field.
      const hi = sDown[0] === 's0' ? 's1' : 's0'
      preSpots[hi] = { x: f[hi].x, y: clampY(MID_Y + (f[hi].y < MID_Y ? -1.5 : 1.5)) }
    } else if (play.disguised) {
      // Single-high (or zero) played, two-high shown: each man coming down starts on the deep half on
      // his own side of the field (straight back from his man, not across it).
      for (const k of sDown) {
        const y0 = m[k].path[0].y
        preSpots[k] = { x: Math.max(f[k].x - 1, m[k].path[0].x), y: clampY(MID_Y + clampN(y0 - MID_Y, -12, 12)) }
      }
    }
  }
  const finishPass = (rest: Parameters<typeof finish>[2]) => {
    for (const [k, pt] of Object.entries(preSpots)) {
      if (!m[k]) continue
      // Back on his script before he matters: a blitzer by ~1 s, a cover man before the release.
      presnapShift(m[k], pt, isBlitzer(k) || k === pressureKey ? SNAP + 0.9 : releaseSec - 0.1)
    }
    return finish(f, m, rest)
  }
  if (spyK) {
    // Mirror: his lane follows the QB's with a ~0.25 s read lag, at 5 yd off the ball, capped at his speed.
    const mv = m[spyK]
    const vmax = mv.pace.top * 0.9
    let x = mv.x
    let y = mv.y
    for (let t = Math.max(mv.t, 0.1) + 0.1; t <= trailEnd + 1e-6; t += 0.1) {
      const q = posAt(m.qb.path, Math.max(0, t - 0.25))
      const wx = clampX(Math.max(los + 4.5, q.x + 5.5))
      const wy = clampY(q.y)
      const d = Math.hypot(wx - x, wy - y)
      const k = d > vmax * 0.1 ? (vmax * 0.1) / d : 1
      x += (wx - x) * k
      y += (wy - y) * k
      mv.path.push({ t, x, y })
      mv.t = t
      mv.x = x
      mv.y = y
    }
    mv.lastStop = false
  }

  // animflow r6c2 (J7): the sim's matchup decides how open he is. The recorded
  // cover defender (coverDefenderId / coverId) is eased, over the last beat of
  // the route, to the recorded separation at the catch (separationYd: blanket
  // ~0.3, tight ~1.3, open ~2.5, wide ~5, a bust 9-12 yd) on the side he was
  // already playing — a trailing man trails further, a tight one closes.
  const sepYd = play.separationYd
  if (sepYd != null && !int && coverKey && m[coverKey] && !isBlitzer(coverKey) && coverKey !== tgt) {
    const mv = m[coverKey]
    const want = clampN(sepYd, 0.6, 12)
    const R = posAt(m[tgt].path, catchSec)
    const Dp = posAt(mv.path, catchSec)
    let ux = Dp.x - R.x
    let uy = Dp.y - R.y
    let ul = Math.hypot(ux, uy)
    if (ul < 0.3) {
      ux = -1
      uy = 0
      ul = 1
    }
    ux /= ul
    uy /= ul
    const P = { x: clampX(R.x + ux * want), y: clampY(R.y + uy * want) }
    const sx = P.x - Dp.x
    const sy = P.y - Dp.y
    const shift = Math.hypot(sx, sy)
    if (shift > 0.15) {
      const tA = Math.max(SNAP + 0.5, catchSec - clampN(shift / 2.2, 0.5, 2.2))
      if (catchSec - tA > 0.2) {
        const old = mv.path
        const out = old.filter((w) => w.t < tA - 1e-9)
        for (let t = tA; t < catchSec - 1e-6; t += 0.04) {
          const q = posAt(old, t)
          const u = (t - tA) / (catchSec - tA)
          const e = u * u * (3 - 2 * u)
          out.push({ t, x: clampX(q.x + sx * e), y: clampY(q.y + sy * e) })
        }
        out.push({ t: catchSec, x: P.x, y: P.y })
        for (const w of old) if (w.t > catchSec + 1e-6) out.push({ t: w.t, x: clampX(w.x + sx), y: clampY(w.y + sy) })
        mv.path = out
        const last = out[out.length - 1]
        mv.t = last.t
        mv.x = last.x
        mv.y = last.y
      }
    }
  }

  if (inc) {
    // A drop or a bang-bang miss: the ball skips off the receiver's hands.
    const cth = attrOf(m[tgt].player, 'CTH')
    const skip = clampN((100 - cth) * 0.02, 0, 0.8)
    ball.push({ t: catchSec + 0.14, x: clampX(catchPt.x + 1.4 + skip), y: clampY(catchPt.y + (hash(seed) - 0.5) * 3) })
    const stopT = catchSec + 0.16
    capAll(m, ALL_KEYS(f), stopT)
    recEv(catchSec, 'incomplete', [tgt, coverKey ?? nearestKey(m, DEF_KEYS, catchPt, catchSec)], catchPt)
    return finishPass({ ball, holders, flights })
  }

  if (int) {
    const spotX = changeSpot(play, ctx.next) ?? catchPt.x - 8
    const near = nearestKey(m, DEF_KEYS, catchPt, catchSec)
    recEv(catchSec, 'interception', [near, tgt], catchPt)
    recEv(catchSec, 'turnover', [near], catchPt)
    const v0 = seek(m[near], Math.max(0.12, catchSec - 0.06))
    m[near].run([{ x: catchPt.x, y: catchPt.y }], { v0, stop: true })
    const rx = clampX(spotX)
    const ry = clampY(catchPt.y + (MID_Y - catchPt.y) * 0.4)
    // After the pick the offense is the defense: the nearest offensive player
    // closes on the returner, who never freezes before the recorded stop.
    const res = resolveCarry({ m, carrierKey: near, spot: { x: rx, y: ry }, tacklerKeys: OFF_KEYS, seed })
    capAll(m, ALL_KEYS(f), res.endSec)
    recClose(m, near, res.tackler, res.endSec, OFF_KEYS, { from: catchSec, td: !!play.defTD, tdX: 110, tdDir: 1, outOfBounds: !!play.outOfBounds })
    ball.push(...shadow(m[near].path, catchSec).slice(1))
    return finishPass({ ball, holders: [...holders, { t: catchSec, key: near }], flights })
  }

  // Complete: the catch, then the run after it to the recorded end spot. A
  // touchdown caught in the end zone stays in the end zone (a step or two on).
  const goal = clampX(10 + play.endYard)
  const isTD = play.endYard >= 100 || goal >= 110
  const endX = goal >= 110 && catchPt.x >= goal ? clampX(catchPt.x + 1.5) : goal
  const yac = Math.abs(endX - catchPt.x)
  // T2M: a catch that went out of bounds finishes against the nearest sideline;
  // the end spot (x) is unchanged.
  const endY = play.outOfBounds
    ? (catchPt.y < MID_Y ? 1.6 : FIELD_H - 1.6)
    : clampY(catchPt.y + clampN((MID_Y - catchPt.y) * (yac > 8 ? 0.3 : 0.1) + (hash(seed + 8) - 0.5) * 3, -(0.3 * yac + 0.4), 0.3 * yac + 0.4))
  const spot: Pt = { x: endX, y: endY }

  if (play.turnover) {
    // A catch fumble: the ball pops loose and the defense recovers. Possession
    // and direction stay coherent; no tackle is invented.
    m[tgt].run([{ x: endX, y: endY }], { v0: catchV0, stop: true })
    const popT = Math.max(catchSec + 0.1, m[tgt].t * 0.92)
    const loose = { x: clampX(endX - 1 + (hash(seed + 5) - 0.5) * 4), y: clampY(endY + (hash(seed + 6) - 0.5) * 5) }
    const rec = creditKey ?? closestKey(m, DEF_KEYS, loose, popT)
    const rv = seek(m[rec], popT)
    m[rec].run([{ x: loose.x, y: loose.y }], { v0: rv, stop: true })
    const recT = m[rec].t
    chaseCarrier(m, DEF_KEYS.filter((k) => k !== rec), popT, m[tgt], popT + 0.4, seed)
    ball.push({ t: popT, x: loose.x, y: loose.y }, ...shadow(m[rec].path, popT).slice(1))
    recEv(catchSec, 'catch', [tgt, coverKey ?? nearestKey(m, DEF_KEYS, catchPt, catchSec)], catchPt)
    recEv(popT, 'fumble', [tgt, rec], { x: loose.x, y: loose.y })
    recEv(popT + 0.02, 'turnover', [rec], { x: loose.x, y: loose.y })
    recEv(recT, 'down', [rec], { x: loose.x, y: loose.y })
    capAll(m, ALL_KEYS(f), Math.max(recT, popT + 0.4))
    return finishPass({
      ball,
      holders: [...holders, { t: catchSec, key: tgt }, { t: popT, key: null }, { t: recT, key: rec }],
      flights,
    })
  }

  if (!isTD && play.outOfBounds && !clockStepOut(play)) {
    // animflow r8: a catch-and-run out of bounds is FORCED - a defender takes his cut-off angle and
    // is in front of / inside the receiver by the spot; the receiver bends to the sideline under
    // that pressure and is shoved out at the spot (x, result and the credited man unchanged).
    const credK = creditKey && pursuers.includes(creditKey) ? creditKey : undefined
    const outward = endY < MID_Y ? -1 : 1
    const forcerOf = (endSec: number): string | undefined => {
      const P = { x: endX + 0.6, y: endY - outward * 1.0 }
      const cand = (credK ? [credK] : []).concat(pursuers.filter((k) => k !== credK && m[k]))
      let best: { k: string; slack: number } | undefined
      for (const k of cand) {
        const slack = endSec - 0.15 - (catchSec + natTo(m[k], P, catchSec))
        if (slack >= 0 && k === credK) return k
        if (!best || slack > best.slack) best = { k, slack }
      }
      return best && best.slack >= 0 ? best.k : undefined
    }
    const c0 = { ...catchPt }
    const saved = m[tgt].pace
    let forcer: string | undefined
    for (let kk = 1; kk >= 0.45 - 1e-9; kk -= 0.07) {
      seek(m[tgt], catchSec)
      m[tgt].pace = { top: saved.top * kk, acc: saved.acc }
      // Upfield first, then he is turned toward the sideline as the cut-off man arrives.
      const mid = { x: clampX(c0.x + (endX - c0.x) * 0.62), y: clampY(c0.y + (endY - c0.y) * 0.3) }
      m[tgt].run(Math.abs(endX - c0.x) > 3 ? [mid, { x: endX, y: endY }] : [{ x: endX, y: endY }], { v0: Math.min(catchV0, m[tgt].pace.top), stop: true })
      m[tgt].pace = saved
      forcer = forcerOf(m[tgt].t)
      if (forcer) break
    }
    const endSec0 = m[tgt].t
    const others = pursuers.filter((k) => k !== forcer)
    angleChase(m, others, catchSec, m[tgt], endSec0, seed)
    if (forcer) hitAndRide(m[forcer], m[tgt], catchSec, Math.max(catchSec + 0.1, endSec0 - 0.3), endSec0, 3.0)
    stepOut(m[tgt], forcer ? [m[forcer]] : [])
    const endSec = m[tgt].t
    capAll(m, ALL_KEYS(f), endSec)
    ball.push(...shadow(m[tgt].path, catchSec).slice(1))
    recEv(catchSec, 'catch', [tgt, coverKey ?? nearestKey(m, DEF_KEYS, catchPt, catchSec)], catchPt)
    if (forcer) recEv(Math.max(catchSec + 0.1, endSec0 - 0.3), 'contact', [tgt, forcer], posAt(m[tgt].path, Math.max(catchSec + 0.1, endSec0 - 0.3)))
    recEv(endSec, 'outOfBounds', [tgt], posAt(m[tgt].path, endSec))
    return finishPass({ ball, holders: [...holders, { t: catchSec, key: tgt }], flights })
  }

  if (isTD || play.outOfBounds) {
    // A score or a step out of bounds: he keeps the ball to the spot and the
    // coverage chases, but nothing forces a tackle.
    // animflow r8: a deliberate step-out (clock) angles to the sideline early, on purpose.
    if (!isTD && Math.abs(endX - catchPt.x) > 4) {
      const early = { x: clampX(catchPt.x + (endX - catchPt.x) * 0.45), y: clampY(endY - (endY < MID_Y ? -1 : 1) * 1.2) }
      m[tgt].run([early], { v0: catchV0, stop: false })
      catchV0 = carrySpeed(m[tgt])
    }
    m[tgt].run([{ x: endX, y: endY }], { v0: catchV0, stop: !isTD })
    // animflow r6c2 (297): through the goal line at speed; the coverage takes
    // real pursuit angles (the fast men close, the rest angle at the pylon).
    if (isTD) runThroughGoal(m[tgt], 110, 1)
    else stepOut(m[tgt])
    const endSec = m[tgt].t
    // The chase is over at the goal line: they pull up as he crosses.
    const chaseTo = isTD ? Math.min(endSec, (crossX(m[tgt], 110, catchSec, endSec, 1) ?? endSec) + 0.3) : endSec
    angleChase(m, pursuers, catchSec, m[tgt], chaseTo, seed)
    capAll(m, ALL_KEYS(f), endSec)
    ball.push(...shadow(m[tgt].path, catchSec).slice(1))
    recEv(catchSec, 'catch', [tgt, coverKey ?? nearestKey(m, DEF_KEYS, catchPt, catchSec)], catchPt)
    const contact = firstContact(m, pursuers, tgt, catchSec, endSec, 1.0)
    if (contact && contact.t < endSec - 0.02) recEv(contact.t, 'contact', [tgt, contact.key], posAt(m[tgt].path, contact.t))
    if (isTD) {
      const st = crossX(m[tgt], 110, catchSec, endSec, 1) ?? endSec
      recEv(st, 'score', [tgt], posAt(m[tgt].path, st))
    } else {
      recEv(endSec, 'outOfBounds', [tgt], posAt(m[tgt].path, endSec))
    }
    return finishPass({ ball, holders: [...holders, { t: catchSec, key: tgt }], flights })
  }

  // In bounds and short of the goal line: the credited tackler (when the sim
  // named one) — else the defender who can actually arrive first — meets the
  // receiver at the recorded stop while he keeps running at his ratings' pace.
  const res = resolveCarry({ m, carrierKey: tgt, spot, tacklerKeys: pursuers, prefer: creditKey, seed, northSouth: true })
  capAll(m, ALL_KEYS(f), res.endSec)
  ball.push(...shadow(m[tgt].path, catchSec).slice(1))
  recEv(catchSec, 'catch', [tgt, coverKey ?? nearestKey(m, DEF_KEYS, catchPt, catchSec)], catchPt)
  recMissedTackles(play, ctx, tgt, catchSec, res.endSec, m, DEF_KEYS)
  recClose(m, tgt, res.tackler, res.endSec, pursuers, { play, los, from: catchSec })
  return finishPass({ ball, holders: [...holders, { t: catchSec, key: tgt }], flights })
}

/**
 * The blitz: the middle linebacker plus one outside linebacker (and sometimes a
 * safety) creep up before the snap and rush. Pure key selection (no movement):
 * the protection decides who is picked up and who comes free (backlog 152).
 */
function blitzKeys(seed: number): string[] {
  return ['lb1', hash(seed + 31) < 0.5 ? 'lb0' : 'lb2', ...(hash(seed + 37) < 0.3 ? ['s1'] : [])]
}

function buildSack(play: Play, ctx: AnimContext): PlayAnim {
  recStart()
  const los = 10 + play.startYard
  const snapK = snapKindFor(play.concept)
  const f = formation(los, false, snapK)
  const m = startMovers(f, ctx)
  recSnap(los)
  const seed = play.n * 17 + play.startYard
  const endX = clampX(10 + play.endYard)
  const dodge = hash(seed + 1) < 0.5 ? -1 : 1
  // The best pass rusher gets home (PMV/FMV); the sim's sack id tells us who.
  const sackKey = ctx.actors && play.sackId
    ? [...DEF_KEYS].find((k) => ctx.actors?.get(k)?.id === play.sackId) ?? null
    : null
  const rusherKey = sackKey ?? [...DEF_KEYS].sort((a, b) => {
    const ra = Math.max(attrOf(m[a].player, 'PMV'), attrOf(m[a].player, 'FMV'))
    const rb = Math.max(attrOf(m[b].player, 'PMV'), attrOf(m[b].player, 'FMV'))
    return rb - ra
  })[0]

  // Protection (backlog 152): the line doubles the best rusher, and the sim's
  // sacker beats his block — or splits the double — home to the quarterback.
  // The credited sacker always rushes, even when the sim picked a linebacker the
  // blitz package never sent (backlog 152 follow-up).
  const blitzK = play.blitz ? blitzKeys(seed) : []
  const rushers = ['dl0', 'dl1', 'dl2', 'dl3', ...blitzK]
  if (!rushers.includes(rusherKey)) rushers.push(rusherKey)
  const qbEnd = { x: endX, y: MID_Y + dodge * 3 }
  // A sack takes 2.5-3.5 s of real time: give the pocket a realistic duration so
  // the recorded rusher can actually get home (a 1.7 s drop would make any rush
  // arrive "late"). The drop shape and the final spot are unchanged.
  const pocketT = clampN(2.3 + (los - endX) * 0.09, 2.3, 3.5)
  // animflow round 2: a real drop first (done ~1.2 s), a set with his feet
  // alive while he looks downfield, then the escape attempt into the sack spot.
  const dropPt: Pt = { x: f.qb.x - (snapK === 'under' ? 6 : snapK === 'pistol' ? 3.2 : 2.6), y: MID_Y }
  const dropT = Math.min(1.25, pocketT - 0.9)
  runTimed(m.qb, [dropPt], 0, dropT, false, true)
  pocketPair(m, null, ['qb'], m.qb.t, pocketT - 0.55, -0.4, seed + 77)
  runTimed(m.qb, [{ x: (m.qb.x + endX) / 2 + 0.3, y: MID_Y + dodge * 2.5 }, qbEnd], m.qb.t, pocketT, false, true)
  const sackT = m.qb.t
  passProtect(m, f, los, {
    rushers,
    blockers: ['ol0', 'ol1', 'ol2', 'ol3', 'ol4'],
    winner: rusherKey,
    qbTarget: qbEnd,
    beaten: play.beatenBlockerId ? [...(ctx.actors?.entries() ?? [])].find(([, p]) => p.id === play.beatenBlockerId)?.[0] : undefined,
    arriveSec: sackT,
    holdTo: sackT,
    seed,
  })
  // The rest of the play is live while the pocket collapses (animflow): the
  // receivers run the called routes and keep working to get open, the back
  // checks his blitz and helps, the coverage carries the routes in man or
  // drops to its zones, eyes on the passer.
  const side = hash(seed + 3) < 0.5 ? -1 : 1
  const routeMap = conceptTree(play.concept, side)
  for (const k of ['wr0', 'wr1', 'wr2', 'te']) {
    const name = /^(stalk|runFake|block|passBlock)$/.test(routeMap[k] ?? '') ? 'hitch' : routeMap[k]
    const def = ROUTES[name] ?? ROUTES.check
    const inw = f[k].y < MID_Y ? 1 : -1
    const pts = def.wps(f[k].y, los, 1, inw, -inw, side).map((w) => ({ x: clampX(w.x), y: clampY(w.y) }))
    runRoute(m[k], pts, pts.length >= 3 ? pts.length - 2 : -1, routeRunRating(m[k].player, def.depth))
    // Scramble drill: keep working back toward the passer to get open.
    for (let g = 0; g < 3 && m[k].t < sackT; g++) {
      jogTo(m[k], { x: clampX(m[k].x - 2 + g), y: clampY(m[k].y + (g % 2 ? 1 : -1) * 3 * inw) }, 4.5)
    }
  }
  m.rb.run([{ x: los - 2.6, y: MID_Y - dodge * 2.2 }], { stop: true })
  pocketPair(m, null, ['rb'], m.rb.t, sackT, 0.6, seed + 9)
  const blitzers = blitzK.includes(rusherKey) ? blitzK : [...blitzK, rusherKey]
  const isB = (k: string) => blitzers.includes(k)
  const manOf: Record<string, string> = { wr0: 'cb0', wr1: 'cb1', wr2: 's1', te: 'lb0' }
  const covered = new Set<string>()
  for (const [recv, dk] of Object.entries(manOf)) {
    if (isB(dk)) continue
    covered.add(dk)
    manTrail(m[dk], recv, m[recv], { fromSec: 0.1, toSec: sackT, los, cov: Math.max(attrOf(m[dk].player, 'MCV'), attrOf(m[dk].player, 'ZCV')), inw: f[recv].y < MID_Y ? 1 : -1, tightness: 0.15, seed, routeName: routeMap[recv] ?? '' })
  }
  for (const dk of ['lb0', 'lb1', 'lb2', 's0', 's1', 'cb0', 'cb1']) {
    if (isB(dk) || covered.has(dk)) continue
    if (dk.startsWith('s')) safetyRoam(m[dk], { fromSec: 0.1, toSec: sackT, releaseSec: sackT, los, deep: m.wr1, depth: 15, catchPt: qbEnd, side: dk === 's0' ? -1 : 1, start: { x: m[dk].x, y: m[dk].y } })
    else zoneDrop(m[dk], { fromSec: 0.1, toSec: sackT, releaseSec: sackT, landmark: { x: los + 7, y: MID_Y + (dk === 'lb0' ? -8 : dk === 'lb2' ? 8 : 0) }, zcv: attrOf(m[dk].player, 'ZCV'), threat: m.te, catchPt: qbEnd })
  }
  capAll(m, ALL_KEYS(f), sackT)
  const ball = snapBall(m, los, sackT)
  recEv(sackT, 'sack', [rusherKey, 'qb'], qbEnd)
  if (play.stripSack || play.turnover) recEv(sackT - 0.03, 'fumble', [rusherKey, 'qb'], qbEnd)
  if (play.turnover) recEv(sackT - 0.015, 'turnover', [rusherKey], qbEnd)
  return finish(f, m, { ball, holders: [{ t: 0, key: null }, { t: SNAP, key: 'qb' }], flights: [] })
}

/** The pre-round-5 punt (touchbacks and blocked punts keep it). */
function buildPuntLegacy(play: Play, ctx: AnimContext): PlayAnim {
  recStart()
  const los = 10 + play.startYard
  const f = formation(los)
  f.qb = { ...f.qb, x: los - 13, role: 'P' }
  f.s0 = { ...f.s0, x: los + 40, y: MID_Y - 4, role: 'PR' }
  const m = startMovers(f, ctx)
  recSnap(los)
  const seed = play.n * 19 + play.startYard
  const kind = play.returnKind
  const touchback = kind === 'touchback' || play.result.includes('touchback')
  const isReturn = kind === 'return' && !!play.returnerId
  const td = !!play.returnTD
  const retYds = Math.max(0, play.returnYards ?? 0)
  // R6: the returner's end spot is exactly what the sim recorded — the next
  // possession's snap (or the goal line on a return score). The punting club
  // drives toward x=110, so a return comes back toward x=10: the catch sits
  // deeper than the end spot by the recorded return yardage.
  const finalX = td ? 10 : clampX(changeSpot(play, ctx.next) ?? 10 + play.startYard + play.yards)
  const isReturnOrMuff = isReturn || kind === 'muff'
  const landX = touchback ? 108 : isReturnOrMuff ? clampX(finalX + retYds) : finalX
  const side = hash(seed + 2) < 0.5 ? -1 : 1
  const landY = clampY(MID_Y + (hash(seed + 1) - 0.5) * 12)
  const endY = isReturn ? clampY(landY + side * (3 + hash(seed + 3) * 7)) : landY
  const landPt: Pt = { x: landX, y: landY }
  const spot: Pt = { x: finalX, y: endY }
  const kickDist = Math.max(10, Math.abs(landX - los))
  // A realistic hang (the ball is in the air long enough for the coverage to
  // run downfield) — the old flight was ~1s, which left coverage standing.
  const flight = clampN(1.1 + kickDist * 0.06, 2.2, 4.4)
  const kickT = 0.35

  // Request 133: the punting club (the animation's offense) is the full 11-man
  // coverage unit — punter back, ten players across the line. The receiving
  // club (the defense, s0 the returner) fields it with ten blockers in a wall.
  const cov = OFF_KEYS
  const blk = DEF_KEYS.filter((k) => k !== 's0')
  m.qb.reset(clampX(los - 13), MID_Y)
  cov.filter((k) => k !== 'qb').forEach((k, i) => m[k].reset(clampX(los + 1), clampY(4 + i * 4.6)))
  blk.forEach((k, i) => m[k].reset(clampX(landPt.x - 5 - (i % 2) * 3), clampY(6 + i * 4.5)))

  // The returner backpedals to the catch spot from the field side, so he is
  // still moving as the punt arrives (not parked under it for the hang).
  const kStart = clampN(m.s0.pace.top * flight * 0.7, 5, 22)
  m.s0.reset(clampX(landPt.x - kStart), clampY(landPt.y + (landPt.y > MID_Y ? 4 : -4)))
  const trackT = straightTime(m.s0.pace, Math.hypot(landPt.x - m.s0.x, landPt.y - m.s0.y), 0)
  const landT = Math.max(kickT + flight, trackT + 0.15)
  // He drifts under the punt, timing his arrival to the catch.
  runTimed(m.s0, [{ x: landPt.x, y: landPt.y }], 0, landT, false, true)
  if (m.s0.t < landT) m.s0.hold(landT - m.s0.t)
  recEv(kickT, 'kick', ['qb'], posAt(m.qb.path, kickT))

  if (touchback) {
    cov.forEach((k, i) => runTimed(m[k], [{ x: clampX(los + 20 + i), y: clampY(f[k].y) }], m[k].t, landT, false, true))
    blk.forEach((k, i) => runTimed(m[k], [{ x: clampX(30 + i * 3), y: clampY(4 + i * 4.5) }], m[k].t, landT, false, true))
    const ball: WP[] = [...snapBall(m, los, kickT), { t: landT, x: 116, y: MID_Y }]
    recEv(landT, 'touchback', ['s0'], { x: 116, y: MID_Y })
    return finish(f, m, { ball, holders: [{ t: 0, key: null }, { t: SNAP, key: 'qb' }, { t: kickT, key: null }], flights: [{ t0: kickT, t1: landT, height: 1 }] })
  }

  if (!isReturn) {
    // Fair catch / downed / muff: the ball is dead where it lands; coverage
    // converges on the spot but there is no return and no invented tackle.
    loftCoverage(m, cov, 0, landT, landPt, seed)
    blk.forEach((k, i) => runTimed(m[k], [{ x: clampX(landPt.x - 4 - i * 2), y: clampY(landPt.y + (i - 5) * 4) }], m[k].t, landT + 0.6, false, true))
    const downKey = closestKey(m, cov, landPt, landT)
    chaseCarrier(m, cov.filter((k) => k !== downKey), landT, m.s0, landT + 0.8, seed)
    const ball: WP[] = [...snapBall(m, los, kickT), { t: landT, x: landPt.x, y: landPt.y }]
    if (kind === 'muff') {
      const loose = { x: clampX(landPt.x + (hash(seed + 4) - 0.5) * 6), y: clampY(landPt.y + (hash(seed + 5) - 0.5) * 6) }
      ball.push({ t: landT + 0.25, x: loose.x, y: loose.y }, { t: landT + 0.45, x: loose.x, y: loose.y })
    }
    if (kind === 'fairCatch') recEv(landT, 'fairCatch', ['s0'], landPt)
    else if (kind === 'muff') {
      recEv(landT, 'fumble', ['s0'], landPt)
      if (play.turnover) recEv(landT + 0.02, 'turnover', [downKey], landPt)
      recEv(landT + 0.45, 'down', ['s0'], landPt)
    } else if (kind === 'blocked') {
      if (play.turnover) recEv(kickT + 0.05, 'turnover', [downKey], landPt)
      recEv(landT, 'down', [downKey], landPt)
    } else {
      recEv(landT, 'down', [downKey], landPt)
    }
    return finish(f, m, {
      ball,
      holders: kind === 'fairCatch' ? [{ t: 0, key: null }, { t: SNAP, key: 'qb' }, { t: kickT, key: null }, { t: landT, key: 's0' }] : [{ t: 0, key: null }, { t: SNAP, key: 'qb' }, { t: kickT, key: null }],
      flights: [{ t0: kickT, t1: landT, height: 1 }],
    })
  }

  // A real return: the coverage runs downfield during the hang, the ten
  // blockers meet it in the return lane, and the closest coverage man reaches
  // the recorded stop as the moving returner arrives. Any slack becomes a
  // lateral cut, never a freeze (backlog 150).
  loftCoverage(m, cov, 0, landT, landPt, seed)
  const tackler = closestKey(m, cov, spot, landT)
  const tkv = seek(m[tackler], landT)
  const tkPos = posAt(m[tackler].path, landT)
  const tkNatural = straightTime(m[tackler].pace, Math.hypot(spot.x - tkPos.x, spot.y - tkPos.y), tkv)
  const retNatural = timedLine([landPt, spot], m.s0.pace, { v0: 0, stop: true }).slice(-1)[0]?.t ?? 0
  const plan = planBlocks(m, blk, cov.filter((k) => k !== tackler), landT, seed)
  const maxTe = plan.reduce((mx, pl) => Math.max(mx, pl.te), 0)
  let end = landT + Math.max(tkNatural, retNatural, Math.max(0, maxTe - landT) + 0.3, 0.3)
  const fillReturner = (to: number) => {
    if (m.s0.t < to - 0.06) {
      m.s0.run(routeByTime({ x: m.s0.x, y: m.s0.y }, spot, m.s0.pace, carrySpeed(m.s0), to - m.s0.t, 2.0), { v0: carrySpeed(m.s0), stop: true })
    }
    return Math.max(to, m.s0.t)
  }
  m.s0.run(routeByTime(landPt, spot, m.s0.pace, 0, end - landT, 2.5), { v0: 0, stop: true })
  end = fillReturner(end)
  m[tackler].run(routeByTime(tkPos, spot, m[tackler].pace, tkv, Math.max(0.1, end - landT)), { v0: tkv, stop: true })
  end = fillReturner(Math.max(end, m[tackler].t))
  applyBlockEngagements(m, plan, m.s0, end, seed)
  if (m[tackler].t < end) m[tackler].hold(end - m[tackler].t)
  for (const k of cov) if (k !== tackler) capAt(m[k], end)
  for (const k of blk) capAt(m[k], end)

  const ball: WP[] = [...snapBall(m, los, kickT), { t: landT, x: landPt.x, y: landPt.y }, ...shadow(m.s0.path, landT).slice(1)]
  recEv(landT, 'catch', ['s0', tackler], landPt)
  recClose(m, 's0', tackler, end, cov, { td, tdX: 10, tdDir: -1, outOfBounds: !!play.outOfBounds })
  return finish(f, m, {
    ball,
    holders: [{ t: 0, key: null }, { t: SNAP, key: 'qb' }, { t: kickT, key: null }, { t: landT, key: 's0' }],
    flights: [{ t0: kickT, t1: landT, height: 1 }],
  })
}

function buildKick(play: Play, ctx: AnimContext): PlayAnim {
  recStart()
  const los = 10 + snapYard(play)
  const f = formation(los)
  f.qb = { ...f.qb, x: los - 7, role: 'H' }
  f.rb = { ...f.rb, x: los - 9.5, y: MID_Y - 2, role: 'K' }
  const m = startMovers(f, ctx)
  recSnap(los)
  const good = /good/.test(play.result) && !/no good|MISSED/i.test(play.result)
  const blocked = !!play.blockedKick || /BLOCKED/i.test(play.result)
  const seed = play.n * 23 + play.startYard
  const kpw = attrOf(m.rb.player, 'KPW')
  const kickT = 0.3
  m.qb.run([{ x: los - 7.5, y: MID_Y - 0.5 }], { stop: true })
  m.rb.run([{ x: los - 7.2, y: MID_Y - 0.5 }], { stop: true })
  for (let i = 0; i < 4; i++) m[`dl${i}`].run([{ x: los, y: f[`dl${i}`].y }], { stop: true })
  recEv(kickT, 'kick', ['rb'], posAt(m.rb.path, kickT))
  if (play.turnover && blocked) recEv(kickT + 0.04, 'turnover', ['dl0'], posAt(m.dl0.path, kickT + 0.04))

  // ── the kick's flight (animflow r4): broadcast/animData kickFlight ─────────
  const kf = kickFlight({ los, kickT, good, blocked, kpw, seed: (k) => hash(seed + k) })
  const ball: WP[] = [{ t: 0, x: los, y: MID_Y }, { t: SNAP, x: los - 7, y: MID_Y }, ...kf.ball]
  const kz = kf.kz
  const endT = kf.endT
  const resT = kf.resT
  const resPt = kf.resPt
  recEv(resT, good ? 'kickGood' : 'kickMiss', ['rb'], resPt)
  // Everyone watches it through; the clip runs until the ball is down.
  const tail = endT + 0.5
  { const lb = ball[ball.length - 1]; ball.push({ t: tail, x: lb.x, y: lb.y }) }
  for (const k of ALL_KEYS(f)) if (m[k].t < tail) m[k].hold(tail - m[k].t)
  return finish(f, m, {
    ball,
    holders: [{ t: 0, key: null }, { t: SNAP, key: 'qb' }, { t: kickT, key: null }],
    flights: [{ t0: kickT, t1: endT, height: 1 }],
    posts: true,
    kickZ: kz,
  })
}

/** The pre-round-5 kickoff (touchbacks keep it). */
function buildKickoffLegacy(play: Play, ctx: AnimContext): PlayAnim {
  recStart()
  // The receiving club is the offense; the kick comes from their own end back.
  const f = formation(10 + play.startYard)
  const m = startMovers(f, ctx)
  const kickX = 75
  const endX = clampX(10 + play.endYard)
  const touchback = play.result === 'Touchback' || play.returnKind === 'touchback'
  const td = !!play.returnTD
  const fumble = !touchback && !td && !!play.turnover
  const retYds = Math.max(0, play.returnYards ?? 0)
  const seed = play.n * 29 + play.startYard
  const side = hash(seed) < 0.5 ? -1 : 1
  // Catch is backed out of the recorded return so the run to the recorded end
  // (endX) matches the box score; a touchback is fielded in the end zone.
  const catchX = touchback ? 6 : clampX(endX - retYds)
  const catchY = MID_Y
  const seamY = clampY(MID_Y + side * (4 + hash(seed + 1) * 9))
  const endY = touchback ? MID_Y : seamY
  const catchPt: Pt = { x: catchX, y: catchY }
  const spot: Pt = { x: touchback ? catchX : endX, y: endY }

  // Request 133: both full units. The kicking club's 11 coverage players spread
  // across the kicking line; the receiving club's ten blockers form a wall in
  // lanes ahead of the returner, who drifts in under the kick.
  const covKeys = DEF_KEYS
  const blkKeys = OFF_KEYS.filter((k) => k !== 'rb')
  covKeys.forEach((k, i) => m[k].reset(clampX(kickX + 1), clampY(3 + i * 4.7)))
  // A touchback's front line sets up around its own 35 (no wall to form); a
  // return's blockers form the wall just ahead of the catch.
  blkKeys.forEach((k, i) =>
    m[k].reset(clampX(touchback ? 43 + (i % 2) * 5 : catchX + 3 + (i % 2) * 3), clampY(5 + i * 4.6)),
  )
  const kickDist = Math.max(10, kickX - catchX)
  const minFlight = clampN(0.9 + kickDist * 0.035, 1.8, 3.2)
  const kStart = clampN(m.rb.pace.top * Math.max(0.4, minFlight - 0.1) * 0.8, 3, 16)
  m.rb.reset(clampX(catchX - kStart), MID_Y)
  const trackT = straightTime(m.rb.pace, Math.hypot(catchPt.x - m.rb.x, catchPt.y - m.rb.y), 0)
  let catchT = Math.max(minFlight, trackT + 0.15)
  // The returner settles under the ball: he times his drift to the catch.
  const settleUnder = () => {
    if (m.rb.t > 0) return
    runTimed(m.rb, [{ x: catchPt.x - 1.2, y: catchPt.y + 0.4 }, { x: catchPt.x, y: catchPt.y }], 0, catchT, false, true)
    if (m.rb.t < catchT) m.rb.hold(catchT - m.rb.t)
  }
  recEv(0, 'kick', ['s1'], { x: kickX, y: MID_Y })

  if (touchback) {
    settleUnder()
    // No return: the kick sails into the RECEIVING end zone (low x — the kick
    // travels from kickX toward catchX), the coverage converges downfield, the
    // front line drifts back and the returner downs it. No tackle is invented.
    covKeys.forEach((k, i) => runTimed(m[k], [{ x: clampX(kickX - 16 - i * 1.5), y: clampY(4 + i * 4.6) }], m[k].t, catchT, false, true))
    blkKeys.forEach((k, i) => runTimed(m[k], [{ x: clampX(30 + (i % 2) * 4), y: clampY(4 + i * 4.6) }], m[k].t, catchT, false, true))
    const ball: WP[] = [{ t: 0, x: kickX, y: MID_Y }, { t: catchT, x: catchX, y: MID_Y }]
    recEv(catchT, 'touchback', ['rb'], { x: catchX, y: MID_Y })
    return finish(f, m, { ball, holders: [{ t: 0, key: null }], flights: [{ t0: 0, t1: catchT, height: 1 }] })
  }

  // Which defender brings him down: kickoffs carry no credited tackle id, so
  // the closest eligible coverage man to the recorded stop is the visual
  // fallback (reported by the audit).
  const tackler = closestKey(m, DEF_KEYS, spot, 0)
  const tkStart = posAt(m[tackler].path, 0)
  const tkNatural = straightTime(m[tackler].pace, Math.hypot(spot.x - tkStart.x, spot.y - tkStart.y), 0)
  const retNatural = timedLine([catchPt, spot], m.rb.pace, { v0: 0, stop: true }).slice(-1)[0]?.t ?? 0
  // Give the coverage enough hang to arrive; the tackler is then routed to the
  // recorded stop and the carrier retimed (a pursuit bow, never a slow walk) so
  // the two meet there. Yardage is fixed — only the timing and lane bow move.
  catchT = Math.max(catchT, Math.min(3.6, tkNatural - retNatural + 0.1))
  settleUnder()
  // Plan the ten blocker/coverage engagements, then give the play enough time
  // for them to resolve before the returner reaches the recorded stop.
  const plan = planBlocks(m, blkKeys, covKeys.filter((k) => k !== tackler), catchT, seed)
  const maxTe = plan.reduce((mx, pl) => Math.max(mx, pl.te), 0)
  let end = Math.max(tkNatural, catchT + retNatural, maxTe + 0.3)
  const fillReturner = (to: number) => {
    if (m.rb.t < to - 0.06) {
      m.rb.run(routeByTime({ x: m.rb.x, y: m.rb.y }, spot, m.rb.pace, carrySpeed(m.rb), to - m.rb.t, 2.0), { v0: carrySpeed(m.rb), stop: true })
    }
    return Math.max(to, m.rb.t)
  }
  m.rb.run(routeByTime(catchPt, spot, m.rb.pace, 0, end - catchT, 2.5), { v0: 0, stop: true })
  end = fillReturner(end)

  // The tackler chases the moving carrier and meets him at the recorded stop (a
  // return score is chased but never forced).
  const tkFrom = { x: m[tackler].x, y: m[tackler].y }
  m[tackler].run(routeByTime(tkFrom, spot, m[tackler].pace, 0, Math.max(0.1, end - m[tackler].t), td ? 1.5 : 0), { v0: 0, stop: true })
  end = fillReturner(Math.max(end, m[tackler].t))

  // The ten blockers meet the ten field cover defenders in the return lane.
  applyBlockEngagements(m, plan, m.rb, end, seed)
  if (m[tackler].t < end) m[tackler].hold(end - m[tackler].t)
  for (const k of covKeys) if (k !== tackler) capAt(m[k], end)
  for (const k of blkKeys) capAt(m[k], end)

  const ball: WP[] = [{ t: 0, x: kickX, y: MID_Y }, { t: catchT, x: catchPt.x, y: catchPt.y }]
  if (fumble) {
    // The ball squirts loose beside the returner and a coverage man physically
    // recovers it: the ball leaves the carrier's hands at his own spot, rolls
    // to the loose point, and only then does the recovery actor carry it on —
    // no jump to a distant point before anyone arrives.
    const popT = Math.max(catchT + 0.2, catchT + (end - catchT) * 0.72)
    const rbPos = posAt(m.rb.path, popT)
    const loose = { x: clampX(rbPos.x + 1.2 + (hash(seed + 6) - 0.5) * 3), y: clampY(rbPos.y + (hash(seed + 6) - 0.5) * 4) }
    const rec = closestKey(m, DEF_KEYS, loose, popT)
    const rv = seek(m[rec], popT)
    m[rec].run([{ x: loose.x, y: loose.y }], { v0: rv, stop: true })
    const recT = m[rec].t
    // The returner loses the ball and stumbles down.
    seek(m.rb, popT)
    m.rb.hold(0.4)
    ball.push(
      ...shadow(m.rb.path, catchT, popT).slice(1),
      { t: popT + 0.12, x: loose.x, y: loose.y },
      { t: Math.max(recT, popT + 0.2), x: loose.x, y: loose.y },
      ...shadow(m[rec].path, recT).slice(1),
    )
    recEv(catchT, 'catch', ['rb', rec], catchPt)
    recEv(popT, 'fumble', ['rb', rec], { x: loose.x, y: loose.y })
    recEv(popT + 0.02, 'turnover', [rec], { x: loose.x, y: loose.y })
    recEv(recT, 'down', [rec], { x: loose.x, y: loose.y })
    return finish(f, m, {
      ball,
      holders: [{ t: 0, key: null }, { t: catchT, key: 'rb' }, { t: popT, key: null }, { t: recT, key: rec }],
      flights: [{ t0: 0, t1: catchT, height: 1 }],
    })
  }
  ball.push(...shadow(m.rb.path, catchT).slice(1))
  recEv(catchT, 'catch', ['rb', tackler], catchPt)
  recClose(m, 'rb', tackler, end, DEF_KEYS, { td, tdX: 110, tdDir: 1, outOfBounds: !!play.outOfBounds, from: catchT })
  return finish(f, m, {
    ball,
    holders: [{ t: 0, key: null }, { t: catchT, key: 'rb' }],
    flights: [{ t0: 0, t1: catchT, height: 1 }],
  })
}

// ── kick / punt returns on the live field (animflow round 5) ────────────────
/** A returner's pace on the return: real acceleration (~5 yd/s², 0 → 6 yd/s in ~1.2 s). */
function returnPace(mv: Mover): Pace {
  return { top: mv.pace.top, acc: Math.min(mv.pace.acc, 5.2) }
}

/**
 * Script the returner from the catch: the scheme's line to the recorded spot,
 * first contact a yard or so short of it and the pile to exactly the spot. If
 * the coverage could not physically be there in time he runs it patiently
 * (slower, then a wider line). Returns contact and whistle times.
 */
function scriptReturn(mv: Mover, from: Pt, spot: Pt, dir: 1 | -1, scheme: 'wall' | 'middle', needT: number, td: boolean, seed: number): { contactT: number; endSec: number; c: Pt } {
  const saved = mv.pace
  mv.pace = returnPace(mv)
  const line = returnLine(from, spot, dir, scheme)
  const total = polyLen(from, line)
  const ac = td ? 0 : clampN(yardsAfterContact(mv.player, total, seed) * 0.7, 0.4, 1.6)
  const { pre, post, c } = splitPolyline(from, line, Math.max(0, total - ac))
  const natFor = (k: number) => (pre.length ? timedLine([from, ...pre], { top: mv.pace.top * k, acc: mv.pace.acc }, { v0: 0, stop: false }).slice(-1)[0]?.t ?? 0 : 0)
  const t0 = mv.t
  const vc = Math.min(1.8, carrySpeed(mv))
  let k = 1
  if (!td) while (k > 0.74 && t0 + natFor(k) < needT) k -= 0.04
  mv.pace = { top: mv.pace.top * k, acc: mv.pace.acc }
  if (pre.length) {
    if (!td && t0 + natFor(k) < needT - 0.05) mv.run(routeByTime(from, c, mv.pace, vc, needT - t0, 0), { v0: vc, stop: false })
    else mv.run(pre, { v0: vc, stop: td })
  }
  const contactT = mv.t
  if (!td) pileDrive(mv, post, carrySpeed(mv))
  else mv.lastStop = true
  mv.pace = saved
  return { contactT, endSec: mv.t, c }
}

/** Earliest a coverage man (from his t=0 spot) could be at `c` (s). */
function coverNeed(m: Record<string, Mover>, keys: string[], c: Pt): number {
  let best = Infinity
  for (const k of keys) {
    const s = m[k].path[0]
    best = Math.min(best, straightTime(m[k].pace, Math.hypot(c.x - s.x, c.y - s.y), 0) + 0.35)
  }
  return best
}

function buildPunt(play: Play, ctx: AnimContext): PlayAnim {
  const kind = play.returnKind
  const touchback = kind === 'touchback' || play.result.includes('touchback')
  if (touchback || kind === 'blocked') return buildPuntLegacy(play, ctx)
  recStart()
  const los = 10 + play.startYard
  const f = formation(los)
  f.qb = { ...f.qb, x: los - 14, role: 'P' }
  f.s0 = { ...f.s0, x: los + 40, y: MID_Y - 4, role: 'PR' }
  const m = startMovers(f, ctx)
  recSnap(los)
  const seed = play.n * 19 + play.startYard
  const isReturn = kind === 'return' && !!play.returnerId
  const td = !!play.returnTD
  const retYds = Math.max(0, play.returnYards ?? 0)
  const finalX = td ? 10 : clampX(changeSpot(play, ctx.next) ?? 10 + play.startYard + play.yards)
  const isReturnOrMuff = isReturn || kind === 'muff'
  const landX = isReturnOrMuff ? clampX(finalX + retYds) : finalX
  const side = hash(seed + 2) < 0.5 ? -1 : 1
  const landY = clampY(MID_Y + (hash(seed + 1) - 0.5) * 12)
  const endY = isReturn ? clampY(landY + side * (3 + hash(seed + 3) * 7)) : landY
  const landPt: Pt = { x: landX, y: landY }
  const spot: Pt = { x: finalX, y: endY }
  const kickDist = Math.max(10, Math.abs(landX - los))
  // Snap to kick ~2.0 s (the long snap reaches the punter in ~0.8 s), a real hang.
  const snapArr = SNAP + 0.78
  const kickT = SNAP + 1.9 + (hash(seed + 7) - 0.5) * 0.2
  const flight = clampN(1.4 + kickDist * 0.058, 3.0, 4.8)

  // The punt unit: line, wings, personal protector, two gunners, the punter.
  // The return unit: six rushers over the protection, two jammers on the
  // gunners, a hold-up man in the middle, a second deep man; s0 returns.
  const gunners = ['wr0', 'wr1']
  const protectors = ['ol0', 'ol1', 'ol3', 'ol4', 'wr2', 'te', 'ol2', 'rb']
  const rushers = ['dl0', 'dl1', 'dl2', 'dl3', 'lb0', 'lb1']
  const jammers = ['cb0', 'cb1']
  const cov = OFF_KEYS
  const blk = DEF_KEYS.filter((k) => k !== 's0')
  ;[-4, -2, 0, 2, 4].forEach((d, i) => m[`ol${i}`].reset(clampX(los - 0.6), clampY(MID_Y + d)))
  m.wr2.reset(clampX(los - 1.3), clampY(MID_Y - 6.2))
  m.te.reset(clampX(los - 1.3), clampY(MID_Y + 6.2))
  m.rb.reset(clampX(los - 6), clampY(MID_Y + 0.9))
  m.wr0.reset(clampX(los - 0.6), 6)
  m.wr1.reset(clampX(los - 0.6), FIELD_H - 6)
  m.qb.reset(clampX(los - 14), MID_Y)
  ;[-4, -2, 2, 4].forEach((d, i) => m[`dl${i}`].reset(clampX(los + 1.1), clampY(MID_Y + d)))
  m.lb0.reset(clampX(los + 1.2), clampY(MID_Y - 6.2))
  m.lb1.reset(clampX(los + 1.2), clampY(MID_Y + 6.2))
  m.cb0.reset(clampX(los + 1.4), 7.1)
  m.cb1.reset(clampX(los + 1.4), FIELD_H - 7.1)
  m.lb2.reset(clampX(los + 9), clampY(MID_Y + side * 2))
  m.s1.reset(clampX(landX - 14), clampY(landY - side * 8))

  // The returner drifts under the punt and times his arrival to the catch.
  const kStart = clampN(m.s0.pace.top * flight * 0.5, 5, 18)
  m.s0.reset(clampX(landPt.x - kStart), clampY(landPt.y + (landPt.y > MID_Y ? 4 : -4)))
  const trackT = straightTime(m.s0.pace, Math.hypot(landPt.x - m.s0.x, landPt.y - m.s0.y), 0)
  let landT = Math.max(kickT + flight, trackT + 0.15)
  const covNoP = cov.filter((k) => k !== 'qb')
  const { scheme } = returnScheme(landPt, isReturn ? spot : landPt)

  // Contact/whistle of the return (or the end of a fair catch / downed / muff).
  let contactT = landT + 0.8
  let endSec = landT + 0.8
  let cPt: Pt = landPt
  const settleUnderPunt = () => {
    runTimed(m.s0, [{ x: landPt.x, y: landPt.y }], 0, landT, false, true)
    if (m.s0.t < landT) m.s0.hold(landT - m.s0.t)
  }
  if (isReturn) {
    const line = returnLine(landPt, spot, -1, scheme)
    const total = polyLen(landPt, line)
    const ac = td ? 0 : clampN(yardsAfterContact(m.s0.player, total, seed) * 0.7, 0.4, 1.6)
    cPt = splitPolyline(landPt, line, Math.max(0, total - ac)).c
    const need = coverNeed(m, covNoP, cPt)
    settleUnderPunt()
    const r = scriptReturn(m.s0, landPt, spot, -1, scheme, need, td, seed)
    contactT = r.contactT
    endSec = r.endSec
    cPt = r.c
  } else {
    settleUnderPunt()
    // Fair catch: he stays on the spot; downed / muff: he backs away and watches.
    if (kind === 'fairCatch') m.s0.run([{ x: clampX(landPt.x - 0.4), y: landPt.y }], { stop: true })
    else m.s0.run([{ x: clampX(landPt.x + 3), y: clampY(landPt.y + 1.5) }], { stop: true })
    if (m.s0.t < endSec) m.s0.hold(endSec - m.s0.t)
  }
  recEv(kickT, 'kick', ['qb'], posAt(m.qb.path, kickT))

  const credited = play.tackleIds?.[0]
  const creditedKey = credited ? cov.find((k) => ctx.actors?.get(k)?.id === credited) : undefined
  const designated = isReturn && !td ? creditedKey ?? closestKey(m, covNoP, cPt, 0) : undefined
  const tackleFrom = isReturn && !td ? Math.max(landT, contactT - 1.2) : endSec
  const rate = (k: string) => m[k]?.player
  const rr = runReturnField({
    kind: 'punt',
    outcome: isReturn ? 'return' : kind === 'fairCatch' ? 'fairCatch' : kind === 'muff' ? 'muff' : 'downed',
    cov: cov.map((k) => m[k]),
    kicker: 'qb',
    blk: blk.map((k) => m[k]),
    returner: m.s0,
    dir: -1,
    kickT,
    catchT: landT,
    catchPt: landPt,
    spot: isReturn ? spot : landPt,
    contactT,
    endT: endSec,
    tackleFrom,
    tackler: designated,
    gunners,
    jammers,
    rushers,
    protectors,
    seed,
    rec: (a, b, t0, t1, k) => recEng(a, b, t0, t1, k),
    blockOf: (k) => blockOf(rate(k), false),
    shedOf: (k) => bestAttr(rate(k), ['BSH', 'STR']),
  })

  const ball: WP[] = [
    { t: 0, x: los, y: MID_Y },
    { t: SNAP, x: los, y: MID_Y },
    { t: snapArr, ...posAt(m.qb.path, snapArr) },
    ...shadow(m.qb.path, snapArr, kickT).slice(1),
    { t: landT, x: landPt.x, y: landPt.y },
  ]
  const baseHolders = [{ t: 0, key: null }, { t: SNAP, key: null }, { t: snapArr, key: 'qb' }, { t: kickT, key: null }]
  // One flight, the punt itself (the director / replay read flights[0] as the kick; the long snap rides low on the ball path).
  const flights = [{ t0: kickT, t1: landT, height: 1 }]

  if (!isReturn) {
    const downKey = closestKey(m, covNoP, landPt, landT)
    if (kind === 'downed') {
      // The nearest cover man gets to the ball and downs it.
      seek(m[downKey], Math.max(kickT, landT - 0.5))
      glideTo(m[downKey], { x: clampX(landPt.x + 0.5), y: landPt.y }, 0.9, 0.8)
    }
    capAll(m, ALL_KEYS(f), endSec)
    if (kind === 'muff') {
      const loose = { x: clampX(landPt.x + (hash(seed + 4) - 0.5) * 6), y: clampY(landPt.y + (hash(seed + 5) - 0.5) * 6) }
      ball.push({ t: landT + 0.25, x: loose.x, y: loose.y }, { t: landT + 0.45, x: loose.x, y: loose.y })
      recEv(landT, 'fumble', ['s0'], landPt)
      if (play.turnover) recEv(landT + 0.02, 'turnover', [downKey], landPt)
      recEv(landT + 0.45, 'down', ['s0'], landPt)
    } else if (kind === 'fairCatch') {
      recEv(landT, 'fairCatch', ['s0'], landPt)
    } else {
      recEv(Math.min(endSec, landT + 0.4), 'down', [downKey], landPt)
    }
    return finish(f, m, {
      ball,
      holders: kind === 'fairCatch' ? [...baseHolders, { t: landT, key: 's0' }] : baseHolders,
      flights,
    })
  }

  const free = covNoP.filter((k) => !rr.stillEngaged.has(k))
  const tackler = td ? closestKey(m, free.length ? free : covNoP, spot, endSec) : chooseTackler(m, free.length ? free : covNoP, designated, cPt, tackleFrom, contactT - tackleFrom)
  if (!td) hitAndRide(m[tackler], m.s0, tackleFrom, contactT, endSec)
  capAll(m, ALL_KEYS(f), endSec)
  ball.push(...shadow(m.s0.path, landT).slice(1))
  recEv(landT, 'catch', ['s0', tackler], landPt)
  recClose(m, 's0', tackler, endSec, cov, { td, tdX: 10, tdDir: -1, outOfBounds: !!play.outOfBounds, from: landT })
  return finish(f, m, { ball, holders: [...baseHolders, { t: landT, key: 's0' }], flights })
}

function buildKickoff(play: Play, ctx: AnimContext): PlayAnim {
  const touchback = play.result === 'Touchback' || play.returnKind === 'touchback'
  if (touchback) return buildKickoffLegacy(play, ctx)
  recStart()
  // The receiving club is the offense; the kick comes from their own end back.
  const f = formation(10 + play.startYard)
  const m = startMovers(f, ctx)
  const kickX = 75
  const endX = clampX(10 + play.endYard)
  const td = !!play.returnTD
  const fumble = !td && !!play.turnover
  const retYds = Math.max(0, play.returnYards ?? 0)
  const seed = play.n * 29 + play.startYard
  const side = hash(seed) < 0.5 ? -1 : 1
  const catchX = clampX(endX - retYds)
  const catchY = clampY(MID_Y + (hash(seed + 4) - 0.5) * 8)
  const seamY = clampY(catchY + side * (4 + hash(seed + 1) * 9))
  const catchPt: Pt = { x: catchX, y: catchY }
  const spot: Pt = { x: endX, y: seamY }
  const { scheme } = returnScheme(catchPt, spot)

  // Alignment: eleven cover men across the kicking line (the kicker in the
  // middle, a run-up behind the ball); the return unit's front five on the
  // restraining line, three in the middle, two backs ahead of the returner.
  const covKeys = DEF_KEYS
  const kicker = 's1'
  const front = ['ol0', 'ol1', 'ol2', 'ol3', 'ol4']
  const middle = ['te', 'qb', 'wr1']
  const backs = ['wr0', 'wr2']
  const blkKeys = [...front, ...middle, ...backs]
  covKeys.filter((k) => k !== kicker).forEach((k, i) => m[k].reset(clampX(kickX + 1 + (i % 2) * 0.6), clampY(MID_Y - 19.8 + i * 4.4)))
  m[kicker].reset(clampX(kickX + 6), MID_Y)
  front.forEach((k, i) => m[k].reset(clampX(kickX - 11 - (i % 2) * 1.5), clampY(MID_Y + (i - 2) * 9)))
  const midX = clampN(catchX + 30, 34, kickX - 20)
  middle.forEach((k, i) => m[k].reset(clampX(midX), clampY(MID_Y + (i - 1) * 9)))
  backs.forEach((k, i) => m[k].reset(clampX(catchX + 12), clampY(catchY + (i ? 5 : -5))))

  // The hang (~4 s on a deep kick); the returner settles under it.
  const kickDist = Math.max(10, kickX - catchX)
  let catchT = clampN(1.2 + kickDist * 0.04, 2.4, 4.3)
  const kStart = clampN(m.rb.pace.top * Math.max(0.4, catchT - 0.6) * 0.5, 3, 12)
  m.rb.reset(clampX(catchX - kStart), clampY(catchY - side * 1.5))
  catchT = Math.max(catchT, straightTime(m.rb.pace, Math.hypot(catchPt.x - m.rb.x, catchPt.y - m.rb.y), 0) + 0.15)
  // A short return needs the coverage there: a longer hang (to 4.4 s), then a patient return.
  const line = returnLine(catchPt, spot, 1, scheme)
  const total = polyLen(catchPt, line)
  const ac = td ? 0 : clampN(yardsAfterContact(m.rb.player, total, seed) * 0.7, 0.4, 1.6)
  const cGuess = splitPolyline(catchPt, line, Math.max(0, total - ac)).c
  const need = coverNeed(m, covKeys.filter((k) => k !== kicker), cGuess)
  const retNat = timedLine([catchPt, cGuess], returnPace(m.rb), { v0: 0, stop: false }).slice(-1)[0]?.t ?? 0
  if (!td && catchT + retNat < need) catchT = Math.min(4.4, Math.max(catchT, need - retNat))
  // animflow r6a: he gathers and catches it moving forward (BDB 2022 kickoff
  // returners n 1.8k: 4.4 yd/s 0.5 s after the catch, 6.2 at 1 s).
  // Step in along the line he will return on (no plant at the catch).
  const l0 = line.find((q) => Math.hypot(q.x - catchPt.x, q.y - catchPt.y) > 0.5) ?? { x: catchPt.x + 1, y: catchPt.y }
  const ul = Math.hypot(l0.x - catchPt.x, l0.y - catchPt.y) || 1
  runTimed(m.rb, [{ x: clampX(catchPt.x - ((l0.x - catchPt.x) / ul) * 2.4), y: clampY(catchPt.y - ((l0.y - catchPt.y) / ul) * 2.4) }], 0, Math.max(0.3, catchT - 0.85), false, true)
  if (m.rb.t < catchT - 0.85) m.rb.hold(catchT - 0.85 - m.rb.t)
  m.rb.run([{ x: catchPt.x, y: catchPt.y }], { v0: 0, stop: false })
  if (m.rb.t < catchT) m.rb.hold(catchT - m.rb.t)
  recEv(0, 'kick', [kicker], { x: kickX, y: MID_Y })
  const r = scriptReturn(m.rb, catchPt, spot, 1, scheme, need, td, seed)
  const contactT = r.contactT
  const endSec = r.endSec
  const cPt = r.c

  const designated = td ? undefined : closestKey(m, covKeys.filter((k) => k !== kicker), cPt, 0)
  const tackleFrom = td ? endSec : Math.max(catchT, contactT - 1.2)
  const rate = (k: string) => m[k]?.player
  const rr = runReturnField({
    kind: 'kickoff',
    outcome: 'return',
    cov: covKeys.map((k) => m[k]),
    kicker,
    blk: blkKeys.map((k) => m[k]),
    returner: m.rb,
    dir: 1,
    kickT: 0,
    catchT,
    catchPt,
    spot,
    contactT,
    endT: endSec,
    tackleFrom,
    tackler: designated,
    front,
    middle,
    backs,
    seed,
    rec: (a, b, t0, t1, k) => recEng(a, b, t0, t1, k),
    blockOf: (k) => blockOf(rate(k), false),
    shedOf: (k) => bestAttr(rate(k), ['BSH', 'STR']),
  })
  const cand = covKeys.filter((k) => k !== kicker && !rr.stillEngaged.has(k))
  const tackler = td ? closestKey(m, covKeys, spot, endSec) : chooseTackler(m, cand.length ? cand : covKeys, designated, cPt, tackleFrom, contactT - tackleFrom)

  const ball: WP[] = [{ t: 0, x: kickX, y: MID_Y }, { t: catchT, x: catchPt.x, y: catchPt.y }]
  if (fumble) {
    // The ball squirts loose beside the returner and a coverage man recovers it.
    const popT = Math.max(catchT + 0.2, catchT + (endSec - catchT) * 0.72)
    const rbPos = posAt(m.rb.path, popT)
    const loose = { x: clampX(rbPos.x + 1.2 + (hash(seed + 6) - 0.5) * 3), y: clampY(rbPos.y + (hash(seed + 6) - 0.5) * 4) }
    const rec = closestKey(m, covKeys, loose, popT)
    const rv = seek(m[rec], popT)
    m[rec].run([{ x: loose.x, y: loose.y }], { v0: rv, stop: true })
    const recT = m[rec].t
    seek(m.rb, popT)
    m.rb.hold(0.4)
    capAll(m, ALL_KEYS(f).filter((k) => k !== rec && k !== 'rb'), Math.max(recT, popT + 0.4))
    ball.push(
      ...shadow(m.rb.path, catchT, popT).slice(1),
      { t: popT + 0.12, x: loose.x, y: loose.y },
      { t: Math.max(recT, popT + 0.2), x: loose.x, y: loose.y },
      ...shadow(m[rec].path, recT).slice(1),
    )
    recEv(catchT, 'catch', ['rb', rec], catchPt)
    recEv(popT, 'fumble', ['rb', rec], { x: loose.x, y: loose.y })
    recEv(popT + 0.02, 'turnover', [rec], { x: loose.x, y: loose.y })
    recEv(recT, 'down', [rec], { x: loose.x, y: loose.y })
    return finish(f, m, {
      ball,
      holders: [{ t: 0, key: null }, { t: catchT, key: 'rb' }, { t: popT, key: null }, { t: recT, key: rec }],
      flights: [{ t0: 0, t1: catchT, height: 1 }],
    })
  }
  if (!td) hitAndRide(m[tackler], m.rb, tackleFrom, contactT, endSec)
  capAll(m, ALL_KEYS(f), endSec)
  ball.push(...shadow(m.rb.path, catchT).slice(1))
  recEv(catchT, 'catch', ['rb', tackler], catchPt)
  recClose(m, 'rb', tackler, endSec, DEF_KEYS, { td, tdX: 110, tdDir: 1, outOfBounds: !!play.outOfBounds, from: catchT })
  return finish(f, m, {
    ball,
    holders: [{ t: 0, key: null }, { t: catchT, key: 'rb' }],
    flights: [{ t0: 0, t1: catchT, height: 1 }],
  })
}

function buildPenalty(play: Play, ctx: AnimContext): PlayAnim {
  recStart()
  const los = 10 + play.startYard
  const f = formation(los)
  const m = startMovers(f, ctx)
  for (const k of OFF_KEYS) m[k].run([{ x: f[k].x + 0.6, y: f[k].y }], { stop: true })
  for (const k of DEF_KEYS) m[k].run([{ x: f[k].x - 0.4, y: f[k].y }], { stop: true })
  const ball: WP[] = [{ t: 0, x: los, y: MID_Y }, { t: 0.4, x: los, y: MID_Y }, { t: 1.2, x: 10 + play.endYard, y: MID_Y }]
  const flagX = los + (play.yards > 0 ? 2 : -2)
  const flagY = MID_Y + 3
  const flagKey = keyOf(ctx, play.penaltyPlayerId, ALL_KEYS(f)) ?? nearestKey(m, ALL_KEYS(f), { x: flagX, y: flagY }, 0.3)
  recEv(0.3, 'flag', [flagKey], { x: flagX, y: flagY })
  if (!PRE_SNAP_PENALTY.has(play.penaltyKind ?? '')) recSnap(los)
  recEv(1.2, 'down', [flagKey], { x: 10 + play.endYard, y: MID_Y })
  return finish(f, m, {
    ball,
    holders: [{ t: 0, key: null }],
    flights: [],
    flag: { t: 0.3, x: los + (play.yards > 0 ? 2 : -2), y: MID_Y + 3 },
  })
}

/**
 * animflow r6d (J6): the victory formation. QB under centre with two up-backs at his hips and a back
 * eight yards deep as the safety valve, the tight end and wideouts in tight; the defence does not
 * rush. The QB takes the snap, gives ground to the recorded spot and goes down on a knee.
 */
function buildKneel(play: Play, ctx: AnimContext): PlayAnim {
  recStart()
  const los = 10 + play.startYard
  const f = formation(los, false, 'under')
  const spots: Record<string, Pt> = {
    rb: { x: los - 8, y: MID_Y },
    wr2: { x: los - 2.3, y: MID_Y - 1.7 },
    wr1: { x: los - 2.3, y: MID_Y + 1.7 },
    wr0: { x: los - 0.8, y: MID_Y - 5.6 },
    te: { x: los - 0.8, y: MID_Y + 4.4 },
  }
  for (const [k, pt] of Object.entries(spots)) if (f[k]) f[k] = { ...f[k], x: pt.x, y: clampY(pt.y) }
  // The defence comes up tight but does not rush (no one is going to be hit on a kneel).
  for (const k of ['lb0', 'lb1', 'lb2']) f[k] = { ...f[k], x: los + 4 }
  for (const k of ['cb0', 'cb1']) f[k] = { ...f[k], x: los + 3, y: clampY(MID_Y + (f[k].y < MID_Y ? -9 : 9)) }
  for (const k of ['s0', 's1']) f[k] = { ...f[k], x: los + 9, y: clampY(MID_Y + (f[k].y < MID_Y ? -5 : 5)) }
  const m = startMovers(f, ctx)
  recSnap(los)
  const endX = clampX(10 + play.endYard)
  // Snap, a step and a half back, down on the knee.
  m.qb.hold(SNAP)
  runTimed(m.qb, [{ x: endX, y: MID_Y }], SNAP, SNAP + 0.55, false, true)
  const downT = m.qb.t
  m.qb.hold(1.6)
  const endSec = m.qb.t
  // The line fires out a step and stands up; the up-backs square up; everyone else drifts in.
  for (const k of ['ol0', 'ol1', 'ol2', 'ol3', 'ol4']) { m[k].hold(SNAP); runTimed(m[k], [{ x: f[k].x - 0.5, y: f[k].y }], SNAP, SNAP + 0.5, false, true) }
  for (const k of ['dl0', 'dl1', 'dl2', 'dl3']) { m[k].hold(SNAP + 0.05); runTimed(m[k], [{ x: los + 0.4, y: f[k].y }], SNAP + 0.05, SNAP + 0.6, false, true) }
  for (const k of ['lb0', 'lb1', 'lb2', 'cb0', 'cb1', 's0', 's1']) { m[k].hold(SNAP + 0.3); runTimed(m[k], [{ x: f[k].x - 1.2, y: f[k].y + (MID_Y - f[k].y) * 0.08 }], SNAP + 0.3, SNAP + 1.3, false, true) }
  for (const k of ['wr0', 'wr1', 'wr2', 'te', 'rb']) if (m[k]) { m[k].hold(SNAP + 0.1); runTimed(m[k], [{ x: f[k].x + 0.3, y: f[k].y }], SNAP + 0.1, SNAP + 0.6, false, true) }
  for (const k of ALL_KEYS(f)) if (m[k].t < endSec) m[k].hold(endSec - m[k].t)
  recEv(downT, 'down', ['qb'], { x: endX, y: MID_Y })
  return finish(f, m, { ball: snapBall(m, los, endSec), holders: [{ t: 0, key: null }, { t: SNAP, key: 'qb' }], flights: [] })
}

/**
 * animflow r6d (J6): the spike. QB under centre, takes the snap and throws the ball straight into the
 * turf a yard in front of him; the line pops up, receivers take a couple of steps and stop.
 */
function buildSpike(play: Play, ctx: AnimContext): PlayAnim {
  recStart()
  const los = 10 + play.startYard
  const f = formation(los, false, 'under')
  const m = startMovers(f, ctx)
  recSnap(los)
  m.qb.hold(SNAP)
  runTimed(m.qb, [{ x: f.qb.x - 0.6, y: MID_Y }], SNAP, SNAP + 0.3, false, true)
  const rel = m.qb.t + 0.05
  m.qb.hold(rel - m.qb.t)
  const land = rel + 0.18
  const spot: Pt = { x: f.qb.x + 0.8, y: MID_Y + 0.4 }
  m.qb.hold(1.4)
  const endSec = m.qb.t
  for (const k of ['ol0', 'ol1', 'ol2', 'ol3', 'ol4']) { m[k].hold(SNAP); runTimed(m[k], [{ x: f[k].x - 0.8, y: f[k].y }], SNAP, SNAP + 0.45, false, true) }
  for (const k of ['dl0', 'dl1', 'dl2', 'dl3']) { m[k].hold(SNAP + 0.05); runTimed(m[k], [{ x: los - 0.2, y: f[k].y }], SNAP + 0.05, SNAP + 0.6, false, true) }
  for (const k of ['wr0', 'wr1', 'wr2', 'te', 'rb']) if (m[k]) { m[k].hold(SNAP); runTimed(m[k], [{ x: f[k].x + (k === 'rb' ? 0.8 : 3), y: f[k].y }], SNAP, SNAP + 0.9, false, true) }
  for (const k of ['lb0', 'lb1', 'lb2', 'cb0', 'cb1', 's0', 's1']) { m[k].hold(SNAP + 0.15); runTimed(m[k], [{ x: f[k].x - 0.8, y: f[k].y }], SNAP + 0.15, SNAP + 0.8, false, true) }
  for (const k of ALL_KEYS(f)) if (m[k].t < endSec) m[k].hold(endSec - m[k].t)
  const ball: WP[] = [...snapBall(m, los, rel), { t: land, x: spot.x, y: spot.y }, { t: endSec, x: spot.x + 0.6, y: spot.y }]
  recEv(rel, 'throw', ['qb'], posAt(m.qb.path, rel))
  recEv(land, 'incomplete', [], spot)
  return finish(f, m, { ball, holders: [{ t: 0, key: null }, { t: SNAP, key: 'qb' }, { t: rel, key: null }], flights: [{ t0: rel, t1: land, height: 0.2 }] })
}

function buildStatic(play: Play, ctx: AnimContext): PlayAnim {
  recStart()
  const los = 10 + play.startYard
  const f = formation(los)
  const m = startMovers(f, ctx)
  for (const k of OFF_KEYS) m[k].hold(0.3)
  for (const k of DEF_KEYS) m[k].hold(0.3)
  const ball: WP[] = [{ t: 0, x: los, y: MID_Y }]
  recEv(0.3, 'down', [], { x: los, y: MID_Y })
  return finish(f, m, { ball, holders: [{ t: 0, key: null }], flights: [] })
}

/**
 * The rating driving what an actor is doing this play, for the freeze "why"
 * tooltip (L12.10 B5). Falls back to a plain role description.
 */
export function actorWhy(play: Play, key: string, p: Player | undefined): string {
  const a = (k: string, label: string) => `${label} ${Math.round(attrOf(p, k))}`
  const isCarrier = (play.type === 'run' && (key === 'rb' || key === 'qb')) || play.targetId === p?.id
  if (isCarrier) {
    if (play.type === 'run') return `Carry — ${a('SPD', 'SPD')}, ${a('ACC', 'ACC')} · moves ${a('JKM', 'JKM')}/${a('TRK', 'TRK')}`
    return `Catch & run — ${a('CTH', 'CTH')}, ${a('SPC', 'SPC')} · ${a('SPD', 'SPD')}`
  }
  switch (key) {
    case 'qb':
      return play.type === 'pass' ? `Throw — ${a('THP', 'THP')}, ${a('SAC', 'SAC')}/${a('DAC', 'DAC')}` : `Pocket — ${a('AWR', 'AWR')}`
    case 'wr0':
    case 'wr1':
    case 'wr2':
      return `Route — ${a('SRR', 'SRR')}/${a('MRR', 'MRR')}/${a('DRR', 'DRR')}, release ${a('RLS', 'RLS')}`
    case 'te':
      return `Route / block — ${a('RBK', 'RBK')}, ${a('CTH', 'CTH')}`
    case 'fb':
      return `Lead block — ${a('RBK', 'RBK')}, ${a('IBL', 'IBL')}`
    case 'rb':
      return `Back — ${a('JKM', 'JKM')}, ${a('TRK', 'TRK')}, ${a('SFA', 'SFA')}`
    default:
      if (key.startsWith('ol')) return `Pass block — ${a('PBK', 'PBK')}, ${a('STR', 'STR')}`
      if (key.startsWith('dl')) return `Rush — ${a('PMV', 'PMV')}/${a('FMV', 'FMV')}, ${a('BSH', 'BSH')}`
      if (key.startsWith('lb')) return `Pursuit — ${a('PUR', 'PUR')}, ${a('TAK', 'TAK')}`
      if (key.startsWith('cb')) return `Coverage — ${a('MCV', 'MCV')}, ${a('SPD', 'SPD')}`
      if (key.startsWith('s')) return `Pursuit — ${a('PUR', 'PUR')}, ${a('TAK', 'TAK')}`
      return 'League average'
  }
}

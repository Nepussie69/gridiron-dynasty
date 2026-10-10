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
// Coordinates are in the offense's frame: its own goal line at x = 10, attacking
// toward x = 110; y runs 0..53.3 across the field. MatchView mirrors the frame
// when the away club has the ball.
// ─────────────────────────────────────────────────────────────────────────────

import type { Play } from '../game/engine/playsim'
import type { Player } from '../game/types'
import { ROUTES, type RouteDef, type WP } from '../game/data/routes'
import { formationForConcept, formationHasFullback, playbookPlay, treeFor } from '../game/data/playbookData'

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
}

// ── helpers ──────────────────────────────────────────────────────────────────
function hash(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const clampY = (y: number) => clampN(y, 1.2, FIELD_H - 1.2)
const clampX = (x: number) => clampN(x, 1, FIELD_W - 1)
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
  for (const f of anim.flights) {
    if (t > f.t0 && t < f.t1) return Math.sin(Math.PI * ((t - f.t0) / (f.t1 - f.t0))) * f.height
  }
  return 0
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
  const v = p.attrs?.[key]
  if (typeof v === 'number') return v
  return typeof p.ovr === 'number' ? p.ovr : fallback
}

export interface Pace {
  /** Top speed in yards per second. */
  top: number
  /** Acceleration in yards per second squared. */
  acc: number
}

const ROLE_CAP: Record<string, number> = {
  OL: 6.4, K: 6.6, P: 6.6, QB: 9.0, RB: 9.3, FB: 7.6,
  WR: 9.6, TE: 8.4, DL: 8.2, LB: 8.6, CB: 9.4, S: 9.2,
}

/**
 * Top speed from SPD (`5.6 + (SPD − 60) × 0.085`: 99 ≈ 8.9, 70 ≈ 6.5) and
 * acceleration from ACC (0.45 s to top at 99 … 1.1 s at 60).
 */
export function paceFor(p: Player | undefined, role = ''): Pace {
  const spd = attrOf(p, 'SPD')
  const acc = attrOf(p, 'ACC')
  const cap = ROLE_CAP[role] ?? 9.6
  const top = clampN(5.6 + (spd - 60) * 0.085, 3.4, cap)
  const ramp = clampN(1.1 - (acc - 60) * (0.65 / 39), 0.45, 1.1)
  return { top, acc: top / ramp }
}

/** Speed-profiled, distance-timed motion along a polyline (times in seconds). */
function baseLine(pts: Pt[], pace: Pace, opts: { v0?: number; stop?: boolean } = {}) {
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
  const speedAt = (s: number) => {
    const a = Math.min(pace.top, Math.sqrt(v0 * v0 + 2 * acc * Math.max(0, s)))
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

/**
 * Time a polyline at a player's pace, slowing into any sharp change of direction
 * (a route cut, a plant) so the speed never jumps — a real player can't reverse
 * at full speed. Each corner is crossed at a near-stop, then re-accelerated.
 */
function timedLine(pts: Pt[], pace: Pace, opts: { v0?: number; stop?: boolean } = {}) {
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
    const k = baseLine(pts.slice(start, c + 1), pace, { v0, stop: true })
    for (let i = out.length ? 1 : 0; i < k.length; i++) out.push({ t: t0 + k[i].t, x: k[i].x, y: k[i].y })
    t0 += k[k.length - 1].t
    start = c
    v0 = 0
  }
  const k = baseLine(pts.slice(start), pace, { v0, stop: opts.stop })
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
  run(pts: Pt[], opts: { v0?: number; stop?: boolean } = {}): number {
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
    if (v0 > 1 && this.path.length >= 2) {
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

function formation(los: number, fb = false): Formation {
  const f: Formation = {}
  ;[-2.6, -1.3, 0, 1.3, 2.6].forEach((d, i) => (f[`ol${i}`] = { x: los - 0.6, y: MID_Y + d, side: 'off', role: 'OL' }))
  f.qb = { x: los - 5, y: MID_Y, side: 'off', role: 'QB' }
  f.rb = { x: los - 7, y: MID_Y + 2.5, side: 'off', role: 'RB' }
  if (fb) f.fb = { x: los - 8.5, y: MID_Y + 0.8, side: 'off', role: 'FB' }
  f.wr0 = { x: los - 0.6, y: 5, side: 'off', role: 'WR' }
  f.wr1 = { x: los - 0.6, y: 48.3, side: 'off', role: 'WR' }
  f.wr2 = { x: los - 1.2, y: 13, side: 'off', role: 'SLOT' }
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
const ALL_KEYS = (f: Formation) => [...OFF_KEYS, ...(f.fb ? ['fb'] : []), ...DEF_KEYS]

function startMovers(f: Formation, ctx: AnimContext): Record<string, Mover> {
  const out: Record<string, Mover> = {}
  for (const [k, v] of Object.entries(f)) {
    out[k] = new Mover(k, v.role, paceFor(ctx.actors?.get(k), v.role), v.x, v.y, ctx.actors?.get(k))
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
    posts: rest.posts,
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

/** Run `mv` to `to` so he arrives exactly at `arriveSec`, then wait there. */
function arriveAt(mv: Mover, to: Pt, arriveSec: number, minBow = 0) {
  const dur = Math.max(0.06, arriveSec - mv.t)
  const from = { x: mv.x, y: mv.y }
  const straight = straightTime(mv.pace, Math.hypot(to.x - from.x, to.y - from.y), 0)
  // Too much time to fill with a bow would draw a silly arc; run straight then
  // wait instead. Otherwise the bow absorbs the slack without a speed jump.
  const path = straight < dur * 0.7 ? [{ x: to.x, y: to.y }] : routeByTime(from, to, mv.pace, 0, dur, minBow)
  mv.run(path, { v0: carrySpeed(mv), stop: true })
  if (mv.t < arriveSec) mv.hold(arriveSec - mv.t)
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
    // never pops from full speed straight to a frozen stop.
    const v = speedAtTime(mv.path, t)
    const brake = v > 0.8 ? v / Math.max(0.5, mv.pace.acc) : 0
    if (brake > 0.03) {
      const tStart = Math.max(mv.path[0].t, t - brake)
      const vStart = speedAtTime(mv.path, tStart)
      const pStart = posAt(mv.path, tStart)
      const pEnd = posAt(mv.path, t)
      mv.path = mv.path.filter((w) => w.t <= tStart)
      mv.t = tStart
      mv.x = pStart.x
      mv.y = pStart.y
      mv.lastStop = false
      mv.run([{ x: pEnd.x, y: pEnd.y }], { v0: vStart, stop: true })
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
 * Apply a block plan: both men run to their meeting point and wait there, so
 * they are provably co-located for a beat (a real, timed engagement with a
 * near-zero relative speed), then the blocker releases a step and the freed
 * defender resumes pursuit along the returner's line.
 */
function applyBlockEngagements(
  m: Record<string, Mover>,
  plan: BlockPlan[],
  returner: Mover,
  total: number,
  seed: number,
): void {
  for (const { b, c, p, te, off } of plan) {
    const tt = Math.min(te, total - 0.35)
    arriveAt(m[b], p, tt)
    arriveAt(m[c], p, tt)
    const engage = Math.min(Math.max(m[b].t, m[c].t) + 0.4, total - 0.12)
    if (m[b].t < engage) m[b].hold(engage - m[b].t)
    if (m[c].t < engage) m[c].hold(engage - m[c].t)
    m[b].run([{ x: clampX(p.x + (seed % 2 ? 1.0 : -1.0)), y: clampY(p.y + off * 0.15) }], { stop: true })
    if (m[b].t < total - 0.02) m[b].hold(total - 0.02 - m[b].t)
    const follow: Pt[] = []
    const steps = 5
    const from = m[c].t
    for (let j = 1; j <= steps; j++) {
      const tt2 = from + Math.max(0.01, total - from) * (j / steps)
      const rp = posAt(returner.path, Math.min(tt2, total))
      follow.push({ x: clampX(rp.x + off * 0.6), y: clampY(rp.y + off * 0.9) })
    }
    m[c].run(follow, { v0: carrySpeed(m[c]), stop: true })
    capAt(m[c], total)
  }
}

// ── plays ────────────────────────────────────────────────────────────────────
export function buildPlayAnim(play: Play, ctx: AnimContext = {}): PlayAnim {
  switch (play.type) {
    case 'run':
      return buildRun(play, ctx)
    case 'pass':
      return play.result.startsWith('Sack') ? buildSack(play, ctx) : buildPass(play, ctx)
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

/** Who wins at the line: line rating vs the defender in front of him. */
function lineDrive(off: Player | undefined, offKey: string, def: Player | undefined, defKey: string): number {
  const o = attrOf(off, offKey)
  const d = attrOf(def, defKey)
  return clampN((o - d) * 0.035, -1.1, 1.1)
}

function buildRun(play: Play, ctx: AnimContext): PlayAnim {
  const los = 10 + play.startYard
  const f = formation(los, formationHasFullback(formationForConcept(play.concept)))
  const m = startMovers(f, ctx)
  const seed = play.n * 7 + play.startYard
  const qbRun = !!ctx.carrierIsQB || /QB Draw|Scramble|Sneak/.test(play.concept)
  const wide = /Outside|Toss|Sweep|Stretch|Pitch|Bubble/.test(play.concept)
  const side = hash(seed) < 0.5 ? -1 : 1
  const holeY = MID_Y + side * (wide ? 11 + hash(seed + 1) * 4 : 1.5 + hash(seed + 1) * 3.5)
  const endX = clampX(10 + play.endYard)
  const fumble = !!play.turnover
  // T2M: a run that went out of bounds finishes against the sideline, not in the
  // middle of the field. The end spot (x) is unchanged.
  const endY = play.outOfBounds
    ? (side < 0 ? 1.6 : FIELD_H - 1.6)
    : clampY(holeY + (hash(seed + 2) - 0.5) * (Math.abs(play.yards) > 12 ? 18 : 7))
  const carrier = qbRun ? 'qb' : 'rb'
  const holeX = los - (play.yards < 0 ? 0.5 : -0.4)
  const meshX = qbRun ? f.qb.x - 1 : f.qb.x + 0.7
  const meshY = qbRun ? MID_Y : MID_Y + side * 1.4

  // The run after the hole: the same curve as before, sampled for a speed profile.
  const bow = side * (0.5 + hash(seed + 4) * 2.5)
  const ctrl = { x: (holeX + endX) / 2 - (endY - holeY) * 0.08, y: (holeY + endY) / 2 + bow * 2 }
  const curve: Pt[] = []
  const SAMPLES = 24
  for (let i = 0; i <= SAMPLES; i++) {
    const u = i / SAMPLES
    curve.push({
      x: clampX((1 - u) * (1 - u) * holeX + 2 * (1 - u) * u * ctrl.x + u * u * endX),
      y: clampY((1 - u) * (1 - u) * holeY + 2 * (1 - u) * u * ctrl.y + u * u * endY),
    })
  }


  // R5: a broken tackle adds a brief stumble while preserving timed motion.
  if ((play.missedTackleIds?.length ?? 0) > 0) {
    for (let i = 0; i < curve.length; i++) {
      const u = i / (curve.length - 1)
      if (u > 0.6 && u < 0.82) curve[i].y = clampY(curve[i].y + side * 2.2 * Math.sin(((u - 0.6) / 0.22) * Math.PI))
    }
  }

  // Line: run blockers drive forward by RBK/IBL vs the defender's BSH/strength.
  for (let i = 0; i < 5; i++) {
    const dlKey = i < 2 ? `dl${i}` : i < 4 ? `dl${i - 1}` : 'dl3'
    const drive = lineDrive(m[`ol${i}`].player, 'RBK', m[dlKey].player, 'BSH')
    m[`ol${i}`].run([{ x: los + 0.9 + drive + (wide ? 0.3 : 0), y: f[`ol${i}`].y + side * (wide ? 1.5 : 0.4) }], { stop: false })
  }
  for (let i = 0; i < 4; i++) {
    const drive = lineDrive(m[`dl${i}`].player, 'BSH', m[`ol${Math.min(4, i)}`].player, 'RBK')
    m[`dl${i}`].run([{ x: los + 0.7 - drive, y: f[`dl${i}`].y + side * 0.6 }], { stop: false })
  }
  ;['wr0', 'wr1', 'wr2', 'te'].forEach((k, i) => m[k].run([{ x: f[k].x + 4 + i, y: f[k].y + (MID_Y - f[k].y) * 0.15 }], { stop: true }))
  if (m.fb) m.fb.run([{ x: los - 1, y: MID_Y + (holeY - MID_Y) * 0.6 }, { x: los + 1.5, y: holeY + side * 1.2 }], { stop: true })

  let handoffT = 0
  if (qbRun) {
    m.rb.run([{ x: los - 1, y: MID_Y - side * 5 }], { stop: true })
  } else {
    const meshPt = { x: meshX, y: meshY }
    m.qb.run([meshPt], { stop: true })
    const qbT = m.qb.t
    m.rb.run([meshPt], { stop: true })
    handoffT = Math.max(qbT, m.rb.t)
    m.qb.hold(handoffT - m.qb.t)
    m.qb.run([{ x: f.qb.x - 1.5, y: MID_Y - side * 4 }], { stop: true })
  }
  if (qbRun) {
    m.qb.run([{ x: holeX, y: holeY }], { stop: false })
  } else {
    m.rb.hold(Math.max(0, handoffT - m.rb.t))
    m.rb.run([{ x: holeX, y: holeY }], { stop: false })
  }
  const holeT = m[carrier].t
  const holeSpeed = m[carrier].pace.top * 0.7
  // Run the main curve up to just before the recorded stop; the contact itself
  // is resolved below so the carrier keeps moving into the tackle (backlog 150).
  // A fumble is a loose ball at the recorded spot, so there the carrier runs the
  // full curve and truly reaches that spot before the ball comes out.
  m[carrier].run(fumble ? curve.slice(1) : curve.slice(1, curve.length - 1), { v0: holeSpeed, stop: fumble })
  const endSec = m[carrier].t

  // Linebackers fill, safeties come down, corners squeeze; then everyone pursues.
  for (let i = 0; i < 3; i++) m[`lb${i}`].run([{ x: los + 3, y: f[`lb${i}`].y + (holeY - f[`lb${i}`].y) * 0.6 }], { stop: false })
  ;['s0', 's1'].forEach((k) => m[k].run([{ x: f[k].x - 4, y: f[k].y + (holeY - f[k].y) * 0.3 }], { stop: false }))
  ;['cb0', 'cb1'].forEach((k) => m[k].run([{ x: f[k].x - 1, y: f[k].y + (holeY - f[k].y) * 0.1 }], { stop: false }))

  if (fumble) {
    const popT = Math.max(holeT + 0.1, endSec * 0.9)
    const spotX = changeSpot(play, ctx.next) ?? endX + 1
    const loose = { x: clampX(endX + 2), y: clampY(endY + (hash(seed + 5) - 0.5) * 6) }
    const recover = nearestKey(m, DEF_KEYS, loose, popT)
    m[recover].run([{ x: loose.x, y: loose.y }, { x: clampX(spotX), y: loose.y }], { v0: seek(m[recover], popT), stop: true })
    const recT = m[recover].t
    pursueRun(m, DEF_KEYS.filter((k) => k !== recover), popT, { x: endX, y: endY }, popT + 0.4, seed)
    const ball: WP[] = [
      ...(qbRun ? snapBall(m, los, popT) : [...snapBall(m, los, handoffT), ...shadow(m[carrier].path, handoffT, popT).slice(1)]),
      { t: popT, x: loose.x, y: loose.y },
      ...shadow(m[recover].path, popT).slice(1),
    ]
    return finish(f, m, {
      ball,
      holders: [
        { t: 0, key: null },
        { t: SNAP, key: 'qb' },
        ...(qbRun ? [] : [{ t: handoffT, key: carrier }]),
        { t: popT, key: null },
        { t: recT, key: recover },
      ],
      flights: [{ t0: popT, t1: Math.min(recT, popT + 0.5), height: 0.4 }],
    })
  }

  const credited = play.tackleIds?.[0]
  const creditedKey = credited ? DEF_KEYS.find((k) => ctx.actors?.get(k)?.id === credited) : undefined
  const res = resolveCarry({ m, carrierKey: carrier, spot: { x: endX, y: endY }, tacklerKeys: DEF_KEYS, prefer: creditedKey, seed })
  capAll(m, ALL_KEYS(f), res.endSec)
  const ball: WP[] = qbRun
    ? snapBall(m, los, res.endSec)
    : [...snapBall(m, los, handoffT), ...shadow(m[carrier].path, handoffT, res.endSec).slice(1)]
  return finish(f, m, {
    ball,
    holders: [
      { t: 0, key: null },
      { t: SNAP, key: 'qb' },
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

/** Route running by depth (L12.10 B5): SRR short, MRR intermediate, DRR deep. */
function routeRunRating(p: Player | undefined, depth: number): number {
  return attrOf(p, depth <= 5 ? 'SRR' : depth <= 12 ? 'MRR' : 'DRR')
}

/** Run a route: high route running = a crisp near-stop cut, low = a rounded drift. */
function runRoute(mv: Mover, pts: Pt[], breakIdx: number, rr: number) {
  const v0 = 0
  if (breakIdx <= 0 || breakIdx >= pts.length - 1) {
    mv.run(pts, { v0, stop: true })
    return
  }
  const crisp = rr >= 76
  mv.run(pts.slice(0, breakIdx + 1), { v0, stop: true })
  if (crisp) mv.hold(clampN(0.04 + (rr - 76) * 0.002, 0.04, 0.12))
  mv.run(pts.slice(breakIdx + 1), { v0: 0, stop: true })
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
function runTimed(mv: Mover, pts: Pt[], fromSec: number, toSec: number) {
  if (!pts.length) return
  const all = [{ x: mv.x, y: mv.y }, ...pts]
  const T = Math.max(0.05, toSec - fromSec)
  const saved = mv.pace
  let D = 0
  for (let i = 1; i < all.length; i++) D += Math.hypot(all[i].x - all[i - 1].x, all[i].y - all[i - 1].y)
  // Scale the pace so the move spans exactly the window: with v0=0 and both
  // speed and accel scaled by f, t(f) ≈ (v/acc)/2 + D/(v·f).
  const ta = saved.acc > 1e-6 ? saved.top / saved.acc : 0
  const f = clampN(D / Math.max(1e-6, saved.top * Math.max(0.05, T - ta / 2)), 0.03, 1)
  if (f < 1) mv.pace = { top: saved.top * f, acc: Math.max(0.05, saved.acc * f) }
  mv.run(pts, { v0: 0, stop: false })
  mv.pace = saved
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
 * A man defender running with a receiver: he aligns 1–7 yd off (press for a
 * good corner, off for a poor one), then mirrors the route with a short
 * reaction lag — in the hip pocket trailing behind on in-breaking routes, over
 * the top on verticals. `tightness` loosens the trail for a recorded big gain.
 */
function manTrail(
  def: Mover,
  recvKey: string,
  recv: Mover,
  opts: { fromSec: number; toSec: number; los: number; cov: number; inw: number; tightness: number; seed: number; routeName: string; zone?: boolean },
) {
  const { fromSec, toSec, los, cov, inw, tightness, seed } = opts
  const ri = routeInfo(opts.routeName)
  const lag = clampN(0.24 - (cov - 60) * 0.005, 0.05, 0.26) * (1 + tightness * 1.6)
  const cushBase = opts.zone ? 1.5 : 1
  // Underneath/quick routes are covered tight (press or off); only vertical
  // routes get a deep cushion. This keeps the defender close from the snap.
  const base = clampN(7 - (cov - 60) * 0.09, 1.5, 7) * cushBase * (0.55 + hash(seed + 5) * 0.45)
  const cushion = clampN(base * (ri.vert ? 1 : 0.55), 1, 7)
  const steps = 26
  const shape: Pt[] = []
  for (let i = 0; i <= steps; i++) {
    const u = i / steps
    const t = fromSec + (toSec - fromSec) * u
    // The reaction lag closes over the route so the defender arrives at the
    // catch point with the ball, not trailing the receiver's last step.
    const tp = ri.vert ? t + lag * (1 - u) : Math.max(0, t - lag * (1 - u))
    const rp = posAt(recv.path, tp)
    const perp = ri.vert ? 0 : ri.inBreak ? inw * 0.8 : -inw * 0.3
    // The cushion shrinks from alignment to the hip pocket over the route.
    shape.push({ x: clampX(rp.x + cushion * (1 - u)), y: clampY(rp.y + perp) })
  }
  // Align on the receiver he is covering (a cushion off him), not on the line:
  // a back or tight end who lines up behind the line would otherwise be left
  // "open" while his man starts ten yards downfield.
  keepLive(shape, fromSec, toSec)
  def.reset(shape[0].x, shape[0].y)
  runTimed(def, shape, fromSec, toSec)
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

/**
 * Backlog 150: bring a carry to a visible close. From where the carrier is now
 * he keeps moving at his ratings' pace (a cut/curl, never a freeze) and reaches
 * `spot` exactly when the chosen tackler does — the tackler arriving within his
 * own pace. The sim's credited tackler is used when he can plausibly get there,
 * otherwise the defender who can actually arrive first. Every other defender
 * keeps converging, and the play ends at the contact, so the ball carrier is
 * never left standing in the open while a defender jogs in.
 */
function resolveCarry(opts: {
  m: Record<string, Mover>
  carrierKey: string
  spot: Pt
  tacklerKeys: string[]
  prefer?: string
  seed: number
  maxExtra?: number
}): { tackler: string; endSec: number } {
  const { m, carrierKey, spot, tacklerKeys, prefer, seed } = opts
  const carrier = m[carrierKey]
  const fromSec = carrier.t
  const cPos = { x: carrier.x, y: carrier.y }
  const cV0 = carrySpeed(carrier)
  const cNat = straightTime(carrier.pace, Math.hypot(spot.x - cPos.x, spot.y - cPos.y), cV0)
  const cap = cNat + (opts.maxExtra ?? 1.6)
  const cand = tacklerKeys
    .map((k) => {
      const v0 = seek(m[k], fromSec)
      const p = posAt(m[k].path, fromSec)
      return { k, v0, nat: straightTime(m[k].pace, Math.hypot(spot.x - p.x, spot.y - p.y), v0) }
    })
    .sort((a, b) => a.nat - b.nat)
  let chosen = cand[0]
  if (prefer) {
    const pk = cand.find((c) => c.k === prefer)
    if (pk && pk.nat <= cap) chosen = pk
  }
  const target = Math.max(cNat, chosen.nat)
  carrier.run(routeByTime(cPos, spot, carrier.pace, cV0, Math.max(0.2, target), 0.8), { v0: cV0, stop: true })
  let endSec = Math.max(carrier.t, fromSec + target)
  // A bow that under-filled (a short carry, or a capped loop): keep him moving
  // with a small curl into the spot rather than letting him stand.
  if (carrier.t < endSec - 0.05) {
    const rem = endSec - carrier.t
    carrier.run(routeByTime({ x: carrier.x, y: carrier.y }, spot, carrier.pace, carrySpeed(carrier), rem, 1.6), { v0: carrySpeed(carrier), stop: true })
    endSec = Math.max(carrier.t, endSec)
  }
  const tk = m[chosen.k]
  tk.run(routeByTime({ x: tk.x, y: tk.y }, spot, tk.pace, chosen.v0, Math.max(0.06, endSec - fromSec), 0.5), { v0: chosen.v0, stop: true })
  if (tk.t > endSec + 0.02) {
    // The tackler's own plant added a beat: let the carrier carry on to meet him.
    const rem = tk.t - carrier.t
    if (rem > 0.03) carrier.run(routeByTime({ x: carrier.x, y: carrier.y }, spot, carrier.pace, carrySpeed(carrier), rem, 1.6), { v0: carrySpeed(carrier), stop: true })
    endSec = Math.max(endSec, tk.t, carrier.t)
  }
  endSec = Math.max(endSec, tk.t, carrier.t)
  if (tk.t < endSec) tk.hold(endSec - tk.t)
  chaseCarrier(m, tacklerKeys.filter((k) => k !== chosen.k), fromSec, carrier, endSec, seed)
  return { tackler: chosen.k, endSec }
}

function buildPass(play: Play, ctx: AnimContext): PlayAnim {
  const los = 10 + play.startYard
  const f = formation(los, formationHasFullback(formationForConcept(play.concept)))
  const m = startMovers(f, ctx)
  const seed = play.n * 11 + play.startYard
  const inc = play.result === 'Incomplete'
  const int = play.result.startsWith('Interception')
  // A completion is drawn as a throw no deeper than the gain allows (plus a
  // little run after the catch): a 1-yard completion is a flat or bubble, not
  // a 15-yard dig caught and run back to the line.
  const gainYds = play.endYard - play.startYard
  const simDepth = Math.max(-2, Math.min(45, play.passDepth ?? 8))
  const depth = inc || int ? simDepth : Math.min(simDepth, Math.max(1, gainYds + 3))
  const tgt = targetKey(play, ctx)
  const scramble = !!play.pressure
  const rollSide = hash(seed + 9) < 0.5 ? -1 : 1
  const concept = play.concept
  const boot = concept === 'Bootleg'
  const quick = depth <= 8
  const pa = /Play Action|PA Cross|RPO/.test(concept)
  const side = hash(seed + 3) < 0.5 ? -1 : 1

  // Pocket: OL anchors by PBK/STR, DL rushes by PMV/FMV/BSH, so the better unit wins.
  for (let i = 0; i < 5; i++) {
    const drive = lineDrive(m[`ol${i}`].player, 'PBK', m[`dl${Math.min(3, i)}`].player, 'PMV')
    m[`ol${i}`].run([{ x: los - 1.8 - drive, y: f[`ol${i}`].y + (i - 2) * 0.5 }], { stop: true })
  }
  for (let i = 0; i < 4; i++) {
    const pmv = Math.max(attrOf(m[`dl${i}`].player, 'PMV'), attrOf(m[`dl${i}`].player, 'FMV'))
    const pen = clampN((pmv - 70) * 0.03, -0.4, 1.0)
    m[`dl${i}`].run([{ x: los - 1.2 - pen + (i % 2), y: f[`dl${i}`].y + (MID_Y - f[`dl${i}`].y) * 0.3 }], { stop: true })
  }

  // Run fake (play-action / RPO / bootleg): QB and back mesh before the drop.
  const qbPts: Pt[] = []
  if (pa) qbPts.push({ x: f.qb.x + 0.5, y: MID_Y + side * 1.2 })
  if (boot) qbPts.push({ x: f.qb.x - 1.2, y: MID_Y - rollSide * 1.2 })
  const drop = depth >= 15 ? 4 : 2.2
  const rollMag = boot ? 9 : quick ? 3 : 6 + hash(seed + 2) * 3
  const rollY = clampY(MID_Y + (boot ? -rollSide : rollSide) * rollMag)
  qbPts.push({ x: f.qb.x - drop, y: MID_Y })
  if (scramble || boot) {
    qbPts.push({ x: f.qb.x - drop - 0.5 + (scramble ? 1.5 : 0), y: MID_Y + (rollY - MID_Y) * 0.15 }, { x: f.qb.x - drop + 1.5, y: rollY })
  }
  m.qb.run(qbPts, { stop: true })

  // Route tree; the target runs the route whose depth best matches the throw.
  const routeMap = conceptTree(concept, rollSide)
  const inwOf = (k: string) => (f[k].y < MID_Y ? 1 : -1)
  let pick = tgt
  let best = Math.abs((ROUTES[routeMap[tgt]]?.depth ?? 0) - depth)
  for (const k of Object.keys(routeMap)) {
    const d = Math.abs((ROUTES[routeMap[k]]?.depth ?? 0) - depth)
    if (d < best) {
      best = d
      pick = k
    }
  }
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

  const receivers = ['wr0', 'wr1', 'wr2', 'te', 'rb']
  let catchPt: Pt = { x: los, y: MID_Y }
  let catchSec = 0.4
  for (const k of receivers) {
    const def = ROUTES[routeMap[k]] ?? ROUTES.check
    const inw = inwOf(k)
    const raw = def.wps(f[k].y, los, 1, inw, -inw, side)
    const pts = raw.map((w) => ({ x: clampX(w.x), y: clampY(w.y) }))
    const rr = routeRunRating(m[k].player, def.depth)
    const breakIdx = pts.length >= 3 ? pts.length - 2 : -1
    runRoute(m[k], pts, breakIdx, rr)
    if (k === tgt) {
      catchPt = pts[pts.length - 1]
      catchSec = m[k].t
    } else {
      const a = pts[pts.length - 2] ?? pts[pts.length - 1]
      const b = pts[pts.length - 1]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy) || 1
      m[k].run([{ x: clampX(b.x + (dx / len) * 2.5), y: clampY(b.y + (dy / len) * 2.5) }], { stop: true })
    }
  }
  if (m.fb) m.fb.run([{ x: los - 3, y: MID_Y + 1 }, { x: los - 1, y: MID_Y + side * 4 }], { stop: true })
  // A completion that gains less than the route's depth: the ball arrives
  // earlier on the route, short of the end spot, so the run after the catch
  // goes forward (or across), never back toward the line like a real NFL catch.
  let catchV0 = 0
  if (!inc && !int) {
    const endX0 = clampX(10 + play.endYard)
    const gain = endX0 - los
    const yacMin = gain > 0 ? clampN(gain * 0.25, 1, 4) : 0
    if (catchPt.x > endX0 - yacMin) {
      let tc = -1
      for (let t = catchSec; t >= 0.35; t -= 0.02) {
        if (posAt(m[tgt].path, t).x <= endX0 - yacMin) {
          tc = t
          break
        }
      }
      if (tc > 0) {
        catchPt = posAt(m[tgt].path, tc)
        catchV0 = seek(m[tgt], tc)
        catchSec = tc
      }
    }
  }
  catchSec = Math.max(catchSec, 0.35)

  // Release and flight: throw power sets a bullet vs a floater.
  const qb = ctx.actors?.get('qb')
  const thp = attrOf(qb, 'THP')
  const tup = attrOf(qb, 'TUP')
  const pac = attrOf(qb, 'PAC')
  const flightSec = clampN(1.1 - (thp - 70) * 0.006 + depth * 0.01 + (tup - 70) * 0.003 + (pa ? (pac - 70) * 0.002 : 0), 0.5, 1.8)
  const releaseSec = Math.max(0.15, catchSec - flightSec)
  const releasePos = posAt(m.qb.path, releaseSec)
  const accKey = depth >= 15 ? 'DAC' : depth >= 9 ? 'MAC' : 'SAC'
  const accuracy = attrOf(qb, accKey)

  const ball: WP[] = snapBall(m, los, releaseSec)
  const bias = clampN((70 - accuracy) * 0.03, -0.5, 1.0)
  ball.push(
    { t: (releaseSec + catchSec) / 2, x: clampX((releasePos.x + catchPt.x) / 2 + bias), y: clampY((releasePos.y + catchPt.y) / 2) },
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
  // Blitz first, so the extra rushers are excluded from the coverage pool (151).
  const blitzers = play.blitz ? blitzRush(m, f, los, seed, posAt(m.qb.path, releaseSec), releaseSec) : []
  const isBlitzer = (k: string) => blitzers.includes(k)
  const runners = receivers.filter((k) => pathLen(m[k].path) > 3.5)
  // Separation should match the recorded result: hip-pocket tight on short and
  // contested plays, looser on a recorded big gain (a blown coverage).
  const bigGain = gainYds >= 20
  const tightness = int ? 0 : inc ? 0 : bigGain ? (hash(seed + 17) < 0.55 ? 1.0 : 0.55) : 0.15
  const deepKey = receivers.reduce((a, k) => ((ROUTES[routeMap[k]]?.depth ?? 0) > (ROUTES[routeMap[a]]?.depth ?? 0) ? k : a), receivers[0])
  const deepInfo = routeInfo(routeMap[deepKey] ?? '')
  const manPos: Record<string, string> = { wr0: 'cb0', wr1: 'cb1', wr2: 's1', te: 'lb0', rb: 'lb1', fb: 'lb2' }
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
  if (runners.includes(tgt)) take(tgt, tgtMan)
  for (const k of runners) if (!assign[k]) take(k)
  for (const recv of Object.keys(assign)) {
    manTrail(m[assign[recv]], recv, m[recv], { fromSec: 0.1, toSec: trailEnd, los, cov: covOf(assign[recv]), inw: inwOf(recv), tightness, seed, routeName: routeMap[recv] ?? '', zone: zoneLook })
  }
  // Unassigned defenders: safeties over the top, the rest rob / drop into a zone.
  for (const dk of poolAll) {
    if (isBlitzer(dk) || used.has(dk)) continue
    if (dk.startsWith('s')) safetyRoam(m[dk], { fromSec: 0.1, toSec: trailEnd, releaseSec, los, deep: m[deepKey], depth: deepInfo.depth, catchPt, side: dk === 's0' ? -1 : 1, start: { x: m[dk].x, y: m[dk].y } })
    else zoneDrop(m[dk], { fromSec: 0.1, toSec: trailEnd, releaseSec, landmark: { x: los + 8, y: dk === 'cb0' ? 8 : dk === 'cb1' ? FIELD_H - 8 : MID_Y + (dk === 'lb0' ? -8 : dk === 'lb2' ? 8 : 0) }, zcv: attrOf(m[dk].player, 'ZCV'), threat: m[deepKey], catchPt })
  }

  if (inc) {
    // A drop or a bang-bang miss: the ball skips off the receiver's hands.
    const cth = attrOf(m[tgt].player, 'CTH')
    const skip = clampN((100 - cth) * 0.02, 0, 0.8)
    ball.push({ t: catchSec + 0.14, x: clampX(catchPt.x + 1.4 + skip), y: clampY(catchPt.y + (hash(seed) - 0.5) * 3) })
    const stopT = catchSec + 0.16
    for (const k of ALL_KEYS(f)) if (m[k].t < stopT) m[k].hold(stopT - m[k].t)
    return finish(f, m, { ball, holders, flights })
  }

  if (int) {
    const spotX = changeSpot(play, ctx.next) ?? catchPt.x - 8
    const near = nearestKey(m, DEF_KEYS, catchPt, catchSec)
    const v0 = seek(m[near], Math.max(0.12, catchSec - 0.06))
    m[near].run([{ x: catchPt.x, y: catchPt.y }], { v0, stop: true })
    const rx = clampX(spotX)
    const ry = clampY(catchPt.y + (MID_Y - catchPt.y) * 0.4)
    // After the pick the offense is the defense: the nearest offensive player
    // closes on the returner, who never freezes before the recorded stop.
    const res = resolveCarry({ m, carrierKey: near, spot: { x: rx, y: ry }, tacklerKeys: OFF_KEYS, seed, maxExtra: 2.0 })
    capAll(m, ALL_KEYS(f), res.endSec)
    ball.push(...shadow(m[near].path, catchSec).slice(1))
    return finish(f, m, { ball, holders: [...holders, { t: catchSec, key: near }], flights })
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
    : clampY(catchPt.y + (MID_Y - catchPt.y) * (yac > 8 ? 0.35 : 0.12) + (hash(seed + 8) - 0.5) * 4)
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
    return finish(f, m, {
      ball,
      holders: [...holders, { t: catchSec, key: tgt }, { t: popT, key: null }, { t: recT, key: rec }],
      flights,
    })
  }

  if (isTD || play.outOfBounds) {
    // A score or a step out of bounds: he keeps the ball to the spot and the
    // coverage chases, but nothing forces a tackle.
    m[tgt].run([{ x: endX, y: endY }], { v0: catchV0, stop: true })
    const endSec = m[tgt].t
    chaseCarrier(m, DEF_KEYS, catchSec, m[tgt], endSec, seed)
    capAll(m, ALL_KEYS(f), endSec)
    ball.push(...shadow(m[tgt].path, catchSec).slice(1))
    return finish(f, m, { ball, holders: [...holders, { t: catchSec, key: tgt }], flights })
  }

  // In bounds and short of the goal line: the credited tackler (when the sim
  // named one) — else the defender who can actually arrive first — meets the
  // receiver at the recorded stop while he keeps running at his ratings' pace.
  const res = resolveCarry({ m, carrierKey: tgt, spot, tacklerKeys: DEF_KEYS, prefer: creditKey, seed })
  capAll(m, ALL_KEYS(f), res.endSec)
  ball.push(...shadow(m[tgt].path, catchSec).slice(1))
  return finish(f, m, { ball, holders: [...holders, { t: catchSec, key: tgt }], flights })
}

/**
 * A blitz: the middle linebacker plus one outside linebacker (and sometimes a
 * safety) creep up before the snap and rush the quarterback at their own pace.
 */
function blitzRush(m: Record<string, Mover>, f: Formation, los: number, seed: number, qbAt: Pt, arriveSec: number): string[] {
  const keys = ['lb1', hash(seed + 31) < 0.5 ? 'lb0' : 'lb2', ...(hash(seed + 37) < 0.3 ? ['s1'] : [])]
  keys.forEach((k, i) => {
    const side = f[k].y < MID_Y ? -1 : 1
    const pmv = Math.max(attrOf(m[k].player, 'PMV'), attrOf(m[k].player, 'FMV'))
    const getHome = clampN((pmv - 70) * 0.05, -0.4, 1.2)
    m[k].reset()
    m[k].run(
      [
        { x: los + 2, y: clampY(f[k].y + (MID_Y - f[k].y) * 0.3) },
        { x: los - 1, y: clampY(MID_Y + side * (3.5 + i)) },
        { x: clampX(qbAt.x + 1 - getHome * 2), y: clampY(qbAt.y + side * (1 + i * 0.6)) },
      ],
      { stop: true },
    )
    if (m[k].t < arriveSec) m[k].hold(arriveSec - m[k].t)
  })
  return keys
}

function buildSack(play: Play, ctx: AnimContext): PlayAnim {
  const los = 10 + play.startYard
  const f = formation(los)
  const m = startMovers(f, ctx)
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

  for (let i = 0; i < 5; i++) m[`ol${i}`].run([{ x: los - 1.8, y: f[`ol${i}`].y }], { stop: true })
  m.qb.run([{ x: f.qb.x - 3, y: MID_Y }, { x: endX + 0.6, y: MID_Y + dodge * 2.5 }, { x: endX, y: MID_Y + dodge * 3 }], { stop: true })
  const sackT = m.qb.t
  m[rusherKey].run([{ x: los - 2.5, y: f[rusherKey].y + (MID_Y - f[rusherKey].y) * 0.5 }, { x: endX + 0.7, y: MID_Y + dodge * 3 }], { stop: true })
  for (let i = 0; i < 4; i++) if (`dl${i}` !== rusherKey) m[`dl${i}`].run([{ x: los - 1.4, y: f[`dl${i}`].y }], { stop: true })
  ;['wr0', 'wr1', 'wr2', 'te'].forEach((k, i) => m[k].run([{ x: los + 6 + i * 2, y: f[k].y }], { stop: true }))
  m.rb.run([{ x: los - 4, y: MID_Y - dodge * 3 }], { stop: true })
  const blitzers = play.blitz ? blitzRush(m, f, los, seed, { x: endX + 0.8, y: MID_Y + dodge * 3 }, sackT) : []
  ;['cb0', 'cb1', 's0', 's1', 'lb0', 'lb1', 'lb2'].filter((k) => !blitzers.includes(k)).forEach((k) => m[k].run([{ x: f[k].x + 3, y: f[k].y }], { stop: true }))
  const ball = snapBall(m, los, sackT)
  return finish(f, m, { ball, holders: [{ t: 0, key: null }, { t: SNAP, key: 'qb' }], flights: [] })
}

function buildPunt(play: Play, ctx: AnimContext): PlayAnim {
  const los = 10 + play.startYard
  const f = formation(los)
  f.qb = { ...f.qb, x: los - 13, role: 'P' }
  f.s0 = { ...f.s0, x: los + 40, y: MID_Y - 4, role: 'PR' }
  const m = startMovers(f, ctx)
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
  m.s0.run([{ x: landPt.x, y: landPt.y }], { stop: true })
  const trackT = m.s0.t
  const landT = Math.max(kickT + flight, trackT + 0.15)
  if (m.s0.t < landT) m.s0.hold(landT - m.s0.t)

  if (touchback) {
    cov.forEach((k, i) => m[k].run([{ x: clampX(los + 20 + i), y: clampY(f[k].y) }], { stop: true }))
    blk.forEach((k, i) => m[k].run([{ x: clampX(30 + i * 3), y: clampY(4 + i * 4.5) }], { stop: true }))
    const ball: WP[] = [...snapBall(m, los, kickT), { t: landT, x: 116, y: MID_Y }]
    return finish(f, m, { ball, holders: [{ t: 0, key: null }, { t: SNAP, key: 'qb' }, { t: kickT, key: null }], flights: [{ t0: kickT, t1: landT, height: 1 }] })
  }

  if (!isReturn) {
    // Fair catch / downed / muff: the ball is dead where it lands; coverage
    // converges on the spot but there is no return and no invented tackle.
    loftCoverage(m, cov, 0, landT, landPt, seed)
    blk.forEach((k, i) => m[k].run([{ x: clampX(landPt.x - 4 - i * 2), y: clampY(landPt.y + (i - 5) * 4) }], { stop: true }))
    const downKey = closestKey(m, cov, landPt, landT)
    chaseCarrier(m, cov.filter((k) => k !== downKey), landT, m.s0, landT + 0.8, seed)
    const ball: WP[] = [...snapBall(m, los, kickT), { t: landT, x: landPt.x, y: landPt.y }]
    if (kind === 'muff') {
      const loose = { x: clampX(landPt.x + (hash(seed + 4) - 0.5) * 6), y: clampY(landPt.y + (hash(seed + 5) - 0.5) * 6) }
      ball.push({ t: landT + 0.25, x: loose.x, y: loose.y }, { t: landT + 0.45, x: loose.x, y: loose.y })
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
  return finish(f, m, {
    ball,
    holders: [{ t: 0, key: null }, { t: SNAP, key: 'qb' }, { t: kickT, key: null }, { t: landT, key: 's0' }],
    flights: [{ t0: kickT, t1: landT, height: 1 }],
  })
}

function buildKick(play: Play, ctx: AnimContext): PlayAnim {
  const los = 10 + snapYard(play)
  const f = formation(los)
  f.qb = { ...f.qb, x: los - 7, role: 'H' }
  f.rb = { ...f.rb, x: los - 9.5, y: MID_Y - 2, role: 'K' }
  const m = startMovers(f, ctx)
  const good = /good/.test(play.result) && !/no good|MISSED/i.test(play.result)
  const seed = play.n * 23 + play.startYard
  const missY = MID_Y + (hash(seed) < 0.5 ? -1 : 1) * (4 + hash(seed + 1) * 3)
  const kpw = attrOf(m.rb.player, 'KPW')
  const flight = clampN(1.1 - (kpw - 70) * 0.004, 0.7, 1.5)
  const kickT = 0.3
  const landT = kickT + flight
  m.qb.run([{ x: los - 7.5, y: MID_Y - 0.5 }], { stop: true })
  m.rb.run([{ x: los - 7.2, y: MID_Y - 0.5 }], { stop: true })
  for (let i = 0; i < 4; i++) m[`dl${i}`].run([{ x: los, y: f[`dl${i}`].y }], { stop: true })
  const ball: WP[] = [{ t: 0, x: los, y: MID_Y }, { t: SNAP, x: los - 7, y: MID_Y }, { t: kickT, x: los - 7, y: MID_Y }, { t: landT, x: 116, y: good ? MID_Y : missY }]
  return finish(f, m, {
    ball,
    holders: [{ t: 0, key: null }, { t: SNAP, key: 'qb' }, { t: kickT, key: null }],
    flights: [{ t0: kickT, t1: landT, height: 1 }],
    posts: true,
  })
}

function buildKickoff(play: Play, ctx: AnimContext): PlayAnim {
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
  blkKeys.forEach((k, i) => m[k].reset(clampX(catchX + 3 + (i % 2) * 3), clampY(5 + i * 4.6)))
  const kickDist = Math.max(10, kickX - catchX)
  const minFlight = clampN(0.9 + kickDist * 0.035, 1.8, 3.2)
  const kStart = clampN(m.rb.pace.top * Math.max(0.4, minFlight - 0.1) * 0.8, 3, 16)
  m.rb.reset(clampX(catchX - kStart), MID_Y)
  m.rb.run([{ x: catchPt.x, y: catchPt.y }], { stop: true })
  const trackT = m.rb.t
  let catchT = Math.max(minFlight, trackT + 0.15)
  if (m.rb.t < catchT) m.rb.hold(catchT - m.rb.t)

  if (touchback) {
    // No return: the coverage converges downfield and the returner kneels. No
    // tackle is invented. The blockers retreat.
    covKeys.forEach((k, i) => m[k].run([{ x: clampX(kickX - 16 - i * 1.5), y: clampY(4 + i * 4.6) }], { stop: true }))
    blkKeys.forEach((k, i) => m[k].run([{ x: clampX(30 + i * 3), y: clampY(4 + i * 4.6) }], { stop: true }))
    const ball: WP[] = [{ t: 0, x: kickX, y: MID_Y }, { t: catchT, x: clampX(106), y: MID_Y }]
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
  if (m.rb.t < catchT) m.rb.hold(catchT - m.rb.t)
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
    return finish(f, m, {
      ball,
      holders: [{ t: 0, key: null }, { t: catchT, key: 'rb' }, { t: popT, key: null }, { t: recT, key: rec }],
      flights: [{ t0: 0, t1: catchT, height: 1 }],
    })
  }
  ball.push(...shadow(m.rb.path, catchT).slice(1))
  return finish(f, m, {
    ball,
    holders: [{ t: 0, key: null }, { t: catchT, key: 'rb' }],
    flights: [{ t0: 0, t1: catchT, height: 1 }],
  })
}

function buildPenalty(play: Play, ctx: AnimContext): PlayAnim {
  const los = 10 + play.startYard
  const f = formation(los)
  const m = startMovers(f, ctx)
  for (const k of OFF_KEYS) m[k].run([{ x: f[k].x + 0.6, y: f[k].y }], { stop: true })
  for (const k of DEF_KEYS) m[k].run([{ x: f[k].x - 0.4, y: f[k].y }], { stop: true })
  const ball: WP[] = [{ t: 0, x: los, y: MID_Y }, { t: 0.4, x: los, y: MID_Y }, { t: 1.2, x: 10 + play.endYard, y: MID_Y }]
  return finish(f, m, {
    ball,
    holders: [{ t: 0, key: null }],
    flights: [],
    flag: { t: 0.3, x: los + (play.yards > 0 ? 2 : -2), y: MID_Y + 3 },
  })
}

function buildStatic(play: Play, ctx: AnimContext): PlayAnim {
  const los = 10 + play.startYard
  const f = formation(los)
  const m = startMovers(f, ctx)
  for (const k of OFF_KEYS) m[k].hold(0.3)
  for (const k of DEF_KEYS) m[k].hold(0.3)
  const ball: WP[] = [{ t: 0, x: los, y: MID_Y }]
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

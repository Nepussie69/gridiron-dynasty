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
function changeSpot(play: Play, next?: Play): number | null {
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
  const endY = clampY(holeY + (hash(seed + 2) - 0.5) * (Math.abs(play.yards) > 12 ? 18 : 7))
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
  m[carrier].run(curve.slice(1), { v0: holeSpeed, stop: true })
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
    m[recover].run([{ x: loose.x, y: loose.y }, { x: clampX(spotX), y: loose.y }], { v0: 1, stop: true })
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

  pursueRun(m, DEF_KEYS, holeT, { x: endX + 0.8, y: endY }, endSec, seed, { x: endX - holeX, y: endY - holeY })
  const ball: WP[] = qbRun
    ? snapBall(m, los, endSec)
    : [...snapBall(m, los, handoffT), ...shadow(m[carrier].path, handoffT, endSec).slice(1)]
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

/** A defender trailing a receiver: the shape of the route, run at his own pace. */
function trailTo(def: Mover, recv: WP[], offX: number, offY: number, fromSec: number, toSec: number, cov: number) {
  const lag = clampN(0.16 - (cov - 60) * 0.004, 0.02, 0.28)
  const steps = 10
  const shape: Pt[] = []
  for (let i = 1; i <= steps; i++) {
    const t = fromSec + (toSec - fromSec) * (i / steps)
    const rp = posAt(recv, Math.max(0, t - lag))
    shape.push({ x: clampX(rp.x + offX), y: clampY(rp.y + offY) })
  }
  def.reset()
  def.run(shape, { v0: 0, stop: true })
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

  // Coverage: corners trail the outside receivers, backers drop / jump crossers,
  // a cushion set by the coverage rating; safeties drift with the deepest route.
  const trailEnd = Math.max(0.3, catchSec - 0.1)
  const covOf = (k: string) => Math.max(attrOf(m[k].player, 'MCV'), attrOf(m[k].player, 'ZCV'))
  trailTo(m.cb0, m.wr0.path, -1.6, inwOf('wr0') * 1.0, 0.1, trailEnd, covOf('cb0'))
  trailTo(m.cb1, m.wr1.path, -1.6, inwOf('wr1') * 1.0, 0.1, trailEnd, covOf('cb1'))
  const crossers = ['wr2', 'te', 'rb'].filter((k) => /meshIn|cross|drag/.test(routeMap[k]))
  for (let i = 0; i < 3; i++) {
    const k = crossers[i]
    if (k) trailTo(m[`lb${i}`], m[k].path, 0.6, -inwOf(k), 0.15, trailEnd, covOf(`lb${i}`))
    else m[`lb${i}`].run([{ x: los + 6 + i, y: clampY(MID_Y + (i - 1) * 6) }], { stop: true })
  }
  const deepKey = receivers.reduce((a, k) => ((ROUTES[routeMap[k]]?.depth ?? 0) > (ROUTES[routeMap[a]]?.depth ?? 0) ? k : a), receivers[0])
  const deepPos = posAt(m[deepKey].path, catchSec)
  const sX = los + Math.max(15, (ROUTES[routeMap[deepKey]]?.depth ?? 10) + 4)
  m.s0.run([{ x: clampX(sX), y: clampY(15 + (deepPos.y - 15) * 0.35) }], { stop: true })
  m.s1.run([{ x: clampX(sX), y: clampY(38 + (deepPos.y - 38) * 0.35) }], { stop: true })
  // Blitz: extra rushers attack the QB, arriving by the release.
  if (play.blitz) blitzRush(m, f, los, seed, posAt(m.qb.path, releaseSec), releaseSec)

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
    m[near].run([{ x: rx, y: ry }], { v0: 0, stop: true })
    const endSec = m[near].t
    pursueRun(m, DEF_KEYS.filter((k) => k !== near), catchSec, { x: rx, y: ry }, endSec, seed)
    ball.push(...shadow(m[near].path, catchSec).slice(1))
    return finish(f, m, { ball, holders: [...holders, { t: catchSec, key: near }], flights })
  }

  // Complete: the catch, then the run after it to the recorded end spot. A
  // touchdown caught in the end zone stays in the end zone (a step or two on).
  const goal = clampX(10 + play.endYard)
  const endX = goal >= 110 && catchPt.x >= goal ? clampX(catchPt.x + 1.5) : goal
  const yac = Math.abs(endX - catchPt.x)
  const endY = clampY(catchPt.y + (MID_Y - catchPt.y) * (yac > 8 ? 0.35 : 0.12) + (hash(seed + 8) - 0.5) * 4)
  m[tgt].run([{ x: endX, y: endY }], { v0: catchV0, stop: true })
  const endSec = Math.max(catchSec, m[tgt].t)
  pursueRun(m, DEF_KEYS, catchSec, { x: endX + 0.8, y: endY }, endSec, seed, { x: endX - catchPt.x, y: endY - catchPt.y })
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
  f.rb = { ...f.rb, x: los - 5, y: MID_Y }
  f.s0 = { ...f.s0, x: los + 40, y: MID_Y - 4, role: 'PR' }
  const m = startMovers(f, ctx)
  const seed = play.n * 19 + play.startYard
  const finalX = clampX(changeSpot(play, ctx.next) ?? 10 + play.startYard + play.yards)
  const ret = Math.max(0, Math.round(hash(seed) * 10) - 2)
  const landX = clampX(Math.min(108, finalX + ret))
  const landY = clampY(MID_Y + (hash(seed + 1) - 0.5) * 14)
  const kpw = attrOf(m.qb.player, 'KPW')
  const flight = clampN(1.1 - (kpw - 70) * 0.004, 0.6, 1.5)
  const kickT = 0.35
  const landT = kickT + flight
  // The returner gets to the landing spot (his pace), then runs the return back.
  m.s0.reset(f.s0.x, f.s0.y)
  m.s0.run([{ x: landX, y: landY }], { stop: false })
  if (m.s0.t > landT) seek(m.s0, landT)
  else m.s0.hold(landT - m.s0.t)
  m.s0.run([{ x: finalX, y: clampY(landY + (hash(seed + 2) - 0.5) * 8) }], { stop: true })
  const retT = m.s0.t
  const blockers = ['wr0', 'wr1', 'te', 'ol0', 'ol1', 'ol2', 'ol3', 'ol4', 'wr2']
  blockers.forEach((k, i) => m[k].run([{ x: clampX(finalX + 1 + (i % 3)), y: clampY(f[k].y + (posAt(m.s0.path, retT).y - f[k].y) * 0.7) }], { stop: true }))
  DEF_KEYS.filter((k) => k !== 's0').forEach((k, i) => m[k].run([{ x: clampX(los + 12 + i * 2), y: f[k].y }], { stop: true }))
  const punterPath = snapBall(m, los, kickT)
  const ball: WP[] = [...punterPath, { t: landT, x: landX, y: landY }, ...shadow(m.s0.path, landT).slice(1)]
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
  // The receiving club is the offense; the kick comes from their 65 back to them.
  const f = formation(10 + play.startYard)
  const m = startMovers(f, ctx)
  const kickX = 75
  const endX = clampX(10 + play.endYard)
  const touchback = play.result === 'Touchback'
  const catchX = touchback ? 4 : Math.max(6, endX - 18)
  DEF_KEYS.forEach((k, i) => {
    m[k].reset(kickX + 1, 3 + i * 4.7)
    m[k].run([{ x: Math.max(endX + 3, catchX + 10 + (i % 4) * 3), y: clampY(3 + i * 4.7 + (MID_Y - (3 + i * 4.7)) * 0.4) }], { stop: true })
  })
  m.rb.reset(8, MID_Y)
  m.rb.run([{ x: catchX, y: MID_Y }], { stop: false })
  const catchT = m.rb.t
  m.rb.run([{ x: touchback ? catchX : endX, y: MID_Y }], { stop: true })
  OFF_KEYS.filter((k) => k !== 'rb').forEach((k, i) => {
    m[k].reset(30 + (i % 3) * 6, 4 + i * 4.6)
    m[k].run([{ x: 28 + (i % 3) * 4, y: clampY(4 + i * 4.6 + (MID_Y - (4 + i * 4.6)) * 0.3) }], { stop: true })
  })
  const ball: WP[] = [{ t: 0, x: kickX, y: MID_Y }, { t: catchT, x: catchX, y: MID_Y }, ...shadow(m.rb.path, catchT).slice(1)]
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

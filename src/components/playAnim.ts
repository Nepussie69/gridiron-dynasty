// ─────────────────────────────────────────────────────────────────────────────
// Play animation for the game-day field.
//
// Turns one simulated play into keyframed paths for all 22 players and the
// ball: the snap, handoffs and dropbacks, routes and the throw, the catch and
// the run after it, scrambles under pressure, sacks, fumbles, interception and
// punt returns, kicks through the uprights. It is purely visual: everything is
// derived from the play's recorded result (and the next play's starting spot
// for returns), with a stable per-play hash instead of rng, so it can never
// change a game.
//
// Coordinates are in the offense's frame: its own goal line at x = 10, attacking
// toward x = 110; y runs 0..53.3 across the field. MatchView mirrors the frame
// when the away club has the ball.
// ─────────────────────────────────────────────────────────────────────────────

import type { Play } from '../game/engine/playsim'
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
}

// ── helpers ──────────────────────────────────────────────────────────────────
function hash(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}
/** Ball-carrier pace on run plays at 1× (yards per second): through the hole, then top speed. */
const RUN_HOLE_SPEED = 5.5
const RUN_TOP_SPEED = 7.5
const clampY = (y: number) => Math.max(1.2, Math.min(FIELD_H - 1.2, y))
const clampX = (x: number) => Math.max(1, Math.min(FIELD_W - 1, x))
// Speed-continuous easing: constant speed in between waypoints, easing only on an
// actor's first (accelerate) and last (decelerate) moving segment. Ease-in ends at
// slope 1 so it flows into a constant-speed segment (no stop at the waypoint).
const easeInU = (u: number) => u * u * (2 - u)
const easeOutU = (u: number) => u + u * u - u * u * u
const smoothU = (u: number) => u * u * (3 - 2 * u)

/**
 * Position along a keyframed path at time t (0..1). Between waypoints the actor
 * moves at constant speed; the first and last moving segments ease from / to
 * rest (flagged per waypoint so a shadowed ball inherits exactly the same warp).
 */
export function posAt(path: WP[], t: number): { x: number; y: number } {
  if (!path.length) return { x: 0, y: 0 }
  if (t <= path[0].t) return { x: path[0].x, y: path[0].y }
  for (let i = 1; i < path.length; i++) {
    const b = path[i]
    if (t <= b.t) {
      const a = path[i - 1]
      const span = b.t - a.t
      let u = span <= 0 ? 1 : (t - a.t) / span
      if (b.easeIn && b.easeOut) u = smoothU(u)
      else if (b.easeIn) u = easeInU(u)
      else if (b.easeOut) u = easeOutU(u)
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

/** Follow another path from time t0 on (used for a carried ball). */
function shadow(path: WP[], from: number, to = 1): WP[] {
  const out: WP[] = [{ t: from, ...posAt(path, from) }]
  for (const w of path) if (w.t > from && w.t < to) out.push({ ...w })
  // Copy the source's easing flags at the end knot too, so the ball reproduces
  // the carrier's motion exactly (including its ease-out).
  const end = path.find((w) => w.t === to)
  out.push({ t: to, ...posAt(path, to), ...(end ? { easeIn: end.easeIn, easeOut: end.easeOut, lock: end.lock } : {}) })
  return out
}

/**
 * Flag the first / last moving segment of a path for ease-in / ease-out. A path
 * with a single moving segment gets both (a smoothstep). Called on the actor
 * paths before a carried ball is shadowed, so the ball matches exactly.
 */
function markEase(path: WP[]): void {
  if (path.length < 2) return
  let first = -1
  for (let i = 1; i < path.length; i++) {
    if (path[i].x !== path[i - 1].x || path[i].y !== path[i - 1].y) {
      first = i
      break
    }
  }
  let last = -1
  for (let i = path.length - 1; i >= 1; i--) {
    if (path[i].x !== path[i - 1].x || path[i].y !== path[i - 1].y) {
      last = i
      break
    }
  }
  if (first >= 0 && !path[first].lock) path[first].easeIn = true
  if (last >= 0 && !path[last].lock) path[last].easeOut = true
}

/**
 * Keep one waypoint per time (the last one pushed wins — e.g. a defender
 * breaking on the ball overrides his trailing sample), then sort. Prevents
 * zero-span jumps in posAt.
 */
function compact(path: WP[]): void {
  const seen = new Map<number, WP>()
  for (const w of path) seen.set(Math.round(w.t * 1e6), w)
  const keep = [...seen.values()].sort((a, b) => a.t - b.t)
  path.length = 0
  for (const w of keep) path.push(w)
}

/** Sort and ease every actor path (do this before shadowing the ball). */
function markEaseAll(paths: Record<string, WP[]>): void {
  for (const k of Object.keys(paths)) {
    compact(paths[k])
    markEase(paths[k])
  }
}

/** Spot (offense frame) where the next possession started, if it was the other club's ball. */
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

/** Defenders closing on a tackle spot: the nearest arrive, the rest pursue part of the way. */
function pursue(paths: Record<string, WP[]>, keys: string[], from: number, spot: { x: number; y: number }, arrive = 1, seed = 0) {
  const ranked = keys
    .map((k) => ({ k, p: posAt(paths[k], from) }))
    .sort((a, b) => Math.hypot(a.p.x - spot.x, a.p.y - spot.y) - Math.hypot(b.p.x - spot.x, b.p.y - spot.y))
  ranked.forEach(({ k }, i) => {
    const share = i === 0 ? 1 : i === 1 ? 0.93 : i < 4 ? 0.75 : 0.45
    const ang = hash(seed + i * 3.1) * Math.PI * 2
    const r = i === 0 ? 0.9 : 1.6 + i * 0.25
    const tx = spot.x + Math.cos(ang) * r * (1 - share + (i === 0 ? 1 : 0.3))
    const ty = spot.y + Math.sin(ang) * r
    const t0 = Math.max(from, paths[k].reduce((m, w) => Math.max(m, w.t), 0))
    const s = posAt(paths[k], t0)
    let gx = clampX(s.x + (tx - s.x) * share)
    let gy = clampY(s.y + (ty - s.y) * share)
    if (arrive - t0 < 0.04) {
      paths[k].push({ t: arrive, x: gx, y: gy, lock: true })
      return
    }
    // Even, un-eased steps, and capped to the clock so a long chase never sprints.
    const capD = 1.28 * (arrive - t0) * 100
    const gd = Math.hypot(gx - s.x, gy - s.y)
    if (gd > capD) {
      const kk = capD / gd
      gx = clampX(s.x + (gx - s.x) * kk)
      gy = clampY(s.y + (gy - s.y) * kk)
    }
    const steps = Math.max(1, Math.min(6, Math.ceil(Math.hypot(gx - s.x, gy - s.y) / 12)))
    for (let st = 1; st <= steps; st++) {
      const f = st / steps
      paths[k].push({ t: t0 + (arrive - t0) * f, x: clampX(s.x + (gx - s.x) * f), y: clampY(s.y + (gy - s.y) * f), lock: true })
    }
  })
}

function startPaths(f: Formation, t0 = 0.08): Record<string, WP[]> {
  const out: Record<string, WP[]> = {}
  for (const [k, v] of Object.entries(f)) out[k] = [{ t: 0, x: v.x, y: v.y }, { t: t0, x: v.x, y: v.y }]
  return out
}

function finish(f: Formation, paths: Record<string, WP[]>, rest: Omit<PlayAnim, 'actors'>): PlayAnim {
  const keys = [...OFF_KEYS, ...(f.fb ? ['fb'] : []), ...DEF_KEYS]
  const actors: Actor[] = keys.map((k) => {
    const p = paths[k].slice()
    compact(p)
    return { key: k, side: f[k].side, role: f[k].role, path: p }
  })
  const ball = rest.ball.slice()
  compact(ball)
  return { ...rest, ball, actors }
}

// ── plays ────────────────────────────────────────────────────────────────────
export function buildPlayAnim(play: Play, ctx: AnimContext = {}): PlayAnim {
  switch (play.type) {
    case 'run':
      return buildRun(play, ctx)
    case 'pass':
      return play.result.startsWith('Sack') ? buildSack(play) : buildPass(play, ctx)
    case 'punt':
      return buildPunt(play, ctx)
    case 'fg':
    case 'pat':
      return play.concept === 'Two-point try' ? buildRun(play, ctx) : buildKick(play)
    case 'kickoff':
      return buildKickoff(play)
    case 'penalty':
      return buildPenalty(play)
    default:
      return buildStatic(play)
  }
}

function buildRun(play: Play, ctx: AnimContext): PlayAnim {
  const los = 10 + play.startYard
  const f = formation(los, formationHasFullback(formationForConcept(play.concept)))
  const seed = play.n * 7 + play.startYard
  const qbRun = !!ctx.carrierIsQB || /QB Draw|Scramble|Sneak/.test(play.concept)
  const wide = /Outside|Toss|Sweep|Stretch|Pitch|Bubble/.test(play.concept)
  const side = hash(seed) < 0.5 ? -1 : 1
  const holeY = MID_Y + side * (wide ? 11 + hash(seed + 1) * 4 : 1.5 + hash(seed + 1) * 3.5)
  const endX = clampX(10 + play.endYard)
  const fumble = !!play.turnover
  const endY = clampY(holeY + (hash(seed + 2) - 0.5) * (Math.abs(play.yards) > 12 ? 18 : 7))
  const carrier = qbRun ? 'qb' : 'rb'

  // Timing is set in milliseconds from real distances, then turned into 0..1
  // fractions: the back runs at a believable pace (no sprinting through a long
  // gain) and the whole play slows down with it. `sc` stretches the pre-hole
  // beats (blocks, fake, fullback lead) to the hole time.
  const holeX = los - (play.yards < 0 ? 0.5 : -0.4)
  const meshX = qbRun ? f.qb.x - 1 : f.qb.x + 0.7
  const meshY = qbRun ? MID_Y : MID_Y + side * 1.4
  const handMs = qbRun ? 260 : 520
  const toHoleMs = Math.max(380, (Math.hypot(holeX - meshX, holeY - meshY) / RUN_HOLE_SPEED) * 1000)
  const holeMs = handMs + toHoleMs
  // The run after the hole: a smooth curve (quadratic, bowed to one side) from
  // the hole to the end spot, sampled evenly along its length.
  const finX = endX
  const finY = endY
  const bow = side * (0.5 + hash(seed + 4) * 2.5)
  const ctrl = { x: (holeX + finX) / 2 - (finY - holeY) * 0.08, y: (holeY + finY) / 2 + bow * 2 }
  const curve = (u: number) => ({
    x: clampX((1 - u) * (1 - u) * holeX + 2 * (1 - u) * u * ctrl.x + u * u * finX),
    y: clampY((1 - u) * (1 - u) * holeY + 2 * (1 - u) * u * ctrl.y + u * u * finY),
  })
  const SAMPLES = 48
  const pts = [curve(0)]
  const arc = [0]
  for (let i = 1; i <= SAMPLES; i++) {
    pts.push(curve(i / SAMPLES))
    arc.push(arc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  }
  const L = arc[SAMPLES]
  // Speed along the run: leaves the hole at hole speed, builds to top speed over
  // ~4 yards, and slows into the tackle over the last ~2.5 yards.
  const speedAt = (sv: number) => {
    const build = RUN_HOLE_SPEED + (RUN_TOP_SPEED - RUN_HOLE_SPEED) * Math.min(1, sv / 4)
    return Math.max(1.6, build * Math.min(1, 0.3 + (0.7 * (L - sv)) / 2.5))
  }
  const runT = [0]
  for (let i = 1; i <= SAMPLES; i++) {
    const mid = (arc[i] + arc[i - 1]) / 2
    runT.push(runT[i - 1] + ((arc[i] - arc[i - 1]) / speedAt(mid)) * 1000)
  }
  const runMs = Math.max(260, runT[SAMPLES])
  const total = holeMs + runMs
  const holeT = holeMs / total
  const handT = handMs / total
  const sc = holeT / 0.42
  const snapT = 60 / total
  const p = startPaths(f, 80 / total)

  // Line: run blockers drive forward, DL engage at the line.
  for (let i = 0; i < 5; i++) p[`ol${i}`].push({ t: 0.35 * sc, x: los + 1 + (wide ? 0.5 : 1.2), y: f[`ol${i}`].y + side * (wide ? 1.5 : 0.4) })
  for (let i = 0; i < 4; i++) p[`dl${i}`].push({ t: 0.35 * sc, x: los + 0.6, y: f[`dl${i}`].y + side * 0.6 })
  // Receivers block downfield.
  ;['wr0', 'wr1', 'wr2', 'te'].forEach((k, i) => p[k].push({ t: 0.45 * sc, x: f[k].x + 4 + i, y: f[k].y + (MID_Y - f[k].y) * 0.15 }))
  // A fullback leads into the hole on a two-back run.
  if (p.fb) p.fb.push({ t: 0.3 * sc, x: los - 1, y: MID_Y + (holeY - MID_Y) * 0.6 }, { t: 0.5 * sc, x: los + 1.5, y: holeY + side * 1.2 })

  if (qbRun) {
    p.qb.push({ t: handT, x: meshX, y: meshY })
    p.rb.push({ t: 0.3 * sc, x: los - 1, y: MID_Y - side * 5 })
  } else {
    // Mesh point: QB turns, the back takes the handoff (they meet exactly).
    p.qb.push({ t: handT, x: meshX, y: meshY })
    p.rb.push({ t: handT, x: meshX, y: meshY })
    p.qb.push({ t: 0.4 * sc, x: f.qb.x - 1.5, y: MID_Y - side * 4 }) // carries out the fake
  }
  // Hit the hole, then follow the curve on the speed profile (dense locked
  // waypoints, so the motion is smooth and the pace is the profile's).
  p[carrier].push({ t: holeT, x: holeX, y: holeY })
  for (let i = 1; i <= SAMPLES; i++) {
    p[carrier].push({ t: holeT + (runT[i] / runMs) * (1 - holeT), x: pts[i].x, y: pts[i].y, lock: true })
  }

  // Linebackers fill, safeties come down; then everyone pursues to the tackle.
  for (let i = 0; i < 3; i++) p[`lb${i}`].push({ t: holeT, x: los + 3, y: f[`lb${i}`].y + (holeY - f[`lb${i}`].y) * 0.6 })
  ;['s0', 's1'].forEach((k) => p[k].push({ t: holeT, x: f[k].x - 4, y: f[k].y + (holeY - f[k].y) * 0.3 }))
  ;['cb0', 'cb1'].forEach((k) => p[k].push({ t: holeT, x: f[k].x - 1, y: f[k].y + (holeY - f[k].y) * 0.1 }))

  const ballPath: WP[] = [{ t: 0, x: los, y: MID_Y }, { t: snapT, ...posAt(p.qb, snapT) }]
  const holders: PlayAnim['holders'] = [{ t: 0, key: null }, { t: snapT, key: 'qb' }]
  if (!qbRun) holders.push({ t: handT, key: 'rb' })

  if (fumble) {
    // The ball pops out at the end of the run; a defender falls on it.
    const popT = 0.82
    pursue(p, DEF_KEYS, holeT, { x: finX, y: finY }, popT, seed)
    const spotX = changeSpot(play, ctx.next) ?? finX + 1
    const loose = { x: clampX(posAt(p[carrier], popT).x + 2), y: clampY(posAt(p[carrier], popT).y + (hash(seed + 5) - 0.5) * 6) }
    const recover = DEF_KEYS.map((k) => ({ k, d: Math.hypot(posAt(p[k], popT).x - loose.x, posAt(p[k], popT).y - loose.y) })).sort((a, b) => a.d - b.d)[0].k
    p[recover].push({ t: 0.9, x: loose.x, y: loose.y }, { t: 1, x: clampX(spotX), y: loose.y })
    markEaseAll(p)
    const carried = shadow(p[carrier], handT, popT)
    const ball: WP[] = [...ballPath, ...shadow(p.qb, snapT, handT).slice(1), ...carried, { t: 0.9, ...loose }, ...shadow(p[recover], 0.9)]
    markEase(ball)
    return finish(f, p, {
      duration: Math.round(total / 0.9),
      ball,
      holders: [...holders, { t: popT, key: null }, { t: 0.9, key: recover }],
      flights: [{ t0: popT, t1: 0.9, height: 0.4 }],
    })
  }
  pursue(p, DEF_KEYS, holeT, { x: finX + 0.8, y: finY }, 1, seed)
  markEaseAll(p)
  const ball: WP[] = [...ballPath, ...shadow(p.qb, snapT, handT).slice(1), ...shadow(p[carrier], handT)]
  markEase(ball)
  return finish(f, p, {
    duration: Math.round(total),
    ball,
    holders,
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

/** A defender trailing a receiver: sample his path at several times, offset off him. */
function trailTo(p: Record<string, WP[]>, def: string, recv: WP[], from: number, to: number, offX: number, offY: number, steps = 5, lag = 0) {
  for (let i = 1; i <= steps; i++) {
    const t = from + (to - from) * (i / steps)
    const rp = posAt(recv, Math.max(0, t - lag))
    p[def].push({ t, x: clampX(rp.x + offX), y: clampY(rp.y + offY) })
  }
}

function buildPass(play: Play, ctx: AnimContext): PlayAnim {
  const los = 10 + play.startYard
  const f = formation(los, formationHasFullback(formationForConcept(play.concept)))
  const p = startPaths(f)
  const seed = play.n * 11 + play.startYard
  const depth = Math.max(-2, Math.min(45, play.passDepth ?? 8))
  const tgt = targetKey(play, ctx)
  const scramble = !!play.pressure
  const rollSide = hash(seed + 9) < 0.5 ? -1 : 1
  const inc = play.result === 'Incomplete'
  const int = play.result.startsWith('Interception')
  const concept = play.concept
  const boot = concept === 'Bootleg'
  const quick = depth <= 8
  const throwT = boot ? 0.45 : quick ? 0.35 : depth <= 15 ? 0.45 : 0.55
  const catchT = Math.min(0.88, throwT + 0.05 + Math.max(0, depth) * 0.004)
  const side = hash(seed + 3) < 0.5 ? -1 : 1
  const pa = /Play Action|PA Cross|RPO/.test(concept)

  // Pocket: OL sets back, DL rush; on pressure the pocket breaks.
  for (let i = 0; i < 5; i++) p[`ol${i}`].push({ t: 0.32, x: los - 1.8, y: f[`ol${i}`].y + (i - 2) * 0.5 })
  for (let i = 0; i < 4; i++) {
    const tx = scramble && i === (rollSide < 0 ? 0 : 3) ? los - 5 : los - 1.2
    p[`dl${i}`].push({ t: 0.42, x: tx, y: f[`dl${i}`].y + (MID_Y - f[`dl${i}`].y) * 0.3 })
  }

  // Run fake (play-action / RPO / bootleg): QB and back mesh before the drop.
  if (pa) p.qb.push({ t: 0.15, x: f.qb.x + 0.5, y: MID_Y + side * 1.2 })
  if (concept === 'Bootleg') p.qb.push({ t: 0.17, x: f.qb.x - 1.2, y: MID_Y - rollSide * 1.2 })

  // Dropback, rollout or (under pressure) a scramble out of the pocket.
  const drop = depth >= 15 ? 4 : 2.2
  const rollMag = boot ? 9 : quick ? 3 : 6 + hash(seed + 2) * 3
  const rollY = clampY(MID_Y + (boot ? -rollSide : rollSide) * rollMag)
  p.qb.push({ t: 0.26, x: f.qb.x - drop, y: MID_Y })
  let throwFrom = { x: f.qb.x - drop, y: MID_Y }
  if (scramble || boot) {
    throwFrom = { x: f.qb.x - drop + 1.5, y: rollY }
    const escT = 0.26 + (throwT - 0.26) * 0.5
    p.qb.push({ t: escT, x: f.qb.x - drop - 0.5, y: MID_Y + (rollY - MID_Y) * 0.15 }, { t: throwT, ...throwFrom })
  } else {
    p.qb.push({ t: throwT, ...throwFrom })
  }
  if (concept === 'RB Screen') {
    // Linemen release out to the screen side after a short pass set.
    for (let i = 0; i < 5; i++) {
      p[`ol${i}`].push({ t: 0.5, x: los + 1, y: clampY(f[`ol${i}`].y + side * 8) })
      p[`ol${i}`].push({ t: 0.72, x: los + 2, y: clampY(f[`ol${i}`].y + side * 13) })
    }
  }

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

  const receivers = ['wr0', 'wr1', 'wr2', 'te', 'rb']
  for (const k of receivers) {
    const def = ROUTES[routeMap[k]] ?? ROUTES.check
    const T = k === tgt ? catchT : 0.62
    const startX = f[k].x
    const wps = def.wps(f[k].y, los, T, inwOf(k), -inwOf(k), side).map((w) => ({ ...w, x: clampX(w.x), y: clampY(w.y) }))
    // A receiver who lines up well behind his route's first point (the back)
    // gets a release: delay the first waypoint so no opening burst is needed.
    if (wps.length && Math.abs(wps[0].x - startX) > 5.0) {
      const nextT = wps.length > 1 ? wps[1].t : T
      wps[0].t = Math.max(0.12, Math.min(wps[0].t + 0.14, nextT - 0.08))
    }
    p[k].push(...wps)
    // Non-targets keep working after the break (never freeze on their last dot).
    if (k !== tgt && T < 0.95) {
      const a = p[k][p[k].length - 2]
      const b = p[k][p[k].length - 1]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy) || 1
      p[k].push({ t: 1, x: clampX(b.x + (dx / len) * 2.5), y: clampY(b.y + (dy / len) * 2.5) })
    }
  }
  // A fullback stays in to protect, then leaks to the flat.
  if (p.fb) p.fb.push({ t: 0.3, x: los - 3, y: MID_Y + 1 }, { t: Math.min(0.7, catchT), x: los - 1, y: MID_Y + side * 4 })
  const catchPt = posAt(p[tgt], catchT)

  // Coverage: corners trail the outside receivers, linebackers drop and jump
  // crossers, safeties drift with the deepest route.
  const trailEnd = Math.max(0.3, catchT - 0.16)
  trailTo(p, 'cb0', p.wr0, 0.14, trailEnd, -1.6, inwOf('wr0') * 1.0, 6, 0.02)
  trailTo(p, 'cb1', p.wr1, 0.14, trailEnd, -1.6, inwOf('wr1') * 1.0, 6, 0.02)
  const crossers = ['wr2', 'te', 'rb'].filter((k) => /meshIn|cross|drag/.test(routeMap[k]))
  for (let i = 0; i < 3; i++) {
    const k = crossers[i]
    if (k) trailTo(p, `lb${i}`, p[k], 0.2, trailEnd, 0.6, -inwOf(k), 4, 0.05)
    else p[`lb${i}`].push({ t: 0.42, x: los + 6 + i, y: clampY(MID_Y + (i - 1) * 6) })
  }
  const deepKey = receivers.reduce((a, k) => ((ROUTES[routeMap[k]]?.depth ?? 0) > (ROUTES[routeMap[a]]?.depth ?? 0) ? k : a), receivers[0])
  const deepPos = posAt(p[deepKey], catchT)
  const sX = los + Math.max(15, (ROUTES[routeMap[deepKey]]?.depth ?? 10) + 4)
  p.s0.push({ t: 0.45, x: clampX(sX), y: clampY(15 + (deepPos.y - 15) * 0.35) })
  p.s1.push({ t: 0.45, x: clampX(sX), y: clampY(38 + (deepPos.y - 38) * 0.35) })
  // Blitz: extra rushers (1–2 linebackers, sometimes a safety) attack the QB.
  if (play.blitz) blitzRush(p, f, los, seed, posAt(p.qb, 0.4))
  // The nearest defender breaks on the ball — over a beat, not teleporting.
  const near = DEF_KEYS.map((k) => ({ k, d: Math.hypot(posAt(p[k], catchT).x - catchPt.x, posAt(p[k], catchT).y - catchPt.y) })).sort((a, b) => a.d - b.d)[0].k
  const nearLast = p[near].reduce((m, w) => Math.max(m, w.t), 0)
  if (int) {
    // The interceptor gets to the catch point exactly.
    const preT = Math.max(0.2, catchT - 0.09)
    const np = posAt(p[near], preT)
    p[near] = p[near].filter((w) => w.t <= preT)
    p[near].push({ t: preT + (catchT - preT) * 0.5, x: clampX(np.x + (catchPt.x - np.x) * 0.5), y: clampY(np.y + (catchPt.y - np.y) * 0.5) })
    p[near].push({ t: catchT, x: clampX(catchPt.x), y: clampY(catchPt.y) })
  } else if (nearLast <= catchT - 0.02) {
    const brkX = catchPt.x + 1.1
    const brkY = catchPt.y + 0.5
    const preT = Math.min(catchT - 0.02, Math.max(nearLast, catchT - 0.2))
    const np = posAt(p[near], preT)
    const span = catchT - preT
    const steps = Math.max(2, Math.min(4, Math.ceil(Math.hypot(brkX - np.x, brkY - np.y) / (1.2 * span * 100))))
    for (let st = 1; st <= steps; st++) {
      const f = st / steps
      p[near].push({ t: preT + span * f, x: clampX(np.x + (brkX - np.x) * f), y: clampY(np.y + (brkY - np.y) * f), lock: true })
    }
  }

  const holders: PlayAnim['holders'] = [{ t: 0, key: null }, { t: 0.06, key: 'qb' }, { t: throwT, key: null }]
  const flights = [{ t0: throwT, t1: catchT, height: Math.min(1, 0.35 + depth / 40) }]
  const ballHead = (): WP[] => [{ t: 0, x: los, y: MID_Y }, { t: 0.06, ...posAt(p.qb, 0.06) }, ...shadow(p.qb, 0.06, throwT).slice(1), { t: catchT, ...catchPt }]

  if (inc) {
    for (const k of [...OFF_KEYS, ...DEF_KEYS]) if (!p[k].some((w) => w.t > catchT)) p[k].push({ t: catchT + 0.12, ...posAt(p[k], catchT) })
    markEaseAll(p)
    const ball: WP[] = [...ballHead(), { t: catchT + 0.1, x: clampX(catchPt.x + 2), y: clampY(catchPt.y + (hash(seed) - 0.5) * 3) }]
    markEase(ball)
    return finish(f, p, { duration: 2400, ball, holders, flights })
  }
  if (int) {
    const spotX = changeSpot(play, ctx.next) ?? catchPt.x - 8
    const span = Math.max(0.12, 1 - catchT)
    let rx = clampX(Math.min(spotX, catchPt.x))
    let ry = clampY(catchPt.y + (MID_Y - catchPt.y) * 0.4)
    const capD = 1.28 * span * 100
    const rd = Math.hypot(rx - catchPt.x, ry - catchPt.y)
    if (rd > capD) {
      const kk = capD / rd
      rx = clampX(catchPt.x + (rx - catchPt.x) * kk)
      ry = clampY(catchPt.y + (ry - catchPt.y) * kk)
    }
    const steps = Math.max(1, Math.min(6, Math.ceil(Math.hypot(rx - catchPt.x, ry - catchPt.y) / 12)))
    for (let st = 1; st <= steps; st++) {
      const f = st / steps
      p[near].push({ t: catchT + span * f, x: clampX(catchPt.x + (rx - catchPt.x) * f), y: clampY(catchPt.y + (ry - catchPt.y) * f), lock: true })
    }
    pursue(p, OFF_KEYS, catchT, posAt(p[near], 1), 1, seed)
    markEaseAll(p)
    const ball: WP[] = [...ballHead(), ...shadow(p[near], catchT).slice(1)]
    markEase(ball)
    return finish(f, p, { duration: 3000, ball, holders: [...holders, { t: catchT, key: near }], flights })
  }
  // Complete: the catch, then the run after it, turning upfield. Long runs are
  // capped to the clock and spread into even, un-eased steps.
  const runSpan = Math.max(0.12, 1 - catchT)
  const maxYac = 1.28 * runSpan * 100
  const endX = clampX(Math.min(Math.max(catchPt.x, 10 + play.endYard), catchPt.x + maxYac))
  const yac = endX - catchPt.x
  const endY = clampY(catchPt.y + (MID_Y - catchPt.y) * (yac > 8 ? 0.35 : 0.12) + (hash(seed + 8) - 0.5) * 4)
  if (yac > 6) {
    const steps = Math.max(2, Math.ceil(yac / 12))
    for (let i = 1; i <= steps; i++) {
      const f = i / steps
      p[tgt].push({ t: catchT + runSpan * f, x: clampX(catchPt.x + yac * f), y: clampY(catchPt.y + (endY - catchPt.y) * f), lock: true })
    }
  } else {
    p[tgt].push({ t: 1, x: endX, y: endY })
  }
  // The defender's break on the ball was a near miss; everyone pursues.
  if (p[near].length && p[near][p[near].length - 1].t === catchT) p[near][p[near].length - 1] = { t: catchT, ...nudge(catchPt, 1.6, 0.6) }
  pursue(p, DEF_KEYS, catchT, { x: endX + 0.8, y: endY }, 1, seed)
  markEaseAll(p)
  const ball: WP[] = [...ballHead(), ...shadow(p[tgt], catchT).slice(1)]
  markEase(ball)
  return finish(f, p, {
    duration: yac > 15 ? 3300 : 2800,
    ball,
    holders: [...holders, { t: catchT, key: tgt }],
    flights,
  })
}

function nudge(pt: { x: number; y: number }, dx: number, dy: number) {
  return { x: clampX(pt.x + dx), y: clampY(pt.y + dy) }
}

/**
 * A blitz: the middle linebacker plus one outside linebacker (and sometimes a
 * safety) creep up before the snap and rush the quarterback. Returns their keys.
 */
function blitzRush(p: Record<string, WP[]>, f: Formation, los: number, seed: number, qbAt: { x: number; y: number }): string[] {
  const keys = ['lb1', hash(seed + 31) < 0.5 ? 'lb0' : 'lb2', ...(hash(seed + 37) < 0.3 ? ['s1'] : [])]
  keys.forEach((k, i) => {
    const side = f[k].y < MID_Y ? -1 : 1
    p[k] = [
      { t: 0, x: f[k].x, y: f[k].y },
      { t: 0.06, x: los + 2, y: clampY(f[k].y + (MID_Y - f[k].y) * 0.3) },
      { t: 0.28, x: los - 1, y: clampY(MID_Y + side * (3.5 + i)) },
      { t: 0.46, x: clampX(qbAt.x + 1), y: clampY(qbAt.y + side * (1 + i * 0.6)) },
    ]
  })
  return keys
}

function buildSack(play: Play): PlayAnim {
  const los = 10 + play.startYard
  const f = formation(los)
  const p = startPaths(f)
  const seed = play.n * 17 + play.startYard
  const endX = clampX(10 + play.endYard)
  const rusher = `dl${Math.floor(hash(seed) * 4)}`
  const dodge = hash(seed + 1) < 0.5 ? -1 : 1
  for (let i = 0; i < 5; i++) p[`ol${i}`].push({ t: 0.35, x: los - 1.8, y: f[`ol${i}`].y })
  p.qb.push({ t: 0.3, x: f.qb.x - 3, y: MID_Y }, { t: 0.55, x: endX + 0.6, y: MID_Y + dodge * 2.5 }, { t: 0.72, x: endX, y: MID_Y + dodge * 3 })
  p[rusher].push({ t: 0.45, x: los - 2.5, y: f[rusher].y + (MID_Y - f[rusher].y) * 0.5 }, { t: 0.72, x: endX + 0.7, y: MID_Y + dodge * 3 })
  for (let i = 0; i < 4; i++) if (`dl${i}` !== rusher) p[`dl${i}`].push({ t: 0.5, x: los - 1.4, y: f[`dl${i}`].y })
  ;['wr0', 'wr1', 'wr2', 'te'].forEach((k, i) => p[k].push({ t: 0.6, x: los + 6 + i * 2, y: f[k].y }))
  p.rb.push({ t: 0.35, x: los - 4, y: MID_Y - dodge * 3 })
  const blitzers = play.blitz ? blitzRush(p, f, los, seed, { x: endX + 0.8, y: MID_Y + dodge * 3 }) : []
  ;['cb0', 'cb1', 's0', 's1', 'lb0', 'lb1', 'lb2'].filter((k) => !blitzers.includes(k)).forEach((k) => p[k].push({ t: 0.6, x: posAt(p[k], 0).x + 3, y: posAt(p[k], 0).y }))
  markEaseAll(p)
  const ball: WP[] = [{ t: 0, x: los, y: MID_Y }, { t: 0.06, ...posAt(p.qb, 0.06) }, ...shadow(p.qb, 0.06, 1).slice(1)]
  markEase(ball)
  return finish(f, p, {
    duration: 2200,
    ball,
    holders: [{ t: 0, key: null }, { t: 0.06, key: 'qb' }],
    flights: [],
  })
}

function buildPunt(play: Play, ctx: AnimContext): PlayAnim {
  const los = 10 + play.startYard
  const f = formation(los)
  // Punt formation: the punter deep, gunners wide.
  f.qb = { ...f.qb, x: los - 13, role: 'P' }
  f.rb = { ...f.rb, x: los - 5, y: MID_Y }
  f.s0 = { ...f.s0, x: los + 40, y: MID_Y - 4, role: 'PR' }
  const p = startPaths(f)
  const seed = play.n * 19 + play.startYard
  const finalX = clampX(changeSpot(play, ctx.next) ?? 10 + play.startYard + play.yards)
  // The ball lands a little past the final spot when there's a return.
  const ret = Math.max(0, Math.round(hash(seed) * 10) - 2)
  const landX = clampX(Math.min(108, finalX + ret))
  const landY = clampY(MID_Y + (hash(seed + 1) - 0.5) * 14)
  const kickT = 0.15
  const landT = 0.6
  p.s0 = [{ t: 0, x: f.s0.x, y: f.s0.y }, { t: landT, x: landX, y: landY }, { t: 1, x: finalX, y: clampY(landY + (hash(seed + 2) - 0.5) * 8) }]
  // Coverage sprints downfield; the returner's team sets up blocks.
  ;['wr0', 'wr1', 'te', 'ol0', 'ol1', 'ol2', 'ol3', 'ol4', 'wr2'].forEach((k, i) => p[k].push({ t: 0.95, x: clampX(finalX + 1 + (i % 3)), y: clampY(f[k].y + (posAt(p.s0, 1).y - f[k].y) * 0.7) }))
  DEF_KEYS.filter((k) => k !== 's0').forEach((k, i) => p[k].push({ t: 0.9, x: clampX(los + 12 + i * 2), y: f[k].y }))
  markEaseAll(p)
  const ball: WP[] = [{ t: 0, x: los, y: MID_Y }, { t: 0.08, x: f.qb.x, y: MID_Y }, { t: kickT, x: f.qb.x + 1, y: MID_Y }, { t: landT, x: landX, y: landY }, ...shadow(p.s0, landT).slice(1)]
  markEase(ball)
  return finish(f, p, {
    duration: 3000,
    ball,
    holders: [{ t: 0, key: null }, { t: 0.08, key: 'qb' }, { t: kickT, key: null }, { t: landT, key: 's0' }],
    flights: [{ t0: kickT, t1: landT, height: 1 }],
  })
}

function buildKick(play: Play): PlayAnim {
  const los = 10 + snapYard(play)
  const f = formation(los)
  f.qb = { ...f.qb, x: los - 7, role: 'H' }
  f.rb = { ...f.rb, x: los - 9.5, y: MID_Y - 2, role: 'K' }
  const p = startPaths(f)
  const good = /good/.test(play.result) && !/no good|MISSED/i.test(play.result)
  const seed = play.n * 23 + play.startYard
  const missY = MID_Y + (hash(seed) < 0.5 ? -1 : 1) * (4 + hash(seed + 1) * 3)
  p.rb.push({ t: 0.18, x: los - 7.5, y: MID_Y - 0.5 })
  for (let i = 0; i < 4; i++) p[`dl${i}`].push({ t: 0.3, x: los, y: f[`dl${i}`].y })
  markEaseAll(p)
  const ball: WP[] = [{ t: 0, x: los, y: MID_Y }, { t: 0.1, x: los - 7, y: MID_Y }, { t: 0.2, x: los - 7, y: MID_Y }, { t: 0.85, x: 116, y: good ? MID_Y : missY }]
  markEase(ball)
  return finish(f, p, {
    duration: 2000,
    ball,
    holders: [{ t: 0, key: null }, { t: 0.1, key: 'qb' }, { t: 0.2, key: null }],
    flights: [{ t0: 0.2, t1: 0.85, height: 1 }],
    posts: true,
  })
}

function buildKickoff(play: Play): PlayAnim {
  // The receiving club is the offense; the kick comes from their 65 back to them.
  const f = formation(10 + play.startYard)
  const p = startPaths(f)
  const kickX = 75
  const endX = 10 + play.endYard
  const touchback = play.result === 'Touchback'
  const catchX = touchback ? 4 : Math.max(6, endX - 18)
  // Kicking team (defense frame here) lines up at its 35 and covers.
  DEF_KEYS.forEach((k, i) => {
    p[k] = [{ t: 0, x: kickX + 1, y: 3 + i * 4.7 }, { t: 0.12, x: kickX + 1, y: 3 + i * 4.7 }, { t: 0.95, x: Math.max(endX + 3, catchX + 10 + (i % 4) * 3), y: 3 + i * 4.7 + (MID_Y - (3 + i * 4.7)) * 0.4 }]
  })
  p.rb = [{ t: 0, x: 8, y: MID_Y }, { t: 0.55, x: catchX, y: MID_Y }, { t: 1, x: touchback ? catchX : endX, y: MID_Y }]
  OFF_KEYS.filter((k) => k !== 'rb').forEach((k, i) => {
    p[k] = [{ t: 0, x: 30 + (i % 3) * 6, y: 4 + i * 4.6 }, { t: 0.7, x: 28 + (i % 3) * 4, y: 4 + i * 4.6 + (MID_Y - (4 + i * 4.6)) * 0.3 }]
  })
  markEaseAll(p)
  const ball: WP[] = [{ t: 0, x: kickX, y: MID_Y }, { t: 0.12, x: kickX, y: MID_Y }, { t: 0.55, x: catchX, y: MID_Y }, ...shadow(p.rb, 0.55).slice(1)]
  markEase(ball)
  return finish(f, p, {
    duration: 2400,
    ball,
    holders: [{ t: 0, key: null }, { t: 0.55, key: 'rb' }],
    flights: [{ t0: 0.12, t1: 0.55, height: 1 }],
  })
}

function buildPenalty(play: Play): PlayAnim {
  const los = 10 + play.startYard
  const f = formation(los)
  const p = startPaths(f)
  for (const k of OFF_KEYS) p[k].push({ t: 0.3, x: f[k].x + 0.6, y: f[k].y })
  for (const k of DEF_KEYS) p[k].push({ t: 0.3, x: f[k].x - 0.4, y: f[k].y })
  markEaseAll(p)
  const ball: WP[] = [{ t: 0, x: los, y: MID_Y }, { t: 0.45, x: los, y: MID_Y }, { t: 1, x: 10 + play.endYard, y: MID_Y }]
  markEase(ball)
  return finish(f, p, {
    duration: 1600,
    ball,
    holders: [{ t: 0, key: null }],
    flights: [],
    flag: { t: 0.25, x: los + (play.yards > 0 ? 2 : -2), y: MID_Y + 3 },
  })
}

function buildStatic(play: Play): PlayAnim {
  const los = 10 + play.startYard
  const f = formation(los)
  const p = startPaths(f, 1)
  markEaseAll(p)
  const ball: WP[] = [{ t: 0, x: los, y: MID_Y }]
  return finish(f, p, { duration: 400, ball, holders: [{ t: 0, key: null }], flights: [] })
}

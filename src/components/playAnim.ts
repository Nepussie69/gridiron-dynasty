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

export const FIELD_W = 120
export const FIELD_H = 53.3
export const MID_Y = 26.65

export interface WP {
  t: number
  x: number
  y: number
}

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
const clampY = (y: number) => Math.max(1.2, Math.min(FIELD_H - 1.2, y))
const clampX = (x: number) => Math.max(1, Math.min(FIELD_W - 1, x))
const smooth = (u: number) => u * u * (3 - 2 * u)

/** Position along a keyframed path at time t (0..1), smoothed per segment. */
export function posAt(path: WP[], t: number): { x: number; y: number } {
  if (!path.length) return { x: 0, y: 0 }
  if (t <= path[0].t) return { x: path[0].x, y: path[0].y }
  for (let i = 1; i < path.length; i++) {
    const b = path[i]
    if (t <= b.t) {
      const a = path[i - 1]
      const u = b.t === a.t ? 1 : smooth((t - a.t) / (b.t - a.t))
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
  out.push({ t: to, ...posAt(path, to) })
  return out
}

/** Spot (offense frame) where the next possession started, if it was the other club's ball. */
function changeSpot(play: Play, next?: Play): number | null {
  if (!next || next.offId === play.offId) return null
  if (next.type === 'end') return null
  return 10 + (100 - next.startYard)
}

// ── formation ────────────────────────────────────────────────────────────────
interface Formation {
  [key: string]: { x: number; y: number; side: 'off' | 'def'; role: string }
}

function formation(los: number): Formation {
  const f: Formation = {}
  ;[-2.6, -1.3, 0, 1.3, 2.6].forEach((d, i) => (f[`ol${i}`] = { x: los - 0.6, y: MID_Y + d, side: 'off', role: 'OL' }))
  f.qb = { x: los - 5, y: MID_Y, side: 'off', role: 'QB' }
  f.rb = { x: los - 7, y: MID_Y + 2.5, side: 'off', role: 'RB' }
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
  ranked.forEach(({ k, p }, i) => {
    const share = i === 0 ? 1 : i === 1 ? 0.93 : i < 4 ? 0.75 : 0.45
    const ang = hash(seed + i * 3.1) * Math.PI * 2
    const r = i === 0 ? 0.9 : 1.6 + i * 0.25
    const tx = spot.x + Math.cos(ang) * r * (1 - share + (i === 0 ? 1 : 0.3))
    const ty = spot.y + Math.sin(ang) * r
    paths[k].push({ t: arrive, x: clampX(p.x + (tx - p.x) * share), y: clampY(p.y + (ty - p.y) * share) })
  })
}

function startPaths(f: Formation, t0 = 0.08): Record<string, WP[]> {
  const out: Record<string, WP[]> = {}
  for (const [k, v] of Object.entries(f)) out[k] = [{ t: 0, x: v.x, y: v.y }, { t: t0, x: v.x, y: v.y }]
  return out
}

function finish(f: Formation, paths: Record<string, WP[]>, rest: Omit<PlayAnim, 'actors'>): PlayAnim {
  const actors: Actor[] = [...OFF_KEYS, ...DEF_KEYS].map((k) => {
    const p = paths[k].slice().sort((a, b) => a.t - b.t)
    return { key: k, side: f[k].side, role: f[k].role, path: p }
  })
  return { ...rest, actors }
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
  const f = formation(los)
  const p = startPaths(f)
  const seed = play.n * 7 + play.startYard
  const qbRun = !!ctx.carrierIsQB || /QB Draw|Scramble|Sneak/.test(play.concept)
  const wide = /Outside|Toss|Sweep|Stretch|Pitch|Bubble/.test(play.concept)
  const side = hash(seed) < 0.5 ? -1 : 1
  const holeY = MID_Y + side * (wide ? 11 + hash(seed + 1) * 4 : 1.5 + hash(seed + 1) * 3.5)
  const endX = clampX(10 + play.endYard)
  const fumble = !!play.turnover
  const endY = clampY(holeY + (hash(seed + 2) - 0.5) * (Math.abs(play.yards) > 12 ? 18 : 7))
  const carrier = qbRun ? 'qb' : 'rb'

  // Line: run blockers drive forward, DL engage at the line.
  for (let i = 0; i < 5; i++) p[`ol${i}`].push({ t: 0.35, x: los + 1 + (wide ? 0.5 : 1.2), y: f[`ol${i}`].y + side * (wide ? 1.5 : 0.4) })
  for (let i = 0; i < 4; i++) p[`dl${i}`].push({ t: 0.35, x: los + 0.6, y: f[`dl${i}`].y + side * 0.6 })
  // Receivers block downfield.
  ;['wr0', 'wr1', 'wr2', 'te'].forEach((k, i) => p[k].push({ t: 0.45, x: f[k].x + 4 + i, y: f[k].y + (MID_Y - f[k].y) * 0.15 }))

  const handT = qbRun ? 0.1 : 0.2
  const holeT = 0.42
  if (qbRun) {
    p.qb.push({ t: 0.18, x: f.qb.x - 1, y: MID_Y })
    p.rb.push({ t: 0.3, x: los - 1, y: MID_Y - side * 5 })
  } else {
    // Mesh point: QB turns, the back takes the handoff.
    p.qb.push({ t: handT, x: f.qb.x + 0.6, y: MID_Y + side * 1.2 })
    p.rb.push({ t: handT, x: f.qb.x + 0.8, y: MID_Y + side * 1.6 })
    p.qb.push({ t: 0.4, x: f.qb.x - 1.5, y: MID_Y - side * 4 }) // carries out the fake
  }
  // Hit the hole, make the cut, run to the spot.
  const cutX = Math.min(endX, los + 3 + hash(seed + 3) * 3)
  p[carrier].push({ t: holeT, x: los - (play.yards < 0 ? 0.5 : -0.4), y: holeY })
  if (play.yards >= 4) p[carrier].push({ t: 0.6, x: cutX, y: clampY(holeY + side * (hash(seed + 4) * 4 - 1)) })
  p[carrier].push({ t: 1, x: endX, y: endY })

  // Linebackers fill, safeties come down; then everyone pursues to the tackle.
  for (let i = 0; i < 3; i++) p[`lb${i}`].push({ t: holeT, x: los + 3, y: f[`lb${i}`].y + (holeY - f[`lb${i}`].y) * 0.6 })
  ;['s0', 's1'].forEach((k) => p[k].push({ t: holeT, x: f[k].x - 4, y: f[k].y + (holeY - f[k].y) * 0.3 }))
  ;['cb0', 'cb1'].forEach((k) => p[k].push({ t: holeT, x: f[k].x - 1, y: f[k].y + (holeY - f[k].y) * 0.1 }))

  const ballPath: WP[] = [{ t: 0, x: los, y: MID_Y }, { t: 0.06, ...posAt(p.qb, 0.06) }]
  const holders: PlayAnim['holders'] = [{ t: 0, key: null }, { t: 0.06, key: 'qb' }]
  if (!qbRun) holders.push({ t: handT, key: 'rb' })

  if (fumble) {
    // The ball pops out at the end of the run; a defender falls on it.
    const popT = 0.82
    pursue(p, DEF_KEYS, holeT, { x: endX, y: endY }, popT, seed)
    const spotX = changeSpot(play, ctx.next) ?? endX + 1
    const loose = { x: clampX(posAt(p[carrier], popT).x + 2), y: clampY(posAt(p[carrier], popT).y + (hash(seed + 5) - 0.5) * 6) }
    const recover = DEF_KEYS.map((k) => ({ k, d: Math.hypot(posAt(p[k], popT).x - loose.x, posAt(p[k], popT).y - loose.y) })).sort((a, b) => a.d - b.d)[0].k
    p[recover].push({ t: 0.9, x: loose.x, y: loose.y }, { t: 1, x: clampX(spotX), y: loose.y })
    const carried = shadow(p[carrier], handT, popT)
    return finish(f, p, {
      duration: 2700,
      ball: [...ballPath, ...carried, { t: 0.9, ...loose }, ...shadow(p[recover], 0.9)],
      holders: [...holders, { t: popT, key: null }, { t: 0.9, key: recover }],
      flights: [{ t0: popT, t1: 0.9, height: 0.4 }],
    })
  }
  pursue(p, DEF_KEYS, holeT, { x: endX + 0.8, y: endY }, 1, seed)
  return finish(f, p, {
    duration: play.yards >= 20 ? 2900 : 2300,
    ball: [...ballPath, ...shadow(p[carrier], handT)],
    holders,
    flights: [],
  })
}

/** Which receiver dot the throw goes to. */
function targetKey(play: Play, ctx: AnimContext): string {
  if (ctx.targetPos === 'RB') return 'rb'
  if (ctx.targetPos === 'TE') return 'te'
  if (/Screen/.test(play.concept)) return 'rb'
  return ['wr0', 'wr1', 'wr2'][Math.floor(hash(play.n * 13 + play.startYard) * 3)]
}

function buildPass(play: Play, ctx: AnimContext): PlayAnim {
  const los = 10 + play.startYard
  const f = formation(los)
  const p = startPaths(f)
  const seed = play.n * 11 + play.startYard
  const depth = Math.max(-2, Math.min(45, play.passDepth ?? 8))
  const tgt = targetKey(play, ctx)
  const scramble = !!play.pressure
  const rollSide = hash(seed + 9) < 0.5 ? -1 : 1
  const inc = play.result === 'Incomplete'
  const int = play.result.startsWith('Interception')

  // Pocket: OL sets back, DL rush; on pressure the pocket breaks.
  for (let i = 0; i < 5; i++) p[`ol${i}`].push({ t: 0.32, x: los - 1.8, y: f[`ol${i}`].y + (i - 2) * 0.5 })
  for (let i = 0; i < 4; i++) {
    const tx = scramble && i === (rollSide < 0 ? 0 : 3) ? los - 5 : los - 1.2
    p[`dl${i}`].push({ t: 0.42, x: tx, y: f[`dl${i}`].y + (MID_Y - f[`dl${i}`].y) * 0.3 })
  }

  // Dropback and, under pressure, a scramble out of the pocket.
  const drop = depth >= 15 ? 4 : 2.2
  p.qb.push({ t: 0.26, x: f.qb.x - drop, y: MID_Y })
  const throwT = 0.5
  let throwFrom = { x: f.qb.x - drop, y: MID_Y }
  if (scramble) {
    throwFrom = { x: f.qb.x - drop + 1.5, y: clampY(MID_Y + rollSide * (7 + hash(seed + 2) * 4)) }
    p.qb.push({ t: 0.36, x: f.qb.x - drop - 0.5, y: MID_Y + rollSide * 2 }, { t: throwT, ...throwFrom })
  } else {
    p.qb.push({ t: throwT, ...throwFrom })
  }

  // Routes: a stem upfield, then a break in or out. The target's route ends at the catch point.
  const receivers = ['wr0', 'wr1', 'wr2', 'te', 'rb']
  const catchT = throwT + 0.08 + Math.max(0, depth) * 0.004
  let catchPt = { x: los + depth, y: MID_Y }
  receivers.forEach((k, i) => {
    const r = f[k]
    const isT = k === tgt
    const d = isT ? depth : k === 'rb' ? 2 : 5 + Math.round(hash(seed + i * 5) * 14)
    const inward = r.y < MID_Y ? 1 : -1
    const brk = (hash(seed + i * 7) < 0.6 ? inward : -inward) * (3 + hash(seed + i) * 5)
    if (k === 'rb') {
      p.rb.push({ t: 0.25, x: los - 3, y: r.y + 3 }, { t: catchT, x: los + d, y: clampY(r.y + 7) })
    } else {
      p[k].push({ t: 0.32, x: los + Math.max(1, d - 2), y: r.y }, { t: catchT, x: los + d, y: clampY(r.y + brk) })
    }
    if (isT) catchPt = posAt(p[k], catchT)
  })

  // Coverage: corners trail the outside receivers, linebackers and safeties drop.
  p.cb0.push({ t: 0.32, x: los + 6, y: f.wr0.y + 1 }, { t: catchT, ...nudge(posAt(p.wr0, catchT), 1.4, 0.8) })
  p.cb1.push({ t: 0.32, x: los + 6, y: f.wr1.y - 1 }, { t: catchT, ...nudge(posAt(p.wr1, catchT), 1.4, -0.8) })
  for (let i = 0; i < 3; i++) p[`lb${i}`].push({ t: 0.42, x: los + 7, y: f[`lb${i}`].y + (i - 1) * 2 })
  p.s0.push({ t: 0.42, x: los + Math.max(14, depth + 3), y: 15 })
  p.s1.push({ t: 0.42, x: los + Math.max(14, depth + 3), y: 38 })
  // The nearest defender breaks on the ball.
  const near = DEF_KEYS.map((k) => ({ k, d: Math.hypot(posAt(p[k], catchT).x - catchPt.x, posAt(p[k], catchT).y - catchPt.y) })).sort((a, b) => a.d - b.d)[0].k
  p[near].push({ t: catchT, ...nudge(catchPt, int ? 0 : 1.1, 0.5) })

  const ball: WP[] = [{ t: 0, x: los, y: MID_Y }, { t: 0.06, ...posAt(p.qb, 0.06) }, ...shadow(p.qb, 0.06, throwT).slice(1), { t: catchT, ...catchPt }]
  const holders: PlayAnim['holders'] = [{ t: 0, key: null }, { t: 0.06, key: 'qb' }, { t: throwT, key: null }]
  const flights = [{ t0: throwT, t1: catchT, height: Math.min(1, 0.35 + depth / 40) }]

  if (inc) {
    // Off the fingertips: the ball falls past the target.
    ball.push({ t: catchT + 0.08, x: catchPt.x + 2, y: clampY(catchPt.y + (hash(seed) - 0.5) * 3) })
    for (const k of [...OFF_KEYS, ...DEF_KEYS]) if (!p[k].some((w) => w.t > catchT)) p[k].push({ t: catchT + 0.12, ...posAt(p[k], catchT) })
    return finish(f, p, { duration: 2400, ball, holders, flights })
  }
  if (int) {
    // Picked off and returned toward the other end.
    const spotX = changeSpot(play, ctx.next) ?? catchPt.x - 8
    p[near].push({ t: 1, x: clampX(Math.min(spotX, catchPt.x)), y: clampY(catchPt.y + (MID_Y - catchPt.y) * 0.4) })
    pursue(p, OFF_KEYS, catchT, posAt(p[near], 1), 1, seed)
    return finish(f, p, {
      duration: 3000,
      ball: [...ball, ...shadow(p[near], catchT).slice(1)],
      holders: [...holders, { t: catchT, key: near }],
      flights,
    })
  }
  // Complete: the catch, then the run after it, turning upfield.
  const endX = clampX(Math.max(catchPt.x, 10 + play.endYard))
  const yac = endX - catchPt.x
  const endY = clampY(catchPt.y + (MID_Y - catchPt.y) * (yac > 8 ? 0.35 : 0.12) + (hash(seed + 8) - 0.5) * 4)
  if (yac > 6) p[tgt].push({ t: catchT + (1 - catchT) * 0.4, x: catchPt.x + yac * 0.35, y: clampY(catchPt.y + (endY - catchPt.y) * 0.2) })
  p[tgt].push({ t: 1, x: endX, y: endY })
  // Defenders' break was a near miss; everyone pursues the catch-and-run.
  if (p[near].length && p[near][p[near].length - 1].t === catchT) p[near][p[near].length - 1] = { t: catchT, ...nudge(catchPt, 1.6, 0.6) }
  pursue(p, DEF_KEYS, catchT, { x: endX + 0.8, y: endY }, 1, seed)
  return finish(f, p, {
    duration: yac > 15 ? 3300 : 2800,
    ball: [...ball, ...shadow(p[tgt], catchT).slice(1)],
    holders: [...holders, { t: catchT, key: tgt }],
    flights,
  })
}

function nudge(pt: { x: number; y: number }, dx: number, dy: number) {
  return { x: clampX(pt.x + dx), y: clampY(pt.y + dy) }
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
  ;['cb0', 'cb1', 's0', 's1', 'lb0', 'lb1', 'lb2'].forEach((k) => p[k].push({ t: 0.6, x: posAt(p[k], 0).x + 3, y: posAt(p[k], 0).y }))
  return finish(f, p, {
    duration: 2200,
    ball: [{ t: 0, x: los, y: MID_Y }, { t: 0.06, ...posAt(p.qb, 0.06) }, ...shadow(p.qb, 0.06, 1).slice(1)],
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
  return finish(f, p, {
    duration: 3000,
    ball: [{ t: 0, x: los, y: MID_Y }, { t: 0.08, x: f.qb.x, y: MID_Y }, { t: kickT, x: f.qb.x + 1, y: MID_Y }, { t: landT, x: landX, y: landY }, ...shadow(p.s0, landT).slice(1)],
    holders: [{ t: 0, key: null }, { t: 0.08, key: 'qb' }, { t: kickT, key: null }, { t: landT, key: 's0' }],
    flights: [{ t0: kickT, t1: landT, height: 1 }],
  })
}

function buildKick(play: Play): PlayAnim {
  const los = 10 + play.startYard
  const f = formation(los)
  f.qb = { ...f.qb, x: los - 7, role: 'H' }
  f.rb = { ...f.rb, x: los - 9.5, y: MID_Y - 2, role: 'K' }
  const p = startPaths(f)
  const good = /good/.test(play.result) && !/no good|MISSED/i.test(play.result)
  const seed = play.n * 23 + play.startYard
  const missY = MID_Y + (hash(seed) < 0.5 ? -1 : 1) * (4 + hash(seed + 1) * 3)
  p.rb.push({ t: 0.18, x: los - 7.5, y: MID_Y - 0.5 })
  for (let i = 0; i < 4; i++) p[`dl${i}`].push({ t: 0.3, x: los, y: f[`dl${i}`].y })
  return finish(f, p, {
    duration: 2000,
    ball: [{ t: 0, x: los, y: MID_Y }, { t: 0.1, x: los - 7, y: MID_Y }, { t: 0.2, x: los - 7, y: MID_Y }, { t: 0.85, x: 116, y: good ? MID_Y : missY }],
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
  return finish(f, p, {
    duration: 2400,
    ball: [{ t: 0, x: kickX, y: MID_Y }, { t: 0.12, x: kickX, y: MID_Y }, { t: 0.55, x: catchX, y: MID_Y }, ...shadow(p.rb, 0.55).slice(1)],
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
  return finish(f, p, {
    duration: 1600,
    ball: [{ t: 0, x: los, y: MID_Y }, { t: 0.45, x: los, y: MID_Y }, { t: 1, x: 10 + play.endYard, y: MID_Y }],
    holders: [{ t: 0, key: null }],
    flights: [],
    flag: { t: 0.25, x: los + (play.yards > 0 ? 2 : -2), y: MID_Y + 3 },
  })
}

function buildStatic(play: Play): PlayAnim {
  const los = 10 + play.startYard
  const f = formation(los)
  return finish(f, startPaths(f, 1), { duration: 400, ball: [{ t: 0, x: los, y: MID_Y }], holders: [{ t: 0, key: null }], flights: [] })
}

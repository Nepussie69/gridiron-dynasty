// ─────────────────────────────────────────────────────────────────────────────
// Read visuals (backlog 303-309; J10a fields). Presentation only — no engine
// call changes a result, an end spot or a credited player.
//
//   1. progression: the QB's eyes (head + shoulders in 2.5D, the cone, the
//      top-down shoulder bar) go through his designed reads in order and land
//      on the read the engine recorded (Play.readNo), at a pace from his own
//      read speed (vision.qbReach: AWR + experience; NFL ~0.6 s per extra read,
//      FTN 2022-25: R1 time-to-throw median 2.3 s, R2+ 2.9 s).
//   2. checkdown (Play.checkdown): the eyes work the downfield reads, then come
//      off them to the back / tight end underneath — a short, late look.
//   3. eye jump (Play.eyeJumpId): the QB stares the target down, the covering
//      defender reads his eyes (facing the QB) and breaks on the route before
//      the throw, arriving at the catch point for the pick / break-up.
//   4. placement (Play.ballOffsetYd): the ball arrives that far (3-D) from the
//      receiver's ideal spot — high / low / behind / ahead — and the catch pose
//      matches (reach, scoop, high point, back-shoulder turn, dive, contested).
//   5. pressure (user 2026-10-12): the drawn cone starts at the QB's clean-
//      pocket width at the snap and narrows as the rusher closes, to exactly the
//      recorded Play.coneDeg at the release; the placement circle grows to match.
//   6. audibles (J13, not merged): `audibleHook` is the only hook.
//
// Hooks (one call site each): playAnim.buildPlayAnim -> applyReadPaths (paths,
// ball), playAnim.buildPass (INT branch) -> eyeJumpPicker, animData.presentAnim
// -> applyReadPresentation (facing, poses, ball height), visionCone.ts (cone /
// circle) and MatchView (top-down QbReadsSvg). The plan rides on the anim
// (`anim.reads`) so every view draws the same schedule.
// ─────────────────────────────────────────────────────────────────────────────
import type { Play } from '../../game/engine/playsim'
import type { Player } from '../../game/types'
import type { WP } from '../../game/data/routes'
import type { AnimContext, PlayAnim } from '../playAnim'
import { playbookPlay } from '../../game/data/playbookData'
import { qbReach, readOrder, routeForCandidate, visionThrow, VISION } from '../../game/engine/vision'
import { effRating } from '../animRatings'
import { THROW_TIMING, type BallZKey, type BroadcastAnim, type FacingWindow, type PoseState, type PoseWindow } from './animData'
import { posAt } from './interp'

const MID_Y = 26.65
const SKILL = ['wr0', 'wr1', 'wr2', 'te', 'rb', 'fb']
/** Seconds a head turn between two reads takes (cone + top-down; the 2.5D body smooths its own). */
export const TURN_SEC = 0.16
/** Pressure samples (closing 0..1) are taken this often (seconds). */
const PRESS_DT = 0.05

export type ReadRole = 'read' | 'target' | 'checkdown'
export interface ReadLook { key: string; t0: number; t1: number; role: ReadRole }
export interface ReadJump {
  key: string
  /** When the QB's eyes settle on the target (he starts reading them). 0..1 */
  lookT: number
  /** He breaks on the route (before the release). */
  breakT: number
  arriveT: number
  x: number
  y: number
  reached: boolean
  /** He makes the pick (he is the drawn interceptor). */
  pick: boolean
}
export type PlaceClass = 'high' | 'low' | 'behind' | 'ahead'
export interface ReadPlace {
  cls: PlaceClass
  key: string
  /** The receiver's ideal spot at the catch (offense frame). */
  ix: number
  iy: number
  /** Ball arrival minus the ideal spot (yd; dz vs chest height 1.4). */
  dx: number
  dy: number
  dz: number
  offset: number
  /** |(dx,dy,dz)| == ballOffsetYd (false when a completion's offset is past any reach). */
  exact: boolean
  pose: PoseState
  contestKey: string | null
  dive: boolean
  /** Incompletion: within his reach (off his hands) rather than sailing past. */
  hands: boolean
  /** A completion placed past his reach: he adjusts his line this far toward it at the catch (yd). */
  sx: number
  sy: number
}
export interface ReadAudible { t0: number; t1: number; key: string }
export interface ReadPlan {
  v: 1
  kind: 'pass' | 'sack'
  D: number
  snapT: number
  eyesT: number
  /** The release (pass) or the sack. */
  endT: number
  catchT: number | null
  target: string | null
  seq: string[]
  looks: ReadLook[]
  dwell: number
  reach: number
  readNo: number
  checkdown: boolean
  stare: boolean
  restKey: string | null
  aimX: number
  aimY: number
  coneStart: number
  coneEnd: number
  radStart: number
  radEnd: number
  pressured: boolean
  pressKey: string | null
  /** Closing 0..1 from snapT to endT (evenly spaced, last = 1). */
  press: number[]
  jump: ReadJump | null
  place: ReadPlace | null
  /** Checkdown to a back: he stays in protection until this time (0..1), then leaks out. */
  backRelT: number | null
  audible: ReadAudible | null
}

type Pt = { x: number; y: number }
type WithReads = { reads?: ReadPlan | null }
const clampN = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const clamp01 = (v: number) => clampN(v, 0, 1)
const sm = (u: number) => { const v = clamp01(u); return v * v * (3 - 2 * v) }
const hashU = (n: number) => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s) }
const wrapA = (a: number) => { let d = a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d }

function pathOf(anim: PlayAnim, key: string | null | undefined): WP[] | undefined {
  return key ? anim.actors.find((a) => a.key === key)?.path : undefined
}
function keyForId(anim: PlayAnim, ctx: AnimContext, id: string | undefined): string | null {
  if (!id || !ctx.actors) return null
  for (const a of anim.actors) if (ctx.actors.get(a.key)?.id === id) return a.key
  return null
}

/** J13 audibles are not merged yet: this is the one hook. When Play carries the
 *  pre-snap check, return its window (0..1, before the snap) and where he looks;
 *  the progression starts after it and the presentation pass draws it. */
export function audibleHook(_play: Play, _anim: PlayAnim): ReadAudible | null {
  return null
}

// ── the plan ─────────────────────────────────────────────────────────────────

/** The read plan for a pass / sack (null for anything else). Pure and deterministic. */
export function computeReadPlan(anim: PlayAnim, play: Play, ctx: AnimContext = {}): ReadPlan | null {
  if (play.type !== 'pass' || play.spike || play.kneel) return null
  const qbPath = pathOf(anim, 'qb')
  if (!qbPath || qbPath.length < 2) return null
  const D = Math.max(0.05, (anim.duration || 0) / 1000)
  const ev = anim.events ?? []
  const sack = play.result.startsWith('Sack')
  const snapT = ev.find((e) => e.kind === 'snap')?.t ?? clamp01(0.14 / D)
  const f = anim.flights[0]
  let endT: number
  let catchT: number | null = null
  let target: string | null = null
  if (sack) {
    const s = ev.find((e) => e.kind === 'sack')
    if (!s) return null
    endT = s.t
  } else {
    const th = ev.find((e) => e.kind === 'throw')
    if (!f || !th) return null
    endT = f.t0
    catchT = f.t1
    target = th.keys[1] ?? null
  }
  const S = (t: number) => t * D
  const N = (s: number) => s / D
  const snapS = S(snapT)
  const endS = S(endT)
  if (endS - snapS < 0.2) return null
  const los = 10 + (play.startYard ?? 0)
  const qb = ctx.actors?.get('qb')
  const audible = audibleHook(play, anim)

  // ── eyes up: the drop is done (or the fake), never before the J12 fooled look ──
  const qbSpd = (s: number) => {
    const a = posAt(qbPath, N(s - 0.05))
    const b = posAt(qbPath, N(s + 0.05))
    return Math.hypot(b.x - a.x, b.y - a.y) / 0.1
  }
  let dropEnd = snapS + 0.9
  for (let s = snapS + 0.3; s < endS; s += 0.04) if (qbSpd(s) < 1.4) { dropEnd = s; break }
  const pa = ev.find((e) => e.kind === 'playAction')
  let eyesS = Math.max(snapS + 0.25, dropEnd - 0.3, pa ? S(pa.t) + 0.4 : 0)
  if (!sack && play.qbFooled && f) {
    // Same window animData draws for the J12 fooled first look.
    const SNAP_T = clamp01(0.14 / D)
    const wind = THROW_TIMING[anim.throwStyle ?? 'normal'].wind
    const t0 = SNAP_T + 0.35 / D
    const t1 = Math.min(SNAP_T + 1.4 / D, f.t0 - wind / D - 0.5 / D)
    if ((t1 - t0) * D >= 0.3) eyesS = Math.max(eyesS, S(t1) + 0.05)
  }
  if (audible) eyesS = Math.max(eyesS, S(audible.t1))
  eyesS = clampN(eyesS, snapS + 0.1, Math.max(snapS + 0.1, endS - 0.3))

  // ── the designed read order (vision.readOrder over the concept's routes) ──
  const present = SKILL.filter((k) => anim.actors.some((a) => a.key === k))
  let wi = 0
  const routes = present.map((k) => (k.startsWith('wr') ? routeForCandidate(play.concept, 'WR', wi++) : k === 'te' ? routeForCandidate(play.concept, 'TE', 0) : k === 'rb' ? routeForCandidate(play.concept, 'RB', 0) : routeForCandidate(play.concept, 'FB', 0)))
  const rank = playbookPlay(play.concept) ? readOrder(play.concept, routes) : present.map((_, i) => i + 1)
  const rankOf = (k: string) => rank[present.indexOf(k)] ?? 9
  // Route runners only (a back / tight end kept in to block is not a read).
  const runner = (k: string) => {
    const p = pathOf(anim, k)
    if (!p) return false
    const a = posAt(p, snapT)
    const b = posAt(p, endT)
    return Math.hypot(b.x - a.x, b.y - a.y) >= 3.5
  }
  const others = present.filter((k) => k !== target && runner(k)).sort((a, b) => rankOf(a) - rankOf(b) || present.indexOf(a) - present.indexOf(b))
  const readNo = clampN(Math.round(play.readNo ?? 1), 1, 6)
  const checkdown = !sack && !!play.checkdown
  const stare = !sack && !!play.eyeJumpId
  const depth = play.passConceptDepth ?? play.passDepth ?? 10
  const reach = qb ? qbReach(qb, depth, !!(play.disguised && play.qbFooled)) : VISION.readBase
  // Per-read dwell from his read speed: 0.6 s at the league read reach, faster for a quick reader.
  const dwell = clampN(0.3 + (0.3 * VISION.readBase) / Math.max(0.6, reach), 0.32, 0.85)
  let pre: string[]
  if (sack) pre = others.slice(0, Math.max(1, Math.min(others.length, Math.max(2, Math.ceil(reach) + 1))))
  else if (checkdown) {
    const deep = others.filter((k) => posAt(pathOf(anim, k)!, endT).x - los >= 5)
    pre = (deep.length ? deep : others).slice(0, Math.max(1, Math.min(2, Math.round(reach) + 1)))
  } else pre = others.slice(0, readNo - 1)
  const seq = target ? [...pre, target] : pre

  // ── the schedule (seconds), then 0..1 ──
  const looks: ReadLook[] = []
  if (sack) {
    let s = eyesS
    let i = 0
    while (pre.length && s < endS - 0.05) {
      const d = dwell * (i % pre.length + 1 > reach ? 1.2 : 1)
      const e = Math.min(endS, s + d)
      looks.push({ key: pre[i % pre.length], t0: N(s), t1: N(e), role: 'read' })
      s = e
      i++
    }
  } else if (target) {
    const ds = pre.map((_, i) => dwell * (i + 1 > reach ? 1.2 : 1) * (stare ? 1.15 : 1))
    const tMin = stare ? 0.9 : checkdown ? 0.3 : 0.4
    const tMax = stare ? 1.6 : checkdown ? 0.5 : 0.75
    const sum = () => ds.reduce((a, b) => a + b, 0)
    let start = eyesS
    let tg = tMin
    if (sum() + tg > endS - start) start = Math.max(snapS + 0.1, endS - sum() - tg)
    const avail = endS - start
    if (sum() + tg > avail) {
      const k = sum() > 0 ? Math.max(0, (avail - tg) / sum()) : 1
      for (let i = 0; i < ds.length; i++) ds[i] = Math.max(0.16, ds[i] * k)
      if (sum() + tg > avail) tg = Math.max(0.2, avail - sum())
      if (sum() + tg > avail && ds.length) ds.fill(Math.max(0.06, (avail - tg) / ds.length))
    } else tg = Math.min(tMax, avail - sum())
    let s = endS - tg - sum()
    pre.forEach((k, i) => {
      looks.push({ key: k, t0: N(s), t1: N(s + ds[i]), role: 'read' })
      s += ds[i]
    })
    looks.push({ key: target, t0: N(endS - tg), t1: endT, role: checkdown ? 'checkdown' : 'target' })
  }
  // Before the first read the eyes sit on the deep middle (the safety he keys).
  const safeties = ['s0', 's1'].filter((k) => pathOf(anim, k))
  const restKey = safeties.reduce<string | null>((a, k) => (!a || posAt(pathOf(anim, k)!, endT).x > posAt(pathOf(anim, a)!, endT).x ? k : a), null)

  // ── pressure: how far the rusher has closed (0 at the snap, 1 at release / sack) ──
  const sackEv = sack ? ev.find((e) => e.kind === 'sack') : undefined
  const pressKey = (sack ? (sackEv?.keys[0] ?? keyForId(anim, ctx, play.sackId)) : keyForId(anim, ctx, play.pressureId)) ?? null
  const defs = anim.actors.filter((a) => a.side === 'def')
  const qbDist = (s: number) => {
    const q = posAt(qbPath, N(s))
    const one = (p: WP[]) => { const r = posAt(p, N(s)); return Math.hypot(r.x - q.x, r.y - q.y) }
    const pp = pathOf(anim, pressKey)
    if (pp) return one(pp)
    let best = Infinity
    for (const d of defs) best = Math.min(best, one(d.path))
    return best
  }
  const nP = Math.max(2, Math.ceil((endS - snapS) / PRESS_DT) + 1)
  const d0 = qbDist(snapS + 0.1)
  const dR = qbDist(endS)
  const press: number[] = []
  let run = 0
  for (let i = 0; i < nP; i++) {
    const s = snapS + ((endS - snapS) * i) / (nP - 1)
    const raw = d0 - dR >= 0.75 ? (d0 - qbDist(s)) / (d0 - dR) : (s - snapS) / (endS - snapS)
    run = Math.max(run, clamp01(raw))
    press.push(i === nP - 1 ? 1 : i === 0 ? 0 : run)
  }

  // ── cone width / circle radius at the snap (clean pocket) and at the release ──
  const fat = qb ? (ctx.fat?.get(qb.id) ?? 0) : 0
  const clean = qb ? visionThrow(qb, depth, readNo, null, 0, fat, 0, 0.5, 0) : null
  const coneEnd = play.coneDeg ?? clean?.coneDeg ?? VISION.coneBase
  const radEnd = play.placeRadiusYd ?? clean?.placeRadiusYd ?? VISION.radiusBase
  const wClean = clean?.coneDeg ?? coneEnd
  const pType = sack ? 'sack' : play.pressureType
  const pressured = sack || !!play.pressure || !!play.pressureType
  // The engine's pressure term is a few degrees until J10b: on a pressured snap the drawn
  // start is held at least this far above the recorded cone so the squeeze reads.
  const floorW = !pressured ? 0 : pType === 'sack' || pType === 'hit' ? 12 : 9
  const coneStart = Math.min(VISION.coneMax + 15, Math.max(wClean, coneEnd + floorW))
  // Backlog 381: pressure takes a share (`shrink`) of the clean cone and widens the circle by shrink × radiusPressW.
  const shrink = wClean > 0 ? Math.max(0, 1 - coneEnd / wClean) : 0
  const rClean = Math.max(VISION.radiusMin, radEnd - shrink * VISION.radiusPressW)
  const floorR = !pressured ? 0 : pType === 'sack' || pType === 'hit' ? 0.45 : 0.35
  const radStart = Math.max(0.25, Math.min(rClean, radEnd - floorR))

  const plan: ReadPlan = {
    v: 1, kind: sack ? 'sack' : 'pass', D, snapT, eyesT: N(eyesS), endT, catchT, target, seq, looks,
    dwell, reach, readNo, checkdown, stare, restKey,
    aimX: 0, aimY: 0, coneStart, coneEnd, radStart, radEnd, pressured, pressKey, press,
    jump: null, place: null, backRelT: null, audible,
  }
  if (!sack && f && catchT != null) {
    const c = posAt(anim.ball, catchT)
    plan.aimX = c.x
    plan.aimY = c.y
    plan.place = placement(anim, play, ctx, plan)
    if (plan.place) {
      plan.aimX = plan.place.ix + plan.place.dx
      plan.aimY = plan.place.iy + plan.place.dy
    }
    plan.jump = jumpPlan(anim, play, ctx, plan)
  }
  return plan
}

/** The plan carried on an anim (applyReadPaths attached it), else computed now. */
export function readPlanOf(anim: PlayAnim, play: Play, qb?: Player): ReadPlan | null {
  const r = (anim as PlayAnim & WithReads).reads
  if (r !== undefined) return r
  return computeReadPlan(anim, play, qb ? { actors: new Map([['qb', qb]]) } : {})
}

// ── 4. placement ─────────────────────────────────────────────────────────────

function placement(anim: PlayAnim, play: Play, ctx: AnimContext, plan: ReadPlan): ReadPlace | null {
  const o = play.ballOffsetYd
  const key = plan.target
  const C = plan.catchT
  if (o == null || !key || C == null || play.result.startsWith('Interception')) return null
  const tp = pathOf(anim, key)
  if (!tp) return null
  const D = plan.D
  const inc = play.result === 'Incomplete'
  const ideal = posAt(tp, C)
  const prev = posAt(tp, Math.max(0, C - 0.1 / D))
  const q = posAt(pathOf(anim, 'qb')!, plan.endT)
  let fx = ideal.x - prev.x
  let fy = ideal.y - prev.y
  let fl = Math.hypot(fx, fy)
  if (fl < 0.1) { fx = ideal.x - q.x; fy = ideal.y - q.y; fl = Math.hypot(fx, fy) || 1 }
  fx /= fl
  fy /= fl
  const lx = -fy
  const ly = fx
  const h = hashU((play.n ?? 0) * 3.17 + (play.startYard ?? 0) * 0.71)
  const h2 = hashU((play.n ?? 0) * 5.93 + 1.3)
  const backShoulder = anim.catchRoute === 'fade' && play.featured === 'fade'
  const cls: PlaceClass = backShoulder ? 'behind' : h < 0.3 ? 'high' : h < 0.55 ? 'low' : h < 0.8 ? 'behind' : 'ahead'
  // Ends at the catch: no run after it (a dive is only drawn when nothing follows).
  const last = tp[tp.length - 1]?.t ?? C
  const ends = !inc && (last - C) * D <= 0.45
  const zLo = -1.25
  const zHi = inc ? 2.4 : 1.3
  // Arms reach 1.6 yd; a dive (nothing after it) 2.8; otherwise he adjusts his line up to
  // SHIFT_MAX toward the ball over the last beat and reaches the rest.
  // (animflow r8: 2.6 yd - the engine's misses run past 3.3 yd on ~7% of completions; a receiver chasing a
  // ball that far off adjusts his line by two or three yards, not one)
  const SHIFT_MAX = 2.6
  const reachH = inc ? Infinity : ends ? 2.8 : 1.6 + SHIFT_MAX
  let dz = clampN(cls === 'high' ? 0.85 * o : cls === 'low' ? -0.8 * o : cls === 'behind' ? 0.25 * o : 0.1 * o, zLo, zHi)
  let hz = Math.sqrt(Math.max(0, o * o - dz * dz))
  if (hz > reachH) {
    hz = reachH
    const need = Math.sqrt(Math.max(0, o * o - hz * hz))
    dz = dz >= 0 ? Math.min(need, zHi) : -Math.min(need, -zLo)
  }
  const exact = Math.abs(Math.hypot(hz, dz) - o) < 0.02
  const lat = (h2 - 0.5) * 0.6
  let ux = cls === 'behind' ? -fx : cls === 'ahead' ? fx : fx * 0.4
  let uy = cls === 'behind' ? -fy : cls === 'ahead' ? fy : fy * 0.4
  ux += lx * lat
  uy += ly * lat
  const ul = Math.hypot(ux, uy) || 1
  let dx = (ux / ul) * hz
  let dy = (uy / ul) * hz
  // Keep the spot on the field (mirror the part that would leave it).
  if (ideal.y + dy < 0.6 || ideal.y + dy > 52.7) dy = -dy
  if (ideal.x + dx < 0.5 || ideal.x + dx > 119.5) dx = -dx
  const shift = !inc && !ends && hz > 1.6 ? Math.min(SHIFT_MAX, hz - 1.6) : 0
  const coverK = keyForId(anim, ctx, play.coverId)
  const cp = pathOf(anim, coverK)
  const contest = !!cp && !play.eyeJumpId && (() => { const d = posAt(cp, C); return Math.hypot(d.x - ideal.x, d.y - ideal.y) <= 1.3 })()
  let pose: PoseState
  // Wide of him and nothing after it: he lays out for it (a high ball is a leap, not a dive).
  let dive = (inc || ends) && hz > 1.6 && cls !== 'high'
  if (dive) pose = 'dive'
  else if (cls === 'high') pose = dz >= 0.45 ? 'catchHigh' : 'catch'
  else if (cls === 'low') { dive = dz <= -0.9 && (inc || ends); pose = dive ? 'dive' : 'catchLow' }
  else if (cls === 'behind') pose = 'catchBack'
  else { dive = hz >= 1.25 && (inc || ends); pose = dive ? 'dive' : 'catchReach' }
  if (contest && !dive) pose = 'catchHigh'
  return {
    cls, key, ix: ideal.x, iy: ideal.y, dx, dy, dz, offset: o, exact, pose,
    contestKey: contest ? coverK : null, dive, hands: hz <= 1.2 && dz >= -1.0 && dz <= 1.1,
    sx: shift ? (dx / hz) * shift : 0, sy: shift ? (dy / hz) * shift : 0,
  }
}

// ── 3. eye jump ──────────────────────────────────────────────────────────────

function jumpPlan(anim: PlayAnim, play: Play, ctx: AnimContext, plan: ReadPlan): ReadJump | null {
  const J = keyForId(anim, ctx, play.eyeJumpId)
  const C = plan.catchT
  const jp = pathOf(anim, J)
  if (!J || !jp || C == null || !plan.target) return null
  if (anim.actors.find((a) => a.key === J)?.side !== 'def') return null
  const D = plan.D
  const int = play.result.startsWith('Interception')
  const picker = (anim.events ?? []).find((e) => e.kind === 'interception')?.keys[0]
  const pick = int && picker === J
  const tl = plan.looks.find((l) => l.role !== 'read') ?? plan.looks[plan.looks.length - 1]
  if (!tl) return null
  const pl = ctx.actors?.get(J)
  const react = clampN(0.45 - (effRating(pl, 'PRC', 70) + effRating(pl, 'AWR', 70) - 140) * 0.005, 0.22, 0.55)
  const R = plan.endT * D
  const Cs = C * D
  const ball = posAt(anim.ball, C)
  const rel = posAt(anim.ball, plan.endT)
  let bx = ball.x - rel.x
  let by = ball.y - rel.y
  const bl = Math.hypot(bx, by) || 1
  bx /= bl
  by /= bl
  let P: Pt
  if (pick) P = { x: ball.x, y: ball.y }
  else if (int) {
    const j = posAt(jp, C)
    const s = (j.x - ball.x) * -by + (j.y - ball.y) * bx >= 0 ? 1 : -1
    P = { x: ball.x - by * 0.9 * s, y: ball.y + bx * 0.9 * s }
  } else {
    const a = plan.place ? { x: plan.place.ix + plan.place.dx, y: plan.place.iy + plan.place.dy } : ball
    P = { x: a.x - bx * 0.55, y: a.y - by * 0.55 }
  }
  const vcap = J.startsWith('lb') ? 7.6 : J.startsWith('dl') ? 6.5 : 8.6
  let tB = Math.min(Math.max(tl.t0 * D + react, plan.snapT * D + 0.5), R - 0.12)
  for (let it = 0; it < 3; it++) {
    const p0 = posAt(jp, tB / D)
    const d = Math.hypot(P.x - p0.x, P.y - p0.y)
    if (d / Math.max(0.05, Cs - tB) <= vcap * 0.85) break
    tB = Math.max(tl.t0 * D + 0.12, plan.snapT * D + 0.3, Cs - d / (vcap * 0.85))
  }
  const p0 = posAt(jp, tB / D)
  const d = Math.hypot(P.x - p0.x, P.y - p0.y)
  const T = Math.max(0.05, Cs - tB)
  const reached = d / T <= vcap * 0.92
  // The drawn interceptor is always at the ball (the pick); anyone else gets as close as he can.
  if (!reached && !pick) {
    const k = (vcap * 0.92 * T) / d
    P = { x: p0.x + (P.x - p0.x) * k, y: p0.y + (P.y - p0.y) * k }
  }
  return { key: J, lookT: tl.t0, breakT: tB / D, arriveT: C, x: P.x, y: P.y, reached, pick }
}

/** buildPass (INT branch) hook: the defender who read the QB's eyes makes the pick
 *  when the sim credits him (intId) and he can get there; else null (nearest). */
export function eyeJumpPicker(play: Play, ctx: AnimContext, posBefore: (key: string) => Pt | null, catchPt: Pt): string | null {
  if (!play.eyeJumpId || play.eyeJumpId !== play.intId || !ctx.actors) return null
  for (const [k, p] of ctx.actors) {
    if (p.id !== play.eyeJumpId || !/^(cb|s|lb)/.test(k)) continue
    const q = posBefore(k)
    return q && Math.hypot(q.x - catchPt.x, q.y - catchPt.y) <= 8 ? k : null
  }
  return null
}

// ── the QB's look at time t (cone, top-down, checks) ─────────────────────────

function lookPoint(plan: ReadPlan, anim: PlayAnim, l: ReadLook, t: number): Pt {
  if (l.role !== 'read') return { x: plan.aimX, y: plan.aimY }
  const p = pathOf(anim, l.key)
  return p ? posAt(p, Math.min(t, plan.endT)) : { x: plan.aimX, y: plan.aimY }
}

function restPoint(plan: ReadPlan, anim: PlayAnim, t: number, q: Pt): Pt {
  const p = pathOf(anim, plan.restKey)
  if (p) return posAt(p, Math.min(t, plan.endT))
  return { x: q.x + 15, y: MID_Y }
}

/** The look in force at t (the last one before the first starts, null before it). */
export function lookAt(plan: ReadPlan, t: number): { look: ReadLook; i: number } | null {
  let out: { look: ReadLook; i: number } | null = null
  for (let i = 0; i < plan.looks.length; i++) if (t >= plan.looks[i].t0 - 1e-9) out = { look: plan.looks[i], i }
  return out
}

/** Where the QB looks at t (0..1): yaw (offense frame), the read key, distance. Head turns take TURN_SEC. */
export function qbLook(plan: ReadPlan, anim: PlayAnim, t: number): { yaw: number; key: string | null; role: ReadRole | 'rest'; dist: number; ox: number; oy: number; locked: boolean } {
  const qp = pathOf(anim, 'qb')!
  const tc = Math.min(t, plan.endT)
  const q = posAt(qp, tc)
  const yawTo = (p: Pt) => Math.atan2(p.y - q.y, p.x - q.x)
  const cur = lookAt(plan, tc)
  const restP = restPoint(plan, anim, tc, q)
  if (!cur) return { yaw: yawTo(restP), key: plan.restKey, role: 'rest', dist: Math.hypot(restP.x - q.x, restP.y - q.y), ox: q.x, oy: q.y, locked: false }
  const p = lookPoint(plan, anim, cur.look, tc)
  const prevP = cur.i === 0 ? restP : lookPoint(plan, anim, plan.looks[cur.i - 1], tc)
  const u = sm(((tc - cur.look.t0) * plan.D) / TURN_SEC)
  const y0 = yawTo(prevP)
  const yaw = y0 + wrapA(yawTo(p) - y0) * u
  return { yaw, key: cur.look.key, role: cur.look.role, dist: Math.hypot(p.x - q.x, p.y - q.y), ox: q.x, oy: q.y, locked: cur.look.role !== 'read' && u >= 1 }
}

/** Pressure closing (0..1) at t. */
export function pressAt(plan: ReadPlan, t: number): number {
  if (t <= plan.snapT) return 0
  if (t >= plan.endT) return 1
  const u = ((t - plan.snapT) / Math.max(1e-9, plan.endT - plan.snapT)) * (plan.press.length - 1)
  const i = Math.floor(u)
  const a = plan.press[i] ?? 1
  const b = plan.press[i + 1] ?? 1
  return a + (b - a) * (u - i)
}

/** Drawn cone width (degrees): clean pocket at the snap, exactly Play.coneDeg from the release on. */
export function coneWidthAt(plan: ReadPlan, t: number): number {
  const c = pressAt(plan, t)
  return c >= 1 ? plan.coneEnd : plan.coneEnd + (plan.coneStart - plan.coneEnd) * (1 - c)
}

/** Drawn placement-circle radius (yd): grows with the pressure to exactly placeRadiusYd at the release. */
export function radiusAt(plan: ReadPlan, t: number): number {
  const c = pressAt(plan, t)
  return c >= 1 ? plan.radEnd : plan.radEnd + (plan.radStart - plan.radEnd) * (1 - c)
}

// ── hook 1: paths + ball (raw PlayAnim, before presentAnim) ──────────────────

/** Attach the plan and draw the eye jump's break and the ball placement into the paths. */
export function applyReadPaths(anim: PlayAnim, play: Play, ctx: AnimContext = {}): PlayAnim {
  let plan: ReadPlan | null = null
  try {
    plan = computeReadPlan(anim, play, ctx)
  } catch {
    plan = null
  }
  if (!plan) return anim
  const out: PlayAnim & WithReads = { ...anim, reads: plan }
  const pl = plan.place
  if (pl && (pl.sx || pl.sy)) {
    // animflow 6c (J7, animresid): the man covering him moves with him. The receiver's line
    // adjust is a drawing of him closing on a ball placed off his line; the coverage man's
    // recorded separation (separationYd) is a bracket, so he takes the same displacement and the
    // separation at the catch (and all through the run) is the recorded one exactly.
    const covK = keyForId(anim, ctx, play.coverId)
    const move = (k: string) => k === pl.key || (!!covK && k === covK && k !== plan.jump?.key)
    if (out.actors.some((a) => move(a.key))) out.actors = out.actors.map((a) => (move(a.key) ? { ...a, path: adjustPath(a.path, plan) } : a))
  }
  if (pl) out.ball = placeBall(out, play, plan)
  if (plan.jump) {
    const jk = plan.jump.key
    out.actors = out.actors.map((a) => (a.key === jk ? { ...a, path: jumpPath(a.path, plan!, anim, play) } : a))
    if (plan.jump.pick && plan.catchT != null) {
      // The ball rides with the man who picked it off.
      const C = plan.catchT
      const np = out.actors.find((a) => a.key === jk)!.path
      out.ball = [...out.ball.filter((w) => w.t <= C + 1e-9), ...np.filter((w) => w.t > C + 1e-9).map((w) => ({ t: w.t, x: w.x, y: w.y }))]
    }
  }
  // (not on play action: the run fake is his delay)
  if (plan.checkdown && plan.target && /^(rb|fb)$/.test(plan.target) && !(anim.events ?? []).some((e) => e.kind === 'playAction')) {
    const bk = plan.target
    const src = out.actors.find((a) => a.key === bk)
    const np = src ? backCheckPath(src.path, plan) : null
    if (np) out.actors = out.actors.map((a) => (a.key === bk ? { ...a, path: np } : a))
  }
  return out
}

/** Checkdown to a back: he steps up and stays in protection (eyes on the rush) while the
 *  QB works downfield, then leaks out late to the same catch spot at the same moment. */
function backCheckPath(path: WP[], plan: ReadPlan): WP[] | null {
  const D = plan.D
  const C = plan.catchT
  if (C == null) return null
  const s0 = posAt(path, plan.snapT)
  const cp = posAt(path, C)
  const cm = posAt(path, Math.max(0, C - 0.06 / D))
  const vC = { x: (cp.x - cm.x) / 0.06, y: (cp.y - cm.y) / 0.06 }
  const B = { x: s0.x + 0.9, y: s0.y }
  const d = Math.hypot(cp.x - B.x, cp.y - B.y)
  let T = 0.35 + d / 6
  const snapS = plan.snapT * D
  const Cs = C * D
  let relS = Math.max(snapS + 0.55, Cs - T)
  // Already slow to leave on his own (a chip / a late release): leave it.
  const own = (() => { for (let s = snapS + 0.1; s < Cs; s += 0.04) if (Math.hypot(posAt(path, s / D).x - s0.x, posAt(path, s / D).y - s0.y) > 1.6) return s; return Cs })()
  if (relS - snapS < 0.5 || own >= relS - 0.1) {
    // (he leaves late on his own path - the routes are run at speed now, so this is the usual case:
    // the path stays, and he is in protection, set and square to the rush, until he leaves it)
    if (relS - snapS >= 0.5 && own - snapS >= 0.3 && own < Cs - 0.4) plan.backRelT = own / D
    return null
  }
  T = Cs - relS
  const herm = (s: number): Pt => {
    const s2 = s * s
    const s3 = s2 * s
    const h01 = -2 * s3 + 3 * s2
    const h11 = s3 - s2
    return { x: B.x + (cp.x - B.x) * h01 + h11 * T * vC.x, y: B.y + (cp.y - B.y) * h01 + h11 * T * vC.y }
  }
  let vmax = 0
  for (let i = 1; i <= 20; i++) { const a = herm((i - 1) / 20); const b = herm(i / 20); vmax = Math.max(vmax, Math.hypot(b.x - a.x, b.y - a.y) / (T / 20)) }
  if (vmax > 9.2) return null
  const out: WP[] = path.filter((w) => w.t <= plan.snapT + 1e-9).map((w) => ({ ...w }))
  const set = Math.min(relS, snapS + 0.5)
  out.push({ t: set / D, x: B.x, y: B.y })
  // Feet alive in his set (a small shuffle), then the release.
  for (let s = set + 0.25; s < relS - 0.05; s += 0.25) out.push({ t: s / D, x: B.x + 0.12 * Math.sin(s * 9), y: B.y + 0.18 * Math.sin(s * 5.3) })
  out.push({ t: relS / D, x: B.x, y: B.y })
  const n = Math.max(2, Math.ceil(T / 0.04))
  for (let i = 1; i <= n; i++) out.push({ t: (relS + (T * i) / n) / D, ...herm(i / n) })
  out[out.length - 1].t = C
  for (const w of path) if (w.t > C + 1e-9) out.push({ ...w })
  plan.backRelT = relS / D
  return out
}

/** A completion placed past his reach: his line bends toward the ball over the last 0.45 s
 *  and, after the catch, drifts back onto the recorded line over the rest of the run
 *  (the catch time, the run after it and the end spot unchanged). */
/** Seconds each way of the line adjust: 0.45 s, longer for a big shift so the lateral speed it adds stays <= ~4.3 yd/s (a 2.6 yd shift in 0.45 s added 8+ yd/s: a 13 yd/s spike at the catch). */
const adjustSec = (pl: { sx: number; sy: number }): number => clampN((1.5 * Math.hypot(pl.sx, pl.sy)) / 4.3, 0.45, 0.9)

function adjustPath(path: WP[], plan: ReadPlan): WP[] {
  const pl = plan.place!
  const C = plan.catchT!
  const W = adjustSec(pl) / plan.D
  const a = Math.max(0, C - W)
  // animflow r7a (animresid): after the catch he eases back onto his recorded line over the WHOLE
  // run to the whistle, not over a 0.45 s beat. Springing back right after the catch put a second
  // lateral sign change inside every shifted catch-and-run (an out-and-back bump in the carry
  // window) — only a 2.6 yd shift, but it made the carrier weave. He holds the adjusted line
  // through the run and drifts back onto it, so the end spot and the tackle are untouched.
  const b = Math.min(1, Math.max(C + W, path[path.length - 1]?.t ?? C))
  const out: WP[] = path.filter((w) => w.t < a - 1e-9).map((w) => ({ ...w }))
  const n = Math.max(4, Math.ceil(((b - a) * plan.D) / 0.04))
  for (let i = 0; i <= n; i++) {
    const t = a + ((b - a) * i) / n
    const p = posAt(path, t)
    const u = t <= C ? sm((t - a) / Math.max(1e-9, C - a)) : Math.max(0, 1 - (t - C) / Math.max(1e-9, b - C))
    out.push({ t, x: p.x + pl.sx * u, y: p.y + pl.sy * u })
  }
  for (const w of path) if (w.t > b + 1e-9) out.push({ ...w })
  return out
}

function placeBall(anim: PlayAnim, play: Play, plan: ReadPlan): WP[] {
  const pl = plan.place!
  const C = plan.catchT!
  const D = plan.D
  const ball = anim.ball.map((w) => ({ ...w }))
  const iC = ball.findIndex((w) => Math.abs(w.t - C) < 1e-9)
  if (iC < 0) return anim.ball
  const fx = (x: number) => clampN(x, 0.5, 119.5)
  const fy = (y: number) => clampN(y, 0.6, 52.7)
  const arr = { x: fx(pl.ix + pl.dx), y: fy(pl.iy + pl.dy) }
  const shiftX = arr.x - ball[iC].x
  const shiftY = arr.y - ball[iC].y
  // The flight bends to the placed spot (half the shift at mid-flight).
  for (let i = 0; i < iC; i++) {
    if (ball[i].t > plan.endT + 1e-9) {
      const u = (ball[i].t - plan.endT) / Math.max(1e-9, C - plan.endT)
      ball[i].x = fx(ball[i].x + shiftX * u)
      ball[i].y = fy(ball[i].y + shiftY * u)
    }
  }
  ball[iC] = { ...ball[iC], x: arr.x, y: arr.y }
  const inc = play.result === 'Incomplete'
  const rel = posAt(anim.ball, plan.endT)
  let bx = arr.x - rel.x
  let by = arr.y - rel.y
  const bl = Math.hypot(bx, by) || 1
  bx /= bl
  by /= bl
  if (!inc) {
    // Pulled into his hands over 0.1 s, then carried (the shadow of his path).
    const tp = pathOf(anim, pl.key)!
    const t2 = Math.min(1, C + 0.1 / D)
    const tEnd = pl.sx || pl.sy ? Math.min(1, C + (adjustSec(pl) + 0.01) / D) : t2
    const mid: WP[] = []
    for (let t = t2; t <= tEnd + 1e-9; t += 0.04 / D) { const p = posAt(tp, t); mid.push({ t, x: p.x, y: p.y }) }
    const after = ball.slice(iC + 1).filter((w) => w.t > (mid[mid.length - 1]?.t ?? t2) + 1e-9)
    return [...ball.slice(0, iC + 1), ...mid, ...after]
  }
  const k = iC + 1
  if (k < ball.length) {
    const pbu = !!plan.jump && !plan.jump.pick
    if (pbu) {
      // Knocked away: up and off to the side the defender came from.
      const j = { x: plan.jump!.x, y: plan.jump!.y }
      const s = (j.x - arr.x) * -by + (j.y - arr.y) * bx >= 0 ? -1 : 1
      ball[k] = { ...ball[k], x: fx(arr.x + bx * 0.5 - by * 1.4 * s), y: fy(arr.y + by * 0.5 + bx * 1.4 * s) }
    } else if (pl.hands) {
      ball[k] = { ...ball[k], x: fx(ball[k].x + shiftX), y: fy(ball[k].y + shiftY) }
    } else {
      ball[k] = { ...ball[k], x: fx(arr.x + bx * 2.4), y: fy(arr.y + by * 2.4) }
    }
  }
  return ball
}

function jumpPath(path: WP[], plan: ReadPlan, anim: PlayAnim, play: Play): WP[] {
  const j = plan.jump!
  const D = plan.D
  const tB = j.breakT
  const C = j.arriveT
  const T = Math.max(0.05, (C - tB) * D)
  const p0 = posAt(path, tB)
  const pm = posAt(path, Math.max(0, tB - 0.06 / D))
  const v0 = { x: (p0.x - pm.x) / 0.06, y: (p0.y - pm.y) / 0.06 }
  const P = { x: j.x, y: j.y }
  const vcap = j.key.startsWith('lb') ? 7.6 : j.key.startsWith('dl') ? 6.5 : 8.6
  const herm = (va: Pt, vb: Pt, s: number): Pt => {
    const s2 = s * s
    const s3 = s2 * s
    const h00 = 2 * s3 - 3 * s2 + 1
    const h10 = s3 - 2 * s2 + s
    const h01 = -2 * s3 + 3 * s2
    const h11 = s3 - s2
    return { x: h00 * p0.x + h10 * T * va.x + h01 * P.x + h11 * T * vb.x, y: h00 * p0.y + h10 * T * va.y + h01 * P.y + h11 * T * vb.y }
  }
  const chord = { x: (P.x - p0.x) / T, y: (P.y - p0.y) / T }
  // The pick: he gathers the ball in (slowing into it), then his return starts.
  const vEnd = j.pick ? { x: chord.x * 0.35, y: chord.y * 0.35 } : { x: chord.x * 1.15, y: chord.y * 1.15 }
  const maxV = (va: Pt): number => {
    let m = 0
    let prev = p0
    for (let i = 1; i <= 20; i++) {
      const q = herm(va, vEnd, i / 20)
      m = Math.max(m, Math.hypot(q.x - prev.x, q.y - prev.y) / (T / 20))
      prev = q
    }
    return m
  }
  // His momentum carries into the break; a plant (no carry-over) when it would overrun his speed.
  const va = maxV(v0) <= vcap * 1.05 ? v0 : { x: 0, y: 0 }
  const out: WP[] = path.filter((w) => w.t < tB - 1e-9).map((w) => ({ ...w }))
  out.push({ t: tB, x: p0.x, y: p0.y })
  const n = Math.max(2, Math.ceil(T / 0.04))
  for (let i = 1; i <= n; i++) {
    const q = herm(va, vEnd, i / n)
    out.push({ t: tB + (C - tB) * (i / n), x: q.x, y: q.y })
  }
  const orig = posAt(path, C)
  const after = path.filter((w) => w.t > C + 1e-9)
  if (j.pick) {
    // The builder's run to the ball may land after the catch: hold the ball at the spot until
    // his return leaves from it (same return, same end spot).
    const land = after.find((w) => Math.hypot(w.x - P.x, w.y - P.y) < 0.3)
    if (land) {
      if (land.t > C + 1e-6) out.push({ t: land.t, x: P.x, y: P.y })
      for (const w of after) if (w.t > land.t + 1e-9) out.push({ ...w })
    } else {
      const dx = P.x - orig.x
      const dy = P.y - orig.y
      for (const w of after) {
        const u = clamp01(((w.t - C) * D) / 0.6)
        out.push({ t: w.t, x: w.x + dx * (1 - u), y: w.y + dy * (1 - u) })
      }
    }
  } else if (play.result === 'Incomplete') {
    // Through the ball and pulling up.
    const vl = Math.hypot(vEnd.x, vEnd.y) || 1
    const run = Math.min(0.9, vl * 0.18)
    const t2 = Math.min(1, C + 0.25 / D)
    if (t2 > C + 1e-6) out.push({ t: t2, x: clampN(P.x + (vEnd.x / vl) * run, 0.5, 119.5), y: clampN(P.y + (vEnd.y / vl) * run, 0.6, 52.7) })
    const last = out[out.length - 1]
    if (last.t < 1 - 1e-6 && after.length) out.push({ t: Math.max(last.t + 1e-4, after[after.length - 1].t), x: last.x, y: last.y })
  } else {
    // Beside the pick: the offset he made decays as the return starts.
    const dx = P.x - orig.x
    const dy = P.y - orig.y
    for (const w of after) {
      const u = clamp01(((w.t - C) * D) / 0.6)
      out.push({ t: w.t, x: w.x + dx * (1 - u), y: w.y + dy * (1 - u) })
    }
  }
  void anim
  return out
}

// ── hook 2: presentation (facing, poses, ball height) ────────────────────────

/** Replace the windows of `ws` inside [a, b] by `fill(t)` where it returns one (else keep). */
function spliceWindows<W extends { t0: number; t1: number }>(ws: W[], a: number, b: number, cuts: number[], fill: (mid: number) => W | null, same: (x: W, y: W) => boolean): W[] {
  if (b <= a || !ws.length) return ws
  const all = new Set<number>([a, b, ...cuts.filter((c) => c > a && c < b)])
  for (const w of ws) { if (w.t0 > a && w.t0 < b) all.add(w.t0); if (w.t1 > a && w.t1 < b) all.add(w.t1) }
  const pts = [...all].sort((x, y) => x - y)
  const orig = (t: number): W => ws.find((w) => t <= w.t1 + 1e-9) ?? ws[ws.length - 1]
  const out: W[] = []
  const push = (w: W) => {
    if (w.t1 - w.t0 <= 1e-9) return
    const l = out[out.length - 1]
    if (l && same(l, w) && Math.abs(l.t1 - w.t0) < 1e-9) l.t1 = w.t1
    else out.push(w)
  }
  for (const w of ws) if (w.t0 < a) push({ ...w, t1: Math.min(w.t1, a) })
  for (let i = 0; i < pts.length - 1; i++) {
    const m = (pts[i] + pts[i + 1]) / 2
    const w = fill(m) ?? orig(m)
    push({ ...w, t0: pts[i], t1: pts[i + 1] })
  }
  for (const w of ws) if (w.t1 > b) push({ ...w, t0: Math.max(w.t0, b) })
  return out
}

const sameFacing = (x: FacingWindow, y: FacingWindow) =>
  x.mode === y.mode && (x.mode !== 'actor' || (y.mode === 'actor' && x.key === y.key)) && (x.mode !== 'angle' || (y.mode === 'angle' && Math.abs(x.angle - y.angle) < 1e-6)) && x.mode !== 'spin'
const samePose = (x: PoseWindow, y: PoseWindow) => x.state === y.state
/** animflow r8: a man already in a tackle / fall / pile at `m` keeps it - a catch, lay-out or swat pose never overrides the tackle that ends the play. */
const TACKLING = new Set<PoseState>(['fall', 'down', 'tackleFall', 'tackleHit', 'tackleArm', 'tackle', 'dive', 'pushOut'])
const tackling = (base: PoseWindow[], m: number): boolean => TACKLING.has((base.find((w) => m <= w.t1 + 1e-9) ?? base[base.length - 1]).state)

/** presentAnim hook: the QB's head/shoulders through the reads, the eye-jumper's
 *  read of the QB, the catch / break-up poses, the placed ball's height. */
export function applyReadPresentation(banim: BroadcastAnim, play: Play, ctx: AnimContext = {}): BroadcastAnim {
  const plan = (banim as BroadcastAnim & WithReads).reads
  if (!plan) return banim
  void ctx
  const D = plan.D
  const facing = { ...banim.facing }
  const poses = { ...banim.poses }
  let ballZ = banim.ballZ
  const qp = pathOf(banim, 'qb')
  // 1. head + shoulders through the reads (not while he is running: the cone keeps them).
  if (qp && facing.qb && plan.looks.length) {
    const f = banim.flights[0]
    const lockT = plan.kind === 'pass' && f ? f.t0 - (THROW_TIMING[banim.throwStyle ?? 'normal'].wind + 0.45) / D : plan.endT - 0.25 / D
    const a = plan.looks[0].t0
    const b = Math.min(lockT, plan.endT)
    const fast = (t: number) => {
      const p0 = posAt(qp, t - 0.05 / D)
      const p1 = posAt(qp, t + 0.05 / D)
      return Math.hypot(p1.x - p0.x, p1.y - p0.y) / 0.1 > 2.6
    }
    const cuts: number[] = plan.looks.flatMap((l) => [l.t0, l.t1])
    for (let t = a; t < b; t += 0.04 / D) cuts.push(t)
    facing.qb = spliceWindows(facing.qb, a, b, cuts, (m) => {
      const l = lookAt(plan, m)
      if (!l || fast(m)) return null
      return { t0: m, t1: m, mode: 'actor', key: l.look.key } as FacingWindow
    }, sameFacing)
  }
  // 3. the eye-jumper reads the QB's eyes, then breaks (his run faces the break).
  const j = plan.jump
  if (j && facing[j.key]) {
    const a = Math.min(j.breakT, j.lookT + 0.08 / D)
    facing[j.key] = spliceWindows(facing[j.key], a, j.breakT, [], () => ({ t0: 0, t1: 0, mode: 'actor', key: 'qb' }) as FacingWindow, sameFacing)
    if (!j.pick && poses[j.key]) {
      const c = j.arriveT
      const jb = poses[j.key]
      poses[j.key] = spliceWindows(jb, Math.max(0, c - 0.16 / D), Math.min(1, c + 0.14 / D), [], (m) => (tackling(jb, m) ? null : ({ t0: 0, t1: 0, state: 'swat' }) as PoseWindow), samePose)
    }
  }
  // 4. the catch the placement asks for, and the defender contesting it.
  const pl = plan.place
  const C = plan.catchT
  if (pl && C != null && poses[pl.key]) {
    const t0 = Math.max(0, C - (pl.dive ? 0.2 : 0.14) / D)
    const t1 = pl.dive ? 1 : Math.min(1, C + 0.12 / D)
    // (a catch tackled on the spot: the catch / lay-out pose gives way to the fall - the receiver is
    // never still reaching or laid out as the tackle takes him down, nor at the end of the play)
    const base = poses[pl.key]
    poses[pl.key] = spliceWindows(base, t0, t1, [], (m) => (tackling(base, m) ? null : ({ t0: 0, t1: 0, state: pl.pose }) as PoseWindow), samePose)
    if (pl.cls === 'behind' && facing[pl.key]) {
      // The back-shoulder turn: he twists back to the ball as it comes in behind him.
      const ang = Math.atan2(posAt(banim.ball, plan.endT).y - pl.iy, posAt(banim.ball, plan.endT).x - pl.ix)
      facing[pl.key] = spliceWindows(facing[pl.key], Math.max(0, C - 0.4 / D), Math.min(1, C + 0.08 / D), [], () => ({ t0: 0, t1: 0, mode: 'angle', angle: ang }) as FacingWindow, sameFacing)
    }
    if (pl.contestKey && poses[pl.contestKey]) {
      const cb = poses[pl.contestKey]
      poses[pl.contestKey] = spliceWindows(cb, Math.max(0, C - 0.14 / D), Math.min(1, C + 0.12 / D), [], (m) => (tackling(cb, m) ? null : ({ t0: 0, t1: 0, state: 'swat' }) as PoseWindow), samePose)
    }
    // Ball height at the catch: chest (1.4) + the placement's vertical part.
    const f = banim.flights[0]
    if (f) {
      const inc = play.result === 'Incomplete'
      const zArr = clampN(1.4 + pl.dz, 0.12, 3.8)
      const zAt = (t: number) => {
        const k = ballZ
        if (t <= k[0].t) return k[0].z
        for (let i = 1; i < k.length; i++) if (t <= k[i].t) { const A = k[i - 1]; const B = k[i]; return A.z + (B.z - A.z) * ((t - A.t) / Math.max(1e-9, B.t - A.t)) }
        return k[k.length - 1].z
      }
      const zOld = zAt(C)
      const dzC = zArr - zOld
      const keys: BallZKey[] = []
      for (const k of ballZ) {
        if (k.t > f.t0 + 1e-9 && k.t < C - 1e-9) {
          const u = (k.t - f.t0) / Math.max(1e-9, C - f.t0)
          keys.push({ t: k.t, z: Math.max(0, k.z + dzC * u * u) })
        } else if (Math.abs(k.t - C) < 1e-9) continue
        else if (k.t > C && k.t < C + 0.35 / D) continue
        else keys.push(k)
      }
      keys.push({ t: C, z: zArr })
      const add = (dt: number, z: number) => { const t = C + dt / D; if (t < 1) keys.push({ t, z }) }
      if (!inc) add(0.1, 1.1)
      else if (plan.jump && !plan.jump.pick) { add(0.07, zArr + 0.5); add(0.22, 0.3); add(0.34, 0.15) }
      else if (pl.hands) { add(0.08, Math.max(0.3, zArr - 0.2)); add(0.2, 0.25); add(0.34, 0.15) }
      else { add(0.14, Math.max(0.2, zArr - 0.7)); add(0.26, 0.15); add(0.34, 0.12) }
      keys.sort((x, y) => x.t - y.t)
      ballZ = keys
    }
  }
  // 2. checkdown: the back is in protection (set, square to the rush) until he releases.
  if (plan.backRelT != null && plan.target && poses[plan.target]) {
    const a = plan.snapT + 0.05 / D
    poses[plan.target] = spliceWindows(poses[plan.target], a, plan.backRelT, [], () => ({ t0: 0, t1: 0, state: 'set' }) as PoseWindow, samePose)
    facing[plan.target] = spliceWindows(facing[plan.target] ?? [], a, plan.backRelT, [], () => ({ t0: 0, t1: 0, mode: 'angle', angle: 0 }) as FacingWindow, sameFacing)
  }
  return { ...banim, facing, poses, ballZ }
}

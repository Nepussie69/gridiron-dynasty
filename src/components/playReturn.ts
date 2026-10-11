// ─────────────────────────────────────────────────────────────────────────────
// Kick / punt returns on the live field (animflow round 5). The builders in
// playAnim.ts script the returner (catch → recorded spot) and the ball; this
// moves the other 21 men for the whole play so a return looks like one:
//   • kickoffs: the coverage runs down in lanes (spread ~37 yd at kick + 2 s,
//     like the tracking data) and converges on the returner; the front line
//     drops to set a wall on the return side (or a two-man wedge leads a middle
//     return), the others peel back to the coverage men coming into their area;
//   • punts: the gunners fight the jammers at the line and run stride for stride
//     with them, the protectors block the rush until the kick and then release
//     into lanes; on a return the rushers peel off to set the wall, on a fair
//     catch they turn and jog back while the coverage closes and breaks down;
//   • every block is an engaged pair that keeps moving (the cover man is turned
//     away from the return lane), unblocked return men escort the returner and
//     pick up leakers, and pursuers stay outside a shrinking ring until the
//     builder's tackle phase, so the recorded spot and result never change.
// Presentation only; deterministic; no runtime imports besides the live field.
// ─────────────────────────────────────────────────────────────────────────────

import { LiveField, pursue, holdSpot, livePos, type Agent, type Brain, type LiveMover, type LPt, type PairPlan, type Want } from './playLive.ts'

const FH = 53.3
const MIDY = FH / 2
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const clampFY = (y: number) => clampN(y, 1.5, FH - 1.5)
function hashR(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

export type ReturnScheme = 'wall' | 'middle'

/** Wall to the side the recorded return finishes on; a return that ends near the catch's line is a middle return. */
export function returnScheme(catchPt: LPt, spot: LPt): { scheme: ReturnScheme; side: 1 | -1 } {
  const dy = spot.y - catchPt.y
  if (Math.abs(dy) >= 3) return { scheme: 'wall', side: dy > 0 ? 1 : -1 }
  return { scheme: 'middle', side: catchPt.y <= MIDY ? 1 : -1 }
}

/**
 * The returner's line from the catch to the recorded spot (the spot is the last
 * point): on a wall return he starts upfield and drifts toward the wall, then
 * bends up the lane inside it; on a middle return he runs up behind the wedge
 * and drifts to the spot. A single smooth bend (no weave).
 */
export function returnLine(catchPt: LPt, spot: LPt, dir: 1 | -1, scheme: ReturnScheme): LPt[] {
  const dx = (spot.x - catchPt.x) * dir
  if (dx < 6) return [spot]
  const pts: LPt[] = []
  const q = (a: LPt, c: LPt, b: LPt, u: number) => ({
    x: (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * c.x + u * u * b.x,
    y: (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * c.y + u * u * b.y,
  })
  if (scheme === 'wall') {
    // Follow the wall: upfield and toward the lane over the first ~45%, then up it.
    const k = { x: catchPt.x + dir * dx * 0.42, y: spot.y }
    const c = { x: catchPt.x + dir * dx * 0.12, y: catchPt.y + (spot.y - catchPt.y) * 0.85 }
    for (let i = 1; i <= 10; i++) pts.push(q(catchPt, c, k, i / 10))
    pts.push(spot)
  } else {
    const k = { x: catchPt.x + dir * dx * 0.55, y: catchPt.y + (spot.y - catchPt.y) * 0.2 }
    pts.push(k)
    for (let i = 1; i <= 6; i++) pts.push(q(k, { x: k.x + dir * (dx * 0.25), y: k.y }, spot, i / 6))
  }
  return pts
}

/** Coverage lane centres (yd) for n men spread over `spread` yards around `cy`. */
export function coverLanes(n: number, cy: number, spread: number): number[] {
  const lo = clampN(cy - spread / 2, 3, FH - 3 - spread)
  return Array.from({ length: n }, (_, i) => lo + (n > 1 ? (spread * i) / (n - 1) : spread / 2))
}

export interface ReturnInput {
  kind: 'kickoff' | 'punt'
  /** What happens at the catch: a return, or no return (fair catch, downed, muff). */
  outcome: 'return' | 'fairCatch' | 'downed' | 'muff'
  /** The kicking unit (coverage), the kicker / punter included. */
  cov: LiveMover[]
  kicker: string
  /** The return unit's ten other men. */
  blk: LiveMover[]
  /** Scripted returner: his whole timeline is already built. */
  returner: LiveMover
  /** The return runs toward +x (1) or -x (-1); the coverage comes the other way. */
  dir: 1 | -1
  kickT: number
  /** The catch (or where the ball comes down). */
  catchT: number
  catchPt: LPt
  spot: LPt
  /** First contact / whistle of the return (returns only; else the end of the play). */
  contactT: number
  endT: number
  /** The builder's tackle phase starts here (no new blocks after it). */
  tackleFrom: number
  /** The coverage man expected to make the tackle (gets off his block in time). */
  tackler?: string
  /** Punts: the gunners, the jammers on them, the rushers and the protectors who take them. */
  gunners?: string[]
  jammers?: string[]
  rushers?: string[]
  protectors?: string[]
  /** Kickoffs: the front line (dropping to the wall / peeling), the middle and the two backs. */
  front?: string[]
  middle?: string[]
  backs?: string[]
  seed: number
  rec?: (a: string, b: string, t0: number, t1: number, kind: 'block' | 'double') => void
  /** Blocking / shedding ratings (0-100) for a man. */
  blockOf: (key: string) => number
  shedOf: (key: string) => number
}

export interface ReturnRun {
  scheme: ReturnScheme
  side: 1 | -1
  field: LiveField
  /** Coverage men still on a block when the tackle phase began. */
  stillEngaged: Set<string>
}

/**
 * Move every non-returner from t = 0 to `endT + 0.6` on a live field. The
 * builder then brings the tackler in from `tackleFrom` (hitAndRide) and caps
 * everyone at the whistle.
 */
export function runReturnField(inp: ReturnInput): ReturnRun {
  const { dir, catchPt, spot, catchT, kickT, seed, kind, outcome } = inp
  const ret = inp.returner.key
  const covDir = -dir
  const ret0 = inp.returner
  const isRet = outcome === 'return'
  const { scheme, side } = returnScheme(catchPt, isRet ? spot : catchPt)
  const covKeys = inp.cov.map((m) => m.key)
  const blkKeys = inp.blk.map((m) => m.key)
  const covSet = new Set(covKeys)
  const taken = new Set<string>()
  const where = (f: LiveField, k: string, t: number) => f.where(k, t) ?? { x: 0, y: 0 }
  const retAt = (t: number) => livePos(ret0.path, t)
  // When the returner gets past a spot (x) on his way, if he does.
  const passT = (x: number, from: number): number | null => {
    for (let t = Math.max(from, catchT); t <= inp.endT; t += 0.05) if ((retAt(t).x - x) * dir > 0.8) return t
    return null
  }

  // ── coverage: lanes, break down, converge ──────────────────────────────────
  const lanesFor = covKeys.filter((k) => k !== inp.kicker)
  const startY = (k: string) => inp.cov.find((m) => m.key === k)!.path[0].y
  const order = [...lanesFor].sort((a, b) => startY(a) - startY(b))
  const spreadK = kind === 'kickoff' ? 37 : 28
  const lanes = coverLanes(order.length, kind === 'kickoff' ? MIDY : clampN(catchPt.y, 18, FH - 18), spreadK)
  const laneOf = new Map(order.map((k, i) => [k, lanes[i]]))
  const keep = (k: string) => (t: number) => {
    if (!isRet) return 2.2
    if (t < catchT) return 3.5
    const pile = hashR(seed + covKeys.indexOf(k) * 2.7) < 0.3 ? 1.05 : 1.5
    if (t <= inp.contactT) return 1.3 + 1.5 * clampN((inp.contactT - t) / 2, 0, 1)
    return 1.3 + (pile - 1.3) * clampN((t - inp.contactT) / Math.max(0.2, inp.endT - inp.contactT), 0, 1)
  }
  const chase = (k: string): Brain => {
    const lane = laneOf.get(k) ?? MIDY
    return pursue(ret, { keep: keep(k), lead: 0.95, side: (lane - MIDY) * 0.12 })
  }
  const laneBrain = (k: string): Brain => {
    const lane = laneOf.get(k) ?? MIDY
    const kicker = k === inp.kicker
    return (t, me, f) => {
      const r = where(f, ret, t)
      if (isRet && t >= catchT) {
        // The kicker / punter is the last line: he stays back and squares up.
        if (kicker) {
          const want = { x: r.x + dir * 9, y: r.y + (MIDY - r.y) * 0.2 }
          return { ...want, speed: me.mv.pace.top * 0.8, ring: { key: ret, r: keep(k)(t) } }
        }
        return chase(k)(t, me, f)
      }
      const togo = Math.abs(me.x - r.x)
      const fl = clampN((togo - 6) / 28, 0, 1)
      const y = clampFY(r.y + (lane - r.y) * (0.22 + 0.78 * fl))
      // Pre-catch they break down short of him (no early arrival); on a fair
      // catch / downed punt they close to a couple of yards and square up.
      const stop = isRet ? 4.5 : 2.4
      const aimX = r.x - covDir * (togo > stop ? Math.min(stop, togo) : togo)
      const top = me.mv.pace.top * (kicker ? 0.78 : 1)
      const slow = togo < 14 ? 0.45 + 0.55 * clampN((togo - stop) / (14 - stop), 0, 1) : 1
      const off = kicker ? -covDir * 10 : 0
      return { x: aimX + off, y: kicker ? r.y + (MIDY - r.y) * 0.3 : y, speed: Math.max(1.2, top * slow), ring: { key: ret, r: stop - 0.5 } }
    }
  }

  // ── return team brains ─────────────────────────────────────────────────────
  // Set-up spots: the wall stands inside the return lane, facing the coverage.
  const laneY = isRet ? spot.y : catchPt.y
  const wallY = clampFY(laneY - side * 3)
  const wallSpot = (j: number, n: number): LPt => {
    const near = kind === 'kickoff' ? 12 : 8
    const far = kind === 'kickoff' ? 30 : 26
    const u = n > 1 ? j / (n - 1) : 0
    return { x: catchPt.x + dir * (near + (far - near) * u), y: clampFY(wallY - side * u * 2) }
  }
  const boxSpot = (j: number, n: number): LPt => {
    const ys = [-8, -3, 3, 8, -13, 13]
    return { x: catchPt.x + dir * (9 + (j % 2) * 4), y: clampFY(catchPt.y + ys[j % ys.length] * (n > 4 ? 1 : 0.8)) }
  }
  /** Pick a coverage man to block: the nearest free one coming at the return. */
  const pick = (me: Agent, f: LiveField, t: number, range: number): string | null => {
    let best: string | null = null
    let bd = Infinity
    const r = where(f, ret, t)
    for (const k of covKeys) {
      if (taken.has(k) || k === inp.kicker) continue
      const a = f.agents.get(k)
      if (!a || a.pair) continue
      if (k === inp.tackler && t > inp.tackleFrom - 1.2) continue
      const d = Math.hypot(a.x - me.x, a.y - me.y)
      // Men already past the returner are no threat to the lane.
      const behind = isRet && t > catchT && (a.x - r.x) * dir < -2
      const score = d + (behind ? 8 : 0)
      if (d <= range && score < bd) {
        bd = score
        best = k
      }
    }
    if (best) taken.add(best)
    return best
  }
  /** Run with the returner a few yards ahead, picking up a leaker. */
  const escort = (ahead: number, lat: number, armFrom: number, range = 4.5): Brain => (t, me, f) => {
    const r = where(f, ret, t)
    const v = f.velOf(ret, t)
    if (!me.target && !me.pair && t >= armFrom && t - me.freedAt > 0.6) {
      const k = pick(me, f, t, range)
      if (k) me.target = k
    }
    const sp = Math.hypot(v.x, v.y)
    return { x: r.x + dir * ahead, y: clampFY(r.y + lat), speed: Math.min(me.mv.pace.top, sp + 2.2) }
  }
  /** Go to a set-up spot, shuffle there facing the coverage, then take the man who comes. */
  const setUp = (spotP: LPt, armFrom: number, range: number, speedK = 0.9): Brain => (t, me, f) => {
    if (!me.target && !me.pair && t >= armFrom && t - me.freedAt > 0.6) {
      const k = pick(me, f, t, range)
      if (k) me.target = k
    }
    if (isRet && t > catchT + 0.4) {
      // Once the returner is by (or close), turn and run with the return.
      const r = where(f, ret, t)
      if ((me.x - r.x) * dir < 4) return escort(3.5, (me.y > r.y ? 2.5 : -2.5), armFrom, range)(t, me, f)
    }
    return holdSpot(spotP, me.mv.pace.top * speedK, seed + me.key.length * 3.1)(t, me, f)
  }
  const jogBack = (k: string): Brain => (t, me, f) => {
    // No return: turn, jog back toward the ball and stay with it.
    const r = where(f, ret, t)
    const i = blkKeys.indexOf(k)
    // The circle tightens toward the ball, so nobody parks (they walk in).
    const tight = clampN(1 - (t - catchT) / 3, 0.3, 1)
    const lat = ((i % 5) - 2) * 3.2 * tight
    const to = { x: r.x + dir * (5 + (i % 3) * 2.5) * tight, y: clampFY(r.y + lat) }
    const d = Math.hypot(to.x - me.x, to.y - me.y)
    return { ...to, speed: d > 3 ? Math.min(me.mv.pace.top * 0.7, 5) : 1.4 }
  }

  // ── pair plans ─────────────────────────────────────────────────────────────
  const plan = (blk: string, def: string, t: number, fl: LiveField): PairPlan => {
    const p = where(fl, def, t)
    const win = clampN(0.5 + (inp.blockOf(blk) - inp.shedOf(def)) * 0.02, 0.15, 0.85)
    const h = hashR(seed + blkKeys.indexOf(blk) * 3.3 + covKeys.indexOf(def) * 1.9)
    // Punt line: the protectors hold the rush up until the kick, then release.
    if (kind === 'punt' && t < kickT && (inp.protectors?.includes(blk) || inp.rushers?.includes(blk))) {
      const peel = isRet ? 0.85 + h * 0.45 : kickT + 0.1 + h * 0.3
      const pushX = covDir * -0.35 * (1 - win) + covDir * 0.25 * win
      return { shedAt: Math.max(t + 0.35, peel), drive: () => ({ x: pushX, y: 0 }) }
    }
    // Gunner vs jammer: stride for stride down the field, hand-fighting.
    if (kind === 'punt' && inp.gunners?.includes(def) && t < kickT + 1.5) {
      const rel = clampN(1.05 + h * 0.9 - win * 0.3, 0.8, 2.1)
      const wob = (h - 0.5) * 1.2
      return {
        shedAt: t + rel,
        drive: (tt) => ({ x: covDir * (3.6 + 1.6 * clampN((tt - t) / 0.6, 0, 1)), y: wob * Math.sin((tt - t) * 3.1) }),
      }
    }
    // A return block: the cover man is turned away from the return lane and
    // keeps fighting toward the ball; a winning blocker stalls him.
    let shedAt: number
    if (def === inp.tackler) {
      const c = retAt(inp.contactT)
      const nat = Math.hypot(c.x - p.x, c.y - p.y) / Math.max(3, fl.agents.get(def)!.mv.pace.top * 0.8) + 0.25
      shedAt = clampN(inp.contactT - nat - 0.3, t + 0.3, t + 2.6)
    } else {
      const hold = clampN(0.9 + (inp.blockOf(blk) - inp.shedOf(def)) * 0.02 + h * 0.9, 0.6, 2.4)
      const pt = isRet ? passT(p.x, t) : null
      shedAt = t + hold
      if (pt != null) shedAt = Math.max(shedAt, Math.min(pt + 0.15 + h * 0.3, t + 3.2))
      shedAt = Math.min(shedAt, inp.endT + 0.4)
    }
    return {
      shedAt,
      drive: (tt) => {
        const d = fl.where(def) ?? p
        const r = retAt(tt)
        const away = scheme === 'wall' && isRet ? (Math.abs(d.y - laneY) < 6 ? -side : Math.sign(d.y - r.y) || -side) : Math.sign(d.y - r.y) || 1
        const fade = 1 - 0.5 * clampN((tt - (shedAt - 0.4)) / 0.4, 0, 1)
        return { x: covDir * (0.9 - 1.3 * win) * fade, y: away * (0.8 + 1.0 * win) * fade }
      },
    }
  }

  const field = new LiveField(0, {
    rec: inp.rec,
    plan,
    onShed: (def, _t, fl) => {
      const a = fl.agents.get(def)
      if (!a) return
      taken.delete(def)
      if (covSet.has(def)) {
        a.brain = laneBrain(def)
      } else {
        // A punt rusher peeling off: to the wall / box, or back to the ball.
        const i = (inp.rushers ?? []).indexOf(def)
        if (!isRet) a.brain = jogBack(def)
        else a.brain = scheme === 'wall' ? setUp(wallSpot(i, (inp.rushers ?? []).length), catchT - 1.0, 7) : setUp(boxSpot(i, (inp.rushers ?? []).length), catchT - 1.0, 7)
      }
    },
    onRelease: (blk, t, fl) => {
      const a = fl.agents.get(blk)
      if (!a) return
      if (covSet.has(blk)) {
        // A protector released into coverage (his brain is already phased).
        return
      }
      const i = blkKeys.indexOf(blk)
      if (!isRet) a.brain = jogBack(blk)
      else if (inp.jammers?.includes(blk) && t < catchT - 0.8) {
        // The jammer turns and runs with the gunner, then blocks him again.
        const g = (inp.gunners ?? [])[(inp.jammers ?? []).indexOf(blk)]
        a.brain = (tt, me, f) => {
          if (g && tt >= catchT - 0.9 && !me.target && !me.pair && tt - me.freedAt > 0.5 && !taken.has(g)) {
            const ga = f.agents.get(g)
            if (ga && !ga.pair) {
              taken.add(g)
              me.target = g
            }
          }
          const gp = where(f, g ?? ret, tt)
          const gv = f.velOf(g ?? ret, tt)
          return { x: gp.x + gv.x * 0.3 - covDir * 1.2, y: gp.y + (MIDY - gp.y) * 0.05, speed: me.mv.pace.top }
        }
      } else a.brain = escort(3 + (i % 3), (i % 2 ? 1 : -1) * (2 + (i % 3)), t + 0.6)
    },
  }, seed)
  field.script(ret0)
  field.avoid = { key: ret, r: 1.4, from: catchT }

  // Coverage men.
  for (const mv of inp.cov) {
    const k = mv.key
    let brain = laneBrain(k)
    if (kind === 'punt' && inp.protectors?.includes(k)) {
      // Protect (feet set) until the kick, then release into the lane.
      const s = { x: mv.path[0].x, y: mv.path[0].y }
      const hold = holdSpot({ x: s.x - covDir * 0.6, y: s.y }, 2.0, seed + covKeys.indexOf(k))
      const lane = laneBrain(k)
      brain = (t, me, f) => (t < kickT + 0.05 ? hold(t, me, f) : lane(t, me, f))
    } else if (kind === 'punt' && k === inp.kicker) {
      const s = { x: mv.path[0].x, y: mv.path[0].y }
      const lane = laneBrain(k)
      brain = (t, me, f) => (t < kickT + 0.3 ? ({ x: s.x + covDir * 1.5 * clampN((t - (kickT - 0.6)) / 0.6, 0, 1), y: s.y, speed: 2.4 } as Want) : lane(t, me, f))
    } else if (kind === 'punt' && inp.gunners?.includes(k)) {
      const lane = laneBrain(k)
      brain = (t, me, f) => {
        if (t < kickT + 0.6) {
          // Release straight down the sideline toward the ball's landing area.
          const r = where(f, ret, t)
          return { x: r.x - covDir * 3, y: clampFY(me.y + (r.y - me.y) * 0.08), speed: me.mv.pace.top }
        }
        return lane(t, me, f)
      }
    }
    field.add(mv as LiveMover, 'def', brain, kind === 'punt' && inp.protectors?.includes(k) ? (inp.rushers?.[inp.protectors.indexOf(k)] ?? null) : null)
  }
  // Return men.
  const wallMen: string[] = []
  const peelMen: string[] = []
  if (kind === 'kickoff') {
    const front = inp.front ?? []
    const middle = inp.middle ?? []
    if (scheme === 'wall') {
      // The middle men and the two front men nearest the return side make the wall.
      const fr = [...front].sort((a, b) => (startOf(inp, b).y - startOf(inp, a).y) * side)
      wallMen.push(...middle, ...fr.slice(0, 2))
      peelMen.push(...fr.slice(2))
    } else {
      peelMen.push(...front, ...middle)
    }
  }
  for (const mv of inp.blk) {
    const k = mv.key
    let brain: Brain
    let target: string | null = null
    if (kind === 'kickoff') {
      if (wallMen.includes(k)) {
        // Order the wall by how far upfield each man starts (front men take the far spots).
        const byX = [...wallMen].sort((a, b) => (startOf(inp, a).x - startOf(inp, b).x) * dir)
        brain = setUp(wallSpot(byX.indexOf(k), wallMen.length), catchT - 0.6, 7)
      } else if (peelMen.includes(k)) {
        // Drop with the coverage and peel back to the man in their area.
        const s = startOf(inp, k)
        const drop: LPt = { x: s.x + (catchPt.x + dir * 22 - s.x) * 0.55, y: s.y + (catchPt.y - s.y) * 0.25 }
        brain = setUp(drop, 0.9, 6.5, 0.85)
      } else {
        // The two backs: a two-man wedge / lead blockers in front of the returner.
        const i = (inp.backs ?? []).indexOf(k)
        const lat = (i === 0 ? -1 : 1) * 2.2
        const pre = holdSpot({ x: catchPt.x + dir * 6, y: clampFY(catchPt.y + lat) }, mv.pace.top * 0.6, seed + i)
        const esc = escort(4.5, lat, catchT + 0.2, 5)
        brain = (t, me, f) => (t < catchT + 0.1 ? pre(t, me, f) : esc(t, me, f))
      }
    } else {
      const rI = (inp.rushers ?? []).indexOf(k)
      const jI = (inp.jammers ?? []).indexOf(k)
      if (rI >= 0) {
        // Rush; the protector's block decides when he gets off (onShed).
        brain = (_t, me) => ({ x: me.x + covDir * -2, y: me.y, speed: me.mv.pace.top * 0.8 })
      } else if (jI >= 0) {
        target = (inp.gunners ?? [])[jI] ?? null
        brain = (_t, me) => ({ x: me.x + covDir * 2, y: me.y, speed: me.mv.pace.top })
      } else {
        // Hold-up / middle men: drop and set up (or jog back on a fair catch).
        const i = blkKeys.indexOf(k)
        const sp = scheme === 'wall' ? wallSpot(i % 2 ? 4 : 5, 6) : boxSpot(4 + (i % 2), 6)
        brain = isRet ? setUp(sp, catchT - 1.0, 7) : jogBack(k)
      }
    }
    field.add(mv as LiveMover, 'off', brain, target)
  }
  // Punt line: each rusher is taken by the protector over him (set above as
  // the protector's target); here the rushers wait to be engaged.
  field.run(Math.max(0.05, inp.tackleFrom))
  field.noContactAfter = inp.tackleFrom
  const stillEngaged = new Set(covKeys.filter((k) => field.engaged(k) && k !== inp.tackler))
  field.run(inp.endT + 0.6)
  field.closeAll(inp.endT + 0.6)
  return { scheme, side, field, stillEngaged }
}

function startOf(inp: ReturnInput, k: string): LPt {
  const m = inp.blk.find((b) => b.key === k) ?? inp.cov.find((b) => b.key === k)
  return m ? { x: m.path[0].x, y: m.path[0].y } : { x: 0, y: 0 }
}

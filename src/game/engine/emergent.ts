// ─────────────────────────────────────────────────────────────────────────────
// E1a — the pursuit field, RUN side (FUTURES #54, phase E1).
//
// Today `resolveRun` samples a yardage bucket from the real NFL run CDF, then
// names the tackler, the missed-tackle list, the OOB flag and the scorer from
// ratings + hashes, and the animation is choreographed to act that decision out.
// E1 inverts the run: the men on the field produce the yards, the tackler, the
// misses and the out-of-bounds.
//
//   • the carrier (the back or QB the sim already picked) runs his gap/aim line
//     at his OWN pace (`paceFor` + `fatiguePace` — the one speed model) with a
//     burst from his own ACC/AGI/BCV;
//   • the defensive eleven start from the concept/personnel alignment, react on
//     their own AWR, take a wrong first step when they bit the misdirection (the
//     J8a2 `bitesAt` list), then pursue on an intercept angle whose lead is
//     `pursuitLead + leadAwrW*(AWR-70)/30` so a good read takes the true angle
//     and a poor one undercuts;
//   • the front blockers fire at their men; a blocked defender is held for a
//     block-win time from the SAME run-block / run-def blend the sim uses
//     (`RBK*0.7+IMP*0.3` vs `BSH*0.5+STR*0.5`), then sheds and pursues;
//   • a free defender closing to `contactR` makes the tackle attempt with the
//     engine's own `tackleMissChance` (fed the real closing speed and angle);
//     a miss lets the carrier burst on and the next pursuer attempt;
//   • out of bounds when he leaves the field; a touchdown at the goal line; a
//     `maxT`/tail fallback caps a runaway play.
//
// Every effect is each man's OWN rating (via `effAttrs` + `paceFor`/`fatiguePace`
// and the position-correct `positionRating`). There is NO unit / roster / team
// average anywhere. Determinism: ZERO `rng()` draws are added or removed — every
// decision is `hash32`/`h01` on `${n}:${defId}:e1:…`; the draws the replaced
// block used are still consumed at the same point by the caller, so the seed
// stream keeps its length and order, and `setEmergentE1(false)` makes the
// resolver never enter this file (byte-identical OFF path).
//
// CALIBRATION: every knob lives in `EMERGENT` and nowhere else. The yardage is
// the calibrated CDF anchor PLUS the field's own deviation, so the league bands
// hold while the men on the play widen the distribution. `deltaW` small ⇒ the ON
// mean is the OFF mean + `bias`; raise `deltaW` until the individual spread
// separates (SPD/RBK probe) while every band still holds. `E1_STAT` (off by
// default, never read by the sim) accumulates the raw field numbers for the probe.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player } from '../types'
import { clamp, hash32 } from './rng'
import { effAttrs, fatiguePace, paceFor } from './pace'
import { positionRating } from './individual'
import type { LPt } from './liveField'

const MID = 26.65

/** h01 on a key (hash32 → [0,1)) — never an rng() draw. */
function h01(key: string): number {
  return (hash32(key) >>> 0) / 4294967296
}
/** The position-correct effective rating (own, else the position mean/blend). */
function effA(p: Player, key: string): number {
  const a = effAttrs(p)
  const v = a[key]
  if (typeof v === 'number') return v
  return positionRating(p.pos, a, key)
}

/**
 * Every constant E1 adds, in one place. Tune only here. The first block is the
 * spec's own list; the rest are the layout / centring knobs the field needs.
 */
export const EMERGENT = {
  on: false,
  // ── the field (spec list) ───────────────────────────────────────────────────
  dt: 0.05,
  farDt: 0.25,
  contactR: 0.9,
  /** (spec knob; the E1b pass/YAC segment reads it — the run field ends the play
   *  at the hit, which is the same outcome.) */
  tackleR: 0.75,
  pursuitLead: 0.85,
  leadAwrW: 0.3,
  shedW: 0.03,
  blockHoldBase: 0.9,
  /** While a block holds, the defender is driven back (yd/s, away from the LOS). */
  pushBack: 1.0,
  /** …and laterally out of the carrier's lane (yd/s), so the block opens a gap. */
  pushLat: 1.6,
  burstW: 1.0,
  /** (spec knob; E1b: the open-field yards a missed tackle is worth on a catch.) */
  missGainW: 0.004,
  /** (spec knob; E1b: how close to the chalk counts as out on a catch-and-run.) */
  sidelineSlack: 0.4,
  maxT: 9,
  /** The fallback multiplier ceiling (see `tailLo`/`tailHi`). */
  tailCap: 1.15,
  tailLo: 0.55,
  tailHi: 1.15,
  // ── centring of the field deviation on the calibrated anchor ───────────────
  /** How much of the field's own deviation (stop − aim) reaches the yards. */
  deltaW: 1.2,
  /** The same on the short side (a stopped-short play is only nudged, so the
   *  calibrated ≤0 shape holds while the field's breakaways fatten the tail). */
  deltaNegW: 1.2,
  /** A flat yards shift (the one mean knob; measured from the ON panel). */
  bias: 0.25,
  // ── layout (the concept/personnel alignment the animation uses) ────────────
  /** The lateral span the run's lanes are spread over (yd). */
  aimSpan: 44,
  /** How many backers the offence may account for with a block (the rest run free). */
  lbBlockMax: 1,
  /** How far past his aim a carrier may run on a broken tackle (the tail cap). */
  missExtraYd: 2,
  /** A carrier with nobody within this many yards of him at his aim is NOT down
   *  there: no defender is close enough to be credited, so a clean back keeps
   *  running and the pursuit has to actually catch him. */
  breakR: 3.0,
  /** How far past his aim a clean (untouched) back may run before he is credited
   *  to the nearest chaser — the second, larger tail cap, so a clean back cannot
   *  turn every medium carry into a 99-yd play. */
  cleanExtra: 9,
  /**
   * A run stopped wide of the ball is often forced out of bounds rather than
   * tackled down in bounds: P(OOB) rises with how wide the carrier is. Hash-only.
   */
  oobFrom: 6,
  oobW: 0.04,
  oobMax: 0.45,
  /** The forcer has to be this close (yd) for the end to count as forced out. */
  oobR: 2.0,
  /** A run aimed wider than this from the ball drifts toward that sideline. */
  driftFrom: 14,
  /** The outward drift (yd/s) of such a run (it can be forced out of bounds). */
  outsideDrift: 0.9,
  backDepthRB: 7,
  backDepthQB: 1,
  dlX: 1.2,
  dlSpan: 8.6,
  lbX: 5.5,
  lbSpan: 12,
  cbX: 5.0,
  sX: 13,
  sSpan: 19,
  // ── first step / read ──────────────────────────────────────────────────────
  reactBase: 0.18,
  reactAwrW: 0.008,
  reactLo: 0.05,
  reactHi: 0.5,
  biteDelay: 0.22,
  // ── contact ────────────────────────────────────────────────────────────────
  recoverT: 0.35,
  burstDur: 0.45,
  burstSpeed: 1.18,
  /** The lateral kick a broken tackle puts on the carrier (yd/s). */
  juke: 3.0,
  openW: 1.0,
  /** A global scale on the attempted miss chance (the league MT-rate knob). */
  missW: 0.66,
  /** The geometric openness → the miss model's `gain` input (see the caller). */
  openScale: 2.8,
  // ── the block-win time from the same run-block/run-def blend ───────────────
  shedLo: 0.12,
  shedHi: 2.6,
  // ── the far-man step threshold (yd) ────────────────────────────────────────
  farThresh: 3.5,
  sideLo: 1,
  sideHi: 52.3,
  /** Fast-path mirror (statAlloc): the ON rush base and MT base (measured). */
  stRushBase: 112,
  stMtBase: -1,
  /** Warmup: the recorded path cadence (ticks between fieldPaths points). */
  pathEvery: 5,
} as const

interface MutableE1 { on: boolean }
const E1CFG = EMERGENT as unknown as MutableE1

/** E1: turn the pursuit field on/off (default OFF — the OFF path is base). */
export function setEmergentE1(on: boolean): void {
  E1CFG.on = on
}
/** E1: read the toggle so a probe can restore it exactly. */
export function getEmergentE1(): boolean {
  return E1CFG.on
}

/** Dev accumulator (turned on by the probe; never read by the sim). */
export const E1_STAT = {
  on: false,
  n: 0,
  sumYards: 0,
  sumYards2: 0,
  nonpos: 0,
  ge10: 0,
  tds: 0,
  oob: 0,
  missed: 0,
  sumPlanned: 0,
  sumField: 0,
  sumDelta: 0,
  delta0: [] as number[],
  field0: [] as number[],
  posN: {} as Record<string, number>,
  posField: {} as Record<string, number>,
  posPlanned: {} as Record<string, number>,
  attempts: 0,
}

/** A run-block blend for a blocker (his own RBK/IMP). */
function blkBlend(p: Player): number {
  return effA(p, 'RBK') * 0.7 + effA(p, 'IMP') * 0.3
}
/** A run-defence shed blend for a defender (his own BSH/STR). */
function defBlend(p: Player): number {
  return effA(p, 'BSH') * 0.5 + effA(p, 'STR') * 0.5
}
/**
 * The block-win time (s) for one specific blocker on one specific defender — the
 * same blend the field and the resolver use. Exported for the probe only.
 */
export function blockHoldTime(blocker: Player, defender: Player): number {
  return clamp(EMERGENT.blockHoldBase + EMERGENT.shedW * (blkBlend(blocker) - defBlend(defender)), EMERGENT.shedLo, EMERGENT.shedHi)
}

interface Man {
  p: Player
  role: string
  x: number
  y: number
  vx: number
  vy: number
  top: number
  acc: number
  /** A first-step delay (read time; bites add to it). */
  react: number
  /** While `< t` he is still held on his block (never attempts a tackle). */
  pinned: number
  /** The block's drive on him while pinned (yd/s): back and out of the lane. */
  pushX: number
  pushY: number
  /** While `< t` he is recovering from a missed tackle. */
  recover: number
}

export interface EmergentRunIn {
  n: number
  defId: string
  offId: string
  /** The line of scrimmage (own goal = 0, opponent's = 100). */
  yard: number
  distance: number
  down: number
  /** The calibrated CDF anchor (the yards the scheme intends). */
  planned: number
  carrier: Player
  ol: Player[]
  te?: Player
  te2?: Player
  fb?: Player
  rbLead?: Player
  wrs?: Player[]
  dl: Player[]
  lbs: Player[]
  saf: Player[]
  cbs: Player[]
  fat?: Record<string, number>
  /** The defenders who bit the first key (J8a2) — a wrong first step. */
  biteIds: string[]
  misdirection: boolean
  /** 0 = the leftmost gap … n-1 = the rightmost (the lateral lane attacked). */
  poaIdx: number
  /** The engine's own tackle-miss probability, fed the real closing geometry. */
  missChance: (def: Player, openness: number) => number
  /** CLOCK_ON: a runner forced out of bounds is credited to a defender. */
  clockOn: boolean
}

export interface EmergentRunOut {
  yards: number
  tacklerId?: string
  missedTackleIds?: string[]
  forcedMissedIds?: string[]
  outOfBounds?: boolean
  scorerId?: string
  /** The carrier's recorded path (animation; optional — old saves ignore it). */
  carryPath: LPt[]
  /** Every man's recorded path (animation; optional). */
  fieldPaths: Record<string, LPt[]>
}

/** Place a group across the field centred on the ball, spanning `span` yards. */
function spreadY(i: number, n: number, span: number): number {
  if (n <= 1) return MID
  return MID + (i - (n - 1) / 2) * (span / (n - 1))
}

/** Move a man toward (tx,ty) at his own pace, accel-limited (no teleport). */
function steer(m: Man, tx: number, ty: number, dt: number, accMul: number) {
  const dx = tx - m.x
  const dy = ty - m.y
  const L = Math.sqrt(dx * dx + dy * dy)
  const acc = Math.max(2, m.acc) * accMul
  const sp = L < 0.05 ? 0 : m.top
  const ux = L > 1e-6 ? dx / L : 0
  const uy = L > 1e-6 ? dy / L : 0
  let dvx = ux * sp - m.vx
  let dvy = uy * sp - m.vy
  const dl = Math.sqrt(dvx * dvx + dvy * dvy)
  const lim = acc * dt
  if (dl > lim) {
    dvx *= lim / dl
    dvy *= lim / dl
  }
  m.vx += dvx
  m.vy += dvy
  m.x += m.vx * dt
  m.y += m.vy * dt
}

/**
 * E1a: one run decided on the field. Returns the same PlayOutcome fields the
 * replaced block produced, plus the recorded paths for the animation.
 */
export function emergentRun(inp: EmergentRunIn): EmergentRunOut {
  const { defId, yard, planned } = inp
  const key = `${inp.n}:${defId}:e1`
  const fat = inp.fat
  const R = EMERGENT

  const paceOf = (p: Player, role: string) => {
    const pc = paceFor(p, role)
    const fp = fatiguePace(fat?.[p.id])
    return { top: pc.top * fp.top, acc: pc.acc * fp.acc }
  }

  // ── the carrier ────────────────────────────────────────────────────────────
  const ca = effAttrs(inp.carrier)
  const lane = clamp(
    inp.poaIdx >= 0 && inp.dl.length ? spreadY(inp.poaIdx, inp.dl.length, R.aimSpan) : MID,
    R.sideLo + 1, R.sideHi - 1,
  )
  const backDepth = inp.carrier.pos === 'QB' ? R.backDepthQB : R.backDepthRB
  const cRole = inp.carrier.pos === 'QB' ? 'QB' : inp.carrier.pos === 'FB' ? 'FB' : 'RB'
  const cp = paceOf(inp.carrier, cRole)
  const burstQ = ((ca.ACC ?? 70) + (ca.AGI ?? 70) + (ca.BCV ?? 70)) / 3
  const cBurstAcc = 1 + R.burstW * clamp((burstQ - 70) / 30, -1, 1)
  const carrier: Man = {
    p: inp.carrier, role: cRole,
    x: yard - backDepth, y: lane, vx: 0, vy: 0,
    top: cp.top, acc: cp.acc, react: 0, pinned: 0, pushX: 0, pushY: 0, recover: 0,
  }

  // ── the defence (concept/personnel alignment) ──────────────────────────────
  const defs: Man[] = []
  const add = (p: Player, role: string, x: number, y: number) => {
    const pc = paceOf(p, role)
    defs.push({ p, role, x, y: clamp(y, R.sideLo, R.sideHi), vx: 0, vy: 0, top: pc.top, acc: pc.acc, react: 0, pinned: 0, pushX: 0, pushY: 0, recover: 0 })
  }
  inp.dl.forEach((p, i) => add(p, 'DL', yard + R.dlX, spreadY(i, inp.dl.length, R.dlSpan)))
  inp.lbs.forEach((p, i) => add(p, 'LB', yard + R.lbX, spreadY(i, inp.lbs.length, R.lbSpan)))
  const cbY = inp.cbs.length === 1 ? [MID + 21] : [5.6, 47.7]
  inp.cbs.forEach((p, i) => add(p, 'CB', yard + R.cbX, cbY[i] ?? MID))
  inp.saf.forEach((p, i) => add(p, 'S', yard + R.sX, spreadY(i, inp.saf.length, R.sSpan)))

  // ── blocks: the line takes the front, the backfield takes the backers ──────
  const taken = new Set<string>()
  const take = (b: Player, roles: string[]): boolean => {
    let target: Man | undefined
    let best = Infinity
    for (const d of defs) {
      if (!roles.includes(d.role)) continue
      if (taken.has(d.p.id)) continue
      const dd = Math.abs(d.y - lane)
      if (dd < best) { best = dd; target = d }
    }
    if (!target) return false
    taken.add(target.p.id)
    const hold = clamp(R.blockHoldBase + R.shedW * (blkBlend(b) - defBlend(target.p)), R.shedLo, R.shedHi)
    target.pinned = hold
    // The block drives him back and out of the lane while it holds (no pursuit),
    // so a fast back can reach the gap the block just made. Hash-picked side when
    // he is dead in the lane (never an rng() draw).
    const away = target.y - lane
    const sgn = away === 0 ? (h01(`${key}:push:${target.p.id}`) < 0.5 ? -1 : 1) : Math.sign(away)
    target.pushX = -R.pushBack
    target.pushY = sgn * R.pushLat
    return true
  }
  // the offensive line blocks the line; a spare lineman (a puller) climbs to a backer
  let lbB = 0
  const takeLb = (b: Player): boolean => {
    if (lbB >= R.lbBlockMax) return false
    if (take(b, ['LB'])) { lbB++; return true }
    return false
  }
  const spare: Player[] = []
  for (const b of inp.ol) { if (!take(b, ['DL'])) spare.push(b) }
  for (const b of spare) takeLb(b)
  if (inp.te) { if (!take(inp.te, ['DL'])) takeLb(inp.te) }
  if (inp.te2) { if (!take(inp.te2, ['DL'])) takeLb(inp.te2) }
  // the fullback / lead back pick up the backers
  if (inp.fb) takeLb(inp.fb)
  if (inp.rbLead) takeLb(inp.rbLead)
  // the split receivers crack the corners on an outside run (the edge is blocked)
  if (inp.wrs) for (const w of inp.wrs) { if (!take(w, ['CB'])) take(w, ['S']) }

  // ── first step / read (the J8a2 bite list gives a wrong first step) ────────
  const bite = new Set(inp.biteIds)
  for (const d of defs) {
    d.react = clamp(R.reactBase - (effA(d.p, 'AWR') - 70) * R.reactAwrW, R.reactLo, R.reactHi)
    if (bite.has(d.p.id)) d.react += R.biteDelay
  }

  // ── the field ──────────────────────────────────────────────────────────────
  const contact2 = R.contactR * R.contactR
  const far2 = R.farThresh * R.farThresh
  const path: LPt[] = [{ x: carrier.x, y: carrier.y }]
  const fieldPaths: Record<string, LPt[]> = { [inp.carrier.id]: path }
  let stopX: number | null = null
  let tacklerId: string | undefined
  let oob = false
  let td = false
  const missed: string[] = []
  const missedSet = new Set<string>()
  let attempts = 0
  let burstT = -1
  let t = 0
  let tick = 0
  const farN = Math.max(1, Math.round(R.farDt / R.dt))
  // A forced out-of-bounds end: the man who would have made the tackle has to be
  // ON him (the animation can only draw a forcer who is really there), and the
  // further he is strung out from the ball the likelier he is shoved over the
  // line. Hash-only. A carrier with nobody on him is simply run down — never an
  // unforced step-out.
  const oobRoll = (dist: number): boolean => {
    if (dist > R.oobR) return false
    const lat = Math.abs(carrier.y - MID)
    const pOob = clamp((lat - R.oobFrom) * R.oobW, 0, R.oobMax)
    return pOob > 0 && h01(`${key}:oob`) < pOob
  }

  while (t < R.maxT - 1e-9) {
    t += R.dt
    tick++
    // carrier: run the gap/aim line (a broken tackle lets him continue past it).
    // A run aimed at the edge drifts toward that sideline, so an outside run can
    // be forced out of bounds (the field's own sideline end).
    const aimX = yard + planned
    const targetX = missed.length ? carrier.x + 6 : aimX
    const wide = lane >= MID ? lane - MID : MID - lane
    const aimY = wide > R.driftFrom
      ? clamp(lane + (lane >= MID ? 1 : -1) * R.outsideDrift * t, R.sideLo - 2, R.sideHi + 2)
      : lane
    steer(carrier, targetX, aimY, R.dt, cBurstAcc * (t < burstT ? R.burstSpeed : 1))
    // defenders
    for (const m of defs) {
      if (m.pinned > t) {
        // still held on his block: driven back and out of the lane, no pursuit
        m.x += m.pushX * R.dt
        m.y = clamp(m.y + m.pushY * R.dt, R.sideLo - 4, R.sideHi + 4)
        continue
      }
      if (t < m.react) continue
      if (t < m.recover) continue
      const dx = carrier.x - m.x
      const dy = carrier.y - m.y
      const d2 = dx * dx + dy * dy
      const far = d2 > far2
      if (far && tick % farN !== 0) continue
      const dt = far ? R.dt * farN : R.dt
      // The earliest point the defender can reach the carrier's line within
      // `contactR` (a real pursuit angle): a man ahead meets him, a man behind
      // must be faster. `lead` (from his own AWR) takes the true angle or
      // undercuts it.
      let ts = 0.1
      for (let tau = 0.1; tau <= 1.6; tau += 0.1) {
        ts = tau
        const qx = carrier.x + carrier.vx * tau
        const qy = carrier.y + carrier.vy * tau
        const qd = Math.sqrt((qx - m.x) * (qx - m.x) + (qy - m.y) * (qy - m.y))
        if (qd - R.contactR <= m.top * tau) break
      }
      const lead = clamp(R.pursuitLead + R.leadAwrW * (effA(m.p, 'AWR') - 70) / 30, 0.2, 1)
      steer(m, carrier.x + carrier.vx * ts * lead, carrier.y + carrier.vy * ts * lead, dt, 1)
    }
    // the sideline is a hard wall: a carrier with nobody on him cannot step out
    // on his own (that reads as unforced), so he is strung along it until a
    // defender gets home. The end zone still scores.
    if (carrier.y < R.sideLo) { carrier.y = R.sideLo; carrier.vy = 0 }
    else if (carrier.y > R.sideHi) { carrier.y = R.sideHi; carrier.vy = 0 }
    if (carrier.x >= 100) { td = true; break }
    // the nearest free defender in reach makes the attempt
    let near: Man | null = null
    let nearD2 = contact2
    for (const m of defs) {
      if (m.pinned > t) continue
      if (t < m.react) continue
      if (t < m.recover) continue
      const dx = carrier.x - m.x
      const dy = carrier.y - m.y
      const d2 = dx * dx + dy * dy
      if (d2 <= nearD2) { nearD2 = d2; near = m }
    }
    if (near) {
      attempts++
      const d = Math.sqrt(Math.max(1e-6, nearD2))
      const ux = (carrier.x - near.x) / d
      const uy = (carrier.y - near.y) / d
      const closing = (near.vx - carrier.vx) * ux + (near.vy - carrier.vy) * uy
      const mv = Math.max(0.5, Math.sqrt(near.vx * near.vx + near.vy * near.vy))
      const angleCos = (near.vx * ux + near.vy * uy) / mv
      const openness = clamp((1 - clamp(angleCos, -1, 1)) * 0.5 * clamp(closing, 0, 14) * R.openScale * R.openW, 0, 30)
      const chance = clamp(inp.missChance(near.p, openness) * R.missW, 0, 0.4)
      // Only the FIRST contact can miss (as the engine's own R5 model: one
      // defender attempts, a miss adds yards and a second defender finishes),
      // so a play can never stack misses and the league MT rate holds.
      const roll = missed.length < 1 ? h01(`${key}:mt:${near.p.id}:${attempts}`) : 1
      if (roll < chance) {
        missed.push(near.p.id)
        missedSet.add(near.p.id)
        near.recover = t + R.recoverT
        near.x -= ux * 0.35
        near.y -= uy * 0.35
        // the carrier breaks off the tackle, a little to the side (a juke)
        carrier.vx -= ux * R.juke
        carrier.vy -= uy * R.juke
        burstT = t + R.burstDur
      } else if (oobRoll(d)) {
        oob = true
        tacklerId = near.p.id
        break
      } else {
        stopX = carrier.x
        tacklerId = near.p.id
        break
      }
    }
    // (a) a broken tackle is run down after `missExtraYd` past the aim (the cap
    //     that keeps a single miss from becoming an untouchable 99-yd play)
    if (missed.length && carrier.x >= aimX + R.missExtraYd) {
      let who: Man | null = null
      let bd = Infinity
      for (const m of defs) {
        const d2 = (carrier.x - m.x) * (carrier.x - m.x) + (carrier.y - m.y) * (carrier.y - m.y)
        if (d2 < bd) { bd = d2; who = m }
      }
      if (who) {
        if (oobRoll(Math.sqrt(bd))) { oob = true; tacklerId = who.p.id; break }
        tacklerId = who.p.id
      }
      stopX = carrier.x
      break
    }
    // (b) down at the aim: the play gained what the scheme designed unless a
    //     defender got there first (above) or a broken tackle let him past it.
    //     The nearest defender closes the play here (the tackle attempt that
    //     credits him); a miss lets the carrier run on past his aim.
    if (!missed.length && carrier.x >= aimX - 0.05) {
      let who: Man | null = null
      let bd = Infinity
      for (const m of defs) {
        const d2 = (carrier.x - m.x) * (carrier.x - m.x) + (carrier.y - m.y) * (carrier.y - m.y)
        if (d2 < bd) { bd = d2; who = m }
      }
      if (planned > 0 && who && bd > R.breakR * R.breakR && carrier.x < aimX + R.cleanExtra) {
        // He is CLEAN at his aim: nobody is within `breakR`, so there is no
        // defender to credit with the tackle here and the play is NOT over — he
        // keeps running until the pursuit actually catches him (capped at the aim
        // + `cleanExtra`, exactly as a broken tackle is capped). Plays the anchor
        // already decided were stuffs (planned <= 0) never reach this branch, so
        // the league's <=0 shape is untouched by it.
      } else if (who) {
        attempts++
        const d = Math.sqrt(Math.max(1e-6, bd))
        const ux = (carrier.x - who.x) / d
        const uy = (carrier.y - who.y) / d
        const closing = (who.vx - carrier.vx) * ux + (who.vy - carrier.vy) * uy
        const mv = Math.max(0.5, Math.sqrt(who.vx * who.vx + who.vy * who.vy))
        const ac = (who.vx * ux + who.vy * uy) / mv
        const openness = clamp((1 - clamp(ac, -1, 1)) * 0.5 * clamp(closing, 0, 14) * R.openScale * R.openW, 0, 30)
        if (h01(`${key}:aimmt:${who.p.id}`) < clamp(inp.missChance(who.p, openness) * R.missW, 0, 0.4)) {
          missed.push(who.p.id)
          missedSet.add(who.p.id)
          who.recover = t + R.recoverT
          burstT = t + R.burstDur
        } else if (oobRoll(d)) {
          oob = true
          tacklerId = who.p.id
          break
        } else {
          stopX = carrier.x
          tacklerId = who.p.id
          break
        }
      } else {
        stopX = carrier.x
        break
      }
    }
    // record
    path.push({ x: carrier.x, y: carrier.y })
    if (tick % R.pathEvery === 0) {
      for (const m of defs) {
        if (m.pinned > t) continue
        let fp = fieldPaths[m.p.id]
        if (!fp) { fp = []; fieldPaths[m.p.id] = fp }
        fp.push({ x: m.x, y: m.y })
      }
    }
  }

  // ── the tail fallback (a field bug can never make a 99-yd play) ────────────
  const nearestId = (): string | undefined => {
    let best: Man | null = null
    let bd = Infinity
    for (const m of defs) {
      const d2 = (carrier.x - m.x) ** 2 + (carrier.y - m.y) ** 2
      if (d2 < bd) { bd = d2; best = m }
    }
    return best?.p.id
  }
  let fieldGain: number
  if (td) fieldGain = 100 - yard
  else if (oob) fieldGain = carrier.x - yard
  else if (stopX !== null) fieldGain = stopX - yard
  else {
    // nobody reached him inside maxT: cap the runaway at his own current gain
    const cur = Math.max(0, carrier.x - yard)
    const u = h01(`${key}:tail`)
    const tl = cur * Math.min(R.tailCap, R.tailLo + (R.tailHi - R.tailLo) * u)
    fieldGain = Math.min(cur, Math.max(0, tl))
    if (!tacklerId) tacklerId = nearestId()
  }

  // ── the yards: the calibrated anchor plus the field's own deviation ────────
  // The field's breakaways fatten the positive tail; a play stopped short of its
  // aim is only nudged, so the calibrated ≤0 shape holds.
  const dev = fieldGain - planned
  const dw = dev >= 0 ? R.deltaW : R.deltaNegW
  let yards: number
  if (td) yards = 100 - yard
  else if (oob) yards = Math.round(fieldGain)
  else yards = Math.round(planned + dw * dev + R.bias)
  yards = clamp(yards, -10, 99)
  const forced = missedSet.size > 0

  // CLOCK_ON: a runner forced out of bounds is still credited to a defender.
  if (oob && inp.clockOn && !tacklerId) tacklerId = nearestId()

  if (E1_STAT.on) {
    E1_STAT.n++
    E1_STAT.sumYards += yards
    E1_STAT.sumYards2 += yards * yards
    if (yards <= 0) E1_STAT.nonpos++
    if (yards >= 10) E1_STAT.ge10++
    if (td) E1_STAT.tds++
    if (oob) E1_STAT.oob++
    E1_STAT.sumPlanned += planned
    E1_STAT.sumField += fieldGain
    E1_STAT.sumDelta += fieldGain - planned
    E1_STAT.attempts += attempts
    if (E1_STAT.delta0.length < 200000) E1_STAT.delta0.push(+(fieldGain - planned).toFixed(3))
    if (E1_STAT.field0.length < 200000) E1_STAT.field0.push(+fieldGain.toFixed(2))
    {
      const pk = inp.carrier.pos
      E1_STAT.posN[pk] = (E1_STAT.posN[pk] ?? 0) + 1
      E1_STAT.posField[pk] = (E1_STAT.posField[pk] ?? 0) + fieldGain
      E1_STAT.posPlanned[pk] = (E1_STAT.posPlanned[pk] ?? 0) + planned
    }
    if (missed.length) E1_STAT.missed += missed.length
  }

  return {
    yards,
    tacklerId: td ? undefined : tacklerId,
    missedTackleIds: missed.length ? missed : undefined,
    forcedMissedIds: forced ? [inp.carrier.id] : undefined,
    outOfBounds: oob || undefined,
    scorerId: td ? inp.carrier.id : undefined,
    carryPath: path,
    fieldPaths,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// r2returns — returns on the field (REALISM2 row #1).
//
// Today a kick or punt return is three deterministic hashes: a kind partition
// (fair catch / downed / touchback / muff / return), a bell-shaped yardage
// `returnYards(returner score vs ONE cover man)`, and a TD coin flip. One cover
// man is named; the other ten never move; the blockers never block.
//
// This file inverts it when `R2RET.on`: the men on the play decide.
//   • the RETURNER runs at his own pace (`paceFor` + `fatiguePace`, the one speed
//     model) up a lane he chooses himself: on each lane across the field he reads
//     the coverage that can still get there, and his own BCV/AWR decide how often
//     he takes the open one (a poor returner runs into the first wave);
//   • the COVERAGE starts from the kick — every cover man is placed by his own
//     pace against the hang time (`gap_i = travel − hang × his own top speed`),
//     spread over real lanes — and pursues on an intercept angle whose lead is his
//     own AWR/PUR (a poor read undercuts the true line);
//   • the RETURN TEAM's blockers fire at the men coming into their area; a block
//     HOLDS for a time from the blockers' own RBK/IMP against the cover man's own
//     BSH/STR (the same blend the run field uses), drives him out of the lane while
//     it holds, then he sheds and chases;
//   • a free cover man closing to `contactR` makes the tackle attempt through the
//     engine's own `tackleMissChance` (fed the real closing geometry), lifted by
//     the returner's own vision/balance (BCV/AWR); a whiff lets him burst on and
//     the next pursuer attempt;
//   • the returner DECIDES, on his own ratings: a fair catch when the coverage is
//     on him at the catch (AWR), a kneel in the end zone, a downed punt when a
//     cover man is on the ball before he can field it, and a MUFF when his own CTH
//     loses a ball the hang time says he has to field in a crowd;
//   • out of bounds when he is forced over the chalk, a touchdown at the goal line,
//     and a `maxT` tail fallback so a field bug can never make a 109-yd play.
//
// Every effect is each man's OWN rating; there is no unit or league average
// anywhere (the unit mean survives only inside the OFF anchor, which the field
// deviates from). Determinism: ZERO `rng()` draws are added or removed — every
// decision is `hash32`/`h01` on `${key}:r2ret:…`, and every draw the replaced
// block used (the punt `gross` rng() and the per-play hashes) is still consumed at
// exactly the same point by the caller. `setR2Returns(false)` makes the resolver
// never enter this file (byte-identical OFF path).
//
// CALIBRATION. Every knob lives in `R2RET`. The yardage is the OFF anchor (the
// calibrated yardage for THIS play — its own scheme anchor) plus the field's own
// DEVIATION from its measured centre, scaled by `deltaW`, plus a small per-site
// `bias` — the same pattern E1a/E1b use, so the league's return distribution and
// every band hold while the men decide where in it a return lands. `R2RET_STAT`
// (never read by the sim) accumulates the raw field numbers for the probe.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player } from '../types'
import { clamp, hash32 } from './rng'
import { effAttrs, fatiguePace, paceFor } from './pace'
import type { LPt } from './liveField'

const FH = 53.3
const MID = FH / 2
const SIDE_LO = 1
const SIDE_HI = 52.3

/** h01 on a key (hash32 → [0,1)) — never an rng() draw. */
function h01(key: string): number {
  return (hash32(key) >>> 0) / 4294967296
}
/** The effective rating a player carries (own; never a unit average). */
function rat(p: Player | undefined, key: string, fallback = 70): number {
  if (!p) return fallback
  const v = effAttrs(p)[key]
  return typeof v === 'number' ? v : fallback
}

/**
 * Every constant r2returns adds, in one place. Tune only here.
 */
export const R2RET = {
  // OFF until the 3x500 ON panel and the fixed-seed check-broadcast harness both
  // pass (see the verify file): the ON returns change the harness game's stream,
  // which trips fragile fixed-seed broadcast checks. `setR2Returns(true)` is the
  // dev toggle; ON is calibrated (probe + 20-game bands) but not the default.
  on: false,

  // ── the field ──────────────────────────────────────────────────────────────
  dt: 0.05,
  /** The play ends as a run-down if nobody reached the returner by then. */
  maxT: 8.0,
  /** A free cover man inside this distance makes the tackle attempt. */
  contactR: 0.95,
  /** Recorded-path cadence (ticks between `paths` points). */
  pathEvery: 4,

  // ── the returner ───────────────────────────────────────────────────────────
  /** He runs with the ball: a fraction of his own top speed. */
  carryTop: 0.92,
  /** A broken tackle is a burst (a multiplier on that top speed). */
  burstSpeed: 1.06,
  burstDur: 0.45,
  /** A whiff shoves him sideways a touch (a juke into the gap). */
  juke: 2.2,
  /** The lateral drift of a return aimed wide (yd/s, toward that sideline). */
  wideDrift: 0.6,
  /** How far from the middle counts as "aiming at the corner" (yd). */
  cornerFrom: 15,
  /** His aim runs this far ahead so `steer` never brakes into it (yd). */
  aimLead: 9,

  // ── vision: which lane he takes ────────────────────────────────────────────
  laneN: 9,
  /** 1 = he runs blind (a hash lane); 0 = he always reads it. */
  visionW: 0.9,
  visionBcvW: 0.6,
  visionAwrW: 0.4,
  visionCentre: 73,

  // ── the coverage ───────────────────────────────────────────────────────────
  /** The lateral span the cover lanes cover (yd). */
  covSpreadPunt: 30,
  covSpreadKick: 38,
  /** The coverage does not run at top speed for the whole hang — they track the
   *  ball and break down on arrival, so they cover this fraction of the hang at
   *  their own top speed. */
  covRunFrac: 0.75,
  /** How far behind the catch the nearest cover man still is (yd) — the coverage
   *  times the ball, so the fastest man arrives on him, not upfield of him. */
  covLeadPunt: 6.5,
  covLeadKick: 9,
  /** The rest are strung out by the ground they did not cover (yd per yd). */
  covStrideW: 1.0,
  /** A chasing cover man runs at this much of his own top speed. */
  covBoost: 1.05,
  /** The last line (the punter / kicker): he starts this far upfield of the ball
   *  — behind the coverage wave but between the returner and the goal — so a
   *  returner who beats the wave meets the last line instead of a free sprint. */
  deepGapPunt: 17,
  deepGapKick: 26,
  /** A cover man reads the return after this long (s) — his own first step. */
  reactBase: 0.16,
  reactAwrW: 0.006,
  reactLo: 0.04,
  reactHi: 0.4,
  /** The intercept lead (his own AWR/PUR take the true angle or undercut). */
  pursuitLead: 0.72,
  leadAwrW: 0.0035,
  leadPurW: 0.0025,
  leadLo: 0.45,
  leadHi: 0.95,
  /** A man chasing gets this fraction of his own top speed (a tackler flies). */
  chaseBoost: 1.12,
  /** A man the returner has already beaten chases at his own top speed — no
   *  free catch-up: a slower man does not run down a faster one from behind. */
  chaseBehind: 1.12,
  /** The kicker/punter is the last line (he trails the return). */
  kickerSpeed: 0.7,

  // ── the return team's blocks ───────────────────────────────────────────────
  /** Hold (s) = base + w × (RBK·0.7+IMP·0.3 − BSH·0.5−STR·0.5). A return block
   *  is a beat, not a drive: it holds the man off the returner, then he sheds. */
  blockHoldBase: 0.5,
  blockHoldW: 0.016,
  blockHoldLo: 0.15,
  blockHoldHi: 1.5,
  /** While held, the cover man is driven back / out of the returner's lane. */
  pushBack: 0.8,
  pushLat: 2.2,
  /** How close a blocker must be to get his hands on a cover man (yd). */
  blockReach: 1.05,
  /** The wall stands a fraction of the way to the first cover man (yd). */
  wallFrac: 0.45,
  /** …and spans this wide around him (yd). */
  wallSpanPunt: 18,
  wallSpanKick: 24,
  /** A blocker looks for his man this far away (yd). */
  blockPick: 7,
  /** A blocked cover man can still tackle a returner who runs into him (a block
   *  stops the PURSUIT, not the tackle — real coverage does not evaporate). */
  pinnedTackle: true,
  /** A blocker with no man escorts the returner (yd ahead). */
  escortAhead: 3.2,

  // ── contact ────────────────────────────────────────────────────────────────
  /** The geometric openness handed to the engine's own `tackleMissChance`. */
  openScale: 2.4,
  /** A scale on the engine's miss chance (the league MT level knob). */
  missW: 1.0,
  missMax: 0.42,
  /** The returner's own vision/balance term on a tackle attempt (BCV/AWR). */
  visW: 0.0016,
  visCentre: 73,
  /** How long each side of a broken tackle needs to reset (s). */
  recoverT: 0.32,
  /** Only this many broken tackles stand on one return. */
  maxMiss: 1,

  // ── the returner's decisions ──────────────────────────────────────────────
  /** Hang time (s) = base + gross × perYd + (KPW − 80) × kpw — the punter's leg. */
  hangBase: 1.55,
  hangPerYd: 0.062,
  hangKpw: 0.012,
  hangLo: 3.2,
  hangHi: 5.6,
  /** A kickoff hangs almost flat: the ball travels in the air, not off a punt. */
  hangKickBase: 3.9,
  hangKickLo: 3.2,
  hangKickHi: 4.6,
  /** Coverage this close (yd) at the catch is "in his face". */
  pressR: 4.5,
  /** A man this close at the catch can down the punt before it is fielded. */
  downR: 1.8,
  /** Fair catch: base + close-term + his own judgement (AWR). */
  fcBase: 0.04,
  fcClose: 0.22,
  fcAwrW: 0.0022,
  fcLo: 0,
  fcHi: 0.72,
  /** Downed when the coverage is right on the ball. */
  downBase: 0.001,
  downClose: 0.02,
  downLo: 0,
  downHi: 0.4,
  /** Muff: his own CTH against the hang time and the press. */
  muffBase: 0.03,
  muffCthW: 0.0009,
  muffHangW: 0.0055,
  muffPressW: 0.004,
  muffLo: 0.004,
  muffHi: 0.11,
  /** Kneel in the end zone: base + his own judgement / his own speed. */
  kneelBase: 0.16,
  kneelAwrW: 0.004,
  kneelSpdW: 0.004,
  kneelLo: 0.12,
  kneelHi: 0.75,

  // ── out of bounds (forced over the chalk) ─────────────────────────────────
  /** How far off the middle starts to count as wide (yd). */
  oobFrom: 10,
  oobW: 0.012,
  oobMax: 0.18,
  /** The forcer has to be this close (yd) for the end to count as forced out. */
  oobR: 2.2,

  /** A man this close when he reaches the goal line drags him down at the 1. */
  goalTackleR: 6,
  /** A long return costs him top speed (the coverage closes late). */
  endurStart: 12,
  endurW: 0.0035,
  endurLo: 0.84,

  // ── the tail fallback (nobody reached): a run-down, never a free 100 ───────
  tailLo: 0.55,
  tailHi: 0.95,

  // ── centring: the calibrated anchor plus the field's own deviation ────────
  /** How much of the field's own deviation reaches the yards (per site: the
   *  field swings far harder on a kickoff than on a punt). */
  deltaPunt: 0.5,
  deltaKick: 0.14,
  /** The measured mean of the field's own end distance per site (probe). */
  centrePunt: 9.4,
  centreKick: 7.5,
  /** A flat shift to the NFL mean per site (the one mean knob per site). */
  biasPunt: -2.2,
  biasKick: 1.8,
  /** The emitted yards are clamped like the OFF chain's own clamp. */
  loPunt: -4,
  hiPunt: 45,
  loKick: 0,
  hiKick: 99,
} as const

interface MutableR2RET {
  on: boolean
  centrePunt: number
  centreKick: number
  biasPunt: number
  biasKick: number
}
const CFG = R2RET as unknown as MutableR2RET

/** r2returns: the dev toggle. */
export function setR2Returns(on: boolean): void {
  CFG.on = on
}
/** r2returns: read the toggle so a probe can restore it exactly. */
export function getR2Returns(): boolean {
  return CFG.on
}

/** Probe-only accumulator (never read by the sim). */
interface StatBucket {
  n: number
  sumYards: number
  sumField: number
  sumAnchor: number
  sumNear: number
  ge20: number
  ge40: number
  tds: number
  oob: number
  kinds: Record<string, number>
  field0: number[]
  near0: number[]
}
function newBucket(): StatBucket {
  return { n: 0, sumYards: 0, sumField: 0, sumAnchor: 0, sumNear: 0, ge20: 0, ge40: 0, tds: 0, oob: 0, kinds: {}, field0: [], near0: [] }
}
export const R2RET_STAT = {
  on: false,
  /** Punts. */
  P: newBucket(),
  /** Kickoffs. */
  K: newBucket(),
  reset() {
    this.P = newBucket()
    this.K = newBucket()
  },
}
function statBump(S: StatBucket, kind: string, yards: number, field: number, anchor: number, td: boolean, oob: boolean, near: number) {
  S.n++
  S.kinds[kind] = (S.kinds[kind] ?? 0) + 1
  S.sumYards += yards
  S.sumField += field
  S.sumAnchor += anchor
  S.sumNear += near
  if (yards >= 20) S.ge20++
  if (yards >= 40) S.ge40++
  if (td) S.tds++
  if (oob) S.oob++
  if (S.field0.length < 200000) S.field0.push(+field.toFixed(2))
  if (S.near0.length < 200000) S.near0.push(+near.toFixed(2))
}

/** The punter's / kicker's own hang time (s) for a kick of `gross` yards. */
export function returnHang(kicker: Player | undefined, gross: number, kind: 'punt' | 'kickoff' = 'punt'): number {
  const kpw = rat(kicker, 'KPW', 80)
  if (kind === 'kickoff') return clamp(R2RET.hangKickBase + (kpw - 80) * R2RET.hangKpw, R2RET.hangKickLo, R2RET.hangKickHi)
  return clamp(R2RET.hangBase + gross * R2RET.hangPerYd + (kpw - 80) * R2RET.hangKpw, R2RET.hangLo, R2RET.hangHi)
}

/** The pace a man runs at (his own SPD/ACC, his own fatigue). */
function paceOf(p: Player, fat: Record<string, number> | undefined, mul = 1): { top: number; acc: number } {
  const pc = paceFor(p, p.pos)
  const fp = fatiguePace(fat?.[p.id])
  return { top: pc.top * fp.top * mul, acc: pc.acc * fp.acc }
}

/** A run-block blend for a blocker (his own RBK/IMP — the run field's own). */
function blkBlend(p: Player): number {
  return rat(p, 'RBK') * 0.7 + rat(p, 'IMP') * 0.3
}
/** A shed blend for a cover man (his own BSH/STR — the run field's own). */
function defBlend(p: Player): number {
  return rat(p, 'BSH') * 0.5 + rat(p, 'STR') * 0.5
}
/** The block hold time (s) for one specific blocker on one specific cover man. */
export function blockHoldTime(blocker: Player, cover: Player): number {
  return clamp(
    R2RET.blockHoldBase + R2RET.blockHoldW * (blkBlend(blocker) - defBlend(cover)),
    R2RET.blockHoldLo, R2RET.blockHoldHi,
  )
}
/** The returner's own vision (BCV/AWR) — the lane he takes. */
export function returnVision(ret: Player): number {
  return rat(ret, 'BCV') * R2RET.visionBcvW + rat(ret, 'AWR') * R2RET.visionAwrW
}
/** The cover man's own pursuit read (AWR/PUR) — the angle he takes. */
export function coverRead(p: Player): number {
  return rat(p, 'AWR') * R2RET.leadAwrW + rat(p, 'PUR') * R2RET.leadPurW
}

interface Man {
  p: Player
  d: number
  y: number
  vd: number
  vy: number
  top: number
  acc: number
  /** First-step delay (s) — a cover man reads the return on his own AWR. */
  react: number
  /** While `< t` he is still held on his block (he never attempts a tackle). */
  pinned: number
  pinD: number
  pinY: number
  /** While `< t` he is recovering from a broken tackle. */
  recover: number
  /** The blocker's man (the cover man he is going to hit), or undefined. */
  target?: number
}

export interface ReturnOnIn {
  n: number
  /** The kicking club (hash scope). */
  kickingId: string
  kind: 'punt' | 'kickoff'
  /** The existing per-play key (the ON path hashes off it). */
  key: string
  /** The receiving team's goal line is `goal` yards from the catch point. */
  goal: number
  /** The returner — his own ratings decide it. */
  returner: Player
  /** The kicking club's cover men (each of them). */
  cover: Player[]
  /** The punter / kicker — the last line (he trails the return at his own pace). */
  kicker?: Player
  /** The receiving club's blockers (each of them). */
  blockers: Player[]
  fat?: Record<string, number>
  /** The OFF yardage for this play — the calibration anchor. */
  anchor: number
  /** The travel the coverage has to run from the kick to the catch (yd). */
  travel: number
  /** The kick's own hang time (s) — the punter's / kicker's leg. */
  hang: number
  /** The ball comes down in the end zone (a punt: yard + gross ≥ 100). */
  inEndZone: boolean
  /** The engine's own tackle-miss probability, fed the real geometry. */
  missChance: (def: Player, openness: number) => number
  clockOn: boolean
}

export interface ReturnOnOut {
  kind: 'return' | 'fairCatch' | 'downed' | 'touchback' | 'muff'
  /** The yards recorded on the return (0 on a fair catch / downed / kneel). */
  yards: number
  td: boolean
  oob: boolean
  /** The cover man credited with the stop (undefined on a score). */
  tacklerId?: string
  /** The cover man left grasping on a broken tackle (bookkeeping). */
  missedId?: string
  /** The field's own end distance (probe: the centring). */
  fieldYard: number
  /** The nearest cover man at the catch (yd) — the pressure that decided it. */
  nearD: number
  /** The returner's recorded path (the animation draws it). */
  path: LPt[]
  /** Every cover man's recorded path (the animation draws them). */
  paths: Record<string, LPt[]>
}

/** Steer a man toward (td,ty) at his own pace, accel-limited (no teleport). */
function steer(m: Man, td: number, ty: number, dt: number, accMul = 1) {
  const dd = td - m.d
  const dy = ty - m.y
  const L = Math.sqrt(dd * dd + dy * dy)
  const acc = Math.max(2, m.acc) * accMul
  const sp = L < 0.05 ? 0 : m.top
  const ud = L > 1e-6 ? dd / L : 0
  const uy = L > 1e-6 ? dy / L : 0
  let dvd = ud * sp - m.vd
  let dvy = uy * sp - m.vy
  const dl = Math.sqrt(dvd * dvd + dvy * dvy)
  const lim = acc * dt
  if (dl > lim) {
    dvd *= lim / dl
    dvy *= lim / dl
  }
  m.vd += dvd
  m.vy += dvy
  m.d += m.vd * dt
  m.y += m.vy * dt
}

/** Spread `n` lanes across the field centred on `cy`, spanning `span` yards. */
function spreadY(i: number, n: number, span: number, cy: number): number {
  if (n <= 1) return clamp(cy, SIDE_LO, SIDE_HI)
  const lo = clamp(cy - span / 2, SIDE_LO, SIDE_HI - span)
  return clamp(lo + (span * i) / (n - 1), SIDE_LO, SIDE_HI)
}

/**
 * r2returns: one kick or punt return decided on the field. Returns the kind the
 * returner chose (fair catch / downed / touchback / muff / return), the yards, the
 * touchdown, the forcer and the recorded paths — the fields the replaced block
 * produced, plus the paths for the animation.
 */
export function returnsOnField(inp: ReturnOnIn): ReturnOnOut {
  const R = R2RET
  const key = `${inp.key}:r2ret`
  const ret = inp.returner
  const fat = inp.fat
  const punt = inp.kind === 'punt'

  // ── the catch lateral and the returner's own pace ──────────────────────────
  const catchY = clamp(MID + (h01(`${key}:cy`) - 0.5) * (punt ? 34 : 26), SIDE_LO + 1, SIDE_HI - 1)
  const rp = paceOf(ret, fat)
  const rTop = rp.top * R.carryTop
  const gym = rat(ret, 'AWR', 70)
  const cth = rat(ret, 'CTH', 70)
  const spd = rat(ret, 'SPD', 70)

  // ── the coverage: every man placed by his own pace against the hang time ───
  // The coverage runs FROM the kick TOWARD the receiving end zone. It cannot get
  // to the ball in the hang (`hang × top` yards < the travel), so at the catch
  // every man is still BEHIND the ball — between the kick and the returner — at
  // his own top speed and closing. How far behind is his own pace: the man who
  // covered the most ground is nearest (`covLead`), the rest are strung out by
  // what they did not cover (`covStrideW`). The returner starts from a standstill
  // and must out-accelerate / out-run that wave; a man he outran is a man behind
  // him for the rest of the play. The punter / kicker is the exception: the last
  // line, he is between the returner and the goal (a return that beats everyone
  // meets him), running back at the return.
  const cov: Man[] = []
  const covMen = inp.kicker ? [...inp.cover, inp.kicker] : inp.cover
  const nCov = covMen.length
  const spanC = punt ? R.covSpreadPunt : R.covSpreadKick
  let maxCovered = 0
  for (const p of covMen) {
    if (inp.kicker && p.id === inp.kicker.id) continue
    maxCovered = Math.max(maxCovered, inp.hang * paceOf(p, fat).top * R.covRunFrac)
  }
  for (let i = 0; i < nCov; i++) {
    const p = covMen[i]
    const isKick = !!inp.kicker && p.id === inp.kicker.id
    // The punter / kicker is the last line: he trails the return at his own pace.
    const pc = paceOf(p, fat, isKick ? R.kickerSpeed : 1)
    const lane = spreadY(i, nCov, spanC, catchY)
    // Behind the catch by his own shortfall; a kick's last line starts upfield.
    const startD = isKick
      ? (punt ? R.deepGapPunt : R.deepGapKick)
      : -((punt ? R.covLeadPunt : R.covLeadKick) + (maxCovered - inp.hang * pc.top * R.covRunFrac) * R.covStrideW)
    cov.push({
      p, d: startD, y: lane, vd: (startD < 0 ? 1 : -1) * pc.top * R.covBoost, vy: 0,
      top: pc.top, acc: pc.acc,
      react: clamp(R.reactBase - (rat(p, 'AWR', 70) - 70) * R.reactAwrW, R.reactLo, R.reactHi),
      pinned: 0, pinD: 0, pinY: 0, recover: 0,
    })
  }
  let nearD = inp.travel
  for (const m of cov) {
    const dd = Math.max(0, Math.hypot(m.d, m.y - catchY))
    if (dd < nearD) nearD = dd
  }

  // ── the returner's own decision at the catch ───────────────────────────────
  let kind: ReturnOnOut['kind'] = 'return'
  if (punt && inp.inEndZone) {
    // The ball comes down in the end zone: he kneels or brings it out, on his own
    // judgement (AWR) and his own speed.
    const pk = clamp(R.kneelBase + (gym - 75) * R.kneelAwrW - (spd - 75) * R.kneelSpdW, R.kneelLo, R.kneelHi)
    kind = h01(`${key}:tbdec`) < pk ? 'touchback' : 'return'
  } else {
    const press = nearD < R.pressR ? R.pressR - nearD : 0
    const muffP = clamp(
      R.muffBase - (cth - 70) * R.muffCthW + (4.3 - inp.hang) * R.muffHangW + press * R.muffPressW,
      R.muffLo, R.muffHi,
    )
    if (h01(`${key}:muff`) < muffP) kind = 'muff'
    else {
      const close = nearD < R.pressR ? (R.pressR - nearD) / R.pressR : 0
      const fcP = clamp(R.fcBase + R.fcClose * close + (gym - 75) * R.fcAwrW, R.fcLo, R.fcHi)
      const downP = clamp(R.downBase + R.downClose * (nearD < R.downR ? 1 - nearD / R.downR : 0), R.downLo, R.downHi)
      const u = h01(`${key}:kind`)
      if (u < fcP) kind = 'fairCatch'
      else if (u < fcP + (1 - fcP) * downP) kind = 'downed'
      else kind = 'return'
    }
  }

  if (kind !== 'return') {
    if (R2RET_STAT.on) statBump(punt ? R2RET_STAT.P : R2RET_STAT.K, kind, 0, 0, 0, false, false, nearD)
    return {
      kind, yards: 0, td: false, oob: false, fieldYard: 0, nearD,
      path: [{ x: 0, y: catchY }], paths: {},
    }
  }

  // ── the return team's blockers ─────────────────────────────────────────────
  // They set a WALL between the returner and the coverage coming at him: each man
  // holds his spot in the wall, takes the cover man who comes into his area, and
  // HOLDS him for the block-win time of their own two ratings. A return is made
  // by the men the wall frees.
  const blk: Man[] = []
  const nBlk = inp.blockers.length
  const wall: { d: number; y: number }[] = []
  // Where the wall stands: the spot the first cover man will arrive at, so the
  // blocks actually happen on the coverage's own path (a punt's gunner is on the
  // ball, a kickoff's wave meets the returner 20+ yards upfield).
  let minGap = Infinity
  for (const m of cov) if (m.d < minGap) minGap = m.d
  const wallD0 = clamp(minGap * R.wallFrac, 1.5, 16)
  for (let i = 0; i < nBlk; i++) {
    const p = inp.blockers[i]
    const pc = paceOf(p, fat)
    const wallD = wallD0 + (i % 3) * 1.2
    const wallY = spreadY(i, nBlk, punt ? R.wallSpanPunt : R.wallSpanKick, catchY)
    wall.push({ d: wallD, y: wallY })
    blk.push({
      p, d: wallD, y: wallY, vd: 0, vy: 0,
      top: pc.top, acc: pc.acc, react: 0, pinned: 0, pinD: 0, pinY: 0, recover: 0,
      target: undefined,
    })
  }

  // ── the returner's lane: his own read of the coverage ─────────────────────
  // For every lane across the field he asks "how long until the first cover man
  // can meet me there?", and takes the lane with the most time. His own BCV/AWR
  // decide how much of that read he gets: a poor returner blends toward a hash
  // lane and runs into the first wave.
  const vision = returnVision(ret) - R.visionCentre
  const blind = clamp(R.visionW - vision * 0.012, 0, 1)
  const laneSpan = punt ? 30 : 38
  const laneScores: { y: number; score: number }[] = []
  for (let i = 0; i < R.laneN; i++) {
    const ly = spreadY(i, R.laneN, laneSpan, catchY)
    let meet = Infinity
    for (const m of cov) {
      const d0 = Math.hypot(m.d, m.y - ly) - R.contactR
      const t = Math.max(0, d0) / Math.max(1.5, rTop + m.top)
      if (t < meet) meet = t
    }
    laneScores.push({ y: ly, score: meet })
  }
  laneScores.sort((a, b) => b.score - a.score)
  const bestLane = laneScores[0]?.y ?? catchY
  const hashLane = spreadY(h01(`${key}:lane`) * R.laneN, R.laneN, laneSpan, catchY)
  const aimY = clamp(bestLane * (1 - blind) + hashLane * blind, SIDE_LO, SIDE_HI)

  const carrier: Man = {
    p: ret, d: 0, y: catchY, vd: 0, vy: 0, top: rTop, acc: rp.acc,
    react: 0, pinned: 0, pinD: 0, pinY: 0, recover: 0,
  }

  const path: LPt[] = [{ x: carrier.d, y: carrier.y }]
  const paths: Record<string, LPt[]> = { [ret.id]: path }
  let td = false
  let oob = false
  let stopD: number | null = null
  let tacklerId: string | undefined
  let missedId: string | undefined
  let missN = 0
  let missBurst = -1
  let t = 0
  let tick = 0

  /** The nearest free cover man able to attempt (by his own read timers). */
  const nearFree = (): Man | null => {
    let best: Man | null = null
    let bd = Infinity
    for (const m of cov) {
      if ((m.pinned > t && !R.pinnedTackle) || t < m.react || t < m.recover) continue
      const dd = Math.hypot(m.d - carrier.d, m.y - carrier.y)
      if (dd < bd) { bd = dd; best = m }
    }
    return best
  }
  /** A forced out-of-bounds end (hash-only, and only with a man on him). */
  const oobRoll = (dist: number): boolean => {
    if (dist > R.oobR) return false
    const lat = Math.abs(carrier.y - MID)
    const pOob = clamp((lat - R.oobFrom) * R.oobW, 0, R.oobMax)
    return pOob > 0 && h01(`${key}:oob`) < pOob
  }

  while (t < R.maxT - 1e-9) {
    t += R.dt
    tick++
    // ── the returner: run his lane (a corner return drifts to that chalk) ────
    const wide = Math.abs(aimY - MID)
    const aimYNow = wide > R.cornerFrom
      ? clamp(aimY + (aimY >= MID ? 1 : -1) * R.wideDrift * t, SIDE_LO, SIDE_HI)
      : aimY
    // A long return wears on him: his top speed decays past `endurStart` so the
    // coverage closes on the tail (a house call is a breakaway, not a jog).
    carrier.top = rTop * clamp(1 - R.endurW * Math.max(0, carrier.d - R.endurStart), R.endurLo, 1)
    steer(carrier, carrier.d + R.aimLead, aimYNow, R.dt, missN > 0 && t < missBurst ? R.burstSpeed : 1)
    // The sideline is a hard wall: a man with nobody on him cannot step out.
    if (carrier.y < SIDE_LO) { carrier.y = SIDE_LO; carrier.vy = 0 }
    else if (carrier.y > SIDE_HI) { carrier.y = SIDE_HI; carrier.vy = 0 }
    if (carrier.d >= inp.goal) {
      // A score only when he actually outran the coverage: a man on his heels at
      // the goal line gets him down at the 1 (the field still says how he got there).
      const nearGoal = nearFree()
      const heel = nearGoal ? Math.hypot(nearGoal.d - carrier.d, nearGoal.y - carrier.y) : 99
      if (heel <= R.goalTackleR) {
        stopD = inp.goal - 0.5
        tacklerId = nearGoal?.p.id
      } else td = true
      path.push({ x: carrier.d, y: carrier.y })
      break
    }

    // ── the coverage: pursue on the intercept angle their own read gives ─────
    for (const m of cov) {
      if (m.pinned > t) {
        m.d += m.pinD * R.dt
        m.y = clamp(m.y + m.pinY * R.dt, SIDE_LO - 3, SIDE_HI + 3)
        continue
      }
      if (t < m.react || t < m.recover) continue
      // In front: take the undercut (his own read). Behind: chase at/past the
      // carrier's true future spot - an undercut from behind only loses ground.
      const lead = m.d < carrier.d
        ? clamp(1.02 + coverRead(m.p) * 0.4, 1.02, R.leadHi)
        : clamp(R.pursuitLead + coverRead(m.p) - 0.6, R.leadLo, R.leadHi)
      let ts = 0.3
      for (let tau = 0.2; tau <= 3.5 + 1e-6; tau += 0.2) {
        ts = tau
        const qd = carrier.d + carrier.vd * tau
        const qy = carrier.y + carrier.vy * tau
        if (Math.hypot(qd - m.d, qy - m.y) - R.contactR <= m.top * tau) break
      }
      steer(m, carrier.d + carrier.vd * ts * lead, carrier.y + carrier.vy * ts * lead, R.dt,
        m.d > carrier.d ? R.chaseBoost : R.chaseBehind)
    }

    // ── the blockers: hold the wall, take the man who comes into the area ────
    // A cover man is claimed by one blocker; a freed man can be picked up again.
    const claimed = new Set<number>()
    for (let bi = 0; bi < blk.length; bi++) {
      const b = blk[bi]
      if (b.target != null) {
        const d = cov[b.target]
        if (d.pinned > t) { b.target = undefined; continue }
        const dd = Math.hypot(d.d - b.d, d.y - b.y)
        const lead = clamp(dd / Math.max(2.5, b.top + Math.abs(d.vd)), 0, 0.7)
        if (dd <= R.blockReach) {
          d.pinned = t + blockHoldTime(b.p, d.p)
          const away = d.y - carrier.y
          const sgn = away === 0 ? (h01(`${key}:push:${d.p.id}`) < 0.5 ? -1 : 1) : Math.sign(away)
          d.pinD = -R.pushBack
          d.pinY = sgn * R.pushLat
          b.target = undefined
        } else {
          claimed.add(b.target)
          steer(b, d.d + d.vd * lead, d.y + d.vy * lead, R.dt, 1)
        }
        continue
      }
      // Pick up a cover man coming into the area (a leaker), else hold the wall.
      let best = -1
      let bd = R.blockPick * R.blockPick
      for (let i = 0; i < cov.length; i++) {
        const m = cov[i]
        if (claimed.has(i) || m.pinned > t || t < m.recover) continue
        const dd = (m.d - b.d) ** 2 + (m.y - b.y) ** 2
        if (dd < bd) { bd = dd; best = i }
      }
      if (best >= 0) {
        b.target = best
        claimed.add(best)
      } else {
        // Hold the wall spot (shuffle toward where the returner will need it).
        const w = wall[bi]
        steer(b, w.d, w.y + (carrier.y - catchY) * 0.5, R.dt, 0.9)
      }
    }

    // ── contact: the nearest free man in reach makes the attempt ─────────────
    const near = nearFree()
    if (near && Math.hypot(near.d - carrier.d, near.y - carrier.y) <= R.contactR) {
      const dd = Math.max(1e-6, Math.hypot(near.d - carrier.d, near.y - carrier.y))
      const ud = (carrier.d - near.d) / dd
      const uy = (carrier.y - near.y) / dd
      const closing = (near.vd - carrier.vd) * ud + (near.vy - carrier.vy) * uy
      const mv = Math.max(0.5, Math.hypot(near.vd, near.vy))
      const ac = (near.vd * ud + near.vy * uy) / mv
      const openness = clamp((1 - clamp(ac, -1, 1)) * 0.5 * clamp(closing, 0, 14) * R.openScale, 0, 30)
      const chance = clamp(
        inp.missChance(near.p, openness) * R.missW + (returnVision(ret) - R.visCentre) * R.visW,
        0.004, R.missMax,
      )
      if (missN < R.maxMiss && h01(`${key}:mt:${near.p.id}:${tick}`) < chance) {
        missN++
        if (!missedId) missedId = near.p.id
        near.recover = t + R.recoverT
        near.d -= ud * 0.4
        near.y -= uy * 0.4
        carrier.vd -= ud * R.juke
        carrier.vy -= uy * R.juke
        missBurst = t + R.burstDur
      } else if (oobRoll(Math.hypot(near.d - carrier.d, near.y - carrier.y))) {
        oob = true
        tacklerId = near.p.id
        break
      } else {
        stopD = carrier.d
        tacklerId = near.p.id
        break
      }
    }

    if (tick % R.pathEvery === 0) {
      for (const m of cov) {
        if (m.pinned > t) continue
        let fp = paths[m.p.id]
        if (!fp) { fp = []; paths[m.p.id] = fp }
        fp.push({ x: m.d, y: m.y })
      }
      for (const b of blk) {
        let fp = paths[b.p.id]
        if (!fp) { fp = []; paths[b.p.id] = fp }
        fp.push({ x: b.d, y: b.y })
      }
    }
    path.push({ x: carrier.d, y: carrier.y })
  }

  // ── the tail fallback ──────────────────────────────────────────────────────
  let fieldYard: number
  if (td) fieldYard = inp.goal
  else if (oob) fieldYard = carrier.d
  else if (stopD !== null) fieldYard = stopD
  else {
    const cur = Math.max(0, carrier.d)
    const u = h01(`${key}:tail`)
    fieldYard = Math.min(cur, cur * Math.min(1, R.tailLo + (R.tailHi - R.tailLo) * u))
    if (!tacklerId) tacklerId = nearFree()?.p.id
  }
  const forced = missN > 0

  // ── the yards: the calibrated anchor plus the field's own deviation ────────
  const centre = punt ? R.centrePunt : R.centreKick
  const bias = punt ? R.biasPunt : R.biasKick
  const dev = fieldYard - centre
  const dw = punt ? R.deltaPunt : R.deltaKick
  let yards: number
  if (td) yards = Math.max(1, Math.round(inp.goal))
  else if (oob) yards = Math.round(fieldYard)
  else yards = Math.round(inp.anchor + dw * dev + bias)
  yards = clamp(yards, punt ? R.loPunt : R.loKick, punt ? R.hiPunt : R.hiKick)

  if (R2RET_STAT.on) statBump(punt ? R2RET_STAT.P : R2RET_STAT.K, 'return', yards, fieldYard, inp.anchor, td, oob, nearD)

  return {
    kind: 'return',
    yards,
    td,
    oob,
    tacklerId: td ? undefined : tacklerId,
    missedId: forced ? missedId : undefined,
    fieldYard,
    nearD,
    path,
    paths,
  }
}

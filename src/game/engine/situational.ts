// ─────────────────────────────────────────────────────────────────────────────
// J1: situational pass rate — down × distance × score × clock, incl. game script
//
// play-realism (1,200 sim NFL games vs nflverse 2021-25) found the sim's run/pass
// split almost flat by situation: 2nd & long, 4th-down go snaps and late-game
// leads all sat near the league rate instead of following the NFL. This module
// holds the NFL down×distance pass table and a small deterministic model on top:
//
//   P(pass) = sigmoid( logit(tableCell) + leagueOffset + scriptLean + zoneLean )
//             + identity * IDENT_SCALE                         (probability units)
//
// * `base` is the NFL table cell for the snap's down and distance bucket.
// * the game-script lean is logit-additive in margin × time (Q4 and the last two
//   minutes of either half, ramping with the clock and saturating with |margin|):
//   a big late lead runs the ball, a late deficit throws, and everyone throws in
//   the two-minute offence. 'hurry' adds a little more pass.
// * the zone lean keeps red-zone / goal-to-go / backed-up cells near the NFL.
// * the OC identity (`style.passRate − worldPassMean`) rides on top as a genuine
//   probability shift, so the club-to-club scheme spread survives.
// * `leagueOffset` is the single league-level constant solved with the probe so
//   the OVERALL pass rate holds the sim baseline (57.5%): the share is held, not
//   drifted, so plays/clock/yardage calibration bands do not move.
//
// Everything here is pure: no rng, no clock, no World. pickConcept() calls it with
// the snap's situation and uses the result as the threshold of the single rng()
// draw it already makes. `setSituational(false)` restores the legacy flat-lean
// expression in pickConcept() byte-for-byte (same rng draw order and count).
// ─────────────────────────────────────────────────────────────────────────────

/** The offense's two-minute mode (mirrors GameState.twoMinMode in playsim.ts). */
export type SituationTwoMin = 'hurry' | 'normal' | 'protect' | 'fgRange'

export interface SituationInput {
  /** 1–4. */
  down: number
  /** Yards to go. */
  distance: number
  /** 0–100 from the offense's own goal line. */
  yard: number
  /** 1–4. */
  qtr: number
  /** Seconds remaining in the quarter (900 at the start of a period). */
  clockSec: number
  /** Offense score minus defense score, before this snap. */
  margin: number
  /** The possession's two-minute mode, if any. */
  twoMinMode?: SituationTwoMin | null
  /** The club's OC identity already centred on the league mean
   *  (`style.passRate − worldPassMean`). Applied as a probability shift. */
  identity: number
}

/** Distance buckets: 1 / 2-3 / 4-6 / 7-10 / 11+. */
export type DistanceBucket = 0 | 1 | 2 | 3 | 4

/** NFL down×distance pass rates (nflverse 2021–25, play-realism.out). Rows are
 *  1st/2nd/3rd/4th down; columns are distance buckets 1 / 2-3 / 4-6 / 7-10 / 11+.
 *  4th-down rows are the pass rate on 4th-down GO snaps (the decision is J2). */
export const NFL_PASS_TABLE: readonly (readonly number[])[] = [
  [0.243, 0.341, 0.374, 0.503, 0.707], // 1st
  [0.304, 0.402, 0.530, 0.689, 0.810], // 2nd
  [0.251, 0.698, 0.908, 0.942, 0.897], // 3rd
  [0.278, 0.856, 0.951, 0.954, 0.956], // 4th (go snaps)
]

/** J1 tunables. Every constant the situational model adds lives here. The core
 *  calibration constants (R2/R15/calibration.json) are untouched. */
export const SITUATIONAL = {
  /** League-level share hold, solved with the probe so the overall pass rate
   *  equals the sim baseline (~57.5%). Logit-additive with the script/zone leans.
   *  The NFL down×distance shape sums to ~63% on the sim's play distribution, so
   *  the share hold shaves each cell; a logit (rather than flat-probability)
   *  shift concentrates the shave on the highest-volume mid cells, which is what
   *  the overall hold needs, and leaves the late-game high cells intact. */
  leagueOffset: -0.45,
  /** OC identity scale (probability units per unit of centred pass identity). */
  identScale: 0.9,
  /** Q4 game script: logit strength at saturation (tanh softness q4Soft). A lead
   *  runs the ball (q4LeadK), a deficit throws (q4TrailK). */
  q4LeadK: 2.2,
  q4TrailK: 1.5,
  q4Soft: 8,
  /** Q4 lateness ramp: strength at 15:00 (grows to 1 as the clock runs out). */
  q4RampMin: 0.6,
  /** Two-minute offence (last 2:00 of Q2/Q4): a base pass lean, reduced a little
   *  for a lead (tmLeadK) and raised for a deficit (tmTrailK). */
  tmBaseK: 1.0,
  tmLeadK: 0.2,
  tmTrailK: 0.62,
  tmSoft: 8,
  /** 'hurry' mode adds this much more pass on top of the script term. */
  hurryK: 0.15,
  /** Zone leans (logit), relative to the between-the-20s baseline. The table
   *  already carries most of the shape, so these only nudge the extremes.
   *  J1-fix: the goal-to-go lean is raised (zoneGtg 0.15 -> 0.22) so the most
   *  TD-prone snaps (goal-to-go runs convert ~48%) become passes instead, pulling
   *  Rushing TD back into band (J1 had left it high). zoneRz is nudged down to
   *  hold the overall pass share, since red-zone runs almost never score. */
  zoneBacked: 0,
  zonePlus: 0.18,
  zoneMid: 0,
  zoneRz: -0.09,
  zoneGl: 0.22,
  zoneGtg: 0.22,
  /** Returned probability is clamped here. */
  lo: 0.05,
  hi: 0.97,
}

/** J1 dev-only toggle (the setStamina pattern): default ON. With it OFF,
 *  pickConcept() runs the legacy flat-lean expression and the sim stream is
 *  byte-identical to unmodified main. Probes/calibration flip it; never the UI. */
let SITUATIONAL_ON = true
export function setSituational(on: boolean) {
  SITUATIONAL_ON = on
}
export function getSituational(): boolean {
  return SITUATIONAL_ON
}

const LOGIT_EPS = 1e-4
function logit(p: number): number {
  const q = Math.min(1 - LOGIT_EPS, Math.max(LOGIT_EPS, p))
  return Math.log(q / (1 - q))
}
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

/** The distance bucket a snap belongs to. */
export function distanceBucket(distance: number): DistanceBucket {
  if (distance <= 1) return 0
  if (distance <= 3) return 1
  if (distance <= 6) return 2
  if (distance <= 10) return 3
  return 4
}

/** Game-script lean (logit). Q4: a lead runs, a deficit throws, both ramping as
 *  the clock runs and saturating with |margin|. Last 2:00 of Q2/Q4: a two-minute
 *  pass lean, reduced for a lead and increased for a deficit. */
function scriptLean(sit: SituationInput): number {
  const S = SITUATIONAL
  const m = sit.margin
  const clock = Math.max(0, Math.min(900, sit.clockSec))
  const inTwoMin = (sit.qtr === 2 || sit.qtr === 4) && clock <= 120
  let term = 0
  if (inTwoMin) {
    term += S.tmBaseK + (m < 0 ? S.tmTrailK : -S.tmLeadK) * Math.tanh(Math.abs(m) / S.tmSoft)
  } else if (sit.qtr === 4) {
    const ramp = S.q4RampMin + (1 - S.q4RampMin) * (1 - clock / 900)
    const mag = Math.tanh(Math.abs(m) / S.q4Soft)
    term += (m >= 0 ? -S.q4LeadK : S.q4TrailK) * mag * ramp
  }
  if (sit.twoMinMode === 'hurry') term += S.hurryK
  return term
}

/** Field-zone lean (logit): backed up, between the 20s, beyond midfield, red
 *  zone and goal line, plus a small first-and-goal extra. */
function zoneLean(sit: SituationInput): number {
  const S = SITUATIONAL
  const y = sit.yard
  if (y >= 90) return S.zoneGl + (y + sit.distance >= 100 ? S.zoneGtg : 0)
  if (y >= 80) return S.zoneRz
  if (y >= 50) return S.zoneMid
  if (y >= 21) return S.zonePlus
  return S.zoneBacked
}

/** The situational pass probability for one snap, in [lo, hi]. Pure.
 *
 *  The game-script and zone leans and the league share hold are all logit-additive
 *  on the NFL table cell; the OC identity rides on top as a probability shift. */
export function situationalPassRate(sit: SituationInput): number {
  const S = SITUATIONAL
  const down = Math.max(1, Math.min(4, Math.round(sit.down))) - 1
  const cell = NFL_PASS_TABLE[down][distanceBucket(sit.distance)]
  // Script, zone and league-share leans are logit-additive on the table cell.
  const L = logit(cell) + S.leagueOffset + scriptLean(sit) + zoneLean(sit)
  const p = sigmoid(L) + sit.identity * S.identScale
  return Math.max(S.lo, Math.min(S.hi, p))
}

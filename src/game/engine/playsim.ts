// ─────────────────────────────────────────────────────────────────────────────
// Play-by-play simulation
//
// Every play is resolved from the *exact* player ratings (Madden 26 / CFB 26)
// and the coaching schemes from each club's coordinators. The output is a full
// play log with enough geometry for the 2D top-down match viewer.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player, Position, MatchupSet, UsageSet, PersonnelSet } from '../types'
import { playerAttrs } from '../data/ratings'
import { unscaleOvr } from './ovrScale'
import { POS_MEAN } from './ratingMeans'
import { bucketYards, CFB_CHUNK_DAMP, getCalibration, sampleBucket } from '../data/calibration'
import { NO_USER_BONUS, coachEffect } from './coaching'
import { depthAt, depthGroup } from './depth'
import { aiDefPackage, aiOffPersonnel, defenseCounts, offenseCounts, personnelEdge } from './personnel'
import { clubReturners, coverageScore, coverUnit, returnScore } from './returns'
import { planEffects, BALANCED_PLAN } from './gameplan'
import { aiCallSheet, coachTendency, offPassRate, fourthDownChoice, fourthDownEV, fourthGoPropensity, getFourthRetune, twoPointChoice, fgProb, fgRangeYard, bucketFor, offClassFor, callEffect, bestCounterCall, bestCounterClass, defCallForPlan, topKey, DEF_CALLS, OFF_CLASSES, OFF_PASS_RATE, BUCKET_LABEL, OFF_CLASS_LABEL, DEF_CALL_LABEL, worldPassMean, type CallSheet, type Situation, type Bucket, type OffClass, type DefCall, type CallEffect } from './decisions'
import { leagueMasteryMeans, masteryGroup, teamCohesion, type MasteryMeans } from './playbook'
import { DEFAULT_ST, normalizeSpecial, kickReturnMods, puntMods, onsideChance, surpriseChance, alertness, alertFakeEdge, type KickoffCall, type ReturnStrategy, type PuntStrategy, type SpecialTeamsPlan } from './specialCalls'
import { SCHEME_MENUS, SCHEME_MENUS_REALISM, MENU_REALISM, PLAYBOOK, conceptFromPlaybook, formationForConcept, type Personnel } from '../data/playbookData'
import { airYardsFor, depthAwareGain } from './airYards'
import { mod, schemeFit, styleProfile } from './style'
import { officiate, replayRead, challengeThreshold, aiThrows, resolveChallenge, spendChallenge, inBoothWindow, type ReviewSnapshot } from './review'
import type { PlayReview, PendingReview, ChallengeState } from './review'
import { getWeather, wxEffects, WX, WX_CENTER, type GameWeather, type WxEffects } from './weather'
import { clutchEdge, kickClutch } from './clutch'
import { getIndividual, positionRating } from './individual'
import { buildScoutReport, weaknessEdge, primaryTag, type ScoutFinding } from './scoutReport'

// The user's own coaching skill, set once per game by the store when they hold a
// coaching role. Kept module-level so every play resolution sees it without
// threading it through each resolver signature.
let USER_COACH: { teamId: string; off: number; def: number; development: number; situational: number; seat?: 'off' | 'def' | 'both' } | null = null
export function setUserCoaching(ctx: typeof USER_COACH) {
  USER_COACH = ctx
}
// R15: dev-only toggle so the stamina probe can A/B the feature. Default on; the
// shipped sim always leaves it on.
let STAMINA_ON = true
export function setStamina(on: boolean) {
  STAMINA_ON = on
}
/** R15: read the current stamina toggle so a probe can restore it exactly. */
export function getStamina(): boolean {
  return STAMINA_ON
}
// J6: clock / situational realism (kneels, spikes, out-of-bounds, QB scrambles,
// man-coverage share, the two-point chart). Dev-only toggle in the setStamina
// pattern; default on. With it OFF the engine is byte-identical to the
// unmodified sim: no rng() draw is added, no threshold is changed (every new
// decision is a deterministic hash).
let CLOCK_ON = true
export function setClockRealism(on: boolean) {
  CLOCK_ON = on
}
/** J6: read the current clock-realism toggle so a probe can restore it exactly. */
export function getClockRealism(): boolean {
  return CLOCK_ON
}

/**
 * J6: every constant this job adds, in one place. All of it is deterministic
 * (hashes / thresholds), never an rng() draw, so the OFF path is untouched.
 */
export const CLOCK_REALISM = {
  /** Game-clock seconds a kneeldown burns (the play clock runs down). */
  kneelBurn: 37,
  /** Safety seconds subtracted before a kneel can exhaust the clock. */
  kneelReserve: 6,
  /**
   * Deterministic share of otherwise-eligible kneel snaps that actually kneel.
   * Tuned to 0.8: a kneel is a rush attempt for negative yards (the sim clamps
   * every other negative run to 0), so each kneel costs the replaced carry's
   * positive yards too and drags team YPC toward the 4.15 floor. 0.8 holds the
   * NFL kneel rate (>= 0.568/team-game) while keeping YPC in band.
   */
  kneelGate: 0.8,
  /** Latest first-half clock (s) at which a kneel is still taken. */
  q2KneelMaxClock: 20,
  /** Game-clock seconds a spike burns (the snap itself). */
  spikeBurn: 4,
  /** Latest clock a spike is still worth using (seconds). */
  spikeMaxClock: 35,
  /** Hash gate on an otherwise-eligible spike. */
  spikeRate: 0.68,
  /** Multiple applied to the two-minute out-of-bounds chance outside the drill. */
  oobWiden: 1.15,
  /**
   * J6 compensation: a small run→pass lean added to the pass-rate roll (never to
   * R2) to offset the dropback a scramble converts to a rush. Left at 0 because the
   * scramble branch itself is backed out — see CLOCK_REALISM.scrambleBase.
   */
  passShift: 0,
  /**
   * Per-attempt scramble chance at scramble-style 0. BACKED OUT (0): a faithful
   * pressured-dropback scramble at the NFL 4.9% of dropbacks was verified, but it
   * necessarily converts ~1.9 pass plays/team-game into rushes and moves the
   * calibration's Pass attempts (↓2.5), Gross/Net passing yards (↓12), Passing TD
   * (↑0.1) and Rush attempts (↑2.2) out of band; the sim's baseline already sits at
   * the top of the rush-attempt band. A run→pass compensation (passShift) traded one
   * broken band for another, so — per the brief's fallback — the piece is backed out
   * rather than retuning R2. Set to 0.037 and passShift ≈ 0.039 to re-enable.
   */
  scrambleBase: 0,
  /** p = base × (1 + scrambleStyleSpan × scrambleStyle) × (pressured ? pressure : 1). */
  scrambleStyleSpan: 0.6,
  scramblePressure: 1.5,
  /** Scramble gain model (deterministic bell; mean ≈ 6.5 yds, ~25% first downs). */
  scrambleGainBase: 5.2,
  scrambleGainSpread: 9,
  scrambleSpdEdge: 0.06,
  /** DEF_STYLES overrides applied only while CLOCK_ON: manCoverage/blitz lowered
   *  to the NFL mix (the load-bearing share fix), coverage multiplier recentred to
   *  hold completion % / gross pass yards.
   *
   *  try-5: the >1.0 coverage values were tuned on the PRE-merge base. On the
   *  merged J1/J5/J7/J8b base the pass game is already leaner, so the same
   *  multipliers over-suppressed comp% (−1.9 pts) and gross pass yards (−7) at the
   *  36% man share. A 1-seed × 600-game probe (logs/realism-j6-cov2.out) showed the
   *  coverage values must drop by ~0.10 (a ≈0.90 scale) to centre comp% 64.3 vs the
   *  OFF 64.4 and gross 240.4 vs 239.9, with points/pass TD/3rd-down/first downs
   *  all equal or better — i.e. set them back toward/slightly below 1.0. */
  defStyles: {
    '4-3 Base': { blitz: 0.19, manCoverage: 0.32, runFit: 1.0, coverage: 0.92 },
    '3-4 Base': { blitz: 0.27, manCoverage: 0.24, runFit: 1.06, coverage: 0.92 },
    '4-2-5 Nickel': { blitz: 0.21, manCoverage: 0.40, runFit: 0.9, coverage: 1.0 },
    Multiple: { blitz: 0.26, manCoverage: 0.34, runFit: 1.0, coverage: 0.95 },
    'Blitz Heavy': { blitz: 0.47, manCoverage: 0.53, runFit: 0.94, coverage: 0.9 },
  } as Record<string, DefenseStyle>,
  /** Two-point chart: analytics-aggressive early aggression. */
  twoAggroMin: 0.3,
  twoEarlyRate: 0.05,
}
// J1: dev-only toggle for the situational pass-rate model (the setStamina
// pattern). The flag itself lives in situational.ts; re-exported here so the
// probe and both pickConcept call sites share one switch. Default ON.
export { setSituational, getSituational } from './situational'
// J5: dev-only toggle for the realistic scheme menus / formations / motion flag.
// Default on; the shipped sim always leaves it on. With it off the sim uses the
// original SCHEME_MENUS and sets no motion flag, so its rng stream and every
// resolved play are byte-identical to the pre-J5 engine.
let MENU_REALISM_ON = true
export function setMenuRealism(on: boolean) {
  MENU_REALISM_ON = on
}
/** J5: read the current menu-realism toggle so a probe can restore it exactly. */
export function getMenuRealism(): boolean {
  return MENU_REALISM_ON
}
// J8b: dev-only toggle for the individual pass rush / protection model (the
// setStamina pattern). Default on; the shipped sim always leaves it on. With it
// off the sim uses the original unit-average pressure / protection, so its rng
// stream and every resolved play are byte-identical to the pre-J8b engine.
let PROT_ON = true
export function setJ8b(on: boolean) {
  PROT_ON = on
}
/** J8b: read the current rush/protection toggle so a probe can restore it exactly. */
export function getJ8b(): boolean {
  return PROT_ON
}
// J8d: dev-only toggle for the individual-ratings pass over penalties, special
// teams and the fast sim. The flag itself lives in `individual.ts` (so the fast-sim
// `teamStrength` in generate.ts can read it without a module cycle); re-exported
// here so the probe and the OFF calibration copy share one switch, the J1 pattern.
// Default ON; OFF restores the pre-J8d unit-average / OVR-stand-in engine exactly.
export { setIndividual, getIndividual } from './individual'
// J8c: dev-only toggle for the individual coverage / ball-skills layer (the
// setStamina pattern). Default on; the shipped sim always leaves it on. With it
// off the resolver uses the pre-J8c team/unit averages verbatim, so its rng
// stream and every resolved play are byte-identical to the J7 engine.
let COVERAGE_INDIV_ON = true
export function setJ8c(on: boolean) {
  COVERAGE_INDIV_ON = on
}
/** J8c: read the current individual-coverage toggle so a probe can restore it. */
export function getJ8c(): boolean {
  return COVERAGE_INDIV_ON
}
// J9 (FUTURES #32): individual coach sub-ratings. The flag itself lives in
// coachSubs.ts; re-exported here so the probe and every site share one switch.
// Default ON; OFF falls back to the exact pre-J9 expressions (byte-identical).
export { setCoachSubs, getCoachSubs } from './coachSubs'
// J12 (FUTURES #34 + #35): pre-snap coverage disguise and the game plan vs
// individual opponents (the setStamina pattern). Default ON; the shipped sim
// always leaves it on. With it off no disguise/plan term is computed or applied,
// so its rng() stream and every resolved play are byte-identical to the pre-J12
// engine. The DC's `disguise`/`reads` subs and the specific players on the play
// decide both features — never a unit or roster mean.
let J12_ON = true
export function setJ12(on: boolean) {
  J12_ON = on
}
/** J12: read the current disguise/game-plan toggle so a probe can restore it. */
export function getJ12(): boolean {
  return J12_ON
}
// J36 (FUTURES #36): individual scouting reports — the game plan targets a player
// the staff flagged. Dev-only toggle in the setStamina pattern. Default ON; with
// it OFF no target list is read and no scout edge is applied, so the rng() stream
// and every resolved play are byte-identical to the pre-J36 engine.
let J36_ON = true
export function setJ36(on: boolean) {
  J36_ON = on
}
/** J36: read the current scouting-targeting toggle so a probe can restore it. */
export function getJ36(): boolean {
  return J36_ON
}
// J3: dev-only toggle for depth-aware completions (per-snap air yards + an
// air+YAC completion gain). Dev-only in the setStamina pattern, default ON; with
// it OFF the sim output is byte-identical to unmodified main (same rng draw order
// and count). The shipped sim always leaves it on. No store/UI wiring.
let DEPTH_AWARE_ON = true
export function setDepthAware(on: boolean) {
  DEPTH_AWARE_ON = on
}
/** J3: read the depth-aware toggle so a probe/calibration copy can restore it. */
export function getDepthAware(): boolean {
  return DEPTH_AWARE_ON
}
// J3b: dev-only toggle for the individual goal-line conversion and missed-tackle
// model (the setStamina pattern). Default ON; the shipped sim always leaves it on.
// With it OFF no J3b term is computed and no hash is consulted, so its rng() stream
// and every resolved play are byte-identical to the pre-J3b engine.
let J3B_ON = true
export function setJ3b(on: boolean) {
  J3B_ON = on
}
/** J3b: read the goal-line/missed-tackle toggle so a probe can restore it. */
export function getJ3b(): boolean {
  return J3B_ON
}

/**
 * J3b: every constant this job adds, in one place. Both features decide the
 * outcome from the SPECIFIC players on the play (never a unit or roster mean) and
 * every pick is a deterministic hash — no rng() draw is added or removed.
 *
 *  1. Goal-line conversion. The pre-J3b engine scored any run that reached the
 *     goal line and left it at that — effectively an "average defender" assumption
 *     with no player input. J3b replaces that implicit average with the man at the
 *     point of attack (J8a's gap pick): the carrier's STR/TRK/BCV against the
 *     POA defender's BSH/STR/TAK. `glBase` is the league-average stuff rate (the
 *     tuning knob that lands Rushing TD in band) and `glSlope` sizes the
 *     individual spread: an elite power back converts where a poor one is stood
 *     up, and an elite nose tackle stuffs where a weak one is moved.
 *
 *     The stand is rolled once per series, on the plunge itself: only downs 1-3
 *     (`glMaxDown`) and only while the ball is still short of the 1-yard line
 *     (`glNoStuffYard`). A stuffed carrier is stopped ON the 1, where the base
 *     engine's short-yardage push already owns the conversion. Without those two
 *     guards the stand was re-rolled on every doorstep plunge — a 50% coin flip
 *     per snap on a play the base engine converts — and the extra failed series
 *     (not the goal-line spread) were what moved the league's points and RZ TD%
 *     (measured: points drift −0.93 with the re-roll, −0.27 without it, over 6×500
 *     fresh seeds; Rushing TD stays in band either way).
 *
 *  2. Missed tackles. R5's `missRate` is already per-defender/per-carrier; J3b
 *     adds a small league lift (`mtBase`) plus a steeper individual tackler-vs-
 *     carrier term (`mtDefW`/`mtCarW`) centred on the same measured league blends,
 *     so elite tacklers whiff less and poor tacklers much more while the league
 *     missed-tackle % stays in band.
 */
export const J3B = {
  /** Yard line at/inside which a would-be scoring run is a real goal-line plunge. */
  glYard: 93,
  /** League-average chance the POA defender stands the carrier up (the tune).
   *  Fixed at 0.50: the site average is what lands pooled Rushing TD 0.963→0.913
   *  over 3 seeds × 500 (band 0.68-0.92, main 0.96) and keeps the spread large.
   *  0.50 is the optimum of points-drift vs the Rushing-TD cap: the removed TDs cost
   *  ~4 net points each, so lowering glBase to buy back the last of the drift lets
   *  Rushing TD back out of band (it sits at 0.913, 0.007 under the 0.92 cap). */
  glBase: 0.5,
  /** Per rating-point slope on (defender blend − carrier blend); > 0 = defence wins.
   *  Sizes the individual spread: carrier elite-vs-poor TD% 86.8 vs 37.7 (49 pts),
   *  POA defender 37.7 vs 71.7 (34 pts). */
  glSlope: 0.014,
  /** Clamp on the stuff chance. */
  glLo: 0.02,
  glHi: 0.72,
  /** Down after which a would-be goal-line score is left to the base engine. On a
   *  fourth-down plunge the base engine's own handling (the short-yardage push, the
   *  coach's go-for-it call) already owns the conversion; the J3b stand is a
   *  once-per-series rep. Without this the last-down plunge — the one outcome that
   *  cannot be recovered on a later down — moved the league's points by ~0.3 a
   *  team-game for no extra realism. */
  glMaxDown: 3,
  /** Ball spot at/inside which the base engine already owns the plunge: the offence
   *  is on the doorstep, so the stand is not re-rolled down after down. 99 = the
   *  1-yard line (the base model's short-yardage push converts there). */
  glNoStuffYard: 99,
  // carrier blend weights (absolute; centred on J3B.carCenter below)
  carStrW: 0.4,
  carTrkW: 0.35,
  carBcvW: 0.25,
  /** Fixed centre for the carrier blend: the measured site-population mean of the
   *  weighted (STR·.4 + TRK·.35 + BCV·.25) blend over the men who carry on a
   *  goal-line plunge (1144 RB, 212 QB, 1 FB over 576 NFL games). A single
   *  hard-coded league constant (the MT_REF_TACKLER pattern), NOT a per-play mean
   *  and not a POS_MEAN lookup — no average decides the play. */
  carCenter: 77.4,
  // POA-defender blend weights (absolute; centred on J3B.defCenter below)
  defBshW: 0.4,
  defStrW: 0.3,
  defTakW: 0.3,
  /** Fixed centre for the point-of-attack defender blend: the measured site mean of
   *  (BSH·.4 + STR·.3 + TAK·.3) over the DE/DT who play the gap (753 DE, 604 DT). */
  defCenter: 83.3,
  /** Missed tackles: small league lift added to R5's `missBase`. */
  mtBase: 0.0012,
  /** Extra per-rating-point slopes on the tackler and the carrier (on top of R2's). */
  mtDefW: 0.003,
  mtCarW: 0.003,
} as const
function ocEffect(world: World, teamId: string) {
  if (USER_COACH && USER_COACH.teamId === teamId) {
    // Backlog 193: pass only the user's SEAT so a coordinator seat they hold is
    // not charged the vacancy floor; the skill bonuses are added below.
    const base = coachEffect(world, teamId, { ...NO_USER_BONUS, seat: USER_COACH.seat })
    return {
      ...base,
      offEdge: base.offEdge + USER_COACH.off,
      defEdge: base.defEdge + USER_COACH.def,
      development: base.development * USER_COACH.development,
      situational: base.situational + USER_COACH.situational,
    }
  }
  return coachEffect(world, teamId)
}

/** Cohesion + head-coach situational edge, applied on money downs and in the red zone. */
function clutchFor(world: World, offId: string, down: number, yard: number): number {
  if (down < 3 && yard < 80) return 0
  return ocEffect(world, offId).situational
}

/**
 * L12.9 K1: a unit's cohesion relative to the league mean. A unit newer than the
 * league average commits slightly more penalties/fumbles; a settled one commits
 * fewer. Factor is 0.6 for pre-snap flags, 0.4 for ball security; clamped ±25%.
 * Thresholds only — no rng draw is added or removed.
 */
function cohesionMult(mean: number | undefined, coh: number | undefined, factor: number): number {
  if (mean === undefined || coh === undefined) return 1
  return clamp(1 + (mean - coh) * factor, 0.75, 1.25)
}

import type { World } from './generate'
import { clamp, hash32, makeRng, type Rng } from './rng'
import { situationalPassRate, getSituational, type SituationInput } from './situational'
import { J9, centeredSub, coachMeanRating, getCoachSubs } from './coachSubs'

// ── R2: NFL 2015–2024 base constants ─────────────────────────────────────────
// The real-league retune lives in ONE small block of base knobs. Every relative
// rating term in the resolvers (E1/E2/M3) is untouched, and no rng() draw is
// added or removed — these only move the league-average baseline the terms sit on.
export const R2 = {
  /** Completion-probability base (real NFL completion % ≈ 64.3). */
  compBase: 0.5675,
  /** Completion penalty as the field compresses toward the goal line (0 at the 20). */
  rzCompDamp: 0,
  /** Fraction of a would-be scoring run shaved by the compressed, crowded front. */
  rzRunDamp: 0,
  /** Fraction of a would-be scoring catch shaved by the compressed, crowded front. */
  rzPassDamp: 0,
  /** Multiplier on explosive gains (20+ yards) to tune the long-TD rate. */
  explosiveCal: 1.325,
  /** R2: red-zone pass lean — clubs throw more inside the 20 than between them. */
  rzPassBias: 0.015,
  /** R2: money-down conversion — on 3rd down the throw is schemed to the sticks, so
   *  it converts a little more often than the same matchup on 1st/2nd. */
  moneyComp: 0.045,
  /** R2: money-down yards — a 3rd-down completion/run is worked back to the marker. */
  moneyYards: 1.0,
  /** R5: missed-tackle grading. Both sides are centred on the measured league-average
   *  blend (79) and given their own slope, so the carrier and defender effects balance
   *  independently instead of drifting with the attribute offset. Pass plays carry an
   *  open-field bump. Sized so TAK 90+ defenders miss under 6% of attempts, TAK under 65
   *  over 18%, the league near 12%, an average RB ≈ 0.10–0.12 forced per carry and an
   *  elusive back 0.18–0.25 (see the tackle probe). */
  missBase: 0.0645,
  missGain: 0.004,
  missDefDiff: 0.016,
  missCarDiff: 0.015,
  missPassBump: 0.20,
  /** R5: extra yards on a broken tackle are 1..missYardsRange. */
  missYardsRange: 3,
  /** R5: talent tilt of the real yardage draw — see sampleYards (bounded, no point mass). */
  talentTilt: 0.03,
  /** Base sack chance per dropback (real rate ≈ 6.5%). */
  sackBase: 0.12,
  /** Base interception chance. */
  intBase: 0.0118,
  /** Multiplier on a positive run gain after the real distribution is sampled.
   *  R2 variance fix: trimmed so the league ypc sits on the 4.27 target instead of
   *  ~4.34, which also kept the run-heaviest seed's rushing yards above band. */
  runGainCal: 0.726,
  /** Multiplier on the yards-after-catch / style bonus on completions. */
  yacCal: 1.03,
  /** Multiplier on a positive pass gain after the real distribution is sampled.
   *  R2 variance fix: trimmed so the pass-heaviest league's gross/net passing yards
   *  and passing TDs sit inside their bands instead of riding the top edge. */
  passGainCal: 1.055,
  /** Game-clock seconds consumed per second of play time (pace). */
  pace: 0.838,
  /** Where a drive starts after a touchback (2015–2024 average ≈ the 27). */
  kickoffYard: 27,
  /** Pre-snap penalty chance per snap (defense / offense). */
  penDefRate: 0.05,
  penOffRate: 0.042,
  /** Base fumble chance: a carry / a completed catch that gets tackled. R16 splits
   *  every loose ball ~50/50 between the clubs, so these are roughly double the old
   *  all-lost bases to keep LOST fumbles (turnovers) in band. */
  runFumbleBase: 0.027,
  passFumbleBase: 0.005,
  /** League-wide run/pass lean added to the OC's pass rate (negative = more runs). */
  passAdj: -0.035,
}

/**
 * R7: QB pressure model. On every dropback the existing `pressureEdge` decides
 * pressure/no-pressure through a deterministic per-play hash (no rng() draw), and
 * the classification (sack / QB hit / hurry) is likewise hash-derived. This is a
 * stats-only layer: it never feeds the completion, sack or INT probabilities, so
 * calibration is unchanged. League pressure rate ≈ 30–35% of dropbacks.
 */
export const PRESSURE = {
  /** Base pressure probability at a league-average matchup (edge 0). */
  base: 0.235,
  /** Extra pressure per point of pressureEdge above that baseline. */
  slope: 0.011,
  lo: 0.12,
  hi: 0.62,
  /** Share of non-sack pressures classified as a QB hit (the rest are hurries). */
  hitRate: 0.225,
}

// ── R15: in-game stamina, rotation and snap counts ───────────────────────────
// Every player carries an in-game fatigue value (0 fresh → ~1 spent), charged per
// scrimmage snap and scaled by his STA rating, then partly shed between
// possessions and at halftime. Rotation spells a tiring starter with the next man
// up the depth chart. The play effects are applied as an OFFENCE-vs-DEFENCE
// difference, so a league-average club is exactly neutral and the calibration
// means are unchanged — only the more tired side of a given snap is penalised.
// All of it is deterministic arithmetic: no rng() draw is added or removed.
export const R15 = {
  /** Fatigue added to an average (STA 75) player per scrimmage snap. */
  snap: 0.012,
  /** Fraction of fatigue shed on a change of possession / at halftime. */
  restDrive: 0.3,
  restHalf: 0.45,
  /** Extra fatigue charged to a defence on a hurry-up possession / a long drive. */
  hurry: 1.6,
  longDrive: 1.2,
  /** Rotation: spell a starter once he is this much more tired than his backup. */
  rotateGap: 0.08,
  /** Rotation: the largest OVR drop a backup may be to take the rep. */
  rotateMaxDrop: 8,
  /** Effect slopes per unit-fatigue difference (defence minus offence). Halved
   *  from the R15 values because the fatigue scale is larger, so the league
   *  effect stays the same while the rotation is real. */
  fatPress: 4,
  fatComp: 0.012,
  fatInt: 0.15,
  fatRun: 4,
  fatBig: 0.15,
  /** Receiver target-score penalty per point of fatigue. */
  fatTarget: 14,
}

// ── R16: turnover variety ─────────────────────────────────────────────────────
// Strip sacks, tipped/deflected interceptions, receiver muffs and goal-line
// fumbles, with a proximity hash deciding who falls on every loose ball. The
// league-wide split is ~50/50 (the offence keeps roughly half of its fumbles);
// the tilts below move a given situation a few points. Every decision is a
// deterministic hash of the play number — no rng() draw is added or removed.
export const R16 = {
  /** Share of loose balls the offence recovers at a neutral pile. Set a hair above
   *  50% so the strip/goal-line tilts still leave the league near an even split. */
  offRecover: 0.53,
  /** The strip-sacker is usually on top of the ball — the defence recovers more. */
  stripOffRecover: 0.42,
  /** A doorstep pile leans defence (the ball squirts out backwards). */
  goalLineOffRecover: 0.42,
  /** A sack that also forces a fumble (NFL strip-sack ≈ 1 in 20 sacks). */
  stripSackRate: 0.05,
  /** A receiver bobbles a catch into a loose ball (rare; lower CTH muffs more). */
  muffBase: 0.006,
  muffSlope: 0.0004,
  muffLo: 0.003,
  muffHi: 0.018,
  /** Goal-line fumble bump (inside the 10) — the classic doorstep fumble. */
  goalLineMult: 1.9,
  goalLineYard: 90,
  /** Share of interceptions that come off a tipped/deflected ball. */
  tippedIntRate: 0.2,
  /** Of the tipped interceptions, the share a receiver muffed (vs. batted at line). */
  tippedMuffShare: 0.4,
}

// ── R17: kicking realism ─────────────────────────────────────────────────────
// Blocked kicks, situational fakes and onside kicks, a KPW-scaled FG range and a
// neutral wind hook. Every decision is a deterministic hash of the play number —
// no rng() draw is added or removed, so the seed stream and the coached/full
// equivalence are unchanged. The ~1–2% block rates leave FG% / XP% in band.
export const R17 = {
  /** A kick is blocked. NFL blocks are ≈1–2% of each attempt type. */
  blockFg: 0.015,
  blockPat: 0.012,
  blockPunt: 0.012,
  /** Fake punt/FG: rare, and only from 4th & short in plus territory. */
  fakeRate: 0.03,
  /** Onside kick: the share of desperate late kickoffs a trailing club tries. */
  onsideRate: 0.4,
  /** Onside recovery rate (kicking team; NFL ≈ 10–20%). */
  onsideRecover: 0.13,
  /**
   * Wind hook for weather (#6): the FG/XP make-probability change per mph. A
   * parameter only — the default 0 is exactly neutral, so today's sim and the
   * calibration are unchanged until a weather layer supplies a value.
   */
  windPerMph: 0.006,
}

// ── R14: typed penalties ─────────────────────────────────────────────────────
// The two pre-snap rng() draws (defensive, then offensive) are untouched: they
// still decide WHETHER a flag is thrown, in the same order, so the seed stream
// and coached/play-by-play equivalence are unchanged. The foul type, the
// offending player and the enforcement all come from deterministic hashes.
//
// Type weights are nudged by the roster's ratings (AWR/discipline, PBK vs the
// opponent's PRS for holding, MCV for the coverage fouls, and a road-crowd bump
// for false starts) but are always renormalised to 1, so the league-average
// count and yardage the R2 retune calibrated against do not move. No rng() draw
// is added or removed.
export type PenaltyKind =
  | 'holdingOff' | 'holdingDef' | 'falseStart' | 'offside' | 'dpi'
  | 'opi' | 'roughing' | 'illegalContact' | 'delay' | 'unnecessary'

/**
 * R14: penalty yardage from a deterministic hash — 5 / 10 / 15-yard flags mixing
 * to the real ≈ 8.5-yard average. Kept exactly as R2 shipped it so the enforced
 * spot is byte-identical to the pre-R14 sim; the R14 type is chosen to match the
 * tier, so a 5-yard flag is a 5-yard foul (false start / offside / …), a 10-yard
 * flag a holding / OPI (or a short spot DPI) and a 15-yard flag a DPI / roughing /
 * unnecessary-roughness. No rng() draw is added or removed.
 */
function penaltyYards(key: string, side: 'off' | 'def'): number {
  // NFL mix by side: defensive flags are mostly 5-yard fouls (offside, holding,
  // illegal contact) with ~22% 15-yarders (DPI, roughing, unnecessary roughness)
  // and a few short spot DPIs; offensive flags are mostly 10-yard holding/OPI
  // or 5-yard false starts / delays. (The old shared 50/30/20 split made every
  // 10-yard defensive flag a DPI.)
  const r = hash32(key) % 100
  if (side === 'def') return r < 70 ? 5 : r < 78 ? 10 : 15
  return r < 45 ? 5 : r < 98 ? 10 : 15
}

export interface PenaltyInfo { label: string; side: 'off' | 'def'; yards: number; tiers: number[]; pos: Position[] }
export const PENALTY_INFO: Record<PenaltyKind, PenaltyInfo> = {
  holdingOff: { label: 'Offensive holding', side: 'off', yards: 10, tiers: [10], pos: ['OT', 'OG', 'C', 'TE', 'RB'] },
  holdingDef: { label: 'Defensive holding', side: 'def', yards: 5, tiers: [5], pos: ['CB', 'S', 'LB'] },
  falseStart: { label: 'False start', side: 'off', yards: 5, tiers: [5], pos: ['OT', 'OG', 'C', 'TE', 'WR'] },
  // Defensive offside is a 5-yard replay-down foul in the NFL, but this pre-snap
  // model resets the down for every defensive flag (the R2 status quo), so it
  // takes the same treatment as the rest.
  offside: { label: 'Offside', side: 'def', yards: 5, tiers: [5], pos: ['DE', 'DT', 'LB'] },
  // DPI is a spot foul: a short one lands on the 10-yard tier, a deep one on 15.
  dpi: { label: 'Defensive pass interference', side: 'def', yards: 15, tiers: [10, 15], pos: ['CB', 'S'] },
  opi: { label: 'Offensive pass interference', side: 'off', yards: 10, tiers: [10], pos: ['WR', 'TE', 'RB'] },
  roughing: { label: 'Roughing the passer', side: 'def', yards: 15, tiers: [15], pos: ['DE', 'DT', 'LB'] },
  illegalContact: { label: 'Illegal contact', side: 'def', yards: 5, tiers: [5], pos: ['CB', 'LB', 'S'] },
  delay: { label: 'Delay of game', side: 'off', yards: 5, tiers: [5], pos: ['QB'] },
  unnecessary: { label: 'Unnecessary roughness', side: 'def', yards: 15, tiers: [15], pos: ['LB', 'S', 'CB', 'DE', 'DT', 'OT', 'OG', 'C', 'TE', 'WR', 'RB'] },
}
/** R14: relative frequency of each offensive foul (normalised within the tier). */
const PEN_OFF_W: Partial<Record<PenaltyKind, number>> = {
  holdingOff: 0.6, falseStart: 0.28, opi: 0.06, delay: 0.04, unnecessary: 0.02,
}
/** R14: relative frequency of each defensive foul (normalised within the tier). */
const PEN_DEF_W: Partial<Record<PenaltyKind, number>> = {
  offside: 0.3, holdingDef: 0.25, dpi: 0.18, illegalContact: 0.12, unnecessary: 0.09, roughing: 0.06,
}

// ── J8d: individual special teams / penalties / fast sim ─────────────────────
// Every constant this job adds lives here. The `*Center`/`*Shift` numbers are the
// measured league means (32 real clubs) of the individual metric minus the unit
// mean it replaces, so each new term is centred and league totals do not drift
// (the `WX_CENTER` pattern). Tune only this block.
export const J8D = {
  // Penalty kind weights: the R14 slopes are kept, but the value is now ONE player
  // on the field (the likeliest offender) rather than a whole-roster/unit mean.
  penHoldW: 0.012, penHoldCenter: 21.34,
  penAwrW: 0.012, penOpiW: 0.01, penShiftOl: -6.23, penShiftWr: -1.5, penShiftQb: 8.65,
  penShiftDb: -4.99, penShiftDl: -1.13, shiftCb: -3.94,
  // Return coverage: the value is the individual cover man the returner must beat.
  // The rating-weighted pick sits `covPickBias` above the old unit mean.
  covPickBias: 0.37,
  // Return TD = base × f(returner athletic − cover man); centred on the league mean.
  tdCenter: 13.04, tdW: 0.05, tdLo: 0.3, tdHi: 2.6,
  tdPunt: 0.0103, tdKick: 0.0013, tdSquib: 0.0004,
  // Ball security: the returner's own CAR (centred on the league-mean CAR).
  carCenter: 71.75, fumW: 0.03, fumLo: 0.35, fumHi: 2.4,
  muffPunt: 0.01, fumKick: 0.005, fumSquib: 0.008,
}

/** J8d: the on-field player with the lowest value of `key` (the weakest link). */
function worstPlayer(list: Player[], key: string): Player | undefined {
  let out: Player | undefined
  let worst = Infinity
  for (const p of list) {
    const v = mkAttrs(p)[key]
    if (v !== undefined && v < worst) { worst = v; out = p }
  }
  return out
}
/** J8d: the on-field player with the best edge-rush rating (max of PMV/FMV). */
function bestRusher(list: Player[]): Player | undefined {
  let out: Player | undefined
  let best = -Infinity
  for (const p of list) {
    const a = mkAttrs(p)
    const v = Math.max(a.PMV ?? -1, a.FMV ?? -1)
    if (v > best) { best = v; out = p }
  }
  return out
}
/** J8d: the individual rating that makes a player the likeliest offender for a foul. */
const PEN_OFF_RATING: Partial<Record<PenaltyKind, { key: string; high?: boolean }>> = {
  holdingOff: { key: 'PBK' }, falseStart: { key: 'AWR' }, opi: { key: 'AWR' }, delay: { key: 'AWR' },
  dpi: { key: 'MCV' }, illegalContact: { key: 'MCV' }, holdingDef: { key: 'AWR' }, offside: { key: 'AWR' },
  roughing: { key: 'PMV', high: true }, unnecessary: { key: 'AWR' },
}
/** J8d: a missing specialist's replacement value — the league mean at his position. */
function specMean(pos: 'K' | 'P', key: string, hard: number): number {
  return getIndividual() ? (POS_MEAN[pos]?.[key] ?? hard) : hard
}

/** J8d: the on-field units for the penalty stage (the concept is already chosen). */
function penaltyFields(world: World, s: GameState, concept: Concept, offId: string, defId: string): { off: Player[]; def: Player[] } {
  const env = envFor(s)
  const userOffP = s.ctx?.userTeamId === offId ? s.ctx?.personnel?.off : undefined
  const off = fillToEleven(world, offId, offenseOnField(world, offId, concept, env.qbOverride, undefined, env.fat, userOffP ? offenseCounts(userOffP) : undefined), OFF_FILL)
  const userDefP = s.ctx?.userTeamId === defId ? s.ctx?.personnel?.def : undefined
  const def = fillToEleven(world, defId, defenseOnField(world, defId, concept.personnel, env.fat, userDefP ? defenseCounts(userDefP) : undefined), DEF_FILL)
  return { off, def }
}

/** R14: mean rating across a club's non-injured players at these positions. */
function posRatingAvg(world: World, teamId: string, positions: Position[], key: string): number {
  const ps = (world.roster[teamId] ?? []).filter((p) => positions.includes(p.pos) && !p.injured)
  if (!ps.length) return 70
  let sum = 0
  for (const p of ps) sum += mkAttrs(p)[key] ?? 70
  return sum / ps.length
}
/** R14: a club's mean edge-rush rating (max of PMV/FMV), for offensive holding. */
function passRushAvg(world: World, teamId: string): number {
  const ps = (world.roster[teamId] ?? []).filter((p) => (p.pos === 'DE' || p.pos === 'DT' || p.pos === 'LB') && !p.injured)
  if (!ps.length) return 70
  let sum = 0
  for (const p of ps) {
    const a = mkAttrs(p)
    sum += Math.max(a.PMV ?? 70, a.FMV ?? 70)
  }
  return sum / ps.length
}

/** J9: the head coach's DISCIPLINE sub as a penalty multiplier (league mean = 1). */
function disciplineMult(world: World, teamId: string): number {
  const hc = (world.staff[teamId] ?? []).find((m) => m.role === 'Head Coach')
  const d = centeredSub(world, 'Head Coach', 'discipline', hc)
  return clamp(J9.disciplineBase + (d - 74) * J9.disciplinePerPt, J9.disciplineLo, J9.disciplineHi)
}

/** R14: the most likely offender for a foul — a starter at one of its positions. */
function penaltyOffender(world: World, teamId: string, side: 'off' | 'def', positions: Position[], key: string, kind?: PenaltyKind, field?: Player[]): Player | undefined {
  // J8d: a specific man on the field at one of the foul's positions, picked by the
  // rating that makes him likeliest to commit it (weighted hash, no rng draw).
  if (getIndividual() && field && field.length && kind) {
    const pool = field.filter((p) => positions.includes(p.pos))
    const use = pool.length ? pool : field
    const spec = PEN_OFF_RATING[kind] ?? { key: 'AWR' }
    return hashPick(use, (p) => {
      const v = spec.high ? Math.max(eff(p, 'PMV'), eff(p, 'FMV')) : eff(p, spec.key)
      return Math.max(1, spec.high ? v : 100 - v)
    }, hash32(key)) ?? use[0]
  }
  let ps = (world.roster[teamId] ?? []).filter((p) => positions.includes(p.pos) && !p.injured)
  // Fall back to the whole unit if the position list does not fit this side.
  if (!ps.length) ps = (world.roster[teamId] ?? []).filter((p) => (p.side === 'DEF' ? 'def' : 'off') === side && !p.injured)
  ps = ps.sort((a, b) => b.ovr - a.ovr || (a.id < b.id ? -1 : 1)).slice(0, 6)
  if (!ps.length) return undefined
  return ps[(hash32(key) >>> 0) % ps.length]
}
/** R14: pick the foul type from the rating-modulated weights, within the tier. */
function pickPenaltyKind(world: World, s: GameState, side: 'off' | 'def', teamId: string, oppId: string, away: boolean, tier: number, field?: Player[], oppField?: Player[]): PenaltyKind {
  const w: Partial<Record<PenaltyKind, number>> = { ...(side === 'off' ? PEN_OFF_W : PEN_DEF_W) }
  if (getIndividual() && field && field.length) {
    // J8d: every weight below is driven by ONE player on the field — the man who
    // commits the foul — instead of a whole-roster/unit mean. Each term is shifted
    // by the measured difference between the individual metric's league mean and
    // the old mean, so the foul mix (and the league totals) does not drift.
    if (side === 'off') {
      const ol = field.filter((p) => p.pos === 'OT' || p.pos === 'OG' || p.pos === 'C')
      const wr = field.filter((p) => p.pos === 'WR' || p.pos === 'TE')
      const qb = field.find((p) => p.pos === 'QB')
      const rushers = (oppField ?? []).filter((p) => p.pos === 'DE' || p.pos === 'DT' || p.pos === 'LB')
      const holder = ol.length ? worstPlayer(ol, 'PBK') : undefined
      const rusher = rushers.length ? bestRusher(rushers) : undefined
      if (holder && rusher) {
        const diff = Math.max(eff(rusher, 'PMV'), eff(rusher, 'FMV')) - eff(holder, 'PBK')
        w.holdingOff = (w.holdingOff ?? 0) * clamp(1 + (diff - J8D.penHoldCenter) * J8D.penHoldW, 0.7, 1.35)
      }
      if (ol.length) {
        const awr = eff(worstPlayer(ol, 'AWR')!, 'AWR')
        w.falseStart = (w.falseStart ?? 0) * clamp(1 + (72 - awr + J8D.penShiftOl) * J8D.penAwrW, 0.7, 1.3) * (away ? 1.25 : 1)
      }
      if (wr.length) {
        const awr = eff(worstPlayer(wr, 'AWR')!, 'AWR')
        w.opi = (w.opi ?? 0) * clamp(1 + (72 - awr + J8D.penShiftWr) * J8D.penOpiW, 0.8, 1.3)
      }
      if (qb) {
        const awr = eff(qb, 'AWR')
        w.delay = (w.delay ?? 0) * clamp(1 + (72 - awr + J8D.penShiftQb) * J8D.penAwrW, 0.7, 1.3)
      }
    } else {
      const db = field.filter((p) => p.pos === 'CB' || p.pos === 'S')
      const dblb = field.filter((p) => p.pos === 'CB' || p.pos === 'S' || p.pos === 'LB')
      const dl = field.filter((p) => p.pos === 'DE' || p.pos === 'DT')
      const cover = db.length ? worstPlayer(db, 'MCV') : undefined
      if (cover) {
        const mcv = eff(cover, 'MCV')
        w.dpi = (w.dpi ?? 0) * clamp(1 + (72 - mcv + J8D.shiftCb) * 0.012, 0.7, 1.4)
        w.illegalContact = (w.illegalContact ?? 0) * clamp(1 + (72 - mcv + J8D.shiftCb) * 0.01, 0.8, 1.3)
      }
      const dbw = dblb.length ? worstPlayer(dblb, 'AWR') : undefined
      if (dbw) {
        const awr = eff(dbw, 'AWR')
        w.holdingDef = (w.holdingDef ?? 0) * clamp(1 + (72 - awr + J8D.penShiftDb) * 0.01, 0.8, 1.3)
        w.unnecessary = (w.unnecessary ?? 0) * clamp(1 + (72 - awr + J8D.penShiftDb) * 0.01, 0.8, 1.3)
      }
      const dlw = dl.length ? worstPlayer(dl, 'AWR') : undefined
      if (dlw) {
        const awr = eff(dlw, 'AWR')
        w.offside = (w.offside ?? 0) * clamp(1 + (72 - awr + J8D.penShiftDl) * 0.012, 0.7, 1.3)
        w.roughing = (w.roughing ?? 0) * clamp(1 + (72 - awr + J8D.penShiftDl) * 0.008, 0.8, 1.3)
      }
    }
  } else if (side === 'off') {
    const olAwr = posRatingAvg(world, teamId, ['OT', 'OG', 'C'], 'AWR')
    const qbAwr = posRatingAvg(world, teamId, ['QB'], 'AWR')
    const wrAwr = posRatingAvg(world, teamId, ['WR', 'TE'], 'AWR')
    const pbk = posRatingAvg(world, teamId, ['OT', 'OG', 'C'], 'PBK')
    const prs = passRushAvg(world, oppId)
    // Holding: the offense's pass protection versus the opponent's rush.
    w.holdingOff = (w.holdingOff ?? 0) * clamp(1 + (prs - pbk) * 0.012, 0.7, 1.35)
    // Road crowd noise: the visiting offense false-starts more.
    w.falseStart = (w.falseStart ?? 0) * clamp(1 + (72 - olAwr) * 0.012, 0.7, 1.3) * (away ? 1.25 : 1)
    w.opi = (w.opi ?? 0) * clamp(1 + (72 - wrAwr) * 0.01, 0.8, 1.3)
    w.delay = (w.delay ?? 0) * clamp(1 + (72 - qbAwr) * 0.012, 0.7, 1.3)
  } else {
    const mcv = posRatingAvg(world, teamId, ['CB', 'S'], 'MCV')
    const dbAwr = posRatingAvg(world, teamId, ['CB', 'S', 'LB'], 'AWR')
    const dlAwr = posRatingAvg(world, teamId, ['DE', 'DT'], 'AWR')
    w.dpi = (w.dpi ?? 0) * clamp(1 + (72 - mcv) * 0.012, 0.7, 1.4)
    w.illegalContact = (w.illegalContact ?? 0) * clamp(1 + (72 - mcv) * 0.01, 0.8, 1.3)
    w.holdingDef = (w.holdingDef ?? 0) * clamp(1 + (72 - dbAwr) * 0.01, 0.8, 1.3)
    w.offside = (w.offside ?? 0) * clamp(1 + (72 - dlAwr) * 0.012, 0.7, 1.3)
    w.roughing = (w.roughing ?? 0) * clamp(1 + (72 - dlAwr) * 0.008, 0.8, 1.3)
    w.unnecessary = (w.unnecessary ?? 0) * clamp(1 + (72 - dbAwr) * 0.01, 0.8, 1.3)
  }
  const entries = (Object.entries(w) as [PenaltyKind, number][])
    .filter(([k, v]) => v > 0 && PENALTY_INFO[k].tiers.includes(tier))
  if (!entries.length) return side === 'off' ? 'holdingOff' : 'dpi'
  const total = entries.reduce((a, [, v]) => a + v, 0)
  let roll = h01(`${s.n}:penKind:${side}:${teamId}:${tier}`) * total
  for (const [k, v] of entries) {
    roll -= v
    if (roll <= 0) return k
  }
  return entries[entries.length - 1][0]
}

/** R14: a club's accepted penalties from a play log, by type (for the box score). */
export interface PenaltyTally { count: number; yards: number; byType: Partial<Record<PenaltyKind, number>> }
export function penaltyTotals(plays: Play[], teamId: string): PenaltyTally {
  const out: PenaltyTally = { count: 0, yards: 0, byType: {} }
  for (const p of plays) {
    if (p.type !== 'penalty') continue
    const team = p.penaltyTeam ?? (p.concept === 'Offensive Penalty' ? p.offId : p.defId)
    if (team !== teamId) continue
    if (p.penaltyDisposition && p.penaltyDisposition !== 'accepted') continue
    out.count += 1
    out.yards += Math.abs(p.yards ?? 0)
    const kind = p.penaltyKind
    if (kind) out.byType[kind] = (out.byType[kind] ?? 0) + 1
  }
  return out
}

/**
 * R6: a deterministic uniform in [0,1) from a string key — never an rng() draw.
 * All R6 randomness (returns, defensive scores, safeties) is derived this way so
 * the seed stream and the play-by-play/coached equivalence are unchanged.
 */
function h01(key: string): number {
  return (hash32(key) >>> 0) / 4294967296
}

/** "Dorian Smith" → "D. Smith" for play text. */
function shortName(name: string | undefined): string {
  if (!name) return ''
  const parts = name.trim().split(/\s+/)
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : name
}

/**
 * R6: return yardage from the returner's score vs the cover team, drawn from a
 * bell-shaped deterministic hash (no rng draw). `spread` sets the range; the
 * talent edge shifts the mean by about a yard per 7 points of score difference.
 */
function returnYards(key: string, retScore: number, covScore: number, base: number, spread: number): number {
  const bell = (h01(`${key}:y1`) + h01(`${key}:y2`) + h01(`${key}:y3`)) / 3 - 0.5
  const edge = (retScore - covScore) * 0.14
  return Math.round(clamp(base + bell * spread + edge, -4, 45))
}

/** J8d: the individual cover man who takes the angle on a return (weighted pick). */
function stCoverMan(world: World, teamId: string, key: string): Player | undefined {
  const unit = coverUnit(world, teamId)
  if (!unit.length) return undefined
  return hashPick(unit, (p) => {
    return Math.max(1, eff(p, 'TAK') * 0.4 + eff(p, 'PUR') * 0.35 + eff(p, 'SPD') * 0.25)
  }, hash32(key))
}
/** J8d: a cover man's individual coverage value (replaces the old unit mean). */
function coverScoreOf(p: Player | undefined): number {
  if (!p) return 70 * 0.4 + 70 * 0.35 + 70 * 0.25 - J8D.covPickBias
  return eff(p, 'TAK') * 0.4 + eff(p, 'PUR') * 0.35 + eff(p, 'SPD') * 0.25 - J8D.covPickBias
}
/** J8d: the returner's return athletics (SPD/ACC/BCV) for the TD chance. */
function returnAthOf(p: Player | undefined): number {
  if (!p) return 70
  return eff(p, 'SPD') * 0.5 + eff(p, 'ACC') * 0.3 + eff(p, 'BCV') * 0.2
}
/** J8d: the cover man's chase athletics (SPD/TAK/PUR) for the TD chance. */
function coverAthOf(p: Player | undefined): number {
  if (!p) return 70
  return eff(p, 'SPD') * 0.4 + eff(p, 'TAK') * 0.4 + eff(p, 'PUR') * 0.2
}
/** J8d: an individual return-TD chance (centred on the league-mean returner−cover gap). */
function returnTdProb(base: number, returner: Player | undefined, coverMan: Player | undefined): number {
  const diff = returnAthOf(returner) - coverAthOf(coverMan)
  return base * clamp(1 + (diff - J8D.tdCenter) * J8D.tdW, J8D.tdLo, J8D.tdHi)
}
/** J8d: an individual ball-security multiplier from the returner's own CAR. */
function carrySecurityOf(returner: Player | undefined): number {
  if (!returner) return clamp(1 + (J8D.carCenter - J8D.carCenter) * J8D.fumW, J8D.fumLo, J8D.fumHi)
  const car = J8A2_ON ? eff(returner, 'CAR') : (mkAttrs(returner).CAR ?? J8D.carCenter)
  return clamp(1 + (J8D.carCenter - car) * J8D.fumW, J8D.fumLo, J8D.fumHi)
}

export interface Play {
  n: number
  qtr: number
  clock: string
  down: number | null
  distance: number | null
  startYard: number // 0-100 from the offense's own goal line
  endYard: number
  offId: string
  defId: string
  type: 'run' | 'pass' | 'punt' | 'fg' | 'kickoff' | 'pat' | 'end' | 'penalty'
  concept: string
  yards: number
  result: string
  scorerId?: string
  scorerName?: string
  turnover?: boolean
  homeScore: number
  awayScore: number
  carrierId?: string
  targetId?: string
  passDepth?: number
  /** J3: the concept's nominal depth (the pre-J3 meaning of `passDepth`), emitted
   *  only while the air model is on. The replay-review catch ruling keeps the spot
   *  it had before J3, so the air model moves presentation, not the sim. */
  passConceptDepth?: number
  pressure?: boolean
  /** The defense sent extra rushers on this pass (animation only). */
  blitz?: boolean
  /** J12 #34: the defence showed a disguised shell on this snap (animation). */
  disguised?: boolean
  /** J12 #34: the QB was fooled by the disguise on this snap (animation). */
  qbFooled?: boolean
  bigPlay?: boolean
  /** J36: the opponent player the play was steered at (a targeted report finding). */
  scoutTarget?: string
  timeUsed?: number
  /** J5: this snap used pre-snap motion (animation use is a later job). */
  motion?: boolean
  /** L10 G8: offensive class of this snap (run / short / deep), for the tendency book. */
  offClass?: OffClass
  /** L10 G8: the defensive call used on this snap, for the tendency book. */
  defCall?: DefCall
  // attribution for individual stats
  qbId?: string
  tackleIds?: string[]
  sackId?: string
  intId?: string
  /** L11.5 Q7: the defender in coverage on the target (derived, never an rng draw). */
  coverId?: string
  // ── J7: matchups & busts ────────────────────────────────────────────────────
  /** J7: the covering defender chosen at target time (mirrors `coverId`); the
   *  matchup record. Undefined when the matchups layer is off. */
  coverDefenderId?: string
  /** J8c: the covering defender who got a hand on the ball (a pass break-up). */
  pbuId?: string
  /** J7: modelled separation to the nearest defender at the catch point (yards, 1 dp). */
  separationYd?: number
  /** J7: how tight the coverage was — `bust`/`miscall` are breakdowns. */
  coverTag?: CoverTag
  /** J7: the air depth the matchup model used (so a probe can bucket by depth
   *  even on a completion, where `passDepth` is not otherwise set). */
  muAirDepth?: number
  /** L12 E2: the defender who forced a fumble on a catch (bookkeeping only). */
  fumbleId?: string
  /** R5: defenders who failed to bring the carrier down on this play. */
  missedTackleIds?: string[]
  /** R5: carriers/receivers who forced one or more missed tackles on this play. */
  forcedMissedIds?: string[]
  /** R5: the targeted receiver charged with a drop on this incompletion. */
  dropId?: string
  // ── R6: special teams / defensive scoring ──────────────────────────────────
  /** R6: the returner on a kickoff or punt (the receiving club's player). */
  returnerId?: string
  /** R6: yards the returner gained on a kick or punt return. */
  returnYards?: number
  /** R6: the return was taken back for a touchdown. */
  returnTD?: boolean
  /** R6: the return outcome (drives the play text and the animation). */
  returnKind?: 'return' | 'fairCatch' | 'downed' | 'touchback' | 'muff' | 'blocked'
  /** R6: a defensive touchdown (pick-six or fumble return). */
  defTD?: boolean
  /** R6: a safety (two points for this play's defense). */
  safety?: boolean
  /** T2M: the ball carrier ran out of bounds, stopping the clock (no runoff). */
  outOfBounds?: boolean
  /** J6: a victory-formation kneeldown (a rush attempt for negative yards). */
  kneel?: boolean
  /** J6: the QB spiked the ball to stop the clock (a pass attempt, incomplete). */
  spike?: boolean
  /** J6: the QB escaped the pocket and ran (a rush attempt, not a pass attempt). */
  scramble?: boolean
  /** R7: the defender credited with the pressure (sack, QB hit or hurry). */
  pressureId?: string
  /** R7: how the pressure is classified. A sack is always a pressure. */
  pressureType?: 'sack' | 'hit' | 'hurry'
  // ── J8b: pass rush & protection ────────────────────────────────────────────
  /** J8b: the blocker who lost the rep that produced the pressure (a per-player
   *  "pressures / sacks allowed" record; undefined when the layer is off). */
  beatenBlockerId?: string
  /** J8b: modelled time from the snap until the pressure arrives (animation). */
  timeToPressureS?: number
  // ── R14: typed penalties ───────────────────────────────────────────────────
  /** R14: the specific foul (holding, false start, DPI, …). */
  penaltyKind?: PenaltyKind
  /** R14: the club that committed the foul. */
  penaltyTeam?: string
  /** R14: the player charged with the foul. */
  penaltyPlayerId?: string
  /** R14: how the foul was enforced (accepted, declined or offsetting). */
  penaltyDisposition?: 'accepted' | 'declined' | 'offset'
  // ── R16: turnover variety ──────────────────────────────────────────────────
  /** R16: why the ball came loose (run / strip sack / receiver muff / kickoff). */
  fumbleCause?: 'run' | 'carry' | 'strip' | 'muff' | 'kickoff'
  /** R16: which club recovered a loose ball (kept or lost). */
  fumbleRecoveredBy?: 'off' | 'def'
  /** R16: a sack that also forced a fumble. */
  stripSack?: boolean
  /** R16: the interception came off a tipped/deflected pass. */
  tippedInt?: boolean
  /** R16: the defender (or receiver) who tipped the pass. */
  tipId?: string
  /** R16: a receiver muffed the catch into a loose ball. */
  muffedCatch?: boolean
  /** R16: a fumble on the doorstep (inside the 10). */
  goalLineFumble?: boolean
  // ── R17: kicking realism ───────────────────────────────────────────────────
  /** R17: a fake punt/FG — a scrimmage play run from a kicking formation. */
  fake?: boolean
  /** R17: a blocked field goal, extra point or punt. */
  blockedKick?: boolean
  // ── FUTURES #4: special-teams calls ────────────────────────────────────────
  /** The kicking club's kickoff call (deep / squib / onside / surprise). */
  kickCall?: KickoffCall
  /** A special-teams surprise to remember against the club (scouting memory). */
  stAttempt?: { club: string; kind: 'fake' | 'onside' | 'surprise' }
  // ── R15/R16: reception metadata and on-field participants ──────────────────
  /** R16: the pass was caught (a true reception, including a catch then fumble). */
  reception?: boolean
  /** R15: the scrimmage players on the field for this snap (offence / defence ids). */
  onFieldOff?: string[]
  onFieldDef?: string[]
  // ── J8a2: the run-defence read loop (animation) ────────────────────────────
  /** J8a2: the front defender whose read (gap fit) decided the run. */
  readKeyId?: string
  /** J8a2: the run defenders who bit on the misdirection / play-action key. */
  biteIds?: string[]
  /** J8a2: the safety (or LB) who filled the alley / gap on the run. */
  fillId?: string
  /** J3b: the point-of-attack defender deciding a goal-line run. */
  glPoaId?: string
  /** J3b: the point-of-attack defender who stood the carrier up at the goal line. */
  glStopId?: string
  /** animflow r6b: each on-field man's in-game fatigue at the snap (x100, rounded),
   *  aligned to onFieldOff then onFieldDef. Presentation only (the broadcast's
   *  tired gait / hands on hips); recorded read-only, no rng. */
  fatOn?: number[]
  // ── FUTURES #5: replay review ──────────────────────────────────────────────
  /** A booth or challenge review of this play (display-only in the booth domain). */
  review?: PlayReview
}

export interface GameSim {
  homeId: string
  awayId: string
  homeScore: number
  awayScore: number
  plays: Play[]
  stats: {
    home: TeamGameStats
    away: TeamGameStats
  }
  /** Per-player box score, filled after simulation. */
  box?: import('./stats').PlayerBoxScore[]
  /** True when produced by the fast allocator rather than play-by-play. */
  generated?: boolean
  /** G1: every decision the user's club made this game. */
  decisions?: DecisionLog[]
  /** L10 G5: film grade of the user's calls, for the post-game view. */
  film?: { grade: number; letter: string; lines: string[]; userCalls?: number }
  /** L12 W2: the graded keys to the game, for the post-game film card. */
  keys?: import('./keys').KeyGrade[]
  /** L11.5 Q3: mid-game plan switches, for the post-game film card. */
  planChanges?: PlanChange[]
  homeLines?: { playerId: string; line: import('../types').GameStatLine }[]
  awayLines?: { playerId: string; line: import('../types').GameStatLine }[]
  // ── R15: in-game stamina and snap counts (per played game) ─────────────────
  /** Scrimmage snaps played per player. */
  snaps?: Record<string, number>
  /** Scrimmage snaps run by each club's offence / defence (the snap-% denominator). */
  snapSide?: Record<string, { off: number; def: number }>
  /**
   * Backlog 149 follow-up: the K/P each club actually took the field with,
   * snapshotted at kickoff (before any post-game injury heal). The box score
   * credits these ids so a weekly injury roll can never move a game to a backup
   * who did not play (or credit one who sat). Absent on fast-sim games and old
   * saves; the box score then falls back to the depth chart.
   */
  specialists?: Record<string, { K?: string; P?: string }>
  /** Final in-game fatigue per player (probe/reporting only). */
  fatigue?: Record<string, number>
  /** animflow r6b: the game's weather (read-only, for the broadcast's rain / snow / wind). */
  weather?: GameWeather
}

/** L11.5 Q3: one mid-game change to the user's live plan. */
export interface PlanChange {
  qtr: number
  clock: string
  side: 'off' | 'def'
  preset: string
}

export interface TeamGameStats {
  plays: number
  points: number
  passAtt: number
  passComp: number
  passYds: number
  passTD: number
  ints: number
  rushAtt: number
  rushYds: number
  rushTD: number
  fumbles: number
  /** Sacks made by this team's defense. */
  sacks: number
  /** Sacks this team's offense has given up. */
  sacksTaken: number
  firstDowns: number
  thirdDownAtt: number
  thirdDownConv: number
  fgAtt: number
  fgMade: number
  /** Two-point tries attempted / converted. */
  twoAtt: number
  twoMade: number
  td: number
  top: number // time of possession, seconds
}

function emptyStats(): TeamGameStats {
  return {
    plays: 0, points: 0, passAtt: 0, passComp: 0, passYds: 0, passTD: 0, ints: 0,
    rushAtt: 0, rushYds: 0, rushTD: 0, fumbles: 0, sacks: 0, sacksTaken: 0, firstDowns: 0,
    thirdDownAtt: 0, thirdDownConv: 0, fgAtt: 0, fgMade: 0, twoAtt: 0, twoMade: 0, td: 0, top: 0,
  }
}

// ── Attribute access (merge exact ratings with position fallbacks) ────────────
function mkAttrs(p: Player): Record<string, number> {
  // L15: `playerAttrs` also folds in any development-plan gains (empty by default).
  return playerAttrs(p)
}

// ── L12.13 M3: mastery relative to the league mean for the position group ────
// Each term is (mastery − league mean) × weight, so an average club adds 0 and
// league averages hold. The QB/carrier slopes match the old absolute terms, so a
// 0→100 swing is unchanged. No rng() draw is added or removed.
/** Mastery points above the league mean for this player's position group. */
function masteryOffset(p: Player | undefined, means: MasteryMeans): number {
  if (!p) return 0
  const g = masteryGroup(p.pos)
  return g ? (p.playbook?.pct ?? 0) - means[g] : 0
}
/** Mean mastery offset (points) across a mixed group of players. */
function masteryRelAvg(list: Array<Player | undefined>, means: MasteryMeans): number {
  const ps = list.filter((p): p is Player => !!p)
  if (!ps.length) return 0
  return ps.reduce((a, p) => a + masteryOffset(p, means), 0) / ps.length
}
/** Team-wide mastery offset for one side of the ball (mental-error thresholds). */
function teamMasteryOffset(world: World, teamId: string, side: 'off' | 'def', means: MasteryMeans): number {
  const ps = (world.roster[teamId] ?? []).filter((p) => (p.side === 'DEF' ? 'def' : 'off') === side)
  return masteryRelAvg(ps, means)
}
// The relative QB/carrier term differentiates against the league mean, but it is
// anchored to the pre-L12.13 league-average edge (a 0%-mastery league) so the
// league scoring averages it was calibrated against are unchanged.
const MASTERY_ANCHOR_QB = (0.9 - 1) * 90
const MASTERY_ANCHOR_CARRIER = (0.9 - 1) * 40
function avg(list: number[]) {
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : 70
}

// ── L12 E1: every offensive rating counts ────────────────────────────────────
// Each new term is (rating − POS_MEAN[pos][key]) × weight, so an average starter
// adds 0 and league averages hold. None of these adds or removes an rng() draw.
// E1_W scales ONLY the new terms; no existing constant is touched.
const E1_W = 1.1
/** E1: relative rating value vs the average starter at that position (0 when average). */
function rmean(pos: string | undefined, key: string, val: number): number {
  const m = pos ? POS_MEAN[pos]?.[key] : undefined
  return m === undefined ? 0 : val - m
}

// ── J8a2: position-correct effective ratings for the individual pickers ───────
// The pre-j8a2 pickers read `a.KEY ?? 70`, which gives a player who does not carry
// a rating (a CB has no PUR in his attribute schema) the flat league 70 — below a
// real defender's level. j8a2 uses the player's own value when he has it, else the
// mean for his POSITION (POS_MEAN) — the position-correct effective rating — and
// only when the position carries no mean at all, a blend of the nearest ratings
// that position does carry (see `positionRating` in individual.ts). Never a flat
// 70. With `setJ8a2(false)` this returns the old `?? 70` value, so the OFF path is
// byte-identical.
/** J8a2: a player's rating — his own, else his position's mean, else a blend of
 *  the ratings that position does carry. Never a flat 70 (OFF keeps `?? 70`). */
function eff(p: Player, key: string): number {
  const a = mkAttrs(p)
  const v = a[key]
  if (v !== undefined) return v
  if (!J8A2_ON) return 70
  return positionRating(p.pos, a, key)
}
/** E1: QB throw power sharpens the deep separation edge (deep throws only). */
function qbDeepThp(qbA: Record<string, number>, depth: number): number {
  if (depth < 15) return 0
  return clamp(rmean('QB', 'THP', qbA.THP ?? 70) * 0.06 * E1_W, -5, 5)
}
/** E1: TUP/TOR trim the share of the pressure penalty to completion that applies. */
function qbPressureRelief(qbA: Record<string, number>): number {
  return clamp((rmean('QB', 'TUP', qbA.TUP ?? 70) * 0.004 + rmean('QB', 'TOR', qbA.TOR ?? 70) * 0.003) * E1_W, 0, 0.4)
}
/** E1: QB mobility (SPD/ACC/BTK/STR) shrinks sack chance. */
function qbSackEscape(qbA: Record<string, number>): number {
  return clamp(
    (rmean('QB', 'SPD', qbA.SPD ?? 70) * 0.0012 +
      rmean('QB', 'ACC', qbA.ACC ?? 70) * 0.0008 +
      rmean('QB', 'BTK', qbA.BTK ?? 70) * 0.0006 +
      rmean('QB', 'STR', qbA.STR ?? 70) * 0.0004) * E1_W,
    -0.15, 0.18,
  )
}
/** E1: QB play-action proficiency scales the existing play-action bonus ×0.7–1.3. */
function qbPacMult(qbA: Record<string, number>): number {
  return clamp(1 + rmean('QB', 'PAC', qbA.PAC ?? 70) * 0.005 * E1_W, 0.7, 1.3)
}
/** E1: awareness trims interception risk a little; throw power trims it on deep balls. */
function qbIntMult(qbA: Record<string, number>, depth: number): number {
  const awr = clamp(1 - rmean('QB', 'AWR', qbA.AWR ?? 70) * 0.0015 * E1_W, 0.9, 1.08)
  const deep = depth >= 15 ? clamp(1 - rmean('QB', 'THP', qbA.THP ?? 70) * 0.0015 * E1_W, 0.85, 1.1) : 1
  return awr * deep
}
/** E1: a receiver's hands move the incompletion share on catchable balls (CTH; CIT tight, SPC/JMP deep). */
function targetCatchProb(target: Player | undefined, tA: Record<string, number>, depth: number, tight: boolean): number {
  if (!target) return 0
  let p = rmean(target.pos, 'CTH', tA.CTH ?? 70) * 0.0006
  if ((target.pos === 'WR' || target.pos === 'TE') && tight) {
    p += rmean(target.pos, 'CIT', tA.CIT ?? 70) * 0.0005
    p += rmean(target.pos, 'STR', tA.STR ?? 70) * 0.0002
  }
  if ((target.pos === 'WR' || target.pos === 'TE') && depth >= 15) {
    p += rmean(target.pos, 'SPC', tA.SPC ?? 70) * 0.0005 + rmean(target.pos, 'JMP', tA.JMP ?? 70) * 0.0005
  }
  return clamp(p * E1_W, -0.035, 0.035)
}
/** E1: WR/TE burst (ACC/COD) joins separation a little. */
function targetAccCod(target: Player | undefined, tA: Record<string, number>): number {
  if (!target || (target.pos !== 'WR' && target.pos !== 'TE')) return 0
  return clamp((rmean(target.pos, 'ACC', tA.ACC ?? 70) * 0.04 + rmean(target.pos, 'COD', tA.COD ?? 70) * 0.04) * E1_W, -6, 6)
}
/** E1: a receiver's release (RLS) vs the coverage defender's press (PRS) on short man throws. */
function releaseVsPress(target: Player | undefined, tA: Record<string, number>, cover: Player | undefined, manCoverage: number, depth: number): number {
  if (!target || target.pos !== 'WR' || !cover || manCoverage <= 0.5 || depth >= 15) return 0
  const cA = mkAttrs(cover)
  return clamp((rmean('WR', 'RLS', tA.RLS ?? 70) - rmean(cover.pos, 'PRS', cA.PRS ?? 70)) * 0.06 * E1_W, -8, 8)
}
/** E1: OL awareness blunts part of the blitz bonus (9 × (1 − this)). */
function olBlitzAware(ol: Player[]): number {
  return clamp(avg(ol.map((p) => rmean(p.pos, 'AWR', mkAttrs(p).AWR ?? 70))) * 0.005 * E1_W, -0.18, 0.3)
}
/** E1: OL strength helps short-yardage runs (≤ 2 to go). */
function olShortStrength(ol: Player[], distance: number): number {
  if (distance > 2) return 0
  return clamp(avg(ol.map((p) => rmean(p.pos, 'STR', mkAttrs(p).STR ?? 70))) * 0.1 * E1_W, -6, 6)
}
/** E1: a tight end joins run blocking at 15% weight. */
function teRunBlock(te: Player | undefined): number {
  if (!te) return 0
  const a = mkAttrs(te)
  return (rmean('TE', 'RBK', a.RBK ?? 70) * 0.7 + rmean('TE', 'IBL', a.IBL ?? 70) * 0.3) * 0.15 * E1_W
}
/** L12.10 B0: a fullback's lead block joins run blocking on two-back runs (centered; no rng). */
function fbLeadBlock(fb: Player | undefined): number {
  if (!fb) return 0
  const a = mkAttrs(fb)
  return clamp(rmean('FB', 'RBK', a.RBK ?? 70) * 0.7 + rmean('FB', 'IBL', a.IBL ?? 70) * 0.5, -7, 7)
}
/** L13: 21 personnel's second back can lead-block (centered, so only a good blocker helps). */
function secondBackLeadBlock(rb: Player | undefined): number {
  if (!rb) return 0
  const a = mkAttrs(rb)
  return clamp((rmean('RB', 'RBK', a.RBK ?? 70) * 0.5 + rmean('RB', 'IBL', a.IBL ?? 70) * 0.5 - 70) * 0.1, -3, 3)
}
/** E1: SPM/SFA/COD/ACC join a running back's elusiveness (small). */
function rbElusivenessExtras(pos: string | undefined, a: Record<string, number>): number {
  if (pos !== 'RB') return 0
  return clamp(
    (rmean('RB', 'SPM', a.SPM ?? 70) * 0.03 +
      rmean('RB', 'SFA', a.SFA ?? 70) * 0.03 +
      rmean('RB', 'COD', a.COD ?? 70) * 0.03 +
      rmean('RB', 'ACC', a.ACC ?? 70) * 0.03 +
      rmean('RB', 'STR', a.STR ?? 70) * 0.02) * E1_W,
    -8, 8,
  )
}
/** E1: BTK adds yards after contact on runs of 3+. */
function rbAfterContact(pos: string | undefined, a: Record<string, number>, gain: number): number {
  if (pos !== 'RB' || gain < 3) return 0
  return clamp(Math.round(rmean('RB', 'BTK', a.BTK ?? 70) * 0.04 * E1_W), -4, 4)
}
/** E1: ball security — CAR moves fumble chance around the existing style factor. */
function rbCarrySecurity(pos: string | undefined, a: Record<string, number>): number {
  return clamp(1 - (rmean(pos, 'CAR', a.CAR ?? 70) / 100) * E1_W, 0.7, 1.3)
}

// ── L12 E2: defense, kicking and general ratings ─────────────────────────────
// Same shape as E1: every term is (rating − POS_MEAN) × weight, so an average
// starter adds 0 and league averages hold. No rng() draw is added or removed.
const E2_W = 1.0
/** E2: average relative value of one rating across a group, per player's position. */
function relAvg(key: string, list: Array<Player | undefined>): number {
  const ps = list.filter((p): p is Player => !!p)
  if (!ps.length) return 0
  return avg(ps.map((p) => rmean(p.pos, key, mkAttrs(p)[key] ?? 70)))
}
/** E2: DL quickness (SPD/ACC/AGI) joins the rush; STR vs the OL joins every rusher. */
function dlRushExtras(dl: Player[], olStrRel: number): number {
  if (!dl.length) return 0
  return avg(dl.map((p) => {
    const a = mkAttrs(p)
    const quick = rmean(p.pos, 'SPD', a.SPD ?? 70) * 0.12 +
      rmean(p.pos, 'ACC', a.ACC ?? 70) * 0.12 +
      rmean(p.pos, 'AGI', a.AGI ?? 70) * 0.06
    const str = (rmean(p.pos, 'STR', a.STR ?? 70) - olStrRel) * 0.05
    return quick + str
  }))
}
/** E2: on a blitz the second-level rush (max PMV/FMV) joins the pressure. */
function lbBlitzRush(lbs: Player[]): number {
  if (!lbs.length) return 0
  return avg(lbs.map((p) => {
    const a = mkAttrs(p)
    return Math.max(rmean(p.pos, 'PMV', a.PMV ?? 70), rmean(p.pos, 'FMV', a.FMV ?? 70))
  }))
}

// ── J8b: pass rush & protection, one matchup at a time ───────────────────────
// Protection is decided rep by rep, never by a starting-OL average: every pass
// rusher is matched to the blocker actually assigned to him (an edge rusher to a
// tackle, an interior rusher to a guard/centre, a blitzer to the back), and each
// rep is the rusher's chosen move (PMV or FMV) and his counter, get-off (ACC),
// STR and SPD — read through his PRC pass/run read — against that blocker's PBK,
// STR, AGI and AWR, with the rusher's and the blocker's OWN in-game fatigue. The
// team result is the union of those reps: the weakest link (the max win) drives
// the pressure edge, so one weak LT gives up the blind-side hit while a strong
// interior holds, and a blitzer only counts when he actually rushes. Every pick
// is a deterministic hash — no rng() draw — and the whole term is centred on its
// measured league mean (`PB_CENTER`), so `setJ8b(false)` is byte-identical to
// the base and leaving it ON widens the distribution without moving league means.
export const PB = {
  // per-rep weights (all rating-relative via rmean, so an average rep is 0)
  moveW: 1.0, // the rusher's chosen move (the better of PMV / FMV)
  counterW: 0.35, // his counter move, if the first is stoned
  getoffW: 0.28, // ACC get-off
  rushStrW: 0.14, // rusher STR (bull)
  rushSpdW: 0.10, // rusher SPD (edge)
  readW: 0.10, // rusher PRC (run/pass read — a poor reader is a step late)
  pbkW: 1.0, // blocker PBK
  blockStrW: 0.20, // blocker STR (anchor)
  mirrorW: 0.14, // blocker AGI (mirror)
  awrW: 0.12, // blocker AWR (recognition / pass-off)
  styleW: 0.9, // a speed/finesse rusher's burst, a power rusher's push
  // twists & miss-pickups (the two blockers pass off with their OWN AWR)
  twistRate: 0.28, // share of reps that are a twist / stunt
  passOffW: 0.02, // blocker AWR rel → the exchange is clean
  missPick: 0.7, // a missed pickup lets the rusher through (× freeWin)
  freeWin: 16, // a runner no one is assigned to block
  // fatigue, per on-field player (replaces the R15 unit fatDiff pressure term)
  fatW: 7.0,
  staW: 0.06, // the player's STA rating softens his own fatigue
  // team blend: the weakest rep leads; the other reps add a little
  unionW: 1.0,
  blendW: 0.36,
  // the pressure clock (animation): a bigger win arrives sooner
  baseTime: 3.3,
  secPerUnit: 0.05,
  minTime: 0.7,
  maxTime: 4.4,
  lossLine: 0, // a rep with a win above this is lost
} as const

/**
 * J8b: precomputed by `protectionProbe` — the raw rush edge's league mean minus
 * the replaced player terms' league mean. Subtracted from every pass (the
 * `WX_CENTER` pattern) so the individual reps only widen the distribution; the
 * league pressure and sack rates do not move.
 */
export const PB_CENTER = { edge: 17.25 }

/** Dev accumulator (turned on by `protectionProbe`): the two league means. */
export const PB_STAT = { on: false, n: 0, raw: 0, old: 0 }

/** J8b: one rusher-vs-blocker rep. An average rusher vs an average blocker is 0. */
function rushRepWin(r: Player, b: Player | undefined, key: string, fat: Record<string, number> | undefined): number {
  const ra = mkAttrs(r)
  const pmv = rmean(r.pos, 'PMV', ra.PMV ?? 70)
  const fmv = rmean(r.pos, 'FMV', ra.FMV ?? 70)
  const speed = clamp(styleProfile(r).rush, -0.5, 1)
  const primary = Math.max(pmv, fmv) + speed * PB.styleW
  const counter = Math.min(pmv, fmv)
  const rsta = clamp(rmean(r.pos, 'STA', ra.STA ?? 70) * PB.staW, -0.35, 0.35)
  let rush = primary * PB.moveW + counter * PB.counterW +
    rmean(r.pos, 'ACC', ra.ACC ?? 70) * PB.getoffW +
    rmean(r.pos, 'STR', ra.STR ?? 70) * PB.rushStrW +
    rmean(r.pos, 'SPD', ra.SPD ?? 70) * PB.rushSpdW +
    rmean(r.pos, 'PRC', ra.PRC ?? 70) * PB.readW
  rush -= (fat?.[r.id] ?? 0) * PB.fatW * (1 - rsta)
  let block = 0
  let passOff = 0.55
  if (b) {
    const ba = mkAttrs(b)
    block = rmean(b.pos, 'PBK', ba.PBK ?? 70) * PB.pbkW +
      rmean(b.pos, 'STR', ba.STR ?? 70) * PB.blockStrW +
      rmean(b.pos, 'AGI', ba.AGI ?? 70) * PB.mirrorW +
      rmean(b.pos, 'AWR', ba.AWR ?? 70) * PB.awrW
    const bsta = clamp(rmean(b.pos, 'STA', ba.STA ?? 70) * PB.staW, -0.35, 0.35)
    block -= (fat?.[b.id] ?? 0) * PB.fatW * (1 - bsta)
    passOff = clamp(0.55 + rmean(b.pos, 'AWR', ba.AWR ?? 70) * PB.passOffW, 0.2, 0.9)
  }
  let win = rush - block
  if (!b) return win + PB.freeWin
  // A twist / stunt: the two blockers must pass off, each on his OWN AWR.
  if (h01(`${key}:tw`) < PB.twistRate && h01(`${key}:pk`) > passOff) win += PB.freeWin * PB.missPick
  return win
}

interface RushRep { id: string; pos: string; blockerId?: string; win: number; blitz: boolean; free: boolean }
export interface RushResult {
  edge: number
  reps: RushRep[]
  credit?: RushRep
  maxWin: number
  freeRusher: boolean
  lost: number
  time: number
}

/** J8b: assign every rusher a blocker and score the reps (deterministic only). */
function rushMatchups(
  n: number, defId: string,
  dl: Player[], lbs: Player[], cbs: Player[],
  ol: Player[], rb: Player | undefined, te: Player | undefined, fb: Player | undefined,
  blitz: boolean, fat: Record<string, number> | undefined,
  offMove: string | undefined, defMove: string | undefined,
  dlUsage: 'starters' | 'rotate' | undefined, q4: boolean,
): RushResult {
  const rushers: { p: Player; blitz: boolean }[] = dl.map((p) => ({ p, blitz: false }))
  // Only the linebackers / defensive backs who actually blitz rush — never the
  // whole LB room averaged together. One or two extra rushers, hash-picked by
  // their pass rush, and only on a blitz call.
  if (blitz) {
    const kBase = 1 + (hash32(`${n}:${defId}:blitzk`) % 2)
    // J12: a QB spy is a defender assigned to the quarterback, so he cannot also
    // be the extra blitzer — on a spy call one fewer linebacker/DB rushes.
    const k = defMove === 'spyQB' && J12_ON ? Math.max(0, kBase - 1) : kBase
    const pool = [...lbs, ...cbs]
    const used = new Set<string>()
    for (let i = 0; i < k; i++) {
      const cand = hashPick(pool.filter((p) => !used.has(p.id)), (p) => {
        const a = mkAttrs(p)
        return Math.max(1, Math.max(a.PMV ?? 70, a.FMV ?? 70) + styleProfile(p).rush * 12)
      }, hash32(`${n}:${defId}:blitzer${i}`))
      if (cand) { used.add(cand.id); rushers.push({ p: cand, blitz: true }) }
    }
  }
  // Alignment: edge rushers take the tackles, interior rushers the guards/centre,
  // a blitzer is picked up by the back (RB, then TE, then FB).
  const edges = rushers.filter((r) => !r.blitz && r.p.pos === 'DE')
  const interior = rushers.filter((r) => !r.blitz && r.p.pos !== 'DE')
  const blitzers = rushers.filter((r) => r.blitz)
  const tackles = ol.filter((p) => p.pos === 'OT')
  const inside = ol.filter((p) => p.pos === 'OG' || p.pos === 'C')
  const helpers = [rb, te, fb].filter((p): p is Player => !!p)
  const reps: RushRep[] = []
  const addReps = (group: { p: Player; blitz: boolean }[], blockers: Player[], tag: string) => {
    const order = group.map((_, i) => i).sort((a, b) => (hash32(`${n}:${defId}:${tag}o${a}`) % 100000) - (hash32(`${n}:${defId}:${tag}o${b}`) % 100000))
    group.forEach((r, i) => {
      const b = i < blockers.length ? blockers[order[i]] : undefined
      reps.push({ id: r.p.id, pos: r.p.pos, blockerId: b?.id, win: rushRepWin(r.p, b, `${n}:${defId}:${tag}${i}`, fat), blitz: r.blitz, free: !b })
    })
  }
  addReps(edges, tackles, 'edge')
  addReps(interior, inside, 'int')
  addReps(blitzers, helpers, 'blitz')
  if (!reps.length) addReps(lbs.map((p) => ({ p, blitz: false })), [...tackles, ...inside], 'lbfb')
  // G11 doubleRusher / J12 DOUBLE & CHIP: a blocker is committed to the
  // opponent's best rusher, so his rep win falls — and the blocker who left his
  // own man frees another rusher elsewhere (his rep win rises). The legacy G11
  // doubleRusher keeps its exact ×0.5; only J12 adds the freed rusher.
  if (offMove === 'doubleRusher' || offMove === 'chipEdge') {
    const mult = offMove === 'doubleRusher' ? J12.doubleWin : J12.chipWin
    let best = -1
    let bestR = -1
    let second = -1
    let secondR = -1
    for (let i = 0; i < reps.length; i++) {
      const p = rushers.find((r) => r.p.id === reps[i].id)?.p
      if (!p) continue
      const a = mkAttrs(p)
      const rv = Math.max(a.PMV ?? 70, a.FMV ?? 70)
      if (rv > bestR) { second = best; secondR = bestR; bestR = rv; best = i }
      else if (rv > secondR) { secondR = rv; second = i }
    }
    if (best >= 0) {
      reps[best].win *= mult
      if (J12_ON && second >= 0) reps[second].win += J12.freeWin
    }
  }
  // J12 spyQB: the spy is one fewer rusher — the least threatening rep drops
  // out of the union (his eyes are on the QB, not the pass rush). OFF keeps the
  // pre-J12 flat −4 so the user's G11 call is unchanged.
  if (defMove === 'spyQB') {
    if (J12_ON) {
      if (reps.length > 1) {
        let worst = 0
        for (let i = 1; i < reps.length; i++) if (reps[i].win < reps[worst].win) worst = i
        reps.splice(worst, 1)
      }
    }
  }
  const wins = reps.map((r) => r.win)
  const maxWin = wins.length ? Math.max(...wins) : 0
  const meanWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0
  let edge = PB.unionW * maxWin + PB.blendW * meanWin
  // Workload: starter-heavy use tires in Q4, a rotating front is fresher late
  // (the R15 G11/G12 coach inputs). The pre-J12 spy flat cost stays on the OFF path.
  if (defMove === 'spyQB' && !J12_ON) edge -= 4
  if (dlUsage === 'starters') { if (q4) edge -= 3 }
  else if (dlUsage === 'rotate') edge += q4 ? 1.5 : -1.5
  const credit = reps[wins.indexOf(maxWin)]
  const lost = wins.filter((w) => w > PB.lossLine).length
  const time = clamp(PB.baseTime - maxWin * PB.secPerUnit, PB.minTime, PB.maxTime)
  return { edge, reps, credit, maxWin, freeRusher: !!credit?.free, lost, time }
}
/** E2: pursuit (DL/LB PUR + SPD) shrinks the run's big-play tail. */
function runPursuit(dl: Player[], lbs: Player[]): number {
  const all = [...dl, ...lbs]
  return relAvg('PUR', all) * 0.7 + relAvg('SPD', all) * 0.4
}
/** E2: LB recognition, block shedding and athleticism join the second level. */
function lbRunExtras(lbs: Player[]): number {
  return relAvg('PRC', lbs) * 0.16 + relAvg('BSH', lbs) * 0.16 +
    relAvg('STR', lbs) * 0.08 + relAvg('ACC', lbs) * 0.08 + relAvg('AGI', lbs) * 0.08
}
/** E2: secondary quickness (ACC/AGI/STR) joins coverage. */
function dbCoverageExtras(cbs: Player[], saf: Player[]): number {
  const all = [...cbs, ...saf]
  return relAvg('ACC', all) * 0.05 + relAvg('AGI', all) * 0.05 + relAvg('STR', all) * 0.03
}
/** E2: defensive play recognition (DL/LB/S PRC) shrinks play-action and screens. */
function recognition(dl: Player[], lbs: Player[], saf: Player[]): number {
  return (relAvg('PRC', dl) + relAvg('PRC', lbs) + relAvg('PRC', saf)) / 3
}
/** E2: a tackler's TAK squeezes yards after the catch. */
function tacklerYacShrink(id: string | undefined, groups: Player[][]): number {
  if (!id) return 0
  for (const g of groups) {
    const p = g.find((x) => x.id === id)
    if (p) return Math.round(rmean(p.pos, 'TAK', mkAttrs(p).TAK ?? 70) * 0.05 * E2_W)
  }
  return 0
}
/** E2: a big hitter's HPW adds a small forced-fumble chance on a catch. */
function tacklerHitPower(id: string | undefined, groups: Player[][]): number {
  if (!id) return 0
  for (const g of groups) {
    const p = g.find((x) => x.id === id)
    if (p) return clamp(rmean(p.pos, 'HPW', mkAttrs(p).HPW ?? 70) * 0.0004 * E2_W, 0, 0.004)
  }
  return 0
}
/** E2: deterministic weighted pick by a hash key (no rng draw). */
function hashPick<T>(list: T[], weight: (t: T) => number, key: number): T | undefined {
  if (!list.length) return undefined
  const total = list.reduce((s, t) => s + Math.max(0, weight(t)), 0)
  if (total <= 0) return list[key % list.length]
  let roll = (key / 4294967296) * total
  for (const t of list) {
    const w = Math.max(0, weight(t))
    if (roll < w) return t
    roll -= w
  }
  return list[list.length - 1]
}

// ── J8a: individual defence vs the run + chase-downs ─────────────────────────
// Every team/unit average in the run-front and pursuit path is replaced by the
// specific players on the play. The point of attack is one deterministic hash
// (`n:defId:gap`) of the gap: the blocker(s) and defender(s) at that gap carry
// most of the weight and the rest of the front contributes as a faded sum of
// their own individual matchups. Chase-downs compare the carrier's speed with
// the 1–3 nearest pursuers (CB/S/LB, hash-picked) instead of a team PUR/SPD
// mean, and the player who decides the play (the point-of-attack defender on a
// short run, the pursuer who runs him down on a long one) is credited. Every
// term is centred on POS_MEAN, so the league average holds and the league totals
// are not shrunk. Picks are hashes: no rng() draw is added or removed.
// `setJ8a(false)` restores the exact pre-J8a behaviour (byte-identical).
let J8A_ON = true
export function setJ8a(on: boolean) { J8A_ON = on }
/** J8a: read the toggle so a probe can restore it exactly. */
export function getJ8a(): boolean { return J8A_ON }

export const J8A = {
  /** Point-of-attack share of the front weight; the rest of the front splits the
   *  remainder, fading with each gap away from the point of attack. */
  poaWeight: 0.62,
  /** Steepness of that fade (bigger = more concentrated on the point of attack). */
  gapFade: 0.9,
  /** mph per point of SPD. Sized so an RB's SPD p10–p90 maps to the NFL RB top
   *  speed p10–p90 (14.7–18.0 mph) and a CB's to its p10–p90 (16.4–18.7) in
   *  speed-separation-targets.json. Not shrunk: the individual speed spread is
   *  the point of the job, so this is deliberately the full NFL rating→mph span. */
  mphPerSpd: 0.26,
  /** A pursuer's closing skill: PUR/AWR above the position mean add mph, so a
   *  high-motor defender closes a slower carrier from behind. */
  chasePur: 0.014,
  chaseAwr: 0.010,
  /** The carrier's ACC burst adds to his top speed. */
  chaseAcc: 0.010,
  /** Pursuer geometry by depth/side — the base yards a defender starts behind
   *  the carrier plus a per-play hash jitter. Ordered by the NFL behind-tackler
   *  data (S closest 1.50 yd, CB 2.04, LB furthest 2.52): the slow pursuer is
   *  also the one who starts furthest behind, so his speed deficit is not
   *  cancelled by a smaller head start. This is the head start, so it is NOT
   *  tied to the sampled gain (that coupling was what exploded the tail). */
  posDepth: { S: 1.5, CB: 2.5, LB: 4.0 } as Record<string, number>,
  depthJitter: 3.5,
  /** Chaser pick: the nearest defender is weighted toward the covering corner
   *  (the NFL fastest-pursuer share CB 64 / S 19 / LB 17) but the second level
   *  still wins sometimes, so a fast back on a slow pursuer gets a real edge. */
  chaserWeight: { CB: 4.5, S: 1.0, LB: 0.8 } as Record<string, number>,
  /** A corner closing from an angle covers ground slower than his top speed;
   *  this offsets the edge so the league-mean chase gap stays near zero. */
  posClose: { CB: 0.3, S: 0.2, LB: 0 } as Record<string, number>,
  /** Per-play matchup jitter (mph) on the edge: two defenders of the same top
   *  speed close differently by angle and lane, giving the gap the NFL spread. */
  edgeJitter: 0.4,
  /** Long-run tail multiplier: mph of carrier edge per unit, per head-start
   *  yard, per pursuit degree, and the re-centre (so E[mult] = 1 and the league
   *  tail holds). The clamp bounds a single back's breakaway. */
  chasePerMph: 0.55,
  headPerYd: 0.05,
  anglePerDeg: -0.004,
  chaseCenter: 0.31,
  chaseLo: 0.4,
  chaseHi: 2.0,
  /** NFL open-field logit on P(TD) (chase-targets.json, with_yd_to_goal model),
   *  edge = carrier mph − pursuer mph, so a faster carrier scores more. */
  logitA: 0.2092,
  logitEdge: 0.60,
  logitHead: 0.1628,
  logitAngle: -0.0087,
  logitNp: -0.2128,
  logitGoal: -0.0769,
  /** The logit is the *unconditional* NFL open-field TD rate, but the sim's base
   *  long-run tail already scores at ~13%; gate only the would-be scores and
   *  scale so the league open-field TD rate lands near the NFL 11%. Raised with
   *  logitEdge so the league-mean P(TD) is re-centred after the steeper speed
   *  weight. */
  tdScale: 2.2,
  /** Run-down extra yards: a short edged tail (`base + tail·u² + edge`), no rng.
   *  u comes from a per-play hash, so the caught-run spread stays heavy-tailed
   *  but deterministic. */
  catchBase: 2.0,
  catchTail: 24,
  catchEdge: 0.6,
  /** Boost applied to the deciding player in the in-group tackler pick. */
  deciderBoost: 2.2,
  /** Credit the closest pursuer with the stop on a long pass (1 = on). */
  passChaserCredit: 1,
  /** Apply the chase to the pass-YAC *yardage* tail too (1 = on). The broadcast
   *  fast-carrier camera gate is seed-sensitive: even a shrink-only pass-yard
   *  change tips seed 33333's harness plays over the 4.5 yd lag bound, so the
   *  yardage tail is left to the plan terms and J8c. The individual effect on a
   *  pass stays in who is credited with the stop (passChaserCredit). */
  passYac: 0,
}

/** J8a: per-play front weights — the point-of-attack man takes `poaWeight`, the
 *  rest split by an exponential fade from his gap. Deterministic; sums to 1. */
function gapWeights(n: number, poi: number, poaWeight: number, fade: number): number[] {
  if (n <= 0) return []
  if (n === 1) return [1]
  const w = new Array<number>(n).fill(0)
  let rest = 0
  for (let i = 0; i < n; i++) {
    if (i === poi) continue
    w[i] = Math.exp(-fade * Math.abs(i - poi))
    rest += w[i]
  }
  const scale = rest > 0 ? (1 - poaWeight) / rest : 0
  for (let i = 0; i < n; i++) if (i !== poi) w[i] *= scale
  w[poi] = poaWeight
  return w
}

/** J8a: weighted sum of a per-player value over the front (weights sum to 1). */
function gapValue(front: Player[], w: number[], value: (p: Player) => number): number {
  let s = 0
  const n = Math.min(front.length, w.length)
  for (let i = 0; i < n; i++) s += w[i] * value(front[i])
  return s
}

/** J8a: the point-of-attack index over a front of `n` gaps. */
function gapIndex(key: string, n: number): number {
  if (n <= 1) return 0
  return hash32(key) % n
}

/** J8a: top-N distinct deterministic weighted picks (no rng() draw). */
function hashPickN<T>(list: T[], weight: (t: T) => number, key: number, n: number): T[] {
  const pool = [...list]
  const out: T[] = []
  let k = key >>> 0
  while (out.length < n && pool.length) {
    const p = hashPick(pool, weight, k)
    if (p === undefined) break
    const i = pool.indexOf(p)
    if (i < 0) break
    out.push(p)
    pool.splice(i, 1)
    k = (k * 1664525 + 1013904223) >>> 0
  }
  return out
}

/** J8a: a player's top speed in mph, from the 2018 tracking medians. Centred on
 *  POS_MEAN SPD, so a league-average starter sits exactly at his position median. */
const SPEED_MPH: Record<string, number> = {
  WR: 18.29, TE: 16.41, RB: 16.32, CB: 17.55, S: 16.88, LB: 16.16,
  QB: 16.0, FB: 15.6, DE: 15.4, DT: 14.6, K: 14.5, P: 14.6,
}
function speedMph(pos: string | undefined, spd: number): number {
  const base = (pos ? SPEED_MPH[pos] : undefined) ?? 16.0
  const mean = pos ? POS_MEAN[pos]?.SPD : undefined
  return mean === undefined ? base : base + (spd - mean) * J8A.mphPerSpd
}

/** J8a: a pursuer's effective speed — top speed plus closing skill (PUR/AWR). */
function pursuerMph(p: Player): number {
  return speedMph(p.pos, eff(p, 'SPD')) + rmean(p.pos, 'PUR', eff(p, 'PUR')) * J8A.chasePur + rmean(p.pos, 'AWR', eff(p, 'AWR')) * J8A.chaseAwr
}

/** J8a: per-play chase geometry — the man who runs the carrier down. */
type Chase = {
  /** Carrier top speed minus the chaser's effective speed (mph); > 0 = faster. */
  edge: number
  /** The chaser's starting distance behind the carrier (yd) — the head start. */
  headStart: number
  /** Pursuit angle in degrees (0 = straight tail chase, 90 = across the field). */
  angle: number
  /** How many hash-picked pursuers are in the chase (1–3). */
  nP: number
  chaser?: Player
}

/** J8a: a carrier's top speed — SPD plus an ACC burst — in mph. */
function carrierMph(p: Player): number {
  return speedMph(p.pos, eff(p, 'SPD')) + rmean(p.pos, 'ACC', eff(p, 'ACC')) * J8A.chaseAcc
}

/** J8a: the chaser is a hash-picked defender from the second/third level,
 *  weighted toward the covering corner (the NFL fastest-pursuer share) but
 *  letting a slow LB/S be the man in pursuit when the hash says so — which is
 *  what opens the positive carrier-speed edge. His depth (head start) and the
 *  pursuit angle are per-play hashes; the carrier's edge on him (carrier mph −
 *  pursuer mph, plus the angle-covered corner offset `posClose`) is what the
 *  chase logit is written on. */
function chaseInfo(carrier: Player | undefined, pursuers: Player[], key: string): Chase {
  if (!carrier || !pursuers.length) return { edge: 0, headStart: 0, angle: 0, nP: 0 }
  const cmph = carrierMph(carrier)
  const best = hashPick(pursuers, (p) => J8A.chaserWeight[p.pos] ?? 1, hash32(`${key}:pick`))
  if (!best) return { edge: cmph, headStart: 0, angle: 0, nP: pursuers.length }
  const depth = (J8A.posDepth[best.pos] ?? 8) + h01(`${key}:${best.id}:depth`) * J8A.depthJitter
  return {
    edge: cmph - pursuerMph(best) + (J8A.posClose[best.pos] ?? 0) + (h01(`${key}:jit`) * 2 - 1) * J8A.edgeJitter,
    headStart: depth,
    angle: h01(`${key}:angle`) * 90,
    nP: pursuers.length,
    chaser: best,
  }
}

/** J8a: NFL open-field TD logit (chase-targets.json, with_yd_to_goal model). */
function chaseTdProb(c: Chase, ydToGoal: number): number {
  const x = clamp(
    J8A.logitA + J8A.logitEdge * c.edge + J8A.logitHead * c.headStart
      + J8A.logitAngle * c.angle + J8A.logitNp * c.nP + J8A.logitGoal * ydToGoal,
    -12, 12,
  )
  return 1 / (1 + Math.exp(-x))
}

/** J8a: the long-run tail multiplier — the carrier's edge on the nearest pursuer
 *  (and his head start / the pursuit angle) lengthen or shorten the run. Centred
 *  by `chaseCenter` so the league-mean tail holds (mean-neutral by construction);
 *  clamped so one fast back cannot explode the distribution. No rng() draw. */
function chaseTailMult(c: Chase): number {
  const m = 1 + J8A.chasePerMph * c.edge + J8A.headPerYd * c.headStart
    + J8A.anglePerDeg * c.angle + J8A.chaseCenter
  return clamp(m, J8A.chaseLo, J8A.chaseHi)
}

/** J8a: the extra yards when he is run down — a short edged tail (no rng). */
function chaseCaughtExtra(c: Chase, u: number): number {
  return Math.max(1, Math.round(J8A.catchBase + J8A.catchTail * u * u + J8A.catchEdge * c.edge))
}

/** J8a: the 1–3 pursuers for an open-field chase — hash-picked across the whole
 *  second/third level (LB/S/CB) by speed and pursuit. The chaser's position mix
 *  is set by geometry (posBonus/posDepth), not by picking CBs first. */
function pickPursuers(key: string, lbs: Player[], saf: Player[], cbs: Player[]): Player[] {
  const pool = [...lbs, ...saf, ...cbs]
  return hashPickN(pool, (p) => {
    return Math.max(1, eff(p, 'SPD') * 0.5 + eff(p, 'PUR') * 0.3 + eff(p, 'AWR') * 0.2)
  }, hash32(key), 3)
}

/** J8a: short-yardage push from the two interior linemen at the point of attack
 *  (the centre plus the guard nearest the POA), not the whole line's mean. */
function interiorShortStrength(ol: Player[], key: string): number {
  const c = ol.find((p) => p.pos === 'C')
  const ogs = ol.filter((p) => p.pos === 'OG')
  const g = ogs.length ? ogs[hash32(`${key}:og`) % ogs.length] : undefined
  const picks = [c, g].filter((p): p is Player => !!p)
  if (!picks.length) return 0
  let s = 0
  for (const p of picks) s += rmean(p.pos, 'STR', eff(p, 'STR'))
  return clamp((s / picks.length) * 0.1 * E1_W, -6, 6)
}

/** J8a: a small individual STA term (Q4 fatigue decided by the men in the play). */
function staRel(list: Array<Player | undefined>): number {
  const ps = list.filter((p): p is Player => !!p)
  if (!ps.length) return 0
  let s = 0
  for (const p of ps) s += rmean(p.pos, 'STA', eff(p, 'STA'))
  return s / ps.length
}

// ── J3b: individual goal-line conversion ─────────────────────────────────────
// The pre-J3b engine scored any run that crossed the goal line and consulted no
// defender at all — an implicit "average defender" assumption. J3b decides a
// would-be goal-line score between the specific carrier (his own STR/TRK/BCV) and
// the specific man at the point of attack (J8a's gap pick; his own BSH/STR/TAK).
// Every rating is read from the deciding man himself and centred on a single fixed
// league constant (J3B.carCenter / J3B.defCenter — no position table, no unit mean),
// so an average pair sits at J3B.glBase; a power back / elite nose tackle swings the
// whole result.
/** J3b: the carrier's goal-line power (his own STR/TRK/BCV, centred on the fixed
 *  J3B.carCenter league constant — no position mean, no unit mean). */
function glCarrierPower(p: Player | undefined): number {
  if (!p) return 0
  return eff(p, 'STR') * J3B.carStrW + eff(p, 'TRK') * J3B.carTrkW + eff(p, 'BCV') * J3B.carBcvW - J3B.carCenter
}
/** J3b: the point-of-attack defender's goal-line resistance (his own BSH/STR/TAK,
 *  centred on the fixed J3B.defCenter league constant). */
function glDefResist(p: Player | undefined): number {
  if (!p) return 0
  return eff(p, 'BSH') * J3B.defBshW + eff(p, 'STR') * J3B.defStrW + eff(p, 'TAK') * J3B.defTakW - J3B.defCenter
}
/** J3b: chance the POA defender stands the carrier up short of the goal line. */
function glStuffChance(carrier: Player | undefined, defs: Array<Player | undefined>): number {
  const ds = defs.filter((p): p is Player => !!p)
  let resist = 0
  if (ds.length) {
    // The primary gap defender leads; a second front-seven man fades in at half.
    resist = glDefResist(ds[0]) * (ds.length > 1 ? 0.7 : 1) + (ds.length > 1 ? glDefResist(ds[1]) * 0.3 : 0)
  }
  const diff = resist - glCarrierPower(carrier)
  return clamp(J3B.glBase + diff * J3B.glSlope, J3B.glLo, J3B.glHi)
}

// ── J8a2: the run-defence read loop, one defender at a time ──────────────────
// The pre-j8a2 run front is a gap-weighted blend of the front's BSH/TAK (DL) and
// TAK/PUR (LB). j8a2 gives every front defender his own read: he reads the guard
// and the backfield with his PRC, takes his first step (right, or a bite on a
// misdirection/play-action key, which the hash decides and his PRC reduces), fits
// his gap (ACC/AGI), sheds his blocker (BSH/STR) and finishes in his tackle
// radius (TAK/HPW/PUR). The safety fills the alley with his own ZCV/PRC/TAK/PUR
// and the fullback's kick-out is matched against the defender at the point of
// attack (his AWR decides kick-out vs lead-through on contact). An LB's style —
// run-and-chase / thumper / coverage — weights which of his own ratings matter.
// EVERY term is centred on POS_MEAN, so a league-average front reads exactly as
// the pre-j8a2 level: only the SPREAD widens. Picks are hashes (`hash32`/`h01`)
// — no rng() draw is added or removed. `setJ8a2(false)` restores the exact
// pre-j8a2 (J8a-ON) behaviour, byte-identical. Tune only this block.
let J8A2_ON = true
export function setJ8a2(on: boolean) { J8A2_ON = on }
/** J8a2: read the toggle so a probe can restore it exactly. */
export function getJ8a2(): boolean { return J8A2_ON }

export const J8A2 = {
  /** PRC: read the guard / backfield and take the right first step (rating pts). */
  readW: 0.55,
  /** ACC+AGI: the quickness to fit the gap in front of the blocker. */
  fitW: 0.40,
  /** TAK+HPW+PUR: the tackle radius / finish at the point of attack. */
  radiusW: 0.45,
  /** STR: shed / anchor against the blocker he must beat (BSH is in the base). */
  shedW: 0.35,
  /** First-step right or wrong. P(bite) falls with PRC; a defender who bites is a
   *  gap late. Applied per defender and centred on his OWN P(bite), so a mean
   *  front is unchanged and only the low-PRC defenders lose plays. */
  biteBase: 0.10,
  biteMisdirection: 1.8,
  bitePrcW: 0.010,
  biteMin: 0.01,
  biteMax: 0.45,
  bitePenalty: 4.5,
  /** Safety alley fill (his own TAK/ZCV/PRC/PUR), centred on the safeties on
   *  the field so the pick cannot drift the run-defence mean. */
  alleyW: 0.9,
  /** FB kick-out / lead-through vs the defender at the point of attack: the FB's
   *  RBK/IBL carry the block and his AWR the kick-out read, the defender's own
   *  BSH/STR resist it. Replaces the FB-only `fbLeadBlock` term (mean-neutral). */
  kickW: 0.9,
  kickDefW: 0.5,
  kickAwrW: 0.4,
  /** LB styles: run-and-chase (PUR/SPD), thumper (BSH/STR/HPW), coverage
   *  (ZCV/PRC). Each component is centred on the LB position mean. */
  styleChaseW: 0.30,
  styleThumpW: 0.30,
  styleCoverW: 0.20,
} as const
// The man who read it right and filled the gap leads the tackler pick: `resolveRun`
// passes the read key as the `decider`, which gets `J8A.deciderBoost` (2.2) in
// `runTackler`. No separate j8a2 boost is needed.

/** J8a2: P(a defender takes a wrong first step / bites on this play). Falls with
 *  his PRC relative to his position; a misdirection or play-action key raises it. */
function biteProb(prcRel: number, misdirection: boolean): number {
  const base = J8A2.biteBase * (misdirection ? J8A2.biteMisdirection : 1)
  return clamp(base - prcRel * J8A2.bitePrcW, J8A2.biteMin, J8A2.biteMax)
}
/** J8a2: did this defender bite (wrong first step) on this play? */
function bitesAt(p: Player, key: string, misdirection: boolean): boolean {
  const pBite = biteProb(rmean(p.pos, 'PRC', eff(p, 'PRC')), misdirection)
  return pBite > 0 && h01(`${key}:bite:${p.id}`) < pBite
}
/** J8a2: a defender's read-loop rating contribution (centred; mean holds). */
function readValue(p: Player, key: string, misdirection: boolean): number {
  const prc = rmean(p.pos, 'PRC', eff(p, 'PRC'))
  const fit = (rmean(p.pos, 'ACC', eff(p, 'ACC')) + rmean(p.pos, 'AGI', eff(p, 'AGI'))) * 0.5
  const radius = (rmean(p.pos, 'TAK', eff(p, 'TAK')) + rmean(p.pos, 'HPW', eff(p, 'HPW')) + rmean(p.pos, 'PUR', eff(p, 'PUR'))) / 3
  const pBite = biteProb(prc, misdirection)
  const bit = pBite > 0 && h01(`${key}:bite:${p.id}`) < pBite ? 1 : 0
  return J8A2.readW * prc + J8A2.fitW * fit + J8A2.radiusW * radius - J8A2.bitePenalty * (bit - pBite)
}
/** J8a2: an LB's style — run-and-chase / thumper / coverage — from his own
 *  ratings, centred so a league-average LB adds 0. */
function lbStyle(p: Player): number {
  const chase = (rmean(p.pos, 'PUR', eff(p, 'PUR')) + rmean(p.pos, 'SPD', eff(p, 'SPD'))) * 0.5
  const thump = (rmean(p.pos, 'BSH', eff(p, 'BSH')) + rmean(p.pos, 'STR', eff(p, 'STR')) + rmean(p.pos, 'HPW', eff(p, 'HPW'))) / 3
  const cover = (rmean(p.pos, 'ZCV', eff(p, 'ZCV')) + rmean(p.pos, 'PRC', eff(p, 'PRC'))) * 0.5
  return J8A2.styleChaseW * chase + J8A2.styleThumpW * thump + J8A2.styleCoverW * cover
}
/** J8a2: a defender's run-support value (for the safety alley fill), centred. */
function supportRel(p: Player): number {
  return rmean(p.pos, 'TAK', eff(p, 'TAK')) * 0.4 + rmean(p.pos, 'ZCV', eff(p, 'ZCV')) * 0.2 +
    rmean(p.pos, 'PRC', eff(p, 'PRC')) * 0.2 + rmean(p.pos, 'PUR', eff(p, 'PUR')) * 0.2
}
/** J8a2: the filling safety (alley) and his centred run-support value. The value
 *  is measured against the weighted mean of the pick, so E[value] = 0 exactly. */
function alleyFill(saf: Player[], key: string): { value: number; player?: Player } {
  if (!saf.length) return { value: 0 }
  const w = (p: Player) => Math.max(1, eff(p, 'TAK') * 0.5 + eff(p, 'PRC') * 0.3 + eff(p, 'PUR') * 0.2)
  const pick = hashPick(saf, w, hash32(`${key}:alley`))
  if (!pick) return { value: 0 }
  let tot = 0
  let wMean = 0
  for (const p of saf) { const wi = w(p); tot += wi; wMean += wi * supportRel(p) }
  if (tot <= 0) return { value: 0, player: pick }
  return { value: supportRel(pick) - wMean / tot, player: pick }
}
/** J8a2: the fullback's kick-out vs the defender at the point of attack. Centred:
 *  an average FB against an average defender adds 0, replacing `fbLeadBlock`. */
function fbKick(fb: Player | undefined, def: Player | undefined): number {
  if (!fb) return 0
  const block = rmean('FB', 'RBK', eff(fb, 'RBK')) * 0.7 + rmean('FB', 'IBL', eff(fb, 'IBL')) * 0.5
  const awr = rmean('FB', 'AWR', eff(fb, 'AWR')) * J8A2.kickAwrW
  const resist = def
    ? (rmean(def.pos, 'BSH', eff(def, 'BSH')) * 0.5 + rmean(def.pos, 'STR', eff(def, 'STR')) * 0.5) * J8A2.kickDefW
    : 0
  return clamp(J8A2.kickW * (block + awr - resist), -7, 7)
}

/** J8a2: the front defender whose read decided the run — the point-of-attack DL
 *  or LB who did NOT bite on the misdirection, then the better reader. */
function readKeyDefender(poiDl: Player | undefined, poiLb: Player | undefined, dlKey: string, lbKey: string, mis: boolean): Player | undefined {
  const cands = [poiDl, poiLb].filter((p): p is Player => !!p)
  if (!cands.length) return undefined
  if (cands.length === 1) return cands[0]
  const score = (p: Player) => ({ p, bite: bitesAt(p, p.pos === 'LB' ? lbKey : dlKey, mis) ? 1 : 0, prc: rmean(p.pos, 'PRC', eff(p, 'PRC')) })
  const s = cands.map(score).sort((a, b) => a.bite - b.bite || b.prc - a.prc)
  return s[0].p
}

function topGroup(world: World, teamId: string, positions: Position[], n: number, qbOverride?: Record<string, string>): Player[] {
  // G6: a halftime QB change replaces the starter until the game ends.
  if (qbOverride && positions.length === 1 && positions[0] === 'QB') {
    const id = qbOverride[teamId]
    if (id) {
      const p = (world.roster[teamId] ?? []).find((x) => x.id === id && !x.injured)
      if (p) return [p]
    }
  }
  return depthGroup(world, teamId, positions, n)
}

// ── R15 helpers ───────────────────────────────────────────────────────────────
/** A group's average in-game fatigue (0 when untracked). */
function unitFatigue(fat: Record<string, number> | undefined, list: Array<Player | undefined>): number {
  if (!fat) return 0
  const ps = list.filter((p): p is Player => !!p)
  if (!ps.length) return 0
  return ps.reduce((a, p) => a + (fat[p.id] ?? 0), 0) / ps.length
}

/** R15: offensive personnel → how many RB/TE/WR line up (plus a fullback). */
interface PersonnelCounts { rb: number; te: number; wr: number; fb: boolean }
function personnelCounts(p: Personnel | undefined): PersonnelCounts {
  switch (p) {
    case '00': return { rb: 0, te: 0, wr: 5, fb: false }
    case '10': return { rb: 1, te: 0, wr: 4, fb: false }
    case '11': return { rb: 1, te: 1, wr: 3, fb: false }
    case '12': return { rb: 1, te: 2, wr: 2, fb: false }
    case '13': return { rb: 1, te: 3, wr: 1, fb: false }
    case '21': return { rb: 1, te: 1, wr: 2, fb: true }
    case '22': return { rb: 1, te: 2, wr: 1, fb: true }
    case 'GL': return { rb: 1, te: 3, wr: 0, fb: true }
    default: return { rb: 1, te: 1, wr: 3, fb: false }
  }
}

/** R15: the defensive package that answers an offensive personnel grouping. */
interface Package { dl: number; lb: number; cb: number; s: number }
function defensePackage(p: Personnel | undefined): Package {
  const c = personnelCounts(p)
  const heavy = c.rb + c.te + (c.fb ? 1 : 0)
  if (heavy >= 3) return { dl: 4, lb: 3, cb: 2, s: 2 } // base (4-3)
  if (heavy <= 1) return { dl: 4, lb: 1, cb: 4, s: 2 } // dime
  return { dl: 4, lb: 2, cb: 3, s: 2 } // nickel
}

/** How many players a package lists at a position (for the resolver's groups). */
function packageGroup(world: World, defId: string, positions: Position[], pkg: Package, fat?: Record<string, number>): Player[] {
  const n = positions.includes('DE') || positions.includes('DT') ? pkg.dl
    : positions.includes('LB') ? pkg.lb
      : positions.includes('CB') ? pkg.cb
        : positions.includes('S') ? pkg.s : 0
  if (positions.includes('DE') || positions.includes('DT')) return fieldGroup(world, defId, positions, n, fat)
  return topGroup(world, defId, positions, n)
}

/**
 * The on-field group, with a tiring starter spelled by the next man up the depth
 * chart once that backup is close enough in overall. When nobody is tired this is
 * exactly `depthGroup`, so the pre-R15 baseline sim is unchanged.
 */
function fieldGroup(world: World, teamId: string, positions: Position[], n: number, fat?: Record<string, number>): Player[] {
  const pool = depthGroup(world, teamId, positions, n + 1)
  const base = pool.slice(0, n)
  if (!fat || pool.length <= n) return base
  const sub = pool[n]
  let worst = -1
  let worstFat = 0
  for (let i = 0; i < base.length; i++) {
    const f = fat[base[i].id] ?? 0
    if (f > worstFat) { worstFat = f; worst = i }
  }
  if (worst < 0) return base
  if (worstFat - (fat[sub.id] ?? 0) < R15.rotateGap) return base
  if (base[worst].ovr - sub.ovr > R15.rotateMaxDrop) return base
  const out = [...base]
  out[worst] = sub
  return out
}

/**
 * R15: the offensive players on the field for a scrimmage snap, chosen from the
 * concept's personnel grouping (QB override + injuries respected). The back who
 * actually gets the rep (`reppedId`) replaces the nominal starter in a one-back
 * set, so a backup back is charged for his own snaps instead of the starter.
 * `counts` (L13) lets the user's own package shape the grouping; unset means the
 * concept's personnel, so AI-vs-AI and legacy saves are unchanged.
 */
function offenseOnField(world: World, offId: string, concept: Concept, qbOverride?: Record<string, string>, reppedId?: string, fat?: Record<string, number>, counts?: PersonnelCounts): Player[] {
  const c = counts ?? personnelCounts(concept.personnel)
  const list: Array<Player | undefined> = [topGroup(world, offId, ['QB'], 1, qbOverride)[0], ...topGroup(world, offId, ['OT', 'OG', 'C'], 5)]
  if (c.rb >= 2) {
    list.push(...fieldGroup(world, offId, ['RB'], c.rb, fat))
  } else if (c.rb === 1) {
    const pool = topGroup(world, offId, ['RB'], 2)
    // R15: always field the back who actually took the rep, even if he is deeper
    // on the chart than the top two (a one-back set is his rep, not the starter's).
    const repped = reppedId ? (world.roster[offId] ?? []).find((p) => p.id === reppedId && !p.injured) : undefined
    const man = repped ?? (fat ? fieldGroup(world, offId, ['RB'], 1, fat)[0] : pool[0])
    if (man) list.push(man)
  }
  if (c.fb) list.push(topGroup(world, offId, ['FB'], 1)[0])
  if (c.te) list.push(...fieldGroup(world, offId, ['TE'], c.te, fat))
  if (c.wr) list.push(...fieldGroup(world, offId, ['WR'], c.wr, fat))
  return list.filter((p): p is Player => !!p)
}

/**
 * R15: the defensive players on the field, from the package that matches the
 * offence. `pkgOverride` (L13) lets the user's chosen package (base/nickel/dime)
 * answer instead; unset means the scheme-derived answer, unchanged for AI clubs.
 */
function defenseOnField(world: World, defId: string, personnel: Personnel | undefined, fat?: Record<string, number>, pkgOverride?: Package): Player[] {
  const pkg = pkgOverride ?? defensePackage(personnel)
  return [
    ...packageGroup(world, defId, ['DE', 'DT'], pkg, fat),
    ...topGroup(world, defId, ['LB'], pkg.lb),
    ...topGroup(world, defId, ['CB'], pkg.cb),
    ...topGroup(world, defId, ['S'], pkg.s),
  ]
}

/**
 * R15: top a short on-field unit up to 11 with the best remaining healthy players.
 * A club always fields 11 when its roster allows — a missing fullback, a thinned
 * linebacker corps or an injured corner is backfilled by the next man up (NFL
 * teams use a second back for a fullback, an extra DB for a short LB group, etc.).
 * This only shapes the snap/fatigue participant list; the resolver's rated groups
 * are untouched, so no rng() draw is added or removed.
 */
const OFF_FILL: Position[] = ['RB', 'TE', 'WR', 'FB', 'OT', 'OG', 'C']
const DEF_FILL: Position[] = ['CB', 'S', 'LB', 'DE', 'DT']
function fillToEleven(world: World, teamId: string, list: Player[], preference: Position[]): Player[] {
  if (list.length >= 11) return list.slice(0, 11)
  const out = [...list]
  const have = new Set(out.map((p) => p.id))
  for (const pos of preference) {
    for (const p of depthAt(world, teamId, pos)) {
      if (out.length >= 11) return out
      if (p.injured || have.has(p.id)) continue
      have.add(p.id)
      out.push(p)
    }
  }
  return out
}

/** Charge one snap of fatigue to a player, at most once per play. */
function chargeSnap(s: GameState, id: string | undefined, p: Player | undefined, mult: number, seen: Set<string>) {
  if (!p || !id || seen.has(id)) return
  seen.add(id)
  const sta = mkAttrs(p).STA ?? 75
  const rate = clamp(1 + (75 - sta) / 100, 0.6, 1.8)
  s.snaps[id] = (s.snaps[id] ?? 0) + 1
  s.fat[id] = clamp((s.fat[id] ?? 0) + R15.snap * rate * mult, 0, 1.2)
}

/**
 * R15: charge one scrimmage snap to exactly the players the play resolution put
 * on the field. The resolver returns the participants it actually used (personnel
 * group + resolved carrier/receiver/coverage defenders), so a backup back or a
 * rotational lineman is charged for his own rep, never the man he replaced.
 */
function chargeSnaps(s: GameState, out: PlayOutcome) {
  const offSide = (s.snapSide[s.offId] ??= { off: 0, def: 0 })
  const defSide = (s.snapSide[s.defId] ??= { off: 0, def: 0 })
  offSide.off += 1
  defSide.def += 1
  const defMult = (s.twoMinMode === 'hurry' ? R15.hurry : 1) * (s.driveSnaps >= 8 ? R15.longDrive : 1)
  s.driveSnaps += 1
  const seen = new Set<string>()
  for (const id of out.onFieldOff ?? []) chargeSnap(s, id, s.pIndex.get(id), 1, seen)
  for (const id of out.onFieldDef ?? []) chargeSnap(s, id, s.pIndex.get(id), defMult, seen)
}

/** Shed a fraction of every tracked player's in-game fatigue (between drives / halftime). */
function restFatigue(s: GameState, frac: number) {
  for (const id in s.fat) s.fat[id] *= 1 - frac
}

/**
 * Sample a yard gain from the real NFL distribution, tilted by how much better
 * or worse the matchup is than league average. `edge` is roughly −25..+25.
 */
function sampleYards(rng: Rng, isPass: boolean, edge: number, stack: string[], yard: number, tier: 'NFL' | 'FBS' = 'NFL'): number {
  const cal = getCalibration(tier)
  const cdf = isPass ? cal.passCdf : cal.runCdf
  let r = rng()
  // Talent tilt: a bounded, mass-preserving tilt of the real distribution. A
  // positive edge (better offence / faster back) shifts mass toward the explosive
  // buckets, a negative edge (better defence) toward losses and stuffs. The power
  // form keeps r inside (0,1), so — unlike an additive `r - shift` — it cannot
  // pile a clamped point mass into the biggest bucket and overrun the real NFL tail.
  const tilt = clamp(edge * R2.talentTilt, -0.08, 0.08)
  r = clamp(r ** (1 / (1 + tilt)), 0.0005, 0.9995)
  let bucket = sampleBucket(cdf, r)
  // Red-zone / goal-line makes chunk buckets far less likely (R2: leans to a
  // still-scoring 10–14 / 15–24 more often than a 5–9 that usually leaves a 3rd down).
  if (yard >= 80 && (bucket === '25-49' || bucket === '50+' || bucket === '15-24')) {
    const u = rng()
    bucket = u < 0.3 ? '15-24' : u < 0.85 ? '10-14' : '5-9'
  }
  stack.push(bucket)
  let gain = bucketYards(bucket, rng, isPass)
  // College: damp the long tail so totals match the FBS box score.
  if (tier === 'FBS' && (bucket === '25-49' || bucket === '50+')) {
    gain = Math.round(gain * CFB_CHUNK_DAMP[bucket])
  }
  // Tiny talent nudge, secondary to the real curve.
  gain += Math.round(edge * 0.05)
  return gain
}

// ── Coaching schemes ─────────────────────────────────────────────────────────
export interface Concept {
  name: string
  type: 'run' | 'pass'
  depth: number // intended air yards (pass) or target gap (run)
  yac: number // yards-after-catch appetite 0-1
  /** L11.5 Q1: one-line plain-English description for the moment card. */
  description: string
  /** R15: offensive personnel grouping (11/12/21/21/22/GL); defaults to 11. */
  personnel?: Personnel
}

interface OffenseStyle {
  passRate: number
  concepts: Concept[]
}

// R18: the pass-rate identity lives in decisions.ts (coachTendency shows it on
// the scouting card) so the sim and the report can never drift apart.
const OFF_STYLES: Record<string, OffenseStyle> = {
  'Air Raid': {
    passRate: OFF_PASS_RATE['Air Raid'],
    concepts: SCHEME_MENUS['Air Raid'],
  },
  'Pro Style': {
    passRate: OFF_PASS_RATE['Pro Style'],
    concepts: SCHEME_MENUS['Pro Style'],
  },
  Spread: {
    passRate: OFF_PASS_RATE.Spread,
    concepts: SCHEME_MENUS.Spread,
  },
  'West Coast': {
    passRate: OFF_PASS_RATE['West Coast'],
    concepts: SCHEME_MENUS['West Coast'],
  },
  'RPO Heavy': {
    passRate: OFF_PASS_RATE['RPO Heavy'],
    concepts: SCHEME_MENUS['RPO Heavy'],
  },
}

interface DefenseStyle {
  blitz: number
  manCoverage: number // 0 = zone, 1 = man
  runFit: number // multiplier on run defense
  coverage: number // multiplier on coverage
}

const DEF_STYLES: Record<string, DefenseStyle> = {
  '4-3 Base': { blitz: 0.22, manCoverage: 0.45, runFit: 1.0, coverage: 1.0 },
  '3-4 Base': { blitz: 0.3, manCoverage: 0.35, runFit: 1.06, coverage: 1.0 },
  '4-2-5 Nickel': { blitz: 0.24, manCoverage: 0.55, runFit: 0.9, coverage: 1.08 },
  Multiple: { blitz: 0.29, manCoverage: 0.5, runFit: 1.0, coverage: 1.03 },
  'Blitz Heavy': { blitz: 0.5, manCoverage: 0.7, runFit: 0.94, coverage: 0.98 },
}

export function offStyle(world: World, teamId: string): OffenseStyle {
  const oc = (world.staff[teamId] ?? []).find((s) => s.role === 'Offensive Coordinator')
  const scheme = oc?.scheme ?? ''
  const base = OFF_STYLES[scheme] ?? OFF_STYLES['Pro Style']
  // J5: the ONE place the scheme menu is chosen. Toggle on → the realistic menu;
  // off → the original SCHEME_MENUS, byte-identical to the pre-J5 engine. The
  // pass:run split is untouched either way: pickConcept still rolls the pass rate
  // first and only then picks a concept of that type from this list.
  const concepts = MENU_REALISM_ON
    ? (SCHEME_MENUS_REALISM[scheme] ?? SCHEME_MENUS_REALISM['Pro Style'])
    : base.concepts
  // R18.2: the widening pivots on the league's own mean identity, so the scheme's
  // pass-rate identity is spread out club-to-club without moving the league average.
  const passRate = offPassRate(world, teamId, oc?.scheme)
  return passRate === base.passRate && concepts === base.concepts ? base : { ...base, passRate, concepts }
}
function defStyle(world: World, teamId: string): DefenseStyle {
  const dc = (world.staff[teamId] ?? []).find((s) => s.role === 'Defensive Coordinator')
  const key = dc?.scheme ?? ''
  const base = DEF_STYLES[key] ?? DEF_STYLES.Multiple
  // J6: while the clock-realism toggle is on, the man/blitz mix is shifted to the
  // NFL shares (see CLOCK_REALISM.defStyles). OFF returns the untouched base so
  // the engine is byte-identical to main.
  if (!CLOCK_ON) return base
  return CLOCK_REALISM.defStyles[key] ?? CLOCK_REALISM.defStyles.Multiple ?? base
}
/** J6: a club's man-coverage weight (probe/reporting helper). */
export function manCoverageOf(world: World, defId: string): number {
  return defStyle(world, defId).manCoverage
}
export function coachLabels(world: World, teamId: string) {
  const staff = world.staff[teamId] ?? []
  const oc = staff.find((s) => s.role === 'Offensive Coordinator')
  const dc = staff.find((s) => s.role === 'Defensive Coordinator')
  return {
    oc: oc?.name ?? 'Offense',
    ocScheme: oc?.scheme ?? 'Pro Style',
    dc: dc?.name ?? 'Defense',
    dcScheme: dc?.scheme ?? 'Multiple',
  }
}

// ── Play resolution ──────────────────────────────────────────────────────────
export interface PlayOutcome {
  type: Play['type']
  concept: string
  yards: number
  result: string
  turnover: boolean
  scorerId?: string
  scorerName?: string
  carrierId?: string
  targetId?: string
  passDepth?: number
  /** J3: the concept's nominal depth (the pre-J3 meaning of `passDepth`), emitted
   *  only while the air model is on. The replay-review catch ruling keeps the spot
   *  it had before J3, so the air model moves presentation, not the sim. */
  passConceptDepth?: number
  pressure?: boolean
  /** The defense sent extra rushers on this pass (animation only). */
  blitz?: boolean
  /** J12 #34: the defence showed a disguised shell on this snap (animation). */
  disguised?: boolean
  /** J12 #34: the QB was fooled by the disguise on this snap (animation). */
  qbFooled?: boolean
  bigPlay?: boolean
  /** J36: the opponent player the play was steered at (a targeted report finding). */
  scoutTarget?: string
  /** J5: this snap used pre-snap motion (set when the play is pushed). */
  motion?: boolean
  timeUsed: number
  // attribution for individual stats
  qbId?: string
  tackleIds?: string[]
  sackId?: string
  intId?: string
  /** L11.5 Q7: coverage defender on the target. */
  coverId?: string
  /** J8c: the covering defender who broke the pass up (bookkeeping/animation). */
  pbuId?: string
  // ── J7: matchups & busts ────────────────────────────────────────────────────
  /** J7: the covering defender (mirrors `coverId`); only set when matchups are on. */
  coverDefenderId?: string
  /** J7: modelled separation at the catch point (yards, 1 dp). */
  separationYd?: number
  /** J7: the coverage tier for the target. */
  coverTag?: CoverTag
  /** J7: the air depth the matchup model used (probe bucketing only). */
  muAirDepth?: number
  /** L12 E2: the defender who forced a fumble on a catch (bookkeeping only). */
  fumbleId?: string
  /** R5: defenders who missed the tackle on this play (a second tackler finishes). */
  missedTackleIds?: string[]
  /** R5: the carrier/receiver who forced those misses (for FMT stats). */
  forcedMissedIds?: string[]
  /** R5: the targeted receiver marked with a drop (the result stays Incomplete). */
  dropId?: string
  // ── R6 ─────────────────────────────────────────────────────────────────────
  returnerId?: string
  returnYards?: number
  returnTD?: boolean
  returnKind?: 'return' | 'fairCatch' | 'downed' | 'touchback' | 'muff' | 'blocked' | 'blocked'
  defTD?: boolean
  /** R7: the defender credited with the pressure (sack, QB hit or hurry). */
  pressureId?: string
  /** R7: how the pressure is classified. A sack is always a pressure. */
  pressureType?: 'sack' | 'hit' | 'hurry'
  // ── J8b: pass rush & protection ────────────────────────────────────────────
  /** J8b: the blocker who lost the rep that produced the pressure (a per-player
   *  "pressures / sacks allowed" record; undefined when the layer is off). */
  beatenBlockerId?: string
  /** J8b: modelled time from the snap until the pressure arrives (animation). */
  timeToPressureS?: number
  /** T2M: a sideline carry/reception went out of bounds (stops the clock). */
  outOfBounds?: boolean
  /** J6: a victory-formation kneeldown (a rush attempt for negative yards). */
  kneel?: boolean
  /** J6: the QB spiked the ball to stop the clock (a pass attempt, incomplete). */
  spike?: boolean
  /** J6: the QB escaped the pocket and ran (a rush attempt, not a pass attempt). */
  scramble?: boolean
  // ── R16: turnover variety ──────────────────────────────────────────────────
  fumbleCause?: 'run' | 'carry' | 'strip' | 'muff' | 'kickoff'
  fumbleRecoveredBy?: 'off' | 'def'
  stripSack?: boolean
  tippedInt?: boolean
  tipId?: string
  muffedCatch?: boolean
  goalLineFumble?: boolean
  // ── R17: kicking realism ───────────────────────────────────────────────────
  /** R17: a blocked field goal, extra point or punt. */
  blockedKick?: boolean
  // ── R15/R16: reception metadata and on-field participants ──────────────────
  /** R16: the receiver caught the ball (a true reception, including a catch that
   *  later came loose). Absent on an interception, sack or incompletion, so a
   *  deflected/muffed interception is never confused with a completion. */
  reception?: boolean
  /** R15: the scrimmage players actually on the field for this snap (offence ids). */
  onFieldOff?: string[]
  /** R15: the scrimmage defenders actually on the field for this snap (ids). */
  onFieldDef?: string[]
  /** J8a2: the front defender whose read decided the run (animation). */
  readKeyId?: string
  /** J8a2: the run defenders who bit on the misdirection / play-action key. */
  biteIds?: string[]
  /** J8a2: the alley / gap filler on the run (animation). */
  fillId?: string
  /** J3b: the point-of-attack defender deciding a goal-line run (animation). */
  glPoaId?: string
  /** J3b: the point-of-attack defender who stuffs a goal-line run (animation). */
  glStopId?: string
  /** animflow r6b: fatigue at the snap per on-field man (see Play.fatOn). */
  fatOn?: number[]
}

// ── In-game plan ─────────────────────────────────────────────────────────────
// Set by the store during a live game so player calls bend the sim. Empty plan
// (the default) means AI-vs-AI behaviour for both sides.
export interface LivePlan {
  /** The user's club — the only team whose plans the sim reads. */
  teamId: string
  off: import('./gameplan').GamePlan
  def: import('./gameplan').GamePlan
}
let LIVE_PLAN: LivePlan | null = null
export function setLivePlan(p: LivePlan | null) {
  LIVE_PLAN = p
}
function planFor(teamId: string, side: 'off' | 'def'): import('./gameplan').GamePlan | null {
  if (!LIVE_PLAN || teamId !== LIVE_PLAN.teamId) return null
  return side === 'off' ? LIVE_PLAN.off : LIVE_PLAN.def
}

// ── L13: personnel packages ───────────────────────────────────────────────────
function coordinatorScheme(world: World, teamId: string, role: 'Offensive Coordinator' | 'Defensive Coordinator'): string | undefined {
  return (world.staff[teamId] ?? []).find((s) => s.role === role)?.scheme
}

/**
 * L13: the matchup edge for a personnel package. Only computed while the user's
 * club is one of the two teams, and only for the side the user actually set — so
 * AI-vs-AI snaps (no ctx) and legacy saves (no packages) behave exactly as before.
 */
function personnelEdgeFor(world: World, env: SimEnv | undefined, offId: string, defId: string): import('./personnel').PersonnelEdge | null {
  const per = env?.personnel
  const uid = env?.userTeamId
  if (!per || !uid) return null
  if (uid === offId) {
    if (!per.off) return null
    return personnelEdge(per.off, aiDefPackage(coordinatorScheme(world, defId, 'Defensive Coordinator')))
  }
  if (uid === defId) {
    if (!per.def) return null
    return personnelEdge(aiOffPersonnel(coordinatorScheme(world, offId, 'Offensive Coordinator')), per.def)
  }
  return null
}

/** Fold the DC's live plan into coverage tightness, ball-hawking, and risk. */
function applyDefPlan(defId: string, dStyle: DefenseStyle) {
  const plan = planFor(defId, 'def')
  if (!plan) return { compMult: 1, coverMult: 1, intMult: 1, bigPlayRisk: 1 }
  const eff = planEffects(plan, true)
  // Zone (coverage 0) gives up more catches underneath but fewer explosives;
  // press man (2) tightens coverage but risks getting beaten deep.
  const cov = eff.coverageAdj
  const compMult = 1 - (cov - 0.5) * 0.14 // man = lower completion, zone = higher
  const coverMult = 1 + (cov - 0.5) * 0.06
  const intMult = 1 + (cov - 0.5) * 0.5 + (plan.aggression - 0.5) * 0.3
  return { compMult, coverMult, intMult, bigPlayRisk: eff.bigPlayRisk * dStyle.coverage }
}

function pickConcept(rng: Rng, style: OffenseStyle, down: number, distance: number, passAdj = 0, sit?: SituationInput): Concept {
  let pool = style.concepts
  // J1: with the situational model ON the table supplies the down×distance base
  // (and the red-zone lean), so `passAdj` carries only the plan/quick/mode edges.
  // OFF runs the legacy flat-lean expression untouched (same single draw).
  let wantPass: boolean
  if (getSituational() && sit) {
    wantPass = rng() < clamp(situationalPassRate(sit) + passAdj, 0, 1)
  } else {
    wantPass = rng() < style.passRate + passAdj || (down === 3 && distance > 5)
  }
  const filtered = pool.filter((c) => (wantPass ? c.type === 'pass' : c.type === 'run'))
  if (filtered.length) pool = filtered
  return pool[Math.floor(rng() * pool.length)]
}

// ── L10 G8/G9: tendencies, the call matrix, and the AI's counter-calls ────────

function coordRating(world: World, teamId: string, role: 'Offensive Coordinator' | 'Defensive Coordinator'): number {
  const m = (world.staff[teamId] ?? []).find((x) => x.role === role)
  if (getCoachSubs()) {
    // J9: the exact coordinator's own sub-ratings model his counter-calls against
    // the opponent's tendencies — the OC's play calling + reads, the DC's disguise
    // + reads. A vacant seat takes the floor (a poor coach), never league average.
    const primary: 'playCalling' | 'disguise' = role === 'Offensive Coordinator' ? 'playCalling' : 'disguise'
    return (centeredSub(world, role, primary, m) + centeredSub(world, role, 'reads', m)) / 2
  }
  // Backlog 193/185: a VACANT coordinator seat is not an average one. Return a
  // floor rating so an empty chair counters tendencies like a poor coach instead
  // of a league-average (74) one, consistent with the on-field vacancy floor.
  return m?.rating ?? 51
}

function normalizeDist<T extends string>(dist: Record<T, number>, keys: readonly T[]): Record<T, number> {
  let total = 0
  for (const k of keys) total += Math.max(0, dist[k] ?? 0)
  const out = {} as Record<T, number>
  if (total <= 0) {
    for (const k of keys) out[k] = 1 / keys.length
    return out
  }
  for (const k of keys) out[k] = Math.max(0, dist[k] ?? 0) / total
  return out
}

function weightedPick<T extends string>(rng: Rng, dist: Record<T, number>, keys: readonly T[]): T {
  let total = 0
  for (const k of keys) total += Math.max(0, dist[k] ?? 0)
  if (total <= 0) return keys[0]
  let r = rng() * total
  for (const k of keys) {
    r -= Math.max(0, dist[k] ?? 0)
    if (r <= 0) return k
  }
  return keys[keys.length - 1]
}

/** An AI club's derived tendencies in one bucket (G8): offense class + defensive call. */
export function aiTendency(world: World, teamId: string, bucket: Bucket, weather?: GameWeather): { off: Record<OffClass, number>; def: Record<DefCall, number> } {
  const style = offStyle(world, teamId)
  const d = defStyle(world, teamId)
  // pickConcept forces a throw on 3rd & long; otherwise the OC's pass rate rules.
  const pPass = bucket === '3rd-long' ? 1 : clamp(style.passRate, 0, 1)
  let run = 0
  let short = 0
  let deep = 0
  for (const c of style.concepts) {
    if (c.type === 'run') run += 1
    else if (c.depth >= 9) deep += 1
    else short += 1
  }
  const offRaw: Record<OffClass, number> = { run: run * (1 - pPass), short: short * pPass, deep: deep * pPass }
  // FUTURES #6: in bad weather the AI leans on the run and shortens the tree.
  // A bounded tilt: bad weather runs more, good weather slightly less, so the
  // season mean is unchanged (the `aiBad` center is measured by the probe).
  // Gated on the weather toggle so the base is exact.
  if (weather && getWeather()) {
    const windBad = clamp((weather.windMph - 15) / 15, 0, 1)
    const snowBad = weather.precip === 'snow' ? 0.6 : 0
    const bad = Math.max(windBad, snowBad) - WX_CENTER.aiBad
    if (bad !== 0) {
      const shift = WX.aiRunShift * bad
      offRaw.run *= 1 + shift
      offRaw.deep *= 1 - shift
      offRaw.short *= 1 - shift * 0.5
    }
  }
  let blitz = d.blitz
  let stack = Math.max(0, d.runFit - 1) * 4
  if (bucket === '3rd-long') blitz *= 1.35
  if (bucket === 'redzone') stack += 0.15
  // R10: a two-high shell (Cover 2/4) is a zone-leaning DC's answer on passing
  // downs — more safeties deep, softer vs the run. Scale by zone lean.
  const zoneLean = clamp(1 - d.manCoverage, 0, 1)
  let twoHigh = zoneLean * 0.3
  if (bucket === '2nd-long' || bucket === '3rd-long') twoHigh *= 1.7
  else if (bucket === '3rd-mid') twoHigh *= 1.3
  const defRaw: Record<DefCall, number> = { blitz, man: d.manCoverage, zone: 1 - d.manCoverage, stack, twoHigh }
  return { off: normalizeDist(offRaw, OFF_CLASSES), def: normalizeDist(defRaw, DEF_CALLS) }
}

/** The user's tendency book, but only when it belongs to this season and club. */
function userBookFor(world: World, s: GameState) {
  const t = s.ctx?.userTeamId
  if (!t) return null
  const ub = world.userBook
  if (!ub || ub.season !== world.season || ub.teamId !== t) return null
  return ub.book
}

/** G8: how hard a coordinator leans on your tendencies (higher-rated DCs exploit more). */
function exploitWeight(rating: number): number {
  return clamp(0.15 + (rating - 60) / 200, 0.1, 0.35)
}

function exploitDefCall(world: World, s: GameState, dist: Record<DefCall, number>, bucket: Bucket, rating: number) {
  const book = userBookFor(world, s)
  if (!book) return
  const top = topKey(book.off[bucket], OFF_CLASSES)
  if (top.total < 8) return
  let sum = 0
  for (const k of DEF_CALLS) sum += Math.max(0, dist[k] ?? 0)
  dist[bestCounterCall(top.key)] += exploitWeight(rating) * sum
}

function exploitOffClass(world: World, s: GameState, dist: Record<OffClass, number>, bucket: Bucket, rating: number) {
  const book = userBookFor(world, s)
  if (!book) return
  const top = topKey(book.def[bucket], DEF_CALLS)
  if (top.total < 8) return
  let sum = 0
  for (const k of OFF_CLASSES) sum += Math.max(0, dist[k] ?? 0)
  dist[bestCounterClass(top.key)] += exploitWeight(rating) * sum
}

/** The AI defense's call, drawn after the user's answer (G9). */
function drawAIDefCall(world: World, s: GameState, defId: string, bucket: Bucket): DefCall {
  const dist = { ...aiTendency(world, defId, bucket).def }
  exploitDefCall(world, s, dist, bucket, coordRating(world, defId, 'Defensive Coordinator'))
  return weightedPick(s.rng, dist, DEF_CALLS)
}

/** The AI offense's class, drawn after the user's defCall (G9). */
function drawAIOffClass(world: World, s: GameState, offId: string, bucket: Bucket): OffClass {
  const dist = { ...aiTendency(world, offId, bucket, s.weather).off }
  exploitOffClass(world, s, dist, bucket, coordRating(world, offId, 'Offensive Coordinator'))
  return weightedPick(s.rng, dist, OFF_CLASSES)
}

function pickConceptOfClass(rng: Rng, style: OffenseStyle, cls: OffClass): Concept {
  const list = style.concepts.filter((c) => offClassFor(c.type, c.depth) === cls)
  const pool = list.length ? list : style.concepts
  return pool[Math.floor(rng() * pool.length)]
}

/** G9: the user's call cards — the run, short pass and deep pass in the book. */
function callCards(): Concept[] {
  return PLAYBOOK.map((p) => ({ name: p.name, type: p.type, depth: p.depth, yac: p.yac, description: p.description, personnel: p.personnel }))
}

function downDistance(down: number, distance: number, yard: number): string {
  const suf = down === 1 ? 'st' : down === 2 ? 'nd' : down === 3 ? 'rd' : 'th'
  const yd = yard >= 50 ? `their ${100 - yard}` : `your ${yard}`
  return `${down}${suf} & ${distance} at ${yd}`
}

/** G8: the scouted read shown on a card (fuzzy ±15%, sharp ±5%). */
/** Read-line verbs for a defense's habit (the DEF_CALL_LABELs stay as button text). */
const DEF_VERB: Record<DefCall, string> = { blitz: 'blitz', man: 'play man coverage', zone: 'play zone coverage', stack: 'stack the box', twoHigh: 'play two-high coverage' }

/** L11.5 Q1: one-line description of each defensive call for the moment card. */
const DEF_CALL_DESC: Record<DefCall, string> = {
  blitz: 'Send extra rushers — pressure, but risk the big play',
  man: 'Man coverage — tight on the receivers, back to the ball',
  zone: 'Zone coverage — keep everything in front',
  stack: 'Stack the box — sell out to stop the run',
  twoHigh: 'Two deep safeties — take away the deep ball, softer against the run',
}

function tendencyRead(world: World, s: GameState, oppId: string, side: 'off' | 'def', bucket: Bucket): string {
  const read = s.ctx?.oppRead
  if (!read || read.week !== world.week || read.oppId !== oppId) return 'No scouting read — buy Opponent film to see their tendencies'
  const span = read.sharp ? 0.05 : 0.15
  const rng = makeRng(world.seed + world.week * 31 + hash32(oppId + bucket, 9))
  if (side === 'def') {
    const top = topKey(aiTendency(world, oppId, bucket).def, DEF_CALLS)
    const pct = clamp(top.share + (rng() * 2 - 1) * span, 0, 1)
    return `They ${DEF_VERB[top.key]} ${Math.round(pct * 100)}% of the time on ${BUCKET_LABEL[bucket]}`
  }
  const top = topKey(aiTendency(world, oppId, bucket).off, OFF_CLASSES)
  const pct = clamp(top.share + (rng() * 2 - 1) * span, 0, 1)
  return `They ${OFF_CLASS_LABEL[top.key]} ${Math.round(pct * 100)}% of the time on ${BUCKET_LABEL[bucket]}`
}

/** L10 F2: how much a pass-leaning user plan is read by the defense, per point of passBias. */
const PASS_LEAN_PRESSURE = 4
const PASS_LEAN_COMP = 0.024
const PASS_LEAN_EDGE = 0.6

/** Per-step sim context for the L10 G6/G7 halftime and two-minute effects. */
interface SimEnv {
  adjust: Record<string, string[]>
  qbOverride: Record<string, string>
  down: number
  intMult: number
  /** L10 G11/G12: current quarter, the user's club, and their matchup/usage settings. */
  qtr: number
  /** L12 S3: seconds left in the quarter (deterministic, for out-of-bounds credit). */
  clock?: number
  userTeamId?: string
  matchups?: MatchupSet
  usage?: UsageSet
  /** L13: the user's personnel packages for this game. */
  personnel?: PersonnelSet
  /** L12.9 K1: the offense's unit cohesion and the league mean (0-1). */
  cohesionOff?: number
  cohesionMeanOff?: number
  /** T2M: the offense's score margin (negative = trailing) for the two-minute drill. */
  margin?: number
  /** T2M: the current possession is in hurry-up mode. */
  hurry?: boolean
  /** R15: live per-player in-game fatigue (for the offence/defence difference). */
  fat?: Record<string, number>
  /** R17: wind in mph for the kick hook (positive = into the kicker's face). 0 = calm. */
  wind?: number
  /** FUTURES #6: bounded, centered weather effects for this offence & quarter.
   *  Undefined (or all-neutral) when no weather was supplied or weather is off. */
  wx?: WxEffects
}

/**
 * T2M: is this a two-minute sideline situation? Inside the last 2:00 of a half,
 * with the offense trailing or tied — in hurry-up, or in any 4th-quarter catch-up.
 * Drives the out-of-bounds rate and the clock stop; no rng() draw is involved.
 */
function oobSituation(env: SimEnv | undefined): boolean {
  if (!env) return false
  if (env.qtr !== 2 && env.qtr !== 4) return false
  if ((env.clock ?? 9999) > 120) return false
  const m = env.margin ?? 0
  if (m > 0) return false
  return env.qtr === 4 || env.hurry === true || m < 0
}

// T2M: the concepts that get the ball on the edge — an outside run can reach the
// sideline; an inside hand-off cannot.
const OUTSIDE_RUNS = new Set(['Toss', 'Outside Zone', 'Pin-Pull', 'Jet Sweep', 'RPO Run', 'Read Option'])
// J6 try-5: even a between-the-tackles hand-off can be strung out and pushed out
// near the boundary, so with clock-realism ON every run carries a small sideline
// chance — part of widening the ELIGIBLE play set (never the rate multiplier).
const INSIDE_RUN_OOB = 0.05
// J6 try-5: the sideline-route family. The base list is the T2M set (OFF path,
// byte-identical to before2); the widened list adds the rest of the short/
// intermediate sideline family and is used only while clock-realism is ON.
const OOB_ROUTE_BASE = /out|flat|screen|bubble|swing|check|wheel|angle|texas|snag|whip|corner/i
const OOB_ROUTE_WIDE = /out|flat|screen|bubble|swing|check|wheel|angle|texas|snag|whip|corner|comeback|hitch|curl|smash|sail|level|bench|flood|hank|spacing|mesh/i

// J8a2: the run concepts a defence must read (misdirection / a pulling guard, a
// delayed hand-off or a QB read) — a defender who bites on the first key is a gap
// late. The pass play-action key is handled in `resolvePass`.
const MISDIRECTION_RUNS = new Set(['Counter', 'Gun Counter', 'Trap', 'Toss', 'Pin-Pull', 'Draw', 'Jet Sweep', 'RPO Run', 'Read Option', 'Zone Read'])

/**
 * T2M: the chance a sideline carry goes out of bounds. Outside runs and short
 * completions (outs, flats, screens, checkdowns) only; more for WR/RB on those
 * routes. Purely a probability fed to a per-play hash — never an rng() draw.
 *
 * J6 try-5 widens the ELIGIBLE set toward the NFL 10.8% share while the toggle is
 * ON: every inside run can reach the boundary, the sideline-route list covers the
 * full short/intermediate sideline family (comebacks, hitches, curls, sails,
 * benches, …), and the per-position weights are raised. The `oobWiden` multiplier
 * is UNCHANGED. With the toggle OFF every branch returns the exact pre-J6 value,
 * so the OFF path (incl. the two-minute window) stays byte-identical.
 */
function oobChance(concept: Concept, pos: string | undefined): number {
  if (concept.type === 'run') {
    if (OUTSIDE_RUNS.has(concept.name)) return 0.4
    return CLOCK_ON ? INSIDE_RUN_OOB : 0
  }
  const short = concept.depth <= 8 || concept.yac >= 0.8
  if (!short) return 0
  const route = CLOCK_ON
    ? (OOB_ROUTE_WIDE.test(concept.name) ? 0.12 : 0)
    : (OOB_ROUTE_BASE.test(concept.name) ? 0.1 : 0)
  const byPos = CLOCK_ON
    ? (pos === 'WR' ? 0.19 : pos === 'RB' || pos === 'FB' ? 0.15 : pos === 'TE' ? 0.08 : 0)
    : (pos === 'WR' ? 0.16 : pos === 'RB' || pos === 'FB' ? 0.12 : pos === 'TE' ? 0.05 : 0)
  return clamp(0.2 + route + byPos, 0, CLOCK_ON ? 0.62 : 0.6)
}

/**
 * J6: the effective sideline rate for a play. Inside the two-minute drill the
 * T2M rate is preserved; elsewhere (clock-realism on) sideline concepts still
 * reach the boundary at a lower base rate so the marker and animation match real
 * football — the clock cap in applyScrimmageOutcome stays gated to the real
 * clock-stop window, so the extra flags never leak game time. Never rng().
 */
function oobRate(env: SimEnv | undefined, concept: Concept, pos: string | undefined): number {
  const base = oobChance(concept, pos)
  if (base <= 0) return 0
  if (oobSituation(env)) return base
  return CLOCK_ON ? base * CLOCK_REALISM.oobWiden : 0
}

function hasFix(env: SimEnv | undefined, teamId: string, fix: string): boolean {
  return !!env?.adjust[teamId]?.includes(fix)
}

/**
 * L11.5 Q7: the coverage defender on the target. Purely deterministic — it reads
 * the target's slot in the receiver group and the throw depth, so it never draws
 * rng and cannot move the sim's calibration or the paused/full equivalence.
 */
function coverDefender(target: Player | undefined, concept: Concept, wrs: Player[], cbs: Player[], saf: Player[], lbs: Player[]): string | undefined {
  if (!target) return undefined
  const pick = (list: Player[], slot: number) => (list.length ? list[slot % list.length] : undefined)
  const slot = Math.max(0, wrs.findIndex((w) => w.id === target.id))
  if (target.pos === 'TE' || target.pos === 'RB') return pick(lbs, slot)?.id
  if (concept.depth >= 15) return pick(saf, slot)?.id
  return pick(cbs, slot)?.id ?? pick(saf, slot)?.id
}

/** A sack (not a completion for a loss, which also has negative yards). */
export function isSack(p: { type: string; result: string }): boolean {
  return p.type === 'pass' && p.result.startsWith('Sack')
}

/** L12 S1: softmax temperature for target share, and the RB checkdown role prior. */
/** L12 S1 tuning: softmax temperature, RB checkdown prior, and how much tighter a 2nd/3rd read is. */
export const TARGET_TUNE = { tau: 160, rbPrior: -34, readPenalty: 0, rbYds: 0.55, teYds: 0.85 }

/**
 * L12 S3: the single tackler on a run, weighted LB/DL/S/CB with the mix shifting
 * toward the secondary on big gains and the front on losses. Deterministic hash
 * of the play number — never an rng draw.
 */
function runTackler(n: number, defId: string, gain: number, lbs: Player[], dl: Player[], saf: Player[], cbs: Player[], decider?: Player): string | undefined {
  const w = { lb: 45, dl: 25, s: 20, cb: 10 }
  if (gain >= 10) { w.lb -= 10; w.s += 6; w.cb += 4 }
  else if (gain <= 0) { w.dl += 12; w.lb -= 12 }
  const groups: [Player[], number][] = [[lbs, w.lb], [dl, w.dl], [saf, w.s], [cbs, w.cb]]
  const valid = groups.filter(([list, wt]) => list.length > 0 && wt > 0)
  if (!valid.length) return undefined
  const total = valid.reduce((a, [, wt]) => a + wt, 0)
  let roll = (hash32(`${n}:${defId}:run`) / 4294967296) * total
  let group = valid[valid.length - 1][0]
  for (const [list, wt] of valid) {
    if (roll < wt) { group = list; break }
    roll -= wt
  }
  // J8a OFF: the exact pre-J8a uniform in-group pick (byte-identical).
  if (!J8A_ON) return group[hash32(`${n}:${defId}:runtackle`) % group.length]?.id
  // J8a ON: weight the in-group pick by tackling proximity (TAK/PUR/SPD) and let
  // the man who decided the play (gap defender / catching pursuer) lead. J8a2
  // folds in the read-loop ratings (PRC read, BSH shed) so the man who read it
  // right is likelier credited. All pickers use the position-correct rating.
  return hashPick(group, (p) => {
    const base = J8A2_ON
      ? Math.max(1, eff(p, 'TAK') * 0.4 + eff(p, 'PUR') * 0.25 + eff(p, 'SPD') * 0.15 + eff(p, 'PRC') * 0.1 + eff(p, 'BSH') * 0.1)
      : Math.max(1, (mkAttrs(p).TAK ?? 70) * 0.5 + (mkAttrs(p).PUR ?? 70) * 0.3 + (mkAttrs(p).SPD ?? 70) * 0.2)
    return p.id === decider?.id ? base * J8A.deciderBoost : base
  }, hash32(`${n}:${defId}:runtackle`))?.id
}

/**
 * L12 S3: the single tackler on a completion — the coverage defender 55%, a
 * safety 25%, a linebacker 20%. Deterministic hash of the play number.
 */
function passTackler(n: number, defId: string, coverId: string | undefined, coverPlayer: Player | undefined, saf: Player[], lbs: Player[]): string | undefined {
  // J8c: the tackler after the catch is the defender who can actually get there —
  // the covering defender (nearest) or a support safety/linebacker — weighted by
  // his own PUR/SPD/TAK, not a fixed 55/25/20 split with a uniform in-group pick.
  if (COVERAGE_INDIV_ON) {
    const pool: Player[] = []
    for (const p of [coverPlayer, ...saf, ...lbs]) if (p && !pool.some((x) => x.id === p.id)) pool.push(p)
    if (pool.length) return hashPick(pool, (p) => proximityWeight(p, coverId), hash32(`${n}:${defId}:passtackle`))?.id
  }
  const roll = hash32(`${n}:${defId}:passtackle`) % 100
  if (roll < 55 && coverId) return coverId
  if (roll < 80 && saf.length) return saf[hash32(`${n}:${defId}:safety`) % saf.length]?.id
  if (lbs.length) return lbs[hash32(`${n}:${defId}:linebacker`) % lbs.length]?.id
  return coverId ?? saf[0]?.id ?? lbs[0]?.id
}

// ── R5: missed tackles ───────────────────────────────────────────────────────
// The first defender on a run or completion "attempts" the tackle. TAK/PUR/HPW/AGI
// against the carrier's BTK/TRK/JKM/SPM/SFA/SPD decide whether he brings him down;
// a miss is a deterministic hash (no rng() draw), adds a couple of yards and a
// second defender finishes the play. League rate ≈ 11–13% of attempts.

// R5 review fix: both sides of the matchup use the SAME absolute 0–100 scale and
// each term is centred on the measured league-average blend, so an average defender
// against an average carrier sits exactly at `missBase` and the offset can no longer
// dominate the difference. The attribute set is unchanged.
/** R5: measured league-average tackling blend across all attempts. */
export const MT_REF_TACKLER = 79
/** R5: measured league-average break-tackle blend across all attempts. */
export const MT_REF_CARRIER = 79

/** A defender's tackling blend (absolute): TAK/PUR primary, HPW/AGI secondary. */
export function tackleRating(p: Player | undefined): number {
  if (!p) return 70
  const a = mkAttrs(p)
  return (a.TAK ?? 70) * 0.5 + (a.PUR ?? 70) * 0.25 + (a.HPW ?? 70) * 0.15 + (a.AGI ?? 70) * 0.1
}

/** A carrier's break-tackle blend (absolute): BTK/TRK/JKM/SPM/SFA plus a little speed. */
export function elusiveRating(carrier: Player | undefined): number {
  if (!carrier) return 70
  const a = mkAttrs(carrier)
  const pos = carrier.pos
  if (pos === 'QB') return (a.SPD ?? 70) * 0.4 + (a.AGI ?? 70) * 0.3 + (a.BCV ?? 70) * 0.2 + (a.RUN ?? 70) * 0.1
  return (a.BTK ?? 70) * 0.25 + (a.TRK ?? 70) * 0.2 + (a.JKM ?? 70) * 0.15 + (a.SPM ?? 70) * 0.15 +
    (a.SFA ?? 70) * 0.1 + (a.SPD ?? 70) * 0.15
}

/** R5: the deterministic rating-only miss rate for a named defender/carrier pair.
 *  Shared with the fast stat allocation so generated seasons agree with play-by-play. */
export function missRate(tackler: Player | undefined, carrier: Player | undefined): number {
  const carTerm = (elusiveRating(carrier) - MT_REF_CARRIER) * R2.missCarDiff
  const defTerm = (MT_REF_TACKLER - tackleRating(tackler)) * R2.missDefDiff
  // J3b: a small league lift plus steeper individual slopes on the SAME specific
  // tackler-vs-carrier pair (both centred on the R5 league blends, so an average
  // pair sits at R2.missBase + J3B.mtBase and only the spread widens).
  const j3b = J3B_ON
    ? J3B.mtBase +
      (MT_REF_TACKLER - tackleRating(tackler)) * J3B.mtDefW +
      (elusiveRating(carrier) - MT_REF_CARRIER) * J3B.mtCarW
    : 0
  return clamp(R2.missBase + carTerm + defTerm + j3b, 0.004, 0.4)
}

/** R5: a defender's miss rate against a league-average carrier (fast allocation). */
export function defenderMissRate(tackler: Player | undefined): number {
  const j3b = J3B_ON ? J3B.mtBase + (MT_REF_TACKLER - tackleRating(tackler)) * J3B.mtDefW : 0
  return clamp(R2.missBase + (MT_REF_TACKLER - tackleRating(tackler)) * R2.missDefDiff + j3b, 0.004, 0.4)
}

/** R5: a carrier's forced-miss rate against a league-average defender (fast allocation). */
export function carrierMissRate(carrier: Player | undefined): number {
  const j3b = J3B_ON ? J3B.mtBase + (elusiveRating(carrier) - MT_REF_CARRIER) * J3B.mtCarW : 0
  return clamp(R2.missBase + (elusiveRating(carrier) - MT_REF_CARRIER) * R2.missCarDiff + j3b, 0.004, 0.4)
}

/** R5: chance the first defender misses. `missRate` plus an open-field term and, on
 *  passes, an open-field bump scaled by how tackle-prone the defender is, so an elite
 *  tackler still stays under 6% while the league lands near 12% of attempts. */
function tackleMissChance(tackler: Player | undefined, carrier: Player | undefined, gain: number, passing: boolean): number {
  const openness = clamp(gain, 0, 30) * (passing ? R2.missGain * 0.85 : R2.missGain)
  const quality = passing ? clamp(defenderMissRate(tackler) / R2.missBase, 0, 2) : 0
  const bump = R2.missPassBump * quality
  return clamp(missRate(tackler, carrier) + openness + bump, 0, 0.4)
}

/** R5: deterministic extra yards on a broken tackle, reusing no rng draw. */
function missExtraYards(key: string): number {
  return 1 + (hash32(key) % Math.max(1, R2.missYardsRange))
}

// ── R5: drops ────────────────────────────────────────────────────────────────
// A target's hands decide how often a catchable ball is dropped. This is a
// bookkeeping label on an incompletion only — the result stays Incomplete and no
// completion/yard term moves, so team calibration is untouched. Decided by a
// deterministic hash on the existing incompletion branch (no new rng draw).
export const DROP_BASE = 0.125
export const DROP_SLOPE = 0.004
/** Conditional drop chance on an incompletion: ≈12% at league-average hands,
 *  lower for better CTH. League-wide this lands at ≈3–5% of targets. */
export function dropChance(pos: string | undefined, a: Record<string, number>): number {
  const rel = pos ? rmean(pos, 'CTH', a.CTH ?? 70) : 0
  return clamp(DROP_BASE - rel * DROP_SLOPE, 0.03, 0.24)
}

/** R16: who recovers a loose ball — a deterministic hash, ~50/50 league-wide with
 *  a situational tilt (strip sack / goal-line pile). Never an rng() draw. */
function fumbleRecovery(key: string, offShare: number): 'off' | 'def' {
  return h01(key) < offShare ? 'off' : 'def'
}

/** R16: chance a receiver muffs a completed catch into a loose ball. */
export function muffChance(pos: string | undefined, a: Record<string, number>): number {
  const rel = pos ? rmean(pos, 'CTH', a.CTH ?? 70) : 0
  return clamp(R16.muffBase - rel * R16.muffSlope, R16.muffLo, R16.muffHi)
}

/** R5: the defender who finishes after a miss — anyone but the man who whiffed. */
function finishTackler(key: string, first: string | undefined, lists: Player[][]): string | undefined {
  const pool: Player[] = []
  for (const l of lists) for (const p of l) if (p.id !== first && !pool.some((x) => x.id === p.id)) pool.push(p)
  // No alternative defender: never credit the man who just missed with the stop.
  if (!pool.length) return undefined
  // J8c: the finishing defender is the nearest able body — weighted by his own
  // PUR/SPD/TAK — instead of a uniform pick from the group. J8a (when J8c is off)
  // weights the same pick by TAK/PUR/SPD; both off = the exact pre-J8 uniform pick.
  if (COVERAGE_INDIV_ON) return hashPick(pool, (p) => proximityWeight(p, undefined), hash32(key))?.id
  if (!J8A_ON) return pool[hash32(key) % pool.length]?.id
  return hashPick(pool, (p) => {
    return Math.max(1, eff(p, 'TAK') * 0.5 + eff(p, 'PUR') * 0.3 + eff(p, 'SPD') * 0.2)
  }, hash32(key))?.id
}

/**
 * J6: maybe convert a resolved pass outcome into a QB scramble. Deterministic
 * (hash of the play number) and drawn from the pass-outcome population, so the
 * scramble replaces the same share of completions and incompletions and the
 * completion %, YPA and sack % are preserved. A pressured dropback and a
 * scramble-style QB raise the chance. Never an rng() draw; the pass attempt's
 * clock (timeUsed) is kept so plays/game and TOP do not move.
 */
function maybeScramble(offId: string, n: number, qb: Player | undefined, qbStyle: ReturnType<typeof styleProfile>, pressured: boolean, out: PlayOutcome, scores = false): PlayOutcome {
  if (!CLOCK_ON || !qb || out.turnover || out.defTD || out.intId || scores) return out
  const p = CLOCK_REALISM.scrambleBase * (1 + CLOCK_REALISM.scrambleStyleSpan * qbStyle.scramble) * (pressured ? CLOCK_REALISM.scramblePressure : 1)
  if (p <= 0 || h01(`${n}:${offId}:scr`) >= p) return out
  const a = mkAttrs(qb)
  const bell = (h01(`${n}:${offId}:scry1`) + h01(`${n}:${offId}:scry2`)) / 2 - 0.5
  const gain = clamp(Math.round(CLOCK_REALISM.scrambleGainBase + bell * CLOCK_REALISM.scrambleGainSpread + ((a.SPD ?? 75) - 75) * CLOCK_REALISM.scrambleSpdEdge + qbStyle.scramble * 1.5), -4, 30)
  return {
    type: 'run', concept: 'QB Scramble', yards: gain, result: 'Rush', turnover: false,
    carrierId: qb.id, scramble: true, timeUsed: out.timeUsed,
    onFieldOff: out.onFieldOff, onFieldDef: out.onFieldDef,
  }
}

// ── J7: matchups & busts ─────────────────────────────────────────────────────
// The defender ACTUALLY covering the target (`coverId`, chosen at target time)
// decides the matchup — not the team's average corner. An elite DB blankets his
// man; an LB or safety on a receiver is a mismatch; and a small share of snaps
// break down entirely (a coverage bust or a defensive mis-call) and leave a
// receiver wide open. Every decision here is DETERMINISTIC (hash32 / h01 only,
// never an rng() draw) and every term is centred on its league mean, so
// `setMatchups(false)` is byte-identical to the base and leaving it ON does not
// move the league averages — it only widens the distribution.
let MATCHUPS_ON = true
/** Like `setWeather`: off makes every matchup term exactly zero. */
export function setMatchups(on: boolean) {
  MATCHUPS_ON = on
}
export function getMatchups(): boolean {
  return MATCHUPS_ON
}

/** J7: how tight the coverage was on a pass. */
export type CoverTag = 'blanket' | 'tight' | 'open' | 'wide' | 'bust' | 'miscall'

export const MU = {
  // ── separation at arrival ──────────────────────────────────────────────────
  // The covering defender's own cover rating is read against the level the
  // position that SHOULD cover this target averages (a CB on a receiver, an LB
  // on a back): an elite DB sits above it (tighter), an LB/S on a receiver sits
  // well below (a mismatch). The BDB 2018 OLS says the nearest defender's
  // *position* moves separation far more than raw speed does (LB +0.83 yd,
  // S +0.42 yd vs CB; speed gap ≈ -0.004 yd/mph), so cover ability carries the
  // matchup and SPD/ACC/AGI are a modest extra.
  coverSep: 0.33,
  spdSep: 0.06, // receiver SPD rel − defender SPD rel (modest by design)
  accSep: 0.03, // ACC rel
  agiSep: 0.03, // AGI rel
  safAwr: 0.06, // safety help over the top (AWR rel)
  safZcv: 0.06, // safety help (ZCV rel)
  rzCatchSep: 0.06, // red-zone contested catch (CIT rel)
  // Per-play variation in how the route and coverage play out (a deterministic,
  // centred hash) — the spread of the real at-arrival separation distribution.
  jitter: 15, // 1σ in rating units
  // Separation at arrival (yards) by air depth, from BDB 2018 tracking
  // (bdb2021_2018): screens ~6.0, short ~2.8, intermediate ~1.9, deep ~1.2.
  baseScreen: 5.98,
  baseShort: 2.80,
  baseMid: 1.87,
  baseDeep: 1.24,
  yardsPerUnit: 0.16, // rating units → yards
  // The real at-arrival distribution is right-skewed (median 3.0, mean 3.8,
  // p90 8.0): tighten the left half and stretch the right half. Applied only to
  // the recorded separation, not to `separation`, so the sim's calibration is
  // untouched.
  skewLo: 0.60,
  skewHi: 1.36,
  // The at-arrival spread itself is depth-dependent: screens separate unevenly
  // (some blown up, some bottled), while deep coverage is tight for everyone.
  // Multipliers on skewLo/skewHi, keyed by the same air bucket as baseScreen….
  spreadLo: { screen: 1.70, short: 1.00, mid: 0.76, deep: 0.55 } as Record<string, number>,
  spreadHi: { screen: 0.95, short: 0.87, mid: 0.80, deep: 0.77 } as Record<string, number>,
  sepMin: -2.0, // clamp the displayed separation
  sepMax: 12.0,
  blanket: 0.8, // separationYd <= this = blanket
  tight: 1.7, // <= this = tight
  open: 3.4, // <= this = open, above = wide
  // ── completion ────────────────────────────────────────────────────────────
  // The separation gap moves the completion window (an open receiver completes
  // more) and the covering defender's *individual* ability moves it again: an
  // elite CB closes the window, a poor one throws it open. Both use the same
  // raw term and are centred by MU_CENTER.comp, so the league completion rate
  // is unchanged — only the spread widens. `compW` is what gives individual
  // ratings their big involvement (elite vs poor allowed-comp%).
  sepToRating: 0.15, // how much of the raw gap joins the sim's route-vs-coverage
  sepToComp: 0.0070, // per rating unit of raw matchup separation (gives comp its
  // separation gradient — an open receiver completes more, a bust completes a lot
  // more; centred by MU_CENTER.comp so the league rate is held)
  compW: 0.0140, // per rating point of (covering defender − reference cover)
  compMin: 0.20, // outer completion clamp (the base clamp is 0.42–0.74)
  compMax: 0.95,
  // ── busts / mis-calls ─────────────────────────────────────────────────────
  bustBase: 0.013, // raw per-pass bust chance (the rest of this block scales it)
  bustAwr: 0.0016, // down: secondary AWR rel
  bustPrc: 0.0012, // down: secondary PRC rel
  bustExp: 0.0012, // down: experience (years over 22)
  bustDc: 0.0012, // down: DC quality (defEdge)
  bustComplex: 0.008, // up: complex concept / pre-snap movement
  bustFat: 0.04, // up: defensive fatigue (fatDiff)
  bustSep: 38, // extra separation on a bust (≈6 yd — wide open)
  miscallEdge: 2, // a call edge >= this is a defensive mis-call candidate
  miscallRate: 0.35, // chance the mis-call actually breaks the coverage
  miscallSep: 26, // extra separation on a mis-call
  // An elite covering defender takes the ball away more often (naturally centred
  // — it uses position-relative ratings, so an average DB is exactly 1.0).
  intW: 0.004,
} as const

/**
 * Precomputed by `matchupProbe`: the league mean of the RAW matchup terms. They
 * are subtracted from every pass (the `WX_CENTER` pattern), so the league means
 * do not move and the model only widens the distribution.
 */
export const MU_CENTER = { sep: 1.0684, comp: 0.0499 }

/** Dev accumulator (turned on by `matchupProbe`): how the centre is measured. */
export const MU_STAT = { on: false, n: 0, rawSep: 0, rawSep2: 0, rawComp: 0, busts: 0, miscalls: 0, raw: [] as number[] }

/** J7: the league separation baseline (yards) for a concept's air depth. */
function muBaseSep(depth: number): number {
  return depth <= 2 ? MU.baseScreen : depth <= 9 ? MU.baseShort : depth <= 19 ? MU.baseMid : MU.baseDeep
}

// ── J8c: individual coverage & ball skills (beyond J7) ───────────────────────
// J7 made the *separation* depend on the covering defender. J8c extends that to
// the rest of the coverage: the man actually covering (`coverPlayer`) — plus the
// specific deep safety who helps on his side (`j8cHelp`) — decides the coverage
// skill, the completion window's edge, the busts, the PICK/deflection chance and
// who makes the tackle after the catch. Never a team/unit average.
//
// Every term deviates from the league mean at the defender's own position
// (`rmean`), so an average defender reproduces the old league level and only the
// SPREAD widens. The constant `coverBase` plays the `WX_CENTER` role: it holds the
// league-average coverage level so removing the team average does not move the
// league means. All picks are deterministic (`hash32`/`h01`) — no rng draw is
// added or removed, so `setJ8c(false)` is byte-identical to the J7 engine.
export const J8C = {
  // The league-average cover-skill level. The ON path replaces the old
  // `manW·avg(CB MCV)+…` unit level with the actual defender; because the
  // coverage defender is systematically the *top* CB/S/LB (above the positional
  // mean the old unit average sat at), this level is centred below the raw
  // positional mean so the play-weighted league mean matches the pre-J8c
  // coverage (measured: coverBase 78.0 → ON coverSkill mean 79.0, OFF 77.5;
  // this value lands ON at 77.5). The individual terms are centred, so this
  // constant alone sets the league level. Re-measured with the J8c diag (see
  // logs/j8c-verify.out).
  coverBase: 76.5,
  coverW: 1.0, // the covering defender's own man/zone blend (deviation)
  helpW: 0.35, // the deep safety helping over the top
  helpSpdW: 0.15, // a fast safety's range on deep throws (ZCV+SPD)
  awrW: 0.08, // help safety's AWR (replaces avg(saf AWR))
  mastW: 0.05, // mastery of the covering defender + help (replaces the unit mean)
  q4StaW: 0.12, // Q4 covering-defender stamina
  deepPrsW: 0.004, // deep press risk: covering defender's PRS
  deepSpdW: 0.003, // deep cap: help safety's SPD
  hawkW: 0.05, // INT ball skills: JMP+PRC of the covering defender + help
  ballHawkW: 0.5, // the ball-hawk instinct of the deciding pair
  // Centre for the added ball-skills term (JMP+PRC plus the ball-hawk instinct
  // of the deciding pair). The pre-J8c factor sat at ~0.956 (it subtracted a
  // secondary-wide average ball-hawk trait + JMP/PRC), so `hawkCenter` holds the
  // league INT rate at that same level. Measured on the J8c diag (300 games,
  // seed 33333): E[hawkPair] = 0.327, so hawkCenter = 1 + 0.327 − 0.956. The
  // individual spread (elite ball-hawk vs poor) is what widens; the league mean
  // does not move.
  hawkCenter: 0.371,
  // Weighted post-catch tackler pick (replaces the uniform in-group pick).
  tackPurW: 0.5,
  tackSpdW: 0.3,
  tackTakW: 0.5,
  tackCoverBoost: 7.5, // the covering defender is nearest to the catch
  // A coverage bust / mis-call keyed off the deciding defenders' own AWR/PRC.
  bustBase: 0.004,
  bustRecogW: 0.0016,
  // Ball skills: a break-up mark on an incompletion (bookkeeping + animation).
  pbuBase: 0.05,
  pbuSlope: 0.0016,
} as const

// ── J12 (FUTURES #34 + #35): coverage disguise & the game plan vs individuals ─
// #34: before the snap a defence shows a shell; the real coverage is revealed at
// the snap. Disguise quality is the DC's own `disguise` sub (J9, centred) plus
// the specific safeties on the field (their AWR/PRC). The QB's pre-snap read is
// his own AWR and experience. A fooled QB holds the ball (more pressure and
// sacks), completes less and throws more picks; a QB who reads it through earns a
// small edge. Every term is centred — the per-snap noise is symmetric, so the
// league means do not move and OFF is byte-identical.
//
// #35: each defence keys its plan on the opponent's best players (the AI picks
// deterministically by hash, never an rng draw), and each offence does the same
// on defence: SHADOW the opponent's WR1 with the CB1 (the CB1 covers him; the
// rest of the field is left with one fewer good cover man), SPY a running QB with
// the fastest LB (one fewer rusher), DOUBLE or CHIP the opponent's best edge
// rusher (a blocker is committed to him, another rusher comes free and one route
// is dropped). The coordinator's `reads` sub sets how often the plan is deployed
// and how well it is executed. Every effect runs through the same individual reps
// as the base sim — never a flat team modifier.
export const J12 = {
  // ── #34 disguise ──────────────────────────────────────────────────────────
  disgBase: 0.35, // share of snaps a league-average DC disguises
  disgW: 0.006, // per point of the DC's centred `disguise` sub
  disgLo: 0.2,
  disgHi: 0.7,
  dcDisgW: 0.06, // DC `disguise` (centred) → disguise quality
  safDisgW: 0.05, // the on-field safeties' AWR/PRC → disguise quality
  qbReadW: 0.06, // QB AWR → his pre-snap read
  qbExpW: 0.35, // QB experience (seasons over 22) → read
  readNoise: 9, // sd of the symmetric per-snap read noise (rating units)
  foolBias: 0.0, // residual centring constant (the runtime league centre removes the rest)
  foolPress: 2.4, // pressure-edge move when fooled (+, read-through −)
  foolSack: 0.16, // sack-chance move (the ball is held)
  foolComp: 0.035, // completion-probability move
  foolInt: 0.18, // interception-rate move
  // ── #35 game plan ─────────────────────────────────────────────────────────
  planBase: 0.18, // share of snaps an average coordinator keys a plan
  offPlanBase: 0.10, // the offence keys a plan less often (its protection cost is heavier)
  planReadW: 0.004, // per point of the centred `reads` sub
  planLo: 0.03,
  planHi: 0.42,
  qualW: 0.012, // centred `reads` → how well the element is executed (×)
  qbRunW: 0.7, // QB RUN rating → the spy threat weight
  qbSpdW: 0.5, // QB SPD → the spy threat weight
  doubleThresh: 4, // best rusher (rel) at/above this → DOUBLE, else CHIP
  shadowPen: 55, // WR1 target-score penalty when shadowed (softmax units)
  shadowGiveBack: 0.5, // share of the WR1 penalty handed back to the other receivers
  doubleWin: 0.5, // the doubled rusher's rep win ×
  chipWin: 0.78, // the chipped edge's rep win ×
  freeWin: 7, // the freed rusher's rep bump
  spyPress: 3, // pressure lost to the spy (one fewer rusher)
  spyRun: 7, // QB run-gain cut when spied
} as const

type J12DefMove = 'shadowWR1' | 'spyQB'
type J12OffMove = 'doubleRusher' | 'chipEdge'

/** J12: the coordinator in a seat (undefined when the seat is vacant). */
function j12Coord(world: World, teamId: string, role: 'Offensive Coordinator' | 'Defensive Coordinator') {
  return (world.staff[teamId] ?? []).find((s) => s.role === role)
}
/**
 * J12: a coordinator's sub as a DEVIATION from the league's mean rating for that
 * seat (0 = league average; 0 when J9 is off). `centeredSub` sits on the rating
 * scale (~74), so the league mean rating must be removed — otherwise every sub
 * term carries a constant ~74 offset, saturating the disguise/plan rates and
 * drifting them seed to seed. This mirrors the J9 sites (`centeredSub − hcMean`).
 */
function j12Sub(world: World, role: 'Offensive Coordinator' | 'Defensive Coordinator', key: 'reads' | 'disguise', m?: import('../types').StaffMember): number {
  return getCoachSubs() ? centeredSub(world, role, key, m) - coachMeanRating(world, role) : 0
}
/** J12: the AI's defensive plan for this snap — SHADOW the WR1 or SPY the QB. */
export function j12DefPlan(world: World, n: number, offId: string, defId: string): J12DefMove | undefined {
  const read = j12Sub(world, 'Defensive Coordinator', 'reads', j12Coord(world, defId, 'Defensive Coordinator'))
  if (h01(`${n}:${defId}:j12def`) >= clamp(J12.planBase + read * J12.planReadW, J12.planLo, J12.planHi)) return undefined
  const wr1 = topGroup(world, offId, ['WR'], 1)[0]
  const qb = topGroup(world, offId, ['QB'], 1)[0]
  const wrThreat = wr1 ? Math.max(0, unscaleOvr(wr1.ovr) - 74) : 0
  const qbThreat = qb
    ? Math.max(0, (mkAttrs(qb).RUN ?? 66) - 66) * J12.qbRunW + Math.max(0, (mkAttrs(qb).SPD ?? 70) - 72) * J12.qbSpdW
    : 0
  const frac = (wrThreat + 1) / (wrThreat + qbThreat + 2)
  return h01(`${n}:${defId}:j12which`) < frac ? 'shadowWR1' : 'spyQB'
}

/** J12: the AI's offensive plan for this snap — DOUBLE or CHIP the best rusher. */
export function j12OffPlan(world: World, n: number, offId: string, defId: string): J12OffMove | undefined {
  const read = j12Sub(world, 'Offensive Coordinator', 'reads', j12Coord(world, offId, 'Offensive Coordinator'))
  if (h01(`${n}:${offId}:j12off`) >= clamp(J12.offPlanBase + read * J12.planReadW, J12.planLo, J12.planHi)) return undefined
  const rushers = topGroup(world, defId, ['DE', 'DT'], 3)
  const best = rushers.reduce((m, r) => Math.max(m, rmean(r.pos, 'PMV', mkAttrs(r).PMV ?? 70), rmean(r.pos, 'FMV', mkAttrs(r).FMV ?? 70)), -99)
  return best >= J12.doubleThresh ? 'doubleRusher' : 'chipEdge'
}

// ── J36 (FUTURES #36): individual scouting reports — targeting ────────────────
// A club's staff writes a weekly report on the NEXT opponent's individual players
// (`buildScoutReport`). The game plan (user) or the AI then keys on one or two of
// them: the offence steers a pass at the flagged defender (the `targetWeakCB`
// pattern) or a run at the flagged tackler; the defence keys on the flagged
// opponent's skill player. The tag's edge applies ONLY when the player is
// genuinely weak on that trait (`weaknessEdge` reads his own ratings) — keying a
// strong player wrongly flagged gives nothing, and the steer itself already
// costs. Every pick is a deterministic hash, so with J36 off (or no targets) the
// engine is byte-identical to the pre-J36 sim.
export const J36 = {
  /** Most opponent player ids a plan may target (the UI enforces the same cap). */
  maxTargets: 2,
  /** AI clubs auto-key the top findings from their own staff's report. */
  autoTargets: 2,
  /** Share of snaps the targeting side actually keys on the flagged player. */
  steerRate: 0.14,
  /** A weak tackle-miss edge → run-yard scale. */
  runYardScale: 8,
  /** Sack-chance multiplier per unit of a weak OT's edge (speed rushers win). */
  otSackScale: 14,
  /** INT multiplier per unit of a weak QB's `qb-force` edge. */
  qbForceIntScale: 8,
  /** Fumble multiplier per unit of a back's `rb-fumble` edge. */
  fumbleScale: 10,
  /**
   * The cost of steering a throw at a flagged defender: the safety rotates over
   * the top (exactly the risk `targetWeakCB` already pays — intRisk 1.15). Keeps
   * the offence's targeting gain from being a free lunch, so the league mean holds.
   */
  steerIntRisk: 1.25,
} as const

/** J36: tags whose true edge opens the pass window (a defender the offence attacks). */
const J36_COVER_TAGS = new Set(['cb-bite', 's-angles', 'lb-tackle'])

/** J36: one keyed opponent player and the tag the offence/defence is exploiting. */
interface ScoutKey { id: string; tag?: string }

/** J36: the opponent's report, cached per (world, season, week, sides). */
const j36ReportCache = new WeakMap<World, Map<string, ScoutFinding[]>>()
function j36Report(world: World, myId: string, oppId: string): ScoutFinding[] {
  let m = j36ReportCache.get(world)
  if (!m) {
    m = new Map()
    j36ReportCache.set(world, m)
  }
  const key = `${world.season}:${world.week}:${myId}:${oppId}`
  const hit = m.get(key)
  if (hit) return hit
  const rep = buildScoutReport(world, myId, oppId)
  m.set(key, rep)
  return rep
}

/**
 * J36: the opponent players this club keys on this week. The user's club uses its
 * own plan targets (≤2, any reported player); an AI club takes the top findings
 * from its own staff's report on the opponent. No plan and no report → none.
 */
function j36TargetIds(world: World, myId: string, oppId: string, plan: import('./gameplan').GamePlan | null): ScoutKey[] {
  const planTargets = plan?.targets
  if (planTargets && planTargets.length) {
    return planTargets.slice(0, J36.maxTargets).map((id) => {
      const p = (world.roster[oppId] ?? []).find((x) => x.id === id)
      return { id, tag: p ? primaryTag(p.pos) : undefined }
    })
  }
  return j36Report(world, myId, oppId).slice(0, J36.autoTargets).map((f) => ({ id: f.playerId, tag: f.tag }))
}


// J12 #34: the league mean of the pre-snap read margin (disguise quality minus QB
// read) across the NFL's coordinators/players, cached per world (the WX_CENTER
// pattern). Subtracting it makes the per-snap read term zero-mean, so the league
// fool rate is 1/2 and the aggregate cannot drift seed to seed. The league fails
// to cancel only if the composition is fatally skewed — the fit is exact here.
const j12ReadCenterCache = new WeakMap<World, number>()
function j12ReadCenter(world: World): number {
  const hit = j12ReadCenterCache.get(world)
  if (hit !== undefined) return hit
  let sum = 0
  let cnt = 0
  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    const dc = j12Sub(world, 'Defensive Coordinator', 'disguise', j12Coord(world, t.id, 'Defensive Coordinator'))
    const saf = topGroup(world, t.id, ['S'], 1)[0]
    const safDisg = saf ? (rmean(saf.pos, 'AWR', mkAttrs(saf).AWR ?? 70) + rmean(saf.pos, 'PRC', mkAttrs(saf).PRC ?? 70)) * 0.5 : 0
    const qb = topGroup(world, t.id, ['QB'], 1)[0]
    const qbRead = qb ? rmean('QB', 'AWR', mkAttrs(qb).AWR ?? 70) * J12.qbReadW + Math.max(0, (qb.age ?? 22) - 22) * J12.qbExpW : 0
    sum += dc * J12.dcDisgW + safDisg * J12.safDisgW - qbRead
    cnt++
  }
  const center = cnt ? sum / cnt : 0
  j12ReadCenterCache.set(world, center)
  return center
}

/**
 * J8c: a defender's man/zone cover blend *relative to the average starter at his
 * position* — 0 for an average defender, so blending individuals cannot drift the
 * league mean. `manW` is the club's man-coverage tendency (0 = zone).
 */
function coverRelOf(p: Player | undefined, manW: number): number {
  if (!p) return 0
  const a = mkAttrs(p)
  return manW * rmean(p.pos, 'MCV', a.MCV ?? 70) + (1 - manW) * rmean(p.pos, 'ZCV', a.ZCV ?? 70)
}

/**
 * J8c: the deep safety who rotates over the top on the target's side (or the
 * second safety). Deterministic hash of the play + club — never an rng draw.
 */
function j8cHelp(n: number, defId: string, saf: Player[], coverId: string | undefined): Player | undefined {
  if (!saf.length) return undefined
  const pool = saf.filter((p) => p.id !== coverId)
  const list = pool.length ? pool : saf
  return list[hash32(`${n}:${defId}:j8chelp`) % list.length]
}

/** J8c: one defender's ball skills (JMP+PRC), relative to his position's mean. */
function ballSkills(p: Player | undefined): number {
  if (!p) return 0
  const a = mkAttrs(p)
  return rmean(p.pos, 'JMP', a.JMP ?? 70) * 0.5 + rmean(p.pos, 'PRC', a.PRC ?? 70) * 0.5
}

/** J8c: one defender's play recognition (PRC+AWR), relative to his position. */
function recognitionRel(p: Player | undefined): number {
  if (!p) return 0
  const a = mkAttrs(p)
  return rmean(p.pos, 'PRC', a.PRC ?? 70) * 0.5 + rmean(p.pos, 'AWR', a.AWR ?? 70) * 0.5
}

/** J8c: a post-catch tackler pick weighted by proximity (PUR/SPD/TAK). */
function proximityWeight(p: Player, coverId: string | undefined): number {
  const prox = eff(p, 'PUR') * J8C.tackPurW + eff(p, 'SPD') * J8C.tackSpdW + eff(p, 'TAK') * J8C.tackTakW
  return Math.max(1, prox * (p.id === coverId ? J8C.tackCoverBoost : 1))
}

/** J8c: dev accumulator (turned on by `j8cProbe`): the mean individual terms. */
export const J8C_STAT = { on: false, n: 0, cov: 0, cov2: 0, sep: 0, compRaw: 0, qAcc: 0, compProb: 0, sk: 0, ks: 0, stopN: 0, stopRating: 0, stopMiss: 0, hawk: 0 }

function resolvePass(world: World, rng: Rng, offId: string, defId: string, concept: Concept, yard: number, passShare = 0.57, tier: 'NFL' | 'FBS' = 'NFL', clutch = 0, env?: SimEnv, call?: CallEffect, n = 0, means: MasteryMeans = leagueMasteryMeans(world), dist = 0, down = 0): PlayOutcome {
  const ocEff = ocEffect(world, offId)
  const dcEff = ocEffect(world, defId)
  // L10 G11/G12: matchup and workload effects apply to the user's club only, so
  // AI-vs-AI snaps never see them.
  const userTeamId = env?.userTeamId
  const userOff = !!userTeamId && userTeamId === offId
  const userDef = !!userTeamId && userTeamId === defId
  const offMove = userOff ? env?.matchups?.off : undefined
  const defMove = userDef ? env?.matchups?.def : undefined
  const usage = env?.usage
  // R15: select the actual healthy 11 first — the concept's grouping topped up to
  // eleven (QB override, injuries and fatigue rotation preserved) — then derive
  // every resolver group from that same eleven, so a backfill player has a real
  // rated role instead of only a snap charge. The snap/fatigue accounting uses
  // exactly this eleven; it is never reconstructed from a different group.
  // L13: when the user has set their own package it shapes that eleven (the
  // receivers/TE/RB/FB mix); AI-vs-AI and legacy saves keep the concept grouping,
  // so calibration and `__simTest` are untouched.
  const userOffP = userOff ? env?.personnel?.off : undefined
  const userDefP = userDef ? env?.personnel?.def : undefined
  const offCounts = userOffP ? offenseCounts(userOffP) : undefined
  const offEleven = fillToEleven(world, offId, offenseOnField(world, offId, concept, env?.qbOverride, undefined, env?.fat, offCounts), OFF_FILL)
  const qb = offEleven.find((p) => p.pos === 'QB')
  const ol = offEleven.filter((p) => p.pos === 'OT' || p.pos === 'OG' || p.pos === 'C')
  const backs = offEleven.filter((p) => p.pos === 'RB')
  const rb = backs[0]
  const fb = offEleven.find((p) => p.pos === 'FB')
  // G11 doubleRusher: chipping the best rusher also keeps a back in to block,
  // so the target pool drops to the top three receivers.
  const passCatchers = offEleven.filter((p) => p.pos === 'WR' || p.pos === 'TE')
  const defPkg = userDefP ? defenseCounts(userDefP) : undefined
  const defEleven = fillToEleven(world, defId, defenseOnField(world, defId, concept.personnel, env?.fat, defPkg), DEF_FILL)
  const dl = defEleven.filter((p) => p.pos === 'DE' || p.pos === 'DT')
  const lbs = defEleven.filter((p) => p.pos === 'LB')
  const cbs = defEleven.filter((p) => p.pos === 'CB')
  const saf = defEleven.filter((p) => p.pos === 'S')
  const onFieldDefIds = defEleven.map((p) => p.id)
  const onFieldOffIds = offEleven.map((p) => p.id)
  // ── J36 (FUTURES #36): the scouting-report game plan ────────────────────────
  // Read the targets the club keys on this week (plan targets for the user, the
  // staff report for the AI) and the edge a GENUINE weakness is worth. The steer
  // itself is applied to `coverId` below; a false read earns nothing.
  let scoutTarget: string | undefined
  let scoutSteerId: string | undefined
  let scoutCoverEdge = 0
  let scoutDropId: string | undefined
  let scoutDropEdge = 0
  let scoutSackBonus = 0
  let scoutIntMult = 1
  let scoutFumbleId: string | undefined
  let scoutFumbleMult = 1
  if (J36_ON) {
    for (const t of j36TargetIds(world, offId, defId, planFor(offId, 'off'))) {
      const dp = defEleven.find((x) => x.id === t.id)
      if (!dp || h01(`${n}:${offId}:j36steer`) >= J36.steerRate) continue
      scoutTarget = dp.id
      if (J36_COVER_TAGS.has(t.tag ?? '') && (dp.pos === 'CB' || dp.pos === 'S' || dp.pos === 'LB')) {
        scoutSteerId = dp.id
        scoutIntMult *= J36.steerIntRisk
      }
      scoutCoverEdge += weaknessEdge(dp, t.tag)
      break
    }
    for (const t of j36TargetIds(world, defId, offId, planFor(defId, 'def'))) {
      const op = offEleven.find((x) => x.id === t.id)
      if (!op) continue
      const edge = weaknessEdge(op, t.tag)
      if (edge <= 0) continue
      scoutTarget = scoutTarget ?? op.id
      if (t.tag === 'ot-speed') scoutSackBonus += edge * J36.otSackScale
      else if (t.tag === 'qb-force') scoutIntMult *= 1 + edge * J36.qbForceIntScale
      else if (t.tag === 'rb-fumble') { scoutFumbleId = op.id; scoutFumbleMult *= 1 + edge * J36.fumbleScale }
      else if (t.tag === 'wr-drops') { scoutDropId = op.id; scoutDropEdge = edge }
      break
    }
  }
  const scoutFields: Pick<PlayOutcome, 'scoutTarget'> = scoutTarget ? { scoutTarget } : {}
  // ── J12 (FUTURES #34 + #35) ────────────────────────────────────────────────
  // The AI's game plan vs the opponent's best players (deterministic hash, never
  // an rng draw; the user's club uses the AI choice for now). A user-set matchup
  // (env.matchups) still wins, so the L10 G11 front end is untouched.
  const j12OffMove = J12_ON ? j12OffPlan(world, n, offId, defId) : undefined
  const j12DefMove = J12_ON ? j12DefPlan(world, n, offId, defId) : undefined
  const effOffMove = offMove ?? j12OffMove
  const effDefMove = defMove ?? j12DefMove
  // G11 doubleRusher / J12: a committed back is one fewer route. The legacy user
  // doubleRusher drops the 4th route (unchanged); the J12 AI DOUBLE instead pays
  // through the freed rusher (the rep model), and only the AI CHIP drops a route.
  const dropsRoute = offMove === 'doubleRusher' || effOffMove === 'chipEdge'
  const wrs = passCatchers.slice(0, dropsRoute ? 3 : 4)
  // J12 SHADOW: the CB1 is locked on the opponent's WR1, so the QB works away
  // from him (his target share falls) and the rest of the field is left with one
  // fewer good cover man (the coverage cost elsewhere, applied below).
  const wr1Opp = effDefMove === 'shadowWR1' && COVERAGE_INDIV_ON ? topGroup(world, offId, ['WR'], 1)[0] : undefined
  const shadowActive = !!wr1Opp && wrs.some((w) => w.id === wr1Opp.id)
  const dStyle = defStyle(world, defId)
  const ocScheme = (world.staff[offId] ?? []).find((s) => s.role === 'Offensive Coordinator')?.scheme
  const pEdge = personnelEdgeFor(world, env, offId, defId)
  // R15: the offence's and defence's average in-game fatigue. Effects use the
  // difference, so a league-average club is exactly neutral.
  const fatDiff = unitFatigue(env?.fat, [...dl, ...lbs, ...cbs, ...saf]) - unitFatigue(env?.fat, [qb, ...wrs, ...ol, rb, fb])

  // ── L12 E2: unit-level relative ratings (centered; no rng) ──────────────────
  const isQ4 = (env?.qtr ?? 0) >= 4
  const olStrRel = avg(ol.map((p) => rmean(p.pos, 'STR', mkAttrs(p).STR ?? 70)))
  const recog = recognition(dl, lbs, saf)

  const qbA = qb ? mkAttrs(qb) : {}
  const qbStyle = qb ? styleProfile(qb) : styleProfile({ traits: [''] } as Player)
  const qbFit = qb ? schemeFit(qb, ocScheme, 'OFF') : 0.5
  // J12 #34: pre-snap disguise. The defence shows a shell and reveals the real
  // coverage at the snap. Disguise quality is the DC's own `disguise` sub plus
  // the safeties actually on the field (their AWR/PRC); the QB reads it with his
  // own AWR/experience and a symmetric per-snap noise. A fooled QB holds the ball
  // (more pressure/sacks, fewer completions, more picks); a QB who reads it
  // through earns a small, matched edge. Centred: the noise is symmetric and the
  // sub/ratings are position-centred, so the league means do not move.
  let disguised = false
  let qbFooled = false
  let disgAdj = 0
  if (J12_ON) {
    const dcM = j12Coord(world, defId, 'Defensive Coordinator')
    const dcDisg = j12Sub(world, 'Defensive Coordinator', 'disguise', dcM)
    const disgP = clamp(J12.disgBase + dcDisg * J12.disgW, J12.disgLo, J12.disgHi)
    disguised = h01(`${n}:${defId}:j12disg`) < disgP
    if (disguised) {
      // The specific safety who rotates the shell (hash-picked from the on-field
      // safeties) — never a unit mean.
      const safPick = saf.length ? saf[hash32(`${n}:${defId}:j12saf`) % saf.length] : undefined
      const safDisg = safPick
        ? (rmean(safPick.pos, 'AWR', mkAttrs(safPick).AWR ?? 70) + rmean(safPick.pos, 'PRC', mkAttrs(safPick).PRC ?? 70)) * 0.5
        : 0
      const disgQ = dcDisg * J12.dcDisgW + safDisg * J12.safDisgW
      const qbRead = rmean('QB', 'AWR', qbA.AWR ?? 70) * J12.qbReadW + Math.max(0, (qb?.age ?? 22) - 22) * J12.qbExpW
      const noise = (h01(`j12n1:${n}:${offId}`) + h01(`j12n2:${n}:${offId}`) + h01(`j12n3:${n}:${offId}`) + h01(`j12n4:${n}:${offId}`) - 2) / 0.5774
      qbFooled = disgQ - qbRead - j12ReadCenter(world) + J12.foolBias + noise * J12.readNoise > 0
      disgAdj = qbFooled ? 1 : -1
    }
  }
  // J12: what the animation needs — the shell was disguised and whether the QB was
  // fooled by it (undefined when J12 is off, so the OFF Play record is unchanged).
  const j12Fields: Pick<PlayOutcome, 'disguised' | 'qbFooled'> = disguised ? { disguised: true, qbFooled } : {}
  const pressureVals = dl.map((p) => Math.max(mkAttrs(p).PMV ?? 70, mkAttrs(p).FMV ?? 70))
  // G11 doubleRusher / J12 DOUBLE & CHIP: the committed blocker takes the best
  // rusher down a notch.
  if ((effOffMove === 'doubleRusher' || effOffMove === 'chipEdge') && pressureVals.length) {
    let best = 0
    for (let i = 1; i < pressureVals.length; i++) if (pressureVals[i] > pressureVals[best]) best = i
    pressureVals[best] *= effOffMove === 'doubleRusher' ? J12.doubleWin : J12.chipWin
  }
  let pressure = avg(pressureVals)
  // L12 E2: DL quickness/power joins the rush; a tired front loses push in Q4.
  pressure += dlRushExtras(dl, olStrRel) * E2_W
  if (isQ4) pressure += relAvg('STA', dl) * 0.12 * E2_W
  // G11 spyQB spends a rusher (−4); G12 DL rotation trades pressure by quarter.
  if (effDefMove === 'spyQB') pressure -= J12_ON ? J12.spyPress : 4
  if (usage && userDef) {
    const q4 = (env?.qtr ?? 0) >= 4
    if (usage.dl === 'starters') {
      if (q4) pressure -= 3
    } else if (usage.dl === 'rotate') {
      pressure += q4 ? 1.5 : -1.5
    }
  }
  const protection = avg(ol.map((p) => mkAttrs(p).PBK ?? 70)) - (isQ4 ? relAvg('STA', [...ol, qb]) * 0.08 * E2_W : 0) + clamp(masteryRelAvg(ol, means) * 0.04, -2, 2)
  const defPlan = planFor(defId, 'def')
  // G6 third-down heat: extra blitz on the opponent's 3rd downs.
  const heat = hasFix(env, defId, 'thirdDownHeat') && env?.down === 3 ? 0.15 : 0
  const blitzRoll = rng()
  const blitz = blitzRoll < clamp(dStyle.blitz + (defPlan ? planEffects(defPlan, true).blitz : 0) + heat, 0, 0.8)
  // L12 E2: a blitz brings the linebackers' rush into the pressure.
  if (blitz) pressure += lbBlitzRush(lbs) * 0.3 * E2_W
  // ── J8b: the individual rep model ──────────────────────────────────────────
  // Every rusher faces the blocker assigned to him; the weakest rep leads. Only
  // when the layer is on (the OFF branch below is the untouched base it replaces).
  const teOff = offEleven.find((p) => p.pos === 'TE')
  const pb: RushResult | undefined = PROT_ON
    ? rushMatchups(n, defId, dl, lbs, cbs, ol, rb, teOff, fb, blitz, env?.fat, effOffMove, effDefMove, usage && userDef ? usage.dl : undefined, isQ4)
    : undefined
  if (pb && PB_STAT.on) {
    PB_STAT.n++
    PB_STAT.raw += pb.edge
    PB_STAT.old += (pressure - protection) + (blitz ? 9 * (1 - olBlitzAware(ol)) : 0) - fatDiff * R15.fatPress
  }
  // A pass-heavy plan is predictable: the defense pins its ears back and sits
  // on the throws (balances the passing game's natural edge over the run).
  const passLean = Math.max(0, planFor(offId, 'off')?.passBias ?? 0)
  const pressureEdge = (pb
    ? (pb.edge - PB_CENTER.edge + (concept.depth > 15 ? 4 : 0) - ocEff.offEdge * 0.5 + dcEff.defEdge * 0.5
      + (defPlan && defPlan.aggression >= 1.5 ? 3 : 0) + passLean * PASS_LEAN_PRESSURE)
    : (pressure - protection + (blitz ? 9 * (1 - olBlitzAware(ol)) : 0) + (concept.depth > 15 ? 4 : 0) - ocEff.offEdge * 0.5 + dcEff.defEdge * 0.5
      + (defPlan && defPlan.aggression >= 1.5 ? 3 : 0) + passLean * PASS_LEAN_PRESSURE - fatDiff * R15.fatPress)) * (env?.wx?.pressureMult ?? 1)
  // Real rate is ~6.9% of dropbacks (NFL) / higher pressure in college; scaled by pass share.
  // G6 max protect: sacks give up 40% less often.
  const protectMult = hasFix(env, offId, 'maxProtect') ? 0.6 : 1
  // J12 #34: a fooled QB holds the ball — a higher share of pressures convert to
  // sacks; a QB who reads the disguise gets the ball out. Linear and zero-mean.
  const sackChance = clamp((R2.sackBase + pressureEdge * 0.0012) * (passShare) * (tier === 'FBS' ? 0.75 : 1) * protectMult * (call?.sackMult ?? 1) * (1 - qbSackEscape(qbA)) * (1 + disgAdj * J12.foolSack) * (1 + scoutSackBonus), 0.02, 0.13)

  // ── R7: per-dropback pressure decision (stats only) ─────────────────────────
  // Derived from the existing `pressureEdge` by a per-play hash, so no rng() draw
  // is spent and the play outcome (completion / sack / INT / yards) is untouched.
  const pressured = h01(`${n}:${offId}:press`) < clamp(PRESSURE.base + (pressureEdge + disgAdj * J12.foolPress) * PRESSURE.slope, PRESSURE.lo, PRESSURE.hi)
  const pressureIsHit = h01(`${n}:${offId}:phit`) < PRESSURE.hitRate
  // One rusher per pressure: the DL weighted by max(PMV, FMV); on a blitz an LB
  // can steal the credit exactly as sack credit does (hash-gated). Never an rng.
  const pressureRusherId = (): string | undefined => {
    if (blitz && lbs.length && hash32(`${n}:${defId}:presslb`) % 100 < 55) {
      return lbs[hash32(`${n}:${defId}:presslbid`) % lbs.length]?.id
    }
    const pool = dl.length ? dl : lbs
    return hashPick(pool, (p) => Math.max(1, Math.max(mkAttrs(p).PMV ?? 70, mkAttrs(p).FMV ?? 70)), hash32(`${n}:${defId}:presspick`))?.id
  }
  // J8b: with the layer on the rusher who WON the rep (the max win) takes the
  // credit; the base weighted pick is the fallback.
  const creditRusherId = (): string | undefined => (pb ? pb.credit?.id : pressureRusherId())
  const pressureFields = (type: 'sack' | 'hit' | 'hurry', id?: string): Pick<PlayOutcome, 'pressure' | 'pressureType' | 'pressureId' | 'beatenBlockerId' | 'timeToPressureS'> =>
    ({ pressure: true, pressureType: type, pressureId: id, ...(pb ? { beatenBlockerId: pb.credit?.blockerId, timeToPressureS: pb.time } : {}) })

  // Target selection (L12 S1): a scheme-fitting, style-appropriate receiver gets
  // more looks, but the ball is spread by a softmax draw over those scores rather
  // than an argmax. No rng draw is added or removed: the scored map keeps its one
  // draw per receiver, and the highest-scored receiver's own draw is reused as the
  // uniform. RB1 joins the pool as a checkdown with a role prior (no draw).
  const scored = wrs.map((w) => {
    const a = mkAttrs(w)
    const st = styleProfile(w)
    const longBall = concept.depth >= 12
    // L12.15 S2: route-running ratings are absent from the Madden/CFB data, so the
    // fallback is the receiver's raw (pre-remap) overall — the same value the sim
    // used before the compressed scale, via the inverse map.
    const rawOvr = unscaleOvr(w.ovr)
    const route = longBall ? (a.DRR ?? rawOvr) : concept.depth >= 7 ? (a.MRR ?? rawOvr) : (a.SRR ?? rawOvr)
    const styleBonus = longBall ? st.deepBias * 14 : st.yacBias * 10 + st.contested * 6
    const fit = schemeFit(w, ocScheme, 'OFF')
    const r = rng()
    // J12 SHADOW: the CB1 locks the WR1, so the read works away from him. The
    // penalty on the WR1's weight is handed back to the other receivers, so the
    // *quality* of the target pool is preserved (league-neutral) while the WR1's
    // share falls — the cost to the offence is the coverage, not the play call.
    const shadowDelta = shadowActive
      ? (w.id === wr1Opp!.id ? -J12.shadowPen : (J12.shadowPen * J12.shadowGiveBack) / Math.max(1, wrs.length - 1))
      : 0
    return { w, score: route * 0.6 + (a.SPD ?? rawOvr) * 0.25 + styleBonus + (fit - 0.5) * 16 + r * 12 - (env?.fat?.[w.id] ?? 0) * R15.fatTarget + shadowDelta, r }
  })
  if (rb && !scored.some((s) => s.w.id === rb.id)) {
    const a = mkAttrs(rb)
    const longBall = concept.depth >= 12
    const rawOvr = unscaleOvr(rb.ovr)
    const route = longBall ? (a.DRR ?? rawOvr) : concept.depth >= 7 ? (a.MRR ?? rawOvr) : (a.SRR ?? rawOvr)
    scored.push({ w: rb, score: route * 0.6 + (a.SPD ?? rawOvr) * 0.25 + TARGET_TUNE.rbPrior, r: -1 })
  }
  // L12.10 B0: a fullback is an occasional flat/checkdown target (handled below).
  scored.sort((a, b) => b.score - a.score)
  const maxScore = scored[0]?.score ?? 0
  const weights = scored.map((s) => Math.exp((s.score - maxScore) / TARGET_TUNE.tau))
  const totalW = weights.reduce((x, y) => x + y, 0) || 1
  // Uniform from the existing per-receiver draws: their sum mod 1 is uniform and
  // nearly independent of the ranking (reusing one receiver's own draw is biased).
  // No rng draw is added.
  const drawSum = scored.reduce((acc, x) => acc + (x.r >= 0 ? x.r : 0), 0)
  const uniform = drawSum - Math.floor(drawSum)
  let accW = 0
  let target = scored[0]?.w ?? rb
  let readRank = 0
  for (let i = 0; i < scored.length; i++) {
    accW += weights[i] / totalW
    if (uniform < accW) { target = scored[i].w; readRank = i; break }
  }
  // L12.10 B0: an occasional fullback checkdown on a short concept (deterministic; no rng).
  if (fb && concept.depth <= 4 && hash32(`${n}:${offId}:fbflat`) % 100 < 4) { target = fb; readRank = scored.length }
  const tA = target ? mkAttrs(target) : {}
  const tStyle = target ? styleProfile(target) : styleProfile({ traits: [''] } as Player)
  // Q7: pick the coverage defender now, from the same groups, with no rng draw.
  // J8c: `let` because the plan-driven coverage (`targetWeakCB` / `shadowWR1`) may
  // reassign the actual defender below.
  let coverId = coverDefender(target, concept, wrs, cbs, saf, lbs)
  // J36: a steered throw attacks the flagged defender (he becomes the cover man,
  // exactly like `targetWeakCB`) — the report's finding is what put him there.
  if (J36_ON && scoutSteerId) coverId = scoutSteerId
  // J3: the emitted air yards of this attempt. OFF = the legacy fixed concept
  // depth (byte-identical); ON = the deterministic route-type spread. Every
  // probability formula below keeps using concept.depth, so comp/INT/sack are
  // unchanged by construction.
  const passAir = DEPTH_AWARE_ON ? airYardsFor(concept, target?.pos, n, offId, yard) : concept.depth

  if (rng() < sackChance) {
    // R2: a sack costs ≈ 7 yards (real 2015–2024).
    const y = -Math.round(5 + rng() * 5)
    // Always consume the DL pick draw so the rng stream is unchanged.
    const pickDraw = rng()
    const dlPick = dl[pickDraw < 0.5 ? 0 : Math.min(1, dl.length - 1)]?.id
    // L12 S3: on a blitz sack, 30% of the time a linebacker gets the credit
    // (deterministic hash of the play number).
    const blitzLb = blitz && lbs.length && hash32(`${n}:${defId}:blitzsack`) % 100 < 55
      ? lbs[hash32(`${n}:${defId}:blitzlb`) % lbs.length]?.id
      : undefined
    // J8b: with the layer on, the sack goes to the rusher who won his rep.
    const sackId = pb ? pb.credit?.id : blitzLb ?? dlPick
    // R16: a strip sack forces a fumble. A proximity hash decides who falls on it
    // (the rusher is usually on top of the ball, so the defence recovers more).
    // The result keeps the "Sack" prefix so it is still counted as a sack.
    const strip = h01(`${n}:${defId}:strip`) < R16.stripSackRate
    const recovery = strip ? fumbleRecovery(`${n}:${defId}:striprec`, R16.stripOffRecover) : undefined
    const lost = strip && recovery === 'def'
    const result = !strip ? (blitz ? 'Sack (blitz)' : 'Sack') : lost ? 'Sack, forced Fumble!' : 'Sack, Fumble recovered by the offence'
    return {
      type: 'pass', concept: concept.name, yards: y, result, turnover: lost,
      ...pressureFields('sack', sackId), blitz, timeUsed: 24 + Math.floor(rng() * 12),
      qbId: qb?.id, sackId, coverId, ...j12Fields, ...scoutFields,
      stripSack: strip || undefined, fumbleCause: strip ? 'strip' : undefined, fumbleRecoveredBy: recovery,
      onFieldOff: onFieldOffIds, onFieldDef: onFieldDefIds,
    }
  }

  const qAccuracy = (qbA.SAC ?? 70) * 0.3 + (qbA.MAC ?? 70) * 0.3 + (qbA.DAC ?? 70) * 0.25 + (qbA.AWR ?? 70) * 0.15
  // J8c: resolve WHO is actually covering before the matchup layer reads him.
  // `targetWeakCB` attacks the weakest corner (he BECOMES the cover defender) and
  // `shadowWR1` sends the CB1 with the WR1 — the declared defender, not a knob on
  // a team average. The single rng() draw below is the same draw at the same point
  // in the stream (no draw sits between its old and new position).
  const cbMcv = cbs.map((p) => mkAttrs(p).MCV ?? 70)
  const zoneCov = avg([...cbs, ...lbs, ...saf].map((p) => mkAttrs(p).ZCV ?? 70))
  let weakCb = false
  let manCov = avg(cbMcv)
  if (offMove === 'targetWeakCB' && cbMcv.length) {
    weakCb = rng() < 0.35
    if (weakCb) manCov = Math.min(...cbMcv)
  }
  if (COVERAGE_INDIV_ON && weakCb && cbs.length) {
    coverId = cbs.reduce((best, p) => ((mkAttrs(p).MCV ?? 70) < (mkAttrs(best).MCV ?? 70) ? p : best)).id
  }
  // G11 shadowWR1 / J12 SHADOW: with J8c the CB1 is actually assigned to the WR1
  // when the plan says so (the OFF path keeps the pre-J8c team-average nudge
  // further down). The cost falls elsewhere through the same individual rep: with
  // the CB1 locked on the WR1, the other targets are covered by the next corner.
  if (effDefMove === 'shadowWR1' && COVERAGE_INDIV_ON) {
    if (wr1Opp && target && target.id === wr1Opp.id && cbs.length) coverId = cbs[0].id
    else if (cbs.length > 1 && coverId === cbs[0].id) coverId = cbs[1].id
  }
  // E1: the coverage defender, for the release-vs-press term (no rng draw).
  const coverPlayer = coverId ? [...cbs, ...saf, ...lbs].find((p) => p.id === coverId) : undefined
  // J8c: the specific deep safety helping over the top on this side.
  const helpS = COVERAGE_INDIV_ON ? j8cHelp(n, defId, saf, coverId) : undefined
  // L12 E2: RB/TE targets are covered by linebackers, so their MCV joins man.
  // (OFF only: with J8c the covering LB's own MCV already decides his cover.)
  if (!COVERAGE_INDIV_ON && target && (target.pos === 'TE' || target.pos === 'RB' || target.pos === 'FB')) manCov += relAvg('MCV', lbs) * 0.35 * E2_W
  // ── J7: MATCHUPS & BUSTS ────────────────────────────────────────────────────
  // The covering defender (never an rng draw). Off → every value is zero and no
  // Play field is added, so the base sim is untouched.
  const coverA = coverPlayer ? mkAttrs(coverPlayer) : undefined
  const covPos = coverPlayer?.pos
  const manW = dStyle.manCoverage
  let muSep = 0
  let coverRel = 0
  let compRaw = 0
  let bust = false
  let miscall = false
  if (MATCHUPS_ON && target) {
    // The reference cover level is the league mean at the position that *should*
    // cover this target (a CB on a WR/TE, an LB on a back). An elite covering
    // defender sits above it (negative separation); an LB or safety on a
    // receiver sits well below it (a mismatch in the receiver's favour).
    const refPos = target.pos === 'WR' || target.pos === 'TE' ? 'CB' : 'LB'
    const refMcv = POS_MEAN[refPos]?.MCV ?? 70
    const refZcv = POS_MEAN[refPos]?.ZCV ?? 70
    coverRel = coverA ? manW * ((coverA.MCV ?? 70) - refMcv) + (1 - manW) * ((coverA.ZCV ?? 70) - refZcv) : 0
    muSep -= coverRel * MU.coverSep
    if (coverA && covPos) {
      muSep += (rmean(target.pos, 'SPD', tA.SPD ?? 70) - rmean(covPos, 'SPD', coverA.SPD ?? 70)) * MU.spdSep
      muSep += (rmean(target.pos, 'ACC', tA.ACC ?? 70) - rmean(covPos, 'ACC', coverA.ACC ?? 70)) * MU.accSep
      muSep += (rmean(target.pos, 'AGI', tA.AGI ?? 70) - rmean(covPos, 'AGI', coverA.AGI ?? 70)) * MU.agiSep
      // A big receiver's contested-catch edge in the red zone.
      if (yard >= 80) muSep += rmean(target.pos, 'CIT', tA.CIT ?? tA.CTH ?? 70) * MU.rzCatchSep
    }
    // Safety help over the top closes the window a little. J8c: the specific deep
    // safety on this side, not the unit average.
    if (COVERAGE_INDIV_ON) {
      if (helpS) {
        muSep -= rmean('S', 'AWR', mkAttrs(helpS).AWR ?? 70) * MU.safAwr
        muSep -= rmean('S', 'ZCV', mkAttrs(helpS).ZCV ?? 70) * MU.safZcv
      }
    } else {
      muSep -= avg(saf.map((p) => rmean(p.pos, 'AWR', mkAttrs(p).AWR ?? 70))) * MU.safAwr
      muSep -= avg(saf.map((p) => rmean(p.pos, 'ZCV', mkAttrs(p).ZCV ?? 70))) * MU.safZcv
    }
    // Per-play variation (deterministic hash, centred): the route/coverage
    // does not play out the same way every snap. This is what gives the
    // separation distribution its spread. No rng draw.
    // NB: the varying token must sit at the FRONT of the key — FNV-1a leaves
    // hashes of strings that differ only in the last character ~0.95 correlated.
    const z = (h01(`sj1:${n}:${defId}`) + h01(`sj2:${n}:${defId}`) + h01(`sj3:${n}:${defId}`) + h01(`sj4:${n}:${defId}`) - 2) / 0.5774
    muSep += clamp(z, -2.5, 2.5) * MU.jitter
    // Bust (a communication breakdown): rarer for smart, experienced defenders
    // and a good DC; likelier with pre-snap movement and a tired defence. J8c:
    // the breakdown belongs to the deciding pair (the covering defender + his
    // help safety) — their own AWR/PRC/experience — not a unit average.
    const focus = COVERAGE_INDIV_ON ? [coverPlayer, helpS].filter((p): p is Player => !!p) : []
    const secAwr = COVERAGE_INDIV_ON
      ? (focus.length ? avg(focus.map((p) => rmean(p.pos, 'AWR', mkAttrs(p).AWR ?? 70))) : 0)
      : avg([...cbs, ...saf, ...lbs].map((p) => rmean(p.pos, 'AWR', mkAttrs(p).AWR ?? 70)))
    const secPrc = COVERAGE_INDIV_ON
      ? (focus.length ? avg(focus.map((p) => rmean(p.pos, 'PRC', mkAttrs(p).PRC ?? 70))) : 0)
      : avg([...cbs, ...saf].map((p) => rmean(p.pos, 'PRC', mkAttrs(p).PRC ?? 70)))
    const secExp = COVERAGE_INDIV_ON
      ? (focus.length ? avg(focus.map((p) => Math.max(0, p.age - 22))) : 0)
      : avg([...cbs, ...saf, ...lbs].map((p) => Math.max(0, p.age - 22)))
    const complex = concept.depth >= 15 || !!offMove || concept.name.startsWith('PA ')
    const bustP = clamp(
      MU.bustBase - secAwr * MU.bustAwr - secPrc * MU.bustPrc - secExp * MU.bustExp
        - dcEff.defEdge * MU.bustDc + (complex ? MU.bustComplex : 0) + clamp(fatDiff, 0, 2) * MU.bustFat,
      0.001, 0.1,
    )
    bust = h01(`${n}:${defId}:bust`) < bustP
    // A mis-call: the defensive call was the wrong answer to the concept (the
    // call matrix already gives the offence a big edge), and the coverage breaks.
    miscall = !bust && !!call && call.edge >= MU.miscallEdge && h01(`${n}:${defId}:miscall`) < MU.miscallRate
    // J8c: a blown assignment by the deciding pair (their own PRC/AWR) breaks the
    // coverage even without a wrong call. Centred: an average pair leaves the base
    // rate, a poor one is beaten more often.
    if (COVERAGE_INDIV_ON && !bust && !miscall && focus.length) {
      const recogFocus = avg(focus.map((p) => recognitionRel(p)))
      miscall = h01(`${n}:${defId}:miscall8`) < clamp(J8C.bustBase - recogFocus * J8C.bustRecogW, 0.001, 0.05)
    }
    if (bust) muSep += MU.bustSep
    if (miscall) muSep += MU.miscallSep
    // The completion effect: the separation gap, plus the covering defender's
    // individual ability (elite DB → tighter window, poor DB → open window).
    compRaw = muSep * MU.sepToComp - coverRel * MU.compW
    if (MU_STAT.on) {
      MU_STAT.n++
      MU_STAT.rawSep += muSep
      MU_STAT.rawSep2 += muSep * muSep
      MU_STAT.rawComp += compRaw
      MU_STAT.raw.push(muSep)
      if (bust) MU_STAT.busts++
      if (miscall) MU_STAT.miscalls++
    }
  }
  // Centred so the league mean is unchanged (the `WX_CENTER` pattern).
  const muSepNet = MATCHUPS_ON && target ? muSep - MU_CENTER.sep : 0
  const muOff = muSepNet * MU.yardsPerUnit
  const muBucket = concept.depth <= 2 ? 'screen' : concept.depth <= 9 ? 'short' : concept.depth <= 19 ? 'mid' : 'deep'
  const sepYd = MATCHUPS_ON && target
    ? +clamp(muBaseSep(concept.depth) + (muOff >= 0 ? muOff * MU.skewHi * (MU.spreadHi[muBucket] ?? 1) : muOff * MU.skewLo * (MU.spreadLo[muBucket] ?? 1)), MU.sepMin, MU.sepMax).toFixed(1)
    : undefined
  const coverTag: CoverTag | undefined = !(MATCHUPS_ON && target) ? undefined
    : bust ? 'bust' : miscall ? 'miscall'
      : (sepYd ?? 0) <= MU.blanket ? 'blanket'
        : (sepYd ?? 0) <= MU.tight ? 'tight'
          : (sepYd ?? 0) <= MU.open ? 'open' : 'wide'
  const matchupFields: Pick<PlayOutcome, 'coverDefenderId' | 'separationYd' | 'coverTag' | 'muAirDepth'> =
    MATCHUPS_ON && target ? { coverDefenderId: coverId, separationYd: sepYd, coverTag, muAirDepth: concept.depth } : {}
  // J7: an elite covering defender takes the ball away more often (position-
  // relative, so an average DB is exactly 1.0 — no centring needed).
  const coverIntMult = MATCHUPS_ON && coverA && covPos
    ? clamp(1 + (manW * rmean(covPos, 'MCV', coverA.MCV ?? 70) + (1 - manW) * rmean(covPos, 'ZCV', coverA.ZCV ?? 70)) * MU.intW, 0.85, 1.3)
    : 1
  // J8d: the route-rating fallback is the receiver's raw OVR, exactly like target
  // selection above — a receiver whose position does not carry DRR/MRR (TE/RB) no
  // longer silently drops to 70 in separation.
  const tRaw = target ? unscaleOvr(target.ovr) : 70
  const targetRoute = concept.depth > 14 ? (tA.DRR ?? (getIndividual() ? tRaw : 70))
    : concept.depth > 7 ? (tA.MRR ?? (getIndividual() ? tRaw : 70))
      : (tA.SRR ?? (getIndividual() ? tRaw : 70))
  const separation =
    targetRoute * 0.5 +
    (tA.SPD ?? 70) * 0.3 +
    (tA.AGI ?? 70) * 0.2 +
    tStyle.deepBias * (concept.depth >= 12 ? 6 : -2) -
    Math.min(readRank, 3) * TARGET_TUNE.readPenalty +
    qbDeepThp(qbA, concept.depth) +
    targetAccCod(target, tA) +
    releaseVsPress(target, tA, coverPlayer, dStyle.manCoverage, concept.depth) +
    // L13: a favourable personnel matchup shows up as separation.
    (pEdge ? pEdge.pass : 0) +
    // L12.13 M3: a receiver's mastery of the system shows in his separation.
    (target && (target.pos === 'WR' || target.pos === 'TE') ? clamp(masteryOffset(target, means) * 0.06, -3, 3) : 0) +
    // J7: the covering defender, mismatches and coverage busts.
    muSepNet * MU.sepToRating
  // The covering defender's own cover ability (J8c). The *level* is a league
  // constant (`coverBase`, the WX_CENTER role) and the deviation is the man
  // himself — centred per position — plus the help safety. Never a unit mean.
  // OFF keeps the pre-J8c team-average form exactly.
  const covRel = coverRelOf(coverPlayer, dStyle.manCoverage)
  const helpRel = COVERAGE_INDIV_ON
    ? coverRelOf(helpS, dStyle.manCoverage) +
      (concept.depth >= 15 ? rmean('S', 'SPD', helpS ? mkAttrs(helpS).SPD ?? 70 : 70) * J8C.helpSpdW : 0)
    : 0
  let coverSkill: number
  if (COVERAGE_INDIV_ON) {
    coverSkill = J8C.coverBase + J8C.coverW * covRel + J8C.helpW * helpRel
  } else {
    coverSkill = dStyle.manCoverage * manCov + (1 - dStyle.manCoverage) * zoneCov
  }
  // G11 shadowWR1 (OFF path only): the pre-J8c code nudged the team average; with
  // J8c the CB1 was actually assigned to the WR1 above.
  if (!COVERAGE_INDIV_ON && defMove === 'shadowWR1') {
    const wr1 = topGroup(world, offId, ['WR'], 1)[0]
    if (wr1 && target && target.id === wr1.id) coverSkill = (cbMcv.length ? cbMcv[0] : 70) * 1.05
    else coverSkill *= 0.96
  }
  const planOverrides = applyDefPlan(defId, dStyle)
  // G6 fixes: load-the-box loosens coverage; two-deep gives up the underneath but
  // caps explosives; third-down heat concedes more explosives on 3rd down.
  const compMult = planOverrides.compMult * (hasFix(env, defId, 'twoDeep') ? 1.04 : 1)
  let bigPlayRisk = planOverrides.bigPlayRisk * (hasFix(env, defId, 'twoDeep') ? 0.85 : 1) * (heat ? 1.1 : 1) * (1 + fatDiff * R15.fatBig)
  // J8a: the open-field chase replaces the coverage averages. The nearest
  // pursuers (CB/S/LB) are hash-picked and the carrier's speed is compared with
  // each; the closest one (the man who runs him down) is credited on the stop.
  // The pass-YAC *yardage* tail is left to the plan/J8c terms so the broadcast
  // camera's fast-carrier bound is untouched; the individual speed shows in the
  // deep-risk term and in who makes the tackle.
  const passPursuers = J8A_ON ? pickPursuers(`${n}:${defId}:passchase`, lbs, saf, cbs) : []
  const passClose = J8A_ON ? chaseInfo(target, passPursuers, `${n}:${defId}:passchase`) : { edge: 0, headStart: 0, angle: 0, nP: 0 } as Chase
  // L12 E2: press coverage risks a deep shot if the receiver wins; a fast safety
  // caps it. J8c: the covering corner's own press (PRS) and the help safety's own
  // speed (SPD) — range = ZCV+SPD — not the CB/safety unit means.
  if (concept.depth >= 15) {
    if (COVERAGE_INDIV_ON) {
      const prs = coverPlayer ? rmean(coverPlayer.pos, 'PRS', coverA?.PRS ?? 70) : 0
      const spd = helpS ? rmean('S', 'SPD', mkAttrs(helpS).SPD ?? 70) : 0
      bigPlayRisk *= clamp(1 + prs * J8C.deepPrsW - spd * J8C.deepSpdW, 0.6, 1.5)
    } else {
      bigPlayRisk *= clamp(1 + (relAvg('PRS', cbs) * 0.004 - relAvg('SPD', saf) * 0.003) * E2_W, 0.6, 1.5)
    }
  }
  // J7: a coverage bust means the receiver is already gone — a big-play chance.
  if (bust) bigPlayRisk *= 1.3
  // J8c: the coverage on this play is the covering defender + his help safety —
  // never a unit average. Each term below replaces the pre-J8c team mean and is
  // centred (per position / per league level), so the league mean holds.
  const extraInd = COVERAGE_INDIV_ON && coverPlayer
    ? rmean(coverPlayer.pos, 'ACC', coverA?.ACC ?? 70) * 0.05
      + rmean(coverPlayer.pos, 'AGI', coverA?.AGI ?? 70) * 0.05
      + rmean(coverPlayer.pos, 'STR', coverA?.STR ?? 70) * 0.03
    : dbCoverageExtras(cbs, saf) * E2_W
  // The help safety's own AWR (a uniform safety pick, so the league level holds).
  const awrInd = COVERAGE_INDIV_ON
    ? (helpS ? mkAttrs(helpS).AWR ?? 70 : saf.length ? mkAttrs(saf[0]).AWR ?? 70 : 70) * J8C.awrW
    : avg(saf.map((p) => mkAttrs(p).AWR ?? 70)) * 0.08
  // Recognition of the nearest defenders (covering defender + help + a flat LB).
  const flatLb = lbs.length ? lbs[hash32(`${n}:${defId}:flatlb`) % lbs.length] : undefined
  const recogInd = COVERAGE_INDIV_ON
    ? clamp(
        (coverPlayer ? recognitionRel(coverPlayer) : 0) * 0.5 +
        (helpS ? recognitionRel(helpS) : 0) * 0.3 +
        (flatLb ? recognitionRel(flatLb) : 0) * 0.2,
        -25, 25,
      )
    : recog
  let coverage = coverSkill * dStyle.coverage * planOverrides.coverMult * (hasFix(env, defId, 'loadTheBox') ? 0.96 : 1) + awrInd
  // L12 E2: the covering defender's own athleticism (replaces the all-DB mean).
  coverage += extraInd
  // L12.13 M3: the defending pair's mastery of the system (replaces the unit mean).
  coverage += COVERAGE_INDIV_ON
    ? clamp((masteryOffset(coverPlayer, means) + masteryOffset(helpS, means)) * 0.5 * J8C.mastW, -3, 3)
    : clamp(masteryRelAvg([...cbs, ...saf], means) * 0.05, -3, 3)
  if (concept.depth <= 2 && concept.yac >= 0.8) coverage += recogInd * 0.4 * E2_W
  if (isQ4) coverage += (COVERAGE_INDIV_ON
    ? (coverA && coverPlayer ? rmean(coverPlayer.pos, 'STA', coverA.STA ?? 70) : 0)
    : relAvg('STA', [...cbs, ...saf, ...lbs, ...dl])) * J8C.q4StaW * E2_W
  const edge = qAccuracy + separation - coverage * 1.15 - concept.depth * 0.5 - 145 // centered ~0
  if (J8C_STAT.on) { J8C_STAT.n++; J8C_STAT.cov += coverage; J8C_STAT.sep += separation; J8C_STAT.compRaw += compRaw; J8C_STAT.qAcc += qAccuracy; J8C_STAT.sk += coverSkill; J8C_STAT.ks += dStyle.coverage * planOverrides.coverMult * (hasFix(env, defId, 'loadTheBox') ? 0.96 : 1) }
  // Play-action: a run-heavy offense gets a passing bonus as the defense bites.
  const offPassBias = planFor(offId, 'off')?.passBias ?? 0
  // E1: QB play-action rating scales the existing bonus; E2: the deciding pair's
  // own recognition beats it (J8c), replacing the unit mean.
  const pacMult = qbPacMult(qbA)
  const recogMult = clamp(1 - recogInd * 0.004 * E2_W, 0.6, 1.4)
  const playAction = offPassBias < 0 ? Math.min(2.2, -offPassBias * 1.5) * pacMult * recogMult : 0
  // G11 spyQB: a quarterback spy erases the QB run/pass conflict on those calls.
  const spyPenalty = effDefMove === 'spyQB' && /QB Draw|RPO/.test(concept.name) ? (J12_ON ? J12.spyPress : 3) : 0
  const talentEdge = (edge / 4) + (qAccuracy - 72) * 0.4 + (qbFit - 0.5) * 10 + masteryOffset(qb, means) * 0.252 + MASTERY_ANCHOR_QB + playAction - passLean * PASS_LEAN_EDGE + (call?.edge ?? 0) * 1.5 - spyPenalty

  // Completion probability based on real league rate vs. this matchup. Coordinator
  // quality shifts it: a great OC helps, a great DC hurts.
  const coachShift = (ocEff.offEdge - dcEff.defEdge) * 0.003
  const playActionComp = offPassBias < 0 ? Math.min(0.02, -offPassBias * 0.01) * pacMult * recogMult : 0
  // E1: a receiver's hands (CTH/CIT/SPC/JMP) move the completion a little; tight coverage is when
  // the defense's coverage edge beats the route.
  const tightCoverage = coverage * 1.15 > qAccuracy + separation
  // R2: the pocket compresses near the goal line — a smaller window, a faster
  // throw. 0 at the 20, growing to `rzCompDamp` on the doorstep.
  const rzDamp = yard >= 80 ? R2.rzCompDamp * clamp((yard - 80) / 19, 0, 1) : 0
  let compProb = clamp(
    (R2.compBase + (qAccuracy + separation - coverage * 1.15 - concept.depth * 0.7 - Math.max(0, pressureEdge) * 0.5 * (1 - qbPressureRelief(qbA))) / 900 - (tier === 'FBS' ? 0.02 : 0) + coachShift - rzDamp) * mod(effDefMove === 'spyQB' ? qbStyle.scramble * 0.5 : qbStyle.scramble, 0.04) * compMult + clutch * 0.012 + playActionComp - passLean * PASS_LEAN_COMP + (call?.edge ?? 0) * 0.012 + targetCatchProb(target, tA, concept.depth, tightCoverage) + (env?.down === 3 ? R2.moneyComp : 0) + fatDiff * R15.fatComp,
    0.42,
    0.74,
  )
  // G6 quick game: short concepts complete a touch more. Max protect costs a
  // deep concept a target (slightly lower completion).
  if (hasFix(env, offId, 'quickGame') && concept.depth <= 8) compProb = clamp(compProb + 0.03, 0.42, 0.74)
  if (hasFix(env, offId, 'maxProtect') && concept.depth >= 12) compProb = clamp(compProb - 0.03, 0.42, 0.74)
  // FUTURES #6: a deep ball (depth >= 15) in the wind is harder to complete.
  // Centred multiplier (exactly 1 when weather is off); no rng draw is added.
  if (concept.depth >= 15) compProb = clamp(compProb * (env?.wx?.deepCatchMult ?? 1), 0.42, 0.74)
  // J7: the individual covering defender (and the LB/S-on-receiver mismatch)
  // moves the completion window directly; centred by MU_CENTER.comp so the
  // league completion rate is unchanged. The outer clamp only widens the range
  // (the base clamp is 0.42–0.74), so an elite CB closes the window and a poor
  // one opens it — individual ratings get a big say.
  if (MATCHUPS_ON && target) compProb = clamp(compProb + compRaw - MU_CENTER.comp, MU.compMin, MU.compMax)
  // J36: the scouting-report edge. The offence keying a genuinely weak defender
  // opens the window; the defence keying a receiver who drops closes it. A false
  // read adds nothing (the steer alone already costs).
  if (J36_ON) {
    const drop = target && scoutDropId && target.id === scoutDropId ? scoutDropEdge : 0
    const net = scoutCoverEdge - drop
    if (net) compProb = clamp(compProb + net, MU.compMin, MU.compMax)
  }
  // J12 #34: a fooled QB works through his progressions late and misses; a QB who
  // reads the disguise through throws with a small, matched edge. Zero-mean (the
  // per-snap read noise is symmetric), so the league completion rate holds.
  compProb = clamp(compProb - disgAdj * J12.foolComp, MU.compMin, MU.compMax)
  if (J8C_STAT.on) { J8C_STAT.cov2 += coverage * coverage; J8C_STAT.compProb += compProb }
  // G7 hurry: a faster offense forces riskier throws.
  // L12 E2: JMP+PRC replace part of the trait-only ball-hawk in the pick rate.
  // J8c: those ball skills belong to the deciding pair — the covering defender
  // and the deep safety helping him — and they ADD to the pick rate (the pre-J8c
  // term SUBTRACTED a secondary-wide average, which inverted the signal: an elite
  // ball-hawk took *fewer* picks). `hawkCenter` plays the WX_CENTER role: it
  // removes the mean bias from always picking the top cover defender, so the
  // league INT level stays where the calibration set it. OFF keeps the pre-J8c
  // term exactly (`ratingHawk` * E2_W is folded back in verbatim).
  const hawkPair = COVERAGE_INDIV_ON
    ? (coverPlayer ? ballSkills(coverPlayer) * J8C.hawkW + styleProfile(coverPlayer).ballHawk * J8C.ballHawkW : 0) +
      (helpS ? (ballSkills(helpS) * J8C.hawkW + styleProfile(helpS).ballHawk * J8C.ballHawkW) * 0.5 : 0)
    : 0
  if (J8C_STAT.on) J8C_STAT.hawk += hawkPair
  const intSkillTerm = COVERAGE_INDIV_ON
    ? clamp(1 + hawkPair - J8C.hawkCenter, 0.25, 2.5)
    : (1 - avg(saf.map((p) => styleProfile(p).ballHawk)) * 0.15 - avg([...cbs, ...saf].map((p) => {
        const a = mkAttrs(p)
        return (rmean(p.pos, 'JMP', a.JMP ?? 70) * 0.5 + rmean(p.pos, 'PRC', a.PRC ?? 70) * 0.5) * 0.01
      })) * E2_W)
  const intProb = clamp(R2.intBase * (1 - (qAccuracy - coverage) / 300) * intSkillTerm * planOverrides.intMult * (1 - clutch * 0.03) * (env?.intMult ?? 1) * (weakCb ? 1.15 : 1) * qbIntMult(qbA, concept.depth) * (1 - fatDiff * R15.fatInt) * (concept.depth >= 15 ? (env?.wx?.deepIntMult ?? 1) : 1) * coverIntMult * (1 + disgAdj * J12.foolInt) * scoutIntMult, 0.005, 0.06)

  if (rng() < intProb) {
    // L12 S3/E2: the coverage defender takes the pick most often, otherwise the
    // best ball-hawk by JMP/PRC plus the trait bonus. Deterministic (no rng).
    const dbPool = [...cbs, ...saf]
    const hawkWeight = (p: Player) => {
      const a = mkAttrs(p)
      return Math.max(1, (a.JMP ?? 70) * 0.4 + (a.PRC ?? 70) * 0.6 + styleProfile(p).ballHawk * 30) * (p.pos === 'S' ? 2 : 1)
    }
    const ir = hash32(`${n}:${defId}:int`) % 100
    // A linebacker in coverage holds on to fewer picks; a deep safety holds more.
    const coverIsLb = !!coverId && lbs.some((p) => p.id === coverId)
    const coverIsS = !!coverId && saf.some((p) => p.id === coverId)
    const fallback = hashPick(dbPool, hawkWeight, hash32(`${n}:${defId}:inthawk`))?.id
    const takeCover = !!coverId && (coverIsLb ? ir < 32 : coverIsS ? ir < 80 : ir < 42)
    const intId = takeCover ? coverId : fallback
    // R6: real NFL pick-six rate ≈ 10–11% of interceptions (deterministic hash).
    const pickSix = h01(`${n}:${defId}:pick6`) < 0.105
    // R16: a share of picks come off a tipped/deflected ball — either batted at the
    // line by a rusher or muffed by the receiver. Flavour + attribution only; the
    // interception count itself is decided above and is unchanged.
    const tipped = h01(`${n}:${defId}:tipped`) < R16.tippedIntRate
    const tipMuff = tipped && h01(`${n}:${defId}:tipmuff`) < R16.tippedMuffShare
    const tipId = !tipped ? undefined
      : tipMuff ? target?.id
        : hashPick(dl.length ? dl : lbs, (p) => Math.max(1, mkAttrs(p).PMV ?? 70, mkAttrs(p).FMV ?? 70), hash32(`${n}:${defId}:tipdl`))?.id
    const tipText = !tipped ? '' : tipMuff ? ' (muffed catch)' : ' (tipped at the line)'
    return {
      type: 'pass', concept: concept.name, yards: 0,
      result: (pickSix ? 'Interception returned for a TOUCHDOWN!' : 'Interception!') + tipText,
      turnover: true, blitz,
      ...(DEPTH_AWARE_ON ? { passDepth: passAir, passConceptDepth: concept.depth } : {}),
      timeUsed: 22 + Math.floor(rng() * 12), ...(pressured ? pressureFields(pressureIsHit ? 'hit' : 'hurry', creditRusherId()) : {}), qbId: qb?.id, intId, coverId, ...matchupFields, ...j12Fields,
      targetId: target?.id, defTD: pickSix, returnerId: pickSix ? intId : undefined,
      scorerId: pickSix ? intId : undefined,
      tippedInt: tipped || undefined, tipId, muffedCatch: tipMuff || undefined,
      onFieldOff: onFieldOffIds, onFieldDef: onFieldDefIds,
    }
  }
  if (rng() < compProb) {
    const gains: string[] = []
    const catchSkill = (tA.CTH ?? 70) * 0.5 + (tA.SPC ?? 70) * 0.2 + (tA.BTK ?? 70) * 0.3 + tStyle.contested * 8
    let gain = sampleYards(rng, true, talentEdge + (catchSkill - 72), gains, yard, tier)
    // R2: the real distribution is sampled first, then a small league-wide
    // calibration trims the positive tail (the rating terms above are unchanged).
    if (gain > 0) gain = Math.round(gain * R2.passGainCal)
    // Live defensive plan bends the explosive part of a play: soft zone caps
    // them, press man risks them. Underneath gains are left alone.
    if (gain > 15) gain = 15 + Math.round((gain - 15) * bigPlayRisk)
    // R2: the long-TD rate is tuned separately from the short passing game.
    if (gain > 20) gain = Math.round(gain * R2.explosiveCal)
    // J8a: the open-field chase decides the extra yards on a long catch — the
    // carrier's speed (plus the head start from the catch) versus the nearest
    // hash-picked pursuers (CB/S/LB), replacing the old team PUR/SPD mean that
    // ignored the secondary. OFF (or passYac = 0) leaves the gain untouched.
    if (gain > 20 && J8A_ON && J8A.passYac && passClose.chaser && yard < 80) {
      const ydToGoal = Math.max(0, 100 - yard - 20)
      const uTd = h01(`${n}:${defId}:passchase:td`)
      gain = uTd < chaseTdProb(passClose, ydToGoal)
        ? Math.max(gain, 100 - yard)
        : Math.min(gain, 20 + chaseCaughtExtra(passClose, h01(`${n}:${defId}:passchase:ex`)))
    }
    // Style-driven YAC: playmakers and elusive receivers add yards after the catch.
    if (gain > 0) gain += Math.round((tStyle.yacBias * 2.5 * (0.5 + rng()) + tStyle.elusiveness * (1 + rng() * 3)) * R2.yacCal)
    // R2: near the goal line the field is compressed — a would-be score can be
    // stood up short, so it becomes a tackle at the 1 rather than a guaranteed TD.
    if (yard + gain >= 100 && gain > 0) gain = Math.round(gain * (1 - R2.rzPassDamp))
    // L12 S1: checkdowns and tight-end throws are underneath targets — scale their
    // yards to NFL yards-per-target (RB ~5.5, TE ~7) instead of the route model's.
    if ((target?.pos === 'RB' || target?.pos === 'FB') && gain > 0) gain = Math.round(gain * TARGET_TUNE.rbYds)
    else if (target?.pos === 'TE' && gain > 0) gain = Math.round(gain * TARGET_TUNE.teYds)
    gain = clamp(gain, -8, 85)
    // J3: reshape the completion as air + YAC so a deep concept completes deep
    // and a screen/checkdown gains near the line. The chain above already consumed
    // its rng draws, so ON/OFF streams stay aligned; only the value (and the
    // emitted passDepth) changes. `gain` (the calibrated draw) is reused as the
    // deterministic shape/quality driver — no new rng draw.
    const preReshapeGain = gain
    if (DEPTH_AWARE_ON) gain = depthAwareGain(passAir, gain, n, offId, yard, down, dist)
    // R2: on a money down the route is worked back to the sticks.
    if (gain > 0 && env?.down === 3) gain += R2.moneyYards
    // J3 outcome-preserving guard: the reshape may add yards, but it must not
    // manufacture a first down (any down) or a score in the red zone that the
    // calibrated draw would not have produced. With depthMix = 0 this is a no-op
    // (gain === preReshapeGain), so the OFF/neutral path is bit-exact.
    if (DEPTH_AWARE_ON) {
      const baseFinal = preReshapeGain + (env?.down === 3 ? R2.moneyYards : 0)
      if (dist > 0 && baseFinal < dist && gain >= dist) gain = dist - 1
      if (gain > 0 && yard + baseFinal < 100 && yard + gain >= 100) gain = Math.max(-4, 100 - yard - 1)
    }
    // L12 S3: a completion is stopped by one defender — the coverage defender most
    // often, support otherwise. No credit on a score. J6: a receiver forced out of
    // bounds still credits a defender, so the widened marker keeps the tackle and
    // missed-tackle accounting (the clock cap handles the real clock-stop window).
    const oobP = oobRate(env, concept, target?.pos)
    const oob = oobP > 0 && gain > 0 && yard + gain < 100 &&
      h01(`${n}:${offId}:oob`) < oobP
    const stopped = yard + gain < 100 && (!oob || CLOCK_ON) ? passTackler(n, defId, coverId, coverPlayer, saf, lbs) : undefined
    const tacklerGroups = [cbs, saf, lbs]
    // L12 E2: a strong tackler cuts the YAC short.
    if (stopped && gain > 0) gain = Math.max(-4, gain - tacklerYacShrink(stopped, tacklerGroups))
    // L12 E2: a big hitter can jar the ball loose on the stop. Reuses this play's
    // time draw (no new rng) and only fires on a tackle, never on a score.
    const tu = rng()
    // R5: the first defender attempts the tackle. A deterministic miss adds yards
    // and a second defender finishes the play (no rng draw added or removed).
    let stopper = stopped
    let missedTackleIds: string[] | undefined
    let forcedMissedIds: string[] | undefined
    if (stopped && gain > 0 && yard + gain < 100 &&
      hash32(`${n}:${defId}:passmt`) / 4294967296 < tackleMissChance([...cbs, ...saf, ...lbs].find((p) => p.id === stopped), target, gain, true)) {
      missedTackleIds = [stopped]
      gain += missExtraYards(`${n}:${offId}:passmty`)
      // A miss that reaches the end zone has no finishing tackle to credit.
      stopper = yard + gain < 100 ? finishTackler(`${n}:${defId}:passmt2`, stopped, [cbs, saf, lbs]) : undefined
      forcedMissedIds = target?.id ? [target.id] : undefined
    }
    if (J8C_STAT.on && stopped) {
      const sp = [...cbs, ...saf, ...lbs].find((p) => p.id === stopped)
      J8C_STAT.stopN++
      if (sp) J8C_STAT.stopRating += tackleRating(sp)
      if (missedTackleIds) J8C_STAT.stopMiss++
    }
    const big = gain >= 25
    // R16: the ball can still come loose on a clean stop — a big-hit strip, or the
    // receiver's own bobble (a muff). Either way a proximity hash decides who falls
    // on it; the offence keeps roughly half of all loose balls.
    const strip = !!stopper && !missedTackleIds && gain > 0 && yard + gain < 100 && tu < (R2.passFumbleBase + tacklerHitPower(stopper, tacklerGroups)) * (env?.wx?.fumbleMult ?? 1) * (target && scoutFumbleId === target.id ? scoutFumbleMult : 1)
    const muff = !strip && gain > 0 && yard + gain < 100 && h01(`${n}:${offId}:muff`) < muffChance(target?.pos, tA) * (env?.wx?.muffMult ?? 1)
    const loose = strip || muff
    const recovery = loose ? fumbleRecovery(`${n}:${offId}:passrec`, R16.offRecover) : undefined
    const lost = loose && recovery === 'def'
    // R6: a loose ball is scooped and returned for a TD ~7–8% of the time
    // (deterministic hash, no rng), but only when the defence recovers it.
    const fumTD = lost && h01(`${n}:${defId}:passtd`) < 0.085
    // The returner is the defender on the stop; a receiver-only muff has no
    // stopper, so fall back to a nearby defender for the scoring credit.
    const fumTDScorer = fumTD
      ? (stopper ?? hashPick([...cbs, ...saf, ...lbs], (p) => Math.max(1, mkAttrs(p).TAK ?? 70), hash32(`${n}:${defId}:passtdrec`))?.id)
      : undefined
    const baseResult = fumTD ? 'Fumble returned for a TOUCHDOWN!'
      : lost ? (muff ? 'Muffed catch — Fumble!' : 'Fumble!')
        : strip ? 'Fumble recovered by the offence'
          : muff ? 'Muffed catch, recovered by the offence'
            : big ? 'Explosive play!' : 'Complete'
    return maybeScramble(offId, n, qb, qbStyle, pressured, {
      type: 'pass', concept: concept.name, yards: gain, blitz,
      result: oob ? `${baseResult} (out of bounds)` : baseResult,
      turnover: lost, carrierId: target?.id, targetId: target?.id, passDepth: passAir, ...(DEPTH_AWARE_ON ? { passConceptDepth: concept.depth } : {}), bigPlay: !loose && big,
      outOfBounds: oob || undefined,
      fumbleId: strip ? stopper : undefined, muffedCatch: muff || undefined,
      fumbleCause: loose ? (strip ? 'carry' : 'muff') : undefined, fumbleRecoveredBy: recovery,
      defTD: fumTD, returnerId: fumTDScorer, scorerId: fumTDScorer,
      ...(pressured ? pressureFields(pressureIsHit ? 'hit' : 'hurry', creditRusherId()) : {}),
      timeUsed: 24 + Math.floor(tu * 16), qbId: qb?.id, coverId, ...matchupFields, ...j12Fields, ...scoutFields, tackleIds: stopper ? [J8A_ON && J8A.passChaserCredit && !missedTackleIds && gain > 15 && passClose.chaser ? passClose.chaser.id : stopper] : undefined,
      missedTackleIds, forcedMissedIds,
      reception: true,
      onFieldOff: onFieldOffIds, onFieldDef: onFieldDefIds,
    }, loose || yard + gain >= 100)
  }
  const incomplete: PlayOutcome = { type: 'pass', concept: concept.name, yards: 0, result: 'Incomplete', turnover: false, blitz, targetId: target?.id, passDepth: passAir, ...(DEPTH_AWARE_ON ? { passConceptDepth: concept.depth } : {}), ...(pressured ? pressureFields(pressureIsHit ? 'hit' : 'hurry', creditRusherId()) : {}), timeUsed: 20 + Math.floor(rng() * 14), qbId: qb?.id, coverId, ...matchupFields, ...j12Fields, ...scoutFields, onFieldOff: onFieldOffIds, onFieldDef: onFieldDefIds }
  // R5: mark a genuine drop on a targeted incompletion. Deterministic hash off
  // the existing play number/offence; the result and every sim counter are
  // unchanged. Better hands (CTH) drop fewer.
  if (target && hash32(`${n}:${offId}:drop`) / 4294967296 < dropChance(target.pos, tA) * (env?.wx?.dropMult ?? 1)) incomplete.dropId = target.id
  // J8c: a pass defended — the covering defender's own ball skills (JMP+PRC)
  // decide how often he gets a hand on an incompletion. Bookkeeping only (the
  // animation shows the break-up); no outcome or counter moves.
  if (COVERAGE_INDIV_ON && target && coverPlayer && !incomplete.dropId) {
    const pbuP = clamp(J8C.pbuBase + ballSkills(coverPlayer) * J8C.pbuSlope, 0.01, 0.2)
    if (h01(`${n}:${defId}:pbu`) < pbuP) incomplete.pbuId = coverPlayer.id
  }
  // J6: a pressured QB tucks and runs instead of throwing it away. Taken from the
  // pass-outcome population, so completion % / YPA / sack % are preserved.
  return maybeScramble(offId, n, qb, qbStyle, pressured, incomplete)
}

function resolveRun(world: World, rng: Rng, offId: string, defId: string, concept: Concept, distance: number, yard: number, tier: 'NFL' | 'FBS' = 'NFL', clutch = 0, env?: SimEnv, call?: CallEffect, n = 0, means: MasteryMeans = leagueMasteryMeans(world)): PlayOutcome {
  const ocEff = ocEffect(world, offId)
  const dcEff = ocEffect(world, defId)
  // L10 G11/G12: matchup and workload effects apply to the user's club only.
  const userTeamId = env?.userTeamId
  const userOff = !!userTeamId && userTeamId === offId
  const userDef = !!userTeamId && userTeamId === defId
  const defMove = userDef ? env?.matchups?.def : undefined
  const usage = env?.usage
  // R15: real personnel. The rush pool keeps two backs for the carry split, but the
  // eleven actually on the field is the concept's grouping plus the back who took
  // the rep; every resolver group derives from that same selected eleven.
  const userOffP = userOff ? env?.personnel?.off : undefined
  const userDefP = userDef ? env?.personnel?.def : undefined
  const offCounts = userOffP ? offenseCounts(userOffP) : undefined
  const offBase = offenseOnField(world, offId, concept, env?.qbOverride, undefined, env?.fat, offCounts)
  const qbBase = offBase.find((p) => p.pos === 'QB')
  const fbBase = offBase.find((p) => p.pos === 'FB')
  const rbPool = topGroup(world, offId, ['RB'], 2)
  // J12 #35: the AI's defensive plan for this run (a spy keys on a running QB).
  // A user-set matchup still wins; deterministic hash, never an rng draw.
  const effDefMove = defMove ?? (J12_ON ? j12DefPlan(world, n, offId, defId) : undefined)
  void dcEff
  // L13: the user's own defensive package answers (base/nickel/dime); AI-vs-AI
  // and legacy saves keep the scheme-derived package, so calibration is unchanged.
  const defPkg = userDefP ? defenseCounts(userDefP) : undefined
  const defEleven = fillToEleven(world, defId, defenseOnField(world, defId, concept.personnel, env?.fat, defPkg), DEF_FILL)
  const dl = defEleven.filter((p) => p.pos === 'DE' || p.pos === 'DT')
  const lbs = defEleven.filter((p) => p.pos === 'LB')
  const saf = defEleven.filter((p) => p.pos === 'S')
  const cbs = defEleven.filter((p) => p.pos === 'CB')
  const onFieldDefIds = defEleven.map((p) => p.id)
  const dStyle = defStyle(world, defId)
  const ocScheme = (world.staff[offId] ?? []).find((s) => s.role === 'Offensive Coordinator')?.scheme
  const pEdge = personnelEdgeFor(world, env, offId, defId)
  // L12 E2: Q4 fatigue uses each unit's relative STA (centered; no rng).
  const isQ4 = (env?.qtr ?? 0) >= 4
  // L12 S2: split carries RB1 / RB2 / QB from deterministic role weights, shifted
  // by the user's usage, a mobile QB, and short yardage. The pick is a hash of
  // (play.n, offId) — never an rng draw. QB runs use his own legs for elusiveness.
  let runEdgeBonus = 0
  let w1 = 0.6
  let w2 = 0.27
  let wq = 0.13
  // G12 workload (user only): 'feature' rides RB1 harder (+1 edge); 'committee'
  // keeps its original draw — RB2 takes 40% of carries and RB1 is fresh in the 4th.
  let committeePick: Player | undefined
  if (userOff && usage) {
    if (usage.rb === 'feature') {
      w1 += 0.15
      runEdgeBonus = 1
    } else if (usage.rb === 'committee') {
      if (rbPool[1] && rng() < 0.4) committeePick = rbPool[1]
      else {
        committeePick = rbPool[0]
        if ((env?.qtr ?? 1) >= 4) runEdgeBonus = 1
      }
    }
  }
  const qbStyle = qbBase ? styleProfile(qbBase) : undefined
  if (qbStyle) wq += qbStyle.scramble * 0.12
  // L13: 21 personnel leans on the second back; 12 keeps an extra tight end in.
  if (userOffP === '21') { w2 += 0.12; w1 -= 0.04 }
  if (distance <= 2) w1 += 0.12
  // R15: fresher legs take the carries — a tiring back cedes work to his backup.
  if (rbPool[0] && rbPool[1] && env?.fat) {
    const f1 = env.fat[rbPool[0].id] ?? 0
    const f2 = env.fat[rbPool[1].id] ?? 0
    w1 = Math.max(0.05, w1 * clamp(1 - (f1 - f2) * 2, 0.6, 1.4))
    w2 = Math.max(0.02, w2 * clamp(1 - (f2 - f1) * 2, 0.6, 1.4))
  }
  if (!rbPool[1]) { w1 += w2; w2 = 0 }
  if (!qbBase) { w2 += wq; wq = 0 }
  const wTot = w1 + w2 + wq || 1
  const roll = hash32(`${n}:${offId}`) / 4294967296
  let carrier = rbPool[0]
  if (committeePick) carrier = committeePick
  else if (roll < w1 / wTot) carrier = rbPool[0]
  else if (roll < (w1 + w2) / wTot && rbPool[1]) carrier = rbPool[1]
  else if (qbBase) carrier = qbBase
  else if (rbPool[1]) carrier = rbPool[1]
  // L12.10 B0: an occasional fullback dive on short yardage (deterministic; no rng).
  if (fbBase && distance <= 2 && hash32(`${n}:${offId}:fbdive`) % 100 < 5) carrier = fbBase
  // R15: now that the rep is decided, field the actual eleven (the repped back
  // replaces the nominal starter) and take every resolver group from it.
  const offEleven = fillToEleven(world, offId, offenseOnField(world, offId, concept, env?.qbOverride, carrier?.pos === 'RB' ? carrier.id : undefined, env?.fat, offCounts), OFF_FILL)
  const qb = offEleven.find((p) => p.pos === 'QB')
  const ol = offEleven.filter((p) => p.pos === 'OT' || p.pos === 'OG' || p.pos === 'C')
  const te = offEleven.find((p) => p.pos === 'TE')
  // L13: a user's 12 personnel keeps a second tight end in; his run block counts too.
  const te2 = userOffP === '12' ? offEleven.filter((p) => p.pos === 'TE')[1] : undefined
  const fb = offEleven.find((p) => p.pos === 'FB')
  const rb = offEleven.filter((p) => p.pos === 'RB')
  const onFieldOffIds = offEleven.map((p) => p.id)
  // ── J36 (FUTURES #36): the scouting-report game plan (run side) ─────────────
  // The offence aims the run at a flagged bad tackler (a genuine weakness buys a
  // little extra); the defence keys on a back who puts the ball on the ground.
  // Deterministic hashes; with J36 off this whole block is inert.
  let scoutTarget: string | undefined
  let scoutGain = 0
  let scoutFumbleId: string | undefined
  let scoutFumbleMult = 1
  if (J36_ON) {
    for (const t of j36TargetIds(world, defId, offId, planFor(defId, 'def'))) {
      const op = offEleven.find((x) => x.id === t.id)
      if (!op || t.tag !== 'rb-fumble') continue
      const edge = weaknessEdge(op, t.tag)
      if (edge > 0) { scoutFumbleId = op.id; scoutFumbleMult = 1 + edge * J36.fumbleScale }
      break
    }
    for (const t of j36TargetIds(world, offId, defId, planFor(offId, 'off'))) {
      const dp = defEleven.find((x) => x.id === t.id)
      if (!dp || !J36_COVER_TAGS.has(t.tag ?? '') || h01(`${n}:${offId}:j36runsteer`) >= J36.steerRate) continue
      const edge = weaknessEdge(dp, t.tag)
      if (edge > 0) { scoutTarget = dp.id; scoutGain = Math.round(edge * J36.runYardScale) }
      break
    }
  }
  const scoutFields: Pick<PlayOutcome, 'scoutTarget'> = scoutTarget ? { scoutTarget } : {}
  // R15: offence-vs-defence average in-game fatigue (difference only).
  const fatDiff = unitFatigue(env?.fat, [...dl, ...lbs, ...saf, ...cbs]) - unitFatigue(env?.fat, [qb, ...ol, ...rb, fb])
  const cA = carrier ? mkAttrs(carrier) : {}
  const cStyle = carrier ? styleProfile(carrier) : styleProfile({ traits: [''] } as Player)
  const cFit = carrier ? schemeFit(carrier, ocScheme, 'OFF') : 0.5

  // J8a: the point of attack and the chasers for this run (deterministic hashes).
  const gKey = `${n}:${defId}:gap`
  // J8a2: a misdirection / pulling-guard run raises the first-step bite chance.
  const misdirection = MISDIRECTION_RUNS.has(concept.name)
  const wOl = gapWeights(ol.length, gapIndex(gKey, ol.length), J8A.poaWeight, J8A.gapFade)
  const wDl = gapWeights(dl.length, gapIndex(gKey, dl.length), J8A.poaWeight, J8A.gapFade)
  const wLb = gapWeights(lbs.length, gapIndex(`${gKey}:lb`, lbs.length), J8A.poaWeight, J8A.gapFade)
  const poiOl = ol[gapIndex(gKey, ol.length)]
  const poiDl = dl[gapIndex(gKey, dl.length)]
  const poiLb = lbs[gapIndex(`${gKey}:lb`, lbs.length)]
  const runPursuers = J8A_ON ? pickPursuers(`${gKey}:chase`, lbs, saf, cbs) : []
  const runClose = J8A_ON ? chaseInfo(carrier, runPursuers, `${gKey}:chase`) : { edge: 0, headStart: 0, angle: 0, nP: 0 } as Chase
  // J8a2: the per-defender read loop. The man who read it right and filled the gap
  // is the read key; the alley filler is a hash-picked safety's own run support;
  // the front defenders who took a wrong first step (bit) are recorded for the
  // animation. All deterministic — no rng() draw.
  const readKey = J8A2_ON ? readKeyDefender(poiDl, poiLb, gKey, `${gKey}:lb`, misdirection) : undefined
  const alley = J8A2_ON ? alleyFill(saf, gKey) : { value: 0, player: undefined as Player | undefined }
  const biteIds = J8A2_ON
    ? [...dl, ...lbs].filter((p) => bitesAt(p, p.pos === 'LB' ? `${gKey}:lb` : gKey, misdirection)).map((p) => p.id)
    : []
  const readExtras = (p: Player, key: string): number => J8A2_ON ? readValue(p, key, misdirection) : 0
  // J8a ON: the gap matchup replaces the unit means — the point-of-attack man
  // carries most of the weight, the rest of the front a faded individual sum.
  const runBlock = J8A_ON
    ? gapValue(ol, wOl, (p) => { return eff(p, 'RBK') * 0.7 + eff(p, 'IMP') * 0.3 })
      + teRunBlock(te) + (te2 ? teRunBlock(te2) * 0.6 : 0) + clamp((poiOl ? masteryOffset(poiOl, means) : 0) * 0.06, -3, 3)
    : avg(ol.map((p) => (mkAttrs(p).RBK ?? 70) * 0.7 + (mkAttrs(p).IMP ?? 70) * 0.3)) + teRunBlock(te) + (te2 ? teRunBlock(te2) * 0.6 : 0) + clamp(masteryRelAvg(ol, means) * 0.06, -3, 3)
  const runDefBase = (J8A_ON
    ? gapValue(dl, wDl, (p) => {
        return eff(p, 'BSH') * 0.5 + eff(p, 'TAK') * 0.5 + readExtras(p, gKey) + (J8A2_ON ? J8A2.shedW * rmean(p.pos, 'STR', eff(p, 'STR')) : 0)
      })
    : avg(dl.map((p) => (mkAttrs(p).BSH ?? 70) * 0.5 + (mkAttrs(p).TAK ?? 70) * 0.5))) * dStyle.runFit
  // The live defensive plan moves the front: stacking the box stops the run,
  // a soft-zone light box gives a little back on the ground.
  const dp = planFor(defId, 'def')
  // G6 load the box: an extra 8% run defense, paid for by looser coverage.
  const boxMult = hasFix(env, defId, 'loadTheBox') ? 1.08 : 1
  const runDef = ((dp
    ? runDefBase * (1 + (dp.aggression - 0.5) * 0.06 - (dp.coverage <= 0 ? 0.03 : 0))
    : runDefBase) * boxMult)
    + (J8A_ON ? (poiDl ? rmean(poiDl.pos, 'STR', eff(poiDl, 'STR')) : 0) * 0.05 * E2_W : relAvg('STR', dl) * 0.05 * E2_W)
    // J8a2: the safety who fills the alley — his own run support (centred on the
    // safeties on the field, so the pick cannot drift the run-defence mean).
    + (J8A2_ON ? alley.value * J8A2.alleyW : 0)
    + (J8A_ON
      ? clamp((poiDl ? masteryOffset(poiDl, means) : 0) * 0.05, -3, 3) + clamp((runClose.chaser ? masteryOffset(runClose.chaser, means) : 0) * 0.03, -2, 2)
      : clamp(masteryRelAvg(dl, means) * 0.05, -3, 3) + clamp(masteryRelAvg([...cbs, ...saf], means) * 0.03, -2, 2))
  const lbsDef = J8A_ON
    ? gapValue(lbs, wLb, (p) => {
        return eff(p, 'TAK') * 0.6 + eff(p, 'PUR') * 0.4 + readExtras(p, `${gKey}:lb`) + (J8A2_ON ? lbStyle(p) : 0)
      })
      + gapValue(lbs, wLb, (p) => { return rmean(p.pos, 'PRC', eff(p, 'PRC')) * 0.16 + rmean(p.pos, 'BSH', eff(p, 'BSH')) * 0.16 + rmean(p.pos, 'STR', eff(p, 'STR')) * 0.08 + rmean(p.pos, 'ACC', eff(p, 'ACC')) * 0.08 + rmean(p.pos, 'AGI', eff(p, 'AGI')) * 0.08 }) * E2_W
      + clamp((poiLb ? masteryOffset(poiLb, means) : 0) * 0.05, -3, 3)
    : avg(lbs.map((p) => (mkAttrs(p).TAK ?? 70) * 0.6 + (mkAttrs(p).PUR ?? 70) * 0.4)) + lbRunExtras(lbs) * E2_W + clamp(masteryRelAvg(lbs, means) * 0.05, -3, 3)
  const elusiveness = carrier?.pos === 'QB'
    ? (cA.SPD ?? 70) * 0.5 + (cA.AGI ?? 70) * 0.4 + (cA.BCV ?? 70) * 0.1 + rmean('QB', 'RUN', cA.RUN ?? 70) * 0.4 * E2_W
    : (cA.BCV ?? 70) * 0.35 + (cA.JKM ?? 70) * 0.2 + (cA.TRK ?? 70) * 0.25 + (cA.SPD ?? 70) * 0.2 + rbElusivenessExtras(carrier?.pos, cA)

  // Real NFL run distribution, tilted by line + back vs. front seven, plus back style.
  const styleEdge = cStyle.power * 14 + cStyle.elusiveness * 10 + (cFit - 0.5) * 12
  // A pass-heavy offense runs against lighter boxes — make them pay on the ground.
  const offPassBiasRun = planFor(offId, 'off')?.passBias ?? 0
  const boxLight = Math.max(0, offPassBiasRun) * 1.8
  // G6 quick game: throwing it quick comes at the expense of the run game.
  const quickRunCost = hasFix(env, offId, 'quickGame') ? -2 : 0
  // G11 spyQB / J12 SPY: a quarterback spy erases the QB run/pass conflict on
  // those calls, and cuts any QB carry (the fastest LB is assigned to him, not to
  // the run fit).
  const spyPenalty = effDefMove === 'spyQB' && /QB Draw|RPO/.test(concept.name) ? (J12_ON ? J12.spyPress : 3) : 0
  const spyQbRun = J12_ON && effDefMove === 'spyQB' && carrier?.pos === 'QB' ? J12.spyRun : 0
  const edge = (runBlock - 72) * 0.7 + (elusiveness - 72) * 0.6 - (runDef - 72) * 0.5 - (lbsDef - 72) * 0.3 + styleEdge + ocEff.offEdge * 2 - dcEff.defEdge * 2 + masteryOffset(carrier, means) * 0.112 + MASTERY_ANCHOR_CARRIER + clutch * 1.4 + boxLight + quickRunCost + runEdgeBonus - spyPenalty - spyQbRun + (J8A_ON ? interiorShortStrength(ol, gKey) : olShortStrength(ol, distance)) + (J8A2_ON ? fbKick(fb, poiDl ?? poiLb) : fbLeadBlock(fb)) + (userOffP === '21' ? secondBackLeadBlock(rb[1]) : 0) + (call?.edge ?? 0) * 1.6 + (pEdge ? pEdge.run : 0)
    + (isQ4 ? (J8A_ON ? staRel([poiOl, carrier]) - staRel([poiDl, runClose.chaser]) : relAvg('STA', [qb, ...ol, carrier]) - relAvg('STA', [...dl, ...lbs, ...saf, ...cbs])) * 0.12 * E2_W : 0) + fatDiff * R15.fatRun
  const gains: string[] = []
  const runGain = sampleYards(rng, false, edge * 0.25 * (env?.wx?.runVarianceMult ?? 1), gains, yard, tier)
  // College front sevens miss more tackles; keep the curve but soften the negative tail.
  let gain = tier === 'FBS' && runGain < 0 ? Math.round(runGain * 0.7) : runGain
  // R2: trim the positive run tail to the 10-year NFL average (base constant only).
  if (gain > 0) gain = Math.round(gain * R2.runGainCal)
  if (distance <= 2) gain += (rng() < 0.35 ? 2 : 1) + Math.round(cStyle.power * 1.5)
  gain += rbAfterContact(carrier?.pos, cA, gain)
  // L12.10 B0: a fullback's lead block earns a little extra on the ground (centered; no rng).
  if (fb) {
    const fA = mkAttrs(fb)
    gain += Math.round(rmean('FB', 'RBK', fA.RBK ?? 70) * 0.06 + rmean('FB', 'IBL', fA.IBL ?? 70) * 0.04)
  }
  gain = clamp(gain, -10, 90)
  // J36: the flagged tackler's miss is worth a little extra ground.
  if (J36_ON && scoutGain) gain = clamp(gain + scoutGain, -10, 90)
  // R2: on a money down a runner lowers his shoulder to the marker.
  if (gain > 0 && env?.down === 3) gain += R2.moneyYards
  // L12 E2 / J8a: the long-run tail. OFF keeps the team DL/LB PUR+SPD mean cap;
  // ON replaces it with the individual chase multiplier (carrier speed + head
  // start vs the nearest hash-picked pursuer), centred so the mean tail holds.
  if (gain > 20) {
    const chaseF = J8A_ON
      ? (runClose.chaser ? chaseTailMult(runClose) : 1)
      : clamp(1 - runPursuit(dl, lbs) * 0.004 * E2_W, 0.55, 1.4)
    gain = 20 + Math.round((gain - 20) * chaseF * (1 + fatDiff * R15.fatBig))
  }
  // R2: the long-TD rate is tuned separately from the short run game.
  if (gain > 20) gain = Math.round(gain * R2.explosiveCal)
  // R2: near the goal line the compressed front can stand a runner up short.
  if (yard + gain >= 100 && gain > 0) gain = Math.round(gain * (1 - R2.rzRunDamp))
  // J8a: the open-field chase decides whether a long gain reaches the house. The
  // NFL chase-targets logit (edge = carrier mph − nearest pursuer mph, plus the
  // pursuer's head start, the pursuit angle, how many pursuers and the yards to
  // the goal) is his chance of NOT being run down. A faster carrier on a slower
  // pursuer keeps the score; a slower carrier is dragged down short. Red-zone
  // runs (yard >= 80) keep their existing tuned handling. No rng() draw, and OFF
  // leaves the gain untouched (byte-identical).
  if (J8A_ON && runClose.chaser && gain > 20 && yard < 80) {
    const ydToGoal = Math.max(0, 100 - yard - 20)
    const pTd = clamp(chaseTdProb(runClose, ydToGoal) * J8A.tdScale, 0, 1)
    if (h01(`${n}:${defId}:chasetd`) < pTd) gain = Math.max(gain, Math.min(99, 100 - yard))
    else gain = Math.min(gain, 100 - yard - 1)
  }
  // J3b: a would-be goal-line score is decided by the specific carrier against the
  // specific man at the point of attack (J8a's gap pick) — not an implicit average
  // defender. Only real plunges (ball spotted inside J3B.glYard) are affected; a
  // long breakaway is J8a's chase model above. The stand is a once-per-series rep:
  // downs 1-3 only and never once the ball is already on the 1 (J3B.glMaxDown /
  // glNoStuffYard), where the base short-yardage push owns the conversion.
  // `glPoaId` records the deciding defender for the animation, and `glStopId` only
  // when the stop actually fires. A stuffed carrier is stopped at the 1. No rng().
  let glStopId: string | undefined
  let glPoaId: string | undefined
  if (J3B_ON && gain > 0 && yard >= J3B.glYard && yard < J3B.glNoStuffYard &&
    (env?.down ?? 0) <= J3B.glMaxDown && yard + gain >= 100) {
    const glDefs = [poiDl, poiLb].filter((p): p is Player => !!p)
    if (glDefs.length) {
      glPoaId = glDefs[0].id
      if (h01(`${n}:${defId}:glstuff`) < glStuffChance(carrier, glDefs)) {
        gain = Math.min(gain, 100 - yard - 1)
        glStopId = glDefs[0].id
      }
    }
  }
  const fumbleMult = cohesionMult(env?.cohesionMeanOff, env?.cohesionOff, 0.4)
  // R16: the doorstep is the classic fumble spot — the pile is bigger and the ball
  // squirts out. Threshold only, so no rng() draw is added or removed.
  const glMult = yard >= R16.goalLineYard ? R16.goalLineMult : 1
  const fumble = rng() < R2.runFumbleBase * glMult * (1 - cStyle.power * 0.2) * rbCarrySecurity(carrier?.pos, cA) * fumbleMult * (env?.wx?.fumbleMult ?? 1) * (J36_ON && carrier?.id === scoutFumbleId ? scoutFumbleMult : 1)
  // R16: a proximity hash decides who falls on it; goal-line piles lean defence.
  const recovery = fumble ? fumbleRecovery(`${n}:${defId}:runrec`, yard >= R16.goalLineYard ? R16.goalLineOffRecover : R16.offRecover) : undefined
  const lost = fumble && recovery === 'def'
  // T2M: an outside run in the two-minute drill can reach the sideline. The
  // runner steps out, so there is no defender to credit and the clock stops.
  const oobP = oobRate(env, concept, carrier?.pos)
  const oob = oobP > 0 && !fumble && gain > -3 && yard + gain < 100 &&
    h01(`${n}:${offId}:oob`) < oobP
  // L12 S3: exactly one tackler, chosen by gain from a positional mix (no rng).
  // J6: while clock-realism is on, a runner forced out of bounds is still credited
  // to a defender, so the widened marker does not quietly remove a tackle attempt
  // from the league's missed-tackle denominator. OFF keeps the original (no credit).
  // R5: the attempt exists on every in-bounds run — including a fumble, where the
  // defender's contact is what jars the ball loose, so the forcer is the real
  // stopping tackler just as the strip/pass path credits its stopper. The forcer
  // only ever comes from the actual defence on the field.
  let tackler = oob && !CLOCK_ON ? undefined : runTackler(n, defId, gain, lbs, dl, saf, cbs, J8A_ON ? (gain > 20 ? runClose.chaser : (J8A2_ON ? readKey : poiDl ?? poiLb)) : undefined)
  // J8a: on a long gain the man who ran him down (the fastest of the hash-picked
  // pursuers) is the deciding player, so he takes the credit.
  if (J8A_ON && (!oob || CLOCK_ON) && gain > 20 && runClose.chaser) tackler = runClose.chaser.id
  let missedTackleIds: string[] | undefined
  let forcedMissedIds: string[] | undefined
  // R5: the first defender attempts the tackle. A deterministic miss adds yards
  // and a second defender finishes the play (no rng draw is added or removed).
  // A fumble is decided by contact, so its forcer is never charged a miss.
  if (tackler && !fumble && gain > -3) {
    const first = [...lbs, ...dl, ...saf, ...cbs].find((p) => p.id === tackler)
    if (hash32(`${n}:${defId}:runmt`) / 4294967296 < tackleMissChance(first, carrier, gain, false)) {
      missedTackleIds = [tackler]
      gain += missExtraYards(`${n}:${offId}:runmty`)
      // A miss that reaches the end zone has no finishing tackle to credit.
      tackler = yard + gain < 100 ? finishTackler(`${n}:${defId}:runmt2`, tackler, [lbs, dl, saf, cbs]) : undefined
      forcedMissedIds = carrier ? [carrier.id] : undefined
    }
  }
  // A run that reaches the end zone has no stopping tackler (matching the pass
  // path) — nobody is credited with a tackle in the end zone. A fumble the
  // defence recovers keeps its forcing tackler.
  if (!lost && yard + gain >= 100) tackler = undefined
  const isBig = gain >= 20
  const tackleIds = tackler ? [tackler] : []
  // R6: a lost fumble is returned for a touchdown ~7–8% of the time (hash, no rng).
  let fumbleTD = false
  let recoverer: Player | undefined
  if (lost) {
    const pool = [...lbs, ...dl, ...cbs, ...saf]
    recoverer = hashPick(pool, (p) => {
      const a = mkAttrs(p)
      return Math.max(1, (a.TAK ?? 70) * 0.6 + (a.PUR ?? 70) * 0.4)
    }, hash32(`${n}:${defId}:fumrec`))
    fumbleTD = h01(`${n}:${defId}:fumtd`) < 0.085
  }
  const baseResult = fumbleTD ? 'Fumble returned for a TOUCHDOWN!'
    : lost ? 'Fumble!'
      : fumble ? 'Fumble recovered by the offence'
        : isBig ? 'Big run!' : 'Rush'
  return {
    type: 'run', concept: concept.name, yards: gain,
    result: oob ? `${baseResult} (out of bounds)` : baseResult,
    turnover: lost, carrierId: carrier?.id, bigPlay: !lost && isBig,
    outOfBounds: oob || undefined,
    fumbleCause: fumble ? 'run' : undefined, fumbleRecoveredBy: recovery,
    // R5: the defender whose contact forced the ball loose (real actor on the 11).
    fumbleId: fumble ? tackler : undefined,
    goalLineFumble: fumble && yard >= R16.goalLineYard ? true : undefined,
    timeUsed: 30 + Math.floor(rng() * 14), qbId: undefined, tackleIds, missedTackleIds, forcedMissedIds,
    defTD: fumbleTD, returnerId: fumbleTD ? recoverer?.id : undefined, scorerId: fumbleTD ? recoverer?.id : undefined,
    // J8a2: what the animation needs — the defender whose read decided the run,
    // the defenders who bit on the misdirection, and the alley/gap filler.
    readKeyId: J8A2_ON ? readKey?.id : undefined,
    biteIds: J8A2_ON && biteIds.length ? biteIds : undefined,
    fillId: J8A2_ON ? alley.player?.id : undefined,
    ...(glPoaId ? { glPoaId } : {}),
    ...(glStopId ? { glStopId } : {}),
    onFieldOff: onFieldOffIds, onFieldDef: onFieldDefIds,
    ...scoutFields,
  }
}

/**
 * Kick mechanics shared by FG distance and missed-FG placement. The kicker
 * lines up 7 yards behind the LOS (holder), so a try from `yard` is
 * `100 - yard + 10 + FG_HOLDER_DEPTH` yards and the spot of the kick sits at
 * `yard - FG_HOLDER_DEPTH` from the kicking club's own goal line.
 */
const FG_HOLDER_DEPTH = 7

export function resolveSpecial(world: World, rng: Rng, offId: string, type: 'punt' | 'fg', yard: number, env?: SimEnv, margin = 0, n = 0, defId?: string, prStrategy: ReturnStrategy = 'default', puntStrategy: PuntStrategy = 'default'): PlayOutcome {
  if (type === 'fg') {
    const k = topGroup(world, offId, ['K'], 1)[0]
    const kA = k ? mkAttrs(k) : {}
    // 10 = end zone + goalposts, FG_HOLDER_DEPTH = holder behind the LOS.
    const dist = 100 - yard + 10 + FG_HOLDER_DEPTH
    // L12 E2: an aware kicker is steadier in a one-score fourth quarter.
    const late = (env?.qtr ?? 0) >= 4 && Math.abs(margin) <= 3
    const power = (kA.KPW ?? specMean('K', 'KPW', 78)) * 0.5 + (kA.KAC ?? specMean('K', 'KAC', 78)) * 0.5 + (late ? rmean('K', 'AWR', kA.AWR ?? 70) * 0.25 * E2_W : 0)
    // R17: the lone rng() draw is unchanged; a blocked kick is a per-play hash.
    // FUTURES #6: the weather layer supplies a bounded, centred make-probability
    // offset (sign already fixed: a headwind lowers the chance). Exactly 0 when
    // weather is off or absent, so the base sim is byte-identical.
    // FUTURES #8: a clutch kicker in late-and-close moves the make chance by up
    // to ±3 points. Exactly 0 outside late-and-close and when clutch is off, and
    // it rides the existing probability comparison (no new rng draw).
    const clutchFg = kickClutch(world, offId, { qtr: env?.qtr ?? 0, clock: env?.clock ?? 9999, margin })
    const made = rng() < fgProb(yard, power) + (env?.wx?.kickMakeAdd ?? 0) + clutchFg
    const blocked = h01(`${n}:${offId}:fgblock`) < R17.blockFg
    const good = made && !blocked
    return {
      type: 'fg', concept: `${dist}-yard field goal`, yards: 0,
      result: blocked ? `${dist}-yd FG is BLOCKED!` : good ? `${dist}-yd FG is good` : `${dist}-yd FG is no good`,
      turnover: !good, blockedKick: blocked || undefined, timeUsed: 5,
    }
  }
  const p = topGroup(world, offId, ['P'], 1)[0]
  const pA = p ? mkAttrs(p) : {}
  // FUTURES #4: the receiving club's punt-return strategy vs the punting club's
  // punt strategy. Every modifier is identity at the default strategies, so the
  // base sim is unchanged.
  const m = puntMods(prStrategy, puntStrategy)
  // R6: the existing distance formula is the GROSS punt; the return (or a
  // touchback) comes out of it, so the net lands at ~40–41 with ~9-yard
  // returns. The lone rng() draw is unchanged; the outcome is a per-play hash.
  const gross = 40 + Math.round(((pA.KPW ?? specMean('P', 'KPW', 80)) - 78) * 0.4 + rmean('P', 'AWR', pA.AWR ?? 70) * 0.1 * E2_W + rng() * 14 + (env?.wx?.puntAdd ?? 0) + m.gross)
  const key = `${n}:${offId}:punt`
  const u = h01(`${key}:kind`)
  const pr = defId ? clubReturners(world, defId).pr : undefined
  // R17: a blocked punt is a per-play hash, decided before the kind draw so the
  // existing kind distribution is untouched.
  const blocked = h01(`${key}:block`) < R17.blockPunt
  // The base kind shares: fairCatch .25 · downed .20 · touchback .08 · muff .01 ·
  // return .46. A return strategy (or a directional punt) trades the return share
  // with the fair-catch share; the muff share scales with the fumble multiplier.
  const fc = 0.25 + m.fcDelta
  const dn = fc + 0.2
  const tb = dn + 0.08
  const muffBase = getIndividual() ? J8D.muffPunt * carrySecurityOf(pr) : 0.01
  const mu = tb + muffBase * clamp(m.fumble, 0.4, 2)
  let kind: 'return' | 'fairCatch' | 'downed' | 'touchback' | 'muff' | 'blocked'
  if (blocked) kind = 'blocked'
  else if (u < fc) kind = 'fairCatch'
  else if (u < dn) kind = 'downed'
  else if (u < tb) kind = 'touchback'
  else if (u < mu) kind = 'muff'
  else kind = 'return'
  // A touchback only fits a punt that can actually reach the end zone.
  if (kind === 'touchback' && yard < 45) kind = 'downed'
  // A fair catch / downed punt that would cross the goal line becomes a touchback.
  if ((kind === 'fairCatch' || kind === 'downed') && yard + gross >= 100) kind = 'touchback'
  let retYds = 0
  let returnTD = false
  let returnerId: string | undefined
  if ((kind === 'return' || kind === 'fairCatch' || kind === 'muff') && pr) returnerId = pr.id
  if (kind === 'return' && pr) {
    // J8d: the deciding cover man on the play (specific player, not the unit mean).
    const covMan = getIndividual() && defId ? stCoverMan(world, defId, `${key}:cov`) : undefined
    const cov = defId ? (getIndividual() ? coverScoreOf(covMan) : coverageScore(world, defId)) : 72
    retYds = Math.max(0, returnYards(key, returnScore(pr), cov, 7 + m.base, 14 * m.spread))
    returnTD = h01(`${key}:td`) < (getIndividual() ? returnTdProb(J8D.tdPunt, pr, covMan) : 0.006)
    // A return touchdown is caught at the punt's landing spot and taken the rest
    // of the way, so its recorded yardage runs to the kicking team's goal line
    // (yard + gross yards back the way the punt came).
    if (returnTD) retYds = Math.max(retYds, clamp(yard + gross, 1, 99))
  }
  const spot =
    returnTD ? 100
      : kind === 'blocked' ? clamp(yard + 8 + Math.round(h01(`${key}:blkspot`) * 8), 1, 99)
        : kind === 'touchback' ? 80
          : kind === 'return' ? clamp(yard + gross - retYds, 1, 99)
            : kind === 'muff' ? clamp(yard + gross - Math.round(h01(`${key}:muff`) * 6), 1, 99)
              : clamp(yard + gross, 1, 99)
  const net = clamp(spot - yard, -20, 80)
  const name = shortName(pr?.name)
  const result =
    kind === 'blocked' ? `${gross}-yard punt, BLOCKED`
      : kind === 'touchback' ? `${gross}-yard punt, touchback`
        : kind === 'fairCatch' ? `${gross}-yard punt, fair catch by ${name}`
          : kind === 'muff' ? `${gross}-yard punt, muffed`
            : kind === 'downed' ? `${gross}-yard punt, downed`
              : `Punt ${gross} yds, returned ${retYds} by ${name}${returnTD ? ' TOUCHDOWN!' : ''}`
  return {
    type: 'punt', concept: 'Punt', yards: net, result, turnover: true, timeUsed: 6,
    returnerId, returnYards: kind === 'return' ? retYds : undefined, returnTD, returnKind: kind,
    blockedKick: kind === 'blocked' || undefined,
  }
}

function resolvePAT(world: World, rng: Rng, offId: string, n = 0, env?: SimEnv): PlayOutcome {
  const k = topGroup(world, offId, ['K'], 1)[0]
  const acc = k ? (mkAttrs(k).KAC ?? specMean('K', 'KAC', 84)) : specMean('K', 'KAC', 84)
  // R2: the real extra-point rate is ≈ 94% over the last decade.
  // R17: the lone rng() draw is unchanged; a block is a per-play hash and the
  // FUTURES #6 weather offset is exactly 0 when weather is off. The base carries
  // the block rate so the NET make rate (and the XP% band) is unchanged by blocking.
  const made = rng() < clamp(0.93 + (acc - 80) * 0.005 + R17.blockPat + (env?.wx?.kickMakeAdd ?? 0), 0.88, 0.99)
  const blocked = h01(`${n}:${offId}:patblock`) < R17.blockPat
  const good = made && !blocked
  return {
    type: 'pat', concept: 'Extra Point', yards: 0,
    result: blocked ? 'Extra point BLOCKED!' : good ? 'Extra point good' : 'Extra point MISSED',
    turnover: !good, blockedKick: blocked || undefined, timeUsed: 4,
  }
}

/** FUTURES #4: a club's special-teams plan (only the user's club can differ). */
function planForClub(s: GameState, clubId: string): SpecialTeamsPlan {
  const st = s.ctx?.special
  if (st && s.ctx && clubId === s.ctx.userTeamId) return normalizeSpecial(st)
  return DEFAULT_ST
}

/**
 * FUTURES #4: the user's non-deep kickoff calls — a squib, an onside or a
 * surprise onside. Deterministic per-play hashes only (no rng() draw). Mirrors
 * the AI onside's shape so the ball spot, clock and play log stay consistent.
 */
function resolveStKick(
  world: World, s: GameState, call: KickoffCall, base: string, kicking: string, receiving: string,
  kA: Record<string, number>, cov: number, alert: number, covMan?: Player,
): { scored: boolean } {
  const kAbbr = world.byId[kicking]?.abbr ?? kicking
  const rAbbr = world.byId[receiving]?.abbr ?? receiving
  // FUTURES #6: a wet ball is looser on a squib return (neutral with weather off).
  const stWx = wxFor(s, kicking === s.homeId)
  // A squib never reaches the end zone: no touchback, a short return. The
  // receiving club lands around its own 30–35.
  if (call === 'squib') {
    const returner = clubReturners(world, receiving).kr
    const cy = clamp(3 + Math.round(h01(`${base}:cy`) * 5), 0, 8)
    const ry = returner ? Math.max(0, returnYards(base, returnScore(returner), cov, 26, 8)) : 24
    const returnTD = !!returner && h01(`${base}:sqt`) < (getIndividual() ? returnTdProb(J8D.tdSquib, returner, covMan) : 0.001)
    const fumble = !returnTD && !!returner && h01(`${base}:fum`) < (getIndividual() ? J8D.fumSquib * carrySecurityOf(returner) * (stWx?.fumbleMult ?? 1) : 0.008 * (stWx?.fumbleMult ?? 1))
    const start = returnTD ? 100 : clamp(cy + ry, 1, 99)
    pushPlay(s, {
      type: 'kickoff', concept: 'Squib kick', yards: 0, kickCall: 'squib',
      result: returnTD ? `Squib kick returned ${ry} yds by ${shortName(returner?.name)} TOUCHDOWN!`
        : fumble ? `Squib kick returned ${ry} yds, fumbled`
          : `Squib kick — ${shortName(returner?.name) || rAbbr} returns to the ${start}`,
      startYard: start, endYard: returnTD ? 100 : start, down: null, distance: null, timeUsed: 5,
      returnerId: returner?.id, returnYards: returner ? ry : undefined, returnTD, returnKind: 'return',
      turnover: fumble, scorerId: returnTD ? returner?.id : undefined,
      fumbleCause: fumble ? 'kickoff' : undefined, fumbleRecoveredBy: fumble ? 'def' : undefined,
    })
    if (returnTD) {
      if (receiving === s.homeId) s.homeScore += 6
      else s.awayScore += 6
      statFor(s, receiving).points += 6
      return { scored: true }
    }
    if (fumble) {
      swapPossession(s)
      s.yard = clamp(100 - start, 1, 99)
    } else {
      s.yard = start
    }
    s.down = 1
    s.distance = 10
    return { scored: false }
  }
  // Onside / surprise onside: a kicker/coverage-scaled recovery chance; a scouted
  // club's surprise is cut. A failed surprise gives the receiving club the ball
  // near midfield — the risk that makes it a surprise.
  const surprise = call === 'surprise'
  const kpw = kA.KPW ?? specMean('K', 'KPW', 78)
  const kac = kA.KAC ?? specMean('K', 'KAC', 78)
  const recoverChance = surprise ? surpriseChance(kpw, kac, cov, alert) : onsideChance(kpw, kac, cov)
  const recovered = h01(`${base}:onsiderec`) < recoverChance
  if (recovered) {
    // The kicking club falls on its own kick and keeps the ball near midfield.
    swapPossession(s)
    s.yard = clamp(42 + Math.round(h01(`${base}:onsidespot`) * 10), 1, 99)
  } else {
    s.yard = surprise
      ? clamp(52 + Math.round(h01(`${base}:surspot`) * 8), 1, 99)
      : clamp(44 + Math.round(h01(`${base}:onsiderecspot`) * 8), 1, 99)
  }
  s.down = 1
  s.distance = 10
  const label = surprise ? 'Surprise onside' : 'Onside kick'
  pushPlay(s, {
    type: 'kickoff', concept: surprise ? 'Surprise onside kick' : 'Onside kick', yards: 0,
    kickCall: surprise ? 'surprise' : 'onside',
    stAttempt: { club: kicking, kind: surprise ? 'surprise' : 'onside' },
    result: recovered ? `${label} recovered by ${kAbbr}!` : `${label}, recovered by ${rAbbr}`,
    // FUTURES #4: a kickoff play logs no down & distance (the game state keeps
    // s.down/s.distance at 1 & 10), exactly like the squib and normal kickoffs.
    startYard: s.yard, endYard: s.yard, down: null, distance: null, timeUsed: 5,
    returnKind: 'return', turnover: !recovered,
  })
  return { scored: false }
}

/**
 * R6: resolve a kickoff (opening kick, after a score, or a post-safety free
 * kick). `s.offId` is the receiving club and `s.defId` the kicking club. Whether
 * it is a touchback or a return is decided from the kicker's KPW and a per-play
 * hash; a return sets the receiving club's start spot to the return's end. Rare
 * return touchdowns and lost fumbles are handled here. No rng() draw is added or
 * removed.
 *
 * FUTURES #4: when the user's club kicks off it may call the kick through the
 * existing `decide()` moment system (deep / squib / onside / surprise), and both
 * clubs' kick + return strategies bend the same hashes. Deep + default is
 * byte-identical to the pre-feature sim.
 */
function resolveKickoff(world: World, s: GameState): { scored: boolean; moment?: boolean } {
  const receiving = s.offId
  const kicking = s.defId
  const k = topGroup(world, kicking, ['K'], 1)[0]
  const kA = k ? mkAttrs(k) : {}
  const base = `${s.n}:${kicking}:ko`
  const koMargin = kicking === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore
  const desperate = s.qtr === 4 && s.clock <= 150 && koMargin < 0 && koMargin >= -10
  // J8d: the deciding cover man on this kick (specific player, not the unit mean).
  const covMan = getIndividual() ? stCoverMan(world, kicking, `${base}:cov`) : undefined
  const cov = getIndividual() ? coverScoreOf(covMan) : coverageScore(world, kicking)
  const mem = world.stMemory && world.stMemory.season === world.season ? world.stMemory.teams : undefined
  const alert = alertness(mem?.[kicking])
  // FUTURES #6: a kick into the wind carries shorter (fewer touchbacks) and a wet
  // ball is looser. Centred — exactly neutral when weather is off or absent.
  const koWx = wxFor(s, kicking === s.homeId)

  // FUTURES #4: the user calls their own kickoffs. The moment sits before any
  // kickoff hash (and before any rng), exactly like the other decision points.
  const isUserKick = !!s.ctx && kicking === s.ctx.userTeamId
  const late = s.qtr === 4 && Math.abs(koMargin) <= 10
  let call: KickoffCall = 'deep'
  if (isUserKick && late) {
    const options: MomentOption[] = [
      { id: 'deep', label: 'Deep kick', hint: 'Kick it deep — the safe call.' },
      { id: 'squib', label: 'Squib kick', hint: 'No touchback; a short return, ball near their 30.' },
      { id: 'onside', label: `Onside kick (≈${Math.round(onsideChance(kA.KPW ?? specMean('K', 'KPW', 78), kA.KAC ?? specMean('K', 'KAC', 78), cov) * 100)}%)`, hint: 'A long shot at keeping the ball.' },
      ...(!desperate ? [{ id: 'surprise', label: `Surprise onside (≈${Math.round(surpriseChance(kA.KPW ?? specMean('K', 'KPW', 78), kA.KAC ?? specMean('K', 'KAC', 78), cov, alert) * 100)}%)`, hint: 'A real shot — but a miss leaves them near midfield.' }] : []),
    ]
    const choice = decide(s, {
      kind: 'kickoff', side: 'hc', teamId: kicking, qtr: s.qtr, clock: fmtClock(s.clock), down: null, distance: null,
      yard: 35, title: desperate ? 'Kickoff — you need the ball' : 'Kickoff', margin: koMargin,
      options, defaultId: desperate ? 'onside' : 'deep', ask: late,
      staffRead: late ? (desperate ? 'You need the ball — onside.' : 'Kick deep unless you need a possession.') : undefined,
    })
    if (choice === null) return { scored: false, moment: true }
    call = choice as KickoffCall
  }

  if (call === 'squib' || call === 'onside' || call === 'surprise') {
    return resolveStKick(world, s, call, base, kicking, receiving, kA, cov, alert, covMan)
  }

  // R17: a desperate, trailing AI club can still try an onside kick. FUTURES #4:
  // a scouted club's trick is a little less likely to be tried. The per-play hash
  // is unchanged; the memory is empty on a fresh world, so the base sim is exact.
  const kickST = planForClub(s, kicking)
  const recST = planForClub(s, receiving)
  if (!isUserKick && desperate && h01(`${base}:onside`) < R17.onsideRate * (1 - 0.5 * alert)) {
    const recovered = h01(`${base}:onsiderec`) < R17.onsideRecover
    const kAbbr = world.byId[kicking]?.abbr ?? kicking
    const rAbbr = world.byId[receiving]?.abbr ?? receiving
    if (recovered) {
      // The kicking club fell on its own kick and keeps the ball near midfield.
      swapPossession(s)
      s.yard = clamp(42 + Math.round(h01(`${base}:onsidespot`) * 10), 1, 99)
    } else {
      // The receiving club falls on it — good field position, no return.
      s.yard = clamp(44 + Math.round(h01(`${base}:onsiderecspot`) * 8), 1, 99)
    }
    s.down = 1
    s.distance = 10
    pushPlay(s, {
      type: 'kickoff', concept: 'Onside kick', yards: 0,
      kickCall: 'onside', stAttempt: { club: kicking, kind: 'onside' },
      result: recovered ? `Onside kick recovered by ${kAbbr}!` : `Onside kick, recovered by ${rAbbr}`,
      // FUTURES #4: log the AI onside like every other kickoff (no down & distance).
      startYard: s.yard, endYard: s.yard, down: null, distance: null, timeUsed: 5,
      returnKind: 'return', turnover: !recovered,
    })
    return { scored: false }
  }

  // FUTURES #4: the kick + return strategies bend the same hashes. Every
  // modifier is 0/1 at the default strategies, so this is identity by default.
  const rm = kickReturnMods(recST.kr, kickST.kickoff)
  const pTb = clamp(0.47 + ((kA.KPW ?? specMean('K', 'KPW', 80)) - 78) * 0.006 + rm.tb + (koWx?.kickoffAdd ?? 0) * WX.kickoffTbPerYd, 0.42, 0.85)
  const returner = clubReturners(world, receiving).kr
  const touchback = !returner || h01(`${base}:tb`) < pTb
  let retYds = 0
  let returnTD = false
  let fumble = false
  let catchYard = 0
  if (!touchback && returner) {
    catchYard = clamp(2 + Math.round(h01(`${base}:cy`) * 7), 0, 9)
    retYds = Math.max(0, returnYards(base, returnScore(returner), cov, 20.5 + rm.base, 26 * rm.spread))
    returnTD = h01(`${base}:td`) < (getIndividual() ? returnTdProb(J8D.tdKick, returner, covMan) : 0.003)
    fumble = !returnTD && h01(`${base}:fum`) < (getIndividual() ? J8D.fumKick * carrySecurityOf(returner) * rm.fumble * (koWx?.fumbleMult ?? 1) : 0.005 * rm.fumble * (koWx?.fumbleMult ?? 1))
    if (returnTD) retYds = 100 - catchYard
  }
  const start = touchback ? R2.kickoffYard : returnTD ? 100 : clamp(catchYard + retYds, 1, 99)
  const rname = shortName(returner?.name)
  const kickAbbr = world.byId[kicking]?.abbr ?? kicking
  const result = touchback
    ? 'Touchback'
    : returnTD
      ? `Kickoff returned ${retYds} yds by ${rname} TOUCHDOWN!`
      : fumble
        ? `Kickoff returned ${retYds} yds, fumbled, recovered by ${kickAbbr}`
        : `Kickoff returned ${retYds} yds by ${rname}`
  pushPlay(s, {
    type: 'kickoff', concept: 'Kickoff', yards: 0, result,
    startYard: start, endYard: returnTD ? 100 : start, down: null, distance: null, timeUsed: 5,
    returnerId: touchback ? undefined : returner?.id,
    returnYards: touchback ? undefined : retYds,
    returnTD, returnKind: touchback ? 'touchback' : 'return', turnover: fumble,
    scorerId: returnTD ? returner?.id : undefined,
    fumbleCause: fumble ? 'kickoff' : undefined, fumbleRecoveredBy: fumble ? 'def' : undefined,
  })
  if (returnTD) {
    if (receiving === s.homeId) s.homeScore += 6
    else s.awayScore += 6
    statFor(s, receiving).points += 6
    return { scored: true }
  }
  if (fumble) {
    // The kicking club recovers at the return spot and takes over on offense.
    swapPossession(s)
    s.yard = clamp(100 - start, 1, 99)
    s.down = 1
    s.distance = 10
    return { scored: false }
  }
  s.yard = start
  s.down = 1
  s.distance = 10
  return { scored: false }
}

/**
 * backlog126: restart after a field-goal attempt. A make kicks off for real
 * (a touchback, a return, or the rare return score); a miss hands the ball to
 * the defense at the spot of the kick — the holder sits FG_HOLDER_DEPTH yards
 * behind the LOS, toward the kicking club's own goal — and never a kickoff.
 * NFL rule: the defense takes over at the spot of the kick, or its own 20 if
 * that spot is inside the 20 (i.e. whichever is farther from the defense's
 * goal). `s.yard` is still the kicking club's LOS here, so read it before
 * swapping. No rng is drawn.
 */
function restartAfterFieldGoal(s: GameState, good: boolean): void {
  // Spot of the kick (holder), measured from the kicking club's own goal line.
  const kickSpot = s.yard - FG_HOLDER_DEPTH
  swapPossession(s)
  s.down = 1
  s.distance = 10
  if (good) {
    // FUTURES #4: kick off in the kickoff phase, so a late made FG can raise the
    // user's kickoff call (onside / squib) like a touchdown does.
    s.phase = 'kickoff'
    return
  }
  s.yard = clamp(100 - kickSpot, 20, 99)
}

// ── Game driver ───────────────────────────────────────────────────────────────
function fmtClock(sec: number) {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ── Resumable game state (L10 G1) ─────────────────────────────────────────────
export type MomentKind = 'fourth' | 'two' | 'call' | 'defCall' | 'halftime' | 'twoMinute' | 'clock' | 'qbChange' | 'kickoff' | 'challenge'
/** Which side a moment belongs to (Design rule 5). 'hc' = head-coach only. */
export type MomentSide = 'off' | 'def' | 'both' | 'hc'
/** G7 two-minute offensive mode for the current possession. */
export type TwoMinMode = 'hurry' | 'normal' | 'protect' | 'fgRange'
export interface MomentOption { id: string; label: string; hint: string }
export interface Moment {
  id: string // `${kind}-${playIndex}` — unique within a game
  kind: MomentKind
  teamId: string // the user's club
  qtr: number
  clock: string
  down: number | null
  distance: number | null
  yard: number
  us: number // score from the user's side
  them: number
  title: string // e.g. "4th & 2 at their 38"
  options: MomentOption[]
  defaultId: string // the standing order's answer
  staffRead?: string
}
export interface DecisionLog {
  momentId: string
  kind: MomentKind
  choiceId: string
  defaultId: string
  source: 'user' | 'standing'
  qtr: number
  yard: number
  down: number | null
  distance: number | null
  margin: number
  outcome?: string
  ep?: number
  /** FUTURES #5: the replay read (0–1) on a `challenge` decision, for the film grade. */
  read?: number
  /** L10 G9: the opponent's call on a `call`/`defCall` snap, for the film grade. */
  vs?: string
}
export interface GameCtx {
  userTeamId: string
  scope: 'off' | 'def' | 'both' | 'hc' // 'hc' = head coach; 'off'/'def'/'both' = coordinator focus
  callSheet: CallSheet
  /** G10: the user's opening script (concept names, in order). */
  script?: string[]
  /** G10: 1.5 when the club ran a full install this season. */
  scriptEdgeMult?: number
  /** G8: the opponent film read purchased this week. */
  oppRead?: { week: number; oppId: string; sharp: boolean }
  /** L10 G11: the user's matchup assignments for this game. */
  matchups?: MatchupSet
  /** L10 G12: the user's workload / rotation settings for this game. */
  usage?: UsageSet
  /** L13: the user's personnel packages for this game. */
  personnel?: PersonnelSet
  /** L12.6: call every snap on this side (coached games only); unset = key moments only. */
  callAll?: 'off' | 'def' | 'both'
  /** FUTURES #4: the user's special-teams plan (kicks + return strategies). */
  special?: SpecialTeamsPlan
}
export interface GameState {
  rng: Rng
  plays: Play[]
  homeScore: number
  awayScore: number
  stats: { home: TeamGameStats; away: TeamGameStats }
  qtr: number
  clock: number
  offId: string
  defId: string
  yard: number
  down: number
  distance: number
  n: number
  phase: 'play' | 'try' | 'halftime' | 'kickoff'
  pending: Moment | null
  answers: Record<string, string>
  /** Moments answered on standing orders (Sim to end / fast sim) rather than by the user. */
  autoAnswered?: Record<string, true>
  momentsUsed: number
  kindUsed: Partial<Record<MomentKind, number>>
  decisions: DecisionLog[]
  done: boolean
  ctx?: GameCtx
  homeId: string
  awayId: string
  tier: 'NFL' | 'FBS'
  pace: number
  passAdj: number
  // ── L10 G6/G7 ──────────────────────────────────────────────────────────────
  /** Timeouts left per club, reset to 3 at halftime. */
  timeouts: Record<string, number>
  /** Timeouts spent per club (probe/clock reporting). */
  timeoutsUsed: Record<string, number>
  /** Halftime fixes per club, read by the resolvers. */
  adjust: Record<string, string[]>
  /** G6: halftime QB change override (teamId → backup playerId). */
  qbOverride: Record<string, string>
  /** G7: two-minute mode for the current possession. */
  twoMinMode: TwoMinMode | null
  /** Whether this possession has already chosen a two-minute mode. */
  twoMinChecked: boolean
  /** G7: the user's clock decision per club ('use' | 'save'). */
  clockMode: Record<string, 'use' | 'save' | undefined>
  /** Whether the one clock moment for this game has been resolved. */
  clockChecked: boolean
  /** T2M: a manual timeout (the dock button) waiting for the next dead ball. */
  manualTimeout?: string
  // ── L10 G8/G9/G10 ─────────────────────────────────────────────────────────
  /** Standing concepts per call moment (so a paused game draws the RNG once). */
  callConcepts: Record<string, Concept>
  /** G10: how many of the script's snaps have been used. */
  scriptUsed: number
  /** G10: the class of the last scripted snap, for predictability. */
  scriptLastClass: OffClass | null
  /** G10: consecutive scripted snaps of the same class. */
  scriptClassRun: number
  /** G10: which user offensive possession we're on (edge only on the first). */
  userDrive: number
  /** Moments already written to the decision log, so a re-run never double-logs. */
  logged: Record<string, true>
  /** Halftime bookkeeping so rng only draws once per phase. */
  halfAdjustDone: boolean
  qbChangeChecked: boolean
  /** Probe counter: possessions that ran a two-minute mode. */
  twoMinDrives: number
  /** L12.9 K1: per-side unit cohesion for the two clubs in this game (0-1). */
  cohesion?: Record<string, { off: number; def: number }>
  /** L12.9 K1: league mean cohesion per side, computed once at kickoff. */
  cohesionMean?: { off: number; def: number }
  /** L12.13 M3: league mean mastery per position group, fixed for the game. */
  mastery: MasteryMeans
  /** L12.13 M3: per-team mental-error multiplier for penalty thresholds. */
  mental: Record<string, { off: number; def: number }>
  // ── R15: in-game stamina, snap counts and rotation ─────────────────────────
  /** In-game fatigue per player (0 fresh → ~1 spent). */
  fat: Record<string, number>
  /** Scrimmage snaps played per player. */
  snaps: Record<string, number>
  /** Scrimmage snaps run by each club's offence / defence (the snap-% denominator). */
  snapSide: Record<string, { off: number; def: number }>
  /**
   * Backlog 149 follow-up: the K/P each club takes the field with, fixed at
   * kickoff so the box score credits the specialists the sim actually used.
   */
  specialists: Record<string, { K?: string; P?: string }>
  /** Scrimmage snaps on the current possession (for the long-drive fatigue bonus). */
  driveSnaps: number
  /** Player index for O(1) lookups while charging snaps (not persisted). */
  pIndex: Map<string, Player>
  // ── R17: kicking realism ───────────────────────────────────────────────────
  /** Wind for the kick hook (mph, positive into the kicker's face). 0 = calm. */
  wind: number
  /** FUTURES #6: the conditions this game is played in (pure, never saved). */
  weather?: GameWeather
  // ── FUTURES #5: replay review ──────────────────────────────────────────────
  /** A challenge-domain ruling awaiting the hurt club's decision (C2). */
  review?: PendingReview | null
  /** Red-flag challenges left / won / lost per club. Not reset at halftime. */
  challenges?: Record<string, ChallengeState>
}

const MAX_PLAYS = 210

function statFor(s: GameState, id: string) {
  return id === s.homeId ? s.stats.home : s.stats.away
}

function swapPossession(s: GameState) {
  const t = s.offId
  s.offId = s.defId
  s.defId = t
  // A two-minute mode only lasts as long as the possession that chose it.
  s.twoMinMode = null
  s.twoMinChecked = false
  // R15: a change of possession rests the tiring bodies and starts a new drive.
  restFatigue(s, R15.restDrive)
  s.driveSnaps = 0
  // G10: the opening script's edge only applies on the user's first drive.
  if (s.ctx && s.offId === s.ctx.userTeamId) s.userDrive += 1
}

/** R18: how much a point of coach tempo bends the AI's game-clock burn. */
const R18_TEMPO_TIME = 0.06

function baseTimeScale(world: World, id: string): number {
  const p = planFor(id, 'off')
  if (p) return planEffects(p, false).timeScale
  // R18: AI clubs play at their coach's tempo — a small, league-centered shift
  // (mean tempo ≈ 0) so calibration stays put while identities differ.
  return clamp(1 - coachTendency(world, id).tempo * R18_TEMPO_TIME, 0.94, 1.06)
}

function pushPlay(s: GameState, p: Omit<Play, 'n' | 'qtr' | 'clock' | 'offId' | 'defId' | 'homeScore' | 'awayScore'>) {
  s.plays.push({ n: s.n++, qtr: s.qtr, clock: fmtClock(s.clock), offId: s.offId, defId: s.defId, homeScore: s.homeScore, awayScore: s.awayScore, ...p })
}

// ── Decision points (L10 G2) ──────────────────────────────────────────────────
const MOMENT_CAPS: Record<MomentKind, number> = {
  fourth: 3, two: 2, call: 2, defCall: 2, twoMinute: 2, clock: 1, halftime: 1, qbChange: 1, kickoff: 2, challenge: 3,
}
/** Cap on the big moments. Play calls (call/defCall) have their own caps and do
 *  not count here, so they can never crowd out halftime or a late 2-point try. */
const TOTAL_MOMENT_CAP = 8
const isPlayCall = (k: MomentKind) => k === 'call' || k === 'defCall'
/** Moments exempt from the total cap: play calls and (FUTURES #5) red flags, so a
 *  challenge can never crowd out halftime or a late 2-point try. */
const capExempt = (k: MomentKind) => isPlayCall(k) || k === 'challenge'

interface DecisionSpec {
  kind: MomentKind
  /** Which side owns this moment (Design rule 5). */
  side: MomentSide
  teamId: string
  qtr: number
  clock: string
  down: number | null
  distance: number | null
  yard: number
  title: string
  options: MomentOption[]
  defaultId: string
  staffRead?: string
  /** Situational condition: only then is the user actually asked. */
  ask: boolean
  margin: number
  ep?: number
}

/** Design rule 5: does a rung's scope let it answer a moment on this side? */
function scopeAllows(scope: GameCtx['scope'], side: MomentSide): boolean {
  if (scope === 'hc') return true
  if (side === 'hc') return false
  if (scope === 'off') return side === 'off'
  if (scope === 'def') return side === 'def'
  return side === 'off' || side === 'def' || side === 'both'
}

function logDecision(s: GameState, id: string, spec: DecisionSpec, choiceId: string, source: 'user' | 'standing') {
  s.decisions.push({
    momentId: id, kind: spec.kind, choiceId, defaultId: spec.defaultId, source,
    qtr: spec.qtr, yard: spec.yard, down: spec.down, distance: spec.distance, margin: spec.margin, ep: spec.ep,
  })
}

/**
 * Log a decision at most once. A step can raise a second moment after the
 * first (a `call` after a 4th-down `go`), and on resume the whole step re-runs —
 * the guard keeps the log honest without touching the RNG stream.
 */
function logOnce(s: GameState, id: string, spec: DecisionSpec, choiceId: string, source: 'user' | 'standing') {
  if (s.logged[id]) return
  s.logged[id] = true
  logDecision(s, id, spec, choiceId, source)
}

/**
 * Resolve a decision point that sits at the start of a step, before any rng
 * draw. Returns the choice, or null after setting `s.pending` (step returns
 * immediately, so the RNG stream is untouched until the user answers).
 */
function decide(s: GameState, spec: DecisionSpec): string | null {
  const id = `${spec.kind}-${s.plays.length}`
  const isUser = !!s.ctx && spec.teamId === s.ctx.userTeamId
  if (isUser && s.answers[id]) {
    logOnce(s, id, spec, s.answers[id], s.autoAnswered?.[id] ? 'standing' : 'user')
    return s.answers[id]
  }
  // L12.6: in "call every play" mode the per-game cap on play calls is lifted
  // for the side you chose — every snap asks.
  const callAll = s.ctx?.callAll
  const uncapped = (spec.kind === 'call' && (callAll === 'off' || callAll === 'both')) ||
    (spec.kind === 'defCall' && (callAll === 'def' || callAll === 'both'))
  const canAsk = isUser && scopeAllows(s.ctx!.scope, spec.side) && spec.ask &&
    (capExempt(spec.kind) || s.momentsUsed < TOTAL_MOMENT_CAP) && (uncapped || (s.kindUsed[spec.kind] ?? 0) < MOMENT_CAPS[spec.kind])
  if (canAsk) {
    const us = spec.teamId === s.homeId ? s.homeScore : s.awayScore
    const them = spec.teamId === s.homeId ? s.awayScore : s.homeScore
    s.pending = {
      id, kind: spec.kind, teamId: spec.teamId, qtr: spec.qtr, clock: spec.clock,
      down: spec.down, distance: spec.distance, yard: spec.yard, us, them,
      title: spec.title, options: spec.options, defaultId: spec.defaultId, staffRead: spec.staffRead,
    }
    if (!capExempt(spec.kind)) s.momentsUsed += 1
    s.kindUsed[spec.kind] = (s.kindUsed[spec.kind] ?? 0) + 1
    return null
  }
  if (isUser) logOnce(s, id, spec, spec.defaultId, 'standing')
  return spec.defaultId
}

function fmtEV(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`
}

/**
 * 4th-down decision for the offense. Must be called before any rng draw in the
 * step; returns null when the user's moment is pending.
 */
function kickPowerOf(world: World, teamId: string): number {
  const k = topGroup(world, teamId, ['K'], 1)[0]
  const kA = k ? mkAttrs(k) : {}
  return (kA.KPW ?? specMean('K', 'KPW', 78)) * 0.5 + (kA.KAC ?? specMean('K', 'KAC', 78)) * 0.5
}

function chooseFourth(world: World, s: GameState): 'go' | 'fg' | 'punt' | 'fake' | null {
  const isUser = !!s.ctx && s.offId === s.ctx.userTeamId
  const sheet = isUser ? s.ctx!.callSheet : aiCallSheet(world, s.offId)
  const kickPower = kickPowerOf(world, s.offId)
  // R17: the offered FG range scales with the kicker's power (the make model's
  // range sits 3 yards shorter, matching the pre-R17 option/EV gap).
  // FUTURES #6: a kick into the wind has a shorter effective range (0 when off).
  const fourthWx = wxFor(s, s.offId === s.homeId)
  const rangeAdj = fourthWx?.kickRangeYds ?? 0
  const inFgRange = s.yard >= fgRangeYard(kickPower) - 3 + rangeAdj
  const margin = s.offId === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore
  const sit: Situation = { yard: s.yard, down: 4, distance: s.distance, qtr: s.qtr, clockSec: s.clock, margin }
  const ev = fourthDownEV(sit, kickPower)
  let chosen = fourthDownChoice(sheet.fourth, sit, kickPower)
  // J2: the actual call adds a per-play hash dither on the style's go
  // propensity, so the league go-rate matches the NFL cells instead of every
  // coach of a style making the identical call. Deterministic (no rng draw) and
  // skipped for the user's own club (whose standing recommendation stays the
  // deterministic fourthDownChoice) and for the last-two-minute Q4 override.
  const q4Override = sit.qtr === 4 && sit.clockSec <= 120 && sit.margin <= -1 && sit.margin >= -8
  if (getFourthRetune() && !isUser && !q4Override) {
    const pGo = fourthGoPropensity(sheet.fourth, sit, kickPower)
    // When the retuned model declines to go, the kick fallback is EV-ranked
    // exactly as the OFF path ranks it: range alone would add long FGs the old
    // rule correctly punted (that inflated FG attempts and scoring).
    const kick: 'fg' | 'punt' = ev.fg != null && ev.fg >= ev.punt ? 'fg' : 'punt'
    chosen = h01(`${s.n}:${s.offId}:4th`) < pGo ? 'go' : kick
  }
  // R17: a fake is a rare, situational surprise from 4th & short in plus
  // territory — likelier for a trailing or aggressive club. In this sim the EV
  // already says "go" there, so the fake is that call executed from a kicking
  // look (a surprise). AI only; the user gets the same call as a moment option
  // below. A per-play hash, no rng draw.
  const fakeEligible = s.distance <= 2 && s.yard >= 45 && s.yard <= 68
  if (!isUser && fakeEligible && chosen === 'go') {
    const urgency = margin < 0 ? 1.7 : margin === 0 ? 1 : 0.5
    const styleMult = sheet.fourth === 'aggressive' ? 1.6 : sheet.fourth === 'conservative' ? 0.4 : 1
    // FUTURES #4: a scouted club is less inclined to try the trick again. The
    // memory is empty on a fresh world, so the base rate (and calibration) is exact.
    const mem = world.stMemory && world.stMemory.season === world.season ? world.stMemory.teams : undefined
    const alert = alertness(mem?.[s.offId])
    if (h01(`${s.n}:${s.offId}:fake`) < R17.fakeRate * urgency * styleMult * (1 - 0.5 * alert)) return 'fake'
  }
  const defaultId = inFgRange ? chosen : chosen === 'fg' ? 'punt' : chosen
  const options: MomentOption[] = [
    { id: 'go', label: 'Go for it', hint: 'One snap to keep the drive alive.' },
    ...(inFgRange ? [{ id: 'fg', label: `Kick the ${100 - s.yard + 17}-yd FG`, hint: 'Take the points.' }] : []),
    { id: 'punt', label: 'Punt', hint: 'Trade the ball for field position.' },
    ...(isUser && fakeEligible ? [{ id: 'fake', label: inFgRange ? 'Fake FG' : 'Fake punt', hint: 'Snap it to the up-back — a surprise run or pass.' }] : []),
  ]
  const yardText = s.yard >= 50 ? `their ${100 - s.yard}` : `your ${s.yard}`
  const ask = (s.yard >= 35 && s.distance <= 5) || s.yard >= 52
  const choice = decide(s, {
    kind: 'fourth', side: 'hc', teamId: s.offId, qtr: s.qtr, clock: fmtClock(s.clock), down: 4, distance: s.distance,
    yard: s.yard, title: `4th & ${s.distance} at ${yardText}`, options, defaultId,
    staffRead: `Staff EV — Go ${fmtEV(ev.go)} · FG ${ev.fg == null ? '—' : fmtEV(ev.fg)} · Punt ${fmtEV(ev.punt)}`,
    ask, margin, ep: ev.go,
  })
  if (choice == null) return null
  return choice as 'go' | 'fg' | 'punt' | 'fake'
}

// ── L10 G6: halftime adjustments + QB change ─────────────────────────────────
type FixId = 'maxProtect' | 'quickGame' | 'thirdDownHeat' | 'loadTheBox' | 'twoDeep'
interface FixMeta { side: 'off' | 'def'; label: string; hint: string }
const FIX_META: Record<FixId | 'stayCourse', FixMeta> = {
  maxProtect: { side: 'off', label: 'Max protect', hint: 'Sacks ×0.6; deep concepts lose a target (completion −3%).' },
  quickGame: { side: 'off', label: 'Quick game', hint: 'Pass rate +10%, short concepts +3% completion; run edge −2.' },
  thirdDownHeat: { side: 'def', label: 'Third-down heat', hint: 'Blitz +15% on their 3rd downs; big-play risk ×1.1 there.' },
  loadTheBox: { side: 'def', label: 'Load the box', hint: 'Run defense ×1.08; coverage ×0.96.' },
  twoDeep: { side: 'def', label: 'Two-deep', hint: 'Big plays allowed ×0.85; underneath completion ×1.04.' },
  stayCourse: { side: 'off', label: 'Stay the course', hint: 'No change — trust the first-half plan.' },
}
const FIX_ORDER: FixId[] = ['maxProtect', 'quickGame', 'thirdDownHeat', 'loadTheBox', 'twoDeep']

interface Diagnosis { fix: FixId; side: 'off' | 'def'; severity: number; note: string }

/** First-half diagnostics for one club, most severe first (G6). */
function diagnose(plays: Play[], teamId: string): Diagnosis[] {
  let sacksTaken = 0
  let rushAtt = 0
  let rushYds = 0
  let opp3Att = 0
  let opp3Conv = 0
  let oppRushAtt = 0
  let oppRushYds = 0
  let explosives = 0
  for (const p of plays) {
    if (p.offId === teamId) {
      if (isSack(p)) sacksTaken += 1
      else if (p.type === 'run') { rushAtt += 1; rushYds += Math.max(0, p.yards) }
    } else if (p.defId === teamId) {
      if (p.type === 'run') { oppRushAtt += 1; oppRushYds += Math.max(0, p.yards) }
      if (p.type === 'pass' && p.yards >= 25 && !p.turnover) explosives += 1
      if (p.down === 3 && (p.type === 'run' || p.type === 'pass')) {
        opp3Att += 1
        if (!p.turnover && (p.endYard >= 100 || p.yards >= (p.distance ?? 99))) opp3Conv += 1
      }
    }
  }
  const out: Diagnosis[] = []
  if (sacksTaken >= 2) out.push({ fix: 'maxProtect', side: 'off', severity: 50 + sacksTaken, note: `${sacksTaken} sacks taken` })
  const rushAvg = rushAtt ? rushYds / rushAtt : 0
  if (rushAtt >= 6 && rushAvg < 3.5) out.push({ fix: 'quickGame', side: 'off', severity: 40 + (3.5 - rushAvg), note: `rush ${rushAvg.toFixed(1)} avg` })
  const opp3Rate = opp3Att ? opp3Conv / opp3Att : 0
  if (opp3Att >= 4 && opp3Rate >= 0.5) out.push({ fix: 'thirdDownHeat', side: 'def', severity: 30 + (opp3Rate - 0.5) * 10, note: `their 3rd downs ${(opp3Rate * 100).toFixed(0)}%` })
  const oppRushAvg = oppRushAtt ? oppRushYds / oppRushAtt : 0
  if (oppRushAtt >= 6 && oppRushAvg >= 5) out.push({ fix: 'loadTheBox', side: 'def', severity: 20 + (oppRushAvg - 5), note: `their rush ${oppRushAvg.toFixed(1)} avg` })
  if (explosives >= 2) out.push({ fix: 'twoDeep', side: 'def', severity: 10 + (explosives - 2), note: `${explosives} explosives allowed` })
  return out.sort((a, b) => b.severity - a.severity)
}

/** The user's halftime adjustment card, filtered to their side's fixes (G6). */
function buildHalftimeSpec(s: GameState): DecisionSpec {
  const ctx = s.ctx!
  const userTeam = ctx.userTeamId
  const side: MomentSide = ctx.scope === 'off' ? 'off' : ctx.scope === 'def' ? 'def' : 'both'
  const allowed: ('off' | 'def')[] = side === 'off' ? ['off'] : side === 'def' ? ['def'] : ['off', 'def']
  const diag = diagnose(s.plays, userTeam).filter((d) => allowed.includes(d.side))
  const picks: FixId[] = diag.slice(0, 2).map((d) => d.fix)
  for (const f of FIX_ORDER) {
    if (picks.length >= 2) break
    if (FIX_META[f].side === 'off' && allowed.includes('off') && !picks.includes(f)) picks.push(f)
    else if (FIX_META[f].side === 'def' && allowed.includes('def') && !picks.includes(f)) picks.push(f)
  }
  const options: MomentOption[] = picks.map((f) => ({ id: f, label: FIX_META[f].label, hint: FIX_META[f].hint }))
  options.push({ id: 'stayCourse', label: FIX_META.stayCourse.label, hint: FIX_META.stayCourse.hint })
  const margin = userTeam === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore
  const read = diag.length ? diag.slice(0, 2).map((d) => d.note).join(' · ') : 'No first-half problem stood out.'
  return {
    kind: 'halftime', side, teamId: userTeam, qtr: 2, clock: '0:00', down: null, distance: null, yard: s.yard,
    title: 'Halftime adjustments', options, defaultId: 'stayCourse',
    staffRead: `First half — ${read}`, ask: true, margin,
  }
}

/** AI clubs take their top diagnosed fix, scaled by the head coach (G6). */
function rollAIHalftime(world: World, s: GameState) {
  const userTeam = s.ctx?.userTeamId
  for (const teamId of [s.homeId, s.awayId]) {
    if (teamId === userTeam) continue
    const top = diagnose(s.plays, teamId)[0]
    if (!top) { s.adjust[teamId] = []; continue }
    const hc = (world.staff[teamId] ?? []).find((m) => m.role === 'Head Coach')
    // J9: the head coach's ADJUSTMENTS sub decides whether the AI makes a
    // halftime fix — a top adjuster fixes; a poor one stands pat.
    const p = getCoachSubs()
      ? clamp(J9.adjBase + (centeredSub(world, 'Head Coach', 'adjustments', hc) - 60) / J9.adjScale, J9.adjLo, J9.adjHi)
      : clamp(0.4 + ((hc?.rating ?? 74) - 60) / 100, 0.2, 0.8)
    s.adjust[teamId] = s.rng() < p ? [top.fix] : []
  }
}

/** Standard NFL passer rating for one QB over the plays so far. */
function firstHalfPasserRating(plays: Play[], qbId: string): number | null {
  let att = 0, comp = 0, yds = 0, td = 0, ints = 0
  for (const p of plays) {
    if (p.qbId !== qbId || p.type !== 'pass') continue
    if (isSack(p)) continue
    att += 1
    if (p.turnover) { ints += 1; continue }
    if (p.result === 'Incomplete') continue
    comp += 1
    yds += Math.max(0, p.yards)
    if (p.result === 'TOUCHDOWN!') td += 1
  }
  if (!att) return null
  const term = (x: number) => Math.max(0, Math.min(2.375, x))
  const a = term((comp / att - 0.3) * 5)
  const b = term((yds / att - 3) * 0.25)
  const c = term((td / att) * 20)
  const d = term(2.375 - (ints / att) * 25)
  return ((a + b + c + d) / 6) * 100
}

interface QbSpec extends DecisionSpec { backupId: string }

/** The HC-only QB-change card when the starter has struggled (G6). */
function buildQbSpec(world: World, s: GameState): QbSpec | null {
  if (!s.ctx) return null
  const userTeam = s.ctx.userTeamId
  const qbs = depthGroup(world, userTeam, ['QB'], 2)
  if (qbs.length < 2) return null
  const starter = qbs[0]
  const backup = qbs[1]
  const rating = firstHalfPasserRating(s.plays, starter.id)
  if (rating == null || rating >= 50) return null
  const margin = userTeam === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore
  return {
    kind: 'qbChange', side: 'hc', teamId: userTeam, qtr: 2, clock: '0:00', down: null, distance: null, yard: s.yard,
    title: 'Change quarterback?', defaultId: 'stay', ask: true, margin, backupId: backup.id,
    options: [
      { id: 'stay', label: `Stay with ${starter.name}`, hint: 'Give him the second half to settle in.' },
      { id: 'switch', label: `Switch to ${backup.name}`, hint: 'Turn to the backup for the second half.' },
    ],
    staffRead: `${starter.name} — first-half passer rating ${rating.toFixed(1)}`,
  }
}

/** The halftime phase: adjustment card, AI fixes, then the QB-change card. */
function stepHalftimePhase(world: World, s: GameState): 'continue' | 'moment' {
  if (!s.halfAdjustDone) {
    const userTeam = s.ctx?.userTeamId
    if (userTeam) {
      const choice = decide(s, buildHalftimeSpec(s))
      if (choice === null) return 'moment'
      s.adjust[userTeam] = choice === 'stayCourse' ? [] : [choice]
    }
    // AI fixes draw only after the user's answer (determinism, Design rule 4).
    s.halfAdjustDone = true
    rollAIHalftime(world, s)
  }
  if (!s.qbChangeChecked) {
    const spec = buildQbSpec(world, s)
    if (spec) {
      const choice = decide(s, spec)
      if (choice === null) return 'moment'
      if (choice === 'switch') s.qbOverride[s.ctx!.userTeamId] = spec.backupId
    }
    s.qbChangeChecked = true
  }
  return stepHalftime(world, s)
}

// ── L10 G7: two-minute drill, timeouts, clock moment ─────────────────────────
function envFor(s: GameState): SimEnv {
  const margin = s.offId === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore
  return { adjust: s.adjust, qbOverride: s.qbOverride, down: s.down, intMult: s.twoMinMode === 'hurry' ? 1.15 : 1, qtr: s.qtr, clock: s.clock, margin, hurry: s.twoMinMode === 'hurry', userTeamId: s.ctx?.userTeamId, matchups: s.ctx?.matchups, usage: s.ctx?.usage, personnel: s.ctx?.personnel, cohesionOff: s.cohesion?.[s.offId]?.off, cohesionMeanOff: s.cohesionMean?.off, fat: STAMINA_ON ? s.fat : undefined, wind: s.wind, wx: wxFor(s, s.offId === s.homeId) }
}

/** FUTURES #6: the centred weather effects for one offence (undefined = neutral). */
function wxFor(s: GameState, offIsHome: boolean): WxEffects | undefined {
  return s.weather ? wxEffects(s.weather, offIsHome, s.qtr) : undefined
}

/** The offense's two-minute choice at the start of a possession (G7). */
function checkTwoMinute(s: GameState): 'continue' | 'moment' {
  if (s.twoMinChecked) return 'continue'
  if (s.qtr !== 2 && s.qtr !== 4) return 'continue'
  if (s.clock > 120) return 'continue'
  const offId = s.offId
  const margin = offId === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore
  if (s.qtr === 4 && (margin < -8 || margin > 3)) return 'continue'
  const isUser = !!s.ctx && offId === s.ctx.userTeamId
  if (!isUser) {
    // AI: trailing or tied → hurry, leading → protect.
    s.twoMinMode = margin <= 0 ? 'hurry' : 'protect'
    s.twoMinChecked = true
    s.twoMinDrives += 1
    return 'continue'
  }
  const standing: TwoMinMode = margin < 0 ? 'hurry' : margin > 0 ? 'protect' : 'normal'
  const options: MomentOption[] = [
    { id: 'hurry', label: 'Hurry up', hint: 'Fast tempo; burn timeouts on gains. Riskier throws.' },
    { id: 'normal', label: 'Normal tempo', hint: 'Keep the standard pace.' },
    ...(margin > 0 ? [{ id: 'protect', label: 'Protect the ball', hint: 'Slow tempo, safe throws — run the clock.' }] : []),
    { id: 'fgRange', label: 'Play for the FG', hint: 'Normal tempo until in range, then kick it.' },
  ]
  const choice = decide(s, {
    kind: 'twoMinute', side: 'off', teamId: offId, qtr: s.qtr, clock: fmtClock(s.clock), down: s.down, distance: s.distance,
    yard: s.yard, title: 'Two-minute drill', options, defaultId: standing, ask: true, margin,
  })
  if (choice === null) return 'moment'
  s.twoMinMode = choice as TwoMinMode
  s.twoMinChecked = true
  s.twoMinDrives += 1
  return 'continue'
}

/** The HC clock-management moment when the user's defense is trailing late (G7). */
function checkClock(s: GameState): 'continue' | 'moment' {
  if (s.clockChecked || !s.ctx) return 'continue'
  const userTeam = s.ctx.userTeamId
  if (s.qtr !== 4 || s.clock > 180 || s.defId !== userTeam) return 'continue'
  if ((s.timeouts[userTeam] ?? 0) <= 0) return 'continue'
  const margin = userTeam === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore
  if (margin > -1 || margin < -8) return 'continue'
  const standing = s.ctx.callSheet.timeouts === 'aggressive' ? 'useTimeouts' : 'save'
  const choice = decide(s, {
    kind: 'clock', side: 'hc', teamId: userTeam, qtr: s.qtr, clock: fmtClock(s.clock), down: s.down, distance: s.distance,
    yard: s.yard, title: 'Use your timeouts?', defaultId: standing, ask: true, margin,
    staffRead: `Trailing ${-margin} with ${fmtClock(s.clock)} left`,
    options: [
      { id: 'useTimeouts', label: 'Use timeouts', hint: 'Stop the clock after each opponent play.' },
      { id: 'save', label: 'Save timeouts', hint: 'Keep them for the final possession.' },
    ],
  })
  if (choice === null) return 'moment'
  s.clockMode[userTeam] = choice === 'useTimeouts' ? 'use' : 'save'
  s.clockChecked = true
  return 'continue'
}

/** Would the defense stop the clock after this play? (G7) */
function wantsTimeout(world: World, s: GameState, defId: string): boolean {
  if (s.qtr !== 4 || (s.timeouts[defId] ?? 0) <= 0) return false
  const defScore = defId === s.homeId ? s.homeScore : s.awayScore
  const offScore = defId === s.homeId ? s.awayScore : s.homeScore
  if (defScore >= offScore) return false // only when trailing
  const isUser = !!s.ctx && defId === s.ctx.userTeamId
  let mode: 'use' | 'save'
  if (isUser) mode = s.clockMode[defId] ?? (s.ctx!.callSheet.timeouts === 'aggressive' ? 'use' : 'save')
  else mode = aiCallSheet(world, defId).timeouts === 'aggressive' ? 'use' : 'save'
  return mode === 'use' ? s.clock <= 180 : s.clock <= 60
}

/** Spend a timeout on this play if the offense (hurry) or defense wants one (G7). */
function usedTimeout(world: World, s: GameState, offId: string, defId: string, out: PlayOutcome): boolean {
  // T2M: the dock's manual timeout stops the clock on the next dead ball,
  // whichever side of the ball the user's club is on.
  const manual = s.manualTimeout
  if (manual) {
    s.manualTimeout = undefined
    if ((s.timeouts[manual] ?? 0) > 0) {
      s.timeouts[manual] -= 1
      s.timeoutsUsed[manual] = (s.timeoutsUsed[manual] ?? 0) + 1
      return true
    }
  }
  // A carry that already went out of bounds has stopped the clock — no timeout.
  if (out.outOfBounds) return false
  if (s.twoMinMode === 'hurry' && out.yards > 0 && (s.timeouts[offId] ?? 0) > 0) {
    s.timeouts[offId] -= 1
    s.timeoutsUsed[offId] = (s.timeoutsUsed[offId] ?? 0) + 1
    return true
  }
  if (wantsTimeout(world, s, defId)) {
    s.timeouts[defId] -= 1
    s.timeoutsUsed[defId] = (s.timeoutsUsed[defId] ?? 0) + 1
    return true
  }
  return false
}

// ── J6: victory-formation kneel & two-minute spike ────────────────────────────
const KNEEL_CONCEPT: Concept = { name: 'QB Kneel', type: 'run', depth: 0, yac: 0, description: 'Victory formation — take a knee.' }
const SPIKE_CONCEPT: Concept = { name: 'Spike', type: 'pass', depth: 0, yac: 0, description: 'Spike the ball to stop the clock.' }

/** J6: the last scrimmage play was an in-bounds run/completion, so the clock is running. */
function clockRunning(s: GameState): boolean {
  for (let i = s.plays.length - 1; i >= 0; i--) {
    const p = s.plays[i]
    if (p.type === 'end' || p.type === 'penalty') continue
    if (p.offId !== s.offId) return false
    if (p.type !== 'run' && p.type !== 'pass') return false
    if (p.turnover || p.outOfBounds) return false
    if (p.type === 'pass' && p.result.startsWith('Incomplete')) return false
    return true
  }
  return false
}

/**
 * J6: take a knee when the offence leads late and the defence cannot stop the
 * clock enough to get the ball back. Each kneel burns `kneelBurn` seconds (a used
 * timeout caps it to a few). Deterministic — no rng().
 */
function shouldKneel(world: World, s: GameState): boolean {
  if (s.qtr !== 2 && s.qtr !== 4) return false
  // J6: end of the first half — only at the very end (a snap that runs the clock
  // out). A leading club kneels here in real life too.
  if (s.qtr === 2 && s.clock > CLOCK_REALISM.q2KneelMaxClock) return false
  if (s.clock <= 0 || s.down < 1 || s.down > 4) return false
  if (s.yard < 4) return false // never kneel on the doorstep (avoid a safety)
  // A deterministic per-snap gate so a kneel is not automatic on every eligible
  // snap (keeps the rate at the NFL 0.768 and re-rolls the play stream).
  if (h01(`${s.n}:${s.offId}:kneelgateD`) >= CLOCK_REALISM.kneelGate) return false
  const margin = s.offId === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore
  if (margin <= 0) return false
  // J6 try-5: a kneel is a RUN, so it must only ever replace a snap the leader
  // would otherwise RUN (a clock-kill, 'protect'), never a snap it would throw.
  // The engine's two-minute model puts a LEADING club in 'protect' and only a
  // trailing/tied club in 'hurry' (pass-first), so a club in 'hurry' is never the
  // one running the clock — the kneel is skipped and the trailing club keeps the
  // clock-stop a real incompletion would have given it (no extra lost pass plays).
  if (s.twoMinMode === 'hurry') return false
  const kneelsLeft = 4 - s.down // downs 1..3 → 3..1
  const stops = wantsTimeout(world, s, s.defId) ? (s.timeouts[s.defId] ?? 0) : 0
  const stopped = Math.min(kneelsLeft, stops)
  const burn = (kneelsLeft - stopped) * CLOCK_REALISM.kneelBurn + stopped * 6
  if (s.down === 4) {
    // Only when this snap runs the half/game out. AI only, so a user's explicit
    // 4th-down moment is never pre-empted.
    if (s.ctx && s.offId === s.ctx.userTeamId) return false
    return s.clock <= (stops > 0 ? 6 : CLOCK_REALISM.kneelBurn)
  }
  return s.clock <= burn - CLOCK_REALISM.kneelReserve
}

/**
 * J6: spike when in a hurry (or tied/trailing late) after an in-bounds play, out
 * of timeouts, and a snap from field-goal range or the red zone is worth buying.
 * Hash-gated so not every eligible situation spikes. No rng().
 */
function shouldSpike(world: World, s: GameState): boolean {
  if (s.down < 1 || s.down > 3 || s.clock <= 0 || s.clock > CLOCK_REALISM.spikeMaxClock) return false
  const margin = s.offId === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore
  const hurry = s.twoMinMode === 'hurry' || ((s.qtr === 2 || s.qtr === 4) && s.clock <= 60 && margin <= 0)
  if (!hurry) return false
  if ((s.timeouts[s.offId] ?? 0) > 0) return false // a timeout stops the clock better
  if (!clockRunning(s)) return false
  const inRange = s.yard >= fgRangeYard(kickPowerOf(world, s.offId)) - 3 || s.yard >= 80
  if (!inRange) return false
  return h01(`${s.n}:${s.offId}:spike`) < CLOCK_REALISM.spikeRate
}

/** J6: build the kneel/spike outcome (deterministic pick of the on-field eleven). */
function situationalOutcome(world: World, s: GameState, kind: 'kneel' | 'spike'): PlayOutcome {
  const offId = s.offId
  const defId = s.defId
  const concept = kind === 'kneel' ? KNEEL_CONCEPT : SPIKE_CONCEPT
  const offEleven = fillToEleven(world, offId, offenseOnField(world, offId, concept, s.qbOverride, undefined, STAMINA_ON ? s.fat : undefined), OFF_FILL)
  const defEleven = fillToEleven(world, defId, defenseOnField(world, defId, concept.personnel, STAMINA_ON ? s.fat : undefined), DEF_FILL)
  const qb = offEleven.find((p) => p.pos === 'QB')
  const tempoMult = s.twoMinMode === 'hurry' ? 0.45 : s.twoMinMode === 'protect' ? 1.25 : 1
  const burn = kind === 'kneel' ? CLOCK_REALISM.kneelBurn : CLOCK_REALISM.spikeBurn
  // timeUsed is scaled so applyScrimmageOutcome's burn (timeUsed × pace ×
  // baseTimeScale × tempo) lands on the intended game-clock seconds.
  const timeUsed = burn / (s.pace * baseTimeScale(world, offId) * tempoMult)
  const fields = { timeUsed, onFieldOff: offEleven.map((p) => p.id), onFieldDef: defEleven.map((p) => p.id) }
  if (kind === 'kneel') {
    const yards = h01(`${s.n}:${offId}:kneel`) < 0.5 ? -1 : -2
    return { type: 'run', concept: 'QB Kneel', yards, result: 'Kneel down', turnover: false, carrierId: qb?.id, kneel: true, ...fields }
  }
  return { type: 'pass', concept: 'Spike', yards: 0, result: 'Incomplete (spike)', turnover: false, qbId: qb?.id, spike: true, ...fields }
}

export function createGame(world: World, homeId: string, awayId: string, seed: number, ctx?: GameCtx, weather?: GameWeather): GameState {
  const isCollege = world.byId[homeId].tier !== 'NFL'
  const rng = makeRng(seed)
  // L12.13 M3: league mastery means and per-team mental-error multipliers are
  // fixed for the game (no rng drawn here, so the stream is unchanged).
  const means = leagueMasteryMeans(world)
  const teamMental = (id: string) => ({
    off: clamp(1 - teamMasteryOffset(world, id, 'off', means) * 0.002, 0.95, 1.05),
    def: clamp(1 - teamMasteryOffset(world, id, 'def', means) * 0.002, 0.95, 1.05),
  })
  const s: GameState = {
    rng,
    plays: [],
    homeScore: 0,
    awayScore: 0,
    stats: { home: emptyStats(), away: emptyStats() },
    qtr: 1,
    clock: 900,
    // First draw matches the old loop exactly.
    offId: rng() < 0.5 ? homeId : awayId,
    defId: homeId,
    yard: 25,
    down: 1,
    distance: 10,
    n: 0,
    phase: 'play',
    pending: null,
    answers: {},
    momentsUsed: 0,
    kindUsed: {},
    decisions: [],
    done: false,
    ctx,
    homeId,
    awayId,
    tier: isCollege ? 'FBS' : 'NFL',
    pace: isCollege ? 0.78 : R2.pace,
    passAdj: isCollege ? -0.09 : R2.passAdj,
    timeouts: { [homeId]: 3, [awayId]: 3 },
    timeoutsUsed: { [homeId]: 0, [awayId]: 0 },
    adjust: {},
    qbOverride: {},
    twoMinMode: null,
    twoMinChecked: false,
    clockMode: {},
    clockChecked: false,
    callConcepts: {},
    scriptUsed: 0,
    scriptLastClass: null,
    scriptClassRun: 0,
    userDrive: 0,
    logged: {},
    halfAdjustDone: false,
    qbChangeChecked: false,
    twoMinDrives: 0,
    mastery: means,
    mental: { [homeId]: teamMental(homeId), [awayId]: teamMental(awayId) },
    fat: {},
    snaps: {},
    snapSide: {},
    specialists: {},
    driveSnaps: 0,
    pIndex: new Map(world.players.map((p) => [p.id, p])),
    wind: 0,
    weather,
    review: null,
    challenges: { [homeId]: { left: 2, won: 0, lost: 0 }, [awayId]: { left: 2, won: 0, lost: 0 } },
  }
  s.defId = s.offId === homeId ? awayId : homeId
  // Backlog 149 follow-up: snapshot the active K/P for each club now, while the
  // injury list is still the one the game kicks off with. The resolvers read the
  // same depthGroup during the game, so this is exactly who takes the field; the
  // box score credits these ids instead of re-querying a healed depth chart.
  for (const id of [homeId, awayId]) {
    s.specialists[id] = {
      K: depthGroup(world, id, ['K'], 1)[0]?.id,
      P: depthGroup(world, id, ['P'], 1)[0]?.id,
    }
  }
  // L12.9 K1: unit cohesion (relative to the league mean) nudges pre-snap penalty
  // and fumble thresholds. Computed once here — pure arithmetic, no rng draw.
  {
    const sameTier = world.teams.filter((t) => (t.tier === 'NFL') === !isCollege)
    let offSum = 0
    let defSum = 0
    for (const t of sameTier) {
      const c = teamCohesion(world.roster[t.id] ?? [], world.staffTenure, t.id)
      offSum += c.off
      defSum += c.def
    }
    const n = sameTier.length || 1
    s.cohesionMean = { off: offSum / n, def: defSum / n }
    s.cohesion = {}
    for (const id of [homeId, awayId]) {
      const c = teamCohesion(world.roster[id] ?? [], world.staffTenure, id)
      s.cohesion[id] = { off: c.off, def: c.def }
    }
  }
  // G10: if the user receives the opening kick, this is their first drive.
  if (ctx && s.offId === ctx.userTeamId) s.userDrive = 1
  // R6: opening kickoff — a touchback or a real return.
  if (resolveKickoff(world, s).scored) s.phase = 'try'
  return s
}

/** End-of-quarter / overtime bookkeeping. No rng is drawn here. */
function stepClock(world: World, s: GameState): 'continue' | 'done' {
  if (s.qtr === 2) {
    pushPlay(s, { type: 'end', concept: 'End of Half', yards: 0, result: 'Halftime', startYard: s.yard, endYard: s.yard, down: null, distance: null, timeUsed: 0 })
    restFatigue(s, R15.restHalf)
    s.phase = 'halftime'
    return 'continue'
  }
  if (s.qtr === 4) {
    if (s.homeScore === s.awayScore) {
      // Overtime: 10-minute period, first score wins (simplified).
      s.qtr += 1
      s.clock = 600
      pushPlay(s, { type: 'end', concept: 'End of Regulation', yards: 0, result: 'Tied — Overtime', startYard: s.yard, endYard: s.yard, down: null, distance: null, timeUsed: 0 })
      // backlog126: the overtime period opens with a real kickoff.
      swapPossession(s)
      s.down = 1
      s.distance = 10
      if (resolveKickoff(world, s).scored) {
        pushPlay(s, { type: 'end', concept: 'Overtime', yards: 0, result: 'Walk-off score — Final (OT)', startYard: s.yard, endYard: s.yard, down: null, distance: null, timeUsed: 0 })
        return 'done'
      }
      return 'continue'
    }
    pushPlay(s, { type: 'end', concept: 'End of Regulation', yards: 0, result: 'Final', startYard: s.yard, endYard: s.yard, down: null, distance: null, timeUsed: 0 })
    return 'done'
  }
  if (s.qtr >= 5) {
    pushPlay(s, { type: 'end', concept: 'End of Overtime', yards: 0, result: 'Final (OT)', startYard: s.yard, endYard: s.yard, down: null, distance: null, timeUsed: 0 })
    return 'done'
  }
  s.qtr += 1
  s.clock = 900
  return 'continue'
}

/** Halftime: possession flips to start Q3, timeouts reset (G6/G7). */
function stepHalftime(world: World, s: GameState): 'continue' {
  s.qtr = 3
  s.clock = 900
  swapPossession(s)
  s.down = 1
  s.distance = 10
  s.timeouts = { [s.homeId]: 3, [s.awayId]: 3 }
  // backlog126: the second half opens with a real kickoff (a touchback or a
  // return, and the rare return score).
  s.phase = resolveKickoff(world, s).scored ? 'try' : 'play'
  return 'continue'
}

/** Resolve the try after a touchdown: the scoring team's sheet decides kick or go2. */
function stepTry(world: World, s: GameState): 'continue' | 'moment' {
  const offId = s.offId
  const isUser = !!s.ctx && offId === s.ctx.userTeamId
  const sheet = isUser ? s.ctx!.callSheet : aiCallSheet(world, offId)
  const margin = offId === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore
  // J6: the chart is situation- and coach-aware; the user's explicit 'go'/'kick'
  // rules and every moment answer stay exactly as before (this is only the
  // standing default). Gated on the toggle, so the OFF path is byte-identical.
  const twoDefault = twoPointChoice(sheet.twoPoint, margin, s.qtr, CLOCK_ON ? {
    modern: true, aggro: coachTendency(world, offId).aggro, key: `${s.n}:${offId}`, clockSec: s.clock,
    earlyAggroMin: CLOCK_REALISM.twoAggroMin, earlyRate: CLOCK_REALISM.twoEarlyRate,
  } : undefined)
  const choice = decide(s, {
    kind: 'two', side: 'hc', teamId: offId, qtr: s.qtr, clock: fmtClock(s.clock), down: null, distance: null, yard: 98,
    // Only ask when it can matter: the second half, or whenever the chart says go for two.
    title: 'Two-point try', margin, ask: s.qtr >= 3 || twoDefault === 'go2', defaultId: twoDefault,
    options: [
      { id: 'kick', label: 'Kick the PAT', hint: 'Take the near-certain point.' },
      { id: 'go2', label: 'Go for two', hint: 'One snap from the 2 for two points.' },
    ],
  })
  if (choice === null) return 'moment'

  const offS = statFor(s, offId)
  if (choice === 'go2') {
    offS.twoAtt += 1
    const style = offStyle(world, offId)
    const concept = pickConcept(s.rng, style, 4, 2, 0)
    const env = envFor(s)
    const out = concept.type === 'pass'
      ? resolvePass(world, s.rng, offId, s.defId, concept, 98, style.passRate, s.tier, clutchFor(world, offId, 4, 98) + clutchEdge(world, s, offId, s.defId, 'pass'), env, undefined, s.n, s.mastery)
      : resolveRun(world, s.rng, offId, s.defId, concept, 2, 98, s.tier, clutchFor(world, offId, 4, 98) + clutchEdge(world, s, offId, s.defId, 'run'), env, undefined, s.n, s.mastery)
    s.clock -= out.timeUsed * s.pace
    const good = !out.turnover && out.yards >= 2
    if (good) {
      if (offId === s.homeId) s.homeScore += 2
      else s.awayScore += 2
      offS.points += 2
      offS.twoMade += 1
    }
    pushPlay(s, {
      type: 'pat', concept: 'Two-point try', yards: out.yards,
      result: good ? 'Two-point try good' : 'Two-point try failed',
      turnover: !good, startYard: 98, endYard: 98, down: null, distance: null, timeUsed: out.timeUsed,
      offClass: offClassFor(concept.type, concept.depth),
    })
  } else {
    const pat = resolvePAT(world, s.rng, offId, s.n, envFor(s))
    s.clock -= pat.timeUsed * s.pace
    if (!pat.turnover) {
      if (offId === s.homeId) s.homeScore += 1
      else s.awayScore += 1
      offS.points += 1
    }
    pushPlay(s, { ...pat, startYard: 2, endYard: 2, down: null, distance: null })
  }

  swapPossession(s)
  s.down = 1
  s.distance = 10
  // R6: kick off for real — a touchback or a return (and the rare return score).
  // FUTURES #4: the kickoff runs in its own step so a kickoff moment never re-runs
  // the try's rng draws when the user answers it.
  s.phase = 'kickoff'
  return 'continue'
}

/** FUTURES #4: resolve a pending kickoff (its own phase, so moments are re-entrant). */
function stepKickoff(world: World, s: GameState): 'continue' | 'moment' {
  const ko = resolveKickoff(world, s)
  if (ko.moment) return 'moment'
  s.phase = ko.scored ? 'try' : 'play'
  return 'continue'
}

/**
 * Apply a resolved scrimmage play to the game state — clock, timeouts, team
 * stats, safety, touchdown, turnover and downs. Extracted verbatim from the tail
 * of `step()` (FUTURES #5) so a review can re-apply a corrected ruling without
 * re-running the resolvers and without drawing the rng. Behaviour is unchanged.
 * `defCall` is the defensive call to record (the user's call or their standing
 * plan); the offensive class is derived from the outcome, exactly as before.
 */
function applyScrimmageOutcome(
  world: World,
  s: GameState,
  out: PlayOutcome,
  fourthChoice: 'go' | 'fg' | 'punt' | 'fake' | null,
  offId: string,
  defId: string,
  defCall: DefCall | undefined,
): 'continue' | 'done' {
  // G7 tempo and timeouts: a used timeout caps this play's clock burn at 6s.
  const tempoMult = s.twoMinMode === 'hurry' ? 0.45 : s.twoMinMode === 'protect' ? 1.25 : 1
  let t = out.timeUsed * s.pace * baseTimeScale(world, offId) * tempoMult
  if (usedTimeout(world, s, offId, defId, out)) t = Math.min(t, 6)
  // T2M: a carry out of bounds stops the clock at the end of the play — no 40s
  // runoff; only the few seconds the play itself took count. J6: this cap is
  // gated to the real clock-stop window (last two minutes of a half), so the
  // widened out-of-bounds marker outside it never leaks game time. Byte-identical
  // on the OFF path (a T2M out-of-bounds play is always inside the window).
  if (out.outOfBounds && (s.qtr === 2 || s.qtr === 4) && s.clock <= 120) t = Math.min(t, 6)
  s.clock -= t
  const offS = statFor(s, offId)
  const defS = statFor(s, defId)
  const isPass = out.type === 'pass'
  offS.plays += 1
  if (isPass) {
    offS.passAtt += 1
    if (isSack(out)) {
      // R16: a strip sack is still a sack; a lost ball is also a fumble.
      offS.sacksTaken += 1; defS.sacks += 1
      if (out.turnover) offS.fumbles += 1
    } else if (out.intId) {
      // A tipped/muffed interception is still an interception.
      offS.ints += 1; defS.ints += 1
    } else if (out.fumbleId || out.muffedCatch) {
      // R16: a catch that came loose still counts as a completion for yards; only
      // a ball the defence recovered is a lost fumble (turnover).
      offS.passComp += 1; offS.passYds += out.yards
      if (out.turnover) offS.fumbles += 1
    } else if (out.result !== 'Incomplete' && !out.spike) { offS.passComp += 1; offS.passYds += out.yards }
  } else {
    offS.rushAtt += 1
    offS.rushYds += out.kneel ? out.yards : Math.max(0, out.yards)
    if (out.turnover) offS.fumbles += 1
  }
  offS.top += out.timeUsed * s.pace
  if (s.down === 3) offS.thirdDownAtt += 1

  // R6: a safety — a run or sack stopped in the end zone when the offense started
  // inside its own 3 (deterministic hash, ~0.04 per team-game).
  const safety = !out.turnover && !out.defTD && (out.type === 'run' || isSack(out)) &&
    s.yard <= 4 && s.yard + out.yards <= 0 && h01(`${s.n}:${offId}:safety`) < 1
  const gainedYard = clamp(s.yard + out.yards, 0, 100)
  const endYard = out.defTD ? 100 : safety ? 0 : gainedYard
  const scored = endYard >= 100 && !out.turnover && !out.defTD
  if (!out.turnover && (scored || out.yards >= s.distance)) {
    offS.firstDowns += 1
    if (s.down === 3) offS.thirdDownConv += 1
  }
  // J5: pre-snap motion — a deterministic hash flag (no rng() draw), so the seed
  // stream and coached/sim equivalence are unchanged. Gated on the toggle so OFF
  // pushes exactly the pre-J5 play record (no `motion` key at all).
  let motion: boolean | undefined
  if (MENU_REALISM_ON) {
    const pers = conceptFromPlaybook(out.concept)?.personnel
    const gun = formationForConcept(out.concept).startsWith('Gun')
    const rate = pers === '11' && gun ? MENU_REALISM.motionRate + MENU_REALISM.motionGun11Bump : MENU_REALISM.motionRate
    motion = h01(`${s.n}:${offId}:motion`) < rate
  }
  const motionFields = motion === undefined ? {} : { motion }
  pushPlay(s, { ...out, ...motionFields, result: fourthChoice === 'fake' ? `Fake kick — ${safety ? (isSack(out) ? 'Sack in the end zone — Safety!' : 'Safety!') : out.result}` : safety ? (isSack(out) ? 'Sack in the end zone — Safety!' : 'Safety!') : out.result, safety, fake: fourthChoice === 'fake' || undefined, stAttempt: fourthChoice === 'fake' ? { club: offId, kind: 'fake' } : undefined, startYard: s.yard, endYard: scored ? 100 : endYard, down: s.down, distance: s.distance, offClass: offClassFor(out.type === 'run' ? 'run' : 'pass', DEPTH_AWARE_ON ? (conceptFromPlaybook(out.concept)?.depth ?? out.passDepth ?? 0) : (out.passDepth ?? 0)), defCall })

  if (out.defTD) {
    // R6: a takeaway returned for a touchdown (pick-six / fumble return).
    const scoring = defId
    if (scoring === s.homeId) s.homeScore += 6
    else s.awayScore += 6
    statFor(s, scoring).points += 6
    const last = s.plays[s.plays.length - 1]
    last.result = 'TOUCHDOWN!'
    last.scorerId = out.scorerId
    last.scorerName = world.players.find((p) => p.id === out.scorerId)?.name ?? ''
    // The scoring club attempts the extra point, then kicks off (handled by `try`).
    swapPossession(s)
    s.down = 1
    s.distance = 10
    if (s.qtr <= 4) {
      s.phase = 'try'
      return 'continue'
    }
    pushPlay(s, { type: 'end', concept: 'Overtime', yards: 0, result: 'Walk-off score — Final (OT)', startYard: s.yard, endYard: s.yard, down: null, distance: null, timeUsed: 0 })
    return 'done'
  }

  if (safety) {
    // R6: two points to the defense; the club that gave it up free-kicks away.
    const scoring = defId
    if (scoring === s.homeId) s.homeScore += 2
    else s.awayScore += 2
    statFor(s, scoring).points += 2
    swapPossession(s)
    s.down = 1
    s.distance = 10
    // FUTURES #4: the free kick runs in the kickoff phase (see stepTry).
    s.phase = 'kickoff'
    return 'continue'
  }

  if (out.turnover) {
    swapPossession(s)
    s.yard = 100 - clamp(s.yard + out.yards, 1, 99)
    s.down = 1
    s.distance = 10
    return 'continue'
  }

  if (scored) {
    const scorer = out.carrierId ? (world.players.find((p) => p.id === out.carrierId)?.name ?? '') : ''
    if (offId === s.homeId) s.homeScore += 6
    else s.awayScore += 6
    offS.points += 6
    offS.td += 1
    if (isPass) offS.passTD += 1
    else offS.rushTD += 1
    const last = s.plays[s.plays.length - 1]
    last.result = 'TOUCHDOWN!'
    last.scorerName = scorer
    last.scorerId = out.carrierId
    // extra point / two-point try (in overtime it's sudden death — no try needed)
    if (s.qtr <= 4) {
      s.phase = 'try'
      return 'continue'
    }
    swapPossession(s)
    s.yard = R2.kickoffYard
    s.down = 1
    s.distance = 10
    pushPlay(s, { type: 'end', concept: 'Overtime', yards: 0, result: 'Walk-off score — Final (OT)', startYard: s.yard, endYard: s.yard, down: null, distance: null, timeUsed: 0 })
    return 'done'
  }

  s.yard = endYard
  const gained = out.yards
  if (gained >= s.distance) {
    s.down = 1
    s.distance = Math.min(10, 100 - s.yard)
  } else {
    s.down += 1
    s.distance -= gained
    if (s.down > 4) {
      // failed to convert on 4th (go-for-it), turnover on downs
      swapPossession(s)
      s.yard = 100 - s.yard
      s.down = 1
      s.distance = 10
      return 'continue'
    }
  }
  return 'continue'
}

// ── FUTURES #5 C2: challenges ────────────────────────────────────────────────

/** Capture the state a ruling was applied on top of (taken after chargeSnaps). */
function snapshotFor(s: GameState): ReviewSnapshot {
  return {
    homeScore: s.homeScore,
    awayScore: s.awayScore,
    offId: s.offId,
    defId: s.defId,
    yard: s.yard,
    down: s.down,
    distance: s.distance,
    phase: s.phase,
    clock: s.clock,
    timeouts: { ...s.timeouts },
    timeoutsUsed: { ...s.timeoutsUsed },
    manualTimeout: s.manualTimeout,
    driveSnaps: s.driveSnaps,
    twoMinMode: s.twoMinMode,
    twoMinChecked: s.twoMinChecked,
    n: s.n,
    userDrive: s.userDrive,
    fat: { ...s.fat },
    stats: { home: { ...s.stats.home }, away: { ...s.stats.away } },
  }
}

/** Undo a ruling so the truth can be re-applied (rng-free). */
function restoreSnapshot(s: GameState, snap: ReviewSnapshot): void {
  s.homeScore = snap.homeScore
  s.awayScore = snap.awayScore
  s.offId = snap.offId
  s.defId = snap.defId
  s.yard = snap.yard
  s.down = snap.down
  s.distance = snap.distance
  s.phase = snap.phase
  s.clock = snap.clock
  s.timeouts = { ...snap.timeouts }
  s.timeoutsUsed = { ...snap.timeoutsUsed }
  s.manualTimeout = snap.manualTimeout
  s.driveSnaps = snap.driveSnaps
  s.twoMinMode = snap.twoMinMode
  s.twoMinChecked = snap.twoMinChecked
  s.n = snap.n
  s.userDrive = snap.userDrive
  s.fat = { ...snap.fat }
  s.stats = { home: { ...snap.stats.home }, away: { ...snap.stats.away } }
}

/**
 * C2: throw the flag. A reversed mis-call restores the snapshot, drops the ruled
 * play and re-applies the truth through the shared apply function — so the state
 * equals a forced-correct-call run and `plays.length` is unchanged. A flag that
 * stands costs the club a timeout and a challenge. No rng is drawn.
 */
function applyChallenge(world: World, s: GameState, club: string, read: number): 'reversed' | 'stands' {
  const rev = s.review
  if (!rev) return 'stands'
  const challenges = (s.challenges ??= {})
  const chal = (challenges[club] ??= { left: 2, won: 0, lost: 0 })
  const reversed = resolveChallenge(rev, `${rev.snap.n}:${club}:${rev.kind}`)
  if (reversed) {
    restoreSnapshot(s, rev.snap)
    s.plays.pop()
    applyScrimmageOutcome(world, s, rev.truth, rev.fourthChoice, rev.snap.offId, rev.snap.defId, rev.defCall)
    const rec = s.plays[s.plays.length - 1]
    if (rec) rec.review = { by: 'challenge', club, kind: rev.kind, ruling: rev.ruling, outcome: 'reversed', read }
    spendChallenge(chal, true)
  } else {
    s.timeouts[club] = Math.max(0, (s.timeouts[club] ?? 0) - 1)
    s.timeoutsUsed[club] = (s.timeoutsUsed[club] ?? 0) + 1
    if (s.manualTimeout === club) s.manualTimeout = undefined
    const rec = s.plays[rev.playIdx]
    if (rec) rec.review = { by: 'challenge', club, kind: rev.kind, ruling: rev.ruling, outcome: 'stands', read }
    spendChallenge(chal, false)
  }
  s.review = null
  return reversed ? 'reversed' : 'stands'
}

/**
 * C2: the hurt club's red-flag decision, at the start of a step and before any
 * rng draw. The user's club is asked (a `challenge` moment, HC scope); an AI club
 * decides with `aiThrows`. Only eligible when it has a timeout and a challenge
 * left, and never inside the booth window or overtime.
 */
function checkChallenge(world: World, s: GameState): 'continue' | 'moment' {
  const rev = s.review
  if (!rev) return 'continue'
  const club = rev.hurt
  const chal = s.challenges?.[club]
  const eligible = !!chal && chal.left > 0 && (s.timeouts[club] ?? 0) > 0 && !inBoothWindow(s) && s.qtr <= 4
  if (!eligible) {
    s.review = null
    return 'continue'
  }
  const read = replayRead(world, club, rev.wrong, `${rev.snap.n}:${club}:${rev.kind}`)
  const isUser = !!s.ctx && club === s.ctx.userTeamId
  if (isUser) {
    const standing = read >= challengeThreshold(s.ctx!.callSheet) ? 'throw' : 'letGo'
    const choice = decide(s, {
      kind: 'challenge', side: 'hc', teamId: club, qtr: s.qtr, clock: fmtClock(s.clock),
      down: s.down, distance: s.distance, yard: s.yard,
      title: `Review the call: ${rev.ruling}`,
      options: [
        { id: 'throw', label: 'Throw the red flag', hint: 'Overturn a bad call — costs a timeout if it stands.' },
        { id: 'letGo', label: 'Let it go', hint: 'Play on; the ruling stands.' },
      ],
      defaultId: standing,
      staffRead: `Replay booth: ${Math.round(read * 100)}% chance the ruling is overturned.`,
      ask: true,
      margin: club === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore,
    })
    if (choice === null) return 'moment'
    const id = `challenge-${s.plays.length}`
    const last = s.decisions[s.decisions.length - 1]
    const mine = last && last.momentId === id ? last : null
    if (choice === 'throw') {
      const outcome = applyChallenge(world, s, club, read)
      if (mine) { mine.outcome = outcome; mine.read = read }
    } else {
      s.review = null
      if (mine) { mine.outcome = 'passed'; mine.read = read }
    }
    return 'continue'
  }
  if (aiThrows(world, s, club, read)) applyChallenge(world, s, club, read)
  else s.review = null
  return 'continue'
}

/** Phase dispatch for `step`: a non-play phase advances on its own. */
function dispatchPhase(world: World, s: GameState): 'continue' | 'moment' | 'done' | null {
  if (s.phase === 'try') return stepTry(world, s)
  if (s.phase === 'kickoff') return stepKickoff(world, s)
  if (s.phase === 'halftime') return stepHalftimePhase(world, s)
  return null
}

/** One loop iteration of the old simulatePlayByPlay. */
function step(world: World, s: GameState): 'continue' | 'moment' | 'done' {
  if (s.done) return 'done'
  if (s.n >= MAX_PLAYS) return 'done'

  const ph0 = dispatchPhase(world, s)
  if (ph0) return ph0

  // FUTURES #5 C2: a pending red-flag decision sits before any rng draw.
  if (checkChallenge(world, s) === 'moment') return 'moment'
  // A reversal re-applies the truth, which can change the phase (a ruled-down
  // call that was really a touchdown goes to the try) or end the game. Re-dispatch
  // so the step never resolves a scrimmage play from the corrected state.
  if (s.done) return 'done'
  const ph1 = dispatchPhase(world, s)
  if (ph1) return ph1

  if (s.clock <= 0) return stepClock(world, s)

  // L10 G7: two-minute and clock moments sit at the very start, before any rng.
  if (checkTwoMinute(s) === 'moment') return 'moment'
  if (checkClock(s) === 'moment') return 'moment'

  // J6: victory-formation kneel / two-minute spike. Deterministic (hash only) and
  // placed before the fourth-down choice and any rng draw, so it is a standing
  // decision in both the coached and the fast path. A kneel/spike is applied
  // through the same outcome applier as a normal scrimmage play.
  if (CLOCK_ON) {
    const sit = shouldKneel(world, s) ? 'kneel' : shouldSpike(world, s) ? 'spike' : null
    if (sit) {
      const out = situationalOutcome(world, s, sit)
      out.fatOn = [...(out.onFieldOff ?? []), ...(out.onFieldDef ?? [])].map((id) => Math.round((s.fat[id] ?? 0) * 100))
      chargeSnaps(s, out)
      return applyScrimmageOutcome(world, s, out, null, s.offId, s.defId, undefined)
    }
  }

  // 4th-down decision sits at the very start of the step, before any rng draw.
  let fourthChoice: 'go' | 'fg' | 'punt' | 'fake' | null = null
  if (s.down === 4) {
    fourthChoice = chooseFourth(world, s)
    if (fourthChoice === null) return 'moment'
  }

  const offId = s.offId
  const defId = s.defId
  const style = offStyle(world, offId)
  const offPlan = planFor(offId, 'off')
  const planPassAdj = offPlan ? planEffects(offPlan, false).passAdj : 0

  // G7 fgRange: as soon as it's a long FG, kick it (≤0:30 left or on 3rd down).
  // R17: the trigger point scales with the kicker's power.
  if (s.twoMinMode === 'fgRange' && s.down !== 4 && s.yard >= fgRangeYard(kickPowerOf(world, offId)) + 7 && (s.clock <= 30 || s.down === 3)) {
    const out = resolveSpecial(world, s.rng, offId, 'fg', s.yard, envFor(s), offId === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore, s.n)
    s.clock -= out.timeUsed * s.pace
    const good = !out.turnover
    const fgS = statFor(s, offId)
    fgS.fgAtt += 1
    if (good) {
      if (offId === s.homeId) s.homeScore += 3
      else s.awayScore += 3
      fgS.points += 3
      fgS.fgMade += 1
    }
    pushPlay(s, { ...out, startYard: s.yard, endYard: s.yard, down: s.down, distance: s.distance })
    restartAfterFieldGoal(s, good)
    return 'continue'
  }

  // G6 quick game throws more; G7 protect throws safer.
  const quickPassAdj = hasFix(envFor(s), offId, 'quickGame') ? 0.1 : 0
  const modePassAdj = s.twoMinMode === 'protect' ? -0.15 : 0
  const isFourth = s.down === 4
  // R2: red-zone finishing — inside the 20 the league throws more than it does
  // between the 20s, so the concept draw leans pass there (no extra rng draw).
  const rzPassAdj = s.yard >= 80 ? R2.rzPassBias : 0
  // J6: a small run→pass lean while clock-realism is on, compensating the dropback
  // a scramble converts to a rush so pass/rush attempts stay in band. OFF adds 0.
  const clockPassShift = CLOCK_ON ? CLOCK_REALISM.passShift : 0
  const passAdj = s.passAdj + planPassAdj + quickPassAdj + modePassAdj + rzPassAdj + clockPassShift
  // J1: with the situational model ON the table replaces the base league lean
  // (s.passAdj) and the red-zone lean (rzPassAdj) — no double counting — while
  // the plan/quick/mode edges stay additive. OFF keeps the legacy combined lean.
  const pickPassAdj = getSituational() ? planPassAdj + quickPassAdj + modePassAdj + clockPassShift : passAdj

  // ── L10 G9/G10: the snap's concept and any call-matrix edge. The `call` and
  //    `defCall` decisions sit before the penalty rng; the AI's counter-call is
  //    drawn only after the user answers (or the standing order is taken).
  const bucket = bucketFor(s.down, s.distance, s.yard)
  const marginOf = (id: string) => (id === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore)
  // J1: the snap's situation for the pass-rate model (pure; no rng). Built only
  // when the model is ON so the OFF stream and code path are untouched. The OC
  // identity is the club's widened pass rate centred on the league mean.
  const sit: SituationInput | undefined = getSituational()
    ? {
        down: s.down, distance: s.distance, yard: s.yard, qtr: s.qtr, clockSec: s.clock,
        margin: marginOf(offId), twoMinMode: s.twoMinMode, identity: style.passRate - worldPassMean(world),
      }
    : undefined
  const offIsUser = !!s.ctx && offId === s.ctx.userTeamId
  const defIsUser = !!s.ctx && defId === s.ctx.userTeamId
  let concept: Concept
  let call: CallEffect | undefined
  let userDefCall: DefCall | undefined

  // L12.6: in "call every play" mode the user's side is asked on every snap.
  const callAll = s.ctx?.callAll
  const callTriggered = offIsUser && (!isFourth || fourthChoice === 'go') && (
    callAll === 'off' || callAll === 'both' ||
    (s.down === 3 && s.distance <= 3) ||
    (s.yard >= 80 && s.down >= 3) ||
    (s.qtr === 4 && s.clock <= 120 && marginOf(s.offId) >= -8 && marginOf(s.offId) <= 0)
  )
  const defCallTriggered = defIsUser && (
    callAll === 'def' || callAll === 'both' ||
    (s.down === 3 && s.yard >= 40) ||
    (s.qtr === 4 && s.clock <= 120 && marginOf(s.ctx!.userTeamId) >= 1 && marginOf(s.ctx!.userTeamId) <= 8)
  )

  if (callTriggered) {
    // The standing concept is what pickConcept would have chosen — one draw, and
    // it is stored so a paused game never redraws it.
    const id = `call-${s.plays.length}`
    let standing = s.callConcepts[id]
    if (!standing) {
      standing = pickConcept(s.rng, style, s.down, s.distance, pickPassAdj, sit)
      s.callConcepts[id] = standing
    }
    const read = tendencyRead(world, s, s.defId, 'def', bucket)
    const choice = decide(s, {
      kind: 'call', side: 'off', teamId: s.offId, qtr: s.qtr, clock: fmtClock(s.clock), down: s.down, distance: s.distance,
      yard: s.yard, title: downDistance(s.down, s.distance, s.yard),
      options: callCards().map((c) => ({ id: c.name, label: c.name, hint: c.description })),
      defaultId: standing.name, staffRead: read, ask: true, margin: marginOf(s.offId),
    })
    if (choice === null) return 'moment'
    concept = style.concepts.find((c) => c.name === choice) ?? conceptFromPlaybook(choice) ?? standing
    const aiDef = drawAIDefCall(world, s, s.defId, bucket)
    // The matrix only applies to a call the user made; a standing order plays the
    // snap exactly as fast sim would (no edge either way).
    const last = s.decisions[s.decisions.length - 1]
    if (last && last.momentId === id && last.source === 'user') {
      call = callEffect(offClassFor(concept.type, concept.depth), aiDef)
      last.outcome = call.edge > 0 ? 'won' : call.edge < 0 ? 'lost' : 'push'
      last.vs = aiDef
    }
  } else if (defCallTriggered) {
    const id = `defCall-${s.plays.length}`
    const userTeam = s.ctx!.userTeamId
    const standing = defCallForPlan(planFor(userTeam, 'def') ?? BALANCED_PLAN)
    const read = tendencyRead(world, s, s.offId, 'off', bucket)
    const choice = decide(s, {
      kind: 'defCall', side: 'def', teamId: userTeam, qtr: s.qtr, clock: fmtClock(s.clock), down: s.down, distance: s.distance,
      yard: s.yard, title: downDistance(s.down, s.distance, s.yard),
      options: DEF_CALLS.map((d) => ({ id: d, label: DEF_CALL_LABEL[d], hint: DEF_CALL_DESC[d] })),
      defaultId: standing, staffRead: read, ask: true, margin: marginOf(userTeam),
    })
    if (choice === null) return 'moment'
    userDefCall = choice as DefCall
    const aiCls = drawAIOffClass(world, s, s.offId, bucket)
    concept = pickConceptOfClass(s.rng, style, aiCls)
    const last = s.decisions[s.decisions.length - 1]
    if (last && last.momentId === id && last.source === 'user') {
      call = callEffect(aiCls, userDefCall)
      last.outcome = call.edge > 0 ? 'won' : call.edge < 0 ? 'lost' : 'push'
      last.vs = aiCls
    }
  } else {
    const script = s.ctx?.script
    const scripted = offIsUser && script && script.length > 0 && s.scriptUsed < script.length
      ? conceptFromPlaybook(script[s.scriptUsed])
      : undefined
    if (scripted) {
      concept = scripted
      const offCls = offClassFor(scripted.type, scripted.depth)
      if (s.scriptLastClass === offCls) s.scriptClassRun += 1
      else { s.scriptLastClass = offCls; s.scriptClassRun = 1 }
      // Three of the same class in a row and the defense sits on it.
      const aiDef = s.scriptClassRun >= 3 ? bestCounterCall(offCls) : drawAIDefCall(world, s, s.defId, bucket)
      const base = s.userDrive <= 1 ? (s.scriptUsed < 4 ? 2 : 1) : 0
      const scriptedEdge = base * (s.ctx?.scriptEdgeMult ?? 1)
      const eff = callEffect(offCls, aiDef)
      call = { edge: eff.edge + scriptedEdge, sackMult: eff.sackMult }
      s.scriptUsed += 1
    } else {
      concept = pickConcept(s.rng, style, s.down, s.distance, pickPassAdj, sit)
    }
  }

  // Defensive penalty — typed by hash within the R2 yardage tier, automatic first down.
  const penFields = getIndividual() ? penaltyFields(world, s, concept, offId, defId) : undefined
  const defDisc = (getCoachSubs() ? disciplineMult(world, defId) : ocEffect(world, defId).discipline) * cohesionMult(s.cohesionMean?.def, s.cohesion?.[defId]?.def, 0.6)
  // L12.13 M3: a defense that knows the system makes fewer mental errors.
  if (s.rng() < R2.penDefRate * defDisc * (s.mental[defId]?.def ?? 1)) {
    const penS = statFor(s, offId)
    const startY = s.yard
    const py = penaltyYards(`${s.n}:penD:${defId}`, 'def')
    const kind = pickPenaltyKind(world, s, 'def', defId, offId, offId !== s.homeId, py, penFields?.def, penFields?.off)
    const info = PENALTY_INFO[kind]
    const offender = penaltyOffender(world, defId, 'def', info.pos, `${s.n}:penOffender:${defId}`, kind, penFields?.def)
    const who = shortName(offender?.name)
    // R14: offsetting — both clubs fouled on the snap; replay, no yardage.
    const offset = h01(`${s.n}:penOffset:${defId}`) < 0.001
    // R14: the offense may decline a defensive offside.
    const declined = !offset && kind === 'offside' && h01(`${s.n}:penDecline:${defId}`) < 0.005
    let yards = 0
    let result: string
    if (offset) {
      result = 'Offsetting penalties — replay the down'
    } else if (declined) {
      result = `${info.label} on ${who} — declined`
    } else {
      s.yard = clamp(s.yard + py, 1, 99)
      // R2: penalties are not scrimmage plays (the stat counts rushes + pass attempts).
      penS.firstDowns += 1
      s.down = 1
      s.distance = Math.min(10, 100 - s.yard)
      yards = py
      result = `${info.label} on ${who} — ${py} yards, automatic first down`
    }
    const t = 18 * s.pace
    s.clock -= t
    penS.top += t
    pushPlay(s, { type: 'penalty', concept: info.label, penaltyKind: kind, penaltyTeam: defId, penaltyPlayerId: offender?.id, penaltyDisposition: offset ? 'offset' : declined ? 'declined' : 'accepted', yards, result, turnover: false, startYard: startY, endYard: s.yard, down: s.down, distance: s.distance, timeUsed: 18 })
    return 'continue'
  }

  // Offensive penalty — typed by hash within the R2 yardage tier, replay the down.
  const offDisc = (getCoachSubs() ? disciplineMult(world, offId) : ocEffect(world, offId).discipline) * cohesionMult(s.cohesionMean?.off, s.cohesion?.[offId]?.off, 0.6)
  const hurryPen = s.twoMinMode === 'hurry' ? 1.3 : 1
  // FUTURES #6: the road offence false-starts more in a loud house; the home side
  // carries the centering offset. Exactly 1 with weather off, so the base is exact.
  const crowdPen = wxFor(s, offId === s.homeId)?.falseStartMult ?? 1
  if (s.rng() < R2.penOffRate * offDisc * hurryPen * (s.mental[offId]?.off ?? 1) * crowdPen) {
    const penS = statFor(s, offId)
    const startY = s.yard
    const py = penaltyYards(`${s.n}:penO:${offId}`, 'off')
    const kind = pickPenaltyKind(world, s, 'off', offId, defId, offId !== s.homeId, py, penFields?.off, penFields?.def)
    const info = PENALTY_INFO[kind]
    const offender = penaltyOffender(world, offId, 'off', info.pos, `${s.n}:penOffender:${offId}`, kind, penFields?.off)
    const who = shortName(offender?.name)
    s.yard = clamp(s.yard - py, 1, 99)
    // R2: penalties are not scrimmage plays (the stat counts rushes + pass attempts).
    const t = 22 * s.pace
    s.clock -= t
    penS.top += t
    pushPlay(s, { type: 'penalty', concept: info.label, penaltyKind: kind, penaltyTeam: offId, penaltyPlayerId: offender?.id, penaltyDisposition: 'accepted', yards: -py, result: `${info.label} on ${who} — ${py} yards, replay down`, turnover: false, startYard: startY, endYard: s.yard, down: s.down, distance: s.distance, timeUsed: 22 })
    s.distance = Math.min(s.distance + py, 100 - s.yard)
    return 'continue'
  }

  // 4th-down resolution (the choice was made before any rng draw this step).
  // A fake falls through to the ordinary scrimmage play below.
  if (isFourth && fourthChoice !== 'go' && fourthChoice !== 'fake') {
    if (fourthChoice === 'fg') {
      const out = resolveSpecial(world, s.rng, offId, 'fg', s.yard, envFor(s), offId === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore, s.n)
      s.clock -= out.timeUsed * s.pace
      const good = !out.turnover
      const fgS = statFor(s, offId)
      fgS.fgAtt += 1
      if (good) {
        if (offId === s.homeId) s.homeScore += 3
        else s.awayScore += 3
        fgS.points += 3
        fgS.fgMade += 1
      }
      pushPlay(s, { ...out, startYard: s.yard, endYard: s.yard, down: 4, distance: s.distance })
      restartAfterFieldGoal(s, good)
      return 'continue'
    }
    const out = resolveSpecial(world, s.rng, offId, 'punt', s.yard, envFor(s), offId === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore, s.n, defId, planForClub(s, defId).pr, planForClub(s, offId).punt)
    s.clock -= out.timeUsed * s.pace
    const newYard = clamp(s.yard + out.yards, 1, 99)
    pushPlay(s, { ...out, startYard: s.yard, endYard: out.returnTD ? 100 : newYard, down: 4, distance: s.distance })
    if (out.returnTD) {
      // R6: the receiving club took the punt back for a touchdown.
      if (defId === s.homeId) s.homeScore += 6
      else s.awayScore += 6
      statFor(s, defId).points += 6
      swapPossession(s)
      s.down = 1
      s.distance = 10
      if (s.qtr <= 4) {
        s.phase = 'try'
        return 'continue'
      }
      pushPlay(s, { type: 'end', concept: 'Overtime', yards: 0, result: 'Walk-off score — Final (OT)', startYard: s.yard, endYard: s.yard, down: null, distance: null, timeUsed: 0 })
      return 'done'
    }
    if (out.returnKind === 'muff') {
      // R6: the punting club recovers its own muffed punt and keeps the ball.
      s.yard = newYard
      s.down = 1
      s.distance = 10
      return 'continue'
    }
    swapPossession(s)
    s.yard = 100 - newYard
    s.down = 1
    s.distance = 10
    return 'continue'
  }

  const env = envFor(s)
  // FUTURES #4: an alerted opponent is a beat quicker against a scouted fake. A
  // small negative edge, and exactly 0 when there is no scouting read (a fresh
  // world, a fast sim or the calibration harness is untouched).
  if (fourthChoice === 'fake') {
    const stMem = world.stMemory && world.stMemory.season === world.season ? world.stMemory.teams : undefined
    const a = alertFakeEdge(alertness(stMem?.[offId]))
    if (a !== 0) call = { edge: (call?.edge ?? 0) + a, sackMult: call?.sackMult ?? 1 }
  }
  const out = concept.type === 'pass'
    ? resolvePass(world, s.rng, offId, defId, concept, s.yard, offStyle(world, offId).passRate, s.tier, clutchFor(world, offId, s.down, s.yard) + clutchEdge(world, s, offId, defId, 'pass'), env, call, s.n, s.mastery, s.distance ?? 0, s.down ?? 0)
    : resolveRun(world, s.rng, offId, defId, concept, s.distance, s.yard, s.tier, clutchFor(world, offId, s.down, s.yard) + clutchEdge(world, s, offId, defId, 'run'), env, call, s.n, s.mastery)
  // animflow r6b: record (read-only) how tired each man was at the snap, for the broadcast.
  if (out.onFieldOff && out.onFieldDef) out.fatOn = [...out.onFieldOff, ...out.onFieldDef].map((id) => Math.round((s.fat[id] ?? 0) * 100))
  // R15: charge the snap (and its stamina cost) to the players actually on the field.
  chargeSnaps(s, out)

  // FUTURES #5: the officiating layer marks close plays and, in the booth domain,
  // records what the replay showed. C1 always applies the truth, so outcomes and
  // the rng stream are unchanged. A booth review record rides the pushed play.
  const off = officiate(world, s, out, fourthChoice)
  const playIdx = s.plays.length
  const defCall = userDefCall ?? (defIsUser ? defCallForPlan(planFor(defId, 'def') ?? BALANCED_PLAN) : undefined)
  // C2: a challenge-domain close call keeps the truth plus a pre-apply snapshot,
  // so the hurt club can throw the flag at the start of the next step.
  if (off.challenge) {
    s.review = {
      playIdx,
      truth: off.truth,
      kind: off.challenge.kind,
      wrong: off.challenge.wrong,
      hurt: off.challenge.hurt,
      ruling: off.challenge.ruling,
      fourthChoice,
      defCall,
      snap: snapshotFor(s),
    }
  }
  const result = applyScrimmageOutcome(world, s, off.applied, fourthChoice, offId, defId, defCall)
  if (off.review) {
    const rec = s.plays[playIdx]
    if (rec) rec.review = off.review
  }
  return result
}

/**
 * Advance the game until a decision is due or it ends. Delegates to `runUntil`
 * so the paused and full-sim paths share one loop (L10 G1).
 */
export function runToMoment(world: World, s: GameState): Moment | null {
  return runUntil(world, s, 'moment')
}

/**
 * Advance the game, stopping between steps at the requested granularity (L11.5
 * Q2). The stop is only ever observed *between* steps — never inside one — so
 * the RNG stream and every resolved play are exactly what a full run-to-moment
 * would draw.
 *  - `'play'`   → one step that produces a play (or a moment), then stop.
 *  - `'drive'`  → until the possession changes, a moment, or the game ends.
 *  - `'moment'` → until the next moment or the game ends.
 */
export function runUntil(world: World, s: GameState, stop: 'play' | 'drive' | 'moment'): Moment | null {
  for (;;) {
    if (s.done) return null
    // A moment raised before the loop (e.g. the opening kickoff in createGame) is
    // surfaced first — normally only `step` sets `pending`, so this is a no-op.
    if (s.pending) return s.pending
    const playsBefore = s.plays.length
    const offBefore = s.offId
    const r = step(world, s)
    if (r === 'moment') return s.pending
    if (r === 'done') {
      s.done = true
      return null
    }
    if (stop === 'moment') continue
    if (stop === 'play' && s.plays.length > playsBefore) return null
    if (stop === 'drive' && s.offId !== offBefore) return null
  }
}

/** Record the user's answer for state.pending (must be one of its option ids). */
export function answerMoment(s: GameState, choiceId: string, source: 'user' | 'standing' = 'user'): void {
  const m = s.pending
  if (!m) return
  if (!m.options.some((o) => o.id === choiceId)) return
  s.answers[m.id] = choiceId
  if (source === 'standing') (s.autoAnswered ??= {})[m.id] = true
  s.pending = null
}

export function finishGame(s: GameState): GameSim {
  return {
    homeId: s.homeId,
    awayId: s.awayId,
    homeScore: s.homeScore,
    awayScore: s.awayScore,
    plays: s.plays,
    stats: s.stats,
    decisions: s.decisions.length ? s.decisions : undefined,
    snaps: s.snaps,
    snapSide: s.snapSide,
    specialists: s.specialists,
    fatigue: s.fat,
    weather: s.weather,
  }
}

export function simulatePlayByPlay(world: World, homeId: string, awayId: string, seed: number, ctx?: GameCtx, weather?: GameWeather): GameSim {
  const s = createGame(world, homeId, awayId, seed, ctx, weather)
  for (let m = runToMoment(world, s); m; m = runToMoment(world, s)) answerMoment(s, m.defaultId, 'standing')
  return finishGame(s)
}

// ── J7: matchup probe (DEV) ───────────────────────────────────────────────────
// Measures the matchups & busts layer against the BDB 2018 tracking targets:
// separation at arrival by air depth, completion % by separation tier, the
// elite-vs-poor covering-defender spread, the mismatch and bust rates — and the
// RAW mean of the matchup separation term, which is hard-coded into
// `MU_CENTER.sep` so the layer is league-neutral. Pure (no React/DOM) so the
// offline verification script can import it.
export interface MatchupProbeOptions { games?: number; seeds?: number[] }

const MU_TARGET = {
  // bdb2021_2018 (NFL 2018), overall and by air depth.
  overall: { p50: 3.01, ge5: 0.2832, ge7: 0.1457, le1: 0.155 },
  air: {
    screen: { p50: 5.979, ge5: 0.6237, ge7: 0.3739, le1: 0.0199 },
    short: { p50: 2.796, ge5: 0.2191, ge7: 0.0968, le1: 0.1401 },
    mid: { p50: 1.874, ge5: 0.1188, ge7: 0.0386, le1: 0.2377 },
    deep: { p50: 1.239, ge5: 0.0671, ge7: 0.0214, le1: 0.3876 },
  },
  // Completion % by separation bucket (bdb2021_2018, selected attempts).
  comp: { le1: 0.408, '1-2': 0.665, '2-3': 0.795, '3-5': 0.865, '5-7': 0.903, ge7: 0.905 },
  // Completion % allowed by the nearest defender's position.
  posComp: { CB: 0.713, S: 0.748, LB: 0.827 } as Record<string, number>,
  mismComp: { WR_LB: 0.847, TE_LB: 0.807, RB_LB: 0.826, WR_CB: 0.702 },
  bust: { share_of_all: 0.0101, comp: 0.8416 },
  // Per-defender spread (min 30 targets): p10/p50/p90 completion % allowed.
  perDef: { p10: 0.617, p50: 0.735, p90: 0.86 },
}

function q(sorted: number[], f: number): number {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * f)))]
}

export function matchupProbe(world: World, opts: MatchupProbeOptions = {}) {
  const games = opts.games ?? 40
  const nfl = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
  if (nfl.length < 2) return { error: 'no NFL teams' }
  const byId = new Map(world.players.map((p) => [p.id, p]))
  MU_STAT.on = true; MU_STAT.n = 0; MU_STAT.rawSep = 0; MU_STAT.rawSep2 = 0; MU_STAT.rawComp = 0; MU_STAT.busts = 0; MU_STAT.miscalls = 0; MU_STAT.raw = []

  interface Rec { yd: number; depth: number; tag: string; comp: boolean; covPos: string; tgtPos: string; covId: string; covMcv: number }
  const recs: Rec[] = []
  const done = new Set<number>()
  for (let g = 0; g < games; g++) {
    const home = nfl[g % nfl.length]
    const away = nfl[(g + 1) % nfl.length]
    if (!home || !away || home.id === away.id) continue
    const seed = opts.seeds?.[g] ?? world.seed + g * 7919 + 13
    if (done.has(seed)) continue
    done.add(seed)
    const sim = simulatePlayByPlay(world, home.id, away.id, seed)
    for (const play of sim.plays) {
      if (play.type !== 'pass' || play.separationYd == null || !play.coverTag) continue
      if (play.result.startsWith('Sack')) continue
      const comp = play.reception ?? (!play.intId && (play.result === 'Complete' || play.result === 'Explosive play!' || play.result === 'TOUCHDOWN!' || !!play.fumbleId || !!play.muffedCatch))
      const cov = play.coverDefenderId ? byId.get(play.coverDefenderId) : undefined
      const tgt = play.targetId ? byId.get(play.targetId) : undefined
      recs.push({
        yd: play.separationYd, depth: play.muAirDepth ?? play.passDepth ?? 0, tag: play.coverTag, comp: !!comp,
        covPos: cov?.pos ?? '', tgtPos: tgt?.pos ?? '',
        covId: play.coverDefenderId ?? '', covMcv: cov ? (mkAttrs(cov).MCV ?? 70) : 70,
      })
    }
  }
  MU_STAT.on = false

  const bucketOf = (d: number) => (d <= 2 ? 'screen' : d <= 9 ? 'short' : d <= 19 ? 'mid' : 'deep')
  const n = recs.length
  const comp = (a: Rec[]) => (a.length ? +(a.filter((r) => r.comp).length / a.length).toFixed(3) : 0)
  const dist = (a: Rec[]) => {
    const s = a.map((r) => r.yd).sort((x, y) => x - y)
    return {
      n: s.length, mean: +(s.reduce((x, y) => x + y, 0) / (s.length || 1)).toFixed(2),
      p10: q(s, 0.1), p25: q(s, 0.25), p50: q(s, 0.5), p75: q(s, 0.75), p90: q(s, 0.9),
      ge5: +(a.filter((r) => r.yd >= 5).length / (a.length || 1)).toFixed(3),
      ge7: +(a.filter((r) => r.yd >= 7).length / (a.length || 1)).toFixed(3),
      le1: +(a.filter((r) => r.yd <= 1).length / (a.length || 1)).toFixed(3),
      comp: comp(a),
    }
  }
  const byAir: Record<string, ReturnType<typeof dist>> = {}
  for (const b of ['screen', 'short', 'mid', 'deep']) byAir[b] = dist(recs.filter((r) => bucketOf(r.depth) === b))
  const tagNames = ['blanket', 'tight', 'open', 'wide', 'bust', 'miscall']
  const tags = tagNames.map((t) => { const a = recs.filter((r) => r.tag === t); return { tag: t, n: a.length, share: +(a.length / (n || 1)).toFixed(3), sep: dist(a).mean, comp: comp(a) } })
  const sepBuckets: [string, (r: Rec) => boolean][] = [
    ['<=1', (r) => r.yd <= 1], ['1-2', (r) => r.yd > 1 && r.yd <= 2], ['2-3', (r) => r.yd > 2 && r.yd <= 3],
    ['3-5', (r) => r.yd > 3 && r.yd <= 5], ['5-7', (r) => r.yd > 5 && r.yd <= 7], ['>=7', (r) => r.yd > 7],
  ]
  const compByBucket = sepBuckets.map(([k, f]) => ({ bucket: k, n: recs.filter(f).length, comp: comp(recs.filter(f)) }))
  // Covering defender: elite vs poor CB, and the position mismatch.
  const cb = recs.filter((r) => r.covPos === 'CB')
  const elite = cb.filter((r) => r.covMcv >= 85)
  const poor = cb.filter((r) => r.covMcv < 70)
  const byCovPos = ['CB', 'S', 'LB'].map((p) => { const a = recs.filter((r) => r.covPos === p); return { pos: p, n: a.length, comp: comp(a), sep: dist(a).mean } })
  const isMismatch = (r: Rec) => (r.covPos === 'LB' || r.covPos === 'S') && (r.tgtPos === 'WR' || r.tgtPos === 'TE' || r.tgtPos === 'RB')
  const mm = recs.filter(isMismatch)
  // Per-defender spread (>= 10 targets).
  const byDef = new Map<string, Rec[]>()
  for (const r of recs) if (r.covId) { const a = byDef.get(r.covId); if (a) a.push(r); else byDef.set(r.covId, [r]) }
  const defComps = [...byDef.values()].filter((a) => a.length >= 10).map((a) => comp(a)).sort((x, y) => x - y)
  const bustRecs = recs.filter((r) => r.tag === 'bust' || r.tag === 'miscall')
  const rawMeanSep = MU_STAT.n ? +(MU_STAT.rawSep / MU_STAT.n).toFixed(4) : 0
  const rawMeanComp = MU_STAT.n ? +(MU_STAT.rawComp / MU_STAT.n).toFixed(4) : 0
  const rawVar = MU_STAT.n ? MU_STAT.rawSep2 / MU_STAT.n - rawMeanSep * rawMeanSep : 0
  const rawSorted = [...MU_STAT.raw].sort((x, y) => x - y)

  return {
    games, passes: n, overall: dist(recs),
    byAir,
    tags, compByBucket,
    compByPos: byCovPos,
    eliteCb: { n: elite.length, comp: comp(elite), sep: dist(elite).mean },
    poorCb: { n: poor.length, comp: comp(poor), sep: dist(poor).mean },
    mismatch: { n: mm.length, share: +(mm.length / (n || 1)).toFixed(3), comp: comp(mm), sep: dist(mm).mean },
    bust: { n: bustRecs.length, share: +(bustRecs.length / (n || 1)).toFixed(4), comp: comp(bustRecs) },
    perDefenderComp: { n: defComps.length, p10: +q(defComps, 0.1).toFixed(3), p50: +q(defComps, 0.5).toFixed(3), p90: +q(defComps, 0.9).toFixed(3) },
    raw: {
      n: MU_STAT.n, meanSep: rawMeanSep, sdSep: +Math.sqrt(Math.max(0, rawVar)).toFixed(2),
      p10: q(rawSorted, 0.1), p50: q(rawSorted, 0.5), p90: q(rawSorted, 0.9),
      meanComp: rawMeanComp, busts: MU_STAT.busts, miscalls: MU_STAT.miscalls,
      centerSuggested: { sep: rawMeanSep, comp: rawMeanComp },
    },
    target: MU_TARGET,
  }
}

// ── J8b: rush/protection probe (DEV) ─────────────────────────────────────────
// Measures the RAW league means of the new individual rush edge and of the player
// terms it replaces, so `PB_CENTER.edge` can be set once (the `WX_CENTER` pattern)
// and the layer stays league-neutral. Pure (no React/DOM).
export interface ProtectionProbeOptions { games?: number; seeds?: number[] }

export function protectionProbe(world: World, opts: ProtectionProbeOptions = {}) {
  const games = opts.games ?? 40
  const nfl = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
  if (nfl.length < 2) return { error: 'no NFL teams' }
  PB_STAT.on = true
  PB_STAT.n = 0
  PB_STAT.raw = 0
  PB_STAT.old = 0
  const done = new Set<number>()
  let played = 0
  for (let g = 0; g < games; g++) {
    const home = nfl[g % nfl.length]
    const away = nfl[(g + 1) % nfl.length]
    if (!home || !away || home.id === away.id) continue
    const seed = opts.seeds?.[g] ?? world.seed + g * 7919 + 13
    if (done.has(seed)) continue
    done.add(seed)
    simulatePlayByPlay(world, home.id, away.id, seed)
    played++
  }
  PB_STAT.on = false
  const n = PB_STAT.n
  const rawMean = n ? PB_STAT.raw / n : 0
  const oldMean = n ? PB_STAT.old / n : 0
  return {
    games: played,
    dropbacks: n,
    rawEdgeMean: +rawMean.toFixed(4),
    oldTermMean: +oldMean.toFixed(4),
    centerSuggested: { edge: +(rawMean - oldMean).toFixed(4) },
  }
}


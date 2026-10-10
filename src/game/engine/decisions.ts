// ─────────────────────────────────────────────────────────────────────────────
// Game-day decisions (L10 G2).
//
// Pure functions that a head coach (user or AI) uses to call the big moments:
// 4th downs, 2-point tries, and (later) timeouts. AI coaches decide with the
// same functions, with a call sheet scaled by their head-coach rating.
// ─────────────────────────────────────────────────────────────────────────────

import type { World } from './generate'
import type { GamePlan } from './gameplan'
import { clamp, hash32 } from './rng'

export type FourthStyle = 'conservative' | 'standard' | 'aggressive'

export interface CallSheet {
  fourth: FourthStyle
  twoPoint: 'chart' | 'kick' | 'go'
  timeouts: 'save' | 'aggressive'
}

export const DEFAULT_CALL_SHEET: CallSheet = { fourth: 'standard', twoPoint: 'chart', timeouts: 'save' }

export interface Situation {
  yard: number
  down: number
  distance: number
  qtr: number
  clockSec: number
  /** Offense score − defense score. */
  margin: number
}

/** Expected points for a 1st & 10 at `yard` (0–100 from the offense's own goal). */
export function epAt(yard: number): number {
  return -0.6 + yard * 0.068
}

/** Chance to convert `distance` yards on one snap. */
export function convertProb(distance: number): number {
  if (distance <= 1) return 0.68
  if (distance === 2) return 0.6
  if (distance === 3) return 0.55
  if (distance === 4) return 0.5
  if (distance === 5) return 0.45
  if (distance <= 7) return 0.38
  if (distance <= 10) return 0.3
  return 0.22
}

/** R2: base values for the FG make model, tunable as a single constant pair. */
export const FG_TUNE = { base: 0.995, slope: 0.014 }

/** FG make chance — shares the formula used by resolveSpecial in playsim.
 *  R2: retuned to the 2015–2024 NFL average (≈ 84–85% of attempts made). */
export function fgProb(yard: number, kickPower: number): number {
  const dist = 100 - yard + 17
  const make = FG_TUNE.base - Math.max(0, dist - 33) * FG_TUNE.slope + (kickPower - 80) * 0.004
  return Math.max(0.45, Math.min(0.99, make))
}

/** R17: the minimum own-yard line a club will consider a field goal from (a
 *  higher value = a shorter kick). Scales with the kicker's power — a big leg
 *  (KPW 95) attempts from ~3 yards deeper than a weak one (KPW 78) — using the
 *  same KPW/KAC blend the make model uses. */
export function fgRangeYard(kickPower: number): number {
  return 57 - (kickPower - 88) * 0.22
}

/** EV of each 4th-down option for the offense. `fg` is null outside FG range. */
export function fourthDownEV(s: Situation, kickPower: number): { go: number; fg: number | null; punt: number } {
  const p = convertProb(s.distance)
  const q = fgProb(s.yard, kickPower)
  // Modern fourth-down analytics value possession a touch higher than the raw
  // expected-points curve implies; the flat bonus keeps the CALIBRATED go-rate
  // near the 2015–2024 NFL norm across every field zone instead of only in plus
  // territory. It is a decision-model knob, not a play-outcome change.
  const go = p * epAt(Math.min(99, s.yard + s.distance)) - (1 - p) * epAt(100 - s.yard) + GO_BONUS
  const fg = s.yard < fgRangeYard(kickPower) ? null : q * (3 - epAt(25)) - (1 - q) * epAt(100 - s.yard)
  // A 40-yard net punt, touchback at the 20.
  const punt = -epAt(100 - Math.min(80, s.yard + 40))
  return { go, fg, punt }
}

/** R2: flat 4th-down possession bonus (see fourthDownEV). */
export const GO_BONUS = 0.8

export function fourthDownChoice(style: FourthStyle, s: Situation, kickPower: number): 'go' | 'fg' | 'punt' {
  const ev = fourthDownEV(s, kickPower)
  const inRange = ev.fg != null
  // Any style: down 4 in Q4, last two minutes, trailing by 1–8.
  if (s.qtr === 4 && s.clockSec <= 120 && s.margin <= -1 && s.margin >= -8) {
    // A FG that ties or wins gets the call; otherwise go.
    return inRange && s.margin >= -3 ? 'fg' : 'go'
  }
  const val = (id: 'go' | 'fg' | 'punt') => (id === 'go' ? ev.go : id === 'fg' ? (ev.fg as number) : ev.punt)
  const ranked: ('go' | 'fg' | 'punt')[] = inRange ? ['go', 'fg', 'punt'] : ['go', 'punt']
  ranked.sort((a, b) => val(b) - val(a))
  const best = ranked[0]

  if (style === 'conservative') {
    if (s.distance <= 1 && s.yard >= 45) return 'go'
    return inRange ? 'fg' : 'punt'
  }
  if (style === 'aggressive') {
    if (s.distance <= 6 && ev.go >= val(best) - 0.4) return 'go'
    return best === 'go' ? (inRange ? 'fg' : 'punt') : best
  }
  // standard: the best EV, but go whenever it wins on 4th & short/medium (the
  // modern NFL is more aggressive than the old <= 4 threshold).
  if (best === 'go' && s.distance > 7) return inRange ? 'fg' : 'punt'
  return best
}

export function twoPointChoice(rule: 'chart' | 'kick' | 'go', marginAfterTD: number, qtr: number): 'kick' | 'go2' {
  if (rule === 'kick') return 'kick'
  const chartGo = qtr === 4 && [-2, -5, -9, -10, 1, 5].includes(marginAfterTD)
  // R18: an aggressive head coach also chases the deficit on two in the fourth
  // quarter instead of waiting for the exact chart margins.
  if (rule === 'go') return chartGo || (qtr === 4 && marginAfterTD <= 0 && marginAfterTD >= -8) ? 'go2' : 'kick'
  return chartGo ? 'go2' : 'kick'
}

// ── R18: coaching tendencies ──────────────────────────────────────────────────
// Each club's head coach (and offensive coordinator) gets a deterministic
// personality: how aggressive he is on 4th down, whether he chases two points,
// his run/pass identity, how he uses timeouts, and his tempo. Derived from the
// staff's ratings, scheme and specialty plus a stable per-coach hash — never an
// rng() draw, so the seed stream and coached/sim equivalence are untouched.

/** Offensive pass-rate identity per OC scheme (the single source offStyle reads).
 *  R2 variance fix: each seed draws a different mix of the 32 OC schemes, and the
 *  old 0.47–0.62 spread swung a league's average pass rate by ~3.5 points between
 *  seeds — enough to move sacks, rush volume and scoring in and out of band on
 *  roster-identical leagues. The identities are compressed 75% toward the league
 *  mean (0.534), so the direction is unchanged (Air Raid still passes most, RPO
 *  Heavy still runs most) but the per-seed variance is bounded and football-sized;
 *  this keeps the run-heaviest league's rush volume and the pass-heaviest league's
 *  scoring from straddling the band edges together. */
export const OFF_PASS_RATE: Record<string, number> = {
  'Air Raid': 0.5684,
  'Pro Style': 0.5204,
  Spread: 0.5404,
  'West Coast': 0.5324,
  'RPO Heavy': 0.5084,
}

export interface CoachTendency {
  /** 4th-down aggressiveness. */
  fourth: FourthStyle
  /** Two-point appetite: follow the chart, always kick, or chase it. */
  twoPoint: 'chart' | 'kick' | 'go'
  /** Run/pass identity: pass share outside obvious passing downs (0–1). */
  passRate: number
  /** Timeout usage. */
  timeouts: 'save' | 'aggressive'
  /** Tempo: −1 deliberate … +1 up-tempo. */
  tempo: number
}

/** Head-coach specialty nudges to the aggression score (league mean ≈ 0). */
const HC_AGGRO: Record<string, number> = {
  'Play Calling': 0.55,
  'Red Zone': 0.35,
  'QB Development': 0.1,
  'Pass Rush': 0.05,
  Secondary: -0.05,
  'Talent Evaluation': -0.1,
  'College Scouting': -0.1,
  'Pro Personnel': -0.05,
  'O-Line Play': -0.2,
  'Culture Builder': -0.55,
}

/** Coordinator scheme pace (Air Raid up-tempo … RPO Heavy deliberate). */
const OC_TEMPO: Record<string, number> = {
  'Air Raid': 0.5,
  Spread: 0.3,
  'West Coast': 0,
  'Pro Style': -0.15,
  'RPO Heavy': -0.35,
}

export function coachTendency(world: World, teamId: string): CoachTendency {
  const staff = world.staff[teamId] ?? []
  const hc = staff.find((s) => s.role === 'Head Coach')
  const oc = staff.find((s) => s.role === 'Offensive Coordinator')
  const hcRating = hc?.rating ?? 74
  const ocRating = oc?.rating ?? 74
  // Per-coach personality from a stable hash, centered on zero (−0.3..+0.3).
  const jitter = (hash32(hc?.id ?? teamId, 41) / 4294967296 - 0.5) * 0.6
  const aggro = (hcRating - 74) / 10 + (HC_AGGRO[hc?.specialty ?? ''] ?? 0) + jitter
  const fourth: FourthStyle = aggro >= 0.8 ? 'aggressive' : aggro <= -0.8 ? 'conservative' : 'standard'
  const twoPoint: CoachTendency['twoPoint'] = aggro >= 0.7 ? 'go' : 'chart'
  const timeouts: CoachTendency['timeouts'] = hcRating >= 75 || hc?.specialty === 'Play Calling' ? 'aggressive' : 'save'
  const passRate = OFF_PASS_RATE[oc?.scheme ?? ''] ?? OFF_PASS_RATE['Pro Style']
  const tempo = clamp((OC_TEMPO[oc?.scheme ?? ''] ?? 0) + (ocRating - 74) / 120, -1, 1)
  return { fourth, twoPoint, passRate, timeouts, tempo }
}

/** An AI club's call sheet, derived from its coaching tendencies (R18). */
export function aiCallSheet(world: World, teamId: string): CallSheet {
  const t = coachTendency(world, teamId)
  return { fourth: t.fourth, twoPoint: t.twoPoint, timeouts: t.timeouts }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tendencies and play-calling (L10 G8/G9).
//
// Every snap falls in a down-and-distance bucket. Offensive snaps are a run,
// a short pass, or a deep pass; defensive snaps are a blitz, man, zone, or
// stack call. The tendency book counts them; the call matrix is the zero-sum
// rock-paper-scissors edge the user's calls earn (and the AI exploits).
// ─────────────────────────────────────────────────────────────────────────────

export type Bucket = '1st' | '2nd-short' | '2nd-long' | '3rd-short' | '3rd-mid' | '3rd-long' | 'redzone'
export type OffClass = 'run' | 'short' | 'deep'
export type DefCall = 'blitz' | 'man' | 'zone' | 'stack' | 'twoHigh'
export interface TendencyBook {
  off: Record<Bucket, Record<OffClass, number>>
  def: Record<Bucket, Record<DefCall, number>>
}

export const BUCKETS: Bucket[] = ['1st', '2nd-short', '2nd-long', '3rd-short', '3rd-mid', '3rd-long', 'redzone']
export const OFF_CLASSES: OffClass[] = ['run', 'short', 'deep']
export const DEF_CALLS: DefCall[] = ['blitz', 'man', 'zone', 'stack', 'twoHigh']

export const BUCKET_LABEL: Record<Bucket, string> = {
  '1st': '1st down',
  '2nd-short': '2nd & short',
  '2nd-long': '2nd & long',
  '3rd-short': '3rd & short',
  '3rd-mid': '3rd & medium',
  '3rd-long': '3rd & long',
  redzone: 'the red zone',
}

export const OFF_CLASS_LABEL: Record<OffClass, string> = { run: 'run', short: 'throw short', deep: 'throw deep' }
export const DEF_CALL_LABEL: Record<DefCall, string> = {
  blitz: 'Blitz', man: 'Man coverage', zone: 'Zone coverage', stack: 'Stack the box', twoHigh: 'Two-high (Cover 2/4)',
}

/** The down-and-distance bucket a snap belongs to. `yard` is 0–100 from the offense's own goal. */
export function bucketFor(down: number, distance: number, yard: number): Bucket {
  if (yard >= 80) return 'redzone'
  if (down <= 1) return '1st'
  if (down === 2) return distance <= 3 ? '2nd-short' : '2nd-long'
  // 3rd and 4th down both hinge on the sticks.
  return distance <= 3 ? '3rd-short' : distance <= 6 ? '3rd-mid' : '3rd-long'
}

/** Classify a concept: run, short pass (depth ≤ 8), or deep pass (depth ≥ 9). */
export function offClassFor(type: 'run' | 'pass', depth: number): OffClass {
  if (type === 'run') return 'run'
  return depth >= 9 ? 'deep' : 'short'
}

export function emptyBook(): TendencyBook {
  const off = {} as Record<Bucket, Record<OffClass, number>>
  const def = {} as Record<Bucket, Record<DefCall, number>>
  for (const b of BUCKETS) {
    off[b] = { run: 0, short: 0, deep: 0 }
    def[b] = { blitz: 0, man: 0, zone: 0, stack: 0, twoHigh: 0 }
  }
  return { off, def }
}

/** Zero-sum call matrix (the edge is added to the offense). */
const CALL_MATRIX: Record<OffClass, Record<DefCall, number>> = {
  run: { blitz: 2, man: 1, zone: 0, stack: -3, twoHigh: 2 },
  short: { blitz: 3, man: -2, zone: 1, stack: -2, twoHigh: 1 },
  deep: { blitz: -1, man: 2, zone: -3, stack: 2, twoHigh: -3 },
}

export interface CallEffect { edge: number; sackMult: number }

export function callEdge(off: OffClass, def: DefCall): number {
  return CALL_MATRIX[off][def]
}

/** The matrix edge plus any special rule (a deep shot into the blitz risks a sack). */
export function callEffect(off: OffClass, def: DefCall): CallEffect {
  return { edge: CALL_MATRIX[off][def], sackMult: off === 'deep' && def === 'blitz' ? 1.3 : 1 }
}

/** The defensive call that best counters an offensive class (lowest edge for the offense). */
export function bestCounterCall(off: OffClass): DefCall {
  let best: DefCall = 'zone'
  let lo = Infinity
  for (const d of DEF_CALLS) {
    if (CALL_MATRIX[off][d] < lo) { lo = CALL_MATRIX[off][d]; best = d }
  }
  return best
}

/** The offensive class that best beats a defensive call (highest edge for the offense). */
export function bestCounterClass(def: DefCall): OffClass {
  let best: OffClass = 'short'
  let hi = -Infinity
  for (const c of OFF_CLASSES) {
    if (CALL_MATRIX[c][def] > hi) { hi = CALL_MATRIX[c][def]; best = c }
  }
  return best
}

/** The defensive call implied by a saved defensive plan (the defCall standing order). */
export function defCallForPlan(plan: GamePlan): DefCall {
  if (plan.aggression >= 1.5) return 'blitz'
  if (plan.coverage <= 0.3) return 'zone'
  if (plan.coverage >= 1.7) return 'man'
  if (plan.aggression >= 1.2) return 'stack'
  return 'zone'
}

/** The most-used key in a count map (first key wins ties). */
export function topKey<T extends string>(counts: Record<T, number>, keys: readonly T[]): { key: T; count: number; total: number; share: number } {
  let key = keys[0]
  let count = -1
  let total = 0
  for (const k of keys) {
    const v = counts[k] ?? 0
    total += v
    if (v > count) { count = v; key = k }
  }
  return { key, count: Math.max(0, count), total, share: total ? Math.max(0, count) / total : 0 }
}

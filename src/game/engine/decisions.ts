// ─────────────────────────────────────────────────────────────────────────────
// Game-day decisions (L10 G2).
//
// Pure functions that a head coach (user or AI) uses to call the big moments:
// 4th downs, 2-point tries, and (later) timeouts. AI coaches decide with the
// same functions, with a call sheet scaled by their head-coach rating.
// ─────────────────────────────────────────────────────────────────────────────

import type { World } from './generate'
import type { GamePlan } from './gameplan'

export type FourthStyle = 'conservative' | 'standard' | 'aggressive'

export interface CallSheet {
  fourth: FourthStyle
  twoPoint: 'chart' | 'kick'
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

/** FG make chance — shares the formula used by resolveSpecial in playsim. */
export function fgProb(yard: number, kickPower: number): number {
  const dist = 100 - yard + 17
  const make = 0.99 - Math.max(0, dist - 33) * 0.015 + (kickPower - 80) * 0.004
  return Math.max(0.45, Math.min(0.99, make))
}

/** EV of each 4th-down option for the offense. `fg` is null outside FG range. */
export function fourthDownEV(s: Situation, kickPower: number): { go: number; fg: number | null; punt: number } {
  const p = convertProb(s.distance)
  const q = fgProb(s.yard, kickPower)
  const go = p * epAt(Math.min(99, s.yard + s.distance)) - (1 - p) * epAt(100 - s.yard)
  const fg = s.yard < 52 ? null : q * (3 - epAt(25)) - (1 - q) * epAt(100 - s.yard)
  // A 40-yard net punt, touchback at the 20.
  const punt = -epAt(100 - Math.min(80, s.yard + 40))
  return { go, fg, punt }
}

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
  // standard: the best EV, but go only when distance <= 4.
  if (best === 'go' && s.distance > 4) return inRange ? 'fg' : 'punt'
  return best
}

export function twoPointChoice(rule: 'chart' | 'kick', marginAfterTD: number, qtr: number): 'kick' | 'go2' {
  if (rule === 'kick') return 'kick'
  const chartGo = qtr === 4 && [-2, -5, -9, -10, 1, 5].includes(marginAfterTD)
  return chartGo ? 'go2' : 'kick'
}

/** An AI club's call sheet, scaled by its head-coach rating. */
export function aiCallSheet(world: World, teamId: string): CallSheet {
  const hc = (world.staff[teamId] ?? []).find((s) => s.role === 'Head Coach')
  const rating = hc?.rating ?? 74
  const fourth: FourthStyle = rating >= 82 ? 'aggressive' : rating <= 66 ? 'conservative' : 'standard'
  return { fourth, twoPoint: 'chart', timeouts: rating >= 75 ? 'aggressive' : 'save' }
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
export type DefCall = 'blitz' | 'man' | 'zone' | 'stack'
export interface TendencyBook {
  off: Record<Bucket, Record<OffClass, number>>
  def: Record<Bucket, Record<DefCall, number>>
}

export const BUCKETS: Bucket[] = ['1st', '2nd-short', '2nd-long', '3rd-short', '3rd-mid', '3rd-long', 'redzone']
export const OFF_CLASSES: OffClass[] = ['run', 'short', 'deep']
export const DEF_CALLS: DefCall[] = ['blitz', 'man', 'zone', 'stack']

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
  blitz: 'Blitz', man: 'Man coverage', zone: 'Zone coverage', stack: 'Stack the box',
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
    def[b] = { blitz: 0, man: 0, zone: 0, stack: 0 }
  }
  return { off, def }
}

/** Zero-sum call matrix (the edge is added to the offense). */
const CALL_MATRIX: Record<OffClass, Record<DefCall, number>> = {
  run: { blitz: 2, man: 1, zone: 0, stack: -3 },
  short: { blitz: 3, man: -2, zone: 1, stack: -2 },
  deep: { blitz: -1, man: 2, zone: -3, stack: 2 },
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

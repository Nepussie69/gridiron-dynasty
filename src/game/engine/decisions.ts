// ─────────────────────────────────────────────────────────────────────────────
// Game-day decisions (L10 G2).
//
// Pure functions that a head coach (user or AI) uses to call the big moments:
// 4th downs, 2-point tries, and (later) timeouts. AI coaches decide with the
// same functions, with a call sheet scaled by their head-coach rating.
// ─────────────────────────────────────────────────────────────────────────────

import type { World } from './generate'

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

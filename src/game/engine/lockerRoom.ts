// ─────────────────────────────────────────────────────────────────────────────
// Locker room (L15 · FUTURES row 16).
//
// Every club's room has a shape: the veterans whose makeup settles it (leaders),
// the young players who need pulling along (mentees), and the odd problem the
// room has to carry. You name up to three captains, pair young players with a
// captain to learn from, and can turn the room's morale into a small on-field
// effort edge.
//
// Two effects, both opt-in and user-only:
//   · Mentoring — a mentored young player grows a little faster at season end.
//     Applied only to the user's club (see `developPlayers`), only for players
//     the user actually paired, and with no `rng()` draw added or removed.
//   · Effort — when `effort` is on, the club's average morale nudges the user's
//     unit edge (see `applyUserCoaching`). Off by default, so AI-vs-AI
//     calibration and league results are untouched.
//
// The whole feature is information + optional choices. A legacy save with no
// `lockerRoom` loads clean (every reader falls back to defaults). Nothing here
// mutates a player; the career only stores ids.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player } from '../types'
import type { World } from './generate'
import { clamp } from './rng'

/** How many captains a room can name. */
export const MAX_CAPTAINS = 3
/** How many young players can be mentored at once. */
export const MAX_MENTEES = 6
/** The oldest age a player is still considered a mentee (rookies + sophomores). */
export const MAX_MENTEE_AGE = 23
/** At or above this distraction score a player reads as a problem. */
export const PROBLEM_MIN = 62
/** Growth multiplier a mentor can add to a young player's offseason step. */
const MENTOR_MIN = 0.10
const MENTOR_MAX = 0.26

/** The user's locker-room choices. Kept on the career so they travel with the save. */
export interface LockerRoomState {
  season: number
  /** Player ids the user named captain (max 3). */
  captains: string[]
  /** mentee player id → captain player id. */
  mentors: Record<string, string>
  /** Opt-in: the club's morale moves its on-field effort. Off by default. */
  effort?: boolean
}

/** This season's locker-room state, fresh if the stored one is from an earlier season. */
export function lockerRoomState(
  career: { lockerRoom?: LockerRoomState },
  season: number,
): LockerRoomState {
  const lr = career.lockerRoom
  if (lr && lr.season === season) return lr
  return { season, captains: [], mentors: {} }
}

/**
 * The young players who can take a mentor: age `MAX_MENTEE_AGE` and under, still
 * with room to grow, best upside first. Pure.
 */
export function menteesOf(world: World, teamId: string): Player[] {
  return (world.roster[teamId] ?? [])
    .filter((p) => p.age <= MAX_MENTEE_AGE && p.ovr < p.pot)
    .sort((a, b) => b.pot - b.ovr - (a.pot - a.ovr) || b.ovr - a.ovr)
}

/**
 * How much a veteran leads: his hidden makeup (work ethic, maturity,
 * coachability, clean record) plus his standing and years of service. 0–100.
 * Character always exists after world build; the fallback keeps it total.
 */
export function leaderScore(p: Player): number {
  const c = p.character
  if (!c) return Math.round(clamp(p.ovr * 0.7 + (p.morale - 50) * 0.3, 0, 100))
  const makeup =
    c.workEthic * 0.34 + c.maturity * 0.26 + c.coachability * 0.2 + (100 - c.offFieldRisk) * 0.2
  const veteran = clamp((p.age - 24) * 3.5, 0, 26)
  const standing = clamp((p.ovr - 62) * 0.6, -12, 24)
  const mood = (p.morale - 70) * 0.15
  return Math.round(clamp(makeup * 0.62 + veteran + standing + mood, 0, 100))
}

/**
 * The room's problem score: off-field risk, immaturity and a poor motor, plus
 * an unhappy mood. 0–100; `PROBLEM_MIN` and up reads as a problem player.
 */
export function problemScore(p: Player): number {
  const c = p.character
  const risk = c
    ? c.offFieldRisk * 0.5 + (100 - c.maturity) * 0.32 + (100 - c.workEthic) * 0.18
    : 55
  const mood = (60 - p.morale) * 0.5
  return Math.round(clamp(risk + mood, 0, 100))
}

/** The club's leaders, best first. */
export function rankedLeaders(world: World, teamId: string): Player[] {
  return [...(world.roster[teamId] ?? [])]
    .sort((a, b) => leaderScore(b) - leaderScore(a) || b.ovr - a.ovr)
}

/** The club's problem players (distraction score at or above the bar). */
export function problemPlayers(world: World, teamId: string): Player[] {
  return (world.roster[teamId] ?? [])
    .filter((p) => problemScore(p) >= PROBLEM_MIN)
    .sort((a, b) => problemScore(b) - problemScore(a))
}

/** The extra growth multiplier a mentee earns from his captain (0.10–0.26). */
export function mentorGrowthBonus(mentor: Player): number {
  const q = clamp((leaderScore(mentor) - 50) / 50, 0, 1)
  return MENTOR_MIN + q * (MENTOR_MAX - MENTOR_MIN)
}

/** Average morale of the club's top 22 by rating (the room's core). */
export function avgMorale(world: World, teamId: string): number {
  const core = [...(world.roster[teamId] ?? [])].sort((a, b) => b.ovr - a.ovr).slice(0, 22)
  if (!core.length) return 75
  return core.reduce((s, p) => s + p.morale, 0) / core.length
}

export interface EffortEdge {
  on: boolean
  morale: number
  off: number
  def: number
}

/**
 * The club's on-field effort from morale, when the user has opted in. Morale 75
 * is neutral; each ~3 points of morale is 0.2 of edge, clamped to ±1.2 so it can
 * never blow up the sim. Off (all zero) unless `career.lockerRoom.effort` is set.
 */
export function lockerEffort(
  world: World,
  career: { teamId: string; lockerRoom?: LockerRoomState },
): EffortEdge {
  const morale = avgMorale(world, career.teamId)
  if (!career.lockerRoom?.effort) return { on: false, morale, off: 0, def: 0 }
  const edge = clamp(((morale - 75) / 3) * 0.2, -1.2, 1.2)
  return { on: true, morale, off: edge, def: edge }
}

// ─────────────────────────────────────────────────────────────────────────────
// The "ghost GM" benchmark (#8).
//
// Each season the player's team is also run, on paper, by a league-average AI:
// given the club's talent and its schedule, what would a replacement-level
// manager have won? The gap between that projection and the actual result is the
// most honest score the game can give you:
//
//   "You were +3.2 wins over replacement."
//
// This is deliberately a *projection*, not a re-sim: it runs instantly at season
// end, never touches the live save, and measures exactly one thing — results
// against the talent you had. It is a verdict, never a scoring target (we must
// not create a dominant strategy around it).
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, GhostSeason } from '../types'
import { teamStrength, type Game, type World } from './generate'
import { clamp } from './rng'

/** A neutral strength-vs-strength win probability for a single game. */
function winProb(mine: number, theirs: number): number {
  // Strength is ~60-85. A 6-point edge is worth roughly +0.30 win prob.
  return clamp(0.5 + (mine - theirs) / 20, 0.08, 0.92)
}

/**
 * Project a replacement manager's win total for a team over its 18-game season.
 * Pooled by opponent strength and home field so the number is schedule-aware.
 */
export function ghostProjection(world: World, teamId: string): { wins: number; expected: number } {
  const mine = teamStrength(world.roster[teamId] ?? [])
  let expected = 0
  const games: Game[] = world.schedule.filter((g) => g.homeId === teamId || g.awayId === teamId)
  for (const g of games) {
    const oppId = g.homeId === teamId ? g.awayId : g.homeId
    const opp = teamStrength(world.roster[oppId] ?? [])
    const home = g.homeId === teamId ? 0.5 : -0.5
    expected += winProb(mine + home, opp)
  }
  return { wins: Math.round(expected), expected: Math.round(expected * 10) / 10 }
}

/**
 * At season end, record how the player's actual wins compare to the ghost.
 * Returns a new career with the season appended to `ghostHistory`.
 */
export function recordGhostSeason(world: World, career: CareerState, actualWins: number): CareerState {
  const { wins, expected } = ghostProjection(world, career.teamId)
  const entry: GhostSeason = {
    season: world.season,
    actualWins,
    ghostWins: wins,
    delta: Math.round((actualWins - expected) * 10) / 10,
  }
  return { ...career, ghostHistory: [...(career.ghostHistory ?? []), entry] }
}

/** Cumulative verdict across a career: your total wins above replacement. */
export function ghostVerdict(career: CareerState): { seasons: number; totalDelta: number; label: string } | null {
  const hist = career.ghostHistory ?? []
  if (!hist.length) return null
  const totalDelta = Math.round(hist.reduce((s, h) => s + h.delta, 0) * 10) / 10
  const perSeason = totalDelta / hist.length
  const label =
    perSeason >= 1.5 ? 'Elite' : perSeason >= 0.6 ? 'Above average' : perSeason >= -0.6 ? 'Replacement level' : 'Below replacement'
  return { seasons: hist.length, totalDelta, label }
}

// ─────────────────────────────────────────────────────────────────────────────
// FUTURES 18: the 3-year cap planner.
//
// A read-only projection of the money already on the books. For each of the
// next three league years it sums the cap hit of every contract still alive that
// season, carries the current dead-money charge into the present year (each new
// league year opens a clean dead-money book), and lists the deals that expire at
// the end of it. Nothing here feeds the sim — it is a planning overlay on the
// Cap screen, so a game's result never changes because of it.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player } from '../types'
import { capForSeason } from './cap'

export interface CapPlanYear {
  /** League year this column covers. */
  season: number
  /** Salary cap for that year (fixed in this build). */
  limit: number
  /** Cap hit of every contract still on the books that year. */
  committed: number
  /** Dead-money charge carried into that year (the present year only). */
  dead: number
  /** limit − committed − dead. */
  space: number
  overTheCap: boolean
  /** Players whose deal ends at the end of this season, best first. */
  expiring: Player[]
}

export interface CapPlanPlayer {
  player: Player
  /** Cap hit in each projected year; 0 once the deal has expired. */
  hits: number[]
  /** Sum of `hits`. */
  total: number
}

export interface CapPlan {
  horizon: number
  years: CapPlanYear[]
  /** Every player still on the books, biggest current hit first. */
  players: CapPlanPlayer[]
}

/** Coerce a possibly-missing money field to a usable number. */
function num(n: number | undefined): number {
  return Number.isFinite(n) ? (n as number) : 0
}

/**
 * Cap hit of one contract in a future year, `offset` years from now.
 * `offset === 0` is the present season; the deal counts for its remaining
 * `years` and nothing after — the model books void years as release-only dead
 * money, not as a future hit.
 */
export function projectedCapHit(c: Player['contract'], offset: number): number {
  if (offset < 0 || offset >= num(c.years)) return 0
  return Math.round(num(c.base?.[offset]) + num(c.proration))
}

/**
 * Project the club's cap for the next `horizon` league years.
 *
 * Only money already under contract is counted: it is the baseline you sign
 * against, not a forecast of moves you have not made (draft picks, re-signings
 * and next year's free-agency spend are all deliberately excluded).
 */
export function projectCap(roster: Player[], dead: number, season: number, horizon = 3): CapPlan {
  const players: CapPlanPlayer[] = [...roster]
    .map((player) => {
      const hits = Array.from({ length: horizon }, (_, y) => projectedCapHit(player.contract, y))
      return { player, hits, total: hits.reduce((s, v) => s + v, 0) }
    })
    .sort((a, b) => b.hits[0] - a.hits[0] || b.total - a.total)

  const years: CapPlanYear[] = []
  for (let y = 0; y < horizon; y++) {
    const limit = capForSeason(season + y)
    const committed = players.reduce((s, p) => s + p.hits[y], 0)
    // Restructured void years are only charged if the player is released, so
    // the books start clean every new league year: dead money is present-only.
    const deadY = y === 0 ? Math.round(num(dead)) : 0
    const space = limit - committed - deadY
    years.push({
      season: season + y,
      limit,
      committed,
      dead: deadY,
      space,
      overTheCap: space < 0,
      expiring: roster
        .filter((p) => num(p.contract.years) === y + 1)
        .sort((a, b) => b.ovr - a.ovr),
    })
  }
  return { horizon, years, players }
}

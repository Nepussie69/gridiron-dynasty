// ─────────────────────────────────────────────────────────────────────────────
// Returners (R6).
//
// Madden has no kick/punt-return rating, so a returner's value is read from the
// athletic ratings that actually drive a return: SPD, ACC, AGI, BCV and CAR
// (ball security). Each club gets one KR and one PR, picked automatically from
// its healthy WR / RB / CB. The starting QB never returns, and the top two
// receivers / RB1 are protected whenever a comparable backup exists, so a club
// doesn't risk its starters. A club may override either slot through
// `world.returners[teamId]` (both optional save fields; unset = automatic).
//
// Pure and deterministic: the sim, the animation and the UI all call the same
// helper, so the player on the field is the player in the box score.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player, Position } from '../types'
import type { World } from './generate'
import { playerAttrs } from '../data/ratings'
import { depthAt, depthGroup } from './depth'

export interface ClubReturners {
  kr?: Player
  pr?: Player
}

/** R6: the positions a club may line up at kick and punt returner. */
export const RETURN_POSITIONS: readonly Position[] = ['WR', 'RB', 'CB']

/** R6: does this player's position make him eligible to return kicks or punts? */
export function isReturnEligible(p: Player): boolean {
  return RETURN_POSITIONS.includes(p.pos)
}

/**
 * R6: the rounded 0–100 Return rating the UI shows. It is exactly the sim's
 * `returnScore`, rounded — one exposed simulation rating, not a saved attribute.
 */
export function returnRating(p: Player): number {
  return Math.round(returnScore(p))
}

/**
 * R6: the ratings and weights behind `returnScore`, for the UI breakdown. Mirrors
 * the formula exactly (speed, acceleration, agility, ball-carrier vision, ball
 * security), so the displayed rating and the sim never drift.
 */
export const RETURN_WEIGHTS: readonly { key: 'SPD' | 'ACC' | 'AGI' | 'BCV' | 'CAR'; label: string; weight: number }[] = [
  { key: 'SPD', label: 'Speed', weight: 0.32 },
  { key: 'ACC', label: 'Acceleration', weight: 0.24 },
  { key: 'AGI', label: 'Agility', weight: 0.2 },
  { key: 'BCV', label: 'Vision', weight: 0.14 },
  { key: 'CAR', label: 'Ball security', weight: 0.1 },
]

/** R6: a player's five return inputs, using canonical attrs (missing = the 70 default). */
export function returnInputs(p: Player): number[] {
  const a = attrs(p)
  return RETURN_WEIGHTS.map((w) => a[w.key] ?? 70)
}

/** R6: the plain-English explanation of the Return rating and its weights. */
export const RETURN_INFO =
  'Return rating — read from the athletic ratings that drive a return: SPD 32% · ACC 24% · AGI 20% · BCV 14% · CAR 10%. ' +
  'A rating a position does not carry is treated as 70. The sim uses this number for kick and punt returns.'

/** R6: how many return-score points a backup must be within to bench a starter. */
const COMPARABLE = 3

function attrs(p: Player): Record<string, number> {
  return playerAttrs(p)
}

/** R6: return value from the ratings that drive a return (centered on ~70 ratings). */
export function returnScore(p: Player): number {
  const a = attrs(p)
  return (a.SPD ?? 70) * 0.32 + (a.ACC ?? 70) * 0.24 + (a.AGI ?? 70) * 0.2 + (a.BCV ?? 70) * 0.14 + (a.CAR ?? 70) * 0.1
}

/**
 * R6: the kicking club's coverage quality — the backup linebackers, safeties and
 * corners, scored on the skills that make a cover team: TAK, PUR and SPD. Used
 * to tilt return yardage: a fast, sound cover team gives up fewer return yards.
 */
export function coverageScore(world: World, teamId: string): number {
  const backups = (pos: 'LB' | 'S' | 'CB', starters: number) =>
    depthAt(world, teamId, pos).filter((p) => !p.injured).slice(starters)
  const group = [...backups('LB', 3), ...backups('S', 2), ...backups('CB', 2)]
  const pool = group.length ? group : depthGroup(world, teamId, ['LB', 'S', 'CB'], 6)
  if (!pool.length) return 72
  let s = 0
  for (const p of pool) {
    const a = attrs(p)
    s += (a.TAK ?? 70) * 0.4 + (a.PUR ?? 70) * 0.35 + (a.SPD ?? 70) * 0.25
  }
  return s / pool.length
}

/**
 * R6: the healthy WR / RB / CB pool in return-score order, with protected
 * starters (top two WR and RB1) filtered out when a comparable backup exists.
 */
function candidatePool(world: World, teamId: string): Player[] {
  const roster = (world.roster[teamId] ?? []).filter(
    (p) => !p.injured && (p.pos === 'WR' || p.pos === 'RB' || p.pos === 'CB'),
  )
  if (roster.length <= 1) return roster
  const protectedIds = new Set([
    ...depthGroup(world, teamId, ['WR'], 2).map((p) => p.id),
    ...depthGroup(world, teamId, ['RB'], 1).map((p) => p.id),
  ])
  const scored = roster.map((p) => ({ p, score: returnScore(p) }))
  const filtered = scored.filter(({ p, score }) => {
    if (!protectedIds.has(p.id)) return true
    // Keep a protected starter only when nobody comparable is available.
    return !scored.some(({ p: q, score: sq }) => !protectedIds.has(q.id) && sq >= score - COMPARABLE)
  })
  const use = filtered.length ? filtered : scored
  return use.sort((a, b) => b.score - a.score).map((s) => s.p)
}

/**
 * R6: a club's kick and punt returner. Honours the optional depth-chart override
 * (`world.returners[teamId]`) for a healthy player on the club; otherwise picks
 * automatically. Returns `{}` when a club has no eligible player.
 */
export function clubReturners(world: World, teamId: string): ClubReturners {
  const override = world.returners?.[teamId]
  const pick = (id?: string) => {
    if (!id) return undefined
    return (world.roster[teamId] ?? []).find((p) => p.id === id && !p.injured)
  }
  const pool = candidatePool(world, teamId)
  const kr = pick(override?.kr) ?? pool[0]
  const pr = pick(override?.pr) ?? pool.find((p) => p.id !== kr?.id) ?? kr
  return { kr, pr }
}

/** R6: one return role resolved for the UI — who actually lines up, and why. */
export interface ReturnerStatus {
  /** The player who will actually line up (an honoured override, else automatic). */
  effective?: Player
  /** The stored override id, if the club set one for this role. */
  requested?: string
  /** True when the stored override is being honoured (healthy, still on the roster). */
  manual: boolean
}

/**
 * R6: resolve one return role for display, reusing `clubReturners` so the name in
 * the box is the man on the field. When a stored override is hurt, traded or
 * released, `effective` is the real automatic replacement and `manual` is false.
 */
export function returnerStatus(world: World, teamId: string, role: 'kr' | 'pr'): ReturnerStatus {
  const requested = world.returners?.[teamId]?.[role]
  const effective = clubReturners(world, teamId)[role]
  return { effective, requested, manual: !!requested && effective?.id === requested }
}

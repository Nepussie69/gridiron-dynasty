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

import type { Player } from '../types'
import type { World } from './generate'
import { attributesFor } from '../data/ratings'
import { depthAt, depthGroup } from './depth'

export interface ClubReturners {
  kr?: Player
  pr?: Player
}

/** R6: how many return-score points a backup must be within to bench a starter. */
const COMPARABLE = 3

function attrs(p: Player): Record<string, number> {
  return { ...attributesFor(p.id, p.pos, p.ovr), ...(p.attrs ?? {}) }
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

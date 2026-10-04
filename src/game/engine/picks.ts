// ─────────────────────────────────────────────────────────────────────────────
// Draft-pick ownership & compensatory picks.
//
// Draft picks are tradeable assets, so the draft order can no longer be just
// "worst record first" repeated every round. Every pick carries its original
// slot and its current owner; the draft engine builds the round-by-round order
// from that. Compensatory picks are appended at the end of their round.
// ─────────────────────────────────────────────────────────────────────────────

import type { DraftPick } from '../types'
import { NFL_TEAMS } from '../data/nflTeams'

export const PICK_ROUNDS = 7

/** A fresh 7-round, 32-team pick set (each team owns its own). */
export function freshDraftPicks(season: number): DraftPick[] {
  const out: DraftPick[] = []
  for (const t of NFL_TEAMS) {
    for (let r = 1; r <= PICK_ROUNDS; r++) {
      out.push({ id: `pk_${season}_${r}_${t.id}`, season, round: r, originalTeam: t.id, ownerTeam: t.id })
    }
  }
  return out
}

/** Structural slice of World we need, to avoid a module cycle. */
export interface HasPicks {
  draftPicks: DraftPick[]
}

export function ensureDraftPicks(world: HasPicks, season: number): DraftPick[] {
  if (!world.draftPicks || !world.draftPicks.length) world.draftPicks = freshDraftPicks(season)
  return world.draftPicks
}

/** Picks currently owned by one team, in round order. */
export function picksOwnedBy(world: HasPicks, teamId: string): DraftPick[] {
  return world.draftPicks
    .filter((p) => p.ownerTeam === teamId)
    .sort((a, b) => a.round - b.round || a.id.localeCompare(b.id))
}

/** A qualifying free agent is good enough to earn his old team a comp pick. */
export const COMP_QUALIFY_OVR = 79

export interface HasLedger {
  compLedger: Record<string, { lost: number; gained: number }>
}

/** Record a qualifying free agent leaving (`lost`) or arriving (`gained`). */
export function ledgerFreeAgent(
  world: HasLedger,
  teamId: string,
  kind: 'lost' | 'gained',
  ovr: number,
) {
  if (ovr < COMP_QUALIFY_OVR) return
  const ledger = (world.compLedger ??= {})
  const row = (ledger[teamId] ??= { lost: 0, gained: 0 })
  row[kind] += 1
}

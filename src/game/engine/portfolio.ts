// ─────────────────────────────────────────────────────────────────────────────
// Portfolio interviews (G4).
//
// Your career leaves a paper trail: ledger hits, pound-the-table calls, players
// you developed, trades you won, winning seasons. Those become portfolio items
// with tags. Before an interview you pitch up to three of them, and each club —
// its owner personality plus the rung you're chasing — wants certain tags.
// Matching items count double, and a good pitch can only help: it raises the
// interview's citations toward the same 12-point ceiling that already exists.
//
// This module must NOT import career.ts (career.ts imports it): that would cycle.
// teamWants computes the owner personality locally with hash32 for the same reason.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerPath, CareerState, JobOffer, LedgerEntry } from '../types'
import type { World } from './generate'
import { hash32 } from './rng'
import { tradeTree } from './tradeTree'

export type PitchTag = 'eye' | 'builder' | 'winner' | 'teacher' | 'conviction'

export interface PortfolioItem {
  id: string
  label: string
  detail: string
  tags: PitchTag[]
  strength: 1 | 2 | 3
  season: number
}

/** Current OVR of the player a ledger entry points at, if he is still around. */
function entryPlayerOvr(world: World, e: LedgerEntry): number | undefined {
  if (!e.playerId) return undefined
  return world.players.find((p) => p.id === e.playerId)?.ovr
}

/** Résumé items from one ledger entry, if it represents a notable call. */
function ledgerItems(world: World, e: LedgerEntry): PortfolioItem[] {
  if (e.kind === 'pick' || e.kind === 'recommendation') {
    if (!e.hit) return []
    const ovr = entryPlayerOvr(world, e)
    return [{
      id: `led_${e.id}`,
      label: e.name,
      detail: e.outcome ?? e.note,
      tags: ['eye'],
      strength: ovr !== undefined && ovr >= 88 ? 3 : 2,
      season: e.season,
    }]
  }
  if (e.kind === 'advice' && e.conviction && e.hit) {
    const vindicated = !!e.vindication
    return [{
      id: `led_${e.id}`,
      label: vindicated ? `Called it: ${e.name}` : e.name,
      detail: e.outcome ?? e.note,
      tags: vindicated ? ['conviction', 'eye'] : ['eye', 'conviction'],
      strength: 3,
      season: e.season,
    }]
  }
  if (e.kind === 'contract') {
    if (!e.hit) return []
    return [{
      id: `led_${e.id}`,
      label: e.name,
      detail: e.outcome ?? e.note,
      tags: ['builder'],
      strength: 2,
      season: e.season,
    }]
  }
  if (e.kind === 'develop') {
    return [{
      id: `led_${e.id}`,
      label: e.name,
      detail: e.note,
      tags: ['teacher'],
      strength: (e.gain ?? 0) >= 3 ? 2 : 1,
      season: e.season,
    }]
  }
  return []
}

/** Wins in a career-history "W-L" record row, or null when unparseable. */
function historyWins(record: string): { wins: number; losses: number } | null {
  const m = record.match(/^(\d+)\s*-\s*(\d+)/)
  if (!m) return null
  return { wins: Number(m[1]), losses: Number(m[2]) }
}

/** Every résumé item, best first, capped at 12. */
export function portfolioItems(world: World, career: CareerState): PortfolioItem[] {
  const items: PortfolioItem[] = []

  for (const e of career.ledger ?? []) items.push(...ledgerItems(world, e))

  // Trades won, from the flattened transaction tree.
  const flatten = (nodes: ReturnType<typeof tradeTree>): PortfolioItem[] => {
    const out: PortfolioItem[] = []
    for (const node of nodes) {
      if (node.verdict === 'Won') {
        const team = world.byId[node.record.partnerId]
        const got = node.record.got.map((s) => s.label).join(', ')
        out.push({
          id: `trade_${node.record.id}`,
          label: `Trade with ${team?.abbr ?? node.record.partnerId}`,
          detail: got ? `Acquired ${got}` : 'Won the deal on value.',
          tags: ['builder'],
          strength: 3,
          season: node.record.season,
        })
      }
      if (node.children.length) out.push(...flatten(node.children))
    }
    return out
  }
  items.push(...flatten(tradeTree(world, career)))

  // Winning seasons, from career history.
  for (const h of career.history) {
    const rec = historyWins(h.record)
    if (!rec || rec.wins <= rec.losses) continue
    const team = world.byId[h.team]
    items.push({
      id: `hist_${h.season}`,
      label: `${rec.wins}-${rec.losses} season`,
      detail: `${h.role} · ${team?.name ?? h.team}`,
      tags: ['winner'],
      strength: rec.wins >= 11 ? 2 : 1,
      season: h.season,
    })
  }

  // L9 Z2: staff awards the user won are résumé gold.
  for (const h of career.honors ?? []) {
    items.push({
      id: `honor_${h.season}_${h.award}`,
      label: `${h.award} ${h.season}`,
      detail: `Named ${h.award} for the ${h.season} season.`,
      tags: ['winner'],
      strength: 3,
      season: h.season,
    })
  }

  return items
    .sort((a, b) => b.strength - a.strength || b.season - a.season)
    .slice(0, 12)
}

/**
 * What a hiring club wants to hear. Owner personality is computed locally with
 * the same hash32 formula people.ts and makeInterview use; importing people.ts
 * would cycle through career.ts. The rung then adds its own bias.
 */
export function teamWants(offer: JobOffer, path: CareerPath): PitchTag[] {
  const personality = (['meddling', 'patient', 'cheap', 'win-now'] as const)[hash32(offer.teamId, 61) % 4]
  const wanted: PitchTag[] =
    personality === 'win-now' ? ['winner', 'builder']
    : personality === 'patient' ? ['eye', 'teacher']
    : personality === 'cheap' ? ['builder', 'eye']
    : ['conviction', 'winner']
  const extra: PitchTag = path === 'coach' ? 'teacher' : 'eye'
  return wanted.includes(extra) ? wanted : [...wanted, extra]
}

/** Score a pitch: matching items count double, capped at +10. */
export function pitchBonus(
  offer: JobOffer,
  path: CareerPath,
  items: PortfolioItem[],
  pickedIds: string[],
): { bonus: number; matched: string[] } {
  const wants = teamWants(offer, path)
  const byId = new Map(items.map((i) => [i.id, i]))
  let sum = 0
  const matched: string[] = []
  for (const id of pickedIds.slice(0, 3)) {
    const item = byId.get(id)
    if (!item) continue
    const overlap = item.tags.some((t) => wants.includes(t))
    sum += item.strength * (overlap ? 2 : 1)
    if (overlap) matched.push(item.label)
  }
  return { bonus: Math.min(10, sum), matched }
}

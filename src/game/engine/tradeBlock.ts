// ─────────────────────────────────────────────────────────────────────────────
// Trade block (L12.5 T5).
//
// Which AI-club players are quietly available this week, and why. Purely
// informational: `evaluateTrade` is untouched, so being on the block never
// changes what a club pays. Deterministic for the current week — no rng.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player } from '../types'
import type { World } from './generate'
import { teamStrength } from './generate'
import { depthAt, STARTERS } from './depth'
import { fitLabel } from './style'

export interface TradeBlockEntry {
  playerId: string
  teamId: string
  reason: string
}

/**
 * The acceptance window for the league board is 20–70, so the board is cut to
 * the 70 highest-rated names after the per-club selection. Deterministic.
 */
const MAX_BLOCK = 70

/** Win percentage from a club's record (0 with no games played). */
function winPct(world: World, teamId: string): number {
  const r = world.standings[teamId]
  if (!r) return 0
  const played = r.wins + r.losses + r.ties
  return played ? r.wins / played : 0
}

/** The top seven by win% in each conference count as "in a playoff spot". */
function playoffTeams(world: World): Set<string> {
  const out = new Set<string>()
  const byConf = new Map<string, string[]>()
  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    const list = byConf.get(t.conference) ?? []
    list.push(t.id)
    byConf.set(t.conference, list)
  }
  for (const ids of byConf.values()) {
    ids.sort(
      (a, b) =>
        winPct(world, b) - winPct(world, a) ||
        (world.standings[b]?.wins ?? 0) - (world.standings[a]?.wins ?? 0) ||
        a.localeCompare(b),
    )
    for (const id of ids.slice(0, 7)) out.add(id)
  }
  return out
}

/** The eight weakest clubs by top-22 strength — the preseason read. */
function bottomEight(world: World): Set<string> {
  const ranked = [...world.teams]
    .filter((t) => t.tier === 'NFL')
    .sort(
      (a, b) =>
        teamStrength(world.roster[a.id] ?? []) - teamStrength(world.roster[b.id] ?? []) ||
        a.id.localeCompare(b.id),
    )
  return new Set(ranked.slice(0, 8).map((t) => t.id))
}

function schemeFor(world: World, teamId: string, p: Player): string | undefined {
  const role = p.side === 'DEF' ? 'Defensive Coordinator' : 'Offensive Coordinator'
  return (world.staff[teamId] ?? []).find((s) => s.role === role)?.scheme
}

/** The first reason that applies, or null. */
function blockReason(
  world: World,
  teamId: string,
  p: Player,
  ctx: { rebuilding: boolean; playoff: boolean },
): string | null {
  // Surplus — buried below the starters plus the first backup.
  if (p.ovr >= 70) {
    const idx = depthAt(world, teamId, p.pos).findIndex((x) => x.id === p.id)
    if (idx >= (STARTERS[p.pos] ?? 1) + 1) return `Surplus at ${p.pos}`
  }
  // Rebuilding veteran.
  if (ctx.rebuilding && p.age >= 29 && p.ovr >= 75) return 'Rebuilding — veteran'
  // Expiring deal on a club outside the playoff picture.
  if (p.contract.years === 1 && !ctx.playoff && p.ovr >= 72) return 'Expiring deal'
  // Scheme misfit.
  if (p.ovr >= 72) {
    const scheme = schemeFor(world, teamId, p)
    if (scheme && fitLabel(p, scheme, p.side === 'DEF' ? 'DEF' : 'OFF') === 'Poor') return 'Scheme misfit'
  }
  return null
}

/**
 * Every AI club's shopping list for the current week: at most three players per
 * club, highest OVR first. `userTeamId` excludes the user's own club (his block
 * lives on the career).
 */
export function tradeBlock(world: World, userTeamId?: string): TradeBlockEntry[] {
  const playoff = playoffTeams(world)
  // The record only becomes the read after week 4; before that, roster strength.
  const useRecord = world.phase === 'regular' && world.week > 4
  const bottom = useRecord ? null : bottomEight(world)
  const out: { entry: TradeBlockEntry; ovr: number }[] = []

  for (const team of world.teams) {
    if (team.tier !== 'NFL') continue
    if (userTeamId && team.id === userTeamId) continue
    const rebuilding = bottom ? bottom.has(team.id) : winPct(world, team.id) < 0.4
    const inSpot = playoff.has(team.id)
    const eligible: { player: Player; reason: string }[] = []
    for (const p of world.roster[team.id] ?? []) {
      const reason = blockReason(world, team.id, p, { rebuilding, playoff: inSpot })
      if (reason) eligible.push({ player: p, reason })
    }
    eligible.sort((a, b) => b.player.ovr - a.player.ovr || a.player.id.localeCompare(b.player.id))
    for (const e of eligible.slice(0, 3)) {
      out.push({ entry: { playerId: e.player.id, teamId: team.id, reason: e.reason }, ovr: e.player.ovr })
    }
  }

  out.sort((a, b) => b.ovr - a.ovr || a.entry.playerId.localeCompare(b.entry.playerId))
  return out.slice(0, MAX_BLOCK).map((x) => x.entry)
}

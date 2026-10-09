// ─────────────────────────────────────────────────────────────────────────────
// Read-only team rate selector (UI helper — never touches the sim).
//
// Per-game offense and defense for every NFL club, with league ranks (1 = best)
// and starting-lineup ratings. Built from the season's existing aggregates:
// `teamSeasonStats` (player lines + matchups) and `world.standings`. Pure and
// derived, so the game-day / game-plan screens can show numbers without
// recomputing or mutating anything the sim owns.
// ─────────────────────────────────────────────────────────────────────────────

import type { World } from './engine/generate'
import { teamRatings } from './engine/depth'
import { teamSeasonStats } from './engine/statsDb'

export interface TeamRateEntry {
  /** Games played this season (wins + losses + ties). */
  games: number
  /** Per-game averages; `null` before the club has played a game. */
  pf: number | null
  pa: number | null
  passYds: number | null
  rushYds: number | null
  passYdsAllowed: number | null
  rushYdsAllowed: number | null
  /** Starting-lineup ratings (the same slice the sim fields). */
  off: number
  def: number
  ovr: number
  /** League ranks within the NFL tier, 1 = best. 0 = unranked (no games yet). */
  ranks: {
    pf: number
    pa: number
    passYds: number
    rushYds: number
    passYdsAllowed: number
    rushYdsAllowed: number
    off: number
    def: number
    ovr: number
  }
}

const NO_RANKS: TeamRateEntry['ranks'] = {
  pf: 0, pa: 0, passYds: 0, rushYds: 0, passYdsAllowed: 0, rushYdsAllowed: 0, off: 0, def: 0, ovr: 0,
}

/** Every NFL club's per-game rates, lineup ratings and league ranks. */
export function teamRates(world: World): Record<string, TeamRateEntry> {
  const nfl = world.teams.filter((t) => t.tier === 'NFL')
  const stats = teamSeasonStats(world, world.season)
  const out: Record<string, TeamRateEntry> = {}

  for (const t of nfl) {
    const rec = world.standings[t.id]
    const games = rec ? rec.wins + rec.losses + rec.ties : 0
    const s = stats[t.id]
    const r = teamRatings(world, t.id)
    const per = (total: number) => (games > 0 ? total / games : null)
    out[t.id] = {
      games,
      pf: per(rec?.pointsFor ?? 0),
      pa: per(rec?.pointsAgainst ?? 0),
      passYds: per(s?.passYds ?? 0),
      rushYds: per(s?.rushYds ?? 0),
      passYdsAllowed: per(s?.passYdsAllowed ?? 0),
      rushYdsAllowed: per(s?.rushYdsAllowed ?? 0),
      off: r.off,
      def: r.def,
      ovr: r.overall,
      ranks: { ...NO_RANKS },
    }
  }

  // Rank a category across clubs that have played, 1 = best. Unranked clubs keep
  // 0 so the UI prints "—". Ties fall back to the stable club order.
  const rankBy = (key: keyof TeamRateEntry['ranks'], value: (e: TeamRateEntry) => number | null, best: 'high' | 'low') => {
    const ids = nfl.map((t) => t.id).filter((id) => out[id].games > 0 && value(out[id]) != null)
    ids.sort((a, b) => {
      const va = value(out[a]) as number
      const vb = value(out[b]) as number
      return best === 'high' ? vb - va : va - vb
    })
    ids.forEach((id, i) => { out[id].ranks[key] = i + 1 })
  }
  rankBy('pf', (e) => e.pf, 'high')
  rankBy('pa', (e) => e.pa, 'low')
  rankBy('passYds', (e) => e.passYds, 'high')
  rankBy('rushYds', (e) => e.rushYds, 'high')
  rankBy('passYdsAllowed', (e) => e.passYdsAllowed, 'low')
  rankBy('rushYdsAllowed', (e) => e.rushYdsAllowed, 'low')
  rankBy('off', (e) => e.off, 'high')
  rankBy('def', (e) => e.def, 'high')
  rankBy('ovr', (e) => e.ovr, 'high')

  return out
}

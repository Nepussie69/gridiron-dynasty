import { NFL_DIVISIONS } from './nflTeams'
import { CFB_CONFERENCES } from './cfbTeams'
import type { LeagueTier } from '../types'

/** Group team ids for the League browser, keyed by conference (or division for the NFL). */
export function leagueGroups(tier: LeagueTier): Record<string, string[]> {
  if (tier === 'NFL') return { ...NFL_DIVISIONS }
  const out: Record<string, string[]> = {}
  for (const [conf, ids] of Object.entries(CFB_CONFERENCES)) {
    out[conf] = ids
  }
  return out
}

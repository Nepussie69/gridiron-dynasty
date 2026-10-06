// ─────────────────────────────────────────────────────────────────────────────
// Owner counteroffer (L9 Z4).
//
// When a rival club comes calling at season's end, some owners fight to keep
// you: a raise, a vote of confidence and a longer leash. A cost-conscious owner
// never pays up, and an owner only counters once a season. The store records
// that a counter was made in `career.counter`; this engine stays pure.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, JobOffer } from '../types'
import type { World } from './generate'
import { ownerPersonality } from './people'

export interface CounterOffer {
  /** Fractional raise applied to your salary when accepted. */
  raisePct: number
  /** Job-security points granted when accepted. */
  security: number
  /** The owner's pitch, flavoured by their personality. */
  text: string
}

/**
 * The owner's pitch to keep you, or null when none is coming. Checks that a
 * rival actually made an offer, that your seat is warm enough to defend, and
 * that the owner is not cheap. Whether a counter already happened this season is
 * tracked by the caller in `career.counter`.
 */
export function counterOffer(world: World, career: CareerState, offers: JobOffer[]): CounterOffer | null {
  if (!offers.length) return null
  if (career.jobSecurity < 55) return null
  const personality = ownerPersonality(career.teamId)
  if (personality === 'cheap') return null
  const team = world.byId[career.teamId]
  const text =
    personality === 'win-now'
      ? `The ${team.name} owner is playing to win: a 25% raise and a vote of confidence.`
      : personality === 'meddling'
        ? `The ${team.name} owner wants to stay hands-on with you in charge: a 25% raise and a vote of confidence.`
        : 'The owner wants you here long-term: a 25% raise and a vote of confidence.'
  return { raisePct: 0.25, security: 15, text }
}

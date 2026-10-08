// ─────────────────────────────────────────────────────────────────────────────
// L12.14 C4: the head coach asks the GM.
//
// Coaching rungs that call plays — and the head coach — cannot sign contracts
// themselves. Instead they can push the front office to extend a player (once per
// player per season). The AI GM decides deterministically from the player's value
// (OVR / age / position), the deal's fit under the cap, the coach's standing
// (leadership reputation + job security) and the owner's mandate. On a yes the GM
// negotiates at market using the same extension pricing the personnel ladder uses.
//
// Nothing here touches the sim, the gates or the capability table.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, Player, Position } from '../types'
import type { World } from './generate'
import { capabilities } from './capabilities'
import { summarizeCap } from './cap'
import { buildExtension, marketAsk, type ExtensionOffer } from './negotiation'
import { OFF_POSITIONS, DEF_POSITIONS } from './pitch'

/** Why the GM answered the way he did, for the UI and the probe. */
export type GmAskReason = 'agreed' | 'cap' | 'age' | 'value' | 'revisit'

export interface GmAskResult {
  outcome: 'extends' | 'notNow' | 'declined'
  reason: GmAskReason
  /** A human sentence for the inbox / toast. */
  message: string
  years: number
  aav: number
  total: number
}

/** A coach who calls plays — or the head coach — can ask; the GM holds the pen. */
export function canAskGm(career: CareerState): boolean {
  if (career.path !== 'coach' || career.tier !== 'NFL') return false
  const isHC = career.level >= 7
  return isHC || capabilities(career).can.has('callPlays')
}

/** Coordinators only get their side of the ball; the head coach sees both. */
export function gmAskCovers(career: CareerState, pos: Position): boolean {
  if (career.path !== 'coach') return false
  if (career.level >= 7) return true
  if (career.unitFocus === 'off') return OFF_POSITIONS.includes(pos)
  if (career.unitFocus === 'def') return DEF_POSITIONS.includes(pos)
  return OFF_POSITIONS.includes(pos) || DEF_POSITIONS.includes(pos)
}

/** The extension the GM would put on the table: market AAV, 3–4 years by age. */
export function gmOffer(p: Player, season: number): ExtensionOffer {
  const years = p.age <= 27 ? 4 : 3
  return { years, aav: marketAsk(p, season), guarantee: p.ovr >= 86 ? 'high' : 'mid' }
}

/**
 * The GM's deterministic verdict. No rng: the same career, player and cap always
 * produce the same answer.
 */
export function gmExtendDecision(world: World, career: CareerState, p: Player): GmAskResult {
  const season = world.season
  const offer = gmOffer(p, season)
  const total = offer.aav * offer.years
  const base = { years: offer.years, aav: offer.aav, total }

  // Value: a player who isn't a core piece isn't getting new money.
  if (p.ovr < 68) {
    return { ...base, outcome: 'declined', reason: 'value', message: `${p.name} isn't a core piece at ${p.ovr} OVR.` }
  }
  // Age: the GM won't commit long money to the end of a career. A proven star
  // can still get paid into his early thirties; anyone else waits a year.
  if (p.age >= 33) {
    return { ...base, outcome: 'declined', reason: 'age', message: `At ${p.age}, the GM won't commit new money.` }
  }
  if (p.age >= 30 && p.ovr < 88) {
    return { ...base, outcome: 'notNow', reason: 'age', message: "The GM wants to see this season first — we'll revisit." }
  }
  // Cap: the deal has to fit once the old hit comes off the books.
  const next = buildExtension(p, season, offer)
  const cap = summarizeCap(world.roster[career.teamId] ?? [], world.deadMoney[career.teamId] ?? 0, season)
  const roomAfter = cap.space + p.contract.capHit - next.capHit
  if (roomAfter < 0) {
    return { ...base, outcome: 'notNow', reason: 'cap', message: "It doesn't fit under the cap this year." }
  }
  // Owner mandate: a rebuild protects the young core and hoards cap; a win-now
  // owner is happy to pay for proven veterans.
  const mandate = (career.ownerExpectation ?? '').toLowerCase()
  const rebuild = /draft|build|young|three-year/.test(mandate)
  const winNow = /playoff|championship|title|win now|make a change/.test(mandate)
  if (rebuild && p.age >= 27 && p.ovr < 90) {
    return { ...base, outcome: 'notNow', reason: 'revisit', message: "The owner wants to build through the draft — we'll revisit." }
  }
  // Standing: leadership reputation and job security buy the coach the benefit
  // of the doubt. A weak-room coach has to bring a star to get a yes.
  const standing = career.reputation.leadership * 0.6 + career.jobSecurity * 0.4
  const threshold = rebuild ? 58 : winNow ? 42 : 50
  const need = p.ovr >= 88 ? threshold - 12 : p.ovr >= 82 ? threshold - 6 : threshold
  if (standing < need) {
    return { ...base, outcome: 'notNow', reason: 'revisit', message: "The GM isn't sold yet — we'll revisit after the season." }
  }
  return { ...base, outcome: 'extends', reason: 'agreed', message: 'The GM got it done at market.' }
}

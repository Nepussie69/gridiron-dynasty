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
import { generalManager, gmTemperament } from './generate'
import { capabilities } from './capabilities'
import { summarizeCap } from './cap'
import { buildExtension, marketAsk, type ExtensionOffer } from './negotiation'
import { OFF_POSITIONS, DEF_POSITIONS } from './pitch'
import { unscaleOvr } from './ovrScale'

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
  return { years, aav: marketAsk(p, season), guarantee: unscaleOvr(p.ovr) >= 86 ? 'high' : 'mid' }
}

/**
 * The GM's deterministic verdict. No rng: the same career, player, cap AND GM
 * always produce the same answer. The man in the chair is real — his own
 * patience, trade aggression and cap discipline (generate.ts `gmTemperament`,
 * from his own id + rating) decide how much rope the coach gets and how strict
 * he is with the cap, so a patient, cap-disciplined GM and a bold, impatient one
 * answer the same ask differently.
 */
export function gmExtendDecision(world: World, career: CareerState, p: Player): GmAskResult {
  const season = world.season
  const offer = gmOffer(p, season)
  const total = offer.aav * offer.years
  const base = { years: offer.years, aav: offer.aav, total }
  // L12.15 S2: decisions read the old (rank) scale so the same players qualify.
  const raw = unscaleOvr(p.ovr)
  // The man, and the words the UI/inbox use for him.
  const gm = generalManager(world, career.teamId)
  const t = gmTemperament(gm)
  const who = gm ? `GM ${gm.name.split(' ').slice(-1)[0]}` : 'The GM'
  const patient = t.patience >= 68
  const rash = t.patience <= 42

  // Value: a player who isn't a core piece isn't getting new money. A patient
  // GM stretches the definition of a core piece; an impatient one does not.
  const valueFloor = 68 - (patient ? 3 : 0) + (rash ? 3 : 0)
  if (raw < valueFloor) {
    return { ...base, outcome: 'declined', reason: 'value', message: `${p.name} isn't a core piece at ${p.ovr} OVR.` }
  }
  // Age: the GM won't commit long money to the end of a career. A proven star
  // can still get paid into his early thirties; anyone else waits a year.
  if (p.age >= 33) {
    return { ...base, outcome: 'declined', reason: 'age', message: `At ${p.age}, ${who} won't commit new money.` }
  }
  if (p.age >= 30 && raw < 88) {
    return { ...base, outcome: 'notNow', reason: 'age', message: `${who} wants to see this season first — we'll revisit.` }
  }
  // Cap: the deal has to fit once the old hit comes off the books. How much room
  // he insists on is his own cap discipline: strict men want a cushion, loose
  // ones will stretch into the red for a good player.
  const next = buildExtension(p, season, offer)
  const cap = summarizeCap(world.roster[career.teamId] ?? [], world.deadMoney[career.teamId] ?? 0, season)
  const roomAfter = cap.space + p.contract.capHit - next.capHit
  const cushion = Math.round((t.cap - 55) * 250_000)
  if (roomAfter < cushion) {
    return { ...base, outcome: 'notNow', reason: 'cap', message: `It doesn't fit under the cap this year.` }
  }
  // Owner mandate: a rebuild protects the young core and hoards cap; a win-now
  // owner is happy to pay for proven veterans.
  const mandate = (career.ownerExpectation ?? '').toLowerCase()
  const rebuild = /draft|build|young|three-year/.test(mandate)
  const winNow = /playoff|championship|title|win now|make a change/.test(mandate)
  if (rebuild && p.age >= 27 && raw < 90) {
    return { ...base, outcome: 'notNow', reason: 'revisit', message: `The owner wants to build through the draft — we'll revisit.` }
  }
  // Standing: leadership reputation and job security buy the coach the benefit
  // of the doubt. A weak-room coach has to bring a star to get a yes. Patience
  // is HIS own number — a patient GM backs his coach, a rash one wants proof.
  const standing = career.reputation.leadership * 0.6 + career.jobSecurity * 0.4
  const threshold = rebuild ? 58 : winNow ? 42 : 50
  let need = raw >= 88 ? threshold - 12 : raw >= 82 ? threshold - 6 : threshold
  need += (60 - t.patience) * 0.8
  // A bold trader pays up for a genuine star; a cautious one lets him walk.
  if (raw >= 86 && t.aggression >= 70) need -= 8
  else if (raw >= 86 && t.aggression <= 45) need += 4
  if (standing < need) {
    return { ...base, outcome: 'notNow', reason: 'revisit', message: `${who} isn't sold yet — we'll revisit after the season.` }
  }
  return { ...base, outcome: 'extends', reason: 'agreed', message: `${who} got it done at market.` }
}

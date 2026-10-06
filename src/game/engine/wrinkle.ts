// ─────────────────────────────────────────────────────────────────────────────
// Weekly wrinkle (K1).
//
// A coordinator or head coach picks one wrinkle for the game plan each week. A
// fresh wrinkle gives a small coaching edge; reusing the same one lets opponents
// study the film and the edge decays. The best play is to rotate — that's the
// whole point. The bonus is folded into the user's coaching edge in the store,
// so AI clubs are never affected and league calibration can't move.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState } from '../types'
import { capabilities, isHeadCoach } from './capabilities'

export interface Wrinkle {
  id: string
  label: string
  blurb: string
}

export const OFF_WRINKLES: Wrinkle[] = [
  { id: 'motion', label: 'Motion & shifts', blurb: 'Shift and dress up your formations before the snap.' },
  { id: 'playaction', label: 'Play-action shots', blurb: 'Sell the run and take shots downfield.' },
  { id: 'tempo', label: 'Tempo package', blurb: 'Hurry up to catch the defense substituting.' },
  { id: 'unbalanced', label: 'Unbalanced line', blurb: 'Overload one side to win the numbers.' },
]

export const DEF_WRINKLES: Wrinkle[] = [
  { id: 'simpressure', label: 'Simulated pressure', blurb: 'Show blitz, drop out, muddy the read.' },
  { id: 'bracket', label: 'Bracket their WR1', blurb: 'Roll coverage to erase their best receiver.' },
  { id: 'disguise', label: 'Disguised coverage', blurb: 'Hide the coverage until the snap.' },
  { id: 'runblitz', label: 'Run blitz', blurb: 'Send an extra defender into the run fit.' },
]

/** The edge a wrinkle has, indexed by how much recent film exists for it. */
const EDGE = [1.0, 0.6, 0.3, 0.0]

/** Can this rung call plays — i.e. pick a weekly wrinkle at all? */
export function canWrinkle(career: CareerState): boolean {
  return capabilities(career).can.has('callPlays')
}

/**
 * Which sides this role picks for. The side follows `unitFocus`; a head coach
 * (or a `'both'` unit focus) picks one wrinkle per side.
 */
export function wrinkleSides(career: CareerState): ('off' | 'def')[] {
  if (!canWrinkle(career)) return []
  if (career.unitFocus === 'both' || isHeadCoach(career)) return ['off', 'def']
  return [career.unitFocus === 'def' ? 'def' : 'off']
}

/**
 * The edge for a wrinkle this week: how many times it was chosen over the last
 * four weeks (not counting this one) decays it. A wrinkle not used for 4+ weeks
 * falls out of the film window and is fresh again.
 */
export function wrinkleEdge(career: CareerState, side: 'off' | 'def', id: string, week: number): number {
  const history = career.wrinkles?.history ?? []
  const uses = history.filter((h) => h.side === side && h.id === id && h.week > week - 4 && h.week < week).length
  return EDGE[Math.min(uses, 3)]
}

/** This week's wrinkle bonus per side, from the pick if it was made for `week`. */
export function wrinkleBonus(career: CareerState, week: number): { off: number; def: number } {
  const pick = career.wrinkles?.pick
  if (!pick || pick.week !== week) return { off: 0, def: 0 }
  return {
    off: pick.off ? wrinkleEdge(career, 'off', pick.off, week) : 0,
    def: pick.def ? wrinkleEdge(career, 'def', pick.def, week) : 0,
  }
}

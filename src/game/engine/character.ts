// ─────────────────────────────────────────────────────────────────────────────
// Hidden character.
//
// Film shows talent; character decides whether that talent ever arrives. Work
// ethic, coachability, maturity and off-field risk are hidden from the board and
// are uncovered by working the phones. Character never touches a player's
// current rating — only his development curve and bust risk — so sim calibration
// stays intact.
//
// Real-data caution: negative off-field narratives are gated to generated
// players only (see `generated`). Real named players are never the subject of
// an invented incident.
// ─────────────────────────────────────────────────────────────────────────────

import type { Character, CharacterRead, Player } from '../types'
import { clamp, hash32 } from './rng'

export const CHARACTER_FACETS: (keyof Character)[] = ['workEthic', 'coachability', 'maturity', 'offFieldRisk']

export const FACET_LABEL: Record<keyof Character, string> = {
  workEthic: 'Work Ethic',
  coachability: 'Coachability',
  maturity: 'Maturity',
  offFieldRisk: 'Off-Field Risk',
}

/** Deterministic character from a stable id (same player, same character always). */
export function makeCharacter(seed: string): Character {
  const h = (salt: number) => (hash32(seed, salt) % 1000) / 1000
  return {
    workEthic: Math.round(30 + h(11) * 66),
    coachability: Math.round(30 + h(12) * 66),
    maturity: Math.round(32 + h(13) * 64),
    offFieldRisk: Math.round(4 + h(14) * 52),
  }
}

export function charLabel(v: number): 'Elite' | 'High' | 'Average' | 'Low' | 'Red flag' {
  if (v >= 85) return 'Elite'
  if (v >= 70) return 'High'
  if (v >= 50) return 'Average'
  if (v >= 35) return 'Low'
  return 'Red flag'
}

/** Off-field risk reads inverted (low is good). */
export function riskLabel(v: number): 'Clean' | 'Low' | 'Moderate' | 'Elevated' | 'High' {
  if (v <= 15) return 'Clean'
  if (v <= 32) return 'Low'
  if (v <= 50) return 'Moderate'
  if (v <= 70) return 'Elevated'
  return 'High'
}

export function facetLabel(facet: keyof Character, value: number): string {
  return facet === 'offFieldRisk' ? riskLabel(value) : charLabel(value)
}

/** Growth multiplier from character: ~0.8 (poor) .. 1.3 (elite). */
export function devModifier(c: Character): number {
  const positive = (c.workEthic * 0.5 + c.coachability * 0.3 + c.maturity * 0.2) / 100
  return 0.8 + positive * 0.5
}

/** Chance a player's development stalls or reverses for non-talent reasons. */
export function bustRisk(c: Character): number {
  return clamp((c.offFieldRisk * 0.6 + (100 - c.maturity) * 0.4 - 45) / 100, 0, 0.6)
}

/** One-line read of the player's character, used in profiles. */
export function characterRead(p: Player): string {
  const c = p.character
  if (!c) return 'Unknown.'
  const dev = devModifier(c)
  const work = charLabel(c.workEthic).toLowerCase()
  if (dev >= 1.18) return `A true professional — ${work} work ethic; he will out-develop his draft slot.`
  if (dev >= 1.0) return `Solid makeup. ${charLabel(c.maturity)} maturity; steady growth expected.`
  if (bustRisk(c) > 0.25) return `Talent is there, but the makeup is a question — real bust risk.`
  return `Low motor. He may never get there regardless of the tape.`
}

/**
 * Work the phones: uncover one facet. Accuracy rises with your Evaluation skill
 * and your staff; the observed value is noisy around the truth.
 */
export function revealFacet(
  character: Character,
  already: CharacterRead[],
  accuracy: number,
  rng: () => number,
): CharacterRead | null {
  const unknown = CHARACTER_FACETS.filter((f) => !already.some((r) => r.facet === f))
  if (!unknown.length) return null
  const facet = unknown[Math.floor(rng() * unknown.length)]
  const truth = character[facet]
  const noise = (1 - clamp(accuracy, 0, 1)) * 44
  const observed = clamp(Math.round(truth + (rng() - 0.5) * noise * 2), 0, 100)
  return { facet, value: observed, label: facetLabel(facet, observed), confidence: Math.round(clamp(accuracy, 0, 1) * 100) }
}

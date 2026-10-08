// ─────────────────────────────────────────────────────────────────────────────
// L12.11: career skills and what each point of them does.
//
// Every skill does one small, bounded thing. All of these effects are measured
// relative to 40 (neutral): below it there is no penalty (clamped), above it the
// bonus grows slowly. They are user-only — AI clubs are never affected — draw no
// rng, and are clamped to tight ranges so the sim's calibration is untouched.
// ─────────────────────────────────────────────────────────────────────────────

import type { Skills } from './career'
import { clamp } from './rng'

export type SkillKey = keyof Skills

/** The order skills are shown (and, in the harness, spent). */
export const SKILL_KEYS: SkillKey[] = ['evaluation', 'scheme', 'leadership', 'negotiation', 'recruiting']

/** Neutral baseline: a skill of 40 is neither a bonus nor a penalty. */
export const NEUTRAL_SKILL = 40

/**
 * UI names. The save key stays `recruiting` for compatibility, but the label is
 * Player Development — it is about growing the players already on your club.
 */
export const SKILL_LABELS: Record<SkillKey, string> = {
  evaluation: 'Evaluation',
  negotiation: 'Negotiation',
  leadership: 'Leadership',
  scheme: 'Scheme',
  recruiting: 'Player Development',
}

/** A short blurb for what a skill governs. */
export const SKILL_BLURBS: Record<SkillKey, string> = {
  evaluation: 'Tighter prospect reads and a better department grade.',
  negotiation: 'Cheaper contract asks and a little more leeway in trades.',
  leadership: 'More on-field edge, development, culture and morale.',
  scheme: 'A bigger unit edge on game day.',
  recruiting: 'Faster growth for the young players on your club.',
}

/** Relative skill position: 40 → 0, 99 → 1, below 40 → negative. */
function rel(skill: number): number {
  return (skill - NEUTRAL_SKILL) / 59
}

/** Extension / free-agent ask multiplier for the user's club. Never above 1 (99 → 0.97). */
export function negotiationAskMultiplier(skill: number): number {
  return clamp(1 - 0.06 * rel(skill), 0.97, 1)
}

/** Extra fraction of value a partner will accept from the user (99 → +2%). */
export function negotiationTradeMargin(skill: number): number {
  return clamp(rel(skill) * 0.02, 0, 0.02)
}

/** Young-player growth multiplier for the user's club (99 → ×1.08). */
export function developmentGrowthMult(skill: number): number {
  return clamp(1 + rel(skill) * 0.08, 0.9, 1.08)
}

/** Culture-score bonus from leadership (0..4). */
export function leadershipCultureBonus(skill: number): number {
  return clamp(Math.round(rel(skill) * 4), 0, 4)
}

/** Extra morale your players recover at season end (0..4). */
export function leadershipMoraleBonus(skill: number): number {
  return clamp(Math.round(rel(skill) * 4), 0, 4)
}

/** Scheme edge added to the user's unit (same formula as userBonusFromSkills). */
export function schemeEdge(skill: number): number {
  return rel(skill) * 3
}

/** Leadership edge added to the user's unit (same formula as userBonusFromSkills). */
export function leadershipEdge(skill: number): number {
  return rel(skill) * 1.5
}

/** Prospect-read width factor from evaluation (lower = tighter read). */
export function evaluationReadFactor(skill: number): number {
  return 1 - Math.min(1, skill / 99) * 0.4
}

/** Is this skill's effect live at this rung? (P2 greys out the ones that aren't.) */
export function skillActive(key: SkillKey, path: 'coach' | 'personnel', level: number): boolean {
  switch (key) {
    case 'scheme':
      return path === 'coach' && level >= 2
    case 'negotiation':
      return path === 'coach' ? level >= 7 : level >= 6
    default:
      return true
  }
}

/** The rung whose unlock turns a dormant skill on, for the greyed-out copy. */
export function skillUsedFrom(key: SkillKey, path: 'coach' | 'personnel'): string | null {
  switch (key) {
    case 'scheme':
      return 'Coordinator'
    case 'negotiation':
      return path === 'coach' ? 'Head Coach' : 'Director of Player Personnel'
    default:
      return null
  }
}

/** One plain-English line for what a skill value does right now. */
export function skillEffectText(key: SkillKey, value: number): string {
  switch (key) {
    case 'evaluation':
      return `prospect read width ×${evaluationReadFactor(value).toFixed(2)}`
    case 'scheme':
      return `+${schemeEdge(value).toFixed(1)} unit edge per snap`
    case 'leadership':
      return `+${leadershipEdge(value).toFixed(2)} edge · +${leadershipCultureBonus(value)} culture · +${leadershipMoraleBonus(value)} morale`
    case 'negotiation': {
      const save = (1 - negotiationAskMultiplier(value)) * 100
      return `${save.toFixed(1)}% cheaper asks · +${(negotiationTradeMargin(value) * 100).toFixed(1)}% trade margin`
    }
    case 'recruiting':
      return `×${developmentGrowthMult(value).toFixed(3)} young-player growth`
  }
}

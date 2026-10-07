// ─────────────────────────────────────────────────────────────────────────────
// Player styles: archetypes + traits as sim modifiers.
//
// Every player carries an archetype (from Madden 26 / CFB 26) and trait tags.
// This module turns those into concrete modifiers the play engine applies, and
// scores scheme fit so the right player in the right system is better.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player } from '../types'

export type Mods = Record<string, number> // multiplier-ish, 1.0 = neutral

export interface StyleProfile {
  /** Deep vs. short target preference (receivers / QB tendency). */
  deepBias: number
  /** Extra YAC tendency. */
  yacBias: number
  /** Catch-in-traffic / contested bonus. */
  contested: number
  /** Scramble / creation tendency (QB). */
  scramble: number
  /** Between-the-tackles power. */
  power: number
  /** Open-field elusiveness. */
  elusiveness: number
  /** Pass-rush burst. */
  rush: number
  /** Coverage ball skills (INT). */
  ballHawk: number
  /** Coverage stickiness. */
  coverage: number
}

const NEUTRAL: StyleProfile = {
  deepBias: 0, yacBias: 0, contested: 0, scramble: 0, power: 0, elusiveness: 0,
  rush: 0, ballHawk: 0, coverage: 0,
}

// ── Archetype effects, keyed by the EA archetype string (prefix match) ────────
function archetypeProfile(arch: string): Partial<StyleProfile> {
  const a = arch.toLowerCase()
  const has = (...words: string[]) => words.some((w) => a.includes(w))
  const out: Partial<StyleProfile> = {}
  if (has('deep threat')) Object.assign(out, { deepBias: 1, yacBias: 0.4 })
  if (has('route technician', 'possession')) Object.assign(out, { contested: 0.6, yacBias: -0.2 })
  if (has('playmaker', 'yac')) Object.assign(out, { yacBias: 1, elusiveness: 0.4 })
  if (has('physical', 'contested')) Object.assign(out, { contested: 1 })
  if (has('red zone threat', 'seam threat')) Object.assign(out, { contested: 0.8, deepBias: 0.5 })
  if (has('blocking')) Object.assign(out, { deepBias: -0.6, yacBias: -0.5 })
  if (has('improviser', 'dual threat', 'scrambler')) Object.assign(out, { scramble: 1 })
  if (has('field general', 'pocket')) Object.assign(out, { contested: 0.3 })
  if (has('home run hitter', 'receiving back')) Object.assign(out, { elusiveness: 1 })
  if (has('power back', 'power')) Object.assign(out, { power: 1 })
  if (has('elusive', 'scat', 'receiving')) Object.assign(out, { elusiveness: 0.8 })
  if (has('speed rusher', 'finesse')) Object.assign(out, { rush: 1 })
  if (has('power rusher')) Object.assign(out, { rush: 0.7, power: 0.4 })
  if (has('run stopper', 'nose', 'two-gapper', 'run stuffer')) Object.assign(out, { rush: -0.4, power: 0.4 })
  if (has('ball hawk', 'center fielder', 'zone')) Object.assign(out, { ballHawk: 1 })
  if (has('shutdown', 'press', 'man')) Object.assign(out, { coverage: 1 })
  if (has('hybrid', 'slot')) Object.assign(out, { coverage: 0.4 })
  if (has('blitzer', 'thumper', 'sideline')) Object.assign(out, { rush: 0.5 })
  return out
}

/** Map a player's archetype + traits into a style profile. */
export function styleProfile(p: Player): StyleProfile {
  const arch = p.traits[0] ?? ''
  const prof: StyleProfile = { ...NEUTRAL, ...(archetypeProfile(arch) as StyleProfile) }
  // Trait tags as discrete bonuses
  for (const t of p.traits) {
    const s = t.toLowerCase()
    if (s.includes('cannon arm')) prof.deepBias += 0.3
    if (s.includes('field general')) prof.contested += 0.3
    if (s.includes('home run')) prof.elusiveness += 0.3
    if (s.includes('shutdown') || s.includes('ball hawk')) prof.ballHawk += 0.4
    if (s.includes('clutch')) prof.contested += 0.2
  }
  return prof
}

// ── Scheme fit ───────────────────────────────────────────────────────────────
// Which archetypes each coordinator scheme rewards. Keys match the real EA
// archetype strings (Deep Threat, Manto Man, Smaller Speed Rusher, …).
const OFF_FIT: Record<string, string[]> = {
  'Air Raid': ['deep threat', 'vertical threat', 'field general', 'accurate', 'strong arm', 'slot', 'possession'],
  'Pro Style': ['field general', 'accurate', 'possession', 'power back', 'blocking', 'physical', 'pass protector', 'strong arm'],
  Spread: ['scrambler', 'improviser', 'deep threat', 'vertical threat', 'agile', 'receiving back', 'slot', 'field general'],
  'West Coast': ['accurate', 'possession', 'slot', 'receiving back', 'agile', 'elusive back', 'field general', 'blocking'],
  'RPO Heavy': ['improviser', 'scrambler', 'power back', 'physical', 'run support', 'blocking', 'strong arm'],
}
const DEF_FIT: Record<string, string[]> = {
  '4-3 Base': ['run stopper', 'power rusher', 'power', 'zone', 'pass coverage', 'hybrid'],
  '3-4 Base': ['run stopper', 'power', 'smaller speed rusher', 'speed rusher', 'run support', 'hybrid'],
  '4-2-5 Nickel': ['manto man', 'slot', 'hybrid', 'pass coverage', 'zone', 'run support', 'agile'],
  Multiple: ['hybrid', 'zone', 'pass coverage', 'power rusher', 'run stopper', 'manto man', 'speed rusher'],
  'Blitz Heavy': ['smaller speed rusher', 'speed rusher', 'manto man', 'hybrid', 'power rusher', 'run support'],
}

/** 0..1 how well the player fits the scheme (1 = perfect, 0.7 = workable off-fit). */
export function schemeFit(p: Player, scheme?: string, side: 'OFF' | 'DEF' = 'OFF'): number {
  if (!scheme) return 0.75
  const table = side === 'OFF' ? OFF_FIT : DEF_FIT
  const rewards = table[scheme] ?? []
  const arch = (p.traits[0] ?? '').toLowerCase()
  if (!arch) return 0.75
  return rewards.some((r) => arch.includes(r)) ? 1 : 0.7
}

/** Human-readable fit label for the UI. */
export function fitLabel(p: Player, scheme?: string, side: 'OFF' | 'DEF' = 'OFF'): 'Ideal' | 'Good' | 'Poor' {
  const f = schemeFit(p, scheme, side)
  return f >= 0.95 ? 'Ideal' : f >= 0.65 ? 'Good' : 'Poor'
}

export interface FitSummary {
  total: number
  ideal: number
  good: number
  poor: number
  /** Ideal-fit share, 0-100. */
  idealPct: number
  /** Best and worst fits, for the report. */
  best: { id: string; name: string; pos: string }[]
  worst: { id: string; name: string; pos: string }[]
}

/**
 * Grade a whole unit against a coordinator's scheme. Offense includes specialists
 * (matching how the play engine groups the roster); defense is defenders only.
 */
export function schemeFitSummary(players: Player[], scheme: string | undefined, side: 'OFF' | 'DEF'): FitSummary {
  const unit = players.filter((p) => (side === 'DEF' ? p.side === 'DEF' : p.side !== 'DEF'))
  const scored = unit.map((p) => {
    const f = schemeFit(p, scheme, side)
    const label = f >= 0.95 ? 'ideal' : f >= 0.65 ? 'good' : 'poor'
    return { p, f, label }
  })
  const ideal = scored.filter((s) => s.label === 'ideal')
  const poor = scored.filter((s) => s.label === 'poor')
  const toMini = (s: { p: Player }) => ({ id: s.p.id, name: s.p.name, pos: s.p.pos })
  return {
    total: unit.length,
    ideal: ideal.length,
    good: scored.length - ideal.length - poor.length,
    poor: poor.length,
    idealPct: unit.length ? (ideal.length / unit.length) * 100 : 0,
    best: [...ideal].slice(0, 4).map(toMini),
    worst: [...poor].sort((a, b) => b.p.ovr - a.p.ovr).slice(0, 4).map(toMini),
  }
}

/** Convert a style value (−1..1.5) into a small numeric multiplier. */
export function mod(value: number, scale = 0.12) {
  return 1 + Math.max(-1, Math.min(1.5, value)) * scale
}

// ── Scheme familiarity ───────────────────────────────────────────────────────
// Players who fit the system AND stay in it learn the playbook. Understanding
// grows over seasons together and directly lifts production; a scheme change
// resets it.

/** How many seasons (0-5+) a player has been in this scheme, from his history. */
export function schemeTenure(seasonsInScheme: number): number {
  return Math.max(0, Math.min(5, seasonsInScheme))
}

/**
 * Playbook understanding multiplier. Year 1 = 1.0, rising ~4% per year to a
 * ~18% ceiling by year 5 — but a poor scheme fit never learns the system well.
 */
export function familiarityMultiplier(seasonsInScheme: number, fit: number): number {
  const yrs = schemeTenure(seasonsInScheme)
  // Poor fits (fit 0.35) cap out low; ideal fits (fit 1.0) reach the full ramp.
  const ceiling = 1 + (0.10 + fit * 0.10) * Math.min(1, yrs / 4)
  const ramp = Math.min(1, yrs / 3)
  return 1 + (ceiling - 1) * ramp
}

/** Advance a player's scheme tenure: +1 if the scheme is unchanged, else reset. */
export function nextTenure(prevScheme: string | undefined, currentScheme: string, prevYears: number | undefined): number {
  if (!prevScheme || prevScheme !== currentScheme) return prevYears && prevScheme === currentScheme ? (prevYears ?? 0) + 1 : 1
  return (prevYears ?? 0) + 1
}

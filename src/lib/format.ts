import { capSpaceTone } from '../game/engine/capMemo'
import { bestInk, parseHex } from './teamColor'

export function money(n: number, opts: { sign?: boolean } = {}) {
  const sign = opts.sign && n > 0 ? '+' : ''
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${sign}${n < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}${n < 0 ? '-' : ''}$${Math.round(abs / 1_000)}K`
  return `${sign}${n < 0 ? '-' : ''}$${abs}`
}

export function num(n: number) {
  return n.toLocaleString('en-US')
}

/** Typographic minus (U+2212). */
export const MINUS = '−'

/**
 * Signed number with a real minus sign: signed(-9) → "−9", signed(2.5, 1) → "+2.5".
 * Zero reads "+0" (or "0" with `zero: 'plain'`).
 */
export function signed(n: number, digits = 0, opts: { zero?: 'plus' | 'plain' } = {}) {
  const abs = Math.abs(n).toFixed(digits)
  if (Number(abs) === 0) return opts.zero === 'plain' ? abs : `+${abs}`
  return `${n < 0 ? MINUS : '+'}${abs}`
}

/** Multiplier: mult(0.84) → "×0.84". */
export function mult(x: number, digits = 2) {
  return `×${x.toFixed(digits)}`
}

/** 1 → "1st", 2 → "2nd", 11 → "11th", 22 → "22nd". */
export function ordinal(n: number) {
  const v = Math.abs(Math.trunc(n))
  const mod100 = v % 100
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][v % 10] ?? 'th')
  return `${n}${suffix}`
}

// ── Rating tiers (UI redesign §4) ─────────────────────────────────────────────
/** "Elite" means 90+ everywhere. */
export const ELITE = 90
/** League-average staff / starter rating used for "−17 vs avg" deltas. */
export const STAFF_BASELINE = 74

export type TierKey = 'elite' | 'pro' | 'starter' | 'rotation' | 'depth' | 'weak' | 'liability'

export interface RatingTier {
  key: TierKey
  label: string
  /** Short word for tight tiles (WEAK / LIAB.). */
  short: string
  /** Lowest value in the tier. */
  min: number
  /** Background: a solid tier colour, a tinted wash, or transparent. */
  fill: string
  /** Number colour on that fill. */
  ink: string
  /** Border colour for outline tiers; null for filled tiers. */
  outline: string | null
  /** Pips 5..1 so the tier never relies on colour alone (Liability shows 0). */
  pips: number
}

const TIERS: RatingTier[] = [
  { key: 'elite', label: 'Elite', short: 'ELITE', min: ELITE, fill: 'var(--color-tier-elite)', ink: 'var(--color-tier-on)', outline: null, pips: 5 },
  { key: 'pro', label: 'Pro Bowl', short: 'PRO', min: 82, fill: 'var(--color-tier-pro)', ink: 'var(--color-tier-on)', outline: null, pips: 4 },
  { key: 'starter', label: 'Starter', short: 'START', min: 74, fill: 'var(--color-tier-starter)', ink: 'var(--color-tier-on)', outline: null, pips: 3 },
  { key: 'rotation', label: 'Rotation', short: 'ROT.', min: 66, fill: 'var(--color-tier-rotation)', ink: 'var(--color-tier-on)', outline: null, pips: 2 },
  { key: 'depth', label: 'Depth', short: 'DEPTH', min: 58, fill: 'transparent', ink: 'var(--color-ink-2)', outline: 'var(--color-tier-depth)', pips: 1 },
  { key: 'weak', label: 'Weak', short: 'WEAK', min: 50, fill: 'var(--color-tier-weak-wash)', ink: 'var(--color-tier-weak)', outline: 'var(--color-tier-weak)', pips: 1 },
  { key: 'liability', label: 'Liability', short: 'LIAB.', min: -Infinity, fill: 'var(--color-tier-liab-wash)', ink: 'var(--color-tier-liab)', outline: 'var(--color-tier-liab)', pips: 0 },
]

/** The tier for a rating on the NFL scale (players, staff, prospects, college grades). */
export function ratingTier(v: number): RatingTier {
  return TIERS.find((t) => v >= t.min) ?? TIERS[TIERS.length - 1]
}

/** Solid colour token per tier, used by the deprecated gradeColor() shim. */
const TIER_SOLID: Record<TierKey, string> = {
  elite: 'var(--color-tier-elite)',
  pro: 'var(--color-tier-pro)',
  starter: 'var(--color-tier-starter)',
  rotation: 'var(--color-tier-rotation)',
  depth: 'var(--color-tier-depth)',
  weak: 'var(--color-tier-weak)',
  liability: 'var(--color-tier-liab)',
}
const TIER_SOLID_ON: Record<string, string> = {
  'var(--color-tier-elite)': 'var(--color-tier-on)',
  'var(--color-tier-pro)': 'var(--color-tier-on)',
  'var(--color-tier-starter)': 'var(--color-tier-on)',
  'var(--color-tier-rotation)': 'var(--color-tier-on)',
  'var(--color-tier-depth)': 'var(--color-tier-depth-on)',
  'var(--color-tier-weak)': 'var(--color-tier-weak-on)',
  'var(--color-tier-liab)': 'var(--color-tier-liab-on)',
}

/**
 * @deprecated Use ratingTier(). Kept so existing screens compile: returns the
 * tier's solid colour token (a CSS var string, usable as background / stroke).
 */
export function gradeColor(v: number) {
  return TIER_SOLID[ratingTier(v).key]
}

/**
 * Contrast-aware ink for a background: #FFFFFF or #0B1220, whichever has the
 * higher WCAG contrast. Also accepts the tier tokens gradeColor() returns.
 * @deprecated for tiers — use ratingTier().ink.
 */
export function inkOn(bg: string) {
  const tierOn = TIER_SOLID_ON[bg]
  if (tierOn) return tierOn
  if (!parseHex(bg)) return 'var(--color-ink)'
  return bestInk(bg)
}

/** Light tint of a hex color, for soft team backgrounds. */
export function tint(hex: string, amount = 0.88) {
  const c = hex.replace('#', '')
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  const mix = (v: number) => Math.round(v + (255 - v) * amount)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

// ── Status tones ──────────────────────────────────────────────────────────────
export type Tone = 'win' | 'neutral' | 'warn' | 'loss'

/**
 * Cap space in DOLLARS: over the cap is loss, under $5M warn, comfortable is
 * neutral, flush is win. Thresholds live in the engine (capMemo.spaceBucket).
 */
export function capTone(dollars: number): Tone {
  return capSpaceTone(dollars) ?? 'neutral'
}

/** Job security (0-100) against the owner's firing line. */
export function jobTone(security: number, firingLine: number): Tone {
  if (security > firingLine + 25) return 'win'
  if (security > firingLine + 10) return 'neutral'
  if (security > firingLine) return 'warn'
  return 'loss'
}

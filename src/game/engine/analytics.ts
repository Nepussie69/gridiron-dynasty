// ─────────────────────────────────────────────────────────────────────────────
// The analytics department (FUTURES row 19).
//
// Hire analysts to sharpen what you see: a model win probability, a 4th-down
// recommendation, and projected opponent tendencies. Everything here is DERIVED
// from the live game state with no rng() draws and no sim hooks — an analyst
// changes information, never results. If you ignore the advice, the game plays
// out exactly as it would with nobody in the analytics room.
//
// Quality scales with the analyst's rating (a `Analytics` staff member; a
// Director of Player Personnel or GM focused on analytics contributes at 60%).
// ─────────────────────────────────────────────────────────────────────────────

import type { Player, StaffMember } from '../types'
import type { World } from './generate'
import { teamStrength } from './generate'
import { depthGroup } from './depth'
import { attributesFor } from '../data/ratings'
import { aiTendency } from './playsim'
import {
  fourthDownEV,
  topKey,
  OFF_CLASSES,
  DEF_CALLS,
  OFF_CLASS_LABEL,
  DEF_CALL_LABEL,
  type Bucket,
  type Situation,
} from './decisions'
import { clamp } from './rng'
import { ANALYTICS_ROLE } from './hiring'

export type AnalyticsLevel = 'none' | 'basic' | 'sharp' | 'elite'
export type Confidence = 'low' | 'medium' | 'high'

export interface AnalyticsState {
  /** Effective 0–100 analytics rating (0 = no department). */
  rating: number
  level: AnalyticsLevel
  /** The dedicated analyst's name, when one is on staff. */
  name: string | null
  /** True when the input comes only from a DPP/GM focused on analytics. */
  fromFrontOffice: boolean
}

export function analyticsLevel(rating: number): AnalyticsLevel {
  if (rating <= 0) return 'none'
  if (rating < 62) return 'basic'
  if (rating < 82) return 'sharp'
  return 'elite'
}

export const ANALYTICS_LEVEL_LABEL: Record<AnalyticsLevel, string> = {
  none: 'No department',
  basic: 'Basic',
  sharp: 'Sharp',
  elite: 'Elite',
}

function analyticsRatingFromStaff(staff: StaffMember[]): { rating: number; fromFrontOffice: boolean } {
  let best = 0
  let front = false
  for (const m of staff) {
    if (m.role === ANALYTICS_ROLE) {
      if (m.rating > best) {
        best = m.rating
        front = false
      }
    } else if (
      (m.role === 'Director of Player Personnel' || m.role === 'General Manager') &&
      m.focus === 'Analytics'
    ) {
      const v = Math.round(m.rating * 0.6)
      if (v > best) {
        best = v
        front = true
      }
    }
  }
  return { rating: best, fromFrontOffice: front }
}

/** Effective analytics quality for a club (0 when nobody covers it). */
export function analyticsRating(world: World, teamId: string): number {
  return analyticsRatingFromStaff(world.staff[teamId] ?? []).rating
}

export function analyticsState(world: World, teamId: string): AnalyticsState {
  const { rating, fromFrontOffice } = analyticsRatingFromStaff(world.staff[teamId] ?? [])
  const analyst = (world.staff[teamId] ?? []).find((s) => s.role === ANALYTICS_ROLE)
  return { rating, level: analyticsLevel(rating), name: analyst?.name ?? null, fromFrontOffice }
}

// ── Sharper win probability ──────────────────────────────────────────────────
export interface WinProjection {
  /** The plain talent model every club's screen has always shown. */
  base: number
  /** What the department displays: base without analysts, blended with the form model with them. */
  value: number
  /** ± half-width of the model's confidence band (probability points). */
  margin: number
  confidence: Confidence
  /** True when an analytics input refined the number. */
  sharp: boolean
  factors: string[]
}

function confidenceFor(margin: number): Confidence {
  return margin <= 0.07 ? 'high' : margin <= 0.13 ? 'medium' : 'low'
}

/**
 * A win probability for one matchup. Without analysts this is exactly the
 * strength-vs-strength figure the dashboard has always used (home field worth
 * 0.5). With them it blends in a season scoring-differential form model and
 * reports a tighter confidence band.
 */
export function winProjection(world: World, teamId: string, oppId: string, home: boolean): WinProjection {
  const mine = teamStrength(world.roster[teamId] ?? [])
  const theirs = teamStrength(world.roster[oppId] ?? [])
  const hf = home ? 0.5 : -0.5
  const base = clamp(0.5 + (mine + hf - theirs) / 20, 0.08, 0.92)
  const { rating } = analyticsRatingFromStaff(world.staff[teamId] ?? [])

  const me = world.standings[teamId]
  const op = world.standings[oppId]
  const games = (r: typeof me) => (r ? r.wins + r.losses + r.ties : 0)
  const gp = games(me)
  const ogp = games(op)

  if (!rating) {
    return { base, value: base, margin: 0.16, confidence: 'low', sharp: false, factors: [] }
  }

  const diff = (r: typeof me, n: number) => (r && n > 0 ? (r.pointsFor - r.pointsAgainst) / n : 0)
  const formDiff = diff(me, gp) - diff(op, ogp)
  const form = clamp(0.5 + formDiff / 26, 0.05, 0.95)
  // More analyst quality, and more games on tape, means more weight on form.
  const weight = clamp((rating / 100) * 0.55, 0.2, 0.6) * (gp >= 3 && ogp >= 3 ? 1 : 0.35)
  const value = clamp(base * (1 - weight) + form * weight, 0.06, 0.94)
  const margin = clamp(0.2 - (rating / 100) * 0.13 - Math.min(gp, ogp) * 0.004, 0.04, 0.2)
  const factors = [
    `talent ${mine >= theirs ? '+' : ''}${(mine - theirs).toFixed(1)}`,
    home ? 'home field' : 'on the road',
    gp >= 1 || ogp >= 1 ? `form ${formDiff >= 0 ? '+' : ''}${formDiff.toFixed(1)} pts/g` : 'no games yet',
  ]
  return { base, value, margin, confidence: confidenceFor(margin), sharp: true, factors }
}

/** A kicker's combined power/accuracy, matching the sim's 50/50 blend. */
function kickPowerFor(world: World, teamId: string): number {
  const k: Player | undefined = depthGroup(world, teamId, ['K'], 1)[0]
  if (!k) return 80
  const a = { ...attributesFor(k.id, k.pos, k.ovr), ...(k.attrs ?? {}) }
  return ((a.KPW ?? 78) * 0.5 + (a.KAC ?? 78) * 0.5)
}

// ── 4th-down advice ──────────────────────────────────────────────────────────
export interface FourthAdvice {
  choice: 'go' | 'fg' | 'punt'
  label: string
  ev: { go: number; fg: number | null; punt: number }
  /** The margin of the winner over the next-best option, in expected points. */
  edge: number
  confidence: Confidence
  note: string
}

/**
 * The department's 4th-down recommendation, or null when nobody is on staff.
 * Advisory only — the sim's own call sheet is untouched.
 */
export function fourthAdvice(world: World, teamId: string, sit: Situation): FourthAdvice | null {
  const { rating } = analyticsRatingFromStaff(world.staff[teamId] ?? [])
  if (!rating) return null
  const kp = kickPowerFor(world, teamId)
  const ev = fourthDownEV(sit, kp)
  const opts: { id: 'go' | 'fg' | 'punt'; label: string; ev: number }[] = [
    { id: 'go', label: 'go for it', ev: ev.go },
  ]
  if (ev.fg != null) opts.push({ id: 'fg', label: 'kick the field goal', ev: ev.fg })
  opts.push({ id: 'punt', label: 'punt', ev: ev.punt })
  opts.sort((a, b) => b.ev - a.ev)
  const best = opts[0]
  const edge = best.ev - opts[1].ev
  const confidence: Confidence = rating >= 82 ? 'high' : rating >= 62 ? 'medium' : 'low'
  const note =
    edge < 0.3
      ? `Model calls this a coin flip — ${best.label} by a hair.`
      : `Model favors ${best.label} by ${edge.toFixed(1)} expected points.`
  return { choice: best.id, label: best.label, ev, edge, confidence, note }
}

// ── Sharper opponent tendencies ──────────────────────────────────────────────
export interface TendencyRow {
  side: 'off' | 'def'
  bucket: Bucket
  /** Human-readable call, e.g. "throw short" or "Blitz". */
  label: string
  share: number
  /** ± band around `share`, narrower with a better analyst. */
  span: number
}

export const ANALYTICS_BUCKETS: Bucket[] = ['1st', '2nd-long', '3rd-long', 'redzone']

/**
 * The opponent's projected tendencies per bucket, with a confidence band, or
 * null when nobody covers analytics. Read-only projection of `aiTendency`.
 */
export function tendencyReport(world: World, oppId: string, rating: number): TendencyRow[] | null {
  if (!rating) return null
  const span = rating >= 82 ? 0.04 : rating >= 62 ? 0.07 : 0.12
  const rows: TendencyRow[] = []
  for (const bucket of ANALYTICS_BUCKETS) {
    const dist = aiTendency(world, oppId, bucket)
    const off = topKey(dist.off, OFF_CLASSES)
    const def = topKey(dist.def, DEF_CALLS)
    rows.push({ side: 'off', bucket, label: OFF_CLASS_LABEL[off.key], share: off.share, span })
    rows.push({ side: 'def', bucket, label: DEF_CALL_LABEL[def.key], share: def.share, span })
  }
  return rows
}

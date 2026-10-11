// J9 (FUTURES #32): individual coach sub-ratings.
//
// Staff used to be a single 0–100 `rating` and every in-game coaching effect read
// that one number (or an average of several seats). This module gives each coach
// the same treatment players get: a sheet of individual sub-ratings. Each effect
// now reads the specific sub of the coach actually in that seat.
//
// `coachSubs(m)` is PURE and deterministic (a hash32 of the coach id spreads each
// sub ±12 around the coach's overall rating, his specialty boosts its matching sub
// +6, clamped 25–99) — no rng() draw, no store write, so old saves derive the same
// sheet on read and the OFF path is byte-identical to the unmodified engine.

import { clamp, hash32 } from './rng'
import type { StaffMember, CoachSubs, StaffRole } from '../types'
import type { World } from './generate'

/** J9 tunables — the only new constants this job adds. */
export const J9 = {
  /** Half-width of the deterministic spread each sub gets around the coach rating. */
  spread: 12,
  /** Specialty bonus added to the sub that specialty maps to. */
  specialtyBoost: 6,
  /** A vacant seat plays like a poor coach: every sub sits on this floor. */
  floor: 40,
  /** Lower/upper clamp for a derived sub. */
  lo: 25,
  hi: 99,
  /** Penalty multiplier at the league-mean discipline (off=1; the old formula's mean). */
  disciplineBase: 1.0,
  /** Penalty multiplier per point of HC discipline above/below the league mean. */
  disciplinePerPt: 0.006,
  /** Discipline multiplier clamp. */
  disciplineLo: 0.75,
  disciplineHi: 1.25,
  /** HC-adjustments → AI halftime-fix probability: p = clamp(base + (adj − 60)/scale). */
  adjBase: 0.4,
  adjScale: 100,
  adjLo: 0.2,
  adjHi: 0.8,
  /**
   * How much of the head coach's gameManagement deviation feeds the tendency
   * thresholds (fourth-down / two-point / timeouts). The sub sheet's ±12 spread
   * is wider than the old overall-rating spread, and these seats are decided by
   * hard thresholds (aggro ≥ 0.8, timeouts ≥ 75), so a zero-mean-but-wider term
   * would still raise the league's aggressive share (measured 9% → 19%) and drift
   * scoring. Scaling the deviation about the league mean keeps the aggregate
   * behaviour on the old band while the sub still orders every coach.
   */
  tendencyScale: 0.67,
} as const

/** A vacant seat's sheet — every sub on the floor (a poor coach, not an average one). */
export const COACH_SUBS_FLOOR: CoachSubs = {
  playCalling: J9.floor,
  gameManagement: J9.floor,
  adjustments: J9.floor,
  disguise: J9.floor,
  reads: J9.floor,
  discipline: J9.floor,
  motivation: J9.floor,
  development: J9.floor,
}

/** Which sub a specialty sharpens (specialties come from names.ts + coachingTree.ts). */
const SPECIALTY_SUB: Record<string, keyof CoachSubs> = {
  'Play Calling': 'playCalling',
  'Offense architect': 'playCalling',
  'Game manager': 'gameManagement',
  'Red Zone': 'adjustments',
  'Defense architect': 'disguise',
  'Pass Rush': 'disguise',
  Secondary: 'disguise',
  Analyst: 'reads',
  Tendencies: 'reads',
  Disciplinarian: 'discipline',
  'Culture Builder': 'motivation',
  'Players\u2019 coach': 'motivation',
  'QB Development': 'development',
  'O-Line Play': 'development',
  Developer: 'development',
}

const SUB_KEYS: (keyof CoachSubs)[] = [
  'playCalling', 'gameManagement', 'adjustments', 'disguise',
  'reads', 'discipline', 'motivation', 'development',
]

/**
 * J9: a coach's sub-ratings. Uses a stored sheet if the save carries one (new
 * saves), otherwise derives one deterministically from the id + overall rating so
 * old saves behave identically. Pure — never draws from any rng.
 */
export function coachSubs(m: StaffMember): CoachSubs {
  if (m.subs) return m.subs
  const boost = SPECIALTY_SUB[m.specialty]
  const base = m.rating
  const out = {} as CoachSubs
  for (const key of SUB_KEYS) {
    const h = hash32(`${m.id}:${key}`, 9)
    const off = (h % (J9.spread * 2 + 1)) - J9.spread // −spread … +spread
    out[key] = clamp(Math.round(base + off + (boost === key ? J9.specialtyBoost : 0)), J9.lo, J9.hi)
  }
  return out
}

// ── dev-only toggle (the setStamina pattern) ─────────────────────────────────
// Default ON. With it OFF every site falls back to the exact pre-J9 expression,
// so calibration is byte-identical to unmodified main.
let COACH_SUBS_ON = true
export function setCoachSubs(on: boolean) {
  COACH_SUBS_ON = on
}
export function getCoachSubs(): boolean {
  return COACH_SUBS_ON
}

// ── league centering ─────────────────────────────────────────────────────────
// The sub sheet sits on the coach rating, but we still centre each term on the
// league so a club at the league average plays exactly as before and NFL bands
// do not drift. For a role+sub we remove `mean(sub) − mean(rating)`; the sheet's
// own ±spread is zero-mean and the specialty boost is the only systematic lift.
interface SubStats { key: string; bias: Record<string, number>; meanRating: Record<string, number>; n: Record<string, number> }
const subBiasCache = new WeakMap<World, SubStats>()

/** J9: a seat's sub, centred so the league average matches the old rating term. */
export function centeredSub(world: World, role: StaffRole, key: keyof CoachSubs, m?: StaffMember): number {
  const raw = m ? coachSubs(m)[key] : COACH_SUBS_FLOOR[key]
  const bias = subBias(world, role, key)
  return raw - bias
}

/** J9: the league's mean overall rating for a seat (the anchor a scaled sub deviates from). */
export function coachMeanRating(world: World, role: StaffRole): number {
  seatStats(world, role)
  return subBiasCache.get(world)!.meanRating[role] ?? 74
}

/** J9: `mean(sub) − mean(rating)` over the league's coaches in this seat. */
export function subBias(world: World, role: StaffRole, key: keyof CoachSubs): number {
  const stats = seatStats(world, role)
  const tag = `${role}|${key}`
  const cached = stats.bias[tag]
  if (cached !== undefined) return cached
  let sumSub = 0
  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    const m = (world.staff[t.id] ?? []).find((s) => s.role === role)
    if (!m) continue
    sumSub += coachSubs(m)[key]
  }
  const bias = stats.meanRating[role] !== undefined && stats.n[role]
    ? sumSub / stats.n[role] - stats.meanRating[role]
    : 0
  stats.bias[tag] = bias
  return bias
}

/** J9: per-seat league stats (mean overall rating + sample size), cached per world/week. */
function seatStats(world: World, role: StaffRole): SubStats {
  const cacheKey = `${world.season}:${world.week}`
  let hit = subBiasCache.get(world)
  if (!hit || hit.key !== cacheKey) {
    hit = { key: cacheKey, bias: {}, meanRating: {}, n: {} }
    subBiasCache.set(world, hit)
  }
  if (hit.meanRating[role] === undefined) {
    let sum = 0
    let n = 0
    for (const t of world.teams) {
      if (t.tier !== 'NFL') continue
      const m = (world.staff[t.id] ?? []).find((s) => s.role === role)
      if (!m) continue
      sum += m.rating
      n += 1
    }
    hit.meanRating[role] = n ? sum / n : 74
    hit.n[role] = n
  }
  return hit
}

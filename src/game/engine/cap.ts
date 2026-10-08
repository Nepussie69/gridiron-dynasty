// ─────────────────────────────────────────────────────────────────────────────
// NFL salary cap model
//
// Models the real cap pathway closely enough to make decisions matter:
//   · Fixed league cap (the 2025 NFL number, $279.2M) for every season; 89% floor
//   · Market-value contracts (AAV by overall, position, age)
//   · Signing-bonus proration → cap hit ≠ AAV
//   · Rookie wage scale (slotted 4-year deals, 5th-year option for Round 1)
//   · Guaranteed money, dead money on release, June 1 designation
//   · Restructures (convert base → bonus, spread over void years)
//   · Franchise / transition tags, extensions, veteran minimum by experience
// ─────────────────────────────────────────────────────────────────────────────

import type { Contract, Player, Position } from '../types'
import { rint, type Rng } from './rng'

/** Coerce a possibly-undefined/NaN contract field to a usable number. */
function finite(n: number | undefined): number {
  return Number.isFinite(n) ? (n as number) : 0
}

/** The fixed salary cap: the real 2025 NFL number, held flat every season. */
export const SALARY_CAP = 279_200_000
export const CAP_FLOOR_PCT = 0.89

/** League cap for a given season. L12.14 C1: fixed at the 2025 number. */
export function capForSeason(_season: number) {
  return SALARY_CAP
}

/** Multiplier that keeps market values in step with cap growth. Fixed cap ⇒ 1. */
export function capScale(_season: number) {
  return 1
}

/** Veteran minimum salary, scaling with credited seasons (0–7+). */
export function minSalary(creditedSeasons: number) {
  const tiers = [
    840_000, 960_000, 1_075_000, 1_190_000, 1_305_000, 1_420_000, 1_535_000, 1_650_000,
  ]
  return tiers[Math.min(Math.max(creditedSeasons, 0), tiers.length - 1)]
}

/**
 * Top-of-market AAV by position (at ~99 overall), in dollars.
 *
 * L12.14 C2: recalibrated against the 2025 top-of-market bands so that the
 * average of the five best real players at each position — the league's actual
 * top-5 AAV — lands in band. The model's steep OVR curve means positions whose
 * elite tier tops out around 85–90 overall (K, P, C, OG, LB) need a high
 * theoretical ceiling to reach their real top-of-market numbers.
 */
const POS_TOP: Record<string, number> = {
  QB: 79.5, DE: 55.5, WR: 48, DT: 50.5, OT: 44, CB: 40.5, OG: 41.5, S: 32.5, TE: 34,
  RB: 26, LB: 40.5, C: 41.5, K: 30.6, P: 16.3,
}

/** Estimated market AAV for a player. */
export function marketAAV(ovr: number, pos: Position, age: number) {
  const top = (POS_TOP[pos] ?? 20) * 1_000_000
  const frac = Math.pow(Math.max(ovr - 58, 1) / 41, 2.6)
  let aav = top * frac
  if (age >= 33) aav *= 0.58
  else if (age >= 31) aav *= 0.8
  else if (age <= 24) aav *= 1.05
  const floor = minSalary(Math.max(age - 22, 0))
  return Math.max(floor, Math.round(aav / 100_000) * 100_000)
}

/** Recompute a contract's current-year cap hit from base + proration. */
export function recomputeCapHit(c: Contract): Contract {
  return { ...c, capHit: (c.base[0] ?? 0) + c.proration }
}

/** Build a veteran market contract. */
export function makeVeteranContract(rng: Rng, ovr: number, pos: Position, age: number, season: number): Contract {
  const aav = Math.round((marketAAV(ovr, pos, age) * capScale(season)) / 100_000) * 100_000
  const length = age <= 25 ? rint(rng, 3, 5) : age <= 28 ? rint(rng, 3, 4) : age <= 31 ? rint(rng, 2, 3) : rint(rng, 1, 2)
  const bonusPct = ovr >= 90 ? 0.46 : ovr >= 82 ? 0.36 : ovr >= 72 ? 0.24 : 0.14
  const signingBonus = Math.round(aav * length * bonusPct)
  const totalBase = aav * length - signingBonus
  // Escalating base schedule, normalized to the total base.
  const weights = Array.from({ length }, (_, i) => 0.85 + i * 0.08)
  const wsum = weights.reduce((a, b) => a + b, 0)
  const base = weights.map((w) => Math.round((totalBase * w) / wsum))
  // Guard the 1-year deal: base[1] is undefined for a single season, which used
  // to leak NaN through guaranteed (and thus dead money).
  const guaranteedBase = ovr >= 86 ? base[0] + (base[1] ?? 0) : ovr >= 78 ? base[0] : Math.round(base[0] * 0.4)
  const proration = Math.round(signingBonus / length)
  const c: Contract = {
    years: length,
    length,
    base,
    signingBonus,
    proration,
    guaranteed: guaranteedBase,
    capHit: 0,
    annual: aav,
    signedThrough: season + length - 1,
    voidYears: 0,
  }
  return recomputeCapHit(c)
}

/**
 * Rookie wage scale. Slotted 4-year deals; Round 1 carries a 5th-year team option.
 * Values approximate the 2026 scale.
 */
export function makeRookieContract(pick: number, season: number): Contract {
  const round = pick <= 32 ? 1 : pick <= 64 ? 2 : pick <= 100 ? 3 : pick <= 140 ? 4 : pick <= 180 ? 5 : pick <= 220 ? 6 : 7
  const total =
    (round === 1 ? 44e6 * Math.pow(0.955, pick - 1)
    : round === 2 ? 9.6e6 * Math.pow(0.96, pick - 33)
    : round === 3 ? 5.7e6 * Math.pow(0.97, pick - 65)
    : 4.5e6 * Math.pow(0.985, pick - 101)) * capScale(season)
  const length = 4
  const bonusPct = round === 1 ? 0.5 : round <= 3 ? 0.24 : 0.1
  const signingBonus = Math.round(total * bonusPct)
  const totalBase = total - signingBonus
  const weights = [1.0, 1.12, 1.25, 1.4].slice(0, length)
  const wsum = weights.reduce((a, b) => a + b, 0)
  const base = weights.map((w) => Math.round((totalBase * w) / wsum))
  const fullyGuaranteed = round === 1
  const guaranteed = fullyGuaranteed ? base.reduce((a, b) => a + b, 0) : round <= 2 ? base[0] + base[1] : base[0]
  return recomputeCapHit({
    years: length,
    length,
    base,
    signingBonus,
    proration: Math.round(signingBonus / length),
    guaranteed,
    capHit: 0,
    annual: Math.round(total / length),
    signedThrough: season + length - 1,
    voidYears: 0,
    rookie: true,
    fifthYearOption: round === 1,
  })
}

/**
 * The remaining total value of a contract: every remaining base salary plus the
 * remaining prorated signing bonus (accelerated over all remaining years,
 * including void years). Dead money can never exceed this. Non-finite inputs
 * (defensive) count as zero so the number is always usable in the UI.
 */
export function remainingContractValue(c: Contract) {
  const base = (c.base ?? []).reduce((a, b) => a + finite(b), 0)
  const remainingBonus = Math.max(0, finite(c.proration)) * Math.max(0, finite(c.years) + finite(c.voidYears))
  return base + remainingBonus
}

/**
 * Dead money if released now. Real NFL rule: the remaining prorated signing
 * bonus (every remaining year, void years included) plus the guaranteed salary
 * still owed — never more than the remaining total contract value. The cap
 * matters because a guaranteed percentage can exceed the base dollars added by
 * an extension.
 */
export function deadMoney(c: Contract) {
  const remainingBonus = Math.max(0, finite(c.proration)) * Math.max(0, finite(c.years) + finite(c.voidYears))
  const guaranteed = Math.max(0, finite(c.guaranteed))
  const remainingValue = remainingContractValue(c)
  return Math.round(Math.min(remainingBonus + guaranteed, remainingValue))
}

/** Cap savings from releasing a player now (cap hit − dead money). */
export function capSavings(c: Contract) {
  return c.capHit - deadMoney(c)
}

/** Restructure: convert base salary into signing bonus and spread it. */
export function restructure(c: Contract, extraVoidYears = 2): Contract {
  if (c.years < 1) return c
  const amount = Math.round(c.base[0] * 0.85)
  const spread = c.years + c.voidYears + extraVoidYears
  const addedProration = Math.round(amount / spread)
  const next: Contract = {
    ...c,
    base: [c.base[0] - amount, ...c.base.slice(1)],
    signingBonus: c.signingBonus + amount,
    proration: c.proration + addedProration,
    voidYears: c.voidYears + extraVoidYears,
  }
  return recomputeCapHit(next)
}

/** Advance a contract one season. Returns null if it expires. */
export function tickContractYear(c: Contract): Contract | null {
  if (c.years <= 1) return null
  const base = c.base.slice(1)
  return recomputeCapHit({
    ...c,
    years: c.years - 1,
    base,
    guaranteed: Math.max(0, c.guaranteed - (c.base[0] ?? 0)),
    signedThrough: c.signedThrough,
  })
}

/** Extend a contract by adding years at market value. */
export function extendContract(c: Contract, rng: Rng, ovr: number, pos: Position, age: number, season: number) {
  const add = makeVeteranContract(rng, ovr, pos, age, season)
  const years = c.years + add.years
  const base = [...c.base, ...add.base]
  const proration = c.proration + add.proration
  const next: Contract = {
    ...c,
    years,
    length: c.length + add.length,
    base,
    signingBonus: c.signingBonus + add.signingBonus,
    proration,
    guaranteed: c.guaranteed + add.guaranteed,
    annual: Math.round((c.annual * c.years + add.annual * add.years) / years),
    signedThrough: season + years - 1,
  }
  return recomputeCapHit(next)
}

/** Franchise/transition tag value = average of the top-5 cap hits at the position. */
export function tagValue(players: Player[], pos: Position, kind: 'franchise' | 'transition' = 'franchise') {
  const at = players
    .filter((p) => p.pos === pos && p.teamId)
    .map((p) => p.contract.annual)
    .sort((a, b) => b - a)
    .slice(0, 5)
  const avg = at.reduce((s, v) => s + v, 0) / (at.length || 1)
  const base = avg > 0 ? avg : marketAAV(85, pos, 27)
  return Math.round(base * (kind === 'franchise' ? 1.2 : 1.05))
}

export interface CapSummary {
  limit: number
  floor: number
  used: number
  space: number
  dead: number
  top5: number
  overTheCap: boolean
  meetsFloor: boolean
}

export function summarizeCap(roster: Player[], dead: number, season: number): CapSummary {
  const limit = capForSeason(season)
  const used = roster.reduce((s, p) => s + p.contract.capHit, 0) + dead
  const top5 = [...roster]
    .sort((a, b) => b.contract.capHit - a.contract.capHit)
    .slice(0, 5)
    .reduce((s, p) => s + p.contract.capHit, 0)
  return {
    limit,
    floor: Math.round(limit * CAP_FLOOR_PCT),
    used,
    space: limit - used,
    dead,
    top5,
    overTheCap: used > limit,
    meetsFloor: used >= limit * CAP_FLOOR_PCT,
  }
}

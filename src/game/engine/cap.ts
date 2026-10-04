// ─────────────────────────────────────────────────────────────────────────────
// NFL salary cap model
//
// Models the real cap pathway closely enough to make decisions matter:
//   · League cap with ~7%/yr growth; 89% spending floor
//   · Market-value contracts (AAV by overall, position, age)
//   · Signing-bonus proration → cap hit ≠ AAV
//   · Rookie wage scale (slotted 4-year deals, 5th-year option for Round 1)
//   · Guaranteed money, dead money on release, June 1 designation
//   · Restructures (convert base → bonus, spread over void years)
//   · Franchise / transition tags, extensions, veteran minimum by experience
// ─────────────────────────────────────────────────────────────────────────────

import type { Contract, Player, Position } from '../types'
import { rint, type Rng } from './rng'

export const CAP_2026 = 279_200_000
export const CAP_FLOOR_PCT = 0.89

/** League cap for a given season (~7% annual growth from 2026). */
export function capForSeason(season: number) {
  return Math.round(CAP_2026 * Math.pow(1.07, season - 2026))
}

/** Multiplier that keeps market values in step with cap growth. */
export function capScale(season: number) {
  return capForSeason(season) / CAP_2026
}

/** Veteran minimum salary, scaling with credited seasons (0–7+). */
export function minSalary(creditedSeasons: number) {
  const tiers = [
    840_000, 960_000, 1_075_000, 1_190_000, 1_305_000, 1_420_000, 1_535_000, 1_650_000,
  ]
  return tiers[Math.min(Math.max(creditedSeasons, 0), tiers.length - 1)]
}

/** Top-of-market AAV by position (at ~99 overall), in dollars. */
const POS_TOP: Record<string, number> = {
  QB: 62, DE: 42, WR: 38, DT: 36, OT: 32, CB: 30, LB: 27, S: 26, TE: 25,
  RB: 21, OG: 21, C: 19, K: 6.5, P: 4.5,
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
  const guaranteedBase = ovr >= 86 ? base[0] + base[1] : ovr >= 78 ? base[0] : Math.round(base[0] * 0.4)
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

/** Dead money if released now (remaining prorated bonus + remaining guaranteed base). */
export function deadMoney(c: Contract) {
  const remainingProration = c.proration * (c.years + c.voidYears)
  return Math.round(remainingProration + c.guaranteed)
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

// ─────────────────────────────────────────────────────────────────────────────
// r2aging — Realism 2 #11: development & aging curves.
//
// Every player used to age on ONE league-wide set of age bands (young growth to
// 26, a coin-flip plateau 27-29, then the same decline for a QB and a running
// back). This module gives each position its own curve, measured from real
// careers, and lets the player's OWN traits move him along it:
//
//   • peak age by position     — RB 25.5, WR 25.8, CB 25.8, LB 26.0, TE 26.2,
//                                DE/DT 26.3, S 26.3, OT/OG/C 27.4-27.5, QB 28.0,
//                                K/P 28.5 (analysis/aging_nfl.py, n per position in
//                                the verify file)
//   • decline slope by position — RB/CB fall fastest, QB/OL/K slowest
//   • work ethic (hidden character) moves the peak later/earlier and softens or
//     steepens the decline: +1.2 years and ×0.85 slope for an elite motor,
//     −1.2 years and ×1.15 for a poor one
//   • injury history (games missed over his last three NFL seasons, plus any
//     injury he is carrying) moves the peak earlier and steepens the decline
//   • stable per-player variance from his id: ~10% late bloomers (+1.4 years,
//     a little more growth at 25-26), ~10% early declines (−1.4 years) — the
//     career shape differs between two men with the same traits, as it does in
//     the real data (peak-age SD 2.6-3.6 years)
//   • retirement probability leans by position (RB/CB out sooner, QB/OL/K later)
//
// NO SIM CHANGE. `playsim.ts` never imports this file; the SIM line is
// byte-identical with the toggle either way. The OFF path in `progress.ts` is
// the original expression untouched, so an old save with the toggle off runs
// byte-for-byte as before. With the toggle on, the SAME `rng()` call sites and
// the SAME number of draws are used — only the arithmetic around each draw
// changes, so the seed stream keeps its length and order (calib --eq 20/20).
// ─────────────────────────────────────────────────────────────────────────────

import type { Player, Position } from '../types'
import { clamp, hash32 } from './rng'

/**
 * r2aging tunables — the only new constants this job adds. `on` is flipped
 * after the probe shows the engine curves match the measured NFL curves.
 */
export const R2AGING = {
  /** Master switch. OFF = the original `progress.ts` arithmetic, byte-identical. */
  on: true as boolean,
  /**
   * Peak age by position, measured from nflverse player_stats 1999-2025
   * (`analysis/aging_nfl.py`, value = EPA / defensive composite / snaps).
   * The game OVR curve peaks a touch later than the raw value peak because a
   * player keeps his role a year after his best production year.
   */
  peak: {
    QB: 28.0, RB: 25.5, WR: 25.8, TE: 26.2,
    OT: 27.5, OG: 27.4, C: 27.4,
    DE: 26.3, DT: 26.3, LB: 26.0, CB: 25.8, S: 26.3,
    K: 28.5, P: 28.5,
  } as Record<Position, number>,
  /**
   * How fast a position falls once past its peak (OVR points per year at the
   * base rate). Scales the measured retention: RB +3 years ≈ 0.54 of peak,
   * QB +3 ≈ 0.60 but from a later peak, K +3 ≈ 0.61.
   */
  decline: {
    QB: 0.60, RB: 1.40, WR: 1.00, TE: 0.90,
    OT: 0.65, OG: 0.65, C: 0.65,
    DE: 0.85, DT: 0.85, LB: 0.90, CB: 1.15, S: 0.90,
    K: 0.45, P: 0.45,
  } as Record<Position, number>,
  /** Young-player growth tempo vs the old league-wide formula (mean ≈ 1). */
  growth: {
    QB: 0.95, RB: 1.10, WR: 1.05, TE: 1.00,
    OT: 0.95, OG: 0.95, C: 0.95,
    DE: 1.00, DT: 1.00, LB: 1.00, CB: 1.05, S: 1.00,
    K: 0.90, P: 0.90,
  } as Record<Position, number>,
  /** Peak shift (years) for an elite (+1) / poor (−1) work ethic. */
  workPeakYears: 2.0,
  /** Peak shift (years) at a full injury history (0 games played of a possible 17 × 3). */
  injuryPeakYears: 2.5,
  /** Decline multiplier for an elite (+1) / poor (−1) motor. */
  workDecline: 0.30,
  /** Extra decline multiplier at a full injury history. */
  injuryDecline: 0.55,
  /** Share of players who are late bloomers / early decliners (stable by id). */
  lateShare: 0.10,
  earlyShare: 0.10,
  /** Years a late bloomer / early decliner is shifted. */
  variantYears: 1.8,
  /** Extra growth fraction at 25-26 for a late bloomer (fraction of the gap). */
  lateGrowthBonus: 0.05,
  /** Old-player decline: expected points = rate × amount, amount by years past peak. */
  declineRateBase: 0.22,
  declineRatePerYear: 0.05,
  declineRateLo: 0.22,
  declineRateHi: 0.70,
  /** Star preservation (the old `elite` term, kept so the top of the scale holds). */
  starFactor: 0.65,
  starLine: 90,
  goodFactor: 0.85,
  goodLine: 82,
  /** Bust risk scale (was 0.12 in progress.ts); a real motor avoids most of it. */
  bustScale: 0.16,
  bustGoodCut: 0.60,
  /** Retirement probability by position (× the old 0.4). */
  retirePos: {
    QB: 0.60, RB: 1.50, WR: 1.10, TE: 1.00,
    OT: 0.60, OG: 0.60, C: 0.60,
    DE: 1.00, DT: 1.00, LB: 1.00, CB: 1.40, S: 1.00,
    K: 0.60, P: 0.60,
  } as Record<Position, number>,
} as const

/** A player's own place on his position's curve, computed once per season. */
export interface AgingProfile {
  /** The player's position (the curve he is on). */
  pos: Position
  /** Position peak age (years). */
  peak: number
  /** Trait + stable-variance shift in years (+ = later peak). */
  offset: number
  /** Effective age on the curve (real age + offset). */
  eff: number
  /** Work ethic, 0..1 (0.5 when unknown). */
  work: number
  /** Injury load, 0..1 (share of the last three seasons' games missed). */
  injury: number
  /** 0/1 flags for the probe and the UI copy. */
  late: boolean
  early: boolean
  /** Multiplier on the old decline expectation. */
  declineScale: number
}

/** Injury load: share of games missed across his last three NFL seasons (0..1). */
export function injuryLoad(p: Player): number {
  const lines = (p.stats ?? []).filter((s) => s.level === 'NFL').slice(-3)
  let missed = 0
  let possible = 0
  let established = false
  for (const l of lines) {
    const games = Math.max(0, Math.min(17, l.games ?? 0))
    // A season he barely played may be a role decision, not an injury — count it
    // at half weight. A real starting season (10+ games) counts in full.
    const w = games >= 10 ? 1 : games > 0 ? 0.5 : 0
    if (games >= 10) established = true
    missed += (17 - games) * w
    possible += 17 * w
  }
  let load = possible ? missed / possible : 0
  if (!established) load = Math.min(load, 0.3)
  // An injury he is carrying right now counts too (a soft-tissue history is the
  // best predictor we have inside one save).
  if (p.injured) load = Math.min(1, load + 0.35)
  return clamp(load, 0, 1)
}

/** Stable 0..1 draw from the player id (no rng()); the career-shape variance. */
function variantRoll(p: Player): number {
  return (hash32(p.id, 7701) % 1000) / 1000
}

/**
 * A player's own spot on his position's aging curve. Pure and deterministic —
 * reads only his position, age, hidden character and season history.
 */
export function agingProfile(p: Player): AgingProfile {
  const peak = R2AGING.peak[p.pos] ?? 26
  const work100 = p.character?.workEthic ?? 50
  const work = clamp(work100 / 100, 0, 1)
  const injury = injuryLoad(p)
  const v = variantRoll(p)
  const late = v < R2AGING.lateShare
  const early = v > 1 - R2AGING.earlyShare
  const offset =
    (work - 0.5) * 2 * R2AGING.workPeakYears -
    injury * R2AGING.injuryPeakYears +
    (late ? R2AGING.variantYears : 0) -
    (early ? R2AGING.variantYears : 0)
  return {
    pos: p.pos,
    peak,
    offset,
    // Offset moves the whole curve in time: +years = his peak comes later, so
    // he is "younger" on the curve than his age.
    eff: p.age - offset,
    work,
    injury,
    late,
    early,
    declineScale: clamp(
      1 - (work - 0.5) * 2 * R2AGING.workDecline + injury * R2AGING.injuryDecline,
      0.65,
      1.5,
    ),
  }
}

/**
 * Growth fraction for a young player (≤26), replacing the old age-band
 * constants. `r` is the SAME `rng()` draw the old formula used, so the stream
 * is unchanged; a late bloomer gets a little extra at 25-26.
 */
export function agingGrowth(a: AgingProfile, band: 24 | 26, experience: number, r: number): number {
  const tempo = R2AGING.growth[a.pos] ?? 1
  if (band === 24) {
    // Old: 0.22 + 0.42 × experience + r × 0.18
    return (0.22 + 0.42 * experience + r * 0.18) * tempo
  }
  // Old: 0.15 + 0.28 × experience + r × 0.12. A position whose peak is still
  // ahead of him (QB/OL/K) keeps developing here; a back has already arrived.
  const ahead = clamp((a.peak - a.eff) / 3, -1, 1)
  const late = a.late ? R2AGING.lateGrowthBonus : 0
  return clamp((0.15 + 0.28 * experience + r * 0.12) * tempo * (1 + ahead * 0.35) + late, 0.02, 0.85)
}

/**
 * Ages 27-29 (the old +1 / −1 coin-flip plateau). `r1`/`r2` are the same two
 * draws the old line consumed; the rates come from this player's distance from
 * his own peak, so a 28-year-old QB is still climbing and a 28-year-old RB is not.
 */
export function agingVetDelta(a: AgingProfile, r1: number, r2: number): number {
  const past = a.eff - a.peak
  const up = clamp(0.45 - past * 0.12, 0.10, 0.70)
  const down = clamp(0.20 + past * 0.10, 0.05, 0.55) * a.declineScale
  return (r1 < up ? 1 : 0) - (r2 < down ? 1 : 0)
}

/**
 * Ages 30+ (the old single decline draw). The draw is the SAME one the old line
 * consumed; it now stochastically rounds the position's expected decline, so a
 * star QB loses ~0.5/year while a 33-year-old back loses 2+.
 */
export function agingDecline(a: AgingProfile, ovr: number, r: number): number {
  const past = a.eff - a.peak
  const base = R2AGING.decline[a.pos] ?? 1
  const rate = clamp(R2AGING.declineRateBase + past * R2AGING.declineRatePerYear, R2AGING.declineRateLo, R2AGING.declineRateHi)
  const amount = past >= 3 ? 2 : 1
  const star = ovr >= R2AGING.starLine ? R2AGING.starFactor : ovr >= R2AGING.goodLine ? R2AGING.goodFactor : 1
  const expected = clamp(rate * amount * base * a.declineScale * star, 0, 3)
  return Math.floor(expected + r)
}

/** Position/trait-aware retirement chance, used where the old code rolled < 0.4. */
export function agingRetireChance(a: AgingProfile, base = 0.4): number {
  const pos = R2AGING.retirePos[a.pos] ?? 1
  const work = clamp(1.15 - (a.work - 0.5) * 0.3 + a.injury * 0.2, 0.7, 1.3)
  return clamp(base * pos * work, 0.08, 0.92)
}

/** Bust-risk scale for a generated player (the old constant was 0.12). */
export function agingBustScale(a: AgingProfile): number {
  return R2AGING.bustScale * (a.work > R2AGING.bustGoodCut ? R2AGING.bustGoodCut : 1)
}

/** Dev-only toggle (the `setJ13` pattern): flip between the old and new curves. */
export function setR2Aging(on: boolean) {
  ;(R2AGING as { on: boolean }).on = on
}

/**
 * Measured NFL reference (analysis/aging_nfl.py; n in the verify file):
 * retention of a player's own peak value by years from his peak season.
 * Kept here so the engine constants stay auditable against the data.
 */
export const R2AGING_NFL = {
  QB: { peak: 27.6, ret: { '-1': 0.88, 1: 0.87, 2: 0.72, 3: 0.60 } },
  RB: { peak: 25.3, ret: { '-1': 0.84, 1: 0.84, 2: 0.69, 3: 0.54 } },
  WR: { peak: 25.6, ret: { '-1': 0.88, 1: 0.86, 2: 0.74, 3: 0.59 } },
  TE: { peak: 26.0, ret: { '-1': 0.87, 1: 0.85, 2: 0.71, 3: 0.58 } },
  OT: { peak: 26.9, ret: { '-1': 0.86, 1: 0.90, 2: 0.77, 3: 0.62 } },
  OG: { peak: 26.7, ret: { '-1': 0.92, 1: 0.86, 2: 0.73, 3: 0.59 } },
  C: { peak: 27.1, ret: { '-1': 0.86, 1: 0.86, 2: 0.80, 3: 0.54 } },
  DE: { peak: 26.1, ret: { '-1': 0.89, 1: 0.89, 2: 0.78, 3: 0.67 } },
  DT: { peak: 26.1, ret: { '-1': 0.89, 1: 0.89, 2: 0.78, 3: 0.65 } },
  LB: { peak: 25.7, ret: { '-1': 0.90, 1: 0.89, 2: 0.77, 3: 0.66 } },
  CB: { peak: 25.5, ret: { '-1': 0.88, 1: 0.89, 2: 0.75, 3: 0.64 } },
  S: { peak: 26.1, ret: { '-1': 0.87, 1: 0.89, 2: 0.77, 3: 0.65 } },
  K: { peak: 28.5, ret: { '-1': 0.87, 1: 0.87, 2: 0.75, 3: 0.61 } },
  P: { peak: 28.5, ret: { '-1': 0.87, 1: 0.87, 2: 0.75, 3: 0.61 } },
} as const

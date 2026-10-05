// ─────────────────────────────────────────────────────────────────────────────
// Grade your scouts (G1).
//
// Every evaluator files a biased report (scoutBias.ts). You set a trust level
// on each one — Fade ×0.5, Normal ×1, Lean on ×2 — and the trust-weighted mean
// of their reports becomes your department grade. Your club drafts from that
// board. Calibrating trust well means your club drafts closer to the truth.
//
// This module must NOT import draft.ts (draft.ts imports it): that would cycle.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, DraftProspect } from '../types'
import type { World } from './generate'
import { capabilities } from './capabilities'
import { isEvaluator, scoutReport } from './scoutBias'

export const TRUST_WEIGHT = { fade: 0.5, normal: 1, lean: 2 } as const
export type TrustLevel = keyof typeof TRUST_WEIGHT

/** Can this rung set trust on its evaluators? */
export function canSetTrust(career: CareerState): boolean {
  const caps = capabilities(career).can
  return caps.has('assignScouts') || caps.has('hireStaff')
}

/** Trust-weighted mean of the club's evaluator reports, or null if none. */
function weightedGrade(
  world: World,
  teamId: string,
  p: DraftProspect,
  trust: Record<string, TrustLevel> | undefined,
): number | null {
  const evaluators = (world.staff[teamId] ?? []).filter(isEvaluator)
  if (!evaluators.length) return null
  let sum = 0
  let weight = 0
  for (const m of evaluators) {
    const w = TRUST_WEIGHT[trust?.[m.id] ?? 'normal']
    sum += scoutReport(m, p) * w
    weight += w
  }
  return Math.round(sum / weight)
}

/** The department's grade on a prospect, given your trust settings. */
export function departmentGrade(world: World, career: CareerState, p: DraftProspect): number | null {
  return weightedGrade(world, career.teamId, p, career.scoutTrust)
}

/**
 * How much your trust settings beat the all-normal default, over the first 40
 * prospects: mean |grade − truth| default minus the same tuned. Positive =
 * your read sharpened the board. Rounded to 1 decimal.
 */
export function calibrationGain(world: World, career: CareerState): number {
  const sample = world.draft.slice(0, 40)
  if (!sample.length) return 0
  let baselineSum = 0
  let tunedSum = 0
  for (const p of sample) {
    const base = weightedGrade(world, career.teamId, p, undefined)
    const tuned = weightedGrade(world, career.teamId, p, career.scoutTrust)
    if (base == null || tuned == null) return 0
    baselineSum += Math.abs(base - p.trueGrade)
    tunedSum += Math.abs(tuned - p.trueGrade)
  }
  const gain = baselineSum / sample.length - tunedSum / sample.length
  return +gain.toFixed(1)
}

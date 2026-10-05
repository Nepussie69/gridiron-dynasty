// ─────────────────────────────────────────────────────────────────────────────
// Information quality.
//
// You never see raw Madden numbers on a prospect. You see what YOUR evaluation
// produces — a fuzzy range whose width shrinks with your rung, your Evaluation
// skill, and how much you've scouted him. A local scout sees a wide range and
// only his region; a director sees a tight, staff-wide read.
//
// The underlying trueGrade never changes; only your confidence in it does.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, DraftProspect } from '../types'
import { clamp, hash32 } from './rng'
import { traitRangeFactor } from './earnedTraits'

export const REGIONS = ['Northeast', 'Southeast', 'Midwest', 'West'] as const
export type Region = (typeof REGIONS)[number]

/** Deterministic (fake but stable) region for a prospect's school. */
export function regionOfCollege(college: string): Region {
  return REGIONS[hash32(college, 17) % REGIONS.length]
}

/** A prospect's region, derived from the school he played for. */
export function prospectRegion(p: DraftProspect): Region {
  if (p.college) return regionOfCollege(p.college)
  return REGIONS[hash32(p.id, 17) % REGIONS.length]
}

/** The region a scout is assigned to, derived from his club. */
export function scoutRegion(career: CareerState): Region {
  if (career.scoutRegion && (REGIONS as readonly string[]).includes(career.scoutRegion)) {
    return career.scoutRegion as Region
  }
  return REGIONS[hash32(career.teamId, 23) % REGIONS.length]
}

/** Scope: low rungs only see their own region; regional rungs and up see all. */
export function inProspectScope(career: CareerState, p: DraftProspect): boolean {
  if (career.level >= 2) return true
  return prospectRegion(p) === scoutRegion(career)
}

export interface ProspectRead {
  visible: boolean
  region: Region
  /** Fuzzy grade range [lo, hi]. */
  range: [number, number]
  center: number
  confidence: number
  /** Public consensus grade — only if you're senior enough to see it. */
  consensus: number | null
  /** The truth — only when you've earned it (director, or near-total confidence). */
  truth: number | null
  /** A round band label, e.g. "Round 2". */
  bandLabel: string
  /** Staff disagreement note (directors only). */
  disagreement: string | null
}

function roundBand(grade: number): number {
  if (grade >= 86) return 1
  if (grade >= 80) return 2
  if (grade >= 75) return 3
  if (grade >= 71) return 4
  if (grade >= 68) return 5
  if (grade >= 65) return 6
  return 7
}

export function bandLabel(grade: number): string {
  const r = roundBand(grade)
  return r === 1 ? 'Round 1' : `Rounds ${r}`
}

/** Read a prospect through the fog of your current job. */
export function readProspect(career: CareerState, p: DraftProspect): ProspectRead {
  const level = career.level
  const visible = inProspectScope(career, p)
  const skill = career.skills.evaluation

  // Base uncertainty by rung (a local scout's read is wide; a director's is tight).
  const base = level <= 0 ? 9 : level === 1 ? 7 : level === 2 ? 5.5 : level === 3 ? 4 : level === 4 ? 3 : 2
  // Scouting the prospect and having a good eye both tighten the range.
  const confFactor = 1 - Math.min(1, p.confidence / 100) * 0.6
  const skillFactor = 1 - Math.min(1, skill / 99) * 0.4
  const width = Math.max(1, base * confFactor * skillFactor * traitRangeFactor(career, p.myGrade ?? p.grade))

  const center = Math.round(p.myGrade ?? p.grade)
  const lo = clamp(Math.round(center - width), 40, 99)
  const hi = clamp(Math.round(center + width), 40, 99)

  const isDirector = level >= 4
  const truth = isDirector || p.confidence >= 92 ? p.trueGrade : null
  const consensus = level >= 3 || p.confidence >= 70 ? p.grade : null

  let disagreement: string | null = null
  if (isDirector && p.myGrade != null && Math.abs(p.myGrade - p.grade) >= 6) {
    disagreement = p.myGrade > p.grade ? 'Staff has him higher than consensus.' : 'Staff has him lower than consensus.'
  }

  return {
    visible,
    region: prospectRegion(p),
    range: [lo, hi],
    center,
    confidence: Math.round(p.confidence),
    consensus,
    truth,
    bandLabel: bandLabel(center),
    disagreement,
  }
}

/** A short, human-readable range, e.g. "72–81" or "81–89 (Rd 1–2)". */
export function rangeText(read: ProspectRead): string {
  const [lo, hi] = read.range
  return lo === hi ? `${lo}` : `${lo}–${hi}`
}

/** Color a read by its midpoint, for badges/bars. */
export function readColor(read: ProspectRead): number {
  return read.center
}

// ─────────────────────────────────────────────────────────────────────────────
// Coaching influence.
//
// Coordinator quality and the user's own coaching skills change what happens on
// the field: play-calling edge, player development, discipline, and situational
// decision quality. A 95-rated coordinator is a real advantage; a 55-rated one
// costs you games.
// ─────────────────────────────────────────────────────────────────────────────

import type { StaffMember } from '../types'
import type { World } from './generate'
import { cohesionDiscipline, cohesionSituational, teamCohesion } from './playbook'

export interface CoachEffect {
  /** Offensive play-calling / execution bonus, roughly −6..+6. */
  offEdge: number
  /** Defensive play-calling / execution bonus, roughly −6..+6. */
  defEdge: number
  /** How much better players develop in this program (multiplier ~0.85..1.25). */
  development: number
  /** Penalty / discipline modifier (multiplier ~0.7..1.3). */
  discipline: number
  /** 4th-down / clock decision quality, −3..+3. */
  situational: number
  /** Head coach overall quality, used for win-probability nudges. */
  headCoach: number
  /** 0-1 team cohesion (staff continuity × unit continuity). */
  cohesion: number
}

function rating(world: World, teamId: string, role: string): number | null {
  const s = (world.staff[teamId] ?? []).find((m) => m.role === role)
  return s ? s.rating : null
}

function unitRating(world: World, teamId: string, roles: string[]): number | null {
  const vals = roles
    .map((r) => (world.staff[teamId] ?? []).find((m) => m.role === r)?.rating)
    .filter((v): v is number => typeof v === 'number')
  if (!vals.length) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

/** League-average staff rating, so effects are measured relative to the norm. */
const BASELINE = 74

/**
 * The user's own coaching skill folds in when they hold a coaching role on that
 * side of the ball — your scheme skill literally improves your unit.
 */
export interface UserCoachingBonus {
  off: number // added to offEdge
  def: number // added to defEdge
  development: number // extra development multiplier
  situational: number
}

export const NO_USER_BONUS: UserCoachingBonus = { off: 0, def: 0, development: 1, situational: 0 }

export function coachEffect(world: World, teamId: string, user: UserCoachingBonus = NO_USER_BONUS): CoachEffect {
  const oc = rating(world, teamId, 'Offensive Coordinator')
  const dc = rating(world, teamId, 'Defensive Coordinator')
  const hc = rating(world, teamId, 'Head Coach')
  const positionCoaches = unitRating(world, teamId, ['QB Coach', 'OL Coach', 'DL Coach', 'Secondary Coach']) ?? BASELINE
  const st = rating(world, teamId, 'Special Teams Coordinator')

  // Continuity is culture: a settled roster + staff commits fewer penalties and
  // executes better in the clutch. Churn does the opposite.
  const coh = teamCohesion(world.roster[teamId] ?? [], world.staffTenure, teamId)
  const cohesionFactor = coh.avg

  // Convert a rating (say 55..96) into a small edge relative to baseline.
  const edge = (r: number | null) => {
    if (r == null) return 0
    return Math.max(-4.5, Math.min(4.5, (r - BASELINE) * 0.2))
  }

  const development = 1 + ((positionCoaches - BASELINE) / 100) * 0.6 + (user.development - 1)
  const discipline =
    (1 - ((72 - (hc ?? BASELINE)) / 220) + (positionCoaches - BASELINE) / 400) *
    cohesionDiscipline(cohesionFactor)
  const situational =
    ((hc ?? BASELINE) - BASELINE) * 0.12 +
    ((st ?? BASELINE) - BASELINE) * 0.04 +
    user.situational +
    cohesionSituational(cohesionFactor) * 2

  return {
    offEdge: edge(oc) + user.off,
    defEdge: edge(dc) + user.def,
    development: Math.max(0.8, Math.min(1.35, development)),
    discipline: Math.max(0.7, Math.min(1.3, discipline)),
    situational: Math.max(-3, Math.min(3, situational)),
    headCoach: hc ?? positionCoaches,
    cohesion: cohesionFactor,
  }
}

/** Convenience: build a user bonus from the career's coaching skills + role. */
export function userBonusFromSkills(
  skills: { scheme: number; leadership: number } | undefined,
  holdsRole: boolean,
  focus: 'off' | 'def' | 'both' = 'both',
): UserCoachingBonus {
  if (!holdsRole || !skills) return NO_USER_BONUS
  const schemeEdge = ((skills.scheme - 40) / 60) * 3 // ~ −2..+3
  const leadEdge = ((skills.leadership - 40) / 60) * 1.5
  return {
    off: focus === 'def' ? leadEdge * 0.4 : schemeEdge + leadEdge * 0.3,
    def: focus === 'off' ? leadEdge * 0.4 : schemeEdge + leadEdge * 0.3,
    development: 1 + leadEdge / 40,
    situational: leadEdge * 0.4,
  }
}

/** Short label for the UI. */
export function staffGrade(e: CoachEffect): 'Elite' | 'Strong' | 'Average' | 'Poor' {
  const v = (e.offEdge + e.defEdge) / 2
  if (v >= 2.2) return 'Elite'
  if (v >= 0.8) return 'Strong'
  if (v >= -0.8) return 'Average'
  return 'Poor'
}

export type { StaffMember }

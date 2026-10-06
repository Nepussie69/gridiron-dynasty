// ─────────────────────────────────────────────────────────────────────────────
// Install plan (K2).
//
// In the offseason a coordinator or head coach chooses how much of the system to
// put in before the season. A Lean install gets the club off to a fast start but
// flattens out; a Full install starts slowly and pays off late. The bonus is
// folded into the user's coaching edge in the store, so AI clubs are never
// affected and league calibration can't move.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState } from '../types'
import type { World } from './generate'
import { capabilities, isHeadCoach } from './capabilities'

export type InstallPlan = 'lean' | 'full'

export interface InstallOption {
  id: InstallPlan
  label: string
  blurb: string
}

export const INSTALL_OPTIONS: InstallOption[] = [
  {
    id: 'lean',
    label: 'Lean install',
    blurb: 'Fast start. Weeks 1–8 run hot (+0.6); the edge fades after that.',
  },
  {
    id: 'full',
    label: 'Full install',
    blurb: 'Slow build. Early weeks pay a price (−0.4), then it climbs to +0.8.',
  },
]

/** Can this rung choose an install right now — offseason, and not already set for next season? */
export function canInstall(world: World, career: CareerState): boolean {
  if (!capabilities(career).can.has('installScheme')) return false
  if (world.phase !== 'offseason') return false
  // The plan is locked once chosen for the coming season.
  if (career.install?.season === world.season + 1) return false
  return true
}

/** The install's edge in a given week. */
export function installEdge(plan: InstallPlan, week: number): number {
  if (plan === 'lean') return week <= 8 ? 0.6 : 0
  // Full: a slow build that finishes strongest.
  if (week <= 4) return -0.4
  if (week <= 8) return 0.2
  return 0.8
}

/**
 * Which sides this role installs for. A coordinator installs for his `unitFocus`
 * side; a head coach (or a `'both'` unit focus) installs both.
 */
export function installSides(career: CareerState): ('off' | 'def')[] {
  if (career.unitFocus === 'both' || isHeadCoach(career)) return ['off', 'def']
  return [career.unitFocus === 'def' ? 'def' : 'off']
}

/** This season's install bonus per side, applied only when the plan is for `world.season`. */
export function installBonus(career: CareerState, world: World): { off: number; def: number } {
  const install = career.install
  if (!install || install.season !== world.season) return { off: 0, def: 0 }
  const edge = installEdge(install.plan, world.week)
  const sides = installSides(career)
  return {
    off: sides.includes('off') ? edge : 0,
    def: sides.includes('def') ? edge : 0,
  }
}

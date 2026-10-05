// Start scenarios (F3): opt-in starting situations.
//
// A scenario changes the STARTING STATE only — who you are, where you start on
// the ladder, and how healthy the club is on day one. It never changes the rules,
// the gates, the balance or the AI. Standard Climb is the default.

import type { CareerPath, CareerState, ScenarioId } from '../types'
import type { World } from './generate'
import { capForSeason } from './cap'

export interface Scenario {
  id: ScenarioId
  /** Card title, e.g. "Cap Hell". */
  title: string
  /** One-line pitch shown on the hub card. */
  desc: string
  /** Overrides the chosen path, or null to let the player choose. */
  path: CareerPath | null
  /** Overrides the starting ladder level, or null to let the player choose. */
  level: number | null
  /** Force the league's lowest-prestige club (The Long Rebuild). */
  forceLowestPrestige?: boolean
  /** Starting job security, or null to keep the default. */
  jobSecurity: number | null
  /** Owner mandate text, or null to keep the club's own. */
  expectation: string | null
  /** Fraction of the season cap added as dead money at the start. */
  deadMoneyPct: number
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'climb',
    title: 'Standard Climb',
    desc: 'Start at the bottom and earn everything. The intended way to play.',
    path: null,
    level: null,
    jobSecurity: null,
    expectation: null,
    deadMoneyPct: 0,
  },
  {
    id: 'hotSeat',
    title: 'Hot Seat',
    desc: "Take over a win-now room with the owner's patience already gone.",
    path: 'coach',
    level: 7,
    jobSecurity: 38,
    expectation: 'Playoffs this year — or we make a change.',
    deadMoneyPct: 0,
  },
  {
    id: 'capHell',
    title: 'Cap Hell',
    desc: 'A veteran roster buried under contracts you never signed.',
    path: 'personnel',
    level: 8,
    jobSecurity: 55,
    expectation: 'Get us healthy without bottoming out.',
    deadMoneyPct: 0.12,
  },
  {
    id: 'rebuild',
    title: 'The Long Rebuild',
    desc: "Take the league's weakest club and build it through the draft.",
    path: 'personnel',
    level: 8,
    forceLowestPrestige: true,
    jobSecurity: 85,
    expectation: 'Three-year plan. Build it through the draft.',
    deadMoneyPct: 0,
  },
]

/** Look up a scenario by id. Unknown/absent ids fall back to Standard Climb. */
export function scenarioById(id: ScenarioId | undefined): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]
}

/**
 * Apply a scenario's starting state. It sets ONLY jobSecurity, ownerExpectation
 * and scenario, plus the scenario's dead money on the world. Rules, gates,
 * balance and AI are untouched. Returns the updated career.
 */
export function applyScenario(world: World, career: CareerState, s: Scenario): CareerState {
  const next: CareerState = { ...career, scenario: s.id }
  if (s.jobSecurity !== null) next.jobSecurity = s.jobSecurity
  if (s.expectation !== null) next.ownerExpectation = s.expectation
  if (s.deadMoneyPct > 0) {
    const add = Math.round(capForSeason(world.season) * s.deadMoneyPct)
    world.deadMoney[career.teamId] = (world.deadMoney[career.teamId] ?? 0) + add
  }
  return next
}

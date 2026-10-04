// ─────────────────────────────────────────────────────────────────────────────
// Role capabilities.
//
// One table that says what each career rung can actually DO. Replaces the
// scattered canDraft / canSignFreeAgents checks with a single source of truth,
// so every rung is a distinct job rather than a title change.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, LeagueTier } from '../types'

export type Capability =
  // Personnel / scouting
  | 'grade'          // file a prospect grade
  | 'rankBoard'      // stack your own board vs consensus
  | 'crossCheck'     // agree/overrule another scout's report
  | 'assignScouts'   // direct the scouting staff
  | 'setBoard'       // own the final draft board
  | 'proScout'       // evaluate pro players / other rosters
  | 'negotiate'      // contracts, extensions
  | 'manageCap'      // cap sheet, restructures, cuts
  | 'draft'          // make draft picks
  | 'signFreeAgents' // FA signings
  // College-specific
  | 'recruit'        // high-school recruiting
  | 'portal'         // transfer portal + retention (re-recruiting your own)
  | 'nilBudget'      // NIL / revenue-share payroll
  // Coaching
  | 'developRoom'    // grow a position group
  | 'callPlays'      // live game plan
  | 'installScheme'  // choose the offensive/defensive system
  | 'hireStaff'      // hire coordinators and assistants
  | 'gameManagement' // clock, 4th down, 2-pt decisions
  | 'setExpectations'// own results / job security

export interface RoleCapabilities {
  can: Set<Capability>
  /** How many prospects this role can see (scope limit). undefined = all. */
  prospectScope?: number
  /** Which side of the game plan the role controls. */
  planScope: 'none' | 'own-side' | 'both'
}

const ALL: Capability[] = [
  'grade', 'rankBoard', 'crossCheck', 'assignScouts', 'setBoard', 'proScout',
  'negotiate', 'manageCap', 'draft', 'signFreeAgents',
  'recruit', 'portal', 'nilBudget',
  'developRoom', 'callPlays', 'installScheme', 'hireStaff', 'gameManagement', 'setExpectations',
]

function set(...caps: Capability[]) {
  return new Set<Capability>(caps)
}

// ── Personnel ladder ─────────────────────────────────────────────────────────
const PERSONNEL_ROLES: Record<number, RoleCapabilities> = {
  0: { can: set('grade'), prospectScope: 12, planScope: 'none' },                              // Local Scout
  1: { can: set('grade', 'crossCheck'), prospectScope: 35, planScope: 'none' },                  // Area Scout
  2: { can: set('grade', 'rankBoard', 'crossCheck'), prospectScope: 90, planScope: 'none' },     // Regional Scout
  3: { can: set('grade', 'rankBoard', 'crossCheck'), planScope: 'none' },                        // National Scout
  4: { can: set('grade', 'rankBoard', 'crossCheck', 'assignScouts'), planScope: 'none' },        // Asst Dir College Scouting
  5: { can: set('grade', 'rankBoard', 'crossCheck', 'assignScouts', 'setBoard', 'draft'), planScope: 'none' }, // Dir College Scouting
  6: { can: set('proScout', 'negotiate', 'signFreeAgents', 'draft', 'setBoard'), planScope: 'none' },          // Dir Player Personnel
  7: { can: set('proScout', 'negotiate', 'manageCap', 'signFreeAgents', 'draft', 'hireStaff'), planScope: 'none' }, // Assistant GM
  8: { can: set(...ALL), planScope: 'both' },                                                    // General Manager
}

// ── Coaching ladder ──────────────────────────────────────────────────────────
const COACH_ROLES: Record<number, RoleCapabilities> = {
  0: { can: set('developRoom'), planScope: 'none' },                                                        // Graduate Assistant
  1: { can: set('developRoom'), planScope: 'none' },                                                        // Position Coach
  2: { can: set('developRoom', 'callPlays', 'installScheme', 'gameManagement'), planScope: 'own-side' },     // Coordinator
  3: { can: set('developRoom', 'callPlays', 'installScheme', 'gameManagement', 'hireStaff', 'recruit', 'portal', 'nilBudget', 'setExpectations'), planScope: 'both' }, // G5 HC
  4: { can: set('developRoom', 'callPlays', 'installScheme', 'gameManagement', 'hireStaff', 'recruit', 'portal', 'nilBudget', 'setExpectations'), planScope: 'both' }, // P4 HC
  5: { can: set('developRoom'), planScope: 'none' },                                                        // NFL Position Coach / QC
  6: { can: set('developRoom', 'callPlays', 'installScheme', 'gameManagement'), planScope: 'own-side' },     // NFL Coordinator
  7: { can: set(...ALL), planScope: 'both' },                                                               // NFL Head Coach
}

/** What can this career actually do right now? */
export function capabilities(career: CareerState): RoleCapabilities {
  const table = career.path === 'coach' ? COACH_ROLES : PERSONNEL_ROLES
  const role = table[career.level]
  if (role) return role
  // Fallback: most senior role in the track.
  const max = Math.max(...Object.keys(table).map(Number))
  return table[max]
}

export function can(career: CareerState, cap: Capability): boolean {
  return capabilities(career).can.has(cap)
}

// ── Legacy helpers, now driven by the table ──────────────────────────────────
export function canDraft(career: CareerState) {
  return can(career, 'draft')
}
export function canSignFreeAgents(career: CareerState) {
  return can(career, 'signFreeAgents')
}
export function isGM(career: CareerState) {
  return career.path === 'personnel' && career.level >= 8
}
export function isHeadCoach(career: CareerState) {
  return career.path === 'coach' && (career.level >= 3 || career.level >= 7)
}
export function canRecruit(career: CareerState) {
  return can(career, 'recruit') && career.tier !== 'NFL'
}
export function canCallPlays(career: CareerState) {
  return can(career, 'callPlays')
}

// ── Cross-over: college HC → NFL position coach / coordinator ────────────────
// Your rule: a college head coach does NOT walk into an NFL HC job. He crosses
// into an NFL position-coach or coordinator role and must earn the top job.
export function crossOverLevel(path: CareerState['path'], level: number, from: LeagueTier, to: LeagueTier) {
  // Only coaching crossovers are constrained; personnel crossing keeps its rung.
  if (path !== 'coach') return level
  if (from === 'FBS' && to === 'NFL') {
    // College HC (3 or 4) lands as NFL Position Coach (5) at most; P4 HC may
    // land straight into an NFL Coordinator (6) role.
    if (level >= 4) return 6
    if (level === 3) return 5
    if (level === 2) return 5 // college coordinator → NFL position coach
    return level
  }
  if (from === 'NFL' && to === 'FBS') {
    // NFL coordinator → college HC is realistic; NFL position coach → college coordinator.
    if (level >= 6) return 4
    if (level === 5) return 2
    return level
  }
  return level
}

export { ALL as ALL_CAPABILITIES }

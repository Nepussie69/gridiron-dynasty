// ─────────────────────────────────────────────────────────────────────────────
// Bye week (FUTURES 17).
//
// Once a season the user's club has no game: a real choice instead of a dead
// week. Rest the roster (heal + shed fatigue now), run an Install week (extra
// playbook mastery and a coaching edge next week), or Self-scout (a sharp read
// on next week's opponent plus a prep edge). The payoff lands the following
// week, so the choice only ever touches the user's club — AI clubs never get
// it and league calibration can't move. Doing nothing is neutral.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState } from '../types'
import type { World } from './generate'
import { capabilities } from './capabilities'
import { installSides } from './install'

export type ByePlan = 'rest' | 'install' | 'scout'

export interface ByeOption {
  id: ByePlan
  label: string
  blurb: string
}

export const BYE_OPTIONS: ByeOption[] = [
  {
    id: 'rest',
    label: 'Rest the roster',
    blurb: 'A light week. Dinged players can shed an extra game and the whole club sheds 10 fatigue.',
  },
  {
    id: 'install',
    label: 'Install week',
    blurb: 'Extra reps. +0.5 coaching edge and playbook mastery ×1.25 in next week’s game.',
  },
  {
    id: 'scout',
    label: 'Self-scout',
    blurb: 'Break down your own tape and next week’s opponent. +0.4 edge both sides and a sharp read on them.',
  },
]

const EDGE_INSTALL = 0.5
const EDGE_SCOUT = 0.4
const MASTERY_INSTALL = 1.25

/** Can this rung make a bye-week call — i.e. influence the weekly plan? */
export function canByeWeek(career: CareerState): boolean {
  return capabilities(career).can.has('callPlays')
}

/** Is the user's club on its bye this week (regular season, no game scheduled)? */
export function isByeWeek(world: World, teamId: string): boolean {
  if (world.phase !== 'regular') return false
  return !world.schedule.some((g) => g.week === world.week && (g.homeId === teamId || g.awayId === teamId))
}

/** The bye plan chosen for `week`, or null if none / not this rung / not this season. */
export function byePlanForWeek(career: CareerState, season: number, week: number): ByePlan | null {
  if (!canByeWeek(career)) return null
  const b = career.bye
  if (!b || b.season !== season || b.week !== week) return null
  return b.plan
}

/** The bye plan chosen for the current week, or null. */
export function byePlan(career: CareerState, world: World): ByePlan | null {
  return byePlanForWeek(career, world.season, world.week)
}

/** The bye plan chosen last week (this week's payoff), or null. */
export function byeLastWeek(career: CareerState, world: World): ByePlan | null {
  return byePlanForWeek(career, world.season, world.week - 1)
}

/**
 * This week's payoff edge per side from last week's bye plan. Rest pays off in
 * recovery (see `byeIsRest`); Install and Self-scout pay off in the game plan.
 */
export function byeEdge(career: CareerState, world: World): { off: number; def: number } {
  const plan = byeLastWeek(career, world)
  if (plan === 'install') {
    const sides = installSides(career)
    return {
      off: sides.includes('off') ? EDGE_INSTALL : 0,
      def: sides.includes('def') ? EDGE_INSTALL : 0,
    }
  }
  if (plan === 'scout') return { off: EDGE_SCOUT, def: EDGE_SCOUT }
  return { off: 0, def: 0 }
}

/** Rest bye: the user's club heals and sheds fatigue during the bye week. */
export function byeIsRest(career: CareerState, world: World): boolean {
  return byePlan(career, world) === 'rest'
}

/** Install bye: next week's game earns extra playbook mastery. */
export function byeMasteryMult(career: CareerState, world: World): number {
  return byeLastWeek(career, world) === 'install' ? MASTERY_INSTALL : 1
}

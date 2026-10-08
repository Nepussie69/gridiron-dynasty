// ─────────────────────────────────────────────────────────────────────────────
// Practice week (L12 W1).
//
// Each in-season week a coordinator or head coach picks one practice plan. The
// plan is kept week to week until changed. A Sharpen week adds execution edge
// but raises the club's injury odds; an Install week costs a little now and
// pays off next week; a Rest week heals and protects the roster at a small
// execution cost. The edge is folded into the user's coaching bonus in the
// store (inside the same clamp as wrinkle + install), so AI clubs never get it
// and league calibration can't move.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState } from '../types'
import type { World } from './generate'
import { capabilities } from './capabilities'
import { installSides } from './install'

export type PracticePlan = 'balanced' | 'sharpen' | 'install' | 'rest'

export interface PracticeOption {
  id: PracticePlan
  label: string
  /** This week's coaching edge, per side. */
  edge: number
  /** Everything else the week does. */
  blurb: string
}

export const PRACTICE_OPTIONS: PracticeOption[] = [
  { id: 'balanced', label: 'Balanced', edge: 0, blurb: 'A normal week. No edge, no cost.' },
  { id: 'sharpen', label: 'Sharpen', edge: 0.4, blurb: 'Execution work. Your club’s weekly injury chance ×1.5.' },
  { id: 'install', label: 'Install', edge: -0.1, blurb: 'New concepts. Costs a little now, +0.3 next week. Playbook mastery gain ×1.25 this week.' },
  { id: 'rest', label: 'Rest', edge: -0.2, blurb: 'Light week. Injury chance ×0.6; dinged players heal an extra game 25% of the time; fatigue −10.' },
]

const EDGE: Record<PracticePlan, number> = { balanced: 0, sharpen: 0.4, install: -0.1, rest: -0.2 }

/** Can this rung run a practice week — i.e. call plays? */
export function canPractice(career: CareerState): boolean {
  return capabilities(career).can.has('callPlays')
}

/** The practice plan in effect for `world` (kept week to week; default Balanced). */
export function practicePlan(career: CareerState, world: World): PracticePlan {
  if (!canPractice(career)) return 'balanced'
  const p = career.practice
  if (!p || p.season !== world.season) return 'balanced'
  return p.plan
}

/**
 * Did an Install run *last* week, so this week is owed its +0.3 payoff? True if
 * the current plan is Install and has been in place since then, or if the plan
 * was changed this week but the plan it replaced was Install. Recording `prev`
 * at selection time keeps the payoff even if you switch plans — or switch back —
 * the following week.
 */
function installPaidOff(p: NonNullable<CareerState['practice']>, week: number): boolean {
  if (p.plan === 'install' && p.week <= week - 1) return true
  return p.prev?.plan === 'install' && p.prev.week === week - 1
}

/**
 * This week's practice edge per side, for the sides `installSides` gives. A kept
 * Install earns the +0.3 payoff in every week after the one it was set; the first
 * week costs −0.1.
 */
export function practiceEdge(career: CareerState, world: World): { off: number; def: number } {
  const plan = practicePlan(career, world)
  const p = career.practice
  let edge = EDGE[plan]
  if (p && p.season === world.season && installPaidOff(p, world.week)) edge += 0.3
  const sides = installSides(career)
  return {
    off: sides.includes('off') ? edge : 0,
    def: sides.includes('def') ? edge : 0,
  }
}

/** Rest week: dinged players can shed one extra game and the club sheds fatigue. */
export function practiceIsRest(career: CareerState, world: World): boolean {
  return canPractice(career) && practicePlan(career, world) === 'rest'
}

/** Install week: playbook mastery gain ×1.25 for the user's club. */
export function practiceMasteryMult(career: CareerState, world: World): number {
  return canPractice(career) && practicePlan(career, world) === 'install' ? 1.25 : 1
}

/** The weekly minor-injury threshold multiplier for the user's club (1 = normal). */
export function practiceInjuryMult(career: CareerState, world: World): number {
  const plan = practicePlan(career, world)
  if (plan === 'sharpen') return 1.5
  if (plan === 'rest') return 0.6
  return 1
}

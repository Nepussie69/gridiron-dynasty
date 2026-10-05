// ─────────────────────────────────────────────────────────────────────────────
// Screen access levels.
//
// Every rung is a different JOB, not a title. Instead of building new screens,
// this maps what each rung can do on the screens that already exist:
//
//   Locked  → the screen isn't yours yet
//   View    → you can look, not touch
//   Advise  → you make a call; an NPC holds the pen and the game grades you
//   Decide  → the decision is yours
//
// Built on top of the capability table in capabilities.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState } from '../types'
import { capabilities } from './capabilities'

export type AccessLevel = 'locked' | 'view' | 'advise' | 'decide'

export const ACCESS_RANK: Record<AccessLevel, number> = { locked: 0, view: 1, advise: 2, decide: 3 }

export type AccessArea =
  | 'scouting'
  | 'draft'
  | 'cap'
  | 'freeagency'
  | 'trades'
  | 'staff'
  | 'gameplan'
  | 'roster'

export interface AccessMeta {
  label: string
  short: string
  blurb: string
  tone: 'neutral' | 'win' | 'loss' | 'warn' | 'info' | 'gold'
}

export const ACCESS_META: Record<AccessLevel, AccessMeta> = {
  locked: { label: 'Locked', short: '—', blurb: 'Not your job yet. Earn the rung above.', tone: 'neutral' },
  view: { label: 'View Only', short: 'View', blurb: 'You can read the board, but the call belongs to someone above you.', tone: 'info' },
  advise: { label: 'Advisor', short: 'Advise', blurb: 'Make your call — an NPC holds the pen, and the game grades your advice.', tone: 'warn' },
  decide: { label: 'Decision Maker', short: 'Decide', blurb: 'The call is yours.', tone: 'win' },
}

/** What access does this rung have over a given area? */
export function accessFor(career: CareerState, area: AccessArea): AccessLevel {
  const caps = capabilities(career)
  const c = caps.can
  // The NFL head coach has complete control of football operations, but only
  // INFLUENCE over the roster and the cap — the GM holds the pen. The GM, in
  // turn, does not meddle in on-field operations; those read as view/advise.
  const isHeadCoach = career.path === 'coach' && career.level >= 7
  const isGm = career.path === 'personnel' && career.level >= 8
  if (isHeadCoach) {
    switch (area) {
      case 'gameplan':
        return 'decide' // sets the scheme, calls the plays, owns game management
      case 'staff':
        return 'advise' // recommends coaches; the GM signs off
      case 'draft':
      case 'cap':
      case 'freeagency':
      case 'trades':
      case 'roster':
        return 'advise' // shapes the call; the GM makes the final one
      case 'scouting':
        return 'advise'
      default:
        return 'view'
    }
  }
  switch (area) {
    case 'scouting':
      if (c.has('setBoard')) return 'decide'
      if (c.has('grade')) return 'advise'
      return 'view'
    case 'draft':
      if (c.has('draft')) return 'decide'
      if (c.has('rankBoard') || c.has('crossCheck') || c.has('grade')) return 'advise'
      return 'view'
    case 'cap':
      if (c.has('manageCap')) return 'decide'
      if (c.has('proScout') || c.has('negotiate')) return 'view'
      return 'locked'
    case 'freeagency':
      if (c.has('signFreeAgents')) return 'decide'
      if (c.has('proScout')) return 'advise'
      if (c.has('grade')) return 'view'
      return 'locked'
    case 'trades':
      if (c.has('negotiate') || c.has('signFreeAgents')) return 'decide'
      if (c.has('proScout')) return 'view'
      return 'locked'
    case 'staff':
      if (c.has('hireStaff')) return 'decide'
      if (c.has('assignScouts')) return 'advise'
      return 'view'
    case 'gameplan':
      // The GM does not get in the way of football operations.
      if (isGm) return 'view'
      return caps.planScope === 'none' ? 'view' : 'decide'
    case 'roster':
      if (c.has('signFreeAgents') || c.has('setBoard') || c.has('hireStaff')) return 'decide'
      return 'view'
    default:
      return 'view'
  }
}

export function atLeast(level: AccessLevel, min: AccessLevel): boolean {
  return ACCESS_RANK[level] >= ACCESS_RANK[min]
}

export function canDecide(career: CareerState, area: AccessArea): boolean {
  return accessFor(career, area) === 'decide'
}

export function canAdvise(career: CareerState, area: AccessArea): boolean {
  return atLeast(accessFor(career, area), 'advise')
}

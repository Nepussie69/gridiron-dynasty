// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #44 — NFL-like staff ages.
//
// A leaf module (types + rng only) so the world generator can set an age per
// seat without pulling the career engine into the generator's import graph.
// The generator passes the SAME rng draw it always made (0–29), so the draw
// order and the play sim are untouched — only the number changes.
// ─────────────────────────────────────────────────────────────────────────────

import type { StaffRole } from '../types'

/**
 * Assistants sit in their thirties, first-time head coaches land around 45 and
 * nobody starts past his early sixties (retirement is 65–72, see coachCareer).
 */
export function coachAgeFor(role: StaffRole, u: number): number {
  switch (role) {
    case 'Head Coach':
      return 41 + Math.round(u * 0.72) // 41–62
    case 'Offensive Coordinator':
    case 'Defensive Coordinator':
      return 33 + u // 33–62
    case 'Special Teams Coordinator':
      return 36 + u // 36–65
    case 'QB Coach':
    case 'OL Coach':
    case 'DL Coach':
    case 'Secondary Coach':
    case 'WR Coach':
    case 'LB Coach':
      return 29 + u // 29–58
    default:
      return 34 + u // front office: unchanged band
  }
}

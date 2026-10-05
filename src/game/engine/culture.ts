// ─────────────────────────────────────────────────────────────────────────────
// Culture as a real system (#16).
//
// Culture grows from your leaders' character, your staff's leadership, and how
// long the group has stayed together (the cohesion system). It pays out in
// hometown discounts, free agents who want in, and fewer locker-room leaks.
// ─────────────────────────────────────────────────────────────────────────────

import type { World } from './generate'
import { clamp } from './rng'
import { teamCohesion } from './playbook'

export function cultureScore(world: World, teamId: string): number {
  const staff = world.staff[teamId] ?? []
  const leadership = staff.length ? staff.reduce((s, m) => s + m.rating, 0) / staff.length : 60
  const roster = world.roster[teamId] ?? []
  const core = [...roster].sort((a, b) => b.ovr - a.ovr).slice(0, 12)
  const char = core.length
    ? core.reduce((s, p) => {
        const c = p.character
        if (!c) return s + 60
        return s + (c.workEthic * 0.5 + c.maturity * 0.3 + (100 - c.offFieldRisk) * 0.2)
      }, 0) / core.length
    : 60
  const cohesion = teamCohesion(roster, world.staffTenure, teamId).avg * 100
  return Math.round(clamp(leadership * 0.35 + char * 0.4 + cohesion * 0.25, 0, 100))
}

export function cultureLabel(v: number): { label: string; tone: 'loss' | 'warn' | 'info' | 'win' } {
  if (v >= 82) return { label: 'Elite culture', tone: 'win' }
  if (v >= 68) return { label: 'Strong culture', tone: 'win' }
  if (v >= 52) return { label: 'Steady', tone: 'info' }
  if (v >= 38) return { label: 'Shaky', tone: 'warn' }
  return { label: 'Toxic', tone: 'loss' }
}

/** A discount multiplier on cap hits from a strong culture (1.0 = none). */
export function cultureDiscount(culture: number): number {
  return culture >= 78 ? 0.96 : culture >= 66 ? 0.98 : 1
}

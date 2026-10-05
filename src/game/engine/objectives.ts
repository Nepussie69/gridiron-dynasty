// ─────────────────────────────────────────────────────────────────────────────
// Living role objectives (F5): real metrics for the cap-health and player-
// development goals. This file must NOT import career.ts — career.ts imports it.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, Player } from '../types'
import type { World } from './generate'
import { summarizeCap } from './cap'
import { clamp } from './rng'

/** 0–100. Over the cap → ≤45 (fails both targets); tight → 55–95; $8M+ space → 100. */
export function capHealth(world: World, teamId: string): number {
  const c = summarizeCap(world.roster[teamId] ?? [], world.deadMoney[teamId] ?? 0, world.season)
  const m = c.space / 1_000_000
  if (c.overTheCap) return clamp(Math.round(20 + m), 0, 45)
  if (m < 8) return clamp(Math.round(55 + m * 5), 55, 95)
  return 100
}

/** Is this player on the side of the ball the user's role owns? */
function onMySide(p: Player, career: CareerState): boolean {
  if (career.unitFocus === 'off') return p.side === 'OFF'
  if (career.unitFocus === 'def') return p.side === 'DEF'
  return p.side !== 'ST'
}

/** Players on your side of the ball, age ≤ 25, at season start: { id: ovr }. */
export function snapshotDevBaseline(world: World, career: CareerState): Record<string, number> {
  const roster = world.roster[career.teamId] ?? []
  const out: Record<string, number> = {}
  for (const p of roster) {
    if (p.age <= 25 && onMySide(p, career)) out[p.id] = p.ovr
  }
  return out
}

/** How many baseline players are still on your team and gained ≥ 4 OVR since the snapshot. */
export function developedCount(world: World, career: CareerState): number {
  if (!career.devBaseline) return 0
  const roster = world.roster[career.teamId] ?? []
  let n = 0
  for (const [id, base] of Object.entries(career.devBaseline)) {
    const p = roster.find((x) => x.id === id)
    if (p && p.ovr - base >= 4) n++
  }
  return n
}

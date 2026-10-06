// ─────────────────────────────────────────────────────────────────────────────
// Rivalry games (L9 Z5).
//
// The NPCs who started the climb alongside you take real jobs around the
// league. When your club lines up across from one of their clubs, the game
// means more — and the recap remembers it.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, Rival } from '../types'
import type { World } from './generate'

/** The rival who currently works for the given club, if any. */
export function rivalFor(world: World, teamId: string): Rival | undefined {
  return world.rivals.find((r) => r.teamId === teamId)
}

/** Is a regular-season game between the user's club and a rival's club? */
export function isRivalryGame(world: World, career: CareerState, oppId: string): boolean {
  if (!career || oppId === career.teamId) return false
  return !!rivalFor(world, oppId)
}

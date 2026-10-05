// ─────────────────────────────────────────────────────────────────────────────
// Your Room (G3).
//
// A coaching rung below Head Coach owns a "room": the young, still-growing
// players on its side of the ball. You pick up to three focus players and a
// plan, and the season's development budget — earned by banking reps in the
// weekly Run drills action — is spent on them at season end. Concentrate throws
// the whole budget at your focus players (up to +3 each); Spread hands out +1
// at a time across the whole room. The old farmable weekly +1 OVR is gone;
// reps are a bounded, once-a-week resource.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, Player } from '../types'
import type { World } from './generate'
import { capabilities } from './capabilities'
import { clamp } from './rng'

/** How many players a room can focus on. */
export const MAX_ROOM_FOCUS = 3
/** Cap on banked reps. */
export const MAX_ROOM_REPS = 17

/** Is this rung a room of its own? Coaching, develops players, below HC. */
export function hasRoom(career: CareerState): boolean {
  return career.path === 'coach' && capabilities(career).can.has('developRoom') && career.level < 7
}

/** The players in your room: young, growing, on your side of the ball, best first. */
export function roomPlayers(world: World, career: CareerState, maxAge = 26): Player[] {
  const roster = world.roster[career.teamId] ?? []
  const mine = (p: Player) => {
    if (career.unitFocus === 'off') return p.side === 'OFF'
    if (career.unitFocus === 'def') return p.side === 'DEF'
    return p.side !== 'ST'
  }
  return roster
    .filter((p) => mine(p) && p.age <= maxAge && p.ovr < p.pot)
    .sort((a, b) => b.pot - b.ovr - (a.pot - a.ovr))
    .slice(0, 10)
}

/** The development budget the banked reps buy, scaled by Leadership. */
export function roomBudget(career: CareerState): number {
  const reps = Math.min(career.room?.reps ?? 0, MAX_ROOM_REPS)
  return Math.round((reps / MAX_ROOM_REPS) * 6 * (0.6 + career.skills.leadership / 250))
}

export interface RoomGain {
  id: string
  name: string
  from: number
  to: number
}

/**
 * Spend the room's budget on the roster and return what actually landed.
 * Concentrate splits the budget across the focus players still in the room
 * (Math.floor, leftover to the first), capping each at +3 and at his potential.
 * Spread hands out budget + 2 points one at a time across the whole room, at
 * most +1 each and never above potential. Mutates player.ovr; pure otherwise.
 */
export function applyRoomDevelopment(
  world: World,
  career: CareerState,
): { gains: RoomGain[] } {
  // Runs right after developPlayers has aged everyone a year, so allow one extra year.
  const players = roomPlayers(world, career, 27)
  const byId = new Map(players.map((p) => [p.id, p]))
  const gains = new Map<string, RoomGain>()

  const apply = (p: Player, amount: number) => {
    const room = Math.max(0, Math.min(amount, p.pot - p.ovr))
    if (room <= 0) return
    const g = gains.get(p.id) ?? { id: p.id, name: p.name, from: p.ovr, to: p.ovr }
    p.ovr = clamp(p.ovr + room, 40, p.pot)
    g.to = p.ovr
    gains.set(p.id, g)
  }

  const plan = career.room?.plan ?? 'concentrate'
  if (plan === 'spread') {
    // The +2 spread bonus only applies once reps were actually banked.
    const budget = roomBudget(career)
    let points = budget > 0 ? budget + 2 : 0
    // One point per player, neediest first, never above potential.
    for (const p of players) {
      if (points <= 0) break
      if (p.ovr >= p.pot) continue
      apply(p, 1)
      points--
    }
  } else {
    // Focus players are looked up on the whole roster, so the top-10 room cut can't drop them.
    const roster = world.roster[career.teamId] ?? []
    const focus = (career.room?.focus ?? [])
      .map((id) => byId.get(id) ?? roster.find((p) => p.id === id && p.ovr < p.pot))
      .filter((p): p is Player => !!p)
    if (focus.length) {
      const budget = roomBudget(career)
      const per = Math.floor(budget / focus.length)
      let leftover = budget - per * focus.length
      for (const p of focus) {
        const amount = per + (leftover > 0 ? 1 : 0)
        leftover = Math.max(0, leftover - 1)
        apply(p, Math.min(3, amount))
      }
    }
  }

  return { gains: [...gains.values()] }
}

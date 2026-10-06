// ─────────────────────────────────────────────────────────────────────────────
// Starter pitch (K3).
//
// A position coach (developRoom without callPlays) can, once a week, pitch a
// starter on his side of the ball to the coordinator. If the coach has the
// coordinator's ear — measured by leadership and how close the two players rate
// — the coordinator makes the change on the real depth chart. This is a
// personnel decision made from the coaching side, so it never touches the sim.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, Position } from '../types'
import type { World } from './generate'
import { capabilities } from './capabilities'
import { STARTERS, depthAt, setStarterInDepth } from './depth'
import { clamp, hash32, makeRng } from './rng'

/** Positions that line up on offense. */
export const OFF_POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE', 'OT', 'OG', 'C']
/** Positions that line up on defense. */
export const DEF_POSITIONS: Position[] = ['DE', 'DT', 'LB', 'CB', 'S']

/** A position coach — develops a room but does not call plays — can pitch. */
export function canPitch(career: CareerState): boolean {
  const can = capabilities(career).can
  return can.has('developRoom') && !can.has('callPlays')
}

/**
 * The positions this coach can pitch, from `unitFocus`: offense, defense, or
 * both when the focus is not set. Special teams belong to neither side.
 */
export function pitchSide(career: CareerState): Position[] {
  if (!canPitch(career)) return []
  if (career.unitFocus === 'off') return OFF_POSITIONS
  if (career.unitFocus === 'def') return DEF_POSITIONS
  return [...OFF_POSITIONS, ...DEF_POSITIONS]
}

/** The coordinator's answer to a pitch: accepted with a toast line, or refused. */
export type PitchVerdict = { accepted: boolean; message: string } | { error: string }

/**
 * Judge a starter pitch. Refuses an out-of-scope position, a missing player, a
 * player who is already the starter, and a player rated more than 4 points below
 * the man in front of him. Otherwise the coordinator rolls: leadership and the
 * gap between the two players decide the odds. An accepted pitch moves the
 * player to #1 on the real depth chart.
 */
export function judgePitch(
  world: World,
  career: CareerState,
  pos: Position,
  playerId: string,
): PitchVerdict {
  if (!canPitch(career)) return { error: 'Only a position coach can pitch a starter.' }
  if (!pitchSide(career).includes(pos)) return { error: 'That position is not on your side of the ball.' }
  const list = depthAt(world, career.teamId, pos)
  const starter = list[0]
  if (!starter) return { error: 'There is no starter at that position.' }
  const player = list.find((p) => p.id === playerId)
  if (!player) return { error: 'That player is not on the depth chart at that position.' }
  if (player.id === starter.id) return { error: "He's already your starter." }
  // Re-ordering players who already start (WR2 → WR1) changes nothing on the field.
  if (list.findIndex((p) => p.id === player.id) < (STARTERS[pos] ?? 1)) {
    return { error: `${player.name} is already in the starting lineup.` }
  }
  // A promoted backup bumps the LAST starter to the bench, so judge him against that man.
  const benched = list[Math.min(list.length, STARTERS[pos] ?? 1) - 1]
  if (player.ovr < benched.ovr - 4) {
    return { error: `The coordinator won't bench a ${benched.ovr} for a ${player.ovr}.` }
  }
  const chance = clamp(
    0.35 + career.reputation.leadership / 150 + (player.ovr - benched.ovr) * 0.04,
    0.1,
    0.9,
  )
  const roll = makeRng(world.seed + world.season * 977 + world.week * 31 + hash32(player.id, 5))()
  if (roll < chance) {
    setStarterInDepth(world, career.teamId, pos, player.id)
    return { accepted: true, message: `Coordinator bought it: ${player.name} starts at ${pos}.` }
  }
  return { accepted: false, message: `Coordinator passed: sticking with ${benched.name}.` }
}

// ─────────────────────────────────────────────────────────────────────────────
// Depth chart.
//
// Each club can store an explicit ordering of its players at every position
// (`world.depth[teamId][pos]`). When no order is stored, players fall back to
// overall rating. The sim reads this through `depthGroup`.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player, Position } from '../types'
import type { World } from './generate'

/** How many starters line up at each position (a base formation). */
export const STARTERS: Record<Position, number> = {
  QB: 1, RB: 1, FB: 1, WR: 3, TE: 1, OT: 2, OG: 2, C: 1, DE: 2, DT: 2, LB: 3, CB: 2, S: 2, K: 1, P: 1,
}

/** Positions pooled by rating unless the club set an explicit order (keeps sim calibration). */
const POOLED: Position[] = ['DE', 'DT']

/**
 * Players at one position in depth order: the stored order first (still on the
 * roster), then the rest by OVR. Includes injured players.
 */
export function depthAt(world: World, teamId: string, pos: Position): Player[] {
  const roster = (world.roster[teamId] ?? []).filter((p) => p.pos === pos)
  const byId = new Map(roster.map((p) => [p.id, p]))
  const out: Player[] = []
  for (const id of world.depth?.[teamId]?.[pos] ?? []) {
    const p = byId.get(id)
    if (p) {
      out.push(p)
      byId.delete(id)
    }
  }
  const rest = [...byId.values()].sort((a, b) => b.ovr - a.ovr)
  return [...out, ...rest]
}

/**
 * Healthy players for a multi-position group, starters first: rank = (index in
 * the position's healthy depth < STARTERS[pos] ? 0 : 1), then OVR desc.
 */
export function depthGroup(world: World, teamId: string, positions: Position[], n: number): Player[] {
  const ranked: { p: Player; rank: number }[] = []
  for (const pos of positions) {
    const list = depthAt(world, teamId, pos).filter((p) => !p.injured)
    const quota = POOLED.includes(pos) && !world.depth?.[teamId]?.[pos] ? 0 : (STARTERS[pos] ?? 1)
    list.forEach((p, i) => ranked.push({ p, rank: i < quota ? 0 : 1 }))
  }
  ranked.sort((a, b) => a.rank - b.rank || b.p.ovr - a.p.ovr)
  return ranked.slice(0, n).map((r) => r.p)
}

/** Materialise the stored order for a position, then swap the player one slot. */
export function moveInDepth(world: World, teamId: string, pos: Position, playerId: string, dir: -1 | 1): void {
  world.depth ??= {}
  const team = (world.depth[teamId] ??= {})
  team[pos] = depthAt(world, teamId, pos).map((p) => p.id)
  const arr = team[pos]
  if (!arr) return
  const i = arr.indexOf(playerId)
  if (i < 0) return
  const j = i + dir
  if (j < 0 || j >= arr.length) return
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
}

/** Materialise the stored order for a position, then move this player to #1. */
export function setStarterInDepth(world: World, teamId: string, pos: Position, playerId: string): void {
  world.depth ??= {}
  const team = (world.depth[teamId] ??= {})
  team[pos] = depthAt(world, teamId, pos).map((p) => p.id)
  const arr = team[pos]
  if (!arr) return
  const i = arr.indexOf(playerId)
  if (i < 0) return
  arr.splice(i, 1)
  arr.unshift(playerId)
}

/** Drop a club's stored order, reverting it to ratings. */
export function resetDepth(world: World, teamId: string): void {
  if (world.depth) delete world.depth[teamId]
}

/** Starting-lineup slices that feed the OFF / DEF ratings. */
const OFF_SLICE: [Position[], number][] = [
  [['QB'], 1],
  [['RB'], 1],
  [['WR', 'TE'], 4],
  [['OT', 'OG', 'C'], 5],
]
const DEF_SLICE: [Position[], number][] = [
  [['DE', 'DT'], 4],
  [['LB'], 3],
  [['CB'], 3],
  [['S'], 2],
]

function slicePlayers(world: World, teamId: string, slice: [Position[], number][]): Player[] {
  return slice.flatMap(([positions, n]) => depthGroup(world, teamId, positions, n))
}

function meanOvr(players: Player[]): number {
  if (!players.length) return 0
  return players.reduce((s, p) => s + p.ovr, 0) / players.length
}

/**
 * A club's headline ratings from its starting depth groups: offense (QB, RB,
 * WR/TE, OL), defense (DL, LB, CB, S) and the combined overall.
 */
export function teamRatings(world: World, teamId: string): { off: number; def: number; overall: number } {
  const offPlayers = slicePlayers(world, teamId, OFF_SLICE)
  const defPlayers = slicePlayers(world, teamId, DEF_SLICE)
  return {
    off: meanOvr(offPlayers),
    def: meanOvr(defPlayers),
    overall: meanOvr([...offPlayers, ...defPlayers]),
  }
}

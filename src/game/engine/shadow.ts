// ─────────────────────────────────────────────────────────────────────────────
// The Shadow Board (G1).
//
// Personnel rungs with proScout can rank up to ten players who are NOT on their
// club — other teams' rosters or free agents. At season end each entry is graded:
// a hit is a riser (+4 OVR since added), a young star (>= 85 OVR, <= 27 years old)
// or a player your club actually landed (trade or signing) at 78+ OVR. Landing
// the men you flagged is the payoff; the board is how a pro scout shows his eye.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, Player, ShadowEntry } from '../types'
import type { Reputation } from './career'
import type { World } from './generate'
import { capabilities } from './capabilities'

export const MAX_SHADOW = 10

/** Does this rung get to keep a pro-scouting shadow board? */
export function canShadow(career: CareerState): boolean {
  return capabilities(career).can.has('proScout')
}

/** A player anywhere in the world — rostered, an initial free agent, or cut. */
export function findShadowPlayer(world: World, playerId: string): Player | undefined {
  return (
    world.players.find((p) => p.id === playerId) ??
    world.freeAgents.find((p) => p.id === playerId)
  )
}

export function isOnShadowBoard(career: CareerState, playerId: string): boolean {
  return (career.shadowBoard ?? []).some((e) => e.playerId === playerId)
}

/**
 * Add a player to the board, or remove him if he is already there. Refuses
 * players who are already yours and holds the board at MAX_SHADOW.
 */
export function toggleShadow(
  world: World,
  career: CareerState,
  playerId: string,
): { board: ShadowEntry[]; message: string } {
  const board = career.shadowBoard ?? []
  const existing = board.find((e) => e.playerId === playerId)
  if (existing) {
    return { board: board.filter((e) => e.playerId !== playerId), message: `${existing.name} removed from your shadow board.` }
  }
  const player = findShadowPlayer(world, playerId)
  if (!player) return { board, message: 'That player is no longer around.' }
  if (player.teamId === career.teamId) return { board, message: "He's already yours." }
  if (board.length >= MAX_SHADOW) return { board, message: `Your shadow board holds ${MAX_SHADOW}.` }
  const entry: ShadowEntry = {
    playerId: player.id,
    name: player.name,
    pos: player.pos,
    ovrAtAdd: player.ovr,
    season: world.season,
  }
  return { board: [...board, entry], message: `${player.name} added to your shadow board.` }
}

/** One entry's grade: is he a hit, and what line do we tell the player? */
function evaluateEntry(
  world: World,
  career: CareerState,
  e: ShadowEntry,
): { hit: boolean; line: string } | null {
  const p = findShadowPlayer(world, e.playerId)
  if (!p) return null
  const grew = p.ovr - e.ovrAtAdd >= 4
  const star = p.ovr >= 85 && p.age <= 27
  const landed = p.teamId === career.teamId && p.ovr >= 78 && (p.origin?.note ?? '').includes('shadow board')
  if (!grew && !star && !landed) return { hit: false, line: '' }
  const line =
    landed && !grew
      ? `Shadow board: you landed ${e.name} (${p.ovr} OVR).`
      : `Shadow board: ${e.name} grew ${e.ovrAtAdd} → ${p.ovr}.`
  return { hit: true, line }
}

/** Every entry that counts as a hit this season, with its recap line. */
export function shadowHits(world: World, career: CareerState): { entry: ShadowEntry; line: string }[] {
  const out: { entry: ShadowEntry; line: string }[] = []
  for (const e of career.shadowBoard ?? []) {
    const r = evaluateEntry(world, career, e)
    if (r?.hit) out.push({ entry: e, line: r.line })
  }
  return out
}

/**
 * Grade the whole board at season end. Reputation scales with how many hit:
 * 5+ → { roster: 2, evaluation: 1 }, 3–4 → { roster: 1 }, else nothing.
 */
export function gradeShadowBoard(
  world: World,
  career: CareerState,
): { hits: number; total: number; rep: Partial<Reputation>; lines: string[] } {
  const total = (career.shadowBoard ?? []).length
  const hits = shadowHits(world, career)
  const rep: Partial<Reputation> =
    hits.length >= 5 ? { roster: 2, evaluation: 1 } : hits.length >= 3 ? { roster: 1 } : {}
  return { hits: hits.length, total, rep, lines: hits.map((h) => h.line) }
}

/** Drop entries whose player has retired (no longer anywhere in the world). */
export function pruneShadowBoard(world: World, career: CareerState): ShadowEntry[] {
  return (career.shadowBoard ?? []).filter((e) => !!findShadowPlayer(world, e.playerId))
}

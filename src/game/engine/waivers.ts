// ─────────────────────────────────────────────────────────────────────────────
// L11 W2/W3: the in-season waiver wire and AI injury moves.
//
// During the regular season a released player does not go straight to free
// agency: he is placed on waivers for a week (the "Tuesday" turn). Clubs put in
// claims and the worst teams pick first, taking over the player's ORIGINAL
// contract. The player object itself never leaves `world.players` — it is moved
// between the roster and the waiver list, exactly like the other lists.
// ─────────────────────────────────────────────────────────────────────────────

import type { Contract, Player, Position } from '../types'
import type { World } from './generate'
import { STARTERS, depthAt } from './depth'
import { capForSeason, deadMoney } from './cap'
import { ROSTER_FLOOR, freeAgentContract, marketPrice } from './progress'

export interface WaiverEntry {
  playerId: string
  fromTeamId: string
  season: number
  week: number // the week the player was placed on waivers
  contract: Contract // the ORIGINAL contract (a claiming club takes it over)
  deadBooked: number // dead money the releasing club was charged at release
  claims: string[] // club ids that put in a claim (the user's club included)
}

/** A zeroed-out contract, as a released player carries until re-priced. */
function zeroContract(c: Contract): Contract {
  return { ...c, years: 0, base: [0], proration: 0, guaranteed: 0, capHit: 0 }
}

/** Cap space a club has right now (roster hits + dead money vs. the league cap). */
function capSpaceFor(world: World, teamId: string): number {
  const roster = world.roster[teamId] ?? []
  const used = roster.reduce((s, p) => s + p.contract.capHit, 0) + (world.deadMoney[teamId] ?? 0)
  return capForSeason(world.season) - used
}

/**
 * NFL clubs ordered by waiver priority: worst win% first; ties broken by lower
 * point differential, then by id. Deterministic — the same world always ranks
 * the same way.
 */
export function waiverPriority(world: World): string[] {
  return world.teams
    .filter((t) => t.tier === 'NFL')
    .map((t) => {
      const r = world.standings[t.id]
      const wins = r?.wins ?? 0
      const losses = r?.losses ?? 0
      const ties = r?.ties ?? 0
      const games = wins + losses + ties
      const winPct = games ? (wins + ties * 0.5) / games : 0
      const diff = (r?.pointsFor ?? 0) - (r?.pointsAgainst ?? 0)
      return { id: t.id, winPct, diff }
    })
    .sort((a, b) => a.winPct - b.winPct || a.diff - b.diff || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((x) => x.id)
}

/**
 * Record a release on the waiver wire. The canonical player object is kept in
 * `world.players` (only its `teamId` is cleared) — callers own the roster removal
 * and contract zeroing.
 */
export function placeOnWaivers(
  world: World,
  p: Player,
  fromTeamId: string,
  original: Contract,
  deadBooked: number,
): void {
  ;(world.waivers ??= []).push({
    playerId: p.id,
    fromTeamId,
    season: world.season,
    week: world.week,
    contract: { ...original },
    deadBooked,
    claims: [],
  })
  p.teamId = null
}

/** The lowest-OVR player a club can spare (a position above ROSTER_FLOOR). */
function surplusCandidate(world: World, teamId: string): Player | null {
  const roster = world.roster[teamId] ?? []
  if (!roster.length) return null
  const counts: Record<string, number> = {}
  for (const p of roster) counts[p.pos] = (counts[p.pos] ?? 0) + 1
  return (
    [...roster]
      .sort((a, b) => a.ovr - b.ovr || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .find((p) => (counts[p.pos] ?? 0) > (ROSTER_FLOOR[p.pos] ?? 2)) ?? null
  )
}

/**
 * Release a club's most expendable player onto waivers, booking dead money the
 * same way a normal cut does. Returns the released player, or null if the roster
 * sits at every position floor.
 */
function releaseSurplus(world: World, teamId: string): Player | null {
  const roster = world.roster[teamId] ?? []
  const cand = surplusCandidate(world, teamId)
  if (!cand) return null
  const idx = roster.indexOf(cand)
  if (idx < 0) return null
  roster.splice(idx, 1)
  const dead = deadMoney(cand.contract)
  world.deadMoney[teamId] = (world.deadMoney[teamId] ?? 0) + dead
  const original = { ...cand.contract }
  cand.contract = zeroContract(cand.contract)
  placeOnWaivers(world, cand, teamId, original, dead)
  return cand
}

/**
 * Whether a club can take on an entry right now, and if not, why (W4 UI uses the
 * reason for the disabled Claim button). `roster` means every position is at its
 * floor so there is nobody to cut; `cap` means the contract does not fit even
 * after making room. Mirrors the exact test `processWaivers` applies.
 */
export function waiverBlockedReason(
  world: World,
  teamId: string,
  entry: WaiverEntry,
  /** The user's club never has a player cut for it: it needs an open roster spot. */
  noAutoCut = false,
): 'cap' | 'roster' | null {
  const roster = world.roster[teamId] ?? []
  let hit = roster.reduce((s, q) => s + q.contract.capHit, 0)
  let dead = world.deadMoney[teamId] ?? 0
  if (roster.length >= 53) {
    if (noAutoCut) return 'roster'
    const cand = surplusCandidate(world, teamId)
    if (!cand) return 'roster'
    hit -= cand.contract.capHit
    dead += deadMoney(cand.contract)
  }
  return capForSeason(world.season) - (hit + dead) >= entry.contract.capHit ? null : 'cap'
}

/** Whether a club could take on an entry, making room (and cap) if need be. */
function canTake(world: World, teamId: string, entry: WaiverEntry, userTeamId?: string): boolean {
  return waiverBlockedReason(world, teamId, entry, teamId === userTeamId) === null
}

/** The first claimant in priority order that can fit the contract under the cap. */
function firstClaimant(world: World, entry: WaiverEntry, priority: string[], userTeamId?: string): string | null {
  for (const team of priority) {
    if (team === entry.fromTeamId) continue
    if (!entry.claims.includes(team)) continue
    if (canTake(world, team, entry, userTeamId)) return team
  }
  return null
}

/**
 * AI clubs add claims to entries placed in an earlier week. Deterministic, no
 * rng: at most one claim per club per week, and only when the club has cap room
 * and either is short of healthy starters at the position or the player is a
 * clear upgrade (+2 OVR) on its weakest healthy starter there.
 */
export function aiWaiverClaims(world: World, skipTeamId?: string): void {
  const open = (world.waivers ?? []).filter((e) => e.week < world.week)
  if (!open.length) return
  const claimed = new Set<string>()
  for (const team of waiverPriority(world)) {
    if (team === skipTeamId) continue
    for (const entry of open) {
      if (claimed.has(team)) break
      if (entry.fromTeamId === team) continue
      const p = world.players.find((x) => x.id === entry.playerId)
      if (!p) continue
      if (entry.claims.includes(team)) {
        claimed.add(team)
        break
      }
      if (capSpaceFor(world, team) < entry.contract.capHit) continue
      // Only take on a contract worth having: an overpaid veteran stays unclaimed
      // (so a club can't dump a bad deal and its dead money on the AI).
      if (entry.contract.annual > marketPrice(p, world.season) * 1.25) continue
      const healthy = depthAt(world, team, p.pos).filter((x) => !x.injured)
      const startersN = STARTERS[p.pos] ?? 1
      const needs = healthy.length < startersN
      const weakest = healthy.slice(0, startersN).reduce((m, x) => Math.min(m, x.ovr), Infinity)
      const upgrade = healthy.length >= startersN && p.ovr >= weakest + 2
      if (!needs && !upgrade) continue
      entry.claims.push(team)
      claimed.add(team)
      break
    }
  }
}

/**
 * Resolve every entry placed in an earlier week ("Waiver Tuesday"). In priority
 * order the first claimant that can fit wins and takes over the original
 * contract; the releasing club's dead money is refunded. Unclaimed players fall
 * to free agency with a zeroed contract. Processed entries are removed.
 */
export function processWaivers(world: World, userTeamId?: string): {
  claimed: { playerId: string; teamId: string }[]
  cleared: string[]
} {
  const result: { claimed: { playerId: string; teamId: string }[]; cleared: string[] } = {
    claimed: [],
    cleared: [],
  }
  const all = world.waivers ?? (world.waivers = [])
  const open = all.filter((e) => e.week < world.week)
  const processed = new Set(open)
  const priority = waiverPriority(world)
  for (const entry of open) {
    const p = world.players.find((x) => x.id === entry.playerId)
    const winner = p ? firstClaimant(world, entry, priority, userTeamId) : null
    if (winner && p) {
      const roster = (world.roster[winner] ??= [])
      if (roster.length >= 53) releaseSurplus(world, winner)
      p.teamId = winner
      p.contract = { ...entry.contract }
      p.origin = {
        kind: 'waiver',
        season: world.season,
        by: world.byId[winner]?.name ?? winner,
        fromTeamId: entry.fromTeamId,
      }
      roster.push(p)
      world.freeAgents = world.freeAgents.filter((x) => x.id !== p.id)
      world.deadMoney[entry.fromTeamId] = Math.max(
        0,
        (world.deadMoney[entry.fromTeamId] ?? 0) - entry.deadBooked,
      )
      result.claimed.push({ playerId: p.id, teamId: winner })
    } else {
      if (p) {
        p.teamId = null
        p.contract = zeroContract(p.contract)
        if (!world.freeAgents.some((x) => x.id === p.id)) world.freeAgents.push(p)
      }
      result.cleared.push(entry.playerId)
    }
  }
  // Drop the entries we just processed but keep any placed while resolving
  // (a club that had to cut a player to make room).
  world.waivers = (world.waivers ?? []).filter((e) => !processed.has(e))
  return result
}

/** Any entries still open clear to free agency (end of season / new league year). */
export function clearWaivers(world: World): void {
  for (const entry of world.waivers ?? []) {
    const p = world.players.find((x) => x.id === entry.playerId)
    if (!p) continue
    p.teamId = null
    p.contract = zeroContract(p.contract)
    if (!world.freeAgents.some((x) => x.id === p.id)) world.freeAgents.push(p)
  }
  world.waivers = []
}

// ── W3: AI in-season injury moves ────────────────────────────────────────────

const STARTER_POSITIONS = Object.keys(STARTERS) as Position[]

/**
 * Replace injured starters. For each AI club with an injured starter (out 3+
 * games) and thin healthy depth at that position, sign the best affordable free
 * agent there (one signing per club per week). If the roster then exceeds 53,
 * the most expendable player is released onto waivers. Deterministic, no rng.
 */
export function aiInjuryMoves(world: World, skipTeamId?: string): void {
  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    if (t.id === skipTeamId) continue
    const roster = world.roster[t.id] ?? []

    let targetPos: Position | null = null
    for (const pos of STARTER_POSITIONS) {
      const depth = depthAt(world, t.id, pos)
      const startersN = STARTERS[pos]
      const injuredStarter = depth
        .slice(0, startersN)
        .find((p) => p.injured && p.injured.games >= 3)
      if (!injuredStarter) continue
      const healthy = depth.filter((p) => !p.injured)
      if (healthy.length >= startersN + 1) continue
      targetPos = pos
      break
    }
    if (!targetPos) continue

    const space = capSpaceFor(world, t.id)
    const pick = [...world.freeAgents]
      .filter((p) => p.pos === targetPos)
      .sort((a, b) => b.ovr - a.ovr || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .find(
        (p) =>
          freeAgentContract(p, world.season, world.week, world.phase).capHit <= space,
      )
    if (!pick) continue

    world.freeAgents = world.freeAgents.filter((p) => p.id !== pick.id)
    pick.teamId = t.id
    pick.contract = freeAgentContract(pick, world.season, world.week, world.phase)
    roster.push(pick)
    if (roster.length > 53) releaseSurplus(world, t.id)
  }
}

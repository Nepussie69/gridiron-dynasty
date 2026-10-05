// ─────────────────────────────────────────────────────────────────────────────
// Trade evaluation & execution.
//
// Trades move players and draft picks between clubs. The AI values assets from
// its own perspective: rebuilding teams covet youth and picks, win-now teams
// prefer proven veterans, and everyone pays a premium for a position of need.
// ─────────────────────────────────────────────────────────────────────────────

import type { DraftPick, Player, Position } from '../types'
import type { World } from './generate'
import { hash32 } from './rng'
import { onTeamChange } from './playbook'

export interface TradeAsset {
  kind: 'player' | 'pick'
  id: string
}

/** Present value of a player: production curve × youth × remaining upside. */
export function playerTradeValue(p: Player): number {
  const youth = p.age <= 26 ? 1.25 : p.age <= 29 ? 1.0 : p.age <= 32 ? 0.7 : 0.45
  const upside = 1 + Math.max(0, p.pot - p.ovr) * 0.012
  return Math.round(Math.pow(Math.max(p.ovr - 45, 1), 2) * 1.2 * youth * upside)
}

/** Trade-chart value of a pick, estimated at the middle of its round. */
export function pickTradeValue(pick: DraftPick): number {
  const overall = (pick.round - 1) * 32 + 16
  const base = Math.max(1, Math.round(3000 * Math.pow(0.945, overall - 1)))
  return pick.comp ? Math.round(base * 0.7) : base
}

function findPlayer(world: World, id: string): Player | undefined {
  return world.players.find((p) => p.id === id)
}
function findPick(world: World, id: string): DraftPick | undefined {
  return world.draftPicks.find((p) => p.id === id)
}

/** Raw (symmetric) value of an asset. */
export function assetValue(world: World, a: TradeAsset): number {
  if (a.kind === 'player') {
    const p = findPlayer(world, a.id)
    return p ? playerTradeValue(p) : 0
  }
  const pk = findPick(world, a.id)
  return pk ? pickTradeValue(pk) : 0
}

const NEED_TARGET: Record<string, number> = {
  QB: 3, RB: 3, WR: 6, TE: 3, OT: 4, OG: 4, C: 2, DE: 4, DT: 4, LB: 6, CB: 6, S: 4, K: 1, P: 1,
}

/** How badly a team needs a position, 0 (stocked) to 1 (empty). */
function needFactor(world: World, teamId: string, pos: Position): number {
  const roster = world.roster[teamId] ?? []
  const have = roster.filter((p) => p.pos === pos).length
  const target = NEED_TARGET[pos] ?? 3
  return Math.max(0, Math.min(1, (target - have) / target))
}

/** Is this club rebuilding (values youth/picks) or win-now (values veterans)? */
function isRebuilding(partnerId: string): boolean {
  return hash32(partnerId, 11) % 100 >= 50
}

/** Adjust a raw value by how the partner reads that asset. */
function partnerValue(world: World, partnerId: string, a: TradeAsset, rebuild: boolean): number {
  const base = assetValue(world, a)
  if (a.kind === 'pick') return base * (rebuild ? 1.2 : 0.9)
  const p = findPlayer(world, a.id)
  if (!p) return base
  const ageMul = rebuild
    ? p.age <= 25 ? 1.2 : p.age >= 30 ? 0.7 : 1
    : p.age <= 27 ? 1.05 : p.age >= 31 ? 1.05 : 1
  const need = 1 + needFactor(world, partnerId, p.pos) * 0.18
  // Stars are hard to pry away: a club's top-3 players carry a premium.
  const roster = world.roster[partnerId] ?? []
  const rank = [...roster].sort((x, y) => y.ovr - x.ovr).findIndex((x) => x.id === p.id)
  const starPremium = rank >= 0 && rank < 3 ? 1.45 : 1
  return base * ageMul * need * starPremium
}

export interface TradeVerdict {
  accepted: boolean
  verdict: 'accept' | 'close' | 'reject'
  /** What the partner receives (raw). */
  theyReceive: number
  /** What the partner gives up (raw). */
  theyGive: number
  /** Ratio ≥ 1 means they come out ahead. */
  ratio: number
  reason: string
}

/**
 * Decide whether the partner AI accepts. `give` is what the user sends away;
 * `get` is what the user receives.
 */
export function evaluateTrade(
  world: World,
  partnerId: string,
  userTeamId: string,
  give: TradeAsset[],
  get: TradeAsset[],
): TradeVerdict {
  const rebuild = isRebuilding(partnerId)
  const theyReceive = give.reduce((s, a) => s + partnerValue(world, partnerId, a, rebuild), 0)
  const theyGive = get.reduce((s, a) => s + partnerValue(world, partnerId, a, rebuild), 0)
  const rawRatio = theyGive > 0 ? theyReceive / theyGive : theyReceive > 0 ? 99 : 1
  // A touch of front-office personality, deterministic per pairing.
  const bias = ((hash32(partnerId + userTeamId, 5) % 9) - 4) / 100
  const ratio = rawRatio - bias

  let verdict: TradeVerdict['verdict'] = 'reject'
  if (ratio >= 1.0) verdict = 'accept'
  else if (ratio >= 0.9) verdict = 'close'

  const style = rebuild ? 'building for the future' : 'in win-now mode'
  let reason: string
  if (!give.length && !get.length) reason = 'No assets on the table.'
  else if (verdict === 'accept')
    reason = `They're ${style} and this deal tips the value chart their way. Accepted.`
  else if (verdict === 'close')
    reason = `Close, but they're ${style} and want a little more coming back.`
  else if (rawRatio < 0.7)
    reason = `Way off — this isn't close to fair value for a club that's ${style}.`
  else reason = `Rejected. Add value (a better player or a higher pick) and try again.`

  return { accepted: verdict === 'accept', verdict, theyReceive, theyGive, ratio, reason }
}

function movePlayer(world: World, playerId: string, toTeamId: string, log: string[]) {
  const p = findPlayer(world, playerId)
  if (!p) return
  const from = p.teamId
  if (from) world.roster[from] = (world.roster[from] ?? []).filter((x) => x.id !== p.id)
  p.teamId = toTeamId
  ;(world.roster[toTeamId] ??= []).push(p)
  // A new system means the playbook resets — carried experience only.
  const staff = world.staff[toTeamId] ?? []
  const role = p.side === 'DEF' ? 'Defensive Coordinator' : 'Offensive Coordinator'
  const scheme = staff.find((s) => s.role === role)?.scheme ?? ''
  const tenure = world.staffTenure?.[`${toTeamId}:${p.side === 'DEF' ? 'def' : 'off'}`] ?? 1
  p.playbook = onTeamChange(p, toTeamId, scheme, tenure)
  const team = world.byId[toTeamId]
  log.push(`${p.name} to ${team.tier === 'NFL' ? `${team.city} ${team.name}` : team.name}`)
}

/**
 * Execute a trade. Returns a human-readable log of each asset moved. Assumes the
 * caller already validated acceptance.
 */
export function executeTrade(
  world: World,
  userTeamId: string,
  partnerId: string,
  give: TradeAsset[],
  get: TradeAsset[],
): string[] {
  const log: string[] = []
  for (const a of give) {
    if (a.kind === 'player') movePlayer(world, a.id, partnerId, log)
    else {
      const pk = findPick(world, a.id)
      if (pk) {
        pk.ownerTeam = partnerId
        log.push(`${pk.season} Round ${pk.round} pick to ${world.byId[partnerId].abbr}`)
      }
    }
  }
  for (const a of get) {
    if (a.kind === 'player') movePlayer(world, a.id, userTeamId, log)
    else {
      const pk = findPick(world, a.id)
      if (pk) {
        pk.ownerTeam = userTeamId
        log.push(`${pk.season} Round ${pk.round} pick to ${world.byId[userTeamId].abbr}`)
      }
    }
  }
  return log
}

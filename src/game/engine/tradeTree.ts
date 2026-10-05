// ─────────────────────────────────────────────────────────────────────────────
// Trade Tree (#6 transaction trees).
//
// Presentation + bookkeeping only. Every trade the user's club makes is
// snapshotted, picks are later linked to the player they became, and each trade
// is graded from its current value. Trades that sent away an asset acquired in
// an earlier trade are nested under it — that nesting is the tree.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, Player, TradeAssetSnap, TradeRecord } from '../types'
import type { World } from './generate'
import { playerTradeValue, pickTradeValue, type TradeAsset } from './trade'

function findPlayer(world: World, id: string): Player | undefined {
  return world.players.find((p) => p.id === id)
}

/** Snapshot one asset at trade time, with a human label. */
export function snapAsset(world: World, a: TradeAsset): TradeAssetSnap {
  if (a.kind === 'player') {
    const p = findPlayer(world, a.id)
    return {
      kind: 'player',
      id: a.id,
      label: p ? `${p.name} (${p.pos}, ${p.ovr})` : a.id,
    }
  }
  const pick = world.draftPicks.find((p) => p.id === a.id)
  const abbr = pick ? world.byId[pick.originalTeam]?.abbr ?? pick.originalTeam : a.id
  return {
    kind: 'pick',
    id: a.id,
    label: pick ? `${pick.season} Rd ${pick.round} (${abbr})${pick.comp ? ' comp' : ''}` : a.id,
  }
}

/**
 * Record one trade the user's club made. Call BEFORE executeTrade so the
 * snapshots see the assets on their original rosters.
 */
export function recordTrade(
  world: World,
  career: CareerState,
  partnerId: string,
  give: TradeAsset[],
  get: TradeAsset[],
): TradeRecord {
  const giveIds = new Set(give.map((a) => a.id))
  const parentIds: string[] = []
  for (const rec of career.trades ?? []) {
    if (rec.got.some((s) => giveIds.has(s.id)) && !parentIds.includes(rec.id)) parentIds.push(rec.id)
  }
  return {
    id: `tr_${world.season}_${world.week}_${career.trades?.length ?? 0}`,
    season: world.season,
    week: world.week,
    partnerId,
    gave: give.map((a) => snapAsset(world, a)),
    got: get.map((a) => snapAsset(world, a)),
    parentIds,
  }
}

/** Fill in the player drafted with each pick snap, once he exists. Returns newly resolved count. */
export function resolveTradePicks(world: World, career: CareerState): number {
  let resolved = 0
  for (const rec of career.trades ?? []) {
    for (const snap of [...rec.gave, ...rec.got]) {
      if (snap.kind !== 'pick' || snap.resolvedPlayerId) continue
      const p = world.players.find((x) => x.origin?.pickId === snap.id)
      if (!p) continue
      snap.resolvedPlayerId = p.id
      snap.resolvedName = p.name
      resolved++
    }
  }
  return resolved
}

/** Current value of one side of a trade. */
export function sideValue(world: World, snaps: TradeAssetSnap[]): number {
  let total = 0
  for (const snap of snaps) {
    if (snap.kind === 'player') {
      const p = findPlayer(world, snap.id)
      if (p) total += playerTradeValue(p)
      continue
    }
    if (snap.resolvedPlayerId) {
      const p = findPlayer(world, snap.resolvedPlayerId)
      if (p) {
        total += playerTradeValue(p)
        continue
      }
    }
    const pick = world.draftPicks.find((p) => p.id === snap.id)
    if (pick) total += pickTradeValue(pick)
  }
  return total
}

export type TradeVerdict = 'Won' | 'Even' | 'Lost' | 'Too early'

/** Grade a trade from its current value. */
export function tradeVerdict(world: World, rec: TradeRecord): { verdict: TradeVerdict; gave: number; got: number } {
  const gave = sideValue(world, rec.gave)
  const got = sideValue(world, rec.got)
  if (world.season - rec.season < 2) return { verdict: 'Too early', gave, got }
  const ratio = got / Math.max(gave, 1)
  const verdict: TradeVerdict = ratio > 1.25 ? 'Won' : ratio < 0.8 ? 'Lost' : 'Even'
  return { verdict, gave, got }
}

export interface TradeNode {
  record: TradeRecord
  verdict: TradeVerdict
  gave: number
  got: number
  children: TradeNode[]
}

/** The whole trade tree: roots are records whose incoming assets were never sent away. */
export function tradeTree(world: World, career: CareerState): TradeNode[] {
  const records = career.trades ?? []
  const childrenOf = new Map<string, TradeRecord[]>()
  for (const rec of records) {
    for (const pid of rec.parentIds) {
      const list = childrenOf.get(pid)
      if (list) list.push(rec)
      else childrenOf.set(pid, [rec])
    }
  }
  const build = (rec: TradeRecord): TradeNode => {
    const { verdict, gave, got } = tradeVerdict(world, rec)
    return {
      record: rec,
      verdict,
      gave,
      got,
      children: (childrenOf.get(rec.id) ?? []).map(build),
    }
  }
  return records.filter((rec) => rec.parentIds.length === 0).map(build)
}

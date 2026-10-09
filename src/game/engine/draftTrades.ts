// ─────────────────────────────────────────────────────────────────────────────
// L14 — Draft-day trades.
//
// While your club is on the clock, rival clubs call with concrete offers priced
// by the draft value chart: they want YOUR selection (you move back and gain
// assets). Before your pick comes up you can also move UP, paying a package for
// an earlier selection that is still on the board.
//
// Nothing here changes the league unless you accept an offer — AI-vs-AI drafts
// run exactly as before — and every function is deterministic. Any new ordering
// uses `hash32` on stable strings, never the sim's rng stream, and the heavy
// searches are memoised per world so a re-render never re-runs them.
// ─────────────────────────────────────────────────────────────────────────────

import type { DraftPick, Player } from '../types'
import type { World } from './generate'
import { draftOpen } from './draft'
import { hash32 } from './rng'
import {
  assetValue,
  findDeals,
  findPackagesFor,
  isTradeablePick,
  type TradeAsset,
} from './trade'

export interface DraftTradeOffer {
  id: string
  partnerId: string
  /** 'down' = you send your own pick away and gain a package; 'up' = you pay for an earlier pick. */
  direction: 'up' | 'down'
  /** What your club sends. */
  give: TradeAsset[]
  /** What your club receives. */
  get: TradeAsset[]
  giveValue: number
  getValue: number
  headline: string
  blurb: string
}

export interface DraftTradeUpTarget extends DraftTradeOffer {
  pickId: string
  overall: number
  round: number
}

function findPlayer(world: World, id: string): Player | undefined {
  return world.players.find((p) => p.id === id)
}

/** Human label for one trade asset, e.g. "A. Cooper (WR, 84)" or "2027 Rd 2". */
export function draftAssetName(world: World, a: TradeAsset): string {
  if (a.kind === 'player') {
    const p = findPlayer(world, a.id)
    return p ? `${p.name} (${p.pos}, ${p.ovr})` : 'Player'
  }
  const pk = world.draftPicks.find((x) => x.id === a.id)
  return pk ? `${pk.season} Rd ${pk.round}${pk.comp ? ' (comp)' : ''}` : 'Pick'
}

function valueOf(world: World, assets: TradeAsset[]): number {
  return assets.reduce((s, a) => s + assetValue(world, a), 0)
}

/** The pick your club owns at the slot that is currently on the clock, or null. */
export function onClockPick(world: World, userTeamId: string): DraftPick | null {
  if (!draftOpen(world) || world.draftState.complete) return null
  const slot = world.draftState.pickIndex
  if (world.draftOrder[slot] !== userTeamId) return null
  const id = world.draftPickIds?.[slot]
  return id ? (world.draftPicks.find((p) => p.id === id) ?? null) : null
}

/** The earliest unselected slot still owned by your club (your next pick), or -1. */
export function nextUserPickSlot(world: World, userTeamId: string): number {
  const order = world.draftOrder
  for (let i = world.draftState.pickIndex; i < order.length; i++) {
    if (order[i] === userTeamId) return i
  }
  return -1
}

/**
 * A stamp of everything these searches depend on: the draft slot, the class, and
 * every pick's owner. Two builds with the same stamp are identical, so the UI can
 * reuse a cached answer instead of re-running the value-chart search each render.
 */
function buildStamp(world: World, userTeamId: string): string {
  const owners = world.draftPicks.map((p) => p.ownerTeam).join('|')
  return [
    world.seed,
    world.season,
    world.draftState.pickIndex,
    world.draftState.complete ? 1 : 0,
    world.draftPicks.length,
    userTeamId,
    hash32(owners, 7),
  ].join(':')
}

const downCache = new WeakMap<World, { stamp: string; offers: DraftTradeOffer[] }>()
const upCache = new WeakMap<World, { stamp: string; targets: DraftTradeUpTarget[] }>()

/**
 * Trade-DOWN offers: rival clubs want the pick on the clock. Each package is a
 * deal `evaluateTrade` already accepts for your selection, so accepting one needs
 * no second negotiation. Deterministic and read-only — nothing moves until you
 * say yes. Memoised per world/stamp (the search is the expensive part).
 */
export function buildDraftTradeDownOffers(world: World, userTeamId: string, limit = 4): DraftTradeOffer[] {
  const pick = onClockPick(world, userTeamId)
  if (!pick) return []
  const stamp = buildStamp(world, userTeamId)
  const cached = downCache.get(world)
  if (cached && cached.stamp === stamp) return cached.offers.slice(0, limit)

  const deals = findDeals(world, userTeamId, pick.id)
  const offers = deals.slice(0, Math.max(limit, 4)).map((d, i): DraftTradeOffer => {
    const abbr = world.byId[d.partnerId]?.abbr ?? d.partnerId
    const getStr = d.get.map((a) => draftAssetName(world, a)).join(' + ')
    const giveStr = `${pick.season} Rd ${pick.round}`
    return {
      id: `dt_down_${world.season}_${world.draftState.pickIndex}_${d.partnerId}_${i}`,
      partnerId: d.partnerId,
      direction: 'down',
      give: d.give,
      get: d.get,
      giveValue: valueOf(world, d.give),
      getValue: valueOf(world, d.get),
      headline: `${abbr} want your ${giveStr} pick`,
      blurb: `They move up to your slot and send ${getStr}. You slide back and stockpile value.`,
    }
  })
  downCache.set(world, { stamp, offers })
  return offers.slice(0, limit)
}

/**
 * Trade-UP targets: while your own pick is still ahead, the clubs picking before
 * it can be bought out of their slot. Each target is paired with the cheapest
 * package of your assets that club already accepts. Memoised per world/stamp.
 */
export function buildDraftTradeUpTargets(world: World, userTeamId: string, limit = 5): DraftTradeUpTarget[] {
  if (!draftOpen(world) || world.draftState.complete) return []
  const slot = world.draftState.pickIndex
  const next = nextUserPickSlot(world, userTeamId)
  if (next < 0 || next <= slot) return []
  const ids = world.draftPickIds
  if (!ids?.length) return []
  const stamp = buildStamp(world, userTeamId)
  const cached = upCache.get(world)
  if (cached && cached.stamp === stamp) return cached.targets.slice(0, limit)

  const out: DraftTradeUpTarget[] = []
  // Only the picks close enough that a club would realistically sell them: scan a
  // bounded window ahead of the current slot.
  const scanEnd = Math.min(next, slot + 16)
  for (let i = slot; i < scanEnd; i++) {
    const owner = world.draftOrder[i]
    if (!owner || owner === userTeamId) continue
    const pickId = ids[i]
    if (!pickId) continue
    const pk = world.draftPicks.find((p) => p.id === pickId)
    if (!pk || pk.ownerTeam !== owner || !isTradeablePick(world, pk)) continue
    const pkgs = findPackagesFor(world, userTeamId, pickId)
    if (!pkgs.length) continue
    const d = pkgs[0]
    const abbr = world.byId[owner]?.abbr ?? owner
    const giveStr = d.give.map((a) => draftAssetName(world, a)).join(' + ')
    out.push({
      id: `dt_up_${world.season}_${i}_${owner}_${pickId}`,
      partnerId: owner,
      direction: 'up',
      give: d.give,
      get: [{ kind: 'pick', id: pickId }],
      giveValue: valueOf(world, d.give),
      getValue: assetValue(world, { kind: 'pick', id: pickId }),
      headline: `Move up to #${i + 1} (Rd ${pk.round}, ${abbr})`,
      blurb: `${abbr} will part with the selection for ${giveStr}.`,
      pickId,
      overall: i + 1,
      round: pk.round,
    })
    if (out.length >= limit) break
  }
  upCache.set(world, { stamp, targets: out })
  return out
}

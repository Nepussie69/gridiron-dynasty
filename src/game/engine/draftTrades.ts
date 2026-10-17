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

import type { CareerState, DraftPick, DraftProspect, Player, TradeRecord } from '../types'
import { generalManager, type World } from './generate'
import { bestAvailableFor, draftOpen, makePick, simUntilUser } from './draft'
import { hash32 } from './rng'
import { gmStyle } from './gmStyle'
import { logConvictionPicks } from './conviction'
import { logRedFlags } from './redflag'
import { isOnShadowBoard } from './shadow'
import { recordTrade, resolveTradePicks } from './tradeTree'
import {
  roomAccumulating,
  roomBoardScores,
  roomTakesTradeDown,
  roomTradeNote,
  tradeDownAdvocate,
  tradeDownOfferLimit,
} from './draftRoom'
import {
  assetValue,
  evaluateTrade,
  executeTrade,
  findDeals,
  findPackagesFor,
  isTradeablePick,
  pickAssetLabel,
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

/**
 * Human label for one trade asset, e.g. "A. Cooper (WR, 84)" or, for a pick, its
 * year, round, slot and original club: "2027 Rd 1 #1 (NYJ)". A projected slot
 * is marked "~" ("2028 Rd 1 ~#24 (DAL)").
 */
export function draftAssetName(world: World, a: TradeAsset): string {
  if (a.kind === 'player') {
    const p = findPlayer(world, a.id)
    return p ? `${p.name} (${p.pos}, ${p.ovr})` : 'Player'
  }
  const pk = world.draftPicks.find((x) => x.id === a.id)
  return pk ? pickAssetLabel(world, pk) : 'Pick'
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
    const giveStr = draftAssetName(world, { kind: 'pick', id: pick.id })
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

// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #27 DF2 — the room takes a trade-down, and the shared accept internals.
//
// An Accumulate room does not just show more offers: while an NPC runs your club's
// pick, it can actually move off the clock. The decision is hash-only (no world-RNG
// draw), and taking the deal goes through the very same code path a click uses, so
// the two can never drift apart.
// ─────────────────────────────────────────────────────────────────────────────

/** The value premium the room demands before it will move off the clock. */
export const ROOM_TRADE_VALUE_MIN = 1.08
/** How far the blended board may fall off across the three slots we drop back. */
export const ROOM_TRADE_DROPOFF_MAX = 4

export interface RoomTradeDown {
  offer: DraftTradeOffer
  /** The voice that argued for the move, for the ledger line. */
  advocateShort: string
  isUserCall: boolean
  /** The ledger line: whose call it was and what came back. */
  note: string
  /** The return package in human terms. */
  returnText: string
  /** What the deal pays over what it costs (getValue / giveValue). */
  ratio: number
}

/** The deal value ratio, guarding a zero-cost package. */
function valueRatio(o: DraftTradeOffer): number {
  return o.giveValue > 0 ? o.getValue / o.giveValue : Number.POSITIVE_INFINITY
}

/**
 * The room's own trade-down for the pick on the clock, or null to stand pat:
 * Accumulate only, the best offer that pays ≥ 1.08×, the blended board still
 * within 4 points three slots back, and the room's authority behind Accumulate
 * winning the h01 roll. Deterministic and read-only — `applyDraftTradeDown` moves.
 */
export function roomTradeDown(
  world: World,
  career: CareerState,
  gradeOf: (p: DraftProspect) => number,
): RoomTradeDown | null {
  if (!draftOpen(world) || world.draftState.complete) return null
  if (!roomAccumulating(world, career)) return null
  const pick = onClockPick(world, career.teamId)
  if (!pick) return null
  const offers = buildDraftTradeDownOffers(world, career.teamId, tradeDownOfferLimit(world, career))
    .filter((o) => valueRatio(o) >= ROOM_TRADE_VALUE_MIN)
    .sort(
      (a, b) =>
        valueRatio(b) - valueRatio(a) || b.getValue - b.giveValue - (a.getValue - a.giveValue) || (a.id < b.id ? -1 : 1),
    )
  const offer = offers[0]
  if (!offer) return null
  // Would we still get a comparable player three slots later? If the blended board
  // falls off harder than 4 points across those slots, hold the pick.
  const board = roomBoardScores(world, career, gradeOf)
  if (!board || board.length < 2) return null
  const later = board[Math.min(3, board.length - 1)]
  if (board[0].score - later.score > ROOM_TRADE_DROPOFF_MAX) return null
  if (!roomTakesTradeDown(world, career)) return null
  const advocate = tradeDownAdvocate(world, career)
  const abbr = world.byId[offer.partnerId]?.abbr ?? offer.partnerId
  const returnText = offer.get.map((a) => draftAssetName(world, a)).join(' + ')
  return {
    offer,
    advocateShort: advocate?.short ?? 'room',
    isUserCall: !!advocate?.isUser,
    note: roomTradeNote(advocate, abbr, returnText),
    returnText,
    ratio: valueRatio(offer),
  }
}

export interface DraftTradeResult {
  ok: boolean
  /** Why it did not go through, for the toast (undefined when ok). */
  reason?: string
  rec?: TradeRecord
  partnerAbbr?: string
}

/** Does `teamId` still own this asset, and is a pick still live for trading? */
export function draftAssetOwnedBy(world: World, a: TradeAsset, teamId: string): boolean {
  if (a.kind === 'player') return world.players.find((p) => p.id === a.id)?.teamId === teamId
  const pk = world.draftPicks.find((p) => p.id === a.id)
  return !!pk && pk.ownerTeam === teamId && isTradeablePick(world, pk)
}

/**
 * A live draft-day trade can move a pick that still has a slot ahead of it, so
 * re-point the slot's team from current pick ownership (comp picks included)
 * without rebuilding the whole order.
 */
export function syncDraftOrder(world: World): void {
  const ids = world.draftPickIds
  if (!ids?.length) return
  for (let i = 0; i < ids.length && i < world.draftOrder.length; i++) {
    const pk = world.draftPicks.find((p) => p.id === ids[i])
    if (pk) world.draftOrder[i] = pk.ownerTeam
  }
}

/** Stamp players arriving via a trade as your acquisitions (origin + shadow note). */
export function stampIncomingPlayers(world: World, career: CareerState, partnerId: string, get2: TradeAsset[]): void {
  for (const a of get2) {
    if (a.kind !== 'player') continue
    const p = (world.roster[career.teamId] ?? []).find((x) => x.id === a.id)
    if (p) {
      p.origin = { kind: 'trade', season: world.season, by: career.gmName, fromTeamId: partnerId }
      if (isOnShadowBoard(career, p.id)) p.origin.note = '(from your shadow board)'
    }
  }
}

/** Ping the inbox whenever one of your guys comes off the board (#20). */
export function announceDraftPicks(world: World, career: CareerState) {
  const board = new Set(career.userBoard ?? [])
  const guys = new Set((career.ledger ?? []).map((e) => e.prospectId).filter((x): x is string => !!x))
  for (const p of world.draft) {
    if (!p.draftedBy) continue
    if (!board.has(p.id) && !guys.has(p.id)) continue
    const id = `draftping_${p.id}`
    if (world.news.some((n) => n.id === id)) continue
    world.news.unshift({
      id,
      week: world.week,
      season: world.season,
      category: 'Draft',
      headline: `${p.name} drafted at #${p.draftPick ?? '?'}`,
      body: `One of your guys is off the board — ${p.pos} from ${p.college} to the ${world.byId[p.draftedBy]?.abbr ?? p.draftedBy}. This is the payoff of the climb.`,
      teamId: career.teamId,
      read: false,
    })
  }
}

/**
 * The shared accept internals for a trade-down: verify, price the deal, record it,
 * move the assets, hand the on-clock partner his pick, then run the board forward
 * unless the caller is already inside the sim loop (`runForward: false`). Used by
 * both the click path (`acceptDraftTradeOffer`) and the room's own trade-down.
 */
export function applyDraftTradeDown(
  world: World,
  career: CareerState,
  offer: DraftTradeOffer,
  opts: { runForward?: boolean } = {},
): DraftTradeResult {
  if (!draftOpen(world)) return { ok: false, reason: 'The draft is in April — scout the class now.' }
  if (!offer.give.every((a) => draftAssetOwnedBy(world, a, career.teamId)))
    return { ok: false, reason: 'That deal is no longer available — the board has moved.' }
  if (!offer.get.every((a) => draftAssetOwnedBy(world, a, offer.partnerId)))
    return { ok: false, reason: 'That deal is no longer available — the board has moved.' }
  const verdict = evaluateTrade(world, offer.partnerId, career.teamId, offer.give, offer.get, career.skills.negotiation)
  if (!verdict.accepted) return { ok: false, reason: verdict.reason }
  const rec = recordTrade(world, career, offer.partnerId, offer.give, offer.get)
  executeTrade(world, career.teamId, offer.partnerId, offer.give, offer.get)
  stampIncomingPlayers(world, career, offer.partnerId, offer.get)
  syncDraftOrder(world)
  const prospect = bestAvailableFor(world, offer.partnerId, undefined, undefined, undefined, gmStyle(generalManager(world, offer.partnerId)))
  if (prospect) makePick(world, prospect, offer.partnerId)
  else world.draftState.complete = true
  career.trades = [...(career.trades ?? []), rec].slice(-60)
  // Run the board forward to your next selection (a click); the sim loop continues
  // itself when the room moved off the clock mid-draft.
  if (opts.runForward !== false) simUntilUser(world, career)
  logConvictionPicks(world, career)
  logRedFlags(world, career)
  announceDraftPicks(world, career)
  resolveTradePicks(world, career)
  return { ok: true, rec, partnerAbbr: world.byId[offer.partnerId]?.abbr ?? offer.partnerId }
}

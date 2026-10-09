// ─────────────────────────────────────────────────────────────────────────────
// L14 — Trade deadline day.
//
// One live week (week 8) in the middle of the season when the market opens:
// contenders buy, rebuilding clubs sell, and the AI calls your club with
// concrete, already-accepted offers you can take or leave. The offers only
// change the league when you accept one; the league-wide AI flurry is opt-in
// (off by default), so the default sim is untouched. Everything here is
// deterministic — a stable hash, never the sim's rng stream.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, Player } from '../types'
import type { World } from './generate'
import { teamStrength } from './generate'
import { hash32 } from './rng'
import { unscaleOvr } from './ovrScale'
import { capForSeason } from './cap'
import {
  executeTrade,
  findDeals,
  findPackagesFor,
  playerTradeValue,
  type TradeAsset,
} from './trade'

/** The week the deadline lands (midseason). */
export const DEADLINE_WEEK = 8

export interface DeadlineOffer {
  id: string
  partnerId: string
  /** 'buy' = the AI is offering you a player; 'sell' = the AI wants one of yours. */
  kind: 'buy' | 'sell'
  /** What your club sends. */
  give: TradeAsset[]
  /** What your club receives. */
  get: TradeAsset[]
  headline: string
  blurb: string
}

export interface DeadlineState {
  season: number
  week: number
  offers: DeadlineOffer[]
  /** Offer ids already accepted or declined. */
  resolved: string[]
  /** Whether the league-wide AI flurry ran this deadline. */
  aiRan?: boolean
  aiTrades?: number
}

function findPlayer(world: World, id: string): Player | undefined {
  return world.players.find((p) => p.id === id)
}

/** Win percentage (ties count a half) from a club's record. */
function winPct(world: World, teamId: string): number {
  const r = world.standings[teamId]
  if (!r) return 0
  const played = r.wins + r.losses + r.ties
  if (!played) return 0
  return (r.wins + r.ties * 0.5) / played
}

/**
 * Who is buying and who is selling this week. After week 4 the standings decide
 * it; before that (or in a fresh season) roster strength is the read. The top
 * third are contenders, the bottom third sellers. Deterministic.
 */
export function deadlineRoles(world: World): { contenders: string[]; sellers: string[] } {
  const nfl = world.teams.filter((t) => t.tier === 'NFL')
  const useRecord = world.phase === 'regular' && world.week > 4
  const ranked = [...nfl]
    .map((t) => ({
      id: t.id,
      v: useRecord ? winPct(world, t.id) : teamStrength(world.roster[t.id] ?? []),
    }))
    .sort((a, b) => b.v - a.v || a.id.localeCompare(b.id))
  const cut = Math.max(1, Math.round(ranked.length / 3))
  return {
    contenders: ranked.slice(0, cut).map((x) => x.id),
    sellers: ranked.slice(-cut).map((x) => x.id),
  }
}

/** Human label for one asset, e.g. "A. Cooper (WR, 84)" or "2027 Rd 2". */
export function deadlineAssetName(world: World, a: TradeAsset): string {
  if (a.kind === 'player') {
    const p = findPlayer(world, a.id)
    return p ? `${p.name} (${p.pos}, ${p.ovr})` : 'Player'
  }
  const pk = world.draftPicks.find((x) => x.id === a.id)
  return pk ? `${pk.season} Rd ${pk.round}` : 'Pick'
}

function makeOffer(
  world: World,
  kind: DeadlineOffer['kind'],
  partnerId: string,
  give: TradeAsset[],
  get: TradeAsset[],
  idx: number,
): DeadlineOffer {
  const abbr = world.byId[partnerId]?.abbr ?? partnerId
  const giveStr = give.map((a) => deadlineAssetName(world, a)).join(' + ')
  const getStr = get.map((a) => deadlineAssetName(world, a)).join(' + ')
  const headline =
    kind === 'sell' ? `${abbr} call about ${giveStr}` : `${abbr} offer you ${getStr}`
  const blurb =
    kind === 'sell'
      ? `A contender wants your veteran for the stretch run. They put ${getStr} on the table.`
      : `They're selling a rental. The asking price is ${giveStr}.`
  return { id: `dl_${world.season}_${world.week}_${kind}_${partnerId}_${idx}`, partnerId, kind, give, get, headline, blurb }
}

/**
 * The offers the league sends your club on deadline day. Every package is a
 * deal `evaluateTrade` already accepts by hand, so accepting one never needs a
 * second negotiation. Deterministic and read-only — nothing moves until you say
 * yes.
 */
export function buildDeadlineOffers(world: World, userTeamId: string): DeadlineOffer[] {
  const userTeam = world.byId[userTeamId]
  if (!userTeam || userTeam.tier !== 'NFL') return []
  const { contenders, sellers } = deadlineRoles(world)
  const contenderSet = new Set(contenders)
  const sellerSet = new Set(sellers)
  const userContends = contenderSet.has(userTeamId)
  const offers: DeadlineOffer[] = []

  // SELL — a contender calls about one of your veterans. A club that is itself
  // contending only moves a 30+ player on a short deal; a seller is open for
  // business across the whole veteran core.
  const roster = world.roster[userTeamId] ?? []
  const vets = roster
    .filter((p) => p.age >= 27 && unscaleOvr(p.ovr) >= 74)
    .sort((a, b) => playerTradeValue(b) - playerTradeValue(a) || a.id.localeCompare(b.id))
  const sellPool = (userContends ? vets.filter((p) => p.age >= 30 && p.contract.years <= 2) : vets).slice(0, 6)
  let sells = 0
  for (const p of sellPool) {
    if (sells >= 2) break
    const deals = findDeals(world, userTeamId, p.id)
    if (!deals.length) continue
    const ranked = [...deals].sort(
      (a, b) => b.userValue - a.userValue || a.partnerId.localeCompare(b.partnerId),
    )
    const best = ranked.find((d) => contenderSet.has(d.partnerId)) ?? ranked[0]
    offers.push(makeOffer(world, 'sell', best.partnerId, [{ kind: 'player', id: p.id }], best.get, offers.length))
    sells++
  }

  // BUY — a seller offers you a rental for draft capital (contenders only).
  if (userContends) {
    const targets = world.teams
      .filter((t) => sellerSet.has(t.id) && t.id !== userTeamId)
      .flatMap((t) => (world.roster[t.id] ?? []).map((p) => ({ teamId: t.id, p })))
      .filter(({ p }) => p.age >= 28 && unscaleOvr(p.ovr) >= 78 && p.contract.years <= 2)
      .sort((a, b) => playerTradeValue(b.p) - playerTradeValue(a.p) || a.p.id.localeCompare(b.p.id))
      .slice(0, 6)
    let buys = 0
    for (const { p } of targets) {
      if (buys >= 2) break
      if (offers.some((o) => o.get.some((a) => a.id === p.id))) continue
      const pkgs = findPackagesFor(world, userTeamId, p.id)
      if (!pkgs.length) continue
      const pkg = pkgs.find((o) => o.give.every((a) => a.kind === 'pick')) ?? pkgs[0]
      offers.push(makeOffer(world, 'buy', pkg.partnerId, pkg.give, [{ kind: 'player', id: p.id }], offers.length))
      buys++
    }
  }

  return offers.slice(0, 4)
}

/** Would this club still fit under the cap after the deal (this season)? */
function capFits(world: World, teamId: string, give: TradeAsset[], get: TradeAsset[]): boolean {
  const roster = world.roster[teamId] ?? []
  const hit = (a: TradeAsset) => (a.kind === 'player' ? findPlayer(world, a.id)?.contract.capHit ?? 0 : 0)
  const used =
    roster.reduce((s, p) => s + p.contract.capHit, 0) +
    (world.deadMoney[teamId] ?? 0) +
    get.reduce((s, a) => s + hit(a), 0) -
    give.reduce((s, a) => s + hit(a), 0)
  return used <= capForSeason(world.season) * 0.99
}

/**
 * OPT-IN: the league's own deadline flurry. Contenders buy veterans from sellers
 * for draft capital, exactly as `evaluateTrade` prices it, and the moves are
 * reported to the inbox. Changes league rosters (and so sim results), which is
 * why it never runs unless the user turns it on. Returns how many deals landed.
 */
export function runDeadlineAI(world: World, userTeamId: string): number {
  const { contenders, sellers } = deadlineRoles(world)
  const buyerPool = contenders.filter((id) => id !== userTeamId)
  const sellerPool = sellers.filter((id) => id !== userTeamId)
  if (!buyerPool.length || !sellerPool.length) return 0
  let made = 0
  const used = new Set<string>()
  for (let i = 0; i < 16 && made < 3; i++) {
    const salt = world.season * 131 + world.week * 17 + i * 7
    const sellerId = sellerPool[hash32(`dl-seller-${i}`, salt) % sellerPool.length]
    const buyerId = buyerPool[hash32(`dl-buyer-${i}`, salt) % buyerPool.length]
    if (sellerId === buyerId) continue
    const targets = (world.roster[sellerId] ?? [])
      .filter((p) => p.age >= 28 && unscaleOvr(p.ovr) >= 76 && unscaleOvr(p.ovr) <= 92 && p.contract.years <= 2)
      .sort((a, b) => playerTradeValue(b) - playerTradeValue(a) || a.id.localeCompare(b.id))
    const target = targets.find((p) => !used.has(p.id))
    if (!target) continue
    const pkgs = findPackagesFor(world, buyerId, target.id)
    if (!pkgs.length) continue
    const pkg = pkgs.find((o) => o.give.some((a) => a.kind === 'pick')) ?? pkgs[0]
    const get: TradeAsset[] = [{ kind: 'player', id: target.id }]
    if (!capFits(world, buyerId, pkg.give, get)) continue
    executeTrade(world, buyerId, sellerId, pkg.give, get)
    used.add(target.id)
    const buyer = world.byId[buyerId]
    const seller = world.byId[sellerId]
    world.news.unshift({
      id: `deadlineai_${world.season}_${made}_${target.id}`,
      week: world.week,
      season: world.season,
      category: 'Trade',
      headline: `${buyer.abbr} buy ${target.name} at the deadline`,
      body: `${buyer.name} send ${pkg.give.map((a) => deadlineAssetName(world, a)).join(' + ')} to ${seller.name} for ${target.name} (${target.pos}, ${target.ovr}). A contender paying up for the stretch run.`,
      read: false,
    })
    made++
  }
  return made
}

/** Announce deadline day in the inbox. */
export function deadlineNewsItem(world: World, career: CareerState, offers: DeadlineOffer[]): void {
  const has = offers.length
  world.news.unshift({
    id: `deadline_${world.season}`,
    week: world.week,
    season: world.season,
    category: 'Trade',
    headline: has ? 'Trade deadline day: the phones are ringing' : 'Trade deadline day passes quietly',
    body: has
      ? `${has} club${has === 1 ? '' : 's'} have called about your roster. Answer before the week is out — the market closes when you advance.`
      : 'The deadline came and went without a serious offer for your club. The contenders did their shopping elsewhere.',
    teamId: career.teamId,
    read: false,
  })
}

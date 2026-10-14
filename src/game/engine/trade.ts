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
import { negotiationTradeMargin } from './skills'
import { unscaleOvr } from './ovrScale'
import { marketAAV, remainingContractValue } from './cap'

export interface TradeAsset {
  kind: 'player' | 'pick'
  id: string
}

/**
 * What a position is worth on the trade market. Derived from NFL history
 * (backlog 399): the modern top-10 APY share of the cap at each position,
 * convexity-adjusted, times how the trade market has actually priced the
 * position relative to its pay rank. Anchored so a mid first-round pick ≈ 1,300
 * and QB keeps the old 2.2 — a franchise QB is not obtainable for picks alone,
 * an elite receiver / edge / corner costs a first and then some, and backs,
 * off-ball 'backers, interior linemen and specialists fetch little.
 *
 * Source: ~/gridiron-work/logs/tradevalue-targets.{out,json} (nflverse trades +
 * draft_picks + players, OverTheCap historical contracts).
 */
export const POSITION_TRADE_VALUE: Record<string, number> = {
  QB: 2.2, WR: 1.38, DE: 1.06, DT: 1.05, CB: 1.03, OT: 0.97, S: 0.97,
  TE: 0.62, RB: 0.47, OG: 0.43, LB: 0.36, C: 0.3, K: 0.1, P: 0.08, FB: 0.07,
}

/**
 * Where each position's trade value starts to decline and how fast, from the
 * same study: the onset is the midpoint of (a) the age at which trade returns
 * fall off and (b) the age at which a player's own pay drops below 85% of his
 * peak (within-player, so quality is controlled). Backs and corners fade
 * earliest, quarterbacks and specialists hold longest.
 */
const POSITION_AGE: Record<string, { start: number; rate: number }> = {
  QB: { start: 32, rate: 0.1 }, WR: { start: 29.5, rate: 0.14 }, DE: { start: 28.5, rate: 0.12 },
  DT: { start: 30.4, rate: 0.12 }, CB: { start: 26.6, rate: 0.16 }, OT: { start: 30, rate: 0.12 },
  S: { start: 29.4, rate: 0.12 }, TE: { start: 29, rate: 0.11 }, RB: { start: 26.1, rate: 0.16 },
  OG: { start: 30, rate: 0.13 }, LB: { start: 30.9, rate: 0.11 }, C: { start: 29, rate: 0.12 },
  FB: { start: 28, rate: 0.14 }, K: { start: 33, rate: 0.06 }, P: { start: 29, rate: 0.06 },
}

/** Strength of the contract-surplus term (backlog 399). */
const SURPLUS = { k: 0.45, lo: 0.65, hi: 1.5 }

/**
 * Contract surplus: value ≈ on-field worth − remaining cap cost. A cheap rookie
 * deal adds value (up to ×1.5), a deal above market subtracts (down to ×0.65).
 * The ratio is symmetric so it can never swamp the rating curve. Individual
 * only — his own rating, age and contract, never a club average.
 */
export function contractSurplusMultiplier(p: Player): number {
  const c = p.contract
  if (!c || !Number.isFinite(c.annual) || (c.years ?? 0) <= 0) return 1
  const yearsLeft = Math.max(1, c.years)
  const worth = marketAAV(p.ovr, p.pos, p.age) * yearsLeft
  const cost = remainingContractValue(c)
  if (worth <= 0 && cost <= 0) return 1
  const ratio = Math.max(-1, Math.min(1, (worth - cost) / Math.max(worth, cost, 1)))
  return Math.max(SURPLUS.lo, Math.min(SURPLUS.hi, 1 + SURPLUS.k * ratio))
}

/**
 * Present value of a player on the trade chart (a mid first-round pick ≈ 1,300).
 * Young players are valued at the rating they are expected to grow into; the
 * rating curve is steep at the top (a 99 is worth about twice a 90); value
 * holds through a player's prime and fades smoothly once his position's
 * data-derived decline age arrives; then it is scaled by what the position is
 * worth and by his contract surplus.
 */
export function playerTradeValue(p: Player): number {
  const grow = p.age <= 22 ? 0.6 : p.age === 23 ? 0.45 : p.age === 24 ? 0.3 : p.age === 25 ? 0.15 : 0
  // L12.15 S2: value the player on the old (rank) scale so the same rank keeps
  // the same trade value after the OVR remap.
  const ovrRaw = unscaleOvr(p.ovr)
  const potRaw = unscaleOvr(p.pot)
  const eff = ovrRaw + Math.max(0, potRaw - ovrRaw) * grow
  const curve = Math.pow(Math.max(eff - 50, 1) / 10, 3.5)
  const d = POSITION_AGE[p.pos] ?? { start: 29, rate: 0.13 }
  const prime = p.age <= 24 ? 1.15 : Math.max(1, 1.15 - 0.05 * (p.age - 24))
  const ageMul = p.age <= d.start ? prime : Math.max(0.12, 1 - d.rate * (p.age - d.start))
  return Math.round(curve * ageMul * (POSITION_TRADE_VALUE[p.pos] ?? 1) * contractSurplusMultiplier(p) * 14.7)
}

/**
 * The draft whose picks are "next" for trade value. After that draft has been held
 * (offseason, draft complete) the next one is a year later, and the spent year's
 * picks are no longer tradeable.
 */
export function upcomingDraftSeason(world: World): number {
  return world.season + (world.phase === 'offseason' && world.draftState?.complete ? 2 : 1)
}

/** Picks that can still change hands (drafts not yet held). */
export function isTradeablePick(world: World, pick: DraftPick): boolean {
  return pick.season >= upcomingDraftSeason(world)
}

/** Discount on a pick's value by how many drafts away it is (L11.5 Q11). */
export function futurePickFactor(yearsAway: number): number {
  if (yearsAway <= 0) return 1
  if (yearsAway === 1) return 0.8
  return 0.65
}

/**
 * The draft-pick value chart, in points, keyed by overall draft slot: the classic
 * Jimmy Johnson / Dallas chart. It is the reference the nflverse draft-trade
 * study (backlog 399) reconciles its pick packages against — see
 * ~/gridiron-work/logs/tradevalue-targets.out ("PICK CHART REFERENCE"). A real
 * chart is steep: #1 is 3,000 points and #32 is 590, so a first overall is worth
 * about five late firsts. Sparse entries are linearly interpolated, so any slot
 * 1–256 lands on the curve.
 */
export const PICK_VALUE_CHART: Record<number, number> = {
  1: 3000, 2: 2600, 3: 2200, 4: 1800, 5: 1700, 6: 1600, 7: 1500, 8: 1400, 9: 1350, 10: 1300,
  11: 1250, 12: 1200, 13: 1150, 14: 1100, 15: 1050, 16: 1000, 17: 950, 18: 900, 19: 875, 20: 850,
  21: 800, 22: 780, 23: 760, 24: 740, 25: 720, 26: 700, 27: 680, 28: 660, 29: 640, 30: 620, 31: 600, 32: 590,
  33: 580, 34: 560, 40: 500, 48: 420, 56: 340, 64: 270,
  65: 265, 72: 230, 80: 190, 88: 150, 96: 116,
  102: 92, 110: 74, 120: 54, 130: 42, 137: 37.5,
  140: 37, 150: 31.4, 160: 27.4, 170: 23.4, 180: 19,
  181: 18.6, 190: 15, 200: 11, 210: 7, 218: 3.8,
  219: 3, 230: 1, 240: 1, 256: 1,
}

const CHART_SLOTS = Object.keys(PICK_VALUE_CHART).map(Number).sort((a, b) => a - b)
const CHART_MAX = CHART_SLOTS[CHART_SLOTS.length - 1]

/** Chart points for one overall draft slot (interpolated between published points). */
export function chartPickValue(overall: number): number {
  const n = Math.max(1, Math.min(CHART_MAX, overall))
  let i = 0
  while (i < CHART_SLOTS.length - 2 && CHART_SLOTS[i + 1] < n) i++
  const lo = CHART_SLOTS[i]
  const hi = CHART_SLOTS[i + 1]
  if (n <= lo) return PICK_VALUE_CHART[lo]
  const pts = PICK_VALUE_CHART[lo] + ((n - lo) / (hi - lo)) * (PICK_VALUE_CHART[hi] - PICK_VALUE_CHART[lo])
  return Math.max(1, Math.round(pts))
}

export interface PickSlot {
  /** Overall draft slot, 1-based (fractional when projected). */
  overall: number
  /** True when the order is built (`world.draftPickIds`), false when projected. */
  known: boolean
}

/** Rank of every NFL club by projected draft position (worst first), cached per week. */
const slotCache = new WeakMap<World, { stamp: string; rank: Map<string, number> }>()
function projectedRanks(world: World): Map<string, number> {
  const stamp = `${world.season}:${world.week}:${world.phase}`
  let c = slotCache.get(world)
  if (!c || c.stamp !== stamp) {
    // Mirrors `computeDraftOrder` (fewest wins first, then most points allowed).
    const order = world.teams
      .filter((t) => t.tier === 'NFL')
      .map((t) => ({ id: t.id, rec: world.standings[t.id] }))
      .sort((a, b) => a.rec.wins - b.rec.wins || b.rec.pointsAgainst - a.rec.pointsAgainst)
    c = { stamp, rank: new Map(order.map((t, i) => [t.id, i + 1])) }
    slotCache.set(world, c)
  }
  return c.rank
}

/**
 * Which slot a pick occupies: its real overall number when the draft order is
 * already built (`world.draftPickIds` — set once the regular season is over and
 * read right through the draft), otherwise a projection from the original
 * club's current standing, regressed toward the middle of the round the further
 * out the pick is. A comp pick always sits at the end of its round.
 */
export function pickSlot(world: World, pick: DraftPick): PickSlot {
  const ids = world.draftPickIds
  if (ids?.length) {
    const i = ids.indexOf(pick.id)
    if (i >= 0) return { overall: i + 1, known: true }
  }
  if (pick.comp) return { overall: (pick.round - 1) * 32 + 32.5, known: false }
  const rank = projectedRanks(world).get(pick.originalTeam) ?? 16.5
  const yearsAway = Math.max(1, pick.season - upcomingDraftSeason(world))
  // Regress toward the middle of the round: a club's record two or three drafts
  // out says far less about the slot than its record one draft out does.
  const w = 1 / (1 + 0.7 * (yearsAway - 1))
  return { overall: (pick.round - 1) * 32 + 16.5 + (rank - 16.5) * w, known: false }
}

/** Human label for a pick asset with its slot, e.g. "2027 Rd 1 #1 (NYJ)". */
export function pickAssetLabel(world: World, pick: DraftPick): string {
  const abbr = world.byId[pick.originalTeam]?.abbr ?? pick.originalTeam
  const slot = pickSlot(world, pick)
  const num = Math.min(CHART_MAX, Math.max(1, Math.round(slot.overall)))
  return `${pick.season} Rd ${pick.round} ${slot.known ? '#' : '~#'}${num}${pick.comp ? ' comp' : ''} (${abbr})`
}

/**
 * Trade-chart value of a pick at its actual (or projected) slot, then discounted
 * by how many drafts away it is: this draft ×1.0, next ×0.8, the one after ×0.65
 * (L11.5 Q11). Comp picks carry a small further haircut.
 */
export function pickTradeValue(world: World, pick: DraftPick): number {
  const base = chartPickValue(pickSlot(world, pick).overall)
  const factor = futurePickFactor(pick.season - upcomingDraftSeason(world))
  const value = base * factor
  return pick.comp ? Math.round(value * 0.7) : Math.round(value)
}

function findPlayer(world: World, id: string): Player | undefined {
  return world.players.find((p) => p.id === id)
}
function findPick(world: World, id: string): DraftPick | undefined {
  return world.draftPicks.find((p) => p.id === id)
}

/**
 * Chart value of an asset, read the same way by both clubs: `playerTradeValue`
 * (rating × age × position × contract surplus) or the pick chart. Symmetric —
 * the partner's own read is applied by `partnerValue` on top.
 */
export function assetValue(world: World, a: TradeAsset): number {
  if (a.kind === 'player') {
    const p = findPlayer(world, a.id)
    return p ? playerTradeValue(p) : 0
  }
  const pk = findPick(world, a.id)
  return pk ? pickTradeValue(world, pk) : 0
}

const NEED_TARGET: Record<string, number> = {
  QB: 3, RB: 3, FB: 1, WR: 6, TE: 3, OT: 4, OG: 4, C: 2, DE: 4, DT: 4, LB: 6, CB: 6, S: 4, K: 1, P: 1,
}

/** How badly a team needs a position, 0 (stocked) to 1 (empty). */
function needFactor(world: World, teamId: string, pos: Position): number {
  const roster = world.roster[teamId] ?? []
  const have = roster.filter((p) => p.pos === pos).length
  const target = NEED_TARGET[pos] ?? 3
  return Math.max(0, Math.min(1, (target - have) / target))
}

/** Is this club rebuilding (values youth/picks) or win-now (values veterans)? */
/**
 * A club is rebuilding when its roster is in the league's weakest third (top-22
 * average on the old/sim scale) — not by a coin flip on its name, so a strong
 * club never sells its stars like a rebuilder. Cached per world and week.
 */
const rebuildCache = new WeakMap<World, { stamp: string; ids: Set<string> }>()
function isRebuilding(world: World, partnerId: string): boolean {
  const stamp = `${world.season}:${world.week}:${world.phase}`
  let c = rebuildCache.get(world)
  if (!c || c.stamp !== stamp) {
    const strength = (id: string) => {
      const top = [...(world.roster[id] ?? [])].sort((a, b) => b.ovr - a.ovr).slice(0, 22)
      return top.length ? top.reduce((t, p) => t + unscaleOvr(p.ovr), 0) / top.length : 0
    }
    const ranked = world.teams
      .filter((t) => (world.roster[t.id]?.length ?? 0) > 0)
      .map((t) => ({ id: t.id, s: strength(t.id) }))
      .sort((a, b) => a.s - b.s || a.id.localeCompare(b.id))
    c = { stamp, ids: new Set(ranked.slice(0, Math.round(ranked.length / 3)).map((t) => t.id)) }
    rebuildCache.set(world, c)
  }
  return c.ids.has(partnerId)
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
  // A club pays up for a position of need — and the need premium is worth more
  // where the position itself is valuable (a QB-needy club outbids an
  // off-ball-LB-needy club for its man).
  const needWeight = 0.18 * Math.max(0.5, Math.min(1.6, POSITION_TRADE_VALUE[p.pos] ?? 1))
  const need = 1 + needFactor(world, partnerId, p.pos) * needWeight
  // Stars are hard to pry away: a club's top-3 players carry a premium.
  const roster = world.roster[partnerId] ?? []
  const rank = [...roster].sort((x, y) => y.ovr - x.ovr).findIndex((x) => x.id === p.id)
  const starPremium = rank >= 0 && rank < 3 ? 1.45 : 1
  // Nobody hands over the quarterback: a club's starting QB carries a steep
  // premium (franchise QBs — 85+ — the steepest), as in real NFL trades.
  let qbPremium = 1
  if (p.pos === 'QB') {
    const qbs = roster.filter((x) => x.pos === 'QB').sort((x, y) => y.ovr - x.ovr)
    if (qbs[0]?.id === p.id) qbPremium = unscaleOvr(p.ovr) >= 85 ? 1.7 : unscaleOvr(p.ovr) >= 78 ? 1.4 : 1.15
  }
  // Acquiring: a club with no passer of that calibre pays a starter-upgrade
  // premium, which is how a QB-needy team ends up handing over multiple firsts.
  const own = p.teamId === partnerId
  let qbNeed = 1
  if (p.pos === 'QB' && !own && unscaleOvr(p.ovr) >= 80) {
    const best = roster.filter((x) => x.pos === 'QB').sort((x, y) => y.ovr - x.ovr)[0]
    if (!best || unscaleOvr(best.ovr) < unscaleOvr(p.ovr)) qbNeed = 1.25
  }
  // Elite players are rare on the trade market (user, 2026-10-09): a club's
  // 97-99 cornerstone is effectively off the table unless it is rebuilding and
  // he is 29+; 93-96 and 90-92 carry steep premiums on top of the rest.
  // Only for the club's OWN stars — what it is asked to give up, not what it receives.
  const elitePremium = !own ? 1 : p.ovr >= 97 ? (rebuild && p.age >= 29 ? 2.4 : 6) : p.ovr >= 93 ? 2.0 : p.ovr >= 90 ? 1.6 : 1
  return base * ageMul * need * Math.max(starPremium, qbPremium, qbNeed, elitePremium)
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
  userNegotiation?: number,
): TradeVerdict {
  const rebuild = isRebuilding(world, partnerId)
  const theyReceive = give.reduce((s, a) => s + partnerValue(world, partnerId, a, rebuild), 0)
  const theyGive = get.reduce((s, a) => s + partnerValue(world, partnerId, a, rebuild), 0)
  const rawRatio = theyGive > 0 ? theyReceive / theyGive : theyReceive > 0 ? 99 : 1
  // A touch of front-office personality, deterministic per pairing.
  const bias = ((hash32(partnerId + userTeamId, 5) % 9) - 4) / 100
  const ratio = rawRatio - bias
  // L12.11: the user's own Negotiation skill buys a little leeway (up to +2%).
  const margin = userNegotiation == null ? 0 : negotiationTradeMargin(userNegotiation)

  let verdict: TradeVerdict['verdict'] = 'reject'
  if (ratio >= 1.0 - margin) verdict = 'accept'
  else if (ratio >= 0.9 - margin) verdict = 'close'

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

export interface DealOffer {
  partnerId: string
  get: TradeAsset[]
  give: TradeAsset[]
  theyGive: number
  theyReceive: number
  userValue: number
  summary: string
}

/** Human summary of a package, e.g. "BUF: Greg Rousseau (DE, 88) + 2027 Rd 3". */
function dealSummary(world: World, partnerId: string, get: TradeAsset[]): string {
  const abbr = world.byId[partnerId]?.abbr ?? partnerId
  const parts = get.map((a) => {
    if (a.kind === 'player') {
      const p = findPlayer(world, a.id)
      return p ? `${p.name} (${p.pos}, ${p.ovr})` : 'Player'
    }
    const pk = findPick(world, a.id)
    return pk ? pickAssetLabel(world, pk) : 'Pick'
  })
  return `${abbr}: ${parts.join(' + ')}`
}

/**
 * Shop one of your players (or picks) around the league: the best acceptable package from
 * each club, best first (max 6). Deterministic. Every offer is a deal
 * `evaluateTrade` already accepts by hand — this only searches.
 */
export function findDeals(world: World, userTeamId: string, assetId: string, userNegotiation?: number): DealOffer[] {
  // Shop a player or one of your draft picks (pick ids live in world.draftPicks).
  const give: TradeAsset[] = [{ kind: findPick(world, assetId) ? 'pick' : 'player', id: assetId }]
  const shoppedValue = assetValue(world, give[0])
  const offers: DealOffer[] = []

  for (const team of world.teams) {
    const partner = team.id
    if (partner === userTeamId) continue

    const partnerRoster = world.roster[partner] ?? []
    const assets: TradeAsset[] = [
      ...partnerRoster.map((p): TradeAsset => ({ kind: 'player', id: p.id })),
      ...world.draftPicks
        .filter((pk) => pk.ownerTeam === partner && isTradeablePick(world, pk))
        .map((pk): TradeAsset => ({ kind: 'pick', id: pk.id })),
    ].sort((a, b) => assetValue(world, b) - assetValue(world, a))

    // Greedy: take the most valuable asset the club will still part with.
    const get: TradeAsset[] = []
    for (const a of assets) {
      if (get.length >= 3) break
      if (a.kind === 'player') {
        const p = findPlayer(world, a.id)
        // Don't strip a club of its last body at a position.
        if (p && partnerRoster.filter((x) => x.pos === p.pos).length <= 1) continue
      }
      const tentative = [...get, a]
      if (evaluateTrade(world, partner, userTeamId, give, tentative, userNegotiation).accepted) get.push(a)
    }
    if (!get.length) continue

    // A club overpays only so far (backlog 399, no free lunches): the package it
    // hands over is capped at 1.35x what the shopped asset is worth, so no club
    // gives away far more raw value than it receives. Dropping an asset can only
    // make the deal easier for the club, so the offer stays valid.
    const offerCap = shoppedValue * 1.35
    let offered = get.reduce((s, a) => s + assetValue(world, a), 0)
    if (offered > offerCap) {
      const byValue = [...get].sort((x, y) => assetValue(world, x) - assetValue(world, y))
      while (get.length > 1 && offered > offerCap) {
        const drop = byValue.shift()
        if (!drop) break
        get.splice(get.indexOf(drop), 1)
        offered -= assetValue(world, drop)
      }
    }

    const userValue = offered
    if (userValue < shoppedValue * 0.5) continue

    const verdict = evaluateTrade(world, partner, userTeamId, give, get, userNegotiation)
    offers.push({
      partnerId: partner,
      get,
      give,
      theyGive: verdict.theyGive,
      theyReceive: verdict.theyReceive,
      userValue,
      summary: dealSummary(world, partner, get),
    })
  }

  offers.sort((a, b) => b.userValue - a.userValue)
  return offers.slice(0, 6)
}

/** Stable identity for a package, so the search can dedupe its candidates. */
function packageKey(assets: TradeAsset[]): string {
  return assets
    .map((a) => `${a.kind}:${a.id}`)
    .sort()
    .join('|')
}

/** Raw value the user is giving up in a package. */
function packageCost(world: World, assets: TradeAsset[]): number {
  return assets.reduce((s, a) => s + assetValue(world, a), 0)
}

/**
 * L12.5 T3: shop the USER around another club. The target belongs to club X;
 * every returned offer is a package of the user's players / picks that
 * `evaluateTrade(world, X, userTeamId, give, [target])` already accepts. Greedy,
 * deterministic, no rng. Sorted by least total value given, at most five.
 */
export function findPackagesFor(world: World, userTeamId: string, assetId: string): DealOffer[] {
  // The target is another club's player or one of its draft picks.
  const targetPick = findPick(world, assetId)
  const targetPlayer = targetPick ? undefined : findPlayer(world, assetId)
  const partnerId = targetPick ? targetPick.ownerTeam : targetPlayer?.teamId
  if (!partnerId || partnerId === userTeamId) return []
  if (targetPick && !isTradeablePick(world, targetPick)) return []
  const target: TradeAsset = { kind: targetPick ? 'pick' : 'player', id: assetId }

  const roster = world.roster[userTeamId] ?? []
  // Never strip the user of his last body at a position (same rule as findDeals).
  // Don't hand back a player at the target's own position unless he's clearly
  // the lesser player (under 60% of the target's value): nobody swaps one star
  // edge rusher for another.
  const targetValue = targetPlayer ? playerTradeValue(targetPlayer) : 0
  const players = [...roster]
    .filter((p) => roster.filter((x) => x.pos === p.pos).length > 1)
    .filter((p) => !targetPlayer || p.pos !== targetPlayer.pos || playerTradeValue(p) < targetValue * 0.6)
    .sort((a, b) => playerTradeValue(a) - playerTradeValue(b) || a.id.localeCompare(b.id))
  const picks = world.draftPicks
    .filter((pk) => pk.ownerTeam === userTeamId && isTradeablePick(world, pk))
    .sort((a, b) => pickTradeValue(world, a) - pickTradeValue(world, b) || a.id.localeCompare(b.id))

  const accepted = (give: TradeAsset[]) => evaluateTrade(world, partnerId, userTeamId, give, [target]).accepted
  const candidates: TradeAsset[][] = []

  // Close a value gap with picks: each step adds the smallest pick that clears
  // what's left, or the biggest one if none does (so a deal is never padded
  // with a first when a third would do).
  const fillWithPicks = (start: TradeAsset[], maxPicks: number): TradeAsset[] | null => {
    const pkg = [...start]
    const pool = [...picks]
    for (let n = 0; n < maxPicks && pool.length; n++) {
      if (accepted(pkg)) return pkg
      const verdict = evaluateTrade(world, partnerId, userTeamId, pkg, [target])
      const gap = verdict.theyGive - verdict.theyReceive
      // Read pick values the way this partner does (rebuilders like picks more).
      const val = (pk: DraftPick) => partnerValue(world, partnerId, { kind: 'pick', id: pk.id }, isRebuilding(world, partnerId))
      let idx = pool.findIndex((pk) => val(pk) >= gap)
      if (idx < 0) idx = pool.length - 1
      pkg.push({ kind: 'pick', id: pool[idx].id })
      pool.splice(idx, 1)
    }
    return accepted(pkg) ? pkg : null
  }

  // 1. Picks only.
  const picksOnly = fillWithPicks([], 4)
  if (picksOnly) candidates.push(picksOnly)

  // 2. One player: the cheapest single player who gets it done on his own.
  for (const p of players) {
    if (accepted([{ kind: 'player', id: p.id }])) {
      candidates.push([{ kind: 'player', id: p.id }])
      break
    }
  }

  // 3. A player short of the price plus the picks that close the gap — tried
  //    for the user's five most valuable players who can't do it alone.
  const shortOnes = players.filter((p) => !accepted([{ kind: 'player', id: p.id }])).slice(-5)
  for (const p of shortOnes) {
    const pkg = fillWithPicks([{ kind: 'player', id: p.id }], 3)
    if (pkg) candidates.push(pkg)
  }

  // 4. Two players, then picks if still short.
  if (shortOnes.length >= 2) {
    const two = shortOnes.slice(-2).map((p) => ({ kind: 'player' as const, id: p.id }))
    const pkg = fillWithPicks(two, 2)
    if (pkg) candidates.push(pkg)
  }

  const seen = new Set<string>()
  const unique: TradeAsset[][] = []
  const sorted = candidates.sort(
    (a, b) => packageCost(world, a) - packageCost(world, b) || packageKey(a).localeCompare(packageKey(b)),
  )
  for (const give of sorted) {
    const key = packageKey(give)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(give)
    if (unique.length >= 5) break
  }

  return unique.map((give) => {
    const verdict = evaluateTrade(world, partnerId, userTeamId, give, [target])
    return {
      partnerId,
      give,
      get: [target],
      theyGive: verdict.theyGive,
      theyReceive: verdict.theyReceive,
      userValue: assetValue(world, target),
      summary: dealSummary(world, userTeamId, give),
    }
  })
}

/**
 * L12.5 T4: the best gettable players at a position. Every other club's players
 * passing the filters, ranked by OVR, each paired with its cheapest acceptable
 * package from `findPackagesFor`. Players no package can land are dropped.
 */
export function findTargetsAtPosition(
  world: World,
  userTeamId: string,
  pos: Position,
  opts: { minOvr?: number; maxAge?: number } = {},
): { player: Player; teamId: string; offer: DealOffer }[] {
  const candidates: { player: Player; teamId: string }[] = []
  for (const team of world.teams) {
    if (team.id === userTeamId) continue
    for (const p of world.roster[team.id] ?? []) {
      if (p.pos !== pos) continue
      if (opts.minOvr != null && p.ovr < opts.minOvr) continue
      if (opts.maxAge != null && p.age > opts.maxAge) continue
      candidates.push({ player: p, teamId: team.id })
    }
  }
  candidates.sort(
    (a, b) =>
      b.player.ovr - a.player.ovr ||
      playerTradeValue(b.player) - playerTradeValue(a.player) ||
      a.player.id.localeCompare(b.player.id),
  )

  const out: { player: Player; teamId: string; offer: DealOffer }[] = []
  // A full market, not just the stars: up to 30 gettable players from the top 60.
  for (const c of candidates.slice(0, 60)) {
    const offers = findPackagesFor(world, userTeamId, c.player.id)
    if (!offers.length) continue
    out.push({ player: c.player, teamId: c.teamId, offer: offers[0] })
    if (out.length >= 30) break
  }
  return out
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

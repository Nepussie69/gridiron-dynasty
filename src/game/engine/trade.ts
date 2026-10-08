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

export interface TradeAsset {
  kind: 'player' | 'pick'
  id: string
}

/**
 * How much a position is worth on the trade market, NFL-style: quarterbacks
 * cost a fortune, edge rushers / tackles / corners / receivers carry a premium,
 * running backs, fullbacks and specialists come cheap.
 */
export const POSITION_TRADE_VALUE: Record<string, number> = {
  QB: 2.2, DE: 1.15, OT: 1.1, WR: 1.05, CB: 1.05, DT: 0.95, TE: 0.85, S: 0.85, LB: 0.85,
  OG: 0.8, C: 0.8, RB: 0.7, FB: 0.35, K: 0.3, P: 0.3,
}
/** Age a player's decline starts, and how fast it runs per year after that. */
const DECLINE: Record<string, { start: number; rate: number }> = {
  QB: { start: 33, rate: 0.1 }, RB: { start: 27, rate: 0.16 }, FB: { start: 28, rate: 0.14 },
  WR: { start: 29, rate: 0.14 }, TE: { start: 29, rate: 0.13 }, OT: { start: 30, rate: 0.12 },
  OG: { start: 30, rate: 0.12 }, C: { start: 30, rate: 0.12 }, DE: { start: 29, rate: 0.13 },
  DT: { start: 29, rate: 0.13 }, LB: { start: 28, rate: 0.14 }, CB: { start: 28, rate: 0.15 },
  S: { start: 29, rate: 0.14 }, K: { start: 35, rate: 0.06 }, P: { start: 35, rate: 0.06 },
}

/**
 * Present value of a player on the trade chart (a mid first-round pick ≈ 1,300).
 * Young players are valued at the rating they are expected to grow into; the
 * rating curve is steep at the top (a 99 is worth about twice a 90); value
 * holds through a player's prime and fades smoothly once his position's decline
 * age arrives; then it is scaled by what the position is worth.
 */
export function playerTradeValue(p: Player): number {
  const grow = p.age <= 22 ? 0.6 : p.age === 23 ? 0.45 : p.age === 24 ? 0.3 : p.age === 25 ? 0.15 : 0
  const eff = p.ovr + Math.max(0, p.pot - p.ovr) * grow
  const curve = Math.pow(Math.max(eff - 50, 1) / 10, 3.5)
  const d = DECLINE[p.pos] ?? { start: 29, rate: 0.14 }
  const prime = p.age <= 24 ? 1.15 : Math.max(1, 1.15 - 0.05 * (p.age - 24))
  const ageMul = p.age <= d.start ? prime : Math.max(0.12, 1 - d.rate * (p.age - d.start))
  return Math.round(curve * ageMul * (POSITION_TRADE_VALUE[p.pos] ?? 1) * 14.7)
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
 * Trade-chart value of a pick, estimated at the middle of its round. Future
 * picks are discounted by distance: next draft ×1.0, two drafts ×0.8, three
 * drafts ×0.65. Pass the upcoming draft's season (`world.season + 1`) to apply
 * that discount; callers that omit it get the undiscounted chart value.
 */
export function pickTradeValue(pick: DraftPick, upcomingDraftSeason?: number): number {
  const overall = (pick.round - 1) * 32 + 16
  const base = Math.max(1, Math.round(3000 * Math.pow(0.945, overall - 1)))
  const factor = upcomingDraftSeason ? futurePickFactor(pick.season - upcomingDraftSeason) : 1
  const value = base * factor
  return pick.comp ? Math.round(value * 0.7) : Math.round(value)
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
  return pk ? pickTradeValue(pk, upcomingDraftSeason(world)) : 0
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
  // Nobody hands over the quarterback: a club's starting QB carries a steep
  // premium (franchise QBs — 85+ — the steepest), as in real NFL trades.
  let qbPremium = 1
  if (p.pos === 'QB') {
    const qbs = roster.filter((x) => x.pos === 'QB').sort((x, y) => y.ovr - x.ovr)
    if (qbs[0]?.id === p.id) qbPremium = p.ovr >= 85 ? 1.7 : p.ovr >= 78 ? 1.4 : 1.15
  }
  return base * ageMul * need * Math.max(starPremium, qbPremium)
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
  const rebuild = isRebuilding(partnerId)
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
    return pk ? `${pk.season} Rd ${pk.round}` : 'Pick'
  })
  return `${abbr}: ${parts.join(' + ')}`
}

/**
 * Shop one of your players around the league: the best acceptable package from
 * each club, best first (max 6). Deterministic. Every offer is a deal
 * `evaluateTrade` already accepts by hand — this only searches.
 */
export function findDeals(world: World, userTeamId: string, playerId: string, userNegotiation?: number): DealOffer[] {
  const give: TradeAsset[] = [{ kind: 'player', id: playerId }]
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

    const userValue = get.reduce((s, a) => s + assetValue(world, a), 0)
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
export function findPackagesFor(world: World, userTeamId: string, playerId: string): DealOffer[] {
  const targetPlayer = findPlayer(world, playerId)
  if (!targetPlayer || !targetPlayer.teamId || targetPlayer.teamId === userTeamId) return []
  const partnerId = targetPlayer.teamId
  const target: TradeAsset = { kind: 'player', id: playerId }
  const up = upcomingDraftSeason(world)

  const roster = world.roster[userTeamId] ?? []
  // Never strip the user of his last body at a position (same rule as findDeals).
  // Don't hand back a player at the target's own position unless he's clearly
  // the lesser player (under 60% of the target's value): nobody swaps one star
  // edge rusher for another.
  const targetValue = playerTradeValue(targetPlayer)
  const players = [...roster]
    .filter((p) => roster.filter((x) => x.pos === p.pos).length > 1)
    .filter((p) => p.pos !== targetPlayer.pos || playerTradeValue(p) < targetValue * 0.6)
    .sort((a, b) => playerTradeValue(a) - playerTradeValue(b) || a.id.localeCompare(b.id))
  const picks = world.draftPicks
    .filter((pk) => pk.ownerTeam === userTeamId && isTradeablePick(world, pk))
    .sort((a, b) => pickTradeValue(a, up) - pickTradeValue(b, up) || a.id.localeCompare(b.id))

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
      const val = (pk: DraftPick) => partnerValue(world, partnerId, { kind: 'pick', id: pk.id }, isRebuilding(partnerId))
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
  for (const c of candidates.slice(0, 12)) {
    const offers = findPackagesFor(world, userTeamId, c.player.id)
    if (!offers.length) continue
    out.push({ player: c.player, teamId: c.teamId, offer: offers[0] })
    if (out.length >= 8) break
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

// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #11 — the March free-agency frenzy.
//
// March used to be one click. Here the top of the market goes to a short bidding
// window: rival clubs make priced offers that expire, the best free agents weigh
// money, role, scheme fit, winning and culture by their own priorities, and the
// user works a live board — bid, raise, watch the leader change, lose a guy to a
// contender. Depth players still sign instantly elsewhere (`signFreeAgent`).
//
// Everything in this module is deterministic from the world seed and the current
// season: choices come from `hash32`, never the sim's rng stream. It extends the
// existing market (`marketPrice`), need table (`FA_NEEDS`), culture rules (K2)
// and cap helpers — it does not fork them.
// ─────────────────────────────────────────────────────────────────────────────

import type { Contract, NewsItem, Player, Position } from '../types'
import type { CareerDatabase } from './statsDb'
import type { World } from './generate'
import { generalManager, teamStrength } from './generate'
import { STARTERS, depthAt } from './depth'
import { schemeFit } from './style'
import { clubCulture, discountFromClub, type ClubCulture } from './culture'
import { capForSeason, dealFromAav } from './cap'
import { projectCap, projectedCapHit } from './capPlan'
import { agentStyle } from './negotiation'
import { R2PERSONALITY, playerPriorities, styleOf } from './personality'
import { FA_NEEDS, marketPrice } from './progress'
import { ledgerFreeAgent } from './picks'
import { hash32, clamp } from './rng'
import { gmStyle, type GmStyle } from './gmStyle'

/** How many lots the frenzy runs each March (the top of the market). */
export const FRENZY_LOTS = 40
/** The shortest rated player who can command a bidding war (new-scale OVR). */
export const FRENZY_MIN_OVR = 70
/** The window runs 7 "days". */
export const FRENZY_DAYS = 7
/** An AI offer stays live this many days after it is made. */
export const OFFER_LIFE_DAYS = 2
/** A club may hold at most this many open offers across the whole board. */
export const MAX_OPEN_OFFERS = 3
/** Withdrawing a binding offer costs this many points of that player's trust. */
export const TRUST_PENALTY_POINTS = 5
/** The `log` is trimmed to this many lines to keep the save small. */
export const FRENZY_LOG_LIMIT = 30

export type FrenzyGuarantee = 'low' | 'mid' | 'high'

/** How a lot weighs the five factors (money, role, fit, winning, culture); sums to 1. */
export interface FrenzyPriorities {
  money: number
  role: number
  fit: number
  winning: number
  culture: number
}

export interface FrenzyOffer {
  teamId: string
  years: number
  aav: number
  guarantee: FrenzyGuarantee
  /** Day the offer was made (1-based). */
  madeDay: number
  /** Last day the offer is live. */
  expiresDay: number
  /** This club has used its one raise on this lot. */
  raised?: boolean
  /** A binding offer from the user's club. */
  user?: boolean
}

export type FrenzyLotStatus = 'open' | 'signed' | 'passed' | 'gone' | 'withdrawn'

export interface FrenzyLot {
  playerId: string
  decisionDay: number
  priorities: FrenzyPriorities
  offers: FrenzyOffer[]
  status: FrenzyLotStatus
  signedWith?: string
  /** Day the player actually signed. */
  signedDay?: number
  /** Signed before his decision day because an offer blew past his walk-away line. */
  early?: boolean
  /** Trust points a club has lost with this player (from a withdrawn offer). */
  trust?: Record<string, number>
}

export interface FrenzyState {
  /** League year the window belongs to. */
  season: number
  /** Current day, 0 before the first advance, then 1..7. */
  day: number
  lots: FrenzyLot[]
  log: string[]
}

export interface OfferTerms {
  money: number
  role: number
  fit: number
  winning: number
  culture: number
}

export interface OfferScore {
  total: number
  terms: OfferTerms
  /** The offer's effective percentage of the (undiscounted) market ask. */
  effectivePct: number
}

export interface FrenzyEvent {
  kind: 'bid' | 'raise' | 'walk' | 'renew' | 'expire' | 'sign' | 'early' | 'withdraw' | 'pass'
  lotId: string
  teamId?: string
  day: number
  text: string
}

export interface FrenzyDayResult {
  day: number
  events: FrenzyEvent[]
}

export interface FrenzySummary {
  season: number
  days: number
  signed: number
  early: number
  passed: number
  expiries: number
  signings: { playerId: string; teamId: string; aav: number; years: number }[]
}

// ── Deterministic helpers ────────────────────────────────────────────────────

/** A stable 0..1 draw keyed by the world seed/season plus the choice's coordinates. */
function draw(world: World, tag: string, teamId: string, playerId: string, day = 0): number {
  const salt = (world.seed + world.season * 131 + day * 17) >>> 0
  return hash32(`${tag}|${teamId}|${playerId}|${day}`, salt) / 4294967296
}

function findPlayer(world: World, id: string): Player | undefined {
  return world.players.find((p) => p.id === id)
}

function nflTeams(world: World) {
  return world.teams.filter((t) => t.tier === 'NFL')
}

// ── Priorities ───────────────────────────────────────────────────────────────

/**
 * What this player cares about. Deterministic from his id, age, agent style and
 * the season; the five weights always sum to 1. Shown to the user as words
 * unless the lot is on the shadow board (then exact bars).
 */
export function frenzyPriorities(p: Player, season: number): FrenzyPriorities {
  // REALISM2 #12: with personalities on, the board listens to the man's own
  // priorities instead of the generic template — money, reps, market, winning
  // and the club he can stay with, straight from `personality.playerPriorities`.
  if (R2PERSONALITY.on) {
    const pp = playerPriorities(p, season)
    return normalisePriorities(
      { money: pp.money, role: pp.playingTime, fit: pp.market, winning: pp.winning, culture: pp.loyalty },
      styleOf(p.id) === 'hardball',
    )
  }
  const jitter = (k: number) => ((hash32(p.id, season * 97 + k) % 1000) / 1000 - 0.5) * 0.12
  const w = {
    money: 0.4 + jitter(1),
    role: 0.18 + jitter(2),
    fit: 0.14 + jitter(3),
    winning: 0.16 + jitter(4),
    culture: 0.12 + jitter(5),
  }
  const style = agentStyle(p.id)
  if (style === 'hardball') w.money += 0.22
  else if (style === 'loyal') {
    w.culture += 0.1
    w.role += 0.06
  } else w.fit += 0.04
  // Veterans chase a ring; the young chase reps and the bag.
  if (p.age >= 30) w.winning += 0.1
  if (p.age <= 26) {
    w.role += 0.06
    w.money += 0.04
  }
  return normalisePriorities(w, style === 'hardball')
}

function normalisePriorities(
  w: FrenzyPriorities,
  ensureMoneyLead: boolean,
): FrenzyPriorities {
  const keys = ['money', 'role', 'fit', 'winning', 'culture'] as const
  for (const k of keys) w[k] = Math.max(0.02, w[k])
  let sum = keys.reduce((s, k) => s + w[k], 0)
  for (const k of keys) w[k] /= sum
  // A hardball agent thinks about the money first — never below half.
  if (ensureMoneyLead && w.money < 0.5) {
    const need = 0.5 - w.money
    const others = keys.filter((k) => k !== 'money').sort((a, b) => w[b] - w[a])
    let remaining = need
    for (const k of others) {
      const take = Math.min(w[k] - 0.02, remaining)
      w[k] -= take
      remaining -= take
      if (remaining <= 1e-9) break
    }
    w.money += need - remaining
  }
  sum = keys.reduce((s, k) => s + w[k], 0)
  for (const k of keys) w[k] = Math.round((w[k] / sum) * 1000) / 1000
  return w as FrenzyPriorities
}

/** The star decides late; a depth body decides early. */
function decisionDayFor(p: Player, season: number): number {
  const h = hash32(p.id, season * 31 + 11) % 3
  if (p.ovr >= 90) return 5 + h
  if (p.ovr >= 80) return 3 + h
  return 1 + h
}

/** The score at which this player would sign if it were his decision day. */
export function walkAwayLine(p: Player, season: number): number {
  return 0.64 + ((hash32(p.id, season * 53 + 71) % 100) / 100) * 0.16
}

// ── Context ──────────────────────────────────────────────────────────────────

export interface FrenzyClubInfo {
  id: string
  strength: number
  /** 1 = strongest roster. */
  rank: number
  /** 0..1 winning term (last season's win% blended with the roster rank). */
  winning: number
  culture: ClubCulture
}

export interface FrenzyContext {
  season: number
  clubs: Record<string, FrenzyClubInfo>
}

function winPct(world: World, teamId: string): number {
  const r = world.standings[teamId]
  if (!r) return 0
  const played = r.wins + r.losses + r.ties
  if (!played) return 0
  return (r.wins + r.ties * 0.5) / played
}

/**
 * Per-club inputs the offer score needs: roster strength and rank, last-season
 * winning, and the club's culture profile. Computed once per day and passed in,
 * so a decision never rebuilds 32 profiles per offer.
 */
export function buildFrenzyContext(world: World, db: CareerDatabase): FrenzyContext {
  const teams = nflTeams(world)
  const ranked = teams
    .map((t) => ({ id: t.id, strength: teamStrength(world.roster[t.id] ?? []) }))
    .sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id))
  const n = Math.max(1, ranked.length)
  const clubs: Record<string, FrenzyClubInfo> = {}
  ranked.forEach((r, i) => {
    const rank = i + 1
    clubs[r.id] = {
      id: r.id,
      strength: r.strength,
      rank,
      winning: clamp(0.5 * winPct(world, r.id) + 0.5 * (1 - (rank - 1) / (n - 1)), 0, 1),
      culture: clubCulture(world, db, r.id),
    }
  })
  return { season: world.season, clubs }
}

/** The coordinator's scheme on one side of the ball, or undefined. */
function schemeFor(world: World, teamId: string, side: 'OFF' | 'DEF'): string | undefined {
  const role = side === 'DEF' ? 'Defensive Coordinator' : 'Offensive Coordinator'
  const staff = world.staff[teamId] ?? []
  return (staff.find((m) => m.role === role) ?? staff[0])?.scheme
}

/** 0..1 role term: would he start, rotate, or ride the bench at this club? */
function roleTerm(world: World, teamId: string, p: Player): number {
  const starters = STARTERS[p.pos] ?? 1
  const better = depthAt(world, teamId, p.pos).filter((q) => q.id !== p.id && q.ovr > p.ovr).length
  if (better < starters) return 1
  if (better < starters + 2) return 0.6
  return 0.3
}

// ── Offer scoring ────────────────────────────────────────────────────────────

/**
 * Score one offer for one lot, 0..1, from the player's own priorities.
 *
 * The money term is measured against the **undiscounted** market ask: in the
 * frenzy the K2 culture discount is deliberately NOT taken off the ask, so the
 * discount enters exactly once — through the culture term below. (Taking it off
 * the ask here *and* rewarding culture would double count it; the probe tests
 * that `effectivePct` carries no culture factor.)
 */
export function scoreOffer(
  world: World,
  db: CareerDatabase,
  lot: FrenzyLot,
  offer: FrenzyOffer,
  ctx?: FrenzyContext,
): OfferScore {
  const p = findPlayer(world, lot.playerId)
  const info = (ctx ?? buildFrenzyContext(world, db)).clubs[offer.teamId]
  if (!p) return { total: 0, terms: { money: 0, role: 0, fit: 0, winning: 0, culture: 0 }, effectivePct: 0 }

  const bias = world.era?.positionBias?.[p.pos] ?? 1
  const ask = marketPrice(p, world.season, bias)
  const pctOfAsk = ask > 0 ? (offer.aav / ask) * 100 : 100
  // Mirrors `judgeOffer`: a guarantee sweetens, a long ask on a veteran nags.
  const guaranteeBoost = offer.guarantee === 'low' ? 0 : offer.guarantee === 'mid' ? 4 : 8
  const securityPenalty = p.age >= 29 && offer.years >= 4 ? 3 : 0
  const effectivePct = pctOfAsk + guaranteeBoost - securityPenalty

  const money = clamp((effectivePct - 78) / 44, 0, 1)
  const role = roleTerm(world, offer.teamId, p)
  const side: 'OFF' | 'DEF' = p.side === 'DEF' ? 'DEF' : 'OFF'
  const fit = clamp((schemeFit(p, schemeFor(world, offer.teamId, side), side) - 0.55) / 0.45, 0, 1)
  const winning = info ? info.winning : 0.5
  const disc = discountFromClub(info?.culture ?? clubCulture(world, db, offer.teamId), p)
  const culture = clamp(disc.pct / 6, 0, 1)

  const trust = lot.trust?.[offer.teamId] ?? 0
  const total = clamp(
    lot.priorities.money * money +
      lot.priorities.role * role +
      lot.priorities.fit * fit +
      lot.priorities.winning * winning +
      lot.priorities.culture * culture -
      trust / 100,
    0,
    1,
  )
  return { total, terms: { money, role, fit, winning, culture }, effectivePct }
}

// ── Contracts ────────────────────────────────────────────────────────────────

/** A priced offer without the day bookkeeping, for cap maths. */
export interface FrenzyDealOffer {
  years: number
  aav: number
  guarantee: FrenzyGuarantee
}

/**
 * Build a fresh free-agent contract at the negotiated AAV. Mirrors
 * `buildExtension`'s shape (signing bonus, proration, escalating base,
 * guarantees) so the cap planner and dead-money rules see a real multi-year
 * deal — used by both the user's and the AI's frenzy signings.
 *
 * fastars 478: the deal SHAPE now lives in `cap.dealFromAav`, shared with the AI
 * re-sign pass so an extension and a signing come off one curve. The numbers
 * here are unchanged.
 */
export function buildFreeAgentDeal(p: Player, season: number, offer: FrenzyDealOffer): Contract {
  const guaranteedPct = offer.guarantee === 'low' ? 0.3 : offer.guarantee === 'mid' ? 0.5 : 0.7
  return dealFromAav(p, season, offer.aav, offer.years, guaranteedPct)
}

// ── Opening the board ────────────────────────────────────────────────────────

/** The top unsigned free agents who take bids this March. */
function selectLots(world: World): Player[] {
  return world.freeAgents
    .filter((p) => p.pos !== 'K' && p.pos !== 'P')
    .filter((p) => p.ovr >= FRENZY_MIN_OVR)
    .sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id))
    .slice(0, FRENZY_LOTS)
}

function lotLog(state: FrenzyState, text: string) {
  state.log.unshift(text)
  if (state.log.length > FRENZY_LOG_LIMIT) state.log.length = FRENZY_LOG_LIMIT
}

/**
 * Open the March window: pick the lots and give each a decision day and his
 * priorities. Depth players stay instant-sign through `signFreeAgent`.
 */
export function openFrenzy(world: World, _userTeamId: string | null, db: CareerDatabase): FrenzyState {
  void db
  const state: FrenzyState = { season: world.season, day: 0, lots: [], log: [] }
  for (const p of selectLots(world)) {
    state.lots.push({
      playerId: p.id,
      decisionDay: decisionDayFor(p, world.season),
      priorities: frenzyPriorities(p, world.season),
      offers: [],
      status: 'open',
    })
  }
  lotLog(state, `March opens: ${state.lots.length} players are taking bids.`)
  return state
}

// ── AI bidding ───────────────────────────────────────────────────────────────

function needAt(world: World, teamId: string, pos: Position): number {
  const want = FA_NEEDS[pos]
  if (want == null) return 0
  const counts: Record<string, number> = {}
  for (const p of world.roster[teamId] ?? []) counts[p.pos] = (counts[p.pos] ?? 0) + 1
  return want - (counts[pos] ?? 0)
}

function usedCap(world: World, teamId: string): number {
  const roster = world.roster[teamId] ?? []
  return roster.reduce((s, q) => s + q.contract.capHit, 0) + (world.deadMoney[teamId] ?? 0)
}

/**
 * A club's already-committed money across a horizon: the cap hits of every live
 * offer it is holding. Without this, a club could make three individually
 * affordable bids and breach the cap when all three land. `excludeLotId` drops
 * one lot (used when replacing the user's own offer).
 */
function committedHits(
  world: World,
  state: FrenzyState,
  teamId: string,
  day: number,
  horizon: number,
  excludeLotId?: string,
): number[] {
  const out = new Array<number>(horizon).fill(0)
  for (const lot of state.lots) {
    if (lot.status !== 'open') continue
    if (excludeLotId && lot.playerId === excludeLotId) continue
    for (const o of lot.offers) {
      if (o.teamId !== teamId) continue
      if (!o.user && o.expiresDay < day) continue
      const p = findPlayer(world, lot.playerId)
      if (!p) continue
      const d = buildFreeAgentDeal(p, world.season, o)
      for (let y = 0; y < horizon; y++) out[y] += projectedCapHit(d, y)
    }
  }
  return out
}

/** This year AND next must fit under his own ceiling after the deal and the club's other live offers. */
function canAfford(
  world: World,
  state: FrenzyState,
  p: Player,
  teamId: string,
  offer: FrenzyDealOffer,
  day: number,
  style: GmStyle,
): boolean {
  const roster = world.roster[teamId] ?? []
  const dead = world.deadMoney[teamId] ?? 0
  const cap = capForSeason(world.season)
  // FUTURES #49: how close to the ceiling he will go is his own discipline.
  const ceil = cap * clamp(0.93 + (style.faSpend - 0.85) * 0.07, 0.9, 0.99)
  const deal = buildFreeAgentDeal(p, world.season, offer)
  const [c0, c1] = committedHits(world, state, teamId, day, 2)
  if (usedCap(world, teamId) + c0 + deal.capHit > ceil) return false
  const plan = projectCap(roster, dead, world.season, 2)
  if (plan.years[1] && plan.years[1].space - c1 < projectedCapHit(deal, 1)) return false
  return true
}

function guaranteedFor(world: World, teamId: string, style: GmStyle): FrenzyGuarantee {
  const health = 1 - usedCap(world, teamId) / capForSeason(world.season)
  // A GM who pays over the market also guarantees more of it (gmStyle faSpend).
  const adj = (style.faSpend - 1) * 0.06
  if (health > 0.25 - adj) return 'high'
  if (health > 0.12 - adj) return 'mid'
  return 'low'
}

function yearsFor(p: Player): number {
  if (p.age <= 25) return 4
  if (p.age <= 27) return 3
  if (p.age <= 29) return 2
  return 1
}

/** A priced bid around the market, in HIS hands (gmStyle faSpend scales it). */
function makeBid(world: World, p: Player, teamId: string, day: number, style: GmStyle): FrenzyOffer {
  const bias = world.era?.positionBias?.[p.pos] ?? 1
  const market = marketPrice(p, world.season, bias)
  const d = draw(world, 'bid-amt', teamId, p.id, day)
  // His appetite widens the range: a draft-and-develop club opens under the
  // market, a cap-reckless one over it (still priced off the market, not an
  // average of what anyone else paid).
  const mult = (0.9 + d * 0.25) * clamp(0.85 + (style.faSpend - 0.55) * 0.35, 0.8, 1.25)
  const aav = Math.round((market * mult) / 1e5) * 1e5
  return {
    teamId,
    years: yearsFor(p),
    aav,
    guarantee: guaranteedFor(world, teamId, style),
    madeDay: day,
    expiresDay: day + OFFER_LIFE_DAYS,
  }
}

function openOfferCount(state: FrenzyState, teamId: string, day: number): number {
  let n = 0
  for (const lot of state.lots) {
    if (lot.status !== 'open') continue
    for (const o of lot.offers) if (o.teamId === teamId && (o.user || o.expiresDay >= day)) n++
  }
  return n
}

function leaderOf(world: World, db: CareerDatabase, lot: FrenzyLot, day: number, ctx: FrenzyContext): string | undefined {
  let best: string | undefined
  let bestScore = -1
  for (const o of lot.offers) {
    if (!o.user && o.expiresDay < day) continue
    const s = scoreOffer(world, db, lot, o, ctx).total
    if (s > bestScore) {
      bestScore = s
      best = o.teamId
    }
  }
  return best
}

/**
 * One day of AI bidding: clubs with a hole, the cap room this year and next, and
 * a plausible target bid on the lots; a beaten club raises once or walks; offers
 * are renewed or allowed to lapse. Every choice is a hash draw on
 * (seed, season, day, club, lot) — no rng stream.
 */
export function aiBidDay(
  world: World,
  state: FrenzyState,
  db: CareerDatabase,
  day: number,
  userTeamId: string | null | undefined,
  events: FrenzyEvent[] = [],
): FrenzyEvent[] {
  const ctx = buildFrenzyContext(world, db)
  const teams = nflTeams(world)
  // FUTURES #49: the man in the chair bids. His appetite (gmStyle.ts `faSpend`)
  // sets how likely he is to be in on a lot and how far over the market he will
  // go; his cap discipline sets the ceiling he will bid to. Read once per club.
  const styles = new Map<string, GmStyle>()
  const styleOf = (id: string) => {
    let s = styles.get(id)
    if (s === undefined) {
      s = gmStyle(generalManager(world, id))
      styles.set(id, s)
    }
    return s
  }
  for (const lot of state.lots) {
    if (lot.status !== 'open') continue
    const p = findPlayer(world, lot.playerId)
    if (!p || p.teamId) {
      lot.status = 'gone'
      continue
    }
    const leader = leaderOf(world, db, lot, day, ctx)
    for (const t of teams) {
      if (t.id === userTeamId) continue
      const info = ctx.clubs[t.id]
      if (!info) continue
      const style = styleOf(t.id)
      const existing = lot.offers.find((o) => o.teamId === t.id)
      const live = existing && (existing.user || existing.expiresDay >= day)

      if (existing && live) {
        // A club out of the lead may raise once, or walk away.
        if (!existing.user && leader !== t.id && !existing.raised) {
          // A hungry GM raises more often; a patient one lets it go.
          const r = draw(world, 'raise', t.id, p.id, day)
          if (r < clamp(0.35 + (style.faSpend - 0.55) * 0.5, 0.3, 0.8)) {
            const bump = 1.03 + draw(world, 'raise-amt', t.id, p.id, day) * 0.05
            existing.aav = Math.round((existing.aav * bump) / 1e5) * 1e5
            existing.raised = true
            existing.madeDay = day
            existing.expiresDay = day + OFFER_LIFE_DAYS
            events.push({ kind: 'raise', lotId: p.id, teamId: t.id, day, text: `${t.abbr} raise for ${p.name} to $${(existing.aav / 1e6).toFixed(1)}M` })
          } else {
            lot.offers = lot.offers.filter((o) => o !== existing)
            events.push({ kind: 'walk', lotId: p.id, teamId: t.id, day, text: `${t.abbr} walk away from ${p.name}` })
          }
          continue
        }
        // Otherwise, a stalled club renews an expiring offer or lets it lapse.
        if (!existing.user && existing.expiresDay === day) {
          if (draw(world, 'renew', t.id, p.id, day) < clamp(0.4 + (style.faSpend - 0.55) * 0.3, 0.35, 0.75)) {
            existing.expiresDay = day + OFFER_LIFE_DAYS
            events.push({ kind: 'renew', lotId: p.id, teamId: t.id, day, text: `${t.abbr} stay in on ${p.name}` })
          }
        }
        continue
      }
      if (live) continue

      // A fresh bid: a real need, cap room, and a plausible draw.
      if (needAt(world, t.id, p.pos) <= 0) continue
      if (openOfferCount(state, t.id, day) >= MAX_OPEN_OFFERS) continue
      // Rebuilders chase the young; contenders can chase anyone (esp. stars). A
      // cap-reckless GM will pay a veteran wherever he finishes.
      if (info.rank > 22 && p.age > 28 && style.faSpend < 1.2) continue
      const probe = makeBid(world, p, t.id, day, style)
      if (!canAfford(world, state, p, t.id, probe, day, style)) continue
      let prob = 0.18 + 0.09 * Math.min(needAt(world, t.id, p.pos), 3)
      if (info.rank <= 10) prob += 0.12
      if (p.ovr >= 88 && info.rank > 10 && info.rank <= 22) prob += 0.06
      // Appetite: a spender is in on more lots, a draft-and-develop club on fewer.
      prob *= clamp(0.55 + style.faSpend * 0.45, 0.6, 1.4)
      if (draw(world, 'will-bid', t.id, p.id, day) >= Math.min(prob, 0.8)) continue
      lot.offers.push(probe)
      events.push({ kind: 'bid', lotId: p.id, teamId: t.id, day, text: `${t.abbr} bid $${(probe.aav / 1e6).toFixed(1)}M on ${p.name}` })
    }
  }
  return events
}

// ── Decisions ────────────────────────────────────────────────────────────────

function applySigning(
  world: World,
  state: FrenzyState,
  lot: FrenzyLot,
  offer: FrenzyOffer,
  events: FrenzyEvent[],
  early: boolean,
) {
  const p = world.freeAgents.find((x) => x.id === lot.playerId)
  if (!p) {
    lot.status = 'gone'
    return
  }
  p.teamId = offer.teamId
  p.contract = buildFreeAgentDeal(p, world.season, offer)
  p.origin = { kind: 'freeAgent', season: world.season, by: null, fromTeamId: null }
  ;(world.roster[offer.teamId] ??= []).push(p)
  world.freeAgents = world.freeAgents.filter((x) => x.id !== p.id)
  ledgerFreeAgent(world, offer.teamId, 'gained', p.ovr)
  lot.status = 'signed'
  lot.signedWith = offer.teamId
  lot.signedDay = state.day
  lot.early = early
  const abbr = world.byId[offer.teamId]?.abbr ?? offer.teamId
  events.push({
    kind: early ? 'early' : 'sign',
    lotId: p.id,
    teamId: offer.teamId,
    day: state.day,
    text: `${abbr} sign ${p.name} (${p.pos}, ${p.ovr}) — ${offer.years}yr, $${(offer.aav / 1e6).toFixed(1)}M/yr${early ? ' (took it now)' : ''}`,
  })
}

/**
 * Advance one day: lapse expired offers, run AI bidding, then let every lot
 * whose decision day has arrived sign its best-scoring live offer — or take a
 * blow-away offer early ("take it now", ≥ 10 points past his walk-away line).
 */
export function advanceFrenzyDay(
  world: World,
  state: FrenzyState,
  db: CareerDatabase,
  userTeamId?: string | null,
): FrenzyDayResult {
  state.day = Math.min(state.day + 1, FRENZY_DAYS)
  const day = state.day
  const events: FrenzyEvent[] = []

  // Lapse offers whose window has closed (a resolved lot keeps its offers).
  for (const lot of state.lots) {
    if (lot.status !== 'open') continue
    for (const o of lot.offers) {
      if (o.user || o.expiresDay >= day) continue
      const abbr = world.byId[o.teamId]?.abbr ?? o.teamId
      events.push({ kind: 'expire', lotId: lot.playerId, teamId: o.teamId, day, text: `${abbr}'s offer lapses` })
    }
    lot.offers = lot.offers.filter((o) => o.user || o.expiresDay >= day)
  }

  aiBidDay(world, state, db, day, userTeamId, events)

  const ctx = buildFrenzyContext(world, db)
  for (const lot of state.lots) {
    if (lot.status !== 'open') continue
    const p = findPlayer(world, lot.playerId)
    if (!p || p.teamId) {
      lot.status = 'gone'
      continue
    }
    const live = lot.offers.filter((o) => o.user || o.expiresDay >= day)
    if (!live.length) continue
    let best = live[0]
    let bestScore = -1
    for (const o of live) {
      const s = scoreOffer(world, db, lot, o, ctx).total
      if (s > bestScore) {
        bestScore = s
        best = o
      }
    }
    if (day >= lot.decisionDay) applySigning(world, state, lot, best, events, false)
    else if (bestScore >= walkAwayLine(p, world.season) + 0.1) applySigning(world, state, lot, best, events, true)
  }

  for (const e of events) if (e.kind === 'sign' || e.kind === 'early') lotLog(state, e.text)
  return { day, events }
}

/**
 * Finish the window (called before `runAIFreeAgency` when leaving March, or by
 * the fast path): run out the remaining days, then return every unsigned lot to
 * the free-agent pool for the ordinary market.
 */
export function resolveFrenzy(
  world: World,
  state: FrenzyState,
  db: CareerDatabase,
  userTeamId?: string | null,
): FrenzySummary {
  const events: FrenzyEvent[] = []
  while (state.day < FRENZY_DAYS) {
    const r = advanceFrenzyDay(world, state, db, userTeamId)
    events.push(...r.events)
  }
  let signed = 0
  let early = 0
  let passed = 0
  const signings: FrenzySummary['signings'] = []
  for (const lot of state.lots) {
    if (lot.status === 'signed' && lot.signedWith) {
      signed++
      if (lot.early) early++
      const o = lot.offers.find((x) => x.teamId === lot.signedWith)
      if (o) signings.push({ playerId: lot.playerId, teamId: lot.signedWith, aav: o.aav, years: o.years })
    } else if (lot.status === 'open') {
      lot.status = 'passed'
      passed++
      // fastars 478: the window ran 7 days and he is still unsigned, so the
      // unsigned clock starts now — his ask falls from here on (the same decay
      // the in-season market uses, backlog 408) instead of holding at market
      // until week 1.
      const p = findPlayer(world, lot.playerId)
      if (p) p.faWeeks = Math.max(p.faWeeks ?? 0, 2)
      events.push({ kind: 'pass', lotId: lot.playerId, day: state.day, text: 'no offer he liked — back to the market' })
    }
  }
  const expiries = events.filter((e) => e.kind === 'expire').length
  lotLog(state, `Window closed: ${signed} signed${early ? `, ${early} early` : ''}, ${passed} back to the market.`)
  return { season: state.season, days: state.day, signed, early, passed, expiries, signings }
}

// ── The user's side ──────────────────────────────────────────────────────────

export interface FrenzyOfferCheck {
  ok: boolean
  message: string
}

/**
 * Record a binding offer from the user's club. Raise-only (a lower AAV on a lot
 * he already bid is rejected) and gated on cap room this year and across the
 * three-year projection. The offer never expires, but withdrawing it costs trust
 * (`withdrawFrenzyOffer`).
 */
export function placeFrenzyOffer(
  world: World,
  state: FrenzyState,
  db: CareerDatabase,
  lotId: string,
  offer: FrenzyDealOffer,
  userTeamId: string,
): FrenzyOfferCheck {
  const lot = state.lots.find((l) => l.playerId === lotId)
  if (!lot || lot.status !== 'open') return { ok: false, message: 'That player is no longer taking bids.' }
  const p = world.freeAgents.find((x) => x.id === lotId)
  if (!p) return { ok: false, message: 'That player is no longer available.' }
  if (!world.roster[userTeamId]) return { ok: false, message: 'No roster to sign him to.' }
  const years = clamp(Math.round(offer.years), 1, 5)
  const existing = lot.offers.find((o) => o.teamId === userTeamId && o.user)
  if (existing && offer.aav < existing.aav) {
    return { ok: false, message: `Already in at $${(existing.aav / 1e6).toFixed(1)}M — you can only raise.` }
  }
  const deal = buildFreeAgentDeal(p, world.season, { ...offer, years })
  const roster = world.roster[userTeamId] ?? []
  const dead = world.deadMoney[userTeamId] ?? 0
  const cap = capForSeason(world.season)
  // The club's other live offers count against the room too (this lot excluded,
  // since a raise replaces the old offer rather than adding to it).
  const committed = committedHits(world, state, userTeamId, state.day, 3, lotId)
  const used = roster.reduce((s, q) => s + q.contract.capHit, 0) + dead + committed[0]
  if (used + deal.capHit > cap * 0.99) return { ok: false, message: 'Not enough cap space this year.' }
  const plan = projectCap(roster, dead, world.season, 3)
  for (let y = 1; y < 3; y++) {
    if (plan.years[y] && plan.years[y].space - committed[y] < projectedCapHit(deal, y)) {
      return { ok: false, message: `That deal breaks the ${plan.years[y].season} cap projection.` }
    }
  }
  const next: FrenzyOffer = {
    teamId: userTeamId,
    years,
    aav: Math.round(offer.aav / 1e5) * 1e5,
    guarantee: offer.guarantee,
    madeDay: existing?.madeDay ?? state.day,
    expiresDay: 999,
    user: true,
    raised: existing?.raised,
  }
  if (existing) lot.offers = lot.offers.filter((o) => o !== existing)
  lot.offers.push(next)
  lotLog(state, `You bid $${(next.aav / 1e6).toFixed(1)}M on ${p.name}.`)
  void db
  return { ok: true, message: `Offer submitted: ${years}yr, $${(next.aav / 1e6).toFixed(1)}M/yr.` }
}

/**
 * Withdraw the user's offer on a lot. Binding deals cost trust: the player docks
 * this club `TRUST_PENALTY_POINTS` on every future score.
 */
export function withdrawFrenzyOffer(
  world: World,
  state: FrenzyState,
  lotId: string,
  teamId: string,
): FrenzyOfferCheck {
  const lot = state.lots.find((l) => l.playerId === lotId)
  if (!lot) return { ok: false, message: 'No such lot.' }
  const offer = lot.offers.find((o) => o.teamId === teamId)
  if (!offer) return { ok: false, message: 'You have no offer in on him.' }
  lot.offers = lot.offers.filter((o) => o !== offer)
  lot.trust ??= {}
  lot.trust[teamId] = (lot.trust[teamId] ?? 0) + TRUST_PENALTY_POINTS
  const p = findPlayer(world, lotId)
  lotLog(state, `You pulled your offer for ${p?.name ?? lotId} — he remembers.`)
  return { ok: true, message: 'Offer withdrawn. He will hold it against you.' }
}

export interface FrenzyStanding {
  leader?: string
  /** 1 = leading; 0 = no live offers. */
  rank: number
  verdict: 'leading' | 'close' | 'behind' | 'out'
  gap: number
}

/** Where the user's club sits on a lot: leading, close, behind, or out of it. */
export function frenzyStanding(
  world: World,
  state: FrenzyState,
  db: CareerDatabase,
  lotId: string,
  teamId: string,
): FrenzyStanding {
  const lot = state.lots.find((l) => l.playerId === lotId)
  if (!lot) return { leader: undefined, rank: 0, verdict: 'out', gap: 0 }
  const ctx = buildFrenzyContext(world, db)
  const live = lot.offers.filter((o) => o.user || o.expiresDay >= state.day)
  const scored = live
    .map((o) => ({ id: o.teamId, s: scoreOffer(world, db, lot, o, ctx).total }))
    .sort((a, b) => b.s - a.s)
  const leader = scored[0]?.id
  const mine = scored.find((x) => x.id === teamId)
  if (!mine) return { leader, rank: 0, verdict: 'out', gap: 0 }
  const rank = scored.findIndex((x) => x.id === teamId) + 1
  const gap = rank === 1 ? 0 : (scored[0]?.s ?? 0) - mine.s
  return {
    leader,
    rank,
    verdict: rank === 1 ? 'leading' : gap <= 0.05 ? 'close' : 'behind',
    gap,
  }
}

/** A short news item for the inbox: the big signings and the spurned money. */
export function frenzyNewsItem(world: World, state: FrenzyState): NewsItem {
  const signed = state.lots.filter((l) => l.status === 'signed')
  const big = signed
    .map((l) => {
      const o = l.offers.find((x) => x.teamId === l.signedWith)
      const p = findPlayer(world, l.playerId)
      return { l, o, p }
    })
    .filter((x) => x.o && x.p)
    .sort((a, b) => (b.o!.aav) - (a.o!.aav))
    .slice(0, 3)
  const lines = big.map(({ l, o, p }) => {
    const abbr = world.byId[l.signedWith!]?.abbr ?? l.signedWith
    return `${p!.name} (${p!.pos}, ${p!.ovr}) to ${abbr} at $${(o!.aav / 1e6).toFixed(1)}M/yr`
  })
  const early = signed.filter((l) => l.early).length
  return {
    id: `frenzy_${world.season}`,
    week: world.week,
    season: world.season,
    category: 'Roster',
    headline: `March frenzy: ${signed.length} of the top free agents are off the board`,
    body: lines.length
      ? `The big money: ${lines.join('; ')}.${early ? ` ${early} took the first offer they liked.` : ''} The rest hit the open market.`
      : 'Nobody moved in the March bidding window. The whole board is back on the open market.',
    read: false,
  }
}

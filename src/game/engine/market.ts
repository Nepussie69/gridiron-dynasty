// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #50 — Market & fans.
//
// Every club has a market: the city it draws from (metro population), the seats
// its stadium can sell, and how rabid the following is. Out of those three and
// the season just played come four revenue streams — the gate (attendance ×
// ticket price), jersey sales (each player's OWN popularity × the club's market
// reach), local media & sponsorships, and playoff gates. The total feeds the
// club's money model (engine/staffMarket.ts `staffBudget`) so a big-market club
// hires with more money than a small one.
//
// DETERMINISM. Nothing here draws an rng, so the calibrated play sim and every
// AI-vs-AI result stay byte-identical; fan interest is a hash-and-standings
// read and the only state this module writes is `world.market`. Every effect
// comes from the individual people involved — a player's own OVR, position,
// development tag and production — plus the club's own market data, never a
// league or unit average.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, Player } from '../types'
import type { World } from './generate'
import { NFL_MARKETS, NATIONAL_MEDIA, type ClubMarket } from '../data/markets'
import { clamp, hash32 } from './rng'

/** Fallback market for a club with no data (a college program, an old save). */
const DEFAULT_MARKET: ClubMarket = { abbr: '?', metro: 2.5, capacity: 65000, intensity: 70 }

/** The raw market data for a club. */
export function marketOf(teamId: string): ClubMarket {
  return NFL_MARKETS[teamId] ?? DEFAULT_MARKET
}

// ── Market size ──────────────────────────────────────────────────────────────
const METRO_MIN = 0.33
const METRO_MAX = 19.5

/** Metro population on a 0–100 log scale (0.33M → 0, 19.5M → 100). */
export function metroIndex(metro: number): number {
  const t = (Math.log(Math.max(METRO_MIN, metro)) - Math.log(METRO_MIN)) /
    (Math.log(METRO_MAX) - Math.log(METRO_MIN))
  return clamp(Math.round(t * 100), 0, 100)
}

/**
 * The club's market index (0–100): metro reach blended with fan-base depth. The
 * single number the revenue model scales off. Big city + rabid following is the
 * top; small city + thin following is the floor.
 */
export function marketIndex(teamId: string): number {
  const m = marketOf(teamId)
  return clamp(Math.round(0.62 * metroIndex(m.metro) + 0.38 * m.intensity), 0, 100)
}

/** Market size tier, 1 (micro) – 10 (mega). */
export function marketTier(teamId: string): number {
  return 1 + Math.min(9, Math.floor(marketIndex(teamId) / 10))
}

const TIER_LABEL = ['Micro', 'Small', 'Small', 'Mid', 'Mid', 'Mid', 'Large', 'Large', 'Major', 'Mega', 'Mega']
export function marketLabel(teamId: string): string {
  return TIER_LABEL[marketTier(teamId)] ?? 'Mid'
}

/** A 0.5–2.5 reach multiplier for the market — the spine of the revenue spread. */
function reach(teamId: string): number {
  return 0.5 + marketIndex(teamId) / 50
}

// ── Fan base (interest) ──────────────────────────────────────────────────────
export interface FanSeason {
  season: number
  /** Fan interest at the end of that season (0–100). */
  interest: number
  wins: number
}

export interface FanBase {
  /** Fan interest right now, 0–100. */
  interest: number
  /** Recent seasons, oldest first. */
  history: FanSeason[]
}

export interface SeasonRevenue {
  tickets: number
  jerseys: number
  media: number
  playoffGates: number
  /** Shared national media — equal for every club, shown but never budgeted. */
  national: number
  /** Everything a club keeps locally (excludes the shared national money). */
  local: number
  total: number
  /** Full-price seats sold across the home slate. */
  attendance: number
  /** Home attendance as a share of capacity, 0–1. */
  attendancePct: number
  ticketPrice: number
  homeGames: number
}

export interface MarketState {
  fans: Record<string, FanBase>
  /** The last computed season's revenue, keyed teamId. */
  revenue?: { season: number; byTeam: Record<string, SeasonRevenue> }
  /** Last season's interest per club, for the year-over-year trend. */
  lastInterest?: Record<string, number>
  /** Whether each club made the playoffs last season (drives the fall-off). */
  lastMade?: Record<string, boolean>
}

const HISTORY_CAP = 8

/** The starting fan interest for a club: its own intensity, nudged by prestige. */
export function initialInterest(world: World, teamId: string): number {
  const m = marketOf(teamId)
  const prestige = world.byId[teamId]?.prestige ?? 75
  const jitter = (hash32(`market|${world.seed}|${teamId}`, 51) % 7) - 3
  return clamp(Math.round(m.intensity + (prestige - 75) * 0.25 + jitter), 25, 96)
}

/** The live fan base for a club (built from intensity on a legacy save). */
export function fanBase(world: World, teamId: string): FanBase {
  const existing = world.market?.fans?.[teamId]
  if (existing) return existing
  return { interest: initialInterest(world, teamId), history: [] }
}

/** Fan interest right now, 0–100. */
export function interestNow(world: World, teamId: string): number {
  return fanBase(world, teamId).interest
}

// ── Player popularity ────────────────────────────────────────────────────────
/** How much national attention each position draws. */
const POS_GLAMOUR: Record<string, number> = {
  QB: 15, WR: 8, RB: 8, TE: 5, DE: 6, CB: 5, LB: 4, S: 4, DT: 4, K: 3, P: 2, OT: 2, OG: 2, C: 2, FB: 1,
}

const DEV_GLAMOUR: Record<string, number> = {
  'X-Factor': 11, Superstar: 8, Star: 5, Starter: 2, Depth: 0, Backup: 0,
}

/** Production (last NFL season) as a small popularity bump. */
function productionBonus(p: Player): number {
  const s = (p.stats ?? []).filter((x) => x.level === 'NFL').slice(-1)[0]
  if (!s) return 0
  const raw =
    s.passTD * 1.1 +
    s.passYds / 700 +
    s.rushYds / 350 +
    s.recYds / 350 +
    s.recTD * 0.7 +
    s.defSacks * 0.9 +
    s.defInts * 0.8
  return Math.min(9, raw)
}

/**
 * A player's own popularity, 0–100: his OVR, his position's glamour, his
 * development tag, last year's production, and a stable personal marketing
 * edge (a hash of his id — no rng). The spine of every jersey number here.
 */
export function playerPopularity(p: Player): number {
  const base = (p.ovr - 50) * 1.15
  const jitter = (hash32(p.id, 52) % 11) - 5
  const pop = base + (POS_GLAMOUR[p.pos] ?? 2) + (DEV_GLAMOUR[p.dev] ?? 0) + productionBonus(p) + jitter
  return clamp(Math.round(pop), 5, 97)
}

// ── Ticket price & attendance ────────────────────────────────────────────────
export const TICKET_MIN = 40
export const TICKET_MAX = 400
export const TICKET_STEP = 5

/** The price a club would set on its own: the market's reach sets the ceiling. */
export function defaultTicketPrice(teamId: string): number {
  const raw = 45 + marketIndex(teamId) * 1.15
  return clamp(Math.round(raw / TICKET_STEP) * TICKET_STEP, TICKET_MIN, TICKET_MAX)
}

/** The price in force for a club: the user's set price, else the club default. */
export function ticketPriceFor(career: CareerState | null, teamId: string): number {
  if (career && career.teamId === teamId && typeof career.ticketPrice === 'number') {
    return clamp(career.ticketPrice, TICKET_MIN, TICKET_MAX)
  }
  return defaultTicketPrice(teamId)
}

/** Home games a club plays this season (from the schedule; 8 if none found). */
function homeGames(world: World, teamId: string): number {
  const n = world.schedule.filter((g) => !g.postseason && g.homeId === teamId).length
  return n || 8
}

export interface Attendance {
  capacity: number
  seats: number
  pct: number
}

/**
 * Attendance responds to fan interest and to the price against the club's own
 * fair price: a club whose following is hot fills the building, and jacking
 * the ticket above the market empties seats. Capacity can never be exceeded.
 */
export function attendanceFor(world: World, teamId: string, price?: number): Attendance {
  const m = marketOf(teamId)
  const p = price ?? defaultTicketPrice(teamId)
  const interest = interestNow(world, teamId)
  const fair = defaultTicketPrice(teamId)
  const delta = (p - fair) / fair
  const fill = clamp(0.72 + (interest - 50) * 0.0072 - delta * 0.8, 0.3, 1)
  return { capacity: m.capacity, seats: Math.round(m.capacity * fill), pct: fill }
}

// ── Revenue ──────────────────────────────────────────────────────────────────
/**
 * Local media & sponsorship money: the biggest single swing between markets and
 * the reason a metro club out-earns a small one (TV/radio, naming rights,
 * suites and club seats all scale with the city). Steep in the market index.
 */
function mediaMoney(teamId: string): number {
  const m = marketIndex(teamId) / 100
  return Math.round(15_000_000 + Math.pow(m, 2.9) * 360_000_000)
}

/** A player's own jersey line: convex in his popularity, so the stars carry it. */
export function playerJerseySales(p: Player): number {
  return Math.round(Math.pow(playerPopularity(p) / 100, 2.1) * 9_000_000)
}

/** The jersey line: a market floor plus every genuine draw's own sales. */
function jerseyMoney(world: World, teamId: string): number {
  const roster = world.roster[teamId] ?? []
  let starSum = 0
  for (const p of roster) {
    // Only a club's genuine draws move the total; everyone else is rounding.
    if (playerPopularity(p) >= 70) starSum += playerJerseySales(p)
  }
  const base = 10_000_000 * reach(teamId)
  return Math.round(base + starSum)
}

export interface JerseySeller {
  player: Player
  popularity: number
  sales: number
}

/** The club's top jersey sellers this season (popular stars, by their own form). */
export function jerseyLeaders(world: World, teamId: string, n = 5): JerseySeller[] {
  const roster = world.roster[teamId] ?? []
  return [...roster]
    .map((p) => ({ player: p, popularity: playerPopularity(p), sales: playerJerseySales(p) }))
    .sort((a, b) => b.sales - a.sales || b.popularity - a.popularity)
    .slice(0, n)
}

/** The shape of last season's finish, used to move fan interest. */
export interface SeasonOutcome {
  made: Set<string>
  /** Playoff games won per club (0 for a club that missed or lost its opener). */
  roundsWon: Record<string, number>
  champion?: string
  runnerUp?: string
}

/** Home playoff gates: one for making it, one more for each round won. */
function homePlayoffGames(outcome: SeasonOutcome | undefined, teamId: string): number {
  if (!outcome || !outcome.made.has(teamId)) return 0
  return 1 + Math.min(2, outcome.roundsWon[teamId] ?? 0)
}

/**
 * One club's revenue for a season. `won` drives the interest that sets the
 * gate; the favourite stars drive the jersey line; the market drives media.
 */
export function seasonRevenue(
  world: World,
  teamId: string,
  opts: { price?: number; outcome?: SeasonOutcome; interest?: number } = {},
): SeasonRevenue {
  const price = opts.price ?? defaultTicketPrice(teamId)
  const games = homeGames(world, teamId)
  const att = attendanceFor(world, teamId, price)
  const tickets = Math.round(att.seats * price * games)
  const jerseys = jerseyMoney(world, teamId)
  const media = mediaMoney(teamId)
  const gates = homePlayoffGames(opts.outcome, teamId)
  const playoffGates = Math.round(gates * att.capacity * 0.99 * price * 1.6)
  const local = tickets + jerseys + media + playoffGates
  return {
    tickets,
    jerseys,
    media,
    playoffGates,
    national: NATIONAL_MEDIA,
    local,
    total: local + NATIONAL_MEDIA,
    attendance: att.seats,
    attendancePct: att.pct,
    ticketPrice: price,
    homeGames: games,
  }
}

/** The season's revenue for every club, using each club's own price and result. */
export function leagueRevenue(
  world: World,
  career: CareerState | null,
  outcome?: SeasonOutcome,
): Record<string, SeasonRevenue> {
  const byTeam: Record<string, SeasonRevenue> = {}
  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    byTeam[t.id] = seasonRevenue(world, t.id, {
      price: ticketPriceFor(career, t.id),
      outcome,
    })
  }
  return byTeam
}

/**
 * The money the club's market hands its football operation for the coming
 * season: a share of its LOCAL revenue, above the shared national floor. This
 * is what `staffBudget` adds on top of the prestige base.
 */
export function marketBudgetDelta(world: World, teamId: string): number {
  const rev = lastRevenue(world, teamId)
  if (!rev) return 0
  return clamp(Math.round(rev.local * 0.06), 4_000_000, 30_000_000)
}

function lastRevenue(world: World, teamId: string): SeasonRevenue | undefined {
  // The most recent computed season (it funds the season that follows it). A
  // fresh world has none, so the club is projected from where it stands.
  const stored = world.market?.revenue
  if (stored) return stored.byTeam[teamId]
  return seasonRevenue(world, teamId, { price: defaultTicketPrice(teamId) })
}

// ── Fan interest dynamics ────────────────────────────────────────────────────
/** The club's most popular player right now (its own star power). */
export function topPopularity(world: World, teamId: string): number {
  const roster = world.roster[teamId] ?? []
  let top = 0
  for (const p of roster) top = Math.max(top, playerPopularity(p))
  return top
}

/**
 * Move fan interest for the season just played. Winning raises it, losing
 * lowers it, a hot star and a playoff run add, primetime exposure adds, and a
 * ticket priced above what the market will bear costs a little goodwill. The
 * pull is toward the club's own intensity (its baseline), so a one-year spike
 * settles unless it is repeated.
 *
 * `madeLast` is whether the club made last season's playoffs, so a club that
 * falls out of the bracket loses ground and one that returns gains.
 */
export function interestAfter(
  world: World,
  teamId: string,
  opts: { madeLast?: boolean; outcome?: SeasonOutcome; price?: number },
): { interest: number; delta: number } {
  const base = fanBase(world, teamId).interest
  const rec = world.standings[teamId]
  const wins = rec?.wins ?? 8
  const games = (rec?.wins ?? 0) + (rec?.losses ?? 0) + (rec?.ties ?? 0) || 17
  const winPct = wins / games

  // Winning: ±10 around a .500 club, symmetric.
  const winShock = clamp((winPct - 0.5) / 0.5, -1, 1) * 10
  // The club's own star: a genuine draw pulls attention to the building.
  const starShock = clamp((topPopularity(world, teamId) - 72) / 27, 0, 1) * 6
  // Playoff runs.
  const made = opts.outcome?.made.has(teamId) ?? false
  const rounds = opts.outcome?.roundsWon[teamId] ?? 0
  let playoffShock = made ? 3 + rounds * 1.5 : 0
  if (opts.outcome?.champion === teamId) playoffShock += 5
  if (opts.outcome?.runnerUp === teamId) playoffShock += 2
  if (!made && opts.madeLast) playoffShock -= 2
  // Primetime exposure.
  const primetime = world.schedule.filter(
    (g) => !g.postseason && g.slot && (g.homeId === teamId || g.awayId === teamId),
  ).length
  const primeShock = (Math.min(primetime, 5) / 5) * 3
  // Price sensitivity: overcharging the building costs some goodwill.
  const price = opts.price ?? defaultTicketPrice(teamId)
  const fair = defaultTicketPrice(teamId)
  const priceShock = -clamp((price - fair) / fair, -0.3, 0.5) * 5
  // Settle back toward the club's own intensity over time.
  const reversion = (marketOf(teamId).intensity - base) * 0.12

  const delta = winShock + starShock + playoffShock + primeShock + priceShock + reversion
  const interest = clamp(base + delta, 20, 100)
  return { interest, delta }
}

/**
 * Advance the market one season: recompute every club's fan interest from the
 * season just played and its revenue, and stash both on `world.market`. Pure
 * arithmetic over the world's own standings/schedule/rosters — no rng draw.
 */
export function updateMarket(world: World, outcome?: SeasonOutcome, career?: CareerState | null): MarketState {
  const fans: Record<string, FanBase> = {}
  const byTeam: Record<string, SeasonRevenue> = {}
  const lastInterest: Record<string, number> = {}
  const madeLastPrev = world.market?.lastMade ?? {}
  const madeNow: Record<string, boolean> = {}

  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    const prev = fanBase(world, t.id)
    const price = ticketPriceFor(career ?? null, t.id)
    const { interest } = interestAfter(world, t.id, {
      madeLast: madeLastPrev[t.id],
      outcome,
      price,
    })
    const wins = world.standings[t.id]?.wins ?? 0
    const history = [...prev.history, { season: world.season, interest, wins }].slice(-HISTORY_CAP)
    fans[t.id] = { interest, history }
    lastInterest[t.id] = prev.interest
    madeNow[t.id] = outcome ? outcome.made.has(t.id) : false
    byTeam[t.id] = seasonRevenue(world, t.id, { price, outcome })
  }

  const state: MarketState = {
    fans,
    revenue: { season: world.season, byTeam },
    lastInterest,
    lastMade: madeNow,
  }
  world.market = state
  return state
}

/** Interest trend over the last stored seasons, for the UI (sorted oldest first). */
export function interestTrend(world: World, teamId: string, n = 5): FanSeason[] {
  return fanBase(world, teamId).history.slice(-n)
}

/** The revenue line the budget and the UI read, or a projection before any season. */
export function currentRevenue(world: World, teamId: string): SeasonRevenue {
  return lastRevenue(world, teamId) ?? seasonRevenue(world, teamId)
}

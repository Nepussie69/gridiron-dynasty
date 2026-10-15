// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #28 — the coaching market (C1 engine).
//
// One place that gives every coach an individual *profile* (teaching, a
// position-group boost, an install window) and one place that owns the
// market/budget/contract mechanics: refreshing the candidate pool, ticking
// contracts, buyouts + dead money, poach offers, and the per-position-group
// development multiplier.
//
// Determinism: everything here is `hash32(id)` plus the coach's own rating and
// specialty. No `rng()` draw is added or removed, so the calibrated play sim is
// byte-identical and an old save (no new fields) derives the same profiles on
// read. Effects come from the specific person in each seat and the specific
// player's own ratings — never a team average.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, StaffMember, StaffRole } from '../types'
import type { World } from './generate'
import { NFL_TEAMS } from '../data/nflTeams'
import { FIRST, LAST, SPECIALTIES } from './names'
import { clamp, hash32 } from './rng'
import { ownerPersonality } from './owner'
import { ownerStaffBudgetBonus, ownerStaffFundOpen } from './ownerMeeting'
import { coordinatorEdge } from './coaching'
import { devGroupFor } from './devPlan'

// ── The coach profile ────────────────────────────────────────────────────────
/** A coach's market-anchored profile. Pure and stable per `id` (old saves included). */
export interface CoachProfile {
  /** Teaching quality, 35–95. Drives position-group development and install speed. */
  teaching: number
  /** The position group this seat sharpens and the focus points it adds (0–2). */
  boost: { group: string; points: number }
  /** Weeks to full mastery of an install, 2–6. */
  install: number
}

/** The dev group label for a coach role (the seat's own group). */
export const BOOST_GROUP: Partial<Record<StaffRole, string>> = {
  'QB Coach': 'QB',
  'OL Coach': 'OL',
  'DL Coach': 'DL',
  'Secondary Coach': 'CB/S',
  'WR Coach': 'WR',
  'LB Coach': 'LB',
}

/** The staff role that owns a devGroup (the reverse of BOOST_GROUP). */
const GROUP_ROLE: Record<string, StaffRole> = {
  QB: 'QB Coach',
  OL: 'OL Coach',
  DL: 'DL Coach',
  CB: 'Secondary Coach',
  S: 'Secondary Coach',
  WR: 'WR Coach',
  LB: 'LB Coach',
}

/** The dev groups, per role, whose players a seat's coach actually boosts. */
export const ROLE_DEV_GROUPS: Partial<Record<StaffRole, string[]>> = {
  'QB Coach': ['QB'],
  'OL Coach': ['OL'],
  'DL Coach': ['DL'],
  'Secondary Coach': ['CB', 'S'],
  'WR Coach': ['WR'],
  'LB Coach': ['LB'],
}

/** Specialties that read as "a teacher" and nudge the teaching sub up. */
const TEACHING_SPECIALTIES = new Set(['QB Development', 'O-Line Play', 'Culture Builder'])

/** teaching: a jittered read of the coach's own rating + specialty (35–95). */
export function coachProfile(m: StaffMember): CoachProfile {
  const h = hash32(m.id, 28)
  const jitter = (h % 61) - 30 // −30..+30
  const bonus = TEACHING_SPECIALTIES.has(m.specialty) ? 8 : 0
  const teaching = clamp(Math.round(m.rating + jitter + bonus), 35, 95)
  const group = BOOST_GROUP[m.role] ?? ''
  const points = group ? hash32(`${m.id}|boost`, 29) % 3 : 0 // 0..2
  const install = 2 + (hash32(`${m.id}|install`, 30) % 5) // 2..6
  return { teaching, boost: { group, points }, install }
}

/** A 0.6–1.4 factor from a coach's teaching — one definition for dev and install. */
export function teachFactor(teaching: number): number {
  return clamp(0.6 + (teaching / 100) * 0.8, 0.6, 1.4)
}

// ── Position-group development ───────────────────────────────────────────────
/** Coach roles that carry the club's day-to-day development (its own mean). */
const BASE_POSITION_ROLES: StaffRole[] = ['QB Coach', 'OL Coach', 'DL Coach', 'Secondary Coach']

/** League band for the per-group development multiplier (spec §2). */
export const GROUP_DEV_LO = 0.95
export const GROUP_DEV_HI = 1.05

/**
 * FUTURES #28 §2: the dev multiplier for one position group at one club.
 *
 * `g = 1 + (groupCoach − meanOfTeamCoaches)/100 × 0.3 × teachFactor`, clamped to
 * [0.95, 1.05]. The club's own four position coaches deviate around *their* mean,
 * so the club's total development is redistributed, not inflated. A group with
 * no dedicated coach (RB/TE/FB/KP, or an empty seat) returns exactly 1, which is
 * every AI club's WR/LB (they never get those seats).
 */
export function groupDevMultiplier(world: World, teamId: string, devGroup: string): number {
  const role = GROUP_ROLE[devGroup]
  if (!role) return 1
  const staff = world.staff[teamId] ?? []
  const coach = staff.find((m) => m.role === role)
  if (!coach) return 1
  // The club's own coach mean: its four base position coaches (the seats the AI
  // and every world already carries). WR/LB coaches sit outside that mean, so
  // hiring one shifts only its own group.
  const base = BASE_POSITION_ROLES
    .map((r) => staff.find((m) => m.role === r)?.rating)
    .filter((v): v is number => typeof v === 'number')
  if (!base.length) return 1
  const mean = base.reduce((a, b) => a + b, 0) / base.length
  const g = 1 + ((coach.rating - mean) / 100) * 0.3 * teachFactor(coachProfile(coach).teaching)
  return clamp(g, GROUP_DEV_LO, GROUP_DEV_HI)
}

/**
 * FUTURES #28 §2: the extra focus points a player's own position group earns
 * from the specific coach in its seat. 0 when the group has no dedicated coach.
 */
export function boostPointsFor(world: World, teamId: string, pos: import('../types').Position): number {
  const group = devGroupFor(pos)
  const role = GROUP_ROLE[group]
  if (!role) return 0
  const coach = (world.staff[teamId] ?? []).find((m) => m.role === role)
  if (!coach) return 0
  return coachProfile(coach).boost.points
}

// ── Install scaling ──────────────────────────────────────────────────────────
/** teaching → a 0.8–1.2 scale on the user's install edge (spec §4). */
export function coordinatorTeachingScale(world: World, teamId: string, side: 'off' | 'def'): number {
  const role: StaffRole = side === 'off' ? 'Offensive Coordinator' : 'Defensive Coordinator'
  const coach = (world.staff[teamId] ?? []).find((m) => m.role === role)
  if (!coach) return 1
  const t = coachProfile(coach).teaching
  return clamp(0.8 + ((t - 35) / 60) * 0.4, 0.8, 1.2)
}

// ── Budget (#25) ─────────────────────────────────────────────────────────────
/** The staff budget and where the club stands against it. All in dollars/season. */
export interface StaffBudget {
  budget: number
  payroll: number
  /** Buyouts still being paid this season. */
  deadMoney: number
  headroom: number
  ownerFund: boolean
  personality: ReturnType<typeof ownerPersonality>
}

/** Dead staff money for this season (buyouts from firings/replacements). */
export function staffDeadMoneyThisSeason(career: CareerState, season: number): number {
  return (career.staffDeadMoney ?? [])
    .filter((d) => d.season === season)
    .reduce((s, d) => s + d.amount, 0)
}

/**
 * FUTURES #28 §8 / #25: the club's staff budget, shared by the store and the UI.
 * `(18 + prestige×0.3)M + owner top-up`, adjusted by the owner's personality
 * (cheap ×0.9, win-now ×1.1). Headroom counts payroll *and* dead money.
 */
export function staffBudget(world: World, career: CareerState): StaffBudget {
  const prestige = world.byId[career.teamId]?.prestige ?? 75
  const ownerBonus = ownerStaffBudgetBonus(career, world.season)
  const personality = ownerPersonality(career.teamId)
  const mult = personality === 'cheap' ? 0.9 : personality === 'win-now' ? 1.1 : 1
  const budget = Math.round((Math.round((18 + prestige * 0.3) * 1_000_000) + ownerBonus) * mult)
  const payroll = (world.staff[career.teamId] ?? []).reduce((s, m) => s + m.annual, 0)
  const deadMoney = staffDeadMoneyThisSeason(career, world.season)
  return {
    budget,
    payroll,
    deadMoney,
    headroom: budget - payroll - deadMoney,
    ownerFund: ownerStaffFundOpen(career, world.season),
    personality,
  }
}

/** The cheapest Available candidate's asking price (a rough floor for the escape hatch). */
export function cheapestStaffAsk(world: World, role?: StaffRole): number {
  const pool = [...(world.analyticsPool ?? []), ...world.staffPool].filter(
    (m) => m.status === 'Available' && (!role || m.role === role),
  )
  if (!pool.length) return Number.POSITIVE_INFINITY
  return Math.min(...pool.map((m) => m.annual))
}

/**
 * §8: may you make this offer? Above headroom you are blocked unless the owner
 * fund is open — but the cheapest available seat is always reachable (shown as
 * "over budget — owner notified"), so a vacant OC/DC can never be unfillable.
 */
export function canAffordHire(
  world: World,
  career: CareerState,
  salary: number,
  cheapestAsk: number = cheapestStaffAsk(world),
): boolean {
  const b = staffBudget(world, career)
  if (salary <= b.headroom) return true
  if (b.ownerFund) return true
  return salary <= cheapestAsk
}

/** Append a dead-money entry (buyout) for a season; returns a new career. */
export function addStaffDeadMoney(career: CareerState, season: number, amount: number): CareerState {
  if (amount <= 0) return career
  const list = [...(career.staffDeadMoney ?? [])]
  const hit = list.find((d) => d.season === season)
  if (hit) hit.amount += amount
  else list.push({ season, amount })
  return { ...career, staffDeadMoney: list }
}

/** §7: a mid-contract departure costs 50% of the remaining years × annual. */
export function staffBuyout(m: StaffMember): number {
  return Math.round(0.5 * Math.max(0, m.contractYears) * m.annual)
}

/** §50: contract length from the salary tier — 2 years (cheap) up to 4 (elite). */
export function contractYearsForSalary(salary: number): number {
  if (salary >= 6_000_000) return 4
  if (salary >= 3_000_000) return 3
  return 2
}

// ── Offers (re-sign / poach) ─────────────────────────────────────────────────
export interface StaffOffer {
  kind: 'resign' | 'poach'
  id: string
  season: number
  /** The club the coach is currently with (yours). */
  teamId: string
  memberId: string
  name: string
  role: StaffRole
  /** Poach only: the seat the other club is offering. */
  toRole?: StaffRole
  rating: number
  /** Asking raise (re-sign) or the other club's offer (poach). */
  annual: number
  /** Poach only: the club making the offer. */
  fromTeamId?: string
  /** Poach only: true = a lateral move (blockable), false = a promotion. */
  lateral?: boolean
  message: string
}

/** §9: a same-rung move is lateral and blockable; a step up is a promotion. */
export function poachLateral(fromRole: StaffRole, toRole: StaffRole): boolean {
  return fromRole === toRole
}

/** §7: tick the user club's staff contracts down; flag the ones that expire. */
export interface ContractTick {
  career: CareerState
  expired: StaffOffer[]
}

export function tickStaffContracts(world: World, career: CareerState): ContractTick {
  const staff = world.staff[career.teamId] ?? []
  const offers = [...(career.staffOffers ?? [])]
  const expired: StaffOffer[] = []
  for (const m of staff) {
    // gmpersona: the General Manager's deal is the owner's business. You cannot
    // fire or re-sign him from the staff screen, so his contract rolls over in
    // place instead of landing in your inbox as a resign offer.
    if (m.role === 'General Manager') {
      if (m.contractYears > 0) m.contractYears -= 1
      if (m.contractYears <= 0) {
        const h = hash32(`gmrenew|${m.id}|${world.season}`, 83)
        m.contractYears = 2 + (h % 4)
        m.notes = `Signed through ${world.season + 2 + (h % 3)}`
      }
      continue
    }
    if (m.contractYears > 0) m.contractYears -= 1
    if (m.contractYears > 0) continue
    if (offers.some((o) => o.kind === 'resign' && o.memberId === m.id && o.season === world.season)) continue
    const ask = Math.round(m.annual * 1.15)
    const offer: StaffOffer = {
      kind: 'resign',
      id: `resign_${world.season}_${m.id}`,
      season: world.season,
      teamId: career.teamId,
      memberId: m.id,
      name: m.name,
      role: m.role,
      rating: m.rating,
      annual: ask,
      message: `${m.name}'s deal is up. Re-sign him at $${(ask / 1_000_000).toFixed(1)}M or let him walk.`,
    }
    offers.push(offer)
    expired.push(offer)
  }
  return { career: { ...career, staffOffers: offers }, expired }
}

// ── Market refresh ───────────────────────────────────────────────────────────
/** The coach seats the market keeps stocked. WR/LB are user-only new seats. */
export const MARKET_COACH_ROLES: StaffRole[] = [
  'Head Coach', 'Offensive Coordinator', 'Defensive Coordinator', 'Special Teams Coordinator',
  'QB Coach', 'OL Coach', 'DL Coach', 'Secondary Coach', 'WR Coach', 'LB Coach',
]
const MARKET_TOPUP = 5
const POOL_CAP = 90
export const STAFF_MARKET_TOPUP = MARKET_TOPUP
export const STAFF_POOL_CAP = POOL_CAP
const MARKET_OFF_SCHEMES = ['Air Raid', 'Pro Style', 'Spread', 'West Coast', 'RPO Heavy']
const MARKET_DEF_SCHEMES = ['4-3 Base', '3-4 Base', '4-2-5 Nickel', 'Multiple', 'Blitz Heavy']

function isDefensiveCoach(role: string): boolean {
  return role.includes('Defensive') || role === 'DL Coach' || role === 'Secondary Coach' || role === 'LB Coach'
}

/** A hash-built candidate — no rng draw, so the market never shifts a season's stream. */
function marketCoach(seed: number, season: number, role: StaffRole, i: number): StaffMember {
  const h = hash32(`${seed}|${season}|${role}|${i}`, 47)
  const id = `mk_${seed}_${season}_${role.replace(/\s/g, '')}_${i}`
  const rating = clamp(52 + (h % 40), 40, 95)
  const pools = isDefensiveCoach(role) ? MARKET_DEF_SCHEMES : MARKET_OFF_SCHEMES
  return {
    id,
    name: `${FIRST[(h >>> 3) % FIRST.length]} ${LAST[(h >>> 11) % LAST.length]}`,
    role,
    age: 32 + (h % 28),
    rating,
    specialty: SPECIALTIES[(h >>> 5) % SPECIALTIES.length],
    scheme: pools[h % pools.length],
    annual: Math.round((rating / 100) * (role === 'Head Coach' ? 14 : role.includes('Coordinator') ? 4.5 : 2) * 1_000_000),
    contractYears: 3,
    teamId: null,
    status: 'Available',
  }
}

/** The season a market candidate was created in (legacy/generated pool = 0). */
function createdSeason(m: StaffMember): number {
  const mt = /^mk_\d+_(\d+)_/.exec(m.id)
  return mt ? Number(mt[1]) : 0
}

/**
 * §6: at rollover, top every coach role up to 5 Available candidates (hash-built,
 * WR/LB included for the user market only) and cap `staffPool` at 90 by dropping
 * the oldest unsigned entries, ties broken by hash. Deterministic; idempotent
 * within a season. Returns the candidates it added.
 */
export function refreshStaffMarket(world: World, season: number = world.season): StaffMember[] {
  const pool = world.staffPool
  const added: StaffMember[] = []
  for (const role of MARKET_COACH_ROLES) {
    const have = pool.filter((m) => m.role === role && m.status === 'Available').length
    for (let i = have; i < MARKET_TOPUP; i++) {
      const m = marketCoach(world.seed, season, role, i)
      pool.push(m)
      added.push(m)
    }
  }
  while (pool.length > POOL_CAP) {
    let worst = -1
    let worstSeason = Infinity
    let worstHash = Infinity
    for (let i = 0; i < pool.length; i++) {
      const m = pool[i]
      if (m.status !== 'Available') continue
      const cs = createdSeason(m)
      const hk = hash32(`drop|${m.id}`, 1)
      if (cs < worstSeason || (cs === worstSeason && hk < worstHash)) {
        worstSeason = cs
        worstHash = hk
        worst = i
      }
    }
    if (worst < 0) break
    pool.splice(worst, 1)
  }
  return added
}

// ── Poaching (§9) ────────────────────────────────────────────────────────────
/** Position-coach seats an AI club can promote from (below the coordinator rung). */
export const POSITION_COACH_ROLES: StaffRole[] = ['QB Coach', 'OL Coach', 'DL Coach', 'Secondary Coach', 'WR Coach', 'LB Coach']

const PROMOTION_SEATS: StaffRole[] = ['Offensive Coordinator', 'Defensive Coordinator']

/** A stable destination club that is not your own. */
function poachDestination(label: string, avoidTeamId: string): string {
  const pool = NFL_TEAMS.map((t) => t.id).filter((id) => id !== avoidTeamId)
  return pool[hash32(`poachdest|${label}`, 61) % pool.length]
}

/**
 * §9: at rollover, at most one AI club offers a promotion to one of your
 * position coaches (rating ≥ 78, ≤ 1 year left), chosen by hash. Deterministic;
 * one offer per season.
 */
export function rollPoachOffers(world: World, career: CareerState): { career: CareerState; offer?: StaffOffer } {
  const season = world.season
  if ((career.staffOffers ?? []).some((o) => o.kind === 'poach' && o.season === season)) {
    return { career: { ...career, staffOffers: career.staffOffers ?? [] } }
  }
  const staff = world.staff[career.teamId] ?? []
  const eligible = staff
    .filter((m) => POSITION_COACH_ROLES.includes(m.role) && m.rating >= 78 && m.contractYears <= 1)
    .sort((a, b) => b.rating - a.rating || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  if (!eligible.length) return { career: { ...career, staffOffers: career.staffOffers ?? [] } }
  const who = eligible[hash32(`poach|${world.seed}|${season}|${career.teamId}`, 71) % eligible.length]
  const promote = hash32(`poachkind|${world.seed}|${who.id}|${season}`, 73) % 2 === 0
  const toRole: StaffRole = promote
    ? PROMOTION_SEATS[hash32(`poachside|${world.seed}|${who.id}|${season}`, 75) % PROMOTION_SEATS.length]
    : who.role
  const lateral = poachLateral(who.role, toRole)
  const fromTeamId = poachDestination(`${world.seed}|${season}|${who.id}`, career.teamId)
  const annual = Math.round(who.annual * 1.18)
  const offer: StaffOffer = {
    kind: 'poach',
    id: `poach_${season}_${who.id}`,
    season,
    teamId: career.teamId,
    memberId: who.id,
    name: who.name,
    role: who.role,
    toRole,
    rating: who.rating,
    annual,
    fromTeamId,
    lateral,
    message: lateral
      ? `${world.byId[fromTeamId]?.name ?? fromTeamId} want to interview ${who.name} for their ${toRole} job — a lateral move you can block.`
      : `${who.name} is a hot name — ${world.byId[fromTeamId]?.name ?? fromTeamId} want him as their ${toRole}. You cannot block a promotion.`,
  }
  return { career: { ...career, staffOffers: [...(career.staffOffers ?? []), offer] }, offer }
}

/** §9: he leaves your staff and joins your tree as a protégé with his role. */
export function applyPoachDeparture(
  world: World,
  career: CareerState,
  offer: StaffOffer,
): { career: CareerState; ok: boolean } {
  const staff = world.staff[career.teamId] ?? []
  const i = staff.findIndex((m) => m.id === offer.memberId)
  if (i < 0) return { career, ok: false }
  const [gone] = staff.splice(i, 1)
  const entry = {
    name: gone.name,
    role: gone.role,
    fromRole: gone.role,
    teamId: offer.fromTeamId ?? '',
    season: world.season,
    id: gone.id,
    rating: gone.rating,
    scheme: gone.scheme,
    wins: 0,
    losses: 0,
    rings: 0,
    seasons: 0,
    status: 'available' as const,
  }
  const tree = [...(career.tree ?? []), entry]
  const staffOffers = (career.staffOffers ?? []).filter((o) => o.id !== offer.id)
  return { career: { ...career, tree, staffOffers }, ok: true }
}

// ── Interim promotion (§7) ───────────────────────────────────────────────────
export interface InterimResult {
  member: StaffMember | null
  vacated?: StaffRole
  edgeBefore: number
  edgeAfter: number
}

/**
 * §7: the best position coach fills a vacant coordinator chair at rating −4 and
 * his own seat is vacated. The new edge is `coordinatorEdge(r − 4)`.
 */
export function promoteInterim(world: World, teamId: string, seat: 'off' | 'def'): InterimResult {
  const staff = world.staff[teamId] ?? (world.staff[teamId] = [])
  const coordRole: StaffRole = seat === 'off' ? 'Offensive Coordinator' : 'Defensive Coordinator'
  const idx = staff.findIndex((m) => m.role === coordRole)
  const before = idx >= 0 ? staff[idx] : undefined
  const candidates = staff
    .filter((m) => POSITION_COACH_ROLES.includes(m.role))
    .sort((a, b) => b.rating - a.rating || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  if (!candidates.length) {
    const edge = coordinatorEdge(before?.rating ?? null)
    return { member: null, edgeBefore: edge, edgeAfter: edge }
  }
  const pick = candidates[0]
  const member: StaffMember = {
    ...pick,
    id: `${pick.id}_interim`,
    role: coordRole,
    rating: Math.max(30, pick.rating - 4),
    contractYears: Math.max(1, pick.contractYears || 3),
    notes: 'Promoted interim',
  }
  if (idx >= 0) staff[idx] = member
  else staff.push(member)
  // Vacate his own seat (the original entry, still keyed by his old role).
  const pi = staff.findIndex((m) => m.id === pick.id && m.role !== coordRole)
  if (pi >= 0) staff.splice(pi, 1)
  return {
    member,
    vacated: pick.role,
    edgeBefore: coordinatorEdge(before?.rating ?? null),
    edgeAfter: coordinatorEdge(member.rating),
  }
}

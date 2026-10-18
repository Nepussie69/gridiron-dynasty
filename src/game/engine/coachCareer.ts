// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #44 — coaching careers.
//
// Every coach (HC, coordinator, position coach) has a career: he is a certain
// age, he learns at his OWN rate (his `learning` trait), his sub-ratings grow
// fast while he is young and coaching a good unit, plateau through his forties,
// and decline late. His age climbs, his contract ticks, and at 65–72 he retires
// and a club replaces him. Owners fire head coaches mid-season when the record
// is bad enough for their own temperament, and the club promotes an interim
// head coach from its own staff — the interim is a real person with his own
// ratings, not a placeholder.
//
// FUTURES #51 feeds this: the retirees `developPlayers` hands over each season
// become position coaches with a sheet read off their own playing ratings, and
// they climb the same ladder.
//
// Determinism: the whole module is a stable hash of ids/seasons plus the
// league's own standings — no rng() draw is added or removed, so the calibrated
// play sim and the 20-game equivalence check are untouched. Effects come from
// the individual in each seat and his own club/unit results, never a league or
// unit average.
// ─────────────────────────────────────────────────────────────────────────────

import type { CoachCareer, CoachStop, CoachSubs, StaffMember, StaffRole } from '../types'
import type { World } from './generate'
import { clamp, hash32 } from './rng'
import { coachSubs } from './coachSubs'
import { NFL_TEAMS } from '../data/nflTeams'
import { FP, coachSalaryFor, formerPlayerFor, formerPlayerSheetBias, intakeFormerPlayers } from './formerPlayers'
import { makeCoach, promoteInterimHeadCoach, schemeFor } from './coachingTree'
import { ownerPersonality } from './owner'

/** FUTURES #44 tunables. */
export const C44 = {
  /** Points a sub can move in a season at peak conditions (young, elite learner, top unit). */
  growthBase: 1.6,
  /** Growth curve by age — the shape of a coach's career. */
  curveYoung: 1.0, // ≤ 30
  curveEarly: 0.9, // 31–36
  curveMid: 0.6, // 37–42
  curveLate: 0.35, // 43–48
  curveVet: 0.12, // 49–54
  curveFlat: 0.0, // 55–58
  curveDecline: -0.15, // 59–62
  curveOld: -0.35, // 63+
  /** A sub's growth is throttled as it nears the ceiling. */
  ceilingRoom: 26,
  /** How many stops the timeline keeps. */
  maxStops: 14,
  /** First-year head coaches enter the chair around here. */
  firstHcAge: 45,
  /** Assistants retire between these ages (his own draw inside the band). */
  retireLo: 65,
  retireHi: 72,
  /** The share of a season in which owners can pull the trigger. */
  firingWeeks: [7, 11, 15],
  /** A club never makes more than this many mid-season head-coach changes. */
  maxMidseasonFirings: 3,
  /** Even past his line, an owner only pulls the trigger this often (a stable hash). */
  fireChance: 0.6,
} as const

const OFF_ROLES = new Set<StaffRole>(['Offensive Coordinator', 'QB Coach', 'OL Coach', 'WR Coach'])
const DEF_ROLES = new Set<StaffRole>(['Defensive Coordinator', 'DL Coach', 'Secondary Coach', 'LB Coach'])
const COACH_ROLES = new Set<StaffRole>([
  'Head Coach', 'Offensive Coordinator', 'Defensive Coordinator', 'Special Teams Coordinator',
  'QB Coach', 'OL Coach', 'DL Coach', 'Secondary Coach', 'WR Coach', 'LB Coach',
])

export function isCoachSeat(role: StaffRole): boolean {
  return COACH_ROLES.has(role)
}

/** The subs a seat actually works at — growth goes where the job is. */
const ROLE_READS: Record<string, (keyof CoachSubs)[]> = {
  'Head Coach': ['gameManagement', 'adjustments', 'discipline', 'motivation', 'playCalling', 'reads'],
  'Offensive Coordinator': ['playCalling', 'reads', 'adjustments', 'gameManagement', 'development'],
  'Defensive Coordinator': ['playCalling', 'disguise', 'reads', 'adjustments'],
  'Special Teams Coordinator': ['discipline', 'adjustments', 'motivation'],
  'QB Coach': ['development', 'reads', 'playCalling'],
  'OL Coach': ['development', 'discipline'],
  'DL Coach': ['development', 'disguise'],
  'Secondary Coach': ['development', 'disguise', 'reads'],
  'WR Coach': ['development', 'playCalling'],
  'LB Coach': ['development', 'disguise', 'reads', 'motivation'],
}

const SUB_KEYS: (keyof CoachSubs)[] = [
  'playCalling', 'gameManagement', 'adjustments', 'disguise',
  'reads', 'discipline', 'motivation', 'development',
]

const NFL_IDS = NFL_TEAMS.map((t) => t.id)

function draw(label: string, salt: number): number {
  return (hash32(label, salt) % 100000) / 100000
}

/**
 * NFL-like ages at world creation — one definition, in the leaf `coachAges.ts`
 * so the generator can use it without a cycle.
 */
export { coachAgeFor } from './coachAges'

/** The age a coach was when he took his first pro job (drives his experience). */
function entryAgeFor(role: StaffRole, m: StaffMember): number {
  const base = role === 'Head Coach' ? 38 : role.includes('Coordinator') ? 32 : 27
  return base + (hash32(`${m.id}|entry`, 431) % 6)
}

/**
 * A coach's career, derived for anyone the save has never materialized (a
 * legacy save, a market candidate, a newly-generated replacement). Pure.
 */
export function coachCareerOf(m: StaffMember, world?: World): CoachCareer {
  if (m.career) return m.career
  const season = world?.season ?? 0
  const entry = entryAgeFor(m.role, m)
  const experience = clamp(m.age - entry, 0, 38)
  const startSeason = season - experience
  const learning = 0.6 + draw(`${m.id}|learn`, 401) * 0.8
  const peakAge = 37 + (hash32(`${m.id}|peak`, 402) % 11)
  const hc = m.role === 'Head Coach'
  // A résumé drawn from his own record, so the timeline reads like a career.
  const stops: CoachStop[] = []
  const priorRole: StaffRole = hc ? 'Offensive Coordinator' : m.role
  let wins = 0
  let losses = 0
  for (let i = 0; i < experience; i++) {
    const s = startSeason + i
    const teamId = NFL_IDS[hash32(`${m.id}|stop|${s}`, 403) % NFL_IDS.length]
    const last = i >= experience - 3
    const role = hc && last ? 'Head Coach' : priorRole
    const w = role === 'Head Coach' ? 4 + (hash32(`${m.id}|w|${s}`, 404) % 10) : 0
    const l = role === 'Head Coach' ? 17 - w : 0
    if (role === 'Head Coach') {
      wins += w
      losses += l
    }
    stops.push({
      season: s,
      teamId,
      team: undefined,
      role,
      rating: clamp(Math.round(m.rating - (experience - 1 - i) * 0.5), 30, 99),
      wins: w,
      losses: l,
    })
  }
  return {
    startSeason,
    seasons: experience,
    learning,
    peakAge,
    wins,
    losses,
    stops: stops.slice(-C44.maxStops),
    formerPlayer: formerPlayerFor(m) ?? undefined,
  }
}

// ── Growth ───────────────────────────────────────────────────────────────────

function ageCurve(age: number): number {
  if (age <= 30) return C44.curveYoung
  if (age <= 36) return C44.curveEarly
  if (age <= 42) return C44.curveMid
  if (age <= 48) return C44.curveLate
  if (age <= 54) return C44.curveVet
  if (age <= 58) return C44.curveFlat
  if (age <= 62) return C44.curveDecline
  return C44.curveOld
}

interface TeamPerf { winPct: number; offPct: number; defPct: number }

/** The league's own results, turned into percentiles per club (0–1). */
function leaguePerf(world: World): Map<string, TeamPerf> {
  const nfl = world.teams.filter((t) => t.tier === 'NFL')
  const rows = nfl.map((t) => {
    const r = world.standings[t.id]
    const g = (r?.wins ?? 0) + (r?.losses ?? 0)
    return {
      id: t.id,
      winPct: g ? (r!.wins + (r!.ties ?? 0) * 0.5) / g : 0.5,
      offPpg: g ? (r?.pointsFor ?? 0) / g : 22,
      defPpg: g ? (r?.pointsAgainst ?? 0) / g : 22,
    }
  })
  const rank = (values: { id: string; v: number }[], invert: boolean) => {
    const sorted = [...values].sort((a, b) => (invert ? a.v - b.v : b.v - a.v))
    const out = new Map<string, number>()
    sorted.forEach((r, i) => out.set(r.id, sorted.length > 1 ? i / (sorted.length - 1) : 0.5))
    return out
  }
  const offRank = rank(rows.map((r) => ({ id: r.id, v: r.offPpg })), false)
  const defRank = rank(rows.map((r) => ({ id: r.id, v: r.defPpg })), true) // fewer points allowed = better
  const out = new Map<string, TeamPerf>()
  for (const r of rows) {
    out.set(r.id, { winPct: r.winPct, offPct: offRank.get(r.id) ?? 0.5, defPct: defRank.get(r.id) ?? 0.5 })
  }
  return out
}

/** How good the thing this coach is responsible for was this season (0–1). */
function coachPerf(m: StaffMember, perf: TeamPerf | undefined): number {
  if (!perf) return 0.5
  if (DEF_ROLES.has(m.role)) return 0.25 * perf.winPct + 0.75 * perf.defPct
  if (OFF_ROLES.has(m.role)) return 0.25 * perf.winPct + 0.75 * perf.offPct
  return 0.4 * perf.winPct + 0.3 * perf.offPct + 0.3 * perf.defPct
}

/** The base sheet a coach grows from, including a former player's own bias. */
function startingSheet(m: StaffMember): CoachSubs {
  if (m.subs) return { ...m.subs }
  const base = coachSubs(m)
  const bias = formerPlayerSheetBias(m.career?.formerPlayer ?? formerPlayerFor(m))
  if (bias) {
    for (const k of SUB_KEYS) if (bias[k]) base[k] = clamp(base[k] + bias[k]!, 20, 99)
  }
  return base
}

/**
 * One season of growth for one coach, from his OWN learning trait, his age and
 * how his unit actually played. Returns new subs and the overall delta.
 */
export function growCoachSubs(
  m: StaffMember,
  career: CoachCareer,
  perfSample: number,
  subs: CoachSubs,
): { subs: CoachSubs; delta: number } {
  const curve = ageCurve(m.age)
  const learn = clamp(career.learning, 0.5, 1.5)
  const perf = clamp(perfSample, 0, 1)
  // resultScale is deliberately wide: .55 (poor unit) → 1.45 (elite unit).
  const resultScale = 0.55 + perf * 0.9
  const out = { ...subs }
  let sum = 0
  const reads = ROLE_READS[m.role] ?? []
  for (const k of SUB_KEYS) {
    const room = clamp((99 - subs[k]) / C44.ceilingRoom, 0.2, 1)
    const where = reads.includes(k) ? 1.15 : 0.85
    // The specialty is the craft he works at: it grows a touch faster.
    const specialty = hash32(`${m.id}|spec`, 405) % 8 === SUB_KEYS.indexOf(k) ? 1.12 : 1
    const raw = curve * (0.5 + 0.5 * learn) * resultScale * where * specialty * room * C44.growthBase
    // Keep a whole point only when it accumulates, so single seasons move subs by 0–3.
    const step = raw >= 0 ? Math.floor(raw + draw(`${m.id}|${k}|${m.age}`, 406)) : -Math.floor(-raw + draw(`${m.id}|${k}|${m.age}`, 407))
    out[k] = clamp(subs[k] + step, 20, 99)
    sum += out[k] - subs[k]
  }
  return { subs: out, delta: sum / SUB_KEYS.length }
}

// ── Mid-season firings + interim head coaches ─────────────────────────────────

export interface CoachNews { headline: string; body: string; teamId?: string }

/** The win rate at which THIS owner pulls the trigger (his own temperament). */
function ownerFireLine(winPct: number, personality: string, games: number): boolean {
  const min = 5
  if (games < min) return false
  switch (personality) {
    case 'win-now':
      return winPct <= 0.24
    case 'meddling':
      return winPct <= 0.21
    case 'cheap':
      return winPct <= 0.18
    default: // patient
      return winPct <= 0.14
  }
}

/**
 * Week-by-week: an owner in a bad season fires his head coach and the club
 * promotes an interim from its own staff (a real coach with his own ratings).
 * At most `maxMidseasonFirings` league-wide per season, chosen by record then
 * hash. The club whose head job the USER holds is never fired here (his own
 * job-security path owns that); every other club, including the one he works
 * for, is fair game. Adds no rng draw.
 */
export function midseasonCoachFirings(
  world: World,
  week: number,
  opts?: { userTeamId?: string | null; userIsHeadCoach?: boolean },
): CoachNews[] {
  if (!(C44.firingWeeks as readonly number[]).includes(week)) return []
  const news: CoachNews[] = []
  const candidates: { teamId: string; winPct: number; h: number }[] = []
  // The cap is per LEAGUE SEASON, so count the clubs already running an interim.
  let alreadyFired = 0
  for (const team of world.teams) {
    if (team.tier !== 'NFL') continue
    if (opts?.userIsHeadCoach && team.id === opts.userTeamId) continue
    const staff = world.staff[team.id] ?? []
    const hc = staff.find((m) => m.role === 'Head Coach')
    if (!hc) continue
    // His own club must not already be running an interim this season.
    if (coachCareerOf(hc, world).interim?.season === world.season) {
      alreadyFired++
      continue
    }
    const rec = world.standings[team.id]
    if (!rec) continue
    const games = rec.wins + rec.losses + (rec.ties ?? 0)
    if (games < 5) continue
    const winPct = (rec.wins + (rec.ties ?? 0) * 0.5) / games
    const personality = ownerPersonality(team.id)
    if (!ownerFireLine(winPct, personality, games)) continue
    // Past his line an owner still does not always act this week — his own
    // patience, a stable hash (no rng draw), so the league lands 0–3 a season.
    if (draw(`trigger|${world.seed}|${world.season}|${team.id}`, 412) >= C44.fireChance) continue
    candidates.push({ teamId: team.id, winPct, h: hash32(`fire|${world.seed}|${world.season}|${team.id}`, 407) })
  }
  // Worst record first, ties by hash; the league never makes more than 3 a season.
  candidates.sort((a, b) => a.winPct - b.winPct || a.h - b.h)
  const budget = Math.max(0, C44.maxMidseasonFirings - alreadyFired)
  const chosen = candidates.slice(0, budget)
  for (const c of chosen) {
    const staff = world.staff[c.teamId] ?? (world.staff[c.teamId] = [])
    const idx = staff.findIndex((m) => m.role === 'Head Coach')
    if (idx < 0) continue
    const out = staff[idx]
    const rec = world.standings[c.teamId]
    const promoted = promoteInterimHeadCoach(world, c.teamId, world.season)
    if (!promoted) continue
    // Remove the man he replaces, so the club has exactly one head coach.
    const oi = staff.findIndex((m) => m.id === out.id)
    if (oi >= 0) staff.splice(oi, 1)
    // Mark the interim on his OWN (now materialized) career sheet.
    promoted.career = { ...coachCareerOf(promoted, world), interim: { season: world.season, teamId: c.teamId } }
    // The old head coach is on the open market with his own career intact.
    world.staffPool.push({ ...out, teamId: null, status: 'Available', notes: `Let go by ${world.byId[c.teamId]?.name ?? c.teamId}` })
    news.push({
      headline: `${out.name} out as ${world.byId[c.teamId]?.name ?? c.teamId} head coach`,
      body: `${world.byId[c.teamId]?.name ?? c.teamId} were ${rec?.wins ?? 0}-${rec?.losses ?? 0}. ${promoted.name} takes over as interim head coach — his sub-ratings are his own.`,
      teamId: c.teamId,
    })
  }
  return news
}

/** Owner personality is the club's own (engine/owner.ts) — one definition. */
// ── Season-end advancement ───────────────────────────────────────────────────

export interface CoachCareerAdvance {
  news: CoachNews[]
  /** How many coaches grew, retired, were hired or entered from the players. */
  grown: number
  retired: number
  hired: number
  fromPlayers: number
}

/**
 * The season rollover: age every coach, grow his own subs, tick and extend his
 * contract, bank his season's stop, retire the old ones, fill the holes
 * (preferring an internal promotion before a market hire), and turn this
 * season's retirees into new position coaches (FUTURES #51).
 */
export function advanceCoachCareers(world: World, userTeamId?: string | null): CoachCareerAdvance {
  const news: CoachNews[] = []
  const perf = leaguePerf(world)
  let grown = 0
  let retiredCount = 0

  for (const team of world.teams) {
    if (team.tier !== 'NFL') continue
    const staff = world.staff[team.id] ?? (world.staff[team.id] = [])
    const rec = world.standings[team.id]
    const going: StaffMember[] = []
    for (const m of staff) {
      if (!isCoachSeat(m.role)) continue
      const career = coachCareerOf(m, world)
      const before = m.rating
      const subs = startingSheet(m)
      const grew = growCoachSubs(m, career, coachPerf(m, perf.get(team.id)), subs)
      m.subs = grew.subs
      m.rating = clamp(Math.round(m.rating + grew.delta), 30, 99)
      m.age += 1
      m.career = { ...career, seasons: (career.seasons ?? 0) + 1, stops: career.stops.slice(-C44.maxStops) }
      // Bank the season: his club's record (a head coach's W-L builds his record).
      const stop: CoachStop = {
        season: world.season,
        teamId: team.id,
        team: team.name,
        role: m.role,
        rating: m.rating,
        wins: rec?.wins ?? 0,
        losses: rec?.losses ?? 0,
        interim: m.career.interim?.season === world.season && m.career.interim.teamId === team.id ? true : undefined,
      }
      m.career.stops = [...m.career.stops, stop].slice(-C44.maxStops)
      if (m.role === 'Head Coach') {
        m.career.wins += rec?.wins ?? 0
        m.career.losses += rec?.losses ?? 0
        if (world.lastChampion && world.lastChampion === team.id) m.career.rings = (m.career.rings ?? 0) + 1
      }
      if (m.rating !== before) grown++
      // Contract: the AI club extends its own men (the user's market ticks them).
      if (team.id !== userTeamId) {
        m.contractYears -= 1
        if (m.contractYears <= 0) {
          const h = hash32(`renew|${m.id}|${world.season}`, 408)
          m.contractYears = 2 + (h % 3)
          // Pay tracks what he has become — a coach's own rating, never the league's.
          m.annual = coachSalaryFor(m.role, m.rating) + (h % 4) * 250_000
        }
      }
      // Retirement: his own age inside the band, a poor late career can hurry it.
      const retireAge = C44.retireLo + (hash32(`${m.id}|retire`, 409) % (C44.retireHi - C44.retireLo + 1))
      const earlyOut = m.age >= 58 && (rec ? (rec.wins / Math.max(1, rec.wins + rec.losses)) : 0.5) < 0.3 && draw(`${m.id}|early|${world.season}`, 410) < 0.35
      if (m.age >= retireAge || earlyOut) going.push(m)
    }
    for (const m of going) {
      const i = staff.findIndex((x) => x.id === m.id)
      if (i >= 0) staff.splice(i, 1)
      retiredCount++
      if (m.role === 'Head Coach') {
        news.push({
          headline: `${m.name} retires after ${m.career?.seasons ?? 0} seasons`,
          body: `The ${m.age}-year-old steps away from ${team.name}. He finishes ${m.career?.wins ?? 0}-${m.career?.losses ?? 0} as a head coach.`,
          teamId: team.id,
        })
      }
    }
  }

  // FUTURES #51: this season's retirees become position coaches. They are added
  // to the open market first, so a club with a hole can hire one below.
  const intake = intakeFormerPlayers(world.lastRetired, world.season)
  for (const c of intake.coaches) world.staffPool.push(c)
  world.lastRetired = undefined

  // Fill every AI club's holes: an internal promotion first (a man climbing the
  // ladder), then a retired player who fits the seat, then a fresh hire.
  let hired = 0
  for (const team of world.teams) {
    if (team.tier !== 'NFL' || team.id === userTeamId) continue
    const staff = world.staff[team.id] ?? (world.staff[team.id] = [])
    for (const role of COACH_ROLES) {
      if (staff.some((m) => m.role === role)) continue
      const pick = hireForSeat(world, team.id, role)
      if (pick) {
        staff.push(pick)
        hired++
      }
    }
  }

  return { news, grown, retired: retiredCount, hired, fromPlayers: intake.coaches.length }
}

/** The best man for an empty seat: promote within, sign a former player, else hire. */
function hireForSeat(world: World, teamId: string, role: StaffRole): StaffMember | null {
  const staff = world.staff[teamId] ?? []
  // 1. Promote a serving assistant whose own sheet fits the seat (climbing).
  const internal = staff
    .filter((m) => isCoachSeat(m.role) && rankOf(m.role) < rankOf(role))
    .sort((a, b) => fitForSeat(b, role) - fitForSeat(a, role) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]
  if (internal && fitForSeat(internal, role) >= 66) {
    const staffArr = staff
    const idx = staffArr.findIndex((x) => x.id === internal.id)
    const promoted: StaffMember = { ...internal, role, rating: clamp(internal.rating + 2, 30, 99), notes: `Promoted to ${role}` }
    if (idx >= 0) staffArr[idx] = promoted
    return null // he already filled the seat in place
  }
  // 2. A former player from this offseason's class whose seat matches.
  const poolIdx = world.staffPool.findIndex((m) => m.status === 'Available' && m.role === role && m.career?.formerPlayer)
  if (poolIdx >= 0) {
    const [man] = world.staffPool.splice(poolIdx, 1)
    return { ...man, teamId, status: 'Hired', notes: man.notes }
  }
  // 3. Any available candidate at the seat, then a fresh hire.
  const anyIdx = world.staffPool.findIndex((m) => m.status === 'Available' && m.role === role)
  if (anyIdx >= 0) {
    const [man] = world.staffPool.splice(anyIdx, 1)
    return { ...man, teamId, status: 'Hired' }
  }
  const land = world.byId[teamId]
  const rating = clamp(Math.round((land?.prestige ?? 80) * 0.85 + 4), 45, 92)
  return makeCoach(role, teamId, rating, schemeFor(role, `${teamId}|${role}|${world.season}`), `${teamId}|${role}|${world.season}`)
}

/** How well a man's own results/subs fit a bigger seat (0–100). */
function fitForSeat(m: StaffMember, role: StaffRole): number {
  const s = m.subs ?? coachSubs(m)
  const reads = ROLE_READS[role] ?? []
  const fit = reads.length ? reads.reduce((a, k) => a + s[k], 0) / reads.length : m.rating
  return Math.round((m.rating + fit) / 2)
}

/** Ladder position of a seat, so only genuine promotions happen. */
function rankOf(role: StaffRole): number {
  if (role === 'Head Coach') return 3
  if (role.includes('Coordinator')) return 2
  return 1
}

/**
 * A backfill used by the market and by probes: a fresh head coach for a club
 * that has none (age in the first-time-HC band, his own career sheet).
 */
export function freshHeadCoach(world: World, teamId: string): StaffMember {
  const land = world.byId[teamId]
  const rating = clamp(Math.round((land?.prestige ?? 80) * 0.85 + 4), 45, 92)
  const base = makeCoach('Head Coach', teamId, rating, schemeFor('Head Coach', `${teamId}|${world.season}`), `${teamId}|hc|${world.season}`)
  const career = coachCareerOf(base, world)
  base.age = C44.firstHcAge + (hash32(`${base.id}|fhc`, 411) % 8)
  base.career = { ...career, startSeason: world.season, seasons: Math.max(1, Math.floor(career.seasons / 2)) }
  return base
}

/** Every coach's most recent stop length at a club (0 when he just arrived). */
export function tenureAt(m: StaffMember, teamId: string | null): number {
  const stops = (m.career?.stops ?? []).filter((s) => s.teamId === teamId)
  return stops.length
}

/** How many coaches the league's current HCs have been in the chair (seasons). */
export function hcTenure(m: StaffMember): number {
  const stops = [...(m.career?.stops ?? [])].reverse()
  let n = 0
  for (const s of stops) {
    if (s.role !== 'Head Coach') break
    n++
  }
  return n
}

/** Retirees this season that the intake may turn into coaches (probe helper). */
export const FP_INTAKE = FP

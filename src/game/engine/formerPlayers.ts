// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #51 — former players become coaches.
//
// A share of the players who retire each season move into coaching: more for
// quarterbacks and linebackers, more for high-AWR veterans and long careers.
// They start as position coaches and climb, and the sheet they start with is
// read off their OWN playing ratings — a smart QB is an OC prospect with high
// play calling, a high-AWR linebacker is a DC prospect with high reads and
// disguise, a long-career offensive lineman is an OL coach with development.
//
// The same module gives every coach already in the world a stable, derived
// playing past (~half of the head coaches and coordinators played in the
// league), so the "Former player" badge and the sheet bias exist on a legacy
// save too. Everything here is a pure hash of the person's id — no rng() draw,
// so the calibrated play sim and every AI result stay byte-identical.
// ─────────────────────────────────────────────────────────────────────────────

import type { CoachPlayingCareer, CoachSubs, Position, StaffMember, StaffRole } from '../types'
import { clamp, hash32 } from './rng'

/** A share of a season's retirees hang up the pads and pick up a whistle. */
export const FP = {
  /** Share of qualifying retirees (4+ NFL seasons) who enter coaching. */
  share: 0.12,
  /** QBs are the most likely to coach; linebackers next. */
  qbMult: 2.0,
  lbMult: 1.6,
  /** A high football IQ makes a career on the sideline likelier. */
  awrMult: 1.35,
  /** Only retirees with at least this many NFL seasons are considered. */
  minSeasons: 4,
  /** The most a single league offseason adds to the market. */
  maxPerSeason: 12,
} as const

/** NFL positions, grouped the way a coach's seat groups them. */
export type PlayGroup = 'QB' | 'OL' | 'WR' | 'RB' | 'TE' | 'DL' | 'LB' | 'DB' | 'KP'

export function playGroupOf(pos: Position): PlayGroup {
  switch (pos) {
    case 'QB':
      return 'QB'
    case 'OT':
    case 'OG':
    case 'C':
      return 'OL'
    case 'WR':
      return 'WR'
    case 'TE':
      return 'TE'
    case 'RB':
    case 'FB':
      return 'RB'
    case 'DE':
    case 'DT':
      return 'DL'
    case 'LB':
      return 'LB'
    case 'CB':
    case 'S':
      return 'DB'
    default:
      return 'KP'
  }
}

/** The play-group weighting a seat draws its (derived) playing past from. */
const ROLE_POS_POOL: Partial<Record<StaffRole, PlayGroup[]>> = {
  'Head Coach': ['QB', 'QB', 'LB', 'DB', 'OL', 'WR', 'TE', 'RB', 'DL'],
  'Offensive Coordinator': ['QB', 'QB', 'WR', 'TE', 'OL', 'RB', 'QB', 'WR'],
  'Defensive Coordinator': ['LB', 'LB', 'DB', 'DB', 'DL', 'LB', 'DB'],
  'Special Teams Coordinator': ['LB', 'KP', 'KP', 'WR', 'RB', 'DB'],
  'QB Coach': ['QB'],
  'OL Coach': ['OL'],
  'DL Coach': ['DL'],
  'Secondary Coach': ['DB'],
  'WR Coach': ['WR'],
  'LB Coach': ['LB'],
}

/** How often a seat is held by a former player (derived for legacy staff). */
const ROLE_PLAYED_RATE: Partial<Record<StaffRole, number>> = {
  'Head Coach': 0.5,
  'Offensive Coordinator': 0.5,
  'Defensive Coordinator': 0.5,
  'Special Teams Coordinator': 0.5,
  'QB Coach': 0.55,
  'OL Coach': 0.5,
  'DL Coach': 0.42,
  'Secondary Coach': 0.45,
  'WR Coach': 0.42,
  'LB Coach': 0.45,
}

const POS_BY_GROUP: Record<PlayGroup, Position[]> = {
  QB: ['QB'],
  OL: ['OT', 'OG', 'C'],
  WR: ['WR'],
  TE: ['TE'],
  RB: ['RB', 'FB'],
  DL: ['DE', 'DT'],
  LB: ['LB'],
  DB: ['CB', 'S'],
  KP: ['K', 'P'],
}

/** A stable draw in [0,1) from a label. */
function draw(label: string, salt: number): number {
  return (hash32(label, salt) % 100000) / 100000
}

/**
 * The playing past a seat's coach is derived to have. Null for front-office
 * staff (a Scout or GM is not a coach) and for the share who never played.
 */
export function formerPlayerFor(m: StaffMember): CoachPlayingCareer | null {
  if (m.career?.formerPlayer) return m.career.formerPlayer
  const rate = ROLE_PLAYED_RATE[m.role]
  if (rate === undefined) return null
  if (draw(`${m.id}|played`, 441) > rate) return null
  const pool = ROLE_POS_POOL[m.role] ?? ['LB']
  const group = pool[hash32(`${m.id}|pospool`, 442) % pool.length]
  const posList = POS_BY_GROUP[group]
  const pos = posList[hash32(`${m.id}|pos`, 443) % posList.length]
  // Playing quality tracks the coach he became, with his own variance.
  const ovr = clamp(Math.round(m.rating * 0.82 + (draw(`${m.id}|povr`, 444) - 0.5) * 22), 48, 94)
  const awr = clamp(
    Math.round(ovr * 0.7 + (group === 'QB' ? 14 : group === 'LB' || group === 'DB' ? 8 : group === 'OL' ? 4 : 0) + (draw(`${m.id}|pawr`, 445) - 0.5) * 20),
    38,
    98,
  )
  const seasons = clamp(Math.round(2 + draw(`${m.id}|pyr`, 446) * 13), 1, 15)
  const teamId = topTeamIdFor(m, 448)
  return { pos, seasons, ovr, awr, teamId, team: undefined, lastSeason: undefined }
}

/** A stable NFL club id for a derived playing career (never the club he coaches). */
function topTeamIdFor(m: StaffMember, salt: number): string {
  // Lazy import would be a cycle; the ids are the same list the league uses.
  const ids = NFL_IDS
  return ids[hash32(`${m.id}|pteam`, salt) % ids.length]
}

/** The 32 club ids, mirrored from data/nflTeams so this module stays leaf-safe. */
const NFL_IDS = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB',
  'HOU', 'IND', 'JAX', 'KC', 'LA', 'LAC', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
]

/**
 * The sheet a retired player starts coaching with, read off his own playing
 * ratings: the position he played decides which subs lead, his playing overall
 * sets the level, and his football IQ (AWR) lifts the mental subs.
 */
export function startingSubsFromPlaying(pos: Position, ovr: number, awr: number, seasons: number): CoachSubs {
  const group = playGroupOf(pos)
  const g = (k: PlayGroup) => (group === k ? 1 : 0)
  const vet = clamp((seasons - 4) * 1.1, -3, 8) // long careers coach a little better
  // Level: his own playing overall, plus the football IQ he played with.
  const level = 30 + ovr * 0.34 + awr * 0.2 + vet
  const out: CoachSubs = {
    playCalling: level + 6 * g('QB') + 2 * g('OL'),
    gameManagement: level + 7 * g('QB') + 2 * g('LB') + 2 * g('DB'),
    adjustments: level + 3 * g('QB') + 3 * g('LB') + 2 * g('DB'),
    disguise: level + 10 * g('LB') + 9 * g('DB') + 8 * g('DL'),
    reads: level + 8 * g('QB') + 7 * g('LB') + 6 * g('DB'),
    discipline: level + 8 * g('OL') + 4 * g('DL') + 3 * g('LB'),
    motivation: level + 5 * g('QB') + 4 * g('LB') + 3 * g('RB'),
    development: level + 12 * g('OL') + 6 * g('QB') + 4 * g('DL'),
  }
  for (const k of Object.keys(out) as (keyof CoachSubs)[]) out[k] = clamp(Math.round(out[k]), 28, 92)
  return out
}

/** The mean of a sheet — a former player's starting overall. */
export function sheetMean(s: CoachSubs): number {
  const keys = Object.keys(s) as (keyof CoachSubs)[]
  return keys.reduce((a, k) => a + s[k], 0) / keys.length
}

/**
 * The sheet bias a coach who played gets on the derived (hash) path, so a legacy
 * save's former players read like former players too: the position he played
 * sharpens the subs that position coaches. Symmetric and small (±2–6).
 */
export function formerPlayerSheetBias(career: CoachPlayingCareer | null | undefined): Partial<CoachSubs> | null {
  if (!career) return null
  const group = playGroupOf(career.pos)
  const out: Partial<CoachSubs> = {}
  const add = (k: keyof CoachSubs, v: number) => (out[k] = (out[k] ?? 0) + v)
  switch (group) {
    case 'QB':
      add('playCalling', 5)
      add('reads', 4)
      add('gameManagement', 3)
      add('development', 2)
      break
    case 'LB':
      add('disguise', 5)
      add('reads', 4)
      add('motivation', 3)
      break
    case 'DB':
      add('disguise', 4)
      add('reads', 4)
      add('adjustments', 2)
      break
    case 'DL':
      add('disguise', 3)
      add('discipline', 2)
      break
    case 'OL':
      add('development', 5)
      add('discipline', 4)
      break
    case 'WR':
      add('development', 3)
      add('playCalling', 2)
      break
    case 'TE':
      add('development', 3)
      add('motivation', 2)
      break
    case 'RB':
      add('motivation', 3)
      add('playCalling', 2)
      break
    case 'KP':
      add('discipline', 4)
      add('gameManagement', 2)
      break
  }
  return out
}

/** A short badge line for the UI: "LB · 9 NFL seasons". */
export function playingLine(p: CoachPlayingCareer): string {
  const yrs = p.seasons === 1 ? '1 NFL season' : `${p.seasons} NFL seasons`
  return `${p.pos} · ${yrs}`
}

// ── Retired players → new coaches (the season-end intake) ─────────────────────
/** A retired player as `developPlayers` hands him over (minimal, save-light). */
export interface RetiredSnapshot {
  id: string
  name: string
  pos: Position
  age: number
  ovr: number
  awr: number
  seasons: number
  teamId: string | null
  team?: string
}

/** The position coach seat a retired player's position maps to. */
export function entryRoleFor(pos: Position): StaffRole {
  switch (playGroupOf(pos)) {
    case 'QB':
      return 'QB Coach'
    case 'OL':
      return 'OL Coach'
    case 'DL':
      return 'DL Coach'
    case 'DB':
      return 'Secondary Coach'
    case 'WR':
      return 'WR Coach'
    case 'LB':
      return 'LB Coach'
    default:
      return 'WR Coach' // RB / TE / K / P: the offensive skill seat
  }
}

/** Does this retiree enter coaching? More for QBs, LBs and high-AWR vets. */
export function entersCoaching(r: RetiredSnapshot, season: number): boolean {
  if (r.seasons < FP.minSeasons) return false
  const g = playGroupOf(r.pos)
  let p = FP.share
  if (g === 'QB') p *= FP.qbMult
  if (g === 'LB') p *= FP.lbMult
  if (r.awr >= 85) p *= FP.awrMult
  else if (r.awr >= 78) p *= 1.2
  if (r.age >= 36) p *= 0.7
  return draw(`${r.id}|tocoach|${season}`, 451) < p
}

/** The coach a retired player becomes: a position coach with his own sheet. */
export function retireeToCoach(r: RetiredSnapshot, season: number): StaffMember {
  const role = entryRoleFor(r.pos)
  const subs = startingSubsFromPlaying(r.pos, r.ovr, r.awr, r.seasons)
  const rating = clamp(Math.round(sheetMean(subs)), 34, 88)
  const h = hash32(`${r.id}|coachid|${season}`, 452)
  const defensive = role === 'DL Coach' || role === 'Secondary Coach' || role === 'LB Coach'
  const schemes = defensive ? ['4-3 Base', '3-4 Base', '4-2-5 Nickel', 'Multiple', 'Blitz Heavy'] : ['Air Raid', 'Pro Style', 'Spread', 'West Coast', 'RPO Heavy']
  const specialtyPool = coachingSpecialtiesFor(role)
  return {
    id: `fp_${r.id}_${season}`,
    name: r.name,
    role,
    age: r.age,
    rating,
    specialty: specialtyPool[h % specialtyPool.length],
    scheme: schemes[(h >>> 5) % schemes.length],
    subs,
    career: {
      startSeason: season,
      seasons: 0,
      // A player learns a sideline the way he learned a playbook: off his AWR.
      learning: clamp(0.65 + (r.awr - 45) / 62, 0.6, 1.4),
      peakAge: 40 + (h % 8),
      wins: 0,
      losses: 0,
      stops: [],
      formerPlayer: {
        pos: r.pos,
        seasons: r.seasons,
        ovr: r.ovr,
        awr: r.awr,
        teamId: r.teamId ?? undefined,
        team: r.team,
        lastSeason: season,
      },
    },
    annual: coachSalaryFor(role, rating),
    contractYears: 2 + (h % 3),
    teamId: null,
    status: 'Available',
    notes: `Former ${r.pos} (${r.seasons} NFL seasons) — first coaching job`,
  }
}

/** The specialties that fit a seat (mirrors names.ts pools without a cycle). */
export function coachingSpecialtiesFor(role: StaffRole): string[] {
  const group = ROLE_POS_POOL[role]
  if (!group) return ['Analyst', 'Developer']
  const pool = new Set<string>(['Analyst', 'Developer', 'Recruiter', 'Culture Builder', 'Players\u2019 coach', 'Disciplinarian'])
  for (const g of group) {
    if (g === 'QB') pool.add('QB Development')
    if (g === 'OL') pool.add('O-Line Play')
    if (g === 'DL') pool.add('Pass Rush')
    if (g === 'DB') pool.add('Secondary')
    if (g === 'LB') pool.add('Defense architect')
  }
  if (role === 'Head Coach') pool.add('Game manager')
  if (role === 'Offensive Coordinator') pool.add('Play Calling')
  if (role === 'Defensive Coordinator') pool.add('Defense architect')
  if (role === 'Offensive Coordinator' || role === 'QB Coach') pool.add('Offense architect')
  return [...pool]
}

/** The market salary for a seat at a rating (the league's existing formula). */
export function coachSalaryFor(role: StaffRole, rating: number): number {
  const base = role === 'Head Coach' ? 14 : role.includes('Coordinator') ? 4.5 : 2
  return Math.round((rating / 100) * base * 1_000_000)
}

// ── Season-end intake ────────────────────────────────────────────────────────
export interface FormerPlayerIntake {
  /** The coaches who entered the profession this offseason, in market order. */
  coaches: StaffMember[]
  /** How many retirees were considered and how many entered. */
  considered: number
}

/**
 * Turn this season's retirees into coaching candidates. Deterministic: the
 * share is a hash of the retiree id and the season, and the list is capped, so
 * the market never floods. Returns them as Available position coaches.
 */
export function intakeFormerPlayers(retired: RetiredSnapshot[] | undefined, season: number): FormerPlayerIntake {
  if (!retired?.length) return { coaches: [], considered: 0 }
  const order = [...retired].sort((a, b) => {
    const ha = hash32(`${a.id}|order|${season}`, 453)
    const hb = hash32(`${b.id}|order|${season}`, 453)
    return hb - ha
  })
  const coaches: StaffMember[] = []
  for (const r of order) {
    if (coaches.length >= FP.maxPerSeason) break
    if (!entersCoaching(r, season)) continue
    coaches.push(retireeToCoach(r, season))
  }
  return { coaches, considered: retired.length }
}

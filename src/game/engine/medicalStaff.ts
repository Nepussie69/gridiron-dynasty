// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #48 — Medical staff & sports science.
//
// Three seats, three duties, three channels — each owned by ONE named man, whose
// own sub-rating does the work, against ONE player's own body (his TGH, his age,
// his tissue):
//
//   Head Athletic Trainer   rehab       how fast a man is brought back to play
//   Team Physician          diagnosis   how reliably he is cleared (early = re-tear)
//   Sports Science Director prevention  load management / soft-tissue risk
//
// Seats are market-only (like 'Analytics' and the WR/LB coach chairs): they are
// never added to NFL_STAFF_ROLES/generateStaffPool, so no world's rng draw order
// ever moves, no AI club holds one, and a generated league is byte-identical.
// Candidates live in `world.medicalPool` (user-only), so the existing Staff
// market, interest, budget, buyout and dead-money paths are reused untouched.
//
// NOTHING here draws from `rng()`. Every roll is a hash of (id, season, week,
// channel) exactly like the #15 injury decisions, so the calibrated play sim and
// the league's injury stream keep their draw sequence. A VACANT seat is neutral
// (factor exactly 1.000 and risk 0): today's tuned season numbers, every old save
// and the whole league are unchanged until you actually hire someone.
//
// Per-person, per-player, no averages: a factor is f(the seat holder's own
// sub-rating, the player's own TGH vs his position mean, his own age, his note).
// A club's spread over a season is the sum of those individuals, never a mean.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, MedicalSubs, Player, StaffMember } from '../types'
import type { MedicalGrade } from './injuryCalls'
import type { World } from './generate'
import { clamp, hash32 } from './rng'
import { POS_MEAN } from './ratingMeans'
import { playerAttrs } from '../data/ratings'
import { FIRST, LAST } from './names'
import { ownerPersonality } from './owner'

export type MedicalRole = 'Head Athletic Trainer' | 'Team Physician' | 'Sports Science Director'

/** The three seats, in the order the UI shows them (the clinical chain). */
export const MEDICAL_ROLES: MedicalRole[] = ['Head Athletic Trainer', 'Team Physician', 'Sports Science Director']

/** Which channel each seat owns (one man, one duty — never a shared read). */
export const MEDICAL_CHANNEL: Record<MedicalRole, keyof MedicalSubs> = {
  'Head Athletic Trainer': 'rehab',
  'Team Physician': 'diagnosis',
  'Sports Science Director': 'prevention',
}

/** The three channels as the UI describes them (one place owns the wording). */
export const MEDICAL_CHANNELS_META: Record<keyof MedicalSubs, { tag: string; label: string; blurb: string }> = {
  rehab: { tag: 'REHAB', label: 'Rehab', blurb: 'How fast a man is brought back from an injury' },
  diagnosis: { tag: 'DIAG', label: 'Diagnosis', blurb: 'How reliably he is cleared — a poor read clears him early and the tissue goes again' },
  prevention: { tag: 'LOAD', label: 'Load management', blurb: 'Soft-tissue risk and load management' },
}

/** The neutral seat rating: what the club's existing training room is worth. */
export const MED_NEUTRAL = 62

/** Every constant this feature adds, in one place. */
export const MED = {
  /** prevention factor at a neutral seat, and its slope per rating point.
   *  Sized so the season-long spread lands in the NFL adjusted-games-lost
   *  neighbourhood (best clubs ~30–40, worst ~120+): an elite S&C room takes the
   *  club's own soft-tissue hazard below half, a poor one lifts it by a third. */
  prevSlope: 1.5,
  prevLo: 0.5,
  prevHi: 1.6,
  /** rehab factor and its own slope (a shorter lever than prevention). */
  rehabSlope: 1.35,
  rehabLo: 0.62,
  rehabHi: 1.5,
  /** diagnosis: the chance a seat clears a man a week early — slope per rating point. */
  dxBase: 0.10,
  dxSlope: 0.005,
  dxLo: 0.012,
  dxHi: 0.34,
  /** re-injury: the per-game chance a lingering (early-cleared) man tears again.
   *  Sloped per rating point, so a poor read (~19% a week, ~34% over the two-week
   *  window) sits at the top of the NFL hamstring-recurrence band (16–38%,
   *  Luxenburg 2022) and an elite one (~2% a week) near the bottom. */
  reBase: 0.10,
  reSlope: 0.004,
  reLo: 0.02,
  reHi: 0.30,
  /** The spread of durations a rehab multiplier is applied to (min 1 game). */
  rehabMinGames: 1,
  /** Weeks a lingering tissue stays live. */
  lingerWeeks: 2,
  /** Load management: what a rested week does to a man's own soft-tissue load. */
  restCut: 0.55,
  /** Load management: a rested man's game-week soft-tissue load. */
  restGameCut: 0.7,
} as const

// ── The sheet ────────────────────────────────────────────────────────────────
/**
 * A medical staffer's own sheet. Stored on the member when hired; derived
 * deterministically from his own id + rating (and his specialty) for a legacy
 * save, exactly the way `coachProfile` derives a coach's teaching. The seat's
 * channel gets his rating ± a hash jitter; the other two reads sit below it —
 * a physician is not a rehab man, and vice versa.
 */
export function medicalSubs(m: StaffMember): MedicalSubs {
  if (m.med) return m.med
  const h = hash32(`${m.id}|med`, 48)
  const primary: keyof MedicalSubs = MEDICAL_CHANNEL[isMedicalRole(m.role) ? m.role : 'Head Athletic Trainer']
  const jitter = (h % 17) - 8 // −8..+8
  const specBonus =
    (m.specialty ?? '').includes('Rehab') || (m.specialty ?? '').includes('Strength') ? 6 : 0
  const other = () => clamp(Math.round(m.rating - 14 + ((h >>> 7) % 13) - 6), 22, 92)
  const sheet = {
    rehab: other(),
    diagnosis: other(),
    prevention: other(),
  }
  sheet[primary] = clamp(Math.round(m.rating + jitter + specBonus), 22, 99)
  return sheet
}

/** The seat holder's own rating for the channel he owns (vacant → neutral). */
export function channelRating(world: World | undefined, teamId: string, role: MedicalRole): number {
  const m = (world?.staff?.[teamId] ?? []).find((x) => x.role === role)
  if (!m) return MED_NEUTRAL
  return medicalSubs(m)[MEDICAL_CHANNEL[role]]
}

/** Is this seat staffed by a named man? (false = the club's incumbent room.) */
export function seatFilled(world: World | undefined, teamId: string, role: MedicalRole): boolean {
  return !!(world?.staff?.[teamId] ?? []).find((x) => x.role === role)
}

// ── The club's training room (the UI reads this; old saves included) ──────────
/** The legacy A–D grade a vacant seat reproduces — #15's exact hash, unchanged. */
export function incumbentGrade(teamId: string): MedicalGrade {
  let g = hash32(teamId, 905) % 4
  if (ownerPersonality(teamId) === 'cheap') g = Math.min(3, g + 1)
  return (['A', 'B', 'C', 'D'] as MedicalGrade[])[g]
}

export interface MedSeat {
  role: MedicalRole
  channel: keyof import('../types').MedicalSubs
  /** The named man in the chair, when there is one. */
  member?: StaffMember
  name: string
  /** His rating in the channel he owns (62 = the neutral incumbent room). */
  rating: number
  /** The full sheet (hired men) — undefined for a vacant seat. */
  subs?: MedicalSubs
  filled: boolean
  annual: number
  contractYears: number
}

/**
 * The club's three medical seats. A vacant seat is the club's existing training
 * room: a named incumbent (deterministic from the club id, no rng, no mutation)
 * at the neutral rating, so today's results are exactly what they were.
 */
export function medicalTeam(world: World | undefined, teamId: string): MedSeat[] {
  return MEDICAL_ROLES.map((role) => {
    const member = (world?.staff?.[teamId] ?? []).find((x) => x.role === role)
    if (member) {
      const subs = medicalSubs(member)
      return {
        role,
        channel: MEDICAL_CHANNEL[role],
        member,
        name: member.name,
        rating: subs[MEDICAL_CHANNEL[role]],
        subs,
        filled: true,
        annual: member.annual,
        contractYears: member.contractYears,
      }
    }
    const h = hash32(`incumbent|${teamId}|${role}`, 49)
    return {
      role,
      channel: MEDICAL_CHANNEL[role],
      name: `${FIRST[h % FIRST.length]} ${LAST[(h >>> 9) % LAST.length]}`,
      rating: MED_NEUTRAL,
      filled: false,
      annual: 0,
      contractYears: 0,
    }
  })
}

/** Wheelhouse bonus: the club's own last name for the incumbent room (UI copy). */
export function incumbentName(world: World | undefined, teamId: string, role: MedicalRole): string {
  const seat = medicalTeam(world, teamId).find((s) => s.role === role)
  return seat?.name ?? ''
}

// ── The channels: one seat's rating, one player's body ───────────────────────
/** The player's own durability read: his TGH against his position mean. */
function tghOf(p: Player): { tgh: number; mean: number | undefined } {
  const mean = POS_MEAN[p.pos]?.TGH
  return { tgh: playerAttrs(p).TGH ?? mean ?? 70, mean }
}

/** His own proneness (a durable man absorbs the load better) and his age. */
function bodyMult(p: Player, tghWeight: number, ageWeight: number): number {
  const { tgh, mean } = tghOf(p)
  const dur = mean === undefined ? 1 : 1 + (mean - tgh) / tghWeight
  const age = 1 + (p.age - 26) * ageWeight
  return clamp(dur * age, 0.8, 1.25)
}

/**
 * Soft-tissue risk multiplier from the Sports Science Director's own prevention
 * read, for THIS player: his durability, his age, and (the caller folds in) his
 * own week of practice load. 1.000 when the seat is vacant.
 */
export function preventionFactor(world: World, teamId: string, p: Player): number {
  if (!seatFilled(world, teamId, 'Sports Science Director')) return 1
  const r = channelRating(world, teamId, 'Sports Science Director')
  const base = 1 - ((r - MED_NEUTRAL) / 100) * MED.prevSlope
  return clamp(base * bodyMult(p, 300, 0.015), MED.prevLo, MED.prevHi)
}

/**
 * Recovery multiplier from the Head Athletic Trainer's own rehab read for THIS
 * player: a fragile or older body takes longer to bring back, a young durable one
 * comes back sooner. 1.000 when the seat is vacant (so the drawn duration stands).
 */
export function rehabFactor(world: World, teamId: string, p: Player): number {
  if (!seatFilled(world, teamId, 'Head Athletic Trainer')) return 1
  const r = channelRating(world, teamId, 'Head Athletic Trainer')
  const base = 1 - ((r - MED_NEUTRAL) / 100) * MED.rehabSlope
  return clamp(base * bodyMult(p, 260, 0.02), MED.rehabLo, MED.rehabHi)
}

/**
 * The Team Physician's own early-clearance risk for THIS player: a poor doctor
 * clears a fragile man too soon (Jenkins 2024: returning inside two weeks raises
 * re-injury risk 13.4%). 0 risk when the seat is vacant — nothing changes.
 */
export function diagnosisRisk(world: World, teamId: string, p: Player): number {
  if (!seatFilled(world, teamId, 'Team Physician')) return 0
  const r = channelRating(world, teamId, 'Team Physician')
  const base = MED.dxBase + (MED_NEUTRAL - r) * MED.dxSlope
  return clamp(base * bodyMult(p, 400, 0.012), MED.dxLo, MED.dxHi)
}

/**
 * The per-game chance a lingering (early-cleared) tissue tears again — from the
 * physician's own read and the player's own durability (NFL hamstring recurrence
 * 16–38%, Luxenburg 2022). Only reachable when a physician is in the chair.
 */
export function reInjuryRisk(world: World, teamId: string, p: Player): number {
  const r = seatFilled(world, teamId, 'Team Physician')
    ? channelRating(world, teamId, 'Team Physician')
    : MED_NEUTRAL
  const base = MED.reBase + (MED_NEUTRAL - r) * MED.reSlope
  return clamp(base * bodyMult(p, 250, 0.02), MED.reLo, MED.reHi)
}

/** The A–D read the play-hurt advice shows (the physician's own sheet). */
export function gradeFromPhysician(world: World | undefined, teamId: string): MedicalGrade {
  if (!seatFilled(world, teamId, 'Team Physician')) return incumbentGrade(teamId)
  const r = channelRating(world, teamId, 'Team Physician')
  if (r >= 82) return 'A'
  if (r >= 70) return 'B'
  if (r >= 58) return 'C'
  return 'D'
}

// ── The expected return band (the UI timeline / the report) ──────────────────
export interface ReturnBand {
  /** Games the club expects as a floor / ceiling (both ≥ 1). */
  lo: number
  hi: number
  /** A one-line read for the UI: "out 2–3 games (high confidence)". */
  label: string
  /** 0–1: how tight the physician could make the band (±0 games = 1). */
  confidence: number
}

/**
 * What the club expects THIS player's return to be. The trainer's own rehab read
 * moves the expected centre; the physician's own diagnosis read decides how wide
 * the band is (±2 games for a poor room, exact for an elite one). Reads only the
 * two seats and the man's own body.
 */
export function expectedReturn(world: World, teamId: string, p: Player, games = p.injured?.games ?? 0): ReturnBand {
  if (games <= 0) return { lo: 0, hi: 0, label: 'Available', confidence: 1 }
  if (games >= 99) return { lo: 99, hi: 99, label: 'Out for the season', confidence: 1 }
  const rehab = rehabFactor(world, teamId, p)
  const centre = Math.max(1, Math.round(games * rehab))
  // A poor physician is wrong by more; an elite one calls it exactly.
  const dx = seatFilled(world, teamId, 'Team Physician') ? channelRating(world, teamId, 'Team Physician') : MED_NEUTRAL
  const width = dx >= 82 ? 0 : dx >= 70 ? 1 : dx >= 58 ? 1 : 2
  const lo = Math.max(1, centre - (width === 0 ? 0 : 1))
  const hi = Math.max(lo, centre + width)
  const confidence = clamp(1 - width * 0.22, 0.4, 1)
  const span = lo === hi ? `${lo} ${lo === 1 ? 'game' : 'games'}` : `${lo}–${hi} games`
  return {
    lo,
    hi,
    label: `${span} (${width === 0 ? 'exact call' : width === 1 ? 'high confidence' : 'wide range'})`,
    confidence,
  }
}

// ── Load management ──────────────────────────────────────────────────────────
/** Men the user has put on a practice load-management plan this season. */
export function loadRestIds(career: CareerState | null | undefined, season: number): string[] {
  const s = career?.loadRest
  return s && s.season === season ? s.ids : []
}

/** Men held out of the given week's game (this season only). */
export function restGameIds(career: CareerState | null | undefined, season: number, week: number): string[] {
  const s = career?.restGame
  return s && s.season === season && s.week === week ? s.ids : []
}

/**
 * The soft-tissue load multiplier a practice-rested man carries into his reps.
 * A rested man's own load drops; the S&C director's prevention read decides how
 * much the week actually buys (a bad department gets less out of it).
 */
export function loadManagedMult(world: World | undefined, teamId: string, p: Player): number {
  const r = seatFilled(world, teamId, 'Sports Science Director')
    ? channelRating(world, teamId, 'Sports Science Director')
    : MED_NEUTRAL
  const base = MED.restCut - ((r - MED_NEUTRAL) / 100) * 0.25
  // A fragile or older body gets a little more out of a light week than a
  // durable one — his own TGH/age, never the club's.
  const body = bodyMult(p, 500, 0.01)
  return clamp(base / body, 0.28, MED.restCut)
}

/**
 * The men worth offering load management to: the club's own highest-current-load
 * or most-fragile players. Pure read, no mutation — the UI lists them.
 */
export function loadWatch(world: World, teamId: string, n = 6): Player[] {
  const roster = world.roster[teamId] ?? []
  const score = (p: Player) => {
    const tgh = tghOf(p).tgh
    const age = p.age
    return (p.repRisk ?? 1) * 100 + (100 - tgh) * 0.6 + Math.max(0, age - 27) * 2
  }
  return [...roster].sort((a, b) => score(b) - score(a)).slice(0, n)
}

// ── The weekly medical tick ──────────────────────────────────────────────────
export interface MedEvent {
  week: number
  playerId: string
  name: string
  kind: 'rehab-shortened' | 'rehab-extended' | 'early-clear' | 're-injury'
  note: string
  /** Games the man is now expected to miss (0 on an early clearance). */
  games: number
}

const MAX_LOG = 80

/** Deterministic 0–1 draw for one (id, season, week, channel) — no rng() use. */
function roll(id: string, season: number, week: number, channel: number): number {
  return (hash32(`${id}|m${channel}`, season * 1009 + week) % 10000) / 10000
}

function pushLog(career: CareerState, season: number, ev: MedEvent): CareerState {
  const cur = career.medical && career.medical.season === season ? career.medical.log : []
  const log = [ev, ...cur].slice(0, MAX_LOG)
  return { ...career, medical: { season, log } }
}

export interface MedicalWeekResult {
  career: CareerState
  /** Events this week, newest first. */
  events: MedEvent[]
  /** New lingering windows opening this week (an early clearance happened). */
  cleared: number
  reInjured: number
}

/**
 * Run the club's medical week: the trainer's rehab on every fresh injury, the
 * physician's early clearance on an injury in its last week, and the re-injury
 * roll for anyone still carrying a lingering tissue. Called by the store right
 * after the week's heal, so `games` is what is left from today. Hash-only — it
 * never touches the sim's rng stream, and a vacant room is a complete no-op.
 */
export function runMedicalWeek(
  world: World,
  career: CareerState,
  week: number,
  opts?: { played?: boolean; restedIds?: string[] },
): MedicalWeekResult {
  const teamId = career.teamId
  const season = world.season
  let next = career
  const events: MedEvent[] = []
  let cleared = 0
  let reInjured = 0
  const rested = new Set(opts?.restedIds ?? [])
  const hasRoom =
    seatFilled(world, teamId, 'Head Athletic Trainer') ||
    seatFilled(world, teamId, 'Team Physician') ||
    seatFilled(world, teamId, 'Sports Science Director')
  // A vacant room is a complete no-op: nothing is written, nothing changes.
  if (!hasRoom) return { career, events: [], cleared: 0, reInjured: 0 }

  for (const p of world.roster[teamId] ?? []) {
    // 1. The trainer's rehab on a fresh injury (once per injury).
    if (p.injured && p.injured.games < 99 && !p.injured.medDone) {
      const f = rehabFactor(world, teamId, p)
      if (f !== 1) {
        const nudge = (roll(p.id, season, week, 61) - 0.5) * 0.5
        const target = p.injured.games * f + nudge
        const ng = Math.max(MED.rehabMinGames, Math.min(20, Math.round(target)))
        if (ng < p.injured.games) {
          p.injured.games = ng
          const ev: MedEvent = { week, playerId: p.id, name: p.name, kind: 'rehab-shortened', note: p.injured.note, games: ng }
          events.push(ev)
          next = pushLog(next, season, ev)
        } else if (ng > p.injured.games) {
          p.injured.games = ng
          const ev: MedEvent = { week, playerId: p.id, name: p.name, kind: 'rehab-extended', note: p.injured.note, games: ng }
          events.push(ev)
          next = pushLog(next, season, ev)
        }
      }
      p.injured.medDone = true
    }

    // 2. The physician: clear a man a week early, at his own risk read.
    if (p.injured && p.injured.games === 1) {
      const ir = (world.ir?.[teamId] ?? []).some((x) => x.id === p.id)
      const risk = diagnosisRisk(world, teamId, p)
      if (risk > 0 && !ir && roll(p.id, season, week, 62) < risk) {
        p.lingering = { note: p.injured.note, weeks: MED.lingerWeeks }
        const ev: MedEvent = { week, playerId: p.id, name: p.name, kind: 'early-clear', note: p.injured.note, games: 0 }
        p.injured = undefined
        events.push(ev)
        next = pushLog(next, season, ev)
        cleared++
      }
    }

    // 3. A lingering tissue: does the game tear it again? Only a man who played.
    const ling = p.lingering
    if (ling && !p.injured) {
      const played = (opts?.played ?? false) && !rested.has(p.id)
      if (played && riskOf(world, teamId, p) > roll(p.id, season, week, 63)) {
        const games = 1 + (hash32(`${p.id}|re`, season * 31 + week) % 3)
        p.injured = { games, note: `${ling.note} (re-injury)`, medDone: true }
        p.lingering = undefined
        const ev: MedEvent = { week, playerId: p.id, name: p.name, kind: 're-injury', note: ling.note, games }
        events.push(ev)
        next = pushLog(next, season, ev)
        reInjured++
      } else {
        const weeks = ling.weeks - 1
        p.lingering = weeks > 0 ? { ...ling, weeks } : undefined
      }
    }
  }

  return { career: next, events, cleared, reInjured }
}

/** One player's own re-injury read while lingering (physician + his own body). */
function riskOf(world: World, teamId: string, p: Player): number {
  // The lingering window only opens when a physician cleared him; a re-injury
  // reads the same physician but our own tissue (TGH/age) swings it ±.
  return reInjuryRisk(world, teamId, p)
}

// ── The market (user-only, like the analytics pool) ──────────────────────────
const MED_SPECIALTY: Record<MedicalRole, string[]> = {
  'Head Athletic Trainer': ['Rehab protocols', 'Return to play', 'Manual therapy', 'Soft-tissue care'],
  'Team Physician': ['Diagnosis', 'Concussion protocol', 'Orthopedics', 'Imaging'],
  'Sports Science Director': ['Load management', 'GPS monitoring', 'Strength', 'Sleep & recovery'],
}

const MED_SALARY: Record<MedicalRole, number> = {
  'Head Athletic Trainer': 1.6,
  'Team Physician': 2.6,
  'Sports Science Director': 1.9,
}

export function isMedicalRole(role: string): role is MedicalRole {
  return (MEDICAL_ROLES as string[]).includes(role)
}

/** Deterministic Candidates for one medical seat — hash-built, no rng() draws. */
export function medicalCandidates(seed: number, season: number, role: MedicalRole, count = 3): StaffMember[] {
  return Array.from({ length: count }, (_, i) => {
    const h = hash32(`med|${seed}|${season}|${role}|${i}`, 50)
    const rating = clamp(54 + (h % 41), 40, 94)
    const specs = MED_SPECIALTY[role]
    const specialty = specs[(h >>> 5) % specs.length]
    return {
      id: `md_${seed}_${season}_${role.replace(/\s/g, '')}_${i}`,
      name: `${FIRST[(h >>> 3) % FIRST.length]} ${LAST[(h >>> 13) % LAST.length]}`,
      role,
      age: 33 + ((h >>> 16) % 30),
      rating,
      specialty,
      scheme: 'Medical',
      annual: Math.round((0.6 + (rating / 100) * MED_SALARY[role]) * 1_000_000),
      contractYears: 3,
      teamId: null,
      status: 'Available' as const,
    } satisfies StaffMember
  })
}

/** Every seat's candidates for a world seed (the optional `medicalPool`). */
export function generateMedicalPool(seed: number, season = 1): StaffMember[] {
  return MEDICAL_ROLES.flatMap((role) => medicalCandidates(seed, season, role))
}

/** Candidates not already in the pool for this season (top-up on load/rollover). */
export function ensureMedicalPool(world: World, season: number = world.season): StaffMember[] {
  world.medicalPool ??= generateMedicalPool(world.seed, season)
  return world.medicalPool
}

/**
 * Probe/test helper: put a fixed-rating training room on a club (or clear it with
 * `rating = null`). Hash-free and mutation-only, so the probe script can run the
 * same season under an elite and a poor room. Never called by the game itself —
 * the game hires through the market.
 */
export function installMedicalRoom(world: World, teamId: string, rating: number | null): void {
  const staff = world.staff[teamId] ?? (world.staff[teamId] = [])
  for (let i = staff.length - 1; i >= 0; i--) if (isMedicalRole(staff[i].role)) staff.splice(i, 1)
  if (rating === null) return
  for (const role of MEDICAL_ROLES) {
    staff.push({
      id: `probe_${teamId}_${role.replace(/\s/g, '')}`,
      name: `Probe ${role.split(' ').slice(-1)[0]}`,
      role,
      age: 45,
      rating,
      specialty: 'Probe',
      scheme: 'Medical',
      med: { rehab: rating, diagnosis: rating, prevention: rating },
      annual: 2_000_000,
      contractYears: 3,
      teamId,
      status: 'Hired',
    })
  }
}

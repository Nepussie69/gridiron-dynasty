// ─────────────────────────────────────────────────────────────────────────────
// Career system: reputation, skills, the dual ladder, and the hiring carousel.
//
// You start at the true bottom (grad assistant / local scout). Advancement runs
// on FOUR reputation dimensions plus personal SKILLS. Excellence and smart
// program/role choices accelerate the climb; mediocrity stalls it.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerPath, CareerState, JobOffer, LeagueTier } from '../types'
import { NFL_TEAMS } from '../data/nflTeams'
import type { World } from './generate'
import { clamp, hash32, makeRng, rpick } from './rng'
import { capHealth, developedCount } from './objectives'
import { pitchBonus, portfolioItems } from './portfolio'
import { ownerMandate } from './owner'

// ── Reputation dimensions ────────────────────────────────────────────────────
export interface Reputation {
  evaluation: number // scouting eye / talent ID
  roster: number // cap, roster construction, draft class output
  leadership: number // staff, development, culture
  results: number // wins, playoffs, titles
  profile: number // connections, media, pedigree
}

export const ZERO_REP: Reputation = { evaluation: 8, roster: 8, leadership: 8, results: 5, profile: 5 }

/** A single 0-100 headline number for quick comparison / offer gating. */
export function overallRep(rep: Reputation): number {
  return Math.round(rep.evaluation * 0.28 + rep.roster * 0.24 + rep.leadership * 0.18 + rep.results * 0.2 + rep.profile * 0.1)
}

// ── Skills you develop over a career ─────────────────────────────────────────
export interface Skills {
  evaluation: number // grading prospects accurately
  negotiation: number // contracts, trades, cap
  leadership: number // staff & culture
  scheme: number // X's and O's / scheme building
  recruiting: number // college roster building
}

export const ZERO_SKILLS: Skills = { evaluation: 20, negotiation: 15, leadership: 15, scheme: 15, recruiting: 15 }

// ── Skill points (L12.11): earned each season, spent by the player ───────────
/** A season can earn at most this many skill points. */
export const MAX_SKILL_POINTS = 8

/** Everything a season did, fed into the skill-point award. */
export interface SkillPointInput {
  /** Job objectives met this season. */
  objectivesMet: number
  /** Personal ambitions met this season. */
  ambitionsMet: number
  wins: number
  losses: number
  madePlayoffs: boolean
  wonTitle: boolean
  /** Staff awards the user won this season. */
  awards: number
  /** The season question resolved in the user's favour. */
  questionGood: boolean
  /** Ledger calls graded this season. */
  ledgerGraded: number
  ledgerHits: number
}

export interface SkillPointAward {
  earned: number
  reasons: string[]
}

/**
 * Award skill points for a season's accomplishments: +2 per job objective met,
 * +1 per personal ambition met, +1 for a winning record, +1 playoffs, +2 title,
 * +1 per staff award, +1 for a season question answered "yes", and +1 for a
 * Ledger success rate ≥ 60% on ≥ 5 graded calls this season. Capped at 8.
 */
export function earnSkillPoints(ctx: SkillPointInput): SkillPointAward {
  const reasons: string[] = []
  let earned = 0
  const add = (n: number, why: string) => {
    if (n > 0) {
      earned += n
      reasons.push(why)
    }
  }
  add(ctx.objectivesMet * 2, `${ctx.objectivesMet} objective${ctx.objectivesMet === 1 ? '' : 's'}`)
  add(ctx.ambitionsMet, `${ctx.ambitionsMet} ambition${ctx.ambitionsMet === 1 ? '' : 's'}`)
  if (ctx.wins > ctx.losses) add(1, 'winning record')
  if (ctx.madePlayoffs) add(1, 'playoffs')
  if (ctx.wonTitle) add(2, 'title')
  add(ctx.awards, `${ctx.awards} staff award${ctx.awards === 1 ? '' : 's'}`)
  if (ctx.questionGood) add(1, 'season question')
  if (ctx.ledgerGraded >= 5 && ctx.ledgerHits / ctx.ledgerGraded >= 0.6) add(1, 'Ledger rate')
  const capped = Math.min(MAX_SKILL_POINTS, earned)
  if (capped < earned) reasons.push(`capped at ${MAX_SKILL_POINTS}`)
  return { earned: capped, reasons }
}

/**
 * Spend `points` skill points evenly: +2 to each skill in turn, round-robin,
 * never past 99. Used by the headless balance harness to model a player who
 * invests his points without favouritism.
 */
export function spendSkillPointsEvenly(skills: Skills, points: number): Skills {
  const order: (keyof Skills)[] = ['evaluation', 'scheme', 'leadership', 'negotiation', 'recruiting']
  const next = { ...skills }
  let left = Math.max(0, Math.floor(points))
  let i = 0
  let guard = 0
  while (left > 0 && guard < 1000) {
    const k = order[i % order.length]
    if (next[k] < 99) {
      next[k] = Math.min(99, next[k] + 2)
      left -= 1
    }
    i += 1
    guard += 1
    if (order.every((x) => next[x] >= 99)) break
  }
  return next
}

// ── The dual ladder ──────────────────────────────────────────────────────────
/**
 * The ONE verb a rung exercises (#1). Every mechanic at a rung should serve its
 * verb; if a system doesn't, it should be hidden at that rung. This is the design
 * test the ladder is built around:
 *   predict (scouts) → persuade (directors) → adapt (coordinators) → lead (HC) → allocate (GM)
 */
export type RungVerb = 'predict' | 'persuade' | 'adapt' | 'lead' | 'allocate'

export interface CareerTier {
  level: number
  title: string
  tier: LeagueTier
  path: CareerPath | 'both'
  gate: Partial<Reputation> // minimum reputation to be considered
  blurb: string
  /** The rung's single verb (#1). Drives which mechanics surface. */
  verb: RungVerb
}

const gate = (r: Partial<Reputation>) => r

/**
 * COACH ladder: on-field roles. Advances on results + leadership + scheme.
 * PERSONNEL ladder: scouting/front office. Advances on evaluation + roster.
 * Both converge on the NFL.
 */
export const COACH_LADDER: CareerTier[] = [
  { level: 0, title: 'Graduate Assistant', tier: 'FBS', path: 'coach', gate: gate({}), verb: 'adapt', blurb: 'Break down film and run the scout team for a Group of Five program.' },
  { level: 1, title: 'Position Coach', tier: 'FBS', path: 'coach', gate: gate({ results: 12, leadership: 12 }), verb: 'lead', blurb: 'Own a position room. Develop players who get drafted.' },
  { level: 2, title: 'Offensive/Defensive Coordinator', tier: 'FBS', path: 'coach', gate: gate({ results: 28, leadership: 21 }), verb: 'adapt', blurb: 'Call the plays. Your unit is your résumé.' },
  { level: 3, title: 'Group of Five Head Coach', tier: 'FBS', path: 'coach', gate: gate({ results: 43, leadership: 33, profile: 20 }), verb: 'lead', blurb: 'Run a program. Win your conference.' },
  { level: 4, title: 'Power Four Head Coach', tier: 'FBS', path: 'coach', gate: gate({ results: 58, leadership: 48, profile: 42 }), verb: 'lead', blurb: 'Blue-blood pressure. Compete for the playoff.' },
  { level: 5, title: 'NFL Position Coach / Quality Control', tier: 'NFL', path: 'coach', gate: gate({ results: 40, profile: 34 }), verb: 'lead', blurb: 'Cross over to the league and prove you belong.' },
  { level: 6, title: 'NFL Coordinator', tier: 'NFL', path: 'coach', gate: gate({ results: 52, scheme: 40, profile: 46 } as never), verb: 'adapt', blurb: 'Run one side of the ball at the highest level.' },
  { level: 7, title: 'NFL Head Coach', tier: 'NFL', path: 'coach', gate: gate({ results: 62, leadership: 54, profile: 58 }), verb: 'lead', blurb: 'You answer to the owner now.' },
]

export const PERSONNEL_LADDER: CareerTier[] = [
  { level: 0, title: 'Local Scout', tier: 'FBS', path: 'personnel', gate: gate({}), verb: 'predict', blurb: 'Break down film for a small program. Prove you can find players.' },
  { level: 1, title: 'Area Scout', tier: 'FBS', path: 'personnel', gate: gate({ evaluation: 13 }), verb: 'predict', blurb: 'Own a region. File reports that change a roster.' },
  { level: 2, title: 'Regional Scout', tier: 'FBS', path: 'personnel', gate: gate({ evaluation: 24, profile: 11 }), verb: 'predict', blurb: 'Cover multiple states for a Power program.' },
  { level: 3, title: 'National Scout', tier: 'FBS', path: 'personnel', gate: gate({ evaluation: 35, profile: 20 }), verb: 'predict', blurb: 'Cross-check the board from coast to coast.' },
  { level: 4, title: 'Assistant Director of College Scouting', tier: 'NFL', path: 'personnel', gate: gate({ evaluation: 45, profile: 31 }), verb: 'persuade', blurb: 'Run the college board for an NFL club.' },
  { level: 5, title: 'Director of College Scouting', tier: 'NFL', path: 'personnel', gate: gate({ evaluation: 62, roster: 32, profile: 44 }), verb: 'persuade', blurb: 'You own the draft board now.' },
  { level: 6, title: 'Director of Player Personnel', tier: 'NFL', path: 'personnel', gate: gate({ evaluation: 68, roster: 46, profile: 52 }), verb: 'persuade', blurb: 'Pro and college. One step from the chair.' },
  { level: 7, title: 'Assistant General Manager', tier: 'NFL', path: 'personnel', gate: gate({ roster: 54, leadership: 38, profile: 62 }), verb: 'allocate', blurb: 'Run the building day to day.' },
  { level: 8, title: 'General Manager', tier: 'NFL', path: 'personnel', gate: gate({ roster: 64, leadership: 42, profile: 70, results: 34 }), verb: 'allocate', blurb: 'Final say on the 53. Go win a championship.' },
]

export function ladderFor(path: CareerPath): CareerTier[] {
  return path === 'coach' ? COACH_LADDER : PERSONNEL_LADDER
}

/**
 * The lowest rung of each ladder that exists in the NFL-only universe. The
 * college side has been removed, so a career starts here and never drops below.
 */
export const MIN_NFL_LEVEL: Record<CareerPath, number> = { coach: 5, personnel: 4 }
export function minNflLevel(path: CareerPath): number {
  return MIN_NFL_LEVEL[path]
}
/** The NFL rungs of a ladder (the only ones reachable in this build). */
export function nflLadder(path: CareerPath): CareerTier[] {
  return ladderFor(path).filter((r) => r.level >= minNflLevel(path))
}

export function tierFor(path: CareerPath, level: number): CareerTier {
  const ladder = ladderFor(path)
  return ladder[clamp(level, 0, ladder.length - 1)]
}

/** One-line framing of a rung's verb, for UI copy (#1). */
export const VERB_BLURB: Record<RungVerb, string> = {
  predict: 'Your job is to PREDICT: read the tape and call what a player becomes.',
  persuade: 'Your job is to PERSUADE: get the room and the GM to see it your way.',
  adapt: 'Your job is to ADAPT: read the opponent and change the plan on the fly.',
  lead: 'Your job is to LEAD: set the standard and get a locker room to follow.',
  allocate: 'Your job is to ALLOCATE: spend the cap, the picks, and the staff for the best return.',
}

export function verbFor(path: CareerPath, level: number): RungVerb {
  return tierFor(path, level).verb
}

const SALARY: Record<CareerPath, number[]> = {
  coach: [40_000, 180_000, 600_000, 1_800_000, 6_500_000, 700_000, 2_200_000, 9_000_000],
  personnel: [45_000, 85_000, 110_000, 145_000, 260_000, 430_000, 760_000, 1_200_000, 3_500_000],
}
export function salaryFor(path: CareerPath, level: number) {
  const arr = SALARY[path]
  return arr[clamp(level, 0, arr.length - 1)]
}

// ── Control thresholds ───────────────────────────────────────────────────────
// Single source of truth is the capability table in capabilities.ts. These
// wrappers exist for the many call sites that import from career.ts, but they
// must not drift: the head coach influences the roster/cap without holding the
// pen, so only roles with the actual capability return true here.
import { capabilities, isGM as isGmRole, isHeadCoach as isHeadCoachRole } from './capabilities'

export function canDraft(career: CareerState) {
  return capabilities(career).can.has('draft')
}
export function canSignFreeAgents(career: CareerState) {
  return capabilities(career).can.has('signFreeAgents')
}
export function isGM(career: CareerState) {
  return isGmRole(career)
}
export function isHeadCoach(career: CareerState) {
  return isHeadCoachRole(career)
}

// ── Gate checks ──────────────────────────────────────────────────────────────
export function meetsGate(rep: Reputation, t: CareerTier): boolean {
  for (const [k, v] of Object.entries(t.gate)) {
    const rv = (rep as unknown as Record<string, number>)[k]
    if (rv !== undefined && rv < (v as number)) return false
  }
  return true
}

/** How close (0..1) the user is to qualifying for the next rung. */
export function progressToNext(rep: Reputation, path: CareerPath, level: number): { pct: number; missing: string[] } {
  const ladder = ladderFor(path)
  const next = ladder[level + 1]
  if (!next) return { pct: 1, missing: [] }
  const missing: string[] = []
  let sum = 0
  let need = 0
  for (const [k, v] of Object.entries(next.gate)) {
    const rv = (rep as unknown as Record<string, number>)[k] ?? 0
    const target = v as number
    const ratio = clamp(rv / target, 0, 1)
    sum += ratio
    need += 1
    if (ratio < 1) missing.push(`${k} ${rv}/${target}`)
  }
  return { pct: need ? sum / need : 1, missing }
}

// ── Job offers / hiring carousel ─────────────────────────────────────────────
export interface InterviewInvite extends JobOffer {
  rival: string // a competing candidate
  rounds: number // 1-3 interview rounds
  fit: number // 0-100 how well your profile fits
}

/**
 * The best club that will consider you scales with your overall reputation:
 * an unproven exec only hears from the league's worst franchises, while a
 * proven résumé opens the bluebloods. Prestige runs ~56 (worst) to ~94 (best),
 * so we map overall rep (0-100) onto a prestige ceiling from the basement up.
 */
export function prestigeCeiling(overall: number): number {
  // rep 30 → ~58 (bottom clubs), rep 55 → ~72 (middling), rep 80+ → ~94 (anyone)
  return clamp(56 + (overall - 28) * 0.75, 56, 99)
}

/** Pick a club that would realistically hire someone with this reputation. */
function pickInterestedTeam(rng: () => number, ceiling: number): string {
  const eligible = NFL_TEAMS.filter((t) => t.prestige <= ceiling)
  const pool = eligible.length ? eligible : NFL_TEAMS
  return rpick(rng, pool).id
}

export function generateJobOffers(world: World, career: CareerState): JobOffer[] {
  const rng = makeRng(world.seed + world.season * 524287 + career.level + (career.path === 'coach' ? 99991 : 0))
  const offers: JobOffer[] = []
  const ladder = ladderFor(career.path)
  const next = ladder[career.level + 1]
  if (!next) return offers
  const rep = career.reputation
  const overall = overallRep(rep)
  const ceiling = prestigeCeiling(overall)
  if (!meetsGate(rep, next)) {
    // Partial qualification can still earn a "reach" interview if you're close.
    const { pct } = progressToNext(rep, career.path, career.level)
    if (pct < 0.85) return offers
  }

  const margin = overall - 40
  const count = margin >= 45 ? 3 : margin >= 25 ? 2 : 1

  for (let i = 0; i < count; i++) {
    const teamId = pickInterestedTeam(rng, ceiling)
    if (offers.some((o) => o.teamId === teamId)) continue
    const interest = clamp(45 + Math.round((overall - 40) * 1.5) + Math.round(rng() * 20), 35, 99)
    offers.push({
      id: `offer_${world.season}_${career.level}_${teamId}`,
      title: next.title,
      teamId,
      tier: next.tier,
      level: next.level,
      salary: salaryFor(career.path, next.level),
      years: 4,
      interest,
      note: `A league club is interested in you for its ${next.title.replace(/Assistant /, '').toLowerCase()} role.`,
    })
  }

  // ── Fast-track: a standout résumé can skip a rung ─────────────────────────
  const skip = ladder[career.level + 2]
  if (skip && !offers.some((o) => o.level === skip.level)) {
    let sum = 0
    let n = 0
    for (const [k, v] of Object.entries(skip.gate)) {
      const rv = (rep as unknown as Record<string, number>)[k] ?? 0
      sum += clamp(rv / (v as number), 0, 1.2)
      n++
    }
    const ready = n ? sum / n : 0
    // Reach + strong overall = the league will interview you a rung ahead.
    if (ready >= 0.9 && overall >= 48) {
      const teamId = pickInterestedTeam(rng, ceiling)
      if (!offers.some((o) => o.teamId === teamId)) {
        offers.push({
          id: `fast_${world.season}_${teamId}`,
          title: skip.title,
          teamId,
          tier: skip.tier,
          level: skip.level,
          salary: salaryFor(career.path, skip.level),
          years: 4,
          interest: clamp(55 + Math.round((overall - 52) * 1.3), 45, 99),
          note: `A standout résumé earns a look PAST the next rung — a fast-track interview for ${skip.title}.`,
        })
      }
    }
  }

  return offers
}

/** Rival candidate names for the interview process. */
const RIVAL_FIRST = ['Marcus', 'Dwayne', 'Elliot', 'Rashad', 'Kirk', 'Byron', 'Nate', 'Terrance', 'Wes', 'Hank']
const RIVAL_LAST = ['Calloway', 'Bishop', 'Vance', 'Hollis', 'Rucker', 'Marsh', 'Fontaine', 'Devers', 'Whitlock', 'Stroud']
export function makeInterview(offer: JobOffer, world: World, career: CareerState, pitch?: string[]): InterviewInvite {
  const rng = makeRng(world.seed + offer.teamId.length * 7919 + career.level)
  const rival = `${rpick(rng, RIVAL_FIRST)} ${rpick(rng, RIVAL_LAST)}`
  // Fit: does your reputation match the role's priorities?
  const t = { coach: COACH_LADDER, personnel: PERSONNEL_LADDER }[career.path][offer.level]
  let fitSum = 0
  let n = 0
  for (const [k, v] of Object.entries(t.gate)) {
    const rv = (career.reputation as unknown as Record<string, number>)[k] ?? 0
    fitSum += clamp(rv / (v as number), 0, 1.2)
    n++
  }
  const fit = Math.round(clamp((n ? fitSum / n : 0.7) * 90, 20, 99))
  // #14: pitch with receipts. Ledger hits count, and the owner's priorities
  // weight which part of your résumé matters.
  const personality = ['meddling', 'patient', 'cheap', 'win-now'][hash32(offer.teamId, 61) % 4]
  const hits = (career.ledger ?? []).filter((e) => e.hit).length
  const baseline = 2 + Math.min(10, hits * 1.0)
  // G4: pitching résumé items that match the club's wants can only help — it
  // raises citations toward the same 12-point ceiling that already exists.
  let citations = baseline
  if (pitch?.length) {
    const { bonus } = pitchBonus(offer, career.path, portfolioItems(world, career), pitch)
    citations = Math.max(baseline, 2 + bonus)
  }
  const pmod = clamp(
    personality === 'win-now' ? (career.reputation.results - 50) * 0.1
    : personality === 'patient' ? (career.reputation.evaluation - 50) * 0.08
    : personality === 'cheap' ? (career.reputation.roster - 50) * 0.08
    : (career.reputation.profile - 50) * 0.08,
    -1.5,
    4,
  )
  const finalFit = Math.round(clamp(fit + citations + pmod, 20, 99))
  return { ...offer, rival, rounds: finalFit >= 80 ? 2 : 3, fit: finalFit }
}

/** Resolve an interview: win the job if your fit beats the rival. */
export function resolveInterview(invite: InterviewInvite, rng: () => number): boolean {
  const rivalStrength = 40 + Math.round(rng() * 45)
  return invite.fit >= rivalStrength
}

export function promote(career: CareerState, offer: JobOffer): CareerState {
  // Excellence at the prior rung carries a head start into the new job.
  const carry = masteryCarryOver(career)
  const rep: Reputation = { ...career.reputation }
  for (const [k, v] of Object.entries(carry)) {
    ;(rep as unknown as Record<string, number>)[k] = clamp(
      ((rep as unknown as Record<string, number>)[k] ?? 0) + (v as number),
      0,
      100,
    )
  }
  rep.profile = clamp(rep.profile + 3, 0, 100)
  return {
    ...career,
    teamId: offer.teamId,
    level: offer.level,
    tier: offer.tier,
    salary: offer.salary,
    jobSecurity: 72,
    // FUTURES 22: the mandate belongs to the club, so a new job means the new
    // owner's expectations — not the old club's.
    ownerExpectation: ownerMandate(offer.teamId, offer.tier),
    reputation: rep,
    history: [
      ...career.history,
      { season: career.season, team: career.teamId, role: tierFor(career.path, career.level).title, record: '', outcome: `Hired as ${offer.title}` },
    ],
  }
}

/** Fired: drop a rung, lose profile, land somewhere smaller. */
export function demote(world: World, career: CareerState): CareerState {
  const rng = makeRng(world.seed + world.season * 13 + career.level)
  const newLevel = Math.max(minNflLevel(career.path), career.level - 1)
  const teamId = rpick(rng, NFL_TEAMS).id
  return {
    ...career,
    teamId,
    level: newLevel,
    tier: 'NFL',
    salary: salaryFor(career.path, newLevel),
    jobSecurity: 55,
    // FUTURES 22: land with a new club — learn its owner's mandate.
    ownerExpectation: ownerMandate(teamId, 'NFL'),
    reputation: { ...career.reputation, profile: clamp(career.reputation.profile - 10, 0, 100), results: clamp(career.reputation.results - 6, 0, 100) },
    history: [
      ...career.history,
      { season: career.season, team: career.teamId, role: tierFor(career.path, career.level).title, record: '', outcome: 'Fired — took a step back' },
    ],
  }
}

// ── Per-role objectives ──────────────────────────────────────────────────────
export interface Objective {
  id: string
  label: string
  target: number
  current: number
  done: boolean
  repReward: Partial<Reputation>
}

/** Which side of the ball the user's role owns. */
export type UnitFocus = 'off' | 'def' | 'both'

/** Compute rank (1 = best) for each team's offense and defense, within its tier. */
export function unitRanks(world: World, tier: 'NFL' | 'FBS' = 'NFL'): Record<string, { off: number; def: number; total: number }> {
  const pool = world.teams.filter((t) => t.tier === tier)
  const scored = pool.map((t) => {
    const players = world.roster[t.id] ?? []
    const off = players.filter((p) => p.side === 'OFF')
    const def = players.filter((p) => p.side === 'DEF')
    const rec = world.standings[t.id]
    const offTalent = off.length ? off.reduce((s, p) => s + p.ovr, 0) / off.length : 65
    const defTalent = def.length ? def.reduce((s, p) => s + p.ovr, 0) / def.length : 65
    const pf = rec?.pointsFor ?? 350
    return { id: t.id, off: offTalent + pf * 0.06, def: defTalent + (700 - (rec?.pointsAgainst ?? 350)) * 0.06 }
  })
  const total = pool.length
  const offRank = [...scored].sort((a, b) => b.off - a.off).map((s) => s.id)
  const defRank = [...scored].sort((a, b) => b.def - a.def).map((s) => s.id)
  const out: Record<string, { off: number; def: number; total: number }> = {}
  for (const t of pool) {
    out[t.id] = { off: offRank.indexOf(t.id) + 1, def: defRank.indexOf(t.id) + 1, total }
  }
  return out
}

/**
 * Objectives for the current role. Every rung has its OWN goals, tied to the job's
 * real verb — a scout files accurate grades, a coordinator ranks a unit, a GM wins.
 * Completing them raises the reputation dimension that gates the next rung.
 */
export function roleObjectives(
  world: World,
  career: CareerState,
  record: { wins: number; losses: number },
  unitRank?: { off: number; def: number; total: number },
): Objective[] {
  const winPct = record.wins / Math.max(1, record.wins + record.losses)
  const recs = career.seasonRecs
  const hits = career.seasonHits
  const acc = recs ? Math.round((hits / recs) * 100) : 0
  const out: Objective[] = []

  const mk = (id: string, label: string, target: number, current: number, repReward: Partial<Reputation>, higherIsBetter = true): Objective => ({
    id, label, target, current, done: higherIsBetter ? current >= target : current <= target, repReward,
  })
  const winGoal = (target: number, reward: Partial<Reputation> = { results: 4 }) =>
    out.push(mk('winpct', `Win ${target}% of games`, target, Math.round(winPct * 100), reward))
  const gradeGoal = (n: number, reward: Partial<Reputation>) =>
    out.push(mk('grades', `File ${n} graded reports`, n, recs, reward))

  // ── PERSONNEL TRACK ────────────────────────────────────────────────────────
  if (career.path === 'personnel') {
    switch (career.level) {
      case 0: // Local Scout — prove accuracy with limited information
        gradeGoal(6, { evaluation: 2 })
        out.push(mk('accuracy', 'Grade accuracy (65%)', 65, acc, { evaluation: 3 }))
        break
      case 1: // Area Scout — volume + a diamond
        gradeGoal(10, { evaluation: 3 })
        out.push(mk('accuracy', 'Grade accuracy (68%)', 68, acc, { evaluation: 3, profile: 1 }))
        break
      case 2: // Regional Scout — build a board against consensus
        gradeGoal(12, { evaluation: 3 })
        out.push(mk('accuracy', 'Board accuracy (70%)', 70, acc, { evaluation: 3, roster: 1 }))
        break
      case 3: // National Scout — cross-check others
        gradeGoal(12, { evaluation: 3 })
        out.push(mk('accuracy', 'Cross-check accuracy (72%)', 72, acc, { evaluation: 3, profile: 2 }))
        break
      case 4: // Asst Dir College Scouting — run the room
        gradeGoal(8, { evaluation: 2 })
        out.push(mk('accuracy', 'Department accuracy (72%)', 72, acc, { evaluation: 3, roster: 2 }))
        winGoal(50, { roster: 3, leadership: 2 })
        break
      case 5: // Dir College Scouting — own the class
        out.push(mk('class', 'Deliver a graded class (5+)', 5, recs, { roster: 3 }))
        out.push(mk('accuracy', 'Board hit rate (70%)', 70, acc, { roster: 3, evaluation: 2 }))
        winGoal(52, { roster: 3, results: 2 })
        break
      case 6: // Dir Player Personnel — pro scouting + contracts
        winGoal(55, { roster: 3, results: 2 })
        out.push(mk('health', 'Keep the cap healthy', 60, capHealth(world, career.teamId), { roster: 2 }))
        out.push(mk('accuracy', 'Scouting accuracy (70%)', 70, acc, { evaluation: 2 }))
        break
      case 7: // Assistant GM — run the building
        winGoal(58, { roster: 3, leadership: 2 })
        out.push(mk('health', 'Keep the cap healthy', 65, capHealth(world, career.teamId), { roster: 3 }))
        out.push(mk('class', 'Deliver a draft class', 5, recs, { roster: 2 }))
        break
      default: // General Manager — final say
        winGoal(62, { results: 5, leadership: 2 })
        out.push(mk('playoffs', 'Make the playoffs', 1, record.wins >= 10 ? 1 : 0, { results: 4, profile: 3 }))
        break
    }
  }

  // ── COACHING TRACK ─────────────────────────────────────────────────────────
  if (career.path === 'coach') {
    switch (career.level) {
      case 0: // Graduate Assistant — service + development
        out.push(mk('develop', 'Develop 2 players', 2, developedCount(world, career), { leadership: 3 }))
        winGoal(45, { leadership: 2 })
        break
      case 1: // Position Coach — develop a room
        out.push(mk('develop', 'Produce 2 draftable players', 2, developedCount(world, career), { leadership: 3, evaluation: 1 }))
        winGoal(50, { leadership: 2, results: 2 })
        break
      case 2: // Coordinator — own a unit
        if (unitRank) {
          const side = career.unitFocus === 'def' ? unitRank.def : unitRank.off
          const label = career.unitFocus === 'def' ? 'Top-third defense' : 'Top-third offense'
          out.push(mk('unit', label, Math.ceil(unitRank.total / 3), side, { results: 4, scheme: 2 } as never, false))
        }
        winGoal(55, { results: 3 })
        gradeGoal(5, { evaluation: 1, profile: 1 })
        break
      case 3: // (legacy rung — not reachable in the NFL-only build)
        winGoal(58, { results: 4, leadership: 2 })
        break
      case 4: // (legacy rung — not reachable in the NFL-only build)
        winGoal(65, { results: 5 })
        break
      case 5: // NFL Position Coach / QC — prove you belong
        out.push(mk('develop', 'Develop 2 NFL contributors', 2, developedCount(world, career), { leadership: 3 }))
        winGoal(55, { results: 3, leadership: 1 })
        break
      case 6: // NFL Coordinator — top-10 unit
        if (unitRank) {
          const side = career.unitFocus === 'def' ? unitRank.def : unitRank.off
          const label = career.unitFocus === 'def' ? 'Top-10 defense' : 'Top-10 offense'
          out.push(mk('unit', label, Math.ceil(unitRank.total / 3), side, { results: 5, scheme: 2 } as never, false))
        }
        winGoal(58, { results: 3 })
        break
      default: // NFL Head Coach
        winGoal(62, { results: 5 })
        out.push(mk('playoffs', 'Make the playoffs', 1, record.wins >= 10 ? 1 : 0, { results: 4, profile: 3 }))
        break
    }
  }

  // Universal: keep the job.
  out.push(mk('security', 'Keep job security above 40%', 40, career.jobSecurity, { leadership: 1 }))
  return out
}

/** Apply the rewards for completed objectives (called at season end). */
export function gradeObjectives(objs: Objective[]): { repDelta: Partial<Reputation>; doneCount: number } {
  const repDelta: Partial<Reputation> = {}
  let doneCount = 0
  for (const o of objs) {
    if (!o.done) continue
    doneCount++
    for (const [k, v] of Object.entries(o.repReward)) {
      ;(repDelta as Record<string, number>)[k] = ((repDelta as Record<string, number>)[k] ?? 0) + (v as number)
    }
  }
  return { repDelta, doneCount }
}

// ── Role mastery: excellence at one rung boosts the next ─────────────────────
/**
 * How well you did your actual job, 0-100. Rises with objectives met, falls with
 * a poor season. Stored per role so a strong run as an Area Scout makes you a
 * better Regional Scout — the "great at each task helps the next" spine.
 */
export function roleKey(path: CareerState['path'], level: number) {
  return `${path}:${level}`
}

export function updateRoleMastery(
  career: CareerState,
  met: number,
  total: number,
  winPct = 0.5,
): Record<string, number> {
  const mastery = { ...(career.roleMastery ?? {}) }
  const key = roleKey(career.path, career.level)
  const prev = mastery[key] ?? 50
  // Objectives are the main signal; results matter for field roles.
  const objScore = total ? met / total : 0.5
  const blended = objScore * 0.75 + winPct * 0.25
  const delta = (blended - 0.5) * 40 // -20 .. +20 per season
  mastery[key] = Math.max(0, Math.min(100, Math.round(prev + delta)))
  return mastery
}

/** Starting reputation bonus at the next rung, from how well you did the last one. */
export function masteryCarryOver(career: CareerState): Partial<Reputation> {
  const mastery = career.roleMastery ?? {}
  const prior = mastery[roleKey(career.path, career.level - 1)] ?? 50
  // 0 mastery → nothing, 100 mastery → a meaningful head start.
  const bonus = Math.round((prior - 50) / 8) // -6 .. +6
  if (bonus <= 0) return {}
  return { profile: bonus, leadership: Math.round(bonus * 0.5) }
}

export function roleMastery(career: CareerState, path?: CareerState['path'], level?: number): number {
  const m = career.roleMastery ?? {}
  return m[roleKey(path ?? career.path, level ?? career.level)] ?? 50
}

// ── Season review ────────────────────────────────────────────────────────────
export interface ReviewResult {
  securityDelta: number
  repDelta: Partial<Reputation>
  skillDelta: Partial<Skills>
  note: string
}

export function reviewSeason(
  _world: World,
  career: CareerState,
  record: { wins: number; losses: number },
  madePlayoffs = false,
  wonTitle = false,
): ReviewResult {
  const pct = record.wins / Math.max(1, record.wins + record.losses)
  const isFieldRole = career.path === 'coach' || career.level >= 3

  if (!isFieldRole) {
    return { securityDelta: 0, repDelta: {}, skillDelta: {}, note: 'Your scouting report was filed with the program.' }
  }

  const winScore = wonTitle ? 1 : madePlayoffs ? 0.82 : pct
  const securityDelta = winScore >= 0.68 ? 10 : winScore >= 0.5 ? 3 : winScore >= 0.35 ? -8 : -18

  const repDelta: Partial<Reputation> = {
    results: Math.round((winScore - 0.5) * 12),
    profile: wonTitle ? 12 : madePlayoffs ? 5 : pct >= 0.6 ? 2 : pct < 0.35 ? -2 : 0,
    leadership: Math.round((winScore - 0.5) * 6),
  }

  const note =
    wonTitle ? 'A championship. Your name is on every shortlist in football.' :
    madePlayoffs ? 'A playoff season. People are taking notice.' :
    winScore >= 0.6 ? 'A strong year keeps you rising.' :
    winScore >= 0.45 ? 'A steady season. You held serve.' :
    winScore >= 0.3 ? 'Ownership expected more. Pressure is mounting.' :
    'A disastrous year. Your job is in serious jeopardy.'

  return { securityDelta, repDelta, skillDelta: { leadership: winScore >= 0.6 ? 3 : 1 }, note }
}

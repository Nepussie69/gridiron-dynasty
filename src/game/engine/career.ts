// ─────────────────────────────────────────────────────────────────────────────
// Career system: reputation, skills, the dual ladder, and the hiring carousel.
//
// You start at the true bottom (grad assistant / local scout). Advancement runs
// on FOUR reputation dimensions plus personal SKILLS. Excellence and smart
// program/role choices accelerate the climb; mediocrity stalls it.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerPath, CareerState, JobOffer, LeagueTier } from '../types'
import { crossOverLevel } from './capabilities'
import { CFB_TEAMS } from '../data/cfbTeams'
import { NFL_TEAMS } from '../data/nflTeams'
import type { World } from './generate'
import { clamp, makeRng, rpick } from './rng'

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

// ── The dual ladder ──────────────────────────────────────────────────────────
export interface CareerTier {
  level: number
  title: string
  tier: LeagueTier
  path: CareerPath | 'both'
  gate: Partial<Reputation> // minimum reputation to be considered
  blurb: string
}

const gate = (r: Partial<Reputation>) => r

/**
 * COACH ladder: on-field roles. Advances on results + leadership + scheme.
 * PERSONNEL ladder: scouting/front office. Advances on evaluation + roster.
 * Both converge on the NFL.
 */
export const COACH_LADDER: CareerTier[] = [
  { level: 0, title: 'Graduate Assistant', tier: 'FBS', path: 'coach', gate: gate({}), blurb: 'Break down film and run the scout team for a Group of Five program.' },
  { level: 1, title: 'Position Coach', tier: 'FBS', path: 'coach', gate: gate({ results: 14, leadership: 14 }), blurb: 'Own a position room. Develop players who get drafted.' },
  { level: 2, title: 'Offensive/Defensive Coordinator', tier: 'FBS', path: 'coach', gate: gate({ results: 34, leadership: 26 }), blurb: 'Call the plays. Your unit is your résumé.' },
  { level: 3, title: 'Group of Five Head Coach', tier: 'FBS', path: 'coach', gate: gate({ results: 52, leadership: 40, profile: 24 }), blurb: 'Run a program. Win your conference.' },
  { level: 4, title: 'Power Four Head Coach', tier: 'FBS', path: 'coach', gate: gate({ results: 70, leadership: 58, profile: 50 }), blurb: 'Blue-blood pressure. Compete for the playoff.' },
  { level: 5, title: 'NFL Position Coach / Quality Control', tier: 'NFL', path: 'coach', gate: gate({ results: 76, profile: 58 }), blurb: 'Cross over to the league and prove you belong.' },
  { level: 6, title: 'NFL Coordinator', tier: 'NFL', path: 'coach', gate: gate({ results: 84, scheme: 60, profile: 70 } as never), blurb: 'Run one side of the ball at the highest level.' },
  { level: 7, title: 'NFL Head Coach', tier: 'NFL', path: 'coach', gate: gate({ results: 90, leadership: 82, profile: 84 }), blurb: 'You answer to the owner now.' },
]

export const PERSONNEL_LADDER: CareerTier[] = [
  { level: 0, title: 'Local Scout', tier: 'FBS', path: 'personnel', gate: gate({}), blurb: 'Break down film for a small program. Prove you can find players.' },
  { level: 1, title: 'Area Scout', tier: 'FBS', path: 'personnel', gate: gate({ evaluation: 16 }), blurb: 'Own a region. File reports that change a roster.' },
  { level: 2, title: 'Regional Scout', tier: 'FBS', path: 'personnel', gate: gate({ evaluation: 30, profile: 14 }), blurb: 'Cover multiple states for a Power program.' },
  { level: 3, title: 'National Scout', tier: 'FBS', path: 'personnel', gate: gate({ evaluation: 44, profile: 26 }), blurb: 'Cross-check the board from coast to coast.' },
  { level: 4, title: 'Assistant Director of College Scouting', tier: 'NFL', path: 'personnel', gate: gate({ evaluation: 58, profile: 40 }), blurb: 'Run the college board for an NFL club.' },
  { level: 5, title: 'Director of College Scouting', tier: 'NFL', path: 'personnel', gate: gate({ evaluation: 70, roster: 50, profile: 52 }), blurb: 'You own the draft board now.' },
  { level: 6, title: 'Director of Player Personnel', tier: 'NFL', path: 'personnel', gate: gate({ evaluation: 78, roster: 68, profile: 64 }), blurb: 'Pro and college. One step from the chair.' },
  { level: 7, title: 'Assistant General Manager', tier: 'NFL', path: 'personnel', gate: gate({ roster: 82, leadership: 70, profile: 76 }), blurb: 'Run the building day to day.' },
  { level: 8, title: 'General Manager', tier: 'NFL', path: 'personnel', gate: gate({ roster: 90, leadership: 82, profile: 84, results: 55 }), blurb: 'Final say on the 53. Go win a championship.' },
]

export function ladderFor(path: CareerPath): CareerTier[] {
  return path === 'coach' ? COACH_LADDER : PERSONNEL_LADDER
}
export function tierFor(path: CareerPath, level: number): CareerTier {
  const ladder = ladderFor(path)
  return ladder[clamp(level, 0, ladder.length - 1)]
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
export function canDraft(career: CareerState) {
  return career.tier === 'NFL' && career.path === 'personnel' && career.level >= 5
}
export function canSignFreeAgents(career: CareerState) {
  return career.tier === 'NFL' && (career.level >= 6 || (career.path === 'coach' && career.level >= 7))
}
export function isGM(career: CareerState) {
  return career.path === 'personnel' && career.level >= 8
}
export function isHeadCoach(career: CareerState) {
  return career.path === 'coach' && career.level >= 7
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

export function generateJobOffers(world: World, career: CareerState): JobOffer[] {
  const rng = makeRng(world.seed + world.season * 524287 + career.level + (career.path === 'coach' ? 99991 : 0))
  const offers: JobOffer[] = []
  const ladder = ladderFor(career.path)
  const next = ladder[career.level + 1]
  if (!next) return offers
  const rep = career.reputation
  const overall = overallRep(rep)
  if (!meetsGate(rep, next)) {
    // Partial qualification can still earn a "reach" interview if you're exceptional.
    const { pct } = progressToNext(rep, career.path, career.level)
    if (pct < 0.92) return offers
  }

  const margin = overall - 40
  const count = margin >= 45 ? 3 : margin >= 25 ? 2 : 1

  for (let i = 0; i < count; i++) {
    let teamId: string
    if (next.tier === 'NFL') {
      teamId = rpick(rng, NFL_TEAMS).id
    } else {
      const target = next.level <= 2 ? 62 : next.level === 3 ? 68 : 82
      const sorted = [...CFB_TEAMS].sort((a, b) => Math.abs(a.prestige - target) - Math.abs(b.prestige - target))
      teamId = rpick(rng, sorted.slice(0, 10)).id
    }
    if (offers.some((o) => o.teamId === teamId)) continue
    const interest = clamp(45 + Math.round((overall - 40) * 1.5) + Math.round(rng() * 20), 35, 99)
    offers.push({
      id: `offer_${world.season}_${career.level}_${teamId}`,
      title: next.title,
      teamId,
      tier: next.tier,
      level: next.level,
      salary: salaryFor(career.path, next.level),
      years: next.tier === 'NFL' ? 4 : 3,
      interest,
      note:
        next.tier === 'NFL'
          ? `A league club is interested in you for its ${next.title.replace(/Assistant /, '').toLowerCase()} role.`
          : `A program wants you as its ${next.title} after your work got noticed.`,
    })
  }

  // ── Cross-over offers ────────────────────────────────────────────────────
  // A college head coach does NOT walk into an NFL HC job. He crosses into an
  // NFL position-coach or coordinator role and must earn the top job from there.
  if (career.path === 'coach' && career.tier === 'FBS' && career.level >= 3 && !offers.some((o) => o.tier === 'NFL')) {
    const crossLevel = crossOverLevel('coach', career.level, 'FBS', 'NFL')
    const crossRole = ladderFor('coach')[crossLevel]
    if (crossRole && overall >= 55 && rng() < 0.7) {
      const teamId = rpick(rng, NFL_TEAMS).id
      offers.push({
        id: `xover_${world.season}_${teamId}`,
        title: crossRole.title,
        teamId,
        tier: 'NFL',
        level: crossLevel,
        salary: salaryFor('coach', crossLevel),
        years: 4,
        interest: clamp(50 + Math.round((overall - 50) * 1.2) + Math.round(rng() * 15), 40, 98),
        note: `A league club wants to bring you in as ${crossRole.title}. College head-coaching success earns a look — but you start over on the NFL side and must work up from here.`,
      })
    }
  }

  return offers
}

/** Rival candidate names for the interview process. */
const RIVAL_FIRST = ['Marcus', 'Dwayne', 'Elliot', 'Rashad', 'Kirk', 'Byron', 'Nate', 'Terrance', 'Wes', 'Hank']
const RIVAL_LAST = ['Calloway', 'Bishop', 'Vance', 'Hollis', 'Rucker', 'Marsh', 'Fontaine', 'Devers', 'Whitlock', 'Stroud']
export function makeInterview(offer: JobOffer, world: World, career: CareerState): InterviewInvite {
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
  return { ...offer, rival, rounds: fit >= 80 ? 2 : 3, fit }
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
  const ladder = ladderFor(career.path)
  const newLevel = Math.max(0, career.level - 1)
  const tier = ladder[newLevel].tier
  let teamId = career.teamId
  if (tier === 'NFL') {
    teamId = rpick(rng, NFL_TEAMS).id
  } else {
    const pool = CFB_TEAMS.filter((t) => t.prestige <= 68)
    teamId = rpick(rng, pool).id
  }
  return {
    ...career,
    teamId,
    level: newLevel,
    tier,
    salary: salaryFor(career.path, newLevel),
    jobSecurity: 55,
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
  _world: World,
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
        out.push(mk('accuracy', 'Department accuracy (72%)', 72, acc, { evaluation: 3, leadership: 2 }))
        winGoal(50, { leadership: 2 })
        break
      case 5: // Dir College Scouting — own the class
        out.push(mk('class', 'Deliver a graded class (5+)', 5, recs, { roster: 3 }))
        out.push(mk('accuracy', 'Board hit rate (70%)', 70, acc, { roster: 2, evaluation: 2 }))
        winGoal(52, { roster: 2, results: 2 })
        break
      case 6: // Dir Player Personnel — pro scouting + contracts
        winGoal(55, { roster: 3, results: 2 })
        out.push(mk('health', 'Keep the cap healthy', 60, 60, { roster: 2 }))
        out.push(mk('accuracy', 'Scouting accuracy (70%)', 70, acc, { evaluation: 2 }))
        break
      case 7: // Assistant GM — run the building
        winGoal(58, { roster: 3, leadership: 2 })
        out.push(mk('health', 'Keep the cap healthy', 65, 65, { roster: 3 }))
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
        out.push(mk('develop', 'Develop 2 players', 2, 0, { leadership: 3 }))
        winGoal(45, { leadership: 2 })
        break
      case 1: // Position Coach — develop a room
        out.push(mk('develop', 'Produce 2 draftable players', 2, 0, { leadership: 3, evaluation: 1 }))
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
      case 3: // Group of Five Head Coach — build a program
        winGoal(58, { results: 4, leadership: 2 })
        out.push(mk('season', 'Win 9+ games', 9, record.wins, { results: 3, profile: 3 }))
        out.push(mk('recruit', 'Land a top-60 class', 60, 60, { recruiting: 2, profile: 2 } as never))
        break
      case 4: // Power Four Head Coach — perform under pressure
        winGoal(65, { results: 5 })
        out.push(mk('season', 'Win 10+ games', 10, record.wins, { results: 4, profile: 4 }))
        out.push(mk('recruit', 'Land a top-15 class', 15, 15, { recruiting: 2, profile: 2 } as never))
        break
      case 5: // NFL Position Coach / QC — prove you belong
        out.push(mk('develop', 'Develop 2 NFL contributors', 2, 0, { leadership: 3 }))
        winGoal(55, { results: 2, leadership: 1 })
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

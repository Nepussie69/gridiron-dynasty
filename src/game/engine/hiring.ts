// ─────────────────────────────────────────────────────────────────────────────
// Staff hiring.
//
// Coaches have their own interest in a job, driven by your reputation, the
// program's prestige, and the role's salary. Elite candidates will turn you down
// if you're nobody; you may have to settle — or sell them on the vision.
// ─────────────────────────────────────────────────────────────────────────────

import type { StaffMember } from '../types'
import { coachEffect } from './coaching'
import type { World } from './generate'
import { FIRST, LAST } from './names'
import { clamp, hash32, type Rng } from './rng'
import type { Reputation } from './career'

export interface HireCandidate extends StaffMember {
  interest: number // 0-100 how much they want this job
  askingSalary: number // what they want per year
  negotiationRound: number
}

/** Schemes a candidate can be hired to run, by role family. */
export const OFF_SCHEMES = ['Air Raid', 'Pro Style', 'Spread', 'West Coast', 'RPO Heavy']
export const DEF_SCHEMES = ['4-3 Base', '3-4 Base', '4-2-5 Nickel', 'Multiple', 'Blitz Heavy']

// ── L11.5 Q8: front-office staff have focus + front-office specialties ─────────
export const SCOUT_FOCUS = ['College East', 'College West', 'Pro', 'Character']
export const DPP_FOCUS = ['Pro scouting', 'Negotiation', 'Cap', 'Analytics']
export const FRONT_SPECIALTIES = ['Talent ID', 'Character reads', 'Negotiation', 'Cap management', 'Analytics']

// ── FUTURES 19: the analytics department ─────────────────────────────────────
// A dedicated front-office lane you hire from (one analyst at a time). Analysts
// sharpen the information you see — win probability, 4th-down advice and opponent
// tendencies — and never touch the sim itself. Candidates live in a separate
// `world.analyticsPool` (optional; generated deterministically) so the AI market
// and every existing save are untouched.
export const ANALYTICS_ROLE = 'Analytics'
export const ANALYTICS_SPECIALTIES = ['Win probability', 'Fourth downs', 'Tendencies', 'Situation models']

/** Deterministic analyst candidates for one world seed — no rng() draws. */
export function generateAnalyticsPool(seed: number, count = 4): StaffMember[] {
  return Array.from({ length: count }, (_, i) => {
    const h = hash32(`analytics|${seed}|${i}`, 17)
    const rating = 58 + (h % 35) // 58..92
    const id = `an_${seed}_${i}`
    return {
      id,
      name: `${FIRST[h % FIRST.length]} ${LAST[(h >>> 8) % LAST.length]}`,
      role: ANALYTICS_ROLE,
      age: 30 + ((h >>> 16) % 28),
      rating,
      specialty: ANALYTICS_SPECIALTIES[h % ANALYTICS_SPECIALTIES.length],
      scheme: 'Analytics',
      focus: ANALYTICS_SPECIALTIES[h % ANALYTICS_SPECIALTIES.length],
      annual: Math.round((0.9 + (rating / 100) * 2.2) * 1_000_000),
      contractYears: 3,
      teamId: null,
      status: 'Available' as const,
    } satisfies StaffMember
  })
}

export function isFrontOfficeRole(role: string): boolean {
  return role === 'Scout' || role === 'Director of Player Personnel' || role === 'General Manager' || role === ANALYTICS_ROLE
}

/** Focus options for a front-office role (empty for coaches). */
export function focusOptions(role: string): string[] {
  if (role === 'Scout') return SCOUT_FOCUS
  if (role === 'Director of Player Personnel' || role === 'General Manager') return DPP_FOCUS
  return []
}

/**
 * Deterministic front-office profile derived from the staff id (no rng draws),
 * used both when generating staff and when migrating legacy saves.
 */
export function frontOfficeProfile(role: string, id: string): { focus?: string; specialty?: string } {
  if (!isFrontOfficeRole(role)) return {}
  const opts = focusOptions(role)
  return {
    focus: opts.length ? opts[hash32(id, 11) % opts.length] : undefined,
    specialty: FRONT_SPECIALTIES[hash32(id, 23) % FRONT_SPECIALTIES.length],
  }
}

export function schemesForRole(role: string): string[] {
  if (role.includes('Offensive') || role === 'QB Coach' || role === 'OL Coach') return OFF_SCHEMES
  if (role.includes('Defensive') || role === 'DL Coach' || role === 'Secondary Coach') return DEF_SCHEMES
  return []
}

/** Reputation of the program/club from the candidate's point of view. */
function destinationAppeal(world: World, teamId: string): number {
  const t = world.byId[teamId]
  if (!t) return 50
  // Prestige is the base; a strong current staff raises the ceiling.
  const effect = coachEffect(world, teamId)
  return clamp(t.prestige * 0.8 + effect.headCoach * 0.2, 20, 98)
}

/** How attractive the user's reputation is to a coach. */
function repAppeal(rep: Reputation): number {
  const leadership = rep.leadership
  const results = rep.results
  const profile = rep.profile
  return clamp(leadership * 0.4 + results * 0.35 + profile * 0.25, 0, 98)
}

/**
 * Compute a candidate's interest in joining your staff.
 * High-rated coaches are pickier; a strong destination and your reputation help.
 */
export function computeInterest(
  world: World,
  teamId: string,
  rep: Reputation,
  member: StaffMember,
  salaryOffer: number,
): number {
  const dest = destinationAppeal(world, teamId)
  const you = repAppeal(rep)
  // A coach wants: a good destination, a respected boss, and fair money.
  const moneyPull = salaryOffer >= member.annual ? 12 : salaryOffer >= member.annual * 0.85 ? 4 : -12
  // Elite coaches (85+) are hard to land without a strong profile.
  const elitism = member.rating >= 88 ? -18 : member.rating >= 80 ? -8 : member.rating >= 70 ? 0 : 8
  const interest =
    dest * 0.3 + you * 0.35 + moneyPull + elitism + (member.rating >= 85 && you < 55 ? -14 : 0) + 16
  return clamp(Math.round(interest), 2, 99)
}

/** Candidates currently interested in your open role. */
export function openCandidates(
  world: World,
  teamId: string,
  rep: Reputation,
  role?: string,
): HireCandidate[] {
  // FUTURES 19: the analytics pool is separate (user-only). A fired analyst
  // returns to staffPool, so both sources are merged here.
  const pool = [
    ...(world.analyticsPool ?? []).filter((m) => m.status === 'Available' && (!role || m.role === role)),
    ...world.staffPool.filter((m) => m.status === 'Available' && (!role || m.role === role)),
  ]
  const out: HireCandidate[] = []
  for (const m of pool.slice(0, 24)) {
    const asking = Math.round(m.annual * (1 + (100 - destinationAppeal(world, teamId)) / 200))
    const interest = computeInterest(world, teamId, rep, m, asking)
    out.push({ ...m, askingSalary: asking, interest, negotiationRound: 0 })
  }
  out.sort((a, b) => b.interest - a.interest || b.rating - a.rating)
  return out
}

export interface HireResult {
  signed: boolean
  candidate: HireCandidate
  message: string
}

/**
 * Attempt to hire. Salary affects the odds; lowball an elite coach and he walks.
 */
export function attemptHire(
  world: World,
  teamId: string,
  rep: Reputation,
  candidate: HireCandidate,
  salaryOffer: number,
  rng: Rng,
  /** FUTURES 25: an owner-funded hire adds pull (default 0 = unchanged). */
  interestBonus = 0,
): HireResult {
  const interest = clamp(computeInterest(world, teamId, rep, candidate, salaryOffer) + interestBonus, 0, 99)
  // Convert interest to a hire probability.
  const prob = clamp(interest / 100 - (candidate.rating - 75) * 0.004, 0.05, 0.95)
  const roll = rng()
  if (roll < prob) {
    return { signed: true, candidate: { ...candidate, interest }, message: `${candidate.name} signed as ${candidate.role}.` }
  }
  const reason =
    interest < 35
      ? `${candidate.name} isn't interested in joining a program at your level.`
      : interest < 60
        ? `${candidate.name} was intrigued but took another job.`
        : `${candidate.name} nearly signed but the money wasn't right.`
  return { signed: false, candidate: { ...candidate, interest }, message: reason }
}

/** Apply a successful hire: add to staff, remove from pool. Optionally set the scheme. */
export function applyHire(world: World, teamId: string, candidate: HireCandidate, salary: number, scheme?: string) {
  const member: StaffMember = {
    ...candidate,
    teamId,
    status: 'Hired',
    annual: salary,
    contractYears: 3,
    scheme: scheme ?? candidate.scheme,
  }
  delete (member as unknown as Record<string, unknown>).interest
  delete (member as unknown as Record<string, unknown>).askingSalary
  delete (member as unknown as Record<string, unknown>).negotiationRound
  // Replace an existing coach in the same role, if any.
  const staff = world.staff[teamId] ?? (world.staff[teamId] = [])
  const idx = staff.findIndex((m) => m.role === member.role)
  if (idx >= 0) staff[idx] = member
  else staff.push(member)
  world.staffPool = world.staffPool.filter((m) => m.id !== candidate.id)
  if (candidate.role === ANALYTICS_ROLE) {
    world.analyticsPool = (world.analyticsPool ?? []).filter((m) => m.id !== candidate.id)
  }
  return member
}

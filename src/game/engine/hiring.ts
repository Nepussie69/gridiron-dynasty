// ─────────────────────────────────────────────────────────────────────────────
// Staff hiring.
//
// Coaches have their own interest in a job, driven by your reputation, the
// program's prestige, and the role's salary. Elite candidates will turn you down
// if you're nobody; you may have to settle — or sell them on the vision.
// ─────────────────────────────────────────────────────────────────────────────

import type { StaffMember } from '../types'
import { coachEffect } from './coaching'
import { contractYearsForSalary, staffBuyout } from './staffMarket'
import type { World } from './generate'
import { FIRST, LAST } from './names'
import { noteCoordinatorChange } from './playbook'
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
 * Backlog 398: what a coach asks for from *your* club — his market annual scaled
 * by how much he wants the destination (a weak program has to overpay).
 * `salaryOffer / askingFor(...)` is the ratio the money curve is anchored to.
 */
function askingFor(dest: number, annual: number): number {
  return Math.max(1, Math.round(annual * (1 + (100 - dest) / 200)))
}

/**
 * Backlog 398: how much a dollar actually moves THIS coach (never a team average).
 *
 * - a stable per-person "money/ambition" trait from his id (0.88–1.12);
 * - age: veterans take the last big deal, rookies are building (0.86–1.14);
 * - rating: elite coaches are not bought — money moves them less than the
 *   destination and your reputation, so cash alone can't land an 88+ name.
 */
export function moneyAppetite(member: StaffMember): number {
  const trait = 0.88 + ((hash32(`cash|${member.id}`, 79) % 101) / 100) * 0.24
  const age = clamp(1 + (member.age - 39) * 0.011, 0.86, 1.14)
  const elite = member.rating >= 88 ? 0.74 : member.rating >= 82 ? 0.84 : member.rating >= 74 ? 0.94 : 1.04
  return trait * age * elite
}

/**
 * Backlog 398: the money curve. Continuous and monotonic in the offer, anchored
 * to the asking price `r = offer / ask`:
 *   r 0.70 → ≈ −12   (a real lowball still stings)
 *   r 0.85 → ≈  −1   (just under what he wants)
 *   r 1.00 → ≈  +9   (he gets his number)
 *   r 1.30 → ≈ +24   (a clearly better deal)
 *   r 1.50 → ≈ +31   (top of the slider — diminishing returns, never infinite)
 * `66 − 156·e^{−r}` is concave, so each extra dollar past the ask buys less.
 */
function moneyCurve(r: number): number {
  return 66 - 156 * Math.exp(-r)
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
  // A coach wants: a good destination, a respected boss, and fair money. Money
  // rises smoothly with the offer and keeps paying past the ask — scaled to him.
  const ask = askingFor(dest, member.annual)
  const moneyPull = clamp(moneyCurve(salaryOffer / ask) * moneyAppetite(member), -24, 34)
  // Elite coaches (85+) are hard to land without a strong profile.
  const elitism = member.rating >= 88 ? -18 : member.rating >= 80 ? -8 : member.rating >= 70 ? 0 : 8
  const interest =
    dest * 0.3 + you * 0.35 + moneyPull + elitism + (member.rating >= 85 && you < 55 ? -14 : 0) + 16
  return clamp(Math.round(interest), 2, 99)
}

/** Backlog 398: interest → the odds he signs (one definition, UI and engine). */
export function hireProbability(interest: number, rating: number): number {
  return clamp(interest / 100 - (rating - 75) * 0.004, 0.05, 0.95)
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
    const asking = askingFor(destinationAppeal(world, teamId), m.annual)
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
  const prob = hireProbability(interest, candidate.rating)
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

/** The result of a completed hire — the new seat holder, who lost it, and the dead money owed. */
export interface HireApplied {
  member: StaffMember
  /** The coach who lost the seat, if the hire replaced someone mid-contract. */
  replaced?: StaffMember
  /** §7: 50% of the replaced coach's remaining years × annual, as dead staff money. */
  deadMoney: number
}

/**
 * Apply a successful hire: add to staff, remove from pool. Optionally set the
 * scheme. FUTURES #28: contract length now comes from the salary tier (2–4 years)
 * and replacing a coach mid-contract reports a buyout to be banked as dead money
 * (the store records it via `addStaffDeadMoney`).
 */
export function applyHire(
  world: World,
  teamId: string,
  candidate: HireCandidate,
  salary: number,
  scheme?: string,
): HireApplied {
  const member: StaffMember = {
    ...candidate,
    teamId,
    status: 'Hired',
    annual: salary,
    contractYears: contractYearsForSalary(salary),
    scheme: scheme ?? candidate.scheme,
  }
  delete (member as unknown as Record<string, unknown>).interest
  delete (member as unknown as Record<string, unknown>).askingSalary
  delete (member as unknown as Record<string, unknown>).negotiationRound
  // Replace an existing coach in the same role, if any.
  const staff = world.staff[teamId] ?? (world.staff[teamId] = [])
  const idx = staff.findIndex((m) => m.role === member.role)
  let replaced: StaffMember | undefined
  let deadMoney = 0
  if (idx >= 0) {
    replaced = staff[idx]
    deadMoney = replaced.contractYears > 0 ? staffBuyout(replaced) : 0
    staff[idx] = member
  } else {
    staff.push(member)
  }
  world.staffPool = world.staffPool.filter((m) => m.id !== candidate.id)
  if (candidate.role === ANALYTICS_ROLE) {
    world.analyticsPool = (world.analyticsPool ?? []).filter((m) => m.id !== candidate.id)
  }
  // Backlog 185 (fix): a new OC/DC (or a scheme install) resets continuity now, at
  // the moment of the hire — not a season later at the regular-season tick.
  const side = member.role === 'Offensive Coordinator' ? 'off' : member.role === 'Defensive Coordinator' ? 'def' : null
  if (side) noteCoordinatorChange(world, teamId, side)
  return { member, replaced, deadMoney }
}

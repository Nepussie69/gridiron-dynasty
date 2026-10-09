// ─────────────────────────────────────────────────────────────────────────────
// Owner meetings (L15 · FUTURES row 25 "Ask the GM / owner meetings").
//
// A few times a season the club's owner calls you in. Personality comes from
// `owner.ts` (FUTURES 22): patient builders, win-now spenders, meddlers and
// bean-counters all read the same pitch very differently. You can ask for one
// of three things per meeting:
//
//   · budget   — more football-operations money (scouting travel / your room /
//                combine hours, or a paid clinic when the rung has none)
//   · patience — a season's grace: the owner won't judge you on this one
//   · staff    — money for the building and the staff room (a funded hire)
//
// Everything here is deterministic. There is no sim rng draw: the owner's mood
// beyond his fixed threshold is a stable hash of (club, season, window, ask),
// so the same career state always produces the same answer and the AI-vs-AI sim
// never moves. Meetings are user-initiated and user-only, so the feature is
// opt-in/neutral by default.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState } from '../types'
import type { World } from './generate'
import { clamp, hash32 } from './rng'
import { ownerName, ownerProfile, type OwnerPersonality } from './owner'
import { travelOpen } from './scoutTravel'
import { hasRoom } from './room'

export type OwnerAsk = 'budget' | 'patience' | 'staff'
export type OwnerMeetingOutcome = 'agreed' | 'partial' | 'declined'

/** Weeks a meeting window opens (window 0, 1, 2). */
export const MEETING_WEEKS = [5, 11, 17] as const

export const OWNER_ASK_LABEL: Record<OwnerAsk, string> = {
  budget: 'More budget',
  patience: 'Patience',
  staff: 'Facility & staff money',
}

export const OWNER_ASK_BLURB: Record<OwnerAsk, string> = {
  budget: 'Ask for more to spend on the football operation.',
  patience: 'Ask him not to judge you on this season.',
  staff: 'Ask him to fund the building and one staff hire.',
}

/** One meeting that happened, kept on the save (newest last, capped). */
export interface OwnerMeetingEntry {
  season: number
  /** 0 | 1 | 2 — which meeting window this was. */
  window: number
  week: number
  ask: OwnerAsk
  outcome: OwnerMeetingOutcome
  message: string
  /** Human labels for what the owner actually handed over. */
  grants: string[]
}

/** The meeting book. Every field is optional so legacy saves load untouched. */
export interface OwnerMeetingState {
  log: OwnerMeetingEntry[]
  /** Season the owner promised not to judge you (firing protection). */
  graceSeason?: number
  /** Season the owner will fund one staff hire. */
  staffFundSeason?: number
  /** Whether that funded hire has been used yet. */
  staffFundUsed?: boolean
  /** Season the owner topped up the staff budget, and the amount. */
  staffBudgetSeason?: number
  staffBudget?: number
}

/** What the owner hands over when he agrees. Applied by the store. */
export interface OwnerGrant {
  patience?: boolean
  staffFund?: boolean
  staffBudget?: number
  travel?: number
  room?: number
  combine?: number
  skillPoints?: number
  jobSecurity?: number
}

export interface OwnerMeetingResult {
  ask: OwnerAsk
  outcome: OwnerMeetingOutcome
  reason: string
  message: string
  headline: string
  grant: OwnerGrant
}

/** Normalize the meeting book (legacy saves have none). */
export function meetingState(career: CareerState): OwnerMeetingState {
  return career.ownerMeeting ?? { log: [] }
}

/** Which meeting window a week falls in, or −1 before the first one. */
export function meetingWindow(week: number): number {
  let win = -1
  MEETING_WEEKS.forEach((mw, i) => {
    if (week >= mw) win = i
  })
  return win
}

/** The current window and whether you still owe the owner a meeting in it. */
export function meetingDue(world: World, career: CareerState): { window: number; open: boolean } {
  if (career.tier !== 'NFL' || career.level <= 0) return { window: -1, open: false }
  if (world.phase !== 'regular') return { window: -1, open: false }
  const win = meetingWindow(world.week)
  if (win < 0) return { window: -1, open: false }
  const used = meetingState(career).log.some((e) => e.season === world.season && e.window === win)
  return { window: win, open: !used }
}

/** How the owner reads you right now, 0–100 (leadership, security, record). */
export function meetingStanding(world: World, career: CareerState): number {
  const r = world.standings[career.teamId]
  const wins = r?.wins ?? 0
  const losses = r?.losses ?? 0
  const ties = r?.ties ?? 0
  const played = Math.max(1, wins + losses + ties)
  const winPct = (wins + ties * 0.5) / played
  const raw = career.reputation.leadership * 0.4 + career.jobSecurity * 0.3 + winPct * 100 * 0.3
  return Math.round(clamp(raw, 0, 100))
}

/** Results tilt: winning this season buys goodwill; losing erodes it. */
export function resultsBonus(world: World, career: CareerState): number {
  const r = world.standings[career.teamId]
  const wins = r?.wins ?? 0
  const losses = r?.losses ?? 0
  const ties = r?.ties ?? 0
  const played = Math.max(1, wins + losses + ties)
  const winPct = (wins + ties * 0.5) / played
  return Math.round((winPct - 0.5) * 40) + (winPct >= 0.6 ? 6 : 0)
}

/** Personality is the loudest voice in the room. */
const BIAS: Record<OwnerAsk, Record<OwnerPersonality, number>> = {
  patience: { patient: 18, meddling: 6, cheap: -6, 'win-now': -12 },
  budget: { 'win-now': 8, patient: 6, meddling: -2, cheap: -16 },
  staff: { patient: 6, 'win-now': 0, meddling: -6, cheap: -18 },
}

const PASS: Record<OwnerAsk, number> = { patience: 56, budget: 50, staff: 56 }
const PARTIAL: Record<OwnerAsk, number> = { patience: 44, budget: 40, staff: 44 }

/** A small mandate nudge: builders invest in the long term, win-now owners in players. */
function mandateNudge(ask: OwnerAsk, career: CareerState): number {
  const m = (career.ownerExpectation ?? '').toLowerCase()
  const rebuild = /draft|build|young|three-year/.test(m)
  const winNow = /playoff|championship|title|win now|make a change/.test(m)
  if (rebuild) return ask === 'staff' ? 6 : ask === 'budget' ? 4 : 4
  if (winNow) return ask === 'staff' ? -6 : ask === 'budget' ? 2 : -4
  return 0
}

/** Which budget channels this rung can actually use. */
export function budgetChannels(world: World, career: CareerState): { travel: boolean; room: boolean; combine: boolean } {
  const combineRung = career.path === 'personnel' && (career.level === 4 || career.level === 5)
  return { travel: travelOpen(world, career), room: hasRoom(career), combine: combineRung }
}

/** Half-grants for a partial answer. */
function budgetGrant(world: World, career: CareerState, full: boolean): OwnerGrant {
  const ch = budgetChannels(world, career)
  const grant: OwnerGrant = {}
  if (ch.travel) grant.travel = full ? 4 : 2
  if (ch.room) grant.room = full ? 3 : 1
  if (ch.combine) grant.combine = full ? 4 : 2
  if (!ch.travel && !ch.room && !ch.combine) {
    // No spendable budget at this rung: the owner pays for a clinic instead,
    // or (on a partial) simply warms to you.
    if (full) grant.skillPoints = 1
    else grant.jobSecurity = 2
  }
  return grant
}

const money = (n: number) => `$${(n / 1e6).toFixed(0)}M`

/** Human labels for a grant, for the card and the inbox. */
export function grantLabels(grant: OwnerGrant): string[] {
  const out: string[] = []
  if (grant.patience) out.push('A season of grace — no firing this season')
  if (grant.staffFund) out.push('Owner-funded staff hire this season')
  if (grant.staffBudget) out.push(`${money(grant.staffBudget)} added to the staff budget`)
  if (grant.travel) out.push(`${grant.travel} extra scouting trips`)
  if (grant.room) out.push(`${grant.room} extra development reps`)
  if (grant.combine) out.push(`${grant.combine} extra combine hours`)
  if (grant.skillPoints) out.push(`${grant.skillPoints} skill point`)
  if (grant.jobSecurity) out.push(`${grant.jobSecurity > 0 ? '+' : ''}${grant.jobSecurity} job security`)
  return out
}

/**
 * The owner's deterministic answer to one ask. Pure: it never mutates the
 * career or the world, so the probe can preview every pitch safely.
 */
export function resolveOwnerMeeting(world: World, career: CareerState, ask: OwnerAsk): OwnerMeetingResult {
  const profile = ownerProfile(career.teamId)
  const who = ownerName(career.teamId)
  const window = Math.max(0, meetingWindow(world.week))
  const standing = meetingStanding(world, career)
  const results = resultsBonus(world, career)
  const jitter = (hash32(`${career.teamId}:${world.season}:${window}:${ask}`, 7) % 17) - 8
  const score = standing + results + BIAS[ask][profile.personality] + mandateNudge(ask, career) + jitter
  const headline = `${who} (${profile.label}) on your ${OWNER_ASK_LABEL[ask].toLowerCase()} ask`

  const passed = score >= PASS[ask]
  const close = !passed && score >= PARTIAL[ask]

  if (ask === 'patience') {
    if (passed) {
      return {
        ask,
        outcome: 'agreed',
        reason: 'agreed',
        message: `"You have earned another look. I won't judge you on this season — but I expect to see the plan working next year."`,
        headline,
        grant: { patience: true, jobSecurity: 5 },
      }
    }
    if (close) {
      return {
        ask,
        outcome: 'partial',
        reason: 'close',
        message: `"I'm not writing off a season, but I'll back you publicly. Show me something."`,
        headline,
        grant: { jobSecurity: 6 },
      }
    }
    return {
      ask,
      outcome: 'declined',
      reason: 'results',
      message: profile.personality === 'win-now'
        ? `"Patience? I bought this roster to win now. Fix it."`
        : `"Ask me again when the results give me a reason to."`,
      headline,
      grant: { jobSecurity: -4 },
    }
  }

  if (ask === 'budget') {
    if (passed) {
      const grant = { ...budgetGrant(world, career, true), jobSecurity: 2 }
      return {
        ask,
        outcome: 'agreed',
        reason: 'agreed',
        message: profile.personality === 'cheap'
          ? `"Fine — but every dollar has to show up on the board."`
          : `"The money's there. Spend it like it's yours."`,
        headline,
        grant,
      }
    }
    if (close) {
      const grant = budgetGrant(world, career, false)
      return {
        ask,
        outcome: 'partial',
        reason: 'close',
        message: `"I can find you a little. Not the whole number you asked for."`,
        headline,
        grant,
      }
    }
    return {
      ask,
      outcome: 'declined',
      reason: 'budget',
      message: profile.personality === 'cheap'
        ? `"The books are tight because you made them tight. No new money."`
        : `"Not this year — bring me results and we'll talk about money."`,
      headline,
      grant: {},
    }
  }

  // staff
  if (passed) {
    return {
      ask,
      outcome: 'agreed',
      reason: 'agreed',
      message: `"I'll fund the building. Go get the right people to fill it."`,
      headline,
      grant: { staffFund: true, staffBudget: 8_000_000, jobSecurity: 2 },
    }
  }
  if (close) {
    return {
      ask,
      outcome: 'partial',
      reason: 'close',
      message: `"I'll put some money into the building — but the hire is on you to land."`,
      headline,
      grant: { staffBudget: 4_000_000, jobSecurity: 2 },
    }
  }
  return {
    ask,
    outcome: 'declined',
    reason: 'budget',
    message: profile.personality === 'cheap'
      ? `"Facilities don't win games. The draft does. No."`
      : `"The building can wait. Win first."`,
    headline,
    grant: { jobSecurity: -2 },
  }
}

/** Is the owner's season of grace active? Used by the firing check. */
export function ownerGraceActive(career: CareerState, season: number): boolean {
  return meetingState(career).graceSeason === season
}

/** The staff-budget top-up the owner granted this season, if any. */
export function ownerStaffBudgetBonus(career: CareerState, season: number): number {
  const s = meetingState(career)
  return s.staffBudgetSeason === season ? (s.staffBudget ?? 0) : 0
}

/** A ready, unconsumed owner-funded hire this season. */
export function ownerStaffFundOpen(career: CareerState, season: number): boolean {
  const s = meetingState(career)
  return s.staffFundSeason === season && !s.staffFundUsed
}

/** Extra candidate interest, in points, from an owner-funded hire. */
export const OWNER_STAFF_FUND_INTEREST = 30

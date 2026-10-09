// ─────────────────────────────────────────────────────────────────────────────
// FUTURES 12: contract life events — holdouts, franchise/transition tags and
// fifth-year options.
//
// Everything here is a CONTRACT decision, never a sim input. Holdouts move a
// player's morale (which only feeds extension talks) and a club's cap; tags and
// options only change contracts. No `rng()` stream is touched — the one bit of
// chance (does a star hold out?) is a deterministic `hash32` draw, so the
// calibration equivalence probe is unaffected.
//
// The AI is deliberately inert here: AI clubs never tag, never exercise a
// fifth-year option and never hold out. That keeps AI-vs-AI results byte-for-byte
// what they were before this feature; every move below is opt-in for the user's
// own club.
// ─────────────────────────────────────────────────────────────────────────────

import type { Contract, Player } from '../types'
import type { World } from './generate'
import { capForSeason, capScale, marketAAV, recomputeCapHit, tagValue } from './cap'
import { hash32 } from './rng'
import { unscaleOvr } from './ovrScale'

/** The un-scaled OVR a player must clear to count as a star for a holdout. */
const HOLDOUT_STAR_RAW = 78
/** The un-scaled OVR a player must clear to be worth a tag. */
const TAG_STAR_RAW = 78
/** How far under his market rate a final-year player must sit to hold out. */
const HOLDOUT_UNDERPAID = 1.05
/** Share of qualifying stars who actually hold out (deterministic). */
const HOLDOUT_RATE = 70

/** A holdout filed for one season. Optional — a legacy save simply has none. */
export interface HoldoutState {
  season: number
  /** The AAV his camp is asking for, in dollars. */
  demand: number
  status: 'open' | 'resolved'
  /** How it ended: paid, tagged, shopped on the trade block, or reported. */
  resolution?: 'paid' | 'tagged' | 'trade' | 'report'
}

/** A franchise or transition tag applied for one season. */
export interface TagState {
  season: number
  kind: 'franchise' | 'transition'
}

/** A Round-1 rookie's fifth-year option decision. */
export interface OptionState {
  season: number
  kind: 'exercise' | 'decline'
  /** The option-year salary in dollars. */
  value: number
}

/**
 * The fifth-year option salary. The real formula averages top salaries at the
 * position; we approximate with the transition-tag number (top-5 cap hits × 1.05).
 */
export function fifthYearOptionValue(players: Player[], p: Player): number {
  return tagValue(players, p.pos, 'transition')
}

/** The franchise / transition tag salary for a player (incl. the 120% floor). */
export function tagSalary(players: Player[], p: Player, kind: 'franchise' | 'transition'): number {
  return tagValue(players, p.pos, kind, p.contract.annual ?? 0)
}

/**
 * Add one fully-guaranteed year at `value` to a contract. This is the shared
 * shape behind both a tag and an exercised fifth-year option: the player's
 * remaining year is untouched, and the new year sits on the end at a known price.
 */
export function addGuaranteedYear(c: Contract, value: number, season: number): Contract {
  const base = [...(c.base ?? []), value]
  const years = (c.years ?? 0) + 1
  const next: Contract = {
    ...c,
    years,
    length: (c.length ?? c.years ?? 0) + 1,
    base,
    guaranteed: (c.guaranteed ?? 0) + value,
    annual: Math.round(((c.annual ?? value) * (c.years ?? 1) + value) / years),
    signedThrough: season + years - 1,
    fifthYearOption: false,
  }
  return recomputeCapHit(next)
}

/**
 * A star in the final year or two of a deal that is well under his market rate.
 * Rookies are excluded (their option is a separate decision).
 */
export function holdoutCandidate(p: Player, season: number): boolean {
  if (p.contract.years < 1 || p.contract.years > 2 || p.contract.rookie) return false
  if (unscaleOvr(p.ovr) < HOLDOUT_STAR_RAW) return false
  const annual = p.contract.annual ?? 0
  if (annual <= 0) return false
  const market = marketAAV(p.ovr, p.pos, p.age) * capScale(season)
  return market / annual >= HOLDOUT_UNDERPAID
}

/** Deterministic yes/no: does this candidate hold out this offseason? */
export function holdsOut(p: Player, season: number): boolean {
  return hash32(`${p.id}:${season}:holdout`, 977) % 100 < HOLDOUT_RATE
}

/** His camp's opening demand: the plain market ask, rounded to $100K. */
export function holdoutDemand(p: Player, season: number): number {
  const market = marketAAV(p.ovr, p.pos, p.age) * capScale(season)
  return Math.round(market / 1e5) * 1e5
}

/**
 * Flag this offseason's holdouts for one club. Called at season end for the
 * user's club only. Writes to the canonical player objects and returns how many
 * were filed. A player already holding out (or one resolved this season) is left
 * alone. A filed holdout is unhappy: he loses a little morale and will skip camp
 * (the between-season mastery gain) until it is resolved.
 */
export function flagHoldouts(world: { roster: Record<string, Player[]> }, teamId: string, season: number): number {
  const roster = world.roster[teamId] ?? []
  let filed = 0
  for (const p of roster) {
    if (p.holdout?.season === season) continue
    if (!holdoutCandidate(p, season) || !holdsOut(p, season)) continue
    p.holdout = { season, demand: holdoutDemand(p, season), status: 'open' }
    p.morale = Math.max(1, p.morale - 5)
    filed++
  }
  return filed
}

/** Is this player eligible to receive a tag? A star in his final year, not a rookie deal. */
export function tagEligible(p: Player): boolean {
  return p.contract.years === 1 && !p.contract.rookie && unscaleOvr(p.ovr) >= TAG_STAR_RAW
}

/** Has the club already used this kind of tag this season? */
export function tagUsed(roster: Player[], kind: 'franchise' | 'transition', season: number): boolean {
  return roster.some((p) => p.tag?.season === season && p.tag.kind === kind)
}

/**
 * A Round-1 rookie on the last year of his rookie scale, option not yet decided.
 * `fifthYearOption` is cleared once he decides, so he drops off the list.
 */
export function optionEligible(p: Player, season: number): boolean {
  if (!p.contract.rookie || !p.contract.fifthYearOption) return false
  if (p.contract.years !== 1) return false
  return p.optionDecision?.season !== season
}

/** Open holdouts on a roster for a season, biggest star first. */
export function openHoldouts(roster: Player[], season: number): Player[] {
  return roster
    .filter((p) => p.holdout?.season === season && p.holdout.status === 'open')
    .sort((a, b) => b.ovr - a.ovr)
}

/**
 * AI clubs keep their best expiring star with a tag: the franchise tag when there
 * is room, the cheaper transition tag when the books are tighter. One tag per
 * club per season, `skipTeamId` kept for the user (who decides for himself).
 *
 * This never touches the sim — it only rewrites a contract, exactly like the AI
 * re-signing it would — and it never creates a holdout or an option decision.
 */
export function runAITags(world: World, skipTeamId?: string): number {
  let tags = 0
  for (const t of world.teams) {
    if (t.tier !== 'NFL' || t.id === skipTeamId) continue
    const roster = world.roster[t.id] ?? []
    if (tagUsed(roster, 'franchise', world.season) || tagUsed(roster, 'transition', world.season)) continue
    const cand = roster
      .filter((p) => tagEligible(p) && unscaleOvr(p.ovr) >= 82)
      .sort((a, b) => b.ovr - a.ovr)[0]
    if (!cand) continue
    const used = roster.reduce((s, p) => s + p.contract.capHit, 0) + (world.deadMoney[t.id] ?? 0)
    const limit = capForSeason(world.season)
    // Leave breathing room so a tag never forces a cap-compliant cut.
    if (used > limit * 0.86) continue
    const kind: 'franchise' | 'transition' = used > limit * 0.82 ? 'transition' : 'franchise'
    const value = tagSalary(world.players, cand, kind)
    cand.contract = addGuaranteedYear(cand.contract, value, world.season)
    cand.tag = { season: world.season, kind }
    tags++
  }
  return tags
}

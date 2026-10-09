// ─────────────────────────────────────────────────────────────────────────────
// Scouting travel budget (L15 · FUTURES row 14).
//
// The college-scouting rungs (personnel 0–5) get one travel budget a season and
// spend it on the road: all-star games, pro days and campus visits. How many
// looks a prospect has had is his *coverage* — and coverage is what tightens
// your read (see `coverageFactor`, folded into `readProspect`).
//
// This is INFORMATION ONLY. It changes the fuzzy range you look at and how
// confident your file is; it never touches a player's ratings or a game result.
// Nothing is spent unless you click, and "Auto" is the only automatic spender,
// so the feature is opt-in/neutral by default. New randomness (a character read)
// comes from a deterministic hash of the trip, never the sim's RNG stream.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, DraftProspect, Position } from '../types'
import type { World } from './generate'
import { can } from './capabilities'
import { clamp } from './rng'
import { revealFacet } from './character'
import { STARTERS } from './depth'

/** Trips available each season. */
export const TRAVEL_BUDGET = 12
/** Most looks a single prospect can get (coverage depth cap). */
export const MAX_TRAVEL_COVERAGE = 3

/** Cost in trips; also how many looks the trip puts on a prospect's file. */
export const TRAVEL_COST = { campus: 1, proDay: 2, allStar: 3 } as const
export type TravelKind = keyof typeof TRAVEL_COST

export const TRAVEL_LABEL: Record<TravelKind, string> = {
  campus: 'Campus visit',
  proDay: 'Pro day',
  allStar: 'All-star game',
}

export const TRAVEL_BLURB: Record<TravelKind, string> = {
  campus: 'Spend a day with one prospect — a personal look and a character read.',
  proDay: 'Work out one prospect in depth — the value pick to sharpen a top target.',
  allStar: 'Focus the showcase on one prospect — the deepest look, and the priciest.',
}

/** The trips filed this season. Kept on the career so it travels with the save. */
export interface ScoutTravelState {
  season: number
  tripsLeft: number
  /** prospectId → the trips that have seen him this season. */
  visits: Record<string, TravelKind[]>
}

/** This season's travel state, fresh if the stored one is from an earlier season. */
export function travelState(career: CareerState, season: number): ScoutTravelState {
  const t = career.scoutTravel
  if (t && t.season === season) return t
  return { season, tripsLeft: TRAVEL_BUDGET, visits: {} }
}

/** Trips left this season. */
export function tripsLeft(career: CareerState, season: number): number {
  return travelState(career, season).tripsLeft
}

/** Coverage depth (0–MAX): how many looks a prospect has had this season. */
export function coverageOf(career: CareerState, prospectId: string): number {
  const kinds = career.scoutTravel?.visits[prospectId]
  if (!kinds?.length) return 0
  const looks = kinds.reduce((n, k) => n + TRAVEL_COST[k], 0)
  return Math.min(MAX_TRAVEL_COVERAGE, looks)
}

/**
 * Coverage tightens the read: a multiplier on the fuzzy range width (≤ 1).
 * Exported so `readProspect` can fold it into the same width it already builds
 * from rung, skill and earned traits.
 */
export function coverageFactor(career: CareerState, prospectId: string): number {
  const cov = coverageOf(career, prospectId)
  if (!cov) return 1
  return 1 - Math.min(1, cov / MAX_TRAVEL_COVERAGE) * 0.35
}

/** Is the travel budget this rung's to spend? The college-scouting rungs only. */
export function travelOpen(world: World, career: CareerState): boolean {
  if (career.path !== 'personnel') return false
  if (!can(career, 'grade')) return false
  return world.draft.filter((p) => !p.draftedBy).length > 0
}

/** What one trip is worth (information quality only). */
const EFFECT: Record<TravelKind, { conf: number; close: number; charAccuracy: number }> = {
  campus: { conf: 4, close: 0.1, charAccuracy: 0.7 },
  proDay: { conf: 7, close: 0.22, charAccuracy: 0 },
  allStar: { conf: 10, close: 0.35, charAccuracy: 0 },
}

/** Fold one trip into a prospect's read: nudge confidence and close the grade. */
function applyLook(p: DraftProspect, kind: TravelKind, rng: (() => number) | null): void {
  const eff = EFFECT[kind]
  p.confidence = Math.min(100, p.confidence + eff.conf)
  if (eff.close > 0) {
    const current = p.myGrade ?? p.grade
    p.myGrade = Math.round(current + (p.trueGrade - current) * eff.close)
  }
  if (kind === 'campus' && p.character && rng) {
    const reads = p.characterReads ?? []
    const read = revealFacet(p.character, reads, eff.charAccuracy, rng)
    if (read) p.characterReads = [...reads, read]
  }
}

/**
 * Spend trips on one prospect.
 *
 * Mutates the prospect in `world.draft` and returns the next career immutably.
 */
export function applyTravel(
  world: World,
  career: CareerState,
  prospectId: string,
  kind: TravelKind,
  rng: () => number,
): { career: CareerState; message: string } | { error: string } {
  if (!travelOpen(world, career)) return { error: 'Scouting travel is not yours at this rung.' }
  const state = travelState(career, world.season)
  const p = world.draft.find((d) => d.id === prospectId)
  if (!p) return { error: 'That prospect is not in this class.' }
  if (p.draftedBy) return { error: `${p.name} is already off the board.` }
  if (coverageOf(career, prospectId) >= MAX_TRAVEL_COVERAGE) {
    return { error: `You have all the coverage you can get on ${p.name}.` }
  }
  const cost = TRAVEL_COST[kind]
  if (state.tripsLeft < cost) return { error: 'Not enough travel budget left this season.' }

  applyLook(p, kind, kind === 'campus' ? rng : null)
  const message =
    kind === 'campus'
      ? `Campus: you spent a day with ${p.name} (${p.confidence}% known).`
      : `${TRAVEL_LABEL[kind]}: ${p.name} sharpened to ${p.myGrade ?? p.grade} on your file.`

  const visits = state.visits[prospectId] ?? []
  const next: CareerState = {
    ...career,
    scoutTravel: {
      season: state.season,
      tripsLeft: state.tripsLeft - cost,
      visits: { ...state.visits, [prospectId]: [...visits, kind] },
    },
  }
  return { career: next, message }
}

/** Positional need (0 stocked … 1 empty) for the user's roster. */
function needScore(world: World, teamId: string, pos: Position): number {
  const have = (world.roster[teamId] ?? []).filter((p) => p.pos === pos).length
  const target = STARTERS[pos] ?? 1
  return clamp((target - have) / Math.max(1, target), 0, 1)
}

/**
 * Auto: spread the season's budget by the board's top needs.
 *
 * Priority runs neediest position group first, then your own ranked board, then
 * consensus grade. The top of that list gets the deepest look (all-star games,
 * up to half the budget), the next tier gets pro days, and any leftover trip
 * becomes a campus visit — each pass skipping anyone already at the cap.
 */
export function autoTravel(
  world: World,
  career: CareerState,
  rng: () => number,
): { career: CareerState; message: string; spent: number; covered: number } | { error: string } {
  if (!travelOpen(world, career)) return { error: 'Scouting travel is not yours at this rung.' }
  const state = travelState(career, world.season)
  if (state.tripsLeft <= 0) return { error: 'No travel budget left this season.' }

  const board = career.userBoard ?? []
  const boardIdx = (p: DraftProspect) => {
    const i = board.indexOf(p.id)
    return i < 0 ? 1e6 : i
  }
  const order = world.draft
    .filter((p) => !p.draftedBy)
    .sort(
      (a, b) =>
        needScore(world, career.teamId, b.pos) - needScore(world, career.teamId, a.pos) ||
        boardIdx(a) - boardIdx(b) ||
        b.grade - a.grade,
    )

  let next = career
  let spent = 0
  const depthOf = (p: DraftProspect) => travelState(next, world.season).visits[p.id]?.reduce((n, k) => n + TRAVEL_COST[k], 0) ?? 0
  const give = (p: DraftProspect, kind: TravelKind) => {
    const res = applyTravel(world, next, p.id, kind, rng)
    if ('error' in res) return false
    next = res.career
    spent++
    return true
  }

  // 1) The deepest look goes to the very top of the board, up to half the budget.
  const allStarCap = Math.floor(TRAVEL_BUDGET / 2)
  let allStarSpent = 0
  for (const p of order) {
    const st = travelState(next, world.season)
    if (st.tripsLeft < TRAVEL_COST.allStar || allStarSpent + TRAVEL_COST.allStar > allStarCap) break
    if (give(p, 'allStar')) allStarSpent += TRAVEL_COST.allStar
  }

  // 2) Pro days down the same priority list.
  for (const p of order) {
    const st = travelState(next, world.season)
    if (st.tripsLeft < TRAVEL_COST.proDay) break
    if (depthOf(p) >= MAX_TRAVEL_COVERAGE) continue
    give(p, 'proDay')
  }

  // 3) Any leftover trip becomes a campus visit.
  for (const p of order) {
    const st = travelState(next, world.season)
    if (st.tripsLeft < 1) break
    if (depthOf(p) >= MAX_TRAVEL_COVERAGE) continue
    give(p, 'campus')
  }

  const endState = travelState(next, world.season)
  const covered = Object.keys(endState.visits).length
  const used = TRAVEL_BUDGET - endState.tripsLeft
  const message = spent
    ? `Auto travel: ${used}/${TRAVEL_BUDGET} trips filed across ${covered} prospect${covered === 1 ? '' : 's'}.`
    : 'Auto travel: nothing to add — the board is fully covered.'
  return { career: next, message, spent, covered }
}

// ─────────────────────────────────────────────────────────────────────────────
// Combine week (G4).
//
// The offseason before the draft, the college-scouting rungs (Asst. Director /
// Director of College Scouting) get one week and a 20-hour budget to work the
// class: sit a prospect down for an interview, put him through a workout, or
// grind the film. There are no scouting points to spend — the combine IS the
// week — and you can get eyes on at most twelve distinct prospects.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, CharacterRead } from '../types'
import type { World } from './generate'
import { capabilities } from './capabilities'
import { FACET_LABEL, revealFacet } from './character'

export const COMBINE_HOURS = 20
export const MAX_COMBINE_PROSPECTS = 12

export const COMBINE_COST = { interview: 4, workout: 3, film: 5 } as const
export type CombineKind = keyof typeof COMBINE_COST

/** Is the combine window open for this rung (ignoring the hours budget)? */
function windowOpen(world: World, career: CareerState): boolean {
  // Personnel rungs 4–5 hold the college-scouting board.
  if (career.path !== 'personnel') return false
  if (career.level !== 4 && career.level !== 5) return false
  if (world.phase !== 'offseason') return false
  // The week ends when the draft starts.
  if (world.draftState.pickIndex !== 0) return false
  const can = capabilities(career).can
  return can.has('rankBoard') && can.has('grade')
}

/** Does this rung get a combine-week card right now? Hidden once the hours are gone. */
export function combineOpen(world: World, career: CareerState): boolean {
  if (!windowOpen(world, career)) return false
  const c = career.combine
  if (c && c.season === world.season && c.hoursLeft <= 0) return false
  return true
}

/** This offseason's budget, fresh if the stored one is from an earlier season. */
function combineState(world: World, career: CareerState): NonNullable<CareerState['combine']> {
  const c = career.combine
  if (c && c.season === world.season) return c
  return { season: world.season, hoursLeft: COMBINE_HOURS, seen: [] }
}

/**
 * Spend hours on one combine action for one prospect.
 *
 * - interview (4 h): reveal a character facet at a fixed 0.85 accuracy.
 * - workout   (3 h): your grade closes 60% of the way to the truth; +30 confidence.
 * - film      (5 h): your grade lands within ±2 of the truth; confidence floors at 85.
 *
 * Mutates the prospect in `world.draft` and returns the next career (immutably).
 */
export function applyCombine(
  world: World,
  career: CareerState,
  prospectId: string,
  kind: CombineKind,
  rng: () => number,
): { career: CareerState; message: string } | { error: string } {
  if (!windowOpen(world, career)) return { error: 'The combine is not open right now.' }
  const cost = COMBINE_COST[kind]
  const state = combineState(world, career)
  const p = world.draft.find((d) => d.id === prospectId)
  if (!p) return { error: 'That prospect is not in this class.' }

  const firstLook = !state.seen.includes(prospectId)
  if (firstLook && state.seen.length >= MAX_COMBINE_PROSPECTS) {
    return { error: `The combine only gets eyes on ${MAX_COMBINE_PROSPECTS} prospects.` }
  }
  if (state.hoursLeft < cost) return { error: 'Not enough combine hours left.' }

  let message: string
  switch (kind) {
    case 'interview': {
      if (!p.character) return { error: `${p.name} did not sit for an interview.` }
      const reads: CharacterRead[] = p.characterReads ?? []
      const read = revealFacet(p.character, reads, 0.85, rng)
      if (!read) return { error: `You already know everything about ${p.name} off the field.` }
      p.characterReads = [...reads, read]
      message = `Interview: ${p.name} — ${FACET_LABEL[read.facet]} ${read.label} (${read.confidence}% sure).`
      break
    }
    case 'workout': {
      const current = p.myGrade ?? p.grade
      p.myGrade = Math.round(current + (p.trueGrade - current) * 0.6)
      p.confidence = Math.min(100, p.confidence + 30)
      message = `Workout: ${p.name} tested out — your grade sharpened to ${p.myGrade}.`
      break
    }
    case 'film': {
      p.myGrade = Math.round(p.trueGrade + (rng() * 4 - 2))
      p.confidence = Math.max(p.confidence, 85)
      message = `Film: ${p.name} graded ${p.myGrade} off the tape.`
      break
    }
  }

  const seen = firstLook ? [...state.seen, prospectId] : state.seen
  const next: CareerState = {
    ...career,
    combine: { season: world.season, hoursLeft: state.hoursLeft - cost, seen },
  }
  return { career: next, message }
}

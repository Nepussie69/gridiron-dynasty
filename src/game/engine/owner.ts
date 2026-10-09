// ─────────────────────────────────────────────────────────────────────────────
// Owner personalities (FUTURES 22).
//
// Every club has an owner whose temperament shapes how much rope you get. The
// personality is derived deterministically from the team id (a hash — no rng
// draw, so the sim and AI-vs-AI results are untouched), and each profile
// exposes a label, a blurb, the season mandate, and — new in FUTURES 22 — a
// "firing line": the job-security level at or below which this owner makes a
// change. Impatient owners have a high line; patient builders only move at the
// very bottom.
//
// Pure module: it imports only names + the hash, so `career.ts` and the store
// can use it without an import cycle.
// ─────────────────────────────────────────────────────────────────────────────

import type { LeagueTier } from '../types'
import { FIRST, LAST } from './names'
import { hash32 } from './rng'

export type OwnerPersonality = 'meddling' | 'patient' | 'cheap' | 'win-now'

const PERSONALITIES: OwnerPersonality[] = ['meddling', 'patient', 'cheap', 'win-now']

export interface OwnerProfile {
  personality: OwnerPersonality
  /** Short label for the badge. */
  label: string
  /** One line on how this owner runs the building. */
  blurb: string
  /** The season mandate shown on the dashboard and read by the GM desk. */
  mandate: string
  /**
   * Job security at or below which this owner makes a change. A win-now owner
   * pulls the trigger early (25); a patient builder only when it bottoms out.
   */
  fireLine: number
  /** What the owner says when you drift toward the line. */
  ultimatum: string
}

const PROFILES: Record<OwnerPersonality, OwnerProfile> = {
  'win-now': {
    personality: 'win-now',
    label: 'Win-now',
    blurb: 'Impatient and all-in. He measures you in January and will pay for proven veterans to get there.',
    mandate: 'The owner expects a playoff push now — no rebuilding.',
    fireLine: 25,
    ultimatum: 'I did not buy this roster to watch a rebuild. Make the playoffs, or I will find someone who can.',
  },
  patient: {
    personality: 'patient',
    label: 'Patient builder',
    blurb: 'Gives you years, not weeks. Wants to see the young core grow and the plan hold.',
    mandate: 'The owner will give you time — but wants visible progress.',
    fireLine: 0,
    ultimatum: 'I have patience, but not forever. Show me the plan is working.',
  },
  meddling: {
    personality: 'meddling',
    label: 'Meddling',
    blurb: 'Hands-on to a fault. He has opinions on your lineup and lets you hear all of them.',
    mandate: 'The owner has opinions on your lineup. Manage up.',
    fireLine: 12,
    ultimatum: 'I think I know this roster better than you do. Start winning and we will not test that.',
  },
  cheap: {
    personality: 'cheap',
    label: 'Cost-conscious',
    blurb: 'Runs the club like a business. Values draft picks, cap room and value contracts.',
    mandate: 'The owner wants value: build through the draft, stay flexible.',
    fireLine: 6,
    ultimatum: 'The books are a mess and the wins are not there. Fix both.',
  },
}

export function ownerPersonality(teamId: string): OwnerPersonality {
  return PERSONALITIES[hash32(teamId, 61) % PERSONALITIES.length]
}

export function ownerPersonalityLabel(p: OwnerPersonality): string {
  return p === 'meddling' ? 'Meddling' : p === 'patient' ? 'Patient' : p === 'cheap' ? 'Cost-conscious' : 'Win-now'
}

/** The full temperament for a club's owner. */
export function ownerProfile(teamId: string): OwnerProfile {
  return PROFILES[ownerPersonality(teamId)]
}

/**
 * The owner's mandate. The wording is stable (the GM desk reads it for a
 * rebuild / win-now stance), and it now refreshes whenever you change jobs.
 */
export function ownerMandate(teamId: string, _tier: LeagueTier): string {
  return ownerProfile(teamId).mandate
}

/** Job security at or below which this owner makes a change. */
export function ownerFiringLine(teamId: string): number {
  return ownerProfile(teamId).fireLine
}

/** A stable owner name for the club — a hash, so it never consumes an rng draw. */
export function ownerName(teamId: string): string {
  return `${FIRST[hash32(teamId, 17) % FIRST.length]} ${LAST[hash32(teamId, 23) % LAST.length]}`
}

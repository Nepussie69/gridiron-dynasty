// ─────────────────────────────────────────────────────────────────────────────
// speechUi.ts — FUTURES #7 (phase H3): the pure helpers behind the halftime
// speech UI. No React, no store: the MatchView moment card, the scorebug chip,
// the result toast and the Locker Room record all read these.
//
// The engine (H1) keeps every fit number, but a moment only carries
// `MomentOption { id, label, hint }` — so the risk badge reads the fit the
// engine already wrote into the option's own hint ("Fits / Risky / Likely
// backfires"). No new data is invented; `SPEECH_RISK_LABEL` is exactly the
// engine's `FIT_HINT`.
// ─────────────────────────────────────────────────────────────────────────────

import type { SpeechFit, SpeechId, SpeechResult } from '../game/engine/halftimeSpeech'
import type { SpeechRecord } from '../game/engine/lockerRoom'
import type { Tone } from '../lib/format'

/** The three risk reads a speech option can carry (matches the engine's fit). */
export type SpeechRisk = 'fits' | 'risky' | 'backfires'

/** The engine's `FIT_HINT`: the exact labels it writes at the head of a hint. */
export const SPEECH_RISK_LABEL: Record<SpeechRisk, string> = {
  fits: 'Fits',
  risky: 'Risky',
  backfires: 'Likely backfires',
}

/** The badge tone for each risk read. */
export const SPEECH_RISK_TONE: Record<SpeechRisk, Tone> = {
  fits: 'win',
  risky: 'warn',
  backfires: 'loss',
}

/** The engine's `SpeechFit` → the UI's risk read. */
export const SPEECH_FIT_RISK: Record<SpeechFit, SpeechRisk> = {
  good: 'fits',
  neutral: 'risky',
  bad: 'backfires',
}

/** The engine's `FIT_HINT` keys, longest prefix understood first. */
const RISK_BY_PREFIX: [string, SpeechRisk][] = [
  ['Likely backfires', 'backfires'],
  ['Risky', 'risky'],
  ['Fits', 'fits'],
]

/** The risk the engine attached to an option's hint, or null if it carries none. */
export function speechRiskOf(hint: string): SpeechRisk | null {
  for (const [prefix, risk] of RISK_BY_PREFIX) if (hint.startsWith(prefix)) return risk
  return null
}

/**
 * The badge for one speech option, read from the engine's own fit data: the
 * stay-the-course card has no speech and so no risk, the other three carry the
 * fit the engine wrote into their hint.
 */
export function speechOptionRisk(id: string, hint: string): { label: string; tone: Tone } | null {
  if (id === 'stayCourse') return { label: 'Safe', tone: 'neutral' }
  const risk = speechRiskOf(hint)
  return risk ? { label: SPEECH_RISK_LABEL[risk], tone: SPEECH_RISK_TONE[risk] } : null
}

/** Plain-English name for each speech (the moment label for the starless ones). */
export const SPEECH_LABEL: Record<SpeechId, string> = {
  fireUp: 'Fire them up',
  calmDown: 'Calm them down',
  challenge: 'Challenge a star',
  stayCourse: 'Stay the course',
}

/** The verdict word the toast leads with (the brief's "landed / fell flat / backfired"). */
export const SPEECH_VERDICT: Record<SpeechResult, string> = {
  landed: 'landed',
  flat: 'fell flat',
  backfired: 'backfired',
}

/** The one-line result toast: "Speech landed. You lit a fire under them — the room is up." */
export function speechToastLine(result: SpeechResult, line?: string): string {
  const head = `Speech ${SPEECH_VERDICT[result]}`
  return line ? `${head}. ${line}` : head
}

/** A short label for the scorebug chip beside the user's club. */
export function speechChipLabel(out: { id: SpeechId; result: SpeechResult }): string {
  if (out.result === 'landed') {
    if (out.id === 'fireUp') return 'Fired up'
    if (out.id === 'calmDown') return 'Settled'
    return 'Answered'
  }
  if (out.result === 'backfired') return 'Backfired'
  return 'Speech flat'
}

/** The chip tone for a verdict. */
export function speechChipTone(result: SpeechResult): Tone {
  return result === 'landed' ? 'win' : result === 'backfired' ? 'loss' : 'neutral'
}

/** This season's speech record by verdict. */
export function speechRecordCounts(recs: SpeechRecord[] | undefined): Record<SpeechResult, number> {
  const counts: Record<SpeechResult, number> = { landed: 0, flat: 0, backfired: 0 }
  for (const r of recs ?? []) counts[r.result] += 1
  return counts
}

/**
 * The repetition warning for the Locker Room row: the engine docks 10% off a
 * speech's land chance for every repeat inside the last three halftimes. Null
 * when nothing has been repeated.
 */
export function speechRepeatWarning(recs: SpeechRecord[] | undefined): string | null {
  const last3 = (recs ?? []).slice(-3)
  const counts = new Map<SpeechId, number>()
  for (const r of last3) counts.set(r.id, (counts.get(r.id) ?? 0) + 1)
  let worst: SpeechId | null = null
  let n = 1
  for (const [id, c] of counts) {
    if (c > n) {
      worst = id
      n = c
    }
  }
  if (!worst) return null
  return `${SPEECH_LABEL[worst]} ${n} of the last ${last3.length} halftimes — the room tunes it out (−10% per repeat).`
}

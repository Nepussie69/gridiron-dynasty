// ─────────────────────────────────────────────────────────────────────────────
// Coach playcalling — FUTURES #26, phase P3b (game-day UI helpers).
//
// Pure reads of the plan, the moment and the engine's decision log, so the
// game-day UI in MatchView.tsx stays declarative and these rules can be probed
// without a DOM. No React, no store, no rng: the same `bucketFor` the sim runs
// at the snap, the same sheet the store saved, the same log the engine wrote.
// ─────────────────────────────────────────────────────────────────────────────

import { bucketFor, DEF_CALL_LABEL, type Bucket, type DefCall } from '../game/engine/decisions'
import type { PlayCallingPlan } from '../game/engine/playcalling'
import type { DecisionLog, Play } from '../game/engine/playsim'

/** The moment fields the bucket depends on (a Moment has all three). */
export interface BucketInput {
  down: number | null
  distance: number | null
  yard: number
}

/** The moment's bucket — the identical `bucketFor(down, distance, yard)` the sim calls. */
export function bucketOfMoment(m: BucketInput): Bucket {
  return bucketFor(m.down ?? 1, m.distance ?? 10, m.yard)
}

/**
 * The user's own sheet for a moment's bucket, in the order the sheet lists it
 * (offense: playbook play names; defense: the defensive calls). Empty when there
 * is no plan or the bucket has no sheet — the caller then renders today's picker.
 */
export function sheetPlaysFor(
  plan: PlayCallingPlan | undefined,
  side: 'off' | 'def',
  m: BucketInput,
): { bucket: Bucket; ids: string[] } {
  const bucket = bucketOfMoment(m)
  const ids = plan ? [...(side === 'off' ? plan.sheet.off[bucket] ?? [] : plan.sheet.def[bucket] ?? [])] : []
  return { bucket, ids }
}

/** Does the plan hand any situation to the user? An empty `callers` equals 'key'. */
export function hasMeSituations(plan: PlayCallingPlan | undefined): boolean {
  if (!plan) return false
  const me = (m: Partial<Record<string, 'me' | 'staff'>>) => Object.values(m).some((v) => v === 'me')
  return me(plan.callers.off) || me(plan.callers.def)
}

/** The "My sheet" tooltip. With no 'me' situation the mode still works (it equals Key moments). */
export function sheetModeHint(plan: PlayCallingPlan | undefined): string {
  return hasMeSituations(plan)
    ? 'Stops only on the situations your plan gives you, plus key moments'
    : 'Your plan hands every situation to staff — set it on Game Plan → Situational'
}

export interface PlayBanner {
  text: string
  tone: 'gold' | 'plain'
}

/** The look line the QB saw, in the card's own words. */
function lookLabel(look: DefCall): string {
  return DEF_CALL_LABEL[look].toLowerCase()
}

/**
 * Requirement (4): the "QB checked to X" line for the play at `idx`.
 * The P1 record (`DecisionLog.audible`, with the look) wins; a J13 pre-snap read
 * the play event carries is the fallback (no look is recorded there).
 */
export function audibleBannerFor(
  idx: number,
  play: Play | undefined,
  decisions: readonly DecisionLog[] | undefined,
): PlayBanner | null {
  const d = decisions?.find((x) => x.audible && (x.momentId === `call-${idx}` || x.momentId === `defCall-${idx}`))
  if (d?.audible) return { text: `QB checked to ${d.audible.to} (look: ${lookLabel(d.audible.look)})`, tone: 'gold' }
  if (play?.audible) return { text: `QB checked to ${play.audible.to}`, tone: 'plain' }
  return null
}

export interface PlayCaller {
  /** 'You' when the user answered this call, else the coordinator's seat. */
  tag: 'You' | 'OC' | 'DC'
  /** The log's call-line prefix, e.g. "OC:". */
  label: string
  /** The hover title (the seat's own name). */
  title: string
}

/**
 * Requirement (5): name the caller of a play's call line where the data exists.
 * `coord` is the calling club's coordinator name (`coachLabels`), which the UI
 * already has; `userCalled` comes from the engine's own decision log.
 */
export function playCallerTag(o: { mine: boolean; side: 'off' | 'def'; userCalled: boolean; coord: string }): PlayCaller {
  const tag = o.mine && o.userCalled ? 'You' : o.side === 'off' ? 'OC' : 'DC'
  const seat = o.side === 'off' ? 'OC' : 'DC'
  return {
    tag,
    label: `${tag}:`,
    title: tag === 'You' ? 'You made this call' : `${seat} ${o.coord} called it`,
  }
}

/** The defensive call a `defCall` decision chose, as the log shows it. */
export function defCallLabel(choiceId: string | undefined): string | null {
  return choiceId && choiceId in DEF_CALL_LABEL ? DEF_CALL_LABEL[choiceId as DefCall] : null
}

// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #26 P3a — the pure half of the PlayCallingCard.
//
// Everything the card does to a plan lives here as a plain function so that
//   • the card file exports only components (the fast-refresh lint rule), and
//   • the verification probe can drive the exact edits the handlers make,
//     without a DOM.
//
// Each handler takes the current plan, the caller's editable sides and its
// arguments, and returns a NEW normalised plan. `toCommit` turns a plan back
// into the store's `setPlayCalling` argument, dropping an all-default plan to
// `undefined` (today's behaviour = no plan at all).
// ─────────────────────────────────────────────────────────────────────────────

import {
  BUCKET_LABEL,
  DEF_CALLS,
  type Bucket,
  type DefCall,
} from '../game/engine/decisions'
import { FORMATIONS, PLAYBOOK, type PlaybookPlay } from '../game/data/playbookData'
import {
  CALL_SITUATIONS,
  SHEET_MAX_DEF,
  SHEET_MAX_OFF,
  checkFor,
  emptyPlayCalling,
  formationOf,
  normalizePlayCalling,
  type Caller,
  type CallSituation,
  type PlayCallingPlan,
} from '../game/engine/playcalling'

/** Situation labels: the BUCKET_LABEL buckets in order, then the two-minute window. */
export const SITUATION_LABEL: Record<CallSituation, string> = {
  ...BUCKET_LABEL,
  twoMinute: 'Two-minute',
}

/** Short defensive-call names, for the sheet chips (the Sheet uses full labels). */
export const DEF_SHORT: Record<DefCall, string> = {
  blitz: 'Blitz',
  man: 'Man',
  zone: 'Zone',
  stack: 'Stack',
  twoHigh: 'Two-high',
}

export const AUDIBLE_LABEL: Record<PlayCallingPlan['audibles'], string> = {
  off: 'Off',
  qb: 'QB checks',
  ask: 'Ask me',
}

/** One plain line for each audible mode. */
export const AUDIBLE_HINT: Record<PlayCallingPlan['audibles'], string> = {
  off: 'No audibles — the play you call is the play you run.',
  qb: 'Your QB checks to the opposite-class play from the same formation when the look favours it — no pause.',
  ask: 'The game shows you the look and you keep, check or kill to the hot route.',
}

export const AUDIBLE_MODES: PlayCallingPlan['audibles'][] = ['off', 'qb', 'ask']

// ── Scope ─────────────────────────────────────────────────────────────────────

export interface EditableSides {
  off: boolean
  def: boolean
}

/**
 * Which of the two columns/rows the career can edit, from the same
 * `capabilities().planScope` + `unitFocus` rule the other Game Plan cards use:
 * an HC edits both, a coordinator only the side he coaches.
 */
export function editableSides(scope: 'none' | 'own-side' | 'both', focus: 'off' | 'def' | 'both' | undefined): EditableSides {
  if (scope === 'both') return { off: true, def: true }
  if (scope === 'none') return { off: false, def: false }
  const f = focus ?? 'both'
  return { off: f !== 'def', def: f !== 'off' }
}

// ── Plan plumbing ─────────────────────────────────────────────────────────────

/** A mutable copy of the plan the card renders — never the stored object. */
export function clonePlan(plan: PlayCallingPlan | undefined): PlayCallingPlan {
  const src = plan ?? emptyPlayCalling()
  const out: PlayCallingPlan = {
    callers: { off: { ...src.callers.off }, def: { ...src.callers.def } },
    sheet: { off: {}, def: {} },
    audibles: src.audibles,
  }
  for (const b of Object.keys(src.sheet.off) as Bucket[]) {
    const list = src.sheet.off[b]
    if (list?.length) out.sheet.off[b] = [...list]
  }
  for (const b of Object.keys(src.sheet.def) as Bucket[]) {
    const list = src.sheet.def[b]
    if (list?.length) out.sheet.def[b] = [...list]
  }
  if (src.checks) out.checks = { ...src.checks }
  return out
}

/** A plan that changes nothing — the beginning of every default path. */
export function basePlan(plan: PlayCallingPlan | undefined): PlayCallingPlan {
  return plan ? clonePlan(plan) : emptyPlayCalling()
}

/** True when the plan is indistinguishable from having no plan at all. */
export function isDefaultPlan(plan: PlayCallingPlan | undefined): boolean {
  if (!plan) return true
  if (plan.audibles !== 'off') return false
  if (plan.checks && Object.keys(plan.checks).length) return false
  for (const s of CALL_SITUATIONS) {
    if (plan.callers.off[s] === 'me' || plan.callers.def[s] === 'me') return false
  }
  for (const b of Object.keys(plan.sheet.off) as Bucket[]) {
    if (plan.sheet.off[b]?.length) return false
  }
  for (const b of Object.keys(plan.sheet.def) as Bucket[]) {
    if (plan.sheet.def[b]?.length) return false
  }
  return true
}

/** What the card hands `setPlayCalling`: the normalised plan, or `undefined` when default. */
export function toCommit(plan: PlayCallingPlan | undefined): PlayCallingPlan | undefined {
  if (isDefaultPlan(plan)) return undefined
  return normalizePlayCalling(plan)
}

// ── (1) Who calls it ─────────────────────────────────────────────────────────

/** The caller for a situation, defaulting to the standing coordinator. */
export function whoCalls(plan: PlayCallingPlan | undefined, side: 'off' | 'def', sit: CallSituation): Caller {
  return plan?.callers[side][sit] ?? 'staff'
}

export function setCaller(
  plan: PlayCallingPlan | undefined,
  sides: EditableSides,
  side: 'off' | 'def',
  sit: CallSituation,
  who: Caller,
): PlayCallingPlan {
  const next = basePlan(plan)
  if (sides[side]) next.callers[side][sit] = who
  return next
}

// ── (2) The sheet ────────────────────────────────────────────────────────────

export function sheetOff(plan: PlayCallingPlan | undefined, bucket: Bucket): string[] {
  return [...(plan?.sheet.off[bucket] ?? [])]
}

export function sheetDef(plan: PlayCallingPlan | undefined, bucket: Bucket): DefCall[] {
  return [...(plan?.sheet.def[bucket] ?? [])]
}

/** Write an offense sheet list (deduped, capped at SHEET_MAX_OFF; empty clears it). */
function writeOff(plan: PlayCallingPlan, bucket: Bucket, plays: string[]): PlayCallingPlan {
  const next = basePlan(plan)
  const dedup = [...new Set(plays)].slice(0, SHEET_MAX_OFF)
  if (dedup.length) next.sheet.off[bucket] = dedup
  else delete next.sheet.off[bucket]
  return next
}

export function addOffPlay(
  plan: PlayCallingPlan | undefined,
  sides: EditableSides,
  bucket: Bucket,
  name: string,
): PlayCallingPlan {
  const next = basePlan(plan)
  if (!sides.off) return next
  const cur = sheetOff(next, bucket)
  if (cur.includes(name) || cur.length >= SHEET_MAX_OFF) return next
  return writeOff(next, bucket, [...cur, name])
}

export function removeOffPlay(
  plan: PlayCallingPlan | undefined,
  sides: EditableSides,
  bucket: Bucket,
  name: string,
): PlayCallingPlan {
  const next = basePlan(plan)
  if (!sides.off) return next
  return writeOff(next, bucket, sheetOff(next, bucket).filter((p) => p !== name))
}

/** Move a play one slot towards the top of the sheet (order weights 4:3:2:1). */
export function moveOffPlay(
  plan: PlayCallingPlan | undefined,
  sides: EditableSides,
  bucket: Bucket,
  name: string,
  dir: -1 | 1,
): PlayCallingPlan {
  const next = basePlan(plan)
  if (!sides.off) return next
  const cur = sheetOff(next, bucket)
  const i = cur.indexOf(name)
  const j = i + dir
  if (i < 0 || j < 0 || j >= cur.length) return next
  const swapped = [...cur]
  swapped[i] = cur[j]
  swapped[j] = cur[i]
  return writeOff(next, bucket, swapped)
}

export function toggleDefCall(
  plan: PlayCallingPlan | undefined,
  sides: EditableSides,
  bucket: Bucket,
  call: DefCall,
): PlayCallingPlan {
  const next = basePlan(plan)
  if (!sides.def) return next
  const cur = sheetDef(next, bucket)
  const has = cur.includes(call)
  const list = has ? cur.filter((c) => c !== call) : cur.length >= SHEET_MAX_DEF ? cur : [...cur, call]
  if (list.length) next.sheet.def[bucket] = list
  else delete next.sheet.def[bucket]
  return next
}

// ── (3) Audibles + check-with-me ─────────────────────────────────────────────

export function setAudibles(
  plan: PlayCallingPlan | undefined,
  sides: EditableSides,
  mode: PlayCallingPlan['audibles'],
): PlayCallingPlan {
  const next = basePlan(plan)
  if (sides.off || sides.def) next.audibles = mode
  return next
}

/** The check-with-me play stored as an override, if any. */
export function checkOverride(plan: PlayCallingPlan | undefined, play: string): string | undefined {
  return plan?.checks?.[play]
}

/** The check the QB uses: the override when set, else the game's `checkFor` default. */
export function checkForPlay(plan: PlayCallingPlan | undefined, play: string): string | undefined {
  return checkFor(play, plan?.checks)
}

/** Set (or clear with `undefined`) a play's check-with-me override. */
export function setCheck(
  plan: PlayCallingPlan | undefined,
  sides: EditableSides,
  from: string,
  to: string | undefined,
): PlayCallingPlan {
  const next = basePlan(plan)
  if (!sides.off) return next
  const checks = { ...(next.checks ?? {}) }
  if (!to || to === from) delete checks[from]
  else checks[from] = to
  if (Object.keys(checks).length) next.checks = checks
  else delete next.checks
  return next
}

// ── Grouping (the CallPicker grouping, shared with the Sheet's tabs) ──────────

export interface FormationGroup {
  formation: string
  plays: PlaybookPlay[]
}

/** Every playbook formation that has plays, in FORMATIONS order. */
export const FORMATION_GROUPS: FormationGroup[] = FORMATIONS.map((f) => ({
  formation: f.name,
  plays: PLAYBOOK.filter((p) => p.formation === f.name),
})).filter((g) => g.plays.length > 0)

export function playsOfFormation(formation: string): PlaybookPlay[] {
  return FORMATION_GROUPS.find((g) => g.formation === formation)?.plays ?? []
}

/** The other plays in a play's formation — the candidates for its check-with-me. */
export function checkCandidates(play: string): PlaybookPlay[] {
  const formation = formationOf(play)
  return playsOfFormation(formation).filter((p) => p.name !== play)
}

// ── (4) Summary ──────────────────────────────────────────────────────────────

/** The header line: "You call 3 situations · 9 sheet plays · QB checks". */
export function summaryOf(plan: PlayCallingPlan | undefined): string {
  const p = plan ?? emptyPlayCalling()
  const situations = CALL_SITUATIONS.filter((s) => p.callers.off[s] === 'me' || p.callers.def[s] === 'me').length
  let plays = 0
  for (const b of Object.keys(p.sheet.off) as Bucket[]) plays += p.sheet.off[b]?.length ?? 0
  for (const b of Object.keys(p.sheet.def) as Bucket[]) plays += p.sheet.def[b]?.length ?? 0
  const bits = [
    `You call ${situations} situation${situations === 1 ? '' : 's'}`,
    `${plays} sheet play${plays === 1 ? '' : 's'}`,
  ]
  if (p.audibles !== 'off') bits.push(AUDIBLE_LABEL[p.audibles])
  return bits.join(' · ')
}

/** Does the club have a fullback on the depth chart? (FB-formation plays fall back without one.) */
export function clubHasFullback(roster: { pos: string }[] | undefined): boolean {
  return !!roster?.some((p) => p.pos === 'FB')
}

export { DEF_CALLS, SHEET_MAX_DEF, SHEET_MAX_OFF }

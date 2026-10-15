// ─────────────────────────────────────────────────────────────────────────────
// Coach playcalling — FUTURES #26, phase P1 (engine).
//
// The user, as head coach or as a coordinator who keeps the call sheet, decides
// WHO calls each situation, WHICH plays are on the sheet, and whether the
// quarterback is allowed to audible. Everything here is pure and deterministic:
// every random choice is a `hash32`/`h01` hash, never an `rng()` draw, so the
// default (no `playCalling`) path is byte-identical to main.
//
// It extends the J13 pre-snap layer rather than forking it: J13 still owns the
// box-based read, this module owns the matrix-based audible (the QB changing the
// called CLASS against the defence's actual call) and the sheet's situational
// delegation.
//
// Every judgement is the SPECIFIC player's: the look the QB sees is his own AWR,
// the check he makes is his own AWR + experience, the sheet a club runs is the
// coach's own sheet. No team/unit/roster mean or median is used anywhere.
// ─────────────────────────────────────────────────────────────────────────────

import { clamp, hash32 } from './rng'
import {
  BUCKETS,
  DEF_CALLS,
  OFF_CLASSES,
  callEdge,
  type Bucket,
  type DefCall,
  type OffClass,
} from './decisions'
import {
  PLAYBOOK,
  conceptFromPlaybook,
  formationForConcept,
  formationHasFullback,
  playbookPlay,
} from '../data/playbookData'

/** A situation on the call sheet: a down-and-distance bucket or the two-minute window. */
export type CallSituation = Bucket | 'twoMinute'
/** Who makes the call: the user ('me') or the standing coordinator ('staff'). */
export type Caller = 'me' | 'staff'

export interface PlayCallingPlan {
  callers: { off: Partial<Record<CallSituation, Caller>>; def: Partial<Record<CallSituation, Caller>> }
  /** ≤4 offensive plays per bucket and ≤3 defensive calls per bucket. */
  sheet: { off: Partial<Record<Bucket, string[]>>; def: Partial<Record<Bucket, DefCall[]>> }
  /** play → check-with-me play (an override of `checkFor`). */
  checks?: Record<string, string>
  audibles: 'off' | 'qb' | 'ask'
}

export const CALL_SITUATIONS: CallSituation[] = [...BUCKETS, 'twoMinute']
export const SHEET_MAX_OFF = 4
export const SHEET_MAX_DEF = 3

/** Tuning for the audible layer (all centred so the league means hold). */
export const PC = {
  // The truthful look: the QB sees the real call this share of the time.
  lookBase: 0.55,
  lookAwrW: 0.01,
  lookSharp: 0.1,
  lookLo: 0.5,
  lookHi: 0.85,
  // The QB's check gate on his own read deviation (rating points).
  audBase: 0.22,
  audReadW: 0.012,
  audLo: 0.06,
  audHi: 0.7,
  // The sheet draw is weighted 4:3:2:1 by sheet order.
  sheetWeights: [4, 3, 2, 1] as const,
} as const

/** A deterministic uniform in [0,1) from a string key — never an rng() draw. */
function h01(key: string): number {
  return (hash32(key) >>> 0) / 4294967296
}

/** J13's two-minute window: the last two minutes of the second and fourth quarter. */
export function isTwoMinute(qtr: number, clockSec: number): boolean {
  return (qtr === 2 || qtr === 4) && clockSec <= 120
}

// ── The plan ─────────────────────────────────────────────────────────────────

const asCaller = (v: unknown): Caller | undefined => (v === 'me' || v === 'staff' ? v : undefined)

function normCallerMap(raw: unknown): Partial<Record<CallSituation, Caller>> {
  const out: Partial<Record<CallSituation, Caller>> = {}
  if (!raw || typeof raw !== 'object') return out
  const rec = raw as Record<string, unknown>
  for (const k of CALL_SITUATIONS) {
    const c = asCaller(rec[k])
    if (c) out[k] = c
  }
  return out
}

function normOffSheet(raw: unknown): Partial<Record<Bucket, string[]>> {
  const out: Partial<Record<Bucket, string[]>> = {}
  if (!raw || typeof raw !== 'object') return out
  const rec = raw as Record<string, unknown>
  for (const b of BUCKETS) {
    const list = rec[b]
    if (!Array.isArray(list)) continue
    const seen = new Set<string>()
    const plays: string[] = []
    for (const v of list) {
      if (typeof v !== 'string' || !playbookPlay(v) || seen.has(v)) continue
      seen.add(v)
      plays.push(v)
      if (plays.length >= SHEET_MAX_OFF) break
    }
    if (plays.length) out[b] = plays
  }
  return out
}

function normDefSheet(raw: unknown): Partial<Record<Bucket, DefCall[]>> {
  const out: Partial<Record<Bucket, DefCall[]>> = {}
  if (!raw || typeof raw !== 'object') return out
  const rec = raw as Record<string, unknown>
  for (const b of BUCKETS) {
    const list = rec[b]
    if (!Array.isArray(list)) continue
    const seen = new Set<DefCall>()
    const calls: DefCall[] = []
    for (const v of list) {
      if (!DEF_CALLS.includes(v as DefCall) || seen.has(v as DefCall)) continue
      seen.add(v as DefCall)
      calls.push(v as DefCall)
      if (calls.length >= SHEET_MAX_DEF) break
    }
    if (calls.length) out[b] = calls
  }
  return out
}

function normChecks(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const rec = raw as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const [from, to] of Object.entries(rec)) {
    if (playbookPlay(from) && typeof to === 'string' && playbookPlay(to)) out[from] = to
  }
  return Object.keys(out).length ? out : undefined
}

/** An old/untrusted save becomes a valid plan (or undefined when there is none). */
export function normalizePlayCalling(raw: unknown): PlayCallingPlan | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const rec = raw as Record<string, unknown>
  const callersRaw = (rec.callers && typeof rec.callers === 'object' ? rec.callers : {}) as Record<string, unknown>
  const sheetRaw = (rec.sheet && typeof rec.sheet === 'object' ? rec.sheet : {}) as Record<string, unknown>
  const audibles = rec.audibles === 'qb' || rec.audibles === 'ask' ? rec.audibles : 'off'
  const plan: PlayCallingPlan = {
    callers: { off: normCallerMap(callersRaw.off), def: normCallerMap(callersRaw.def) },
    sheet: { off: normOffSheet(sheetRaw.off), def: normDefSheet(sheetRaw.def) },
    audibles,
  }
  const checks = normChecks(rec.checks)
  if (checks) plan.checks = checks
  return plan
}

/** A blank plan (the shape the UI starts from). */
export function emptyPlayCalling(): PlayCallingPlan {
  return { callers: { off: {}, def: {} }, sheet: { off: {}, def: {} }, audibles: 'off' }
}

// ── Situational delegation ────────────────────────────────────────────────────

/**
 * Who calls this snap. `undefined` = no plan / no opinion, which is exactly the
 * legacy "key moments only" behaviour. Two-minute outranks the bucket when the
 * plan names it.
 */
export function callerFor(
  calling: PlayCallingPlan | undefined,
  side: 'off' | 'def',
  bucket: Bucket,
  twoMin: boolean,
): Caller | undefined {
  if (!calling) return undefined
  const m = calling.callers[side]
  if (twoMin && m.twoMinute) return m.twoMinute
  return m[bucket]
}

/** The plays on one side of the sheet for a bucket (may be empty). */
export function sheetFor(
  calling: PlayCallingPlan | undefined,
  side: 'off' | 'def',
  bucket: Bucket,
): readonly (string | DefCall)[] {
  if (!calling) return []
  return (calling.sheet[side][bucket] ?? []) as readonly (string | DefCall)[]
}

/**
 * Pick from a sheet list by a stable hash, weighted 4:3:2:1 by sheet order (so
 * the first play you listed is the one the coordinator leans on). No rng draw.
 */
export function sheetPick<T>(list: readonly T[], key: string): T | undefined {
  if (!list.length) return undefined
  const w = list.map((_, i) => PC.sheetWeights[Math.min(i, PC.sheetWeights.length - 1)])
  const total = w.reduce((s, x) => s + x, 0)
  if (total <= 0) return list[0]
  let roll = h01(key) * total
  for (let i = 0; i < list.length; i++) {
    if (roll < w[i]) return list[i]
    roll -= w[i]
  }
  return list[list.length - 1]
}

// ── Check-with-me / hot route ─────────────────────────────────────────────────

/** The plays in a formation, by name (the same formation's menu). */
function playsInFormation(formation: string): string[] {
  return PLAYBOOK.filter((p) => p.formation === formation).map((p) => p.name)
}

/**
 * The check-with-me play for a called play: the `checks` override, else the
 * opposite class (run → pass, pass → run) from the SAME formation, picked by
 * hash among the candidates.
 */
export function checkFor(playName: string, checks?: Record<string, string>): string | undefined {
  const over = checks?.[playName]
  if (over) return over
  const base = playbookPlay(playName)
  if (!base) return undefined
  const want: 'run' | 'pass' = base.type === 'run' ? 'pass' : 'run'
  const cands = playsInFormation(base.formation)
    .map((n) => playbookPlay(n)!)
    .filter((p) => p.type === want)
  if (!cands.length) return undefined
  // Quickest first, then a stable hash — a check-with-me is a quick answer.
  cands.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name))
  return cands[hash32(`${playName}:check`, 3) % cands.length].name
}

/** The hot route's play: the shortest pass in the formation ("kill to hot"). */
export function hotFor(formation: string | undefined): string | undefined {
  if (!formation) return undefined
  const cands = PLAYBOOK.filter((p) => p.formation === formation && p.type === 'pass')
  if (!cands.length) return undefined
  cands.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name))
  return cands[hash32(`hot:${formation}`, 5) % Math.min(2, cands.length)].name
}

/** The formation a play lines up in. */
export function formationOf(playName: string): string {
  return formationForConcept(playName)
}

/** Does a play need a fullback the club may not have? */
export function needsFullback(playName: string): boolean {
  return formationHasFullback(formationForConcept(playName))
}

// ── The look ─────────────────────────────────────────────────────────────────

/** The disinformation shell: man↔zone, blitz↔stack, two-high→zone. */
export function disguiseOf(def: DefCall): DefCall {
  switch (def) {
    case 'man':
      return 'zone'
    case 'zone':
      return 'man'
    case 'blitz':
      return 'stack'
    case 'stack':
      return 'blitz'
    case 'twoHigh':
      return 'zone'
  }
}

/**
 * What the QB believes he sees. Truthful with
 * p = clamp(0.55 + (AWR−70)·0.01 + (sharp film ? 0.10), 0.5, 0.85), else a
 * disguise. The AWR is the specific quarterback's own rating.
 */
export function lookFor(def: DefCall, awr: number, sharp: boolean, key: string): { shown: DefCall; truthful: boolean } {
  const p = clamp(PC.lookBase + (awr - 70) * PC.lookAwrW + (sharp ? PC.lookSharp : 0), PC.lookLo, PC.lookHi)
  const truthful = h01(`${key}:look`) < p
  return { shown: truthful ? def : disguiseOf(def), truthful }
}

/**
 * The QB's check: does his own read (his AWR + experience, as a deviation from
 * the league's starters) plus the pre-snap look convince him to change class?
 * Returns the class to check to, or null to keep the call. Hash only, no rng.
 */
export function qbCheck(
  look: DefCall,
  cls: OffClass,
  check: OffClass | undefined,
  readDev: number,
  key: string,
): OffClass | null {
  if (!check || check === cls) return null
  if (callEdge(check, look) <= callEdge(cls, look)) return null
  const p = clamp(PC.audBase + readDev * PC.audReadW, PC.audLo, PC.audHi)
  return h01(`${key}:qbaud`) < p ? check : null
}

// ── Moment options ───────────────────────────────────────────────────────────

export interface AudibleOption {
  id: string
  /** The playbook play name the option resolves to ('keep' keeps the current call). */
  play: string
  label: string
  hint: string
}

/**
 * The offensive audible card's options: Keep / Check to X / Kill to hot. The
 * check and hot entries are omitted when they do not exist or duplicate.
 * `allow` lets the caller drop a play the personnel cannot line up (a club with
 * no fullback), so the card never offers a check the club cannot run.
 */
export function audibleOptions(
  playName: string,
  checks?: Record<string, string>,
  allow?: (play: string) => boolean,
): AudibleOption[] {
  const opts: AudibleOption[] = [{ id: 'keep', play: playName, label: 'Keep the call', hint: 'Run the play as called' }]
  const ok = (p: string) => !allow || allow(p)
  const check = checkFor(playName, checks)
  if (check && check !== playName && ok(check)) {
    const p = playbookPlay(check)
    opts.push({ id: `check:${check}`, play: check, label: `Check to ${check}`, hint: p?.description ?? 'Audible to the opposite class' })
  }
  const hot = hotFor(formationOf(playName))
  if (hot && hot !== playName && hot !== check && ok(hot)) {
    const p = playbookPlay(hot)
    opts.push({ id: `hot:${hot}`, play: hot, label: `Kill to ${hot}`, hint: p?.description ?? 'Hot route: get the ball out' })
  }
  return opts
}

export interface DefAudibleOption {
  id: 'stay' | DefCall
  label: string
  hint: string
}

/** The defensive audible card's options: Stay / Rotate / Pressure / Load box. */
export function defAudibleOptions(): DefAudibleOption[] {
  return [
    { id: 'stay', label: 'Stay', hint: 'Keep the called defence' },
    { id: 'twoHigh', label: 'Rotate (two-high)', hint: 'Drop a safety over the top' },
    { id: 'blitz', label: 'Pressure (blitz)', hint: 'Send an extra rusher' },
    { id: 'stack', label: 'Load box (stack)', hint: 'Crowd the line against the run' },
  ]
}

/** Resolve an offensive audible answer to a playbook play name. */
export function resolveAudible(choiceId: string, current: string): string {
  if (choiceId === 'keep') return current
  const i = choiceId.indexOf(':')
  return i >= 0 ? choiceId.slice(i + 1) : choiceId
}

/** Resolve a defensive audible answer to a defensive call. */
export function resolveDefAudible(choiceId: string, current: DefCall): DefCall {
  if (choiceId === 'stay') return current
  return DEF_CALLS.includes(choiceId as DefCall) ? (choiceId as DefCall) : current
}

/** The class a playbook play belongs to. */
export function classOfPlay(playName: string): OffClass | undefined {
  const c = conceptFromPlaybook(playName)
  if (!c) return undefined
  return c.type === 'run' ? 'run' : c.depth >= 9 ? 'deep' : 'short'
}

/** All offensive sheet plays as (name, class) rows, for the probe. */
export function sheetRows(calling: PlayCallingPlan | undefined): { bucket: Bucket; plays: string[]; calls: DefCall[] }[] {
  return BUCKETS.map((b) => ({
    bucket: b,
    plays: (calling?.sheet.off[b] ?? []) as string[],
    calls: (calling?.sheet.def[b] ?? []) as DefCall[],
  }))
}

/** The class of a defensive call against an offensive class (probe helper). */
export function edgeOf(cls: OffClass, def: DefCall): number {
  return callEdge(cls, def)
}

export { OFF_CLASSES }

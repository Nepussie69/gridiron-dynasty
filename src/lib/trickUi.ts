// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #24 (T2 UI): the pure data behind the trick-plays card and the game-
// day Tricks tab. No React, no store, no rng — the install card and the picker
// both read these, and the probe asserts the same values the screen shows.
// ─────────────────────────────────────────────────────────────────────────────

import { TRICK, TRICKS, TRICK_KINDS, isTrickKind, trickAlert, trickIsAlert, type TrickKind } from '../game/engine/trickPlays'
import type { STTeamRecord } from '../game/engine/specialCalls'
import type { World } from '../game/engine/generate'
import type { CareerState } from '../game/types'
import type { Moment, MomentOption } from '../game/engine/playsim'
import type { Tone } from './format'

/** How alert the league is to one trick: unseen, seen once, or fully scouted. */
export type TrickAlertLevel = 'fresh' | 'seen' | 'alert'

export const TRICK_ALERT_LABEL: Record<TrickAlertLevel, string> = {
  fresh: 'Fresh',
  seen: 'Seen',
  alert: 'Alert',
}

export const TRICK_ALERT_TONE: Record<TrickAlertLevel, Tone> = {
  fresh: 'win',
  seen: 'warn',
  alert: 'loss',
}

/** A second showing is already a read (the engine's `alertBadge` is the alert line). */
const SEEN_AT = 0.15

export function trickAlertLevel(rec: STTeamRecord | undefined, kind: TrickKind): TrickAlertLevel {
  const a = trickAlert(rec, kind)
  if (a >= TRICK.alertBadge) return 'alert'
  if (a >= SEEN_AT) return 'seen'
  return 'fresh'
}

/** The one-line staff read the picker and the card show under a trick. */
export function trickStaffLine(rec: STTeamRecord | undefined, kind: TrickKind): string {
  const level = trickAlertLevel(rec, kind)
  const record = TRICKS[kind].record
  if (level === 'alert') return `They have seen your ${record} — alert.`
  if (level === 'seen') return `They have seen your ${record} once — it will not surprise them twice.`
  return `Fresh look — the league has not seen your ${record} yet.`
}

/** The club's scouting record this season (a prior season's memory never counts). */
export function trickRecordFor(world: World, teamId: string): STTeamRecord | undefined {
  if (world.stMemory?.season !== world.season) return undefined
  return world.stMemory.teams[teamId]
}

export interface TrickInstallRow {
  kind: TrickKind
  label: string
  hint: string
  selected: boolean
  /** Full package and not selected: unselect one first. */
  disabled: boolean
  level: TrickAlertLevel
  chip: string
  tone: Tone
  staff: string
}

export interface TrickInstallState {
  rows: TrickInstallRow[]
  installed: TrickKind[]
  /** At the two-trick cap. */
  full: boolean
  /** The league is on to at least one of your tricks. */
  predictable: boolean
}

/** Everything the GamePlan install card shows, derived from the career + memory. */
export function trickInstallState(career: CareerState, rec: STTeamRecord | undefined, disabled = false): TrickInstallState {
  const installed = (career.tricks ?? []).filter(isTrickKind).slice(0, TRICK.maxPackage)
  const full = installed.length >= TRICK.maxPackage
  const rows: TrickInstallRow[] = TRICK_KINDS.map((kind) => {
    const selected = installed.includes(kind)
    const level = trickAlertLevel(rec, kind)
    return {
      kind,
      label: TRICKS[kind].label,
      hint: TRICKS[kind].hint,
      selected,
      disabled: disabled || (!selected && full),
      level,
      chip: TRICK_ALERT_LABEL[level],
      tone: TRICK_ALERT_TONE[level],
      staff: trickStaffLine(rec, kind),
    }
  })
  return { rows, installed, full, predictable: trickIsAlert(rec) }
}

// ── The game-day Tricks tab ──────────────────────────────────────────────────

const SURPRISE_RE = /\bSurprise\s+(\d+)%/

/** A tricks-tab option: one of the installed tricks, the real spike, or the fake spike. */
export function isTrickOption(id: string): boolean {
  return id === 'spike' || id.startsWith('trick:')
}

/** The trick an option id names, or null for the real spike / an ordinary call. */
export function trickKindOfOption(id: string): TrickKind | null {
  if (!id.startsWith('trick:')) return null
  const kind = id.slice('trick:'.length)
  return isTrickKind(kind) ? kind : null
}

/** Only the installed tricks plus Spike / Fake spike — never a normal call. */
export function trickCallOptions(moment: Pick<Moment, 'options'>): MomentOption[] {
  return moment.options.filter((o) => isTrickOption(o.id))
}

/** The engine writes "… Surprise 57%" into the option hint. */
export function trickSurprisePct(hint: string): number | null {
  const m = hint.match(SURPRISE_RE)
  return m ? Number(m[1]) : null
}

/** The meter's tone: a wide-open look is good, a read one is bad. */
export function surpriseTone(pct: number): Tone {
  if (pct >= 55) return 'win'
  if (pct >= 35) return 'warn'
  return 'loss'
}

/** The staff line under a game-day trick card. */
export function trickCallStaffLine(option: MomentOption, rec: STTeamRecord | undefined): string {
  const kind = trickKindOfOption(option.id)
  if (!kind) return 'Kill the clock — an incomplete pass and one down gone.'
  return trickStaffLine(rec, kind)
}

/** The route diagram name for a trick option (the engine's TRICK_PLAYS name). */
export function trickDiagramName(option: MomentOption): string | null {
  const kind = trickKindOfOption(option.id)
  return kind ? TRICKS[kind].concept : null
}

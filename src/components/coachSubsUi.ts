// ─────────────────────────────────────────────────────────────────────────────
// J9 (FUTURES #32 follow-up): the sub-rating metadata the Staff UI reads.
//
// Pure data + helpers (no components, so fast-refresh stays clean): what each
// sub does, which subs a seat reads, and the engine's floor for a vacant seat.
// The sheet itself is derived by the engine (game/engine/coachSubs.ts); this
// file never changes it.
// ─────────────────────────────────────────────────────────────────────────────
import type { CoachSubs, StaffMember, StaffRole } from '../game/types'
import { coachSubs, J9 } from '../game/engine/coachSubs'

export type SubKey = keyof CoachSubs

interface SubMeta {
  /** Full name, for the inspector, tooltips and the market sort. */
  label: string
  /** Three-to-five letter tag for the compact chips. */
  tag: string
  /** One line on what the sub does in games. */
  blurb: string
}

export const SUB_META: Record<SubKey, SubMeta> = {
  playCalling: { tag: 'PLAY', label: 'Play calling', blurb: 'Which play is called each snap, against the defence’s look' },
  gameManagement: { tag: 'GAME', label: 'Game management', blurb: 'Clock, timeouts and 4th-down / two-point decisions' },
  adjustments: { tag: 'ADJ', label: 'Adjustments', blurb: 'Halftime and in-game fixes' },
  disguise: { tag: 'DISG', label: 'Disguise', blurb: 'Hiding the coverage shell and pressure' },
  reads: { tag: 'READ', label: 'Reads', blurb: 'Exploiting the opponent’s tendencies' },
  discipline: { tag: 'DISC', label: 'Discipline', blurb: 'Penalties' },
  motivation: { tag: 'MOTIV', label: 'Motivation', blurb: 'Morale' },
  development: { tag: 'DEV', label: 'Development', blurb: 'Player progression' },
}

export function isSubKey(x: string): x is SubKey {
  return x in SUB_META
}

/**
 * Which subs each seat's in-game effects actually read (FUTURES #32):
 *   HC                gameManagement · adjustments · discipline · motivation
 *   OC                playCalling · reads · adjustments
 *   DC                playCalling · disguise · reads · adjustments
 *   position coaches  development · discipline
 * Others (ST coordinator, front office) have no sub panel.
 */
const ROLE_SUBS: Partial<Record<StaffRole, SubKey[]>> = {
  'Head Coach': ['gameManagement', 'adjustments', 'discipline', 'motivation'],
  'Offensive Coordinator': ['playCalling', 'reads', 'adjustments'],
  'Defensive Coordinator': ['playCalling', 'disguise', 'reads', 'adjustments'],
  'QB Coach': ['development', 'discipline'],
  'OL Coach': ['development', 'discipline'],
  'DL Coach': ['development', 'discipline'],
  'Secondary Coach': ['development', 'discipline'],
}

/** The subs a seat shows, or [] when the role has no sub panel. */
export function subsForRole(role: StaffRole): SubKey[] {
  return ROLE_SUBS[role] ?? []
}

/** A vacant coaching seat plays every sub on this floor (engine constant). */
export const SUB_FLOOR = J9.floor

/** One line on what a sub does in games, for the hover / accessible name. */
export function subTitle(key: SubKey, value: number): string {
  const m = SUB_META[key]
  return `${m.label} ${Math.round(value)} — ${m.blurb}`
}

/** A coach's sheet as the sim reads it (derived for old saves). */
export function subValue(m: StaffMember, key: SubKey): number {
  return coachSubs(m)[key]
}

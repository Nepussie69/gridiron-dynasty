// ─────────────────────────────────────────────────────────────────────────────
// Development plans (L15 · FUTURES row 13).
//
// A young player (age ≤ 26) can be given one *focus*: the skill he works on with
// his position coach. It rides the same playing-time growth the rest of the
// season uses — the more snaps and production he earns, the more focused rating
// points he banks — and the program's coaching quality (which is where the
// position coaches live) decides how much that work pays off.
//
// "Auto" gives every young player the focus aimed at his weakest sim-relevant
// area; "Select all" stamps one focus across a whole position group.
//
// The whole system is *opt-in*: AI clubs never carry a focus, so league
// development and calibration are untouched, and a player with no focus develops
// exactly as before. A legacy save (no `devFocus`/`devRatings`) loads clean.
//
// Every gain here is deterministic — no `rng()` draw is added or removed — so a
// season's random stream is identical whether or not plans are set.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player, Position } from '../types'
import { ATTRIBUTE_SCHEMA, playerAttrs } from '../data/ratings'

export type DevFocusId =
  | 'speed'
  | 'strength'
  | 'awareness'
  | 'hands'
  | 'routes'
  | 'protection'
  | 'runBlock'
  | 'passRush'
  | 'runStop'
  | 'coverage'
  | 'ballSecurity'
  | 'kicking'
  | 'accuracy'
  | 'arm'

export interface DevFocusDef {
  id: DevFocusId
  /** Short label for chips and selects. */
  label: string
  /** One-line description of what the focus trains. */
  blurb: string
  /** The ratings this focus trains (filtered to his position's schema). */
  ratings: string[]
  /** The position groups that can run this focus (see `devGroupFor`). */
  groups: string[]
}

const ALL = ['QB', 'RB', 'FB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'KP']

/** The order groups are shown in, and their human labels. */
export const DEV_GROUP_ORDER = ['QB', 'RB', 'FB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'KP'] as const
export const DEV_GROUP_LABEL: Record<string, string> = {
  QB: 'Quarterbacks',
  RB: 'Running Backs',
  FB: 'Fullbacks',
  WR: 'Receivers',
  TE: 'Tight Ends',
  OL: 'Offensive Line',
  DL: 'Defensive Line',
  LB: 'Linebackers',
  CB: 'Cornerbacks',
  S: 'Safeties',
  KP: 'Kickers & Punters',
}

/**
 * The development focus a position group maps to. OT/OG/C share the O-line,
 * DE/DT the D-line, K/P the kicking group.
 */
export function devGroupFor(pos: Position): string {
  if (pos === 'OT' || pos === 'OG' || pos === 'C') return 'OL'
  if (pos === 'DE' || pos === 'DT') return 'DL'
  if (pos === 'K' || pos === 'P') return 'KP'
  return pos
}

export const DEV_FOCUSES: DevFocusDef[] = [
  {
    id: 'speed', label: 'Speed & movement',
    blurb: 'Top-end speed, acceleration and change of direction.',
    ratings: ['SPD', 'ACC', 'AGI', 'COD'], groups: ALL,
  },
  {
    id: 'strength', label: 'Strength & power',
    blurb: 'Functional strength and playing through contact.',
    ratings: ['STR', 'BTK', 'TRK'], groups: ALL,
  },
  {
    id: 'awareness', label: 'Awareness & reads',
    blurb: 'Football IQ, recognition and reacting to what unfolds.',
    ratings: ['AWR', 'PRC'], groups: ALL,
  },
  {
    id: 'hands', label: 'Hands',
    blurb: 'Securing the catch — catchable, contested and spectacular.',
    ratings: ['CTH', 'SPC', 'CIT'], groups: ['RB', 'FB', 'WR', 'TE'],
  },
  {
    id: 'routes', label: 'Route running',
    blurb: 'Separation on short, intermediate and deep routes.',
    ratings: ['SRR', 'MRR', 'DRR', 'RTE'], groups: ['WR', 'TE'],
  },
  {
    id: 'protection', label: 'Pass protection',
    blurb: 'Footwork and technique holding up against the rush.',
    ratings: ['PBK', 'IMP', 'IBL'], groups: ['OL', 'FB', 'TE'],
  },
  {
    id: 'runBlock', label: 'Run blocking',
    blurb: 'Moving the front and finishing blocks in the run game.',
    ratings: ['RBK', 'IMP', 'IBL'], groups: ['OL', 'FB', 'TE'],
  },
  {
    id: 'passRush', label: 'Pass-rush moves',
    blurb: 'Get-off, hand-fighting and collapsing the pocket.',
    ratings: ['PMV', 'FMV', 'BSH'], groups: ['DL', 'LB'],
  },
  {
    id: 'runStop', label: 'Run defense',
    blurb: 'Shedding blocks and bringing the ball carrier down.',
    ratings: ['BSH', 'TAK', 'PUR'], groups: ['DL', 'LB', 'CB', 'S'],
  },
  {
    id: 'coverage', label: 'Coverage',
    blurb: 'Man and zone technique, and reading the quarterback.',
    ratings: ['MCV', 'ZCV', 'PRC'], groups: ['LB', 'CB', 'S'],
  },
  {
    id: 'ballSecurity', label: 'Ball security',
    blurb: 'Carrying the ball and breaking tackles for extra yards.',
    ratings: ['CAR', 'BTK'], groups: ['QB', 'RB', 'FB', 'WR', 'TE'],
  },
  {
    id: 'kicking', label: 'Kicking',
    blurb: 'Leg strength and accuracy on kicks and punts.',
    ratings: ['KPW', 'KAC'], groups: ['KP'],
  },
  {
    id: 'accuracy', label: 'Passing accuracy',
    blurb: 'Short, medium and deep ball placement.',
    ratings: ['SAC', 'MAC', 'DAC'], groups: ['QB'],
  },
  {
    id: 'arm', label: 'Arm strength',
    blurb: 'Throw power, on the run and under pressure.',
    ratings: ['THP', 'TOR', 'TUP'], groups: ['QB'],
  },
]

/** How many rating points a player can bank in one focused skill over a career. */
export const MAX_FOCUS_BONUS = 6

/** The oldest age a development plan is offered for (matches `developPlayers`). */
export const MAX_DEV_AGE = 26

export function devFocusById(id: string | undefined | null): DevFocusDef | undefined {
  if (!id) return undefined
  return DEV_FOCUSES.find((f) => f.id === id)
}

/** The ratings a focus actually trains for a given position (schema-filtered). */
export function focusKeysFor(pos: Position, focus: DevFocusDef): string[] {
  const schema = ATTRIBUTE_SCHEMA[pos] ?? []
  return focus.ratings.filter((k) => schema.includes(k))
}

/** The focuses a position can run, each with its valid rating keys. */
export function focusOptionsFor(pos: Position): DevFocusDef[] {
  const group = devGroupFor(pos)
  return DEV_FOCUSES.filter((f) => f.groups.includes(group) && focusKeysFor(pos, f).length > 0)
}

/**
 * The focus aimed at a player's weakest sim-relevant area: the option whose
 * target ratings average the lowest right now. Ties keep registry order.
 */
export function autoFocusFor(p: Player): DevFocusId {
  const opts = focusOptionsFor(p.pos)
  if (!opts.length) return 'awareness'
  const attrs = playerAttrs(p)
  let best = opts[0]
  let bestAvg = Infinity
  for (const f of opts) {
    const keys = focusKeysFor(p.pos, f)
    const avg = keys.reduce((s, k) => s + (attrs[k] ?? 70), 0) / keys.length
    if (avg < bestAvg - 1e-9) {
      bestAvg = avg
      best = f
    }
  }
  return best.id
}

/**
 * Focused rating points earned this season. Tied directly to the playing-time
 * experience score (a bench player earns nothing) and boosted by a strong
 * development program — i.e. the position-coach specialties. Deterministic.
 */
export function focusPointsFor(experience: number, program: number): number {
  if (experience < 0.3) return 0
  let pts = 1
  if (experience >= 0.55) pts += 1
  if (program >= 1.06) pts += 1
  return pts
}

/**
 * Bank this season's focused points into `p.devRatings` (additive, capped). The
 * sim and the UI read the merged total through `playerAttrs`, so the rating is
 * always "derived from OVR" plus the plan's earned bonus. No `rng()`.
 */
export function applyDevFocus(p: Player, points: number): void {
  if (points <= 0) return
  const def = devFocusById(p.devFocus)
  if (!def) return
  const keys = focusKeysFor(p.pos, def)
  if (!keys.length) return
  const gains: Record<string, number> = { ...(p.devRatings ?? {}) }
  for (const k of keys) {
    gains[k] = Math.min(MAX_FOCUS_BONUS, Math.max(0, (gains[k] ?? 0) + points))
  }
  p.devRatings = gains
}

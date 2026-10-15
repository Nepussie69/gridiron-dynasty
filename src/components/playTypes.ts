// ─────────────────────────────────────────────────────────────────────────────
// Play-type grouping for the game-day offense picker (UI only).
//
// `playTypeOf` is ONE pure function that puts every `PLAYBOOK` play in exactly
// one tab, decided from the play's own data (its name, type, depth and route
// assignments) — no React, no store, no rng. `PLAY_TYPE_RULES` is the same
// order the function walks, so a probe can assert each play matches exactly one
// rule (`0 unclassified, 0 double-classified`).
//
// The rule — first match wins and the tests are mutually exclusive, so a play
// can never land in two tabs:
//   1. RPO      — a play whose name says RPO / read option / zone read. This is
//                 checked first, so RPO Bubble is an RPO, not a screen.
//   2. Screen   — a pass whose name says screen, or that sends a receiver on a
//                 screen / bubble / tunnel / jailbreak route (RB Screen, WR
//                 screens). A bare "swing" route is not a screen (Hank keeps
//                 its medium depth).
//   3. Outside  — a run whose name says outside / stretch / toss / sweep /
//                 pin-pull / jet (Outside Zone, Toss, Jet Sweep …).
//   4. Inside   — any other run: inside zone, power, counter, duo, iso, trap,
//                 draw, sneak, QB draw, and a bare "zone" run (no "outside").
//   5. Quick    — a drop-back pass thrown at or behind 5 yards:  depth ≤ 5.
//   6. Medium   — a drop-back pass at 6–15 yards:  6 ≤ depth ≤ 15.
//   7. Long     — a drop-back pass 16 yards or deeper:  depth ≥ 16.
//
// Trick plays never reach here: the picker's own options introduce them by id
// (`trick:*`, and the real `spike`), so they keep their own tab.
// ─────────────────────────────────────────────────────────────────────────────

import { playbookPlay, type PlaybookPlay } from '../game/data/playbookData'

/** One tab of the offense picker in "By type" mode. */
export type PlayTypeTab = 'inside' | 'outside' | 'rpo' | 'quick' | 'screen' | 'medium' | 'long'

/** The tabs, in the order the picker shows them (empty tabs are hidden). */
export const PLAY_TYPE_TABS: readonly { id: PlayTypeTab; label: string }[] = [
  { id: 'inside', label: 'Inside run' },
  { id: 'outside', label: 'Outside run' },
  { id: 'rpo', label: 'RPO' },
  { id: 'quick', label: 'Quick pass' },
  { id: 'screen', label: 'Screen' },
  { id: 'medium', label: 'Medium pass' },
  { id: 'long', label: 'Long pass' },
]

/** Screen-route keys from `routes.ts` — a pass out to a blocker on the edge. */
const SCREEN_ROUTES = new Set(['screen', 'bubble', 'tunnel', 'jailbreak'])

const RPO_RE = /\brpo\b|read option|zone read/i
const SCREEN_RE = /\bscreen\b/i
const OUTSIDE_RE = /outside|stretch|\btoss\b|sweep|\bpin[- ]?pull\b|\bjet\b/i

interface PlayTypeRule {
  tab: PlayTypeTab
  /** Why the rule exists, for the probe's table. */
  why: string
  test: (p: PlaybookPlay) => boolean
}

const isRun = (p: PlaybookPlay) => p.type === 'run'
const isPass = (p: PlaybookPlay) => p.type === 'pass'
const routesOf = (p: PlaybookPlay) => p.assignments.map((a) => a.route ?? '')
const namedRpo = (p: PlaybookPlay) => RPO_RE.test(p.name)
const namedScreen = (p: PlaybookPlay) =>
  isPass(p) && !namedRpo(p) && (SCREEN_RE.test(p.name) || routesOf(p).some((r) => SCREEN_ROUTES.has(r)))
const namedOutside = (p: PlaybookPlay) => isRun(p) && !namedRpo(p) && OUTSIDE_RE.test(p.name)
/** A drop-back pass: not an RPO and not a screen — what depth then decides. */
const plainPass = (p: PlaybookPlay) => isPass(p) && !namedRpo(p) && !namedScreen(p)

/**
 * The ordered rules `playTypeOf` walks. The tests are mutually exclusive on
 * purpose: every play matches exactly one rule (a probe can assert that), so
 * every play lands in exactly one tab.
 */
export const PLAY_TYPE_RULES: readonly PlayTypeRule[] = [
  { tab: 'rpo', why: 'name says RPO / read option / zone read', test: namedRpo },
  {
    tab: 'screen',
    why: 'pass with a screen name or screen / bubble / tunnel / jailbreak route',
    test: namedScreen,
  },
  { tab: 'outside', why: 'run named outside / stretch / toss / sweep / pin-pull / jet', test: namedOutside },
  { tab: 'inside', why: 'any other run', test: (p) => isRun(p) && !namedRpo(p) && !namedOutside(p) },
  { tab: 'quick', why: 'pass designed at 5 yards or fewer (depth ≤ 5)', test: (p) => plainPass(p) && p.depth <= 5 },
  { tab: 'medium', why: 'pass designed 6–15 yards', test: (p) => plainPass(p) && p.depth >= 6 && p.depth <= 15 },
  { tab: 'long', why: 'pass designed 16+ yards', test: (p) => plainPass(p) && p.depth >= 16 },
]

/**
 * The one tab a play belongs in, from the play's own data. Pure: same play,
 * same answer. Throws only if the playbook grows a shape the rules don't cover
 * (the probe is the guard for that).
 */
export function playTypeOf(play: PlaybookPlay): PlayTypeTab {
  const rule = PLAY_TYPE_RULES.find((r) => r.test(play))
  if (!rule) throw new Error(`unclassified play: ${play.name}`)
  return rule.tab
}

/**
 * The tab for a picker option id, or null when the id isn't a playbook play
 * (a trick call or the real spike) — the caller then keeps it in its own tab.
 */
export function playTypeTabForId(id: string): PlayTypeTab | null {
  const p = playbookPlay(id)
  return p ? playTypeOf(p) : null
}

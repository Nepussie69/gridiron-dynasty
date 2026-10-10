// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #5: challenges & replay review — constants and the officiating layer.
//
// The sim resolves a `PlayOutcome`: that is the TRUTH the league was calibrated
// on. This module adds a thin officiating layer between the resolvers and the
// apply block. It marks a fraction of scrimmage plays CLOSE with a deterministic
// per-play hash (`h01`, never an rng() draw) and, on a share of those, produces
// a different ON-FIELD RULING.
//
//   • The booth domain — the last two minutes of Q2 and Q4, all of overtime, and
//     every play ruled a score or a turnover — always applies the TRUTH and only
//     records what it saw (`Play.review`). Display-only: outcomes are identical
//     to running with reviews off.
//   • The challenge domain — everything else — applies the RULING, and the hurt
//     club may throw the red flag at the start of the next step. That decision
//     and its reversal ship in C2. Until then C1 applies the truth in every
//     domain, so calibration is byte-identical to the base.
//
// Nothing here draws the rng, mutates its arguments or changes an outcome.
// ─────────────────────────────────────────────────────────────────────────────

import type { World } from './generate'
import type { GameState, PlayOutcome, TeamGameStats } from './playsim'
import { hash32 } from './rng'

export type ReviewKind = 'spot' | 'catch' | 'fumble' | 'goalLine'

/** What `Play.review` records about a reviewed play. */
export interface PlayReview {
  /** Who reviewed it: the booth, or the club that threw the flag. */
  by: 'booth' | 'challenge'
  kind: ReviewKind
  /** The on-field ruling, e.g. 'ruled down by contact'. */
  ruling: string
  outcome: 'reversed' | 'stands' | 'confirmed'
  /** The replay read (0–1) on a challenge review; absent for the booth. */
  read?: number
}

/** Challenges left / won / lost for one club. Never reset at halftime. */
export interface ChallengeState { left: number; won: number; lost: number }

/**
 * The state a pending challenge-domain review snapshots so that, after a
 * reversal, the truth can be re-applied onto the pre-play world (C2).
 */
export interface ReviewSnapshot {
  homeScore: number
  awayScore: number
  offId: string
  defId: string
  yard: number
  down: number
  distance: number
  phase: GameState['phase']
  clock: number
  timeouts: Record<string, number>
  timeoutsUsed: Record<string, number>
  manualTimeout?: string
  driveSnaps: number
  twoMinMode: GameState['twoMinMode']
  stats: { home: TeamGameStats; away: TeamGameStats }
}

/** A challenge-domain ruling awaiting the hurt club's decision (C2). */
export interface PendingReview {
  /** The index of the ruled play in `s.plays`. */
  playIdx: number
  truth: PlayOutcome
  kind: ReviewKind
  snap: ReviewSnapshot
}

/** The minimal state a close-call hash reads (GameState satisfies it). */
export interface CloseState { n: number; yard: number; distance: number; offId: string }

/**
 * The minimal outcome a close call reads. Both the sim's `PlayOutcome` and a
 * stored `Play` satisfy it, so the probe can re-derive every close call from the
 * play log alone.
 */
export interface CloseOutcome {
  type: string
  yards: number
  result: string
  turnover: boolean
  intId?: string
  defTD?: boolean
  safety?: boolean
  reception?: boolean
  targetId?: string
  passDepth?: number
  fumbleCause?: 'run' | 'carry' | 'strip' | 'muff' | 'kickoff'
  fumbleId?: string
  muffedCatch?: boolean
  stripSack?: boolean
}

let REPLAY_REVIEW = true
/** Enable/disable the whole reviews layer (off = no close plays at all). */
export function setReplayReview(on: boolean) { REPLAY_REVIEW = on }
export function getReplayReview(): boolean { return REPLAY_REVIEW }

/**
 * FUTURES #5 rate constants. The close-play and mis-call rates are tuned only
 * with scripts/probe-review.mjs — never by touching the sim. Targets: the booth
 * gives ~1.0–1.6 stoppage reviews per game; the challenge domain gives roughly
 * 0.3–0.6 coach challenges per game at ~35–55 % success (C2).
 */
export const REVIEW = {
  /** The booth window opens this many seconds before halftime / the end of Q4. */
  boothSec: 120,
  /** Share of eligible plays each kind marks CLOSE (the truth's own bang-bang set). */
  closeRate: { spot: 0.14, catch: 0.09, fumble: 0.45, goalLine: 0.3 } as Record<ReviewKind, number>,
  /** Among close plays, the share the on-field ruling gets WRONG. */
  missRate: { spot: 0.12, catch: 0.18, fumble: 0.1, goalLine: 0.1 } as Record<ReviewKind, number>,
  /** Booth-only reverse direction: the official invents a fumble / a touchdown on
   *  a play the truth says was down (per eligible play; rare). */
  reverseRate: { fumble: 0.004, goalLine: 0.02 } as Record<'fumble' | 'goalLine', number>,
  /** A challenged mis-call is reversed; the rest stand, inconclusive (C2). */
  challengeReverse: 0.85,
  /** The replay read centres here on a wrong / right call (C2). */
  readWrong: 0.72,
  readRight: 0.32,
  /** Read noise (±) at analyticsRating 40 / 90; linear between (C2). */
  readNoiseLo: 0.25,
  readNoiseHi: 0.1,
  /** Red-flag thresholds for the call-sheet styles (C2). */
  threshold: { aggressive: 0.55, standard: 0.65, conservative: 0.78 } as Record<string, number>,
}

/** Deterministic uniform in [0,1) from a string key — mirrors playsim's h01. */
function h01(key: string): number {
  return (hash32(key) >>> 0) / 4294967296
}

/** The last two minutes of each half, and all of overtime. */
export function inBoothWindow(s: { qtr: number; clock: number }): boolean {
  if (s.qtr > 4) return true
  return (s.qtr === 2 || s.qtr === 4) && s.clock <= REVIEW.boothSec
}

/** The truth is a touchdown the ball reached the end zone on. */
function isTrueScore(s: CloseState, out: CloseOutcome): boolean {
  return !out.turnover && !out.defTD && !out.safety && s.yard + out.yards >= 100
}

/** A true lost fumble on a run or a catch (not a defensive score or a strip sack). */
function isLostFumble(out: CloseOutcome): boolean {
  return out.turnover && !out.defTD && !out.intId && !out.stripSack &&
    (out.muffedCatch === true || out.fumbleId != null ||
      out.fumbleCause === 'run' || out.fumbleCause === 'carry' || out.fumbleCause === 'muff')
}

/**
 * Is this play CLOSE, and to which kind? Scrimmage run/pass only — kicks,
 * penalties and two-point tries are out of scope. The hashes are keyed on the
 * play number and the club, so a call is stable across a rebuild and never draws
 * the rng.
 */
export function closeKind(s: CloseState, out: CloseOutcome): ReviewKind | null {
  if (out.type !== 'run' && out.type !== 'pass') return null
  if (out.safety) return null
  const gained = s.yard + out.yards

  // ── The truth's own bang-bang plays ────────────────────────────────────────
  if (isTrueScore(s, out)) {
    // goalLine: a true TD the carrier was stopped in the last yard of.
    if (gained <= 101 && h01(`${s.n}:${s.offId}:close:goalLine`) < REVIEW.closeRate.goalLine) return 'goalLine'
  } else if (isLostFumble(out)) {
    // fumble: a true lost fumble on a run or catch, ruled down by contact.
    if (h01(`${s.n}:${s.offId}:close:fumble`) < REVIEW.closeRate.fumble) return 'fumble'
  } else if (out.type === 'pass' && !out.intId && !out.turnover) {
    // catch: a contested completion ruled incomplete, or a contested
    // incompletion (has a target, not an INT) ruled a catch.
    const completion = out.reception === true && gained < 100
    const incompletion = out.result === 'Incomplete' && out.targetId != null
    if ((completion || incompletion) && h01(`${s.n}:${s.offId}:close:catch`) < REVIEW.closeRate.catch) return 'catch'
  } else if ((out.type === 'run' || out.reception === true) && !out.turnover && !out.defTD && gained < 100 &&
    s.distance >= 1 && Math.abs(out.yards - s.distance) <= 1) {
    // spot: a gain within a yard of the line to gain, moved across it.
    if (h01(`${s.n}:${s.offId}:close:spot`) < REVIEW.closeRate.spot) return 'spot'
  }

  // ── Booth-only reverse: the official invented a score / turnover on a play the
  //    truth says was down. Only the booth can correct it. ───────────────────
  if (!out.turnover && !out.defTD && gained < 100 && (out.type === 'run' || out.reception === true)) {
    if (out.type === 'run' && gained >= 1 && gained <= 2 &&
      h01(`${s.n}:${s.offId}:close:reverseGL`) < REVIEW.reverseRate.goalLine) return 'goalLine'
    if (out.yards <= 2 && h01(`${s.n}:${s.offId}:close:reverseFum`) < REVIEW.reverseRate.fumble) return 'fumble'
  }
  return null
}

/** Was the on-field ruling WRONG? (a per-kind hash, no rng draw). */
export function wrongCall(s: CloseState, _out: CloseOutcome, kind: ReviewKind): boolean {
  return h01(`${s.n}:${s.offId}:miss:${kind}`) < REVIEW.missRate[kind]
}

export interface AltRuling {
  /** Text of the on-field ruling when it differs from the truth. */
  text: string
  /** The ruling is a score (which puts the play in the booth domain). */
  score: boolean
  /** The ruling is a turnover (which puts the play in the booth domain). */
  turnover: boolean
}

/** The on-field ruling's text when it differs from the truth (a mis-call). */
export function altRuling(kind: ReviewKind, s: CloseState, out: CloseOutcome): AltRuling {
  switch (kind) {
    case 'spot':
      return out.yards >= s.distance
        ? { text: 'ruled short of the line to gain', score: false, turnover: false }
        : { text: 'ruled a first down', score: false, turnover: false }
    case 'catch':
      return out.result === 'Incomplete'
        ? { text: `ruled a catch at the ${Math.min(s.yard + (out.passDepth ?? 0), 99)}`, score: false, turnover: false }
        : { text: 'ruled incomplete', score: false, turnover: false }
    case 'fumble':
      return out.turnover
        ? { text: 'ruled down by contact', score: false, turnover: false }
        : { text: 'ruled a fumble, recovered by the defence', score: false, turnover: true }
    case 'goalLine':
      return s.yard + out.yards >= 100
        ? { text: 'ruled down at the 1', score: false, turnover: false }
        : { text: 'ruled a touchdown', score: true, turnover: false }
  }
}

/** The on-field ruling: the alt when the official got it wrong, else the truth. */
export function onFieldRuling(kind: ReviewKind, s: CloseState, out: CloseOutcome, wrong: boolean): AltRuling {
  if (wrong) return altRuling(kind, s, out)
  switch (kind) {
    case 'spot': return { text: out.yards >= s.distance ? 'ruled a first down' : 'ruled short of the line to gain', score: false, turnover: false }
    case 'catch': return { text: out.result === 'Incomplete' ? 'ruled incomplete' : 'ruled a catch', score: false, turnover: false }
    case 'fumble': return { text: 'ruled a fumble', score: false, turnover: true }
    case 'goalLine': return { text: 'ruled a touchdown', score: true, turnover: false }
  }
}

export interface CloseCall { kind: ReviewKind; alt: AltRuling; wrong: boolean }

/** Classify a play: null when it is not close, else its kind and ruling. */
export function closeCall(s: CloseState, out: CloseOutcome): CloseCall | null {
  const kind = closeKind(s, out)
  if (!kind) return null
  const alt = altRuling(kind, s, out)
  // A reverse ruling (an invented score/turnover on a play the truth says was
  // down) is wrong by construction; otherwise the miss hash decides.
  const wrong = alt.score || alt.turnover ? true : wrongCall(s, out, kind)
  return { kind, alt, wrong }
}

export interface Officiated {
  /** The outcome to apply: the truth in C1 (the ruling in C2's challenge domain). */
  applied: PlayOutcome
  /** The resolved truth. */
  truth: PlayOutcome
  /** A booth review record, or null when the play is not reviewed. */
  review: PlayReview | null
}

/**
 * Mark the play close, produce the on-field ruling and, in the booth domain,
 * record the review. C1: `applied` is always the truth, so outcomes and the rng
 * stream are unchanged. Nothing here mutates `s` or `out`.
 */
export function officiate(
  _world: World,
  s: GameState,
  out: PlayOutcome,
  _fourthChoice?: 'go' | 'fg' | 'punt' | 'fake' | null,
): Officiated {
  if (!REPLAY_REVIEW) return { applied: out, truth: out, review: null }
  const st: CloseState = { n: s.n, yard: s.yard, distance: s.distance, offId: s.offId }
  const call = closeCall(st, out)
  if (!call) return { applied: out, truth: out, review: null }
  const ruling = onFieldRuling(call.kind, st, out, call.wrong)
  const booth = inBoothWindow(s) || ruling.score || ruling.turnover
  if (!booth) return { applied: out, truth: out, review: null }
  return {
    applied: out,
    truth: out,
    review: { by: 'booth', kind: call.kind, ruling: ruling.text, outcome: call.wrong ? 'reversed' : 'confirmed' },
  }
}

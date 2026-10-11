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
import { aiCallSheet, type CallSheet, type DefCall } from './decisions'
import { analyticsRating } from './analytics'
import { hash32 } from './rng'

export type ReviewKind = 'spot' | 'catch' | 'fumble' | 'goalLine'

/** What `Play.review` records about a reviewed play. */
export interface PlayReview {
  /** Who reviewed it: the booth, or 'challenge' for a club's red flag. */
  by: 'booth' | 'challenge'
  /** The club that threw the flag on a challenge review (absent for the booth). */
  club?: string
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
  twoMinChecked: boolean
  /** C2: the play counter, so a reversal re-issues the same play number. */
  n: number
  /** C2: the user's drive counter, moved by a possession swap. */
  userDrive: number
  /** C2: in-game fatigue, rested by a possession swap (cloned after chargeSnaps). */
  fat: Record<string, number>
  stats: { home: TeamGameStats; away: TeamGameStats }
}

/**
 * A challenge-domain close call awaiting the hurt club's decision (C2). The
 * truth is kept so a reversal can re-apply it, and the snapshot is the
 * post-chargeSnaps, pre-apply state the ruling was applied on top of.
 */
export interface PendingReview {
  /** The index of the ruled play in `s.plays`. */
  playIdx: number
  truth: PlayOutcome
  kind: ReviewKind
  /** The on-field ruling was wrong (a challenge can only fix a mis-call). */
  wrong: boolean
  /** The club the on-field ruling went against (the only club that may throw). */
  hurt: string
  /** The on-field ruling text, e.g. 'ruled down by contact'. */
  ruling: string
  /** The 4th-down choice the ruled play was resolved with (for an exact re-apply). */
  fourthChoice: 'go' | 'fg' | 'punt' | 'fake' | null
  /** The defensive call recorded on the ruled play (for an exact re-apply). */
  defCall?: DefCall
  snap: ReviewSnapshot
}

/** The minimal state a close-call hash reads (GameState and Play satisfy it). */
export interface CloseState { n: number; yard: number; distance: number; offId: string; defId: string }

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
  /** J3: the concept's nominal depth, present only with the air model on. The catch
   *  ruling uses it (the spot the pre-J3 engine used) so the emitted air yards stay
   *  presentation-only. */
  passConceptDepth?: number
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
  /** Among close plays, the share the on-field ruling gets WRONG. Kept low so
   *  the challenge-domain drift (mis-calls that stand) stays inside the spec's
   *  |Δ points| ≤ 0.15: the truth-first rule only drifts on a mis-call that is
   *  never reversed. C2 calibration trimmed the spot and catch rates by ~15 %
   *  (their two directions cancel, so this eases the drift); the fumble rate is
   *  deliberately left the lowest, since a fumble mis-call that stands only ever
   *  favours the offence (fewer giveaways). */
  missRate: { spot: 0.051, catch: 0.0765, fumble: 0.05, goalLine: 0.05 } as Record<ReviewKind, number>,
  /** Booth-only reverse direction: the official invents a fumble / a touchdown on
   *  a play the truth says was down (per eligible play; rare). */
  reverseRate: { fumble: 0.004, goalLine: 0.02 } as Record<'fumble' | 'goalLine', number>,
  /** A challenged mis-call is reversed; the rest stand, inconclusive (C2). */
  challengeReverse: 0.85,
  /**
   * The replay read centres here on a wrong / right call (C2). Tuned with the
   * probe against the spec's target ranges (0.3–0.6 challenges/game at 35–55 %
   * success) and the calibration drift limit: the mis-call rate is low (so the
   * drift is small) and the read gap is wide enough that the AI still throws at
   * roughly half the wrong calls while rarely throwing on a correct one.
   */
  readWrong: 0.78,
  readRight: 0.45,
  /** Read noise (±) at analyticsRating 40 / 90; linear between (C2). */
  readNoiseLo: 0.3,
  readNoiseHi: 0.12,
  /** Red-flag thresholds for the call-sheet styles (C2). */
  threshold: { aggressive: 0.66, standard: 0.72, conservative: 0.8 } as Record<string, number>,
  /**
   * C2: the hash-coin an AI club adds to its read, so clubs also throw on some
   * calls that will stand. Centred on zero (± this / 2).
   */
  aiCoin: 0.15,
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
    case 'spot': {
      // A ruling moved 1 yd across the line to gain can reach the end zone (the
      // truth was short at the goal line). A ruling that is a score is the booth's.
      const ruledYards = out.yards >= s.distance ? s.distance - 1 : s.distance
      const score = s.yard + ruledYards >= 100
      return out.yards >= s.distance
        ? { text: score ? 'ruled a touchdown' : 'ruled short of the line to gain', score, turnover: false }
        : { text: score ? 'ruled a touchdown' : 'ruled a first down', score, turnover: false }
    }
    case 'catch':
      return out.result === 'Incomplete'
        ? { text: `ruled a catch at the ${Math.min(s.yard + (out.passConceptDepth ?? out.passDepth ?? 0), 99)}`, score: false, turnover: false }
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

/**
 * C2: a fumble ruled "down by contact" inside the offence's own end zone is a
 * safety — a score, so the booth owns it (the truth is applied). Kept pure so
 * the probe can re-derive it from the play log.
 */
export function rulingSafety(s: CloseState, out: CloseOutcome, kind: ReviewKind, wrong: boolean): boolean {
  if (kind !== 'fumble' || out.type !== 'run') return false
  const ruled = onFieldRuling(kind, s, out, wrong)
  if (ruled.turnover) return false
  return s.yard <= 4 && s.yard + out.yards <= 0
}

/**
 * C2: the club the on-field ruling went against — the only club that may throw
 * the red flag. For a correct call this is still well-defined (the club that
 * wanted the other ruling), which is why a wrong challenge is possible.
 */
export function rulingAgainst(s: CloseState, out: CloseOutcome, kind: ReviewKind, wrong: boolean): string {
  switch (kind) {
    case 'spot': {
      const ruledShort = wrong ? out.yards >= s.distance : out.yards < s.distance
      return ruledShort ? s.offId : s.defId
    }
    case 'catch': {
      const ruledIncomplete = wrong ? !(out.result === 'Incomplete') : out.result === 'Incomplete'
      return ruledIncomplete ? s.offId : s.defId
    }
    case 'fumble': {
      const ruledFumble = wrong ? !out.turnover : out.turnover
      return ruledFumble ? s.offId : s.defId
    }
    case 'goalLine': {
      const ruledTD = wrong ? s.yard + out.yards < 100 : s.yard + out.yards >= 100
      return ruledTD ? s.defId : s.offId
    }
  }
}

/**
 * C2: the truth outcome rewritten as the on-field RULING, so applying it lands
 * the game exactly where the officials put it. Only the stat-relevant fields
 * change, and the result text stays one the box score understands. Pure.
 */
export function rulingOutcome(kind: ReviewKind, s: CloseState, out: PlayOutcome): PlayOutcome {
  switch (kind) {
    case 'spot': {
      const first = out.yards >= s.distance
      // Move the gain 1 yd across the line to gain in the ruled direction.
      return { ...out, yards: first ? s.distance - 1 : s.distance }
    }
    case 'catch': {
      if (out.result === 'Incomplete') {
        // A contested incompletion ruled a catch, caught at the concept depth
        // (J3: the air model's emitted `passDepth` is presentation-only, so the
        // ruling keeps the pre-J3 spot), short of the goal line.
        const yards = Math.max(0, Math.min(out.passConceptDepth ?? out.passDepth ?? 0, 99 - s.yard))
        return { ...out, result: 'Complete', yards, reception: true }
      }
      // A contested completion ruled incomplete.
      return { ...out, result: 'Incomplete', yards: 0, reception: false, fumbleId: undefined, muffedCatch: undefined, carrierId: undefined }
    }
    case 'fumble':
      // A true lost fumble ruled down by contact: the gain stands, no takeaway.
      // The result text is cleared so no toast/animation shows a fumble.
      return { ...out, turnover: false, result: out.reception ? 'Complete' : 'Down by contact' }
    case 'goalLine': {
      // A true touchdown ruled down at the 1 (a completion, or a run stopped short).
      const result = out.type === 'run' ? 'Down at the 1' : 'Complete'
      return { ...out, yards: 99 - s.yard, result, turnover: false, scorerId: undefined, scorerName: undefined }
    }
  }
}

export interface Officiated {
  /** The outcome to apply: the truth in the booth domain, the ruling otherwise. */
  applied: PlayOutcome
  /** The resolved truth. */
  truth: PlayOutcome
  /** A booth review record, or null when the play is not reviewed by the booth. */
  review: PlayReview | null
  /** Set on a challenge-domain close call, so the hurt club may throw a flag. */
  challenge: { kind: ReviewKind; hurt: string; wrong: boolean; ruling: string } | null
}

/**
 * Mark the play close, produce the on-field ruling and decide the domain.
 * Booth domain (last 2:00 of Q2/Q4, all OT, a ruling that is a score or a
 * turnover): the truth is applied and the review is recorded — display-only.
 * Challenge domain: the RULING is applied and the hurt club may throw the flag
 * at the start of the next step. Nothing here draws the rng or mutates `s`/`out`.
 */
export function officiate(
  _world: World,
  s: GameState,
  out: PlayOutcome,
  _fourthChoice?: 'go' | 'fg' | 'punt' | 'fake' | null,
): Officiated {
  if (!REPLAY_REVIEW) return { applied: out, truth: out, review: null, challenge: null }
  const st: CloseState = { n: s.n, yard: s.yard, distance: s.distance, offId: s.offId, defId: s.defId }
  const call = closeCall(st, out)
  if (!call) return { applied: out, truth: out, review: null, challenge: null }
  const ruling = onFieldRuling(call.kind, st, out, call.wrong)
  const booth = inBoothWindow(s) || ruling.score || ruling.turnover || rulingSafety(st, out, call.kind, call.wrong)
  if (booth) {
    return {
      applied: out,
      truth: out,
      review: { by: 'booth', kind: call.kind, ruling: ruling.text, outcome: call.wrong ? 'reversed' : 'confirmed' },
      challenge: null,
    }
  }
  return {
    applied: call.wrong ? rulingOutcome(call.kind, st, out) : out,
    truth: out,
    review: null,
    challenge: { kind: call.kind, hurt: rulingAgainst(st, out, call.kind, call.wrong), wrong: call.wrong, ruling: ruling.text },
  }
}

// ── C2: the replay read, the standing policy and the resolution ──────────────

/**
 * The replay booth's read (0–1) that the on-field ruling was wrong. Centred on
 * `readWrong` for a mis-call and `readRight` for a correct call, with hash noise
 * that shrinks as the club's analytics rating rises. Never draws the rng.
 */
export function replayRead(world: World, teamId: string, wrong: boolean, key: string): number {
  const rating = analyticsRating(world, teamId)
  const t = Math.max(0, Math.min(1, (rating - 40) / 50))
  const noise = REVIEW.readNoiseLo + (REVIEW.readNoiseHi - REVIEW.readNoiseLo) * t
  const centre = wrong ? REVIEW.readWrong : REVIEW.readRight
  const jitter = (h01(`${key}:read`) - 0.5) * 2 * noise
  return Math.max(0.02, Math.min(0.98, centre + jitter))
}

/** The red-flag threshold for a club's call sheet (aggressive → throw sooner). */
export function challengeThreshold(sheet: CallSheet): number {
  const style = sheet.challenges ?? 'standard'
  return REVIEW.threshold[style] ?? REVIEW.threshold.standard
}

/**
 * C2: does an AI club throw the flag? Its call-sheet threshold from
 * `coachTendency`, plus a hash coin so clubs also make some wrong challenges.
 */
export function aiThrows(world: World, s: { n: number }, club: string, read: number): boolean {
  const thr = challengeThreshold(aiCallSheet(world, club))
  const coin = (h01(`${s.n}:${club}:aicoin`) - 0.5) * REVIEW.aiCoin
  return read + coin >= thr
}

/**
 * C2: resolve a thrown flag. A mis-call is reversed with probability
 * `challengeReverse`; a correct call always stands. Pure (hash only).
 */
export function resolveChallenge(pending: PendingReview, key: string): boolean {
  if (!pending.wrong) return false
  return h01(`${key}:reverse`) < REVIEW.challengeReverse
}

/** Challenges still available to a club (2 per game, +1 after two wins). */
export function challengeLeft(chal: ChallengeState): number {
  return Math.max(0, chal.left)
}

/**
 * C2: apply the outcome of one thrown flag to the club's counter. Every throw
 * consumes a challenge; a club that wins its first two is granted a third.
 */
export function spendChallenge(chal: ChallengeState, won: boolean): void {
  chal.left = Math.max(0, chal.left - 1)
  if (won) {
    chal.won += 1
    if (chal.won === 2 && chal.lost === 0) chal.left += 1
  } else {
    chal.lost += 1
  }
}

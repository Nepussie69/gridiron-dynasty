// ─────────────────────────────────────────────────────────────────────────────
// JOB realism-targets — who the QB throws to.
//
// The pre-existing target model (`playsim.ts` L12 S1, "Target selection") drew the
// target from a softmax over a per-receiver score that was dominated by a flat
// *read-step* bonus (read 1 worth ~59% of the weight on its own) plus a route /
// speed / scheme-fit blend that never saw the man covering the receiver. The
// result was an NFL-unrealistic distribution: the #1 target ate 33–58% of a
// club's targets, tight ends were over-scored (their playbook routes are the
// first read on many concepts), WR3 was starved and a back's checkdown completed
// at 55% (NFL 78.5%).
//
// This module holds the ONE shared, pure description of the target distribution:
//
//   * `targetBase(pos, rank)` — the positional / depth role prior (a back is not
//     a receiver; the WR1 is not the WR3). Both the play-by-play path
//     (`playsim.ts`) and the fast stat allocator (`statAlloc.ts`) call it, so a
//     score-only season gives the same per-position target mix as a played one.
//   * `targetQuality(pos, attrs, depth, rawOvr)` — the SPECIFIC receiver's OWN
//     quality in score units (his route-running rating for this depth, his own
//     hands, his speed on a deep route, his release on a short one), taken
//     against the position means (`POS_MEAN`) so a league-average receiver adds
//     0 and only the individual spread moves. `rawOvr` is the un-remapped
//     overall, the fallback the data's missing route ratings use.
//
// The play-by-play path adds, per candidate, the designed read step (the
// progression) and the SPECIFIC cover defender's own man/zone ability — neither
// is knowable to the season-level allocator, which is why they are applied at the
// play and not here.
//
// `setTargetDist(on)` / `getTargetDist()` follow the `setStamina` pattern.
// Default ON. With it OFF the target selection is byte-identical to the
// unmodified engine (the pre-existing softmax and its draw order are untouched).
// ─────────────────────────────────────────────────────────────────────────────

import type { Player } from '../types'
import { playerAttrs } from '../data/ratings'
import { POS_MEAN } from './ratingMeans'
import { unscaleOvr } from './ovrScale'

let TARGET_DIST_ON = true // emerjoint 2026-10-17: ON with the joint config; setTargetDist(false) is the dev toggle

/** JOB realism-targets: enable/disable the reworked target distribution. */
export function setTargetDist(on: boolean) {
  TARGET_DIST_ON = on
}
/** JOB realism-targets: read the toggle so a probe/calibration can restore it. */
export function getTargetDist(): boolean {
  return TARGET_DIST_ON
}

// ── Every constant this job adds, in one place ────────────────────────────────
export const TARGET_DIST = {
  /** Softmax temperature over the candidate scores. It only divides the score,
   *  so the role prior below stays exact; a bigger tau flattens everything else
   *  (the progression, the receiver's quality, the cover man, the jitter) and is
   *  what stops one receiver eating a third of a club's targets. Tuned: below
   *  ~50 the #1 target climbs out of the NFL band (21-26%), above ~60 the
   *  individual rating effect falls under 6 share-points. */
  tau: 54,
  /** Score lost per designed read slot past the first (the read step). Together
   *  with tau it fixes how much weight the first read carries: `readStep/tau` is
   *  the log-odds the progression gives the first read over the second. */
  readStep: 24,
  /** Positional role prior (a back or tight end is not a boundary receiver). Sized
   *  with `rankDecay` below to land the NFL share split (WR 56–64, TE 18–25,
   *  RB 15–21) and — because the completion mix sets the league's yards-per-catch —
   *  to hold gross YPA inside its band (a WR-heavy completion mix throws for more
   *  yards per catch than a TE/RB-heavy one). */
  posBase: { WR: 1.0, TE: 0.75, RB: 0.48, FB: 0.15 } as Record<string, number>,
  /** Fall of the role prior with depth rank within the position group. */
  rankDecay: 0.92,
  // ── the receiver's own quality (score units per rating point) ───────────────
  /** Route-running rating for this depth, vs `routeRef` (raw Madden scale). */
  qRouteW: 0.7,
  routeRef: 78,
  /** His own hands, centred per position. */
  qCthW: 0.25,
  /** His own speed (a deep route is won with speed; a short one less so). */
  qSpdW: 0.15,
  qSpdShort: 0.5,
  /** His own release (a short route is won with a release; a deep one less so). */
  qRlsW: 0.15,
  qRlsDeep: 0.4,
  /** Score lost per yard the SPECIFIC route a candidate runs sits beyond
   *  `depthRef` — the one term that can price a go and a checkdown apart (the
   *  pre-existing model only knew the concept depth). Left at 0: the tuning showed
   *  any positive value buys a little more TE/RB involvement at the cost of the
   *  league's air-yards-per-target, which the separate air-yards job owns. The
   *  term stays wired so that job can switch it on. */
  routeDepthW: 0,
  depthRef: 8,
  // ── the specific cover defender (his own man/zone ability + help safety) ────
  /** Score lost per rating point of the cover man's own man/zone ability. Sized
   *  against `tau`: a top-decile cover man has to move the read by ≥15% relative
   *  even with the per-snap jitter below in play, so `defW/tau` is the real knob. */
  defW: 2.8,
  /** Score lost per rating point of the helping safety's ability. */
  helpW: 1.5,
  /** Per-snap jitter from the receiver's own existing rng draw (0..1 → 0..noise). */
  noise: 20,
  // ── the checkdown (the back's outlet) ──────────────────────────────────────
  /** The pocket collapsing lifts the outlet (per unit of `pressureEdge`). */
  rbPressW: 15,
  /** `pressureEdge` is normalised by this before the pressure term. */
  pressScale: 40,
  /** An aware QB keeps working downfield instead of bailing to the back (centred). */
  rbAwrW: 2.0,
  /** A gunslinger / downfield style forces it in (centred on the style scale). */
  rbGunW: 15,
  // ── the checkdown completion (an open outlet, short air, high catch rate) ────
  /** Added to the completion probability of a checkdown the QB takes. Sized (with
   *  the clamp below) to land the NFL outlet rate (RB 74-82) and, because the
   *  checkdown's yards-per-catch is low, to lift the league completion % (which the
   *  throwaway below pulls down) with almost no YPA cost — the most yardage-effi-
   *  cient way to hold the league band. Tuned against calib: RB catch ~81. */
  chkComp: 0.30,
  /** Its own slope on the receiver's hands + route rating (centred). */
  chkCompSkillW: 0.004,
  chkCompLo: 0.55,
  chkCompHi: 0.88,
  // ── the tight end's deep throw ───────────────────────────────────────────────
  /** A tight end running a route past `teCompRef` yards gains fewer completions:
   *  the throw is into the middle of the field at speed, and the pre-existing
   *  completion model (which knows only separation and coverage) let a TE on a
   *  seam complete like a checkdown. Taken off the completion probability only for
   *  a TE target on his own deep route, so the league completion rate is barely
   *  touched. */
  teDeepCompW: 0.05,
  teCompRef: 8,
  /** The position whose league-mean cover ratings a TIGHT END's cover man is read
   *  against in the completion model. 'CB' (the value main always used) is right:
   *  an LB or safety on a TE then reads well below it, so the TE gets the mismatch
   *  completion he deserves. Reading a TE against the LB mean instead cost 0.224
   *  of completion on every TE target (TE catch 78 -> 58). */
  teCovRef: 'CB' as 'CB' | 'LB',
  // ── the throwaway (a dropback with no intended receiver) ────────────────────
  /** Fraction of dropbacks the read finds no answer on, so the QB throws the ball
   *  away. The NFL records ~31.6 targets per team-game against ~34.6 pass
   *  attempts: ~3 dropbacks a game (≈8%) have NO intended receiver. That gap is
   *  what lets the per-position catch rates sit at their NFL levels while the
   *  league completion percentage stays at 64%: on a sim that targets a man on
   *  every dropback, Σ(share×catch) must equal comp%, and the two cannot both hit
   *  their NFL bands (TE 71.8 / RB 78.5 / WR 63.3 implies ~68%, but the league
   *  band is 63.3–65.3%). Tuned with `chkComp` against calib: the pair lands
   *  completion % in band on all three seeds while keeping targets/team-game in
   *  30-35 (NFL 31.6, sim ~32.1). */
  throwAwayRate: 0.062,
  /** A collapsing pocket (per unit of `pressureEdge`) pushes him to throw it away. */
  throwAwayPressW: 0.0010,
  /** An aware QB throws it away rather than forcing it into a crowd; centred on
   *  the position mean, so the league throwaway level is unmoved. */
  throwAwayAwrW: 0.0015,
  /** Ceiling on the throwaway probability. */
  throwAwayCap: 0.17,
}

/** The depth-specific route-running rating, with the same raw-OVR fallback the
 *  pre-existing model used (Madden/CFB data carries no DRR/MRR for TE/RB). */
export function routeRatingFor(a: Record<string, number>, depth: number, raw: number): number {
  const key = depth > 14 ? 'DRR' : depth > 7 ? 'MRR' : 'SRR'
  return a[key] ?? a.SRR ?? raw
}

/** The specific receiver's own quality in score units (0 for a league-average
 *  starter at his position). Pure; no rng, no unit mean. */
export function targetQuality(pos: string | undefined, a: Record<string, number>, depth: number, raw: number): number {
  const dev = (key: string, val: number): number => {
    const m = pos ? POS_MEAN[pos]?.[key] : undefined
    return m === undefined ? 0 : val - m
  }
  const deep = depth >= 12
  const route = routeRatingFor(a, depth, raw) - TARGET_DIST.routeRef
  const spd = dev('SPD', a.SPD ?? raw)
  const cth = dev('CTH', a.CTH ?? raw)
  const rls = dev('RLS', a.RLS ?? raw)
  return TARGET_DIST.qRouteW * route
    + TARGET_DIST.qCthW * cth
    + TARGET_DIST.qSpdW * spd * (deep ? 1 : TARGET_DIST.qSpdShort)
    + TARGET_DIST.qRlsW * rls * (deep ? TARGET_DIST.qRlsDeep : 1)
}

/** The positional / depth-role prior (WR1 = 1.0). Shared by the play-by-play
 *  target model and the fast allocator. Pure. */
export function targetBase(pos: string | undefined, rank: number): number {
  const b = TARGET_DIST.posBase[pos ?? ''] ?? 0.1
  return b * Math.pow(TARGET_DIST.rankDecay, Math.max(0, rank))
}

/** The season-level expected target weight for a receiver (the fast allocator's
 *  mirror of the play-by-play softmax, ignoring the per-play read/defender terms
 *  that average out across a season). `depth` is a representative concept depth. */
export function targetSeasonWeight(p: Player, rank: number, depth: number): number {
  const a = playerAttrs(p)
  const raw = unscaleOvr(p.ovr)
  return targetBase(p.pos, rank) * Math.exp(targetQuality(p.pos, a, depth, raw) / TARGET_DIST.tau)
}

/** How much of a downfield gunslinger the QB is (0..1.5), from his own traits.
 *  The checkdown model's style leg (same shape as `vision.ts`'s private helper). */
export function qbGunStyle(qb: Player): number {
  const t = (qb.traits ?? []).join(' ').toLowerCase()
  let g = 0
  if (t.includes('cannon arm')) g += 0.6
  if (t.includes('improviser') || t.includes('gunslinger')) g += 0.5
  if ((qb.traits?.[0] ?? '').toLowerCase().includes('deep threat')) g += 0.4
  return g
}

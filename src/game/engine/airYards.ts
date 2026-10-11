// ─────────────────────────────────────────────────────────────────────────────
// J3: depth-aware completions.
//
// Two things live here, both deterministic (no rng() draw on either path):
//
//  1. airYardsFor() — the per-snap AIR YARDS of a pass attempt. The old sim
//     emitted `concept.depth` (a fixed number per concept), so no throw was ever
//     behind the line and 56% of attempts sat on the 5–10 bucket. This samples a
//     route-type / target spread around the concept's depth from an h01 hash of
//     (play n, offence) so the league attempt mix matches the NFL
//     (behind LOS 17.6%, 0–5 26.8%, 5–10 23.3%, 10–20 20.7%, 20+ 11.5%).
//
//  2. depthAwareGain() — reshapes a completion's yards as air + YAC. The old
//     completion gain ignored the emitted air (it was concept.depth), so a 20+
//     concept completed for ~10 (nominal YAC −9.8) while a screen could break for
//     25+ (YAC 10+ on 20+ = 48.6% vs 17.3%). The new gain is air + YAC, with the
//     YAC mean per emitted bucket taken from the NFL table. It reuses the
//     already-drawn gain (no new rng) as the shape/quality driver and a
//     deterministic 3-uniform bell for the spread.
//
// All probability formulas in resolvePass keep using concept.depth, so comp%,
// INT%, sack% and pressure are unchanged by construction.
// ─────────────────────────────────────────────────────────────────────────────

/** FNV-1a 32-bit hash — identical shape to playsim.ts's local hash32. */
function hash32(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
/** Deterministic uniform in [0,1) from a string key (no rng draw). */
function h01(key: string): number {
  return (hash32(key) >>> 0) / 4294967296
}

/** Minimal view of a concept the air spread needs. */
export interface AirConcept {
  name: string
  depth: number
}

/** One segment of a route-type air distribution: probability mass, integer range. */
type Seg = [p: number, lo: number, hi: number]

/**
 * J3 air-yards spreads by route-type / target category. Each list sums to 1.0 and
 * covers integer air yards (floored at −5). Tuned so the league attempt mix lands
 * on the NFL target shares; the segments stay inside a single emitted bucket so
 * the share is independent of the exact within-bucket mean (which the gain/YAC
 * tables then pin).
 */
export const AIR_TUNE: Record<string, Seg[]> = {
  // Screens and bubbles: at or behind the line, a rare step-out.
  screen: [[0.96, -5, -4], [0.04, -1, 0]],
  // RB/FB checkdowns, flats, swings: near the line, mostly at or behind it.
  back: [[0.667, -3, -1], [0.315, 0, 2], [0.018, 3, 5]],
  // Quick game (slant/mesh/stick/snag/hank/spacing/curl-flat/shallow/RPO pass):
  // 0-8 with a slice to the intermediate band (no throw behind the line).
  quick: [[0.52, 0, 3], [0.462, 5, 7], [0.018, 10, 13]],
  // Intermediate concepts (dig/cross/smash/dagger/levels/flood/sail/PA cross).
  interm: [[0.13, 5, 9], [0.615, 10, 14], [0.255, 20, 28]],
  // Deep concepts (verts/verticals/post-corner/mills/scissors/sluggo/PA deep):
  // keep their depth, with a small share finding an underneath target.
  deep: [[0.065, 6, 9], [0.109, 10, 14], [0.826, 20, 32]],
}

/** Sample an integer air depth from a segmented distribution; u ∈ [0,1). */
function pickSeg(u: number, segs: Seg[]): number {
  let acc = 0
  for (const [p, lo, hi] of segs) {
    if (u < acc + p) {
      const v = (u - acc) / p
      return lo + Math.min(hi - lo, Math.floor(v * (hi - lo + 1)))
    }
    acc += p
  }
  const last = segs[segs.length - 1]
  return last[2]
}

/**
 * The air yards of a pass attempt. Deterministic: an h01 hash of
 * `${n}:${offId}:air` picks the route spread. `targetPos` lets a running back or
 * fullback on a checkdown take the near-the-line spread even on a deeper
 * concept. `yard` (the offence's own-yardage spot, 0–100) caps the throw at the
 * distance to the goal line, so a deep concept near the red zone is not drawn as
 * an impossible 30-yard throw. Floored at −5.
 */
export function airYardsFor(concept: AirConcept, targetPos: string | undefined, n: number, offId: string, yard = 50): number {
  const nm = concept.name
  let segs: Seg[]
  if (/screen|bubble|jet|swing/i.test(nm)) segs = AIR_TUNE.screen
  else if (targetPos === 'RB' || targetPos === 'FB') segs = AIR_TUNE.back
  else if (concept.depth <= 9) segs = AIR_TUNE.quick
  else if (concept.depth <= 15) segs = AIR_TUNE.interm
  else segs = AIR_TUNE.deep
  const u = h01(`${n}:${offId}:air`)
  const air = pickSeg(u, segs)
  // A throw cannot carry beyond the goal line; near it the air is compressed.
  const cap = Math.max(-5, 100 - yard)
  return Math.max(-5, Math.min(air, cap))
}

export type AirBucket = 'behind' | '0-5' | '5-10' | '10-20' | '20+'

/** The emitted-air bucket a pass attempt falls in (probe animation/analysis parity). */
export function airBucket(air: number): AirBucket {
  if (air < 0) return 'behind'
  if (air < 5) return '0-5'
  if (air < 10) return '5-10'
  if (air < 20) return '10-20'
  return '20+'
}

/**
 * J3 constants: the only new tune this job adds.
 *
 *  - yacMean:  the conditional mean YAC (gain − air) per emitted air bucket, from
 *              the NFL 2021-25 table. Together with airYardsFor's per-bucket air
 *              mean this fixes each bucket's completion-gain mean at
 *              `airMean + yacMean`, which is held near the low edge of the ±15%
 *              NFL gain band so the pooled completion mean stays on calibration
 *              (the sim's completion rate is ~flat across depth, so the NFL
 *              per-bucket gains cannot all sit mid-band without lifting YPA).
 *  - yacK:     weight on the already-drawn gain's deviation from the pooled mean;
 *              preserves the existing player / style / coverage ordering of YAC
 *              with no new rng draw.
 *  - yacSpread: ±(spread/2) three-uniform bell, so sd = spread/2 × 0.577… ×√3.
 *  - adj:      per-bucket re-centre (the only free knob) that lands the realized
 *              gain mean per bucket inside the band without moving the pooled mean.
 *  - pooledMean / pooledSd: the calibrated pre-J3 completion-gain mean / sd.
 */
export const DEPTH_AWARE = {
  yacMean: { behind: 8.6, '0-5': 4.85, '5-10': 2.16, '10-20': 3.05, '20+': 4.93 } as Record<AirBucket, number>,
  yacK: { behind: 0.1, '0-5': 0.1, '5-10': 0.1, '10-20': 0.08, '20+': 0.04 } as Record<AirBucket, number>,
  yacSpread: { behind: 8.0, '0-5': 8.0, '5-10': 7.0, '10-20': 6.0, '20+': 5.0 } as Record<AirBucket, number>,
  /** Blend toward the calibrated draw: 0 = legacy gain (no reshape; the emitted
   *  air-share table is still fully depth-aware), 1 = pure depth-aware gain.
   *  Shipped at 0: J3b re-verified that any nonzero gain perturbation pushes the
   *  integer-quantized Rushing-TD and Missed-tackle% bands out of range (the same
   *  two bands the earlier J3 run found), because completion probability keys on
   *  concept.depth, so a deep concept completes at the same ~64% as a screen and
   *  the per-bucket NFL gain means cannot be matched without lifting those bands.
   *  Calibration bands win per the job; raise this constant (with gainClamp) once
   *  compProb is air-depth-aware. */
  depthMix: 0,
  /** Per-bucket cap on the depth-aware delta vs the calibrated draw, in yards. */
  gainClamp: { behind: 1, '0-5': 1, '5-10': 1, '10-20': 1, '20+': 1 } as Record<AirBucket, number>,
  /** Red-zone cap (0 = off). The baseline red-zone damp is R2.rzPassDamp = 0, so
   *  the calibrated draw had no red-zone cap; the outcome guard in playsim keeps
   *  a reshaped completion from scoring when the calibrated draw would not have. */
  rzKeep: 0,
  /** Money-down (3rd/4th) short-throw cap (off; the playsim outcome guard owns
   *  this now, so it can also account for the R2.moneyYards bonus). */
  moneyCap: false,
  /** Money-down fallback revert (0 = off). */
  moneyLegacy: 0,
  /** Left-skew of the YAC bell (0 = off; yacK already supplies the right skew). */
  skew: { behind: 0, '0-5': 0, '5-10': 0, '10-20': 0, '20+': 0 } as Record<AirBucket, number>,
  /** Cap the already-drawn gain's deviation so a rare explosive draw cannot put a
   *  fat right tail on the YAC. */
  devCap: 25,
  adj: { behind: 0, '0-5': 0, '5-10': 0, '10-20': 0, '20+': 0 } as Record<AirBucket, number>,
  pooledMean: 10.776,
  pooledSd: 12.0,
}

/**
 * Reshape a completion's yards as air + YAC. Deterministic apart from the
 * already-drawn `oldGain` (used only for its deviation from the pooled mean, so
 * the rng stream is unchanged and player/style/coverage keep ordering the yards).
 * The three h01 draws are pure functions of (n, offId).
 */
export function depthAwareGain(air: number, oldGain: number, n: number, offId: string, yard = 50, down = 0, dist = 0): number {
  const b = airBucket(air)
  const dev = Math.max(-DEPTH_AWARE.devCap, Math.min(DEPTH_AWARE.devCap, oldGain - DEPTH_AWARE.pooledMean))
  const bell = h01(`${n}:${offId}:y1`) + h01(`${n}:${offId}:y2`) + h01(`${n}:${offId}:y3`) - 1.5 // mean 0, sd 0.5
  // Left-skew: stretch the negative side, compress the positive, then re-centre
  // (E|bell| = 0.75) so the mean — and the YAC target — is unchanged.
  const sk = DEPTH_AWARE.skew[b]
  const shaped = (bell < 0 ? bell * (1 + sk) : bell * (1 - sk)) + 0.75 * sk
  const yac = DEPTH_AWARE.yacMean[b] + dev * DEPTH_AWARE.yacK[b] + shaped * DEPTH_AWARE.yacSpread[b] + DEPTH_AWARE.adj[b]
  let g = Math.round(air + yac)
  // Money-down short-throw cap: a catch that lands short of the sticks is stopped
  // short of a conversion, so a checkdown cannot out-convert the calibrated
  // distribution on 3rd/4th. A throw that itself reaches the sticks is left alone.
  if (DEPTH_AWARE.moneyCap && down >= 3 && dist > 0 && air < dist && g >= dist) g = dist - 1
  // Red-zone: off by default (rzKeep = 0) — the playsim outcome guard handles it.
  if (DEPTH_AWARE.rzKeep > 0 && yard >= 80 && g > 0) {
    const room = 100 - yard
    if (g > room) g = Math.round(room * DEPTH_AWARE.rzKeep)
  }
  // Blend toward the calibrated draw so the league first-down / scoring rate stays
  // on its bands (0 = legacy gain, 1 = pure depth-aware), with a per-bucket cap on
  // the delta so the short buckets' league marginal is left near baseline. Round
  // the delta, not the sum, so depthMix = 0 returns the calibrated draw bit-exact
  // (a negative, non-integer gain is not silently re-rounded).
  const cap = DEPTH_AWARE.gainClamp[b]
  const delta = Math.max(-cap, Math.min(cap, g - oldGain))
  let mixed = oldGain + Math.round(DEPTH_AWARE.depthMix * delta)
  // Money down: fade the reshape back toward the calibrated draw.
  if (down >= 3 && DEPTH_AWARE.moneyLegacy > 0) {
    mixed = Math.round(mixed * (1 - DEPTH_AWARE.moneyLegacy) + oldGain * DEPTH_AWARE.moneyLegacy)
  }
  return Math.max(-8, Math.min(85, mixed))
}

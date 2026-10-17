// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #47 — Combine & pro-day measurables.
//
// Every draft prospect gets the full testing card a real club reads in February:
// 40-yard dash, 10-yard split, 20-yard shuttle, 3-cone, vertical, broad jump,
// bench (225 lb), plus his body (height, weight, arm length). The numbers are
// the prospect's OWN: they are read off HIS ratings through a per-position
// rating→drill mapping, never a league or unit average. The reference points
// (`NFL_COMBINE`, `DRILL_CAL`) are fixed constants measured offline from the
// nflverse combine release (analysis/combine_nfl.py) and the game's own classes
// (analysis/combine_calib.mjs) — so two prospects with the same ratings produce
// the same card, and two with different ratings differ by their own ratings
// alone.
//
// Everything here is a pure function of (id, pos, ovr) — `hash32` only, never a
// world rng() draw — so prospect classes, the schedule and the play sim are
// byte-identical to before this file existed.
//
// Scouting error is NOT in these numbers: a stopwatch is a stopwatch, and every
// club sees the same 4.42. The error lives in how a department reads what the
// numbers mean — `scoutBias.ts` magnifies the prospect's own testing through
// each evaluator's blind spot, and a club's GM weighs athleticism his own way
// (see draft.ts `clubBoardOf`).
// ─────────────────────────────────────────────────────────────────────────────

import type { Position } from '../types'
import { attributesFor } from '../data/ratings'
import { clamp, hash32 } from './rng'

export type DrillKey = 'forty' | 'split10' | 'shuttle' | 'cone' | 'vertical' | 'broad' | 'bench'

export const DRILL_ORDER: DrillKey[] = ['forty', 'split10', 'shuttle', 'cone', 'vertical', 'broad', 'bench']

export interface DrillMeta {
  key: DrillKey
  label: string
  short: string
  unit: string
  /** True when a SMALLER number is better (every timed drill). */
  lowerIsBetter: boolean
  decimals: number
}

export const DRILL_META: Record<DrillKey, DrillMeta> = {
  forty: { key: 'forty', label: '40-yard dash', short: '40-yd', unit: 's', lowerIsBetter: true, decimals: 2 },
  split10: { key: 'split10', label: '10-yard split', short: '10-split', unit: 's', lowerIsBetter: true, decimals: 2 },
  shuttle: { key: 'shuttle', label: '20-yard shuttle', short: 'Shuttle', unit: 's', lowerIsBetter: true, decimals: 2 },
  cone: { key: 'cone', label: '3-cone drill', short: '3-cone', unit: 's', lowerIsBetter: true, decimals: 2 },
  vertical: { key: 'vertical', label: 'Vertical jump', short: 'Vertical', unit: 'in', lowerIsBetter: false, decimals: 1 },
  broad: { key: 'broad', label: 'Broad jump', short: 'Broad', unit: 'in', lowerIsBetter: false, decimals: 0 },
  bench: { key: 'bench', label: 'Bench press (225 lb)', short: 'Bench', unit: 'reps', lowerIsBetter: false, decimals: 0 },
}

// ── NFL truth: per-position testing distributions ────────────────────────────
// p10 / p50 / p90 measured from the nflverse combine release (2,000–2,025,
// 8,968 workouts) with analysis/combine_nfl.py. Timed drills in seconds, jumps
// in inches, bench in reps, height in inches, weight in pounds. `null` = the
// position does not run that drill (kickers never bench; punters never cone).
type Triple = [number, number, number]
interface Dist {
  forty?: Triple
  bench?: Triple
  vertical?: Triple
  broad?: Triple
  cone?: Triple
  shuttle?: Triple
  ht: Triple
  wt: Triple
}

export const NFL_COMBINE: Record<Position, Dist> = {
  QB: { forty: [4.59, 4.81, 5.04], bench: [14, 19.5, 24.1], vertical: [27, 31, 35.5], broad: [102.3, 111, 120.7], cone: [6.85, 7.13, 7.47], shuttle: [4.11, 4.33, 4.53], ht: [72, 75, 77], wt: [207, 221, 235] },
  RB: { forty: [4.4, 4.55, 4.68], bench: [14, 19, 25], vertical: [30.5, 34.5, 38.5], broad: [112, 119, 126], cone: [6.82, 7.07, 7.35], shuttle: [4.09, 4.27, 4.49], ht: [68, 71, 73], wt: [195, 213, 230] },
  FB: { forty: [4.6, 4.74, 4.97], bench: [17, 23, 30], vertical: [29, 32.5, 37.5], broad: [106.1, 113, 120], cone: [7.0, 7.27, 7.65], shuttle: [4.16, 4.37, 4.58], ht: [71, 72, 74.9], wt: [230, 245, 256] },
  WR: { forty: [4.37, 4.5, 4.63], bench: [10, 14, 20], vertical: [31.5, 35.5, 39.5], broad: [114, 121, 129], cone: [6.7, 6.97, 7.28], shuttle: [4.06, 4.22, 4.43], ht: [70, 73, 76], wt: [182, 201, 220] },
  TE: { forty: [4.58, 4.75, 4.95], bench: [15.3, 20, 26], vertical: [29, 33.5, 37.5], broad: [108.8, 116, 123], cone: [6.9, 7.15, 7.49], shuttle: [4.18, 4.37, 4.54], ht: [75, 76, 78], wt: [241, 252, 265] },
  OT: { forty: [4.99, 5.22, 5.46], bench: [19, 24, 31], vertical: [24.5, 28.5, 32.5], broad: [95, 104, 112.4], cone: [7.44, 7.84, 8.27], shuttle: [4.52, 4.74, 5.0], ht: [76, 78, 79], wt: [302, 313, 332] },
  OG: { forty: [5.05, 5.28, 5.51], bench: [19, 25, 32.8], vertical: [23.5, 28, 32], broad: [92, 102, 110], cone: [7.5, 7.87, 8.34], shuttle: [4.51, 4.78, 5.03], ht: [75, 76, 78], wt: [301, 313, 330] },
  C: { forty: [4.99, 5.22, 5.43], bench: [20, 26, 33], vertical: [24.5, 28.5, 32.5], broad: [95, 103, 111], cone: [7.39, 7.66, 8.09], shuttle: [4.44, 4.63, 4.84], ht: [74, 75, 77], wt: [295.8, 303, 312.2] },
  DE: { forty: [4.6, 4.79, 5.0], bench: [18, 24, 30], vertical: [29, 33, 38], broad: [108, 116, 125], cone: [6.97, 7.27, 7.65], shuttle: [4.21, 4.41, 4.66], ht: [74, 76, 78], wt: [248, 264.5, 283.3] },
  DT: { forty: [4.88, 5.08, 5.31], bench: [21, 27, 34], vertical: [25.5, 29.5, 33.35], broad: [98, 106, 113], cone: [7.33, 7.69, 8.07], shuttle: [4.41, 4.65, 4.87], ht: [73, 75, 77], wt: [289.9, 306, 327.1] },
  LB: { forty: [4.53, 4.68, 4.87], bench: [16, 22, 27], vertical: [30.5, 34, 39], broad: [110, 117, 125], cone: [6.88, 7.14, 7.43], shuttle: [4.1, 4.3, 4.5], ht: [72, 74, 75], wt: [227.2, 238, 251] },
  CB: { forty: [4.37, 4.49, 4.61], bench: [10, 15, 19], vertical: [32.5, 36, 40], broad: [116, 122, 130], cone: [6.69, 6.94, 7.21], shuttle: [3.97, 4.17, 4.35], ht: [69, 71, 74], wt: [181.5, 192, 204] },
  S: { forty: [4.42, 4.56, 4.67], bench: [12, 17, 22], vertical: [32, 35.5, 39.5], broad: [114, 121, 128.9], cone: [6.72, 7.01, 7.28], shuttle: [4.03, 4.2, 4.4], ht: [70, 72, 74], wt: [194.6, 206, 219] },
  K: { forty: [4.74, 4.92, 5.1], ht: [69, 72, 74], wt: [177, 193, 218] },
  P: { forty: [4.7, 4.89, 5.12], bench: [8.3, 15, 23], vertical: [27.95, 32.25, 34], broad: [109, 114, 119.9], ht: [71.4, 74, 76], wt: [194.4, 212, 234] },
}

/**
 * Arm length is the one measurement the nflverse release does not carry (PFR's
 * combine pages publish it; there is no bulk feed). We model it from the man's
 * own frame: his height (the dominant real predictor, r ≈ 0.6) around a
 * position's published median arm. Medians are the PFR-typical values.
 */
export const ARM_MEDIAN: Record<Position, number> = {
  QB: 32.3, RB: 30.9, FB: 31.9, WR: 31.7, TE: 33.1, OT: 34.3, OG: 33.7, C: 33.0,
  DE: 33.6, DT: 33.3, LB: 32.6, CB: 31.0, S: 31.6, K: 30.8, P: 31.4,
}

/** Inches of arm per inch of height above the position's median height. */
const ARM_PER_HEIGHT = 0.55

// ── Rating → drill mapping ───────────────────────────────────────────────────
// Each drill reads the prospect's OWN physical ratings, weighted. A key he does
// not carry is dropped and the weights renormalised; a key his position never
// carries falls back down a chain (`FALLBACK`) so an offensive lineman's 40 is
// read off his agility (he has no SPD), and a nose tackle's vertical off his
// get-off. Nothing is read from a unit or league average.
const BLEND: Record<DrillKey, [string, number][]> = {
  forty: [['SPD', 0.72], ['ACC', 0.2], ['AGI', 0.08]],
  split10: [['ACC', 0.55], ['SPD', 0.3], ['AGI', 0.15]],
  shuttle: [['AGI', 0.5], ['ACC', 0.25], ['COD', 0.25]],
  cone: [['AGI', 0.45], ['COD', 0.4], ['ACC', 0.15]],
  vertical: [['JMP', 0.8], ['SPD', 0.1], ['STR', 0.1]],
  broad: [['JMP', 0.6], ['SPD', 0.25], ['STR', 0.15]],
  // Bench press is his own strength ON a frame of his own size: 'MASS' is the
  // mass-equivalent rating (see `massRating`), not a league average.
  bench: [['STR', 0.75], ['MASS', 0.25]],
}

/** When a position carries none of a drill's keys, read the drill off these. */
const FALLBACK: Record<string, string[]> = {
  SPD: ['ACC', 'AGI', 'COD'],
  ACC: ['SPD', 'AGI'],
  AGI: ['ACC', 'COD'],
  COD: ['AGI', 'ACC'],
  JMP: ['AGI', 'STR'],
  STR: ['IMP', 'RBK'],
}

const PHYS_KEYS = ['SPD', 'ACC', 'AGI', 'COD', 'JMP', 'STR'] as const

/**
 * Each position's drill composite at the p10/p50/p90 of the prospect pool, on
 * the 0–99 rating scale, measured once offline (analysis/combine_calib.mjs) over
 * the men who actually take the drill, in real-data and generated classes at the
 * shapes the game produces. Mapping the man's own composite through these three
 * points is what lands the class's drill distribution on the NFL p10/p50/p90
 * above; the individual number still comes from his own ratings alone. K/P/FB
 * carry no athletic ratings, so their composite is null and the drill is drawn
 * from the man's own id factor.
 */
export type DrillCal = Record<Position, Partial<Record<DrillKey, [number, number, number]>>>

const blankCal = (over: DrillCal): DrillCal =>
  Object.assign(
    { QB: {}, RB: {}, FB: {}, WR: {}, TE: {}, OT: {}, OG: {}, C: {}, DE: {}, DT: {}, LB: {}, CB: {}, S: {}, K: {}, P: {} },
    over,
  )

/**
 * The one calibration: each position's drill composite at the p10/p50/p90 of the
 * prospect pool, on the 0–99 rating scale, measured once offline
 * (analysis/combine_calib.mjs) over every class the game builds — the season-1
 * real-data class and the rollover-generated classes at their production shape —
 * restricted to the men who actually take the drill. Mapping each man's own
 * composite through these three points is what lands the class's drill
 * distribution on the NFL p10/p50/p90 above. One monotone curve for the whole
 * class, so the 40 still tracks the man's own SPD across every pool.
 */
export const DRILL_CAL: DrillCal = blankCal({
  QB: { forty:[63.36, 69.52, 94], split10:[64.025, 69.6, 95.3], shuttle:[63.5, 69.25, 95], cone:[63.15, 69.65, 94.25], vertical:[63.3, 69.6, 94.3], broad:[63.65, 69.35, 93.95], bench:[66.02, 71.892, 95.823] },
  RB: { forty:[63.84, 69.9, 95.96], split10:[64.15, 69.725, 95.85], shuttle:[64.25, 69.5, 95], cone:[64.425, 70.15, 95.7], vertical:[63.4, 70.1, 94.69], broad:[63.75, 69.55, 94.2], bench:[65.943, 73.373, 95.245] },
  FB: {  },
  WR: { forty:[63.6, 68.8, 95.44], split10:[64.05, 68.6, 95.45], shuttle:[64.325, 68.75, 94.5], cone:[64.12, 68.4, 92.05], vertical:[63.7, 69.2, 93.8], broad:[64.15, 69.025, 94.55], bench:[65.538, 71.299, 93.7] },
  TE: { forty:[63.712, 69.76, 95.64], split10:[63.95, 69.1, 96.9], shuttle:[63.75, 69, 96.75], cone:[63.15, 69.675, 97.95], vertical:[63.3, 69.3, 97.6], broad:[63.81, 69.25, 96.6], bench:[65.889, 72.25, 96.226] },
  OT: { forty:[62, 69, 95], split10:[62, 69, 97], shuttle:[62, 69, 95], cone:[62, 70, 97], vertical:[62.7, 69.2, 97], broad:[62.745, 69.25, 95.515], bench:[65.508, 70.888, 94.624] },
  OG: { forty:[63, 70, 98], split10:[63, 70, 96], shuttle:[63, 70, 96], cone:[63, 70, 94.2], vertical:[63.1, 69.5, 95.8], broad:[63.76, 69.75, 97.995], bench:[65.658, 72.313, 95.761] },
  C: { forty:[63, 70, 97], split10:[63, 70, 97], shuttle:[63.6, 70, 98], cone:[63, 70, 95], vertical:[63.8, 69.7, 95.5], broad:[63.85, 69.775, 95.25], bench:[65.607, 72.611, 91.868] },
  DE: { forty:[63.484, 69.2, 96.36], split10:[64.15, 69.2, 95.6], shuttle:[63.5, 69.5, 94.5], cone:[63, 69.85, 95.1], vertical:[63.2, 68.7, 95], broad:[63.65, 69.15, 94.45], bench:[65.861, 71.448, 94.464] },
  DT: { forty:[63.272, 68.56, 93.92], split10:[63.9, 68.45, 94.45], shuttle:[63, 68.25, 94], cone:[62.75, 69.125, 97.225], vertical:[62.8, 68.6, 96.8], broad:[63.45, 68.55, 95.5], bench:[65.719, 71.554, 93.588] },
  LB: { forty:[63.72, 69.2, 95.176], split10:[64, 68.9, 95.63], shuttle:[63.75, 68.5, 97], cone:[63.3, 68.95, 96.7], vertical:[63.2, 68.6, 96.7], broad:[63.76, 68.9, 96], bench:[65.525, 71.323, 94.241] },
  CB: { forty:[63.32, 69.16, 95.28], split10:[64.155, 69.15, 94.65], shuttle:[64.15, 69, 94.75], cone:[64.09, 69.55, 94.8], vertical:[63.3, 69.2, 95], broad:[63.7, 69.1, 94.4], bench:[65.764, 71.646, 93.692] },
  S: { forty:[63.484, 69.6, 96.12], split10:[64, 69.75, 95.835], shuttle:[63.575, 69.5, 96], cone:[63.2, 70.375, 96.725], vertical:[63.4, 69.8, 95.7], broad:[63.9, 69.8, 95.15], bench:[65.391, 71.752, 96.563] },
  K: {  },
  P: {  },
})


/** How often a prospect passes on a drill (real combine participation rates). */
const SKIP_CHANCE: Record<DrillKey, number> = {
  forty: 7, split10: 9, shuttle: 30, cone: 30, vertical: 8, broad: 10, bench: 30,
}

/** Roughly one prospect in eight was never invited and only held a pro day. */
function isProDay(id: string): boolean {
  return hash32(id, 53) % 100 < 12
}

/** Did he take this drill? Pure and public so the offline calibration measures
 *  the exact same men the game reports. */
export function testsDrill(id: string, drill: DrillKey): boolean {
  const idx = DRILL_ORDER.indexOf(drill)
  const proDay = isProDay(id)
  if (proDay && (drill === 'bench' || drill === 'cone' || drill === 'shuttle')) return false
  return hash32(id, 59 + idx * 7) % 100 >= SKIP_CHANCE[drill] + (proDay ? 30 : 0)
}

/** A ~unit-sd individual factor in (-3, 3) from three hashes of his own id. */
function hashZ(id: string, salt: number): number {
  const a = hash32(id, salt) / 4294967296
  const b = hash32(id, salt + 101) / 4294967296
  const c = hash32(id, salt + 211) / 4294967296
  return (a + b + c - 1.5) * 2
}

/** A prospect's own physical rating for a key, or undefined if he has none. */
function physKey(attrs: Record<string, number>, key: string): number | undefined {
  const own = attrs[key]
  if (own !== undefined) return own
  const chain = FALLBACK[key]
  if (chain) {
    for (const alt of chain) {
      const v = attrs[alt]
      if (v !== undefined) return v
    }
  }
  return undefined
}

/**
 * One drill's raw composite on the rating scale, or null when he has no keys.
 * `mass` is the man's mass-equivalent rating, used by the bench blend.
 */
function drillComposite(
  attrs: Record<string, number>,
  drill: DrillKey,
  mass?: number,
): number | null {
  // Bench reads the man's strength on his own frame. A position with no
  // strength rating at all (kicker, punter) has nothing to read, so it takes the
  // same id-factor path as its other untestable drills rather than a body-only
  // composite.
  if (drill === 'bench' && physKey(attrs, 'STR') === undefined) return null
  let sum = 0
  let w = 0
  for (const [key, ww] of BLEND[drill]) {
    const v = key === 'MASS' ? mass : physKey(attrs, key)
    if (v === undefined) continue
    sum += v * ww
    w += ww
  }
  if (w <= 0) return null
  return sum / w
}

/** His own strength rating (falls back to his position's power keys). */
function strRating(attrs: Record<string, number>): number | undefined {
  return physKey(attrs, 'STR')
}

/** Standard deviation of the real distribution from its p10/p90. */
function distSd(t: Triple): number {
  return (t[2] - t[0]) / 2.5631
}

/** His strength z-score, centred on the rating scale's own centre (85 ± 9). */
function strZOf(attrs: Record<string, number>): number {
  const s = strRating(attrs)
  return s == null ? 0 : clamp((s - 85) / 9, -2.5, 2.5)
}

/**
 * The man's own frame factor: his strength z plus his individual size factor.
 * Drives both his weight and his mass-equivalent rating, so the bench blend and
 * his listed weight tell the same story about his own body.
 */
function frameZ(id: string, attrs: Record<string, number>): number {
  return clamp(0.5 * strZOf(attrs) + 0.7 * hashZ(id, 31), -2.8, 2.8)
}

/** His mass expressed on the rating scale (used by the bench blend). */
function massRating(id: string, attrs: Record<string, number>): number {
  return 85 + 9 * clamp(frameZ(id, attrs), -2.5, 2.5)
}

export interface Measurables {
  heightIn: number
  weightLb: number
  armIn: number
  /** Round-1 measurements he actually took (drills he skipped are absent). */
  tested: Partial<Record<DrillKey, number>>
  /** The drills with no number (skipped or never invited). */
  missed: DrillKey[]
  /** True when he had no combine invite and only worked out at his pro day. */
  proDay: boolean
}

/** A drill's real p50 for a position, or null when the position never runs it. */
function baseTriple(pos: Position, drill: DrillKey): Triple | null {
  const d = NFL_COMBINE[pos]
  const t = (d as unknown as Record<string, Triple | undefined>)[drill]
  return t ?? null
}

/**
 * TRUE measurables for a prospect, from his own ratings + size. Pure: hash32
 * only. `prospect` needs only his stable id, position and college overall.
 */
export function measurablesOf(prospect: { id: string; pos: Position; ovr: number; generated?: boolean }): Measurables {
  const { id, pos } = prospect
  const attrs = attributesFor(id, pos, prospect.ovr)
  const dist = NFL_COMBINE[pos]
  

  // ── frame: height and weight from the man's own frame factor + strength ──
  const sz = strZOf(attrs)
  const body = {
    heightIn: Math.round(dist.ht[1] + distSd(dist.ht) * clamp(0.75 * hashZ(id, 37) + 0.25 * sz, -2.8, 2.8)),
    weightLb: Math.round(dist.wt[1] + distSd(dist.wt) * frameZ(id, attrs)),
  }
  // His mass on the same 0–99 scale as the ratings, so the bench blend reads his
  // own frame rather than a league average.
  const mass = massRating(id, attrs)
  const armIn =
    Math.round((ARM_MEDIAN[pos] + ARM_PER_HEIGHT * (body.heightIn - dist.ht[1]) + 0.9 * hashZ(id, 43)) * 10) / 10

  // ── participation: some skip a drill, a few were never invited ──
  const proDay = isProDay(id)
  const tested: Partial<Record<DrillKey, number>> = {}
  const missed: DrillKey[] = []
  for (const drill of DRILL_ORDER) {
    const base = baseTriple(pos, drill)
    if (!base) {
      missed.push(drill)
      continue
    }
    const idx = DRILL_ORDER.indexOf(drill)
    if (!testsDrill(id, drill)) {
      missed.push(drill)
      continue
    }
    const meta = DRILL_META[drill]
    const dir = meta.lowerIsBetter ? -1 : 1
    const comp = drillComposite(attrs, drill, mass)
    const cal = DRILL_CAL[pos]?.[drill]
    let v: number
    if (comp != null && cal) {
      // The one monotone map: his composite at the pool's p10/p50/p90 lands on
      // the position's real p10/p50/p90, and anything else interpolates on the
      // segment it sits in. Because the map is monotone and shared by the whole
      // class, the drill distribution lands on the NFL quantiles AND the 40 still
      // tracks the man's own SPD across every pool (real or generated).
      const [c10, c50, c90] = cal
      let f: number
      if (comp <= c50) f = 0.5 * ((comp - c10) / Math.max(1e-6, c50 - c10))
      else f = 0.5 + 0.5 * ((comp - c50) / Math.max(1e-6, c90 - c50))
      f = clamp(f, -0.9, 2.0)
      v = f <= 0.5
        ? base[0] + (f / 0.5) * (base[1] - base[0])
        : base[1] + ((f - 0.5) / 0.5) * (base[2] - base[1])
      // His own individual-day noise, in the drill's OWN units — a modest share of
      // the position's real p10-p90 band. Adding it in rating space instead would
      // blow the position's p90 out wherever the pool is tightly bunched (an
      // interior lineman's shuttle), so the band the anchors set is the band the
      // class shows. It is still his own: a hash of his id, never a class average.
      v += 0.14 * ((base[2] - base[0]) / 2.5631) * hashZ(id, 83 + idx * 5)
    } else {
      // No athletic rating to read (kicker, punter, fullback): the man's own id
      // factor, on the same real distribution.
      const z = clamp(hashZ(id, 71 + idx * 3) + 0.18 * hashZ(id, 83 + idx * 5), -3.4, 3.4)
      v = base[1] + dir * distSd(base) * z
    }
    if (drill === 'bench') {
      // His own mass is already inside the blend for this drill.
      v = Math.round(clamp(v, 0, 45))
    } else if (drill === 'vertical' || drill === 'broad') {
      v = Math.round(v * 2) / 2
    } else {
      v = Math.round(v * 100) / 100
    }
    tested[drill] = v
  }
  // The 10-yard split is only reported alongside a 40.
  if (tested.forty == null && tested.split10 != null) {
    delete tested.split10
    if (!missed.includes('split10')) missed.push('split10')
  }
  return { heightIn: body.heightIn, weightLb: body.weightLb, armIn, tested, missed, proDay }
}

/** Format a measured value for the UI (e.g. 4.42 s, 36.5 in, 225 lb). */
export function formatMeasure(drill: DrillKey, v: number): string {
  const m = DRILL_META[drill]
  return v.toFixed(m.decimals)
}

/** Format a height in inches as feet and inches (`6' 2"`). */
export function formatHeight(inches: number): string {
  const ft = Math.floor(inches / 12)
  const inch = inches - ft * 12
  return `${ft}' ${inch}"`
}

/**
 * Where one measurement sits for his position, 0–100 (higher = better athlete).
 * Read off the real p10/p50/p90 as a normal curve: p50 = the 50th percentile.
 */
export function measurePercentile(pos: Position, drill: DrillKey, value: number): number {
  const t = baseTriple(pos, drill)
  if (!t) return 50
  const sd = distSd(t)
  const z = (value - t[1]) / sd
  const pct = normCdf(DRILL_META[drill].lowerIsBetter ? -z : z) * 100
  return Math.round(clamp(pct, 1, 99))
}

/** A composite athletic percentile (0–100) across every drill he tested. */
export function athleticPercentile(pos: Position, m: Measurables): number {
  const pcts: number[] = []
  for (const d of DRILL_ORDER) {
    const v = m.tested[d]
    if (v == null) continue
    pcts.push(measurePercentile(pos, d, v))
  }
  if (!pcts.length) return 50
  return Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)
}

/**
 * Where his own frame sits for his position, 0–100 (higher = bigger). Height and
 * weight are read off the position's real distributions; the two are averaged on
 * the z scale, so a tall light man and a short heavy man both read mid-frame.
 */
export function framePercentile(pos: Position, m: Measurables): number {
  const d = NFL_COMBINE[pos]
  const hz = (m.heightIn - d.ht[1]) / distSd(d.ht)
  const wz = (m.weightLb - d.wt[1]) / distSd(d.wt)
  return Math.round(clamp(normCdf((hz + wz) / Math.SQRT2) * 100, 1, 99))
}

/** Elite = the top 5% of the class, read off his own composite percentile. */
export const ELITE_PCT = 95



function normCdf(z: number): number {
  // Abramowitz–Stegun 7.1.26, plenty for a percentile read.
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  if (z > 0) p = 1 - p
  return p
}

/** The prospect's own physical ratings, for the probe. */
export function physicalRatings(prospect: { id: string; pos: Position; ovr: number }): Record<string, number> {
  const attrs = attributesFor(prospect.id, prospect.pos, prospect.ovr)
  const out: Record<string, number> = {}
  for (const k of PHYS_KEYS) {
    const v = physKey(attrs, k)
    if (v !== undefined) out[k] = v
  }
  return out
}

/** The raw drill composite (for the offline calibration script only). */
export function drillCompositeOf(prospect: { id: string; pos: Position; ovr: number }, drill: DrillKey): number | null {
  const attrs = attributesFor(prospect.id, prospect.pos, prospect.ovr)
  return drillComposite(attrs, drill, massRating(prospect.id, attrs))
}

// ── Memo ─────────────────────────────────────────────────────────────────────
// A draft asks one club board ~200 times against a ~400-man class, and 32 clubs
// against the same class, so the same prospect's card is read tens of thousands
// of times. `measurablesOf` is pure, so the card is cached per id. This changes
// no number — the values returned are identical, only computed once.

const CARD_CACHE = new Map<string, Measurables>()

function cardKey(prospect: { id: string; pos: Position; ovr: number; generated?: boolean }): string {
  return `${prospect.id}|${prospect.pos}|${prospect.ovr}|${prospect.generated === false ? 'r' : 'g'}`
}

/** Memoised `measurablesOf` — the same card for the same man, computed once. */
export function measurablesCached(prospect: { id: string; pos: Position; ovr: number; generated?: boolean }): Measurables {
  const key = cardKey(prospect)
  const hit = CARD_CACHE.get(key)
  if (hit) return hit
  const card = measurablesOf(prospect)
  if (CARD_CACHE.size > 20000) CARD_CACHE.clear()
  CARD_CACHE.set(key, card)
  return card
}

/** Memoised composite athletic percentile (0–100) for a prospect record. */
export function athleticPercentileOf(p: { id: string; pos: Position; ovr: number; generated?: boolean }): number {
  return athleticPercentile(p.pos, measurablesCached(p))
}

/** Memoised percentile of one drill for a prospect record (50 when untested). */
export function drillPercentileOf(
  p: { id: string; pos: Position; ovr: number; generated?: boolean },
  drill: DrillKey,
): number {
  const v = measurablesCached(p).tested[drill]
  return v == null ? 50 : measurePercentile(p.pos, drill, v)
}



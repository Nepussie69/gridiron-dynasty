// ─────────────────────────────────────────────────────────────────────────────
// L12.15 S1 — "Stars are rare": the OVR remap.
//
// The real-data (Madden 26) league had 82 players at 90+ and 7 at 99: too many
// franchise faces. This module maps the *real-data OVR quantiles* onto a target
// distribution (the bands below) with a monotonic piecewise-linear curve, so the
// same order is kept (Allen stays above Burrow) but the top of the scale is
// compressed. Only `ovr`/`pot` are remapped — a player's `attrs` (what the sim
// reads) are untouched.
//
// `rescaleOvr(ovr, frac)` is the forward map. Ties in the source data are spread
// deterministically by `frac` (the player's position within his OVR group), so
// the seven players tied at 99 land across the top bands instead of all at once.
// `unscaleOvr` is the inverse used by OVR-priced systems (contracts, trade
// values) so the same rank keeps the same money/value after the remap.
// ─────────────────────────────────────────────────────────────────────────────

/** Size of the reference league the bands were calibrated against (Madden 26). */
export const OVR_SCALE_N = 1833

/** Target whole-league counts. `hi`/`lo` are inclusive new-OVR bounds. */
export const OVR_BANDS = [
  { lo: 97, hi: 99, target: 3 },
  { lo: 93, hi: 96, target: 10 },
  { lo: 90, hi: 92, target: 15 },
  { lo: 85, hi: 89, target: 80 },
  { lo: 80, hi: 84, target: 180 },
  { lo: 70, hi: 79, target: 700 },
  { lo: 60, hi: 69, target: 700 },
  { lo: 0, hi: 59, target: 145 },
]

/** Cumulative-quantile → new-OVR breakpoints (q is the fraction from the top). */
const BP: [number, number][] = [
  [0.0, 99.5],
  // L12.15 S4: the top bands sit at the *upper* edge of the accepted ranges
  // (4 / 12 / 18) rather than the mid target (3 / 10 / 15). The opening real-data
  // cohort is old (19 of its 28 stars are 28–33), so a small extra buffer is the
  // only way the 90+ count holds ≥ 25 through the season-3–5 hand-off instead of
  // dipping, without inflating the long-run population.
  [0.002182, 96.5],
  [0.00873, 92.5],
  [0.01855, 89.5],
  [0.058919804, 84.5],
  [0.157119476, 79.5],
  [0.539007092, 69.5],
  [0.920894708, 59.5],
  [1.0, 52],
]

/** [oldOvr, count, playersAbove] from the Madden 26 overall histogram. */
const GROUPS: [number, number, number][] = [
  [53, 2, 1831], [54, 4, 1827], [56, 1, 1826], [57, 2, 1824], [58, 3, 1821],
  [59, 10, 1811], [60, 7, 1804], [61, 25, 1779], [62, 37, 1742], [63, 56, 1686],
  [64, 62, 1624], [65, 68, 1556], [66, 82, 1474], [67, 70, 1404], [68, 81, 1323],
  [69, 106, 1217], [70, 96, 1121], [71, 101, 1020], [72, 82, 938], [73, 110, 828],
  [74, 99, 729], [75, 96, 633], [76, 80, 553], [77, 66, 487], [78, 60, 427],
  [79, 59, 368], [80, 49, 319], [81, 34, 285], [82, 38, 247], [83, 35, 212],
  [84, 28, 184], [85, 29, 155], [86, 24, 131], [87, 19, 112], [88, 21, 91],
  [89, 9, 82], [90, 11, 71], [91, 10, 61], [92, 9, 52], [93, 11, 41],
  [94, 10, 31], [95, 9, 22], [96, 6, 16], [97, 6, 10], [98, 3, 7], [99, 7, 0],
]

const N = OVR_SCALE_N

function targetNew(q: number): number {
  if (q <= 0) return BP[0][1]
  for (let i = 1; i < BP.length; i++) {
    const [q0, v0] = BP[i - 1]
    const [q1, v1] = BP[i]
    if (q <= q1) return v0 + ((v1 - v0) * (q - q0)) / (q1 - q0)
  }
  return BP[BP.length - 1][1]
}

const GROUP = new Map<number, { c: number; b: number }>()
for (const [v, c, b] of GROUPS) GROUP.set(v, { c, b })

/** Midpoint new OVR per integer, interpolated where no real player sits. */
const PURE: number[] = (() => {
  const present = GROUPS.map(([v, c, b]) => ({ v, mid: Math.min(99, Math.round(targetNew((b + c / 2) / N))) }))
  const out: number[] = []
  for (let v = 0; v <= 99; v++) {
    let pi = present.findIndex((p) => p.v === v)
    if (pi >= 0) { out[v] = present[pi].mid; continue }
    // Interpolate between the nearest real groups on either side.
    pi = present.findIndex((p) => p.v > v)
    const hi = present[pi < 0 ? present.length - 1 : pi]
    const lo = present[pi <= 0 ? 0 : pi - 1]
    out[v] = lo.v === hi.v ? lo.mid : Math.round(lo.mid + ((hi.mid - lo.mid) * (v - lo.v)) / (hi.v - lo.v))
  }
  return out
})()

/**
 * Inverse of the rank-ordered forward map: the old-scale OVR a new-scale rating
 * corresponds to. Used by OVR-priced systems so "same rank → same money".
 */
const RAW: number[] = (() => {
  const sum = new Array<number>(100).fill(0)
  const cnt = new Array<number>(100).fill(0)
  for (const [v, c, b] of GROUPS) {
    for (let k = 0; k < c; k++) {
      const n = Math.min(99, Math.round(targetNew((b + k + 0.5) / N)))
      sum[n] += v
      cnt[n] += 1
    }
  }
  const out = new Array<number>(100).fill(0)
  for (let n = 0; n <= 99; n++) out[n] = cnt[n] ? sum[n] / cnt[n] : -1
  // Fill any hole with the nearest defined neighbour.
  for (let n = 98; n >= 0; n--) if (out[n] < 0) out[n] = out[n + 1]
  for (let n = 1; n <= 99; n++) if (out[n] < 0) out[n] = out[n - 1]
  return out
})()

/**
 * Map a real-data OVR onto the target scale. `frac` is the position within the
 * player's OVR tie-group (0 = first, 1 = last); the default 0.5 is the group
 * midpoint, used for generated players and one-time migrations.
 */
export function rescaleOvr(ovr: number, frac = 0.5): number {
  const v = Math.max(0, Math.min(99, Math.round(ovr)))
  const g = GROUP.get(v)
  if (g) return Math.min(99, Math.round(targetNew((g.b + frac * g.c) / N)))
  return PURE[v]
}

/** Map a global quantile (0 = best player in the league) to a new OVR. */
export function rescaleQuantile(q: number): number {
  return Math.min(99, Math.round(targetNew(Math.max(0, Math.min(0.999999, q)))))
}

/** Inverse map: the old-scale OVR equivalent of a (possibly fractional) new OVR. */
export function unscaleOvr(newOvr: number): number {
  const n = Math.max(0, Math.min(99, newOvr))
  const lo = Math.floor(n)
  const hi = Math.ceil(n)
  if (lo === hi) return RAW[lo]
  return RAW[lo] + (RAW[hi] - RAW[lo]) * (n - lo)
}

/** The band a new-scale OVR falls into, for probes and UI. */
export function ovrBand(ovr: number): { lo: number; hi: number; target: number } | undefined {
  return OVR_BANDS.find((b) => ovr >= b.lo && ovr <= b.hi)
}

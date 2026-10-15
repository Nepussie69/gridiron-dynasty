// ─────────────────────────────────────────────────────────────────────────────
// Ratings → pace. FUTURES #54 P0: moved verbatim out of components so the engine
// and the animation share ONE speed function (`paceFor`) and one fatigue curve
// (`fatiguePace`). Everything below is pure arithmetic over a player's effective
// ratings (the ratings the sim itself resolved) — no DOM, no rng.
//
// `src/components/playAnim.ts` imports `paceFor`/`attrOf`/`Pace` from here (and
// re-exports them for the probes); `src/components/animRatings.ts` re-exports
// `effAttrs`/`fatiguePace`/`tiredness` so its importers are untouched.
// ─────────────────────────────────────────────────────────────────────────────

import { playerAttrs } from '../data/ratings'
import type { Player } from '../types'

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// ── effective ratings (moved from components/animRatings.ts) ─────────────────
// The animation and the engine read the SAME effective ratings the sim resolved.
// `playsim.ts` reads every rating through `mkAttrs` = `playerAttrs(p)` (generated
// attributes for the position, then the real ratings the player carries, then L15
// development-plan gains), so the broadcast reads them here through the same
// function instead of the raw `p.attrs`. Cached per player object (the merge
// allocates; the callers read a rating many times per play). Read-only.

interface Entry { ovr: number; attrs: unknown; dev: unknown; out: Record<string, number> }
const CACHE = new WeakMap<object, Entry>()

/** The sim's effective ratings for a player (generated + real + dev-plan gains). */
export function effAttrs(p: Player): Record<string, number> {
  const dev = (p as { devRatings?: Record<string, number> }).devRatings
  const hit = CACHE.get(p)
  if (hit && hit.ovr === p.ovr && hit.attrs === p.attrs && hit.dev === dev) return hit.out
  const out = playerAttrs(p)
  CACHE.set(p, { ovr: p.ovr, attrs: p.attrs, dev, out })
  return out
}

// ── ratings → pace ───────────────────────────────────────────────────────────
/** Read an attribute, falling back to overall (league average when no player). */
export function attrOf(p: Player | undefined, key: string, fallback = 70): number {
  if (!p) return fallback
  // animflow r6b: the sim's effective rating (playerAttrs), not the raw attrs.
  const v = effAttrs(p)[key]
  if (typeof v === 'number') return v
  return typeof p.ovr === 'number' ? p.ovr : fallback
}

export interface Pace {
  /** Top speed in yards per second. */
  top: number
  /** Acceleration in yards per second squared. */
  acc: number
}

/**
 * animflow r6a: real acceleration caps (yd/s²), the BDB p95 of speed gain per
 * position with the game harness's own definition (positions smoothed over
 * 0.3 s, d(speed)/dt over 0.2 s, > 0.5): BDB 2021 wk1-3 (2018 pass plays)
 * WR/TE 6.03 (n 269k), RB 5.31, DB 4.56, LB 5.22, QB 4.16; BDB 2023 wk1-2 OL
 * 3.58 (n 164k), DL 4.82. (Round 5's "NFL" caps came from a different, heavily
 * smoothed definition and were ~1.5x too low.)
 */
const ACC_CAP: Record<string, number> = {
  OL: 3.6, K: 3.4, P: 3.4, QB: 4.2, RB: 5.3, FB: 5.0, WR: 6.0, SLOT: 6.0, TE: 5.4, DL: 4.8, LB: 5.2, CB: 4.6, S: 4.6,
}
const ACC_CAP_K = 1
// animflow r8: NFL tracking play-max bands (yd/s): WR / CB ~8-9.5 (the fastest ~10), RB ~9-9.8,
// S ~8.5-9.5, LB / TE ~7.5-9, DL ~7-8.5, OL ~5.5-6.8.
const ROLE_CAP: Record<string, number> = {
  OL: 6.8, K: 7.0, P: 7.0, QB: 9.4, RB: 9.9, FB: 8.2,
  WR: 10.2, SLOT: 10.2, TE: 9.0, DL: 8.6, LB: 9.2, CB: 10.0, S: 9.8,
}

/**
 * Top speed from SPD (`5.6 + (SPD − 60) × 0.085`: 99 ≈ 8.9, 70 ≈ 6.5) and
 * acceleration from ACC (0.45 s to top at 99 … 1.1 s at 60).
 */
export function paceFor(p: Player | undefined, role = ''): Pace {
  const spd = attrOf(p, 'SPD')
  const acc = attrOf(p, 'ACC')
  const cap = ROLE_CAP[role] ?? 9.6
  // animflow r8: 6.6 + (SPD - 60) x 0.088: 99 ~ 10.0, 90 ~ 9.2, 80 ~ 8.4, 70 ~ 7.5 yd/s (was 5.6 + ...
  // x 0.085: a 70-speed man topped out at 6.5 yd/s, 13 mph - a jog for an NFL skill player).
  const top = clampN(6.6 + (spd - 60) * 0.088, 3.4, cap)
  const ramp = clampN(1.1 - (acc - 60) * (0.65 / 39), 0.45, 1.1)
  // animflow r5: real acceleration caps (NFL tracking p95 ~2.3-3.9 yd/s²; the
  // caps sit a little above, ACC still orders players under them).
  const capA = (ACC_CAP[role] ?? 4.2) * ACC_CAP_K
  return { top, acc: Math.min(top / ramp, capA * (0.85 + 0.15 * clampN((acc - 60) / 39, 0, 1))) }
}

// ── fatigue ⇒ pace (moved from components/animRatings.ts) ────────────────────
// `Play.fatOn` records each on-field man's in-game fatigue at the snap (x100),
// aligned to onFieldOff then onFieldDef. The animation reads it here.

/**
 * Fatigue at which a man starts to show it (top-speed / burst loss, hands on
 * hips). Tuned on the sim's real at-snap distribution (r6b audit, 66 games:
 * p50 0.07, p90 0.13, p99 0.22): from the upper quartile up, full at p99.
 */
export const TIRED_AT = 0.08
export const SPENT_AT = 0.22
/** How tired he looks, 0 (fresh, below TIRED_AT) … 1 (spent, SPENT_AT+). */
export function tiredness(fat: number | undefined): number {
  if (!fat || fat <= TIRED_AT) return 0
  return Math.min(1, (fat - TIRED_AT) / (SPENT_AT - TIRED_AT))
}
/** Top speed / acceleration multipliers for a tired man (at most −5% / −10%). */
export function fatiguePace(fat: number | undefined): { top: number; acc: number } {
  const u = tiredness(fat)
  return { top: 1 - 0.05 * u, acc: 1 - 0.1 * u }
}

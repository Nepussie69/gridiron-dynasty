// ─────────────────────────────────────────────────────────────────────────────
// r2aicalls — REALISM2 row #6: AI play-calling from real tendencies.
//
// The row: "Each AI coordinator calls from his own tendencies seeded from real
// team data: pass rate over expected by down/distance/score/time, 4th-down
// aggressiveness, red-zone and 2-minute calls, play-action and motion rates.
// Targets: league PROE / 4th-down go rates / 2-min pass rate by situation
// (nflverse), with real spread between aggressive and conservative
// coordinators."
//
// What this file adds on top of the shipped layers (J1 situational.ts holds the
// NFL down×distance base and the game-script/zone leans; R18/J-PUNTS hold the
// coach's 4th-down aggression; J5 holds the menu/motion machinery):
//
//   ONE personality per coordinator, pinned to the REAL team-level spread.
//   `coordTendency()` gives each club's offensive coordinator his own pass-rate
//   over expected (PROE), 4th-down go lean, red-zone and two-minute leans, and
//   play-action / motion multipliers. The personality is his own: his
//   coordinator sub-ratings (playCalling/reads, centred on the league), his
//   scheme's real identity, and a stable per-coordinator hash. It is then
//   recentred on the world's own mean and rescaled to sd 1, and each domain is
//   applied with the NFL team-level spread measured in analysis/aicalls_nfl.py
//   (2021–25, 160 team-seasons) — so the league mean is held (league PROE 0, the
//   league pass rate, go rate and motion rate do not move) and only the spread
//   between aggressive and conservative coordinators is real.
//
// NFL truth (analysis/aicalls_nfl.py → analysis/aicalls_nfl.json, nflverse pbp
// 2021–25, 169,550 offensive snaps + FTN charting 185,215 plays):
//   PROE (cell model, team-season)   mean 0    sd 4.56 pts   p10 −5.7  p90 +6.3
//   PROE (nflfastR xpass)            mean 0    sd 4.23 pts   p10 −4.8  p90 +5.8
//   4th-down go rate (team-season)   20.3%     sd 5.37 pts   p10 14.4  p90 28.2
//     by distance: 1 yd 68.8% · 2–3 33.4% · 4–6 15.1% · 7–10 8.9% · 11+ 6.1%
//   2-minute pass rate (team)        67.1%     sd 7.28 pts   p10 57.0  p90 76.6
//     by margin: trail 9+ 79.1 · trail 1–8 78.2 · tied 69.6 · lead 1–8 53.6 · lead 9+ 45.4
//   red-zone pass rate (1st/2nd)     50.8%     sd 7.13 raw (~2.7 true)
//   play-action rate of dropbacks    21.8%     sd 4.74 pts   p10 16.0  p90 27.6
//   pre-snap motion rate of snaps    46.0%     sd 11.72 pts  p10 31.9  p90 62.0
//
// Determinism: ZERO rng() draws added or removed. Every tendency is a hash32 /
// h01 on the coordinator's own id, and every hook only moves a threshold or a
// menu the sim already had (the pickConcept pass/run roll, the concept pick
// inside the type-filtered pool, the J5 motion hash, the J-PUNTS theta). With
// `AICALLS.on` false nothing here is called and the engine is byte-identical to
// main.
// ─────────────────────────────────────────────────────────────────────────────

import { clamp, hash32 } from './rng'
import { centeredSub, coachMeanRating, getCoachSubs } from './coachSubs'
import { MENU_REALISM, type SimConcept } from '../data/playbookData'
import type { World } from './generate'

/** A deterministic uniform in [0,1) from a string key — never an rng() draw. */
function h01(key: string): number {
  return (hash32(key) >>> 0) / 4294967296
}

/**
 * The job's single knob object. `on` is the toggle: with it false no caller
 * enters this file and the sim is byte-identical to main.
 *
 * Every `*Sd` is the measured NFL team-level spread (see the header table), in
 * the units the domain is applied in:
 *   proe   probability units of pass rate over expected (0.043 = 4.3 points)
 *   go     `aggro` units of the J-PUNTS 4th-down threshold (0.45 points of theta
 *          per unit, so 0.3 × 0.45 ≈ 0.14 theta)
 *   rz/tm  probability units of the red-zone / two-minute pass lean
 *   pa     ABSOLUTE probability units (points of dropback share) applied to the
 *          club's own menu play-action share
 *   motion relative multiplier spread on the league motion rate
 */
export const AICALLS = {
  on: true,
  // ── the real spreads (the job's calibration dials) ─────────────────────────
  /** NFL team-season PROE sd 4.3 pts: the cell model reads 4.56, of which ~1.4
   *  pts is the sampling noise of a 1,060-snap season (100·√(p(1−p)/n)). The
   *  realised sim spread is a little narrower than the input (the pass
   *  probability saturates in the highest cells), so this is set a touch above
   *  the measurement and verified against the probe's realised PROE sd. */
  proeSd: 0.052,
  /** 4th-down aggressiveness, in `aggro` units (J-PUNTS thetaSlope 0.45/unit).
   *  The shipped J-PUNTS already gives each HEAD COACH a continuous go
   *  personality (its own measured spread is ~2x the NFL's 5.37 pts), so the
   *  coordinator's own lean is the secondary term that keeps the club's
   *  4th-down tendency part of the same real-seeded personality. */
  goSd: 0.3,
  /** Red-zone pass lean (probability units): the measured per-team spread inside
   *  the 20 is 7.13 pts at a 50.8% base, of which ~6.6 pts is the sampling noise
   *  of a 58-snap season (true ≈ 2.7). */
  rzSd: 0.027,
  /** Two-minute pass lean (probability units). Real team spread 7.28 pts; the
   *  sim's own per-club spread already sits at that level (see the probe's OFF
   *  row), so the coordinator's two-minute tendency is mostly his PROE and this
   *  term only carries the residual. */
  tmSd: 0.02,
  /** Play-action. The NFL per-team spread is ABSOLUTE (sd 4.74 pts of dropbacks
   *  at a 21.8% base), so the model anchors it on the club's own menu:
   *  want = (that menu's own PA share of its passes) + paSdAbs × z. */
  paSdAbs: 0.0474,
  /** Pre-snap motion: relative multiplier sd = 11.72 / 46.0 = 0.255. */
  motionSd: 0.255,
  // ── the personality's composition (relative weights) ──────────────────────
  // His own coordinator sub-ratings carry the largest share, his scheme's real
  // identity a smaller one, and a stable per-coordinator hash the part of him no
  // rating records (the three are then recentred/rescaled, so only the RATIOS
  // matter — the spread itself is pinned to the NFL's below).
  /** His own coordinator sub-ratings (playCalling + reads, centred). */
  subW: 0.5,
  /** A stable per-coordinator hash: the part of him no rating records. */
  hashW: 0.45,
  /** His scheme's own identity (Air Raid passes, RPO Heavy runs). */
  schemeW: 0.3,
  /** The centred sub scale: J9's ±12 spread is ~1 sd, so `sub/12` is ~N(0,1). */
  subScale: 12,
  /** Reject the tail of the recentred personality (in sd units). */
  zLo: -2.2,
  zHi: 2.2,
  // ── per-domain bounds, so no single coordinator runs away ─────────────────
  proeLo: -0.12,
  proeHi: 0.12,
  goLo: -1.4,
  goHi: 1.4,
  rzLo: -0.08,
  rzHi: 0.08,
  tmLo: -0.22,
  tmHi: 0.22,
  /** The reported play-action multiplier bounds (display/probe only). */
  paLo: 0.45,
  paHi: 2.2,
  /** The motion-rate bounds (share of snaps). */
  motionLo: 0.28,
  motionHi: 0.68,
  /** Pool bounds on the club's PA share: wide enough that no club's own menu
   *  share plus the real shift is ever clamped (which would break the mean hold). */
  paShareLo: 0.03,
  paShareHi: 0.9,
} as const

let AICALLS_ON: boolean = AICALLS.on
export function setAiCalls(on: boolean): void {
  AICALLS_ON = on
}
export function getAiCalls(): boolean {
  return AICALLS_ON
}

/** Per-scheme identity in z units (centred per world by `personality()`).
 *  Direction only: Air Raid is the pass-heaviest menu, RPO Heavy the run-heaviest. */
const SCHEME_Z: Record<string, number> = {
  'Air Raid': 1.15,
  Spread: 0.45,
  'West Coast': 0.05,
  'Pro Style': -0.35,
  'RPO Heavy': -0.95,
}

/** The play-action concepts in the playbook (name set: `SimConcept` has no
 *  assignments, and these are the only plays with a `play-action` QB job). */
const PA_PLAYS = new Set([
  'Play Action Deep', 'PA Cross', 'Bootleg', 'Gun PA Boot', 'Gun PA Cross', 'Gun Ace PA', 'Jumbo PA',
])
export function isPlayAction(name: string): boolean {
  return PA_PLAYS.has(name)
}

/** One coordinator's own tendencies. `proe`, `rzLean`, `tmLean`, `goLean` are
 *  all league-mean-zero by construction (see `personality()`). */
export interface CoordTendency {
  /** The recentred/rescaled personality, in sd units. */
  z: number
  /** Pass rate over expected: probability units added to every snap's pass rate. */
  proe: number
  /** 4th-down go lean, in `aggro` units (added to the head coach's own aggro). */
  goLean: number
  /** Red-zone (yard ≥ 80) pass lean, probability units. */
  rzLean: number
  /** Two-minute (last 2:00 of Q2/Q4) pass lean, probability units. */
  tmLean: number
  /** Multiplier on the club's own menu play-action share. */
  paMult: number
  /** Play-action lean: the absolute share of dropbacks the coordinator adds on
   *  top of his menu's own play-action content (league-mean zero). */
  paLean: number
  /** Share of this club's snaps run with pre-snap motion. */
  motionRate: number
  /** The card's own label. */
  style: 'aggressive' | 'balanced' | 'conservative'
}

interface Personality {
  key: string
  mean: number
  sd: number
  z: Map<string, number>
}
const personalities = new WeakMap<World, Personality>()

/** The coordinator's raw (un-normalised) personality: his own subs, his scheme,
 *  and a stable hash. Deterministic, no rng. */
function rawZ(world: World, teamId: string): number {
  const staff = world.staff[teamId] ?? []
  const oc = staff.find((s) => s.role === 'Offensive Coordinator')
  const trait = getCoachSubs()
    ? (centeredSub(world, 'Offensive Coordinator', 'playCalling', oc) +
        centeredSub(world, 'Offensive Coordinator', 'reads', oc)) / 2
    : ((oc?.rating ?? 74) - coachMeanRating(world, 'Offensive Coordinator'))
  const h = AICALLS.hashW * (h01(`aicalls|${oc?.id ?? teamId}`) * 2 - 1)
  const scheme = SCHEME_Z[oc?.scheme ?? ''] ?? 0
  return AICALLS.subW * (trait / AICALLS.subScale) + h + AICALLS.schemeW * scheme
}

/** The world's coordinator personalities, recentred on the league's own mean and
 *  rescaled to sd 1 — so every domain below inherits the real spread and the
 *  league mean holds exactly (the `worldPassMean`/PASS_ID_WIDEN pattern).
 *  Cached per world and week: a club's coordinator does not change within a week. */
function personality(world: World): Personality {
  const key = `${world.season}:${world.week}`
  const hit = personalities.get(world)
  if (hit && hit.key === key) return hit
  const raw = new Map<string, number>()
  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    raw.set(t.id, rawZ(world, t.id))
  }
  const vals = [...raw.values()]
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  const sd = vals.length ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) : 1
  const z = new Map<string, number>()
  for (const [id, v] of raw) z.set(id, sd > 1e-9 ? clamp((v - mean) / sd, AICALLS.zLo, AICALLS.zHi) : 0)
  const out: Personality = { key, mean, sd, z }
  personalities.set(world, out)
  return out
}

const tendencies = new WeakMap<World, { key: string; m: Map<string, CoordTendency> }>()

/** A club's offensive coordinator's own tendencies (see the header). Pure: no
 *  rng, no mutation of the world. */
export function coordTendency(world: World, teamId: string): CoordTendency {
  const key = `${world.season}:${world.week}`
  let cache = tendencies.get(world)
  if (!cache || cache.key !== key) {
    cache = { key, m: new Map() }
    tendencies.set(world, cache)
  }
  const hit = cache.m.get(teamId)
  if (hit) return hit
  const z = personality(world).z.get(teamId) ?? 0
  const A = AICALLS
  const t: CoordTendency = {
    z,
    proe: clamp(A.proeSd * z, A.proeLo, A.proeHi),
    goLean: clamp(A.goSd * z, A.goLo, A.goHi),
    rzLean: clamp(A.rzSd * z, A.rzLo, A.rzHi),
    tmLean: clamp(A.tmSd * z, A.tmLo, A.tmHi),
    paLean: A.paSdAbs * z,
    paMult: clamp(1 + A.paSdAbs * z / 0.33, A.paLo, A.paHi),
    motionRate: clamp(MENU_REALISM.motionRate * (1 + A.motionSd * z), A.motionLo, A.motionHi),
    style: z >= 0.55 ? 'aggressive' : z <= -0.55 ? 'conservative' : 'balanced',
  }
  cache.m.set(teamId, t)
  return t
}

/** The club's 4th-down go lean in `aggro` units, or 0 with the toggle off (so a
 *  caller can add it unconditionally to the head coach's own J-PUNTS aggro). */
export function aiGoLean(world: World, teamId: string): number {
  return AICALLS_ON ? coordTendency(world, teamId).goLean : 0
}

/** The coordinator's own situational pass lean (probability units), added to the
 *  pickConcept threshold on top of J1's table + game-script/zone leans:
 *  his PROE on every snap, plus his red-zone and two-minute tendencies. */
export function aiPassLean(t: CoordTendency, sit: { yard: number; qtr: number; clockSec: number }): number {
  let adj = t.proe
  if (sit.yard >= 80) adj += t.rzLean
  if ((sit.qtr === 2 || sit.qtr === 4) && sit.clockSec <= 120) adj += t.tmLean
  return adj
}

/** The club's pass menu with the coordinator's own play-action rate: the PA
 *  entries are repeated a deterministic number of times inside the SAME single
 *  concept draw (pool composition only, so no draw is added or removed). */
export function aiPassMenu(concepts: SimConcept[], z: number): SimConcept[] {
  const pa = concepts.filter((c) => c.type === 'pass' && isPlayAction(c.name))
  const rest = concepts.filter((c) => !(c.type === 'pass' && isPlayAction(c.name)))
  if (!pa.length || !rest.length) return concepts
  const restPass = rest.filter((c) => c.type === 'pass').length
  if (!restPass) return concepts
  // The club menu's OWN play-action share of its passes is the base the real
  // ABSOLUTE spread is applied to (see AICALLS.paSdAbs): want = base + sd·z is
  // monotone across the whole range and, with the world's mean of z at 0, holds
  // the league play-action rate exactly.
  const base = pa.length / (pa.length + restPass)
  const want = clamp(base + AICALLS.paSdAbs * clamp(z, AICALLS.zLo, AICALLS.zHi), AICALLS.paShareLo, AICALLS.paShareHi)
  const nPa = Math.max(1, Math.round((want / (1 - want)) * restPass))
  if (nPa === pa.length) return concepts
  const out: SimConcept[] = []
  for (let i = 0; i < nPa; i++) out.push(pa[i % pa.length])
  out.push(...rest)
  return out
}

const menus = new WeakMap<World, { key: string; m: Map<string, SimConcept[]> }>()

/** `offStyle`'s club menu: the scheme menu with the coordinator's own play-action
 *  rate. Cached per world/week/team (offStyle is on the per-play path). */
export function aiClubMenu(world: World, teamId: string, concepts: SimConcept[]): SimConcept[] {
  const key = `${world.season}:${world.week}`
  let cache = menus.get(world)
  if (!cache || cache.key !== key) {
    cache = { key, m: new Map() }
    menus.set(world, cache)
  }
  const ck = `${teamId}|${concepts.length}`
  const hit = cache.m.get(ck)
  if (hit) return hit
  const out = aiPassMenu(concepts, coordTendency(world, teamId).z)
  cache.m.set(ck, out)
  return out
}

/** Probe/report helper: the league's spread of the coordinator personalities
 *  (mean ≈ 0, sd ≈ 1) — the real spread the model is pinned to. */
export function aiSpread(world: World): { n: number; mean: number; sd: number } {
  const zs = [...personality(world).z.values()]
  const mean = zs.length ? zs.reduce((a, b) => a + b, 0) / zs.length : 0
  const sd = zs.length ? Math.sqrt(zs.reduce((a, b) => a + (b - mean) ** 2, 0) / zs.length) : 0
  return { n: zs.length, mean, sd }
}

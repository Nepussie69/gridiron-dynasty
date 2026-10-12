// ─────────────────────────────────────────────────────────────────────────────
// J38 (FUTURES #38): featured plays for stars.
//
// A handful of NFL staples are built around ONE specific player's own skills and
// are only dialled up when that player is on the field and his ratings qualify:
//
//   wildcat  — a direct snap to an athletic RB. His own SPD/AGI/BCV drive the
//              run and his THP is the keep/throw read the defence must respect.
//   jet      — jet motion / jet sweep for the fastest WR. His own SPD/ACC decide
//              the gain; the edge defender's own PRC/PUR decides if it is set.
//   fade     — a back-shoulder fade to a contested-catch WR. His own CIT/SPC/JMP
//              plus the QB's DAC against the covering CB's own PRC/MCV.
//   seam     — a TE seam for a move tight end (his SPD/CTH/CIT).
//   wheel    — an RB wheel for a receiving back (his SPD/CTH/BCV/AGI).
//
// The playcaller mixes them in at an NFL-realistic rate, scaled by the OC's own
// `playCalling` sub (J9). A club with no qualifying star never calls one. A play
// called repeatedly is read more (diminishing returns) and a J36 scouting report
// can flag it. Every value here is the specific player's own rating relative to a
// fixed league centre — never a unit, roster or median mean. All picks are
// deterministic hashes: no rng() draw is added, so with `setFeatured(false)` the
// engine is byte-identical to the unmodified sim.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player, Position } from '../types'
import { playerAttrs } from '../data/ratings'
import { depthAt, STARTERS } from './depth'
import { clamp, hash32 } from './rng'
import type { World } from './generate'

/** J38: the local deterministic [0,1) hash (the playsim `h01` pattern). */
const h01 = (key: string): number => (hash32(key) >>> 0) / 4294967296

/** J38 tunables — the only new constants this job adds (all deterministic). */
export const FEATURED = {
  /**
   * Per-snap call rate for each featured play, at a league-average OC
   * `playCalling` sub. ~63 offensive snaps/game, so wildcat ≈ 0.63/game and jet
   * ≈ 1.26/game — the NFL bands for a club with that star. Only applied when the
   * star qualifies and is on the field.
   */
  rate: {
    wildcat: 0.010,
    jet: 0.015,
    fade: 0.012,
    seam: 0.010,
    wheel: 0.010,
  } as Record<string, number>,
  /** OC `playCalling` (J9, centred) → call-rate multiplier: 1 + rel/scale, clamped. */
  pcScale: 60,
  pcLo: 0.75,
  pcHi: 1.3,
  /**
   * The star's own composite must reach this (raw rating scale) for his play to
   * be available. Set so roughly a quarter to a third of clubs carry each star;
   * a club with none of them never runs a featured play.
   */
  min: {
    wildcat: 83,
    jet: 94,
    fade: 88,
    seam: 86,
    wheel: 85,
  } as Record<string, number>,
  /**
   * League centre for each composite (the `WX_CENTER` role). A star at the centre
   * adds exactly zero, so the league means hold; the probe sets these to the mean
   * qualifying composite. Fixed values (not derived from the roster) so old saves
   * and new seeds share the same reference.
   */
  center: {
    wildcat: 84.6,
    jet: 95.5,
    fade: 92.8,
    seam: 88.7,
    wheel: 86.3,
  } as Record<string, number>,
  /** Featured-run yardage per composite point above centre (a direct, centred gain). */
  runYdsW: 0.6,
  /** Completion-probability edge per composite point above centre (÷100). */
  passW: 4.0,
  /** Back-shoulder fade: the QB's DAC per point (÷100) opens the window. */
  dacW: 0.30,
  /** The covering CB's own PRC/MCV per point (÷100) closes the fade window. */
  prcW: 0.22,
  /** A featured throw by an elite star risks a pick a little less (per point ÷100). */
  intW: 0.10,
  /**
   * Diminishing returns: the n-th call of the same featured play is read at
   * relief = decay^n, floored at minRelief. The defence sits on a play it has seen.
   */
  decay: 0.7,
  minRelief: 0.3,
  /** A J36 scouting report that flags the star halves the edge (the defence is ready). */
  flaggedRelief: 0.5,
  /** Order the keys are rolled in (fixed, so the hash draw is stable). */
  order: ['wildcat', 'jet', 'fade', 'seam', 'wheel'] as string[],
} as const

/** J38: which position each featured play is built around. */
const FEATURED_POS: Record<string, Position> = {
  wildcat: 'RB',
  jet: 'WR',
  fade: 'WR',
  seam: 'TE',
  wheel: 'RB',
}

/** J38: the star's composite — a weighted blend of the ratings the play uses. */
const FEATURED_KEYS: Record<string, [string, number][]> = {
  wildcat: [['SPD', 0.40], ['AGI', 0.26], ['BCV', 0.22], ['THP', 0.12]],
  jet: [['SPD', 0.62], ['ACC', 0.38]],
  fade: [['CIT', 0.45], ['SPC', 0.30], ['JMP', 0.25]],
  seam: [['SPD', 0.40], ['CTH', 0.35], ['CIT', 0.25]],
  wheel: [['SPD', 0.46], ['CTH', 0.24], ['BCV', 0.16], ['AGI', 0.14]],
}

/** J38: the concept each featured play resolves as (its own name/grouping). */
export const FEATURED_CONCEPT: Record<string, { name: string; type: 'run' | 'pass'; depth: number; yac: number; description: string; personnel: string; motion?: boolean }> = {
  wildcat: { name: 'Wildcat', type: 'run', depth: 0, yac: 0, description: 'Direct snap to an athletic back.', personnel: '11' },
  jet: { name: 'Jet Sweep', type: 'run', depth: 8, yac: 0.9, description: 'Jet motion — the fast receiver on the edge.', personnel: '11', motion: true },
  fade: { name: 'Back-Shoulder Fade', type: 'pass', depth: 14, yac: 0.1, description: 'Back-shoulder fade to the contested-catch receiver.', personnel: '11' },
  seam: { name: 'TE Seam', type: 'pass', depth: 14, yac: 0.3, description: 'Seam shot to the move tight end.', personnel: '12' },
  wheel: { name: 'RB Wheel', type: 'pass', depth: 12, yac: 0.6, description: 'Wheel route to the receiving back.', personnel: '11' },
}

/** J38: a player's composite on the raw rating scale (dev-plan gains included). */
export function featuredComposite(key: string, p: Player): number {
  const spec = FEATURED_KEYS[key]
  if (!spec) return 0
  const a = playerAttrs(p)
  let sum = 0
  for (const [k, w] of spec) sum += (a[k] ?? 0) * w
  return sum
}

/**
 * J38: the club's qualifying star for one featured play — the best composite at
 * the play's position among the club's healthy starters, or undefined when none
 * reaches the threshold. `depthAt` keeps the club's own depth order, so the star
 * is a man actually on the field (a healthy starter at his position). Cached per
 * (world, season, week) so the per-snap election never re-sorts the roster.
 */
const starCache = new WeakMap<World, Map<string, Player | undefined>>()
export function featuredStar(world: World, teamId: string, key: string): Player | undefined {
  let m = starCache.get(world)
  if (!m) { m = new Map(); starCache.set(world, m) }
  const ck = `${world.season}:${world.week}:${teamId}:${key}`
  if (m.has(ck)) return m.get(ck)
  const pos = FEATURED_POS[key]
  let best: Player | undefined
  if (pos) {
    const list = depthAt(world, teamId, pos).filter((p) => !p.injured).slice(0, STARTERS[pos] ?? 1)
    let bestC = -1
    for (const p of list) {
      const c = featuredComposite(key, p)
      if (c > bestC) { bestC = c; best = p }
    }
    if (best && bestC < (FEATURED.min[key] ?? 0)) best = undefined
  }
  m.set(ck, best)
  return best
}

/** J38: one elected featured play. */
export interface FeaturedPlay {
  key: string
  playerId: string
  /** The star's edge multiplier after diminishing returns / a scouting flag. */
  relief: number
}

/**
 * J38: decide whether this snap is a featured play, and for whom. Pure and
 * deterministic (hash only, no rng() draw). `calls` is the in-game count per
 * featured key (for the diminishing returns) and `flagged` the set of the
 * offence's player ids the defence's report keys on this week.
 */
export function electFeatured(
  world: World,
  offId: string,
  n: number,
  calls: Record<string, number>,
  flagged: Set<string>,
  playCallingRel: number,
): FeaturedPlay | null {
  const pcMult = clamp(1 + playCallingRel / FEATURED.pcScale, FEATURED.pcLo, FEATURED.pcHi)
  const u = h01(`j38:${n}:${offId}:feat`)
  let acc = 0
  for (const key of FEATURED.order) {
    const star = featuredStar(world, offId, key)
    if (!star) continue
    const rate = (FEATURED.rate[key] ?? 0) * pcMult
    acc += rate
    if (u < acc) {
      const seen = calls[key] ?? 0
      let relief = Math.max(FEATURED.minRelief, Math.pow(FEATURED.decay, seen))
      if (flagged.has(star.id)) relief *= FEATURED.flaggedRelief
      return { key, playerId: star.id, relief }
    }
  }
  return null
}

/** J38: the run-yardage edge the star's own ratings are worth (direct yards, centred). */
export function featuredRunEdge(key: string, p: Player | undefined, relief: number): number {
  if (!p) return 0
  return (featuredComposite(key, p) - (FEATURED.center[key] ?? 0)) * FEATURED.runYdsW * relief
}

/**
 * J38: the completion-window edge the star (plus, on the fade, the QB's DAC vs
 * the covering CB's PRC) is worth. Returns a probability shift.
 */
export function featuredPassEdge(
  key: string,
  p: Player | undefined,
  qbAttrs: Record<string, number>,
  coverAttrs: Record<string, number> | undefined,
  coverPos: string | undefined,
  relief: number,
): number {
  if (!p) return 0
  let e = (featuredComposite(key, p) - (FEATURED.center[key] ?? 0)) * (FEATURED.passW / 100) * relief
  if (key === 'fade') {
    e += ((qbAttrs.DAC ?? 70) - 82) * (FEATURED.dacW / 100)
    if (coverAttrs) {
      const cover = ((coverAttrs.PRC ?? 70) + (coverAttrs.MCV ?? 70)) / 2
      e -= (cover - 80) * (FEATURED.prcW / 100)
    }
  }
  void coverPos
  return e
}

/** J38: interception-risk multiplier from the star's own composite (per point ÷100). */
export function featuredIntMult(key: string, p: Player | undefined, relief: number): number {
  if (!p) return 1
  return clamp(1 - (featuredComposite(key, p) - (FEATURED.center[key] ?? 0)) * (FEATURED.intW / 100) * relief, 0.7, 1.15)
}

// ── dev-only toggle (the setStamina pattern) ─────────────────────────────────
// Default ON. With it OFF no featured play is elected and no edge is applied, so
// the engine is byte-identical to the unmodified sim (no rng() draw added or
// removed on either path).
let FEATURED_ON = true
export function setFeatured(on: boolean) {
  FEATURED_ON = on
}
export function getFeatured(): boolean {
  return FEATURED_ON
}
export function featuredOn(): boolean {
  return FEATURED_ON
}

/** J38: hash32 is re-exported for the probe's own deterministic bucketing. */
export { hash32 as featuredHash }

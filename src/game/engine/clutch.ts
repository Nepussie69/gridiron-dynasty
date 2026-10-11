// ─────────────────────────────────────────────────────────────────────────────
// Player clutch & late-and-close execution (FUTURES #8, job P2 "clutch-eng").
//
// A per-player **clutch** read (1–99) is a PURE function of the player: a stable
// `hash32(p.id)` spread centred on 50, a bonus for the `Clutch` trait, a small
// AWR-vs-position-mean term, and an optional `clutchAdj` (P3 season drift). No
// rng is drawn and nothing is stored, so an old save stays valid and every seed
// reproduces exactly.
//
// On the field the rating only matters in **late-and-close** snaps (Q4 with
// ≤5:00 left or OT, margin ≤8). There the offence's key-player clutch — the QB
// on a pass or the carrier on a run (weight 0.6) plus the primary target (0.4) —
// is measured against the defence's top-3 clutch, all relative to the league
// mean, scaled ×0.02 and clamped to ±0.6 "clutch units". That value is added to
// the existing coach `clutch` arg at the resolver call sites, and a kicker's
// clutch moves a late FG by up to ±3 percentage points. Both are exactly 0
// outside late-and-close and when `setClutch(false)`.
//
// The coach edge (`playsim.clutchFor`, ±3) and the player edge (±0.6) share one
// arg, so the sum is bounded by 3.6 (see the P2 probe).
// ─────────────────────────────────────────────────────────────────────────────

import type { Player } from '../types'
import type { World } from './generate'
import { clamp, hash32 } from './rng'
import { depthGroup } from './depth'
import { CLUTCH_CENTER, POS_MEAN } from './ratingMeans'

// ── Tunables ─────────────────────────────────────────────────────────────────
// One constants object, the same pattern as R2/R15/WX. `spread` is the uniform
// half-width of the id hash; a ±20 uniform has SD ≈ 11.5, which lands the
// distribution inside the spec's 10–14 target.
export const CLUTCH = {
  /** Uniform half-width of `hash32(p.id)` around the 50 centre. */
  spread: 20,
  /** Bonus for a trait containing "clutch". */
  trait: 12,
  /** Weight on (AWR − position-mean AWR): one AWR point ≈ 0.15 clutch points. */
  awrW: 0.15,
  /** The raw edge (clutch points) is scaled by this and clamped to ±cap. */
  scale: 0.02,
  cap: 0.6,
  /** Key-player weights: (QB | carrier) 0.6, primary target 0.4. */
  qbW: 0.6,
  targetW: 0.4,
  /** A late FG moves by up to ±kickCap (3 percentage points). */
  kickCap: 0.03,
  /** Per clutch point above/below the centre: 0.0006 × 50 ≈ 3 points. */
  kickSlope: 0.0006,
} as const

// ── Toggle ───────────────────────────────────────────────────────────────────
// R15-style dev flag: off makes every clutch effect exactly 0, so the play-by-
// play (and the calibration) is byte-identical to the pre-feature build.
let CLUTCH_ON = true

/** Like `setStamina`: off makes every clutch effect exactly neutral. */
export function setClutch(on: boolean) {
  CLUTCH_ON = on
}

/** Read the current clutch toggle (a probe restores it exactly). */
export function getClutch(): boolean {
  return CLUTCH_ON
}

// ── Rating ───────────────────────────────────────────────────────────────────
/** A stable 1–99 clutch read. Pure: reads the player only, draws no rng. */
export function clutchOf(p: Player): number {
  const h = (hash32(p.id) >>> 0) / 4294967296
  const base = CLUTCH_CENTER + (h - 0.5) * 2 * CLUTCH.spread
  const trait = (p.traits ?? []).some((t) => /clutch/i.test(t)) ? CLUTCH.trait : 0
  const awr = p.attrs?.AWR
  const mean = POS_MEAN[p.pos]?.AWR
  const aware = awr !== undefined && mean !== undefined ? (awr - mean) * CLUTCH.awrW : 0
  return clamp(Math.round(base + trait + aware + (p.clutchAdj ?? 0)), 1, 99)
}

/**
 * The league means each side is measured against, cached per world and tier (a
 * `ratingMeans`-style cache). The offence key group (`offPass` / `offRun`) and
 * the defence top-3 (`def`) sit on different levels (a 2-player offence average
 * vs a top-3-of-11 defence), so each is centred on its own league mean — that is
 * what keeps the edge zero-mean and the calibration neutral. `kick` centres the
 * late FG term. P3 may mutate `clutchAdj`; call `resetClutchCache` after a drift.
 */
interface ClutchMeans {
  offPass: number
  offRun: number
  def: number
  kick: number
}

const meansCache = new WeakMap<World, Map<string, ClutchMeans>>()

function leagueMeans(world: World, tier: string): ClutchMeans {
  let byTier = meansCache.get(world)
  if (!byTier) {
    byTier = new Map()
    meansCache.set(world, byTier)
  }
  const hit = byTier.get(tier)
  if (hit) return hit

  const teams = world.teams.filter((t) => t.tier === tier && (world.roster[t.id]?.length ?? 0) > 0)
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : CLUTCH_CENTER)
  const off: number[] = []
  const run: number[] = []
  const def: number[] = []
  const kick: number[] = []
  for (const t of teams) {
    const qb = depthGroup(world, t.id, ['QB'], 1)[0]
    const tgt = depthGroup(world, t.id, ['WR', 'TE'], 1)[0]
    const qbV = qb ? clutchOf(qb) : CLUTCH_CENTER
    const tgtV = tgt ? clutchOf(tgt) : CLUTCH_CENTER
    off.push((qbV * CLUTCH.qbW + tgtV * CLUTCH.targetW) / (CLUTCH.qbW + CLUTCH.targetW))
    const c = depthGroup(world, t.id, ['RB', 'FB'], 1)[0]
    run.push(c ? clutchOf(c) : CLUTCH_CENTER)
    def.push(defenceTop3(world, t.id))
    const k = depthGroup(world, t.id, ['K'], 1)[0]
    if (k) kick.push(clutchOf(k))
  }
  const means: ClutchMeans = { offPass: avg(off), offRun: avg(run), def: avg(def), kick: avg(kick) }
  byTier.set(tier, means)
  return means
}

/** Drop a world's cached league means (P3 calls this after a `clutchAdj` drift). */
export function resetClutchCache(world: World): void {
  meansCache.delete(world)
}

/** The league-average clutch over a world's players (diagnostics). */
export function clutchLeagueMean(world: World): number {
  const ps = world.players ?? []
  return ps.length ? ps.reduce((s, p) => s + clutchOf(p), 0) / ps.length : CLUTCH_CENTER
}


// ── Late and close ───────────────────────────────────────────────────────────
/** The minimal game state the late-and-close test needs (a GameState fits). */
export interface ClutchGameState {
  qtr: number
  clock: number
  homeId: string
  homeScore: number
  awayScore: number
}

export interface LateCloseState {
  qtr: number
  clock: number
  /** The offence's score margin (negative = trailing). */
  margin: number
}

/** Q4 with ≤5:00 left, or OT, with the margin ≤8 either way. */
export function isLateClose(s: LateCloseState): boolean {
  if (Math.abs(s.margin) > 8) return false
  return s.qtr >= 5 || (s.qtr === 4 && s.clock <= 300)
}

export type ClutchKind = 'pass' | 'run'

/** The offence's key-player clutch: a weighted average, so the weights sum to 1. */
function offenceKeyClutch(world: World, offId: string, kind: ClutchKind): number {
  if (kind === 'run') {
    const c = depthGroup(world, offId, ['RB', 'FB'], 1)[0]
    return c ? clutchOf(c) : CLUTCH_CENTER
  }
  const qb = depthGroup(world, offId, ['QB'], 1)[0]
  const tgt = depthGroup(world, offId, ['WR', 'TE'], 1)[0]
  const qbV = qb ? clutchOf(qb) : CLUTCH_CENTER
  const tgtV = tgt ? clutchOf(tgt) : CLUTCH_CENTER
  return (qbV * CLUTCH.qbW + tgtV * CLUTCH.targetW) / (CLUTCH.qbW + CLUTCH.targetW)
}

/** The defence's on-field unit's top-3 clutch (mean). */
function defenceTop3(world: World, defId: string): number {
  const unit = [
    ...depthGroup(world, defId, ['DE', 'DT'], 4),
    ...depthGroup(world, defId, ['LB'], 3),
    ...depthGroup(world, defId, ['CB'], 3),
    ...depthGroup(world, defId, ['S'], 2),
  ]
  if (!unit.length) return CLUTCH_CENTER
  const top = unit.map(clutchOf).sort((a, b) => b - a).slice(0, 3)
  return top.reduce((s, v) => s + v, 0) / top.length
}

/**
 * The player-clutch edge (in "clutch units") added to the coach `clutch` arg on
 * a late-and-close snap. Exactly 0 outside late-and-close and when clutch is off.
 */
export function clutchEdge(world: World, s: ClutchGameState, offId: string, defId: string, kind: ClutchKind): number {
  if (!CLUTCH_ON) return 0
  const margin = offId === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore
  if (!isLateClose({ qtr: s.qtr, clock: s.clock, margin })) return 0
  const tier = world.byId[offId]?.tier ?? world.byId[defId]?.tier ?? 'NFL'
  const means = leagueMeans(world, tier)
  const offMean = kind === 'run' ? means.offRun : means.offPass
  const offScore = offenceKeyClutch(world, offId, kind) - offMean
  const defScore = defenceTop3(world, defId) - means.def
  return clamp((offScore - defScore) * CLUTCH.scale, -CLUTCH.cap, CLUTCH.cap)
}

/**
 * The kicker's late FG make-probability offset (up to ±0.03), applied on top of
 * `fgProb`. Exactly 0 outside late-and-close and when clutch is off.
 */
export function kickClutch(world: World, offId: string, s: LateCloseState): number {
  if (!CLUTCH_ON) return 0
  if (!isLateClose(s)) return 0
  const k = depthGroup(world, offId, ['K'], 1)[0]
  if (!k) return 0
  const tier = world.byId[offId]?.tier ?? 'NFL'
  const centre = leagueMeans(world, tier).kick
  return clamp((clutchOf(k) - centre) * CLUTCH.kickSlope, -CLUTCH.kickCap, CLUTCH.kickCap)
}

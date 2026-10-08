// ─────────────────────────────────────────────────────────────────────────────
// Play-by-play simulation
//
// Every play is resolved from the *exact* player ratings (Madden 26 / CFB 26)
// and the coaching schemes from each club's coordinators. The output is a full
// play log with enough geometry for the 2D top-down match viewer.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player, Position, MatchupSet, UsageSet } from '../types'
import { attributesFor } from '../data/ratings'
import { POS_MEAN } from './ratingMeans'
import { bucketYards, CFB_CHUNK_DAMP, getCalibration, sampleBucket } from '../data/calibration'
import { coachEffect } from './coaching'
import { depthGroup } from './depth'
import { planEffects, BALANCED_PLAN } from './gameplan'
import { aiCallSheet, fourthDownChoice, fourthDownEV, twoPointChoice, fgProb, bucketFor, offClassFor, callEffect, bestCounterCall, bestCounterClass, defCallForPlan, topKey, DEF_CALLS, OFF_CLASSES, BUCKET_LABEL, OFF_CLASS_LABEL, DEF_CALL_LABEL, type CallSheet, type Situation, type Bucket, type OffClass, type DefCall, type CallEffect } from './decisions'
import { masteryMultiplier } from './playbook'
import { mod, schemeFit, styleProfile } from './style'

// The user's own coaching skill, set once per game by the store when they hold a
// coaching role. Kept module-level so every play resolution sees it without
// threading it through each resolver signature.
let USER_COACH: { teamId: string; off: number; def: number; development: number; situational: number } | null = null
export function setUserCoaching(ctx: typeof USER_COACH) {
  USER_COACH = ctx
}
function ocEffect(world: World, teamId: string) {
  const base = coachEffect(world, teamId)
  if (USER_COACH && USER_COACH.teamId === teamId) {
    return {
      ...base,
      offEdge: base.offEdge + USER_COACH.off,
      defEdge: base.defEdge + USER_COACH.def,
      development: base.development * USER_COACH.development,
      situational: base.situational + USER_COACH.situational,
    }
  }
  return base
}

/** Cohesion + head-coach situational edge, applied on money downs and in the red zone. */
function clutchFor(world: World, offId: string, down: number, yard: number): number {
  if (down < 3 && yard < 80) return 0
  return ocEffect(world, offId).situational
}

import type { World } from './generate'
import { clamp, hash32, makeRng, type Rng } from './rng'

export interface Play {
  n: number
  qtr: number
  clock: string
  down: number | null
  distance: number | null
  startYard: number // 0-100 from the offense's own goal line
  endYard: number
  offId: string
  defId: string
  type: 'run' | 'pass' | 'punt' | 'fg' | 'kickoff' | 'pat' | 'end' | 'penalty'
  concept: string
  yards: number
  result: string
  scorerId?: string
  scorerName?: string
  turnover?: boolean
  homeScore: number
  awayScore: number
  carrierId?: string
  targetId?: string
  passDepth?: number
  pressure?: boolean
  bigPlay?: boolean
  timeUsed?: number
  /** L10 G8: offensive class of this snap (run / short / deep), for the tendency book. */
  offClass?: OffClass
  /** L10 G8: the defensive call used on this snap, for the tendency book. */
  defCall?: DefCall
  // attribution for individual stats
  qbId?: string
  tackleIds?: string[]
  sackId?: string
  intId?: string
  /** L11.5 Q7: the defender in coverage on the target (derived, never an rng draw). */
  coverId?: string
  /** L12 E2: the defender who forced a fumble on a catch (bookkeeping only). */
  fumbleId?: string
}

export interface GameSim {
  homeId: string
  awayId: string
  homeScore: number
  awayScore: number
  plays: Play[]
  stats: {
    home: TeamGameStats
    away: TeamGameStats
  }
  /** Per-player box score, filled after simulation. */
  box?: import('./stats').PlayerBoxScore[]
  /** True when produced by the fast allocator rather than play-by-play. */
  generated?: boolean
  /** G1: every decision the user's club made this game. */
  decisions?: DecisionLog[]
  /** L10 G5: film grade of the user's calls, for the post-game view. */
  film?: { grade: number; letter: string; lines: string[]; userCalls?: number }
  /** L12 W2: the graded keys to the game, for the post-game film card. */
  keys?: import('./keys').KeyGrade[]
  /** L11.5 Q3: mid-game plan switches, for the post-game film card. */
  planChanges?: PlanChange[]
  homeLines?: { playerId: string; line: import('../types').GameStatLine }[]
  awayLines?: { playerId: string; line: import('../types').GameStatLine }[]
}

/** L11.5 Q3: one mid-game change to the user's live plan. */
export interface PlanChange {
  qtr: number
  clock: string
  side: 'off' | 'def'
  preset: string
}

export interface TeamGameStats {
  plays: number
  points: number
  passAtt: number
  passComp: number
  passYds: number
  passTD: number
  ints: number
  rushAtt: number
  rushYds: number
  rushTD: number
  fumbles: number
  /** Sacks made by this team's defense. */
  sacks: number
  /** Sacks this team's offense has given up. */
  sacksTaken: number
  firstDowns: number
  thirdDownAtt: number
  thirdDownConv: number
  fgAtt: number
  fgMade: number
  /** Two-point tries attempted / converted. */
  twoAtt: number
  twoMade: number
  td: number
  top: number // time of possession, seconds
}

function emptyStats(): TeamGameStats {
  return {
    plays: 0, points: 0, passAtt: 0, passComp: 0, passYds: 0, passTD: 0, ints: 0,
    rushAtt: 0, rushYds: 0, rushTD: 0, fumbles: 0, sacks: 0, sacksTaken: 0, firstDowns: 0,
    thirdDownAtt: 0, thirdDownConv: 0, fgAtt: 0, fgMade: 0, twoAtt: 0, twoMade: 0, td: 0, top: 0,
  }
}

// ── Attribute access (merge exact ratings with position fallbacks) ────────────
function mkAttrs(p: Player): Record<string, number> {
  return { ...attributesFor(p.id, p.pos, p.ovr), ...(p.attrs ?? {}) }
}

/** Production multiplier from playbook mastery in the current system. */
function famMult(p: Player | undefined): number {
  if (!p) return 1
  return masteryMultiplier(p)
}
function avg(list: number[]) {
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : 70
}

// ── L12 E1: every offensive rating counts ────────────────────────────────────
// Each new term is (rating − POS_MEAN[pos][key]) × weight, so an average starter
// adds 0 and league averages hold. None of these adds or removes an rng() draw.
// E1_W scales ONLY the new terms; no existing constant is touched.
const E1_W = 1.1
/** E1: relative rating value vs the average starter at that position (0 when average). */
function rmean(pos: string | undefined, key: string, val: number): number {
  const m = pos ? POS_MEAN[pos]?.[key] : undefined
  return m === undefined ? 0 : val - m
}
/** E1: QB throw power sharpens the deep separation edge (deep throws only). */
function qbDeepThp(qbA: Record<string, number>, depth: number): number {
  if (depth < 15) return 0
  return clamp(rmean('QB', 'THP', qbA.THP ?? 70) * 0.06 * E1_W, -5, 5)
}
/** E1: TUP/TOR trim the share of the pressure penalty to completion that applies. */
function qbPressureRelief(qbA: Record<string, number>): number {
  return clamp((rmean('QB', 'TUP', qbA.TUP ?? 70) * 0.004 + rmean('QB', 'TOR', qbA.TOR ?? 70) * 0.003) * E1_W, 0, 0.4)
}
/** E1: QB mobility (SPD/ACC/BTK/STR) shrinks sack chance. */
function qbSackEscape(qbA: Record<string, number>): number {
  return clamp(
    (rmean('QB', 'SPD', qbA.SPD ?? 70) * 0.0012 +
      rmean('QB', 'ACC', qbA.ACC ?? 70) * 0.0008 +
      rmean('QB', 'BTK', qbA.BTK ?? 70) * 0.0006 +
      rmean('QB', 'STR', qbA.STR ?? 70) * 0.0004) * E1_W,
    -0.15, 0.18,
  )
}
/** E1: QB play-action proficiency scales the existing play-action bonus ×0.7–1.3. */
function qbPacMult(qbA: Record<string, number>): number {
  return clamp(1 + rmean('QB', 'PAC', qbA.PAC ?? 70) * 0.005 * E1_W, 0.7, 1.3)
}
/** E1: awareness trims interception risk a little; throw power trims it on deep balls. */
function qbIntMult(qbA: Record<string, number>, depth: number): number {
  const awr = clamp(1 - rmean('QB', 'AWR', qbA.AWR ?? 70) * 0.0015 * E1_W, 0.9, 1.08)
  const deep = depth >= 15 ? clamp(1 - rmean('QB', 'THP', qbA.THP ?? 70) * 0.0015 * E1_W, 0.85, 1.1) : 1
  return awr * deep
}
/** E1: a receiver's hands move the incompletion share on catchable balls (CTH; CIT tight, SPC/JMP deep). */
function targetCatchProb(target: Player | undefined, tA: Record<string, number>, depth: number, tight: boolean): number {
  if (!target) return 0
  let p = rmean(target.pos, 'CTH', tA.CTH ?? 70) * 0.0006
  if ((target.pos === 'WR' || target.pos === 'TE') && tight) {
    p += rmean(target.pos, 'CIT', tA.CIT ?? 70) * 0.0005
    p += rmean(target.pos, 'STR', tA.STR ?? 70) * 0.0002
  }
  if ((target.pos === 'WR' || target.pos === 'TE') && depth >= 15) {
    p += rmean(target.pos, 'SPC', tA.SPC ?? 70) * 0.0005 + rmean(target.pos, 'JMP', tA.JMP ?? 70) * 0.0005
  }
  return clamp(p * E1_W, -0.035, 0.035)
}
/** E1: WR/TE burst (ACC/COD) joins separation a little. */
function targetAccCod(target: Player | undefined, tA: Record<string, number>): number {
  if (!target || (target.pos !== 'WR' && target.pos !== 'TE')) return 0
  return clamp((rmean(target.pos, 'ACC', tA.ACC ?? 70) * 0.04 + rmean(target.pos, 'COD', tA.COD ?? 70) * 0.04) * E1_W, -6, 6)
}
/** E1: a receiver's release (RLS) vs the coverage defender's press (PRS) on short man throws. */
function releaseVsPress(target: Player | undefined, tA: Record<string, number>, cover: Player | undefined, manCoverage: number, depth: number): number {
  if (!target || target.pos !== 'WR' || !cover || manCoverage <= 0.5 || depth >= 15) return 0
  const cA = mkAttrs(cover)
  return clamp((rmean('WR', 'RLS', tA.RLS ?? 70) - rmean(cover.pos, 'PRS', cA.PRS ?? 70)) * 0.06 * E1_W, -8, 8)
}
/** E1: OL awareness blunts part of the blitz bonus (9 × (1 − this)). */
function olBlitzAware(ol: Player[]): number {
  return clamp(avg(ol.map((p) => rmean(p.pos, 'AWR', mkAttrs(p).AWR ?? 70))) * 0.005 * E1_W, -0.18, 0.3)
}
/** E1: OL strength helps short-yardage runs (≤ 2 to go). */
function olShortStrength(ol: Player[], distance: number): number {
  if (distance > 2) return 0
  return clamp(avg(ol.map((p) => rmean(p.pos, 'STR', mkAttrs(p).STR ?? 70))) * 0.1 * E1_W, -6, 6)
}
/** E1: a tight end joins run blocking at 15% weight. */
function teRunBlock(te: Player | undefined): number {
  if (!te) return 0
  const a = mkAttrs(te)
  return (rmean('TE', 'RBK', a.RBK ?? 70) * 0.7 + rmean('TE', 'IBL', a.IBL ?? 70) * 0.3) * 0.15 * E1_W
}
/** E1: SPM/SFA/COD/ACC join a running back's elusiveness (small). */
function rbElusivenessExtras(pos: string | undefined, a: Record<string, number>): number {
  if (pos !== 'RB') return 0
  return clamp(
    (rmean('RB', 'SPM', a.SPM ?? 70) * 0.03 +
      rmean('RB', 'SFA', a.SFA ?? 70) * 0.03 +
      rmean('RB', 'COD', a.COD ?? 70) * 0.03 +
      rmean('RB', 'ACC', a.ACC ?? 70) * 0.03 +
      rmean('RB', 'STR', a.STR ?? 70) * 0.02) * E1_W,
    -8, 8,
  )
}
/** E1: BTK adds yards after contact on runs of 3+. */
function rbAfterContact(pos: string | undefined, a: Record<string, number>, gain: number): number {
  if (pos !== 'RB' || gain < 3) return 0
  return clamp(Math.round(rmean('RB', 'BTK', a.BTK ?? 70) * 0.04 * E1_W), -4, 4)
}
/** E1: ball security — CAR moves fumble chance around the existing style factor. */
function rbCarrySecurity(pos: string | undefined, a: Record<string, number>): number {
  return clamp(1 - (rmean(pos, 'CAR', a.CAR ?? 70) / 100) * E1_W, 0.7, 1.3)
}

// ── L12 E2: defense, kicking and general ratings ─────────────────────────────
// Same shape as E1: every term is (rating − POS_MEAN) × weight, so an average
// starter adds 0 and league averages hold. No rng() draw is added or removed.
const E2_W = 1.0
/** E2: average relative value of one rating across a group, per player's position. */
function relAvg(key: string, list: Array<Player | undefined>): number {
  const ps = list.filter((p): p is Player => !!p)
  if (!ps.length) return 0
  return avg(ps.map((p) => rmean(p.pos, key, mkAttrs(p)[key] ?? 70)))
}
/** E2: DL quickness (SPD/ACC/AGI) joins the rush; STR vs the OL joins every rusher. */
function dlRushExtras(dl: Player[], olStrRel: number): number {
  if (!dl.length) return 0
  return avg(dl.map((p) => {
    const a = mkAttrs(p)
    const quick = rmean(p.pos, 'SPD', a.SPD ?? 70) * 0.12 +
      rmean(p.pos, 'ACC', a.ACC ?? 70) * 0.12 +
      rmean(p.pos, 'AGI', a.AGI ?? 70) * 0.06
    const str = (rmean(p.pos, 'STR', a.STR ?? 70) - olStrRel) * 0.05
    return quick + str
  }))
}
/** E2: on a blitz the second-level rush (max PMV/FMV) joins the pressure. */
function lbBlitzRush(lbs: Player[]): number {
  if (!lbs.length) return 0
  return avg(lbs.map((p) => {
    const a = mkAttrs(p)
    return Math.max(rmean(p.pos, 'PMV', a.PMV ?? 70), rmean(p.pos, 'FMV', a.FMV ?? 70))
  }))
}
/** E2: pursuit (DL/LB PUR + SPD) shrinks the run's big-play tail. */
function runPursuit(dl: Player[], lbs: Player[]): number {
  const all = [...dl, ...lbs]
  return relAvg('PUR', all) * 0.7 + relAvg('SPD', all) * 0.4
}
/** E2: LB recognition, block shedding and athleticism join the second level. */
function lbRunExtras(lbs: Player[]): number {
  return relAvg('PRC', lbs) * 0.16 + relAvg('BSH', lbs) * 0.16 +
    relAvg('STR', lbs) * 0.08 + relAvg('ACC', lbs) * 0.08 + relAvg('AGI', lbs) * 0.08
}
/** E2: secondary quickness (ACC/AGI/STR) joins coverage. */
function dbCoverageExtras(cbs: Player[], saf: Player[]): number {
  const all = [...cbs, ...saf]
  return relAvg('ACC', all) * 0.05 + relAvg('AGI', all) * 0.05 + relAvg('STR', all) * 0.03
}
/** E2: defensive play recognition (DL/LB/S PRC) shrinks play-action and screens. */
function recognition(dl: Player[], lbs: Player[], saf: Player[]): number {
  return (relAvg('PRC', dl) + relAvg('PRC', lbs) + relAvg('PRC', saf)) / 3
}
/** E2: a tackler's TAK squeezes yards after the catch. */
function tacklerYacShrink(id: string | undefined, groups: Player[][]): number {
  if (!id) return 0
  for (const g of groups) {
    const p = g.find((x) => x.id === id)
    if (p) return Math.round(rmean(p.pos, 'TAK', mkAttrs(p).TAK ?? 70) * 0.05 * E2_W)
  }
  return 0
}
/** E2: a big hitter's HPW adds a small forced-fumble chance on a catch. */
function tacklerHitPower(id: string | undefined, groups: Player[][]): number {
  if (!id) return 0
  for (const g of groups) {
    const p = g.find((x) => x.id === id)
    if (p) return clamp(rmean(p.pos, 'HPW', mkAttrs(p).HPW ?? 70) * 0.0004 * E2_W, 0, 0.004)
  }
  return 0
}
/** E2: deterministic weighted pick by a hash key (no rng draw). */
function hashPick<T>(list: T[], weight: (t: T) => number, key: number): T | undefined {
  if (!list.length) return undefined
  const total = list.reduce((s, t) => s + Math.max(0, weight(t)), 0)
  if (total <= 0) return list[key % list.length]
  let roll = (key / 4294967296) * total
  for (const t of list) {
    const w = Math.max(0, weight(t))
    if (roll < w) return t
    roll -= w
  }
  return list[list.length - 1]
}

function topGroup(world: World, teamId: string, positions: Position[], n: number, qbOverride?: Record<string, string>): Player[] {
  // G6: a halftime QB change replaces the starter until the game ends.
  if (qbOverride && positions.length === 1 && positions[0] === 'QB') {
    const id = qbOverride[teamId]
    if (id) {
      const p = (world.roster[teamId] ?? []).find((x) => x.id === id && !x.injured)
      if (p) return [p]
    }
  }
  return depthGroup(world, teamId, positions, n)
}

/**
 * Sample a yard gain from the real NFL distribution, tilted by how much better
 * or worse the matchup is than league average. `edge` is roughly −25..+25.
 */
function sampleYards(rng: Rng, isPass: boolean, edge: number, stack: string[], yard: number, tier: 'NFL' | 'FBS' = 'NFL'): number {
  const cal = getCalibration(tier)
  const cdf = isPass ? cal.passCdf : cal.runCdf
  let r = rng()
  // Talent tilt: small nudge to the draw, plus a modest yard shift.
  const shift = clamp(edge * 0.0035, -0.08, 0.08)
  r = clamp(r - shift, 0.001, 0.999)
  let bucket = sampleBucket(cdf, r)
  // Red-zone / goal-line makes chunk buckets far less likely.
  if (yard >= 80 && (bucket === '25-49' || bucket === '50+' || bucket === '15-24')) {
    bucket = rng() < 0.5 ? '10-14' : '5-9'
  }
  stack.push(bucket)
  let gain = bucketYards(bucket, rng, isPass)
  // College: damp the long tail so totals match the FBS box score.
  if (tier === 'FBS' && (bucket === '25-49' || bucket === '50+')) {
    gain = Math.round(gain * CFB_CHUNK_DAMP[bucket])
  }
  // Tiny talent nudge, secondary to the real curve.
  gain += Math.round(edge * 0.05)
  return gain
}

// ── Coaching schemes ─────────────────────────────────────────────────────────
export interface Concept {
  name: string
  type: 'run' | 'pass'
  depth: number // intended air yards (pass) or target gap (run)
  yac: number // yards-after-catch appetite 0-1
  /** L11.5 Q1: one-line plain-English description for the moment card. */
  description: string
}

interface OffenseStyle {
  passRate: number
  concepts: Concept[]
}

const OFF_STYLES: Record<string, OffenseStyle> = {
  'Air Raid': {
    passRate: 0.62,
    concepts: [
      { name: 'Four Verticals', type: 'pass', depth: 20, yac: 0.4, description: 'Four receivers go deep: a shot at a big play' },
      { name: 'Y-Cross', type: 'pass', depth: 12, yac: 0.6, description: 'A deep crossing route behind the linebackers' },
      { name: 'Mesh', type: 'pass', depth: 6, yac: 0.8, description: 'Two receivers cross underneath: quick, safe yards' },
      { name: 'Smash', type: 'pass', depth: 11, yac: 0.5, description: 'Corner route over a short curl: beats cover 2' },
      { name: 'RB Screen', type: 'pass', depth: 1, yac: 1.0, description: 'Dump to the back behind blockers: punishes the blitz' },
      { name: 'Inside Zone', type: 'run', depth: 4, yac: 0, description: 'Downhill run between the tackles' },
    ],
  },
  'Pro Style': {
    passRate: 0.5,
    concepts: [
      { name: 'Play Action Deep', type: 'pass', depth: 22, yac: 0.3, description: 'Fake the run, then throw deep' },
      { name: 'PA Cross', type: 'pass', depth: 14, yac: 0.5, description: 'Fake the run, hit a crosser over the middle' },
      { name: 'Bootleg', type: 'pass', depth: 8, yac: 0.7, description: 'QB rolls out away from the run fake' },
      { name: 'Inside Zone', type: 'run', depth: 4, yac: 0, description: 'Downhill run between the tackles' },
      { name: 'Power', type: 'run', depth: 3, yac: 0, description: 'Pulling guard leads a run off tackle' },
    ],
  },
  Spread: {
    passRate: 0.55,
    concepts: [
      { name: 'Four Verts', type: 'pass', depth: 17, yac: 0.4, description: 'Four receivers go deep: a shot at a big play' },
      { name: 'Quick Slant', type: 'pass', depth: 5, yac: 0.9, description: 'One-step slant: ball out fast' },
      { name: 'RPO Bubble', type: 'pass', depth: 2, yac: 1.0, description: 'QB reads the defense: hand off or flip a bubble screen' },
      { name: 'Outside Zone', type: 'run', depth: 5, yac: 0, description: 'Stretch run to the edge' },
      { name: 'QB Draw', type: 'run', depth: 4, yac: 0, description: 'Show pass, then the QB runs up the middle' },
    ],
  },
  'West Coast': {
    passRate: 0.53,
    concepts: [
      { name: 'Mesh', type: 'pass', depth: 6, yac: 0.9, description: 'Two receivers cross underneath: quick, safe yards' },
      { name: 'Slant', type: 'pass', depth: 5, yac: 0.9, description: 'One-step slant: ball out fast' },
      { name: 'RB Screen', type: 'pass', depth: 1, yac: 1.0, description: 'Dump to the back behind blockers: punishes the blitz' },
      { name: 'Bootleg', type: 'pass', depth: 8, yac: 0.7, description: 'QB rolls out away from the run fake' },
      { name: 'Inside Zone', type: 'run', depth: 4, yac: 0, description: 'Downhill run between the tackles' },
    ],
  },
  'RPO Heavy': {
    passRate: 0.47,
    concepts: [
      { name: 'RPO Pass', type: 'pass', depth: 8, yac: 0.8, description: 'QB reads a linebacker, then throws behind him' },
      { name: 'Quick Slant', type: 'pass', depth: 5, yac: 0.9, description: 'One-step slant: ball out fast' },
      { name: 'RPO Run', type: 'run', depth: 4, yac: 0, description: 'QB reads the edge, then hands off or keeps it' },
      { name: 'Inside Zone', type: 'run', depth: 4, yac: 0, description: 'Downhill run between the tackles' },
    ],
  },
}

interface DefenseStyle {
  blitz: number
  manCoverage: number // 0 = zone, 1 = man
  runFit: number // multiplier on run defense
  coverage: number // multiplier on coverage
}

const DEF_STYLES: Record<string, DefenseStyle> = {
  '4-3 Base': { blitz: 0.22, manCoverage: 0.45, runFit: 1.0, coverage: 1.0 },
  '3-4 Base': { blitz: 0.3, manCoverage: 0.35, runFit: 1.06, coverage: 1.0 },
  '4-2-5 Nickel': { blitz: 0.24, manCoverage: 0.55, runFit: 0.9, coverage: 1.08 },
  Multiple: { blitz: 0.29, manCoverage: 0.5, runFit: 1.0, coverage: 1.03 },
  'Blitz Heavy': { blitz: 0.5, manCoverage: 0.7, runFit: 0.94, coverage: 0.98 },
}

export function offStyle(world: World, teamId: string): OffenseStyle {
  const oc = (world.staff[teamId] ?? []).find((s) => s.role === 'Offensive Coordinator')
  return OFF_STYLES[oc?.scheme ?? ''] ?? OFF_STYLES['Pro Style']
}
function defStyle(world: World, teamId: string): DefenseStyle {
  const dc = (world.staff[teamId] ?? []).find((s) => s.role === 'Defensive Coordinator')
  return DEF_STYLES[dc?.scheme ?? ''] ?? DEF_STYLES.Multiple
}
export function coachLabels(world: World, teamId: string) {
  const staff = world.staff[teamId] ?? []
  const oc = staff.find((s) => s.role === 'Offensive Coordinator')
  const dc = staff.find((s) => s.role === 'Defensive Coordinator')
  return {
    oc: oc?.name ?? 'Offense',
    ocScheme: oc?.scheme ?? 'Pro Style',
    dc: dc?.name ?? 'Defense',
    dcScheme: dc?.scheme ?? 'Multiple',
  }
}

// ── Play resolution ──────────────────────────────────────────────────────────
interface PlayOutcome {
  type: Play['type']
  concept: string
  yards: number
  result: string
  turnover: boolean
  scorerId?: string
  scorerName?: string
  carrierId?: string
  targetId?: string
  passDepth?: number
  pressure?: boolean
  bigPlay?: boolean
  timeUsed: number
  // attribution for individual stats
  qbId?: string
  tackleIds?: string[]
  sackId?: string
  intId?: string
  /** L11.5 Q7: coverage defender on the target. */
  coverId?: string
  /** L12 E2: the defender who forced a fumble on a catch (bookkeeping only). */
  fumbleId?: string
}

// ── In-game plan ─────────────────────────────────────────────────────────────
// Set by the store during a live game so player calls bend the sim. Empty plan
// (the default) means AI-vs-AI behaviour for both sides.
export interface LivePlan {
  /** The user's club — the only team whose plans the sim reads. */
  teamId: string
  off: import('./gameplan').GamePlan
  def: import('./gameplan').GamePlan
}
let LIVE_PLAN: LivePlan | null = null
export function setLivePlan(p: LivePlan | null) {
  LIVE_PLAN = p
}
function planFor(teamId: string, side: 'off' | 'def'): import('./gameplan').GamePlan | null {
  if (!LIVE_PLAN || teamId !== LIVE_PLAN.teamId) return null
  return side === 'off' ? LIVE_PLAN.off : LIVE_PLAN.def
}

/** Fold the DC's live plan into coverage tightness, ball-hawking, and risk. */
function applyDefPlan(defId: string, dStyle: DefenseStyle) {
  const plan = planFor(defId, 'def')
  if (!plan) return { compMult: 1, coverMult: 1, intMult: 1, bigPlayRisk: 1 }
  const eff = planEffects(plan, true)
  // Zone (coverage 0) gives up more catches underneath but fewer explosives;
  // press man (2) tightens coverage but risks getting beaten deep.
  const cov = eff.coverageAdj
  const compMult = 1 - (cov - 0.5) * 0.14 // man = lower completion, zone = higher
  const coverMult = 1 + (cov - 0.5) * 0.06
  const intMult = 1 + (cov - 0.5) * 0.5 + (plan.aggression - 0.5) * 0.3
  return { compMult, coverMult, intMult, bigPlayRisk: eff.bigPlayRisk * dStyle.coverage }
}

function pickConcept(rng: Rng, style: OffenseStyle, down: number, distance: number, passAdj = 0): Concept {
  let pool = style.concepts
  const wantPass = rng() < style.passRate + passAdj || (down === 3 && distance > 5)
  const filtered = pool.filter((c) => (wantPass ? c.type === 'pass' : c.type === 'run'))
  if (filtered.length) pool = filtered
  return pool[Math.floor(rng() * pool.length)]
}

// ── L10 G8/G9: tendencies, the call matrix, and the AI's counter-calls ────────

function coordRating(world: World, teamId: string, role: 'Offensive Coordinator' | 'Defensive Coordinator'): number {
  return (world.staff[teamId] ?? []).find((x) => x.role === role)?.rating ?? 74
}

function normalizeDist<T extends string>(dist: Record<T, number>, keys: readonly T[]): Record<T, number> {
  let total = 0
  for (const k of keys) total += Math.max(0, dist[k] ?? 0)
  const out = {} as Record<T, number>
  if (total <= 0) {
    for (const k of keys) out[k] = 1 / keys.length
    return out
  }
  for (const k of keys) out[k] = Math.max(0, dist[k] ?? 0) / total
  return out
}

function weightedPick<T extends string>(rng: Rng, dist: Record<T, number>, keys: readonly T[]): T {
  let total = 0
  for (const k of keys) total += Math.max(0, dist[k] ?? 0)
  if (total <= 0) return keys[0]
  let r = rng() * total
  for (const k of keys) {
    r -= Math.max(0, dist[k] ?? 0)
    if (r <= 0) return k
  }
  return keys[keys.length - 1]
}

/** An AI club's derived tendencies in one bucket (G8): offense class + defensive call. */
export function aiTendency(world: World, teamId: string, bucket: Bucket): { off: Record<OffClass, number>; def: Record<DefCall, number> } {
  const style = offStyle(world, teamId)
  const d = defStyle(world, teamId)
  // pickConcept forces a throw on 3rd & long; otherwise the OC's pass rate rules.
  const pPass = bucket === '3rd-long' ? 1 : clamp(style.passRate, 0, 1)
  let run = 0
  let short = 0
  let deep = 0
  for (const c of style.concepts) {
    if (c.type === 'run') run += 1
    else if (c.depth >= 9) deep += 1
    else short += 1
  }
  const offRaw: Record<OffClass, number> = { run: run * (1 - pPass), short: short * pPass, deep: deep * pPass }
  let blitz = d.blitz
  let stack = Math.max(0, d.runFit - 1) * 4
  if (bucket === '3rd-long') blitz *= 1.35
  if (bucket === 'redzone') stack += 0.15
  const defRaw: Record<DefCall, number> = { blitz, man: d.manCoverage, zone: 1 - d.manCoverage, stack }
  return { off: normalizeDist(offRaw, OFF_CLASSES), def: normalizeDist(defRaw, DEF_CALLS) }
}

/** The user's tendency book, but only when it belongs to this season and club. */
function userBookFor(world: World, s: GameState) {
  const t = s.ctx?.userTeamId
  if (!t) return null
  const ub = world.userBook
  if (!ub || ub.season !== world.season || ub.teamId !== t) return null
  return ub.book
}

/** G8: how hard a coordinator leans on your tendencies (higher-rated DCs exploit more). */
function exploitWeight(rating: number): number {
  return clamp(0.15 + (rating - 60) / 200, 0.1, 0.35)
}

function exploitDefCall(world: World, s: GameState, dist: Record<DefCall, number>, bucket: Bucket, rating: number) {
  const book = userBookFor(world, s)
  if (!book) return
  const top = topKey(book.off[bucket], OFF_CLASSES)
  if (top.total < 8) return
  let sum = 0
  for (const k of DEF_CALLS) sum += Math.max(0, dist[k] ?? 0)
  dist[bestCounterCall(top.key)] += exploitWeight(rating) * sum
}

function exploitOffClass(world: World, s: GameState, dist: Record<OffClass, number>, bucket: Bucket, rating: number) {
  const book = userBookFor(world, s)
  if (!book) return
  const top = topKey(book.def[bucket], DEF_CALLS)
  if (top.total < 8) return
  let sum = 0
  for (const k of OFF_CLASSES) sum += Math.max(0, dist[k] ?? 0)
  dist[bestCounterClass(top.key)] += exploitWeight(rating) * sum
}

/** The AI defense's call, drawn after the user's answer (G9). */
function drawAIDefCall(world: World, s: GameState, defId: string, bucket: Bucket): DefCall {
  const dist = { ...aiTendency(world, defId, bucket).def }
  exploitDefCall(world, s, dist, bucket, coordRating(world, defId, 'Defensive Coordinator'))
  return weightedPick(s.rng, dist, DEF_CALLS)
}

/** The AI offense's class, drawn after the user's defCall (G9). */
function drawAIOffClass(world: World, s: GameState, offId: string, bucket: Bucket): OffClass {
  const dist = { ...aiTendency(world, offId, bucket).off }
  exploitOffClass(world, s, dist, bucket, coordRating(world, offId, 'Offensive Coordinator'))
  return weightedPick(s.rng, dist, OFF_CLASSES)
}

function pickConceptOfClass(rng: Rng, style: OffenseStyle, cls: OffClass): Concept {
  const list = style.concepts.filter((c) => offClassFor(c.type, c.depth) === cls)
  const pool = list.length ? list : style.concepts
  return pool[Math.floor(rng() * pool.length)]
}

/** G9: the user's three call cards — the first run, short pass, and deep pass. */
function callCards(style: OffenseStyle): Concept[] {
  const cards: Concept[] = []
  const add = (c: Concept | undefined) => { if (c && !cards.includes(c)) cards.push(c) }
  add(style.concepts.find((c) => c.type === 'run'))
  add(style.concepts.find((c) => c.type === 'pass' && c.depth <= 8))
  add(style.concepts.find((c) => c.type === 'pass' && c.depth >= 9))
  for (const c of style.concepts) {
    if (cards.length >= 3) break
    add(c)
  }
  return cards.slice(0, 3)
}

function downDistance(down: number, distance: number, yard: number): string {
  const suf = down === 1 ? 'st' : down === 2 ? 'nd' : down === 3 ? 'rd' : 'th'
  const yd = yard >= 50 ? `their ${100 - yard}` : `your ${yard}`
  return `${down}${suf} & ${distance} at ${yd}`
}

/** G8: the scouted read shown on a card (fuzzy ±15%, sharp ±5%). */
/** Read-line verbs for a defense's habit (the DEF_CALL_LABELs stay as button text). */
const DEF_VERB: Record<DefCall, string> = { blitz: 'blitz', man: 'play man coverage', zone: 'play zone coverage', stack: 'stack the box' }

/** L11.5 Q1: one-line description of each defensive call for the moment card. */
const DEF_CALL_DESC: Record<DefCall, string> = {
  blitz: 'Send extra rushers — pressure, but risk the big play',
  man: 'Man coverage — tight on the receivers, back to the ball',
  zone: 'Zone coverage — keep everything in front',
  stack: 'Stack the box — sell out to stop the run',
}

function tendencyRead(world: World, s: GameState, oppId: string, side: 'off' | 'def', bucket: Bucket): string {
  const read = s.ctx?.oppRead
  if (!read || read.week !== world.week || read.oppId !== oppId) return 'No scouting read — buy Opponent film to see their tendencies'
  const span = read.sharp ? 0.05 : 0.15
  const rng = makeRng(world.seed + world.week * 31 + hash32(oppId + bucket, 9))
  if (side === 'def') {
    const top = topKey(aiTendency(world, oppId, bucket).def, DEF_CALLS)
    const pct = clamp(top.share + (rng() * 2 - 1) * span, 0, 1)
    return `They ${DEF_VERB[top.key]} ${Math.round(pct * 100)}% of the time on ${BUCKET_LABEL[bucket]}`
  }
  const top = topKey(aiTendency(world, oppId, bucket).off, OFF_CLASSES)
  const pct = clamp(top.share + (rng() * 2 - 1) * span, 0, 1)
  return `They ${OFF_CLASS_LABEL[top.key]} ${Math.round(pct * 100)}% of the time on ${BUCKET_LABEL[bucket]}`
}

/** L10 F2: how much a pass-leaning user plan is read by the defense, per point of passBias. */
const PASS_LEAN_PRESSURE = 4
const PASS_LEAN_COMP = 0.024
const PASS_LEAN_EDGE = 0.6

/** Per-step sim context for the L10 G6/G7 halftime and two-minute effects. */
interface SimEnv {
  adjust: Record<string, string[]>
  qbOverride: Record<string, string>
  down: number
  intMult: number
  /** L10 G11/G12: current quarter, the user's club, and their matchup/usage settings. */
  qtr: number
  /** L12 S3: seconds left in the quarter (deterministic, for out-of-bounds credit). */
  clock?: number
  userTeamId?: string
  matchups?: MatchupSet
  usage?: UsageSet
}

function hasFix(env: SimEnv | undefined, teamId: string, fix: string): boolean {
  return !!env?.adjust[teamId]?.includes(fix)
}

/**
 * L11.5 Q7: the coverage defender on the target. Purely deterministic — it reads
 * the target's slot in the receiver group and the throw depth, so it never draws
 * rng and cannot move the sim's calibration or the paused/full equivalence.
 */
function coverDefender(target: Player | undefined, concept: Concept, wrs: Player[], cbs: Player[], saf: Player[], lbs: Player[]): string | undefined {
  if (!target) return undefined
  const pick = (list: Player[], slot: number) => (list.length ? list[slot % list.length] : undefined)
  const slot = Math.max(0, wrs.findIndex((w) => w.id === target.id))
  if (target.pos === 'TE' || target.pos === 'RB') return pick(lbs, slot)?.id
  if (concept.depth >= 15) return pick(saf, slot)?.id
  return pick(cbs, slot)?.id ?? pick(saf, slot)?.id
}

/** A sack (not a completion for a loss, which also has negative yards). */
export function isSack(p: { type: string; result: string }): boolean {
  return p.type === 'pass' && p.result.startsWith('Sack')
}

/** L12 S1: softmax temperature for target share, and the RB checkdown role prior. */
/** L12 S1 tuning: softmax temperature, RB checkdown prior, and how much tighter a 2nd/3rd read is. */
export const TARGET_TUNE = { tau: 160, rbPrior: -34, readPenalty: 0, rbYds: 0.55, teYds: 0.85 }

/**
 * L12 S3: the single tackler on a run, weighted LB/DL/S/CB with the mix shifting
 * toward the secondary on big gains and the front on losses. Deterministic hash
 * of the play number — never an rng draw.
 */
function runTackler(n: number, defId: string, gain: number, lbs: Player[], dl: Player[], saf: Player[], cbs: Player[]): string | undefined {
  const w = { lb: 45, dl: 25, s: 20, cb: 10 }
  if (gain >= 10) { w.lb -= 10; w.s += 6; w.cb += 4 }
  else if (gain <= 0) { w.dl += 12; w.lb -= 12 }
  const groups: [Player[], number][] = [[lbs, w.lb], [dl, w.dl], [saf, w.s], [cbs, w.cb]]
  const valid = groups.filter(([list, wt]) => list.length > 0 && wt > 0)
  if (!valid.length) return undefined
  const total = valid.reduce((a, [, wt]) => a + wt, 0)
  let roll = (hash32(`${n}:${defId}:run`) / 4294967296) * total
  let group = valid[valid.length - 1][0]
  for (const [list, wt] of valid) {
    if (roll < wt) { group = list; break }
    roll -= wt
  }
  return group[hash32(`${n}:${defId}:runtackle`) % group.length]?.id
}

/**
 * L12 S3: the single tackler on a completion — the coverage defender 55%, a
 * safety 25%, a linebacker 20%. Deterministic hash of the play number.
 */
function passTackler(n: number, defId: string, coverId: string | undefined, saf: Player[], lbs: Player[]): string | undefined {
  const roll = hash32(`${n}:${defId}:passtackle`) % 100
  if (roll < 55 && coverId) return coverId
  if (roll < 80 && saf.length) return saf[hash32(`${n}:${defId}:safety`) % saf.length]?.id
  if (lbs.length) return lbs[hash32(`${n}:${defId}:linebacker`) % lbs.length]?.id
  return coverId ?? saf[0]?.id ?? lbs[0]?.id
}

function resolvePass(world: World, rng: Rng, offId: string, defId: string, concept: Concept, yard: number, passShare = 0.57, tier: 'NFL' | 'FBS' = 'NFL', clutch = 0, env?: SimEnv, call?: CallEffect, n = 0): PlayOutcome {
  const ocEff = ocEffect(world, offId)
  const dcEff = ocEffect(world, defId)
  // L10 G11/G12: matchup and workload effects apply to the user's club only, so
  // AI-vs-AI snaps never see them.
  const userTeamId = env?.userTeamId
  const userOff = !!userTeamId && userTeamId === offId
  const userDef = !!userTeamId && userTeamId === defId
  const offMove = userOff ? env?.matchups?.off : undefined
  const defMove = userDef ? env?.matchups?.def : undefined
  const usage = env?.usage
  const qb = topGroup(world, offId, ['QB'], 1, env?.qbOverride)[0]
  // G11 doubleRusher: chipping the best rusher also keeps a back in to block,
  // so the target pool drops to the top three receivers.
  const wrs = topGroup(world, offId, ['WR', 'TE'], offMove === 'doubleRusher' ? 3 : 4)
  const ol = topGroup(world, offId, ['OT', 'OG', 'C'], 5)
  const rb = topGroup(world, offId, ['RB'], 1)[0]
  const dl = topGroup(world, defId, ['DE', 'DT'], 4)
  const lbs = topGroup(world, defId, ['LB'], 3)
  const cbs = topGroup(world, defId, ['CB'], 3)
  const saf = topGroup(world, defId, ['S'], 2)
  const dStyle = defStyle(world, defId)
  const ocScheme = (world.staff[offId] ?? []).find((s) => s.role === 'Offensive Coordinator')?.scheme

  // ── L12 E2: unit-level relative ratings (centered; no rng) ──────────────────
  const isQ4 = (env?.qtr ?? 0) >= 4
  const olStrRel = avg(ol.map((p) => rmean(p.pos, 'STR', mkAttrs(p).STR ?? 70)))
  const recog = recognition(dl, lbs, saf)

  const qbA = qb ? mkAttrs(qb) : {}
  const qbStyle = qb ? styleProfile(qb) : styleProfile({ traits: [''] } as Player)
  const qbFit = qb ? schemeFit(qb, ocScheme, 'OFF') : 0.5
  const pressureVals = dl.map((p) => Math.max(mkAttrs(p).PMV ?? 70, mkAttrs(p).FMV ?? 70))
  // G11 doubleRusher: chip their best rusher — he counts at half.
  if (offMove === 'doubleRusher' && pressureVals.length) {
    let best = 0
    for (let i = 1; i < pressureVals.length; i++) if (pressureVals[i] > pressureVals[best]) best = i
    pressureVals[best] *= 0.5
  }
  let pressure = avg(pressureVals)
  // L12 E2: DL quickness/power joins the rush; a tired front loses push in Q4.
  pressure += dlRushExtras(dl, olStrRel) * E2_W
  if (isQ4) pressure += relAvg('STA', dl) * 0.12 * E2_W
  // G11 spyQB spends a rusher (−4); G12 DL rotation trades pressure by quarter.
  if (defMove === 'spyQB') pressure -= 4
  if (usage && userDef) {
    const q4 = (env?.qtr ?? 0) >= 4
    if (usage.dl === 'starters') {
      if (q4) pressure -= 3
    } else if (usage.dl === 'rotate') {
      pressure += q4 ? 1.5 : -1.5
    }
  }
  const protection = avg(ol.map((p) => mkAttrs(p).PBK ?? 70)) - (isQ4 ? relAvg('STA', [...ol, qb]) * 0.08 * E2_W : 0)
  const defPlan = planFor(defId, 'def')
  // G6 third-down heat: extra blitz on the opponent's 3rd downs.
  const heat = hasFix(env, defId, 'thirdDownHeat') && env?.down === 3 ? 0.15 : 0
  const blitzRoll = rng()
  const blitz = blitzRoll < clamp(dStyle.blitz + (defPlan ? planEffects(defPlan, true).blitz : 0) + heat, 0, 0.8)
  // L12 E2: a blitz brings the linebackers' rush into the pressure.
  if (blitz) pressure += lbBlitzRush(lbs) * 0.3 * E2_W
  // A pass-heavy plan is predictable: the defense pins its ears back and sits
  // on the throws (balances the passing game's natural edge over the run).
  const passLean = Math.max(0, planFor(offId, 'off')?.passBias ?? 0)
  const pressureEdge = pressure - protection + (blitz ? 9 * (1 - olBlitzAware(ol)) : 0) + (concept.depth > 15 ? 4 : 0) - ocEff.offEdge * 0.5 + dcEff.defEdge * 0.5
    + (defPlan && defPlan.aggression >= 1.5 ? 3 : 0) + passLean * PASS_LEAN_PRESSURE
  // Real rate is ~6.9% of dropbacks (NFL) / higher pressure in college; scaled by pass share.
  // G6 max protect: sacks give up 40% less often.
  const protectMult = hasFix(env, offId, 'maxProtect') ? 0.6 : 1
  const sackChance = clamp((0.069 + pressureEdge * 0.0012) * (passShare) * (tier === 'FBS' ? 0.75 : 1) * protectMult * (call?.sackMult ?? 1) * (1 - qbSackEscape(qbA)), 0.02, 0.13)

  // Target selection (L12 S1): a scheme-fitting, style-appropriate receiver gets
  // more looks, but the ball is spread by a softmax draw over those scores rather
  // than an argmax. No rng draw is added or removed: the scored map keeps its one
  // draw per receiver, and the highest-scored receiver's own draw is reused as the
  // uniform. RB1 joins the pool as a checkdown with a role prior (no draw).
  const scored = wrs.map((w) => {
    const a = mkAttrs(w)
    const st = styleProfile(w)
    const longBall = concept.depth >= 12
    const route = longBall ? (a.DRR ?? w.ovr) : concept.depth >= 7 ? (a.MRR ?? w.ovr) : (a.SRR ?? w.ovr)
    const styleBonus = longBall ? st.deepBias * 14 : st.yacBias * 10 + st.contested * 6
    const fit = schemeFit(w, ocScheme, 'OFF')
    const r = rng()
    return { w, score: route * 0.6 + (a.SPD ?? w.ovr) * 0.25 + styleBonus + (fit - 0.5) * 16 + r * 12, r }
  })
  if (rb && !scored.some((s) => s.w.id === rb.id)) {
    const a = mkAttrs(rb)
    const longBall = concept.depth >= 12
    const route = longBall ? (a.DRR ?? rb.ovr) : concept.depth >= 7 ? (a.MRR ?? rb.ovr) : (a.SRR ?? rb.ovr)
    scored.push({ w: rb, score: route * 0.6 + (a.SPD ?? rb.ovr) * 0.25 + TARGET_TUNE.rbPrior, r: -1 })
  }
  scored.sort((a, b) => b.score - a.score)
  const maxScore = scored[0]?.score ?? 0
  const weights = scored.map((s) => Math.exp((s.score - maxScore) / TARGET_TUNE.tau))
  const totalW = weights.reduce((x, y) => x + y, 0) || 1
  // Uniform from the existing per-receiver draws: their sum mod 1 is uniform and
  // nearly independent of the ranking (reusing one receiver's own draw is biased).
  // No rng draw is added.
  const drawSum = scored.reduce((acc, x) => acc + (x.r >= 0 ? x.r : 0), 0)
  const uniform = drawSum - Math.floor(drawSum)
  let accW = 0
  let target = scored[0]?.w ?? rb
  let readRank = 0
  for (let i = 0; i < scored.length; i++) {
    accW += weights[i] / totalW
    if (uniform < accW) { target = scored[i].w; readRank = i; break }
  }
  const tA = target ? mkAttrs(target) : {}
  const tStyle = target ? styleProfile(target) : styleProfile({ traits: [''] } as Player)
  // Q7: pick the coverage defender now, from the same groups, with no rng draw.
  const coverId = coverDefender(target, concept, wrs, cbs, saf, lbs)

  if (rng() < sackChance) {
    const y = -Math.round(6 + rng() * 6)
    // Always consume the DL pick draw so the rng stream is unchanged.
    const dlPick = dl[rng() < 0.5 ? 0 : Math.min(1, dl.length - 1)]?.id
    // L12 S3: on a blitz sack, 30% of the time a linebacker gets the credit
    // (deterministic hash of the play number).
    const blitzLb = blitz && lbs.length && hash32(`${n}:${defId}:blitzsack`) % 100 < 55
      ? lbs[hash32(`${n}:${defId}:blitzlb`) % lbs.length]?.id
      : undefined
    const sackId = blitzLb ?? dlPick
    return { type: 'pass', concept: concept.name, yards: y, result: blitz ? 'Sack (blitz)' : 'Sack', turnover: false, pressure: true, timeUsed: 24 + Math.floor(rng() * 12), qbId: qb?.id, sackId, coverId }
  }

  const qAccuracy = (qbA.SAC ?? 70) * 0.3 + (qbA.MAC ?? 70) * 0.3 + (qbA.DAC ?? 70) * 0.25 + (qbA.AWR ?? 70) * 0.15
  // E1: the coverage defender, for the release-vs-press term (no rng draw).
  const coverPlayer = coverId ? [...cbs, ...saf, ...lbs].find((p) => p.id === coverId) : undefined
  const separation =
    (concept.depth > 14 ? (tA.DRR ?? 70) : concept.depth > 7 ? (tA.MRR ?? 70) : (tA.SRR ?? 70)) * 0.5 +
    (tA.SPD ?? 70) * 0.3 +
    (tA.AGI ?? 70) * 0.2 +
    tStyle.deepBias * (concept.depth >= 12 ? 6 : -2) -
    Math.min(readRank, 3) * TARGET_TUNE.readPenalty +
    qbDeepThp(qbA, concept.depth) +
    targetAccCod(target, tA) +
    releaseVsPress(target, tA, coverPlayer, dStyle.manCoverage, concept.depth)
  const cbMcv = cbs.map((p) => mkAttrs(p).MCV ?? 70)
  const zoneCov = avg([...cbs, ...lbs, ...saf].map((p) => mkAttrs(p).ZCV ?? 70))
  // G11 targetWeakCB: on 35% of passes the coverage keys their weakest corner
  // (and the safety help raises the interception risk on those throws).
  let manCov = avg(cbMcv)
  let weakCb = false
  if (offMove === 'targetWeakCB' && cbMcv.length) {
    weakCb = rng() < 0.35
    if (weakCb) manCov = Math.min(...cbMcv)
  }
  // L12 E2: RB/TE targets are covered by linebackers, so their MCV joins man.
  if (target && (target.pos === 'TE' || target.pos === 'RB')) manCov += relAvg('MCV', lbs) * 0.35 * E2_W
  let coverSkill = dStyle.manCoverage * manCov + (1 - dStyle.manCoverage) * zoneCov
  // G11 shadowWR1: your CB1 trails their WR1; help over the top on everyone else.
  if (defMove === 'shadowWR1') {
    const wr1 = topGroup(world, offId, ['WR'], 1)[0]
    if (wr1 && target && target.id === wr1.id) coverSkill = (cbMcv.length ? cbMcv[0] : 70) * 1.05
    else coverSkill *= 0.96
  }
  const planOverrides = applyDefPlan(defId, dStyle)
  // G6 fixes: load-the-box loosens coverage; two-deep gives up the underneath but
  // caps explosives; third-down heat concedes more explosives on 3rd down.
  const compMult = planOverrides.compMult * (hasFix(env, defId, 'twoDeep') ? 1.04 : 1)
  let bigPlayRisk = planOverrides.bigPlayRisk * (hasFix(env, defId, 'twoDeep') ? 0.85 : 1) * (heat ? 1.1 : 1)
  // L12 E2: press coverage risks a deep shot if the receiver wins; a fast safety caps it.
  if (concept.depth >= 15) {
    bigPlayRisk *= clamp(1 + (relAvg('PRS', cbs) * 0.004 - relAvg('SPD', saf) * 0.003) * E2_W, 0.6, 1.5)
  }
  let coverage = coverSkill * dStyle.coverage * planOverrides.coverMult * (hasFix(env, defId, 'loadTheBox') ? 0.96 : 1) + avg(saf.map((p) => mkAttrs(p).AWR ?? 70)) * 0.08
  // L12 E2: secondary athleticism joins coverage; good recognition covers screens;
  // a tired defense loses a step in Q4.
  coverage += dbCoverageExtras(cbs, saf) * E2_W
  if (concept.depth <= 2 && concept.yac >= 0.8) coverage += recog * 0.4 * E2_W
  if (isQ4) coverage += relAvg('STA', [...cbs, ...saf, ...lbs, ...dl]) * 0.12 * E2_W
  const edge = qAccuracy + separation - coverage * 1.15 - concept.depth * 0.5 - 145 // centered ~0
  // Play-action: a run-heavy offense gets a passing bonus as the defense bites.
  const offPassBias = planFor(offId, 'off')?.passBias ?? 0
  // E1: QB play-action rating scales the existing bonus; E2: good recognition beats it.
  const pacMult = qbPacMult(qbA)
  const recogMult = clamp(1 - recog * 0.004 * E2_W, 0.6, 1.4)
  const playAction = offPassBias < 0 ? Math.min(2.2, -offPassBias * 1.5) * pacMult * recogMult : 0
  // G11 spyQB: a quarterback spy erases the QB run/pass conflict on those calls.
  const spyPenalty = defMove === 'spyQB' && /QB Draw|RPO/.test(concept.name) ? 3 : 0
  const talentEdge = (edge / 4) + (qAccuracy - 72) * 0.4 + (qbFit - 0.5) * 10 + (famMult(qb) - 1) * 90 + playAction - passLean * PASS_LEAN_EDGE + (call?.edge ?? 0) * 1.5 - spyPenalty

  // Completion probability based on real league rate vs. this matchup. Coordinator
  // quality shifts it: a great OC helps, a great DC hurts.
  const coachShift = (ocEff.offEdge - dcEff.defEdge) * 0.003
  const playActionComp = offPassBias < 0 ? Math.min(0.02, -offPassBias * 0.01) * pacMult * recogMult : 0
  // E1: a receiver's hands (CTH/CIT/SPC/JMP) move the completion a little; tight coverage is when
  // the defense's coverage edge beats the route.
  const tightCoverage = coverage * 1.15 > qAccuracy + separation
  let compProb = clamp(
    (0.645 + (qAccuracy + separation - coverage * 1.15 - concept.depth * 0.7 - Math.max(0, pressureEdge) * 0.5 * (1 - qbPressureRelief(qbA))) / 900 - (tier === 'FBS' ? 0.02 : 0) + coachShift) * mod(defMove === 'spyQB' ? qbStyle.scramble * 0.5 : qbStyle.scramble, 0.04) * compMult + clutch * 0.012 + playActionComp - passLean * PASS_LEAN_COMP + (call?.edge ?? 0) * 0.012 + targetCatchProb(target, tA, concept.depth, tightCoverage),
    0.42,
    0.74,
  )
  // G6 quick game: short concepts complete a touch more. Max protect costs a
  // deep concept a target (slightly lower completion).
  if (hasFix(env, offId, 'quickGame') && concept.depth <= 8) compProb = clamp(compProb + 0.03, 0.42, 0.74)
  if (hasFix(env, offId, 'maxProtect') && concept.depth >= 12) compProb = clamp(compProb - 0.03, 0.42, 0.74)
  // G7 hurry: a faster offense forces riskier throws.
  // L12 E2: JMP/PRC replace part of the trait-only ball-hawk in the pick rate.
  const ratingHawk = avg([...cbs, ...saf].map((p) => {
    const a = mkAttrs(p)
    return (rmean(p.pos, 'JMP', a.JMP ?? 70) * 0.5 + rmean(p.pos, 'PRC', a.PRC ?? 70) * 0.5) * 0.01
  }))
  const intProb = clamp(0.014 * (1 - (qAccuracy - coverage) / 300) * (1 - avg(saf.map((p) => styleProfile(p).ballHawk)) * 0.15 - ratingHawk * E2_W) * planOverrides.intMult * (1 - clutch * 0.03) * (env?.intMult ?? 1) * (weakCb ? 1.15 : 1) * qbIntMult(qbA, concept.depth), 0.005, 0.06)

  if (rng() < intProb) {
    // L12 S3/E2: the coverage defender takes the pick most often, otherwise the
    // best ball-hawk by JMP/PRC plus the trait bonus. Deterministic (no rng).
    const dbPool = [...cbs, ...saf]
    const hawkWeight = (p: Player) => {
      const a = mkAttrs(p)
      return Math.max(1, (a.JMP ?? 70) * 0.4 + (a.PRC ?? 70) * 0.6 + styleProfile(p).ballHawk * 30) * (p.pos === 'S' ? 2 : 1)
    }
    const ir = hash32(`${n}:${defId}:int`) % 100
    // A linebacker in coverage holds on to fewer picks; a deep safety holds more.
    const coverIsLb = !!coverId && lbs.some((p) => p.id === coverId)
    const coverIsS = !!coverId && saf.some((p) => p.id === coverId)
    const fallback = hashPick(dbPool, hawkWeight, hash32(`${n}:${defId}:inthawk`))?.id
    const takeCover = !!coverId && (coverIsLb ? ir < 32 : coverIsS ? ir < 80 : ir < 42)
    const intId = takeCover ? coverId : fallback
    return {
      type: 'pass', concept: concept.name, yards: 0, result: 'Interception!', turnover: true,
      timeUsed: 22 + Math.floor(rng() * 12), pressure: pressureEdge > 6, qbId: qb?.id, intId, coverId,
      targetId: target?.id,
    }
  }
  if (rng() < compProb) {
    const gains: string[] = []
    const catchSkill = (tA.CTH ?? 70) * 0.5 + (tA.SPC ?? 70) * 0.2 + (tA.BTK ?? 70) * 0.3 + tStyle.contested * 8
    let gain = sampleYards(rng, true, talentEdge + (catchSkill - 72), gains, yard, tier)
    // Live defensive plan bends the explosive part of a play: soft zone caps
    // them, press man risks them. Underneath gains are left alone.
    if (gain > 15) gain = 15 + Math.round((gain - 15) * bigPlayRisk)
    // Style-driven YAC: playmakers and elusive receivers add yards after the catch.
    if (gain > 0) gain += Math.round(tStyle.yacBias * 2.5 * (0.5 + rng()) + tStyle.elusiveness * (1 + rng() * 3))
    if (yard >= 88) gain += 4
    else if (yard >= 80) gain += 2
    // L12 S1: checkdowns and tight-end throws are underneath targets — scale their
    // yards to NFL yards-per-target (RB ~5.5, TE ~7) instead of the route model's.
    if (target?.pos === 'RB' && gain > 0) gain = Math.round(gain * TARGET_TUNE.rbYds)
    else if (target?.pos === 'TE' && gain > 0) gain = Math.round(gain * TARGET_TUNE.teYds)
    gain = clamp(gain, -8, 85)
    // L12 S3: a completion is stopped by one defender — the coverage defender most
    // often, support otherwise. No credit on a score or a late sideline catch.
    const late = (env?.qtr ?? 0) >= 4 && (env?.clock ?? 9999) <= 120
    const outOfBounds = late && hash32(`${n}:${offId}:oob`) % 100 < 35
    const stopped = yard + gain < 100 && !outOfBounds ? passTackler(n, defId, coverId, saf, lbs) : undefined
    const tacklerGroups = [cbs, saf, lbs]
    // L12 E2: a strong tackler cuts the YAC short.
    if (stopped && gain > 0) gain = Math.max(-4, gain - tacklerYacShrink(stopped, tacklerGroups))
    const big = gain >= 25
    // L12 E2: a big hitter can jar the ball loose on the stop. Reuses this play's
    // time draw (no new rng) and only fires on a tackle, never on a score.
    const tu = rng()
    const forceFumble = !!stopped && gain > 0 && yard + gain < 100 && tu < tacklerHitPower(stopped, tacklerGroups)
    return {
      type: 'pass', concept: concept.name, yards: gain,
      result: forceFumble ? 'Fumble!' : big ? 'Explosive play!' : 'Complete',
      turnover: forceFumble, carrierId: target?.id, targetId: target?.id, passDepth: concept.depth, bigPlay: !forceFumble && big,
      fumbleId: forceFumble ? stopped : undefined,
      timeUsed: 24 + Math.floor(tu * 16), qbId: qb?.id, coverId, tackleIds: stopped ? [stopped] : undefined,
    }
  }
  return { type: 'pass', concept: concept.name, yards: 0, result: 'Incomplete', turnover: false, targetId: target?.id, passDepth: concept.depth, pressure: pressureEdge > 6, timeUsed: 20 + Math.floor(rng() * 14), qbId: qb?.id, coverId }
}

function resolveRun(world: World, rng: Rng, offId: string, defId: string, concept: Concept, distance: number, yard: number, tier: 'NFL' | 'FBS' = 'NFL', clutch = 0, env?: SimEnv, call?: CallEffect, n = 0): PlayOutcome {
  const ocEff = ocEffect(world, offId)
  const dcEff = ocEffect(world, defId)
  // L10 G11/G12: matchup and workload effects apply to the user's club only.
  const userTeamId = env?.userTeamId
  const userOff = !!userTeamId && userTeamId === offId
  const userDef = !!userTeamId && userTeamId === defId
  const defMove = userDef ? env?.matchups?.def : undefined
  const usage = env?.usage
  const rb = topGroup(world, offId, ['RB'], 2)
  void dcEff
  const qb = topGroup(world, offId, ['QB'], 1)[0]
  const ol = topGroup(world, offId, ['OT', 'OG', 'C'], 5)
  const te = topGroup(world, offId, ['TE'], 1)[0]
  const dl = topGroup(world, defId, ['DE', 'DT'], 4)
  const lbs = topGroup(world, defId, ['LB'], 3)
  const saf = topGroup(world, defId, ['S'], 2)
  const cbs = topGroup(world, defId, ['CB'], 3)
  const dStyle = defStyle(world, defId)
  const ocScheme = (world.staff[offId] ?? []).find((s) => s.role === 'Offensive Coordinator')?.scheme
  // L12 E2: Q4 fatigue uses each unit's relative STA (centered; no rng).
  const isQ4 = (env?.qtr ?? 0) >= 4
  // L12 S2: split carries RB1 / RB2 / QB from deterministic role weights, shifted
  // by the user's usage, a mobile QB, and short yardage. The pick is a hash of
  // (play.n, offId) — never an rng draw. QB runs use his own legs for elusiveness.
  let runEdgeBonus = 0
  let w1 = 0.6
  let w2 = 0.27
  let wq = 0.13
  // G12 workload (user only): 'feature' rides RB1 harder (+1 edge); 'committee'
  // keeps its original draw — RB2 takes 40% of carries and RB1 is fresh in the 4th.
  let committeePick: Player | undefined
  if (userOff && usage) {
    if (usage.rb === 'feature') {
      w1 += 0.15
      runEdgeBonus = 1
    } else if (usage.rb === 'committee') {
      if (rb[1] && rng() < 0.4) committeePick = rb[1]
      else {
        committeePick = rb[0]
        if ((env?.qtr ?? 1) >= 4) runEdgeBonus = 1
      }
    }
  }
  const qbStyle = qb ? styleProfile(qb) : undefined
  if (qbStyle) wq += qbStyle.scramble * 0.12
  if (distance <= 2) w1 += 0.12
  if (!rb[1]) { w1 += w2; w2 = 0 }
  if (!qb) { w2 += wq; wq = 0 }
  const wTot = w1 + w2 + wq || 1
  const roll = hash32(`${n}:${offId}`) / 4294967296
  let carrier = rb[0]
  if (committeePick) carrier = committeePick
  else if (roll < w1 / wTot) carrier = rb[0]
  else if (roll < (w1 + w2) / wTot && rb[1]) carrier = rb[1]
  else if (qb) carrier = qb
  else if (rb[1]) carrier = rb[1]
  const cA = carrier ? mkAttrs(carrier) : {}
  const cStyle = carrier ? styleProfile(carrier) : styleProfile({ traits: [''] } as Player)
  const cFit = carrier ? schemeFit(carrier, ocScheme, 'OFF') : 0.5

  const runBlock = avg(ol.map((p) => (mkAttrs(p).RBK ?? 70) * 0.7 + (mkAttrs(p).IMP ?? 70) * 0.3)) + teRunBlock(te)
  const runDefBase = avg(dl.map((p) => (mkAttrs(p).BSH ?? 70) * 0.5 + (mkAttrs(p).TAK ?? 70) * 0.5)) * dStyle.runFit
  // The live defensive plan moves the front: stacking the box stops the run,
  // a soft-zone light box gives a little back on the ground.
  const dp = planFor(defId, 'def')
  // G6 load the box: an extra 8% run defense, paid for by looser coverage.
  const boxMult = hasFix(env, defId, 'loadTheBox') ? 1.08 : 1
  const runDef = ((dp
    ? runDefBase * (1 + (dp.aggression - 0.5) * 0.06 - (dp.coverage <= 0 ? 0.03 : 0))
    : runDefBase) * boxMult) + relAvg('STR', dl) * 0.05 * E2_W
  const lbsDef = avg(lbs.map((p) => (mkAttrs(p).TAK ?? 70) * 0.6 + (mkAttrs(p).PUR ?? 70) * 0.4)) + lbRunExtras(lbs) * E2_W
  const elusiveness = carrier?.pos === 'QB'
    ? (cA.SPD ?? 70) * 0.5 + (cA.AGI ?? 70) * 0.4 + (cA.BCV ?? 70) * 0.1 + rmean('QB', 'RUN', cA.RUN ?? 70) * 0.4 * E2_W
    : (cA.BCV ?? 70) * 0.35 + (cA.JKM ?? 70) * 0.2 + (cA.TRK ?? 70) * 0.25 + (cA.SPD ?? 70) * 0.2 + rbElusivenessExtras(carrier?.pos, cA)

  // Real NFL run distribution, tilted by line + back vs. front seven, plus back style.
  const styleEdge = cStyle.power * 14 + cStyle.elusiveness * 10 + (cFit - 0.5) * 12
  // A pass-heavy offense runs against lighter boxes — make them pay on the ground.
  const offPassBiasRun = planFor(offId, 'off')?.passBias ?? 0
  const boxLight = Math.max(0, offPassBiasRun) * 1.8
  // G6 quick game: throwing it quick comes at the expense of the run game.
  const quickRunCost = hasFix(env, offId, 'quickGame') ? -2 : 0
  // G11 spyQB: a quarterback spy erases the QB run/pass conflict on those calls.
  const spyPenalty = userDef && defMove === 'spyQB' && /QB Draw|RPO/.test(concept.name) ? 3 : 0
  const edge = (runBlock - 72) * 0.7 + (elusiveness - 72) * 0.6 - (runDef - 72) * 0.5 - (lbsDef - 72) * 0.3 + styleEdge + ocEff.offEdge * 2 - dcEff.defEdge * 2 + (famMult(carrier) - 1) * 40 + clutch * 1.4 + boxLight + quickRunCost + runEdgeBonus - spyPenalty + olShortStrength(ol, distance) + (call?.edge ?? 0) * 1.6
    + (isQ4 ? (relAvg('STA', [qb, ...ol, carrier]) - relAvg('STA', [...dl, ...lbs, ...saf, ...cbs])) * 0.12 * E2_W : 0)
  const gains: string[] = []
  const runGain = sampleYards(rng, false, edge * 0.25, gains, yard, tier)
  // College front sevens miss more tackles; keep the curve but soften the negative tail.
  let gain = tier === 'FBS' && runGain < 0 ? Math.round(runGain * 0.7) : runGain
  if (distance <= 2) gain += (rng() < 0.35 ? 2 : 1) + Math.round(cStyle.power * 1.5)
  gain += rbAfterContact(carrier?.pos, cA, gain)
  if (yard >= 95) gain += 4
  else if (yard >= 88) gain += 2
  gain = clamp(gain, -10, 90)
  // L12 E2: pursuit (DL/LB PUR + SPD) caps the long-run tail.
  if (gain > 20) gain = 20 + Math.round((gain - 20) * clamp(1 - runPursuit(dl, lbs) * 0.004 * E2_W, 0.55, 1.4))
  const isBig = gain >= 20
  const fumble = rng() < 0.011 * (1 - cStyle.power * 0.2) * rbCarrySecurity(carrier?.pos, cA)
  // L12 S3: exactly one tackler, chosen by gain from a positional mix (no rng).
  const tackler = fumble ? undefined : runTackler(n, defId, gain, lbs, dl, saf, cbs)
  const tackleIds = tackler ? [tackler] : []
  return {
    type: 'run', concept: concept.name, yards: gain, result: isBig ? 'Big run!' : 'Rush',
    turnover: fumble, carrierId: carrier?.id, bigPlay: isBig,
    timeUsed: 30 + Math.floor(rng() * 14), qbId: undefined, tackleIds,
  }
}

function resolveSpecial(world: World, rng: Rng, offId: string, type: 'punt' | 'fg', yard: number, env?: SimEnv, margin = 0): PlayOutcome {
  if (type === 'fg') {
    const k = topGroup(world, offId, ['K'], 1)[0]
    const kA = k ? mkAttrs(k) : {}
    const dist = 100 - yard + 17
    // L12 E2: an aware kicker is steadier in a one-score fourth quarter.
    const late = (env?.qtr ?? 0) >= 4 && Math.abs(margin) <= 3
    const power = (kA.KPW ?? 78) * 0.5 + (kA.KAC ?? 78) * 0.5 + (late ? rmean('K', 'AWR', kA.AWR ?? 70) * 0.25 * E2_W : 0)
    const good = rng() < fgProb(yard, power)
    return {
      type: 'fg', concept: `${dist}-yard field goal`, yards: 0,
      result: good ? `${dist}-yd FG is good` : `${dist}-yd FG is no good`,
      turnover: !good, timeUsed: 5,
    }
  }
  const p = topGroup(world, offId, ['P'], 1)[0]
  const pA = p ? mkAttrs(p) : {}
  const net = 38 + Math.round(((pA.KPW ?? 80) - 78) * 0.4 + rmean('P', 'AWR', pA.AWR ?? 70) * 0.1 * E2_W + rng() * 14)
  return { type: 'punt', concept: 'Punt', yards: net, result: `${net}-yard punt`, turnover: true, timeUsed: 6 }
}

function resolvePAT(world: World, rng: Rng, offId: string): PlayOutcome {
  const k = topGroup(world, offId, ['K'], 1)[0]
  const acc = k ? (mkAttrs(k).KAC ?? 84) : 84
  const good = rng() < clamp(0.88 + (acc - 80) * 0.006, 0.8, 0.99)
  return {
    type: 'pat', concept: 'Extra Point', yards: 0,
    result: good ? 'Extra point good' : 'Extra point MISSED',
    turnover: !good, timeUsed: 4,
  }
}

// ── Game driver ───────────────────────────────────────────────────────────────
function fmtClock(sec: number) {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ── Resumable game state (L10 G1) ─────────────────────────────────────────────
export type MomentKind = 'fourth' | 'two' | 'call' | 'defCall' | 'halftime' | 'twoMinute' | 'clock' | 'qbChange'
/** Which side a moment belongs to (Design rule 5). 'hc' = head-coach only. */
export type MomentSide = 'off' | 'def' | 'both' | 'hc'
/** G7 two-minute offensive mode for the current possession. */
export type TwoMinMode = 'hurry' | 'normal' | 'protect' | 'fgRange'
export interface MomentOption { id: string; label: string; hint: string }
export interface Moment {
  id: string // `${kind}-${playIndex}` — unique within a game
  kind: MomentKind
  teamId: string // the user's club
  qtr: number
  clock: string
  down: number | null
  distance: number | null
  yard: number
  us: number // score from the user's side
  them: number
  title: string // e.g. "4th & 2 at their 38"
  options: MomentOption[]
  defaultId: string // the standing order's answer
  staffRead?: string
}
export interface DecisionLog {
  momentId: string
  kind: MomentKind
  choiceId: string
  defaultId: string
  source: 'user' | 'standing'
  qtr: number
  yard: number
  down: number | null
  distance: number | null
  margin: number
  outcome?: string
  ep?: number
  /** L10 G9: the opponent's call on a `call`/`defCall` snap, for the film grade. */
  vs?: string
}
export interface GameCtx {
  userTeamId: string
  scope: 'off' | 'def' | 'both' | 'hc' // 'hc' = head coach; 'off'/'def'/'both' = coordinator focus
  callSheet: CallSheet
  /** G10: the user's opening script (concept names, in order). */
  script?: string[]
  /** G10: 1.5 when the club ran a full install this season. */
  scriptEdgeMult?: number
  /** G8: the opponent film read purchased this week. */
  oppRead?: { week: number; oppId: string; sharp: boolean }
  /** L10 G11: the user's matchup assignments for this game. */
  matchups?: MatchupSet
  /** L10 G12: the user's workload / rotation settings for this game. */
  usage?: UsageSet
  /** L12.6: call every snap on this side (coached games only); unset = key moments only. */
  callAll?: 'off' | 'def' | 'both'
}
export interface GameState {
  rng: Rng
  plays: Play[]
  homeScore: number
  awayScore: number
  stats: { home: TeamGameStats; away: TeamGameStats }
  qtr: number
  clock: number
  offId: string
  defId: string
  yard: number
  down: number
  distance: number
  n: number
  phase: 'play' | 'try' | 'halftime'
  pending: Moment | null
  answers: Record<string, string>
  /** Moments answered on standing orders (Sim to end / fast sim) rather than by the user. */
  autoAnswered?: Record<string, true>
  momentsUsed: number
  kindUsed: Partial<Record<MomentKind, number>>
  decisions: DecisionLog[]
  done: boolean
  ctx?: GameCtx
  homeId: string
  awayId: string
  tier: 'NFL' | 'FBS'
  pace: number
  passAdj: number
  // ── L10 G6/G7 ──────────────────────────────────────────────────────────────
  /** Timeouts left per club, reset to 3 at halftime. */
  timeouts: Record<string, number>
  /** Timeouts spent per club (probe/clock reporting). */
  timeoutsUsed: Record<string, number>
  /** Halftime fixes per club, read by the resolvers. */
  adjust: Record<string, string[]>
  /** G6: halftime QB change override (teamId → backup playerId). */
  qbOverride: Record<string, string>
  /** G7: two-minute mode for the current possession. */
  twoMinMode: TwoMinMode | null
  /** Whether this possession has already chosen a two-minute mode. */
  twoMinChecked: boolean
  /** G7: the user's clock decision per club ('use' | 'save'). */
  clockMode: Record<string, 'use' | 'save' | undefined>
  /** Whether the one clock moment for this game has been resolved. */
  clockChecked: boolean
  // ── L10 G8/G9/G10 ─────────────────────────────────────────────────────────
  /** Standing concepts per call moment (so a paused game draws the RNG once). */
  callConcepts: Record<string, Concept>
  /** G10: how many of the script's snaps have been used. */
  scriptUsed: number
  /** G10: the class of the last scripted snap, for predictability. */
  scriptLastClass: OffClass | null
  /** G10: consecutive scripted snaps of the same class. */
  scriptClassRun: number
  /** G10: which user offensive possession we're on (edge only on the first). */
  userDrive: number
  /** Moments already written to the decision log, so a re-run never double-logs. */
  logged: Record<string, true>
  /** Halftime bookkeeping so rng only draws once per phase. */
  halfAdjustDone: boolean
  qbChangeChecked: boolean
  /** Probe counter: possessions that ran a two-minute mode. */
  twoMinDrives: number
}

const MAX_PLAYS = 210

function statFor(s: GameState, id: string) {
  return id === s.homeId ? s.stats.home : s.stats.away
}

function swapPossession(s: GameState) {
  const t = s.offId
  s.offId = s.defId
  s.defId = t
  // A two-minute mode only lasts as long as the possession that chose it.
  s.twoMinMode = null
  s.twoMinChecked = false
  // G10: the opening script's edge only applies on the user's first drive.
  if (s.ctx && s.offId === s.ctx.userTeamId) s.userDrive += 1
}

function baseTimeScale(id: string): number {
  const p = planFor(id, 'off')
  return p ? planEffects(p, false).timeScale : 1
}

function pushPlay(s: GameState, p: Omit<Play, 'n' | 'qtr' | 'clock' | 'offId' | 'defId' | 'homeScore' | 'awayScore'>) {
  s.plays.push({ n: s.n++, qtr: s.qtr, clock: fmtClock(s.clock), offId: s.offId, defId: s.defId, homeScore: s.homeScore, awayScore: s.awayScore, ...p })
}

// ── Decision points (L10 G2) ──────────────────────────────────────────────────
const MOMENT_CAPS: Record<MomentKind, number> = {
  fourth: 3, two: 2, call: 2, defCall: 2, twoMinute: 2, clock: 1, halftime: 1, qbChange: 1,
}
/** Cap on the big moments. Play calls (call/defCall) have their own caps and do
 *  not count here, so they can never crowd out halftime or a late 2-point try. */
const TOTAL_MOMENT_CAP = 8
const isPlayCall = (k: MomentKind) => k === 'call' || k === 'defCall'

interface DecisionSpec {
  kind: MomentKind
  /** Which side owns this moment (Design rule 5). */
  side: MomentSide
  teamId: string
  qtr: number
  clock: string
  down: number | null
  distance: number | null
  yard: number
  title: string
  options: MomentOption[]
  defaultId: string
  staffRead?: string
  /** Situational condition: only then is the user actually asked. */
  ask: boolean
  margin: number
  ep?: number
}

/** Design rule 5: does a rung's scope let it answer a moment on this side? */
function scopeAllows(scope: GameCtx['scope'], side: MomentSide): boolean {
  if (scope === 'hc') return true
  if (side === 'hc') return false
  if (scope === 'off') return side === 'off'
  if (scope === 'def') return side === 'def'
  return side === 'off' || side === 'def' || side === 'both'
}

function logDecision(s: GameState, id: string, spec: DecisionSpec, choiceId: string, source: 'user' | 'standing') {
  s.decisions.push({
    momentId: id, kind: spec.kind, choiceId, defaultId: spec.defaultId, source,
    qtr: spec.qtr, yard: spec.yard, down: spec.down, distance: spec.distance, margin: spec.margin, ep: spec.ep,
  })
}

/**
 * Log a decision at most once. A step can raise a second moment after the
 * first (a `call` after a 4th-down `go`), and on resume the whole step re-runs —
 * the guard keeps the log honest without touching the RNG stream.
 */
function logOnce(s: GameState, id: string, spec: DecisionSpec, choiceId: string, source: 'user' | 'standing') {
  if (s.logged[id]) return
  s.logged[id] = true
  logDecision(s, id, spec, choiceId, source)
}

/**
 * Resolve a decision point that sits at the start of a step, before any rng
 * draw. Returns the choice, or null after setting `s.pending` (step returns
 * immediately, so the RNG stream is untouched until the user answers).
 */
function decide(s: GameState, spec: DecisionSpec): string | null {
  const id = `${spec.kind}-${s.plays.length}`
  const isUser = !!s.ctx && spec.teamId === s.ctx.userTeamId
  if (isUser && s.answers[id]) {
    logOnce(s, id, spec, s.answers[id], s.autoAnswered?.[id] ? 'standing' : 'user')
    return s.answers[id]
  }
  const canAsk = isUser && scopeAllows(s.ctx!.scope, spec.side) && spec.ask &&
    (isPlayCall(spec.kind) || s.momentsUsed < TOTAL_MOMENT_CAP) && (s.kindUsed[spec.kind] ?? 0) < MOMENT_CAPS[spec.kind]
  if (canAsk) {
    const us = spec.teamId === s.homeId ? s.homeScore : s.awayScore
    const them = spec.teamId === s.homeId ? s.awayScore : s.homeScore
    s.pending = {
      id, kind: spec.kind, teamId: spec.teamId, qtr: spec.qtr, clock: spec.clock,
      down: spec.down, distance: spec.distance, yard: spec.yard, us, them,
      title: spec.title, options: spec.options, defaultId: spec.defaultId, staffRead: spec.staffRead,
    }
    if (!isPlayCall(spec.kind)) s.momentsUsed += 1
    s.kindUsed[spec.kind] = (s.kindUsed[spec.kind] ?? 0) + 1
    return null
  }
  if (isUser) logOnce(s, id, spec, spec.defaultId, 'standing')
  return spec.defaultId
}

function fmtEV(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`
}

/**
 * 4th-down decision for the offense. Must be called before any rng draw in the
 * step; returns null when the user's moment is pending.
 */
function chooseFourth(world: World, s: GameState): 'go' | 'fg' | 'punt' | null {
  const inFgRange = s.yard >= 52
  const isUser = !!s.ctx && s.offId === s.ctx.userTeamId
  const sheet = isUser ? s.ctx!.callSheet : aiCallSheet(world, s.offId)
  const k = topGroup(world, s.offId, ['K'], 1)[0]
  const kA = k ? mkAttrs(k) : {}
  const kickPower = (kA.KPW ?? 78) * 0.5 + (kA.KAC ?? 78) * 0.5
  const margin = s.offId === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore
  const sit: Situation = { yard: s.yard, down: 4, distance: s.distance, qtr: s.qtr, clockSec: s.clock, margin }
  const ev = fourthDownEV(sit, kickPower)
  const chosen = fourthDownChoice(sheet.fourth, sit, kickPower)
  const defaultId = inFgRange ? chosen : chosen === 'fg' ? 'punt' : chosen
  const options: MomentOption[] = [
    { id: 'go', label: 'Go for it', hint: 'One snap to keep the drive alive.' },
    ...(inFgRange ? [{ id: 'fg', label: `Kick the ${100 - s.yard + 17}-yd FG`, hint: 'Take the points.' }] : []),
    { id: 'punt', label: 'Punt', hint: 'Trade the ball for field position.' },
  ]
  const yardText = s.yard >= 50 ? `their ${100 - s.yard}` : `your ${s.yard}`
  const ask = (s.yard >= 35 && s.distance <= 5) || s.yard >= 52
  const choice = decide(s, {
    kind: 'fourth', side: 'hc', teamId: s.offId, qtr: s.qtr, clock: fmtClock(s.clock), down: 4, distance: s.distance,
    yard: s.yard, title: `4th & ${s.distance} at ${yardText}`, options, defaultId,
    staffRead: `Staff EV — Go ${fmtEV(ev.go)} · FG ${ev.fg == null ? '—' : fmtEV(ev.fg)} · Punt ${fmtEV(ev.punt)}`,
    ask, margin, ep: ev.go,
  })
  if (choice == null) return null
  return choice as 'go' | 'fg' | 'punt'
}

// ── L10 G6: halftime adjustments + QB change ─────────────────────────────────
type FixId = 'maxProtect' | 'quickGame' | 'thirdDownHeat' | 'loadTheBox' | 'twoDeep'
interface FixMeta { side: 'off' | 'def'; label: string; hint: string }
const FIX_META: Record<FixId | 'stayCourse', FixMeta> = {
  maxProtect: { side: 'off', label: 'Max protect', hint: 'Sacks ×0.6; deep concepts lose a target (completion −3%).' },
  quickGame: { side: 'off', label: 'Quick game', hint: 'Pass rate +10%, short concepts +3% completion; run edge −2.' },
  thirdDownHeat: { side: 'def', label: 'Third-down heat', hint: 'Blitz +15% on their 3rd downs; big-play risk ×1.1 there.' },
  loadTheBox: { side: 'def', label: 'Load the box', hint: 'Run defense ×1.08; coverage ×0.96.' },
  twoDeep: { side: 'def', label: 'Two-deep', hint: 'Big plays allowed ×0.85; underneath completion ×1.04.' },
  stayCourse: { side: 'off', label: 'Stay the course', hint: 'No change — trust the first-half plan.' },
}
const FIX_ORDER: FixId[] = ['maxProtect', 'quickGame', 'thirdDownHeat', 'loadTheBox', 'twoDeep']

interface Diagnosis { fix: FixId; side: 'off' | 'def'; severity: number; note: string }

/** First-half diagnostics for one club, most severe first (G6). */
function diagnose(plays: Play[], teamId: string): Diagnosis[] {
  let sacksTaken = 0
  let rushAtt = 0
  let rushYds = 0
  let opp3Att = 0
  let opp3Conv = 0
  let oppRushAtt = 0
  let oppRushYds = 0
  let explosives = 0
  for (const p of plays) {
    if (p.offId === teamId) {
      if (isSack(p)) sacksTaken += 1
      else if (p.type === 'run') { rushAtt += 1; rushYds += Math.max(0, p.yards) }
    } else if (p.defId === teamId) {
      if (p.type === 'run') { oppRushAtt += 1; oppRushYds += Math.max(0, p.yards) }
      if (p.type === 'pass' && p.yards >= 25 && !p.turnover) explosives += 1
      if (p.down === 3 && (p.type === 'run' || p.type === 'pass')) {
        opp3Att += 1
        if (!p.turnover && (p.endYard >= 100 || p.yards >= (p.distance ?? 99))) opp3Conv += 1
      }
    }
  }
  const out: Diagnosis[] = []
  if (sacksTaken >= 2) out.push({ fix: 'maxProtect', side: 'off', severity: 50 + sacksTaken, note: `${sacksTaken} sacks taken` })
  const rushAvg = rushAtt ? rushYds / rushAtt : 0
  if (rushAtt >= 6 && rushAvg < 3.5) out.push({ fix: 'quickGame', side: 'off', severity: 40 + (3.5 - rushAvg), note: `rush ${rushAvg.toFixed(1)} avg` })
  const opp3Rate = opp3Att ? opp3Conv / opp3Att : 0
  if (opp3Att >= 4 && opp3Rate >= 0.5) out.push({ fix: 'thirdDownHeat', side: 'def', severity: 30 + (opp3Rate - 0.5) * 10, note: `their 3rd downs ${(opp3Rate * 100).toFixed(0)}%` })
  const oppRushAvg = oppRushAtt ? oppRushYds / oppRushAtt : 0
  if (oppRushAtt >= 6 && oppRushAvg >= 5) out.push({ fix: 'loadTheBox', side: 'def', severity: 20 + (oppRushAvg - 5), note: `their rush ${oppRushAvg.toFixed(1)} avg` })
  if (explosives >= 2) out.push({ fix: 'twoDeep', side: 'def', severity: 10 + (explosives - 2), note: `${explosives} explosives allowed` })
  return out.sort((a, b) => b.severity - a.severity)
}

/** The user's halftime adjustment card, filtered to their side's fixes (G6). */
function buildHalftimeSpec(s: GameState): DecisionSpec {
  const ctx = s.ctx!
  const userTeam = ctx.userTeamId
  const side: MomentSide = ctx.scope === 'off' ? 'off' : ctx.scope === 'def' ? 'def' : 'both'
  const allowed: ('off' | 'def')[] = side === 'off' ? ['off'] : side === 'def' ? ['def'] : ['off', 'def']
  const diag = diagnose(s.plays, userTeam).filter((d) => allowed.includes(d.side))
  const picks: FixId[] = diag.slice(0, 2).map((d) => d.fix)
  for (const f of FIX_ORDER) {
    if (picks.length >= 2) break
    if (FIX_META[f].side === 'off' && allowed.includes('off') && !picks.includes(f)) picks.push(f)
    else if (FIX_META[f].side === 'def' && allowed.includes('def') && !picks.includes(f)) picks.push(f)
  }
  const options: MomentOption[] = picks.map((f) => ({ id: f, label: FIX_META[f].label, hint: FIX_META[f].hint }))
  options.push({ id: 'stayCourse', label: FIX_META.stayCourse.label, hint: FIX_META.stayCourse.hint })
  const margin = userTeam === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore
  const read = diag.length ? diag.slice(0, 2).map((d) => d.note).join(' · ') : 'No first-half problem stood out.'
  return {
    kind: 'halftime', side, teamId: userTeam, qtr: 2, clock: '0:00', down: null, distance: null, yard: s.yard,
    title: 'Halftime adjustments', options, defaultId: 'stayCourse',
    staffRead: `First half — ${read}`, ask: true, margin,
  }
}

/** AI clubs take their top diagnosed fix, scaled by the head coach (G6). */
function rollAIHalftime(world: World, s: GameState) {
  const userTeam = s.ctx?.userTeamId
  for (const teamId of [s.homeId, s.awayId]) {
    if (teamId === userTeam) continue
    const top = diagnose(s.plays, teamId)[0]
    if (!top) { s.adjust[teamId] = []; continue }
    const hc = (world.staff[teamId] ?? []).find((m) => m.role === 'Head Coach')
    const p = clamp(0.4 + ((hc?.rating ?? 74) - 60) / 100, 0.2, 0.8)
    s.adjust[teamId] = s.rng() < p ? [top.fix] : []
  }
}

/** Standard NFL passer rating for one QB over the plays so far. */
function firstHalfPasserRating(plays: Play[], qbId: string): number | null {
  let att = 0, comp = 0, yds = 0, td = 0, ints = 0
  for (const p of plays) {
    if (p.qbId !== qbId || p.type !== 'pass') continue
    if (isSack(p)) continue
    att += 1
    if (p.turnover) { ints += 1; continue }
    if (p.result === 'Incomplete') continue
    comp += 1
    yds += Math.max(0, p.yards)
    if (p.result === 'TOUCHDOWN!') td += 1
  }
  if (!att) return null
  const term = (x: number) => Math.max(0, Math.min(2.375, x))
  const a = term((comp / att - 0.3) * 5)
  const b = term((yds / att - 3) * 0.25)
  const c = term((td / att) * 20)
  const d = term(2.375 - (ints / att) * 25)
  return ((a + b + c + d) / 6) * 100
}

interface QbSpec extends DecisionSpec { backupId: string }

/** The HC-only QB-change card when the starter has struggled (G6). */
function buildQbSpec(world: World, s: GameState): QbSpec | null {
  if (!s.ctx) return null
  const userTeam = s.ctx.userTeamId
  const qbs = depthGroup(world, userTeam, ['QB'], 2)
  if (qbs.length < 2) return null
  const starter = qbs[0]
  const backup = qbs[1]
  const rating = firstHalfPasserRating(s.plays, starter.id)
  if (rating == null || rating >= 50) return null
  const margin = userTeam === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore
  return {
    kind: 'qbChange', side: 'hc', teamId: userTeam, qtr: 2, clock: '0:00', down: null, distance: null, yard: s.yard,
    title: 'Change quarterback?', defaultId: 'stay', ask: true, margin, backupId: backup.id,
    options: [
      { id: 'stay', label: `Stay with ${starter.name}`, hint: 'Give him the second half to settle in.' },
      { id: 'switch', label: `Switch to ${backup.name}`, hint: 'Turn to the backup for the second half.' },
    ],
    staffRead: `${starter.name} — first-half passer rating ${rating.toFixed(1)}`,
  }
}

/** The halftime phase: adjustment card, AI fixes, then the QB-change card. */
function stepHalftimePhase(world: World, s: GameState): 'continue' | 'moment' {
  if (!s.halfAdjustDone) {
    const userTeam = s.ctx?.userTeamId
    if (userTeam) {
      const choice = decide(s, buildHalftimeSpec(s))
      if (choice === null) return 'moment'
      s.adjust[userTeam] = choice === 'stayCourse' ? [] : [choice]
    }
    // AI fixes draw only after the user's answer (determinism, Design rule 4).
    s.halfAdjustDone = true
    rollAIHalftime(world, s)
  }
  if (!s.qbChangeChecked) {
    const spec = buildQbSpec(world, s)
    if (spec) {
      const choice = decide(s, spec)
      if (choice === null) return 'moment'
      if (choice === 'switch') s.qbOverride[s.ctx!.userTeamId] = spec.backupId
    }
    s.qbChangeChecked = true
  }
  return stepHalftime(s)
}

// ── L10 G7: two-minute drill, timeouts, clock moment ─────────────────────────
function envFor(s: GameState): SimEnv {
  return { adjust: s.adjust, qbOverride: s.qbOverride, down: s.down, intMult: s.twoMinMode === 'hurry' ? 1.15 : 1, qtr: s.qtr, clock: s.clock, userTeamId: s.ctx?.userTeamId, matchups: s.ctx?.matchups, usage: s.ctx?.usage }
}

/** The offense's two-minute choice at the start of a possession (G7). */
function checkTwoMinute(s: GameState): 'continue' | 'moment' {
  if (s.twoMinChecked) return 'continue'
  if (s.qtr !== 2 && s.qtr !== 4) return 'continue'
  if (s.clock > 120) return 'continue'
  const offId = s.offId
  const margin = offId === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore
  if (s.qtr === 4 && (margin < -8 || margin > 3)) return 'continue'
  const isUser = !!s.ctx && offId === s.ctx.userTeamId
  if (!isUser) {
    // AI: trailing or tied → hurry, leading → protect.
    s.twoMinMode = margin <= 0 ? 'hurry' : 'protect'
    s.twoMinChecked = true
    s.twoMinDrives += 1
    return 'continue'
  }
  const standing: TwoMinMode = margin < 0 ? 'hurry' : margin > 0 ? 'protect' : 'normal'
  const options: MomentOption[] = [
    { id: 'hurry', label: 'Hurry up', hint: 'Fast tempo; burn timeouts on gains. Riskier throws.' },
    { id: 'normal', label: 'Normal tempo', hint: 'Keep the standard pace.' },
    ...(margin > 0 ? [{ id: 'protect', label: 'Protect the ball', hint: 'Slow tempo, safe throws — run the clock.' }] : []),
    { id: 'fgRange', label: 'Play for the FG', hint: 'Normal tempo until in range, then kick it.' },
  ]
  const choice = decide(s, {
    kind: 'twoMinute', side: 'off', teamId: offId, qtr: s.qtr, clock: fmtClock(s.clock), down: s.down, distance: s.distance,
    yard: s.yard, title: 'Two-minute drill', options, defaultId: standing, ask: true, margin,
  })
  if (choice === null) return 'moment'
  s.twoMinMode = choice as TwoMinMode
  s.twoMinChecked = true
  s.twoMinDrives += 1
  return 'continue'
}

/** The HC clock-management moment when the user's defense is trailing late (G7). */
function checkClock(s: GameState): 'continue' | 'moment' {
  if (s.clockChecked || !s.ctx) return 'continue'
  const userTeam = s.ctx.userTeamId
  if (s.qtr !== 4 || s.clock > 180 || s.defId !== userTeam) return 'continue'
  if ((s.timeouts[userTeam] ?? 0) <= 0) return 'continue'
  const margin = userTeam === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore
  if (margin > -1 || margin < -8) return 'continue'
  const standing = s.ctx.callSheet.timeouts === 'aggressive' ? 'useTimeouts' : 'save'
  const choice = decide(s, {
    kind: 'clock', side: 'hc', teamId: userTeam, qtr: s.qtr, clock: fmtClock(s.clock), down: s.down, distance: s.distance,
    yard: s.yard, title: 'Use your timeouts?', defaultId: standing, ask: true, margin,
    staffRead: `Trailing ${-margin} with ${fmtClock(s.clock)} left`,
    options: [
      { id: 'useTimeouts', label: 'Use timeouts', hint: 'Stop the clock after each opponent play.' },
      { id: 'save', label: 'Save timeouts', hint: 'Keep them for the final possession.' },
    ],
  })
  if (choice === null) return 'moment'
  s.clockMode[userTeam] = choice === 'useTimeouts' ? 'use' : 'save'
  s.clockChecked = true
  return 'continue'
}

/** Would the defense stop the clock after this play? (G7) */
function wantsTimeout(world: World, s: GameState, defId: string): boolean {
  if (s.qtr !== 4 || (s.timeouts[defId] ?? 0) <= 0) return false
  const defScore = defId === s.homeId ? s.homeScore : s.awayScore
  const offScore = defId === s.homeId ? s.awayScore : s.homeScore
  if (defScore >= offScore) return false // only when trailing
  const isUser = !!s.ctx && defId === s.ctx.userTeamId
  let mode: 'use' | 'save'
  if (isUser) mode = s.clockMode[defId] ?? (s.ctx!.callSheet.timeouts === 'aggressive' ? 'use' : 'save')
  else mode = aiCallSheet(world, defId).timeouts === 'aggressive' ? 'use' : 'save'
  return mode === 'use' ? s.clock <= 180 : s.clock <= 60
}

/** Spend a timeout on this play if the offense (hurry) or defense wants one (G7). */
function usedTimeout(world: World, s: GameState, offId: string, defId: string, out: PlayOutcome): boolean {
  if (s.twoMinMode === 'hurry' && out.yards > 0 && (s.timeouts[offId] ?? 0) > 0) {
    s.timeouts[offId] -= 1
    s.timeoutsUsed[offId] = (s.timeoutsUsed[offId] ?? 0) + 1
    return true
  }
  if (wantsTimeout(world, s, defId)) {
    s.timeouts[defId] -= 1
    s.timeoutsUsed[defId] = (s.timeoutsUsed[defId] ?? 0) + 1
    return true
  }
  return false
}

export function createGame(world: World, homeId: string, awayId: string, seed: number, ctx?: GameCtx): GameState {
  const isCollege = world.byId[homeId].tier !== 'NFL'
  const rng = makeRng(seed)
  const s: GameState = {
    rng,
    plays: [],
    homeScore: 0,
    awayScore: 0,
    stats: { home: emptyStats(), away: emptyStats() },
    qtr: 1,
    clock: 900,
    // First draw matches the old loop exactly.
    offId: rng() < 0.5 ? homeId : awayId,
    defId: homeId,
    yard: 25,
    down: 1,
    distance: 10,
    n: 0,
    phase: 'play',
    pending: null,
    answers: {},
    momentsUsed: 0,
    kindUsed: {},
    decisions: [],
    done: false,
    ctx,
    homeId,
    awayId,
    tier: isCollege ? 'FBS' : 'NFL',
    pace: isCollege ? 0.78 : 0.9,
    passAdj: isCollege ? -0.09 : 0,
    timeouts: { [homeId]: 3, [awayId]: 3 },
    timeoutsUsed: { [homeId]: 0, [awayId]: 0 },
    adjust: {},
    qbOverride: {},
    twoMinMode: null,
    twoMinChecked: false,
    clockMode: {},
    clockChecked: false,
    callConcepts: {},
    scriptUsed: 0,
    scriptLastClass: null,
    scriptClassRun: 0,
    userDrive: 0,
    logged: {},
    halfAdjustDone: false,
    qbChangeChecked: false,
    twoMinDrives: 0,
  }
  s.defId = s.offId === homeId ? awayId : homeId
  // G10: if the user receives the opening kick, this is their first drive.
  if (ctx && s.offId === ctx.userTeamId) s.userDrive = 1
  // opening kickoff
  pushPlay(s, { type: 'kickoff', concept: 'Kickoff', yards: 0, result: 'Touchback', startYard: 25, endYard: 25, down: null, distance: null, timeUsed: 5 })
  return s
}

/** End-of-quarter / overtime bookkeeping. No rng is drawn here. */
function stepClock(s: GameState): 'continue' | 'done' {
  if (s.qtr === 2) {
    pushPlay(s, { type: 'end', concept: 'End of Half', yards: 0, result: 'Halftime', startYard: s.yard, endYard: s.yard, down: null, distance: null, timeUsed: 0 })
    s.phase = 'halftime'
    return 'continue'
  }
  if (s.qtr === 4) {
    if (s.homeScore === s.awayScore) {
      // Overtime: 10-minute period, first score wins (simplified).
      s.qtr += 1
      s.clock = 600
      swapPossession(s)
      s.yard = 25
      s.down = 1
      s.distance = 10
      pushPlay(s, { type: 'end', concept: 'End of Regulation', yards: 0, result: 'Tied — Overtime', startYard: s.yard, endYard: s.yard, down: null, distance: null, timeUsed: 0 })
      return 'continue'
    }
    pushPlay(s, { type: 'end', concept: 'End of Regulation', yards: 0, result: 'Final', startYard: s.yard, endYard: s.yard, down: null, distance: null, timeUsed: 0 })
    return 'done'
  }
  if (s.qtr >= 5) {
    pushPlay(s, { type: 'end', concept: 'End of Overtime', yards: 0, result: 'Final (OT)', startYard: s.yard, endYard: s.yard, down: null, distance: null, timeUsed: 0 })
    return 'done'
  }
  s.qtr += 1
  s.clock = 900
  return 'continue'
}

/** Halftime: possession flips to start Q3, timeouts reset (G6/G7). */
function stepHalftime(s: GameState): 'continue' {
  s.qtr = 3
  s.clock = 900
  swapPossession(s)
  s.yard = 25
  s.down = 1
  s.distance = 10
  s.timeouts = { [s.homeId]: 3, [s.awayId]: 3 }
  s.phase = 'play'
  return 'continue'
}

/** Resolve the try after a touchdown: the scoring team's sheet decides kick or go2. */
function stepTry(world: World, s: GameState): 'continue' | 'moment' {
  const offId = s.offId
  const isUser = !!s.ctx && offId === s.ctx.userTeamId
  const sheet = isUser ? s.ctx!.callSheet : aiCallSheet(world, offId)
  const margin = offId === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore
  const twoDefault = twoPointChoice(sheet.twoPoint, margin, s.qtr)
  const choice = decide(s, {
    kind: 'two', side: 'hc', teamId: offId, qtr: s.qtr, clock: fmtClock(s.clock), down: null, distance: null, yard: 98,
    // Only ask when it can matter: the second half, or whenever the chart says go for two.
    title: 'Two-point try', margin, ask: s.qtr >= 3 || twoDefault === 'go2', defaultId: twoDefault,
    options: [
      { id: 'kick', label: 'Kick the PAT', hint: 'Take the near-certain point.' },
      { id: 'go2', label: 'Go for two', hint: 'One snap from the 2 for two points.' },
    ],
  })
  if (choice === null) return 'moment'

  const offS = statFor(s, offId)
  if (choice === 'go2') {
    offS.twoAtt += 1
    const style = offStyle(world, offId)
    const concept = pickConcept(s.rng, style, 4, 2, 0)
    const env = envFor(s)
    const out = concept.type === 'pass'
      ? resolvePass(world, s.rng, offId, s.defId, concept, 98, style.passRate, s.tier, clutchFor(world, offId, 4, 98), env, undefined, s.n)
      : resolveRun(world, s.rng, offId, s.defId, concept, 2, 98, s.tier, clutchFor(world, offId, 4, 98), env, undefined, s.n)
    s.clock -= out.timeUsed * s.pace
    const good = !out.turnover && out.yards >= 2
    if (good) {
      if (offId === s.homeId) s.homeScore += 2
      else s.awayScore += 2
      offS.points += 2
      offS.twoMade += 1
    }
    pushPlay(s, {
      type: 'pat', concept: 'Two-point try', yards: out.yards,
      result: good ? 'Two-point try good' : 'Two-point try failed',
      turnover: !good, startYard: 98, endYard: 98, down: null, distance: null, timeUsed: out.timeUsed,
      offClass: offClassFor(concept.type, concept.depth),
    })
  } else {
    const pat = resolvePAT(world, s.rng, offId)
    s.clock -= pat.timeUsed * s.pace
    if (!pat.turnover) {
      if (offId === s.homeId) s.homeScore += 1
      else s.awayScore += 1
      offS.points += 1
    }
    pushPlay(s, { ...pat, startYard: 2, endYard: 2, down: null, distance: null })
  }

  swapPossession(s)
  s.yard = 25
  s.down = 1
  s.distance = 10
  pushPlay(s, { type: 'kickoff', concept: 'Kickoff', yards: 0, result: 'Touchback', startYard: 25, endYard: 25, down: null, distance: null, timeUsed: 5 })
  s.phase = 'play'
  return 'continue'
}

/** One loop iteration of the old simulatePlayByPlay. */
function step(world: World, s: GameState): 'continue' | 'moment' | 'done' {
  if (s.done) return 'done'
  if (s.n >= MAX_PLAYS) return 'done'

  if (s.phase === 'try') return stepTry(world, s)
  if (s.phase === 'halftime') return stepHalftimePhase(world, s)

  if (s.clock <= 0) return stepClock(s)

  // L10 G7: two-minute and clock moments sit at the very start, before any rng.
  if (checkTwoMinute(s) === 'moment') return 'moment'
  if (checkClock(s) === 'moment') return 'moment'

  // 4th-down decision sits at the very start of the step, before any rng draw.
  let fourthChoice: 'go' | 'fg' | 'punt' | null = null
  if (s.down === 4) {
    fourthChoice = chooseFourth(world, s)
    if (fourthChoice === null) return 'moment'
  }

  const offId = s.offId
  const defId = s.defId
  const style = offStyle(world, offId)
  const offPlan = planFor(offId, 'off')
  const planPassAdj = offPlan ? planEffects(offPlan, false).passAdj : 0

  // G7 fgRange: as soon as it's a long FG, kick it (≤0:30 left or on 3rd down).
  if (s.twoMinMode === 'fgRange' && s.down !== 4 && s.yard >= 62 && (s.clock <= 30 || s.down === 3)) {
    const out = resolveSpecial(world, s.rng, offId, 'fg', s.yard, envFor(s), offId === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore)
    s.clock -= out.timeUsed * s.pace
    const good = !out.turnover
    const fgS = statFor(s, offId)
    fgS.fgAtt += 1
    if (good) {
      if (offId === s.homeId) s.homeScore += 3
      else s.awayScore += 3
      fgS.points += 3
      fgS.fgMade += 1
    }
    pushPlay(s, { ...out, startYard: s.yard, endYard: s.yard, down: s.down, distance: s.distance })
    swapPossession(s)
    s.yard = 25
    s.down = 1
    s.distance = 10
    return 'continue'
  }

  // G6 quick game throws more; G7 protect throws safer.
  const quickPassAdj = hasFix(envFor(s), offId, 'quickGame') ? 0.1 : 0
  const modePassAdj = s.twoMinMode === 'protect' ? -0.15 : 0
  const isFourth = s.down === 4
  const passAdj = s.passAdj + planPassAdj + quickPassAdj + modePassAdj

  // ── L10 G9/G10: the snap's concept and any call-matrix edge. The `call` and
  //    `defCall` decisions sit before the penalty rng; the AI's counter-call is
  //    drawn only after the user answers (or the standing order is taken).
  const bucket = bucketFor(s.down, s.distance, s.yard)
  const marginOf = (id: string) => (id === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore)
  const offIsUser = !!s.ctx && offId === s.ctx.userTeamId
  const defIsUser = !!s.ctx && defId === s.ctx.userTeamId
  let concept: Concept
  let call: CallEffect | undefined
  let userDefCall: DefCall | undefined

  // L12.6: in "call every play" mode the user's side is asked on every snap.
  const callAll = s.ctx?.callAll
  const callTriggered = offIsUser && (!isFourth || fourthChoice === 'go') && (
    callAll === 'off' || callAll === 'both' ||
    (s.down === 3 && s.distance <= 3) ||
    (s.yard >= 80 && s.down >= 3) ||
    (s.qtr === 4 && s.clock <= 120 && marginOf(s.offId) >= -8 && marginOf(s.offId) <= 0)
  )
  const defCallTriggered = defIsUser && (
    callAll === 'def' || callAll === 'both' ||
    (s.down === 3 && s.yard >= 40) ||
    (s.qtr === 4 && s.clock <= 120 && marginOf(s.ctx!.userTeamId) >= 1 && marginOf(s.ctx!.userTeamId) <= 8)
  )

  if (callTriggered) {
    // The standing concept is what pickConcept would have chosen — one draw, and
    // it is stored so a paused game never redraws it.
    const id = `call-${s.plays.length}`
    let standing = s.callConcepts[id]
    if (!standing) {
      standing = pickConcept(s.rng, style, s.down, s.distance, passAdj)
      s.callConcepts[id] = standing
    }
    const read = tendencyRead(world, s, s.defId, 'def', bucket)
    const choice = decide(s, {
      kind: 'call', side: 'off', teamId: s.offId, qtr: s.qtr, clock: fmtClock(s.clock), down: s.down, distance: s.distance,
      yard: s.yard, title: downDistance(s.down, s.distance, s.yard),
      options: callCards(style).map((c) => ({ id: c.name, label: c.name, hint: c.description })),
      defaultId: standing.name, staffRead: read, ask: true, margin: marginOf(s.offId),
    })
    if (choice === null) return 'moment'
    concept = style.concepts.find((c) => c.name === choice) ?? standing
    const aiDef = drawAIDefCall(world, s, s.defId, bucket)
    // The matrix only applies to a call the user made; a standing order plays the
    // snap exactly as fast sim would (no edge either way).
    const last = s.decisions[s.decisions.length - 1]
    if (last && last.momentId === id && last.source === 'user') {
      call = callEffect(offClassFor(concept.type, concept.depth), aiDef)
      last.outcome = call.edge > 0 ? 'won' : call.edge < 0 ? 'lost' : 'push'
      last.vs = aiDef
    }
  } else if (defCallTriggered) {
    const id = `defCall-${s.plays.length}`
    const userTeam = s.ctx!.userTeamId
    const standing = defCallForPlan(planFor(userTeam, 'def') ?? BALANCED_PLAN)
    const read = tendencyRead(world, s, s.offId, 'off', bucket)
    const choice = decide(s, {
      kind: 'defCall', side: 'def', teamId: userTeam, qtr: s.qtr, clock: fmtClock(s.clock), down: s.down, distance: s.distance,
      yard: s.yard, title: downDistance(s.down, s.distance, s.yard),
      options: DEF_CALLS.map((d) => ({ id: d, label: DEF_CALL_LABEL[d], hint: DEF_CALL_DESC[d] })),
      defaultId: standing, staffRead: read, ask: true, margin: marginOf(userTeam),
    })
    if (choice === null) return 'moment'
    userDefCall = choice as DefCall
    const aiCls = drawAIOffClass(world, s, s.offId, bucket)
    concept = pickConceptOfClass(s.rng, style, aiCls)
    const last = s.decisions[s.decisions.length - 1]
    if (last && last.momentId === id && last.source === 'user') {
      call = callEffect(aiCls, userDefCall)
      last.outcome = call.edge > 0 ? 'won' : call.edge < 0 ? 'lost' : 'push'
      last.vs = aiCls
    }
  } else {
    const script = s.ctx?.script
    const scripted = offIsUser && script && script.length > 0 && s.scriptUsed < script.length
      ? style.concepts.find((c) => c.name === script[s.scriptUsed])
      : undefined
    if (scripted) {
      concept = scripted
      const offCls = offClassFor(scripted.type, scripted.depth)
      if (s.scriptLastClass === offCls) s.scriptClassRun += 1
      else { s.scriptLastClass = offCls; s.scriptClassRun = 1 }
      // Three of the same class in a row and the defense sits on it.
      const aiDef = s.scriptClassRun >= 3 ? bestCounterCall(offCls) : drawAIDefCall(world, s, s.defId, bucket)
      const base = s.userDrive <= 1 ? (s.scriptUsed < 4 ? 2 : 1) : 0
      const scriptedEdge = base * (s.ctx?.scriptEdgeMult ?? 1)
      const eff = callEffect(offCls, aiDef)
      call = { edge: eff.edge + scriptedEdge, sackMult: eff.sackMult }
      s.scriptUsed += 1
    } else {
      concept = pickConcept(s.rng, style, s.down, s.distance, passAdj)
    }
  }

  // Defensive penalty (~3.5%) — 5 yards and an automatic first down.
  const defDisc = ocEffect(world, defId).discipline
  if (s.rng() < 0.035 * defDisc) {
    const penS = statFor(s, offId)
    const startY = s.yard
    s.yard = clamp(s.yard + 5, 1, 99)
    penS.plays += 1
    penS.firstDowns += 1
    const t = 18 * s.pace
    s.clock -= t
    penS.top += t
    pushPlay(s, { type: 'penalty', concept: 'Defensive Penalty', yards: 5, result: '5-yard penalty, automatic first down', turnover: false, startYard: startY, endYard: s.yard, down: s.down, distance: s.distance, timeUsed: 18 })
    s.down = 1
    s.distance = Math.min(10, 100 - s.yard)
    return 'continue'
  }

  // Offensive penalty (~2.5%, ×1.3 in the G7 hurry-up) — 5 yards, replay the down.
  const offDisc = ocEffect(world, offId).discipline
  const hurryPen = s.twoMinMode === 'hurry' ? 1.3 : 1
  if (s.rng() < 0.025 * offDisc * hurryPen) {
    const penS = statFor(s, offId)
    const startY = s.yard
    s.yard = clamp(s.yard - 5, 1, 99)
    penS.plays += 1
    const t = 22 * s.pace
    s.clock -= t
    penS.top += t
    pushPlay(s, { type: 'penalty', concept: 'Offensive Penalty', yards: -5, result: '5-yard penalty, replay down', turnover: false, startYard: startY, endYard: s.yard, down: s.down, distance: s.distance, timeUsed: 22 })
    s.distance = Math.min(s.distance + 5, 100 - s.yard)
    return 'continue'
  }

  // 4th-down resolution (the choice was made before any rng draw this step).
  if (isFourth && fourthChoice !== 'go') {
    if (fourthChoice === 'fg') {
      const out = resolveSpecial(world, s.rng, offId, 'fg', s.yard, envFor(s), offId === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore)
      s.clock -= out.timeUsed * s.pace
      const good = !out.turnover
      const fgS = statFor(s, offId)
      fgS.fgAtt += 1
      if (good) {
        if (offId === s.homeId) s.homeScore += 3
        else s.awayScore += 3
        fgS.points += 3
        fgS.fgMade += 1
      }
      pushPlay(s, { ...out, startYard: s.yard, endYard: s.yard, down: 4, distance: s.distance })
      swapPossession(s)
      s.yard = 25
      s.down = 1
      s.distance = 10
      return 'continue'
    }
    const out = resolveSpecial(world, s.rng, offId, 'punt', s.yard, envFor(s), offId === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore)
    s.clock -= out.timeUsed * s.pace
    const newYard = clamp(s.yard + out.yards, 1, 99)
    pushPlay(s, { ...out, startYard: s.yard, endYard: newYard, down: 4, distance: s.distance })
    swapPossession(s)
    s.yard = 100 - newYard
    s.down = 1
    s.distance = 10
    return 'continue'
  }

  const env = envFor(s)
  const out = concept.type === 'pass'
    ? resolvePass(world, s.rng, offId, defId, concept, s.yard, offStyle(world, offId).passRate, s.tier, clutchFor(world, offId, s.down, s.yard), env, call, s.n)
    : resolveRun(world, s.rng, offId, defId, concept, s.distance, s.yard, s.tier, clutchFor(world, offId, s.down, s.yard), env, call, s.n)

  // G7 tempo and timeouts: a used timeout caps this play's clock burn at 6s.
  const tempoMult = s.twoMinMode === 'hurry' ? 0.45 : s.twoMinMode === 'protect' ? 1.25 : 1
  let t = out.timeUsed * s.pace * baseTimeScale(offId) * tempoMult
  if (usedTimeout(world, s, offId, defId, out)) t = Math.min(t, 6)
  s.clock -= t
  const offS = statFor(s, offId)
  const defS = statFor(s, defId)
  const isPass = out.type === 'pass'
  offS.plays += 1
  if (isPass) {
    offS.passAtt += 1
    if (isSack(out)) { offS.sacksTaken += 1; defS.sacks += 1 }
    else if (out.fumbleId) { offS.passComp += 1; offS.passYds += out.yards; offS.fumbles += 1 }
    else if (out.turnover) { offS.ints += 1; defS.ints += 1 }
    else if (out.result !== 'Incomplete') { offS.passComp += 1; offS.passYds += out.yards }
  } else {
    offS.rushAtt += 1
    offS.rushYds += Math.max(0, out.yards)
    if (out.turnover) offS.fumbles += 1
  }
  offS.top += out.timeUsed * s.pace
  if (s.down === 3) offS.thirdDownAtt += 1

  const endYard = clamp(s.yard + out.yards, 0, 100)
  const scored = endYard >= 100 && !out.turnover
  if (!out.turnover && (scored || out.yards >= s.distance)) {
    offS.firstDowns += 1
    if (s.down === 3) offS.thirdDownConv += 1
  }
  pushPlay(s, { ...out, startYard: s.yard, endYard: scored ? 100 : endYard, down: s.down, distance: s.distance, offClass: offClassFor(concept.type, concept.depth), defCall: userDefCall ?? (defIsUser ? defCallForPlan(planFor(defId, 'def') ?? BALANCED_PLAN) : undefined) })

  if (out.turnover) {
    swapPossession(s)
    s.yard = 100 - clamp(s.yard + out.yards, 1, 99)
    s.down = 1
    s.distance = 10
    return 'continue'
  }

  if (scored) {
    const scorer = out.carrierId ? (world.players.find((p) => p.id === out.carrierId)?.name ?? '') : ''
    if (offId === s.homeId) s.homeScore += 6
    else s.awayScore += 6
    offS.points += 6
    offS.td += 1
    if (isPass) offS.passTD += 1
    else offS.rushTD += 1
    const last = s.plays[s.plays.length - 1]
    last.result = 'TOUCHDOWN!'
    last.scorerName = scorer
    last.scorerId = out.carrierId
    // extra point / two-point try (in overtime it's sudden death — no try needed)
    if (s.qtr <= 4) {
      s.phase = 'try'
      return 'continue'
    }
    swapPossession(s)
    s.yard = 25
    s.down = 1
    s.distance = 10
    pushPlay(s, { type: 'end', concept: 'Overtime', yards: 0, result: 'Walk-off score — Final (OT)', startYard: s.yard, endYard: s.yard, down: null, distance: null, timeUsed: 0 })
    return 'done'
  }

  s.yard = endYard
  const gained = out.yards
  if (gained >= s.distance) {
    s.down = 1
    s.distance = Math.min(10, 100 - s.yard)
  } else {
    s.down += 1
    s.distance -= gained
    if (s.down > 4) {
      // failed to convert on 4th (go-for-it), turnover on downs
      swapPossession(s)
      s.yard = 100 - s.yard
      s.down = 1
      s.distance = 10
      return 'continue'
    }
  }
  return 'continue'
}

/**
 * Advance the game until a decision is due or it ends. Delegates to `runUntil`
 * so the paused and full-sim paths share one loop (L10 G1).
 */
export function runToMoment(world: World, s: GameState): Moment | null {
  return runUntil(world, s, 'moment')
}

/**
 * Advance the game, stopping between steps at the requested granularity (L11.5
 * Q2). The stop is only ever observed *between* steps — never inside one — so
 * the RNG stream and every resolved play are exactly what a full run-to-moment
 * would draw.
 *  - `'play'`   → one step that produces a play (or a moment), then stop.
 *  - `'drive'`  → until the possession changes, a moment, or the game ends.
 *  - `'moment'` → until the next moment or the game ends.
 */
export function runUntil(world: World, s: GameState, stop: 'play' | 'drive' | 'moment'): Moment | null {
  for (;;) {
    if (s.done) return null
    const playsBefore = s.plays.length
    const offBefore = s.offId
    const r = step(world, s)
    if (r === 'moment') return s.pending
    if (r === 'done') {
      s.done = true
      return null
    }
    if (stop === 'moment') continue
    if (stop === 'play' && s.plays.length > playsBefore) return null
    if (stop === 'drive' && s.offId !== offBefore) return null
  }
}

/** Record the user's answer for state.pending (must be one of its option ids). */
export function answerMoment(s: GameState, choiceId: string, source: 'user' | 'standing' = 'user'): void {
  const m = s.pending
  if (!m) return
  if (!m.options.some((o) => o.id === choiceId)) return
  s.answers[m.id] = choiceId
  if (source === 'standing') (s.autoAnswered ??= {})[m.id] = true
  s.pending = null
}

export function finishGame(s: GameState): GameSim {
  return {
    homeId: s.homeId,
    awayId: s.awayId,
    homeScore: s.homeScore,
    awayScore: s.awayScore,
    plays: s.plays,
    stats: s.stats,
    decisions: s.decisions.length ? s.decisions : undefined,
  }
}

export function simulatePlayByPlay(world: World, homeId: string, awayId: string, seed: number, ctx?: GameCtx): GameSim {
  const s = createGame(world, homeId, awayId, seed, ctx)
  for (let m = runToMoment(world, s); m; m = runToMoment(world, s)) answerMoment(s, m.defaultId, 'standing')
  return finishGame(s)
}

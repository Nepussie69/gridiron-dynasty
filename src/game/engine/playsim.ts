// ─────────────────────────────────────────────────────────────────────────────
// Play-by-play simulation
//
// Every play is resolved from the *exact* player ratings (Madden 26 / CFB 26)
// and the coaching schemes from each club's coordinators. The output is a full
// play log with enough geometry for the 2D top-down match viewer.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player, Position } from '../types'
import { attributesFor } from '../data/ratings'
import { bucketYards, CFB_CHUNK_DAMP, getCalibration, sampleBucket } from '../data/calibration'
import { coachEffect } from './coaching'
import { depthGroup } from './depth'
import { planEffects } from './gameplan'
import { aiCallSheet, fourthDownChoice, fourthDownEV, twoPointChoice, fgProb, type CallSheet, type Situation } from './decisions'
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
import { clamp, makeRng, type Rng } from './rng'

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
  // attribution for individual stats
  qbId?: string
  tackleIds?: string[]
  sackId?: string
  intId?: string
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
  homeLines?: { playerId: string; line: import('../types').GameStatLine }[]
  awayLines?: { playerId: string; line: import('../types').GameStatLine }[]
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

function topGroup(world: World, teamId: string, positions: Position[], n: number): Player[] {
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
interface Concept {
  name: string
  type: 'run' | 'pass'
  depth: number // intended air yards (pass) or target gap (run)
  yac: number // yards-after-catch appetite 0-1
}

interface OffenseStyle {
  passRate: number
  concepts: Concept[]
}

const OFF_STYLES: Record<string, OffenseStyle> = {
  'Air Raid': {
    passRate: 0.62,
    concepts: [
      { name: 'Four Verticals', type: 'pass', depth: 20, yac: 0.4 },
      { name: 'Y-Cross', type: 'pass', depth: 12, yac: 0.6 },
      { name: 'Mesh', type: 'pass', depth: 6, yac: 0.8 },
      { name: 'Smash', type: 'pass', depth: 11, yac: 0.5 },
      { name: 'RB Screen', type: 'pass', depth: 1, yac: 1.0 },
      { name: 'Inside Zone', type: 'run', depth: 4, yac: 0 },
    ],
  },
  'Pro Style': {
    passRate: 0.5,
    concepts: [
      { name: 'Play Action Deep', type: 'pass', depth: 22, yac: 0.3 },
      { name: 'PA Cross', type: 'pass', depth: 14, yac: 0.5 },
      { name: 'Bootleg', type: 'pass', depth: 8, yac: 0.7 },
      { name: 'Inside Zone', type: 'run', depth: 4, yac: 0 },
      { name: 'Power', type: 'run', depth: 3, yac: 0 },
    ],
  },
  Spread: {
    passRate: 0.55,
    concepts: [
      { name: 'Four Verts', type: 'pass', depth: 17, yac: 0.4 },
      { name: 'Quick Slant', type: 'pass', depth: 5, yac: 0.9 },
      { name: 'RPO Bubble', type: 'pass', depth: 2, yac: 1.0 },
      { name: 'Outside Zone', type: 'run', depth: 5, yac: 0 },
      { name: 'QB Draw', type: 'run', depth: 4, yac: 0 },
    ],
  },
  'West Coast': {
    passRate: 0.53,
    concepts: [
      { name: 'Mesh', type: 'pass', depth: 6, yac: 0.9 },
      { name: 'Slant', type: 'pass', depth: 5, yac: 0.9 },
      { name: 'RB Screen', type: 'pass', depth: 1, yac: 1.0 },
      { name: 'Bootleg', type: 'pass', depth: 8, yac: 0.7 },
      { name: 'Inside Zone', type: 'run', depth: 4, yac: 0 },
    ],
  },
  'RPO Heavy': {
    passRate: 0.47,
    concepts: [
      { name: 'RPO Pass', type: 'pass', depth: 8, yac: 0.8 },
      { name: 'Quick Slant', type: 'pass', depth: 5, yac: 0.9 },
      { name: 'RPO Run', type: 'run', depth: 4, yac: 0 },
      { name: 'Inside Zone', type: 'run', depth: 4, yac: 0 },
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

function offStyle(world: World, teamId: string): OffenseStyle {
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

/** L10 F2: how much a pass-leaning user plan is read by the defense, per point of passBias. */
const PASS_LEAN_PRESSURE = 4
const PASS_LEAN_COMP = 0.024
const PASS_LEAN_EDGE = 0.6

function resolvePass(world: World, rng: Rng, offId: string, defId: string, concept: Concept, yard: number, passShare = 0.57, tier: 'NFL' | 'FBS' = 'NFL', clutch = 0): PlayOutcome {
  const ocEff = ocEffect(world, offId)
  const dcEff = ocEffect(world, defId)
  const qb = topGroup(world, offId, ['QB'], 1)[0]
  const wrs = topGroup(world, offId, ['WR', 'TE'], 4)
  const ol = topGroup(world, offId, ['OT', 'OG', 'C'], 5)
  const rb = topGroup(world, offId, ['RB'], 1)[0]
  const dl = topGroup(world, defId, ['DE', 'DT'], 4)
  const lbs = topGroup(world, defId, ['LB'], 3)
  const cbs = topGroup(world, defId, ['CB'], 3)
  const saf = topGroup(world, defId, ['S'], 2)
  const dStyle = defStyle(world, defId)
  const ocScheme = (world.staff[offId] ?? []).find((s) => s.role === 'Offensive Coordinator')?.scheme

  const qbA = qb ? mkAttrs(qb) : {}
  const qbStyle = qb ? styleProfile(qb) : styleProfile({ traits: [''] } as Player)
  const qbFit = qb ? schemeFit(qb, ocScheme, 'OFF') : 0.5
  const pressure = avg(dl.map((p) => Math.max(mkAttrs(p).PMV ?? 70, mkAttrs(p).FMV ?? 70)))
  const protection = avg(ol.map((p) => mkAttrs(p).PBK ?? 70))
  const defPlan = planFor(defId, 'def')
  const blitz = rng() < clamp(dStyle.blitz + (defPlan ? planEffects(defPlan, true).blitz : 0), 0, 0.8)
  // A pass-heavy plan is predictable: the defense pins its ears back and sits
  // on the throws (balances the passing game's natural edge over the run).
  const passLean = Math.max(0, planFor(offId, 'off')?.passBias ?? 0)
  const pressureEdge = pressure - protection + (blitz ? 9 : 0) + (concept.depth > 15 ? 4 : 0) - ocEff.offEdge * 0.5 + dcEff.defEdge * 0.5
    + (defPlan && defPlan.aggression >= 1.5 ? 3 : 0) + passLean * PASS_LEAN_PRESSURE
  // Real rate is ~6.9% of dropbacks (NFL) / higher pressure in college; scaled by pass share.
  const sackChance = clamp((0.069 + pressureEdge * 0.0012) * (passShare) * (tier === 'FBS' ? 0.75 : 1), 0.02, 0.13)

  // Target selection: a scheme-fitting, style-appropriate receiver gets more looks.
  const scored = wrs.map((w) => {
    const a = mkAttrs(w)
    const st = styleProfile(w)
    const longBall = concept.depth >= 12
    const route = longBall ? (a.DRR ?? w.ovr) : concept.depth >= 7 ? (a.MRR ?? w.ovr) : (a.SRR ?? w.ovr)
    const styleBonus = longBall ? st.deepBias * 14 : st.yacBias * 10 + st.contested * 6
    const fit = schemeFit(w, ocScheme, 'OFF')
    return { w, score: route * 0.6 + (a.SPD ?? w.ovr) * 0.25 + styleBonus + (fit - 0.5) * 16 + rng() * 12 }
  })
  scored.sort((a, b) => b.score - a.score)
  const target = scored[0]?.w ?? rb
  const tA = target ? mkAttrs(target) : {}
  const tStyle = target ? styleProfile(target) : styleProfile({ traits: [''] } as Player)

  if (rng() < sackChance) {
    const y = -Math.round(6 + rng() * 6)
    const sackId = dl[rng() < 0.5 ? 0 : Math.min(1, dl.length - 1)]?.id
    return { type: 'pass', concept: concept.name, yards: y, result: blitz ? 'Sack (blitz)' : 'Sack', turnover: false, pressure: true, timeUsed: 24 + Math.floor(rng() * 12), qbId: qb?.id, sackId }
  }

  const qAccuracy = (qbA.SAC ?? 70) * 0.3 + (qbA.MAC ?? 70) * 0.3 + (qbA.DAC ?? 70) * 0.25 + (qbA.AWR ?? 70) * 0.15
  const separation =
    (concept.depth > 14 ? (tA.DRR ?? 70) : concept.depth > 7 ? (tA.MRR ?? 70) : (tA.SRR ?? 70)) * 0.5 +
    (tA.SPD ?? 70) * 0.3 +
    (tA.AGI ?? 70) * 0.2 +
    tStyle.deepBias * (concept.depth >= 12 ? 6 : -2)
  const coverSkill =
    dStyle.manCoverage * avg(cbs.map((p) => mkAttrs(p).MCV ?? 70)) +
    (1 - dStyle.manCoverage) * avg([...cbs, ...lbs, ...saf].map((p) => mkAttrs(p).ZCV ?? 70))
  const planOverrides = applyDefPlan(defId, dStyle)
  const coverage = coverSkill * dStyle.coverage * planOverrides.coverMult + avg(saf.map((p) => mkAttrs(p).AWR ?? 70)) * 0.08
  const edge = qAccuracy + separation - coverage * 1.15 - concept.depth * 0.5 - 145 // centered ~0
  // Play-action: a run-heavy offense gets a passing bonus as the defense bites.
  const offPassBias = planFor(offId, 'off')?.passBias ?? 0
  const playAction = offPassBias < 0 ? Math.min(2.2, -offPassBias * 1.5) : 0
  const talentEdge = (edge / 4) + (qAccuracy - 72) * 0.4 + (qbFit - 0.5) * 10 + (famMult(qb) - 1) * 90 + playAction - passLean * PASS_LEAN_EDGE

  // Completion probability based on real league rate vs. this matchup. Coordinator
  // quality shifts it: a great OC helps, a great DC hurts.
  const coachShift = (ocEff.offEdge - dcEff.defEdge) * 0.003
  const playActionComp = offPassBias < 0 ? Math.min(0.02, -offPassBias * 0.01) : 0
  const compProb = clamp(
    (0.645 + (qAccuracy + separation - coverage * 1.15 - concept.depth * 0.7 - Math.max(0, pressureEdge) * 0.5) / 900 - (tier === 'FBS' ? 0.02 : 0) + coachShift) * mod(qbStyle.scramble, 0.04) * planOverrides.compMult + clutch * 0.012 + playActionComp - passLean * PASS_LEAN_COMP,
    0.42,
    0.74,
  )
  const intProb = clamp(0.014 * (1 - (qAccuracy - coverage) / 300) * (1 - avg(saf.map((p) => styleProfile(p).ballHawk)) * 0.15) * planOverrides.intMult * (1 - clutch * 0.03), 0.005, 0.06)

  if (rng() < intProb) {
    const ballHawk = [...cbs, ...saf].sort((a, b) => styleProfile(b).ballHawk - styleProfile(a).ballHawk)[0]
    return {
      type: 'pass', concept: concept.name, yards: 0, result: 'Interception!', turnover: true,
      timeUsed: 22 + Math.floor(rng() * 12), pressure: pressureEdge > 6, qbId: qb?.id, intId: ballHawk?.id,
    }
  }
  if (rng() < compProb) {
    const gains: string[] = []
    const catchSkill = (tA.CTH ?? 70) * 0.5 + (tA.SPC ?? 70) * 0.2 + (tA.BTK ?? 70) * 0.3 + tStyle.contested * 8
    let gain = sampleYards(rng, true, talentEdge + (catchSkill - 72), gains, yard, tier)
    // Live defensive plan bends the explosive part of a play: soft zone caps
    // them, press man risks them. Underneath gains are left alone.
    if (gain > 15) gain = 15 + Math.round((gain - 15) * planOverrides.bigPlayRisk)
    // Style-driven YAC: playmakers and elusive receivers add yards after the catch.
    if (gain > 0) gain += Math.round(tStyle.yacBias * 2.5 * (0.5 + rng()) + tStyle.elusiveness * (1 + rng() * 3))
    if (yard >= 88) gain += 4
    else if (yard >= 80) gain += 2
    gain = clamp(gain, -8, 85)
    const big = gain >= 25
    return {
      type: 'pass', concept: concept.name, yards: gain, result: big ? 'Explosive play!' : 'Complete',
      turnover: false, carrierId: target?.id, targetId: target?.id, passDepth: concept.depth, bigPlay: big,
      timeUsed: 24 + Math.floor(rng() * 16), qbId: qb?.id,
    }
  }
  return { type: 'pass', concept: concept.name, yards: 0, result: 'Incomplete', turnover: false, targetId: target?.id, passDepth: concept.depth, pressure: pressureEdge > 6, timeUsed: 20 + Math.floor(rng() * 14), qbId: qb?.id }
}

function resolveRun(world: World, rng: Rng, offId: string, defId: string, concept: Concept, distance: number, yard: number, tier: 'NFL' | 'FBS' = 'NFL', clutch = 0): PlayOutcome {
  const ocEff = ocEffect(world, offId)
  const dcEff = ocEffect(world, defId)
  const rb = topGroup(world, offId, ['RB'], 2)
  void dcEff
  const ol = topGroup(world, offId, ['OT', 'OG', 'C'], 5)
  const dl = topGroup(world, defId, ['DE', 'DT'], 4)
  const lbs = topGroup(world, defId, ['LB'], 3)
  const dStyle = defStyle(world, defId)
  const ocScheme = (world.staff[offId] ?? []).find((s) => s.role === 'Offensive Coordinator')?.scheme
  const carrier = rb[0]
  const cA = carrier ? mkAttrs(carrier) : {}
  const cStyle = carrier ? styleProfile(carrier) : styleProfile({ traits: [''] } as Player)
  const cFit = carrier ? schemeFit(carrier, ocScheme, 'OFF') : 0.5

  const runBlock = avg(ol.map((p) => (mkAttrs(p).RBK ?? 70) * 0.7 + (mkAttrs(p).IMP ?? 70) * 0.3))
  const runDefBase = avg(dl.map((p) => (mkAttrs(p).BSH ?? 70) * 0.5 + (mkAttrs(p).TAK ?? 70) * 0.5)) * dStyle.runFit
  // The live defensive plan moves the front: stacking the box stops the run,
  // a soft-zone light box gives a little back on the ground.
  const dp = planFor(defId, 'def')
  const runDef = dp
    ? runDefBase * (1 + (dp.aggression - 0.5) * 0.06 - (dp.coverage <= 0 ? 0.03 : 0))
    : runDefBase
  const lbsDef = avg(lbs.map((p) => (mkAttrs(p).TAK ?? 70) * 0.6 + (mkAttrs(p).PUR ?? 70) * 0.4))
  const elusiveness = (cA.BCV ?? 70) * 0.35 + (cA.JKM ?? 70) * 0.2 + (cA.TRK ?? 70) * 0.25 + (cA.SPD ?? 70) * 0.2

  // Real NFL run distribution, tilted by line + back vs. front seven, plus back style.
  const styleEdge = cStyle.power * 14 + cStyle.elusiveness * 10 + (cFit - 0.5) * 12
  // A pass-heavy offense runs against lighter boxes — make them pay on the ground.
  const offPassBiasRun = planFor(offId, 'off')?.passBias ?? 0
  const boxLight = Math.max(0, offPassBiasRun) * 1.8
  const edge = (runBlock - 72) * 0.7 + (elusiveness - 72) * 0.6 - (runDef - 72) * 0.5 - (lbsDef - 72) * 0.3 + styleEdge + ocEff.offEdge * 2 - dcEff.defEdge * 2 + (famMult(carrier) - 1) * 40 + clutch * 1.4 + boxLight
  const gains: string[] = []
  const runGain = sampleYards(rng, false, edge * 0.25, gains, yard, tier)
  // College front sevens miss more tackles; keep the curve but soften the negative tail.
  let gain = tier === 'FBS' && runGain < 0 ? Math.round(runGain * 0.7) : runGain
  if (distance <= 2) gain += (rng() < 0.35 ? 2 : 1) + Math.round(cStyle.power * 1.5)
  if (yard >= 95) gain += 4
  else if (yard >= 88) gain += 2
  gain = clamp(gain, -10, 90)
  const isBig = gain >= 20
  const fumble = rng() < 0.011 * (1 - cStyle.power * 0.2)
  const tacklers = [...lbs, ...dl].filter(Boolean).map((p) => p.id)
  const tackleIds = fumble ? [] : tacklers
  return {
    type: 'run', concept: concept.name, yards: gain, result: isBig ? 'Big run!' : 'Rush',
    turnover: fumble, carrierId: carrier?.id, bigPlay: isBig,
    timeUsed: 30 + Math.floor(rng() * 14), qbId: undefined, tackleIds,
  }
}

function resolveSpecial(world: World, rng: Rng, offId: string, type: 'punt' | 'fg', yard: number): PlayOutcome {
  if (type === 'fg') {
    const k = topGroup(world, offId, ['K'], 1)[0]
    const kA = k ? mkAttrs(k) : {}
    const dist = 100 - yard + 17
    const power = (kA.KPW ?? 78) * 0.5 + (kA.KAC ?? 78) * 0.5
    const good = rng() < fgProb(yard, power)
    return {
      type: 'fg', concept: `${dist}-yard field goal`, yards: 0,
      result: good ? `${dist}-yd FG is good` : `${dist}-yd FG is no good`,
      turnover: !good, timeUsed: 5,
    }
  }
  const p = topGroup(world, offId, ['P'], 1)[0]
  const pA = p ? mkAttrs(p) : {}
  const net = 38 + Math.round(((pA.KPW ?? 80) - 78) * 0.4 + rng() * 14)
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
}
export interface GameCtx {
  userTeamId: string
  scope: 'off' | 'def' | 'both' | 'hc' // 'hc' = head coach; 'off'/'def'/'both' = coordinator focus
  callSheet: CallSheet
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
}

const MAX_PLAYS = 210

function statFor(s: GameState, id: string) {
  return id === s.homeId ? s.stats.home : s.stats.away
}

function swapPossession(s: GameState) {
  const t = s.offId
  s.offId = s.defId
  s.defId = t
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
  fourth: 3, two: 2, call: 3, defCall: 3, twoMinute: 2, clock: 1, halftime: 1, qbChange: 1,
}
const TOTAL_MOMENT_CAP = 8

interface DecisionSpec {
  kind: MomentKind
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

function logDecision(s: GameState, id: string, spec: DecisionSpec, choiceId: string, source: 'user' | 'standing') {
  s.decisions.push({
    momentId: id, kind: spec.kind, choiceId, defaultId: spec.defaultId, source,
    qtr: spec.qtr, yard: spec.yard, down: spec.down, distance: spec.distance, margin: spec.margin, ep: spec.ep,
  })
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
    logDecision(s, id, spec, s.answers[id], 'user')
    return s.answers[id]
  }
  const canAsk = isUser && s.ctx!.scope === 'hc' && spec.ask &&
    s.momentsUsed < TOTAL_MOMENT_CAP && (s.kindUsed[spec.kind] ?? 0) < MOMENT_CAPS[spec.kind]
  if (canAsk) {
    const us = spec.teamId === s.homeId ? s.homeScore : s.awayScore
    const them = spec.teamId === s.homeId ? s.awayScore : s.homeScore
    s.pending = {
      id, kind: spec.kind, teamId: spec.teamId, qtr: spec.qtr, clock: spec.clock,
      down: spec.down, distance: spec.distance, yard: spec.yard, us, them,
      title: spec.title, options: spec.options, defaultId: spec.defaultId, staffRead: spec.staffRead,
    }
    s.momentsUsed += 1
    s.kindUsed[spec.kind] = (s.kindUsed[spec.kind] ?? 0) + 1
    return null
  }
  if (isUser) logDecision(s, id, spec, spec.defaultId, 'standing')
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
    kind: 'fourth', teamId: s.offId, qtr: s.qtr, clock: fmtClock(s.clock), down: 4, distance: s.distance,
    yard: s.yard, title: `4th & ${s.distance} at ${yardText}`, options, defaultId,
    staffRead: `Staff EV — Go ${fmtEV(ev.go)} · FG ${ev.fg == null ? '—' : fmtEV(ev.fg)} · Punt ${fmtEV(ev.punt)}`,
    ask, margin, ep: ev.go,
  })
  if (choice == null) return null
  return choice as 'go' | 'fg' | 'punt'
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
  }
  s.defId = s.offId === homeId ? awayId : homeId
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

/** Halftime: possession flips to start Q3. (G6 adds the adjustment moment here.) */
function stepHalftime(s: GameState): 'continue' {
  s.qtr = 3
  s.clock = 900
  swapPossession(s)
  s.yard = 25
  s.down = 1
  s.distance = 10
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
    kind: 'two', teamId: offId, qtr: s.qtr, clock: fmtClock(s.clock), down: null, distance: null, yard: 98,
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
    const out = concept.type === 'pass'
      ? resolvePass(world, s.rng, offId, s.defId, concept, 98, style.passRate, s.tier, clutchFor(world, offId, 4, 98))
      : resolveRun(world, s.rng, offId, s.defId, concept, 2, 98, s.tier, clutchFor(world, offId, 4, 98))
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
  if (s.phase === 'halftime') return stepHalftime(s)

  if (s.clock <= 0) return stepClock(s)

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
  const concept = pickConcept(s.rng, style, s.down, s.distance, s.passAdj + planPassAdj)
  const isFourth = s.down === 4

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

  // Offensive penalty (~2.5%) — 5 yards, replay the down.
  const offDisc = ocEffect(world, offId).discipline
  if (s.rng() < 0.025 * offDisc) {
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
      const out = resolveSpecial(world, s.rng, offId, 'fg', s.yard)
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
    const out = resolveSpecial(world, s.rng, offId, 'punt', s.yard)
    s.clock -= out.timeUsed * s.pace
    const newYard = clamp(s.yard + out.yards, 1, 99)
    pushPlay(s, { ...out, startYard: s.yard, endYard: newYard, down: 4, distance: s.distance })
    swapPossession(s)
    s.yard = 100 - newYard
    s.down = 1
    s.distance = 10
    return 'continue'
  }

  const out = concept.type === 'pass'
    ? resolvePass(world, s.rng, offId, defId, concept, s.yard, offStyle(world, offId).passRate, s.tier, clutchFor(world, offId, s.down, s.yard))
    : resolveRun(world, s.rng, offId, defId, concept, s.distance, s.yard, s.tier, clutchFor(world, offId, s.down, s.yard))

  s.clock -= out.timeUsed * s.pace * baseTimeScale(offId)
  const offS = statFor(s, offId)
  const defS = statFor(s, defId)
  const isPass = out.type === 'pass'
  offS.plays += 1
  if (isPass) {
    offS.passAtt += 1
    if (out.yards < 0) { offS.sacksTaken += 1; defS.sacks += 1 }
    else if (out.turnover) { offS.ints += 1; defS.ints += 1 }
    else if (out.result !== 'Incomplete') { offS.passComp += 1; offS.passYds += Math.max(0, out.yards) }
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
  pushPlay(s, { ...out, startYard: s.yard, endYard: scored ? 100 : endYard, down: s.down, distance: s.distance })

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

/** Advance until the user must decide (returns the Moment; state.pending is set) or the game ends. */
export function runToMoment(world: World, s: GameState): Moment | null {
  for (;;) {
    const r = step(world, s)
    if (r === 'moment') return s.pending
    if (r === 'done') {
      s.done = true
      return null
    }
  }
}

/** Record the user's answer for state.pending (must be one of its option ids). */
export function answerMoment(s: GameState, choiceId: string): void {
  const m = s.pending
  if (!m) return
  if (!m.options.some((o) => o.id === choiceId)) return
  s.answers[m.id] = choiceId
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
  for (let m = runToMoment(world, s); m; m = runToMoment(world, s)) answerMoment(s, m.defaultId)
  return finishGame(s)
}

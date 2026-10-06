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
  sacks: number
  firstDowns: number
  thirdDownAtt: number
  thirdDownConv: number
  fgAtt: number
  fgMade: number
  td: number
  top: number // time of possession, seconds
}

function emptyStats(): TeamGameStats {
  return {
    plays: 0, points: 0, passAtt: 0, passComp: 0, passYds: 0, passTD: 0, ints: 0,
    rushAtt: 0, rushYds: 0, rushTD: 0, fumbles: 0, sacks: 0, firstDowns: 0,
    thirdDownAtt: 0, thirdDownConv: 0, fgAtt: 0, fgMade: 0, td: 0, top: 0,
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
  const compMult = 1 - (cov - 0.5) * 0.10 // man = lower completion, zone = higher
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
  const blitz = rng() < clamp(dStyle.blitz + (planFor(defId, 'def') ? planEffects(planFor(defId, 'def')!, true).blitz : 0), 0, 0.8)
  const pressureEdge = pressure - protection + (blitz ? 9 : 0) + (concept.depth > 15 ? 4 : 0) - ocEff.offEdge * 0.5 + dcEff.defEdge * 0.5
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
  const talentEdge = (edge / 4) + (qAccuracy - 72) * 0.4 + (qbFit - 0.5) * 10 + (famMult(qb) - 1) * 90 + playAction

  // Completion probability based on real league rate vs. this matchup. Coordinator
  // quality shifts it: a great OC helps, a great DC hurts.
  const coachShift = (ocEff.offEdge - dcEff.defEdge) * 0.003
  const playActionComp = offPassBias < 0 ? Math.min(0.02, -offPassBias * 0.01) : 0
  const compProb = clamp(
    (0.645 + (qAccuracy + separation - coverage * 1.15 - concept.depth * 0.7 - Math.max(0, pressureEdge) * 0.5) / 900 - (tier === 'FBS' ? 0.02 : 0) + coachShift) * mod(qbStyle.scramble, 0.04) * planOverrides.compMult + clutch * 0.012 + playActionComp,
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
    // Live defensive plan bends explosive plays: soft zone caps them, press man risks them.
    if (gain > 0) gain = Math.round(gain * planOverrides.bigPlayRisk)
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
  const runDef = avg(dl.map((p) => (mkAttrs(p).BSH ?? 70) * 0.5 + (mkAttrs(p).TAK ?? 70) * 0.5)) * dStyle.runFit
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
    const make = clamp(0.99 - Math.max(0, dist - 33) * 0.015 + (power - 80) * 0.004, 0.45, 0.99)
    const good = rng() < make
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

export function simulatePlayByPlay(world: World, homeId: string, awayId: string, seed: number): GameSim {
  const rng = makeRng(seed)
  const plays: Play[] = []
  let homeScore = 0
  let awayScore = 0
  const stats = { home: emptyStats(), away: emptyStats() }
  const statFor = (id: string) => (id === homeId ? stats.home : stats.away)
  const pace = world.byId[homeId].tier === 'NFL' ? 0.9 : 0.78 // college runs more plays
  const passAdj = world.byId[homeId].tier === 'NFL' ? 0 : -0.09
  const isCollege = world.byId[homeId].tier !== 'NFL'
  const tier: 'NFL' | 'FBS' = isCollege ? 'FBS' : 'NFL'
  // College games stop the clock more (incompletions, first downs), giving more snaps.
  const playTime = isCollege ? 0.88 : 1
  void playTime
  // Tempo is re-read each play so a live plan change takes effect immediately.
  const baseTimeScale = (id: string) => {
    const p = planFor(id, 'off')
    return p ? planEffects(p, false).timeScale : 1
  }

  let qtr = 1
  let clock = 900
  let offId = rng() < 0.5 ? homeId : awayId
  let defId = offId === homeId ? awayId : homeId
  let yard = 25
  let down = 1
  let distance = 10
  let n = 0
  const ot = false
  void ot

  const pushPlay = (p: Omit<Play, 'n' | 'qtr' | 'clock' | 'offId' | 'defId' | 'homeScore' | 'awayScore'>) => {
    plays.push({ n: n++, qtr, clock: fmtClock(clock), offId, defId, homeScore, awayScore, ...p })
  }

  // opening kickoff
  pushPlay({ type: 'kickoff', concept: 'Kickoff', yards: 0, result: 'Touchback', startYard: 25, endYard: 25, down: null, distance: null, timeUsed: 5 })

  const MAX = 210
  while (n < MAX) {
    if (clock <= 0) {
      if (qtr === 2) {
        pushPlay({ type: 'end', concept: 'End of Half', yards: 0, result: 'Halftime', startYard: yard, endYard: yard, down: null, distance: null, timeUsed: 0 })
      }
      if (qtr === 4) {
        if (homeScore === awayScore) {
          // Overtime: 10-minute period, first score wins (simplified).
          qtr += 1
          clock = 600
          const t = offId
          offId = defId
          defId = t
          yard = 25
          down = 1
          distance = 10
          pushPlay({ type: 'end', concept: 'End of Regulation', yards: 0, result: 'Tied — Overtime', startYard: yard, endYard: yard, down: null, distance: null, timeUsed: 0 })
          continue
        }
        pushPlay({ type: 'end', concept: 'End of Regulation', yards: 0, result: 'Final', startYard: yard, endYard: yard, down: null, distance: null, timeUsed: 0 })
        break
      }
      if (qtr >= 5) {
        pushPlay({ type: 'end', concept: 'End of Overtime', yards: 0, result: 'Final (OT)', startYard: yard, endYard: yard, down: null, distance: null, timeUsed: 0 })
        break
      }
      qtr += 1
      clock = 900
      if (qtr === 3) {
        // halftime: possession flips
        const t = offId
        offId = defId
        defId = t
        yard = 25
        down = 1
        distance = 10
      }
      continue
    }

    const style = offStyle(world, offId)
    const offPlan = planFor(offId, 'off')
    const planPassAdj = offPlan ? planEffects(offPlan, false).passAdj : 0
    const concept = pickConcept(rng, style, down, distance, passAdj + planPassAdj)
    const isFourth = down === 4

    // Defensive penalty (~3.5%) — 5 yards and an automatic first down, like real drive extenders.
    const defDisc = ocEffect(world, defId).discipline
    if (rng() < 0.035 * defDisc) {
      const penS = statFor(offId)
      const startY = yard
      yard = clamp(yard + 5, 1, 99)
      penS.plays += 1
      penS.firstDowns += 1
      const t = 18 * pace
      clock -= t
      penS.top += t
      pushPlay({ type: 'penalty', concept: 'Defensive Penalty', yards: 5, result: '5-yard penalty, automatic first down', turnover: false, startYard: startY, endYard: yard, down, distance, timeUsed: 18 })
      down = 1
      distance = Math.min(10, 100 - yard)
      continue
    }

    // Offensive penalty (~2.5%) — 5 yards, replay the down.
    const offDisc = ocEffect(world, offId).discipline
    if (rng() < 0.025 * offDisc) {
      const penS = statFor(offId)
      const startY = yard
      yard = clamp(yard - 5, 1, 99)
      penS.plays += 1
      const t = 22 * pace
      clock -= t
      penS.top += t
      pushPlay({ type: 'penalty', concept: 'Offensive Penalty', yards: -5, result: '5-yard penalty, replay down', turnover: false, startYard: startY, endYard: yard, down, distance, timeUsed: 22 })
      distance = Math.min(distance + 5, 100 - yard)
      continue
    }

    // 4th-down decision
    if (isFourth) {
      const inFgRange = yard >= 52
      const goForIt = distance <= (yard >= 85 ? 4 : 2) && (!inFgRange ? yard >= 40 : rng() < (yard >= 85 ? 0.6 : 0.35))
      if (!goForIt && inFgRange) {
        const out = resolveSpecial(world, rng, offId, 'fg', yard)
        clock -= out.timeUsed * pace
        const good = !out.turnover
        const fgS = statFor(offId)
        fgS.fgAtt += 1
        if (good) {
          if (offId === homeId) homeScore += 3
          else awayScore += 3
          fgS.points += 3
          fgS.fgMade += 1
        }
        pushPlay({ ...out, startYard: yard, endYard: yard, down: 4, distance })
        const t = offId; offId = defId; defId = t; yard = 25; down = 1; distance = 10
        continue
      }
      if (!goForIt) {
        const out = resolveSpecial(world, rng, offId, 'punt', yard)
        clock -= out.timeUsed * pace
        const newYard = clamp(yard + out.yards, 1, 99)
        pushPlay({ ...out, startYard: yard, endYard: newYard, down: 4, distance })
        const t = offId; offId = defId; defId = t
        yard = 100 - newYard
        down = 1; distance = 10
        continue
      }
    }

    const out = concept.type === 'pass'
      ? resolvePass(world, rng, offId, defId, concept, yard, offStyle(world, offId).passRate, tier, clutchFor(world, offId, down, yard))
      : resolveRun(world, rng, offId, defId, concept, distance, yard, tier, clutchFor(world, offId, down, yard))

    clock -= out.timeUsed * pace * baseTimeScale(offId)
    const offS = statFor(offId)
    const defS = statFor(defId)
    const isPass = out.type === 'pass'
    offS.plays += 1
    if (isPass) {
      offS.passAtt += 1
      if (out.yards < 0) { offS.sacks += 1; defS.sacks += 1 }
      else if (out.turnover) { offS.ints += 1; defS.ints += 1 }
      else if (out.result !== 'Incomplete') { offS.passComp += 1; offS.passYds += Math.max(0, out.yards) }
    } else {
      offS.rushAtt += 1
      offS.rushYds += Math.max(0, out.yards)
      if (out.turnover) offS.fumbles += 1
    }
    offS.top += out.timeUsed * pace
    if (down === 3) offS.thirdDownAtt += 1

    const endYard = clamp(yard + out.yards, 0, 100)
    const scored = endYard >= 100 && !out.turnover
    if (!out.turnover && (scored || out.yards >= distance)) {
      offS.firstDowns += 1
      if (down === 3) offS.thirdDownConv += 1
    }
    pushPlay({ ...out, startYard: yard, endYard: scored ? 100 : endYard, down, distance })

    if (out.turnover) {
      const t = offId; offId = defId; defId = t
      yard = 100 - clamp(yard + out.yards, 1, 99)
      down = 1; distance = 10
      continue
    }

    if (scored) {
      const scorer = out.carrierId ? (world.players.find((p) => p.id === out.carrierId)?.name ?? '') : ''
      if (offId === homeId) homeScore += 6
      else awayScore += 6
      offS.points += 6
      offS.td += 1
      if (isPass) offS.passTD += 1
      else offS.rushTD += 1
      plays[plays.length - 1].result = 'TOUCHDOWN!'
      plays[plays.length - 1].scorerName = scorer
      plays[plays.length - 1].scorerId = out.carrierId
      // extra point (in overtime it's sudden death — no PAT needed)
      if (qtr <= 4) {
        const pat = resolvePAT(world, rng, offId)
        clock -= pat.timeUsed * pace
        if (!pat.turnover) {
          if (offId === homeId) homeScore += 1
          else awayScore += 1
          offS.points += 1
        }
        pushPlay({ ...pat, startYard: 2, endYard: 2, down: null, distance: null })
      }
      const t = offId; offId = defId; defId = t
      yard = 25; down = 1; distance = 10
      if (qtr >= 5) {
        pushPlay({ type: 'end', concept: 'Overtime', yards: 0, result: 'Walk-off score — Final (OT)', startYard: yard, endYard: yard, down: null, distance: null, timeUsed: 0 })
        break
      }
      pushPlay({ type: 'kickoff', concept: 'Kickoff', yards: 0, result: 'Touchback', startYard: 25, endYard: 25, down: null, distance: null, timeUsed: 5 })
      continue
    }

    yard = endYard
    const gained = out.yards
    if (gained >= distance) {
      down = 1
      distance = Math.min(10, 100 - yard)
    } else {
      down += 1
      distance -= gained
      if (down > 4) {
        // failed to convert on 4th (go-for-it), turnover on downs
        const t = offId; offId = defId; defId = t
        yard = 100 - yard
        down = 1; distance = 10
        continue
      }
    }
  }

  return { homeId, awayId, homeScore, awayScore, plays, stats }
}

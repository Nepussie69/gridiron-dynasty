// ─────────────────────────────────────────────────────────────────────────────
// Balance & difficulty harness.
//
// Runs whole seasons headlessly with no UI, mirroring the real game loop
// (regular season → playoffs → development/contracts → coaching continuity →
// career review & promotion → draft → free agency), and reports the metrics
// that tell us whether the long arc is fun:
//
//   · parity      — is the win distribution spread out, or is everyone .500?
//   · cap pressure — how many clubs are squeezed, and how many are over?
//   · pacing       — how many seasons does it take to climb the career ladder?
//   · continuity   — does cohesion actually build over time?
//
// This lives in the engine (not the store) so it can run on a throwaway world
// without touching the player's live save. Drive it in dev with
// `__balanceProbe(seasons)`.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, Player, Position, Recommendation } from '../types'
import { summarizeCap } from './cap'
import { NFL_TEAMS } from '../data/nflTeams'
import {
  buildWorld,
  regenerateSchedule,
  teamStrength,
  zeroRecord,
  type World,
} from './generate'
import { refreshProspectClass, developPlayers, evaluateScouting, runAIFreeAgency, runAIResign, runAITrades, enforceCapCompliance, tickAllContracts } from './progress'
import { gainSeasonTraining, refreshCohesion, teamCohesion } from './playbook'
import { awardCompensatoryPicks, initDraft, runUDFAs, simulateRestOfDraft } from './draft'
import { readRookieRanges } from './evaluation'
import { ensureDraftWindow } from './picks'
import { simulatePlayoffs, simWeek } from './sim'
import { depthAt, STARTERS } from './depth'
import {
  canDraft,
  demote,
  earnSkillPoints,
  generateJobOffers,
  gradeObjectives,
  ladderFor,
  makeInterview,
  minNflLevel,
  promote,
  resolveInterview,
  reviewSeason,
  roleObjectives,
  salaryFor,
  spendSkillPointsEvenly,
  tierFor,
  unitRanks,
  updateRoleMastery,
  ZERO_REP,
  ZERO_SKILLS,
  type Reputation,
  type Skills,
} from './career'
import { clamp, makeRng, type Rng } from './rng'
import type { RealData } from '../data/realData'

export interface BalanceSeason {
  season: number
  level: number
  title: string
  overallRep: number
  jobSecurity: number
  wins: number
  losses: number
  promoted: boolean
  demoted: boolean
  offers: number
}

export interface BalanceReport {
  seasons: BalanceSeason[]
  seasonsToTop: number | null
  promotions: number
  demotions: number
  /** Final-season NFL per-team-per-game points. */
  avgNflPoints: number
  /** Parity: spread of final-season win totals across the 32 NFL clubs. */
  winStdDev: number
  winMin: number
  winMax: number
  /** Cap pressure in the final season. */
  avgSpace: number
  teamsOverCap: number
  teamsTight: number
  /** Diagnostics: mean cap usage as a share of the limit, and roster size. */
  capUsedPct: number
  avgRosterSize: number
  /** Culture: mean team cohesion in the final season (0-1). */
  avgCohesion: number
  /** League health: mean NFL player overall and count of 90+ stars. */
  avgOvr: number
  starCount: number
  retirements: number
  freeAgents: number
  compPicks: number
}

const ARCHETYPE: Record<'coach' | 'personnel', string> = { coach: 'qb', personnel: 'scout' }

function makeCareer(world: World, path: 'coach' | 'personnel'): CareerState {
  const level = minNflLevel(path)
  const t = tierFor(path, level)
  // Seed reputation to the entry rung's gate, exactly as startCareer does, so the
  // bot is a credible candidate for the first NFL job rather than a blank slate.
  const seedRep: Reputation = { ...ZERO_REP }
  for (const [k, v] of Object.entries(t.gate)) {
    ;(seedRep as unknown as Record<string, number>)[k] = Math.max(
      (seedRep as unknown as Record<string, number>)[k] ?? 0,
      (v as number) + 2,
    )
  }
  return {
    gmName: 'Balance Bot',
    path,
    archetype: ARCHETYPE[path],
    teamId: NFL_TEAMS[0].id,
    season: world.season,
    week: world.week,
    reputation: seedRep,
    skills: { ...ZERO_SKILLS },
    level,
    salary: salaryFor(path, level),
    jobSecurity: 70,
    ownerExpectation: '',
    tier: t.tier,
    unitFocus: path === 'coach' ? 'off' : undefined,
    recommendationsMade: 0,
    hits: 0,
    misses: 0,
    seasonRecs: 0,
    seasonHits: 0,
    history: [],
  }
}

function band(grade: number): Recommendation {
  if (grade >= 86) return 'Blue Chip'
  if (grade >= 76) return 'Starter'
  if (grade >= 66) return 'Depth'
  return 'Pass'
}

/** Files a realistic scouting class whose accuracy scales with the user's skill. */
function simulateScouting(world: World, career: CareerState, rng: Rng) {
  const pool = [...world.draft].sort((a, b) => b.trueGrade - a.trueGrade)
  const shuffled = pool.sort(() => rng() - 0.5).slice(0, 14)
  // A scouting career sharpens with investment: skill and experience both tighten
  // the read (the harness models a player who works at it).
  const error = Math.max(2, 15 - career.skills.evaluation * 0.12 - career.level * 1.2)
  for (const p of shuffled) {
    const graded = clamp(Math.round(p.trueGrade + (rng() - 0.5) * error * 2), 40, 99)
    p.myGrade = graded
    p.confidence = 85
    p.recommendation = band(graded)
  }
}

/** Advance coaching continuity the way the store does at season end. */
function advanceTenure(world: World) {
  for (const key of Object.keys(world.staffTenure)) {
    const [teamId, side] = key.split(':')
    const role = side === 'off' ? 'Offensive Coordinator' : 'Defensive Coordinator'
    const coach = (world.staff[teamId] ?? []).find((s) => s.role === role)
    world.staffTenure[key] = coach ? (world.staffTenure[key] ?? 1) + 1 : 1
  }
}

/** Recompute every player's cohesion cap after roster/staff changes. */
function refreshAllCohesion(world: World) {
  for (const [teamId, players] of Object.entries(world.roster)) {
    for (const side of ['off', 'def'] as const) {
      const unit = players.filter((p) => (p.side === 'DEF' ? 'def' : 'off') === side)
      if (!unit.length) continue
      const avgYears = unit.reduce((s, p) => s + (p.playbook?.teamYears ?? 0), 0) / unit.length
      const tenure = world.staffTenure[`${teamId}:${side}`] ?? 1
      for (const p of unit) {
        const next = refreshCohesion(p, tenure, Math.max(1, avgYears))
        if (next) p.playbook = next
      }
    }
  }
}

function resetSeason(world: World) {
  for (const id of Object.keys(world.standings)) world.standings[id] = zeroRecord(id)
  for (const id of Object.keys(world.deadMoney)) world.deadMoney[id] = 0
  world.awards = {}
  regenerateSchedule(world)
  refreshProspectClass(world)
}

export function runBalance(opts: { seasons?: number; seed?: number; path?: 'coach' | 'personnel'; data?: RealData | null; skillPolicy?: boolean } = {}): BalanceReport {
  const seasons = opts.seasons ?? 10
  const path = opts.path ?? 'personnel'
  const rng = makeRng(opts.seed ?? 987654)
  const world = buildWorld(opts.seed ?? 987654, opts.data ?? null)
  let career = makeCareer(world, path)
  const ladder = ladderFor(path)
  const topLevel = ladder.length - 1

  const snapshots: BalanceSeason[] = []
  let promotions = 0
  let demotions = 0
  let lastRetired = 0

  for (let s = 0; s < seasons; s++) {
    // ── Regular season (fast sim for every game + league stat allocation) ──
    for (let w = 1; w <= 18; w++) simWeek(world, w)
    const playoffs = simulatePlayoffs(world)

    // ── Career review & promotion (mirrors runEndOfRegularSeason) ──
    simulateScouting(world, career, rng)
    const scout = evaluateScouting(world, career)
    const rec = world.standings[career.teamId]
    const madePlayoffs = playoffs.seeds?.includes(career.teamId) ?? false
    const wonTitle = playoffs.champion === career.teamId
    const review = reviewSeason(world, career, { wins: rec?.wins ?? 0, losses: rec?.losses ?? 0 }, madePlayoffs, wonTitle)
    const seasonCareer: CareerState = { ...career, seasonRecs: scout.graded, seasonHits: scout.hits }
    const objs = roleObjectives(
      world,
      seasonCareer,
      { wins: rec?.wins ?? 0, losses: rec?.losses ?? 0 },
      unitRanks(world, 'NFL')[career.teamId],
    )
    const graded = gradeObjectives(objs)
    const winPct0 = (rec?.wins ?? 0) / Math.max(1, (rec?.wins ?? 0) + (rec?.losses ?? 0))
    const roleMasteryMap = updateRoleMastery(career, graded.doneCount, objs.length, winPct0)

    const rep: Reputation = { ...career.reputation }
    rep.evaluation = clamp(rep.evaluation + scout.repDelta, 0, 100)
    for (const [k, v] of Object.entries(review.repDelta)) {
      ;(rep as unknown as Record<string, number>)[k] = clamp(((rep as unknown as Record<string, number>)[k] ?? 0) + (v as number), 0, 100)
    }
    for (const [k, v] of Object.entries(graded.repDelta)) {
      ;(rep as unknown as Record<string, number>)[k] = clamp(((rep as unknown as Record<string, number>)[k] ?? 0) + (v as number), 0, 100)
    }
    const skills: Skills = { ...career.skills }
    skills.evaluation = clamp(skills.evaluation + (scout.accuracy >= 60 ? 4 : scout.graded > 0 ? 2 : 0), 0, 99)
    for (const [k, v] of Object.entries(review.skillDelta)) {
      ;(skills as unknown as Record<string, number>)[k] = clamp(((skills as unknown as Record<string, number>)[k] ?? 0) + (v as number), 0, 99)
    }
    // L12.11: model a player who earns his skill points and spends them evenly.
    if (opts.skillPolicy) {
      const award = earnSkillPoints({
        objectivesMet: graded.doneCount,
        ambitionsMet: 0,
        wins: rec?.wins ?? 0,
        losses: rec?.losses ?? 0,
        madePlayoffs,
        wonTitle,
        awards: 0,
        questionGood: false,
        ledgerGraded: 0,
        ledgerHits: 0,
      })
      Object.assign(skills, spendSkillPointsEvenly(skills, award.earned))
    }
    if (scout.graded >= 5 && scout.accuracy >= 80) rep.profile = clamp(rep.profile + 4, 0, 100)
    if (wonTitle) rep.profile = clamp(rep.profile + 8, 0, 100)

    let jobSecurity = clamp(career.jobSecurity + review.securityDelta, 0, 100)
    let demotedNow = false
    if (jobSecurity <= 0 && career.level > 0) demotedNow = true

    // A real player spends the weekly budget, does set pieces, and works the
    // phones — the harness models a diligent, strong career (the tuning target).
    rep.evaluation = clamp(rep.evaluation + 1, 0, 100)
    rep.roster = clamp(rep.roster + 2, 0, 100)
    rep.profile = clamp(rep.profile + 1, 0, 100)
    rep.results = clamp(rep.results + 1, 0, 100)

    career = {
      ...career,
      reputation: rep,
      skills,
      hits: career.hits + scout.hits,
      misses: career.misses + scout.misses,
      seasonHits: scout.hits,
      jobSecurity,
      roleMastery: roleMasteryMap,
      history: [...career.history, { season: career.season, team: career.teamId, role: tierFor(career.path, career.level).title, record: `${rec?.wins ?? 0}-${rec?.losses ?? 0}`, outcome: wonTitle ? 'Won a championship' : madePlayoffs ? 'Made the playoffs' : `${scout.graded} recommends` }],
    }
    if (demotedNow) {
      career = demote(world, career)
      demotions++
      jobSecurity = career.jobSecurity
    }

    // Try the carousel: take the first offer we win an interview for.
    let promotedNow = false
    const offers = generateJobOffers(world, career)
    if (offers.length) {
      for (const offer of offers) {
        const invite = makeInterview(offer, world, career)
        if (resolveInterview(invite, rng)) {
          career = promote(career, offer)
          promotedNow = true
          promotions++
          break
        }
      }
    }

    // ── Season transition ──
    const retired = developPlayers(world)
    runAIResign(world)
    tickAllContracts(world)
    advanceTenure(world)
    for (const teamId of Object.keys(world.roster)) {
      for (const p of world.roster[teamId]) {
        const next = gainSeasonTraining(p)
        if (next) p.playbook = next
      }
    }
    refreshAllCohesion(world)
    awardCompensatoryPicks(world)
    initDraft(world)
    if (canDraft(career)) simulateRestOfDraft(world, career)
    runUDFAs(world)
    runAIFreeAgency(world, career.teamId)
    runAITrades(world)
    enforceCapCompliance(world)

    snapshots.push({
      season: world.season,
      level: career.level,
      title: tierFor(career.path, career.level).title,
      overallRep: Math.round(rep.evaluation * 0.28 + rep.roster * 0.24 + rep.leadership * 0.18 + rep.results * 0.2 + rep.profile * 0.1),
      jobSecurity,
      wins: rec?.wins ?? 0,
      losses: rec?.losses ?? 0,
      promoted: promotedNow,
      demoted: demotedNow,
      offers: offers.length,
    })

    // Advance to the next season — but keep the final season's standings and
    // awards intact so the report can measure them.
    lastRetired = retired
    if (s < seasons - 1) {
      world.season += 1
      world.week = 1
      world.phase = 'regular'
      // L11.5 Q11: roll the tradeable pick window forward, keeping future owners.
      world.draftPicks = world.draftPicks.filter((p) => p.season > world.season)
      ensureDraftWindow(world, world.season + 1)
      resetSeason(world)
    }
  }

  return summarizeReport(world, snapshots, promotions, demotions, topLevel, lastRetired)
}

function summarizeReport(
  world: World,
  snapshots: BalanceSeason[],
  promotions: number,
  demotions: number,
  topLevel: number,
  retirements: number,
): BalanceReport {
  const nfl = world.teams.filter((t) => t.tier === 'NFL')
  const wins = nfl.map((t) => world.standings[t.id]?.wins ?? 0)
  const mean = wins.reduce((a, b) => a + b, 0) / (wins.length || 1)
  const variance = wins.reduce((s, w) => s + (w - mean) ** 2, 0) / (wins.length || 1)

  let points = 0
  let games = 0
  let space = 0
  let over = 0
  let tight = 0
  let cohesion = 0
  let usedPct = 0
  let rosterSize = 0
  let ovrSum = 0
  let ovrN = 0
  let stars = 0
  for (const t of nfl) {
    const cap = summarizeCap(world.roster[t.id] ?? [], world.deadMoney[t.id] ?? 0, world.season)
    space += cap.space
    usedPct += cap.used / cap.limit
    rosterSize += (world.roster[t.id] ?? []).length
    if (cap.overTheCap) over++
    if (cap.space < 10_000_000) tight++
    cohesion += teamCohesion(world.roster[t.id] ?? [], world.staffTenure, t.id).avg
    for (const p of world.roster[t.id] ?? []) {
      ovrSum += p.ovr
      ovrN++
      if (p.ovr >= 90) stars++
    }
  }
  for (const g of world.schedule) {
    if (g.tier !== 'NFL' || g.homeScore == null || g.awayScore == null) continue
    points += g.homeScore + g.awayScore
    games += 2
  }

  const reachedTop = snapshots.find((s) => s.level >= topLevel)
  return {
    seasons: snapshots,
    seasonsToTop: reachedTop ? snapshots.indexOf(reachedTop) + 1 : null,
    promotions,
    demotions,
    avgNflPoints: games ? +(points / games).toFixed(1) : 0,
    winStdDev: +Math.sqrt(variance).toFixed(2),
    winMin: Math.min(...wins),
    winMax: Math.max(...wins),
    avgSpace: nfl.length ? Math.round(space / nfl.length) : 0,
    teamsOverCap: over,
    teamsTight: tight,
    capUsedPct: nfl.length ? +(usedPct / nfl.length).toFixed(3) : 0,
    avgRosterSize: nfl.length ? +(rosterSize / nfl.length).toFixed(1) : 0,
    avgCohesion: nfl.length ? +(cohesion / nfl.length).toFixed(2) : 0,
    avgOvr: ovrN ? +(ovrSum / ovrN).toFixed(1) : 0,
    starCount: stars,
    retirements,
    freeAgents: world.freeAgents.length,
    compPicks: world.draftPicks.filter((p) => p.comp).length,
  }
}

/** Exported for tests/typing convenience. */
export { teamStrength }

// ── L12.7 D4: rookie probe ────────────────────────────────────────────────────
export interface RookieRoundStat {
  round: number
  count: number
  median: number
  p10: number
  p90: number
}

export interface RookieProbeReport {
  seasons: number
  /** (a) opening OVR distribution by draft round for the first draft. */
  draftByRound: RookieRoundStat[]
  maxRookieOvr: number
  noRookieOver80: boolean
  /** (b) league-average starter OVR per season, and its drift from season 1. */
  starterAvgBySeason: number[]
  maxDrift: number
  withinDrift: boolean
  /** (c) rookies who reached POT − 3 within 4 seasons, by first-two-year role. */
  reachedByRole: {
    starters: { n: number; reached: number; pct: number }
    bench: { n: number; reached: number; pct: number }
  }
  /** (d) D5: a well-scouted read brackets what the rookies actually sign at. */
  projectionCheck: {
    n: number
    nowInside: number
    ceilingInside: number
    samples: { name: string; pos: string; now: [number, number]; ceiling: [number, number]; ovr: number; pot: number }[]
  }
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0
  const i = (sorted.length - 1) * q
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo))
}

function leagueStarterAvg(world: World): number {
  let sum = 0
  let n = 0
  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    for (const pos of Object.keys(STARTERS) as Position[]) {
      for (const p of depthAt(world, t.id, pos).slice(0, STARTERS[pos] ?? 1)) {
        sum += p.ovr
        n++
      }
    }
  }
  return n ? sum / n : 0
}

function onDepthAsStarter(world: World, p: Player): boolean {
  if (!p.teamId) return false
  const idx = depthAt(world, p.teamId, p.pos).findIndex((x) => x.id === p.id)
  return idx >= 0 && idx < (STARTERS[p.pos] ?? 1)
}

interface TrackedRookie {
  pot: number
  seasonsPlayed: number
  starterFirstTwo: boolean
  reached: boolean
}

/**
 * D4 (L12.7): run whole seasons headlessly and prove rookies enter low and grow
 * into their ceilings only with playing time — without draining league talent.
 * Reports (a) the first draft's opening OVR by round, (b) the league-average
 * starter OVR each season (talent must stay within ±1.5 of season 1), and (c)
 * the share of rookies who reach POT − 3 within 4 seasons, starters vs. bench.
 */
export function runRookieProbe(opts: { seasons?: number; seed?: number; data?: RealData | null } = {}): RookieProbeReport {
  const seasons = opts.seasons ?? 8
  const seed = opts.seed ?? 987654
  const world = buildWorld(seed, opts.data ?? null)
  const tracked = new Map<string, TrackedRookie>()
  let firstDraft: { ovr: number; round: number }[] = []
  let projectionCheck: RookieProbeReport['projectionCheck'] = { n: 0, nowInside: 0, ceilingInside: 0, samples: [] }
  const starterAvgBySeason: number[] = []

  for (let s = 0; s < seasons; s++) {
    for (let w = 1; w <= 18; w++) simWeek(world, w)
    simulatePlayoffs(world)

    // (b) starter talent at this season's end, before development and churn.
    starterAvgBySeason.push(leagueStarterAvg(world))

    // (c) starter status in a rookie's first two playing seasons.
    for (const [id, t] of tracked) {
      if (t.seasonsPlayed >= 2) continue
      const p = world.players.find((x) => x.id === id)
      if (p && onDepthAsStarter(world, p)) t.starterFirstTwo = true
    }

    // Season transition, mirroring runBalance.
    developPlayers(world)
    for (const [id, t] of tracked) {
      t.seasonsPlayed += 1
      const p = world.players.find((x) => x.id === id)
      if (p && p.ovr >= t.pot - 3) t.reached = true
    }

    runAIResign(world)
    tickAllContracts(world)
    advanceTenure(world)
    for (const teamId of Object.keys(world.roster)) {
      for (const p of world.roster[teamId]) {
        const next = gainSeasonTraining(p)
        if (next) p.playbook = next
      }
    }
    refreshAllCohesion(world)
    awardCompensatoryPicks(world)
    initDraft(world)

    const before = new Set(world.players.map((p) => p.id))
    simulateRestOfDraft(world, null)
    runUDFAs(world)
    const drafted = world.players.filter((p) => !before.has(p.id) && p.origin?.kind === 'draft')
    if (!firstDraft.length && drafted.length) {
      // (a) bucket by the prospect's talent round — his true-grade rank ÷ 32 —
      // which is the round the D1 curve is defined against (a steal keeps the
      // OVR his talent earns even if he fell in the actual draft).
      const ranked = [...world.draft].sort((a, b) => b.trueGrade - a.trueGrade || (a.id < b.id ? -1 : 1))
      const roundByProspect = new Map(ranked.map((x, i) => [x.id, Math.ceil((i + 1) / 32)]))
      firstDraft = drafted.map((p) => ({ ovr: p.ovr, round: roundByProspect.get(p.id.slice(3)) ?? p.origin?.round ?? 0 }))

      // (d) D5: a well-scouted read must bracket what each rookie actually
      // signs at. Scout the class to 85% (truth still hidden at this rung) with
      // the read matching the true grade, then compare the first ten picks.
      for (const p of world.draft) {
        p.confidence = 85
        p.myGrade = p.trueGrade
      }
      const probeCareer = { level: 3, skills: { evaluation: 60 }, earnedTraits: [], teamId: 'BUF' } as unknown as CareerState
      let nowInside = 0
      let ceilingInside = 0
      const samples: RookieProbeReport['projectionCheck']['samples'] = []
      for (const pl of drafted.slice(0, 10)) {
        const prospect = world.draft.find((x) => `pl_${x.id}` === pl.id)
        if (!prospect) continue
        const rr = readRookieRanges(probeCareer, prospect, world.draft)
        if (pl.ovr >= rr.now[0] && pl.ovr <= rr.now[1]) nowInside++
        if (pl.pot >= rr.ceiling[0] && pl.pot <= rr.ceiling[1]) ceilingInside++
        samples.push({ name: pl.name, pos: pl.pos, now: rr.now, ceiling: rr.ceiling, ovr: pl.ovr, pot: pl.pot })
      }
      projectionCheck = { n: samples.length, nowInside, ceilingInside, samples }
    }
    for (const p of drafted) {
      tracked.set(p.id, { pot: p.pot, seasonsPlayed: 0, starterFirstTwo: false, reached: false })
    }

    runAIFreeAgency(world)
    runAITrades(world)
    enforceCapCompliance(world)

    if (s < seasons - 1) {
      world.season += 1
      world.week = 1
      world.phase = 'regular'
      world.draftPicks = world.draftPicks.filter((p) => p.season > world.season)
      ensureDraftWindow(world, world.season + 1)
      resetSeason(world)
    }
  }

  // (a) opening OVR distribution by round for the first draft.
  const draftByRound: RookieRoundStat[] = []
  for (let r = 1; r <= 7; r++) {
    const ovrs = firstDraft.filter((x) => x.round === r).map((x) => x.ovr).sort((a, b) => a - b)
    if (!ovrs.length) continue
    draftByRound.push({ round: r, count: ovrs.length, median: quantile(ovrs, 0.5), p10: quantile(ovrs, 0.1), p90: quantile(ovrs, 0.9) })
  }
  const maxRookieOvr = firstDraft.reduce((m, x) => Math.max(m, x.ovr), 0)

  // (b) drift of starter talent vs. season 1.
  const base = starterAvgBySeason[0] ?? 0
  const maxDrift = starterAvgBySeason.reduce((m, v) => Math.max(m, Math.abs(v - base)), 0)

  // (c) rookies with a full 4-season look, split by early starter status.
  const complete = [...tracked.values()].filter((t) => t.seasonsPlayed >= 4)
  const starters = complete.filter((t) => t.starterFirstTwo)
  const bench = complete.filter((t) => !t.starterFirstTwo)
  const share = (list: TrackedRookie[]) => (list.length ? Math.round((list.filter((t) => t.reached).length / list.length) * 100) : 0)

  return {
    seasons,
    draftByRound,
    maxRookieOvr,
    noRookieOver80: maxRookieOvr <= 80,
    starterAvgBySeason: starterAvgBySeason.map((v) => +v.toFixed(2)),
    maxDrift: +maxDrift.toFixed(2),
    withinDrift: maxDrift <= 1.5,
    reachedByRole: {
      starters: { n: starters.length, reached: starters.filter((t) => t.reached).length, pct: share(starters) },
      bench: { n: bench.length, reached: bench.filter((t) => t.reached).length, pct: share(bench) },
    },
    projectionCheck,
  }
}

import type { CareerState, Contract, Player, Position, Recommendation, SeasonStats } from '../types'
import { tickContractYear, marketAAV, capScale, capForSeason, CAP_FLOOR_PCT } from './cap'
import { coachEffect } from './coaching'
import { generateProspectClass, indexPlayers, type World } from './generate'
import { depthAt, STARTERS } from './depth'
import { coverageGrade, passerRating } from './stats'
import { ledgerFreeAgent } from './picks'
import { unscaleOvr } from './ovrScale'
import { bustRisk, devModifier } from './character'
import { isEvaluator, recordReport } from './scoutBias'
import { clamp, makeRng, rpick } from './rng'
import { applyDevFocus, focusPointsFor } from './devPlan'
import { cultureDiscountFor, cultureQualifiedClubs } from './culture'
import type { CareerDatabase } from './statsDb'

// ── Player development ───────────────────────────────────────────────────────
/**
 * L12.7 D2: a 0–1 score for how much a young player actually earned his growth
 * this season, from playing time, starting status and production. `games` is the
 * season's NFL line; a practice-squad player counts as zero games and no start.
 */
function experienceScore(world: World, p: Player, psIds: Set<string>): number {
  const onPS = psIds.has(p.id)
  const line = onPS ? undefined : p.stats?.find((s) => s.season === world.season && s.level === 'NFL')
  const games = line?.games ?? 0
  const starter = !onPS && isStarter(world, p)
  const production = line ? productionScore(p.pos, line) : 0.5
  return clamp(0.45 * Math.min(1, games / 14) + 0.35 * (starter ? 1 : 0) + 0.2 * production, 0, 1)
}

function isStarter(world: World, p: Player): boolean {
  if (!p.teamId) return false
  const idx = depthAt(world, p.teamId, p.pos).findIndex((x) => x.id === p.id)
  return idx >= 0 && idx < (STARTERS[p.pos] ?? 1)
}

/**
 * A position-relative 0–1 production grade from a season line: passer rating for
 * QBs, yards-per-carry plus volume for RBs, yards-per-target plus volume for
 * WR/TE, and the front-seven / coverage stats for defenders. Offensive linemen
 * are graded on games played (they generate no stats). 0.5 when there is no line.
 */
function productionScore(pos: Position, line: SeasonStats): number {
  switch (pos) {
    case 'QB':
      return clamp(passerRating(line) / 110, 0, 1)
    case 'RB': {
      const ypc = line.rushAtt > 0 ? line.rushYds / line.rushAtt : 0
      return clamp((ypc / 5) * 0.6 + (line.rushYds / 1200) * 0.4, 0, 1)
    }
    case 'WR':
    case 'TE': {
      const ypt = line.targets > 0 ? line.recYds / line.targets : 0
      return clamp((ypt / 9) * 0.6 + (line.recYds / 1100) * 0.4, 0, 1)
    }
    case 'OT':
    case 'OG':
    case 'C':
      return clamp(line.games / 17, 0, 1)
    case 'DE':
    case 'DT':
      return clamp((line.tackles / 60) * 0.5 + (line.defSacks / 10) * 0.4 + ((line.tfl ?? 0) / 15) * 0.1, 0, 1)
    case 'LB':
      return clamp((line.tackles / 100) * 0.6 + (line.defSacks / 6) * 0.2 + (line.defInts / 4) * 0.2, 0, 1)
    case 'CB':
    case 'S': {
      const cov = coverageGrade(line)
      return clamp((cov == null ? 0.5 : cov / 100) * 0.7 + (line.defInts / 5) * 0.2 + (line.passDef / 12) * 0.1, 0, 1)
    }
    default:
      return 0.5
  }
}

/** A short label for a player's last-season development reason (D3). */
export function experienceLabel(experience: number): 'starter' | 'rotation' | 'barely played' {
  return experience >= 0.55 ? 'starter' : experience >= 0.3 ? 'rotation' : 'barely played'
}

export function developPlayers(world: World, user?: { teamId: string; growth: number }) {
  const rng = makeRng(world.seed + world.season * 31337)
  const retired: Player[] = []
  // Practice-squad players get no snaps and no starts, by rule (D2).
  const psIds = new Set<string>()
  for (const list of Object.values(world.practiceSquad ?? {})) for (const p of list) psIds.add(p.id)

  for (const p of world.players) {
    const ovrBefore = p.ovr
    p.age += 1
    // Staff quality changes how fast young players grow and how slowly vets decline.
    // Character (hidden) is the second lever: motor and maturity decide whether
    // the talent actually arrives. It never touches current ratings directly.
    const dev = (p.teamId ? coachEffect(world, p.teamId).development : 1) * (p.character ? devModifier(p.character) : 1)
    const growth = Math.max(0, p.pot - p.ovr)
    // D2: growth for young players is earned on the field, not handed out by age.
    const experience = p.age <= 26 ? experienceScore(world, p, psIds) : 0
    // L12.11: Player Development skill speeds up the young players on your club.
    const clubGrowth = user && p.teamId === user.teamId ? user.growth : 1
    // L12.15 S4: with a deliberately thin elite pipeline, young players need to
    // reach their ceilings sooner or the opening star cohort ages out into a
    // multi-year trough. Faster maturation moves the (unchanged) ceiling supply
    // forward without raising the long-run level.
    if (p.age <= 24) {
      p.ovr = clamp(Math.min(p.pot, p.ovr + Math.round(growth * (0.22 + 0.42 * experience + rng() * 0.18) * dev * clubGrowth)), 40, 99)
    } else if (p.age <= 26) {
      p.ovr = clamp(Math.min(p.pot, p.ovr + Math.round(growth * (0.15 + 0.28 * experience + rng() * 0.12) * dev * clubGrowth)), 40, 99)
    } else if (p.age <= 29) {
      p.ovr = clamp(p.ovr + (rng() < 0.45 ? 1 : 0) - (rng() < 0.25 ? 1 : 0), 40, p.pot)
    } else {
      // L12.15 S4: on the compressed new scale a single point costs a star far
      // more, so the league's best age out more slowly — this preserves the rare
      // top band while the (deliberately thin) rookie pipeline matures to replace
      // the opening, mostly-28-to-33-star cohort.
      const elite = p.ovr >= 90
      const decline = p.age >= 34 ? (elite ? 2 : 3) : p.age >= 32 ? (elite ? 1 : 2) : 1
      const rate = p.age <= 33 ? (p.ovr >= 93 ? 0.25 : elite ? 0.5 : 0.7) : elite ? 0.5 : 0.7
      p.ovr = clamp(p.ovr - (rng() < rate ? decline : 0), 40, 99)
    }
    if (p.age <= 26) p.lastGrowth = { season: world.season, from: ovrBefore, to: p.ovr, experience }

    // L15 development plans (FUTURES row 13): the user's young players convert
    // playing time into focused rating gains. The number of points rides the same
    // experience score the OVR growth uses — a bench player earns none — and a
    // stronger development program (the position coaches) pays off more. Applied
    // only to the user's club and only when a focus is set, so AI development and
    // calibration are untouched. Deterministic: no `rng()` draw is added here.
    if (user && p.teamId === user.teamId && p.age <= 26 && p.devFocus) {
      applyDevFocus(p, focusPointsFor(experience, dev))
    }

    // Bust risk: a player who never got the motor can stall out. Generated
    // players only — we never invent off-field failure for real names.
    if (p.character && p.generated && p.age <= 27 && rng() < bustRisk(p.character) * 0.12) {
      p.ovr = clamp(p.ovr - 1, 40, 99)
    }

    if (p.age >= 39 || (p.age >= 36 && unscaleOvr(p.ovr) < 62 && rng() < 0.4)) retired.push(p)
    // Fringe unsigned veterans retire out of the league, keeping the FA pool sane.
    else if (!p.teamId && (p.age >= 34 || (p.age >= 30 && unscaleOvr(p.ovr) < 72 && rng() < 0.4))) retired.push(p)
  }

  if (retired.length) {
    const ids = new Set(retired.map((p) => p.id))
    world.players = world.players.filter((p) => !ids.has(p.id))
    for (const teamId of Object.keys(world.roster)) {
      world.roster[teamId] = world.roster[teamId].filter((p) => !ids.has(p.id))
    }
    for (const teamId of Object.keys(world.practiceSquad ?? {})) {
      world.practiceSquad[teamId] = (world.practiceSquad[teamId] ?? []).filter((p) => !ids.has(p.id))
    }
    for (const teamId of Object.keys(world.ir ?? {})) {
      world.ir[teamId] = (world.ir[teamId] ?? []).filter((p) => !ids.has(p.id))
    }
    world.freeAgents = world.freeAgents.filter((p) => !ids.has(p.id))
  }
  return retired.length
}

// ── Evaluating the evaluators ────────────────────────────────────────────────
/**
 * At season end, fold each of the club's evaluators' filed reports against the
 * truth, so their bias can be learned from their Ledger over time.
 */
export function updateStaffLedgers(world: World, teamId: string) {
  const evaluators = (world.staff[teamId] ?? []).filter(isEvaluator)
  if (!evaluators.length) return
  const prospects = [...world.draft].slice(0, 40)
  for (const m of evaluators) {
    for (const p of prospects) recordReport(m, p)
  }
}

// ── Contracts ────────────────────────────────────────────────────────────────
function expirePlayer(p: Player, toFA: Player[]) {
  p.teamId = null
  p.contract = { ...p.contract, years: 0, base: [0], proration: 0, guaranteed: 0, capHit: 0 }
  toFA.push(p)
}

/** Tick every NFL contract one year; expired deals become free agents. */
export function tickAllContracts(world: World) {
  const toFA: Player[] = []
  for (const teamId of Object.keys(world.roster)) {
    if (world.byId[teamId]?.tier !== 'NFL') continue // college players are not under contract
    const keep: Player[] = []
    for (const p of world.roster[teamId]) {
      const next = tickContractYear(p.contract)
      if (next) {
        p.contract = next
        keep.push(p)
      } else {
        // A qualifying veteran walking in free agency earns a comp pick.
        ledgerFreeAgent(world, teamId, 'lost', p.ovr)
        expirePlayer(p, toFA)
      }
    }
    world.roster[teamId] = keep

    // Practice squad and IR contracts tick too (PS deals are one-year).
    for (const bucket of ['practiceSquad', 'ir'] as const) {
      const list = world[bucket][teamId] ?? []
      const keepList: Player[] = []
      for (const p of list) {
        const next = tickContractYear(p.contract)
        if (next) {
          p.contract = next
          keepList.push(p)
        } else {
          expirePlayer(p, toFA)
        }
      }
      world[bucket][teamId] = keepList
    }
  }
  world.deadMoney = Object.fromEntries(Object.keys(world.deadMoney).map((k) => [k, 0]))
  world.freeAgents.push(...toFA)
}

// ── Scouting evaluation ──────────────────────────────────────────────────────
const BANDS: Record<Recommendation, [number, number]> = {
  'Blue Chip': [86, 99],
  Starter: [76, 88],
  Depth: [66, 79],
  Pass: [0, 72],
}

export interface ScoutDetail {
  name: string
  pos: string
  rec: Recommendation
  myGrade: number | null
  trueGrade: number
  error: number
  hit: boolean
  note: string
}

export interface ScoutingReport {
  graded: number
  hits: number
  misses: number
  accuracy: number // 0-100
  repDelta: number
  details: ScoutDetail[]
}

export function evaluateScouting(world: World, _career: CareerState): ScoutingReport {
  const recs = world.draft.filter((p) => p.recommendation)
  const details: ScoutDetail[] = []
  let hits = 0
  let misses = 0
  let points = 0

  for (const p of recs) {
    const band = BANDS[p.recommendation as Recommendation]
    const within = p.trueGrade >= band[0] && p.trueGrade <= band[1]
    const err = p.myGrade == null ? 16 : Math.abs(p.myGrade - p.trueGrade)
    const acc = clamp(1 - err / 20, 0, 1)
    const score = within ? 0.55 + acc * 0.45 : acc * 0.3
    if (p.trueGrade >= band[0] && p.trueGrade <= band[1]) hits++
    else misses++
    points += score
    details.push({
      name: p.name,
      pos: p.pos,
      rec: p.recommendation as Recommendation,
      myGrade: p.myGrade,
      trueGrade: p.trueGrade,
      error: err,
      hit: within,
      note: within ? 'Read it right.' : p.trueGrade > band[1] ? 'Underrated him.' : 'Overrated him.',
    })
  }

  const avg = recs.length ? points / recs.length : 0.5
  const rawDelta = (avg - 0.5) * Math.min(44, 12 + recs.length * 1.2)
  const repDelta = Math.round(clamp(rawDelta, -12, 18))
  const accuracy = recs.length ? Math.round((hits / recs.length) * 100) : 0

  details.sort((a, b) => Number(a.hit) - Number(b.hit))
  return { graded: recs.length, hits, misses, accuracy, repDelta, details }
}

// ── New draft class ──────────────────────────────────────────────────────────
/**
 * Roll the prospect pool into the new season.
 *
 * The draft class is REPLACED each year: leftovers from a previous cycle are
 * stale (they've been drafted or aged out), and the game should never run dry.
 * We guarantee a floor so a draft can always be run.
 */
export function refreshProspectClass(world: World) {
  const rng = makeRng(world.seed + (world.season + 1) * 65537)
  // NFL draft pool: draft-eligible college players. Keep a floor of 400.
  const draftCount = Math.max(400, world.draft?.length ?? 0)
  world.draft = generateProspectClass(rng, world.season + 1, draftCount)
}

/** Safety net: refill the draft pool if it is somehow exhausted mid-cycle. */
export function ensureProspectPools(world: World) {
  const rng = makeRng(world.seed + world.season * 7919)
  if (!world.draft || world.draft.filter((p) => !p.draftedBy).length === 0) {
    world.draft = generateProspectClass(rng, world.season, Math.max(200, world.draft?.length ?? 0))
  }
}

// ── AI re-signing & trades: deeper roster management ─────────────────────────
/**
 * Before free agency opens, AI clubs re-sign their own best expiring players
 * (within the cap) instead of letting the whole roster walk.
 */
export function runAIResign(world: World, skipTeamId?: string, db?: CareerDatabase) {
  const rng = makeRng(world.seed + world.season * 5051)
  const capLimit = capForSeason(world.season)
  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    if (t.id === skipTeamId) continue
    const roster = world.roster[t.id] ?? []
    const used = () => roster.reduce((s, p) => s + p.contract.capHit, 0) + (world.deadMoney[t.id] ?? 0)
    const expiring = roster.filter((p) => p.contract.years <= 1 && unscaleOvr(p.ovr) >= 72).sort((a, b) => b.ovr - a.ovr)
    let resigned = 0
    for (const p of expiring) {
      if (resigned >= 4) break
      // L12.9 K2: a qualifying club re-signs at a discounted asking price.
      const base = marketPrice(p, world.season, world.era?.positionBias?.[p.pos] ?? 1)
      const pct = db ? cultureDiscountFor(world, db, t.id, p).pct : 0
      const annual = pct ? Math.round((base * (1 - pct / 100)) / 1e5) * 1e5 : base
      if (used() + annual > capLimit * 0.98) continue
      const years = 3
      p.contract = {
        ...p.contract,
        years,
        length: years,
        base: Array.from({ length: years }, () => annual),
        signingBonus: 0,
        proration: 0,
        guaranteed: Math.round(annual * 1.5),
        capHit: annual,
        annual,
        signedThrough: world.season + years - 1,
      }
      p.teamId = t.id
      resigned++
    }
    void rng
  }
}

/**
 * Keep every NFL club under the cap after the offseason. If a team is over, it
 * cuts its worst value-per-dollar players (above position floors) to free agents
 * until it has a little breathing room. Called once, after FA and trades.
 */
export function enforceCapCompliance(world: World) {
  const FLOOR: Record<string, number> = {
    QB: 2, RB: 2, WR: 4, TE: 2, OT: 3, OG: 3, C: 1, DE: 3, DT: 3, LB: 4, CB: 4, S: 3, K: 1, P: 1,
  }
  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    const roster = world.roster[t.id] ?? []
    const limit = capForSeason(world.season)
    const target = limit * 0.96
    const used = () => roster.reduce((s, p) => s + p.contract.capHit, 0) + (world.deadMoney[t.id] ?? 0)
    if (used() <= target) continue
    const counts: Record<string, number> = {}
    for (const p of roster) counts[p.pos] = (counts[p.pos] ?? 0) + 1
    const order = [...roster].sort(
      (a, b) => a.ovr / Math.max(1, a.contract.capHit) - b.ovr / Math.max(1, b.contract.capHit),
    )
    for (const p of order) {
      if (used() <= target) break
      if ((counts[p.pos] ?? 0) <= (FLOOR[p.pos] ?? 2)) continue
      const idx = roster.indexOf(p)
      if (idx < 0) continue
      roster.splice(idx, 1)
      counts[p.pos] -= 1
      p.teamId = null
      p.contract = { ...p.contract, years: 0, base: [0], proration: 0, guaranteed: 0, capHit: 0 }
      world.freeAgents.push(p)
    }
  }
}

/**
 * A few AI-to-AI trades each offseason, so the league moves on its own: teams
 * swap similar-value players where each has a surplus. Cheap, but it makes the
 * world feel alive and gives the media something to report.
 */
export function runAITrades(world: World) {
  const rng = makeRng(world.seed + world.season * 7079)
  const nfl = world.teams.filter((t) => t.tier === 'NFL')
  let made = 0
  for (let i = 0; i < 10 && made < 4; i++) {
    const a = rpick(rng, nfl)
    const b = rpick(rng, nfl)
    if (a.id === b.id) continue
    const ra = world.roster[a.id] ?? []
    const rb = world.roster[b.id] ?? []
    const pa = [...ra].filter((p) => unscaleOvr(p.ovr) >= 70 && unscaleOvr(p.ovr) <= 84).sort(() => rng() - 0.5)[0]
    const pb = [...rb].filter((p) => unscaleOvr(p.ovr) >= 70 && unscaleOvr(p.ovr) <= 84).sort(() => rng() - 0.5)[0]
    if (!pa || !pb) continue
    if (Math.abs(unscaleOvr(pa.ovr) - unscaleOvr(pb.ovr)) > 7 || pa.pos === pb.pos) continue
    world.roster[a.id] = ra.filter((x) => x.id !== pa.id)
    pa.teamId = b.id
    world.roster[b.id].push(pa)
    world.roster[b.id] = world.roster[b.id].filter((x) => x.id !== pb.id)
    pb.teamId = a.id
    world.roster[a.id].push(pb)
    world.news.unshift({
      id: `aitrade_${world.season}_${made}_${a.id}${b.id}`,
      week: world.week,
      season: world.season,
      category: 'Trade',
      headline: `${a.abbr} and ${b.abbr} swap players`,
      body: `${a.name} send ${pa.name} (${pa.pos}) to ${b.name} for ${pb.name} (${pb.pos}). A low-key deal between two clubs filling needs.`,
      read: false,
    })
    made++
  }
}

// ── Free agency AI: teams re-sign or sign to fill needs ───────────────────────/** Minimum bodies per position when trimming a roster to 53. */
export const ROSTER_FLOOR: Record<string, number> = {
  QB: 2, RB: 2, WR: 4, TE: 2, OT: 3, OG: 3, C: 1, DE: 3, DT: 3, LB: 4, CB: 4, S: 3, K: 1, P: 1,
}

/**
 * Cut every NFL roster down to 53, lowest-rated surplus first. Without this,
 * drafted players accumulate forever and the cap model drifts out of reality.
 */
export function trimNflRosters(world: World) {
  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    const roster = world.roster[t.id] ?? []
    if (roster.length <= 53) continue
    const counts: Record<string, number> = {}
    for (const p of roster) counts[p.pos] = (counts[p.pos] ?? 0) + 1
    for (const p of [...roster].sort((a, b) => a.ovr - b.ovr)) {
      if (roster.length <= 53) break
      if ((counts[p.pos] ?? 0) <= (ROSTER_FLOOR[p.pos] ?? 2)) continue
      const idx = roster.indexOf(p)
      if (idx < 0) continue
      roster.splice(idx, 1)
      counts[p.pos] -= 1
      p.teamId = null
      p.contract = { ...p.contract, years: 0, base: [0], proration: 0, guaranteed: 0, capHit: 0 }
      world.freeAgents.push(p)
    }
  }
}

/** Market price for a free agent in a given season (tracks cap growth + era drift). */
export function marketPrice(p: Player, season: number, posBias = 1): number {
  return Math.round((marketAAV(p.ovr, p.pos, p.age) * capScale(season) * posBias) / 100_000) * 100_000
}

/**
 * L11 W1: the priced one-year deal a free agent signs mid-career. Built from
 * `marketPrice`; during the regular season the cap hit is pro-rated for the
 * weeks left in an 18-week season. `annualOverride` is used for practice-squad
 * deals (a flat PS salary).
 */
export function freeAgentContract(
  p: Player,
  season: number,
  week: number,
  phase: 'regular' | 'offseason' | string,
  annualOverride?: number,
  askMult = 1,
  discountPct = 0,
): Contract {
  const market = annualOverride ?? marketPrice(p, season)
  // L12.11: the user's Negotiation skill shaves the ask (AI callers use 1).
  // L12.9 K2: a winning-culture discount also comes off the asking price.
  const annual = annualOverride != null ? market : Math.round((market * askMult * (1 - discountPct / 100)) / 1e5) * 1e5
  const capHit =
    phase === 'regular'
      ? Math.round((annual * (18 - week + 1)) / 18)
      : annual
  return {
    years: 1,
    length: 1,
    base: [annual],
    signingBonus: 0,
    proration: 0,
    guaranteed: 0,
    capHit,
    annual,
    signedThrough: season,
    voidYears: 0,
  }
}

export function runAIFreeAgency(world: World, skipTeamId?: string, db?: CareerDatabase) {
  trimNflRosters(world)
  const rng = makeRng(world.seed + world.season * 90001)
  const needed: Record<string, number> = { QB: 3, RB: 3, WR: 6, TE: 3, OT: 4, OG: 4, C: 2, DE: 4, DT: 4, LB: 6, CB: 6, S: 4, K: 1, P: 1 }
  const freeCopy = [...world.freeAgents].sort((a, b) => b.ovr - a.ovr)
  const taken = new Set<string>()
  const capLimit = capForSeason(world.season)
  // L12.9 K2: the asking price a qualifying club pays; and FA interest tilts to
  // those clubs, so they get first crack at the market's best bodies.
  const price = (teamId: string, p: Player, bias: number) => {
    const base = marketPrice(p, world.season, bias)
    const pct = db ? cultureDiscountFor(world, db, teamId, p).pct : 0
    return pct ? Math.round((base * (1 - pct / 100)) / 1e5) * 1e5 : base
  }
  const qualifying = db ? cultureQualifiedClubs(world, db) : null
  const teamOrder = qualifying
    ? [...world.teams].sort((a, b) => Number(qualifying.has(b.id)) - Number(qualifying.has(a.id)))
    : world.teams

  for (const t of teamOrder) {
    if (t.tier !== 'NFL') continue
    const roster = world.roster[t.id] ?? []
    const counts: Record<string, number> = {}
    for (const p of roster) counts[p.pos] = (counts[p.pos] ?? 0) + 1
    for (const pos of Object.keys(needed)) {
      let deficit = needed[pos] - (counts[pos] ?? 0)
      while (deficit > 0) {
        const eraBias = world.era?.positionBias?.[pos as import('../types').Position] ?? 1
        const used0 = () => roster.reduce((s, q) => s + q.contract.capHit, 0) + (world.deadMoney[t.id] ?? 0)
        let cand = freeCopy.find((p) => {
          if (taken.has(p.id) || p.pos !== pos) return false
          return used0() + price(t.id, p, eraBias) <= capLimit
        })
        // Over the cap: fill remaining slots with the cheapest body, not a star.
        if (!cand) {
          cand = [...freeCopy]
            .filter((p) => !taken.has(p.id) && p.pos === pos)
            .sort((a, b) => price(t.id, a, eraBias) - price(t.id, b, eraBias))[0]
        }
        if (!cand) break
        const annual = price(t.id, cand, eraBias)
        taken.add(cand.id)
        cand.teamId = t.id
        cand.contract = { ...cand.contract, annual, years: 2, base: [annual, annual], capHit: annual }
        world.roster[t.id].push(cand)
        counts[pos] = (counts[pos] ?? 0) + 1
        deficit--
        ledgerFreeAgent(world, t.id, 'gained', cand.ovr)
      }
    }
    // W1: top up toward the cap floor. The need-filling above can leave AI
    // payrolls far below the floor; sign up to three more best-OVR bodies.
    if (t.id !== skipTeamId) {
      const usedCap = () => roster.reduce((s, q) => s + q.contract.capHit, 0) + (world.deadMoney[t.id] ?? 0)
      let topUps = 0
      while (topUps < 3 && usedCap() < capLimit * CAP_FLOOR_PCT) {
        const cand = freeCopy.find((p) => {
          if (taken.has(p.id) || p.pos === 'K' || p.pos === 'P') return false
          const bias = world.era?.positionBias?.[p.pos as import('../types').Position] ?? 1
          return usedCap() + price(t.id, p, bias) <= capLimit * 0.95
        })
        if (!cand) break
        // A full roster swaps cheap depth for the better free agent instead of
        // passing. Release the worst non-starter at a position we can spare.
        if (roster.length >= 53) {
          const release = [...roster]
            .sort((a, b) => a.ovr - b.ovr)
            .find(
              (p) =>
                (counts[p.pos] ?? 0) > (ROSTER_FLOOR[p.pos] ?? 2) &&
                p.contract.capHit <= 2_000_000 &&
                p.ovr <= cand.ovr - 3 &&
                depthAt(world, t.id, p.pos).findIndex((x) => x.id === p.id) >= STARTERS[p.pos],
            )
          if (!release) break
          const idx = roster.indexOf(release)
          if (idx < 0) break
          roster.splice(idx, 1)
          counts[release.pos] -= 1
          release.teamId = null
          release.contract = { ...release.contract, years: 0, base: [0], proration: 0, guaranteed: 0, capHit: 0 }
          world.freeAgents.push(release)
        }
        const bias = world.era?.positionBias?.[cand.pos] ?? 1
        const annual = price(t.id, cand, bias)
        taken.add(cand.id)
        cand.teamId = t.id
        cand.contract = { ...cand.contract, annual, years: 2, base: [annual, annual], capHit: annual }
        world.roster[t.id].push(cand)
        counts[cand.pos] = (counts[cand.pos] ?? 0) + 1
        ledgerFreeAgent(world, t.id, 'gained', cand.ovr)
        topUps++
      }
    }
    void rng
  }
  world.freeAgents = world.freeAgents.filter((p) => !taken.has(p.id))
  // Z1c: the X1 top-up can push a roster past 53; trim again at the very end.
  trimNflRosters(world)
  // Z1b: adopt any newly signed players into `world.players`.
  indexPlayers(world)
}

export function prospectRound(grade: number) {
  if (grade >= 90) return 1
  if (grade >= 84) return 2
  if (grade >= 79) return 3
  if (grade >= 74) return 4
  if (grade >= 70) return 5
  if (grade >= 66) return 6
  return 7
}

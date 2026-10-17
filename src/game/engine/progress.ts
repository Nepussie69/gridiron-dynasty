import type { CareerState, Contract, Player, Position, Recommendation, SeasonStats } from '../types'
import { tickContractYear, marketAAV, capScale, capForSeason, CAP_FLOOR_PCT, minSalary, deadMoney, dealFromAav, restructure } from './cap'
import { coachEffect } from './coaching'
import { generateProspectClass, generateStreetPool, indexPlayers, type World } from './generate'
import { depthAt, STARTERS } from './depth'
import { coverageGrade, passerRating } from './stats'
import { ledgerFreeAgent } from './picks'
import { unscaleOvr } from './ovrScale'
import { bustRisk, devModifier } from './character'
import { isEvaluator, recordReport } from './scoutBias'
import { clamp, hash32, makeRng, rpick } from './rng'
import { nextClassCount, nextClassSeed, promoteNextClass } from './futureClasses'
import { applyDevFocus, focusPointsFor, devGroupFor } from './devPlan'
import { boostPointsFor, groupDevMultiplier } from './staffMarket'
import { mentorGrowthBonus } from './lockerRoom'
import { cultureDiscountFor, cultureQualifiedClubs } from './culture'
import { playerTradeValue } from './trade'
import { R2AGING, agingProfile, agingGrowth, agingVetDelta, agingDecline, agingBustScale, agingRetireChance } from './r2aging'
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

export function developPlayers(
  world: World,
  user?: { teamId: string; growth: number; mentors?: Record<string, string> },
) {
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
    // FUTURES #28: the club's own position coaches redistribute development between
    // groups (`groupDevMultiplier` deviates each group around the club's mean).
    const dev =
      (p.teamId
        ? coachEffect(world, p.teamId).development * groupDevMultiplier(world, p.teamId, devGroupFor(p.pos))
        : 1) * (p.character ? devModifier(p.character) : 1)
    const growth = Math.max(0, p.pot - p.ovr)
    // D2: growth for young players is earned on the field, not handed out by age.
    const experience = p.age <= 26 ? experienceScore(world, p, psIds) : 0
    // L12.11: Player Development skill speeds up the young players on your club.
    const clubGrowth = user && p.teamId === user.teamId ? user.growth : 1
    // L15 locker room (FUTURES 16): a young player paired with a captain grows
    // faster. User-only, opt-in (no mentor = ×1), and deterministic — it scales
    // the existing growth term without adding or removing any `rng()` draw.
    let mentorMult = 1
    if (user && p.teamId === user.teamId && p.age <= 26) {
      const mentorId = user.mentors?.[p.id]
      if (mentorId && mentorId !== p.id) {
        const mentor = world.players.find((m) => m.id === mentorId)
        if (mentor) mentorMult = 1 + mentorGrowthBonus(mentor)
      }
    }
    // L12.15 S4: with a deliberately thin elite pipeline, young players need to
    // reach their ceilings sooner or the opening star cohort ages out into a
    // multi-year trough. Faster maturation moves the (unchanged) ceiling supply
    // forward without raising the long-run level.
    //
    // r2aging: with the toggle ON, each player sits somewhere on his POSITION's
    // curve (peak age, decline slope) shifted by his own work ethic, injury
    // history and stable career-shape variance. Every `rng()` call below is the
    // same call the original expression made, in the same order — only the
    // arithmetic around each draw changes, so the seed stream is unchanged.
    const aging = R2AGING.on ? agingProfile(p) : null
    if (p.age <= 24) {
      const r = rng()
      const frac = aging ? agingGrowth(aging, 24, experience, r) : 0.22 + 0.42 * experience + r * 0.18
      p.ovr = clamp(Math.min(p.pot, p.ovr + Math.round(growth * frac * dev * clubGrowth * mentorMult)), 40, 99)
    } else if (p.age <= 26) {
      const r = rng()
      const frac = aging ? agingGrowth(aging, 26, experience, r) : 0.15 + 0.28 * experience + r * 0.12
      p.ovr = clamp(Math.min(p.pot, p.ovr + Math.round(growth * frac * dev * clubGrowth * mentorMult)), 40, 99)
    } else if (p.age <= 29) {
      const r1 = rng()
      const r2 = rng()
      const delta = aging ? agingVetDelta(aging, r1, r2) : (r1 < 0.45 ? 1 : 0) - (r2 < 0.25 ? 1 : 0)
      p.ovr = clamp(p.ovr + delta, 40, p.pot)
    } else {
      const r = rng()
      if (aging) {
        p.ovr = clamp(p.ovr - agingDecline(aging, p.ovr, r), 40, 99)
      } else {
        // L12.15 S4: on the compressed new scale a single point costs a star far
        // more, so the league's best age out more slowly — this preserves the rare
        // top band while the (deliberately thin) rookie pipeline matures to replace
        // the opening, mostly-28-to-33-star cohort.
        const elite = p.ovr >= 90
        const decline = p.age >= 34 ? (elite ? 2 : 3) : p.age >= 32 ? (elite ? 1 : 2) : 1
        const rate = p.age <= 33 ? (p.ovr >= 93 ? 0.25 : elite ? 0.5 : 0.7) : elite ? 0.5 : 0.7
        p.ovr = clamp(p.ovr - (r < rate ? decline : 0), 40, 99)
      }
    }
    if (p.age <= 26) p.lastGrowth = { season: world.season, from: ovrBefore, to: p.ovr, experience }

    // L15 development plans (FUTURES row 13): the user's young players convert
    // playing time into focused rating gains. The number of points rides the same
    // experience score the OVR growth uses — a bench player earns none — and a
    // stronger development program (the position coaches) pays off more. Applied
    // only to the user's club and only when a focus is set, so AI development and
    // calibration are untouched. Deterministic: no `rng()` draw is added here.
    if (user && p.teamId === user.teamId && p.age <= 26 && p.devFocus) {
      // FUTURES #28: the specific position coach in the player's seat adds focus
      // points (0–2), capped by MAX_FOCUS_BONUS inside focusPointsFor.
      applyDevFocus(p, focusPointsFor(experience, dev, boostPointsFor(world, p.teamId, p.pos)))
    }

    // Bust risk: a player who never got the motor can stall out. Generated
    // players only — we never invent off-field failure for real names.
    // r2aging: with the toggle ON the risk is position/trait-aware (a real
    // motor avoids most of it) but the draw is the same one as before.
    if (p.character && p.generated && p.age <= 27 && rng() < bustRisk(p.character) * (aging ? agingBustScale(aging) : 0.12)) {
      p.ovr = clamp(p.ovr - 1, 40, 99)
    }

    if (p.age >= 39 || (p.age >= 36 && unscaleOvr(p.ovr) < 62 && rng() < (aging ? agingRetireChance(aging) : 0.4))) retired.push(p)
    // Fringe unsigned veterans retire out of the league, keeping the FA pool sane.
    else if (!p.teamId && (p.age >= 34 || (p.age >= 30 && unscaleOvr(p.ovr) < 72 && rng() < (aging ? agingRetireChance(aging) : 0.4)))) retired.push(p)
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
  const rng = makeRng(nextClassSeed(world))
  // NFL draft pool: draft-eligible college players. Keep a floor of 400.
  const draftCount = nextClassCount(world)
  // FUTURES #29: fold in the future scouting overlay and any returners. With
  // both overlays empty this returns the generated class untouched, so the
  // result is byte-identical to every existing save and to `balance.ts`.
  world.draft = promoteNextClass(world, generateProspectClass(rng, world.season + 1, draftCount))
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
 * Make year-1 room without touching the roster: convert base salary into a
 * prorated signing bonus on the club's biggest deals — the real NFL March move
 * for a club that is tight against the cap. Deterministic and contract-only.
 * Returns true when it freed at least `need`.
 */
function makeRoom(world: World, teamId: string, roster: Player[], need: number): boolean {
  if (need <= 0) return true
  const dead = world.deadMoney[teamId] ?? 0
  const used = () => roster.reduce((s, q) => s + q.contract.capHit, 0) + dead
  const start = used()
  let moves = 0
  // fastars 478: one restructure per deal (a deal that already carries void years
  // is done) and at most two deals per club, so the books cannot be pushed into
  // the future year after year — the earlier version restructured endlessly and
  // the dead money/void proration alone eventually put clubs over 105%.
  const deals = [...roster]
    .filter((p) => (p.contract.voidYears ?? 0) === 0 && (p.contract.base?.[0] ?? 0) > 1_000_000)
    .sort((a, b) => b.contract.capHit - a.contract.capHit)
  for (const p of deals) {
    if (start - used() >= need || moves >= 2) break
    const next = restructure(p.contract, 1)
    if (next.capHit < p.contract.capHit) {
      p.contract = next
      moves++
    }
  }
  return start - used() >= need
}

/** How long a club signs its own man for: the young get length, the old a year. */
function resignYears(p: Player): number {
  if (p.age <= 25) return 4
  if (p.age <= 27) return 3
  if (p.age <= 30) return 2
  return 1
}

/**
 * Before free agency opens, AI clubs re-sign their own best expiring players
 * (within the cap) instead of letting the whole roster walk.
 *
 * fastars (backlog 478): this pass used to stop after FOUR men, wrote the new
 * deal with no signing bonus (`signingBonus 0`, `proration 0`, so the whole
 * market AAV landed in the year-1 cap hit) and gave up the moment
 * `used + AAV > 98% of the cap`. An elite expiring star on a club sitting at
 * 97% was therefore never extended and walked — which, together with the
 * cap-compliance release below, is how Myles Garrett / Justin Jefferson /
 * Micah Parsons ended up unsigned at week 1.
 *
 * Now each club extends its core — the six best expiring men that are projected
 * starters (or rated 78+) — priced like a real extension (bonus + proration, so
 * the year-1 hit is roughly two thirds of the AAV), and only while it keeps real
 * room (86% of its own cap, enough to replace in-season injuries). Replaceable
 * depth (a non-starter under 78) walks rather than eating the room a star needs;
 * that is
 * the front-office trade-off, and it is what stops the payroll from being
 * packed to the ceiling. A star the club cannot fit is not lost either — it is
 * kept by the tag pass that runs immediately after this one (`runAITags`), which
 * adds the year at the end of his deal and so costs nothing against this year's
 * cap. Every decision uses that club's own roster and its own cap; no league
 * average is involved. Deterministic: no rng draw is added or removed, so the
 * play sim is untouched.
 */
export function runAIResign(world: World, skipTeamId?: string, db?: CareerDatabase) {
  const capLimit = capForSeason(world.season)
  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    if (t.id === skipTeamId) continue
    const roster = world.roster[t.id] ?? []
    const dead = world.deadMoney[t.id] ?? 0
    const used = () => roster.reduce((s, p) => s + p.contract.capHit, 0) + dead
    // The men a club keeps: its projected starters, plus anyone 78+.
    const keep = new Set<string>()
    for (const pos of Object.keys(STARTERS) as Position[]) {
      ;[...roster]
        .filter((p) => p.pos === pos)
        .sort((a, b) => b.ovr - a.ovr)
        .slice(0, STARTERS[pos] ?? 1)
        .forEach((p) => keep.add(p.id))
    }
    const expiring = roster
      .filter((p) => p.contract.years <= 1 && unscaleOvr(p.ovr) >= 68)
      .sort((a, b) => b.ovr - a.ovr)
    // A front office re-signs its core, not its whole depth chart: the old pass's
    // limit of four was the right instinct (it kept payrolls — and therefore
    // roster-filling room — healthy); its ORDER was the bug (four men, priced so
    // the whole AAV hit year 1, and only when the club sat at 98% or less). Now
    // six, priced as real deals, and the depth behind them walks.
    let extended = 0
    for (const p of expiring) {
      if (extended >= 6) break
      if (!keep.has(p.id) && unscaleOvr(p.ovr) < 78) continue
      // L12.9 K2: a qualifying club re-signs at a discounted asking price.
      const bias = world.era?.positionBias?.[p.pos] ?? 1
      const base = marketPrice(p, world.season, bias)
      const pct = db ? cultureDiscountFor(world, db, t.id, p).pct : 0
      const aav = pct ? Math.round((base * (1 - pct / 100)) / 1e5) * 1e5 : base
      const next = dealFromAav(p, world.season, aav, resignYears(p), 0.7)
      // The club is already carrying his final-year hit, so only the DELTA counts.
      const delta = next.capHit - p.contract.capHit
      // Keep real room: the leftover cap is what lets the club replace in-season
      // injuries, so a roster never runs under the 45-man floor. A star who does
      // not fit is kept by the tag pass instead (`runAITags`).
      if (used() + delta > capLimit * 0.86) continue
      p.contract = next
      p.teamId = t.id
      extended++
    }
  }
}

/**
 * Keep every NFL club under the cap after the offseason. If a team is over, it
 * cuts its worst value-per-dollar players (above position floors) to free agents
 * until it has a little breathing room. Called once, after FA and trades.
 *
 * fastars (backlog 478): "worst value per dollar" was read as `ovr / capHit`
 * ASCENDING — the lowest rating per dollar first — which makes a club's
 * best-paid STAR its number-one cut (a $65M QB scores 1.5 per million, a $1M
 * backup scores 65). Seed 33333 season 2026 is exactly that: 17 of 32 clubs were
 * over 96% of the cap at camp and each released one man, and the men released
 * were Joe Burrow $63.5M, Lamar Jackson $65.0M, Myles Garrett $51.6M, Micah
 * Parsons $48.4M, T.J. Watt, Nick Bosa, Ja'Marr Chase, CeeDee Lamb … — the
 * unsigned 90+ list the user saw at week 1. A front office does the opposite of
 * cutting its stars:
 *   1. release the genuinely surplus / overpaid bodies — a man whose cap hit
 *      sits above his OWN market price (`marketAAV`), ranked by that overpay,
 *      never a protected starter and never below a position floor;
 *   2. still over? restructure the biggest deals (base → prorated bonus), the
 *      real March move for a club tight against the cap — no player is lost;
 *   3. still over? release the largest cap hits left among the non-starters.
 * Each club decides on its own roster and its own cap. Deterministic (no rng
 * draw) and contract-only, exactly like the pass it replaces.
 */
export function enforceCapCompliance(world: World) {
  const FLOOR: Record<string, number> = {
    QB: 2, RB: 2, WR: 4, TE: 2, OT: 3, OG: 3, C: 1, DE: 3, DT: 3, LB: 4, CB: 4, S: 3, K: 1, P: 1,
  }
  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    const roster = world.roster[t.id] ?? []
    const limit = capForSeason(world.season)
    const target = limit * 0.94
    const used = () => roster.reduce((s, p) => s + p.contract.capHit, 0) + (world.deadMoney[t.id] ?? 0)
    if (used() <= target) continue
    const counts: Record<string, number> = {}
    for (const p of roster) counts[p.pos] = (counts[p.pos] ?? 0) + 1
    // A club's starters are its protected men: the best STARTERS[pos] by OVR at
    // every position. They are extended or restructured, never cut for value.
    const protectedIds = new Set<string>()
    for (const pos of Object.keys(STARTERS) as Position[]) {
      ;[...roster]
        .filter((p) => p.pos === pos)
        .sort((a, b) => b.ovr - a.ovr)
        .slice(0, STARTERS[pos] ?? 1)
        .forEach((p) => protectedIds.add(p.id))
    }
    const release = (p: Player) => {
      const idx = roster.indexOf(p)
      if (idx < 0) return
      roster.splice(idx, 1)
      counts[p.pos] = (counts[p.pos] ?? 0) - 1
      p.teamId = null
      p.faWeeks = 0
      p.contract = voidContract(p.contract)
      world.freeAgents.push(p)
    }
    // 1. the overpaid surplus: a cap hit above the man's own market price, worst
    //    first. A fair deal (or a star) is not a cap casualty.
    const overpaid = roster
      .filter((p) => !protectedIds.has(p.id) && unscaleOvr(p.ovr) < 88)
      .map((p) => ({ p, over: p.contract.capHit - marketAAV(p.ovr, p.pos, p.age) }))
      .sort((a, b) => b.over - a.over || a.p.ovr - b.p.ovr)
    for (const { p, over } of overpaid) {
      if (used() <= target || roster.length <= ROSTER_MIN) break
      if (over <= 0) break
      if ((counts[p.pos] ?? 0) <= (FLOOR[p.pos] ?? 2)) continue
      release(p)
    }
    // 2. restructure the biggest deals — the NFL's March move.
    if (used() > target) makeRoom(world, t.id, roster, used() - target)
    // 3. last resort: the largest cap hits left among the non-starters.
    if (used() > target) {
      const rest = [...roster]
        .filter((p) => !protectedIds.has(p.id))
        .sort((a, b) => b.contract.capHit - a.contract.capHit)
      for (const p of rest) {
        if (used() <= target || roster.length <= ROSTER_MIN) break
        if ((counts[p.pos] ?? 0) <= (FLOOR[p.pos] ?? 2)) continue
        release(p)
      }
    }
  }
}

/**
 * A few AI-to-AI trades each offseason, so the league moves on its own: teams
 * swap similar-value players where each has a surplus. Cheap, but it makes the
 * world feel alive and gives the media something to report.
 *
 * `skipTeamId`: a head coach who holds the trade pen (CareerState.tradeControl
 * 'coach') — the AI GM makes no deal involving that club on its own. The
 * draws are still made first, so the rng stream is unchanged.
 */
export function runAITrades(world: World, skipTeamId?: string | null) {
  const rng = makeRng(world.seed + world.season * 7079)
  const nfl = world.teams.filter((t) => t.tier === 'NFL')
  // League-average bodies per position, the yardstick for "surplus" and "need".
  const avgBody: Record<string, number> = {}
  for (const t of nfl) for (const p of world.roster[t.id] ?? []) avgBody[p.pos] = (avgBody[p.pos] ?? 0) + 1
  for (const k of Object.keys(avgBody)) avgBody[k] /= nfl.length || 1
  let made = 0
  for (let i = 0; i < 20 && made < 4; i++) {
    const a = rpick(rng, nfl)
    const b = rpick(rng, nfl)
    if (a.id === b.id) continue
    const ra = world.roster[a.id] ?? []
    const rb = world.roster[b.id] ?? []
    const pa = [...ra].filter((p) => unscaleOvr(p.ovr) >= 70 && unscaleOvr(p.ovr) <= 84).sort(() => rng() - 0.5)[0]
    const pb = [...rb].filter((p) => unscaleOvr(p.ovr) >= 70 && unscaleOvr(p.ovr) <= 84).sort(() => rng() - 0.5)[0]
    if (!pa || !pb) continue
    // Both players are drawn above, so skipping a deal never shifts the rng stream.
    if (skipTeamId && (a.id === skipTeamId || b.id === skipTeamId)) continue
    if (Math.abs(unscaleOvr(pa.ovr) - unscaleOvr(pb.ovr)) > 7 || pa.pos === pb.pos) continue
    // Backlog 399: the swap has to be a real trade by the market's own values.
    // Clubs never move their passer like this, the two assets have to be close
    // in trade value (position and contract included), and each side has to be
    // filling a position it is thinner at.
    if (pa.pos === 'QB' || pb.pos === 'QB') continue
    const va = playerTradeValue(pa)
    const vb = playerTradeValue(pb)
    if (va <= 0 || vb <= 0) continue
    // Value parity (backlog 399): across-position swaps legitimately differ by
    // their position multipliers, so a tight cap starved the market. 3.0x is
    // still far from a free lunch — a lopsided offer is declined elsewhere.
    if (Math.max(va, vb) / Math.min(va, vb) > 3.0) continue
    // Clubs trade from a surplus to fill a need. Numbers first — deeper than the
    // league average at the position they give up, thinner at the one they take
    // — with a talent fallback for the common case where trimming has levelled
    // the counts: the man given up is only a spare (two better bodies sit ahead
    // of him) and he would be a top-two player at the partner's.
    const cnt = (id: string, pos: Position) => (world.roster[id] ?? []).filter((x) => x.pos === pos).length
    const better = (id: string, p: Player) => (world.roster[id] ?? []).filter((x) => x.pos === p.pos && unscaleOvr(x.ovr) > unscaleOvr(p.ovr)).length
    const fillNeed = (id: string, give: Player, take: Player) =>
      (cnt(id, give.pos) > (avgBody[give.pos] ?? 3) && cnt(id, take.pos) < (avgBody[take.pos] ?? 3)) ||
      (better(id, give) >= 2 && better(id, take) <= 1)
    if (!fillNeed(a.id, pa, pb) || !fillNeed(b.id, pb, pa)) continue
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
  return made
}

// ── Free agency AI: teams re-sign or sign to fill needs ───────────────────────/** Minimum bodies per position when trimming a roster to 53. */
export const ROSTER_FLOOR: Record<string, number> = {
  QB: 2, RB: 2, WR: 4, TE: 2, OT: 3, OG: 3, C: 1, DE: 3, DT: 3, LB: 4, CB: 4, S: 3, K: 1, P: 1,
}

/** The NFL's in-season roster limit — the size every AI club carries into week 1. */
export const ROSTER_TARGET = 53
/**
 * offseason90 (user 2026-10-15): the NFL's offseason camp limit. A club may carry
 * up to 90 through free agency, the draft, UDFAs, promotions, claims and trades,
 * and must be down to ROSTER_TARGET by week 1 (cutdown day). Only the user's club
 * gets this window in this job — AI clubs still work to ROSTER_TARGET.
 */
export const ROSTER_OFFSEASON_MAX = 90
/** The league's legal roster minimum (45–60 is the invariant every save must keep). */
export const ROSTER_MIN = 45

/**
 * offseason90: the roster limit that applies to the user's club right now — a
 * 90-man camp in the offseason, the usual 53 from week 1.
 */
export function rosterLimit(world: World): number {
  return world.phase === 'offseason' ? ROSTER_OFFSEASON_MAX : ROSTER_TARGET
}

/**
 * offseason90: the surplus bodies a club cuts to reach `target`, lowest-rated
 * first, never touching a position already at its ROSTER_FLOOR minimum — the
 * same ordering `trimNflRosters` uses. Deterministic (no rng) and read-only: the
 * caller applies the cuts through the normal release path so the cap maths and
 * the dead money are exactly the ones the Cap screen shows.
 */
export function recommendedCuts(roster: Player[], target: number = ROSTER_TARGET): Player[] {
  const counts: Record<string, number> = {}
  for (const p of roster) counts[p.pos] = (counts[p.pos] ?? 0) + 1
  const cuts: Player[] = []
  for (const p of [...roster].sort((a, b) => a.ovr - b.ovr)) {
    if (roster.length - cuts.length <= target) break
    if ((counts[p.pos] ?? 0) <= (ROSTER_FLOOR[p.pos] ?? 2)) continue
    counts[p.pos] -= 1
    cuts.push(p)
  }
  return cuts
}

/**
 * Cut every NFL roster down to 53, lowest-rated surplus first. Without this,
 * drafted players accumulate forever and the cap model drifts out of reality.
 *
 * offseason90: `skipTeamId` (the user's club in the offseason) is left alone —
 * it runs a 90-man camp until cutdown day. League-only runs pass nothing, so the
 * headless sim and the AI markets are untouched.
 */
export function trimNflRosters(world: World, skipTeamId?: string | null) {
  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    if (skipTeamId && t.id === skipTeamId && world.phase === 'offseason') continue
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
      p.faWeeks = 0
      p.contract = voidContract(p.contract)
      world.freeAgents.push(p)
    }
  }
  balanceStreetPool(world)
}

/** Market price for a free agent in a given season (tracks cap growth + era drift). */
export function marketPrice(p: Player, season: number, posBias = 1): number {
  return Math.round((marketAAV(p.ovr, p.pos, p.age) * capScale(season) * posBias) / 100_000) * 100_000
}

/**
 * Backlog 408 (2c): a free agent's asking price falls the longer he sits
 * unsigned. Fringe bodies reach the veteran minimum within a few weeks; elite
 * vets hold out (they never drop below a majority of market) while a starter's
 * ask erodes gradually. Per player — age and rating set both the horizon and
 * the floor, so there is no league-wide average.
 */
export function freeAgentAsk(p: Player, season: number, faWeeks = 0, posBias = 1): number {
  const base = marketPrice(p, season, posBias)
  const min = minSalary(Math.max(p.age - 22, 0))
  const elite = p.ovr >= 85
  const starter = p.ovr >= 75
  // Weeks to fall most of the way to the floor; elite vets hold out longest.
  const horizon = elite ? 15 : starter ? 8 : 4
  const holdFrac = elite ? 0.55 : starter ? 0.4 : 0.05
  const t = clamp(faWeeks / horizon, 0, 1)
  const ease = t * t * (3 - 2 * t) // smoothstep
  const frac = 1 - (1 - holdFrac) * ease
  return Math.max(min, Math.round((base * frac) / 1e5) * 1e5)
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
  // Backlog 408 (2c): the ask falls week by week while he is unsigned.
  const market = annualOverride ?? freeAgentAsk(p, season, p.faWeeks ?? 0)
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

/**
 * The position-need table the AI free-agency market fills toward. Shared with
 * the March frenzy (FUTURES #11) so the two markets use one definition of a
 * roster hole. Like the original table it has no FB entry, so the AI
 * market's iteration order — and therefore its behaviour — is unchanged.
 * Read-only: both markets share this one object.
 */
export const FA_NEEDS: Readonly<Record<string, number>> = { QB: 3, RB: 3, WR: 6, TE: 3, OT: 4, OG: 4, C: 2, DE: 4, DT: 4, LB: 6, CB: 6, S: 4, K: 1, P: 1 }

export function runAIFreeAgency(world: World, skipTeamId?: string, db?: CareerDatabase) {
  // offseason90: the user's club keeps its 90-man camp through the March market.
  trimNflRosters(world, skipTeamId)
  const rng = makeRng(world.seed + world.season * 90001)
  const needed = FA_NEEDS
  const freeCopy = [...world.freeAgents].sort((a, b) => b.ovr - a.ovr)
  const taken = new Set<string>()
  const capLimit = capForSeason(world.season)
  // L12.9 K2: the asking price a qualifying club pays; and FA interest tilts to
  // those clubs, so they get first crack at the market's best bodies.
  // fastars 478: the ask is the decayed one (`freeAgentAsk`) — identical to
  // `marketPrice` for a man who has just become a free agent (faWeeks 0), and
  // lower for one who has sat unsigned while the market moved past him, so the
  // price falls with time unsigned exactly like the in-season market (408).
  const price = (teamId: string, p: Player, bias: number) => {
    const base = freeAgentAsk(p, world.season, p.faWeeks ?? 0, bias)
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
        // fastars 478: even that body has to fit under the cap (the old path
        // signed him regardless, which is how clubs arrived at 100-102% of the
        // cap and then released a franchise player to get legal). A club that
        // genuinely cannot afford a body leaves the slot to `fillNflRosters`.
        if (!cand) {
          cand = [...freeCopy]
            .filter((p) => !taken.has(p.id) && p.pos === pos && used0() + price(t.id, p, eraBias) <= capLimit * 0.99)
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
          release.faWeeks = 0
          release.contract = voidContract(release.contract)
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
  trimNflRosters(world, skipTeamId)
  // Z1b: adopt any newly signed players into `world.players`.
  indexPlayers(world)
}

/**
 * rosterfloor: bring every AI club up to the NFL's 53 before week 1.
 *
 * The March market fills each *position* to FA_NEEDS — 51 bodies in total — so a
 * club can end the offseason legal-but-thin, and any later cut (cap compliance,
 * a waiver claim) pushes it under the 45 floor. This tops the *total* up with the
 * best body the club's own cap allows, one player at a time, thinnest hole
 * first: the same per-player logic `signBestFit` uses, never a league average.
 * Deterministic — no rng draw, so the play sim is untouched.
 *
 * fastars 478: if the books are full the club still reaches the 45-man floor —
 * with a league-minimum deal, not by taking the field short (the cap-compliance
 * pass then makes the room, exactly as a real front office does).
 */
export function fillNflRosters(world: World, skipTeamId?: string | null) {
  const capLimit = capForSeason(world.season)
  let signed = 0
  for (const t of world.teams) {
    if (t.tier !== 'NFL' || t.id === skipTeamId) continue
    const roster = world.roster[t.id] ?? []
    const usedCap = () => roster.reduce((s, q) => s + q.contract.capHit, 0) + (world.deadMoney[t.id] ?? 0)
    while (roster.length < ROSTER_TARGET) {
      const counts: Record<string, number> = {}
      for (const p of roster) counts[p.pos] = (counts[p.pos] ?? 0) + 1
      const deficit = (pos: string) => (FA_NEEDS[pos] ?? 0) - (counts[pos] ?? 0)
      // Thinnest hole first (FA_NEEDS is the club's own need table); ties by pos.
      const holes = [...new Set([...Object.keys(FA_NEEDS), ...Object.keys(counts)])].sort(
        (a, b) => deficit(b) - deficit(a) || (a < b ? -1 : a > b ? 1 : 0),
      )
      let chosen: Player | null = null
      let minimum = false
      for (const pos of holes) {
        const bias = world.era?.positionBias?.[pos as Position] ?? 1
        chosen =
          world.freeAgents
            .filter((p) => p.pos === pos)
            .sort((a, b) => b.ovr - a.ovr || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            .find((p) => usedCap() + marketPrice(p, world.season, bias) <= capLimit) ?? null
        if (chosen) break
      }
      // fastars 478: a club that cannot fit another market deal is not allowed to
      // take the field short either — the 45-man floor is a league rule, and a
      // cap-strapped front office signs a MINIMUM deal and cuts elsewhere (which
      // the cap-compliance pass then does). Without this, a star-keeping club
      // whose books are full entered week 1 at 43 players and the smoke's roster
      // invariant (45–60) failed.
      if (!chosen && roster.length < ROSTER_MIN) {
        chosen =
          [...world.freeAgents].sort(
            (a, b) => a.ovr - b.ovr || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
          )[0] ?? null
        minimum = true
      }
      if (!chosen) break
      const bias = world.era?.positionBias?.[chosen.pos] ?? 1
      const annual = minimum ? minSalary(Math.max(chosen.age - 22, 0)) : marketPrice(chosen, world.season, bias)
      world.freeAgents = world.freeAgents.filter((p) => p.id !== chosen!.id)
      chosen.teamId = t.id
      chosen.faWeeks = 0
      chosen.contract = minimum
        ? {
            ...chosen.contract,
            annual,
            years: 1,
            length: 1,
            base: [annual],
            signingBonus: 0,
            proration: 0,
            guaranteed: 0,
            capHit: annual,
            signedThrough: world.season,
          }
        : { ...chosen.contract, annual, years: 2, base: [annual, annual], capHit: annual }
      roster.push(chosen)
      ledgerFreeAgent(world, t.id, 'gained', chosen.ovr)
      signed++
    }
  }
  // Adopt anything we just signed into `world.players`.
  if (signed) indexPlayers(world)
  return signed
}

/** Backlog 408 (2d): a released player keeps no contract; his dead money stays
 *  with the old club. */
function voidContract(c: Contract): Contract {
  return { ...c, years: 0, length: 0, base: [0], signingBonus: 0, proration: 0, guaranteed: 0, capHit: 0, annual: 0 }
}

/** The street pool's realistic in-season band (2a). */
const STREET_MIN = 280
const STREET_MAX = 420

/**
 * Backlog 408 (2c): advance the unsigned clock. Every free agent gains a week;
 * a 34+ vet unsigned by midseason may retire (hash-based, per player's age and
 * rating, so a 36-year-old backup hangs it up far more often than a 34-year-old
 * starter).
 */
function tickUnsignedMarket(world: World) {
  const keep: Player[] = []
  for (const p of world.freeAgents) {
    p.faWeeks = (p.faWeeks ?? 0) + 1
    if (p.age >= 34 && world.week >= 9) {
      const base = p.ovr >= 85 ? 6 : p.ovr >= 75 ? 11 : p.ovr >= 65 ? 16 : 22
      const risk = Math.min(65, base + (p.age - 34) * 7)
      if (hash32(`${p.id}|retire|${world.season}`, p.age) % 100 < risk) continue
    }
    keep.push(p)
  }
  world.freeAgents = keep
}

/**
 * Backlog 408 (2b): sign the free agent who most improves a club's depth chart
 * at a need or injured slot, if his own ask fits the club's cap. One signing per
 * club per week; a full roster releases its weakest surplus body at the position
 * to stay at 53. Deterministic — no rng draw, so the play sim is untouched.
 */
function signBestFit(world: World, teamId: string, capLimit: number) {
  const roster = world.roster[teamId] ?? []
  const usedCap = () => roster.reduce((s, q) => s + q.contract.capHit, 0) + (world.deadMoney[teamId] ?? 0)
  let best: Player | null = null
  let bestScore = 0
  for (const p of world.freeAgents) {
    const depth = depthAt(world, teamId, p.pos)
    const startersN = STARTERS[p.pos] ?? 1
    const starters = depth.slice(0, startersN)
    const injuredStarter = starters.some((x) => x.injured && x.injured.games >= 2)
    const count = roster.reduce((s, x) => s + (x.pos === p.pos ? 1 : 0), 0)
    const deficit = (FA_NEEDS[p.pos] ?? 0) - count
    const bestAtPos = depth.length ? Math.max(...depth.map((x) => x.ovr)) : 0
    let score = 0
    if (deficit > 0) score = 30 + (p.ovr - 55) // fill a thin slot
    else if (injuredStarter) score = 20 + (p.ovr - 55) // cover an injury
    // A genuine depth-chart upgrade: elite vets upgrade anyone, mid vets only a
    // thin room (and never a fringe body).
    else if (
      (p.ovr >= 85 && p.ovr >= bestAtPos) ||
      (p.ovr >= 78 && p.ovr >= bestAtPos + 3 && depth.length <= startersN + 1)
    ) {
      score = p.ovr - bestAtPos + 1
    }
    if (score <= 0) continue
    if (score > bestScore || (score === bestScore && best && p.ovr > best.ovr)) {
      best = p
      bestScore = score
    }
  }
  if (!best) return
  const contract = freeAgentContract(best, world.season, world.week, 'regular')
  if (usedCap() + contract.capHit > capLimit) return
  if (roster.length >= 53) {
    const floor = ROSTER_FLOOR[best.pos] ?? 2
    const atPos = roster.filter((x) => x.pos === best.pos)
    if (atPos.length <= floor) return
    const weakest = atPos.sort((a, b) => a.ovr - b.ovr || (a.id < b.id ? -1 : 1))[0]
    const idx = roster.indexOf(weakest)
    if (idx < 0) return
    roster.splice(idx, 1)
    world.deadMoney[teamId] = (world.deadMoney[teamId] ?? 0) + deadMoney(weakest.contract)
    weakest.teamId = null
    weakest.faWeeks = 0
    weakest.contract = voidContract(weakest.contract)
    world.freeAgents.push(weakest)
  }
  const signed = best
  world.freeAgents = world.freeAgents.filter((x) => x.id !== signed.id)
  signed.teamId = teamId
  signed.faWeeks = 0
  signed.contract = contract
  roster.push(signed)
  ledgerFreeAgent(world, teamId, 'gained', signed.ovr)
}

/**
 * Backlog 408 (2a): keep the street pool in its realistic in-season band. Above
 * the cap the oldest fringe bodies leave the league; below the floor fresh
 * street bodies are drawn from a separate hash stream (never the sim rng).
 *
 * The band describes the *in-season* street pool. In the offseason the list
 * legitimately holds the whole unsigned class — every expiring contract lands
 * here in one cohort — and the AI market needs those bodies to refill 32 clubs
 * (rosterfloor: trimming here starved the market, so the clubs at the end of
 * `runAIFreeAgency`'s order started a season under 45). The weekly in-season
 * call still compacts the pool before week 1, so the band itself is unchanged.
 */
function balanceStreetPool(world: World) {
  const fas = world.freeAgents
  if (world.phase === 'regular' && fas.length > STREET_MAX) {
    const excess = fas.length - STREET_MAX
    const drop = new Set(
      [...fas]
        .filter((p) => p.ovr <= 68)
        .sort((a, b) => a.ovr - b.ovr || b.age - a.age || (a.id < b.id ? -1 : 1))
        .slice(0, excess)
        .map((p) => p.id),
    )
    world.freeAgents = fas.filter((p) => !drop.has(p.id))
  } else if (fas.length < STREET_MIN) {
    const rng = makeRng(hash32(`streetfill|${world.seed}|${world.season}|${world.week}`))
    const need = Math.min(60, STREET_MIN - fas.length)
    for (const p of generateStreetPool(rng, world.season, need)) world.freeAgents.push(p)
  }
}

/**
 * Backlog 408: the in-season free-agent market. Runs weekly after the injury
 * moves: the unsigned clock ticks (asks fall, vets retire), then every club
 * signs the free agent who most improves its depth chart if he fits its cap.
 */
export function runInSeasonFreeAgency(world: World, skipTeamId?: string): void {
  if (world.phase !== 'regular') return
  const capLimit = capForSeason(world.season)
  tickUnsignedMarket(world)
  for (const t of world.teams) {
    if (t.tier !== 'NFL' || t.id === skipTeamId) continue
    signBestFit(world, t.id, capLimit)
  }
  balanceStreetPool(world)
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

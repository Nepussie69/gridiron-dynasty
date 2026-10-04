import type { CareerState, Player, Recommendation } from '../types'
import { tickContractYear, marketAAV, capScale, capForSeason } from './cap'
import { coachEffect } from './coaching'
import { generateProspectClass, generateRecruitClass, type World } from './generate'
import { ledgerFreeAgent } from './picks'
import { clamp, makeRng } from './rng'

// ── Player development ───────────────────────────────────────────────────────
export function developPlayers(world: World) {
  const rng = makeRng(world.seed + world.season * 31337)
  const retired: Player[] = []

  for (const p of world.players) {
    p.age += 1
    // Staff quality changes how fast young players grow and how slowly vets decline.
    const dev = p.teamId ? coachEffect(world, p.teamId).development : 1
    const growth = Math.max(0, p.pot - p.ovr)
    if (p.age <= 24) {
      p.ovr = clamp(Math.min(p.pot, p.ovr + Math.round(growth * (0.34 + rng() * 0.2) * dev)), 40, 99)
    } else if (p.age <= 26) {
      p.ovr = clamp(Math.min(p.pot, p.ovr + Math.round(growth * (0.2 + rng() * 0.15) * dev)), 40, 99)
    } else if (p.age <= 29) {
      p.ovr = clamp(p.ovr + (rng() < 0.45 ? 1 : 0) - (rng() < 0.25 ? 1 : 0), 40, p.pot)
    } else {
      const decline = p.age >= 34 ? 3 : p.age >= 32 ? 2 : 1
      p.ovr = clamp(p.ovr - (rng() < 0.7 ? decline : 0), 40, 99)
    }

    if (p.age >= 39 || (p.age >= 36 && p.ovr < 62 && rng() < 0.4)) retired.push(p)
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
  const rawDelta = (avg - 0.5) * Math.min(36, 10 + recs.length * 1.1)
  const repDelta = Math.round(clamp(rawDelta, -12, 16))
  const accuracy = recs.length ? Math.round((hits / recs.length) * 100) : 0

  details.sort((a, b) => Number(a.hit) - Number(b.hit))
  return { graded: recs.length, hits, misses, accuracy, repDelta, details }
}

// ── New draft + recruiting classes ───────────────────────────────────────────
/**
 * Roll the prospect pools into the new season.
 *
 * Both pools are REPLACED each year — a fresh draft class and a fresh
 * recruiting class. This is deliberate: leftovers from a previous cycle are
 * stale (they've been drafted/committed or aged out), and the game should never
 * run dry. If anything, we guarantee a floor so a season can always be played.
 */
export function refreshProspectClass(world: World) {
  const rng = makeRng(world.seed + (world.season + 1) * 65537)
  // NFL draft pool: draft-eligible college players. Keep a floor of 400.
  const draftCount = Math.max(400, world.draft?.length ?? 0)
  world.draft = generateProspectClass(rng, world.season + 1, draftCount)
  // College recruiting pool: high-school prospects. Keep a floor of 300.
  const recruitCount = Math.max(300, world.recruits?.length ?? 0)
  world.recruits = generateRecruitClass(rng, world.season + 1, recruitCount)
}

/**
 * Safety net: if a pool is somehow exhausted mid-cycle (every prospect drafted,
 * every recruit committed), generate a replacement class so the season can
 * continue. Called before each scouting/recruiting interaction.
 */
export function ensureProspectPools(world: World) {
  const rng = makeRng(world.seed + world.season * 7919)
  if (!world.draft || world.draft.filter((p) => !p.draftedBy).length === 0) {
    world.draft = generateProspectClass(rng, world.season, Math.max(200, world.draft?.length ?? 0))
  }
  if (!world.recruits || world.recruits.filter((p) => !p.committedTo).length === 0) {
    world.recruits = generateRecruitClass(rng, world.season, Math.max(150, world.recruits?.length ?? 0))
  }
}

// ── Free agency AI: teams re-sign or sign to fill needs ───────────────────────
/** Minimum bodies per position when trimming a roster to 53. */
const ROSTER_FLOOR: Record<string, number> = {
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

/** Market price for a free agent in a given season (tracks cap growth). */
function priceFor(p: Player, season: number): number {
  return Math.round((marketAAV(p.ovr, p.pos, p.age) * capScale(season)) / 100_000) * 100_000
}

export function runAIFreeAgency(world: World) {
  trimNflRosters(world)
  const rng = makeRng(world.seed + world.season * 90001)
  const needed: Record<string, number> = { QB: 3, RB: 3, WR: 6, TE: 3, OT: 4, OG: 4, C: 2, DE: 4, DT: 4, LB: 6, CB: 6, S: 4, K: 1, P: 1 }
  const freeCopy = [...world.freeAgents].sort((a, b) => b.ovr - a.ovr)
  const taken = new Set<string>()
  const capLimit = capForSeason(world.season)

  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    const roster = world.roster[t.id] ?? []
    const counts: Record<string, number> = {}
    for (const p of roster) counts[p.pos] = (counts[p.pos] ?? 0) + 1
    for (const pos of Object.keys(needed)) {
      let deficit = needed[pos] - (counts[pos] ?? 0)
      while (deficit > 0) {
        const used0 = () => roster.reduce((s, q) => s + q.contract.capHit, 0) + (world.deadMoney[t.id] ?? 0)
        let cand = freeCopy.find((p) => {
          if (taken.has(p.id) || p.pos !== pos) return false
          return used0() + priceFor(p, world.season) <= capLimit
        })
        // Over the cap: fill remaining slots with the cheapest body, not a star.
        if (!cand) {
          cand = [...freeCopy]
            .filter((p) => !taken.has(p.id) && p.pos === pos)
            .sort((a, b) => priceFor(a, world.season) - priceFor(b, world.season))[0]
        }
        if (!cand) break
        const annual = priceFor(cand, world.season)
        taken.add(cand.id)
        cand.teamId = t.id
        cand.contract = { ...cand.contract, annual, years: 2, base: [annual, annual], capHit: annual }
        world.roster[t.id].push(cand)
        counts[pos] = (counts[pos] ?? 0) + 1
        deficit--
        ledgerFreeAgent(world, t.id, 'gained', cand.ovr)
      }
    }
    void rng
  }
  world.freeAgents = world.freeAgents.filter((p) => !taken.has(p.id))
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

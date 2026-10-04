import type { CareerState, Player, Recommendation } from '../types'
import { tickContractYear } from './cap'
import { coachEffect } from './coaching'
import { generateProspectClass, type World } from './generate'
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

    if (p.age >= 36 || (p.age >= 33 && p.ovr < 66 && rng() < 0.55)) retired.push(p)
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
  const rawDelta = (avg - 0.5) * Math.min(24, 8 + recs.length * 0.7)
  const repDelta = Math.round(clamp(rawDelta, -11, 12))
  const accuracy = recs.length ? Math.round((hits / recs.length) * 100) : 0

  details.sort((a, b) => Number(a.hit) - Number(b.hit))
  return { graded: recs.length, hits, misses, accuracy, repDelta, details }
}

// ── New recruiting/draft class ───────────────────────────────────────────────
export function refreshProspectClass(world: World) {
  const rng = makeRng(world.seed + (world.season + 1) * 65537)
  world.draft = generateProspectClass(rng, world.season + 1)
}

// ── Free agency AI: teams re-sign or sign to fill needs ───────────────────────
export function runAIFreeAgency(world: World) {
  const rng = makeRng(world.seed + world.season * 90001)
  const needed: Record<string, number> = { QB: 3, RB: 3, WR: 6, TE: 3, OT: 4, OG: 4, C: 2, DE: 4, DT: 4, LB: 6, CB: 6, S: 4, K: 1, P: 1 }
  const freeCopy = [...world.freeAgents].sort((a, b) => b.ovr - a.ovr)
  const taken = new Set<string>()

  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    const roster = world.roster[t.id] ?? []
    const counts: Record<string, number> = {}
    for (const p of roster) counts[p.pos] = (counts[p.pos] ?? 0) + 1
    for (const pos of Object.keys(needed)) {
      const deficit = needed[pos] - (counts[pos] ?? 0)
      if (deficit <= 0) continue
      const cand = freeCopy.find((p) => !taken.has(p.id) && p.pos === pos)
      if (cand) {
        taken.add(cand.id)
        cand.teamId = t.id
        cand.contract = { ...cand.contract, years: 2, base: [cand.contract.annual, cand.contract.annual], capHit: cand.contract.annual }
        world.roster[t.id].push(cand)
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

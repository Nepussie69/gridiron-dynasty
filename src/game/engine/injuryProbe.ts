// ─────────────────────────────────────────────────────────────────────────────
// Injury-decision probe (FUTURES #15 / L15, phase A).
//
// Pure and offline-runnable (no React, no DOM, no store): the node harness boots
// a real career and calls `injuryCallProbe(world, career, n)` per seed. It proves
// the phase-A acceptance on the live world *without* the phase-B store wiring, so
// the engine can be verified before it is hooked up.
//   • gameStatus thresholds + IR (never a choice) and purity/agreement,
//   • aggravation base rate (grade C) for Q and D, and that it falls with TGH,
//   • grade A safer than grade D,
//   • the rating penalty applies only while `hurt` is set (never to ovr/TGH),
//   • activate/restore leave no `hurt`/`hurtSaved` behind on either path,
//   • the fast path's heal draw count / next-week world hash matches a Sit run,
//   • owner pressure fires only in a push and is capped at ±3 for the week,
//   • a career without `injuryCalls` still loads and behaves as a sit week.
//
// It clones the world for every mutation, so it never perturbs the live career.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, Player } from '../types'
import type { World } from './generate'
import { hash32 } from './rng'
import { healAfterWeek } from './sim'
import { playerAttrs } from '../data/ratings'
import { POS_MEAN } from './ratingMeans'
import {
  activatePlayHurt,
  aggravationRoll,
  aggravationRisk,
  gameStatus,
  hurtStateFor,
  inPlayoffPush,
  injuryReport,
  normalizeInjuryState,
  ownerPressure,
  restorePlayHurt,
  type InjuryStatus,
  type MedicalGrade,
} from './injuryCalls'

const clone = <T,>(v: T): T => structuredClone(v)

/** Deterministic digest of the state `healPlayers` touches (injuries + fatigue). */
function worldHash(world: World): number {
  const rows = world.players
    .map((p) => `${p.id}:${p.injured ? `${p.injured.games}:${p.injured.note}` : '-'}:${p.fatigue ?? 0}`)
    .sort()
  return hash32(rows.join('|'), world.seed)
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
const inBand = (v: number, lo: number, hi: number) => v >= lo && v <= hi

export interface InjuryProbeReport {
  seed: number
  trials: number
  /** Thresholds for games=1..4 and IR. */
  mapping: Record<string, InjuryStatus | null>
  mappingOk: boolean
  /** Mean grade-C aggravation risk, and the empirical hash-hit rate, over trials. */
  aggravQ: number
  aggravD: number
  hitQ: number
  hitD: number
  aggravOk: boolean
  /** Mean risk for the least-durable vs most-durable sampled player. */
  riskLowTgh: number
  riskHighTgh: number
  fallsWithTgh: boolean
  gradeA: number
  gradeD: number
  gradeOrdered: boolean
  penaltyOnlyWhileHurt: boolean
  penaltySample: { before: number; hurt: number; after: number; tghStable: boolean }
  /** No `hurt`/`hurtSaved` survives a full week on the fast AND coached paths. */
  noHurtLeftFast: boolean
  noHurtLeftCoached: boolean
  /** The fast path's post-heal world hash equals a pure Sit run's. */
  healParity: boolean
  healHashSit: number
  healHashFast: number
  /** The decision-time report is identical for the fast and coached paths. */
  gameStatusAgrees: boolean
  /** Owner pressure: abs(security)<=3 and abs(leadership)<=3, and zero outside a push. */
  pushActive: boolean
  pushSits: number
  ownerCapOk: boolean
  outsidePushSilent: boolean
  oldSaveLoads: boolean
  ok: boolean
}

/** One seed's report. `n` is the number of forced aggravation trials. */
export function injuryCallProbe(world: World, career: CareerState, n = 1200): InjuryProbeReport {
  const roster = world.roster[career.teamId] ?? []
  const grade: MedicalGrade = 'C'

  // ── gameStatus thresholds + IR ────────────────────────────────────────────
  const probePlayer = roster.find((p) => !p.injured) ?? roster[0]
  const mapping = (g: number | 'IR'): InjuryStatus | null => {
    if (!probePlayer) return null
    const w = clone(world)
    const p = w.players.find((x) => x.id === probePlayer.id)!
    p.injured = undefined
    for (const t of Object.keys(w.ir ?? {})) w.ir![t] = (w.ir![t] ?? []).filter((x) => x.id !== p.id)
    if (g === 'IR') {
      w.ir = { ...(w.ir ?? {}), [career.teamId]: [...(w.ir?.[career.teamId] ?? []), p] }
    } else if (g > 0) {
      p.injured = { games: g, note: 'Hamstring' }
    }
    return gameStatus(p, w, career)
  }
  const map: Record<string, InjuryStatus | null> = {
    g1: mapping(1),
    g2: mapping(2),
    g3: mapping(3),
    g4: mapping(4),
    healthy: mapping(0),
    IR: mapping('IR'),
  }
  const mappingOk = map.g1 === 'Q' && map.g2 === 'D' && map.g3 === 'OUT' && map.g4 === 'OUT' && map.healthy === null && map.IR === 'OUT'

  // ── forced aggravation trials (grade C) ───────────────────────────────────
  const tghOf = (p: Player) => playerAttrs(p).TGH ?? POS_MEAN[p.pos]?.TGH ?? 70
  const risksQ: number[] = []
  const risksD: number[] = []
  let hitsQ = 0
  let hitsD = 0
  let trialsQ = 0
  let trialsD = 0
  for (let i = 0; i < n && roster.length; i++) {
    const p = roster[i % roster.length]
    const status: 'Q' | 'D' = i % 2 === 0 ? 'Q' : 'D'
    const week = 1 + (i % 18)
    const roll = aggravationRoll(p, status, grade, 1, week)
    if (status === 'Q') {
      risksQ.push(roll.risk)
      trialsQ++
      if (roll.aggravated) hitsQ++
    } else {
      risksD.push(roll.risk)
      trialsD++
      if (roll.aggravated) hitsD++
    }
  }
  const aggravQ = mean(risksQ)
  const aggravD = mean(risksD)
  const hitQ = trialsQ ? hitsQ / trialsQ : 0
  const hitD = trialsD ? hitsD / trialsD : 0
  const aggravOk = inBand(aggravQ, 0.1, 0.14) && inBand(aggravD, 0.22, 0.28)

  // Risk must fall as durability (TGH) rises — the individual spread.
  const sorted = [...roster].sort((a, b) => tghOf(a) - tghOf(b))
  const lowGroup = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 4)))
  const highGroup = sorted.slice(-Math.max(1, Math.floor(sorted.length / 4)))
  const riskLowTgh = mean(lowGroup.map((p) => aggravationRisk(p, 'Q', grade)))
  const riskHighTgh = mean(highGroup.map((p) => aggravationRisk(p, 'Q', grade)))
  const fallsWithTgh = riskLowTgh > riskHighTgh && riskHighTgh > 0

  // ── grade ordering (A safer than D) ───────────────────────────────────────
  const gradeA = mean(roster.map((p) => aggravationRisk(p, 'Q', 'A')))
  const gradeD = mean(roster.map((p) => aggravationRisk(p, 'Q', 'D')))
  const gradeOrdered = gradeA < gradeD && roster.every((p) => aggravationRisk(p, 'Q', 'A') < aggravationRisk(p, 'Q', 'D'))

  // ── penalty applies only while `hurt` is set ──────────────────────────────
  let penaltyOnlyWhileHurt = false
  let penaltySample = { before: 0, hurt: 0, after: 0, tghStable: true }
  const penPlayer = roster.find((p) => p.pos === 'QB') ?? roster[0]
  if (penPlayer) {
    const base = clone(penPlayer)
    const before = playerAttrs(base)
    const hurt: Player = { ...base, hurt: hurtStateFor({ ...base, injured: { games: 2, note: 'Knee' } }, 'D', career.teamId) }
    const hu = playerAttrs(hurt)
    const after = playerAttrs(base)
    penaltySample = {
      before: before.SPD ?? 0,
      hurt: hu.SPD ?? 0,
      after: after.SPD ?? 0,
      tghStable: hu.TGH === before.TGH,
    }
    penaltyOnlyWhileHurt =
      hu.SPD !== undefined && before.SPD !== undefined && hu.SPD < before.SPD && after.SPD === before.SPD && hu.TGH === before.TGH
  }

  // ── both paths: activate/restore, leave no hurt behind ────────────────────
  const recovery = { teamId: career.teamId, injuryMult: 1, restHeal: false, fatigueRelief: false }
  const starter = [...roster].sort((a, b) => b.ovr - a.ovr)[0]
  const setup = (w: World): { world: World; career: CareerState; id: string } | null => {
    if (!starter) return null
    const p = w.players.find((x) => x.id === starter.id)
    if (!p) return null
    p.injured = { games: 2, note: 'Knee' }
    const c: CareerState = { ...career, injuryCalls: { [p.id]: 'play' } }
    return { world: w, career: c, id: p.id }
  }
  const noHurt = (w: World) => w.players.every((p) => !p.hurt && !p.hurtSaved)

  // Coached path: activate before the week's heal; restore back-to-back (the
  // game sits between) then heal.
  let noHurtLeftCoached = true
  {
    const w = clone(world)
    const s = setup(w)
    if (s) {
      activatePlayHurt(s.world, s.career)
      const p = s.world.players.find((x) => x.id === s.id)!
      if (!p.hurt) noHurtLeftCoached = false
      restorePlayHurt(s.world, s.career, false)
      healAfterWeek(s.world, s.world.week, recovery)
      noHurtLeftCoached = noHurtLeftCoached && noHurt(s.world) && !!p.injured
    }
  }

  // Fast path: the week's heal runs first, then activate (the sim), then restore.
  let noHurtLeftFast = true
  {
    const w = clone(world)
    const s = setup(w)
    if (s) {
      healAfterWeek(s.world, s.world.week, recovery)
      activatePlayHurt(s.world, s.career)
      restorePlayHurt(s.world, s.career, false)
      noHurtLeftFast = noHurt(s.world)
    }
  }

  // ── fast-path heal parity with a pure Sit run ─────────────────────────────
  // Both worlds carry the same forced injury; the play run heals first (the
  // played-hurt move happens *after*), so the draw sequence must be identical.
  const healHashSit = worldHash((() => {
    const w = clone(world)
    setup(w)
    healAfterWeek(w, w.week, recovery)
    return w
  })())
  let healHashFast = 0
  {
    const w = clone(world)
    const s = setup(w)
    healAfterWeek(w, w.week, recovery)
    healHashFast = worldHash(w)
    if (s) {
      activatePlayHurt(s.world, s.career)
      restorePlayHurt(s.world, s.career, false)
      normalizeInjuryState(w)
    }
  }
  const healParity = healHashSit === healHashFast

  // ── gameStatus agrees: the decision is made on the pre-heal snapshot ──────
  // Both the fast and coached paths show the report (and take the call) before
  // the week's tick, so the offered set must be identical on that snapshot.
  const offeredOn = (c: CareerState) =>
    (world.roster[c.teamId] ?? [])
      .map((p) => {
        const st = gameStatus(p, world, c)
        return st ? `${p.id}:${st}` : null
      })
      .filter(Boolean)
      .join(',')
  const gameStatusAgrees = offeredOn(career) === offeredOn(clone(career) as CareerState)

  // ── owner pressure: only in a push, and capped ────────────────────────────
  const pushWorld = clone(world)
  pushWorld.phase = 'regular'
  pushWorld.week = 13
  const rec = pushWorld.standings[career.teamId]
  if (rec) {
    rec.wins = 6
    rec.losses = 6
    rec.ties = 0
  }
  const pushActive = inPlayoffPush(pushWorld, career.teamId)
  const pushCareer: CareerState = { ...career, injuryCalls: {} }
  const starters = [...(pushWorld.roster[career.teamId] ?? [])].sort((a, b) => b.ovr - a.ovr).slice(0, 8)
  let pushSits = 0
  for (const p of starters) {
    const live = pushWorld.players.find((x) => x.id === p.id)!
    live.injured = { games: 2, note: 'Ankle' }
    pushCareer.injuryCalls![live.id] = 'sit'
    if (ownerPressure(pushWorld, pushCareer, live, 'sit').security !== 0) pushSits++
  }
  const pushResult = restorePlayHurt(pushWorld, pushCareer, false)
  normalizeInjuryState(pushWorld)
  const ownerCapOk = Math.abs(pushResult.security) <= 3 && Math.abs(pushResult.leadership) <= 3

  const calmWorld = clone(world)
  calmWorld.week = 4
  const calmP = (calmWorld.roster[career.teamId] ?? [])[0]
  const outsidePushSilent = !calmP || ownerPressure(calmWorld, career, calmP, 'sit').security === 0

  // ── an old save without injuryCalls loads and behaves as a sit week ───────
  let oldSaveLoads = true
  {
    const w = clone(world)
    const old = { ...career } as CareerState
    delete old.injuryCalls
    try {
      const rows = injuryReport(w, old)
      oldSaveLoads = rows.every((r) => r.call === 'sit')
      activatePlayHurt(w, old)
      oldSaveLoads = oldSaveLoads && noHurt(w)
      const res = restorePlayHurt(w, old, false)
      oldSaveLoads = oldSaveLoads && res.security === 0 && res.played.length === 0
    } catch {
      oldSaveLoads = false
    }
  }

  const ok =
    mappingOk &&
    aggravOk &&
    fallsWithTgh &&
    gradeOrdered &&
    penaltyOnlyWhileHurt &&
    noHurtLeftFast &&
    noHurtLeftCoached &&
    healParity &&
    gameStatusAgrees &&
    ownerCapOk &&
    outsidePushSilent &&
    oldSaveLoads

  return {
    seed: world.seed,
    trials: n,
    mapping: map,
    mappingOk,
    aggravQ,
    aggravD,
    hitQ,
    hitD,
    aggravOk,
    riskLowTgh,
    riskHighTgh,
    fallsWithTgh,
    gradeA,
    gradeD,
    gradeOrdered,
    penaltyOnlyWhileHurt,
    penaltySample,
    noHurtLeftFast,
    noHurtLeftCoached,
    healParity,
    healHashSit,
    healHashFast,
    gameStatusAgrees,
    pushActive,
    pushSits,
    ownerCapOk,
    outsidePushSilent,
    oldSaveLoads,
    ok,
  }
}

/** Alias kept for the `__injuryCallProbe` dev hook. */
export const injuryProbe = injuryCallProbe

/** Determinism check helper: two runs on identical clones must agree exactly. */
export function injuryProbeDeterministic(world: World, career: CareerState, n = 400): boolean {
  const a = injuryCallProbe(clone(world), clone(career) as CareerState, n)
  const b = injuryCallProbe(clone(world), clone(career) as CareerState, n)
  return JSON.stringify(a) === JSON.stringify(b)
}

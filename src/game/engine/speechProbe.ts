// ─────────────────────────────────────────────────────────────────────────────
// Halftime-speech probe (FUTURES #7, H1).
//
// Pure and offline-runnable (no React, no DOM, no store): the node harness boots
// a real career and calls `speechProbe(world, opts)`. It proves the H1 acceptance
// on the live engine, before the store (H2) or UI (H3) exist:
//   • land / flat / backfire rates track the design (60/40/25 and 10/20/35) for
//     good / neutral / bad fit, on a neutralised room so only the fit moves them;
//   • the per-player effects separate an elite man from a poor one a lot;
//   • a landed fire-up shifts the user's second-half point differential +0.5 to
//     +2.5; a backfired one −0.5 to −2.0;
//   • stay-the-course (and a forced flat speech) is byte-identical to no speech
//     at all, so no rng() draw is added;
//   • the repetition penalty is −10% per same speech (capped);
//   • coordinators never see the card.
// ─────────────────────────────────────────────────────────────────────────────

import type { World } from './generate'
import type { Player } from '../types'
import { createGame, runToMoment, answerMoment, finishGame, type GameCtx } from './playsim'
import { aiCallSheet } from './decisions'
import {
  SPEECH,
  coreOf,
  playerResponse,
  receptivity,
  speechLandChance,
  speechOutcome,
  secondHalfDiff,
  type SpeechFit,
  type SpeechId,
  type SpeechResult,
  type SpeechSituation,
} from './halftimeSpeech'

export interface SpeechRateCell {
  id: SpeechId
  fit: SpeechFit
  n: number
  landed: number
  flat: number
  backfired: number
  landRate: number
  backRate: number
  targetLand: number
  targetBack: number
  /** The cell really did classify to its intended fit. */
  fitOk: boolean
  ok: boolean
}

export interface SpeechProbeReport {
  seed: number
  team: string
  rates: SpeechRateCell[]
  ratesOk: boolean
  spread: {
    receptivityMin: number
    receptivityMax: number
    receptivitySpread: number
    eliteEdge: number
    poorEdge: number
    edgeSpread: number
    landGoodLead: number
    landNoLead: number
    landWithCaptains: number
    landWithProblems: number
    spreadOk: boolean
  }
  pd: {
    games: number
    flat2h: number
    landed2h: number
    backfired2h: number
    landedShift: number
    backfiredShift: number
    pdOk: boolean
  }
  /** A forced flat speech (and stay-the-course) reproduces a no-speech game. */
  flatNeutral: boolean
  /** The speech edge only touches the second half (first half byte-identical). */
  preHalftimeIdentical: boolean
  /** Coordinators (scope off/def/both) never see the speech card. */
  coordinatorSilent: boolean
  repetition: { base: number; afterOne: number; afterThree: number; ok: boolean }
  ok: boolean
}

const clone = <T,>(v: T): T => structuredClone(v)

const NEUTRAL_CHARACTER = { workEthic: 60, coachability: 60, maturity: 60, offFieldRisk: 40 }

/** Rate-test situations built to classify to a chosen fit. */
function sitFor(id: SpeechId, fit: SpeechFit): SpeechSituation {
  const base: SpeechSituation = { margin: 0, turnovers: 0, penalties: 0, hotCount: 0, coreCount: SPEECH.core }
  if (id === 'fireUp') return { ...base, margin: fit === 'good' ? 0 : fit === 'neutral' ? 5 : 17 }
  if (id === 'calmDown') {
    if (fit === 'good') return { ...base, turnovers: 2 }
    if (fit === 'bad') return { ...base, margin: -12 }
    return base
  }
  return base
}

function pk(world: World, id: string): Player | undefined {
  return world.players.find((p) => p.id === id)
}

export function speechProbe(world: World, opts: { n?: number; games?: number; seeds?: number[]; teamId?: string } = {}): SpeechProbeReport {
  const n = opts.n ?? 500
  const G = opts.games ?? 100
  const teamId = opts.teamId ?? world.teams.find((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)?.id ?? world.teams[0].id

  // ── land / flat / backfire rates by fit (neutralised room) ─────────────────
  const w = clone(world)
  for (const p of w.roster[teamId] ?? []) {
    p.morale = 70
    p.character = { ...NEUTRAL_CHARACTER }
  }
  const starId = coreOf(w, teamId)[0]?.id
  const baseStar = starId ? pk(w, starId) : undefined
  const setStar = (fit: SpeechFit) => {
    const p = starId ? pk(w, starId) : undefined
    if (!p || !baseStar) return
    Object.assign(p, { age: baseStar.age, ovr: baseStar.ovr, morale: 70 })
    p.character = { ...NEUTRAL_CHARACTER }
    if (fit === 'good') {
      Object.assign(p, { age: 33, ovr: 92, morale: 85 })
      p.character = { workEthic: 70, coachability: 75, maturity: 75, offFieldRisk: 25 }
    } else if (fit === 'neutral') {
      Object.assign(p, { age: 25, ovr: 68, morale: 70 })
    } else if (fit === 'bad') {
      p.morale = 40
      p.character = { workEthic: 30, coachability: 30, maturity: 30, offFieldRisk: 95 }
    }
  }

  const rates: SpeechRateCell[] = []
  for (const id of ['fireUp', 'calmDown', 'challenge'] as SpeechId[]) {
    for (const fit of ['good', 'neutral', 'bad'] as SpeechFit[]) {
      if (id === 'challenge') setStar(fit)
      const sit = sitFor(id, fit)
      let landed = 0
      let flat = 0
      let backfired = 0
      let fitOk = true
      for (let i = 0; i < n; i++) {
        const out = speechOutcome(w, teamId, id, {}, `${world.seed}:rate:${id}:${fit}:${i}`, { sit, starId })
        if (out.fit !== fit) fitOk = false
        if (out.result === 'landed') landed++
        else if (out.result === 'backfired') backfired++
        else flat++
      }
      const landRate = landed / n
      const backRate = backfired / n
      rates.push({
        id, fit, n, landed, flat, backfired, landRate, backRate,
        targetLand: SPEECH.land[fit], targetBack: SPEECH.back[fit], fitOk,
        ok: fitOk && Math.abs(landRate - SPEECH.land[fit]) <= 0.05 && Math.abs(backRate - SPEECH.back[fit]) <= 0.05,
      })
    }
  }
  const ratesOk = rates.every((c) => c.ok)

  // ── individual spread: elite vs poor ───────────────────────────────────────
  const core = coreOf(world, teamId)
  const reco = core.map((p) => receptivity(p))
  const elite = clone(world)
  for (const p of elite.roster[teamId] ?? []) {
    p.morale = 90
    p.age = 30
    p.character = { workEthic: 92, coachability: 92, maturity: 88, offFieldRisk: 10 }
  }
  const poor = clone(world)
  for (const p of poor.roster[teamId] ?? []) {
    p.morale = 28
    p.age = 22
    p.character = { workEthic: 25, coachability: 25, maturity: 25, offFieldRisk: 88 }
  }
  const edgeOf = (wd: World) => coreOf(wd, teamId).reduce((a, p) => a + playerResponse(p, 'landed', 'fireUp', false), 0)
  const eliteEdge = edgeOf(elite)
  const poorEdge = edgeOf(poor)

  const clean = clone(world)
  for (const p of clean.roster[teamId] ?? []) {
    p.morale = 70
    p.character = { ...NEUTRAL_CHARACTER }
  }
  const landNoLead = speechLandChance(clean, teamId, 'fireUp', {}, 'good')
  const landGoodLead = speechLandChance(clean, teamId, 'fireUp', { leadership: 99 }, 'good')
  const topLeaders = [...(world.roster[teamId] ?? [])].sort((a, b) => b.ovr - a.ovr).slice(0, 3).map((p) => p.id)
  const landWithCaptains = speechLandChance(world, teamId, 'fireUp', { captainIds: topLeaders }, 'good')
  const withProblems = clone(world)
  for (const p of coreOf(withProblems, teamId).slice(0, 3)) {
    p.morale = 30
    p.character = { workEthic: 25, coachability: 25, maturity: 25, offFieldRisk: 95 }
  }
  const landWithProblems = speechLandChance(withProblems, teamId, 'fireUp', {}, 'good')
  const receptivitySpread = Math.max(...reco) - Math.min(...reco)
  const spreadOk = receptivitySpread > 0.5 && eliteEdge - poorEdge > 0.3 && landGoodLead > landNoLead && landWithCaptains > landNoLead && landWithProblems < landNoLead

  // ── second-half point differential (paired games) ──────────────────────────
  const nfl = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
  const gameSeeds = opts.seeds ?? [world.seed]
  let flatSum = 0
  let landSum = 0
  let backSum = 0
  let games = 0
  let flatNeutral = true
  let preHalftimeIdentical = true
  const runSpeech = (home: string, away: string, seed: number, force: SpeechResult) => {
    const ctx: GameCtx = { userTeamId: home, scope: 'hc', callSheet: aiCallSheet(world, home), speech: { force } }
    const s = createGame(world, home, away, seed, ctx)
    for (let m = runToMoment(world, s); m; m = runToMoment(world, s)) answerMoment(s, m.kind === 'speech' ? 'fireUp' : m.defaultId, 'standing')
    return finishGame(s)
  }
  const runStay = (home: string, away: string, seed: number) => {
    const ctx: GameCtx = { userTeamId: home, scope: 'hc', callSheet: aiCallSheet(world, home) }
    const s = createGame(world, home, away, seed, ctx)
    for (let m = runToMoment(world, s); m; m = runToMoment(world, s)) answerMoment(s, m.defaultId, 'standing')
    return finishGame(s)
  }
  for (const gs of gameSeeds) {
    for (let g = 0; g < G; g++) {
      const home = nfl[g % nfl.length]
      const away = nfl[(g + 1) % nfl.length]
      if (!home || !away || home.id === away.id) continue
      const seed = gs * 131 + g * 7 + 1
      const f = runSpeech(home.id, away.id, seed, 'flat')
      const l = runSpeech(home.id, away.id, seed, 'landed')
      const b = runSpeech(home.id, away.id, seed, 'backfired')
      flatSum += secondHalfDiff(f.plays, home.id, home.id)
      landSum += secondHalfDiff(l.plays, home.id, home.id)
      backSum += secondHalfDiff(b.plays, home.id, home.id)
      games++
      if (g === 0) {
        const stay = runStay(home.id, away.id, seed)
        flatNeutral = JSON.stringify(stay.plays) === JSON.stringify(f.plays) && stay.homeScore === f.homeScore && stay.awayScore === f.awayScore
        const pre = (sim: typeof l) => JSON.stringify(sim.plays.filter((p) => p.qtr <= 2))
        preHalftimeIdentical = pre(l) === pre(f)
      }
    }
  }
  const flat2h = games ? flatSum / games : 0
  const landed2h = games ? landSum / games : 0
  const backfired2h = games ? backSum / games : 0
  const landedShift = landed2h - flat2h
  const backfiredShift = backfired2h - flat2h
  const pd = { games, flat2h, landed2h, backfired2h, landedShift, backfiredShift, pdOk: landedShift >= 0.5 && landedShift <= 2.5 && backfiredShift >= -2.0 && backfiredShift <= -0.5 }

  // ── coordinators never see the card ────────────────────────────────────────
  let coordinatorSilent = true
  {
    const home = nfl[0]
    const away = nfl[1]
    if (home && away && home.id !== away.id) {
      const ctx: GameCtx = { userTeamId: home.id, scope: 'off', callSheet: aiCallSheet(world, home.id) }
      const s = createGame(world, home.id, away.id, world.seed * 977 + 5, ctx)
      for (let m = runToMoment(world, s); m; m = runToMoment(world, s)) {
        if (m.kind === 'speech') coordinatorSilent = false
        answerMoment(s, m.defaultId, 'standing')
      }
    }
  }

  // ── repetition penalty ─────────────────────────────────────────────────────
  const repBase = speechLandChance(clean, teamId, 'fireUp', {}, 'good')
  const repOne = speechLandChance(clean, teamId, 'fireUp', { recent: ['fireUp'] }, 'good')
  const repThree = speechLandChance(clean, teamId, 'fireUp', { recent: ['fireUp', 'fireUp', 'fireUp'] }, 'good')
  const repetition = {
    base: repBase,
    afterOne: repOne,
    afterThree: repThree,
    ok: Math.abs(repBase - repOne - 0.1) < 1e-9 && Math.abs(repBase - repThree - 0.3) < 1e-9 && repThree < repOne,
  }

  const ok = ratesOk && spreadOk && pd.pdOk && flatNeutral && preHalftimeIdentical && coordinatorSilent && repetition.ok
  return {
    seed: world.seed,
    team: teamId,
    rates,
    ratesOk,
    spread: {
      receptivityMin: Math.min(...reco),
      receptivityMax: Math.max(...reco),
      receptivitySpread,
      eliteEdge,
      poorEdge,
      edgeSpread: eliteEdge - poorEdge,
      landGoodLead,
      landNoLead,
      landWithCaptains,
      landWithProblems,
      spreadOk,
    },
    pd,
    flatNeutral,
    preHalftimeIdentical,
    coordinatorSilent,
    repetition,
    ok,
  }
}

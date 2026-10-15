// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #26 P1 probe — coach playcalling (who calls, the sheet, the audibles).
//
// Pure and offline-runnable (no React, no DOM, no store): the node harness boots
// a real career and calls `playcallingProbe(world)` per seed. It drives the
// engine directly with a hand-built `GameCtx` (the store wiring is P2), so the
// P1 acceptance can be verified before it is hooked up:
//   (a) 'sheet' with empty callers ≡ 'key'   — play-by-play hash over 200 games,
//   (b) callers ask only in 'me' situations plus key moments,
//   (c) staff snaps in a sheeted bucket use only sheet plays, and the rng draw
//       count is unchanged at the selection point,
//   (d) 'qb' check rate 10–30% of user calls, matrix win rate rises ≤ 8 pts,
//   (e) 'ask' pause/answer has no drift (stop granularity + replay),
//   (f) user-team ceiling (full sheet + 'qb'): +≤2.0 pts/game, +≤0.4 ypp,
//   (g) an old save without `playCalling` normalises and round-trips,
// plus the ELITE-vs-POOR spread of each individual effect (the look the QB sees
// and the check he makes).
// ─────────────────────────────────────────────────────────────────────────────

import type { Player } from '../types'
import type { World } from './generate'
import {
  createGame,
  runUntil,
  answerMoment,
  setJ13,
  setLivePlan,
  PC_DEV,
  j13QbRead,
  type GameCtx,
  type GameState,
  type Moment,
} from './playsim'
import { DEFAULT_CALL_SHEET, BUCKETS, bucketFor, defCallForPlan, type Bucket, type DefCall } from './decisions'
import { BALANCED_PLAN } from './gameplan'
import { PLAYBOOK, formationHasFullback } from '../data/playbookData'
import {
  emptyPlayCalling,
  lookFor,
  normalizePlayCalling,
  qbCheck,
  sheetFor,
  sheetPick,
  type PlayCallingPlan,
} from './playcalling'
import { hash32 } from './rng'

/** A representative 4-play sheet for a bucket: a run, two shorts, a deep shot.
 *  No fullback formations, so the sheet can never fall back for a club without one. */
function off4(b: Bucket): string[] {
  const bi = BUCKETS.indexOf(b)
  const noFb = (p: { formation: string }) => !formationHasFullback(p.formation)
  const runs = PLAYBOOK.filter((p) => p.type === 'run' && noFb(p))
  const shorts = PLAYBOOK.filter((p) => p.type === 'pass' && p.depth <= 8 && noFb(p))
  const deeps = PLAYBOOK.filter((p) => p.type === 'pass' && p.depth >= 12 && noFb(p))
  const pick = <T,>(list: T[], off: number) => list.length ? list[(bi + off) % list.length] : undefined
  return [
    pick(runs, 0)?.name,
    pick(shorts, 0)?.name,
    pick(shorts, 3)?.name,
    pick(deeps, 1)?.name,
  ].filter((x): x is string => !!x)
}

const DEF3: DefCall[] = ['zone', 'blitz', 'man']

export function fullSheet(): PlayCallingPlan {
  const plan = emptyPlayCalling()
  for (const b of BUCKETS) {
    plan.sheet.off[b] = off4(b)
    plan.sheet.def[b] = [...DEF3]
  }
  return plan
}

// ── Driving a game ────────────────────────────────────────────────────────────

type Stop = 'play' | 'moment'

function answerFor(m: Moment, plan: PlayCallingPlan | undefined): { id: string; source: 'user' | 'standing' } {
  const b = bucketFor(m.down ?? 1, m.distance ?? 10, m.yard)
  if (m.kind === 'call') {
    const pick = sheetPick(sheetFor(plan, 'off', b) as string[], m.id) ?? m.defaultId
    return { id: m.options.some((o) => o.id === pick) ? pick : m.defaultId, source: 'user' }
  }
  if (m.kind === 'defCall') {
    const pick = sheetPick(sheetFor(plan, 'def', b) as DefCall[], m.id) ?? m.defaultId
    return { id: m.options.some((o) => o.id === pick) ? pick : m.defaultId, source: 'user' }
  }
  if (m.kind === 'audible') {
    const check = m.options.find((o) => o.id.startsWith('check:'))
    return { id: check ? check.id : 'keep', source: 'user' }
  }
  return { id: m.defaultId, source: 'standing' }
}

function drive(
  world: World,
  homeId: string,
  awayId: string,
  seed: number,
  ctx: GameCtx | undefined,
  plan: PlayCallingPlan | undefined,
  stop: Stop,
): GameState {
  const s = createGame(world, homeId, awayId, seed, ctx)
  for (;;) {
    const m = runUntil(world, s, stop)
    if (m) {
      const a = answerFor(m, plan)
      answerMoment(s, a.id, a.source)
      continue
    }
    if (s.done) break
    // A 'play'/'drive' stop with no moment: advance again.
  }
  return s
}

const playHash = (s: GameState) => `${s.homeScore}-${s.awayScore}-${hash32(JSON.stringify(s.plays), s.n)}`

const q = (a: number[], f: number) => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * f)))]
}

/** The user team's offensive line: points, scrimmage plays and yards. */
function userOff(s: GameState, teamId: string) {
  let yards = 0
  let plays = 0
  for (const p of s.plays) {
    if (p.offId !== teamId || (p.type !== 'run' && p.type !== 'pass') || p.kneel || p.spike) continue
    plays += 1
    yards += p.yards ?? 0
  }
  return { points: teamId === s.homeId ? s.homeScore : s.awayScore, yards, plays }
}

export interface PlayCallingProbeOptions {
  games?: number
  ceilingGames?: number
  lookN?: number
}

export function playcallingProbe(world: World, opts: PlayCallingProbeOptions = {}) {
  // The probe drives the engine directly: no live user plan, so `planFor` reads
  // BALANCED_PLAN exactly as a fast sim with no game plan would.
  setLivePlan(null)
  const games = opts.games ?? 200
  const ceilingGames = opts.ceilingGames ?? 500
  const lookN = opts.lookN ?? 20000
  const nfl = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
  if (nfl.length < 4) return { error: 'no NFL teams' }
  const userTeam = nfl[0].id
  const opps = nfl.filter((t) => t.id !== userTeam)
  const base: GameCtx = { userTeamId: userTeam, scope: 'hc', callSheet: DEFAULT_CALL_SHEET }
  const plan = fullSheet()

  const rg = (i: number) => world.seed + i * 7919 + 101
  const oppOf = (i: number) => opps[i % opps.length].id

  // ── (a) 'sheet' with empty callers ≡ 'key' ─────────────────────────────────
  let aSame = 0
  const aTotal = Math.min(games, 200)
  {
    const empty = emptyPlayCalling()
    for (let i = 0; i < aTotal; i++) {
      const opp = oppOf(i)
      const a = drive(world, userTeam, opp, rg(i), base, undefined, 'moment')
      const b = drive(world, userTeam, opp, rg(i), { ...base, calling: empty }, empty, 'moment')
      if (playHash(a) === playHash(b)) aSame += 1
    }
  }

  // ── (c) staff snaps use only the sheet's plays (J13 off so the sheet wins) ──
  const sheetOff: PlayCallingPlan = { ...fullSheet(), callers: { off: {}, def: {} } }
  const askPlan: PlayCallingPlan = { ...fullSheet(), audibles: 'qb' }
  const cViolations: { concept: string; bucket: Bucket; sheet: string[]; n: number }[] = []
  const cInSheet: Record<string, number> = {}
  let cSnaps = 0
  setJ13(false)
  PC_DEV.on = true
  PC_DEV.sheetOff = 0; PC_DEV.sheetMiss = 0; PC_DEV.sheetDraws = 0; PC_DEV.selDraws = 0; PC_DEV.selSnaps = 0
  for (let i = 0; i < 60; i++) {
    const s = drive(world, userTeam, oppOf(i), rg(i), { ...base, calling: sheetOff }, sheetOff, 'moment')
    for (const p of s.plays) {
      if (p.offId !== userTeam || (p.type !== 'run' && p.type !== 'pass') || p.kneel || p.spike) continue
      cSnaps += 1
      const bk = bucketFor(p.down ?? 1, p.distance ?? 10, p.startYard)
      const sheet = (sheetOff.sheet.off[bk] ?? []) as string[]
      if (!sheet.includes(p.concept)) {
        // The sheet's pick can fall back when its formation needs an FB the club
        // has not got; the standing concept then stands (no violation, by design).
        cViolations.push({ concept: p.concept, bucket: bk, sheet, n: p.n })
      } else cInSheet[p.concept] = (cInSheet[p.concept] ?? 0) + 1
    }
  }
  const cSheetDraws = PC_DEV.sheetDraws
  const cSheetOff = PC_DEV.sheetOff
  const cSheetMiss = PC_DEV.sheetMiss
  const cSelWith = PC_DEV.selDraws
  const cSelSnapsWith = PC_DEV.selSnaps
  PC_DEV.on = false
  setJ13(true)
  // The engine-side measurement of design 3: every override is a hash pick, so the
  // counter of draws consumed inside the override block must stay 0 (J13 off makes
  // the sheet the visible caller).
  const cSheetStats = {
    sheetSnaps: cSheetOff,
    blockedNoFullback: cSheetMiss,
    pickDrawsAdded: cSheetDraws,
    pickDrawsAddedOk: cSheetDraws === 0,
    selection: { snaps: cSelSnapsWith, draws: cSelWith },
  }

  // ── (b) a plan that asks only on 1st down ──────────────────────────────────
  const meFirst: PlayCallingPlan = { ...emptyPlayCalling(), callers: { off: { '1st': 'me' }, def: {} } }
  const oneAsks: Record<string, number> = {}
  let bAsked = 0
  let bOffMe = 0
  let bKey = 0
  let bViolations = 0
  for (let i = 0; i < 60; i++) {
    const s = drive(world, userTeam, oppOf(i), rg(i), { ...base, calling: meFirst }, meFirst, 'moment')
    for (const d of s.decisions) {
      if (d.kind !== 'call') continue
      const bk = bucketFor(d.down ?? 1, d.distance ?? 10, d.yard)
      oneAsks[bk] = (oneAsks[bk] ?? 0) + 1
      bAsked += 1
      const keyMoment =
        (d.down === 3 && (d.distance ?? 99) <= 3) ||
        (d.yard >= 80 && (d.down ?? 0) >= 3) ||
        (d.qtr === 4 && d.margin >= -8 && d.margin <= 0) // clock gate is not in the log; q4 counts as maybe
      if (bk === '1st') bOffMe += 1
      else if (keyMoment) bKey += 1
      else bViolations += 1
    }
  }

  // ── (d) 'qb' check rate + matrix win rate ──────────────────────────────────
  let userCalls = 0
  let checks = 0
  let wonQb = 0
  const qbReads: number[] = []
  for (let i = 0; i < 120; i++) {
    const s = drive(world, userTeam, oppOf(i), rg(i), { ...base, calling: askPlan, callAll: 'off' }, askPlan, 'moment')
    for (const d of s.decisions) {
      if (d.kind !== 'call' || !d.outcome) continue
      userCalls += 1
      if (d.audible) checks += 1
      if (d.outcome === 'won') wonQb += 1
    }
  }
  const offPlan: PlayCallingPlan = { ...fullSheet(), audibles: 'off' }
  let wonOff = 0
  let offCalls = 0
  for (let i = 0; i < 120; i++) {
    const s = drive(world, userTeam, oppOf(i), rg(i), { ...base, calling: offPlan, callAll: 'off' }, offPlan, 'moment')
    for (const d of s.decisions) {
      if (d.kind !== 'call' || !d.outcome) continue
      offCalls += 1
      if (d.outcome === 'won') wonOff += 1
    }
  }
  const checkRate = userCalls ? checks / userCalls : 0
  const winQb = userCalls ? wonQb / userCalls : 0
  const winOff = offCalls ? wonOff / offCalls : 0
  const dResult = {
    userCalls,
    offCalls,
    checks,
    checkRate: +checkRate.toFixed(4),
    checkRateInBand: checkRate >= 0.1 && checkRate <= 0.3,
    winQb: +winQb.toFixed(4),
    winOff: +winOff.toFixed(4),
    winRisePts: +((winQb - winOff) * 100).toFixed(2),
    winRiseOk: (winQb - winOff) * 100 <= 8,
  }

  // ── (c2) neutrality: the calling hook and the sheet override draw nothing ──
  // The whole-game proof is the calibration SIM identity (step 1/3 of the brief);
  // these pin the two mechanisms in isolation, with every moment answered on the
  // standing order so the two runs are otherwise the same game:
  //   (i)   `calling` with an empty plan reproduces the base game byte for byte
  //         AND consumes the same number of rng draws — the hook costs nothing;
  //   (ii)  a defensive sheet that names exactly the plan's own standing call is a
  //         no-op — byte-identical game, identical draw total — so the override
  //         itself adds no draw;
  //   (iii) `sheetPick` is pure: 20k calls consume no draw and repeat.
  // A sheet that names DIFFERENT plays necessarily shifts the stream (a run and a
  // pass do not draw alike); that is the play change, not the sheet call, and the
  // informational row below shows it.
  const drawsOf = (ctx: GameCtx | undefined) => {
    PC_DEV.on = true
    PC_DEV.draws = 0
    PC_DEV.selDraws = 0
    PC_DEV.selSnaps = 0
    const s = createGame(world, userTeam, oppOf(0), rg(0), ctx)
    for (;;) {
      const m = runUntil(world, s, 'moment')
      if (m) { answerMoment(s, m.defaultId, 'standing'); continue }
      if (s.done) break
    }
    PC_DEV.on = false
    return { hash: playHash(s), draws: PC_DEV.draws, plays: s.plays.length, selDraws: PC_DEV.selDraws, selSnaps: PC_DEV.selSnaps }
  }
  const baseRun = drawsOf(base)
  const emptyRun = drawsOf({ ...base, calling: emptyPlayCalling() })
  const planDefCall = defCallForPlan(BALANCED_PLAN)
  const defSame: PlayCallingPlan = {
    ...emptyPlayCalling(),
    sheet: { off: {}, def: Object.fromEntries(BUCKETS.map((b) => [b, [planDefCall]])) as Partial<Record<Bucket, DefCall[]>> },
  }
  const defSameRun = drawsOf({ ...base, calling: defSame })
  const offSheetRun = drawsOf({ ...base, calling: sheetOff })
  PC_DEV.on = true
  PC_DEV.draws = 0
  const picks: (string | undefined)[] = []
  for (let i = 0; i < 20000; i++) picks.push(sheetPick(['A', 'B', 'C', 'D'], `k${i % 500}`))
  const pickDraws = PC_DEV.draws
  PC_DEV.on = false
  const cDraws = {
    n: 20000,
    baseDraws: baseRun.draws,
    basePlays: baseRun.plays,
    emptyCallingSameGame: baseRun.hash === emptyRun.hash,
    emptyCallingSameDraws: baseRun.draws === emptyRun.draws,
    defSheetSameCallSameGame: baseRun.hash === defSameRun.hash,
    defSheetSameCallSameDraws: baseRun.draws === defSameRun.draws,
    defSheetCall: planDefCall,
    sheetPickPure: pickDraws === 0,
    sheetPickRepeats: picks.slice(500).every((p, i) => p === picks[i]),
    offSheetInfo: { draws: offSheetRun.draws, plays: offSheetRun.plays, baseDraws: baseRun.draws },
    // Informational: the draws the engine's concept-selection block consumed per
    // snap. The sheet changes WHICH plays are run, so the mix of situations (and
    // hence this mean) shifts slightly; the evidence that the override itself adds
    // nothing is `c_sheetStaff.pickDrawsAdded` (0) and the two byte-identity rows
    // above, not this number.
    selPerSnap: {
      base: baseRun.selSnaps ? +(baseRun.selDraws / baseRun.selSnaps).toFixed(4) : 0,
      withOffSheet: offSheetRun.selSnaps ? +(offSheetRun.selDraws / offSheetRun.selSnaps).toFixed(4) : 0,
      snapsBase: baseRun.selSnaps,
      snapsWithOffSheet: offSheetRun.selSnaps,
    },
  }

  // ── (e) 'ask' pause/answer: no drift across stop granularity, replay equal ──
  const askAud: PlayCallingPlan = { ...fullSheet(), audibles: 'ask' }
  const byPlay = drive(world, userTeam, oppOf(1), rg(1), { ...base, calling: askAud, callAll: 'off' }, askAud, 'play')
  const byMoment = drive(world, userTeam, oppOf(1), rg(1), { ...base, calling: askAud, callAll: 'off' }, askAud, 'moment')
  const replay = drive(world, userTeam, oppOf(1), rg(1), { ...base, calling: askAud, callAll: 'off' }, askAud, 'moment')
  const eResult = {
    granularityEqual: playHash(byPlay) === playHash(byMoment),
    replayEqual: playHash(byMoment) === playHash(replay),
    audibleMoments: byMoment.decisions.filter((d) => d.kind === 'audible').length,
    checks: byMoment.decisions.filter((d) => !!d.audible).length,
    plays: byMoment.plays.length,
  }

  // ── (f) the user-team ceiling (full sheet + 'qb' audibles) ─────────────────
  let defPts = 0
  let defYds = 0
  let defPlays = 0
  let audPts = 0
  let audYds = 0
  let audPlays = 0
  for (let i = 0; i < ceilingGames; i++) {
    const opp = oppOf(i)
    const dd = userOff(drive(world, userTeam, opp, rg(i), base, undefined, 'moment'), userTeam)
    defPts += dd.points; defYds += dd.yards; defPlays += dd.plays
    const aa = userOff(drive(world, userTeam, opp, rg(i), { ...base, calling: askPlan, callAll: 'off' }, askPlan, 'moment'), userTeam)
    audPts += aa.points; audYds += aa.yards; audPlays += aa.plays
  }
  const defPpg = defPts / ceilingGames
  const audPpg = audPts / ceilingGames
  const defYpp = defPlays ? defYds / defPlays : 0
  const audYpp = audPlays ? audYds / audPlays : 0
  const fResult = {
    n: ceilingGames,
    defaultPpg: +defPpg.toFixed(3),
    sheetPpg: +audPpg.toFixed(3),
    ppgRise: +(audPpg - defPpg).toFixed(3),
    ppgOk: audPpg - defPpg <= 2.0,
    defaultYpp: +defYpp.toFixed(3),
    sheetYpp: +audYpp.toFixed(3),
    yppRise: +(audYpp - defYpp).toFixed(3),
    yppOk: audYpp - defYpp <= 0.4,
  }

  // ── (g) an old save without `playCalling` ──────────────────────────────────
  const emptyPlan = normalizePlayCalling({})
  const gResult = {
    undefinedStaysUndefined: normalizePlayCalling(undefined) === undefined,
    emptyNormalizes: !!emptyPlan && emptyPlan.audibles === 'off' && Object.keys(emptyPlan.callers.off).length === 0,
    roundTrip: JSON.stringify(normalizePlayCalling(JSON.parse(JSON.stringify(plan)))) === JSON.stringify(normalizePlayCalling(plan)),
    junkIsSafe: !!normalizePlayCalling({ callers: { off: { bogus: 'me' } }, sheet: { off: { '1st': ['Nope', 'Mesh', 'Mesh', 7] } }, audibles: 'wat', checks: { Mesh: 'NotAPlay' } }),
    junkSheet: normalizePlayCalling({ sheet: { off: { '1st': ['Nope', 'Mesh', 'Mesh', 7] } } })?.sheet.off['1st'],
    junkAudibles: normalizePlayCalling({ audibles: 'wat' })?.audibles,
  }

  // ── the ELITE-vs-POOR spread of each individual effect ────────────────────
  const lookShare = (awr: number, sharp: boolean) => {
    let t = 0
    for (let i = 0; i < lookN; i++) if (lookFor('zone', awr, sharp, `k${i}`).truthful) t += 1
    return +(t / lookN).toFixed(4)
  }
  // A deep call vs a zone look: a check to the short class is a real improvement.
  const checkAt = (readDev: number) => {
    let c = 0
    for (let i = 0; i < lookN; i++) if (qbCheck('zone', 'deep', 'short', readDev, `k${i}`)) c += 1
    return +(c / lookN).toFixed(4)
  }
  // One cell per club, so the QB-read spread is a real spread of individual QBs.
  const spreadRows: { team: string; read: number; calls: number; checks: number }[] = []
  for (let i = 0; i < Math.min(games, nfl.length); i++) {
    const team = nfl[(i + 1) % nfl.length].id
    const opp = opps.filter((t) => t.id !== team).map((t) => t.id)
    const ctx: GameCtx = { userTeamId: team, scope: 'hc', callSheet: DEFAULT_CALL_SHEET, calling: askPlan, callAll: 'off' }
    const s = drive(world, team, opp[i % opp.length], rg(i), ctx, askPlan, 'moment')
    const qb = world.roster[team]?.find((p: Player) => p.pos === 'QB')
    spreadRows.push({
      team,
      read: j13QbRead(qb),
      calls: s.decisions.filter((d) => d.kind === 'call' && d.outcome).length,
      checks: s.decisions.filter((d) => !!d.audible).length,
    })
  }
  qbReads.push(...spreadRows.map((r) => r.read))
  const rHi = q(qbReads.length ? qbReads : [0], 0.6)
  const rLo = q(qbReads.length ? qbReads : [0], 0.4)
  const agg = (a: typeof spreadRows) => ({
    cells: a.length,
    calls: a.reduce((t, r) => t + r.calls, 0),
    checks: a.reduce((t, r) => t + r.checks, 0),
    rate: (() => { const c = a.reduce((t, r) => t + r.calls, 0); return c ? +((a.reduce((t, r) => t + r.checks, 0)) / c).toFixed(4) : 0 })(),
  })
  const spread = {
    lookTruthful: { elite: lookShare(88, false), poor: lookShare(62, false), eliteSharp: lookShare(88, true), poorSharp: lookShare(62, true), n: lookN },
    checkRate: { elite: checkAt(8), poor: checkAt(-8), n: lookN },
    byQbInSim: { elite: agg(spreadRows.filter((r) => r.read >= rHi)), poor: agg(spreadRows.filter((r) => r.read <= rLo)), readLo: +rLo.toFixed(1), readHi: +rHi.toFixed(1) },
  }

  return {
    userTeam,
    games,
    a_sheetEmptyEqualsKey: { same: aSame, total: aTotal },
    b_callerSituations: { asked: bAsked, onMe: bOffMe, keyMoments: bKey, violations: bViolations, byBucket: oneAsks },
    c_sheetStaff: { snaps: cSnaps, inSheet: cInSheet, violations: cViolations.length, examples: cViolations.slice(0, 5), ...cSheetStats },
    c_draws: cDraws,
    d_audibleRate: dResult,
    e_noDrift: eResult,
    f_ceiling: fResult,
    g_oldSave: gResult,
    spread,
  }
}

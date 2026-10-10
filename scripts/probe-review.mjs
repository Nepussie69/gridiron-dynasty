// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #5 C1 probe — the officiating layer.
//
// Runs NFL games with reviews ON and re-derives every close call from the play
// log (the same pure hashes the engine uses), then reports:
//   · close plays by kind, split into the booth and challenge domains;
//   · booth stoppage reviews by kind (reversed / confirmed) and the reviews per
//     game, which must sit in the spec's ~1.0–1.6 band;
//   · determinism — the same game twice, and a game rebuilt from its answers;
//   · an old save (no `challenges` field) loading and playing on.
//
// Usage:
//   REPO="$PWD" node --import ~/gridiron-work/loader.mjs scripts/probe-review.mjs
//   REPO="$PWD" node --import ~/gridiron-work/loader.mjs scripts/probe-review.mjs 33333,2222,5150 700
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'

const repo = process.env.REPO ?? process.cwd()
const json = (name) => JSON.parse(readFileSync(`${repo}/public/data/${name}.json`, 'utf8'))

const data = await import(`${repo}/src/game/data/realData.ts`)
data.setRealData({ nfl: json('madden26').players, cfb: json('cfb26').teams, source: { madden: 'local', cfb: 'local' } })
const calibration = await import(`${repo}/src/game/data/calibration.ts`)
calibration.setCalibration(json('calibration'))

const store = await import(`${repo}/src/store/gameStore.ts`)
const { simulatePlayByPlay, createGame, runUntil, answerMoment, finishGame } = await import(`${repo}/src/game/engine/playsim.ts`)
const { closeCall, onFieldRuling, getReplayReview, setReplayReview } = await import(`${repo}/src/game/engine/review.ts`)

const seeds = (process.argv[2] ?? '33333,2222,5150').split(',').map(Number)
const gamesPer = Number(process.argv[3] ?? 700) // 700 × 3 seeds = 2100 games
const KINDS = ['spot', 'catch', 'fumble', 'goalLine']
const zeroByKind = () => Object.fromEntries(KINDS.map((k) => [k, 0]))
const closeState = (p) => ({ n: p.n, yard: p.startYard, distance: p.distance ?? 0, offId: p.offId })
const key = (g) => JSON.stringify({ h: g.homeScore, a: g.awayScore, p: g.plays.map(({ review: _review, ...rest }) => rest) })

const results = []
const problems = []
const check = (ok, msg) => { if (!ok) problems.push(msg) }

const totals = {
  games: 0, plays: 0,
  close: zeroByKind(), closeChallenge: zeroByKind(), challengeMisCall: zeroByKind(),
  boothReviews: zeroByKind(), boothReversed: zeroByKind(), boothConfirmed: zeroByKind(),
  reviewRecords: 0, reviewNotClose: 0, reviewOutcomeMismatch: 0, boothMismatch: 0, reviewsOffDiff: 0,
  determinism: { same: 0, sameTotal: 0, rebuild: 0, rebuildTotal: 0 },
}

for (const seed of seeds) {
  store.useGame.getState().startCareer({ name: 'Probe', path: 'coach', archetype: 'off', teamId: 'CLE', seed, startLevel: 7 })
  const world = store.getWorld()
  const career = store.useGame.getState().career
  const ctx = store.userCtx(career)
  const pool = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
  const n = pool.length
  const s = {
    games: 0, plays: 0,
    close: zeroByKind(), closeChallenge: zeroByKind(), challengeMisCall: zeroByKind(),
    boothReviews: zeroByKind(), boothReversed: zeroByKind(), boothConfirmed: zeroByKind(),
  }

  for (let g = 0; g < gamesPer; g++) {
    const h = pool[g % n]
    const a = pool[(g * 7 + 1) % n]
    if (!h || !a || h.id === a.id) continue
    const seedGame = world.seed + g * 7919 + 101
    const sim = simulatePlayByPlay(world, h.id, a.id, seedGame)
    s.games++
    s.plays += sim.plays.length

    for (const p of sim.plays) {
      if (p.review) {
        totals.reviewRecords++
        s.boothReviews[p.review.kind]++
        if (p.review.outcome === 'reversed') s.boothReversed[p.review.kind]++
        else s.boothConfirmed[p.review.kind]++
      }
      if (p.type !== 'run' && p.type !== 'pass') continue
      const st = closeState(p)
      const call = closeCall(st, p)
      if (!call) {
        if (p.review) totals.reviewNotClose++ // a review must always be a close play
        continue
      }
      s.close[call.kind]++
      const ruling = onFieldRuling(call.kind, st, p, call.wrong)
      if (p.review) {
        // the engine review is a booth review; the outcome must track the hash
        if ((p.review.outcome === 'reversed') !== call.wrong) totals.reviewOutcomeMismatch++
      } else {
        s.closeChallenge[call.kind]++
        if (call.wrong) s.challengeMisCall[call.kind]++
        // a close play whose ruling is a score/turnover is booth-only: it must
        // have been reviewed (the window can only be a clock-edge artifact)
        if (ruling.score || ruling.turnover) totals.boothMismatch++
      }
    }

    // determinism: the same game twice (AI vs AI)
    if (g < 40) {
      const again = simulatePlayByPlay(world, h.id, a.id, seedGame)
      totals.determinism.sameTotal++
      if (key(again) === key(sim)) totals.determinism.same++
      else problems.push(`seed ${seed} game ${g}: same-seed replay differs`)
    }
    // determinism: a coached game rebuilt from its answers equals the standing run
    if (ctx && g < 40) {
      const coached = simulatePlayByPlay(world, h.id, a.id, seedGame, ctx)
      const st2 = createGame(world, h.id, a.id, seedGame, ctx)
      let guard = 6000
      let m = runUntil(world, st2, 'moment')
      while (m && guard-- > 0) {
        answerMoment(st2, m.defaultId, 'standing')
        m = runUntil(world, st2, 'moment')
      }
      totals.determinism.rebuildTotal++
      if (key(finishGame(st2)) === key(coached)) totals.determinism.rebuild++
      else problems.push(`seed ${seed} game ${g}: rebuild-from-answers differs`)
    }
  }

  const per = (v) => +(v / Math.max(1, s.games)).toFixed(2)
  const sum = (o) => KINDS.reduce((t, k) => t + o[k], 0)
  const row = {
    seed, games: s.games,
    playsPerGame: +(s.plays / Math.max(1, s.games)).toFixed(1),
    closePerGame: per(sum(s.close)),
    closeByKind: s.close,
    closeChallengePerGame: per(sum(s.closeChallenge)),
    challengeMisCallPerGame: per(sum(s.challengeMisCall)),
    boothReviewsPerGame: per(sum(s.boothReviews)),
    boothReviewsByKind: s.boothReviews,
    boothReversedByKind: s.boothReversed,
    boothConfirmedByKind: s.boothConfirmed,
  }
  results.push(row)

  for (const k of KINDS) {
    totals.close[k] += s.close[k]
    totals.closeChallenge[k] += s.closeChallenge[k]
    totals.challengeMisCall[k] += s.challengeMisCall[k]
    totals.boothReviews[k] += s.boothReviews[k]
    totals.boothReversed[k] += s.boothReversed[k]
    totals.boothConfirmed[k] += s.boothConfirmed[k]
  }
  totals.games += s.games
  totals.plays += s.plays

  console.log(`\n=== seed ${seed}: ${s.games} games, ${row.playsPerGame} plays/game ===`)
  console.log(`close plays/game ${row.closePerGame} ${JSON.stringify(row.closeByKind)}`)
  console.log(`challenge domain ${row.closeChallengePerGame}/game  mis-calls ${row.challengeMisCallPerGame}/game`)
  console.log(`booth reviews/game ${row.boothReviewsPerGame}  by kind ${JSON.stringify(row.boothReviewsByKind)}  reversed ${JSON.stringify(row.boothReversedByKind)}  confirmed ${JSON.stringify(row.boothConfirmedByKind)}`)
}

// ── reviews OFF must resolve exactly the same plays ───────────────────────────
{
  const world = store.getWorld()
  const pool = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
  setReplayReview(true)
  const on = simulatePlayByPlay(world, pool[0].id, pool[1].id, world.seed + 4242)
  setReplayReview(false)
  const off = simulatePlayByPlay(world, pool[0].id, pool[1].id, world.seed + 4242)
  setReplayReview(true)
  totals.reviewsOffDiff = key(on) === key(off) ? 0 : 1
  check(getReplayReview() === true, 'setReplayReview did not restore reviews ON')
  console.log(`\nreviews ON vs OFF (review field stripped): ${totals.reviewsOffDiff === 0 ? 'identical' : 'DIFFERENT'}`)
}

// ── old save (no `challenges`) loads and plays on ─────────────────────────────
const oldSave = { ctxOk: false, identical: false, importOk: null, importLoaded: null, importError: null }
{
  const world = store.getWorld()
  const career = store.useGame.getState().career
  const pool = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
  const old = JSON.parse(JSON.stringify(career))
  // a save written before FUTURES #5: a call sheet with no `challenges` field
  old.callSheet = { fourth: 'standard', twoPoint: 'chart', timeouts: 'save' }
  const oldCtx = { ...store.userCtx(career), callSheet: old.callSheet }
  const seedGame = world.seed + 99
  const a = simulatePlayByPlay(world, career.teamId, pool[1].id, seedGame, store.userCtx(career))
  const b = simulatePlayByPlay(world, career.teamId, pool[1].id, seedGame, oldCtx)
  oldSave.ctxOk = true
  oldSave.identical = key(a) === key(b)
  // the genuine import path (migrateWorld + migrateCareer) on a JSON save
  try {
    const payload = JSON.parse(JSON.stringify({ world, career: old, activeTeamId: store.useGame.getState().activeTeamId, screen: 'career', readNews: {} }))
    const envelope = JSON.stringify({ schemaVersion: 2, savedAt: Date.now(), data: payload })
    await store.useGame.getState().importSaveText(envelope)
    oldSave.importOk = store.useGame.getState().career?.callSheet?.challenges ?? null
    oldSave.importLoaded = store.useGame.getState().career?.teamId ?? null
  } catch (e) {
    oldSave.importError = String(e)
  }
  console.log(`old save: ctx sim identical ${oldSave.identical}; imported team=${JSON.stringify(oldSave.importLoaded)} challenges=${JSON.stringify(oldSave.importOk)}${oldSave.importError ? ` ERROR ${oldSave.importError}` : ''}`)
}

// ── summary + assertions ──────────────────────────────────────────────────────
const games = Math.max(1, totals.games)
const pg = (v) => +(v / games).toFixed(3)
const sum = (o) => KINDS.reduce((t, k) => t + o[k], 0)
const summary = {
  games: totals.games,
  playsPerGame: +(totals.plays / games).toFixed(1),
  closePerGame: pg(sum(totals.close)),
  closeByKind: totals.close,
  closeChallengePerGame: pg(sum(totals.closeChallenge)),
  closeChallengeByKind: totals.closeChallenge,
  challengeMisCallPerGame: pg(sum(totals.challengeMisCall)),
  challengeMisCallByKind: totals.challengeMisCall,
  boothReviewsPerGame: pg(sum(totals.boothReviews)),
  boothReviewsByKind: totals.boothReviews,
  boothReversedByKind: totals.boothReversed,
  boothConfirmedByKind: totals.boothConfirmed,
  reviewRecords: totals.reviewRecords,
  reviewNotClose: totals.reviewNotClose,
  reviewOutcomeMismatch: totals.reviewOutcomeMismatch,
  boothMismatch: totals.boothMismatch,
  reviewsOffDiff: totals.reviewsOffDiff,
  determinism: totals.determinism,
  oldSave,
  seeds: results,
}
console.log('\nSUMMARY', JSON.stringify(summary))

check(totals.games >= 2000, `only ${totals.games} games (need >= 2000)`)
check(sum(totals.boothReviews) / games >= 1.0, `booth reviews/game ${pg(sum(totals.boothReviews))} < 1.0`)
check(sum(totals.boothReviews) / games <= 1.6, `booth reviews/game ${pg(sum(totals.boothReviews))} > 1.6`)
check(totals.reviewNotClose === 0, `${totals.reviewNotClose} reviews on non-close plays`)
check(totals.reviewOutcomeMismatch === 0, `${totals.reviewOutcomeMismatch} review outcomes disagree with the miss hash`)
check(totals.boothMismatch === 0, `${totals.boothMismatch} unreviewed close plays ruled a score/turnover`)
check(totals.reviewsOffDiff === 0, 'reviews ON vs OFF differ (reviews must be display-only in C1)')
check(totals.determinism.same === totals.determinism.sameTotal, 'same-seed replay not deterministic')
check(totals.determinism.rebuild === totals.determinism.rebuildTotal, 'rebuild-from-answers not deterministic')
check(sum(totals.challengeMisCall) / games >= 0.6, `challenge-domain mis-calls/game ${pg(sum(totals.challengeMisCall))} < 0.6 (C2 could not reach 0.3–0.6 challenges)`)
check(oldSave.ctxOk && oldSave.identical, 'old save (no challenges field) ctx sim differs')
check(oldSave.importLoaded !== null, 'old save import did not load a career')
if (oldSave.importError) problems.push(`old save import threw: ${oldSave.importError}`)

if (problems.length) {
  console.log(`\nPROBE FAIL (${problems.length}):`)
  for (const p of problems) console.log(`  · ${p}`)
  process.exit(1)
}
console.log('\nPROBE OK')

// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #5 probe — the officiating layer (C1) + challenges (C2).
//
// Runs NFL games with reviews ON and re-derives every close call from the play
// log (the same pure hashes the engine uses), then reports:
//   · close plays by kind, split into the booth and challenge domains;
//   · booth stoppage reviews by kind (reversed / confirmed) — target 1.0–1.6/game;
//   · coach challenges: per game, success %, reversals and timeouts lost by kind
//     — target 0.3–0.6 challenges/game at 35–55 % success;
//   · eligibility: zero challenges inside the 2:00 window, in OT, with 0 timeouts
//     or with 0 challenges left; a 3rd challenge only after two wins; a user
//     moment only when the user's club is hurt and eligible;
//   · reversal equivalence: forcing every mis-call to be thrown and reversed
//     reproduces the reviews-OFF game exactly (plays + box score);
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
const { createGame, runUntil, answerMoment, finishGame } = await import(`${repo}/src/game/engine/playsim.ts`)
const review = await import(`${repo}/src/game/engine/review.ts`)
const { closeCall, onFieldRuling, rulingSafety, inBoothWindow, getReplayReview, setReplayReview, REVIEW } = review

const seeds = (process.argv[2] ?? '33333,2222,5150').split(',').map(Number)
const gamesPer = Number(process.argv[3] ?? 700) // 700 × 3 seeds = 2100 games
const KINDS = ['spot', 'catch', 'fumble', 'goalLine']
const zeroByKind = () => Object.fromEntries(KINDS.map((k) => [k, 0]))
const sum = (o) => KINDS.reduce((t, k) => t + o[k], 0)
const closeState = (p) => ({ n: p.n, yard: p.startYard, distance: p.distance ?? 0, offId: p.offId, defId: p.defId })
const key = (g) => JSON.stringify({ h: g.homeScore, a: g.awayScore, p: g.plays.map(({ review: _review, ...rest }) => rest) })
const statKey = (g) => JSON.stringify(g.stats)

const results = []
const problems = []
const check = (ok, msg) => { if (!ok) problems.push(msg) }

const totals = {
  games: 0, plays: 0,
  close: zeroByKind(), closeChallenge: zeroByKind(), challengeMisCall: zeroByKind(),
  boothReviews: zeroByKind(), boothReversed: zeroByKind(), boothConfirmed: zeroByKind(),
  reviewRecords: 0, reviewNotClose: 0, reviewOutcomeMismatch: 0, boothMismatch: 0,
  // C2
  pending: 0, pendingEligible: 0, challenges: 0, challengeReversed: 0, challengeStands: 0,
  challengesByKind: zeroByKind(), reversedByKind: zeroByKind(), standsByKind: zeroByKind(),
  timeoutsLost: 0, ineligibleThrown: 0, orphanChallenges: 0, thirdRuleViolations: 0,
  overThree: 0,
  userMoments: 0, userMomentBad: 0, userMomentIneligible: 0, userMomentNotHurt: 0, userMomentBadRead: 0,
  reviewsOffReviews: 0, reviewsOffChallenges: 0,
  equivalence: { games: 0, playDiff: 0, statDiff: 0 },
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
    challenges: 0, challengeReversed: 0, challengeStands: 0, challengesByKind: zeroByKind(),
    reversedByKind: zeroByKind(), standsByKind: zeroByKind(), pending: 0, pendingEligible: 0,
  }

  for (let g = 0; g < gamesPer; g++) {
    const h = pool[g % n]
    const a = pool[(g * 7 + 1) % n]
    if (!h || !a || h.id === a.id) continue
    const seedGame = world.seed + g * 7919 + 101

    // Stepped run (AI vs AI): inspect every pending red-flag decision in place.
    const st = createGame(world, h.id, a.id, seedGame)
    const pend = new Map() // play n -> eligibility record
    let guard = 20000
    while (!st.done && guard-- > 0) {
      runUntil(world, st, 'play')
      const r = st.review
      if (r) {
        const chal = st.challenges?.[r.hurt]
        const booth = inBoothWindow(st)
        const eligible = !!chal && chal.left > 0 && (st.timeouts[r.hurt] ?? 0) > 0 && !booth && st.qtr <= 4
        pend.set(r.snap.n, { eligible, kind: r.kind, hurt: r.hurt, booth, qtr: st.qtr, timeouts: st.timeouts[r.hurt] ?? 0, left: chal?.left ?? 0 })
        s.pending++
        totals.pending++
        if (eligible) totals.pendingEligible++
      }
    }
    const sim = finishGame(st)
    s.games++
    s.plays += sim.plays.length

    for (const p of sim.plays) {
      if (p.review) {
        totals.reviewRecords++
        if (p.review.by === 'booth') {
          s.boothReviews[p.review.kind]++
          if (p.review.outcome === 'reversed') s.boothReversed[p.review.kind]++
          else s.boothConfirmed[p.review.kind]++
        } else {
          // C2: a coach challenge record.
          const rec = pend.get(p.n)
          if (!rec) totals.orphanChallenges++
          else if (!rec.eligible) totals.ineligibleThrown++
          s.challenges++
          s.challengesByKind[p.review.kind]++
          totals.challengesByKind[p.review.kind]++
          if (p.review.outcome === 'reversed') { s.challengeReversed++; s.reversedByKind[p.review.kind]++; totals.reversedByKind[p.review.kind]++ }
          else { s.challengeStands++; s.standsByKind[p.review.kind]++; totals.standsByKind[p.review.kind]++ }
        }
      }
      if (p.type !== 'run' && p.type !== 'pass') continue
      // A challenge-domain play whose flag was not reversed (it stood, was never
      // thrown, or the club was ineligible) keeps the RULING on the record, so
      // re-deriving the close call from it is not valid — only truth records
      // (booth reviews, reversals, and plays with no pending) can be re-derived.
      const rulingRecord = pend.has(p.n) && p.review?.outcome !== 'reversed'
      const cst = closeState(p)
      const call = closeCall(cst, p)
      if (!call) {
        // A booth review must always be a close play. A standing challenge keeps
        // the RULING on the record, which need not itself be a bang-bang play.
        if (p.review && p.review.by === 'booth') totals.reviewNotClose++
        continue
      }
      s.close[call.kind]++
      const ruling = onFieldRuling(call.kind, cst, p, call.wrong)
      const safety = rulingSafety(cst, p, call.kind, call.wrong)
      if (p.review && p.review.by === 'booth') {
        if ((p.review.outcome === 'reversed') !== call.wrong) totals.reviewOutcomeMismatch++
      } else {
        s.closeChallenge[call.kind]++
        if (call.wrong) s.challengeMisCall[call.kind]++
        if (!rulingRecord && (ruling.score || ruling.turnover || safety) && !p.review) totals.boothMismatch++
      }
    }

    // C2: the 3rd-challenge rule — per club, the 3rd flag needs two wins first.
    const byClub = new Map()
    for (const p of sim.plays) {
      if (!p.review || p.review.by === 'booth') continue
      const k = p.review.club ?? '?'
      if (!byClub.has(k)) byClub.set(k, [])
      byClub.get(k).push(p.review.outcome)
    }
    for (const seq of byClub.values()) {
      if (seq.length > 3) totals.overThree++
      if (seq.length >= 3 && !(seq[0] === 'reversed' && seq[1] === 'reversed')) totals.thirdRuleViolations++
    }

    // C2: user challenge moments — the user's club must be the hurt, eligible club.
    if (ctx && g < 60) {
      const us = createGame(world, career.teamId, a.id, seedGame, ctx)
      let m = runUntil(world, us, 'moment')
      let mguard = 4000
      while (m && mguard-- > 0) {
        if (m.kind === 'challenge') {
          totals.userMoments++
          const r = us.review
          if (!r) totals.userMomentBad++
          else {
            if (r.hurt !== ctx.userTeamId) totals.userMomentNotHurt++
            const chal = us.challenges?.[r.hurt]
            const eligible = !!chal && chal.left > 0 && (us.timeouts[r.hurt] ?? 0) > 0 && !inBoothWindow(us) && us.qtr <= 4
            if (!eligible) totals.userMomentIneligible++
            if (m.teamId !== ctx.userTeamId) totals.userMomentNotHurt++
            if (!m.staffRead || !/^Replay booth: \d+%/.test(m.staffRead)) totals.userMomentBadRead++
          }
        }
        answerMoment(us, m.defaultId, 'standing')
        m = runUntil(world, us, 'moment')
      }
    }

    // determinism: the same game twice (AI vs AI)
    if (g < 40) {
      const again = createGame(world, h.id, a.id, seedGame)
      let gd = 20000
      while (!again.done && gd-- > 0) runUntil(world, again, 'play')
      totals.determinism.sameTotal++
      if (key(finishGame(again)) === key(sim)) totals.determinism.same++
      else problems.push(`seed ${seed} game ${g}: same-seed replay differs`)
    }
    // determinism: a coached game rebuilt from its answers equals the standing run
    if (ctx && g < 40) {
      const coached = createGame(world, h.id, a.id, seedGame, ctx)
      let cd = 6000
      let cm = runUntil(world, coached, 'moment')
      while (cm && cd-- > 0) { answerMoment(coached, cm.defaultId, 'standing'); cm = runUntil(world, coached, 'moment') }
      const st2 = createGame(world, h.id, a.id, seedGame, ctx)
      let guard2 = 6000
      let m2 = runUntil(world, st2, 'moment')
      while (m2 && guard2-- > 0) { answerMoment(st2, m2.defaultId, 'standing'); m2 = runUntil(world, st2, 'moment') }
      totals.determinism.rebuildTotal++
      if (key(finishGame(st2)) === key(finishGame(coached))) totals.determinism.rebuild++
      else problems.push(`seed ${seed} game ${g}: rebuild-from-answers differs`)
    }
  }

  const per = (v) => +(v / Math.max(1, s.games)).toFixed(2)
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
    challengesPerGame: per(s.challenges),
    successPct: s.challenges ? +((s.challengeReversed / s.challenges) * 100).toFixed(1) : 0,
    challengesByKind: s.challengesByKind,
    reversedByKind: s.reversedByKind,
    standsByKind: s.standsByKind,
    pendingPerGame: per(s.pending),
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
  totals.challenges += s.challenges
  totals.challengeReversed += s.challengeReversed
  totals.challengeStands += s.challengeStands
  totals.pending += s.pending
  totals.games += s.games
  totals.plays += s.plays

  console.log(`\n=== seed ${seed}: ${s.games} games, ${row.playsPerGame} plays/game ===`)
  console.log(`close plays/game ${row.closePerGame} ${JSON.stringify(row.closeByKind)}`)
  console.log(`challenge domain ${row.closeChallengePerGame}/game  mis-calls ${row.challengeMisCallPerGame}/game`)
  console.log(`booth reviews/game ${row.boothReviewsPerGame}  by kind ${JSON.stringify(row.boothReviewsByKind)}  reversed ${JSON.stringify(row.boothReversedByKind)}  confirmed ${JSON.stringify(row.boothConfirmedByKind)}`)
  console.log(`challenges/game ${row.challengesPerGame}  success ${row.successPct}%  by kind ${JSON.stringify(row.challengesByKind)}  reversed ${JSON.stringify(row.reversedByKind)}`)
}

// ── C2: reversal equivalence — force every mis-call thrown + reversed and check
//    the game is byte-identical to reviews OFF (plays + box score). ────────────
{
  const saved = {
    readWrong: REVIEW.readWrong, readRight: REVIEW.readRight,
    ta: REVIEW.threshold.aggressive, ts: REVIEW.threshold.standard, tc: REVIEW.threshold.conservative,
    rev: REVIEW.challengeReverse, boothSec: REVIEW.boothSec,
  }
  REVIEW.readWrong = 1; REVIEW.readRight = 0
  REVIEW.threshold.aggressive = 0.5; REVIEW.threshold.standard = 0.5; REVIEW.threshold.conservative = 0.5
  REVIEW.challengeReverse = 1
  // A play that starts outside the 2:00 window but ends inside it cannot be
  // challenged (the ruling stands by rule), which is not a reversal. Widen the
  // booth window for this isolation so every mis-call is a clean reversal.
  REVIEW.boothSec = 900
  for (const seed of seeds) {
    store.useGame.getState().startCareer({ name: 'Probe', path: 'coach', archetype: 'off', teamId: 'CLE', seed, startLevel: 7 })
    const world = store.getWorld()
    const pool = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
    const n = pool.length
    for (let g = 0; g < 60; g++) {
      const h = pool[g % n], a = pool[(g * 7 + 1) % n]
      if (!h || !a || h.id === a.id) continue
      const sg = world.seed + g * 7919 + 101
      const run = (on) => {
        setReplayReview(on)
        const st = createGame(world, h.id, a.id, sg)
        // Isolate the reversal: give BOTH clubs unlimited flags AND timeouts, so
        // every challenge-domain mis-call is thrown and reversed (the real caps
        // are exercised in the main loop). Both runs get the same pool, so the
        // comparison stays apples-to-apples.
        if (st.challenges) for (const id of [h.id, a.id]) { st.challenges[id].left = 99; st.timeouts[id] = 99 }
        let d = 20000
        while (!st.done && d-- > 0) runUntil(world, st, 'play')
        return finishGame(st)
      }
      const truth = run(false)
      const forced = run(true)
      totals.equivalence.games++
      if (key(forced) !== key(truth)) totals.equivalence.playDiff++
      if (statKey(forced) !== statKey(truth)) totals.equivalence.statDiff++
    }
  }
  setReplayReview(true)
  REVIEW.readWrong = saved.readWrong; REVIEW.readRight = saved.readRight
  REVIEW.threshold.aggressive = saved.ta; REVIEW.threshold.standard = saved.ts; REVIEW.threshold.conservative = saved.tc
  REVIEW.challengeReverse = saved.rev; REVIEW.boothSec = saved.boothSec
  check(totals.equivalence.playDiff === 0, `reversal equivalence: ${totals.equivalence.playDiff} forced games differ from reviews OFF (plays)`)
  check(totals.equivalence.statDiff === 0, `reversal equivalence: ${totals.equivalence.statDiff} forced games differ from reviews OFF (box score)`)
  console.log(`\nreversal equivalence (all mis-calls thrown + reversed vs reviews OFF): ${totals.equivalence.games} games, play diffs ${totals.equivalence.playDiff}, stat diffs ${totals.equivalence.statDiff}`)
}

// ── reviews OFF: no close plays, no reviews, no challenges at all ─────────────
{
  const world = store.getWorld()
  const pool = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
  setReplayReview(false)
  const st = createGame(world, pool[0].id, pool[1].id, world.seed + 4242)
  let d = 20000
  while (!st.done && d-- > 0) runUntil(world, st, 'play')
  const off = finishGame(st)
  setReplayReview(true)
  for (const p of off.plays) {
    if (p.review) { totals.reviewsOffReviews++; if (p.review.by !== 'booth') totals.reviewsOffChallenges++ }
  }
  check(getReplayReview() === true, 'setReplayReview did not restore reviews ON')
  check(totals.reviewsOffReviews === 0, `${totals.reviewsOffReviews} reviews with reviews OFF`)
  console.log(`\nreviews OFF: ${off.plays.length} plays, ${totals.reviewsOffReviews} reviews, ${totals.reviewsOffChallenges} challenges`)
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
  const runCtx = (c) => { const st = createGame(world, career.teamId, pool[1].id, seedGame, c); let d = 6000; let m = runUntil(world, st, 'moment'); while (m && d-- > 0) { answerMoment(st, m.defaultId, 'standing'); m = runUntil(world, st, 'moment') } return finishGame(st) }
  const a = runCtx(store.userCtx(career))
  const b = runCtx(oldCtx)
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
const successPct = totals.challenges ? +((totals.challengeReversed / totals.challenges) * 100).toFixed(1) : 0
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
  challengesPerGame: pg(totals.challenges),
  challengeSuccessPct: successPct,
  challengesByKind: totals.challengesByKind,
  reversedByKind: totals.reversedByKind,
  standsByKind: totals.standsByKind,
  timeoutsLostPerGame: pg(totals.challengeStands),
  pendingPerGame: pg(totals.pending),
  pendingEligiblePerGame: pg(totals.pendingEligible),
  reviewRecords: totals.reviewRecords,
  reviewNotClose: totals.reviewNotClose,
  reviewOutcomeMismatch: totals.reviewOutcomeMismatch,
  boothMismatch: totals.boothMismatch,
  ineligibleThrown: totals.ineligibleThrown,
  orphanChallenges: totals.orphanChallenges,
  thirdRuleViolations: totals.thirdRuleViolations,
  overThree: totals.overThree,
  userMoments: totals.userMoments,
  userMomentBad: totals.userMomentBad,
  userMomentNotHurt: totals.userMomentNotHurt,
  userMomentIneligible: totals.userMomentIneligible,
  userMomentBadRead: totals.userMomentBadRead,
  reviewsOffReviews: totals.reviewsOffReviews,
  equivalence: totals.equivalence,
  determinism: totals.determinism,
  oldSave,
  seeds: results,
}
console.log('\nSUMMARY', JSON.stringify(summary))

const challengesPerGame = totals.challenges / games
check(totals.games >= 2000, `only ${totals.games} games (need >= 2000)`)
check(sum(totals.boothReviews) / games >= 1.0, `booth reviews/game ${pg(sum(totals.boothReviews))} < 1.0`)
check(sum(totals.boothReviews) / games <= 1.6, `booth reviews/game ${pg(sum(totals.boothReviews))} > 1.6`)
check(challengesPerGame >= 0.3, `challenges/game ${pg(totals.challenges)} < 0.3`)
check(challengesPerGame <= 0.6, `challenges/game ${pg(totals.challenges)} > 0.6`)
check(successPct >= 35, `challenge success ${successPct}% < 35%`)
check(successPct <= 55, `challenge success ${successPct}% > 55%`)
check(totals.reviewNotClose === 0, `${totals.reviewNotClose} reviews on non-close plays`)
check(totals.reviewOutcomeMismatch === 0, `${totals.reviewOutcomeMismatch} booth review outcomes disagree with the miss hash`)
check(totals.boothMismatch === 0, `${totals.boothMismatch} unreviewed close plays ruled a score/turnover`)
check(totals.ineligibleThrown === 0, `${totals.ineligibleThrown} challenges thrown while ineligible (window/OT/timeouts/challenges)`)
check(totals.orphanChallenges === 0, `${totals.orphanChallenges} challenge reviews with no pending decision`)
check(totals.thirdRuleViolations === 0, `${totals.thirdRuleViolations} 3rd challenges without two prior wins`)
check(totals.overThree === 0, `${totals.overThree} clubs threw more than 3 challenges in a game`)
check(totals.userMoments > 0, 'no user challenge moments observed')
check(totals.userMomentBad === 0, `${totals.userMomentBad} challenge moments without a pending review`)
check(totals.userMomentNotHurt === 0, `${totals.userMomentNotHurt} challenge moments where the user club was not hurt`)
check(totals.userMomentIneligible === 0, `${totals.userMomentIneligible} challenge moments while ineligible`)
check(totals.userMomentBadRead === 0, `${totals.userMomentBadRead} challenge moments with a bad replay read`)
check(totals.reviewsOffReviews === 0, `${totals.reviewsOffReviews} reviews with reviews OFF`)
check(totals.determinism.same === totals.determinism.sameTotal, 'same-seed replay not deterministic')
check(totals.determinism.rebuild === totals.determinism.rebuildTotal, 'rebuild-from-answers not deterministic')
check(oldSave.ctxOk && oldSave.identical, 'old save (no challenges field) ctx sim differs')
check(oldSave.importLoaded !== null, 'old save import did not load a career')
if (oldSave.importError) problems.push(`old save import threw: ${oldSave.importError}`)

if (problems.length) {
  console.log(`\nPROBE FAIL (${problems.length}):`)
  for (const p of problems) console.log(`  · ${p}`)
  process.exit(1)
}
console.log('\nPROBE OK')

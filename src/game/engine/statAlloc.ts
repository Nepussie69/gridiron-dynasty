// ─────────────────────────────────────────────────────────────────────────────
// League-wide stat allocation.
//
// Simulating play-by-play for all ~2,000 games a season would be far too slow.
// Instead we give every game a score (fast sim) and then distribute that game's
// realistic team totals across the roster, weighted by talent, role, scheme fit,
// and playbook familiarity. The result: full league-wide box scores cheaply.
// ─────────────────────────────────────────────────────────────────────────────

import type { GameStatLine, Player, Position } from '../types'
import { playerAttrs } from '../data/ratings'
import { coachEffect } from './coaching'
import { depthGroup } from './depth'
import type { Game, World } from './generate'
import { clamp, hash32, makeRng, type Rng } from './rng'
import { currentSeason, recordGameStats } from './stats'
import type { GameSim, Play } from './playsim'
import { carrierMissRate, defenderMissRate } from './playsim'

import { leagueMasteryMeans, masteryGroup, type MasteryMeans } from './playbook'
import { POS_MEAN } from './ratingMeans'
import { styleProfile } from './style'
import { clubReturners } from './returns'

const POS_SIDE: Record<string, 'OFF' | 'DEF' | 'ST'> = {
  QB: 'OFF', RB: 'OFF', FB: 'OFF', WR: 'OFF', TE: 'OFF', OT: 'OFF', OG: 'OFF', C: 'OFF',
  DE: 'DEF', DT: 'DEF', LB: 'DEF', CB: 'DEF', S: 'DEF', K: 'ST', P: 'ST',
}

function mkAttrs(p: Player): Record<string, number> {
  return playerAttrs(p)
}

// R7: fast-path drops. The fast allocator never models incompletions (targets ≈
// receptions + 0/1), so the PBP conditional drop chance (≈12% of incompletions)
// lands at only ≈1.3% of targets here. Apply the drop expectation directly to
// targets instead, calibrated to the PBP league rate (≈3–4%) and still
// CTH-sensitive (better hands drop less). detCount keeps it deterministic — no
// rng() draw is added or removed.
const FAST_DROP_BASE = 0.037
const FAST_DROP_SLOPE = 0.0006
const FAST_DROP_LO = 0.02
const FAST_DROP_HI = 0.08

function tenureOf(p: Player): number {
  const s = p.stats ?? []
  return s.length ? s[s.length - 1].teamSchemeYears ?? 1 : 1
}

/** Weight a player by talent, role usage, and system familiarity. */
function weight(p: Player, role: 'pass' | 'rush' | 'rec' | 'def', scheme: string, means: MasteryMeans): number {
  const a = mkAttrs(p)
  void scheme
  // L12.13 M3: system familiarity is relative to the league mean for the group,
  // so an average club's share is unchanged (same slope as the old absolute fam).
  const g = masteryGroup(p.pos)
  const fam = g ? 1 + ((p.playbook?.pct ?? 0) - means[g]) * 0.0028 : 1
  void tenureOf
  let base = p.ovr
  if (role === 'pass') base = (a.THP ?? p.ovr) * 0.5 + p.ovr * 0.5
  if (role === 'rush') base = (a.BCV ?? p.ovr) * 0.5 + (a.SPD ?? p.ovr) * 0.3 + p.ovr * 0.2
  if (role === 'rec') base = (a.CTH ?? p.ovr) * 0.4 + (a.SPD ?? p.ovr) * 0.3 + p.ovr * 0.3
  if (role === 'def') base = (a.TAK ?? p.ovr) * 0.5 + (a.PUR ?? p.ovr) * 0.3 + p.ovr * 0.2
  return Math.max(1, base * fam)
}

/** Top N by position group, with weights. */
function group(world: World, teamId: string, positions: string[], n: number, role: 'pass' | 'rush' | 'rec' | 'def', scheme: string, means: MasteryMeans) {
  const list = depthGroup(world, teamId, positions as Position[], n)
  return { items: list, weights: list.map((p) => weight(p, role, scheme, means)) }
}

/** Split a total into n shares, weighted, returning integers that sum to total. */
function split(_rng: Rng, total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1
  const raw = weights.map((w) => (w / sum) * total)
  const out = raw.map((v) => Math.floor(v))
  let rem = total - out.reduce((a, b) => a + b, 0)
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac)
  for (let k = 0; k < rem && order.length; k++) out[order[k % order.length].i] += 1
  return out
}

/**
 * R7/R9: a deterministic weighted split into integers summing to `total`. Used by
 * the fast-sim coverage and pressure allocation, which must not consume rng() so
 * the seed stream (and every other allocated stat) is unchanged. Largest-fraction
 * gets the remainder, with a per-item hash as the tie-break.
 */
function detSplit(total: number, weights: number[], key: string): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1
  const raw = weights.map((w) => (w / sum) * total)
  const out = raw.map((v) => Math.floor(v))
  let rem = total - out.reduce((a, b) => a + b, 0)
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v), tie: hashUnit(`${key}:${i}`) }))
    .sort((a, b) => b.frac - a.frac || a.tie - b.tie)
  for (let k = 0; k < rem && order.length; k++) out[order[k % order.length].i] += 1
  return out
}

/** R5: the fast-allocation reference miss rate for an average defender. Measured
 *  from the same rating helper the play-by-play uses, so a league-average defence
 *  lands at the base team total below (≈ the play-by-play 7–9 band). */
const MT_ALLOC_REF = 0.083
/** R5: base team missed-tackle total (play-by-play expectation). */
const MT_ALLOC_BASE = 8

/** R12: forced-miss share. Weighting by the raw per-touch rate concentrates the
 *  opponent's whole missed-tackle total on the lead back (an RB1 ran at ≈ 7–8 per
 *  game). A compressive touches curve with a bounded rating tilt spreads it over
 *  the whole skill group (NFL: RB1 ≈ 25–35 per 17 games, WR1 ≈ 5–15). Deterministic
 *  (no rng draw); the team total is still reconciled to the opponent's missed
 *  tackles in `reconcileForced`. */
const MT_FORCE_EXP = 0.08
const MT_FORCE_LO = 0.95
const MT_FORCE_HI = 1.05

function forcedWeight(p: Player, touches: number): number {
  const rel = clamp(carrierMissRate(p) / MT_ALLOC_REF, MT_FORCE_LO, MT_FORCE_HI)
  return Math.pow(Math.max(1, touches), MT_FORCE_EXP) * rel
}

/** R5: a deterministic uniform in [0,1) from a string key — never an rng() draw. */
function hashUnit(key: string): number {
  return (hash32(key) >>> 0) / 4294967296
}

/**
 * R5: deterministic, unbiased count for `total` independent events at `rate`.
 * A fast-sim game gives a receiver at most one incompletion, or a defender a
 * handful of tackles, so rounding `total * rate` would quantise most events to
 * zero. The fractional part is spent by a per-event hash instead: the expected
 * value is exactly `total * rate`, it is reproducible, and it draws no rng().
 */
function detCount(total: number, rate: number, key: string): number {
  const expected = total * rate
  const base = Math.floor(expected)
  return base + (hashUnit(`${key}:frac`) < expected - base ? 1 : 0)
}

/**
 * Allocate one team's game production to its players.
 * Uses realistic team totals derived from the scoreline.
 */
export function allocateTeamGame(
  world: World,
  teamId: string,
  points: number,
  _opponentPoints: number,
  rng: Rng,
  gameKey: string,
): { lines: { playerId: string; line: GameStatLine }[]; offense: { playerId: string; line: GameStatLine }[]; defMissed: number } {
  const scheme = (world.staff[teamId] ?? []).find((s) => s.role === 'Offensive Coordinator')?.scheme ?? ''
  const eff = coachEffect(world, teamId)
  const means = leagueMasteryMeans(world)
  const out: { playerId: string; line: GameStatLine }[] = []
  // R5: offensive lines carry the (rating-weighted) forced-miss share; the two
  // teams' forced totals are reconciled to the opponent's missed-tackle total in
  // statGame so the generated league never reports fake independent counts.
  const offense: { playerId: string; line: GameStatLine }[] = []
  const addLine = (playerId: string, line: GameStatLine) => out.push({ playerId, line })
  const addOff = (playerId: string, line: GameStatLine) => {
    const ref = { playerId, line }
    out.push(ref)
    offense.push(ref)
  }

  const isNFL = world.byId[teamId]?.tier === 'NFL'
  const basePass = isNFL ? 218 : 235
  const baseRush = isNFL ? 112 : 165
  const pace = isNFL ? 1 : 1.08
  const schemePassBias = { 'Air Raid': 1.25, 'Pro Style': 0.95, Spread: 1.1, 'West Coast': 1.05, 'RPO Heavy': 0.9 }[scheme] ?? 1

  const variance = 0.72 + rng() * 0.7
  const passYds = Math.round(basePass * variance * schemePassBias * pace * (1 + eff.offEdge * 0.02))
  const rushYds = Math.round(baseRush * variance * (2 - schemePassBias) * pace)

  // ── Passing ──
  const qbs = group(world, teamId, ['QB'], 1, 'pass', scheme, means)
  const qb = qbs.items[0]
  if (qb) {
    const att = Math.round(passYds / (isNFL ? 7.1 : 7.9))
    const compPct = clamp((isNFL ? 0.645 : 0.616) + (eff.offEdge * 0.004), 0.5, 0.78)
    const comp = Math.round(att * compPct)
    // ~73% of NFL points come from offensive TDs (FGs, defense/ST score the rest),
    // ~66% of those through the air: 22.6 pts -> ~1.55 passing TDs (2015-2024).
    const td = Math.max(0, Math.round((points / 7) * 0.48 * (0.7 + rng() * 0.6)))
    const ints = rng() < 0.42 ? (rng() < 0.7 ? 1 : 2) : 0
    // R8: sacks taken by the QB (SK) and sack yards lost (SKY). The fast sim has no
    // play-by-play, so the club's sack total is a plausible deterministic count; the
    // offense's dropback count (att + sk) is what the defence's pressure rate uses.
    const qbSacks = clamp(Math.round(2.4 + (hashUnit(`${gameKey}:${teamId}:skt`) - 0.5) * 2.6), 0, 7)
    const qbSackYds = qbSacks * (5 + Math.round(hashUnit(`${gameKey}:${teamId}:sky`) * 4))
    addOff(qb.id, {
      playerId: qb.id, passAtt: att, passComp: comp, passYds, passTD: td, ints,
      sk: qbSacks, sky: qbSackYds,
    })
  }

  // ── Rushing ──
  const rbs = group(world, teamId, ['RB'], 3, 'rush', scheme, means)
  if (rbs.items.length) {
    const carries = Math.round(rushYds / (isNFL ? 4.35 : 4.5))
    const shares = rbs.weights.map((w, i) => (i === 0 ? w * 2.4 : w))
    // L12 S2 parity: score-only games must show the QB's rushing like play-by-play
    // does. Mirror playsim's carry split (RB1 0.60 / RB2 0.27 / QB 0.13, raised for a
    // scrambler) and use his own legs for yards per carry. Deterministic (style only,
    // no rng draws), and the QB's share is carved out of the backs' so the team's
    // rush attempts, yards and TDs are unchanged. If the QB does not exist he is
    // simply skipped, keeping the old behaviour.
    const qa = qb ? mkAttrs(qb) : undefined
    const qbScramble = qb ? styleProfile(qb).scramble : 0
    const wq = 0.13 + qbScramble * 0.12
    const qbFrac = qb ? clamp(wq / (0.6 + 0.27 + wq), 0, 0.4) : 0
    const qbCarries = qb ? Math.min(carries, Math.round(carries * qbFrac)) : 0
    let qbYds = 0
    if (qb && qa && qbCarries > 0) {
      // Same elusiveness playsim gives a QB run: SPD / AGI / BCV.
      const legs = (qa.SPD ?? 70) * 0.5 + (qa.AGI ?? 70) * 0.4 + (qa.BCV ?? 70) * 0.1
      const qbYpc = clamp((isNFL ? 4.35 : 4.5) + (legs - 70) * 0.08, 1.5, 9)
      qbYds = Math.min(rushYds, Math.round(qbCarries * qbYpc))
    }
    const split_ = split(rng, carries - qbCarries, shares)
    const yardsSplit = split(rng, rushYds - qbYds, shares)
    // ~34% of offensive TDs on the ground: 22.6 pts -> ~0.8 rushing TDs.
    const rushTd = Math.max(0, Math.round((points / 7) * 0.25 * (0.6 + rng() * 0.8)))
    const qbTd = qb && carries > 0 ? Math.min(rushTd, Math.round((rushTd * qbCarries) / carries)) : 0
    const tdSplit = split(rng, rushTd - qbTd, shares)
    rbs.items.forEach((p, i) => addOff(p.id, {
      playerId: p.id,
      rushAtt: split_[i] ?? 0,
      rushYds: yardsSplit[i] ?? 0,
      rushTD: tdSplit[i] ?? 0,
      // R5/R12: compressive, rating-tilted forced-miss share (reconciled to the
      // opponent's team total).
      forcedMissed: forcedWeight(p, split_[i] ?? 0),
    }))
    // Fold the keepers onto the QB's existing (passing) line so he is only counted
    // once per game, matching how a played game's box score merges by player.
    if (qb && qbCarries > 0) {
      const ql = out.find((o) => o.playerId === qb.id)?.line
      if (ql) {
        ql.rushAtt = (ql.rushAtt ?? 0) + qbCarries
        ql.rushYds = (ql.rushYds ?? 0) + qbYds
        ql.rushTD = (ql.rushTD ?? 0) + qbTd
      }
    }
  }

  // ── Receiving ──
  const recvs = group(world, teamId, ['WR', 'TE', 'RB', 'FB'], 6, 'rec', scheme, means)
  if (recvs.items.length && qb) {
    const completions = Math.round(passYds / (isNFL ? 9.6 : 10.5))
    const shares = recvs.weights
    const recSplit = split(rng, completions, shares)
    const yardSplit = split(rng, passYds, shares)
    const td = Math.max(0, Math.round((points / 7) * 0.48))
    const tdSplit = split(rng, td, shares)
    recvs.items.forEach((p, i) => {
      const rec = recSplit[i] ?? 0
      // Preserve the original draw site exactly: targets = receptions + rng() threshold.
      const tg = rec + (rng() < 0.5 ? 1 : 0)
      // R5/R7: allocate drops per target, CTH-centred on the position mean.
      // `detCount` spends the fractional expectation with a per-player/game hash, so
      // a receiver with one target no longer rounds every drop away to zero.
      const cthMean = POS_MEAN[p.pos]?.CTH ?? 72
      const dropRate = clamp(FAST_DROP_BASE - ((mkAttrs(p).CTH ?? 70) - cthMean) * FAST_DROP_SLOPE, FAST_DROP_LO, FAST_DROP_HI)
      addOff(p.id, {
        playerId: p.id,
        targets: tg,
        rec,
        recYds: yardSplit[i] ?? 0,
        recTD: tdSplit[i] ?? 0,
        // R5/R12: compressive, rating-tilted forced-miss share (reconciled to the
        // opponent's team total).
        forcedMissed: forcedWeight(p, rec),
        drops: detCount(tg, dropRate, `${gameKey}:${p.id}:drop`),
      })
    })
  }

  // ── Defense ──
  let defMissed = 0
  const defenders = (world.roster[teamId] ?? []).filter((p) => POS_SIDE[p.pos] === 'DEF' && !p.injured).slice(0, 12)
  if (defenders.length) {
    // Team tackles scale with opponent plays faced; sacks and INTs are rare events.
    const teamTackles = Math.round(58 + rng() * 26)
    const w = defenders.map((p) => weight(p, 'def', scheme, means))
    const tSplit = split(rng, teamTackles, w)
    const sacks = rng() < 0.68 ? (rng() < 0.6 ? 2 : rng() < 0.8 ? 3 : 4) : (rng() < 0.6 ? 1 : 0)
    const ints = rng() < 0.3 ? 1 : rng() < 0.12 ? 2 : 0
    const rushers = defenders.filter((p) => ['DE', 'DT', 'LB'].includes(p.pos))
    const dbGroup = defenders.filter((p) => ['CB', 'S'].includes(p.pos))
    const sSplit = rushers.length ? split(rng, sacks, rushers.map((p) => weight(p, 'def', scheme, means))) : []
    const iSplit = dbGroup.length ? split(rng, ints, dbGroup.map((p) => weight(p, 'def', scheme, means))) : []
    // R5: team missed-tackle total sits in the play-by-play band (≈7–9); a
    // better-tackling defence sits lower, a poor one higher, using the SAME
    // rating helper the play-by-play uses. `MT_ALLOC_REF` is the model's
    // league-average defender rate, so an average defence lands at the base 8.
    const avgMtRate = defenders.reduce((s, p) => s + defenderMissRate(p), 0) / defenders.length
    const mtTotal = clamp(Math.round(MT_ALLOC_BASE * (avgMtRate / MT_ALLOC_REF)), 5, 11)
    const mtWeight = defenders.map((p, i) => (tSplit[i] ?? 0) * defenderMissRate(p))
    const mtSplit = split(rng, mtTotal, mtWeight)
    defMissed = mtTotal
    defenders.forEach((p) => {
      const ri = rushers.indexOf(p)
      const di = dbGroup.indexOf(p)
      const tk = tSplit[defenders.indexOf(p)] ?? 0
      addLine(p.id, {
        playerId: p.id,
        tackles: tk,
        defSacks: ri >= 0 ? sSplit[ri] ?? 0 : 0,
        defInts: di >= 0 ? iSplit[di] ?? 0 : 0,
        missedTackles: mtSplit[defenders.indexOf(p)] ?? 0,
      })
    })
  }

  // ── R6: returns ──
  // The club's automatic KR/PR (or the depth-chart override) gets a plausible
  // deterministic return line so simmed seasons show KR / PR production. The
  // events are hash-drawn (no rng) and fold onto the player's existing line.
  const rets = clubReturners(world, teamId)
  const addRet = (playerId: string, fields: Partial<GameStatLine>) => {
    const line = out.find((o) => o.playerId === playerId)?.line
    if (line) {
      for (const [k, v] of Object.entries(fields)) {
        if (typeof v === 'number') {
          const rec = line as unknown as Record<string, number>
          rec[k] = (rec[k] ?? 0) + v
        }
      }
    } else {
      addLine(playerId, { playerId, ...fields })
    }
  }
  if (rets.kr) {
    const krN = 1 + (hashUnit(`${gameKey}:${rets.kr.id}:krn`) < 0.35 ? 1 : 0)
    addRet(rets.kr.id, {
      kickRet: krN,
      kickRetYds: Math.round(krN * (18 + hashUnit(`${gameKey}:${rets.kr.id}:kry`) * 8)),
      retTD: hashUnit(`${gameKey}:${rets.kr.id}:krtd`) < 0.003 ? 1 : 0,
    })
  }
  if (rets.pr) {
    const prN = 1 + (hashUnit(`${gameKey}:${rets.pr.id}:prn`) < 0.55 ? 1 : 0)
    addRet(rets.pr.id, {
      puntRet: prN,
      puntRetYds: Math.round(prN * (6 + hashUnit(`${gameKey}:${rets.pr.id}:pry`) * 7)),
      ...(rets.pr.id === rets.kr?.id ? {} : { retTD: hashUnit(`${gameKey}:${rets.pr.id}:prtd`) < 0.006 ? 1 : 0 }),
    })
  }
  // R6: defensive touchdowns (pick-six / fumble return) go to a defender.
  if (defenders.length) {
    const scorer = defenders[hash32(`${gameKey}:${teamId}:deftd`) % defenders.length]
    if (scorer && hashUnit(`${gameKey}:${teamId}:deftdr`) < 0.09) {
      const line = out.find((o) => o.playerId === scorer.id)?.line
      if (line) line.defTD = (line.defTD ?? 0) + 1
    }
  }

  return { lines: out, offense, defMissed }
}

/**
 * R7/R9: allocate the fast-sim coverage and pressure stats that the play-by-play
 * credits via `coverId` / pressure credit. Deterministic (hashes only, no rng()),
 * so the seed stream for every other allocated stat is untouched. Coverage allowed
 * by a defence equals the opponent offence's passing production, so simmed seasons
 * have consistent REC allowed / YDS ALW / COV; pressures come from the same
 * pressureEdge-style rate and are split among the rushers by max(PMV, FMV).
 */
function allocateCoverageAndPressure(
  world: World,
  alloc: { lines: { playerId: string; line: GameStatLine }[]; offense: { playerId: string; line: GameStatLine }[] },
  opp: { lines: { playerId: string; line: GameStatLine }[]; offense: { playerId: string; line: GameStatLine }[] },
  key: string,
) {
  const playerById = new Map(world.players.map((p) => [p.id, p]))
  // The passing this defence allowed = the opponent offence's totals.
  let tgt = 0
  let comp = 0
  let yds = 0
  let td = 0
  let ints = 0
  for (const { line } of opp.offense) {
    tgt += line.passAtt ?? 0
    comp += line.passComp ?? 0
    yds += line.passYds ?? 0
    td += line.passTD ?? 0
    ints += line.ints ?? 0
  }
  const oppQb = opp.offense.find((o) => playerById.get(o.playerId)?.pos === 'QB')
  const dropbacks = tgt + (oppQb?.line.sk ?? 0)

  const covRows = alloc.lines.filter((l) => {
    const p = playerById.get(l.playerId)
    return !!p && (p.pos === 'CB' || p.pos === 'S' || p.pos === 'LB')
  })
  const rushRows = alloc.lines.filter((l) => {
    const p = playerById.get(l.playerId)
    return !!p && (p.pos === 'DE' || p.pos === 'DT' || p.pos === 'LB')
  })

  // ── R9: coverage ──
  if (covRows.length) {
    const covW = covRows.map(({ playerId }) => {
      const p = playerById.get(playerId)!
      const a = mkAttrs(p)
      const mcv = a.MCV ?? 70
      const zcv = a.ZCV ?? 70
      if (p.pos === 'CB') return Math.max(1, (mcv * 0.6 + zcv * 0.4) * 2.4)
      if (p.pos === 'S') return Math.max(1, (mcv * 0.4 + zcv * 0.6) * 1.3)
      return Math.max(1, (mcv * 0.3 + zcv * 0.7) * 0.9)
    })
    const tgts = detSplit(tgt, covW, `${key}:ctgt`)
    const comps = detSplit(comp, covW, `${key}:ccmp`)
    const ydsA = detSplit(yds, covW, `${key}:cyds`)
    const tds = detSplit(td, covW, `${key}:ctd`)
    const intsCov = detSplit(ints, covW, `${key}:cint`)
    covRows.forEach((row, i) => {
      row.line.defTargets = (row.line.defTargets ?? 0) + tgts[i]
      row.line.defComp = (row.line.defComp ?? 0) + Math.min(tgts[i], comps[i])
      row.line.defYdsAllowed = (row.line.defYdsAllowed ?? 0) + ydsA[i]
      row.line.defTDAllowed = (row.line.defTDAllowed ?? 0) + tds[i]
      row.line.defIntsCov = (row.line.defIntsCov ?? 0) + intsCov[i]
    })
  }

  // ── R7: pressures ──
  const edges: number[] = []
  const rushW = rushRows.map(({ playerId }) => {
    const p = playerById.get(playerId)!
    const a = mkAttrs(p)
    const edge = Math.max(a.PMV ?? 70, a.FMV ?? 70)
    if (p.pos === 'DE' || p.pos === 'DT') edges.push(edge)
    return p.pos === 'LB' ? Math.max(1, edge * 0.45) : Math.max(1, edge)
  })
  const avgEdge = edges.length ? edges.reduce((s, w) => s + w, 0) / edges.length : 72
  const rate = clamp(0.30 + (avgEdge - 72) * 0.005, 0.22, 0.42)
  const totalPrs = clamp(Math.round(dropbacks * rate), 0, dropbacks)
  if (rushRows.length) {
    const totalSck = rushRows.reduce((s, r) => s + (r.line.defSacks ?? 0), 0)
    const nonSack = Math.max(0, totalPrs - totalSck)
    const qbhTotal = Math.round(nonSack * 0.225)
    const hurTotal = nonSack - qbhTotal
    const hits = detSplit(qbhTotal, rushW, `${key}:qbh`)
    const hurs = detSplit(hurTotal, rushW, `${key}:hur`)
    rushRows.forEach((row, i) => {
      const sck = row.line.defSacks ?? 0
      row.line.qbHits = (row.line.qbHits ?? 0) + hits[i]
      row.line.hurries = (row.line.hurries ?? 0) + hurs[i]
      row.line.prs = (row.line.prs ?? 0) + sck + hits[i] + hurs[i]
    })
  }
  // The opponent QB faced this defence's pressures.
  if (oppQb) oppQb.line.pressured = (oppQb.line.pressured ?? 0) + totalPrs
}

/**
 * R5/R12: each club's forced-miss total must equal the opponent's missed-tackle
 * total (they are the same events), so the fast allocation never reports two
 * independent counts for one play. The rating-weighted shares set the split.
 *
 * R12: two fixes so player FMT lands in the NFL per-player bands while the team
 * total still reconciles exactly. (1) A back carries and catches on two separate
 * lines — aggregate a player's weight first, or he claims two remainder shares.
 * (2) The integer remainder is assigned by a stratified, hash-seeded lottery over
 * each player's fractional expectation (no rng draw) instead of always to the
 * largest fractions, which otherwise hands the same lead backs an extra point
 * every game and inflates their season totals to roughly 2x.
 */
function reconcileForced(offense: { playerId: string; line: GameStatLine }[], target: number, key: string) {
  if (!offense.length) return
  if (target <= 0) {
    for (const o of offense) o.line.forcedMissed = 0
    return
  }
  const groups = new Map<string, { raw: number; lines: { playerId: string; line: GameStatLine }[] }>()
  for (const o of offense) {
    let g = groups.get(o.playerId)
    if (!g) { g = { raw: 0, lines: [] }; groups.set(o.playerId, g) }
    g.raw += o.line.forcedMissed ?? 0
    g.lines.push(o)
  }
  const list = [...groups.values()]
  const cur = list.reduce((s, g) => s + g.raw, 0)
  const raw = cur > 0 ? list.map((g) => (g.raw / cur) * target) : list.map(() => target / list.length)
  const out = raw.map((v) => Math.floor(v))
  const frac = raw.map((v) => v - Math.floor(v))
  const rem = target - out.reduce((a, b) => a + b, 0)
  if (rem > 0) {
    const cum: number[] = []
    let acc = 0
    for (const f of frac) { acc += f; cum.push(acc) }
    for (let j = 0; j < rem; j++) {
      const pos = j + hashUnit(`${key}:frc:${j}`)
      let i = 0
      while (i < cum.length - 1 && cum[i] <= pos) i++
      out[Math.min(i, out.length - 1)] += 1
    }
  }
  list.forEach((g, i) => g.lines.forEach((o, j) => { o.line.forcedMissed = j === 0 ? out[i] : 0 }))
}

/**
 * Give a score-only game a full box score and fold it into every player's
 * career stats. Called for all non-user games.
 */
export function statGame(world: World, game: Game, season: number, level: 'NFL' | 'CFB') {
  if (game.homeScore == null || game.awayScore == null) return
  // Reconstruct a minimal GameSim-shaped object so the stats layer can consume it.
  const rng = makeRng(world.seed + game.week * 7919 + game.homeId.length + game.awayId.length)
  const lines: Play[] = []
  // Home is allocated first, then away, exactly as before so the rng stream is
  // unchanged. R5: reconcile each offence's forced-miss total to the opponent's
  // missed-tackle total (they are the same plays).
  const homeAlloc = allocateTeamGame(world, game.homeId, game.homeScore, game.awayScore, rng, `${game.week}:${game.homeId}`)
  const awayAlloc = allocateTeamGame(world, game.awayId, game.awayScore, game.homeScore, rng, `${game.week}:${game.awayId}`)
  reconcileForced(homeAlloc.offense, awayAlloc.defMissed, `${game.week}:${game.homeId}:frc`)
  reconcileForced(awayAlloc.offense, homeAlloc.defMissed, `${game.week}:${game.awayId}:frc`)
  // R7/R9: coverage allowed and pressures generated by each defence, from the
  // opponent's passing production. Deterministic, so the rng stream is unchanged.
  allocateCoverageAndPressure(world, homeAlloc, awayAlloc, `${game.week}:${game.homeId}:cov`)
  allocateCoverageAndPressure(world, awayAlloc, homeAlloc, `${game.week}:${game.awayId}:cov`)
  const sim: GameSim = {
    homeId: game.homeId,
    awayId: game.awayId,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    plays: lines,
    stats: {
      home: { plays: 60, points: game.homeScore, passAtt: 0, passComp: 0, passYds: 0, passTD: 0, ints: 0, rushAtt: 0, rushYds: 0, rushTD: 0, sacks: 3, sacksTaken: 3, firstDowns: 20, thirdDownAtt: 12, thirdDownConv: 5, fumbles: 0, td: 0, fgAtt: 2, fgMade: 1, twoAtt: 0, twoMade: 0, top: 1800 },
      away: { plays: 60, points: game.awayScore, passAtt: 0, passComp: 0, passYds: 0, passTD: 0, ints: 0, rushAtt: 0, rushYds: 0, rushTD: 0, sacks: 3, sacksTaken: 3, firstDowns: 20, thirdDownAtt: 12, thirdDownConv: 5, fumbles: 0, td: 0, fgAtt: 2, fgMade: 1, twoAtt: 0, twoMade: 0, top: 1800 },
    },
    generated: true,
    homeLines: homeAlloc.lines,
    awayLines: awayAlloc.lines,
  }
  recordAllocatedStats(world, sim, season, level)
}

/** Fold allocated lines into career stats (mirrors stats.recordGameStats). */
function recordAllocatedStats(world: World, sim: GameSim, season: number, level: 'NFL' | 'CFB') {
  for (const teamId of [sim.homeId, sim.awayId]) {
    const lines = teamId === sim.homeId ? sim.homeLines ?? [] : sim.awayLines ?? []
    // A player can have several lines in one game (e.g. a back's rushing and
    // receiving lines) — he still played one game.
    const counted = new Set<string>()
    for (const { playerId, line } of lines) {
      const p = world.players.find((x) => x.id === playerId)
      if (!p) continue
      const entry = currentSeason(p, season, level, teamId)
      if (!counted.has(playerId)) {
        counted.add(playerId)
        entry.games += 1
      }
      entry.passAtt += line.passAtt ?? 0
      entry.passComp += line.passComp ?? 0
      entry.passYds += line.passYds ?? 0
      entry.passTD += line.passTD ?? 0
      entry.ints += line.ints ?? 0
      entry.rushAtt += line.rushAtt ?? 0
      entry.rushYds += line.rushYds ?? 0
      entry.rushTD += line.rushTD ?? 0
      entry.targets += line.targets ?? 0
      entry.rec += line.rec ?? 0
      entry.recYds += line.recYds ?? 0
      entry.recTD += line.recTD ?? 0
      entry.tackles += line.tackles ?? 0
      entry.defSacks += line.defSacks ?? 0
      entry.defInts += line.defInts ?? 0
      // R5: fold the new defensive/offensive bookkeeping into the season line too.
      entry.missedTackles = (entry.missedTackles ?? 0) + (line.missedTackles ?? 0)
      entry.forcedMissed = (entry.forcedMissed ?? 0) + (line.forcedMissed ?? 0)
      entry.drops = (entry.drops ?? 0) + (line.drops ?? 0)
      // R6: returns and defensive touchdowns.
      entry.kickRet = (entry.kickRet ?? 0) + (line.kickRet ?? 0)
      entry.kickRetYds = (entry.kickRetYds ?? 0) + (line.kickRetYds ?? 0)
      entry.puntRet = (entry.puntRet ?? 0) + (line.puntRet ?? 0)
      entry.puntRetYds = (entry.puntRetYds ?? 0) + (line.puntRetYds ?? 0)
      entry.retTD = (entry.retTD ?? 0) + (line.retTD ?? 0)
      entry.defTD = (entry.defTD ?? 0) + (line.defTD ?? 0)
      // R7/R8: pressure credit (defence) and sacks taken / pressures faced (QB).
      entry.prs = (entry.prs ?? 0) + (line.prs ?? 0)
      entry.qbHits = (entry.qbHits ?? 0) + (line.qbHits ?? 0)
      entry.hurries = (entry.hurries ?? 0) + (line.hurries ?? 0)
      entry.sk = (entry.sk ?? 0) + (line.sk ?? 0)
      entry.sky = (entry.sky ?? 0) + (line.sky ?? 0)
      entry.pressured = (entry.pressured ?? 0) + (line.pressured ?? 0)
      // R9: coverage allowed, so simmed seasons show REC allowed / YDS ALW / COV.
      entry.defTargets = (entry.defTargets ?? 0) + (line.defTargets ?? 0)
      entry.defComp = (entry.defComp ?? 0) + (line.defComp ?? 0)
      entry.defYdsAllowed = (entry.defYdsAllowed ?? 0) + (line.defYdsAllowed ?? 0)
      entry.defTDAllowed = (entry.defTDAllowed ?? 0) + (line.defTDAllowed ?? 0)
      entry.defIntsCov = (entry.defIntsCov ?? 0) + (line.defIntsCov ?? 0)
    }
  }
}

export { recordGameStats }

/**
 * Dev-only probe (R7/R8/R9): run the fast allocator over fabricated games and
 * report per-team-per-game coverage / pressure / sack rates so they can be checked
 * against the play-by-play. Pure: it records nothing and consumes its own rng.
 */
export function allocProbe(world: World, games = 200) {
  const rng = makeRng(world.seed + 424242)
  const teams = world.teams.filter((t) => t.tier === 'NFL')
  let covTgt = 0
  let covComp = 0
  let covYds = 0
  let covTD = 0
  let covInt = 0
  let prs = 0
  let qbh = 0
  let hur = 0
  let sck = 0
  let sk = 0
  let sky = 0
  let pressured = 0
  let dropbacks = 0
  let gamesRun = 0
  const offTotals = (lines: { playerId: string; line: GameStatLine }[]) => {
    let att = 0
    let sacksTaken = 0
    for (const { playerId, line } of lines) {
      const p = world.players.find((x) => x.id === playerId)
      if (p?.pos === 'QB') { att += line.passAtt ?? 0; sacksTaken += line.sk ?? 0 }
    }
    return att + sacksTaken
  }
  for (let i = 0; i < games; i++) {
    const h = teams[i % teams.length]
    const a = teams[(i * 7 + 3) % teams.length]
    if (!h || !a || h.id === a.id) continue
    const hs = 17 + Math.floor(rng() * 21)
    const as = 17 + Math.floor(rng() * 21)
    const ha = allocateTeamGame(world, h.id, hs, as, rng, `probe:${i}:h`)
    const aa = allocateTeamGame(world, a.id, as, hs, rng, `probe:${i}:a`)
    allocateCoverageAndPressure(world, ha, aa, `probe:${i}:hc`)
    allocateCoverageAndPressure(world, aa, ha, `probe:${i}:ac`)
    dropbacks += offTotals(ha.offense) + offTotals(aa.offense)
    for (const { line } of [...ha.lines, ...aa.lines]) {
      covTgt += line.defTargets ?? 0
      covComp += line.defComp ?? 0
      covYds += line.defYdsAllowed ?? 0
      covTD += line.defTDAllowed ?? 0
      covInt += line.defIntsCov ?? 0
      prs += line.prs ?? 0
      qbh += line.qbHits ?? 0
      hur += line.hurries ?? 0
      sck += line.defSacks ?? 0
      sk += line.sk ?? 0
      sky += line.sky ?? 0
      pressured += line.pressured ?? 0
    }
    gamesRun += 2
  }
  const per = (x: number) => +(x / (gamesRun || 1)).toFixed(2)
  return {
    games: gamesRun,
    coverage: { targets: per(covTgt), comp: per(covComp), yds: per(covYds), td: per(covTD), ints: per(covInt) },
    pressures: per(prs),
    qbHits: per(qbh),
    hurries: per(hur),
    sacks: per(sck),
    qbSacks: per(sk),
    qbSackYds: +(sky / (gamesRun || 1)).toFixed(1),
    pressured: per(pressured),
    pressureRatePct: +((prs / (dropbacks || 1)) * 100).toFixed(1),
  }
}
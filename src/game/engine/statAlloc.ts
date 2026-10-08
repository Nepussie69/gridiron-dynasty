// ─────────────────────────────────────────────────────────────────────────────
// League-wide stat allocation.
//
// Simulating play-by-play for all ~2,000 games a season would be far too slow.
// Instead we give every game a score (fast sim) and then distribute that game's
// realistic team totals across the roster, weighted by talent, role, scheme fit,
// and playbook familiarity. The result: full league-wide box scores cheaply.
// ─────────────────────────────────────────────────────────────────────────────

import type { GameStatLine, Player, Position } from '../types'
import { attributesFor } from '../data/ratings'
import { coachEffect } from './coaching'
import { depthGroup } from './depth'
import type { Game, World } from './generate'
import { clamp, makeRng, type Rng } from './rng'
import { currentSeason, recordGameStats } from './stats'
import type { GameSim, Play } from './playsim'

import { leagueMasteryMeans, masteryGroup, type MasteryMeans } from './playbook'
import { styleProfile } from './style'

const POS_SIDE: Record<string, 'OFF' | 'DEF' | 'ST'> = {
  QB: 'OFF', RB: 'OFF', WR: 'OFF', TE: 'OFF', OT: 'OFF', OG: 'OFF', C: 'OFF',
  DE: 'DEF', DT: 'DEF', LB: 'DEF', CB: 'DEF', S: 'DEF', K: 'ST', P: 'ST',
}

function mkAttrs(p: Player): Record<string, number> {
  return { ...attributesFor(p.id, p.pos, p.ovr), ...(p.attrs ?? {}) }
}

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
 * Allocate one team's game production to its players.
 * Uses realistic team totals derived from the scoreline.
 */
export function allocateTeamGame(
  world: World,
  teamId: string,
  points: number,
  _opponentPoints: number,
  rng: Rng,
): { playerId: string; line: GameStatLine }[] {
  const scheme = (world.staff[teamId] ?? []).find((s) => s.role === 'Offensive Coordinator')?.scheme ?? ''
  const eff = coachEffect(world, teamId)
  const means = leagueMasteryMeans(world)
  const out: { playerId: string; line: GameStatLine }[] = []
  const addLine = (playerId: string, line: GameStatLine) => out.push({ playerId, line })

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
    const td = Math.max(0, Math.round((points / 7) * 0.72 * (0.7 + rng() * 0.6)))
    const ints = rng() < 0.42 ? (rng() < 0.7 ? 1 : 2) : 0
    addLine(qb.id, {
      playerId: qb.id, passAtt: att, passComp: comp, passYds, passTD: td, ints,
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
    const rushTd = Math.max(0, Math.round((points / 7) * 0.28 * (0.6 + rng() * 0.8)))
    const qbTd = qb && carries > 0 ? Math.min(rushTd, Math.round((rushTd * qbCarries) / carries)) : 0
    const tdSplit = split(rng, rushTd - qbTd, shares)
    rbs.items.forEach((p, i) => addLine(p.id, { playerId: p.id, rushAtt: split_[i] ?? 0, rushYds: yardsSplit[i] ?? 0, rushTD: tdSplit[i] ?? 0 }))
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
  const recvs = group(world, teamId, ['WR', 'TE', 'RB'], 6, 'rec', scheme, means)
  if (recvs.items.length && qb) {
    const completions = Math.round(passYds / (isNFL ? 9.6 : 10.5))
    const shares = recvs.weights
    const recSplit = split(rng, completions, shares)
    const yardSplit = split(rng, passYds, shares)
    const td = Math.max(0, Math.round((points / 7) * 0.72 * 0.9))
    const tdSplit = split(rng, td, shares)
    recvs.items.forEach((p, i) =>
      addLine(p.id, {
        playerId: p.id,
        targets: recSplit[i] + (rng() < 0.5 ? 1 : 0),
        rec: recSplit[i] ?? 0,
        recYds: yardSplit[i] ?? 0,
        recTD: tdSplit[i] ?? 0,
      }),
    )
  }

  // ── Defense ──
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
    defenders.forEach((p) => {
      const ri = rushers.indexOf(p)
      const di = dbGroup.indexOf(p)
      addLine(p.id, {
        playerId: p.id,
        tackles: tSplit[defenders.indexOf(p)] ?? 0,
        defSacks: ri >= 0 ? sSplit[ri] ?? 0 : 0,
        defInts: di >= 0 ? iSplit[di] ?? 0 : 0,
      })
    })
  }

  return out
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
    homeLines: allocateTeamGame(world, game.homeId, game.homeScore, game.awayScore, rng),
    awayLines: allocateTeamGame(world, game.awayId, game.awayScore, game.homeScore, rng),
  }
  recordAllocatedStats(world, sim, season, level)
}

/** Fold allocated lines into career stats (mirrors stats.recordGameStats). */
function recordAllocatedStats(world: World, sim: GameSim, season: number, level: 'NFL' | 'CFB') {
  for (const teamId of [sim.homeId, sim.awayId]) {
    const lines = teamId === sim.homeId ? sim.homeLines ?? [] : sim.awayLines ?? []
    for (const { playerId, line } of lines) {
      const p = world.players.find((x) => x.id === playerId)
      if (!p) continue
      const entry = currentSeason(p, season, level, teamId)
      entry.games += 1
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
    }
  }
}

export { recordGameStats }

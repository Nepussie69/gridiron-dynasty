// ─────────────────────────────────────────────────────────────────────────────
// Player stat accumulation.
//
// Turns a simulated game's play log into per-player box-score lines, then folds
// those lines into each player's career stats (one SeasonStats per pro season).
// ─────────────────────────────────────────────────────────────────────────────

import type { GameStatLine, Player, SeasonStats, StatLevel } from '../types'
import { emptySeason } from '../types'
import type { GameSim } from './playsim'
import type { Play } from './playsim'
import type { World } from './generate'

export interface PlayerBoxScore {
  playerId: string
  name: string
  pos: string
  teamId: string
  line: GameStatLine
}

/**
 * L11.5 Q7: standard NFL passer rating from any passing line (game or season).
 * Returns 0 when the player has no attempts.
 */
export function passerRating(line: { passAtt?: number; passComp?: number; passYds?: number; passTD?: number; ints?: number }): number {
  const att = line.passAtt ?? 0
  if (att <= 0) return 0
  const comp = line.passComp ?? 0
  const yds = line.passYds ?? 0
  const td = line.passTD ?? 0
  const ints = line.ints ?? 0
  const term = (x: number) => Math.max(0, Math.min(2.375, x))
  const a = term((comp / att - 0.3) * 5)
  const b = term((yds / att - 3) * 0.25)
  const c = term((td / att) * 20)
  const d = term(2.375 - (ints / att) * 25)
  return Math.round(((a + b + c + d) / 6) * 1000) / 10
}

/**
 * L12 R4b: coverage grade 0–100 from a defender's coverage line (game or season).
 * `null` when the defender was never targeted. Built on the passer rating the
 * coverage allowed, plus a bonus for interceptions made in coverage.
 */
export function coverageGrade(line: {
  defTargets?: number
  defComp?: number
  defYdsAllowed?: number
  defTDAllowed?: number
  defIntsCov?: number
}): number | null {
  const att = line.defTargets ?? 0
  if (att <= 0) return null
  const ratingAllowed = passerRating({
    passAtt: att,
    passComp: line.defComp ?? 0,
    passYds: line.defYdsAllowed ?? 0,
    passTD: line.defTDAllowed ?? 0,
    ints: line.defIntsCov ?? 0,
  })
  const intsCov = line.defIntsCov ?? 0
  // Anchored on the passer-rating floor (39.6 = every target incomplete) and ceiling (158.3):
  // 0/5 targets → 95, 6/7 for 110 yds and a TD → 27. Each interception in coverage adds 4.
  return Math.max(0, Math.min(100, Math.round(95 - (ratingAllowed - 39.6) * 0.573 + 4 * intsCov)))
}

/** Aggregate a game's plays into per-player lines for both teams. */
export function boxScore(world: World, sim: GameSim): PlayerBoxScore[] {
  const byId: Record<string, GameStatLine> = {}
  const meta: Record<string, { teamId: string; name: string; pos: string }> = {}
  const ensure = (id: string | undefined, teamId: string): GameStatLine | null => {
    if (!id) return null
    if (!byId[id]) {
      const p = world.players.find((x) => x.id === id)
      byId[id] = { playerId: id }
      meta[id] = { teamId, name: p?.name ?? '—', pos: p?.pos ?? '—' }
    }
    return byId[id]
  }
  const add = (id: string | undefined, teamId: string, key: keyof GameStatLine, n: number) => {
    const line = ensure(id, teamId)
    if (!line) return
    const rec = line as unknown as Record<string, number | undefined>
    rec[key] = (rec[key] ?? 0) + n
  }

  for (const play of sim.plays) {
    if (play.type === 'end' || play.type === 'penalty') continue
    const off = play.offId
    const def = play.defId

    // R6: a takeaway returned for a touchdown (pick-six / fumble return).
    if (play.defTD && play.scorerId) add(play.scorerId, def, 'defTD', 1)
    // R6: kickoff returns — the receiving club is `off` on a kickoff play.
    if (play.type === 'kickoff') {
      if (play.returnKind === 'return' && play.returnerId) {
        add(play.returnerId, off, 'kickRet', 1)
        add(play.returnerId, off, 'kickRetYds', play.returnYards ?? 0)
        if (play.returnTD) add(play.returnerId, off, 'retTD', 1)
      }
      continue
    }
    // R6: punt returns — the receiving club is `def` on a punt play.
    if (play.type === 'punt') {
      if (play.returnKind === 'return' && play.returnerId) {
        add(play.returnerId, def, 'puntRet', 1)
        add(play.returnerId, def, 'puntRetYds', play.returnYards ?? 0)
        if (play.returnTD) add(play.returnerId, def, 'retTD', 1)
      }
      continue
    }

    // R16: a reception is a caught pass (including a catch that later came loose).
    // A deflected/muffed INTERCEPTION keeps `reception` unset, so it is never
    // credited as a completion; metadata alone distinguishes the two. The result
    // text is only a legacy fallback for play logs without the flag.
    const isComp = play.reception ?? (play.result === 'Complete' || play.result === 'Explosive play!' || play.result === 'TOUCHDOWN!' || (!!play.fumbleId && !play.intId) || (!!play.muffedCatch && !play.intId))
    if (play.type === 'pass') {
      const qb = play.qbId
      if (qb) {
        if (play.result === 'Complete' || play.result === 'Explosive play!' || play.result === 'Incomplete' || play.result.startsWith('Interception') || play.result === 'TOUCHDOWN!' || play.fumbleId || play.muffedCatch) {
          add(qb, off, 'passAtt', 1)
        }
        if (isComp) {
          add(qb, off, 'passComp', 1)
          add(qb, off, 'passYds', play.yards)
          if (play.result === 'TOUCHDOWN!') add(qb, off, 'passTD', 1)
        }
        if (play.result.startsWith('Interception')) add(qb, off, 'ints', 1)
        // R8: sacks taken by the QB (SK) and sack yards lost (SKY). A sack is not
        // a pass attempt and its yards are not subtracted from passing yards.
        if (/^Sack/.test(play.result)) {
          add(qb, off, 'sk', 1)
          add(qb, off, 'sky', Math.abs(play.yards ?? 0))
        }
        // R7: pressures the QB faced (denominator = pass attempts + SK, so the
        // "pressured %" column divides this by (passAtt + sk)).
        if (play.pressure) add(qb, off, 'pressured', 1)
      }
      // R7: one rusher is credited per pressure — sack, QB hit or hurry.
      if (play.pressureId && play.pressureType) {
        add(play.pressureId, def, 'prs', 1)
        if (play.pressureType === 'hit') add(play.pressureId, def, 'qbHits', 1)
        else if (play.pressureType === 'hurry') add(play.pressureId, def, 'hurries', 1)
      }
      if (play.sackId) {
        add(play.sackId, def, 'defSacks', 1)
        // Q7: a sack is a tackle for loss.
        add(play.sackId, def, 'tfl', 1)
      }
      if (play.intId) {
        add(play.intId, def, 'defInts', 1)
        add(play.intId, def, 'tackles', 1)
      }
      if (play.targetId) add(play.targetId, off, 'targets', 1)
      // R5: a targeted incompletion can be a drop by the receiver (result unchanged).
      if (play.dropId) add(play.dropId, off, 'drops', 1)
      if (play.carrierId && isComp && play.targetId === play.carrierId) {
        add(play.carrierId, off, 'rec', 1)
        add(play.carrierId, off, 'recYds', play.yards)
        if (play.result === 'TOUCHDOWN!') add(play.carrierId, off, 'recTD', 1)
      }
      // L12 S3: a completion is stopped by one defender (no credit on a score —
      // the resolver already withholds tackleIds there).
      if (isComp && play.tackleIds?.length) add(play.tackleIds[0], def, 'tackles', 1)
      // R5: the defender who whiffed is charged a missed tackle; the carrier
      // who broke it is credited with a forced miss.
      if (play.missedTackleIds?.length) for (const id of play.missedTackleIds) add(id, def, 'missedTackles', 1)
      if (play.forcedMissedIds?.length && play.carrierId) add(play.carrierId, off, 'forcedMissed', 1)
      // Q7: coverage credit goes to the defender on the target.
      if (play.coverId && play.targetId) {
        add(play.coverId, def, 'defTargets', 1)
        if (isComp) {
          add(play.coverId, def, 'defComp', 1)
          add(play.coverId, def, 'defYdsAllowed', Math.max(0, play.yards))
          // R4b: a pass TD caught on this defender.
          if (play.result === 'TOUCHDOWN!') add(play.coverId, def, 'defTDAllowed', 1)
        }
        // R4b: INTs credited to the coverage defender (distinct from the ball hawk).
        if (play.result.startsWith('Interception')) add(play.coverId, def, 'defIntsCov', 1)
      }
    } else if (play.type === 'run') {
      if (play.carrierId) {
        add(play.carrierId, off, 'rushAtt', 1)
        add(play.carrierId, off, 'rushYds', Math.max(0, play.yards))
        if (play.result === 'TOUCHDOWN!') add(play.carrierId, off, 'rushTD', 1)
      }
      // One tackler per run — the defense shares stops across the front seven.
      const t = play.tackleIds ?? []
      if (t.length) {
        const tackler = t[(play.n + play.yards + 10) % t.length]
        add(tackler, def, 'tackles', 1)
        // Q7: the tackler on a run for a loss also gets the TFL.
        if (play.yards < 0) add(tackler, def, 'tfl', 1)
      }
      // R5: charge the miss to the defender and credit the back who broke it.
      if (play.missedTackleIds?.length) for (const id of play.missedTackleIds) add(id, def, 'missedTackles', 1)
      if (play.forcedMissedIds?.length && play.carrierId) add(play.carrierId, off, 'forcedMissed', 1)
    }
  }

  // R15: attach in-game snap counts and snap share. Players who saw the field but
  // recorded no other stat (linemen, rotational defenders) still get a line, so the
  // season snap % is complete.
  if (sim.snaps && sim.snapSide) {
    const pmap = new Map(world.players.map((p) => [p.id, p]))
    const share = (id: string, teamId: string): { pct: number; side: number } | undefined => {
      const p = pmap.get(id)
      const side = p?.side
      if (side !== 'OFF' && side !== 'DEF') return undefined
      const counts = sim.snapSide![teamId]
      const base = side === 'OFF' ? counts?.off : counts?.def
      return base ? { pct: Math.round(((sim.snaps![id] ?? 0) / base) * 1000) / 10, side: base } : undefined
    }
    for (const [id, n] of Object.entries(sim.snaps)) {
      if (!n) continue
      const p = pmap.get(id)
      if (!p) continue
      const teamId = p.teamId ?? meta[id]?.teamId ?? ''
      const s = share(id, teamId)
      if (!s) continue
      const line = ensure(id, teamId)
      if (!line) continue
      line.snaps = n
      line.snapPct = s.pct
      line.snapSide = s.side
    }
  }

  return Object.entries(byId).map(([id, line]) => ({
    playerId: id,
    name: meta[id].name,
    pos: meta[id].pos,
    teamId: meta[id].teamId,
    line,
  }))
}

/** Total the game's yardage/TDs credited to one player (for season rollup). */
function mergeInto(season: SeasonStats, line: GameStatLine) {
  season.games += 1
  season.passAtt += line.passAtt ?? 0
  season.passComp += line.passComp ?? 0
  season.passYds += line.passYds ?? 0
  season.passTD += line.passTD ?? 0
  season.ints += line.ints ?? 0
  season.sacks += 0
  season.rushAtt += line.rushAtt ?? 0
  season.rushYds += line.rushYds ?? 0
  season.rushTD += line.rushTD ?? 0
  season.targets += line.targets ?? 0
  season.rec += line.rec ?? 0
  season.recYds += line.recYds ?? 0
  season.recTD += line.recTD ?? 0
  season.tackles += line.tackles ?? 0
  season.defSacks += line.defSacks ?? 0
  season.defInts += line.defInts ?? 0
  season.tfl = (season.tfl ?? 0) + (line.tfl ?? 0)
  // R4b: coverage fields, so the season coverage grade matches the game detail.
  season.defTargets = (season.defTargets ?? 0) + (line.defTargets ?? 0)
  season.defComp = (season.defComp ?? 0) + (line.defComp ?? 0)
  season.defYdsAllowed = (season.defYdsAllowed ?? 0) + (line.defYdsAllowed ?? 0)
  season.defTDAllowed = (season.defTDAllowed ?? 0) + (line.defTDAllowed ?? 0)
  season.defIntsCov = (season.defIntsCov ?? 0) + (line.defIntsCov ?? 0)
  // R5: missed tackles (defense) and forced missed tackles (offense).
  season.missedTackles = (season.missedTackles ?? 0) + (line.missedTackles ?? 0)
  season.forcedMissed = (season.forcedMissed ?? 0) + (line.forcedMissed ?? 0)
  season.drops = (season.drops ?? 0) + (line.drops ?? 0)
  // R6: kick/punt returns and defensive touchdowns.
  season.kickRet = (season.kickRet ?? 0) + (line.kickRet ?? 0)
  season.kickRetYds = (season.kickRetYds ?? 0) + (line.kickRetYds ?? 0)
  season.puntRet = (season.puntRet ?? 0) + (line.puntRet ?? 0)
  season.puntRetYds = (season.puntRetYds ?? 0) + (line.puntRetYds ?? 0)
  season.retTD = (season.retTD ?? 0) + (line.retTD ?? 0)
  season.defTD = (season.defTD ?? 0) + (line.defTD ?? 0)
  // R7/R8: pressures (defense) and sacks taken / pressures faced (passing).
  season.prs = (season.prs ?? 0) + (line.prs ?? 0)
  season.qbHits = (season.qbHits ?? 0) + (line.qbHits ?? 0)
  season.hurries = (season.hurries ?? 0) + (line.hurries ?? 0)
  season.sk = (season.sk ?? 0) + (line.sk ?? 0)
  season.sky = (season.sky ?? 0) + (line.sky ?? 0)
  season.pressured = (season.pressured ?? 0) + (line.pressured ?? 0)
  // R15: snaps are kept as a numerator/denominator pair so a season with some
  // unmeasured games is never biased toward zero (absent != no participation).
  season.snaps = (season.snaps ?? 0) + (line.snaps ?? 0)
  season.snapSide = (season.snapSide ?? 0) + (line.snapSide ?? 0)
  if (line.snapSide) season.snapPct = Math.round(((season.snaps ?? 0) / season.snapSide) * 1000) / 10
}

/** Get or create this season's stat line for a player at a level. */
export function currentSeason(p: Player, season: number, level: StatLevel, teamId: string): SeasonStats {
  if (!p.stats) p.stats = []
  let entry = p.stats.find((s) => s.season === season && s.level === level)
  if (!entry) {
    entry = emptySeason(season, level, teamId)
    // Track how long the player has been in this scheme, for playbook familiarity.
    const prev = [...p.stats].sort((a, b) => a.season - b.season).slice(-1)[0]
    const scheme = world_scheme(teamId, level)
    entry.scheme = scheme
    entry.teamSchemeYears = prev && prev.scheme === scheme ? (prev.teamSchemeYears ?? 0) + 1 : 1
    p.stats.push(entry)
  }
  return entry
}

// Set by the store each season so stat lines can record the scheme.
let SCHEME_LOOKUP: ((teamId: string, level: StatLevel) => string) | null = null
export function setSchemeLookup(fn: ((teamId: string, level: StatLevel) => string) | null) {
  SCHEME_LOOKUP = fn
}
function world_scheme(teamId: string, level: StatLevel): string {
  return SCHEME_LOOKUP ? SCHEME_LOOKUP(teamId, level) : ''
}

/** Fold a precomputed box score into every participating player's career stats. */
export function recordBoxLines(
  world: World,
  box: PlayerBoxScore[],
  season: number,
  level: StatLevel,
) {
  for (const b of box) {
    const p = world.players.find((x) => x.id === b.playerId)
    if (!p) continue
    const entry = currentSeason(p, season, level, b.teamId)
    mergeInto(entry, b.line)
  }
}

/** Fold a game's box score into every participating player's career stats. */
export function recordGameStats(world: World, sim: GameSim, season: number, level: StatLevel) {
  recordBoxLines(world, boxScore(world, sim), season, level)
}

/** Player lines that recorded any non-zero stat, for compact storage. */
export function boxPlayerLines(box: PlayerBoxScore[]): PlayerBoxScore[] {
  return box.filter((b) =>
    Object.entries(b.line).some(([k, v]) => k !== 'playerId' && typeof v === 'number' && v !== 0),
  )
}

/** Team totals for a box score, summed from its player lines. */
export function boxTeamTotals(box: PlayerBoxScore[]): Record<string, { passYds: number; rushYds: number; turnovers: number; sacks: number }> {
  const out: Record<string, { passYds: number; rushYds: number; turnovers: number; sacks: number }> = {}
  for (const b of box) {
    const t = (out[b.teamId] ??= { passYds: 0, rushYds: 0, turnovers: 0, sacks: 0 })
    t.passYds += b.line.passYds ?? 0
    t.rushYds += b.line.rushYds ?? 0
    t.turnovers += b.line.ints ?? 0
    t.sacks += b.line.defSacks ?? 0
  }
  return out
}

/** Career totals across pro seasons. */
export function careerTotals(p: Player) {
  const t = emptySeason(0, 'NFL', '')
  const seasons = p.stats ?? []
  for (const s of seasons) {
    t.games += s.games
    t.passAtt += s.passAtt; t.passComp += s.passComp; t.passYds += s.passYds
    t.passTD += s.passTD; t.ints += s.ints
    t.rushAtt += s.rushAtt; t.rushYds += s.rushYds; t.rushTD += s.rushTD
    t.targets += s.targets; t.rec += s.rec; t.recYds += s.recYds; t.recTD += s.recTD
    t.tackles += s.tackles; t.defSacks += s.defSacks; t.defInts += s.defInts
    t.tfl = (t.tfl ?? 0) + (s.tfl ?? 0)
    t.defTargets = (t.defTargets ?? 0) + (s.defTargets ?? 0)
    t.defComp = (t.defComp ?? 0) + (s.defComp ?? 0)
    t.defYdsAllowed = (t.defYdsAllowed ?? 0) + (s.defYdsAllowed ?? 0)
    t.defTDAllowed = (t.defTDAllowed ?? 0) + (s.defTDAllowed ?? 0)
    t.defIntsCov = (t.defIntsCov ?? 0) + (s.defIntsCov ?? 0)
    t.missedTackles = (t.missedTackles ?? 0) + (s.missedTackles ?? 0)
    t.forcedMissed = (t.forcedMissed ?? 0) + (s.forcedMissed ?? 0)
    t.drops = (t.drops ?? 0) + (s.drops ?? 0)
    t.kickRet = (t.kickRet ?? 0) + (s.kickRet ?? 0)
    t.kickRetYds = (t.kickRetYds ?? 0) + (s.kickRetYds ?? 0)
    t.puntRet = (t.puntRet ?? 0) + (s.puntRet ?? 0)
    t.puntRetYds = (t.puntRetYds ?? 0) + (s.puntRetYds ?? 0)
    t.retTD = (t.retTD ?? 0) + (s.retTD ?? 0)
    t.defTD = (t.defTD ?? 0) + (s.defTD ?? 0)
    t.prs = (t.prs ?? 0) + (s.prs ?? 0)
    t.qbHits = (t.qbHits ?? 0) + (s.qbHits ?? 0)
    t.hurries = (t.hurries ?? 0) + (s.hurries ?? 0)
    t.sk = (t.sk ?? 0) + (s.sk ?? 0)
    t.sky = (t.sky ?? 0) + (s.sky ?? 0)
    t.pressured = (t.pressured ?? 0) + (s.pressured ?? 0)
    t.snaps = (t.snaps ?? 0) + (s.snaps ?? 0)
    t.snapSide = (t.snapSide ?? 0) + (s.snapSide ?? 0)
  }
  if (t.snapSide) t.snapPct = Math.round(((t.snaps ?? 0) / t.snapSide) * 1000) / 10
  return t
}

/**
 * L12 R4c: this player's line for one season/level, or undefined if none.
 */
export function seasonLine(p: Player, season: number, level: StatLevel): SeasonStats | undefined {
  return p.stats?.find((s) => s.season === season && s.level === level)
}

/**
 * L12 R4c: the "main" stat for a player's position, used by the roster Stats tab
 * and the Overview "Stats" sort. Returns null when there is no line to show.
 */
export function mainStatValue(p: Player, s: SeasonStats | undefined): number | null {
  if (!s) return null
  switch (p.pos) {
    case 'QB':
      return s.passYds
    case 'RB':
      return s.rushYds
    case 'WR':
    case 'TE':
    case 'FB':
      return s.recYds
    case 'DE':
    case 'DT':
    case 'LB':
      return s.tackles
    case 'CB':
    case 'S': {
      const g = coverageGrade(s)
      return g != null ? g : s.defInts
    }
    case 'K':
      return (s as unknown as { fgMade?: number }).fgMade ?? null
    default:
      return 0
  }
}

export function statSummary(p: Player): string {
  const s = p.stats ?? []
  const nfl = s.filter((x) => x.level === 'NFL').reduce((a, x) => {
    a.passYds += x.passYds; a.rushYds += x.rushYds; a.recYds += x.recYds; a.td += x.passTD + x.rushTD + x.recTD
    return a
  }, { passYds: 0, rushYds: 0, recYds: 0, td: 0 })
  if (p.pos === 'QB') return `${nfl.passYds.toLocaleString()} pass yds · ${nfl.td} TD`
  if (p.pos === 'RB') return `${nfl.rushYds.toLocaleString()} rush yds · ${nfl.td} TD`
  if (p.pos === 'WR' || p.pos === 'TE') return `${nfl.recYds.toLocaleString()} rec yds · ${nfl.td} TD`
  return ''
}

export type { Play }

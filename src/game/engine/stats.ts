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
    if (play.type === 'end' || play.type === 'kickoff' || play.type === 'penalty') continue
    const off = play.offId
    const def = play.defId

    const isComp = play.result === 'Complete' || play.result === 'Explosive play!' || play.result === 'TOUCHDOWN!'
    if (play.type === 'pass') {
      const qb = play.qbId
      if (qb) {
        if (play.result === 'Complete' || play.result === 'Explosive play!' || play.result === 'Incomplete' || play.result === 'Interception!' || play.result === 'TOUCHDOWN!') {
          add(qb, off, 'passAtt', 1)
        }
        if (isComp) {
          add(qb, off, 'passComp', 1)
          add(qb, off, 'passYds', play.yards)
          if (play.result === 'TOUCHDOWN!') add(qb, off, 'passTD', 1)
        }
        if (play.result === 'Interception!') add(qb, off, 'ints', 1)
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
      if (play.carrierId && isComp && play.targetId === play.carrierId) {
        add(play.carrierId, off, 'rec', 1)
        add(play.carrierId, off, 'recYds', play.yards)
        if (play.result === 'TOUCHDOWN!') add(play.carrierId, off, 'recTD', 1)
      }
      // Q7: coverage credit goes to the defender on the target.
      if (play.coverId && play.targetId) {
        add(play.coverId, def, 'defTargets', 1)
        if (isComp) {
          add(play.coverId, def, 'defComp', 1)
          add(play.coverId, def, 'defYdsAllowed', Math.max(0, play.yards))
        }
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
  }
  return t
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

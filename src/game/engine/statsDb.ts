// ─────────────────────────────────────────────────────────────────────────────
// Career statistics database.
//
// A queryable record of team and individual production across every season of a
// career. Team seasons are snapshotted at year end; individual lines live on the
// players themselves and are indexed here.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player, SeasonStats, StatLevel } from '../types'
import { teamAvgOvr } from '../selectors'
import type { World } from './generate'

export interface TeamSeasonRecord {
  season: number
  level: StatLevel
  teamId: string
  teamName: string
  wins: number
  losses: number
  pointsFor: number
  pointsAgainst: number
  teamOvr: number
  playoffs: boolean
  champion: boolean
  confChampion?: boolean
}

export interface CareerDatabase {
  teams: TeamSeasonRecord[]
  /** Individual seasons indexed by player id for fast lookup. */
  players: Record<string, { name: string; pos: string; seasons: SeasonStats[] }>
}

export function newDatabase(): CareerDatabase {
  return { teams: [], players: {} }
}

/** Snapshot every team's season into the database at year end. */
export function recordTeamSeasons(
  world: World,
  db: CareerDatabase,
  opts: { playoffSeeds?: string[]; champion?: string } = {},
) {
  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    const rec = world.standings[t.id]
    if (!rec) continue
    db.teams.push({
      season: world.season,
      level: 'NFL',
      teamId: t.id,
      teamName: `${t.city} ${t.name}`,
      wins: rec.wins,
      losses: rec.losses,
      pointsFor: rec.pointsFor,
      pointsAgainst: rec.pointsAgainst,
      teamOvr: Math.round(teamAvgOvr(world.roster[t.id] ?? [])),
      playoffs: opts.playoffSeeds?.includes(t.id) ?? false,
      champion: opts.champion === t.id,
    })
  }
}

/** Index a player's season history into the database. */
export function recordPlayerSeasons(db: CareerDatabase, players: Player[]) {
  for (const p of players) {
    if (!p.stats?.length) continue
    db.players[p.id] = {
      name: p.name,
      pos: p.pos,
      seasons: p.stats.map((s) => ({ ...s })),
    }
  }
}

// ── Queries ──────────────────────────────────────────────────────────────────

export interface LeaderRow {
  playerId: string
  name: string
  pos: string
  team: string
  value: number
  season: number
  level: StatLevel
}

/** Single-season or career leaderboards for a given stat. */
export function leaderboard(
  world: World,
  db: CareerDatabase,
  stat: 'passYds' | 'passTD' | 'rushYds' | 'rushTD' | 'rec' | 'recYds' | 'recTD' | 'sacks' | 'ints' | 'tackles',
  opts: { season?: number; level?: StatLevel; career?: boolean; limit?: number } = {},
): LeaderRow[] {
  const limit = opts.limit ?? 25
  const offense = stat.startsWith('pass') || stat.startsWith('rush') || stat.startsWith('rec')
  const map = new Map<string, LeaderRow>()

  const addLine = (pid: string, line: SeasonStats, name: string, pos: string) => {
    const team = world.byId[line.teamId]
    const value = (line as unknown as Record<string, number>)[stat] ?? 0
    if (value <= 0) return
    if (opts.level && line.level !== opts.level) return
    if (opts.season && line.season !== opts.season) return
    const key = opts.career ? pid : `${pid}_${line.season}_${line.level}`
    const prev = map.get(key)
    map.set(key, {
      playerId: pid,
      name,
      pos,
      team: team ? (team.tier === 'NFL' ? team.name : team.name) : '—',
      value: opts.career ? (prev?.value ?? 0) + value : value,
      season: line.season,
      level: line.level,
    })
  }

  for (const p of world.players) {
    if (!p.stats?.length) continue
    if (offense && p.side !== 'OFF') continue
    if (!offense && p.side !== 'DEF') continue
    for (const line of p.stats) addLine(p.id, line, p.name, p.pos)
  }
  // Include retired players kept in the database.
  for (const [pid, entry] of Object.entries(db.players)) {
    if (world.players.some((p) => p.id === pid)) continue
    for (const line of entry.seasons) addLine(pid, line, entry.name, entry.pos)
  }

  return [...map.values()].sort((a, b) => b.value - a.value).slice(0, limit)
}

/** A team's season-by-season history. */
export function teamHistory(db: CareerDatabase, teamId: string): TeamSeasonRecord[] {
  return db.teams.filter((t) => t.teamId === teamId).sort((a, b) => a.season - b.season)
}

/** Franchise/Program record book: best and worst seasons, titles. */
export function recordBook(db: CareerDatabase, teamId: string) {
  const h = teamHistory(db, teamId)
  if (!h.length) return null
  const byWins = [...h].sort((a, b) => b.wins - a.wins)
  const titles = h.filter((s) => s.champion).length
  const playoffYears = h.filter((s) => s.playoffs).length
  return {
    seasons: h.length,
    titles,
    playoffYears,
    best: byWins[0],
    worst: byWins[byWins.length - 1],
    totalWins: h.reduce((s, x) => s + x.wins, 0),
    totalLosses: h.reduce((s, x) => s + x.losses, 0),
  }
}

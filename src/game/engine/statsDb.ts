// ─────────────────────────────────────────────────────────────────────────────
// Career statistics database.
//
// A queryable record of team and individual production across every season of a
// career. Team seasons are snapshotted at year end; individual lines live on the
// players themselves and are indexed here.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player, SeasonStats, StatLevel } from '../types'
import { teamAvgOvr } from '../selectors'
import { passerRating } from './stats'
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
  // ── L12.12 Y2: team offense and defense, summed at year end ────────────────
  /** Offense: passing / rushing / total yards and touchdowns, from the club's player lines. */
  passYds?: number
  rushYds?: number
  totalYds?: number
  passTD?: number
  rushTD?: number
  /** Offense: turnovers lost (interceptions thrown; fumbles are not tracked). */
  giveaways?: number
  /** Offense: sacks the club's passers took (from the opponents' defenders). */
  sacksTaken?: number
  /** Defense: yards/TDs allowed and takeaways/sacks, from the club's defenders + opponents. */
  ydsAllowed?: number
  passYdsAllowed?: number
  rushYdsAllowed?: number
  takeaways?: number
  sacks?: number
  defTD?: number
  /** L12.12 Y2: league ranks within the tier (1 = best of 32). */
  ranks?: { pf: number; pa: number; offYds: number; defYds: number }
}

/** L12.12 Y2: a club's computed season offense, defense and league ranks. */
export interface TeamSeasonStats {
  passYds: number
  rushYds: number
  totalYds: number
  passTD: number
  rushTD: number
  giveaways: number
  sacksTaken: number
  ydsAllowed: number
  passYdsAllowed: number
  rushYdsAllowed: number
  takeaways: number
  sacks: number
  ranks: { pf: number; pa: number; offYds: number; defYds: number }
}

/** One player's career index entry. Retired players live only here. */
export interface DbPlayer {
  name: string
  pos: string
  seasons: SeasonStats[]
  /** L12.16 H1: the season he left the league (set once, at that season's end). */
  retiredSeason?: number
  /** L12.16 H1: the highest OVR he was ever seen at, tracked each season end. */
  peakOvr?: number
  /** L12.16 H1: the club he finished with (from his last recorded season line). */
  lastTeam?: string
}

export interface CareerDatabase {
  teams: TeamSeasonRecord[]
  /** Individual seasons indexed by player id for fast lookup. */
  players: Record<string, DbPlayer>
}

export function newDatabase(): CareerDatabase {
  return { teams: [], players: {} }
}

/**
 * L12.12 Y2: every NFL club's season offense and defense, aggregated from the
 * players themselves and the season's matchups, with league ranks (1 = best).
 *
 * Offense is summed from the club's player season lines. Defense uses the club's
 * defenders' lines (sacks, takeaways) plus the opponents' production in each
 * meeting (yards allowed, sacks taken). Deterministic — no rng, no sim changes.
 * Used at year end by `recordTeamSeasons` and live by the History screen for the
 * season still in progress (which is never written to the database).
 */
export function teamSeasonStats(world: World, season: number): Record<string, TeamSeasonStats> {
  const nfl = world.teams.filter((t) => t.tier === 'NFL')
  const out: Record<string, TeamSeasonStats> = {}
  for (const t of nfl) {
    out[t.id] = {
      passYds: 0, rushYds: 0, totalYds: 0, passTD: 0, rushTD: 0, giveaways: 0, sacksTaken: 0,
      ydsAllowed: 0, passYdsAllowed: 0, rushYdsAllowed: 0, takeaways: 0, sacks: 0,
      ranks: { pf: 0, pa: 0, offYds: 0, defYds: 0 },
    }
  }

  // Offense + defenders' sacks/takeaways, summed from every player's line.
  for (const p of world.players) {
    const line = p.stats?.find((s) => s.season === season && s.level === 'NFL')
    if (!line) continue
    const agg = out[line.teamId]
    if (!agg) continue
    agg.passYds += line.passYds
    agg.rushYds += line.rushYds
    agg.passTD += line.passTD
    agg.rushTD += line.rushTD
    agg.giveaways += line.ints
    agg.sacks += line.defSacks
    agg.takeaways += line.defInts
  }

  // Yards allowed: attribute each opponent's per-game production to the meeting.
  const gamesPlayed = (teamId: string) => {
    const r = world.standings[teamId]
    return Math.max(1, (r?.wins ?? 0) + (r?.losses ?? 0) + (r?.ties ?? 0))
  }
  for (const g of world.schedule) {
    if (!g.played || g.tier !== 'NFL') continue
    for (const [a, b] of [[g.homeId, g.awayId], [g.awayId, g.homeId]] as const) {
      const mine = out[a]
      const theirs = out[b]
      if (!mine || !theirs) continue
      const gp = gamesPlayed(b)
      mine.passYdsAllowed += theirs.passYds / gp
      mine.rushYdsAllowed += theirs.rushYds / gp
      mine.sacksTaken += theirs.sacks / gp
    }
  }

  for (const t of nfl) {
    const s = out[t.id]
    s.passYds = Math.round(s.passYds)
    s.rushYds = Math.round(s.rushYds)
    s.totalYds = s.passYds + s.rushYds
    s.passYdsAllowed = Math.round(s.passYdsAllowed)
    s.rushYdsAllowed = Math.round(s.rushYdsAllowed)
    s.ydsAllowed = s.passYdsAllowed + s.rushYdsAllowed
    s.sacksTaken = Math.round(s.sacksTaken)
  }

  // Ranks within the tier (1 = best). PF / offense = high is best; PA / defense = low.
  const order = (fn: (id: string) => number, best: 'high' | 'low') => {
    const ids = nfl.map((t) => t.id).sort((a, b) => (best === 'high' ? fn(b) - fn(a) : fn(a) - fn(b)))
    const pos = new Map(ids.map((id, i) => [id, i + 1]))
    return (id: string) => pos.get(id) ?? 0
  }
  const pfRank = order((id) => world.standings[id]?.pointsFor ?? 0, 'high')
  const paRank = order((id) => world.standings[id]?.pointsAgainst ?? 0, 'low')
  const offRank = order((id) => out[id].totalYds, 'high')
  const defRank = order((id) => out[id].ydsAllowed, 'low')
  for (const t of nfl) {
    out[t.id].ranks = { pf: pfRank(t.id), pa: paRank(t.id), offYds: offRank(t.id), defYds: defRank(t.id) }
  }
  return out
}

/** Snapshot every team's season into the database at year end. */
export function recordTeamSeasons(
  world: World,
  db: CareerDatabase,
  opts: { playoffSeeds?: string[]; champion?: string } = {},
) {
  const stats = teamSeasonStats(world, world.season)
  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    const rec = world.standings[t.id]
    if (!rec) continue
    const s = stats[t.id]
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
      ...(s
        ? {
            passYds: s.passYds,
            rushYds: s.rushYds,
            totalYds: s.totalYds,
            passTD: s.passTD,
            rushTD: s.rushTD,
            giveaways: s.giveaways,
            sacksTaken: s.sacksTaken,
            ydsAllowed: s.ydsAllowed,
            passYdsAllowed: s.passYdsAllowed,
            rushYdsAllowed: s.rushYdsAllowed,
            takeaways: s.takeaways,
            sacks: s.sacks,
            ranks: { ...s.ranks },
          }
        : {}),
    })
  }
}

/** Index a player's season history into the database. */
export function recordPlayerSeasons(db: CareerDatabase, players: Player[]) {
  for (const p of players) {
    if (!p.stats?.length) continue
    // L12.16 H1: never lose the retirement metadata once set. A player is
    // re-indexed every season end, so his peak/retiredSeason must survive.
    const prior = db.players[p.id]
    db.players[p.id] = {
      name: p.name,
      pos: p.pos,
      seasons: p.stats.map((s) => ({ ...s })),
      ...(prior?.retiredSeason !== undefined ? { retiredSeason: prior.retiredSeason } : {}),
      ...(prior?.peakOvr !== undefined ? { peakOvr: prior.peakOvr } : {}),
      ...(prior?.lastTeam !== undefined ? { lastTeam: prior.lastTeam } : {}),
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
  stat: 'passYds' | 'passTD' | 'passerRating' | 'rushYds' | 'rushTD' | 'rec' | 'recYds' | 'recTD' | 'sacks' | 'ints' | 'tackles',
  opts: { season?: number; level?: StatLevel; career?: boolean; limit?: number } = {},
): LeaderRow[] {
  const limit = opts.limit ?? 25
  const offense = stat.startsWith('pass') || stat.startsWith('rush') || stat.startsWith('rec')
  const map = new Map<string, LeaderRow>()

  const addLine = (pid: string, line: SeasonStats, name: string, pos: string) => {
    const team = world.byId[line.teamId]
    const value = stat === 'passerRating' ? passerRating(line) : ((line as unknown as Record<string, number>)[stat] ?? 0)
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

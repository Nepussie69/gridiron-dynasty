import type { Player, PlayerOrigin, Team, TeamRecord } from './types'
import type { World } from './engine/generate'
import { summarizeCap } from './engine/cap'

export type League = World

/**
 * A short "fingerprint" for how a player got here (#5). Returns null unless the
 * move was YOURS — the game only points at things you did. `by` holds the
 * gmName stamped at the time of the move. When the player has since left your
 * club, the tag becomes "Your former player" instead of claiming the arrival.
 */
export function originTag(
  origin: PlayerOrigin | undefined,
  gmName: string,
  currentTeamId?: string | null,
  myTeamId?: string,
): string | null {
  if (!origin) return null
  const mine = origin.by != null && origin.by === gmName
  if (!mine) return null
  if (currentTeamId && myTeamId && currentTeamId !== myTeamId) return 'Your former player'
  switch (origin.kind) {
    case 'draft':
      return `Drafted by you · Rd ${origin.round ?? '?'}`
    case 'freeAgent':
      return 'Signed by you'
    case 'udfa':
      return 'Your UDFA find'
    case 'trade':
      return 'Traded for by you'
    default:
      return null
  }
}

/** Look up a player by id across the league (roster + full pool). */
export function playerById(league: World, playerId: string): Player | undefined {
  return league.players.find((p) => p.id === playerId)
}

export function teamName(t: Team) {
  return t.tier === 'NFL' ? `${t.city} ${t.name}` : t.name
}
export function shortName(t: Team) {
  return t.name
}

export function rosterOf(league: World, teamId: string): Player[] {
  return league.roster[teamId] ?? []
}

export function capUsed(players: Player[]) {
  return players.reduce((s, p) => s + p.contract.capHit, 0)
}

export function capSpace(league: World, teamId: string) {
  const summary = summarizeCap(league.roster[teamId] ?? [], league.deadMoney[teamId] ?? 0, league.season)
  return summary.space
}

export function capSummary(league: World, teamId: string) {
  return summarizeCap(league.roster[teamId] ?? [], league.deadMoney[teamId] ?? 0, league.season)
}

export function teamAvgOvr(players: Player[]) {
  if (!players.length) return 0
  const top = [...players].sort((a, b) => b.ovr - a.ovr)
  const core = top.slice(0, 22)
  return core.reduce((s, p) => s + p.ovr, 0) / core.length
}

export function offenseRating(players: Player[]) {
  const off = players.filter((p) => p.side === 'OFF')
  return off.length ? off.reduce((s, p) => s + p.ovr, 0) / off.length : 0
}
export function defenseRating(players: Player[]) {
  const def = players.filter((p) => p.side === 'DEF')
  return def.length ? def.reduce((s, p) => s + p.ovr, 0) / def.length : 0
}

export function recordOf(league: World, teamId: string): TeamRecord {
  return (
    league.standings[teamId] ?? {
      teamId, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, streak: 0,
    }
  )
}

export function recordStr(r: TeamRecord) {
  const base = `${r.wins}-${r.losses}`
  return r.ties ? `${base}-${r.ties}` : base
}

export function sortedByPosition(players: Player[]) {
  const order = ['QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'OG', 'C', 'DE', 'DT', 'LB', 'CB', 'S', 'K', 'P']
  return [...players].sort((a, b) => order.indexOf(a.pos) - order.indexOf(b.pos) || b.ovr - a.ovr)
}

export function positionNeeds(league: World, teamId: string, teams: Team[]) {
  const mine = league.roster[teamId] ?? []
  const needs: { pos: string; mine: number; league: number; gap: number }[] = []
  const positions = ['QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'OG', 'C', 'DE', 'DT', 'LB', 'CB', 'S']
  for (const pos of positions) {
    const mineAvg = avgAt(mine, pos)
    const others = teams
      .filter((t) => t.id !== teamId && t.tier === 'NFL')
      .map((t) => avgAt(league.roster[t.id] ?? [], pos))
    const leagueAvg = others.reduce((s, v) => s + v, 0) / (others.length || 1)
    needs.push({ pos, mine: mineAvg, league: leagueAvg, gap: mineAvg - leagueAvg })
  }
  return needs.sort((a, b) => a.gap - b.gap)
}

function avgAt(players: Player[], pos: string) {
  const at = players.filter((p) => p.pos === pos)
  if (!at.length) return 50
  return at.reduce((s, p) => s + p.ovr, 0) / at.length
}

/** The team's remaining/played games for the current season. */
export function scheduleFor(league: World, teamId: string) {
  const team = league.byId[teamId]
  const games = league.schedule
    .filter((g) => g.homeId === teamId || g.awayId === teamId)
    .map((g) => {
      const home = g.homeId === teamId
      const opponentId = home ? g.awayId : g.homeId
      return {
        week: g.week,
        id: g.id,
        opponentId,
        home,
        played: g.played,
        teamScore: home ? g.homeScore : g.awayScore,
        oppScore: home ? g.awayScore : g.homeScore,
      }
    })
    .sort((a, b) => a.week - b.week)
  return { team, out: games }
}

export function draftPickValue(pick: number) {
  return Math.max(1, Math.round(3000 * Math.pow(0.945, pick - 1)))
}

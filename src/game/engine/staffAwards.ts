// ─────────────────────────────────────────────────────────────────────────────
// Staff awards (L9 Z2).
//
// At the end of every regular season the league honours its front office and
// coaching staff: Executive, Coach and Assistant Coach of the Year, plus a
// Rising Star for the young climbers (you and the rivals you started with).
// Everything is computed from standings + staff + stored last-season wins, so
// it is fully deterministic — no rng anywhere.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState } from '../types'
import type { World } from './generate'
import { capabilities, isGM, isHeadCoach } from './capabilities'

export interface StaffAward {
  season: number
  award: string
  name: string
  teamId: string
  isUser: boolean
  line: string
}

export const EXEC_OF_YEAR = 'Executive of the Year'
export const COACH_OF_YEAR = 'Coach of the Year'
export const ASSISTANT_OF_YEAR = 'Assistant Coach of the Year'
export const RISING_STAR = 'Rising Star'

interface Entry {
  name: string
  teamId: string
  isUser: boolean
  score: number
  wins: number
  line: string
}

/** Higher score wins; ties go to the higher win total, then alphabetically. */
function best(entries: Entry[]): Entry {
  return entries.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.wins !== a.wins) return b.wins - a.wins
    return a.name.localeCompare(b.name)
  })[0]
}

/** Rank 1 = best. `ascending` is true when a lower value is better (e.g. PA). */
function ranks(ids: string[], value: (id: string) => number, ascending: boolean): Record<string, number> {
  const order = [...ids].sort((a, b) => (ascending ? value(a) - value(b) : value(b) - value(a)))
  const out: Record<string, number> = {}
  order.forEach((id, i) => (out[id] = i + 1))
  return out
}

/**
 * Compute this season's four staff awards. `objectivesDone` is the user's graded
 * objective count and `repGain` the overall reputation they gained this season,
 * both supplied by the season-review caller. Deterministic.
 */
export function computeStaffAwards(
  world: World,
  career: CareerState,
  objectivesDone: number,
  repGain: number,
): StaffAward[] {
  const nfl = world.teams.filter((t) => t.tier === 'NFL')
  const lastWins = world.lastWins ?? {}
  const winsFor = (id: string) => world.standings[id]?.wins ?? 0
  const lossesFor = (id: string) => world.standings[id]?.losses ?? 0
  // Missing lastWins → treat this season's improvement as 0.
  const improvement = (id: string) => winsFor(id) - (lastWins[id] ?? winsFor(id))
  const winScore = (id: string) => winsFor(id) + 0.5 * improvement(id)
  const out: StaffAward[] = []

  // ── Executive of the Year ──────────────────────────────────────────────────
  {
    const entries: Entry[] = nfl.map((t) => {
      const isUser = isGM(career) && career.teamId === t.id
      const gm = (world.staff[t.id] ?? []).find((s) => s.role === 'General Manager')
      return {
        name: isUser ? career.gmName : gm?.name ?? `${t.name} GM`,
        teamId: t.id,
        isUser,
        score: winScore(t.id),
        wins: winsFor(t.id),
        line: `${t.abbr} ${winsFor(t.id)}-${lossesFor(t.id)}`,
      }
    })
    const winner = best(entries)
    out.push({ season: world.season, award: EXEC_OF_YEAR, name: winner.name, teamId: winner.teamId, isUser: winner.isUser, line: winner.line })
  }

  // ── Coach of the Year ──────────────────────────────────────────────────────
  {
    const entries: Entry[] = nfl.map((t) => {
      const isUser = isHeadCoach(career) && career.teamId === t.id
      const hc = (world.staff[t.id] ?? []).find((s) => s.role === 'Head Coach')
      return {
        name: isUser ? career.gmName : hc?.name ?? `${t.name} Head Coach`,
        teamId: t.id,
        isUser,
        score: winScore(t.id),
        wins: winsFor(t.id),
        line: `${t.abbr} ${winsFor(t.id)}-${lossesFor(t.id)}`,
      }
    })
    const winner = best(entries)
    out.push({ season: world.season, award: COACH_OF_YEAR, name: winner.name, teamId: winner.teamId, isUser: winner.isUser, line: winner.line })
  }

  // ── Assistant Coach of the Year ────────────────────────────────────────────
  {
    const ids = nfl.map((t) => t.id)
    const offRank = ranks(ids, (id) => world.standings[id]?.pointsFor ?? 0, false)
    const defRank = ranks(ids, (id) => world.standings[id]?.pointsAgainst ?? 0, true)
    // A coordinator is the only rung whose plan scope is a single side.
    const isCoord = capabilities(career).planScope === 'own-side'
    const focus = career.unitFocus
    const entries: Entry[] = []
    for (const t of nfl) {
      const oc = (world.staff[t.id] ?? []).find((s) => s.role === 'Offensive Coordinator')
      const dc = (world.staff[t.id] ?? []).find((s) => s.role === 'Defensive Coordinator')
      const userOff = isCoord && career.teamId === t.id && (focus === 'off' || focus === 'both')
      const userDef = isCoord && career.teamId === t.id && (focus === 'def' || focus === 'both')
      entries.push({
        name: userOff ? career.gmName : oc?.name ?? `${t.name} OC`,
        teamId: t.id, isUser: userOff, score: 33 - offRank[t.id], wins: winsFor(t.id),
        line: `${t.abbr} offense ranked #${offRank[t.id]}`,
      })
      entries.push({
        name: userDef ? career.gmName : dc?.name ?? `${t.name} DC`,
        teamId: t.id, isUser: userDef, score: 33 - defRank[t.id], wins: winsFor(t.id),
        line: `${t.abbr} defense ranked #${defRank[t.id]}`,
      })
    }
    const winner = best(entries)
    out.push({ season: world.season, award: ASSISTANT_OF_YEAR, name: winner.name, teamId: winner.teamId, isUser: winner.isUser, line: winner.line })
  }

  // ── Rising Star: the user (while young) plus every low-level rival. ────────
  {
    const entries: Entry[] = []
    const userEligible =
      (career.path === 'personnel' && career.level <= 6) || (career.path === 'coach' && career.level <= 5)
    if (userEligible) {
      entries.push({
        name: career.gmName,
        teamId: career.teamId,
        isUser: true,
        // Same scale as a rival's single reputation delta: the average gain per
        // reputation dimension, plus 1.5 points per objective completed.
        score: Math.round((repGain / 5 + objectivesDone * 1.5) * 10) / 10,
        wins: winsFor(career.teamId),
        line: `${objectivesDone} objectives · ${repGain >= 0 ? '+' : ''}${repGain} rep`,
      })
    }
    for (const r of world.rivals.filter((x) => x.level <= 6)) {
      const gain = r.reputation - (r.prevReputation ?? r.reputation)
      entries.push({
        name: r.name,
        teamId: r.teamId,
        isUser: false,
        score: gain,
        wins: winsFor(r.teamId),
        line: `${gain >= 0 ? '+' : ''}${gain} reputation`,
      })
    }
    if (entries.length) {
      const winner = best(entries)
      out.push({ season: world.season, award: RISING_STAR, name: winner.name, teamId: winner.teamId, isUser: winner.isUser, line: winner.line })
    }
  }

  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Culture as a real system (#16; L12.9 K2).
//
// Culture grows from your leaders' character, your staff's leadership, and how
// long the group has stayed together (the cohesion system). On the market it pays
// out as a winning-culture discount: clubs that have won heaps recently, or field
// a top-5 unit on the player's side of the ball, get a small break on his asking
// price. The same rule applies to every club, AI included.
// ─────────────────────────────────────────────────────────────────────────────

import type { World } from './generate'
import type { Player } from '../types'
import { clamp } from './rng'
import { teamCohesion } from './playbook'
import { teamSeasonStats, type CareerDatabase, type TeamSeasonRecord } from './statsDb'

export function cultureScore(world: World, teamId: string, bonus = 0): number {
  const staff = world.staff[teamId] ?? []
  const leadership = staff.length ? staff.reduce((s, m) => s + m.rating, 0) / staff.length : 60
  const roster = world.roster[teamId] ?? []
  const core = [...roster].sort((a, b) => b.ovr - a.ovr).slice(0, 12)
  const char = core.length
    ? core.reduce((s, p) => {
        const c = p.character
        if (!c) return s + 60
        return s + (c.workEthic * 0.5 + c.maturity * 0.3 + (100 - c.offFieldRisk) * 0.2)
      }, 0) / core.length
    : 60
  const cohesion = teamCohesion(roster, world.staffTenure, teamId).avg * 100
  // L12.11: the user's own Leadership skill lifts his club's culture (0..4).
  return Math.round(clamp(leadership * 0.35 + char * 0.4 + cohesion * 0.25 + bonus, 0, 100))
}

export function cultureLabel(v: number): { label: string; tone: 'loss' | 'warn' | 'info' | 'win' } {
  if (v >= 82) return { label: 'Elite culture', tone: 'win' }
  if (v >= 68) return { label: 'Strong culture', tone: 'win' }
  if (v >= 52) return { label: 'Steady', tone: 'info' }
  if (v >= 38) return { label: 'Shaky', tone: 'warn' }
  return { label: 'Toxic', tone: 'loss' }
}

// ── L12.9 K2: winning-culture discount ───────────────────────────────────────

export interface ClubCulture {
  /** Winning history: ≥33 wins over the last 3 seasons, or 2+ playoff trips with a title. */
  winning: boolean
  winTotal: number
  /** A top-5 offense / defense in each of the last 2 seasons. */
  topOff: boolean
  topDef: boolean
  /** Human-readable reasons, for the FA / extension UI. */
  reasons: string[]
}

export interface CultureDiscount {
  /** Percent off the asking price: 0, 3, 4 or 6. */
  pct: number
  winning: boolean
  topUnit: boolean
  reasons: string[]
}

/** L12.12 ranks, falling back to points for/against when a record predates them. */
function ranksFor(db: CareerDatabase, rec: TeamSeasonRecord): { pf: number; pa: number; offYds: number; defYds: number } {
  if (rec.ranks) return rec.ranks
  const rows = db.teams.filter((r) => r.season === rec.season)
  const rank = (fn: (r: TeamSeasonRecord) => number) => {
    const sorted = [...rows].sort((a, b) => fn(a) - fn(b))
    return new Map(sorted.map((r, i) => [r.teamId, i + 1]))
  }
  const pf = rank((r) => -r.pointsFor)
  const pa = rank((r) => r.pointsAgainst)
  const offYds = rank((r) => -(r.totalYds ?? 0))
  const defYds = rank((r) => r.ydsAllowed ?? 0)
  return {
    pf: pf.get(rec.teamId) ?? 0,
    pa: pa.get(rec.teamId) ?? 0,
    offYds: offYds.get(rec.teamId) ?? 0,
    defYds: defYds.get(rec.teamId) ?? 0,
  }
}

/**
 * A club's winning-culture profile: has it won heaps lately, and does it field a
 * top-5 offense or defense? Pure — reads `statsDb` plus this season's record.
 */
export function clubCulture(world: World, db: CareerDatabase, teamId: string): ClubCulture {
  const season = world.season
  const hist = db.teams.filter((r) => r.teamId === teamId && r.level === 'NFL').sort((a, b) => a.season - b.season)
  const completed = hist.filter((r) => r.season < season)
  const prev1 = completed[completed.length - 1]
  const prev2 = completed[completed.length - 2]
  const currentWins = world.standings[teamId]?.wins ?? 0
  const winTotal = currentWins + (prev1?.wins ?? 0) + (prev2?.wins ?? 0)
  const winningByWins = winTotal >= 33
  const recent = [prev1, prev2].filter((r): r is TeamSeasonRecord => !!r)
  const playoffTrips = recent.filter((r) => r.playoffs).length
  const titleInSpan = recent.some((r) => r.champion || r.confChampion)
  const winningByTitles = playoffTrips >= 2 && titleInSpan
  const winning = winningByWins || winningByTitles

  // Unit excellence: top-5 in each of the last two seasons (this one + the last).
  const live = teamSeasonStats(world, season)[teamId]
  const unitSeasons: { pf: number; pa: number; offYds: number; defYds: number }[] = []
  if (live) unitSeasons.push(live.ranks)
  if (prev1) unitSeasons.push(ranksFor(db, prev1))
  const last2 = unitSeasons.slice(-2)
  const topOff = last2.length >= 2 && last2.every((r) => (r.offYds > 0 && r.offYds <= 5) || (r.pf > 0 && r.pf <= 5))
  const topDef = last2.length >= 2 && last2.every((r) => (r.defYds > 0 && r.defYds <= 5) || (r.pa > 0 && r.pa <= 5))

  const reasons: string[] = []
  if (winningByWins) reasons.push(`${winTotal} wins over the last 3 seasons`)
  else if (winningByTitles) reasons.push('deep playoff runs with a title')
  if (topOff) reasons.push('top-5 offense over the last 2 seasons')
  if (topDef) reasons.push('top-5 defense over the last 2 seasons')
  return { winning, winTotal, topOff, topDef, reasons }
}

/** Player side of the ball for the unit rule; special teams get the winning rule only. */
function playerSide(player: Player): 'off' | 'def' | 'st' {
  if (player.side === 'ST') return 'st'
  return player.side === 'DEF' ? 'def' : 'off'
}

/**
 * L12.9 K2 (user rule, 2026-10-08): the asking-price discount a club earns for
 * this player. Winning club −4%, a top unit on his side of the ball −3%, both
 * capped at −6%. Special teams only ever get the winning part. Never applies to
 * a club that does not qualify.
 */
export function discountFromClub(club: ClubCulture, player: Player): CultureDiscount {
  const side = playerSide(player)
  const topUnit = side === 'off' ? club.topOff : side === 'def' ? club.topDef : false
  let pct = 0
  if (club.winning) pct += 4
  if (topUnit) pct += 3
  if (pct > 6) pct = 6
  const reasons: string[] = []
  if (club.winning) reasons.push(club.reasons.find((r) => r.includes('wins over') || r.includes('playoff')) ?? 'winning culture')
  if (topUnit) reasons.push(side === 'off' ? 'top-5 offense over the last 2 seasons' : 'top-5 defense over the last 2 seasons')
  return { pct, winning: club.winning, topUnit, reasons }
}

/** Convenience: the discount for one player, computing the club's profile first. */
export function cultureDiscountFor(world: World, db: CareerDatabase, teamId: string, player: Player): CultureDiscount {
  return discountFromClub(clubCulture(world, db, teamId), player)
}

/** Every club that qualifies for a culture discount on at least one side. */
export function cultureQualifiedClubs(world: World, db: CareerDatabase): Set<string> {
  const out = new Set<string>()
  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    const c = clubCulture(world, db, t.id)
    if (c.winning || c.topOff || c.topDef) out.add(t.id)
  }
  return out
}

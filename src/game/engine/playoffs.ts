// NFL playoff picture + division standings.
//
// Seeds follow the real NFL format: the four division winners take seeds 1–4
// (ranked among themselves), and the three best non-division-winners are the
// wild cards (5–7). Division / conference / head-to-head records are derived
// from the played games in `world.schedule`, so nothing new is written to the
// save. Tiebreakers follow the NFL order, simplified and deterministic.
import { NFL_DIVISIONS } from '../data/nflTeams'
import type { World } from './generate'

/** NFL.com-style clinch markers. `null` when nothing is locked up yet. */
export type ClinchMarker = 'z' | 'y' | 'x' | 'e'

export interface TeamStanding {
  teamId: string
  wins: number
  losses: number
  ties: number
  /** Win percentage: (wins + 0.5·ties) / games. */
  pct: number
  divWins: number
  divLosses: number
  divTies: number
  divPct: number
  confWins: number
  confLosses: number
  confTies: number
  confPct: number
  pointsFor: number
  pointsAgainst: number
  diff: number
  /** + = win streak, - = losing streak, 0 = tie / none. */
  streak: number
  played: number
  remaining: number
  /** Wins + games remaining — the best record still reachable. */
  maxWins: number
  /** Games behind the reference club (division leader, #1 seed, or #7 seed). */
  gamesBack: number
  divisionWinner: boolean
  /** 1–7 for playoff clubs (or 1–16 in `conferenceStandings`), else null. */
  seed: number | null
  marker: ClinchMarker | null
}

export interface DivisionStanding {
  /** e.g. "AFC East" (same key as `NFL_DIVISIONS`). */
  division: string
  conference: string
  /** Leader first, then the rest by the division tiebreakers. */
  teams: TeamStanding[]
}

export interface PlayoffMatchup {
  high: TeamStanding
  low: TeamStanding
  label: string
}

export interface ConferencePicture {
  conference: string
  /** Seeds 1–7 in order (1–4 division winners, 5–7 wild cards). */
  seeds: TeamStanding[]
  /** The wild-card round as it would be played today: 2v7, 3v6, 4v5. */
  wildCard: PlayoffMatchup[]
  /** Clubs 8th and worse that are still alive, with games back of the #7 seed. */
  inTheHunt: TeamStanding[]
  /** Clubs already eliminated. */
  eliminated: TeamStanding[]
}

// ── Internal per-club table ───────────────────────────────────────────────────
interface Row {
  teamId: string
  conf: string
  division: string
  wins: number
  losses: number
  ties: number
  pf: number
  pa: number
  streak: number
  divW: number
  divL: number
  divT: number
  confW: number
  confL: number
  confT: number
  remaining: number
  beaten: string[]
  sov: number
  seed: number | null
  divisionWinner: boolean
  marker: ClinchMarker | null
}

interface VsEntry {
  w: number
  l: number
  t: number
}

interface Table {
  rows: Map<string, Row>
  vs: Map<string, VsEntry>
}

function pct(w: number, l: number, t: number): number {
  const g = w + l + t
  return g ? (w + 0.5 * t) / g : 0
}

/** Walk the played games once and tally everything we need. */
function buildTable(world: World): Table {
  const rows = new Map<string, Row>()
  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    const rec = world.standings[t.id]
    rows.set(t.id, {
      teamId: t.id,
      conf: t.conference,
      division: t.division ?? '',
      wins: rec?.wins ?? 0,
      losses: rec?.losses ?? 0,
      ties: rec?.ties ?? 0,
      pf: rec?.pointsFor ?? 0,
      pa: rec?.pointsAgainst ?? 0,
      streak: rec?.streak ?? 0,
      divW: 0, divL: 0, divT: 0,
      confW: 0, confL: 0, confT: 0,
      remaining: 0,
      beaten: [],
      sov: 0,
      seed: null,
      divisionWinner: false,
      marker: null,
    })
  }

  const vs = new Map<string, VsEntry>()
  const bumpVs = (a: string, b: string, kind: 'w' | 'l' | 't') => {
    const k = `${a}|${b}`
    const e = vs.get(k) ?? { w: 0, l: 0, t: 0 }
    e[kind] += 1
    vs.set(k, e)
  }

  for (const g of world.schedule) {
    const home = rows.get(g.homeId)
    const away = rows.get(g.awayId)
    if (!home || !away) continue
    const hs = g.homeScore
    const as = g.awayScore
    if (!g.played || hs == null || as == null) {
      home.remaining += 1
      away.remaining += 1
      continue
    }
    const homeWin = hs > as
    const awayWin = as > hs
    const tie = hs === as
    bumpVs(g.homeId, g.awayId, homeWin ? 'w' : tie ? 't' : 'l')
    bumpVs(g.awayId, g.homeId, awayWin ? 'w' : tie ? 't' : 'l')
    if (homeWin) home.beaten.push(g.awayId)
    if (awayWin) away.beaten.push(g.homeId)

    if (home.conf === away.conf && home.division === away.division) {
      if (homeWin) { home.divW += 1; away.divL += 1 }
      else if (awayWin) { away.divW += 1; home.divL += 1 }
      else { home.divT += 1; away.divT += 1 }
    }
    if (home.conf === away.conf) {
      if (homeWin) { home.confW += 1; away.confL += 1 }
      else if (awayWin) { away.confW += 1; home.confL += 1 }
      else { home.confT += 1; away.confT += 1 }
    }
  }

  // Strength of victory = combined win % of the clubs this team beat.
  for (const r of rows.values()) {
    r.sov = r.beaten.reduce((sum, id) => {
      const opp = rows.get(id)
      return sum + (opp ? pct(opp.wins, opp.losses, opp.ties) : 0)
    }, 0)
  }

  return { rows, vs }
}

/** Head-to-head win % for each club, or null if they never met. */
function headToHead(a: string, b: string, vs: Map<string, VsEntry>): { a: number; b: number } | null {
  const ab = vs.get(`${a}|${b}`)
  const ba = vs.get(`${b}|${a}`)
  if (!ab && !ba) return null
  const games = (ab?.w ?? 0) + (ab?.l ?? 0) + (ab?.t ?? 0)
  if (!games) return null
  return { a: pct(ab?.w ?? 0, ab?.l ?? 0, ab?.t ?? 0), b: pct(ba?.w ?? 0, ba?.l ?? 0, ba?.t ?? 0) }
}

/**
 * NFL tiebreaker order, simplified and deterministic:
 * win % → head-to-head → division record (division ties) → conference record →
 * strength of victory → point differential → team id.
 */
function compare(a: Row, b: Row, division: boolean, vs: Map<string, VsEntry>): number {
  const pa = pct(a.wins, a.losses, a.ties)
  const pb = pct(b.wins, b.losses, b.ties)
  if (Math.abs(pb - pa) > 1e-9) return pb - pa

  const h = headToHead(a.teamId, b.teamId, vs)
  if (h && Math.abs(h.b - h.a) > 1e-9) return h.b - h.a

  if (division) {
    const da = pct(a.divW, a.divL, a.divT)
    const db = pct(b.divW, b.divL, b.divT)
    if (Math.abs(db - da) > 1e-9) return db - da
  }

  const ca = pct(a.confW, a.confL, a.confT)
  const cb = pct(b.confW, b.confL, b.confT)
  if (Math.abs(cb - ca) > 1e-9) return cb - ca
  if (Math.abs(b.sov - a.sov) > 1e-9) return b.sov - a.sov
  if (b.pf - b.pa !== a.pf - a.pa) return b.pf - b.pa - (a.pf - a.pa)
  return a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0
}

/**
 * Turn a current record into NFL.com's markers using max-possible-wins math.
 * Conservative: a club is only marked when its finish is guaranteed even if
 * every tiebreaker went against it.
 */
function computeMarkers(confRows: Row[]): void {
  for (const t of confRows) {
    const maxWins = t.wins + t.remaining
    let canReach = 0
    let canReachInDivision = 0
    let canReachOutside = 0
    let alreadyAhead = 0
    let rivalAhead = false
    for (const u of confRows) {
      if (u.teamId === t.teamId) continue
      const uMax = u.wins + u.remaining
      if (uMax >= t.wins) {
        canReach += 1
        if (u.division === t.division) canReachInDivision += 1
        else canReachOutside += 1
      }
      if (u.wins > maxWins) {
        alreadyAhead += 1
        if (u.division === t.division) rivalAhead = true
      }
    }
    if (canReach === 0) t.marker = 'z'
    else if (canReachInDivision === 0) t.marker = 'y'
    else if (canReachOutside <= 2) t.marker = 'x'
    else if (rivalAhead && alreadyAhead >= 7) t.marker = 'e'
    else t.marker = null
  }
}

/** Seed + mark one conference, mutating the rows with `seed`/`divisionWinner`. */
function seedConference(table: Table, conf: string): { seeds: Row[]; confRows: Row[] } {
  const confRows = [...table.rows.values()].filter((r) => r.conf === conf)
  computeMarkers(confRows)

  const byDivision = new Map<string, Row[]>()
  for (const r of confRows) {
    const list = byDivision.get(r.division) ?? []
    list.push(r)
    byDivision.set(r.division, list)
  }

  const winners: Row[] = []
  const others: Row[] = []
  for (const div of [...byDivision.keys()].sort()) {
    const group = [...byDivision.get(div)!].sort((a, b) => compare(a, b, true, table.vs))
    group[0].divisionWinner = true
    winners.push(group[0])
    others.push(...group.slice(1))
  }

  const leaders = [...winners].sort((a, b) => compare(a, b, false, table.vs))
  const wildCards = [...others].sort((a, b) => compare(a, b, false, table.vs)).slice(0, 3)
  const seeds = [...leaders, ...wildCards]
  seeds.forEach((r, i) => {
    r.seed = i + 1
  })
  return { seeds, confRows }
}

function toStanding(r: Row, gamesBack: number): TeamStanding {
  const played = r.wins + r.losses + r.ties
  return {
    teamId: r.teamId,
    wins: r.wins,
    losses: r.losses,
    ties: r.ties,
    pct: pct(r.wins, r.losses, r.ties),
    divWins: r.divW,
    divLosses: r.divL,
    divTies: r.divT,
    divPct: pct(r.divW, r.divL, r.divT),
    confWins: r.confW,
    confLosses: r.confL,
    confTies: r.confT,
    confPct: pct(r.confW, r.confL, r.confT),
    pointsFor: r.pf,
    pointsAgainst: r.pa,
    diff: r.pf - r.pa,
    streak: r.streak,
    played,
    remaining: r.remaining,
    maxWins: r.wins + r.remaining,
    gamesBack,
    divisionWinner: r.divisionWinner,
    seed: r.seed,
    marker: r.marker,
  }
}

/** Games behind a reference club (never negative for display). */
function gamesBack(team: Row, ref: Row): number {
  const gb = (ref.wins - team.wins + (team.losses - ref.losses)) / 2
  return Math.max(0, gb)
}

/** The NFL playoff picture for one conference. */
export function playoffPicture(world: World, conf: string): ConferencePicture {
  const table = buildTable(world)
  const { seeds, confRows } = seedConference(table, conf)
  const seedIds = new Set(seeds.map((r) => r.teamId))
  const top = seeds[0]
  const last = seeds[seeds.length - 1]

  const seedLines = seeds.map((r) => toStanding(r, top ? gamesBack(r, top) : 0))
  const rest = confRows
    .filter((r) => !seedIds.has(r.teamId))
    .sort((a, b) => compare(a, b, false, table.vs))

  const inTheHunt: TeamStanding[] = []
  const eliminated: TeamStanding[] = []
  for (const r of rest) {
    const line = toStanding(r, last ? gamesBack(r, last) : 0)
    if (line.marker === 'e') eliminated.push(line)
    else inTheHunt.push(line)
  }

  const wildCard: PlayoffMatchup[] = []
  if (seedLines.length >= 7) {
    wildCard.push({ high: seedLines[1], low: seedLines[6], label: '2 vs 7' })
    wildCard.push({ high: seedLines[2], low: seedLines[5], label: '3 vs 6' })
    wildCard.push({ high: seedLines[3], low: seedLines[4], label: '4 vs 5' })
  }

  return { conference: conf, seeds: seedLines, wildCard, inTheHunt, eliminated }
}

/** All 16 clubs in a conference, ranked 1–16 (seeds first, then the rest). */
export function conferenceStandings(world: World, conf: string): TeamStanding[] {
  const picture = playoffPicture(world, conf)
  return [...picture.seeds, ...picture.inTheHunt, ...picture.eliminated].map((s, i) => ({
    ...s,
    seed: i + 1,
  }))
}

/** The eight divisions with full records, leader first. */
export function divisionStandings(world: World): DivisionStanding[] {
  const table = buildTable(world)
  const seeds = [...seedConference(table, 'AFC').seeds, ...seedConference(table, 'NFC').seeds]
  const seedById = new Map(seeds.map((r) => [r.teamId, r.seed]))

  const out: DivisionStanding[] = []
  for (const key of Object.keys(NFL_DIVISIONS)) {
    const ids = NFL_DIVISIONS[key]
    const rows = ids
      .map((id) => table.rows.get(id))
      .filter((r): r is Row => !!r)
      .sort((a, b) => compare(a, b, true, table.vs))
    if (!rows.length) continue
    const leader = rows[0]
    out.push({
      division: key,
      conference: rows[0].conf,
      teams: rows.map((r) =>
        // Use the playoff seed computed above; division leaders keep their DIV flag.
        toStanding({ ...r, seed: seedById.get(r.teamId) ?? null }, gamesBack(r, leader)),
      ),
    })
  }
  return out
}

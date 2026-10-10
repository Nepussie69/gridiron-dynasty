// ─────────────────────────────────────────────────────────────────────────────
// NFL-style schedule (backlog 227 / NEXT_PHASE_SCHEDULE.md S1).
//
// Replaces the old "pair all 32 clubs at random every week" builder with the NFL
// formula: 17 games over 18 weeks, one bye each, six division games (home+away
// vs every rival), a same-conference division rotation (3 seasons), a
// cross-conference division rotation (4 seasons), three same-finish games and a
// rotating 17th game.
//
// The build is deterministic from `makeRng(seed + season * 8161)` — the same
// stream the old builder used — and never touches the *world* rng stream when it
// is called from `buildWorld`. It finishes well under the 50 ms budget.
// ─────────────────────────────────────────────────────────────────────────────

import { NFL_DIVISIONS, NFL_TEAMS } from '../data/nflTeams'
import type { Team } from '../types'
import type { Game } from './generate'
import { makeRng, type Rng } from './rng'

export type DivisionFinish = Record<string, 1 | 2 | 3 | 4>

const REG_WEEKS = 17 // weeks 1–17 carry the non-week-18 games
const BYE_FIRST = 5
const BYE_LAST = 14
/** Two meetings of a division series must be at least this many weeks apart. */
export const DIVISION_SPREAD = 3
/** The week whose entire slate is division games (weeks 15–18 must contain one). */
const DIVISION_WEEK = 18

const DIV_NAMES = ['East', 'North', 'South', 'West']
const MOD3 = 3
const MOD4 = 4

/**
 * Perfect matchings of the four divisions inside one conference, cycled by
 * `season % 3`. Every division plays every other exactly once across three
 * seasons, and the pairings are mutual (0–1/2–3, 0–2/1–3, 0–3/1–2).
 */
const SAME_CONFERENCE_MATCHINGS: number[][][] = [
  [[0, 1], [2, 3]],
  [[0, 2], [1, 3]],
  [[0, 3], [1, 2]],
]

/** Pairings of the four clubs inside one division, cycled by season — the week-18 slate. */
const DIVISION_PAIRINGS: number[][][] = [
  [[0, 1], [2, 3]],
  [[0, 2], [1, 3]],
  [[0, 3], [1, 2]],
]

interface Club {
  id: string
  conf: string
  /** Division index 0–3 (East, North, South, West). */
  di: number
  /** Natural index of the club inside its own division (stable data order). */
  natIndex: number
  divisionKey: string
}

interface RawGame {
  homeId: string
  awayId: string
  week: number
  division: boolean
  /** Shared by the two meetings of a division series; unique otherwise. */
  pairKey: string
}

const mod = (n: number, m: number) => ((n % m) + m) % m
const divKey = (conf: string, di: number) => `${conf} ${DIV_NAMES[di]}`

function shuffle<T>(rng: Rng, arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Every club with its conference/division coordinates. */
function clubMeta(): Club[] {
  const out: Club[] = []
  for (const key of Object.keys(NFL_DIVISIONS)) {
    const [conf, divName] = key.split(' ')
    const di = DIV_NAMES.indexOf(divName)
    const members = NFL_DIVISIONS[key]
    members.forEach((id, natIndex) => out.push({ id, conf, di, natIndex, divisionKey: key }))
  }
  return out
}

/**
 * Finish rank 1–4 for every club. A captured `divisionFinish` map wins; a
 * division missing from it (first season, legacy save) falls back to prestige
 * order with the club id as a stable tiebreak.
 */
function rankMap(finish?: DivisionFinish): Record<string, number> {
  const prestige: Record<string, number> = {}
  for (const t of NFL_TEAMS) prestige[t.id] = t.prestige
  const ranks: Record<string, number> = {}
  for (const key of Object.keys(NFL_DIVISIONS)) {
    const members = NFL_DIVISIONS[key]
    const complete = members.every((id) => finish?.[id] != null)
    const sorted = [...members].sort((a, b) =>
      complete
        ? (finish![a] ?? 0) - (finish![b] ?? 0) || a.localeCompare(b)
        : (prestige[b] ?? 0) - (prestige[a] ?? 0) || a.localeCompare(b),
    )
    sorted.forEach((id, i) => { ranks[id] = i + 1 })
  }
  return ranks
}

/** The club that finished `rank` in a division (used by the same-finish games). */
function clubAtRank(conf: string, di: number, rank: number, ranks: Record<string, number>): string {
  const members = NFL_DIVISIONS[divKey(conf, di)]
  return members.find((id) => ranks[id] === rank) ?? members[0]
}

/** The 17 opponents for one club, home/away and series flags included. */
function clubGames(c: Club, ranks: Record<string, number>, season: number): RawGame[] {
  const out: RawGame[] = []
  const simple = (homeId: string, awayId: string): RawGame => ({
    homeId, awayId, week: 0, division: false, pairKey: `${homeId}|${awayId}`,
  })

  // 1. Division rivals: home and away against each of the other three clubs.
  const members = NFL_DIVISIONS[c.divisionKey]
  for (const rival of members) {
    if (rival === c.id) continue
    const key = c.id < rival ? `${c.id}|${rival}` : `${rival}|${c.id}`
    out.push({ homeId: c.id, awayId: rival, week: 0, division: true, pairKey: key })
    out.push({ homeId: rival, awayId: c.id, week: 0, division: true, pairKey: key })
  }

  // Same-conference division pairing for this season (3-year rotation).
  const [p1, p2] = SAME_CONFERENCE_MATCHINGS[mod(season, MOD3)]
  const inP1 = p1.includes(c.di)
  const myPair = inP1 ? p1 : p2
  const otherPair = inP1 ? p2 : p1
  const partnerDi = myPair[0] === c.di ? myPair[1] : myPair[0]
  const myRank = ranks[c.id]

  // 2. A whole division from the same conference (both clubs compute the same host).
  const partnerClubs = NFL_DIVISIONS[divKey(c.conf, partnerDi)]
  const loSame = Math.min(c.di, partnerDi)
  const hiSame = Math.max(c.di, partnerDi)
  partnerClubs.forEach((opp, rr) => {
    const hostDi = mod(c.natIndex + rr + season, 2) === 0 ? loSame : hiSame
    out.push(hostDi === c.di ? simple(c.id, opp) : simple(opp, c.id))
  })

  // 3. A whole division from the other conference (4-year rotation).
  const k = mod(season, MOD4)
  const otherConf = c.conf === 'AFC' ? 'NFC' : 'AFC'
  const crossDi = c.conf === 'AFC' ? mod(c.di + k, MOD4) : mod(c.di - k, MOD4)
  const crossClubs = NFL_DIVISIONS[divKey(otherConf, crossDi)]
  const cIsAfc = c.conf === 'AFC'
  crossClubs.forEach((opp, rr) => {
    // Venue by the two clubs' positions + season (symmetric across conferences).
    const afcHosts = mod(c.natIndex + rr + season, 2) === 0
    const cHosts = afcHosts === cIsAfc
    out.push(cHosts ? simple(c.id, opp) : simple(opp, c.id))
  })

  // 4. Same-finish games: one from each of the two other same-conference divisions.
  //    The two pairings form a 4-cycle, so every club gets exactly one home game.
  const pos = myPair.indexOf(c.di)
  const homeDi = inP1 ? otherPair[pos] : otherPair[1 - pos]
  const awayDi = inP1 ? otherPair[1 - pos] : otherPair[pos]
  out.push(simple(c.id, clubAtRank(c.conf, homeDi, myRank, ranks)))
  out.push(simple(clubAtRank(c.conf, awayDi, myRank, ranks), c.id))

  // 5. The 17th game: a same-finish club from a cross-conference division that
  //    isn't the rotating one. The host conference alternates each season.
  const j17 = c.conf === 'AFC' ? mod(crossDi + 1, MOD4) : mod(crossDi - 1, MOD4)
  const opp17 = clubAtRank(otherConf, j17, myRank, ranks)
  const hostConf = mod(season, 2) === 0 ? 'AFC' : 'NFC'
  out.push(c.conf === hostConf ? simple(c.id, opp17) : simple(opp17, c.id))

  return out
}

/** Every game of the season, deduped to one entry per (home, away) pairing. */
function collectGames(clubs: Club[], ranks: Record<string, number>, season: number): RawGame[] {
  const map = new Map<string, RawGame>()
  for (const c of clubs) {
    for (const g of clubGames(c, ranks, season)) {
      const key = `${g.homeId}|${g.awayId}`
      if (!map.has(key)) map.set(key, g)
    }
  }
  return [...map.values()]
}

/** One bye per club in weeks 5–14, never more than six clubs in a week. */
function assignByes(clubs: Club[], rng: Rng): Record<string, number> {
  const weeks: number[] = []
  for (let w = BYE_FIRST; w <= BYE_LAST; w++) weeks.push(w)
  // An even number of clubs must sit out each week, or the remaining clubs
  // can't pair up: 32 byes over ten weeks, max six per week.
  const counts = weeks.map(() => 2)
  for (let i = 0; i < 6; i++) counts[i] += 2
  const order = shuffle(rng, clubs.map((c) => c.id))
  const byes: Record<string, number> = {}
  let i = 0
  weeks.forEach((w, wi) => {
    for (let n = 0; n < counts[wi]; n++) byes[order[i++]] = w
  })
  return byes
}

/** Reserve the all-division slate (week 18): one meeting from two series per division. */
function pickDivisionWeek(games: RawGame[], season: number): Set<RawGame> {
  const chosen = new Set<RawGame>()
  const keys = Object.keys(NFL_DIVISIONS)
  keys.forEach((key, ordinal) => {
    const members = NFL_DIVISIONS[key]
    const pairing = DIVISION_PAIRINGS[mod(season + ordinal, MOD3)]
    for (const [i, j] of pairing) {
      const a = members[i]
      const b = members[j]
      const g1 = games.find((g) => g.homeId === a && g.awayId === b)
      const g2 = games.find((g) => g.homeId === b && g.awayId === a)
      const pick = g1 && g2 ? (mod(season + i + j, 2) === 0 ? g1 : g2) : g1 ?? g2
      if (pick) chosen.add(pick)
    }
  })
  return chosen
}

/** Can this division game be placed in `week` given its partner meeting? */
function gapOk(pairWeeks: Map<string, number>, g: RawGame, week: number): boolean {
  const placed = pairWeeks.get(g.pairKey)
  if (placed !== undefined) return Math.abs(placed - week) >= DIVISION_SPREAD
  // Partner not placed yet: leave room for it at week + DIVISION_SPREAD.
  return week + DIVISION_SPREAD <= REG_WEEKS
}

/**
 * One attempt to place every pending game into weeks 1–17 as a perfect matching
 * per week. Returns the pending games with `week` set, or null on a dead end.
 */
function trySchedule(
  pending: RawGame[],
  clubIds: string[],
  byes: Record<string, number>,
  initialPairs: Map<string, number>,
  rng: Rng,
): RawGame[] | null {
  for (const g of pending) g.week = 0
  const pairWeeks = new Map(initialPairs)
  const byClub = new Map<string, RawGame[]>()
  for (const id of clubIds) byClub.set(id, [])
  for (const g of pending) {
    byClub.get(g.homeId)!.push(g)
    byClub.get(g.awayId)!.push(g)
  }

  for (let week = 1; week <= REG_WEEKS; week++) {
    const active = clubIds.filter((id) => byes[id] !== week)
    const activeSet = new Set(active)
    const unmatched = new Set(active)
    const ok = (g: RawGame, u: string): boolean => {
      if (g.week !== 0) return false
      const v = g.homeId === u ? g.awayId : g.homeId
      if (!activeSet.has(v) || !unmatched.has(v)) return false
      return !g.division || gapOk(pairWeeks, g, week)
    }
    while (unmatched.size) {
      // Most-constrained first (Warnsdorff).
      let best: string | null = null
      let bestCands: RawGame[] | null = null
      let bestDeg = Infinity
      for (const u of unmatched) {
        const cands = byClub.get(u)!.filter((g) => ok(g, u))
        if (cands.length === 0) return null
        if (cands.length < bestDeg) {
          bestDeg = cands.length
          best = u
          bestCands = cands
          if (bestDeg === 1) break
        }
      }
      const u = best!
      // Division series must finish by week 14-ish (gap ≥ 3), so play them
      // early; keep the unique non-division games for the closing weeks.
      const divCands = bestCands!.filter((g) => g.division)
      const nonDivCands = bestCands!.filter((g) => !g.division)
      const pool = week <= 13
        ? (divCands.length ? divCands : bestCands!)
        : (nonDivCands.length ? nonDivCands : bestCands!)
      let pick: RawGame | null = null
      let pickScore = Infinity
      for (const g of pool) {
        const v = g.homeId === u ? g.awayId : g.homeId
        const vDeg = byClub.get(v)!.filter((x) => ok(x, v)).length
        const score = vDeg + rng() * 0.5
        if (score < pickScore) {
          pickScore = score
          pick = g
        }
      }
      if (!pick) return null
      pick.week = week
      if (pick.division) pairWeeks.set(pick.pairKey, week)
      unmatched.delete(u)
      unmatched.delete(pick.homeId === u ? pick.awayId : pick.homeId)
    }
  }
  return pending
}

/** Draw-free, idempotent rebuild of one club's finish rank map from standings. */
export function divisionFinishFromStandings(world: {
  standings: Record<string, { wins: number; losses: number; ties: number; pointsFor: number; pointsAgainst: number }>
}): DivisionFinish {
  const out: DivisionFinish = {}
  for (const key of Object.keys(NFL_DIVISIONS)) {
    const sorted = [...NFL_DIVISIONS[key]].sort((a, b) => {
      const ra = world.standings[a]
      const rb = world.standings[b]
      const wa = ra?.wins ?? 0
      const wb = rb?.wins ?? 0
      if (wa !== wb) return wb - wa
      const da = (ra?.pointsFor ?? 0) - (ra?.pointsAgainst ?? 0)
      const db = (rb?.pointsFor ?? 0) - (rb?.pointsAgainst ?? 0)
      if (da !== db) return db - da
      const pa = ra?.pointsFor ?? 0
      const pb = rb?.pointsFor ?? 0
      if (pa !== pb) return pb - pa
      return a.localeCompare(b)
    })
    sorted.forEach((id, i) => { out[id] = (i + 1) as 1 | 2 | 3 | 4 })
  }
  return out
}

const MAX_ATTEMPTS = 400

/**
 * Build the 18-week NFL schedule. Deterministic from `seed` + `season`; the same
 * input always yields the identical slate. `finish` is last season's division
 * finish (a missing entry falls back to prestige order).
 */
export function buildNflSchedule(seed: number, season: number, finish?: DivisionFinish, teams: Team[] = NFL_TEAMS): Game[] {
  const rng = makeRng(seed + season * 8161)
  const ranks = rankMap(finish)
  const clubs = clubMeta()
  const all = collectGames(clubs, ranks, season)
  const byes = assignByes(clubs, rng)

  // Reserve the all-division week, then place the rest of the season.
  for (const g of pickDivisionWeek(all, season)) g.week = DIVISION_WEEK
  const initialPairs = new Map<string, number>()
  for (const g of all) if (g.week === DIVISION_WEEK) initialPairs.set(g.pairKey, DIVISION_WEEK)
  const pending = all.filter((g) => g.week !== DIVISION_WEEK)
  const clubIds = clubs.map((c) => c.id)

  let done: RawGame[] | null = null
  for (let attempt = 0; attempt < MAX_ATTEMPTS && !done; attempt++) {
    done = trySchedule(pending, clubIds, byes, initialPairs, rng)
  }
  if (!done) throw new Error('buildNflSchedule: no valid week assignment found')

  const tier = teams[0]?.tier ?? 'NFL'
  return all
    .map((g): Game => ({
      id: `g_${g.week}_${g.homeId}_${g.awayId}`,
      week: g.week,
      homeId: g.homeId,
      awayId: g.awayId,
      homeScore: null,
      awayScore: null,
      played: false,
      tier,
    }))
    .sort((a, b) => a.week - b.week || (a.homeId < b.homeId ? -1 : a.homeId > b.homeId ? 1 : 0) || (a.awayId < b.awayId ? -1 : 1))
}

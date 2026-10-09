// ─────────────────────────────────────────────────────────────────────────────
// Awards, All-Pro / All-Conference teams, and the Hall of Fame.
//
// Everything is selected from the career statistics database at season end, so
// honours reflect real production on the field.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player, SeasonStats, StatLevel } from '../types'
import type { World } from './generate'
import type { CareerDatabase, DbPlayer } from './statsDb'
import { unscaleOvr } from './ovrScale'

export interface AwardWinner {
  award: string
  playerId: string
  name: string
  pos: string
  team: string
  value: string // headline stat
}

export interface AllProTeam {
  label: string // 'First Team' | 'Second Team'
  offense: AwardWinner[]
  defense: AwardWinner[]
}

export interface SeasonHonors {
  season: number
  level: StatLevel
  mvp: AwardWinner | null
  opoy: AwardWinner | null
  dpoy: AwardWinner | null
  oroy: AwardWinner | null
  droy: AwardWinner | null
  firstTeam: AllProTeam
  secondTeam: AllProTeam
}

const OFF_SLOTS = ['QB', 'RB', 'WR', 'WR', 'TE', 'OT', 'OG', 'C']
const DEF_SLOTS = ['DE', 'DE', 'DT', 'DT', 'LB', 'LB', 'LB', 'CB', 'CB', 'S', 'S']

function fmt(n: number) {
  return n.toLocaleString()
}

/** A player's "score" for awards — position-aware production. */
function scoreFor(pos: string, s: SeasonStats): number {
  const pass = s.passYds + s.passTD * 25 - s.ints * 30
  const rush = s.rushYds + s.rushTD * 22
  const recv = s.recYds + s.recTD * 20 + s.rec * 2
  const def = s.tackles * 0.8 + s.defSacks * 22 + s.defInts * 26
  if (pos === 'QB') return pass
  if (pos === 'RB') return rush + recv * 0.35
  if (pos === 'WR' || pos === 'TE') return recv
  if (['DE', 'DT', 'LB', 'CB', 'S'].includes(pos)) return def
  return 0
}

function headline(pos: string, s: SeasonStats): string {
  if (pos === 'QB') return `${fmt(s.passYds)} pass yds, ${s.passTD} TD`
  if (pos === 'RB') return `${fmt(s.rushYds)} rush yds, ${s.rushTD} TD`
  if (pos === 'WR' || pos === 'TE') return `${s.rec} rec, ${fmt(s.recYds)} yds, ${s.recTD} TD`
  return `${s.defSacks} sacks, ${s.defInts} INT, ${s.tackles} tkl`
}

interface Candidate {
  playerId: string
  name: string
  pos: string
  team: string
  score: number
  stats: SeasonStats
}

/** Gather every qualified player-season for a season/level, with award scores. */
function candidates(world: World, season: number, level: StatLevel): Candidate[] {
  const out: Candidate[] = []
  for (const p of world.players) {
    const s = (p.stats ?? []).find((x) => x.season === season && x.level === level)
    if (!s) continue
    const team = world.byId[s.teamId]
    out.push({
      playerId: p.id,
      name: p.name,
      pos: p.pos,
      team: team ? team.name : '—',
      score: scoreFor(p.pos, s),
      stats: s,
    })
  }
  return out
}

function toWinner(c: Candidate): AwardWinner {
  return {
    award: '',
    playerId: c.playerId,
    name: c.name,
    pos: c.pos,
    team: c.team,
    value: headline(c.pos, c.stats),
  }
}

/** Best player for each offensive line / defensive slot. */
function pickTeam(cands: Candidate[], used: Set<string>, slots: string[], offset: number): AwardWinner[] {
  return slots
    .map((slot) => {
      const pool = cands
        .filter((c) => c.pos === slot && !used.has(c.playerId))
        .sort((a, b) => b.score - a.score)
      const pick = pool[offset] ?? pool[0]
      if (pick) used.add(pick.playerId)
      return pick ? toWinner(pick) : null
    })
    .filter((x): x is AwardWinner => x !== null)
}

/**
 * Select a full slate of honours for one season and level.
 * NFL seasons produce All-Pro teams; college seasons produce All-Conference.
 */
export function selectHonors(world: World, season: number, level: StatLevel): SeasonHonors | null {
  const cands = candidates(world, season, level)
  if (cands.length < 8) return null

  const byScore = [...cands].sort((a, b) => b.score - a.score)
  const bestOff = byScore.filter((c) => ['QB', 'RB', 'WR', 'TE'].includes(c.pos))
  const bestDef = byScore.filter((c) => ['DE', 'DT', 'LB', 'CB', 'S'].includes(c.pos))

  // Rookies: age 22 or younger with meaningful production.
  const rookies = byScore.filter((c) => c.stats.games >= 6 && world.players.find((p) => p.id === c.playerId)?.age !== undefined && (world.players.find((p) => p.id === c.playerId)?.age ?? 30) <= 23)

  const mvp = bestOff[0] ?? byScore[0]
  const opoy = bestOff.find((c) => c.playerId !== mvp?.playerId) ?? bestOff[0]
  const dpoy = bestDef[0]
  const oroy = rookies.find((c) => ['QB', 'RB', 'WR', 'TE'].includes(c.pos)) ?? bestOff[0]
  const droy = rookies.find((c) => ['DE', 'DT', 'LB', 'CB', 'S'].includes(c.pos)) ?? bestDef[0]

  const used1 = new Set<string>()
  const firstOff = pickTeam(cands, used1, OFF_SLOTS, 0)
  const firstDef = pickTeam(cands, used1, DEF_SLOTS, 0)
  const used2 = new Set<string>()
  // Exclude first-teamers from the second team.
  const secondCands = cands.filter((c) => !used1.has(c.playerId))
  const secondOff = pickTeam(secondCands, used2, OFF_SLOTS, 0)
  const secondDef = pickTeam(secondCands, used2, DEF_SLOTS, 0)

  return {
    season,
    level,
    mvp: mvp ? toWinner(mvp) : null,
    opoy: opoy ? toWinner(opoy) : null,
    dpoy: dpoy ? toWinner(dpoy) : null,
    oroy: oroy ? toWinner(oroy) : null,
    droy: droy ? toWinner(droy) : null,
    firstTeam: { label: level === 'NFL' ? 'First-Team All-Pro' : 'First-Team All-Conference', offense: firstOff, defense: firstDef },
    secondTeam: { label: level === 'NFL' ? 'Second-Team All-Pro' : 'Second-Team All-Conference', offense: secondOff, defense: secondDef },
  }
}

// ── Live award race ───────────────────────────────────────────────────────────
//
// The end-of-season vote (`selectHonors`) is written from the career database at
// year end. This helper scores the season still in progress the same way — the
// same `scoreFor` production formula, the same position groups and the same
// rookie rule — straight off the world's live stat lines, then returns the top
// candidates per award so the Awards screen can show who is in the running as
// the weeks go by. Pure and read-only: it never touches the world, the database
// or the award history. (There is no Comeback Player award in this game.)

const OFF_POS = new Set(['QB', 'RB', 'WR', 'TE'])
const DEF_POS = new Set(['DE', 'DT', 'LB', 'CB', 'S'])

/** One name in the running for an award, with his (or the club's) line. */
export interface RaceCandidate {
  /** Set for player awards, so the UI can hover his full card. */
  playerId?: string
  name: string
  pos: string
  teamId: string
  team: string
  teamAbbr: string
  /** The club's live record, e.g. "7-3" or "6-4-1". */
  record: string
  /** The headline production (players) or the résumé line (staff). */
  value: string
  score: number
}

export interface AwardRaceGroup {
  award: string
  /** Players hover; staff are club people, shown with their crest. */
  kind: 'player' | 'staff'
  candidates: RaceCandidate[]
}

export interface AwardRace {
  season: number
  week: number
  /** False until the season's first week has been played. */
  started: boolean
  groups: AwardRaceGroup[]
}

function recordFor(world: World, teamId: string): string {
  const r = world.standings[teamId]
  if (!r) return '0-0'
  return r.ties ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`
}

/** Format a slice of already-ranked candidates as race rows for the UI. */
function raceRows(world: World, cands: Candidate[], limit = 5): RaceCandidate[] {
  return cands.slice(0, limit).map((c) => {
    const teamId = c.stats.teamId
    const t = world.byId[teamId]
    return {
      playerId: c.playerId,
      name: c.name,
      pos: c.pos,
      teamId,
      team: c.team,
      teamAbbr: t?.abbr ?? '',
      record: recordFor(world, teamId),
      value: headline(c.pos, c.stats),
      score: Math.round(c.score),
    }
  })
}

/** Rank 1 = best, mirroring `computeStaffAwards`' live standings curves. */
function ranksBy(ids: string[], value: (id: string) => number, best: 'high' | 'low'): Record<string, number> {
  const order = [...ids].sort((a, b) => (best === 'high' ? value(b) - value(a) : value(a) - value(b)))
  const out: Record<string, number> = {}
  order.forEach((id, i) => { out[id] = i + 1 })
  return out
}

/** The front-office and coaching races: Exec, Coach, Assistant, Rising Star. */
function staffRaceRows(world: World): AwardRaceGroup[] {
  const nfl = world.teams.filter((t) => t.tier === 'NFL')
  const lastWins = world.lastWins ?? {}
  const wins = (id: string) => world.standings[id]?.wins ?? 0
  const improvement = (id: string) => wins(id) - (lastWins[id] ?? wins(id))
  const winScore = (id: string) => wins(id) + 0.5 * improvement(id)
  const nameOf = (teamId: string, role: string, suffix: string) =>
    (world.staff[teamId] ?? []).find((s) => s.role === role)?.name ?? `${world.byId[teamId]?.name ?? ''} ${suffix}`

  const row = (name: string, teamId: string, pos: string, score: number, value: string): RaceCandidate => {
    const t = world.byId[teamId]
    return {
      name, pos, teamId,
      team: t?.name ?? teamId,
      teamAbbr: t?.abbr ?? '',
      record: recordFor(world, teamId),
      value,
      score: Math.round(score * 10) / 10,
    }
  }
  const top = (rows: RaceCandidate[], limit = 5) => rows.sort((a, b) => b.score - a.score).slice(0, limit)

  const exec = top(nfl.map((t) => row(nameOf(t.id, 'General Manager', 'GM'), t.id, 'GM', winScore(t.id), `${t.abbr} ${recordFor(world, t.id)}`)))
  const coach = top(nfl.map((t) => row(nameOf(t.id, 'Head Coach', 'Head Coach'), t.id, 'HC', winScore(t.id), `${t.abbr} ${recordFor(world, t.id)}`)))

  const pfRank = ranksBy(nfl.map((t) => t.id), (id) => world.standings[id]?.pointsFor ?? 0, 'high')
  const paRank = ranksBy(nfl.map((t) => t.id), (id) => world.standings[id]?.pointsAgainst ?? 0, 'low')
  const assistant: RaceCandidate[] = []
  for (const t of nfl) {
    assistant.push(row(nameOf(t.id, 'Offensive Coordinator', 'OC'), t.id, 'OC', 33 - pfRank[t.id], `${t.abbr} offense #${pfRank[t.id]}`))
    assistant.push(row(nameOf(t.id, 'Defensive Coordinator', 'DC'), t.id, 'DC', 33 - paRank[t.id], `${t.abbr} defense #${paRank[t.id]}`))
  }

  // Rising Star tracks the AI climbers' reputation gains. The user's own entry
  // needs career state the race helper doesn't receive, so it is left out here.
  const rising = top(
    world.rivals
      .map((r) => {
        const gain = r.reputation - (r.prevReputation ?? r.reputation)
        return row(r.name, r.teamId, 'RS', gain, `${gain >= 0 ? '+' : ''}${gain} reputation`)
      })
      .filter((r) => r.score > 0),
  )

  return [
    { award: 'Executive of the Year', kind: 'staff', candidates: exec },
    { award: 'Coach of the Year', kind: 'staff', candidates: coach },
    { award: 'Assistant Coach of the Year', kind: 'staff', candidates: top(assistant) },
    { award: 'Rising Star', kind: 'staff', candidates: rising },
  ]
}

/**
 * Score the CURRENT season and return the top five candidates per award, the
 * same way `selectHonors` will vote at year end but from live stat lines. `db`
 * and `awards` are accepted for symmetry with the end-of-season call; the race
 * reads the season in progress straight off the world.
 */
export function awardRace(world: World, _db: CareerDatabase, _awards: AwardHistory): AwardRace {
  const season = world.season
  const started = world.phase === 'regular' && world.schedule.some((g) => g.played && g.tier === 'NFL')
  if (!started) return { season, week: world.week, started: false, groups: [] }

  const byScore = candidates(world, season, 'NFL').sort((a, b) => b.score - a.score)
  const off = byScore.filter((c) => OFF_POS.has(c.pos))
  const def = byScore.filter((c) => DEF_POS.has(c.pos))

  const mvpPool = off.length ? off : byScore
  const mvpId = mvpPool[0]?.playerId
  const opoyPool = mvpPool.filter((c) => c.playerId !== mvpId)

  // Rookies: the year-end rule is age 23 or younger with real production. Live,
  // the six-game gate is dropped so the race is populated from week 2 on.
  const ageById = new Map(world.players.map((p) => [p.id, p.age]))
  const rookies = byScore.filter((c) => (ageById.get(c.playerId) ?? 99) <= 23 && c.stats.games >= 1)

  const groups: AwardRaceGroup[] = [
    { award: 'MVP', kind: 'player', candidates: raceRows(world, mvpPool) },
    { award: 'Offensive POY', kind: 'player', candidates: raceRows(world, opoyPool) },
    { award: 'Defensive POY', kind: 'player', candidates: raceRows(world, def) },
    { award: 'Offensive ROY', kind: 'player', candidates: raceRows(world, rookies.filter((c) => OFF_POS.has(c.pos))) },
    { award: 'Defensive ROY', kind: 'player', candidates: raceRows(world, rookies.filter((c) => DEF_POS.has(c.pos))) },
    ...staffRaceRows(world),
  ]
  return { season, week: world.week, started: true, groups }
}

// ── Hall of Fame ─────────────────────────────────────────────────────────────
export interface HofInductee {
  playerId: string
  name: string
  pos: string
  careerYears: number
  passYds: number
  rushYds: number
  recYds: number
  totalTD: number
  sacks: number
  ints: number
  tackles: number
  titles: number
  awardCount: number
  score: number
  // L12.16 H2/H3: honour breakdown and best line, for the class view.
  mvp?: number
  opoy?: number
  dpoy?: number
  roy?: number
  allPro?: number
  bestLine?: string
}

/** A player's Hall of Fame score from career totals. */
export function hofScore(
  p: Player,
  _db: CareerDatabase,
  opts: { titles?: number; awards?: number } = {},
): HofInductee | null {
  const seasons = p.stats ?? []
  if (seasons.length < 5) return null
  const t = seasons.reduce(
    (a, s) => {
      a.passYds += s.passYds; a.passTD += s.passTD
      a.rushYds += s.rushYds; a.rushTD += s.rushTD
      a.recYds += s.recYds; a.recTD += s.recTD; a.rec += s.rec
      a.sacks += s.defSacks; a.ints += s.defInts; a.tackles += s.tackles
      return a
    },
    { passYds: 0, passTD: 0, rushYds: 0, rushTD: 0, recYds: 0, recTD: 0, rec: 0, sacks: 0, ints: 0, tackles: 0 },
  )
  const totalTD = t.passTD + t.rushTD + t.recTD
  const titles = opts.titles ?? 0
  const awards = opts.awards ?? 0
  // Weighted HOF score: volume + peak honours + championships.
  const score =
    t.passYds / 250 +
    t.passTD * 1.2 +
    t.rushYds / 90 +
    t.rushTD * 1.5 +
    t.recYds / 90 +
    t.recTD * 1.5 +
    t.sacks * 2.2 +
    t.ints * 3 +
    t.tackles / 60 +
    awards * 12 +
    titles * 18
  return {
    playerId: p.id,
    name: p.name,
    pos: p.pos,
    careerYears: seasons.length,
    passYds: t.passYds,
    rushYds: t.rushYds,
    recYds: t.recYds,
    totalTD,
    sacks: t.sacks,
    ints: t.ints,
    tackles: t.tackles,
    titles,
    awardCount: awards,
    score: Math.round(score),
  }
}

/** Induct everyone whose career clears the bar (NFL and college combined). */
export function computeLegacyHof(world: World, db: CareerDatabase, inductedIds: Set<string>, threshold = 120): HofInductee[] {
  const out: HofInductee[] = []
  // Retired players live only in the database.
  const allPlayers = [...world.players]
  for (const p of allPlayers) {
    const score = hofScore(p, db)
    if (score && score.score >= threshold && !inductedIds.has(p.id)) out.push(score)
  }
  return out.sort((a, b) => b.score - a.score)
}

// ── L12.16 H2: the real Hall of Fame vote ─────────────────────────────────────
//
// Eligibility is reserved for players who have actually retired and waited out
// the three-season cooling-off period. The score is the old volume formula plus
// the honours they actually won (MVP, POY, ROY, All-Pro) and the titles their
// clubs won, plus a position-fair term so linemen, kickers and fullbacks — who
// never accumulate the glamour volume — still have a path to Canton.

/** A player on the ballot who did not clear the bar. */
export interface HofFinalist {
  playerId: string
  name: string
  pos: string
  score: number
}

/** One year's Hall of Fame ballot and the class it elected. */
export interface HofClass {
  season: number
  inducted: HofInductee[]
  finalists: HofFinalist[]
}

/** Ballot size: the top N eligible players each year make the finalists list. */
export const HOF_BALLOT_SIZE = 15
/** Most inductees a single class can elect. */
export const HOF_CLASS_CAP = 5
/** Seasons a retiree must wait before he can be voted in. */
export const HOF_WAIT = 3
/** Default induction threshold (tuned with `__hofProbe`, see L12.16 H5). */
export const HOF_THRESHOLD = 250

interface HonourTally {
  mvp: number
  opoy: number
  dpoy: number
  roy: number
  first: number
  second: number
  titles: number
}

function tallyHonours(pid: string, awards: AwardHistory, championSeasons: Set<string>, seasons: SeasonStats[]): HonourTally {
  const t: HonourTally = { mvp: 0, opoy: 0, dpoy: 0, roy: 0, first: 0, second: 0, titles: 0 }
  for (const s of awards.seasons) {
    if (s.mvp?.playerId === pid) t.mvp += 1
    if (s.opoy?.playerId === pid) t.opoy += 1
    if (s.dpoy?.playerId === pid) t.dpoy += 1
    if (s.oroy?.playerId === pid || s.droy?.playerId === pid) t.roy += 1
    if (s.firstTeam.offense.some((w) => w.playerId === pid) || s.firstTeam.defense.some((w) => w.playerId === pid)) t.first += 1
    if (s.secondTeam.offense.some((w) => w.playerId === pid) || s.secondTeam.defense.some((w) => w.playerId === pid)) t.second += 1
  }
  // Titles count for the club the player actually played for that season.
  for (const s of seasons) {
    if (championSeasons.has(`${s.season}:${s.teamId}`)) t.titles += 1
  }
  return t
}

const HONOUR_POINTS = { mvp: 20, poy: 12, roy: 4, first: 8, second: 4, title: 10 }

/** The single best season line, by the same volume formula, for the class card. */
function bestSeasonLine(pos: string, seasons: SeasonStats[]): string | undefined {
  let best: { score: number; line: string } | null = null
  for (const s of seasons) {
    const score =
      s.passYds / 250 + s.passTD * 1.2 + s.rushYds / 90 + s.rushTD * 1.5 + s.recYds / 90 + s.recTD * 1.5 +
      s.defSacks * 2.2 + s.defInts * 3 + s.tackles / 60
    if (!best || score > best.score) best = { score, line: lineFor(pos, s) }
  }
  return best && best.score > 0 ? best.line : undefined
}

/** A season headline for any position — skill, defense, or the big uglies. */
function lineFor(pos: string, s: SeasonStats): string {
  if (['QB', 'RB', 'WR', 'TE', 'DE', 'DT', 'LB', 'CB', 'S'].includes(pos)) return headline(pos, s)
  if (s.games) return `${s.games} games`
  return '—'
}

/** Build an inductee record from a database entry, honours and peak rating. */
function inducteeFrom(pid: string, name: string, pos: Player['pos'], all: SeasonStats[], h: HonourTally): HofInductee {
  const nfl = all.filter((s) => s.level === 'NFL')
  const t = nfl.reduce(
    (a, s) => {
      a.passYds += s.passYds; a.passTD += s.passTD
      a.rushYds += s.rushYds; a.rushTD += s.rushTD
      a.recYds += s.recYds; a.recTD += s.recTD; a.rec += s.rec
      a.sacks += s.defSacks; a.ints += s.defInts; a.tackles += s.tackles
      return a
    },
    { passYds: 0, passTD: 0, rushYds: 0, rushTD: 0, recYds: 0, recTD: 0, rec: 0, sacks: 0, ints: 0, tackles: 0 },
  )
  const totalTD = t.passTD + t.rushTD + t.recTD
  return {
    playerId: pid,
    name,
    pos,
    careerYears: nfl.length,
    passYds: t.passYds,
    rushYds: t.rushYds,
    recYds: t.recYds,
    totalTD,
    sacks: t.sacks,
    ints: t.ints,
    tackles: t.tackles,
    titles: h.titles,
    awardCount: h.mvp + h.opoy + h.dpoy + h.roy + h.first + h.second,
    score: 0,
    mvp: h.mvp,
    opoy: h.opoy,
    dpoy: h.dpoy,
    roy: h.roy,
    allPro: h.first + h.second,
    bestLine: bestSeasonLine(pos, all),
  }
}

/** Score one database entry: volume + honours + titles + the position-fair term. */
function scoreEntry(pid: string, entry: DbPlayer, awards: AwardHistory, championSeasons: Set<string>): HofInductee {
  const all = entry.seasons
  const h = tallyHonours(pid, awards, championSeasons, all)
  const ind = inducteeFrom(pid, entry.name, entry.pos as Player['pos'], all, h)
  const nfl = all.filter((s) => s.level === 'NFL')
  const volume = nfl.reduce(
    (sum, s) =>
      sum +
      s.passYds / 250 + s.passTD * 1.2 + s.rushYds / 90 + s.rushTD * 1.5 + s.recYds / 90 + s.recTD * 1.5 +
      s.defSacks * 2.2 + s.defInts * 3 + s.tackles / 60,
    0,
  )
  const honourPts = h.mvp * HONOUR_POINTS.mvp + (h.opoy + h.dpoy) * HONOUR_POINTS.poy + h.roy * HONOUR_POINTS.roy + h.first * HONOUR_POINTS.first + h.second * HONOUR_POINTS.second
  // L12.15 S2: peakOvr is now stored on the compressed scale; re-key the old
  // "peak above 85" bonus through the inverse so the same career keeps the same
  // Hall-of-Fame score as before the remap.
  const peak = entry.peakOvr ?? 0
  const fair = peak > 0 ? Math.max(0, unscaleOvr(peak) - 85) * 6 : 0
  ind.score = Math.round(volume + honourPts + h.titles * HONOUR_POINTS.title + fair)
  return ind
}

/** Everyone on this year's ballot: retired, waited out HOF_WAIT, 5+ NFL seasons, not in. */
export function hofEligible(db: CareerDatabase, awards: AwardHistory, season: number): HofInductee[] {
  const inductedIds = new Set(awards.inducted)
  const championSeasons = new Set(db.teams.filter((t) => t.champion).map((t) => `${t.season}:${t.teamId}`))
  const out: HofInductee[] = []
  for (const [pid, entry] of Object.entries(db.players)) {
    if (inductedIds.has(pid)) continue
    if (entry.retiredSeason === undefined || entry.retiredSeason > season - HOF_WAIT) continue
    if (entry.seasons.filter((s) => s.level === 'NFL').length < 5) continue
    out.push(scoreEntry(pid, entry, awards, championSeasons))
  }
  return out.sort((a, b) => b.score - a.score)
}

/**
 * L12.16 H2: hold the year's Hall of Fame vote. The top HOF_BALLOT_SIZE eligible
 * players are the finalists; every finalist at or above `threshold` is elected,
 * up to HOF_CLASS_CAP. Pure (no mutation) — the store applies the result.
 */
export function computeHallOfFame(
  db: CareerDatabase,
  awards: AwardHistory,
  season: number,
  threshold = HOF_THRESHOLD,
): HofClass {
  const eligible = hofEligible(db, awards, season)
  const finalists = eligible.slice(0, HOF_BALLOT_SIZE)
  const inducted = finalists.filter((f) => f.score >= threshold).slice(0, HOF_CLASS_CAP)
  return {
    season,
    inducted,
    finalists: finalists.map((f) => ({ playerId: f.playerId, name: f.name, pos: f.pos, score: f.score })),
  }
}

/** Award history stored across seasons. */
export interface AwardHistory {
  seasons: SeasonHonors[]
  hof: HofInductee[]
  inducted: string[]
  /** L12.16 H2: one ballot per season, newest last. */
  classes?: HofClass[]
}

export function newAwardHistory(): AwardHistory {
  return { seasons: [], hof: [], inducted: [], classes: [] }
}

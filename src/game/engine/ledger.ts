// ─────────────────────────────────────────────────────────────────────────────
// The Ledger.
//
// Every call you make — a grade, a recommendation, a draft pick, advice to a
// director — is date-stamped. Years later it comes back: "You graded him a
// 2nd-rounder as an Area Scout in 2027; he's a 3x Pro Bowler now."
//
// The career hit rate is your success rate, and "My Guys" follows everyone
// you championed. This is what makes the one-living-universe hook felt.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, LedgerEntry, LedgerKind, Player, Recommendation } from '../types'
import type { World } from './generate'
import { tierFor } from './career'
import { STARTERS, depthAt } from './depth'
import { unscaleOvr } from './ovrScale'
import type { GameSim } from './playsim'
import { fourthDownEV, twoPointChoice, type Situation } from './decisions'
import { kickPowerFor, playIndexOf, type FilmGrade } from './film'
import type { KeyGrade } from './keys'
import { clamp } from './rng'

/** L12.9 L1: the coaching-track call kinds (the "Coaching" Ledger filter). */
export const COACHING_KINDS: ReadonlySet<LedgerKind> = new Set(['fourth', 'two', 'playCall', 'keys', 'film', 'pitch', 'gmRequest'])

/** How many seasons a drafted player needs before we grade the pick. */
const PICK_EVAL_SEASONS = 2
const PICK_HIT_OVR = 78
/** K4: a red flag hits when the prospect busts below this OVR, not above a bar. */
const RED_FLAG_BUST_OVR = 75

const BAND: Record<Recommendation, [number, number]> = {
  'Blue Chip': [86, 99],
  Starter: [76, 88],
  Depth: [66, 79],
  Pass: [0, 72],
}

let LEDGER_SEQ = 0

/** Append a dated entry to the career ledger (mutates the career object). */
export function pushLedger(career: CareerState, entry: Omit<LedgerEntry, 'id' | 'season' | 'week'>): LedgerEntry {
  const full: LedgerEntry = {
    id: `led_${career.season}_${career.week}_${LEDGER_SEQ++}`,
    season: career.season,
    week: career.week,
    role: tierFor(career.path, career.level).title,
    ...entry,
  }
  if (!career.ledger) career.ledger = []
  career.ledger.unshift(full)
  if (career.ledger.length > 400) career.ledger.length = 400
  return full
}

/** Your success rate across every graded call. */
export function ledgerHitRate(career: CareerState): { calls: number; hits: number; pct: number } {
  const graded = (career.ledger ?? []).filter((e) => e.hit !== undefined)
  const hits = graded.filter((e) => e.hit).length
  return { calls: graded.length, hits, pct: graded.length ? Math.round((hits / graded.length) * 100) : 0 }
}

/** Grade one entry if enough time has passed. Returns true/false, or undefined if not ready. */
function gradeEntry(world: World, e: LedgerEntry): boolean | undefined {
  if (e.kind === 'recommendation' || e.kind === 'grade') {
    if (e.truth == null) return undefined
    if (e.recommendation) {
      const [lo, hi] = BAND[e.recommendation]
      return e.truth >= lo && e.truth <= hi
    }
    if (e.myGrade != null) return Math.abs(e.myGrade - e.truth) <= 8
    return undefined
  }
  if (e.kind === 'pick' || e.kind === 'advice') {
    const p = e.playerId ? world.players.find((x) => x.id === e.playerId) : undefined
    if (!p) return undefined
    const proSeasons = (p.stats ?? []).filter((s) => s.level === 'NFL').length
    if (proSeasons < PICK_EVAL_SEASONS) return undefined
    // K4: a red flag is a bet that he busts, so the hit test flips.
    if (e.redFlag) return unscaleOvr(p.ovr) < RED_FLAG_BUST_OVR
    return unscaleOvr(p.ovr) >= PICK_HIT_OVR
  }
  if (e.kind === 'pitch') {
    // L12.9 L1: an accepted starter pitch is graded at season end by whether the
    // promoted player actually held the job (games played, a snaps proxy).
    if (world.season <= e.season) return undefined
    const p = e.playerId ? world.players.find((x) => x.id === e.playerId) : undefined
    if (!p) return false
    const s = (p.stats ?? []).find((x) => x.season === e.season && x.level === 'NFL')
    return (s?.games ?? 0) >= 8
  }
  if (e.kind === 'contract') {
    if (world.season - e.season < 2) return undefined
    const p = e.playerId ? world.players.find((x) => x.id === e.playerId) : undefined
    if (!p) return false
    return p.ovr >= (e.ovrAtSign ?? 0) - 2
  }
  // L12.14 C6: a GM request graded the following season — did the move help?
  if (e.kind === 'gmRequest') {
    // Only executed moves are graded; a declined / not-now request did nothing.
    if (!e.requestDone) return undefined
    if (world.season <= e.season) return undefined
    if (e.requestKind === 'restructure') {
      // The push paid off if the club finished with a winning season.
      return (world.lastWins?.[e.teamId ?? ''] ?? 0) >= 9
    }
    const p = e.playerId ? world.players.find((x) => x.id === e.playerId) : undefined
    if (e.requestKind === 'release') {
      // Moving on looks right unless he went on to start and produce elsewhere.
      if (!p || !p.teamId) return true
      if (p.teamId === e.teamId) return false
      const s = (p.stats ?? []).find((x) => x.season === e.season && x.level === 'NFL')
      const games = s?.games ?? 0
      const depth = depthAt(world, p.teamId, p.pos)
      const startsElsewhere = depth.findIndex((x) => x.id === p.id) < (STARTERS[p.pos] ?? 1)
      return !(games >= 8 && startsElsewhere)
    }
    if (!p) return false
    return p.ovr >= (e.ovrAtSign ?? 0) - 3
  }
  return undefined
}

/**
 * Re-grade the ledger (called at season end). Marks hits/misses and writes a
 * human outcome, so old calls mature over a career.
 */
export function gradeLedger(world: World, career: CareerState): { graded: number; hits: number; newly: LedgerEntry[] } {
  if (!career.ledger) return { graded: 0, hits: 0, newly: [] }
  let newlyGraded = 0
  let hits = 0
  const newly: LedgerEntry[] = []
  for (const e of career.ledger) {
    if (e.kind === 'develop') continue
    if (e.hit !== undefined && e.kind !== 'pick' && e.kind !== 'advice') continue
    const p = e.playerId ? world.players.find((x) => x.id === e.playerId) : undefined
    const result = gradeEntry(world, e)
    // Extension outcome text is bespoke, not the generic pick/call wording.
    if (e.kind === 'contract' && result !== undefined) {
      const ovr = p?.ovr
      e.outcome = result
        ? `Extension held up: ${e.name} still a ${ovr ?? '—'} OVR.`
        : ovr !== undefined
          ? `Extension aged badly: ${e.name} down to ${ovr}.`
          : `Extension aged badly: ${e.name} is out of the league.`
    }
    // L12.9 L1: an accepted pitch gets a bespoke season-end outcome.
    if (e.kind === 'pitch' && result !== undefined) {
      const games = p ? ((p.stats ?? []).find((x) => x.season === e.season && x.level === 'NFL')?.games ?? 0) : 0
      e.outcome = result
        ? `Your pitch held: ${e.name} started ${games} games.`
        : `Your pitch went nowhere: ${e.name} managed only ${games} games.`
    }
    // L12.14 C6: a GM request matures a season later.
    if (e.kind === 'gmRequest' && result !== undefined) {
      if (e.requestKind === 'restructure') {
        e.outcome = result ? `The cap push worked: ${e.name}.` : `The cap push fizzled: ${e.name}.`
      } else if (e.requestKind === 'release') {
        e.outcome = result ? `Moving on from ${e.name} worked out.` : `${e.name} made the cut look wrong.`
      } else {
        e.outcome = result ? `${e.name} held up after the move.` : `${e.name} didn't live up to the move.`
      }
    }
    // For picks, refresh the outcome text as the player develops.
    if (p && !e.vindication && (e.kind === 'pick' || e.kind === 'advice' || e.kind === 'recommendation')) {
      if (e.redFlag) {
        if (result === true) e.outcome = `Red flag held: ${p.name} stalled at ${p.ovr}.`
        else if (result === false) e.outcome = `Red flag missed: ${p.name} became a ${p.ovr}.`
      } else {
        const tag = e.kind === 'pick' ? `Pick ${e.round ? `Rd ${e.round}` : ''}`.trim() : 'Your call'
        if (result === true) e.outcome = `${tag}: ${p.name} is a ${p.ovr} OVR${unscaleOvr(p.ovr) >= 88 ? ' star' : ' contributor'} — that one landed.`
        else if (result === false) e.outcome = `${tag}: ${p.name} stalled at ${p.ovr} OVR.`
      }
    }
    if (result !== undefined && e.hit === undefined) {
      e.hit = result
      newlyGraded++
      newly.push(e)
    }
    if (e.hit) hits++
  }
  return { graded: newlyGraded, hits, newly }
}

export interface MyGuy {
  entry: LedgerEntry
  player?: Player
  ovr?: number
}

/** Everyone you championed (picks and strong recommendations), with current status. */
export function myGuys(world: World, career: CareerState): MyGuy[] {
  const entries = (career.ledger ?? []).filter(
    (e) => e.kind === 'pick' || (e.kind === 'recommendation' && (e.recommendation === 'Blue Chip' || e.recommendation === 'Starter')),
  )
  return entries.map((entry) => {
    const player = entry.playerId ? world.players.find((x) => x.id === entry.playerId) : undefined
    return { entry, player, ovr: player?.ovr }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// L12.9 L1: the coaching Ledger.
//
// After each game the coach's calls are dated and graded — the résumé a coach
// actually builds. At most six entries per game (film, the play-call count and
// the keys first, then the 4th-down and 2-point calls), grouped by week in the UI.
// ─────────────────────────────────────────────────────────────────────────────

/** Did a 4th-down call convert (a first down or touchdown)? */
function fourthConverted(sim: GameSim, index: number, choiceId: string, distance: number): boolean {
  const p = sim.plays[index]
  if (!p) return false
  if (choiceId === 'punt') return false
  if (choiceId === 'fg') return /is good/i.test(p.result)
  return !p.turnover && (p.endYard >= 100 || p.yards >= distance)
}

/** Did a 2-point try / PAT convert? */
function twoConverted(sim: GameSim, index: number): boolean {
  const p = sim.plays[index]
  if (!p) return false
  return /good/i.test(p.result) && !/failed/i.test(p.result)
}

/**
 * Append one game's coaching calls to the Ledger. `film` and `keyGrades` are the
 * grades already computed in the store; the 4th-down and 2-point calls are read
 * back from the sim's decision log. Returns the number of entries written.
 */
export function logCoachCalls(
  career: CareerState,
  world: World,
  sim: GameSim,
  userTeamId: string,
  keyGrades: KeyGrade[],
  film: FilmGrade | null,
): number {
  const oppId = sim.homeId === userTeamId ? sim.awayId : sim.homeId
  const opp = world.byId[oppId]
  const oppTag = opp?.abbr ?? oppId
  const decisions = sim.decisions ?? []
  const pending: Omit<LedgerEntry, 'id' | 'season' | 'week'>[] = []

  // 1. Film grade (≥ B hit, ≤ D miss, a C is left ungraded).
  if (film) {
    pending.push({
      kind: 'film',
      name: `Game film vs ${oppTag}`,
      pos: '—',
      college: '—',
      myGrade: film.grade,
      hit: film.grade >= 83 ? true : film.grade < 70 ? false : undefined,
      note: `Film grade ${film.letter} (${film.grade})`,
      outcome: film.lines[0],
    })
  }

  // 2. The call-matrix count: won/lost/push across the game's play calls.
  const calls = decisions.filter((d) => (d.kind === 'call' || d.kind === 'defCall') && d.outcome)
  if (calls.length) {
    const won = calls.filter((d) => d.outcome === 'won').length
    const lost = calls.filter((d) => d.outcome === 'lost').length
    const push = calls.length - won - lost
    pending.push({
      kind: 'playCall',
      name: `Play calls vs ${oppTag}`,
      pos: '—',
      college: '—',
      myGrade: clamp(70 + (won - lost) * 5, 0, 100),
      hit: won >= lost,
      note: `${won} won · ${lost} lost · ${push} push`,
    })
  }

  // 3. Keys to the game: both hit / none hit are graded; a split is left out.
  if (keyGrades.length) {
    const hits = keyGrades.filter((g) => g.hit).length
    if (hits === keyGrades.length || hits === 0) {
      pending.push({
        kind: 'keys',
        name: `Keys vs ${oppTag}`,
        pos: '—',
        college: '—',
        myGrade: hits === keyGrades.length ? 88 : 48,
        hit: hits === keyGrades.length,
        note: keyGrades.map((g) => `${g.label} ${g.hit ? '✓' : '✗'}`).join(' · '),
      })
    }
  }

  // 4. 4th-down and 2-point calls: hit if the EP model agreed or the play converted.
  const kickPower = kickPowerFor(world, userTeamId)
  for (const d of decisions) {
    if (d.kind === 'fourth') {
      const realCall = (d.yard >= 35 && (d.distance ?? 99) <= 5) || d.yard >= 52
      if (d.source !== 'user' && !realCall) continue
      const sit: Situation = { yard: d.yard, down: 4, distance: d.distance ?? 0, qtr: d.qtr, clockSec: 0, margin: d.margin }
      const ev = fourthDownEV(sit, kickPower)
      const allowed: ('go' | 'fg' | 'punt')[] = ev.fg == null ? ['go', 'punt'] : ['go', 'fg', 'punt']
      const evOf = (id: string) => (id === 'go' ? ev.go : id === 'fg' ? (ev.fg as number) : ev.punt)
      const best = allowed.reduce((a, b) => (evOf(b) > evOf(a) ? b : a), allowed[0])
      const agreed = d.choiceId === best
      const converted = fourthConverted(sim, playIndexOf(d.momentId), d.choiceId, d.distance ?? 0)
      const verb = d.choiceId === 'go' ? 'Went for it' : d.choiceId === 'fg' ? 'Kicked the FG' : 'Punted'
      pending.push({
        kind: 'fourth',
        name: `4th & ${d.distance} at ${d.yard >= 50 ? `their ${100 - d.yard}` : `your ${d.yard}`}`,
        pos: '—',
        college: '—',
        myGrade: agreed ? 90 : converted ? 76 : 45,
        hit: agreed || converted,
        note: `${verb} — staff EV said ${best}${converted && !agreed ? ' · converted' : ''}`,
      })
    } else if (d.kind === 'two' && d.source === 'user') {
      const best = twoPointChoice('chart', d.margin, d.qtr)
      const agreed = d.choiceId === best
      const converted = twoConverted(sim, playIndexOf(d.momentId))
      pending.push({
        kind: 'two',
        name: 'Two-point try',
        pos: '—',
        college: '—',
        myGrade: agreed ? 88 : converted ? 74 : 48,
        hit: agreed || converted,
        note: `${d.choiceId === 'go2' ? 'Went for two' : 'Kicked the PAT'} — chart said ${best}${converted && !agreed ? ' · converted' : ''}`,
      })
    }
  }

  // 5. Keep it readable: at most six entries a game.
  for (const e of pending.slice(0, 6)) pushLedger(career, e)
  return Math.min(6, pending.length)
}

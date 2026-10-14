// ─────────────────────────────────────────────────────────────────────────────
// Injury decisions (FUTURES #15 / L15).
//
// When one of the user's players is hurt going into a game, the club chooses:
// sit him (today's behaviour) or play him hurt. Playing hurt costs a slice of
// his physical ratings for that game and carries a per-player risk the injury
// worsens into a longer one. Sitting heals on the normal clock.
//
// Everything here is deterministic and hash-based (no rng draws), so it never
// perturbs the league sim. It plugs into the existing availability path: a
// played-hurt player's `injured` moves to `hurtSaved` and `hurt` is set, so the
// depth chart / play sim simply see an available player with lower ratings
// (see `ratings.ts:playerAttrs`). Every effect reads the specific player
// (durability, age, the injury) and the club's specific medical staff — never a
// team average. AI clubs never play hurt in v1 (the league stays unchanged).
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, HurtState, Player } from '../types'
import type { World } from './generate'
import { clamp, hash32 } from './rng'
import { POS_MEAN } from './ratingMeans'
import { playerAttrs } from '../data/ratings'
import { playoffPicture } from './playoffs'
import { ownerPersonality } from './owner'

export type InjuryStatus = 'Q' | 'D' | 'OUT'
export type InjuryCall = 'play' | 'sit'
export type MedicalGrade = 'A' | 'B' | 'C' | 'D'

const GRADES: MedicalGrade[] = ['A', 'B', 'C', 'D']

/** How much a grade bends the re-injury risk (A safest, D worst). */
export const MEDICAL_MULT: Record<MedicalGrade, number> = { A: 0.8, B: 0.9, C: 1, D: 1.25 }

/** Base aggravation chance by severity, before the player + staff scale it. */
export const RISK_BASE: Record<'Q' | 'D', number> = { Q: 0.12, D: 0.25 }

/** Deterministic multi-part hash: stable per (id, season, week, channel). */
function mix(id: string, ...salts: number[]): number {
  let h = 0
  for (const s of salts) h = (Math.imul(h, 2654435761) ^ (s >>> 0)) >>> 0
  return hash32(id, h)
}

/**
 * The medical staff a club can hire (FUTURES #28): a deterministic A–D grade,
 * fixed by the club with a `cheap` owner one grade lower. `world` is accepted so
 * the signature matches the seam the later hireable-Head-Trainer feature needs.
 */
export function medicalGrade(_world: World | undefined, teamId: string): MedicalGrade {
  let g = hash32(teamId, 905) % 4
  // A cost-conscious owner runs a leaner training room, one grade lower.
  if (ownerPersonality(teamId) === 'cheap') g = Math.min(3, g + 1)
  return GRADES[g]
}

export function medicalGradeLabel(grade: MedicalGrade): string {
  return `Grade ${grade}`
}

/**
 * The status for this week's game: Questionable would miss 1, Doubtful would
 * miss 2, Out is 3+ (or on IR, which is never a choice). Null when healthy.
 */
export function gameStatus(p: Player, world?: World, _career?: CareerState): InjuryStatus | null {
  // On injured reserve there is never a choice, injured flag or not.
  const ir = world?.ir?.[p.teamId ?? ''] ?? []
  if (ir.some((x) => x.id === p.id)) return 'OUT'
  if (!p.injured) return null
  const g = p.injured.games
  if (g >= 3) return 'OUT'
  if (g === 2) return 'D'
  return 'Q'
}

/**
 * A hurt player's slice of his physical ratings — the severity base, bent by the
 * medical grade, then scaled by his own durability and age so two players at the
 * same severity lose different amounts.
 */
export function hurtPenalty(p: Player, status: 'Q' | 'D', grade: MedicalGrade): { penalty: number; keyExtra: number } {
  const base = status === 'Q' ? 0.04 : 0.08
  const adj = grade === 'A' || grade === 'B' ? -0.01 : grade === 'D' ? 0.01 : 0
  // A durable player grimaces through it; a fragile one loses more.
  const tghMean = POS_MEAN[p.pos]?.TGH
  const tgh = playerAttrs(p).TGH ?? tghMean ?? 70
  const dur = tghMean === undefined ? 1 : clamp(1 + (tghMean - tgh) / 200, 0.85, 1.2)
  const age = clamp(1 + (p.age - 26) * 0.01, 0.92, 1.1)
  const penalty = clamp((base + adj) * dur * age, 0.02, 0.14)
  // A hurt quarterback's arm and a hurt back's ball security suffer a touch more.
  const keyExtra = p.pos === 'QB' || p.pos === 'RB' ? 0.05 : 0
  return { penalty, keyExtra }
}

/**
 * The per-player chance the injury worsens. Durability is the same TGH idea the
 * weekly `healPlayers` risk uses, steepened so real individual spread appears;
 * age and the medical grade scale it too. No team averages anywhere.
 */
export function aggravationRisk(p: Player, status: 'Q' | 'D', grade: MedicalGrade): number {
  const tghMean = POS_MEAN[p.pos]?.TGH
  const tgh = playerAttrs(p).TGH ?? tghMean ?? 70
  const durMult = tghMean === undefined ? 1 : clamp(1 + (tghMean - tgh) / 26, 0.45, 2.1)
  const ageMult = clamp(1 + (p.age - 26) * 0.06, 0.7, 1.6)
  return clamp(RISK_BASE[status] * durMult * ageMult * MEDICAL_MULT[grade], 0.01, 0.95)
}

export interface AggravationRoll {
  /** 0–1 the injury worsens. */
  risk: number
  /** The deterministic 0–1 draw this trial used (exposed for probes). */
  roll: number
  aggravated: boolean
  /** A Doubtful injury that ended the season (games = 99). */
  seasonEnding: boolean
  /** Extra games added on a hit (2–6). */
  extra: number
}

/**
 * The one place aggravation is rolled — a hash of the player, season, week and
 * channel, so it is deterministic and never touches the sim's rng stream.
 */
export function aggravationRoll(p: Player, status: 'Q' | 'D', grade: MedicalGrade, season: number, week: number): AggravationRoll {
  const risk = aggravationRisk(p, status, grade)
  const roll = (mix(p.id, season, week, 71) % 1000) / 1000
  const aggravated = roll < risk
  const extra = aggravated ? 2 + (mix(p.id, season, week, 72) % 5) : 0
  const seasonEnding = aggravated && status === 'D' && mix(p.id, season, week, 73) % 6 === 0
  return { risk, roll, aggravated, seasonEnding, extra }
}

const COARSE = ['low', 'moderate', 'elevated', 'serious']
const COARSE_STRONG = ['we advise against it', 'a real risk of losing him longer', 'the training room is uneasy']

/** The medical staff's line — an exact risk for A/B, coarse wording for C/D. */
export function medicalAdvice(p: Player, status: 'Q' | 'D', grade: MedicalGrade): string {
  const risk = aggravationRisk(p, status, grade)
  const note = p.injured?.note ?? 'injury'
  if (grade === 'A' || grade === 'B') {
    const oneIn = Math.max(3, Math.round(1 / risk))
    if (risk >= 0.34) return `Cleared with a brace, but ${note.toLowerCase()} — 1 in ${oneIn} he does more damage.`
    return `Cleared with a brace — about 1 in ${oneIn} re-injury risk.`
  }
  const band = risk < 0.08 ? 0 : risk < 0.16 ? 1 : risk < 0.28 ? 2 : 3
  const words = band < 3 ? `${COARSE[band]} risk` : COARSE_STRONG[mix(p.id, status === 'D' ? 12 : 11) % COARSE_STRONG.length]
  return `Our grade-${grade} read: ${words}.`
}

/** The user's club's top-22 OVR rank a player must beat to count as a starter. */
export function isStarter(world: World, teamId: string, p: Player): boolean {
  const top = (world.roster[teamId] ?? []).slice().sort((a, b) => b.ovr - a.ovr).slice(0, 22)
  return top.some((x) => x.id === p.id)
}

/**
 * A "push": week 12+, the club is still in the hunt and has not clinched. Used
 * for owner pressure and (later) the AI's willingness to run a hurt player out.
 */
export function inPlayoffPush(world: World, teamId: string): boolean {
  if (world.phase !== 'regular' || world.week < 12) return false
  const conf = world.byId[teamId]?.conference
  if (!conf) return false
  const pic = playoffPicture(world, conf)
  const me = [...pic.seeds, ...pic.inTheHunt].find((s) => s.teamId === teamId)
  if (!me) return false
  if (me.marker === 'z' || me.marker === 'y' || me.marker === 'x') return false
  return true
}

/** Does the club play this week (regular season)? */
export function hasGameThisWeek(world: World, teamId: string): boolean {
  if (world.phase !== 'regular') return false
  return world.schedule.some((g) => g.week === world.week && !g.played && (g.homeId === teamId || g.awayId === teamId))
}

export interface InjuryReportRow {
  player: Player
  status: InjuryStatus
  call: InjuryCall
  /** 0–1 re-injury chance while playing hurt (Q/D only). */
  risk: number
  /** Fraction of the physical ratings lost if he plays. */
  penalty: number
  /** Extra fraction lost on his position's key rating (QB/RB). */
  keyExtra: number
  advice: string
  grade: MedicalGrade
  /** The owner's reaction if he is sat in a push (0 outside a push). */
  security: number
}

/** The injured players on the user's club this week, with the call and its cost. */
export function injuryReport(world: World, career: CareerState): InjuryReportRow[] {
  const rows: InjuryReportRow[] = []
  const grade = medicalGrade(world, career.teamId)
  for (const p of world.roster[career.teamId] ?? []) {
    const status = gameStatus(p, world, career)
    if (!status) continue
    const call = career.injuryCalls?.[p.id] ?? 'sit'
    const risk = status === 'OUT' ? 0 : aggravationRisk(p, status, grade)
    const pen = status === 'OUT' ? { penalty: 0, keyExtra: 0 } : hurtPenalty(p, status, grade)
    const pressure = status === 'OUT' ? { security: 0 } : ownerPressure(world, career, p, call)
    rows.push({
      player: p,
      status,
      call,
      risk,
      penalty: pen.penalty,
      keyExtra: pen.keyExtra,
      advice: medicalAdvice(p, status === 'OUT' ? 'Q' : status, grade),
      grade,
      security: pressure.security,
    })
  }
  // Most serious first, then by rating so the stars read at the top.
  const order: Record<InjuryStatus, number> = { OUT: 0, D: 1, Q: 2 }
  return rows.sort((a, b) => order[a.status] - order[b.status] || b.player.ovr - a.player.ovr)
}

export interface OwnerPressure {
  /** Job-security swing for this one call (already signed). */
  security: number
  /** Leadership-reputation swing for this one call. */
  leadership: number
  /** The owner's line, or null when he has no opinion. */
  line: string | null
}

/**
 * What the owner thinks of one injury call in this week's context. Outside a
 * playoff push he is silent and the deltas are zero.
 */
export function ownerPressure(world: World, career: CareerState, p: Player, call: InjuryCall): OwnerPressure {
  if (call !== 'sit') return { security: 0, leadership: 0, line: null }
  const status = gameStatus(p, world, career)
  if (status !== 'Q' && status !== 'D') return { security: 0, leadership: 0, line: null }
  if (!inPlayoffPush(world, career.teamId)) return { security: 0, leadership: 0, line: null }
  if (!isStarter(world, career.teamId, p)) return { security: 0, leadership: 0, line: null }
  const owner = ownerPersonality(career.teamId)
  if (owner === 'patient') {
    return { security: 0, leadership: 1, line: `Sitting ${p.name} is the right long game. The owner approves.` }
  }
  const harsh = owner === 'win-now' || owner === 'meddling'
  const n = harsh ? 2 : 1
  return {
    security: -n,
    leadership: 0,
    line: `You sat ${p.name} in a game the owner wanted. He noticed.`,
  }
}

/**
 * Move a chosen "play" player's injury into `hurtSaved` and set `hurt`, so the
 * sim sees him as available with reduced ratings. Only Q/D players can play;
 * only the user's club is touched. Idempotent.
 */
export function activatePlayHurt(world: World, career: CareerState): void {
  const calls = career.injuryCalls
  if (!calls) return
  const grade = medicalGrade(world, career.teamId)
  for (const p of world.roster[career.teamId] ?? []) {
    if (p.hurt || calls[p.id] !== 'play') continue
    const status = gameStatus(p, world, career)
    if (status !== 'Q' && status !== 'D') continue
    const { penalty, keyExtra } = hurtPenalty(p, status, grade)
    p.hurtSaved = { games: p.injured!.games, note: p.injured!.note }
    p.hurt = { status, note: p.injured!.note, games: p.injured!.games, penalty, keyExtra }
    p.injured = undefined
  }
}

/**
 * Clear any leftover playing-hurt state without consequences. Used on abandon or
 * load, where the game was never played — the injury simply comes back untouched
 * (aggravation only happens once the game is recorded). Idempotent.
 */
export function normalizeInjuryState(world: World): void {
  for (const p of world.players) {
    if (!p.hurt && !p.hurtSaved) continue
    if (p.hurtSaved) p.injured = { games: p.hurtSaved.games, note: p.hurtSaved.note }
    p.hurt = undefined
    p.hurtSaved = undefined
  }
}

export interface InjuryRestoreResult {
  /** Season-story lines (played through it, or aggravated). */
  moments: { text: string; tone: 'info' | 'win' | 'loss' }[]
  /** Inbox headlines. */
  news: { headline: string; body: string }[]
  /** Job-security swing, already capped to ±3 for the week. */
  security: number
  /** Leadership-reputation swing from the owner's reads. */
  leadership: number
  /** Per-player morale swings (an aggravated starter costs the room). */
  morale: { playerId: string; delta: number }[]
  /** Cohesion swing, applied to the club's leaders by the store. */
  culture: number
  /** Names of players who ran out hurt this week. */
  played: string[]
  /** Names whose injury got worse. */
  aggravated: string[]
}

/**
 * Put every played-hurt player's injury back, roll the aggravation, and return
 * the owner/morale consequences. Called after the game (fast path) or at the top
 * of `advanceWeek` for a coached game — always before the week's `healPlayers`,
 * so the heal sees the same `injured` set a Sit week would. Idempotent.
 */
export function restorePlayHurt(world: World, career: CareerState, won = false): InjuryRestoreResult {
  const result: InjuryRestoreResult = {
    moments: [],
    news: [],
    security: 0,
    leadership: 0,
    morale: [],
    culture: 0,
    played: [],
    aggravated: [],
  }
  const calls = career.injuryCalls
  for (const p of world.players) {
    const hurt = p.hurt
    const saved = p.hurtSaved
    if (!hurt) continue
    p.hurt = undefined
    p.hurtSaved = undefined
    if (!saved) continue
    const teamId = p.teamId ?? career.teamId
    const grade = medicalGrade(world, teamId)
    const { aggravated, seasonEnding, extra } = aggravationRoll(p, hurt.status, grade, world.season, world.week)
    const games = aggravated ? (seasonEnding ? 99 : saved.games + extra) : saved.games
    p.injured = { games, note: aggravated ? `${saved.note} (aggravated)` : saved.note }
    result.played.push(p.name)
    if (aggravated) {
      result.aggravated.push(p.name)
      const length = seasonEnding ? 'the season' : `${games} more ${games === 1 ? 'game' : 'games'}`
      result.moments.push({ text: `${p.name} aggravated his ${saved.note.toLowerCase()} — out ${length}.`, tone: 'loss' })
      if (isStarter(world, teamId, p)) {
        result.morale.push({ playerId: p.id, delta: -8 })
        result.culture -= 1
      }
    } else {
      result.moments.push({ text: `${p.name} played through a ${hurt.note.toLowerCase()} and came out of it clean.`, tone: 'info' })
    }
  }

  // Owner pressure — only on decisions the user actually made this week.
  if (calls) {
    for (const p of world.roster[career.teamId] ?? []) {
      const pressure = ownerPressure(world, career, p, calls[p.id] ?? 'sit')
      if (!pressure.security && !pressure.leadership) continue
      result.security += pressure.security
      result.leadership += pressure.leadership
      if (pressure.line) result.moments.push({ text: pressure.line, tone: pressure.security < 0 ? 'loss' : 'info' })
    }
    // Playing hurt and winning earns a little credit with the owner.
    if (won && result.played.length) result.security += 1
  }

  result.security = clamp(result.security, -3, 3)
  result.leadership = clamp(result.leadership, -3, 3)
  if (result.played.length) {
    result.news.push({
      headline: result.aggravated.length ? `${result.aggravated.length} injury call worsened` : 'Played hurt and came out clean',
      body: result.played.join(', ') + (result.aggravated.length ? ` — aggravated: ${result.aggravated.join(', ')}.` : ' played through injury without setbacks.'),
    })
  }
  return result
}

// ── AI clubs ─────────────────────────────────────────────────────────────────
// OFF by default: when disabled nothing runs, so league injuries and every
// calibration band stay byte-identical (v1: AI clubs never play hurt). FUTURES
// #48 can promote this to a real staff seat; the decision reads the club's head
// coach rating + owner profile.
let aiEnabled = false
export function setAiInjuryCalls(v: boolean): void {
  aiEnabled = v
}
export function aiInjuryCallsEnabled(): boolean {
  return aiEnabled
}

/** The AI's own call for one Q/D player, from the coach profile and the race. */
export function aiInjuryCall(world: World, teamId: string, p: Player, status: 'Q' | 'D'): InjuryCall {
  const risk = aggravationRisk(p, status, medicalGrade(world, teamId))
  const owner = ownerPersonality(teamId)
  const hc = (world.staff[teamId] ?? []).find((m) => m.role === 'Head Coach')?.rating ?? 75
  let pPlay = 0.45 - risk * 0.9 // a scarier injury is sat more often
  pPlay += (hc - 75) * 0.004 // a sharper coach manages the roster
  if (inPlayoffPush(world, teamId)) pPlay += 0.3
  if (isStarter(world, teamId, p)) pPlay += 0.12
  if (owner === 'win-now' || owner === 'meddling') pPlay += 0.12
  if (owner === 'patient') pPlay -= 0.15
  pPlay = clamp(pPlay, 0.04, 0.92)
  const roll = (mix(p.id, world.season, world.week, 77) % 1000) / 1000
  return roll < pPlay ? 'play' : 'sit'
}

/**
 * Let every AI club make its injury calls for the week and apply the outcome.
 * The fast league sim reads team strength (not the injury list), so availability
 * changes no result — the effect is the aggravation outlook. No-op when the flag
 * is off. Deterministic (hash only).
 */
export function applyAiInjuryCalls(world: World, skipTeamId?: string): void {
  if (!aiEnabled) return
  for (const t of world.teams) {
    if (t.tier !== 'NFL' || t.id === skipTeamId) continue
    for (const p of world.roster[t.id] ?? []) {
      if (!p.injured) continue
      const status = gameStatus(p, world)
      if (status !== 'Q' && status !== 'D') continue
      if (aiInjuryCall(world, t.id, p, status) !== 'play') continue
      const { aggravated, extra } = aggravationRoll(p, status, medicalGrade(world, t.id), world.season, world.week)
      if (aggravated) p.injured = { games: p.injured.games + extra, note: `${p.injured.note} (aggravated)` }
    }
  }
}

/** Convenience: build the `hurt` state a caller would set (used by tests/probes). */
export function hurtStateFor(p: Player, status: 'Q' | 'D', teamId: string): HurtState {
  const { penalty, keyExtra } = hurtPenalty(p, status, medicalGrade(undefined, teamId))
  return { status, note: p.injured?.note ?? 'injury', games: p.injured?.games ?? 1, penalty, keyExtra }
}

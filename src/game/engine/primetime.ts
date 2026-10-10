// ─────────────────────────────────────────────────────────────────────────────
// Primetime & rivalry stakes (FUTURES #8, P1).
//
// A few games each season are national-TV games, and some are against a rival.
// Their results move the career needle (profile, job security, squad morale)
// more than a normal Sunday does, within season caps. Everything here is
// hash-based and draw-free: slots add no rng() calls, so schedule pairings and
// the sim stay byte-identical, and the swing is applied to the user's club only
// (AI clubs are untouched).
//
// UI copy uses generic night names ("Thursday Night", "Sunday Night",
// "Monday Night") — no network or league trademarks.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState } from '../types'
import { teamStrength, type Game, type World } from './generate'
import { clamp, hash32 } from './rng'
import { rivalFor } from './rivalry'
import { divisionRival } from './ambitions'

export type PrimetimeSlot = 'TNF' | 'SNF' | 'MNF'
export type RivalryKind = 'coach' | 'division' | 'both'
export type GameResult = 'win' | 'loss' | 'tie'

/** How many primetime games a club can get in one season. */
export const MAX_PRIMETIME = 5
/** The length of the regular season. */
export const REGULAR_WEEKS = 18
/** From this week on, the SNF game two weeks out is re-picked from current records. */
export const FLEX_FROM_WEEK = 11
/** How many weeks ahead the flex looks. */
export const FLEX_LOOKAHEAD = 2
/** Season caps on the stakes swing (keeps the `balance.ts` review in charge). */
export const SEASON_PROFILE_CAP = 4
export const SEASON_SECURITY_CAP = 6

/** A draw tiebreak only; no rng is consumed anywhere in this module. */
const DIV_DRAW_BONUS = 4
const RIVAL_DRAW_BONUS = 4

/** The slots a week carries: week 18 has no Thursday game. */
export function slotsForWeek(week: number): PrimetimeSlot[] {
  return week >= REGULAR_WEEKS ? ['SNF', 'MNF'] : ['TNF', 'SNF', 'MNF']
}

/** Generic labels for the inbox and (later) the UI. No branding. */
export const SLOT_LABEL: Record<PrimetimeSlot, string> = {
  TNF: 'Thursday Night',
  SNF: 'Sunday Night',
  MNF: 'Monday Night',
}

/** The primetime slot assigned to a game, if any. */
export function slotOf(game: Game): PrimetimeSlot | undefined {
  return game.slot as PrimetimeSlot | undefined
}

function sameDivision(world: World, a: string, b: string): boolean {
  const ta = world.byId[a]
  const tb = world.byId[b]
  return !!ta && !!tb && ta.conference === tb.conference && ta.division === tb.division
}

/** A per-pass memo of preseason team strength (roster-based; no drift within a season). */
function strengthLookup(world: World): (id: string) => number {
  const cache = new Map<string, number>()
  return (id: string) => {
    let v = cache.get(id)
    if (v === undefined) {
      v = teamStrength(world.roster[id] ?? [])
      cache.set(id, v)
    }
    return v
  }
}

/** Stable tiebreak for one game: hash32(seed, season, week) salted by the pairing. */
function tiebreak(world: World, g: Game): number {
  const salt = (world.seed ^ Math.imul(world.season, 1_000_003) ^ Math.imul(g.week, 7_919)) >>> 0
  return hash32(`${g.homeId}|${g.awayId}`, salt)
}

/** Preseason draw: both clubs' team strength plus a division/rival-coach bonus. */
function drawScore(world: World, g: Game, strength: (id: string) => number): number {
  let score = strength(g.homeId) + strength(g.awayId)
  if (sameDivision(world, g.homeId, g.awayId)) score += DIV_DRAW_BONUS
  if (rivalFor(world, g.homeId) || rivalFor(world, g.awayId)) score += RIVAL_DRAW_BONUS
  return score
}

/** The best game in a pool under the primetime cap: highest key, tiebreak, then a safe fallback. */
function pickGame(
  world: World,
  pool: Game[],
  counts: Record<string, number>,
  strength: (id: string) => number,
  flex: boolean,
): Game | undefined {
  const scored = pool.map((g) => {
    const r = world.standings
    const wins = flex ? (r[g.homeId]?.wins ?? 0) + (r[g.awayId]?.wins ?? 0) : 0
    return { g, key: flex ? wins : drawScore(world, g, strength), tie: tiebreak(world, g) }
  })
  scored.sort((a, b) => b.key - a.key || b.tie - a.tie || (a.g.id < b.g.id ? -1 : 1))
  let fallback: Game | undefined
  for (const s of scored) {
    const h = counts[s.g.homeId] ?? 0
    const a = counts[s.g.awayId] ?? 0
    if (h < MAX_PRIMETIME && a < MAX_PRIMETIME) return s.g
    if (!fallback) fallback = s.g
  }
  return fallback
}

/** Assign one week's slots. `onlyUnplayed` keeps played/assigned games fixed (backfill). */
function assignWeek(
  world: World,
  week: number,
  counts: Record<string, number>,
  strength: (id: string) => number,
  onlyUnplayed: boolean,
): void {
  const games = world.schedule.filter((g) => g.week === week)
  if (!games.length) return
  const used = new Set<string>()
  for (const slot of slotsForWeek(week)) {
    if (onlyUnplayed) {
      const held = games.find((g) => g.slot === slot)
      if (held) {
        used.add(held.id)
        continue
      }
    }
    const pool = games.filter((g) => !used.has(g.id) && (!onlyUnplayed || !g.slot) && (!onlyUnplayed || !g.played))
    const pick = pickGame(world, pool, counts, strength, false)
    if (!pick) continue
    pick.slot = slot
    used.add(pick.id)
    counts[pick.homeId] = (counts[pick.homeId] ?? 0) + 1
    counts[pick.awayId] = (counts[pick.awayId] ?? 0) + 1
  }
}

/**
 * (Re)assign every regular-season slot for the world. Deterministic and idempotent:
 * calling it twice on the same world yields identical slots. No rng draws.
 */
export function assignSlots(world: World): void {
  const counts: Record<string, number> = {}
  const strength = strengthLookup(world)
  for (const g of world.schedule) g.slot = undefined
  for (let week = 1; week <= REGULAR_WEEKS; week++) assignWeek(world, week, counts, strength, false)
}

/**
 * Backfill slots on a legacy save. Only games without a slot are assigned
 * (played games and already-slotted games are left alone), so a save that has
 * already flexed keeps its flexed slots.
 */
export function ensureSlots(world: World): void {
  const reg = world.schedule.filter((g) => g.week >= 1 && g.week <= REGULAR_WEEKS)
  if (!reg.length) return
  const unplayed = reg.filter((g) => !g.played)
  if (!unplayed.length || unplayed.every((g) => g.slot)) return
  const counts: Record<string, number> = {}
  for (const g of reg) {
    if (!g.slot) continue
    counts[g.homeId] = (counts[g.homeId] ?? 0) + 1
    counts[g.awayId] = (counts[g.awayId] ?? 0) + 1
  }
  const strength = strengthLookup(world)
  for (let week = 1; week <= REGULAR_WEEKS; week++) assignWeek(world, week, counts, strength, true)
}

/**
 * Week rollover flex: from week 11 on, the Sunday Night game two weeks out is
 * re-picked from current records. Deterministic; the primetime cap still holds.
 */
export function flexSlots(world: World, week: number): void {
  if (week < FLEX_FROM_WEEK || week > REGULAR_WEEKS) return
  const target = week + FLEX_LOOKAHEAD
  if (target > REGULAR_WEEKS) return
  const games = world.schedule.filter((g) => g.week === target)
  if (!games.length) return
  const current = games.find((g) => g.slot === 'SNF')
  const counts: Record<string, number> = {}
  for (const g of world.schedule) {
    if (!g.slot || g === current) continue
    counts[g.homeId] = (counts[g.homeId] ?? 0) + 1
    counts[g.awayId] = (counts[g.awayId] ?? 0) + 1
  }
  const strength = strengthLookup(world)
  const pick = pickGame(world, games, counts, strength, true)
  if (current) current.slot = undefined
  if (pick) pick.slot = 'SNF'
}

/** How the opponent is a rival of the user's club, if at all. */
export function rivalryKind(world: World, career: CareerState, oppId: string): RivalryKind | null {
  if (!career || !oppId || oppId === career.teamId) return null
  const coach = !!rivalFor(world, oppId)
  const division = oppId === divisionRival(world, career)
  if (coach && division) return 'both'
  if (coach) return 'coach'
  if (division) return 'division'
  return null
}

export interface Stakes {
  slot?: PrimetimeSlot
  rivalry: RivalryKind | null
  /** 1.0 normal, 1.5 primetime or rivalry, 2.0 when both apply. */
  mult: number
}

/** The stakes on a game: its slot and/or rivalry, and the swing multiplier. */
export function stakesFor(world: World, career: CareerState, game: Game): Stakes {
  const oppId = game.homeId === career.teamId ? game.awayId : game.homeId
  const slot = slotOf(game)
  const rivalry = rivalryKind(world, career, oppId)
  let mult = 1
  if (slot && rivalry) mult = 2
  else if (slot || rivalry) mult = 1.5
  return { slot, rivalry, mult }
}

export interface StakesSwing {
  profile: number
  security: number
  morale: number
}

/**
 * The swing from a stakes game, scaled by `mult`. Pure; multipliers read off the
 * spec table (win +1/+1/+2; loss −1/−1, −2/−3 by 17+; a 1–3 point thriller adds
 * profile +1 either way).
 */
export function primetimeSwing(result: GameResult, margin: number, stakes: Stakes): StakesSwing {
  const m = stakes.mult
  let profile = 0
  let security = 0
  let morale = 0
  if (result === 'win') {
    profile = 1
    security = 1
    morale = 2
  } else if (result === 'loss') {
    if (margin <= -17) {
      security = -2
      morale = -3
    } else {
      security = -1
      morale = -1
    }
  }
  if (result !== 'tie' && margin !== 0 && Math.abs(margin) <= 3) profile += 1
  return { profile: profile * m, security: security * m, morale: morale * m }
}

/**
 * Apply the swing to the user's club only, honouring the season caps
 * (`profile` +4, `security` ±6). Morale moves every player on the user's roster;
 * no cap applies to morale. Returns the updated career.
 */
export function applyStakesSwing(world: World, career: CareerState, swing: StakesSwing): CareerState {
  const prior =
    career.stakes && career.stakes.season === world.season
      ? career.stakes
      : { season: world.season, profile: 0, security: 0 }
  const profileAdd = Math.max(0, Math.min(SEASON_PROFILE_CAP - prior.profile, swing.profile))
  const secAfter = clamp(prior.security + swing.security, -SEASON_SECURITY_CAP, SEASON_SECURITY_CAP)
  const securityAdd = secAfter - prior.security

  if (swing.morale) {
    for (const p of world.roster[career.teamId] ?? []) p.morale = clamp(p.morale + swing.morale, 1, 100)
  }

  return {
    ...career,
    reputation: profileAdd
      ? { ...career.reputation, profile: clamp(career.reputation.profile + profileAdd, 0, 100) }
      : career.reputation,
    jobSecurity: securityAdd ? clamp(career.jobSecurity + securityAdd, 0, 100) : career.jobSecurity,
    stakes: { season: world.season, profile: prior.profile + profileAdd, security: secAfter },
  }
}

function rivalryLabel(kind: RivalryKind, oppName: string, coachName?: string): string {
  if (kind === 'division') return `division rival ${oppName}`
  if (kind === 'coach') return coachName ? `${coachName}'s ${oppName}` : `rival ${oppName}`
  return `rivalry with ${oppName}`
}

/** The owner's inbox note for a stakes game. Generic night names only. */
export function stakesNote(
  world: World,
  career: CareerState,
  game: Game,
  stakes: Stakes,
  result: GameResult,
  swing: StakesSwing,
): { headline: string; body: string } {
  const oppId = game.homeId === career.teamId ? game.awayId : game.homeId
  const oppName = world.byId[oppId]?.name ?? 'opponent'
  const coach = stakes.rivalry === 'coach' || stakes.rivalry === 'both' ? rivalFor(world, oppId)?.name : undefined
  const tags: string[] = []
  if (stakes.slot) tags.push(SLOT_LABEL[stakes.slot])
  if (stakes.rivalry) tags.push(rivalryLabel(stakes.rivalry, oppName, coach))
  const tag = tags.join(' · ')
  const verb = result === 'win' ? 'win' : result === 'loss' ? 'loss' : 'tie'
  const headline = tag ? `${tag}: ${verb}` : `Rivalry ${verb}`

  const lines: string[] = []
  if (stakes.slot) lines.push('The national audience saw how your club handled the spotlight.')
  if (stakes.rivalry) lines.push('The owner knows what this one means to the building.')
  const signed = (n: number, label: string) => `${n > 0 ? '+' : ''}${n} ${label}`
  const deltas: string[] = []
  if (swing.profile) deltas.push(signed(swing.profile, 'profile'))
  if (swing.security) deltas.push(signed(swing.security, 'job security'))
  if (swing.morale) deltas.push(signed(swing.morale, 'squad morale'))
  if (deltas.length) lines.push(`This week: ${deltas.join(', ')}.`)
  const cap = career.stakes
  if (cap && cap.season === world.season) {
    lines.push(`Season swing so far: ${signed(cap.profile, 'profile')}, ${signed(cap.security, 'job security')}.`)
  }
  return { headline, body: lines.join(' ') }
}

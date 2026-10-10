// ─────────────────────────────────────────────────────────────────────────────
// Playbook mastery & team cohesion.
//
// Mastery is NOT individual loyalty. A player learns the system through reps and
// training, but his ceiling is set by COLLECTIVE CONTINUITY — whether his unit
// and his coaches have stayed together long enough to build chemistry.
//
// Churn on either side breaks it:
//   • Replace the offensive line every year and the QB never gets comfortable.
//   • Change coordinators every season and nobody ever masters the playbook.
//   • Keep a core and a staff together and the whole unit plays above its rating.
// ─────────────────────────────────────────────────────────────────────────────

import type { GameStatLine, Player, PlaybookState } from '../types'
import type { StaffMember } from '../types'
import { playerAttrs } from '../data/ratings'
import { STARTERS } from './depth'
import { hash32 } from './rng'
import { coverageGrade, passerRating } from './stats'
import { schemeFit } from './style'

/** Per-game learning from live snaps (raw experience). */
const REP_GAIN_PER_GAME = 1.6
/** Per-season learning from OTAs, camp, and practice reps (raw experience). */
const TRAINING_GAIN_PER_SEASON = 14

/** Team side a player belongs to. */
const sideOf = (p: Player) => (p.side === 'DEF' ? 'DEF' : 'OFF')

/** Younger players learn faster; older players plateau. */
function ageFactor(age: number): number {
  if (age <= 23) return 1.25
  if (age <= 26) return 1.1
  if (age <= 29) return 1.0
  if (age <= 32) return 0.85
  return 0.7
}

/** Dev trait drives how quickly a player picks up the system. */
function devFactor(dev: Player['dev']): number {
  const map: Record<Player['dev'], number> = {
    'X-Factor': 1.35, Superstar: 1.2, Star: 1.1, Starter: 1.0, Depth: 0.92, Backup: 0.85,
  }
  return map[dev] ?? 1
}

/**
 * Continuity of the staff, 0-1. A coordinator who has been in place for years
 * gives the whole side of the ball a stable system; a new one resets everyone.
 * `tenure` is seasons the current coordinator has held the job.
 */
export function staffContinuity(tenure: number): number {
  // year 1 = 0.35, rising to 1.0 after ~4 years together.
  return Math.min(1, 0.35 + tenure * 0.22)
}

/**
 * Continuity of the player's unit, 0-1. Measures how much of the surrounding
 * group (same side of the ball) has also been together. `avgTeamYears` is the
 * mean tenure of the unit.
 */
export function unitContinuity(avgTeamYears: number): number {
  // Everything new = 0.3; a settled unit reaches 1.0 around 5 years.
  return Math.min(1, 0.3 + avgTeamYears * 0.14)
}

/** Cohesion = staff stability × unit familiarity. Caps how well anyone can learn. */
export function cohesion(staffTenure: number, unitAvgYears: number): number {
  return staffContinuity(staffTenure) * unitContinuity(unitAvgYears)
}

/** The highest mastery this player can reach given his own fit and team cohesion. */
export function masteryCeiling(fit: number, cohesionValue: number): number {
  // Fit sets the personal ceiling (55% for a mismatch, 100% for an ideal fit);
  // cohesion scales how much of that ceiling is actually reachable.
  const personalCeiling = 55 + fit * 45
  const cohesionFloor = 0.5 // even a brand-new team reaches half its ceiling
  return Math.round(personalCeiling * (cohesionFloor + cohesionValue * (1 - cohesionFloor)))
}

/** Ensure a player has a playbook state for the scheme/team he's currently in. */
export function initPlaybook(
  _p: Player,
  teamId: string,
  scheme: string,
  prev?: PlaybookState,
  staffTenure = 1,
  unitAvgYears = 1,
): PlaybookState {
  const coh = cohesion(staffTenure, unitAvgYears)
  if (prev && prev.scheme === scheme && prev.teamId === teamId) {
    return { ...prev, staffYears: staffTenure, cohesion: coh }
  }
  // Scheme or team changed — experience resets, but a veteran keeps a small head start.
  const carried = prev ? Math.min(prev.experience * 0.15, 8) : 0
  return {
    pct: 0,
    experience: Math.round(carried),
    reps: 0,
    teamYears: 0,
    staffYears: staffTenure,
    cohesion: coh,
    scheme,
    teamId,
  }
}

/** Recompute the cohesion cap and clamp mastery to it. */
function applyCap(s: PlaybookState, fit: number): PlaybookState {
  const ceiling = masteryCeiling(fit, s.cohesion)
  const pct = Math.min(ceiling, Math.round(s.experience * (ceiling / 100)))
  return { ...s, pct: Math.max(0, Math.min(100, pct)) }
}

// ── L12.13 M1: realistic starting mastery ────────────────────────────────────
/**
 * The seasons a player is estimated to have been in his current system. Rookies
 * are new (0); everyone else is deterministic from his id (1..min(age−22, 7)),
 * and no one can predate the coordinator who installed the system.
 */
export function systemYears(p: Player, staffTenure: number): number {
  const byAge = Math.min(p.age - 22, 7)
  if (byAge <= 0) return 0
  const est = 1 + (hash32(p.id) % byAge)
  return Math.min(est, Math.max(1, staffTenure))
}

/** Raw experience for a player who has been in the system `years` (≈12–16/yr). */
function seededExperience(id: string, years: number): number {
  if (years <= 0) return 0
  return Math.min(100, years * (12 + (hash32(`${id}:seed`) % 5)))
}

/** A fresh-world playbook seeded from a player's estimated years in the system. */
export function seedStartingPlaybook(p: Player, teamId: string, scheme: string, staffTenure: number): PlaybookState {
  const years = systemYears(p, staffTenure)
  return applyCap(
    {
      pct: 0,
      experience: seededExperience(p.id, years),
      reps: years * 15,
      teamYears: 0,
      staffYears: staffTenure,
      cohesion: cohesion(staffTenure, Math.max(1, years)),
      scheme,
      teamId,
    },
    schemeFit(p, scheme, sideOf(p)),
  )
}

/**
 * Seed a brand-new world's playbooks: long-tenured vets know the system, rookies
 * and clubs with a new coordinator start near zero. Experience is seeded per
 * player; the cohesion cap is the unit's, so it starts fresh and then grows
 * through the season-end refresh.
 */
export function seedWorldMastery(world: {
  roster: Record<string, Player[]>
  staff: Record<string, StaffMember[]>
  staffTenure: Record<string, number>
}): void {
  for (const [teamId, players] of Object.entries(world.roster)) {
    for (const side of ['off', 'def'] as const) {
      const unit = players.filter((p) => (p.side === 'DEF' ? 'def' : 'off') === side)
      if (!unit.length) continue
      const role = side === 'off' ? 'Offensive Coordinator' : 'Defensive Coordinator'
      const scheme = (world.staff[teamId] ?? []).find((s) => s.role === role)?.scheme ?? ''
      const tenure = world.staffTenure[`${teamId}:${side}`] ?? 1
      const seeded = unit.map((p) => seedStartingPlaybook(p, teamId, scheme, tenure))
      const avgYears = Math.max(1, seeded.reduce((a, s) => a + s.teamYears, 0) / seeded.length)
      const coh = cohesion(tenure, avgYears)
      unit.forEach((p, i) => {
        p.playbook = applyCap({ ...seeded[i], cohesion: coh, staffYears: tenure }, schemeFit(p, scheme, sideOf(p)))
      })
    }
  }
}

// ── L12.13 M2: learning from snaps and production ────────────────────────────
/** Snap share a depth rank implies: starter 1.0, rotation 0.5, scraps 0.15. */
export function snapShare(rank: number, pos: Player['pos']): number {
  const starters = STARTERS[pos] ?? 1
  if (rank < starters) return 1
  if (rank < starters + 2) return 0.5
  return 0.15
}

/**
 * A 0–1 grade for one game's production, relative to what is normal at the
 * position, so a good day learns the system faster than a quiet one.
 */
export function gameProduction(pos: Player['pos'], line: GameStatLine): number {
  const unit = (x: number) => Math.max(0, Math.min(1, x))
  switch (pos) {
    case 'QB':
      return unit(passerRating(line) / 110)
    case 'RB': {
      const att = line.rushAtt ?? 0
      const ypc = att > 0 ? (line.rushYds ?? 0) / att : 0
      return unit((ypc / 5) * 0.6 + ((line.rushYds ?? 0) / 70) * 0.4)
    }
    case 'WR':
    case 'TE': {
      const tgt = line.targets ?? 0
      const ypt = tgt > 0 ? (line.recYds ?? 0) / tgt : 0
      return unit((ypt / 9) * 0.6 + ((line.recYds ?? 0) / 70) * 0.4)
    }
    case 'OT':
    case 'OG':
    case 'C':
      return 0.5
    case 'DE':
    case 'DT':
      return unit(((line.tackles ?? 0) / 4) * 0.5 + (line.defSacks ?? 0) * 0.4 + (line.tfl ?? 0) * 0.1)
    case 'LB':
      return unit(((line.tackles ?? 0) / 7) * 0.6 + (line.defSacks ?? 0) * 0.2 + (line.defInts ?? 0) * 0.2)
    case 'CB':
    case 'S': {
      const cov = coverageGrade(line)
      return unit(((cov ?? 50) / 100) * 0.7 + (line.defInts ?? 0) * 0.3)
    }
    default:
      return 0.5
  }
}

/**
 * L12.13 M2: advance mastery after a game. The gain scales with how much the
 * player was on the field (snap share), how well he played (position-relative
 * production), his awareness, and his position coach; Install's ×1.25 folds in
 * through `gainMult`. No rng is drawn here.
 */
export function gainGameReps(
  p: Player,
  played: boolean,
  snapShare = 1,
  production = 0.5,
  gainMult = 1,
  development = 1,
): PlaybookState | undefined {
  if (!p.playbook) return undefined
  if (!played) return p.playbook
  const fit = schemeFit(p, p.playbook.scheme, sideOf(p))
  const attrs = playerAttrs(p)
  const awr = attrs.AWR ?? 70
  const gain =
    REP_GAIN_PER_GAME * ageFactor(p.age) * devFactor(p.dev) * snapShare *
    (0.9 + 0.2 * production) * (1 + (awr - 70) / 200) * development * gainMult
  const before = p.playbook.pct
  const experience = Math.min(100, p.playbook.experience + gain)
  const next = applyCap({ ...p.playbook, reps: p.playbook.reps + 1, experience }, fit)
  return { ...next, seasonGain: (p.playbook.seasonGain ?? 0) + Math.max(0, next.pct - before) }
}

/** Advance raw experience between seasons (training, OTAs, camp) and add a team year. */
export function gainSeasonTraining(p: Player): PlaybookState | undefined {
  if (!p.playbook) return undefined
  const fit = schemeFit(p, p.playbook.scheme, sideOf(p))
  const gain = TRAINING_GAIN_PER_SEASON * ageFactor(p.age) * devFactor(p.dev)
  const experience = Math.min(100, p.playbook.experience + gain)
  return applyCap({ ...p.playbook, teamYears: p.playbook.teamYears + 1, experience, seasonGain: 0 }, fit)
}

/** Update the cohesion cap and re-clamp mastery (called whenever a unit changes). */
export function refreshCohesion(p: Player, staffTenure: number, unitAvgYears: number): PlaybookState | undefined {
  if (!p.playbook) return undefined
  const fit = schemeFit(p, p.playbook.scheme, sideOf(p))
  const coh = cohesion(staffTenure, unitAvgYears)
  return applyCap({ ...p.playbook, staffYears: staffTenure, cohesion: coh }, fit)
}

/** Reset mastery when a player changes teams. */
export function onTeamChange(p: Player, newTeamId: string, newScheme: string, staffTenure = 1): PlaybookState {
  return initPlaybook(p, newTeamId, newScheme, p.playbook, staffTenure, 1)
}

/** The stable coordinator identity a tenure tick remembers per club+side. */
export interface StaffTenureRef {
  id: string
  scheme: string
}

/** The slice of the world the tenure tick reads/writes. */
export interface TenureWorld {
  staff: Record<string, StaffMember[]>
  staffTenure: Record<string, number>
  /** Optional: legacy saves have none until the first tick records it. */
  staffTenureRef?: Record<string, StaffTenureRef>
}

/**
 * Backlog 185: advance one season of coordinator continuity.
 *
 * `world.staffTenure[key]` (key `${teamId}:off|def`) counts consecutive seasons
 * the coordinator on that side has held the job. It must reset to 1 when the MAN
 * changes OR when the same man switches scheme — otherwise a new system keeps
 * inheriting the old staff's cohesion and mastery cap keeps climbing.
 *
 * `staffTenureRef` remembers the id+scheme the last tick saw. Migration-safe: an
 * old save has no ref entry, so the current coordinator is treated as unchanged
 * (no spurious reset) and simply recorded. A vacancy records a blank sentinel so
 * that whoever is hired next resets the count rather than inheriting it.
 */
export function advanceStaffTenure(world: TenureWorld): void {
  const refs = (world.staffTenureRef ??= {})
  for (const key of Object.keys(world.staffTenure)) {
    const [teamId, side] = key.split(':')
    const role = side === 'off' ? 'Offensive Coordinator' : 'Defensive Coordinator'
    const coach = (world.staff[teamId] ?? []).find((s) => s.role === role)
    if (!coach) {
      world.staffTenure[key] = 1
      refs[key] = { id: '', scheme: '' }
      continue
    }
    const prev = refs[key]
    const changed = !!prev && (prev.id !== coach.id || prev.scheme !== coach.scheme)
    world.staffTenure[key] = changed ? 1 : (world.staffTenure[key] ?? 1) + 1
    refs[key] = { id: coach.id, scheme: coach.scheme }
  }
}

/**
 * Production multiplier from mastery. 0% = 0.90 (still learning), 100% = 1.18.
 */
export function masteryMultiplier(p: Player): number {
  const pct = p.playbook?.pct ?? 0
  return 0.9 + (pct / 100) * 0.28
}

// ── L12.13 M3: mastery relative to the league mean ───────────────────────────
export type MasteryGroup = 'QB' | 'RB' | 'REC' | 'OL' | 'DL' | 'LB' | 'DB'
export interface MasteryMeans {
  QB: number
  RB: number
  REC: number
  OL: number
  DL: number
  LB: number
  DB: number
}

/** The position group a mastery effect belongs to (ST and specialists: none). */
export function masteryGroup(pos: string): MasteryGroup | null {
  switch (pos) {
    case 'QB': return 'QB'
    case 'RB': return 'RB'
    case 'WR': case 'TE': return 'REC'
    case 'OT': case 'OG': case 'C': return 'OL'
    case 'DE': case 'DT': return 'DL'
    case 'LB': return 'LB'
    case 'CB': case 'S': return 'DB'
    default: return null
  }
}

/**
 * League mean mastery per position group, so an average club's edge is 0.
 * Centered on the players who actually take the field (starters): a bench
 * player's offset is negative, an above-average starter's is positive.
 */
export function leagueMasteryMeans(world: { players: Player[]; roster?: Record<string, Player[]> }): MasteryMeans {
  const sum: Record<string, number> = {}
  const count: Record<string, number> = {}
  const add = (p: Player) => {
    if (!p.playbook) return
    const g = masteryGroup(p.pos)
    if (!g) return
    sum[g] = (sum[g] ?? 0) + p.playbook.pct
    count[g] = (count[g] ?? 0) + 1
  }
  const roster = world.roster
  if (roster && Object.keys(roster).length) {
    for (const players of Object.values(roster)) {
      const byPos: Partial<Record<Player['pos'], Player[]>> = {}
      for (const p of players) (byPos[p.pos] ??= []).push(p)
      for (const [pos, list] of Object.entries(byPos)) {
        if (!list) continue
        const n = STARTERS[pos as Player['pos']] ?? 1
        list.sort((a, b) => b.ovr - a.ovr).slice(0, n).forEach(add)
      }
    }
  } else {
    for (const p of world.players) add(p)
  }
  const m = (g: MasteryGroup) => (count[g] ? sum[g] / count[g] : 0)
  return { QB: m('QB'), RB: m('RB'), REC: m('REC'), OL: m('OL'), DL: m('DL'), LB: m('LB'), DB: m('DB') }
}

/** L12.13 M4: a one-line "how mastery shows up in games" read for the tooltip. */
export function masteryEffectText(p: Player, mean: number): string {
  const rel = (p.playbook?.pct ?? 0) - mean
  const f = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`
  switch (masteryGroup(p.pos)) {
    case 'QB': return `reads ${f(rel * 0.04)}, accuracy ${f(rel * 0.025)}`
    case 'REC': return `separation ${f(rel * 0.03)}, hands ${f(rel * 0.02)}`
    case 'OL': return `pass pro ${f(rel * 0.03)}, run block ${f(rel * 0.03)}`
    case 'DL': return `run fits ${f(rel * 0.03)}, rush ${f(rel * 0.025)}`
    case 'LB': return `run fits ${f(rel * 0.03)}, coverage ${f(rel * 0.02)}`
    case 'DB': return `coverage ${f(rel * 0.03)}, run fits ${f(rel * 0.02)}`
    default: return ''
  }
}

/** 0-100 mastery for the UI. */
export function masteryProgress(p: Player): number {
  return Math.round(p.playbook?.pct ?? 0)
}

/** Human label for a mastery level. */
export function masteryLabel(pct: number): { label: string; tone: 'loss' | 'warn' | 'info' | 'win' } {
  if (pct >= 92) return { label: 'Mastered', tone: 'win' }
  if (pct >= 75) return { label: 'Fluent', tone: 'win' }
  if (pct >= 55) return { label: 'Comfortable', tone: 'info' }
  if (pct >= 30) return { label: 'Learning', tone: 'warn' }
  return { label: 'New to system', tone: 'loss' }
}

/** A read on a team's cohesion, for the UI. */
export function cohesionLabel(c: number): { label: string; tone: 'loss' | 'warn' | 'info' | 'win' } {
  if (c >= 0.85) return { label: 'Tight-knit', tone: 'win' }
  if (c >= 0.65) return { label: 'Settled', tone: 'win' }
  if (c >= 0.45) return { label: 'Building', tone: 'info' }
  if (c >= 0.3) return { label: 'Turnover', tone: 'warn' }
  return { label: 'Constant churn', tone: 'loss' }
}

// ── Team-level reads (the "Culture" panel and on-field effects) ───────────────

/** Which side of the ball a player counts toward for unit cohesion (ST → offense). */
const unitSide = (p: Player): 'off' | 'def' => (p.side === 'DEF' ? 'def' : 'off')

/** Cohesion for one side of the ball, averaged across the unit. 0-1. */
export function sideCohesion(players: Player[], side: 'off' | 'def', staffYears: number): number {
  const unit = players.filter((p) => unitSide(p) === side)
  if (!unit.length) return 0.5
  const avgYears = unit.reduce((s, p) => s + (p.playbook?.teamYears ?? 0), 0) / unit.length
  return cohesion(staffYears, Math.max(1, avgYears))
}

export interface UnitCohesion {
  cohesion: number
  /** Consecutive seasons the coordinator has held the job. */
  staffYears: number
  /** Average consecutive seasons the players have been with the team. */
  unitYears: number
  /** Average playbook mastery (0-100). */
  mastery: number
  /** Share of the unit that is an ideal scheme fit (0-100). */
  fitPct: number
  count: number
}

/** Everything the Culture panel needs for one side of the ball. */
export function unitCohesion(
  players: Player[],
  side: 'off' | 'def',
  scheme: string,
  staffYears: number,
): UnitCohesion {
  const unit = players.filter((p) => unitSide(p) === side)
  if (!unit.length) {
    return { cohesion: 0.5, staffYears, unitYears: 0, mastery: 0, fitPct: 0, count: 0 }
  }
  const avgYears = unit.reduce((s, p) => s + (p.playbook?.teamYears ?? 0), 0) / unit.length
  const mastery = unit.reduce((s, p) => s + (p.playbook?.pct ?? 0), 0) / unit.length
  const ideal = unit.filter((p) => schemeFit(p, scheme, side === 'def' ? 'DEF' : 'OFF') >= 0.95).length
  return {
    cohesion: cohesion(staffYears, Math.max(1, avgYears)),
    staffYears,
    unitYears: avgYears,
    mastery,
    fitPct: (ideal / unit.length) * 100,
    count: unit.length,
  }
}

export interface TeamCohesion {
  off: number
  def: number
  avg: number
}

/** Compact team cohesion, used by the sim to price continuity. */
export function teamCohesion(
  players: Player[],
  staffTenure: Record<string, number>,
  teamId: string,
): TeamCohesion {
  const tenure = staffTenure ?? {}
  const off = sideCohesion(players, 'off', tenure[`${teamId}:off`] ?? 1)
  const def = sideCohesion(players, 'def', tenure[`${teamId}:def`] ?? 1)
  return { off, def, avg: (off + def) / 2 }
}

/**
 * Penalty modifier from continuity. A settled team commits far fewer flags;
 * constant churn costs you field position (multiplier ~0.75..1.15).
 */
export function cohesionDiscipline(c: number): number {
  return Math.max(0.75, Math.min(1.15, 1.15 - c * 0.45))
}

/**
 * Situational edge from continuity, roughly −0.5..+0.7. Settled teams execute
 * better on money downs and in the red zone; churned ones press and stall.
 */
export function cohesionSituational(c: number): number {
  return (c - 0.55) * 0.9
}

export type { StaffMember }

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

import type { Player, PlaybookState } from '../types'
import type { StaffMember } from '../types'
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

/** Advance raw experience after a game in which the player saw the field. */
export function gainGameReps(p: Player, played: boolean): PlaybookState | undefined {
  if (!p.playbook) return undefined
  if (!played) return p.playbook
  const fit = schemeFit(p, p.playbook.scheme, sideOf(p))
  const gain = REP_GAIN_PER_GAME * ageFactor(p.age) * devFactor(p.dev)
  const experience = Math.min(100, p.playbook.experience + gain)
  return applyCap({ ...p.playbook, reps: p.playbook.reps + 1, experience }, fit)
}

/** Advance raw experience between seasons (training, OTAs, camp) and add a team year. */
export function gainSeasonTraining(p: Player): PlaybookState | undefined {
  if (!p.playbook) return undefined
  const fit = schemeFit(p, p.playbook.scheme, sideOf(p))
  const gain = TRAINING_GAIN_PER_SEASON * ageFactor(p.age) * devFactor(p.dev)
  const experience = Math.min(100, p.playbook.experience + gain)
  return applyCap({ ...p.playbook, teamYears: p.playbook.teamYears + 1, experience }, fit)
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

/**
 * Production multiplier from mastery. 0% = 0.90 (still learning), 100% = 1.18.
 */
export function masteryMultiplier(p: Player): number {
  const pct = p.playbook?.pct ?? 0
  return 0.9 + (pct / 100) * 0.28
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

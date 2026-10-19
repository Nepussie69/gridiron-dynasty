// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #48 — medical-staff probe (pure; no React, no DOM, no store).
//
// The node acceptance probe boots a real career and calls this per seed. Every
// check runs on a light club stub (this club's own players + seats cloned, the
// rest of the world shared read-only), so a probe of a whole league costs no
// world-sized copy. It proves:
//   • a vacant seat is EXACTLY neutral (prevention/rehab = 1.000, risk = 0) and a
//     vacant week writes nothing — the whole league and every old save unchanged;
//   • the incumbent grade still reproduces #15's hash grade (its public behaviour);
//   • the channels are ordered elite < neutral < poor, for every single player;
//   • they are sized PER PERSON (same seat, a real spread by the man's own TGH/age);
//   • the expected-return band narrows with a better physician;
//   • a derived sheet (old save, no `med`) lands in range and is deterministic;
//   • the misdiagnosis share and the re-injury rate separate by physician quality,
//     measured through the real `runMedicalWeek` path over a whole season of weeks;
//   • an "old save" (no med fields at all) loads and behaves as a no-op.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, MedicalSubs, Player, StaffMember } from '../types'
import type { World } from './generate'
import { hash32 } from './rng'
import { ownerPersonality } from './owner'
import { POS_MEAN } from './ratingMeans'
import { playerAttrs } from '../data/ratings'
import {
  MEDICAL_ROLES,
  channelRating,
  diagnosisRisk,
  expectedReturn,
  incumbentGrade,
  medicalSubs,
  medicalTeam,
  preventionFactor,
  rehabFactor,
  reInjuryRisk,
  runMedicalWeek,
  seatFilled,
  type MedicalRole,
} from './medicalStaff'
import type { MedicalGrade } from './injuryCalls'

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)

/** The legacy A–D hash this feature must keep reproducing for a vacant seat. */
function legacyGrade(teamId: string): MedicalGrade {
  let g = hash32(teamId, 905) % 4
  if (ownerPersonality(teamId) === 'cheap') g = Math.min(3, g + 1)
  return (['A', 'B', 'C', 'D'] as MedicalGrade[])[g]
}

/** A synthetic seat holder with an explicit sheet (probe only, never in a world). */
function syntheticSeat(role: MedicalRole, rating: number): StaffMember {
  const sheet: MedicalSubs = { rehab: rating, diagnosis: rating, prevention: rating }
  return {
    id: `probe_${role.replace(/\s/g, '')}`,
    name: `Probe ${role}`,
    role,
    age: 44,
    rating,
    specialty: 'Probe',
    scheme: 'Medical',
    med: sheet,
    annual: 1_000_000,
    contractYears: 2,
    teamId: null,
    status: 'Hired',
  }
}

/**
 * A light stub of `world` for one club: THIS club's players are deep-cloned (so a
 * probe may mutate them freely) and the seats replaced; everything else in the
 * world is shared read-only. ~53 clones instead of a whole-league copy.
 */
export function clubStub(world: World, teamId: string, rating: number | null): World {
  const roster = (world.roster[teamId] ?? []).map((p) => structuredClone(p))
  const staff = [...(world.staff[teamId] ?? [])].filter((m) => !MEDICAL_ROLES.includes(m.role as MedicalRole))
  if (rating !== null) for (const role of MEDICAL_ROLES) staff.push(syntheticSeat(role, rating))
  return {
    ...world,
    players: roster,
    roster: { ...world.roster, [teamId]: roster },
    staff: { ...world.staff, [teamId]: staff },
    medicalPool: undefined,
  }
}

/** Kept for API compatibility: a club's stub with the three seats forced. */
export const withRoom = clubStub

export interface MedArmMeasure {
  /** Share of the club's injured men the physician cleared a week early. */
  misdiagnosis: number
  /** Share of early-cleared men who tore the tissue again inside the window. */
  reInjury: number
  /** Mean prevention / rehab factor across the club's own men in this arm. */
  prevention: number
  rehab: number
  diagnosisRisk: number
  /** n: men given the fresh injury (the club's own roster size). */
  nInjuries: number
  nCleared: number
}

/**
 * Run one arm's medical season through the REAL weekly path: every roster man is
 * given a 1-week injury (so the physician's clearance roll runs for each), then
 * the men he cleared are left to re-injure over the following weeks. Nothing is
 * sampled — every roll is the engine's own hash.
 */
export function measureArm(world: World, teamId: string, rating: number | null, weeks = 18): MedArmMeasure {
  const w = clubStub(world, teamId, rating)
  const roster = w.roster[teamId] ?? []
  let career: CareerState = { teamId } as CareerState
  for (const p of roster) p.injured = { games: 1, note: 'Hamstring' }
  const pass = runMedicalWeek(w, career, 1, { played: true, restedIds: [] })
  career = pass.career
  const cleared = roster.filter((p) => p.lingering && !p.injured)
  let again = 0
  for (let week = 2; week <= weeks; week++) {
    const r = runMedicalWeek(w, career, week, { played: true, restedIds: [] })
    career = r.career
    again += r.reInjured
  }
  return {
    misdiagnosis: roster.length ? cleared.length / roster.length : 0,
    reInjury: cleared.length ? Math.min(1, again / cleared.length) : 0,
    prevention: mean(roster.map((p) => preventionFactor(w, teamId, p))),
    rehab: mean(roster.map((p) => rehabFactor(w, teamId, p))),
    diagnosisRisk: mean(roster.map((p) => diagnosisRisk(w, teamId, p))),
    nInjuries: roster.length,
    nCleared: cleared.length,
  }
}

export interface MedicalProbeReport {
  seed: number
  teamId: string
  seats: { role: MedicalRole; filled: boolean; name: string; rating: number }[]
  /** A vacant room: every channel exactly neutral. */
  vacantNeutral: boolean
  vacantNoWrite: boolean
  /** The incumbent grade still reproduces #15's hash grade. */
  gradeMatchesLegacy: boolean
  /** Elite < neutral < poor for EVERY player, on all three channels. */
  orderedPerPlayer: boolean
  /** Sizing: at one fixed seat rating, the men's own bodies spread the factor. */
  perPlayerSpread: { prevention: number; rehab: number; diagnosisRisk: number }
  sizedPerPerson: boolean
  /** A better physician narrows the expected-return band. */
  bandNarrows: boolean
  bandSamples: { note: string; poor: string; elite: string }[]
  /** An old save (no `med`) derives a sheet in range and is deterministic. */
  derivedSheetOk: boolean
  /** The season arms through the real weekly path. */
  elite: MedArmMeasure
  poor: MedArmMeasure
  incumbent: MedArmMeasure
  /** Separation of the diagnosis channel (misdiagnosis share, re-injury rate). */
  separated: boolean
  /** A vacant room's week is a complete no-op on the roster. */
  oldSaveNoOp: boolean
  /** Two identical runs on identical inputs agree exactly (hash-only, no rng). */
  deterministic: boolean
  ok: boolean
}

/** One seed's medical report (pure; never touches the live career). */
export function medicalStaffProbe(world: World, career: CareerState, weeks = 18): MedicalProbeReport {
  const teamId = career.teamId
  const seats = medicalTeam(world, teamId).map((s) => ({ role: s.role, filled: s.filled, name: s.name, rating: s.rating }))
  const roster = world.roster[teamId] ?? []

  // ── vacant room is exactly neutral, and writes nothing ────────────────────
  const vacant = clubStub(world, teamId, null)
  const vacantNeutral = roster.every(
    (p) =>
      preventionFactor(vacant, teamId, p) === 1 &&
      rehabFactor(vacant, teamId, p) === 1 &&
      diagnosisRisk(vacant, teamId, p) === 0 &&
      reInjuryRisk(vacant, teamId, p) > 0, // exists, but nothing opens a window
  )
  let oldSaveNoOp = true
  {
    // A career/world with every #48 field missing: the week must write nothing.
    const old: CareerState = { teamId } as CareerState
    const before = JSON.stringify(vacant.roster[teamId]?.map((p) => [p.id, p.injured ?? null, p.lingering ?? null]))
    const r = runMedicalWeek(vacant, old, 4, { played: true, restedIds: [] })
    const after = JSON.stringify(vacant.roster[teamId]?.map((p) => [p.id, p.injured ?? null, p.lingering ?? null]))
    oldSaveNoOp = before === after && r.events.length === 0 && r.career.medical === undefined
  }
  const vacantNoWrite = oldSaveNoOp

  // ── the incumbent grade keeps #15's public behaviour ─────────────────────
  const gradeMatchesLegacy = !seatFilled(world, teamId, 'Team Physician') ? incumbentGrade(teamId) === legacyGrade(teamId) : true

  // ── ordered per player, elite < neutral < poor ────────────────────────────
  const elite = clubStub(world, teamId, 90)
  const poor = clubStub(world, teamId, 40)
  const neutral = clubStub(world, teamId, 62)
  const orderedPerPlayer = roster.every(
    (p) =>
      preventionFactor(elite, teamId, p) < preventionFactor(neutral, teamId, p) &&
      preventionFactor(neutral, teamId, p) < preventionFactor(poor, teamId, p) &&
      rehabFactor(elite, teamId, p) < rehabFactor(neutral, teamId, p) &&
      rehabFactor(neutral, teamId, p) < rehabFactor(poor, teamId, p) &&
      diagnosisRisk(elite, teamId, p) < diagnosisRisk(poor, teamId, p) &&
      reInjuryRisk(elite, teamId, p) < reInjuryRisk(poor, teamId, p),
  )
  // Sizing: at one FIXED seat rating (the elite room) the man's own body moves it.
  const spreadOf = (a: number[]) => (a.length ? Math.max(...a) - Math.min(...a) : 0)
  const perPlayerSpread = {
    prevention: spreadOf(roster.map((p) => preventionFactor(elite, teamId, p))),
    rehab: spreadOf(roster.map((p) => rehabFactor(elite, teamId, p))),
    diagnosisRisk: spreadOf(roster.map((p) => diagnosisRisk(elite, teamId, p))),
  }
  const sizedPerPerson = perPlayerSpread.prevention > 0.02 && perPlayerSpread.rehab > 0.01

  // ── the expected-return band narrows with a better physician ─────────────
  const bandSamples: { note: string; poor: string; elite: string }[] = []
  let bandNarrows = roster.length > 0
  for (const p of roster.slice(0, 8)) {
    const inj: Player = { ...p, injured: { games: 4, note: 'Knee' } }
    const bPoor = expectedReturn(poor, teamId, inj, 4)
    const bElite = expectedReturn(elite, teamId, inj, 4)
    bandSamples.push({ note: inj.name, poor: bPoor.label, elite: bElite.label })
    if (bElite.hi - bElite.lo > bPoor.hi - bPoor.lo) bandNarrows = false
  }

  // ── an old save derives a sheet in range, deterministically ──────────────
  let derivedSheetOk = true
  {
    const legacyMember: StaffMember = { ...syntheticSeat('Team Physician', 80), med: undefined }
    const a = medicalSubs(legacyMember)
    const b = medicalSubs({ ...legacyMember })
    const inRange = (v: number) => v >= 20 && v <= 99
    derivedSheetOk = JSON.stringify(a) === JSON.stringify(b) && inRange(a.rehab) && inRange(a.diagnosis) && inRange(a.prevention)
  }

  // ── the season arms (the real path) ──────────────────────────────────────
  const armElite = measureArm(world, teamId, 90, weeks)
  const armPoor = measureArm(world, teamId, 40, weeks)
  const armIncumbent = measureArm(world, teamId, null, weeks)
  // A poor room must misdiagnose MORE and re-injure more than an elite one.
  const separated = armPoor.misdiagnosis > armElite.misdiagnosis && armPoor.reInjury >= armElite.reInjury
  const incumbentNeutral =
    Math.abs(armIncumbent.prevention - 1) < 1e-9 &&
    Math.abs(armIncumbent.rehab - 1) < 1e-9 &&
    armIncumbent.diagnosisRisk === 0 &&
    armIncumbent.misdiagnosis === 0

  // ── determinism: identical inputs must give identical outputs (hash-only) ──
  let determinismOk = true
  {
    const a = clubStub(world, teamId, 78)
    const b = clubStub(world, teamId, 78)
    const one = (w: World) => {
      let care: CareerState = { teamId } as CareerState
      for (const p of w.roster[teamId] ?? []) p.injured = { games: 2, note: 'Hamstring' }
      const out: unknown[] = []
      for (let week = 1; week <= 6; week++) {
        const r = runMedicalWeek(w, care, week, { played: true, restedIds: [] })
        care = r.career
        out.push([week, r.events, (w.roster[teamId] ?? []).map((p) => [p.id, p.injured ?? null, p.lingering ?? null])])
      }
      return JSON.stringify(out)
    }
    determinismOk = one(a) === one(b)
  }

  const ok =
    vacantNeutral &&
    vacantNoWrite &&
    gradeMatchesLegacy &&
    orderedPerPlayer &&
    sizedPerPerson &&
    bandNarrows &&
    derivedSheetOk &&
    separated &&
    incumbentNeutral &&
    oldSaveNoOp &&
    determinismOk

  return {
    seed: world.seed,
    teamId,
    seats,
    vacantNeutral,
    vacantNoWrite,
    gradeMatchesLegacy,
    orderedPerPlayer,
    perPlayerSpread,
    sizedPerPerson,
    bandNarrows,
    bandSamples,
    derivedSheetOk,
    elite: armElite,
    poor: armPoor,
    incumbent: armIncumbent,
    separated,
    oldSaveNoOp,
    deterministic: determinismOk,
    ok,
  }
}

/** Alias for the dev hook. */
export const medicalProbe = medicalStaffProbe

/** Determinism helper: two runs on identical inputs must agree exactly. */
export function medicalProbeDeterministic(world: World, career: CareerState, weeks = 18): boolean {
  const a = medicalStaffProbe(structuredClone(world), structuredClone(career) as CareerState, weeks)
  const b = medicalStaffProbe(structuredClone(world), structuredClone(career) as CareerState, weeks)
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Re-export for the probe script so it can read a man's own sheet. */
export type { MedicalSubs }
export const medicalChannelRating = channelRating
export const MEDICAL_ROLE_LIST = MEDICAL_ROLES
export const playerTgh = (p: Player): number => playerAttrs(p).TGH ?? POS_MEAN[p.pos]?.TGH ?? 70

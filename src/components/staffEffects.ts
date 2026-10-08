import type { StaffMember } from '../game/types'
import type { World } from '../game/engine/generate'
import { coachEffect, type CoachEffect } from '../game/engine/coaching'
import { isFrontOfficeRole } from '../game/engine/hiring'
import { AXIS_LABEL, isEvaluator, learnedBias } from '../game/engine/scoutBias'

/**
 * Backlog #41: read the real staff code and say what each member actually does.
 *
 * Everything here is DERIVED from existing engine functions — it never changes
 * hiring, firing, salaries, ratings, gates or capabilities:
 *   • src/game/engine/coaching.ts   coachEffect()          → edge / dev / discipline / situational / cohesion
 *   • src/game/engine/progress.ts   coachEffect().development → player growth multiplier
 *   • src/game/engine/statAlloc.ts  coachEffect().offEdge  → pass yards ×(1+edge/50), completion +edge×0.004
 *   • src/game/engine/scoutBias.ts  member.bias + reportLedger → systematic scouting skew
 *   • src/game/engine/department.ts trust-weighted mean of evaluator reports
 *   • src/game/engine/playbook.ts   cohesionDiscipline / cohesionSituational
 */

/** League-average staff rating used by coaching.ts to measure effects. */
export const STAFF_BASELINE = 74

/** coaching.ts edge(): rating → play-calling edge, clamped to ±4.5. */
export function edgeOf(rating: number | null | undefined): number {
  if (rating == null) return 0
  return Math.max(-4.5, Math.min(4.5, (rating - STAFF_BASELINE) * 0.2))
}

/** coaching.ts development formula applied to one position coach's OVR. */
export function unitDevMultiplier(rating: number): number {
  return 1 + ((rating - STAFF_BASELINE) / 100) * 0.6
}

export function signed(n: number, digits = 1): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`
}

export type Tone = 'win' | 'loss' | 'warn' | 'neutral'

export interface EffectLine {
  label: string
  value: string
  tone?: Tone
  /** Which engine code this reads (shown as a title tooltip). */
  hint?: string
}

/** Shared tone → text-colour map (also used by the hover card component). */
export const TONE_TEXT: Record<Tone, string> = {
  win: 'text-win',
  loss: 'text-loss',
  warn: 'text-warn',
  neutral: 'text-ink-2',
}

function toneFor(n: number): Tone {
  return n > 0.05 ? 'win' : n < -0.05 ? 'loss' : 'neutral'
}

/** Position unit a coach owns, used for the per-unit development readout. */
export const COACH_UNIT: Partial<Record<string, string>> = {
  'QB Coach': 'QBs',
  'OL Coach': 'the O-Line',
  'DL Coach': 'the D-Line',
  'Secondary Coach': 'the Secondary',
}

/** Flavor descriptions for the generated specialty tag (display only — no sim hook). */
export const SPECIALTY_BLURB: Record<string, string> = {
  'QB Development': 'Known for sharpening quarterback mechanics and reads.',
  'O-Line Play': 'Builds the front five: technique, protection, and the run game.',
  'Pass Rush': 'Coaches hand-fighting and get-off to collapse the pocket.',
  Secondary: 'Develops coverage technique and ball skills on the back end.',
  'Red Zone': 'Specializes in condensed-field football: scoring and stopping scores.',
  'Talent Evaluation': 'Trusted eye for projection and roster fit.',
  'Culture Builder': 'Holds the locker room together through churn.',
  'Play Calling': 'Game-day sequencing and situational calls.',
  'Pro Personnel': 'Knows the veteran market and pro scouting circuit.',
  'College Scouting': 'Lives on the road; strong read on the draft class.',
}

/** Front-office roles show a focus; coaches show a scheme. */
export function displaySystem(m: StaffMember): string {
  return isFrontOfficeRole(m.role) ? (m.focus ?? '—') : m.scheme.split(' ')[0]
}

/**
 * Plain-language effect lines for one staff member, computed from the live
 * engine effect and the member's own role/rating (never hard-coded).
 */
export function staffEffectLines(
  world: World,
  teamId: string,
  m: StaffMember,
  eff: CoachEffect = coachEffect(world, teamId),
): EffectLine[] {
  const out: EffectLine[] = []

  if (m.role === 'Head Coach') {
    const sit = (m.rating - STAFF_BASELINE) * 0.12
    const disc = 1 - (72 - m.rating) / 220
    out.push({
      label: 'Situational calls',
      value: `${signed(sit)} (4th down, clock, red zone)`,
      tone: toneFor(sit),
      hint: 'coaching.ts: situational = (HC OVR − 74) × 0.12 (+ ST + continuity); applied on money downs by playsim.ts clutchFor()',
    })
    out.push({
      label: 'Flag discipline',
      value: `×${disc.toFixed(2)}`,
      tone: disc >= 1 ? 'win' : 'loss',
      hint: 'coaching.ts: discipline HC term = 1 − (72 − HC OVR)/220, multiplied by cohesionDiscipline()',
    })
    out.push({
      label: 'Head-coach quality',
      value: `${m.rating} OVR`,
      tone: 'neutral',
      hint: 'coachEffect().headCoach — drives win-probability nudges and job appeal (hiring.ts destinationAppeal)',
    })
  }

  if (m.role === 'Offensive Coordinator') {
    const e = edgeOf(m.rating)
    out.push({
      label: 'Offense edge',
      value: `${signed(e)} / snap`,
      tone: toneFor(e),
      hint: 'coaching.ts offEdge = clamp((OC OVR − 74) × 0.2, ±4.5); statAlloc.ts: pass yards ×(1 + edge/50), completion +edge×0.004',
    })
  }

  if (m.role === 'Defensive Coordinator') {
    const e = edgeOf(m.rating)
    out.push({
      label: 'Defense edge',
      value: `${signed(e)} / snap`,
      tone: toneFor(e),
      hint: 'coaching.ts defEdge = clamp((DC OVR − 74) × 0.2, ±4.5); read by playsim.ts for the defense',
    })
  }

  if (m.role === 'Special Teams Coordinator') {
    const st = (m.rating - STAFF_BASELINE) * 0.04
    out.push({
      label: 'Special-teams situational',
      value: signed(st),
      tone: toneFor(st),
      hint: 'coaching.ts situational += (ST OVR − 74) × 0.04',
    })
  }

  if (COACH_UNIT[m.role]) {
    const dev = unitDevMultiplier(m.rating)
    out.push({
      label: 'Player development',
      value: `×${dev.toFixed(3)} for ${COACH_UNIT[m.role]}`,
      tone: dev >= 1 ? 'win' : 'loss',
      hint: 'coaching.ts development = 1 + ((avg position-coach OVR − 74) / 100) × 0.6, read by progress.ts developPlayers()',
    })
    out.push({
      label: 'Program development',
      value: `×${eff.development.toFixed(2)} (4-coach average)`,
      tone: eff.development >= 1 ? 'win' : 'loss',
      hint: 'coachEffect().development — the multiplier progress.ts actually applies to every young player',
    })
  }

  if (isFrontOfficeRole(m.role)) {
    const opts: string[] = []
    if (m.focus) opts.push(`focus ${m.focus}`)
    out.push({
      label: 'Department role',
      value: opts.length ? opts.join(' · ') : 'Player personnel',
      tone: 'neutral',
      hint: 'hiring.ts frontOfficeProfile / focusOptions — the market and evaluation lane this role works',
    })
  }

  // Evaluators (Scout/DPP/GM/HC/coordinators) file biased draft reports. Show the skew.
  if (isEvaluator(m)) {
    const mag = m.bias?.magnitude ?? 0
    const axis = AXIS_LABEL[m.bias?.axis ?? 'production']
    out.push({
      label: 'Scouting reads',
      value: mag === 0 ? 'no known skew' : `±${Math.abs(mag)} on ${axis}`,
      tone: Math.abs(mag) >= 4 ? 'warn' : 'neutral',
      hint: 'scoutBias.ts scoutReport = trueGrade + focusValue(axis)×magnitude + noise(±2.5); the Ledger reveals it over seasons',
    })
    const learned = learnedBias(m)
    if (learned.label) {
      out.push({
        label: 'Ledger read',
        value: learned.label,
        tone: learned.label === 'Reads close to the truth' ? 'win' : 'warn',
        hint: `learnedBias(): ${learned.samples} filed reports, average error ${signed(learned.avgError)}`,
      })
    }
  }

  if (SPECIALTY_BLURB[m.specialty]) {
    out.push({
      label: 'Specialty',
      value: m.specialty,
      tone: 'neutral',
      hint: `${SPECIALTY_BLURB[m.specialty]} (generated flavor — no sim hook)`,
    })
  }

  return out
}

/** The single line shown on a chart chip / table Effect column. */
export function effectSummary(m: StaffMember, eff?: CoachEffect): string {
  switch (m.role) {
    case 'Head Coach':
      return `Situational ${signed((m.rating - STAFF_BASELINE) * 0.12)}`
    case 'Offensive Coordinator':
      return `Offense edge ${signed(edgeOf(m.rating))}/snap`
    case 'Defensive Coordinator':
      return `Defense edge ${signed(edgeOf(m.rating))}/snap`
    case 'Special Teams Coordinator':
      return `Situational ${signed((m.rating - STAFF_BASELINE) * 0.04)}`
    case 'QB Coach':
    case 'OL Coach':
    case 'DL Coach':
    case 'Secondary Coach':
      return `Dev ×${unitDevMultiplier(m.rating).toFixed(2)} (${COACH_UNIT[m.role]})`
    default: {
      const mag = m.bias?.magnitude ?? 0
      const axis = AXIS_LABEL[m.bias?.axis ?? 'production']
      const dev = eff ? ` · program dev ×${eff.development.toFixed(2)}` : ''
      return mag === 0 ? `Scouting reads straight${dev}` : `Scouting ±${Math.abs(mag)} ${axis}${dev}`
    }
  }
}

/** Team-level discipline + situational reading from continuity (all staff share it). */
export function cultureLines(eff: CoachEffect): EffectLine[] {
  const disc = Math.max(0.75, Math.min(1.15, 1.15 - eff.cohesion * 0.45))
  const sit = (eff.cohesion - 0.55) * 0.9
  return [
    {
      label: 'Culture (continuity)',
      value: `${eff.cohesion.toFixed(2)} cohesion`,
      tone: eff.cohesion >= 0.6 ? 'win' : 'warn',
      hint: 'playbook.ts teamCohesion() from staff tenure + roster continuity',
    },
    {
      label: 'Flags from continuity',
      value: `×${disc.toFixed(2)}`,
      tone: disc <= 1 ? 'win' : 'loss',
      hint: 'playbook.ts cohesionDiscipline(): 1.15 − cohesion × 0.45 (fewer flags with a settled staff)',
    },
    {
      label: 'Clutch from continuity',
      value: signed(sit * 2),
      tone: toneFor(sit),
      hint: 'playbook.ts cohesionSituational() × 2 — money-down execution',
    },
  ]
}

/** Tenure text derived from world.staffTenure (`${teamId}:off|def`). */
export function staffTenureFor(world: World, teamId: string, role: string): string | null {
  const off = world.staffTenure?.[`${teamId}:off`] ?? 1
  const def = world.staffTenure?.[`${teamId}:def`] ?? 1
  const yrs = (n: number) => `${n} yr${n === 1 ? '' : 's'}`
  if (role === 'Offensive Coordinator' || role === 'QB Coach' || role === 'OL Coach')
    return `${yrs(off)} on offense`
  if (role === 'Defensive Coordinator' || role === 'DL Coach' || role === 'Secondary Coach')
    return `${yrs(def)} on defense`
  if (role === 'Head Coach' || role === 'Special Teams Coordinator')
    return `${yrs(Math.max(off, def))} staff continuity`
  return null
}

/** Role-group buckets used by the table. */
export type RoleGroup = 'all' | 'hc' | 'coord' | 'pos' | 'front'

export function groupOf(role: string): Exclude<RoleGroup, 'all'> {
  if (role === 'Head Coach') return 'hc'
  if (
    role === 'Offensive Coordinator' ||
    role === 'Defensive Coordinator' ||
    role === 'Special Teams Coordinator'
  )
    return 'coord'
  if (role === 'QB Coach' || role === 'OL Coach' || role === 'DL Coach' || role === 'Secondary Coach')
    return 'pos'
  return 'front'
}

export function inGroup(role: string, group: RoleGroup): boolean {
  return group === 'all' || groupOf(role) === group
}

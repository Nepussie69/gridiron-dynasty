import type { CareerState, StaffMember } from '../game/types'
import type { World } from '../game/engine/generate'
import { coachEffect, coordinatorEdge, NO_USER_BONUS, type CoachEffect, type UserCoachingBonus } from '../game/engine/coaching'
import { isFrontOfficeRole, ANALYTICS_ROLE } from '../game/engine/hiring'
import { ANALYTICS_LEVEL_LABEL, analyticsLevel } from '../game/engine/analytics'
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

/**
 * coaching.ts coordinatorEdge(): rating → play-calling edge, clamped to ±4.5.
 * Backlog 193: a vacant seat (null) costs the floor (−4.5), not league average,
 * unless the user holds that seat personally (`heldByUser`) — then it is 0.
 */
export function edgeOf(rating: number | null | undefined, heldByUser = false): number {
  return coordinatorEdge(rating ?? null, heldByUser)
}

// ── The user's own coordinator seat (backlog 193) ────────────────────────────

/** Which coordinator chair the user sits in on a club, if any. */
export type UserSeat = UserCoachingBonus['seat']

/**
 * The coordinator seat the USER personally holds on `teamId`. Mirrors
 * applyUserCoaching() in gameStore.ts: only the coaching path's coordinator
 * rungs (FBS level 2, NFL level 6) sit in an OC/DC chair — a head coach's own
 * skill does not fill a vacant coordinator seat. `unitFocus` picks the side.
 */
export function userCoordinatorSeat(career: CareerState | null | undefined, teamId: string): UserSeat {
  if (!career || career.teamId !== teamId) return undefined
  if (career.path !== 'coach' || (career.level !== 2 && career.level !== 6)) return undefined
  return career.unitFocus ?? 'both'
}

/** Does the user's seat cover this coordinator role? */
export function seatHolds(seat: UserSeat, role: string): boolean {
  if (!seat) return false
  if (role === 'Offensive Coordinator') return seat === 'off' || seat === 'both'
  if (role === 'Defensive Coordinator') return seat === 'def' || seat === 'both'
  return false
}

/** Staff-only engine effect (no user skill bonus) with the user's seat rule applied. */
function seatOnly(seat: UserSeat): UserCoachingBonus {
  return seat ? { ...NO_USER_BONUS, seat } : NO_USER_BONUS
}

/**
 * coachEffect() for the club's staff, as the Staff screen shows it: the staff's
 * own effect (the user's skill bonus is not added) with backlog 193's vacancy
 * rule — a vacant OC/DC costs the floor unless the user holds that seat.
 */
export function staffCoachEffect(world: World, teamId: string, seat?: UserSeat): CoachEffect {
  return coachEffect(world, teamId, seatOnly(seat))
}

/** coaching.ts development formula applied to one position coach's OVR. */
export function unitDevMultiplier(rating: number): number {
  return 1 + ((rating - STAFF_BASELINE) / 100) * 0.6
}

/** Signed number with a real minus (U+2212); zero reads "+0.0". */
export function signed(n: number, digits = 1): string {
  const abs = Math.abs(n).toFixed(digits)
  if (Number(abs) === 0) return `+${abs}`
  return `${n < 0 ? '\u2212' : '+'}${abs}`
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
      value:
        m.role === ANALYTICS_ROLE
          ? `Analytics · ${ANALYTICS_LEVEL_LABEL[analyticsLevel(m.rating)]}`
          : opts.length
            ? opts.join(' · ')
            : 'Player personnel',
      tone: 'neutral',
      hint: 'hiring.ts frontOfficeProfile / focusOptions — the market and evaluation lane this role works',
    })
  }

  if (m.role === ANALYTICS_ROLE) {
    out.push({
      label: 'Sharper information',
      value: 'win prob · 4th down · tendencies',
      tone: 'neutral',
      hint: 'analytics.ts — analyst quality sharpens the win-probability model, the 4th-down recommendation and opponent tendency projections. Advisory only; the sim is unchanged.',
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

// ─────────────────────────────────────────────────────────────────────────────
// UI redesign F4: clamp / floor helpers. Every on-surface explanation on the
// Staff screen ("AT THE FLOOR", "a coordinator rated 52+ is the first hire that
// moves it", "Offense edge −4.5 → +0.0") is computed HERE by calling the
// engine's own coachEffect() on read-only hypothetical copies of the world —
// never re-derived by hand — so the copy cannot drift from the sim.
// Nothing here mutates the world.
// ─────────────────────────────────────────────────────────────────────────────

/** The world with one club's staff list swapped (shallow, read-only probe). */
export function withStaff(world: World, teamId: string, staff: StaffMember[]): World {
  return { ...world, staff: { ...world.staff, [teamId]: staff } }
}

/** coachEffect() for a hypothetical staff list (`seat`: the user's own coordinator chair). */
export function effectWith(world: World, teamId: string, staff: StaffMember[], seat?: UserSeat): CoachEffect {
  return coachEffect(withStaff(world, teamId, staff), teamId, seatOnly(seat))
}

function probeMember(role: string, rating: number): StaffMember {
  return {
    id: `probe-${role}-${rating}`,
    name: 'Probe',
    role,
    rating,
    age: 40,
    specialty: '',
    scheme: '',
    annual: 0,
    contractYears: 1,
    teamId: null,
    status: 'Hired',
  } as unknown as StaffMember
}

export interface EngineLimits {
  /** Each side's play-calling edge is held to ±edge (coaching.ts edge()). */
  edge: number
  /** Program development multiplier floor / cap (coachEffect clamp). */
  devFloor: number
  devCap: number
  /** Lowest coordinator rating whose edge is above the floor ("52+"). */
  floorExit: number
}

const PROBE_TEAM = '__probe__'
let limitsMemo: EngineLimits | null = null

/**
 * The engine's clamps, measured by probing coachEffect() with extreme staffs on
 * an empty probe club. Memoised: the clamps are constants of the engine.
 */
export function engineLimits(world: World): EngineLimits {
  if (limitsMemo) return limitsMemo
  const probe = (staff: StaffMember[]) => effectWith({ ...world, roster: { ...world.roster, [PROBE_TEAM]: [] } }, PROBE_TEAM, staff)
  const POS = ['QB Coach', 'OL Coach', 'DL Coach', 'Secondary Coach']
  const edge = -probe([probeMember('Offensive Coordinator', 0)]).offEdge
  const devFloor = probe(POS.map((r) => probeMember(r, 0))).development
  const devCap = probe(POS.map((r) => probeMember(r, 200))).development
  let floorExit = 100
  for (let r = 0; r <= 100; r++) {
    if (probe([probeMember('Offensive Coordinator', r)]).offEdge > -edge + 1e-9) {
      floorExit = r
      break
    }
  }
  limitsMemo = { edge, devFloor, devCap, floorExit }
  return limitsMemo
}

export type Clamp = 'floor' | 'cap' | null

/** Is a side edge pinned at the clamp? */
export function edgeClamp(value: number, lim: EngineLimits): Clamp {
  if (value <= -lim.edge + 1e-9) return 'floor'
  if (value >= lim.edge - 1e-9) return 'cap'
  return null
}

/** Is the program development multiplier pinned at the clamp? */
export function devClamp(value: number, lim: EngineLimits): Clamp {
  if (value <= lim.devFloor + 1e-9) return 'floor'
  if (value >= lim.devCap - 1e-9) return 'cap'
  return null
}

/** The On-field KPI: offEdge + defEdge, with each side's clamp state. */
export function onFieldState(eff: CoachEffect, lim: EngineLimits) {
  const off = edgeClamp(eff.offEdge, lim)
  const def = edgeClamp(eff.defEdge, lim)
  const total = eff.offEdge + eff.defEdge
  const clamp: Clamp = off === 'floor' && def === 'floor' ? 'floor' : off === 'cap' && def === 'cap' ? 'cap' : null
  return { total, off, def, clamp, min: -2 * lim.edge, max: 2 * lim.edge }
}

/** Development as words: "16% slower" / "8% faster" / "normal pace". */
export function devPace(dev: number): { label: string; tone: Tone } {
  const pct = Math.round((dev - 1) * 100)
  if (pct === 0) return { label: 'Normal pace', tone: 'neutral' }
  return pct < 0 ? { label: `${-pct}% slower`, tone: 'warn' } : { label: `${pct}% faster`, tone: 'win' }
}

/** One staff member's own effect, as shown on cards and in the Effect column. */
export interface MemberEffect {
  kind: 'edge' | 'mult' | 'none'
  value: number
  /** What the number is ("offense edge / snap", "dev alone"). */
  label: string
  clamp: Clamp
  /** Comparable number for sorting (edge pts; mult as (×−1)×10; none 0). */
  sort: number
}

export function memberEffect(m: StaffMember, eff: CoachEffect, lim: EngineLimits): MemberEffect {
  switch (m.role) {
    case 'Offensive Coordinator':
      return { kind: 'edge', value: eff.offEdge, label: 'offense edge / snap', clamp: edgeClamp(eff.offEdge, lim), sort: eff.offEdge }
    case 'Defensive Coordinator':
      return { kind: 'edge', value: eff.defEdge, label: 'defense edge / snap', clamp: edgeClamp(eff.defEdge, lim), sort: eff.defEdge }
    case 'Head Coach': {
      const v = (m.rating - STAFF_BASELINE) * 0.12
      return { kind: 'edge', value: v, label: 'situational (4th down, clock)', clamp: null, sort: v }
    }
    case 'Special Teams Coordinator': {
      const v = (m.rating - STAFF_BASELINE) * 0.04
      return { kind: 'edge', value: v, label: 'situational', clamp: null, sort: v }
    }
    case 'QB Coach':
    case 'OL Coach':
    case 'DL Coach':
    case 'Secondary Coach': {
      const v = unitDevMultiplier(m.rating)
      return { kind: 'mult', value: v, label: 'dev alone', clamp: null, sort: (v - 1) * 10 }
    }
    default:
      return { kind: 'none', value: 0, label: 'no sim effect', clamp: null, sort: 0 }
  }
}

export interface ImpactRow {
  label: string
  before: number
  after: number
  kind: 'edge' | 'mult'
  /** Plain words: "already at the floor", "still at the floor", "leaves the floor". */
  note: string | null
  /** Did this change help (true), hurt (false) or nothing (null)? */
  better: boolean | null
}

function clampNote(b: Clamp, a: Clamp, changed: boolean): string | null {
  if (b === 'floor' && a === 'floor') return changed ? 'still at the floor' : 'already at the floor'
  if (b === 'floor' && a !== 'floor') return 'leaves the floor'
  if (b !== 'floor' && a === 'floor') return 'drops to the floor'
  if (b === 'cap' && a === 'cap') return 'at the cap'
  if (a === 'cap') return 'reaches the cap'
  return null
}

/**
 * Before → after engine truth for a staffing change on the user's club:
 * remove `removeId` and/or put `add` in its role (a hire replaces the holder,
 * as applyHire() does). Only the metrics that role moves are returned.
 * Both sides come from coachEffect(), so a vacant OC/DC reads as the floor
 * (backlog 193): letting a coordinator go shows "→ −4.5", hiring into an empty
 * chair shows "−4.5 →". `seat` is the user's own chair (userCoordinatorSeat),
 * which is never vacant.
 */
export function staffChangeImpact(
  world: World,
  teamId: string,
  role: string,
  change: { removeId?: string; add?: StaffMember },
  seat?: UserSeat,
): ImpactRow[] {
  const lim = engineLimits(world)
  const cur = world.staff[teamId] ?? []
  let next = cur.filter((m) => m.id !== change.removeId)
  if (change.add) {
    next = next.filter((m) => m.role !== change.add!.role)
    next = [...next, change.add]
  }
  const b = staffCoachEffect(world, teamId, seat)
  const a = effectWith(world, teamId, next, seat)
  const eq = (x: number, y: number) => Math.abs(x - y) < 1e-6
  const row = (label: string, before: number, after: number, kind: 'edge' | 'mult', clampFn?: (v: number) => Clamp): ImpactRow => ({
    label,
    before,
    after,
    kind,
    note: clampFn ? clampNote(clampFn(before), clampFn(after), !eq(before, after)) : null,
    better: eq(before, after) ? null : after > before,
  })
  const edgeC = (v: number) => edgeClamp(v, lim)
  const devC = (v: number) => devClamp(v, lim)
  if (role === 'Offensive Coordinator') return [row('Offense edge / snap', b.offEdge, a.offEdge, 'edge', edgeC)]
  if (role === 'Defensive Coordinator') return [row('Defense edge / snap', b.defEdge, a.defEdge, 'edge', edgeC)]
  if (role === 'Head Coach')
    return [row('Situational calls', b.situational, a.situational, 'edge'), row('Flag discipline', b.discipline, a.discipline, 'mult')]
  if (role === 'Special Teams Coordinator') return [row('Situational calls', b.situational, a.situational, 'edge')]
  if (COACH_UNIT[role]) return [row('Program development', b.development, a.development, 'mult', devC)]
  return []
}

/** "−4.5 → +0.0" / "×0.84 → ×0.85". */
export function impactText(r: ImpactRow): string {
  const f = (v: number) => (r.kind === 'mult' ? `×${v.toFixed(2)}` : signed(v))
  return `${f(r.before)} → ${f(r.after)}`
}

/**
 * What an empty seat costs, in plain words. Engine (backlog 193): a vacant
 * OC/DC costs the floor edge (coordinatorEdge(null)), not league average; a
 * chair the user holds personally (`heldByUser`) is not vacant.
 */
export function vacancyCost(role: string, heldByUser = false): string {
  const floor = `${signed(coordinatorEdge(null))} / snap`
  switch (role) {
    case 'Head Coach':
      return 'situational calls run at league average until hired'
    case 'Offensive Coordinator':
      return heldByUser
        ? 'you call the offense yourself; no vacancy penalty'
        : `no live offensive scheme; the offense edge sits at the floor (${floor}) until hired`
    case 'Defensive Coordinator':
      return heldByUser
        ? 'you call the defense yourself; no vacancy penalty'
        : `no live defensive scheme; the defense edge sits at the floor (${floor}) until hired`
    case 'Special Teams Coordinator':
      return 'special-teams situational counts as league average'
    case 'QB Coach':
    case 'OL Coach':
    case 'DL Coach':
    case 'Secondary Coach':
      return 'program development averages the remaining position coaches'
    case ANALYTICS_ROLE:
      return 'no analytics read on 4th-down calls, win probability or tendencies'
    case 'Scout':
      return 'one fewer evaluator filing draft reports'
    case 'Director of Player Personnel':
      return 'no pro-personnel read on the market'
    default:
      return 'seat is empty'
  }
}

/** League rank of a staffer among every club's holder of the same role ("#24 of 32"). */
export function leagueRank(world: World, m: StaffMember): { rank: number; of: number } {
  const peers: number[] = []
  for (const list of Object.values(world.staff ?? {})) {
    const s = (list ?? []).find((x) => x.role === m.role)
    if (s) peers.push(s.rating)
  }
  const rank = 1 + peers.filter((r) => r > m.rating).length
  return { rank, of: Math.max(peers.length, rank) }
}

// ── Scheme alignment (only coordinator schemes reach the sim) ────────────────

export type SchemeStateName = 'live' | 'match' | 'off' | 'na'

export interface LiveSchemes {
  off: StaffMember | null
  def: StaffMember | null
}

/** The two schemes the sim actually runs: the OC's and the DC's (playsim.ts / statAlloc.ts). */
export function liveSchemes(staff: StaffMember[]): LiveSchemes {
  return {
    off: staff.find((m) => m.role === 'Offensive Coordinator') ?? null,
    def: staff.find((m) => m.role === 'Defensive Coordinator') ?? null,
  }
}

const OFF_SIDE = new Set(['QB Coach', 'OL Coach'])
const DEF_SIDE = new Set(['DL Coach', 'Secondary Coach'])

/**
 * Where a staffer's scheme stands against the live coordinator scheme.
 * null = no scheme to show (front office shows its focus instead).
 */
export function schemeStateOf(
  m: Pick<StaffMember, 'role' | 'scheme'>,
  live: LiveSchemes,
  offSchemes: readonly string[],
  defSchemes: readonly string[],
): { state: SchemeStateName; against?: 'OC' | 'DC'; liveScheme?: string } | null {
  if (isFrontOfficeRole(m.role)) return null
  if (m.role === 'Offensive Coordinator' || m.role === 'Defensive Coordinator') return { state: 'live' }
  if (m.role === 'Special Teams Coordinator') return { state: 'na' }
  let side: 'off' | 'def' | null = null
  if (OFF_SIDE.has(m.role)) side = 'off'
  else if (DEF_SIDE.has(m.role)) side = 'def'
  else if (offSchemes.includes(m.scheme)) side = 'off'
  else if (defSchemes.includes(m.scheme)) side = 'def'
  if (!side) return { state: 'na' }
  const holder = side === 'off' ? live.off : live.def
  if (!holder) return { state: 'na' }
  const against = side === 'off' ? 'OC' : 'DC'
  return holder.scheme === m.scheme
    ? { state: 'match', against, liveScheme: holder.scheme }
    : { state: 'off', against, liveScheme: holder.scheme }
}

// ─────────────────────────────────────────────────────────────────────────────
// Practice week (L12 W1).
//
// Each in-season week a coordinator or head coach picks one practice plan. The
// plan is kept week to week until changed. A Sharpen week adds execution edge
// but raises the club's injury odds; an Install week costs a little now and
// pays off next week; a Rest week heals and protects the roster at a small
// execution cost. The edge is folded into the user's coaching bonus in the
// store (inside the same clamp as wrinkle + install), so AI clubs never get it
// and league calibration can't move.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, Player, Position } from '../types'
import type { World } from './generate'
import { capabilities } from './capabilities'
import { installSides } from './install'
import { ATTRIBUTE_SCHEMA, playerAttrs } from '../data/ratings'
import { PLAYBOOK } from '../data/playbookData'
import { clamp } from './rng'
import { ownerPersonality } from './owner'
import { STARTERS, depthAt } from './depth'
import { coachProfile, teachFactor } from './staffMarket'
import { vetLearnMultiplier } from './playbook'
import { devModifier } from './character'
import { DEV_GROUP_LABEL, DEV_GROUP_ORDER, MAX_DEV_AGE, autoFocusFor, devFocusById, devGroupFor, focusKeysFor } from './devPlan'

export type PracticePlan = 'balanced' | 'sharpen' | 'install' | 'rest'

export interface PracticeOption {
  id: PracticePlan
  label: string
  /** This week's coaching edge, per side. */
  edge: number
  /** Everything else the week does. */
  blurb: string
}

export const PRACTICE_OPTIONS: PracticeOption[] = [
  { id: 'balanced', label: 'Balanced', edge: 0, blurb: 'A normal week. No edge, no cost.' },
  { id: 'sharpen', label: 'Sharpen', edge: 0.4, blurb: 'Execution work. Your club’s weekly injury chance ×1.5.' },
  { id: 'install', label: 'Install', edge: -0.1, blurb: 'New concepts. Costs a little now, +0.3 next week. Playbook mastery gain ×1.25 this week.' },
  { id: 'rest', label: 'Rest', edge: -0.2, blurb: 'Light week. Injury chance ×0.6; dinged players heal an extra game 25% of the time; fatigue −10.' },
]

const EDGE: Record<PracticePlan, number> = { balanced: 0, sharpen: 0.4, install: -0.1, rest: -0.2 }

/** Can this rung run a practice week — i.e. call plays? */
export function canPractice(career: CareerState): boolean {
  return capabilities(career).can.has('callPlays')
}

/** The practice plan in effect for `world` (kept week to week; default Balanced). */
export function practicePlan(career: CareerState, world: World): PracticePlan {
  if (!canPractice(career)) return 'balanced'
  const p = career.practice
  if (!p || p.season !== world.season) return 'balanced'
  return p.plan
}

/**
 * Did an Install run *last* week, so this week is owed its +0.3 payoff? True if
 * the current plan is Install and has been in place since then, or if the plan
 * was changed this week but the plan it replaced was Install. Recording `prev`
 * at selection time keeps the payoff even if you switch plans — or switch back —
 * the following week.
 */
function installPaidOff(p: NonNullable<CareerState['practice']>, week: number): boolean {
  if (p.plan === 'install' && p.week <= week - 1) return true
  return p.prev?.plan === 'install' && p.prev.week === week - 1
}

/**
 * This week's practice edge per side, for the sides `installSides` gives. A kept
 * Install earns the +0.3 payoff in every week after the one it was set; the first
 * week costs −0.1.
 */
export function practiceEdge(career: CareerState, world: World): { off: number; def: number } {
  const plan = practicePlan(career, world)
  const p = career.practice
  let edge = EDGE[plan]
  if (p && p.season === world.season && installPaidOff(p, world.week)) edge += 0.3
  const sides = installSides(career)
  return {
    off: sides.includes('off') ? edge : 0,
    def: sides.includes('def') ? edge : 0,
  }
}

/** Rest week: dinged players can shed one extra game and the club sheds fatigue. */
export function practiceIsRest(career: CareerState, world: World): boolean {
  return canPractice(career) && practicePlan(career, world) === 'rest'
}

/** Install week: playbook mastery gain ×1.25 for the user's club. */
export function practiceMasteryMult(career: CareerState, world: World): number {
  return canPractice(career) && practicePlan(career, world) === 'install' ? 1.25 : 1
}

/** The weekly minor-injury threshold multiplier for the user's club (1 = normal). */
export function practiceInjuryMult(career: CareerState, world: World): number {
  const plan = practicePlan(career, world)
  if (plan === 'sharpen') return 1.5
  if (plan === 'rest') return 0.6
  return 1
}

// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #45 — practice-week reps.
//
// The plan above decides HOW MUCH work the week holds (the pads, the load). This
// decides WHO takes it: every position group splits its reps between the starter
// and the backups, and the split is the week's real trade-off.
//
//   • Starter reps  → this Sunday's execution (a per-player readiness bonus on
//     his own mental ratings, scaled by his own football IQ and experience) and a
//     soft-tissue load that raises HIS OWN injury threshold.
//   • Backup reps   → the young player's development. The reps bank into his own
//     focus ratings (his weakest sim-relevant area), sized by his own learning
//     rate and by the position coach in his seat's Development read.
//
// Every club runs it: the user's club from the card (a group left on Auto is the
// staff's call), and **every AI club** through the same Auto policy at the week
// rollover — so the league's practice weeks are the same system, not a
// user-only perk. Nothing here reads a league, unit or roster average: a
// player's shares, readiness, load and development all come from HIM (his
// ratings, his traits, his age) and from the coach in his own seat.
//
// Real-world framing (SPEC §NFL truth in logs/fut45-verify.out):
//   • CBA in-season padded practices are capped (14): the week's pads are spent
//     from a season budget, and a capped-out week is a walkthrough.
//   • The week is Wed (install) / Thu (pads) / Fri (situational); a Thursday
//     game is a short week with no padded practice at all.
//   • Install: the coordinator buys a limited number of opponent-specific
//     concepts a week (his own install speed), and the men who run them execute
//     them a little better on Sunday.
// ─────────────────────────────────────────────────────────────────────────────

/** Every constant this feature adds, in one place. */
export const REP = {
  /** The starter share a normal NFL week gives the ones. */
  neutral: 0.65,
  /** Rating points of readiness at full starter reps for a league-average learner. */
  ready: 1.5,
  /** The per-player own-factor band: a rookie benchwarmer → an All-Pro vet. */
  readyLo: 0.35,
  readyHi: 1.6,
  /** The mental ratings readiness moves (filtered to the position's schema). */
  readyKeys: ['AWR', 'PRC'],
  /** Wear-down: reps above the player's own conditioning ceiling cost him. */
  overload: 0.9,
  /** Fatigue points charged at a full starter week (his own STA softens it). */
  fatigue: 16,
  /** Per-player soft-tissue load band (1 = normal) and its slope off neutral. */
  riskLo: 0.75,
  riskHi: 1.75,
  riskW: 2.0,
  /** Fractional development banked per week at full backup reps. */
  devWeek: 0.3,
  /** Rating points a season of reps can bank, and the lifetime cap per rating. */
  devSeasonCap: 3,
  devLifeCap: 5,
  /** Walkthrough-only week (no pads left): every gain scales to this. */
  loadCut: 0.55,
  /** Readiness on top for a group the week's install actually touched. */
  installReady: 1.0,
  /** Mastery multiplier per installed concept the week ran (from the game reps). */
  installMastery: 0.05,
  /** The install a vacant seat can buy (a coordinator who is not in the building). */
  installFloor: 1,
} as const

/** The CBA's in-season padded-practice cap. */
export const PADDED_CAP = 14
/** The padded practices each plan books (the day structure decides, the plan leans). */
export const PADDED_BY_PLAN: Record<PracticePlan, number> = { balanced: 1, sharpen: 2, install: 2, rest: 0 }
/** The season's regular-season weeks. */
export const REP_WEEKS = 18

/** The week's state for one club: the split, the install picks and the pads used. */
export interface RepWeekState {
  season: number
  week: number
  /** group → the starter's share of the group's reps (0 = all backups, 1 = all ones). */
  split: Record<string, number>
  /** The groups the staff splits (the card's Auto). */
  auto: string[]
  /** The concepts the coordinator installed for this opponent. */
  install: string[]
  /** Padded practices used so far this season (CBA cap). */
  padded: number
}

/** The user's saved practice-rep state (a legacy save has none). */
export type PracticeRepsState = RepWeekState

/** One AI club's practice-rep state for the week just run. */
export type AiWeekState = RepWeekState

/** The week's day structure: which days, how many in pads, and whether it is short. */
export interface WeekStructure {
  days: string[]
  /** Padded practices this week books (0 = walkthrough-only). */
  padded: number
  /** A Thursday game this week: no pads, one walkthrough. */
  short: boolean
  note: string
}

/** The groups the card shows, in order (the dev-plan groups, one definition). */
export const REP_GROUP_ORDER: string[] = [...DEV_GROUP_ORDER]
export const REP_GROUP_LABEL: Record<string, string> = DEV_GROUP_LABEL

/** Every position group a club actually has players in (skip an empty group). */
export function repGroupsFor(world: World, teamId: string): string[] {
  const have = new Set<string>()
  for (const p of world.roster[teamId] ?? []) have.add(devGroupFor(p.pos))
  return REP_GROUP_ORDER.filter((g) => have.has(g))
}

/** The club's game in a week, if it has one. */
function gameFor(world: World, teamId: string, week: number) {
  return world.schedule.find((g) => g.week === week && (g.homeId === teamId || g.awayId === teamId))
}

/**
 * The club's practice week. A Thursday game makes it a short week (one
 * walkthrough, no pads); a bye is no structure at all; a Sunday night or Monday
 * game buys the club an extra walkthrough day.
 */
export function weekStructure(world: World, teamId: string, week: number): WeekStructure {
  const g = gameFor(world, teamId, week)
  if (!g) return { days: [], padded: 0, short: false, note: 'No game this week — no padded practice.' }
  if (g.slot === 'TNF') {
    return { days: ['Mon', 'Wed'], padded: 0, short: true, note: 'Short week (Thursday game): one walkthrough, no pads.' }
  }
  const days = g.slot === 'SNF' || g.slot === 'MNF' ? ['Wed', 'Thu', 'Fri', 'Sat'] : ['Wed', 'Thu', 'Fri']
  return {
    days,
    padded: 1,
    short: false,
    note:
      g.slot === 'SNF' || g.slot === 'MNF'
        ? 'Wed install, Thu pads, Fri situational, Sat walkthrough (night game).'
        : 'Wed install, Thu pads, Fri situational.',
  }
}

/**
 * The padded practices this week and the load every gain scales by. The pads are
 * spent from the season's CBA budget: a club that has used all 14 is on
 * walkthroughs, and every gain this week is what a walkthrough is worth.
 */
export function repLoad(
  struct: WeekStructure,
  plan: PracticePlan,
  paddedLeft: number,
): { padded: number; load: number; note: string } {
  const book = struct.short || !struct.days.length ? 0 : PADDED_BY_PLAN[plan]
  const padded = Math.max(0, Math.min(book, Math.max(0, paddedLeft)))
  if (!book) {
    return { padded, load: struct.short || !struct.days.length ? REP.loadCut : struct.padded > 0 ? REP.loadCut : 1, note: struct.note }
  }
  if (padded >= book) return { padded, load: 1, note: struct.note }
  const load = padded > 0 ? 1 - (1 - REP.loadCut) * ((book - padded) / book) : REP.loadCut
  return { padded, load, note: `Padded practices used up (${PADDED_CAP}): walkthrough week.` }
}

/** The padded practices the user's club has used this season (0 on a legacy save). */
export function userPadded(world: World, career: CareerState): number {
  const r = career.practiceReps
  return r && r.season === world.season ? r.padded : 0
}

// ── The staff's Auto policy ───────────────────────────────────────────────────
/** The position coach in a group's seat (QB Coach, OL Coach, Secondary Coach…). */
export function groupCoach(world: World, teamId: string, group: string) {
  const map: Record<string, string> = {
    QB: 'QB Coach',
    OL: 'OL Coach',
    DL: 'DL Coach',
    CB: 'Secondary Coach',
    S: 'Secondary Coach',
    WR: 'WR Coach',
    LB: 'LB Coach',
  }
  const want = map[group]
  if (!want) return undefined
  return (world.staff[teamId] ?? []).find((m) => m.role === want)
}

/**
 * The Development read of the coach in this group's seat, from HIS OWN rating and
 * teaching profile: 0.75 (nobody in the seat, or a poor teacher) to 1.35 (a
 * developer). Used both by the Auto policy and by a young player's rep gains.
 */
export function groupCoachDev(world: World, teamId: string, group: string): number {
  const coach = groupCoach(world, teamId, group)
  if (!coach) return 0.75
  const prof = coachProfile(coach)
  return clamp(0.75 + ((coach.rating - 62) / 100) * 1.1 * teachFactor(prof.teaching), 0.7, 1.35)
}

/** The positions inside each rep group (the depth chart is per position, not group). */
export const GROUP_POSITIONS: Record<string, Position[]> = {
  QB: ['QB'],
  RB: ['RB'],
  FB: ['FB'],
  WR: ['WR'],
  TE: ['TE'],
  OL: ['OT', 'OG', 'C'],
  DL: ['DE', 'DT'],
  LB: ['LB'],
  CB: ['CB'],
  S: ['S'],
  KP: ['K', 'P'],
}

/** Every man in a group, the ones first, then the backups by depth then rating. */
export function groupPlayers(world: World, teamId: string, group: string): { p: Player; starter: boolean }[] {
  const out: { p: Player; starter: boolean; rank: number }[] = []
  for (const pos of GROUP_POSITIONS[group] ?? []) {
    const list = depthAt(world, teamId, pos)
    const slots = STARTERS[pos] ?? 1
    list.forEach((p, i) => out.push({ p, starter: i < slots, rank: i }))
  }
  out.sort((a, b) => Number(b.starter) - Number(a.starter) || b.p.ovr - a.p.ovr || a.rank - b.rank)
  return out.map(({ p, starter }) => ({ p, starter }))
}

/** A player's share of his group's reps, from his own depth-chart rank. */
export function repShareFor(world: World, teamId: string, p: Player, dial: number): number {
  const list = depthAt(world, teamId, p.pos)
  const rank = list.findIndex((x) => x.id === p.id)
  const slots = STARTERS[p.pos] ?? 1
  const s = clamp(dial, 0, 1)
  if (rank >= 0 && rank < slots) return s
  return clamp((1 - s) * (rank < slots + 2 ? 1 : 0.6), 0, 1)
}

/** The group's top of the depth chart (its first starter and his backup). */
export function groupDepth(world: World, teamId: string, group: string) {
  const list = groupPlayers(world, teamId, group)
  const starter = list.find((x) => x.starter)?.p
  const backup = list.find((x) => !x.starter)?.p
  return { starter, backup }
}

/**
 * The staff's Auto split for one group — the starters' share of the reps — from
 * the people involved: the owner's mandate for the club's season, the position
 * coach's own Development read, and the two players fighting for them (age,
 * remaining upside). No league or unit average is read. Quantised to 5%.
 */
export function autoSplitFor(
  world: World,
  teamId: string,
  group: string,
  opts?: { short?: boolean; mustWin?: boolean; week?: number },
): number {
  const { starter, backup } = groupDepth(world, teamId, group)
  let share = REP.neutral
  // The mandate: a win-now owner (or a club in a playoff push) keeps the ones sharp.
  const owner = ownerPersonality(teamId)
  if (owner === 'win-now') share += 0.14
  else if (owner === 'patient') share -= 0.14
  else if (owner === 'meddling') share += 0.06
  else share -= 0.06
  if (opts?.mustWin) share += 0.12
  // The coach in the seat: a developer wants the backups on the field, a
  // win-now teacher keeps the ones sharp. An EMPTY seat has no opinion — the
  // dial stays where the owner left it (previously the vacant-seat 0.75 pushed
  // almost every group to the cap).
  if (groupCoach(world, teamId, group)) share -= (groupCoachDev(world, teamId, group) - 1) * 0.9
  // The people: a young backup behind an older starter earns the reps himself.
  if (starter && backup) {
    const young = clamp((27 - backup.age) / 6, -1, 1)
    const old = clamp((starter.age - 28) / 5, -1, 1)
    share -= young * old * 0.2
    // A high-upside backup is worth the reps; a finished one is not.
    if (backup.pot - backup.ovr >= 6) share -= 0.08
    if (backup.pot - backup.ovr >= 6 && backup.age >= 29) share += 0.06
    if (starter.pot - starter.ovr >= 6 && starter.age <= 25) share += 0.08
  }
  // A short week has almost no reps to go around — the ones get them.
  if (opts?.short) share += 0.12
  return clamp(Math.round(share * 20) / 20, 0.3, 0.95)
}

/** Every group's Auto split for a club (the policy the card's Auto shows). */
export function autoSplit(world: World, teamId: string, opts?: { short?: boolean; mustWin?: boolean }): Record<string, number> {
  const out: Record<string, number> = {}
  for (const g of repGroupsFor(world, teamId)) out[g] = autoSplitFor(world, teamId, g, opts)
  return out
}

// ── Install ──────────────────────────────────────────────────────────────────
/** The coordinator in a side's seat. */
function coordinator(world: World, teamId: string, side: 'off' | 'def') {
  const role = side === 'off' ? 'Offensive Coordinator' : 'Defensive Coordinator'
  return (world.staff[teamId] ?? []).find((m) => m.role === role)
}

/**
 * The concepts the coordinator can install this week — HIS own install speed
 * (`coachProfile.install`, 2–6 weeks to mastery) times how much the opponent's
 * own people force the issue. A vacant seat installs one.
 */
export function installBudget(world: World, teamId: string): number {
  let n = 0
  for (const side of ['off', 'def'] as const) {
    const c = coordinator(world, teamId, side)
    n += c ? coachProfile(c).install : REP.installFloor
  }
  return clamp(Math.round(n / 3), REP.installFloor, 4)
}

/** The groups a play's assignments put on the field. */
function groupsOfPlay(name: string): string[] {
  const play = PLAYBOOK.find((p) => p.name === name)
  if (!play) return []
  const out = new Set<string>()
  for (const a of play.assignments) {
    if (a.pos.startsWith('WR')) out.add('WR')
    else if (a.pos === 'OL') out.add('OL')
    else out.add(a.pos)
  }
  return [...out]
}

/** A play's own personnel/type, for the UI. */
export function playInfo(name: string) {
  const play = PLAYBOOK.find((p) => p.name === name)
  return play ? { name: play.name, type: play.type, personnel: play.personnel, formation: play.formation, description: play.description, groups: groupsOfPlay(name) } : undefined
}

/**
 * The staff's install picks for this opponent. The opponent is read through the
 * specific MEN who will line up: their weakest coverage starter invites the
 * concepts that attack him, and their best individual rusher is a reason to keep
 * the ball quick. Deterministic; ties keep the playbook's order.
 */
export function autoInstall(world: World, _teamId: string, oppId: string | undefined, budget: number): string[] {
  if (!oppId) return []
  const opp = world.roster[oppId] ?? []
  const dull = (list: Player[], key: (attrs: Record<string, number>) => number) =>
    list.map((p) => ({ p, v: key(playerAttrs(p)) }))
  const corners = dull(
    opp.filter((p) => p.pos === 'CB' || p.pos === 'S').sort((a, b) => b.ovr - a.ovr).slice(0, 4),
    (a) => ((a.MCV ?? 70) + (a.ZCV ?? 70)) / 2,
  ).sort((a, b) => a.v - b.v)
  const rushers = dull(
    opp.filter((p) => p.pos === 'DE' || p.pos === 'DT' || p.pos === 'LB').sort((a, b) => b.ovr - a.ovr).slice(0, 4),
    (a) => Math.max(a.PMV ?? 70, a.FMV ?? 70),
  ).sort((a, b) => b.v - a.v)
  const weakCover = corners[0]?.v ?? 70
  const bestRush = rushers[0]?.v ?? 70
  const linebackers = opp.filter((p) => p.pos === 'LB').map((p) => ({ p, v: (playerAttrs(p).TAK ?? 70) + (playerAttrs(p).PUR ?? 70) }))
  const rushStuffed = rushers.map((r) => ({ p: r.p, v: (playerAttrs(r.p).BSH ?? 70) + (playerAttrs(r.p).STR ?? 70) }))
  const weakLb = linebackers.length ? Math.min(...linebackers.map((x) => x.v / 2)) : 70
  const weakFront = rushStuffed.length ? Math.min(...rushStuffed.map((x) => x.v / 2)) : 70
  const scored = PLAYBOOK.filter((p) => !p.trick).map((p) => {
    let s = 0
    if (p.type === 'pass') {
      // Attack the weakest coverage man: the deeper the concept, the more it needs him.
      s += (74 - weakCover) * (0.4 + Math.min(24, p.depth) / 40)
      // A dominant individual rusher: get the ball out (quick game, screens).
      s += (bestRush - 74) * (p.depth <= 6 ? 1.2 : p.depth <= 12 ? 0.3 : -0.5)
    } else {
      s += (74 - weakFront) * 0.8 // run at the front that cannot hold up
      s += (74 - weakLb) * 0.4 // and at the linebacker who cannot tackle
      s -= (bestRush - 74) * 0.4
    }
    return { name: p.name, s }
  })
  scored.sort((a, b) => b.s - a.s || a.name.localeCompare(b.name))
  return scored.slice(0, Math.max(0, budget)).map((x) => x.name)
}

/** The week's installed concepts the club actually runs (never more than the budget). */
export function installPicks(state: RepWeekState | undefined, budget: number): string[] {
  if (!state) return []
  return (state.install ?? []).filter((n) => !!playInfo(n)).slice(0, budget)
}

/** Every installed concept the week put on a group (checked by hand by the staff). */
export function installCountFor(install: string[], group: string): number {
  let n = 0
  for (const name of install) if (groupsOfPlay(name).includes(group)) n += 1
  return n
}

// ── The per-player effect ────────────────────────────────────────────────────
export interface RepEffect {
  id: string
  group: string
  /** The starter's share of his group's reps. */
  share: number
  /** Readiness: rating points added to his own mental ratings this week. */
  ready: number
  /** Fatigue charged to him this week. */
  fatigue: number
  /** His own soft-tissue threshold multiplier this week (1 = normal). */
  risk: number
  /** Fractional development banked this week (young players only). */
  dev: number
}

/** The mental keys readiness moves for a position (schema-filtered). */
export function readyKeysFor(pos: Position): string[] {
  const schema = ATTRIBUTE_SCHEMA[pos] ?? []
  const keys = REP.readyKeys.filter((k) => schema.includes(k))
  return keys.length ? keys : ['AWR']
}

/**
 * One player's week, from himself: his own learning rate (IQ × experience), his
 * own stamina ceiling, his own age and conditioning, and the coach in his seat.
 */
export function playerRepEffect(
  world: World,
  teamId: string,
  p: Player,
  share: number,
  load: number,
  install: string[] = [],
): RepEffect {
  const group = devGroupFor(p.pos)
  const attrs = playerAttrs(p)
  const learn = vetLearnMultiplier(p) // his OWN football IQ × experience (playbook.ts)
  // His own readiness band: a rookie benchwarmer gains little, an All-Pro vet a lot.
  const own = clamp(REP.readyLo + 0.75 * learn, REP.readyLo, REP.readyHi)
  const s = clamp(share, 0, 1)
  const up = Math.max(0, s - REP.neutral) / (1 - REP.neutral)
  const rust = Math.max(0, REP.neutral - s) / REP.neutral
  // Wear-down: his own conditioning sets the load he can carry. A well-conditioned
  // player takes the full week; a poorly conditioned one wears down under it.
  const sta = attrs.STA ?? 70
  const ceiling = clamp(0.84 + (sta - 70) / 110, 0.8, 1)
  const over = Math.max(0, s - ceiling) / Math.max(0.02, 1 - ceiling)
  const hot = (p.traits ?? []).some((t) => /tough|durable|conditioning/i.test(t)) ? 0.1 : 0
  const installN = installCountFor(install, group)
  const installEdge = Math.min(1, installN / 2) * REP.installReady * own
  const ready = (REP.ready * (up - rust * 0.65) * own - over * REP.overload * (1 - hot)) * load + installEdge * load
  // Load: everybody who took reps is charged, and his own conditioning softens it.
  const staRelief = clamp(1.5 - sta / 100, 0.55, 1.05)
  const fatigue = Math.pow(s, 1.2) * REP.fatigue * staRelief
  // Soft tissue: his own load band, widened by age and narrowed by his own TGH.
  const age = clamp(1 + (p.age - 26) * 0.06, 0.8, 1.6)
  const tgh = clamp(1.15 - (attrs.TGH ?? 70) / 200, 0.6, 1.15)
  const risk = clamp(1 + (s - REP.neutral) * REP.riskW * age * tgh, REP.riskLo, REP.riskHi)
  // Development: young players only, and only for the reps they actually took —
  // sized by their own learning rate, their remaining upside, their character and
  // the development read of the coach in their own seat.
  let dev = 0
  if (p.age <= MAX_DEV_AGE && p.teamId === teamId) {
    const coach = groupCoachDev(world, teamId, group)
    const char = p.character ? devModifier(p.character) : 1
    const fresh = p.age <= 23 ? 1.15 : 1
    // Only a man with something left to learn banks reps: a maxed-out player
    // (pot ≤ ovr) develops nothing, however many reps he takes.
    const upside = p.pot > p.ovr ? clamp((p.pot - p.ovr) / 8, 0.15, 1.2) : 0
    dev = REP.devWeek * s * upside * clamp(learn, 0.35, 1.8) * char * coach * fresh * load
  }
  return { id: p.id, group, share: s, ready, fatigue, risk, dev }
}

// ── Applying a week ──────────────────────────────────────────────────────────
export interface AppliedWeek {
  effects: RepEffect[]
  /** id → this week's soft-tissue threshold multiplier (for `healPlayers`). */
  risk: Record<string, number>
  /** The padded practices this week booked. */
  padded: number
  load: number
  note: string
}

/**
 * Run one club's practice week: charge the load, bank the reps, write the
 * readiness every man earned. Mutates the club's players (fatigue, snapReady,
 * repBank) and hands back the per-player risk map the heal step reads. No rng.
 */
export function applyPracticeWeek(
  world: World,
  teamId: string,
  split: Record<string, number>,
  opts: { season: number; week: number; plan?: PracticePlan; paddedLeft: number; install?: string[]; padded?: boolean },
): AppliedWeek {
  const struct = weekStructure(world, teamId, opts.week)
  const plan = opts.plan ?? 'balanced'
  const { padded, load, note } = repLoad(struct, plan, opts.paddedLeft)
  const install = (opts.install ?? []).filter((n) => !!playInfo(n)).slice(0, REP_GROUP_ORDER.length)
  const effects: RepEffect[] = []
  const risk: Record<string, number> = {}
  for (const p of world.roster[teamId] ?? []) {
    const group = devGroupFor(p.pos)
    const s = split[group] ?? REP.neutral
    // The ones take the starter share; the men behind them split the rest by rank.
    const share = repShareFor(world, teamId, p, s)
    const e = playerRepEffect(world, teamId, p, share, load, install)
    effects.push(e)
    risk[p.id] = e.risk
    p.repRisk = e.risk
    // Readiness: written fresh every week (it never accumulates).
    const keys = readyKeysFor(p.pos)
    const ready: Record<string, number> = {}
    for (const k of keys) {
      const v = Math.round(e.ready * 10) / 10
      if (v) ready[k] = v
    }
    if (Object.keys(ready).length) p.snapReady = ready
    else p.snapReady = undefined
    // Fatigue: the week's own recovery first (a body sheds load week to week),
    // then the reps he took. A Rest week clears the rest (see `healPlayers`).
    const shed = Math.round((p.fatigue ?? 0) * 0.3)
    p.fatigue = clamp(Math.round((p.fatigue ?? 0) - shed + e.fatigue), 0, 100)
    // The reps a young player banked develop his own weakest sim-relevant area.
    if (e.dev > 0) {
      const focus = devFocusById(p.devFocus) ?? devFocusById(autoFocusFor(p))
      const keys2 = focus ? focusKeysFor(p.pos, focus) : []
      if (keys2.length) {
        const bank: Record<string, number> = { ...(p.repBank ?? {}) }
        for (const k of keys2) bank[k] = (bank[k] ?? 0) + e.dev
        p.repBank = bank
      }
    }
  }
  return { effects, risk, padded, load, note }
}

/**
 * Convert every player's banked practice reps into whole rating points (the
 * season-end step, beside `developPlayers`). Capped per season and per career so
 * a career of heavy backup reps is worth a real but bounded improvement. The
 * gains land in `repDev`, which `playerAttrs` adds — never in `ovr`. No rng.
 */
export function convertRepBank(world: World): { players: number; points: number } {
  let players = 0
  let points = 0
  for (const p of world.players) {
    const bank = p.repBank
    p.repBank = undefined
    if (!bank) continue
    const cur: Record<string, number> = { ...(p.repDev ?? {}) }
    let gained = 0
    for (const k of Object.keys(bank)) {
      const have = cur[k] ?? 0
      const want = Math.min(REP.devLifeCap, have + Math.min(REP.devSeasonCap, Math.floor(bank[k])))
      if (want > have) {
        cur[k] = want
        gained += want - have
      }
    }
    if (gained > 0) {
      p.repDev = cur
      players += 1
      points += gained
    }
  }
  return { players, points }
}

/** A group's week at a glance, for the card (shares, readiness, load). */
export interface RepGroupView {
  group: string
  label: string
  share: number
  auto: boolean
  /** Starters' readiness this week, from the men themselves (points). */
  starterReady: number
  /** Backups' readiness. */
  backupReady: number
  /** Development a young backup banks a week here, in rating points. */
  devWeek: number
  /** Soft-tissue load band across the group. */
  riskLo: number
  riskHi: number
  /** The men at that group's depth chart, starter first. */
  names: { id: string; name: string; age: number; ovr: number; starter: boolean }[]
  install: number
}

/** The card's per-group preview: what this split does to THESE men. */
export function repGroupView(
  world: World,
  teamId: string,
  group: string,
  share: number,
  load: number,
  install: string[],
): RepGroupView {
  const list = groupPlayers(world, teamId, group)
  const names: RepGroupView['names'] = []
  let sReady = 0
  let sN = 0
  let bReady = 0
  let bN = 0
  let dev = 0
  let devN = 0
  let lo = 9
  let hi = 0
  for (const { p, starter } of list.slice(0, 8)) {
    const sh = repShareFor(world, teamId, p, share)
    const e = playerRepEffect(world, teamId, p, sh, load, install)
    if (starter) {
      sReady += e.ready
      sN += 1
    } else {
      bReady += e.ready
      bN += 1
      if (e.dev > 0) {
        dev += e.dev
        devN += 1
      }
    }
    lo = Math.min(lo, e.risk)
    hi = Math.max(hi, e.risk)
    names.push({ id: p.id, name: p.name, age: p.age, ovr: p.ovr, starter })
  }
  return {
    group,
    label: REP_GROUP_LABEL[group] ?? group,
    share,
    auto: false,
    starterReady: sN ? sReady / sN : 0,
    backupReady: bN ? bReady / bN : 0,
    devWeek: devN ? dev / devN : 0,
    riskLo: lo === 9 ? 1 : lo,
    riskHi: hi,
    names,
    install: installCountFor(install, group),
  }
}

/** The mastery multiplier this week's install puts on the club's game reps. */
export function installMasteryMult(install: string[], budget: number): number {
  return 1 + REP.installMastery * installPicks({ season: 0, week: 0, split: {}, auto: [], install, padded: 0 }, budget).length
}

/** The club's opponent in a week, if it has a game. */
export function opponentOf(world: World, teamId: string, week: number): string | undefined {
  const g = gameFor(world, teamId, week)
  if (!g) return undefined
  return g.homeId === teamId ? g.awayId : g.homeId
}

/**
 * The user's club's practice week as the card and the sim see it: the saved split
 * with every Auto group filled by the staff's policy, and the install picks (the
 * user's, or the coordinator's Auto list when the user has not chosen).
 */
export function userWeekReps(world: World, career: CareerState): RepWeekState {
  const teamId = career.teamId
  const week = world.week
  const season = world.season
  const groups = repGroupsFor(world, teamId)
  const saved = career.practiceReps && career.practiceReps.season === season ? career.practiceReps : undefined
  const struct = weekStructure(world, teamId, week)
  const auto = saved?.auto ?? groups
  const policy = autoSplit(world, teamId, { short: struct.short })
  const split: Record<string, number> = {}
  for (const g of groups) {
    const v = auto.includes(g) ? policy[g] : saved?.split?.[g]
    split[g] = clamp(Math.round((v ?? policy[g] ?? REP.neutral) * 20) / 20, 0.3, 0.95)
  }
  const budget = installBudget(world, teamId)
  const opp = opponentOf(world, teamId, week)
  const own = saved && saved.week === week ? installPicks(saved, budget) : []
  const install = own.length ? own : autoInstall(world, teamId, opp, budget)
  return { season, week, split, auto, install, padded: userPadded(world, career) }
}

/** An AI club's practice week: the same Auto policy, the same install budget. */
export function aiWeekReps(world: World, teamId: string, season: number, week: number): RepWeekState {
  const prev = world.aiPractice?.[teamId]
  const carried = prev && prev.season === season ? prev : undefined
  const struct = weekStructure(world, teamId, week)
  const split = autoSplit(world, teamId, { short: struct.short, mustWin: (world.standings[teamId]?.wins ?? 0) >= 9 })
  const budget = installBudget(world, teamId)
  const install = autoInstall(world, teamId, opponentOf(world, teamId, week), budget)
  return { season, week, split, auto: repGroupsFor(world, teamId), install, padded: carried?.padded ?? 0 }
}

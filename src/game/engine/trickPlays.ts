// ─────────────────────────────────────────────────────────────────────────────
// Trick plays (FUTURES #24 — T1 engine).
//
// Four limited-use calls (flea flicker, reverse, halfback pass, fake spike) plus
// the real spike, the scouting memory that decays them, and the OC's standing
// order. Everything here is pure arithmetic: the callers in `playsim.ts` own
// every rng() draw, so this layer adds NO rng draw and the default (AI-vs-AI, no
// user ctx) sim is byte-identical to the pre-feature snapshot.
//
// Individual ratings rule (user directive 2026-10-11): a trick's outcome comes
// from the men on the play — the thrower's own arm (the back's on an HB pass),
// the reverse carrier's own speed/agility, and the defenders' own AWR/PRC/SPD
// biting or not. Never a unit / roster mean, and never a flat `?? 70`.
//
//   surprise = fit(situation, defCall) · (1 − alert) · gameDecay · (1 − 0.2·read)
//   edge     = −3 + 9·surprise + 1 when the trick is installed this week
//
// `TRICK.aiRate` is T4: the AI calls tricks at NFL rates, scaled by the specific
// coordinator's own play-calling sub and aggression (never a league/unit mean),
// by the situation (a run-heavy stretch, midfield, trailing) and cut when the
// league has seen the call. The gate is a pure hash after the concept draw, so
// the rng stream is untouched by the decision itself.
// ─────────────────────────────────────────────────────────────────────────────

import { clamp, hash32 } from './rng'
import { playerAttrs } from '../data/ratings'
import { positionRating } from './individual'
import { POS_MEAN } from './ratingMeans'
import { conceptFromPlaybook, type SimConcept } from '../data/playbookData'
import { COACH_SUBS_FLOOR, coachSubs, getCoachSubs } from './coachSubs'
import type { Player, StaffMember } from '../types'
import type { World } from './generate'
import type { DefCall } from './decisions'
import type { STTeamRecord } from './specialCalls'
import type { GameState, MomentOption } from './playsim'

/** The local deterministic [0,1) hash (the `playsim` `h01` pattern): no rng draw. */
const h01 = (key: string): number => (hash32(key) >>> 0) / 4294967296

// ── Kinds, metadata and the tunables ─────────────────────────────────────────

export type TrickKind = 'flea' | 'reverse' | 'hbpass' | 'fakespike'/** What the pre-snap call moment can offer: one of the four tricks, or the real spike. */
export type TrickOffer = TrickKind | 'spike'

export const TRICK_KINDS: TrickKind[] = ['flea', 'reverse', 'hbpass', 'fakespike']

export function isTrickKind(v: string): v is TrickKind {
  return (TRICK_KINDS as string[]).includes(v)
}

export interface TrickMeta {
  /** The call card's label. */
  label: string
  /** One-line staff hint (what the call needs to work). */
  hint: string
  /** The `TRICK_PLAYS` entry this call runs (`data/playbookData.ts`). */
  concept: string
  /** Sacks multiply by this when the surprise is blown. */
  sackMult: number
  /** The exchange fumble chance per attempt (a hash, never an rng draw). */
  fumble: number
  /** Lower-case name for the scouting-memory line. */
  record: string
}

export const TRICKS: Record<TrickKind, TrickMeta> = {
  flea: {
    label: 'Flea flicker',
    hint: 'Handoff, pitch back to the QB, deep shot — it needs the front to bite.',
    concept: 'Flea Flicker',
    sackMult: 1.4,
    fumble: 0.02,
    record: 'flea flicker',
  },
  reverse: {
    label: 'Reverse',
    hint: 'Hand to the back, then to a receiver going the other way.',
    concept: 'Reverse',
    sackMult: 1,
    fumble: 0.025,
    record: 'reverse',
  },
  hbpass: {
    label: 'HB pass',
    hint: 'Toss to the back off the run look — he throws it.',
    concept: 'HB Pass',
    sackMult: 1.2,
    fumble: 0.012,
    record: 'HB pass',
  },
  fakespike: {
    label: 'Fake spike',
    hint: 'Sell the spike to stop the clock, then throw — the defence relaxes.',
    concept: 'Fake Spike',
    sackMult: 1,
    fumble: 0,
    record: 'fake spike',
  },
}

export const TRICK = {
  /** `edge = edgeLo + (edgeHi − edgeLo)·surprise`, added to the call-matrix edge. */
  edgeLo: -3,
  edgeHi: 6,
  /** Below this the trick is blown: kind-specific sack / exchange-fumble mods. */
  blown: 0.4,
  /** A good defensive look multiplies the fit by 1.3, a bad one by 0.5. */
  fitGood: 1.3,
  fitBad: 0.5,
  /** The 2nd trick in a game is a 0.6 read; the same trick a second time a 0.3 read. */
  decaySecond: 0.6,
  decaySame: 0.3,
  /** How far the defenders' own read of the look (0–1) cuts the surprise. */
  recogW: 0.2,
  /** An installed trick (this week's package) is worth +1 edge. */
  installedEdge: 1,
  /** A real spike earlier in the half makes the fake spike believable (+0.15 fit). */
  spikeFit: 0.15,
  /** The spike window: last minute of the half. */
  spikeWindowSec: 60,
  /** How many tricks one game plan can install. */
  maxPackage: 2,
  /** A scouted read at or above this shows as "alert" (matches the ST badge). */
  alertBadge: 0.34,
  /** The HB pass's weak-arm interception multiplier (surprise-independent). */
  hbIntMax: 1.8,
  /** The arm a back with no throwing rating of his own throws with. */
  hbArmFloor: 45,
  /** A back's own arm is normalised over this real-data span (backs carry THP
   *  ~20–55; the scale still maps a hypothetical 90 arm to 1.0). */
  hbArmMin: 20,
  hbArmSpan: 70,
  /** The flea flicker's completion is air-driven; a checkdown-compressed throw on
   *  the trick still carries the deep-shot air (yards). */
  fleaAirFloor: 22,
  /** A back's own completion penalty at the weakest arm. */
  hbCompMax: 0.12,
  /** Extra sack chance a trick snap carries on top of the shared model — the long
   *  mesh / slow-developing misdirection holds the ball longer. Trick-only. */
  sackExtra: { flea: 0.02, hbpass: 0, reverse: 0, fakespike: 0.015 } as Record<TrickKind, number>,
  // ── T4: the AI's trick appetite ────────────────────────────────────────────
  /**
   * T4: per-eligible-snap AI rates at a league-average coordinator. The nominal
   * eligible snaps are `aiSnaps`, so the nominal league total is Σ rate·snaps ≈
   * 0.037 tricks per team-game; the situation multipliers lift the realized rate to
   * ≈ 0.045 per team-game (≈ 0.75 per 17-game team-season). NFL truth (nflverse
   * 2021–25, 160 team-seasons): flea 22 + reverse 19 + RB pass 39 = 80 plays =
   * 0.50 per team-SEASON ≈ 0.03 per team-game; description-regex detection
   * undercounts (end-arounds, unlabelled fakes), so the target is up to ~2x that
   * (0.5–1.0 per team-season). Fake punts are a separate #4 system.
   */
  aiRate: { flea: 0.00022, reverse: 0.00022, hbpass: 0.00025, fakespike: 0.0007 } as Record<TrickKind, number>,
  /** Nominal eligible snaps per team-game (a fixed reference for the rate and the
   *  staff estimate — never a roster/unit average). */
  aiSnaps: { flea: 60, reverse: 55, hbpass: 40, fakespike: 2 } as Record<TrickKind, number>,
  /** The fixed staff-scale reference (a coordinator at 68 — the generated staff's
   *  own scale centre — adds nothing). A hard-coded constant like the J38 centres,
   *  never read from the world, and the deviation is the coach's alone. */
  coachRef: 68,
  /** How much his own play-calling sub and his own aggression move the rate. */
  appPcW: 0.018,
  appAggW: 0.014,
  appLo: 0.32,
  appHi: 1.9,
  /** Situation multipliers — the look the call needs. */
  sitRunHeavy: 1.35, // 3+ runs in the last 4 offensive snaps: the fake is set up
  sitRunLast: 1.12, // the previous snap was a run of 3+ yards
  sitMidfield: 1.2, // own 30 … own 70
  sitBackedUp: 0.65, // own 15 or worse
  sitTrailing: 1.2,
  sitTrailingBig: 1.25, // two scores down — multiplied into sitTrailing
  sitLeading: 0.78, // leading by 8+
  sitThird: 0.6,
  sitBlowout: 0.5, // 21+ either way
  sitHurry: 0.7,
  /** The 2nd trick of a game is called at this share; the same trick again at this. */
  callDecaySecond: 0.5,
  callDecaySame: 0.2,
  /** A scouted club's rate is cut by this share of `trickAlert`. */
  alertCut: 0.5,
  /** Games in a season, for the staff estimate. */
  seasonGames: 17,
  /**
   * T4: whether the E1 emergent pursuit field owns the yards on a trick RUN
   * (the reverse). The field's anchor is the *calibrated* CDF gain and its
   * stop-short branch regresses that anchor toward zero, which destroys the
   * reverse's own bimodal model (measured: E1 ON −1.8 ypc / 71% loss, E1 OFF
   * 9.2 ypc / 53% loss in the same world). T1's trick model owns the trick
   * outcome, so the field is bypassed on a trick snap. Only `call.trick` snaps
   * read this — the neutral sim is untouched.
   */
  fieldOnTrick: false,
} as const

// ── Scouting memory (extends the FUTURES #4 store — no new save field) ────────
// `STTeamRecord.tricks` counts each kind shown this season. `alertness()` is left
// alone, so special-teams outcomes (and the calibration) do not move.

/** How many times this club has shown one trick this season. */
export function trickCount(rec: STTeamRecord | undefined, kind: TrickKind): number {
  return rec?.tricks?.[kind] ?? 0
}

/**
 * 0 (fresh) … 1 (fully scouted) read of one trick: most of it is the trick the
 * defence has actually seen, plus a little for the others and for the club's
 * special-teams surprises.
 */
export function trickAlert(rec: STTeamRecord | undefined, kind: TrickKind): number {
  const same = trickCount(rec, kind)
  const tricks = rec?.tricks ?? {}
  let others = 0
  let fakes = 0
  for (const k of TRICK_KINDS) if (k !== kind) others += tricks[k] ?? 0
  // Fakes and surprise onsides read as "this club runs surprises".
  fakes = (rec?.fake ?? 0) + (rec?.surprise ?? 0)
  return clamp(same * 0.45 + others * 0.15 + fakes * 0.1, 0, 1)
}

/** One-line scouting read of a club's tricks this season, or '' when clean. */
export function trickRecordText(rec: STTeamRecord | undefined): string {
  const tricks = rec?.tricks
  if (!tricks) return ''
  const parts: string[] = []
  for (const kind of TRICK_KINDS) {
    const n = tricks[kind] ?? 0
    if (n > 0) parts.push(`${n} ${TRICKS[kind].record}${n > 1 ? 's' : ''}`)
  }
  if (!parts.length) return ''
  const alert = TRICK_KINDS.some((k) => trickAlert(rec, k) >= TRICK.alertBadge)
  return `${parts.join(' · ')} this season${alert ? ' — alert' : ''}`
}

/** Is the defence (or the league) on to at least one of your tricks? */
export function trickIsAlert(rec: STTeamRecord | undefined): boolean {
  return TRICK_KINDS.some((k) => trickAlert(rec, k) >= TRICK.alertBadge)
}

// ── In-game decay ────────────────────────────────────────────────────────────

/**
 * How much of the surprise is left in this game: the second trick on a Sunday is
 * a 0.6 read and the same trick a second time a 0.3 read (nothing else does).
 */
export function gameDecay(used: readonly TrickKind[] | undefined, kind: TrickKind): number {
  const list = used ?? []
  if (list.some((k) => k === kind)) return TRICK.decaySame
  return list.length > 0 ? TRICK.decaySecond : 1
}

// ── Situation: eligibility and fit ───────────────────────────────────────────

/** The snap situation a trick is judged on (built in `playsim.step`). */
export interface TrickSit {
  down: number
  distance: number
  /** Yards from the offence's own goal line. */
  yard: number
  qtr: number
  clock: number
  /** The offence is in two-minute mode. */
  hurry: boolean
  /** The last scrimmage play left the clock running. */
  clockRunning: boolean
  /** Inside your own 40 is the normal window; any field is fine except a bad look. */
  margin: number
}

interface TrickKindRule {
  /** Base fit before the situation and the defensive call. */
  base: number
  /** Eligible on this snap? */
  eligible: (s: TrickSit, rbOnField: boolean) => boolean
  /** Down/distance/field adjustment, added to the base fit. */
  form: (s: TrickSit) => number
  /** Defensive-call multipliers: the looks the call beats and the looks it does not. */
  vsDef: Record<DefCall, number>
}

const RULES: Record<TrickKind, TrickKindRule> = {
  // Any down, but never from inside the opponent's 10 (no room for the pitch back).
  flea: {
    base: 0.62,
    eligible: (s) => s.yard <= 90,
    form: (s) => (s.distance <= 5 ? 0.08 : 0) + (s.yard >= 50 ? 0.05 : 0),
    vsDef: { stack: TRICK.fitGood, blitz: 1.15, man: 1, zone: 0.6, twoHigh: TRICK.fitBad },
  },
  // A misdirection run: the front and the man coverage chase it, the zone does not.
  reverse: {
    base: 0.6,
    eligible: (s) => !(s.down >= 3 && s.distance >= 7),
    form: (s) => (s.down <= 2 ? 0.08 : 0) + (s.distance <= 3 ? 0.05 : 0),
    vsDef: { blitz: TRICK.fitGood, man: 1.2, twoHigh: 1, zone: 0.6, stack: 0.65 },
  },
  // The run look buys the back time; a deep shell takes the throw away.
  hbpass: {
    base: 0.55,
    eligible: (s, rb) => rb && !(s.down >= 3 && s.distance >= 10),
    form: (s) => (s.distance <= 6 ? 0.1 : 0) + (s.distance >= 10 ? -0.15 : 0),
    vsDef: { stack: TRICK.fitGood, blitz: 0.9, man: 1, zone: 0.95, twoHigh: TRICK.fitBad },
  },
  // Only in the last minute with the clock running; a relaxed (deep, soft) look.
  fakespike: {
    base: 0.5,
    eligible: (s) => (s.qtr === 2 || s.qtr === 4) && s.clock <= TRICK.spikeWindowSec && s.clockRunning && (s.hurry || s.margin <= 0),
    form: () => 0,
    vsDef: { zone: TRICK.fitGood, twoHigh: 1.25, stack: 0.9, man: 0.6, blitz: TRICK.fitBad },
  },
}

/** Is this call on the table on this snap? */
export function trickEligible(kind: TrickKind, sit: TrickSit, rbOnField = true): boolean {
  if (sit.down < 1 || sit.down > 4 || sit.clock <= 0) return false
  return RULES[kind].eligible(sit, rbOnField)
}

/**
 * How good the situation is for one trick (0–1 before the scouting read).
 * `defCall` is the call the defence actually made when it is known (the applied
 * surprise); the pre-snap meter omits it (the option list cannot know it yet).
 */
export function trickFit(kind: TrickKind, sit: TrickSit, defCall?: DefCall, spikeThisHalf = false): number {
  const rule = RULES[kind]
  let fit = rule.base + rule.form(sit)
  if (kind === 'fakespike' && spikeThisHalf) fit += TRICK.spikeFit
  if (defCall) fit *= rule.vsDef[defCall]
  return clamp(fit, 0.05, 1)
}

// ── The defence's own read (individual; never a unit mean) ───────────────────

/** The specific defender(s) whose own read decides how quickly the trick is sniffed out. */
export interface TrickRead {
  /** Centred read value (rating points), ~0 for a league-average pair. */
  value: number
  /** The men who made it. */
  ids: string[]
}

/** A rating the player carries, else his position's mean/blend — never a flat 70. */
function effKey(p: Player, key: string, a: Record<string, number>): number {
  return a[key] ?? positionRating(p.pos, a, key)
}

/** Centred rating value vs the average starter at his position. */
function relOf(pos: string, key: string, v: number): number {
  const m = POS_MEAN[pos]?.[key]
  return m === undefined ? 0 : v - m
}

/**
 * A defender's own read of a trick: AWR (does he recognise the look) and PRC
 * (does he keep his eyes right / not bite), plus — on the reverse — the SPD/ACC
 * that decides whether he can run it down. Centred on his own position.
 */
function readOf(p: Player, kind: TrickKind): number {
  const a = playerAttrs(p)
  const awr = relOf(p.pos, 'AWR', effKey(p, 'AWR', a))
  const prc = relOf(p.pos, 'PRC', effKey(p, 'PRC', a))
  if (kind === 'reverse') {
    const spd = relOf(p.pos, 'SPD', effKey(p, 'SPD', a))
    const acc = relOf(p.pos, 'ACC', effKey(p, 'ACC', a))
    return awr * 0.35 + prc * 0.25 + spd * 0.2 + acc * 0.2
  }
  return awr * 0.5 + prc * 0.5
}

/** The two men who decide it: the front seven on a misdirection, the second level otherwise. */
function readPool(defEleven: Player[], kind: TrickKind): Player[] {
  const front = defEleven.filter((p) => p.pos === 'DE' || p.pos === 'DT')
  const second = defEleven.filter((p) => p.pos === 'LB' || p.pos === 'CB' || p.pos === 'S')
  if (kind === 'reverse') return [...front, ...second]
  return second.length ? second : [...front, ...second]
}

/**
 * The defence's own read of one trick snap — the hash-picked pair's centred
 * value (weighted liked `alleyFill`, so an average pair reads 0 and only a
 * genuinely alert / fast defence or a genuinely slow one moves the surprise).
 */
export function trickDefRead(defEleven: Player[] | undefined, kind: TrickKind, n: number, defId: string): TrickRead {
  if (!defEleven || !defEleven.length) return { value: 0, ids: [] }
  const pool = readPool(defEleven, kind)
  if (!pool.length) return { value: 0, ids: [] }
  const first = hashPick(pool, (p) => Math.max(1, 100 + readOf(p, kind)), hash32(`${n}:${defId}:trickread`))
  if (!first) return { value: 0, ids: [] }
  const rest = pool.filter((p) => p.id !== first.id)
  const second = rest.length ? hashPick(rest, (p) => Math.max(1, 100 + readOf(p, kind)), hash32(`${n}:${defId}:trickread2`)) : undefined
  const pick = readOf(first, kind) + (second ? readOf(second, kind) : 0)
  const k = second ? 2 : 1
  // The weighted mean of the pair draw, so E[value] is 0 for a league-average D.
  let tot = 0
  let wMean = 0
  for (const p of pool) {
    const w = Math.max(1, 100 + readOf(p, kind))
    tot += w
    wMean += w * readOf(p, kind)
  }
  const value = pick / k - (tot > 0 ? wMean / tot : 0)
  return { value, ids: second ? [first.id, second.id] : [first.id] }
}

/** A defender-only hash pick (the playsim `hashPick` is not exported). */
function hashPick<T>(list: T[], weight: (t: T) => number, key: number): T | undefined {
  if (!list.length) return undefined
  const total = list.reduce((s, t) => s + Math.max(0, weight(t)), 0)
  if (total <= 0) return list[key % list.length]
  let roll = (key / 4294967296) * total
  for (const t of list) {
    const w = Math.max(0, weight(t))
    if (roll < w) return t
    roll -= w
  }
  return list[list.length - 1]
}

/** The read as a 0–1 factor (0.5 = a league-average defence). */
export function readFactor(value: number): number {
  return clamp(0.5 + value * 0.05, 0, 1)
}

// ── Surprise and effect ──────────────────────────────────────────────────────

export interface TrickSurprise {
  /** 0–1. */
  surprise: number
  fit: number
  alert: number
  decay: number
  read: number
  /** The read pair's centred value (rating points, ~0 league-average). */
  readValue: number
  /** The men whose read decided it (animation / film). */
  readIds: string[]
}

export interface TrickInput {
  world: World
  s: GameState
  offId: string
  kind: TrickKind
  /** The defensive call this snap, when it is already drawn. */
  defCall?: DefCall
  sit: TrickSit
  rbOnField?: boolean
  defEleven?: Player[]
}

export function trickSurprise(inp: TrickInput): TrickSurprise {
  const { world, s, offId, kind } = inp
  const mem = world.stMemory && world.stMemory.season === world.season ? world.stMemory.teams : undefined
  const alert = trickAlert(mem?.[offId], kind)
  const decay = gameDecay(s.tricksUsed?.[offId], kind)
  const spikeThisHalf = spikeSeenThisHalf(s, offId)
  const fit = trickFit(kind, inp.sit, inp.defCall, spikeThisHalf)
  const read = trickDefRead(inp.defEleven, kind, s.n, s.defId)
  const rf = readFactor(read.value)
  const surprise = clamp(fit * (1 - alert) * decay * (1 - TRICK.recogW * rf), 0, 1)
  return { surprise, fit, alert, decay, read: rf, readValue: read.value, readIds: read.ids }
}

/** Has this offence already shown a real spike in this half? (the fake's believability) */
export function spikeSeenThisHalf(s: GameState, offId: string): boolean {
  const half = s.qtr <= 2 ? 0 : 1
  for (const p of s.plays) {
    if (!p.spike || p.offId !== offId) continue
    if ((p.qtr <= 2 ? 0 : 1) === half) return true
  }
  return false
}

export interface TrickEffect {
  kind: TrickKind
  /** Added to the ordinary call-matrix edge. */
  edge: number
  /** Multiplies the call's sack chance (1 when the surprise landed). */
  sackMult: number
  /** The trick's own exchange fumble chance (applied with a hash in playsim). */
  fumbleRate: number
  blown: boolean
}

export function trickEffect(kind: TrickKind, surprise: number, installed = true): TrickEffect {
  const meta = TRICKS[kind]
  const s = clamp(surprise, 0, 1)
  const blown = s < TRICK.blown
  return {
    kind,
    edge: TRICK.edgeLo + (TRICK.edgeHi - TRICK.edgeLo) * s + (installed ? TRICK.installedEdge : 0),
    sackMult: blown ? meta.sackMult : 1,
    fumbleRate: meta.fumble,
    blown,
  }
}

// ── The individual men: the thrower and the reverse carrier ──────────────────

/** An HB pass's thrower: his own arm, accuracy, awareness and legs. */
export interface HbThrower {
  id: string
  /** The passing attribute record `resolvePass` should read. */
  attrs: Record<string, number>
  /** Added to the completion probability (negative — a back is not a QB). */
  compAdj: number
  /** Multiplies the interception base. */
  intMult: number
  /** The arm the model used (for the probe / the film line). */
  arm: number
}

/**
 * The back's passing line: his own THP/accuracy ratings when he carries them
 * (real-data backs do), else `TRICK.hbArmFloor`. A stronger arm throws a better
 * ball (`compAdj` → 0) and a safer one (`intMult` → 1); his own AWR trims both,
 * and his own mobility is read by `resolvePass` from the same record.
 */
export function hbThrower(p: Player): HbThrower {
  const attrs = playerAttrs(p)
  const arm = clamp(attrs.THP ?? TRICK.hbArmFloor, 10, 99)
  const sac = clamp(attrs.SAC ?? arm, 10, 99)
  const mac = clamp(attrs.MAC ?? sac, 10, 99)
  const dac = clamp(attrs.DAC ?? mac, 10, 99)
  const awr = effKey(p, 'AWR', attrs)
  // How far his arm is from a real QB arm (0 = a passer's arm, 1 = the floor).
  const shortfall = clamp((100 - arm) / (100 - TRICK.hbArmFloor), 0, 1)
  // His own awareness / experience throws the right ball a little more often.
  const read = clamp(relOf(p.pos, 'AWR', awr) * 0.01, -0.3, 0.3)
  return {
    id: p.id,
    attrs: { ...attrs, THP: arm, SAC: sac, MAC: mac, DAC: dac, TOR: attrs.TOR ?? dac, TUP: attrs.TUP ?? mac },
    compAdj: -TRICK.hbCompMax * shortfall * (1 - read),
    intMult: 1 + (TRICK.hbIntMax - 1) * shortfall * (1 - read),
    arm,
  }
}

/**
 * A receiver's elusiveness in the open field on a reverse — his own speed, burst,
 * change of direction and agility (≈70 scale, like the back-carrier formula, so
 * `(elusiveness − 72) × 0.6` in `resolveRun` reads the same way).
 */
export function trickCarrierElusiveness(p: Player): number {
  const a = playerAttrs(p)
  const spd = relOf(p.pos, 'SPD', effKey(p, 'SPD', a))
  const acc = relOf(p.pos, 'ACC', effKey(p, 'ACC', a))
  const agi = relOf(p.pos, 'AGI', effKey(p, 'AGI', a))
  const cod = relOf(p.pos, 'COD', effKey(p, 'COD', a))
  return clamp(72 + spd * 0.4 + acc * 0.25 + agi * 0.2 + cod * 0.15, 40, 99)
}

// ── The trick snap's own outcome model (trick-only; never the shared model) ───
// The amendment (orchestrator, try 3): the trick outcome must be BIMODAL on the
// defence's OWN read. When the key defenders bite (`surprise` high, their own
// AWR/PRC beaten) the window is wide open (a big completion, big YAC); when they
// read it the deep ball is contested (low comp, high INT) and the reverse is
// strung out for a loss. Every term comes from the specific men on the rep — the
// thrower's own arm, the reverse carrier's own legs, the read pair's own
// AWR/PRC/SPD — never a unit mean. These functions run ONLY on a trick snap (the
// `call.trick` guard in `playsim.ts`); every non-trick snap is untouched.

/** The trick snap's identity handed to the resolvers (built in `playsim.step`). */
export interface TrickSnap {
  kind: TrickKind
  /** 0–1. */
  surprise: number
  /** The read pair's centred value (rating points, ~0 for a league-average pair). */
  readValue: number
  /** The men whose own read decided it (film / probe / animation). */
  readIds: string[]
  /**
   * T4: a per-snap salt for the trick's own deterministic draws. A plain
   * `${n}:${offId}` key repeats across every game at the same play index, so a
   * rare call clustered on a few indices would decide its own outcome the same
   * way in every game (a systematic bias). The salt folds in the clock, field
   * and score, which differ game to game at the same snap. No rng draw.
   */
  salt: string
}

/** T4: the per-snap salt the trick draws hang off (see `TrickSnap.salt`). */
export function trickSalt(s: GameState, offId: string): string {
  return `${offId}:${s.n}:${s.qtr}:${s.clock}:${s.yard}:${s.down}:${s.distance}:${s.homeScore}-${s.awayScore}`
}

export interface TrickPassOut {
  /** The trick's own completion probability (may leave the shared clamp). */
  compProb: number
  /** The trick's own interception probability (may leave the shared clamp). */
  intProb: number
  /** Yards the deep shot adds on a completion (air + separation; 0 = none). */
  gainAdd: number
  /** Multiplier on the calibrated completion draw (1 = untouched). */
  gainMult: number
}

/**
 * A trick pass's own model. `arm` is the thrower's OWN arm on a 0–1 scale (0.5 =
 * a league-average QB; the back's own THP on an HB pass), and `targetSpdRel` is
 * the target's own speed centred on his position (yards). Bimodal in `open`:
 * `open` = 0.55·surprise + 0.45·readFactor(the pair's own read), so a sharp pair
 * (their own AWR/PRC) closes it and a dull one throws it wide open.
 */
export function trickPassOverride(t: TrickSnap, passAir: number, arm: number, targetSpdRel: number): TrickPassOut {
  const a = clamp(arm, 0, 1)
  // The defence's read (0.5 = league average): an alert pair CLOSES the window,
  // so openness takes (1 − rf), never rf.
  const rf = readFactor(t.readValue)
  if (t.kind === 'hbpass') {
    // The back's own arm: a passer's arm (≥90 on the real scale) completes a lot
    // more than a lineman-armed back (≤55), and throws far fewer picks. The arm
    // term is steep so the two ends separate ≥20 completion points and ≥3 INT
    // points even though the real-data backs cluster in 20–55.
    const open = clamp(0.5 * t.surprise + 0.5 * (1 - rf), 0, 1)
    const compProb = clamp(0.26 + 0.80 * a + 0.26 * open, 0.06, 0.98)
    const intProb = clamp(0 - 0.008 * t.surprise + 0.075 * (1 - a) + 0.012 * (1 - open), 0.004, 0.30)
    return { compProb, intProb, gainAdd: 0, gainMult: 1 }
  }
  if (t.kind === 'flea') {
    // The deep shot: a wide-open window when the front bites, contested when the
    // secondary reads the pitch back. A caught ball is air + separation, so the
    // YPA follows the window (10–12) instead of the shared ~11-yd completion.
    const open = clamp(0.45 * t.surprise + 0.55 * (1 - rf), 0, 1)
    const air = Math.max(passAir, TRICK.fleaAirFloor)
    // The deep window: a biting front / dull secondary leaves it wide (comp → ~0.9
    // and a 30-yd shot), a sharp pair that reads the pitch back closes it (comp →
    // ~0.25). The BASE is low and the SLOPE is steep on purpose: the read pair's
    // own AWR/PRC must separate the outcome widely (the user's elite-vs-poor
    // directive — a ≥20-pt completion gap between the sharpest and dullest pairs)
    // while the mid-window completion stays ≈ 45-50% (NFL 54.5%).
    const compProb = clamp(0.06 + 1.25 * open + (a - 0.5) * 0.08, 0.06, 0.95)
    const intProb = clamp(0.10 - 0.062 * t.surprise - 0.08 * (open - 0.5), 0.006, 0.30)
    const gainAdd = Math.round(air * (1.05 + 0.66 * open) + clamp(targetSpdRel, -25, 25) * 0.2)
    return { compProb, intProb, gainAdd, gainMult: 0.35 }
  }
  // Fake spike: the defence is set for the clock-killing spike, so a quick throw
  // into a relaxed look is a little easier; a read one is not.
  const open = clamp(0.5 * t.surprise + 0.5 * (1 - rf), 0, 1)
  const compProb = clamp(0.30 + 0.46 * open + (a - 0.5) * 0.08, 0.10, 0.86)
  const intProb = clamp(0.055 - 0.045 * t.surprise - 0.05 * (open - 0.5), 0.004, 0.20)
  return { compProb, intProb, gainAdd: 0, gainMult: 1 }
}

/**
 * A reverse's own gain: boom-or-bust. When the front and the pursuit bite the
 * carrier's own legs break it (SPD/ACC/AGI/COD); when they read it the play is
 * strung out for a loss. `elusiveness` is `trickCarrierElusiveness` (≈72-centred)
 * of the specific receiver on the rep. Deterministic hashes — no rng draw.
 */
export function trickRunGain(t: TrickSnap, elusiveness: number, key: string): number {
  const rf = readFactor(t.readValue)
  const open = clamp(0.55 * t.surprise + 0.45 * (1 - rf), 0, 1)
  const legs = elusiveness - 72
  // The man's own legs decide how often the pursuit strings him out (a burner
  // rarely loses ground; a slow receiver often does) — a ≥10-pt loss-rate gap
  // between the fastest and slowest carriers.
  const lossP = clamp(0.16 + 0.215 * (1 - open) - legs * 0.018, 0.05, 0.5)
  if (h01(`${key}:revblown`) < lossP) {
    // Read and strung out: a 2–8 yard loss (the pursuit catches him behind).
    return -(2 + Math.round(h01(`${key}:revlossmag`) * 6))
  }
  // They bit: the carrier's own legs plus how wide the edge is; a small share
  // breaks clean for a chunk.
  const base = 2.9 + legs * 0.42 + open * 5.9
  const extra = h01(`${key}:revbreak`) < 0.09 + 0.26 * open
    ? 9 + Math.round(h01(`${key}:revbig`) * 20)
    : 0
  return Math.round(clamp(base + extra, 1, 92))
}

/** Extra sack chance a trick snap carries on top of the shared model (0 = none). */
export function trickExtraSack(kind: TrickKind): number {
  return TRICK.sackExtra[kind] ?? 0
}

// ── The call moment's options ────────────────────────────────────────────────

export interface TrickEnv {
  /** The back on the field at the moment of the call (HB pass eligibility). */
  rb?: Player
  /** Whether a back is on the field; absent means "assume one" (the AI path). */
  hasRb?: boolean
  /** The roughest available guess at the defence on the field (the meter only). */
  defEleven?: Player[]
  /** The last scrimmage play left the clock running (the spike window). */
  clockRunning?: boolean
}

/** The snap situation, from the game state (the clock-running flag from playsim). */
export function trickSituation(s: GameState, clockRunning: boolean): TrickSit {
  const margin = s.offId === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore
  return {
    down: s.down,
    distance: s.distance,
    yard: s.yard,
    qtr: s.qtr,
    clock: s.clock,
    hurry: s.twoMinMode === 'hurry',
    clockRunning,
    margin,
  }
}

/**
 * The trick options (plus the real spike and the fake spike in the spike window)
 * for the pre-snap call moment. A trick that is not installed this week is never
 * offered; the spike is a formation call, not a package one.
 */
export function trickOptions(world: World, s: GameState, offId: string, pkg: readonly TrickKind[] | undefined, env?: TrickEnv): MomentOption[] {
  if (!s.ctx || s.ctx.userTeamId !== offId) return []
  const sit = trickSituation(s, env?.clockRunning ?? true)
  const out: MomentOption[] = []
  for (const kind of pkg ?? []) {
    if (!isTrickKind(kind) || !trickEligible(kind, sit, !!env?.rb)) continue
    const sur = trickSurprise({ world, s, offId, kind, sit, rbOnField: !!env?.rb, defEleven: env?.defEleven })
    const pct = Math.round(sur.surprise * 100)
    out.push({
      id: `trick:${kind}`,
      label: TRICKS[kind].label,
      hint: `${TRICKS[kind].hint} Surprise ${pct}%`,
    })
  }
  if (spikeEligible(sit)) {
    out.push({ id: 'spike', label: 'Spike', hint: 'Kill the clock: an incomplete pass, one down gone.' })
    const fake = trickSurprise({ world, s, offId, kind: 'fakespike', sit, rbOnField: !!env?.rb, defEleven: env?.defEleven })
    out.push({
      id: 'trick:fakespike',
      label: TRICKS.fakespike.label,
      hint: `${TRICKS.fakespike.hint} Surprise ${Math.round(fake.surprise * 100)}%`,
    })
  }
  return out
}

/** The real spike's window: last minute of a half, clock running, in a hurry. */
export function spikeEligible(sit: TrickSit): boolean {
  if (sit.clock <= 0 || sit.clock > TRICK.spikeWindowSec) return false
  if (sit.qtr !== 2 && sit.qtr !== 4) return false
  if (!sit.clockRunning) return false
  return sit.hurry || sit.margin <= 0
}

/** The concept one trick runs (`data/playbookData.ts:TRICK_PLAYS`). */
export function trickConcept(kind: TrickKind): SimConcept | undefined {
  return conceptFromPlaybook(TRICKS[kind].concept)
}

// ── The AI / delegated-OC hand-off (FUTURES #26, T4 rates) ───────────────────

/** T4: what the staff card shows about a club's play-caller. */
export interface AiTrickProfile {
  /** The specific coordinator in the seat (or 'vacant OC'). */
  ocName: string
  /** His own play-calling sub (J9; his overall rating when the sub toggle is off). */
  playCalling: number
  /** His own aggression — game management + play calling + a stable temperament. */
  aggression: number
  /** Multiplier on the league-reference trick rate (his own, 0.32–1.9). */
  mult: number
  /** Expected tricks per team-game and per 17-game season at this rate. */
  perGame: number
  perSeason: number
  /** One-word staff read. */
  word: string
}

/**
 * T4: a coordinator's own aggression. His game-management and play-calling subs
 * (J9, derived for old saves) plus a stable ±10 temperament offset hashed from
 * his own id — never a league, roster or unit mean. A vacant seat takes the
 * floor's game management (a poor, conservative chair), not an average one.
 */
export function coachAggression(m: StaffMember | undefined): number {
  if (!m) return COACH_SUBS_FLOOR.gameManagement
  const s = coachSubs(m)
  const temper = (hash32(`${m.id}:trickagg`, 13) % 21) - 10
  return clamp(Math.round(0.55 * s.gameManagement + 0.3 * s.playCalling + 0.15 * s.motivation + temper), 25, 99)
}

const aiProfileCache = new WeakMap<World, Map<string, AiTrickProfile>>()

/** T4: the club's AI trick rate, from its own coordinator (pure; cached per world). */
export function aiTrickProfile(world: World, teamId: string): AiTrickProfile {
  const oc = (world.staff[teamId] ?? []).find((s) => s.role === 'Offensive Coordinator')
  const key = `${world.season}:${teamId}:${oc?.id ?? 'none'}:${getCoachSubs() ? 's' : 'r'}`
  let cache = aiProfileCache.get(world)
  if (!cache) {
    cache = new Map()
    aiProfileCache.set(world, cache)
  }
  const hit = cache.get(key)
  if (hit) return hit
  // With the J9 sub toggle off, his one overall rating stands in for both traits
  // (still his own number, never a team mean).
  const subs = oc ? coachSubs(oc) : COACH_SUBS_FLOOR
  const playCalling = oc ? (getCoachSubs() ? subs.playCalling : oc.rating) : COACH_SUBS_FLOOR.playCalling
  const aggression = getCoachSubs() ? coachAggression(oc) : (oc?.rating ?? COACH_SUBS_FLOOR.gameManagement)
  const mult = clamp(
    1 + (playCalling - TRICK.coachRef) * TRICK.appPcW + (aggression - TRICK.coachRef) * TRICK.appAggW,
    TRICK.appLo,
    TRICK.appHi,
  )
  let base = 0
  for (const k of TRICK_KINDS) base += TRICK.aiRate[k] * TRICK.aiSnaps[k]
  const perGame = base * mult
  const word = mult >= 1.35 ? 'gambles' : mult >= 1.05 ? 'takes chances' : mult >= 0.8 ? 'measured' : 'conservative'
  const out: AiTrickProfile = {
    ocName: oc?.name ?? 'vacant OC',
    playCalling,
    aggression,
    mult: +mult.toFixed(3),
    perGame: +perGame.toFixed(3),
    perSeason: +(perGame * TRICK.seasonGames).toFixed(2),
    word,
  }
  cache.set(key, out)
  return out
}

/** T4: the last few offensive snaps (the run-heavy stretch a trick is set up by). */
function recentOffence(s: GameState, offId: string): { runs: number; n: number; lastRunYards: number | null } {
  let runs = 0
  let n = 0
  let lastRunYards: number | null = null
  for (let i = s.plays.length - 1; i >= 0 && n < 4; i--) {
    const p = s.plays[i]
    if (p.type !== 'run' && p.type !== 'pass') continue
    if (p.offId !== offId) break
    if (n === 0 && p.type === 'run') lastRunYards = p.yards
    n += 1
    if (p.type === 'run') runs += 1
  }
  return { runs, n, lastRunYards }
}

/**
 * T4: the situation's multiplier on the AI's rate. The NFL calls come after a
 * run-heavy stretch (the fake is set up), around midfield and while trailing;
 * they are rare on third down, backed up, in a blowout or in a hurry. The
 * recent-snap read is the club's own play sequence, not a unit average.
 */
function aiSituationMult(s: GameState, offId: string): number {
  const margin = offId === s.homeId ? s.homeScore - s.awayScore : s.awayScore - s.homeScore
  const recent = recentOffence(s, offId)
  let m = 1
  if (recent.runs >= 3) m *= TRICK.sitRunHeavy
  else if (recent.lastRunYards !== null && recent.lastRunYards >= 3) m *= TRICK.sitRunLast
  if (s.yard >= 30 && s.yard <= 70) m *= TRICK.sitMidfield
  else if (s.yard < 15) m *= TRICK.sitBackedUp
  if (margin < 0) m *= margin <= -9 ? TRICK.sitTrailing * TRICK.sitTrailingBig : TRICK.sitTrailing
  else if (margin > 7) m *= TRICK.sitLeading
  if (s.down === 3) m *= TRICK.sitThird
  if (Math.abs(margin) >= 21) m *= TRICK.sitBlowout
  if (s.twoMinMode === 'hurry' || s.twoMinMode === 'protect') m *= TRICK.sitHurry
  return m
}

/**
 * Whether the club's play-caller dials up a trick on this snap. The rate is the
 * play-caller's own (`aiTrickProfile`: his play-calling sub + aggression), scaled
 * by the situation and cut by `(1 − 0.5·alert)` when the league has seen the
 * call, then by the in-game decay (a second trick is half as likely, the same
 * trick again a fifth). The gate is a pure hash on the snap (never an rng draw),
 * so the decision cannot move the rng stream; only the snap it elects does.
 */
export function aiTrickCall(world: World, s: GameState, offId: string, pkg?: readonly TrickKind[], env?: TrickEnv): TrickKind | null {
  const sit = trickSituation(s, env?.clockRunning ?? true)
  const pool = pkg && pkg.length ? [...pkg] : [...TRICK_KINDS]
  const mem = world.stMemory && world.stMemory.season === world.season ? world.stMemory.teams : undefined
  const used = s.tricksUsed?.[offId] ?? []
  const prof = aiTrickProfile(world, offId)
  const sitMult = aiSituationMult(s, offId)
  for (const kind of pool) {
    if (!isTrickKind(kind)) continue
    // `env.hasRb === false` means no back is on the field (the HB pass needs one);
    // absent means assume one (the AI path never resolves the men up front).
    if (!trickEligible(kind, sit, env?.hasRb ?? true)) continue
    const alert = trickAlert(mem?.[offId], kind)
    const decay = used.length === 0 ? 1 : used.includes(kind) ? TRICK.callDecaySame : TRICK.callDecaySecond
    const p = TRICK.aiRate[kind] * prof.mult * sitMult * (1 - TRICK.alertCut * alert) * decay
    if (h01(`${trickSalt(s, offId)}:trick:${kind}`) < p) return kind
  }
  return null
}

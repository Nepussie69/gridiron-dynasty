// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B6b): the telestrator replay. This file decides WHETHER a
// play is replayed, the replay's timeline and WHICH telestrations draw WHEN.
// It is pure and node-importable (no DOM, no canvas, no rng, no clock):
// telestrator.ts paints the result.
//
//   const plan = replayPlan(play, anim, { setting: 'big', playback: 'live', reducedMotion })
//   if (plan.replay) {
//     const rp = new ReplayPlayer(plan)
//     per frame: const f = rp.advance(dt)   // f.t, f.showReplay, f.wipe, f.frozen …
//     skip button: rp.skip()                 // ends the replay immediately
//   }
//
// RULES (replayReasons). Setting 'big' (the default) replays:
//   touchdown       a run / pass into the end zone, a return TD, a defensive TD
//   safety          any safety
//   turnover        interception, lost fumble, muffed kick
//   bigGain         a run / completed pass of BIG_GAIN_YDS (20) or more
//   lateDownSack    a sack on 3rd or 4th down
//   longFieldGoal   a made field goal of LONG_FG_YDS (50) or more
// Setting 'all' replays every snapped play (not PATs, kneels, spikes or
// pre-snap penalties); 'off' none. Setting 'custom' replays only plays with at
// least one reason in `types` (the user's chosen set; default all six = 'big').
// `force` (a user pressing Replay) replays any
// replayable play. playback 'fast' (sim to end) NEVER replays: the plan is
// empty and nothing waits.
//
// TIMELINE (replay seconds from the start of the wipe, wall clock at 1×):
//   [0, wipe)            team-colour wipe; the cut to the replay is at wipe / 2
//                        (reduced motion: wipe = 0, a straight cut)
//   [cut, freezeStart)   the play from t0 (just before the snap; for very long
//                        plays the last MAX_SPAN_SEC) at `rate` (0.6..1)
//   [freezeStart, +FREEZE_SEC)  frozen at the key moment (catch / interception /
//                        sack / broken tackle / score / tackle)
//   [freezeEnd, playEnd) the rest of the play to t1 (whistle + a beat; empty
//                        when the freeze is the closing tackle / score)
//   [playEnd, +HOLD_SEC) hold on the last frame
//   [wipeOutStart, end)  wipe back to live (cut at the midpoint)
//
// TELESTRATIONS (anim keys only — every key exists in anim.actors):
//   route       the key receiver's route snap → catch (or the carrier's run
//               from the handoff, or the returner's return), arrowhead
//   yac         after the catch, dashed, with "+N AFTER CATCH" (≥ 5 yd)
//   airYards    the ball's arc throw → catch (or the kick), "N AIR YDS" / "N YDS"
//   separation  bracket receiver ↔ nearest defender at the catch, "x.x YD"
//   doubleTeam  circle round a double-teamed defender + both blockers
//   pocket      dashed outline through the OL at the throw (the sack on sacks)
//   pursuit     arrows of the nearest chasing defenders into the tackle
// ─────────────────────────────────────────────────────────────────────────────
import type { AnimEvent, AnimEventKind } from '../playAnim'
import type { Play } from '../../game/engine/playsim'
import type { BroadcastAnim } from './animData.ts'
import { posAt } from './interp.ts'

export type ReplaySetting = 'big' | 'all' | 'off' | 'custom'
/** 'live': the user watches the play; 'fast': sim to end (never replays). */
export type ReplayPlayback = 'live' | 'fast'
/** The six big-play reasons a custom replay set picks from (gd.view.replayTypes). */
export type ReplayReasonId = 'touchdown' | 'safety' | 'turnover' | 'bigGain' | 'lateDownSack' | 'longFieldGoal'
export type ReplayReason = ReplayReasonId | 'all' | 'forced'
/** Every reason, in a fixed order. */
export const REPLAY_REASON_IDS = ['touchdown', 'safety', 'turnover', 'bigGain', 'lateDownSack', 'longFieldGoal'] as const
/** The default custom set: all six reasons, i.e. exactly the plays 'big' replays. */
export const DEFAULT_REPLAY_TYPES: readonly ReplayReasonId[] = REPLAY_REASON_IDS
export type KeyKind = 'catch' | 'interception' | 'sack' | 'brokenTackle' | 'score' | 'tackle'
export type TeleKind = 'route' | 'yac' | 'airYards' | 'separation' | 'doubleTeam' | 'pocket' | 'pursuit'
/** Telestrator inks: the yellow pen, broadcast ink (white) and the defence red. */
export type TeleInk = 'pen' | 'ink' | 'def'

export const BIG_GAIN_YDS = 20
export const LONG_FG_YDS = 50
/** Team-colour wipe (seconds, in and out). */
export const WIPE_SEC = 0.7
/** Freeze at the key moment. */
export const FREEZE_SEC = 1.7
/** Hold on the last frame before the wipe out. */
export const HOLD_SEC = 0.8
/** Slowest replay rate; long plays speed up so the play part stays ≤ MAX_PLAY_SEC. */
export const REPLAY_RATE = 0.6
export const MAX_PLAY_SEC = 9
/** Longest stretch of a play a replay shows (anim seconds; the start is trimmed). */
export const MAX_SPAN_SEC = 11
/** Stroke draw-on time (0 under reduced motion). */
export const DRAW_ON = 0.45
export const FADE_OUT = 0.3
/** Seconds of play before the snap the replay starts at. */
const LEAD_SEC = 0.3
/** Seconds of play after the whistle the replay runs to. */
const TAIL_SEC = 0.5
/** A double team counts when two blockers overlap on one defender this long. */
const DOUBLE_MIN_SEC = 0.35
/** Pursuit: look back this far from the tackle; at most this many arrows. */
const PURSUIT_SEC = 1.6
const PURSUIT_MAX = 3
const PURSUIT_NEAR_YD = 9
const PURSUIT_MOVE_YD = 2.5

export interface ReplayOptions {
  setting?: ReplaySetting
  playback?: ReplayPlayback
  reducedMotion?: boolean
  /** The user asked for this replay (a Replay button): any replayable play. */
  force?: boolean
  /** 'custom': the reason ids to replay (default: every reason, same as 'big'). */
  types?: readonly ReplayReasonId[]
  /** B1 events (default anim.events). */
  events?: AnimEvent[]
}

export interface KeyMoment {
  kind: KeyKind
  /** Anim time 0..1. */
  t: number
  keys: string[]
  /** Short broadcast label for the freeze bug ("THE CATCH" …). */
  label: string
}

export interface Telestration {
  id: string
  kind: TeleKind
  /** Every actor this element references (all exist in anim.actors). */
  keys: string[]
  /** Anim-time window the geometry is sampled over (tracks draw t0 → min(t, t1)). */
  t0: number
  t1: number
  /** Snapshot time for static shapes (pocket, separation, circle centre cap). */
  at: number
  /** Replay seconds: appears (draw-on starts) / starts fading. */
  showSec: number
  hideSec: number
  /** Draw-on seconds (0 = appears whole; always 0 under reduced motion). */
  drawOn: number
  ink: TeleInk
  dashed: boolean
  arrow: boolean
  label: string | null
  /** Label appears from this replay second (e.g. air yards after the catch). */
  labelSec: number
  value?: number
  /** Ball-arc elements sample the ball (not an actor). */
  ball?: boolean
}

export interface ReplayTimes {
  cut: number
  freezeStart: number
  freezeEnd: number
  playEnd: number
  wipeOutStart: number
  end: number
}

export interface ReplayPlan {
  replay: boolean
  reasons: ReplayReason[]
  /** Play length (seconds of anim at 1×). */
  duration: number
  /** Anim window replayed (0..1). */
  t0: number
  t1: number
  /** Playback rate (anim seconds per replay second). */
  rate: number
  wipeSec: number
  key: KeyMoment | null
  times: ReplayTimes
  tele: Telestration[]
}

export type ReplayPhase = 'wipeIn' | 'play' | 'freeze' | 'hold' | 'wipeOut' | 'done'

export interface ReplayFrame {
  phase: ReplayPhase
  sec: number
  /** Anim time to render (1 = the live end frame before the cut). */
  t: number
  /** Render the replay (replay camera + telestrator); false = the live view. */
  showReplay: boolean
  /** Wipe band progress 0..1 while a wipe runs, else null. */
  wipe: number | null
  frozen: boolean
  /** Seconds into the freeze (0 outside it). */
  freezeAge: number
}

const NONE_TIMES: ReplayTimes = { cut: 0, freezeStart: 0, freezeEnd: 0, playEnd: 0, wipeOutStart: 0, end: 0 }

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const r1 = (v: number) => Math.round(v * 10) / 10

const TERMINAL = new Set<AnimEventKind>(['tackle', 'sack', 'outOfBounds', 'down', 'score', 'incomplete', 'safety', 'kickGood', 'kickMiss', 'touchback', 'fairCatch'])

function isSack(play: Play): boolean {
  return play.type === 'pass' && /^sack/i.test(play.result ?? '')
}

function fgGood(play: Play, events: AnimEvent[]): boolean {
  if (events.some((e) => e.kind === 'kickGood')) return true
  if (events.some((e) => e.kind === 'kickMiss')) return false
  const r = play.result ?? ''
  return /\bis good\b/i.test(r) && !/no good|blocked/i.test(r)
}

/** Field goal distance (same reading as the B6a toast). */
export function fgDistance(play: Play): number {
  const m = /(\d+)-y(?:ar)?d/i.exec(`${play.result} ${play.concept}`)
  return m ? Number(m[1]) : Math.round(100 - play.startYard + 17)
}

/** Plays that are never replayed (nothing to show). */
export function replayable(play: Play, events: AnimEvent[] = []): boolean {
  if (play.type === 'end' || play.type === 'pat' || play.type === 'penalty') return false
  const concept = play.concept ?? ''
  if (play.type === 'run' && /kneel|victory|spike/i.test(concept)) return false
  if (/kneel|spike/i.test(concept)) return false
  // A pre-snap foul (no snap) on a scrimmage play.
  if ((play.type === 'run' || play.type === 'pass') && events.length && !events.some((e) => e.kind === 'snap')) return false
  return true
}

/** The big-play / score reasons this play qualifies for (setting 'big'). Pure. */
export function replayReasons(play: Play, anim: BroadcastAnim, events: AnimEvent[] = anim.events ?? []): ReplayReason[] {
  if (!replayable(play, events)) return []
  const has = (k: AnimEventKind) => events.some((e) => e.kind === k)
  const out: ReplayReason[] = []
  const scrimmage = play.type === 'run' || play.type === 'pass'
  const kick = play.type === 'punt' || play.type === 'kickoff'
  const sack = isSack(play)
  const intc = has('interception') || /^interception/i.test(play.result ?? '')
  const turnover = kick ? has('turnover') || has('fumble') || play.returnKind === 'muff' || !!play.defTD : scrimmage ? !!play.turnover || intc || has('turnover') || !!play.defTD : !!play.defTD
  const td = (scrimmage && !turnover && play.endYard >= 100) || !!play.returnTD || !!play.defTD || (play.type !== 'fg' && has('score'))
  if (td) out.push('touchdown')
  if (play.safety || has('safety')) out.push('safety')
  if (turnover) out.push('turnover')
  const incomplete = play.type === 'pass' && (play.result === 'Incomplete' || has('incomplete'))
  if (scrimmage && !sack && !intc && !incomplete && !turnover && (play.yards ?? 0) >= BIG_GAIN_YDS) out.push('bigGain')
  if (sack && play.down != null && play.down >= 3) out.push('lateDownSack')
  if (play.type === 'fg' && fgGood(play, events) && fgDistance(play) >= LONG_FG_YDS) out.push('longFieldGoal')
  return out
}

/**
 * The reasons a custom replay keeps: those present in `types` (the user's chosen
 * set, gd.view.replayTypes). Pure and order-preserving; unknown ids are ignored.
 * An empty set keeps none, so nothing replays. Default = every reason ('big').
 */
export function customReplayReasons(reasons: readonly ReplayReason[], types: readonly ReplayReasonId[] = DEFAULT_REPLAY_TYPES): ReplayReason[] {
  const keep = new Set<string>(types)
  return reasons.filter((r) => keep.has(r))
}

function finalHolder(anim: BroadcastAnim): string | null {
  const h = anim.holders
  if (!h) return null
  for (let i = h.length - 1; i >= 0; i--) if (h[i].key) return h[i].key
  return null
}

const KEY_LABEL: Record<KeyKind, string> = {
  catch: 'THE CATCH',
  interception: 'THE PICK',
  sack: 'THE SACK',
  brokenTackle: 'BROKEN TACKLE',
  score: 'TOUCHDOWN',
  tackle: 'THE STOP',
}

/** The freeze moment from B1 events (priority: sack, pick, catch, broken tackle, score, tackle). */
export function keyMoment(play: Play, anim: BroadcastAnim, events: AnimEvent[] = anim.events ?? []): KeyMoment | null {
  const first = (k: AnimEventKind) => events.find((e) => e.kind === k)
  const order: KeyKind[] = play.type === 'fg' ? [] : ['sack', 'interception', 'catch', 'brokenTackle', 'score', 'tackle']
  for (const k of order) {
    // Kick plays: a "catch" is the returner fielding the ball, not worth a freeze.
    if (k === 'catch' && play.type !== 'pass') continue
    const e = first(k)
    if (!e) continue
    const t = clamp(e.t, 0, 1)
    // The tackle / score usually closes the play (t = 1): the freeze is then the last frame.
    if (t <= 0.02) continue
    return { kind: k, t, keys: e.keys.filter((x) => anim.actors.some((a) => a.key === x)), label: KEY_LABEL[k] }
  }
  return null
}

// ── geometry helpers on the anim (offense frame) ─────────────────────────────

function actorPath(anim: BroadcastAnim, key: string) {
  return anim.actors.find((a) => a.key === key)?.path
}

function nearestOpponent(anim: BroadcastAnim, key: string, t: number): { key: string; d: number } | null {
  const A = anim.actors.find((x) => x.key === key)
  if (!A) return null
  const p = posAt(A.path, t)
  let best: { key: string; d: number } | null = null
  for (const a of anim.actors) {
    if (a.side === A.side) continue
    const q = posAt(a.path, t)
    const d = Math.hypot(p.x - q.x, p.y - q.y)
    if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && a.key < best.key)) best = { key: a.key, d }
  }
  return best
}

/** The first double team: one defender, two 'double' blockers overlapping ≥ DOUBLE_MIN_SEC. */
export function firstDoubleTeam(anim: BroadcastAnim): { def: string; blockers: [string, string]; t0: number; t1: number } | null {
  const D = Math.max(0.05, (anim.duration || 0) / 1000)
  const dbl = (anim.engagements ?? []).filter((e) => e.kind === 'double')
  let best: { def: string; blockers: [string, string]; t0: number; t1: number } | null = null
  for (let i = 0; i < dbl.length; i++) {
    for (let j = i + 1; j < dbl.length; j++) {
      const a = dbl[i]
      const b = dbl[j]
      if (a.b !== b.b || a.a === b.a) continue
      const t0 = Math.max(a.t0, b.t0)
      const t1 = Math.min(a.t1, b.t1)
      if ((t1 - t0) * D < DOUBLE_MIN_SEC) continue
      if (!best || t0 < best.t0 - 1e-9) best = { def: a.b, blockers: a.a < b.a ? [a.a, b.a] : [b.a, a.a], t0, t1 }
    }
  }
  return best
}

function olKeys(anim: BroadcastAnim): string[] {
  return anim.actors
    .filter((a) => a.side === 'off' && (a.role === 'OL' || /^ol\d/.test(a.key)))
    .map((a) => a.key)
    .sort()
}

/** The receiver a pass was meant for: the catch / pick keys, else nearest eligible to the ball at the flight's end. */
function passTarget(anim: BroadcastAnim, events: AnimEvent[]): string | null {
  const c = events.find((e) => e.kind === 'catch')
  if (c && c.keys[0] && anim.actors.some((a) => a.key === c.keys[0] && a.side === 'off')) return c.keys[0]
  const thr = events.find((e) => e.kind === 'throw')
  if (thr && thr.keys[1] && anim.actors.some((a) => a.key === thr.keys[1])) return thr.keys[1]
  const fl = anim.flights?.[0]
  if (!fl) return null
  const bp = posAt(anim.ball, fl.t1)
  let best = Infinity
  let out: string | null = null
  for (const a of anim.actors) {
    if (a.side !== 'off' || a.key === 'qb' || a.role === 'OL' || a.key.startsWith('ol')) continue
    const p = posAt(a.path, fl.t1)
    const d = Math.hypot(p.x - bp.x, p.y - bp.y)
    if (d < best) {
      best = d
      out = a.key
    }
  }
  return out
}

function travelled(anim: BroadcastAnim, key: string, t0: number, t1: number): number {
  const p = actorPath(anim, key)
  const a = posAt(p, t0)
  const b = posAt(p, t1)
  return Math.hypot(b.x - a.x, b.y - a.y)
}

// ── the plan ─────────────────────────────────────────────────────────────────

const EMPTY = (reasons: ReplayReason[], D: number): ReplayPlan => ({
  replay: false,
  reasons,
  duration: D,
  t0: 0,
  t1: 1,
  rate: 1,
  wipeSec: 0,
  key: null,
  times: { ...NONE_TIMES },
  tele: [],
})

/** Whether and how to replay one play. Pure and deterministic. */
export function replayPlan(play: Play, anim: BroadcastAnim, opts: ReplayOptions = {}): ReplayPlan {
  const setting = opts.setting ?? 'big'
  const events = [...(opts.events ?? anim.events ?? [])].sort((a, b) => a.t - b.t)
  const D = Math.max(0.05, (anim.duration || 0) / 1000)
  // Sim to end never waits on a replay.
  if ((opts.playback ?? 'live') === 'fast') return EMPTY([], D)
  if (!replayable(play, events)) return EMPTY([], D)
  const big = replayReasons(play, anim, events)
  let reasons: ReplayReason[]
  if (opts.force) reasons = big.length ? big : ['forced']
  else if (setting === 'off') return EMPTY(big, D)
  else if (setting === 'all') reasons = big.length ? big : ['all']
  else if (setting === 'custom') reasons = customReplayReasons(big, opts.types)
  else reasons = big
  if (!reasons.length) return EMPTY([], D)

  const rm = !!opts.reducedMotion
  const first = (k: AnimEventKind) => events.find((e) => e.kind === k)
  const snap = first('snap')
  const snapT = snap ? clamp(snap.t, 0, 1) : 0
  let whistleT = -1
  for (const e of events) if (TERMINAL.has(e.kind)) whistleT = Math.max(whistleT, e.t)
  if (whistleT < 0) whistleT = 1
  const kickPlay = play.type === 'punt' || play.type === 'kickoff'
  // Returns: start when the returner is about to field the ball (skip the hang time).
  let t0 = Math.max(0, snapT - LEAD_SEC / D)
  if (kickPlay) {
    const fl = anim.flights?.[0]
    if (fl && fl.t1 < whistleT) t0 = Math.max(t0, fl.t1 - 1.2 / D)
  }
  const t1 = Math.min(1, whistleT + TAIL_SEC / D)
  // Very long plays (a 90-yd run lasts ~18 s): start later so the play part stays ≤ MAX_SPAN_SEC.
  if ((t1 - t0) * D > MAX_SPAN_SEC) t0 = t1 - MAX_SPAN_SEC / D
  let key = keyMoment(play, anim, events)
  if (key && (key.t <= t0 || key.t > t1)) key = null
  const span = (t1 - t0) * D
  const rate = clamp(span / MAX_PLAY_SEC, REPLAY_RATE, 1)
  const wipe = rm ? 0 : WIPE_SEC
  const cut = wipe / 2
  const kT = key ? key.t : t1
  const freezeStart = cut + ((kT - t0) * D) / rate
  const freezeEnd = freezeStart + (key ? FREEZE_SEC : 0)
  const playEnd = freezeEnd + ((t1 - kT) * D) / rate
  const wipeOutStart = playEnd + HOLD_SEC
  const end = wipeOutStart + wipe
  const times: ReplayTimes = { cut, freezeStart, freezeEnd, playEnd, wipeOutStart, end }
  /** Replay second at which anim time t plays (first pass; t = key → freeze start). */
  const secOf = (t: number) => {
    const tt = clamp(t, t0, t1)
    if (tt <= kT) return cut + ((tt - t0) * D) / rate
    return freezeEnd + ((tt - kT) * D) / rate
  }
  const tele = buildTele(play, anim, events, { t0, t1, D, key, times, secOf, drawOn: rm ? 0 : DRAW_ON, whistleT })
  return { replay: true, reasons, duration: D, t0, t1, rate, wipeSec: wipe, key, times, tele }
}

interface TeleCtx {
  t0: number
  t1: number
  D: number
  key: KeyMoment | null
  times: ReplayTimes
  secOf: (t: number) => number
  drawOn: number
  whistleT: number
}

function buildTele(play: Play, anim: BroadcastAnim, events: AnimEvent[], c: TeleCtx): Telestration[] {
  const out: Telestration[] = []
  const exists = (k: string | null | undefined): k is string => !!k && anim.actors.some((a) => a.key === k)
  const first = (k: AnimEventKind) => events.find((e) => e.kind === k)
  const endSec = c.times.end
  const stay = c.times.end // nothing outlives the replay
  const D = c.D
  const atKey = (kind: KeyKind) => c.key?.kind === kind
  const add = (t: Omit<Telestration, 'drawOn' | 'labelSec' | 'dashed' | 'arrow'> & Partial<Pick<Telestration, 'drawOn' | 'labelSec' | 'dashed' | 'arrow'>>) => {
    if (!t.keys.every(exists) && !t.ball) return
    if (t.t1 < t.t0) return
    out.push({ drawOn: c.drawOn, labelSec: t.showSec, dashed: false, arrow: false, ...t, hideSec: Math.min(t.hideSec, stay) })
  }
  const holder = finalHolder(anim)
  const tEnd = c.whistleT
  const throwEv = first('throw')
  const catchEv = play.type === 'pass' ? first('catch') : undefined
  const intEv = first('interception')
  const sackEv = first('sack')
  const sack = isSack(play) || !!sackEv
  const scrimmage = play.type === 'run' || play.type === 'pass'
  const kickPlay = play.type === 'punt' || play.type === 'kickoff'

  // ── double team (any scrimmage play) ──
  const dt = scrimmage ? firstDoubleTeam(anim) : null
  if (dt && dt.t0 < c.t1) {
    const s = c.secOf(Math.max(dt.t0, c.t0))
    let hide = Math.max(s + 1.6, c.secOf(dt.t1) + 0.8)
    // A freeze on the catch / a run is about the ball: clear the line first.
    if (c.key && c.key.kind !== 'sack' && s < c.times.freezeStart) hide = Math.min(hide, c.times.freezeStart + 0.3)
    // A sack: the double team is part of the story — keep it through the freeze.
    if (c.key?.kind === 'sack') hide = Math.max(hide, c.times.freezeEnd)
    add({ id: `double:${dt.def}`, kind: 'doubleTeam', keys: [dt.def, ...dt.blockers], t0: dt.t0, t1: dt.t1, at: dt.t1, showSec: s, hideSec: Math.max(s + 0.6, hide), ink: 'pen', label: 'DOUBLE TEAM' })
  }

  if (play.type === 'pass' && sack) {
    // ── sack: pocket at the sack, the rusher's path in ──
    const sT = sackEv ? sackEv.t : tEnd
    const ol = olKeys(anim)
    const freezeHere = atKey('sack')
    const show = freezeHere ? c.times.freezeStart + 0.1 : c.secOf(sT)
    if (ol.length >= 2 && exists('qb')) add({ id: 'pocket', kind: 'pocket', keys: [...ol, 'qb'], t0: sT, t1: sT, at: sT, showSec: show, hideSec: show + (freezeHere ? FREEZE_SEC + 1.2 : 2.2), ink: 'ink', dashed: true, label: 'POCKET' })
    const rusher = sackEv?.keys.find((k) => k !== 'qb' && exists(k))
    if (rusher) {
      const p0 = Math.max(c.t0, sT - PURSUIT_SEC / D)
      add({ id: `pursuit:${rusher}`, kind: 'pursuit', keys: [rusher], t0: p0, t1: sT, at: sT, showSec: c.secOf(p0), hideSec: endSec, ink: 'def', arrow: true, label: 'SACK', labelSec: c.secOf(sT) })
    }
    return out
  }

  if (play.type === 'pass') {
    const target = passTarget(anim, events)
    const snapT = first('snap')?.t ?? c.t0
    const thrT = throwEv?.t ?? anim.flights?.[0]?.t0 ?? null
    const recT = catchEv?.t ?? intEv?.t ?? anim.flights?.[0]?.t1 ?? null
    // ── pocket at the throw ──
    const ol = olKeys(anim)
    if (thrT != null && ol.length >= 2 && exists('qb')) {
      const s = c.secOf(thrT)
      add({ id: 'pocket', kind: 'pocket', keys: [...ol, 'qb'], t0: thrT, t1: thrT, at: thrT, showSec: s, hideSec: s + 1.4, ink: 'ink', dashed: true, label: null })
    }
    // ── route (snap → catch / the ball's arrival) ──
    if (exists(target) && recT != null) {
      add({ id: `route:${target}`, kind: 'route', keys: [target], t0: Math.max(snapT, c.t0), t1: recT, at: recT, showSec: c.secOf(Math.max(snapT, c.t0)), hideSec: endSec, ink: 'pen', arrow: true, label: null })
    }
    // ── air yards (ball arc throw → catch) ──
    if (thrT != null && recT != null && recT > thrT) {
      const air = play.passDepth != null ? Math.round(play.passDepth) : Math.round(posAt(anim.ball, recT).x - posAt(anim.ball, thrT).x)
      const labelSec = catchEv && atKey('catch') ? c.times.freezeStart : intEv && atKey('interception') ? c.times.freezeStart : c.secOf(recT)
      add({ id: 'air', kind: 'airYards', keys: exists('qb') ? ['qb'] : [], t0: thrT, t1: recT, at: recT, showSec: c.secOf(thrT), hideSec: c.times.freezeEnd + 1.6, ink: 'ink', dashed: true, label: `${air} AIR YDS`, labelSec, value: air, ball: true })
    }
    // ── separation at the catch ──
    if (catchEv && exists(target)) {
      const nd = nearestOpponent(anim, target, catchEv.t)
      if (nd) {
        const s = atKey('catch') ? c.times.freezeStart + 0.15 : c.secOf(catchEv.t)
        add({ id: `sep:${target}`, kind: 'separation', keys: [target, nd.key], t0: catchEv.t, t1: catchEv.t, at: catchEv.t, showSec: s, hideSec: (atKey('catch') ? c.times.freezeEnd : s + 0.6) + 1.0, ink: 'pen', label: `${r1(nd.d).toFixed(1)} YD`, value: r1(nd.d) })
      }
    }
    // ── after the catch / the return of a pick ──
    const carrier = intEv ? (exists(holder) ? holder : intEv.keys.find(exists)) : catchEv ? target : null
    const from = intEv?.t ?? catchEv?.t
    if (carrier && from != null && tEnd > from) {
      const yac = Math.round(posAt(actorPath(anim, carrier), tEnd).x - posAt(actorPath(anim, carrier), from).x)
      const run = travelled(anim, carrier, from, tEnd)
      if (run >= 2) {
        const s = c.secOf(from) + (c.key && Math.abs(c.key.t - from) < 1e-9 ? FREEZE_SEC : 0)
        const lab = !intEv && yac >= 5 ? `+${yac} AFTER CATCH` : null
        add({ id: `yac:${carrier}`, kind: intEv ? 'route' : 'yac', keys: [carrier], t0: from, t1: tEnd, at: tEnd, showSec: s, hideSec: endSec, ink: intEv ? 'def' : 'pen', dashed: !intEv, arrow: true, label: lab, labelSec: c.secOf(tEnd) })
      }
      if (!intEv && yac >= 10) pursuit(anim, carrier, tEnd, c, add)
    }
    return out
  }

  if (play.type === 'run') {
    const carrier = exists(holder) ? holder : null
    if (carrier) {
      const h = anim.holders.find((x) => x.key === carrier)
      const from = Math.max(c.t0, h ? h.t : c.t0)
      if (tEnd > from) add({ id: `route:${carrier}`, kind: 'route', keys: [carrier], t0: from, t1: tEnd, at: tEnd, showSec: c.secOf(from), hideSec: endSec, ink: 'pen', arrow: true, label: null })
      pursuit(anim, carrier, tEnd, c, add)
    }
    return out
  }

  if (kickPlay) {
    // The returner's run back (when the ball was returned).
    const carrier = exists(holder) && anim.actors.find((a) => a.key === holder)?.side === 'off' ? holder : null
    const fl = anim.flights?.[0]
    if (carrier && fl) {
      const from = Math.max(c.t0, fl.t1)
      if (tEnd > from && travelled(anim, carrier, from, tEnd) >= 3) {
        add({ id: `route:${carrier}`, kind: 'route', keys: [carrier], t0: from, t1: tEnd, at: tEnd, showSec: c.secOf(from), hideSec: endSec, ink: 'pen', arrow: true, label: null })
        pursuit(anim, carrier, tEnd, c, add)
      }
    }
    return out
  }

  if (play.type === 'fg') {
    const fl = anim.flights?.[0]
    if (fl && fl.t1 > fl.t0) {
      const kicker = first('kick')?.keys.find(exists)
      const dist = fgDistance(play)
      add({ id: 'air', kind: 'airYards', keys: kicker ? [kicker] : [], t0: fl.t0, t1: fl.t1, at: fl.t1, showSec: c.secOf(fl.t0), hideSec: endSec, ink: 'pen', dashed: true, label: `${dist} YDS`, labelSec: c.secOf(fl.t1), value: dist, ball: true })
    }
  }
  return out
}

/** Pursuit arrows: the nearest defenders chasing the carrier into the end of the play. */
function pursuit(anim: BroadcastAnim, carrier: string, tE: number, c: TeleCtx, add: (t: Omit<Telestration, 'drawOn' | 'labelSec' | 'dashed' | 'arrow'> & Partial<Telestration>) => void): void {
  const cs = anim.actors.find((a) => a.key === carrier)
  if (!cs) return
  const p0 = Math.max(c.t0, tE - PURSUIT_SEC / c.D)
  const at = posAt(cs.path, tE)
  const cands = anim.actors
    .filter((a) => a.side !== cs.side)
    .map((a) => {
      const q = posAt(a.path, tE)
      return { key: a.key, d: Math.hypot(q.x - at.x, q.y - at.y), move: travelled(anim, a.key, p0, tE) }
    })
    .filter((x) => x.d <= PURSUIT_NEAR_YD && x.move >= PURSUIT_MOVE_YD)
    .sort((a, b) => a.d - b.d || (a.key < b.key ? -1 : 1))
    .slice(0, PURSUIT_MAX)
  cands.forEach((x, i) => {
    add({ id: `pursuit:${x.key}`, kind: 'pursuit', keys: [x.key], t0: p0, t1: tE, at: tE, showSec: c.secOf(p0), hideSec: c.times.end, ink: 'def', arrow: true, label: i === 0 ? 'PURSUIT' : null, labelSec: c.secOf(tE) })
  })
}

// ── playback ─────────────────────────────────────────────────────────────────

/** The replay frame at replay second `sec`. Pure. */
export function replayAt(plan: ReplayPlan, sec: number): ReplayFrame {
  const T = plan.times
  if (!plan.replay || sec >= T.end) return { phase: 'done', sec, t: 1, showReplay: false, wipe: null, frozen: false, freezeAge: 0 }
  const W = plan.wipeSec
  const D = plan.duration
  const s = Math.max(0, sec)
  const kT = plan.key ? plan.key.t : plan.t1
  let t: number
  let phase: ReplayPhase
  let frozen = false
  let freezeAge = 0
  if (s < T.cut) {
    t = 1
    phase = 'wipeIn'
  } else if (s < T.freezeStart) {
    t = plan.t0 + ((s - T.cut) * plan.rate) / D
    phase = s < W ? 'wipeIn' : 'play'
  } else if (s < T.freezeEnd) {
    t = kT
    phase = 'freeze'
    frozen = true
    freezeAge = s - T.freezeStart
  } else if (s < T.playEnd) {
    t = kT + ((s - T.freezeEnd) * plan.rate) / D
    phase = 'play'
  } else if (s < T.wipeOutStart) {
    t = plan.t1
    phase = 'hold'
  } else {
    t = plan.t1
    phase = 'wipeOut'
  }
  t = clamp(t, 0, 1)
  let wipe: number | null = null
  if (W > 0 && s < W) wipe = s / W
  else if (W > 0 && s >= T.wipeOutStart) wipe = (s - T.wipeOutStart) / W
  const showReplay = s >= T.cut && s < T.wipeOutStart + W / 2
  return { phase, sec: s, t, showReplay, wipe, frozen, freezeAge }
}

/**
 * A replay clock: the caller advances it by real seconds; skip() ends the
 * replay immediately. Never blocks anything — a 'done' frame means "go live".
 */
export class ReplayPlayer {
  readonly plan: ReplayPlan
  sec = 0
  done: boolean
  constructor(plan: ReplayPlan) {
    this.plan = plan
    this.done = !plan.replay
  }
  advance(dt: number): ReplayFrame {
    if (!this.done) {
      this.sec += Math.max(0, dt)
      if (this.sec >= this.plan.times.end) this.done = true
    }
    return this.frame()
  }
  seek(sec: number): ReplayFrame {
    this.sec = Math.max(0, sec)
    this.done = !this.plan.replay || this.sec >= this.plan.times.end
    return this.frame()
  }
  /** End the replay now (the skip control). */
  skip(): void {
    this.done = true
    this.sec = this.plan.times.end
  }
  frame(): ReplayFrame {
    return replayAt(this.plan, this.done ? Math.max(this.sec, this.plan.times.end) : this.sec)
  }
}

/** Draw progress (0..1) and alpha of one telestration at replay second `sec`. */
export function teleState(item: Telestration, sec: number): { draw: number; alpha: number; label: boolean } {
  if (sec < item.showSec || sec >= item.hideSec + FADE_OUT) return { draw: 0, alpha: 0, label: false }
  const draw = item.drawOn > 0 ? clamp((sec - item.showSec) / item.drawOn, 0, 1) : 1
  const alpha = sec <= item.hideSec ? 1 : 1 - (sec - item.hideSec) / FADE_OUT
  return { draw, alpha: clamp(alpha, 0, 1), label: !!item.label && sec >= item.labelSec && draw >= 0.6 }
}

// ── live telestration (every play, not only replays) ─────────────────────────

/**
 * The Drawings setting (gd.view.drawings): draw the telestrations on every
 * play ('every', the default), keep them replay-only ('replays' = the old
 * behaviour exactly) or off ('off').
 */
export type DrawingsMode = 'every' | 'replays' | 'off'

export interface LiveTeleOptions {
  setting?: DrawingsMode
  reducedMotion?: boolean
  /** 'fast' (sim to end) draws nothing, like a replay's fast playback. */
  playback?: ReplayPlayback
  events?: AnimEvent[]
}

/** How long after the last frame a live telestration holds (cleared on the next snap). */
const LIVE_TAIL = 0.35

/**
 * The telestrations to draw on a normal (non-replay) play, in LIVE anim seconds
 * (0..1 of the play). The set is exactly what a replay of the play would build
 * (replayPlan with setting 'all', so a play that never replays — a 3-yd run —
 * still gets its set if it would have one), only the schedule differs:
 *
 *   - a track (route / carry, after-catch, air-yards arc, pursuit) appears once
 *     the anim time reaches its t0 and its stroke grows with the anim time (the
 *     route as the receiver runs, the arc as the ball flies);
 *   - a static shape (pocket, separation bracket, double-team circle, catch
 *     ring) appears at its `at` time, drawing on like a replay's;
 *   - a label appears once its item is complete;
 *   - everything holds through the end-of-play hold (the caller clears it on
 *     the next snap).
 *
 * Empty for 'replays' / 'off', for 'fast' playback (sim to end), for a play
 * that builds nothing (a kneel / spike / PAT / pre-snap foul) and when there is
 * no item. Pure and deterministic (no DOM, no clock).
 */
export function liveTelestrations(play: Play, anim: BroadcastAnim, opts: LiveTeleOptions = {}): Telestration[] {
  if ((opts.setting ?? 'every') !== 'every') return []
  if ((opts.playback ?? 'live') === 'fast') return []
  const events = opts.events ?? anim.events ?? []
  if (!replayable(play, events)) return []
  // The same item builder the replay uses; 'all' so a play that does not
  // qualify for a replay still gets the set a replay of it would show.
  const plan = replayPlan(play, anim, { setting: 'all', reducedMotion: !!opts.reducedMotion, events })
  if (!plan.tele.length) return []
  const drawOn = opts.reducedMotion ? 0 : DRAW_ON
  const hideSec = 1 + LIVE_TAIL
  return plan.tele.map((it) => {
    const track = it.kind !== 'separation' && it.kind !== 'doubleTeam' && it.kind !== 'pocket'
    const showSec = track ? it.t0 : it.at
    const labelSec = track ? it.t1 : Math.min(it.at + drawOn, hideSec)
    return { ...it, showSec, hideSec: Math.max(showSec + 0.05, hideSec), labelSec, drawOn }
  })
}

// ── B8: Game Day's replay rules (pure; MatchView + liveView play the result) ──

/** Seconds an automatic replay holds the live end frame + result toast before its wipe. */
export const GAME_DAY_LEAD_SEC = 0.9

export interface GameDayReplayCtx {
  /** The user's Replays setting (B7: localStorage gd.view.replays). */
  setting: ReplaySetting
  /** 'custom': the reason ids to replay (B7: gd.view.replayTypes). */
  types?: readonly ReplayReasonId[]
  /** The Replay button on the replay pill: replay the play on screen now. */
  force?: boolean
  reducedMotion?: boolean
  /** Sim to end was pressed: automatic replays never run ('fast' playback). */
  simming?: boolean
  /** The game is playing on (not paused / browsing plays). */
  playing?: boolean
  /** Space / Pause froze the animation. */
  frozen?: boolean
  /** A decision (moment card) is waiting: plays run straight to it, no replays. */
  decisionPending?: boolean
}

/**
 * Whether Game Day replays this play, and the beat before its wipe. Automatic
 * replays only run while the game plays on with no decision waiting and never
 * after Sim to end; the Replay button replays any replayable play at once
 * (even with the setting off, or after Sim to end). Never blocks: the caller
 * ends a replay on Skip, a new play, new plays or a decision coming up.
 */
export function gameDayReplay(play: Play, anim: BroadcastAnim, ctx: GameDayReplayCtx): { plan: ReplayPlan; lead: number } {
  const force = !!ctx.force
  const D = Math.max(0.05, (anim.duration || 0) / 1000)
  if (!force && (!ctx.playing || ctx.frozen || ctx.decisionPending)) return { plan: EMPTY([], D), lead: 0 }
  const plan = replayPlan(play, anim, {
    setting: ctx.setting,
    types: ctx.types,
    force,
    reducedMotion: ctx.reducedMotion,
    playback: !force && ctx.simming ? 'fast' : 'live',
  })
  return { plan, lead: force || !plan.replay ? 0 : GAME_DAY_LEAD_SEC }
}

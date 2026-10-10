// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B6a): broadcast graphics — WHAT shows WHEN. Pure and
// node-importable (no DOM, no canvas): graphicsDraw.ts paints the result.
//
//   const tl = buildGraphicsTimeline({ anim, play, offense, defense, people })
//   const g  = graphicsAt(tl, sec, { reducedMotion, mode })   // per frame
//
// The graphics clock `sec` is seconds relative to the animation's t = 0:
//   [tl.start = −preSnap, 0)  pre-snap: down & distance chip + play clock
//   [0, tl.duration]          the play (anim t = sec / duration)
//   (…, tl.end]               the result toast holds `post` seconds after it
// Nothing here waits on anything: the caller owns the clock. Sim-to-end / fast
// paths pass mode 'fast' (chip only) or 'off', so graphics never cover the
// field while the user skips.
//
// Graphics:
//   chip      down & distance + ball spot (+ concept and play clock pre-snap);
//             flashes when the carrier crosses the line to gain (firstDown).
//   clock     pre-snap play-clock countdown (value at the snap is derived
//             deterministically from the play; no rng).
//   lower     lower third: the key player (receiver after the catch, runner
//             after the handoff, returner, interceptor; else the passer /
//             kicker) with name, number, position and a non-spoiling stat
//             line from the Play — from that moment to the whistle.
//   toast     result toast after the whistle: big number (+17 / INC / TD …),
//             headline, badge (first down / touchdown / turnover / safety),
//             the play text and up to four stats.
//   callouts  player callouts tied to B1 events / engagements (see
//             EVENT_GRAPHICS): DOUBLE TEAM, SEPARATION x.x YD, TIME TO THROW
//             x.xs, BROKEN TACKLE. Each has an anchor actor, a show window and
//             a priority; at most MAX_CALLOUTS at once and one per anchor
//             (resolved here, deterministically, by priority).
//
// layoutCallouts() (also pure) places callout boxes on screen: leader line
// from the anchor's head point, never covering the ball carrier's head point,
// never overlapping each other, the reserved HUD rects or the viewport edge.
// ─────────────────────────────────────────────────────────────────────────────
import type { AnimEventKind, EngageKind } from '../playAnim'
import type { Play } from '../../game/engine/playsim'
import type { BroadcastAnim } from './animData.ts'
import { holderAt, posAt } from './interp.ts'
import type { ClubLike } from './palette.ts'

// ── public types ─────────────────────────────────────────────────────────────

/** The real player an animation key stands for (from the caller's roster lookup). */
export interface PersonInfo {
  name: string
  number?: number
  pos?: string
}

export interface GraphicsInput {
  anim: BroadcastAnim
  play: Play
  /** The club with the ball (play.offId). */
  offense: ClubLike
  defense: ClubLike
  /** Animation key → real player (names / numbers / positions). */
  people?: Record<string, PersonInfo>
  /** Seconds of pre-snap graphics before anim t = 0 (default 2.4). */
  preSnap?: number
  /** Seconds the result toast holds after the animation ends (default 2.6). */
  post?: number
  /** Play clock at the snap (default: derived from the play, 2–14). */
  playClockAtSnap?: number
}

export type CalloutKind = 'doubleTeam' | 'separation' | 'timeToThrow' | 'brokenTackle'
export type Accent = 'off' | 'def' | 'gold'

export interface Callout {
  id: string
  kind: CalloutKind
  /** Actor key whose head point the leader line starts from. */
  anchor: string
  /** Show window (graphics seconds). */
  t0: number
  t1: number
  /** Higher wins when more than MAX_CALLOUTS want the screen. */
  priority: number
  title: string
  sub: string
  accent: Accent
  /** The measured number (yards / seconds), for B6b telestrator and checks. */
  value?: number
  /** Other actors involved (blockers of a double team, the nearest defender, the missed tackler). */
  others: string[]
}

export interface ChipItem {
  t0: number
  t1: number
  /** "3RD & 6", "KICKOFF", "PAT" … */
  down: string
  /** "ATL 38" / "50" (empty when no spot applies). */
  spot: string
  /** Pre-snap concept line ("PA DEEP CROSS"), shown until the snap. */
  concept: string | null
  /** When the line to gain was crossed (graphics seconds), or null. */
  firstDownAt: number | null
}

export interface ClockItem {
  t0: number
  /** The snap (graphics seconds). */
  t1: number
  atSnap: number
}

export interface LowerThirdItem {
  t0: number
  t1: number
  key: string
  side: 'off' | 'def'
  name: string
  number: number | null
  pos: string
  stat: string
}

export type BadgeKind = 'firstDown' | 'touchdown' | 'turnover' | 'safety' | 'good' | 'noGood' | 'flag'

export interface ToastStat {
  value: string
  label: string
}

export interface ToastItem {
  t0: number
  t1: number
  /** Which club's slab carries the big number. */
  side: 'off' | 'def'
  big: string
  head: string
  badge: { kind: BadgeKind; label: string } | null
  sub: string
  stats: ToastStat[]
}

export interface DroppedCallout {
  kind: CalloutKind
  anchor: string
  t0: number
  t1: number
  reason: string
}

export interface GraphicsTimeline {
  /** Animation length (seconds). */
  duration: number
  preSnap: number
  post: number
  /** First / last graphics second (start = −preSnap, end = duration + post). */
  start: number
  end: number
  /** The snap (graphics seconds; 0 when the play has no snap, e.g. kickoffs). */
  snapSec: number
  /** The whistle: the last terminal event (graphics seconds). */
  whistleSec: number
  chip: ChipItem
  clock: ClockItem | null
  lower: LowerThirdItem | null
  toast: ToastItem
  /** After cap / anchor resolution, sorted by t0. */
  callouts: Callout[]
  dropped: DroppedCallout[]
  offense: ClubLike
  defense: ClubLike
}

export type GraphicsMode = 'full' | 'fast' | 'off'

export interface GraphicsOptions {
  reducedMotion?: boolean
  /** 'fast' (sim to end / skipping): the chip only. 'off': nothing. */
  mode?: GraphicsMode
}

/** One graphic's state this frame. alpha: fade; enter: 0..1 wipe-in progress (1 under reduced motion). */
export interface Shown<T> {
  item: T
  alpha: number
  enter: number
}

export interface GraphicsFrame {
  sec: number
  /** Play time 0..1 for this second. */
  t: number
  chip: (Shown<ChipItem> & { flash: number; preSnap: number }) | null
  clock: (Shown<ClockItem> & { value: number; urgent: boolean }) | null
  lower: Shown<LowerThirdItem> | null
  toast: Shown<ToastItem> | null
  callouts: Shown<Callout>[]
}

// ── event / engagement map ───────────────────────────────────────────────────
// Every B1 event kind and engagement kind maps to a graphic or to an
// intentional ignore (with the reason). Typed as a full Record so a new kind in
// playAnim.ts fails the build until it is mapped here; scripts/check-broadcast
// also parses the unions in playAnim.ts against these keys.

export type GraphicRole =
  | { use: 'callout'; callout: CalloutKind }
  | { use: 'chip' | 'clock' | 'lower' | 'toast'; why: string }
  | { use: 'ignore'; why: string }

export const EVENT_GRAPHICS: Record<AnimEventKind, GraphicRole> = {
  snap: { use: 'clock', why: 'ends the play clock and the pre-snap concept line; time-to-throw is measured from it' },
  playAction: { use: 'ignore', why: 'the fake is visible on the field; the telestrator replay (B6b) draws it' },
  scramble: { use: 'ignore', why: 'visible on the field; the lower third already names the passer' },
  break: { use: 'ignore', why: 'separation is measured at the catch; the replay (B6b) freezes on the break' },
  throw: { use: 'callout', callout: 'timeToThrow' },
  catch: { use: 'callout', callout: 'separation' },
  incomplete: { use: 'toast', why: 'INC result toast' },
  interception: { use: 'lower', why: 'lower third switches to the interceptor; INT toast' },
  brokenTackle: { use: 'callout', callout: 'brokenTackle' },
  contact: { use: 'toast', why: 'yards after contact stat on runs' },
  tackle: { use: 'toast', why: 'whistle → result toast' },
  sack: { use: 'toast', why: 'whistle → SACK toast (lower third names the sacker in the toast line)' },
  outOfBounds: { use: 'toast', why: 'whistle → result toast' },
  down: { use: 'toast', why: 'whistle → result toast' },
  firstDown: { use: 'chip', why: 'the chip flashes at the line to gain; FIRST DOWN badge on the toast' },
  score: { use: 'toast', why: 'TOUCHDOWN badge' },
  safety: { use: 'toast', why: 'SAFETY badge' },
  turnover: { use: 'toast', why: 'TURNOVER badge (defense slab)' },
  fumble: { use: 'toast', why: 'FUMBLE headline' },
  kick: { use: 'lower', why: 'lower third shows the kicker until a return starts' },
  fairCatch: { use: 'toast', why: 'FAIR CATCH result' },
  touchback: { use: 'toast', why: 'TOUCHBACK result' },
  kickGood: { use: 'toast', why: 'GOOD badge' },
  kickMiss: { use: 'toast', why: 'NO GOOD badge' },
  flag: { use: 'toast', why: 'FLAG badge' },
}

export const ENGAGEMENT_GRAPHICS: Record<EngageKind, GraphicRole> = {
  block: { use: 'ignore', why: 'every snap has blocks; only doubles are news' },
  double: { use: 'callout', callout: 'doubleTeam' },
  chip: { use: 'ignore', why: 'brief; the telestrator replay (B6b) draws chips' },
  missedTackle: { use: 'ignore', why: 'covered by the brokenTackle event (BROKEN TACKLE callout)' },
  tackle: { use: 'ignore', why: 'the whistle / result toast covers it' },
}

/** At most this many callouts on screen at once. */
export const MAX_CALLOUTS = 2
/** Callout priorities (higher wins). */
export const CALLOUT_PRIORITY: Record<CalloutKind, number> = { brokenTackle: 5, separation: 4, timeToThrow: 3, doubleTeam: 2 }
/** Shortest window worth showing (seconds) after trimming. */
export const MIN_CALLOUT = 0.6
/** Fades (seconds). */
export const FADE_IN = 0.18
export const FADE_OUT = 0.24
/** Wipe-in length (seconds; 0 under reduced motion). */
export const WIPE = 0.38

const TERMINAL = new Set<AnimEventKind>(['tackle', 'sack', 'outOfBounds', 'down', 'score', 'incomplete', 'safety', 'kickGood', 'kickMiss', 'touchback', 'fairCatch'])

// ── helpers ──────────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const r1 = (v: number) => Math.round(v * 10) / 10
export const ordinal = (n: number) => (n === 1 ? '1ST' : n === 2 ? '2ND' : n === 3 ? '3RD' : `${n}TH`)
const MINUS = '−'
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `${MINUS}${-n}` : '0')

/** "ATL 38" for a spot measured from the offense's own goal line (0–100). */
export function spotText(yard: number, offense: ClubLike, defense: ClubLike): string {
  const y = Math.round(yard)
  if (y === 50) return '50'
  return y < 50 ? `${offense.abbr} ${Math.max(1, y)}` : `${defense.abbr} ${Math.max(1, 100 - y)}`
}

/** Small deterministic hash in [0, 1) (no rng). */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

function personOf(input: GraphicsInput, key: string): PersonInfo & { role: string; side: 'off' | 'def' } {
  const a = input.anim.actors.find((x) => x.key === key)
  const p = input.people?.[key]
  return { name: p?.name ?? (a?.role ?? key).toUpperCase(), number: p?.number, pos: p?.pos ?? a?.role ?? '', role: a?.role ?? key, side: a?.side ?? 'off' }
}

/** "#77" or the role when the number is unknown. */
function tag(input: GraphicsInput, key: string): string {
  const p = personOf(input, key)
  return p.number != null ? `#${p.number}` : p.role.toUpperCase()
}

/** "D. HOLLOWAY" from "Darius Holloway". */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2) return name.toUpperCase()
  const last = parts.slice(1).join(' ')
  return `${parts[0][0]}. ${last}`.toUpperCase()
}

/** The defender nearest to `key` at play time t. */
function nearestDefender(anim: BroadcastAnim, key: string, t: number): { key: string; d: number } | null {
  const A = anim.actors.find((x) => x.key === key)
  if (!A) return null
  const p = posAt(A.path, t)
  let best: { key: string; d: number } | null = null
  for (const a of anim.actors) {
    if (a.side === A.side || a.key === key) continue
    const q = posAt(a.path, t)
    const d = Math.hypot(p.x - q.x, p.y - q.y)
    if (!best || d < best.d || (d === best.d && a.key < best.key)) best = { key: a.key, d }
  }
  return best
}

function fgDistance(play: Play): number {
  const m = /(\d+)-y(?:ar)?d/i.exec(`${play.result} ${play.concept}`)
  return m ? Number(m[1]) : Math.round(100 - play.startYard + 17)
}

// ── timeline ─────────────────────────────────────────────────────────────────

/** Build the whole graphics timeline for one play. Pure and deterministic. */
export function buildGraphicsTimeline(input: GraphicsInput): GraphicsTimeline {
  const { anim, play, offense, defense } = input
  const D = Math.max(0.05, (anim.duration || 0) / 1000)
  const preSnap = Math.max(0, input.preSnap ?? 2.4)
  const post = Math.max(0.5, input.post ?? 2.6)
  const S = (t: number) => clamp(t, 0, 1) * D
  const events = anim.events ?? []
  const engs = anim.engagements ?? []
  const first = (k: AnimEventKind) => events.find((e) => e.kind === k)
  const has = (k: AnimEventKind) => events.some((e) => e.kind === k)
  const snapEv = first('snap')
  const snapSec = snapEv ? S(snapEv.t) : 0
  let whistleT = -1
  for (const e of events) if (TERMINAL.has(e.kind)) whistleT = Math.max(whistleT, e.t)
  const whistleSec = whistleT >= 0 ? S(whistleT) : D
  const end = D + post
  const scrimmage = play.type === 'run' || play.type === 'pass'
  const throwEv = first('throw')
  const catchEv = play.type === 'pass' ? first('catch') : undefined
  const intEv = first('interception')
  // A kick changes possession by design: only a lost fumble / muff is a turnover there.
  const kickPlay = play.type === 'punt' || play.type === 'kickoff'
  const turnover = kickPlay ? has('turnover') || !!play.defTD : !!play.turnover || has('turnover') || !!intEv || !!play.defTD
  const ttt = throwEv && snapEv ? S(throwEv.t) - snapSec : null
  let sep: { value: number; def: string } | null = null
  if (catchEv && catchEv.keys[0]) {
    const nd = nearestDefender(anim, catchEv.keys[0], catchEv.t)
    if (nd) sep = { value: r1(nd.d), def: nd.key }
  }

  // ── chip ──
  let down: string
  if (play.down != null && play.distance != null && (scrimmage || play.type === 'punt' || play.type === 'fg' || play.type === 'penalty')) {
    const goal = play.startYard + play.distance >= 100
    down = `${ordinal(play.down)} & ${goal ? 'GOAL' : play.distance}`
  } else if (play.type === 'kickoff') down = 'KICKOFF'
  else if (play.type === 'pat') down = play.concept === 'Two-point try' ? '2-PT TRY' : 'PAT'
  else if (play.type === 'fg') down = 'FIELD GOAL'
  else if (play.type === 'punt') down = 'PUNT'
  else down = play.type.toUpperCase()
  const fdEv = first('firstDown')
  const chip: ChipItem = {
    t0: -preSnap,
    t1: end,
    down,
    spot: play.type === 'kickoff' ? '' : spotText(play.startYard, offense, defense),
    // No concept line on penalty snaps (it names the foul before it happens).
    concept: play.type !== 'penalty' && play.concept && play.concept.toUpperCase() !== down ? play.concept.toUpperCase() : null,
    firstDownAt: fdEv ? S(fdEv.t) : null,
  }

  // ── play clock ──
  const clock: ClockItem | null = snapEv
    ? { t0: -preSnap, t1: snapSec, atSnap: Math.round(clamp(input.playClockAtSnap ?? 2 + Math.floor(hash01(play.n * 7 + play.qtr) * 13), 0, 40)) }
    : null

  // ── toast ──
  const toast = buildToast(input, { D, whistleSec, end, snapSec, ttt, sep, turnover })

  // ── lower third ──
  const lower = buildLower(input, { D, snapSec, whistleSec, toastT0: toast.t0, catchEv, intEv, sep })

  // ── callouts ──
  const cands: Callout[] = []
  const lastSec = Math.min(end, whistleSec + 0.9)
  // Double team: the first defender with two blockers on him at once.
  const byDef = new Map<string, { a: string; t0: number; t1: number }[]>()
  for (const e of engs) {
    if (e.kind !== 'double') continue
    const l = byDef.get(e.b) ?? []
    l.push({ a: e.a, t0: e.t0, t1: e.t1 })
    byDef.set(e.b, l)
  }
  let dbl: { def: string; blockers: string[]; t0: number; t1: number } | null = null
  for (const [def, l] of [...byDef.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    if (l.length < 2) continue
    const s = [...l].sort((x, y) => x.t0 - y.t0 || (x.a < y.a ? -1 : 1))
    const t0 = Math.max(s[0].t0, s[1].t0)
    const t1 = Math.min(s[0].t1, s[1].t1)
    if (S(t1) - S(t0) < 0.35) continue
    if (!dbl || t0 < dbl.t0) dbl = { def, blockers: [s[0].a, s[1].a], t0, t1 }
  }
  if (dbl) {
    const a = S(dbl.t0)
    cands.push({
      id: `doubleTeam:${dbl.def}`,
      kind: 'doubleTeam',
      anchor: dbl.def,
      t0: a,
      t1: Math.min(a + 1.8, S(dbl.t1) + 0.3),
      priority: CALLOUT_PRIORITY.doubleTeam,
      title: 'DOUBLE TEAM',
      sub: `${tag(input, dbl.blockers[0])} + ${tag(input, dbl.blockers[1])} ON ${tag(input, dbl.def)}`,
      accent: 'def',
      others: dbl.blockers,
    })
  }
  if (throwEv && ttt != null && throwEv.keys[0]) {
    const a = S(throwEv.t)
    const pressure = play.pressure || play.pressureType === 'hit' || play.pressureType === 'hurry'
    cands.push({
      id: `timeToThrow:${throwEv.keys[0]}`,
      kind: 'timeToThrow',
      anchor: throwEv.keys[0],
      t0: Math.max(snapSec, a - 0.05),
      t1: a + 1.4,
      priority: CALLOUT_PRIORITY.timeToThrow,
      title: `TIME TO THROW ${ttt.toFixed(1)}S`,
      sub: `${pressure ? 'UNDER PRESSURE' : 'CLEAN POCKET'}${play.blitz ? ' · BLITZ' : ''}`,
      accent: 'off',
      value: r1(ttt),
      others: throwEv.keys[1] ? [throwEv.keys[1]] : [],
    })
  }
  if (catchEv && sep && catchEv.keys[0]) {
    const a = S(catchEv.t)
    cands.push({
      id: `separation:${catchEv.keys[0]}`,
      kind: 'separation',
      anchor: catchEv.keys[0],
      t0: Math.max(0, a - 0.1),
      t1: a + 1.5,
      priority: CALLOUT_PRIORITY.separation,
      title: `SEPARATION ${sep.value.toFixed(1)} YD`,
      sub: `${tag(input, catchEv.keys[0])} VS ${tag(input, sep.def)} AT THE CATCH`,
      accent: 'gold',
      value: sep.value,
      others: [sep.def],
    })
  }
  const bts = events.filter((e) => e.kind === 'brokenTackle' && e.keys[0])
  for (let i = 0; i < bts.length; i++) {
    const e = bts[i]
    const a = S(e.t)
    // A second broken tackle by the same man ends the first callout.
    const next = bts.slice(i + 1).find((x) => x.keys[0] === e.keys[0])
    const missed = e.keys[1]
    cands.push({
      id: `brokenTackle:${e.keys[0]}:${i}`,
      kind: 'brokenTackle',
      anchor: e.keys[0],
      t0: a,
      t1: Math.min(a + 1.3, next ? S(next.t) : Infinity),
      priority: CALLOUT_PRIORITY.brokenTackle,
      title: 'BROKEN TACKLE',
      sub: missed ? `${tag(input, missed)} MISSES` : tag(input, e.keys[0]),
      accent: 'off',
      others: missed ? [missed] : [],
    })
  }
  const early: DroppedCallout[] = []
  const usable: Callout[] = []
  for (const c of cands) {
    c.t1 = Math.min(c.t1, lastSec)
    if (c.t1 - c.t0 >= MIN_CALLOUT) usable.push(c)
    else early.push({ kind: c.kind, anchor: c.anchor, t0: c.t0, t1: c.t1, reason: 'window shorter than MIN_CALLOUT after the whistle clamp' })
  }
  const { kept, dropped } = resolveCallouts(usable)
  return {
    duration: D,
    preSnap,
    post,
    start: -preSnap,
    end,
    snapSec,
    whistleSec,
    chip,
    clock,
    lower,
    toast,
    callouts: kept,
    dropped: [...early, ...dropped],
    offense,
    defense,
  }
}

/**
 * Cap callouts: walk them by priority (then start, then id); each keeps the
 * earliest stretch of its window (≥ MIN_CALLOUT) where fewer than MAX_CALLOUTS
 * accepted callouts show and none shares its anchor. Deterministic.
 */
export function resolveCallouts(cands: Callout[]): { kept: Callout[]; dropped: DroppedCallout[] } {
  const order = [...cands].sort((a, b) => b.priority - a.priority || a.t0 - b.t0 || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const kept: Callout[] = []
  const dropped: DroppedCallout[] = []
  for (const c of order) {
    const cuts = new Set<number>([c.t0, c.t1])
    for (const k of kept) {
      if (k.t0 > c.t0 && k.t0 < c.t1) cuts.add(k.t0)
      if (k.t1 > c.t0 && k.t1 < c.t1) cuts.add(k.t1)
    }
    const pts = [...cuts].sort((a, b) => a - b)
    let runStart: number | null = null
    let best: [number, number] | null = null
    for (let i = 0; i < pts.length - 1 && !best; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const mid = (a + b) / 2
      const live = kept.filter((k) => k.t0 <= mid && mid < k.t1)
      const free = live.length < MAX_CALLOUTS && !live.some((k) => k.anchor === c.anchor)
      if (free && runStart == null) runStart = a
      const runEnd = free ? (i === pts.length - 2 ? b : null) : a
      if (runStart != null && runEnd != null) {
        if (runEnd - runStart >= MIN_CALLOUT) best = [runStart, runEnd]
        runStart = null
      }
    }
    if (best) kept.push({ ...c, t0: best[0], t1: best[1] })
    else dropped.push({ kind: c.kind, anchor: c.anchor, t0: c.t0, t1: c.t1, reason: `no ${MIN_CALLOUT}s stretch with fewer than ${MAX_CALLOUTS} callouts / a free anchor` })
  }
  kept.sort((a, b) => a.t0 - b.t0 || (a.id < b.id ? -1 : 1))
  return { kept, dropped }
}

interface Ctx {
  D: number
  whistleSec: number
  end: number
  snapSec: number
  ttt: number | null
  sep: { value: number; def: string } | null
  turnover: boolean
}

function buildToast(input: GraphicsInput, c: Ctx): ToastItem {
  const { anim, play } = input
  const events = anim.events ?? []
  const has = (k: AnimEventKind) => events.some((e) => e.kind === k)
  const first = (k: AnimEventKind) => events.find((e) => e.kind === k)
  const res = play.result ?? ''
  const sackPlay = play.type === 'pass' && (res.startsWith('Sack') || has('sack'))
  const inc = play.type === 'pass' && (res === 'Incomplete' || has('incomplete'))
  const int = has('interception') || res.startsWith('Interception')
  const td = has('score') || res.startsWith('TOUCHDOWN') || !!play.returnTD || !!play.defTD
  const safety = has('safety') || !!play.safety
  const fumble = has('fumble') && c.turnover
  const fd = has('firstDown') && !c.turnover && !td
  const stats: ToastStat[] = []
  let big = signed(play.yards ?? 0)
  let head = ''
  const S = (t: number) => clamp(t, 0, 1) * c.D
  if (play.type === 'pass') {
    if (sackPlay) {
      head = 'SACK'
      const sk = first('sack')
      if (sk && c.snapSec >= 0) stats.push({ value: `${(S(sk.t) - c.snapSec).toFixed(1)} S`, label: 'TIME IN POCKET' })
    } else if (int) {
      head = 'INTERCEPTED'
      big = 'INT'
      if (c.ttt != null) stats.push({ value: `${c.ttt.toFixed(1)} S`, label: 'TIME TO THROW' })
      if (play.passDepth != null) stats.push({ value: `${Math.round(play.passDepth)}`, label: 'AIR YDS' })
    } else if (inc) {
      head = 'INCOMPLETE'
      big = 'INC'
      if (c.ttt != null) stats.push({ value: `${c.ttt.toFixed(1)} S`, label: 'TIME TO THROW' })
      if (play.passDepth != null) stats.push({ value: `${Math.round(play.passDepth)}`, label: 'AIR YDS' })
    } else {
      head = 'COMPLETE'
      if (c.sep) stats.push({ value: `${c.sep.value.toFixed(1)} YD`, label: 'SEP. AT CATCH' })
      if (c.ttt != null) stats.push({ value: `${c.ttt.toFixed(1)} S`, label: 'TIME TO THROW' })
      if (play.passDepth != null) {
        const air = Math.round(play.passDepth)
        stats.push({ value: `${air}`, label: 'AIR YDS' })
        stats.push({ value: `${Math.round((play.yards ?? 0) - air)}`, label: 'YAC' })
      }
    }
  } else if (play.type === 'run') {
    head = play.concept === 'Kneel' || /kneel/i.test(res) ? 'KNEEL' : 'RUSH'
    stats.push({ value: `${play.yards ?? 0}`, label: 'YDS' })
    const contact = first('contact')
    if (contact && anim.ball.length) {
      const endX = anim.ball[anim.ball.length - 1].x
      stats.push({ value: `${Math.max(0, Math.round(endX - contact.spot.x))}`, label: 'AFTER CONTACT' })
    }
    const bt = events.filter((e) => e.kind === 'brokenTackle').length
    if (bt) stats.push({ value: `${bt}`, label: bt === 1 ? 'BROKEN TACKLE' : 'BROKEN TACKLES' })
  } else if (play.type === 'punt' || play.type === 'kickoff') {
    head = play.type === 'punt' ? 'PUNT' : 'KICKOFF'
    if (has('touchback') || play.returnKind === 'touchback') big = 'TB'
    else if (has('fairCatch') || play.returnKind === 'fairCatch') big = 'FC'
    else if (play.type === 'punt') big = `${play.yards ?? 0}`
    else if (play.returnYards != null) big = signed(Math.round(play.returnYards))
    if (play.type === 'punt' && play.yards != null) stats.push({ value: `${play.yards}`, label: 'PUNT YDS' })
    if (play.returnYards != null && big !== 'TB' && big !== 'FC') stats.push({ value: `${Math.round(play.returnYards)}`, label: 'RETURN YDS' })
  } else if (play.type === 'fg' || play.type === 'pat') {
    const two = play.concept === 'Two-point try'
    head = two ? '2-PT TRY' : play.type === 'fg' ? 'FIELD GOAL' : 'EXTRA POINT'
    const good = has('kickGood') || /good|success/i.test(res)
    big = two ? (good || td ? 'GOOD' : 'NO') : good ? 'GOOD' : 'NO'
    if (play.type === 'fg') stats.push({ value: `${fgDistance(play)}`, label: 'YDS' })
  } else if (play.type === 'penalty') {
    head = 'PENALTY'
    big = signed(play.yards ?? 0)
  } else {
    head = play.type.toUpperCase()
  }
  if (fumble && head !== 'SACK') head = 'FUMBLE'
  if (td) {
    big = 'TD'
    head = head === 'COMPLETE' || head === 'RUSH' ? 'TOUCHDOWN' : head
  }
  let badge: ToastItem['badge'] = null
  if (safety) badge = { kind: 'safety', label: 'SAFETY' }
  else if (td) badge = { kind: 'touchdown', label: 'TOUCHDOWN' }
  else if (c.turnover) badge = { kind: 'turnover', label: 'TURNOVER' }
  else if (has('kickGood')) badge = { kind: 'good', label: 'GOOD' }
  else if (has('kickMiss')) badge = { kind: 'noGood', label: 'NO GOOD' }
  else if (fd) badge = { kind: 'firstDown', label: 'FIRST DOWN' }
  else if (has('flag') || play.type === 'penalty') badge = { kind: 'flag', label: 'FLAG' }
  if (badge && badge.label === head) badge = null
  const side: 'off' | 'def' = c.turnover || play.defTD || safety ? 'def' : 'off'
  // Tidy the play text: em dashes → middots, upper case.
  const sub = toastLine(input, { sackPlay, inc, int, td }) ?? res.replace(/\s*[—–]\s*/g, ' · ').replace(/!+/g, '').toUpperCase()
  const t0 = Math.min(c.D, c.whistleSec + 0.3)
  return { t0, t1: c.end, side, big, head, badge, sub, stats: stats.slice(0, 4) }
}

/** "#12 D. LONDON" (or the name / role when the number is unknown). */
function who(input: GraphicsInput, key: string): string {
  const p = personOf(input, key)
  const n = input.people?.[key] ? shortName(p.name) : p.role.toUpperCase()
  return p.number != null ? `#${p.number} ${n}` : n
}

/** The toast's play line from the animation keys and the Play (null: use the play text). */
function toastLine(input: GraphicsInput, f: { sackPlay: boolean; inc: boolean; int: boolean; td: boolean }): string | null {
  const { anim, play, offense, defense } = input
  const ev = (k: AnimEventKind) => (anim.events ?? []).find((e) => e.kind === k)
  const yds = play.yards ?? 0
  const to = f.td ? '' : ` · TO ${spotText(Math.max(0, Math.min(100, play.startYard + yds)), offense, defense)}`
  if (play.type === 'pass') {
    if (f.sackPlay) {
      const k = ev('sack')?.keys[0]
      return k ? `SACKED BY ${who(input, k)}${to}` : null
    }
    if (f.int) {
      const k = ev('interception')?.keys[0]
      return k ? `PICKED OFF BY ${who(input, k)}` : null
    }
    if (f.inc) {
      const k = ev('throw')?.keys[1]
      return k ? `INTENDED FOR ${who(input, k)}` : null
    }
    const k = ev('catch')?.keys[0]
    return k ? `${who(input, k)} ${yds}-YD CATCH${to}` : null
  }
  if (play.type === 'run' && !play.turnover) {
    const k = holderAt(anim.holders, 1)
    return k ? `${who(input, k)} ${yds}-YD RUN${to}` : null
  }
  return null
}

interface LowerCtx {
  D: number
  snapSec: number
  whistleSec: number
  toastT0: number
  catchEv: { t: number; keys: string[] } | undefined
  intEv: { t: number; keys: string[] } | undefined
  sep: { value: number; def: string } | null
}

function buildLower(input: GraphicsInput, c: LowerCtx): LowerThirdItem | null {
  const { anim, play, offense, defense } = input
  const events = anim.events ?? []
  const S = (t: number) => clamp(t, 0, 1) * c.D
  const first = (k: AnimEventKind) => events.find((e) => e.kind === k)
  const at = (yard: number) => spotText(yard, offense, defense)
  // Offense-frame x (own goal line at 10) → yard line from the offense's goal.
  const yardOf = (x: number) => clamp(x - 10, 0, 100)
  let key: string | null = null
  let t0 = 0
  let stat = ''
  const concept = (play.concept ?? '').toUpperCase()
  if (c.intEv?.keys[0]) {
    key = c.intEv.keys[0]
    t0 = S(c.intEv.t) + 0.4
    stat = 'INTERCEPTION'
  } else if (play.type === 'pass' && c.catchEv?.keys[0]) {
    key = c.catchEv.keys[0]
    t0 = S(c.catchEv.t) + 0.45
    const spot = anim.events?.find((e) => e.kind === 'catch')?.spot
    stat = `CATCH AT ${spot ? at(yardOf(spot.x)) : at(play.startYard)}${play.passDepth != null ? ` · ${Math.round(play.passDepth)} AIR YDS` : ''}`
  } else if (play.type === 'run') {
    // The runner: whoever holds the ball at the whistle (handoffs pass through the QB).
    const h = holderAt(anim.holders, Math.max(0, (c.whistleSec - 0.01) / c.D))
    if (h) {
      const got = anim.holders.find((x) => x.key === h)
      key = h
      t0 = Math.max(c.snapSec + 0.4, S(got?.t ?? 0) + 0.4)
      stat = `${concept || 'RUN'} · FROM ${at(play.startYard)}`
    }
  } else if (play.type === 'punt' || play.type === 'kickoff') {
    const ret = first('catch')
    if (ret?.keys[0]) {
      key = ret.keys[0]
      t0 = S(ret.t) + 0.4
      stat = `RETURN FROM ${at(yardOf(ret.spot.x))}`
    } else {
      const k = first('kick')
      // The kick key is a slot; name it only when the roster says it is the punter / kicker.
      if (k?.keys[0] && /^(P|K)$/.test(input.people?.[k.keys[0]]?.pos ?? '')) {
        key = k.keys[0]
        t0 = S(k.t) + 0.3
        stat = play.type === 'punt' ? 'PUNT' : 'KICKOFF'
      }
    }
  } else if (play.type === 'fg' || play.type === 'pat') {
    const k = first('kick')
    if (k?.keys[0] && /^(P|K)$/.test(input.people?.[k.keys[0]]?.pos ?? '')) {
      key = k.keys[0]
      t0 = Math.max(0, S(k.t) - 0.2)
      stat = play.type === 'fg' ? `${fgDistance(play)}-YD ATTEMPT` : concept || 'EXTRA POINT'
    }
  }
  // Passer fallback (sacks, incompletions): from just after the snap.
  if (!key && play.type === 'pass' && anim.actors.some((a) => a.key === 'qb')) {
    key = 'qb'
    t0 = c.snapSec + 0.5
    stat = `${concept}${play.blitz ? ' · VS BLITZ' : ''}`.replace(/^ · /, '') || 'DROPBACK'
  }
  if (!key) return null
  const t1 = c.toastT0
  if (t1 - t0 < 0.9) return null
  const p = personOf(input, key)
  return {
    t0,
    t1,
    key,
    side: p.side,
    name: input.people?.[key] ? shortName(p.name) : p.name,
    number: p.number ?? null,
    pos: (p.pos || p.role).toUpperCase(),
    stat,
  }
}

// ── per frame ────────────────────────────────────────────────────────────────

/** Fade in over FADE_IN from t0, out over FADE_OUT to t1. 0 outside [t0, t1]. */
export function windowAlpha(sec: number, t0: number, t1: number, fadeIn = FADE_IN, fadeOut = FADE_OUT): number {
  if (sec < t0 || sec > t1) return 0
  const span = t1 - t0
  const fi = Math.min(fadeIn, span / 2)
  const fo = Math.min(fadeOut, span / 2)
  const a = fi > 0 ? clamp((sec - t0) / fi, 0, 1) : 1
  const b = fo > 0 ? clamp((t1 - sec) / fo, 0, 1) : 1
  return Math.min(a, b)
}

const easeOut = (u: number) => 1 - Math.pow(1 - clamp(u, 0, 1), 3)

/** What shows at graphics second `sec`. Pure: the same (timeline, sec, options) always gives the same frame. */
export function graphicsAt(tl: GraphicsTimeline, sec: number, opts: GraphicsOptions = {}): GraphicsFrame {
  const mode = opts.mode ?? 'full'
  const rm = !!opts.reducedMotion
  const t = clamp(sec / tl.duration, 0, 1)
  const out: GraphicsFrame = { sec, t, chip: null, clock: null, lower: null, toast: null, callouts: [] }
  if (mode === 'off') return out
  const enter = (t0: number) => (rm ? 1 : easeOut((sec - t0) / WIPE))
  const ch = tl.chip
  const ca = windowAlpha(sec, ch.t0, ch.t1, rm ? 0.12 : FADE_IN)
  if (ca > 0) {
    let flash = 0
    if (!rm && ch.firstDownAt != null && sec >= ch.firstDownAt) flash = clamp(1 - (sec - ch.firstDownAt) / 0.8, 0, 1)
    out.chip = { item: ch, alpha: ca, enter: mode === 'fast' ? 1 : enter(ch.t0), flash, preSnap: clamp((tl.snapSec - sec) / 0.25, 0, 1) }
  }
  if (mode === 'fast') return out
  const ck = tl.clock
  if (ck && sec >= ck.t0 && sec <= ck.t1 + 0.3) {
    const value = Math.max(0, Math.ceil(ck.atSnap + (ck.t1 - sec) - 1e-9))
    const alpha = sec <= ck.t1 ? windowAlpha(sec, ck.t0, ck.t1 + 1, 0.12, 0) : clamp(1 - (sec - ck.t1) / 0.3, 0, 1)
    if (alpha > 0) out.clock = { item: ck, alpha, enter: 1, value: sec <= ck.t1 ? value : ck.atSnap, urgent: value <= 5 }
  }
  const lo = tl.lower
  if (lo) {
    const a = windowAlpha(sec, lo.t0, lo.t1, FADE_IN, 0.16)
    if (a > 0) out.lower = { item: lo, alpha: a, enter: enter(lo.t0) }
  }
  const to = tl.toast
  const ta = windowAlpha(sec, to.t0, to.t1, FADE_IN, 0.3)
  if (ta > 0) out.toast = { item: to, alpha: ta, enter: enter(to.t0) }
  for (const c of tl.callouts) {
    const a = windowAlpha(sec, c.t0, c.t1)
    if (a > 0) out.callouts.push({ item: c, alpha: a, enter: enter(c.t0) })
  }
  return out
}

/** Graphics second for a play time t (0..1). */
export function secOf(tl: GraphicsTimeline, t: number): number {
  return clamp(t, 0, 1) * tl.duration
}

// ── callout layout (pure) ────────────────────────────────────────────────────

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Circle {
  x: number
  y: number
  r: number
}

export type CalloutSide = 'ur' | 'ul' | 'r' | 'l' | 'dr' | 'dl'
const SIDES: CalloutSide[] = ['ur', 'ul', 'r', 'l', 'dr', 'dl']

export interface CalloutRequest {
  id: string
  /** Anchor head point (canvas px). */
  ax: number
  ay: number
  /** Box size (canvas px). */
  w: number
  h: number
}

export interface PlacedCallout extends CalloutRequest {
  box: Rect
  side: CalloutSide
  /** Where the leader line meets the box. */
  jx: number
  jy: number
}

export interface LayoutEnv {
  width: number
  height: number
  /** Edge margin (canvas px). */
  margin: number
  /** Leader length (canvas px). */
  lead: number
  /** Never covered: the ball carrier's head (and every anchor's own head). */
  avoid: Circle[]
  /** HUD rects the boxes stay off (chip, lower third, toast). */
  reserved: Rect[]
  /** Last frame's side per id (keeps boxes from flipping). */
  prev?: Map<string, CalloutSide>
}

export function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad
}

export function rectHitsCircle(r: Rect, c: Circle): boolean {
  const nx = clamp(c.x, r.x, r.x + r.w)
  const ny = clamp(c.y, r.y, r.y + r.h)
  return (c.x - nx) ** 2 + (c.y - ny) ** 2 < c.r * c.r
}

function boxFor(req: CalloutRequest, side: CalloutSide, lead: number): { box: Rect; jx: number; jy: number } {
  const { ax, ay, w, h } = req
  switch (side) {
    case 'ur':
      return { box: { x: ax + lead * 0.6, y: ay - lead - h, w, h }, jx: ax + lead * 0.6, jy: ay - lead }
    case 'ul':
      return { box: { x: ax - lead * 0.6 - w, y: ay - lead - h, w, h }, jx: ax - lead * 0.6, jy: ay - lead }
    case 'r':
      return { box: { x: ax + lead * 1.2, y: ay - h * 1.15, w, h }, jx: ax + lead * 1.2, jy: ay - h * 0.15 }
    case 'l':
      return { box: { x: ax - lead * 1.2 - w, y: ay - h * 1.15, w, h }, jx: ax - lead * 1.2, jy: ay - h * 0.15 }
    case 'dr':
      return { box: { x: ax + lead * 0.8, y: ay + lead * 0.9, w, h }, jx: ax + lead * 0.8, jy: ay + lead * 0.9 }
    case 'dl':
      return { box: { x: ax - lead * 0.8 - w, y: ay + lead * 0.9, w, h }, jx: ax - lead * 0.8, jy: ay + lead * 0.9 }
  }
}

/**
 * Place callout boxes (in request order = priority order). A box never covers
 * an `avoid` circle (hard rule: if no side works, the callout is skipped this
 * frame), and prefers sides that stay on screen, off the reserved rects and off
 * boxes already placed; the previous frame's side wins ties.
 */
export function layoutCallouts(reqs: CalloutRequest[], env: LayoutEnv): PlacedCallout[] {
  const out: PlacedCallout[] = []
  for (const req of reqs) {
    const prev = env.prev?.get(req.id)
    const sides = prev ? [prev, ...SIDES.filter((s) => s !== prev)] : SIDES
    let best: { p: PlacedCallout; cost: number } | null = null
    for (const side of sides) {
      const { box, jx, jy } = boxFor(req, side, env.lead)
      if (env.avoid.some((c) => rectHitsCircle(box, c))) continue
      let cost = 0
      const m = env.margin
      if (box.x < m || box.y < m || box.x + box.w > env.width - m || box.y + box.h > env.height - m) cost += 4
      for (const r of env.reserved) if (rectsOverlap(box, r, 4)) cost += 3
      for (const o of out) if (rectsOverlap(box, o.box, 4)) cost += 6
      if (side !== prev && prev) cost += 0.5
      if (!best || cost < best.cost) best = { p: { ...req, box, side, jx, jy }, cost }
      if (cost === 0) break
    }
    if (!best) continue
    // Never stack on another callout: skip this one for the frame instead.
    if (out.some((o) => rectsOverlap(best.p.box, o.box, 0))) continue
    out.push(best.p)
  }
  return out
}

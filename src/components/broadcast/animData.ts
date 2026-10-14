// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D presentation data (B1 / job b1b).
//
// Derived AFTER the play animation is finished: pose windows, facing windows,
// the ball's height in yards and a camera hint, for every actor of every play
// type. It only READS the finished PlayAnim (paths, holders, flights, flag,
// posts, duration, actor roles/sides) plus the recorded Play — it never mutates
// and never changes an existing field. Pure and deterministic (no rng).
//
// This module deliberately uses only TYPE imports from ../playAnim, so the
// runtime dependency is one-way (playAnim -> animData). posAt/holderAt are
// copied locally to avoid a value import.
// ─────────────────────────────────────────────────────────────────────────────

import type { PlayAnim, AnimContext, Actor } from '../playAnim'
import type { Play } from '../../game/engine/playsim'
import { carrierMove, effRating, tackleStyle, tiredness, type CarrierMove } from '../animRatings'
import { applyReadPresentation } from './qbReads'

// Geometry constant (copied: no value import from playAnim.ts).
const MID_Y = 26.65

interface Pt { x: number; y: number }
interface WP { t: number; x: number; y: number }

// ── b1a data, read structurally under local names (b1a owns the real ones) ───
type InEngageKind = 'block' | 'double' | 'chip' | 'missedTackle' | 'tackle'
interface InEngagement { a: string; b: string; t0: number; t1: number; kind: InEngageKind }
type InAnimEventKind =
  | 'snap' | 'playAction' | 'scramble' | 'break' | 'throw' | 'catch' | 'incomplete'
  | 'interception' | 'brokenTackle' | 'contact' | 'tackle' | 'sack' | 'outOfBounds'
  | 'down' | 'firstDown' | 'score' | 'safety' | 'turnover' | 'fumble' | 'kick'
  | 'fairCatch' | 'touchback' | 'kickGood' | 'kickMiss' | 'flag'
interface InEvent { t: number; kind: InAnimEventKind; keys: string[]; spot: Pt }
interface InShed { def: string; blk: string[]; t0: number; t1: number; move: 'speed' | 'bull' | 'swim' | 'spin' | 'rip' }
interface InB1aInput { engagements?: InEngagement[]; events?: InEvent[]; sheds?: InShed[] }

// ── public shapes (the renderer, B3/B4/B5, consumes these) ───────────────────
export type PoseState =
  | 'catchHigh' | 'catchLow' | 'catchReach' | 'catchBack' | 'swat' // read visuals (readPoses.ts)
  | 'stance3' | 'stance2' | 'stand' | 'run' | 'pedal' | 'block' | 'fake' | 'throw'
  | 'catch' | 'carry' | 'stumble' | 'dive' | 'fall' | 'down' | 'kick' | 'hold' | 'tackle'
  | 'set' | 'throwQuick' | 'throwDeep' | 'throwRun' | 'throwHurry'
  | 'juke' | 'spin' | 'stiffArm' | 'truck' | 'tackleHit' | 'tackleArm' | 'hips'
  | 'rip' | 'swim' | 'bull' | 'spinRush' | 'pushOut' | 'tackleFall' | 'lunge'

/**
 * animflow round 3: how the quarterback throws. playAnim picks it (it knows the
 * concept, the depth, whether he is on the move and how close the rush is) and
 * records it on the PlayAnim; the pose library times the motion from it.
 *   normal  dropback: set, wind-up to the ear, over the top, step, follow-through
 *   quick   quick game / screens: short three-quarter flick
 *   deep    longer wind-up, a higher release
 *   run     on the move (boot / scramble): shoulders turned, no plant
 *   hurry   a rusher on him: short arm, weight back (fade)
 */
export type ThrowStyle = 'normal' | 'quick' | 'deep' | 'run' | 'hurry'
/** Seconds of wind-up before the release frame and of follow-through after it. */
export const THROW_TIMING: Record<ThrowStyle, { wind: number; follow: number }> = {
  normal: { wind: 0.26, follow: 0.32 },
  quick: { wind: 0.18, follow: 0.26 },
  deep: { wind: 0.32, follow: 0.36 },
  run: { wind: 0.2, follow: 0.28 },
  hurry: { wind: 0.15, follow: 0.22 },
}
export const THROW_STATE: Record<ThrowStyle, PoseState> = {
  normal: 'throw',
  quick: 'throwQuick',
  deep: 'throwDeep',
  run: 'throwRun',
  hurry: 'throwHurry',
}
/**
 * The ball's offset along the throw (yd, + toward the target) and height (yd)
 * in the passer's hand `toRel` seconds before the release (negative = after).
 * Matches the figure's throwing hand: carried at the chest, back to the ear
 * through the wind-up, then over the top to the release point.
 */
export function throwHand(style: ThrowStyle, toRel: number): { off: number; z: number } {
  const { wind } = THROW_TIMING[style]
  const a = wind - toRel // age in the throw window
  if (a <= 0) return { off: 0, z: 1.2 }
  const cock = smooth01(a / (wind * 0.75))
  const over = smooth01((a - (wind - 0.07)) / 0.13)
  const back = style === 'quick' ? -0.18 : style === 'hurry' ? -0.22 : -0.28
  const top = style === 'deep' ? 2.2 : style === 'quick' ? 1.75 : style === 'hurry' ? 1.82 : style === 'run' ? 1.97 : 2.1
  return { off: back * cock + (0.4 - back) * over * cock, z: 1.2 + (1.95 - 1.2) * cock + (top - 1.95) * over }
}
const smooth01 = (u: number) => { const v = u < 0 ? 0 : u > 1 ? 1 : u; return v * v * (3 - 2 * v) }

export interface PoseWindow { t0: number; t1: number; state: PoseState }

/**
 * Facing: radians in the offense frame, atan2(dy, dx), 0 = toward x = 120.
 * 'move' = face the direction of travel (held while standing).
 */
export type FacingWindow = { t0: number; t1: number } & (
  | { mode: 'move' }
  | { mode: 'angle'; angle: number }
  | { mode: 'actor'; key: string }
  | { mode: 'backpedal' }
  // animflow r6b: a spin move — one full turn over the window, on top of the run direction.
  | { mode: 'spin'; dir: 1 | -1; s0: number; s1: number }
)

/** The ball's height above the turf, in yards. */
export interface BallZKey { t: number; z: number }

export interface CameraHint {
  strongSide: 'low' | 'high'
  deep: boolean
  focusKey: string | null
  kind: 'scrimmage' | 'kickoff' | 'punt' | 'kick' | 'penalty' | 'static'
}

export interface AnimPresentation {
  poses: Record<string, PoseWindow[]>
  facing: Record<string, FacingWindow[]>
  ballZ: BallZKey[]
  camera: CameraHint
  /** animflow r6b: the broken-tackle moves and tackle styles drawn (checks / probes). */
  skill?: { moves: { key: string; move: CarrierMove; t: number; missed: string | null }[]; tackles: Record<string, string> }
  /**
   * animflow r8 (item c): a scorer still at speed when the play ends (a return touchdown ends on the
   * goal line - the probe's exact spot) carries on into the end zone after the whistle: his speed
   * (yd/s) and heading (offense frame, unit) at the end. The renderer runs it out during the hold.
   */
  runOn?: { key: string; v: number; hx: number; hy: number }
}

export type BroadcastAnim = PlayAnim & AnimPresentation

// ── small maths helpers ──────────────────────────────────────────────────────
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const clampN = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const RUN_SPEED = 0.6

/** Position along a keyframed path (local copy of playAnim.posAt). */
function posAt(path: WP[] | undefined, t: number): Pt {
  if (!path || !path.length) return { x: MID_Y, y: MID_Y }
  if (t <= path[0].t) return { x: path[0].x, y: path[0].y }
  for (let i = 1; i < path.length; i++) {
    const b = path[i]
    if (t <= b.t) {
      const a = path[i - 1]
      const span = b.t - a.t
      const u = span <= 0 ? 1 : (t - a.t) / span
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
    }
  }
  const l = path[path.length - 1]
  return { x: l.x, y: l.y }
}

/** Who holds the ball at t (local copy of playAnim.holderAt). */
function holderAtKeys(holders: { t: number; key: string | null }[], t: number): string | null {
  let key: string | null = null
  for (const h of holders) if (t >= h.t) key = h.key
  return key
}

/**
 * Sample a path at a non-decreasing list of times in one walk (the hot path for
 * the presentation derivation: ~100 samples × 23 actors would otherwise rescan
 * the path from the start every time).
 */
function samplePath(path: WP[] | undefined, times: number[]): Pt[] {
  const out: Pt[] = new Array(times.length)
  if (!path || !path.length) {
    for (let i = 0; i < times.length; i++) out[i] = { x: MID_Y, y: MID_Y }
    return out
  }
  if (path.length === 1) {
    const p = path[0]
    for (let i = 0; i < times.length; i++) out[i] = { x: p.x, y: p.y }
    return out
  }
  const last = path[path.length - 1]
  let seg = 0
  for (let i = 0; i < times.length; i++) {
    const t = times[i]
    if (t <= path[0].t) { out[i] = { x: path[0].x, y: path[0].y }; continue }
    if (t >= last.t) { out[i] = { x: last.x, y: last.y }; continue }
    while (seg < path.length - 2 && path[seg + 1].t < t) seg++
    const a = path[seg]
    const b = path[seg + 1]
    const sp = b.t - a.t
    const u = sp <= 0 ? 1 : (t - a.t) / sp
    out[i] = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
  }
  return out
}

const norm = (a: number) => {
  if (!Number.isFinite(a)) return 0
  let x = a % (Math.PI * 2)
  if (x > Math.PI) x -= Math.PI * 2
  if (x <= -Math.PI) x += Math.PI * 2
  return x
}

// ── ball arc ─────────────────────────────────────────────────────────────────
const GRAVITY = 10.7

/** Launch speed for an arc passing (0,z0) -> (T,z1); apex flattened 20% (drag). */
function arcZ(z0: number, z1: number, T: number, s: number): number {
  if (T <= 1e-6) return z1
  const v0 = (z1 - z0) / T + (GRAVITY * T) / 2
  const raw = z0 + v0 * s - (GRAVITY * s * s) / 2
  const chord = z0 + ((z1 - z0) * s) / T
  return Math.max(0, chord + 0.8 * (raw - chord))
}

// ── field goal / PAT flight (animflow r4) ────────────────────────────────────
export type KickMiss = 'none' | 'wide' | 'short' | 'doink' | 'blocked'
const clampK = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const clampXk = (x: number) => clampK(x, 1, 119)
const clampYk = (y: number) => clampK(y, 0.5, 52.8)
/**
 * The ball of a field goal / PAT from the kick (seconds; offense frame): its
 * ground path, its height, the moment and spot it reaches the uprights' plane
 * (the kickGood / kickMiss beat) and when it is down. Pure (playAnim builds the
 * kick from it; check-broadcast asserts it).
 */
export function kickFlight(o: { los: number; kickT: number; good: boolean; blocked: boolean; kpw: number; seed: (k: number) => number }): {
  ball: WP[]; kz: { t: number; z: number }[]; resT: number; resPt: Pt; endT: number; miss: KickMiss; tc: number
} {
  const { los, kickT, good, blocked, kpw, seed } = o
  // ── the kick's flight (animflow r4) ───────────────────────────────────────
  // A real ballistic arc: the ball reaches the plane of the uprights (the end
  // line, x = 120; crossbar 10 ft, uprights 18'6" apart and 30 ft tall) and
  // carries on past the end line into the net — or wide / short / off an
  // upright on a miss. The recorded make / miss is unchanged; how a miss
  // misses is a deterministic pick (long kicks fall short more often).
  const K: Pt = { x: los - 7, y: MID_Y }
  const PLANE = 120
  const BAR = 10 / 3
  const HALF = 3.08
  const G = 10.7 // yd/s²
  const d = PLANE - K.x
  const vx = 18.5 + 0.06 * d + (kpw - 70) * 0.08
  const tc = d / vx // seconds from the kick to the plane
  const r1 = seed(5)
  const r2 = seed(7)
  const side = seed(0) < 0.5 ? -1 : 1
  const miss: KickMiss = good ? 'none' : blocked ? 'blocked' : d >= 55 && r1 < 0.45 ? 'short' : r1 > 0.85 ? 'doink' : 'wide'
  const ball: WP[] = [{ t: kickT, x: K.x, y: K.y }]
  const kz: { t: number; z: number }[] = [{ t: kickT, z: 0.15 }]
  let endT: number
  let resT: number
  let resPt: Pt
  if (miss === 'blocked') {
    // Off a rusher's hands at the line, then down behind it.
    const hitT = kickT + 0.12
    const hit = { x: los + 0.3, y: MID_Y + side * 0.6 }
    ball.push({ t: hitT, ...hit })
    kz.push({ t: hitT, z: 2.0 })
    endT = hitT + 0.7
    const land = { x: clampXk(los - 2.5 - r2 * 3), y: clampYk(MID_Y + side * (3 + r2 * 4)) }
    for (let i = 1; i <= 8; i++) {
      const u = i / 8
      ball.push({ t: hitT + 0.7 * u, x: hit.x + (land.x - hit.x) * u, y: hit.y + (land.y - hit.y) * u })
      kz.push({ t: hitT + 0.7 * u, z: Math.max(0.15, 2.0 + 1.6 * u - 3.45 * u * u) })
    }
    resT = hitT
    resPt = hit
  } else {
    // Where it crosses the plane, and how high.
    const cy = miss === 'none' ? MID_Y + side * r2 * 2.2 : miss === 'wide' ? MID_Y + side * (HALF + 0.6 + r2 * 3) : miss === 'doink' ? MID_Y + side * HALF : MID_Y + side * r2 * 2
    const cz = miss === 'short' ? BAR - 0.6 - r2 * 1.6 : miss === 'doink' ? BAR + 2 + r2 * 4 : BAR + clampK(14 - 0.2 * d, 1.0, 9) + (r2 - 0.5)
    const vz = (cz - 0.15 + 0.5 * G * tc * tc) / tc
    const zAt = (s: number) => 0.15 + vz * s - 0.5 * G * s * s
    const vy = (cy - K.y) / tc
    const at = (s: number): Pt => ({ x: K.x + vx * s, y: K.y + vy * s })
    // Flight to the plane, sampled.
    const n = Math.max(10, Math.ceil(tc / 0.06))
    for (let i = 1; i <= n; i++) {
      const s = (tc * i) / n
      ball.push({ t: kickT + s, ...at(s) })
      kz.push({ t: kickT + s, z: Math.max(0, zAt(s)) })
    }
    resT = kickT + tc
    resPt = { x: PLANE, y: cy }
    if (miss === 'doink') {
      // Off the upright: it kicks back and out and drops into the end zone.
      const out = { x: PLANE - 3 - r2 * 2, y: clampYk(cy + side * (1.5 + r2 * 1.5)) }
      const z0 = cz
      for (let i = 1; i <= 12; i++) {
        const u = i / 12
        const s = 0.75 * u
        ball.push({ t: resT + s, x: PLANE + (out.x - PLANE) * u, y: cy + (out.y - cy) * u })
        kz.push({ t: resT + s, z: Math.max(0.15, z0 + 1.2 * s - 0.5 * G * s * s * 1.6) })
      }
      endT = resT + 0.75
    } else {
      // Past the plane: on until it comes down or reaches the net (3.5 yd behind the end line).
      let s = tc
      const step = 0.05
      while (s < tc + 2.5) {
        const ns = s + step
        const p = at(ns)
        const z = zAt(ns)
        if (p.x > PLANE + 3.5 || z < (miss === "short" ? 0.15 : 1.0)) break
        s = ns
        ball.push({ t: kickT + s, ...p })
        kz.push({ t: kickT + s, z })
      }
      // Into the net (or the turf on a short one): it drops straight down.
      const last = at(s)
      const zEnd = Math.max(0.15, zAt(s))
      endT = kickT + s + 0.45
      ball.push({ t: endT, x: last.x + vx * 0.05, y: last.y })
      kz.push({ t: kickT + s + 0.2, z: Math.max(0.15, zEnd * 0.4) }, { t: endT, z: 0.15 })
    }
  }
  return { ball, kz, resT, resPt, endT, miss, tc: resT - kickT }
}

// ── the derivation ───────────────────────────────────────────────────────────
/**
 * Build the presentation for a finished animation. Returns `{ ...anim, ... }`;
 * the input is never mutated and no existing field is changed.
 */
export function presentAnim(anim: PlayAnim, play: Play, ctx: AnimContext = {}): BroadcastAnim {
  const D = Math.max(0.05, (anim.duration || 0) / 1000) // seconds of play time
  const actors: Actor[] = anim.actors ?? []
  const paths: Record<string, WP[]> = {}
  const sides: Record<string, 'off' | 'def'> = {}
  const roles: Record<string, string> = {}
  for (const a of actors) {
    paths[a.key] = a.path ?? []
    sides[a.key] = a.side
    roles[a.key] = a.role
  }
  const keys = actors.map((a) => a.key)
  const keySet: Record<string, true> = {}
  for (const k of keys) keySet[k] = true
  if (!keys.length) {
    return {
      ...anim,
      poses: {},
      facing: {},
      ballZ: [{ t: 0, z: 0.15 }, { t: 1, z: 0.15 }],
      camera: { strongSide: 'low', deep: false, focusKey: null, kind: 'static' },
    }
  }

  const SNAP_T = clamp01(0.14 / D)
  const qbKey = keySet['qb'] ? 'qb' : null

  // ── play shape ─────────────────────────────────────────────────────────────
  const type = play.type
  const concept = play.concept ?? ''
  const result = play.result ?? ''
  const inc = result === 'Incomplete'
  const int = result.startsWith('Interception')
  const sackPlay = type === 'pass' && result.startsWith('Sack')
  const twoPt = type === 'pat' && concept === 'Two-point try'
  const fgPlay = (type === 'fg' || type === 'pat') && !twoPt
  const puntPlay = type === 'punt'
  const koPlay = type === 'kickoff'
  const flight = anim.flights && anim.flights.length ? anim.flights[0] : undefined
  const kickT = flight ? flight.t0 : 0
  const throwStyle: ThrowStyle = anim.throwStyle ?? 'normal'
  const throwT = THROW_TIMING[throwStyle]

  const b1a = anim as PlayAnim & InB1aInput
  const engagements: InEngagement[] = Array.isArray(b1a.engagements) ? b1a.engagements : []
  const events: InEvent[] = Array.isArray(b1a.events) ? b1a.events : []

  // ── special-team roles ─────────────────────────────────────────────────────
  let kickerKey: string | null = null
  let fgHolderKey: string | null = null
  let returnerKey: string | null = null
  if (fgPlay) {
    kickerKey = keys.find((k) => roles[k] === 'K') ?? null
    fgHolderKey = keys.find((k) => roles[k] === 'H') ?? null
  } else if (puntPlay) {
    kickerKey = keys.find((k) => roles[k] === 'P') ?? null
    returnerKey = keys.find((k) => roles[k] === 'PR') ?? (keySet['s0'] ? 's0' : null)
  } else if (koPlay) {
    const p0 = posAt(anim.ball, 0)
    let best = Infinity
    for (const k of keys) {
      if (sides[k] !== 'def') continue
      const p = posAt(paths[k], 0)
      const d = Math.hypot(p.x - p0.x, p.y - p0.y)
      if (d < best - 1e-9) { best = d; kickerKey = k }
    }
    returnerKey = keySet['rb'] ? 'rb' : null
  }

  // ── holder / carrier ───────────────────────────────────────────────────────
  const holders = anim.holders ?? []
  let carriedKey: string | null = null
  for (let i = holders.length - 1; i >= 0; i--) {
    if (holders[i].key) { carriedKey = holders[i].key; break }
  }
  const finalHolder = holders.length ? holders[holders.length - 1].key : null
  const carrierKey = carriedKey && keySet[carriedKey] ? carriedKey : null
  const lastT = (k: string) => {
    const p = paths[k]
    return p && p.length ? clamp01(p[p.length - 1].t) : 0
  }
  let carrierStartT = SNAP_T
  if (carrierKey) for (const h of holders) if (h.key === carrierKey) { carrierStartT = clamp01(h.t); break }

  // ── flight geometry (shared with the probe) ────────────────────────────────
  const madeKick = /good/.test(result) && !/no good|MISSED/i.test(result)
  const touchback = result === 'Touchback' || play.returnKind === 'touchback' || result.includes('touchback')
  const flightHeights = (): { z0: number; z1: number } => {
    if (fgPlay) return { z0: 0.15, z1: madeKick ? 4.0 : 1.5 }
    if (puntPlay) {
      if (touchback) return { z0: 0.7, z1: 0 }
      if (play.returnKind === 'return' || play.returnKind === 'fairCatch') return { z0: 0.7, z1: 1.4 }
      return { z0: 0.7, z1: 0.2 }
    }
    if (koPlay) return touchback ? { z0: 0.15, z1: 0 } : { z0: 0.15, z1: 1.4 }
    if (type === 'pass') { const z0 = throwHand(throwStyle, 0).z; return inc ? { z0, z1: 0.2 } : { z0, z1: 1.4 } }
    return { z0: 1.1, z1: 0.2 } // a loose ball (run fumble)
  }
  const postFlightZ = (): number => {
    if (fgPlay) return 0.15
    if (puntPlay) {
      if (touchback) return 0
      if (play.returnKind === 'return' || play.returnKind === 'fairCatch') return 1.1
      return 0.2
    }
    if (koPlay) return touchback ? 0 : 1.1
    if (type === 'pass') return inc ? 0.2 : 1.1
    return 1.1
  }

  // ── tackle / dead-ball ─────────────────────────────────────────────────────
  const touchdown = play.endYard >= 100
  const tackled = (() => {
    if (type === 'run') return !play.turnover && !play.outOfBounds && !touchdown
    if (type === 'pass') {
      if (sackPlay) return true
      if (int) return !play.defTD && !touchdown
      if (inc) return false
      if (play.turnover || play.outOfBounds || touchdown) return false
      return true
    }
    if (type === 'punt') return play.returnKind === 'return' && !play.returnTD
    if (type === 'kickoff') return !touchback && !play.returnTD && !play.turnover
    return false
  })()

  const keyForId = (id?: string): string | null => {
    if (!id || !ctx.actors) return null
    for (const k of keys) if (ctx.actors.get(k)?.id === id) return k
    return null
  }
  const nearestOf = (cand: string[], spot: Pt, t: number): string | null => {
    let best = Infinity
    let out: string | null = null
    for (const k of cand) {
      const p = posAt(paths[k], t)
      const d = Math.hypot(p.x - spot.x, p.y - spot.y)
      if (d < best - 1e-9) { best = d; out = k }
    }
    return out
  }

  // Intended receiver: the nearest eligible offensive actor to the ball at the catch.
  let targetKey: string | null = null
  if (type === 'pass' && flight) {
    const bp = posAt(anim.ball, flight.t1)
    const cand = keys.filter((k) => sides[k] === 'off' && k !== 'qb' && !k.startsWith('ol'))
    targetKey = nearestOf(cand, bp, flight.t1)
  }

  // ── special windows ────────────────────────────────────────────────────────
  const throwWin: { t0: number; t1: number } | null =
    type === 'pass' && !sackPlay && flight ? { t0: Math.max(0, flight.t0 - throwT.wind / D), t1: Math.min(1, flight.t0 + throwT.follow / D) } : null

  let fakeWin: { t0: number; t1: number } | null = null
  if (type === 'pass' && /Play Action|PA Cross|RPO/.test(concept)) {
    const ev = events.find((e) => e.kind === 'playAction')
    const c = ev ? ev.t : SNAP_T + 0.175 / D
    fakeWin = { t0: clamp01(c - 0.175 / D), t1: clamp01(c + 0.175 / D) }
  }

  const catchBy: Record<string, { t0: number; t1: number }> = {}
  const addCatch = (k: string | null, t: number) => {
    if (!k || !keySet[k]) return
    catchBy[k] = { t0: Math.max(0, t - 0.1 / D), t1: Math.min(1, t + 0.1 / D) }
  }
  if (type === 'pass' && flight && !inc) {
    const cKey = int ? nearestOf(keys.filter((k) => sides[k] === 'def'), posAt(anim.ball, flight.t1), flight.t1) : targetKey
    addCatch(cKey, flight.t1)
  }
  if (puntPlay && flight && returnerKey && (play.returnKind === 'return' || play.returnKind === 'fairCatch')) addCatch(returnerKey, flight.t1)
  if (koPlay && flight && returnerKey && !touchback) addCatch(returnerKey, flight.t1)

  const stumbleBy: Record<string, { t0: number; t1: number }> = {}
  // animflow r6b (item 5): a broken tackle is the carrier's best move (juke /
  // spin / stiff arm / truck, animRatings.carrierMove), and the man he beat
  // reacts to it (lunges past a juke, is shoved off by the stiff arm, knocked
  // back by the truck, grabs air on the spin). One move per missed tackle.
  const moveBy: Record<string, { t0: number; t1: number; state: PoseState }[]> = {}
  const spinBy: Record<string, { t0: number; t1: number; dir: 1 | -1 }> = {}
  const moves: { key: string; move: CarrierMove; t: number; missed: string | null }[] = []
  if (carrierKey && (play.missedTackleIds?.length ?? 0) > 0) {
    const stop = lastT(carrierKey)
    const carrierPl = ctx.actors?.get(carrierKey)
    const evs = events.filter((e) => e.kind === 'brokenTackle')
    const list = evs.length ? evs.map((e) => ({ t: e.t, missed: e.keys[1] ?? null })) : [{ t: carrierStartT + 0.65 * Math.max(0, stop - carrierStartT), missed: null }]
    list.forEach((ev, i) => {
      const move = carrierMove(carrierPl, (play.n ?? 0) * 7.31 + i * 3.7 + (play.startYard ?? 0))
      moves.push({ key: carrierKey, move, t: ev.t, missed: ev.missed })
      const half = (move === 'spin' ? 0.22 : move === 'juke' ? 0.16 : 0.18) / D
      const w = { t0: Math.max(0, ev.t - half), t1: Math.min(stop, ev.t + half) }
      if (w.t1 - w.t0 < 1e-6) return
      ;(moveBy[carrierKey] ??= []).push({ ...w, state: move === 'stiffArm' ? 'stiffArm' : move })
      if (move === 'spin') spinBy[carrierKey] = { ...w, dir: hashSide(play.n ?? 0, i) }
      const mk = ev.missed
      if (mk && keySet[mk] && mk !== carrierKey) {
        // animflow r8 (item b): beaten by a juke or a spin he lunges and grabs air (arms closing on
        // nothing, half falling, then back up); shoved off by the stiff arm; run over by the truck.
        const st: PoseState = move === 'juke' || move === 'spin' ? 'lunge' : move === 'truck' ? 'fall' : 'stumble'
        const len = (move === 'truck' ? 0.3 : move === 'stiffArm' ? 0.32 : 0.45) / D
        ;(moveBy[mk] ??= []).push({ t0: Math.max(0, ev.t - 0.08 / D), t1: Math.min(1, ev.t + len), state: st })
      }
    })
  }

  // animflow r6c: a defender beating his block shows the move (rip / swim /
  // bull / spin) and the beaten blocker is turned and off balance (a stumble,
  // facing the man who beat him) for a beat after it.
  const beatenBy: Record<string, { t0: number; t1: number; key: string }[]> = {}
  for (const sh of Array.isArray(b1a.sheds) ? b1a.sheds : []) {
    if (!keySet[sh.def] || sh.def === carrierKey) continue
    const st: PoseState = sh.move === 'speed' || sh.move === 'rip' ? 'rip' : sh.move === 'spin' ? 'spinRush' : sh.move
    const t0 = clamp01(sh.t0)
    const t1 = Math.min(1, Math.max(sh.t1, sh.t0 + 0.2 / D))
    if (t1 - t0 < 1e-6) continue
    ;(moveBy[sh.def] ??= []).push({ t0, t1, state: st })
    if (sh.move === 'spin' && !spinBy[sh.def]) spinBy[sh.def] = { t0, t1, dir: hashSide(play.n ?? 0, sh.def.length) }
    for (const b of sh.blk) {
      if (!keySet[b] || b === carrierKey) continue
      const w = { t0: Math.min(1, t0 + 0.06 / D), t1: Math.min(1, t1 + 0.25 / D) }
      if (w.t1 - w.t0 < 1e-6) continue
      ;(moveBy[b] ??= []).push({ ...w, state: 'stumble' })
      ;(beatenBy[b] ??= []).push({ ...w, key: sh.def })
    }
  }

  // animflow: the carrier is jolted (a stumble) at first contact before he goes
  // down, unless a broken tackle already shows one.
  if (carrierKey && !stumbleBy[carrierKey]) {
    const ev = events.find((e) => e.kind === 'contact' && e.keys[0] === carrierKey)
    const stop = lastT(carrierKey)
    if (ev && ev.t < stop - 0.35 / D) stumbleBy[carrierKey] = { t0: Math.max(0, ev.t - 0.04 / D), t1: Math.min(stop - 0.2 / D, ev.t + 0.2 / D) }
  }
  // animflow: men wrapping up the carrier (recorded 'tackle' engagements) are in
  // the tackle pose — arms out, leaning in — until the dive / fall takes over.
  const tackleBy: Record<string, { t0: number; t1: number }[]> = {}
  // animflow r8 (backlog 354): on a forced out-of-bounds end the men on the carrier are PUSHING him
  // out (arms locked out into him, legs driving), and he is knocked off balance over the line.
  const pushEnd = (type === 'run' || type === 'pass') && !!play.outOfBounds && !touchdown && !play.turnover && !sackPlay
  let pushT0 = Infinity
  for (const e of engagements) {
    if (e.kind !== 'tackle' || !keySet[e.a] || e.a === carrierKey) continue
    if (pushEnd && e.b === carrierKey && sides[e.a] === 'def') {
      ;(moveBy[e.a] ??= []).push({ t0: clamp01(e.t0), t1: clamp01(e.t1), state: 'pushOut' })
      pushT0 = Math.min(pushT0, clamp01(e.t0))
      continue
    }
    ;(tackleBy[e.a] ??= []).push({ t0: clamp01(e.t0), t1: clamp01(e.t1) })
  }
  if (pushEnd && carrierKey && pushT0 < 1) {
    const stop = lastT(carrierKey)
    if (stop - pushT0 > 0.12 / D) stumbleBy[carrierKey] = { t0: Math.min(stop, pushT0 + 0.06 / D), t1: stop }
  }
  const diveBy: Record<string, { t0: number; t1: number }> = {}
  const tackleStyles: Record<string, string> = {}
  const fallBy: Record<string, { t0: number; t1: number }> = {}
  const downBy: Record<string, { t0: number; t1: number }> = {}
  const tackleT = carrierKey && tackled ? Math.min(lastT(carrierKey), 1 - 1e-4) : null
  if (tackleT != null && carrierKey) {
    // animflow r8 (item b): the tackle is a motion, not a touch and a freeze. The tackler closes
    // (hips sinking into the contact), wraps and drives, and the two bodies go down TOGETHER over the
    // last ~0.35-0.55 s, landing as the play ends (the frame holds at the end: both on the ground on
    // the spot). How depends on the man (TAK / HPW, animRatings.tackleStyle) and the angle: a form
    // tackle (TAK >= 80) is short and square, a wrap-and-drive keeps the legs going, a big hit puts
    // him down at once, an arm tackle drags him down slowly, a chase from behind (or a man still a
    // step short) is a dive at the legs; a second man on the pile goes down with them (gang).
    let fallLen = 0.42
    let fs = Math.max(0, tackleT - fallLen / D)
    const tk = keyForId(play.tackleIds?.[0]) ?? keyForId(play.sackId) ??
      nearestOf(keys.filter((k) => sides[k] === 'def'), posAt(paths[carrierKey], tackleT), tackleT)
    if (tk && tk !== carrierKey) {
      // animflow r6a: how he brings him down follows the angle and speed of the
      // hit (BDB 2021 tackles after a catch: 54% from behind, 34% on an angle,
      // 12% head-on): a chase from behind on a man still running ends in a
      // dive at the legs (ankle / shoestring); an angle or head-on hit is a
      // wrap-and-drive (arms round him, legs driving) and they go down together.
      const ct = events.find((e) => e.kind === 'contact' && e.keys[0] === carrierKey)
      const ht = ct && ct.t < tackleT ? ct.t : Math.max(0, tackleT - 0.4 / D)
      const vel = (k: string, t: number): Pt => {
        const a = posAt(paths[k], Math.max(0, t - 0.1 / D))
        const b = posAt(paths[k], Math.min(1, t + 0.1 / D))
        return { x: (b.x - a.x) / (0.2), y: (b.y - a.y) / (0.2) }
      }
      const tv = vel(tk, ht)
      const cv = vel(carrierKey, ht)
      const cs = Math.hypot(cv.x, cv.y)
      const ang = Math.hypot(tv.x, tv.y) > 0.5 && cs > 0.5
        ? Math.abs(((Math.atan2(tv.y, tv.x) - Math.atan2(cv.y, cv.x) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * (180 / Math.PI)
        : 90
      const fromBehind = ang < 50
      // animflow r6b (item 5): the tackle by the tackler's TAK / HPW (animRatings.tackleStyle).
      let style = tackleStyle(ctx.actors?.get(tk), { fromBehind, carrierSpeed: cs, tacklerSpeed: Math.hypot(tv.x, tv.y), seed: (play.n ?? 0) * 3.1 + (play.startYard ?? 0) })
      const form = style === 'wrap' && effRating(ctx.actors?.get(tk), 'TAK', 70) >= 80
      fallLen = style === 'dive' ? 0.4 : style === 'hit' ? 0.34 : style === 'arm' ? 0.55 : form ? 0.4 : 0.48
      fs = Math.max(0, Math.max(ht + 0.08 / D, tackleT - fallLen / D))
      if (tackleT - fs < 0.2 / D) fs = Math.max(0, tackleT - 0.2 / D)
      // Still a step short as they must go down (a late arrival): he dives at the legs.
      const gap = (t: number) => {
        const a = posAt(paths[tk], t)
        const b = posAt(paths[carrierKey], t)
        return Math.hypot(a.x - b.x, a.y - b.y)
      }
      if (style !== 'dive' && Math.max(gap(fs), gap(Math.max(0, tackleT - 0.25 / D))) > 1.3) style = 'dive'
      tackleStyles[tk] = style
      if (style === 'dive') {
        diveBy[tk] = { t0: Math.max(0, tackleT - 0.4 / D), t1: tackleT }
        for (const o of moveBy[tk] ?? []) if (o.t1 > diveBy[tk].t0) o.t1 = Math.max(o.t0, diveBy[tk].t0)
      } else {
        // Close and wrap: hips sink into the contact a beat before it, arms round him, legs driving.
        const w = { t0: clamp01(Math.max(0, Math.min(ht - 0.14 / D, fs - 0.2 / D))), t1: fs }
        // (the tackle beats any move window still open on him - a rip off his block runs into it)
        const mv = (moveBy[tk] ??= [])
        for (const o of mv) if (o.t1 > w.t0) o.t1 = Math.max(o.t0, w.t0)
        if (style === 'wrap') (tackleBy[tk] ??= []).push(w)
        else mv.unshift({ ...w, state: style === 'hit' ? 'tackleHit' : 'tackleArm' })
        // ...then he takes him down and goes down with him (arms still round him).
        mv.unshift({ t0: fs, t1: tackleT, state: 'tackleFall' })
      }
      downBy[tk] = { t0: tackleT, t1: 1 }
      // Gang tackle: the next man in, on the pile at the end, goes down with them.
      let gk: string | null = null
      let gd = 1.05
      for (const e of engagements) {
        if (e.kind !== 'tackle' || e.b !== carrierKey || e.a === tk || !keySet[e.a] || sides[e.a] !== 'def') continue
        const d = (() => { const a = posAt(paths[e.a], tackleT); const c = posAt(paths[carrierKey], tackleT); return Math.hypot(a.x - c.x, a.y - c.y) })()
        if (d < gd) { gd = d; gk = e.a }
      }
      if (gk && !moveBy[gk]?.some((w) => w.t1 >= fs)) {
        ;(moveBy[gk] ??= []).push({ t0: Math.max(0, tackleT - 0.32 / D), t1: tackleT, state: 'tackleFall' })
        downBy[gk] = { t0: tackleT, t1: 1 }
      }
    }
    // The carrier goes down with him over the same beat (a big hit: from the hit on).
    if (tackleT - fs > 1e-6) fallBy[carrierKey] = { t0: fs, t1: tackleT }
    downBy[carrierKey] = { t0: tackleT, t1: 1 }
  }

  // animflow r6a: a recorded QB hit is a hit after the throw — the rusher
  // arrives as the ball leaves, wraps him and the passer goes down (BDB 2023:
  // QB hit on 9% of dropbacks; nflverse hit rate), then is back up.
  if (type === 'pass' && !sackPlay && play.pressureType === 'hit' && throwWin && qbKey && !fallBy[qbKey]) {
    const hk = keyForId(play.pressureId)
    const f0 = throwWin.t1
    const f1 = Math.min(1, f0 + 0.3 / D)
    if (f1 > f0 + 1e-6) {
      fallBy[qbKey] = { t0: f0, t1: f1 }
      downBy[qbKey] = { t0: f1, t1: Math.min(1, f1 + 1.1 / D) }
      if (hk && hk !== qbKey && sides[hk] === 'def') {
        ;(tackleBy[hk] ??= []).push({ t0: clamp01(Math.max(throwWin.t0, f0 - 0.25 / D)), t1: f1 })
        downBy[hk] ??= { t0: f1, t1: Math.min(1, f1 + 0.6 / D) }
      }
    }
  }

  const kickWin: { t0: number; t1: number } | null = !flight
    ? null
    : fgPlay || puntPlay
      ? { t0: kickT, t1: Math.min(1, kickT + 1.0 / D) } // swing + follow-through, then cover / watch
      : koPlay
        ? { t0: kickT, t1: Math.min(1, kickT + 0.5 / D) }
        : null

  // ── block engagements (b1a when present) + fallback inference ──────────────
  const blockBy: Record<string, { t0: number; t1: number; other: string }[]> = {}
  const addBlock = (a: string, other: string, t0: number, t1: number) => {
    if (!keySet[a] || !keySet[other] || a === other) return
    const t = clamp01(t0), u = clamp01(t1)
    if (u - t < 1e-4) return
    const list = blockBy[a] ?? (blockBy[a] = [])
    list.push({ t0: t, t1: u, other })
  }
  for (const e of engagements) {
    if (e.kind === 'block' || e.kind === 'double' || e.kind === 'chip') {
      const bk = sides[e.a] === 'off' ? e.a : sides[e.b] === 'off' ? e.b : e.a
      const other = bk === e.a ? e.b : e.a
      addBlock(bk, other, e.t0, e.t1)
      // animflow: the man being blocked is engaged too — hands on, leaning
      // into his blocker and facing him (not standing upright beside him).
      addBlock(other, bk, e.t0, e.t1)
    }
  }
  // Fallback: an off/def pair within 1.2 yd for >= 0.15 s at near-zero relative speed.
  // (Skipped when b1a supplied engagements — those already carry every block.)
  if (engagements.length === 0) {
    const blc = ['ol0', 'ol1', 'ol2', 'ol3', 'ol4', 'te', 'rb', 'fb'].filter((k) => keySet[k])
    const rsh = ['dl0', 'dl1', 'dl2', 'dl3', 'lb0', 'lb1', 'lb2'].filter((k) => keySet[k])
    if (blc.length && rsh.length) {
      const n = Math.max(2, Math.ceil((1 - SNAP_T) / Math.max(0.06 / D, 1e-3)))
      const ts: number[] = []
      for (let i = 0; i <= n; i++) ts.push(SNAP_T + (1 - SNAP_T) * (i / n))
      const cache: Record<string, Pt[]> = {}
      for (const k of blc) cache[k] = samplePath(paths[k], ts)
      for (const k of rsh) cache[k] = samplePath(paths[k], ts)
      const dtSec = Math.max(1e-4, (ts.length > 1 ? ts[1] - ts[0] : 0.06 / D) * D)
      for (const b of blc) {
        const cb = cache[b]
        for (const r of rsh) {
          const cr = cache[r]
          const dx0 = cb[0].x - cr[0].x
          const dy0 = cb[0].y - cr[0].y
          if (dx0 * dx0 + dy0 * dy0 > 49) continue // start more than 7 yd apart
          let run = -1
          for (let i = 0; i < ts.length; i++) {
            const dx = cb[i].x - cr[i].x
            const dy = cb[i].y - cr[i].y
            let contact = false
            if (dx * dx + dy * dy <= 1.44) {
              let rel = 0
              if (i > 0) {
                const bx = (cb[i].x - cb[i - 1].x) - (cr[i].x - cr[i - 1].x)
                const by = (cb[i].y - cb[i - 1].y) - (cr[i].y - cr[i - 1].y)
                rel = Math.sqrt(bx * bx + by * by) / dtSec
              }
              contact = rel <= 0.6
            }
            if (contact) {
              if (run < 0) run = i
            } else if (run >= 0) {
              if ((ts[i - 1] - ts[run]) * D >= 0.15) addBlock(b, r, ts[run], ts[i - 1])
              run = -1
            }
          }
          if (run >= 0 && (ts[ts.length - 1] - ts[run]) * D >= 0.15) addBlock(b, r, ts[run], ts[ts.length - 1])
        }
      }
    }
  }

  // ── facing helpers ─────────────────────────────────────────────────────────
  const kickDir: number | null = (() => {
    if (!flight) return null
    const p0 = posAt(anim.ball, flight.t0)
    const p1 = posAt(anim.ball, flight.t1)
    const a = Math.atan2(p1.y - p0.y, p1.x - p0.x)
    return Number.isFinite(a) ? a : null
  })()

  const ballAtCatch = flight ? posAt(anim.ball, flight.t1) : { x: MID_Y, y: MID_Y }
  const isReceiverKey = (k: string) => sides[k] === 'off' && k !== 'qb' && !k.startsWith('ol')
  const blockOther = (k: string, t: number): string | null => {
    const ws = blockBy[k]
    if (!ws) return null
    for (const w of ws) if (t >= w.t0 && t <= w.t1 && keySet[w.other] && w.other !== k) return w.other
    return null
  }

  // ── coverage body control (animflow r6a; BDB 2021, 2018 pass plays) ────────
  // A corner backpedals (44% of corners, at ~2.9 yd/s) and turns his hips after
  // a median 1.8 s (p10 1.1, p90 3.3; a quarter never turn inside 4 s); after the
  // throw the man nearest the target is facing the ball 77% of the time and the
  // rest snap their heads round in a median 0.4 s. Times per player from his
  // coverage rating plus a per-play draw.
  const r6Hash = (n: number) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x) }
  const scrimmage = type === 'pass' || type === 'run'
  const qbUnder = scrimmage && (() => { const q = anim.actors.find((a) => a.key === 'qb'); return !!q && 10 + (play.startYard ?? 0) - q.path[0].x < 1.6 })()
  const pedalEnd: Record<string, number> = {}
  const ballLag: Record<string, number> = {}
  keys.forEach((k, i) => {
    if (sides[k] !== 'def') return
    const pl = ctx.actors?.get(k)
    // animflow r6b: the sim's effective ratings (playerAttrs), not raw attrs.
    const cov = pl ? Math.max(effRating(pl, 'MCV', pl.ovr ?? 70), effRating(pl, 'ZCV', 0)) : 70
    const u = r6Hash((play.n ?? 0) * 31 + i * 7.1)
    const hip = 2.1 + (70 - cov) * 0.02 + (u - 0.5) * 1.6 + (u > 0.8 ? 1.8 : 0)
    pedalEnd[k] = SNAP_T + Math.max(0.9, Math.min(4.5, hip)) / D
    const w = r6Hash((play.n ?? 0) * 17 + i * 3.3 + 5)
    ballLag[k] = (w < 0.7 ? -0.1 : 0.2 + (w - 0.7) * 2.4) / D
  })

  // ── per-t state ────────────────────────────────────────────────────────────
  // animflow r6b (item 4): the sim's fatigue at the snap (Play.fatOn via ctx.fat).
  const tiredK: Record<string, boolean> = {}
  for (const k of keys) {
    const pl = ctx.actors?.get(k)
    tiredK[k] = !!pl && tiredness(ctx.fat?.get(pl.id)) >= 0.25
  }
  const tired = (k: string) => tiredK[k]
  const whistleT = (() => {
    let w: number | null = null
    for (const e of events) if (e.kind === 'tackle' || e.kind === 'sack' || e.kind === 'outOfBounds' || e.kind === 'down' || e.kind === 'score' || e.kind === 'incomplete' || e.kind === 'safety' || e.kind === 'fairCatch' || e.kind === 'touchback') w = w == null ? e.t : Math.min(w, e.t)
    return w
  })()
  const kneelT = play.kneel ? events.find((e) => e.kind === 'down')?.t : undefined
  const preSnap = (k: string): PoseState => {
    if (k === fgHolderKey) return 'hold'
    if (k === returnerKey) return 'stand'
    if (kickerKey && k === kickerKey && (fgPlay || puntPlay)) return 'stand'
    if (k.startsWith('ol') || k.startsWith('dl')) return 'stance3'
    // animflow r6c2 (295): under centre the passer is crouched over the ball.
    if (k === 'qb') return qbUnder ? 'stance2' : 'stand'
    return 'stance2'
  }

  const stateFor = (k: string, t: number, vx: number, spd: number, hKey: string | null, nearCar: boolean): PoseState => {
    if (kickerKey && k === kickerKey && kickWin && t >= kickWin.t0 - 1e-9 && t <= kickWin.t1 + 1e-9) return 'kick'
    if (k === fgHolderKey && t < kickT) return 'hold'
    // animflow r6d (J6): the kneel — the passer goes down on a knee and stays there.
    if (play.kneel && k === 'qb' && kneelT != null && t >= kneelT) return 'hold'
    if (qbKey && k === qbKey && throwWin && t >= throwWin.t0 && t <= throwWin.t1) return THROW_STATE[throwStyle]
    if (qbKey && k === qbKey && fakeWin && t >= fakeWin.t0 && t <= fakeWin.t1) return 'fake'
    const cw = catchBy[k]
    if (cw && t >= cw.t0 && t <= cw.t1) return 'catch'
    const mw = moveBy[k]?.find((w) => t >= w.t0 && t <= w.t1)
    if (mw) return mw.state
    const sw = stumbleBy[k]
    if (sw && t >= sw.t0 && t <= sw.t1) return 'stumble'
    const dw = diveBy[k]
    if (dw && t >= dw.t0 && t <= dw.t1) return 'dive'
    const fw = fallBy[k]
    if (fw && t >= fw.t0 && t <= fw.t1) return 'fall'
    const dn = downBy[k]
    if (dn && t >= dn.t0 && t <= dn.t1) return 'down'
    const tw = tackleBy[k]
    if (tw && tw.some((w) => t >= w.t0 && t <= w.t1)) return 'tackle'
    if (t < SNAP_T) {
      const ps = preSnap(k)
      return ps === 'stand' && k !== returnerKey && k !== kickerKey && tired(k) ? 'hips' : ps
    }
    if (hKey === k) {
      if (roles[k] === 'H') return 'hold'
      // animflow round 3: the passer, drop done, is set (ball high at the chest,
      // feet under him) until the wind-up; a pocket shuffle stays a set.
      if (k === 'qb' && type === 'pass' && !sackPlay && t > SNAP_T) return spd > 2.2 ? 'run' : 'set'
      if (k === 'qb') return spd > RUN_SPEED ? 'run' : 'stand'
      return 'carry'
    }
    if (blockOther(k, t)) return 'block'
    if (k === returnerKey && flight && t < flight.t1) return 'stand'
    // animflow r6b (item 4): a tired man stands with his hands on his hips once the whistle has gone.
    if (spd <= RUN_SPEED && whistleT != null && t >= whistleT && tired(k)) return 'hips'
    if (spd > RUN_SPEED) {
      if (sides[k] === 'def' && vx > 0.2 && !nearCar) {
        // animflow r6a: the backpedal ends at the hip turn (and on the throw).
        if (!scrimmage) return 'pedal'
        if (t <= (pedalEnd[k] ?? 1) && spd < 5.5 && !(flight && t >= flight.t0)) return 'pedal'
      }
      return 'run'
    }
    return 'stand'
  }

  type FMode =
    | { mode: 'move' }
    | { mode: 'angle'; angle: number }
    | { mode: 'actor'; key: string }
    | { mode: 'backpedal' }
    | { mode: 'spin'; dir: 1 | -1; s0: number; s1: number }

  // animflow r8 (J12): the fooled QB's first look (window, 0..1) and where he looks (field yd).
  const fooledWin: { t0: number; t1: number; x: number; y: number } | null = (() => {
    if (!scrimmage || type !== 'pass' || sackPlay || !play.qbFooled || !throwWin || !flight || !qbKey) return null
    const t0 = SNAP_T + 0.35 / D
    const t1 = Math.min(SNAP_T + 1.4 / D, throwWin.t0 - 0.5 / D)
    if ((t1 - t0) * D < 0.3) return null
    const q = posAt(paths[qbKey] ?? [], t0)
    return { t0, t1, x: q.x + 14, y: ballAtCatch.y < MID_Y ? MID_Y + 11 : MID_Y - 11 }
  })()
  const facingFor = (k: string, t: number, st: PoseState, hKey: string | null, pos: Pt, hPos: Pt | null, nearCar: boolean, vx = 0, vy = 0): FMode => {
    if (kickerKey && k === kickerKey && kickDir != null && (st === 'kick' || fgPlay || puntPlay)) {
      return { mode: 'angle', angle: kickDir }
    }
    if (k === fgHolderKey && kickDir != null && (st === 'hold' || t < kickT)) return { mode: 'angle', angle: kickDir }
    if (k === returnerKey && flight && t < flight.t1) {
      const a = Math.atan2(ballAtCatch.y - pos.y, ballAtCatch.x - pos.x)
      return { mode: 'angle', angle: Number.isFinite(a) ? a : 0 }
    }
    if (st === 'pedal') return { mode: 'backpedal' }
    const sp = spinBy[k]
    if (sp && t >= sp.t0 && t <= sp.t1) return { mode: 'spin', dir: sp.dir, s0: sp.t0, s1: sp.t1 }
    // animflow r6a: eyes to the ball once it is in the air (coverage defenders
    // near the throw), after a short head-turn lag for some.
    if (scrimmage && flight && type === 'pass' && sides[k] === 'def' && !k.startsWith('dl') && st !== 'tackle' && !blockOther(k, t) &&
      t >= flight.t0 + (ballLag[k] ?? 0) && t <= flight.t1 && Math.hypot(pos.x - ballAtCatch.x, pos.y - ballAtCatch.y) < 18) {
      const a = Math.atan2(ballAtCatch.y - pos.y, ballAtCatch.x - pos.x)
      if (Number.isFinite(a)) return { mode: 'angle', angle: a }
    }
    // A shuffle: sliding across the field square to the quarterback (before the throw).
    if (scrimmage && type === 'pass' && sides[k] === 'def' && !k.startsWith('dl') && st === 'run' && t > SNAP_T && !(flight && t >= flight.t0) &&
      Math.abs(vy) > 1.2 * Math.abs(vx) && Math.hypot(vx, vy) < 4.5 && !nearCar) return { mode: 'angle', angle: Math.PI }
    // Sitting in a zone (slow, before the throw): eyes on the quarterback.
    if (scrimmage && type === 'pass' && qbKey && keySet[qbKey] && sides[k] === 'def' && !k.startsWith('dl') && (st === 'run' || st === 'stand') &&
      t > SNAP_T && !(flight && t >= flight.t0) && Math.hypot(vx, vy) < 2.5 && !nearCar && Math.hypot(pos.x - ballAtCatch.x, pos.y - ballAtCatch.y) > 8) return { mode: 'actor', key: qbKey }
    if ((st === 'tackle' || st === 'pushOut' || st === 'tackleFall') && carrierKey && keySet[carrierKey] && carrierKey !== k) return { mode: 'actor', key: carrierKey }
    const bt = beatenBy[k]?.find((w) => t >= w.t0 && t <= w.t1)
    if (bt && keySet[bt.key]) return { mode: 'actor', key: bt.key }
    const bo = blockOther(k, t)
    if (bo) return { mode: 'actor', key: bo }
    // animflow r8 (J12 qbFooled): fooled by the disguise, his first look goes where the SHOWN shell
    // said the ball should go - the side away from the throw - and holds there while the defence
    // rotates late, before his eyes come back to the real target for the throw.
    if (fooledWin && qbKey && k === qbKey && hKey === k && t >= fooledWin.t0 && t < fooledWin.t1) {
      return { mode: 'angle', angle: Math.atan2(fooledWin.y - pos.y, Math.max(6, fooledWin.x - pos.x)) }
    }
    // Shoulders to the target from the set through the follow-through, then he
    // watches the ball to the catch (on the run too: the shoulders turn).
    if (qbKey && k === qbKey && throwWin && targetKey && keySet[targetKey] && targetKey !== k &&
      t >= throwWin.t0 - 0.45 / D && t <= (flight ? Math.max(throwWin.t1, flight.t1) : throwWin.t1)) {
      return { mode: 'actor', key: targetKey }
    }
    // The drop: he gets depth with his eyes downfield, never turning his back.
    if (qbKey && k === qbKey && type === 'pass' && !sackPlay && hKey === k && t > SNAP_T && st === 'run' && vx < -0.8) {
      return { mode: 'backpedal' }
    }
    if (flight && isReceiverKey(k) && t >= flight.t1 - 0.4 / D && t <= flight.t1) {
      const ref = qbKey ?? (carrierKey && keySet[carrierKey] ? carrierKey : null)
      if (ref && ref !== k) return { mode: 'actor', key: ref }
    }
    if (sides[k] === 'def' && hKey && hKey !== k && sides[hKey] === 'off' && !nearCar && hPos) {
      if (Math.hypot(pos.x - hPos.x, pos.y - hPos.y) < 8) return { mode: 'actor', key: hKey }
    }
    if (t < SNAP_T) return { mode: 'angle', angle: sides[k] === 'off' ? 0 : Math.PI }
    return { mode: 'move' }
  }

  // ── cuts (grid + special boundaries), then contiguous windows ──────────────
  const cutList: number[] = [0, 1, SNAP_T, kickT]
  const addCut = (x: number) => { if (Number.isFinite(x)) cutList.push(clamp01(x)) }
  const N = Math.max(4, Math.ceil(D / 0.04))
  for (let i = 1; i < N; i++) addCut(i / N)
  if (throwWin) { addCut(throwWin.t0); addCut(throwWin.t1) }
  if (fooledWin) { addCut(fooledWin.t0); addCut(fooledWin.t1) }
  if (fakeWin) { addCut(fakeWin.t0); addCut(fakeWin.t1) }
  if (kickWin) { addCut(kickWin.t0); addCut(kickWin.t1) }
  if (flight) { addCut(flight.t0); addCut(flight.t1) }
  for (const m of [catchBy, stumbleBy, diveBy, fallBy, spinBy]) {
    for (const k of Object.keys(m)) { addCut(m[k].t0); addCut(m[k].t1) }
  }
  for (const k of Object.keys(moveBy)) for (const w of moveBy[k]) { addCut(w.t0); addCut(w.t1) }
  if (whistleT != null) addCut(whistleT)
  for (const k of Object.keys(downBy)) { addCut(downBy[k].t0); addCut(downBy[k].t1) }
  for (const k of Object.keys(blockBy)) for (const w of blockBy[k]) { addCut(w.t0); addCut(w.t1) }
  for (const h of holders) addCut(h.t)

  const seen = new Set<number>()
  const cuts: number[] = []
  for (const x of cutList) {
    const c = clamp01(x)
    if (Number.isFinite(c) && !seen.has(c)) { seen.add(c); cuts.push(c) }
  }
  cuts.sort((a, b) => a - b)
  if (cuts[0] !== 0) cuts.unshift(0)
  if (cuts[cuts.length - 1] !== 1) cuts.push(1)

  const sameFacing = (a: FacingWindow, b: FacingWindow): boolean => {
    if (a.mode !== b.mode) return false
    if (a.mode === 'angle' && b.mode === 'angle') return Math.abs(a.angle - b.angle) < 1e-6
    if (a.mode === 'actor' && b.mode === 'actor') return a.key === b.key
    if (a.mode === 'spin' && b.mode === 'spin') return a.s0 === b.s0 && a.dir === b.dir
    return true
  }

  const poses: Record<string, PoseWindow[]> = {}
  const facing: Record<string, FacingWindow[]> = {}
  const cutPos: Record<string, Pt[]> = {}
  for (const k of keys) cutPos[k] = samplePath(paths[k], cuts)
  const carPosCut = carrierKey ? cutPos[carrierKey] : null
  for (const k of keys) {
    const pk = cutPos[k]
    const outP: PoseWindow[] = []
    const outF: FacingWindow[] = []
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i]
      const b = cuts[i + 1]
      if (b - a <= 1e-9) continue
      const dtSec = Math.max(1e-6, (b - a) * D)
      const vx = (pk[i + 1].x - pk[i].x) / dtSec
      const vy = (pk[i + 1].y - pk[i].y) / dtSec
      const spd = Math.hypot(vx, vy)
      const mid = (a + b) / 2
      const hKey = holderAtKeys(holders, mid)
      const hPos = hKey && cutPos[hKey] ? cutPos[hKey][i] : null
      const nearCar = !!carPosCut && carrierKey !== k && Math.hypot(pk[i].x - carPosCut[i].x, pk[i].y - carPosCut[i].y) < 4.5
      const st = stateFor(k, mid, vx, spd, hKey, nearCar)
      const lastP = outP[outP.length - 1]
      if (lastP && lastP.state === st) lastP.t1 = b
      else outP.push({ t0: a, t1: b, state: st })
      const w = { t0: a, t1: b, ...facingFor(k, mid, st, hKey, pk[i], hPos, nearCar, vx, vy) } as FacingWindow
      const lastF = outF[outF.length - 1]
      if (lastF && sameFacing(lastF, w)) lastF.t1 = b
      else outF.push(w)
    }
    if (outP.length) { outP[0].t0 = 0; outP[outP.length - 1].t1 = 1 }
    if (outF.length) { outF[0].t0 = 0; outF[outF.length - 1].t1 = 1 }
    poses[k] = outP
    facing[k] = outF
  }

  // ── ball height ────────────────────────────────────────────────────────────
  const ballZRaw: BallZKey[] = []
  const pushZ = (t: number, z: number) => {
    if (!Number.isFinite(t) || !Number.isFinite(z)) return
    ballZRaw.push({ t: clamp01(t), z: clampN(z, 0, 30) })
  }
  pushZ(0, 0.15)
  if (type === 'run' || type === 'pass' || puntPlay || fgPlay) pushZ(SNAP_T, 1.1)
  if (throwWin && flight) {
    // animflow round 3: carried at the chest, then back to the ear and over the
    // top with the throwing hand (throwHand); the flight starts at the hand.
    const R = flight.t0
    pushZ(Math.min(R, SNAP_T + 0.12 / D), 1.2)
    for (let i = 0; i <= 8; i++) {
      const toRel = throwT.wind * (1 - i / 8)
      pushZ(R - toRel / D, throwHand(throwStyle, toRel).z)
    }
  }
  const fh = flightHeights()
  for (let fi = 0; fi < anim.flights.length; fi++) {
    const fl = anim.flights[fi]
    if (fi === 0 && fgPlay && anim.kickZ && anim.kickZ.length) {
      // animflow r4: the kick's real arc (through the uprights, past the end line).
      for (const k of anim.kickZ) pushZ(k.t, k.z)
      continue
    }
    const z0 = fi === 0 ? fh.z0 : fh.z1
    const z1 = fh.z1
    pushZ(fl.t0, z0)
    const Tsec = Math.max(1e-4, (fl.t1 - fl.t0) * D)
    const K = Math.max(8, Math.ceil(Tsec / 0.12))
    for (let i = 1; i <= K; i++) {
      const u = i / K
      pushZ(fl.t0 + (fl.t1 - fl.t0) * u, arcZ(z0, z1, Tsec, u * Tsec))
    }
    const post = postFlightZ()
    if (fl.t1 < 1 - 1e-6) pushZ(fl.t1 + Math.min(0.02 / D, (1 - fl.t1) / 2), post)
  }
  ballZRaw.sort((a, b) => a.t - b.t)
  const ballZ: BallZKey[] = []
  for (const k of ballZRaw) {
    const last = ballZ[ballZ.length - 1]
    if (last && Math.abs(k.t - last.t) < 1e-7) ballZ[ballZ.length - 1] = k
    else ballZ.push(k)
  }
  if (!ballZ.length || ballZ[0].t > 0) ballZ.unshift({ t: 0, z: 0.15 })
  const endZ = flight && (puntPlay || koPlay) && touchback ? 0 : ballZ[ballZ.length - 1].z
  if (ballZ[ballZ.length - 1].t < 1) ballZ.push({ t: 1, z: endZ })

  // ── camera hint ────────────────────────────────────────────────────────────
  const skillRoles = new Set(['WR', 'TE', 'RB', 'FB', 'SLOT'])
  let low = 0
  let high = 0
  for (const k of keys) {
    if (sides[k] !== 'off' || !skillRoles.has(roles[k])) continue
    if (posAt(paths[k], SNAP_T).y < MID_Y) low++
    else high++
  }
  let deep = puntPlay || koPlay || fgPlay
  if (!deep) {
    for (const fl of anim.flights) {
      const p0 = posAt(anim.ball, fl.t0)
      const p1 = posAt(anim.ball, fl.t1)
      if (Math.hypot(p1.x - p0.x, p1.y - p0.y) > 20) { deep = true; break }
    }
  }
  const focusKey = finalHolder && keySet[finalHolder] ? finalHolder : targetKey
  const cameraKind: CameraHint['kind'] =
    koPlay ? 'kickoff'
      : puntPlay ? 'punt'
        : fgPlay ? 'kick'
          : type === 'penalty' ? 'penalty'
            : type === 'end' ? 'static'
              : 'scrimmage'
  const camera: CameraHint = {
    strongSide: low >= high ? 'low' : 'high',
    deep,
    focusKey,
    kind: cameraKind,
  }

  const skill = moves.length || Object.keys(tackleStyles).length
    ? { moves: moves.map((m) => ({ key: m.key, move: m.move, t: m.t, missed: m.missed })), tackles: tackleStyles }
    : undefined
  // animflow r8 (item c): the scorer runs on through the goal line after the whistle.
  let runOn: AnimPresentation['runOn']
  const scoreEv = events.find((e) => e.kind === 'score')
  if (scoreEv && keySet[scoreEv.keys[0]]) {
    const k = scoreEv.keys[0]
    const a = posAt(paths[k], Math.max(0, 1 - 0.1 / D))
    const b = posAt(paths[k], 1)
    const v = Math.hypot(b.x - a.x, b.y - a.y) / 0.1
    // (only a man who ends ON a goal line at speed: a run / catch TD already runs through and eases up)
    if (v >= 3 && Math.min(Math.abs(b.x - 10), Math.abs(b.x - 110)) < 1.5) runOn = { key: k, v, hx: (b.x - a.x) / (v * 0.1), hy: (b.y - a.y) / (v * 0.1) }
  }
  // Read visuals (qbReads.ts): QB head through the reads, eye jump, catch placement.
  return applyReadPresentation({ ...anim, poses, facing, ballZ, camera, ...(skill ? { skill } : {}), ...(runOn ? { runOn } : {}) }, play, ctx)
}

/** animflow r6b: left / right for a spin, from the play number. */
function hashSide(n: number, i: number): 1 | -1 {
  const x = Math.sin((n * 5.3 + i * 1.7) * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x) < 0.5 ? 1 : -1
}

// ── sampling helpers the renderer uses ────────────────────────────────────────
function animPath(a: BroadcastAnim, key: string): WP[] | undefined {
  return a.actors.find((x) => x.key === key)?.path
}

/** Wrapped direction of travel at t (finite); scans outward when standing still. */
function moveAngle(a: BroadcastAnim, key: string, t: number): number {
  const p = animPath(a, key)
  if (!p || p.length < 2) return 0
  for (const w of [1, 2, 4, 8]) {
    const h = 0.004 * w
    const lo = Math.max(0, t - h)
    const hi = Math.min(1, t + h)
    const pa = posAt(p, lo)
    const pb = posAt(p, hi)
    if (Math.abs(pb.x - pa.x) > 1e-6 || Math.abs(pb.y - pa.y) > 1e-6) return norm(Math.atan2(pb.y - pa.y, pb.x - pa.x))
  }
  const def = a.actors.find((x) => x.key === key)?.side === 'def'
  return def ? Math.PI : 0
}

function facingAngleAt(a: BroadcastAnim, key: string, w: FacingWindow, t: number): number {
  if (w.mode === 'angle') return norm(w.angle)
  if (w.mode === 'actor') {
    const p = posAt(animPath(a, key), t)
    const other = animPath(a, w.key)
    if (!other) return moveAngle(a, key, t)
    const q = posAt(other, t)
    const ang = Math.atan2(q.y - p.y, q.x - p.x)
    return Number.isFinite(ang) ? norm(ang) : moveAngle(a, key, t)
  }
  if (w.mode === 'spin') {
    const u = w.s1 > w.s0 ? clamp01((t - w.s0) / (w.s1 - w.s0)) : 1
    return norm(moveAngle(a, key, t) + w.dir * 2 * Math.PI * (u * u * (3 - 2 * u)))
  }
  if (w.mode === 'backpedal') {
    const p = animPath(a, key)
    if (!p || p.length < 2) return Math.PI
    const h = 0.008
    const pa = posAt(p, Math.max(0, t - h))
    const pb = posAt(p, Math.min(1, t + h))
    if (Math.abs(pb.x - pa.x) > 1e-6 || Math.abs(pb.y - pa.y) > 1e-6) {
      return norm(Math.atan2(-(pb.y - pa.y), -(pb.x - pa.x)))
    }
    return a.actors.find((x) => x.key === key)?.side === 'def' ? Math.PI : 0
  }
  return moveAngle(a, key, t)
}

/** The pose state for `key` at time t (0..1). */
export function poseAt(a: BroadcastAnim, key: string, t: number): PoseState {
  const ws = a.poses[key]
  if (!ws || !ws.length) return 'stand'
  for (let i = 0; i < ws.length; i++) if (t <= ws[i].t1 + 1e-6 || i === ws.length - 1) return ws[i].state
  return ws[ws.length - 1].state
}

/** The facing for `key` at time t, in radians (always finite). */
export function facingAt(a: BroadcastAnim, key: string, t: number): number {
  const ws = a.facing[key]
  if (!ws || !ws.length) return 0
  let w = ws[ws.length - 1]
  for (let i = 0; i < ws.length; i++) if (t <= ws[i].t1 + 1e-6 || i === ws.length - 1) { w = ws[i]; break }
  const ang = facingAngleAt(a, key, w, t)
  return Number.isFinite(ang) ? ang : 0
}

/** The ball's height above the turf (yards) at time t. */
export function ballZAt(a: BroadcastAnim, t: number): number {
  const k = a.ballZ
  if (!k || !k.length) return 0.15
  if (t <= k[0].t) return k[0].z
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i].t) {
      const A = k[i - 1]
      const B = k[i]
      const span = B.t - A.t
      const u = span <= 0 ? 1 : (t - A.t) / span
      return A.z + (B.z - A.z) * u
    }
  }
  return k[k.length - 1].z
}

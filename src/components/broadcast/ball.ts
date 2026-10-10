// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B4): the ball's state over play time. PURE — no DOM, no
// React, no canvas; importable from a node script.
//
//   const s = ballState(anim, t, { reducedMotion })
//   // { x, y (offense frame), z (yards), inFlight, kind, holder, spinPhase,
//   //   wobbleDeg, tumbleDeg }
//
// x/y are EXACTLY posAt(anim.ball, t). The height z comes from B1's ballZ curve
// outside flights and from our own single-peaked arc inside one (anchored to
// B1's release / catch heights so the arc carries the analysis the way B1
// recorded it). spin, wobble and tumble are pure functions of (anim, t, opts):
// scrubbing, replays and a frozen telestrator frame all look identical. The file
// is seeded only by a hash of the play — no RNG and no wall-clock reads.
// ─────────────────────────────────────────────────────────────────────────────

import type { BroadcastAnim } from './animData.ts'
import { ballZAt } from './animData.ts'
import { holderAt, posAt } from './interp.ts'

/** How the ball is being moved at a moment. */
export type BallKind = 'held' | 'pass' | 'spiralKick' | 'tumbleKick' | 'loose' | 'dead'

export interface BallState {
  /** Offense-frame position (= posAt(anim.ball, t)). */
  x: number
  y: number
  /** Height above the turf (yards). Never negative. */
  z: number
  /** Inside a B1 flight window (a throw or a kick). */
  inFlight: boolean
  kind: BallKind
  holder: string | null
  /** Spiral rotation, radians (advances only in flight; 0 otherwise). */
  spinPhase: number
  /** Lace-wobble amplitude in degrees (0 when not a pass, or under reduced motion). */
  wobbleDeg: number
  /** End-over-end rotation, radians (kicks and loose balls). */
  tumbleDeg: number
}

export interface BallOpts {
  /** Shake / wobble / tumble and trail off; the arc, shadow and marker stay. */
  reducedMotion?: boolean
  /** The thrower's ratings, when known (presentation only, from ctx/anim). */
  thrower?: { thp?: number; tha?: number }
  /** A hurried / pressured throw (bumps the wobble up to ~10°). */
  pressured?: boolean
}

const TAU = Math.PI * 2

// ── deterministic hash (no rng state anywhere) ───────────────────────────────

/** 32-bit integer hash of an integer stream. Deterministic, no state. */
export function hash32(a: number, b: number, c = 0): number {
  let h = (a | 0) ^ Math.imul(b | 0, 0x9e3779b1) ^ Math.imul(c | 0, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  h = (h ^ (h >>> 16)) >>> 0
  return h
}

/** A [0,1) draw from the hash. */
export function hash01(a: number, b: number, c = 0): number {
  return hash32(a, b, c) / 4294967296
}

/** A stable hash of a whole play (used to seed every effect — no RNG anywhere). */
export function playHash(anim: BroadcastAnim): number {
  let h = 2166136261 >>> 0
  const mix = (v: number) => {
    h ^= v | 0
    h = Math.imul(h, 16777619) >>> 0
  }
  mix(anim.duration | 0)
  for (const w of anim.ball ?? []) {
    mix(Math.round(w.x * 1024))
    mix(Math.round(w.y * 1024))
    mix(Math.round(w.t * 65536))
  }
  for (const e of anim.events ?? []) {
    mix(Math.round(e.t * 65536))
    mix(e.kind.length * 31 + e.kind.charCodeAt(0))
    mix(Math.round(e.spot.x * 64))
    mix(Math.round(e.spot.y * 64))
  }
  return h >>> 0
}

// ── flights ──────────────────────────────────────────────────────────────────

interface Flight {
  t0: number
  t1: number
  height: number
}

/** The first flight window containing t (throws and kicks), or null. */
function flightAt(anim: BroadcastAnim, t: number): Flight | null {
  for (const f of anim.flights ?? []) {
    if (f.t1 > f.t0 && t >= f.t0 - 1e-9 && t <= f.t1 + 1e-9) return f
  }
  return null
}

/** Peak of B1's ballZ inside [t0, t1]. */
function apexZ(anim: BroadcastAnim, t0: number, t1: number): number {
  let peak = Math.max(ballZAt(anim, t0), ballZAt(anim, t1))
  const n = 12
  for (let i = 1; i < n; i++) peak = Math.max(peak, ballZAt(anim, t0 + ((t1 - t0) * i) / n))
  return peak
}

/**
 * A single-peaked arc from z0 to z1. The lift is set so the apex matches B1's
 * own peak inside the flight; endpoints are exactly B1's release / catch
 * heights, so the arc carries the recorded analysis unchanged.
 */
function flightZ(anim: BroadcastAnim, f: Flight, t: number): number {
  if (f.t1 <= f.t0) return Math.max(0, ballZAt(anim, f.t1))
  const z0 = ballZAt(anim, f.t0)
  const z1 = ballZAt(anim, f.t1)
  const u = Math.min(1, Math.max(0, (t - f.t0) / (f.t1 - f.t0)))
  const chord = z0 + (z1 - z0) * u
  const apex = apexZ(anim, f.t0, f.t1)
  const lift = Math.max(0, apex - (z0 + z1) / 2)
  return Math.max(0, chord + lift * Math.sin(Math.PI * u))
}

// ── kind ─────────────────────────────────────────────────────────────────────

/** The carry band: a held ball is drawn here; outside it the ball is being thrown / kicked. */
export const CARRY_MIN = 0.8
export const CARRY_MAX = 1.6

/** A loose-ball window: after a fumble (or an onside-kick recovery), before it is downed. */
function looseWindow(anim: BroadcastAnim, D: number): { t0: number; t1: number } | null {
  const ev = anim.events ?? []
  for (const e of ev) {
    if (e.kind === 'fumble' || e.kind === 'turnover') {
      return { t0: e.t, t1: Math.min(1, e.t + 1.2 / D) }
    }
  }
  return null
}

/** Whether the play is a throw (a B1 throw event exists) rather than a run / kick. */
function hasThrow(anim: BroadcastAnim): boolean {
  for (const e of anim.events ?? []) if (e.kind === 'throw') return true
  return false
}

/** A ball in flight / being thrown / being kicked. */
function flightKind(anim: BroadcastAnim): BallKind {
  const ck = anim.camera?.kind
  if (ck === 'punt') return 'spiralKick'
  if (ck === 'kick' || ck === 'kickoff') return 'tumbleKick'
  return hasThrow(anim) ? 'pass' : 'loose'
}

function kindFor(anim: BroadcastAnim, t: number, flight: Flight | null, holder: string | null, loose: { t0: number; t1: number } | null): BallKind {
  if (flight) return flightKind(anim)
  if (holder) {
    // Held in the carry band is a "held" ball; above / below it the ball is on
    // its way out of the hand (the throw wind-up, the kick) — the flight kind.
    const bz = ballZAt(anim, t)
    if (bz >= CARRY_MIN && bz <= CARRY_MAX) return 'held'
    return flightKind(anim)
  }
  if (loose && t >= loose.t0 && t <= loose.t1) return 'loose'
  return 'dead'
}

// ── the public state ─────────────────────────────────────────────────────────

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Tumble rate for an end-over-end kick (rev/s), 1.5–3.5, deterministic per play. */
function tumbleRev(seed: number): number {
  return 1.5 + 2 * hash01(seed, 0x51, 7)
}

/**
 * The ball's state at play time t (0..1 of the animation).
 * Deterministic and continuous in t; never returns NaN/undefined.
 */
export function ballState(anim: BroadcastAnim, t: number, opts: BallOpts = {}): BallState {
  const tc = clamp01(t)
  const D = Math.max(0.05, (anim.duration || 0) / 1000)
  const p = posAt(anim.ball, tc)
  const holder = holderAt(anim.holders, tc)
  const flight = flightAt(anim, tc)
  const loose = looseWindow(anim, D)
  const kind = kindFor(anim, tc, flight, holder, loose)
  const seed = playHash(anim)

  let z: number
  if (flight) z = flightZ(anim, flight, tc)
  else if (kind === 'loose' && loose) {
    // A loose ball bounces, decaying to rest on the turf.
    const age = Math.max(0, (tc - loose.t0) * D)
    const bounce = 0.18 * Math.exp(-age * 2) * Math.abs(Math.sin(age * 12))
    z = Math.max(0.15, ballZAt(anim, tc)) + bounce
  } else z = ballZAt(anim, tc)
  if (!Number.isFinite(z) || z < 0) z = 0.15

  // Spin: spirals advance only while a pass or punt is in flight, then freeze.
  let spinPhase = 0
  let tumbleDeg = 0
  if (flight && (kind === 'pass' || kind === 'spiralKick')) {
    const rev = kind === 'pass' ? 2.6 : 1.5
    const elapsed = (Math.min(tc, flight.t1) - flight.t0) * D
    spinPhase = TAU * rev * Math.max(0, elapsed)
  }
  if (flight && kind === 'tumbleKick') {
    const rev = tumbleRev(seed)
    const elapsed = (Math.min(tc, flight.t1) - flight.t0) * D
    tumbleDeg = TAU * rev * Math.max(0, elapsed)
  } else if (kind === 'loose' && loose) {
    // A loose ball rolls and tumbles on the turf, slower.
    tumbleDeg = TAU * 1.8 * Math.max(0, (tc - loose.t0) * D)
  }

  // Wobble: tight for clean throws; up to ~10° for a hurried / low-accuracy throw.
  let wobbleDeg = 0
  if (!opts.reducedMotion && flight && kind === 'pass') {
    let w = 1.5 + 4 * hash01(seed, 0x77, 11)
    if (opts.pressured) w += 2 + 2 * hash01(seed, 0x77, 12)
    const tha = opts.thrower?.tha
    if (tha != null && Number.isFinite(tha)) w += Math.max(0, (75 - tha) / 8)
    wobbleDeg = Math.min(10, Math.max(0, w))
  } else if (!opts.reducedMotion && flight && kind === 'spiralKick') {
    wobbleDeg = 1 + 2 * hash01(seed, 0x88, 13)
  }

  return { x: p.x, y: p.y, z, inFlight: !!flight, kind, holder, spinPhase, wobbleDeg, tumbleDeg }
}

// ── shadow ───────────────────────────────────────────────────────────────────

export interface BallShadow {
  /** Ground ellipse radius (yards). */
  radius: number
  alpha: number
  /** Ground offset along the fixed light direction, scaled by height. */
  offset: { x: number; y: number }
}

/** Light direction for the shadow offset (matches figures.ts LIGHT). */
export const BALL_LIGHT: [number, number] = [-0.55, -0.6]

/**
 * The ball's ground shadow: strictly shrinking and fading as z rises.
 * radius 0.22 → 0.09 yd, alpha 0.5 → 0.18 (monotone for z ≥ 0).
 */
export function ballShadow(z: number): BallShadow {
  const zz = Number.isFinite(z) && z > 0 ? z : 0
  const radius = 0.09 + 0.13 * Math.exp(-zz / 6)
  const alpha = 0.18 + 0.32 * Math.exp(-zz / 7)
  const off = 0.12 * zz
  return { radius, alpha, offset: { x: BALL_LIGHT[0] * off, y: BALL_LIGHT[1] * off } }
}

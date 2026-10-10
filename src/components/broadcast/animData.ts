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
interface InB1aInput { engagements?: InEngagement[]; events?: InEvent[] }

// ── public shapes (the renderer, B3/B4/B5, consumes these) ───────────────────
export type PoseState =
  | 'stance3' | 'stance2' | 'stand' | 'run' | 'pedal' | 'block' | 'fake' | 'throw'
  | 'catch' | 'carry' | 'stumble' | 'dive' | 'fall' | 'down' | 'kick' | 'hold'

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
    if (type === 'pass') return inc ? { z0: 2.0, z1: 0.2 } : { z0: 2.0, z1: 1.4 }
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
    type === 'pass' && !sackPlay && flight ? { t0: Math.max(0, flight.t0 - 0.25 / D), t1: flight.t0 } : null

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
  if (carrierKey && (play.missedTackleIds?.length ?? 0) > 0) {
    const stop = lastT(carrierKey)
    let c = carrierStartT + 0.65 * Math.max(0, stop - carrierStartT)
    const ev = events.find((e) => e.kind === 'brokenTackle')
    if (ev) c = ev.t
    stumbleBy[carrierKey] = { t0: Math.max(0, c - 0.15 / D), t1: Math.min(1, c + 0.15 / D) }
  }

  const diveBy: Record<string, { t0: number; t1: number }> = {}
  const fallBy: Record<string, { t0: number; t1: number }> = {}
  const downBy: Record<string, { t0: number; t1: number }> = {}
  const tackleT = carrierKey && tackled ? Math.min(lastT(carrierKey), 1 - 1e-4) : null
  if (tackleT != null && carrierKey) {
    const fs = Math.max(0, tackleT - 0.15 / D)
    if (tackleT - fs > 1e-6) fallBy[carrierKey] = { t0: fs, t1: tackleT }
    downBy[carrierKey] = { t0: tackleT, t1: 1 }
    const tk = keyForId(play.tackleIds?.[0]) ?? keyForId(play.sackId) ??
      nearestOf(keys.filter((k) => sides[k] === 'def'), posAt(paths[carrierKey], tackleT), tackleT)
    if (tk && tk !== carrierKey) {
      diveBy[tk] = { t0: Math.max(0, tackleT - 0.25 / D), t1: tackleT }
      downBy[tk] = { t0: tackleT, t1: 1 }
    }
  }

  const kickWin: { t0: number; t1: number } | null = !flight
    ? null
    : fgPlay || puntPlay
      ? { t0: kickT, t1: 1 }
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

  // ── per-t state ────────────────────────────────────────────────────────────
  const preSnap = (k: string): PoseState => {
    if (k === fgHolderKey) return 'hold'
    if (k === returnerKey) return 'stand'
    if (kickerKey && k === kickerKey && (fgPlay || puntPlay)) return 'stand'
    if (k.startsWith('ol') || k.startsWith('dl')) return 'stance3'
    if (k === 'qb') return 'stand'
    return 'stance2'
  }

  const stateFor = (k: string, t: number, vx: number, spd: number, hKey: string | null, nearCar: boolean): PoseState => {
    if (kickerKey && k === kickerKey && kickWin && t >= kickWin.t0 - 1e-9) return 'kick'
    if (k === fgHolderKey && t < kickT) return 'hold'
    if (qbKey && k === qbKey && throwWin && t >= throwWin.t0 && t <= throwWin.t1) return 'throw'
    if (qbKey && k === qbKey && fakeWin && t >= fakeWin.t0 && t <= fakeWin.t1) return 'fake'
    const cw = catchBy[k]
    if (cw && t >= cw.t0 && t <= cw.t1) return 'catch'
    const sw = stumbleBy[k]
    if (sw && t >= sw.t0 && t <= sw.t1) return 'stumble'
    const dw = diveBy[k]
    if (dw && t >= dw.t0 && t <= dw.t1) return 'dive'
    const fw = fallBy[k]
    if (fw && t >= fw.t0 && t <= fw.t1) return 'fall'
    const dn = downBy[k]
    if (dn && t >= dn.t0) return 'down'
    if (t < SNAP_T) return preSnap(k)
    if (hKey === k) {
      if (roles[k] === 'H') return 'hold'
      if (k === 'qb') return spd > RUN_SPEED ? 'run' : 'stand'
      return 'carry'
    }
    if (blockOther(k, t)) return 'block'
    if (k === returnerKey && flight && t < flight.t1) return 'stand'
    if (spd > RUN_SPEED) {
      if (sides[k] === 'def' && vx > 0.2 && !nearCar) return 'pedal'
      return 'run'
    }
    return 'stand'
  }

  type FMode =
    | { mode: 'move' }
    | { mode: 'angle'; angle: number }
    | { mode: 'actor'; key: string }
    | { mode: 'backpedal' }

  const facingFor = (k: string, t: number, st: PoseState, hKey: string | null, pos: Pt, hPos: Pt | null, nearCar: boolean): FMode => {
    if (kickerKey && k === kickerKey && kickDir != null && (st === 'kick' || fgPlay || puntPlay)) {
      return { mode: 'angle', angle: kickDir }
    }
    if (k === fgHolderKey && kickDir != null && (st === 'hold' || t < kickT)) return { mode: 'angle', angle: kickDir }
    if (k === returnerKey && flight && t < flight.t1) {
      const a = Math.atan2(ballAtCatch.y - pos.y, ballAtCatch.x - pos.x)
      return { mode: 'angle', angle: Number.isFinite(a) ? a : 0 }
    }
    if (st === 'pedal') return { mode: 'backpedal' }
    const bo = blockOther(k, t)
    if (bo) return { mode: 'actor', key: bo }
    if (qbKey && k === qbKey && throwWin && targetKey && keySet[targetKey] && targetKey !== k &&
      t >= throwWin.t0 - 0.4 / D && t <= throwWin.t1) {
      return { mode: 'actor', key: targetKey }
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
  if (fakeWin) { addCut(fakeWin.t0); addCut(fakeWin.t1) }
  if (kickWin) { addCut(kickWin.t0); addCut(kickWin.t1) }
  if (flight) { addCut(flight.t0); addCut(flight.t1) }
  for (const m of [catchBy, stumbleBy, diveBy, fallBy]) {
    for (const k of Object.keys(m)) { addCut(m[k].t0); addCut(m[k].t1) }
  }
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
      const w = { t0: a, t1: b, ...facingFor(k, mid, st, hKey, pk[i], hPos, nearCar) } as FacingWindow
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
  const fh = flightHeights()
  for (let fi = 0; fi < anim.flights.length; fi++) {
    const fl = anim.flights[fi]
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

  return { ...anim, poses, facing, ballZ, camera }
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

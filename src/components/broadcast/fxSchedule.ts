// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B4): the effect schedule. PURE — no DOM, no React, no canvas.
//
//   const sched = buildFxSchedule(anim, { reducedMotion, quality })
//   const off   = shakeAt(sched, t)          // world offset (0,0,0 most frames)
//   const bits  = fxParticles(anim, item, t, quality)
//
// EVERY effect is sourced from a B1 event (anim.events) — there are no orphan
// effects: each FxItem carries `sourceEvent`, the index of the beat it came
// from, and its t0 equals that event's time. Everything is a pure function of
// (anim, t, opts): no per-frame accumulated state, so scrubbing, replays and a
// frozen telestrator frame look identical. Seeded only by a hash of the play —
// no RNG and no wall-clock reads.
// ─────────────────────────────────────────────────────────────────────────────

import type { AnimEvent, AnimEventKind } from '../playAnim'
import type { BroadcastAnim } from './animData.ts'
import { ballZAt } from './animData.ts'
import { hash01, hash32, playHash } from './ball.ts'
import { posAt } from './interp.ts'
import type { CameraPose } from './camera.ts'

export type FxKind =
  | 'sparkle' // catch / interception
  | 'burst' // broken tackle (spokes + ground ring)
  | 'impact' // tackle / contact / safety (ring + turf bits)
  | 'turnover' // give-away (ring + turf burst)
  | 'turf' // a few bits (hard cut)
  | 'puff' // incomplete landing / kick divot
  | 'celebration' // touchdown confetti
  | 'sweep' // goal-line light sweep
  | 'pylon' // pylon flash
  | 'glint' // FG / PAT crossbar glints
  | 'marker' // reduced-motion fixed ring
  | 'shake' // camera shake

export type FxTeam = 'off' | 'def' | 'neutral'
export type FxQuality = 'full' | 'lite'

export interface FxPoint {
  x: number
  y: number
  z: number
}

export interface FxZone {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface FxItem {
  kind: FxKind
  /** Anim-normalised start / end (t0 = anim.events[sourceEvent].t). */
  t0: number
  t1: number
  /** Index into anim.events — always valid (no orphans). */
  sourceEvent: number
  team: FxTeam
  /** 0..1. */
  intensity: number
  /** Radiates / grows (never under reduced motion). */
  expanding: boolean
  anchor: FxPoint
  /** Offense-frame box a confetti cloud is confined to (celebration only). */
  zone?: FxZone
  /** Particle budget for this effect (full; capped again for lite). */
  count: number
  seed: number
}

export interface FxOpts {
  reducedMotion: boolean
  quality: FxQuality
}

/**
 * The B4 effect mapping, one entry per B1 event kind: either the effects it
 * drives or an explicit, reasoned ignore. `Record<AnimEventKind, …>` means the
 * TypeScript build fails the moment B1 adds an event kind without a decision.
 * `check-broadcast.ts` also proves no map drift: a synthetic event of each 'fx'
 * kind really emits one of the listed kinds, and an 'ignore' emits nothing.
 */
export type FxEventRule =
  | { use: 'fx'; kinds: readonly FxKind[]; note: string }
  | { use: 'ignore'; why: string }

export const EVENT_FX: Record<AnimEventKind, FxEventRule> = {
  snap: { use: 'ignore', why: 'The snap lob is carried by the ball state (a short arc), not an impact effect.' },
  playAction: { use: 'ignore', why: 'A fake: no turf effect; the pose window and the graphics carry it.' },
  scramble: { use: 'ignore', why: 'QB movement with the ball held; no impact beat to mark.' },
  break: { use: 'ignore', why: 'A route break, not a collision; a real hard cut already emits turf bits.' },
  throw: { use: 'ignore', why: 'Release: the flight arc and dashed landing marker carry it.' },
  catch: { use: 'fx', kinds: ['sparkle'], note: 'Catch sparkle ring + 4 glints at the B1 catch height.' },
  incomplete: { use: 'fx', kinds: ['puff'], note: 'A small turf puff where the ball lands.' },
  interception: { use: 'fx', kinds: ['sparkle', 'turnover'], note: 'Defence-coloured sparkle and a turnover ring + turf burst.' },
  brokenTackle: { use: 'fx', kinds: ['burst'], note: 'A 12-spoke burst + an expanding ground ring.' },
  contact: { use: 'fx', kinds: ['impact'], note: 'A small impact ring on the ball carrier.' },
  tackle: { use: 'fx', kinds: ['impact'], note: 'An impact ring + turf bits at the pile (+ shake on a big hit).' },
  sack: { use: 'fx', kinds: ['impact'], note: 'An impact ring and a camera shake.' },
  outOfBounds: { use: 'ignore', why: 'Terminal, but going out of bounds is not a hit; no ring.' },
  down: { use: 'ignore', why: 'Terminal dead-ball beat; the tackle / out-of-bounds already marked it.' },
  firstDown: { use: 'ignore', why: 'A first down is a B6 graphics toast, not a turf effect.' },
  score: { use: 'fx', kinds: ['celebration', 'sweep', 'pylon'], note: 'TD confetti in the scoring end zone, a goal-line sweep and a pylon flash.' },
  safety: { use: 'fx', kinds: ['impact'], note: "A safety's impact ring only." },
  turnover: { use: 'fx', kinds: ['turnover'], note: 'A turf burst + ground ring.' },
  fumble: { use: 'fx', kinds: ['turnover'], note: 'The loose ball: a ring + turf burst.' },
  kick: { use: 'fx', kinds: ['puff'], note: 'A turf divot puff at the kick contact.' },
  fairCatch: { use: 'ignore', why: 'A clean catch is signalled by the graphics; no turf effect.' },
  touchback: { use: 'ignore', why: 'Terminal, with no contact to mark.' },
  kickGood: { use: 'fx', kinds: ['glint'], note: 'Glints along the crossbar (no confetti).' },
  kickMiss: { use: 'ignore', why: 'A miss has no made-kick beat; the result toast covers it.' },
  flag: { use: 'ignore', why: 'A penalty flag is a B6 callout; no turf effect.' },
}

// ── helpers ──────────────────────────────────────────────────────────────────

const TAU = Math.PI * 2
const GRAVITY = 9.8
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/** Carrier (ball-path) speed in yd/s at play time t. */
function speedAt(anim: BroadcastAnim, t: number, D: number): number {
  const h = 0.02
  const lo = Math.max(0, t - h)
  const hi = Math.min(1, t + h)
  const a = posAt(anim.ball, lo)
  const b = posAt(anim.ball, hi)
  const dt = (hi - lo) * D
  return dt > 0 ? Math.hypot(b.x - a.x, b.y - a.y) / dt : 0
}

/** Defenders within `near` yards of (x, y) at play time t. */
function defendersAt(anim: BroadcastAnim, t: number, x: number, y: number, near: number): number {
  let n = 0
  for (const a of anim.actors ?? []) {
    if (a.side !== 'def') continue
    const p = posAt(a.path, t)
    if (Math.hypot(p.x - x, p.y - y) <= near) n++
  }
  return n
}

/** Hard cuts on the carrier's path: > 60° heading change at > 5 yd/s. */
function hardCuts(anim: BroadcastAnim, D: number): { t: number; x: number; y: number }[] {
  const path = anim.ball
  if (!path || path.length < 3) return []
  const out: { t: number; x: number; y: number }[] = []
  const n = Math.max(10, Math.ceil(D / 0.05))
  for (let i = 1; i < n; i++) {
    const t = i / n
    const pre = posAt(path, Math.max(0, t - 0.12))
    const cur = posAt(path, t)
    const post = posAt(path, Math.min(1, t + 0.12))
    const spd = Math.hypot(post.x - pre.x, post.y - pre.y) / 0.24
    if (spd <= 5) continue
    const vin = Math.atan2(cur.y - pre.y, cur.x - pre.x)
    const vout = Math.atan2(post.y - cur.y, post.x - cur.x)
    let d = vout - vin
    while (d > Math.PI) d -= TAU
    while (d < -Math.PI) d += TAU
    if (Math.abs(d) > Math.PI / 3) out.push({ t, x: cur.x, y: cur.y })
  }
  const kept: typeof out = []
  for (const c of out) if (!kept.length || c.t - kept[kept.length - 1].t > 0.15) kept.push(c)
  return kept
}

// ── the schedule ─────────────────────────────────────────────────────────────

/** Carrier speed (yd/s) at contact that qualifies a big hit for a shake. */
export const SHAKE_SPEED = 6
/** Defenders within 1.5 yd of the tackle that make it a gang tackle (a shake). */
export const SHAKE_GANG = 9

/** Shake amplitude (yards); the composer/probe keep the projected shift tiny. */
export const SHAKE_YARDS = 0.075
/** Shake duration in play-time seconds. */
export const SHAKE_SEC = 0.28

export function buildFxSchedule(anim: BroadcastAnim, opts: FxOpts): FxItem[] {
  const D = Math.max(0.05, (anim.duration || 0) / 1000)
  const rm = !!opts.reducedMotion
  const lite = opts.quality === 'lite'
  const ev: AnimEvent[] = anim.events ?? []
  const seed = playHash(anim)
  const items: FxItem[] = []
  const sec = (s: number) => s / D
  const cap = (n: number) => (lite ? Math.min(n, Math.max(1, Math.ceil(n * 0.4))) : n)

  const mk = (kind: FxKind, i: number, e: AnimEvent, durSec: number, extra: Partial<FxItem> = {}): FxItem => ({
    kind,
    t0: e.t,
    t1: e.t + sec(durSec),
    sourceEvent: i,
    team: 'off',
    intensity: 0.6,
    expanding: !rm,
    anchor: { x: e.spot.x, y: e.spot.y, z: 0 },
    count: 0,
    seed: hash32(seed, i * 31 + kind.length),
    ...extra,
  })

  let shakeDone = false
  const shake = (i: number, e: AnimEvent, amp: number) => {
    if (rm || shakeDone) return
    shakeDone = true
    items.push({
      kind: 'shake',
      t0: e.t,
      t1: e.t + sec(SHAKE_SEC),
      sourceEvent: i,
      team: 'neutral',
      intensity: amp,
      expanding: false,
      anchor: { x: e.spot.x, y: e.spot.y, z: 0 },
      count: 0,
      seed: hash32(seed, i * 7 + 3),
    })
  }

  let lastIntT = -1 // an interception already emitted the turnover beat
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i]
    switch (e.kind) {
      case 'catch':
        items.push(
          rm
            ? mk('marker', i, e, 0.3, { anchor: { x: e.spot.x, y: e.spot.y, z: ballZAt(anim, e.t) } })
            : mk('sparkle', i, e, 0.28, { anchor: { x: e.spot.x, y: e.spot.y, z: ballZAt(anim, e.t) }, intensity: 0.7 }),
        )
        break
      case 'interception':
        lastIntT = e.t
        if (rm) items.push(mk('marker', i, e, 0.3, { team: 'def', anchor: { x: e.spot.x, y: e.spot.y, z: ballZAt(anim, e.t) } }))
        else {
          items.push(mk('sparkle', i, e, 0.28, { team: 'def', intensity: 0.9, anchor: { x: e.spot.x, y: e.spot.y, z: ballZAt(anim, e.t) } }))
          items.push(mk('turnover', i, e, 0.5, { team: 'def', intensity: 0.9, count: cap(32) }))
        }
        break
      case 'brokenTackle':
        lastIntT = -1
        items.push(rm ? mk('marker', i, e, 0.3) : mk('burst', i, e, 0.45, { intensity: 0.85, count: 12 }))
        break
      case 'contact':
        if (!rm) items.push(mk('impact', i, e, 0.3, { intensity: 0.35, count: 0 }))
        break
      case 'tackle': {
        const gang = defendersAt(anim, e.t, e.spot.x, e.spot.y, 1.5)
        const spd = speedAt(anim, e.t, D)
        if (rm) items.push(mk('marker', i, e, 0.3))
        else items.push(mk('impact', i, e, 0.55, { intensity: clamp(0.5 + gang * 0.15, 0, 1), count: cap(28) }))
        if (gang >= SHAKE_GANG || spd >= SHAKE_SPEED) shake(i, e, SHAKE_YARDS)
        break
      }
      case 'sack':
        items.push(rm ? mk('marker', i, e, 0.3) : mk('impact', i, e, 0.55, { intensity: 0.9, count: cap(24) }))
        shake(i, e, SHAKE_YARDS)
        break
      case 'fumble':
        items.push(rm ? mk('marker', i, e, 0.3) : mk('turnover', i, e, 0.5, { intensity: 0.9, count: cap(32) }))
        shake(i, e, SHAKE_YARDS * 1.2)
        break
      case 'turnover':
        if (lastIntT >= 0 && Math.abs(e.t - lastIntT) < 0.15) break
        lastIntT = -1
        items.push(rm ? mk('marker', i, e, 0.3) : mk('turnover', i, e, 0.5, { intensity: 0.9, count: cap(32) }))
        shake(i, e, SHAKE_YARDS)
        break
      case 'incomplete':
        items.push(rm ? mk('marker', i, e, 0.3) : mk('puff', i, e, 0.3, { intensity: 0.4, count: cap(14) }))
        break
      case 'kick':
        items.push(rm ? mk('marker', i, e, 0.3) : mk('puff', i, e, 0.25, { intensity: 0.35, count: cap(10) }))
        break
      case 'safety':
        items.push(rm ? mk('marker', i, e, 0.3) : mk('impact', i, e, 0.55, { intensity: 0.8, count: 0 }))
        break
      case 'score': {
        const sx = clamp(e.spot.x, 107, 120)
        const sy = clamp(e.spot.y, 0, 53.3)
        if (rm) {
          items.push(mk('marker', i, e, 0.3, { anchor: { x: sx, y: sy, z: 1 } }))
          break
        }
        items.push({
          ...mk('celebration', i, e, 1.4),
          intensity: 1,
          expanding: true,
          anchor: { x: sx, y: sy, z: 1 },
          zone: { x0: 107, y0: 0, x1: 120, y1: 53.3 },
          count: cap(40),
        })
        items.push({ ...mk('sweep', i, e, 0.8), intensity: 0.9, expanding: false, anchor: { x: 110, y: sy, z: 0 } })
        const nearPylon = Math.hypot(e.spot.x - 110, e.spot.y - 0) < 2 || Math.hypot(e.spot.x - 110, e.spot.y - 53.3) < 2
        if (nearPylon) {
          const pyl = e.spot.y < 26.65 ? { x: 110, y: 0 } : { x: 110, y: 53.3 }
          items.push({ ...mk('pylon', i, e, 0.35), intensity: 1, expanding: false, anchor: { x: pyl.x, y: pyl.y, z: 1 } })
        }
        break
      }
      case 'kickGood':
        items.push(
          rm
            ? mk('marker', i, e, 0.3, { anchor: { x: 110, y: 26.65, z: 3.3 } })
            : mk('glint', i, e, 0.7, { intensity: 0.9, count: cap(6), anchor: { x: 110, y: 26.65, z: 3.33 } }),
        )
        break
      default:
        break
    }
  }

  // A hard cut on the carrier's path: a few bits, attributed to the nearest beat.
  if (!rm && ev.length) {
    const cuts = hardCuts(anim, D)
    if (cuts.length) {
      const c = cuts[0]
      let best = 0
      let bd = Infinity
      for (let i = 0; i < ev.length; i++) {
        const d = Math.abs(ev[i].t - c.t)
        if (d < bd) {
          bd = d
          best = i
        }
      }
      if (bd * D <= 0.8) {
        const e = ev[best]
        items.push({
          kind: 'turf',
          t0: e.t,
          t1: e.t + sec(0.35),
          sourceEvent: best,
          team: 'neutral',
          intensity: 0.4,
          expanding: false,
          anchor: { x: c.x, y: c.y, z: 0 },
          count: cap(8),
          seed: hash32(seed, 0x59),
        })
      }
    }
  }

  items.sort((a, b) => a.t0 - b.t0 || a.kind.localeCompare(b.kind))
  return items
}

// ── shake ────────────────────────────────────────────────────────────────────

export interface ShakeOffset {
  x: number
  y: number
  z: number
}

/** The world offset to move the camera by at play time t (0,0,0 outside a shake). */
export function shakeAt(schedule: FxItem[], t: number): ShakeOffset {
  for (const it of schedule) {
    if (it.kind !== 'shake') continue
    if (t < it.t0 || t > it.t1) continue
    const span = it.t1 - it.t0
    const u = span <= 0 ? 1 : (t - it.t0) / span
    const env = (1 - u) * (1 - u) // damped, 0 at both ends
    const dir = it.seed & 1 ? 1 : -1
    const a = it.intensity
    return {
      x: dir * a * env * Math.sin(u * Math.PI * 4),
      y: a * env * Math.sin(u * Math.PI * 4 + 1.2) * 0.6,
      z: 0,
    }
  }
  return { x: 0, y: 0, z: 0 }
}

/** Move a camera pose's position and target together by a shake offset. */
export function shakePose(pose: CameraPose, off: ShakeOffset): CameraPose {
  if (off.x === 0 && off.y === 0 && off.z === 0) return pose
  return {
    pos: [pose.pos[0] + off.x, pose.pos[1] + off.y, pose.pos[2] + off.z],
    target: [pose.target[0] + off.x, pose.target[1] + off.y, pose.target[2] + off.z],
    fovDeg: pose.fovDeg,
  }
}

// ── particles (pure kinematics; the drawing module renders these) ────────────

export interface FxParticle {
  x: number
  y: number
  z: number
  /** Screen size scale (yards-ish; the draw multiplies by px/yard). */
  size: number
  alpha: number
  /** Roll angle (radians). */
  spin: number
  /** Which neutral shade to use (index into the draw module's palette). */
  shade: number
}

interface PSpec {
  vx: number
  vy: number
  vz: number
  z0: number
  delay: number
  size: number
  spin: number
  shade: number
}

function mulberry(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TURF: PSpec[] = (() => {
  const r = mulberry(0x7a11)
  const a: PSpec[] = []
  for (let i = 0; i < 40; i++) {
    const ang = r() * TAU
    const spd = 1.2 + r() * 3.4
    a.push({
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd * 0.7,
      vz: 1.8 + r() * 3.4,
      z0: 0,
      delay: r() * 0.06,
      size: 0.5 + r() * 0.7,
      spin: 0,
      shade: r() < 0.6 ? 0 : r() < 0.5 ? 1 : 2,
    })
  }
  return a
})()

const CONF: PSpec[] = (() => {
  const r = mulberry(0x60f7)
  const a: PSpec[] = []
  for (let i = 0; i < 48; i++) {
    a.push({
      vx: (r() - 0.5) * 1.6,
      vy: (r() - 0.5) * 0.9,
      vz: 0.9 + r() * 1.5,
      z0: 4 + r() * 6,
      delay: r() * 0.35,
      size: 0.5 + r() * 0.6,
      spin: (r() - 0.5) * 8,
      shade: i % 3,
    })
  }
  return a
})()

/** Live particles for one effect at play time t (empty outside its window). */
export function fxParticles(anim: BroadcastAnim, item: FxItem, t: number, quality: FxQuality): FxParticle[] {
  if (item.count <= 0) return []
  const D = Math.max(0.05, (anim.duration || 0) / 1000)
  const age = (t - item.t0) * D
  if (age < 0) return []
  const span = Math.max(0.2, (item.t1 - item.t0) * D)
  const life = item.kind === 'celebration' ? span + 0.6 : span
  if (age > life) return []
  const lite = quality === 'lite'
  const table = item.kind === 'celebration' ? CONF : TURF
  const n = Math.min(item.count, table.length)
  const out: FxParticle[] = []
  for (let i = 0; i < n; i++) {
    if (lite && i % 2 === 1) continue
    const p = table[i % table.length]
    const aa = age - p.delay
    if (aa < 0) continue
    const fade = clamp(1 - age / life, 0, 1)
    if (item.kind === 'celebration') {
      const z = p.z0 - p.vz * aa
      if (z < 0) continue
      const zone = item.zone ?? { x0: item.anchor.x, y0: item.anchor.y, x1: item.anchor.x, y1: item.anchor.y }
      const x = clamp(item.anchor.x + p.vx * aa + Math.sin(aa * 6 + i) * 0.3, zone.x0, zone.x1)
      const y = clamp(item.anchor.y + p.vy * aa, zone.y0, zone.y1)
      out.push({ x, y, z, size: p.size, alpha: fade, spin: p.spin * aa, shade: p.shade })
    } else {
      const z = p.z0 + p.vz * aa - 0.5 * GRAVITY * aa * aa
      if (z < 0) continue
      const x = item.anchor.x + p.vx * aa
      const y = item.anchor.y + p.vy * aa
      out.push({ x, y, z, size: p.size, alpha: fade, spin: 0, shade: p.shade })
    }
  }
  return out
}

/** How long after the animation's end the effects run, in milliseconds (≤ 1600). */
export function fxTailMs(anim: BroadcastAnim, schedule?: FxItem[]): number {
  const D = Math.max(0.05, (anim.duration || 0) / 1000)
  const s = schedule ?? buildFxSchedule(anim, { reducedMotion: false, quality: 'full' })
  let tail = 0
  for (const it of s) tail = Math.max(tail, (it.t1 - 1) * D * 1000)
  return Math.max(0, tail)
}

/** The number of live particles across a schedule at t (for the cost probe). */
export function liveParticles(anim: BroadcastAnim, schedule: FxItem[], t: number, quality: FxQuality): number {
  let n = 0
  for (const it of schedule) if (it.count > 0) n += fxParticles(anim, it, t, quality).length
  return n
}

// Deterministic per-play intensity used for a few cosmetic spreads.
export function fxJitter(seed: number, i: number): number {
  return hash01(seed, i, 0x1f)
}

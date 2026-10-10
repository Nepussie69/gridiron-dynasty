// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B5a / part 1 of 2) — the camera director.
//
// Public director API + the base framing rules (formation, strong-side drift,
// ball follow with a critically damped spring, contact tighten, containment).
// B5b plugs its special rules in through `rules: DirectorRule[]`; B8 wires the
// director into the renderer / MatchView (this module owns no DOM and no React,
// so it is importable from a plain node script).
//
// FRAME. Everything here is in playAnim's offence frame (x 0..120, own goal at
// 10, attacking +x; y 0..53.3) — the same numbers B1's positions, events and
// engagements live in. A Shot is a framing, not a place: `toCamera` turns it
// into B2's CameraPose with the rig below. When the offence attacks −x in the
// world, the caller (B8) mirrors the whole pose with camera.ts's
// offenseToWorld — framing is invariant under that 180° turn.
//
// DETERMINISM. `reset` integrates the camera at fixed 1/60 s steps in PLAY
// seconds from t = 0 to 1 and stores the track; `shotAt(t)` interpolates it.
// Nothing depends on wall-clock or playback speed, so the same play + anim give
// a byte-identical track (framing is identical at 1×, 2×, scrubbing, replay).
// This module reads B1's fields only; it never touches the sim, rng or saves.
// ─────────────────────────────────────────────────────────────────────────────
import { FIELD_H, MID_Y, holderAt, posAt, snapYard, type AnimEvent, type PlayAnim } from '../playAnim'
import { ballZAt, type BroadcastAnim } from './animData'
import { makeCamera, orbitPose, project, type CameraPose, type Viewport } from './camera.ts'
import type { Play } from '../../game/engine/playsim'
import {
  boundsOf,
  clamp,
  clamp01,
  containShot,
  leadPoint,
  lerp,
  limitAccel,
  limitRatio,
  smoothDamp,
  type ContainOpts,
  type Pt2,
  type Pt3,
} from './directorMath.ts'

// ── per-frame limits (1/60 s frame at 1×). The track must never exceed these. ─
/** Max pan per axis per frame (yards). */
export const MAX_PAN_YD_PER_FRAME = 1.0
/** Max relative span change per frame. */
export const MAX_SPAN_RATIO_PER_FRAME = 0.03
/** Max pan-velocity change per frame (yards/frame²). */
export const MAX_PAN_ACCEL_YD = 0.12

const FRAME_SEC = 1 / 60
const SNAP_FALLBACK_SEC = 0.14
const OMEGA_CENTER = 5 // rad/s, the centre spring
const OMEGA_SPAN = 2.5 // rad/s, the slower span spring
const SAFE_INSET = 0.06 // 6% each side, incl. the top for the ball's height

export type PlayKind =
  | 'pass' | 'run' | 'sack' | 'scramble' | 'kickoff' | 'punt' | 'fg' | 'pat'
  | 'kneel' | 'spike' | 'penalty' | 'other'

/** A framing in offence-frame yards. `span` = visible field width at the focus. */
export interface Shot {
  cx: number
  cy: number
  span: number
  /** Camera height (yards); mapped to B2's orbit `height`. */
  z?: number
  /** Camera tilt (unused: B2 derives tilt from height vs back). */
  pitch?: number
  /** Camera heading (radians); mapped to B2's orbit `yaw`. */
  yaw?: number
}

export interface ShotContext {
  play: Play
  anim: PlayAnim
  kind: PlayKind
  /** Normalised play time 0..1. */
  t: number
  /** Play seconds (t × duration). */
  sec: number
  /** Line of scrimmage in the offence frame (10..110). */
  los: number
  /** Which way the formation leans (1 = high y, −1 = low/near sideline). */
  strongSide: 1 | -1
  ball: { x: number; y: number; z: number }
  carrier: { key: string; x: number; y: number } | null
  target: { key: string; x: number; y: number } | null
  actors: Map<string, { x: number; y: number }>
  /** B1 events up to `t` (seconds are `event.t × duration`). */
  events: AnimEvent[]
  project(p: { x: number; y: number; z?: number }, shot: Shot): { sx: number; sy: number; depth: number; inFrame: boolean }
}

/** B5b's insertion point. Rules run in array order after the base framing. */
export interface DirectorRule {
  id: string
  applies(ctx: ShotContext): boolean
  shape(ctx: ShotContext, target: Shot): Shot
  /** Extra points rule 5 must also keep in the safe frame. */
  mustSee?(ctx: ShotContext): { x: number; y: number; z?: number }[]
}

export type DirectorProfile = 'live' | 'replay' | 'phone'

export interface DirectorOptions {
  rules?: DirectorRule[]
  profile?: DirectorProfile
  viewport?: { w: number; h: number }
}

export interface ShotFrame extends Shot {
  kind: string
  rule?: string
  clamped: boolean
}

export interface Director {
  reset(play: Play, anim: PlayAnim): void
  shotAt(t: number): ShotFrame
  toCamera(shot: Shot): CameraPose
  /** Track-build cost of the last `reset` (ms). */
  readonly buildMs: number
  /** Number of stored frames (one per 1/60 s play step, plus t = 0). */
  readonly frameCount: number
}

/** Which kind of play this is: the base framing and B5b branch on it. */
export function playKind(play: Play, anim: PlayAnim): PlayKind {
  const result = play.result ?? ''
  const concept = play.concept ?? ''
  switch (play.type) {
    case 'kickoff':
      return 'kickoff'
    case 'punt':
      return 'punt'
    case 'fg':
      return 'fg'
    case 'pat':
      return 'pat'
    case 'penalty':
      return 'penalty'
    case 'end':
      return 'other'
    case 'run':
      if (/kneel|victory/i.test(concept)) return 'kneel'
      if (/spike/i.test(concept)) return 'spike'
      if (/qb draw|scramble|sneak|read option/i.test(concept)) return 'scramble'
      return 'run'
    case 'pass': {
      if (/^sack/i.test(result)) return 'sack'
      if (/scramble|qb draw|read option/i.test(concept)) return 'scramble'
      // A pass the QB kept and ran with: the ball never left him (the final
      // holder entry is still the QB — unlike a throw, which ends in null).
      const h = anim.holders
      if (h && h.length && h[h.length - 1].key === 'qb') return 'scramble'
      return 'pass'
    }
    default:
      return 'other'
  }
}

// ── rigs ─────────────────────────────────────────────────────────────────────
interface Rig {
  back: number
  height: number
}

const RIGS: Record<DirectorProfile, Rig> = {
  live: { back: 27, height: 14 },
  replay: { back: 34, height: 22 },
  phone: { back: 22, height: 12 },
}

const VIEWS: Record<DirectorProfile, Viewport> = {
  live: { width: 1280, height: 720 },
  replay: { width: 1280, height: 720 },
  phone: { width: 375, height: 667 },
}

// ── small reads of B1's data ─────────────────────────────────────────────────
function finalHolderKey(anim: PlayAnim): string | null {
  const h = anim.holders
  if (!h || !h.length) return null
  for (let i = h.length - 1; i >= 0; i--) if (h[i].key) return h[i].key
  return null
}

interface PathSamples {
  x: Float64Array
  y: Float64Array
}

/** Sample a keyframed path at a non-decreasing list of normalised times in one walk. */
function samplePath(path: { t: number; x: number; y: number }[] | undefined, times: Float64Array): PathSamples {
  const n = times.length
  const x = new Float64Array(n)
  const y = new Float64Array(n)
  if (!path || !path.length) {
    for (let i = 0; i < n; i++) {
      x[i] = MID_Y
      y[i] = MID_Y
    }
    return { x, y }
  }
  if (path.length === 1) {
    for (let i = 0; i < n; i++) {
      x[i] = path[0].x
      y[i] = path[0].y
    }
    return { x, y }
  }
  const first = path[0]
  const last = path[path.length - 1]
  let seg = 0
  for (let i = 0; i < n; i++) {
    const t = times[i]
    if (t <= first.t) {
      x[i] = first.x
      y[i] = first.y
      continue
    }
    if (t >= last.t) {
      x[i] = last.x
      y[i] = last.y
      continue
    }
    while (seg < path.length - 2 && path[seg + 1].t < t) seg++
    const a = path[seg]
    const b = path[seg + 1]
    const sp = b.t - a.t
    const u = sp <= 0 ? 1 : (t - a.t) / sp
    x[i] = a.x + (b.x - a.x) * u
    y[i] = a.y + (b.y - a.y) * u
  }
  return { x, y }
}

/** Which way the formation leans, from B1's camera hint (or a skill-side fallback). */
function strongSideOf(anim: PlayAnim): 1 | -1 {
  const hint = (anim as PlayAnim & { camera?: { strongSide?: 'low' | 'high' } }).camera
  if (hint?.strongSide === 'high') return 1
  if (hint?.strongSide === 'low') return -1
  let low = 0
  let high = 0
  let teY: number | null = null
  for (const a of anim.actors) {
    if (a.side !== 'off') continue
    if (a.role === 'TE') teY = posAt(a.path, 0).y
    if (a.role !== 'WR' && a.role !== 'TE' && a.role !== 'RB' && a.role !== 'FB' && a.role !== 'SLOT') continue
    const y = posAt(a.path, 0).y
    if (y >= 22 && y <= 31.3) continue
    if (y < MID_Y) low++
    else high++
  }
  if (low === high && teY != null) return teY >= MID_Y ? 1 : -1
  return high > low ? 1 : -1
}

/** The intended receiver: nearest eligible offence actor to the ball at the catch. */
function intendedReceiver(anim: PlayAnim): string | null {
  const fl = anim.flights && anim.flights[0]
  if (!fl) return null
  const bp = posAt(anim.ball, fl.t1)
  let best = Infinity
  let out: string | null = null
  for (const a of anim.actors) {
    if (a.side !== 'off' || a.key === 'qb' || a.key.startsWith('ol')) continue
    const p = posAt(a.path, fl.t1)
    const d = Math.hypot(p.x - bp.x, p.y - bp.y)
    if (d < best) {
      best = d
      out = a.key
    }
  }
  return out
}

// ── the director ─────────────────────────────────────────────────────────────
export function createDirector(opts: DirectorOptions = {}): Director {
  const profile: DirectorProfile = opts.profile ?? 'live'
  const rig = RIGS[profile]
  const viewport: Viewport = opts.viewport
    ? { width: Math.max(1, opts.viewport.w), height: Math.max(1, opts.viewport.h) }
    : { ...VIEWS[profile] }
  const rules = opts.rules ?? []

  /** B2's pose for a shot: rig + the span → vertical-FOV mapping. */
  const poseFor = (shot: Shot): CameraPose => {
    const height = shot.z ?? rig.height
    const d = Math.hypot(rig.back, height)
    const hFov = 2 * Math.atan(shot.span / (2 * d))
    const vFovDeg = (2 * Math.atan(Math.tan(hFov / 2) * (viewport.height / viewport.width)) * 180) / Math.PI
    return orbitPose({
      focusX: shot.cx,
      focusY: shot.cy,
      focusZ: 0,
      back: rig.back,
      height,
      yaw: shot.yaw ?? 0,
      fovDeg: clamp(vFovDeg, 1, 170),
    })
  }

  const projectShot = (p: Pt3, shot: Shot): { sx: number; sy: number; depth: number; inFrame: boolean } => {
    const s = project(makeCamera(poseFor(shot), viewport), p.x, p.y, p.z ?? 0)
    if (!s) return { sx: NaN, sy: NaN, depth: 0, inFrame: false }
    return { sx: s.x, sy: s.y, depth: s.depth, inFrame: s.x >= 0 && s.x <= viewport.width && s.y >= 0 && s.y <= viewport.height }
  }

  const commonContain: Omit<ContainOpts<Shot>, 'spanMin' | 'spanMax'> = {
    viewport,
    poseFor,
    insetX: SAFE_INSET,
    insetY: SAFE_INSET,
    maxShift: 90,
  }

  // ── mutable track state ────────────────────────────────────────────────────
  let kind: PlayKind = 'other'
  let duration = 1
  let los = 60
  let strongSide: 1 | -1 = 1
  let times = new Float64Array(1)
  let track: ShotFrame[] = []
  let buildMs = 0

  function reset(p: Play, a: PlayAnim): void {
    const t0 = performance.now()
    duration = Math.max(0.05, (a.duration || 0) / 1000)
    kind = playKind(p, a)
    los = 10 + snapYard(p)
    strongSide = strongSideOf(a)

    const nFrames = Math.max(1, Math.ceil(duration / FRAME_SEC))
    times = new Float64Array(nFrames + 1)
    for (let k = 0; k <= nFrames; k++) times[k] = Math.min(1, (k * FRAME_SEC) / duration)

    const actorKeys = a.actors.map((x) => x.key)
    const ax = new Map<string, PathSamples>()
    for (const act of a.actors) ax.set(act.key, samplePath(act.path, times))
    const ball = samplePath(a.ball, times)
    const ballZ = new Float64Array(nFrames + 1)
    const holders = new Array<string | null>(nFrames + 1)
    const pres = a as BroadcastAnim
    for (let k = 0; k <= nFrames; k++) {
      ballZ[k] = ballZAt(pres, times[k])
      holders[k] = holderAt(a, times[k])
    }

    const events = (a.events ?? [])
      .map((ev) => ({ sec: clamp01(ev.t) * duration, ev }))
      .sort((x, y) => x.sec - y.sec)
    const snapEv = events.find((e) => e.ev.kind === 'snap')
    const snapSec = snapEv ? snapEv.sec : SNAP_FALLBACK_SEC

    const carrierKey = finalHolderKey(a)
    const targetKey = p.type === 'pass' ? intendedReceiver(a) : null

    // Contact / broken-tackle beats (B1), in seconds.
    let contactSec: number | null = null
    for (const e of a.engagements ?? []) {
      if (e.kind === 'tackle' && e.b === carrierKey) contactSec = minSec(contactSec, clamp01(e.t0) * duration)
    }
    for (const e of events) {
      if ((e.ev.kind === 'contact' || e.ev.kind === 'sack') && (e.ev.kind === 'sack' || e.ev.keys.includes(carrierKey ?? ''))) {
        contactSec = minSec(contactSec, e.sec)
      }
    }
    let brokenSec: number | null = null
    for (const e of a.engagements ?? []) {
      if (e.kind === 'missedTackle' && e.b === carrierKey) brokenSec = minSec(brokenSec, clamp01(e.t0) * duration)
    }
    for (const e of events) {
      if (e.ev.kind === 'brokenTackle') brokenSec = minSec(brokenSec, e.sec)
    }

    // Flights: which frames have the ball in the air.
    const flightActive = new Uint8Array(nFrames + 1)
    for (let fi = 0; fi < a.flights.length; fi++) {
      const fl = a.flights[fi]
      for (let k = 0; k <= nFrames; k++) {
        const t = times[k]
        if (t >= fl.t0 - 1e-9 && t <= fl.t1 + 1e-9) flightActive[k] = 1
      }
    }

    const defKeys: string[] = []
    for (const act of a.actors) if (act.side === 'def') defKeys.push(act.key)

    // Distance from (x, y) to frame k is only needed for the ball; write a tiny
    // helper that scans the 11 defenders to find the two closest to a spot.
    const nearestDefs = (k: number, sx: number, sy: number): string[] => {
      let b0 = Infinity
      let b1 = Infinity
      let k0 = ''
      let k1 = ''
      for (const key of defKeys) {
        const s = ax.get(key)
        if (!s) continue
        const d = (s.x[k] - sx) ** 2 + (s.y[k] - sy) ** 2
        if (d < b0) {
          b1 = b0
          k1 = k0
          b0 = d
          k0 = key
        } else if (d < b1) {
          b1 = d
          k1 = key
        }
      }
      if (!k0) return []
      return k1 ? [k0, k1] : [k0]
    }

    // ── pre-snap formation shot: all 22 + ~5 yd margin, span 34..55, settled ──
    // Built from the whole pre-snap window (not just t = 0) so a motion man
    // cannot slip out of the frozen frame. The ground-plane projection is a
    // homography, so fitting the window's bounding-box corners into the convex
    // safe rect keeps every player inside too.
    let preMinX = Infinity
    let preMaxX = -Infinity
    let preMinY = Infinity
    let preMaxY = -Infinity
    let anyPre = false
    for (let k = 0; k <= nFrames; k++) {
      if (times[k] * duration >= snapSec - 1e-9) continue
      anyPre = true
      for (const act of a.actors) {
        const s = ax.get(act.key)
        if (!s) continue
        if (s.x[k] < preMinX) preMinX = s.x[k]
        if (s.x[k] > preMaxX) preMaxX = s.x[k]
        if (s.y[k] < preMinY) preMinY = s.y[k]
        if (s.y[k] > preMaxY) preMaxY = s.y[k]
      }
    }
    if (!anyPre) {
      for (const act of a.actors) {
        const s = ax.get(act.key)
        if (!s) continue
        if (s.x[0] < preMinX) preMinX = s.x[0]
        if (s.x[0] > preMaxX) preMaxX = s.x[0]
        if (s.y[0] < preMinY) preMinY = s.y[0]
        if (s.y[0] > preMaxY) preMaxY = s.y[0]
      }
    }
    const preWatch: Pt3[] = [
      { x: preMinX, y: preMinY, z: 0 },
      { x: preMaxX, y: preMinY, z: 0 },
      { x: preMaxX, y: preMaxY, z: 0 },
      { x: preMinX, y: preMaxY, z: 0 },
      { x: ball.x[0], y: ball.y[0], z: ballZ[0] },
    ]
    const pre: Shot = {
      cx: los - 6,
      cy: clamp(0.6 * ball.y[0] + 0.4 * MID_Y, 3, FIELD_H - 3),
      span: clamp(preMaxY - preMinY + 10, 34, 55),
      z: rig.height,
      yaw: 0,
    }
    const preContain: ContainOpts<Shot> = { ...commonContain, spanMin: 34, spanMax: 55, iterations: 16 }
    const preFit = containShot(pre, preWatch, preContain).shot
    const preSnap: Shot = { cx: clamp(preFit.cx, 2, 118), cy: clamp(preFit.cy, 2, FIELD_H - 2), span: clamp(preFit.span, 34, 55), z: rig.height, yaw: 0 }

    // ── integrate ─────────────────────────────────────────────────────────────
    const shotContain: ContainOpts<Shot> = { ...commonContain, spanMin: 20, spanMax: 55, iterations: 8 }
    const hasRules = rules.length > 0
    const out: ShotFrame[] = new Array(nFrames + 1)
    let cx = preSnap.cx
    let cy = preSnap.cy
    let span = preSnap.span
    let prevStepX = 0
    let prevStepY = 0
    let vx = 0
    let vy = 0
    let vs = 0
    let evIdx = 0
    const evSeen: AnimEvent[] = []
    // Reused per frame to keep the track build allocation-light.
    const watch: Pt3[] = []
    const spanPts: Pt2[] = []
    const ballVel = (k: number): Pt2 => {
      if (k <= 0) return { x: 0, y: 0 }
      const dt = Math.max(1e-4, (times[k] - times[k - 1]) * duration)
      return { x: (ball.x[k] - ball.x[k - 1]) / dt, y: (ball.y[k] - ball.y[k - 1]) / dt }
    }
    const carrierVel = (key: string, k: number): Pt2 => {
      if (k <= 0) return { x: 0, y: 0 }
      const s = ax.get(key)
      if (!s) return { x: 0, y: 0 }
      const dt = Math.max(1e-4, (times[k] - times[k - 1]) * duration)
      return { x: (s.x[k] - s.x[k - 1]) / dt, y: (s.y[k] - s.y[k - 1]) / dt }
    }

    for (let k = 0; k <= nFrames; k++) {
      const t = times[k]
      const sec = t * duration
      if (sec < snapSec - 1e-9) {
        out[k] = { cx: preSnap.cx, cy: preSnap.cy, span: preSnap.span, z: rig.height, yaw: 0, kind: 'presnap', clamped: false }
        cx = preSnap.cx
        cy = preSnap.cy
        span = preSnap.span
        prevStepX = 0
        prevStepY = 0
        continue
      }

      while (evIdx < events.length && events[evIdx].sec <= sec + 1e-9) {
        evSeen.push(events[evIdx].ev)
        evIdx++
      }

      // ── base framing (rules 1–4) ─────────────────────────────────────────
      const ramp = clamp01((sec - snapSec) / 0.6)
      const bv = ballVel(k)
      const led = leadPoint({ x: ball.x[k], y: ball.y[k] }, bv, 0.35)
      let ox = strongSide * 4 * ramp
      let oy = 0
      // Rule 2: downfield on dropbacks / toward the carrier's heading on runs.
      let offX = 0
      if (kind === 'pass' || kind === 'sack' || kind === 'scramble') offX += 3 * ramp
      const hKey = holders[k]
      if (hKey && (kind === 'run' || kind === 'scramble')) {
        const cv = carrierVel(hKey, k)
        const sp = Math.hypot(cv.x, cv.y)
        if (sp > 0.5) {
          offX += (cv.x / sp) * 2 * ramp
          oy += (cv.y / sp) * 2 * ramp
        }
      }
      let wantX = lerp(preSnap.cx, led.x, ramp) + offX
      let wantY = lerp(preSnap.cy, led.y, ramp) + ox + oy

      // Rule 3 span: keep the holder (or the target in flight) and the two
      // nearest defenders in frame; rule 4 tightens on contact.
      watch.length = 0
      spanPts.length = 0
      watch.push({ x: ball.x[k], y: ball.y[k], z: ballZ[k] })
      spanPts.push({ x: ball.x[k], y: ball.y[k] })
      if (hKey) {
        const s = ax.get(hKey)
        if (s) {
          watch.push({ x: s.x[k], y: s.y[k], z: 0 })
          spanPts.push({ x: s.x[k], y: s.y[k] })
        }
      } else if (flightActive[k] && targetKey) {
        const s = ax.get(targetKey)
        if (s) {
          watch.push({ x: s.x[k], y: s.y[k], z: 0 })
          spanPts.push({ x: s.x[k], y: s.y[k] })
        }
      }
      for (const dk of nearestDefs(k, ball.x[k], ball.y[k])) {
        const s = ax.get(dk)
        if (s) spanPts.push({ x: s.x[k], y: s.y[k] })
      }
      const sb = boundsOf(spanPts)
      let wantSpan = clamp(Math.max(sb.maxY - sb.minY, sb.maxX - sb.minX) + 14, 22, 52)
      let kindName = 'follow'
      if (contactSec != null && sec >= contactSec) {
        if (sec < contactSec + 0.4) {
          wantSpan = 24
          kindName = 'contact'
        } else {
          wantSpan = 20
          kindName = 'hold'
        }
      } else if (brokenSec != null && sec >= brokenSec) {
        kindName = 'follow'
      }
      wantX = clamp(wantX, 3, 117)
      wantY = clamp(wantY, 3, FIELD_H - 3)
      let desired: Shot = { cx: wantX, cy: wantY, span: wantSpan, z: rig.height, yaw: 0 }

      // ── B5b rules (array order, after the base framing) ─────────────────
      let ruleId: string | undefined
      if (hasRules) {
        const actors = new Map<string, { x: number; y: number }>()
        for (const key of actorKeys) {
          const s = ax.get(key)
          if (s) actors.set(key, { x: s.x[k], y: s.y[k] })
        }
        const carrier = hKey && ax.has(hKey) ? { key: hKey, x: ax.get(hKey)!.x[k], y: ax.get(hKey)!.y[k] } : null
        const tgt = targetKey && ax.has(targetKey) ? { key: targetKey, x: ax.get(targetKey)!.x[k], y: ax.get(targetKey)!.y[k] } : null
        const ctx: ShotContext = {
          play: p,
          anim: a,
          kind,
          t,
          sec,
          los,
          strongSide,
          ball: { x: ball.x[k], y: ball.y[k], z: ballZ[k] },
          carrier,
          target: tgt,
          actors,
          events: evSeen,
          project: (pt, shot) => projectShot(pt, shot),
        }
        for (const r of rules) {
          if (!r.applies(ctx)) continue
          desired = { ...desired, ...r.shape(ctx, desired) }
          ruleId = r.id
          if (r.mustSee) for (const pt of r.mustSee(ctx)) watch.push({ x: pt.x, y: pt.y, z: pt.z })
        }
      }

      // ── rule 5: plan containment into the target (before easing) ─────────
      const fit = containShot(desired, watch, shotContain).shot
      desired = { ...desired, cx: clamp(fit.cx, 1, 119), cy: clamp(fit.cy, 1, FIELD_H - 1), span: clamp(fit.span, 20, 55) }

      // ── spring + per-frame limits ────────────────────────────────────────
      const dt = Math.max(1e-4, (times[k] - times[k - 1]) * duration)
      const sxp = smoothDamp(cx, desired.cx, vx, OMEGA_CENTER, dt)
      const syp = smoothDamp(cy, desired.cy, vy, OMEGA_CENTER, dt)
      const ssp = smoothDamp(span, desired.span, vs, OMEGA_SPAN, dt)
      let stepX = clamp(limitAccel(prevStepX, sxp.x - cx, MAX_PAN_ACCEL_YD), -MAX_PAN_YD_PER_FRAME, MAX_PAN_YD_PER_FRAME)
      let stepY = clamp(limitAccel(prevStepY, syp.x - cy, MAX_PAN_ACCEL_YD), -MAX_PAN_YD_PER_FRAME, MAX_PAN_YD_PER_FRAME)
      let nextSpan = limitRatio(span, ssp.x, MAX_SPAN_RATIO_PER_FRAME)
      let nx = cx + stepX
      let ny = cy + stepY

      // ── hard containment (safety net): obey the same per-frame limits ────
      let clamped = false
      const cand: Shot = { cx: nx, cy: ny, span: nextSpan, z: rig.height, yaw: 0 }
      const hard = containShot(cand, watch, shotContain)
      if (hard.shifted || hard.widened) {
        const hx = clamp(limitAccel(prevStepX, hard.shot.cx - cx, MAX_PAN_ACCEL_YD), -MAX_PAN_YD_PER_FRAME, MAX_PAN_YD_PER_FRAME)
        const hy = clamp(limitAccel(prevStepY, hard.shot.cy - cy, MAX_PAN_ACCEL_YD), -MAX_PAN_YD_PER_FRAME, MAX_PAN_YD_PER_FRAME)
        stepX = hx
        stepY = hy
        nx = cx + hx
        ny = cy + hy
        nextSpan = limitRatio(span, hard.shot.span, MAX_SPAN_RATIO_PER_FRAME)
        clamped = true
      }
      const prevSpan = span
      cx = nx
      cy = ny
      span = nextSpan
      vx = stepX / dt
      vy = stepY / dt
      vs = (span - prevSpan) / dt
      prevStepX = stepX
      prevStepY = stepY
      out[k] = { cx, cy, span, z: rig.height, yaw: 0, kind: kindName, rule: ruleId, clamped }
    }

    track = out
    buildMs = performance.now() - t0
  }

  function shotAt(t: number): ShotFrame {
    const n = track.length
    const tn = clamp01(t)
    if (n === 0) return { cx: los, cy: MID_Y, span: 40, z: rig.height, yaw: 0, kind: 'other', clamped: false }
    let lo = 0
    let hi = n - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (times[mid] <= tn + 1e-12) lo = mid
      else hi = mid - 1
    }
    const i = lo
    const j = Math.min(n - 1, i + 1)
    const dts = times[j] - times[i]
    const f = dts <= 1e-12 ? 0 : clamp01((tn - times[i]) / dts)
    const a = track[i]
    const b = track[j]
    return {
      cx: lerp(a.cx, b.cx, f),
      cy: lerp(a.cy, b.cy, f),
      span: lerp(a.span, b.span, f),
      z: lerp(a.z ?? rig.height, b.z ?? rig.height, f),
      yaw: lerp(a.yaw ?? 0, b.yaw ?? 0, f),
      kind: a.kind,
      rule: a.rule,
      clamped: a.clamped,
    }
  }

  return {
    reset,
    shotAt,
    toCamera: poseFor,
    get buildMs() {
      return buildMs
    },
    get frameCount() {
      return track.length
    },
  }
}

function minSec(cur: number | null, next: number): number {
  return cur == null || next < cur ? next : cur
}

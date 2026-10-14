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
// B5b: the director may now emit a rule-provided camera height, aim (pitch) and
// heading (yaw); each is eased and rate-limited like the pan, so no rule can
// make the camera jump.
/** Max camera-height change per frame (yards). */
export const MAX_CAM_Z_YD_PER_FRAME = 0.5
/** Max pitch (aim elevation) change per frame (radians). */
export const MAX_PITCH_RAD_PER_FRAME = 0.02
/** Max yaw change per frame (radians). */
export const MAX_YAW_RAD_PER_FRAME = 0.0175 // 1°/frame
/** Absolute yaw clamp — a slight re-angle only, never an orbit (≤ 8°). */
export const MAX_YAW_RAD = 0.1396 // 8°
/** Absolute pitch clamp (radians): ≤ ~35° up, ~40° down. */
export const MAX_PITCH_RAD = 0.61
export const MIN_PITCH_RAD = -0.7

const FRAME_SEC = 1 / 60
const SNAP_FALLBACK_SEC = 0.14
/** A player's head above the turf (yards) — used as a must-hold framing point. */
const HEAD_Z = 2.0
const OMEGA_CENTER = 5 // rad/s, the centre spring
const OMEGA_SPAN = 2.5 // rad/s, the slower span spring
const OMEGA_CAM = 8 // rad/s-equivalent, the height / aim / heading springs
const SAFE_INSET = 0.06
// animflow 6b-wx (backlog 281): the 2.5D speed feel. While a ball carrier runs
// in the open (before contact) the shot no longer zooms out on him (a wide shot
// made a breakaway crawl), the camera rises a little with his along-field speed
// (the skycam looks down the field, so along-field motion is foreshortened by
// ~sin(pitch): a steeper look shows more of it) and the lead reads the speed
// ~0.2 s ahead, so a burst is not trailed.
/** Carrier speed (yd/s) from which the follow span is capped, and where the cap is fully on. */
const FAST_SPAN_V0 = 4.5
const FAST_SPAN_V1 = 7
/** Widest follow span for a carrier at speed (yd). */
export const FAST_SPAN_MAX = 34
/** Extra camera height at full along-field speed, as a share of the rig height (14 → +5 yd live). */
export const FAST_RISE = 5 / 14
const FAST_RISE_V0 = 4.5
const FAST_RISE_V1 = 8.5
/** How far ahead the camera reads the carrier's / ball's velocity (s). */
export const LEAD_LOOKAHEAD_SEC = 0.2
/** animflow r6a: the pre-snap formation shot is a little wider (was 34..55). */
const PRE_SPAN_MIN = 40
const PRE_SPAN_MAX = 58 // 6% each side, incl. the top for the ball's height
/** The playback controls' height (CSS px) per profile when the caller does not say (MatchView PILL_CLEAR_PX). */
const DEFAULT_CLEAR_PX: Record<'live' | 'replay' | 'phone', number> = { live: 48, replay: 48, phone: 68 }

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
  /** Projection viewport in pixels (rules use it for safe-frame margins). */
  viewport: { width: number; height: number }
  project(p: { x: number; y: number; z?: number }, shot: Shot): { sx: number; sy: number; depth: number; inFrame: boolean }
}

/** B5b's insertion point. Rules run in array order after the base framing. */
export interface DirectorRule {
  id: string
  applies(ctx: ShotContext): boolean
  shape(ctx: ShotContext, target: Shot): Shot
  /** Extra points rule 5 must also keep in the safe frame. */
  mustSee?(ctx: ShotContext): { x: number; y: number; z?: number }[]
  /**
   * B5b hook: shape the frozen pre-snap framing. Evaluated ONCE per reset (at
   * t = 0) so the pre-snap shot stays settled; the returned fields override the
   * fitted shot. Special teams use it to frame the kicking play instead of the
   * 22-man formation (which cannot fit the safe frame at the span cap).
   */
  preSnap?(ctx: ShotContext, shot: Shot): Shot | void
}

export type DirectorProfile = 'live' | 'replay' | 'phone'

/**
 * Backlog 357 ("keep camera angle still"): 'fixed' holds one camera angle for
 * the whole play — yaw 0, the rig's height and its snap tilt — and frames the
 * action by panning the focus and zooming (span) only; rule-provided height /
 * aim / heading are ignored. 'dynamic' is the B5b director (raises on piles,
 * tilts up on deep balls, slight re-angles).
 */
export type CameraAngleMode = 'fixed' | 'dynamic'
/** Fixed angle: the widest zoom (span, yd) containment may open to hold a high ball. */
export const FIXED_SPAN_MAX = 66
/** Fixed angle: watched points higher than this (yd) are held at this height (see reset). */
export const FIXED_WATCH_Z = 10

export interface DirectorOptions {
  rules?: DirectorRule[]
  profile?: DirectorProfile
  viewport?: { w: number; h: number }
  /** px at the bottom the DOM playback controls cover; the safe frame stays above them (animflow r5). */
  bottomClearPx?: number
  /** Backlog 357: 'fixed' = one constant angle (pan + zoom only). Default 'dynamic'. */
  angle?: CameraAngleMode
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
  const fixedAngle = opts.angle === 'fixed'
  /** The snap tilt (radians, looking down at the ground focus from the rig). */
  const RIG_PITCH = Math.atan2(0 - rig.height, rig.back)
  // B5b: absolute clamps for a rule-provided camera height.
  const MIN_CAM_Z = Math.max(4, rig.height * 0.5)
  // Height cap reverted from +24 back to +18 (exactly keepCarrier's +18 raise).
  // The extra +6 headroom let the eased height spring overshoot past the pile's
  // best height, which stacked near figures back over the carrier: occlusion
  // 0.656 -> 0.677. Capping at the raise keeps the ratio at the designed optimum.
  const MAX_CAM_Z = rig.height + 18

  /**
   * B2's pose for a shot: rig + the span → vertical-FOV mapping. B5b: `shot.z`
   * raises the camera and `shot.pitch` tilts the aim (radians above horizontal;
   * negative looks down). The aim is realised by raising the look-at point, so
   * B2 needs no new parameter: focusZ = height + back·tan(pitch). With no pitch
   * the focusZ is exactly 0 (B5a's framing), regardless of height.
   */
  const poseFor = (shot: Shot): CameraPose => {
    const height = shot.z ?? rig.height
    const pitch = shot.pitch
    const focusZ = pitch == null ? 0 : height + rig.back * Math.tan(clamp(pitch, MIN_PITCH_RAD, MAX_PITCH_RAD))
    const d = Math.hypot(rig.back, height)
    const hFov = 2 * Math.atan(shot.span / (2 * d))
    const vFovDeg = (2 * Math.atan(Math.tan(hFov / 2) * (viewport.height / viewport.width)) * 180) / Math.PI
    return orbitPose({
      focusX: shot.cx,
      focusY: shot.cy,
      focusZ,
      back: rig.back,
      height,
      yaw: clamp(shot.yaw ?? 0, -MAX_YAW_RAD, MAX_YAW_RAD),
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
    // Keep everything watched (the carrier, the pile, the ball) above the
    // playback controls: their height plus a margin, at least the 6% inset.
    insetBottom: Math.max(SAFE_INSET, ((opts.bottomClearPx ?? DEFAULT_CLEAR_PX[profile]) + 14) / viewport.height),
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
    // animflow r6a (user request): start a little wider — the whole formation
    // plus a few yards of space on every side and downfield, then ease in.
    const PRE_PAD = 3
    const preWatch: Pt3[] = [
      { x: preMinX - PRE_PAD, y: preMinY - PRE_PAD, z: 0 },
      { x: preMaxX + PRE_PAD + 2, y: preMinY - PRE_PAD, z: 0 },
      { x: preMaxX + PRE_PAD + 2, y: preMaxY + PRE_PAD, z: 0 },
      { x: preMinX - PRE_PAD, y: preMaxY + PRE_PAD, z: 0 },
      { x: ball.x[0], y: ball.y[0], z: ballZ[0] },
    ]
    const pre: Shot = {
      cx: los - 6,
      cy: clamp(0.6 * ball.y[0] + 0.4 * MID_Y, 3, FIELD_H - 3),
      span: clamp(preMaxY - preMinY + 16, PRE_SPAN_MIN, PRE_SPAN_MAX),
      z: rig.height,
      yaw: 0,
    }
    const preContain: ContainOpts<Shot> = { ...commonContain, maxShift: 20, spanMin: PRE_SPAN_MIN, spanMax: PRE_SPAN_MAX, iterations: 10 }
    const preFit = containShot(pre, preWatch, preContain).shot
    const preSnap: Shot = { cx: clamp(preFit.cx, 2, 118), cy: clamp(preFit.cy, 2, FIELD_H - 2), span: clamp(preFit.span, PRE_SPAN_MIN, PRE_SPAN_MAX), z: rig.height, yaw: 0 }

    // ── B5b pre-snap hook: a rule may reframe the frozen pre-snap shot ───────
    // Evaluated once (t = 0) so the shot stays settled through the whole pre-snap
    // window. Special teams use it: the 22-man formation fit above cannot hold
    // both kick units inside the span cap, so it collapses to a clamp corner.
    let preSnapShot: Shot = preSnap
    if (rules.length) {
      const preActors = new Map<string, { x: number; y: number }>()
      for (const key of actorKeys) {
        const s = ax.get(key)
        if (s) preActors.set(key, { x: s.x[0], y: s.y[0] })
      }
      const h0 = holders[0]
      const c0 = h0 && preActors.has(h0) ? { key: h0, ...preActors.get(h0)! } : null
      const t0 = targetKey && preActors.has(targetKey) ? { key: targetKey, ...preActors.get(targetKey)! } : null
      const preCtx: ShotContext = {
        play: p,
        anim: a,
        kind,
        t: 0,
        sec: 0,
        los,
        strongSide,
        ball: { x: ball.x[0], y: ball.y[0], z: ballZ[0] },
        carrier: c0,
        target: t0,
        actors: preActors,
        events: [],
        viewport: { width: viewport.width, height: viewport.height },
        project: (pt, shot) => projectShot(pt, shot),
      }
      for (const r of rules) {
        if (!r.preSnap || !r.applies(preCtx)) continue
        const s = r.preSnap(preCtx, preSnapShot)
        if (s) preSnapShot = { ...preSnapShot, ...s }
      }
    }
    const preSnapOut: Shot = {
      cx: clamp(preSnapShot.cx, 2, 118),
      cy: clamp(preSnapShot.cy, 2, FIELD_H - 2),
      span: clamp(preSnapShot.span, 20, PRE_SPAN_MAX),
      z: fixedAngle ? rig.height : clamp(preSnapShot.z ?? rig.height, MIN_CAM_Z, MAX_CAM_Z),
      yaw: fixedAngle ? 0 : clamp(preSnapShot.yaw ?? 0, -MAX_YAW_RAD, MAX_YAW_RAD),
      pitch: fixedAngle ? RIG_PITCH : preSnapShot.pitch,
    }

    // ── integrate ─────────────────────────────────────────────────────────────
    // The planned target keeps a little more room at the bottom than the hard
    // check, so the eased, rate-limited camera never lets the carrier dip under
    // the controls while it catches up (a keepCarrier raise moves him fast).
    // Backlog 357: a fixed angle cannot tilt up to a high ball, so containment may zoom wider.
    const liveSpanMax = fixedAngle ? FIXED_SPAN_MAX : PRE_SPAN_MAX
    const shotContain: ContainOpts<Shot> = { ...commonContain, insetBottom: (commonContain.insetBottom ?? SAFE_INSET) + 0.04, maxShift: 24, spanMin: 20, spanMax: liveSpanMax, iterations: 6 }
    const hardContain: ContainOpts<Shot> = { ...commonContain, maxShift: 8, spanMin: 20, spanMax: liveSpanMax, iterations: 4 }
    const hasRules = rules.length > 0
    const out: ShotFrame[] = new Array(nFrames + 1)
    let cx = preSnapOut.cx
    let cy = preSnapOut.cy
    let span = preSnapOut.span
    let cz = preSnapOut.z ?? rig.height
    let cyaw = preSnapOut.yaw ?? 0
    let cpitch = preSnapOut.pitch ?? Math.atan2(0 - cz, rig.back)
    let prevStepX = 0
    let prevStepY = 0
    let vx = 0
    let vy = 0
    let vs = 0
    let vz = 0
    let vyaw = 0
    let vpitch = 0
    let evIdx = 0
    const evSeen: AnimEvent[] = []
    // Reused per frame to keep the track build allocation-light.
    const watch: Pt3[] = []
    const spanPts: Pt2[] = []
    // animflow 6b-wx: velocities are read over the next LEAD_LOOKAHEAD_SEC (the
    // track is built offline, so the camera can anticipate a burst instead of
    // trailing it by a spring's time constant).
    const ahead = Math.max(1, Math.round(LEAD_LOOKAHEAD_SEC / FRAME_SEC))
    const ballVel = (k: number): Pt2 => {
      if (k <= 0) return { x: 0, y: 0 }
      const k1 = Math.min(nFrames, k + ahead)
      const k0 = k1 > k ? k : k - 1
      const dt = Math.max(1e-4, (times[k1] - times[k0]) * duration)
      return { x: (ball.x[k1] - ball.x[k0]) / dt, y: (ball.y[k1] - ball.y[k0]) / dt }
    }
    const carrierVel = (key: string, k: number): Pt2 => {
      if (k <= 0) return { x: 0, y: 0 }
      const s = ax.get(key)
      if (!s) return { x: 0, y: 0 }
      const k1 = Math.min(nFrames, k + ahead)
      const k0 = k1 > k ? k : k - 1
      const dt = Math.max(1e-4, (times[k1] - times[k0]) * duration)
      return { x: (s.x[k1] - s.x[k0]) / dt, y: (s.y[k1] - s.y[k0]) / dt }
    }

    for (let k = 0; k <= nFrames; k++) {
      const t = times[k]
      const sec = t * duration
      if (sec < snapSec - 1e-9) {
        out[k] = { cx: preSnapOut.cx, cy: preSnapOut.cy, span: preSnapOut.span, z: cz, yaw: cyaw, pitch: cpitch, kind: 'presnap', clamped: false }
        cx = preSnapOut.cx
        cy = preSnapOut.cy
        span = preSnapOut.span
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
      const hKey = holders[k]
      // animflow r6d: a ball carrier in the open (any play kind: a run, a catch-and-run, a return) owns the
      // framing — the formation's strong-side offset and the dropback's downfield push bleed out with his
      // speed and the heading lead applies to him (a receiver turning up the sideline after the catch was
      // trailed by the strong-side 4 yd on the other side of the field).
      const runnerK = hKey != null && !flightActive[k] && !(hKey === 'qb' && (kind === 'pass' || kind === 'sack'))
      const cvK = hKey ? carrierVel(hKey, k) : { x: 0, y: 0 }
      const spK = Math.hypot(cvK.x, cvK.y)
      const own = runnerK ? clamp01((spK - FAST_SPAN_V0) / (FAST_SPAN_V1 - FAST_SPAN_V0)) : 0
      let ox = strongSide * 4 * ramp * (1 - own)
      let oy = 0
      // Rule 2: downfield on dropbacks / toward the carrier's heading on runs.
      let offX = 0
      if (kind === 'pass' || kind === 'sack' || kind === 'scramble') offX += 3 * ramp * (1 - own)
      if (hKey && (kind === 'run' || kind === 'scramble' || own > 0)) {
        if (spK > 0.5) {
          const w = kind === 'run' || kind === 'scramble' ? 1 : own
          offX += (cvK.x / spK) * 2 * ramp * w
          oy += (cvK.y / spK) * 2 * ramp * w
        }
      }
      // From the contact on, the lead and the strong-side offset bleed out so
      // the camera settles on the ball / pile instead of running on toward the
      // end zone (animflow r5: the tackle was left at the bottom edge).
      const settle = contactSec != null && sec >= contactSec ? clamp01((sec - contactSec) / 0.5) : 0
      const keepLead = 1 - settle
      let wantX = lerp(preSnapOut.cx, lerp(led.x, ball.x[k], settle), ramp) + offX * keepLead
      let wantY = lerp(preSnapOut.cy, lerp(led.y, ball.y[k], settle), ramp) + (ox + oy) * keepLead

      // Rule 3 span: keep the holder (or the target in flight) and the two
      // nearest defenders in frame; rule 4 tightens on contact.
      watch.length = 0
      spanPts.length = 0
      watch.push({ x: ball.x[k], y: ball.y[k], z: ballZ[k] })
      spanPts.push({ x: ball.x[k], y: ball.y[k] })
      if (hKey) {
        const s = ax.get(hKey)
        if (s) {
          watch.push({ x: s.x[k], y: s.y[k], z: 0 }, { x: s.x[k], y: s.y[k], z: HEAD_Z })
          spanPts.push({ x: s.x[k], y: s.y[k] })
        }
      } else if (flightActive[k] && targetKey) {
        const s = ax.get(targetKey)
        if (s) {
          watch.push({ x: s.x[k], y: s.y[k], z: 0 }, { x: s.x[k], y: s.y[k], z: HEAD_Z })
          spanPts.push({ x: s.x[k], y: s.y[k] })
        }
      }
      for (const dk of nearestDefs(k, ball.x[k], ball.y[k])) {
        const s = ax.get(dk)
        if (s) spanPts.push({ x: s.x[k], y: s.y[k] })
      }
      const sb = boundsOf(spanPts)
      let wantSpan = clamp(Math.max(sb.maxY - sb.minY, sb.maxX - sb.minX) + 14, 22, 52)
      // animflow r6a: ease in from the wide formation shot over the first second.
      wantSpan = Math.max(wantSpan, lerp(preSnapOut.span, wantSpan, clamp01((sec - snapSec) / 1.0)))
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
      // animflow 6b-wx: a carrier running in the open keeps the follow scale
      // (no zoom-out on a breakaway) and the camera rises with his along-field
      // speed; both bleed out with the lead from the contact on.
      let wantZ = rig.height
      let fastRun = 0
      const runner = hKey != null && !flightActive[k] && !(hKey === 'qb' && (kind === 'pass' || kind === 'sack'))
      if (runner && keepLead > 0) {
        const cv = carrierVel(hKey!, k)
        const sp = Math.hypot(cv.x, cv.y)
        const fast = clamp01((sp - FAST_SPAN_V0) / (FAST_SPAN_V1 - FAST_SPAN_V0)) * keepLead
        fastRun = fast
        if (fast > 0) wantSpan = Math.min(wantSpan, lerp(wantSpan, FAST_SPAN_MAX, fast))
        if (!fixedAngle) wantZ = rig.height * (1 + FAST_RISE * clamp01((Math.abs(cv.x) - FAST_RISE_V0) / (FAST_RISE_V1 - FAST_RISE_V0)) * keepLead)
      }
      wantX = clamp(wantX, 3, 117)
      wantY = clamp(wantY, 3, FIELD_H - 3)
      let desired: Shot = { cx: wantX, cy: wantY, span: wantSpan, z: wantZ, yaw: 0 }

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
          viewport: { width: viewport.width, height: viewport.height },
          project: (pt, shot) => projectShot(pt, shot),
        }
        for (const r of rules) {
          if (!r.applies(ctx)) continue
          desired = { ...desired, ...r.shape(ctx, desired) }
          ruleId = r.id
          if (r.mustSee) for (const pt of r.mustSee(ctx)) watch.push({ x: pt.x, y: pt.y, z: pt.z })
        }
      }

      // Backlog 357: a fixed angle keeps only the rules' pan / zoom. It cannot
      // tilt up to a ball high in the air (a punt's apex sits above the rig's
      // horizon), so containment holds the ball's ground spot (its shadow and
      // landing marker) and the ball itself up to FIXED_WATCH_Z; chasing a
      // point no pan or zoom can reach would only drag the frame off the play.
      if (fixedAngle) desired = { cx: desired.cx, cy: desired.cy, span: desired.span, z: rig.height, yaw: 0, pitch: RIG_PITCH }

      // ── rule 5: plan containment into the target (before easing) ─────────
      if (fixedAngle) {
        const nw = watch.length
        for (let i = 0; i < nw; i++) {
          const w = watch[i]
          if ((w.z ?? 0) > FIXED_WATCH_Z) {
            watch[i] = { x: w.x, y: w.y, z: FIXED_WATCH_Z }
            watch.push({ x: w.x, y: w.y, z: 0 })
          }
        }
      }
      const fit = containShot(desired, watch, shotContain).shot
      desired = { ...desired, cx: clamp(fit.cx, 1, 119), cy: clamp(fit.cy, 1, FIELD_H - 1), span: clamp(fit.span, 20, fixedAngle ? FIXED_SPAN_MAX : 55) }

      // ── spring + per-frame limits ────────────────────────────────────────
      const dt = Math.max(1e-4, (times[k] - times[k - 1]) * duration)
      const sxp = smoothDamp(cx, desired.cx, vx, OMEGA_CENTER, dt)
      const syp = smoothDamp(cy, desired.cy, vy, OMEGA_CENTER, dt)
      // animflow 6b-wx: a fast carrier's shot closes in at the centre spring's
      // rate (the slow span spring held a kick returner's burst in the wide
      // hang shot for ~1.5 s).
      const omSpan = fastRun > 0 && desired.span < span ? lerp(OMEGA_SPAN, OMEGA_CENTER, fastRun) : OMEGA_SPAN
      const ssp = smoothDamp(span, desired.span, vs, omSpan, dt)
      // B5b: ease the rule-provided height / aim / heading, rate-limited like the
      // pan. A rule's `pitch` is the aim elevation (radians, negative looks down);
      // with none we look at the ground focus (B5a's framing) at the eased height.
      const desZ = clamp(desired.z ?? rig.height, MIN_CAM_Z, MAX_CAM_Z)
      const szp = smoothDamp(cz, desZ, vz, OMEGA_CAM, dt)
      const desPitch = clamp(desired.pitch ?? Math.atan2(0 - desZ, rig.back), MIN_PITCH_RAD, MAX_PITCH_RAD)
      const spp = smoothDamp(cpitch, desPitch, vpitch, OMEGA_CAM, dt)
      const desYaw = clamp(desired.yaw ?? 0, -MAX_YAW_RAD, MAX_YAW_RAD)
      const sypaw = smoothDamp(cyaw, desYaw, vyaw, OMEGA_CAM, dt)
      let stepX = clamp(limitAccel(prevStepX, sxp.x - cx, MAX_PAN_ACCEL_YD), -MAX_PAN_YD_PER_FRAME, MAX_PAN_YD_PER_FRAME)
      let stepY = clamp(limitAccel(prevStepY, syp.x - cy, MAX_PAN_ACCEL_YD), -MAX_PAN_YD_PER_FRAME, MAX_PAN_YD_PER_FRAME)
      let nextSpan = limitRatio(span, ssp.x, MAX_SPAN_RATIO_PER_FRAME)
      let nx = cx + stepX
      let ny = cy + stepY
      const nextZ = clamp(cz + clamp(szp.x - cz, -MAX_CAM_Z_YD_PER_FRAME, MAX_CAM_Z_YD_PER_FRAME), MIN_CAM_Z, MAX_CAM_Z)
      const nextPitch = clamp(cpitch + clamp(spp.x - cpitch, -MAX_PITCH_RAD_PER_FRAME, MAX_PITCH_RAD_PER_FRAME), MIN_PITCH_RAD, MAX_PITCH_RAD)
      const nextYaw = clamp(cyaw + clamp(sypaw.x - cyaw, -MAX_YAW_RAD_PER_FRAME, MAX_YAW_RAD_PER_FRAME), -MAX_YAW_RAD, MAX_YAW_RAD)

      // ── hard containment (safety net): obey the same per-frame limits ────
      let clamped = false
      const cand: Shot = fixedAngle ? { cx: nx, cy: ny, span: nextSpan, z: rig.height, yaw: 0, pitch: RIG_PITCH } : { cx: nx, cy: ny, span: nextSpan, z: nextZ, yaw: nextYaw, pitch: nextPitch }
      const hard = containShot(cand, watch, hardContain)
      if (hard.shifted || hard.widened) {
        const tx = clamp(hard.shot.cx, 1, 119)
        const ty = clamp(hard.shot.cy, 1, FIELD_H - 1)
        const hx = clamp(limitAccel(prevStepX, tx - cx, MAX_PAN_ACCEL_YD), -MAX_PAN_YD_PER_FRAME, MAX_PAN_YD_PER_FRAME)
        const hy = clamp(limitAccel(prevStepY, ty - cy, MAX_PAN_ACCEL_YD), -MAX_PAN_YD_PER_FRAME, MAX_PAN_YD_PER_FRAME)
        stepX = hx
        stepY = hy
        nx = cx + hx
        ny = cy + hy
        nextSpan = limitRatio(span, hard.shot.span, MAX_SPAN_RATIO_PER_FRAME)
        clamped = true
      }
      // A height / aim / heading change the rate-limited pan cannot keep up with
      // (a keepCarrier raise) waits a frame rather than dropping a watched point
      // (the carrier) under the controls (animflow r5).
      let fz = fixedAngle ? rig.height : nextZ
      let fpitch = fixedAngle ? RIG_PITCH : nextPitch
      let fyaw = fixedAngle ? 0 : nextYaw
      if (!fixedAngle && (fz !== cz || fpitch !== cpitch || fyaw !== cyaw) && (clamped || ruleId === 'keepCarrier')) {
        const bot = viewport.height * (1 - (commonContain.insetBottom ?? SAFE_INSET))
        const outBy = (sh: Shot) => {
          let worst = 0
          for (const w of watch) {
            const q = projectShot(w, sh)
            if (Number.isFinite(q.sy)) worst = Math.max(worst, q.sy - bot)
          }
          return worst
        }
        const moved = outBy({ cx: nx, cy: ny, span: nextSpan, z: fz, yaw: fyaw, pitch: fpitch })
        if (moved > 0.5 && moved > outBy({ cx: nx, cy: ny, span: nextSpan, z: cz, yaw: cyaw, pitch: cpitch })) {
          fz = cz
          fpitch = cpitch
          fyaw = cyaw
        }
      }
      const prevSpan = span
      // Do NOT hard-clamp the position to the field edge here: a position clamp
      // truncates the already accel-limited step and breaks the per-frame accel
      // limit (a visible jump when the spring reaches a sideline at speed). The
      // focus is kept inside [1,119]x[1,FIELD_H-1] by `desired` and by the hard
      // containment pass above, both of which clamp before the step is booked.
      cx = nx
      cy = ny
      span = nextSpan
      cz = fz
      cpitch = fpitch
      cyaw = fyaw
      vx = stepX / dt
      vy = stepY / dt
      vs = (span - prevSpan) / dt
      vz = szp.v
      vpitch = spp.v
      vyaw = sypaw.v
      prevStepX = stepX
      prevStepY = stepY
      out[k] = { cx, cy, span, z: cz, yaw: cyaw, pitch: cpitch, kind: kindName, rule: ruleId, clamped }
    }

    track = out
    buildMs = performance.now() - t0
  }

  function shotAt(t: number): ShotFrame {
    const n = track.length
    const tn = clamp01(t)
    if (n === 0) return { cx: los, cy: MID_Y, span: 40, z: rig.height, yaw: 0, pitch: Math.atan2(0 - rig.height, rig.back), kind: 'other', clamped: false }
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
      pitch: lerp(a.pitch ?? Math.atan2(0 - (a.z ?? rig.height), rig.back), b.pitch ?? Math.atan2(0 - (b.z ?? rig.height), rig.back), f),
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

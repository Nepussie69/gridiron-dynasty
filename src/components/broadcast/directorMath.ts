// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B5a) — pure maths for the camera director.
//
// No DOM, no React, no window, no colours: this file and director.ts are
// importable from a plain node script (see ~/gridiron-work/logs/b5a-probe.mjs).
// Everything here is deterministic and allocation-light: it runs 60 times a
// play-second (once per 1/60 s frame) while a director track is built.
//
// The only outside dependency is B2's camera (camera.ts) — the projection is
// B2's `makeCamera` + `project`, never a second one. Nothing is drawn here.
// ─────────────────────────────────────────────────────────────────────────────
import { makeCamera, project, type Camera, type CameraPose, type Viewport } from './camera.ts'

export interface Pt2 {
  x: number
  y: number
}

export interface Pt3 {
  x: number
  y: number
  z?: number
}

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface ScreenPoint {
  sx: number
  sy: number
  inFrame: boolean
}

export interface SpringState {
  x: number
  v: number
}

/** A shot's framing geometry (director.ts's `Shot` is a superset of this). */
export interface ShotGeom {
  cx: number
  cy: number
  span: number
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/**
 * One step of a critically damped spring (`x'' + 2ω x' + ω²(x − target) = 0`),
 * integrated exactly for the constant target over `dt`. `omega` is rad/s and
 * `dt` is in play-seconds. Deterministic (only `Math.exp`).
 */
export function smoothDamp(x: number, target: number, v: number, omega: number, dt: number): SpringState {
  const a = x - target
  const b = v + omega * a
  const e = Math.exp(-omega * dt)
  const y = (a + b * dt) * e
  const yv = (b - omega * (a + b * dt)) * e
  return { x: target + y, v: yv }
}

/** Clamp the frame-to-frame change of `next` from `prev` to ±`maxStep` (yards/frame). */
export function limitStep(prev: number, next: number, maxStep: number): number {
  const d = next - prev
  if (d > maxStep) return prev + maxStep
  if (d < -maxStep) return prev - maxStep
  return next
}

/** Clamp a step's change from the previous step to ±`maxAccel` (yards/frame²). */
export function limitAccel(prevStep: number, step: number, maxAccel: number): number {
  const d = step - prevStep
  if (d > maxAccel) return prevStep + maxAccel
  if (d < -maxAccel) return prevStep - maxAccel
  return step
}

/** Clamp a multiplicative change of `next` from `prev` to ±`maxRatio` (span). */
export function limitRatio(prev: number, next: number, maxRatio: number): number {
  if (prev <= 1e-9) return next
  const r = next / prev
  if (r > 1 + maxRatio) return prev * (1 + maxRatio)
  if (r < 1 - maxRatio) return prev * (1 - maxRatio)
  return next
}

/** Axis-aligned bounds of a set of points (throws on an empty set). */
export function boundsOf(pts: readonly Pt2[]): Box {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

/** Bounds of a set of points including their height on the y axis of the box? No — 2D only. */
export function boundsWidth(b: Box): number {
  return b.maxX - b.minX
}
export function boundsHeight(b: Box): number {
  return b.maxY - b.minY
}

/** Where a point travelling at `vel` (yd/s) will be `sec` seconds from `pos`. */
export function leadPoint(pos: Pt2, vel: Pt2, sec: number): Pt2 {
  return { x: pos.x + vel.x * sec, y: pos.y + vel.y * sec }
}

/** The safe frame in screen pixels: `inset` is a fraction of each side (0.06 = 6%). */
export function safeBox(w: number, h: number, insetX: number, insetY: number): Box {
  return { minX: w * insetX, minY: h * insetY, maxX: w * (1 - insetX), maxY: h * (1 - insetY) }
}

/** True when `box` lies inside `safe`. */
export function boxFits(box: Box, safe: Box): boolean {
  return box.minX >= safe.minX && box.maxX <= safe.maxX && box.minY >= safe.minY && box.maxY <= safe.maxY
}

/**
 * The screen-x (or -y) displacement that brings `[min,max]` inside `[lo,hi]`
 * with the least movement: 0 when it fits, an edge shift when one side is out,
 * a centring shift when both are.
 */
export function axisShift(min: number, max: number, lo: number, hi: number): number {
  const overHi = max - hi
  const overLo = lo - min
  if (overHi <= 0 && overLo <= 0) return 0
  if (overHi > 0 && overLo > 0) return (lo + hi - min - max) / 2
  return overHi > 0 ? -overHi : overLo
}

/** Project a world point through B2's camera (null when behind the near plane). */
export function projectPoint(cam: Camera, p: Pt3): ScreenPoint | null {
  const s = project(cam, p.x, p.y, p.z ?? 0)
  if (!s) return null
  return { sx: s.x, sy: s.y, inFrame: s.x >= 0 && s.x <= cam.width && s.y >= 0 && s.y <= cam.height }
}

export interface ProjectedBox {
  box: Box
  /** True when a watched point was behind the near plane (always treated as out). */
  anyNull: boolean
}

const FAR = 1e6

/** Screen-space bounds of a set of watched points; a near-plane miss widens the box. */
export function projectBox(cam: Camera, watch: readonly Pt3[]): ProjectedBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let anyNull = false
  for (const p of watch) {
    const s = project(cam, p.x, p.y, p.z ?? 0)
    if (!s) {
      anyNull = true
      if (minX > -FAR) {
        minX = -FAR
        maxX = FAR
        minY = -FAR
        maxY = FAR
      }
      continue
    }
    if (s.x < minX) minX = s.x
    if (s.x > maxX) maxX = s.x
    if (s.y < minY) minY = s.y
    if (s.y > maxY) maxY = s.y
  }
  return { box: { minX, minY, maxX, maxY }, anyNull }
}

/** `[[a,b],[c,d]]` as a flat row-major 4-tuple. */
export type Jac2 = readonly [number, number, number, number]

/**
 * Screen-space derivative of a ground point at the focus with respect to moving
 * the focus 1 yd along the camera's ground-right and ground-forward axes.
 * Null when the focus is behind the near plane.
 */
export function focusJacobian(cam: Camera, fx: number, fy: number): Jac2 | null {
  const p0 = project(cam, fx, fy, 0)
  const pr = project(cam, fx + cam.rhx, fy + cam.rhy, 0)
  const pf = project(cam, fx + cam.fhx, fy + cam.fhy, 0)
  if (!p0 || !pr || !pf) return null
  return [pr.x - p0.x, pf.x - p0.x, pr.y - p0.y, pf.y - p0.y]
}

/** The ground displacement (yd) that moves screen content by `(dx, dy)` pixels. */
export function screenShiftToWorld(cam: Camera, jac: Jac2, dx: number, dy: number): Pt2 | null {
  const [a, b, c, d] = jac
  const det = a * d - b * c
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null
  // q = J⁻¹ · (dx, dy), then δ = −q (a camera move of δ shifts content by −J·δ).
  const qr = (d * dx - b * dy) / det
  const qf = (-c * dx + a * dy) / det
  const dr = -qr
  const df = -qf
  return { x: cam.rhx * dr + cam.fhx * df, y: cam.rhy * dr + cam.fhy * df }
}

export interface ContainOpts<S extends ShotGeom> {
  viewport: Viewport
  /** B2 pose for a shot (the caller owns the rig and the field-of-view mapping). */
  poseFor: (shot: S) => CameraPose
  /** Safe-frame inset as a fraction of each side (0.06 = 6%). */
  insetX: number
  insetY: number
  /** Hard span clamps while widening. */
  spanMin: number
  spanMax: number
  /** Max focus shift per widening pass (yards); default 60. */
  maxShift?: number
  /** Max widening passes / total passes; default 12. */
  iterations?: number
}

export interface ContainResult<S> {
  shot: S
  /** The focus moved to fit the watch set. */
  shifted: boolean
  /** The span grew to fit the watch set. */
  widened: boolean
  /** The watch set fits the safe frame in the returned shot. */
  ok: boolean
  /** Screen-space overflow after containment (px, 0 when it fits). */
  overflowX: number
  overflowY: number
}

/**
 * Rule 5: shift a shot minimally, then widen, until the watched points fit the
 * safe frame. Uses B2's projection for both the test and the shift (a finite-
 * difference Jacobian at the focus), so it is correct at any yaw/tilt.
 * Never mutates `shot`.
 */
export function containShot<S extends ShotGeom>(shot: S, watch: readonly Pt3[], o: ContainOpts<S>): ContainResult<S> {
  const { width: w, height: h } = o.viewport
  const safe = safeBox(w, h, o.insetX, o.insetY)
  const maxShift = o.maxShift ?? 60
  const iters = o.iterations ?? 12
  let cur: S = shot
  let shifted = false
  let widened = false
  let overflowX = 0
  let overflowY = 0
  for (let it = 0; it < iters; it++) {
    const cam = makeCamera(o.poseFor(cur), o.viewport)
    const { box } = projectBox(cam, watch)
    const needX = axisShift(box.minX, box.maxX, safe.minX, safe.maxX)
    const needY = axisShift(box.minY, box.maxY, safe.minY, safe.maxY)
    if (needX === 0 && needY === 0) {
      overflowX = 0
      overflowY = 0
      return { shot: cur, shifted, widened, ok: true, overflowX, overflowY }
    }
    const fW = box.maxX - box.minX
    const fH = box.maxY - box.minY
    const sW = safe.maxX - safe.minX
    const sH = safe.maxY - safe.minY
    // Content larger than the safe frame: widen first (it cannot be fixed by a shift).
    if (fW > sW * 0.999 || fH > sH * 0.999) {
      const factor = Math.max(fW / sW, fH / sH) * 1.03
      const next = Math.min(o.spanMax, cur.span * factor)
      if (next > cur.span * 1.0005) {
        cur = { ...cur, span: next }
        widened = true
        continue
      }
    }
    const jac = focusJacobian(cam, cur.cx, cur.cy)
    if (!jac) break
    const delta = screenShiftToWorld(cam, jac, needX, needY)
    if (!delta) break
    const dx = clamp(delta.x, -maxShift, maxShift)
    const dy = clamp(delta.y, -maxShift, maxShift)
    if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) {
      // Nothing left to shift: widen a touch and retry.
      const next = Math.min(o.spanMax, cur.span * 1.05)
      if (next <= cur.span * 1.0005) break
      cur = { ...cur, span: next }
      widened = true
      continue
    }
    cur = { ...cur, cx: cur.cx + dx, cy: cur.cy + dy }
    shifted = true
  }
  // Final measure for the overflow report.
  const cam = makeCamera(o.poseFor(cur), o.viewport)
  const { box } = projectBox(cam, watch)
  overflowX = Math.max(0, safe.minX - box.minX, box.maxX - safe.maxX)
  overflowY = Math.max(0, safe.minY - box.minY, box.maxY - safe.maxY)
  return { shot: cur, shifted, widened, ok: overflowX === 0 && overflowY === 0, overflowX, overflowY }
}

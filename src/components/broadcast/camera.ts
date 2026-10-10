// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B2): perspective camera for the live game view.
//
// WORLD COORDINATES (yards) — the same frame as playAnim.ts, fixed to the
// stadium instead of the offense:
//   x  0 … 120 along the field. x = 0 is the LEFT end line, 0..10 the left end
//      zone, 10 the left goal line, 60 midfield, 110 the right goal line,
//      120 the right end line. The HOME club defends the left end zone.
//   y  0 … 53.3 across the field. y = 0 is the NEAR (press-box / broadcast)
//      sideline, 53.3 the far sideline. 26.65 is the middle.
//   z  height above the turf, up.
// It is right-handed: looking down from above, +x runs right and +y away from
// the near sideline.
//
// MAPPING FROM playAnim.ts: playAnim works in the offense's frame (own goal
// line at x = 10, attacking toward x = 110). When the offense attacks toward
// +x (direction = 1) the frames are identical; when it attacks toward −x
// (direction = −1) the world point is (120 − x, 53.3 − y) — a 180° turn, which
// is what MatchView's mirror does. Use offenseToWorld() / offenseXToWorld().
//
// This file has NO imports so a node script can load it directly
// (node --experimental-strip-types scripts/check-broadcast.ts).
// ─────────────────────────────────────────────────────────────────────────────

/** Field length end line to end line (matches playAnim FIELD_W). */
export const FIELD_LENGTH = 120
/** Field width sideline to sideline (matches playAnim FIELD_H). */
export const FIELD_WIDTH = 53.3
/** Middle of the field across (matches playAnim MID_Y). */
export const MID_WIDTH = 26.65
/** Hash marks: 70'9" from each sideline → ±3.08 yd from the middle. */
export const HASH_HALF = 3.08
/** Default near-plane distance (yards). */
export const NEAR = 0.6

export type Vec3 = readonly [number, number, number]
export type Direction = 1 | -1

/** Where the camera is and what it looks at. Viewport-independent. */
export interface CameraPose {
  pos: Vec3
  target: Vec3
  /** Vertical field of view in degrees. */
  fovDeg: number
}

export interface Viewport {
  /** Canvas pixel size the camera renders into (device pixels in the renderer). */
  width: number
  height: number
  /** Principal point shift (e.g. a cache canvas with a margin). Default 0. */
  offsetX?: number
  offsetY?: number
}

/** A pose bound to a viewport with its orthonormal basis precomputed. */
export interface Camera {
  pose: CameraPose
  width: number
  height: number
  near: number
  /** Camera position. */
  px: number
  py: number
  pz: number
  /** Right, up and forward unit vectors (world). */
  rx: number
  ry: number
  rz: number
  ux: number
  uy: number
  uz: number
  fx: number
  fy: number
  fz: number
  /** Ground-plane (z = 0) unit right / forward, for billboards and facing. */
  rhx: number
  rhy: number
  fhx: number
  fhy: number
  /** Focal length in pixels and the principal point. */
  focal: number
  cx: number
  cy: number
}

export interface ScreenPoint {
  x: number
  y: number
  /** Distance along the view axis (yards). */
  depth: number
}

export function makeCamera(pose: CameraPose, vp: Viewport, near = NEAR): Camera {
  const [px, py, pz] = pose.pos
  let fx = pose.target[0] - px
  let fy = pose.target[1] - py
  let fz = pose.target[2] - pz
  const fl = Math.hypot(fx, fy, fz) || 1
  fx /= fl
  fy /= fl
  fz /= fl
  // Right = forward × up(z), flattened. Straight down has no horizontal
  // heading: fall back to +x as screen right.
  const fh = Math.hypot(fx, fy)
  let rx = 1
  let ry = 0
  if (fh > 1e-6) {
    rx = fy / fh
    ry = -fx / fh
  }
  const rz = 0
  // Up = right × forward.
  let ux = ry * fz - rz * fy
  let uy = rz * fx - rx * fz
  let uz = rx * fy - ry * fx
  const ul = Math.hypot(ux, uy, uz) || 1
  ux /= ul
  uy /= ul
  uz /= ul
  const fov = (Math.max(1, Math.min(170, pose.fovDeg)) * Math.PI) / 180
  return {
    pose,
    width: vp.width,
    height: vp.height,
    near,
    px,
    py,
    pz,
    rx,
    ry,
    rz,
    ux,
    uy,
    uz,
    fx,
    fy,
    fz,
    rhx: rx,
    rhy: ry,
    fhx: fh > 1e-6 ? fx / fh : 0,
    fhy: fh > 1e-6 ? fy / fh : 1,
    focal: vp.height / 2 / Math.tan(fov / 2),
    cx: vp.width / 2 + (vp.offsetX ?? 0),
    cy: vp.height / 2 + (vp.offsetY ?? 0),
  }
}

/** World → camera space: [right, up, depth]. */
export function toCamera(c: Camera, x: number, y: number, z: number): [number, number, number] {
  const dx = x - c.px
  const dy = y - c.py
  const dz = z - c.pz
  return [dx * c.rx + dy * c.ry + dz * c.rz, dx * c.ux + dy * c.uy + dz * c.uz, dx * c.fx + dy * c.fy + dz * c.fz]
}

/** World → screen pixels, or null when the point is behind the near plane. */
export function project(c: Camera, x: number, y: number, z = 0): ScreenPoint | null {
  const dx = x - c.px
  const dy = y - c.py
  const dz = z - c.pz
  const d = dx * c.fx + dy * c.fy + dz * c.fz
  if (d < c.near) return null
  const r = dx * c.rx + dy * c.ry + dz * c.rz
  const u = dx * c.ux + dy * c.uy + dz * c.uz
  return { x: c.cx + (c.focal * r) / d, y: c.cy - (c.focal * u) / d, depth: d }
}

/** Pixels per yard for a world-space length at this depth. */
export function scaleAt(c: Camera, depth: number): number {
  return c.focal / Math.max(c.near, depth)
}

/**
 * Clip a world-space polygon against the near plane (Sutherland–Hodgman) and
 * project it. Returns screen points; fewer than 3 means nothing is visible.
 * Screen-edge clipping is left to the canvas.
 */
export function clipPolygon(c: Camera, pts: readonly Vec3[]): [number, number][] {
  const n = pts.length
  if (n < 3) return []
  const C: [number, number, number][] = new Array(n)
  let allIn = true
  let allOut = true
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    const q = toCamera(c, p[0], p[1], p[2])
    C[i] = q
    if (q[2] >= c.near) allOut = false
    else allIn = false
  }
  if (allOut) return []
  const out: [number, number][] = []
  const push = (r: number, u: number, d: number) => out.push([c.cx + (c.focal * r) / d, c.cy - (c.focal * u) / d])
  if (allIn) {
    for (const q of C) push(q[0], q[1], q[2])
    return out
  }
  for (let i = 0; i < n; i++) {
    const a = C[i]
    const b = C[(i + 1) % n]
    const ain = a[2] >= c.near
    const bin = b[2] >= c.near
    if (ain) push(a[0], a[1], a[2])
    if (ain !== bin) {
      const k = (c.near - a[2]) / (b[2] - a[2])
      push(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, c.near)
    }
  }
  return out
}

/** Ground quad [x0..x1] × [y0..y1] at height z, counter-clockwise from above. */
export function quad(x0: number, y0: number, x1: number, y1: number, z = 0): Vec3[] {
  return [
    [x0, y0, z],
    [x1, y0, z],
    [x1, y1, z],
    [x0, y1, z],
  ]
}

// ── poses ────────────────────────────────────────────────────────────────────

export interface OrbitParams {
  /** Ground point the camera looks at. */
  focusX: number
  focusY: number
  focusZ?: number
  /** Horizontal distance from the focus (yards). */
  back: number
  /** Camera height (yards). */
  height: number
  /**
   * Heading of the camera → focus direction in the ground plane (radians).
   * 0: camera on the −x side looking toward +x (skycam behind an offense that
   * attacks +x, the mockup's shot). π/2: camera on the near (y < 0) sideline
   * looking across (classic broadcast side). −π/2: far sideline. π: reverse.
   */
  yaw: number
  fovDeg: number
}

/** The mockup's camera rig: back off the focus along `yaw`, raised to `height`. */
export function orbitPose(o: OrbitParams): CameraPose {
  const fz = o.focusZ ?? 0
  return {
    pos: [o.focusX - o.back * Math.cos(o.yaw), o.focusY - o.back * Math.sin(o.yaw), o.height],
    target: [o.focusX, o.focusY, fz],
    fovDeg: o.fovDeg,
  }
}

export function lerpPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  const l = (p: number, q: number) => p + (q - p) * t
  return {
    pos: [l(a.pos[0], b.pos[0]), l(a.pos[1], b.pos[1]), l(a.pos[2], b.pos[2])],
    target: [l(a.target[0], b.target[0]), l(a.target[1], b.target[1]), l(a.target[2], b.target[2])],
    fovDeg: l(a.fovDeg, b.fovDeg),
  }
}

// ── offense frame (playAnim) ↔ world ─────────────────────────────────────────

/** playAnim offense-frame x → world x. */
export function offenseXToWorld(x: number, dir: Direction): number {
  return dir === 1 ? x : FIELD_LENGTH - x
}

/** playAnim offense-frame point → world point (a 180° turn when dir = −1). */
export function offenseToWorld(x: number, y: number, dir: Direction): { x: number; y: number } {
  return dir === 1 ? { x, y } : { x: FIELD_LENGTH - x, y: FIELD_WIDTH - y }
}

// ── 2D affine helpers (static-layer cache reuse) ─────────────────────────────

/** Canvas setTransform order: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Affine = [a: number, b: number, c: number, d: number, e: number, f: number]

/** The affine map sending three source points onto three destination points. Null if degenerate. */
export function fitAffine(src: readonly (readonly [number, number])[], dst: readonly (readonly [number, number])[]): Affine | null {
  const [[x0, y0], [x1, y1], [x2, y2]] = src
  const det = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1)
  if (Math.abs(det) < 1e-6) return null
  const solve = (v0: number, v1: number, v2: number): [number, number, number] => [
    (v0 * (y1 - y2) + v1 * (y2 - y0) + v2 * (y0 - y1)) / det,
    (v0 * (x2 - x1) + v1 * (x0 - x2) + v2 * (x1 - x0)) / det,
    (v0 * (x1 * y2 - x2 * y1) + v1 * (x2 * y0 - x0 * y2) + v2 * (x0 * y1 - x1 * y0)) / det,
  ]
  const [a, c, e] = solve(dst[0][0], dst[1][0], dst[2][0])
  const [b, d, f] = solve(dst[0][1], dst[1][1], dst[2][1])
  return [a, b, c, d, e, f]
}

export function applyAffine(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

export function invertAffine(m: Affine): Affine | null {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  if (Math.abs(det) < 1e-12) return null
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

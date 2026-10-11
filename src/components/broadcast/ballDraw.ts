// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B4): drawing the ball. Pure canvas — no React.
//
//   drawBallShadow(ctx, st, d)          // ground layer, under every body
//   drawBall(ctx, anim, t, st, d)       // leather ellipse + lace
//   drawBallTrail(ctx, anim, t, d)      // ≤ 12 fading samples, in flight only
//   drawLandingMarker(ctx, anim, t, d)  // dashed ring over a pass / punt flight
//
// The leather gradient is cached per (context, size bucket): at most ONE
// gradient is created in a frame. Effect-art colours live in BALL_ART below
// (each line carries a check-hex-allow marker); team colours are passed in.
// ─────────────────────────────────────────────────────────────────────────────

import type { BroadcastAnim } from './animData.ts'
import { ballState, ballShadow, type BallState } from './ball.ts'
import { project, scaleAt, type Camera } from './camera.ts'
import type { FxQuality } from './fxSchedule.ts'

export interface BallDraw {
  cam: Camera
  dpr: number
  quality: FxQuality
  reducedMotion: boolean
  /** Offense frame → world. */
  toWorld: (x: number, y: number) => { x: number; y: number }
}

/** Ball / trail / marker art (fixed, not club colours). */
export const BALL_ART = {
  leatherHi: '#C07A48', // check-hex-allow: ball leather highlight
  leatherMid: '#7A421F', // check-hex-allow: ball leather
  leatherLo: '#3E1E0B', // check-hex-allow: ball leather shade
  outline: 'rgba(10,6,3,.85)', // ball outline
  lace: 'rgba(255,255,255,.92)', // ball laces
  trail: '255,250,235', // check-hex-allow: warm-white trail RGB
  marker: 'rgba(255,255,255,', // landing marker (alpha appended)
  shadow: 'rgba(0,6,0,', // ball ground shadow (alpha appended)
} as const

const TAU = Math.PI * 2
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/** Leather gradients, cached per context and 0.5-px size bucket (≤ 1 new / frame). */
const gradCache = new WeakMap<CanvasRenderingContext2D, Map<number, CanvasGradient>>()
function leatherGradient(ctx: CanvasRenderingContext2D, wid: number): CanvasGradient {
  const bucket = Math.max(4, Math.round(wid * 2) / 2)
  let m = gradCache.get(ctx)
  if (!m) {
    m = new Map()
    gradCache.set(ctx, m)
  }
  let g = m.get(bucket)
  if (!g) {
    if (m.size > 48) m.clear()
    g = ctx.createLinearGradient(0, -bucket / 2, 0, bucket / 2)
    g.addColorStop(0, BALL_ART.leatherHi)
    g.addColorStop(0.5, BALL_ART.leatherMid)
    g.addColorStop(1, BALL_ART.leatherLo)
    m.set(bucket, g)
  }
  return g
}

/** Add a ground-plane ellipse (projected, vertically squashed) to the path. */
function groundEllipse(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, rx: number, ry: number): void {
  const p = project(cam, x, y, 0)
  if (!p) return
  const k = cam.focal / p.depth
  const dx = x - cam.px
  const dy = y - cam.py
  const squash = clamp(cam.pz / Math.hypot(dx, dy, cam.pz), 0.12, 1)
  const R = rx * k
  ctx.moveTo(p.x + R, p.y)
  ctx.ellipse(p.x, p.y, R, ry * k * squash, 0, 0, TAU)
}

/** The ball's ground shadow: strictly shrinking / fading with height. */
export function drawBallShadow(ctx: CanvasRenderingContext2D, st: BallState, d: BallDraw): void {
  const sh = ballShadow(st.z)
  const w = d.toWorld(st.x + sh.offset.x, st.y + sh.offset.y)
  ctx.beginPath()
  groundEllipse(ctx, d.cam, w.x, w.y, sh.radius, sh.radius * 0.72)
  ctx.fillStyle = `${BALL_ART.shadow}${sh.alpha.toFixed(3)})`
  ctx.fill()
}

/** The flight (if any) containing play time t. */
function flightContaining(anim: BroadcastAnim, t: number): { t0: number; t1: number } | null {
  for (const f of anim.flights ?? []) if (f.t1 > f.t0 && t >= f.t0 - 1e-9 && t <= f.t1 + 1e-9) return f
  return null
}

/** The ball: a leather ellipse with a lace stripe (spiral wobble / end-over-end). */
export function drawBall(ctx: CanvasRenderingContext2D, anim: BroadcastAnim, t: number, st: BallState, d: BallDraw): void {
  const w = d.toWorld(st.x, st.y)
  const p = project(d.cam, w.x, w.y, st.z)
  if (!p) return
  const minPx = Math.max(3, 5 * d.dpr)
  // animflow r4: a held ball is drawn hand-sized (0.34 yd); in flight and loose
  // it keeps the readable broadcast size (0.55), blending over 0.2 s out of the
  // hand and 0.15 s back into it.
  const D = Math.max(0.05, (anim.duration || 0) / 1000)
  let k = 0.55
  if (st.holder && !st.inFlight) {
    k = 0.34
    for (const f of anim.flights ?? []) {
      const since = (t - f.t1) * D
      if (since >= 0 && since < 0.15) k = 0.55 - 0.21 * (since / 0.15)
    }
  } else if (st.inFlight) {
    const f = flightContaining(anim, t)
    if (f) k = 0.34 + 0.21 * clamp(((t - f.t0) * D) / 0.2, 0, 1)
  }
  let len = Math.max(minPx, k * scaleAt(d.cam, p.depth))
  const wid = len * 0.6
  // Screen-space angle along the projected arc tangent.
  let ang = -0.35
  const back = Math.max(0, t - 0.04)
  const bz = ballState(anim, back, { reducedMotion: d.reducedMotion })
  const bw = d.toWorld(bz.x, bz.y)
  const bp = project(d.cam, bw.x, bw.y, bz.z)
  if (bp && Math.hypot(p.x - bp.x, p.y - bp.y) > 0.5) ang = Math.atan2(p.y - bp.y, p.x - bp.x)
  // End-over-end kicks foreshorten as the ball rotates about a horizontal axis.
  if (st.kind === 'tumbleKick') len *= 0.72 + 0.28 * Math.abs(Math.cos(st.tumbleDeg))

  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.rotate(ang)
  ctx.beginPath()
  ctx.ellipse(0, 0, len / 2, wid / 2, 0, 0, TAU)
  ctx.fillStyle = leatherGradient(ctx, wid)
  ctx.fill()
  ctx.lineWidth = Math.max(1, len * 0.07)
  ctx.strokeStyle = BALL_ART.outline
  ctx.stroke()
  // Lace: a spiral wobble in flight, a straight seam when held / spinning down.
  const wob = st.inFlight && st.wobbleDeg > 0 ? Math.sin(st.spinPhase) * clamp(st.wobbleDeg / 10, 0, 1) : 0
  ctx.strokeStyle = BALL_ART.lace
  ctx.lineWidth = Math.max(0.8, len * 0.06)
  ctx.beginPath()
  ctx.moveTo(-len * 0.16, -wid * 0.16 * wob - wid * 0.06)
  ctx.lineTo(len * 0.16, -wid * 0.16 * wob - wid * 0.06)
  ctx.stroke()
  ctx.restore()
}

/** A fading trail of the ball's recent flight (≤ 12 full / 6 lite). Returns segments drawn. */
export function drawBallTrail(ctx: CanvasRenderingContext2D, anim: BroadcastAnim, t: number, d: BallDraw): number {
  if (d.reducedMotion) return 0
  const st = ballState(anim, t, { reducedMotion: d.reducedMotion })
  if (!st.inFlight) return 0
  const f = flightContaining(anim, t)
  if (!f) return 0
  const n = d.quality === 'lite' ? 6 : 12
  const step = 0.022
  const w0 = d.toWorld(st.x, st.y)
  const p0 = project(d.cam, w0.x, w0.y, st.z)
  if (!p0) return 0
  // Cap the trail to ~4 yd of travel.
  const CAP = 4
  let dist = 0
  let prevW = { x: st.x, y: st.y }
  let prev = p0
  let drawn = 0
  ctx.save()
  ctx.lineCap = 'round'
  for (let j = 1; j <= n; j++) {
    const tb = t - j * step
    if (tb < f.t0 || tb < 0) break
    const stb = ballState(anim, tb, { reducedMotion: true })
    dist += Math.hypot(stb.x - prevW.x, stb.y - prevW.y)
    if (dist > CAP) break
    const wb = d.toWorld(stb.x, stb.y)
    const pb = project(d.cam, wb.x, wb.y, stb.z)
    if (!pb) break
    const a = 0.55 * (1 - j / (n + 1))
    ctx.strokeStyle = `rgba(${BALL_ART.trail},${a.toFixed(3)})`
    ctx.lineWidth = Math.max(1, 0.35 * scaleAt(d.cam, pb.depth) * (1 - j / (n + 2)))
    ctx.beginPath()
    ctx.moveTo(prev.x, prev.y)
    ctx.lineTo(pb.x, pb.y)
    ctx.stroke()
    prev = pb
    prevW = { x: stb.x, y: stb.y }
    drawn++
  }
  ctx.restore()
  return drawn
}

/** A dashed ground ring shrinking onto the projected catch / fielding spot. */
export function drawLandingMarker(ctx: CanvasRenderingContext2D, anim: BroadcastAnim, t: number, d: BallDraw): void {
  const f = flightContaining(anim, t)
  if (!f || f.t1 <= f.t0) return
  const ck = anim.camera?.kind
  if (ck !== 'punt' && ck !== 'scrimmage') return
  const u = clamp((t - f.t0) / (f.t1 - f.t0), 0, 1)
  const land = ballState(anim, f.t1, { reducedMotion: true })
  const w = d.toWorld(land.x, land.y)
  const radius = 1.1 - u * 0.4
  ctx.save()
  const dash = Math.max(2, 4 * d.dpr)
  ctx.setLineDash([dash, dash * 0.8])
  ctx.beginPath()
  groundEllipse(ctx, d.cam, w.x, w.y, radius, radius)
  ctx.strokeStyle = `${BALL_ART.marker}${(0.55 * Math.min(1, u * 5)).toFixed(3)})`
  ctx.lineWidth = Math.max(1, 1.4 * d.dpr)
  ctx.stroke()
  ctx.restore()
}

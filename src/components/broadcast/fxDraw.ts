// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B4): drawing the effect schedule. Pure canvas — no React.
//
//   drawFxGround(...)  // turf-level: impact / burst / turnover rings, puffs,
//                      // goal-line sweep, the reduced-motion marker
//   drawFxAir(...)     // above the figures: sparkles, burst spokes, particles
//                      // (turf bits, confetti) and crossbar glints
//
// No gradients are created here (≤ 2 gradients per frame overall — the ball's
// cached leather is the only one). Effect-art neutral colours live in FX_ART
// below, each line carrying a check-hex-allow marker; team colours are passed
// in as CSS strings (never literals).
// ─────────────────────────────────────────────────────────────────────────────

import type { BroadcastAnim } from './animData.ts'
import { project, scaleAt, type Camera } from './camera.ts'
import { fxParticles, type FxItem, type FxQuality } from './fxSchedule.ts'

export interface FxDraw {
  cam: Camera
  dpr: number
  quality: FxQuality
  reducedMotion: boolean
  /** Offense frame → world. */
  toWorld: (x: number, y: number) => { x: number; y: number }
}

/** Team colours (from clubArt / teamColor) plus the neutral effect art. */
export interface FxPalette {
  off: string
  def: string
}

/** Neutral effect art (not club colours). */
export const FX_ART = {
  neutral: '#F2EFE6', // check-hex-allow: neutral turf-bit
  dirt: '#121212', // check-hex-allow: turf-bit dark
  grass: '#4C9A4F', // check-hex-allow: turf-bit turf
  confNeutral: '#D8D8D8', // check-hex-allow: confetti neutral
  white: '255,255,255', // effect-white RGB (alpha appended)
  sparkle: 'rgba(255,255,255,', // catch sparkle (alpha appended)
  ring: 'rgba(255,255,255,', // ground rings (alpha appended)
} as const

const TAU = Math.PI * 2
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

function teamColor(pal: FxPalette, team: FxItem['team']): string {
  return team === 'def' ? pal.def : team === 'off' ? pal.off : FX_ART.neutral
}

/** Add a ground-plane ellipse (projected, vertically squashed) to the path. */
function groundEllipse(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, r: number): void {
  const p = project(cam, x, y, 0)
  if (!p) return
  const k = cam.focal / p.depth
  const squash = clamp(cam.pz / Math.hypot(x - cam.px, y - cam.py, cam.pz), 0.12, 1)
  const R = r * k
  ctx.moveTo(p.x + R, p.y)
  ctx.ellipse(p.x, p.y, R, R * 0.72 * squash, 0, 0, TAU)
}

/** Ground ring that expands (or holds still under reduced motion) and fades. */
function groundRing(ctx: CanvasRenderingContext2D, d: FxDraw, t: number, it: FxItem, baseR: number, grow: number, color: string): void {
  const span = Math.max(1e-6, it.t1 - it.t0)
  const u = clamp((t - it.t0) / span, 0, 1)
  const r = it.expanding ? baseR + grow * u : baseR
  const alpha = (it.expanding ? 0.85 : 0.7) * (1 - u) * it.intensity
  if (alpha <= 0.01) return
  const w = d.toWorld(it.anchor.x, it.anchor.y)
  ctx.beginPath()
  groundEllipse(ctx, d.cam, w.x, w.y, r)
  ctx.strokeStyle = `rgba(${color},${alpha.toFixed(3)})`
  ctx.lineWidth = Math.max(1, (1.6 - u) * d.dpr)
  ctx.stroke()
}

// ── ground pass ──────────────────────────────────────────────────────────────

export function drawFxGround(ctx: CanvasRenderingContext2D, d: FxDraw, t: number, schedule: readonly FxItem[]): void {
  const cam = d.cam
  for (const it of schedule) {
    if (t < it.t0 || t > it.t1) continue
    switch (it.kind) {
      case 'impact':
        groundRing(ctx, d, t, it, 0.8, it.intensity > 0.5 ? 2.4 : 1.2, FX_ART.white)
        break
      case 'burst':
        groundRing(ctx, d, t, it, 0.6, 1.8, FX_ART.white)
        break
      case 'turnover':
        groundRing(ctx, d, t, it, 0.7, 2.0, FX_ART.white)
        break
      case 'puff':
        groundRing(ctx, d, t, it, 0.35, 0.9, FX_ART.white)
        break
      case 'marker':
        groundRing(ctx, d, t, it, 0.95, 0, FX_ART.white)
        break
      case 'sweep': {
        const span = Math.max(1e-6, it.t1 - it.t0)
        const u = clamp((t - it.t0) / span, 0, 1)
        const w = d.toWorld(it.anchor.x, it.anchor.y)
        const halfY = 5
        const a = (1 - u) * it.intensity * 0.8
        if (a > 0.02) {
          const p0 = project(cam, w.x, w.y - halfY, 0)
          const p1 = project(cam, w.x, w.y + halfY, 0)
          if (p0 && p1) {
            ctx.save()
            ctx.strokeStyle = `rgba(${FX_ART.white},${a.toFixed(3)})`
            ctx.lineWidth = Math.max(1.5, (0.4 + 0.6 * Math.sin(u * Math.PI)) * scaleAt(cam, (p0.depth + p1.depth) / 2))
            ctx.lineCap = 'round'
            ctx.beginPath()
            ctx.moveTo(p0.x, p0.y)
            ctx.lineTo(p1.x, p1.y)
            ctx.stroke()
            ctx.restore()
          }
        }
        break
      }
      default:
        break
    }
  }
}

// ── air pass ─────────────────────────────────────────────────────────────────

function drawSparkle(ctx: CanvasRenderingContext2D, d: FxDraw, t: number, it: FxItem): void {
  const span = Math.max(1e-6, it.t1 - it.t0)
  const u = clamp((t - it.t0) / span, 0, 1)
  const w = d.toWorld(it.anchor.x, it.anchor.y)
  const p = project(d.cam, w.x, w.y, it.anchor.z)
  if (!p) return
  const r = (10 + 30 * u) * d.dpr * (it.expanding ? 1 : 0.6)
  const a = (1 - u) * it.intensity
  if (a <= 0.02) return
  ctx.save()
  ctx.strokeStyle = `${FX_ART.sparkle}${a.toFixed(3)})`
  ctx.lineWidth = Math.max(1, 2 * d.dpr)
  ctx.beginPath()
  ctx.arc(p.x, p.y, r, 0, TAU)
  ctx.stroke()
  ctx.beginPath()
  for (let i = 0; i < 4; i++) {
    const ang = (i * Math.PI) / 2 + 0.4
    ctx.moveTo(p.x + Math.cos(ang) * r * 0.3, p.y + Math.sin(ang) * r * 0.3)
    ctx.lineTo(p.x + Math.cos(ang) * r * 0.75, p.y + Math.sin(ang) * r * 0.75)
  }
  ctx.stroke()
  ctx.restore()
}

function drawBurstSpokes(ctx: CanvasRenderingContext2D, d: FxDraw, t: number, it: FxItem, pal: FxPalette): void {
  const span = Math.max(1e-6, it.t1 - it.t0)
  const u = clamp((t - it.t0) / span, 0, 1)
  const w = d.toWorld(it.anchor.x, it.anchor.y)
  const p = project(d.cam, w.x, w.y, 1.1)
  const ph = project(d.cam, w.x, w.y, 0)
  if (!p || !ph) return
  const h = Math.abs(ph.y - p.y)
  const team = teamColor(pal, it.team)
  ctx.save()
  ctx.lineCap = 'round'
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * TAU + 0.2
    const r0 = h * (0.35 + u * 0.5)
    const r1 = r0 + h * (0.25 + 0.25 * (i % 2)) * (1 - u)
    ctx.strokeStyle = i % 3 === 0 ? `${FX_ART.sparkle}${((1 - u) * 0.9).toFixed(3)})` : `${rgbaOf(team)}${((1 - u) * 0.85).toFixed(3)})`
    ctx.lineWidth = Math.max(1, (i % 2 ? 2 : 3) * d.dpr * (1 - u * 0.5))
    ctx.beginPath()
    ctx.moveTo(p.x + Math.cos(ang) * r0, p.y + Math.sin(ang) * r0 * 0.8)
    ctx.lineTo(p.x + Math.cos(ang) * r1, p.y + Math.sin(ang) * r1 * 0.8)
    ctx.stroke()
  }
  ctx.restore()
}

/** `rgb(r,g,b)` for an `#rrggbb`/`#rgb` string; otherwise the neutral effect white. */
function rgbaOf(css: string): string {
  const hex = parseHex(css)
  return hex ? `${hex[0]},${hex[1]},${hex[2]}` : FX_ART.white
}
function parseHex(s: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function drawParticles(ctx: CanvasRenderingContext2D, d: FxDraw, t: number, anim: BroadcastAnim, it: FxItem, pal: FxPalette): void {
  const bits = fxParticles(anim, it, t, d.quality)
  if (!bits.length) return
  const conf = it.kind === 'celebration'
  const team = rgbaOf(teamColor(pal, it.team))
  const neutrals = [FX_ART.neutral, FX_ART.dirt, FX_ART.grass]
  for (const b of bits) {
    const w = d.toWorld(b.x, b.y)
    const p = project(d.cam, w.x, w.y, b.z)
    if (!p) continue
    const r = Math.max(1, b.size * 0.06 * scaleAt(d.cam, p.depth))
    ctx.globalAlpha = clamp(b.alpha, 0, 1)
    if (conf) ctx.fillStyle = b.shade === 0 ? `rgb(${team})` : b.shade === 1 ? teamColor(pal, it.team) : FX_ART.confNeutral
    else ctx.fillStyle = neutrals[b.shade % neutrals.length]
    if (conf) {
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(b.spin)
      ctx.fillRect(-r / 2, -r / 4, r, r / 2)
      ctx.restore()
    } else {
      ctx.fillRect(p.x - r / 2, p.y - r / 2, r, r)
    }
  }
  ctx.globalAlpha = 1
}

function drawGlints(ctx: CanvasRenderingContext2D, d: FxDraw, t: number, it: FxItem): void {
  const span = Math.max(1e-6, it.t1 - it.t0)
  const u = clamp((t - it.t0) / span, 0, 1)
  const a = (1 - u) * it.intensity
  if (a <= 0.02) return
  const n = Math.max(2, it.count)
  const halfY = 3.08
  for (let i = 0; i < n; i++) {
    const y = it.anchor.y - halfY + (2 * halfY * i) / (n - 1)
    const w = d.toWorld(it.anchor.x, y)
    const p = project(d.cam, w.x, w.y, it.anchor.z + 0.05 * Math.sin(u * Math.PI))
    if (!p) continue
    const r = Math.max(2, 0.22 * scaleAt(d.cam, p.depth)) * (0.7 + 0.6 * Math.sin(i * 2.1 + u * 5))
    ctx.save()
    ctx.globalAlpha = clamp(a * (0.6 + 0.4 * Math.sin(i * 1.7)), 0, 1)
    ctx.strokeStyle = `${FX_ART.sparkle}0.95)`
    ctx.lineWidth = Math.max(1, 1.6 * d.dpr)
    ctx.beginPath()
    ctx.moveTo(p.x - r, p.y)
    ctx.lineTo(p.x + r, p.y)
    ctx.moveTo(p.x, p.y - r)
    ctx.lineTo(p.x, p.y + r)
    ctx.stroke()
    ctx.restore()
  }
  ctx.globalAlpha = 1
}

export function drawFxAir(ctx: CanvasRenderingContext2D, d: FxDraw, t: number, anim: BroadcastAnim, schedule: readonly FxItem[], pal: FxPalette): void {
  for (const it of schedule) {
    if (it.kind === 'pylon' && t >= it.t0 && t <= it.t1) {
      const u = clamp((t - it.t0) / Math.max(1e-6, it.t1 - it.t0), 0, 1)
      const w = d.toWorld(it.anchor.x, it.anchor.y)
      const p = project(d.cam, w.x, w.y, it.anchor.z)
      if (p) {
        ctx.save()
        ctx.globalAlpha = (1 - u) * it.intensity
        ctx.fillStyle = FX_ART.neutral
        ctx.beginPath()
        ctx.arc(p.x, p.y, Math.max(2, 1.2 * scaleAt(d.cam, p.depth)), 0, TAU)
        ctx.fill()
        ctx.restore()
      }
      continue
    }
    if (it.kind === 'glint') {
      if (t >= it.t0 && t <= it.t1) drawGlints(ctx, d, t, it)
      continue
    }
    if (it.kind === 'sparkle' && t >= it.t0 && t <= it.t1) {
      drawSparkle(ctx, d, t, it)
      continue
    }
    if (it.kind === 'burst' && t >= it.t0 && t <= it.t1) {
      drawBurstSpokes(ctx, d, t, it, pal)
      continue
    }
    if (it.count > 0) drawParticles(ctx, d, t, anim, it, pal)
  }
}

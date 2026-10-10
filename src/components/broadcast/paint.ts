// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B2): Canvas 2D primitives on top of camera.ts — projected
// polygons, perspective-subdivided textures, depth-scaled strokes, offscreen
// canvases. All drawing is in canvas pixels with an identity base transform.
// ─────────────────────────────────────────────────────────────────────────────
import { clipPolygon, project, type Camera, type Vec3 } from './camera.ts'

export type Ctx = CanvasRenderingContext2D

/** Offscreen canvas (DOM canvas for Safari compatibility). */
export function makeCanvas(w: number, h: number, paint?: (g: Ctx, w: number, h: number) => void): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, Math.round(w))
  cv.height = Math.max(1, Math.round(h))
  if (paint) {
    const g = cv.getContext('2d')
    if (g) paint(g, cv.width, cv.height)
  }
  return cv
}

/** Add a projected, near-clipped polygon to the current path. False when nothing is visible. */
export function pathPoly(ctx: Ctx, c: Camera, pts: readonly Vec3[]): boolean {
  const s = clipPolygon(c, pts)
  if (s.length < 3) return false
  ctx.moveTo(s[0][0], s[0][1])
  for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0], s[i][1])
  ctx.closePath()
  return true
}

export function fillPoly(ctx: Ctx, c: Camera, pts: readonly Vec3[], style: string | CanvasGradient): void {
  ctx.beginPath()
  if (pathPoly(ctx, c, pts)) {
    ctx.fillStyle = style
    ctx.fill()
  }
}

/** A world-space segment stroked with a width in yards (scaled by depth). */
export function strokeWorld(ctx: Ctx, c: Camera, a: Vec3, b: Vec3, widthYd: number, minPx = 1): void {
  const p = project(c, a[0], a[1], a[2])
  const q = project(c, b[0], b[1], b[2])
  if (!p || !q) return
  ctx.lineWidth = Math.max(minPx, (widthYd * c.focal) / ((p.depth + q.depth) / 2))
  ctx.beginPath()
  ctx.moveTo(p.x, p.y)
  ctx.lineTo(q.x, q.y)
  ctx.stroke()
}

/**
 * Map an image onto the world parallelogram o + s·U + r·V (s, r in 0..1; the
 * image's top edge sits at r = 1, its left edge at s = 0), subdivided into
 * nx × ny affine cells for perspective. Cells closer than `minDepth` are
 * skipped (an affine cell that near the lens distorts badly).
 */
export function drawTex(
  ctx: Ctx,
  c: Camera,
  img: HTMLCanvasElement,
  o: Vec3,
  U: Vec3,
  V: Vec3,
  nx: number,
  ny: number,
  alpha = 1,
  minDepth = 5,
): void {
  const iw = img.width
  const ih = img.height
  const cw = iw / nx
  const ch = ih / ny
  const G: ({ x: number; y: number; depth: number } | null)[] = new Array((nx + 1) * (ny + 1))
  let any = false
  for (let j = 0; j <= ny; j++) {
    const r = 1 - j / ny
    for (let i = 0; i <= nx; i++) {
      const s = i / nx
      const p = project(c, o[0] + U[0] * s + V[0] * r, o[1] + U[1] * s + V[1] * r, o[2] + U[2] * s + V[2] * r)
      G[j * (nx + 1) + i] = p
      if (p) any = true
    }
  }
  if (!any) return
  const cvW = ctx.canvas.width
  const cvH = ctx.canvas.height
  ctx.save()
  ctx.globalAlpha = alpha
  const ov = 0.9
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p00 = G[j * (nx + 1) + i]
      const p10 = G[j * (nx + 1) + i + 1]
      const p01 = G[(j + 1) * (nx + 1) + i]
      const p11 = G[(j + 1) * (nx + 1) + i + 1]
      if (!p00 || !p10 || !p01 || !p11) continue
      if (Math.min(p00.depth, p10.depth, p01.depth, p11.depth) < minDepth) continue
      // Cheap off-screen reject.
      const minX = Math.min(p00.x, p10.x, p01.x, p11.x)
      const maxX = Math.max(p00.x, p10.x, p01.x, p11.x)
      const minY = Math.min(p00.y, p10.y, p01.y, p11.y)
      const maxY = Math.max(p00.y, p10.y, p01.y, p11.y)
      if (maxX < 0 || maxY < 0 || minX > cvW || minY > cvH) continue
      const ax = (p10.x - p00.x + (p11.x - p01.x)) / 2 / cw
      const ay = (p10.y - p00.y + (p11.y - p01.y)) / 2 / cw
      const bx = (p01.x - p00.x + (p11.x - p10.x)) / 2 / ch
      const by = (p01.y - p00.y + (p11.y - p10.y)) / 2 / ch
      if (Math.abs(ax * by - ay * bx) < 1e-6) continue
      const mx = (p00.x + p10.x + p01.x + p11.x) / 4
      const my = (p00.y + p10.y + p01.y + p11.y) / 4
      const ix = i * cw + cw / 2
      const iy = j * ch + ch / 2
      ctx.setTransform(ax, ay, bx, by, mx - ax * ix - bx * iy, my - ay * ix - by * iy)
      ctx.drawImage(img, i * cw, j * ch, cw, ch, i * cw - ov, j * ch - ov, cw + 2 * ov, ch + 2 * ov)
    }
  }
  ctx.restore()
}

/** Deterministic PRNG (mulberry32) for textures. */
export function rng(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The display font stack from the app's CSS tokens (falls back off-DOM). */
export function displayFont(): string {
  if (typeof document === 'undefined') return '"Barlow Condensed", "Arial Narrow", sans-serif'
  const v = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim()
  return v || '"Barlow Condensed", "Arial Narrow", sans-serif'
}

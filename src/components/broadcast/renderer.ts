// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B2): the renderer. Owns a <canvas>, sizes it for the device
// pixel ratio (capped), and paints one frame per draw() call:
//
//   1. static layer — sky, field ground (turf, end zones, markings), stands +
//      LED walls, pylons + goalposts. Painted into an offscreen cache canvas
//      (with a margin) and re-used while the camera has not moved
//      meaningfully: the cache is re-projected with a 2D affine fitted on the
//      ground around the focus and re-painted only when that affine is off by
//      more than `cacheTolerancePx` anywhere on a set of probe points. The
//      renderer times re-projected vs re-painted frames and switches
//      re-projection off where it is not clearly cheaper (software raster);
//      then a moving camera paints the static layer straight into the view and
//      the cache is only used while the camera holds still.
//   2. turf paint — line of scrimmage, first-down line, down & distance plate
//      (per frame, on the turf, so actors drawn later occlude them).
//   3. hooks.actors — B3 players / B4 ball and effects.
//   4. hooks.overlay — telestrator etc. (B6); then a cached vignette.
//
// Everything is drawn in canvas (device) pixels with an identity transform;
// the Camera handed to hooks is in the same pixels (see `dpr` in LayerInfo).
// ─────────────────────────────────────────────────────────────────────────────
import { NFL_TEAMS } from '../../game/data/nflTeams'
import {
  applyAffine,
  FIELD_LENGTH,
  FIELD_WIDTH,
  fitAffine,
  invertAffine,
  makeCamera,
  MID_WIDTH,
  offenseXToWorld,
  project,
  type Affine,
  type Camera,
  type CameraPose,
  type Direction,
  type Vec3,
} from './camera.ts'
import { buildFieldTextures, buildTurfGraphic, drawFieldFurniture, drawFieldGround, drawTurfGraphic, drawTurfLines, type FieldTextures } from './field.ts'
import { displayFont, makeCanvas, type Ctx } from './paint.ts'
import { NEUTRAL_CLUB, type ClubLike } from './palette.ts'
import { buildStadiumTextures, BOWL, drawSky, drawStands, type StadiumTextures } from './stadium.ts'

/** One frame's inputs. */
export interface BroadcastFrame {
  camera: CameraPose
  /** Line of scrimmage in playAnim's offense frame (own goal line 10, attacking 110). Null hides it. */
  losYard: number | null
  /** First-down line in the offense frame. Null (or in the end zone) hides it — goal to go. */
  firstDownYard: number | null
  /** 1: the offense attacks toward world +x (the right end zone); −1: toward −x. */
  direction: Direction
  homeTeamId: string
  awayTeamId: string
  /** Which club has the ball (LED boards chant DEFENSE when the home club defends). */
  possession?: 'home' | 'away'
  /** 0..1 fade for the LOS / first-down lines (default 1). */
  lineAlpha?: number
  /** On-turf down & distance plate, e.g. "3RD & 6"; null/undefined hides it. */
  turfText?: string | null
  /** 0..1 fade for the plate (default 1). */
  turfTextAlpha?: number
  /** Free-form clock for hooks (seconds). */
  time?: number
}

export interface LayerInfo {
  /** Device pixel ratio the canvas is rendered at (CSS px × dpr = canvas px). */
  dpr: number
  /** Canvas pixel size. */
  width: number
  height: number
}

export type LayerHook = (ctx: CanvasRenderingContext2D, cam: Camera, frame: BroadcastFrame, info: LayerInfo) => void

export interface FrameStats {
  /** Total draw() time (ms, CPU side; GPU work on accelerated canvases is not included). */
  ms: number
  /** Time spent re-painting the static layer this frame (0 on a hit / reuse). */
  staticMs: number
  /**
   * 'hit': cache blitted as-is; 'reuse': cache re-projected with an affine;
   * 'miss': cache re-painted; 'direct': painted straight into the view (camera
   * moving and re-projection switched off).
   */
  cache: 'hit' | 'reuse' | 'miss' | 'direct'
  width: number
  height: number
  dpr: number
}

export interface RendererOptions {
  /** Max device pixel ratio (default 2). */
  dprCap?: number
  /** Max probe error (canvas px) for re-using the static cache (default 1). */
  cacheTolerancePx?: number
  /** Cache margin as a fraction of the larger canvas side (default 0.06). */
  cacheMargin?: number
  /** End-zone paint: the home club in both (default) or home left / away right. */
  endZones?: 'home' | 'split'
  /**
   * Paint goalposts into the static layer (default true). B3 can turn this off
   * and call field.ts drawGoalposts() in depth order with the players.
   */
  goalposts?: boolean
  /** Darken the frame edges (default true). */
  vignette?: boolean
  /** Club lookup (default: NFL_TEAMS by id). */
  resolveClub?: (id: string) => ClubLike | undefined
  onFrame?: (stats: FrameStats) => void
}

const defaultResolve = (id: string): ClubLike | undefined => NFL_TEAMS.find((t) => t.id === id || t.abbr === id)

/** Probe points for the cache check: field corners, mid-lines, bowl walls and stand tops. */
const PROBES: Vec3[] = (() => {
  const P: Vec3[] = []
  for (const x of [0, 30, 60, 90, FIELD_LENGTH]) for (const y of [0, MID_WIDTH, FIELD_WIDTH]) P.push([x, y, 0])
  const { x0, x1, y0, y1, wall, rise, depth } = BOWL
  for (const x of [x0, 60, x1]) {
    P.push([x, y0, wall], [x, y1, wall], [x, y0 - depth, wall + rise], [x, y1 + depth, wall + rise])
  }
  for (const y of [y0, MID_WIDTH, y1]) {
    P.push([x0, y, wall], [x1, y, wall], [x0 - depth, y, wall + rise], [x1 + depth, y, wall + rise])
  }
  P.push([0, MID_WIDTH, 13.3], [FIELD_LENGTH, MID_WIDTH, 13.3])
  return P
})()

function samePose(a: CameraPose, b: CameraPose): boolean {
  return (
    a.fovDeg === b.fovDeg &&
    a.pos[0] === b.pos[0] &&
    a.pos[1] === b.pos[1] &&
    a.pos[2] === b.pos[2] &&
    a.target[0] === b.target[0] &&
    a.target[1] === b.target[1] &&
    a.target[2] === b.target[2]
  )
}

/** Rolling frame-time window (avg / p95 / worst) for stats displays and auto quality. */
export class FrameWindow {
  private buf: number[] = []
  private size: number
  constructor(size = 120) {
    this.size = size
  }
  push(ms: number): void {
    this.buf.push(ms)
    if (this.buf.length > this.size) this.buf.shift()
  }
  get count(): number {
    return this.buf.length
  }
  get avg(): number {
    return this.buf.length ? this.buf.reduce((a, b) => a + b, 0) / this.buf.length : 0
  }
  get p95(): number {
    if (!this.buf.length) return 0
    const s = [...this.buf].sort((a, b) => a - b)
    return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]
  }
  get worst(): number {
    return this.buf.length ? Math.max(...this.buf) : 0
  }
}

interface StaticCache {
  canvas: HTMLCanvasElement
  ctx: Ctx
  cam: Camera
  margin: number
  key: string
}

export class BroadcastRenderer {
  readonly canvas: HTMLCanvasElement
  /** Layer hooks: set by B3/B4 (actors) and B6 (overlay). */
  hooks: { actors?: LayerHook; overlay?: LayerHook } = {}
  onFrame?: (stats: FrameStats) => void

  private ctx: Ctx
  private opts: Required<Omit<RendererOptions, 'onFrame' | 'resolveClub'>> & { resolveClub: (id: string) => ClubLike | undefined }
  private cssW = 0
  private cssH = 0
  private dpr = 1
  private ro: ResizeObserver | null = null
  private cache: StaticCache | null = null
  private fieldTex: FieldTextures | null = null
  private fieldKey = ''
  private standTex: StadiumTextures | null = null
  private standKey = ''
  private turfGraphics = new Map<string, HTMLCanvasElement>()
  private vignette: HTMLCanvasElement | null = null
  private texVersion = 0
  private lastCam: Camera | null = null
  private lastPose: CameraPose | null = null
  /** Re-projection pays off on GPU canvases; on software raster it can cost more than a re-paint. */
  private reuse = { enabled: true, nMiss: 0, nReuse: 0, miss: 0, reuseMs: 0 }
  private destroyed = false

  constructor(canvas: HTMLCanvasElement, opts: RendererOptions = {}) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('BroadcastRenderer: no 2D context')
    this.ctx = ctx
    this.opts = {
      dprCap: opts.dprCap ?? 2,
      cacheTolerancePx: opts.cacheTolerancePx ?? 1,
      cacheMargin: opts.cacheMargin ?? 0.06,
      endZones: opts.endZones ?? 'home',
      vignette: opts.vignette ?? true,
      goalposts: opts.goalposts ?? true,
      resolveClub: opts.resolveClub ?? defaultResolve,
    }
    this.onFrame = opts.onFrame
    this.measure()
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.measure())
      this.ro.observe(canvas)
    }
    // Text textures use the display font: rebuild once it has loaded.
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (!this.destroyed) this.invalidateTextures()
      })
    }
  }

  /** Change the DPR cap (e.g. Lite quality). */
  setDprCap(cap: number): void {
    this.opts.dprCap = cap
    this.measure()
  }

  /** Drop every texture and the static cache (fonts loaded, club colours changed…). */
  invalidateTextures(): void {
    this.texVersion++
    this.fieldTex = null
    this.standTex = null
    this.turfGraphics.clear()
    this.cache = null
  }

  /** Force the static layer to re-paint on the next frame. */
  invalidate(): void {
    this.cache = null
  }

  /** The camera used for the last frame (canvas pixels), for hit-testing / B5 probes. */
  get camera(): Camera | null {
    return this.lastCam
  }

  get pixelRatio(): number {
    return this.dpr
  }

  /** Re-read the canvas's CSS size and resize the backing store. True if it changed. */
  measure(): boolean {
    const r = this.canvas.getBoundingClientRect()
    const dpr = Math.max(1, Math.min(this.opts.dprCap, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1))
    const w = Math.max(1, Math.round(r.width * dpr))
    const h = Math.max(1, Math.round(r.height * dpr))
    if (w === this.canvas.width && h === this.canvas.height && dpr === this.dpr && r.width === this.cssW && r.height === this.cssH) return false
    this.cssW = r.width
    this.cssH = r.height
    this.dpr = dpr
    this.canvas.width = w
    this.canvas.height = h
    this.cache = null
    this.vignette = null
    this.reuse = { enabled: true, nMiss: 0, nReuse: 0, miss: 0, reuseMs: 0 }
    return true
  }

  destroy(): void {
    this.destroyed = true
    this.ro?.disconnect()
    this.ro = null
    this.cache = null
    this.turfGraphics.clear()
  }

  private club(id: string): ClubLike {
    return this.opts.resolveClub(id) ?? { ...NEUTRAL_CLUB, id }
  }

  private ensureTextures(frame: BroadcastFrame): { field: FieldTextures; stands: StadiumTextures; key: string } {
    const font = displayFont()
    const home = this.club(frame.homeTeamId)
    const away = this.club(frame.awayTeamId)
    const right = this.opts.endZones === 'split' ? away : home
    const fk = `${home.id}|${right.id}|${home.primary}|${home.secondary}|${right.primary}|${right.secondary}`
    if (!this.fieldTex || fk !== this.fieldKey) {
      this.fieldTex = buildFieldTextures(home, right, home, font)
      this.fieldKey = fk
    }
    const homeD = frame.possession === 'away'
    const sk = `${home.id}|${away.id}|${home.primary}|${away.primary}|${homeD ? 'D' : 'O'}`
    if (!this.standTex || sk !== this.standKey) {
      this.standTex = buildStadiumTextures(home, away, homeD, font)
      this.standKey = sk
    }
    return { field: this.fieldTex, stands: this.standTex, key: `${fk}#${sk}#${this.texVersion}` }
  }

  private paintStatic(target: Ctx, cam: Camera, field: FieldTextures, stands: StadiumTextures): void {
    target.setTransform(1, 0, 0, 1, 0, 0)
    drawSky(target, target.canvas.width, target.canvas.height)
    drawFieldGround(target, cam, field)
    drawStands(target, cam, stands)
    drawFieldFurniture(target, cam, { goalposts: this.opts.goalposts })
  }

  /**
   * Compare what a re-projected frame costs with a re-painted one (running
   * means over the first frames of each kind); switch re-projection off when
   * it is not clearly cheaper (software rasterisers resample slowly).
   */
  private learnReuse(mode: FrameStats['cache'], ms: number): void {
    const r = this.reuse
    if (!r.enabled) return
    if (mode === 'miss' && r.nMiss < 30) {
      r.miss += (ms - r.miss) / ++r.nMiss
    } else if (mode === 'reuse' && r.nReuse < 30) {
      r.reuseMs += (ms - r.reuseMs) / ++r.nReuse
    }
    if (r.nMiss >= 6 && r.nReuse >= 6 && r.reuseMs > r.miss * 0.75) r.enabled = false
  }

  /** Whether the static cache is re-projected for small camera moves (see learnReuse). */
  get reprojecting(): boolean {
    return this.reuse.enabled
  }

  /** Affine that maps the cache onto the current camera, or null if it is off by more than the tolerance. */
  private reuseAffine(cache: StaticCache, cam: Camera): Affine | null {
    const [tx, ty] = cam.pose.target
    // Three ground anchors around the focus.
    const anchors: Vec3[] = [
      [tx, ty, 0],
      [tx + cam.rhx * 12, ty + cam.rhy * 12, 0],
      [tx + cam.fhx * 12, ty + cam.fhy * 12, 0],
    ]
    const src: [number, number][] = []
    const dst: [number, number][] = []
    for (const a of anchors) {
      const p = project(cache.cam, a[0], a[1], a[2])
      const q = project(cam, a[0], a[1], a[2])
      if (!p || !q) return null
      src.push([p.x, p.y])
      dst.push([q.x, q.y])
    }
    const A = fitAffine(src, dst)
    if (!A) return null
    const tol = this.opts.cacheTolerancePx
    const W = cam.width
    const H = cam.height
    for (const P of PROBES) {
      const q = project(cam, P[0], P[1], P[2])
      const p = project(cache.cam, P[0], P[1], P[2])
      if (!q && !p) continue
      if (!q || !p) {
        // Visible in one camera only: fine if it is off-screen in the other.
        if (q && q.x > -50 && q.x < W + 50 && q.y > -50 && q.y < H + 50) return null
        continue
      }
      if (q.x < -50 || q.x > W + 50 || q.y < -50 || q.y > H + 50) continue
      const [mx, my] = applyAffine(A, p.x, p.y)
      if (Math.abs(mx - q.x) > tol || Math.abs(my - q.y) > tol) return null
    }
    // The cache must cover the whole viewport.
    const inv = invertAffine(A)
    if (!inv) return null
    const cw = cache.canvas.width
    const ch = cache.canvas.height
    for (const [vx, vy] of [
      [0, 0],
      [W, 0],
      [0, H],
      [W, H],
    ]) {
      const [sx, sy] = applyAffine(inv, vx, vy)
      if (sx < 0 || sy < 0 || sx > cw || sy > ch) return null
    }
    return A
  }

  private getVignette(w: number, h: number): HTMLCanvasElement {
    if (this.vignette && this.vignette.width === w && this.vignette.height === h) return this.vignette
    this.vignette = makeCanvas(w, h, (g) => {
      const r = Math.hypot(w, h) / 2
      const gr = g.createRadialGradient(w / 2, h * 0.55, r * 0.45, w / 2, h * 0.55, r)
      gr.addColorStop(0, 'rgba(0,0,0,0)')
      gr.addColorStop(1, 'rgba(0,0,0,.42)')
      g.fillStyle = gr
      g.fillRect(0, 0, w, h)
    })
    return this.vignette
  }

  /** Paint one frame. Returns (and reports via onFrame) the frame cost. */
  draw(frame: BroadcastFrame): FrameStats {
    const t0 = performance.now()
    const ctx = this.ctx
    const W = this.canvas.width
    const H = this.canvas.height
    const cam = makeCamera(frame.camera, { width: W, height: H })
    this.lastCam = cam
    const { field, stands, key } = this.ensureTextures(frame)
    const cacheKey = `${key}|${W}x${H}`

    // 1. static layer
    const s0 = performance.now()
    let mode: FrameStats['cache'] = 'miss'
    let A: Affine | null = null
    const keyOk = !!this.cache && this.cache.key === cacheKey
    if (keyOk && this.cache && samePose(this.cache.cam.pose, frame.camera)) A = [1, 0, 0, 1, -this.cache.margin, -this.cache.margin]
    else if (keyOk && this.cache && this.reuse.enabled) A = this.reuseAffine(this.cache, cam)
    const moving = !!this.lastPose && !samePose(this.lastPose, frame.camera)
    this.lastPose = frame.camera
    if (A && this.cache) {
      const identity = Math.abs(A[0] - 1) < 1e-4 && Math.abs(A[3] - 1) < 1e-4 && Math.abs(A[1]) < 1e-4 && Math.abs(A[2]) < 1e-4
      mode = identity ? 'hit' : 'reuse'
      ctx.setTransform(A[0], A[1], A[2], A[3], A[4], A[5])
      ctx.imageSmoothingEnabled = mode !== 'hit' || A[4] % 1 !== 0 || A[5] % 1 !== 0
      ctx.drawImage(this.cache.canvas, 0, 0)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.imageSmoothingEnabled = true
    } else if (!this.reuse.enabled && moving) {
      // Re-projection is slower than painting here (software raster): while
      // the camera keeps moving, paint straight into the view.
      mode = 'direct'
      this.paintStatic(ctx, cam, field, stands)
    } else {
      // Paint the cache (with a margin when it may be re-projected), then blit.
      const margin = this.reuse.enabled ? Math.round(Math.max(W, H) * this.opts.cacheMargin) : 0
      let cv = this.cache?.canvas
      if (!cv || cv.width !== W + 2 * margin || cv.height !== H + 2 * margin) cv = makeCanvas(W + 2 * margin, H + 2 * margin)
      const cctx = cv.getContext('2d')
      if (!cctx) throw new Error('BroadcastRenderer: no cache context')
      // Same focal length as the view, principal point shifted into the margin.
      const ccam = makeCamera(frame.camera, { width: W, height: H, offsetX: margin, offsetY: margin })
      ccam.width = W + 2 * margin
      ccam.height = H + 2 * margin
      this.paintStatic(cctx, ccam, field, stands)
      this.cache = { canvas: cv, ctx: cctx, cam: ccam, margin, key: cacheKey }
      ctx.drawImage(cv, -margin, -margin)
    }
    const staticMs = performance.now() - s0
    this.learnReuse(mode, staticMs)

    // 2. turf paint
    const dir = frame.direction
    if (frame.turfText && frame.losYard != null) {
      let img = this.turfGraphics.get(frame.turfText)
      if (!img) {
        img = buildTurfGraphic(frame.turfText, displayFont())
        this.turfGraphics.set(frame.turfText, img)
      }
      drawTurfGraphic(ctx, cam, img, frame.losYard, dir, 0.9 * (frame.turfTextAlpha ?? 1))
    }
    drawTurfLines(ctx, cam, {
      losX: frame.losYard == null ? null : offenseXToWorld(frame.losYard, dir),
      firstDownX: frame.firstDownYard == null ? null : offenseXToWorld(frame.firstDownYard, dir),
      alpha: frame.lineAlpha,
    })

    // 3–4. hooks + vignette
    const info: LayerInfo = { dpr: this.dpr, width: W, height: H }
    if (this.hooks.actors) {
      ctx.save()
      this.hooks.actors(ctx, cam, frame, info)
      ctx.restore()
    }
    if (this.hooks.overlay) {
      ctx.save()
      this.hooks.overlay(ctx, cam, frame, info)
      ctx.restore()
    }
    if (this.opts.vignette) ctx.drawImage(this.getVignette(W, H), 0, 0)

    const stats: FrameStats = { ms: performance.now() - t0, staticMs: mode === 'hit' || mode === 'reuse' ? 0 : staticMs, cache: mode, width: W, height: H, dpr: this.dpr }
    this.onFrame?.(stats)
    return stats
  }
}

export { FIELD_LENGTH, FIELD_WIDTH, MID_WIDTH }

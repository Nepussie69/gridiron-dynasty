// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B3): pre-rendered sprite parts for the player figures.
//
// The static-looking parts of a figure — torso (pants top, jersey, pads,
// collar), jersey number, helmet (shell, stripe, decal, facemask) — are
// painted once into small offscreen canvases and blitted with drawImage; the
// limbs stay live (they animate every frame). A part is keyed by
//   kit (club + home/away + colours) × facing bucket × quantised scale
// and rendered at the bucket's scale (always ≥ the drawn size, so blits only
// shrink). Numbers are their own parts (kit × number × scale) and are squashed
// with the torso at draw time.
//
// Built only after document.fonts.ready (the numbers use the display font):
// until then get() returns null and figures paint directly. LRU-capped by
// entry count and by total pixels. New parts per frame (beginFrame()) are
// capped by count (`buildsPerFrame`) AND by time (`buildMs` since beginFrame),
// with at least one build per frame, so a cold cache (camera cut to a new
// scale, resize, full window, fonts.ready) does not blow the frame budget —
// the rest paint directly that frame and are built on the next ones.
// clear() on a new matchup / colour change.
// ─────────────────────────────────────────────────────────────────────────────
import { displayFont, makeCanvas } from './paint.ts'
import {
  HELMET_BOX,
  NUMBER_BOX,
  paintHelmet,
  paintNumber,
  paintTorso,
  TORSO_BOX,
  type Kit,
  type SpritePart,
  type SpriteSource,
} from './figures.ts'

/** Scale buckets: each step is ~15% larger than the last. */
const STEP = 2 ** (1 / 5)
const LOG_STEP = Math.log(STEP)
/** |sdx| buckets for the torso (body width / number squash). */
const AD_STEPS = 5
/** sdx buckets for the helmet (stripe / facemask offset), −1 … 1. */
const SDX_STEPS = 12
/** Facemask visibility buckets (tow): back, edge, three-quarter, front. */
const TOW_VALUES = [-0.5, -0.15, 0.15, 0.5]
/** Padding around a part (px) so outlines are not clipped. */
const PAD = 2

export interface SpriteStats {
  entries: number
  pixels: number
  hits: number
  misses: number
  builds: number
  /** Parts drawn directly because the per-frame build budget ran out. */
  deferred: number
}

interface Entry extends SpritePart {
  px: number
}

export interface SpriteCacheOptions {
  maxEntries?: number
  /** Total pixel budget across all parts (default 6 M px ≈ 24 MB). */
  maxPixels?: number
  buildsPerFrame?: number
  /** Stop building new parts once this many ms have passed since beginFrame() (default 1.5). */
  buildMs?: number
}

export class SpriteCache implements SpriteSource {
  /** True once document.fonts.ready has resolved (parts are only built after). */
  ready = false
  private map = new Map<string, Entry>()
  private pixels = 0
  /** Display font stack used for the numbers (read once; refreshed on fonts.ready / refreshFont()). */
  font = displayFont()
  private maxEntries: number
  private maxPixels: number
  private buildsPerFrame: number
  private buildMs: number
  private frameBuilds = 0
  private frameStart = 0
  private disposed = false
  readonly stats: SpriteStats = { entries: 0, pixels: 0, hits: 0, misses: 0, builds: 0, deferred: 0 }

  constructor(o: SpriteCacheOptions = {}) {
    this.maxEntries = o.maxEntries ?? 700
    this.maxPixels = o.maxPixels ?? 6_000_000
    this.buildsPerFrame = o.buildsPerFrame ?? 12
    this.buildMs = o.buildMs ?? 1.5
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (this.disposed) return
        this.font = displayFont()
        this.clear()
        this.ready = true
      })
    }
  }

  /** Re-read the display font token (theme change); drops the number parts only when it changed. */
  refreshFont(): void {
    const f = displayFont()
    if (f === this.font) return
    this.font = f
    for (const k of [...this.map.keys()]) if (k.startsWith('N|')) this.drop(k)
  }

  /** Call once per frame before drawing figures (resets the build budget). */
  beginFrame(): void {
    this.frameBuilds = 0
    this.frameStart = performance.now()
  }

  /** Drop every part (club / colour change, fonts loaded). */
  clear(): void {
    this.map.clear()
    this.pixels = 0
    this.stats.entries = 0
    this.stats.pixels = 0
  }

  dispose(): void {
    this.disposed = true
    this.clear()
  }

  private drop(key: string): void {
    const o = this.map.get(key)
    if (!o) return
    this.map.delete(key)
    this.pixels -= o.canvas.width * o.canvas.height
    this.stats.entries = this.map.size
    this.stats.pixels = this.pixels
  }

  torso(kit: Kit, ad: number, front: boolean, px: number, detail: boolean): SpritePart | null {
    const a = Math.round(Math.min(1, Math.max(0, ad)) * (AD_STEPS - 1)) / (AD_STEPS - 1)
    const b = bucket(px)
    const key = `T|${kit.id}|${a}|${front ? 1 : 0}|${detail ? 1 : 0}|${b}`
    return this.get(key, b, TORSO_BOX, (g) => paintTorso(g, kit, a, front, detail), false)
  }

  number(kit: Kit, n: number, px: number): SpritePart | null {
    const b = bucket(px)
    const key = `N|${kit.id}|${n}|${b}`
    return this.get(key, b, NUMBER_BOX, (g, q) => paintNumber(g, kit, n, q, this.font), true)
  }

  helmet(kit: Kit, sdx: number, tow: number, px: number, detail: boolean): SpritePart | null {
    const s = Math.round(Math.max(-1, Math.min(1, sdx)) * (SDX_STEPS / 2)) / (SDX_STEPS / 2)
    const w = TOW_VALUES[tow < -0.3 ? 0 : tow < 0 ? 1 : tow < 0.3 ? 2 : 3]
    const b = bucket(px)
    const key = `H|${kit.id}|${s}|${w}|${detail ? 1 : 0}|${b}`
    return this.get(key, b, HELMET_BOX, (g) => paintHelmet(g, kit, s, w, detail), false)
  }

  private get(
    key: string,
    b: number,
    box: { x: number; y: number; w: number; h: number },
    paint: (g: CanvasRenderingContext2D, px: number) => void,
    pixelSpace: boolean,
  ): SpritePart | null {
    if (!this.ready) return null
    const hit = this.map.get(key)
    if (hit) {
      // LRU: move to the newest end.
      this.map.delete(key)
      this.map.set(key, hit)
      this.stats.hits++
      return hit
    }
    this.stats.misses++
    if (this.frameBuilds >= 1 && (this.frameBuilds >= this.buildsPerFrame || performance.now() - this.frameStart > this.buildMs)) {
      this.stats.deferred++
      return null
    }
    this.frameBuilds++
    this.stats.builds++
    const px = STEP ** b
    const W = Math.ceil(box.w * px) + 2 * PAD
    const H = Math.ceil(box.h * px) + 2 * PAD
    const cv = makeCanvas(W, H, (g) => {
      if (pixelSpace) g.setTransform(1, 0, 0, 1, -box.x * px + PAD, -box.y * px + PAD)
      else g.setTransform(px, 0, 0, px, -box.x * px + PAD, -box.y * px + PAD)
      paint(g, px)
    })
    const e: Entry = { canvas: cv, x: box.x - PAD / px, y: box.y - PAD / px, w: cv.width / px, h: cv.height / px, px }
    this.map.set(key, e)
    this.pixels += cv.width * cv.height
    while (this.map.size > this.maxEntries || this.pixels > this.maxPixels) {
      const oldest = this.map.keys().next()
      if (oldest.done) break
      const o = this.map.get(oldest.value)
      this.map.delete(oldest.value)
      if (o) this.pixels -= o.canvas.width * o.canvas.height
    }
    this.stats.entries = this.map.size
    this.stats.pixels = this.pixels
    return e
  }
}

/** Scale bucket for `px` pixels per unit (rounded up so blits only shrink). */
export function bucket(px: number): number {
  return Math.ceil(Math.log(Math.max(1, px)) / LOG_STEP - 1e-6)
}

// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B6a): paint the broadcast graphics (graphics.ts decides what
// and when) on BroadcastRenderer.hooks.overlay, in screen space, in the Sunday
// Broadcast style: skewed slabs (−10°), condensed italic display type, team
// slabs with contrast-checked ink (dark-slab lift: line-strong ring + fill-2
// stripe), the always-dark `.broadcast` token set.
//
//   const gfx = new GraphicsLayer(actorLayer)          // ActorLayer: head points + carrier
//   renderer.hooks.overlay = gfx.hook
//   gfx.setTimeline(buildGraphicsTimeline({ … }))
//   gfx.sec = …; gfx.mode = 'full' | 'fast' | 'off'; gfx.reducedMotion = …
//
// The renderer paints its vignette AFTER the overlay hook, which would dim the
// corner HUD; construct the renderer with `vignette: false` and set
// `gfx.vignette = true` — the layer paints the same vignette first, then the
// graphics on top.
//
// All sizes are CSS px × a layout scale (canvas width / 1100, clamped) × DPR;
// text never goes below MIN_TEXT_PX CSS px. Text widths are cached per font.
// Node-importable (DOM is only touched for the vignette and token reads).
// ─────────────────────────────────────────────────────────────────────────────
import { bestInk, contrast, INK_DARK, INK_LIGHT, mixHex, parseHex, pickAccent, toHex } from '../../lib/teamColor.ts'
import type { ActorScreen } from './actors.ts'
import {
  graphicsAt,
  layoutCallouts,
  rectHitsCircle,
  type Accent,
  type CalloutRequest,
  type CalloutSide,
  type Circle,
  type GraphicsFrame,
  type GraphicsMode,
  type GraphicsTimeline,
  type PlacedCallout,
  type Rect,
} from './graphics.ts'
import { ART, type ClubLike } from './palette.ts'
import type { LayerHook, LayerInfo } from './renderer.ts'

// ── tokens ───────────────────────────────────────────────────────────────────

export interface GfxTokens {
  canvas: string
  surface: string
  lineStrong: string
  ink: string
  ink2: string
  muted: string
  gold: string
  win: string
  loss: string
  fontDisplay: string
  fontCond: string
}

/**
 * The always-dark `.broadcast` values from src/index.css (the canvas is
 * broadcast art: dark in both app themes). Used off-DOM and when a variable
 * cannot be read; scripts/check-broadcast.ts keeps these equal to index.css.
 */
export const BROADCAST_TOKENS: GfxTokens = {
  canvas: '#090D14', // check-hex-allow: mirror of .broadcast --color-canvas (node / fallback)
  surface: '#111723', // check-hex-allow: mirror of .broadcast --color-surface
  lineStrong: '#57657D', // check-hex-allow: mirror of .broadcast --color-line-strong
  ink: '#F3F6FB', // check-hex-allow: mirror of .broadcast --color-ink
  ink2: '#C5CEDC', // check-hex-allow: mirror of .broadcast --color-ink-2
  muted: '#97A3B6', // check-hex-allow: mirror of .broadcast --color-muted
  gold: '#F3B53F', // check-hex-allow: mirror of .broadcast --color-gold
  win: '#3CCB82', // check-hex-allow: mirror of .broadcast --color-win
  loss: '#F26670', // check-hex-allow: mirror of .broadcast --color-loss
  fontDisplay: '"Barlow Condensed", "Arial Narrow", sans-serif',
  fontCond: '"Barlow Semi Condensed", "Arial Narrow", sans-serif',
}

const TOKEN_VARS: Record<keyof GfxTokens, string> = {
  canvas: '--color-canvas',
  surface: '--color-surface',
  lineStrong: '--color-line-strong',
  ink: '--color-ink',
  ink2: '--color-ink-2',
  muted: '--color-muted',
  gold: '--color-gold',
  win: '--color-win',
  loss: '--color-loss',
  fontDisplay: '--font-display',
  fontCond: '--font-cond',
}

/**
 * Read the tokens from an element inside a `.broadcast` scope (the canvas in
 * Game Day / the preview). Colours that are not 6-digit hex (or missing) keep
 * the BROADCAST_TOKENS value, so a light-theme read can never leak in.
 */
export function readGfxTokens(el?: Element | null): GfxTokens {
  const out: GfxTokens = { ...BROADCAST_TOKENS }
  if (typeof getComputedStyle === 'undefined' || !el) return out
  const cs = getComputedStyle(el)
  for (const k of Object.keys(TOKEN_VARS) as (keyof GfxTokens)[]) {
    const v = cs.getPropertyValue(TOKEN_VARS[k]).trim()
    if (!v) continue
    if (k === 'fontDisplay' || k === 'fontCond') out[k] = v
    else if (/^#[0-9a-f]{6}$/i.test(v)) out[k] = v
  }
  // Only trust a dark read (the overlay sits on the dark broadcast field).
  if (contrast(out.ink, out.canvas) < 7 || parseLum(out.canvas) > 0.1) return { ...BROADCAST_TOKENS, fontDisplay: out.fontDisplay, fontCond: out.fontCond }
  return out
}

function parseLum(hex: string): number {
  const p = parseHex(hex)
  return p ? (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255 : 0
}

/** `rgba()` of a hex token at alpha a. */
export function rgba(hex: string, a: number): string {
  const p = parseHex(hex) ?? [0, 0, 0]
  return `rgba(${p[0]},${p[1]},${p[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`
}

/** Minimum ink contrast on a team slab (small text on the slab). */
export const SLAB_INK_MIN = 4.5
/** Below this contrast against the canvas a slab gets the lift (ring + stripe). */
export const SLAB_LIFT_BELOW = 1.5

export interface ClubSlab {
  /** Slab fill (the primary, shaded away from its ink only if it must be). */
  fill: string
  ink: string
  /** fill-2 stripe (the secondary). */
  edge: string
  /** Fill too close to the canvas: draw a line-strong ring and the stripe. */
  lift: boolean
  /** Accent for bars on the dark canvas (≥ 3:1 on the broadcast surface). */
  accent: string
}

/** Contrast-checked slab colours for one club on the dark broadcast canvas. */
export function clubSlab(club: ClubLike, tokens: GfxTokens = BROADCAST_TOKENS): ClubSlab {
  const p = parseHex(club.primary) ? toHex(parseHex(club.primary)!) : tokens.surface
  const s = parseHex(club.secondary) ? toHex(parseHex(club.secondary)!) : tokens.lineStrong
  let fill = p
  let ink = bestInk(fill)
  for (let i = 1; i <= 20 && contrast(ink, fill) < SLAB_INK_MIN; i++) {
    // Shade away from the ink until it reads.
    fill = mixHex(p, ink === INK_DARK ? INK_LIGHT : INK_DARK, i * 0.03)
    ink = bestInk(fill)
  }
  const lift = contrast(fill, tokens.canvas) < SLAB_LIFT_BELOW
  const edge = contrast(s, fill) >= 1.5 ? s : mixHex(fill, ink, 0.45)
  const accent = pickAccent(p, s, tokens.surface, 3, 'dark').color
  return { fill, ink, edge, lift, accent }
}

// ── sizes (CSS px at layout scale 1) ─────────────────────────────────────────

/** Smallest text the graphics draw (CSS px). */
export const MIN_TEXT_PX = 12

export const GFX_SIZE = {
  margin: 16,
  chipH: 32,
  chipTeam: 19,
  chipDown: 19,
  chipLabel: 12,
  chipValue: 17,
  chipConcept: 13,
  chipClock: 18,
  lowerH: 52,
  lowerNum: 26,
  lowerName: 22,
  lowerStat: 13,
  toastH: 84,
  toastBig: 50,
  toastHead: 26,
  toastBadge: 14,
  toastSub: 13,
  toastStatValue: 19,
  toastStatLabel: 12,
  calloutH: 42,
  calloutTitle: 17,
  calloutSub: 12.5,
  lead: 22,
} as const

/** Layout scale for a canvas CSS width (1100 px = 1). */
export function layoutScale(cssWidth: number): number {
  return Math.max(0.8, Math.min(1.25, cssWidth / 1100))
}

const SKEW = Math.tan((10 * Math.PI) / 180)
const ELL = '…'

// ── the layer ────────────────────────────────────────────────────────────────

/** Where the layer reads actor head points and the ball carrier (ActorLayer fits). */
export interface ActorSource {
  screenOf(key: string): ActorScreen | undefined
  holderAt(t: number): string | null
}

export interface GraphicsStats {
  /** Graphics draw time this frame (ms). */
  ms: number
  callouts: number
}

interface Fonts {
  key: string
  px: (n: number) => number
  disp: (n: number, w?: number) => string
  cond: (n: number, w?: number) => string
}

export class GraphicsLayer {
  /** Graphics clock (seconds; see graphics.ts). */
  sec = 0
  mode: GraphicsMode = 'full'
  reducedMotion = false
  /** Paint the renderer's vignette first (renderer built with vignette: false). */
  vignette = false
  /** CSS px kept clear at the bottom for DOM controls over the canvas (B8: Game Day's replay pill). */
  bottomInset = 0
  tokens: GfxTokens
  stats: GraphicsStats = { ms: 0, callouts: 0 }
  /** Last frame's graphics state and placed callouts (B6b / checks). */
  lastFrame: GraphicsFrame | null = null
  lastPlaced: PlacedCallout[] = []
  /** Last frame's HUD rects (canvas px), for the telestrator to stay clear of. */
  lastHud: Rect[] = []

  private actors: ActorSource | null
  private tl: GraphicsTimeline | null = null
  private slabs: { off: ClubSlab; def: ClubSlab } | null = null
  private widths = new Map<string, number>()
  private fonts: Fonts | null = null
  private sides = new Map<string, CalloutSide>()
  private vig: { w: number; h: number; cv: HTMLCanvasElement } | null = null

  constructor(actors: ActorSource | null, tokens: GfxTokens = BROADCAST_TOKENS) {
    this.actors = actors
    this.tokens = tokens
  }

  setTimeline(tl: GraphicsTimeline | null): void {
    this.tl = tl
    this.sides.clear()
    this.slabs = tl ? { off: clubSlab(tl.offense, this.tokens), def: clubSlab(tl.defense, this.tokens) } : null
  }

  get timeline(): GraphicsTimeline | null {
    return this.tl
  }

  setTokens(t: GfxTokens): void {
    this.tokens = t
    this.widths.clear()
    this.fonts = null
    if (this.tl) this.setTimeline(this.tl)
  }

  /** The renderer hook (overlay). */
  readonly hook: LayerHook = (ctx, _cam, _frame, info) => this.draw(ctx, info)

  /** Paint at `this.sec` into a canvas (identity transform, canvas px). */
  draw(ctx: CanvasRenderingContext2D, info: LayerInfo): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0
    if (this.vignette) this.paintVignette(ctx, info.width, info.height)
    const tl = this.tl
    this.lastPlaced = []
    this.lastHud = []
    if (!tl || this.mode === 'off') {
      this.lastFrame = null
      this.stats = { ms: (typeof performance !== 'undefined' ? performance.now() : 0) - t0, callouts: 0 }
      return
    }
    const g = graphicsAt(tl, this.sec, { reducedMotion: this.reducedMotion, mode: this.mode })
    this.lastFrame = g
    const dpr = info.dpr
    const S = layoutScale(info.width / dpr)
    const F = this.fontsFor(S, dpr)
    const m = GFX_SIZE.margin * S * dpr
    // The carrier's head: nothing may cover it.
    const holder = this.actors?.holderAt(g.t) ?? null
    const hs = holder ? this.actors?.screenOf(holder) : undefined
    const carrier: Circle | null = hs ? { x: hs.headX, y: hs.headY, r: headRadius(hs, dpr) + 6 * dpr } : null
    ctx.save()
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    // HUD: chip (top-left), lower third / toast (bottom-left).
    const hud: Rect[] = []
    if (g.chip) hud.push(this.drawChip(ctx, g, F, m, S, dpr, carrier))
    if (g.toast) hud.push(this.drawToast(ctx, g.toast, F, m, S, dpr, info, carrier))
    else if (g.lower) hud.push(this.drawLower(ctx, g.lower, F, m, S, dpr, carrier))
    this.lastHud = hud
    // Callouts.
    if (g.callouts.length && this.actors) {
      const reqs: (CalloutRequest & { alpha: number; enter: number; title: string; sub: string; accent: Accent })[] = []
      const avoid: Circle[] = carrier ? [carrier] : []
      const byPriority = [...g.callouts].sort((a, b) => b.item.priority - a.item.priority || (a.item.id < b.item.id ? -1 : 1))
      for (const c of byPriority) {
        const s = this.actors.screenOf(c.item.anchor)
        if (!s) continue
        avoid.push({ x: s.headX, y: s.headY, r: headRadius(s, dpr) + 3 * dpr })
        const padX = 12 * S * dpr
        const w = Math.max(this.measure(ctx, F.disp(GFX_SIZE.calloutTitle), c.item.title), this.measure(ctx, F.cond(GFX_SIZE.calloutSub), c.item.sub)) + padX * 2 + GFX_SIZE.calloutH * S * dpr * SKEW
        reqs.push({ id: c.item.id, ax: s.headX, ay: s.top, w, h: GFX_SIZE.calloutH * S * dpr, alpha: c.alpha, enter: c.enter, title: c.item.title, sub: c.item.sub, accent: c.item.accent })
      }
      const placed = layoutCallouts(reqs, { width: info.width, height: info.height, margin: 6 * dpr, lead: GFX_SIZE.lead * S * dpr, avoid, reserved: hud, prev: this.sides })
      this.sides.clear()
      for (const p of placed) {
        this.sides.set(p.id, p.side)
        const r = reqs.find((x) => x.id === p.id)!
        this.drawCallout(ctx, p, r, F, S, dpr)
      }
      this.lastPlaced = placed
    } else this.sides.clear()
    ctx.restore()
    this.stats = { ms: (typeof performance !== 'undefined' ? performance.now() : 0) - t0, callouts: this.lastPlaced.length }
  }

  // ── pieces ────────────────────────────────────────────────────────────────

  private fontsFor(S: number, dpr: number): Fonts {
    const key = `${S}|${dpr}|${this.tokens.fontDisplay}|${this.tokens.fontCond}`
    if (this.fonts?.key === key) return this.fonts
    const px = (n: number) => Math.max(MIN_TEXT_PX, n * S) * dpr
    const fd = this.tokens.fontDisplay
    const fc = this.tokens.fontCond
    const cache = new Map<string, string>()
    const mk = (k: string, f: () => string) => {
      let v = cache.get(k)
      if (!v) cache.set(k, (v = f()))
      return v
    }
    this.fonts = {
      key,
      px,
      disp: (n, w = 800) => mk(`d${n}|${w}`, () => `italic ${w} ${px(n).toFixed(2)}px ${fd}`),
      cond: (n, w = 600) => mk(`c${n}|${w}`, () => `${w} ${px(n).toFixed(2)}px ${fc}`),
    }
    this.widths.clear()
    return this.fonts
  }

  private measure(ctx: CanvasRenderingContext2D, font: string, text: string): number {
    const k = `${font}|${text}`
    let w = this.widths.get(k)
    if (w == null) {
      ctx.font = font
      w = ctx.measureText(text).width
      if (this.widths.size > 600) this.widths.clear()
      this.widths.set(k, w)
    }
    return w
  }

  /** Text cut with an ellipsis to fit maxW. */
  private fit(ctx: CanvasRenderingContext2D, font: string, text: string, maxW: number): string {
    if (this.measure(ctx, font, text) <= maxW) return text
    let lo = 0
    let hi = text.length
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.measure(ctx, font, text.slice(0, mid).trimEnd() + ELL) <= maxW) lo = mid
      else hi = mid - 1
    }
    return lo > 0 ? text.slice(0, lo).trimEnd() + ELL : ''
  }

  private text(ctx: CanvasRenderingContext2D, font: string, fill: string, s: string, x: number, y: number): void {
    ctx.font = font
    ctx.fillStyle = fill
    ctx.fillText(s, x, y)
  }

  /** Skewed slab x0..x1 (left edge at the bottom), height h from y. */
  private slab(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, h: number, fill: string): void {
    const k = h * SKEW
    ctx.beginPath()
    ctx.moveTo(x0 + k, y)
    ctx.lineTo(x1 + k, y)
    ctx.lineTo(x1, y + h)
    ctx.lineTo(x0, y + h)
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
  }

  /** Team slab with the dark-slab lift (line-strong ring + fill-2 stripe). */
  private teamSlab(ctx: CanvasRenderingContext2D, sl: ClubSlab, x0: number, x1: number, y: number, h: number, dpr: number, S: number): void {
    this.slab(ctx, x0, x1, y, h, sl.fill)
    const k = h * SKEW
    const sw = (sl.lift ? 6 : 3) * S * dpr
    // fill-2 stripe on the trailing edge.
    ctx.beginPath()
    ctx.moveTo(x1 + k - sw, y)
    ctx.lineTo(x1 + k, y)
    ctx.lineTo(x1, y + h)
    ctx.lineTo(x1 - sw, y + h)
    ctx.closePath()
    ctx.fillStyle = sl.edge
    ctx.fill()
    if (sl.lift) {
      ctx.beginPath()
      ctx.moveTo(x0 + k, y + 0.5 * dpr)
      ctx.lineTo(x1 + k, y + 0.5 * dpr)
      ctx.lineTo(x1, y + h - 0.5 * dpr)
      ctx.lineTo(x0, y + h - 0.5 * dpr)
      ctx.closePath()
      ctx.lineWidth = dpr
      ctx.strokeStyle = this.tokens.lineStrong
      ctx.stroke()
    }
  }

  /** Cheap drop shadow (no shadowBlur): a dark slab offset down. */
  private shade(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, h: number, dpr: number): void {
    this.slab(ctx, x0 + 2 * dpr, x1 + 2 * dpr, y + 4 * dpr, h, 'rgba(0,0,0,.38)')
  }

  /** Clip for the wipe-in (left → right). */
  private wipe(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, enter: number): void {
    if (enter >= 1) return
    ctx.beginPath()
    ctx.rect(x - 4, y - 8, (w + 8 + h) * enter, h + 16)
    ctx.clip()
  }

  /** 0.3 when the carrier's head is under a HUD rect (the HUD yields), else 1. */
  private yieldTo(r: Rect, carrier: Circle | null): number {
    return carrier && rectHitsCircle(r, carrier) ? 0.3 : 1
  }

  private drawChip(ctx: CanvasRenderingContext2D, g: GraphicsFrame, F: Fonts, m: number, S: number, dpr: number, carrier: Circle | null): Rect {
    const chip = g.chip!
    const it = chip.item
    const tk = this.tokens
    const sl = this.slabs!.off
    const h = GFX_SIZE.chipH * S * dpr
    const pad = 10 * S * dpr
    const k = h * SKEW
    const x = m
    const y = m
    const tl = this.tl!
    const fTeam = F.disp(GFX_SIZE.chipTeam)
    const fDown = F.disp(GFX_SIZE.chipDown)
    const fLab = F.cond(GFX_SIZE.chipLabel)
    const fVal = F.disp(GFX_SIZE.chipValue)
    const fCon = F.cond(GFX_SIZE.chipConcept)
    const fClk = F.disp(GFX_SIZE.chipClock, 700)
    const wTeam = this.measure(ctx, fTeam, tl.offense.abbr) + pad * 2 + k
    const wDown = this.measure(ctx, fDown, it.down) + pad * 2
    const spotLab = 'BALL ON'
    const wSpot = it.spot ? this.measure(ctx, fLab, spotLab) + 6 * S * dpr + this.measure(ctx, fVal, it.spot) + pad * 2 : 0
    const clock = g.clock
    const clockText = clock ? `:${String(clock.value).padStart(2, '0')}` : ''
    const wClock = clock ? this.measure(ctx, fClk, ':00') + pad * 2 : 0
    const conceptA = it.concept ? chip.preSnap : 0
    const maxW = ctx.canvas.width - 2 * m
    const baseW = wTeam + wDown + wSpot + wClock + k
    const concept = it.concept && conceptA > 0 ? this.fit(ctx, fCon, it.concept, Math.max(0, Math.min(260 * S * dpr, maxW - baseW - pad * 2))) : ''
    const wCon = concept ? this.measure(ctx, fCon, concept) + pad * 2 : 0
    const W = baseW + wCon
    const rect: Rect = { x, y, w: W, h }
    ctx.save()
    ctx.globalAlpha = chip.alpha * this.yieldTo(rect, carrier)
    this.wipe(ctx, x, y, W, h, chip.enter)
    this.shade(ctx, x, x + W - k, y, h, dpr)
    let cx = x
    // Team.
    this.teamSlab(ctx, sl, cx, cx + wTeam, y, h, dpr, S)
    this.text(ctx, fTeam, sl.ink, tl.offense.abbr, cx + k + pad - 2 * S * dpr, y + h / 2 + dpr)
    cx += wTeam
    // Down & distance (first-down yellow; flashes at the line to gain).
    const dd = chip.flash > 0 ? mixHex(ART.turfGraphicBar, INK_LIGHT, 0.75 * chip.flash) : ART.turfGraphicBar
    this.slab(ctx, cx, cx + wDown, y, h, dd)
    this.text(ctx, fDown, INK_DARK, it.down, cx + pad + k * 0.5, y + h / 2 + dpr)
    cx += wDown
    // Spot, concept, clock on the dark plate.
    const plateW = wSpot + wCon + wClock
    if (plateW > 0) this.slab(ctx, cx, cx + plateW, y, h, rgba(tk.canvas, 0.92))
    if (wSpot) {
      this.text(ctx, fLab, tk.muted, spotLab, cx + pad + k * 0.5, y + h / 2 + dpr)
      this.text(ctx, fVal, tk.ink, it.spot, cx + pad + k * 0.5 + this.measure(ctx, fLab, spotLab) + 6 * S * dpr, y + h / 2 + dpr)
      cx += wSpot
    }
    if (wCon) {
      ctx.save()
      ctx.globalAlpha *= conceptA
      this.text(ctx, fCon, tk.ink2, concept, cx + pad, y + h / 2 + dpr)
      ctx.restore()
      cx += wCon
    }
    if (clock && wClock) {
      ctx.save()
      ctx.globalAlpha *= clock.alpha
      this.text(ctx, fClk, clock.urgent ? tk.loss : tk.gold, clockText, cx + pad, y + h / 2 + dpr)
      ctx.restore()
    }
    ctx.restore()
    return rect
  }

  private drawLower(ctx: CanvasRenderingContext2D, lo: NonNullable<GraphicsFrame['lower']>, F: Fonts, m: number, S: number, dpr: number, carrier: Circle | null): Rect {
    const it = lo.item
    const tk = this.tokens
    const sl = it.side === 'off' ? this.slabs!.off : this.slabs!.def
    const h = GFX_SIZE.lowerH * S * dpr
    const k = h * SKEW
    const pad = 12 * S * dpr
    const x = m
    const y = ctx.canvas.height - m - h - this.bottomInset * dpr
    const fNum = F.disp(GFX_SIZE.lowerNum)
    const fName = F.disp(GFX_SIZE.lowerName)
    const fStat = F.cond(GFX_SIZE.lowerStat)
    const num = it.number != null ? `#${it.number}` : it.pos
    const wNum = Math.max(this.measure(ctx, fNum, num) + pad * 2, 56 * S * dpr) + k
    const maxBody = Math.min(520 * S * dpr, ctx.canvas.width - 2 * m - wNum - k)
    const line2 = `${it.pos}${it.stat ? ` · ${it.stat}` : ''}`
    const name = this.fit(ctx, fName, it.name, maxBody - pad * 2)
    const stat = this.fit(ctx, fStat, line2, maxBody - pad * 2)
    const wBody = Math.min(maxBody, Math.max(this.measure(ctx, fName, name), this.measure(ctx, fStat, stat)) + pad * 2 + k)
    const W = wNum + wBody
    const rect: Rect = { x, y, w: W + k, h }
    ctx.save()
    ctx.globalAlpha = lo.alpha * this.yieldTo(rect, carrier)
    this.wipe(ctx, x, y, W, h, lo.enter)
    this.shade(ctx, x, x + W, y, h, dpr)
    this.teamSlab(ctx, sl, x, x + wNum, y, h, dpr, S)
    this.text(ctx, fNum, sl.ink, num, x + k + pad - 4 * S * dpr, y + h / 2 + dpr)
    const bx = x + wNum
    this.slab(ctx, bx, bx + wBody, y, h, rgba(tk.canvas, 0.94))
    // Team accent rule along the top.
    this.slab(ctx, bx + k - 3 * dpr * SKEW, bx + wBody + k - 3 * dpr * SKEW, y, 3 * S * dpr, sl.accent)
    const tx = bx + pad + k * 0.6
    this.text(ctx, fName, tk.ink, name, tx, y + h * 0.38)
    this.text(ctx, fStat, tk.ink2, stat, tx - k * 0.25, y + h * 0.74)
    ctx.restore()
    return rect
  }

  private drawToast(ctx: CanvasRenderingContext2D, to: NonNullable<GraphicsFrame['toast']>, F: Fonts, m: number, S: number, dpr: number, info: LayerInfo, carrier: Circle | null): Rect {
    const it = to.item
    const tk = this.tokens
    const sl = it.side === 'off' ? this.slabs!.off : this.slabs!.def
    const h = GFX_SIZE.toastH * S * dpr
    const k = h * SKEW
    const pad = 14 * S * dpr
    const x = m
    const y = info.height - m - h - this.bottomInset * dpr
    const fBig = F.disp(GFX_SIZE.toastBig)
    const fHead = F.disp(GFX_SIZE.toastHead)
    const fBadge = F.disp(GFX_SIZE.toastBadge)
    const fSub = F.cond(GFX_SIZE.toastSub)
    const fVal = F.disp(GFX_SIZE.toastStatValue)
    const fLab = F.cond(GFX_SIZE.toastStatLabel)
    const wBig = this.measure(ctx, fBig, it.big) + pad * 2 + k
    const maxBody = Math.min(640 * S * dpr, info.width - 2 * m - wBig - k)
    const inner = maxBody - pad * 2 - k
    const head = this.fit(ctx, fHead, it.head, inner * 0.6)
    const wHead = this.measure(ctx, fHead, head)
    const gapX = 10 * S * dpr
    const badgeW = it.badge ? this.measure(ctx, fBadge, it.badge.label) + 16 * S * dpr + k : 0
    const showBadge = !!it.badge && wHead + gapX + badgeW <= inner
    const sub = this.fit(ctx, fSub, it.sub, inner)
    // Stats: as many as fit.
    const col = 14 * S * dpr
    const stats: { v: string; l: string; w: number }[] = []
    let sw = 0
    for (const s of it.stats) {
      const w = Math.max(this.measure(ctx, fVal, s.value), this.measure(ctx, fLab, s.label))
      if (sw + w + (stats.length ? col : 0) > inner) break
      stats.push({ v: s.value, l: s.label, w })
      sw += w + (stats.length > 1 ? col : 0)
    }
    const contentW = Math.max(wHead + (showBadge ? gapX + badgeW : 0), this.measure(ctx, fSub, sub), sw)
    const wBody = Math.min(maxBody, contentW + pad * 2 + k)
    const W = wBig + wBody
    const rect: Rect = { x, y, w: W + k, h }
    ctx.save()
    ctx.globalAlpha = to.alpha * this.yieldTo(rect, carrier)
    this.wipe(ctx, x, y, W, h, to.enter)
    this.shade(ctx, x, x + W, y, h, dpr)
    this.teamSlab(ctx, sl, x, x + wBig, y, h, dpr, S)
    this.text(ctx, fBig, sl.ink, it.big, x + pad + k * 0.55, y + h / 2 + 2 * dpr)
    const bx = x + wBig
    this.slab(ctx, bx, bx + wBody, y, h, rgba(tk.canvas, 0.95))
    this.slab(ctx, bx + k - 3 * dpr * SKEW, bx + wBody + k - 3 * dpr * SKEW, y, 3 * S * dpr, sl.accent)
    const tx = bx + pad + k * 0.75
    const row1 = y + h * 0.27
    const row2 = y + h * 0.52
    const rowV = y + h * 0.7
    const rowL = y + h * 0.87
    this.text(ctx, fHead, tk.ink, head, tx, row1)
    if (showBadge && it.badge) {
      const bh = GFX_SIZE.toastBadge * S * dpr * 1.55
      const bx0 = tx + wHead + gapX
      const bfill = this.badgeFill(it.badge.kind, sl)
      this.slab(ctx, bx0, bx0 + badgeW - k, row1 - bh / 2, bh, bfill)
      this.text(ctx, fBadge, bestInk(bfill), it.badge.label, bx0 + 8 * S * dpr + bh * SKEW * 0.5, row1 + dpr)
    }
    if (stats.length) {
      this.text(ctx, fSub, tk.ink2, sub, tx - k * 0.2, row2)
      let sx = tx - k * 0.4
      for (const s of stats) {
        this.text(ctx, fVal, tk.ink, s.v, sx, rowV)
        this.text(ctx, fLab, tk.muted, s.l, sx, rowL)
        sx += s.w + col
      }
    } else this.text(ctx, fSub, tk.ink2, sub, tx - k * 0.3, y + h * 0.62)
    ctx.restore()
    return rect
  }

  private badgeFill(kind: string, sl: ClubSlab): string {
    const tk = this.tokens
    switch (kind) {
      case 'firstDown':
      case 'flag':
        return ART.turfGraphicBar
      case 'touchdown':
        return sl.accent
      case 'good':
        return tk.win
      default:
        return tk.loss
    }
  }

  private drawCallout(ctx: CanvasRenderingContext2D, p: PlacedCallout, r: { alpha: number; enter: number; title: string; sub: string; accent: Accent }, F: Fonts, S: number, dpr: number): void {
    const tk = this.tokens
    const accent = r.accent === 'gold' ? ART.turfGraphicBar : r.accent === 'def' ? this.slabs!.def.accent : this.slabs!.off.accent
    const { box } = p
    const h = box.h
    const k = h * SKEW
    ctx.save()
    ctx.globalAlpha = r.alpha
    // Leader: dot on the helmet top, line to the box.
    ctx.strokeStyle = rgba(tk.ink, 0.85)
    ctx.lineWidth = 1.4 * dpr
    ctx.beginPath()
    ctx.moveTo(p.ax, p.ay)
    ctx.lineTo(p.jx, p.jy)
    ctx.stroke()
    ctx.fillStyle = tk.ink
    ctx.beginPath()
    ctx.arc(p.ax, p.ay, 2.6 * dpr, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = 1.2 * dpr
    ctx.strokeStyle = rgba(tk.canvas, 0.9)
    ctx.stroke()
    this.wipe(ctx, box.x, box.y, box.w - k, h, r.enter)
    this.shade(ctx, box.x, box.x + box.w - k, box.y, h, dpr)
    this.slab(ctx, box.x, box.x + box.w - k, box.y, h, rgba(tk.canvas, 0.93))
    this.slab(ctx, box.x, box.x + 4 * S * dpr, box.y, h, accent)
    const tx = box.x + 12 * S * dpr + k * 0.6
    this.text(ctx, F.disp(GFX_SIZE.calloutTitle), tk.ink, r.title, tx, box.y + h * 0.34)
    this.text(ctx, F.cond(GFX_SIZE.calloutSub), tk.ink2, r.sub, tx - k * 0.3, box.y + h * 0.73)
    ctx.restore()
  }

  private paintVignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (typeof document === 'undefined') return
    if (!this.vig || this.vig.w !== w || this.vig.h !== h) {
      const cv = document.createElement('canvas')
      cv.width = w
      cv.height = h
      const g = cv.getContext('2d')
      if (g) {
        // Same gradient as BroadcastRenderer's vignette.
        const r = Math.hypot(w, h) / 2
        const gr = g.createRadialGradient(w / 2, h * 0.55, r * 0.45, w / 2, h * 0.55, r)
        gr.addColorStop(0, 'rgba(0,0,0,0)')
        gr.addColorStop(1, 'rgba(0,0,0,.42)')
        g.fillStyle = gr
        g.fillRect(0, 0, w, h)
      }
      this.vig = { w, h, cv }
    }
    ctx.drawImage(this.vig.cv, 0, 0)
  }
}

/** Helmet radius on screen (canvas px) with a floor. */
function headRadius(s: ActorScreen, dpr: number): number {
  return Math.max(8 * dpr, s.scale * 0.14)
}

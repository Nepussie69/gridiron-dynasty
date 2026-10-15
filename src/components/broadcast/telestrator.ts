// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B6b): paint the telestrator replay (replay.ts decides what
// and when). Two renderer overlay hooks, composed around B6a's graphics:
//
//   tele.hook     (under the HUD) the vignette (taken over from the graphics
//                 layer), the freeze wash and the telestrations: route, yac,
//                 air-yards arc, separation bracket, double-team circle,
//                 pocket outline, pursuit arrows, with their labels
//   gfx.hook      B6a's HUD (chip etc.; run it in mode 'fast' during a replay)
//   tele.topHook  (over the HUD) the REPLAY bug and the team-colour wipe
//
//   const tele = new TelestratorLayer(readGfxTokens(canvas))
//   attachTelestrator(renderer, tele, gfx)          // composes, never replaces
//   tele.setReplay(plan, anim, offenseClub, defenseClub, numbers)
//   per frame: tele.frame = player.advance(dt); tele.mode = 'full' | 'fast' | 'off'
//
// Labels stay clear of the previous frame's HUD rects and callout boxes
// (gfx.lastHud / gfx.lastPlaced; the graphics draw after the telestrator),
// the REPLAY bug, each other and the ball carrier's head; a label that cannot
// be placed is skipped (the stroke still draws). Text >= MIN_TEXT_PX CSS px.
// Reduced motion: no wipe (a straight cut), strokes appear whole (no draw-on).
// Node-importable: DOM is only touched for the cached vignette.
// ─────────────────────────────────────────────────────────────────────────────
import type { ActorScreen } from './actors.ts'
import type { BroadcastAnim } from './animData.ts'
import { ballState } from './ball.ts'
import { offenseToWorld, project, type Camera, type Direction } from './camera.ts'
import { rectHitsCircle, rectsOverlap, type GraphicsMode, type PlacedCallout, type Rect } from './graphics.ts'
import { BROADCAST_TOKENS, clubSlab, layoutScale, MIN_TEXT_PX, rgba, type ClubSlab, type GfxTokens } from './graphicsDraw.ts'
import { posAt } from './interp.ts'
import type { ClubLike } from './palette.ts'
import type { LayerHook, LayerInfo } from './renderer.ts'
import { teleState, type LiveRouteTrace, type ReplayFrame, type ReplayPlan, type TeleInk, type Telestration } from './replay.ts'

/** Telestrator pen: the broadcast yellow marker (not a UI token; pen ink on turf). */
export const TELE_PEN = '#FFE14D' // check-hex-allow: telestrator pen ink (broadcast marker yellow), not a UI colour

/** Label sizes (CSS px at layout scale 1; never below MIN_TEXT_PX). */
export const TELE_TEXT = { big: 26, label: 17, sub: 14, bug: 17, bugSub: 14 } as const

/** Live drawings are a touch lighter than a replay's (readability on every play). */
const LIVE_STROKE_SCALE = 0.82
const LIVE_ALPHA = 0.92
/** Plain route traces (livetele3): thin, low alpha, so no route stands out before the throw. */
const TRACE_W = 2.4
const TRACE_ALPHA = 0.5

/** Deepest the pocket outline reaches behind the shallowest OL (yd). */
const POCKET_MAX_DEPTH = 6.5

const SKEW = Math.tan((10 * Math.PI) / 180)
const TURF_Z = 0.05

/** Where the layer reads head points (ActorLayer fits). */
export interface TeleActorSource {
  screenOf(key: string): ActorScreen | undefined
  holderAt(t: number): string | null
}

/** What labels must stay clear of (GraphicsLayer fits). */
export interface TeleAvoidSource {
  lastHud: Rect[]
  lastPlaced: PlacedCallout[]
}

export interface TeleStats {
  ms: number
  strokes: number
  labels: number
  skippedLabels: number
}

type Pt = { x: number; y: number }

/** Compose overlay hooks in order (undefined entries are skipped). */
export function composeHooks(...hooks: (LayerHook | undefined | null)[]): LayerHook {
  const hs = hooks.filter((h): h is LayerHook => !!h)
  return (ctx, cam, frame, info) => {
    for (const h of hs) h(ctx, cam, frame, info)
  }
}

/**
 * Wrap the renderer's current overlay: telestrations under it, the wipe + bug
 * over it. If the graphics layer paints the vignette, the telestrator takes it
 * over (so the vignette stays under the strokes). Returns a detach function.
 */
export function attachTelestrator(r: { hooks: { overlay?: LayerHook } }, tele: TelestratorLayer, gfx?: (TeleAvoidSource & { vignette: boolean }) | null): () => void {
  const prev = r.hooks.overlay
  const moved = !!gfx?.vignette
  if (gfx && moved) {
    gfx.vignette = false
    tele.vignette = true
  }
  tele.avoid = gfx ?? null
  const composed = composeHooks(tele.hook, prev, tele.topHook)
  r.hooks.overlay = composed
  return () => {
    if (r.hooks.overlay === composed) r.hooks.overlay = prev
    if (gfx && moved) {
      gfx.vignette = true
      tele.vignette = false
    }
  }
}

export class TelestratorLayer {
  /** This frame of the replay (null = no replay running: draws nothing but the vignette). */
  frame: ReplayFrame | null = null
  /** 'fast' (sim to end) and 'off' never draw telestrations, the bug or the wipe. */
  mode: GraphicsMode = 'full'
  reducedMotion = false
  vignette = false
  tokens: GfxTokens
  actors: TeleActorSource | null
  avoid: TeleAvoidSource | null = null
  stats: TeleStats = { ms: 0, strokes: 0, labels: 0, skippedLabels: 0 }
  /** Last frame's label rects + the bug (canvas px; checks / debugging). */
  lastLabels: Rect[] = []
  lastBug: Rect | null = null
  /** Element ids drawn last frame. */
  lastDrawn: string[] = []
  /** The live play's telestrations (null = none): drawn on every play, no replay needed. */
  private live: { items: Telestration[]; anim: BroadcastAnim; numbers: Record<string, number>; traces: LiveRouteTrace[] } | null = null
  /** Live anim time (0..1) the live drawings sample; the live view sets it each frame. */
  liveT = 0
  /** Stroke width scale: live drawings are a touch thinner than a replay's. */
  private wScale = 1

  private plan: ReplayPlan | null = null
  private anim: BroadcastAnim | null = null
  private slabs: { off: ClubSlab; def: ClubSlab } | null = null
  private numbers: Record<string, number> = {}
  private vig: { w: number; h: number; cv: HTMLCanvasElement } | null = null

  constructor(tokens: GfxTokens = BROADCAST_TOKENS, actors: TeleActorSource | null = null) {
    this.tokens = tokens
    this.actors = actors
  }

  setReplay(plan: ReplayPlan | null, anim: BroadcastAnim | null, offense?: ClubLike, defense?: ClubLike, numbers?: Record<string, number>): void {
    this.plan = plan
    this.anim = anim
    this.numbers = numbers ?? {}
    this.slabs = offense && defense ? { off: clubSlab(offense, this.tokens), def: clubSlab(defense, this.tokens) } : null
  }

  get replay(): ReplayPlan | null {
    return this.plan
  }

  /**
   * The live play's telestrations (from liveTelestrations): painted like a
   * replay's — under the HUD, with the same labels / avoid rules — but timed in
   * live anim seconds and with no REPLAY bug, wipe or freeze wash. null clears
   * them (the next snap, a replay starting, sim to end). `numbers` feed the
   * double-team label; the replay's own numbers are kept separately. `traces`
   * (livetele3) are the plain all-receiver routes drawn under the items.
   */
  setLive(items: Telestration[] | null, anim: BroadcastAnim | null, numbers?: Record<string, number>, traces?: LiveRouteTrace[]): void {
    const t = traces ?? []
    this.live = anim && ((items?.length ?? 0) > 0 || t.length > 0) ? { items: items ?? [], anim, numbers: numbers ?? {}, traces: t } : null
  }

  clearLive(): void {
    this.live = null
  }

  /** The live play's current anim time (0..1 of the play). */
  setLiveTime(t: number): void {
    this.liveT = t < 0 ? 0 : t > 1 ? 1 : t
  }

  private liveActive(): boolean {
    return !!(this.live && (this.live.items.length > 0 || this.live.traces.length > 0) && this.mode === 'full')
  }

  private active(): boolean {
    return !!(this.plan && this.plan.replay && this.anim && this.frame && this.mode === 'full' && this.frame.phase !== 'done')
  }

  /** Under the HUD: vignette, freeze wash, telestrations. */
  readonly hook: LayerHook = (ctx, cam, frame, info) => this.draw(ctx, cam, frame.direction, info)

  /** Over the HUD: the REPLAY bug and the wipe. */
  readonly topHook: LayerHook = (ctx, _cam, _frame, info) => this.drawTop(ctx, info)

  draw(ctx: CanvasRenderingContext2D, cam: Camera, dir: Direction, info: LayerInfo): void {
    const t0 = now()
    if (this.vignette) this.paintVignette(ctx, info.width, info.height)
    this.lastLabels = []
    this.lastDrawn = []
    this.lastBug = null
    const st = { strokes: 0, labels: 0, skipped: 0 }
    // A replay owns the frame while it shows; otherwise the live drawings show
    // (the same strokes, no bug / wipe / freeze wash).
    const replayOn = this.active() && this.frame!.showReplay
    const liveOn = !replayOn && this.liveActive()
    if (replayOn || liveOn) {
      const f = replayOn ? this.frame! : null
      const anim = replayOn ? this.anim! : this.live!.anim
      const items = replayOn ? this.plan!.tele : this.live!.items
      const t = replayOn ? f!.t : this.liveT
      const sec = replayOn ? f!.sec : this.liveT
      const numbers = replayOn ? this.numbers : this.live!.numbers
      this.wScale = liveOn ? LIVE_STROKE_SCALE : 1
      const alphaScale = liveOn ? LIVE_ALPHA : 1
      const dpr = info.dpr
      const S = layoutScale(info.width / dpr) * dpr
      this.lastBug = replayOn ? this.bugRect(ctx, info) : null
      const rects: Rect[] = [...(this.avoid?.lastHud ?? []), ...(this.avoid?.lastPlaced ?? []).map((p) => p.box)]
      if (this.lastBug) rects.push(this.lastBug)
      // The carrier's head is never covered by a label.
      const holder = this.actors?.holderAt(t) ?? null
      const hs = holder ? this.actors?.screenOf(holder) : undefined
      const head = hs ? { x: hs.headX, y: hs.headY, r: Math.max(8 * dpr, hs.scale * 0.14) + 6 * dpr } : null
      ctx.save()
      if (f?.frozen) {
        ctx.fillStyle = rgba(this.tokens.gold, 0.05)
        ctx.fillRect(0, 0, info.width, info.height)
      }
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      const P = (x: number, y: number, z = TURF_Z): Pt | null => {
        const w = offenseToWorld(x, y, dir)
        const p = project(cam, w.x, w.y, z)
        return p ? { x: p.x, y: p.y } : null
      }
      const labels: { text: string; sub?: string; at: Pt; ink: string; size: number }[] = []
      // livetele3: every route runner's plain trace (thin, low alpha) under the
      // items — the eventual target included, so no route stands out before the
      // throw; his highlight only lands on top at the release.
      if (liveOn && this.live!.traces.length) {
        const D = Math.max(0.05, (anim.duration || 0) / 1000)
        const tStep = 0.03 / D
        for (const tr of this.live!.traces) {
          const hi = Math.min(t, tr.t1)
          if (hi <= tr.t0) continue
          const p = anim.actors.find((a) => a.key === tr.key)?.path
          if (!p) continue
          const pts: Pt[] = []
          for (let u = tr.t0; u < hi; u += tStep) {
            const q = posAt(p, u)
            const s = P(q.x, q.y)
            if (s) pts.push(s)
          }
          const qe = posAt(p, hi)
          const se = P(qe.x, qe.y)
          if (se) pts.push(se)
          this.plainStroke(ctx, pts, S, TRACE_W, TELE_PEN, TRACE_ALPHA, alphaScale)
          st.strokes++
        }
      }
      for (const it of items) {
        const s = teleState(it, sec)
        if (s.alpha <= 0) continue
        ctx.globalAlpha = s.alpha * alphaScale
        const lab = this.element(ctx, it, s.draw, t, anim, P, S, numbers)
        st.strokes++
        this.lastDrawn.push(it.id)
        if (lab && s.label && it.label) labels.push({ text: it.label, sub: lab.sub, at: lab.at, ink: this.ink(it.ink), size: lab.size })
      }
      ctx.globalAlpha = 1
      // Labels after every stroke (always on top of the ink).
      for (const L of labels) {
        const r = this.label(ctx, L.text, L.sub, L.at, L.ink, L.size, S, dpr, info, rects, head)
        if (r) {
          rects.push(r)
          this.lastLabels.push(r)
          st.labels++
        } else st.skipped++
      }
      ctx.restore()
    }
    this.stats = { ms: now() - t0, strokes: st.strokes, labels: st.labels, skippedLabels: st.skipped }
  }

  drawTop(ctx: CanvasRenderingContext2D, info: LayerInfo): void {
    if (!this.plan?.replay || !this.frame || this.mode !== 'full' || this.frame.phase === 'done') return
    const f = this.frame
    ctx.save()
    if (f.showReplay) this.drawBug(ctx, info, f)
    if (f.wipe != null && !this.reducedMotion) this.drawWipe(ctx, info, f.wipe)
    ctx.restore()
  }

  // ── elements ──────────────────────────────────────────────────────────────

  private ink(k: TeleInk): string {
    return k === 'pen' ? TELE_PEN : k === 'def' ? this.tokens.loss : this.tokens.ink
  }

  /** Draw one element; returns its label anchor (canvas px) when it has one. */
  private element(
    ctx: CanvasRenderingContext2D,
    it: Telestration,
    draw: number,
    t: number,
    anim: BroadcastAnim,
    P: (x: number, y: number, z?: number) => Pt | null,
    S: number,
    numbers: Record<string, number>,
  ): { at: Pt; size: number; sub?: string } | null {
    const col = this.ink(it.ink)
    const path = (k: string) => anim.actors.find((a) => a.key === k)?.path
    const D = Math.max(0.05, (anim.duration || 0) / 1000)
    const step = 0.03 / D
    switch (it.kind) {
      case 'route':
      case 'yac':
      case 'pursuit': {
        const hi = Math.min(t, it.t1)
        if (hi <= it.t0) return null
        const pts: Pt[] = []
        const p = path(it.keys[0])
        for (let u = it.t0; u < hi; u += step) {
          const q = posAt(p, u)
          const s = P(q.x, q.y)
          if (s) pts.push(s)
        }
        const qe = posAt(p, hi)
        const se = P(qe.x, qe.y)
        if (se) pts.push(se)
        const w = it.kind === 'route' ? 4.5 : it.kind === 'yac' ? 4 : 3
        this.stroke(ctx, pts, S, w, col, it.dashed ? [3, 8] : null)
        if (it.arrow && pts.length > 2 && dist(pts[0], pts[pts.length - 1]) > 6 * S) this.arrowHead(ctx, pts[pts.length - 2], pts[pts.length - 1], S, col)
        const end = posAt(p, it.t1)
        const a = P(end.x, end.y) ?? se
        return a ? { at: a, size: it.kind === 'pursuit' ? TELE_TEXT.sub : TELE_TEXT.label } : null
      }
      case 'airYards': {
        const hi = Math.min(t, it.t1)
        if (hi <= it.t0) return null
        const pts: Pt[] = []
        for (let u = it.t0; u < hi; u += step / 1.5) {
          const b = ballState(anim, u, { reducedMotion: true })
          const s = P(b.x, b.y, Math.max(TURF_Z, b.z))
          if (s) pts.push(s)
        }
        const be = ballState(anim, hi, { reducedMotion: true })
        const se = P(be.x, be.y, Math.max(TURF_Z, be.z))
        if (se) pts.push(se)
        this.stroke(ctx, pts, S, 2.5, col, [3, 6])
        // Label above the top of the arc.
        const um = (it.t0 + it.t1) / 2
        const bm = ballState(anim, um, { reducedMotion: true })
        const a = P(bm.x, bm.y, bm.z + 1.2)
        return a ? { at: a, size: TELE_TEXT.label } : null
      }
      case 'separation': {
        const pa = posAt(path(it.keys[0]), it.at)
        const pb = posAt(path(it.keys[1]), it.at)
        const A = P(pa.x, pa.y)
        const B = P(pb.x, pb.y)
        if (!A || !B) return null
        const E = { x: A.x + (B.x - A.x) * ease(draw), y: A.y + (B.y - A.y) * ease(draw) }
        this.stroke(ctx, [A, E], S, 3.5, col)
        const ang = Math.atan2(B.y - A.y, B.x - A.x) + Math.PI / 2
        const tk = 8 * S
        const tick = (c: Pt) => this.stroke(ctx, [{ x: c.x + Math.cos(ang) * tk, y: c.y + Math.sin(ang) * tk }, { x: c.x - Math.cos(ang) * tk, y: c.y - Math.sin(ang) * tk }], S, 3, col)
        tick(A)
        if (draw >= 0.98) tick(B)
        // Ring under the receiver.
        this.ellipse(ctx, P, pa.x, pa.y, 1.0, 1.0, Math.max(0, (draw - 0.5) / 0.5), S, this.tokens.ink, 2.5)
        return { at: { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }, size: TELE_TEXT.big }
      }
      case 'doubleTeam': {
        const tt = Math.max(it.t0, Math.min(t, it.t1))
        let cx = 0
        let cy = 0
        for (const k of it.keys) {
          const q = posAt(path(k), tt)
          cx += q.x / it.keys.length
          cy += q.y / it.keys.length
        }
        this.ellipse(ctx, P, cx, cy, 1.7, 1.6, draw, S, col, 3.5)
        const a = P(cx, cy + 2.2)
        const [d, b1, b2] = it.keys
        const n = (k: string) => numbers[k]
        const sub = n(b1) != null && n(b2) != null && n(d) != null ? `#${n(b1)} + #${n(b2)} ON #${n(d)}` : undefined
        return a ? { at: a, size: TELE_TEXT.label, sub } : null
      }
      case 'pocket': {
        const qbK = it.keys[it.keys.length - 1]
        const ol = it.keys.slice(0, -1).map((k) => posAt(path(k), it.at))
        ol.sort((a, b) => a.y - b.y)
        const qb = posAt(path(qbK), it.at)
        // The back of the pocket sits behind the QB, but never deeper than a
        // normal 7-step set behind the line (a sacked / flushed QB can be 10+ yd
        // deep, which drew a wide trapezoid — B8).
        let olFront = Infinity
        for (const p of ol) olFront = Math.min(olFront, p.x)
        const back = Math.max(qb.x - 1.6, olFront - POCKET_MAX_DEPTH)
        // The cup closes behind the line's centre (a pocket, not a trapezoid
        // wider than the line), whichever way the QB drifted.
        const mid = (ol[0].y + ol[ol.length - 1].y) / 2
        const half = Math.max(2.2, Math.min(4, (ol[ol.length - 1].y - ol[0].y) * 0.3))
        const ring: { x: number; y: number }[] = [{ x: back, y: mid - half }, ...ol.map((p) => ({ x: Math.max(p.x, qb.x + 1.2) + 0.4, y: p.y })), { x: back, y: mid + half }]
        // Densify (smooth on screen) then draw on.
        const dense: Pt[] = []
        for (let i = 0; i < ring.length - 1; i++) {
          for (let k = 0; k < 6; k++) {
            const u = k / 6
            const s = P(ring[i].x + (ring[i + 1].x - ring[i].x) * u, ring[i].y + (ring[i + 1].y - ring[i].y) * u)
            if (s) dense.push(s)
          }
        }
        const last = P(ring[ring.length - 1].x, ring[ring.length - 1].y)
        if (last) dense.push(last)
        this.stroke(ctx, partial(dense, draw), S, 2.5, col, [8, 6])
        const a = P(back - 1.0, qb.y)
        return a ? { at: a, size: TELE_TEXT.sub } : null
      }
    }
    return null
  }

  private stroke(ctx: CanvasRenderingContext2D, pts: Pt[], S: number, w: number, col: string, dash: number[] | null = null): void {
    if (pts.length < 2) return
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.setLineDash(dash ? dash.map((v) => v * S) : [])
    // Soft glow, dark halo, then the ink (no shadowBlur: cheap).
    const a = ctx.globalAlpha
    const k = this.wScale
    ctx.globalAlpha = a * 0.22
    ctx.strokeStyle = col
    ctx.lineWidth = (w + 7) * S * k
    ctx.stroke()
    ctx.globalAlpha = a
    ctx.strokeStyle = 'rgba(0,0,0,.45)'
    ctx.lineWidth = (w + 3) * S * k
    ctx.stroke()
    ctx.strokeStyle = col
    ctx.lineWidth = w * S * k
    ctx.stroke()
    ctx.setLineDash([])
  }

  /** A plain route trace: one thin, low-alpha ink pass over a dark halo (no glow, no arrow). */
  private plainStroke(ctx: CanvasRenderingContext2D, pts: Pt[], S: number, w: number, col: string, alpha: number, scale: number): void {
    if (pts.length < 2) return
    const a = ctx.globalAlpha
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.globalAlpha = a * alpha * 0.9
    ctx.strokeStyle = 'rgba(0,0,0,.5)'
    ctx.lineWidth = (w + 2) * S * this.wScale
    ctx.stroke()
    ctx.globalAlpha = a * alpha * scale
    ctx.strokeStyle = col
    ctx.lineWidth = w * S * this.wScale
    ctx.stroke()
    ctx.globalAlpha = a
  }

  private arrowHead(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, S: number, col: string): void {
    const ang = Math.atan2(b.y - a.y, b.x - a.x)
    const L = 13 * S
    ctx.beginPath()
    ctx.moveTo(b.x + Math.cos(ang) * 4 * S, b.y + Math.sin(ang) * 4 * S)
    ctx.lineTo(b.x + Math.cos(ang + 2.6) * L, b.y + Math.sin(ang + 2.6) * L)
    ctx.lineTo(b.x + Math.cos(ang - 2.6) * L, b.y + Math.sin(ang - 2.6) * L)
    ctx.closePath()
    ctx.lineWidth = 2 * S * this.wScale
    ctx.strokeStyle = 'rgba(0,0,0,.45)'
    ctx.stroke()
    ctx.fillStyle = col
    ctx.fill()
  }

  /** A hand-drawn ellipse on the turf (1.1 turns, slight wobble), drawn on to `pr`. */
  private ellipse(ctx: CanvasRenderingContext2D, P: (x: number, y: number, z?: number) => Pt | null, cx: number, cy: number, rx: number, ry: number, pr: number, S: number, col: string, w: number): void {
    if (pr <= 0) return
    const pts: Pt[] = []
    const n = 48
    const a0 = -2.2
    const span = 2 * Math.PI * 1.1 * Math.min(1, pr)
    for (let i = 0; i <= n; i++) {
      const a = a0 + (span * i) / n
      const j = 1 + 0.05 * Math.sin(a * 3)
      const p = P(cx + Math.cos(a) * rx * j, cy + Math.sin(a) * ry * j)
      if (p) pts.push(p)
    }
    this.stroke(ctx, pts, S, w, col)
  }

  /** Place + paint one label; null when no position is free. */
  private label(
    ctx: CanvasRenderingContext2D,
    text: string,
    sub: string | undefined,
    at: Pt,
    col: string,
    size: number,
    S: number,
    dpr: number,
    info: LayerInfo,
    rects: Rect[],
    head: { x: number; y: number; r: number } | null,
  ): Rect | null {
    const px = (n: number) => Math.max(MIN_TEXT_PX * dpr, n * (S / dpr) * dpr)
    const f1 = `italic 800 ${px(size).toFixed(2)}px ${this.tokens.fontDisplay}`
    const f2 = `italic 700 ${px(TELE_TEXT.sub).toFixed(2)}px ${this.tokens.fontDisplay}`
    ctx.font = f1
    const w1 = ctx.measureText(text).width
    let w2 = 0
    if (sub) {
      ctx.font = f2
      w2 = ctx.measureText(sub).width
    }
    const h1 = px(size) * 1.1
    const h2 = sub ? px(TELE_TEXT.sub) * 1.15 : 0
    const w = Math.max(w1, w2) + 10 * S
    const h = h1 + h2 + 4 * S
    const off = 18 * S
    const cands: Pt[] = [
      { x: at.x + off + w / 2, y: at.y - off - h / 2 },
      { x: at.x - off - w / 2, y: at.y - off - h / 2 },
      { x: at.x, y: at.y - off - h / 2 },
      { x: at.x + off + w / 2, y: at.y + off + h / 2 },
      { x: at.x - off - w / 2, y: at.y + off + h / 2 },
      { x: at.x, y: at.y + off + h / 2 },
    ]
    const m = 6 * dpr
    for (const c of cands) {
      const r = { x: c.x - w / 2, y: c.y - h / 2, w, h }
      if (r.x < m || r.y < m || r.x + r.w > info.width - m || r.y + r.h > info.height - m) continue
      if (rects.some((q) => rectsOverlap(r, q, 4 * dpr))) continue
      if (head && rectHitsCircle(r, head)) continue
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineJoin = 'round'
      ctx.font = f1
      ctx.lineWidth = 5 * S
      ctx.strokeStyle = 'rgba(0,0,0,.75)'
      const y1 = r.y + 2 * S + h1 / 2
      ctx.strokeText(text, c.x, y1)
      ctx.fillStyle = col
      ctx.fillText(text, c.x, y1)
      if (sub) {
        ctx.font = f2
        ctx.lineWidth = 4 * S
        const y2 = y1 + h1 / 2 + h2 / 2
        ctx.strokeText(sub, c.x, y2)
        ctx.fillStyle = this.tokens.ink
        ctx.fillText(sub, c.x, y2)
      }
      return r
    }
    return null
  }

  // ── bug + wipe ────────────────────────────────────────────────────────────

  private bugFonts(info: LayerInfo) {
    const dpr = info.dpr
    const S = layoutScale(info.width / dpr)
    const px = (n: number) => Math.max(MIN_TEXT_PX, n * S) * dpr
    return {
      S,
      dpr,
      main: `italic 800 ${px(TELE_TEXT.bug).toFixed(2)}px ${this.tokens.fontDisplay}`,
      sub: `italic 700 ${px(TELE_TEXT.bugSub).toFixed(2)}px ${this.tokens.fontDisplay}`,
      h: 32 * S * dpr,
      m: 16 * S * dpr,
      pad: 12 * S * dpr,
    }
  }

  /** The REPLAY bug's rect (top right), sized for the freeze label too. */
  private bugRect(ctx: CanvasRenderingContext2D, info: LayerInfo): Rect {
    const F = this.bugFonts(info)
    ctx.font = F.main
    const w1 = ctx.measureText('REPLAY').width + F.pad * 2 + F.h * SKEW
    let w2 = 0
    const key = this.plan?.key
    if (key) {
      ctx.font = F.sub
      w2 = ctx.measureText(key.label).width + F.pad * 2 + F.h * SKEW
    }
    const w = w1 + w2
    return { x: info.width - F.m - w, y: F.m, w, h: F.h }
  }

  private drawBug(ctx: CanvasRenderingContext2D, info: LayerInfo, f: ReplayFrame): void {
    const F = this.bugFonts(info)
    const r = this.bugRect(ctx, info)
    const sl = this.slabs?.off
    const k = F.h * SKEW
    ctx.font = F.main
    const w1 = ctx.measureText('REPLAY').width + F.pad * 2 + k
    // Team slab + "REPLAY".
    slab(ctx, r.x, r.x + w1, r.y, F.h, sl?.fill ?? this.tokens.surface)
    if (sl?.lift) {
      ctx.lineWidth = F.dpr
      ctx.strokeStyle = this.tokens.lineStrong
      slabPath(ctx, r.x, r.x + w1, r.y, F.h)
      ctx.stroke()
    }
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillStyle = sl?.ink ?? this.tokens.ink
    ctx.fillText('REPLAY', r.x + F.pad + k / 2, r.y + F.h / 2)
    // Freeze: the key moment in gold on the surface slab.
    const key = this.plan?.key
    if (key && f.frozen) {
      ctx.font = F.sub
      const w2 = ctx.measureText(key.label).width + F.pad * 2 + k
      slab(ctx, r.x + w1, r.x + w1 + w2, r.y, F.h, rgba(this.tokens.surface, 0.94))
      ctx.fillStyle = this.tokens.gold
      ctx.fillText(key.label, r.x + w1 + F.pad + k / 2, r.y + F.h / 2)
    }
  }

  /** Team-colour wipe: defence fill | ink | offence stripe | offence fill, sweeping left → right. */
  private drawWipe(ctx: CanvasRenderingContext2D, info: LayerInfo, p: number): void {
    const W = info.width
    const H = info.height
    const k = H * SKEW
    const BW = 1.6 * W + 2 * k
    const u = smooth(Math.max(0, Math.min(1, p)))
    const xL = -BW - k + (W + k + BW + k) * u
    const off = this.slabs?.off
    const def = this.slabs?.def
    // Leading edge (right) is the offence: the club that made the play leads the wipe.
    const bands: [number, number, string][] = [
      [0, 0.3, def?.fill ?? this.tokens.canvas],
      [0.3, 0.33, this.tokens.ink],
      [0.33, 0.41, off?.edge ?? this.tokens.lineStrong],
      [0.41, 1, off?.fill ?? this.tokens.surface],
    ]
    for (const [a, b, c] of bands) slab(ctx, xL + BW * a, xL + BW * b + 1, 0, H, c)
  }

  private paintVignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (typeof document === 'undefined') return
    if (!this.vig || this.vig.w !== w || this.vig.h !== h) {
      const cv = document.createElement('canvas')
      cv.width = w
      cv.height = h
      const g = cv.getContext('2d')
      if (g) {
        // Same gradient as BroadcastRenderer's / GraphicsLayer's vignette.
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

// ── small helpers ────────────────────────────────────────────────────────────

const now = () => (typeof performance !== 'undefined' ? performance.now() : 0)
const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y)
const ease = (v: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, v)), 3)
const smooth = (v: number) => v * v * (3 - 2 * v)

/** The first `frac` (0..1) of a polyline by length. */
export function partial(pts: Pt[], frac: number): Pt[] {
  if (frac >= 1 || pts.length < 2) return pts
  if (frac <= 0) return []
  let total = 0
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i])
  let left = total * frac
  const out: Pt[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i])
    if (d >= left) {
      const u = d > 0 ? left / d : 0
      out.push({ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * u, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * u })
      return out
    }
    left -= d
    out.push(pts[i])
  }
  return out
}

function slabPath(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, h: number): void {
  const k = h * SKEW
  ctx.beginPath()
  ctx.moveTo(x0 + k, y)
  ctx.lineTo(x1 + k, y)
  ctx.lineTo(x1, y + h)
  ctx.lineTo(x0, y + h)
  ctx.closePath()
}

function slab(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, h: number, fill: string): void {
  slabPath(ctx, x0, x1, y, h)
  ctx.fillStyle = fill
  ctx.fill()
}

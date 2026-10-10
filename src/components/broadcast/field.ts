// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B2): the field. Turf stripes, end zones with club
// wordmarks, sideline/end-line border, yard lines every 5, hash and inbound
// marks, PAT marks, yard numbers with direction arrows (oriented like a real
// field: each sideline's numbers read upright from that sideline), midfield
// logo, pylons and goalposts. Also the per-frame turf paint: line of
// scrimmage (blue), first-down line (yellow) and the on-field down & distance
// plate — drawn on the turf so B3's players occlude them.
//
// World coordinates: see camera.ts (x 0..120 along, y 0..53.3 across, z up).
// ─────────────────────────────────────────────────────────────────────────────
import {
  FIELD_LENGTH as FL,
  FIELD_WIDTH as FW,
  HASH_HALF,
  MID_WIDTH as MY,
  offenseToWorld,
  quad as Q,
  type Camera,
  type Direction,
  type Vec3,
} from './camera.ts'
import { drawTex, fillPoly, makeCanvas, pathPoly, strokeWorld, type Ctx } from './paint.ts'
import { ART, clubArt, withAlpha, type ClubLike } from './palette.ts'

/** Numbers: 6 ft tall, tops 9 yd from the sideline; each digit 4 ft wide. */
const NUM_TOP = 9
const NUM_H = 2
const NUM_W = 3.3

export interface FieldTextures {
  numbers: Record<number, HTMLCanvasElement>
  /** Wordmark for the left (x 0..10) and right (x 110..120) end zones. */
  leftMark: HTMLCanvasElement
  rightMark: HTMLCanvasElement
  leftEndZone: string
  rightEndZone: string
  logo: HTMLCanvasElement
}

function wordmark(text: string, fill: string, stroke: string, font: string): HTMLCanvasElement {
  return makeCanvas(1400, 240, (g, w, h) => {
    let px = 236
    g.font = `italic 800 ${px}px ${font}`
    const tw = g.measureText(text).width
    const maxW = w - 80
    if (tw > maxW) {
      px = Math.floor((px * maxW) / tw)
      g.font = `italic 800 ${px}px ${font}`
    }
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.lineJoin = 'round'
    g.lineWidth = Math.max(8, px * 0.075)
    g.strokeStyle = stroke
    g.strokeText(text, w / 2, h / 2 + 8)
    g.fillStyle = fill
    g.fillText(text, w / 2, h / 2 + 8)
  })
}

/**
 * Build the field's text textures. Call again after `document.fonts.ready`.
 * With the same club at both ends (the home club paints both, the default)
 * the left end zone carries the city and the right the nickname.
 */
export function buildFieldTextures(left: ClubLike, right: ClubLike, home: ClubLike, font: string): FieldTextures {
  const numbers: Record<number, HTMLCanvasElement> = {}
  for (const n of [10, 20, 30, 40, 50]) {
    numbers[n] = makeCanvas(330, 200, (g, w, h) => {
      g.fillStyle = ART.paint
      g.font = `700 230px ${font}`
      g.textBaseline = 'alphabetic'
      g.textAlign = 'center'
      const s = String(n)
      g.fillText(s[0], w / 2 - 80, h - 6)
      g.fillText(s[1], w / 2 + 80, h - 6)
    })
  }
  const la = clubArt(left)
  const ra = clubArt(right)
  const same = left.id === right.id
  const leftText = (same ? left.city : left.name).toUpperCase()
  const rightText = right.name.toUpperCase()
  const ha = clubArt(home)
  const logo = makeCanvas(256, 256, (g) => {
    g.beginPath()
    g.arc(128, 128, 124, 0, 2 * Math.PI)
    g.fillStyle = ha.logoRing
    g.fill()
    g.beginPath()
    g.arc(128, 128, 110, 0, 2 * Math.PI)
    g.fillStyle = ha.logoFill
    g.fill()
    g.lineWidth = 6
    g.strokeStyle = ha.logoText
    g.globalAlpha = 0.85
    g.beginPath()
    g.arc(128, 128, 94, 0, 2 * Math.PI)
    g.stroke()
    g.globalAlpha = 1
    const label = home.abbr.toUpperCase()
    let px = label.length > 2 ? 104 : 124
    g.font = `italic 800 ${px}px ${font}`
    const tw = g.measureText(label).width
    if (tw > 170) {
      px = Math.floor((px * 170) / tw)
      g.font = `italic 800 ${px}px ${font}`
    }
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = ha.logoText
    g.fillText(label, 128, 134)
  })
  return {
    numbers,
    leftMark: wordmark(leftText, la.wordFill, la.wordStroke, font),
    rightMark: wordmark(rightText, ra.wordFill, ra.wordStroke, font),
    leftEndZone: la.endZone,
    rightEndZone: ra.endZone,
    logo,
  }
}

/** Turf: apron, 5-yard stripes, mowing cross-hatch, end zones and their wordmarks. */
function drawTurf(ctx: Ctx, c: Camera, tex: FieldTextures): void {
  fillPoly(ctx, c, Q(-14, -10, FL + 14, FW + 10), ART.apron)
  // Alternating 5-yard stripes as two paths (no full-field underpaint).
  for (const [start, col] of [
    [10, ART.stripeA],
    [15, ART.stripeB],
  ] as const) {
    ctx.beginPath()
    for (let x = start; x < 110; x += 10) pathPoly(ctx, c, Q(x, 0, x + 5, FW))
    ctx.fillStyle = col
    ctx.fill()
  }
  ctx.beginPath()
  for (let y = 0; y < FW; y += (FW / 16) * 2) pathPoly(ctx, c, Q(10, y, 110, y + FW / 16))
  ctx.fillStyle = 'rgba(255,255,255,.022)'
  ctx.fill()
  // End zones + a faint diagonal sheen.
  fillPoly(ctx, c, Q(0, 0, 10, FW), tex.leftEndZone)
  fillPoly(ctx, c, Q(110, 0, 120, FW), tex.rightEndZone)
  ctx.beginPath()
  const cl = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  for (let k = -6; k < 16; k++) {
    for (const base of [0, 110]) {
      const x0 = base + k * 1.4
      const pts: Vec3[] = [
        [cl(x0, base, base + 10), 0, 0],
        [cl(x0 + 0.7, base, base + 10), 0, 0],
        [cl(x0 + 3.7, base, base + 10), FW, 0],
        [cl(x0 + 3, base, base + 10), FW, 0],
      ]
      pathPoly(ctx, c, pts)
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,.07)'
  ctx.fill()
  // Wordmarks: bottoms face the goal line, so they read from the field.
  drawTex(ctx, c, tex.rightMark, [111.6, MY + 19.85, 0], [0, -39.7, 0], [6.8, 0, 0], 14, 3)
  drawTex(ctx, c, tex.leftMark, [8.4, MY - 19.85, 0], [0, 39.7, 0], [-6.8, 0, 0], 14, 3)
}

/** Border, yard lines, hashes, inbound marks, PAT marks, numbers, arrows, logo. */
function drawMarkings(ctx: Ctx, c: Camera, tex: FieldTextures): void {
  ctx.beginPath()
  pathPoly(ctx, c, Q(-2, -2, FL + 2, 0))
  pathPoly(ctx, c, Q(-2, FW, FL + 2, FW + 2))
  pathPoly(ctx, c, Q(-2, 0, 0, FW))
  pathPoly(ctx, c, Q(FL, 0, FL + 2, FW))
  ctx.fillStyle = ART.paint
  ctx.fill()
  // Yard lines every 5 (goal lines 8" wide, others 4"), stopping 8" short of the sideline.
  ctx.beginPath()
  for (let x = 10; x <= 110; x += 5) {
    const w = x === 10 || x === 110 ? 0.13 : 0.065
    pathPoly(ctx, c, Q(x - w, 0.25, x + w, FW - 0.25))
  }
  ctx.fillStyle = ART.paint
  ctx.fill()
  // Hash marks + sideline inbound ticks each yard, PAT marks at the 2.
  ctx.beginPath()
  for (let x = 11; x < 110; x++) {
    if (x % 5 === 0) continue
    pathPoly(ctx, c, Q(x - 0.06, MY - HASH_HALF - 0.33, x + 0.06, MY - HASH_HALF + 0.33))
    pathPoly(ctx, c, Q(x - 0.06, MY + HASH_HALF - 0.33, x + 0.06, MY + HASH_HALF + 0.33))
    pathPoly(ctx, c, Q(x - 0.06, 0.3, x + 0.06, 0.95))
    pathPoly(ctx, c, Q(x - 0.06, FW - 0.95, x + 0.06, FW - 0.3))
  }
  pathPoly(ctx, c, Q(11.95, MY - 0.5, 12.05, MY + 0.5))
  pathPoly(ctx, c, Q(107.95, MY - 0.5, 108.05, MY + 0.5))
  ctx.fillStyle = ART.paintSoft
  ctx.fill()
  // Numbers: near side reads from the near sideline, far side from the far one.
  for (let X = 20; X <= 100; X += 10) {
    const v = X <= 60 ? X - 10 : 110 - X
    const img = tex.numbers[v]
    if (!img) continue
    const y0 = NUM_TOP - NUM_H
    drawTex(ctx, c, img, [X - NUM_W / 2, y0, 0], [NUM_W, 0, 0], [0, NUM_H, 0], 3, 2)
    drawTex(ctx, c, img, [X + NUM_W / 2, FW - y0, 0], [-NUM_W, 0, 0], [0, -NUM_H, 0], 3, 2)
  }
  // Arrows beside the top half of each number, pointing to the nearer goal line.
  ctx.beginPath()
  for (let X = 20; X <= 100; X += 10) {
    if (X === 60) continue
    const s = X < 60 ? -1 : 1
    const ax = X + s * (NUM_W / 2 + 0.25)
    const a0 = NUM_TOP - 0.85
    const a1 = NUM_TOP - 0.25
    pathPoly(ctx, c, [
      [ax, a0, 0],
      [ax + s * 0.75, (a0 + a1) / 2, 0],
      [ax, a1, 0],
    ])
    pathPoly(ctx, c, [
      [ax, FW - a1, 0],
      [ax + s * 0.75, FW - (a0 + a1) / 2, 0],
      [ax, FW - a0, 0],
    ])
  }
  ctx.fillStyle = ART.paintSoft
  ctx.fill()
  // Midfield logo, upright from the near (broadcast) sideline.
  drawTex(ctx, c, tex.logo, [FL / 2 - 3, MY - 3, 0], [6, 0, 0], [0, 6, 0], 4, 4)
}

/** Orange pylons at the eight end-zone corners (camera-facing boxes). */
export function drawPylons(ctx: Ctx, c: Camera): void {
  const hw = 0.06
  ctx.beginPath()
  for (const [x, y] of [
    [10, 0],
    [10, FW],
    [110, 0],
    [110, FW],
    [0, 0],
    [0, FW],
    [120, 0],
    [120, FW],
  ]) {
    pathPoly(ctx, c, [
      [x - c.rhx * hw, y - c.rhy * hw, 0],
      [x + c.rhx * hw, y + c.rhy * hw, 0],
      [x + c.rhx * hw, y + c.rhy * hw, 0.5],
      [x - c.rhx * hw, y - c.rhy * hw, 0.5],
    ])
  }
  ctx.fillStyle = ART.pylon
  ctx.fill()
}

/**
 * Goalposts on both end lines: gooseneck 2 yd behind, crossbar 10 ft up,
 * uprights 18'6" apart reaching 30 ft above the bar. Exported so B3 can draw
 * them in depth order with players if needed.
 */
export function drawGoalposts(ctx: Ctx, c: Camera): void {
  ctx.save()
  ctx.strokeStyle = ART.goalpost
  ctx.lineCap = 'round'
  const bar = 10 / 3
  const top = bar + 10
  for (const [gx, s] of [
    [FL, 1],
    [0, -1],
  ] as const) {
    strokeWorld(ctx, c, [gx + s * 2, MY, 0], [gx + s * 2, MY, bar - 0.33], 0.2)
    strokeWorld(ctx, c, [gx + s * 2, MY, bar - 0.33], [gx, MY, bar], 0.18)
    strokeWorld(ctx, c, [gx, MY - HASH_HALF, bar], [gx, MY + HASH_HALF, bar], 0.15)
    strokeWorld(ctx, c, [gx, MY - HASH_HALF, bar], [gx, MY - HASH_HALF, top], 0.11)
    strokeWorld(ctx, c, [gx, MY + HASH_HALF, bar], [gx, MY + HASH_HALF, top], 0.11)
  }
  ctx.restore()
}

/** Ground layer of the field (everything flat). Static — cached by the renderer. */
export function drawFieldGround(ctx: Ctx, c: Camera, tex: FieldTextures): void {
  drawTurf(ctx, c, tex)
  drawMarkings(ctx, c, tex)
}

/** Upright field furniture (pylons, goalposts). Static — drawn after the stands. */
export function drawFieldFurniture(ctx: Ctx, c: Camera, opts: { goalposts?: boolean } = {}): void {
  drawPylons(ctx, c)
  if (opts.goalposts !== false) drawGoalposts(ctx, c)
}

// ── per-frame turf paint ─────────────────────────────────────────────────────

export interface TurfLines {
  /** World x of the line of scrimmage, or null. */
  losX: number | null
  /** World x of the first-down line, or null (goal to go). */
  firstDownX: number | null
  /** 0..1 fade for both lines. */
  alpha?: number
}

/** Blue LOS and yellow first-down line, painted on the turf sideline to sideline. */
export function drawTurfLines(ctx: Ctx, c: Camera, l: TurfLines): void {
  const a = l.alpha ?? 1
  if (a <= 0.01) return
  if (l.losX != null) fillPoly(ctx, c, Q(l.losX - 0.1, 0, l.losX + 0.1, FW), withAlpha(ART.los, 0.88 * a))
  if (l.firstDownX != null && l.firstDownX > 10 && l.firstDownX < 110) {
    fillPoly(ctx, c, Q(l.firstDownX - 0.32, 0, l.firstDownX + 0.32, FW), withAlpha(ART.fdGlow, 0.22 * a))
    fillPoly(ctx, c, Q(l.firstDownX - 0.13, 0, l.firstDownX + 0.13, FW), withAlpha(ART.fdLine, 0.95 * a))
  }
}

const PLATE_W = 720
const PLATE_H = 170

/** The on-field down & distance lettering (transparent; the plate is drawn as polygons). */
export function buildTurfGraphic(text: string, font: string): HTMLCanvasElement {
  return makeCanvas(PLATE_W, PLATE_H, (g, w, h) => {
    let px = 132
    g.font = `italic 800 ${px}px ${font}`
    const tw = g.measureText(text).width
    if (tw > w - 110) {
      px = Math.floor((px * (w - 110)) / tw)
      g.font = `italic 800 ${px}px ${font}`
    }
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = ART.paint
    g.fillText(text, w / 2, h / 2 - 4)
  })
}

/**
 * Paint the down & distance plate on the turf behind the LOS, reading from
 * behind the offense. `losYard` is in playAnim's offense frame. The skewed
 * plate and its accent bar are polygons (no seams); only the lettering is a
 * texture.
 */
export function drawTurfGraphic(ctx: Ctx, c: Camera, img: HTMLCanvasElement, losYard: number, dir: Direction, alpha = 0.9): void {
  if (alpha <= 0.01) return
  const o = offenseToWorld(losYard - 8.4, MY + 5.25, dir)
  const U: Vec3 = [0, -10.5 * dir, 0]
  const V: Vec3 = [2.5 * dir, 0, 0]
  // Texture pixel → world point on the turf.
  const at = (px: number, py: number): Vec3 => {
    const s = px / PLATE_W
    const r = 1 - py / PLATE_H
    return [o.x + U[0] * s + V[0] * r, o.y + U[1] * s + V[1] * r, 0]
  }
  const band = (y0: number, y1: number): Vec3[] => [
    at(30 - 0.18 * y0, y0),
    at(PLATE_W - 30 - 0.18 * y0, y0),
    at(PLATE_W - 30 - 0.18 * y1, y1),
    at(30 - 0.18 * y1, y1),
  ]
  ctx.save()
  ctx.globalAlpha = alpha
  fillPoly(ctx, c, band(0, PLATE_H - 16), ART.turfGraphicBg)
  fillPoly(ctx, c, band(PLATE_H - 16, PLATE_H), ART.turfGraphicBar)
  ctx.restore()
  drawTex(ctx, c, img, [o.x, o.y, 0], U, V, 6, 2, Math.min(1, alpha / 0.9))
}

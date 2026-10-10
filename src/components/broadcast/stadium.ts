// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B2): the stadium bowl. Night sky, four stands of crowd
// (sloped, culled when seen from behind, painted back to front), LED ribbon
// boards on the walls around the field and a lit roof fascia. Textures are
// built once per club / possession; the renderer caches the painted layer and
// only repaints it when the camera moves meaningfully.
// ─────────────────────────────────────────────────────────────────────────────
import type { Camera, Vec3 } from './camera.ts'
import { drawTex, fillPoly, makeCanvas, rng, type Ctx } from './paint.ts'
import { ART, clubArt, type ClubLike } from './palette.ts'

/** The bowl: walls on this rectangle, stands rising outward from them. */
export const BOWL = { x0: -14, x1: 134, y0: -10, y1: 63.3, wall: 1.3, rise: 20.7, depth: 28, fascia: 3.2 } as const

export interface StadiumTextures {
  crowd: HTMLCanvasElement
  ledSide: HTMLCanvasElement
  ledEnd: HTMLCanvasElement
  fascia: HTMLCanvasElement
}

function ledBoard(w: number, words: string[], art: ReturnType<typeof clubArt>, font: string): HTMLCanvasElement {
  return makeCanvas(w, 72, (g, W, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h)
    gr.addColorStop(0, art.ledDark)
    gr.addColorStop(0.5, art.ledMid)
    gr.addColorStop(1, art.ledDark)
    g.fillStyle = gr
    g.fillRect(0, 0, W, h)
    g.font = `italic 800 54px ${font}`
    g.textBaseline = 'middle'
    let x = 20
    let i = 0
    while (x < W) {
      const s = words[i++ % words.length]
      const mark = s === '◆'
      g.fillStyle = mark ? art.ledMark : art.ledText
      g.fillText(s, x, h / 2 + 3)
      x += g.measureText(s).width + 34
    }
    g.fillStyle = 'rgba(0,0,0,.25)'
    for (let y = 0; y < h; y += 3) g.fillRect(0, y, W, 1)
  })
}

/**
 * Build the bowl textures for the home club. `homeOnDefense` puts DEFENSE
 * chants on the ribbons, otherwise the club's name.
 */
export function buildStadiumTextures(home: ClubLike, away: ClubLike, homeOnDefense: boolean, font: string): StadiumTextures {
  const art = clubArt(home)
  const awayArt = clubArt(away)
  const crowd = makeCanvas(1024, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h)
    gr.addColorStop(0, ART.crowdTop)
    gr.addColorStop(1, ART.crowdLow)
    g.fillStyle = gr
    g.fillRect(0, 0, w, h)
    const R = rng(42)
    // Mostly home colours, a sprinkle of the visitors.
    const cols = [...art.crowd, awayArt.endZone]
    for (let row = 0; row < 26; row++) {
      const y = 8 + row * 9.4
      const shade = 0.45 + 0.55 * (row / 26)
      g.fillStyle = 'rgba(0,0,0,.35)'
      g.fillRect(0, y + 6, w, 2)
      for (let x = 0; x < w; x += 4.2 + R() * 1.6) {
        g.globalAlpha = shade * (0.55 + R() * 0.45)
        g.fillStyle = cols[Math.floor(R() * cols.length)]
        g.fillRect(x, y + R() * 1.5, 3, 5)
        g.fillStyle = ART.skin
        g.globalAlpha *= 0.6
        g.fillRect(x + 0.5, y - 1.5, 2, 2)
      }
    }
    g.globalAlpha = 1
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(255,255,255,${0.4 + R() * 0.6})`
      g.fillRect(R() * w, R() * h, 1.5, 1.5)
    }
  })
  const name = home.name.toUpperCase()
  const words = homeOnDefense ? ['DEFENSE', '◆', 'DEFENSE', '◆', name, '◆'] : [name, '◆', home.city.toUpperCase(), '◆']
  const fascia = makeCanvas(1024, 32, (g, w, h) => {
    g.fillStyle = ART.wall
    g.fillRect(0, 0, w, h)
    const R = rng(7)
    for (let x = 12; x < w; x += 46) {
      g.fillStyle = `rgba(255,248,224,${0.75 + R() * 0.25})`
      g.fillRect(x, 8, 26, 12)
    }
  })
  return { crowd, ledSide: ledBoard(2400, words, art, font), ledEnd: ledBoard(1240, words, art, font), fascia }
}

interface Section {
  /** Wall base start (left end as seen from the field) and the wall's run vector. */
  o: Vec3
  U: Vec3
  /** Unit vector pointing out of the bowl. */
  out: [number, number]
  nx: number
}

const { x0, x1, y0, y1, wall, rise, depth, fascia } = BOWL
const LEN_X = x1 - x0
const LEN_Y = y1 - y0
// Ordered so the texture's left edge is on the viewer's left from inside the bowl.
const SECTIONS: Section[] = [
  { o: [x1, y0, 0], U: [-LEN_X, 0, 0], out: [0, -1], nx: 24 }, // near sideline stand
  { o: [x0, y1, 0], U: [LEN_X, 0, 0], out: [0, 1], nx: 24 }, // far sideline stand
  { o: [x1, y1, 0], U: [0, -LEN_Y, 0], out: [1, 0], nx: 10 }, // right end
  { o: [x0, y0, 0], U: [0, LEN_Y, 0], out: [-1, 0], nx: 10 }, // left end
]

let skyStrip: HTMLCanvasElement | null = null

/**
 * Night sky / bowl haze behind everything. The gradient is painted once into a
 * 1-px strip and stretched (a full-frame gradient fill is slow on software
 * rasterisers).
 */
export function drawSky(ctx: Ctx, w: number, h: number): void {
  if (!skyStrip) {
    skyStrip = makeCanvas(1, 256, (g, sw, sh) => {
      const bg = g.createLinearGradient(0, 0, 0, sh)
      bg.addColorStop(0, ART.skyTop)
      bg.addColorStop(0.45, ART.skyMid)
      bg.addColorStop(1, ART.skyLow)
      g.fillStyle = bg
      g.fillRect(0, 0, sw, sh)
    })
  }
  ctx.drawImage(skyStrip, 0, 0, w, h)
}

/** Stands, LED walls and fascia, culled and painted back to front. */
export function drawStands(ctx: Ctx, c: Camera, tex: StadiumTextures): void {
  const vis: { s: Section; d: number; standVis: boolean; wallVis: boolean }[] = []
  for (const s of SECTIONS) {
    const [ox, oy] = s.out
    const ix = -ox
    const iy = -oy
    // Wall faces inward; stand normal is inward·rise + up·depth.
    const relX = c.px - s.o[0]
    const relY = c.py - s.o[1]
    const wallVis = relX * ix + relY * iy > 0
    const standVis = (relX * ix + relY * iy) * rise + (c.pz - wall) * depth > 0
    if (!wallVis && !standVis) continue
    const mx = s.o[0] + s.U[0] / 2 + (ox * depth) / 2
    const my = s.o[1] + s.U[1] / 2 + (oy * depth) / 2
    vis.push({ s, d: Math.hypot(mx - c.px, my - c.py), standVis, wallVis })
  }
  vis.sort((a, b) => b.d - a.d)
  for (const { s, standVis, wallVis } of vis) {
    const [ox, oy] = s.out
    const long = s.nx > 12
    // Extend the side stands past the corners so the bowl reads closed.
    const ext = long ? 12 : 0
    const ux = s.U[0] / Math.hypot(s.U[0], s.U[1])
    const uy = s.U[1] / Math.hypot(s.U[0], s.U[1])
    const so: Vec3 = [s.o[0] - ux * ext, s.o[1] - uy * ext, wall]
    const SU: Vec3 = [s.U[0] + ux * 2 * ext, s.U[1] + uy * 2 * ext, 0]
    const SV: Vec3 = [ox * depth, oy * depth, rise]
    if (standVis) {
      drawTex(ctx, c, tex.crowd, so, SU, SV, s.nx, 3)
      // Roof fascia with floodlights along the top back of the stand.
      drawTex(ctx, c, tex.fascia, [so[0] + SV[0], so[1] + SV[1], wall + rise], SU, [0, 0, fascia], s.nx, 1)
    }
    if (wallVis) {
      // Housing strip on the ground, then the LED face.
      fillPoly(
        ctx,
        c,
        [
          [s.o[0], s.o[1], 0],
          [s.o[0] + s.U[0], s.o[1] + s.U[1], 0],
          [s.o[0] + s.U[0] + ox * 0.8, s.o[1] + s.U[1] + oy * 0.8, 0],
          [s.o[0] + ox * 0.8, s.o[1] + oy * 0.8, 0],
        ],
        ART.wall,
      )
      drawTex(ctx, c, long ? tex.ledSide : tex.ledEnd, s.o, s.U, [0, 0, wall], s.nx, 1)
    }
  }
}

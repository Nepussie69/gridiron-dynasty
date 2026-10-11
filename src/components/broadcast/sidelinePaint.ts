// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (SL1): people off the ball — sideline players, coaches,
// staff, officials and the chain crew — as whole-figure sprites.
//
// Unlike the on-field figures (limbs live every frame), a sideline person
// holds one of a few idle poses, so the whole figure (with its baked ground
// shadow) is painted once into a small offscreen canvas keyed by
//   outfit × pose × facing bucket × skin × hat (× down-box card) × scale bucket
// and blitted with one drawImage per person per frame. New sprites per frame
// are capped by time (`buildMs`, at least one per frame); until a person's
// exact scale bucket is built the nearest built bucket of the same variant is
// drawn scaled, so a camera zoom never costs a burst of paints. LRU-capped by
// entries and pixels; clear() on a new matchup.
//
// Unit space as figures.ts: 1 = the projected 2-yd vertical at the feet,
// feet at (0, 0), y down. Only imports figures / palette / paint / teamColor
// (no DOM at import), so node scripts can load it.
// ─────────────────────────────────────────────────────────────────────────────
import { mixHex } from '../../lib/teamColor.ts'
import { FIG_ART, HELMET_R, paintHelmet, paintTorso, SKIN, type Kit } from './figures.ts'
import { makeCanvas } from './paint.ts'
import { ART } from './palette.ts'

/** Fixed sideline art (not club colours). */
export const SIDE_ART = {
  stripeWhite: '#F2F2EE', // check-hex-allow: officials' white stripe
  stripeBlack: '#121214', // check-hex-allow: officials' black stripe / pants / cap
  capWhite: '#F7F7F4', // check-hex-allow: referee's white cap
  slacks: '#23262D', // check-hex-allow: coaches' / staff dark slacks
  khaki: '#9C8B6A', // check-hex-allow: coaches' khakis
  crewShirt: '#3B4049', // check-hex-allow: chain crew shirt
  bib: '#F06A1C', // check-hex-allow: chain crew orange bib
  rod: '#1C1D20', // check-hex-allow: chain rod
  hair: '#1B1612', // check-hex-allow: hair
  headset: '#0E0F12', // check-hex-allow: coach headset
  sheet: '#F4F4EE', // check-hex-allow: play sheet
  chain: 'rgba(205,208,214,.9)', // the chain on the turf
} as const

export type Face = 'front' | 'back' | 'left' | 'right'
export type PPose = 'stand' | 'hips' | 'cross' | 'helmet' | 'sheet' | 'up' | 'point' | 'runA' | 'runB' | 'sit' | 'rod'
export type Hat = 'helmet' | 'bare' | 'cap' | 'headset'

export interface Outfit {
  /** Cache key. */
  id: string
  kind: 'player' | 'coach' | 'staff' | 'official' | 'chain'
  /** Players: their club kit (torso + helmet painters from figures.ts). */
  kit?: Kit
  shirt: string
  shirtHi: string
  shirtLo: string
  trim: string
  /** Upper-arm colour (short sleeves show skin below it). */
  sleeve: string
  longSleeve: boolean
  pants: string
  cap: string
  capBill: string
  bib?: string
  stripes?: boolean
}

export interface PersonSpec {
  outfit: Outfit
  pose: PPose
  face: Face
  /** Index into SKIN. */
  skin: number
  hat: Hat
  /** Down box number (chain crew 'rod' pose), 0 = a plain rod. */
  card?: number
}

const TAU = Math.PI * 2
const SDX: Record<Face, number> = { front: 0, back: 0, left: -0.85, right: 0.85 }
const TOW: Record<Face, number> = { front: 0.6, back: -0.6, left: 0.05, right: 0.05 }
const lerp = (a: number, b: number, u: number) => a + (b - a) * u

/** A coach / staff outfit from a club colour. */
export function clothOutfit(id: string, kind: 'coach' | 'staff', shirt: string, trim: string, cap: string): Outfit {
  return {
    id,
    kind,
    shirt,
    shirtHi: mixHex(shirt, ART.white, 0.16),
    shirtLo: mixHex(shirt, ART.black, 0.32),
    trim,
    sleeve: shirt,
    longSleeve: kind === 'staff',
    pants: kind === 'coach' ? SIDE_ART.slacks : SIDE_ART.khaki,
    cap,
    capBill: mixHex(cap, ART.black, 0.3),
  }
}

export function playerOutfit(kit: Kit): Outfit {
  return {
    id: `P|${kit.id}`,
    kind: 'player',
    kit,
    shirt: kit.jersey,
    shirtHi: kit.jHi,
    shirtLo: kit.jLo,
    trim: kit.trim,
    sleeve: kit.jersey,
    longSleeve: false,
    pants: kit.pants,
    cap: kit.helm,
    capBill: kit.helmLo,
  }
}

export function officialOutfit(referee: boolean): Outfit {
  return {
    id: referee ? 'OFF|R' : 'OFF',
    kind: 'official',
    shirt: SIDE_ART.stripeWhite,
    shirtHi: SIDE_ART.stripeWhite,
    shirtLo: mixHex(SIDE_ART.stripeWhite, ART.black, 0.2),
    trim: SIDE_ART.stripeBlack,
    sleeve: SIDE_ART.stripeWhite,
    longSleeve: false,
    pants: SIDE_ART.stripeBlack,
    cap: referee ? SIDE_ART.capWhite : SIDE_ART.stripeBlack,
    capBill: referee ? mixHex(SIDE_ART.capWhite, ART.black, 0.15) : SIDE_ART.stripeBlack,
    stripes: true,
  }
}

export function crewOutfit(): Outfit {
  return {
    id: 'CREW',
    kind: 'chain',
    shirt: SIDE_ART.crewShirt,
    shirtHi: mixHex(SIDE_ART.crewShirt, ART.white, 0.15),
    shirtLo: mixHex(SIDE_ART.crewShirt, ART.black, 0.3),
    trim: SIDE_ART.stripeBlack,
    sleeve: SIDE_ART.crewShirt,
    longSleeve: true,
    pants: SIDE_ART.stripeBlack,
    cap: SIDE_ART.stripeBlack,
    capBill: SIDE_ART.stripeBlack,
    bib: SIDE_ART.bib,
  }
}

export function specKey(s: PersonSpec): string {
  return `${s.outfit.id}|${s.pose}|${s.face}|${s.skin}|${s.hat}|${s.card ?? 0}`
}

function limb(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number, col: string): void {
  g.beginPath()
  g.moveTo(x0, y0)
  g.lineTo(x1, y1)
  g.strokeStyle = FIG_ART.outline
  g.lineWidth = w + 0.026
  g.stroke()
  g.strokeStyle = col
  g.lineWidth = w
  g.stroke()
}

/** Shirt (no pads) over the pants top, in the torso frame (hips at 0). */
function paintShirt(g: CanvasRenderingContext2D, o: Outfit, ad: number, front: boolean, sdx: number): void {
  const w = 1 - 0.3 * ad
  g.fillStyle = o.pants
  g.beginPath()
  g.rect(-0.1 * w, -0.03, 0.2 * w, 0.1)
  g.fill()
  g.lineWidth = 0.018
  g.strokeStyle = FIG_ART.outline
  g.stroke()
  g.beginPath()
  g.moveTo(-0.1 * w, 0.01)
  g.lineTo(-0.112 * w, -0.17)
  g.quadraticCurveTo(-0.172 * w, -0.2, -0.165 * w, -0.27)
  g.quadraticCurveTo(-0.09 * w, -0.31, 0, -0.302)
  g.quadraticCurveTo(0.09 * w, -0.31, 0.165 * w, -0.27)
  g.quadraticCurveTo(0.172 * w, -0.2, 0.112 * w, -0.17)
  g.lineTo(0.1 * w, 0.01)
  g.closePath()
  const gr = g.createLinearGradient(-0.17, 0, 0.17, 0)
  gr.addColorStop(0, o.shirtHi)
  gr.addColorStop(0.55, o.shirt)
  gr.addColorStop(1, o.shirtLo)
  g.fillStyle = gr
  g.fill()
  if (o.stripes || o.bib) {
    g.save()
    g.clip()
    if (o.stripes) {
      g.fillStyle = SIDE_ART.stripeBlack
      const off = sdx * 0.02
      for (let x = -0.2; x < 0.2; x += 0.064) g.fillRect(x + off, -0.32, 0.03, 0.36)
    }
    if (o.bib) {
      g.fillStyle = o.bib
      g.fillRect(-0.12 * w, -0.275, 0.24 * w, 0.24)
    }
    g.restore()
  }
  g.lineWidth = 0.02
  g.strokeStyle = FIG_ART.outline
  g.stroke()
  if (front) {
    g.strokeStyle = o.trim
    g.lineWidth = 0.018
    g.beginPath()
    if (o.kind === 'staff') {
      // jacket zip
      g.moveTo(sdx * 0.04, -0.29)
      g.lineTo(sdx * 0.04, 0)
    } else {
      // polo collar
      g.moveTo(-0.05 + sdx * 0.03, -0.3)
      g.lineTo(sdx * 0.03, -0.25)
      g.lineTo(0.05 + sdx * 0.03, -0.3)
    }
    g.stroke()
  }
}

/** Bare head / cap / headset centred at (0, 0). */
function paintHead(g: CanvasRenderingContext2D, o: Outfit, hat: Hat, sdx: number, face: Face, skin: string): void {
  const r = 0.07
  const back = face === 'back'
  g.beginPath()
  g.arc(0, 0, r, 0, TAU)
  g.fillStyle = back && hat === 'bare' ? SIDE_ART.hair : skin
  g.fill()
  g.lineWidth = 0.018
  g.strokeStyle = FIG_ART.outline
  g.stroke()
  if (hat === 'bare') {
    g.beginPath()
    g.arc(-sdx * 0.012, -0.012, r * 0.98, Math.PI * 1.02, Math.PI * 1.98)
    g.fillStyle = SIDE_ART.hair
    g.fill()
    return
  }
  // cap dome + bill
  g.beginPath()
  g.arc(0, -0.008, r * 1.06, Math.PI, TAU)
  g.closePath()
  g.fillStyle = o.cap
  g.fill()
  g.lineWidth = 0.016
  g.stroke()
  if (!back) {
    g.beginPath()
    if (face === 'front') g.ellipse(0, -0.006, r * 0.95, 0.022, 0, 0, TAU)
    else g.ellipse(Math.sign(sdx) * r * 0.95, -0.01, r * 0.7, 0.016, 0, 0, TAU)
    g.fillStyle = o.capBill
    g.fill()
  }
  if (hat === 'headset') {
    g.strokeStyle = SIDE_ART.headset
    g.lineWidth = 0.018
    g.beginPath()
    g.arc(0, 0, r * 1.18, Math.PI * 1.08, Math.PI * 1.92)
    g.stroke()
    g.fillStyle = SIDE_ART.headset
    const cups = face === 'front' || back ? [-1, 1] : [-Math.sign(sdx)]
    for (const s of cups) {
      g.beginPath()
      g.arc(s * r * (face === 'front' || back ? 1.02 : 0.15), 0.008, 0.026, 0, TAU)
      g.fill()
    }
    if (!back) {
      g.lineWidth = 0.01
      g.beginPath()
      g.moveTo(face === 'front' ? -r : -Math.sign(sdx) * r * 0.15, 0.02)
      g.lineTo(face === 'front' ? -0.02 : Math.sign(sdx) * r * 0.9, 0.055)
      g.stroke()
    }
  }
}

/** Paint one person in unit space (feet at 0, 0). `px` = pixels per unit (for the card digit). */
export function paintPerson(g: CanvasRenderingContext2D, s: PersonSpec, px: number, font: string): void {
  const o = s.outfit
  const sdx = SDX[s.face]
  const tow = TOW[s.face]
  const ad = Math.abs(sdx)
  const bw = 1 - 0.3 * ad
  const front = s.face !== 'back'
  const skin = SKIN[s.skin % SKIN.length]
  const player = o.kind === 'player'
  const pose = s.pose
  const sit = pose === 'sit'
  const run = pose === 'runA' || pose === 'runB' ? (pose === 'runA' ? 1 : -1) : 0
  g.lineCap = 'round'
  g.lineJoin = 'round'
  // baked ground shadow + contact shadow
  g.fillStyle = FIG_ART.shadow
  g.beginPath()
  g.ellipse(-0.05, 0.012, sit ? 0.3 : 0.22, 0.06, 0, 0, TAU)
  g.fill()
  g.fillStyle = FIG_ART.contact
  g.beginPath()
  g.ellipse(0, 0.004, 0.12, 0.035, 0, 0, TAU)
  g.fill()

  const hipY = sit ? -0.29 : -0.47
  const legW = player ? 0.1 : 0.085
  const sock = player && o.kit ? o.kit.sock : o.pants
  // ── legs ──
  for (const L of [-1, 1]) {
    const hx = L * 0.055 * bw
    let fx = L * (pose === 'hips' || pose === 'point' ? 0.105 : 0.075) * bw
    let fy = 0
    let kx = lerp(hx, fx, 0.5) + sdx * 0.02
    let ky = hipY / 2 + 0.005
    if (run) {
      const sw = run * L
      fx = L * 0.06 * bw + sdx * sw * 0.17
      fy = sw > 0 ? -0.05 * (1 - ad) - 0.03 : 0
      kx = (hx + fx) / 2 + sdx * 0.05
      ky = (hipY + fy) / 2
    } else if (sit) {
      if (ad > 0.3) {
        kx = sdx * 0.22 + L * 0.015
        ky = hipY + 0.01
        fx = sdx * 0.24 + L * 0.02
      } else {
        kx = L * 0.085
        ky = hipY + 0.03
        fx = L * 0.09
      }
    }
    limb(g, hx, hipY, kx, ky, legW, o.pants)
    limb(g, kx, ky, fx, fy - 0.02, legW * 0.8, sock)
    g.fillStyle = FIG_ART.shoe
    g.beginPath()
    g.ellipse(fx + sdx * 0.025, fy - 0.012, 0.042 + 0.022 * ad, 0.022, 0, 0, TAU)
    g.fill()
  }

  // ── torso frame ──
  g.save()
  g.translate(0, hipY)
  if (run) g.rotate(sdx * 0.1)
  const hands: [number, number, number, number | null, number | null][] = []
  for (const L of [-1, 1]) {
    let hx = L * 0.2 * bw
    let hy = -0.02
    let ex: number | null = null
    let ey: number | null = null
    switch (pose) {
      case 'hips':
        hx = L * 0.12 * bw
        hy = -0.07
        ex = L * 0.27 * bw
        ey = -0.15
        break
      case 'cross':
        hx = -L * 0.07 + sdx * 0.06
        hy = -0.18
        ex = L * 0.19 * bw + sdx * 0.04
        ey = -0.12
        break
      case 'helmet':
        if (L > 0) {
          hx = 0.23 * bw
          hy = 0.01
        }
        break
      case 'sheet':
        if (L < 0) {
          hx = -0.03 + sdx * 0.12
          hy = -0.21
        }
        break
      case 'up':
        hx = L * 0.13
        hy = -0.66
        ex = L * 0.21
        ey = -0.47
        break
      case 'point': {
        const p = sdx >= 0 ? 1 : -1
        if (L === p) {
          hx = p * 0.47
          hy = -0.3
          ex = p * 0.3
          ey = -0.285
        }
        break
      }
      case 'runA':
      case 'runB': {
        const sw = -run * L
        hx = L * 0.15 * bw + sdx * sw * 0.13
        hy = -0.1
        break
      }
      case 'sit':
        hx = L * 0.09 + sdx * 0.16
        hy = 0.0
        break
      case 'rod':
        hx = 0.14 * bw + (L < 0 ? -0.01 : 0)
        hy = L < 0 ? -0.1 : -0.3
        break
    }
    hands.push([L, hx, hy, ex, ey])
  }
  const drawArms = () => {
    for (const [L, hx, hy, ex0, ey0] of hands) {
      const sx = L * (player ? 0.175 : 0.15) * bw
      const sy = player ? -0.27 : -0.265
      const ex = ex0 ?? (sx + hx) / 2 + L * 0.035 * (1 - 0.5 * ad)
      const ey = ey0 ?? (sy + hy) / 2 + 0.02
      limb(g, sx, sy, ex, ey, player ? 0.085 : 0.07, o.sleeve)
      if (o.stripes) {
        g.strokeStyle = SIDE_ART.stripeBlack
        g.lineWidth = 0.07
        g.beginPath()
        g.moveTo(lerp(sx, ex, 0.4), lerp(sy, ey, 0.4))
        g.lineTo(lerp(sx, ex, 0.65), lerp(sy, ey, 0.65))
        g.stroke()
      }
      limb(g, ex, ey, hx, hy, player ? 0.062 : 0.055, o.longSleeve ? o.sleeve : skin)
      g.fillStyle = player && o.kit ? o.kit.glove : skin
      g.beginPath()
      g.arc(hx, hy, 0.032, 0, TAU)
      g.fill()
    }
  }
  const armsBehind = s.face === 'back' && pose !== 'up' && pose !== 'point'
  if (armsBehind) drawArms()
  if (player && o.kit) paintTorso(g, o.kit, ad, front, true)
  else paintShirt(g, o, ad, front, sdx)
  if (pose === 'rod') {
    // the rod (or down box) held upright beside the body
    const rx = 0.15 * bw
    g.strokeStyle = SIDE_ART.rod
    g.lineWidth = 0.022
    g.beginPath()
    g.moveTo(rx, -hipY)
    g.lineTo(rx, -0.62)
    g.stroke()
    const card = s.card ?? 0
    if (card > 0) {
      g.fillStyle = ART.pylon
      g.fillRect(rx - 0.09, -0.78, 0.18, 0.16)
      g.lineWidth = 0.014
      g.strokeStyle = FIG_ART.outline
      g.strokeRect(rx - 0.09, -0.78, 0.18, 0.16)
      g.save()
      g.scale(1 / px, 1 / px)
      g.font = `800 ${(0.15 * px).toFixed(1)}px ${font}`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillStyle = SIDE_ART.stripeBlack
      g.fillText(String(card), rx * px, -0.695 * px)
      g.restore()
    } else {
      g.fillStyle = ART.pylon
      g.fillRect(rx - 0.035, -0.72, 0.07, 0.11)
    }
  }
  if (!armsBehind) drawArms()
  if (pose === 'sheet' && front) {
    const [, hx, hy] = hands[0]
    g.fillStyle = SIDE_ART.sheet
    g.fillRect(hx - 0.05, hy - 0.08, 0.09, 0.12)
    g.lineWidth = 0.01
    g.strokeStyle = FIG_ART.outline
    g.strokeRect(hx - 0.05, hy - 0.08, 0.09, 0.12)
  }
  if (pose === 'helmet' && o.kit) {
    const [, hx, hy] = hands[1]
    g.save()
    g.translate(hx, hy + HELMET_R * 0.6)
    g.scale(0.9, 0.9)
    paintHelmet(g, o.kit, sdx, -tow, true)
    g.restore()
  }
  // neck + head
  const hx = sdx * 0.015
  const hy = player ? -0.405 : -0.385
  g.fillStyle = skin
  g.fillRect(hx - 0.03, player ? -0.36 : -0.33, 0.06, 0.05)
  g.translate(hx, hy)
  if (s.hat === 'helmet' && o.kit) paintHelmet(g, o.kit, sdx, tow, true)
  else paintHead(g, o, s.hat === 'helmet' ? 'bare' : s.hat, sdx, s.face, skin)
  g.restore()
}

// ── sprite cache ─────────────────────────────────────────────────────────────

/** A painted person: draw `canvas` into the unit rect (x, y, w, h) around the feet. */
export interface PersonSprite {
  canvas: HTMLCanvasElement
  x: number
  y: number
  w: number
  h: number
}

/** Unit box every pose fits in (arms up / pointing / the down box). */
const BOX = { x: -0.56, y: -1.36, w: 1.12, h: 1.46 }
const STEP = 2 ** (1 / 5)
const LOG_STEP = Math.log(STEP)
/** Sprites are never painted bigger than this many px per unit (bigger draws upscale). */
const MAX_PX = 240
const PAD = 2

function bucketOf(px: number): number {
  return Math.ceil(Math.log(Math.max(1, Math.min(MAX_PX, px))) / LOG_STEP - 1e-6)
}

export interface PeopleSpriteStats {
  entries: number
  pixels: number
  builds: number
  /** Draws served by another scale bucket of the same variant (budget ran out). */
  fallbacks: number
  /** People skipped because nothing of their variant was built yet. */
  misses: number
}

export class PeopleSprites {
  private map = new Map<string, PersonSprite & { px: number }>()
  /** Variant → buckets built (for the nearest-bucket fallback). */
  private built = new Map<string, Set<number>>()
  private pixels = 0
  private frameStart = 0
  private frameBuilds = 0
  font = '"Barlow Condensed", "Arial Narrow", sans-serif'
  readonly stats: PeopleSpriteStats = { entries: 0, pixels: 0, builds: 0, fallbacks: 0, misses: 0 }

  private maxEntries = 600
  private maxPixels = 5_000_000
  /** Build budget per frame (ms since beginFrame; at least one build per frame). */
  buildMs = 0.6

  beginFrame(): void {
    this.frameStart = performance.now()
    this.frameBuilds = 0
  }

  clear(): void {
    this.map.clear()
    this.built.clear()
    this.pixels = 0
    this.stats.entries = 0
    this.stats.pixels = 0
  }

  /** The sprite for `spec` at `px` pixels per unit (or the nearest built bucket), or null. */
  get(spec: PersonSpec, key: string, px: number): PersonSprite | null {
    const b = bucketOf(px)
    const k = `${key}#${b}`
    const hit = this.map.get(k)
    if (hit) {
      this.map.delete(k)
      this.map.set(k, hit)
      return hit
    }
    if (this.frameBuilds === 0 || performance.now() - this.frameStart < this.buildMs) return this.build(spec, key, b, k)
    const set = this.built.get(key)
    if (set && set.size) {
      let best = -1
      let bd = Infinity
      for (const v of set) {
        const d = Math.abs(v - b) + (v < b ? 0.5 : 0)
        if (d < bd) {
          bd = d
          best = v
        }
      }
      const e = this.map.get(`${key}#${best}`)
      if (e) {
        this.stats.fallbacks++
        return e
      }
    }
    this.stats.misses++
    return null
  }

  private build(spec: PersonSpec, key: string, b: number, k: string): PersonSprite {
    this.frameBuilds++
    this.stats.builds++
    const px = STEP ** b
    const font = this.font
    const cv = makeCanvas(Math.ceil(BOX.w * px) + 2 * PAD, Math.ceil(BOX.h * px) + 2 * PAD, (g) => {
      g.setTransform(px, 0, 0, px, -BOX.x * px + PAD, -BOX.y * px + PAD)
      paintPerson(g, spec, px, font)
    })
    const e = { canvas: cv, x: BOX.x - PAD / px, y: BOX.y - PAD / px, w: cv.width / px, h: cv.height / px, px }
    this.map.set(k, e)
    let set = this.built.get(key)
    if (!set) this.built.set(key, (set = new Set()))
    set.add(b)
    this.pixels += cv.width * cv.height
    while (this.map.size > this.maxEntries || this.pixels > this.maxPixels) {
      const oldest = this.map.keys().next()
      if (oldest.done) break
      const ok = oldest.value
      const o = this.map.get(ok)
      this.map.delete(ok)
      if (o) this.pixels -= o.canvas.width * o.canvas.height
      const hash = ok.lastIndexOf('#')
      this.built.get(ok.slice(0, hash))?.delete(Number(ok.slice(hash + 1)))
    }
    this.stats.entries = this.map.size
    this.stats.pixels = this.pixels
    return e
  }
}

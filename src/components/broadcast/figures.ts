// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B3): code-drawn player figures.
//
//   • Kits from the club's brand colours, contrast-checked with lib/teamColor:
//     NFL convention — the HOME club wears its colour jersey, the VISITORS wear
//     white with team-colour numbers, pants and socks. A home colour that is
//     too light to tell apart from the white (PIT gold) falls back to the
//     secondary or a darkened primary, so the two sides always separate.
//     Jersey numbers reach ≥ 3:1 on their jersey for all 32 clubs (asserted in
//     scripts/check-broadcast.ts). The field is broadcast art, so a kit looks
//     the same in both app themes.
//   • A pose library: every PoseState animData emits → joint parameters
//     (crouch, lean, arms forward / up / spread, hand down, tuck, jostle, throw
//     wind-up and release, kick swing, kneel, fall). States blend over 0.16 s.
//   • Figure drawing in a local frame: the projected height of a 2-yard
//     vertical at the player's feet is the unit, so figures shrink with depth
//     (scale = camera focal / depth). Legs and arms are tapered limbs drawn per
//     frame; torso + number + helmet are pre-rendered sprite parts
//     (sprites.ts) or painted directly by the same functions below.
//   • Run cycle phased by distance travelled (stride grows with speed);
//     facing from animData (smoothed by actors.ts); facemask only when the
//     helmet faces the camera.
//   • depthSort(): painter's order (far → near) with a stable tie-break, for
//     figures, goalposts, the ball and B4's effects.
//
// Only imports camera.ts / palette.ts / teamColor.ts (and types), so
// scripts/check-broadcast.ts can load it with node --experimental-strip-types.
// ─────────────────────────────────────────────────────────────────────────────
import { bestInk, contrast, INK_DARK, INK_LIGHT, luminance, mixHex, parseHex, toHex } from '../../lib/teamColor.ts'
import { project, type Camera } from './camera.ts'
import { ART, type ClubLike } from './palette.ts'
import type { PoseState } from './animData.ts'

// ── kits ─────────────────────────────────────────────────────────────────────

/** Fixed figure art (not club colours). */
export const FIG_ART = {
  awayJersey: '#F4F2ED', // check-hex-allow: visitors' white jersey
  awayJerseyHi: '#FFFFFF', // check-hex-allow: white jersey highlight
  awayJerseyLo: '#CFCAC0', // check-hex-allow: white jersey shade
  pantsLight: '#ECE7DD', // check-hex-allow: white game pants
  outline: 'rgba(10,10,14,.92)', // figure outline
  shoe: '#0C0C0E', // check-hex-allow: cleats
  maskLight: '#D9DCE1', // check-hex-allow: grey facemask on a dark shell
  maskDark: '#25282E', // check-hex-allow: dark facemask on a light shell
  shine: 'rgba(255,255,255,.55)', // helmet highlight
  shadow: 'rgba(0,10,0,.30)', // ground shadow
  contact: 'rgba(0,0,0,.25)', // contact shadow under the feet
  ballLight: '#C07A48', // check-hex-allow: ball placeholder leather (light)
  ballMid: '#7A421F', // check-hex-allow: ball placeholder leather
  ballDark: '#3E1E0B', // check-hex-allow: ball placeholder leather (shade)
  lace: 'rgba(255,255,255,.92)', // ball laces
} as const

/** Skin tones (deterministic per player). */
export const SKIN = [
  '#5B3A26', // check-hex-allow: skin tone
  '#7A4F33', // check-hex-allow: skin tone
  '#8E5C3D', // check-hex-allow: skin tone
  '#B98260', // check-hex-allow: skin tone
  '#A06A46', // check-hex-allow: skin tone
  '#4B2F1F', // check-hex-allow: skin tone
  '#6A442C', // check-hex-allow: skin tone
  '#D2A27F', // check-hex-allow: skin tone
] as const

/** Jersey numbers must reach this on their jersey (large text, WCAG). */
export const NUMBER_MIN = 3
/** The home jersey must separate this much from the visitors' white. */
export const HOME_AWAY_MIN = 2

export interface Kit {
  /** Cache key: club id + home/away + colours. */
  id: string
  home: boolean
  jersey: string
  jHi: string
  jLo: string
  /** Sleeve stripe and collar. */
  trim: string
  num: string
  /** Number outline, or null when no colour both shows on the jersey and keeps the glyph reading (fill alone ≥ NUMBER_MIN). */
  numStroke: string | null
  pants: string
  sock: string
  helm: string
  helmHi: string
  helmLo: string
  /** Centre stripe(s) on the shell: [width in figure units, colour]. */
  stripes: [number, string][]
  /** Small side decal on the shell. */
  decal: string
  mask: string
  glove: string
}

const normHex = (hex: string, fallback: string) => {
  const p = parseHex(hex)
  return p ? toHex(p) : fallback
}

/** First colour reaching `min` against `bg`, else whichever ink reads best. */
function firstReading(cands: string[], bg: string, min: number): string {
  for (const c of cands) if (contrast(c, bg) >= min) return c
  return bestInk(bg)
}

/** Darken (or lighten) `c` in 4% steps until it reaches `min` against `bg`. */
function pushApart(c: string, bg: string, min: number): string {
  const toward = luminance(bg) > 0.4 ? ART.black : ART.white
  for (let i = 0; i <= 25; i++) {
    const m = mixHex(c, toward, i * 0.04)
    if (contrast(m, bg) >= min) return m
  }
  return bestInk(bg)
}

/** A number outline must stand apart from the jersey at least this much (or it is invisible). */
export const STROKE_SHOW_MIN = 1.5
/**
 * …and from the fill at least this much when it carries the glyph's silhouette
 * (the outer edge then reads ≥ NUMBER_MIN; 1.7 admits club gold around white,
 * 1.76:1, e.g. PIT / WAS / GB home).
 */
export const STROKE_FILL_MIN = 1.7

/**
 * True when outline `c` around fill `num` on `jersey` keeps the number legible
 * by a drawn edge: it shows on the jersey, and either the fill reads on the
 * outline (inner edge ≥ NUMBER_MIN) or the outline reads on the jersey (outer
 * edge ≥ NUMBER_MIN) while still separating from the fill.
 */
export function strokeReads(c: string, num: string, jersey: string): boolean {
  if (c === num || c === jersey) return false
  const cj = contrast(c, jersey)
  if (cj < STROKE_SHOW_MIN) return false
  const cn = contrast(c, num)
  return cn >= NUMBER_MIN || (cn >= STROKE_FILL_MIN && cj >= NUMBER_MIN)
}

/**
 * The club's kit. Home: colour jersey, white pants. Away: white jersey, team-
 * colour numbers / pants / socks. Helmets are the same for both.
 */
export function clubKit(club: ClubLike, home: boolean): Kit {
  const p = normHex(club.primary, '#1F62D6') // check-hex-allow: fallback club colour
  const s = normHex(club.secondary, INK_DARK)
  const white = FIG_ART.awayJersey
  // The home colour: primary, unless it is too close to the visitors' white.
  const homeJersey = contrast(p, white) >= HOME_AWAY_MIN ? p : contrast(s, white) >= HOME_AWAY_MIN ? s : pushApart(p, white, HOME_AWAY_MIN)
  // The deepest club colour that reads on white (numbers / pants on the road kit).
  const roadInk = contrast(p, white) >= NUMBER_MIN ? p : contrast(s, white) >= NUMBER_MIN ? s : pushApart(homeJersey, white, NUMBER_MIN)
  const jersey = home ? homeJersey : white
  const num = home ? firstReading([INK_LIGHT, s, INK_DARK], jersey, NUMBER_MIN) : roadInk
  // Number outline: a club colour, else an ink, else none. It must show on the
  // jersey and keep the glyph reading by an edge it actually draws.
  const strokeCands = home ? [s, p] : [s === roadInk ? p : s, INK_DARK]
  let numStroke: string | null = null
  for (const c of strokeCands) {
    if (strokeReads(c, num, jersey)) {
      numStroke = c
      break
    }
  }
  if (numStroke == null) {
    const ink = firstReading([INK_DARK, INK_LIGHT], jersey, STROKE_SHOW_MIN)
    if (strokeReads(ink, num, jersey)) numStroke = ink
  }
  const trimBase = home ? s : roadInk
  const trim = contrast(trimBase, jersey) >= 1.5 ? trimBase : bestInk(jersey)
  const pants = home ? mixHex(FIG_ART.pantsLight, s, 0.08) : mixHex(roadInk, ART.black, 0.1)
  const sock = mixHex(homeJersey, ART.black, home ? 0.3 : 0.15)
  // Helmet shell: the primary, lifted a touch when it is nearly black so the
  // gradient still shows a highlight on the night field.
  const helm = luminance(p) < 0.012 ? mixHex(p, ART.white, 0.08) : p
  const helmHi = mixHex(helm, ART.white, 0.42)
  const helmLo = mixHex(helm, ART.black, 0.5)
  const stripeCol = contrast(s, helm) >= 1.4 ? s : bestInk(helm)
  const stripes: [number, string][] = [[0.045, stripeCol]]
  if (contrast(INK_LIGHT, helm) >= 1.6 && stripeCol !== INK_LIGHT) stripes.push([0.022, INK_LIGHT])
  const mask = luminance(helm) < 0.2 ? FIG_ART.maskLight : FIG_ART.maskDark
  const glove = home ? s : roadInk
  return {
    id: `${club.id}|${home ? 'H' : 'A'}|${p}|${s}`,
    home,
    jersey,
    jHi: home ? mixHex(jersey, ART.white, 0.18) : FIG_ART.awayJerseyHi,
    jLo: home ? mixHex(jersey, ART.black, 0.3) : FIG_ART.awayJerseyLo,
    trim,
    num,
    numStroke,
    pants,
    sock,
    helm,
    helmHi,
    helmLo,
    stripes,
    decal: contrast(s, helm) >= 1.4 ? s : bestInk(helm),
    mask,
    glove,
  }
}

// ── pose library ─────────────────────────────────────────────────────────────

/** Joint parameters (0..1 unless noted). */
export interface PoseParams {
  /** Crouch (knees bent, hips low). */
  cr: number
  /** Arms forward (hands at the chest, blocking / reaching). */
  af: number
  /** Arms up (catch). */
  au: number
  /** Forward lean of the torso. */
  ln: number
  /** One hand on the ground (3-point stance). */
  hd: number
  /** Ball tucked under the outside arm. */
  tk: number
  /** Jostle (engaged in a block). */
  jos: number
  /** Throw: wind-up 0..1, then release 0..1. */
  thr: number
  rel: number
  /** Falling / lying: 0 upright … 1 on the ground. */
  fall: number
  /** Kick: leg swing 0 (plant) … 1 (follow-through). */
  kk: number
  /** Kneel (FG holder). */
  kn: number
  /** Arms spread wide (balance, kick follow-through). */
  sp: number
  /** How much of the run cycle shows (multiplies the speed-driven amplitude). */
  run: number
}

const PKEYS = ['cr', 'af', 'au', 'ln', 'hd', 'tk', 'jos', 'thr', 'rel', 'fall', 'kk', 'kn', 'sp', 'run'] as const

export const ZERO_POSE: Readonly<PoseParams> = Object.freeze({ cr: 0, af: 0, au: 0, ln: 0, hd: 0, tk: 0, jos: 0, thr: 0, rel: 0, fall: 0, kk: 0, kn: 0, sp: 0, run: 1 })

export interface PoseDef {
  base: Partial<PoseParams>
  /** Time-dependent parameters: `age` and `len` in seconds of play time. */
  dyn?: (age: number, len: number, p: PoseParams) => void
  /** Fall direction source: 'none' (upright), 'live' (heading now), 'start' (heading when the state began). */
  fallDir?: 'none' | 'live' | 'start'
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const lerp = (a: number, b: number, u: number) => a + (b - a) * u
const ease = (u: number) => u * u * (3 - 2 * u)
const easeOut = (u: number) => 1 - (1 - u) * (1 - u)

/** Every pose state animData emits (keep in sync with animData PoseState; check-broadcast asserts it). */
export const POSE_LIBRARY: Record<PoseState, PoseDef> = {
  stance3: { base: { cr: 1, ln: 0.75, hd: 1, run: 0 } },
  stance2: { base: { cr: 0.42, ln: 0.35, af: 0.12, run: 0.3 } },
  stand: { base: { cr: 0.08, af: 0.18 } },
  run: { base: { cr: 0.06, ln: 0.16 } },
  pedal: { base: { cr: 0.34, ln: 0.1, af: 0.25, run: 0.75 } },
  block: { base: { cr: 0.42, af: 1, ln: 0.42, jos: 1, run: 0.45 } },
  fake: { base: { cr: 0.25, af: 0.9, ln: 0.15, run: 0.6 } },
  throw: {
    base: { ln: 0.2, cr: 0.08, run: 0.35 },
    dyn: (age, len, p) => {
      const u = age / Math.max(0.15, len)
      p.thr = clamp01(u / 0.55)
      p.rel = easeOut(clamp01((u - 0.6) / 0.4))
    },
  },
  catch: { base: { au: 1, ln: 0.05, run: 0.8 } },
  carry: { base: { tk: 1, ln: 0.3 } },
  stumble: {
    base: { cr: 0.38, ln: 0.75, af: 0.4, sp: 0.35, run: 0.7 },
    dyn: (age, _len, p) => {
      p.ln = 0.75 + 0.15 * Math.sin(age * 22)
    },
  },
  dive: {
    base: { af: 1, ln: 0.8, run: 0 },
    dyn: (age, len, p) => {
      p.fall = ease(clamp01(age / Math.max(0.2, len)))
    },
    fallDir: 'live',
  },
  fall: {
    base: { af: 0.45, jos: 0.3, sp: 0.4, run: 0 },
    dyn: (age, len, p) => {
      p.fall = ease(clamp01(age / Math.max(0.15, len)))
    },
    fallDir: 'live',
  },
  down: { base: { af: 0.2, fall: 1, run: 0 }, fallDir: 'start' },
  kick: {
    base: { ln: 0.12, sp: 0.8, run: 0.3 },
    dyn: (age, _len, p) => {
      // Swing through, hold the follow-through, then the leg comes back down
      // and the run cycle returns (punt / FG windows can outlast the kick).
      const back = clamp01((age - 0.6) / 0.3)
      p.kk = easeOut(clamp01(age / 0.3)) * (1 - back)
      p.run = lerp(0.3, 1, back)
      p.sp = 0.8 * (1 - clamp01((age - 0.6) / 0.4))
    },
  },
  hold: { base: { cr: 1, kn: 1, af: 0.7, ln: 0.15, run: 0 } },
}

/** Every pose state the library covers. */
export const POSE_STATES = Object.keys(POSE_LIBRARY) as PoseState[]

/** Parameters of `state` `age` seconds after it began (window `len` seconds long). Writes into `out`. */
export function poseParams(state: PoseState, age: number, len: number, out: PoseParams): PoseParams {
  const def = POSE_LIBRARY[state] ?? POSE_LIBRARY.stand
  for (const k of PKEYS) out[k] = def.base[k] ?? ZERO_POSE[k]
  def.dyn?.(Math.max(0, age), Math.max(0, len), out)
  return out
}

/** out = a + (b − a)·u (all joints). */
export function blendPose(a: PoseParams, b: PoseParams, u: number, out: PoseParams): PoseParams {
  for (const k of PKEYS) out[k] = lerp(a[k], b[k], u)
  return out
}

/** Pose transitions blend over this many seconds. */
export const POSE_BLEND = 0.16

export function newPose(): PoseParams {
  return { ...ZERO_POSE }
}

// ── figure state → screen ────────────────────────────────────────────────────

/** Reference height: the projected length of this vertical (yards) is the figure unit. */
export const UNIT_YD = 2

export interface Figure {
  key: string
  side: 'off' | 'def'
  /** World position (yards). */
  x: number
  y: number
  /** World heading (radians, atan2 in world x/y). */
  heading: number
  /** Ground speed (yd/s). */
  speed: number
  /** Run-cycle phase (radians), advanced by distance travelled. */
  phase: number
  pose: PoseParams
  /** World direction of the fall (radians), or null. */
  fallDir: number | null
  kit: Kit
  number: number
  skin: string
  alpha: number
  /** Stable index for the depth sort tie-break. */
  order: number
}

export interface FigureScreen {
  /** Feet (canvas px). */
  x: number
  y: number
  depth: number
  /** Pixels per figure unit (the projected 2-yd vertical). */
  h: number
}

/** Projected feet + unit height, or null when behind the camera. */
export function figureScreen(c: Camera, x: number, y: number): FigureScreen | null {
  const p0 = project(c, x, y, 0)
  const p1 = project(c, x, y, UNIT_YD)
  if (!p0 || !p1) return null
  return { x: p0.x, y: p0.y, depth: p0.depth, h: p0.y - p1.y }
}

/** Facing relative to the camera: sdx = screen-lateral (−1 left … 1 right), tow = toward the camera (−1 away … 1 toward). */
export function facingVsCamera(c: Camera, heading: number): { sdx: number; tow: number } {
  const fx = Math.cos(heading)
  const fy = Math.sin(heading)
  return { sdx: clamp(fx * c.rhx + fy * c.rhy, -1, 1), tow: -(fx * c.fhx + fy * c.fhy) }
}

// ── sprite-part painters (unit space: 1 = projected 2 yd; y down) ────────────
// Shared by sprites.ts (pre-rendered) and the direct path below.

export type Ctx2D = CanvasRenderingContext2D

/** Torso (pants top + jersey with pads + collar), in the torso frame (hips at 0). */
export const TORSO_BOX = { x: -0.26, y: -0.37, w: 0.52, h: 0.48 }

export function paintTorso(g: Ctx2D, kit: Kit, ad: number, front: boolean, detail: boolean): void {
  const bw = 1 - 0.3 * ad
  g.lineJoin = 'round'
  // pants top
  g.fillStyle = kit.pants
  g.beginPath()
  g.rect(-0.12 * bw, -0.04, 0.24 * bw, 0.12)
  g.fill()
  g.lineWidth = 0.02
  g.strokeStyle = FIG_ART.outline
  g.stroke()
  // jersey over shoulder pads
  const gr = g.createLinearGradient(-0.2, 0, 0.2, 0)
  gr.addColorStop(0, kit.jHi)
  gr.addColorStop(0.55, kit.jersey)
  gr.addColorStop(1, kit.jLo)
  g.beginPath()
  g.moveTo(-0.115 * bw, 0)
  g.lineTo(-0.13 * bw, -0.17)
  g.quadraticCurveTo(-0.225 * bw, -0.2, -0.205 * bw, -0.29)
  g.quadraticCurveTo(-0.12 * bw, -0.35, 0, -0.335)
  g.quadraticCurveTo(0.12 * bw, -0.35, 0.205 * bw, -0.29)
  g.quadraticCurveTo(0.225 * bw, -0.2, 0.13 * bw, -0.17)
  g.lineTo(0.115 * bw, 0)
  g.closePath()
  g.fillStyle = gr
  g.fill()
  g.lineWidth = 0.024
  g.strokeStyle = FIG_ART.outline
  g.stroke()
  if (detail) {
    // pad seam
    g.strokeStyle = kit.jLo
    g.lineWidth = 0.012
    g.beginPath()
    g.moveTo(-0.17 * bw, -0.27)
    g.quadraticCurveTo(0, -0.24, 0.17 * bw, -0.27)
    g.stroke()
    if (front) {
      // collar
      g.strokeStyle = kit.trim
      g.lineWidth = 0.022
      g.beginPath()
      g.moveTo(-0.045, -0.325)
      g.lineTo(0, -0.29)
      g.lineTo(0.045, -0.325)
      g.stroke()
    }
  }
}

/** Number box around the number's centre (unit space, before the horizontal squash). */
export const NUMBER_BOX = { x: -0.17, y: -0.13, w: 0.34, h: 0.26 }

/**
 * Jersey number, painted at `px` pixels per unit with the origin at the number
 * centre (text is drawn in pixel space for crisp glyphs).
 */
export function paintNumber(g: Ctx2D, kit: Kit, n: number, px: number, font: string): void {
  const fs = px * 0.2
  g.font = `800 ${fs.toFixed(1)}px ${font}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineJoin = 'round'
  const s = String(n)
  if (kit.numStroke) {
    g.lineWidth = Math.max(1, fs * 0.16)
    g.strokeStyle = kit.numStroke
    g.strokeText(s, 0, fs * 0.04)
  }
  g.fillStyle = kit.num
  g.fillText(s, 0, fs * 0.04)
}

/** Helmet box around its centre. */
export const HELMET_R = 0.1
export const HELMET_BOX = { x: -0.13, y: -0.13, w: 0.26, h: 0.26 }

/** Helmet shell + stripe + decal + facemask (when `tow` > −0.3), centred at (0, 0). */
export function paintHelmet(g: Ctx2D, kit: Kit, sdx: number, tow: number, detail: boolean): void {
  const hr = HELMET_R
  const ad = Math.abs(sdx)
  const hg = g.createRadialGradient(-0.035, -0.045, 0.008, 0, 0, hr * 1.05)
  hg.addColorStop(0, kit.helmHi)
  hg.addColorStop(0.55, kit.helm)
  hg.addColorStop(1, kit.helmLo)
  g.beginPath()
  g.arc(0, 0, hr, 0, Math.PI * 2)
  g.fillStyle = hg
  g.fill()
  g.lineWidth = 0.022
  g.strokeStyle = FIG_ART.outline
  g.stroke()
  if (!detail) return
  g.save()
  g.beginPath()
  g.arc(0, 0, hr * 0.96, 0, Math.PI * 2)
  g.clip()
  // centre stripe(s), seen from the side they slide toward the back of the head
  const sx = -sdx * 0.035 * (tow < 0 ? -1 : 1)
  for (const [w, col] of kit.stripes) {
    g.fillStyle = col
    g.fillRect(sx - w / 2, -hr, w, hr * (ad > 0.6 ? 0.55 : 1.1))
  }
  if (ad > 0.35) {
    g.fillStyle = kit.decal
    g.beginPath()
    g.ellipse(-sdx * 0.012, 0.005, 0.035, 0.022, -0.5 * Math.sign(sdx), 0, Math.PI * 2)
    g.fill()
  }
  g.restore()
  // facemask: only when the helmet faces the camera
  if (tow > -0.3) {
    const vis = clamp01((tow + 0.3) / 0.6)
    const mx = sdx * 0.075
    const my = 0.032
    const mw = 0.13 * (1 - 0.5 * ad)
    g.save()
    g.globalAlpha *= 0.35 + 0.65 * vis
    g.beginPath()
    g.moveTo(mx - mw / 2, my - 0.012)
    g.lineTo(mx + mw / 2, my - 0.012)
    g.moveTo(mx - (mw / 2) * 0.8, my + 0.026)
    g.lineTo(mx + (mw / 2) * 0.8, my + 0.026)
    g.moveTo(mx, my - 0.02)
    g.lineTo(mx, my + 0.04)
    g.strokeStyle = FIG_ART.outline
    g.lineWidth = 0.032
    g.lineCap = 'round'
    g.stroke()
    g.strokeStyle = kit.mask
    g.lineWidth = 0.016
    g.stroke()
    g.restore()
  }
  g.strokeStyle = FIG_ART.shine
  g.lineWidth = 0.018
  g.beginPath()
  g.arc(0, 0, hr * 0.7, Math.PI * 1.08, Math.PI * 1.45)
  g.stroke()
}

// ── sprite source (implemented by sprites.ts) ────────────────────────────────

/** A pre-rendered part: draw `canvas` into the unit-space rect (x, y, w, h). */
export interface SpritePart {
  canvas: HTMLCanvasElement
  x: number
  y: number
  w: number
  h: number
}

/** What drawFigure needs from a sprite cache (null → paint directly). */
export interface SpriteSource {
  torso(kit: Kit, ad: number, front: boolean, px: number, detail: boolean): SpritePart | null
  number(kit: Kit, n: number, px: number): SpritePart | null
  helmet(kit: Kit, sdx: number, tow: number, px: number, detail: boolean): SpritePart | null
}

// ── drawing ──────────────────────────────────────────────────────────────────

function limb(g: Ctx2D, x0: number, y0: number, x1: number, y1: number, w: number, col: string, outline: boolean): void {
  g.beginPath()
  g.moveTo(x0, y0)
  g.lineTo(x1, y1)
  if (outline) {
    g.strokeStyle = FIG_ART.outline
    g.lineWidth = w + 0.03
    g.stroke()
  }
  g.strokeStyle = col
  g.lineWidth = w
  g.stroke()
}

export interface DrawOpts {
  /** Device pixel ratio (detail thresholds are in CSS px). */
  dpr: number
  /** Display font stack for the numbers. */
  font: string
  sprites: SpriteSource | null
  /** Clock (s) for the block jostle. */
  time: number
}

/** Stride (yards per full two-step cycle) at speed v (yd/s): longer when faster. */
export function cycleLength(v: number): number {
  return 1.5 + 0.12 * Math.min(10, Math.max(0, v))
}

/**
 * Leg / arm swing amplitude (0..1) at speed v before pose damping. A foot
 * swings 0.4·amp yd either side of the hips (0.2 units × the 2-yd unit), so
 * amp = cycle / (2π · 0.4) moves a planted foot back exactly as fast as the
 * body moves forward (no skating at a jog or backpedal); faded in below
 * 0.8 yd/s so a standing figure does not hold a stride.
 */
export function strideAmp(v: number): number {
  return Math.min(1, cycleLength(v) / (Math.PI * 2 * 0.4)) * clamp01(v / 0.8)
}

/** Hip height (figure units, negative = up) for a pose. */
export function hipYOf(P: PoseParams): number {
  return lerp(-(0.47 - 0.12 * P.cr), -0.25, P.kn)
}

/** Forward lean (torso tilt factor) for a pose at speed v. */
function leanOf(P: PoseParams, v: number): number {
  return P.ln + clamp01(v / 9) * 0.22 * P.run
}

/**
 * The figure's outer frame on screen (shared by drawFigure and figureHead so
 * the callout point never drifts from the drawing): feet + engaged jostle,
 * fall rotation and the fall's foreshortening (y scale), in canvas px.
 */
export interface FigureFrame {
  x: number
  y: number
  rot: number
  sy: number
}

export function figureFrame(c: Camera, f: Figure, s: FigureScreen, time: number, out?: FigureFrame): FigureFrame {
  const P = f.pose
  const h = s.h
  const o = out ?? { x: 0, y: 0, rot: 0, sy: 1 }
  o.x = s.x
  o.y = s.y
  o.rot = 0
  o.sy = 1
  if (P.jos > 0.01) {
    // Engaged: a small shove, in screen units of the figure size.
    o.x += Math.sin(time * 23 + f.order * 1.7) * 0.022 * P.jos * h
    o.y += Math.cos(time * 19 + f.order * 2.3) * 0.01 * P.jos * h
  }
  if (P.fall > 0.001 && f.fallDir != null) {
    const side = clamp((Math.cos(f.fallDir) * c.rhx + Math.sin(f.fallDir) * c.rhy) * 1.5, -1, 1)
    o.rot = P.fall * 1.42 * side
    o.sy = Math.max(0.28, 1 - P.fall * 0.7 * (1 - Math.abs(side)))
  }
  return o
}

/** Helmet centre in the torso frame (relative to the hips). */
const HEAD_Y = -0.405

/**
 * The helmet centre on screen (canvas px) — follows a falling / lying body
 * sideways. Same transforms as drawFigure.
 */
export function figureHead(c: Camera, f: Figure, s: FigureScreen, time: number): { x: number; y: number } {
  const P = f.pose
  const h = s.h
  const { sdx } = facingVsCamera(c, f.heading)
  const ad = Math.abs(sdx)
  const lean = leanOf(P, f.speed)
  // Torso frame: scale y, rotate, then offset by the hips.
  const tr = sdx * lean * 0.5
  const lx0 = sdx * 0.015
  const ly0 = HEAD_Y * (1 - lean * 0.14 * (1 - ad))
  const lx = lx0 * Math.cos(tr) - ly0 * Math.sin(tr)
  const ly = lx0 * Math.sin(tr) + ly0 * Math.cos(tr) + hipYOf(P)
  // Outer frame: unit scale, fall squash, fall rotation, feet.
  const fr = figureFrame(c, f, s, time)
  const qx = lx * h
  const qy = ly * h * fr.sy
  return { x: fr.x + qx * Math.cos(fr.rot) - qy * Math.sin(fr.rot), y: fr.y + qx * Math.sin(fr.rot) + qy * Math.cos(fr.rot) }
}

const FRAME: FigureFrame = { x: 0, y: 0, rot: 0, sy: 1 }

/** Below this many CSS px per unit a figure drops its small details. */
export const DETAIL_MIN_CSS = 16

/** Figure-local hands: [side, x, y] in the torso frame. */
const HANDS: [number, number, number][] = [
  [-1, 0, 0],
  [1, 0, 0],
]

/**
 * Draw one figure at its projected feet. `s` from figureScreen(). The caller
 * has already done the depth sort; shadows are drawn separately (drawShadows).
 */
export function drawFigure(g: Ctx2D, c: Camera, f: Figure, s: FigureScreen, o: DrawOpts): void {
  const h = s.h
  if (h < 2) return
  const P = f.pose
  const { sdx, tow } = facingVsCamera(c, f.heading)
  const ad = Math.abs(sdx)
  const bw = 1 - 0.3 * ad
  const kit = f.kit
  const amp = strideAmp(f.speed) * (1 - P.fall) * P.run
  const ph = f.phase
  const lean = leanOf(P, f.speed)
  const detail = h >= DETAIL_MIN_CSS * o.dpr
  const outline = h >= 9 * o.dpr

  g.save()
  if (f.alpha < 1) g.globalAlpha = f.alpha
  const fr = figureFrame(c, f, s, o.time, FRAME)
  g.translate(fr.x, fr.y)
  if (fr.rot !== 0) g.rotate(fr.rot)
  if (fr.sy !== 1) g.scale(1, fr.sy)
  g.scale(h, h)
  g.lineCap = 'round'
  g.lineJoin = 'round'

  const hipY = hipYOf(P)

  // ── legs ──
  for (const L of [-1, 1]) {
    const pp = ph + (L > 0 ? 0 : Math.PI)
    const sw = Math.sin(pp) * amp
    const hx = L * 0.055 * bw
    const hy = hipY
    let fxp = L * (0.06 + 0.06 * P.cr) * bw + sdx * sw * 0.2
    if (P.cr > 0.6 && L > 0) fxp -= sdx * 0.1 * P.cr
    let fyp = -Math.max(0, Math.cos(pp)) * amp * 0.09 * (1 + (1 - ad) * 0.5)
    let kx = (hx + fxp) / 2 + sdx * (0.045 * amp + 0.08 * P.cr) + L * 0.025 * P.cr * (1 - ad)
    let ky = (hy + fyp) / 2 + 0.01 * P.cr
    if (P.kk > 0 && L > 0) {
      // Kicking leg: plant behind, swing through and up.
      const u = P.kk
      fxp = lerp(fxp - sdx * 0.16, sdx * 0.34, u)
      fyp = lerp(-0.06, -0.3 * (0.4 + 0.6 * ad), Math.sin(u * Math.PI * 0.8))
      kx = (hx + fxp) / 2 + sdx * 0.05
      ky = (hy + fyp) / 2 - 0.02
    }
    if (P.kn > 0) {
      if (L < 0) {
        // Down knee on the turf, shin trailing behind.
        kx = lerp(kx, hx + sdx * 0.07, P.kn)
        ky = lerp(ky, -0.025, P.kn)
        fxp = lerp(fxp, hx - sdx * 0.14, P.kn)
        fyp = lerp(fyp, -0.015, P.kn)
      } else {
        kx = lerp(kx, hx + sdx * 0.16, P.kn)
        ky = lerp(ky, hipY - 0.02, P.kn)
        fxp = lerp(fxp, hx + sdx * 0.17, P.kn)
        fyp = lerp(fyp, 0, P.kn)
      }
    }
    limb(g, hx, hy, kx, ky, 0.105, kit.pants, outline)
    limb(g, kx, ky, fxp, fyp - 0.02, 0.08, kit.sock, outline)
    g.fillStyle = FIG_ART.shoe
    g.beginPath()
    g.ellipse(fxp + sdx * 0.025, fyp - 0.012, 0.045 + 0.025 * ad, 0.024, 0, 0, Math.PI * 2)
    g.fill()
  }

  // ── torso frame (relative to the hips) ──
  g.save()
  g.translate(0, hipY)
  g.rotate(sdx * lean * 0.5)
  g.scale(1, 1 - lean * 0.14 * (1 - ad))
  const tl = sdx >= 0 ? -1 : 1 // trailing (throwing / tucking) arm
  for (let i = 0; i < 2; i++) {
    const L = i === 0 ? -1 : 1
    const sw = -Math.sin(ph + (L > 0 ? 0 : Math.PI)) * amp
    let hx = L * 0.2 * bw + sdx * sw * 0.15
    let hy = -0.02 - Math.abs(sw) * 0.03
    hx = lerp(hx, L * 0.07 * bw + sdx * 0.25, P.af)
    hy = lerp(hy, -0.19, P.af)
    hx = lerp(hx, L * 0.1, P.au)
    hy = lerp(hy, -0.6, P.au)
    hx = lerp(hx, L * 0.36 * bw, P.sp)
    hy = lerp(hy, -0.24, P.sp)
    if (P.hd > 0) {
      if (L > 0) {
        hx = lerp(hx, sdx * 0.24 + L * 0.04, P.hd)
        hy = lerp(hy, -hipY - 0.01, P.hd)
      } else {
        hx = lerp(hx, sdx * 0.12 + L * 0.12, P.hd)
        hy = lerp(hy, 0.02, P.hd)
      }
    }
    if (P.thr > 0 && L === tl) {
      const tx = lerp(-sdx * 0.13 + L * 0.05, sdx * 0.3, P.rel)
      const ty = lerp(-0.52, -0.33, P.rel)
      hx = lerp(hx, tx, P.thr)
      hy = lerp(hy, ty, P.thr)
    }
    if (P.tk > 0 && L === tl) {
      hx = lerp(hx, sdx * 0.07 + L * 0.02, P.tk)
      hy = lerp(hy, -0.17, P.tk)
    }
    HANDS[i][0] = L
    HANDS[i][1] = hx
    HANDS[i][2] = hy
  }
  const drawArms = () => {
    for (const [L, hx, hy] of HANDS) {
      const sx = L * 0.175 * bw
      const sy = -0.27
      const ex = (sx + hx) / 2 + L * 0.035 * (1 - 0.5 * ad)
      const ey = (sy + hy) / 2 + 0.02
      limb(g, sx, sy, ex, ey, 0.088, kit.jersey, outline)
      if (detail) {
        g.strokeStyle = kit.trim
        g.lineWidth = 0.088
        g.beginPath()
        g.moveTo(lerp(sx, ex, 0.55), lerp(sy, ey, 0.55))
        g.lineTo(lerp(sx, ex, 0.72), lerp(sy, ey, 0.72))
        g.stroke()
      }
      limb(g, ex, ey, hx, hy, 0.064, f.skin, outline)
      g.fillStyle = kit.glove
      g.beginPath()
      g.arc(hx, hy, 0.036, 0, Math.PI * 2)
      g.fill()
      if (outline) {
        g.lineWidth = 0.014
        g.strokeStyle = FIG_ART.outline
        g.stroke()
      }
    }
  }
  const armsBehind = tow < -0.25
  if (armsBehind) drawArms()
  const front = tow > -0.2
  const sp = o.sprites
  const torso = sp?.torso(kit, ad, front, h, detail) ?? null
  if (torso) g.drawImage(torso.canvas, torso.x, torso.y, torso.w, torso.h)
  else paintTorso(g, kit, ad, front, detail)
  if (detail) {
    const squash = bw * (1 - 0.45 * ad)
    const nx = -sdx * 0.02
    const ny = -0.165
    const num = sp?.number(kit, f.number, h) ?? null
    g.save()
    g.translate(nx, ny)
    g.scale(squash, 1)
    if (num) g.drawImage(num.canvas, num.x, num.y, num.w, num.h)
    else {
      g.scale(1 / h, 1 / h)
      paintNumber(g, kit, f.number, h, o.font)
    }
    g.restore()
  }
  if (!armsBehind) drawArms()
  // neck + helmet
  const hx = sdx * 0.015
  const hy = HEAD_Y
  g.fillStyle = f.skin
  g.fillRect(hx - 0.035, -0.36, 0.07, 0.05)
  const helm = sp?.helmet(kit, sdx, tow, h, detail) ?? null
  if (helm) g.drawImage(helm.canvas, hx + helm.x, hy + helm.y, helm.w, helm.h)
  else {
    g.translate(hx, hy)
    paintHelmet(g, kit, sdx, tow, detail)
  }
  g.restore()
  g.restore()
}

/** Screen ellipse approximating a ground circle of radius rx × ry (yards) at (x, y). */
export function groundEllipsePath(g: Ctx2D, c: Camera, x: number, y: number, rx: number, ry: number): void {
  const p = project(c, x, y, 0)
  if (!p) return
  const k = c.focal / p.depth
  // Vertical squash: how steeply the camera looks down at this point.
  const dx = x - c.px
  const dy = y - c.py
  const squash = clamp(c.pz / Math.hypot(dx, dy, c.pz), 0.12, 1)
  const R = rx * k
  g.moveTo(p.x + R, p.y)
  g.ellipse(p.x, p.y, R, ry * k * squash, 0, 0, Math.PI * 2)
}

/** Sun / floodlight direction for the soft shadow offset (world yards per yard of height). */
export const LIGHT: [number, number] = [-0.55, -0.6]

/** Ground shadows for every figure, batched into two fills. Drawn before the depth-sorted figures. */
export function drawShadows(g: Ctx2D, c: Camera, figs: readonly Figure[]): void {
  g.beginPath()
  for (const f of figs) {
    let x = f.x
    let y = f.y
    let ext = 0
    if (f.pose.fall > 0 && f.fallDir != null) {
      // Follow the body as drawFigure lays it out on screen: rotated sideways
      // by the fall's screen-lateral part, otherwise lying away from the camera.
      const side = clamp((Math.cos(f.fallDir) * c.rhx + Math.sin(f.fallDir) * c.rhy) * 1.5, -1, 1)
      const th = f.pose.fall * 1.42 * side
      const L = f.pose.fall * 0.9
      x += (c.rhx * Math.sin(th) + c.fhx * Math.cos(th)) * L
      y += (c.rhy * Math.sin(th) + c.fhy * Math.cos(th)) * L
      ext = f.pose.fall
    }
    groundEllipsePath(g, c, x + LIGHT[0] * 0.32, y + LIGHT[1] * 0.32, 0.5 + ext * 0.35, 0.42 + ext * 0.25)
  }
  g.fillStyle = FIG_ART.shadow
  g.fill()
  g.beginPath()
  for (const f of figs) groundEllipsePath(g, c, f.x, f.y, 0.3, 0.3)
  g.fillStyle = FIG_ART.contact
  g.fill()
}

// ── depth sort ───────────────────────────────────────────────────────────────

/** Anything drawn in painter's order with the figures (figures, posts, ball, B4 effects). */
export interface DepthItem {
  /** Distance along the view axis (yards); larger = farther = drawn first. */
  depth: number
  /** Stable tie-break (lower first among equal depths). */
  order: number
}

/** Far → near, stable on `order` (does not depend on the input order). Sorts in place. */
export function depthSort<T extends DepthItem>(items: T[]): T[] {
  return items.sort((a, b) => b.depth - a.depth || a.order - b.order)
}

/** Deterministic small hash (skin tone, fallback numbers). */
export function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function skinFor(key: string, n: number): string {
  return SKIN[(hashStr(key) + n * 7) % SKIN.length]
}

/** A plausible number for an actor without a roster number (role range). */
export function fallbackNumber(key: string, role: string): number {
  const ranges: Record<string, [number, number]> = {
    QB: [1, 19],
    K: [1, 19],
    P: [1, 19],
    H: [1, 19],
    RB: [20, 39],
    FB: [40, 49],
    WR: [10, 19],
    SLOT: [80, 89],
    TE: [80, 89],
    OL: [60, 79],
    DL: [90, 99],
    LB: [40, 59],
    CB: [20, 39],
    S: [20, 49],
    PR: [10, 39],
  }
  const [lo, hi] = ranges[role] ?? [1, 99]
  return lo + (hashStr(key) % (hi - lo + 1))
}

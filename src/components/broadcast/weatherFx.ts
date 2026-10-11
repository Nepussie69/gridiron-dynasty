// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (animflow 6b-wx): weather on the field — the broadcast side of
// FUTURES #6 (W3b).
//
//   rain   world-space streaks falling round the camera focus (motion-blurred,
//          slanted by the wind), a wet sheen on the turf (darker near, glossy
//          far, the light banks reflected toward the lens)
//   snow   drifting flakes and a dusting on the turf
//   cold   breath puffs at the players' helmets (<= 42 F)
//   wind   streamers on the goalpost uprights and a flag on each end wall that
//          stream with the wind (the along-field component in world x; it flips
//          each quarter because the home club always attacks +x on screen while
//          the sim's ends switch), flutter faster when it blows harder
//   indoors / weather off / no weather: nothing at all (`fieldWeather` → null)
//
// Lite quality: ~35% of the particles, no light reflections, breath on the 10
// nearest men only. Reduced motion: no moving particles — a still veil and the
// sheen show the conditions; streamers and flags hold a static lean.
//
// Presentation only: reads the game's GameWeather (a pure function of the
// schedule game) and the recorded play's quarter, never the sim or rng. No DOM
// beyond the canvas it is handed; loadable from a node script.
// ─────────────────────────────────────────────────────────────────────────────
import type { GameWeather } from '../../game/engine/weather'
import { FIELD_LENGTH, FIELD_WIDTH, HASH_HALF, MID_WIDTH, project, type Camera } from './camera.ts'
import type { ActorLayer, Scene, SceneItem } from './actors.ts'
import type { ClubLike } from './palette.ts'
import type { LayerHook } from './renderer.ts'

/** What the field draws for a game, or null for nothing (indoors / off / none). */
export interface FieldWeather {
  precip: 'none' | 'rain' | 'snow'
  /** 0..1 precipitation strength. */
  intensity: number
  tempF: number
  windMph: number
  /** Signed along-field wind (the sim's convention: + into the home offence's face in odd quarters). */
  windAlong: number
}

/** Below this the air is cold enough to see breath (F). */
export const BREATH_F = 42
/** Goalposts closer than this to the lens are not drawn (actors.ts POST_NEAR_YD): nor their streamers. */
const POST_NEAR_YD = 22
const UPRIGHT_TOP = 10 / 3 + 10
/** End-wall flag poles (just inside the bowl walls, behind each end zone). */
const FLAG_X = [-12.5, FIELD_LENGTH + 12.5] as const
const FLAG_Y = MID_WIDTH + 14
const POLE_TOP = 13
const TAU = Math.PI * 2

/** Weather art (fixed broadcast colours; rgba templates, A = alpha). */
const WX_ART = {
  rain: 'rgba(206,216,232,A)',
  snow: 'rgba(246,248,252,A)',
  breath: 'rgba(236,240,246,A)',
  veil: 'rgba(150,162,182,A)',
  sheenFar: 'rgba(196,208,232,A)',
  sheenNear: 'rgba(8,16,24,A)',
  glint: 'rgba(230,236,250,A)',
  dust: 'rgba(238,242,248,A)',
  streamer: 'rgba(255,122,26,A)',
  pole: 'rgba(170,176,188,A)',
} as const

const rgba = (tpl: string, a: number) => tpl.replace('A', (a < 0 ? 0 : a > 1 ? 1 : a).toFixed(3))

/**
 * The field's weather for a game: null indoors (a closed roof or a dome), when
 * the weather toggle is off, or when there is no weather. Pure.
 */
export function fieldWeather(w: GameWeather | null | undefined, enabled: boolean): FieldWeather | null {
  if (!enabled || !w || w.closed) return null
  return { precip: w.precip, intensity: w.precip === 'none' ? 0 : Math.max(0, Math.min(1, w.intensity)), tempF: w.tempF, windMph: Math.max(0, w.windMph), windAlong: w.windAlong }
}

/**
 * World wind (mph, x along the field, y across) in the quarter. The sim's
 * headwind for the home offence is `windAlong` in odd quarters and `-windAlong`
 * in even ones; the broadcast keeps the home club attacking +x, so a headwind
 * blows toward -x. The cross component has no recorded sign: it blows to +y.
 */
export function worldWind(w: FieldWeather, qtr: number): { x: number; y: number } {
  const phase = qtr % 2 === 0 ? -1 : 1
  const along = Math.max(-w.windMph, Math.min(w.windMph, w.windAlong))
  return { x: -along * phase, y: Math.sqrt(Math.max(0, w.windMph * w.windMph - along * along)) }
}

export interface WeatherStats {
  /** Particles drawn in the last frame. */
  particles: number
  breath: number
  streamers: number
  flags: number
  sheen: boolean
  veil: boolean
  ms: number
}

/** Deterministic 0..1 per (i, salt). */
function h01(i: number, salt: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x27d4eb2f, 0xc2b2ae35)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  return (h >>> 0) / 4294967296
}

const mod = (a: number, n: number) => a - n * Math.floor(a / n)

export class WeatherLayer {
  /** The game's field weather (null = nothing drawn). */
  weather: FieldWeather | null = null
  /** The recorded play's quarter (wind direction). */
  qtr = 1
  /** Play seconds (+ the end hold) for the particle clock. */
  sec = 0
  quality: 'full' | 'lite' = 'full'
  reducedMotion = false
  /** Home club (the end-wall flags). */
  club: ClubLike | null = null
  stats: WeatherStats = { particles: 0, breath: 0, streamers: 0, flags: 0, sheen: false, veil: false, ms: 0 }
  private layer: ActorLayer | null

  constructor(layer: ActorLayer | null = null) {
    this.layer = layer
  }

  get active(): boolean {
    return !!this.weather
  }

  private wind(): { x: number; y: number; mph: number } {
    const w = this.weather
    if (!w) return { x: 0, y: 0, mph: 0 }
    const v = worldWind(w, this.qtr)
    return { ...v, mph: w.windMph }
  }

  // ── turf (before the lines and the players) ────────────────────────────────

  /** Wet sheen / snow dusting on the turf. */
  readonly ground: LayerHook = (ctx, cam) => {
    const w = this.weather
    this.stats.sheen = false
    this.stats.ms = 0
    if (!w || w.precip === 'none') return
    const t0 = performance.now()
    const field: [number, number, number][] = [
      [0, 0, 0],
      [FIELD_LENGTH, 0, 0],
      [FIELD_LENGTH, FIELD_WIDTH, 0],
      [0, FIELD_WIDTH, 0],
    ]
    const pts = clipGround(cam, field)
    if (pts.length < 3) return
    let top = Infinity
    let bot = -Infinity
    for (const p of pts) {
      top = Math.min(top, p[1])
      bot = Math.max(bot, p[1])
    }
    top = Math.max(0, top)
    bot = Math.min(cam.height, bot)
    if (bot <= top) return
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
    ctx.closePath()
    const k = w.intensity
    if (w.precip === 'rain') {
      // Soaked turf: glossy toward the far end (the sky / lights reflected),
      // darker toward the lens.
      const g = ctx.createLinearGradient(0, top, 0, bot)
      g.addColorStop(0, rgba(WX_ART.sheenFar, 0.16 + 0.12 * k))
      g.addColorStop(0.55, rgba(WX_ART.sheenFar, 0.03))
      g.addColorStop(1, rgba(WX_ART.sheenNear, 0.12 + 0.1 * k))
      ctx.fillStyle = g
      ctx.fill()
      if (this.quality !== 'lite') {
        // The light banks mirrored in the wet turf toward the lens.
        ctx.clip()
        for (const L of LIGHTS) {
          const r = reflectionPoint(cam, L)
          if (!r) continue
          if (r.x < -2 || r.x > FIELD_LENGTH + 2 || r.y < -2 || r.y > FIELD_WIDTH + 2) continue
          const p = project(cam, r.x, r.y, 0)
          if (!p || p.x < -cam.width * 0.3 || p.x > cam.width * 1.3 || p.y < -50 || p.y > cam.height + 50) continue
          const rad = (cam.focal / p.depth) * 4.5
          ctx.save()
          ctx.translate(p.x, p.y)
          ctx.scale(1, 2.6)
          const gg = ctx.createRadialGradient(0, 0, 0, 0, 0, rad)
          gg.addColorStop(0, rgba(WX_ART.glint, 0.16 + 0.12 * k))
          gg.addColorStop(1, rgba(WX_ART.glint, 0))
          ctx.fillStyle = gg
          ctx.fillRect(-rad, -rad, rad * 2, rad * 2)
          ctx.restore()
        }
      }
    } else {
      const g = ctx.createLinearGradient(0, top, 0, bot)
      g.addColorStop(0, rgba(WX_ART.dust, 0.3 + 0.25 * k))
      g.addColorStop(1, rgba(WX_ART.dust, 0.14 + 0.2 * k))
      ctx.fillStyle = g
      ctx.fill()
    }
    ctx.restore()
    this.stats.sheen = true
    this.stats.ms = performance.now() - t0
  }

  // ── depth-sorted with the players: goalpost streamers, end-wall flags ────

  /** SceneItems for the actor layer's sort (chain into `layer.people`). */
  items(scene: Scene, out: SceneItem[]): void {
    const w = this.weather
    this.stats.streamers = 0
    this.stats.flags = 0
    if (!w) return
    const cam = scene.cam
    const wind = this.wind()
    const sec = this.reducedMotion ? 0 : this.sec
    let order = 0
    for (const gx of [0, FIELD_LENGTH]) {
      if (Math.hypot(cam.px - gx, cam.py - MID_WIDTH) < POST_NEAR_YD) continue
      for (const s of [-1, 1]) {
        const base: [number, number, number] = [gx, MID_WIDTH + s * HASH_HALF, UPRIGHT_TOP]
        const p = project(cam, base[0], base[1], base[2])
        if (!p) continue
        const ph = (gx + s * 7) * 0.37
        out.push({ depth: p.depth - 0.01, order: order++, draw: (g) => drawStreamer(g, cam, base, wind, sec, ph, this.reducedMotion) })
        this.stats.streamers++
      }
    }
    for (const fx of FLAG_X) {
      const base: [number, number, number] = [fx, FLAG_Y, 0]
      const p = project(cam, fx, FLAG_Y, POLE_TOP)
      if (!p) continue
      if (p.x < -cam.width * 0.5 || p.x > cam.width * 1.5 || p.y > cam.height + 40) continue
      const club = this.club
      out.push({ depth: p.depth, order: order++, draw: (g) => drawFlag(g, cam, base, wind, sec, club, this.reducedMotion) })
      this.stats.flags++
    }
  }

  // ── air (over the players, under the HUD) ─────────────────────────────────

  readonly air: LayerHook = (ctx, cam, _frame, info) => {
    const w = this.weather
    this.stats.particles = 0
    this.stats.breath = 0
    this.stats.veil = false
    if (!w) return
    const t0 = performance.now()
    const lite = this.quality === 'lite'
    if (w.tempF <= BREATH_F && !this.reducedMotion) this.drawBreath(ctx, cam, info.dpr, lite)
    if (w.precip !== 'none' && w.intensity > 0) {
      if (this.reducedMotion) {
        // A still veil instead of moving particles.
        ctx.fillStyle = rgba(WX_ART.veil, (w.precip === 'snow' ? 0.1 : 0.07) + 0.08 * w.intensity)
        ctx.fillRect(0, 0, cam.width, cam.height)
        this.stats.veil = true
      } else if (w.precip === 'rain') this.drawRain(ctx, cam, info.dpr, lite)
      else this.drawSnow(ctx, cam, info.dpr, lite)
    }
    this.stats.ms += performance.now() - t0
  }

  /** World box round the view (axis-aligned) that the particles wrap inside. */
  private box(cam: Camera): { x0: number; y0: number; z0: number; lx: number; ly: number; lz: number } {
    const [tx, ty] = cam.pose.target
    const d = Math.hypot(tx - cam.px, ty - cam.py)
    // From just in front of the lens to a little past the focus.
    const ax = cam.px + cam.fhx * 2
    const ay = cam.py + cam.fhy * 2
    const bx = tx + cam.fhx * Math.min(26, d * 0.7)
    const by = ty + cam.fhy * Math.min(26, d * 0.7)
    // Visible half-width at the far end of the box (+ margin).
    const half = ((cam.width / 2) * (d + 26)) / cam.focal + 4
    const x0 = Math.min(ax, bx) - Math.abs(cam.rhx) * half - 3
    const x1 = Math.max(ax, bx) + Math.abs(cam.rhx) * half + 3
    const y0 = Math.min(ay, by) - Math.abs(cam.rhy) * half - 3
    const y1 = Math.max(ay, by) + Math.abs(cam.rhy) * half + 3
    return { x0, y0, z0: 0, lx: Math.max(8, x1 - x0), ly: Math.max(8, y1 - y0), lz: cam.pz + 6 }
  }

  private count(base: number, lite: boolean): number {
    const k = this.weather?.intensity ?? 0
    return Math.round((base * 0.35 + base * 0.65 * k) * (lite ? 0.35 : 1))
  }

  private drawRain(ctx: CanvasRenderingContext2D, cam: Camera, dpr: number, lite: boolean): void {
    const n = this.count(700, lite)
    const b = this.box(cam)
    const wind = this.wind()
    // yd/s: rain falls ~9 yd/s, pushed by the wind (1 mph ≈ 0.49 yd/s, a third of it).
    const vz = -9.5
    const vx = wind.x * 0.49 * 0.5
    const vy = wind.y * 0.49 * 0.5
    const blur = 0.07 // s of motion blur per streak
    const t = this.sec
    const near = new Path2DLike()
    const far = new Path2DLike()
    let drawn = 0
    for (let i = 0; i < n; i++) {
      const px = b.x0 + mod(h01(i, 1) * b.lx + vx * t, b.lx)
      const py = b.y0 + mod(h01(i, 2) * b.ly + vy * t, b.ly)
      const pz = mod(h01(i, 3) * b.lz + vz * t * (0.85 + 0.3 * h01(i, 4)), b.lz)
      const a = project(cam, px, py, pz)
      if (!a || a.x < -20 || a.x > cam.width + 20 || a.y < -40 || a.y > cam.height + 40) continue
      const e = project(cam, px - vx * blur, py - vy * blur, pz - vz * blur)
      if (!e) continue
      ;(a.depth < 14 ? near : far).seg(a.x, a.y, e.x, e.y)
      drawn++
    }
    const k = this.weather?.intensity ?? 0
    ctx.save()
    ctx.lineCap = 'round'
    ctx.strokeStyle = rgba(WX_ART.rain, 0.32 + 0.2 * k)
    ctx.lineWidth = Math.max(0.6, 0.7 * dpr)
    far.stroke(ctx)
    ctx.strokeStyle = rgba(WX_ART.rain, 0.42 + 0.25 * k)
    ctx.lineWidth = Math.max(1, 1.3 * dpr)
    near.stroke(ctx)
    ctx.restore()
    this.stats.particles = drawn
  }

  private drawSnow(ctx: CanvasRenderingContext2D, cam: Camera, dpr: number, lite: boolean): void {
    const n = this.count(520, lite)
    const b = this.box(cam)
    const wind = this.wind()
    const vz = -1.3
    const vx = wind.x * 0.49 * 0.7
    const vy = wind.y * 0.49 * 0.7
    const t = this.sec
    const k = this.weather?.intensity ?? 0
    const small: number[] = []
    const big: number[] = []
    for (let i = 0; i < n; i++) {
      const sway = Math.sin(t * (1.2 + h01(i, 5)) + h01(i, 6) * TAU) * 0.6
      const px = b.x0 + mod(h01(i, 1) * b.lx + vx * t + sway, b.lx)
      const py = b.y0 + mod(h01(i, 2) * b.ly + vy * t + sway * 0.6, b.ly)
      const pz = mod(h01(i, 3) * b.lz + vz * t * (0.7 + 0.6 * h01(i, 4)), b.lz)
      const a = project(cam, px, py, pz)
      if (!a || a.x < -6 || a.x > cam.width + 6 || a.y < -6 || a.y > cam.height + 6) continue
      const r = Math.max(0.7 * dpr, Math.min(4 * dpr, (cam.focal / a.depth) * 0.055))
      ;(r > 1.8 * dpr ? big : small).push(a.x, a.y, r)
    }
    ctx.save()
    ctx.fillStyle = rgba(WX_ART.snow, 0.55 + 0.25 * k)
    ctx.beginPath()
    for (let i = 0; i < small.length; i += 3) ctx.rect(small[i] - small[i + 2], small[i + 1] - small[i + 2], small[i + 2] * 2, small[i + 2] * 2)
    ctx.fill()
    ctx.fillStyle = rgba(WX_ART.snow, 0.75 + 0.2 * k)
    ctx.beginPath()
    for (let i = 0; i < big.length; i += 3) {
      ctx.moveTo(big[i] + big[i + 2], big[i + 1])
      ctx.arc(big[i], big[i + 1], big[i + 2], 0, TAU)
    }
    ctx.fill()
    ctx.restore()
    this.stats.particles = (small.length + big.length) / 3
  }

  private drawBreath(ctx: CanvasRenderingContext2D, cam: Camera, dpr: number, lite: boolean): void {
    const w = this.weather!
    const layer = this.layer
    if (!layer || !layer.screen.size) return
    const cold = Math.max(0, Math.min(1, (BREATH_F + 2 - w.tempF) / 24))
    if (cold <= 0) return
    const wind = this.wind()
    // The wind's screen direction (a short world step at the focus).
    const [tx, ty] = cam.pose.target
    const a = project(cam, tx, ty, 2)
    const bb = project(cam, tx + wind.x * 0.05, ty + wind.y * 0.05, 2)
    const wsx = a && bb ? bb.x - a.x : 0
    const wsy = a && bb ? bb.y - a.y : 0
    let list = [...layer.screen.values()].filter((s) => s.scale >= 6 * dpr && s.pose !== 'down')
    if (lite) list = list.sort((p, q) => p.depth - q.depth).slice(0, 10)
    const sec = this.sec
    let n = 0
    ctx.save()
    for (const s of list) {
      const hk = hashKey(s.key)
      const period = 1.25 + 0.6 * h01(hk, 7)
      const age = mod(sec + h01(hk, 8) * period, period)
      const life = 0.75
      if (age > life) continue
      const u = age / life
      const r = s.scale * (0.045 + 0.13 * u)
      const x = s.headX + s.scale * 0.06 + wsx * u * 0.6
      const y = s.headY + s.scale * 0.05 - s.scale * 0.12 * u + wsy * u * 0.6
      ctx.globalAlpha = 1
      ctx.fillStyle = rgba(WX_ART.breath, cold * 0.42 * (1 - u) * (1 - u * 0.3))
      ctx.beginPath()
      ctx.ellipse(x, y, r * 1.25, r, 0, 0, TAU)
      ctx.fill()
      n++
    }
    ctx.restore()
    this.stats.breath = n
  }
}

/** Collected line segments, stroked in one call. */
class Path2DLike {
  private v: number[] = []
  seg(x0: number, y0: number, x1: number, y1: number): void {
    this.v.push(x0, y0, x1, y1)
  }
  stroke(ctx: CanvasRenderingContext2D): void {
    if (!this.v.length) return
    ctx.beginPath()
    const v = this.v
    for (let i = 0; i < v.length; i += 4) {
      ctx.moveTo(v[i], v[i + 1])
      ctx.lineTo(v[i + 2], v[i + 3])
    }
    ctx.stroke()
  }
}

function hashKey(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Light banks on the bowl rim (world, yards). */
const LIGHTS: [number, number, number][] = [
  [-6, -22, 42],
  [60, -26, 46],
  [126, -22, 42],
  [-6, 75, 42],
  [60, 79, 46],
  [126, 75, 42],
]

/** Where a light's mirror image in the turf meets the line to the lens (the glint). */
function reflectionPoint(cam: Camera, L: [number, number, number]): { x: number; y: number } | null {
  // Mirror the light under the turf (z → −z); the glint is where the lens → image
  // line crosses z = 0.
  const zc = cam.pz
  const zl = -L[2]
  if (zc <= 0) return null
  const k = zc / (zc - zl)
  return { x: cam.px + (L[0] - cam.px) * k, y: cam.py + (L[1] - cam.py) * k }
}

/** Ground polygon clipped at the near plane, in screen px. */
function clipGround(cam: Camera, pts: [number, number, number][]): [number, number][] {
  const out: [number, number][] = []
  const n = pts.length
  const C = pts.map((p) => {
    const dx = p[0] - cam.px
    const dy = p[1] - cam.py
    const dz = p[2] - cam.pz
    return [dx * cam.rx + dy * cam.ry + dz * cam.rz, dx * cam.ux + dy * cam.uy + dz * cam.uz, dx * cam.fx + dy * cam.fy + dz * cam.fz]
  })
  const push = (r: number, u: number, d: number) => out.push([cam.cx + (cam.focal * r) / d, cam.cy - (cam.focal * u) / d])
  for (let i = 0; i < n; i++) {
    const a = C[i]
    const b = C[(i + 1) % n]
    const ain = a[2] >= cam.near
    const bin = b[2] >= cam.near
    if (ain) push(a[0], a[1], a[2])
    if (ain !== bin) {
      const k = (cam.near - a[2]) / (b[2] - a[2])
      push(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, cam.near)
    }
  }
  return out
}

/**
 * One streamer from the top of an upright: hangs along the post when calm,
 * streams out with the wind as it blows harder, and flutters.
 */
function drawStreamer(g: CanvasRenderingContext2D, cam: Camera, base: [number, number, number], wind: { x: number; y: number; mph: number }, sec: number, ph: number, still: boolean): void {
  const s = Math.max(0, Math.min(1, wind.mph / 20))
  const wl = Math.hypot(wind.x, wind.y)
  const ux = wl > 0.01 ? wind.x / wl : 1
  const uy = wl > 0.01 ? wind.y / wl : 0
  const lift = Math.sin(s * Math.PI * 0.45) // 0 hanging … ~0.98 streaming
  const drop = Math.cos(s * Math.PI * 0.45)
  const L = 2.4
  const N = 7
  const amp = still ? 0 : 0.06 + 0.16 * s
  const om = 5 + 12 * s
  let prev: { x: number; y: number } | null = null
  const p0 = project(cam, base[0], base[1], base[2])
  if (!p0) return
  const wpx = Math.max(1.5, (cam.focal / p0.depth) * 0.2)
  g.save()
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.strokeStyle = rgba(WX_ART.streamer, 0.95)
  g.lineWidth = wpx
  g.beginPath()
  for (let i = 0; i <= N; i++) {
    const u = i / N
    const d = L * u
    const wav = Math.sin(u * 5 - sec * om + ph) * amp * u
    const x = base[0] + ux * d * lift - uy * wav
    const y = base[1] + uy * d * lift + ux * wav
    const z = base[2] - d * drop * 0.95 + (still ? 0 : Math.sin(u * 4 - sec * om * 0.8 + ph) * amp * 0.5 * u)
    const p = project(cam, x, y, z)
    if (!p) continue
    if (!prev) g.moveTo(p.x, p.y)
    else g.lineTo(p.x, p.y)
    prev = p
  }
  g.stroke()
  g.restore()
}

/** A flag on a pole on the end wall, flying with the wind (limp when calm). */
function drawFlag(g: CanvasRenderingContext2D, cam: Camera, base: [number, number, number], wind: { x: number; y: number; mph: number }, sec: number, club: ClubLike | null, still: boolean): void {
  const top = POLE_TOP
  const a = project(cam, base[0], base[1], 0)
  const b = project(cam, base[0], base[1], top)
  if (!a || !b) return
  const k = cam.focal / b.depth
  g.save()
  g.lineCap = 'round'
  g.strokeStyle = rgba(WX_ART.pole, 0.9)
  g.lineWidth = Math.max(1, k * 0.12)
  g.beginPath()
  g.moveTo(a.x, a.y)
  g.lineTo(b.x, b.y)
  g.stroke()
  const s = Math.max(0, Math.min(1, wind.mph / 22))
  const wl = Math.hypot(wind.x, wind.y)
  const ux = wl > 0.01 ? wind.x / wl : 1
  const uy = wl > 0.01 ? wind.y / wl : 0
  const lift = Math.sin(0.15 + s * Math.PI * 0.4)
  const drop = Math.cos(0.15 + s * Math.PI * 0.4)
  const FW = 4.2
  const FH = 1.4
  const cols = 6
  const amp = still ? 0 : 0.08 + 0.22 * s
  const om = 3 + 7 * s
  const strip = (row: number): { x: number; y: number }[] => {
    const pts: { x: number; y: number }[] = []
    for (let i = 0; i <= cols; i++) {
      const u = i / cols
      const d = FW * u
      const wav = Math.sin(u * 4.2 - sec * om) * amp * u
      const x = base[0] + ux * d * lift - uy * wav
      const y = base[1] + uy * d * lift + ux * wav
      const z = top - row * FH - d * drop * 0.8
      const p = project(cam, x, y, z)
      if (p) pts.push(p)
    }
    return pts
  }
  const up = strip(0)
  const lo = strip(1)
  if (up.length > 1 && lo.length > 1) {
    const fill = (pts: { x: number; y: number }[], c: string) => {
      g.fillStyle = c
      g.beginPath()
      g.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y)
      g.closePath()
      g.fill()
    }
    const mid = up.map((p, i) => ({ x: (p.x + (lo[i]?.x ?? p.x)) / 2, y: (p.y + (lo[i]?.y ?? p.y)) / 2 }))
    fill([...up, ...[...mid].reverse()], club?.primary ?? rgba(WX_ART.pole, 1))
    fill([...mid, ...[...lo].reverse()], club?.secondary ?? rgba(WX_ART.snow, 1))
  }
  g.restore()
}

// ─────────────────────────────────────────────────────────────────────────────
// animflow r6b (ratings audit item 3, the broadcast side of W3b): the game's
// weather on the field. Reads the recorded GameWeather (GameSim.weather,
// read-only) and draws:
//   • rain: slanted streaks (the slant follows the wind), a wet sheen on the turf
//   • snow: drifting flakes, a light dusting on the turf
//   • cold (< 40 F, open air): breath puffs at the helmets
//   • wind: streamers on top of both goalpost uprights and a stadium flag at
//     midfield over the far sideline, blowing with the wind's direction and
//     strength (limp in a calm)
// Indoors (a dome or a closed roof) nothing is drawn. Lite quality draws a
// quarter of the particles and no breath; reduced motion freezes them.
// Presentation only: nothing here touches the sim, rng or saves.
// ─────────────────────────────────────────────────────────────────────────────
import type { GameWeather } from '../../game/engine/weather'
import { clipPolygon, FIELD_LENGTH, FIELD_WIDTH, HASH_HALF, MID_WIDTH, project, type Camera, type Direction } from './camera.ts'
import type { ActorScreen } from './actors'
import type { QualityLevel } from './quality.ts'

/** What the layer will draw for a game (pure; checks and the probe read it). */
export interface WxLook {
  /** Anything at all (false indoors / no weather). */
  on: boolean
  rain: number
  snow: number
  /** Turf sheen 0..1 (rain) / dusting 0..1 (snow). */
  wet: number
  dust: number
  /** Breath puffs (cold, open air). */
  breath: boolean
  /** Wind in world yards-per-second-ish units: x along the field, y across. */
  windX: number
  windY: number
  /** 0 calm … 1 a gale (30 mph). */
  windK: number
}

const NONE: WxLook = { on: false, rain: 0, snow: 0, wet: 0, dust: 0, breath: false, windX: 0, windY: 0, windK: 0 }

/** The look for a game's weather; `dir` 1 = the home club attacks +x (wind is recorded along the field). */
export function weatherLook(w: GameWeather | null | undefined): WxLook {
  if (!w || w.closed || w.roof === 'dome') return NONE
  const mph = Math.max(0, w.windMph || 0)
  const along = Math.max(-mph, Math.min(mph, w.windAlong || 0))
  // The cross-field part's sign is not recorded: a fixed one per speed (deterministic).
  const cross = Math.sqrt(Math.max(0, mph * mph - along * along)) * ((Math.round(mph * 10) % 2) ? 1 : -1)
  const rain = w.precip === 'rain' ? Math.max(0.15, Math.min(1, w.intensity || 0)) : 0
  const snow = w.precip === 'snow' ? Math.max(0.15, Math.min(1, w.intensity || 0)) : 0
  return {
    on: true,
    rain,
    snow,
    wet: rain ? 0.35 + 0.65 * rain : 0,
    dust: snow ? 0.3 + 0.7 * snow : 0,
    breath: (w.tempF ?? 60) < 40,
    windX: along,
    windY: cross,
    windK: Math.min(1, mph / 30),
  }
}

const h01 = (n: number) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x) }

export interface WxStats { ms: number; particles: number }

export class WeatherLayer {
  look: WxLook = NONE
  quality: QualityLevel = 'full'
  reducedMotion = false
  stats: WxStats = { ms: 0, particles: 0 }
  /** Wall clock (s) for the particles and the streamers' flutter. */
  private clock(): number {
    return this.reducedMotion ? 0 : (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000
  }

  set(w: GameWeather | null | undefined): void {
    this.look = weatherLook(w)
  }

  /** Under the players, over the paint: the wet sheen / snow dusting. */
  ground(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const L = this.look
    if (!L.on || (L.wet <= 0 && L.dust <= 0)) return
    const poly = clipPolygon(cam, [[-2, -2, 0], [FIELD_LENGTH + 2, -2, 0], [FIELD_LENGTH + 2, FIELD_WIDTH + 2, 0], [-2, FIELD_WIDTH + 2, 0]])
    if (poly.length < 3) return
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(poly[0][0], poly[0][1])
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1])
    ctx.closePath()
    if (L.wet > 0) {
      // Darker, wet turf with a cool specular band toward the far side.
      ctx.fillStyle = `rgba(12,22,30,${(0.14 * L.wet).toFixed(3)})`
      ctx.fill()
      let top = Infinity
      let bot = -Infinity
      for (const p of poly) { top = Math.min(top, p[1]); bot = Math.max(bot, p[1]) }
      if (bot > top) {
        const g = ctx.createLinearGradient(0, top, 0, bot)
        g.addColorStop(0, `rgba(200,220,235,${(0.16 * L.wet).toFixed(3)})`)
        g.addColorStop(0.45, 'rgba(200,220,235,0)')
        ctx.fillStyle = g
        ctx.fill()
      }
    }
    if (L.dust > 0) {
      ctx.fillStyle = `rgba(236,240,246,${(0.3 * L.dust).toFixed(3)})`
      ctx.fill()
    }
    ctx.restore()
  }

  /** Over the players: precipitation, breath, streamers and the flag. */
  air(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number, dpr: number, dir: Direction, screen?: ReadonlyMap<string, ActorScreen>): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0
    const L = this.look
    this.stats.particles = 0
    if (!L.on) { this.stats.ms = 0; return }
    const time = this.clock()
    const lite = this.quality === 'lite'
    // World wind (offense frame is not needed: the weather is recorded in world terms).
    const wx = L.windX * dir
    const wy = L.windY
    this.flags(ctx, cam, wx, wy, L.windK, time, dpr)
    if (L.rain > 0 || L.snow > 0) {
      // Screen slant: project a fall with the wind's drift at the camera's target.
      const ax = cam.px + cam.fx * 30
      const ay = cam.py + cam.fy * 30
      const a = project(cam, ax, ay, 6)
      const k = L.snow > 0 ? 0.12 : 0.05
      const b = project(cam, ax + wx * k, ay + wy * k, 6 - (L.snow > 0 ? 0.6 : 1.6))
      let sx = 0
      let sy = 1
      if (a && b) {
        const dx = b.x - a.x
        const dy = b.y - a.y
        const m = Math.hypot(dx, dy) || 1
        sx = dx / m
        sy = Math.abs(dy / m) < 0.35 ? 0.35 : dy / m
        if (sy < 0) { sx = -sx; sy = -sy }
      }
      const base = L.rain > 0 ? 90 + 150 * L.rain : 70 + 130 * L.snow
      const n = Math.round(base * (lite ? 0.25 : 1) * Math.min(1.6, (w * h) / (1280 * 720 * dpr * dpr) + 0.4))
      this.stats.particles = n
      ctx.save()
      if (L.rain > 0) {
        const len = (14 + 10 * L.rain) * dpr
        const vel = 1.6 // screen heights per second
        ctx.strokeStyle = `rgba(210,222,235,${(0.22 + 0.2 * L.rain).toFixed(3)})`
        ctx.lineWidth = Math.max(1, 0.9 * dpr)
        ctx.beginPath()
        for (let i = 0; i < n; i++) {
          const u = h01(i * 1.37 + 0.5)
          const z = h01(i * 2.11 + 3.1)
          const f = (z + time * vel * (0.8 + 0.4 * u)) % 1
          const y = f * (h + len) - len
          const x = ((u * (w + h * 0.6) - h * 0.3 + sx / Math.max(0.35, sy) * y) % (w + 40)) - 20
          ctx.moveTo(x, y)
          ctx.lineTo(x + sx * len, y + sy * len)
        }
        ctx.stroke()
      } else {
        const vel = 0.18
        ctx.fillStyle = 'rgba(246,248,252,0.85)'
        ctx.beginPath()
        for (let i = 0; i < n; i++) {
          const u = h01(i * 1.37 + 0.5)
          const z = h01(i * 2.11 + 3.1)
          const r = (0.8 + 1.6 * h01(i * 0.77 + 9.2)) * dpr
          const f = (z + time * vel * (0.7 + 0.6 * u)) % 1
          const y = f * (h + 10) - 5
          const sway = Math.sin(time * 1.3 + i) * 6 * dpr
          const x = ((u * (w + 80) + sx / Math.max(0.35, sy) * y * 0.6 + sway) % (w + 20)) - 10
          ctx.moveTo(x + r, y)
          ctx.arc(x, y, r, 0, Math.PI * 2)
        }
        ctx.fill()
      }
      ctx.restore()
    }
    if (L.breath && !lite && screen) this.breath(ctx, screen, time, wx)
    this.stats.ms = (typeof performance !== 'undefined' ? performance.now() : 0) - t0
  }

  /** A short puff in front of each visible helmet, every couple of seconds. */
  private breath(ctx: CanvasRenderingContext2D, screen: ReadonlyMap<string, ActorScreen>, time: number, wx: number): void {
    ctx.save()
    let i = 0
    for (const s of screen.values()) {
      i++
      if (s.scale < 14) continue
      const ph = (time * 0.55 + h01(i * 3.3)) % 1
      if (ph > 0.45) continue
      const u = ph / 0.45
      const r = s.scale * (0.05 + 0.09 * u)
      const a = 0.32 * (1 - u)
      const drift = (wx >= 0 ? 1 : -1) * s.scale * 0.12 * u
      ctx.fillStyle = `rgba(240,244,250,${a.toFixed(3)})`
      ctx.beginPath()
      ctx.ellipse(s.headX + drift + s.scale * 0.06, s.headY + s.scale * 0.03 - s.scale * 0.05 * u, r * 1.3, r, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  /** Goalpost streamers (both uprights, both ends) and the midfield flag. */
  private flags(ctx: CanvasRenderingContext2D, cam: Camera, wx: number, wy: number, k: number, time: number, dpr: number): void {
    const m = Math.hypot(wx, wy)
    const ux = m > 0.1 ? wx / m : 0
    const uy = m > 0.1 ? wy / m : 0
    const top = 10 / 3 + 10
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    // Streamers: 1.6 yd ribbons; calm → hanging down the upright, wind → standing out.
    for (const gx of [0, FIELD_LENGTH]) {
      for (const s of [-1, 1]) {
        const x0 = gx
        const y0 = MID_WIDTH + s * HASH_HALF
        const p0 = project(cam, x0, y0, top)
        if (!p0) continue
        ctx.strokeStyle = s < 0 ? 'rgba(232,90,40,0.95)' : 'rgba(250,196,40,0.95)'
        ctx.lineWidth = Math.max(1.2 * dpr, 0.1 * cam.focal / Math.max(1, p0.depth))
        ctx.beginPath()
        ctx.moveTo(p0.x, p0.y)
        const N = 6
        for (let i = 1; i <= N; i++) {
          const u = i / N
          const flutter = Math.sin(time * (6 + 6 * k) - u * 4 + gx + s) * 0.18 * u * (0.3 + k)
          const out = 1.6 * u * k
          const droop = 1.6 * u * (1 - k) + 0.25 * u * u * k
          const px = x0 + ux * out - uy * flutter
          const py = y0 + uy * out + ux * flutter
          const p = project(cam, px, py, top - droop)
          if (p) ctx.lineTo(p.x, p.y)
        }
        ctx.stroke()
      }
    }
    // The flag: a pole over the far sideline at midfield.
    const fx = FIELD_LENGTH / 2
    const fy = FIELD_WIDTH + 14
    const pb = project(cam, fx, fy, 0)
    const pt = project(cam, fx, fy, 16)
    if (pb && pt) {
      ctx.strokeStyle = 'rgba(205,208,214,0.95)'
      ctx.lineWidth = Math.max(1, 0.18 * cam.focal / Math.max(1, pt.depth))
      ctx.beginPath()
      ctx.moveTo(pb.x, pb.y)
      ctx.lineTo(pt.x, pt.y)
      ctx.stroke()
      const len = 4.2
      const hgt = 2.6
      const fl = (u: number, v: number) => {
        const flutter = Math.sin(time * (3 + 7 * k) - u * 5) * 0.35 * u * (0.25 + k)
        const out = len * u * (0.15 + 0.85 * k)
        const sag = len * u * (1 - k) * 0.85
        return project(cam, fx + ux * out - uy * flutter, fy + uy * out + ux * flutter, 16 - v * hgt - sag)
      }
      ctx.fillStyle = 'rgba(178,34,52,0.92)'
      ctx.beginPath()
      let first = true
      const N = 8
      for (let i = 0; i <= N; i++) {
        const p = fl(i / N, 0)
        if (!p) continue
        if (first) { ctx.moveTo(p.x, p.y); first = false } else ctx.lineTo(p.x, p.y)
      }
      for (let i = N; i >= 0; i--) {
        const p = fl(i / N, 1)
        if (p) ctx.lineTo(p.x, p.y)
      }
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  }
}

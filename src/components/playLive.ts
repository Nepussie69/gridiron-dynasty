// ─────────────────────────────────────────────────────────────────────────────
// Live field: continuous, time-stepped motion for the men around the ball
// (animflow). The play builders in playAnim.ts script the ball carrier, the
// passer and the routes from the recorded result; this steps everyone else at
// 20 Hz so they keep playing football the whole time instead of moving once
// and standing still:
//   • blockers fire out and get hands on their man; an engaged pair is drawn
//     touching (centres ~0.9 yd apart, facing) and keeps moving together — a
//     drive block pushes, a zone block steps laterally, a pass set gives
//     ground — with a little hand-fight jostle;
//   • a double team is two blockers on one man, side by side; one can climb to
//     a linebacker at a planned time;
//   • defenders shed when their (ratings-based) shed time comes and pursue the
//     carrier on an intercept angle, read-and-react men (backers, safeties,
//     corners) start their pursuit after a ratings-based read.
// Pursuers never reach the carrier before the builder's tackle phase: inside a
// shrinking keep-out radius they run alongside him rather than through him, so
// the recorded spot, tackler and result stay exactly as the sim recorded them.
// Presentation only; deterministic (no rng).
// ─────────────────────────────────────────────────────────────────────────────

import type { Player } from '../game/types'

export interface LPt {
  x: number
  y: number
}

interface LWP {
  t: number
  x: number
  y: number
}

/** The part of a playAnim Mover the live field reads and writes. */
export interface LiveMover {
  key: string
  t: number
  x: number
  y: number
  path: LWP[]
  pace: { top: number; acc: number }
  lastStop: boolean
  inHeading?: LPt
  player?: Player
}

/** What a free man wants this step: a point to run at and how fast (yd/s). */
export interface Want {
  x: number
  y: number
  speed: number
  /** Stay outside this ring around a scripted man (the carrier) this step. */
  ring?: { key: string; r: number }
  /** animflow r6c: acceleration multiplier (a rip off a block is a burst). */
  burst?: number
}

export type Brain = (t: number, me: Agent, field: LiveField) => Want | null

export interface Agent {
  key: string
  mv: LiveMover
  side: 'off' | 'def'
  x: number
  y: number
  vx: number
  vy: number
  /** Free behaviour (also used before contact). */
  brain: Brain
  /** The pair this man is in, if engaged. */
  pair: Pair | null
  /** Blockers: the man he is going to block (contact makes the pair). */
  target: string | null
  /** Blockers: a second-level man to climb to when he leaves a double. */
  climb?: string | null
  /** Seconds between a released block and his next behaviour (a turn). */
  recover: number
  /** Last time he left a pair (no immediate re-engage). */
  freedAt: number
  /** animflow r6c: nobody blocks him again (the credited tackler, once he has shed). */
  noBlock?: boolean
}

export interface PairPlan {
  /** Push of the pair centre (yd/s) at time t (smoothed by the field). */
  drive: (t: number) => LPt
  /** When the defender gets off the block (s). */
  shedAt: number
  /** When the second blocker of a double leaves to climb (s), if he does. */
  climbAt?: number
}

export interface Pair {
  def: string
  blk: string[]
  t0: number
  /** Unit axis from blocker to defender. */
  ax: number
  ay: number
  cx: number
  cy: number
  vx: number
  vy: number
  plan: PairPlan
  phase: number
  /** Positions at contact, blended into the pair over the first beat. */
  from: Record<string, LPt>
  /** Blocker start times inside this pair (a joining double partner). */
  joined: Record<string, number>
  /** When each man's blend into his slot (re)started (contact, a join, a climb). */
  blend: Record<string, number>
}

export interface LiveOpts {
  /** Engagement recorder: (blocker, defender, t0, t1, kind). */
  rec?: (a: string, b: string, t0: number, t1: number, kind: 'block' | 'double') => void
  /** Plan an engagement when a blocker reaches his man. */
  plan: (blk: string, def: string, t: number, field: LiveField) => PairPlan
  /** Called when a defender sheds (to set his next brain). animflow r6c: `pair` is the block he beat. */
  onShed?: (def: string, t: number, field: LiveField, pair: Pair) => void
  /** Called when a blocker is released (to set his next brain). animflow r6c: `beaten` when his man shed him (not a climb). */
  onRelease?: (blk: string, t: number, field: LiveField, pair: Pair, beaten: boolean) => void
}

export const LIVE_DT = 0.05
/** Centre-to-centre distance of an engaged pair (hands on, leaning in). */
export const PAIR_GAP = 0.88
/** Distance at which a blocker gets his hands on his man. */
const CONTACT_AT = 1.05
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const FH = 53.3

function hashN(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

/** Position along a keyframed path (seconds). */
export function livePos(path: LWP[], t: number): LPt {
  if (!path.length) return { x: 0, y: 0 }
  if (t <= path[0].t) return { x: path[0].x, y: path[0].y }
  for (let i = 1; i < path.length; i++) {
    const b = path[i]
    if (t <= b.t) {
      const a = path[i - 1]
      const span = b.t - a.t
      const u = span <= 0 ? 1 : (t - a.t) / span
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
    }
  }
  const l = path[path.length - 1]
  return { x: l.x, y: l.y }
}

/** Velocity (yd/s) along a keyframed path just before t. */
export function liveVel(path: LWP[], t: number): LPt {
  const h = 0.06
  const a = livePos(path, Math.max(0, t - h))
  const b = livePos(path, t)
  const dt = Math.max(1e-6, t - Math.max(0, t - h))
  return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt }
}

export class LiveField {
  agents = new Map<string, Agent>()
  pairs: Pair[] = []
  t: number
  /** Scripted men (the carrier, the passer): read-only positions by time. */
  scripted = new Map<string, LiveMover>()
  /** No new blocks are made after this time (the tackle phase has begun). */
  noContactAfter = Infinity
  /** Engaged pairs give the scripted carrier room (a yard and a bit) from `from` on. */
  avoid: { key: string; r: number; from: number } | null = null
  opts: LiveOpts
  private seed: number

  constructor(t0: number, opts: LiveOpts, seed = 0) {
    this.t = t0
    this.opts = opts
    this.seed = seed
  }

  add(mv: LiveMover, side: 'off' | 'def', brain: Brain, target: string | null = null): Agent {
    // Start from where his scripted timeline is at the field's start time.
    const p0 = livePos(mv.path, this.t)
    const p = { x: clampN(p0.x, 0.6, 119.4), y: clampN(p0.y, 0.8, FH - 0.8) }
    const v = mv.t >= this.t - 1e-9 && mv.path.length > 1 && !mv.lastStop ? liveVel(mv.path, this.t) : { x: 0, y: 0 }
    if (mv.t > this.t) {
      mv.path = mv.path.filter((w) => w.t < this.t)
      mv.path.push({ t: this.t, x: p.x, y: p.y })
    } else if (mv.t < this.t) {
      mv.path.push({ t: this.t, x: mv.x, y: mv.y })
    }
    if (p.x !== p0.x || p.y !== p0.y) mv.path[mv.path.length - 1] = { t: this.t, x: p.x, y: p.y }
    mv.t = this.t
    mv.x = p.x
    mv.y = p.y
    const a: Agent = { key: mv.key, mv, side, x: p.x, y: p.y, vx: v.x, vy: v.y, brain, pair: null, target, recover: 0, freedAt: -9 }
    this.agents.set(mv.key, a)
    return a
  }

  script(mv: LiveMover) {
    this.scripted.set(mv.key, mv)
  }

  /** Where any man (agent or scripted) is at time t (agents: now). */
  where(key: string, t = this.t): LPt | null {
    const a = this.agents.get(key)
    if (a) return { x: a.x, y: a.y }
    const s = this.scripted.get(key)
    return s ? livePos(s.path, t) : null
  }

  /** A scripted man's position at a future time (null for live agents). */
  future(key: string, t: number): LPt | null {
    const s = this.scripted.get(key)
    return s ? livePos(s.path, t) : null
  }

  velOf(key: string, t = this.t): LPt {
    const a = this.agents.get(key)
    if (a) return { x: a.vx, y: a.vy }
    const s = this.scripted.get(key)
    return s ? liveVel(s.path, t) : { x: 0, y: 0 }
  }

  engaged(key: string): boolean {
    return !!this.agents.get(key)?.pair
  }

  /** Step the field until `t1`, recording every agent's path. */
  run(t1: number) {
    while (this.t < t1 - 1e-9) {
      const dt = Math.min(LIVE_DT, t1 - this.t)
      this.step(dt)
    }
  }

  private step(dt: number) {
    const t = this.t + dt
    // 1. Free men move toward what they want (accel-limited, so no speed jump).
    for (const a of this.agents.values()) {
      if (a.pair) continue
      let want: Want | null = null
      if (a.recover > 0) {
        a.recover = Math.max(0, a.recover - dt)
      } else if (a.target) {
        want = this.approach(a, t)
      }
      if (!want) want = a.brain(t, a, this)
      // A man about to be blocked breaks down to take it on (no full-speed
      // collision); so does a blocker closing on his man.
      if (want && a.side === 'def') {
        const near = this.blockerNear(a)
        if (near < 2.6) want = { ...want, speed: Math.min(want.speed, 2.2 + near * 1.3) }
      }
      if (want && a.target && !a.pair) {
        const d = this.agents.get(a.target)
        if (d) want = { ...want, speed: Math.min(want.speed, 2.6 + Math.hypot(d.x - a.x, d.y - a.y) * 1.4) }
      }
      this.steer(a, want, dt)
      if (want?.ring && a.side === 'def') this.keepOut(a, want.ring.key, want.ring.r, t)
    }
    // 2. Contact: a blocker reaching his man makes (or joins) a pair.
    for (const a of this.agents.values()) {
      if (t > this.noContactAfter) break
      if (a.pair || !a.target || a.recover > 0) continue
      const d = this.agents.get(a.target)
      if (!d) {
        a.target = null
        continue
      }
      if (Math.hypot(d.x - a.x, d.y - a.y) > CONTACT_AT) continue
      if (d.noBlock) {
        a.target = null
        continue
      }
      if (d.pair) {
        if (d.pair.blk.length < 2 && t - d.freedAt > 0.3) this.join(d.pair, a, t)
        else a.target = null
        continue
      }
      if (t - d.freedAt < 0.5) continue
      this.engage(a, d, t)
    }
    // 3. Pairs move together (drive + hand-fight), then may break up.
    for (const p of [...this.pairs]) this.movePair(p, t, dt)
    // 4. Record.
    for (const a of this.agents.values()) {
      a.x = clampN(a.x, 0.6, 119.4)
      a.y = clampN(a.y, 0.8, FH - 0.8)
      a.mv.path.push({ t, x: a.x, y: a.y })
      a.mv.t = t
      a.mv.x = a.x
      a.mv.y = a.y
      a.mv.lastStop = false
      a.mv.inHeading = undefined
    }
    this.t = t
  }

  /** Hold a man outside a ring around a scripted carrier (no early contact). */
  private keepOut(a: Agent, key: string, r: number, t: number) {
    const c = this.where(key, t)
    if (!c) return
    const dx = a.x - c.x
    const dy = a.y - c.y
    const d = Math.hypot(dx, dy)
    if (d >= r) return
    const ux = d > 1e-6 ? dx / d : 1
    const uy = d > 1e-6 ? dy / d : 0
    // A gentle push (never a jump): a man already inside (just off a block)
    // eases out over a few steps.
    const push = Math.min(r - d, 0.05)
    a.x += ux * push
    a.y += uy * push
    // Drop the inward part of his velocity (he runs alongside, not through).
    const vin = a.vx * ux + a.vy * uy
    if (vin < 0) {
      a.vx -= vin * ux
      a.vy -= vin * uy
    }
  }

  /** Distance to the nearest blocker coming to block this man (Infinity if none). */
  private blockerNear(d: Agent): number {
    let best = Infinity
    for (const b of this.agents.values()) {
      if (b.target !== d.key || b.pair) continue
      best = Math.min(best, Math.hypot(b.x - d.x, b.y - d.y))
    }
    return best
  }

  /** A blocker going to get his man: aim a body's length in front of him. */
  private approach(a: Agent, t: number): Want | null {
    const d = this.agents.get(a.target!)
    if (!d) return null
    const dx = d.x - a.x
    const dy = d.y - a.y
    const L = Math.hypot(dx, dy) || 1
    // Lead a moving man a little so the blocker meets him rather than trails.
    const lead = clampN(L / Math.max(2, a.mv.pace.top), 0, 0.5)
    void t
    return { x: d.x + d.vx * lead - (dx / L) * 0.6, y: d.y + d.vy * lead - (dy / L) * 0.6, speed: a.mv.pace.top }
  }

  /** Accel-limited steering toward a wanted point (stops softly on arrival). */
  steer(a: Agent, want: Want | null, dt: number) {
    const acc = Math.max(2, a.mv.pace.acc) * (want?.burst ?? 1)
    let dvx = -a.vx
    let dvy = -a.vy
    if (want) {
      const dx = want.x - a.x
      const dy = want.y - a.y
      const L = Math.hypot(dx, dy)
      const sp = Math.min(want.speed, a.mv.pace.top, Math.sqrt(2 * acc * 0.8 * Math.max(0, L - 0.05)))
      const ux = L > 1e-6 ? dx / L : 0
      const uy = L > 1e-6 ? dy / L : 0
      dvx = ux * sp - a.vx
      dvy = uy * sp - a.vy
    }
    const dl = Math.hypot(dvx, dvy)
    const lim = acc * dt
    if (dl > lim) {
      dvx *= lim / dl
      dvy *= lim / dl
    }
    a.vx += dvx
    a.vy += dvy
    a.x += a.vx * dt
    a.y += a.vy * dt
  }

  private engage(b: Agent, d: Agent, t: number) {
    const dx = d.x - b.x
    const dy = d.y - b.y
    const L = Math.hypot(dx, dy) || 1
    const plan = this.opts.plan(b.key, d.key, t, this)
    const p: Pair = {
      def: d.key,
      blk: [b.key],
      t0: t,
      ax: dx / L,
      ay: dy / L,
      cx: (b.x + d.x) / 2,
      cy: (b.y + d.y) / 2,
      vx: (b.vx + d.vx) / 2,
      vy: (b.vy + d.vy) / 2,
      plan,
      phase: hashN(this.seed + this.pairs.length * 5.3 + b.key.length) * Math.PI * 2,
      from: { [b.key]: { x: b.x, y: b.y }, [d.key]: { x: d.x, y: d.y } },
      joined: { [b.key]: t },
      blend: { [b.key]: t, [d.key]: t },
    }
    b.pair = p
    d.pair = p
    b.target = null
    this.pairs.push(p)
  }

  private join(p: Pair, b: Agent, t: number) {
    // Shoulder to shoulder: the pair's order across the man is fixed once,
    // and everyone blends into the new shape (no snap when the second arrives).
    const px = -p.ay
    const py = p.ax
    const first = this.agents.get(p.blk[0])
    const side = first ? (b.x - first.x) * px + (b.y - first.y) * py : 1
    p.blk = side >= 0 ? [p.blk[0], b.key] : [b.key, p.blk[0]]
    for (const k of [p.def, ...p.blk]) {
      const a = this.agents.get(k)
      if (!a) continue
      p.from[k] = { x: a.x, y: a.y }
      p.blend[k] = t
    }
    p.joined[b.key] = t
    b.pair = p
    b.target = null
  }

  /** The spot each member of a pair should be at (centre, axis, jostle). */
  private slots(p: Pair, t: number): Record<string, LPt> {
    const age = t - p.t0
    const w = Math.sin(p.phase + age * 7.0) * 0.12 + Math.sin(p.phase * 1.7 + age * 2.3) * 0.1
    const g = PAIR_GAP + Math.sin(p.phase * 0.7 + age * 9.0) * 0.05
    // Perpendicular to the axis (hand-fight sways the pair sideways).
    const px = -p.ay
    const py = p.ax
    const cx = p.cx + px * w
    const cy = p.cy + py * w
    const out: Record<string, LPt> = {}
    out[p.def] = { x: cx + p.ax * g * 0.5, y: cy + p.ay * g * 0.5 }
    if (p.blk.length === 1) {
      out[p.blk[0]] = { x: cx - p.ax * g * 0.5, y: cy - p.ay * g * 0.5 }
    } else {
      // A double: shoulder to shoulder, each on a half of the man.
      const back = Math.sqrt(Math.max(0.1, g * g - 0.5 * 0.5))
      p.blk.forEach((k, i) => {
        const s = i === 0 ? -0.5 : 0.5
        out[k] = { x: cx + p.ax * (g * 0.5 - back) + px * s, y: cy + p.ay * (g * 0.5 - back) + py * s }
      })
    }
    return out
  }

  private movePair(p: Pair, t: number, dt: number) {
    // Smoothed drive of the pair centre.
    const dv = p.plan.drive(t)
    const k = Math.min(1, dt * 3.5)
    p.vx += (dv.x - p.vx) * k
    p.vy += (dv.y - p.vy) * k
    p.cx += p.vx * dt
    p.cy += p.vy * dt
    // The carrier squeezes by: a pair in his way is shoved aside, never touched.
    if (this.avoid && t >= this.avoid.from) {
      const c = this.where(this.avoid.key, t)
      const s0 = this.slots(p, t)[p.def]
      if (c && s0) {
        const dx = s0.x - c.x
        const dy = s0.y - c.y
        const d = Math.hypot(dx, dy)
        if (d < this.avoid.r) {
          const push = Math.min(this.avoid.r - d, 0.1)
          const ux = d > 1e-6 ? dx / d : -p.ay
          const uy = d > 1e-6 ? dy / d : p.ax
          p.cx += ux * push
          p.cy += uy * push
        }
      }
    }
    const slots = this.slots(p, t)
    for (const key of [p.def, ...p.blk]) {
      const a = this.agents.get(key)
      if (!a) continue
      const s = slots[key]
      const since = t - (p.blend[key] ?? p.t0)
      const u = clampN(since / 0.22, 0, 1)
      const e = u * u * (3 - 2 * u)
      // Blend from where he made contact into his slot (no snap); the blend's
      // base travels with the pair.
      const f0 = p.from[key] ?? { x: a.x, y: a.y }
      const f = { x: f0.x + p.vx * dt, y: f0.y + p.vy * dt }
      p.from[key] = f
      const nx = e < 1 ? f.x + (s.x - f.x) * e : s.x
      const ny = e < 1 ? f.y + (s.y - f.y) * e : s.y
      a.vx = (nx - a.x) / dt
      a.vy = (ny - a.y) / dt
      a.x = nx
      a.y = ny
    }
    // A double partner climbs.
    if (p.blk.length > 1 && p.plan.climbAt != null && t >= p.plan.climbAt) {
      const leave = p.blk.find((k2) => this.agents.get(k2)?.climb) ?? p.blk[p.blk.length - 1]
      const a = this.agents.get(leave)
      p.blk = p.blk.filter((k2) => k2 !== leave)
      p.plan.climbAt = undefined
      if (a) this.release(a, p, t, 'double', false)
      // The remaining blocker squares up on the man alone (blend into the slot).
      for (const k2 of [p.def, ...p.blk]) {
        const b = this.agents.get(k2)
        if (b) {
          p.from[k2] = { x: b.x, y: b.y }
          p.blend[k2] = t
        }
      }
      if (a?.climb) {
        a.target = a.climb
        a.climb = null
        a.recover = 0
      }
    }
    // The man gets off the block.
    if (t >= p.plan.shedAt) {
      this.pairs = this.pairs.filter((q) => q !== p)
      const d = this.agents.get(p.def)
      for (const k2 of p.blk) {
        const b = this.agents.get(k2)
        if (b) this.release(b, p, t, p.blk.length > 1 ? 'double' : 'block', true)
      }
      if (d) {
        d.pair = null
        d.freedAt = t
        this.opts.onShed?.(d.key, t, this, p)
      }
    }
  }

  private release(b: Agent, p: Pair, t: number, kind: 'block' | 'double', beaten: boolean) {
    this.opts.rec?.(b.key, p.def, p.joined[b.key] ?? p.t0, t, kind)
    b.pair = null
    b.freedAt = t
    b.recover = 0.15
    this.opts.onRelease?.(b.key, t, this, p, beaten)
  }

  /** Close every pair still engaged at the end (records them up to `t`). */
  closeAll(t: number) {
    for (const p of this.pairs) {
      for (const k of p.blk) this.opts.rec?.(k, p.def, p.joined[k] ?? p.t0, t, p.blk.length > 1 ? 'double' : 'block')
    }
  }
}

// ── stock behaviours ─────────────────────────────────────────────────────────

/**
 * Pursue a (scripted) carrier on an intercept angle. Inside `keep(t)` yards he
 * runs alongside instead of through him (the builder's tackle phase brings the
 * recorded tackler in), so nobody reaches the carrier early.
 */
export function pursue(carrier: string, opts: { keep: (t: number) => number; lead?: number; speed?: number; side?: number; intercept?: boolean }): Brain {
  return (t, me, f) => {
    const c = f.where(carrier, t)
    if (!c) return null
    const cv = f.velOf(carrier, t)
    const cs = Math.hypot(cv.x, cv.y)
    const dx = c.x - me.x
    const dy = c.y - me.y
    const d = Math.hypot(dx, dy)
    const top = me.mv.pace.top * (opts.speed ?? 1)
    const R = opts.keep(t)
    // His side of the carrier's line (perpendicular to the carrier's run).
    const hx = cs > 0.5 ? cv.x / cs : 1
    const hy = cs > 0.5 ? cv.y / cs : 0
    let nx = -hy
    let ny = hx
    if ((me.x - c.x) * nx + (me.y - c.y) * ny < 0) {
      nx = -nx
      ny = -ny
    }
    const ring = { key: carrier, r: R }
    // Start running alongside early enough to brake for the ring when the two
    // are closing fast (a head-on angle).
    const closing = Math.hypot(me.vx, me.vy) + cs
    if (d < R + 0.9 + closing * 0.12) {
      // Alongside: on his side of the carrier, a ring's width off, matching him.
      const ux = d > 1e-6 ? -dx / d : nx
      const uy = d > 1e-6 ? -dy / d : ny
      const wx = ux * 0.4 + nx * 0.6
      const wy = uy * 0.4 + ny * 0.6
      const wl = Math.hypot(wx, wy) || 1
      return { x: c.x + (wx / wl) * R + cv.x * 0.25, y: c.y + (wy / wl) * R + cv.y * 0.25, speed: Math.min(top, cs + 1.5), ring }
    }
    // Intercept: where the carrier will be after the time it takes to get
    // there, aimed at the near side of his line (a pursuit angle).
    if (opts.intercept && f.future(carrier, t)) {
      // animflow r6c2 (297): the true pursuit angle on the carrier's scripted
      // line — the earliest spot he can reach as the carrier gets there; a
      // good pursuer (lead ~1) takes all of it, a poor one undercuts less.
      let ts = 3
      for (let tau = 0.1; tau <= 3 + 1e-6; tau += 0.1) {
        const q = f.future(carrier, t + tau)!
        if (Math.hypot(q.x - me.x, q.y - me.y) - R <= top * tau) { ts = tau; break }
      }
      const q = f.future(carrier, t + ts * Math.min(1, opts.lead ?? 0.85))!
      return { x: q.x + nx * R * 0.8, y: q.y + ny * R * 0.8 + (opts.side ?? 0) * 0.5, speed: top, ring }
    }
    const tau = clampN(d / Math.max(2, top), 0, 1.4) * (opts.lead ?? 0.85)
    const tx = c.x + cv.x * tau + nx * R * 0.8
    const ty = c.y + cv.y * tau + ny * R * 0.8 + (opts.side ?? 0)
    return { x: tx, y: ty, speed: top, ring }
  }
}

/** Move to a spot at a pace, then mill about it (small feet, never frozen). */
export function holdSpot(spot: LPt, speed: number, seed = 0): Brain {
  return (t, me) => {
    const d = Math.hypot(spot.x - me.x, spot.y - me.y)
    if (d > 0.6) return { x: spot.x, y: spot.y, speed }
    const w = hashN(seed) * 6.28
    return { x: spot.x + Math.cos(w + t * 1.6) * 0.5, y: spot.y + Math.sin(w + t * 1.6) * 0.5, speed: 0.9 }
  }
}

/** Chain brains by time: the first whose start has passed (latest wins). */
export function phases(list: { from: number; brain: Brain }[]): Brain {
  const sorted = [...list].sort((a, b) => a.from - b.from)
  return (t, me, f) => {
    let b = sorted[0].brain
    for (const p of sorted) if (t >= p.from) b = p.brain
    return b(t, me, f)
  }
}

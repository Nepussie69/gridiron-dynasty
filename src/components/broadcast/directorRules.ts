// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B5b) — the special camera rules + the single director entry
// point B6/B7/B8 call.
//
// B5a's director.ts owns the public API, the base framing and every easing /
// per-frame limit; this file only ADDS DirectorRule objects. A rule shapes the
// target Shot (cx / cy / span) and may declare `mustSee` points that the
// containment pass has to hold — B5a then eases the result through its spring
// and clamps every step, so no rule here can produce a camera jump.
//
// HONEST LIMITS OF THE B5a HOOK (reported in b5-verify.out):
//   • A DirectorRule's `applies` runs before containment and only sees `ctx`;
//     `shape` sees the base Shot. There is no per-rule state, so "occluded for
//     >= 0.15 s" is derived from the animation itself (sampling the past), which
//     keeps the two-reset determinism B5a guarantees.
//   • B5a's emitted frame hard-codes `z: rig.height, yaw: 0` (director.ts reset,
//     the `cand`/`out[k]` lines), so a rule CANNOT raise the camera or re-angle
//     it — only pan (cx, cy) and zoom (span). The proofs / consequences are in
//     the verify file (rule 3's punt apex is above the live rig's horizon).
//
// No DOM, no React, no window, no colours, no new deps: importable from node.
// ─────────────────────────────────────────────────────────────────────────────
import {
  createDirector,
  type Director,
  type DirectorOptions,
  type DirectorRule,
  type Shot,
  type ShotContext,
} from './director'
import { clamp, clamp01, lerp, type Pt2 } from './directorMath.ts'
import { FIELD_H, MID_Y, posAt } from '../playAnim'
import { carrierOcclusion } from './directorOcclusion.ts'

const HEAD_Z = 2.0
const MAX_SPAN = 55
const MIN_SPAN = 20

// ── small reads of the animation (shared by the rules) ───────────────────────
const playSeconds = (ctx: ShotContext): number => Math.max(0.05, (ctx.anim.duration || 0) / 1000)

/** The kicker / punter / holder key for the special teams kinds. */
function kickKey(ctx: ShotContext): string | null {
  const want = ctx.kind === 'punt' ? 'P' : ctx.kind === 'fg' || ctx.kind === 'pat' ? 'K' : null
  if (want) {
    for (const a of ctx.anim.actors) if (a.role === want) return a.key
  }
  if (ctx.kind === 'kickoff') {
    for (const e of ctx.anim.events ?? []) if (e.kind === 'kick') return e.keys[0] ?? null
  }
  return null
}

function actorAt(ctx: ShotContext, key: string | null): { x: number; y: number } | null {
  if (!key) return null
  return ctx.actors.get(key) ?? null
}

/** Ground velocity (yd/s) of an actor at `t`, from B1's path. */
function velAt(ctx: ShotContext, key: string, t: number): Pt2 {
  const a = ctx.anim.actors.find((x) => x.key === key)
  if (!a || !a.path?.length) return { x: 0, y: 0 }
  const dt = 0.06
  const t1 = Math.min(1, t + dt)
  const t0 = Math.max(0, t1 - dt)
  const p1 = posAt(a.path, t1)
  const p0 = posAt(a.path, t0)
  const s = 1 / Math.max(1e-4, (t1 - t0) * playSeconds(ctx))
  return { x: (p1.x - p0.x) * s, y: (p1.y - p0.y) * s }
}

/** Ground velocity (yd/s) of the ball at `t`, from B1's ball path. */
function ballVelAt(ctx: ShotContext, t: number): Pt2 {
  const dt = 0.06
  const t1 = Math.min(1, t + dt)
  const t0 = Math.max(0, t1 - dt)
  const p1 = posAt(ctx.anim.ball, t1)
  const p0 = posAt(ctx.anim.ball, t0)
  const s = 1 / Math.max(1e-4, (t1 - t0) * playSeconds(ctx))
  return { x: (p1.x - p0.x) * s, y: (p1.y - p0.y) * s }
}

/**
 * The aim (pitch, radians) that puts world point `pt` at `frac` down the frame
 * for the given ground framing. Larger pitch (aiming up) moves a point DOWN the
 * screen, so we binary-search for the smallest pitch that brings it to the
 * target height. Profile-agnostic (uses only the director's own projection).
 */
function aimToPoint(ctx: ShotContext, pt: { x: number; y: number; z: number }, cx: number, cy: number, span: number, frac: number): number {
  const target = frac * ctx.viewport.height
  const at = (pitch: number) => ctx.project(pt, { cx, cy, span, pitch })
  const lo = -0.62
  const hi = 0.55
  const a = at(lo)
  if (!Number.isFinite(a.sy)) return -0.35
  if (a.sy >= target) return lo
  const b = at(hi)
  if (!Number.isFinite(b.sy) || b.sy < target) return hi
  let l = lo
  let r = hi
  for (let i = 0; i < 10; i++) {
    const m = (l + r) / 2
    const s = at(m)
    if (Number.isFinite(s.sy) && s.sy >= target) r = m
    else l = m
  }
  return r
}

/** Aim so the ball sits in the top third of the frame. */
function aimForBall(ctx: ShotContext, cx: number, cy: number, span: number): number {
  return aimToPoint(ctx, { x: ctx.ball.x, y: ctx.ball.y, z: ctx.ball.z }, cx, cy, span, 0.34)
}

function nearestDefTo(ctx: ShotContext, x: number, y: number): { x: number; y: number; z: number } | null {
  let best = Infinity
  let out: { x: number; y: number; z: number } | null = null
  for (const a of ctx.anim.actors) {
    if (a.side !== 'def') continue
    const p = ctx.actors.get(a.key)
    if (!p) continue
    const d = (p.x - x) ** 2 + (p.y - y) ** 2
    if (d < best) {
      best = d
      out = { x: p.x, y: p.y, z: 0 }
    }
  }
  return out
}

const carrierPts = (c: { x: number; y: number }): { x: number; y: number; z: number }[] => [
  { x: c.x, y: c.y, z: 0 },
  { x: c.x, y: c.y, z: HEAD_Z },
]

// ── rule 1: deepShot — a long pass flight ────────────────────────────────────
const deepShot: DirectorRule = {
  id: 'deepShot',
  applies(ctx) {
    if (ctx.kind !== 'pass') return false
    const fl = ctx.anim.flights?.[0]
    if (!fl) return false
    const p0 = posAt(ctx.anim.ball, fl.t0)
    const p1 = posAt(ctx.anim.ball, fl.t1)
    const air = Math.hypot(p1.x - p0.x, p1.y - p0.y)
    if ((ctx.play.passDepth ?? 0) < 20 && air < 20) return false
    return ctx.t >= fl.t0 - 1e-6
  },
  shape(ctx, desired) {
    const fl = ctx.anim.flights![0]
    if (ctx.t > fl.t1 + 0.02) {
      // After the catch / incompletion: tighten back onto the carrier.
      if (ctx.carrier) return { cx: ctx.carrier.x, cy: ctx.carrier.y, span: Math.min(desired.span, 32) }
      return { ...desired, span: Math.min(desired.span, 34) }
    }
    // In flight: lead along the ball's path toward the catch spot.
    // Track to the posts by the moment the ball reaches them (the kickGood /
    // kickMiss beat), then hold the posts while it carries on past (animflow r4).
    const at = ctx.events.find((e) => e.kind === 'kickGood' || e.kind === 'kickMiss')
    const tEnd = at && at.t > fl.t0 ? at.t : fl.t1
    const u = clamp01((ctx.t - fl.t0) / Math.max(1e-6, tEnd - fl.t0))
    const ahead = Math.min(1, u + 0.18)
    const lead = posAt(ctx.anim.ball, fl.t0 + (fl.t1 - fl.t0) * ahead)
    return { cx: clamp(lead.x, 3, 117), cy: clamp(lead.y, 3, FIELD_H - 3), span: 52 }
  },
  mustSee(ctx) {
    const fl = ctx.anim.flights?.[0]
    const pts: { x: number; y: number; z: number }[] = [{ x: ctx.ball.x, y: ctx.ball.y, z: ctx.ball.z }]
    if (!fl) return pts
    if (ctx.t <= fl.t1 + 0.02) {
      const catchSpot = posAt(ctx.anim.ball, fl.t1)
      // Only pin the far end of the route once the ball is closing on it: pinning
      // a point 40+ yd from the ball would make the watch set unfittable and B5a's
      // hard containment would drag the focus away.
      if (Math.hypot(ctx.ball.x - catchSpot.x, ctx.ball.y - catchSpot.y) < 32) {
        if (ctx.target) pts.push(...carrierPts(ctx.target))
        const d = nearestDefTo(ctx, ctx.ball.x, ctx.ball.y)
        if (d) pts.push(d)
        pts.push({ x: catchSpot.x, y: catchSpot.y, z: 0 })
      }
    } else if (ctx.carrier) {
      pts.push(...carrierPts(ctx.carrier))
    }
    return pts
  },
}

// ── rule 2: sideline — keep the near/far sideline readable ───────────────────
const sideline: DirectorRule = {
  id: 'sideline',
  applies(ctx) {
    const a = ctx.carrier ?? ctx.target
    if (!a) return false
    return a.y <= 6 || a.y >= FIELD_H - 6
  },
  shape(ctx, desired) {
    const a = (ctx.carrier ?? ctx.target)!
    const near = a.y <= 6
    const oob = near ? -3 : FIELD_H + 3
    const cy = clamp((a.y + oob) / 2, 3, FIELD_H - 3)
    return { cx: clamp(desired.cx, 3, 117), cy, span: clamp(Math.max(desired.span, Math.abs(a.y - oob) + 24), MIN_SPAN, MAX_SPAN) }
  },
  mustSee(ctx) {
    const a = (ctx.carrier ?? ctx.target)!
    const near = a.y <= 6
    const edge = near ? 0 : FIELD_H
    const oob = near ? -3 : FIELD_H + 3
    const pts = carrierPts(a)
    pts.push({ x: a.x, y: edge, z: 0 }, { x: a.x, y: oob, z: 0 })
    if (ctx.carrier) pts.push({ x: ctx.ball.x, y: ctx.ball.y, z: ctx.ball.z })
    return pts
  },
}

// ── rule 3: kicks — kickoff / punt snap, hang, catch, return ─────────────────
const kicks: DirectorRule = {
  id: 'kicks',
  applies(ctx) {
    return ctx.kind === 'kickoff' || ctx.kind === 'punt'
  },
  preSnap(ctx, _shot) {
    // The 22-man formation fit cannot hold both kick units (≈50 yd apart) inside
    // the span cap, so it collapses to a clamp corner and the post-snap camera
    // starts ahead of the ball. Centre on the KICK SPOT instead: the punter /
    // kicker and the ball are the pre-snap subject, and the camera then pans
    // downfield with the ball. (Centring between kick and landing put the punter
    // BEHIND the live rig, since the camera sits 27 yd back of the focus.)
    const fl = ctx.anim.flights?.[0]
    if (!fl) return
    const kick = posAt(ctx.anim.ball, fl.t0)
    return {
      // animflow r6a: wide enough for the whole kick unit across the field.
      cx: clamp(kick.x + (ctx.kind === 'kickoff' ? 1 : 6), 3, 117),
      cy: clamp(ctx.kind === 'kickoff' ? FIELD_H / 2 : kick.y, 3, FIELD_H - 3),
      span: ctx.kind === 'kickoff' ? 58 : 54,
    }
  },
  shape(ctx, desired) {
    const fl = ctx.anim.flights?.[0]
    if (!fl) return desired
    const kick = posAt(ctx.anim.ball, fl.t0)
    const land = posAt(ctx.anim.ball, fl.t1)
    if (ctx.t < fl.t0) {
      // Before the kick: hold the kicker / punter (the holder on a punt).
      const a = actorAt(ctx, kickKey(ctx))
      const px = a ? a.x : kick.x
      const py = a ? a.y : kick.y
      return { cx: clamp(px, 3, 117), cy: clamp(py, 3, FIELD_H - 3), span: 50, yaw: 0 }
    }
    if (ctx.t < fl.t1) {
      // Hang: follow the ball's ground spot and AIM UP so the arc stays in the
      // top third of the frame. This is the fix for the punt/kickoff apex — the
      // ball is above the camera horizon for a chunk of the flight, so panning
      // alone can never frame it (B5a had no pitch).
      const bv = ballVelAt(ctx, ctx.t)
      const cx = clamp(ctx.ball.x + bv.x * 0.18, 3, 117)
      const cy = clamp(ctx.ball.y + bv.y * 0.18, 3, FIELD_H - 3)
      const span = 52
      return { cx, cy, span, pitch: aimForBall(ctx, cx, cy, span), yaw: 0 }
    }
    // Settled on the returner / dead-ball spot; lead the return.
    if (ctx.carrier) {
      const v = velAt(ctx, ctx.carrier.key, ctx.t)
      return {
        cx: clamp(ctx.carrier.x + v.x * 0.35, 3, 117),
        cy: clamp(ctx.carrier.y + v.y * 0.35, 3, FIELD_H - 3),
        span: 34,
        yaw: 0,
      }
    }
    return { cx: clamp(land.x, 3, 117), cy: clamp(land.y, 3, FIELD_H - 3), span: 34, yaw: 0 }
  },
  mustSee(ctx) {
    const fl = ctx.anim.flights?.[0]
    // During the hang the base framing already watches the ball (with its true
    // height) and the rule aims at it, so pin only the kicker (pre-kick) and the
    // carrier (after the catch). Pinning ground points while the camera looks up
    // would drag the focus.
    const pts: { x: number; y: number; z: number }[] = []
    if (!fl) return pts
    const land = posAt(ctx.anim.ball, fl.t1)
    if (ctx.t < fl.t0) {
      const a = actorAt(ctx, kickKey(ctx))
      if (a) pts.push(...carrierPts(a))
    } else if (ctx.t >= fl.t1) {
      if (ctx.carrier) pts.push(...carrierPts(ctx.carrier))
      else pts.push({ x: land.x, y: land.y, z: 0 })
    }
    return pts
  },
}

// ── rule 4: longReturn — open up once the returner has space ─────────────────
function returnGain(ctx: ShotContext): number {
  const key = ctx.carrier?.key
  if (!key) return 0
  const h = ctx.anim.holders ?? []
  let startX = ctx.carrier!.x
  let startY = ctx.carrier!.y
  for (const e of h) {
    if (e.key === key) {
      const p = posAt(ctx.anim.actors.find((a) => a.key === key)?.path ?? [], e.t)
      startX = p.x
      startY = p.y
      break
    }
  }
  return Math.hypot(ctx.carrier!.x - startX, ctx.carrier!.y - startY)
}

const longReturn: DirectorRule = {
  id: 'longReturn',
  applies(ctx) {
    if (!ctx.carrier) return false
    if (ctx.kind === 'kickoff' || ctx.kind === 'punt') {
      return (ctx.play.returnYards ?? 0) >= 20 || returnGain(ctx) >= 20
    }
    const result = ctx.play.result ?? ''
    if (ctx.play.type === 'pass' && /^interception/i.test(result)) return true
    if (ctx.play.turnover) return true
    return false
  },
  shape(ctx) {
    const c = ctx.carrier!
    const v = velAt(ctx, c.key, ctx.t)
    return { cx: clamp(c.x + v.x * 0.4, 3, 117), cy: clamp(c.y + v.y * 0.4, 3, FIELD_H - 3), span: 46 }
  },
  mustSee(ctx) {
    const c = ctx.carrier!
    return [...carrierPts(c), { x: ctx.ball.x, y: ctx.ball.y, z: ctx.ball.z }]
  },
}

// ── rule 5: fieldGoal — frame the kick and the uprights ──────────────────────
// The uprights stand on the end line (x = 120), not the goal line (animflow r4).
const POST_X = 120
const POST_Y = MID_Y
const UPRIGHT_HALF = 3.08 // 18'6" between the uprights
const UPRIGHT_TOP = 13.3 // crossbar (10') + 30' uprights
const CROSSBAR_Z = 3.33

const fieldGoal: DirectorRule = {
  id: 'fieldGoal',
  applies(ctx) {
    if (ctx.kind !== 'fg' && ctx.kind !== 'pat') return false
    if (ctx.play.blockedKick) return false
    return !/blocked/i.test(ctx.play.result ?? '')
  },
  shape(ctx, desired) {
    const fl = ctx.anim.flights?.[0]
    if (!fl) return desired
    const kick = posAt(ctx.anim.ball, fl.t0)
    if (ctx.t < fl.t0) {
      const a = actorAt(ctx, kickKey(ctx))
      const px = a ? a.x : kick.x
      return { cx: clamp(px, 3, 117), cy: MID_Y, span: 40 }
    }
    const u = clamp01((ctx.t - fl.t0) / Math.max(1e-6, fl.t1 - fl.t0))
    const eu = u * u * (3 - 2 * u)
    const cx = clamp(lerp(kick.x, POST_X + 2, eu), 3, 117)
    // The upright tops sit at camera height, i.e. on the live rig's horizon, so
    // the camera must AIM UP for them: the span alone cannot hold a point 13 yd
    // up while the rig looks down at the turf (B5a had no pitch, so containment
    // dragged the focus at the posts and lost the holder).
    return { cx, cy: MID_Y, span: MAX_SPAN, pitch: aimToPoint(ctx, { x: POST_X, y: POST_Y, z: UPRIGHT_TOP }, cx, MID_Y, MAX_SPAN, 0.16) }
  },
  mustSee(ctx) {
    const fl = ctx.anim.flights?.[0]
    const pts: { x: number; y: number; z: number }[] = [{ x: ctx.ball.x, y: ctx.ball.y, z: ctx.ball.z }]
    pts.push(
      { x: POST_X, y: POST_Y - UPRIGHT_HALF, z: 0 },
      { x: POST_X, y: POST_Y + UPRIGHT_HALF, z: 0 },
      { x: POST_X, y: POST_Y, z: CROSSBAR_Z },
    )
    // The upright tops only DURING the flight: before the kick the camera is on
    // the holder and a point 13 yd up at the far post is unfittable.
    if (fl && ctx.t >= fl.t0) {
      pts.push({ x: POST_X, y: POST_Y - UPRIGHT_HALF, z: UPRIGHT_TOP }, { x: POST_X, y: POST_Y + UPRIGHT_HALF, z: UPRIGHT_TOP })
    }
    return pts
  },
}

// ── rule 6: goalLine — the goal line, pylons and end zone ────────────────────
const GOAL_LINE = 110
const OWN_GOAL_LINE = 10

const goalLine: DirectorRule = {
  id: 'goalLine',
  applies(ctx) {
    // Special teams have their own rules (kicks / fieldGoal); a kickoff's LOS is
    // the receiving 10, which must not drag the goal-line framing onto a punt.
    if (ctx.kind === 'kickoff' || ctx.kind === 'punt' || ctx.kind === 'fg' || ctx.kind === 'pat') return false
    if (ctx.los >= 100 || ctx.los <= 20) return true
    const c = ctx.carrier
    if (!c) return false
    return c.x >= GOAL_LINE - 8 || c.x <= OWN_GOAL_LINE + 8
  },
  shape(ctx, desired) {
    const scoring = ctx.los >= 55
    const gl = scoring ? GOAL_LINE : OWN_GOAL_LINE
    const scored = ctx.events.some((e) => e.kind === 'score')
    // The goal line sits ~1/3 in from the end-zone edge: frame ~30 yd, the back
    // line at one side, so the goal line lands a third of the way across.
    const cx = clamp(scored ? gl + (scoring ? 8 : -8) : gl + (scoring ? -5 : 5), 3, 117)
    // Centre the lane on the carrier so he stays inside the end-zone shot, and
    // keep the base's span (only capping wide framings): narrowing it here made a
    // fast cut into the end zone drop the carrier off the edge for a few frames.
    const cy = clamp(ctx.carrier ? ctx.carrier.y : desired.cy, 8, FIELD_H - 8)
    return { cx, cy, span: clamp(desired.span, 24, 40) }
  },
  mustSee(ctx) {
    const scoring = ctx.los >= 55
    const gl = scoring ? GOAL_LINE : OWN_GOAL_LINE
    const y = ctx.carrier ? ctx.carrier.y : MID_Y
    // Pin the goal line and the end zone AT THE CARRIER's lane, plus the nearest
    // pylon — pinning both corners 53 yd apart cannot fit the safe frame and
    // would send B5a's hard containment chasing an impossible shift.
    const pts: { x: number; y: number; z: number }[] = [
      { x: gl, y, z: 0 },
      { x: gl + (scoring ? 7 : -7), y, z: 0 },
    ]
    const nearEdge = y < MID_Y ? 0 : FIELD_H
    if (Math.abs(y - nearEdge) <= 14) pts.push({ x: gl, y: nearEdge, z: 0 })
    if (ctx.carrier) pts.push(...carrierPts(ctx.carrier))
    pts.push({ x: ctx.ball.x, y: ctx.ball.y, z: 0 })
    return pts
  },
}

// ── rule 7: keepCarrier — re-angle out of the pile ──────────────────────────
const keepCarrier: DirectorRule = {
  id: 'keepCarrier',
  applies(ctx) {
    if (!ctx.carrier) return false
    // Cheap gate: a figure can only cover a large share of the carrier's box if
    // someone is practically on top of him, so skip the projection cost
    // otherwise. (3 yd, not 2.2: a defender straight downfield overlaps by
    // stacking vertically even a couple of yards away.)
    const c = ctx.carrier
    for (const [key, p] of ctx.actors) {
      if (key === c.key) continue
      if (Math.abs(p.x - c.x) <= 6 && Math.abs(p.y - c.y) <= 6) return true
    }
    return false
  },
  shape(ctx, desired) {
    const shot: Shot = { cx: desired.cx, cy: desired.cy, span: desired.span, z: desired.z, pitch: desired.pitch, yaw: desired.yaw }
    // Measure exactly as the probe does (same function, same default distance).
    const occ0 = carrierOcclusion(ctx, shot)
    if (occ0 < 0.42) return desired
    const c = ctx.carrier!
    let px = 0
    let py = 0
    let n = 0
    for (const a of ctx.anim.actors) {
      if (a.key === c.key) continue
      const p = ctx.actors.get(a.key)
      if (!p) continue
      if (Math.hypot(p.x - c.x, p.y - c.y) > 7) continue
      px += p.x
      py += p.y
      n++
    }
    // B5b re-angle: RAISE the camera and yaw slightly AWAY from the side the pile
    // sits on, so the pile separates from the carrier instead of stacking over
    // him. Height is the effective lever (a steeper look separates figures at the
    // same ground spot); yaw alone barely moves the share. Both are eased and
    // rate-limited by the director, and the carrier's feet and head are pinned by
    // mustSee, so he can never leave frame.
    const baseZ = desired.z ?? 14
    const sign = n && py / n >= c.y ? -1 : 1
    let bestZ = baseZ + 18
    let bestYaw = sign * 0.1396
    let bestOcc = carrierOcclusion(ctx, { ...shot, z: bestZ, yaw: bestYaw })
    if (bestOcc >= 0.6) {
      const alt = carrierOcclusion(ctx, { ...shot, z: baseZ + 18, yaw: 0 })
      if (alt < bestOcc) {
        bestOcc = alt
        bestYaw = 0
      }
    }
    let cx = desired.cx
    let cy = desired.cy
    if (n) {
      const dx = c.x - px / n
      const dy = c.y - py / n
      const m = Math.hypot(dx, dy) || 1
      cx = clamp(cx + (dx / m) * 3, 3, 117)
      cy = clamp(cy + (dy / m) * 3, 3, FIELD_H - 3)
    }
    return { cx, cy, span: clamp(Math.max(desired.span, 36), MIN_SPAN, MAX_SPAN), z: bestZ, yaw: bestYaw, pitch: desired.pitch }
  },
  mustSee(ctx) {
    if (!ctx.carrier) return []
    return [...carrierPts(ctx.carrier), { x: ctx.ball.x, y: ctx.ball.y, z: ctx.ball.z }]
  },
}

/** B5b's ordered special rules (each overrides the previous shaper's target). */
export const SPECIAL_RULES: DirectorRule[] = [
  deepShot,
  sideline,
  kicks,
  longReturn,
  fieldGoal,
  goalLine,
  keepCarrier,
]

/**
 * The single entry point B6/B7/B8 call: B5a's director with B5b's rules plugged
 * in. `opts` (profile / viewport / a custom rule list) is passed straight through.
 */
export function createBroadcastDirector(opts: DirectorOptions = {}): Director {
  return createDirector({ ...opts, rules: SPECIAL_RULES })
}

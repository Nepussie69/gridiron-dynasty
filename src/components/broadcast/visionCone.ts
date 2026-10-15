// ─────────────────────────────────────────────────────────────────────────────
// QB vision cone + placement circle (backlog 303/306/307/309). Presentation only.
//
// Reads the J10a fields the engine records on a pass Play (readNo, checkdown,
// coneDeg, placeRadiusYd, ballOffsetYd) plus the recorded PlayAnim (QB path,
// throw event, flight, catch point) and works out, for any time t (0..1 of the
// play), where the QB's head is turned and how wide his cone is, and the ring at
// the catch point. The read schedule, the pressure-narrowed width and the ball
// placement come from qbReads.ts (shared with the 2.5D QB facing). When a field is absent (vision layer off / older save) the
// cone is derived from the QB's own ratings with vision.ts's pure `visionThrow`
// (clean pocket) or its league-average constants. No engine code is touched.
//
// Geometry is in playAnim's offense frame (x downfield, y across). Two drawers:
// `QbConeLayer.hook` (2.5D ground plane, perspective-correct) and the top-down
// SVG (visionConeSvg.tsx) share `qbConeAt`.
// ─────────────────────────────────────────────────────────────────────────────
import type { Play } from '../../game/engine/playsim'
import type { Player } from '../../game/types'
import type { PlayAnim } from '../playAnim'
import { coneWidthAt, qbLook, radiusAt, readPlanOf } from './qbReads'
import { offenseToWorld, project, type Camera } from './camera'
import type { BroadcastFrame, LayerHook } from './renderer'

export interface ConeShape {
  /** The QB's head, offense frame. */
  ox: number
  oy: number
  /** Direction he is looking (radians, 0 = downfield +x). */
  yaw: number
  /** Half the cone width (radians). */
  half: number
  /** Reach (yards) - to about the deepest read. */
  len: number
  alpha: number
  /** True once he has settled on the target (the last part of the read, then the throw). */
  locked: boolean
}

export interface RingShape {
  cx: number
  cy: number
  /** Exactly the recorded placeRadiusYd. */
  r: number
  /** Where the ball actually is / lands. */
  bx: number
  by: number
  alpha: number
  outside: boolean
  /** Before the release: the circle only (no ball spot yet). */
  noBall?: boolean
}

const sm = (u: number) => { const v = u < 0 ? 0 : u > 1 ? 1 : u; return v * v * (3 - 2 * v) }

/** The drawn cone + circle at time t (0..1 of the play). The schedule, the widths and the
 *  placement come from the shared read plan (qbReads.ts) so the cone turns with the QB's
 *  head in 2.5D and the shoulder bar on top-down. */
export function qbConeAt(play: Play, anim: PlayAnim, t: number, qb?: Player): { cone: ConeShape | null; ring: RingShape | null } {
  const plan = readPlanOf(anim, play, qb)
  if (!plan || !anim.actors.some((a) => a.key === 'qb')) return { cone: null, ring: null }
  const { snapT, endT, catchT, D } = plan
  let cone: ConeShape | null = null
  const fadeEnd = endT + 0.1
  if (t >= snapT && t < fadeEnd) {
    const tc = Math.min(t, endT)
    const look = qbLook(plan, anim, tc)
    const fadeIn = sm((t - snapT) / 0.03)
    const fadeOut = t <= endT ? 1 : 1 - sm((t - endT) / 0.1)
    cone = {
      ox: look.ox, oy: look.oy, yaw: look.yaw, half: (coneWidthAt(plan, tc) * Math.PI) / 360,
      len: Math.min(50, Math.max(10, look.dist + 2.5)), alpha: fadeIn * fadeOut, locked: look.locked,
    }
  }
  let ring: RingShape | null = null
  const tl = plan.looks.find((l) => l.role !== 'read')
  // livetele3 (user 2026-10-15): the placement circle sat on the eventual catch
  // spot from the moment his eyes settled there — before the throw, which told
  // the user where the ball was going. It now appears only once he releases (the
  // eyes settle on the target at plan.endT), so nothing reveals the target early.
  if (catchT != null && tl && t >= endT && t < catchT + 0.14) {
    const pl = plan.place
    const cx = pl ? pl.ix : plan.aimX
    const cy = pl ? pl.iy : plan.aimY
    const grow = sm(((t - endT) * D) / 0.15)
    const out = t <= catchT + 0.06 ? 1 : 1 - sm((t - catchT - 0.06) / 0.08)
    const bx = pl ? pl.ix + pl.dx : plan.aimX
    const by = pl ? pl.iy + pl.dy : plan.aimY
    const r = radiusAt(plan, Math.min(t, endT))
    ring = { cx, cy, r, bx, by, alpha: grow * out, outside: Math.hypot(bx - cx, by - cy) > r }
  }
  return { cone, ring }
}

/** Wedge outline (offense frame): origin then the arc. */
export function wedgePoints(c: ConeShape, steps = 14): { x: number; y: number }[] {
  const pts = [{ x: c.ox, y: c.oy }]
  for (let i = 0; i <= steps; i++) {
    const a = c.yaw - c.half + (2 * c.half * i) / steps
    pts.push({ x: c.ox + Math.cos(a) * c.len, y: c.oy + Math.sin(a) * c.len })
  }
  return pts
}

export function ringPoints(r: RingShape, steps = 40): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    pts.push({ x: r.cx + Math.cos(a) * r.r, y: r.cy + Math.sin(a) * r.r })
  }
  return pts
}

/** The 2.5D ground-plane layer. Compose it after the weather ground hook. */
export class QbConeLayer {
  enabled = false
  t = 0
  private play: Play | null = null
  private anim: PlayAnim | null = null
  private qb: Player | undefined

  set(play: Play | null, anim: PlayAnim | null, qb?: Player): void {
    this.play = play
    this.anim = anim
    this.qb = qb
  }

  readonly hook: LayerHook = (ctx, cam: Camera, frame: BroadcastFrame, info) => {
    if (!this.enabled || !this.play || !this.anim) return
    const { cone, ring } = qbConeAt(this.play, this.anim, this.t, this.qb)
    if (!cone && !ring) return
    const dir = frame.direction
    const proj = (p: { x: number; y: number }) => {
      const w = offenseToWorld(p.x, p.y, dir)
      return project(cam, w.x, w.y, 0)
    }
    const lw = Math.max(1, info.dpr)
    ctx.save()
    ctx.lineJoin = 'round'
    if (cone && cone.alpha > 0.01) {
      const pts = wedgePoints(cone).map(proj)
      if (pts.every((p) => p)) {
        const o = pts[0]!
        const mid = pts[Math.floor(pts.length / 2)]!
        const g = ctx.createLinearGradient(o.x, o.y, mid.x, mid.y)
        const a = cone.alpha
        g.addColorStop(0, `rgba(255, 232, 130, ${0.42 * a})`)
        g.addColorStop(1, `rgba(255, 232, 130, ${0.12 * a})`)
        ctx.beginPath()
        ctx.moveTo(o.x, o.y)
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y)
        ctx.closePath()
        ctx.fillStyle = g
        ctx.fill()
        ctx.strokeStyle = `rgba(20, 24, 20, ${0.3 * a})`
        ctx.lineWidth = 3 * lw
        ctx.stroke()
        ctx.strokeStyle = `rgba(255, 246, 200, ${(cone.locked ? 0.85 : 0.55) * a})`
        ctx.lineWidth = 1.4 * lw
        ctx.stroke()
      }
    }
    if (ring && ring.alpha > 0.01) {
      const rp = ringPoints(ring).map(proj)
      if (rp.every((p) => p)) {
        ctx.beginPath()
        ctx.moveTo(rp[0]!.x, rp[0]!.y)
        for (let i = 1; i < rp.length; i++) ctx.lineTo(rp[i]!.x, rp[i]!.y)
        ctx.closePath()
        ctx.fillStyle = `rgba(255, 232, 130, ${0.16 * ring.alpha})`
        ctx.fill()
        ctx.strokeStyle = `rgba(20, 24, 20, ${0.35 * ring.alpha})`
        ctx.lineWidth = 3.4 * lw
        ctx.stroke()
        ctx.strokeStyle = `rgba(255, 246, 200, ${0.95 * ring.alpha})`
        ctx.lineWidth = 1.6 * lw
        ctx.stroke()
      }
      const b = ring.noBall ? null : proj({ x: ring.bx, y: ring.by })
      if (b) {
        ctx.beginPath()
        ctx.arc(b.x, b.y, 3.2 * lw, 0, Math.PI * 2)
        ctx.fillStyle = ring.outside ? `rgba(255, 120, 90, ${ring.alpha})` : `rgba(255, 246, 200, ${ring.alpha})`
        ctx.fill()
        ctx.strokeStyle = `rgba(20, 24, 20, ${0.7 * ring.alpha})`
        ctx.lineWidth = 1.2 * lw
        ctx.stroke()
      }
    }
    ctx.restore()
  }
}

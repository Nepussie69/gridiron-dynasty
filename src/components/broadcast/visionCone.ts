// ─────────────────────────────────────────────────────────────────────────────
// QB vision cone + placement circle (backlog 303/306/307/309). Presentation only.
//
// Reads the J10a fields the engine records on a pass Play (readNo, checkdown,
// coneDeg, placeRadiusYd, ballOffsetYd) plus the recorded PlayAnim (QB path,
// throw event, flight, catch point) and works out, for any time t (0..1 of the
// play), where the QB's head is turned and how wide his cone is, and the ring at
// the catch point. When a field is absent (vision layer off / older save) the
// cone is derived from the QB's own ratings with vision.ts's pure `visionThrow`
// (clean pocket) or its league-average constants. No engine code is touched.
//
// Geometry is in playAnim's offense frame (x downfield, y across). Two drawers:
// `QbConeLayer.hook` (2.5D ground plane, perspective-correct) and the top-down
// SVG (visionConeSvg.tsx) share `qbConeAt`.
// ─────────────────────────────────────────────────────────────────────────────
import type { Play } from '../../game/engine/playsim'
import type { Player } from '../../game/types'
import { playbookPlay } from '../../game/data/playbookData'
import { readOrder, routeForCandidate, visionThrow, VISION } from '../../game/engine/vision'
import { posAt, type PlayAnim } from '../playAnim'
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
}

export interface ConePlan {
  snapT: number
  relT: number
  catchT: number
  /** Receiver keys in the order he looks at them; the last is the target. */
  seq: string[]
  coneDeg: number
  radius: number
  offset: number
  offAngle: number
  catchX: number
  catchY: number
  tgtX: number
  tgtY: number
}

const SKILL = ['wr0', 'wr1', 'wr2', 'te', 'rb']
const plans = new WeakMap<PlayAnim, { play: Play; qb: Player | undefined; plan: ConePlan | null }>()

const sm = (u: number) => { const v = u < 0 ? 0 : u > 1 ? 1 : u; return v * v * (3 - 2 * v) }
const hash01 = (n: number) => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s) }

/** The read plan for a pass play, or null when there is nothing to draw (runs, sacks, kicks, spikes). */
export function conePlan(play: Play, anim: PlayAnim, qb?: Player): ConePlan | null {
  const hit = plans.get(anim)
  if (hit && hit.play === play && hit.qb === qb) return hit.plan
  const plan = buildPlan(play, anim, qb)
  plans.set(anim, { play, qb, plan })
  return plan
}

function buildPlan(play: Play, anim: PlayAnim, qb?: Player): ConePlan | null {
  if (play.type !== 'pass') return null
  const f = anim.flights[0]
  const q = anim.actors.find((a) => a.key === 'qb')
  const th = (anim.events ?? []).find((e) => e.kind === 'throw')
  if (!f || !q || !th) return null
  const tgt = th.keys[1] ?? null
  const snapT = (anim.events ?? []).find((e) => e.kind === 'snap')?.t ?? 0
  const relT = f.t0
  const catchPt = posAt(anim.ball, f.t1)
  const tgtActor = tgt ? anim.actors.find((a) => a.key === tgt) : undefined
  const tgtPt = tgtActor ? posAt(tgtActor.path, f.t1) : catchPt
  // The designed read order over the receivers on this play (same table the engine used).
  const keys = SKILL.filter((k) => anim.actors.some((a) => a.key === k))
  const concept = play.concept
  let wr = 0
  const routes = keys.map((k) => (k.startsWith('wr') ? routeForCandidate(concept, 'WR', wr++) : k === 'te' ? routeForCandidate(concept, 'TE', 0) : routeForCandidate(concept, 'RB', 0)))
  const rank = playbookPlay(concept) ? readOrder(concept, routes) : keys.map((_, i) => i + 1)
  const others = keys.map((k, i) => ({ k, r: rank[i] })).filter((e) => e.k !== tgt).sort((a, b) => a.r - b.r).map((e) => e.k)
  const readNo = Math.max(1, Math.min(4, play.readNo ?? 1))
  const before = others.slice(0, play.checkdown ? Math.min(2, others.length) : readNo - 1)
  const seq = tgt ? [...before, tgt] : before
  // Cone width / ring radius: the recorded values, else the QB's own ratings (clean pocket).
  let coneDeg = play.coneDeg
  let radius = play.placeRadiusYd
  let offset = play.ballOffsetYd
  if ((coneDeg == null || radius == null) && qb) {
    const v = visionThrow(qb, play.passDepth ?? 10, readNo, null, 0, 0, 0, 0.5, 0)
    coneDeg ??= v.coneDeg
    radius ??= v.placeRadiusYd
    offset ??= v.ballOffsetYd
  }
  return {
    snapT, relT: Math.max(relT, snapT + 0.02), catchT: f.t1, seq,
    coneDeg: coneDeg ?? VISION.coneBase, radius: radius ?? VISION.radiusBase, offset: offset ?? (radius ?? VISION.radiusBase) * 0.66,
    offAngle: hash01(play.n * 7.31) * Math.PI * 2,
    catchX: catchPt.x, catchY: catchPt.y, tgtX: tgtPt.x, tgtY: tgtPt.y,
  }
}

/** Where he looks for `key` at time t (the target is the catch point itself). */
function lookPoint(plan: ConePlan, anim: PlayAnim, key: string, t: number, last: boolean): { x: number; y: number } {
  if (last) return { x: plan.catchX, y: plan.catchY }
  const a = anim.actors.find((x) => x.key === key)
  return a ? posAt(a.path, Math.min(t, plan.relT)) : { x: plan.catchX, y: plan.catchY }
}

export function qbConeAt(play: Play, anim: PlayAnim, t: number, qb?: Player): { cone: ConeShape | null; ring: RingShape | null } {
  const plan = conePlan(play, anim, qb)
  const qa = anim.actors.find((a) => a.key === 'qb')
  if (!plan || !qa) return { cone: null, ring: null }
  const { snapT, relT, catchT, seq } = plan
  let cone: ConeShape | null = null
  const fadeEnd = relT + 0.1
  if (t >= snapT && t < fadeEnd) {
    const tc = Math.min(t, relT)
    const q = posAt(qa.path, tc)
    // Dwell windows: the earlier reads share the first 65 % of the time he has, the target the rest.
    const span = Math.max(1e-4, relT - snapT)
    const n = seq.length
    const bounds: number[] = [snapT]
    for (let i = 0; i < n - 1; i++) bounds.push(snapT + (span * 0.65 * (i + 1)) / Math.max(1, n - 1))
    bounds.push(relT)
    let seg = 0
    while (seg < n - 1 && tc >= bounds[seg + 1]) seg++
    const aimAt = (i: number) => {
      const p = lookPoint(plan, anim, seq[i], tc, i === n - 1)
      return { yaw: Math.atan2(p.y - q.y, p.x - q.x), d: Math.hypot(p.x - q.x, p.y - q.y) }
    }
    const cur = aimAt(seg)
    const prevYaw = seg === 0 ? 0 : aimAt(seg - 1).yaw
    const segLen = Math.max(1e-4, bounds[seg + 1] - bounds[seg])
    const turn = sm((tc - bounds[seg]) / (segLen * 0.3))
    let dy = cur.yaw - prevYaw
    while (dy > Math.PI) dy -= 2 * Math.PI
    while (dy < -Math.PI) dy += 2 * Math.PI
    const yaw = prevYaw + dy * turn
    let len = 0
    for (let i = 0; i <= seg; i++) len = Math.max(len, aimAt(i).d)
    const fadeIn = sm((t - snapT) / 0.03)
    const fadeOut = t <= relT ? 1 : 1 - sm((t - relT) / 0.1)
    cone = {
      ox: q.x, oy: q.y, yaw, half: (plan.coneDeg * Math.PI) / 360,
      len: Math.min(50, Math.max(10, len + 2.5)), alpha: fadeIn * fadeOut, locked: seg === n - 1 && turn >= 1,
    }
  }
  let ring: RingShape | null = null
  if (t > relT && t < catchT + 0.14) {
    const grow = sm((t - relT) / Math.max(0.02, (catchT - relT) * 0.25))
    const out = t <= catchT + 0.06 ? 1 : 1 - sm((t - catchT - 0.06) / 0.08)
    let bx = plan.catchX
    let by = plan.catchY
    const apart = Math.hypot(plan.catchX - plan.tgtX, plan.catchY - plan.tgtY)
    let cx = plan.tgtX
    let cy = plan.tgtY
    if (apart < 0.3) {
      cx = plan.catchX
      cy = plan.catchY
      bx = cx + Math.cos(plan.offAngle) * plan.offset
      by = cy + Math.sin(plan.offAngle) * plan.offset
    }
    ring = { cx, cy, r: plan.radius, bx, by, alpha: grow * out, outside: Math.hypot(bx - cx, by - cy) > plan.radius }
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
      const b = proj({ x: ring.bx, y: ring.by })
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

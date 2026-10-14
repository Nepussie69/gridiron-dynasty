// Read visuals on the top-down field (qbReads.ts): the QB's shoulders + facemask turning
// through his reads (until the wind-up, where the throwing arm takes over), and the
// eye-jumper's eyes on the QB before he breaks. Field units; x mirrored by `mx`.
import type { Play } from '../../game/engine/playsim'
import type { Player } from '../../game/types'
import type { PlayAnim } from '../playAnim'
import { THROW_TIMING } from './animData'
import { posAt } from './interp'
import { qbLook, readPlanOf } from './qbReads'

export function QbReadsSvg({ play, anim, t, mx, qb }: { play: Play; anim: PlayAnim; t: number; mx: (x: number) => number; qb?: Player }) {
  const plan = readPlanOf(anim, play, qb)
  const qp = anim.actors.find((a) => a.key === 'qb')?.path
  if (!plan || !qp) return null
  const f = anim.flights[0]
  const until = plan.kind === 'pass' && f ? f.t0 - THROW_TIMING[anim.throwStyle ?? 'normal'].wind / plan.D : plan.endT
  const j = plan.jump
  const jp = j ? anim.actors.find((a) => a.key === j.key)?.path : undefined
  const showQb = t >= plan.snapT && t < until
  const showJ = !!j && !!jp && t >= j.lookT && t < j.breakT
  if (!showQb && !showJ) return null
  const q = posAt(qp, t)
  let qbG = null
  if (showQb) {
    const { yaw } = qbLook(plan, anim, t)
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    qbG = (
      <g data-qb-read="">
        <line x1={mx(q.x - s * 1.95)} y1={q.y + c * 1.95} x2={mx(q.x + s * 1.95)} y2={q.y - c * 1.95} stroke="var(--color-ink)" strokeWidth={0.5} strokeOpacity={0.85} />
        <line x1={mx(q.x + c * 1.6)} y1={q.y + s * 1.6} x2={mx(q.x + c * 2.7)} y2={q.y + s * 2.7} stroke="var(--color-gold)" strokeWidth={0.42} />
      </g>
    )
  }
  let jG = null
  if (showJ && jp) {
    const p = posAt(jp, t)
    const dx = q.x - p.x
    const dy = q.y - p.y
    const l = Math.hypot(dx, dy) || 1
    jG = <line data-eye-jump="" x1={mx(p.x + (dx / l) * 1.8)} y1={p.y + (dy / l) * 1.8} x2={mx(p.x + (dx / l) * 3.4)} y2={p.y + (dy / l) * 3.4} stroke="var(--color-warn)" strokeWidth={0.32} strokeDasharray="0.5 0.35" />
  }
  return (
    <g pointerEvents="none" strokeLinecap="round">
      {qbG}
      {jG}
    </g>
  )
}

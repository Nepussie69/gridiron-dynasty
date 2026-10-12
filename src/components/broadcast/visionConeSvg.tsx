// QB vision cone + placement circle for the top-down SVG view (field units: x mirrored by `mx`, y across).
import type { Play } from '../../game/engine/playsim'
import type { Player } from '../../game/types'
import type { PlayAnim } from '../playAnim'
import { qbConeAt, ringPoints, wedgePoints } from './visionCone'

export function QbConeSvg({ play, anim, t, mx, qb }: { play: Play; anim: PlayAnim; t: number; mx: (x: number) => number; qb?: Player }) {
  const { cone, ring } = qbConeAt(play, anim, t, qb)
  const pts = (a: { x: number; y: number }[]) => a.map((p) => `${mx(p.x)},${p.y}`).join(' ')
  return (
    <g pointerEvents="none" data-qb-cone="">
      {cone && cone.alpha > 0.01 && (
        <polygon points={pts(wedgePoints(cone))} fill="var(--color-gold)" fillOpacity={0.24 * cone.alpha} stroke="var(--color-gold)" strokeOpacity={(cone.locked ? 0.95 : 0.6) * cone.alpha} strokeWidth={0.22} strokeLinejoin="round" />
      )}
      {ring && ring.alpha > 0.01 && (
        <g opacity={ring.alpha}>
          <polygon points={pts(ringPoints(ring))} fill="var(--color-gold)" fillOpacity={0.14} stroke="var(--color-canvas)" strokeOpacity={0.6} strokeWidth={0.5} />
          <polygon points={pts(ringPoints(ring))} fill="none" stroke="var(--color-gold)" strokeWidth={0.26} />
          <circle cx={mx(ring.bx)} cy={ring.by} r={0.5} fill={ring.outside ? 'var(--color-warn)' : 'var(--color-ink)'} stroke="var(--color-canvas)" strokeWidth={0.12} />
        </g>
      )}
    </g>
  )
}

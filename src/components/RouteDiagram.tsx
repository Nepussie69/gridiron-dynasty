// ─────────────────────────────────────────────────────────────────────────────
// A tiny top-down route diagram for one playbook play (L12.10 B6): the routes
// its receivers run, drawn from the same route data the animation uses. Used on
// the play-call cards and the game-plan script picker.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react'
import { ROUTES } from '../game/data/routes'
import { playbookPlay, treeFor } from '../game/data/playbookData'
import { MID_Y } from './playAnim'

const H = 30
const LOS_X = 16
const Y_SCALE = H / 53.3

/** Where each receiver key lines up, in field coordinates. */
const SLOT: Record<string, number> = { wr0: 5, wr1: 48.3, wr2: 13, te: MID_Y + 4.4, rb: MID_Y + 2.5 }

interface Line {
  key: string
  pts: { x: number; y: number }[]
}

function pathsFor(name: string): Line[] {
  const play = playbookPlay(name)
  if (!play) return []
  const tree = treeFor(play)
  const out: Line[] = []
  const los = 10
  for (const [key, route] of Object.entries(tree)) {
    const y = SLOT[key]
    if (y === undefined) continue
    const def = ROUTES[route]
    if (!def) continue
    const inw = y < MID_Y ? 1 : -1
    const side = y < MID_Y ? 1 : -1
    const wps = def.wps(y, los, 1, inw, -inw, side)
    out.push({ key, pts: wps.map((w) => ({ x: w.x, y: w.y })) })
  }
  return out
}

/** Field → SVG coordinates. */
const sx = (x: number) => LOS_X + (x - 10)
const sy = (y: number) => 2 + y * Y_SCALE

export function RouteDiagram({ name, className }: { name: string; className?: string }) {
  const lines = useMemo(() => pathsFor(name), [name])
  return (
    <svg viewBox="0 0 64 34" className={className} role="img" aria-label={`${name} route diagram`}>
      <rect x={0} y={0} width={64} height={34} rx={2} fill="#14603a" />
      <line x1={sx(10)} y1={2} x2={sx(10)} y2={32} stroke="#ffd34d" strokeWidth={0.4} />
      {lines.map((l) => {
        const d = l.pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ')
        return <path key={l.key} d={d} fill="none" stroke="#fff" strokeWidth={0.8} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
      })}
      {lines.map((l) => {
        const a = l.pts[0]
        const b = l.pts[l.pts.length - 1]
        return (
          <g key={`${l.key}-d`}>
            <circle cx={sx(a.x)} cy={sy(a.y)} r={1.1} fill="#ffd34d" />
            <circle cx={sx(b.x)} cy={sy(b.y)} r={1.1} fill="#fff" />
          </g>
        )
      })}
    </svg>
  )
}

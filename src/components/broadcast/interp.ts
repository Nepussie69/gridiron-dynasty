// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D: keyframe interpolation shared by the actor layer (B3), the
// previews and later phases (B4 ball, B5 camera). Dependency-free apart from
// camera.ts constants, so scripts/check-broadcast.ts can load it in node.
// Same maths as playAnim.posAt / holderAt (which pull in game data at runtime).
// ─────────────────────────────────────────────────────────────────────────────
import { MID_WIDTH } from './camera.ts'

/** A keyframe on a path (offense frame, t in 0..1 of the play). */
export interface PathPoint {
  t: number
  x: number
  y: number
}

/** Position along a keyframed path at t (an empty path sits on the 50, mid-field). */
export function posAt(path: readonly PathPoint[] | undefined, t: number): { x: number; y: number } {
  if (!path || !path.length) return { x: 60, y: MID_WIDTH }
  if (t <= path[0].t) return { x: path[0].x, y: path[0].y }
  for (let i = 1; i < path.length; i++) {
    const b = path[i]
    if (t <= b.t) {
      const a = path[i - 1]
      const sp = b.t - a.t
      const u = sp <= 0 ? 1 : (t - a.t) / sp
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
    }
  }
  const l = path[path.length - 1]
  return { x: l.x, y: l.y }
}

/** Who holds the ball at t (actor key), from a play's holder changes. */
export function holderAt(holders: readonly { t: number; key: string | null }[] | undefined, t: number): string | null {
  let key: string | null = null
  for (const h of holders ?? []) if (t >= h.t) key = h.key
  return key
}

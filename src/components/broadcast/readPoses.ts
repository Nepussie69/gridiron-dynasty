// ─────────────────────────────────────────────────────────────────────────────
// Read visuals (backlog 303-309, J10a): the catch / break-up poses the ball
// placement draws (qbReads.ts picks them). Spread into figures.POSE_LIBRARY;
// the names are listed in animData's PoseState union. Type imports only, so
// figures.ts can import this at module init without a cycle.
// ─────────────────────────────────────────────────────────────────────────────
import type { PoseDef } from './figures.ts'

/** The pose states this module adds (keep in sync with animData PoseState). */
export type ReadPoseState = 'catchHigh' | 'catchLow' | 'catchReach' | 'catchBack' | 'swat'

const c01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const ease = (u: number) => u * u * (3 - 2 * u)

export const READ_POSES: Record<ReadPoseState, PoseDef> = {
  // A ball placed high: both arms fully up, chest open, a stride that lifts.
  catchHigh: {
    base: { au: 1, ln: 0, cr: 0.04, run: 0.7 },
    dyn: (age, len, p) => {
      const u = c01(age / Math.max(0.1, len))
      p.cr = 0.18 * Math.sin(Math.PI * c01(u * 1.6)) // gather, then extend up
    },
  },
  // A ball placed low: knees bent, chest over the ball, hands scooping in front.
  catchLow: {
    base: { cr: 0.5, ln: 0.62, af: 1, run: 0.55 },
    dyn: (age, len, p) => {
      const u = c01(age / Math.max(0.1, len))
      p.cr = 0.25 + 0.3 * ease(c01(u / 0.5))
    },
  },
  // A ball placed ahead / across him: arms locked out to it, body leaning after.
  catchReach: {
    base: { af: 1, sp: 0.25, ln: 0.42, cr: 0.12, run: 0.8 },
    dyn: (age, len, p) => {
      const u = c01(age / Math.max(0.1, len))
      p.sp = 0.35 * Math.sin(Math.PI * u)
    },
  },
  // A ball placed behind him: the back-shoulder turn — he twists back to the ball
  // (the facing turns with it), arms up and back.
  catchBack: { base: { au: 0.8, af: 0.35, ln: 0.12, cr: 0.15, run: 0.45 } },
  // A defender getting a hand on the throw: one big reach up and through the ball.
  swat: {
    base: { au: 0.85, af: 0.4, ln: 0.35, cr: 0.12, run: 0.8 },
    dyn: (age, len, p) => {
      const u = c01(age / Math.max(0.1, len))
      p.au = 0.85 * (1 - 0.6 * ease(c01((u - 0.55) / 0.45)))
      p.af = 0.4 + 0.5 * ease(c01((u - 0.4) / 0.4))
    },
  },
}

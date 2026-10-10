// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B7): the phone camera profile. Pure TypeScript.
//
// On a phone the 2.5D camera must re-aim and re-frame for a tall, narrow
// viewport: the aim point leans to the strong side, the lens is closer and
// higher, and the vertical FOV is much wider than the desktop broadcast lens
// (35–43°) so the carrier still reads at 15–25 px. Numbers come from the
// mockup's PROF table (docs/anim-mockups/anim-b-broadcast25d.html).
//
// applyCameraProfile keeps the director's pose intent (where it looks, its
// heading) and only re-aims + re-frames, then a safe-area pass keeps the
// carrier (or the ball in flight) inside the inner 88% of the viewport by
// widening the FOV first, then pulling back along the view ray — all as a
// continuous function of the input, so no per-frame jump can appear.
// ─────────────────────────────────────────────────────────────────────────────
import { FIELD_WIDTH, MID_WIDTH, makeCamera, project, type CameraPose, type Direction, type Vec3 } from './camera.ts'

export interface ProfileVariant {
  /** Aim point across the field, offence frame (yards). MID_WIDTH = no lean. */
  by: number
  /** Formation lean (mockup data; framing hint). */
  lean: number
  /** Horizontal camera→focus distance (yards). */
  back: number
  /** Camera height (yards). */
  h: number
  /** Camera heading (radians; 0 = behind an offence attacking +x). */
  yaw: number
  /** Vertical FOV (degrees); 0 = keep the pose's own FOV. */
  fov: number
  /** Extra focus offset toward the strong side (mockup data). */
  dx?: number
}

export interface CameraProfile {
  live: ProfileVariant
  replay: ProfileVariant
}

export const CAMERA_PROFILES: Record<'main' | 'phone', CameraProfile> = {
  main: {
    // The desktop lens is the reference the phone ratios are measured against:
    // by = MID_WIDTH and fov 0 (keep the director's 35–43°) make
    // applyCameraProfile an identity on desktop, so the director's own framing
    // is untouched. (The mockup's main/tele row leans by MIDY+5, lean 6.5.)
    live: { by: MID_WIDTH, lean: 5.5, back: 32, h: 21.5, yaw: 0, fov: 0 },
    replay: { by: MID_WIDTH, lean: 6.5, back: 20, h: 26, yaw: -0.06, fov: 0 },
  },
  phone: {
    // by 32.5 vs mid 26.65 → ~+5.9 yd toward the strong side. Closer than main
    // (0.88× live, 0.75× replay) and higher (+1.5 yd), FOV 50° (48–50 live,
    // 50–56 replay per the mockup; replay keeps a flat enough lens that the
    // carrier still reads > 20 px tall).
    live: { by: 32.5, lean: 4, back: 28, h: 23, yaw: 0, fov: 50 },
    replay: { by: 33, lean: 5, back: 28, h: 23, yaw: -0.06, dx: -0.5, fov: 50 },
  },
}

/** Portrait (or under 768 px) uses the phone lens. */
export function profileFor(viewport: { cssW: number; cssH: number }, _phase: 'live' | 'replay' = 'live'): 'main' | 'phone' {
  return viewport.cssW < 768 || viewport.cssH > viewport.cssW ? 'phone' : 'main'
}

export function profileVariant(prof: CameraProfile, phase: 'live' | 'replay'): ProfileVariant {
  return prof[phase]
}

export interface ProfileCtx {
  /** World-space y of the strong-side aim point (caller converts from the offence frame). */
  strongSideY: number
  /** The ball carrier in world coordinates, when there is one. */
  carrier?: { x: number; y: number } | null
  /** The ball in world coordinates (z = height, yards). */
  ball?: { x: number; y: number; z?: number } | null
  /** Line of scrimmage in world x (unused by framing; kept for callers/tests). */
  losX: number
  direction: Direction
  /** Which variant of `prof` to use. */
  phase?: 'live' | 'replay'
  /** Projection viewport in the same units the figure height is reported in (CSS px). */
  viewport?: { w: number; h: number }
}

export const PROFILE_FOV_MAX = 56
/** Inner safe rect: 88% of the viewport (6% inset each side). */
export const PROFILE_SAFE = 0.88

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

interface Rig {
  target: Vec3
  back: number
  height: number
  yaw: number
  fov: number
}

function poseOf(r: Rig): CameraPose {
  return {
    pos: [r.target[0] + r.back * Math.cos(r.yaw), r.target[1] + r.back * Math.sin(r.yaw), r.height],
    target: r.target,
    fovDeg: clamp(r.fov, 1, 170),
  }
}

/** The worst normalised margin beyond the inner 88% safe rect (<= 0 = contained). */
function overshoot(r: Rig, ctx: ProfileCtx, vp: { w: number; h: number }): number {
  const cam = makeCamera(poseOf(r), { width: vp.w, height: vp.h })
  let worst = -Infinity
  const watch: { x: number; y: number; z?: number }[] = []
  if (ctx.carrier) watch.push(ctx.carrier)
  if (ctx.ball) watch.push(ctx.ball)
  if (!watch.length) return -Infinity
  for (const p of watch) {
    const s = project(cam, p.x, p.y, p.z ?? 0)
    if (!s) return 1
    const nx = Math.abs(s.x - vp.w / 2) / (vp.w / 2)
    const ny = Math.abs(s.y - vp.h / 2) / (vp.h / 2)
    worst = Math.max(worst, Math.max(nx, ny) - PROFILE_SAFE)
  }
  return worst
}

/**
 * Re-aim + re-frame a pose for `prof`. Continuous in its input, so a smooth
 * incoming track stays smooth (no aim move > 1.5 yd or FOV change > 2° between
 * adjacent 60 Hz samples is ever forced by this function).
 */
export function applyCameraProfile(pose: CameraPose, prof: CameraProfile, ctx: ProfileCtx): CameraPose {
  const v = prof[ctx.phase ?? 'live']
  const vp = ctx.viewport ?? { w: 1280, h: 720 }
  const [px, py, pz] = pose.pos
  const [tx, ty, tz] = pose.target

  // 1. re-aim: lean the aim point toward the strong side, clamped inside the field.
  const leanMax = Math.abs(v.by - MID_WIDTH)
  const shift = clamp(ctx.strongSideY - ty, -leanMax, leanMax)
  const nty = clamp(ty + shift, 2, FIELD_WIDTH - 2)
  const target: Vec3 = [tx + (v.dx ?? 0), nty, tz]

  // 2. re-frame: keep the heading, scale the distance, adjust the height + FOV.
  const yaw = Math.atan2(py - ty, px - tx)
  const base = CAMERA_PROFILES.main.live
  const backScale = base.back > 0 ? v.back / base.back : 1
  const hAdd = v.h - base.h
  const rig: Rig = { target, back: Math.hypot(px - tx, py - ty) * backScale, height: pz + hAdd, yaw, fov: v.fov > 0 ? v.fov : pose.fovDeg }

  // 3. safe-area pass: widen the FOV (up to 56°, at most 2° per call), then pull
  //    back along the ray. Bounded per call so a teleporting input can never
  //    force a >2°/frame jump on its own.
  let widened = 0
  for (let i = 0; i < 8; i++) {
    const o = overshoot(rig, ctx, vp)
    if (o <= 0) break
    if (rig.fov < PROFILE_FOV_MAX && widened < 2) {
      const inc = Math.min(2 - widened, Math.max(0.05, o * 40))
      rig.fov = Math.min(PROFILE_FOV_MAX, rig.fov + inc)
      widened += inc
    } else {
      rig.back = Math.min(90, rig.back * 1.06)
    }
  }
  // A last proportional nudge for a carrier well outside the viewport.
  const oEnd = overshoot(rig, ctx, vp)
  if (oEnd > 0) rig.back = Math.min(120, rig.back * (1 + Math.min(0.1, oEnd)))

  return poseOf(rig)
}

/**
 * A stateful wrapper for the live view: keeps the previous output and eases
 * toward the raw profile result, hard-limiting aim movement (1.5 yd) and FOV
 * change (2°) per 60 Hz frame. `key` identifies the play; changing it resets.
 */
export function createProfileApplier(prof: CameraProfile): {
  apply(pose: CameraPose, ctx: ProfileCtx, key?: string): CameraPose
  reset(): void
} {
  let last: CameraPose | null = null
  let lastKey = ''
  const maxAim = 1.5
  const maxFov = 2
  return {
    reset() {
      last = null
      lastKey = ''
    },
    apply(pose: CameraPose, ctx: ProfileCtx, key = ''): CameraPose {
      const raw = applyCameraProfile(pose, prof, ctx)
      if (!last || key !== lastKey) {
        last = raw
        lastKey = key
        return raw
      }
      const ease = 0.18
      let tx = last.target[0] + (raw.target[0] - last.target[0]) * ease
      let ty = last.target[1] + (raw.target[1] - last.target[1]) * ease
      const tz = last.target[2] + (raw.target[2] - last.target[2]) * ease
      // Hard limit the aim-point move per frame.
      const dx = tx - last.target[0]
      const dy = ty - last.target[1]
      const d = Math.hypot(dx, dy)
      if (d > maxAim) {
        tx = last.target[0] + (dx / d) * maxAim
        ty = last.target[1] + (dy / d) * maxAim
      }
      const px = last.pos[0] + (raw.pos[0] - last.pos[0]) * ease
      const py = last.pos[1] + (raw.pos[1] - last.pos[1]) * ease
      const pz = last.pos[2] + (raw.pos[2] - last.pos[2]) * ease
      const fov = last.fovDeg + clamp(raw.fovDeg - last.fovDeg, -maxFov, maxFov)
      last = { pos: [px, py, pz], target: [tx, ty, tz], fovDeg: fov }
      return last
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B4): the ball + effects composer.
//
//   const layer = new ActorLayer()
//   const fx = createBallFx({ anim, offenseClub, defenseClub, reducedMotion, quality })
//   r.hooks.actors = withBallFx(layer, fx, () => layer.t)
//   // withBallFx attaches to the layer: drawBall off, turf ground effects on,
//   // the in-flight ball inserted into B3's depth-sorted list.
//
// Order per frame (inside B3's hook): ball shadow + ground effects (turf) →
// figures → the ball & its trail (painter-sorted with the figures) → air
// effects (sparkles, spokes, particles, confetti, glints). The camera shake is
// applied by the caller (B5's director calls fx.shakePose(pose, t)); everything
// here is a pure function of (anim, t, opts) — no per-frame state.
// ─────────────────────────────────────────────────────────────────────────────

import type { ActorLayer, Scene, SceneItem } from './actors.ts'
import { ballState } from './ball.ts'
import { drawBall, drawBallShadow, drawBallTrail, drawLandingMarker, type BallDraw } from './ballDraw.ts'
import { offenseToWorld, project, type Camera, type CameraPose } from './camera.ts'
import { drawFxAir, drawFxGround, type FxDraw, type FxPalette } from './fxDraw.ts'
import { buildFxSchedule, fxTailMs, shakeAt, shakePose as applyShake, type FxItem, type FxQuality } from './fxSchedule.ts'
import { clubArt, type ClubLike } from './palette.ts'
import type { BroadcastFrame, LayerHook, LayerInfo } from './renderer.ts'
import type { BroadcastAnim } from './animData.ts'

export interface BallFxOptions {
  anim: BroadcastAnim
  offenseClub: ClubLike
  defenseClub: ClubLike
  reducedMotion?: boolean
  quality?: FxQuality
  thrower?: { thp?: number; tha?: number }
  pressured?: boolean
  /** When B3's own placeholder draws a held ball, hide ours while it is carried. */
  b3DrawsHeldBall?: boolean
}

export interface BallFx {
  schedule: FxItem[]
  tailMs: number
  /** Turf layer: ball shadow, landing marker, ground effect rings / sweeps. */
  ground(ctx: CanvasRenderingContext2D, cam: Camera, frame: BroadcastFrame, info: LayerInfo, t: number): void
  /** Above the figures: sparkles, spokes, particles, confetti, glints. */
  air(ctx: CanvasRenderingContext2D, cam: Camera, frame: BroadcastFrame, info: LayerInfo, t: number): void
  /** Push the in-flight ball (and its trail) into B3's depth-sorted list. */
  items(scene: Scene, out: SceneItem[]): void
  /** The camera pose with this frame's shake applied (0 offset most frames). */
  shakePose(pose: CameraPose, t: number): CameraPose
  /** Wire the fx into a B3 actor layer (drawBall off, ground + items set). */
  attach(layer: ActorLayer): void
}

export function createBallFx(o: BallFxOptions): BallFx {
  const anim = o.anim
  const quality: FxQuality = o.quality ?? 'full'
  const reducedMotion = !!o.reducedMotion
  const stOpts = { reducedMotion, thrower: o.thrower, pressured: o.pressured }
  const schedule = buildFxSchedule(anim, { reducedMotion, quality })
  const tailMs = fxTailMs(anim, schedule)
  const pal: FxPalette = { off: clubArt(o.offenseClub).logoFill, def: clubArt(o.defenseClub).logoFill }

  return {
    schedule,
    tailMs,
    ground(ctx, cam, frame, info, t) {
      const d: BallDraw = { cam, dpr: info.dpr, quality, reducedMotion, toWorld: (x, y) => offenseToWorld(x, y, frame.direction) }
      const st = ballState(anim, t, stOpts)
      drawBallShadow(ctx, st, d)
      drawLandingMarker(ctx, anim, t, d)
      drawFxGround(ctx, d as FxDraw, t, schedule)
    },
    air(ctx, cam, frame, info, t) {
      const d: FxDraw = { cam, dpr: info.dpr, quality, reducedMotion, toWorld: (x, y) => offenseToWorld(x, y, frame.direction) }
      drawFxAir(ctx, d, t, anim, schedule, pal)
    },
    items(scene, out) {
      const t = scene.t
      const st = ballState(anim, t, stOpts)
      if (o.b3DrawsHeldBall && st.kind === 'held') return
      const w = offenseToWorld(st.x, st.y, scene.direction)
      const p = project(scene.cam, w.x, w.y, 0)
      if (!p) return
      const d: BallDraw = { cam: scene.cam, dpr: scene.info.dpr, quality, reducedMotion, toWorld: (x, y) => offenseToWorld(x, y, scene.direction) }
      const carrier = st.holder
      const carrierScr = carrier && st.kind === 'held' ? scene.screenOf(carrier) : undefined
      const depth = carrierScr ? carrierScr.depth - 0.05 : p.depth
      if (st.inFlight && !reducedMotion) {
        out.push({ depth: depth + 0.01, order: 0, draw: (g) => void drawBallTrail(g, anim, t, d) })
      }
      out.push({ depth, order: 1, draw: (g) => drawBall(g, anim, t, st, d) })
    },
    shakePose(pose, t) {
      return applyShake(pose, shakeAt(schedule, t))
    },
    attach(layer) {
      layer.drawBall = false
      layer.ground = (scene) => this.ground(scene.ctx, scene.cam, scene.frame, scene.info, scene.t)
      layer.addItems = (scene, extra) => this.items(scene, extra)
    },
  } satisfies BallFx
}

/** Wrap B3's figures hook so the air effects draw on top of a frame. */
export function withBallFx(figures: ActorLayer | LayerHook, fx: BallFx, getT: () => number): LayerHook {
  const isLayer = typeof figures !== 'function'
  const hook: LayerHook = isLayer ? (figures as ActorLayer).hook : (figures as LayerHook)
  if (isLayer) fx.attach(figures as ActorLayer)
  return (ctx, cam, frame, info) => {
    hook(ctx, cam, frame, info)
    fx.air(ctx, cam, frame, info, getT())
  }
}

/** Attach a composer to a B3 actor layer without wrapping the hook. */
export function attachBallFx(layer: ActorLayer, fx: BallFx): void {
  fx.attach(layer)
}

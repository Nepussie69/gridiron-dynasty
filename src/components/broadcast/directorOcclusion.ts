// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B5b) — pure occlusion measure for the camera director.
//
// How much of the ball carrier does the pile hide? Every actor is turned into a
// screen-space figure box through B2's projection (camera.ts, re-used — never a
// second projection), the boxes are ordered by B2's depth, and the share of the
// carrier's box covered by NEARER figures drives B5b's keepCarrier rule
// (directorRules.ts) and the b5b probe.
//
// Figure size: B3 draws each figure ~0.9 yd wide and ~2.0 yd tall on the turf.
// This module has no B3 import (B3's sprites are not on main yet), so the size is
// a documented constant with the same numbers B3 uses. A figure's screen box is
// its projected feet and head (which give pixels-per-yard at that depth) turned
// into a rectangle — two projections per figure, not eight, so the director's
// per-frame rules stay cheap.
//
// No DOM, no React, no window, no colours: importable from a plain node script
// (see ~/gridiron-work/logs/b5b-probe.mjs). Deterministic, allocation-light.
// ─────────────────────────────────────────────────────────────────────────────
import type { Shot, ShotContext } from './director'
import type { Box } from './directorMath.ts'

/** Drawn figure footprint on the turf (yards) — matches B3's figure size. */
export const FIGURE_WIDTH_YD = 0.9
/** Drawn figure height (yards) — 6 ft. */
export const FIGURE_HEIGHT_YD = 2.0

type Projector = ShotContext['project']

export interface FigureBox {
  /** Screen-space bounds of the figure (pixels). */
  box: Box
  /** Depth of the figure's feet along B2's view axis (yards; smaller = nearer). */
  depth: number
  /** False when a corner is behind B2's near plane (then the box is unusable). */
  visible: boolean
}

const EMPTY: FigureBox = { box: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, depth: Infinity, visible: false }

interface Screen {
  sx: number
  sy: number
  depth: number
}

/** The screen box of a figure from its projected feet, given pixels/yard. */
function boxFromFeet(feet: Screen, pxPerYard: number, width: number, height: number): Box {
  const hw = (width * pxPerYard) / 2
  const hpx = height * pxPerYard
  return { minX: feet.sx - hw, maxX: feet.sx + hw, minY: feet.sy - hpx, maxY: feet.sy }
}

/**
 * The projected screen box of one figure standing at `(x, y)`. Feet and head are
 * projected (two B2 projections) to get that figure's own pixels-per-yard.
 */
export function projectFigure(
  project: Projector,
  x: number,
  y: number,
  shot: Shot,
  width: number = FIGURE_WIDTH_YD,
  height: number = FIGURE_HEIGHT_YD,
): FigureBox {
  const feet = project({ x, y, z: 0 }, shot)
  if (!feet || !Number.isFinite(feet.sx) || !Number.isFinite(feet.sy) || feet.depth <= 0) return EMPTY
  const head = project({ x, y, z: height }, shot)
  if (!head || !Number.isFinite(head.sy)) return EMPTY
  const px = (feet.sy - head.sy) / height
  if (!(px > 1e-6)) return EMPTY
  return { box: boxFromFeet(feet, px, width, height), depth: feet.depth, visible: true }
}

const overlaps = (a: Box, b: Box): boolean =>
  a.maxX > b.minX && a.minX < b.maxX && a.maxY > b.minY && a.minY < b.maxY

const GRID_X = 5
const GRID_Y = 6

/**
 * A figure further than this from the carrier (ground yards) is ignored: it
 * projects far too small to cover a meaningful share of the carrier's box, and
 * skipping it keeps the measure cheap when the caller passes no distance cap.
 * Both the director rule and the probe go through this function, so the cap is
 * part of the metric on both sides.
 */
const HARD_DIST = 14

interface OcclusionResult {
  share: number
  centroidX: number
  centroidY: number
  n: number
}

/**
 * Share (0..1) of the carrier's figure box covered by nearer figures in `shot`,
 * plus the screen centroid of those figures. 0 when there is no carrier, when the
 * carrier is behind the near plane, or when nobody nearer overlaps the box.
 * `maxWorldDist` (yards) optionally ignores actors further than that from the
 * carrier (cheap path for the director rule; the probe measures with Infinity).
 */
export function occlusionDetail(ctx: ShotContext, shot: Shot, maxWorldDist = Infinity): OcclusionResult {
  const car = ctx.carrier
  if (!car) return { share: 0, centroidX: 0, centroidY: 0, n: 0 }
  const feet = ctx.project({ x: car.x, y: car.y, z: 0 }, shot)
  if (!Number.isFinite(feet.sx) || !Number.isFinite(feet.sy) || feet.depth <= 0) return { share: 0, centroidX: 0, centroidY: 0, n: 0 }
  const head = ctx.project({ x: car.x, y: car.y, z: FIGURE_HEIGHT_YD }, shot)
  if (!Number.isFinite(head.sy)) return { share: 0, centroidX: 0, centroidY: 0, n: 0 }
  const selfPx = (feet.sy - head.sy) / FIGURE_HEIGHT_YD
  if (!(selfPx > 1e-6)) return { share: 0, centroidX: 0, centroidY: 0, n: 0 }
  const selfBox = boxFromFeet(feet, selfPx, FIGURE_WIDTH_YD, FIGURE_HEIGHT_YD)
  const selfArea = (selfBox.maxX - selfBox.minX) * (selfBox.maxY - selfBox.minY)
  if (!(selfArea > 0)) return { share: 0, centroidX: 0, centroidY: 0, n: 0 }

  const nearer: Box[] = []
  let cx = 0
  let cy = 0
  const lim = Math.min(maxWorldDist, HARD_DIST)
  for (const [key, p] of ctx.actors) {
    if (key === car.key) continue
    const dx = p.x - car.x
    const dy = p.y - car.y
    if (dx * dx + dy * dy > lim * lim) continue
    const f = ctx.project({ x: p.x, y: p.y, z: 0 }, shot)
    if (!Number.isFinite(f.sx) || !Number.isFinite(f.sy) || f.depth <= 0) continue
    if (f.depth >= feet.depth - 0.05) continue
    const px = (selfPx * feet.depth) / f.depth
    const b = boxFromFeet(f, px, FIGURE_WIDTH_YD, FIGURE_HEIGHT_YD)
    if (!overlaps(b, selfBox)) continue
    nearer.push(b)
    cx += (b.minX + b.maxX) / 2
    cy += (b.minY + b.maxY) / 2
  }
  const n = nearer.length
  if (!n) return { share: 0, centroidX: 0, centroidY: 0, n: 0 }

  let covered = 0
  let total = 0
  const w = selfBox.maxX - selfBox.minX
  const h = selfBox.maxY - selfBox.minY
  for (let i = 0; i < GRID_X; i++) {
    const sx = selfBox.minX + ((i + 0.5) / GRID_X) * w
    for (let j = 0; j < GRID_Y; j++) {
      const sy = selfBox.minY + ((j + 0.5) / GRID_Y) * h
      total++
      for (const b of nearer) {
        if (sx >= b.minX && sx <= b.maxX && sy >= b.minY && sy <= b.maxY) {
          covered++
          break
        }
      }
    }
  }
  return { share: total ? covered / total : 0, centroidX: cx / n, centroidY: cy / n, n }
}

/** 0..1 share of the carrier's figure box covered by nearer figures in `shot`. */
export function carrierOcclusion(ctx: ShotContext, shot: Shot, maxWorldDist = Infinity): number {
  return occlusionDetail(ctx, shot, maxWorldDist).share
}

/** The screen-space centroid (pixels) of the figures nearer than the carrier. */
export function occlusionCentroid(ctx: ShotContext, shot: Shot, maxWorldDist = Infinity): { x: number; y: number; n: number } {
  const d = occlusionDetail(ctx, shot, maxWorldDist)
  return { x: d.centroidX, y: d.centroidY, n: d.n }
}

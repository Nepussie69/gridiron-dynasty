// ─────────────────────────────────────────────────────────────────────────────
// Broadcast 2.5D (B7): quality profiles and the Auto detector. Pure TypeScript
// (no React, no DOM beyond an optional performance.now) so a node script can
// load it directly.
//
//   QUALITY          the full / lite draw profile
//   AutoQuality      watches FrameStats.ms (the draw cost, NOT the rAF
//                    interval) for 60 counted frames and freezes a decision
//                    (Lite when p95 > 12 ms), one decision per live view mount
//   FramePacer(fps)  decides which rAF timestamps should draw (30 fps target
//                    draws every other 60 Hz frame, every 4th at 120 Hz);
//                    animation time always advances by real elapsed time, so
//                    a play lasts exactly as long in Lite and Full
// ─────────────────────────────────────────────────────────────────────────────

export type QualityLevel = 'full' | 'lite'

export interface QualityFlags {
  /** Max device pixel ratio. */
  dprCap: number
  /** Target frames per second the pacer holds. */
  fps: number
  vignette: boolean
  /** Turf grain / cross-hatch. */
  grain: boolean
  /** Sky / crowd / LED gradients (off = flat fills). */
  gradients: boolean
  crowd: 'full' | 'simple'
  effects: 'full' | 'reduced'
}

export const QUALITY: Record<QualityLevel, QualityFlags> = {
  full: { dprCap: 2, fps: 60, vignette: true, grain: true, gradients: true, crowd: 'full', effects: 'full' },
  lite: { dprCap: 1.5, fps: 30, vignette: false, grain: false, gradients: false, crowd: 'simple', effects: 'reduced' },
}

/** What AutoQuality consumes (a subset of renderer FrameStats). */
export interface FrameStatLike {
  ms: number
  staticMs: number
  cache: 'hit' | 'reuse' | 'miss' | 'direct'
  width: number
  height: number
  dpr: number
}

export interface AutoQualityState {
  decided: boolean
  result: QualityLevel
  p95: number
  frames: number
}

/** Counted frames before the one decision is taken. */
export const AUTO_DECIDE_FRAMES = 60
/** p95 draw cost (ms) above which Auto picks Lite. Strict: exactly 12 stays Full. */
export const AUTO_LITE_P95 = 12
/** p95 after falling to Lite above which the view is 'too-slow'. */
export const AUTO_TOO_SLOW_P95 = 28
/** Frames dropped at the start (context creation, first texture build). */
export const AUTO_SKIP_FRAMES = 3

function p95Of(samples: number[]): number {
  if (!samples.length) return 0
  const s = [...samples].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]
}

/**
 * One measurement per live view mount. Ignores the first AUTO_SKIP_FRAMES
 * frames and any static-cache MISS whose static rebuild is a resize / texture
 * build (detected by a size change or the opening frames; counted separately).
 * After AUTO_DECIDE_FRAMES counted frames it freezes: Lite when p95 > 12 ms.
 */
export class AutoQuality {
  private samples: number[] = []
  private raw = 0
  private resizes = 0
  private lastSize = ''
  private state: AutoQualityState

  constructor(start: QualityLevel = 'full') {
    this.state = { decided: false, result: start, p95: 0, frames: 0 }
  }

  get decided(): boolean {
    return this.state.decided
  }
  get result(): QualityLevel {
    return this.state.result
  }
  get p95(): number {
    return this.state.p95
  }
  get frames(): number {
    return this.state.frames
  }
  /** Frames ignored as a resize / texture rebuild (reported separately). */
  get resizeFrames(): number {
    return this.resizes
  }
  get skippedFrames(): number {
    return Math.min(this.raw, AUTO_SKIP_FRAMES)
  }
  /** Every frame fed in (counted + skipped + resize rebuilds). */
  get rawFrames(): number {
    return this.raw
  }

  snapshot(): AutoQualityState {
    return { ...this.state }
  }

  /** Feed one frame's stats. Returns the (possibly updated) state. */
  push(f: FrameStatLike): AutoQualityState {
    if (this.state.decided) return this.state
    this.raw++
    if (this.raw <= AUTO_SKIP_FRAMES) return this.state
    const size = `${f.width}x${f.height}@${f.dpr}`
    const resized = size !== this.lastSize
    this.lastSize = size
    // A static rebuild caused by a resize / first texture build is not a
    // steady-state draw cost: count it apart and do not decide from it.
    if (f.cache === 'miss' && f.staticMs > 0 && resized) {
      this.resizes++
      return this.state
    }
    if (!Number.isFinite(f.ms)) return this.state
    this.samples.push(f.ms)
    if (this.samples.length >= AUTO_DECIDE_FRAMES) {
      const p95 = p95Of(this.samples)
      this.state = { decided: true, result: p95 > AUTO_LITE_P95 ? 'lite' : 'full', p95, frames: this.samples.length }
    } else {
      this.state = { ...this.state, frames: this.samples.length }
    }
    return this.state
  }
}

/** The stored Auto result answers only for its own device; otherwise Full. */
export function autoStartLevel(stored: { result: QualityLevel; key: string } | null, key: string): QualityLevel {
  if (stored && stored.key && stored.key === key) return stored.result
  return 'full'
}

/** The quality actually drawn: an explicit Full/Lite wins, otherwise the Auto result. */
export function effectiveQuality(setting: 'auto' | 'full' | 'lite', autoState: { result: QualityLevel } | null | undefined): QualityLevel {
  if (setting === 'full' || setting === 'lite') return setting
  return autoState?.result ?? 'full'
}

/** The flags for a level (B4 / B6 read these later; they never edit this file). */
export function liteFlags(level: QualityLevel = 'lite'): QualityFlags {
  return QUALITY[level]
}

/**
 * Decides whether a given rAF timestamp should draw. At 30 fps a draw happens
 * once >= 33.3 − 2 ms have elapsed since the last one: a 60 Hz display draws
 * every other frame, a 120 Hz display every 4th, a 50 Hz display every 2nd.
 */
export class FramePacer {
  private minMs: number
  private last = -Infinity
  constructor(fps: number) {
    this.minMs = 1000 / Math.max(1, fps) - 2
  }
  shouldDraw(now: number): boolean {
    if (now - this.last >= this.minMs) {
      this.last = now
      return true
    }
    return false
  }
  /** Forget the last draw (a fresh play, a quality change). */
  reset(now = -Infinity): void {
    this.last = now
  }
}

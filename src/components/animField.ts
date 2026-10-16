// ─────────────────────────────────────────────────────────────────────────────
// E1c — the animation draws the recorded field (FUTURES #54, phase E1c).
//
// Spec decision 4: E1 is never shipped ON without E1c. When the emergent field
// resolved a play it recorded the path every man actually ran — `Play.carryPath`
// (the carrier) and `Play.fieldPaths` (each defender the field moved). This
// module turns those recordings into animation timelines, so playAnim.ts draws
// the carrier and the field's men EXACTLY where the field had them, at the times
// it had them: the tackle happens where and by whom the field recorded it, the
// missed tackles are the recorded near-contacts, and an out-of-bounds end is
// where he really left the field. Everything the field does not record — the
// pre-snap set, the mesh/handoff, the line play, the pile, the celebration —
// stays exactly as it is today, and a play with no recording (E1 off, an old
// save, a kick, a pass with no after-catch segment) keeps today's choreography.
//
// Coordinates: the engine's field is the offense's own-goal frame (x 0 → 100);
// the animation is the same frame shifted by `ANIM_X0` (its own goal at x 10).
// The lateral axis is shared.
//
// Sample times. E1a records the carrier every field tick (`EMERGENT.dt`), and
// every defender every `EMERGENT.pathEvery` ticks, while he is free (a pinned
// man is not recorded: the field has him on a block). The recording carries no
// timestamps, so the animation derives them:
//   • if a man's samples fill every recording tick of the play, he was free
//     from the snap to the end and his sample k is at tick k (exact);
//   • otherwise his samples are end-anchored to the play's own last recording
//     tick — exact for a man who came free off a block and was free to the end
//     (the man who makes the tackle always is), and his bridge from where the
//     formation placed him then covers exactly the stretch he was blocked, at
//     the pace of a blocked man. A man whose recording stops well short of the
//     play's end (blocked through the whistle) is left to the live field, which
//     draws that block as today.
// Everything here is pure arithmetic on the Play's own recording: no rng, no
// DOM, no engine state. `E1C.on` then decides whether the animation uses it.
// ─────────────────────────────────────────────────────────────────────────────

import type { Play } from '../game/engine/playsim'
import { EMERGENT } from '../game/engine/emergent'
import type { LPt } from '../game/engine/liveField'
import type { Pace } from '../game/engine/pace'

export interface Pt {
  x: number
  y: number
}

/** The part of a playAnim Mover this module reads and writes (no import cycle). */
export interface AnimMv {
  t: number
  x: number
  y: number
  lastStop: boolean
  inHeading?: Pt
  path: { t: number; x: number; y: number }[]
}

/** One recorded man: his samples (anim frame) and the tick cadence E1 recorded. */
export interface RecMan {
  id: string
  pts: Pt[]
  /** The recording tick of his first sample (0 for the carrier). */
  firstTick: number
  /** Ticks between his samples (1 for the carrier, `pathEvery` for a defender). */
  dTick: number
}

export interface RecField {
  carryId: string
  /** The carrier's recorded path: sample k at the recording's tick `firstTick + k*dTick`. */
  carry: RecMan
  /** Every other man the field recorded (the free defenders). */
  men: RecMan[]
  /** The carrier's sample count = the recording's own tick count (its clock). */
  ticks: number
}

/** Every knob E1c adds, in one place (nothing else in the animation is tuned). */
export const E1C = {
  /** OFF by default: the animation choreographs exactly as it did before. */
  on: false,
  /**
   * How far the recorded stop may sit from the sim's recorded spot and still be
   * drawn. A tackle lands on the field's stop and the sim's yards are that gain
   * blended toward the calibrated anchor, so the two agree within a couple of
   * yards by construction; the pile drive covers the difference. A fumble or the
   * `maxT` tail fallback can spot the ball away from where the field stopped —
   * those keep today's choreography (counted in `E1C_STAT.fallback`).
   */
  maxFix: 4,
  /**
   * How much of the play a man's recording may miss (s) before he is left to the
   * live field: a man whose last sample sits this far short of the play's end was
   * on a block through the whistle, and the field draws that better than a
   * recording that has no pinned stretch in it.
   */
  maxGap: 0.6,
  /** The bridge from a man's alignment to his first recorded sample is capped at
   *  his own pace (a recording that would need more is not drawn as a jump: the
   *  field's own spot is used instead — its front lines up differently from the
   *  animation's four-man table). */
  bridgeTol: 1.15,
  /** How far the recorded credited tackler may be from the carrier at the field's
   *  stop and still be drawn riding him: a tackle by contact is well inside this,
   *  an aim-stop that credited the nearest man (nobody touched him) is not, and
   *  falls back to the animation's own chase (a man who can really get there). */
  contactGap: 1.6,
  /**
   * How close the field's own nearest man must be to the recorded carrier at the
   * recording's last tick for the recording to be drawable as a tackle. The
   * field ends a play either with a man on the ball (a real tackle) or by its own
   * aim rule, and an aim-stop's recorded geometry has every man far away (the
   * emere1c r8b/r8b-near probes: the carrier stood at the spot while the field's
   * whole pursuit finished 8 to 23 yd upfield).
   *
   * The field samples its men every `EMERGENT.pathEvery` ticks (~0.4 s), so the
   * man who really made the tackle reads 1-4 yd from the carrier's stop in the
   * emere1c-near histogram (n 375 in-bounds runs: 89 in 1-2 yd, 94 in 2-3, 114 in
   * 3-4, then 8 in 4-6, 8 in 8-12, 9 over 12). 8 yd is therefore well clear of
   * every sampled tackle and only the aim stops are refused.
   */
  aimStop: 8,
  /**
   * How close an out-of-bounds recording's own stop must be to a sideline for it
   * to be drawn. The field's out-of-bounds end is its own forced-out roll (a man
   * within 2 yd and the carrier > `oobFrom` yards off centre), not the chalk: the
   * recorded carrier runs a straight line ~7 yd off centre and is ruled out, so
   * drawing it would shove him ~19 yd sideways to reach the line (the "runs
   * sideways" the animflow r8 band bounds). The field never reaches the wall
   * except on a run that drifts to it (the y ≈ 1 / 52.3 stops, `outsideDrift`):
   * those are real sideline ends and are drawn.
   */
  oobMargin: 6,
}

interface MutableE1C { on: boolean }
const CFG = E1C as unknown as MutableE1C

/** E1c: draw the recorded field (default OFF — the OFF path is today's drawing). */
export function setEmergentE1c(on: boolean): void {
  CFG.on = on
}
/** E1c: read the toggle so a probe can restore it exactly. */
export function getEmergentE1c(): boolean {
  return CFG.on
}

/** Dev accumulator (read by the E1c verify script; never by the sim). */
export const E1C_STAT = {
  plays: 0,
  /** Plays whose recorded carrier could not be mapped to a dot (old save shape). */
  fallback: 0,
  /** Recorded men actually drawn from the recording. */
  men: 0,
  /** Recorded men left to the live field (their recording misses the play's end). */
  menSkipped: 0,
  /** Men the play's own read names (the read key and the biters): the field
   *  records bodies, not the fake, so the animation's own J8a2 read/bite
   *  choreography draws them (see playAnim.e1cPlan). */
  readSkipped: 0,
  /** Recordings the module refused to draw: the field's own stop is not the
   *  tackle/sideline the sim recorded (an aim stop with no man on the ball, an
   *  out-of-bounds stop at the numbers), so the animation's own drawing makes the
   *  play. */
  aimStop: 0,
  /** Plays whose motion the field does not model at all — a JET's pre-snap run
   *  across the formation is animation-side choreography (r8 J38) and the
   *  recording only starts at the snap, so those keep today's drawing. */
  presnap: 0,
  /** Men drawn whose bridge from their alignment needs more than their pace
   *  (the field's own spot is used instead). */
  bridge: 0,
  /** Credited tackles the recording does not support (an aim-stop credited the
   *  nearest man): drawn by the animation's own chase, as today. */
  chased: 0,
  /**
   * The dots drawn away from their recording on the current play (reset at the
   * top of every play): a recorded man the animation had to move to make the
   * play the field's own record does not show — the credited man the field's aim
   * named while nobody was on the ball. Read by the E1c check so the exception is
   * exact and reported, never a blanket allowance.
   */
  chaseKeys: [] as string[],
  /** The dots the module drew from the recording on the current play (reset per
   *  play, like `chaseKeys`): the men whose drawn path IS their recording. A man
   *  the module did not put here is the live field's drawing. */
  drewKeys: [] as string[],
  /**
   * Whether the play just planned was drawn from its recording (set by
   * `e1cPlan`). The E1c check measures exactly those plays and no others.
   */
  lastDrawn: false,
}

/** The animation's own-goal offset: engine x → animation x. */
export const ANIM_X0 = 10
/** The recorded clock: one sample per emergent field tick (see `EMERGENT.dt`). */
export const REC_DT = EMERGENT.dt

function recMan(id: string, p: LPt[], firstTick: number, dTick: number): RecMan {
  return { id, firstTick, dTick, pts: p.map((q) => ({ x: q.x + ANIM_X0, y: q.y })) }
}

/**
 * The recorded field of a play, in the animation's frame, or null when there is
 * none (E1c off, an old save, a kick, a pass with no after-catch segment).
 *
 * The recordings ride on the play record itself: `resolveRun`/`resolveYac` put
 * them on the `PlayOutcome` and `applyScrimmageOutcome` spreads that outcome
 * into the saved `Play` (playsim.ts), so they are on the object the animation is
 * handed. They are read structurally here because `Play`'s own declaration does
 * not carry them yet (the one leftover from E1a's engine hook — see this job's
 * verify file); an old save simply has neither field.
 */
export function recordedField(play: Play): RecField | null {
  if (!CFG.on) return null
  const p = play as unknown as { carryPath?: LPt[]; fieldPaths?: Record<string, LPt[]> }
  const cp = p.carryPath
  if (!cp || cp.length < 2) return null
  const carry = recMan(play.carrierId ?? '', cp, 0, 1)
  const men: RecMan[] = []
  const fp = p.fieldPaths
  if (fp) {
    for (const id of Object.keys(fp)) {
      if (id === carry.id) continue
      const q = fp[id]
      if (q && q.length) men.push(recMan(id, q, EMERGENT.pathEvery, EMERGENT.pathEvery))
    }
  }
  return { carryId: carry.id, carry, men, ticks: carry.pts.length }
}

/**
 * Whether a man's samples fill every recording tick of the play (he was free
 * from the snap: his recording starts where the formation put him).
 */
export function recFillsAll(man: RecMan, ticks: number): boolean {
  const last = ticks - 1
  const step = Math.max(1, Math.round(man.dTick))
  const first = Math.min(man.firstTick, last)
  const slots = Math.floor(Math.max(0, last - first) / step) + 1
  return man.pts.length >= slots
}

/**
 * The recording tick of every sample of a man, derived from the play's own tick
 * count (see the header): the samples fill every tick ⇒ exact from the first,
 * otherwise they are end-anchored to the play's last recording tick.
 */
export function recTicks(man: RecMan, ticks: number): number[] {
  const last = ticks - 1
  const step = Math.max(1, Math.round(man.dTick))
  const first = Math.min(man.firstTick, last)
  const slots = Math.floor(Math.max(0, last - first) / step) + 1
  const off = man.pts.length >= slots ? first : Math.max(first, last - (man.pts.length - 1) * step)
  const out: number[] = []
  for (let k = 0; k < man.pts.length; k++) out.push(off + k * step)
  return out
}

/** The animation-clock time of each of a man's samples. */
export function recTimes(man: RecMan, ticks: number, t0: number): number[] {
  return recTicks(man, ticks).map((tick) => t0 + tick * EMERGENT.dt)
}

/** The animation-clock time of a man's first sample. */
export function recFirstT(man: RecMan, ticks: number, t0: number, clock?: (tick: number) => number): number {
  return (clock ?? ((tick: number) => t0 + tick * EMERGENT.dt))(recTicks(man, ticks)[0])
}

/** The animation-clock time of a man's last sample. */
export function recEndT(man: RecMan, ticks: number, t0: number, clock?: (tick: number) => number): number {
  const tk = recTicks(man, ticks)
  return (clock ?? ((tick: number) => t0 + tick * EMERGENT.dt))(tk[tk.length - 1])
}

/**
 * E1c: the animation's clock for the recording. The recording carries no
 * timestamps ("sample k was at the field's tick k"), and the animation DERIVES
 * them — not from the raw tick, which starts a carry at full pace (a jump the
 * live camera cannot follow, and a stride faster than the man's own), but from
 * the carrier's own stride: the recorded legs timed with his top speed and
 * acceleration (the ONE speed model). The shape is the field's; the clock is
 * the animation's, so no drawn leg is a jump and no man outruns a real stride.
 * Returns the animation time of every recorded sample.
 */
export function recClock(pts: Pt[], pace: Pace, secPerSample: number, v0: number, t0: number): number[] {
  const top = Math.max(1.5, pace.top)
  const acc = Math.max(0.8, pace.acc)
  const times: number[] = [t0]
  let v = Math.max(0, Math.min(v0, top))
  let t = t0
  for (let k = 1; k < pts.length; k++) {
    const L = Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y)
    if (L < 1e-6) {
      times.push(t)
      continue
    }
    const vt = Math.min(top, Math.max(0.15, L / Math.max(1e-3, secPerSample)))
    let dtl: number
    if (vt > v) {
      const dAcc = (vt * vt - v * v) / (2 * acc)
      if (dAcc >= L) {
        const vEnd = Math.sqrt(v * v + 2 * acc * L)
        dtl = (vEnd - v) / acc
        v = vEnd
      } else {
        dtl = (vt - v) / acc + (L - dAcc) / vt
        v = vt
      }
    } else if (vt < v) {
      const dDec = (v * v - vt * vt) / (2 * acc)
      if (dDec >= L) {
        const vEnd = Math.sqrt(Math.max(0, v * v - 2 * acc * L))
        dtl = (v - vEnd) / acc
        v = vEnd
      } else {
        dtl = (v - vt) / acc + (L - dDec) / vt
        v = vt
      }
    } else {
      dtl = L / Math.max(0.15, v)
    }
    // The animation's clock never runs FASTER than the field's own tick: a leg
    // the recording covers in one tick takes at least that tick. Every man
    // sharing the clock is therefore never drawn faster than the field ran him
    // (a flag at the far side of a compressed interval was drawn at 60 yd/s).
    t += Math.max(dtl, secPerSample)
    times.push(t)
  }
  return times
}

/**
 * The animation time of a recording tick, from the clock table: linear between
 * samples, the ends projected by the neighbouring stride (a man's samples sit on
 * the carrier's own table, so the tick-to-tick geometry of the recording is
 * preserved exactly — everyone was where the field had him at every tick).
 */
export function clockOf(table: number[], tick: number): number {
  if (!table.length) return 0
  if (table.length < 2) return table[0]
  const last = table.length - 1
  if (tick <= 0) return table[0] + tick * (table[1] - table[0])
  if (tick >= last) return table[last] + (tick - last) * (table[last] - table[last - 1])
  const i = Math.floor(tick)
  const u = tick - i
  return table[i] + (table[i + 1] - table[i]) * u
}

/** The recording tick at which the carrier first crosses `x` (anim frame), or -1. */
export function recCrossTick(man: RecMan, ticks: number, x: number): number {
  const tk = recTicks(man, ticks)
  for (let k = 0; k < man.pts.length; k++) if (man.pts[k].x >= x) return tk[k]
  return -1
}

/** The speed (yd/s) a man carries out of his last recorded samples. */
export function recExitSpeed(man: RecMan): number {
  const dt = man.dTick * EMERGENT.dt
  const n = Math.min(4, man.pts.length - 1)
  if (n < 1 || dt <= 0) return 0
  let d = 0
  for (let k = man.pts.length - n; k < man.pts.length; k++) {
    d += Math.hypot(man.pts[k].x - man.pts[k - 1].x, man.pts[k].y - man.pts[k - 1].y)
  }
  return d / (n * dt)
}

function posAtPath(path: { t: number; x: number; y: number }[], t: number): Pt {
  if (!path.length) return { x: 0, y: 0 }
  if (t <= path[0].t) return { x: path[0].x, y: path[0].y }
  for (let i = 1; i < path.length; i++) {
    const b = path[i]
    if (t <= b.t) {
      const a = path[i - 1]
      const span = b.t - a.t
      const u = span <= 0 ? 1 : (t - a.t) / span
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
    }
  }
  const l = path[path.length - 1]
  return { x: l.x, y: l.y }
}

/** Cut a mover's timeline at `t` (his position at `t` becomes the last knot). */
function cutAt(mv: AnimMv, t: number): void {
  const p = posAtPath(mv.path, t)
  mv.path = mv.path.filter((w) => w.t < t - 1e-9)
  mv.path.push({ t, x: p.x, y: p.y })
  mv.t = t
  mv.x = p.x
  mv.y = p.y
}

/**
 * Draw a recorded path onto a mover's timeline: sample k plays at the animation
 * clock time of its recording tick (`clock`, the animation's own derived clock —
 * see `recClock`). `truncateAt` cuts an existing timeline first (a pass: the
 * coverage / route before the catch stays, the segment after it is the
 * recording). Returns the mover's new end time.
 */
export function drawRecorded(mv: AnimMv, man: RecMan, ticks: number, t0: number, truncateAt?: number, clock?: (tick: number) => number): number {
  if (truncateAt != null && mv.t > truncateAt + 1e-9) cutAt(mv, truncateAt)
  const at = clock ?? ((tick: number) => t0 + tick * EMERGENT.dt)
  const tk = recTicks(man, ticks)
  for (let k = 0; k < man.pts.length; k++) {
    const t = at(tk[k])
    if (t < mv.t - 1e-9) continue
    if (t <= mv.t + 1e-9 && mv.path.length) {
      // landing exactly on the cut that owns the timeline (a `truncateAt` seam):
      // take the recorded spot over the drawn one, so the recording is the path
      // at that instant and the polyline stays strictly increasing in time.
      const l = mv.path[mv.path.length - 1]
      l.x = man.pts[k].x
      l.y = man.pts[k].y
      continue
    }
    mv.path.push({ t, x: man.pts[k].x, y: man.pts[k].y })
  }
  const w = mv.path[mv.path.length - 1]
  mv.t = w.t
  mv.x = w.x
  mv.y = w.y
  mv.lastStop = false
  mv.inHeading = undefined
  return mv.t
}

/**
 * Extend a drawn recorded path to the whistle at the man's own pace, in the
 * stride he carried out of his last recorded samples. Used instead of a seeking
 * settle: a settle would brake him and run him yards past the stop (the speed
 * of a recorded leg is a real stride, and v^2/2a is a long way at 8 yd/s), which
 * both moves a recorded man off his recording and spikes his drawn pace. A man
 * already stopped (or one whose recording ends at the play's end) simply holds.
 */
export function carryOn(mv: AnimMv, t: number, cap: number): void {
  if (mv.t >= t - 1e-6) { mv.lastStop = true; return }
  const n = mv.path.length
  const gap = t - mv.t
  if (n >= 2 && gap < 1.5) {
    const a = mv.path[n - 2]
    const b = mv.path[n - 1]
    const dt = b.t - a.t
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    const v = dt > 1e-6 ? Math.min(d / dt, cap) : 0
    if (v > 0.2 && d > 1e-6) {
      const x = Math.max(1, Math.min(119, b.x + ((b.x - a.x) / d) * v * gap))
      const y = Math.max(1.2, Math.min(52.1, b.y + ((b.y - a.y) / d) * v * gap))
      mv.path.push({ t, x, y })
      mv.t = t
      mv.x = x
      mv.y = y
      mv.lastStop = true
      return
    }
  }
  mv.path.push({ t, x: mv.x, y: mv.y })
  mv.t = t
  mv.lastStop = true
}

/**
 * How far a recorded polyline deviates from a drawn one at the recorded sample
 * times (yd) — used by the verify script to hold the drawing to the recording.
 */
export function recDeviation(man: RecMan, ticks: number, t0: number, at: (t: number) => Pt): { n: number; max: number } {
  const tk = recTicks(man, ticks)
  let max = 0
  for (let k = 0; k < man.pts.length; k++) {
    const p = at(t0 + tk[k] * EMERGENT.dt)
    max = Math.max(max, Math.hypot(p.x - man.pts[k].x, p.y - man.pts[k].y))
  }
  return { n: man.pts.length, max }
}

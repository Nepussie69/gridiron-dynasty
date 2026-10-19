// ─────────────────────────────────────────────────────────────────────────────
// E1b (FUTURES #54) — YARDS AFTER THE CATCH decided on the pursuit field.
//
// Today `resolvePass`, after a completion, draws a yardage bucket from a real NFL
// CDF and then *names* the man who stops it (`passTackler`), trims the gain by his
// TAK (`tacklerYacShrink`), rolls one hash miss and hash-decides out of bounds.
// The yards come first; the men explain them afterwards.
//
// E1b inverts that one segment: the receiver catches the ball at the catch point
// (the LOS + the air yards the pass path already computed) carrying the velocity
// of his route, and then the SPECIFIC men on the play decide the rest —
//   • the receiver runs on his own pace (`paceFor` + his own `fatiguePace`, the
//     one speed model) lifted by his own open-field edge (SpeedGap's own pure mph
//     function, passed in — the speed math is never duplicated);
//   • the covering defender starts where the coverage had him at the catch (the
//     recorded separation the pass path computed — E2's own field value when E2
//     is on, the J7 separation otherwise) and the help safety / linebackers /
//     corners start on their own coverage landmarks; every man pursues on a real
//     intercept angle whose lead comes from his OWN AWR/PUR (a poor read
//     undercuts, a good one takes the true line);
//   • a free defender who closes to `contactR` makes the tackle attempt through
//     the engine's own `tackleMissChance` (fed the real gain at that moment, not
//     a sampled one); a whiff is a hash miss the receiver runs out of with a
//     burst and the next pursuer takes over;
//   • out of bounds when he is driven/forced wide, a touchdown at the goal line,
//     and a `maxT` tail fallback so a field bug can never make a 99-yd play.
//
// SPEED. Motion is the shared `LiveField` (`engine/liveField.ts`, P0 moved it out
// of components). Every top speed / acceleration is `paceFor(p, pos)` scaled by
// `fatiguePace`; the individual open-field edge is SpeedGap's own
// `carrierOpenMph` / `pursuerOpenMph`, supplied by the resolver. No second speed
// function, no unit/roster/team average anywhere.
//
// DETERMINISM. Zero `rng()` draws are added or removed: the draws the replaced
// block made (the completion CDF sample, the two YAC style draws, the `tu` time
// draw) are still consumed in the same order by `resolvePass`; every decision
// below is `hash32`/`h01` on `${n}:${defId}:e1b:…`. `setEmergentE1b(false)` makes
// the resolver never enter this file, so the OFF path is byte-identical.
//
// CALIBRATION. Every knob lives in `EMERGENT_YAC`. The anchor is the completion
// yardage the OFF chain already produced for THIS play — the calibrated CDF plus
// the J3 air/YAC shape plus the per-man trims — and the field enters only as a
// DEVIATION of its own (air + raw) total from a measured centre, scaled by
// `deltaW`/`deltaNegW` with a flat `bias`. So the league's completion-yard
// distribution (and YPA / completion % / points) is the calibrated one by
// construction while the specific men on the play decide where in it a catch
// lands. This is deliberately the same centring `emergentRun` (E1a) uses, so the
// run and pass halves of E1 re-centre identically. When the air-coherence job
// (aircoh) lands its `gain = air + YAC` OFF model, this field inherits it for
// free, because the anchor is read live rather than from a table.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player } from '../types'
import { LiveField, type Brain, type LPt, type LiveMover } from './liveField'
import { paceFor, fatiguePace, attrOf } from './pace'
import { hash32 } from './rng'

const FH = 53.3
const MID = FH / 2
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const h01 = (key: string) => (hash32(key) >>> 0) / 4294967296
/** mph → yd/s (the open-field edge conversion). */
const MPH_YDS = 0.4889

// ── the one tunable object ───────────────────────────────────────────────────
export const EMERGENT_YAC = {
  // ON by default (emerjoint 2026-10-17): the joint calibration landed the YAC
  // field in the NFL bands. `setEmergentE1b(false)` is the dev toggle.
  on: true,
  /** Engine step (s) — the shared LiveField step. */
  dt: 0.05,
  /** Tail fallback: after this long nobody reached — resolve as a run-down. */
  maxT: 4.5,
  /** A free defender inside this distance of the receiver makes the attempt. */
  contactR: 1.7,
  // ── assisted tackles (bookkeeping only; the yards/tackler are unchanged) ────
  /** A defender within this radius of the ball at the stop is genuinely in on the
   *  tackle (the pile) and takes the ASSIST. The SOLO is always the field's own
   *  tackler — the man the broadcast draws; the box score never relabels the stop
   *  to a man the replay does not show in contact. The radius is the pile radius:
   *  this field's own `contactR` plus the ground a pursuer covers while the pile
   *  forms (≈0.25 s at league pursuit speed) — a defender arriving as the tackle
   *  is made, never one a dozen yards away. Pick-one convention (documented in
   *  stats.ts): a gang tackle = 1 solo + 1 assist (PFR). */
  assistR: 3.0,
  /** How many extra men in the pile are credited (1 = one assist per tackle). */
  assistN: 1,
  // ── the receiver ───────────────────────────────────────────────────────────
  /** The receiver's own open-field edge (SpeedGap mph) → yd/s of top speed. */
  edgeW: 0.30,
  /** The fraction of his top speed the receiver carries at the catch (he is
   *  gathering the ball: the burst back up to speed is what the pursuers race). */
  catchVel: 0.5,
  /** A broken tackle is a burst (a multiplier on his top speed). */
  burstW: 1.20,
  burstMax: 1.35,
  burstAdd: 0.2,

  // ── the pursuit ────────────────────────────────────────────────────────────
  /** Intercept lead (AWR/PUR take the true angle; a poor read undercuts). */
  pursuitLead: 0.82,
  leadAwrW: 0.0032,
  leadPurW: 0.0022,
  leadLo: 0.5,
  leadHi: 0.95,
  /** A defender's own pursuit edge (SpeedGap `pursuerOpenMph`) → yd/s. */
  defEdgeW: 0.26,
  /** A flat multiplier on every pursuer's top speed (a tackler takes the angle
   *  and arrives at full flight; the carry slows the man with the ball). */
  pursuitBoost: 1.0,
  /** The ball-carrier's own top-speed multiplier while he carries it. */
  carryTop: 0.72,
  /** The flat multiplier on a pursuer's speed inside the compressed goal-line
   *  zone (the extra defender the end zone provides — holds the TD rate on the
   *  calibrated level without touching the rest of the field). */
  glZone: 11,
  glBoost: 1.30,
  /** Red-zone compression (rzcompress): the end line limits the field, so the
   *  pursuers sit between the receiver and the goal. `c` rises from 0 at `rzZone` yd
   *  out to 1 at `rzFull` yd; a non-cover defender starts at least `c * rzSit * AWR
   *  factor` yd downfield (never past the goal line) and `c * rzNarrow` of his lateral
   *  gap is squeezed out. Geometry + the man's own AWR; no rng draw. */
  rzZone: 17,
  rzFull: 5,
  rzSit: 3.0,
  rzAwrW: 0.012,
  rzNarrow: 0.3,
  /** The coverage velocity every defender carries into the segment. */
  covVel: 0.9,
  /** Pursuit aim is projected this far so `steer` never brakes into it (yd). */
  farAim: 28,

  // ── the starting geometry (the coverage alignment at the catch) ────────────
  /** The covering defender starts `sepYd + coverGap` behind, mostly behind the
   *  receiver (he was beaten to the catch point and has to close). */
  coverBehind: 0.62,
  coverGap: 2.2,
  minSep: 0.55,
  maxSep: 22,
  /** Help safety / linebackers / corners: their own landmarks from the catch. */
  helpDepth: 6,
  helpWide: 7,
  lbDepth: 2.2,
  lbWide: 6,
  safDepth: 9,
  safWide: 9,
  cbDepth: -1.4,
  cbWide: 9.0,
  /** A man further than this from the catch cannot reach the play. */
  maxReach: 26,

  // ── the tackle attempt ─────────────────────────────────────────────────────
  maxMiss: 1,
  missRecover: 0.6,
  missPush: 0.35,
  juke: 1.1,
  /** A hit at the catch (inside this time) can lose a yard, rarely. */
  negT: 0.12,
  negP: 0.012,

  // ── out of bounds (forced/driven wide — the base engine's own idea) ────────
  oobFrom: 12,
  oobW: 0.02,
  oobMax: 0.3,
  /** A forced out of bounds is a SIDELINE end: the carrier has to be this close
   *  (yd) to the chalk. The animation draws the field's recording only when the
   *  recorded stop is at the sideline (E1C.oobMargin, 6); further inside it falls
   *  back to its own choreography, which cannot draw a forcer who is really there
   *  (check-broadcast r8, backlog 354/373). See EMERGENT.oobRail. */
  oobRail: 6,
  /** Physical edge (the field clamps y to ~0.8/52.5, so this is the hard rail). */
  oobTight: 0.85,

  // ── the tail fallback (nobody reached): a run-down, not a 99-yard play ─────
  tailLo: 0.6,
  tailHi: 0.95,

  // ── centring: the calibrated completion + the field's own deviation ────────
  // The anchor is the completion yardage the OFF chain already produced for THIS
  // play (the calibrated CDF + the J3 air/YAC reshape + the per-man trims). The
  // field's own yardage enters only as a DEVIATION from its measured centre, so
  // the league mean, the completion-yard distribution and every band hold by
  // construction while the specific men on the play move the yards. This is the
  // same centring `emergentRun` uses on the run side (one design, both phases).
  /** How much of the field's own deviation reaches the yards (the spread knob). */
  deltaW: 1.0,
  /** The same on the short side (a play the field stops short is only nudged). */
  deltaNegW: 1.0,
  /** A flat yards shift after the deviation (the one mean knob). It absorbs the
   *  line-to-gain guard's own mean contribution, so the emitted mean still equals
   *  the calibrated anchor's. */
  bias: -0.15,
  /** A small per-position trim (a probe re-centres each position). */
  posBias: { WR: 0, TE: 0, RB: 0, FB: 0, QB: 0, default: 0 } as Record<string, number>,
  /** Measured E[air + raw field YAC] per `${pos}|${bucket}` — the centre of the
   *  deviation (measured by the ON panel, `YAC_STAT.byCell`; see the E1b probe).
   *  With centre = E[fieldTotal] the emitted mean is the calibrated anchor's, so
   *  the league's completion-yard distribution holds by construction. */
  centre: {
    'WR|behind': 5.64, 'WR|0-5': 9.24, 'WR|5-10': 13.58, 'WR|10-20': 19.00, 'WR|20+': 32.02,
    'TE|behind': 4.14, 'TE|0-5': 6.90, 'TE|5-10': 11.31, 'TE|10-20': 16.46, 'TE|20+': 28.77,
    'RB|behind': 6.81, 'RB|0-5': 11.64, 'RB|5-10': 13.0, 'RB|10-20': 14.5, 'RB|20+': 20.0,
  } as Record<string, number>,
  centreFallback: 14.33,
  /** The emitted completion total is clamped like the OFF path's own clamp. */
  totalLo: -8,
  totalHi: 98,
  /** The hash-gated share of the field's OWN end-zone arrivals that become a
   *  score (the calibrated anchor's scores always stand). At 0 the league TD rate
   *  is exactly the calibrated one; the joint calibration may open it. */
  tdGate: 0,
  /** The line-to-gain guard (the same principle as SpeedGap's `guardMarker`): on a
   *  money down the field may shorten a gain, but it may never take away a first
   *  down the calibrated anchor already made. The shifted value passes through the
   *  centre afterwards, so the league mean still holds. */
  moneyGuard: 1,
}

export function setEmergentE1b(on: boolean): void {
  EMERGENT_YAC.on = on
}
export function getEmergentE1b(): boolean {
  return EMERGENT_YAC.on
}

// ── measurement (a probe turns it on; the sim never reads it) ────────────────
interface OffCell { n: number; sumTotal: number; sumAir: number; sumYac: number }
interface FieldCell { n: number; sumRaw: number; sumField: number; sumYac: number }
export const YAC_STAT = {
  on: false,
  n: 0,
  sumRaw: 0,
  sumField: 0,
  sumYac: 0,
  sumAnchor: 0,
  sumEmitted: 0,
  raw: [] as number[],
  byBucket: {} as Record<string, FieldCell>,
  byPos: {} as Record<string, FieldCell>,
  byCell: {} as Record<string, FieldCell>,
  /** The OFF model's own completion totals for the same plays (the anchor). */
  off: {
    n: 0,
    sumTotal: 0,
    sumAir: 0,
    sumYac: 0,
    byBucket: {} as Record<string, OffCell>,
    byPos: {} as Record<string, OffCell>,
    byCell: {} as Record<string, { n: number; sumTotal: number; sumAir: number; sumYac: number }>,
    ge10: 0,
    neg: 0,
    td: 0,
    oobish: 0,
  },
  miss: 0,
  oob: 0,
  td: 0,
  ge10: 0,
  neg: 0,
}

/** Called by `resolvePass` on every completion BEFORE the E1b swap, so a probe can
 *  see the OFF model's own per-bucket total/air/YAC from the exact same plays. */
export function statOff(air: number, total: number, pos: string | undefined, yard: number): void {
  if (!YAC_STAT.on) return
  const o = YAC_STAT.off
  const a = clamp(air, -5, 100)
  const yac = total - a
  o.n++
  o.sumTotal += total
  o.sumAir += a
  o.sumYac += yac
  const bk = bucketOf(a)
  const bb = (o.byBucket[bk] ??= { n: 0, sumTotal: 0, sumAir: 0, sumYac: 0 })
  bb.n++; bb.sumTotal += total; bb.sumAir += a; bb.sumYac += yac
  const pp = pos ?? '?'
  const bp = (o.byPos[pp] ??= { n: 0, sumTotal: 0, sumAir: 0, sumYac: 0 })
  bp.n++; bp.sumTotal += total; bp.sumAir += a; bp.sumYac += yac
  const bc = (o.byCell[`${pp}|${bk}`] ??= { n: 0, sumTotal: 0, sumAir: 0, sumYac: 0 })
  bc.n++; bc.sumTotal += total; bc.sumAir += a; bc.sumYac += yac
  if (yac >= 10) o.ge10++
  if (yac < 0) o.neg++
  if (yard + total >= 100) o.td++
}

export interface YacStyle {
  yacBias: number
  elusiveness: number
}

export interface YacInput {
  n: number
  offId: string
  defId: string
  /** The man who caught it (the sim's target). */
  carrier: Player | undefined
  carrierStyle: YacStyle
  /** The assigned cover man at the catch, and the help safety over the top. */
  cover: Player | undefined
  help: Player | undefined
  saf: Player[]
  lbs: Player[]
  cbs: Player[]
  /** The offence's own yard line (LOS) and the emitted air yards of the catch. */
  yard: number
  passAir: number
  /** Down and distance to go (the line-to-gain guard; 0/0 when unknown). */
  down?: number
  dist?: number
  /** The calibrated completion yardage the OFF chain already produced for this
   *  exact play (the anchor the field deviates from). */
  anchor: number
  conceptDepth: number
  conceptYac: number
  /** The recorded separation at the catch (E2's own field value when E2 is on). */
  sepYd: number
  coverTag: string | undefined
  manCoverage: number
  fat: Record<string, number> | undefined
  /** The carrier's own open-field edge (mph) — SpeedGap's `carrierOpenMph`. */
  carrierOpen: number
  /** A defender's own open-field pursuit edge (mph) — SpeedGap's `pursuerOpenMph`. */
  pursuerOpen: (p: Player) => number
  /** The engine's own missed-tackle chance for this carrier (never re-derived). */
  missChance: (def: Player, relGain: number) => number
}

export interface YacResult {
  /** The emitted YAC (yards) — `resolvePass` emits `air + yac` = the field total. */
  yac: number
  /** The raw field yardage (pre-centring), for the probe. */
  raw: number
  bucket: string
  tacklerId?: string
  /** The men in on the stop besides the tackler (nearest first) — assists. */
  assistIds?: string[]
  missedTackleIds: string[]
  forcedMissedIds: string[]
  outOfBounds: boolean
  scorerId?: string
  carryPath: LPt[]
  fieldPaths: Record<string, LPt[]>
}

// ── helpers ──────────────────────────────────────────────────────────────────
const bucketOf = (air: number): string => (air < 0 ? 'behind' : air < 5 ? '0-5' : air < 10 ? '5-10' : air < 20 ? '10-20' : '20+')

function mover(key: string, x: number, y: number, pace: { top: number; acc: number }, player?: Player): LiveMover {
  return { key, t: 0, x, y, path: [{ t: 0, x, y }], pace, lastStop: false, player }
}

interface Def {
  p: Player
  key: string
  x: number
  y: number
  top: number
  acc: number
  lead: number
}

/** Solve the intercept: the earliest time at which a man of speed `ds` can get
 *  within `R` of a carrier at (cx,cy) moving (vx,vy). Null when he cannot. */
function interceptT(cx: number, cy: number, vx: number, vy: number, mx: number, my: number, ds: number, R: number): number | null {
  const ax = cx - mx
  const ay = cy - my
  const vv = vx * vx + vy * vy
  const av = ax * vx + ay * vy
  const aa = ax * ax + ay * ay
  const A = vv - ds * ds
  const B = 2 * (av - ds * R)
  const C = aa - R * R
  if (Math.abs(A) < 1e-6) {
    if (Math.abs(B) < 1e-9) return null
    const t = -C / B
    return t > 0 ? t : null
  }
  const disc = B * B - 4 * A * C
  if (disc < 0) return null
  const sq = Math.sqrt(disc)
  const t1 = (-B - sq) / (2 * A)
  const t2 = (-B + sq) / (2 * A)
  const lo = Math.min(t1, t2)
  const hi = Math.max(t1, t2)
  if (lo > 0) return lo
  if (hi > 0) return hi
  return null
}

/** The intercept-angle pursuit: aim where he will be when you can get there,
 *  led by your own read (AWR/PUR). A poor pursuer undercuts the angle. The aim
 *  is projected well past the target so `LiveField.steer` does not brake into it
 *  (a pursuer has no stop point; contact is decided by proximity). */
function chaseBrain(carrierKey: string, lead: number, top: number, side: number): Brain {
  return (_t, me, f) => {
    const c = f.where(carrierKey)
    if (!c) return null
    const cv = f.velOf(carrierKey)
    const dx = c.x - me.x
    const dy = c.y - me.y
    const d = Math.hypot(dx, dy)
    const R = EMERGENT_YAC.contactR
    const tInt = interceptT(c.x, c.y, cv.x, cv.y, me.x, me.y, top, R)
    const tau = clamp((tInt ?? clamp(d / Math.max(2, top), 0, 1.6)) * lead, 0, 2.4)
    const nx = -dy / (d || 1)
    const ny = dx / (d || 1)
    const tx = c.x + cv.x * tau + nx * side
    const ty = c.y + cv.y * tau + ny * side
    const ux = tx - me.x
    const uy = ty - me.y
    const ul = Math.hypot(ux, uy) || 1
    // The goal line is an extra defender: inside the compressed zone every pursuer
    // closes a step harder, so a would-be score is stood up the way the calibrated
    // path's own red-zone damping does (the rate, not the flag, is what this fixes).
    const gl = c.x >= 100 - EMERGENT_YAC.glZone ? EMERGENT_YAC.glBoost : 1
    return { x: me.x + (ux / ul) * EMERGENT_YAC.farAim, y: me.y + (uy / ul) * EMERGENT_YAC.farAim, speed: top * gl }
  }
}

/** Where the catch happens across the field (the receiver's own alignment). */
function catchY(inp: YacInput, seed: string): number {
  const u = h01(`${seed}:align`)
  const pos = inp.carrier?.pos ?? 'WR'
  if (pos === 'WR') return u < 0.5 ? 3.5 + u * 2 * 9 : 49.8 - (u - 0.5) * 2 * 9
  if (pos === 'TE') return 20 + u * 8
  if (pos === 'RB' || pos === 'FB') return 21 + u * 11
  return MID + (u - 0.5) * 12
}

/**
 * The E1b field: one catch, the men on the play, the yards they produce. Pure
 * arithmetic over the specific players' own ratings — no rng, no DOM.
 */
export function emergentYac(inp: YacInput): YacResult {
  const E = EMERGENT_YAC
  const seed = `${inp.n}:${inp.defId}:e1b`
  const carrier = inp.carrier
  const pos = carrier?.pos ?? 'WR'
  const air = clamp(inp.passAir, -5, 100)
  const x0 = clamp(inp.yard + air, 0.7, 119)
  const bucket = bucketOf(air)
  const y0 = catchY(inp, seed)

  // ── the receiver: his own pace and the velocity he carried on his route ────
  const base = paceFor(carrier, pos)
  const fatC = fatiguePace(inp.fat?.[carrier?.id ?? ''])
  const cTop = Math.max(2.5, (base.top * fatC.top + inp.carrierOpen * MPH_YDS * E.edgeW) * E.carryTop)
  const cAcc = base.acc * fatC.acc
  const aimY = clamp(y0 + (h01(`${seed}:drift`) - 0.5) * 1.6, E.oobTight + 0.2, FH - E.oobTight - 0.2)
  let top = cTop

  // ── the defenders: where the coverage had them at the catch ────────────────
  const defs: Def[] = []
  const seen = new Set<string>()
  const addDef = (p: Player | undefined, key: string, dx: number, dy: number) => {
    if (!p || seen.has(p.id)) return
    let ddx = dx
    let ddy = dy
    const toGoal = 100 - x0
    if (key !== 'cov' && E.rzSit > 0 && toGoal > 0 && toGoal < E.rzZone) {
      const c = clamp((E.rzZone - toGoal) / (E.rzZone - E.rzFull), 0, 1)
      ddx = Math.max(dx, Math.min(toGoal, c * E.rzSit * clamp(1 + (attrOf(p!, 'AWR') - 70) * E.rzAwrW, 0.6, 1.4)))
      ddy = dy * (1 - c * E.rzNarrow)
    }
    const px = clamp(x0 + ddx, 0.6, 119.4)
    const py = clamp(y0 + ddy, 0.8, FH - 0.8)
    if (Math.hypot(px - x0, py - y0) > E.maxReach) return
    seen.add(p.id)
    const pace = paceFor(p, p.pos)
    const fat = fatiguePace(inp.fat?.[p.id])
    const top2 = Math.max(2.5, (pace.top * fat.top + inp.pursuerOpen(p) * MPH_YDS * E.defEdgeW) * E.pursuitBoost)
    const lead = clamp(E.pursuitLead + (attrOf(p, 'AWR') - 70) * E.leadAwrW + (attrOf(p, 'PUR') - 70) * E.leadPurW, E.leadLo, E.leadHi)
    defs.push({ p, key, x: px, y: py, top: top2, acc: pace.acc * fat.acc, lead })
  }
  const sep = clamp(inp.sepYd, E.minSep, E.maxSep) + E.coverGap
  const cside = hash32(`${seed}:cside`) % 2 ? 1 : -1
  addDef(inp.cover, 'cov', -sep * E.coverBehind, cside * sep * Math.sqrt(Math.max(0, 1 - E.coverBehind * E.coverBehind)))
  addDef(inp.help, 'hlp', E.helpDepth, (y0 < MID ? 1 : -1) * -E.helpWide)
  inp.saf.slice(0, 2).forEach((p, i) => addDef(p, `saf${i}`, E.safDepth + i * 1.6, (i % 2 ? 1 : -1) * (E.safWide + i * 2.2)))
  inp.lbs.slice(0, 2).forEach((p, i) => addDef(p, `lb${i}`, E.lbDepth + i * 1.1, (i % 2 ? 1 : -1) * (E.lbWide + i * 1.4)))
  inp.cbs.slice(0, 1).forEach((p, i) => addDef(p, `cb${i}`, E.cbDepth - i * 1.2, (y0 < MID ? -1 : 1) * E.cbWide))

  // ── the field ───────────────────────────────────────────────────────────────
  const field = new LiveField(0, { plan: () => ({ drive: () => ({ x: 0, y: 0 }), shedAt: 1e9 }) })
  const carrierKey = 'carr'
  const cA = field.add(mover(carrierKey, x0, y0, { top, acc: cAcc }, carrier), 'off', (_t, me) => {
    // Downfield to the goal line; projected far so `steer` never brakes into it.
    const ux = 105 - me.x
    const uy = aimY - me.y
    const ul = Math.hypot(ux, uy) || 1
    return { x: me.x + (ux / ul) * E.farAim, y: me.y + (uy / ul) * E.farAim, speed: top }
  })
  // He is already running when the ball arrives: his route velocity.
  cA.vx = cTop * E.catchVel
  cA.vy = (aimY - y0) * E.catchVel * 0.5
  for (const d of defs) {
    const a = field.add(mover(d.key, d.x, d.y, { top: d.top, acc: d.acc }, d.p), 'def', chaseBrain(carrierKey, d.lead, d.top, (hash32(`${seed}:${d.key}`) % 3 - 1) * 0.45))
    // In coverage he is already moving toward the receiver.
    const ux = x0 - a.x
    const uy = y0 - a.y
    const ul = Math.hypot(ux, uy) || 1
    a.vx = (ux / ul) * d.top * E.covVel
    a.vy = (uy / ul) * d.top * E.covVel
  }

  // ── run it, attempt by attempt ──────────────────────────────────────────────
  const missed: string[] = []
  const missedSet = new Set<string>()
  let missCount = 0
  let tackler: Player | undefined
  let outOfBounds = false
  let scored = false
  let contactT = -1
  /** A man who is on him at the moment the ball crosses the plane: a contested
   *  crossing is the calibrated stand-up (`tdGate`), not a clean score. */
  let contestedPlane = false
  const oobRoll = (cp: LPt): boolean => {
    // (a forced out of bounds is a sideline end - see oobRail)
    if (Math.min(cp.y, FH - cp.y) > E.oobRail) return false
    const lat = Math.abs(cp.y - MID)
    const p = clamp((lat - E.oobFrom) * E.oobW, 0, E.oobMax)
    return p > 0 && h01(`${seed}:oob`) < p
  }

  while (field.t < E.maxT - 1e-9) {
    field.run(field.t + E.dt)
    const cp = field.where(carrierKey)!
    if (cp.x >= 100 - 1e-9) {
      // The ball is over the plane: it is a score unless a defender is on him
      // right there (the crossing is checked before the attempt below, so the man
      // who is touching him at the line is read here).
      const at = nearest(field, defs, cp, field.t)
      contestedPlane = !!at && at.dist <= E.contactR
      scored = true
      break
    }
    if (cp.y <= E.oobTight || cp.y >= FH - E.oobTight) { outOfBounds = true; break }
    const cand = nearest(field, defs, cp, field.t)
    if (!cand || cand.dist > E.contactR) continue
    const relGain = Math.max(0, cp.x - x0)
    const ux = (cp.x - cand.a.x) / (cand.dist || 1)
    const uy = (cp.y - cand.a.y) / (cand.dist || 1)
    if (missCount < E.maxMiss && h01(`${seed}:miss:${cand.d.p.id}:${missCount}`) < inp.missChance(cand.d.p, relGain)) {
      missed.push(cand.d.p.id)
      missedSet.add(cand.d.p.id)
      missCount++
      cand.a.recover = E.missRecover
      cand.a.freedAt = field.t
      cand.a.x -= ux * E.missPush
      cand.a.y -= uy * E.missPush
      top = Math.min(cTop * E.burstMax, top * E.burstW + E.burstAdd)
    } else if (oobRoll(cp)) {
      outOfBounds = true
      tackler = cand.d.p
      break
    } else {
      tackler = cand.d.p
      contactT = field.t
      break
    }
  }

  // ── the raw field yardage (pre-centring) ────────────────────────────────────
  let raw: number
  const cpEnd = field.where(carrierKey)!
  if (scored) raw = 100 - x0
  else {
    raw = Math.max(0, cpEnd.x - x0)
    if (contactT < 0 && !outOfBounds && field.t >= E.maxT - 1e-9) {
      // Nobody reached him inside maxT. Capping the runaway at his own gain is
      // right in the open field, but it may never end a play short of the goal
      // when no defender can reach him before he crosses: the ball is over the
      // plane. (The same intercept solve the pursuit itself uses — a man who
      // cannot get to the carrier's line before he crosses cannot stop him.)
      const cv = field.velOf(carrierKey)
      const tGoal = Math.max(E.dt, (100 - cpEnd.x) / Math.max(0.5, cv.x))
      let reaches = false
      for (const d of defs) {
        const a = field.agents.get(d.key)
        if (!a) continue
        const tInt = interceptT(cpEnd.x, cpEnd.y, cv.x, cv.y, a.x, a.y, d.top * (cpEnd.x >= 100 - E.glZone ? E.glBoost : 1), E.contactR)
        if (tInt != null && tInt <= tGoal) { reaches = true; break }
      }
      if (cv.x > 0 && !reaches) scored = true
      else {
        // Nobody reached him inside maxT: cap the runaway at his own current gain.
        const u = h01(`${seed}:tail`)
        raw = raw * (E.tailLo + (E.tailHi - E.tailLo) * u)
        const near = nearest(field, defs, cpEnd, field.t)
        tackler = near?.d.p
        outOfBounds = cpEnd.y <= E.oobTight || cpEnd.y >= FH - E.oobTight
      }
    }
  }

  // ── the yards: the calibrated anchor plus the field's own deviation ─────────
  // The field's raw yards after the catch become a completion total (air + raw);
  // its deviation from the measured centre is what reaches the emitted yards, so
  // the league's completion-yard distribution is the calibrated one and the men
  // on the play decide where in it this catch lands.
  const fieldTotal = inp.passAir + raw
  const centre = (E.centre[`${pos}|${bucket}`] ?? E.centreFallback)
  const dev = fieldTotal - centre
  const posB = E.posBias[pos] ?? E.posBias.default
  const anchorScored = inp.yard + inp.anchor >= 100
  // The plane is a real end: a crossing no defender can contest is a score — the
  // ball was carried into the end zone, and the specific men on the play put it
  // there — whatever the calibrated anchor says. A CONTESTED crossing (a man on
  // him as he crosses: a diving goal-line tackle) is the calibrated stand-up, and
  // that share is what `tdGate` decides (at 0 the league TD rate is the anchor's).
  const fieldTd = !anchorScored && scored && (!contestedPlane || (E.tdGate > 0 && h01(`${seed}:tdgate`) < E.tdGate))
  const emittedTd = anchorScored || fieldTd
  let total: number
  if (anchorScored)
    total = Math.max(100 - inp.yard, Math.round(inp.anchor + (dev >= 0 ? E.deltaW : E.deltaNegW) * dev + E.bias + posB))
  else if (fieldTd) total = 100 - inp.yard
  else {
    total = Math.round(inp.anchor + (dev >= 0 ? E.deltaW : E.deltaNegW) * dev + E.bias + posB)
    // A hit right at the catch can lose a yard (a catch behind the line, no room).
    if (total > inp.passAir && contactT >= 0 && contactT <= E.negT && h01(`${seed}:neg`) < E.negP) total -= 1
    // Never invent a score the calibrated anchor did not have: keep the total
    // short of the goal line (the specific men still decided the yards).
    if (total > 99 - inp.yard) total = 99 - inp.yard
    total = clamp(total, E.totalLo, E.totalHi)
    // Line-to-gain guard (see `EMERGENT_YAC.moneyGuard`): the field may shorten a
    // gain, but it may never erase a first down the calibrated anchor already made.
    if (E.moneyGuard > 0 && (inp.down ?? 0) >= 3 && (inp.dist ?? 0) > 0 && inp.anchor >= (inp.dist ?? 0) && total < (inp.dist ?? 0))
      total = Math.min(inp.dist ?? 0, 99 - inp.yard)
    // A field arrival that is not counted as a score still ends in a tackle.
    if (scored && !tackler) tackler = nearest(field, defs, cpEnd, field.t)?.d.p
  }
  const yac = total - inp.passAir

  // ── the pile: the box score's solo credit + the assists (bookkeeping only) ──
  // `tackler` is the field's own man (the nearest in contact — what the animation
  // draws) and it is ALSO the box score's SOLO credit: the stop belongs to the man
  // who made it. The ASSIST goes to another defender in contact range of the ball
  // at the stop (within `assistR`), nearest first; nobody that close means no
  // assist. Zero rng draws; the yards, the field's tackler and every miss are
  // unchanged. PFR gang-tackle convention: one solo + one assist.
  let assistIds: string[] | undefined
  if (!emittedTd && tackler && E.assistN > 0) {
    const inStop: { p: Player; d: number }[] = []
    for (const d of defs) {
      const a = field.agents.get(d.key)
      if (!a || d.p.id === tackler.id) continue
      if (a.recover > 0 || field.t - a.freedAt < 0.2) continue
      const dist = Math.hypot(a.x - cpEnd.x, a.y - cpEnd.y)
      if (dist <= E.assistR) inStop.push({ p: d.p, d: dist })
    }
    inStop.sort((a, b) => a.d - b.d)
    if (inStop.length) assistIds = inStop.slice(0, Math.max(1, E.assistN)).map((c) => c.p.id)
  }

  // ── paths for the animation (E1c) ───────────────────────────────────────────
  const carryPath: LPt[] = (field.agents.get(carrierKey)?.mv.path ?? []).map((w) => ({ x: +w.x.toFixed(2), y: +w.y.toFixed(2) }))
  const fieldPaths: Record<string, LPt[]> = {}
  for (const d of defs) {
    const a = field.agents.get(d.key)
    if (a) fieldPaths[d.p.id] = a.mv.path.map((w) => ({ x: +w.x.toFixed(2), y: +w.y.toFixed(2) }))
  }

  if (YAC_STAT.on) {
    YAC_STAT.n++
    YAC_STAT.sumRaw += raw
    YAC_STAT.sumField += fieldTotal
    YAC_STAT.sumYac += yac
    YAC_STAT.sumAnchor += inp.anchor
    YAC_STAT.sumEmitted += total
    if (YAC_STAT.raw.length < 300000) YAC_STAT.raw.push(+raw.toFixed(2))
    const cell = (m: Record<string, FieldCell>, k: string) => (m[k] ??= { n: 0, sumRaw: 0, sumField: 0, sumYac: 0 })
    const bb = cell(YAC_STAT.byBucket, bucket)
    bb.n++; bb.sumRaw += raw; bb.sumField += fieldTotal; bb.sumYac += yac
    const bp = cell(YAC_STAT.byPos, pos)
    bp.n++; bp.sumRaw += raw; bp.sumField += fieldTotal; bp.sumYac += yac
    const bc = cell(YAC_STAT.byCell, `${pos}|${bucket}`)
    bc.n++; bc.sumRaw += raw; bc.sumField += fieldTotal; bc.sumYac += yac
    if (missCount) YAC_STAT.miss++
    if (outOfBounds) YAC_STAT.oob++
    if (emittedTd) YAC_STAT.td++
    if (yac >= 10) YAC_STAT.ge10++
    if (yac < 0) YAC_STAT.neg++
  }

  return {
    yac,
    raw,
    bucket,
    tacklerId: emittedTd ? undefined : tackler?.id,
    assistIds,
    missedTackleIds: missed.length ? missed : [],
    forcedMissedIds: missedSet.size ? (carrier ? [carrier.id] : []) : [],
    outOfBounds: emittedTd ? false : outOfBounds,
    scorerId: emittedTd ? carrier?.id : undefined,
    carryPath,
    fieldPaths,
  }
}

/** The nearest defender who can still make an attempt (not just beaten). */
function nearest(field: LiveField, defs: Def[], cp: LPt, t: number): { d: Def; a: { x: number; y: number; recover: number; freedAt: number }; dist: number } | undefined {
  let best: { d: Def; a: { x: number; y: number; recover: number; freedAt: number }; dist: number } | undefined
  for (const d of defs) {
    const a = field.agents.get(d.key)
    if (!a) continue
    if (a.recover > 0 || t - a.freedAt < 0.2) continue
    const dist = Math.hypot(a.x - cp.x, a.y - cp.y)
    if (!best || dist < best.dist) best = { d, a, dist }
  }
  return best
}

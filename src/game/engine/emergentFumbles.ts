// ─────────────────────────────────────────────────────────────────────────────
// r2fumbles — fumbles & ball security from the actual hit (REALISM2 row #3).
//
// Today every loose ball is a flat rate draw with a hash coin-flip for recovery:
//   • a run fumbles at `R2.runFumbleBase` × a mild CAR term (`rbCarrySecurity`,
//     clamped 0.7–1.3) — the HIT never enters;
//   • a completed catch is stripped at `R2.passFumbleBase + tacklerHitPower`
//     (0–0.004) or muffed at a CTH-scaled hash;
//   • a sack is stripped at a flat `R16.stripSackRate` (5%) — the E3 rep (who won,
//     how fast he was home) never enters;
//   • the loose ball is recovered by `fumbleRecovery` — one hash against a fixed
//     off/def share, with no man on the field.
//
// This file inverts all four when `R2FUM.on`:
//   • the FUMBLE CHANCE comes off the real contact — the closing speed and the
//     approach angle read from the recorded field paths (E1/E1b), the hit man's
//     own HPW/TAK, and the gang (how many other defenders are in the pile) —
//     against the carrier's own BCV/STR/CAR and his carry style. The hit man is
//     the man the field credited with the stop;
//   • a STRIP is the same contact from a raking angle (the ball exposed on the
//     sideline of the hit) with the hitter's own HPW;
//   • a QB STRIP-SACK comes off the E3 pass set: the man who actually won his rep
//     and how early he was home (`tHome` vs the QB's own clock) against the QB's
//     own ball security (his CAR/AWR/TUP — a passer who senses it tucks the ball);
//   • the RECOVERY is a bounce model: the ball squirts `rollYd` away from the
//     contact (direction biased away from the forcer) and the first man to reach
//     the resting spot wins it — his own pace (`paceFor` + `fatiguePace`), his own
//     first-step reaction (AWR/PRC), the carrier's stun (he just got hit), the
//     forcer's pounce (he is falling on it) and the offence's trailiing bodies.
//     A ball that rolls out of bounds is dead and stays with the fumbling club
//     (the NFL's ~9% of fumbles), exactly as the field lays it out.
//
// Every effect is each man's OWN rating; there is no unit or league average
// anywhere, and the multipliers are centred so the league mean chance holds
// (`R2FUM_STAT` measures the raw means for the probe). Determinism: ZERO `rng()`
// draws are added or removed — every decision is `hash32`/`h01` on
// `${n}:…:r2fum…`, and the draws the replaced block used (the fumble threshold,
// the pass time draw `tu`, the sack strip hash) are consumed at exactly the same
// point in the stream, so `eq 20/20` holds by construction. `setR2Fumbles(false)`
// makes the resolver never enter this file (byte-identical OFF path).
// ─────────────────────────────────────────────────────────────────────────────

import type { Player } from '../types'
import { clamp, hash32 } from './rng'
import { effAttrs, fatiguePace, paceFor } from './pace'
import { POS_MEAN } from './ratingMeans'
import type { LPt } from './liveField'

/** The field's lateral bounds (the animation's own chalk). */
const SIDE_LO = 1
const SIDE_HI = 52.3
const MID = 26.65

/**
 * Every constant r2fumbles adds, in one place. Tune only here.
 */
export const R2FUM = {
  // ON: calibrated to the NFL truth (3-seed panel + pooled 6-seed drift).
  on: true,
  // ── the hit ────────────────────────────────────────────────────────────────
  /** Hit power of a square hitter (per point of HPW above the contact mean). */
  hitPowW: 0.011,
  /** …of a raking arm (`1 − square`), the strip shape. */
  stripPowW: 0.016,
  /** The contact-power centre (the league's own mean HPW of the man making the hit). */
  hitPowMean: 78,
  hitTakMean: 80,
  /** The closing speed that reaches the ball (per mph above a jog). */
  hitCloseW: 0.045,
  hitCloseBase: 3.2,
  /** A square hit (he gets his hat on the ball) vs a glancing one. */
  hitSquareW: 0.42,
  hitSquareBase: 0.55,
  /** Each extra man in the pile. */
  gangW: 0.3,
  /** The pile radius (yd) around the carrier at the contact tick. */
  gangR: 2.4,
  /** The clamp on the whole contact multiplier (a runaway guard). */
  conLo: 0.15,
  conHi: 3.4,
  // ── the carrier's own ball security ───────────────────────────────────────
  /** ln-scale per point of BCV / STR / CAR around the position mean. */
  secBcvW: 0.045,
  secStrW: 0.008,
  secCarW: 0.014,
  /** Carry style: a power back protects the ball (the centred style value). */
  secPowerW: 0.35,
  secLo: 0.32,
  secHi: 3.4,
  // ── the strip on a completed catch ────────────────────────────────────────
  /** Strip base per contact at a league-average hit (replaces `passFumbleBase`). */
  catchBase: 0.0042,
  /** …and the hit term on top (a raking arm / a big hitter). */
  catchHitW: 0.012,
  /** The receiver's own hands: a muff scales with his CTH (replaces `muffBase`). */
  muffBase: 0.0075,
  muffCthW: 0.00055,
  muffLo: 0.002,
  muffHi: 0.02,
  // ── the sack strip (E3) ───────────────────────────────────────────────────
  /** Per-sack strip chance at a league-average rep (replaces `stripSackRate`). */
  sackBase: 0.055,
  /** The man who won his rep early: per (s) he beat the QB's own clock. */
  sackEarlyW: 0.16,
  /** …and his own burst of power on the ball (HPW/TAK above the rush mean). */
  sackPowW: 0.0022,
  /** A free rusher (no blocker home) strips more. */
  sackFree: 0.03,
  /** The QB's own ball security (CAR/AWR/TUP): a multiplier ≤ 1. */
  qbSecW: 0.011,
  sackLo: 0.015,
  sackHi: 0.3,
  // ── the loose-ball bounce ─────────────────────────────────────────────────
  /** How far the ball squirts from the contact spot (yd), and how wide the fan. */
  bounceLo: 1.6,
  bounceHi: 6.2,
  bounceFan: Math.PI * 0.85,
  /** The carrier is stunned by the hit (s) before he can go get it. */
  stunBase: 0.43,
  /** …scaled down by his own TGH/STR (a strong man keeps his feet). */
  stunW: 0.004,
  /** The forcer is falling on the ball (s of head start). */
  pounce: 0.17,
  /** The offence's trailing bodies get a head start — the ball is knocked back
   *  toward them and away from the man who hit it (s). */
  offHead: 0.46,
  /** A first-step reaction cost from AWR/PRC (s at the position mean). */
  reactBase: 0.24,
  reactW: 0.0035,
  /** How close a man has to be to scoop without a sprint (yd). */
  reachR: 0.8,
  /** Only this many nearest men contend (perf). */
  contendN: 7,
  // ── levels (the measured league means; 1 = the OFF level) ─────────────────
  runLevel: 0.75,
  passLevel: 1.28,
  sackLevel: 2.7,
  /**
   * The legacy run-fumble base is a per-CARRY rate that over-produces carries and
   * under-produces sack strips against the NFL split by site (nflverse 2021-2025:
   * rush 0.40, sack 0.30, catch 0.26, kicks 0.15 fumbles per team-game). The ON
   * model re-centres each site on its measured share.
   */
  runSiteW: 0.58,
} as const

interface MutableR2FUM { on: boolean; runLevel: number; passLevel: number; sackLevel: number }
const CFG = R2FUM as unknown as MutableR2FUM

/** r2fumbles: the dev toggle (default OFF — the OFF path is base). */
export function setR2Fumbles(on: boolean): void {
  CFG.on = on
}
/** r2fumbles: read the toggle so a probe can restore it exactly. */
export function getR2Fumbles(): boolean {
  return CFG.on
}

/** Probe-only accumulator (never read by the sim). */
export const R2FUM_STAT = {
  on: false,
  n: 0,
  sumSec: 0,
  sumCon: 0,
  sumP: 0,
  sec0: [] as number[],
  con0: [] as number[],
  nRun: 0,
  nCatch: 0,
  nSack: 0,
  sumSackP: 0,
  offRec: 0,
  defRec: 0,
  oobLoose: 0,
  reset() {
    this.n = 0; this.sumSec = 0; this.sumCon = 0; this.sumP = 0
    this.sec0 = []; this.con0 = []
    this.nRun = 0; this.nCatch = 0; this.nSack = 0; this.sumSackP = 0
    this.offRec = 0; this.defRec = 0; this.oobLoose = 0
  },
}

/** h01 on a key (hash32 → [0,1)) — never an rng() draw. */
function h01(key: string): number {
  return (hash32(key) >>> 0) / 4294967296
}
/** The position mean for a key (league-average player = 0 relative). */
function mean(pos: string | undefined, key: string): number {
  if (pos && POS_MEAN[pos] && typeof POS_MEAN[pos][key] === 'number') return POS_MEAN[pos][key]
  return 70
}
/** The man's own rating, position-corrected, relative to his position's mean. */
function rel(pos: string | undefined, key: string, v: number | undefined): number {
  return (typeof v === 'number' ? v : mean(pos, key)) - mean(pos, key)
}
/** The position-correct effective rating for a player. */
function ratingOf(p: Player, key: string): number {
  const a = effAttrs(p)
  const v = a[key]
  return typeof v === 'number' ? v : mean(p.pos, key)
}

// ── the actual contact ───────────────────────────────────────────────────────

/** The hit: how fast the tackler closed, from what angle, and how big the pile. */
export interface Contact {
  /** The closing speed of the tackler onto the carrier (mph). */
  closeMph: number
  /** 1 = square / head-on hat on the ball, 0 = a glancing chase-down. */
  square: number
  /** Extra bodies in the pile (0 = a solo tackle). */
  gang: number
}

/**
 * The contact geometry read off the recorded field paths (E1/E1b): the hit man's
 * closing speed relative to the carrier, the angle between the two velocities
 * (a square hit travels opposite the carrier) and the pile around the carrier at
 * that tick. Pure arithmetic on the recorded samples — no draw, no state.
 */
export function contactFromPaths(
  carryPath: LPt[] | undefined,
  fieldPaths: Record<string, LPt[]> | undefined,
  hitId: string | undefined,
  defIds: string[],
  dt: number,
): Contact | undefined {
  if (!carryPath || carryPath.length < 2 || !hitId || !fieldPaths) return undefined
  const hp = fieldPaths[hitId]
  const k = Math.min(carryPath.length, hp?.length ?? 0) - 1
  if (!hp || k < 1) return undefined
  const c0 = carryPath[k - 1]
  const c1 = carryPath[k]
  const h0 = hp[k - 1]
  const h1 = hp[k]
  const vcx = (c1.x - c0.x) / dt
  const vcy = (c1.y - c0.y) / dt
  const vhx = (h1.x - h0.x) / dt
  const vhy = (h1.y - h0.y) / dt
  const cs = Math.hypot(vcx, vcy)
  const hs = Math.hypot(vhx, vhy)
  // closing speed along the line between them (how hard he arrives), mph.
  const rx = c1.x - h1.x
  const ry = c1.y - h1.y
  const rl = Math.hypot(rx, ry)
  const closeYps = rl > 1e-6
    ? Math.abs(((vcx - vhx) * rx + (vcy - vhy) * ry) / rl) * 0.5 + 0.5 * Math.hypot(vcx - vhx, vcy - vhy)
    : Math.hypot(vcx - vhx, vcy - vhy)
  const cos = cs > 1e-6 && hs > 1e-6 ? (vcx * vhx + vcy * vhy) / (cs * hs) : -1
  const square = clamp(0.5 * (1 - cos), 0, 1)
  let gang = 0
  for (const id of defIds) {
    if (id === hitId) continue
    const p = fieldPaths[id]
    if (!p || !p.length) continue
    const q = p[Math.min(k, p.length - 1)]
    if (Math.hypot(q.x - c1.x, q.y - c1.y) <= R2FUM.gangR) gang++
  }
  return { closeMph: closeYps * 0.5682, square, gang }
}

/** The hit man's own power / tackle ratings (position-correct). Also exported so
 *  the resolver does not need the engine's private rating helpers. */
export function hitRatings(p: Player | undefined): { pow: number; tak: number } {
  if (!p) return { pow: R2FUM.hitPowMean, tak: R2FUM.hitTakMean }
  return { pow: ratingOf(p, 'HPW'), tak: ratingOf(p, 'TAK') }
}

/**
 * The contact for one play: read off the recorded paths when the field was on,
 * else a rating-only stand-in (the hit man's own pace onto the carrier, and the
 * one thing still deterministic without paths — the angle and the pile, hashed).
 * The caller passes the paths and the two paces; nothing here draws.
 */
export function contactFor(inp: {
  n: number; defId: string
  carryPath?: LPt[]
  paths?: Record<string, LPt[]>
  hitId?: string
  defIds: string[]
  dt: number
  hitSpeedYps: number
  carrierSpeedYps: number
}): Contact {
  const real = contactFromPaths(inp.carryPath, inp.paths, inp.hitId, inp.defIds, inp.dt)
  if (real) return real
  const c = Math.max(0, inp.hitSpeedYps - inp.carrierSpeedYps * 0.4)
  return {
    closeMph: c * 0.5682,
    square: 0.3 + 0.5 * h01(`${inp.n}:${inp.defId}:r2fum:ang`),
    gang: h01(`${inp.n}:${inp.defId}:r2fum:gang`) < 0.3 ? 1 : 0,
  }
}

/** The contact multiplier (centred: an average hit is 1.0). */
export function contactMul(hitPow: number, hitTak: number, c: Contact): number {
  const relPow = hitPow - R2FUM.hitPowMean
  const relTak = hitTak - R2FUM.hitTakMean
  let m = 1 +
    R2FUM.hitPowW * relPow +
    R2FUM.stripPowW * (1 - c.square) * Math.max(0, relPow) +
    R2FUM.hitCloseW * (c.closeMph - R2FUM.hitCloseBase) +
    R2FUM.hitSquareW * (c.square - R2FUM.hitSquareBase) +
    0.0006 * relTak +
    R2FUM.gangW * c.gang
  return clamp(m, R2FUM.conLo, R2FUM.conHi)
}

// ── the carrier's own ball security ──────────────────────────────────────────

/** The carrier's ball security (centred on his position's mean: average = 1.0).
 *  `power` is the centred carry-style value (styleProfile.power). */
export function securityMul(pos: string | undefined, a: Record<string, number>, power: number): number {
  const l = -(
    R2FUM.secBcvW * rel(pos, 'BCV', a.BCV) +
    R2FUM.secStrW * rel(pos, 'STR', a.STR) +
    R2FUM.secCarW * rel(pos, 'CAR', a.CAR) +
    R2FUM.secPowerW * power
  )
  return clamp(Math.exp(l), R2FUM.secLo, R2FUM.secHi)
}

// ── the three fumble sites ───────────────────────────────────────────────────

/** The run-carry fumble chance (replaces the flat `R2.runFumbleBase ×` chain). */
export function runFumbleChance(inp: {
  base: number; glMult: number; cohesion: number; wx: number; scout: number
  pos?: string; a: Record<string, number>; power: number
  hitPow: number; hitTak: number; c: Contact
}): number {
  const sec = securityMul(inp.pos, inp.a, inp.power)
  const con = contactMul(inp.hitPow, inp.hitTak, inp.c)
  if (R2FUM_STAT.on) {
    R2FUM_STAT.n++
    R2FUM_STAT.sumSec += sec
    R2FUM_STAT.sumCon += con
    if (R2FUM_STAT.sec0.length < 400000) { R2FUM_STAT.sec0.push(+sec.toFixed(3)); R2FUM_STAT.con0.push(+con.toFixed(3)) }
  }
  return inp.base * R2FUM.runLevel * R2FUM.runSiteW * inp.glMult * inp.cohesion * inp.wx * inp.scout * sec * con
}

/** The strip / muff chance on a completed catch (replaces the pass chain). */
export function catchFumbleChance(inp: {
  wx: number; scout: number
  pos?: string; a: Record<string, number>; power: number
  hitPow: number; hitTak: number; c: Contact
}): number {
  const sec = securityMul(inp.pos, inp.a, inp.power)
  const con = contactMul(inp.hitPow, inp.hitTak, inp.c)
  const p = (R2FUM.catchBase + R2FUM.catchHitW * Math.max(0, con - 1)) * R2FUM.passLevel * inp.wx * inp.scout * sec
  return clamp(p, 0.0005, 0.05)
}

/** A receiver's own bobble (replaces `muffChance`: his own hands and body). */
export function muffChance2(pos: string | undefined, a: Record<string, number>, power: number): number {
  const base = R2FUM.muffBase - R2FUM.muffCthW * rel(pos, 'CTH', a.CTH)
  return clamp(base * securityMul(pos, a, power), R2FUM.muffLo, R2FUM.muffHi)
}

/**
 * The QB strip-sack chance (replaces the flat `R16.stripSackRate`). The E3 pass
 * set gives the man who won and how early he was home (`tHome` against the QB's
 * own clock `qbT`); the rusher's own power and a free run add; the QB's own ball
 * security (CAR/AWR/TUP) takes away. No E3 (layer off) ⇒ the rep is unknown and
 * the chance is the level times base, centred as before.
 */
export function stripSackChance(inp: {
  rusher?: Player; qb?: Player
  tHome?: number; qbT?: number; free: boolean
  wx: number; scout: number
}): number {
  const r = inp.rusher
  const q = inp.qb
  let p = R2FUM.sackBase
  if (r) {
    const hpw = ratingOf(r, 'HPW')
    const tak = ratingOf(r, 'TAK')
    p += R2FUM.sackPowW * ((hpw - 80) + 0.5 * (tak - 80))
  }
  if (typeof inp.tHome === 'number' && typeof inp.qbT === 'number') {
    p += R2FUM.sackEarlyW * clamp(inp.qbT - inp.tHome, -0.5, 1.5)
  }
  if (inp.free) p += R2FUM.sackFree
  if (q) {
    const car = ratingOf(q, 'CAR')
    const awr = ratingOf(q, 'AWR')
    const tup = ratingOf(q, 'TUP')
    p -= R2FUM.qbSecW * ((car - 63) + 0.4 * (awr - 79) + 0.4 * (tup - 85))
  }
  p = clamp(p * R2FUM.sackLevel, R2FUM.sackLo, R2FUM.sackHi) * inp.wx * inp.scout
  if (R2FUM_STAT.on) { R2FUM_STAT.nSack++; R2FUM_STAT.sumSackP += p }
  return p
}

// ── the loose-ball bounce ────────────────────────────────────────────────────

export interface BounceOut {
  /** Who fell on it. A ball out of bounds stays with the fumbling club. */
  side: 'off' | 'def'
  winnerId?: string
  /** Where the ball came to rest (the return spot the animation can use). */
  rest: LPt
  outOfBounds: boolean
}

/**
 * The bounce model. The ball leaves the contact spot `rollYd` away, in a
 * direction biased away from the man who forced it (the ball is knocked out of
 * his hands, not into them) and fanned by a hash. The first man to reach the
 * resting spot wins it: his own top speed (`paceFor` + `fatiguePace`), a
 * first-step reaction from AWR/PRC, the carrier's stun (he was just hit), the
 * forcer's pounce (his weight is already going that way), the offence's trailing
 * bodies (the ball squirts back toward them) and, when the paths say so, the real
 * recorded positions at the contact. A ball that leaves the chalk is dead.
 */
export function bounceRecovery(inp: {
  key: string
  spot: LPt
  carrierId?: string
  forcerId?: string
  offence: Player[]
  defence: Player[]
  paths?: Record<string, LPt[]>
  fat?: Record<string, number>
}): BounceOut {
  const rollYd = R2FUM.bounceLo + (R2FUM.bounceHi - R2FUM.bounceLo) * h01(`${inp.key}:r2fum:blen`)
  // direction: away from the forcer (if known), fanned by the hash.
  let ang = h01(`${inp.key}:r2fum:bdir`) * 2 * Math.PI
  const fp = inp.forcerId ? inp.paths?.[inp.forcerId] : undefined
  if (fp && fp.length) {
    const f = fp[fp.length - 1]
    const dx = inp.spot.x - f.x
    const dy = inp.spot.y - f.y
    if (Math.hypot(dx, dy) > 0.05) ang = Math.atan2(dy, dx) + (h01(`${inp.key}:r2fum:bfan`) - 0.5) * R2FUM.bounceFan
  } else {
    // no forcer on the paths: the ball goes back toward the carrier's own goal
    // (`−x`, behind him) with the same fan.
    ang = Math.PI + (h01(`${inp.key}:r2fum:bfan`) - 0.5) * R2FUM.bounceFan
  }
  const rest: LPt = { x: inp.spot.x + Math.cos(ang) * rollYd, y: inp.spot.y + Math.sin(ang) * rollYd }
  const oob = rest.y <= SIDE_LO || rest.y >= SIDE_HI
  if (oob) {
    if (R2FUM_STAT.on) R2FUM_STAT.oobLoose++
    rest.y = clamp(rest.y, SIDE_LO, SIDE_HI)
    return { side: 'off', winnerId: inp.carrierId, rest, outOfBounds: true }
  }
  // candidates: the men on the play, positioned by the recorded path's last spot
  // (a man with no recorded path is not on this play — he never contends); with
  // no paths at all (E1 off) each man gets a deterministic pile position, so the
  // distances are still his own and still hash-stable.
  const usePaths = !!inp.paths && Object.keys(inp.paths).length > 0
  const cand: Array<{ p: Player; t: number }> = []
  const posOf = (p: Player, side: 'off' | 'def'): LPt | undefined => {
    const path = inp.paths?.[p.id]
    if (path && path.length) return path[path.length - 1]
    if (usePaths) return undefined
    return {
      x: inp.spot.x + (h01(`${inp.key}:r2fum:px:${p.id}`) - 0.5) * 7,
      y: MID + (h01(`${inp.key}:r2fum:py:${p.id}`) - 0.5) * 14 + (side === 'def' ? 1.5 : -1.5),
    }
  }
  const add = (p: Player, side: 'off' | 'def') => {
    const q = posOf(p, side)
    if (!q) return
    const d = Math.hypot(q.x - rest.x, q.y - rest.y)
    const pc = paceFor(p, p.pos)
    const fp2 = fatiguePace(inp.fat?.[p.id])
    const speed = Math.max(1.2, pc.top * fp2.top)
    const awr = ratingOf(p, 'AWR')
    const prc = ratingOf(p, 'PRC')
    let t = R2FUM.reactBase - R2FUM.reactW * ((awr - 80) + 0.5 * (prc - 78)) + Math.max(0, d - R2FUM.reachR) / speed
    if (side === 'off') t -= R2FUM.offHead
    if (p.id === inp.carrierId) {
      // the carrier was just hit: stunned, then he has to get up and go.
      const a = effAttrs(p)
      t += Math.max(0, R2FUM.stunBase - R2FUM.stunW * ((a.STR ?? mean(p.pos, 'STR')) - 75 + ((a.TGH ?? mean(p.pos, 'TGH')) - 87)))
    }
    if (p.id === inp.forcerId) t -= R2FUM.pounce
    // a hash jitter of a few hundredths keeps ties off the man order (no draw).
    t += 0.02 * h01(`${inp.key}:r2fum:jt:${p.id}`)
    cand.push({ p, t })
  }
  for (const p of inp.offence) add(p, 'off')
  for (const p of inp.defence) add(p, 'def')
  if (!cand.length) {
    const side = h01(`${inp.key}:r2fum:side`) < 0.48 ? 'off' : 'def'
    return { side, rest, outOfBounds: false }
  }
  cand.sort((x, y) => x.t - y.t)
  const win = cand[0]
  const side: 'off' | 'def' = inp.offence.some((p) => p.id === win.p.id) ? 'off' : 'def'
  if (R2FUM_STAT.on) { if (side === 'off') R2FUM_STAT.offRec++; else R2FUM_STAT.defRec++ }
  return { side, winnerId: win.p.id, rest, outOfBounds: false }
}

/** A compact, deterministic spot for a play with no recorded paths. */
export function fallbackSpot(n: number, defId: string, x: number): LPt {
  return { x, y: MID + (h01(`${n}:${defId}:r2fum:spot`) - 0.5) * 12 }
}

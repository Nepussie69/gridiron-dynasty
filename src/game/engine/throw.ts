// ─────────────────────────────────────────────────────────────────────────────
// J10b (FUTURES #33 part 2) — QB throw power, throw types, pocket presence and
// the persistent pass-style trait.
//
// Every decision is taken by the SPECIFIC players on the play: the quarterback on
// the snap (his own THP for the ball's speed, his own AWR/TUP/TOR + experience for
// his response to pressure) and the covering defender (his own SPD the ball
// flight gives him time to close with). No unit or roster mean is read: the terms
// are deviations from the position mean (`POS_MEAN`), the `WX_CENTER` pattern
// applied per player, so an average starter adds 0 and the league means hold.
//
// The four pieces (each a pure function, called from one site in `resolvePass`):
//   1. throw power — `throwPlan()` turns the QB's own THP into the ball's air
//      speed; the speed sets the flight time (the real air-time/distance fit,
//      `air_time = 0.079 + 0.0456·yd` at the league ball speed), and the flight
//      time is how long the covering defender has to close. A weak arm hangs the
//      ball up, the defender closes further, and the placement circle grows —
//      tight windows (outs, comebacks) are where he is punished. Wind hits a weak
//      arm harder. `airTimeS` is recorded for the animation. No second accuracy
//      term is added: the circle IS the accuracy lever the pass path already uses.
//   2. throw types — `chooseThrowType()` picks 'bullet' | 'normal' | 'rainbow'
//      from the route, the depth and the coverage (bullets on slants/digs into a
//      tight window; touch over the linebackers on seams/wheels/fades). The type
//      scales the ball speed: a bullet shortens the flight (less closing time)
//      but — for an inaccurate QB — lands off the spot more (a wider circle); a
//      rainbow hangs up and lets the defender close. `throwType` is recorded.
//   3. pocket presence — `pocketPlan()` reads the pressure J8b already resolved
//      (when and how hard it arrives) and the QB's own AWR + TUP + TOR +
//      experience decides his response: sense it early/late, step up / slide /
//      escape / throw it away / hold. Pressure is a BIG, visible cone narrowing
//      and circle widening, scaled DOWN by the QB's own poise (a poised QB keeps
//      a wide cone and a tight circle); a hurried or holding QB widens, an
//      escaping QB is off-platform (wider still). `pocketAction` is recorded.
//   4. pass style — `passStyle()` is a PURE function of the QB's own THP vs his
//      own accuracy ratings (no stored data): a cannon with loose accuracy is a
//      bullet thrower, a weak accurate arm a rainbow thrower. It shifts the
//      throw-type mix within what the route/coverage allows, and the player card
//      can call the same function later.
//
// No `rng()` draw is added or removed: every value is a deterministic hash of the
// play number (`hash32`/`h01` are local here). With `setThrow(false)` every
// function returns the neutral value, the caller adds nothing and records no new
// Play field, so the pass path is byte-identical to the unmodified engine.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player } from '../types'
import { playerAttrs } from '../data/ratings'
import { POS_MEAN } from './ratingMeans'
import { hash32, clamp } from './rng'

let THROW_ON = true

/** J10b: enable/disable the whole throw-power / throw-type / pocket layer. */
export function setThrow(on: boolean) {
  THROW_ON = on
}
/** J10b: read the toggle so a probe/calibration copy can restore it exactly. */
export function getThrow(): boolean {
  return THROW_ON
}
/** J10b: is the layer on? (read by the resolver's single call sites). */
export function throwOn(): boolean {
  return THROW_ON
}

// ── Every constant this job adds, in one place ────────────────────────────────
export const THROW = {
  // ── 3. pass style (pure fn of THP vs accuracy) ─────────────────────────────
  /** Bullet tendency per THP point above the QB position mean. */
  styleThpW: 0.055,
  /** A rainbow tendency per accuracy point above the mean (touch over the top). */
  styleAccW: 0.045,
  // ── 2. throw types ─────────────────────────────────────────────────────────
  /** Ball-speed multiplier by type (bullet cuts closing time, rainbow adds it). */
  typeSpeed: { bullet: 1.14, normal: 1.0, rainbow: 0.84 } as Record<ThrowType, number>,
  /** A bullet's extra placement error per accuracy point BELOW the mean (a
   *  fastball is harder for a loose thrower to locate; centred on accuracy). */
  bulletRadiusW: 0.030,
  /** A rainbow lands softer — a small radius credit. */
  rainbowRadiusW: 0.004,
  /** Guard: an elite-accurate QB is not credited beyond this on a bullet. */
  bulletRadiusAccMax: 12,
  // ── 1. throw power → ball speed → air time → closing ───────────────────────
  /** League ball speed at release, yd/s (G1 air-time fit, G2 median). */
  speedBase: 21.9,
  /** Ball speed per THP point above the QB mean (G2 spread ≈ ±1.2 yd/s). */
  speedThpW: 0.17,
  /** Flight time (s) ≈ airBase + airSlope·airYd at the league ball speed. */
  airBase: 0.079,
  airSlope: 0.0456,
  /** The ball speed the air-time fit was taken at. */
  speedRef: 21.9,
  /** Defender closing rate (yd/s) over the flight: G3 by target depth. */
  closeBase: 3.4,
  closePerYd: 0.10,
  /** Closing-rate per point of the covering defender's own SPD above his mean. */
  closeSpdW: 0.02,
  /** Placement-circle growth (yd) per extra yard the defender closed. */
  closeRadiusW: 0.55,
  /** Circle growth (yd) per THP point BELOW the mean — a loose deep ball. */
  armRadiusW: 0.06,
  /** Air depth past which a weak arm under-throws (a growing radius). */
  rangeStart: 12,
  /** Radius (yd) per yard of air past `rangeStart` per point of a QB's weak-arm
   *  exposure (below the mean) — the big distance lever. */
  rangeRadiusW: 0.02,
  /** Radius (yd) per mph of wind per unit of a QB's weak-arm exposure. */
  windThpW: 0.030,
  /** mph-equivalent added to the wind stress per unit of weather.ts's own centred
   *  deep-catch penalty (its wind+cold+snow view) — cold hits a weak arm harder. */
  wxStressEq: 25,
  /** E[max(0, −THP deviation)] across starting QBs (measured 1.20 over 96 NFL
   *  starters) — the wind and under-throw terms' centre, so a windy/distant
   *  throw does not widen circles league-wide (weak arms pay more, strong arms
   *  a touch less; the league mean holds). */
  thpAbsCenter: 5.5,
  /** E[max(0, −accuracy deviation)] across starting QBs (measured 1.83). */
  accAbsCenter: 4.5,
  /** Cone narrowing (deg) per THP point below the mean (a weak arm sails it). */
  coneArmW: 0.10,
  /** The J10b circle move's OWN accuracy weight (accuracy points per yard of
   *  J10b radius). J10a's circle lever is deliberately gentle; a J10b throw-power
   *  / throw-type radius move must actually reach the completion model, so its
   *  yard is scored at this weight. It is derived from the SAME single circle
   *  (`extraRadius`), never a parallel accuracy blend, and is 0 on the OFF path. */
  accPerRadius: 9,
  // ── 3. pocket presence ─────────────────────────────────────────────────────
  /** Poise = his own AWR/TUP/TOR deviations + experience (no BSK attr exists). */
  poiseAwrW: 0.035,
  poiseTupW: 0.030,
  poiseTorW: 0.022,
  poiseExpW: 0.10,
  /** Mobility (escape ability) from SPD/ACC deviations. */
  mobSpdW: 0.06,
  mobAccW: 0.05,
  /** Normalises J8b's `pressureEdge` into the 0..1 hurry level. */
  pressScale: 40,
  /** Pooled mean of `hurry` across a season (the WX_CENTER role for the pressure
   *  completion term: removing it leaves the league completion level alone). */
  hurryMean: 0.15,
  // the BIG pressure cone/circle effect (scaled down by the QB's own poise)
  /** Cone narrowing (deg) at full hurry for a zero-poise QB. */
  pressConeBase: 15,
  /** How much of that a fully poised QB keeps (wider cone). */
  pressConeBack: 9,
  /** Circle growth (yd) at full hurry for a zero-poise QB. */
  pressRadBase: 2.6,
  /** How much of that a fully poised QB avoids. */
  pressRadBack: 1.4,
  /** Cone narrowing (deg) when he holds the ball too long. */
  holdConeW: 6,
  /** Extra circle growth (yd) when he holds, escapes or steps up. */
  holdRadW: 1.2,
  escapeRadW: 1.0,
  stepRadGain: 0.5,
  slideRadGain: 0.35,
  // pressure → completion, directly (centred; the circle's own lever is small)
  /** Completion-probability drop at full hurry for a zero-poise QB. */
  pressCompDrop: 0.07,
  /** How much of the drop a fully poised QB avoids. */
  pressCompBack: 0.55,
  /** Residual added to compProb on top of the (already centred) pressure term —
   *  a small positive centring that offsets the drive-ending cost of the forced
   *  throwaways and the pressure redistribution. */
  pressCompCenter: 0.002,
  // pressure → sacks and throwaways (individual: his own poise + action)
  /** Sack-chance multiplier at full hurry for a zero-poise QB (holds). */
  holdSackW: 0.75,
  /** …for a poised QB who steps up / slides / escapes. */
  stepSackW: 0.42,
  slideSackW: 0.34,
  escapeSackW: 0.50,
  /** …when he throws it away instead (a throwaway is an incompletion, not a sack,
   *  but a mobile/poised QB's throwaway is less of a sack saver than a hold is). */
  throwAwaySackW: 0.30,
  /** Multiplicative centring so pressure does not move the league sack rate
   *  (tuned to the 6-seed paired OFF/ON drift: the action mix's mean delta). */
  sackCenter: -0.015,
  /** A throwaway ball cannot be caught: cap the completion probability. */
  throwAwayComp: 0.015,
  /** …and can rarely be intercepted (thrown at nobody). */
  throwAwayInt: 0.35,
  /** Centring for the forced throwaways' completion loss (tuned). */
  throwAwayCompCenter: 0.007,
  /** Share of a pressured dropback the QB throws away when he has no answer. */
  throwAwayRate: 0.22,
  // ── read choice: a weak arm avoids the deep-outside throws ─────────────────
  /** Target-score penalty on a deep-outside route per THP point below the mean. */
  readAvoidW: 0.9,
  /** Extra circle growth (yd) for a weak arm on a deep OUTSIDE throw (the throw a
   *  weak arm cannot drive: the out, the comeback, the deep corner). Centred on
   *  the THP position mean, so a strong arm keeps a tighter circle. */
  outsideArmW: 0.22,
  /** Air depth from which the outside-arm penalty applies. */
  outsideDepth: 12,
  /** Deep routes thrown outside the numbers. */
} as const

/** J10b: the deep OUTSIDE routes a weak arm cannot drive. */
const OUTSIDE_DEEP = new Set(['go', 'post', 'corner', 'postCorner', 'outUp', 'sluggo', 'comeback', 'speedOut', 'out'])

// Ensure the literal type of `typeSpeed` keys lines up with the union below.
export type ThrowType = 'bullet' | 'normal' | 'rainbow'
export type PocketAction = 'stepUp' | 'slide' | 'escape' | 'throwAway' | 'hold'

// ── helpers (identical maths to playsim's, kept local to avoid a module cycle) ─
function attrs(p: Player): Record<string, number> {
  return playerAttrs(p)
}
/** A rating's deviation from the position mean (0 for an average starter). */
function dev(pos: string | undefined, key: string, val: number): number {
  const m = pos ? POS_MEAN[pos]?.[key] : undefined
  return m === undefined ? 0 : val - m
}
function h01(key: string): number {
  return (hash32(key) >>> 0) / 4294967296
}

/** J10b: the QB's own THP deviation from the QB position mean. */
function thpDev(a: Record<string, number>): number {
  return dev('QB', 'THP', a.THP ?? POS_MEAN.QB.THP)
}
/** J10b: the QB's own depth-accuracy deviation (SAC/MAC/DAC mean). */
function accDev(a: Record<string, number>): number {
  const sac = a.SAC ?? POS_MEAN.QB.SAC
  const mac = a.MAC ?? POS_MEAN.QB.MAC
  const dac = a.DAC ?? POS_MEAN.QB.DAC
  return ((sac + mac + dac) / 3) - ((POS_MEAN.QB.SAC + POS_MEAN.QB.MAC + POS_MEAN.QB.DAC) / 3)
}

// ── 4. pass style (pure, persistent trait) ───────────────────────────────────
export interface PassStyle {
  /** −1 = a rainbow (touch) thrower, +1 = a bullet thrower. */
  bullet: number
}
/**
 * J10b: the QB's persistent pass-style trait, a PURE function of his own THP vs
 * his own accuracy (SAC/MAC/DAC). A cannon with loose accuracy loads up the
 * fastball; a weak, accurate arm throws with touch. No stored data: the player
 * card can call this directly.
 */
export function passStyle(qb: Player): PassStyle {
  const a = attrs(qb)
  const b = thpDev(a) * THROW.styleThpW - accDev(a) * THROW.styleAccW
  return { bullet: clamp(b, -1, 1) }
}

// ── 2. throw types ───────────────────────────────────────────────────────────
/** Routes thrown as a fastball into a tight window. */
const BULLET_ROUTES = new Set([
  'slant', 'quickOut', 'dig', 'glance', 'stick', 'meshIn', 'drag', 'shallow',
  'whip', 'in', 'sit', 'screen', 'bubble', 'flat', 'swing', 'check', 'arrow',
  'slip', 'cross', 'angle', 'out', 'speedOut', 'hitch', 'curl', 'comeback',
])
/** Routes thrown with touch over the linebackers (the ball must be layered). */
const TOUCH_ROUTES = new Set([
  'seam', 'wheel', 'fade', 'corner', 'post', 'go', 'postCorner', 'outUp', 'sluggo', 'over',
])

/**
 * J10b: pick the throw type from the route, the depth and how tight the window
 * is. A bullet goes into a tight short/intermediate window (slant, dig, out);
 * touch goes over the linebackers on the deep layered routes (seam, wheel,
 * fade); everything else is a normal throw. The QB's persistent pass style
 * shifts the mix WITHIN what the route allows (a bullet thrower takes a few more
 * fastballs, a rainbow thrower a few more touch balls). Deterministic.
 */
export function chooseThrowType(
  route: string | undefined, depth: number, tight: boolean, style: PassStyle, key: string,
): ThrowType {
  const u = h01(`${key}:ttype`)
  const bulletRoute = !!route && BULLET_ROUTES.has(route)
  const touchRoute = !!route && TOUCH_ROUTES.has(route)
  if (touchRoute || depth >= 15) {
    // Over the top: touch, unless a cannon decides to rip it (style) or the
    // window is so tight (a deep out into coverage) he must drive it.
    const pBullet = clamp(0.05 + style.bullet * 0.20 + (tight && depth < 20 ? 0.15 : 0), 0, 0.5)
    return u < pBullet ? 'bullet' : 'rainbow'
  }
  if (bulletRoute && depth <= 12) {
    const pBullet = clamp(0.5 + (tight ? 0.25 : 0) + style.bullet * 0.25, 0.1, 0.95)
    return u < pBullet ? 'bullet' : 'normal'
  }
  if (bulletRoute) {
    const pNormal = 1 - clamp(0.30 + style.bullet * 0.15, 0, 0.6)
    return u < pNormal ? 'normal' : 'bullet'
  }
  return u < 0.8 ? 'normal' : 'rainbow'
}

// ── 1. throw power → speed → air time → closing ──────────────────────────────
export interface ThrowPlan {
  type: ThrowType
  /** Ball speed at release (yd/s). */
  ballSpeed: number
  /** Flight time (s) for the recorded air distance. */
  airTimeS: number
  /** Yards the covering defender closes over the flight, vs a league pass. */
  closeYd: number
  /** Placement-circle growth (yd, centred). */
  radiusAdd: number
  /** Cone narrowing (deg, positive = narrower) — a weak arm's read cone tightens. */
  coneAdd: number
  /** The circle move's own (centred) accuracy cost — `radiusAdd × accPerRadius`. */
  accAdd: number
}

/**
 * J10b: the throw-power model. `airYd` is this throw's air distance, `depth` the
 * concept depth, `cover` the covering defender (his own SPD sets the closing
 * rate) and `wind` the wind in mph for the offence. Returns the ball speed, the
 * flight time, the closing distance and the (centred) circle/cone move.
 */
export function throwPlan(
  qb: Player, airYd: number, cover: Player | undefined,
  type: ThrowType, tight: boolean, wind: number, route: string | undefined,
): ThrowPlan {
  const a = attrs(qb)
  const td = thpDev(a)
  const ad = accDev(a)
  const speed = Math.max(8, (THROW.speedBase + td * THROW.speedThpW) * (THROW.typeSpeed[type] ?? 1))
  const refTime = THROW.airBase + THROW.airSlope * Math.max(0, airYd)
  const airTimeS = refTime * (THROW.speedRef / speed)
  // The covering defender's own burst joins the closing rate; his SPD deviation
  // is centred on his position mean, so an average DB adds 0.
  const covSpd = cover ? dev(cover.pos, 'SPD', attrs(cover).SPD ?? POS_MEAN[cover.pos]?.SPD ?? 0) : 0
  const closeRate = THROW.closeBase + THROW.closePerYd * Math.max(0, airYd) + covSpd * THROW.closeSpdW
  const closeYd = closeRate * airTimeS
  // The reference closing a league-average pass at this depth would give: the
  // flight time at the league ball speed times the same closing rate.
  const refCloseYd = closeRate * refTime
  // Circle growth: too much closing (a hung ball, a fast defender), a weak arm
  // per se, a deep under-throw past the arm's range, and wind on a weak arm.
  const closeExtra = closeYd - refCloseYd
  const armTerm = -td * THROW.armRadiusW
  // Under-throw past the arm's range and the deep-outside throw: both use the
  // POSITIVE part of the weak-arm deviation, so each subtracts its own mean
  // (`thpAbsCenter`) to keep the league circle width neutral.
  const rangeDepth = Math.max(0, airYd - THROW.rangeStart)
  const rangeTerm = rangeDepth * (Math.max(0, -td) - THROW.thpAbsCenter) * THROW.rangeRadiusW
  const windTerm = Math.max(0, wind) * (Math.max(0, -td) - THROW.thpAbsCenter) * THROW.windThpW
  const outsideTerm = !!route && OUTSIDE_DEEP.has(route) && airYd >= THROW.outsideDepth
    ? -td * THROW.outsideArmW
    : 0
  // A bullet's extra error for a loose thrower (centred on the accuracy
  // deviation); a rainbow a small credit for the soft landing.
  const accBelow = Math.min(THROW.bulletRadiusAccMax, Math.max(0, -ad) - THROW.accAbsCenter)
  const typeTerm = type === 'bullet' ? accBelow * THROW.bulletRadiusW : type === 'rainbow' ? -THROW.rainbowRadiusW : 0
  const radiusAdd = closeExtra * THROW.closeRadiusW + armTerm + rangeTerm + windTerm + outsideTerm + typeTerm
  const coneAdd = Math.max(0, -td) * THROW.coneArmW + (tight && type === 'bullet' ? 1.5 : 0)
  return { type, ballSpeed: speed, airTimeS, closeYd, radiusAdd, coneAdd, accAdd: radiusAdd * THROW.accPerRadius }
}

/** J10b: the flight time for the recorded air distance at this ball speed. */
export function airTimeFor(ballSpeed: number, airYd: number): number {
  const refTime = THROW.airBase + THROW.airSlope * Math.max(0, airYd)
  return refTime * (THROW.speedRef / Math.max(8, ballSpeed))
}

// ── 3. pocket presence ───────────────────────────────────────────────────────
export interface PocketPlan {
  /** The QB's modelled response (recorded for the animation). */
  action: PocketAction
  /** His own poise, −1..1 (AWR/TUP/TOR + experience vs the position mean). */
  poise: number
  /** Extra circle growth (yd, vs the action's neutral). */
  radiusAdd: number
  /** Extra cone narrowing (deg, positive = narrower). */
  coneAdd: number
  /** Completion-probability move (centred). */
  compAdd: number
  /** Sack-chance multiplier (centred around 1). */
  sackMult: number
}

/**
 * J10b: the QB's response to the pressure J8b already resolved. `pressEdge` is
 * the raw `pressureEdge` (J8b's rep model + the plan/coordinator terms) and `key`
 * a deterministic play token. Poise is his own AWR + TUP + TOR + experience (no
 * BSK attribute exists in the data); mobility his own SPD/ACC. The action is
 * chosen first, then the outcome terms; the whole thing is scaled by hurry, so a
 * clean pocket is exactly neutral.
 */
export function pocketPlan(
  qb: Player, pressEdge: number, key: string,
): PocketPlan {
  const a = attrs(qb)
  const awr = dev('QB', 'AWR', a.AWR ?? POS_MEAN.QB.AWR)
  const tup = dev('QB', 'TUP', a.TUP ?? POS_MEAN.QB.TUP)
  const tor = dev('QB', 'TOR', a.TOR ?? POS_MEAN.QB.TOR)
  const exp = Math.max(0, (qb.age ?? 22) - 22)
  const poise = clamp(awr * THROW.poiseAwrW + tup * THROW.poiseTupW + tor * THROW.poiseTorW + exp * THROW.poiseExpW, -1, 1)
  const mob = clamp(
    dev('QB', 'SPD', a.SPD ?? POS_MEAN.QB.SPD) * THROW.mobSpdW + dev('QB', 'ACC', a.ACC ?? POS_MEAN.QB.ACC) * THROW.mobAccW,
    -1, 1,
  )
  const hurry = clamp(pressEdge / THROW.pressScale, 0, 1.25)
  const u = h01(`${key}:pkt`)
  let action: PocketAction
  if (hurry < 0.05) {
    action = u < 0.55 ? 'stepUp' : u < 0.85 ? 'slide' : 'escape'
  } else {
    // `sense` > 0 means he is ahead of the rush (poised); < 0 means he is late.
    const sense = poise - (hurry - 0.5)
    if (sense > 0.30 && mob > 0.05) action = 'escape'
    else if (sense > 0.12) action = 'slide'
    else if (sense > -0.12) action = u < 0.62 ? 'stepUp' : 'slide'
    else if (sense > -0.50) action = u < 0.50 ? 'throwAway' : 'hold'
    else action = u < 0.30 ? 'throwAway' : 'hold'
  }
  const poised = clamp(poise, -1, 1)
  // The BIG pressure cone/circle effect, scaled down by his own poise.
  let radiusAdd = hurry * (THROW.pressRadBase - Math.max(0, poised) * THROW.pressRadBack)
  let coneAdd = hurry * (THROW.pressConeBase - Math.max(0, poised) * THROW.pressConeBack)
  // The action's own move on top (centred: the action mix has a league level, and
  // the caller's on-pitch reputation is the poise term above).
  let sackDelta = 0
  switch (action) {
    case 'stepUp':
      radiusAdd -= hurry * THROW.stepRadGain
      sackDelta = -hurry * THROW.stepSackW * (1 + Math.max(0, poised) * 0.5)
      break
    case 'slide':
      radiusAdd -= hurry * THROW.slideRadGain
      sackDelta = -hurry * THROW.slideSackW * (1 + Math.max(0, poised) * 0.5)
      break
    case 'escape':
      radiusAdd += hurry * THROW.escapeRadW
      sackDelta = -hurry * THROW.escapeSackW * (1 + Math.max(0, poised) * 0.3) * (1 + Math.max(0, mob) * 0.5)
      break
    case 'hold':
      radiusAdd += hurry * THROW.holdRadW
      coneAdd += hurry * THROW.holdConeW
      sackDelta = hurry * THROW.holdSackW * (1 - Math.max(0, poised) * 0.6)
      break
    case 'throwAway':
      sackDelta = -hurry * THROW.throwAwaySackW
      break
  }
  // Pressure → completion: `hurryCentred` is the hurry with its league mean
  // removed (`hurryMean`), so the term leaves the league completion level alone
  // (the WX_CENTER pattern). The circle's own completion lever is small by
  // design, so the measured pressure→completion drop lives here — still the QB's
  // own poise that scales it, never a second accuracy term stacked on the circle.
  const hurryCentred = hurry - THROW.hurryMean
  const compAdd = -hurryCentred * THROW.pressCompDrop * (1 - Math.max(0, poised) * THROW.pressCompBack) + THROW.pressCompCenter
  // `sackCenter` removes the mean of the delta (the league sack rate holds).
  return { action, poise: poised, radiusAdd, coneAdd, compAdd, sackMult: 1 + sackDelta - THROW.sackCenter }
}

// ── read choice: a weak arm avoids the deep-outside throws ───────────────────
/**
 * J10b: a target-selection score move. A weak arm cannot drive the deep outside
 * throws (the deep out / comeback / corner), so the progression steers away from
 * them; a cannon gets a small look. Centred on the THP position mean (a weak arm
 * loses, a strong arm gains, the league target mix holds).
 */
export function readAvoidBias(qb: Player, route: string | undefined): number {
  const a = attrs(qb)
  const td = thpDev(a)
  if (!route) return 0
  if (!OUTSIDE_DEEP.has(route)) return 0
  // A weak arm pays on the deep outside (a positive score penalty); a strong arm
  // gets a small bonus.
  return td * THROW.readAvoidW
}

/** J10b: deterministic throwaway gate for a pressured QB with no answer. */
export function isThrowaway(key: string, rate: number): boolean {
  return h01(`${key}:thrwy`) < rate
}

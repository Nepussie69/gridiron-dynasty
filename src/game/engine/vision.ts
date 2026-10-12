// ─────────────────────────────────────────────────────────────────────────────
// J10a (FUTURES #33 part 1) — QB vision cone, designed progressions, checkdowns
// and the placement circle.
//
// Every decision here is taken by the SPECIFIC players on the play: the QB on the
// snap (his own SAC/MAC/DAC for the throw's depth, his AWR, his experience, his
// own in-game fatigue and stamina) and the covering defender (his own PRC/AWR).
// No unit or roster mean is read; the individual terms are deviations from the
// position mean (`POS_MEAN`), so an average starter adds 0 and the league means
// hold — the `WX_CENTER` pattern, applied per player.
//
// The four pieces (each a pure function, called from exactly one site in
// `resolvePass`, so the J3b / J13 merges stay trivial):
//   1. progressions — `readOrder()` gives the concept its designed read sequence;
//      `qbReach()` is how far through it the QB gets (AWR + experience, more time
//      on a deeper concept, less when he was fooled pre-snap by the J12 disguise).
//      `readBias()` turns that into a per-candidate target weight and the chosen
//      receiver carries its `readNo` on the Play.
//   2. checkdowns — `checkdownBias()` lifts the back / tight end underneath when
//      the pocket is collapsing; a poor / inaccurate QB (his own AWR and depth
//      accuracy) bails to it early while an elite reader keeps working downfield,
//      and a gunslinger (downfield / contested style) ignores it and forces the
//      ball in. That is the big individual spread at the site.
//   3. vision cone — `visionThrow()` measures `coneDeg` from the QB's own
//      depth-specific accuracy + AWR, narrowed by his fatigue (STA-scaled) and by
//      pressure. Pressure is a BIG, poise-scaled effect (backlog 381): the cone
//      shrinks by a share set by how hard the throw is pressed, and a QB with
//      elite pocket poise (his own TUP/TOR/AWR) keeps most of it while a poor one
//      collapses. A read beyond the cone (`offCone`) loses accuracy steeply.
//   4. placement circle — the same call returns `placeRadiusYd` (the throw's error
//      radius: wider under pressure, fatigue, off-platform and off-cone) and the
//      deterministic `ballOffsetYd` spot the ball lands on inside it. The circle
//      re-expresses the QB accuracy used by the pass path: there is ONE accuracy
//      scalar (`qAcc`), derived from the circle, and the old flat blend is not
//      also added — no double counting.
//
// No `rng()` draw is added or removed: every value is a deterministic hash of the
// play number (`h01`/`hash32` are supplied by playsim via the caller). With
// `setVision(false)` every function returns the neutral value and the pass path is
// byte-identical to the unmodified engine.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player } from '../types'
import { playerAttrs } from '../data/ratings'
import { POS_MEAN } from './ratingMeans'
import { playbookPlay } from '../data/playbookData'

let VISION_ON = true

/** J10a: enable/disable the whole vision/progression/placement layer. */
export function setVision(on: boolean) {
  VISION_ON = on
}
/** J10a: read the toggle so a probe/calibration copy can restore it exactly. */
export function getVision(): boolean {
  return VISION_ON
}

// ── Every constant this job adds, in one place ────────────────────────────────
export const VISION = {
  // ── 1. progressions ────────────────────────────────────────────────────────
  /** Read slots a league-average QB works through (1 = his first read only). */
  readBase: 1.15,
  /** Per point of the QB's AWR deviation from the position mean. */
  readAwrW: 0.03,
  /** Per season of experience (age over 21) — veterans get further. */
  readExpW: 0.12,
  /** A deeper concept buys more time, so the QB reaches more reads. */
  readDepthW: 0.022,
  /** A fooled QB (J12) is stuck on his first look: reads lost. */
  readFoolPen: 0.9,
  /** Softmax score bonus for the first read (constant: the softmax cancels it). */
  readBonus: 0,
  /** Score lost per read slot past the first — this is what makes read 1 dominate
   *  (the target softmax's tau is 160; tuned so R1 lands on the NFL ~53% of
   *  attempts and the rest of the progression is clearly secondary). */
  readStep: 135,
  /** Score bonus for a read inside the QB's reach (constant across in-reach reads). */
  reachBonus: 0,
  /** Extra score lost per read slot beyond the QB's reach (a slow/rookie read). */
  beyondReach: 55,
  /** J10a: a tight end who is NOT the underneath outlet is rarely the designed
   *  primary — his routes sit over the middle where the pocket side of the
   *  progression works away from the safety help, so the read order sends the
   *  ball to the receivers first and the TE's own routes fall in behind. The
   *  scoring move keeps the target mix at its uncoached level (the progression
   *  would otherwise shift ~9 points of share onto the TE, and a tight end caught
   *  by a linebacker is tackled far more reliably than a receiver caught by a
   *  corner — which is what pulled the league missed-tackle rate down). */
  teReadPen: 0,
  // ── 2. checkdowns ──────────────────────────────────────────────────────────
  /** Baseline score for the back / tight-end outlet (a shade behind read 1). The
   *  measured pass missed-tackle rate falls with the checkdown share (an outlet
   *  completion is stopped by a linebacker, a better tackler), so this level is
   *  set to hold the league checkdown share at ~15% and protect the band. */
  chkBase: -112,
  /** The collapsing pocket pushes the QB to the back (per unit of pressure). */
  chkPressW: 95,
  /** Pressure at which the checkdown weight is at its centre (measured). */
  pressCenter: 0,
  /** A QB's AWR deviation from the position mean: an aware QB keeps working
   *  downfield, a poor one bails to the outlet early. (Centred on the position
   *  mean, so the league checkdown level does not move — the big individual
   *  spread comes from here.) */
  chkAwrW: 3.4,
  /** Depth-specific accuracy deviation: an inaccurate QB bails to the checkdown
   *  (centred, same reasoning as `chkAwrW`). */
  chkAccW: 2.6,
  /** A gunslinger (deep-downfield / contested style) forces it in instead. */
  chkGunW: 26,
  /** J10a: a checkdown is an underneath outlet — its air yards (taken from J3b's
   *  `passAir`, never the concept depth) are compressed into this band so a TE
   *  checkdown on a deep concept is not drawn as a 20-yard throw. */
  chkAirLo: 2,
  chkAirHi: 4,
  // ── 3. vision cone ─────────────────────────────────────────────────────────
  /** Cone width (degrees) for a league-average QB, clean pocket. */
  coneBase: 33,
  coneAccW: 0.8, // depth-specific accuracy widens the cone
  coneAwrW: 0.6, // awareness widens the cone
  coneFatW: 6.0, // his own fatigue narrows it
  coneMin: 12,
  coneMax: 55,
  /** Floor for a pressured cone (a collapsed cone may go below the clean-pocket `coneMin`). */
  conePressMin: 4,
  /** Pressure (pressureEdge / pressScale) at which the pressure shrink is full. */
  conePressFull: 0.6,
  /** Shape of the shrink from clean (0) to full (1): < 1 makes light pressure
   *  already clearly narrower. A clean pocket (pressure <= 0) is never touched. */
  conePressCurve: 0.75,
  /** Share of the cone lost at full pressure by a QB of league-average poise. */
  coneShrinkMid: 0.5,
  /** Per rating point of the QB's own poise, taken off that share (an elite-poise
   *  QB keeps most of his cone, a poor one collapses). */
  coneShrinkPoiseW: 0.025,
  coneShrinkMin: 0.15,
  coneShrinkMax: 0.78,
  /** Poise = his own TUP / TOR (the qbPressureRelief inputs) + AWR, as rating
   *  points off the QB position mean. Weights sum to 1. */
  poiseTup: 0.4,
  poiseTor: 0.3,
  poiseAwr: 0.3,
  // ── 4. placement circle ────────────────────────────────────────────────────
  /** Error radius (yd) for a league-average QB, clean pocket. */
  radiusBase: 1.45,
  radiusAccW: 0.05, // a more accurate depth rating tightens it
  radiusAwrW: 0.018,
  /** Yards of circle widening per unit of cone shrink: the circle opens as the
   *  cone closes, so a poor-poise QB's circle widens more than an elite one's. */
  radiusPressW: 1.8,
  radiusFatW: 0.25, // fatigue widens it (STA-scaled)
  radiusOffPlatW: 0.30, // off-platform (scrambling style) widens it
  radiusConeW: 0.80, // a throw outside the cone widens it (stared down / late)
  radiusMin: 0.35,
  radiusMax: 5.0,
  /** Normalises `pressureEdge` into the centre-relative pressure term. */
  pressScale: 40,
  // ── the re-expressed QB accuracy (replaces the old flat blend) ─────────────
  /** The old blend's league mean at the QB position: SAC·.3+MAC·.3+DAC·.25+AWR·.15. */
  accCenter: 92,
  /** How much of the depth-specific accuracy deviation survives (the individual
   *  effect: a big multiplier both widens the good/bad QB spread and holds the
   *  league mean, because the deviation is centred on the position mean). */
  accW: 1.5,
  /** How much the (centred) circle radius moves the effective accuracy — the
   *  pressure / fatigue / off-cone widening reaches the outcome through here. */
  accRadiusW: 0.6,
  accMin: 45,
  accMax: 112,
  // ── the ball spot inside the circle drives catchable / contested ───────────
  /** Completion-probability penalty per yard the ball lands off the spot. The
   *  spot is centred (`offset − ⅔·radius`), so the league mean does not move. */
  spotW: 0.04,
  // ── defender breaks on the QB's eyes (INT + PBU on a late/stared throw) ────
  eyeIntW: 0.05, // per unit of off-cone × the defender's PRC/AWR skill
  jumpPbuW: 0.12, // per unit of off-cone (PBU bookkeeping on an incompletion)
  eyeMax: 0.35,
  // ── league centring (never shrinks an individual effect) ───────────────────
  /** Share of completions (>2 yd) trimmed by a yard: holds YPA / first downs. */
  centerYdP: 0.06,
  /** Added to the completion probability (league centring of the comp% the circle lifts). */
  centerComp: -0.0018,
  /** Added to the pass missed-tackle chance: holds the league missed-tackle count
   *  (more checkdowns are stopped by linebackers, who miss less). */
  centerMiss: 0.015,
} as const

// ── helpers (identical maths to playsim's, kept local to avoid a module cycle) ─
const clampV = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
function attrs(p: Player): Record<string, number> {
  return playerAttrs(p)
}
/** A rating's deviation from the position mean (0 for an average starter). */
function dev(pos: string | undefined, key: string, val: number): number {
  const m = pos ? POS_MEAN[pos]?.[key] : undefined
  return m === undefined ? 0 : val - m
}
/** The depth-specific accuracy rating (short/medium/deep) and its POS_MEAN key. */
export function depthAccKey(depth: number): 'SAC' | 'MAC' | 'DAC' {
  return depth <= 8 ? 'SAC' : depth <= 18 ? 'MAC' : 'DAC'
}

// ── 1. designed read order ────────────────────────────────────────────────────
/** Route-development class: lower = earlier in the progression (by release time). */
const ROUTE_RANK: Record<string, number> = {
  screen: 0, bubble: 0, slip: 0, quickOut: 0, slant: 0, glance: 0, flat: 0, swing: 0,
  stick: 0, whip: 0, sit: 0, check: 0, arrow: 0, runFake: 4,
  hitch: 1, curl: 1, shallow: 1, meshIn: 1, drag: 1, cross: 1, angle: 1, out: 1,
  dig: 2, over: 2, in: 2, comeback: 2, corner: 2, speedOut: 2,
  go: 3, seam: 3, post: 3, wheel: 3, postCorner: 3, outUp: 3, sluggo: 3,
}
/** Concept-specific designed progressions (route labels in read order). */
const CONCEPT_READS: Record<string, string[]> = {
  'Four Verts': ['seam', 'go', 'dig', 'check'],
  'Four Verticals': ['seam', 'go', 'dig', 'check'],
  Mesh: ['meshIn', 'curl', 'flat', 'check'],
  Smash: ['corner', 'hitch', 'check'],
  'Y-Cross': ['cross', 'dig', 'post', 'go', 'check'],
  Flood: ['flat', 'out', 'corner', 'go', 'check'],
  Levels: ['shallow', 'stick', 'dig', 'curl', 'check'],
  Dagger: ['stick', 'drag', 'dig', 'post', 'check'],
  Mills: ['out', 'dig', 'seam', 'over', 'check'],
  Drive: ['shallow', 'hitch', 'cross', 'dig', 'check'],
  Stick: ['flat', 'stick', 'out', 'go', 'check'],
  Snag: ['whip', 'flat', 'hitch', 'corner', 'check'],
  'Curl-Flat': ['flat', 'curl', 'hitch', 'check'],
  'Shallow Cross': ['flat', 'shallow', 'drag', 'over', 'check'],
  Sail: ['flat', 'out', 'corner', 'seam', 'check'],
  Spacing: ['flat', 'sit', 'hitch', 'out', 'check'],
  Bench: ['stick', 'out', 'corner', 'go', 'check'],
  Scissors: ['dig', 'corner', 'post', 'seam', 'check'],
  Hank: ['flat', 'angle', 'hitch', 'stick', 'swing'],
  Texas: ['hitch', 'out', 'stick', 'shallow', 'dig'],
  'Quick Slant': ['quickOut', 'slant', 'stick', 'flat'],
  Slant: ['quickOut', 'slant', 'stick', 'flat'],
  'Play Action Deep': ['seam', 'post', 'go', 'check'],
  'PA Cross': ['cross', 'dig', 'post', 'go', 'check'],
  Bootleg: ['stick', 'drag', 'over', 'comeback'],
  'Gun PA Boot': ['stick', 'drag', 'over', 'comeback'],
  'Gun PA Cross': ['cross', 'dig', 'post', 'go'],
  'Gun Ace PA': ['dig', 'cross', 'post', 'go'],
  'RB Screen': ['screen', 'swing', 'stalk'],
  'RPO Bubble': ['bubble', 'stalk'],
  'RPO Pass': ['glance', 'go', 'stalk'],
}

/** J10a: each scoring candidate's designed read number (1-based). */
export function readOrder(conceptName: string, routes: Array<string | undefined>): number[] {
  const table = CONCEPT_READS[conceptName]
  const prio = (r: string | undefined): number => {
    if (!r) return 3.5
    if (table) {
      const k = table.indexOf(r)
      if (k >= 0) return k
      return (ROUTE_RANK[r] ?? 2) + table.length
    }
    return ROUTE_RANK[r] ?? 2
  }
  const idx = routes.map((r, i) => ({ i, p: prio(r) }))
  idx.sort((a, b) => a.p - b.p || a.i - b.i)
  const out = new Array<number>(routes.length).fill(1)
  idx.forEach((e, rank) => { out[e.i] = rank + 1 })
  return out
}

const CHK_ROUTES = new Set(['check', 'flat', 'swing', 'shallow', 'angle', 'screen', 'bubble', 'slip'])

/** J10a: is this route one of the checkdown / underneath outlets? */
export function isCheckRoute(route: string | undefined): boolean {
  return !!route && CHK_ROUTES.has(route)
}

/** J10a: the designed route label for a candidate, from the concept's playbook entry. */
export function routeForCandidate(conceptName: string, pos: string | undefined, wrIdx: number): string | undefined {
  const pb = playbookPlay(conceptName)
  if (!pb) return undefined
  if (pos === 'TE') return pb.assignments.find((a) => a.job === 'route' && a.pos === 'TE')?.route
  if (pos === 'RB') return pb.assignments.find((a) => a.job === 'route' && a.pos === 'RB')?.route
  if (pos === 'FB') return pb.assignments.find((a) => a.job === 'route' && a.pos === 'FB')?.route
  if (pos === 'WR') {
    const wrs = pb.assignments.filter((a) => a.job === 'route' && a.pos.startsWith('WR')).map((a) => a.route)
    return wrs[wrIdx]
  }
  return undefined
}

// ── 2. QB read speed → how far through the progression he gets ────────────────
/** J10a: the QB's read reach in read slots (a float; 1.15 = a first read). */
export function qbReach(qb: Player, depth: number, fooled: boolean): number {
  const a = attrs(qb)
  const awr = dev('QB', 'AWR', a.AWR ?? POS_MEAN.QB.AWR)
  const exp = Math.max(0, (qb.age ?? 22) - 21)
  let r = VISION.readBase + awr * VISION.readAwrW + exp * VISION.readExpW + Math.max(0, depth) * VISION.readDepthW
  if (fooled) r -= VISION.readFoolPen
  return clampV(r, 0.6, 4)
}

/** J10a: the softmax score move for a candidate at `readNo`, given the reach.
 *  Read 1 dominates (the designed progression); a QB who has not reached a read
 *  pays `beyondReach` for every slot past his own reach (his AWR + experience). */
export function readBias(readNo: number, reach: number): number {
  const beyond = readNo > reach ? -VISION.beyondReach * (readNo - reach) : VISION.reachBonus
  return VISION.readBonus - (readNo - 1) * VISION.readStep + beyond
}

/** J10a: the checkdown weight for an underneath target (0 for anyone else). The
 *  collapsing pocket lifts it; a poor / inaccurate QB bails to it early (a big,
 *  individual spread: his own AWR and depth accuracy), a gunslinger ignores it
 *  and forces the ball in. `pressureNorm` is the raw `pressureEdge`, normalised
 *  here by the same scale the cone uses. */
export function checkdownBias(
  isOutlet: boolean, qb: Player, pressureNorm: number, depth = 10,
): number {
  if (!isOutlet) return 0
  const a = attrs(qb)
  const key = depthAccKey(depth)
  const awr = dev('QB', 'AWR', a.AWR ?? POS_MEAN.QB.AWR)
  const acc = dev('QB', key, a[key] ?? POS_MEAN.QB[key])
  const gun = deepStyle(qb)
  const press = pressureNorm / VISION.pressScale - VISION.pressCenter
  return VISION.chkBase + press * VISION.chkPressW - awr * VISION.chkAwrW - acc * VISION.chkAccW - gun * VISION.chkGunW
}

/** J10a: how much of a gunslinger (downfield / contested) the QB is, 0..1.5. */
function deepStyle(qb: Player): number {
  const t = (qb.traits ?? []).join(' ').toLowerCase()
  let g = 0
  if (t.includes('cannon arm')) g += 0.6
  if (t.includes('improviser') || t.includes('gunslinger')) g += 0.5
  if ((qb.traits?.[0] ?? '').toLowerCase().includes('deep threat')) g += 0.4
  return g
}

// ── 3 & 4. vision cone, placement circle, re-expressed accuracy ───────────────
export interface VisionThrow {
  /** J10a: the designed read the QB actually threw to (1-based). */
  readNo: number
  /** J10a: the cone width (degrees) on this throw. */
  coneDeg: number
  /** J10a: the throw's error radius (yards). */
  placeRadiusYd: number
  /** J10a: where inside the circle the ball landed (yards off the spot). */
  ballOffsetYd: number
  /** J10a: the ball spot, centred (`offset − ⅔·radius`, league mean 0)... the
   *  catchable / contested effect the pass path applies. */
  offSpotYd: number
  /** J10a: read slots beyond the QB's reach (0 = a throw inside the cone). */
  offCone: number
  /** J10a: the effective QB accuracy the pass path uses (replaces the old blend). */
  qAcc: number
}

/**
 * J10a: the cone + circle for this throw. `pressureEdge` is the pass-rush edge
 * already computed by the resolver (normalised by `pressScale`), `fat` is the
 * QB's own in-game fatigue (0 = fresh) and `sta` his stamina rating (a high-STA
 * QB narrows his cone less). `spotU`/`spotA` are deterministic uniforms (from the
 * caller's hashes) placing the ball inside the circle. Returns the re-expressed
 * accuracy — the ONLY accuracy scalar the pass path uses when the layer is on.
 */
export function visionThrow(
  qb: Player, depth: number, readNo: number, reach: number | null,
  pressureEdge: number, fat: number, offPlatform: number,
  spotU: number, _spotA: number,
): VisionThrow {
  const a = attrs(qb)
  const key = depthAccKey(depth)
  const accDev = dev('QB', key, a[key] ?? POS_MEAN.QB[key])
  const awrDev = dev('QB', 'AWR', a.AWR ?? POS_MEAN.QB.AWR)
  const staDev = dev('QB', 'STA', a.STA ?? POS_MEAN.QB.STA)
  const press = Math.max(0, pressureEdge / VISION.pressScale - VISION.pressCenter)
  // Pressure shrink (backlog 381): how hard he is pressed (0 clean .. 1 full) times
  // the share of the cone his OWN poise lets pressure take. No unit mean is read.
  const poise = dev('QB', 'TUP', a.TUP ?? POS_MEAN.QB.TUP) * VISION.poiseTup
    + dev('QB', 'TOR', a.TOR ?? POS_MEAN.QB.TOR) * VISION.poiseTor
    + awrDev * VISION.poiseAwr
  const pressLevel = Math.pow(Math.min(1, press / VISION.conePressFull), VISION.conePressCurve)
  const shrink = pressLevel * clampV(VISION.coneShrinkMid - poise * VISION.coneShrinkPoiseW, VISION.coneShrinkMin, VISION.coneShrinkMax)
  // A high-STA QB carries his fatigue better (his own stamina rating scales the cost).
  const fatW = fat * (1 - clampV(staDev, -0.3, 0.3))
  const offCone = reach == null ? 0 : Math.max(0, readNo - reach)
  // The clean-pocket cone is exactly the pre-381 value (same clamp); pressure then takes `shrink` of it.
  const cleanCone = clampV(
    VISION.coneBase + accDev * VISION.coneAccW + awrDev * VISION.coneAwrW - fatW * VISION.coneFatW,
    VISION.coneMin, VISION.coneMax,
  )
  const coneDeg = shrink > 0 ? clampV(cleanCone * (1 - shrink), VISION.conePressMin, VISION.coneMax) : cleanCone
  const radius = clampV(
    VISION.radiusBase - accDev * VISION.radiusAccW - awrDev * VISION.radiusAwrW
      + shrink * VISION.radiusPressW + fatW * VISION.radiusFatW
      + offPlatform * VISION.radiusOffPlatW + offCone * VISION.radiusConeW,
    VISION.radiusMin, VISION.radiusMax,
  )
  // The ball spot inside the circle (uniform over the disc; deterministic). The
  // mean of `sqrt(U)` is ⅔, so the centred spot below has a league mean of 0 and
  // its per-throw penalty leaves the league completion level untouched.
  const ballOffsetYd = Math.sqrt(clampV(spotU, 0, 1)) * radius
  const offSpotYd = ballOffsetYd - radius * (2 / 3)
  // Re-expressed accuracy: the QB's own depth rating, then the circle's cost.
  // (`radius − radiusBase` carries the pressure/fatigue/off-cone widening; its
  // league level is absorbed in `accCenter`, which is tuned to the old blend's
  // mean so the league completion level does not move.)
  const qAcc = clampV(
    VISION.accCenter + accDev * VISION.accW
      - (radius - VISION.radiusBase) * VISION.accRadiusW,
    VISION.accMin, VISION.accMax,
  )
  return { readNo, coneDeg, placeRadiusYd: radius, ballOffsetYd, offSpotYd, offCone, qAcc }
}

/** J10a: the covering defender's own ball-skill deviation (PRC/AWR), for the
 *  eye-jump. 0 for a league-average defender. */
export function eyeSkill(pos: string | undefined, prc: number | undefined, awr: number | undefined): number {
  if (!pos) return 0
  return dev(pos, 'PRC', prc ?? POS_MEAN[pos]?.PRC ?? 0) * 0.5 + dev(pos, 'AWR', awr ?? POS_MEAN[pos]?.AWR ?? 0) * 0.5
}

export function visionOn(): boolean {
  return VISION_ON
}

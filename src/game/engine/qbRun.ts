// ─────────────────────────────────────────────────────────────────────────────
// realism-qbrun (2026-10-15): the quarterback carries the ball ONLY on concepts
// that are his by design, and HOW OFTEN those concepts are called comes from
// that quarterback's own legs (SPD/ACC/AGI/BCV), his own size and strength for a
// sneak, and his own read of the specific unblocked edge man on an option —
// never a team/unit mean and never a flat share.
//
//   • a QB SNEAK ('Sneak', under centre) on short yardage — the QB's own
//     STR/size/BCV against the specific interior man at the point of attack;
//   • 'QB Draw' — the quarterback by definition;
//   • the option concepts ('Zone Read' / 'Read Option' / 'RPO Run') — the QB
//     keeps or gives on the read of the specific unblocked edge defender (his
//     PRC/AWR/PUR discipline, and whether he crashes) against the QB's own read
//     (AWR) and legs.
//
// Every OTHER run concept (Inside/Outside Zone, Power, Counter, Duo, Iso, Trap,
// Toss, Draw, Pin-Pull, Jet Sweep, Jumbo *, Gun *, Singleback *, …) is a back's
// play: the quarterback is never the carrier (RB1/RB2/FB/WR exactly as before).
//
// `qbDesignShare` is the ONE pure function both the play-by-play resolver
// (playsim.ts) and the score-only allocator (statAlloc.ts) call for a QB's
// designed-carry rate. Every judgement is a deterministic hash — no rng() draw
// is added or removed — and the whole layer sits behind `setQbRun` (default ON),
// so with it OFF the sim is byte-identical to main.
//
// Ratings come from the sim's effective function (`playerAttrs`: generated +
// real + dev-plan gains + the hurt penalty), never raw `p.attrs`, and there is
// no `?? 70` fallback: a missing key reads the position's own mean rating.
// ─────────────────────────────────────────────────────────────────────────────

import { clamp, hash32 } from './rng'
import { playerAttrs } from '../data/ratings'
import { positionRating } from './individual'
import type { Player } from '../types'

/**
 * A deterministic uniform in [0,1) from a string key — never an rng() draw.
 * `salt` picks an independent stream: the FNV chain is only sensitive from the
 * first differing character on, so `x:a` and `x:b` (one trailing char apart)
 * are ~0.9 correlated. Distinct salts are the safe way to split one key into
 * several independent decisions on the same snap.
 */
function h01(key: string, salt = 0): number {
  return (hash32(key, salt) >>> 0) / 4294967296
}
const SALT_SNEAK = 0x5f3759df
const SALT_CALL = 0x2545f491
const SALT_KIND = 0x9e3779b1
const SALT_OPTION = 0x85ebca6b

let QB_RUN_ON = true
/** realism-qbrun: the whole QB-carry model. OFF = byte-identical to main. */
export function setQbRun(on: boolean) { QB_RUN_ON = on }
export function getQbRun(): boolean { return QB_RUN_ON }

/**
 * Every constant this job adds, in one place. Tunable independently of R2/R15
 * and the calibration file (which are untouched).
 */
export const QB_RUN = {
  // ── legs composite = SPD·a + ACC·b + AGI·c + BCV·d (rating points) ─────────
  legsSpd: 0.35,
  legsAcc: 0.2,
  legsAgi: 0.25,
  legsBcv: 0.2,
  // ── the option-keep legs: a speed-weighted composite (SPD first) ──────────
  keepLegsSpd: 0.8,
  keepLegsAcc: 0.1,
  keepLegsAgi: 0.1,
  /** keep-legs at/below this read 0 (a statue, never keeps); at/above 1 (elite). */
  legsLo: 80,
  legsHi: 92,

  // ── sneak (a called run with <= `sneakDist` yd to go) ─────────────────────
  sneakDist: 1,
  /** Base P(call the sneak) on a short-yardage run; moved by size/STR/BCV. */
  sneakBase: 0.21,
  sneakStrW: 0.011,
  sneakSizeW: 0.001,
  sneakBcvW: 0.005,
  sneakLo: 0.04,
  sneakHi: 0.45,
  /** The QB's weight, centred (a heavier/stronger QB sneaks more). */
  sizeCenter: 220,
  sizeSpan: 60,
  /** Sneak conversion: the QB's own push vs the point-of-attack defender. */
  sneakConvBase: 0.6,
  sneakConvSlope: 0.014,
  sneakConvLo: 0.3,
  sneakConvHi: 0.92,

  // ── a called RB run that is instead a QB concept (draw / option) ──────────
  /** The legs→share curve: share = shareGain · exp((legs − shareMid)/shareSlope). */
  shareGain: 0.029,
  shareMid: 85.2,
  shareSlope: 3.0,
  /** Share of designed runs with <= 1 yd to go (for the score-only mirror). */
  shortFrac: 0.066,
  callHi: 0.4,
  /** Of the called QB concepts, the share that is a plain draw (the rest read). */
  drawFrac: 0.6,
  shareLo: 0.004,
  shareHi: 0.235,
  /**
   * The concept menu's own share of RB runs that are option concepts (Zone Read
   * / Read Option / RPO Run). On those a QB carry needs only the read, not a
   * fresh draw call, so `qbCarryPerCall` blends them in — this is what makes the
   * derived per-snap call rate reproduce `qbDesignShare` instead of undershooting
   * it. Measured from the menu (11% of designed runs).
   */
  menuOptFrac: 0.11,
  /** Residual derivation correction so the realised per-snap rate matches the share. */
  callK: 1.07,

  // ── option keep: the unblocked edge man's discipline vs the QB's read/legs ─
  /** P(the edge crashes) at discipline 0; falls with his discipline (0..1). */
  crashBase: 0.5,
  crashDiscW: 0.5,
  crashLo: 0.12,
  crashHi: 0.85,
  /**
   * The QB's own exploit: `keepBase + legs·(keepLegsW + his AWR read)`. A QB with
   * no keep legs NEVER keeps, however well he reads it (a pocket QB gives).
   */
  keepBase: 0,
  keepLegsW: 0.9,
  keepReadW: 0.006,
  readCenter: 76,
  keepLo: 0.02,
  keepHi: 0.72,
  keepCap: 0.8,
  /** Edge discipline (0..1) from his PRC/AWR; centre for the yardage effect. */
  edgePrcW: 0.5,
  edgeAwrW: 0.5,
  discCenter: 60,
  discSpan: 30,
  /** Yards taken off a keep per rating point of the unblocked edge's discipline. */
  edgeYardW: 0.16,
  edgeDiscCenter: 76,
} as const

export type QbRunKind = 'sneak' | 'draw' | 'option'

const SNEAK_RUNS = new Set(['Sneak', 'QB Sneak'])
const DRAW_RUNS = new Set(['QB Draw'])
const OPTION_RUNS = new Set(['Zone Read', 'Read Option', 'RPO Run'])

/** Which kind of QB-designed run this concept is, or null for a back's play. */
export function qbRunKind(name: string): QbRunKind | null {
  if (SNEAK_RUNS.has(name)) return 'sneak'
  if (DRAW_RUNS.has(name)) return 'draw'
  if (OPTION_RUNS.has(name)) return 'option'
  return null
}

/** True when the QB may carry on this concept (never on a back's concept). */
export function isQbRunConcept(name: string): boolean {
  return qbRunKind(name) !== null
}

// ── the specific quarterback's own ratings ───────────────────────────────────
const A = (p: Player): Record<string, number> => playerAttrs(p)
const r = (p: Player, a: Record<string, number>, k: string): number => positionRating(p.pos, a, k)

/** His legs composite (rating points; no unit/position average, no `?? 70`). */
export function qbLegs(p: Player): number {
  const a = A(p)
  return r(p, a, 'SPD') * QB_RUN.legsSpd + r(p, a, 'ACC') * QB_RUN.legsAcc
    + r(p, a, 'AGI') * QB_RUN.legsAgi + r(p, a, 'BCV') * QB_RUN.legsBcv
}

/**
 * His option-keep legs on 0..1 (0 statue, 1 elite runner) — a speed-first
 * composite, because what wins the edge on a read is the burst to get outside.
 */
export function qbLegs01(p: Player): number {
  const a = A(p)
  const keepLegs = r(p, a, 'SPD') * QB_RUN.keepLegsSpd
    + r(p, a, 'ACC') * QB_RUN.keepLegsAcc
    + r(p, a, 'AGI') * QB_RUN.keepLegsAgi
  return clamp((keepLegs - QB_RUN.legsLo) / (QB_RUN.legsHi - QB_RUN.legsLo), 0, 1)
}

/** His size, centred on the league QB weight (rating-point scale). */
function qbSize(p: Player): number {
  return clamp(((p.weight ?? QB_RUN.sizeCenter) - QB_RUN.sizeCenter) * (100 / QB_RUN.sizeSpan), -18, 18)
}

/**
 * P(the offence calls a sneak) on a run with <= sneakDist to go. His own
 * strength, size and vision decide it — a big, strong QB sneaks more.
 */
export function qbSneakProb(p: Player): number {
  const a = A(p)
  return clamp(
    QB_RUN.sneakBase
      + (r(p, a, 'STR') - 70) * QB_RUN.sneakStrW
      + qbSize(p) * QB_RUN.sneakSizeW
      + (r(p, a, 'BCV') - 70) * QB_RUN.sneakBcvW,
    QB_RUN.sneakLo,
    QB_RUN.sneakHi,
  )
}

/**
 * THE shared per-QB rate: his expected designed carries per designed run. Both
 * playsim (per snap) and statAlloc (score-only) call exactly this.
 *   = sneak share (his own size/STR/BCV) + the legs-scaled QB-concept share.
 */
export function qbDesignShare(p: Player): number {
  const sneakPart = QB_RUN.shortFrac * qbSneakProb(p)
  const conceptPart = QB_RUN.shareGain * Math.exp((qbLegs(p) - QB_RUN.shareMid) / QB_RUN.shareSlope)
  return clamp(sneakPart + conceptPart, QB_RUN.shareLo, QB_RUN.shareHi)
}

/**
 * A representative unblocked edge man, for the score-only mirror: a real DE/LB
 * reads ~PRC/AWR 80, so his discipline is well above the 60 floor and he stays
 * home more often than he crashes.
 */
const TYPICAL_EDGE: EdgeMan = { prc: 80, awr: 80, pur: 80 }

/**
 * E[the QB carries | a QB concept is called]: a plain draw always carries, an
 * option carries at the QB's own keep rate against a typical edge.
 */
export function qbCarryPerCall(p: Player): number {
  const keep = qbOptionKeepProb(p, TYPICAL_EDGE)
  const plain = QB_RUN.drawFrac + (1 - QB_RUN.drawFrac) * keep
  const o = QB_RUN.menuOptFrac
  return (1 - o) * plain + o * keep
}

/**
 * The derived per-snap P(the offence calls a QB concept over the RB run it
 * called), so the aggregate realised rate matches `qbDesignShare`. hash-only.
 */
export function qbCallProb(p: Player): number {
  const sneakPart = QB_RUN.shortFrac * qbSneakProb(p)
  const perCall = Math.max(0.05, qbCarryPerCall(p))
  const conceptShare = clamp((qbDesignShare(p) - sneakPart) / ((1 - sneakPart) * perCall), 0, 1)
  return clamp(conceptShare * QB_RUN.callK, 0, QB_RUN.callHi)
}

// ── the unblocked edge defender on an option ────────────────────────────────
export interface EdgeMan { prc: number; awr: number; pur: number }

export function edgeManOf(p: Player): EdgeMan {
  const a = A(p)
  return { prc: r(p, a, 'PRC'), awr: r(p, a, 'AWR'), pur: r(p, a, 'PUR') }
}

/** His discipline 0..1 (how faithfully he stays home instead of crashing). */
export function edgeDiscipline(e: EdgeMan): number {
  const d = e.prc * QB_RUN.edgePrcW + e.awr * QB_RUN.edgeAwrW
  return clamp((d - QB_RUN.discCenter) / QB_RUN.discSpan, 0, 1)
}

/** The average of his PRC/AWR in rating points (the yardage effect's centre). */
export function edgeReadRating(e: EdgeMan): number {
  return e.prc * QB_RUN.edgePrcW + e.awr * QB_RUN.edgeAwrW
}

/**
 * P(the QB keeps) on an option: the edge man crashing (he is undisciplined) times
 * the QB's own ability to exploit it (his legs) sharpened by his own read (AWR).
 * A pocket QB almost always gives.
 */
export function qbOptionKeepProb(p: Player, e: EdgeMan): number {
  const disc = edgeDiscipline(e)
  const crash = clamp(QB_RUN.crashBase - disc * QB_RUN.crashDiscW, QB_RUN.crashLo, QB_RUN.crashHi)
  const a = A(p)
  const read = (r(p, a, 'AWR') - QB_RUN.readCenter) * QB_RUN.keepReadW
  const exploit = clamp(QB_RUN.keepBase + qbLegs01(p) * (QB_RUN.keepLegsW + read), QB_RUN.keepLo, QB_RUN.keepHi)
  return clamp(crash * exploit, 0, QB_RUN.keepCap)
}

/**
 * The yards the unblocked edge man's own discipline takes off a keep: a
 * disciplined man (top PRC/AWR) who stays home costs the keep ground, an
 * undisciplined one who crashes gifts a little. The specific man's own numbers.
 */
export function qbEdgeYardEffect(e: EdgeMan): number {
  return -Math.round((edgeReadRating(e) - QB_RUN.edgeDiscCenter) * QB_RUN.edgeYardW)
}

// ── the sneak itself ────────────────────────────────────────────────────────
/**
 * P(the sneak converts) from the QB's own push (STR/size/BCV) against the
 * specific point-of-attack defender's own shed/power (BSH/TAK/STR).
 */
export function qbSneakConvert(qb: Player, poi: { bsh: number; tak: number; str: number }): number {
  const a = A(qb)
  const push = r(qb, a, 'STR') * 0.45 + r(qb, a, 'BCV') * 0.15 + qbSize(qb) * 0.6 + r(qb, a, 'IMP') * 0.05
  const stuff = poi.bsh * 0.5 + poi.tak * 0.3 + poi.str * 0.2
  return clamp(QB_RUN.sneakConvBase + (push - stuff) * QB_RUN.sneakConvSlope, QB_RUN.sneakConvLo, QB_RUN.sneakConvHi)
}

/** The sneak's points of attack (the specific interior men on the field). */
export interface SneakDef { bsh: number; tak: number; str: number }

export function sneakDefenderOf(p: Player): SneakDef {
  const a = A(p)
  return { bsh: r(p, a, 'BSH'), tak: r(p, a, 'TAK'), str: r(p, a, 'STR') }
}

const OPTION_POOL = ['Zone Read', 'Read Option', 'RPO Run'] as const
/** What a back's play turns into when the QB concept is NOT called for him. */
const RB_FALLBACK: Record<string, string> = {
  'QB Draw': 'Draw',
  'Zone Read': 'Outside Zone',
  'Read Option': 'Outside Zone',
  'RPO Run': 'Inside Zone',
  'Sneak': 'Inside Zone',
  'QB Sneak': 'Inside Zone',
}

/**
 * The concept actually called for this specific quarterback, whatever the sheet
 * said. A sneak on short yardage; otherwise his own legs decide whether the
 * offence calls a QB concept at all — a draw, or an option he may still give on
 * the read. A QB concept the menu called is honoured only when his legs justify
 * it, else a back runs it. Hash-only, never a team mean.
 */
export function qbEffectiveCall(name: string, qb: Player, distance: number, key: string): string {
  const k = qbRunKind(name)
  if (k === 'sneak') return name // an explicit sneak is never overruled
  // Short yardage: first the sneak, then (if it is not one) the same legs-driven
  // concept call as any other snap.
  if (distance <= QB_RUN.sneakDist && h01(`${key}:sn`, SALT_SNEAK) < qbSneakProb(qb)) return 'Sneak'
  const gate = h01(`${key}:qc`, SALT_CALL) < qbCallProb(qb)
  if (k) return gate ? name : (RB_FALLBACK[name] ?? 'Inside Zone')
  if (gate) return h01(`${key}:qd`, SALT_KIND) < QB_RUN.drawFrac ? 'QB Draw' : OPTION_POOL[hash32(`${key}:qo`, SALT_OPTION) % OPTION_POOL.length]
  return name
}

/** The QB's read on an option: keep (true) or give it to the back (false). */
export function qbKeepsOnRead(qb: Player, e: EdgeMan, key: string): boolean {
  return h01(`${key}:keep`, SALT_KIND) < qbOptionKeepProb(qb, e)
}

/**
 * The sneak's yards: his own push against the specific point-of-attack defender.
 * On a conversion he gets the yard to go (plus a step past it sometimes); a
 * stuff loses a yard or is stopped at the line. Deterministic (hash-only).
 */
export function qbSneakGain(qb: Player, poi: Player | undefined, distance: number, key: string): number {
  const conv = poi ? qbSneakConvert(qb, sneakDefenderOf(poi)) : QB_RUN.sneakConvBase
  if (h01(`${key}:sc`, SALT_SNEAK) < conv) {
    return Math.max(1, Math.round(Math.max(1, distance))) + (h01(`${key}:se`, SALT_SNEAK + 1) < 0.35 ? 1 : 0)
  }
  return h01(`${key}:sf`, SALT_SNEAK + 2) < 0.5 ? 0 : -1
}

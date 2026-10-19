// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #39 — HARD COUNTS.
//
// The QB's cadence against the men across from him, and the offence's own snap
// count against its own linemen. Every effect is ONE man's own rating or trait,
// measured against the fixed starter mean for HIS position (POS_MEAN) — never a
// unit or roster average:
//   • DEFENSIVE OFFSIDE / ENCROACHMENT / NEUTRAL-ZONE INFRACTION — the QB under
//     centre uses his cadence (his own AWR + his own experience + his own trait)
//     to get a man to jump. The man who jumps is the front-seven defender with
//     the worst own discipline (his own AWR vs his position's starter mean): the
//     least disciplined man across from the best cadence is likeliest to jump;
//   • FALSE START — the line's own snap count. The jumpiest lineman (his own AWR
//     and his own experience/age) is the likeliest offender, the centre's own
//     experience calms the whole line (he is the one who sets the count), and a
//     loud road house rattles everyone (FUTURES #6's crowd term). A veteran line
//     with an experienced centre false-starts less; a young, undisciplined line
//     false-starts more;
//   • 4th-and-short HARD COUNT — the QB deliberately holds the count to draw the
//     defence offside (his side of the offside weight rises), with the real risk
//     of a delay of game or his own line jumping (the pre-snap offensive risk
//     rises on the same snap).
//
// DETERMINISM. Zero rng() draws are added or removed: the two per-snap penalty
// draws in `playsim.step()` are untouched, and everything here is arithmetic on
// the ratings plus `hash32`/`h01` on the play number for the label. The model
// only shifts the WEIGHT of the offside / false-start type inside the tier the
// existing draw already picked, so with the toggle OFF the resolver never reads
// this file and `step()` is byte-identical.
//
// CALIBRATION. Every knob lives in `HARD_COUNT` and nowhere else. Each multiplier
// is centred on the measured league mean of its own raw term (`…Center`, printed
// by the probe's HC_STAT table), so a league-average man carries exactly 1 and
// the engine's calibrated league totals do not drift; only the spread between
// individuals moves. `on` is the ship switch.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player } from '../types'
import { playerAttrs } from '../data/ratings'
import { POS_MEAN } from './ratingMeans'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** The man's own rating, else his position's starter mean, else 70. Never a unit
 *  average (POS_MEAN is the fixed reference every E/J layer shares). */
function rating(p: Player | undefined, key: string): number {
  if (!p) return 70
  const v = playerAttrs(p)[key]
  if (v !== undefined) return v
  return POS_MEAN[p.pos]?.[key] ?? 70
}

/** League-relative: 0 is the average starter at that man's own position. */
function rel(p: Player | undefined, key: string): number {
  if (!p) return 0
  const m = POS_MEAN[p.pos]?.[key]
  return m === undefined ? 0 : rating(p, key) - m
}

export interface HardCountStat {
  /** the probe turns accumulation off when it is not measuring. */
  on: boolean
  /** raw QB-cadence term, per snap the defence is asked (the <Center> is measured
   *  from a long probe; the probe prints the league mean here). */
  cadN: number
  cadSum: number
  /** raw worst-defender discipline term (−(his own AWR − his position mean)). */
  discN: number
  discSum: number
  /** raw offensive snap-count term. */
  fsN: number
  fsSum: number
  /** snaps where the offence chose the 4th-and-short hard count. */
  hcN: number
  /** pre-snap flags charged by this module. */
  flags: number
  /** the DEFENSIVE offside weight multiplier actually applied, per snap asked. */
  offN: number
  offSum: number
  /** the offensive snap-count multiplier actually applied, per snap. */
  offGateN: number
  offGateSum: number
}

/** Probe accumulator (read-only; never touched by the sim's own logic). */
export const HC_STAT: HardCountStat = { on: true, cadN: 0, cadSum: 0, discN: 0, discSum: 0, fsN: 0, fsSum: 0, hcN: 0, flags: 0, offN: 0, offSum: 0, offGateN: 0, offGateSum: 0 }

export const HARD_COUNT = {
  // Ship switch. See the CALIBRATION note above.
  on: true,

  // ── the QB's cadence (his own AWR, his own experience, his own trait) ───────
  /** rating points → the raw term; the man is the term. */
  cadAwrW: 1.0,
  /** his own trait, in the same units (a Field General runs a mean count; an
   *  improviser a loose one). */
  cadFieldGeneral: 4, cadPocket: 1.5, cadImproviser: -2.5, cadDual: -2,
  /** his own experience (age − 24), in the same units — a veteran works the count. */
  cadExpW: 0.45, cadExpCap: 12,
  /** measured league mean of the raw term (probe HC_STAT.cad) — a league-average
   *  cadence carries exactly 1. */
  cadCenter: 2.30, cadSlope: 0.028, cadLo: 0.55, cadHi: 1.75,

  // ── the jumper's own discipline (the worst-disciplined front-seven man) ─────
  /** the raw term is −(his own AWR − his position's starter mean), so a man below
   *  his position's mean is likelier to jump. */
  discSlope: 0.011, discLo: 0.62, discHi: 1.75, discCenter: 14.40,

  // ── offensive snap count ────────────────────────────────────────────────────
  /** the raw term: the worst lineman's own AWR vs his position's mean, the
   *  centre's own AWR (halved — he sets the count, he is not the jumper), and both
   *  men's own experience (their age beyond 24). */
  fsCentreW: 0.5, fsExpW: 0.5, fsExpCap: 12,
  fsCenter: -10.24, fsSlope: 0.012, fsLo: 0.55, fsHi: 1.75,
  /** road crowd: extra false-start weight per unit of the loud-house tilt. */
  crowdW: 0.35,

  // ── 4th-and-short hard count ────────────────────────────────────────────────
  /** the hard count is used at 4th and <= this distance. */
  hcDist: 2,
  /** the draw: the offside weight rises by this factor on the hard-count snap. */
  hcDrawW: 2.0,
  /** the risk: the pre-snap offensive weight (delay + false start) rises by this. */
  hcRiskW: 1.5,

  // ── the shipped league level ────────────────────────────────────────────────
  /** the def tier-5 offside weight at a league-average man, replacing
   *  PEN_DEF_W.offside (0.30) so defensive offside/encroachment/NZI land at the
   *  NFL ~0.6/team-game. The other tier-5 defensive weights are unchanged, so the
   *  TIER total (and every point/first-down the tier produces) is untouched: only
   *  the split between the offside kinds and defensive holding/illegal contact
   *  moves. */
  offsideW: 0.121,
  /** the off tier-5 false-start weight at an average line, replacing
   *  PEN_OFF_W.falseStart (0.28) while the crowd / snap-count terms move. */
  falseStartW: 0.28,
}

const HC = HARD_COUNT as unknown as Record<string, number> & { on: boolean }

/** FUTURES #39: the ship switch (see the CALIBRATION note). */
export function setHardCount(on: boolean): void {
  HC.on = on
}
/** Read the toggle so a probe can restore it exactly. */
export function getHardCount(): boolean {
  return HC.on
}

/** Probe sample: accumulate the raw terms this module's centres are measured
 *  from (once per snap, in `playsim.step()`; never read by the sim's own logic). */
export function hardCountSample(off: Player[] | undefined, def: Player[] | undefined, down?: number, distance?: number): void {
  if (!HC_STAT.on) return
  const qb = (off ?? []).find((p) => p.pos === 'QB')
  HC_STAT.cadN += 1; HC_STAT.cadSum += cadenceTerm(qb)
  HC_STAT.discN += 1; HC_STAT.discSum += disciplineTerm(def)
  HC_STAT.fsN += 1; HC_STAT.fsSum += snapCountTerm(off)
  HC_STAT.offN += 1; HC_STAT.offSum += offsideMult(qb, def, down, distance)
  HC_STAT.offGateN += 1; HC_STAT.offGateSum += snapCountMult(off)
  if (isHardCountSnap(down, distance)) HC_STAT.hcN += 1
}

// ── the QB's cadence ─────────────────────────────────────────────────────────
/** His own cadence term: AWR, trait, experience. The man is the term. */
export function cadenceTerm(qb: Player | undefined): number {
  if (!qb) return 0
  const t = (qb.traits ?? []).join(' ').toLowerCase()
  let trait = 0
  if (t.includes('field general')) trait += HC.cadFieldGeneral
  if (t.includes('pocket passer')) trait += HC.cadPocket
  if (t.includes('improviser')) trait += HC.cadImproviser
  if (t.includes('dual threat')) trait += HC.cadDual
  const exp = clamp((qb.age ?? 25) - 24, 0, HC.cadExpCap)
  return rel(qb, 'AWR') * HC.cadAwrW + trait + exp * HC.cadExpW
}

/** The cadence multiplier (league mean 1 at HC.cadCenter). */
export function cadenceMult(qb: Player | undefined): number {
  const term = cadenceTerm(qb)
  return clamp(1 + (term - HC.cadCenter) * HC.cadSlope, HC.cadLo, HC.cadHi)
}

// ── the jumper ───────────────────────────────────────────────────────────────
const FRONT = new Set(['DE', 'DT', 'LB'])
/** The front-seven man with the worst own discipline (his own AWR vs his own
 *  position mean) — the man likeliest to jump the count. */
export function jumpiest(def: Player[] | undefined): Player | undefined {
  let out: Player | undefined
  let worst = Infinity
  for (const p of def ?? []) {
    if (!FRONT.has(p.pos)) continue
    const v = rel(p, 'AWR')
    if (v < worst) { worst = v; out = p }
  }
  return out
}

/** The discipline term of the jumpiest man (−(his own AWR − his position mean)). */
export function disciplineTerm(def: Player[] | undefined): number {
  const p = jumpiest(def)
  return p ? -rel(p, 'AWR') : 0
}

// ── the offence's own snap count ─────────────────────────────────────────────
const LINE = new Set(['OT', 'OG', 'C'])
/** The jumpiest lineman on the field (his own AWR vs his own position mean). */
export function jumpiestLineman(off: Player[] | undefined): Player | undefined {
  let out: Player | undefined
  let worst = Infinity
  for (const p of off ?? []) {
    if (!LINE.has(p.pos)) continue
    const v = rel(p, 'AWR')
    if (v < worst) { worst = v; out = p }
  }
  return out
}

/** The snap-count term: the jumpiest lineman's own AWR + the centre's own AWR
 *  (halved — he sets the count) + both men's own experience. */
export function snapCountTerm(off: Player[] | undefined): number {
  const jumper = jumpiestLineman(off)
  const centre = (off ?? []).find((p) => p.pos === 'C')
  const jump = rel(jumper, 'AWR')
  const ctr = rel(centre, 'AWR') * HC.fsCentreW
  // Experience is the man's own age beyond 24 — the veteran who has heard the
  // count a thousand times.
  const expOf = (p: Player | undefined) => (p ? clamp((p.age ?? 25) - 24, 0, HC.fsExpCap) * HC.fsExpW : 0)
  return jump + ctr + expOf(jumper) + expOf(centre) * 0.5
}

/**
 * The offence's snap-count multiplier. Applied to the per-snap offensive penalty
 * gate, so a disciplined veteran line commits fewer pre-snap fouls and a young,
 * jumpy line more: the gate FALLS as the line's own term rises. Centred (league
 * mean 1) so the league's totals hold; the false starts themselves are the largest
 * share of what the gate produces.
 */
export function snapCountMult(off: Player[] | undefined): number {
  const term = snapCountTerm(off)
  return clamp(1 - (term - HC.fsCenter) * HC.fsSlope, HC.fsLo, HC.fsHi)
}

/** The road crowd rattles the count: extra false-start weight in a loud house. */
export function crowdFalseStart(crowd: number): number {
  return clamp(1 + (crowd - 1) * HC.crowdW, 0.6, 2.2)
}

// ── the 4th-and-short hard count ─────────────────────────────────────────────
/** The QB holds the count on 4th and short to draw the defence offside. */
export function isHardCountSnap(down: number | undefined, distance: number | undefined): boolean {
  const d = down ?? 0
  const dist = distance ?? 99
  return d === 4 && dist <= HC.hcDist
}

// ── the combined multipliers ─────────────────────────────────────────────────
/**
 * The defensive offside weight multiplier: the QB's cadence against the jumper's
 * own discipline, and the deliberate 4th-and-short draw. League mean 1.
 */
export function offsideMult(qb: Player | undefined, def: Player[] | undefined, down?: number, distance?: number): number {
  const disc = clamp(1 + (disciplineTerm(def) - HC.discCenter) * HC.discSlope, HC.discLo, HC.discHi)
  const cad = cadenceMult(qb)
  const draw = isHardCountSnap(down, distance) ? HC.hcDrawW : 1
  return clamp(cad * disc * draw, 0.4, 3.0)
}

/** The false-start weight multiplier: the snap count and the road crowd. */
export function falseStartMult(off: Player[] | undefined, crowd: number): number {
  return clamp(snapCountMult(off) * crowdFalseStart(crowd), 0.4, 3.0)
}

/** The delay-of-game weight multiplier on a hard-count snap (the risk the QB
 *  takes when he holds the count). */
export function delayMult(down: number | undefined, distance: number | undefined): number {
  return isHardCountSnap(down, distance) ? HC.hcRiskW : 1
}

/** The pre-snap offensive risk on a hard-count snap: the line can jump too. */
export function hardCountRisk(down: number | undefined, distance: number | undefined): number {
  return isHardCountSnap(down, distance) ? HC.hcRiskW : 1
}

// ── the flag's name ──────────────────────────────────────────────────────────
/** The real pre-snap defensive foul behind an `offside` flag: encroachment (he
 *  made contact), a neutral-zone infraction (he was in the zone at the snap), or
 *  a plain offside. Deterministic from the play key. */
export function offsideLabel(key: string): 'Encroachment' | 'Neutral zone infraction' | 'Offside' {
  // A simple 16-bit mix so the three names split roughly 30/35/35.
  let h = 2166136261 >>> 0
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  const r = h % 100
  return r < 30 ? 'Encroachment' : r < 65 ? 'Neutral zone infraction' : 'Offside'
}

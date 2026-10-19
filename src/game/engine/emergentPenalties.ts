// ─────────────────────────────────────────────────────────────────────────────
// r2penalties — the fouls come off the field (NEXT_PHASE_REALISM2 item 2).
//
// Today every flag is two flat per-snap rate draws in `playsim.step()`:
// `s.rng() < R2.penDefRate × coach/cohesion/mental` then the same on offence, and
// the type/offender are picked by hash from roster-wide mean terms (R14 + J8d).
// The men on the play never decide whether a foul happened.
//
// Here each of the ten kinds is asked of the specific men on the play, on the
// same live field the E1/E2/E3 layers already run:
//   • offensive holding — a blocker who actually LOST his rep. On a dropback it
//     is the E3 technique margin on E3's own weights (`EMERGENT_E3`, the pass set
//     of `emergentRush.ts`: move/get-off/bull vs set/anchor/mirror), converted to
//     seconds by E3's own `techSec`; on a run it is the E1 run-block contest
//     (RBK/IMP vs BSH/STR — the blend `emergent.ts` uses for the block-win time).
//     A beaten blocker holds: the margin, plus HIS OWN discipline (AWR), decides,
//     and the most-beaten man on the line is the likeliest offender;
//   • false start — the jumpiest man on the line, his own AWR against the crowd
//     and the play clock (hurry), not a team average;
//   • offside — FUTURES #39: the DEFENCE's own discipline against the offence's
//     QB cadence (the QB's own AWR is the hard count);
//   • DPI / illegal contact — real contact before the catch: each cover man on
//     the play carries the margin the offence's best receiver has on HIM (his own
//     MCV/SPD/AGI against the receiver's own SPD/RLS/AGI) plus his own discipline;
//     DPI is a spot foul on the concept's air yards;
//   • defensive holding / unnecessary roughness — each defender's OWN AWR
//     (discipline), among the men at the positions the NFL truth says commit them
//     (CB/DT/LB for holding; LB/CB/S/DT for UR);
//   • roughing the passer — a late hit by the man who actually got home: each
//     front-seven rusher's own PMV/FMV.
// Every weight is ONE man's own rating against his own position's fixed starter
// mean (POS_MEAN, the same reference E1/E2/E3 and every J-layer use). Never a
// unit or roster average: the man is the unit. A league-average man carries
// exactly 1, so the league totals hold while the spread between individuals
// opens up; the offender is a real player id, as R14/J8d already recorded.
//
// DETERMINISM. Zero `rng()` draws are added or removed. The draw the replaced
// rate test consumed is still taken at the same point in the stream and is the
// ONLY randomness here (`roll` is the gate); every other decision is
// `hash32`/`h01` on `${n}:${defId}:pen…`, exactly the J8a/J8d pattern. With the
// field ON it REPLACES the flat per-snap rate draw in `playsim.step()` (the men
// decide whether, what kind and who); with `setEmergentPen(false)` — and with no
// individual units — the resolver never reads this file and `step()` is
// byte-identical to the base.
//
// CALIBRATION. Every knob lives in `EMERGENT_PEN` and nowhere else. The
// `…Center` values are the measured league means of the raw field terms
// (`analysis/r2pen_nfl.py` is the NFL target; `PEN_STAT` accumulates the raw
// terms for the probe), so a league-average club fouls at the NFL rate and only
// the spread between men moves. The `on` flag is the ship switch: it stays OFF
// because the 6-seed drift misses the job's own |penaltyYds| <= 0.1 cap by
// 0.083 yd (measured -0.183 +/- 0.226 sd/sqrt6 — inside the sampling noise of a
// rate-replacing model, but the rule is the rule) and the 3x500 panel has four
// off-band cells (see ~/gridiron-work/logs/r2penalties-verify.out, FINAL). The
// realism targets, OFF byte-identity and every machine gate pass; flipping
// `on: true` (or `setEmergentPen(true)`) is the one-line enable.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player } from '../types'
import { hash32 } from './rng'
import { POS_MEAN } from './ratingMeans'
import { EMERGENT_E3 } from './emergentRush'
import type { PenaltyKind } from './playsim'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const h01 = (key: string) => (hash32(key) >>> 0) / 4294967296

/** League-relative rating: 0 = the average man at that position — never a unit
 *  or roster mean (POS_MEAN is the fixed starter average, the shared reference). */
function rel(pos: string | undefined, key: string, val: number): number {
  const m = pos ? POS_MEAN[pos]?.[key] : undefined
  return m === undefined ? 0 : val - m
}

export const EMERGENT_PEN = {
  // Ship state: OFF (see the CALIBRATION note above). The field model is complete
  // and verified — the probe's elite-vs-poor spreads, the offender positions and
  // the league totals all match the NFL truth — but the ship rule ("ON only if
  // every target passes") is not met: the 6-seed pooled |penaltyYds| drift is
  // 0.183 against a 0.1 cap and four 3x500 band cells are out. `on: true` is the
  // enable; `setEmergentPen(false)` is the dev toggle.
  on: false,
  // ── the base chance of each foul ────────────────────────────────────────────
  // Per snap at a league-average man (every per-man weight is centred on 1); a
  // pass-only kind is simply absent on a run. The field REPLACES the flat rate
  // draw, so these are the per-kind rates of the engine's OWN calibrated league
  // mix, measured off the field-off probe (n=120 club-games; `analysis/r2pen_nfl.py`
  // is the nflverse truth the probe prints for comparison). The ON rate is exactly
  // linear in its base — the gate throws with probability Σ b_k·w_k and picks the
  // kind in proportion to b_k·w_k, so kind k's realised rate is b_k·(w of its
  // picked man)·scale — so each base carries the measured OFF/ON correction from
  // the probe pair (probe-off.out vs r2pen-probe-final2.log, 120 club-games each):
  //   holdingOff ×1.103, falseStart ×1.023, delay ×0.824, dpi ×0.954,
  //   illegalContact ×1.880, opi ×0.818, holdDef ×1.429, offside ×1.050,
  //   roughing ×0.867, unnecessary ×0.967
  // (the big illegalContact/holdDef factors are 5–7σ, n=59/150). The league mix is
  // held because it is what the automatic-first-down rate — and so points, first
  // downs and the 500-game bands — rides on: a mix moved to the nflverse per-type
  // shares (the same module, one calibration) measured points -0.40, first downs
  // -1.22 and two 500-game band cells, i.e. it breaks the drift gate. The realism
  // is in who and why (the rep / the contact / the cadence), not the league split.
  holdOff: 0.009092,
  falseStart: 0.016104,
  delay: 0.00239,
  dpi: 0.009914,
  illegalContact: 0.009392,
  opi: 0.003144,
  holdDef: 0.007841,
  offside: 0.009186,
  roughing: 0.002479,
  unnecessary: 0.00333,
  // ── the man who is beaten (holding): the E3/E1 rep margin ───────────────────
  /** Rating points → flag weight. An average rep is 0; one point of a lost rep
   *  adds this much. The centre is the measured league mean of the raw term
   *  (PEN_STAT.holdPass0 / holdRun0), so a league-average rep is exactly 1. */
  holdPassW: 3.4, holdPassCenter: 0.066, holdPassLo: 0.30, holdPassHi: 2.60,
  holdRunW: 0.020, holdRunCenter: 0.459, holdRunLo: 0.30, holdRunHi: 2.60,
  /** The blocker's own discipline: his AWR, per point below his position mean. */
  holdAwrW: 0.024, holdAwrLo: 0.35, holdAwrHi: 1.95,
  /** Measured re-centre: the per-snap chance is the man's own weight times the
   *  base, and the offender pick weights the pool by those same terms, so the
   *  realised mean is E[w²]/E[w] (never 1). `scale` is the one global knob that
   *  puts the realised league total back on the league's own field-off rate; the
   *  per-kind bases above already carry their own measured correction on top of
   *  it. 1.285 ships, held by the probe pair and the 6x500 drift. */
  scale: 1.1533,
  // ── pre-snap discipline (false start / offside / defensive holding) ─────────
  /** His own AWR per point below his position mean. */
  preAwrW: 0.026, preAwrLo: 0.45, preAwrHi: 1.90,
  /** FUTURES #39: the QB's own cadence (his AWR) draws the defence offside. */
  cadenceW: 0.014, cadenceLo: 0.80, cadenceHi: 1.25,
  // ── coverage fouls (DPI / illegal contact) ─────────────────────────────────
  /** The receiver's own threat: how hard he is to mirror (SPD / release / AGI). */
  threatSpd: 0.45, threatRls: 0.35, threatAgi: 0.20,
  /** The cover man's own mirror (MCV / SPD / AGI) — his own, never the unit's. */
  coverMcv: 0.55, coverSpd: 0.25, coverAgi: 0.20,
  /** Points of the receiver's margin on him → flag weight (DPI / contact). The
   *  centre is the measured league mean of the picked man's own margin. */
  dpiMarginW: 0.055, dpiMarginCenter: 4.719, dpiMarginLo: 0.30, dpiMarginHi: 2.80,
  icMarginW: 0.045, icMarginCenter: 4.719, icMarginLo: 0.30, icMarginHi: 2.40,
  /** …and his own discipline (AWR) on top. */
  covAwrW: 0.022, covAwrLo: 0.35, covAwrHi: 2.00,
  // ── the late hit (roughing): the man who actually got home ─────────────────
  /** The best front-seven move (PMV/FMV) per point above his position mean. */
  rushW: 0.030, rushLo: 0.30, rushHi: 2.60,
  // ── the spot foul ──────────────────────────────────────────────────────────
  /** DPI yards: the concept's air yards carry the spot. The spotted mean is
   *  re-centred on the engine's OWN calibrated dpi mean (13.24 yd, probe-off.out)
   *  because the drift gate is ON vs main; the nflverse truth (15.81) is what the
   *  probe prints beside it. */
  dpiDepth: 0.62, dpiBase: 7.7, dpiJitter: 6, dpiLo: 5, dpiHi: 45,
  // ── the yardage of every other kind (NFL truth means, the R14 tiers) ───────
  yards: {
    holdingOff: 10, falseStart: 5, holdingDef: 5, illegalContact: 5, offside: 5,
    opi: 10, roughing: 15, unnecessary: 15, delay: 5,
  } as Partial<Record<PenaltyKind, number>>,
} as const

/** The object above is const; only `on` is ever written (the setJ13 pattern). */
interface MutablePen { on: boolean }
const PENCFG = EMERGENT_PEN as unknown as MutablePen

/** r2penalties: turn the field foul model on/off (OFF ⇒ the base rate path). */
export function setEmergentPen(on: boolean): void {
  PENCFG.on = on
}
/** r2penalties: read the toggle so a probe can restore it exactly. */
export function getEmergentPen(): boolean {
  return PENCFG.on
}

/** Dev accumulator (turned on by the probe; never read by the sim). */
export const PEN_STAT = {
  on: true,
  n: 0,
  /** Raw, uncentred field terms over EVERY candidate (the pool context). */
  holdPass0: 0, holdPassN: 0,
  holdRun0: 0, holdRunN: 0,
  dpiMargin0: 0, dpiMarginN: 0,
  /** The raw term of the man the hash actually named, per kind — the `…Center`
   *  knobs are the league means of THESE (the realised pool pick). */
  raw: {} as Record<string, { sum: number; n: number }>,
  /** Per-kind flags charged and the offenders, for the probe's mix table. */
  kind: {} as Record<string, number>,
  byPos: {} as Record<string, number>,
}

/** Accumulate one man's raw term (probe only). */
function noteRaw(kind: string, raw: number): void {
  if (!PEN_STAT.on) return
  const r = (PEN_STAT.raw[kind] ??= { sum: 0, n: 0 })
  r.sum += raw
  r.n += 1
}

export interface PenFoul {
  kind: PenaltyKind
  player: Player
  yards: number
}

export interface PenSideIn {
  /** The snap counter (the seed). */
  n: number
  offId: string
  defId: string
  /** The concept decided for this snap (J13 has already run). */
  type: 'run' | 'pass'
  depth: number
  yard: number
  /** The eleven men the sim has on each side (J8d's own units). */
  off: Player[]
  def: Player[]
  /** The draw the base rate test consumed — never a new draw. */
  roll: number
  /** The base block's own side multipliers (J9 discipline × cohesion / mental). */
  disc: number
  mental: number
  /** Situational multipliers the base block applies to the whole side. */
  hurry: number
  crowd: number
  /** The sim's effective-rating reader (`eff` — the J8A2 position fallback kept). */
  rate: (p: Player, key: string) => number
  /** The offence's QB: his cadence is the hard count the defence sits through. */
  qb?: Player
}

/** One man and his own weight on one kind (≥1 fouls more, ≤1 less, mean 1). */
interface Cand { p: Player; w: number; raw?: number; rawKey?: string }

/** Weighted hash pick (the base engine's own `hashPick`, no rng draw). */
function hashPick(list: Cand[], key: number): Player | undefined {
  if (!list.length) return undefined
  const total = list.reduce((s, t) => s + Math.max(0, t.w), 0)
  if (total <= 0) return list[key % list.length].p
  let roll = (key / 4294967296) * total
  for (const t of list) {
    const w = Math.max(0, t.w)
    if (roll < w) return t.p
    roll -= w
  }
  return list[list.length - 1].p
}

/** DPI is a spot foul: the spot is where the contact happened, read off the
 *  concept's air yards and jittered by hash (NFL mean 15.8 yd, 2021-25). */
function dpiYards(depth: number, key: string): number {
  const c = EMERGENT_PEN
  const spot = depth * c.dpiDepth + c.dpiBase + (h01(`${key}:spot`) - 0.5) * c.dpiJitter
  return Math.round(clamp(spot, c.dpiLo, c.dpiHi))
}

function yardsOf(kind: PenaltyKind, depth: number, key: string): number {
  if (kind === 'dpi') return dpiYards(depth, key)
  return EMERGENT_PEN.yards[kind] ?? 5
}

/** Note the flag for the probe (never read by the sim). */
function note(kind: PenaltyKind, p: Player): void {
  if (!PEN_STAT.on) return
  PEN_STAT.kind[kind] = (PEN_STAT.kind[kind] ?? 0) + 1
  PEN_STAT.byPos[`${kind}:${p.pos}`] = (PEN_STAT.byPos[`${kind}:${p.pos}`] ?? 0) + 1
}

// ── the rep contests the holding flag is read off ─────────────────────────────

/**
 * The E3 pass-set technique margin in seconds (positive = the blocker is beaten):
 * E3's own weights on the same terms `repRace` (emergentRush.ts) scores — the
 * rusher's move/counter/get-off/bull against the blocker's set/anchor/mirror.
 * Read-only: it never re-runs the field and adds no draw.
 */
function passRepMargin(rusher: Player, blocker: Player, rate: (p: Player, k: string) => number): number {
  const E = EMERGENT_E3
  const pmv = rel(rusher.pos, 'PMV', rate(rusher, 'PMV'))
  const fmv = rel(rusher.pos, 'FMV', rate(rusher, 'FMV'))
  const getoff = rel(rusher.pos, 'ACC', rate(rusher, 'ACC'))
  const power = rel(rusher.pos, 'STR', rate(rusher, 'STR')) + rel(rusher.pos, 'BSH', rate(rusher, 'BSH')) * E.bshW
  const tech = Math.max(pmv, fmv) * E.moveW + Math.min(pmv, fmv) * E.counterW +
    getoff * E.getoffW + power * E.powerW
  const setQ = rel(blocker.pos, 'PBK', rate(blocker, 'PBK')) + rel(blocker.pos, 'IMP', rate(blocker, 'IMP')) * E.impW
  const anchor = rel(blocker.pos, 'STR', rate(blocker, 'STR')) * E.anchorW
  const mirror = rel(blocker.pos, 'AGI', rate(blocker, 'AGI')) * E.mirrorW +
    rel(blocker.pos, 'AWR', rate(blocker, 'AWR')) * E.awrW
  return (tech - setQ * E.setW - anchor - mirror) * E.techSec
}

/**
 * The E1 run-block margin in rating points (positive = the blocker is beaten):
 * `emergent.ts`'s own blend for the block-win time — the blocker's RBK/IMP
 * against the defender's BSH/STR, on the same 70/30 vs 50/50 split, each man
 * relative to his own position's mean.
 */
function runRepMargin(defender: Player, blocker: Player, rate: (p: Player, k: string) => number): number {
  const blk = rel(blocker.pos, 'RBK', rate(blocker, 'RBK')) * 0.7 + rel(blocker.pos, 'IMP', rate(blocker, 'IMP')) * 0.3
  const dfn = rel(defender.pos, 'BSH', rate(defender, 'BSH')) * 0.5 + rel(defender.pos, 'STR', rate(defender, 'STR')) * 0.5
  return dfn - blk
}

/** A man's own discipline: his AWR per point below his position's mean. */
function discW(p: Player, rate: (p: Player, k: string) => number, w: number, lo: number, hi: number): number {
  return clamp(1 - rel(p.pos, 'AWR', rate(p, 'AWR')) * w, lo, hi)
}

const isOL = (p: Player) => p.pos === 'OT' || p.pos === 'OG' || p.pos === 'C'
const isDl = (p: Player) => p.pos === 'DE' || p.pos === 'DT'
/** The men the NFL truth names for coverage fouls: CB 970 + S/DB 300 of DPI. */
const isDb = (p: Player) => p.pos === 'CB' || p.pos === 'S'
const isTarget = (p: Player) => p.pos === 'WR' || p.pos === 'TE' || p.pos === 'RB'

/**
 * OFFENSIVE flags from the field. Each kind's pool is the men who can commit it
 * and each weight is that man's own term; the hash names the offender, then the
 * consumed draw decides whether the flag is thrown.
 */
export function penOffenseFoul(inp: PenSideIn): PenFoul | undefined {
  const c = EMERGENT_PEN
  const { off, def, rate, n, offId } = inp
  const seed = `${n}:${offId}`
  const ol = off.filter(isOL)
  const rushers = def.filter(isDl)
  const pass = inp.type === 'pass'
  const pool: Partial<Record<PenaltyKind, Cand[]>> = {}
  const add = (kind: PenaltyKind, cand: Cand) => {
    ;(pool[kind] ??= []).push(cand)
  }
  // 1. Holding: every lineman carries his own rep — the E3 pass set on a dropback
  //    (the margin in seconds), the E1 run block on a run (rating points) — and
  //    his own discipline. The most-beaten man on the line is the likeliest man.
  if (ol.length) {
    const poolD = rushers.length ? rushers : def
    for (const b of ol) {
      // The man he is matched to: an edge rusher for a tackle, an interior man
      // for a guard/centre — the same alignment rule E3 uses, hash-ordered.
      const j = hash32(`${seed}:penopp:${b.id}`) % Math.max(1, poolD.length)
      const d = poolD[j]
      const margin = d ? (pass ? passRepMargin(d, b, rate) : runRepMargin(d, b, rate)) : 0
      if (d) {
        if (pass) { PEN_STAT.holdPass0 += margin; PEN_STAT.holdPassN += 1 }
        else { PEN_STAT.holdRun0 += margin; PEN_STAT.holdRunN += 1 }
      }
      const m = pass
        ? clamp(1 + (margin - c.holdPassCenter) * c.holdPassW, c.holdPassLo, c.holdPassHi)
        : clamp(1 + (margin - c.holdRunCenter) * c.holdRunW, c.holdRunLo, c.holdRunHi)
      add('holdingOff', {
        p: b, w: m * discW(b, rate, c.holdAwrW, c.holdAwrLo, c.holdAwrHi),
        raw: margin, rawKey: `holdingOff:${inp.type}`,
      })
    }
  }
  // 2. False start: the jumpiest man on the line, his own AWR (the crowd and the
  //    hurry are the base block's own whole-side multipliers, applied in `gate`).
  for (const b of ol.length ? ol : off) {
    add('falseStart', { p: b, w: discW(b, rate, c.preAwrW, c.preAwrLo, c.preAwrHi) })
  }
  // 3. OPI: the receiver who cannot separate and pushes off — his own release
  //    (RLS) and his own discipline, never a receiving-corps average.
  if (pass) {
    for (const r of off.filter(isTarget)) {
      const w = discW(r, rate, c.covAwrW, c.covAwrLo, c.covAwrHi) *
        clamp(1 - rel(r.pos, 'RLS', rate(r, 'RLS')) * 0.014, 0.5, 1.8)
      add('opi', { p: r, w })
    }
  }
  // 4. Delay of game: the man under centre.
  {
    const qb = inp.qb ?? off.find((p) => p.pos === 'QB')
    if (qb) add('delay', { p: qb, w: discW(qb, rate, c.preAwrW, c.preAwrLo, c.preAwrHi) })
  }
  return gate(pool, inp, seed, 'penO')
}

/** Every cover man's own margin against the offence's best available receiver. */
function coverPool(inp: PenSideIn): Array<{ p: Player; w: number; margin: number }> {
  const c = EMERGENT_PEN
  const { off, def, rate } = inp
  const targets = off.filter(isTarget)
  const covers = def.filter(isDb)
  if (!targets.length || !covers.length) return []
  const threat = (p: Player) =>
    rel(p.pos, 'SPD', rate(p, 'SPD')) * c.threatSpd +
    rel(p.pos, 'RLS', rate(p, 'RLS')) * c.threatRls +
    rel(p.pos, 'AGI', rate(p, 'AGI')) * c.threatAgi
  let bestT = -Infinity
  for (const t of targets) bestT = Math.max(bestT, threat(t))
  const out: Array<{ p: Player; w: number; margin: number }> = []
  for (const d of covers) {
    const mirror = rel(d.pos, 'MCV', rate(d, 'MCV')) * c.coverMcv +
      rel(d.pos, 'SPD', rate(d, 'SPD')) * c.coverSpd +
      rel(d.pos, 'AGI', rate(d, 'AGI')) * c.coverAgi
    const margin = bestT - mirror
    PEN_STAT.dpiMargin0 += margin
    PEN_STAT.dpiMarginN += 1
    out.push({ p: d, w: margin, margin })
  }
  return out
}

/**
 * DEFENSIVE flags from the field: each cover man the receiver has actually
 * beaten (DPI / illegal contact), the late hit by the man who got home
 * (roughing), the front's own pre-snap discipline against the QB's cadence
 * (offside, FUTURES #39) and each defender's own AWR (defensive holding /
 * unnecessary roughness).
 */
export function penDefenseFoul(inp: PenSideIn): PenFoul | undefined {
  const c = EMERGENT_PEN
  const { def, rate, n, defId, qb } = inp
  const seed = `${n}:${defId}`
  const pass = inp.type === 'pass'
  const pool: Partial<Record<PenaltyKind, Cand[]>> = {}
  const add = (kind: PenaltyKind, cand: Cand) => {
    ;(pool[kind] ??= []).push(cand)
  }
  // 5a/5b. Coverage contact: the man who is beaten grabs. Each cover man carries
  //     his own margin and his own discipline.
  if (pass) {
    for (const cand of coverPool(inp)) {
      const margin = cand.margin
      const dw = discW(cand.p, rate, c.covAwrW, c.covAwrLo, c.covAwrHi)
      const m = margin - c.dpiMarginCenter
      add('dpi', { p: cand.p, w: clamp(1 + m * c.dpiMarginW, c.dpiMarginLo, c.dpiMarginHi) * dw, raw: margin, rawKey: 'dpi' })
      add('illegalContact', { p: cand.p, w: clamp(1 + (margin - c.icMarginCenter) * c.icMarginW, c.icMarginLo, c.icMarginHi) * dw, raw: margin, rawKey: 'illegalContact' })
    }
  }
  // 6. Defensive holding: each defender's own AWR among the men the NFL truth
  //    says commit it (CB 449, the front, the back seven).
  for (const d of def.filter((p) => p.pos === 'CB' || p.pos === 'DT' || p.pos === 'LB' || p.pos === 'S')) {
    add('holdingDef', { p: d, w: discW(d, rate, c.preAwrW, c.preAwrLo, c.preAwrHi) })
  }
  // 7. Offside: FUTURES #39 — each front-seven man's own discipline against the
  //    offence's own cadence (the QB's AWR is the hard count drawing the jump).
  {
    const hard = qb ? clamp(1 + rel('QB', 'AWR', rate(qb, 'AWR')) * c.cadenceW, c.cadenceLo, c.cadenceHi) : 1
    for (const d of def.filter((p) => isDl(p) || p.pos === 'LB')) {
      add('offside', { p: d, w: discW(d, rate, c.preAwrW, c.preAwrLo, c.preAwrHi) * hard })
    }
  }
  // 8. Roughing the passer: a late hit by the man who actually got home — his own
  //    move (PMV/FMV), E3's own primary rusher term.
  if (pass) {
    for (const d of def.filter((p) => isDl(p) || p.pos === 'LB')) {
      const v = Math.max(rel(d.pos, 'PMV', rate(d, 'PMV')), rel(d.pos, 'FMV', rate(d, 'FMV')))
      add('roughing', { p: d, w: clamp(1 + v * c.rushW, c.rushLo, c.rushHi) })
    }
  }
  // 9. Unnecessary roughness: a late hit after the whistle from the man whose own
  //    AWR is worst (NFL truth: LB 138, CB 118, S 114, DT 86, DE 63).
  for (const d of def.filter((p) => p.pos === 'LB' || p.pos === 'CB' || p.pos === 'S' || isDl(p))) {
    add('unnecessary', { p: d, w: discW(d, rate, c.preAwrW, c.preAwrLo, c.preAwrHi) })
  }
  return gate(pool, inp, seed, 'penD')
}

/**
 * The gate: the consumed `rng()` draw is the ONE randomness. The side's per-snap
 * chance is the sum of the men's own terms, times the base block's whole-side
 * multipliers, so every J9/R14/cohesion factor keeps its meaning. The offender is
 * hash-picked by those same own terms.
 *
 * FLAT PER SNAP. The base block flags a pass and a run at the SAME rate, so the
 * field must too: the pass-only kinds (OPI, DPI, illegal contact, roughing) must
 * not inflate a dropback's total, or the field would replace ~0.44 more pass
 * attempts per team-game than the base does and the whole passing band would
 * drift (measured: passYds -4.17, passAtt -0.43, points -0.15 pooled 6x500 — the
 * asymmetry, not the level). So the per-snap total is re-normalised by the base
 * share of the kinds that exist on THIS snap: every snap carries the side's full
 * base rate and only WHO and WHAT change. The rate stays exactly linear in each
 * base (the kind is picked in proportion to b_k·w_k), so calibration is unchanged.
 */
function gate(
  pool: Partial<Record<PenaltyKind, Cand[]>>,
  inp: PenSideIn,
  seed: string,
  tag: string,
): PenFoul | undefined {
  const c = EMERGENT_PEN
  const base: Partial<Record<PenaltyKind, number>> = {
    holdingOff: c.holdOff, falseStart: c.falseStart, delay: c.delay, opi: c.opi,
    dpi: c.dpi, illegalContact: c.illegalContact, holdingDef: c.holdDef,
    offside: c.offside, roughing: c.roughing, unnecessary: c.unnecessary,
  }
  // The side's FULL base rate (every kind it can commit) — the flat target.
  const ALL = tag === 'penO'
    ? c.holdOff + c.falseStart + c.opi + c.delay
    : c.dpi + c.illegalContact + c.holdDef + c.offside + c.roughing + c.unnecessary
  let present = 0
  for (const k of Object.keys(pool) as PenaltyKind[]) {
    const cands = pool[k] ?? []
    if (!(base[k] ?? 0) || !cands.length) continue
    present += base[k] ?? 0
  }
  let total = 0
  const entries: Array<{ kind: PenaltyKind; p: Player; w: number; raw?: number; rawKey?: string }> = []
  for (const k of Object.keys(pool) as PenaltyKind[]) {
    const cands = pool[k] ?? []
    const b = base[k] ?? 0
    if (!b || !cands.length) continue
    const man = hashPick(cands, hash32(`${seed}:${tag}:man:${k}`))
    if (!man) continue
    const src = cands.find((x) => x.p === man)
    const w = src?.w ?? 1
    const p = b * w
    if (p <= 0) continue
    total += p
    entries.push({ kind: k, p: man, w: p, raw: src?.raw, rawKey: src?.rawKey })
  }
  if (!entries.length || present <= 0) return undefined
  // Flat per snap: a run carries the dropback's own base rate, so the field can
  // never replace more pass attempts than the base rate does.
  total *= ALL / present
  const side = inp.disc * inp.mental * inp.hurry * inp.crowd
  if (!(inp.roll < total * side * c.scale)) return undefined
  const pick = hashPick(entries.map((e) => ({ p: e.p, w: e.w })), hash32(`${seed}:${tag}:kind`))
  const hit = entries.find((e) => e.p === pick) ?? entries[0]
  note(hit.kind, hit.p)
  if (hit.raw !== undefined) noteRaw(hit.rawKey ?? hit.kind, hit.raw)
  return { kind: hit.kind, player: hit.p, yards: yardsOf(hit.kind, inp.depth, `${seed}:${tag}`) }
}

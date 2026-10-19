// ─────────────────────────────────────────────────────────────────────────────
// E3 — O-LINE vs D-LINE decided on the field (FUTURES #54, phase E3).
//
// Today `resolvePass` scores the pass rush with `rushMatchups` (the J8b rep
// model): each rusher gets a win *number* from a ratings blend, the union of the
// numbers becomes `pressureEdge`, and `pressureEdge` plus a base chance becomes
// `sackChance`. The QB never appears in the rep; the pocket has no clock.
//
// E3 replaces that block, when on, with the actual pass set:
//   • every rusher is assigned the blocker the sim already assigns him (edges →
//     tackles, interior → guards/centre, a blitzer → the back/tight end, the
//     j13 protection slide picking up the extra rusher, the J12 double/chip and
//     the spy call) — the assignment is the base engine's own rules, kept;
//   • each rep is a race: the rusher's own move (PMV/FMV, his get-off ACC, his
//     STR/BSH bull, his style burst) and his own top speed/acceleration from
//     `paceFor` against that blocker's own set (PBK, IMP, STR anchor, AGI/AWR
//     mirror) and his own kick-slide top speed/acceleration from `paceFor`, both
//     scaled by their OWN in-game fatigue. `paceFor`/`fatiguePace` (engine/pace)
//     are the one speed model — there is no second speed function here;
//   • the rep is won when the rusher's path gets past the blocker's hip (tHip),
//     then he has to close the last yards to the QB (tHome);
//   • the pocket collapses by the men who actually won: the earliest tHome is the
//     pocket clock and the man who won it is the pressure/sack credit;
//   • the QB has his own clock (tThrow): his AWR/TUP/experience and the concept
//     depth decide how long he holds the ball, and the j13 pre-snap read takes
//     it out early — tThrow against the pocket clock decides pressure, the
//     credit and the sack chance. His mobility/poise still scale the sack in the
//     existing `qbSackEscape`/`pocketPlan` multipliers, which are unchanged;
//   • the recorded fields are today's: `pressureId`/`sackId` (the man who won),
//     `beatenBlockerId` (the blocker who lost), `timeToPressureS` (the clock,
//     clamped into the animation's band) and `olHandoffFail` (J37).
//
// DETERMINISM. Zero `rng()` draws are added or removed: every decision below is
// `hash32`/`h01` on `${n}:${defId}:e3:…`. The draw the replaced sack test used
// is still consumed at the same point in the stream, and the ON path only
// replaces how its value is decided. `setEmergentE3(false)` makes the resolver
// never enter this file, so the OFF path is byte-identical to the base.
//
// CALIBRATION. Every knob lives in `EMERGENT_E3` and nowhere else. The two
// centres (`edgeCenter`, `sackCenter`) are the measured league means of the raw
// field terms, so the pressure/comp edge and the sack rate keep their centres
// while the men on the play widen the distribution. `E3_STAT` (off by default,
// never read by the sim) accumulates those raw means for the probe.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player } from '../types'
import { clamp, hash32 } from './rng'
import { effAttrs, fatiguePace, paceFor } from './pace'
import { POS_MEAN } from './ratingMeans'
import { styleProfile } from './style'

export const EMERGENT_E3 = {
  // ON by default (emerjoint 2026-10-17): the joint calibration landed the
  // protection field in the NFL bands. `setEmergentE3(false)` is the dev toggle.
  on: true,
  // ── the stage: yards from a rusher's alignment to the QB's throwing spot ────
  // An edge rusher has to come around the corner (longer path); an interior man
  // starts closer; a blitzing backer a few yards deep; a runner no one blocks is
  // already in the pocket's lap.
  laneEdge: 6.1,
  laneInt: 4.4,
  laneBlitz: 5.4,
  laneFree: 3.2,
  /** Yards the blocker has to travel to stay in front of his man (his set). */
  mirrorD: 1.5,
  /** Get-off: seconds given away at the snap at a league-average rating. */
  reactDl: 0.16,
  reactOl: 0.1,
  /** The last yards from the hip to the QB, on the rusher's own pace. */
  closeYd: 1.7,
  // ── the rep race: his own technique (rating points; 0 = league average) ─────
  styleW: 0.9, // a speed/finesse rusher's burst, a power rusher's push (J8b's styleW)
  moveW: 0.55, // the rusher's chosen move (the better of PMV / FMV)
  counterW: 0.18, // his counter move
  getoffW: 0.5, // his get-off ACC
  powerW: 0.3, // his bull
  bshW: 0.5, // share of the bull that is block shedding (the rest is STR)
  setW: 0.55, // the blocker's set (PBK)
  impW: 0.45, // his anchor (IMP)
  anchorW: 0.3, // his STR anchor
  mirrorW: 0.2, // his AGI mirror
  awrW: 0.15, // his recognition (AWR)
  // twist / miss-pickups (the two blockers pass off with their OWN AWR; J37's
  // pair chemistry scales the loss)
  twistRate: 0.28,
  passOffW: 0.02,
  handoffK: 1.2,
  twistSec: 0.4,
  /** Rating points of technique margin → seconds off the hip time. */
  techSec: 0.052,
  /** Snap-to-snap execution noise: the SAME rep is not run the same way twice.
   *  Every rep gets a centred triangular offset on its hip time, hashed on the
   *  rep key (`hash01`, never an rng draw), with sd = execVar × 0.408 s. This is
   *  what gives the rusher a real per-SNAP win rate instead of winning every snap
   *  in a matchup (NFL: an elite rusher wins ~20-30% of his snaps, an average one
   *  ~8-12%), so the club's pressures spread across the front; the rating gaps
   *  (move/set/pace) still order the league, so elite-vs-poor stays large. */
  execVar: 3.2,
  /** The hip clock: an average rep is won at this time + the pace term. */
  hipBase: 4.12,
  beatW: 1.0,
  beatLo: 0.55,
  beatHi: 4.6,
  // ── the QB's own clock (time to throw; NFL NGS ≈ 2.7–2.9 s) ─────────────────
  qbBase: 2.72,
  qbDepth: 0.02, // per yard of the concept's depth
  qbAwrW: 0.006, // pocket presence: a good reader gets it out sooner
  qbTupW: 0.004,
  qbExpW: 0.02, // per season of experience
  qbReadW: 0.02, // the j13 pre-snap read deviation (he diagnosed the look)
  qbClampLo: 1.6,
  qbClampHi: 4.0,
  // ── the verdict ────────────────────────────────────────────────────────────
  /** The clock window (s) inside which the pressure is felt and reported: a man
   *  home inside `tThrow + pressWin` forced the throw (≈30% of dropbacks). */
  pressWin: 0.25,
  /** The animation's clock band (today's PB.minTime / PB.maxTime). */
  minTime: 0.7,
  maxTime: 4.2,
  // ── the pressure edge (replaces `pb.edge − PB_CENTER.edge`) ────────────────
  /** Rating points of edge per second of clock margin (the rep is scored as
   *  `refBeat − tHome`, so the field edge lives on the base model's own scale and
   *  `pressureEdge` means the same thing it did: a big positive value is a
   *  collapsing pocket). */
  edgeW: 56.0,
  /** The clock the league's average front wins its rep at (win = 0 there). */
  refBeat: 3.2,
  /** Main's own union/blend of the reps (PB.unionW / PB.blendW). */
  unionW: 1.0,
  blendW: 0.36,
  /** Main's own loss line (PB.lossLine: a rep with a win above it is lost). */
  lossLine: 0,
  /** Measured league mean of the raw field edge (the re-centre, see E3_STAT). */
  edgeCenter: -34.66,
  /** Re-scale of the centred field edge. The per-rep execution noise (below) makes
   *  the raw field edge far wider than the blended J8b edge it replaces (sd 51 vs
   *  14 measured, E3_STAT), and `edgeTerm` feeds the QB's pocket plan / checkdown
   *  bias, so an unscaled term would move the passing game. Scaling the centred
   *  edge by (sd_main / sd_field) keeps the league's `pressureEdge` distribution —
   *  and therefore the passing stream — where main had it, while the pressure
   *  credit and the pressure verdict keep the whole field spread. */
  edgeScale: 0.267,
  // ── the sack term (replaces `pressureEdge × 0.0012` in `sackChance`) ───────
  /** Extra sack probability per second the man is home before the throw. */
  sackPerSec: 0.15,
  /** The zero point of the sack term (see `sackPerSec`/`sackLo`/`sackHi`). The
   *  measured league mean of `tHome − tThrow` is ≈0.73 s (E3_STAT), but the sack
   *  term is CLAMPED at ±0.1, so a term centred on that mean lands slightly
   *  negative — the E3 league sack rate came out 4.8% against the OFF path's
   *  6.3% (a 1.1 sack/game drift). The zero point is therefore set where the
   *  CENTRED term's league mean matches the OFF path's (`pressureEdge × 0.0012`,
   *  mean +0.0036), which the probe measures directly: sackCenter 0.95 puts the
   *  ON sack rate at the OFF path's 6.3–6.6% (analysis/rushvar-sack.mjs). */
  sackCenter: 0.88,
  sackLo: -0.10,
  sackHi: 0.10,
  // ── assignment (the base engine's own rules, kept as inputs) ───────────────
  /** The pre-J12 flat spy cost (J12's own value, used when the layer is off). */
  spyFlat: 4,
  doubleAdd: 0.35, // a doubled rusher takes longer to get home (s)
  chipAdd: 0.16, // a chipped edge takes longer (s)
  freeBoost: 0.3, // the man freed by the double/chip gets home sooner (s)
  whiffAdd: 0.4, // a busted j13 slide leaves the rusher cleaner (s)
  slideAdd: 0.3, // a picked-up blitzer has to beat a live blocker (s)
  slideWin: 0.85, // …and his rep counts this share (J13.slideWin)
  /** j13 slide success (the values of J13.slideBase/slideW/slideLo/slideHi). */
  slideBase: 0.5,
  slideW: 0.02,
  slideLo: 0.05,
  slideHi: 0.95,
  whiffBase: 0.18,
  // ── in-game protection adjustment (the OC adjusts to the man who is winning) ─
  // Real protection is not static: once a rusher has beaten his man a few times,
  // the offence slides a lineman, chips him with the back and slides the QB away
  // — doubles and slides go to the man who is winning. This block makes the
  // dominant rep draw that help AFTER he wins early in a game (`inp.heat` = the
  // pressures this defender has already been credited with this game, game state
  // threaded from playsim — never an rng draw). The OC's own `adjustments` /
  // `gameManagement` sub sets how soon the slide comes; the QB's own AWR is
  // already in his clock and also scales the help. Effect: the club's pressures
  // spread across the front instead of pooling on one man (no player > 12 in a
  // game), while an elite-vs-poor gap still orders the league.
  /** Pressures this game at which the slide/double starts (before the OC sub). */
  heatThresh: 4,
  /** Seconds the hot man's rep is slowed by the initial double. */
  heatDoubleAdd: 0.5,
  /** Extra seconds per pressure past the threshold (help keeps arriving). */
  heatExtra: 0.14,
  /** Cap on the total help (s) on the hot man's rep. */
  heatAddMax: 1.3,
  /** Seconds the man freed by the slide gets home sooner. */
  heatFreeBoost: 0.22,
  /** The doubled man's rep counts this share (like the J12 flat double). */
  heatMult: 0.5,
  /** The OC adjustments sub moves the threshold (a sharp OC adjusts sooner). */
  heatAdjW: 0.04,
  /** The QB's own AWR moves the threshold the same way (slide calls). */
  heatAwrW: 0.03,
  /** Threshold clamp. */
  heatThreshLo: 2,
  heatThreshHi: 8,
  /** QB gets the ball out faster against heat: seconds per pressure … */
  heatQbStep: 0.02,
  /** …capped here. */
  heatQbCap: 0.12,
} as const

/** The object above is const; only `on` is ever written (the setJ13 pattern). */
interface MutableE3 { on: boolean }
const E3CFG = EMERGENT_E3 as unknown as MutableE3

/** E3: turn the field rep model on/off (default OFF — the OFF path is base). */
export function setEmergentE3(on: boolean): void {
  E3CFG.on = on
}
/** E3: read the toggle so a probe can restore it exactly. */
export function getEmergentE3(): boolean {
  return E3CFG.on
}

/** Dev accumulator (turned on by the probe; never read by the sim). */
export const E3_STAT = {
  on: false,
  n: 0,
  /** The raw (uncentred) field edge, the raw sack term and `tHome − tThrow`. */
  edgeSum: 0,
  edgeSum2: 0,
  termSum: 0,
  deltaSum: 0,
  /** The QB's own clock (NGS comparison) and the pocket clock. */
  qbTSum: 0,
  tHomeSum: 0,
  /** Reps won before the throw / reps run. */
  won: 0,
  reps: 0,
  /** Free reps (nobody assigned) and the men home inside the throw window. */
  freeReps: 0,
  /** The pre-extension `tHome − tThrow` per dropback (dev histogram, capped). */
  delta0: [] as number[],
  /** Dev: reps per dropback and which group a free rep came from. */
  repHist: {} as Record<string, number>,
  freeTag: {} as Record<string, number>,
}

// ── the rep race ─────────────────────────────────────────────────────────────
/** League-relative rating: the man's OWN value against his OWN position's mean
 *  (0 = the average man at his position; never a unit or roster average). */
function rel(pos: string | undefined, key: string, val: number): number {
  const m = pos ? POS_MEAN[pos]?.[key] : undefined
  return m === undefined ? 0 : val - m
}
/** h01 on a key (hash32 → [0,1)) — never an rng() draw. */
function hash01(key: string): number {
  return (hash32(key) >>> 0) / 4294967296
}
/** Time (s) to cover `d` yards from rest at a pace (top yd/s, acc yd/s²). */
function tTravel(d: number, top: number, acc: number): number {
  const a = Math.max(0.5, acc)
  const rampD = (top * top) / (2 * a)
  if (d <= rampD) return Math.sqrt((2 * d) / a)
  return top / a + (d - rampD) / top
}
/** The lane a man takes to the QB by his own alignment. */
function laneOf(r: Player, blitz: boolean): number {
  if (blitz) return EMERGENT_E3.laneBlitz
  if (r.pos === 'DE') return EMERGENT_E3.laneEdge
  if (r.pos === 'DT') return EMERGENT_E3.laneInt
  return EMERGENT_E3.laneBlitz
}

export interface E3Rep {
  id: string
  pos: string
  blockerId?: string
  /** Win units (the pocket surrendered this much before the throw). */
  win: number
  blitz: boolean
  free: boolean
  /** E3: when his path got past his blocker's hip (s). */
  tHip: number
  /** E3: when he is home (tHip + the last yards on his own pace). */
  tHome: number
  /** E3: this rep's weight on the edge (the double/chip/slide modifiers). */
  mult: number
}
/** Structurally `RushResult` (playsim); the hook keeps it typed as that. */
export interface E3Rush {
  edge: number
  reps: E3Rep[]
  credit?: E3Rep
  /** Stat credit: the rep who reached the QB first (bookkeeping only). */
  pressurer?: E3Rep
  maxWin: number
  freeRusher: boolean
  lost: number
  time: number
  handoffFail?: string
}

export interface E3In {
  n: number
  defId: string
  offId: string
  dl: Player[]
  lbs: Player[]
  cbs: Player[]
  ol: Player[]
  rb?: Player
  te?: Player
  fb?: Player
  blitz: boolean
  fat?: Record<string, number>
  offMove?: string
  defMove?: string
  dlUsage?: 'starters' | 'rotate'
  q4: boolean
  j13?: { slide?: 'L' | 'R'; sawBlitz?: boolean; hotRoute?: string } | undefined
  j13Dev: number
  handoffChem?: Map<string, number>
  passer?: Player
  conceptDepth: number
  /** The J12 layer is on (its double/chip/spy handling). */
  j12: boolean
  /** In-game pressure ledger (playerId → pressures credited this game). Game
   *  state, not an rng draw: drives the protection adjustment (`heat*` knobs). */
  heat?: Record<string, number>
  /** The OC's own adjustments/gameManagement sub, centred on the league (points). */
  heatAdj: number
}

export interface E3Out {
  rush: E3Rush
  /** Replaces `pb.edge − PB_CENTER.edge` in `pressureEdge`. */
  edgeTerm: number
  /** Replaces `pressureEdge × 0.0012` in `sackChance`. */
  sackTerm: number
  /** The pocket clock beat the QB's clock: the pass rush forced the throw. */
  pressured: boolean
  tHome: number
  qbT: number
  delta: number
}

/** Weighted hash pick (the base engine's own `hashPick`, no rng draw). */
function hashPick<T>(list: T[], weight: (t: T) => number, key: number): T | undefined {
  if (!list.length) return undefined
  const total = list.reduce((s, t) => s + Math.max(0, weight(t)), 0)
  if (total <= 0) return list[key % list.length]
  let roll = (key / 4294967296) * total
  for (const t of list) {
    const w = Math.max(0, weight(t))
    if (roll < w) return t
    roll -= w
  }
  return list[list.length - 1]
}

/**
 * One rep: the rusher's own move and pace against the blocker's own set and kick
 * slide. Returns the hip time, the home time, the technique margin and whether
 * the twist exchange broke (the J37 handoff).
 */
function repRace(
  r: Player, b: Player | undefined, key: string, blitz: boolean,
  fat: Record<string, number> | undefined, handoffRel: number | undefined,
): { tHip: number; tHome: number; free: boolean; twistFail: boolean } {
  // Snap-to-snap execution noise for this rep (centred, sd = execVar × 0.408).
  // Hashed on the rep key — zero rng draws added or removed.
  const exec = (hash01(`${key}:ex`) + hash01(`${key}:ex2`) - 1) * EMERGENT_E3.execVar
  const ra = effAttrs(r)
  const pmv = rel(r.pos, 'PMV', ra.PMV ?? 70)
  const fmv = rel(r.pos, 'FMV', ra.FMV ?? 70)
  const style = clamp(styleProfile(r).rush, -1, 1)
  const primary = Math.max(pmv, fmv) + style * EMERGENT_E3.styleW
  const counter = Math.min(pmv, fmv)
  const getoff = rel(r.pos, 'ACC', ra.ACC ?? 70)
  const power = rel(r.pos, 'STR', ra.STR ?? 70) + rel(r.pos, 'BSH', ra.BSH ?? 70) * EMERGENT_E3.bshW
  const rp = paceFor(r, 'DL')
  const fr = fatiguePace(fat?.[r.id])
  const topR = rp.top * fr.top
  const accR = rp.acc * fr.acc
  let tech = primary * EMERGENT_E3.moveW + counter * EMERGENT_E3.counterW +
    getoff * EMERGENT_E3.getoffW + power * EMERGENT_E3.powerW
  let tHip = EMERGENT_E3.hipBase + EMERGENT_E3.reactDl * (1 - clamp(getoff / 20, -1, 1))
  if (!b) {
    // Nobody is assigned to him: he is in the pocket's lap, early.
    const t = EMERGENT_E3.reactDl * 0.5 + tTravel(EMERGENT_E3.laneFree, topR, accR) * 0.6 + exec
    return { tHip: EMERGENT_E3.reactDl * 0.5, tHome: clamp(t, EMERGENT_E3.beatLo, EMERGENT_E3.beatHi), free: true, twistFail: false }
  }
  const ba = effAttrs(b)
  const setQ = rel(b.pos, 'PBK', ba.PBK ?? 70) + rel(b.pos, 'IMP', ba.IMP ?? 70) * EMERGENT_E3.impW
  const anchor = rel(b.pos, 'STR', ba.STR ?? 70)
  const mirror = rel(b.pos, 'AGI', ba.AGI ?? 70) * EMERGENT_E3.mirrorW + rel(b.pos, 'AWR', ba.AWR ?? 70) * EMERGENT_E3.awrW
  const bp = paceFor(b, 'OL')
  const fb = fatiguePace(fat?.[b.id])
  const topB = bp.top * fb.top
  const accB = bp.acc * fb.acc
  tech -= setQ * EMERGENT_E3.setW + anchor * EMERGENT_E3.anchorW + mirror
  // His own pace on his lane against the blocker's own set pace, and the two
  // men's reactions (a poor setter is a beat late).
  tHip += tTravel(laneOf(r, blitz), topR, accR) - tTravel(EMERGENT_E3.mirrorD, topB, accB) * EMERGENT_E3.beatW
  tHip += EMERGENT_E3.reactOl * (1 - clamp(setQ / 20, -1, 1))
  tHip -= tech * EMERGENT_E3.techSec
  tHip += exec
  // A twist / stunt whose exchange breaks: the rusher comes cleaner. The two
  // blockers pass off on their OWN AWR; a settled J37 pair recovers it.
  const passOff = clamp(0.55 + rel(b.pos, 'AWR', ba.AWR ?? 70) * EMERGENT_E3.passOffW, 0.2, 0.9)
  let twistFail = false
  if (hash01(`${key}:tw`) < EMERGENT_E3.twistRate && hash01(`${key}:pk`) > passOff) {
    const k = handoffRel === undefined ? 1 : Math.max(0.2, 1 - handoffRel * EMERGENT_E3.handoffK)
    tHip -= EMERGENT_E3.twistSec * k
    twistFail = handoffRel !== undefined && handoffRel < 0
  }
  tHip = clamp(tHip, EMERGENT_E3.beatLo, EMERGENT_E3.beatHi)
  const tHome = clamp(tHip + EMERGENT_E3.closeYd / Math.max(2.5, topR), EMERGENT_E3.beatLo, EMERGENT_E3.beatHi)
  return { tHip, tHome, free: false, twistFail }
}

/**
 * E3: one pass protection on the field. Assigns every rusher the blocker the
 * engine assigns him, runs the reps, and returns the pocket clock, the pressure
 * edge/sack terms for the hook and the credit.
 */
export function emergentPassSet(inp: E3In): E3Out {
  const { n, defId, dl, lbs, cbs, ol, rb, te, fb, blitz, fat } = inp
  // 1. Rushers: the front, plus the backers/DBs who actually blitz (one or two,
  // hash-picked by their own pass rush — never the whole room averaged).
  const rushers: { p: Player; blitz: boolean }[] = dl.map((p) => ({ p, blitz: false }))
  if (blitz) {
    const kBase = 1 + (hash32(`${n}:${defId}:blitzk`) % 2)
    const k = inp.defMove === 'spyQB' && inp.j12 ? Math.max(0, kBase - 1) : kBase
    const pool = [...lbs, ...cbs]
    const used = new Set<string>()
    for (let i = 0; i < k; i++) {
      const cand = hashPick(pool.filter((p) => !used.has(p.id)), (p) => {
        const a = effAttrs(p)
        return Math.max(1, Math.max(a.PMV ?? 70, a.FMV ?? 70) + styleProfile(p).rush * 12)
      }, hash32(`${n}:${defId}:blitzer${i}`))
      if (cand) { used.add(cand.id); rushers.push({ p: cand, blitz: true }) }
    }
  }
  // 2. Alignment: edge rushers take the tackles, interior men the guards/centre,
  // a blitzer is picked up by the back (RB, then TE, then FB).
  const edges = rushers.filter((r) => !r.blitz && r.p.pos === 'DE')
  const interior = rushers.filter((r) => !r.blitz && r.p.pos !== 'DE')
  const blitzers = rushers.filter((r) => r.blitz)
  const tackles = ol.filter((p) => p.pos === 'OT')
  const inside = ol.filter((p) => p.pos === 'OG' || p.pos === 'C')
  const helpers = [rb, te, fb].filter((p): p is Player => !!p)
  const reps: E3Rep[] = []
  let handoffFail: string | undefined
  const repOf = (p: Player, b: Player | undefined, isBlitz: boolean, key: string): E3Rep => {
    const handoffRel = b ? inp.handoffChem?.get(b.id) : undefined
    const rr = repRace(p, b, key, isBlitz, fat, handoffRel)
    if (rr.twistFail && b) handoffFail = b.id
    return { id: p.id, pos: p.pos, blockerId: b?.id, win: 0, blitz: isBlitz, free: rr.free, tHip: rr.tHip, tHome: rr.tHome, mult: 1 }
  }
  const addReps = (group: { p: Player; blitz: boolean }[], blockers: Player[], tag: string) => {
    const order = group.map((_, i) => i).sort((a, b) =>
      (hash32(`${n}:${defId}:${tag}o${a}`) % 100000) - (hash32(`${n}:${defId}:${tag}o${b}`) % 100000))
    group.forEach((r, i) => {
      const b = i < blockers.length ? blockers[order[i]] : undefined
      reps.push(repOf(r.p, b, r.blitz, `${n}:${defId}:${tag}${i}`))
    })
  }
  addReps(edges, tackles, 'edge')
  addReps(interior, inside, 'int')
  addReps(blitzers, helpers, 'blitz')
  if (!reps.length) addReps(lbs.map((p) => ({ p, blitz: false })), [...tackles, ...inside], 'lbfb')
  // 2b. Protection help (a slide / a scoop): an idle lineman picks up whoever is
  // left unblocked, exactly as a real front slides to the extra rusher. The
  // specific unblocked man's mismatch is real — an interior lineman on an edge
  // rusher loses the rep on his own ratings — and a man is only truly free when
  // the rush outnumbers every blocker on the play.
  const used = new Set<string>()
  for (const rep of reps) if (rep.blockerId) used.add(rep.blockerId)
  const spare = [...inside, ...helpers].filter((p) => !used.has(p.id))
  const freeReps = reps.filter((r) => r.free)
  const freeOrder = freeReps.map((_, i) => i).sort((a, b) =>
    (hash32(`${n}:${defId}:help${a}`) % 100000) - (hash32(`${n}:${defId}:help${b}`) % 100000))
  for (const i of freeOrder) {
    const b = spare.shift()
    if (!b) break
    const rep = freeReps[i]
    const j = reps.indexOf(rep)
    const rusher = rushers.find((r) => r.p.id === rep.id)?.p
    if (rusher) reps[j] = repOf(rusher, b, rep.blitz, `${n}:${defId}:helpb${j}`)
  }
  // 3. G11 doubleRusher / J12 DOUBLE & CHIP: a blocker is committed to the best
  // rusher (that rep takes longer), and the man freed by the double gets home
  // sooner. The legacy flat ×0.5 stays as a rep multiplier.
  if (inp.offMove === 'doubleRusher' || inp.offMove === 'chipEdge') {
    let best = -1
    let bestR = -1
    let second = -1
    let secondR = -1
    for (let i = 0; i < reps.length; i++) {
      const p = rushers.find((r) => r.p.id === reps[i].id)?.p
      if (!p) continue
      const a = effAttrs(p)
      const rv = Math.max(a.PMV ?? 70, a.FMV ?? 70)
      if (rv > bestR) { second = best; secondR = bestR; bestR = rv; best = i }
      else if (rv > secondR) { secondR = rv; second = i }
    }
    if (best >= 0) {
      const chip = inp.offMove === 'chipEdge'
      reps[best].mult *= chip ? 0.78 : 0.5
      reps[best].tHome += chip ? EMERGENT_E3.chipAdd : EMERGENT_E3.doubleAdd
      if (inp.j12 && second >= 0) reps[second].tHome -= EMERGENT_E3.freeBoost
    }
  }
  // 4. J12 spyQB: the spy is one fewer rusher — the least threatening rep drops
  // out of the union (his eyes are on the QB, not the pass rush).
  if (inp.defMove === 'spyQB' && inp.j12 && reps.length > 1) {
    let worst = 0
    for (let i = 1; i < reps.length; i++) if (reps[i].tHome > reps[worst].tHome) worst = i
    reps.splice(worst, 1)
  }
  // 5. J13 protection slide: the tackle on the slid side picks up the extra
  // rusher instead of leaving him free. The QB's own read deviation decides
  // whether the slide finds him; a poor-read slide whiffs and the rusher comes
  // even cleaner.
  if (inp.j13?.slide && blitz && reps.length) {
    let idx = -1
    let bestT = Infinity
    for (let i = 0; i < reps.length; i++) {
      if (!reps[i].blitz) continue
      if (reps[i].tHome < bestT) { bestT = reps[i].tHome; idx = i }
    }
    if (idx >= 0) {
      const rusher = rushers.find((r) => r.p.id === reps[idx].id)?.p
      const ots = ol.filter((p) => p.pos === 'OT')
      const blocker = ots.length ? ots[inp.j13.slide === 'L' ? 0 : ots.length - 1] : ol[0]
      const success = hash01(`${n}:${defId}:j13slide`) < clamp(EMERGENT_E3.slideBase + inp.j13Dev * EMERGENT_E3.slideW, EMERGENT_E3.slideLo, EMERGENT_E3.slideHi)
      if (rusher && blocker && success) {
        const slid = repOf(rusher, blocker, true, `${n}:${defId}:slid`)
        slid.tHome += EMERGENT_E3.slideAdd
        slid.mult *= EMERGENT_E3.slideWin
        reps[idx] = slid
      } else if (hash01(`${n}:${defId}:j13whiff`) < clamp(EMERGENT_E3.whiffBase - inp.j13Dev * EMERGENT_E3.slideW, 0, 0.5)) {
        reps[idx].tHome -= EMERGENT_E3.whiffAdd
      }
    }
  }
  // 5b. In-game protection adjustment: the offence slides a lineman, doubles and
  // chips the man who has been winning this game (his credited pressures so far,
  // `inp.heat`) and the QB slides away from that heat. The OC's own `adjustments`
  // / `gameManagement` sub (plus the QB's AWR) decides how soon the slide comes.
  // Deterministic — heat is game state, never an rng draw. It is a real protection
  // adjustment: the man who is winning is slowed by the slide/double, the man freed
  // by it gets home sooner, and the QB's clock tightens against the heat — so the
  // pocket clock, the pressure verdict, the credit and the sack term all move
  // together, and the club's pressures spread across the front.
  let heatMax = 0
  if (inp.heat) {
    for (const rep of reps) {
      const h = inp.heat[rep.id] ?? 0
      if (h > heatMax) heatMax = h
    }
  }
  let heatRelief = 0
  if (heatMax > 0 && reps.length > 1) {
    const qbAwrRel = inp.passer ? rel('QB', 'AWR', effAttrs(inp.passer).AWR ?? 70) : 0
    const thresh = clamp(
      EMERGENT_E3.heatThresh - inp.heatAdj * EMERGENT_E3.heatAdjW - qbAwrRel * EMERGENT_E3.heatAwrW,
      EMERGENT_E3.heatThreshLo, EMERGENT_E3.heatThreshHi)
    if (heatMax >= thresh) {
      // The hottest rep (tie → earliest home) takes the slide/double; a blitzer
      // the offence has to account for is equally real.
      let hot = -1
      for (let i = 0; i < reps.length; i++) {
        const h = inp.heat?.[reps[i].id] ?? 0
        if (h < thresh) continue
        const hb = hot >= 0 ? (inp.heat?.[reps[hot].id] ?? 0) : -1
        if (hot < 0 || h > hb || (h === hb && reps[i].tHome < reps[hot].tHome)) hot = i
      }
      if (hot >= 0) {
        const add = Math.min(EMERGENT_E3.heatAddMax,
          EMERGENT_E3.heatDoubleAdd + EMERGENT_E3.heatExtra * (heatMax - thresh))
        reps[hot].tHome += add
        reps[hot].mult *= EMERGENT_E3.heatMult
        // The man freed by the slide gets home sooner (the next-best rep).
        let freed = -1
        for (let i = 0; i < reps.length; i++) {
          if (i === hot) continue
          if (freed < 0 || reps[i].tHome < reps[freed].tHome) freed = i
        }
        if (freed >= 0) reps[freed].tHome -= EMERGENT_E3.heatFreeBoost
        heatRelief = Math.min(EMERGENT_E3.heatQbCap, (heatMax - thresh + 1) * EMERGENT_E3.heatQbStep)
      }
    }
  }
  // 6. The QB's own clock: his pocket presence and the concept depth. (His
  // mobility/poise still scale the sack in the existing multipliers.)
  const qa = inp.passer ? effAttrs(inp.passer) : undefined
  let qbT = EMERGENT_E3.qbBase + EMERGENT_E3.qbDepth * clamp(inp.conceptDepth, -2, 40)
  if (qa) {
    qbT -= rel('QB', 'AWR', qa.AWR ?? 70) * EMERGENT_E3.qbAwrW
    qbT -= rel('QB', 'TUP', qa.TUP ?? 70) * EMERGENT_E3.qbTupW
    qbT -= Math.max(0, (inp.passer?.age ?? 22) - 22) * EMERGENT_E3.qbExpW
  }
  qbT -= inp.j13Dev * EMERGENT_E3.qbReadW
  qbT -= heatRelief
  qbT = clamp(qbT, EMERGENT_E3.qbClampLo, EMERGENT_E3.qbClampHi)
  // 7. The pocket: the earliest man home is the pocket clock; a rep inside the
  // throw window carries the edge (and the pressure is felt).
  let tHome: number = EMERGENT_E3.beatHi
  let lost = 0
  for (const rep of reps) {
    rep.win = rep.mult * EMERGENT_E3.edgeW * (EMERGENT_E3.refBeat - rep.tHome)
    if (rep.win > EMERGENT_E3.lossLine) lost++
    if (rep.tHome < tHome) tHome = rep.tHome
  }
  const wins = reps.map((r) => r.win)
  const maxWin = wins.length ? Math.max(...wins) : 0
  const meanWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0
  const edgeRaw = EMERGENT_E3.unionW * maxWin + EMERGENT_E3.blendW * meanWin
  const credit = reps[wins.indexOf(maxWin)]
  // Stat credit (bookkeeping only; `credit` above still drives freeRusher): the
  // pressure goes to the rep who reached the QB FIRST (earliest tHome) among the
  // reps that won their rep and got home before the QB released (tHome <= qbT);
  // else the earliest winner; else the earliest rep. Deterministic, no hash/rng.
  //
  // A lineman's block first: the broadcast draws a pressure rusher beating his
  // BLOCK (the animflow 6c invariant), and it records that move only for a man who
  // was in the drawn protection — a rusher left over the drawn wall (the last man
  // in the animation's own rush order) is drawn FREE, and a blitzer is in practice
  // that man. The animation also draws the back's chip on the blitzer the sim gave
  // the back to, and a chip is a glancing engagement with no shed move: crediting a
  // chipped blitzer puts the box score on a man the field never shows beating a
  // block. So the credit prefers the FRONT (the non-blitz reps the animation always
  // holds the line on): the earliest man home off the front, then the earliest man
  // home overall, then the front's earliest winner, then the earliest winner, then
  // anyone. Same clock, same verdict, same outcome — the only change is which of
  // several home rushers owns the stat.
  let pBefore: E3Rep | undefined
  let pWon: E3Rep | undefined
  let pAny: E3Rep | undefined
  let pFront: E3Rep | undefined
  let pFrontWon: E3Rep | undefined
  let pFrontAny: E3Rep | undefined
  for (const r of reps) {
    if (!pAny || r.tHome < pAny.tHome) pAny = r
    if (!r.blitz && (!pFrontAny || r.tHome < pFrontAny.tHome)) pFrontAny = r
    if (r.win > EMERGENT_E3.lossLine) {
      if (!pWon || r.tHome < pWon.tHome) pWon = r
      if (!r.blitz) {
        if (!pFrontWon || r.tHome < pFrontWon.tHome) pFrontWon = r
        if (r.tHome <= qbT && (!pFront || r.tHome < pFront.tHome)) pFront = r
      }
      if (r.tHome <= qbT && (!pBefore || r.tHome < pBefore.tHome)) pBefore = r
    }
  }
  const pressurer = pFront ?? pFrontWon ?? pFrontAny ?? pBefore ?? pWon ?? pAny
  const freeRusher = !!credit?.free
  const delta = tHome - qbT
  const edgeTerm = (edgeRaw - EMERGENT_E3.edgeCenter) * EMERGENT_E3.edgeScale
  const sackTerm = clamp((EMERGENT_E3.sackCenter - delta) * EMERGENT_E3.sackPerSec, EMERGENT_E3.sackLo, EMERGENT_E3.sackHi)
  const pressured = delta <= EMERGENT_E3.pressWin
  const time = clamp(tHome, EMERGENT_E3.minTime, EMERGENT_E3.maxTime)
  // The pre-J12 flat spy cost stays on the path when the J12 layer is off.
  const edgeAdj = inp.defMove === 'spyQB' && !inp.j12 ? -EMERGENT_E3.spyFlat : 0
  if (E3_STAT.on) {
    E3_STAT.n++
    E3_STAT.edgeSum += edgeRaw
    E3_STAT.edgeSum2 += edgeRaw * edgeRaw
    E3_STAT.termSum += sackTerm
    E3_STAT.deltaSum += delta
    E3_STAT.qbTSum += qbT
    E3_STAT.tHomeSum += tHome
    E3_STAT.reps += reps.length
    E3_STAT.won += lost
    for (const rep of reps) if (rep.free) E3_STAT.freeReps++
    E3_STAT.repHist[reps.length] = (E3_STAT.repHist[reps.length] ?? 0) + 1
    for (const rep of reps) if (rep.free) {
      const tag = `${rep.pos}${rep.blitz ? '+blitz' : ''}`
      E3_STAT.freeTag[tag] = (E3_STAT.freeTag[tag] ?? 0) + 1
    }
    if (E3_STAT.delta0.length < 100000) E3_STAT.delta0.push(+delta.toFixed(3))
  }
  return {
    rush: {
      edge: edgeRaw + edgeAdj,
      reps,
      credit,
      pressurer,
      maxWin,
      freeRusher,
      lost,
      time,
      handoffFail: handoffFail && reps.some((r) => r.blockerId === handoffFail) ? handoffFail : undefined,
    },
    edgeTerm: edgeTerm + edgeAdj,
    sackTerm,
    pressured,
    tHome,
    qbT,
    delta,
  }
}

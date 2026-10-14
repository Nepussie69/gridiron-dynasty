// ─────────────────────────────────────────────────────────────────────────────
// J52 (FUTURES #52) — WR reads: the receiver's own post-snap coverage read.
//
// J10a gave the QB a designed progression (`readNo`) and a vision cone; J13 gave
// him a pre-snap read of the look (box / blitz look, hot route, slide). This layer
// is the OTHER half of the conversation: after the snap the RECEIVER reads the
// coverage he is running against and converts his route — or does not.
//
// Every decision is taken by the SPECIFIC receiver on the play: his own AWR, his
// own route-running rating for the concept's depth (DRR/MRR/SRR, with the
// raw-OVR fallback the target model already uses), his experience, and his J37
// chemistry with THIS quarterback. The individual terms are deviations from the
// position mean (`POS_MEAN`) / from the league's own receivers (a cached centre,
// the `WX_CENTER` pattern), so an average starter adds 0 and the league means
// hold. No unit or roster mean is read.
//
// The read is a comparison of two "pages":
//   · the TRUE look (the coverage the defence actually played — man / zone /
//     press, the blitz, the safety rotation — resolved by `resolvePass`);
//   · the RECEIVER's own read of it (his page), which is right with a
//     probability set by his own ratings, the J37 chemistry and how hard the
//     look is to read (a J12 disguise, a blitz, finding the void in zone, the
//     covering defender's own disguise skill);
//   · the QB's page (J13's pre-snap look + whether the J12 disguise fooled him).
// A clean read that agrees with the QB's page CONVERTS the route:
//   sit vs zone, keep running vs man, fade / back-shoulder vs press, hot vs blitz
// — and the conversion is worth separation at the catch point. A read that does
// not agree with the QB (or does not match the coverage at all) is a MISREAD: the
// receiver is at the wrong depth/route, so the window closes and the throw is
// riskier (a bigger pick chance).
//
// Everything is a deterministic hash of the play number and the receiver id —
// NO rng() draw is added or removed. With `setWrReads(false)` every function
// returns the neutral value, no Play field is added and the pass path is
// byte-identical to the base engine.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player } from '../types'
import type { World } from './generate'
import { playerAttrs } from '../data/ratings'
import { POS_MEAN } from './ratingMeans'
import { hash32 } from './rng'
import { depthGroup } from './depth'
import { unscaleOvr } from './ovrScale'

let WRREAD_ON = true
/** J52: enable/disable the whole WR-read layer (the `setJ13` pattern). */
export function setWrReads(on: boolean): void {
  WRREAD_ON = on
}
/** J52: read the toggle so a probe/calibration copy can restore it exactly. */
export function getWrReads(): boolean {
  return WRREAD_ON
}
/** J52: is the layer live on this snap? */
export function wrReadsOn(): boolean {
  return WRREAD_ON
}

// ── Every constant this job adds, in one place ────────────────────────────────
export const WRREAD = {
  // ── the receiver's own read of the coverage ────────────────────────────────
  /** A league-average receiver's chance of reading the look right. */
  readBase: 0.62,
  /** Per rating point of his own read deviation (centred — the big spread). */
  readSkillW: 0.007,
  /** His own AWR deviation from the WR position mean. */
  awrW: 1.0,
  /** His own route-running rating for this depth, vs `routeRef`. */
  routeW: 0.5,
  /** League-level route-running reference (the raw DRR/MRR/SRR scale). */
  routeRef: 78,
  /** Seasons of experience are counted above this age. */
  expAge: 22,
  expW: 1.4,
  /** J37 QB–WR chemistry (already league-relative) → read rating points. */
  chemW: 20,
  readLo: 0.2,
  readHi: 0.94,
  // ── how hard the look is to read (subtracted from the read chance) ─────────
  /** Finding the void in zone is a little harder than beating a man. */
  diffZone: 0.03,
  /** Reading press (the release is a decision) is a little harder again. */
  diffPress: 0.035,
  /** A blitz look demands a quicker decision. */
  diffBlitz: 0.06,
  /** The J12 disguise hid the coverage from the QB — the receiver is fooled too. */
  diffDisg: 0.10,
  /** The covering defender's own PRC/AWR (centred) make the look harder to read. */
  diffDbW: 0.004,
  /** A screen / outlet behind the line is the easiest read in football. */
  diffSimple: 0.05,
  // ── the converted route / the busted read (centred on the league mean) ─────
  /** Separation (rating points) per unit of the signed read quality. */
  sepW: 20,
  /** League-mean read quality the separation leg is centred on. MEASURED on the
   *  real league (the J13 `audBase` / J37 `skillShiftFrac` role): every read's
   *  separation move is taken against it, so the league's mean separation does not
   *  move and only the individual spread does. Measured mean q ≈ +0.006 over
   *  13 047 reads (`j52-probe-centre.out`), i.e. the read scale is already ~0-
   *  centred, so the constant is 0 and the leg's mean move is ≈0. */
  sepCentre: 0,
  /** Relative INT multiplier per unit of the signed read quality. */
  intW: 0.15,
  /** League-mean read quality the INT leg is centred on, measured on the real
   *  league with `WRR_STAT.dInt` (the throw-weighted mean can differ a shade from
   *  the plain mean, so this leg carries its own constant). Measured dInt ≈
   *  +0.0004 per attempt at the old 0.17 centre; 0 brings it to ≈0. */
  intCentre: 0,
  intLo: 0.7,
  intHi: 1.4,
  // ── the wrong depth a misread draws (animation only) ───────────────────────
  depthLo: 2,
  depthHi: 6,
} as const

/** J52: the signed read quality of a clean conversion (the top of the scale). */
export const WRREAD_CONVERT = 1
/** J52: a read right on the coverage but on a different page to the QB. */
export const WRREAD_OFFPAGE = -0.35
/** J52: the receiver and the QB were wrong together (both fooled). */
export const WRREAD_BOTHWRONG = -0.6
/** J52: the receiver busted the read outright. */
export const WRREAD_BUST = -1

export type WrCover = 'man' | 'zone' | 'press'
/** J52: the conversion a correct read wins. */
export type WrConvert = 'sit' | 'keepRunning' | 'fade' | 'hot'

/** J52: one "page" of the coverage — what a man believes he is running against. */
export interface WrPage {
  cover: WrCover
  blitz: boolean
  /** 0 = single-high, 1 = a two-high shell. */
  deep: 0 | 1
}

export interface WrRead {
  /** J52: what the receiver read (his page). */
  page: WrPage
  /** J52: the coverage the defence actually played. */
  truth: WrPage
  /** J52: the receiver read the coverage right. */
  rightOn: boolean
  /** J52: the receiver and the QB are on the same page. */
  agree: boolean
  /** J52: the conversion a clean, agreed read wins (undefined on a misread). */
  convert?: WrConvert
  /** J52: signed read quality — +1 clean conversion … −1 busted (bands move off this). */
  q: number
  /** J52: the wrong depth the misread drew (yards; 0 on a clean read). */
  depthErrYd: number
  /** J52: his own read rating as a deviation from the league's receivers (probe). */
  skill: number
  /** J52: the probability he read the look right (probe). */
  p: number
}

export interface WrReadInput {
  world: World
  n: number
  offId: string
  defId: string
  /** The receiver the ball is going to (the man who must win his read). */
  wr: Player
  qb: Player | undefined
  /** The designed route (J10a's `routeForCandidate`): screens / outlets are the
   *  easiest reads in football, and they carry no safety-rotation decision. */
  route: string | undefined
  /** The concept's depth (the read's difficulty is depth-specific). */
  depth: number
  /** The coverage the defence actually played. */
  man: boolean
  press: boolean
  blitz: boolean
  twoHigh: boolean
  /** J12: the defence showed (and hid behind) a disguised shell. */
  disguised: boolean
  /** J12: the QB was fooled by it — he is still reading the wrong shell. */
  qbFooled: boolean
  /** The covering defender's own disguise skill (centred; `eyeSkill`). */
  dbSkill: number
  /** J37 QB–target chemistry relative to the league's own centre (0 when off). */
  chemRel: number
}

// ── helpers (identical maths to playsim's, kept local to avoid a module cycle) ─
const clampW = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const hash01 = (key: string) => (hash32(key) >>> 0) / 4294967296
/** A rating's deviation from the position mean (0 for an average starter). */
function dev(pos: string | undefined, key: string, val: number): number {
  const m = pos ? POS_MEAN[pos]?.[key] : undefined
  return m === undefined ? 0 : val - m
}
/** The depth-specific route-running rating, with the raw-OVR fallback the target
 *  model uses (Madden/CFB data carries no DRR/MRR/SRR). */
function routeRating(wr: Player, a: Record<string, number>, depth: number): number {
  const raw = unscaleOvr(wr.ovr)
  const key = depth > 14 ? 'DRR' : depth > 7 ? 'MRR' : 'SRR'
  return a[key] ?? raw
}

/** J52: a receiver's own read rating (rating points; AWR + route + experience +
 *  his J37 chemistry with this QB). A probe/report helper too. */
export function wrReadRel(wr: Player | undefined, depth: number, chemRel = 0): number {
  if (!wr) return 0
  const a = playerAttrs(wr)
  const awr = dev(wr.pos, 'AWR', a.AWR ?? POS_MEAN[wr.pos]?.AWR ?? 70)
  const route = routeRating(wr, a, depth) - WRREAD.routeRef
  const exp = Math.max(0, (wr.age ?? 22) - WRREAD.expAge)
  return awr * WRREAD.awrW + route * WRREAD.routeW + exp * WRREAD.expW + chemRel * WRREAD.chemW
}

// J52: the league's typical receiver read (the `WX_CENTER` role), cached per world.
// Built from every NFL club's top three receivers — the men who actually run the
// routes — so the read probability is centred on the league's own receiving corps.
const wrReadCentreCache = new WeakMap<World, number>()
export function wrReadCentre(world: World): number {
  const hit = wrReadCentreCache.get(world)
  if (hit !== undefined) return hit
  let sum = 0
  let cnt = 0
  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    for (const wr of depthGroup(world, t.id, ['WR'], 3)) {
      sum += wrReadRel(wr, 10)
      cnt++
    }
  }
  const c = cnt ? sum / cnt : 0
  wrReadCentreCache.set(world, c)
  return c
}

/** J52: one receiver's read deviation from the league's receivers (0 = average). */
export function wrReadDev(world: World, wr: Player | undefined, depth: number, chemRel = 0): number {
  return wrReadRel(wr, depth, chemRel) - wrReadCentre(world)
}

/** J52: a different coverage to the one he thought he saw (never the same value). */
function flipCover(c: WrCover): WrCover {
  return c === 'man' ? 'zone' : c === 'zone' ? 'man' : 'man'
}

/** J52: the routes with no coverage read at all — screens and the underneath
 *  outlets (the same family `vision.ts` treats as checkdowns). */
const SIMPLE_ROUTES = new Set(['screen', 'bubble', 'slip', 'check', 'flat', 'swing', 'arrow', 'stalk'])

/**
 * J52: the receiver's post-snap read. Pure and deterministic (hashes only): the
 * true look and both pages come from the play number and the men on the play, so
 * no rng() draw is added or removed and the OFF path never calls this at all.
 */
export function wrRead(i: WrReadInput): WrRead {
  const truth: WrPage = {
    cover: i.press ? 'press' : i.man ? 'man' : 'zone',
    blitz: i.blitz,
    deep: i.twoHigh ? 1 : 0,
  }
  const skill = wrReadDev(i.world, i.wr, i.depth, i.chemRel)
  // A screen / outlet behind the line is the simplest read in football, and the
  // safety rotation is irrelevant to it (the throw never gets there).
  const simple = i.route !== undefined && SIMPLE_ROUTES.has(i.route)
  // How hard the look is to read: the void in zone, the release vs press, the
  // quick decision vs a blitz, a disguised shell that hid the coverage from the
  // passer, and the covering defender's own PRC/AWR.
  const difficulty =
    (truth.cover === 'zone' ? WRREAD.diffZone : truth.cover === 'press' ? WRREAD.diffPress : 0) +
    (truth.blitz ? WRREAD.diffBlitz : 0) +
    (i.disguised && i.qbFooled ? WRREAD.diffDisg : 0) +
    (simple ? -WRREAD.diffSimple : 0) +
    i.dbSkill * WRREAD.diffDbW
  const p = clampW(WRREAD.readBase + skill * WRREAD.readSkillW - difficulty, WRREAD.readLo, WRREAD.readHi)
  // His own page. A missed read falls on ONE axis (chosen deterministically):
  // the coverage, the blitz, or the safety rotation — never a coin flip on all.
  // A screen / outlet has no rotation read, so that axis is not available to him.
  const wrong = hash01(`${i.n}:${i.wr.id}:j52read`) >= p
  let page: WrPage = { ...truth }
  if (wrong) {
    const axis = hash32(`${i.n}:${i.wr.id}:j52axis`) % (simple ? 2 : 3)
    if (axis === 0) page = { ...page, cover: flipCover(truth.cover) }
    else if (axis === 1) page = { ...page, blitz: !truth.blitz }
    else page = { ...page, deep: truth.deep === 1 ? 0 : 1 }
  }
  // The QB's page: what the defence actually played — unless the J12 disguise
  // sold him a shell he never corrected (the passer is still reading the wrong
  // coverage after the snap), which is exactly when a receiver who read it right
  // ends up on a different page to his quarterback.
  const fooled = i.disguised && i.qbFooled
  const qbPage: WrPage = {
    cover: fooled ? flipCover(truth.cover) : truth.cover,
    blitz: fooled && hash01(`j52qbblitz:${i.n}:${i.defId}`) < 0.5 ? !truth.blitz : truth.blitz,
    deep: fooled && hash01(`j52qbdeep:${i.n}:${i.defId}`) < 0.5 ? (truth.deep === 1 ? 0 : 1) : truth.deep,
  }
  const rightOn = page.cover === truth.cover && page.blitz === truth.blitz && page.deep === truth.deep
  const agree = page.cover === qbPage.cover && page.blitz === qbPage.blitz && page.deep === qbPage.deep
  const convert: WrConvert | undefined = rightOn && agree
    ? truth.blitz ? 'hot'
      : truth.cover === 'press' ? 'fade'
        : truth.cover === 'man' ? 'keepRunning' : 'sit'
    : undefined
  const q = convert ? WRREAD_CONVERT : rightOn ? WRREAD_OFFPAGE : agree ? WRREAD_BOTHWRONG : WRREAD_BUST
  // The wrong depth the misread draws (animation only — the sim keeps using the
  // concept's own depth / J3b's air). He kept running into a zone (too deep) or
  // sat down against man (too short); a blitz/shell miss has either sign, and a
  // screen/outlet can only be a yard or two out.
  let depthErrYd = 0
  if (!convert) {
    const deeper = (page.cover === 'man' || page.cover === 'press') && truth.cover === 'zone'
    const shorter = page.cover === 'zone' && truth.cover !== 'zone'
    const sign = deeper ? 1 : shorter ? -1 : hash01(`j52dep:${i.n}:${i.wr.id}`) < 0.5 ? -1 : 1
    const span = simple ? WRREAD.depthLo : WRREAD.depthLo + hash01(`j52depn:${i.n}:${i.wr.id}`) * (WRREAD.depthHi - WRREAD.depthLo)
    depthErrYd = sign * Math.max(1, Math.round(span))
  }
  return { page, truth, rightOn, agree, convert, q, depthErrYd, skill, p }
}

/** J52: dev accumulator (turned on by the probe): the layer's exact comp/INT move. */
export const WRR_STAT = {
  on: false,
  /** Pass snaps the read was computed on. */
  n: 0,
  /** Snaps whose read converted (a clean, agreed read). */
  conv: 0,
  /** Sum of the signed read quality (league centring). */
  sumQ: 0,
  /** Sum of the separation move the read made (rating points). */
  dSep: 0,
  /** Sum of the INT-probability move the read made (exact). */
  dInt: 0,
  /** Sum of the receiver read deviations (a sanity check on the centre). */
  sumSkill: 0,
}

/** J52: reset the dev accumulator. */
export function resetWrrStat(): void {
  WRR_STAT.n = 0
  WRR_STAT.conv = 0
  WRR_STAT.sumQ = 0
  WRR_STAT.dSep = 0
  WRR_STAT.dInt = 0
  WRR_STAT.sumSkill = 0
}

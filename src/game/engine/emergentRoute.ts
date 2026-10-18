// ─────────────────────────────────────────────────────────────────────────────
// E2 (FUTURES #54) — route vs coverage, decided on the field.
//
// The pass game's *contest* (was: the J7 matchup separation model at
// playsim.ts:4785–4870 plus the `compRaw` completion term) is resolved here as a
// real, short race between the two men the sim already named: the targeted
// receiver runs his actual route (data/routes.ts via vision.ts's
// `routeForCandidate` and the concept's playbook assignment) at his own pace,
// with cut sharpness from his own AGI + route rating for the throw's depth; the
// covering defender — the man the sim actually assigned (`coverId`) — mirrors
// and closes on his own SPD/ACC/AGI, after a read delay from his own PRC/AWR; a
// help safety closes on throws into his area. The separation at the catch is the
// distance between them when the ball arrives (the flight time comes from the
// existing `airTimeFor` on the throw's air yards).
//
// Every number comes from the SPECIFIC men on the play (their own ratings
// through `paceFor`/`attrOf` + `fatiguePace`), never a unit/roster/team mean.
// Motion is the shared `LiveField`/`pursue` model moved to `engine/` in P0 —
// there is no second speed function here. Determinism: ZERO `rng()` draws are
// added or removed; every decision is `hash32`/`h01` on `${n}:${defId}:…` and
// the replaced block consumed no draws, so the seed stream is untouched.
//
// Like every other individual layer in the engine, the league level is held by a
// centring constant (`EMERGENT_E2.sepCenter`, the `MU_CENTER`/`WX_CENTER`
// pattern) measured by the probe; only the spread between individuals moves.
// The toggle ships OFF: with `setEmergentE2(false)` nothing below is read and
// `resolvePass` is byte-identical to the pre-E2 sim.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player } from '../types'
import { ROUTES, routeKey } from '../data/routes'
import { LiveField, holdSpot, phases, type Brain, type LiveMover } from './liveField'
import { paceFor, fatiguePace, attrOf } from './pace'
import { airTimeFor } from './throw'
import { hash32 } from './rng'

const FH = 53.3
const MID_Y = FH / 2
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const h01 = (key: string) => (hash32(key) >>> 0) / 4294967296

// ── the one tunable object ───────────────────────────────────────────────────
// Everything E2 reads is here. The defaults are the pre-calibration values; the
// bands are centred by `sepCenter`/`compCenter` (measured by `e2-probe`), so the
// object only moves the *spread*, not the league mean.
export const EMERGENT_E2 = {
  // ON by default (emerjoint 2026-10-17): the joint calibration landed the route
  // field in the NFL bands. `setEmergentE2(false)` is the dev toggle.
  on: true,
  /** Engine step (s) — the shared LiveField step. */
  dt: 0.05,
  /** Separation at which a defender is considered engaged (the field ring). */
  keepR: 0.35,

  // ── ball / timing ──────────────────────────────────────────────────────────
  /** League ball speed for the flight time (airTimeFor's reference). */
  ballRef: 21.9,
  /** Route run before the throw: base (screen) + per air yard, capped. */
  relBase: 0.62,
  relPerYd: 0.052,
  relMax: 2.5,

  // ── the receiver ───────────────────────────────────────────────────────────
  /** Route rating (DRR/MRR/SRR for the depth) → top-speed efficiency. */
  routeTopW: 0.015,
  /** (AGI + route rating) → cut-sharpness retention of acceleration. */
  cutW: 4.2,

  // ── the cover defender ─────────────────────────────────────────────────────
  // In coverage the defender arrives AT the catch TRAILING the receiver (in
  // phase, a hip behind); the separation is how far off his hip he still is. The
  // man starts `trail` behind; his read (PRC/AWR/MCV) sets how much he
  // anticipates the route (the mirror's `lead`) and how soon he starts (the read
  // delay), and his own SPD/ACC/AGI set how fast he closes and how sharply he
  // turns at the break. LiveField's steer turns all of that into motion.
  /** MCV/PSR above the league → a tighter trail (yd per rating point). */
  pressW: 0.14,
  /** (SPD+ACC)/2 above the league → a tighter trail (yd per rating point). */
  speedTrailW: 0.088,
  /** Trail (yd behind the receiver at the snap) by air-depth bucket. */
  trailBase: { screen: 2.2, short: 2.4, mid: 2.6, deep: 2.6 } as Record<string, number>,
  /** Read delay (s) at a league defender, per rating point of PRC/AWR, bounds. */
  readBase: 0.30,
  readPrcW: 0.008,
  readLo: 0.03,
  readHi: 0.70,
  /** Extra read delay in zone (the man is not across from him). */
  zoneRead: 0.22,
  /** Anticipation in the mirror (s of the receiver's velocity), by read rating. */
  leadBase: 0.10,
  leadAwrW: 0.014,
  leadMcvW: 0.011,
  leadPrcW: 0.011,
  leadLo: 0.02,
  leadHi: 0.75,

  // ── the help safety (deep / zone help over the top) ────────────────────────
  helpOnDepth: 10,
  helpDepth: 13,
  helpBase: 0.30,
  helpPrcW: 0.006,
  helpSpdW: 0.03,

  // ── separation → the sim ───────────────────────────────────────────────────
  /** The league mean separation at catch (yd) by bucket — BDB 2021 means, which
   *  the base sim's own recorded separation also matches (e2_nfl.py). Screen is
   *  raised to offset the wider screen spread's clamp loss at the sepMax cap. */
  base: { screen: 6.93, short: 3.342, mid: 2.532, deep: 2.068 } as Record<string, number>,
  /** Measured league mean of the RAW field separation, by bucket (the centre).
   *  Re-measured on the 3-seed 500-game panel (E2_STAT, n≈34k). */
  sepCenter: { screen: 1.312, short: 1.598, mid: 2.903, deep: 6.027 } as Record<string, number>,
  /** Spread multiplier (raw deviation → recorded separation). Set so the RECORDED
   *  p10–p90 span matches BDB 2021 at each depth (the probe prints both). */
  spread: { screen: 4.72, short: 2.86, mid: 0.85, deep: 0.45 } as Record<string, number>,
  /** Rating units per yard (mirrors MU.yardsPerUnit). */
  yardsPerUnit: 0.16,
  /** Diagnostic multiplier on the separation signal fed back to the sim. 0 = E2
   *  decides the CATCH CONTEST only (the sim's own separation/receiving model is
   *  left to the J7 layer — the yardage/YAC channel belongs to E1). */
  muW: 0,
  /** Completion-probability move per yard of separation above the centre. */
  compPerYd: 0.085,
  /** The completion centre per bucket. Set so the layer's per-play mean equals
   *  the J7 completion term it replaces ((meanJ7 − MU_CENTER.comp)/compPerYd of
   *  measured offset, see the verify log) — the league level is held by
   *  construction, and only the field's own spread moves. */
  compCenter: { screen: 1.375, short: 2.12, mid: 3.088, deep: 6.131 } as Record<string, number>,
  /** Measured league anchor for the aggregate completion (the J8C.coverBase role).
   *  Measured by the paired OFF/ON sweep: the field's per-play spread holds the
   *  league rate a little low once it replaces the J7 term, so a small positive
   *  lift (0.011 ≈ 1.1 pts, probe/calib: pooled 6-seed drift, see the verify log)
   *  puts the aggregate back on the OFF level. */
  compLift: 0.011,
  // ── red-zone field compression (rzcompress) ─────────────────────────────────
  // The end line limits the field: a defender cannot be beaten deep past the back of
  // the end zone, so coverage plays tighter as the snap nears the goal. `c` rises from
  // 0 at `rzZone` yd out to 1 at `rzFull` yd (pure geometry: the room that is left);
  // the raw separation loses `c * rzSepLoss` yd, scaled by the cover man's own MCV and
  // the receiver's route skill (an elite cover man loses the receiver more, a sharp
  // route runner less). No rng draw.
  rzZone: 20,
  rzFull: 7,
  rzSepLoss: 2.2,
  rzMcvW: 0.012,
  rzRouteW: 0.008,
  /** A coverage bust / mis-call leaves the man open (extra yd). */
  bustAdd: 6.5,
  miscallAdd: 4.5,
  // ── the incomplete-branch attribution (bookkeeping only, no counter moves) ──
  /** In-phase reach (yd): inside this the cover man can get a hand on the ball. */
  pbuReach: 2.2,
  /** Break-up move per unit of closeness x ball skill (J8C.pbuBase window). */
  pbuW: 0.06,
  pbuBskW: 15,
  /** A contested arrival is a harder catch — the drop attribution rises. */
  contestDropW: 0.55,
  sepMin: -2.0,
  sepMax: 12.0,
  blanket: 0.8,
  tight: 1.7,
  open: 3.4,
}

/** Dev accumulator (turned on by `e2-probe`): the raw field separation. */
export const E2_STAT = {
  on: false,
  n: 0,
  raw: [] as number[],
  byBucket: {} as Record<string, { n: number; sum: number; sum2: number; sumC: number; sumM: number; sumJ: number }>,
  /** The sim inputs (dev): the centring check — both must have mean ~0. */
  sumComp: 0,
  sumMu: 0,
}

export function setEmergentE2(on: boolean): void {
  EMERGENT_E2.on = on
}
export function getEmergentE2(): boolean {
  return EMERGENT_E2.on
}

function bucketOf(depth: number): string {
  return depth <= 2 ? 'screen' : depth <= 9 ? 'short' : depth <= 19 ? 'mid' : 'deep'
}
function tagOf(sepYd: number): 'blanket' | 'tight' | 'open' | 'wide' {
  return sepYd <= EMERGENT_E2.blanket ? 'blanket'
    : sepYd <= EMERGENT_E2.tight ? 'tight'
      : sepYd <= EMERGENT_E2.open ? 'open' : 'wide'
}

/** The receiver's route rating for this throw's depth (the sim's own choice). */
function routeRatingOf(target: Player, depth: number): number {
  if (depth > 14) return attrOf(target, 'DRR')
  if (depth > 7) return attrOf(target, 'MRR')
  return attrOf(target, 'SRR')
}

/** A depth fallback when the playbook assignment carries no real route. */
function fallbackRoute(depth: number, h: number): string {
  if (depth <= 2) return 'screen'
  if (depth <= 9) return ['quickOut', 'slant', 'out', 'hitch', 'stick'][h % 5]
  if (depth <= 19) return ['dig', 'curl', 'glance', 'in', 'whip'][h % 5]
  return ['go', 'post', 'corner', 'outUp', 'seam'][h % 5]
}

// ── the route polyline (the receiver's own alignment) ────────────────────────
function alignOf(target: Player, wrIdx: number): { x: number; y: number } {
  const y = target.pos === 'WR'
    ? (wrIdx === 0 ? 7.5 : wrIdx === 1 ? 45.8 : 24)
    : target.pos === 'TE' ? 28.5 : 20.5
  return { x: 0, y }
}
function alignDepthOf(target: Player): number {
  return target.pos === 'RB' || target.pos === 'FB' ? 3.5 : target.pos === 'TE' ? 1.2 : 0.7
}

/** The route key for this throw, from the playbook assignment (or a fallback). */
function routeOf(route: string | undefined, depth: number, h: number): string {
  const name = route ?? fallbackRoute(depth, h)
  const key = routeKey(name)
  return ROUTES[key] && ROUTES[key].depth > 0 ? key : fallbackRoute(depth, h)
}

interface WPt { t: number; x: number; y: number }

/** The receiver's waypoints in field coordinates (with the mesh/cross flip). */
function routePts(key: string, alignY: number, los: number, inw: number, out: number, side: number): WPt[] {
  const def = ROUTES[key] ?? ROUTES.check
  let raw = def.wps(alignY, los, 1, inw, out, side)
  const endY = raw[raw.length - 1]?.y ?? alignY
  if (/^(meshIn|cross|drag|shallow)$/.test(key) && (endY < 1.2 - 1.5 || endY > FH - 1.2 + 1.5)) {
    raw = raw.map((w) => ({ ...w, y: 2 * alignY - w.y }))
  }
  return raw.map((w) => ({ t: w.t, x: clamp(w.x, 0.6, 119.4), y: clamp(w.y, 0.8, FH - 0.8) }))
}

/**
 * Follow the route polyline at the man's own top speed. The want point is `look`
 * yards further along the ARC (not the next vertex), so LiveField's arrival
 * braking never caps him below his pace — he runs his route at his own speed and
 * the cuts come from the shared steer/accel model.
 */
function routeBrain(pts: { x: number; y: number }[], look: number): Brain {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  const total = cum[cum.length - 1] || 1
  return (_t, me) => {
    let bestD = Infinity
    let bestS = 0
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const L2 = dx * dx + dy * dy || 1
      let u = ((me.x - a.x) * dx + (me.y - a.y) * dy) / L2
      u = u < 0 ? 0 : u > 1 ? 1 : u
      const px = a.x + dx * u
      const py = a.y + dy * u
      const d = Math.hypot(me.x - px, me.y - py)
      if (d < bestD) { bestD = d; bestS = cum[i - 1] + u * Math.sqrt(L2) }
    }
    const sT = Math.min(total, bestS + look)
    let i = 1
    while (i < cum.length - 1 && cum[i] < sT) i++
    const segL = cum[i] - cum[i - 1] || 1
    const u = (sT - cum[i - 1]) / segL
    const a = pts[i - 1]
    const b = pts[i]
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, speed: me.mv.pace.top }
  }
}

/**
 * A cover man's brain: chase the receiver's actual position (a small anticipation
 * `lead` for a good read). LiveField's own `steer`/`pace` moves him, so a faster
 * or quicker man closes more and turns sharper at the break; there is no second
 * speed function. The `ring` keeps him off the receiver's body.
 */
function mirrorBrain(lead: number, ring: number): Brain {
  return (t, me, f) => {
    const c = f.where('rec', t)
    if (!c) return null
    const cv = f.velOf('rec', t)
    return { x: c.x + cv.x * lead, y: c.y + cv.y * lead, speed: me.mv.pace.top, ring: { key: 'rec', r: ring } }
  }
}

function mover(key: string, x: number, y: number, pace: { top: number; acc: number }, p?: Player): LiveMover {
  return { key, t: 0, x, y, path: [{ t: 0, x, y }], pace, lastStop: false, player: p }
}

export interface E2Input {
  target: Player
  cover: Player | undefined
  help: Player | undefined
  route: string | undefined
  wrIdx: number
  conceptDepth: number
  passAir: number
  yard: number
  n: number
  offId: string
  defId: string
  manCoverage: number
  fat: Record<string, number> | undefined
  bust: boolean
  miscall: boolean
  /** The J7 completion term this layer replaces (the level anchor measurement). */
  j7Comp: number
}

export interface E2Result {
  /** The recorded separation at the catch (yards). */
  sepYd: number
  /** The coverage tag for the recorded separation (a bust/mis-call wins). */
  coverTag: 'blanket' | 'tight' | 'open' | 'wide' | 'bust' | 'miscall'
  /** The real separation in the sim's rating-unit scale, centred (see muW). */
  muNet: number
  /** Whether playsim should feed `muNet` into the sim's `separation` term. */
  useMuNet: boolean
  /** The completion window move (centred) — playsim adds MU_CENTER.comp. */
  compDelta: number
  /** Break-up attribution on an incompletion: the cover man's own arrival + ball skill. */
  pbuAdd: number
  /** Drop attribution on an incompletion: how contested the catch point was. */
  contest: number
  /** The raw field separation (yards), pre-centring. */
  raw: number
  bucket: string
}

/** The real route-vs-coverage separation for THIS throw (yards). No rng draw. */
export function emergentRoute(inp: E2Input): E2Result {
  const E = EMERGENT_E2
  const depth = inp.conceptDepth
  const bucket = bucketOf(depth)
  const seed = `${inp.n}:${inp.defId}`
  const tgt = inp.target
  const cover = inp.cover

  // ── the receiver: his route at his own pace ────────────────────────────────
  const alignY = alignOf(tgt, inp.wrIdx).y
  const los = inp.yard
  const recX = clamp(los - alignDepthOf(tgt), 0.8, 118)
  const inw = alignY < MID_Y ? 1 : -1
  const out = -inw
  const side = hash32(`e2side:${seed}:${inp.offId}`) % 2 ? 1 : -1
  const key = routeOf(inp.route, depth, hash32(`e2route:${seed}:${inp.offId}`))
  const pts = routePts(key, alignY, los, inw, out, side)

  const routeR = routeRatingOf(tgt, depth)
  const agi = attrOf(tgt, 'AGI')
  const fatT = fatiguePace(inp.fat?.[tgt.id])
  const base = paceFor(tgt, tgt.pos)
  const recPace = {
    top: base.top * clamp(1 + (routeR - 72) * E.routeTopW, 0.74, 1.28) * fatT.top,
    acc: base.acc * clamp(1 + (((agi - 72) * 0.5 + (routeR - 72) * 0.5) * E.cutW * 0.004), 0.85, 1.15) * fatT.acc,
  }
  const recStart = { x: recX, y: alignY }

  // ── the cover defender: trail, read delay, own pace ────────────────────────
  const zone = clamp(1 - inp.manCoverage, 0, 1)
  const jitter = (h01(`e2jit:${seed}`) - 0.5) * 2.4
  const covPace = cover ? paceFor(cover, cover.pos) : { top: 8, acc: 4.5 }
  const fatC = fatiguePace(cover ? inp.fat?.[cover.id] : undefined)
  const covPace2 = { top: covPace.top * fatC.top, acc: covPace.acc * fatC.acc }
  const recog = cover ? (attrOf(cover, 'PRC') + attrOf(cover, 'AWR')) * 0.5 : 70
  const mcv = cover ? attrOf(cover, 'MCV') : 70
  const covAth = cover ? (attrOf(cover, 'SPD') + attrOf(cover, 'ACC')) * 0.5 : 70
  const trail = clamp(
    (E.trailBase[bucket] ?? 2.4) - (mcv - 72) * E.pressW * inp.manCoverage - (covAth - 72) * E.speedTrailW,
    0.2, 9,
  )
  const covStart = {
    // Man: he is on the receiver's hip, a trail behind. Zone: he drops to his
    // landmark downfield, so the receiver has to run away from him.
    x: clamp(recStart.x - trail * inp.manCoverage + zone * (depth * 0.4), 0.8, 118),
    y: clamp(recStart.y + jitter + zone * (MID_Y - recStart.y) * 0.25, 0.8, FH - 0.8),
  }
  const lead = clamp(
    E.leadBase + (attrOf(cover, 'AWR') - 72) * E.leadAwrW + (mcv - 72) * E.leadMcvW
      + (attrOf(cover, 'PRC') - 72) * E.leadPrcW,
    E.leadLo, E.leadHi,
  )
  const readDelay = clamp(E.readBase - (recog - 72) * E.readPrcW, E.readLo, E.readHi) + zone * E.zoneRead

  // ── the ball ───────────────────────────────────────────────────────────────
  const rel = clamp(E.relBase + Math.max(0, inp.passAir) * E.relPerYd, 0.35, E.relMax)
  const tCatch = clamp(rel + airTimeFor(E.ballRef, Math.max(0, inp.passAir)), 0.25, 6)

  // ── run the field ──────────────────────────────────────────────────────────
  const field = new LiveField(0, { plan: () => ({ drive: () => ({ x: 0, y: 0 }), shedAt: 1e9 }) })
  field.add(mover('rec', recStart.x, recStart.y, recPace, tgt), 'off', routeBrain(pts, 11))
  const covA = field.add(mover('cov', covStart.x, covStart.y, covPace2, cover), 'def', mirrorBrain(lead, E.keepR))
  covA.recover = readDelay

  let helpA: { key: string } | undefined
  const useHelp = !!inp.help && depth >= E.helpOnDepth
  if (useHelp) {
    const h = inp.help!
    const helpPace = paceFor(h, h.pos)
    const hFat = fatiguePace(inp.fat?.[h.id])
    const hx = clamp(los + E.helpDepth + (depth > 19 ? 6 : 0), 6, 96)
    const hy = MID_Y + (alignY < MID_Y ? -6 : 6)
    const hRecog = (attrOf(h, 'PRC') + attrOf(h, 'AWR')) * 0.5
    const hDelay = clamp(E.helpBase - (hRecog - 72) * E.helpPrcW, 0.05, 0.9)
    const helpLead = clamp(0.1 + (attrOf(h, 'SPD') - 72) * E.helpSpdW, 0.02, 0.45)
    helpA = field.add(mover('help', hx, hy, { top: helpPace.top * hFat.top, acc: helpPace.acc * hFat.acc }, h), 'def',
      phases([
        { from: 0, brain: holdSpot({ x: hx, y: hy }, helpPace.top * 0.8, 1) },
        { from: hDelay, brain: mirrorBrain(helpLead, E.keepR) },
      ]))
  }

  field.run(tCatch)

  const rp = field.where('rec') ?? recStart
  const cp = field.where('cov') ?? covStart
  let sep = Math.hypot(cp.x - rp.x, cp.y - rp.y)
  if (helpA) {
    const hp = field.where('help')
    if (hp) sep = Math.min(sep, Math.hypot(hp.x - rp.x, hp.y - rp.y))
  }
  // Red-zone compression: the end line is the room that is left (see rzZone).
  const toGoal = 100 - inp.yard
  if (E.rzSepLoss > 0 && toGoal < E.rzZone) {
    const c = clamp((E.rzZone - toGoal) / (E.rzZone - E.rzFull), 0, 1)
    const rf = clamp(1 + (mcv - 72) * E.rzMcvW, 0.6, 1.5) * clamp(1 - (routeR - 72) * E.rzRouteW, 0.7, 1.3)
    sep = Math.max(0, sep - c * E.rzSepLoss * rf)
  }
  // A coverage bust / mis-call is a broken assignment — the man is simply open.
  if (inp.bust) sep += E.bustAdd
  else if (inp.miscall) sep += E.miscallAdd

  if (E2_STAT.on) {
    E2_STAT.n++
    E2_STAT.raw.push(sep)
    const b = (E2_STAT.byBucket[bucket] ??= { n: 0, sum: 0, sum2: 0, sumC: 0, sumM: 0, sumJ: 0 })
    b.n++
    b.sum += sep
    b.sum2 += sep * sep
  }

  // ── separation → the sim (centred on the measured league mean) ─────────────
  const center = E.sepCenter[bucket] ?? 3
  const baseSep = E.base[bucket] ?? 3
  const sepYd = +clamp(baseSep + (sep - center) * (E.spread[bucket] ?? 1), E.sepMin, E.sepMax).toFixed(1)
  const compDelta = E.compPerYd * (sep - (E.compCenter[bucket] ?? center)) + E.compLift
  const muNet = ((sep - center) / E.yardsPerUnit) * E.muW
  // The incomplete branch's attribution: whether the cover man arrived in phase
  // (his own JMP/PRC decide the break-up) and how contested the catch point was
  // (the receiver's own CTH decides the drop). Bookkeeping only — no counter moves.
  const close = clamp(1 - sep / E.pbuReach, 0, 1)
  const bsk = cover ? (attrOf(cover, 'JMP') + attrOf(cover, 'PRC')) * 0.5 : 70
  const pbuAdd = E.pbuW * close * clamp((bsk - 72) / E.pbuBskW, -1, 1) * (1 - clamp((attrOf(tgt, 'CTH') - 72) / 60, 0, 0.4))
  const contest = E.contestDropW * close * clamp(1 - (attrOf(tgt, 'CTH') - 70) / 60, 0.4, 1.4)
  if (E2_STAT.on) {
    E2_STAT.sumComp += compDelta
    E2_STAT.sumMu += muNet
    const bc = (E2_STAT.byBucket[bucket] ??= { n: 0, sum: 0, sum2: 0, sumC: 0, sumM: 0, sumJ: 0 })
    bc.sumC += compDelta
    bc.sumM += muNet
    bc.sumJ += inp.j7Comp ?? 0
  }  const coverTag: E2Result['coverTag'] = inp.bust ? 'bust' : inp.miscall ? 'miscall' : tagOf(sepYd)
  return { sepYd, coverTag, muNet, useMuNet: E.muW > 0, compDelta, pbuAdd, contest, raw: +sep.toFixed(3), bucket }
}

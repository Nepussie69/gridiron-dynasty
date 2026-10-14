// ─────────────────────────────────────────────────────────────────────────────
// J37 (FUTURES #37): QB–receiver timing & OL continuity — pairs that share snaps
// build chemistry.
//
// (a) QB x receiver timing. Every throw a quarterback makes to a receiver is a
//     shared rep; a pair that has thrown together a lot reads each other — the
//     ball arrives earlier and more precisely (a better catch window, fewer
//     timing interceptions). A brand-new pairing (a trade, a rookie, a backup
//     QB) starts at zero and has to build it.
// (b) OL continuity. The five linemen block as four ADJACENT pairs (LT–LG, LG–C,
//     C–RG, RG–RT). On a twist / stunt the two men must pass the rusher off; a
//     pair that has played together handles the exchange, a reshuffled or
//     injury-hit line blows it and the rusher runs free (J8b's per-rep win).
//
// The counters live on the save (`World.chem`, an optional field, so an old save
// loads with no chemistry and builds it), are per-PAIR — never a team or unit
// average — and decay slowly in the offseason. The effect is centred on the
// league's own typical chemistry (the shared-weighted mean across pairs, exactly
// the `WX_CENTER` role) so league means hold: a pair at the league's chemistry is
// neutral, a settled pair is better, a fresh one worse.
//
// Toggle: `setJ37(on)` / `getJ37()` (the `setStamina` pattern), default ON. With
// it OFF nothing here is read or written and every resolver keeps its exact
// pre-J37 expression, so the engine is byte-identical to the base.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player, Position } from '../types'
import type { World } from './generate'
import type { Play } from './playsim'
import { depthAt, depthGroup } from './depth'

let J37_ON = true
export function setJ37(on: boolean) {
  J37_ON = on
}
/** J37: read the toggle so a probe can restore it exactly. */
export function getJ37(): boolean {
  return J37_ON
}

/**
 * J37: every constant this job adds, in one place. All deterministic (counts and
 * hashes only) — no rng() draw is added or removed.
 */
export const CHEM = {
  /** QB–WR: shared targets at which chemistry reaches half its ceiling. */
  kTargets: 35,
  /** OL: shared scrimmage snaps at which an adjacent pair reaches half. */
  kOl: 180,
  /** Completion-window points per unit of relative skill chemistry (0..1). */
  compW: 0.14,
  /** Relative INT multiplier per unit of relative skill chemistry (higher = fewer). */
  intW: 2.0,
  /** The INT leg's own centre offset, as a FRACTION of the league's QB–WR centre (the
   *  `WX_CENTER` role; zero at cold start, so a fresh league stays inert). The INT
   *  multiplier is correlated with the play's own pick rate (backup QBs and rookies carry
   *  BOTH the fresh pairs and the high pick rates), so this leg is centred where the
   *  league's mean pick rate holds, measured exactly with `J37_STAT.dInt` (not the mean
   *  rel): about -0.045 at a mature centre of 0.40. */
  intShiftFrac: -0.11,
  /** Residual offset of the QB–WR centre for the completion leg, as a FRACTION of the
   *  centre: the modelled centre is built from the depth charts and the measured usage
   *  table and the outer completion clamp saturates the settled side; this takes out
   *  what is left so the league's completion rate holds once the pass-rush side effect of
   *  the OL leg is counted (`J37_STAT.dComp`, mature-league ON-OFF): about 0.003 at 0.40. */
  skillShiftFrac: 0.0075,
  /** QB–WR: the share of a backup QB in the league's throw-weighted centre, set to
   *  the MEASURED share of non-QB1 attempts (5.6% / 0.0% / 10.1% across three mature
   *  2-season leagues, `logs/j37-comp.out`; league mean ≈5%). The counters are
   *  QB1-only, so a backup's pairs sit at 0.00 and his throws pull the league's real
   *  throw-weighted pair value BELOW a QB1-only model; modelling him at his true
   *  share keeps the mature league centred. (Cutting this to 0.01 over-raised the
   *  centre: the mature completion drift went to −0.40, `logs/j37-mature8.out`.) */
  qb2Share: 0.05,
  /** How much MORE the rep of a blocker whose adjacent handoff broke loses, per unit of
   *  the pair's relative chemistry (multiplier on the free-rusher bonus of the base
   *  engine's own stunt event: 1 at the league's typical chemistry, 1 + 8 x 0.4 for a
   *  reshuffled pair, 1 - 8 x 0.4 for a settled one). A single LINEAR leg, so E[effect] = 0
   *  for a league centred on its typical chemistry whatever the spread. */
  handoffK: 8,
  /** Offseason decay: a pair keeps this share of its shared reps year over year. */
  offseasonDecay: 0.65,
  /** OL centre offset as a FRACTION of the centre (the `WX_CENTER` role, not a per-unit
   *  value; zero at cold start so the layer stays inert on a fresh league). The handoff leg
   *  is a single linear term, so it is neutral when the mean blocker sits at the centre; the
   *  residual (+0.4-0.8 points of pass-rush edge on a mature league, the max-over-reps
   *  Jensen term, measured with `J37_STAT.dEdge`) is small enough to leave at 0. */
  olCentreFrac: 0,
  /** Nominal targets per AI game (starter shares) so league chemistry keeps pace
   *  with the user's club when the AI games are score-simulated (no play-by-play). */
  nominal: { wr1: 8, wr2: 5, wr3: 3, te: 5, rb: 4, ol: 62 },
  /** MEASURED share (%) of a club's throws each healthy depth slot gets, from a
   *  mature 2-season league on the tree with the J10a/J10b read progression (3 leagues,
   *  seeds 777 / 4242 / 9999, 120 real games each, `logs/salvage-verify.out` §J37):
   *
   *    WR 13.7 / 5.7 / 28.3 / 0.6 / 0.0   TE 29.8 / 4.4 / 0.5   RB 16.2 / 0.9
   *
   *  (100.0% of ~24,500 throws.)  The read progression moved a lot of the ball off
   *  WR2 and onto the third receiver and the TE (the earlier pre-J10 table was
   *  21.6 / 19.1 / 15.8 and TE 20.2); re-measure with `logs/j37-usage.mjs` whenever the
   *  target model changes.  Used ONLY to weight the league centre — the counters
   *  themselves stay the raw shared reps. */
  usage: { WR: [13.7, 5.7, 28.3, 0.6, 0.0], TE: [29.8, 4.4, 0.5], RB: [16.2, 0.9] },
} as const

/** The skill slots `CHEM.usage` lists, in the order the centre walks them. */
const SKILL_SLOTS = ['WR', 'TE', 'RB'] as const

export interface ChemState {
  /** The season these counters belong to (the offseason-decay marker). */
  season: number
  /** QB x receiver shared targets, keyed by `pairKey`. */
  pairs: Record<string, number>
  /** Adjacent OL shared scrimmage snaps, keyed by `pairKey`. */
  ol: Record<string, number>
  /** Derived: the league centres the terms are centred on ([`refreshCenters`]).
   *  Recomputed whenever the counters move, so every read inside a play sees the
   *  same frozen value on the coached and fast paths. */
  skillC?: number
  olC?: number
}

/** A stable, order-independent key for a two-player pair. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** The chemistry value (0..1) of a pair from its shared-rep count. */
function value(n: number, k: number): number {
  return n > 0 ? n / (n + k) : 0
}

/** QB–WR shared targets for a pair (0 when the layer is off / no history). */
export function skillValue(world: World, a: string | undefined, b: string | undefined): number {
  if (!a || !b) return 0
  const n = world.chem?.pairs?.[pairKey(a, b)] ?? 0
  return value(n, CHEM.kTargets)
}

/** Adjacent-OL shared snaps for a pair. */
export function olValue(world: World, a: string, b: string): number {
  const n = world.chem?.ol?.[pairKey(a, b)] ?? 0
  return value(n, CHEM.kOl)
}

/**
 * J37: the league's TYPICAL MATURE chemistry for QB–receiver timing — the value
 * the term is centred on (the `WX_CENTER` role), never a per-unit value used in
 * place of a player's own rating.
 *
 * The counters are NOT the throw distribution: they accumulate over a career, so a
 * three-year pair holds several times the reps of this week's new one. Centring on
 * the counters alone centres on long-tenured pairs and makes the whole league worse
 * as soon as chemistry exists (measured: −1.2 points, 40 bands missed —
 * `logs/j37-mature.out`). So the centre is built from what the league is ABOUT to
 * do: every NFL club contributes its CURRENT QB1 x healthy skill chart, each slot
 * weighted by the measured share of a club's throws it gets (`CHEM.usage`), every
 * club weighted equally. A club that just traded for a QB, drafted a rookie or lost
 * a starter pulls the centre down exactly as its own throws will be. (On a mature
 * league this lands at 0.485 against a 0.500 real throw-weighted mean.)
 */
function leagueSkillCenter(world: World): number {
  let sum = 0
  let teams = 0
  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    const qbs = depthGroup(world, t.id, ['QB'], 2)
    const qb = qbs[0]
    if (!qb) continue
    const qb2 = qbs[1]
    let v = 0
    let wsum = 0
    for (const pos of SKILL_SLOTS) {
      const shares = CHEM.usage[pos]
      const men = depthGroup(world, t.id, [pos], shares.length)
      for (let i = 0; i < shares.length && i < men.length; i++) {
        const v1 = skillValue(world, qb.id, men[i].id)
        const v2 = qb2 ? skillValue(world, qb2.id, men[i].id) : 0
        v += shares[i] * ((1 - CHEM.qb2Share) * v1 + CHEM.qb2Share * v2)
        wsum += shares[i]
      }
    }
    sum += wsum > 0 ? v / wsum : 0
    teams++
  }
  return teams > 0 ? sum / teams : 0
}

/** J37: each blocker's mean of his adjacent pair(s) — the quantity the handoff
 *  term consumes. A tackle has one partner, a guard/centre two. */
function handoffValues(world: World, align: Player[]): Map<string, number> {
  const sum = new Map<string, number>()
  const cnt = new Map<string, number>()
  for (let i = 0; i + 1 < align.length; i++) {
    const v = olValue(world, align[i].id, align[i + 1].id)
    for (const p of [align[i], align[i + 1]]) {
      sum.set(p.id, (sum.get(p.id) ?? 0) + v)
      cnt.set(p.id, (cnt.get(p.id) ?? 0) + 1)
    }
  }
  const out = new Map<string, number>()
  for (const [id, s] of sum) out.set(id, s / (cnt.get(id) ?? 1))
  return out
}

/** J37: the league's typical OL continuity — every club's CURRENT healthy five,
 *  aligned LT/LG/C/RG/RT, each blocker's handoff value averaged, all clubs equal.
 *  The snaps from here on go to the men on the field now, so a reshuffled line
 *  falls below this reference and a settled one stands above it. */
function leagueOlCenter(world: World): number {
  let sum = 0
  let teams = 0
  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    const men = depthGroup(world, t.id, ['OT', 'OG', 'C'], 5)
    if (men.length < 2) continue
    const vals = handoffValues(world, olAlignment(world, t.id, men))
    if (!vals.size) continue
    let v = 0
    for (const x of vals.values()) v += x
    sum += v / vals.size
    teams++
  }
  return teams > 0 ? sum / teams : 0
}

/** J37: recompute both league centres from the state and the current rosters.
 *  Called wherever the counters move — never inside a play — so the coached and
 *  fast paths read the same frozen value and stay byte-identical to each other. */
export function refreshCenters(world: World): void {
  const s = world.chem
  if (!s) return
  s.skillC = leagueSkillCenter(world)
  s.olC = leagueOlCenter(world)
}

/** The cached centres, computed on the spot if a legacy save has none yet. */
function skillCenter(world: World): number {
  const s = world.chem
  if (!s) return 0
  if (s.skillC === undefined) refreshCenters(world)
  return s.skillC ?? 0
}
function olCenter(world: World): number {
  const s = world.chem
  if (!s) return 0
  if (s.olC === undefined) refreshCenters(world)
  return (s.olC ?? 0) * (1 - CHEM.olCentreFrac)
}

/** The league's QB–WR centre (0 until chemistry exists). */
export function skillCentre(world: World): number {
  return skillCenter(world)
}

/** Relative skill chemistry: the pair's value minus the league's typical value. */
export function skillRel(world: World, a: string | undefined, b: string | undefined): number {
  return skillValue(world, a, b) - skillCenter(world)
}

/** Relative OL chemistry for a pair. */
export function olRel(world: World, a: string, b: string): number {
  return olValue(world, a, b) - olCenter(world)
}

/**
 * J37: the OL alignment LT, LG, C, RG, RT from the men actually on the field —
 * each side ordered by his depth-chart rank so an injury replacement slots into
 * the right gap. Any on-field lineman not covered by the three position ranks is
 * appended (never dropped), so the four adjacent pairs always span the unit.
 */
export function olAlignment(world: World, teamId: string, ol: Player[]): Player[] {
  const rankOf = (pos: Position) => {
    const m = new Map<string, number>()
    depthAt(world, teamId, pos).forEach((p, i) => m.set(p.id, i))
    return m
  }
  const rOT = rankOf('OT')
  const rOG = rankOf('OG')
  const rC = rankOf('C')
  const byRank = (r: Map<string, number>) => (a: Player, b: Player) => (r.get(a.id) ?? 99) - (r.get(b.id) ?? 99)
  const ots = ol.filter((p) => p.pos === 'OT').sort(byRank(rOT))
  const ogs = ol.filter((p) => p.pos === 'OG').sort(byRank(rOG))
  const cs = ol.filter((p) => p.pos === 'C').sort(byRank(rC))
  const list = [ots[0], ogs[0], cs[0], ogs[1], ots[1]].filter((p): p is Player => !!p)
  for (const p of ol) if (!list.includes(p)) list.push(p)
  return list
}

/**
 * J37: each on-field lineman's relative handoff chemistry — the mean of his
 * adjacent pair(s) with the man (or men) he passes a twist off to. A tackle has
 * one partner, a guard/centre two. Returns a map id → relative value.
 */
export function olHandoffChem(world: World, teamId: string, ol: Player[]): Map<string, number> {
  const vals = handoffValues(world, olAlignment(world, teamId, ol))
  const c = olCenter(world)
  const out = new Map<string, number>()
  for (const [id, v] of vals) out.set(id, v - c)
  return out
}

/** Create/normalise the state and apply the lazy offseason decay. */
function ensure(world: World): ChemState {
  if (!world.chem) world.chem = { season: world.season, pairs: {}, ol: {} }
  const s = world.chem
  if (!s.pairs) s.pairs = {}
  if (!s.ol) s.ol = {}
  if (s.season !== world.season) {
    decayChemistry(world)
    s.season = world.season
  }
  return s
}

/** J37: slow offseason decay — every pair keeps `offseasonDecay` of its reps. */
export function decayChemistry(world: World): void {
  if (!J37_ON) return
  const s = world.chem
  if (!s) return
  const d = CHEM.offseasonDecay
  for (const key in s.pairs) s.pairs[key] *= d
  for (const key in s.ol) s.ol[key] *= d
  s.season = world.season
  // The rosters churn over the offseason, so the centres are recomputed here too.
  refreshCenters(world)
}

/**
 * J37: fold one finished game's shared reps into the save. Called by the season/
 * week hook after a play-by-play game (never during resolution, so the coached
 * and fast paths read the same frozen state and stay identical). No-op when OFF.
 */
export function accrueGameChemistry(world: World, sim: { plays: Play[] }): void {
  if (!J37_ON || !sim?.plays?.length) return
  const s = ensure(world)
  const byId = new Map(world.players.map((p) => [p.id, p]))
  for (const p of sim.plays) {
    if (p.type !== 'run' && p.type !== 'pass') continue
    if (p.type === 'pass' && p.qbId && p.targetId) {
      const key = pairKey(p.qbId, p.targetId)
      s.pairs[key] = (s.pairs[key] ?? 0) + 1
    }
    const ids = p.onFieldOff
    if (!ids || !ids.length) continue
    const ol = ids.map((id) => byId.get(id)).filter((x): x is Player => !!x && (x.pos === 'OT' || x.pos === 'OG' || x.pos === 'C'))
    if (ol.length < 2) continue
    const align = olAlignment(world, p.offId, ol)
    for (let i = 0; i + 1 < align.length; i++) {
      const key = pairKey(align[i].id, align[i + 1].id)
      s.ol[key] = (s.ol[key] ?? 0) + 1
    }
  }
  // The counters moved: re-centre the league on the chemistry it now throws with.
  refreshCenters(world)
}

/**
 * J37: nominal league accrual for a score-simulated (AI) game, where there is no
 * play-by-play. The current starters share a game's worth of reps, so the AI's
 * chemistry keeps pace with the user's club and the league stays centred. No-op
 * when OFF.
 */
export function accrueNominalChemistry(world: World, homeId: string, awayId: string): void {
  if (!J37_ON) return
  const s = ensure(world)
  for (const teamId of [homeId, awayId]) {
    const qb = depthAt(world, teamId, 'QB')[0]
    if (qb) {
      const wrs = depthAt(world, teamId, 'WR')
      const shares = [CHEM.nominal.wr1, CHEM.nominal.wr2, CHEM.nominal.wr3]
      for (let i = 0; i < shares.length && i < wrs.length; i++) {
        const key = pairKey(qb.id, wrs[i].id)
        s.pairs[key] = (s.pairs[key] ?? 0) + shares[i]
      }
      const te = depthAt(world, teamId, 'TE')[0]
      if (te) { const key = pairKey(qb.id, te.id); s.pairs[key] = (s.pairs[key] ?? 0) + CHEM.nominal.te }
      const rb = depthAt(world, teamId, 'RB')[0]
      if (rb) { const key = pairKey(qb.id, rb.id); s.pairs[key] = (s.pairs[key] ?? 0) + CHEM.nominal.rb }
    }
    const ol: Player[] = []
    for (const pos of ['OT', 'OG', 'C'] as Position[]) ol.push(...depthAt(world, teamId, pos).slice(0, pos === 'C' ? 1 : 2))
    if (ol.length >= 2) {
      const align = olAlignment(world, teamId, ol)
      for (let i = 0; i + 1 < align.length; i++) {
        const key = pairKey(align[i].id, align[i + 1].id)
        s.ol[key] = (s.ol[key] ?? 0) + CHEM.nominal.ol
      }
    }
  }
  refreshCenters(world)
}

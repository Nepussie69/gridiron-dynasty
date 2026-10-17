import type { CareerState, DraftProspect, Player, PlayerOrigin, Position } from '../types'
import { makeRookieContract } from './cap'
import { canDraft } from './career'
import { coachHoldsTradePen } from './access'
import { computeDraftOrder } from './sim'
import { ensureDraftPicks } from './picks'
import { pushLedger } from './ledger'
import { departmentGrade } from './department'
import { convictionPick } from './conviction'
import { redFlagIds } from './redflag'
import { roomNote, roomTilt, roomWinner } from './draftRoom'
import { applyDraftTradeDown, roomTradeDown } from './draftTrades'
import { makeCharacter } from './character'
import { isEvaluator, scoutReport } from './scoutBias'
import { athleticPercentileOf } from './measure'
import { type World, classCeiling, generalManager, gmTemperament, indexPlayers } from './generate'
import { clamp, hash32, makeRng } from './rng'
import { rescaleOvr, unscaleOvr } from './ovrScale'

export const DRAFT_ROUNDS = 7
export const DRAFT_TEAMS = 32
export const TOTAL_PICKS = DRAFT_ROUNDS * DRAFT_TEAMS

/** L12.6 C1: the steps the offseason moves through, in calendar order. */
export type OffseasonStage = 'resign' | 'freeAgency' | 'draft' | 'camp'

export const OFFSEASON_STAGES: OffseasonStage[] = ['resign', 'freeAgency', 'draft', 'camp']

/**
 * The current offseason stage, or null during the regular season. A live save
 * without the field (legacy) defaults to `draft` until the class is finished,
 * otherwise `camp`.
 */
export function stageOf(world: World): OffseasonStage | null {
  if (world.phase !== 'offseason') return null
  if (world.offseasonStage) return world.offseasonStage
  return world.draftState?.complete ? 'camp' : 'draft'
}

/** L12.6 C2: the draft is actionable only in April — the `draft` stage. */
export function draftOpen(world: World): boolean {
  return stageOf(world) === 'draft'
}

/** How many offseason stages remain before the draft (0 when the draft is open). */
export function stagesUntilDraft(world: World): number {
  const stage = stageOf(world)
  if (!stage) return 0
  return Math.max(0, OFFSEASON_STAGES.indexOf('draft') - OFFSEASON_STAGES.indexOf(stage))
}

export function initDraft(world: World) {
  const picks = ensureDraftPicks(world, world.season + 1)
  world.draftPicks = picks
  const built = buildDraftOrder(world)
  world.draftOrder = built.order
  world.draftRounds = built.rounds
  world.draftPickIds = built.ids
  world.draftState = { round: 1, pickIndex: 0, complete: false, log: [] }
  for (const p of world.draft) {
    p.draftedBy = null
    p.draftPick = null
  }
}

/**
 * Build the round-by-round selection order from pick ownership. Original slots
 * order the board (worst record first); traded picks keep their original slot
 * but belong to their new owner; comp picks go last in their round.
 */
export function buildDraftOrder(world: World): { order: string[]; rounds: number[]; ids: string[] } {
  const upcoming = world.season + 1
  const picks = ensureDraftPicks(world, upcoming)
  const base = computeDraftOrder(world)
  const slot = new Map(base.map((id, i) => [id, i]))
  const order: string[] = []
  const rounds: number[] = []
  const ids: string[] = []
  for (let r = 1; r <= DRAFT_ROUNDS; r++) {
    const group = picks
      .filter((p) => p.season === upcoming && p.round === r)
      .sort((a, b) => {
        const ac = a.comp ? 1 : 0
        const bc = b.comp ? 1 : 0
        if (ac !== bc) return ac - bc
        return (slot.get(a.originalTeam) ?? 99) - (slot.get(b.originalTeam) ?? 99)
      })
    for (const p of group) {
      order.push(p.ownerTeam)
      rounds.push(r)
      ids.push(p.id)
    }
  }
  return { order, rounds, ids }
}

/** Number of selections in the current draft (varies with trades/comp picks). */
export function totalPicks(world: World) {
  return world.draftOrder.length || TOTAL_PICKS
}

export function overallPick(world: World) {
  return world.draftState.pickIndex + 1
}
export function currentRound(world: World) {
  if (world.draftRounds?.length) return world.draftRounds[world.draftState.pickIndex] ?? DRAFT_ROUNDS
  return Math.min(DRAFT_ROUNDS, Math.floor(world.draftState.pickIndex / DRAFT_TEAMS) + 1)
}
export function currentTeamId(world: World): string | null {
  if (world.draftState.complete) return null
  return world.draftOrder[world.draftState.pickIndex] ?? null
}

const NEED_TARGETS: Record<string, number> = {
  QB: 3, RB: 3, WR: 6, TE: 3, OT: 4, OG: 4, C: 2, DE: 4, DT: 4, LB: 6, CB: 6, S: 4, K: 1, P: 1,
}

export function userOnClock(world: World, career: CareerState | null) {
  if (!career || !canDraft(career)) return false
  return currentTeamId(world) === career.teamId
}

/**
 * On the clock for trade purposes. A head coach who holds the trade pen
 * (CareerState.tradeControl 'coach') does not make the pick — his GM does —
 * but the draft pauses on his slot so he can still take a trade-back offer.
 * For every other career this is exactly `userOnClock`.
 */
export function userOnTradeClock(world: World, career: CareerState | null) {
  if (userOnClock(world, career)) return true
  return !!career && coachHoldsTradePen(career) && currentTeamId(world) === career.teamId
}

function teamNeeds(roster: Player[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const p of roster) counts[p.pos] = (counts[p.pos] ?? 0) + 1
  const needs: Record<string, number> = {}
  for (const pos of Object.keys(NEED_TARGETS)) {
    needs[pos] = Math.max(0, (NEED_TARGETS[pos] ?? 0) - (counts[pos] ?? 0))
  }
  return needs
}

/** A user's ranked board, folded into the AI's decision while they lack draft authority. */
export interface BoardAdvice {
  board: string[]
  weight: number
}
/** How much a director trusts your board, from your evaluation reputation + skill. */
export function adviceWeight(career: CareerState): number {
  return clamp(0.15 + (career.reputation.evaluation / 100) * 0.5 + (career.skills.evaluation / 100) * 0.35, 0.15, 1)
}

/**
 * #47: how much a club's GM trusts raw athletic testing, in grade points. Every
 * GM reads the numbers his own way — his appetite for athleticism comes off his
 * own id and is sharpened or blunted by his own drafting eye (gmTemperament), so
 * a poor evaluator leans harder on shared consensus while a sharp one backs his
 * read of the stopwatch. Individual, deterministic, pure; a GM-less (user) club
 * gets nothing.
 */
const MEASURE_TILT_PTS = 4
const ZERO_TILT = () => 0
export function gmMeasureTilt(world: World, teamId: string): (p: DraftProspect) => number {
  const gm = generalManager(world, teamId)
  if (!gm) return ZERO_TILT
  const appetite = ((hash32(`gmtilt|${gm.id}`, 149) % 201) - 100) / 100 // −1…1, his own
  const eye = (gmTemperament(gm).drafting - 62) / 33 // ≈ −0.8…1
  const w = appetite * (0.85 + 0.5 * eye)
  if (Math.abs(w) < 0.1) return ZERO_TILT
  const k = (w * MEASURE_TILT_PTS) / 50
  return (p) => k * (athleticPercentileOf(p) - 50)
}

/**
 * L12.17 DR3: a club's own board. Every NPC club draft off the reports its own
 * scouts filed (scoutBias), never a shared public list: no two clubs read a
 * prospect the same way, so one club's miss is another club's steal — and the
 * user's department board is one voice among thirty-two rather than the only
 * voice on a league-wide constant.
 *
 * The board is the two scouting voices — the area Scout and the Director of
 * Player Personnel — because that is who stacks a real board: a head coach and
 * his coordinators weigh in on fit (the room tilt), not on the stacked grade. A
 * club with neither falls back to any evaluator, then to the public consensus.
 *
 * #47: the club's GM then tilts the stacked grade by his own read of the
 * prospect's athletic testing (gmMeasureTilt) — the same true stopwatch every
 * club sees, weighed differently.
 *
 * Pure (hash-based) and memoised per call site: a draft makes ~200 picks against
 * the same class, so the closure caches each club's report per prospect.
 */
export function clubBoardOf(world: World, teamId: string): (p: DraftProspect) => number {
  const tilt = gmMeasureTilt(world, teamId)
  const staff = world.staff[teamId] ?? []
  const scouting = staff.filter((m) => m.role === 'Scout' || m.role === 'Director of Player Personnel')
  const evaluators = scouting.length ? scouting : staff.filter(isEvaluator)
  if (!evaluators.length) return (p) => p.grade + tilt(p)
  const cache = new Map<string, number>()
  return (p) => {
    let v = cache.get(p.id)
    if (v == null) {
      let sum = 0
      for (const m of evaluators) sum += scoutReport(m, p)
      v = Math.round(sum / evaluators.length + tilt(p))
      cache.set(p.id, v)
    }
    return v
  }
}

/** Best available prospect for a team, weighing talent vs. positional need. */
export function bestAvailableFor(
  world: World,
  teamId: string,
  advice?: BoardAdvice,
  gradeOf?: (p: DraftProspect) => number,
  tilt?: (p: DraftProspect) => number,
): DraftProspect | null {
  const available = world.draft.filter((p) => !p.draftedBy)
  if (!available.length) return null
  const needs = teamNeeds(world.roster[teamId] ?? [])
  const scored = available.map((p) => {
    // L12.17 DR3c: the need reach was +6 (a full round) over a ~4-point top-32
    // talent spread, so clubs routinely passed a true top-32 man for a need body.
    // NFL boards are talent-first: a need now buys ~2 grades (3 at QB), so a real
    // top-32 talent only falls when his own file carries a flag.
    const needBonus = (needs[p.pos] ?? 0) > 0 ? 1 : 0
    const posPremium = p.pos === 'QB' ? 3 : p.pos === 'DE' || p.pos === 'OT' || p.pos === 'CB' ? 1 : 0
    let adviceBonus = 0
    if (advice) {
      const idx = advice.board.indexOf(p.id)
      if (idx >= 0) adviceBonus = advice.weight * Math.max(4, 30 - idx * 4)
    }
    // FUTURES #27 DF1: the draft room's blended tilt. Absent (the default) the
    // score is byte-identical to before.
    const roomBonus = tilt ? tilt(p) : 0
    return { p, score: (gradeOf ? gradeOf(p) : p.grade) + needBonus + posPremium + adviceBonus + roomBonus }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0].p
}

export function prospectToPlayer(world: World, prospect: DraftProspect, teamId: string, pick: number, season: number, origin?: PlayerOrigin): Player {
  const contract = makeRookieContract(pick, season)
  // D1 (L12.7): the NFL rookie opens on the true-grade class curve, not at his
  // college OVR. Real-data prospects get a compressed pro ceiling; generated
  // ones keep theirs. See `rookieRatings`.
  const { rank, size } = trueGradeRank(world, prospect)
  const ratings = rookieRatings(prospect, rank, size)
  return {
    id: `pl_${prospect.id}`,
    name: prospect.name,
    pos: prospect.pos,
    side: posSide(prospect.pos),
    age: prospect.age,
    height: heightFor(prospect),
    weight: weightFor(prospect),
    college: prospect.college,
    ovr: ratings.ovr,
    pot: ratings.pot,
    dev: devFor(ratings.pot),
    traits: prospect.traits,
    contract,
    teamId,
    morale: 80,
    character: prospect.character ?? makeCharacter(prospect.id),
    generated: prospect.generated ?? true,
    origin: origin ?? { kind: 'draft', season, round: prospect.projectedRound, by: null },
  }
}

/** The interpolation anchors for a rookie's opening OVR by true-grade class rank. */
const ROOKIE_RANK_CURVE: [number, number][] = [
  [1, 79],
  [5, 76],
  [32, 71],
  [64, 67],
  [100, 64],
  [160, 60],
  [224, 55],
]

/** Piecewise-linear OVR for a true-grade rank in the class (floors at 55). */
function rookieOvrCurve(rank: number): number {
  if (rank <= 1) return ROOKIE_RANK_CURVE[0][1]
  for (let i = 1; i < ROOKIE_RANK_CURVE.length; i++) {
    const [r0, v0] = ROOKIE_RANK_CURVE[i - 1]
    const [r1, v1] = ROOKIE_RANK_CURVE[i]
    if (rank <= r1) return v0 + ((v1 - v0) * (rank - r0)) / (r1 - r0)
  }
  return ROOKIE_RANK_CURVE[ROOKIE_RANK_CURVE.length - 1][1]
}

/**
 * L12.7 (user-approved, 2026-10-08): one-time fix for saves whose real-data
 * rookies were drafted under the old rule (college OVR + 3, college POT). Rebuild
 * each one on the NFL rookie scale from his class rank (the prospect id is
 * `d<season>_<rank-1>`, ranked by college OVR) and keep a little credit for
 * seasons already played. Generated players and veterans are untouched.
 */
export function rescaleLegacyRookies(world: World): number {
  if (world.rookieScaleV2) return 0
  let n = 0
  for (const p of world.players) {
    const m = /^pl_d(\d+)_(\d+)$/.exec(p.id)
    if (!m || p.generated || p.origin?.kind !== 'draft') continue
    const rank = Number(m[2]) + 1
    const pot = clamp(Math.round(58 + (p.pot - 60) * 0.95), 60, 97)
    const seasons = Math.max(0, world.season - (p.origin.season ?? world.season) - 1)
    const jitter = (hash32(`d${m[1]}_${m[2]}`, 13) % 3) - 1
    const start = Math.round(rookieOvrCurve(rank) + jitter)
    p.pot = pot
    p.ovr = Math.max(50, Math.min(pot, Math.min(start, pot - 3) + seasons * 3))
    // `pot` is still on the old scale here (the L12.15 S3 migration rescales the
    // whole world right after this), so pick the tier straight from it instead of
    // through `devFor`, which now converts a new-scale pot back to the old scale.
    p.dev = pot >= 95 ? 'X-Factor' : pot >= 89 ? 'Superstar' : pot >= 83 ? 'Star' : pot >= 76 ? 'Starter' : 'Depth'
    n += 1
  }
  world.rookieScaleV2 = true
  return n
}

/** A prospect's 1-based true-grade rank (id breaks ties) and the class size. */
function trueGradeRank(world: World, prospect: DraftProspect): { rank: number; size: number } {
  let rank = 1
  for (const p of world.draft) {
    if (p.id === prospect.id) continue
    if (p.trueGrade > prospect.trueGrade || (p.trueGrade === prospect.trueGrade && p.id < prospect.id)) rank++
  }
  return { rank, size: world.draft.length }
}

/**
 * L12.17 DR2e: the per-player boom/bust on a rookie's ceiling, by true class
 * standing. A Rd1 pick busts more often (the stakes, the pressure, the medicals);
 * a Day-3 body booms more often (nothing to lose, special-teams motor). Applied to
 * every man individually — deterministic on the prospect id — so no band is a mean
 * and no `rng()` draw is spent.
 */
function slotTail(id: string, rank: number): number {
  const band = rank <= 32 ? 0 : rank <= 64 ? 1 : rank <= 100 ? 2 : rank <= 150 ? 3 : rank <= 224 ? 4 : 5
  const BUST = [14, 9, 5, 3, 3, 3]
  const BOOM = [20, 12, 14, 16, 16, 10]
  const h = hash32(id, 71) % 100
  if (h < BUST[band]) return -(5 + (hash32(id, 72) % 6))
  if (h < BUST[band] + BOOM[band]) return 2 + (hash32(id, 74) % 5)
  return 0
}

/**
 * D1 (L12.7) / L12.17 DR2: an NFL rookie's opening OVR and ceiling, as pure a
 * function as the prospect allows. Both come from the player's own true-talent
 * class standing: the opening rating off the L12.7 rank curve, the ceiling off
 * `classCeiling` (NFL-like rarity — a late-round body does not carry a top-band
 * ceiling), each with a deterministic per-player wobble from the id. Pure: no
 * rng draw, so the play sim is untouched.
 */
export function rookieRatings(
  prospect: DraftProspect,
  classRank: number,
  classSize: number,
): { ovr: number; pot: number } {
  const real = !prospect.generated
  const openWob = (hash32(prospect.id, 13) % 5) - 2
  // L12.17 DR2d: real-data rookies keep the L12.7 *college-pot* ceiling — their own
  // physical tape, not their class rank — so the within-class ceiling spread
  // survives even though the true-talent curve is now steep (a scout's steal is
  // still a steal, and a Rd3 body can still grow into a job). Generated bodies take
  // the rank-based `classCeiling`.
  const topTrim = classRank > 12 && prospect.pot >= 99 && hash32(prospect.id, 41) % 2 === 0 ? 1 : 0
  const pot = real ? clamp(Math.round(58 + (prospect.pot - 60) * 0.95) - topTrim, 60, 97) : prospect.pot
  const curve = Math.round(rookieOvrCurve(classRank) + openWob)
  const today = Math.min(prospect.pot, Math.round(prospect.ovr + 3))
  const base = real ? curve : Math.min(today, curve)
  // L12.15 S1: map the old-scale curve through the remap so a rookie enters on the
  // new scale, with no one over 76. L12.15 S4: the bottom of every class is a
  // spread of bodies, not one flat rating — the rank curve sets the order, the id
  // wobble the spread.
  const frac = 0.5
  const raw = Math.min(76, rescaleOvr(Math.max(50, Math.min(base, pot - 3)), frac))
  const ovr = raw < 65 ? clamp(Math.round((raw + 63) / 2) + ((hash32(prospect.id, 29) % 5) - 2), 56, 64) : raw
  const baseCeil = real ? Math.max(ovr, rescaleOvr(pot, frac)) : Math.max(ovr, rescaleOvr(pot, frac), clamp(classCeiling(classRank, classSize), 50, 98))
  // L12.17 DR2e: a rookie's realised potential is his own draw, never a band mean.
  // `slotTail` is the per-player boom/bust (motor, coaching fit, medical, a growth
  // spurt no scout can see); `tilt` is the small opening-OVR shift that gives the
  // Day-3 rounds their pro-ready bodies (they reach the starter line but rarely the
  // 85 Pro-Bowl band). Deterministic on the prospect id: no `rng()` draw.
  const tail = slotTail(prospect.id, classRank)
  const tilt = classRank <= 32 ? -1 : classRank <= 100 ? 0 : classRank <= 150 ? 1 : 2
  const ceiling = clamp(baseCeil + tail, 50, 98)
  return { ovr: clamp(ovr + tilt, 50, 98), pot: ceiling }
}

/**
 * D3 (L12.7): the "Now / Ceiling" a scout can see, ranking the class by your own
 * grade (`myGrade ?? grade`) so the hidden true grade never leaks. `Now` is the
 * opening OVR the prospect would sign at; `ceiling` is his pro potential.
 */
export function rookieProjection(
  prospects: DraftProspect[],
  prospect: DraftProspect,
): { now: number; ceiling: number } {
  const key = (p: DraftProspect) => p.myGrade ?? p.grade
  let rank = 1
  for (const p of prospects) {
    if (p.id === prospect.id) continue
    const a = key(p)
    const b = key(prospect)
    if (a > b || (a === b && p.id < prospect.id)) rank++
  }
  const r = rookieRatings(prospect, rank, prospects.length)
  return { now: r.ovr, ceiling: r.pot }
}

function posSide(pos: Position): Player['side'] {
  if (['QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'OG', 'C'].includes(pos)) return 'OFF'
  if (['K', 'P'].includes(pos)) return 'ST'
  return 'DEF'
}
function devFor(pot: number): Player['dev'] {
  const raw = unscaleOvr(pot)
  if (raw >= 95) return 'X-Factor'
  if (raw >= 89) return 'Superstar'
  if (raw >= 83) return 'Star'
  if (raw >= 76) return 'Starter'
  return 'Depth'
}
function heightFor(p: DraftProspect) {
  const h = hash32(p.id, 7) % 8
  return `${6}'${2 + h}"`
}
function weightFor(p: DraftProspect) {
  return 190 + (hash32(p.id, 11) % 130)
}

/** Record a pick for whoever is on the clock. */
export function makePick(world: World, prospect: DraftProspect, teamId: string, by?: string | null) {
  const pick = overallPick(world)
  prospect.draftedBy = teamId
  prospect.draftPick = pick
  const player = prospectToPlayer(world, prospect, teamId, pick, world.season + 1, {
    kind: 'draft',
    season: world.season,
    round: currentRound(world),
    pick,
    by: by ?? null,
    pickId: world.draftPickIds?.[world.draftState.pickIndex],
  })
  world.players.push(player)
  ;(world.roster[teamId] ??= []).push(player)
  world.draftState.log.unshift(
    `Rd ${currentRound(world)} · Pick ${pick} — ${world.byId[teamId].abbr} selects ${prospect.name} (${prospect.pos}, ${prospect.college})`,
  )
  advancePick(world)
  return player
}

function advancePick(world: World) {
  world.draftState.pickIndex += 1
  world.draftState.round = currentRound(world)
  if (world.draftState.pickIndex >= totalPicks(world)) world.draftState.complete = true
}

/**
 * Run AI picks until the user is on the clock or the draft ends. A head coach
 * holding the trade pen also pauses on his slot (so he can trade it); `gmGo`
 * lets the GM make that one pick and carry on.
 */
export function simUntilUser(world: World, career: CareerState | null, max = 0, gmGo = false) {
  const cap = max || totalPicks(world)
  const startIndex = world.draftState.pickIndex
  // L12.17 DR3: NPC clubs read their own scouts' reports, not a shared public
  // list. One closure (and report cache) per club for this run of picks.
  const clubs = new Map<string, (p: DraftProspect) => number>()
  const boardFor = (teamId: string) => {
    let f = clubs.get(teamId)
    if (!f) {
      f = clubBoardOf(world, teamId)
      clubs.set(teamId, f)
    }
    return f
  }
  let steps = 0
  while (!world.draftState.complete && steps < cap) {
    if (career && canDraft(career) && currentTeamId(world) === career.teamId) break
    if (
      career &&
      coachHoldsTradePen(career) &&
      currentTeamId(world) === career.teamId &&
      !(gmGo && world.draftState.pickIndex === startIndex)
    )
      break
    const teamId = currentTeamId(world)
    if (!teamId) break
    // If the user lacks draft authority but has filed a board, the NPC weighs it.
    const advising = !!career && career.teamId === teamId && !canDraft(career) && (career.userBoard?.length ?? 0) > 0
    const advice: BoardAdvice | undefined = advising ? { board: career!.userBoard!, weight: adviceWeight(career!) } : undefined
    // The user's club drafts from the department grade (G1), not public consensus;
    // every NPC club drafts off its own evaluators' filed reports (DR3).
    let gradeOf =
      career && teamId === career.teamId ? (p: DraftProspect) => departmentGrade(world, career!, p) ?? p.grade : boardFor(teamId)
    // K4: your club's simulated picks skip prospects you red-flagged.
    if (gradeOf && career) {
      const flagged = redFlagIds(world, career)
      if (flagged.length) {
        const base = gradeOf
        gradeOf = (p: DraftProspect) => (flagged.includes(p.id) ? -999 : base(p))
      }
    }
    // FUTURES #27 DF1: on your club's picks the room's blended stance tilts the
    // board (red flag first, then the tilt, then a conviction call can still win).
    const tilt = career && teamId === career.teamId ? roomTilt(world, career) : undefined
    // FUTURES #27 DF2: an Accumulate room moves off the clock itself when an NPC is
    // running your pick. Deterministic (h01), read-only until it actually accepts,
    // and it reuses the same accept internals a click uses. A coach who holds the
    // trade pen keeps that call, so his room never trades for him.
    if (career && teamId === career.teamId && !canDraft(career) && !coachHoldsTradePen(career) && gradeOf) {
      const tradedRound = currentRound(world)
      const move = roomTradeDown(world, career, gradeOf)
      if (move) {
        const applied = applyDraftTradeDown(world, career, move.offer, { runForward: false })
        if (applied.ok) {
          pushLedger(career, {
            kind: 'advice',
            name: `Trade down with ${applied.partnerAbbr}`,
            pos: '—',
            college: '—',
            round: tradedRound,
            note: move.note,
            accepted: true,
          })
          steps++
          continue
        }
      }
    }
    let prospect = bestAvailableFor(world, teamId, advice, gradeOf, tilt)
    // G2: in advise mode the Director may pound the table for a conviction call.
    if (prospect && career && teamId === career.teamId && !canDraft(career)) {
      const roll = makeRng(world.seed + world.season * 97 + world.draftState.pickIndex)()
      prospect = convictionPick(world, career, prospect, gradeOf ?? ((p) => p.grade), roll) ?? prospect
    }
    if (!prospect) {
      world.draftState.complete = true
      break
    }
    const round = currentRound(world)
    // The room note is read off the board the pick was made from.
    const winner = tilt && career ? roomWinner(world, career, prospect.id) : null
    const player = makePick(world, prospect, teamId)
    if (tilt && career && teamId === career.teamId) {
      pushLedger(career, {
        kind: 'advice',
        prospectId: prospect.id,
        playerId: player.id,
        name: prospect.name,
        pos: prospect.pos,
        college: prospect.college,
        myGrade: prospect.myGrade ?? prospect.grade,
        round,
        pick: prospect.draftPick ?? undefined,
        truth: prospect.trueGrade,
        accepted: true,
        note: roomNote(winner),
      })
    }
    if (advising && advice && career) {
      const onBoard = advice.board.includes(prospect.id)
      pushLedger(career, {
        kind: 'advice',
        prospectId: prospect.id,
        playerId: player.id,
        name: prospect.name,
        pos: prospect.pos,
        college: prospect.college,
        myGrade: prospect.myGrade ?? prospect.grade,
        round,
        pick: prospect.draftPick ?? undefined,
        truth: prospect.trueGrade,
        accepted: onBoard,
        note: onBoard
          ? 'The Director followed your board.'
          : 'The Director went another way over your board.',
      })
    }
    steps++
  }
  return steps
}

export function simulateRestOfDraft(world: World, career: CareerState | null) {
  let guard = totalPicks(world) + 5
  while (!world.draftState.complete && guard-- > 0) {
    simUntilUser(world, career, totalPicks(world))
    if (world.draftState.complete) break
    const teamId = currentTeamId(world)
    if (!teamId) break
    // A head coach holding the trade pen: the draft paused on his slot, so the GM makes the pick as usual.
    if (career && teamId === career.teamId && coachHoldsTradePen(career)) {
      simUntilUser(world, career, totalPicks(world), true)
      continue
    }
    // The user's club is on the clock but the user chose to auto-finish: take best available for them.
    const mine = !!career && teamId === career.teamId
    // L12.17 DR3: an NPC club drafts off its own evaluators' reports.
    const gradeOf = mine ? (p: DraftProspect) => departmentGrade(world, career!, p) ?? p.grade : clubBoardOf(world, teamId)
    // FUTURES #27 DF1: an auto/clock pick uses your own vector at 0.7 plus the
    // room's at 0.3 — you still hear the building before the card goes in.
    const tilt = mine ? roomTilt(world, career, { auto: true }) : undefined
    const prospect = bestAvailableFor(world, teamId, undefined, gradeOf, tilt)
    if (!prospect) {
      world.draftState.complete = true
      break
    }
    const winner = tilt && career ? roomWinner(world, career, prospect.id) : null
    const round = currentRound(world)
    const player = makePick(world, prospect, teamId, mine ? career!.gmName : null)
    if (tilt && career) {
      pushLedger(career, {
        kind: 'advice',
        prospectId: prospect.id,
        playerId: player.id,
        name: prospect.name,
        pos: prospect.pos,
        college: prospect.college,
        myGrade: prospect.myGrade ?? prospect.grade,
        round,
        pick: prospect.draftPick ?? undefined,
        truth: prospect.trueGrade,
        accepted: true,
        note: roomNote(winner),
      })
    }
  }
  return world.draftState.complete
}

// ── Compensatory picks ───────────────────────────────────────────────────────
/**
 * Award compensatory picks for the upcoming draft based on net free agents lost
 * last cycle. Teams that lost more qualifying veterans than they signed get one
 * or two extra selections, placed at the end of a round like the real rule.
 */
export function awardCompensatoryPicks(world: World): number {
  const picks = ensureDraftPicks(world, world.season + 1)
  const ledger = world.compLedger ?? {}
  let awarded = 0
  const MAX_COMPS = 32
  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    if (awarded >= MAX_COMPS) break
    const l = ledger[t.id]
    if (!l) continue
    const net = l.lost - l.gained
    const count = net >= 4 ? 2 : net >= 2 ? 1 : 0
    const rounds = count === 2 ? [3, 5] : [3]
    for (const r of rounds) {
      if (awarded >= MAX_COMPS) break
      picks.push({
        id: `pk_${world.season + 1}_${r}_${t.id}_comp${awarded}`,
        season: world.season + 1,
        round: r,
        originalTeam: t.id,
        ownerTeam: t.id,
        comp: true,
      })
      awarded++
    }
  }
  // Reset the ledger; the next cycle starts fresh.
  for (const k of Object.keys(ledger)) ledger[k] = { lost: 0, gained: 0 }
  return awarded
}

/** Teams sign a couple of undrafted free agents after the draft. */
export function runUDFAs(world: World) {
  const rng = makeRng(world.seed + world.season * 40503)
  const udfa = world.draft.filter((p) => !p.draftedBy).sort((a, b) => b.grade - a.grade).slice(0, 180)
  const teams = world.teams.filter((t) => t.tier === 'NFL')
  for (const prospect of udfa) {
    const team = teams[hash32(prospect.id, 3) % teams.length]
    const player = prospectToPlayer(world, prospect, team.id, 250 + Math.floor(rng() * 10), world.season + 1, {
      kind: 'udfa',
      season: world.season,
      by: null,
    })
    player.contract = makeRookieContract(224, world.season + 1)
    player.ovr = Math.max(60, player.ovr - 5)
    world.players.push(player)
    world.roster[team.id].push(player)
    prospect.draftedBy = team.id
  }
  // Z1b: every UDFA signed must also be a canonical `world.players` entry.
  indexPlayers(world)
}

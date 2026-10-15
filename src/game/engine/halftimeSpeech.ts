// ─────────────────────────────────────────────────────────────────────────────
// Halftime speech (FUTURES #7, phase H1 — engine only).
//
// The fourth halftime card: a head coach's motivational speech, separate from
// the X&O adjustment (STAY THE COURSE there is an X&O fix, not this). Fire them
// up / calm them down / challenge a star / stay the course. It can land, fall
// flat or backfire, and a landed speech buys a small second-half edge.
//
// INDIVIDUAL, NOT TEAM-AVERAGE (user directive 2026-10-11). The team-level
// land/backfire verdict is one deterministic hash draw (spec), but the second-
// half edge is the SUM OF EACH CORE PLAYER'S OWN RESPONSE. Every response is
// built from that specific player's own inputs — `leaderScore` (his hidden
// makeup, standing and years of service), his morale, his character
// (coachability / maturity / off-field risk) and his age. There is no team or
// unit mean or median anywhere in the speech path: an elite leader and a poor
// one are on opposite sides of the room, and the sum is what the club feels.
//
// SIM-NEUTRAL DEFAULT. Nothing here draws rng(): the verdict is `hash32`, the
// responses are pure. AI clubs never speak (playsim only builds the card for
// the user's club, and `decide` leaves an AI club on the default), and the
// default answer is STAY THE COURSE, which stores no outcome at all — so the
// default user game and every AI-vs-AI game are byte-identical to main.
//
// The store (H2) supplies `career.skills.leadership`, the named captains and
// the season's recent speeches via `GameCtx.speech`; the UI (H3) renders the
// card. This module is pure and total.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player, Position, Side } from '../types'
import type { World } from './generate'
import { clamp, hash32 } from './rng'
import { leaderScore, problemScore, PROBLEM_MIN } from './lockerRoom'
import { leadershipEdge } from './skills'
import { depthGroup, STARTERS } from './depth'
import type { Play, MomentOption } from './playsim'

export type SpeechId = 'fireUp' | 'calmDown' | 'challenge' | 'stayCourse'
export type SpeechResult = 'landed' | 'flat' | 'backfired'
export type SpeechFit = 'good' | 'neutral' | 'bad'

/** The user's speech context, filled from the career (H2) and read here. */
export interface SpeechCtx {
  /** The user's own `career.skills.leadership` (0–99). Absent = no leadership term. */
  leadership?: number
  /** Player ids the user named captain this season (from the locker room). */
  captainIds?: string[]
  /** This season's earlier speeches, most recent last (repetition penalty). */
  recent?: SpeechId[]
  /** Standing order: 'stay' (default) keeps STAY THE COURSE; 'staff' reads the room. */
  auto?: 'stay' | 'staff'
  /**
   * Probe-only: force the verdict so the acceptance probe can measure the
   * landed / flat / backfired second-half edges directly. The store never sets
   * this, so a real career always decides by hash.
   */
  force?: SpeechResult
}

/** The first-half situation the speech answers (counts, never a mean). */
export interface SpeechSituation {
  /** User's score minus the opponent's at the break. */
  margin: number
  /** The user's giveaways in the first half. */
  turnovers: number
  /** Accepted penalties against the user's club in the first half. */
  penalties: number
  /** Core players whose own morale is at or above the "hot room" bar. */
  hotCount: number
  coreCount: number
}

/** One core player's personal response to the speech. */
export interface SpeechResponse {
  id: string
  pos: Position
  side: Side
  result: SpeechResult
  /** His own contribution to the club's second-half edge (off + def shares). */
  resp: number
}

/** A decided speech. `off`/`def` are the club's second-half edge on each unit. */
export interface SpeechOutcome {
  teamId: string
  id: SpeechId
  result: SpeechResult
  fit: SpeechFit
  off: number
  def: number
  starId?: string
  /** One-line summary for the moment toast / `logMoment` / film. */
  line: string
  /** The individual responses the edge is the sum of. */
  responses: SpeechResponse[]
}

/** A challenger candidate: a starter with a first-half line vs his role. */
export interface SpeechCandidate {
  id: string
  name: string
  pos: Position
  side: Side
  ovr: number
  /** His first-half production for his role (higher = better). */
  score: number
  /** A short read of that line. */
  note: string
}

export interface SpeechAftermath {
  deltas: { id: string; delta: number }[]
  line: string
}

/** Every design number for the speech lives here. */
export const SPEECH = {
  /** The room the speech is delivered to (same core-22 set `avgMorale` uses). */
  core: 22,
  /** Land / backfire base chance by fit (spec: 60/40/25 and 10/20/35). */
  land: { good: 0.6, neutral: 0.4, bad: 0.25 } as Record<SpeechFit, number>,
  back: { good: 0.1, neutral: 0.2, bad: 0.35 } as Record<SpeechFit, number>,
  /** HC leadership edge → up to +10% land chance. */
  leadershipW: 0.1,
  /** A named captain (leaderScore ≥ 70) → +3% each, capped +9%. */
  captainW: 0.03,
  captainCap: 0.09,
  /** A problem player on the core → −3% each, capped −9%. */
  problemW: 0.03,
  problemCap: 0.09,
  /** Repetition: −10% per same speech in the last three games, capped −30%. */
  repeatW: 0.1,
  repeatCap: 0.3,
  /** Per-player second-half edge pool (both-unit landed speeches). */
  respW: 0.085,
  /** Per-player backfire pool (spec: a backfire is a smaller swing than a landing). */
  backW: 0.037,
  /** The challenged star's own weight, and each of his unit-mates'. */
  starW: 0.8,
  mateW: 0.02,
  /** The second-half edge clamp (spec: [−0.8, +1.0]). */
  clampLo: -0.8,
  clampHi: 1.0,
  /**
   * The offEdge/defEdge gain the speech edge is applied with. A point of
   * offEdge moves the sim's half point differential only ~0.22 in the R2
   * calibration, so the spec's [−0.8, +1.0] speech edge (reported, clamped) is
   * scaled here to land its measured 2H PD in the spec's +0.5…+2.5 band. Noted
   * as a deviation from the literal spec, which assumed a larger per-unit effect.
   */
  gain: 8,
  /** A room is "already hot" when this many core players are at/above this morale. */
  hotMorale: 85,
  hotMin: 6,
} as const

/** The core 22 by overall rating — the speech's audience (same set `avgMorale` reads). */
export function coreOf(world: World, teamId: string): Player[] {
  return [...(world.roster[teamId] ?? [])].sort((a, b) => b.ovr - a.ovr).slice(0, SPEECH.core)
}

/**
 * How much a specific player buys into a speech: his own leadership standing,
 * morale, character and experience. −1 (checked out) … +1 (all in). Every term
 * is that player's own — no team or unit figure enters.
 */
export function receptivity(p: Player): number {
  const ls = leaderScore(p)
  let r = ((ls - 55) / 45) * 0.5 + ((p.morale - 65) / 35) * 0.35 + ((p.age - 26) / 8) * 0.15
  const c = p.character
  if (c) {
    r += (((c.coachability + c.maturity) / 2 - 60) / 40) * 0.3
    r -= ((c.offFieldRisk - 45) / 55) * 0.25
  }
  return clamp(r, -1, 1)
}

/**
 * One player's contribution to the club's second-half edge for a verdict. A
 * landed speech moves each man by his own buy-in (a checked-out man contributes
 * nothing, never a negative); a backfire turns that engagement against the
 * coach (always negative). Flat is zero for everyone.
 */
export function playerResponse(p: Player, result: SpeechResult, id: SpeechId, isStar: boolean): number {
  if (result === 'flat') return 0
  const r = receptivity(p)
  if (result === 'landed') {
    const w = id === 'challenge' ? (isStar ? SPEECH.starW : SPEECH.mateW) : SPEECH.respW
    return w * Math.max(r, 0)
  }
  const w = id === 'challenge' ? (isStar ? SPEECH.starW : SPEECH.mateW) : SPEECH.backW
  return -w * (0.6 + 0.4 * r)
}

/** The first-half situation a speech answers, read from the play log. */
export function speechSituation(world: World, plays: Play[], teamId: string, margin: number): SpeechSituation {
  let turnovers = 0
  let penalties = 0
  for (const p of plays) {
    if (p.qtr > 2) continue
    if (p.offId === teamId && p.turnover) turnovers += 1
    if (p.type === 'penalty') {
      const team = p.penaltyTeam ?? (p.concept === 'Offensive Penalty' ? p.offId : p.defId)
      if (team === teamId && (!p.penaltyDisposition || p.penaltyDisposition === 'accepted')) penalties += 1
    }
  }
  const core = coreOf(world, teamId)
  const hotCount = core.filter((p) => p.morale >= SPEECH.hotMorale).length
  return { margin, turnovers, penalties, hotCount, coreCount: core.length }
}

/** How a speech fits the game situation (drives its land / backfire base). */
export function speechFit(
  id: SpeechId,
  sit: SpeechSituation,
  star?: { leader: number; morale: number; problem: number },
): SpeechFit {
  if (id === 'stayCourse') return 'neutral'
  const hot = sit.hotCount >= SPEECH.hotMin
  if (id === 'fireUp') {
    if (hot || sit.margin >= 14) return 'bad'
    return sit.margin <= 0 ? 'good' : 'neutral'
  }
  if (id === 'calmDown') {
    if (sit.margin <= -10) return 'bad'
    if (sit.turnovers >= 2 || sit.penalties >= 4 || (sit.margin >= 1 && sit.margin <= 7)) return 'good'
    return 'neutral'
  }
  // challenge
  if (!star) return 'bad'
  if (star.problem >= PROBLEM_MIN || star.morale < 45) return 'bad'
  return star.leader >= 60 && star.morale >= 60 ? 'good' : 'neutral'
}

// ── challenge target: the highest-rated starter with the weakest half ─────────
const STAR_POS: Position[] = ['QB', 'RB', 'WR', 'TE', 'DE', 'DT', 'LB', 'CB', 'S']

/** A starter's first-half production for his role (higher = a better line). */
function lineScore(pos: Position, id: string, plays: Play[]): number {
  let carries = 0
  let rushYds = 0
  let targets = 0
  let catches = 0
  let recYds = 0
  let tackles = 0
  let sacks = 0
  let ints = 0
  let pbus = 0
  for (const p of plays) {
    if (p.qtr > 2) continue
    if (p.carrierId === id && p.type === 'run') {
      carries += 1
      rushYds += Math.max(0, p.yards)
    }
    if (p.targetId === id && p.type === 'pass') {
      targets += 1
      if (p.reception) {
        catches += 1
        recYds += Math.max(0, p.yards)
      }
    }
    if (p.tackleIds?.includes(id)) tackles += 1
    if (p.sackId === id) sacks += 1
    if (p.intId === id) ints += 1
    if (p.pbuId === id) pbus += 1
  }
  switch (pos) {
    case 'QB':
      return passerRating(plays, id)
    case 'RB':
      return carries >= 3 ? rushYds / carries : rushYds
    case 'WR':
    case 'TE':
      return catches * 4 + recYds
    default:
      return tackles * 2 + sacks * 6 + ints * 10 + pbus * 3
  }
}

/** Standard NFL passer rating over the first half (same formula the sim uses). */
function passerRating(plays: Play[], qbId: string): number {
  let att = 0
  let comp = 0
  let yds = 0
  let td = 0
  let ints = 0
  for (const p of plays) {
    if (p.qbId !== qbId || p.type !== 'pass' || p.qtr > 2) continue
    if (p.result.startsWith('Sack')) continue
    att += 1
    if (p.turnover) {
      ints += 1
      continue
    }
    if (p.result === 'Incomplete') continue
    comp += 1
    yds += Math.max(0, p.yards)
    if (p.result === 'TOUCHDOWN!') td += 1
  }
  if (!att) return 0
  const term = (x: number) => Math.max(0, Math.min(2.375, x))
  const a = term((comp / att - 0.3) * 5)
  const b = term((yds / att - 3) * 0.25)
  const c = term((td / att) * 20)
  const d = term(2.375 - (ints / att) * 25)
  return ((a + b + c + d) / 6) * 100
}

/** A short read of a starter's first-half line. */
function lineNote(pos: Position, id: string, plays: Play[]): string {
  let carries = 0
  let rushYds = 0
  let catches = 0
  let recYds = 0
  let targets = 0
  let tackles = 0
  let sacks = 0
  for (const p of plays) {
    if (p.qtr > 2) continue
    if (p.carrierId === id && p.type === 'run') {
      carries += 1
      rushYds += Math.max(0, p.yards)
    }
    if (p.targetId === id && p.type === 'pass') {
      targets += 1
      if (p.reception) {
        catches += 1
        recYds += Math.max(0, p.yards)
      }
    }
    if (p.tackleIds?.includes(id)) tackles += 1
    if (p.sackId === id) sacks += 1
  }
  switch (pos) {
    case 'QB':
      return `first-half rating ${passerRating(plays, id).toFixed(1)}`
    case 'RB':
      return carries ? `${rushYds} rush yds on ${carries} carries` : 'no touches yet'
    case 'WR':
    case 'TE':
      return targets ? `${catches}/${targets} for ${recYds} yds` : 'no targets yet'
    default:
      return sacks ? `${tackles} tackles, ${sacks} sacks` : `${tackles} tackles`
  }
}

/** The challenger candidates (healthy starters, weakest line first). */
export function speechCandidates(world: World, plays: Play[], teamId: string, benchedQbId?: string): SpeechCandidate[] {
  const out: SpeechCandidate[] = []
  for (const pos of STAR_POS) {
    for (const p of depthGroup(world, teamId, [pos], STARTERS[pos] ?? 1)) {
      if (p.id === benchedQbId) continue
      out.push({ id: p.id, name: p.name, pos: p.pos, side: p.side, ovr: p.ovr, score: lineScore(p.pos, p.id, plays), note: lineNote(p.pos, p.id, plays) })
    }
  }
  return out
}

/** The challenge target: the weakest first-half line among the top starters. */
export function pickStar(cands: SpeechCandidate[]): SpeechCandidate | undefined {
  if (!cands.length) return undefined
  const anyLine = cands.some((c) => c.score > 0)
  const sorted = anyLine
    ? [...cands].sort((a, b) => a.score - b.score || b.ovr - a.ovr)
    : [...cands].sort((a, b) => b.ovr - a.ovr)
  return sorted[0]
}

/** The land chance for a speech: the fit base, moved by the specific people involved. */
export function speechLandChance(world: World, teamId: string, id: SpeechId, ctx: SpeechCtx | undefined, fit: SpeechFit): number {
  let p = SPEECH.land[fit]
  const lead = ctx?.leadership
  if (lead !== undefined) p += (clamp(leadershipEdge(lead), 0, 1.5) / 1.5) * SPEECH.leadershipW
  const byId = new Map(world.players.map((x) => [x.id, x]))
  const captains = (ctx?.captainIds ?? []).map((cid) => byId.get(cid)).filter((x): x is Player => !!x)
  const goodCaptains = captains.filter((x) => leaderScore(x) >= 70).length
  p += Math.min(goodCaptains * SPEECH.captainW, SPEECH.captainCap)
  const problems = coreOf(world, teamId).filter((x) => problemScore(x) >= PROBLEM_MIN).length
  p -= Math.min(problems * SPEECH.problemW, SPEECH.problemCap)
  const repeats = Math.min((ctx?.recent ?? []).filter((x) => x === id).length, 3)
  p -= Math.min(repeats * SPEECH.repeatW, SPEECH.repeatCap)
  return clamp(p, 0.05, 0.9)
}

/**
 * Decide a speech: the fit, the (deterministic, hash-only) verdict, and the
 * second-half edge as the sum of each core player's own response. `key` is the
 * game key (home:away:user:playCount:seed:week), so the verdict is stable for a
 * given game and never touches the rng stream.
 */
export function speechOutcome(
  world: World,
  teamId: string,
  id: SpeechId,
  ctx: SpeechCtx | undefined,
  key: string,
  opts: { sit?: SpeechSituation; starId?: string } = {},
): SpeechOutcome {
  const core = coreOf(world, teamId)
  const byId = new Map(world.players.map((p) => [p.id, p]))
  const starP = opts.starId ? byId.get(opts.starId) : undefined
  const sit = opts.sit ?? { margin: 0, turnovers: 0, penalties: 0, hotCount: core.filter((p) => p.morale >= SPEECH.hotMorale).length, coreCount: core.length }
  const star = starP ? { leader: leaderScore(starP), morale: starP.morale, problem: problemScore(starP) } : undefined
  const fit = speechFit(id, sit, star)
  const land = speechLandChance(world, teamId, id, ctx, fit)
  const back = SPEECH.back[fit]
  const roll = (hash32(`${key}:${teamId}:speech`) >>> 0) / 4294967296
  let result: SpeechResult = roll < land ? 'landed' : roll < land + back ? 'backfired' : 'flat'
  if (ctx?.force) result = ctx.force

  // The audience. A challenge is felt by the star's unit; the star himself is
  // always in it even if a thin core-22 ranking would leave him out.
  const audience: Player[] = []
  if (id === 'challenge' && starP) {
    for (const p of core) if (p.side === starP.side) audience.push(p)
    if (!audience.some((p) => p.id === starP.id)) audience.push(starP)
  } else {
    audience.push(...core)
  }
  const responses: SpeechResponse[] = audience.map((p) => {
    const resp = playerResponse(p, result, id, !!starP && p.id === starP.id)
    // PER PLAYER. A landed speech only lands for the men it reaches: a man whose
    // own terms (his morale, his makeup, his standing, his years) leave him
    // checked out takes no lift from it and falls flat for himself. A backfire
    // still turns the room against the coach, each man by his own measure. Either
    // way his own numbers decide his outcome — no team or unit mood enters.
    const own: SpeechResult = result === 'landed' && resp === 0 ? 'flat' : result
    return { id: p.id, pos: p.pos, side: p.side, result: own, resp }
  })
  const sum = responses.reduce((a, x) => a + x.resp, 0)
  const edge = clamp(sum, SPEECH.clampLo, SPEECH.clampHi)
  let off = 0
  let def = 0
  if (id === 'challenge' && starP) {
    if (starP.side === 'OFF') off = edge
    else def = edge
  } else {
    off = edge
    def = edge
  }

  return {
    teamId,
    id,
    result,
    fit,
    off,
    def,
    starId: starP?.id,
    line: outcomeLine(id, result, starP, sit),
    responses,
  }
}

function outcomeLine(id: SpeechId, result: SpeechResult, star: Player | undefined, sit: SpeechSituation): string {
  const who = star ? star.name : 'the room'
  if (result === 'flat') return id === 'challenge' ? `${who} didn't take the challenge — it fell flat.` : 'The speech fell flat.'
  if (result === 'landed') {
    if (id === 'fireUp') return 'You lit a fire under them — the room is up.'
    if (id === 'calmDown') return 'They settled in — cool heads for the second half.'
    return `You challenged ${who} — he answered.`
  }
  if (id === 'fireUp') return sit.hotCount >= SPEECH.hotMin ? 'They were already up — the speech over-amped them.' : 'The speech backfired — it rang hollow.'
  if (id === 'calmDown') return 'They read it as giving up — the speech backfired.'
  return `The challenge backfired — ${who} shut down.`
}

/** The halftime card: options, standing default and the staff read. */
export interface SpeechCard {
  options: MomentOption[]
  defaultId: string
  staffRead: string
  starId?: string
  fits: Record<SpeechId, SpeechFit>
}

const FIT_HINT: Record<SpeechFit, string> = {
  good: 'Fits',
  neutral: 'Risky',
  bad: 'Likely backfires',
}

/** The best-fitting speech for the standing order, or null if none truly fits. */
function bestFit(fits: Record<SpeechId, SpeechFit>, hasStar: boolean): SpeechId | null {
  const order: SpeechId[] = hasStar ? ['fireUp', 'calmDown', 'challenge'] : ['fireUp', 'calmDown']
  const rank: Record<SpeechFit, number> = { good: 2, neutral: 1, bad: 0 }
  let best: SpeechId | null = null
  let bestRank = 0
  for (const id of order) {
    const r = rank[fits[id]]
    if (r > bestRank) {
      bestRank = r
      best = id
    }
  }
  // A "neutral" fit is worth reading the room for; a "bad" one never is.
  return best
}

export function buildSpeechOptions(
  world: World,
  plays: Play[],
  teamId: string,
  ctx: SpeechCtx | undefined,
  opts: { margin?: number; benchedQbId?: string; ownerNote?: string } = {},
): SpeechCard {
  const sit = speechSituation(world, plays, teamId, opts.margin ?? 0)
  const cands = speechCandidates(world, plays, teamId, opts.benchedQbId)
  const star = pickStar(cands)
  const byId = new Map(world.players.map((p) => [p.id, p]))
  const starP = star ? byId.get(star.id) : undefined
  const starInfo = starP ? { leader: leaderScore(starP), morale: starP.morale, problem: problemScore(starP) } : undefined
  const fits: Record<SpeechId, SpeechFit> = {
    fireUp: speechFit('fireUp', sit, starInfo),
    calmDown: speechFit('calmDown', sit, starInfo),
    challenge: speechFit('challenge', sit, starInfo),
    stayCourse: 'neutral',
  }

  const options: MomentOption[] = [
    { id: 'fireUp', label: 'Fire them up', hint: `${FIT_HINT[fits.fireUp]} — raise the temperature in the room.` },
    { id: 'calmDown', label: 'Calm them down', hint: `${FIT_HINT[fits.calmDown]} — settle them and play the plan.` },
  ]
  if (star) options.push({ id: 'challenge', label: `Challenge ${star.name}`, hint: `${FIT_HINT[fits.challenge]} — single him out (${star.note}).` })
  options.push({ id: 'stayCourse', label: 'Stay the course', hint: 'No speech — trust the first-half plan.' })

  const auto = ctx?.auto === 'staff' ? bestFit(fits, !!star) : null
  const core = coreOf(world, teamId)
  const problems = core.filter((p) => problemScore(p) >= PROBLEM_MIN).length
  const hot = sit.hotCount
  const starText = star ? ` Star: ${star.name} (${star.note}).` : ''
  const owner = opts.ownerNote ? ` ${opts.ownerNote}` : ''
  const staffRead = `Room: ${core.length} core, ${hot} hot, ${problems} problem${problems === 1 ? '' : 's'}.${starText}${owner}`

  return { options, defaultId: auto ?? 'stayCourse', staffRead, starId: star?.id, fits }
}

// ── second-half edge application + aftermath ─────────────────────────────────

/** The structural environment `withSpeech` needs (playsim's `SimEnv` fits). */
export interface SpeechEnv {
  qtr?: number
  speech?: Record<string, { off: number; def: number }>
}

/**
 * Fold a club's speech edge into its coaching effect, Q3+ only. Returns the
 * effect unchanged when there is no speech, the quarter is before the break, or
 * the speech had no edge — so the default path is exactly the old value.
 */
export function withSpeech<T extends { offEdge: number; defEdge: number }>(eff: T, env: SpeechEnv | undefined, teamId: string): T {
  if (!env || (env.qtr ?? 0) < 3) return eff
  const sp = env.speech?.[teamId]
  if (!sp || (sp.off === 0 && sp.def === 0)) return eff
  return { ...eff, offEdge: eff.offEdge + sp.off * SPEECH.gain, defEdge: eff.defEdge + sp.def * SPEECH.gain }
}

/** A club's second-half point differential (its 2H points minus the opponent's). */
export function secondHalfDiff(plays: Play[], homeId: string, teamId: string): number {
  const last = plays[plays.length - 1]
  if (!last) return 0
  const first2 = plays.find((p) => p.qtr >= 3)
  const h1Home = first2 ? first2.homeScore : 0
  const h1Away = first2 ? first2.awayScore : 0
  const homeHalf = last.homeScore - h1Home
  const awayHalf = last.awayScore - h1Away
  return teamId === homeId ? homeHalf - awayHalf : awayHalf - homeHalf
}

/** The post-game film line for a speech (landed + won the 2H → +1; backfired → −1). */
export function speechFilmLine(
  out: { id: SpeechId; result: SpeechResult; starId?: string } | undefined,
  plays: Play[],
  homeId: string,
  teamId: string,
): { delta: number; line: string } | null {
  if (!out || out.id === 'stayCourse') return null
  if (out.result === 'backfired') return { delta: -1, line: 'Halftime speech: it backfired (−1.0)' }
  if (out.result === 'landed' && secondHalfDiff(plays, homeId, teamId) > 0) {
    return { delta: 1, line: 'Halftime speech: the room answered, second half won (+1.0)' }
  }
  return null
}

/** The post-game morale deltas for a speech (H2 applies them to the roster). */
export function speechAftermath(world: World, out: SpeechOutcome, won: boolean, plays?: Play[]): SpeechAftermath {
  const deltas: { id: string; delta: number }[] = []
  if (out.id === 'stayCourse' || out.result === 'flat') return { deltas, line: out.line }
  const base = out.result === 'landed' ? 2 + (won ? 1 : 0) : -2
  for (const p of coreOf(world, out.teamId)) deltas.push({ id: p.id, delta: base })
  let line = out.line
  if (out.id === 'challenge' && out.starId) {
    const star = world.players.find((p) => p.id === out.starId)
    if (star) {
      const problem = problemScore(star) >= PROBLEM_MIN
      const delta = out.result === 'landed' ? 5 : problem ? -8 : -6
      deltas.push({ id: star.id, delta })
      if (out.result === 'landed' && plays) {
        const stat = starSecondHalfStat(star.pos, star.id, plays)
        if (stat) line = `Halftime: you challenged ${star.name} — he answered: ${stat}.`
      }
    }
  }
  return { deltas, line }
}

/** A short "what he did after the break" line for a challenged star. */
function starSecondHalfStat(pos: Position, id: string, plays: Play[]): string | null {
  let tackles = 0
  let sacks = 0
  let catches = 0
  let recYds = 0
  let rushYds = 0
  for (const p of plays) {
    if (p.qtr < 3) continue
    if (p.tackleIds?.includes(id)) tackles += 1
    if (p.sackId === id) sacks += 1
    if (p.targetId === id && p.reception) {
      catches += 1
      recYds += Math.max(0, p.yards)
    }
    if (p.carrierId === id && p.type === 'run') rushYds += Math.max(0, p.yards)
  }
  if (pos === 'WR' || pos === 'TE') return catches ? `${catches} catches for ${recYds} yards after the break` : null
  if (pos === 'RB') return rushYds ? `${rushYds} yards after the break` : null
  if (sacks) return `${sacks} sack${sacks === 1 ? '' : 's'} after the break`
  return tackles ? `${tackles} tackles after the break` : null
}

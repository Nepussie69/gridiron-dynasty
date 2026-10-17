// ─────────────────────────────────────────────────────────────────────────────
// The Draft Room (FUTURES #27, DF1 — engine + state).
//
// The draft used to be one grade plus a flat need bonus. Now the club's board is
// weighted by a room of people with stances: the scouting director, the personnel
// director, the AGM, the GM, the head coach and one coordinator. Each holds a
// five-axis draft philosophy (board / scheme fit / trade-down / traits-vs-
// production / character risk), they argue, and the blended stance tilts YOUR
// club's picks — a GM decides, an assistant director only gets heard.
//
// Two hard rules keep this honest:
//   • no truth leakage — stances read publicly visible fields only (grades,
//     ratings, traits, and the noisy makeup reads the club has uncovered), never
//     the hidden truth grade and never the hidden makeup object;
//   • no world-RNG draws — every opinion comes from `hash32`, so a save reloads
//     the same room and calibration is untouched. An all-default vector adds
//     exactly 0 to every score, so the old path stays byte-identical.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, DraftProspect, Player, Position, StaffMember } from '../types'
import type { World } from './generate'
import { generalManager, gmTemperament } from './generate'
import { gmArchetype } from './gmStyle'
import { clamp, hash32 } from './rng'
import { schemeFit } from './style'
import { mentorFor } from './people'
import { roleTitle } from './career'
import { adviceWeight } from './draft'

// ── Philosophy ───────────────────────────────────────────────────────────────

export const PHILOSOPHY_AXES = ['board', 'schemeFit', 'tradeDown', 'traitsProduction', 'characterRisk'] as const
export type PhilosophyAxis = (typeof PHILOSOPHY_AXES)[number]

/** The five axes. On every axis the MIDDLE step is today's sim behaviour. */
export interface DraftPhilosophy {
  board: 'BPA' | 'Balanced' | 'Need'
  schemeFit: 'Ignore' | 'Light' | 'Heavy'
  tradeDown: 'Stand pat' | 'Open' | 'Accumulate'
  traitsProduction: 'Traits' | 'Neutral' | 'Production'
  characterRisk: 'Avoid' | 'Neutral' | 'Gamble'
}

export type PhilosophyStep = DraftPhilosophy[PhilosophyAxis]

/** The three steps per axis, worst→best of the axis's own scale (0,1,2). */
export const PHILOSOPHY_STEPS: Record<PhilosophyAxis, readonly [PhilosophyStep, PhilosophyStep, PhilosophyStep]> = {
  board: ['BPA', 'Balanced', 'Need'],
  schemeFit: ['Ignore', 'Light', 'Heavy'],
  tradeDown: ['Stand pat', 'Open', 'Accumulate'],
  traitsProduction: ['Traits', 'Neutral', 'Production'],
  characterRisk: ['Avoid', 'Neutral', 'Gamble'],
}

export const PHILOSOPHY_AXIS_LABEL: Record<PhilosophyAxis, string> = {
  board: 'Board',
  schemeFit: 'Scheme fit',
  tradeDown: 'Trade-down volume',
  traitsProduction: 'Traits vs production',
  characterRisk: 'Character risk',
}

/** The one-line hint per step, for the philosophy card. */
export const PHILOSOPHY_STEP_HINT: Record<PhilosophyAxis, [string, string, string]> = {
  board: ['Take the best player, holes be damned.', 'Weigh talent against need.', 'Fill the roster holes first.'],
  schemeFit: ['Talent over system.', 'A tiebreaker at most.', 'Only take players who fit our system.'],
  tradeDown: ['Stay put and pick.', 'Listen to offers.', 'Move back and collect picks.'],
  traitsProduction: ['Bet on the ceiling.', 'Grade the tape and the traits evenly.', 'Bet on what he already did.'],
  characterRisk: ['Pass on the risky ones.', 'Take the talent as it comes.', 'Swallow the risk for the talent.'],
}

/** The default vector — the middle step everywhere, i.e. exactly today's sim. */
export const DEFAULT_PHILOSOPHY: DraftPhilosophy = {
  board: 'Balanced',
  schemeFit: 'Light',
  tradeDown: 'Open',
  traitsProduction: 'Neutral',
  characterRisk: 'Neutral',
}

const DEFAULT_INDEX = 1

function stepIndex(axis: PhilosophyAxis, step: PhilosophyStep): number {
  const i = PHILOSOPHY_STEPS[axis].indexOf(step)
  return i < 0 ? DEFAULT_INDEX : i
}

function stepAt(axis: PhilosophyAxis, index: number): PhilosophyStep {
  return PHILOSOPHY_STEPS[axis][clamp(Math.round(index), 0, 2)]
}

/** A copy of a vector with one axis changed (the caller validates the step). */
export function withAxis(v: DraftPhilosophy, axis: PhilosophyAxis, step: PhilosophyStep): DraftPhilosophy {
  const out = { ...v } as Record<PhilosophyAxis, PhilosophyStep>
  out[axis] = step
  return out as unknown as DraftPhilosophy
}

/** A vector normalised to step indices, for blending. */
export function vectorToIndices(v: DraftPhilosophy): Record<PhilosophyAxis, number> {
  const out = {} as Record<PhilosophyAxis, number>
  for (const axis of PHILOSOPHY_AXES) out[axis] = stepIndex(axis, v[axis])
  return out
}

export function indicesToVector(i: Record<PhilosophyAxis, number>): DraftPhilosophy {
  const out = {} as Record<PhilosophyAxis, PhilosophyStep>
  for (const axis of PHILOSOPHY_AXES) out[axis] = stepAt(axis, i[axis])
  return out as unknown as DraftPhilosophy
}

/** The axes where a seat differs from the sim default, for chips and hints. */
export function stanceAxes(v: DraftPhilosophy): { axis: PhilosophyAxis; step: PhilosophyStep }[] {
  return PHILOSOPHY_AXES.filter((axis) => v[axis] !== DEFAULT_PHILOSOPHY[axis]).map((axis) => ({
    axis,
    step: v[axis],
  }))
}

// ── The score tilt ───────────────────────────────────────────────────────────

const NEED_TARGETS: Record<string, number> = {
  QB: 3, RB: 3, WR: 6, TE: 3, OT: 4, OG: 4, C: 2, DE: 4, DT: 4, LB: 6, CB: 6, S: 4, K: 1, P: 1,
}

/** Roster holes by position (same targets the sim's need bonus uses). */
export function teamNeeds(roster: Player[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const p of roster) counts[p.pos] = (counts[p.pos] ?? 0) + 1
  const needs: Record<string, number> = {}
  for (const pos of Object.keys(NEED_TARGETS)) needs[pos] = Math.max(0, (NEED_TARGETS[pos] ?? 0) - (counts[pos] ?? 0))
  return needs
}

/** The overall need bonus per Board step (Balanced === the existing flat 6). */
export const BOARD_NEED_BONUS: Record<DraftPhilosophy['board'], number> = { BPA: 2, Balanced: 6, Need: 11 }

const POS_PREMIUM = new Set<Position>(['QB', 'DE', 'OT', 'CB'])

export interface TiltContext {
  needs: Record<string, number>
  /** Class mean of (ceiling − current), the traits-vs-production baseline. */
  classMean: number
  schemes: { off?: string; def?: string }
}

export function tiltContext(world: World, teamId: string): TiltContext {
  const staff = world.staff[teamId] ?? []
  let sum = 0
  for (const p of world.draft) sum += p.pot - p.ovr
  return {
    needs: teamNeeds(world.roster[teamId] ?? []),
    classMean: world.draft.length ? sum / world.draft.length : 0,
    schemes: {
      off: staff.find((s) => s.role === 'Offensive Coordinator')?.scheme,
      def: staff.find((s) => s.role === 'Defensive Coordinator')?.scheme,
    },
  }
}

export function sideOf(pos: Position): 'OFF' | 'DEF' | 'ST' {
  if (['QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'OG', 'C'].includes(pos)) return 'OFF'
  if (['K', 'P'].includes(pos)) return 'ST'
  return 'DEF'
}

/** The scheme the club would ask a prospect on this side to play in. */
export function schemeForSide(ctx: TiltContext, pos: Position): string | undefined {
  const side = sideOf(pos)
  if (side === 'DEF') return ctx.schemes.def
  if (side === 'OFF') return ctx.schemes.off
  return undefined
}

/**
 * The philosophy's score effect for one prospect: the sum of the five axis
 * deltas, clamped to ±12 so an elite talent cannot slide off a board.
 * An all-default vector is exactly 0 on every prospect.
 */
export function philosophyDelta(p: DraftProspect, v: DraftPhilosophy, ctx: TiltContext): number {
  let delta = 0

  // Board: the need bonus relative to today's flat 6 (only when there is a hole).
  if ((ctx.needs[p.pos] ?? 0) > 0) delta += BOARD_NEED_BONUS[v.board] - BOARD_NEED_BONUS.Balanced

  // Scheme fit: only the Heavy step pays, and only for a perfect fit.
  if (v.schemeFit === 'Heavy') {
    const scheme = schemeForSide(ctx, p.pos)
    if (scheme && schemeFit({ traits: p.traits }, scheme, sideOf(p.pos) === 'DEF' ? 'DEF' : 'OFF') >= 0.95) delta += 3
  }

  // Traits vs production: the ceiling bet vs the tape bet.
  if (v.traitsProduction === 'Traits') {
    delta += clamp((p.pot - p.ovr - ctx.classMean) / 3, -4, 4)
  } else if (v.traitsProduction === 'Production') {
    delta += clamp((p.production - 62) / 9, -4, 4)
  }

  // Character risk: only what the club has actually uncovered is allowed to count.
  const reads = p.characterReads ?? []
  const riskRead = reads.some((r) => r.facet === 'offFieldRisk' && (r.label === 'Elevated' || r.label === 'High'))
  const redFacet = reads.some((r) => r.label === 'Red flag')
  if (v.characterRisk === 'Avoid') {
    if (riskRead) delta -= 6
    if (redFacet) delta -= 3
  } else if (v.characterRisk === 'Gamble') {
    if (riskRead || redFacet) delta += 2
  }

  return clamp(delta, -12, 12)
}

/** The fully-scored board value a seat would use for one prospect. */
export function seatScore(
  p: DraftProspect,
  v: DraftPhilosophy,
  ctx: TiltContext,
  gradeOf: (p: DraftProspect) => number,
): number {
  const need = (ctx.needs[p.pos] ?? 0) > 0 ? BOARD_NEED_BONUS.Balanced : 0
  const premium = POS_PREMIUM.has(p.pos) ? 2 : 0
  return gradeOf(p) + need + premium + philosophyDelta(p, v, ctx)
}

// ── Seats ────────────────────────────────────────────────────────────────────

export const SEAT_ORDER = ['scouting', 'personnel', 'agm', 'gm', 'hc', 'coord'] as const
export type SeatKey = (typeof SEAT_ORDER)[number]

/** The pen holder's fixed share of the room (the GM, unless you are the GM). */
export const PEN_WEIGHT = 0.45

/** Relative shares of what is left after the pen and your own seat. */
const SEAT_SHARE: Record<SeatKey, number> = { scouting: 5, personnel: 4, agm: 3, hc: 3, coord: 2, gm: 0 }

export const SEAT_TITLE: Record<SeatKey, string> = {
  scouting: 'Director of College Scouting',
  personnel: 'Director of Player Personnel',
  agm: 'Assistant General Manager',
  gm: 'General Manager',
  hc: 'Head Coach',
  coord: 'Coordinator',
}

const SEAT_SHORT: Record<SeatKey, string> = {
  scouting: 'Scouting Director',
  personnel: 'Personnel Director',
  agm: 'AGM',
  gm: 'GM',
  hc: 'Head Coach',
  coord: 'Coordinator',
}

/**
 * The names this room invents must never collide with a voices.ts person. The
 * hash-named NPCs are drawn from their own pool, disjoint from names.ts FIRST/
 * LAST and from voices.ts RIVAL_FIRST/RIVAL_LAST.
 */
const NPC_FIRST = ['Wendell', 'Ozzie', 'Thurl', 'Amos', 'Roscoe', 'Ezra', 'Hiram', 'Cyrus', 'Lonnie', 'Vernon']
const NPC_LAST = ['Bracewell', 'Tumulty', 'Aldercroft', 'Blackwood', 'Carrick', 'Dunmore', 'Elsberry', 'Fenwick', 'Grissom', 'Halloway']

function npcName(seed: string, salt: number): string {
  return `${NPC_FIRST[hash32(seed, salt) % NPC_FIRST.length]} ${NPC_LAST[hash32(seed, salt + 1) % NPC_LAST.length]}`
}

export interface RoomSeat {
  key: SeatKey
  title: string
  short: string
  name: string
  /** Staff id when the seat is a real staff member, else the synthesis key. */
  id: string
  isUser: boolean
  holdsPen: boolean
  weight: number
  vector: DraftPhilosophy
}

/** Which seat the user's own rung puts them in (null = they are not in the room). */
export function userSeatKey(career: CareerState): SeatKey | null {
  if (career.path === 'personnel') {
    if (career.level >= 8) return 'gm'
    if (career.level === 7) return 'agm'
    if (career.level === 6) return 'personnel'
    if (career.level >= 4) return 'scouting'
    return null
  }
  if (career.level >= 7) return 'hc'
  if (career.level === 6) return 'coord'
  return null
}

/**
 * The user's seat weight, scaled by how much the building already trusts their
 * eye (`adviceWeight`). Personnel L4 0.10–0.20 rising to L7 co-pen 0.45; the GM
 * at L8 owns every click. A coach coordinator gets 0.10 (own side only); an NFL
 * head coach 0.35.
 */
export function userDraftWeight(career: CareerState): number {
  const seat = userSeatKey(career)
  if (!seat) return 0
  const aw = adviceWeight(career)
  if (career.path === 'personnel') {
    if (career.level >= 8) return 1
    if (career.level === 7) return 0.45
    if (career.level === 6) return 0.3 + 0.1 * aw
    if (career.level === 5) return 0.2 + 0.1 * aw
    return 0.1 + 0.1 * aw
  }
  if (career.level >= 7) return 0.35
  return 0.1
}

/** Authority per seat, summing to 1. The pen holds 0.45 unless you are the pen. */
export function seatWeights(career: CareerState, world?: World): Record<SeatKey, number> {
  const out: Record<SeatKey, number> = { scouting: 0, personnel: 0, agm: 0, gm: 0, hc: 0, coord: 0 }
  const seat = userSeatKey(career)
  if (seat === 'gm') {
    out.gm = 1
    return out
  }
  // gmpersona: the pen's authority is HIS own. A sharp GM commands a little more
  // of the room than a thin one (±15% of the pen share, from his rating alone);
  // the rest of the building still splits by seat share. No AI club reads this.
  const gm = world ? generalManager(world, career.teamId) : undefined
  const penWeight = gm
    ? PEN_WEIGHT * (0.85 + ((clamp(gm.rating, 52, 92) - 52) / 40) * 0.3)
    : PEN_WEIGHT
  out.gm = penWeight
  const wUser = seat ? clamp(userDraftWeight(career), 0, 1 - penWeight) : 0
  if (seat) out[seat] = wUser
  let rest = Math.max(0, 1 - penWeight - wUser)
  const others = SEAT_ORDER.filter((k) => k !== seat && k !== 'gm')
  const total = others.reduce((s, k) => s + SEAT_SHARE[k], 0)
  for (let i = 0; i < others.length; i++) {
    const k = others[i]
    const share = i === others.length - 1 ? rest : +((rest * SEAT_SHARE[k]) / total).toFixed(6)
    out[k] = share
    rest -= share
  }
  return out
}

/** Who has the biggest hole: the offense or the defense? */
function biggestNeedSide(world: World, teamId: string): 'off' | 'def' {
  const needs = teamNeeds(world.roster[teamId] ?? [])
  let off = 0
  let def = 0
  for (const [pos, n] of Object.entries(needs)) {
    if (sideOf(pos as Position) === 'OFF') off += n
    else if (sideOf(pos as Position) === 'DEF') def += n
  }
  return def > off ? 'def' : 'off'
}

function topScout(staff: StaffMember[]): StaffMember | undefined {
  return staff
    .filter((s) => s.role === 'Scout')
    .sort((a, b) => b.rating - a.rating || (a.id < b.id ? -1 : 1))[0]
}

/** One axis' opinion straight from a person's hash, 60% toward the default. */
function hashedStep(id: string, axisIndex: number): PhilosophyStep {
  const axis = PHILOSOPHY_AXES[axisIndex]
  const h = hash32(`${id}|axis${axisIndex}`, 1013)
  if (h % 10 < 6) return DEFAULT_PHILOSOPHY[axis]
  // Off-default steps: the two extremes, chosen deterministically.
  return PHILOSOPHY_STEPS[axis][(h >>> 4) % 2 ? 0 : 2]
}

/**
 * A seat's stance: what THIS person believes, from his own focus, scouting bias,
 * mentor philosophy and scheme — then the remaining axes from his own hash.
 */
function npcVector(world: World, teamId: string, seat: SeatKey, member?: StaffMember): DraftPhilosophy {
  const v = { ...DEFAULT_PHILOSOPHY } as Record<PhilosophyAxis, PhilosophyStep>
  if (seat === 'scouting') {
    // Character men pass on risk; production men bet on the tape; speed/size men
    // bet on the traits.
    if (member?.focus === 'Character') v.characterRisk = 'Avoid'
    if (member?.bias?.axis === 'production') v.traitsProduction = 'Production'
    else if (member?.bias?.axis === 'speed' || member?.bias?.axis === 'size') v.traitsProduction = 'Traits'
  } else if (seat === 'personnel' || seat === 'gm') {
    // Cap and analytics men hoard picks and take the best player; negotiators listen.
    if (member?.focus === 'Cap' || member?.focus === 'Analytics') {
      v.tradeDown = 'Accumulate'
      v.board = 'BPA'
    } else if (member?.focus === 'Negotiation') {
      v.tradeDown = 'Open'
    }
    // The GM's stance is HIS: a sharp evaluator backs his own board (BPA), a thin
    // one leans on need; a bold trader works the phones, a cautious one stays put.
    // Individual — his own temperament from his own id + rating, never a mean.
    // FUTURES #49: and it is his ARCHETYPE that frames it, so an Analytics GM
    // hoards picks and takes the best player, while Draft & develop does the same
    // from the other end of the board.
    if (seat === 'gm') {
      const t = gmTemperament(member)
      const arch = gmArchetype(member)
      if (t.drafting >= 70) v.board = 'BPA'
      else if (t.drafting <= 55) v.board = 'Need'
      if (t.trading >= 70) v.tradeDown = 'Open'
      else if (t.trading <= 45) v.tradeDown = 'Stand pat'
      if (arch === 'analytics' || arch === 'draftdev') v.tradeDown = 'Accumulate'
      else if (arch === 'tradehappy' || arch === 'capreckless') v.tradeDown = 'Open'
      else if (arch === 'oldschool') v.tradeDown = 'Stand pat'
    }
  } else if (seat === 'hc') {
    const philosophy = mentorFor(world, teamId).philosophy
    if (philosophy === 'tape') v.traitsProduction = 'Production'
    else if (philosophy === 'measurables') v.traitsProduction = 'Traits'
    else if (philosophy === 'character') v.characterRisk = 'Avoid'
    else if (philosophy === 'analytics') v.board = 'BPA'
    v.schemeFit = 'Heavy'
  } else if (seat === 'coord') {
    v.board = 'Need'
    v.schemeFit = 'Heavy'
  }
  const id = member?.id ?? `${seat}_${teamId}`
  for (let i = 0; i < PHILOSOPHY_AXES.length; i++) {
    const axis = PHILOSOPHY_AXES[i]
    if (v[axis] !== DEFAULT_PHILOSOPHY[axis]) continue // an explicit stance stands
    v[axis] = hashedStep(id, i)
  }
  return v as unknown as DraftPhilosophy
}

/** The user's own vector, or the default when they have not set one. */
function userVector(world: World, career: CareerState): DraftPhilosophy {
  const set = career.draftPhilosophy
  if (!set || set.season !== world.season) return { ...DEFAULT_PHILOSOPHY }
  const v = { ...DEFAULT_PHILOSOPHY } as Record<PhilosophyAxis, PhilosophyStep>
  for (const axis of PHILOSOPHY_AXES) if (set[axis]) v[axis] = set[axis]
  return v as unknown as DraftPhilosophy
}

/**
 * The room: 4–6 seats, one of which may be yours. Each seat carries its own
 * philosophy (specific people, not team averages) and its authority.
 */
export function roomSeats(world: World, career: CareerState): RoomSeat[] {
  const teamId = career.teamId
  const staff = world.staff[teamId] ?? []
  const weights = seatWeights(career, world)
  const userSeat = userSeatKey(career)
  // The coordinator seat is the one whose side has the biggest hole — unless the
  // user IS the coordinator, in which case it is his own side.
  const side: 'off' | 'def' =
    userSeat === 'coord'
      ? career.unitFocus === 'def'
        ? 'def'
        : 'off'
      : biggestNeedSide(world, teamId)
  const coordRole = side === 'def' ? 'Defensive Coordinator' : 'Offensive Coordinator'
  const sources: Record<SeatKey, StaffMember | undefined> = {
    scouting: topScout(staff),
    personnel: staff.find((s) => s.role === 'Director of Player Personnel'),
    agm: undefined,
    gm: staff.find((s) => s.role === 'General Manager'),
    hc: staff.find((s) => s.role === 'Head Coach'),
    coord: staff.find((s) => s.role === coordRole),
  }
  const seats: RoomSeat[] = []
  for (const key of SEAT_ORDER) {
    const isUser = userSeat === key
    const member = isUser ? undefined : sources[key]
    // A seat with no person and no user is not a seat (the AGM and a missing GM
    // are synthesised below).
    if (!isUser && !member && key !== 'agm' && key !== 'gm') continue
    const id = member?.id ?? (isUser ? 'you' : `${key}_${teamId}`)
    const title =
      isUser && career.path === 'personnel' && (key === 'scouting' || key === 'personnel')
        ? userTitle(career)
        : key === 'coord'
          ? SEAT_TITLE.coord + (side === 'def' ? ' (DC)' : ' (OC)')
          : SEAT_TITLE[key]
    seats.push({
      key,
      title,
      short: isUser && key === 'scouting' ? 'your board' : SEAT_SHORT[key],
      // The AGM and a club without a GM are hash-named NPCs with their own salt.
      name: isUser ? career.gmName : member?.name ?? npcName(`${teamId}|${key}`, key === 'agm' ? 143 : 151),
      id,
      isUser,
      holdsPen: key === 'gm',
      weight: weights[key],
      vector: isUser ? userVector(world, career) : npcVector(world, teamId, key, member),
    })
  }
  return seats
}

function userTitle(career: CareerState): string {
  return roleTitle(career)
}

// ── Blending ─────────────────────────────────────────────────────────────────

export interface BlendOptions {
  /** Auto/clock picks for a GM user: your vector 0.7 + the room 0.3. */
  auto?: boolean
  /** The prospect in question, so a coordinator's vote only counts for his side. */
  prospect?: DraftProspect
}

/** Can this seat vote on this prospect? A coordinator only votes for his side. */
function seatVotes(seat: RoomSeat, career: CareerState, p?: DraftProspect): boolean {
  if (seat.isUser && seat.key === 'coord' && p) {
    const side = career.unitFocus === 'def' ? 'DEF' : career.unitFocus === 'both' ? undefined : 'OFF'
    if (side && sideOf(p.pos) !== side) return false
  }
  return true
}

/**
 * The blended stance, a weighted mean per axis rounded back to a step. With the
 * user holding the pen it is their vector, except on an auto pick where the room
 * keeps a 0.3 say.
 */
export function blendedVector(world: World, career: CareerState, opts: BlendOptions = {}): DraftPhilosophy {
  const seats = roomSeats(world, career).filter((s) => seatVotes(s, career, opts.prospect))
  const userSeat = seats.find((s) => s.isUser)
  const weights = seats.map((s) => s.weight)
  if (opts.auto && userSeat?.holdsPen) {
    // Your clicks are yours; an auto pick still listens to the building.
    const others = seats.filter((s) => !s.isUser)
    const total = others.reduce((sum, s) => sum + s.weight, 0)
    const idx = vectorToIndices(userSeat.vector)
    for (const axis of PHILOSOPHY_AXES) {
      const room = total > 0 ? others.reduce((sum, s) => sum + vectorToIndices(s.vector)[axis] * s.weight, 0) / total : 1
      idx[axis] = 0.7 * idx[axis] + 0.3 * room
    }
    return indicesToVector(idx)
  }
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return { ...DEFAULT_PHILOSOPHY }
  const indices = {} as Record<PhilosophyAxis, number>
  for (const axis of PHILOSOPHY_AXES) {
    let sum = 0
    for (let i = 0; i < seats.length; i++) sum += vectorToIndices(seats[i].vector)[axis] * weights[i]
    indices[axis] = sum / total
  }
  return indicesToVector(indices)
}

/** Is the room's tilt live this draft? Only once you have set it this season. */
export function draftPhilosophyActive(world: World, career: CareerState | null | undefined): boolean {
  if (!career) return false
  const set = career.draftPhilosophy
  return !!set && set.season === world.season
}

/** The tilt hook `bestAvailableFor` takes: the blended delta for one prospect. */
export function roomTilt(
  world: World,
  career: CareerState | null | undefined,
  opts: BlendOptions = {},
): ((p: DraftProspect) => number) | undefined {
  if (!career || !draftPhilosophyActive(world, career)) return undefined
  const ctx = tiltContext(world, career.teamId)
  return (p: DraftProspect) => philosophyDelta(p, blendedVector(world, career, { ...opts, prospect: p }), ctx)
}

// ── The argument ─────────────────────────────────────────────────────────────

export interface RoomArgument {
  seat: SeatKey
  title: string
  short: string
  name: string
  isUser: boolean
  holdsPen: boolean
  weight: number
  prospectId: string
  prospectName: string
  pos: Position
  /** The seat's own board value for his guy. */
  score: number
  grade: number
  reason: string
  /** True when the seat is backing him for the reason the sim already valued. */
  consensus: boolean
}

/** One line explaining the axis that moved this prospect most for this seat. */
function argueReason(p: DraftProspect, v: DraftPhilosophy, ctx: TiltContext, grade: number): string {
  const moves: { d: number; text: string }[] = []
  if ((ctx.needs[p.pos] ?? 0) > 0 && v.board !== 'Balanced') {
    moves.push({
      d: Math.abs(BOARD_NEED_BONUS[v.board] - BOARD_NEED_BONUS.Balanced),
      text: v.board === 'Need' ? `We have a hole at ${p.pos}.` : 'Best player on the board — take the talent.',
    })
  }
  if (v.schemeFit === 'Heavy') {
    const scheme = schemeForSide(ctx, p.pos)
    if (scheme && schemeFit({ traits: p.traits }, scheme, sideOf(p.pos) === 'DEF' ? 'DEF' : 'OFF') >= 0.95) {
      moves.push({ d: 3, text: `He fits the ${scheme}.` })
    }
  }
  if (v.traitsProduction !== 'Neutral') {
    moves.push({
      d: Math.abs(
        v.traitsProduction === 'Traits'
          ? clamp((p.pot - p.ovr - ctx.classMean) / 3, -4, 4)
          : clamp((p.production - 62) / 9, -4, 4),
      ),
      text: v.traitsProduction === 'Traits' ? 'The traits are the bet.' : 'The production is the bet.',
    })
  }
  if (v.characterRisk !== 'Neutral') {
    const risky = (p.characterReads ?? []).some((r) => r.label === 'Red flag' || r.label === 'Elevated' || r.label === 'High')
    if (risky) {
      moves.push({
        d: v.characterRisk === 'Avoid' ? 6 : 2,
        text: v.characterRisk === 'Avoid' ? 'The makeup read worries me.' : 'The talent is worth the risk.',
      })
    }
  }
  moves.sort((a, b) => b.d - a.d)
  return moves[0]?.text ?? `Best grade left on our board (${grade}).`
}

/**
 * The room's argument on the current board: each seat's top guy, why, and
 * whether they agree. `k` caps how many seats speak (the loudest first).
 */
export function roomArgument(world: World, career: CareerState, k = 3): RoomArgument[] {
  const available = world.draft.filter((p) => !p.draftedBy)
  if (!available.length) return []
  const ctx = tiltContext(world, career.teamId)
  const gradeOf = (p: DraftProspect) => p.grade
  const seats = roomSeats(world, career)
    .slice()
    .sort((a, b) => b.weight - a.weight || SEAT_ORDER.indexOf(a.key) - SEAT_ORDER.indexOf(b.key))
    .slice(0, k)
  const picks = seats.map((seat) => {
    let best: DraftProspect | null = null
    let bestScore = -Infinity
    for (const p of available) {
      const score = seatScore(p, seat.vector, ctx, gradeOf)
      if (score > bestScore) {
        bestScore = score
        best = p
      }
    }
    return { seat, p: best as DraftProspect, score: bestScore }
  })
  const consensus = picks.length > 0 && picks.every((x) => x.p.id === picks[0].p.id)
  return picks.map(({ seat, p, score }) => ({
    seat: seat.key,
    title: seat.title,
    short: seat.short,
    name: seat.name,
    isUser: seat.isUser,
    holdsPen: seat.holdsPen,
    weight: seat.weight,
    prospectId: p.id,
    prospectName: p.name,
    pos: p.pos,
    score: Math.round(score * 10) / 10,
    grade: gradeOf(p),
    reason: argueReason(p, seat.vector, ctx, gradeOf(p)),
    consensus,
  }))
}

/** The seat whose guy actually went — used for the post-pick ledger note. */
export function roomWinner(world: World, career: CareerState, prospectId: string): RoomArgument | null {
  const args = roomArgument(world, career, SEAT_ORDER.length)
  const won = args.filter((a) => a.prospectId === prospectId).sort((a, b) => b.weight - a.weight)
  return won[0] ?? null
}

/** One line naming who won the room, for the ledger. */
export function roomNote(winner: RoomArgument | null): string {
  if (!winner) return 'The room split — the pen took the top grade on the board.'
  if (winner.isUser) return 'Your call won the room.'
  return `The ${winner.short}'s call won the room.`
}

// ── Trade-down volume (DF2) ──────────────────────────────────────────────────
//
// The trade-down axis is the room's appetite to move off the clock: Stand pat
// listens to a couple of calls, Open works the phones, Accumulate both shows the
// most offers AND will actually take one when the board does not fall away. The
// seats behind that appetite are specific people with their own authority, so a
// Cap-minded GM and a Need-minded coordinator do not average into a shrug.

/** How many trade-down offers the room shows 2 / 4 / 6 per trade-down step. */
export const TRADE_DOWN_OFFER_LIMIT: Record<DraftPhilosophy['tradeDown'], number> = {
  'Stand pat': 2,
  Open: 4,
  Accumulate: 6,
}

/** Deterministic uniform in [0,1) from a string key (a hash, never a world draw). */
function h01(key: string): number {
  return (hash32(key, 2053) >>> 0) / 4294967296
}

/**
 * The room's trade-down volume for the pick on the clock. Below the pen the blend
 * is the weighted mean of the seats; with the philosophy unset this is today's
 * 4-offer default, so nothing moves for an old save.
 */
export function tradeDownOfferLimit(world: World, career: CareerState | null | undefined): number {
  if (!career || !draftPhilosophyActive(world, career)) return TRADE_DOWN_OFFER_LIMIT[DEFAULT_PHILOSOPHY.tradeDown]
  return TRADE_DOWN_OFFER_LIMIT[blendedVector(world, career).tradeDown]
}

/** How hard one seat's step pushes toward actually taking a deal: only Accumulate bites. */
export function tradeDownWeight(step: PhilosophyStep): number {
  return step === 'Accumulate' ? 1 : 0
}

/** Is the room hoarding picks this draft? (Active philosophy + an Accumulate blend.) */
export function roomAccumulating(world: World, career: CareerState | null | undefined): boolean {
  if (!career || !draftPhilosophyActive(world, career)) return false
  return blendedVector(world, career).tradeDown === 'Accumulate'
}

/** The share of the room's authority that wants to move back (0 with the philosophy unset). */
export function blendedTradeWeight(world: World, career: CareerState | null | undefined): number {
  if (!career || !draftPhilosophyActive(world, career)) return 0
  const seats = roomSeats(world, career)
  const total = seats.reduce((s, x) => s + x.weight, 0)
  if (total <= 0) return 0
  return seats.reduce((s, x) => s + tradeDownWeight(x.vector.tradeDown) * x.weight, 0) / total
}

/** The highest-authority voice arguing for the move back, for the ledger line. */
export function tradeDownAdvocate(world: World, career: CareerState): RoomSeat | null {
  return (
    roomSeats(world, career)
      .filter((s) => tradeDownWeight(s.vector.tradeDown) > 0)
      .sort((a, b) => b.weight - a.weight || SEAT_ORDER.indexOf(a.key) - SEAT_ORDER.indexOf(b.key))[0] ?? null
  )
}

/**
 * Does the room take this qualifying deal? Deterministic: the authority behind
 * Accumulate sets the odds and `h01(seed, season, pickIndex)` makes the roll. No
 * world-RNG draw is added, so a reload is the same draft.
 */
export function roomTakesTradeDown(world: World, career: CareerState): boolean {
  const weight = blendedTradeWeight(world, career)
  if (weight <= 0) return false
  return h01(`dt:${world.seed}:${world.season}:${world.draftState.pickIndex}`) < weight
}

/** One line naming whose call moved the room off the clock, for the ledger. */
export function roomTradeNote(advocate: RoomSeat | null, partnerAbbr: string, returnText: string): string {
  const tail = `${partnerAbbr} sent ${returnText} for our pick.`
  if (!advocate) return `The room moved off the clock — ${tail}`
  if (advocate.isUser) return `Your call: we moved off the clock — ${tail}`
  return `The ${advocate.short}'s call: we moved off the clock — ${tail}`
}

/**
 * The room's own board, best first — scored exactly as `bestAvailableFor` scores
 * it under the tilt (grade + the flat 6 need bonus + the position premium + the
 * blended philosophy delta). Null when no philosophy is live this draft. Used by
 * the trade-down check to see what the board looks like three slots back.
 */
export function roomBoardScores(
  world: World,
  career: CareerState,
  gradeOf: (p: DraftProspect) => number,
  opts: BlendOptions = {},
): { p: DraftProspect; score: number }[] | null {
  const tilt = roomTilt(world, career, opts)
  if (!tilt) return null
  const ctx = tiltContext(world, career.teamId)
  return world.draft
    .filter((p) => !p.draftedBy)
    .map((p) => {
      const need = (ctx.needs[p.pos] ?? 0) > 0 ? BOARD_NEED_BONUS.Balanced : 0
      const premium = POS_PREMIUM.has(p.pos) ? 2 : 0
      return { p, score: gradeOf(p) + need + premium + tilt(p) }
    })
    .sort((a, b) => b.score - a.score || (a.p.id < b.p.id ? -1 : 1))
}

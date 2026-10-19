// ─────────────────────────────────────────────────────────────────────────────
// Draft-room UI data (FUTURES #27 DF3).
//
// Every number the philosophy card and the room view show, read straight off the
// DF1/DF2 engine — `roomSeats`, `roomArgument`, `blendedVector`,
// `tradeDownOfferLimit`, `blendedTradeWeight`, `seatWeights` and the club's own
// ledger. Nothing is re-derived here: the UI displays what the engine decided.
// Kept out of the .tsx files so they export components only (fast refresh).
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, Position } from '../game/types'
import type { World } from '../game/engine/generate'
import { generalManager } from '../game/engine/generate'
import {
  DEFAULT_PHILOSOPHY,
  PHILOSOPHY_AXES,
  PHILOSOPHY_AXIS_LABEL,
  PHILOSOPHY_STEPS,
  PHILOSOPHY_STEP_HINT,
  SEAT_ORDER,
  aiIdentityVector,
  blendedTradeWeight,
  blendedVector,
  boardVoices,
  draftPhilosophyActive,
  roomAccumulating,
  roomArgument,
  roomSeats,
  seatWeights,
  stanceAxes,
  tradeDownAdvocate,
  tradeDownOfferLimit,
  userSeatKey,
  type DraftPhilosophy,
  type PhilosophyAxis,
  type PhilosophyStep,
  type RoomArgument,
  type RoomSeat,
  type SeatKey,
} from '../game/engine/draftRoom'
import { canAdvise, canDecide } from '../game/engine/access'
import { currentTeamId, draftOpen } from '../game/engine/draft'
import { buildDraftTradeDownOffers } from '../game/engine/draftTrades'

// ── The philosophy card ──────────────────────────────────────────────────────

export interface StanceChip {
  axis: PhilosophyAxis
  /** The axis, short enough for a chip ("Board", "Scheme fit"). */
  label: string
  step: PhilosophyStep
}

/** The non-default axes on a seat's own vector — what THIS person believes. */
export function stanceChips(seat: RoomSeat): StanceChip[] {
  return stanceAxes(seat.vector).map((a) => ({ axis: a.axis, label: PHILOSOPHY_AXIS_LABEL[a.axis], step: a.step }))
}

export interface PhilosophyChoiceStep {
  step: PhilosophyStep
  hint: string
  selected: boolean
  /** The middle step — today's sim behaviour. */
  isDefault: boolean
}

export interface PhilosophyChoice {
  axis: PhilosophyAxis
  label: string
  steps: PhilosophyChoiceStep[]
}

export interface PhilosophyView {
  choices: PhilosophyChoice[]
  /** The gate the store action uses: canAdvise || canDecide on the draft. */
  canEdit: boolean
  /** Your own vector (the user seat's, else the engine default). */
  vector: DraftPhilosophy
  /** Your seat's authority as a whole percent (0 when you hold no seat). */
  voicePct: number
  /** The seat that holds the pen for this room. */
  penTitle: string
  /** Does that pen-holder seat belong to you? */
  penIsUser: boolean
  /** Are you in this room at all at your rung? */
  inRoom: boolean
  /** Is the vector live for the draft on the board (set this season)? */
  active: boolean
}

/**
 * Everything the philosophy card shows, read straight off the engine: the axis
 * list and steps from PHILOSOPHY_STEPS, the hints from PHILOSOPHY_STEP_HINT,
 * your own vector and authority from `roomSeats`.
 */
export function philosophyView(world: World, career: CareerState): PhilosophyView {
  const seats = roomSeats(world, career)
  const userSeat = seats.find((s) => s.isUser)
  const pen = seats.find((s) => s.holdsPen)
  const vector = userSeat ? userSeat.vector : { ...DEFAULT_PHILOSOPHY }
  const choices: PhilosophyChoice[] = PHILOSOPHY_AXES.map((axis) => ({
    axis,
    label: PHILOSOPHY_AXIS_LABEL[axis],
    steps: PHILOSOPHY_STEPS[axis].map((step, i) => ({
      step,
      hint: PHILOSOPHY_STEP_HINT[axis][i],
      selected: vector[axis] === step,
      isDefault: DEFAULT_PHILOSOPHY[axis] === step,
    })),
  }))
  return {
    choices,
    canEdit: canAdvise(career, 'draft') || canDecide(career, 'draft'),
    vector,
    voicePct: Math.round((userSeat?.weight ?? 0) * 100),
    penTitle: pen?.short ?? 'General Manager',
    penIsUser: !!pen?.isUser,
    inRoom: !!userSeatKey(career),
    active: draftPhilosophyActive(world, career),
  }
}

/** One plain sentence for the voice line, so the banner and the probe agree. */
export function voiceLine(view: PhilosophyView): string {
  if (!view.inRoom) return `Your rung is not in this room yet — the ${view.penTitle} makes the call.`
  if (view.penIsUser) return 'Your voice: 100% — you hold the pen.'
  if (view.voicePct <= 0) return `The ${view.penTitle} holds the pen — you are heard, not counted.`
  return `Your voice: ${view.voicePct}% — the ${view.penTitle} holds the pen.`
}

// ── The room ─────────────────────────────────────────────────────────────────

export interface RoomRow {
  seat: RoomSeat
  chips: StanceChip[]
  weightPct: number
  /** The seat's own guy, straight off `roomArgument`. */
  arg: RoomArgument | null
  /** How far the seat's own board value sits above the raw grade for his guy. */
  pull: number
}

export interface RoomView {
  rows: RoomRow[]
  active: boolean
  /** Every speaking seat backs the same prospect. */
  consensus: boolean
  /** How many distinct names the seats are pushing. */
  spread: number
  /** The loudest seat's guy. */
  leader: RoomArgument | null
  /** The pen holder's own row. */
  pen: RoomRow | null
  /** The blended trade-down step the room is working from. */
  tradeStep: DraftPhilosophy['tradeDown']
  /** How many offers the room listens to (2 / 4 / 6). */
  offerLimit: number
  /** How many offers are actually on the table at this slot (0 when not on the clock). */
  offersNow: number
  /** An Accumulate room will take a qualifying deal itself. */
  accumulating: boolean
  /** The share of the room's authority that wants to move back. */
  tradeWeightPct: number
  /** The loudest voice for moving back. */
  advocate: string | null
  /** The club's most recent room note this season, off its own ledger. */
  note: { name: string; note: string } | null
}

/**
 * The room's rows and its trade-down appetite: `roomArgument` keyed by seat, the
 * offer count from the engine's `tradeDownOfferLimit`, and the offers actually on
 * the table from the same `buildDraftTradeDownOffers` the trade panel uses (the
 * engine memoises that search per world/stamp, so one call per render is cheap).
 */
export function roomView(world: World, career: CareerState): RoomView {
  const seats = roomSeats(world, career)
  const args = roomArgument(world, career, SEAT_ORDER.length)
  const bySeat = new Map(args.map((a) => [a.seat, a]))
  const weights = seatWeights(career, world)
  const blended = blendedVector(world, career)
  const advocate = tradeDownAdvocate(world, career)
  const offerLimit = tradeDownOfferLimit(world, career)
  const onClock = draftOpen(world) && !world.draftState.complete && currentTeamId(world) === career.teamId

  // pushLedger stores the entry with the CAREER's season and prepends, so the
  // newest advice row for this draft sits at index 0.
  const advice = (career.ledger ?? []).filter((e) => e.kind === 'advice' && e.season === career.season)
  const last = advice[0]

  const rows: RoomRow[] = seats.map((seat) => {
    const arg = bySeat.get(seat.key) ?? null
    return {
      seat,
      chips: stanceChips(seat),
      // The bar shows the seat's own authority, read from the engine's own table.
      weightPct: Math.round((weights[seat.key] ?? seat.weight) * 100),
      arg,
      pull: arg ? Math.round((arg.score - arg.grade) * 10) / 10 : 0,
    }
  })

  const spread = new Set(args.map((a) => a.prospectId)).size
  return {
    rows,
    active: draftPhilosophyActive(world, career),
    consensus: args.length > 0 && spread === 1,
    spread,
    leader: args[0] ?? null,
    pen: rows.find((r) => r.seat.holdsPen) ?? null,
    tradeStep: blended.tradeDown,
    offerLimit,
    offersNow: onClock ? buildDraftTradeDownOffers(world, career.teamId, offerLimit).length : 0,
    accumulating: roomAccumulating(world, career),
    tradeWeightPct: Math.round(blendedTradeWeight(world, career) * 100),
    advocate: advocate ? (advocate.isUser ? 'you' : advocate.short) : null,
    note: last ? { name: last.name, note: last.note } : null,
  }
}

/** The one line that says whether the room is settled or split. */
export function consensusLine(view: RoomView): string {
  if (!view.leader) return 'The board is empty — the room has nothing to argue about.'
  if (view.consensus) return `The room is settled: everyone wants ${view.leader.prospectName}.`
  const pen = view.pen?.seat.short ?? 'GM'
  return `${view.spread} names on the table — the ${pen} breaks the tie.`
}

// ── The voices on the clock (DF4/DF1 — the arguing panel) ────────────────────

export interface VoiceLine {
  seat: SeatKey
  short: string
  title: string
  name: string
  isUser: boolean
  holdsPen: boolean
  weightPct: number
  prospectId: string
  prospectName: string
  pos: Position
  grade: number
  /** How far this seat's own stance lifts his guy above the raw grade. */
  pull: number
  reason: string
}

export interface VoicesView {
  lines: VoiceLine[]
  /** The room is settled on one name. */
  consensus: boolean
  /** How many distinct names the whole room is pushing. */
  spread: number
  /** The blended stance is live on the board this draft. */
  active: boolean
  /** The loudest voice's guy, for the header. */
  leader: string | null
  /** The line your own seat would say, if you hold one. */
  yourLine: string | null
}

/**
 * The room as it argues while the club is on the clock: the decision-makers
 * first (the pen, then you), each with his own guy, his own reason and his own
 * authority. Everything comes off `roomArgument` — the same call the pick uses.
 */
export function voicesView(world: World, career: CareerState, k = 3): VoicesView {
  const args = roomArgument(world, career, SEAT_ORDER.length)
  const order = (a: RoomArgument) => (a.holdsPen ? 0 : a.isUser ? 1 : 2)
  const ranked = args.slice().sort((a, b) => order(a) - order(b) || b.weight - a.weight)
  const lines: VoiceLine[] = ranked.slice(0, k).map((a) => ({
    seat: a.seat,
    short: a.short,
    title: a.title,
    name: a.name,
    isUser: a.isUser,
    holdsPen: a.holdsPen,
    weightPct: Math.round(a.weight * 100),
    prospectId: a.prospectId,
    prospectName: a.prospectName,
    pos: a.pos,
    grade: a.grade,
    pull: Math.round((a.score - a.grade) * 10) / 10,
    reason: a.reason,
  }))
  const spread = new Set(args.map((a) => a.prospectId)).size
  const mine = args.find((a) => a.isUser)
  return {
    lines,
    consensus: args.length > 0 && spread === 1,
    spread,
    active: draftPhilosophyActive(world, career),
    leader: ranked[0]?.prospectName ?? null,
    yourLine: mine ? mine.reason : null,
  }
}

// ── The board's attribution (whose view moved a prospect) ────────────────────

export interface BoardVoice {
  short: string
  name: string
  title: string
  isUser: boolean
  /** The seat's own stance delta for him, signed grade points. */
  lift: number
  reason: string
  /** The blended tilt the club's board applies (0 when the philosophy is unset). */
  blended: number
}

/**
 * `boardVoices` keyed by prospect id, for the board's "Room voice" cell. Only
 * prospects a stance actually moves (|lift| ≥ 1) are returned.
 */
export function boardVoiceIndex(world: World, career: CareerState): Map<string, BoardVoice> {
  const out = new Map<string, BoardVoice>()
  for (const [id, v] of boardVoices(world, career)) {
    out.set(id, { short: v.short, name: v.name, title: v.title, isUser: v.isUser, lift: v.lift, reason: v.reason, blended: v.blended })
  }
  return out
}

// ── AI clubs' own identities (DF4) ───────────────────────────────────────────

export interface AiClubIdentity {
  teamId: string
  abbr: string
  name: string
  /** The club's GM, whose own numbers frame the room. */
  gm: string
  chips: StanceChip[]
  /** The blended step the club's board runs on. */
  vector: DraftPhilosophy
}

export interface AiIdentityView {
  on: boolean
  /** Every club, in board order (the ones with a stance of their own first). */
  clubs: AiClubIdentity[]
  /** How many clubs carry at least one non-default stance. */
  withStance: number
  /** How many distinct blended vectors the league holds (a spread, not an average). */
  distinct: number
  /** Clubs whose board leans Need vs BPA — the two ends of the axis. */
  need: number
  bpa: number
}

/**
 * Every AI club's own room, read straight off the engine (`aiSeats` /
 * `aiIdentityVector`). Only computed when the toggle is on — off is today's
 * league, and the panel says so.
 */
export function aiIdentityView(world: World, career: CareerState): AiIdentityView {
  const on = career.aiDraftIdentities === true
  if (!on) return { on, clubs: [], withStance: 0, distinct: 0, need: 0, bpa: 0 }
  const clubs: AiClubIdentity[] = []
  const vectors = new Set<string>()
  let withStance = 0
  let need = 0
  let bpa = 0
  for (const team of world.teams) {
    if (team.id === career.teamId) continue
    const vector = aiIdentityVector(world, team.id)
    const chips = stanceAxes(vector).map((a) => ({ axis: a.axis, label: PHILOSOPHY_AXIS_LABEL[a.axis], step: a.step }))
    if (chips.length) withStance++
    if (vector.board === 'Need') need++
    else if (vector.board === 'BPA') bpa++
    vectors.add(PHILOSOPHY_AXES.map((a) => vector[a]).join('|'))
    clubs.push({
      teamId: team.id,
      abbr: team.abbr,
      name: team.name,
      gm: generalManager(world, team.id)?.name ?? '—',
      chips,
      vector,
    })
  }
  clubs.sort((a, b) => b.chips.length - a.chips.length || (a.teamId < b.teamId ? -1 : 1))
  return { on, clubs, withStance, distinct: vectors.size, need, bpa }
}

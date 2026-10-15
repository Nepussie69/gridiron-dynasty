// ─────────────────────────────────────────────────────────────────────────────
// Draft-room UI data (FUTURES #27 DF3).
//
// Every number the philosophy card and the room view show, read straight off the
// DF1/DF2 engine — `roomSeats`, `roomArgument`, `blendedVector`,
// `tradeDownOfferLimit`, `blendedTradeWeight`, `seatWeights` and the club's own
// ledger. Nothing is re-derived here: the UI displays what the engine decided.
// Kept out of the .tsx files so they export components only (fast refresh).
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState } from '../game/types'
import type { World } from '../game/engine/generate'
import {
  DEFAULT_PHILOSOPHY,
  PHILOSOPHY_AXES,
  PHILOSOPHY_AXIS_LABEL,
  PHILOSOPHY_STEPS,
  PHILOSOPHY_STEP_HINT,
  SEAT_ORDER,
  blendedTradeWeight,
  blendedVector,
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
  const weights = seatWeights(career)
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

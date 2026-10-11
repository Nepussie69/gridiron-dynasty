// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #11 — the March frenzy lot inspector and its board pieces.
//
// One lot's negotiation: what he cares about, how your offer stacks up against
// the club in front, and the binding offer builder. Desktop renders it as the
// kit `Inspector` (a sticky right column); below 1280px the same element is a
// bottom `Sheet`. The board row (`FrenzyLotRow`) and the career card
// (`FrenzyCard`) live here too, so every frenzy fact is computed in exactly one
// place — the Free Agency board and the career hub never duplicate a helper.
//
// Presentation only: it reads the engine (`faFrenzy`, `progress`, `capPlan`) and
// calls the store actions FA2 already ships. It changes neither.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { ArrowRight, Minus, Plus } from 'lucide-react'
import { cn } from '../lib/cn'
import { money, signed, type Tone } from '../lib/format'
import { marketPrice } from '../game/engine/progress'
import { buildFreeAgentDeal, buildFrenzyContext, frenzyStanding, scoreOffer } from '../game/engine/faFrenzy'
import type {
  FrenzyGuarantee,
  FrenzyLot,
  FrenzyOffer,
  FrenzyPriorities,
  FrenzyState,
  OfferTerms,
} from '../game/engine/faFrenzy'
import { projectCap, projectedCapHit } from '../game/engine/capPlan'
import { canSignFreeAgents } from '../game/engine/career'
import { canAskGm, gmAskCovers } from '../game/engine/gmAsk'
import { canShadow, isOnShadowBoard } from '../game/engine/shadow'
import { capSummary } from '../game/selectors'
import type { Player } from '../game/types'
import type { World } from '../game/engine/generate'
import type { CareerDatabase } from '../game/engine/statsDb'
import { getStatsDb, useGame, useWorld } from '../store/gameStore'
import { GmAskButton } from './GmAskButton'
import {
  Badge,
  BudgetMeter,
  Button,
  Card,
  ConfirmSheet,
  DivergingMeter,
  Inspector,
  OptionCard,
  OptionGroup,
  OvrBadge,
  RatingBar,
  SegmentedControl,
  VerdictChip,
} from '../ui/kit'

// ── Shared facts (one copy, used by the board, the inspector and the card) ────

const FACTOR_KEYS = ['money', 'role', 'fit', 'winning', 'culture'] as const
type FactorKey = (typeof FACTOR_KEYS)[number]

const FACTOR_LABEL: Record<FactorKey, string> = {
  money: 'Money',
  role: 'Role',
  fit: 'Scheme fit',
  winning: 'Winning',
  culture: 'Culture',
}

/** What each priority means in the player's own words (spec design §2). */
const PRIORITY_WORD: Record<FactorKey, string> = {
  money: 'Best offer wins',
  role: 'Wants to start',
  fit: 'Scheme fit matters',
  winning: 'Chasing a ring',
  culture: 'Values the culture',
}

const GUARANTEE_WORD: Record<FrenzyGuarantee, string> = { low: 'Low', mid: 'Mid', high: 'High' }
const GUARANTEE_PCT: Record<FrenzyGuarantee, number> = { low: 30, mid: 50, high: 70 }
const STEP = 250_000

/** A player anywhere in the world: on a roster, or still on the open market. */
function frenzyPlayer(world: World, id: string): Player | undefined {
  return world.players.find((p) => p.id === id) ?? world.freeAgents.find((p) => p.id === id)
}

/** The undiscounted market ask the frenzy bids against (K2 never touches it). */
function marketAsk(world: World, p: Player): number {
  return marketPrice(p, world.season, world.era?.positionBias?.[p.pos] ?? 1)
}

/** Offers still on the table: AI offers expire, the user's never do. */
function liveOffers(lot: FrenzyLot, day: number): FrenzyOffer[] {
  return lot.offers.filter((o) => o.user || o.expiresDay >= day)
}

/** The lot's top priorities as words, biggest first. */
function priorityWords(pr: FrenzyPriorities, n = 2): string[] {
  return [...FACTOR_KEYS].sort((a, b) => pr[b] - pr[a]).slice(0, n).map((k) => PRIORITY_WORD[k])
}

function standingMeta(verdict: 'leading' | 'close' | 'behind' | 'out'): { label: string; tone: Tone } {
  if (verdict === 'leading') return { label: 'Leading', tone: 'win' }
  if (verdict === 'close') return { label: 'Within 5%', tone: 'neutral' }
  if (verdict === 'behind') return { label: 'Behind', tone: 'warn' }
  return { label: 'No offer', tone: 'neutral' }
}

/** The agent's one-line read, rounded so it never leaks the exact rival number. */
function agentFeedback(world: World, db: CareerDatabase, state: FrenzyState, lot: FrenzyLot, teamId: string): string {
  const st = frenzyStanding(world, state, db, lot.playerId, teamId)
  if (st.verdict === 'out') return 'No offer in — get on the board.'
  if (st.verdict === 'leading') return 'Leading'
  if (st.verdict === 'close') return 'Within 5%'
  const leader = liveOffers(lot, state.day).find((o) => o.teamId === st.leader)
  const approx = leader ? Math.round(leader.aav / 500_000) * 500_000 : 0
  return `Behind — a contender is at ~${money(approx)}`
}

/** A club's live offers across the board, and how many of them lead. */
function boardBids(world: World, db: CareerDatabase, teamId: string): { bids: number; leading: number } {
  const state = world.faFrenzy
  if (!state) return { bids: 0, leading: 0 }
  let bids = 0
  let leading = 0
  for (const lot of state.lots) {
    if (lot.status !== 'open') continue
    if (!liveOffers(lot, state.day).some((o) => o.teamId === teamId)) continue
    bids++
    if (frenzyStanding(world, state, db, lot.playerId, teamId).verdict === 'leading') leading++
  }
  return { bids, leading }
}

function lotStatusText(world: World, lot: FrenzyLot, teamId: string): string {
  if (lot.status === 'signed') {
    const abbr = world.byId[lot.signedWith ?? '']?.abbr ?? lot.signedWith ?? ''
    return lot.signedWith === teamId ? `Signed · ${abbr} (you)` : `Signed · ${abbr}`
  }
  if (lot.status === 'gone') return 'Off the board'
  if (lot.status === 'passed') return 'Back to market'
  return 'Withdrawn'
}

// ── The board row ─────────────────────────────────────────────────────────────

/**
 * One lot on the March board: rating, ask, priority words, suitors, the
 * decision-day countdown and your standing. Clicking it opens the inspector.
 */
export function FrenzyLotRow({
  lotId,
  selected,
  onSelect,
}: {
  lotId: string
  selected: boolean
  onSelect: () => void
}) {
  const world = useWorld()
  const career = useGame((s) => s.career)
  const state = world.faFrenzy
  const lot = state?.lots.find((l) => l.playerId === lotId)
  const p = frenzyPlayer(world, lotId)
  if (!state || !lot || !p) return null

  const db = getStatsDb()
  const teamId = career?.teamId ?? ''
  const open = lot.status === 'open'
  const standing = open ? frenzyStanding(world, state, db, lotId, teamId) : null
  const meta = standing ? standingMeta(standing.verdict) : null
  const suitors = liveOffers(lot, state.day).filter((o) => o.teamId !== teamId).length
  const left = lot.decisionDay - state.day

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'motion flex min-h-11 w-full flex-wrap items-center gap-3 rounded-[var(--r-md)] border p-3 text-left',
        selected ? 'border-line-strong bg-[var(--team-tint)]' : 'border-line bg-surface hover:bg-surface-2',
      )}
    >
      <OvrBadge value={p.ovr} pot={p.pot} size={30} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-600 text-ink">{p.name}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-muted">
          <span className="tnum">
            {p.pos} · age {p.age} · {money(marketAsk(world, p))} ask
          </span>
          {priorityWords(lot.priorities).map((w) => (
            <Badge key={w} tone="neutral">
              {w}
            </Badge>
          ))}
        </span>
      </span>
      <span className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
        {open && (
          <Badge tone="neutral">
            {suitors} suitor{suitors === 1 ? '' : 's'}
          </Badge>
        )}
        {open && (
          <span className="text-label text-muted tnum">{left <= 0 ? 'Decides today' : `Decides in ${left}d`}</span>
        )}
        {meta && <VerdictChip tone={meta.tone}>{meta.label}</VerdictChip>}
        {!open && <Badge tone={lot.signedWith === teamId ? 'win' : 'neutral'}>{lotStatusText(world, lot, teamId)}</Badge>}
      </span>
    </button>
  )
}

// ── The career-hub card ───────────────────────────────────────────────────────

/**
 * The March pointer on the career hub: "Frenzy: day 3 — 2 bids live, 1 leading".
 * Renders nothing outside the bidding window.
 */
export function FrenzyCard() {
  const world = useWorld()
  const career = useGame((s) => s.career)
  const setScreen = useGame((s) => s.setScreen)
  const state = world.faFrenzy
  if (!career || !state || world.phase !== 'offseason' || world.offseasonStage !== 'freeAgency') return null
  const { bids, leading } = boardBids(world, getStatsDb(), career.teamId)

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="label">March · free agency</div>
          <div className="font-cond text-body font-700 uppercase tracking-[0.02em] text-ink">
            Frenzy: day {state.day} — {bids} bid{bids === 1 ? '' : 's'} live, {leading} leading
          </div>
          <p className="mt-1 text-small text-muted">
            The top of the market is taking offers. Work the board before the window closes.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<ArrowRight size={14} aria-hidden />}
          onClick={() => setScreen('freeagency')}
        >
          Open the board
        </Button>
      </div>
    </Card>
  )
}

// ── The inspector ─────────────────────────────────────────────────────────────

/**
 * The negotiation for one lot. Priorities are exact bars only when the player is
 * on your shadow board; otherwise they read as words. The offer builder is
 * binding and raise-only; without roster authority it becomes the GM-request path.
 *
 * Render with `key={lotId}` so a new lot starts a fresh builder.
 */
export function FrenzyLotInspector({
  lotId,
  open,
  onClose,
}: {
  lotId: string | null
  open: boolean
  onClose: () => void
}) {
  const world = useWorld()
  const career = useGame((s) => s.career)
  const placeFrenzyOffer = useGame((s) => s.placeFrenzyOffer)
  const withdrawFrenzyOffer = useGame((s) => s.withdrawFrenzyOffer)
  const state = world.faFrenzy
  const lot = state && lotId ? state.lots.find((l) => l.playerId === lotId) ?? null : null
  const player = lotId ? frenzyPlayer(world, lotId) : undefined
  const db = getStatsDb()
  const teamId = career?.teamId ?? ''
  const mine = lot?.offers.find((o) => o.teamId === teamId)

  const [years, setYears] = useState(() =>
    mine?.years ?? (player ? (player.age <= 25 ? 4 : player.age <= 27 ? 3 : 2) : 3),
  )
  const [guarantee, setGuarantee] = useState<FrenzyGuarantee>(() => mine?.guarantee ?? 'mid')
  const [aav, setAav] = useState(() =>
    mine?.aav ?? (player ? Math.round(marketAsk(world, player) / 100_000) * 100_000 : 0),
  )
  const [review, setReview] = useState(false)
  const [pulling, setPulling] = useState(false)

  if (!lot || !player || !state) {
    return (
      <Inspector open={false} onClose={onClose} title="">
        <span />
      </Inspector>
    )
  }

  const canSign = !!career && canSignFreeAgents(career)
  const askGm = !!career && canAskGm(career) && gmAskCovers(career, player.pos)
  const scouted = !!career && canShadow(career) && isOnShadowBoard(career, lot.playerId)

  const ctx = buildFrenzyContext(world, db)
  const live = liveOffers(lot, state.day)
  const scored = live
    .map((o) => ({ offer: o, score: scoreOffer(world, db, lot, o, ctx) }))
    .sort((a, b) => b.score.total - a.score.total)
  const mineEntry = scored.find((s) => s.offer.teamId === teamId)
  const rivalEntry = scored.find((s) => s.offer.teamId !== teamId)
  const standing = frenzyStanding(world, state, db, lot.playerId, teamId)
  const meta = standingMeta(standing.verdict)
  const feedback = agentFeedback(world, db, state, lot, teamId)
  const suitors = live.filter((o) => o.teamId !== teamId).length
  const left = lot.decisionDay - state.day

  const term = (t: OfferTerms | undefined, k: FactorKey): number => (t ? t[k] : 0)
  const minAav = mine?.aav ?? 500_000
  const maxAav = 90_000_000
  const ask = marketAsk(world, player)
  const deal = buildFreeAgentDeal(player, world.season, { years, aav, guarantee })
  const cap = capSummary(world, teamId)
  const plan = projectCap(world.roster[teamId] ?? [], world.deadMoney[teamId] ?? 0, world.season, 3)
  const pctOfAsk = ask > 0 ? Math.round((aav / ask) * 100) : 100
  const raiseOnly = !!mine && aav <= mine.aav

  const step = (dir: -1 | 1) => setAav((v) => Math.max(minAav, Math.min(maxAav, v + dir * STEP)))

  return (
    <Inspector
      open={open}
      onClose={onClose}
      eyebrow={`${player.pos} · OVR ${player.ovr} · age ${player.age}`}
      title={player.name}
      actions={
        mine && canSign ? (
          <Button variant="secondary" size="sm" onClick={() => setPulling(true)}>
            Withdraw offer…
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <VerdictChip tone={meta.tone}>{meta.label}</VerdictChip>
        <span className="text-small text-ink-2">{feedback}</span>
      </div>
      <p className="mt-2 text-small text-muted">
        Market ask <b className="font-600 text-ink-2">{money(ask)}</b>/yr · {suitors} suitor
        {suitors === 1 ? '' : 's'} · {left <= 0 ? 'decides today' : `decides in ${left}d`}
        {mine ? ` · you're in at ${money(mine.aav)}` : ''}
      </p>

      <div className="label mt-4">What he cares about</div>
      {scouted ? (
        <div className="mt-2 space-y-2">
          {FACTOR_KEYS.map((k) => (
            <div key={k}>
              <div className="flex items-baseline justify-between gap-2 text-label">
                <span className="label">{FACTOR_LABEL[k]}</span>
                <span className="tnum text-ink-2">{Math.round(lot.priorities[k] * 100)}%</span>
              </div>
              <RatingBar
                value={lot.priorities[k] * 100}
                max={100}
                height={6}
                color="var(--color-ink-2)"
                label={`${FACTOR_LABEL[k]} priority ${Math.round(lot.priorities[k] * 100)}%`}
              />
            </div>
          ))}
          <p className="text-label text-muted">Exact weights — he&apos;s on your shadow board.</p>
        </div>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {priorityWords(lot.priorities, 3).map((w) => (
              <Badge key={w} tone="neutral">
                {w}
              </Badge>
            ))}
          </div>
          <p className="mt-2 text-label text-muted">
            Scout him onto your shadow board to see his exact priorities.
          </p>
        </>
      )}

      <div className="label mt-4">You vs the club in front</div>
      <div className="mt-2 space-y-2.5">
        {FACTOR_KEYS.map((k) => {
          const delta = term(mineEntry?.score.terms, k) - term(rivalEntry?.score.terms, k)
          return (
            <div key={k}>
              <div className="flex items-baseline justify-between gap-2 text-label">
                <span className="label">{FACTOR_LABEL[k]}</span>
                <span className="tnum text-muted">{signed(delta, 2)}</span>
              </div>
              <DivergingMeter
                label={`${FACTOR_LABEL[k]} vs the leader`}
                value={delta}
                min={-1}
                max={1}
                mid={0}
                goodWhen="up"
                format={(n) => signed(n, 2)}
              />
            </div>
          )
        })}
      </div>
      {!mine && <p className="mt-2 text-label text-muted">No offer in yet — you&apos;re behind on every factor.</p>}

      <div className="label mt-5">Your offer</div>
      {canSign ? (
        <div className="mt-2 space-y-4">
          <div>
            <div className="mb-1.5 text-label text-muted">Length</div>
            <SegmentedControl
              label="Contract length"
              className="flex w-full [&>button]:flex-1 [&>button]:justify-center [&>button]:text-center"
              value={String(years)}
              onChange={(v) => setYears(Number(v))}
              options={[1, 2, 3, 4, 5].map((n) => ({ id: String(n), label: `${n}y` }))}
            />
          </div>

          <div>
            <div className="mb-1.5 text-label text-muted">Guarantee</div>
            <OptionGroup label="Guarantee">
              {(['low', 'mid', 'high'] as FrenzyGuarantee[]).map((g) => (
                <OptionCard
                  key={g}
                  selected={guarantee === g}
                  onSelect={() => setGuarantee(g)}
                  title={GUARANTEE_WORD[g]}
                  description={`${GUARANTEE_PCT[g]}% guaranteed`}
                  meta={<span className="tnum">{money((aav * years * GUARANTEE_PCT[g]) / 100)}</span>}
                />
              ))}
            </OptionGroup>
          </div>

          <div>
            <div className="mb-1.5 text-label text-muted">Average per year</div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="pointer-coarse:min-w-11"
                aria-label="Lower the offer by $250K"
                onClick={() => step(-1)}
                disabled={aav <= minAav}
              >
                <Minus size={14} aria-hidden />
              </Button>
              <span className="min-w-[86px] text-center font-display text-[22px] font-800 italic text-ink tnum">
                {money(aav)}
              </span>
              <Button
                variant="secondary"
                size="sm"
                className="pointer-coarse:min-w-11"
                aria-label="Raise the offer by $250K"
                onClick={() => step(1)}
                disabled={aav >= maxAav}
              >
                <Plus size={14} aria-hidden />
              </Button>
              <span className="ml-auto text-label text-muted tnum">{pctOfAsk}% of ask</span>
            </div>
            {mine && (
              <p className="mt-1.5 text-label text-muted">
                You&apos;re in at {money(mine.aav)} — a binding offer can only be raised.
              </p>
            )}
          </div>

          <div className="space-y-3 rounded-[var(--r-md)] border border-line p-3">
            <div className="label">Cap after the deal</div>
            {plan.years.map((y, i) => {
              const used = y.limit - y.space + projectedCapHit(deal, i)
              return (
                <BudgetMeter
                  key={y.season}
                  used={used}
                  total={y.limit}
                  note={`${y.season} · ${money(y.limit - used)} room left`}
                />
              )
            })}
          </div>

          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={raiseOnly}
            title={raiseOnly ? `Already in at ${money(mine?.aav ?? 0)} — raise it or withdraw.` : undefined}
            onClick={() => setReview(true)}
          >
            Review offer · {money(aav)}/yr
          </Button>
        </div>
      ) : askGm ? (
        <div className="mt-2 space-y-2">
          <p className="text-small text-muted">
            Roster building is the GM&apos;s call at your rung. Put {player.name} in front of him and he bids on your
            behalf.
          </p>
          <GmAskButton player={player} kind="sign" label={`Ask GM to sign ${player.name}`} />
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <Button variant="secondary" disabled title="Roster control unlocks at Director of Player Personnel">
            Make an offer
          </Button>
          <p className="text-label text-muted">Roster control unlocks at Director of Player Personnel.</p>
        </div>
      )}

      <ConfirmSheet
        open={review}
        onClose={() => setReview(false)}
        eyebrow="March frenzy"
        title={`Offer ${player.name}?`}
        subtitle={`${player.pos} · age ${player.age} · rated ${player.ovr}`}
        destructive={false}
        confirmLabel={`Submit · ${money(aav)}/yr`}
        ledgerNote={null}
        consequences={[
          { label: 'Length', value: `${years} year${years === 1 ? '' : 's'}` },
          { label: 'Average per year', value: money(aav) },
          { label: 'Total value', value: money(aav * years) },
          { label: 'Guarantee', value: `${GUARANTEE_WORD[guarantee]} · ${GUARANTEE_PCT[guarantee]}%` },
          { label: 'Cap hit this season', value: money(deal.capHit), tone: 'warn' },
          {
            label: 'Cap space after',
            value: money(cap.space - deal.capHit),
            tone: cap.space - deal.capHit < 0 ? 'loss' : undefined,
          },
        ]}
        onConfirm={() => {
          placeFrenzyOffer(lot.playerId, { years, aav, guarantee })
          setReview(false)
        }}
      >
        <p className="mt-2 text-small text-muted">
          This offer is binding: you can only raise it, and pulling it costs you trust with {player.name}. He signs on
          his decision day if it is the best one on the table.
        </p>
      </ConfirmSheet>

      <ConfirmSheet
        open={pulling}
        onClose={() => setPulling(false)}
        eyebrow="March frenzy"
        title="Withdraw your offer?"
        subtitle={`${player.name} · ${money(mine?.aav ?? 0)}/yr`}
        destructive={false}
        confirmLabel="Withdraw offer"
        ledgerNote={null}
        consequences={[
          { label: 'Trust penalty', value: '−5 with him', tone: 'warn' },
          { label: 'Your offer', value: 'Removed from the board' },
          { label: 'Rival offers', value: 'Unaffected', tone: 'warn' },
        ]}
        onConfirm={() => {
          withdrawFrenzyOffer(lot.playerId)
          setPulling(false)
        }}
      >
        <p className="mt-2 text-small text-muted">
          Pulling a binding offer is remembered: {player.name} docks your club 5 points of trust on every future score.
          You can bid again, but he will hold it against you.
        </p>
      </ConfirmSheet>
    </Inspector>
  )
}

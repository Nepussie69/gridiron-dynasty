import { CalendarClock, FastForward, LayoutGrid, List, SlidersHorizontal, Timer, Trophy } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { DraftProspect, Position } from '../game/types'
import {
  DRAFT_ROUNDS,
  currentRound,
  currentTeamId,
  draftOpen,
  overallPick,
  rookieProjection,
  stageOf,
  stagesUntilDraft,
} from '../game/engine/draft'
import { accessFor } from '../game/engine/access'
import { readProspect, readRookieRanges } from '../game/engine/evaluation'
import { draftPickValue } from '../game/selectors'
import { useGame, useWorld } from '../store/gameStore'
import { DraftTradePanel } from '../components/DraftTradePanel'
import { DataTable, type Column } from '../components/DataTable'
import {
  AccessBanner,
  Badge,
  Button,
  Card,
  ConfirmSheet,
  FilterChip,
  KpiStrip,
  KpiTile,
  PageHeader,
  RatingTile,
  RookieRangeBadges,
  SectionTitle,
  SegmentedControl,
  Sheet,
  TeamCrest,
  TierLegend,
} from '../ui/kit'
import { usePhone } from '../ui/hooks'

/** Canonical position order for the board filter (matches Roster / Free Agency). */
const BOARD_POSITIONS: Position[] = ['QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'OG', 'C', 'DE', 'DT', 'LB', 'CB', 'S', 'K', 'P']

/** A neutral chip (board rank, remaining count — never a status colour). */
function NeutralChip({ children }: { children: ReactNode }) {
  return (
    <span className="whitespace-nowrap rounded-[var(--r-xs)] bg-surface-3 px-1.5 py-0.5 font-cond text-label font-700 uppercase leading-none tracking-[0.05em] text-ink-2">
      {children}
    </span>
  )
}

export function Draft() {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const onClockFn = useGame((s) => s.userOnClock)
  const draftProspect = useGame((s) => s.draftProspect)
  const toggleUserBoard = useGame((s) => s.toggleUserBoard)
  const simToMyPick = useGame((s) => s.simToMyPick)
  const finishDraft = useGame((s) => s.finishDraft)
  const phone = usePhone()
  const [boardView, setBoardView] = useState<'list' | 'cards'>('list')
  const [posFilter, setPosFilter] = useState<Position | 'ALL'>('ALL')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [finishOpen, setFinishOpen] = useState(false)

  const teamId = currentTeamId(league)
  const onClock = teamId ? league.byId[teamId] : null
  const mine = onClockFn()
  const access = accessFor(career, 'draft')
  const deciding = access === 'decide'
  const advising = access === 'advise'
  const complete = league.draftState.complete
  // L12.6 C2: the draft is an April event. Off it, the board is a read-only
  // scouting surface and the draft-day buttons are disabled.
  const draftIsOpen = draftOpen(league)
  const stage = stageOf(league)
  const untilDraft = stagesUntilDraft(league)
  const closedReason = draftIsOpen
    ? ''
    : stage
      ? `The draft opens in April (${untilDraft} stage${untilDraft === 1 ? '' : 's'} away).`
      : 'The draft is in April — scout the class now.'
  const available = league.draft.filter((p) => !p.draftedBy).sort((a, b) => b.grade - a.grade)

  // Display-only position filter for the Prospect Board. Drafting / advising /
  // auto picks all read the full `available` list; only what we render changes.
  const classPositions = useMemo(
    () => BOARD_POSITIONS.filter((p) => league.draft.some((d) => d.pos === p)),
    [league.draft],
  )
  const boardShown = posFilter === 'ALL' ? available : available.filter((p) => p.pos === posFilter)

  const myPicks = league.draft.filter((p) => p.draftedBy === career.teamId)
  const board = career.userBoard ?? []
  const capital = myPicks.reduce((s, p) => s + draftPickValue(p.draftPick ?? 250), 0)

  const readOf = (p: DraftProspect) => readProspect(career, p)

  // ── Prospect Board columns (shared table; card rows on phone) ──
  const columns: Column<DraftProspect>[] = [
    {
      key: 'name',
      label: 'Prospect',
      card: 'title',
      sortValue: (p) => p.name,
      render: (p) => {
        const read = readOf(p)
        const rank = board.indexOf(p.id)
        return (
          <span className="block min-w-0">
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate font-600 text-ink">{p.name}</span>
              {rank >= 0 && <NeutralChip>#{rank + 1} your board</NeutralChip>}
            </span>
            <span className="block text-small text-muted">
              {p.college} · {read.bandLabel}
            </span>
          </span>
        )
      },
    },
    {
      key: 'pos',
      label: 'Pos',
      card: 'value',
      sortValue: (p) => p.pos,
      render: (p) => <span className="font-cond text-small font-700 uppercase text-ink-2">{p.pos}</span>,
    },
    {
      key: 'range',
      label: 'Now · Ceiling',
      headerTitle: 'Your rookie read on the NFL scale — tightens as you scout him. Separate from the college grade.',
      card: 'meta',
      sortValue: (p) => readOf(p).center,
      render: (p) => {
        const read = readOf(p)
        if (!read.visible) {
          return <span className="whitespace-nowrap rounded-[var(--r-xs)] bg-surface-3 px-1.5 py-1 font-cond text-small font-700 uppercase text-muted">OUT of region</span>
        }
        const rr = readRookieRanges(career, p, league.draft)
        return <RookieRangeBadges now={rr.now} ceiling={rr.ceiling} compact />
      },
    },
    {
      key: 'grade',
      label: 'College grade',
      headerTitle: "The public consensus grade (college scale) — only visible once your rung earns it",
      align: 'right',
      card: 'aside',
      sortValue: (p) => readOf(p).consensus ?? -1,
      render: (p) => {
        const read = readOf(p)
        // readProspect hides the consensus below director rungs / 70% confidence.
        if (read.consensus == null) return <span className="text-small text-muted">hidden</span>
        return <RatingTile value={read.consensus} size="sm" college label="College grade" />
      },
    },
    {
      key: 'action',
      label: '',
      align: 'right',
      card: 'aside',
      render: (p) => {
        const rank = board.indexOf(p.id)
        return deciding ? (
          <Button
            size="sm"
            variant="primary"
            rowSafe
            disabled={!mine || !draftIsOpen}
            title={!draftIsOpen ? closedReason : mine ? `Draft ${p.name}` : 'Only available when you are on the clock'}
            onClick={() => draftProspect(p.id)}
          >
            Draft
          </Button>
        ) : (
          <Button
            size="sm"
            variant={rank >= 0 ? 'secondary' : 'quiet'}
            rowSafe
            disabled={!advising}
            title={advising ? 'Add or remove him from your board' : 'The final call belongs to someone above you'}
            onClick={() => toggleUserBoard(p.id)}
          >
            {rank >= 0 ? 'On board' : 'Advise'}
          </Button>
        )
      },
    },
  ]

  const posFilters = (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Position filter">
      {(['ALL', ...classPositions] as (Position | 'ALL')[]).map((p) => (
        <FilterChip key={p} pressed={posFilter === p} onChange={() => setPosFilter(p)}>
          {p}
        </FilterChip>
      ))}
    </div>
  )

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow={`${league.season} Draft`}
        title="Draft War Room"
        subtitle={
          deciding
            ? 'You hold the pen. Stack the board and make the call when your club is on the clock.'
            : advising
              ? 'You advise: rank your board. The Director weighs your list against consensus — and the game grades whether he listened.'
              : 'You are building the board for the club — the final call comes higher up until you earn it.'
        }
        right={
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              label="Board view"
              value={boardView}
              onChange={setBoardView}
              options={[
                { id: 'list', label: 'List', icon: <List size={14} aria-hidden /> },
                { id: 'cards', label: 'Cards', icon: <LayoutGrid size={14} aria-hidden /> },
              ]}
            />
            {!draftIsOpen ? (
              <Badge tone="warn"><CalendarClock size={12} /> April</Badge>
            ) : !complete ? (
              <div className="flex items-center gap-2 rounded-[var(--r-md)] border border-line bg-surface px-3 py-2">
                <Timer size={16} className="text-muted" />
                <span className="font-cond text-small font-700 uppercase">
                  {mine ? 'You are on the clock' : `Round ${currentRound(league)} · Pick ${overallPick(league)}`}
                </span>
              </div>
            ) : (
              <Badge tone="win"><Trophy size={12} /> Draft complete</Badge>
            )}
          </div>
        }
      />

      <AccessBanner
        area="draft"
        className="mb-4"
        message={
          advising ? (
            <>
              <b className="font-600 text-ink">You advise on the draft at your rung.</b> Rank your board; the Director
              weighs your list against consensus, and the pick is his.
            </>
          ) : (
            <>
              <b className="font-600 text-ink">The draft call is above your rung.</b> Read the board, file your calls and
              red flags — the selections belong to someone else until you climb.
            </>
          )
        }
      />

      {!draftIsOpen && (
        <div className="mb-4 rounded-[var(--r-md)] border border-warn/30 bg-warn-soft p-3 text-small text-warn">
          {closedReason} Scout the class, rank your board, file conviction calls and red flags — the picks wait until April.
        </div>
      )}

      <KpiStrip label="Draft summary" className="mb-4 order-3 lg:order-none">
        <KpiTile
          label="Your picks"
          value={myPicks.length}
          unit="made"
          why={<span className="text-muted">Graded two seasons on in your Ledger</span>}
        />
        <KpiTile
          label="Draft capital"
          value={capital.toLocaleString()}
          unit="value points"
          why={<span className="text-muted">Trade-chart value of your selections so far</span>}
        />
        <KpiTile
          label="Class left"
          value={available.length}
          unit="prospects"
          why={
            <span className="text-muted">
              Top of the board: <b className="font-600 text-ink">{available[0]?.name ?? '—'}</b>
            </span>
          }
        />
        <KpiTile
          label="Rounds"
          value={`${complete ? DRAFT_ROUNDS : Math.min(currentRound(league), DRAFT_ROUNDS)} / ${DRAFT_ROUNDS}`}
          unit="rounds"
          verdict={complete ? { label: 'Complete', tone: 'win' } : { label: 'In progress', tone: 'neutral' }}
          why={<span className="text-muted max-sm:hidden">Seven rounds, then the undrafted sign league-wide</span>}
        />
      </KpiStrip>

      <div className="order-2 grid grid-cols-[minmax(0,1fr)] gap-4 lg:order-none lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* Rail: on the clock, your board, your selections, the draft-day buttons. Below the board on phone. */}
        <div className="order-2 min-w-0 space-y-4 lg:order-1">
          {draftIsOpen && onClock && !complete && (
            <Card tier="feature">
              <div className="flex items-center gap-2">
                <CalendarClock size={15} className="text-[var(--team-accent-text)]" aria-hidden />
                <span className="label text-[var(--team-accent-text)]">On the clock</span>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <TeamCrest team={onClock} size={40} />
                <div className="min-w-0">
                  <div className="truncate font-display text-[22px] font-800 italic uppercase leading-none text-ink">{onClock.name}</div>
                  <div className="font-cond text-small text-muted">
                    Pick {overallPick(league)} · Round {currentRound(league)}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {advising && (
            <Card>
              <SectionTitle right={<Badge tone="neutral">{board.length} ranked</Badge>}>Your Board</SectionTitle>
              <div className="space-y-1">
                {board.length === 0 && (
                  <p className="text-small text-muted">Rank prospects from the board — your top names get the Director's attention.</p>
                )}
                {board.map((id, i) => {
                  const p = league.draft.find((x) => x.id === id)
                  if (!p) return null
                  const proj = rookieProjection(league.draft, p)
                  return (
                    <div key={id} className="flex items-center gap-2 text-small">
                      <span className="w-5 font-display font-700 tnum text-muted">{i + 1}</span>
                      <span className="w-8 font-cond text-micro font-700 uppercase text-ink-2">{p.pos}</span>
                      <span className="min-w-0 flex-1 truncate font-600 text-ink">{p.name}</span>
                      <span className="whitespace-nowrap font-cond text-micro tnum text-muted">
                        Now ~{proj.now} · Ceil {proj.ceiling}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleUserBoard(id)}
                        className="font-cond text-micro font-700 uppercase text-muted transition hover:text-ink"
                      >
                        Remove
                      </button>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          <Card pad={false}>
            <div className="border-b border-line px-4 py-2">
              <span className="label">Your Selections</span>
            </div>
            <div className="divide-y divide-line/60 max-sm:max-h-none max-sm:overflow-visible sm:max-h-[280px] sm:overflow-y-auto">
              {myPicks.map((p) => {
                const rr = readRookieRanges(career, p, league.draft)
                return (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-2">
                    <span className="grid h-7 w-7 place-items-center rounded-[var(--r-sm)] bg-surface-3 font-display text-small font-700 text-ink-2">
                      {p.draftPick}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-cond text-small font-700 uppercase text-ink">{p.name}</div>
                      <div className="text-small text-muted">{p.pos} · {p.college}</div>
                      <RookieRangeBadges now={rr.now} ceiling={rr.ceiling} compact className="mt-0.5" />
                    </div>
                    <RatingTile value={p.grade} size="xs" college label="College grade" />
                  </div>
                )
              })}
              {!myPicks.length && <div className="px-4 py-6 text-center text-small text-muted">No picks yet.</div>}
            </div>
          </Card>

          <div className="flex flex-col gap-2">
            <Button
              variant="slab"
              className="w-full"
              disabled={complete || !draftIsOpen}
              title={!draftIsOpen ? closedReason : undefined}
              icon={<FastForward size={15} aria-hidden />}
              onClick={simToMyPick}
            >
              Sim to my next pick
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              disabled={complete || !draftIsOpen}
              title={!draftIsOpen ? closedReason : undefined}
              onClick={() => setFinishOpen(true)}
            >
              Complete the draft
            </Button>
          </div>
        </div>

        {/* Main: the Prospect Board first on phone, then the trade desk, then the log. */}
        <div className="order-1 flex min-w-0 flex-col gap-4 lg:order-2">
          <Card pad={false} className="order-1 overflow-hidden lg:order-2">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5">
              <SectionTitle className="!mb-0">Prospect Board</SectionTitle>
              <Badge tone="neutral">
                {posFilter === 'ALL' ? `${available.length} remaining` : `${boardShown.length} ${posFilter} · ${available.length} remaining`}
              </Badge>
            </div>

            <TierLegend className="border-b border-line px-4 py-2 max-sm:hidden" />

            {/* Position filter — inline chips on desktop, a sheet on phone. */}
            <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-2 max-sm:hidden" role="group" aria-label="Position filter">
              {(['ALL', ...classPositions] as (Position | 'ALL')[]).map((p) => (
                <FilterChip key={p} pressed={posFilter === p} onChange={() => setPosFilter(p)}>
                  {p}
                </FilterChip>
              ))}
            </div>
            <div className="flex items-center gap-2 border-b border-line px-3 py-2 sm:hidden">
              <Button variant="secondary" size="sm" icon={<SlidersHorizontal size={15} aria-hidden />} onClick={() => setFiltersOpen(true)}>
                Position{posFilter === 'ALL' ? '' : ` · ${posFilter}`}
              </Button>
              <span className="min-w-0 flex-1 truncate text-small text-muted">{boardShown.length} shown</span>
            </div>

            <div className="p-1 sm:p-0">
              <DataTable
                label="Prospect board"
                rows={boardShown}
                columns={columns}
                rowKey={(p) => p.id}
                cards={boardView === 'cards' ? 'always' : 'auto'}
                maxHeight="560px"
                emptyText={posFilter === 'ALL' ? 'No prospects left on the board.' : `No ${posFilter} prospects left on the board.`}
              />
            </div>
          </Card>

          <DraftTradePanel className="order-2 lg:order-1" />

          <Card pad={false} className="order-3">
            <div className="border-b border-line px-4 py-2">
              <span className="label">Draft Log</span>
            </div>
            <div className="divide-y divide-line/60 max-sm:max-h-none max-sm:overflow-visible sm:max-h-[220px] sm:overflow-y-auto">
              {league.draftState.log.map((line, i) => (
                <div key={i} className="px-4 py-1.5 text-small text-ink-2">{line}</div>
              ))}
              {!league.draftState.log.length && (
                <div className="px-4 py-6 text-center text-small text-muted">
                  The draft begins after the regular season ends.
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Sheet open={phone && filtersOpen} onClose={() => setFiltersOpen(false)} eyebrow="Prospect board" title="Filter by position">
        {posFilters}
      </Sheet>

      <ConfirmSheet
        open={finishOpen}
        onClose={() => setFinishOpen(false)}
        eyebrow="Draft"
        title="Complete the draft?"
        subtitle={`${complete ? DRAFT_ROUNDS : Math.min(currentRound(league), DRAFT_ROUNDS)} of ${DRAFT_ROUNDS} rounds done · the rest is simulated`}
        destructive={false}
        consequences={[
          { label: 'Remaining picks', value: 'Made automatically from the board' },
          { label: 'Undrafted free agents', value: 'Signed across the league' },
          { label: 'Your selections', value: `${myPicks.length} made this class` },
        ]}
        confirmLabel="Complete the draft"
        ledgerNote={null}
        onConfirm={() => {
          finishDraft()
          setFinishOpen(false)
        }}
      />
    </div>
  )
}

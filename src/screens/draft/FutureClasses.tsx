// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #29 (FP3) — the Future classes tab of the Draft War Room.
//
// The class the next rollover promotes ("Next year") and the thin class after
// that ("2 years out") are DERIVED from the world seed — see
// engine/futureClasses.ts. Nothing here re-implements the engine: it reads
// `futureClass` / `futureReadFor`, then spends points through the store's
// `scoutFuture` and keeps the watch list through `toggleWatch`.
//
// The read is a wide fog that never shows the truth: a fogged grade range, a
// rough "Day 1 / Day 2 / Day 3" look, and a confidence bar that only firms up
// as you scout. A watched prospect carries his id into the real class.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react'
import { LayoutGrid, List, Search, SlidersHorizontal, Star } from 'lucide-react'
import { cn } from '../../lib/cn'
import type { DraftProspect, Position } from '../../game/types'
import { accessFor } from '../../game/engine/access'
import { inProspectScope } from '../../game/engine/evaluation'
import {
  MAX_PROSPECT_WATCH,
  THIN_CLASS_SIZE,
  futureClass,
  futureConfidenceCap,
  futureReadFor,
} from '../../game/engine/futureClasses'
import { MAX_SCOUT_POINTS, useGame, useWorld } from '../../store/gameStore'
import { DataTable, type Column } from '../../components/DataTable'
import {
  Badge,
  Button,
  Card,
  Chip,
  FilterChip,
  IconButton,
  SectionTitle,
  SegmentedControl,
  Sheet,
} from '../../ui/kit'
import { usePhone } from '../../ui/hooks'

/** Canonical position order (matches the current-class board / Free Agency). */
const BOARD_POSITIONS: Position[] = ['QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'OG', 'C', 'DE', 'DT', 'LB', 'CB', 'S', 'K', 'P']

/** The engine's early confidence ceiling — the point a read stops firming up. */
function confTone(confidence: number, cap: number): string {
  return confidence >= cap ? 'bg-win' : 'bg-warn'
}

export function FutureClasses({ yearsOut }: { yearsOut: 1 | 2 }) {
  const world = useWorld()
  const career = useGame((s) => s.career)!
  const points = useGame((s) => s.scoutingPoints)
  const scoutFuture = useGame((s) => s.scoutFuture)
  const toggleWatch = useGame((s) => s.toggleWatch)
  const phone = usePhone()
  const [view, setView] = useState<'list' | 'cards'>('list')
  const [pos, setPos] = useState<Position | 'ALL'>('ALL')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const locked = accessFor(career, 'scouting') === 'locked'
  const watched = career.prospectWatch ?? []
  const cap = futureConfidenceCap(yearsOut)

  // `futureClass` is memoized per (seed, season, count, horizon) in the engine,
  // so calling it per render is a cache hit and never drifts from the rollover.
  const cls = futureClass(world, yearsOut)
  const reads = useMemo(
    () => new Map(cls.map((p) => [p.id, futureReadFor(world, career, p, yearsOut)])),
    [cls, world, career, yearsOut],
  )
  const sorted = useMemo(
    () => [...cls].sort((a, b) => (reads.get(b.id)?.center ?? 0) - (reads.get(a.id)?.center ?? 0)),
    [cls, reads],
  )
  const positions = useMemo(() => BOARD_POSITIONS.filter((p) => cls.some((d) => d.pos === p)), [cls])
  const shown = pos === 'ALL' ? sorted : sorted.filter((p) => p.pos === pos)
  const outOfScope = useMemo(() => cls.filter((p) => !inProspectScope(career, p)).length, [cls, career])

  const columns: Column<DraftProspect>[] = [
    {
      key: 'name',
      label: 'Prospect',
      card: 'title',
      sortValue: (p) => p.name,
      render: (p) => {
        const r = reads.get(p.id)!
        // The engine hands back a soft "declare" below the confidence floor;
        // the UI only shows a real leaning once the read is at least half sure.
        const leaning = r.leaning && r.confidence >= 50 ? r.leaning : null
        return (
          <span className="block min-w-0">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 truncate font-600 text-ink">{p.name}</span>
              {watched.includes(p.id) && <Chip>Watched</Chip>}
              {leaning && (
                <Badge tone={leaning === 'declare' ? 'info' : 'neutral'}>Leaning {leaning}</Badge>
              )}
            </span>
            <span className="block text-small text-muted">
              {p.college} · {p.classYear}
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
      key: 'look',
      label: 'Look',
      headerTitle: 'A rough read on which draft day he projects to — it stays fogged until the class turns current',
      card: 'value',
      render: (p) => {
        const r = reads.get(p.id)!
        if (!r.visible) return <span className="text-small text-muted">—</span>
        return <Badge tone="neutral">{r.look}</Badge>
      },
    },
    {
      key: 'range',
      label: 'Fog range',
      headerTitle: 'Your fogged grade range — it narrows every time you scout him',
      card: 'meta',
      sortValue: (p) => reads.get(p.id)?.center ?? 0,
      render: (p) => {
        const r = reads.get(p.id)!
        if (!r.visible) {
          return (
            <span className="whitespace-nowrap rounded-[var(--r-xs)] bg-surface-3 px-1.5 py-1 font-cond text-small font-700 uppercase text-muted">
              OUT of region
            </span>
          )
        }
        return (
          <span className="flex items-center gap-2">
            <span className="font-cond text-small font-700 tnum text-ink">
              {r.range[0]}–{r.range[1]}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-10 overflow-hidden rounded-full bg-surface-3">
                <span
                  className={cn('block h-full rounded-full', confTone(r.confidence, cap))}
                  style={{ width: `${r.confidence}%` }}
                />
              </span>
              <span className="w-8 font-cond text-label tnum text-muted">{r.confidence}%</span>
            </span>
          </span>
        )
      },
    },
    {
      key: 'action',
      label: 'Actions',
      align: 'right',
      card: 'aside',
      render: (p) => {
        const r = reads.get(p.id)!
        const isWatched = watched.includes(p.id)
        const noPts = points <= 0
        return (
          <span className="flex items-center justify-end gap-1.5">
            <IconButton
              label={isWatched ? `Unwatch ${p.name}` : `Watch ${p.name}`}
              size="sm"
              pressed={isWatched}
              rowSafe
              onClick={() => toggleWatch(p.id)}
            >
              <Star size={15} aria-hidden className={isWatched ? 'fill-current' : undefined} />
            </IconButton>
            <Button
              size="sm"
              variant="secondary"
              rowSafe
              icon={<Search size={14} aria-hidden />}
              disabled={locked || noPts || !r.visible}
              title={
                locked
                  ? 'Scouting is locked at this rung'
                  : noPts
                    ? 'No scouting points left this week'
                    : !r.visible
                      ? 'Out of your region — you cannot scout him'
                      : 'Spends 1 scouting point · sharpens his range'
              }
              onClick={() => scoutFuture(p.id, yearsOut)}
            >
              Scout · 1 pt
            </Button>
          </span>
        )
      },
    },
  ]

  const posFilters = (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Position filter">
      {(['ALL', ...positions] as (Position | 'ALL')[]).map((p) => (
        <FilterChip key={p} pressed={pos === p} onChange={() => setPos(p)}>
          {p}
        </FilterChip>
      ))}
    </div>
  )

  return (
    <>
      <Card pad={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5">
          <SectionTitle spacing="none">{yearsOut === 1 ? "Next Year's Class" : 'Two Years Out'}</SectionTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{cls.length} prospects</Badge>
            <Badge tone="neutral">
              <Star size={11} aria-hidden /> {watched.length}/{MAX_PROSPECT_WATCH}
            </Badge>
            <Badge tone={points > 0 ? 'neutral' : 'warn'}>
              {points} / {MAX_SCOUT_POINTS} scouting points
            </Badge>
            {locked && <Badge tone="warn">Read only</Badge>}
          </div>
        </div>

        {yearsOut === 2 && (
          <p className="border-b border-line px-4 py-2 text-small text-muted">
            Early look — top {THIN_CLASS_SIZE} only, reads are rough.
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-small text-muted">
            {shown.length} shown
            {outOfScope > 0 ? ` · ${outOfScope} out of region` : ''}
            {watched.length > 0 ? ` · ${watched.length} watched` : ''}
          </span>
          <SegmentedControl
            label="Board view"
            value={view}
            onChange={setView}
            options={[
              { id: 'list', label: 'List', icon: <List size={14} aria-hidden /> },
              { id: 'cards', label: 'Cards', icon: <LayoutGrid size={14} aria-hidden /> },
            ]}
          />
        </div>

        {/* Position filter — inline chips on desktop, a sheet on phone. */}
        <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-2 max-sm:hidden" role="group" aria-label="Position filter">
          {(['ALL', ...positions] as (Position | 'ALL')[]).map((p) => (
            <FilterChip key={p} pressed={pos === p} onChange={() => setPos(p)}>
              {p}
            </FilterChip>
          ))}
        </div>
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 sm:hidden">
          <Button
            variant="secondary"
            size="sm"
            icon={<SlidersHorizontal size={15} aria-hidden />}
            onClick={() => setFiltersOpen(true)}
          >
            Position{pos === 'ALL' ? '' : ` · ${pos}`}
          </Button>
          <span className="min-w-0 flex-1 truncate text-small text-muted">{shown.length} shown</span>
        </div>

        <div className="p-1 sm:p-0">
          <DataTable
            label={yearsOut === 1 ? "Next year's draft class" : 'Two years out draft class'}
            rows={shown}
            columns={columns}
            rowKey={(p) => p.id}
            cards={phone || view === 'cards' ? 'always' : 'auto'}
            defaultSortKey="range"
            maxHeight="calc(100vh - 340px)"
            emptyText={pos === 'ALL' ? 'No prospects in this class.' : `No ${pos} prospects in this class.`}
          />
        </div>
      </Card>

      <Sheet open={phone && filtersOpen} onClose={() => setFiltersOpen(false)} eyebrow="Future class" title="Filter by position">
        {posFilters}
      </Sheet>
    </>
  )
}

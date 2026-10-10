import { useEffect, useMemo, useState } from 'react'
import { Eye, Flag, Flame, Phone, Search, SlidersHorizontal, Star, Target } from 'lucide-react'
import { cn } from '../lib/cn'
import type { DraftProspect, Recommendation } from '../game/types'
import { ensureProspectPools } from '../game/engine/progress'
import { inProspectScope, readProspect, readRookieRanges, scoutRegion } from '../game/engine/evaluation'
import { accessFor } from '../game/engine/access'
import { CHARACTER_FACETS, FACET_LABEL } from '../game/engine/character'
import { isEvaluator, learnedBias, scoutReport } from '../game/engine/scoutBias'
import { canSetTrust, departmentGrade } from '../game/engine/department'
import { MAX_CONVICTION, canConvict, convictionIds } from '../game/engine/conviction'
import { MAX_RED_FLAGS, canRedFlag, isRedFlaggable, redFlagIds } from '../game/engine/redflag'
import { MAX_TRAVEL_COVERAGE, coverageOf } from '../game/engine/scoutTravel'
import { MAX_SCOUT_POINTS, useGame, useWorld } from '../store/gameStore'
import { overallRep } from '../game/engine/career'
import { CombineCard } from '../components/CombineCard'
import { ScoutTravelCard } from '../components/ScoutTravelCard'
import { DataTable, type Column } from '../components/DataTable'
import {
  AccessBanner,
  Badge,
  Button,
  Card,
  FilterChip,
  Inspector,
  KpiStrip,
  KpiTile,
  OverflowMenu,
  PageHeader,
  RatingTile,
  RookieRangeBadges,
  SectionTitle,
  Sheet,
  TierLegend,
  WithInspector,
  type MenuItem,
} from '../ui/kit'
import { usePhone, useMediaQuery, WIDE_QUERY } from '../ui/hooks'

const POS_FILTERS = ['ALL', 'QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'OG', 'C', 'DE', 'DT', 'LB', 'CB', 'S']
/** The four calls. Every chip is neutral; Pass is muted, never red. */
const RECS: { id: Recommendation; label: string }[] = [
  { id: 'Blue Chip', label: 'Blue Chip' },
  { id: 'Starter', label: 'Starter' },
  { id: 'Depth', label: 'Depth' },
  { id: 'Pass', label: 'Pass' },
]

export function Scouting() {
  const league = useWorld()
  useEffect(() => { ensureProspectPools(league) }, [league])
  const career = useGame((s) => s.career)!
  const points = useGame((s) => s.scoutingPoints)
  const selectedId = useGame((s) => s.selectedProspectId)
  const selectProspect = useGame((s) => s.selectProspect)
  const scoutProspect = useGame((s) => s.scoutProspect)
  const investigateCharacter = useGame((s) => s.investigateCharacter)
  const scoutLevel = accessFor(career, 'scouting')
  const phone = usePhone()
  const wide = useMediaQuery(WIDE_QUERY)
  const [pos, setPos] = useState('ALL')
  const [showAll, setShowAll] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const toggleConviction = useGame((s) => s.toggleConviction)
  const canConvictHere = canConvict(career)
  const convicted = canConvictHere ? convictionIds(league, career) : []

  const toggleRedFlag = useGame((s) => s.toggleRedFlag)
  const canRedFlagHere = canRedFlag(career)
  const redFlagged = canRedFlagHere ? redFlagIds(league, career) : []

  const pool = league.draft
  const region = scoutRegion(career)
  const outOfScope = pool.filter((p) => !inProspectScope(career, p)).length

  const scoped = useMemo(() => {
    const base = showAll ? pool : pool.filter((p) => inProspectScope(career, p))
    return base.filter((p) => pos === 'ALL' || p.pos === pos)
  }, [pool, career, pos, showAll])

  const reads = useMemo(() => new Map(scoped.map((p) => [p.id, readProspect(career, p)])), [scoped, career])
  const ranges = useMemo(
    () => new Map(scoped.map((p) => [p.id, readRookieRanges(career, p, pool)])),
    [scoped, career, pool],
  )
  const sorted = useMemo(
    () => [...scoped].sort((a, b) => (reads.get(b.id)?.center ?? 0) - (reads.get(a.id)?.center ?? 0)),
    [scoped, reads],
  )

  const graded = pool.filter((p) => p.recommendation).length
  const hitRate = career.hits + career.misses ? Math.round((career.hits / (career.hits + career.misses)) * 100) : 0
  const hitTone = hitRate >= 60 ? 'win' : hitRate >= 40 ? 'neutral' : 'warn'
  const hitWord = hitRate >= 60 ? 'Sharp' : hitRate >= 40 ? 'Mixed' : 'Cold'

  const locked = scoutLevel === 'locked'
  const charDoneOf = (p: DraftProspect) => !p.character || (p.characterReads ?? []).length >= CHARACTER_FACETS.length

  const quickMenu = (p: DraftProspect): MenuItem[] => {
    const noPts = points <= 0
    const charDone = charDoneOf(p)
    const items: MenuItem[] = [
      {
        id: 'scout',
        label: 'Scout prospect',
        description: locked ? 'Scouting is locked at this rung' : noPts ? 'No scouting points left this week' : 'Spends 1 scouting point · sharpens his range',
        icon: <Search size={16} />,
        disabled: locked || noPts,
        onSelect: () => scoutProspect(p.id),
      },
      {
        id: 'char',
        label: 'Character read',
        description: locked ? 'Scouting is locked at this rung' : charDone ? 'Character fully uncovered' : 'Free · twice a week',
        icon: <Phone size={16} />,
        disabled: locked || charDone,
        onSelect: () => investigateCharacter(p.id),
      },
    ]
    if (canConvictHere) {
      const on = convicted.includes(p.id)
      const flagged = redFlagged.includes(p.id)
      const full = !on && convicted.length >= MAX_CONVICTION
      items.push({
        id: 'conviction',
        label: on ? 'Remove conviction call' : 'Pound the table',
        description: on
          ? 'Take your conviction call back'
          : full
            ? `Conviction calls are full (${MAX_CONVICTION})`
            : flagged
              ? 'He is red-flagged — clear the flag first'
              : 'Your read the club must not ignore',
        icon: <Flame size={16} />,
        disabled: full || flagged,
        onSelect: () => toggleConviction(p.id),
      })
    }
    if (canRedFlagHere) {
      const on = redFlagged.includes(p.id)
      const convict = convicted.includes(p.id)
      const full = !on && redFlagged.length >= MAX_RED_FLAGS
      const flaggable = isRedFlaggable(league, p.id)
      items.push({
        id: 'redflag',
        label: on ? 'Clear the red flag' : 'Red flag him',
        description: on
          ? 'Put him back on the board'
          : full
            ? `Red flags are full (${MAX_RED_FLAGS})`
            : convict
              ? 'He is a conviction call — a prospect can only be one'
              : !flaggable
                ? 'Only for prospects the league rates (top 64)'
                : 'Take him off your club’s board',
        icon: <Flag size={16} />,
        disabled: full || convict || (!on && !flaggable),
        onSelect: () => toggleRedFlag(p.id),
      })
    }
    return items
  }

  const columns: Column<DraftProspect>[] = [
    {
      key: 'name',
      label: 'Prospect',
      card: 'title',
      sortValue: (p) => p.name,
      render: (p) => {
        const r = reads.get(p.id)!
        return (
          <span className="block min-w-0">
            <span className="block truncate font-600 text-ink">{p.name}</span>
            <span className="block truncate text-small text-muted">
              {p.college} · {p.classYear}
              {!r.visible ? ` · ${r.region} (out of region)` : ''}
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
      headerTitle: 'Your rookie read on the NFL scale, separated from the college grade. Tightens as you scout and travel.',
      card: 'meta',
      sortValue: (p) => reads.get(p.id)?.center ?? 0,
      render: (p) => {
        const r = reads.get(p.id)!
        if (!r.visible) {
          return <span className="whitespace-nowrap rounded-[var(--r-xs)] bg-surface-3 px-1.5 py-1 font-cond text-small font-700 uppercase text-muted">OUT of region</span>
        }
        const rr = ranges.get(p.id)!
        return <RookieRangeBadges now={rr.now} ceiling={rr.ceiling} compact />
      },
    },
    {
      key: 'conf',
      label: 'Known',
      card: 'value',
      sortValue: (p) => reads.get(p.id)?.confidence ?? 0,
      render: (p) => {
        const r = reads.get(p.id)!
        return (
          <span className="flex items-center gap-2">
            <span className="w-9 font-cond text-small font-700 tnum text-ink-2">{r.confidence}%</span>
            <span className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-3">
              {r.visible && (
                <span className={cn('block h-full rounded-full', r.confidence >= 70 ? 'bg-win' : 'bg-warn')} style={{ width: `${r.confidence}%` }} />
              )}
            </span>
          </span>
        )
      },
    },
    {
      key: 'road',
      label: 'Road',
      card: 'value',
      sortValue: (p) => coverageOf(career, p.id),
      render: (p) => {
        const d = coverageOf(career, p.id)
        return (
          <span
            className="inline-flex items-center gap-0.5"
            title={d ? `Travel coverage ${d}/${MAX_TRAVEL_COVERAGE} — a tighter read` : 'No travel yet'}
          >
            {Array.from({ length: MAX_TRAVEL_COVERAGE }, (_, i) => (
              <span key={i} className={cn('h-2 w-2 rounded-[2px]', i < d ? 'bg-[var(--team-accent)]' : 'bg-surface-3')} />
            ))}
          </span>
        )
      },
    },
    {
      key: 'rec',
      label: 'Call',
      card: 'value',
      sortValue: (p) => p.recommendation ?? '',
      render: (p) =>
        p.recommendation ? (
          p.recommendation === 'Pass' ? (
            <Badge tone="neutral" className="text-muted">{p.recommendation}</Badge>
          ) : (
            <Badge tone="neutral">{p.recommendation}</Badge>
          )
        ) : (
          <Badge tone="neutral" className="text-muted">Ungraded</Badge>
        ),
    },
    {
      key: 'quick',
      label: 'Actions',
      align: 'right',
      card: 'aside',
      render: (p) => <OverflowMenu items={quickMenu(p)} label={`Quick actions for ${p.name}`} size="sm" />,
    },
  ]

  const selected = sorted.find((p) => p.id === selectedId) ?? pool.find((p) => p.id === selectedId) ?? null
  const convSelected = !!selected && convicted.includes(selected.id)
  const flagSelected = !!selected && redFlagged.includes(selected.id)
  const activeFilters = (pos !== 'ALL' ? 1 : 0) + (showAll ? 1 : 0)

  const posFilters = (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Position filter">
      {POS_FILTERS.map((p) => (
        <FilterChip key={p} pressed={pos === p} onChange={() => setPos(p)}>
          {p}
        </FilterChip>
      ))}
      {career.level < 2 && (
        <FilterChip pressed={showAll} onChange={setShowAll}>
          {showAll ? `All ${pool.length}` : `My region (${region})`}
        </FilterChip>
      )}
    </div>
  )

  return (
    <div>
      <PageHeader
        eyebrow={`${career.path === 'coach' ? 'Coaching' : 'Personnel'} Track · ${league.season} Draft Class`}
        title="Scouting Board"
        subtitle="Evaluating this year's draft class. Spend points to sharpen the range, then file your call."
        right={
          <Badge tone={points > 0 ? 'neutral' : 'warn'}>
            {points} / {MAX_SCOUT_POINTS} scouting points
          </Badge>
        }
      />

      <AccessBanner
        area="scouting"
        className="mb-4"
        message={
          scoutLevel === 'advise' ? (
            <>
              <b className="font-600 text-ink">You advise on this class.</b> Your calls and red flags are logged to your
              Ledger — the club weighs them against consensus.
            </>
          ) : (
            <>
              <b className="font-600 text-ink">You can read the board at this rung.</b> Scout prospects to sharpen the
              range, then file your call.
            </>
          )
        }
      />

      <KpiStrip label="Scouting summary" className="mb-4">
        <KpiTile
          label="Prospects"
          value={pool.length}
          unit="in the class"
          why={
            <span className="text-muted">
              {career.level < 2 ? `${region} region · ${outOfScope} out of scope` : 'National board'}
            </span>
          }
        />
        <KpiTile
          label="You've graded"
          value={graded}
          unit="calls filed"
          why={<span className="text-muted">One call per prospect · logged to your Ledger</span>}
        />
        <KpiTile
          label="Your hit rate"
          value={`${hitRate}%`}
          unit="of your calls"
          verdict={{ label: hitWord, tone: hitTone }}
          why={
            <span className="text-muted">
              {career.hits} hits · {career.misses} misses graded two seasons on
            </span>
          }
        />
        <KpiTile
          label="Reputation"
          value={overallRep(career.reputation)}
          unit="grade"
          why={<span className="text-muted max-sm:hidden">Drives your next job and who will listen</span>}
        />
      </KpiStrip>

      <WithInspector
        open={!!selected && wide}
        inspector={
          <Inspector
            open={!!selected}
            onClose={() => selectProspect(null)}
            eyebrow={selected ? `Scouting report · ${selected.pos}` : undefined}
            title={selected ? selected.name : ''}
            actions={
              selected && (
                <>
                  <Button
                    variant="secondary"
                    size="lg"
                    icon={<Search size={15} aria-hidden />}
                    disabled={locked || points <= 0}
                    title={locked ? 'Scouting is locked at this rung' : points <= 0 ? 'No scouting points left this week' : 'Spends 1 scouting point'}
                    onClick={() => scoutProspect(selected.id)}
                  >
                    Scout · {points} pts
                  </Button>
                  <Button
                    variant="secondary"
                    size="lg"
                    icon={<Phone size={15} aria-hidden />}
                    disabled={locked || charDoneOf(selected)}
                    title={charDoneOf(selected) ? 'Character fully uncovered' : 'Free · twice a week'}
                    onClick={() => investigateCharacter(selected.id)}
                  >
                    Character read
                  </Button>
                  {canConvictHere && (
                    <Button
                      variant="secondary"
                      size="lg"
                      className={convSelected ? 'text-win' : undefined}
                      icon={<Flame size={15} aria-hidden />}
                      onClick={() => toggleConviction(selected.id)}
                    >
                      {convSelected ? 'Un-pick conviction' : 'Pound the table'}
                    </Button>
                  )}
                  {canRedFlagHere && !convSelected && (
                    <Button
                      variant="secondary"
                      size="lg"
                      className={flagSelected ? 'text-warn' : undefined}
                      icon={<Flag size={15} aria-hidden />}
                      onClick={() => toggleRedFlag(selected.id)}
                    >
                      {flagSelected ? 'Clear red flag' : 'Red flag'}
                    </Button>
                  )}
                </>
              )
            }
          >
            {selected && <ProspectReport prospect={selected} />}
          </Inspector>
        }
      >
        <div className="flex flex-col gap-4">
          <Card pad={false} className="order-1 overflow-hidden lg:order-3">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5">
              <SectionTitle spacing="none">Class Board</SectionTitle>
              <div className="flex flex-wrap items-center gap-2">
                {canConvictHere && (
                  <Badge tone="win"><Flame size={11} /> Conviction {convicted.length}/{MAX_CONVICTION}</Badge>
                )}
                {canRedFlagHere && (
                  <Badge tone="warn"><Flag size={11} /> Red flags {redFlagged.length}/{MAX_RED_FLAGS}</Badge>
                )}
              </div>
            </div>

            <TierLegend className="border-b border-line px-4 py-2 max-sm:hidden" />

            {/* Position filter — inline chips on desktop, a sheet on phone. */}
            <div className="border-b border-line px-3 py-2 max-sm:hidden">{posFilters}</div>
            <div className="flex items-center gap-2 border-b border-line px-3 py-2 sm:hidden">
              <Button variant="secondary" size="sm" icon={<SlidersHorizontal size={15} aria-hidden />} onClick={() => setFiltersOpen(true)}>
                Filters{activeFilters ? ` (${activeFilters})` : ''}
              </Button>
              <span className="min-w-0 flex-1 truncate text-small text-muted">
                {sorted.length} of {pool.length} · by your read
              </span>
            </div>

            <div className="p-1 sm:p-0">
              <DataTable
                label="Class board"
                rows={sorted}
                columns={columns}
                rowKey={(p) => p.id}
                selectedKey={selectedId}
                onRowClick={(p) => selectProspect(selectedId === p.id ? null : p.id)}
                defaultSortKey="range"
                rank
                maxHeight="calc(100vh - 340px)"
                emptyText="No prospects match these filters."
              />
            </div>
          </Card>

          <CombineCard className="order-2 lg:order-1" />
          <ScoutTravelCard className="order-3 lg:order-2" />
        </div>
      </WithInspector>

      <Sheet open={phone && filtersOpen} onClose={() => setFiltersOpen(false)} eyebrow="Class board" title="Filters">
        {posFilters}
      </Sheet>
    </div>
  )
}

/** The full scouting report — the Inspector / bottom-sheet body. */
function ProspectReport({ prospect }: { prospect: DraftProspect }) {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const points = useGame((s) => s.scoutingPoints)
  const scoutProspect = useGame((s) => s.scoutProspect)
  const setRecommendation = useGame((s) => s.setRecommendation)
  const investigateCharacter = useGame((s) => s.investigateCharacter)

  const read = readProspect(career, prospect)
  const rr = readRookieRanges(career, prospect, league.draft)
  const level = accessFor(career, 'scouting')
  const canGrade = level !== 'locked'
  const showStaff = level === 'decide' || career.level >= 4

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <RookieRangeBadges now={rr.now} ceiling={rr.ceiling} className="mt-1" />
        <div className="min-w-0 flex-1">
          <div className="label text-[var(--team-accent-text)]">Your read · {read.bandLabel}</div>
          <div className="mt-1 font-cond text-small text-muted">
            {prospect.pos} · {prospect.college} · {prospect.classYear} · Age {prospect.age}
          </div>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-2">
        <div className="rounded-[var(--r-md)] border border-line px-3 py-2">
          <div className="label">Consensus</div>
          {read.consensus != null ? (
            <div className="mt-1">
              <RatingTile value={read.consensus} size="sm" college label="Consensus grade" />
            </div>
          ) : (
            <div className="mt-1 text-small text-muted">Hidden at your rung</div>
          )}
        </div>
        <div className="rounded-[var(--r-md)] border border-line px-3 py-2">
          <div className="label">Confidence</div>
          <div className="mt-1 font-display text-[22px] font-800 italic leading-none text-ink tnum">{read.confidence}%</div>
        </div>
      </section>

      {read.truth != null ? (
        <div className="broadcast rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-2.5">
          <div className="label mb-1.5 text-[var(--team-accent-text)]">Scout&rsquo;s truth</div>
          <div className="flex flex-wrap items-center gap-2 text-small text-ink">
            <Eye size={14} aria-hidden /> True grade
            <RatingTile value={read.truth} size="sm" college label="True grade" />
            <span className="text-muted">· Production {prospect.production}</span>
          </div>
        </div>
      ) : (
        <p className="rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-2.5 text-small text-muted">
          {read.consensus == null
            ? 'The true grade stays hidden at your rung. Scout him and trust the range.'
            : 'Keep scouting to sharpen the read — or rise high enough to see the truth.'}
        </p>
      )}

      {read.disagreement && <div className="rounded-[var(--r-md)] bg-warn-soft px-3 py-2 text-small text-warn">{read.disagreement}</div>}

      <div className="flex flex-wrap gap-1.5">
        {prospect.traits.map((t) => (
          <Badge key={t} tone="neutral">{t}</Badge>
        ))}
      </div>

      <div className="rounded-[var(--r-md)] border border-line px-3 py-2.5">
        <div className="label mb-1 flex items-center gap-1">
          <Star size={11} aria-hidden /> Area notes
        </div>
        <p className="text-small leading-relaxed text-ink-2">{prospect.notes}</p>
      </div>

      <Button
        variant="secondary"
        className="w-full"
        disabled={points <= 0 || level === 'locked'}
        onClick={() => scoutProspect(prospect.id)}
      >
        <Search size={15} aria-hidden /> Scout prospect ({points} pts left)
      </Button>

      <section className="rounded-[var(--r-md)] border border-line p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="label">Character · hidden</div>
          <span className="text-micro text-faint">talent, not makeup</span>
        </div>
        <div className="space-y-1.5">
          {CHARACTER_FACETS.map((f) => {
            const r = (prospect.characterReads ?? []).find((x) => x.facet === f)
            return (
              <div key={f} className="flex items-center justify-between gap-2 text-small">
                <span className="font-cond font-700 uppercase text-muted">{FACET_LABEL[f]}</span>
                {r ? (
                  <span className="flex items-center gap-1.5">
                    <Badge tone={f === 'offFieldRisk' ? (r.value > 55 ? 'loss' : r.value > 35 ? 'warn' : 'win') : r.value >= 70 ? 'win' : r.value >= 45 ? 'info' : 'warn'}>
                      {r.label}
                    </Badge>
                    <span className="text-micro text-faint">{r.confidence}% sure</span>
                  </span>
                ) : (
                  <span className="text-small text-faint">Unknown</span>
                )}
              </div>
            )
          })}
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="mt-2 w-full"
          disabled={level === 'locked' || (prospect.characterReads ?? []).length >= CHARACTER_FACETS.length}
          onClick={() => investigateCharacter(prospect.id)}
        >
          <Phone size={13} aria-hidden /> Character read
        </Button>
      </section>

      <section>
        <div className="label mb-2 flex items-center gap-1">
          <Target size={11} aria-hidden /> File recommendation
        </div>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Recommendation">
          {RECS.map((r) => {
            const on = prospect.recommendation === r.id
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={on}
                disabled={!canGrade}
                onClick={() => setRecommendation(prospect.id, r.id)}
                className={cn(
                  'motion rounded-[var(--r-md)] border px-2 py-2 font-cond text-small font-700 uppercase tracking-[0.05em] transition disabled:cursor-not-allowed disabled:opacity-40',
                  on ? 'border-line-strong bg-surface-3 text-ink' : cn('border-line hover:bg-surface-2', r.id === 'Pass' ? 'text-muted' : 'text-ink-2'),
                )}
              >
                {r.label}
              </button>
            )
          })}
        </div>
        <p className="mt-2 text-micro leading-snug text-muted">
          Blue Chip = Round 1 · Starter = Rounds 2-3 · Depth = Rounds 4-7 · Pass = Undrafted. Every call is logged to your Ledger.
        </p>
      </section>

      {showStaff && <StaffBoard teamId={career.teamId} prospectId={prospect.id} />}
    </div>
  )
}

const TRUST_OPTIONS: { id: 'fade' | 'normal' | 'lean'; label: string; title: string }[] = [
  { id: 'fade', label: 'Fade', title: 'Fade: weigh this report at ×0.5' },
  { id: 'normal', label: 'Normal', title: 'Normal: weigh this report at ×1' },
  { id: 'lean', label: 'Lean on', title: 'Lean on: weigh this report at ×2' },
]

function StaffBoard({ teamId, prospectId, className }: { teamId: string; prospectId: string; className?: string }) {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const setScoutTrust = useGame((s) => s.setScoutTrust)
  const evaluators = (league.staff[teamId] ?? []).filter(isEvaluator)
  const prospect = league.draft.find((p) => p.id === prospectId)
  if (!evaluators.length || !prospect) return null
  const canTrust = canSetTrust(career)
  const deptGrade = departmentGrade(league, career, prospect)
  return (
    <Card className={className}>
      <SectionTitle right={<span className="text-micro text-faint">their reports, not the truth</span>}>Staff Board</SectionTitle>
      {canTrust && (
        <div className="mb-2 flex items-center justify-between rounded-[var(--r-md)] bg-surface-2 px-2.5 py-1.5">
          <span className="font-cond text-small font-700 uppercase tracking-wide text-muted">Department grade</span>
          {deptGrade != null ? (
            <RatingTile value={deptGrade} size="xs" college label="Department grade" />
          ) : (
            <span className="text-small text-muted">—</span>
          )}
        </div>
      )}
      <div className="space-y-2">
        {evaluators.map((m) => {
          const learned = learnedBias(m)
          const grade = scoutReport(m, prospect)
          const trust = career.scoutTrust?.[m.id] ?? 'normal'
          return (
            <div key={m.id} className="flex items-center gap-3 text-small">
              <div className="min-w-0 flex-1">
                <div className="truncate font-600 text-ink">{m.name}</div>
                <div className="truncate text-micro text-muted">
                  {m.role}
                  {learned.label ? ` · ${learned.label}` : learned.samples ? ` · ${learned.samples} calls` : ' · no history yet'}
                </div>
              </div>
              {canTrust && (
                <div className="flex items-center gap-1" role="group" aria-label={`Trust in ${m.name}`}>
                  {TRUST_OPTIONS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      title={t.title}
                      aria-pressed={trust === t.id}
                      onClick={() => setScoutTrust(m.id, t.id)}
                      className={cn(
                        'motion rounded-[var(--r-xs)] border px-1.5 py-1 font-cond text-micro font-700 uppercase tracking-[0.05em] transition',
                        trust === t.id ? 'border-line-strong bg-surface-3 text-ink' : 'border-line text-muted hover:bg-surface-2',
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
              <RatingTile value={grade} size="sm" college label={`${m.name}'s report`} />
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-micro leading-snug text-muted">
        Bias is learned from their Ledger over seasons. Read it and you'll know whose grades to shade up or down.
      </p>
    </Card>
  )
}

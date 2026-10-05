import { useMemo, useState, useEffect } from 'react'
import { Eye, Phone, Search, Star, Target, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { gradeColor } from '../lib/format'
import type { DraftProspect, Recommendation } from '../game/types'
import { ensureProspectPools } from '../game/engine/progress'
import { readProspect, rangeText, scoutRegion, inProspectScope } from '../game/engine/evaluation'
import { accessFor } from '../game/engine/access'
import { CHARACTER_FACETS, FACET_LABEL } from '../game/engine/character'
import { isEvaluator, learnedBias, scoutReport } from '../game/engine/scoutBias'
import { MAX_SCOUT_POINTS, useGame, useWorld } from '../store/gameStore'
import { overallRep } from '../game/engine/career'
import { AccessBadge } from '../components/AccessBadge'
import { DataTable, type Column } from '../components/DataTable'
import { Badge, Button, Card, PageHeader, Stat } from '../ui/kit'

const POS_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'OT', 'OG', 'C', 'DE', 'DT', 'LB', 'CB', 'S']
const RECS: { id: Recommendation; label: string; tone: 'win' | 'info' | 'warn' | 'loss' }[] = [
  { id: 'Blue Chip', label: 'Blue Chip', tone: 'win' },
  { id: 'Starter', label: 'Starter', tone: 'info' },
  { id: 'Depth', label: 'Depth', tone: 'warn' },
  { id: 'Pass', label: 'Pass', tone: 'loss' },
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
  const [pos, setPos] = useState('ALL')
  const [showAll, setShowAll] = useState(false)

  const pool = league.draft
  const region = scoutRegion(career)
  const outOfScope = pool.filter((p) => !inProspectScope(career, p)).length

  const scoped = useMemo(() => {
    const base = showAll ? pool : pool.filter((p) => inProspectScope(career, p))
    return base.filter((p) => pos === 'ALL' || p.pos === pos)
  }, [pool, career, pos, showAll])

  const reads = useMemo(() => new Map(scoped.map((p) => [p.id, readProspect(career, p)])), [scoped, career])
  const sorted = useMemo(
    () => [...scoped].sort((a, b) => (reads.get(b.id)?.center ?? 0) - (reads.get(a.id)?.center ?? 0)),
    [scoped, reads],
  )

  const graded = pool.filter((p) => p.recommendation).length

  const columns: Column<DraftProspect>[] = [
    {
      key: 'range',
      label: 'Read',
      className: 'w-20',
      sortValue: (p) => reads.get(p.id)?.center ?? 0,
      render: (p) => {
        const r = reads.get(p.id)!
        if (!r.visible) {
          return <span className="grid h-7 w-14 place-items-center rounded-md bg-surface-3 font-cond text-[11px] font-700 text-muted">OUT</span>
        }
        return (
          <span className="grid h-7 w-16 place-items-center rounded-md font-display text-xs font-700 tnum" style={{ background: gradeColor(r.center), color: '#fff' }}>
            {rangeText(r)}
          </span>
        )
      },
    },
    { key: 'pos', label: 'Pos', className: 'w-12', sortValue: (p) => p.pos, render: (p) => <span className="font-cond text-[11px] font-700 uppercase text-muted">{p.pos}</span> },
    {
      key: 'name',
      label: 'Prospect',
      className: 'min-w-[180px]',
      sortValue: (p) => p.name,
      render: (p) => {
        const r = reads.get(p.id)!
        return (
          <div className="min-w-0">
            <div className="truncate font-600 text-ink">{p.name}</div>
            <div className="truncate text-[11px] text-muted">
              {p.college} · {p.classYear}{!r.visible ? ` · ${r.region} (out of region)` : ''}
            </div>
          </div>
        )
      },
    },
    {
      key: 'conf',
      label: 'Known',
      className: 'w-28',
      sortValue: (p) => reads.get(p.id)?.confidence ?? 0,
      render: (p) => {
        const r = reads.get(p.id)!
        return (
          <div className="flex items-center gap-2">
            <span className="w-8 font-cond text-xs font-700 tnum text-ink-2">{r.confidence}%</span>
            <div className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-3">
              {r.visible && <div className="h-full rounded-full" style={{ width: `${r.confidence}%`, background: r.confidence > 70 ? '#05914f' : '#d98207' }} />}
            </div>
          </div>
        )
      },
    },
    {
      key: 'rec',
      label: 'Call',
      className: 'w-24',
      sortValue: (p) => p.recommendation ?? '',
      render: (p) =>
        p.recommendation ? (
          <Badge tone={RECS.find((x) => x.id === p.recommendation)?.tone ?? 'neutral'}>{p.recommendation}</Badge>
        ) : (
          <Badge tone="neutral">Ungraded</Badge>
        ),
    },
    {
      key: 'quick',
      label: 'Quick',
      className: 'w-28',
      render: (p) => {
        const locked = scoutLevel === 'locked'
        const noPts = points <= 0
        const charDone = !p.character || (p.characterReads ?? []).length >= CHARACTER_FACETS.length
        return (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              title={locked ? 'Scouting is locked at this rung' : noPts ? 'No scouting points left this week' : 'Scout prospect (1 pt)'}
              disabled={locked}
              onClick={() => scoutProspect(p.id)}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-1.5 py-1 font-cond text-[10px] font-700 uppercase tracking-wide transition',
                locked || noPts
                  ? 'border-line text-faint opacity-60'
                  : 'border-line text-ink-2 hover:border-[var(--team)] hover:bg-[var(--team-soft)]',
              )}
            >
              <Search size={11} /> Scout
            </button>
            <button
              type="button"
              title={locked ? 'Scouting is locked at this rung' : charDone ? 'Character fully uncovered' : 'Work the phones (1 pt)'}
              disabled={locked || charDone}
              onClick={() => investigateCharacter(p.id)}
              className={cn(
                'grid h-6 w-6 place-items-center rounded-md border transition',
                locked || charDone || noPts
                  ? 'border-line text-faint opacity-60'
                  : 'border-line text-ink-2 hover:border-[var(--team)] hover:bg-[var(--team-soft)]',
              )}
            >
              <Phone size={11} />
            </button>
          </div>
        )
      },
    },
  ]

  return (
    <div>
      <PageHeader
        eyebrow={`${career.path === 'coach' ? 'Coaching' : 'Personnel'} Track · ${league.season} Draft Class`}
        title="Scouting Board"
        subtitle="Evaluating the draft class — college players leaving for the NFL. Spend points to sharpen the range, then file your call."
        right={
          <div className="flex items-center gap-2">
            <AccessBadge area="scouting" />
            <Badge tone={points > 0 ? 'team' : 'loss'}>
              {points} / {MAX_SCOUT_POINTS} scouting points
            </Badge>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><Stat label="Prospects" value={pool.length} sub={career.level < 2 ? `${region} region · ${outOfScope} out of scope` : 'national board'} /></Card>
        <Card><Stat label="You've Graded" value={graded} sub="calls filed" /></Card>
        <Card>
          <Stat label="Your Hit Rate" value={`${career.hits + career.misses ? Math.round((career.hits / (career.hits + career.misses)) * 100) : 0}%`} sub={`${career.hits} hits`} tone="win" />
        </Card>
        <Card><Stat label="Reputation" value={overallRep(career.reputation)} sub="drives your next job" /></Card>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1">
        {POS_FILTERS.map((p) => (
          <button
            key={p}
            onClick={() => setPos(p)}
            className={cn(
              'rounded-md px-2.5 py-1 font-cond text-xs font-700 uppercase transition',
              pos === p ? 'text-[var(--team-ink)]' : 'bg-surface text-muted hover:bg-surface-2',
            )}
            style={pos === p ? { background: 'var(--team)' } : undefined}
          >
            {p}
          </button>
        ))}
        {career.level < 2 && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="ml-auto rounded-md border border-line px-2.5 py-1 font-cond text-xs font-700 uppercase text-muted hover:bg-surface-2"
          >
            {showAll ? `Showing all ${pool.length}` : `My region (${region})`}
          </button>
        )}
      </div>

      <Card pad={false} className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <span className="label">Class Board · by your read</span>
          <span className="text-[10px] text-faint">click a row to open the report · click a column to sort · quick buttons scout in place</span>
        </div>
        <DataTable
          rows={sorted}
          columns={columns}
          rowKey={(p) => p.id}
          selectedKey={selectedId}
          expandedKey={selectedId}
          renderExpanded={(p) => <ProspectDetail prospect={p} />}
          onRowClick={(p) => selectProspect(selectedId === p.id ? null : p.id)}
          defaultSortKey="range"
          rank
          maxHeight="calc(100vh - 340px)"
          emptyText="No prospects match these filters."
        />
      </Card>
    </div>
  )
}

/** The full scouting report, rendered inline beneath the clicked row. */
function ProspectDetail({ prospect: open }: { prospect: DraftProspect }) {
  const career = useGame((s) => s.career)!
  const points = useGame((s) => s.scoutingPoints)
  const scoutProspect = useGame((s) => s.scoutProspect)
  const setRecommendation = useGame((s) => s.setRecommendation)
  const investigateCharacter = useGame((s) => s.investigateCharacter)
  const selectProspect = useGame((s) => s.selectProspect)

  const read = readProspect(career, open)
  const level = accessFor(career, 'scouting')
  const canGrade = level !== 'locked'
  const showStaff = level === 'decide' || career.level >= 4

  return (
    <div className="border-l-4 border-[var(--team)] bg-surface p-4">
      <div className="flex items-start gap-3">
        <div
          className="grid h-16 w-16 shrink-0 place-items-center rounded-md font-display text-lg font-700 tnum"
          style={{ background: gradeColor(read.center), color: '#fff' }}
        >
          {rangeText(read)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="label mb-0.5">Your Read · {read.bandLabel}</div>
          <h3 className="truncate font-display text-2xl font-700 uppercase leading-none text-ink">{open.name}</h3>
          <div className="mt-1 font-cond text-sm text-muted">
            {open.pos} · {open.college} · {open.classYear} · Age {open.age}
          </div>
        </div>
        <button
          onClick={() => selectProspect(null)}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink"
          title="Close report"
        >
          <X size={16} />
        </button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div>
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Your Range" value={rangeText(read)} />
            <MiniStat label="Consensus" value={read.consensus ?? '—'} />
            <MiniStat label="Confidence" value={`${read.confidence}%`} />
          </div>

          {read.truth != null ? (
            <div className="mt-3 rounded-lg bg-[#101820] p-3 text-white">
              <div className="label mb-1 !text-white/60">Scout's Truth</div>
              <div className="flex items-center gap-2 text-sm">
                <Eye size={14} /> True grade: <strong className="font-700">{read.truth}</strong> · Production {open.production}
              </div>
            </div>
          ) : (
            <p className="mt-3 rounded-lg bg-surface-2 p-3 text-xs text-muted">
              {read.consensus == null
                ? 'The true grade stays hidden at your rung. Scout him and trust the range.'
                : 'Keep scouting to sharpen the read — or rise high enough to see the truth.'}
            </p>
          )}

          {read.disagreement && <div className="mt-2 rounded-lg bg-[#fdf0dc] p-2.5 text-xs text-warn">{read.disagreement}</div>}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {open.traits.map((t) => <Badge key={t} tone="team">{t}</Badge>)}
          </div>

          <div className="mt-3 rounded-lg bg-surface-2 p-3">
            <div className="label mb-1 flex items-center gap-1"><Star size={11} /> Area Notes</div>
            <p className="text-sm leading-relaxed text-ink-2">{open.notes}</p>
          </div>

          <Button
            variant="team"
            className="mt-4 w-full"
            disabled={points <= 0 || level === 'locked'}
            onClick={() => scoutProspect(open.id)}
          >
            <Search size={15} /> Scout Prospect ({points} pts left)
          </Button>
        </div>

        <div>
          <div className="rounded-lg border border-line p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="label">Character · hidden</div>
              <span className="text-[10px] text-faint">filter shows talent, not makeup</span>
            </div>
            <div className="space-y-1.5">
              {CHARACTER_FACETS.map((f) => {
                const r = (open.characterReads ?? []).find((x) => x.facet === f)
                return (
                  <div key={f} className="flex items-center justify-between text-xs">
                    <span className="font-cond font-700 uppercase text-muted">{FACET_LABEL[f]}</span>
                    {r ? (
                      <span className="flex items-center gap-1.5">
                        <Badge tone={f === 'offFieldRisk' ? (r.value > 55 ? 'loss' : r.value > 35 ? 'warn' : 'win') : (r.value >= 70 ? 'win' : r.value >= 45 ? 'info' : 'warn')}>
                          {r.label}
                        </Badge>
                        <span className="text-[10px] text-faint">{r.confidence}% sure</span>
                      </span>
                    ) : (
                      <span className="text-faint">Unknown</span>
                    )}
                  </div>
                )
              })}
            </div>
            <Button
              size="sm"
              className="mt-2 w-full"
              disabled={points <= 0 || (open.characterReads ?? []).length >= CHARACTER_FACETS.length}
              onClick={() => investigateCharacter(open.id)}
            >
              <Phone size={13} /> Work the phones (1 pt)
            </Button>
          </div>

          <div className="mt-3">
            <div className="label mb-2 flex items-center gap-1"><Target size={11} /> File Recommendation</div>
            <div className="grid grid-cols-2 gap-2">
              {RECS.map((r) => (
                <button
                  key={r.id}
                  disabled={!canGrade}
                  onClick={() => setRecommendation(open.id, r.id)}
                  className={cn(
                    'rounded-lg border px-2 py-2 font-cond text-xs font-700 uppercase tracking-wide transition disabled:opacity-40',
                    open.recommendation === r.id ? 'border-transparent bg-ink text-white' : 'border-line hover:bg-surface-2',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted">
              Blue Chip = Round 1 · Starter = Rounds 2-3 · Depth = Rounds 4-7 · Pass = Undrafted. Every call is logged to your Ledger.
            </p>
          </div>

          {showStaff && <StaffBoard teamId={career.teamId} prospectId={open.id} className="mt-3" />}
        </div>
      </div>
    </div>
  )
}

function StaffBoard({ teamId, prospectId, className }: { teamId: string; prospectId: string; className?: string }) {
  const league = useWorld()
  const evaluators = (league.staff[teamId] ?? []).filter(isEvaluator)
  const prospect = league.draft.find((p) => p.id === prospectId)
  if (!evaluators.length || !prospect) return null
  return (
    <Card className={className}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">Staff Board</h3>
        <span className="text-[10px] text-faint">their reports, not the truth</span>
      </div>
      <div className="space-y-2">
        {evaluators.map((m) => {
          const learned = learnedBias(m)
          const grade = scoutReport(m, prospect)
          return (
            <div key={m.id} className="flex items-center gap-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-600 text-ink">{m.name}</div>
                <div className="truncate text-[11px] text-muted">
                  {m.role}
                  {learned.label ? ` · ${learned.label}` : learned.samples ? ` · ${learned.samples} calls` : ' · no history yet'}
                </div>
              </div>
              <span className="grid h-8 w-10 place-items-center rounded-md font-display text-sm font-700 tnum" style={{ background: gradeColor(grade), color: '#fff' }}>
                {grade}
              </span>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-muted">
        Bias is learned from their Ledger over seasons. Read it and you'll know whose grades to shade up or down.
      </p>
    </Card>
  )
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-line py-1.5 text-center">
      <div className="label !text-[9px]">{label}</div>
      <div className="font-display text-lg font-700 tnum text-ink">{value}</div>
    </div>
  )
}

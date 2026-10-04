import { useState } from 'react'
import { Eye, Search, Star, Target } from 'lucide-react'
import { cn } from '../lib/cn'
import { gradeColor } from '../lib/format'
import type { Recommendation } from '../game/types'
import { MAX_SCOUT_POINTS, useGame, useWorld } from '../store/gameStore'
import { overallRep } from '../game/engine/career'
import { Badge, Button, Card, PageHeader, RatingBar, Stat } from '../ui/kit'

const POS_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'OT', 'OG', 'C', 'DE', 'DT', 'LB', 'CB', 'S']
const RECS: { id: Recommendation; label: string; tone: 'win' | 'info' | 'warn' | 'loss' }[] = [
  { id: 'Blue Chip', label: 'Blue Chip', tone: 'win' },
  { id: 'Starter', label: 'Starter', tone: 'info' },
  { id: 'Depth', label: 'Depth', tone: 'warn' },
  { id: 'Pass', label: 'Pass', tone: 'loss' },
]

export function Scouting() {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const points = useGame((s) => s.scoutingPoints)
  const scoutProspect = useGame((s) => s.scoutProspect)
  const setRecommendation = useGame((s) => s.setRecommendation)
  const selectedId = useGame((s) => s.selectedProspectId)
  const selectProspect = useGame((s) => s.selectProspect)
  const [pos, setPos] = useState('ALL')

  const prospects = league.draft
    .filter((p) => pos === 'ALL' || p.pos === pos)
    .sort((a, b) => b.grade - a.grade)
  const open = selectedId ? league.draft.find((p) => p.id === selectedId) ?? null : prospects[0]

  const graded = league.draft.filter((p) => p.recommendation).length

  return (
    <div>
      <PageHeader
        eyebrow={`${career.path === 'coach' ? 'Coaching' : 'Personnel'} Track · ${league.season} Class`}
        title="Scouting Board"
        subtitle="Spend scouting points to get to know a prospect, then file your recommendation. Season's end grades your eye."
        right={
          <div className="flex items-center gap-2">
            <Badge tone={points > 0 ? 'team' : 'loss'}>
              {points} / {MAX_SCOUT_POINTS} scouting points
            </Badge>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><Stat label="Prospects" value={league.draft.length} sub="this cycle" /></Card>
        <Card><Stat label="You've Graded" value={graded} sub="recommendations filed" /></Card>
        <Card>
          <Stat label="Your Hit Rate" value={`${career.hits + career.misses ? Math.round((career.hits / (career.hits + career.misses)) * 100) : 0}%`} sub={`${career.hits} hits`} tone="win" />
        </Card>
        <Card><Stat label="Reputation" value={overallRep(career.reputation)} sub="drives your next job" /></Card>
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
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
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <Card pad={false}>
          <div className="border-b border-line px-4 py-2">
            <span className="label">Class Board</span>
          </div>
          <div className="max-h-[620px] divide-y divide-line/60 overflow-y-auto">
            {prospects.map((p, i) => {
              const shown = p.myGrade ?? p.grade
              return (
                <button
                  key={p.id}
                  onClick={() => selectProspect(p.id)}
                  className={cn(
                    'flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-surface-2',
                    open?.id === p.id && 'bg-[var(--team-soft)]',
                  )}
                >
                  <span className="w-6 font-display text-base font-700 tnum text-faint">{i + 1}</span>
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-md font-display text-base font-700"
                    style={{ background: gradeColor(shown), color: '#fff' }}
                  >
                    {shown}
                  </span>
                  <span className="w-9 font-cond text-[11px] font-700 uppercase text-muted">{p.pos}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-600 text-ink">{p.name}</span>
                    <span className="block truncate text-xs text-muted">{p.college} · {p.classYear}</span>
                  </span>
                  <div className="hidden w-20 sm:block">
                    <div className="mb-1 text-right font-cond text-[9px] font-700 uppercase text-muted">
                      {Math.round(p.confidence)}% known
                    </div>
                    <RatingBar value={p.confidence} height={4} color={p.confidence > 70 ? '#05914f' : '#d98207'} />
                  </div>
                  {p.recommendation ? (
                    <Badge tone={RECS.find((r) => r.id === p.recommendation)?.tone ?? 'neutral'}>{p.recommendation}</Badge>
                  ) : (
                    <Badge tone="neutral">Ungraded</Badge>
                  )}
                </button>
              )
            })}
          </div>
        </Card>

        {open && (
          <Card className="sticky top-2 self-start">
            <div className="flex items-start gap-3">
              <div
                className="grid h-16 w-16 shrink-0 place-items-center rounded-xl font-display text-2xl font-700"
                style={{ background: gradeColor(open.myGrade ?? open.grade), color: '#fff' }}
              >
                {open.myGrade ?? open.grade}
              </div>
              <div className="min-w-0">
                <div className="label mb-0.5">Scouting Report</div>
                <h3 className="truncate font-display text-2xl font-700 uppercase leading-none text-ink">{open.name}</h3>
                <div className="mt-1 font-cond text-sm text-muted">
                  {open.pos} · {open.college} · {open.classYear} · Age {open.age}
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <MiniStat label="Consensus" value={open.grade} />
              <MiniStat label="Your Grade" value={open.myGrade ?? '—'} />
              <MiniStat label="Confidence" value={`${Math.round(open.confidence)}%`} />
            </div>

            {open.confidence >= 70 ? (
              <div className="mt-3 rounded-lg bg-surface-2 p-3">
                <div className="label mb-1">Scout's Truth</div>
                <div className="flex items-center gap-2 text-sm text-ink-2">
                  <Eye size={14} /> True grade: <strong className="font-700">{open.trueGrade}</strong> · Production {open.production}
                </div>
              </div>
            ) : (
              <p className="mt-3 rounded-lg bg-surface-2 p-3 text-xs text-muted">
                Keep scouting to sharpen your read. At 70% confidence the true grade is revealed.
              </p>
            )}

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
              disabled={points <= 0}
              onClick={() => scoutProspect(open.id)}
            >
              <Search size={15} /> Scout Prospect ({points} pts left)
            </Button>

            <div className="mt-4">
              <div className="label mb-2 flex items-center gap-1"><Target size={11} /> File Recommendation</div>
              <div className="grid grid-cols-2 gap-2">
                {RECS.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setRecommendation(open.id, r.id)}
                    className={cn(
                      'rounded-lg border px-2 py-2 font-cond text-xs font-700 uppercase tracking-wide transition',
                      open.recommendation === r.id ? 'border-transparent bg-ink text-white' : 'border-line hover:bg-surface-2',
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted">
                Blue Chip = Round 1 · Starter = Rounds 2-3 · Depth = Rounds 4-7 · Pass = Undrafted
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
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

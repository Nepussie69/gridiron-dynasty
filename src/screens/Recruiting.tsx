import { useState } from 'react'
import { Star } from 'lucide-react'
import { cn } from '../lib/cn'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card, PageHeader, RatingBar, Stat } from '../ui/kit'

const POS_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'OT', 'OG', 'C', 'DE', 'DT', 'LB', 'CB', 'S']

function starsFor(grade: number) {
  if (grade >= 92) return 5
  if (grade >= 85) return 4
  if (grade >= 78) return 3
  if (grade >= 70) return 2
  return 1
}

function commitOdds(id: string, prestige: number) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return Math.max(3, Math.min(94, Math.round(((h % 100) + prestige) / 2)))
}

export function Recruiting() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const showToast = useGame((s) => s.showToast)
  const team = league.byId[activeTeamId]

  const [pos, setPos] = useState('ALL')
  const [committed, setCommitted] = useState<string[]>([])

  const recruits = league.draft
    .filter((p) => pos === 'ALL' || p.pos === pos)
    .sort((a, b) => b.grade - a.grade)

  const nilBudget = 3.5 // $M
  const used = committed.reduce((s, id) => s + (league.draft.find((d) => d.id === id)?.grade ?? 0) / 100, 0)

  return (
    <div>
      <PageHeader
        eyebrow={`${team.conference} · Recruiting`}
        title="Recruiting Board"
        subtitle="Win the living room. NIL budget, official visits, and program prestige decide the roster of tomorrow."
        right={<Button variant="team" onClick={() => showToast('Visit weekend scheduled. The staff is hitting the road.')}>Schedule Visits</Button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><Stat label="Commits" value={committed.length} sub="this class" /></Card>
        <Card><Stat label="NIL Budget" value={`$${nilBudget.toFixed(1)}M`} sub={`$${used.toFixed(2)}M pledged`} /></Card>
        <Card><Stat label="5-Star Targets" value={league.draft.filter((p) => starsFor(p.grade) === 5).length} sub="nation's elite" /></Card>
        <Card><Stat label="Class Rank" value="#14" sub="national" /></Card>
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

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {recruits.map((r) => {
          const stars = starsFor(r.grade)
          const odds = commitOdds(r.id, team.prestige)
          const isCommitted = committed.includes(r.id)
          return (
            <Card key={r.id} className={cn(isCommitted && 'ring-2 ring-[var(--team)]')}>
              <div className="flex items-start gap-3">
                <div
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-lg font-display text-xl font-700"
                  style={{ background: 'var(--team)', color: 'var(--team-ink)' }}
                >
                  {r.ovr}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-lg font-700 uppercase leading-none text-ink">
                    {r.name}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Badge tone="team">{r.pos}</Badge>
                    <span className="flex">
                      {Array.from({ length: 5 }, (_, i) => (
                        <Star
                          key={i}
                          size={12}
                          className={i < stars ? 'text-gold' : 'text-line-strong'}
                          fill={i < stars ? '#c99a2e' : 'none'}
                        />
                      ))}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs text-muted">
                <span>{r.college}</span>
                <span>Grade {r.grade} · Ceiling {r.pot}</span>
              </div>

              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="label">Commit Probability</span>
                  <span className="font-cond text-xs font-700 tnum text-ink-2">{odds}%</span>
                </div>
                <RatingBar
                  value={odds}
                  color={odds > 60 ? '#05914f' : odds > 35 ? '#d98207' : '#dc2937'}
                />
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span className="font-cond text-xs text-muted">NIL ask ${(r.grade / 40).toFixed(2)}M</span>
                {isCommitted ? (
                  <Badge tone="win">Committed!</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="team"
                    onClick={() => {
                      setCommitted((c) => [...c, r.id])
                      showToast(`${r.name} commits to ${team.name}!`)
                    }}
                  >
                    Push
                  </Button>
                )}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

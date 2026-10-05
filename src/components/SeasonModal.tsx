import { ArrowRight, Award, Fingerprint, Ghost, HelpCircle, Target, Trophy, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
import { ladderFor, tierFor } from '../game/engine/career'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card, TeamCrest } from '../ui/kit'

export function SeasonModal() {
  const league = useWorld()
  const modal = useGame((s) => s.modal)
  const summary = useGame((s) => s.summary)
  const offers = useGame((s) => s.offers)
  const career = useGame((s) => s.career)
  const dismiss = useGame((s) => s.dismissModal)
  const acceptOffer = useGame((s) => s.acceptOffer)
  const decline = useGame((s) => s.declineOffers)

  if (modal === 'none') return null

  if (modal === 'seasonReview' && summary) {
    const champ = summary.champion ? league.byId[summary.champion] : null
    const scout = summary.scout
    return (
      <Shell onClose={dismiss}>
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-gold/20 text-gold" style={{ background: '#fbf3de' }}>
            <Trophy size={22} className="text-[#9a7418]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="label">Season Complete · {summary.season}</div>
            <h2 className="font-display text-3xl font-700 uppercase leading-none">
              {summary.headline ?? `${summary.season} Review`}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{summary.record}</Badge>
              {typeof summary.winsDelta === 'number' && (
                <Badge tone={summary.winsDelta >= 0 ? 'win' : 'loss'}>
                  {summary.winsDelta >= 0 ? '+' : ''}
                  {summary.winsDelta} wins vs last year
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* #20: the season in 90 seconds — question, moments, fingerprints, ghost. */}
        {summary.question && (
          <Card className="mb-3">
            <div className="label mb-1 flex items-center gap-1">
              <HelpCircle size={12} /> The season question
            </div>
            <div className="font-display text-lg font-700 uppercase leading-snug text-ink">
              {summary.question.text}
            </div>
            {summary.question.answer && (
              <p className={cn('mt-1.5 text-sm', summary.question.good ? 'text-win' : 'text-muted')}>
                {summary.question.answer}
              </p>
            )}
          </Card>
        )}

        {summary.ambitions && summary.ambitions.length > 0 && (
          <Card className="mb-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="label flex items-center gap-1">
                <Target size={12} /> Your ambitions
              </div>
              <Badge tone={summary.ambitions.every((a) => a.done) ? 'win' : 'neutral'}>
                {summary.ambitions.filter((a) => a.done).length}/{summary.ambitions.length} met
              </Badge>
            </div>
            <div className="space-y-1.5">
              {summary.ambitions.map((a) => (
                <div key={a.label} className="flex items-center gap-2 text-xs">
                  <span
                    className={cn(
                      'grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px]',
                      a.done ? 'bg-win text-white' : 'bg-surface-3 text-faint',
                    )}
                  >
                    {a.done ? '✓' : ''}
                  </span>
                  <span className={cn('flex-1 font-600', a.done ? 'text-ink' : 'text-muted')}>{a.label}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {summary.moments && summary.moments.length > 0 && (
          <Card className="mb-3">
            <div className="label mb-2">Three moments that mattered</div>
            <div className="space-y-1.5">
              {summary.moments.map((m) => (
                <div key={`${m.week}-${m.text}`} className="flex items-center gap-2 text-xs">
                  <span className="grid h-5 w-8 shrink-0 place-items-center rounded bg-surface-2 font-cond text-[10px] font-700 text-muted">
                    W{m.week}
                  </span>
                  <span className={cn('flex-1 font-600', m.tone === 'loss' ? 'text-muted' : 'text-ink-2')}>{m.text}</span>
                  {m.tone === 'win' && <Badge tone="win">W</Badge>}
                  {m.tone === 'loss' && <Badge tone="loss">L</Badge>}
                </div>
              ))}
            </div>
          </Card>
        )}

        {summary.fingerprint && summary.fingerprint.total > 0 && (
          <Card className="mb-3">
            <div className="label mb-1 flex items-center gap-1">
              <Fingerprint size={12} /> Your fingerprints
            </div>
            <p className="text-sm text-ink-2">
              <strong className="text-ink">{summary.fingerprint.drafted}</strong> drafted and{' '}
              <strong className="text-ink">{summary.fingerprint.signed}</strong> signed by you are on this roster.
              This season is partly yours.
            </p>
          </Card>
        )}

        {summary.ghost && (
          <Card className="mb-3">
            <div className="label mb-1 flex items-center gap-1">
              <Ghost size={12} /> Ghost GM verdict
            </div>
            <div className="font-display text-2xl font-700 tnum text-ink">
              {summary.ghost.delta >= 0 ? '+' : ''}
              {summary.ghost.delta.toFixed(1)} wins over replacement
            </div>
            <p className="mt-0.5 text-xs text-muted">
              You won {summary.ghost.actualWins}; a replacement-level manager projects to{' '}
              {summary.ghost.ghostWins} with the same roster and schedule.
            </p>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Card>
            <div className="label mb-2">Super Bowl Champion</div>
            {champ ? (
              <div className="flex items-center gap-2">
                <TeamCrest team={champ} size={34} />
                <span className="font-display text-lg font-700 uppercase">{champ.name}</span>
              </div>
            ) : (
              <span className="text-sm text-muted">—</span>
            )}
          </Card>
        </div>

        <Card className="mt-3">
          <div className="label mb-1 flex items-center gap-1"><Award size={12} /> League MVP</div>
          <div className="font-display text-xl font-700 uppercase">{summary.mvp ?? '—'}</div>
        </Card>

        {summary.objectives && summary.objectives.length > 0 && (
          <Card className="mt-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="label">Season Objectives</div>
              <Badge tone={summary.objectivesDone ? 'win' : 'neutral'}>
                {summary.objectivesDone}/{summary.objectives.length} met
              </Badge>
            </div>
            <div className="space-y-1.5">
              {summary.objectives.map((o) => (
                <div key={o.id} className="flex items-center gap-2 text-xs">
                  <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded-full', o.done ? 'bg-win text-white' : 'bg-surface-3 text-faint')}>
                    {o.done ? '✓' : ''}
                  </span>
                  <span className="flex-1 font-600 text-ink-2">{o.label}</span>
                  <span className={cn('font-cond font-700 tnum', o.done ? 'text-win' : 'text-muted')}>
                    {o.current}/{o.target}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {scout && (
          <Card className="mt-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="label">Your Scouting Report Card</div>
              <Badge tone={scout.repDelta >= 0 ? 'win' : 'loss'}>
                Reputation {scout.repDelta >= 0 ? '+' : ''}{scout.repDelta}
              </Badge>
            </div>
            {scout.graded === 0 ? (
              <p className="text-sm text-muted">You filed no recommendations this cycle.</p>
            ) : (
              <>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <MiniStat label="Graded" value={scout.graded} />
                  <MiniStat label="Hits" value={scout.hits} tone="win" />
                  <MiniStat label="Misses" value={scout.misses} tone="loss" />
                  <MiniStat label="Accuracy" value={`${scout.accuracy}%`} />
                </div>
                <div className="mt-3 max-h-[200px] space-y-1 overflow-y-auto">
                  {scout.details.slice(0, 12).map((d) => (
                    <div key={d.name} className="flex items-center gap-2 rounded-md border border-line px-2 py-1.5 text-xs">
                      <span className={cn('h-2 w-2 rounded-full', d.hit ? 'bg-win' : 'bg-loss')} />
                      <span className="w-24 truncate font-600 text-ink">{d.name}</span>
                      <Badge tone="neutral">{d.rec}</Badge>
                      <span className="ml-auto text-muted">{d.note}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
        )}

        <Button variant="primary" size="lg" className="mt-4 w-full" onClick={dismiss}>
          {offers.length ? `Review ${offers.length} job offer${offers.length > 1 ? 's' : ''}` : 'Continue'}
          <ArrowRight size={15} />
        </Button>
      </Shell>
    )
  }

  if (modal === 'offers') {
    const current = career ? tierFor(career.path, career.level).title : ''
    return (
      <Shell onClose={decline}>
        <div className="mb-4">
          <div className="label">Offseason</div>
          <h2 className="font-display text-3xl font-700 uppercase leading-none">Hiring Carousel</h2>
          <p className="mt-1 text-sm text-muted">
            Accepting an offer means an <strong>interview</strong> against a rival candidate. Your
            reputation fit decides it. Win the room or stay put as {current}.
          </p>
        </div>
        <div className="space-y-3">
          {offers.map((o) => {
            const team = league.byId[o.teamId]
            const rung = ladderFor(career?.path ?? 'personnel')[o.level]
            return (
              <div key={o.id} className="rounded-xl border border-line p-3">
                <div className="flex items-center gap-3">
                  <TeamCrest team={team} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-lg font-700 uppercase leading-none text-ink">{o.title}</div>
                    <div className="font-cond text-xs text-muted">
                      {team.tier === 'NFL' ? `${team.city} ${team.name}` : team.name} · {o.years} yrs · {money(o.salary)}/yr
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="label !text-[9px]">Interest</div>
                    <div className="font-display text-lg font-700 tnum">{o.interest}%</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 rounded-lg bg-surface-2 p-2 text-xs text-muted">
                  <Badge tone="info">{rung.tier}</Badge> {rung.blurb}
                </div>
                <Button variant="team" className="mt-2 w-full" onClick={() => acceptOffer(o)}>
                  Sit for the interview — {o.title}
                </Button>
              </div>
            )
          })}
          <Button variant="ghost" className="w-full" onClick={decline}>
            Stay at {current}
          </Button>
        </div>
      </Shell>
    )
  }

  return null
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4 backdrop-blur-sm">
      <div className="relative max-h-[90vh] w-full max-w-[640px] overflow-y-auto rounded-2xl border border-line bg-canvas p-5 shadow-2xl">
        <button onClick={onClose} className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-lg bg-surface-2 text-muted hover:text-ink">
          <X size={16} />
        </button>
        {children}
      </div>
    </div>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: string | number; tone?: 'win' | 'loss' }) {
  return (
    <div className="rounded-lg border border-line py-1.5">
      <div className="label !text-[9px]">{label}</div>
      <div className={cn('font-display text-lg font-700 tnum', tone === 'win' ? 'text-win' : tone === 'loss' ? 'text-loss' : 'text-ink')}>
        {value}
      </div>
    </div>
  )
}

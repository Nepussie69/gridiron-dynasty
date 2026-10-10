import { useState } from 'react'
import { ArrowRight, Award, Fingerprint, Ghost, HelpCircle, Sparkles, Target } from 'lucide-react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
import { ladderFor, tierFor } from '../game/engine/career'
import { portfolioItems } from '../game/engine/portfolio'
import { counterOffer } from '../game/engine/counter'
import type { JobOffer } from '../game/types'
import { useGame, useWorld } from '../store/gameStore'
import { InterviewPrep } from './InterviewPrep'
import { Badge, Button, Card, ConfirmSheet, Dialog, TeamCrest, VerdictChip } from '../ui/kit'

export function SeasonModal() {
  const league = useWorld()
  const modal = useGame((s) => s.modal)
  const summary = useGame((s) => s.summary)
  const offers = useGame((s) => s.offers)
  const career = useGame((s) => s.career)
  const dismiss = useGame((s) => s.dismissModal)
  const acceptOffer = useGame((s) => s.acceptOffer)
  const acceptCounter = useGame((s) => s.acceptCounter)
  const decline = useGame((s) => s.declineOffers)
  const [prep, setPrep] = useState<JobOffer | null>(null)
  const [declineOpen, setDeclineOpen] = useState(false)

  if (modal === 'none') return null

  if (modal === 'seasonReview' && summary) {
    const champ = summary.champion ? league.byId[summary.champion] : null
    const scout = summary.scout
    const myAwards = (summary.staffAwards ?? []).filter((a) => a.isUser)
    const up = (summary.winsDelta ?? 0) >= 0
    return (
      <Dialog
        open
        onClose={dismiss}
        eyebrow={`Season complete · ${summary.season}`}
        title={summary.headline ?? `${summary.season} Review`}
        size="lg"
        footer={
          <Button variant="primary" size="lg" className="w-full" onClick={dismiss}>
            {offers.length ? `Review ${offers.length} job offer${offers.length > 1 ? 's' : ''}` : 'Continue'}
            <ArrowRight size={15} aria-hidden />
          </Button>
        }
      >
        {/* The record verdict, emphasised. */}
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-2.5">
          <div>
            <div className="label">Final record</div>
            <div className="font-display text-[30px] font-800 italic leading-none tnum text-ink">{summary.record}</div>
          </div>
          {typeof summary.winsDelta === 'number' && (
            <VerdictChip tone={up ? 'win' : 'loss'}>
              {up ? '+' : ''}
              {summary.winsDelta} wins vs {summary.season - 1}
            </VerdictChip>
          )}
        </div>

        {myAwards.length > 0 && (
          <div className="mb-3 flex items-center gap-1.5 font-cond text-body font-700 text-gold-ink">
            <Award size={14} />
            You were named {myAwards.map((a) => a.award).join(', ')}.
          </div>
        )}

        {/* #20: the season in 90 seconds — question, moments, fingerprints, ghost. */}
        {summary.question && (
          <Card className="mb-3">
            <div className="label mb-1 flex items-center gap-1.5">
              <HelpCircle size={12} /> The season question
            </div>
            <div className="font-display text-[18px] font-800 italic uppercase leading-snug text-ink">{summary.question.text}</div>
            {summary.question.answer && (
              <p className={cn('mt-1.5 text-body', summary.question.good ? 'text-win' : 'text-muted')}>{summary.question.answer}</p>
            )}
          </Card>
        )}

        {summary.ambitions && summary.ambitions.length > 0 && (
          <Card className="mb-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="label flex items-center gap-1.5">
                <Target size={12} /> Your ambitions
              </div>
              <Badge tone={summary.ambitions.every((a) => a.done) ? 'win' : 'neutral'}>
                {summary.ambitions.filter((a) => a.done).length}/{summary.ambitions.length} met
              </Badge>
            </div>
            <div className="space-y-1.5">
              {summary.ambitions.map((a) => (
                <div key={a.label} className="flex items-center gap-2 text-label">
                  <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded-full text-label', a.done ? 'bg-win text-on-accent' : 'bg-surface-3 text-muted')}>
                    {a.done ? '✓' : ''}
                  </span>
                  <span className={cn('flex-1 font-600', a.done ? 'text-ink' : 'text-muted')}>{a.label}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {summary.skillPoints && summary.skillPoints.earned > 0 && (
          <Card className="mb-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="label flex items-center gap-1.5">
                <Sparkles size={12} /> Skill points
              </div>
              <Badge tone="gold">+{summary.skillPoints.earned}</Badge>
            </div>
            <p className="text-body text-ink-2">
              You earned {summary.skillPoints.earned} skill point{summary.skillPoints.earned === 1 ? '' : 's'}:{' '}
              <span className="font-600 text-ink">{summary.skillPoints.reasons.join(', ')}</span>.
            </p>
            <p className="mt-1 text-label text-muted">{summary.skillPoints.unspent} unspent — spend them in My Career → Skills.</p>
          </Card>
        )}

        {summary.moments && summary.moments.length > 0 && (
          <Card className="mb-3">
            <div className="label mb-2">Three moments that mattered</div>
            <div className="space-y-1.5">
              {summary.moments.map((m) => (
                <div key={`${m.week}-${m.text}`} className="flex items-center gap-2 text-label">
                  <span className="grid h-5 w-8 shrink-0 place-items-center rounded-[var(--r-xs)] bg-surface-2 font-cond text-label font-700 text-muted">W{m.week}</span>
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
            <div className="label mb-1 flex items-center gap-1.5">
              <Fingerprint size={12} /> Your fingerprints
            </div>
            <p className="text-body text-ink-2">
              <strong className="text-ink">{summary.fingerprint.drafted}</strong> drafted and{' '}
              <strong className="text-ink">{summary.fingerprint.signed}</strong> signed by you are on this roster. This season is partly yours.
            </p>
          </Card>
        )}

        {summary.ghost && (
          <Card className="mb-3">
            <div className="label mb-1 flex items-center gap-1.5">
              <Ghost size={12} /> Ghost GM verdict
            </div>
            <div className="font-display text-[24px] font-800 italic tnum text-ink">
              {summary.ghost.delta >= 0 ? '+' : ''}
              {summary.ghost.delta.toFixed(1)} wins over replacement
            </div>
            <p className="mt-0.5 text-label text-muted">
              You won {summary.ghost.actualWins}; a replacement-level manager projects to {summary.ghost.ghostWins} with the same roster and schedule.
            </p>
          </Card>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <div className="label mb-2">Super Bowl champion</div>
            {champ ? (
              <div className="flex items-center gap-2">
                <TeamCrest team={champ} size={34} />
                <span className="font-display text-[18px] font-800 italic uppercase text-ink">{champ.name}</span>
              </div>
            ) : (
              <span className="text-body text-muted">—</span>
            )}
          </Card>
          <Card>
            <div className="label mb-1 flex items-center gap-1.5">
              <Award size={12} /> League MVP
            </div>
            <div className="font-display text-[20px] font-800 italic uppercase text-ink">{summary.mvp ?? '—'}</div>
          </Card>
        </div>

        {summary.objectives && summary.objectives.length > 0 && (
          <Card className="mt-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="label">Season objectives</div>
              <Badge tone={summary.objectivesDone ? 'win' : 'neutral'}>
                {summary.objectivesDone}/{summary.objectives.length} met
              </Badge>
            </div>
            <div className="space-y-1.5">
              {summary.objectives.map((o) => (
                <div key={o.id} className="flex items-center gap-2 text-label">
                  <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded-full', o.done ? 'bg-win text-on-accent' : 'bg-surface-3 text-muted')}>{o.done ? '✓' : ''}</span>
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
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="label">Your scouting report card</div>
              <Badge tone={scout.repDelta >= 0 ? 'win' : 'loss'}>
                Reputation {scout.repDelta >= 0 ? '+' : ''}
                {scout.repDelta}
              </Badge>
            </div>
            {scout.graded === 0 ? (
              <p className="text-body text-muted">You filed no recommendations this cycle.</p>
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
                    <div key={d.name} className="flex items-center gap-2 rounded-[var(--r-md)] border border-line px-2 py-1.5 text-label">
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
      </Dialog>
    )
  }

  if (modal === 'offers') {
    const current = career ? tierFor(career.path, career.level).title : ''
    const canPitch = career ? portfolioItems(league, career).length > 0 : false
    const myTeam = career ? league.byId[career.teamId] : null
    const liveCounter = !!career && career.counter?.season === league.season && !career.counter.taken
    const counter = liveCounter && career ? counterOffer(league, career, offers) : null
    return (
      <>
        <Dialog
          open
          onClose={dismiss}
          eyebrow="Offseason"
          title="Hiring Carousel"
          subtitle={`Accepting an offer means an interview against a rival candidate. Win the room or stay put as ${current}.`}
          footer={
            <Button variant="quiet" className="w-full text-ink-2" onClick={() => setDeclineOpen(true)}>
              Decline all offers
            </Button>
          }
        >
          {counter && myTeam && (
            <div className="mb-3 rounded-[var(--r-md)] border border-gold/60 bg-gold/10 p-3">
              <div className="mb-1 flex items-center gap-1.5">
                <Award size={14} className="text-gold-ink" />
                <div className="font-display text-[18px] font-800 italic uppercase leading-none text-ink">Counteroffer — stay with the {myTeam.name}</div>
              </div>
              <p className="text-body text-ink-2">{counter.text}</p>
              <Button variant="primary" className="mt-2 w-full" onClick={acceptCounter}>
                Accept counter
              </Button>
            </div>
          )}
          <div className="space-y-3">
            {offers.map((o) => {
              const team = league.byId[o.teamId]
              const rung = ladderFor(career?.path ?? 'personnel')[o.level]
              return (
                <div key={o.id} className="rounded-[var(--r-md)] border border-line p-3">
                  <div className="flex items-center gap-3">
                    <TeamCrest team={team} size={38} />
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-[18px] font-800 italic uppercase leading-none text-ink">{o.title}</div>
                      <div className="font-cond text-label text-muted">
                        {team.tier === 'NFL' ? `${team.city} ${team.name}` : team.name} · {o.years} yrs · {money(o.salary)}/yr
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="label">Interest</div>
                      <div className="font-display text-[18px] font-800 italic tnum text-ink">{o.interest}%</div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2 rounded-[var(--r-md)] bg-surface-2 p-2 text-label text-muted">
                    <Badge tone="info">{rung.tier}</Badge> {rung.blurb}
                  </div>
                  <Button variant="primary" className="mt-2 w-full" onClick={() => (canPitch ? setPrep(o) : acceptOffer(o))}>
                    Sit for the interview — {o.title}
                  </Button>
                </div>
              )
            })}
          </div>
        </Dialog>

        <ConfirmSheet
          open={declineOpen}
          onClose={() => setDeclineOpen(false)}
          eyebrow="Hiring carousel"
          title="Decline all offers?"
          subtitle={`You stay on as ${current}.`}
          consequences={[
            { label: 'Offers', value: `${offers.length} withdrawn`, tone: 'warn' },
            { label: 'Your job', value: `You remain ${current}` },
          ]}
          confirmLabel="Decline all offers"
          ledgerNote={null}
          onConfirm={() => {
            setDeclineOpen(false)
            decline()
          }}
        />

        {prep && <InterviewPrep offer={prep} onCancel={() => setPrep(null)} />}
      </>
    )
  }

  return null
}

function MiniStat({ label, value, tone }: { label: string; value: string | number; tone?: 'win' | 'loss' }) {
  return (
    <div className="rounded-[var(--r-md)] border border-line py-1.5">
      <div className="label">{label}</div>
      <div className={cn('font-display text-[18px] font-800 italic tnum', tone === 'win' ? 'text-win' : tone === 'loss' ? 'text-loss' : 'text-ink')}>{value}</div>
    </div>
  )
}

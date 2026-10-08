import { CalendarClock, FastForward, Timer, Trophy } from 'lucide-react'
import { cn } from '../lib/cn'
import { gradeColor } from '../lib/format'
import { DRAFT_ROUNDS, currentRound, currentTeamId, draftOpen, overallPick, rookieProjection, stageOf, stagesUntilDraft } from '../game/engine/draft'
import { accessFor } from '../game/engine/access'
import { readProspect, readRookieRanges } from '../game/engine/evaluation'
import { draftPickValue } from '../game/selectors'
import { useGame, useWorld } from '../store/gameStore'
import { AccessBadge } from '../components/AccessBadge'
import { Badge, Button, Card, PageHeader, RatingBar, RookieRangeBadges, Stat, TeamCrest } from '../ui/kit'

export function Draft() {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const onClockFn = useGame((s) => s.userOnClock)
  const draftProspect = useGame((s) => s.draftProspect)
  const toggleUserBoard = useGame((s) => s.toggleUserBoard)
  const simToMyPick = useGame((s) => s.simToMyPick)
  const finishDraft = useGame((s) => s.finishDraft)

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

  const myPicks = league.draft.filter((p) => p.draftedBy === career.teamId)
  const board = career.userBoard ?? []

  return (
    <div>
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
          <div className="flex items-center gap-2">
            <AccessBadge area="draft" />
            {!draftIsOpen ? (
              <Badge tone="warn"><CalendarClock size={12} /> April</Badge>
            ) : !complete ? (
              <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
                <Timer size={16} className={mine ? 'text-loss' : 'text-muted'} />
                <span className="font-cond text-sm font-700 uppercase">
                  {mine ? 'You are on the clock' : `Round ${currentRound(league)} · Pick ${overallPick(league)}`}
                </span>
              </div>
            ) : (
              <Badge tone="win"><Trophy size={12} /> Draft complete</Badge>
            )}
          </div>
        }
      />

      {!draftIsOpen && (
        <div className="mb-4 rounded-xl border border-[#f3ddb8] bg-[#fdf0dc] p-3 text-sm text-warn">
          {closedReason} Scout the class, rank your board, file conviction calls and red flags — the picks wait until April.
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><Stat label="Your Picks Made" value={myPicks.length} sub="this class" /></Card>
        <Card><Stat label="Best Available" value={available[0]?.grade ?? 0} sub={available[0]?.name} /></Card>
        <Card><Stat label="Draft Capital" value={myPicks.reduce((s, p) => s + draftPickValue(p.draftPick ?? 250), 0).toLocaleString()} sub="value points" /></Card>
        <Card><Stat label="Rounds" value={`${Math.min(currentRound(league), DRAFT_ROUNDS)} / ${DRAFT_ROUNDS}`} sub={complete ? 'done' : 'in progress'} /></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="space-y-4">
          {draftIsOpen && onClock && !complete && (
            <Card pad={false} className="overflow-hidden">
              <div className="p-4" style={{ background: `linear-gradient(120deg, ${onClock.primary}, ${onClock.secondary})` }}>
                <div className="flex items-center gap-2 text-white">
                  <CalendarClock size={15} />
                  <span className="label !text-white/70">On the Clock</span>
                </div>
                <div className="mt-1 flex items-center gap-3">
                  <TeamCrest team={onClock} size={40} />
                  <div className="text-white">
                    <div className="font-display text-2xl font-700 uppercase leading-none">{onClock.name}</div>
                    <div className="font-cond text-sm text-white/80">Pick {overallPick(league)} · Round {currentRound(league)}</div>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {advising && (
            <Card>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-display text-lg font-700 uppercase tracking-wide">Your Board</h3>
                <Badge tone={board.length ? 'warn' : 'neutral'}>{board.length} ranked</Badge>
              </div>
              <div className="space-y-1">
                {board.length === 0 && <p className="text-xs text-muted">Rank prospects from the board — your top names get the Director's attention.</p>}
                {board.map((id, i) => {
                  const p = league.draft.find((x) => x.id === id)
                  if (!p) return null
                  const proj = rookieProjection(league.draft, p)
                  return (
                    <div key={id} className="flex items-center gap-2 text-sm">
                      <span className="w-5 font-display font-700 tnum text-muted">{i + 1}</span>
                      <span className="w-8 font-cond text-[11px] font-700 uppercase text-muted">{p.pos}</span>
                      <span className="min-w-0 flex-1 truncate font-600 text-ink">{p.name}</span>
                      <span className="font-cond text-[10px] tnum text-muted">Now ~{proj.now} · Ceiling {proj.ceiling}</span>
                      <button onClick={() => toggleUserBoard(id)} className="font-cond text-[10px] font-700 uppercase text-loss hover:underline">Remove</button>
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
            <div className="max-h-[280px] divide-y divide-line/60 overflow-y-auto">
              {myPicks.map((p) => {
                const rr = readRookieRanges(career, p, league.draft)
                return (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-2">
                    <span className="grid h-7 w-7 place-items-center rounded-md bg-surface-3 font-display text-xs font-700 text-ink-2">
                      {p.draftPick}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-cond text-sm font-600 text-ink">{p.name}</div>
                      <div className="text-xs text-muted">{p.pos} · {p.college}</div>
                      <RookieRangeBadges now={rr.now} ceiling={rr.ceiling} compact className="mt-0.5" />
                    </div>
                    <Badge tone="neutral">{p.grade}</Badge>
                  </div>
                )
              })}
              {!myPicks.length && <div className="px-4 py-6 text-center text-sm text-muted">No picks yet.</div>}
            </div>
          </Card>

          <div className="flex flex-col gap-2">
            <Button
              className="w-full"
              disabled={complete || !draftIsOpen}
              title={!draftIsOpen ? closedReason : undefined}
              onClick={simToMyPick}
            >
              <FastForward size={15} /> Sim to my next pick
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              disabled={complete || !draftIsOpen}
              title={!draftIsOpen ? closedReason : undefined}
              onClick={finishDraft}
            >
              Complete the draft
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <Card pad={false}>
            <div className="flex items-center justify-between border-b border-line px-4 py-2">
              <span className="label">Prospect Board · Best Available</span>
              <Badge tone="team">{available.length} remaining</Badge>
            </div>
            <div className="max-h-[560px] divide-y divide-line/60 overflow-y-auto">
              {available.map((p) => {
                const read = readProspect(career, p)
                const rank = board.indexOf(p.id)
                const rr = readRookieRanges(career, p, league.draft)
                return (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex w-[128px] shrink-0 flex-col items-center gap-0.5">
                      <RookieRangeBadges now={rr.now} ceiling={rr.ceiling} />
                      <span className="font-cond text-[8px] font-700 uppercase tracking-wide text-muted">Now · Ceiling</span>
                    </div>
                    <span className="w-9 font-cond text-[11px] font-700 uppercase text-muted">{p.pos}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-600 text-ink">{p.name}</span>
                        {rank >= 0 && <Badge tone="warn">#{rank + 1} your board</Badge>}
                      </span>
                      <span className="block truncate text-xs text-muted">{p.college} · {read.bandLabel}</span>
                    </span>
                    <div className="hidden w-24 md:block">
                      <RatingBar value={read.center} height={5} color={gradeColor(read.center)} />
                    </div>
                    {deciding ? (
                      <Button
                        size="sm"
                        variant="team"
                        disabled={!mine || !draftIsOpen}
                        title={!draftIsOpen ? closedReason : undefined}
                        className={cn((!mine || !draftIsOpen) && 'opacity-40')}
                        onClick={() => draftProspect(p.id)}
                      >
                        Draft
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant={rank >= 0 ? 'team' : 'default'}
                        disabled={!advising}
                        className={cn(!advising && 'opacity-40')}
                        onClick={() => toggleUserBoard(p.id)}
                      >
                        {rank >= 0 ? 'On Board' : 'Advise'}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>

          <Card pad={false}>
            <div className="border-b border-line px-4 py-2">
              <span className="label">Draft Log</span>
            </div>
            <div className="max-h-[220px] divide-y divide-line/60 overflow-y-auto">
              {league.draftState.log.map((line, i) => (
                <div key={i} className="px-4 py-1.5 text-xs text-ink-2">{line}</div>
              ))}
              {!league.draftState.log.length && (
                <div className="px-4 py-6 text-center text-sm text-muted">
                  The draft begins after the regular season ends.
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

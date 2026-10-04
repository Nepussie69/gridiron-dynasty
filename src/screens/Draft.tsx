import { CalendarClock, FastForward, Timer, Trophy } from 'lucide-react'
import { cn } from '../lib/cn'
import { gradeColor, inkOn } from '../lib/format'
import {
  DRAFT_ROUNDS, currentRound, currentTeamId, overallPick,
} from '../game/engine/draft'
import { canDraft } from '../game/engine/career'
import { draftPickValue } from '../game/selectors'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card, PageHeader, RatingBar, Stat, TeamCrest } from '../ui/kit'

export function Draft() {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const onClockFn = useGame((s) => s.userOnClock)
  const draftProspect = useGame((s) => s.draftProspect)
  const simToMyPick = useGame((s) => s.simToMyPick)
  const finishDraft = useGame((s) => s.finishDraft)

  const teamId = currentTeamId(league)
  const onClock = teamId ? league.byId[teamId] : null
  const mine = onClockFn()
  const userCanDraft = canDraft(career)
  const complete = league.draftState.complete
  const available = league.draft.filter((p) => !p.draftedBy).sort((a, b) => b.grade - a.grade)

  const myPicks = league.draft.filter((p) => p.draftedBy === career.teamId)

  return (
    <div>
      <PageHeader
        eyebrow={`${league.season} Draft`}
        title="Draft War Room"
        subtitle={
          userCanDraft
            ? 'You are on the clock when your club picks. Stack the board and make the call.'
            : 'You are building the board for the club — the final call comes higher up until you earn it.'
        }
        right={
          !complete ? (
            <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
              <Timer size={16} className={mine ? 'text-loss' : 'text-muted'} />
              <span className="font-cond text-sm font-700 uppercase">
                {mine ? 'You are on the clock' : `Round ${currentRound(league)} · Pick ${overallPick(league)}`}
              </span>
            </div>
          ) : (
            <Badge tone="win"><Trophy size={12} /> Draft complete</Badge>
          )
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><Stat label="Your Picks Made" value={myPicks.length} sub="this class" /></Card>
        <Card><Stat label="Best Available" value={available[0]?.grade ?? 0} sub={available[0]?.name} /></Card>
        <Card><Stat label="Draft Capital" value={myPicks.reduce((s, p) => s + draftPickValue(p.draftPick ?? 250), 0).toLocaleString()} sub="value points" /></Card>
        <Card><Stat label="Rounds" value={`${Math.min(currentRound(league), DRAFT_ROUNDS)} / ${DRAFT_ROUNDS}`} sub={complete ? 'done' : 'in progress'} /></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="space-y-4">
          {onClock && !complete && (
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

          <Card pad={false}>
            <div className="border-b border-line px-4 py-2">
              <span className="label">Your Selections</span>
            </div>
            <div className="max-h-[280px] divide-y divide-line/60 overflow-y-auto">
              {myPicks.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2">
                  <span className="grid h-7 w-7 place-items-center rounded-md bg-surface-3 font-display text-xs font-700 text-ink-2">
                    {p.draftPick}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-cond text-sm font-600 text-ink">{p.name}</div>
                    <div className="text-xs text-muted">{p.pos} · {p.college}</div>
                  </div>
                  <Badge tone="neutral">{p.grade}</Badge>
                </div>
              ))}
              {!myPicks.length && <div className="px-4 py-6 text-center text-sm text-muted">No picks yet.</div>}
            </div>
          </Card>

          <div className="flex flex-col gap-2">
            <Button className="w-full" disabled={complete} onClick={simToMyPick}>
              <FastForward size={15} /> Sim to my next pick
            </Button>
            <Button variant="ghost" className="w-full" disabled={complete} onClick={finishDraft}>
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
              {available.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-md font-display text-base font-700"
                    style={{ background: gradeColor(p.grade), color: inkOn(gradeColor(p.grade)) }}
                  >
                    {p.grade}
                  </span>
                  <span className="w-9 font-cond text-[11px] font-700 uppercase text-muted">{p.pos}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-600 text-ink">{p.name}</span>
                    <span className="block truncate text-xs text-muted">{p.college} · Proj. Rd {p.projectedRound}</span>
                  </span>
                  <div className="hidden w-24 md:block">
                    <RatingBar value={p.grade} height={5} color={gradeColor(p.grade)} />
                  </div>
                  <Button
                    size="sm"
                    variant="team"
                    disabled={!mine}
                    className={cn(!mine && 'opacity-40')}
                    onClick={() => draftProspect(p.id)}
                  >
                    Draft
                  </Button>
                </div>
              ))}
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

import { useState } from 'react'
import { ClipboardList, Repeat } from 'lucide-react'
import { cn } from '../lib/cn'
import { describePlan, type GamePlan } from '../game/engine/gameplan'
import { PlanEditor } from '../components/PlanEditor'
import { CulturePanel } from '../components/CulturePanel'
import { SchemeFitReport } from '../components/SchemeFitReport'
import { WrinkleCard } from '../components/WrinkleCard'
import { InstallCard } from '../components/InstallCard'
import { canWrinkle } from '../game/engine/wrinkle'
import { coachLabels } from '../game/engine/playsim'
import { recordOf, scheduleFor } from '../game/selectors'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, PageHeader, TeamCrest } from '../ui/kit'

export function GamePlanScreen() {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const defaultPlan = useGame((s) => s.defaultPlan)
  const setDefaultPlan = useGame((s) => s.setDefaultPlan)
  const [side, setSide] = useState<'off' | 'def'>('off')

  const team = league.byId[career.teamId]
  const coaches = coachLabels(league, career.teamId)
  const { out: schedule } = scheduleFor(league, career.teamId)
  const next = schedule.find((g) => !g.played)
  const opp = next ? league.byId[next.opponentId] : null

  const plan: GamePlan = defaultPlan[side]
  const opponentScheme = opp
    ? side === 'off'
      ? coachLabels(league, opp.id).dcScheme
      : coachLabels(league, opp.id).ocScheme
    : undefined

  return (
    <div>
      <PageHeader
        eyebrow={`${team.tier === 'NFL' ? `${team.conference} ${team.division}` : team.conference} · Week ${league.week}`}
        title="Game Plan"
        subtitle="Set how you want to play before kickoff. Your plan is applied to every game until you change it — and you can adjust it live from the match view."
        right={
          <div className="flex rounded-lg bg-surface-2 p-0.5">
            {(['off', 'def'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={cn(
                  'rounded-md px-4 py-1.5 font-cond text-xs font-700 uppercase tracking-wide transition',
                  side === s ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink-2',
                )}
              >
                {s === 'off' ? 'Offense' : 'Defense'}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          <Card>
            <div className="mb-3 flex items-center gap-2">
              <ClipboardList size={16} className="text-muted" />
              <h3 className="font-display text-lg font-700 uppercase tracking-wide">
                {side === 'off' ? 'Offensive Plan' : 'Defensive Plan'}
              </h3>
              <Badge tone="team" className="ml-auto">{side === 'off' ? coaches.ocScheme : coaches.dcScheme}</Badge>
            </div>
            <PlanEditor plan={plan} onChange={(p) => setDefaultPlan(side, p)} side={side} />
          </Card>

          <SchemeFitReport teamId={team.id} side={side} />
          {canWrinkle(career) && <WrinkleCard />}
          <InstallCard />
          <CulturePanel teamId={team.id} />
        </div>

        <div className="space-y-5">
          {next && opp && (
            <Card pad={false} className="overflow-hidden">
              <div className="border-b border-line bg-surface-2 px-4 py-2">
                <span className="label">Up Next · Week {next.week}</span>
              </div>
              <div className="flex items-center gap-4 p-4">
                <TeamCrest team={team} size={44} />
                <div className="flex-1">
                  <div className="font-display text-lg font-700 uppercase leading-none">{team.name}</div>
                  <div className="font-cond text-xs text-muted">{recordOf(league, team.id).wins}-{recordOf(league, team.id).losses}</div>
                </div>
                <span className="font-display text-faint">vs</span>
                <div className="flex-1 text-right">
                  <div className="font-display text-lg font-700 uppercase leading-none">{opp.name}</div>
                  <div className="font-cond text-xs text-muted">{recordOf(league, opp.id).wins}-{recordOf(league, opp.id).losses}</div>
                </div>
                <TeamCrest team={opp} size={44} />
              </div>
              <div className="border-t border-line px-4 py-2.5 text-xs text-muted">
                Opponent runs <strong className="text-ink">{opponentScheme}</strong>
                {side === 'off' ? ' defense' : ' offense'} — plan accordingly.
              </div>
            </Card>
          )}

          <Card>
            <h3 className="mb-3 font-display text-lg font-700 uppercase tracking-wide">Coordinator Notes</h3>
            <div className="space-y-3 text-sm">
              <div className="rounded-lg bg-surface-2 p-3">
                <div className="label mb-0.5">{coaches.oc} · OC</div>
                <div className="text-ink-2">{coaches.ocScheme}</div>
                <div className="mt-1 text-xs text-muted">
                  {describePlan(defaultPlan.off, 'off')}
                </div>
              </div>
              <div className="rounded-lg bg-surface-2 p-3">
                <div className="label mb-0.5">{coaches.dc} · DC</div>
                <div className="text-ink-2">{coaches.dcScheme}</div>
                <div className="mt-1 text-xs text-muted">
                  {describePlan(defaultPlan.def, 'def')}
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-start gap-2 text-xs leading-relaxed text-muted">
              <Repeat size={14} className="mt-0.5 shrink-0" />
              <span>
                Plans are saved and reused every week. During a game, open the match view to
                change them live — the sim re-runs instantly so you can see the effect before
                you finish the game.
              </span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

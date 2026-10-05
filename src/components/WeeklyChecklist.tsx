import { ArrowRight, CheckCircle2, Circle } from 'lucide-react'
import { cn } from '../lib/cn'
import { weeklyTasks } from '../game/engine/checklist'
import { MAX_SCOUT_POINTS, useGame, useWorld, type ScreenId } from '../store/gameStore'
import { Badge, Card } from '../ui/kit'

/**
 * A role-specific to-do list for the current week. Tasks are derived from the
 * rung's capabilities and current state, and reset when you advance the week.
 */
export function WeeklyChecklist({ className }: { className?: string }) {
  const world = useWorld()
  const career = useGame((s) => s.career)!
  const points = useGame((s) => s.scoutingPoints)
  const setScreen = useGame((s) => s.setScreen)

  const tasks = weeklyTasks(career, world, { scoutingPoints: points, maxPoints: MAX_SCOUT_POINTS })
  const done = tasks.filter((t) => t.done).length
  const allDone = done === tasks.filter((t) => !t.primary).length

  return (
    <Card className={className}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">This Week's Checklist</h3>
        <Badge tone={allDone ? 'win' : 'team'}>{done}/{tasks.filter((t) => !t.primary).length} done</Badge>
      </div>
      <div className="space-y-0.5">
        {tasks.map((t) => (
          <div
            key={t.id}
            className={cn(
              'flex items-center gap-2.5 rounded-lg px-2 py-1.5',
              !t.primary && t.done && 'opacity-55',
              t.primary && 'mt-1 border-t border-line pt-2',
            )}
          >
            {t.done && !t.primary ? (
              <CheckCircle2 size={16} className="shrink-0 text-win" />
            ) : (
              <Circle size={16} className={cn('shrink-0', t.primary ? 'text-faint' : 'text-faint')} />
            )}
            <div className="min-w-0 flex-1">
              <div className={cn('text-sm font-600', t.done && !t.primary ? 'text-muted line-through' : 'text-ink')}>
                {t.label}
              </div>
              <div className="text-[11px] text-muted">{t.hint}</div>
            </div>
            {t.primary ? (
              <span className="font-cond text-[10px] font-700 uppercase text-faint">top bar ▸</span>
            ) : t.screen ? (
              <button
                onClick={() => setScreen(t.screen as ScreenId)}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 font-cond text-[10px] font-700 uppercase tracking-wide text-ink-2 transition hover:bg-surface-2"
              >
                Go <ArrowRight size={11} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  )
}

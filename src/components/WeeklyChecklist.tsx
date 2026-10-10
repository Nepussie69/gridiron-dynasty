import { ArrowRight, CheckCircle2, Circle } from 'lucide-react'
import { cn } from '../lib/cn'
import { weeklyTasks } from '../game/engine/checklist'
import { MAX_SCOUT_POINTS, useGame, useWorld, type ScreenId } from '../store/gameStore'
import { Badge, Button, Card } from '../ui/kit'

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
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">
          This Week&rsquo;s Checklist
        </h3>
        <Badge tone={allDone ? 'win' : 'neutral'}>
          {done}/{tasks.filter((t) => !t.primary).length} done
        </Badge>
      </div>
      <div className="space-y-0.5">
        {tasks.map((t) => (
          <div
            key={t.id}
            className={cn(
              'flex items-center gap-2.5 rounded-[var(--r-md)] px-2 py-1.5',
              !t.primary && t.done && 'opacity-55',
              t.primary && 'mt-1 border-t border-line pt-2',
            )}
          >
            {t.done && !t.primary ? (
              <CheckCircle2 size={16} className="shrink-0 text-win" aria-hidden />
            ) : (
              <Circle size={16} className="shrink-0 text-faint" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <div className={cn('text-body font-600', t.done && !t.primary ? 'text-muted line-through' : 'text-ink')}>
                {t.label}
              </div>
              <div className="text-label text-muted">{t.hint}</div>
            </div>
            {t.primary ? (
              <span className="shrink-0 font-cond text-label font-700 uppercase tracking-[0.07em] text-faint">Top bar ▸</span>
            ) : t.screen ? (
              <Button
                size="sm"
                variant="quiet"
                className="shrink-0"
                icon={<ArrowRight size={13} aria-hidden />}
                onClick={() => setScreen(t.screen as ScreenId)}
              >
                Go
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  )
}

import { CalendarOff } from 'lucide-react'
import { cn } from '../lib/cn'
import { BYE_OPTIONS, byePlan, canByeWeek, isByeWeek, type ByePlan } from '../game/engine/bye'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card } from '../ui/kit'

/**
 * FUTURES 17 — the bye week.
 *
 * On the one week a season with no game, the club makes a real call: rest the
 * roster, run an install week, or self-scout. The payoff lands in next week's
 * game (and only ever on the user's club). Doing nothing is a neutral week.
 */
export function ByeWeekCard({ className }: { className?: string }) {
  const career = useGame((s) => s.career)!
  const world = useWorld()
  const pickBye = useGame((s) => s.pickBye)

  if (!canByeWeek(career) || !isByeWeek(world, career.teamId)) return null
  const active = byePlan(career, world)
  const option = BYE_OPTIONS.find((o) => o.id === active)

  return (
    <Card className={cn('border-[var(--team)]', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-display text-lg font-700 uppercase tracking-wide">
          <CalendarOff size={15} className="text-[var(--team)]" /> Bye week
        </h3>
        <Badge tone={active ? 'win' : 'warn'}>{active ? option?.label ?? 'Set' : 'Needs a call'}</Badge>
      </div>

      <p className="mb-3 text-sm leading-snug text-muted">
        No game this week. Pick how to spend it — the payoff shows up next Sunday.
      </p>

      <div className="grid gap-1.5 sm:grid-cols-3">
        {BYE_OPTIONS.map((o) => {
          const selected = active === o.id
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => pickBye(o.id as ByePlan)}
              className={cn(
                'rounded-lg border p-2.5 text-left transition',
                selected
                  ? 'border-[var(--team)] bg-[var(--team-soft)]'
                  : 'border-line bg-surface-2 hover:border-[var(--team)] hover:bg-[var(--team-soft)]',
              )}
            >
              <span className="block text-xs font-600 text-ink">{o.label}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted">{o.blurb}</span>
            </button>
          )
        })}
      </div>

      <p className="mt-3 text-[11px] leading-snug text-muted">
        Your call lands next week and affects only your club. Skipping the week changes nothing.
      </p>
    </Card>
  )
}

import { CalendarOff } from 'lucide-react'
import { cn } from '../lib/cn'
import { BYE_OPTIONS, byePlan, canByeWeek, isByeWeek, type ByePlan } from '../game/engine/bye'
import { useGame, useWorld } from '../store/gameStore'
import { Card, OptionCard, OptionGroup, VerdictChip } from '../ui/kit'

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
    <Card tier="call" callLabel={active ? 'Set' : 'Needs a call'} className={cn(className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">
          <CalendarOff size={15} className="text-[var(--team-accent)]" aria-hidden /> Bye week
        </h3>
        <VerdictChip tone={active ? 'win' : 'warn'}>{active ? option?.label ?? 'Set' : 'Needs a call'}</VerdictChip>
      </div>

      <p className="mb-3 text-body leading-snug text-muted">
        No game this week. Pick how to spend it — the payoff shows up next Sunday.
      </p>

      <OptionGroup label="Bye-week plan" className="sm:grid-cols-3">
        {BYE_OPTIONS.map((o) => (
          <OptionCard
            key={o.id}
            selected={active === o.id}
            title={o.label}
            description={o.blurb}
            onSelect={() => pickBye(o.id as ByePlan)}
          />
        ))}
      </OptionGroup>

      <p className="mt-3 text-label leading-snug text-muted">
        Your call lands next week and affects only your club. Skipping the week changes nothing.
      </p>
    </Card>
  )
}

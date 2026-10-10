import { ClipboardList } from 'lucide-react'
import { PRACTICE_OPTIONS, canPractice, practiceEdge, practicePlan, type PracticePlan } from '../game/engine/practice'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, OptionCard, OptionGroup } from '../ui/kit'

/**
 * L12 W1 — the weekly practice plan.
 *
 * A coordinator or head coach picks one plan a week. The plan is kept week to
 * week until changed; the card shows each option's effect and which one is live.
 * D6: options are kit OptionCards (radio mark, distinct hover/selected states).
 */
export function PracticeCard({ className, disabled = false }: { className?: string; disabled?: boolean }) {
  const career = useGame((s) => s.career)!
  const world = useWorld()
  const pickPractice = useGame((s) => s.pickPractice)

  if (!canPractice(career)) return null
  const active = practicePlan(career, world)
  const edge = practiceEdge(career, world)
  const shown = Math.max(edge.off, edge.def)

  return (
    <Card className={className}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-display text-lg font-700 uppercase tracking-wide">
          <ClipboardList size={15} className="text-[var(--team-accent)]" aria-hidden /> Practice plan
        </h3>
        <Badge tone={shown > 0 ? 'win' : shown < 0 ? 'warn' : 'neutral'}>
          {shown > 0 ? `+${shown.toFixed(1)} this week` : shown < 0 ? `${shown.toFixed(1)} this week` : 'No edge'}
        </Badge>
      </div>

      <OptionGroup label="Practice plan" className="sm:grid-cols-2">
        {PRACTICE_OPTIONS.map((o) => (
          <OptionCard
            key={o.id}
            selected={active === o.id}
            disabled={disabled}
            onSelect={() => pickPractice(o.id as PracticePlan)}
            title={o.label}
            description={o.blurb}
          />
        ))}
      </OptionGroup>

      <p className="mt-3 text-small leading-snug text-muted">
        Your plan carries over week to week. A kept Install pays off the following week even if you change the plan.
      </p>
    </Card>
  )
}

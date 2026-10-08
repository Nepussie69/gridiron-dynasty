import { ClipboardList } from 'lucide-react'
import { cn } from '../lib/cn'
import { PRACTICE_OPTIONS, canPractice, practiceEdge, practicePlan, type PracticePlan } from '../game/engine/practice'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card } from '../ui/kit'

/**
 * L12 W1 — the weekly practice plan.
 *
 * A coordinator or head coach picks one plan a week. The plan is kept week to
 * week until changed; the card shows each option's effect and which one is live.
 */
export function PracticeCard({ className }: { className?: string }) {
  const career = useGame((s) => s.career)!
  const world = useWorld()
  const pickPractice = useGame((s) => s.pickPractice)

  if (!canPractice(career)) return null
  const active = practicePlan(career, world)
  const edge = practiceEdge(career, world)
  const shown = Math.max(edge.off, edge.def)

  return (
    <Card className={className}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 font-display text-lg font-700 uppercase tracking-wide">
          <ClipboardList size={15} className="text-[var(--team)]" /> Practice plan
        </h3>
        <Badge tone={shown > 0 ? 'win' : shown < 0 ? 'warn' : 'neutral'}>
          {shown > 0 ? `+${shown.toFixed(1)} this week` : shown < 0 ? `${shown.toFixed(1)} this week` : 'No edge'}
        </Badge>
      </div>

      <div className="grid gap-1.5 sm:grid-cols-2">
        {PRACTICE_OPTIONS.map((o) => {
          const selected = active === o.id
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => pickPractice(o.id as PracticePlan)}
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
        Your plan carries over week to week. A kept Install pays off the following week even if you change the plan.
      </p>
    </Card>
  )
}

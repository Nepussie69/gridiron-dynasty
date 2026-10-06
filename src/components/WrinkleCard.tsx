import { Zap } from 'lucide-react'
import { cn } from '../lib/cn'
import { DEF_WRINKLES, OFF_WRINKLES, canWrinkle, wrinkleEdge, wrinkleSides } from '../game/engine/wrinkle'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card } from '../ui/kit'

/** The film-driven edge chip shown on each wrinkle button. */
function edgeChip(edge: number): { label: string; tone: 'win' | 'warn' | 'neutral' } {
  if (edge >= 1) return { label: 'Fresh +1.0', tone: 'win' }
  if (edge >= 0.6) return { label: '+0.6', tone: 'warn' }
  if (edge >= 0.3) return { label: '+0.3', tone: 'warn' }
  return { label: 'Scouted 0', tone: 'neutral' }
}

/**
 * K1 — the weekly wrinkle.
 *
 * A coordinator picks for his side of the ball; a head coach picks one per side.
 * A fresh wrinkle is worth more than one opponents have seen on film, so the
 * card shows each option's current edge and the best play is to rotate.
 */
export function WrinkleCard({ className }: { className?: string }) {
  const career = useGame((s) => s.career)!
  const league = useWorld()
  const pickWrinkle = useGame((s) => s.pickWrinkle)

  if (!canWrinkle(career)) return null
  const sides = wrinkleSides(career)
  const pick = career.wrinkles?.pick?.week === league.week ? career.wrinkles?.pick : undefined

  return (
    <Card className={className}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 font-display text-lg font-700 uppercase tracking-wide">
          <Zap size={15} className="text-[var(--team)]" /> This week&rsquo;s wrinkle
        </h3>
        <Badge tone="team">Week {league.week}</Badge>
      </div>

      <div className="space-y-3">
        {sides.map((side) => (
          <div key={side}>
            <div className="label mb-1.5">{side === 'off' ? 'Offense' : 'Defense'}</div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {(side === 'off' ? OFF_WRINKLES : DEF_WRINKLES).map((w) => {
                const chip = edgeChip(wrinkleEdge(career, side, w.id, league.week))
                const selected = pick?.[side] === w.id
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => pickWrinkle(side, w.id)}
                    className={cn(
                      'flex items-start gap-2 rounded-lg border p-2.5 text-left transition',
                      selected
                        ? 'border-[var(--team)] bg-[var(--team-soft)]'
                        : 'border-line bg-surface-2 hover:border-[var(--team)] hover:bg-[var(--team-soft)]',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-600 text-ink">{w.label}</span>
                      <span className="block text-[11px] leading-snug text-muted">{w.blurb}</span>
                    </span>
                    <Badge tone={chip.tone}>{chip.label}</Badge>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] leading-snug text-muted">
        Opponents study film — rotate your wrinkles.
      </p>
    </Card>
  )
}

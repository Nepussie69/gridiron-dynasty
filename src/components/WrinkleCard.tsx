import { Zap } from 'lucide-react'
import { DEF_WRINKLES, OFF_WRINKLES, canWrinkle, wrinkleEdge, wrinkleSides } from '../game/engine/wrinkle'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, OptionCard, OptionGroup } from '../ui/kit'

/** The film-driven edge chip shown on each wrinkle option. A positive edge is a win. */
function edgeChip(edge: number): { label: string; tone: 'win' | 'neutral' } {
  if (edge >= 1) return { label: 'Fresh +1.0', tone: 'win' }
  if (edge > 0) return { label: `+${edge.toFixed(1)}`, tone: 'win' }
  return { label: 'Scouted 0', tone: 'neutral' }
}

/**
 * K1 — the weekly wrinkle.
 *
 * A coordinator picks for his side of the ball; a head coach picks one per side.
 * A fresh wrinkle is worth more than one opponents have seen on film, so the
 * card shows each option's current edge and the best play is to rotate.
 * D6: options are kit OptionCards; a positive edge reads win, a scouted one neutral.
 */
export function WrinkleCard({ className, disabled = false }: { className?: string; disabled?: boolean }) {
  const career = useGame((s) => s.career)!
  const league = useWorld()
  const pickWrinkle = useGame((s) => s.pickWrinkle)

  if (!canWrinkle(career)) return null
  const sides = wrinkleSides(career)
  const pick = career.wrinkles?.pick?.week === league.week ? career.wrinkles?.pick : undefined

  return (
    <Card className={className}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-display text-lg font-700 uppercase tracking-wide">
          <Zap size={15} className="text-[var(--team-accent)]" aria-hidden /> This week&rsquo;s wrinkle
        </h3>
        <Badge tone="neutral">Week {league.week}</Badge>
      </div>

      <div className="space-y-3">
        {sides.map((side) => (
          <div key={side}>
            <div className="label mb-1.5">{side === 'off' ? 'Offense' : 'Defense'}</div>
            <OptionGroup
              label={`${side === 'off' ? 'Offense' : 'Defense'} wrinkle`}
              className="sm:grid-cols-2"
            >
              {(side === 'off' ? OFF_WRINKLES : DEF_WRINKLES).map((w) => {
                const chip = edgeChip(wrinkleEdge(career, side, w.id, league.week))
                return (
                  <OptionCard
                    key={w.id}
                    selected={pick?.[side] === w.id}
                    disabled={disabled}
                    onSelect={() => pickWrinkle(side, w.id)}
                    title={w.label}
                    description={w.blurb}
                    meta={<Badge tone={chip.tone}>{chip.label}</Badge>}
                  />
                )
              })}
            </OptionGroup>
          </div>
        ))}
      </div>

      <p className="mt-3 text-small leading-snug text-muted">Opponents study film — rotate your wrinkles.</p>
    </Card>
  )
}

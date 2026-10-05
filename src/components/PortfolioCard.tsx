import { FileText } from 'lucide-react'
import { portfolioItems, type PitchTag } from '../game/engine/portfolio'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card } from '../ui/kit'

const TAG_LABEL: Record<PitchTag, string> = {
  eye: 'Eye for talent',
  builder: 'Builder',
  winner: 'Winner',
  teacher: 'Developer',
  conviction: 'Conviction',
}

/**
 * Your Résumé (G4).
 *
 * The paper trail the rest of the game leaves behind — ledger hits, pound-the-
 * table calls, players you developed, trades you won, winning seasons. Each
 * interview you pitch these back to the club that wants them.
 */
export function PortfolioCard({ className }: { className?: string }) {
  const career = useGame((s) => s.career)!
  const league = useWorld()
  const items = portfolioItems(league, career).slice(0, 6)

  return (
    <Card className={className}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 font-display text-lg font-700 uppercase tracking-wide">
          <FileText size={15} className="text-[var(--team)]" /> Your Résumé
        </h3>
        {items.length > 0 && <Badge tone="gold">{items.length} shown</Badge>}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted">
          Nothing on the résumé yet — hits, developed players and won trades land here.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="rounded-lg border border-line p-2.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-600 text-ink">{item.label}</span>
                <span className="shrink-0 font-cond text-[10px] font-700 uppercase text-muted">
                  str {item.strength}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-muted">{item.detail}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {item.tags.map((t) => (
                  <Badge key={t} tone="neutral">
                    {TAG_LABEL[t]}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

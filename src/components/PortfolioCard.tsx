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
        <h3 className="flex items-center gap-1.5 font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">
          <FileText size={15} className="text-[var(--team-accent)]" aria-hidden /> Your Résumé
        </h3>
        {items.length > 0 && <Badge tone="neutral">{items.length} shown</Badge>}
      </div>
      {items.length === 0 ? (
        <p className="text-body text-muted">
          Nothing on the résumé yet — hits, developed players and won trades land here.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="rounded-[var(--r-md)] border border-line p-2.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-body font-600 text-ink">{item.label}</span>
                <span className="shrink-0 font-cond text-label font-700 uppercase tracking-[0.06em] text-muted tnum">
                  str {item.strength}
                </span>
              </div>
              <p className="mt-0.5 truncate text-label text-muted">{item.detail}</p>
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

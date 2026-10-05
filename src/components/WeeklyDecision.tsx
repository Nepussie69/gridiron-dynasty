import { AlertTriangle, Gavel } from 'lucide-react'
import { cn } from '../lib/cn'
import { useGame, useWorld } from '../store/gameStore'
import { currentDilemma } from '../game/engine/dilemma'
import { Badge, Card } from '../ui/kit'

/**
 * The week's ONE big decision (#2).
 *
 * One card at the centre of the week that needs a call. Everything else in the
 * week is optional. Each choice trades wins against culture against reputation;
 * none of them is "correct". Placed at the top of the Dashboard so it's the
 * first thing the player sees when a new week opens.
 */
export function WeeklyDecision({ className }: { className?: string }) {
  const career = useGame((s) => s.career)!
  const league = useWorld()
  const resolveDilemma = useGame((s) => s.resolveDilemma)
  const card = currentDilemma(league, career)
  if (!card) return null

  const resolved = card.resolved ? card.choices.find((c) => c.id === card.resolved) : null

  return (
    <Card className={cn('overflow-hidden border-[var(--team)]', className)} pad={false}>
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2">
        <Gavel size={15} className="text-[var(--team)]" />
        <span className="label">The Decision · Week {card.week}</span>
        <Badge tone={resolved ? 'win' : 'warn'} className="ml-auto">
          {resolved ? 'Resolved' : 'Needs a call'}
        </Badge>
      </div>

      <div className="p-4">
        <h3 className="font-display text-xl font-700 uppercase tracking-wide text-ink">{card.title}</h3>
        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted">{card.body}</p>

        {!resolved && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {card.choices.map((c) => (
              <button
                key={c.id}
                onClick={() => resolveDilemma(c.id)}
                className="group rounded-xl border border-line bg-surface p-3 text-left transition hover:border-[var(--team)] hover:bg-[var(--team-soft)]"
              >
                <div className="font-cond text-sm font-700 uppercase tracking-wide text-ink">{c.label}</div>
                <div className="mt-1 text-xs leading-relaxed text-muted">{c.blurb}</div>
                <div className="mt-2 text-[10px] font-700 uppercase tracking-wide text-[var(--team)] opacity-0 transition group-hover:opacity-100">
                  Make the call →
                </div>
              </button>
            ))}
          </div>
        )}

        {resolved && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-surface-2 p-3">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
            <div className="text-sm leading-relaxed text-ink-2">
              <strong className="font-600 text-ink">{resolved.label}:</strong> {resolved.outcome}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

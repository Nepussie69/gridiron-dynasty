import { MessageSquareQuote } from 'lucide-react'
import { cn } from '../lib/cn'
import { careerVoices, type Voice } from '../game/engine/voices'
import { useGame, useWorld } from '../store/gameStore'
import { Card } from '../ui/kit'

const DOT: Record<Voice['tone'], string> = {
  win: 'bg-win',
  loss: 'bg-loss',
  warn: 'bg-warn',
  info: 'bg-brand',
  gold: 'bg-gold',
}

/**
 * Reputation is people, not bars (#4) — presentation only.
 *
 * The five reputation bars remain the engine; this card puts human voices on
 * top of them. Six people with something to say about you right now, each
 * reading off your actual state (security, results, leadership, the Ledger,
 * cap work, profile). Quotes move as the career moves.
 */
export function VoicesCard({ className }: { className?: string }) {
  const career = useGame((s) => s.career)!
  const league = useWorld()
  const voices = careerVoices(league, career)

  return (
    <Card className={className}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 font-display text-lg font-700 uppercase tracking-wide">
          <MessageSquareQuote size={15} className="text-[var(--team)]" /> What They&apos;re Saying
        </h3>
      </div>
      <div className="space-y-3">
        {voices.map((v) => (
          <div key={v.id} className="flex gap-2.5">
            <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', DOT[v.tone])} aria-hidden />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="font-cond text-label font-700 uppercase tracking-[0.06em] text-faint">{v.role}</span>
                <span className="text-label font-600 text-ink-2">{v.name}</span>
              </div>
              <p className="text-small leading-snug text-muted">&ldquo;{v.quote}&rdquo;</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

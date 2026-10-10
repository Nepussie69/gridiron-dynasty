import { useState } from 'react'
import { AlertTriangle, Gavel } from 'lucide-react'
import { useGame, useWorld } from '../store/gameStore'
import { currentDilemma } from '../game/engine/dilemma'
import { Card, ConfirmSheet, OptionCard, OptionGroup, VerdictChip, type Consequence } from '../ui/kit'

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
  const [pending, setPending] = useState<string | null>(null)
  const card = currentDilemma(league, career)
  if (!card) return null

  const resolved = card.resolved ? card.choices.find((c) => c.id === card.resolved) : null
  const choice = pending ? card.choices.find((c) => c.id === pending) ?? null : null
  const consequences: Consequence[] = choice
    ? [
        { label: 'Your call', value: choice.label },
        { label: 'What it trades', value: choice.blurb },
        { label: 'When it lands', value: 'Immediately — this week, and it stays on your record' },
      ]
    : []

  return (
    <>
      <Card tier="call" callLabel={resolved ? 'Resolved' : 'Needs a call'} className={className}>
        <div className="flex items-center gap-2">
          <Gavel size={15} className="text-warn" aria-hidden />
          <span className="label">The Decision · Week {card.week}</span>
          <span className="ml-auto">
            <VerdictChip tone={resolved ? 'win' : 'warn'}>{resolved ? 'Resolved' : 'Needs a call'}</VerdictChip>
          </span>
        </div>

        <h3 className="mt-2 font-display text-xl font-800 italic uppercase leading-none text-ink">{card.title}</h3>
        <p className="mt-1.5 max-w-3xl text-body leading-relaxed text-muted">{card.body}</p>

        {!resolved && (
          <OptionGroup label="Your call" className="mt-4 sm:grid-cols-2">
            {card.choices.map((c) => (
              <OptionCard
                key={c.id}
                selected={false}
                title={c.label}
                description={c.blurb}
                onSelect={() => setPending(c.id)}
              />
            ))}
          </OptionGroup>
        )}

        {resolved && (
          <div className="mt-3 flex items-start gap-2 rounded-[var(--r-md)] bg-surface-2 p-3">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            <div className="text-body leading-relaxed text-ink-2">
              <strong className="font-600 text-ink">{resolved.label}:</strong> {resolved.outcome}
            </div>
          </div>
        )}
      </Card>

      {/* The call is one-way: review it before it lands on the record. */}
      <ConfirmSheet
        open={!!choice}
        onClose={() => setPending(null)}
        eyebrow={`Week ${card.week}`}
        title={card.title}
        subtitle="Your one call this week — it can't be taken back."
        consequences={consequences}
        destructive={false}
        confirmLabel={choice ? `Make the call: ${choice.label}` : 'Make the call'}
        ledgerNote="Logged on your record"
        onConfirm={() => {
          if (!pending) return
          resolveDilemma(pending)
          setPending(null)
        }}
      />
    </>
  )
}

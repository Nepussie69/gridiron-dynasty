import { useState } from 'react'
import { Check, CheckCircle2, Circle } from 'lucide-react'
import { cn } from '../lib/cn'
import { pitchBonus, portfolioItems, teamWants, type PitchTag } from '../game/engine/portfolio'
import type { JobOffer } from '../game/types'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Dialog, TeamCrest } from '../ui/kit'

const TAG_LABEL: Record<PitchTag, string> = {
  eye: 'Eye for talent',
  builder: 'Builder',
  winner: 'Winner',
  teacher: 'Developer',
  conviction: 'Conviction',
}

/**
 * Portfolio interviews (G4).
 *
 * Before the interview rolls, you pick up to three résumé items to pitch. Each
 * club — its owner personality plus the rung you're chasing — wants certain
 * tags, and matching items count double. The pitch can only help: it raises
 * citations toward the same ceiling that already exists.
 */
export function InterviewPrep({ offer, onCancel }: { offer: JobOffer; onCancel: () => void }) {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const acceptOffer = useGame((s) => s.acceptOffer)
  const [picked, setPicked] = useState<string[]>([])

  const items = portfolioItems(league, career)
  const wants = teamWants(offer, career.path)
  const { bonus } = pitchBonus(offer, career.path, items, picked)
  const team = league.byId[offer.teamId]

  const toggle = (id: string) => {
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= 3) return prev
      return [...prev, id]
    })
  }

  return (
    <Dialog
      open
      onClose={onCancel}
      eyebrow={`Interview · ${offer.title}`}
      title={team.tier === 'NFL' ? `${team.city} ${team.name}` : team.name}
      subtitle="Pitch up to three résumé items. Matches count double."
      footer={
        <>
          <span className="self-center text-small text-muted sm:mr-auto">
            Pitch strength <span className="font-display text-[20px] font-800 italic tnum text-ink">+{bonus}</span>
          </span>
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              acceptOffer(offer, picked)
              onCancel()
            }}
          >
            Take the interview
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-3">
        <TeamCrest team={team} size={40} />
        <div className="min-w-0">
          <div className="label mb-1.5">What they want</div>
          <div className="flex flex-wrap gap-1.5">
            {wants.map((t) => (
              <Badge key={t} tone="neutral">
                {TAG_LABEL[t]}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="label">Pitch your résumé</div>
          <span className="font-cond text-label font-700 uppercase tracking-[0.07em] text-muted tnum">{picked.length}/3 picked</span>
        </div>
        {items.length === 0 ? (
          <p className="text-body text-muted">Nothing on the résumé yet — hits, developed players and won trades land here.</p>
        ) : (
          <div className="space-y-1.5">
            {items.map((item) => {
              const selected = picked.includes(item.id)
              const matches = item.tags.some((t) => wants.includes(t))
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggle(item.id)}
                  className={cn(
                    'motion pointer-coarse:min-h-11 flex w-full items-start gap-2.5 rounded-[var(--r-md)] border px-2.5 py-2 text-left',
                    selected ? 'border-line-strong bg-surface-3' : matches ? 'border-line-strong bg-surface-2' : 'border-line bg-surface-2 hover:border-line-strong',
                  )}
                >
                  {selected ? (
                    <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-ink-2" aria-hidden />
                  ) : (
                    <Circle size={15} className="mt-0.5 shrink-0 text-faint" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-body font-600 text-ink">{item.label}</span>
                      <span className="shrink-0 font-cond text-label font-700 uppercase tracking-[0.06em] text-muted tnum">
                        str {item.strength}
                      </span>
                      {matches && (
                        <Badge tone="neutral">
                          <Check size={11} aria-hidden /> Match
                        </Badge>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-label text-muted">{item.detail}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {item.tags.map((t) => (
                        <Badge key={t} tone="neutral">
                          {TAG_LABEL[t]}
                        </Badge>
                      ))}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </Dialog>
  )
}

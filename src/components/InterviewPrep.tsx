import { useState } from 'react'
import { CheckCircle2, Circle, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { pitchBonus, portfolioItems, teamWants, type PitchTag } from '../game/engine/portfolio'
import type { JobOffer } from '../game/types'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, TeamCrest } from '../ui/kit'

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
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="relative max-h-[90vh] w-full max-w-[600px] overflow-y-auto rounded-2xl border border-line bg-canvas p-5 shadow-2xl">
        <button
          onClick={onCancel}
          className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-lg bg-surface-2 text-muted hover:text-ink"
        >
          <X size={16} />
        </button>

        <div className="mb-4 flex items-center gap-3 pr-10">
          <TeamCrest team={team} size={44} />
          <div className="min-w-0">
            <div className="label">Interview · {offer.title}</div>
            <h2 className="font-display text-2xl font-700 uppercase leading-none">
              {team.tier === 'NFL' ? `${team.city} ${team.name}` : team.name}
            </h2>
          </div>
        </div>

        <div className="mb-4">
          <div className="label mb-1.5">What they want</div>
          <div className="flex flex-wrap gap-1.5">
            {wants.map((t) => (
              <Badge key={t} tone="team">
                {TAG_LABEL[t]}
              </Badge>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-1.5 flex items-center justify-between">
            <div className="label">Pitch your résumé</div>
            <span className="font-cond text-[11px] font-700 uppercase text-muted">{picked.length}/3 picked</span>
          </div>
          {items.length === 0 ? (
            <p className="text-sm text-muted">Nothing on the résumé yet — hits, developed players and won trades land here.</p>
          ) : (
            <div className="space-y-1.5">
              {items.map((item) => {
                const selected = picked.includes(item.id)
                const matches = item.tags.some((t) => wants.includes(t))
                return (
                  <button
                    key={item.id}
                    onClick={() => toggle(item.id)}
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition',
                      selected
                        ? 'border-[var(--team)] bg-[var(--team-soft)]'
                        : matches
                          ? 'border-[var(--team)]/40 bg-surface-2'
                          : 'border-line bg-surface-2 hover:border-line-strong',
                    )}
                  >
                    {selected ? (
                      <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[var(--team)]" />
                    ) : (
                      <Circle size={15} className="mt-0.5 shrink-0 text-faint" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs font-600 text-ink">{item.label}</span>
                        <span className="shrink-0 font-cond text-[10px] font-700 uppercase text-muted">
                          str {item.strength}
                        </span>
                        {matches && <Badge tone="team">Match</Badge>}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted">{item.detail}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {item.tags.map((t) => (
                          <Badge key={t} tone={wants.includes(t) ? 'team' : 'neutral'}>
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

        <div className="flex items-center justify-between border-t border-line pt-3">
          <span className="text-xs text-muted">
            Pitch strength{' '}
            <span className="font-display text-lg font-700 tnum text-ink">+{bonus}</span>
          </span>
          <Button variant="primary" size="lg" onClick={() => { acceptOffer(offer, picked); onCancel() }}>
            Interview
          </Button>
        </div>
      </div>
    </div>
  )
}

import { CheckCircle2, Circle, Plus, Target, X } from 'lucide-react'
import { MAX_AMBITIONS, makeAmbitionPool } from '../game/engine/ambitions'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, IconButton, OptionCard, OptionGroup } from '../ui/kit'

/**
 * Personal ambitions (#11).
 *
 * Up to three goals the player chooses for themselves each season — deliberately
 * different from the objectives the job assigns. Met ambitions pay a small
 * reputation dividend at season review; the menu is deterministic per season.
 */
export function AmbitionsCard({ className }: { className?: string }) {
  const career = useGame((s) => s.career)!
  const league = useWorld()
  const pickAmbition = useGame((s) => s.pickAmbition)
  const dropAmbition = useGame((s) => s.dropAmbition)

  const chosen = career.ambitions ?? []
  const pool = makeAmbitionPool(league, career)
  const open = pool.filter((a) => !chosen.some((c) => c.id === a.id))
  const inSeason = league.phase === 'regular'
  const graded = chosen.length > 0 && chosen.every((a) => a.done !== undefined)
  const met = chosen.filter((a) => a.done).length

  return (
    <Card className={className}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">
          <Target size={15} className="text-[var(--team-accent)]" aria-hidden /> Ambitions
        </h3>
        <Badge tone={graded ? (met === chosen.length ? 'win' : 'neutral') : 'neutral'}>
          {graded ? `${met}/${chosen.length} met` : `${chosen.length}/${MAX_AMBITIONS}`}
        </Badge>
      </div>

      {chosen.length > 0 ? (
        <div className="space-y-1.5">
          {chosen.map((a) => (
            <div key={a.id} className="flex items-start gap-2 rounded-[var(--r-md)] border border-line px-2.5 py-2">
              {a.done === undefined ? (
                <Circle size={14} className="mt-0.5 shrink-0 text-faint" aria-hidden />
              ) : a.done ? (
                <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-win" aria-hidden />
              ) : (
                <X size={14} className="mt-0.5 shrink-0 text-loss" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-body font-600 text-ink">{a.label}</div>
                <div className="text-label leading-snug text-muted">{a.blurb}</div>
              </div>
              {inSeason && a.done === undefined && (
                <IconButton label="Drop this ambition" size="sm" variant="ghost" onClick={() => dropAmbition(a.id)}>
                  <X size={14} aria-hidden />
                </IconButton>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-body text-muted">
          {inSeason
            ? 'Pick a goal you actually want. Up to three a season.'
            : 'A fresh slate of ambitions opens next season.'}
        </p>
      )}

      {inSeason && chosen.length < MAX_AMBITIONS && open.length > 0 && (
        <div className="mt-3">
          <div className="label mb-1.5">Add an ambition</div>
          <OptionGroup label="Ambition pool">
            {open.map((a) => (
              <OptionCard
                key={a.id}
                selected={false}
                title={a.label}
                description={a.blurb}
                meta={<Plus size={14} className="text-muted" aria-hidden />}
                onSelect={() => pickAmbition(a.id)}
              />
            ))}
          </OptionGroup>
        </div>
      )}
    </Card>
  )
}

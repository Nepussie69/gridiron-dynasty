import { CheckCircle2, Circle, Plus, Target, X } from 'lucide-react'
import { MAX_AMBITIONS, makeAmbitionPool } from '../game/engine/ambitions'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card } from '../ui/kit'

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
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 font-display text-lg font-700 uppercase tracking-wide">
          <Target size={15} className="text-[var(--team)]" /> Ambitions
        </h3>
        <Badge tone={graded ? (met === chosen.length ? 'win' : 'neutral') : 'team'}>
          {graded ? `${met}/${chosen.length} met` : `${chosen.length}/${MAX_AMBITIONS}`}
        </Badge>
      </div>

      {chosen.length > 0 ? (
        <div className="space-y-1.5">
          {chosen.map((a) => (
            <div key={a.id} className="flex items-start gap-2 rounded-lg border border-line px-2.5 py-2">
              {a.done === undefined ? (
                <Circle size={14} className="mt-0.5 shrink-0 text-faint" />
              ) : a.done ? (
                <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-win" />
              ) : (
                <X size={14} className="mt-0.5 shrink-0 text-loss" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-600 text-ink">{a.label}</div>
                <div className="text-[11px] leading-snug text-muted">{a.blurb}</div>
              </div>
              {inSeason && a.done === undefined && (
                <button
                  onClick={() => dropAmbition(a.id)}
                  className="mt-0.5 text-faint transition hover:text-loss"
                  title="Drop this ambition"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">
          {inSeason
            ? 'Pick a goal you actually want. Up to three a season.'
            : 'A fresh slate of ambitions opens next season.'}
        </p>
      )}

      {inSeason && chosen.length < MAX_AMBITIONS && open.length > 0 && (
        <div className="mt-3">
          <div className="label mb-1.5">Add an ambition</div>
          <div className="space-y-1">
            {open.map((a) => (
              <button
                key={a.id}
                onClick={() => pickAmbition(a.id)}
                className="group flex w-full items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-left transition hover:border-[var(--team)] hover:bg-[var(--team-soft)]"
              >
                <Plus size={13} className="shrink-0 text-[var(--team)]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-600 text-ink">{a.label}</span>
                  <span className="block text-[11px] leading-snug text-muted">{a.blurb}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

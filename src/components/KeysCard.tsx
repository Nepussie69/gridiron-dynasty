import { Target } from 'lucide-react'
import { cn } from '../lib/cn'
import { canPickKeys, keyEstimate, pickableKeys, MAX_KEYS, type GameKeyId } from '../game/engine/keys'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card } from '../ui/kit'

const TONE: Record<string, 'win' | 'info' | 'warn'> = { Likely: 'win', 'Coin flip': 'info', 'Long shot': 'warn' }

/**
 * L12 W2 — keys to the game.
 *
 * Before kickoff a coach promises up to two keys he believes decide the game.
 * They have no sim effect; they are graded from the final box score. A
 * coordinator may only promise keys for his side of the ball.
 */
export function KeysCard({
  oppId,
  dark,
  locked,
  className,
}: {
  oppId?: string
  /** Dark styling for the in-game panel. */
  dark?: boolean
  /** Once kickoff has passed, the promise is final. */
  locked?: boolean
  className?: string
}) {
  const career = useGame((s) => s.career)!
  const world = useWorld()
  const toggleKey = useGame((s) => s.toggleKey)

  if (!canPickKeys(career)) return null
  const keys = pickableKeys(career)
  const picked =
    career.keys && career.keys.season === world.season && career.keys.week === world.week ? career.keys.ids : []
  const done = picked.length >= MAX_KEYS

  return (
    <Card className={cn(dark && 'border-white/15 bg-white/5', className)}>
      <div className="mb-3 flex items-center justify-between">
        <h3
          className={cn(
            'flex items-center gap-1.5 font-display text-lg font-700 uppercase tracking-wide',
            dark && 'text-white',
          )}
        >
          <Target size={15} className={dark ? 'text-white/80' : 'text-[var(--team)]'} /> Keys to the game
        </h3>
        <Badge tone={done ? 'win' : 'team'}>
          {picked.length}/{MAX_KEYS} picked
        </Badge>
      </div>

      <div className="grid gap-1.5 sm:grid-cols-2">
        {keys.map((k) => {
          const selected = picked.includes(k.id)
          const estimate = oppId ? keyEstimate(world, career.teamId, oppId, k.id as GameKeyId) : null
          return (
            <button
              key={k.id}
              type="button"
              disabled={locked}
              onClick={() => toggleKey(k.id)}
              className={cn(
                'flex items-start gap-2 rounded-lg border p-2.5 text-left transition',
                selected
                  ? dark
                    ? 'border-white bg-white/20'
                    : 'border-[var(--team)] bg-[var(--team-soft)]'
                  : dark
                    ? 'border-white/15 bg-white/5 hover:border-white/40'
                    : 'border-line bg-surface-2 hover:border-[var(--team)] hover:bg-[var(--team-soft)]',
                locked && 'opacity-70',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className={cn('block text-xs font-600', dark ? 'text-white' : 'text-ink')}>{k.label}</span>
                <span className={cn('block text-[11px] leading-snug', dark ? 'text-white/55' : 'text-muted')}>
                  {k.blurb}
                </span>
              </span>
              {estimate && <Badge tone={TONE[estimate]}>{estimate}</Badge>}
            </button>
          )
        })}
      </div>

      <p className={cn('mt-3 text-[11px] leading-snug', dark ? 'text-white/50' : 'text-muted')}>
        {locked
          ? 'Kickoff has passed — the promises are locked in.'
          : picked.length === 0
            ? 'Pick up to two. Promise nothing and nothing is graded.'
            : 'Both keys hit earns a little leadership; neither costs you.'}
      </p>
    </Card>
  )
}

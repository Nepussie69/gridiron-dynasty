import { Target } from 'lucide-react'
import { cn } from '../lib/cn'
import { canPickKeys, keyEstimate, pickableKeys, MAX_KEYS, type GameKeyId } from '../game/engine/keys'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, OptionCard, OptionGroup } from '../ui/kit'

// Long-shot keys are neutral: a coin flip or a long shot is not a problem for
// you. Only a likely key earns the win tone.
const TONE: Record<string, 'win' | 'info' | 'neutral'> = { Likely: 'win', 'Coin flip': 'info', 'Long shot': 'neutral' }

/**
 * L12 W2 — keys to the game.
 *
 * Before kickoff a coach promises up to two keys he believes decide the game.
 * They have no sim effect; they are graded from the final box score. A
 * coordinator may only promise keys for his side of the ball. Options are kit
 * OptionCards; `dark` scopes the card to the always-dark Game Day broadcast.
 */
export function KeysCard({
  oppId,
  dark,
  locked,
  disabled = false,
  className,
}: {
  oppId?: string
  /** Dark styling for the in-game panel. */
  dark?: boolean
  /** Once kickoff has passed, the promise is final. */
  locked?: boolean
  /** Access 'view': show the keys without letting them be picked. */
  disabled?: boolean
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
  const off = locked || disabled

  const card = (
    <Card className={className}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-display text-lg font-700 uppercase tracking-wide">
          <Target size={15} className="text-[var(--team-accent)]" aria-hidden /> Keys to the game
        </h3>
        <Badge tone={done ? 'win' : 'neutral'}>
          {picked.length}/{MAX_KEYS} picked
        </Badge>
      </div>

      <OptionGroup label="Keys to the game" className="sm:grid-cols-2">
        {keys.map((k) => {
          const selected = picked.includes(k.id)
          const estimate = oppId ? keyEstimate(world, career.teamId, oppId, k.id as GameKeyId) : null
          return (
            <OptionCard
              key={k.id}
              selected={selected}
              disabled={off}
              onSelect={() => toggleKey(k.id)}
              title={k.label}
              description={k.blurb}
              meta={estimate ? <Badge tone={TONE[estimate]}>{estimate}</Badge> : undefined}
            />
          )
        })}
      </OptionGroup>

      <p className={cn('mt-3 text-small leading-snug text-muted')}>
        {locked
          ? 'Kickoff has passed — the promises are locked in.'
          : picked.length === 0
            ? 'Pick up to two. Promise nothing and nothing is graded.'
            : 'Both keys hit earns a little leadership; neither costs you.'}
      </p>
    </Card>
  )

  return dark ? <div className="broadcast">{card}</div> : card
}

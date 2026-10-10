import { Star, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { canShadow, findShadowPlayer, isOnShadowBoard, MAX_SHADOW } from '../game/engine/shadow'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, Delta, IconButton, OvrBadge } from '../ui/kit'

/**
 * G1: the Shadow Board.
 *
 * Personnel rungs with proScout rank up to ten players who are NOT on their
 * club — opponents' rosters or free agents. At season end the risers pay off.
 * The card lists each entry with his current team, OVR now vs. at add, and age.
 */
export function ShadowBoardCard({ className }: { className?: string }) {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const toggleShadowBoard = useGame((s) => s.toggleShadowBoard)

  if (!canShadow(career)) return null
  const board = career.shadowBoard ?? []

  return (
    <Card className={className}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 font-display text-[20px] font-800 italic uppercase leading-none text-ink">
          <Star size={15} className="text-[var(--team-accent)]" /> Shadow Board
        </h3>
        <Badge tone="neutral">
          {board.length}/{MAX_SHADOW}
        </Badge>
      </div>

      {board.length ? (
        <div className="space-y-1.5">
          {board.map((e) => {
            const p = findShadowPlayer(league, e.playerId)
            const team = p?.teamId ? league.byId[p.teamId] : undefined
            const now = p?.ovr ?? e.ovrAtAdd
            const drift = now - e.ovrAtAdd
            return (
              <div key={e.playerId} className="flex items-center gap-2 rounded-[var(--r-md)] border border-line px-2.5 py-1.5">
                <OvrBadge value={now} pot={p?.pot} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-small font-600 text-ink">
                    {e.name} <span className="font-cond text-label font-700 uppercase text-muted">{e.pos}</span>
                  </div>
                  <div className="truncate text-label text-muted">
                    {team ? team.abbr : 'FA'} · age {p?.age ?? '—'} · added at {e.ovrAtAdd}
                  </div>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-[var(--r-xs)] px-1.5 py-0.5 font-cond text-label font-700 uppercase tracking-wide',
                    drift > 0 ? 'bg-win-soft text-win' : drift < 0 ? 'bg-loss-soft text-loss' : 'bg-surface-3 text-ink-2',
                  )}
                  title={`Overall since he was added (${e.ovrAtAdd} → ${now})`}
                >
                  <Delta value={drift} />
                </span>
                <IconButton label={`Remove ${e.name} from the shadow board`} size="lg" variant="ghost" onClick={() => toggleShadowBoard(e.playerId)}>
                  <X size={16} />
                </IconButton>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-small leading-snug text-muted">
          Track up to {MAX_SHADOW} players on other clubs or in free agency. At season end, the risers pay
          you back.
        </p>
      )}
    </Card>
  )
}

/**
 * The ☆ toggle shown on any non-own player row. Filled when the player is on
 * the board. stopPropagation keeps it from also selecting the row.
 */
export function ShadowStar({ playerId, className }: { playerId: string; className?: string }) {
  const career = useGame((s) => s.career)
  const toggleShadowBoard = useGame((s) => s.toggleShadowBoard)

  if (!career || !canShadow(career)) return null
  const on = isOnShadowBoard(career, playerId)

  return (
    <button
      type="button"
      title={on ? 'Remove from shadow board' : 'Add to shadow board'}
      aria-label={on ? 'Remove from shadow board' : 'Add to shadow board'}
      aria-pressed={on}
      onClick={(e) => {
        e.stopPropagation()
        toggleShadowBoard(playerId)
      }}
      className={cn(
        'grid h-7 w-7 shrink-0 place-items-center rounded-[var(--r-md)] border border-line transition pointer-coarse:h-11 pointer-coarse:w-11',
        on ? 'border-transparent text-[var(--team-accent)]' : 'text-faint hover:border-[var(--team-accent)] hover:text-ink',
        className,
      )}
    >
      <Star size={14} fill={on ? 'currentColor' : 'none'} />
    </button>
  )
}

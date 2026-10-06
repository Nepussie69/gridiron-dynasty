import { Star, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { canShadow, findShadowPlayer, isOnShadowBoard, MAX_SHADOW } from '../game/engine/shadow'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, OvrBadge } from '../ui/kit'

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
        <h3 className="flex items-center gap-1.5 font-display text-lg font-700 uppercase tracking-wide">
          <Star size={15} className="text-[var(--team)]" /> Shadow Board
        </h3>
        <Badge tone="team">
          {board.length}/{MAX_SHADOW}
        </Badge>
      </div>

      {board.length ? (
        <div className="space-y-1.5">
          {board.map((e) => {
            const p = findShadowPlayer(league, e.playerId)
            const team = p?.teamId ? league.byId[p.teamId] : undefined
            return (
              <div
                key={e.playerId}
                className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5"
              >
                <OvrBadge value={p?.ovr ?? e.ovrAtAdd} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-600 text-ink">
                    {e.name}{' '}
                    <span className="font-cond text-[11px] font-700 uppercase text-muted">{e.pos}</span>
                  </div>
                  <div className="truncate text-[11px] text-muted">
                    {team ? team.abbr : 'FA'} · {e.ovrAtAdd} → {p?.ovr ?? e.ovrAtAdd} OVR · age {p?.age ?? '—'}
                  </div>
                </div>
                <button
                  type="button"
                  title="Remove from shadow board"
                  onClick={() => toggleShadowBoard(e.playerId)}
                  className="shrink-0 text-faint transition hover:text-loss"
                >
                  <X size={13} />
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-sm leading-snug text-muted">
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
      onClick={(e) => {
        e.stopPropagation()
        toggleShadowBoard(playerId)
      }}
      className={cn(
        'grid h-6 w-6 shrink-0 place-items-center rounded-md border border-line transition',
        on ? 'border-transparent text-[var(--team)]' : 'text-faint hover:border-[var(--team)] hover:text-ink',
        className,
      )}
    >
      <Star size={13} fill={on ? 'currentColor' : 'none'} />
    </button>
  )
}

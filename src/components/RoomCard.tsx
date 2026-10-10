import { CheckCircle2, Circle, Dumbbell } from 'lucide-react'
import { cn } from '../lib/cn'
import { MAX_ROOM_FOCUS, MAX_ROOM_REPS, hasRoom, roomBudget, roomPlayers } from '../game/engine/room'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, SegmentedControl } from '../ui/kit'

/**
 * Your Room (G3).
 *
 * The young, growing players on your side of the ball. Pick up to three focus
 * players and a practice plan; the reps you bank with the weekly Run drills
 * action buy the season's development budget. Nothing here spends the budget —
 * it is paid out at season end, so the room is a plan, not an instant boost.
 */
export function RoomCard({ className }: { className?: string }) {
  const career = useGame((s) => s.career)!
  const league = useWorld()
  const toggleRoomFocus = useGame((s) => s.toggleRoomFocus)
  const setRoomPlan = useGame((s) => s.setRoomPlan)

  if (!hasRoom(career)) return null

  const players = roomPlayers(league, career)
  const room = career.room ?? { focus: [] as string[], plan: 'concentrate' as const, reps: 0 }
  const focus = room.focus
  const plan = room.plan
  const reps = Math.min(room.reps ?? 0, MAX_ROOM_REPS)
  const budget = roomBudget(career)

  return (
    <Card className={className}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">
          <Dumbbell size={15} className="text-[var(--team-accent)]" aria-hidden /> Your Room
        </h3>
        <Badge tone="neutral">
          {focus.length}/{MAX_ROOM_FOCUS} focus
        </Badge>
      </div>

      {players.length > 0 ? (
        <div className="space-y-1">
          {players.map((p) => {
            const focused = focus.includes(p.id)
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={focused}
                onClick={() => toggleRoomFocus(p.id)}
                className={cn(
                  'motion flex min-h-11 w-full items-center gap-2.5 rounded-[var(--r-md)] border px-2.5 py-1.5 text-left',
                  focused ? 'border-line-strong bg-surface-3' : 'border-line bg-surface-2 hover:border-line-strong',
                )}
              >
                {focused ? (
                  <CheckCircle2 size={14} className="shrink-0 text-ink-2" aria-hidden />
                ) : (
                  <Circle size={14} className="shrink-0 text-faint" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate text-body font-600 text-ink">{p.name}</span>
                <span className="w-8 font-cond text-label font-700 uppercase tracking-[0.06em] text-muted">{p.pos}</span>
                <span className="w-14 text-right font-cond text-label tnum text-muted">Age {p.age}</span>
                <span className="w-14 text-right font-cond text-label font-700 tnum text-ink-2">
                  {p.ovr} → {p.pot}
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <p className="text-body text-muted">No young players on your side with room to grow.</p>
      )}

      <div className="mt-3">
        <div className="label mb-1.5">Practice plan</div>
        <SegmentedControl
          label="Practice plan"
          value={plan}
          onChange={setRoomPlan}
          options={[
            { id: 'concentrate', label: 'Concentrate' },
            { id: 'spread', label: 'Spread' },
          ]}
        />
        <p className="mt-1.5 text-label leading-snug text-muted">
          {plan === 'concentrate'
            ? 'Throw the whole budget at your focus players — up to +3 each.'
            : 'Hand out +1 at a time across the entire room.'}
        </p>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
        <span className="text-label text-muted">
          Reps banked: <span className="font-700 tnum text-ink">{reps}</span> / {MAX_ROOM_REPS}
        </span>
        <span className="text-label text-muted">
          Projected budget: <span className="font-700 tnum text-ink">{budget}</span> pts
        </span>
      </div>
    </Card>
  )
}

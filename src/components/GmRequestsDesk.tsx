import { Handshake, Trash2 } from 'lucide-react'
import { cn } from '../lib/cn'
import { canAskGm } from '../game/engine/gmAsk'
import { GM_REQUEST_LABEL, gmDeskView, monthKeyOf } from '../game/engine/gmDesk'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card } from '../ui/kit'
import { GmRestructureRequest } from './GmRestructureRequest'

const OUTCOME_TONE: Record<string, 'win' | 'warn' | 'loss'> = {
  done: 'win',
  notNow: 'warn',
  declined: 'loss',
}

const OUTCOME_LABEL: Record<string, string> = { done: 'Agreed', notNow: 'Not now', declined: 'Declined' }

/**
 * L12.14 C6: the GM requests desk. The head coach (and coordinators for their
 * side) cannot sign, trade, cut or restructure — this card is the one place to
 * ask the GM, and it shows his standing, the club's contender read, this
 * month's used slots and the answers that have come back.
 */
export function GmRequestsDesk({ className }: { className?: string }) {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const toggleGmUntouchable = useGame((s) => s.toggleGmUntouchable)
  const selectPlayer = useGame((s) => s.selectPlayer)

  if (!canAskGm(career)) return null

  const view = gmDeskView(league, career, monthKeyOf(league.season, league.week))
  const roster = league.roster[career.teamId] ?? []
  const untouchables = (career.gmUntouchables ?? [])
    .map((id) => roster.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p)
  const requests = [...(career.gmRequests ?? [])].reverse()

  return (
    <Card className={className}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">
          <Handshake size={16} className="text-[var(--team-accent)]" aria-hidden /> GM Requests
        </h3>
        <div className="flex items-center gap-1.5">
          <Badge tone={view.contenders.contending ? 'win' : 'neutral'}>
            {view.contenders.contending ? `Contending · #${view.contenders.rank}` : `#${view.contenders.rank} strength`}
          </Badge>
          <Badge tone={view.trust >= 50 ? 'win' : view.trust >= 38 ? 'warn' : 'loss'}>Standing {view.trust}</Badge>
          <Badge tone={view.requestsThisMonth >= 3 ? 'warn' : 'neutral'}>{view.requestsThisMonth}/3 this month</Badge>
        </div>
      </div>

      <p className="mb-3 text-small leading-relaxed text-muted">
        You shape the roster; the GM holds the pen. He answers the same week — leaning yes when your standing and the
        record are strong, no when the mandate is a rebuild or the cap says wait. Each request is answered immediately
        and counts against a limit of three per month (one per player per month).
      </p>

      <GmRestructureRequest compact />

      {untouchables.length > 0 && (
        <div className="mt-3">
          <div className="label mb-1.5">Untouchable in trade talks ({untouchables.length}/3)</div>
          <div className="flex flex-wrap gap-1.5">
            {untouchables.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => toggleGmUntouchable(p.id)}
                title="Remove protection"
                className="motion pointer-coarse:min-h-11 flex items-center gap-1 rounded-[var(--r-md)] border border-line bg-surface-2 px-2 py-1 text-small text-ink-2 hover:border-loss/60 hover:text-loss"
              >
                {p.name}
                <Trash2 size={11} aria-hidden />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <div className="label mb-2">Recent answers</div>
        {requests.length === 0 ? (
          <p className="text-small text-muted">
            No requests yet. Ask from a player profile, the Trade Center, Free Agency or the Cap screen.
          </p>
        ) : (
          <div className="space-y-1.5">
            {requests.slice(0, 8).map((r, i) => (
              <div key={`${r.season}-${r.week}-${i}`} className="flex items-start gap-2 rounded-[var(--r-md)] border border-line px-2.5 py-1.5">
                <Badge tone={OUTCOME_TONE[r.outcome] ?? 'neutral'}>{OUTCOME_LABEL[r.outcome] ?? r.outcome}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-cond text-label font-700 uppercase tracking-[0.07em] text-muted">{GM_REQUEST_LABEL[r.kind]}</span>
                    <button
                      type="button"
                      onClick={() => r.playerId && selectPlayer(r.playerId)}
                      className={cn('truncate text-body font-600 text-ink', r.playerId && 'hover:underline')}
                    >
                      {r.name}
                    </button>
                  </div>
                  <p className="text-label leading-snug text-muted">{r.message}</p>
                </div>
                <span className="shrink-0 font-cond text-label font-700 uppercase tracking-[0.07em] text-faint tnum">
                  S{r.season} W{r.week}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {career.gmRestructureSeason === league.season && (
        <p className="mt-3 rounded-[var(--r-md)] bg-surface-2 p-2.5 text-label text-muted">
          Restructure green-lit this season: a free-agent bid that doesn&apos;t fit will now trigger one automatically.
        </p>
      )}
      {typeof view.contenders.rank === 'number' && view.contenders.contending && (
        <p className="mt-1 text-label text-faint">
          Cap moves are for a push — the GM only restructures while the club reads as a contender.
        </p>
      )}
    </Card>
  )
}

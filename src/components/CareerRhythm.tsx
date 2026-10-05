import { Clock, Flag, Handshake, X } from 'lucide-react'
import { WEEK_HOURS, currentSetPiece, weeklyActions } from '../game/engine/weekly'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card, RatingBar } from '../ui/kit'

/**
 * The weekly rhythm (#5, #6, #8): a 40-hour time budget, the annual set piece,
 * and any stretch assignment on the table. This is what turns a rung from a
 * label into a job with decisions in it.
 */
export function CareerRhythm() {
  const world = useWorld()
  const career = useGame((s) => s.career)!
  const spendHours = useGame((s) => s.spendHours)
  const resolveSetPiece = useGame((s) => s.resolveSetPiece)
  const acceptStretch = useGame((s) => s.acceptStretch)
  const declineStretch = useGame((s) => s.declineStretch)

  const hours = career.hoursLeft ?? WEEK_HOURS
  const actions = weeklyActions(career)
  const piece = currentSetPiece(world, career)
  const stretch = career.stretch

  return (
    <div className="space-y-4">
      {piece && (
        <Card className="border-[var(--team)]">
          <div className="mb-2 flex items-center gap-2">
            <Flag size={16} style={{ color: 'var(--team)' }} />
            <h3 className="font-display text-lg font-700 uppercase tracking-wide">{piece.title}</h3>
            <Badge tone="team" className="ml-auto">Set piece · Week {world.week}</Badge>
          </div>
          <p className="mb-3 text-sm text-muted">{piece.blurb}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {piece.options.map((o) => (
              <button
                key={o.id}
                onClick={() => resolveSetPiece(o.id)}
                className="rounded-lg border border-line p-3 text-left transition hover:border-line-strong hover:bg-surface-2"
              >
                <div className="font-cond text-sm font-700 uppercase text-ink">{o.label}</div>
                <div className="mt-0.5 text-xs text-muted">{o.blurb}</div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {stretch && !stretch.accepted && (
        <Card className="border-[#f3ddb8] bg-[#fdf0dc]">
          <div className="mb-1 flex items-center gap-2">
            <Handshake size={16} className="text-warn" />
            <h3 className="font-display text-lg font-700 uppercase tracking-wide text-ink">
              {stretch.kind === 'interim' ? 'Interim assignment' : 'Stretch assignment'}
            </h3>
          </div>
          <div className="font-cond text-sm font-700 uppercase text-ink">{stretch.label}</div>
          <p className="mt-1 text-xs text-ink-2">{stretch.blurb}</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="team" className="flex-1" onClick={acceptStretch}>Accept</Button>
            <Button size="sm" variant="ghost" onClick={declineStretch}><X size={13} /> Pass</Button>
          </div>
        </Card>
      )}

      {stretch && stretch.accepted && (
        <Card className="bg-surface-2">
          <div className="flex items-center gap-2 text-sm">
            <Handshake size={15} className="text-win" />
            <span className="font-600 text-ink">On assignment: {stretch.label}</span>
            <Badge tone="info" className="ml-auto">resolved at season's end</Badge>
          </div>
        </Card>
      )}

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <Clock size={16} className="text-muted" />
          <h3 className="font-display text-lg font-700 uppercase tracking-wide">This Week</h3>
          <Badge tone={hours <= 10 ? 'warn' : 'team'} className="ml-auto">{hours} / {WEEK_HOURS} hrs</Badge>
        </div>
        <RatingBar value={(hours / WEEK_HOURS) * 100} height={8} color={hours <= 10 ? '#d98207' : 'var(--team)'} />
        <p className="mt-2 text-[11px] text-muted">The job is choosing what not to do. Spend hours, then advance the week.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {actions.map((a) => (
            <button
              key={a.id}
              disabled={hours < a.cost}
              onClick={() => spendHours(a.id)}
              className="flex items-center gap-2 rounded-lg border border-line p-2.5 text-left transition hover:bg-surface-2 disabled:opacity-40"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-xs font-700 text-ink-2">
                {a.cost}
              </span>
              <span className="min-w-0">
                <span className="block font-cond text-xs font-700 uppercase text-ink">{a.label}</span>
                <span className="block truncate text-[11px] text-muted">{a.blurb}</span>
              </span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  )
}

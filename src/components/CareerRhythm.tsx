import { Flag, Handshake, X } from 'lucide-react'
import { currentSetPiece } from '../game/engine/weekly'
import { PracticeCard } from './PracticeCard'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card } from '../ui/kit'

/**
 * The weekly rhythm (#6, #8): the annual set piece and any stretch assignment on
 * the table. The 40-hour budget was removed in L12.9 — a rung's effects now
 * arrive passively (store/advanceWeek), so this is just the season's set pieces.
 */
export function CareerRhythm() {
  const world = useWorld()
  const career = useGame((s) => s.career)!
  const resolveSetPiece = useGame((s) => s.resolveSetPiece)
  const acceptStretch = useGame((s) => s.acceptStretch)
  const declineStretch = useGame((s) => s.declineStretch)

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

      <PracticeCard />
    </div>
  )
}

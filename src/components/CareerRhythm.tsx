import { Flag, Handshake, X } from 'lucide-react'
import { currentSetPiece } from '../game/engine/weekly'
import { PracticeCard } from './PracticeCard'
import { ByeWeekCard } from './ByeWeekCard'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card, OptionCard, OptionGroup } from '../ui/kit'

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
        <Card tier="call" callLabel="Set piece">
          <div className="mb-2 flex items-center gap-2">
            <Flag size={16} className="text-[var(--team-accent)]" aria-hidden />
            <h3 className="font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">{piece.title}</h3>
            <Badge tone="neutral" className="ml-auto">Week {world.week}</Badge>
          </div>
          <p className="mb-3 text-body text-muted">{piece.blurb}</p>
          <OptionGroup label={piece.title} className="sm:grid-cols-2">
            {piece.options.map((o) => (
              <OptionCard key={o.id} selected={false} title={o.label} description={o.blurb} onSelect={() => resolveSetPiece(o.id)} />
            ))}
          </OptionGroup>
        </Card>
      )}

      {stretch && !stretch.accepted && (
        <Card tier="call" callLabel="Stretch assignment">
          <div className="mb-1 flex items-center gap-2">
            <Handshake size={16} className="text-warn" aria-hidden />
            <h3 className="font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">
              {stretch.kind === 'interim' ? 'Interim assignment' : 'Stretch assignment'}
            </h3>
          </div>
          <div className="font-cond text-body font-700 uppercase tracking-[0.02em] text-ink">{stretch.label}</div>
          <p className="mt-1 text-small text-ink-2">{stretch.blurb}</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="primary" className="flex-1" onClick={acceptStretch}>Accept</Button>
            <Button size="sm" variant="secondary" onClick={declineStretch} icon={<X size={13} aria-hidden />}>Pass</Button>
          </div>
        </Card>
      )}

      {stretch && stretch.accepted && (
        <Card className="bg-surface-2">
          <div className="flex items-center gap-2 text-body">
            <Handshake size={15} className="text-win" aria-hidden />
            <span className="font-600 text-ink">On assignment: {stretch.label}</span>
            <Badge tone="neutral" className="ml-auto">resolved at season&rsquo;s end</Badge>
          </div>
        </Card>
      )}

      <ByeWeekCard />

      <PracticeCard />
    </div>
  )
}

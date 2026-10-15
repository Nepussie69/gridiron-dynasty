// ─────────────────────────────────────────────────────────────────────────────
// The draft philosophy card (FUTURES #27 DF3 — UI).
//
// The five-axis stance you file with the room: board (BPA ↔ need), scheme fit,
// trade-down volume, traits vs production and character risk. The middle step of
// every axis is exactly today's sim, so a card left alone changes nothing.
//
// Everything shown comes from the DF1 engine — the axis list, the steps, the
// one-line hints, your own vector and the authority your seat carries (see
// ./draftRoomUi.ts). The only write is the store call the button uses:
// `setDraftPhilosophy(axis, step)`.
// ─────────────────────────────────────────────────────────────────────────────

import { Compass, Megaphone, PenLine } from 'lucide-react'
import { cn } from '../lib/cn'
import {
  PHILOSOPHY_AXES,
  DEFAULT_PHILOSOPHY,
  type RoomSeat,
} from '../game/engine/draftRoom'
import { useGame, useWorld } from '../store/gameStore'
import { AccessBanner, Badge, Card, OptionCard, OptionGroup, SectionTitle, VerdictChip } from '../ui/kit'
import { philosophyView, stanceChips, voiceLine } from './draftRoomUi'

/**
 * A seat's own stance as chips, in axis order. `max` caps how many are shown
 * where space is tight; the rest collapse into "+N" with the full list on the tip.
 */
export function DraftStanceChips({
  seat,
  max = 2,
  className,
}: {
  seat: RoomSeat
  max?: number
  className?: string
}) {
  const chips = stanceChips(seat)
  if (!chips.length) {
    return (
      <span className={cn('text-micro text-faint', className)} title="Holds no non-default stance — grades on talent and need">
        No strong stance
      </span>
    )
  }
  const shown = chips.slice(0, max)
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      {shown.map((c) => (
        <span key={c.axis} title={`${c.label}: ${c.step}`}>
          <VerdictChip tone="neutral">{c.step}</VerdictChip>
        </span>
      ))}
      {chips.length > shown.length && (
        <span
          className="font-cond text-micro font-700 uppercase text-faint"
          title={chips.slice(max).map((c) => `${c.label}: ${c.step}`).join(' · ')}
        >
          +{chips.length - shown.length}
        </span>
      )}
    </span>
  )
}

/**
 * The Draft philosophy card: five axes × three steps, your voice and who holds
 * the pen. Reads the engine; writes through `setDraftPhilosophy`.
 */
export function DraftPhilosophyCard({ className }: { className?: string }) {
  const world = useWorld()
  const career = useGame((s) => s.career)
  const setDraftPhilosophy = useGame((s) => s.setDraftPhilosophy)
  if (!career) return null

  const view = philosophyView(world, career)
  const changed = PHILOSOPHY_AXES.filter((a) => view.vector[a] !== DEFAULT_PHILOSOPHY[a])

  return (
    <Card className={className}>
      <SectionTitle
        right={
          <Badge tone={view.active ? 'win' : 'neutral'}>
            {view.active ? `Set for the ${world.season} draft` : 'Not set — today’s board'}
          </Badge>
        }
      >
        <span className="flex items-center gap-2">
          <Compass size={18} className="text-[var(--team-accent-text)]" aria-hidden /> Draft philosophy
        </span>
      </SectionTitle>

      <AccessBanner
        area="draft"
        always
        className="mb-3"
        message={
          <>
            <b className="font-600 text-ink">{voiceLine(view)}</b>{' '}
            {view.active
              ? 'The room blends these stances and the tilt weighs your club’s own picks.'
              : 'Nothing changes on the board until you set it for this draft.'}
          </>
        }
      />

      <p className="mb-3 text-small leading-snug text-muted">
        Your stance on five axes. The middle step of every axis is the board as it runs today, so an untouched card picks
        exactly the way the club already does. Each seat in the room argues from its own stance — the weight it carries
        is its own authority, not an average.
      </p>

      <div className="space-y-3">
        {view.choices.map((choice) => (
          <div key={choice.axis}>
            <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="label">{choice.label}</span>
              {!changed.includes(choice.axis) && <span className="text-micro text-faint">default</span>}
            </div>
            <OptionGroup label={choice.label} className="sm:grid-cols-3">
              {choice.steps.map((s) => (
                <OptionCard
                  key={s.step}
                  selected={s.selected}
                  disabled={!view.canEdit}
                  onSelect={() => setDraftPhilosophy(choice.axis, s.step)}
                  title={s.step}
                  description={s.hint}
                  meta={s.isDefault ? <span className="text-micro uppercase text-faint">Now</span> : undefined}
                />
              ))}
            </OptionGroup>
          </div>
        ))}
      </div>

      {!view.canEdit && (
        <p className="mt-3 flex items-start gap-1.5 text-small text-muted">
          <PenLine size={13} className="mt-0.5 shrink-0" aria-hidden /> The draft call is above your rung — read the room,
          file your calls, and the philosophy becomes yours when you climb.
        </p>
      )}

      {view.active && (
        <p className="mt-3 flex items-start gap-1.5 text-micro leading-snug text-muted">
          <Megaphone size={12} className="mt-0.5 shrink-0" aria-hidden /> The room’s argument — each seat’s own guy and
          why — is on the Draft War Room in the Room view, and the Ledger grades how it turned out.
        </p>
      )}
    </Card>
  )
}

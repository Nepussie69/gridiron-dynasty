// ─────────────────────────────────────────────────────────────────────────────
// The room on the clock (FUTURES #27).
//
// While the club is on the clock the room is arguing, not filing a board: the pen
// holder's own guy, your guy, and the loudest voice behind them, each with a
// one-line reason in his own words and the authority he carries. It is the same
// `roomArgument` call the pick itself is made from (see ./draftRoomUi.ts), so what
// you read here is what the card goes in on.
//
// Read-only. On a phone the seats stack and the full argument moves into a Sheet.
// ─────────────────────────────────────────────────────────────────────────────

import { Megaphone, Users } from 'lucide-react'
import { useState } from 'react'
import { cn } from '../lib/cn'
import { useGame, useWorld } from '../store/gameStore'
import { Avatar, Badge, Button, Card, Delta, SectionTitle, Sheet, VerdictChip } from '../ui/kit'
import { usePhone } from '../ui/hooks'
import { consensusLine, roomView, voicesView, type VoiceLine } from './draftRoomUi'

function VoiceRow({ line, phone }: { line: VoiceLine; phone: boolean }) {
  return (
    <div
      className={cn(
        'rounded-[var(--r-md)] border p-2.5',
        line.holdsPen || line.isUser ? 'border-line-strong bg-surface-2' : 'border-line bg-surface',
      )}
    >
      <div className="flex items-center gap-2">
        <Avatar name={line.name} size={26} ring={line.holdsPen || line.isUser ? 'accent' : 'line'} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5">
            <span className="truncate font-cond text-small font-700 uppercase tracking-[0.02em] text-ink">{line.name}</span>
            {line.isUser && <Badge tone="team">You</Badge>}
            {line.holdsPen && <Badge tone="neutral">Pen</Badge>}
          </div>
          <div className="truncate text-micro text-muted">
            {line.short} · {line.weightPct}% authority
          </div>
        </div>
        <VerdictChip tone="neutral">{line.pos}</VerdictChip>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-600 text-ink">{line.prospectName}</span>
        <span className="shrink-0 text-micro tnum text-muted">grade {line.grade}</span>
        <Delta value={line.pull} digits={1} />
      </div>
      {!phone && <p className="mt-0.5 text-small leading-snug text-ink-2">“{line.reason}”</p>}
    </div>
  )
}

/**
 * The voices panel: who is arguing for whom, and whether the room is settled.
 * `limit` caps how many seats speak inline (the rest live in the Sheet on phone
 * and in the Room view on desktop).
 */
export function DraftVoices({ className, limit = 3 }: { className?: string; limit?: number }) {
  const world = useWorld()
  const career = useGame((s) => s.career)
  const phone = usePhone()
  const [open, setOpen] = useState(false)
  if (!career) return null
  const view = voicesView(world, career, limit)
  const room = roomView(world, career)
  if (!view.lines.length) return null

  return (
    <Card className={className}>
      <SectionTitle
        right={
          <Badge tone={view.consensus && view.active ? 'win' : 'neutral'}>
            {view.active ? (view.consensus ? 'Consensus' : 'Split room') : 'Arguing'}
          </Badge>
        }
      >
        <span className="flex items-center gap-2">
          <Users size={16} className="text-[var(--team-accent-text)]" aria-hidden /> The room on the clock
        </span>
      </SectionTitle>

      <p className="mb-2.5 text-small font-600 text-ink">{consensusLine(room)}</p>

      <div className="space-y-2">
        {view.lines.map((line) => (
          <VoiceRow key={line.seat} line={line} phone={phone} />
        ))}
      </div>

      {view.yourLine && !view.lines.some((l) => l.isUser) && (
        <p className="mt-2 text-small leading-snug text-ink-2">“{view.yourLine}” — you</p>
      )}

      {phone && room.rows.length > view.lines.length && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-2.5 w-full"
          icon={<Megaphone size={14} aria-hidden />}
          onClick={() => setOpen(true)}
        >
          The whole room · {room.spread} name{room.spread === 1 ? '' : 's'}
        </Button>
      )}

      <p className="mt-2 text-micro leading-snug text-muted">
        {view.active
          ? 'This is the board your club is picking from. AI clubs keep their own logic — only your picks feel the room.'
          : 'The room argues either way; set your philosophy for this draft to put the blend on the board.'}
      </p>

      <Sheet
        open={phone && open}
        onClose={() => setOpen(false)}
        eyebrow="Draft room"
        title="The argument"
        subtitle={consensusLine(room)}
      >
        <div className="space-y-3">
          {room.rows.map((row) => (
            <div key={row.seat.key}>
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="font-cond text-small font-700 uppercase tracking-[0.05em] text-ink">{row.seat.short}</span>
                <span className="text-micro text-muted">{row.weightPct}% authority</span>
                {row.seat.holdsPen && <Badge tone="neutral">Pen</Badge>}
                {row.seat.isUser && <Badge tone="team">You</Badge>}
              </div>
              {row.arg ? (
                <>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate font-600 text-ink">{row.arg.prospectName}</span>
                    <span className="shrink-0 text-micro tnum text-muted">grade {row.arg.grade}</span>
                    <Delta value={row.pull} digits={1} />
                  </div>
                  <p className="mt-0.5 text-small leading-snug text-ink-2">“{row.arg.reason}”</p>
                </>
              ) : (
                <p className="mt-1 text-small text-muted">—</p>
              )}
            </div>
          ))}
        </div>
      </Sheet>
    </Card>
  )
}

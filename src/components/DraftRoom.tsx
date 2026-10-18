// ─────────────────────────────────────────────────────────────────────────────
// The Draft Room (FUTURES #27 DF3 — UI).
//
// The room view of the Draft War Room: one row per seat — the scouting director,
// the personnel director, the AGM, the GM, the head coach and the coordinator
// whose side has the biggest hole — each with his own stance, his own authority
// and his own guy on the board. It is a read-only window onto the DF1/DF2 engine
// (see ./draftRoomUi.ts): seats, weights, the argument and the trade-down
// appetite all come from `draftRoom`, and the ledger note is the club's own.
//
// Your seat is marked and the pen holder is highlighted. On a phone the seats
// stack and each seat's argument moves into a Sheet.
// ─────────────────────────────────────────────────────────────────────────────

import { Gavel, Handshake, Megaphone, Users } from 'lucide-react'
import { useState } from 'react'
import { cn } from '../lib/cn'
import type { RoomSeat } from '../game/engine/draftRoom'
import { useGame, useWorld } from '../store/gameStore'
import { Avatar, Badge, Button, Card, RatingTile, SectionTitle, SegmentedControl, Sheet, VerdictChip } from '../ui/kit'
import { Delta } from '../ui/Kpi'
import { usePhone } from '../ui/hooks'
import { DraftStanceChips } from './DraftPhilosophyCard'
import { aiIdentityView, consensusLine, roomView, type RoomRow } from './draftRoomUi'

function AuthorityBar({ pct, held }: { pct: number; held: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3"
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Authority in this room"
      >
        <span className="block h-full rounded-full bg-[var(--team-accent)]" style={{ width: `${Math.max(2, pct)}%` }} />
      </span>
      <span className={cn('w-9 shrink-0 text-right font-cond text-small font-700 tnum', held ? 'text-ink' : 'text-muted')}>
        {pct}%
      </span>
    </span>
  )
}

function SeatIdentity({ seat, pen }: { seat: RoomSeat; pen: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar name={seat.name} size={34} ring={pen || seat.isUser ? 'accent' : 'line'} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate font-cond text-row font-700 uppercase tracking-[0.02em] text-ink">{seat.name}</span>
          {seat.isUser && <Badge tone="team">You</Badge>}
          {pen && <Badge tone="neutral">Pen</Badge>}
        </div>
        <div className="truncate text-small text-muted">{seat.title}</div>
      </div>
    </div>
  )
}

/** The seat's guy: who, what grade, and how far his own stance pulled him up. */
function SeatGuy({ row }: { row: RoomRow }) {
  if (!row.arg) return <span className="text-small text-muted">—</span>
  return (
    <div className="flex items-center gap-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate font-600 text-ink">{row.arg.prospectName}</div>
        <div className="flex flex-wrap items-center gap-x-2 text-micro text-muted">
          <span className="font-cond font-700 uppercase">{row.arg.pos}</span>
          <Delta value={row.pull} digits={1} suffix="over grade" />
        </div>
        <p className="mt-0.5 text-small leading-snug text-ink-2">{row.arg.reason}</p>
      </div>
      <RatingTile value={row.arg.grade} size="sm" college label={`${row.arg.prospectName} grade`} />
    </div>
  )
}

function SeatBlock({ row, phone }: { row: RoomRow; phone: boolean }) {
  const pen = row.seat.holdsPen
  return (
    <div
      className={cn(
        'rounded-[var(--r-md)] border p-3',
        pen || row.seat.isUser ? 'border-line-strong bg-surface-2' : 'border-line bg-surface',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-[200px]">
          <SeatIdentity seat={row.seat} pen={pen} />
          <DraftStanceChips seat={row.seat} max={2} className="mt-1.5" />
        </div>
        <div className="w-full max-w-[220px]">
          <span className="label">Authority</span>
          <AuthorityBar pct={row.weightPct} held={pen} />
        </div>
      </div>
      {!phone && (
        <div className="mt-2.5 border-t border-line pt-2.5">
          <span className="label">Our guy</span>
          <div className="mt-1">
            <SeatGuy row={row} />
          </div>
        </div>
      )}
    </div>
  )
}

export function DraftRoom({ className }: { className?: string }) {
  const world = useWorld()
  const career = useGame((s) => s.career)
  const setAiDraftIdentities = useGame((s) => s.setAiDraftIdentities)
  const phone = usePhone()
  const [open, setOpen] = useState(false)
  if (!career) return null
  const view = roomView(world, career)
  const ai = aiIdentityView(world, career)
  const tradeLabel = view.accumulating ? `${view.tradeStep} — the room will take a deal` : view.tradeStep

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
          <Users size={18} className="text-[var(--team-accent-text)]" aria-hidden /> The Draft Room
        </span>
      </SectionTitle>

      <div className="mb-3 flex items-start gap-2.5 rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-2.5">
        <Gavel size={15} className="mt-0.5 shrink-0 text-[var(--team-accent-text)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-small font-600 text-ink">{consensusLine(view)}</p>
          <p className="mt-0.5 text-micro leading-snug text-muted">
            {view.active
              ? 'This is the board your club is picking from. AI clubs keep their own logic — only your picks feel the room.'
              : 'The room argues either way; the blended stance only reaches the board once you set it for this draft.'}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {view.rows.map((row) => (
          <SeatBlock key={row.seat.key} row={row} phone={phone} />
        ))}
      </div>

      {phone && (
        <Button
          variant="secondary"
          className="mt-3 w-full"
          icon={<Megaphone size={15} aria-hidden />}
          onClick={() => setOpen(true)}
        >
          The room’s argument{view.spread > 0 ? ` · ${view.spread} name${view.spread === 1 ? '' : 's'}` : ''}
        </Button>
      )}

      {/* Trade-down appetite: how many calls the room takes, and whether it bites. */}
      <div className="mt-3 rounded-[var(--r-md)] border border-line px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Handshake size={14} className="shrink-0 text-muted" aria-hidden />
          <span className="label">Trade-down appetite</span>
          <VerdictChip tone={view.accumulating ? 'win' : 'neutral'}>{tradeLabel}</VerdictChip>
          <span className="ml-auto text-small tnum text-ink-2">
            Calls: up to <b className="font-600 text-ink">{view.offerLimit}</b>
            {view.offersNow > 0 && <> · {view.offersNow} on the table</>}
          </span>
        </div>
        <p className="mt-1 text-micro leading-snug text-muted">
          {view.accumulating ? (
            <>
              Accumulate: <b className="font-600 text-ink-2">{view.tradeWeightPct}%</b> of the room’s authority wants to
              move back{view.advocate ? `, loudest from the ${view.advocate}` : ''}. While the club is advising, the room
              takes the best offer when it clears 1.08× and the board holds.
            </>
          ) : view.active ? (
            <>
              <b className="font-600 text-ink-2">{view.tradeWeightPct}%</b> of the room’s authority wants to move back —
              at this stance the club listens and picks.
            </>
          ) : (
            <>Unset, the club shows the standard four offers and never trades on its own.</>
          )}
        </p>
      </div>

      {/* The note the club already wrote into your Ledger. */}
      <div className="mt-2 rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-2.5">
        <span className="label">Room note · your Ledger</span>
        {view.note ? (
          <>
            <p className="mt-1 text-small font-600 text-ink">{view.note.note}</p>
            <p className="mt-0.5 text-micro text-muted">{view.note.name}</p>
          </>
        ) : (
          <p className="mt-1 text-small leading-snug text-muted">
            {view.active
              ? 'No card has gone in yet this draft. Who won the room is written here — and graded two seasons on.'
              : 'Set the philosophy for this draft to put the room on the board.'}
          </p>
        )}
      </div>

      {/* FUTURES #27 DF4: the other 31 rooms. Off by default — today's league. */}
      <div className="mt-2 rounded-[var(--r-md)] border border-line px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <Users size={14} className="shrink-0 text-muted" aria-hidden />
          <span className="label">AI draft identities</span>
          <SegmentedControl
            label="AI draft identities"
            size="sm"
            className="ml-auto"
            value={ai.on ? 'on' : 'off'}
            onChange={(v) => setAiDraftIdentities(v === 'on')}
            options={[
              { id: 'off', label: 'Off', title: 'Every AI club keeps the board it runs today (his GM’s own style)' },
              { id: 'on', label: 'On', title: 'Every AI club’s whole room carries its own stance — no two boards alike' },
            ]}
          />
        </div>
        <p className="mt-1 text-micro leading-snug text-muted">
          {ai.on ? (
            <>
              All 31 other rooms argue their own board: <b className="font-600 text-ink-2">{ai.distinct}</b> distinct blended
              stances, <b className="font-600 text-ink-2">{ai.withStance}</b> clubs with a stance of their own —{' '}
              {ai.need} lean Need, {ai.bpa} lean BPA. Every club’s numbers come from its own people, never a league average.
            </>
          ) : (
            <>
              Off: an AI club drafts off its GM’s own style (FUTURES #49) and the rest of its room does not tilt the board.
              Turn it on and every club’s whole room — scouting director, personnel director, AGM, GM, head coach,
              coordinator — argues its own stance.
            </>
          )}
        </p>
        {ai.on && (
          <div className="mt-2 space-y-1.5">
            {ai.clubs.slice(0, 3).map((club) => (
              <div key={club.teamId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-cond text-small font-700 uppercase tracking-[0.04em] text-ink">{club.abbr}</span>
                <span className="min-w-0 truncate text-micro text-muted">{club.gm}</span>
                <span className="ml-auto inline-flex flex-wrap items-center gap-1">
                  {club.chips.slice(0, 2).map((c) => (
                    <span key={c.axis} title={`${c.label}: ${c.step}`}>
                      <VerdictChip tone="neutral">{c.step}</VerdictChip>
                    </span>
                  ))}
                  {club.chips.length > 2 && (
                    <span className="font-cond text-micro font-700 uppercase text-faint">+{club.chips.length - 2}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet
        open={phone && open}
        onClose={() => setOpen(false)}
        eyebrow="Draft room"
        title="The argument"
        subtitle={consensusLine(view)}
      >
        <div className="space-y-3">
          {view.rows.map((row) => (
            <div key={row.seat.key}>
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="font-cond text-small font-700 uppercase tracking-[0.05em] text-ink">{row.seat.short}</span>
                <span className="text-micro text-muted">{row.weightPct}% authority</span>
                {row.seat.holdsPen && <Badge tone="neutral">Pen</Badge>}
                {row.seat.isUser && <Badge tone="team">You</Badge>}
              </div>
              <div className="mt-1">
                <SeatGuy row={row} />
              </div>
            </div>
          ))}
        </div>
      </Sheet>
    </Card>
  )
}

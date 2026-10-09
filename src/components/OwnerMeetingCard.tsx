import { CalendarClock, Check, Handshake, Landmark, Minus, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { ownerName, ownerProfile } from '../game/engine/owner'
import {
  MEETING_WEEKS,
  OWNER_ASK_BLURB,
  OWNER_ASK_LABEL,
  meetingDue,
  meetingState,
  meetingStanding,
  ownerStaffBudgetBonus,
  ownerStaffFundOpen,
  type OwnerAsk,
  type OwnerMeetingEntry,
  type OwnerMeetingOutcome,
} from '../game/engine/ownerMeeting'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card } from '../ui/kit'

const OUTCOME_TONE: Record<OwnerMeetingOutcome, 'win' | 'warn' | 'loss'> = {
  agreed: 'win',
  partial: 'warn',
  declined: 'loss',
}
const OUTCOME_LABEL: Record<OwnerMeetingOutcome, string> = {
  agreed: 'Agreed',
  partial: 'Partial',
  declined: 'Declined',
}
const ASKS: OwnerAsk[] = ['budget', 'patience', 'staff']

/**
 * FUTURES 25 — owner meetings.
 *
 * A few times a season the owner calls you in. Ask for budget, a season's
 * patience, or money for the building — the answer depends on his personality
 * (FUTURES 22), your standing and this season's results. User-initiated and
 * user-only, so it never changes the league sim; every grant is opt-in.
 */
export function OwnerMeetingCard({ className, compact = false }: { className?: string; compact?: boolean }) {
  const world = useWorld()
  const career = useGame((s) => s.career)!
  const holdOwnerMeeting = useGame((s) => s.holdOwnerMeeting)

  const profile = ownerProfile(career.teamId)
  const state = meetingState(career)
  const due = meetingDue(world, career)
  const standings = meetingStanding(world, career)
  const meetings = state.log.filter((e) => e.season === world.season).slice(-6).reverse()
  const grace = state.graceSeason === world.season
  const fundOpen = ownerStaffFundOpen(career, world.season)
  const staffMoney = ownerStaffBudgetBonus(career, world.season)
  const hasGrants = grace || fundOpen || staffMoney > 0

  // Compact form (dashboard teaser): only render when there's something to do.
  if (compact && !due.open && !hasGrants) return null

  return (
    <Card className={cn(due.open ? 'border-[var(--team)]' : undefined, className)}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Landmark size={16} className="shrink-0 text-[var(--team)]" />
        <h3 className="font-display text-lg font-700 uppercase tracking-wide text-ink">Owner Meeting</h3>
        <Badge tone={profile.personality === 'win-now' ? 'loss' : profile.personality === 'patient' ? 'win' : 'gold'} className="ml-auto">
          {profile.label}
        </Badge>
        <Badge tone={standings >= 60 ? 'win' : standings >= 45 ? 'warn' : 'loss'}>Standing {standings}</Badge>
      </div>

      <p className="mb-3 text-xs leading-relaxed text-muted">
        {ownerName(career.teamId)} reads you on results and your standing with him. Ask for one thing — he answers in his
        own way, and every grant is yours alone: it never touches the league sim.
      </p>

      {due.open ? (
        <>
          <div className="mb-2 flex items-center gap-1.5 font-cond text-[11px] font-700 uppercase tracking-wide text-[var(--team)]">
            <CalendarClock size={13} /> He wants to see you — pick your pitch
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {ASKS.map((ask) => (
              <button
                key={ask}
                type="button"
                onClick={() => holdOwnerMeeting(ask)}
                className="motion rounded-lg border border-line bg-surface-2 p-2.5 text-left transition hover:border-[var(--team)] hover:bg-[var(--team-soft)]"
              >
                <span className="block text-xs font-700 text-ink">{OWNER_ASK_LABEL[ask]}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted">{OWNER_ASK_BLURB[ask]}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="rounded-lg bg-surface-2 p-2.5 text-[11px] leading-snug text-muted">
          {world.phase === 'regular'
            ? `No meeting due. The owner calls you in around week ${MEETING_WEEKS.join(', ')} — you have met him ${meetings.length} time${meetings.length === 1 ? '' : 's'} this season.`
            : 'The owner will call you in again once the season is under way.'}
        </p>
      )}

      {hasGrants && (
        <div className="mt-3 space-y-1.5">
          {grace && (
            <GrantLine tone="win" label="A season of grace" body="The owner will not judge you on this season." />
          )}
          {fundOpen && (
            <GrantLine tone="win" label="Owner-funded hire" body="Your next staff hire this season has his money behind it." />
          )}
          {staffMoney > 0 && (
            <GrantLine tone="info" label="Facilities & staff money" body={`$${(staffMoney / 1e6).toFixed(0)}M added to the staff budget this season.`} />
          )}
        </div>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <div className="label mb-2">This season's meetings</div>
        {meetings.length === 0 ? (
          <p className="text-xs text-muted">You have not sat down with him yet this season.</p>
        ) : (
          <div className="space-y-1.5">
            {meetings.map((m, i) => (
              <MeetingRow key={`${m.season}-${m.window}-${i}`} entry={m} />
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

function GrantLine({ tone, label, body }: { tone: 'win' | 'info'; label: string; body: string }) {
  const Icon = tone === 'win' ? Check : Handshake
  return (
    <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5">
      <Icon size={13} className={cn('mt-0.5 shrink-0', tone === 'win' ? 'text-win' : 'text-brand')} />
      <div className="min-w-0">
        <span className="font-cond text-[11px] font-700 uppercase tracking-wide text-ink-2">{label}</span>
        <p className="text-[11px] leading-snug text-muted">{body}</p>
      </div>
    </div>
  )
}

function MeetingRow({ entry }: { entry: OwnerMeetingEntry }) {
  const Icon = entry.outcome === 'agreed' ? Check : entry.outcome === 'partial' ? Minus : X
  return (
    <div className="flex items-start gap-2 rounded-lg border border-line px-2.5 py-1.5">
      <Badge tone={OUTCOME_TONE[entry.outcome]}>{OUTCOME_LABEL[entry.outcome]}</Badge>
      <Icon size={12} className="mt-1 shrink-0 text-faint" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-cond text-[11px] font-700 uppercase text-muted">{OWNER_ASK_LABEL[entry.ask]}</span>
          {entry.grants.map((g) => (
            <span key={g} className="rounded bg-[var(--team-soft)] px-1.5 py-0.5 text-[10px] font-600 text-[var(--team)]">
              {g}
            </span>
          ))}
        </div>
        <p className="text-[11px] leading-snug text-muted">{entry.message}</p>
      </div>
      <span className="shrink-0 font-cond text-[10px] font-700 uppercase text-faint">
        S{entry.season} W{entry.week}
      </span>
    </div>
  )
}

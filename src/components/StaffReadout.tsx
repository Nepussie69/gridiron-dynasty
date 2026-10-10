import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
import type { StaffMember } from '../game/types'
import type { World } from '../game/engine/generate'
import { coachEffect } from '../game/engine/coaching'
import { isFrontOfficeRole } from '../game/engine/hiring'
import { Avatar, Badge, RatingTile } from '../ui/kit'
import { HoverCard } from './HoverCard'
import { cultureLines, staffEffectLines, staffTenureFor, TONE_TEXT, type EffectLine } from './staffEffects'

/**
 * Backlog #41 UI pieces. The effect maths lives in `staffEffects.ts`; this file
 * is presentation only (effects are read from the live engine, never invented).
 */

/** Initials badge for the compact org-chart chips (kit Avatar: surface-3 + accent ring, never navy). */
export function InitialsAvatar({
  name,
  size = 32,
  className,
}: {
  name: string
  size?: number
  className?: string
}) {
  return <Avatar name={name} size={size} className={className} />
}

function EffectRow({ line }: { line: EffectLine }) {
  return (
    <div className="flex items-start justify-between gap-2 py-0.5" title={line.hint}>
      <span className="font-cond text-label font-600 uppercase tracking-[0.06em] text-muted">{line.label}</span>
      <span className={cn('text-right text-small font-600 tnum', TONE_TEXT[line.tone ?? 'neutral'])}>{line.value}</span>
    </div>
  )
}

/**
 * A staff name (or any trigger) whose hover / focus shows the full readout:
 * OVR, specialty, scheme, contract, every numeric effect, tenure, club record.
 */
export function StaffHoverCard({
  member,
  world,
  teamId,
  children,
  className,
  info = true,
}: {
  member: StaffMember
  world: World
  teamId: string
  children: ReactNode
  className?: string
  info?: boolean
}) {
  const eff = coachEffect(world, teamId)
  const lines = [...staffEffectLines(world, teamId, member, eff), ...cultureLines(eff)]
  const front = isFrontOfficeRole(member.role)
  const record = world.standings?.[teamId]
  const recordText = record
    ? `${record.wins}-${record.losses}${record.ties ? `-${record.ties}` : ''}`
    : null
  const tenure = staffTenureFor(world, teamId, member.role)

  return (
    <HoverCard
      className={className}
      info={info}
      label={`Details for ${member.name}`}
      content={
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <RatingTile value={member.rating} size="md" label="Staff rating" />
            <div className="min-w-0">
              <div className="truncate font-display text-[17px] font-800 italic uppercase leading-none text-ink">
                {member.name}
              </div>
              <div className="mt-1 truncate text-label text-muted">
                {member.role} · age {member.age}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            <Badge tone="team">{front ? member.focus ?? 'Front office' : member.scheme}</Badge>
            <Badge tone="neutral">{member.specialty}</Badge>
          </div>

          <div className="rounded-[var(--r-md)] border border-line px-2 py-1.5 text-label tnum text-muted">
            <div>
              Contract: {money(member.annual)}/yr · {member.contractYears} yr{member.contractYears === 1 ? '' : 's'} left
            </div>
            {tenure && <div>Tenure: {tenure}</div>}
            {recordText && <div>Club record: {recordText}</div>}
          </div>

          <div>
            <div className="label mb-0.5">Real effects</div>
            <div className="divide-y divide-line/40">
              {lines.map((l, i) => (
                <EffectRow key={`${l.label}-${i}`} line={l} />
              ))}
            </div>
          </div>
        </div>
      }
    >
      {children}
    </HoverCard>
  )
}

/** Dashed "Vacant" seat that opens the market filtered to a role (kit VacantSeat styling). */
export function VacantChip({ role, onClick }: { role: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-2 rounded-[var(--r-sm)] border border-dashed border-line-strong px-2.5 py-2 text-left transition hover:bg-surface-2 pointer-coarse:min-h-11"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--r-sm)] border border-dashed border-line-strong text-muted" aria-hidden>
        +
      </span>
      <span className="min-w-0">
        <span className="block truncate font-cond text-small font-700 uppercase tracking-[0.05em] text-ink-2 group-hover:text-ink">
          {role}
        </span>
        <span className="block text-label text-muted">Vacant · hire</span>
      </span>
    </button>
  )
}

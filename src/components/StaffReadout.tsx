import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { inkOn, money } from '../lib/format'
import type { StaffMember } from '../game/types'
import type { World } from '../game/engine/generate'
import { coachEffect } from '../game/engine/coaching'
import { isFrontOfficeRole } from '../game/engine/hiring'
import { Badge, OvrBadge } from '../ui/kit'
import { HoverCard } from './HoverCard'
import { cultureLines, staffEffectLines, staffTenureFor, TONE_TEXT, type EffectLine } from './staffEffects'

/**
 * Backlog #41 UI pieces. The effect maths lives in `staffEffects.ts`; this file
 * is presentation only (effects are read from the live engine, never invented).
 */

/** Initials badge for the compact org-chart chips. */
export function InitialsAvatar({
  name,
  size = 32,
  className,
}: {
  name: string
  size?: number
  className?: string
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const bg = '#0a1626'
  return (
    <span
      className={cn('grid shrink-0 place-items-center rounded-lg font-display font-700 uppercase', className)}
      style={{ width: size, height: size, background: bg, color: inkOn(bg), fontSize: size * 0.36 }}
      aria-hidden
    >
      {initials}
    </span>
  )
}

function EffectRow({ line }: { line: EffectLine }) {
  return (
    <div className="flex items-start justify-between gap-2 py-0.5" title={line.hint}>
      <span className="text-[10px] uppercase tracking-wide text-muted">{line.label}</span>
      <span className={cn('text-right text-[11px] font-600 tnum', TONE_TEXT[line.tone ?? 'neutral'])}>{line.value}</span>
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
            <OvrBadge value={member.rating} size={30} />
            <div className="min-w-0">
              <div className="truncate font-display text-sm font-700 uppercase leading-none text-ink">
                {member.name}
              </div>
              <div className="mt-0.5 truncate text-[10px] text-muted">
                {member.role} · age {member.age}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-1">
            <Badge tone="team">{front ? member.focus ?? 'Front office' : member.scheme}</Badge>
            <Badge tone="neutral">{member.specialty}</Badge>
          </div>

          <div className="rounded-md border border-line/60 px-1.5 py-1 text-[10px] tnum text-muted">
            <div>
              Contract: {money(member.annual)}/yr · {member.contractYears} yr{member.contractYears === 1 ? '' : 's'} left
            </div>
            {tenure && <div>Tenure: {tenure}</div>}
            {recordText && <div>Club record: {recordText}</div>}
          </div>

          <div>
            <div className="label mb-0.5 !text-[9px]">Real effects</div>
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

/** Small dashed "Vacant" chip that opens the market filtered to a role. */
export function VacantChip({ role, onClick }: { role: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-2 rounded-xl border border-dashed border-line px-2.5 py-2 text-left transition hover:border-[var(--team)] hover:bg-surface-2"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-dashed border-line text-faint">
        +
      </span>
      <span className="min-w-0">
        <span className="block truncate font-cond text-xs font-700 uppercase tracking-wide text-muted group-hover:text-ink">
          {role}
        </span>
        <span className="block text-[10px] text-faint">Vacant — hire</span>
      </span>
    </button>
  )
}

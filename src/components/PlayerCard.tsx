import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { gradeColor, inkOn, money } from '../lib/format'
import type { Player, Team } from '../game/types'
import { DevBadge, OvrBadge, PotBubble } from '../ui/kit'
import { InjuryChip } from './PlayerTable'

/**
 * U4 — a faceless player silhouette for the card views. No portrait art, just a
 * head-and-shoulders mark tinted with the club colour so a wall of cards is
 * instantly scannable without pretending to be a photo.
 */
export function PlayerSilhouette({ className, fill = 'currentColor' }: { className?: string; fill?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <circle cx="32" cy="23" r="12" fill={fill} />
      <path d="M7 61c0-14.5 11.2-23 25-23s25 8.5 25 23z" fill={fill} />
    </svg>
  )
}

/**
 * U4 — a circular rating ring: an OVR arc coloured by grade tier around the
 * number. SVG only, theme-token friendly, no dependencies.
 */
export function RatingRing({
  value,
  size = 52,
  stroke = 5,
  color,
  className,
}: {
  value: number
  size?: number
  stroke?: number
  color?: string
  className?: string
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  const ring = color ?? gradeColor(value)
  return (
    <span className={cn('relative grid shrink-0 place-items-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={ring}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
        />
      </svg>
      <span
        className="absolute font-display font-700 tnum leading-none"
        style={{ fontSize: size * 0.34, color: 'var(--color-ink)' }}
      >
        {value}
      </span>
    </span>
  )
}

/**
 * U4 — the shared roster / find-a-player card. Silhouette on a club-coloured
 * tile, name and bio, a rated OVR tile with the ceiling bubble, and a footer
 * strip with the ceiling and (optionally) cap hit or a club tag. Purely
 * presentational; the caller decides what clicking does.
 */
export function PlayerCard({
  player,
  team,
  onClick,
  footer,
  tag,
  className,
}: {
  player: Player
  team?: Team | null
  onClick?: () => void
  /** Extra footer content (e.g. a club tag on Find a Player). */
  footer?: ReactNode
  /** A small corner tag (PS, IR, …). */
  tag?: string | null
  className?: string
}) {
  const bg = team ? `linear-gradient(150deg, ${team.primary}, ${team.secondary})` : 'var(--color-surface-3)'
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      className={cn(
        'motion card-shadow group relative overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface text-left',
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:border-line-strong',
        className,
      )}
    >
      {tag && (
        <span className="absolute right-2 top-2 z-10 rounded-[var(--r-xs)] bg-slab/90 px-1.5 py-0.5 font-cond text-label font-700 uppercase tracking-wide text-on-slab">
          {tag}
        </span>
      )}

      <div className="flex items-center gap-3 p-3">
        <span
          className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-[var(--r-md)]"
          style={{ background: bg, boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.18)' }}
        >
          <PlayerSilhouette className="h-12 w-12" fill={team ? inkOn(team.primary) : 'var(--color-faint)'} />
          <span className="absolute inset-x-0 bottom-0 bg-slab/85 py-0.5 text-center font-cond text-label font-700 uppercase tracking-widest text-on-slab">
            {player.pos}
          </span>
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[20px] font-800 italic uppercase leading-none text-ink">
            {player.name}
          </span>
          <span className="mt-1 block truncate text-small text-muted">
            {player.college || '—'} · age {player.age}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <DevBadge dev={player.dev} />
            <InjuryChip player={player} />
            {team && (
              <span className="truncate font-cond text-label font-700 uppercase tracking-wide text-muted">
                {team.abbr || team.name}
              </span>
            )}
          </span>
        </span>

        <span className="mr-0.5 shrink-0 self-start">
          <OvrBadge value={player.ovr} pot={player.pot} size={42} />
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line bg-surface-2/60 px-3 py-1.5">
        <span className="flex items-center gap-1.5">
          <span className="label !mb-0">Ceiling</span>
          <PotBubble value={player.pot} size={24} />
        </span>
        {footer ?? (
          <span className="font-cond text-label tnum text-muted">
            {money(player.contract.capHit)} · {player.contract.years} yr{player.contract.years === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </div>
  )
}

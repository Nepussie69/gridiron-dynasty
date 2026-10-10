// ─────────────────────────────────────────────────────────────────────────────
// People primitives (UI redesign F2, spec §7): Avatar and VacantSeat.
// ─────────────────────────────────────────────────────────────────────────────
import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '../lib/cn'
import { Button } from './Controls'

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/** Initials on surface-3 with a team-accent (or neutral) ring. Never navy. */
export function Avatar({
  name,
  size = 34,
  ring = 'accent',
  className,
}: {
  name: string
  size?: number
  ring?: 'accent' | 'line' | 'none'
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-[var(--r-md)] bg-surface-3 font-display font-800 italic uppercase leading-none text-ink',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(12, Math.round(size * 0.4)),
        boxShadow:
          ring === 'accent'
            ? 'inset 0 0 0 1.5px var(--team-accent)'
            : ring === 'line'
              ? 'inset 0 0 0 1px var(--color-line-strong)'
              : undefined,
      }}
    >
      {initialsOf(name)}
    </span>
  )
}

/**
 * An empty seat: dashed line-strong outline, the role, what the vacancy costs
 * ("no analytics read on 4th-down and 2-pt calls") and one action. `action`
 * is a {label, onClick} (rendered as a quiet button) or any node (GatedAction).
 */
export function VacantSeat({
  role,
  consequence,
  action,
  compact = false,
  className,
}: {
  role: ReactNode
  consequence?: ReactNode
  action?: { label: ReactNode; onClick: () => void } | ReactNode
  compact?: boolean
  className?: string
}) {
  const act =
    action && typeof action === 'object' && 'onClick' in (action as object) && 'label' in (action as object)
      ? (action as { label: ReactNode; onClick: () => void })
      : null
  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--r-sm)] border border-dashed border-line-strong bg-transparent',
        compact ? 'px-3 py-1.5' : 'px-3 py-2.5',
        className,
      )}
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--r-sm)] border border-dashed border-line-strong text-muted" aria-hidden>
        <Plus size={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-cond text-small font-700 uppercase tracking-[0.05em] text-ink-2">
          {role} <span className="font-600 text-muted">· vacant</span>
        </span>
        {consequence && <span className="block text-label text-muted">{consequence}</span>}
      </span>
      {act ? (
        <Button variant="quiet" size="sm" rowSafe onClick={act.onClick}>
          {act.label}
        </Button>
      ) : (
        (action as ReactNode)
      )}
    </div>
  )
}

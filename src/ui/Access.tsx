// ─────────────────────────────────────────────────────────────────────────────
// Access gating (UI redesign F2, spec §7). Reads accessFor() so a control is
// never a dead button that ends in a toast:
//   decide → the action as labelled
//   advise → "Recommend…" label; the action is sent to the GM (onAdvise)
//   view / locked → disabled, with the reason VISIBLE next to it
// AccessBanner is the lower-third that explains the rung once per screen.
// ─────────────────────────────────────────────────────────────────────────────
import type { MouseEvent, ReactNode } from 'react'
import { Eye, Lock, PenLine } from 'lucide-react'
import { cn } from '../lib/cn'
import { ACCESS_META, type AccessArea, type AccessLevel } from '../game/engine/access'
import { Button, type ButtonVariant } from './Controls'
import { useAccessLevel } from './hooks'

/**
 * A button gated by your access level on `area`. Pass `level` to override
 * (tests, /kit). At 'advise' it reads `adviseLabel` (default "Recommend…")
 * and calls `onAdvise` (falls back to `onDecide` — the caller then records a
 * recommendation instead of acting).
 */
export function GatedAction({
  area,
  level: override,
  label,
  adviseLabel,
  onDecide,
  onAdvise,
  reason,
  showReason = true,
  variant = 'secondary',
  size = 'md',
  icon,
  rowSafe = false,
  className,
}: {
  area: AccessArea
  level?: AccessLevel
  label: ReactNode
  adviseLabel?: ReactNode
  onDecide: (e: MouseEvent<HTMLButtonElement>) => void
  onAdvise?: (e: MouseEvent<HTMLButtonElement>) => void
  /** Why it is unavailable at view / locked (defaults to the rung blurb). */
  reason?: ReactNode
  showReason?: boolean
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  icon?: ReactNode
  rowSafe?: boolean
  className?: string
}) {
  const level = useAccessLevel(area, override)
  if (level === 'decide') {
    return (
      <Button variant={variant} size={size} icon={icon} rowSafe={rowSafe} onClick={onDecide} className={className}>
        {label}
      </Button>
    )
  }
  if (level === 'advise') {
    return (
      <Button
        variant={variant}
        size={size}
        icon={icon ?? <PenLine size={14} aria-hidden />}
        rowSafe={rowSafe}
        onClick={onAdvise ?? onDecide}
        title="Sent to the GM as a recommendation"
        className={className}
      >
        {adviseLabel ?? 'Recommend…'}
      </Button>
    )
  }
  const why = reason ?? ACCESS_META[level].blurb
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-2 gap-y-1', className)}>
      <Button variant={variant} size={size} icon={<Lock size={14} aria-hidden />} rowSafe={rowSafe} disabled>
        {label}
      </Button>
      {showReason && <span className="text-label text-muted">{why}</span>}
    </span>
  )
}

/**
 * Lower-third banner: a slab tag (ADVISOR / VIEW ONLY / LOCKED) and one
 * sentence. Renders nothing at 'decide' unless `always`.
 */
export function AccessBanner({
  area,
  level: override,
  message,
  action,
  always = false,
  className,
}: {
  area: AccessArea
  level?: AccessLevel
  message?: ReactNode
  action?: { label: ReactNode; onClick: () => void }
  always?: boolean
  className?: string
}) {
  const level = useAccessLevel(area, override)
  if (level === 'decide' && !always) return null
  const meta = ACCESS_META[level]
  const Icon = level === 'advise' ? PenLine : level === 'locked' ? Lock : Eye
  return (
    <div
      role="note"
      className={cn(
        'flex flex-wrap items-stretch overflow-hidden rounded-[var(--r-sm)] border border-line bg-surface sm:flex-nowrap',
        className,
      )}
    >
      <span className="flex shrink-0 items-center gap-2 bg-slab py-2 pl-3 pr-4 sm:pl-3.5 sm:pr-5 font-display text-[15px] font-800 italic uppercase leading-none tracking-[0.04em] text-on-slab [clip-path:polygon(0_0,100%_0,calc(100%-10px)_100%,0_100%)]">
        <Icon size={14} aria-hidden />
        {meta.label}
      </span>
      <span className="min-w-0 flex-1 basis-[55%] px-3 py-2.5 text-small text-ink-2 sm:basis-auto sm:px-4">{message ?? meta.blurb}</span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="motion min-h-9 shrink-0 basis-full border-t border-line px-4 text-left font-cond text-small font-700 uppercase tracking-[0.06em] text-brand hover:bg-surface-2 sm:basis-auto sm:border-t-0 pointer-coarse:min-h-11"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

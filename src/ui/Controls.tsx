// ─────────────────────────────────────────────────────────────────────────────
// Controls (UI redesign F2, spec §7): Button, IconButton, Tabs,
// SegmentedControl, FilterChip, OptionCard / OptionGroup.
// Targets are ≥36px (44px on coarse pointers). Team colour only marks the
// active tab underline; it never fills a selected control.
// ─────────────────────────────────────────────────────────────────────────────
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react'
import { Check, Loader2 } from 'lucide-react'
import { cn } from '../lib/cn'

export type ButtonVariant =
  | 'slab'
  | 'primary'
  | 'secondary'
  | 'quiet'
  | 'destructive'
  // Legacy names (still compile; mapped onto the new set):
  | 'default'
  | 'ghost'
  | 'team'
  | 'danger'

const VARIANTS: Record<ButtonVariant, string> = {
  // One per view: inverse slab, skewed, italic display type.
  slab: 'bg-slab text-on-slab border border-transparent font-display font-800 italic tracking-[0.02em] shadow-[0_6px_18px_-8px_rgba(0,0,0,0.6)] hover:opacity-90',
  primary: 'bg-slab text-on-slab border border-transparent hover:opacity-90',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-2',
  quiet: 'bg-transparent text-brand border border-transparent hover:bg-surface-2',
  // Solid loss fill: ONLY the final step of a ConfirmSheet.
  destructive: 'bg-loss text-on-slab border border-transparent hover:opacity-90',
  default: 'bg-surface text-ink border border-line-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-ink-2 border border-transparent hover:bg-surface-2 hover:text-ink',
  team: 'border border-transparent hover:opacity-90',
  // Deprecated resting "danger": outline + red text, never a red fill at rest.
  danger: 'bg-surface text-loss border border-line-strong hover:bg-loss-soft',
}

const SIZES = {
  sm: 'min-h-8 px-2.5 text-small gap-1.5 pointer-coarse:min-h-11',
  md: 'min-h-9 px-3.5 text-body gap-2 pointer-coarse:min-h-11',
  lg: 'min-h-11 px-5 text-[15px] gap-2',
} as const

/**
 * The kit button. Legacy props (variant default/ghost/team/danger, size,
 * onClick, disabled, title, className) are unchanged. New:
 *   variant slab | primary | secondary | quiet | destructive
 *   rowSafe  — stop the click bubbling to a clickable row / card
 *   loading  — spinner, aria-busy, not clickable
 *   icon     — leading icon
 */
export function Button({
  children,
  onClick,
  variant = 'default',
  size = 'md',
  className,
  disabled,
  title,
  rowSafe = false,
  loading = false,
  icon,
  type = 'button',
  ref,
  'aria-label': ariaLabel,
  'aria-haspopup': ariaHaspopup,
  'aria-expanded': ariaExpanded,
  'aria-pressed': ariaPressed,
  autoFocus,
  ...data
}: {
  children?: ReactNode
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  className?: string
  disabled?: boolean
  title?: string
  rowSafe?: boolean
  loading?: boolean
  icon?: ReactNode
  type?: 'button' | 'submit'
  ref?: Ref<HTMLButtonElement>
  'aria-label'?: string
  'aria-haspopup'?: 'menu' | 'dialog' | boolean
  'aria-expanded'?: boolean
  'aria-pressed'?: boolean
  autoFocus?: boolean
  [k: `data-${string}`]: string | boolean | undefined
}) {
  const slab = variant === 'slab'
  const inert = disabled || loading
  const content = (
    <>
      {loading ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> : icon}
      {children}
    </>
  )
  return (
    <button
      ref={ref}
      type={type}
      title={title}
      disabled={inert}
      aria-busy={loading || undefined}
      aria-label={ariaLabel}
      aria-haspopup={ariaHaspopup}
      aria-expanded={ariaExpanded}
      aria-pressed={ariaPressed}
      autoFocus={autoFocus}
      {...data}
      onClick={(e) => {
        if (rowSafe) e.stopPropagation()
        if (inert) return
        onClick?.(e)
      }}
      onKeyDown={rowSafe ? (e) => e.stopPropagation() : undefined}
      className={cn(
        'motion inline-flex select-none items-center justify-center whitespace-nowrap uppercase leading-none',
        slab ? 'rounded-[3px] [transform:skewX(var(--skew))]' : 'rounded-[var(--r-md)] font-cond font-700 tracking-[0.06em]',
        'active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:active:translate-y-0',
        VARIANTS[variant],
        SIZES[size],
        slab && size !== 'sm' && 'text-[17px]',
        className,
      )}
      style={variant === 'team' ? { background: 'var(--team-accent)', color: 'var(--team-accent-on)' } : undefined}
    >
      {slab ? <span className="inline-flex items-center gap-2 [transform:skewX(calc(var(--skew)*-1))]">{content}</span> : content}
    </button>
  )
}

/** Square icon button. `label` is required: it is the accessible name and tooltip. */
export function IconButton({
  label,
  children,
  onClick,
  size = 'md',
  variant = 'outline',
  pressed,
  dot = false,
  disabled,
  rowSafe = false,
  className,
  ref,
  'aria-haspopup': ariaHaspopup,
  'aria-expanded': ariaExpanded,
  'aria-controls': ariaControls,
}: {
  label: string
  children: ReactNode
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  size?: 'sm' | 'md' | 'lg'
  variant?: 'outline' | 'ghost'
  pressed?: boolean
  /** Brand-blue notification dot. */
  dot?: boolean
  disabled?: boolean
  rowSafe?: boolean
  className?: string
  ref?: Ref<HTMLButtonElement>
  'aria-haspopup'?: 'menu' | 'dialog' | boolean
  'aria-expanded'?: boolean
  'aria-controls'?: string
}) {
  const px = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-11 w-11' : 'h-10 w-10'
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      aria-haspopup={ariaHaspopup}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      disabled={disabled}
      onClick={(e) => {
        if (rowSafe) e.stopPropagation()
        onClick?.(e)
      }}
      onKeyDown={rowSafe ? (e) => e.stopPropagation() : undefined}
      className={cn(
        'motion relative grid shrink-0 place-items-center rounded-[var(--r-md)] text-ink-2 hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-45',
        'pointer-coarse:min-h-11 pointer-coarse:min-w-11',
        px,
        variant === 'outline' ? 'border border-line' : 'border border-transparent',
        (pressed || ariaExpanded) && 'border-line-strong bg-surface-3 text-ink',
        className,
      )}
    >
      {children}
      {dot && (
        <span
          aria-hidden
          className="absolute right-2 top-2 h-2 w-2 rounded-full bg-brand shadow-[0_0_0_2px_var(--color-surface)]"
        />
      )}
    </button>
  )
}

/** Arrow / Home / End keyboard movement between sibling buttons (roving focus). */
function rove(e: KeyboardEvent<HTMLElement>, selector: string, vertical = false) {
  const keys = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']
  if (![...keys, 'Home', 'End'].includes(e.key)) return null
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => !el.hasAttribute('disabled'),
  )
  if (!items.length) return null
  const i = items.indexOf(document.activeElement as HTMLElement)
  let n = i
  if (e.key === 'Home') n = 0
  else if (e.key === 'End') n = items.length - 1
  else if (e.key === keys[0]) n = (i - 1 + items.length) % items.length
  else n = (i + 1) % items.length
  e.preventDefault()
  items[n].focus()
  return items[n]
}

export interface TabItem<K extends string = string> {
  id: K
  label: ReactNode
  /** Count pill (e.g. 10/11). */
  count?: ReactNode
  disabled?: boolean
}

/**
 * Underline tabs: 42px, a 3px team-accent underline that slides, role=tab,
 * arrow keys move and select (automatic activation).
 */
export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
  stretch = false,
  idBase,
}: {
  tabs: TabItem<K>[]
  value: K
  onChange: (id: K) => void
  label: string
  className?: string
  /** Equal-width tabs (phone). */
  stretch?: boolean
  /** Prefix for tab ids; panels can use aria-labelledby={`${idBase}-${id}`}. */
  idBase?: string
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const measure = () => {
      const el = list.querySelector<HTMLElement>('[aria-selected="true"]')
      setBar(el ? { left: el.offsetLeft, width: el.offsetWidth } : null)
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(list)
    return () => ro?.disconnect()
  }, [value, tabs.length])

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={(e) => {
        const el = rove(e, '[role="tab"]')
        const id = el?.dataset.tab as K | undefined
        if (id) onChange(id)
      }}
      className={cn(
        'relative flex max-w-full gap-6 overflow-x-auto border-b border-line [scrollbar-width:none]',
        stretch && 'gap-0',
        className,
      )}
    >
      {tabs.map((t) => {
        const on = t.id === value
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={idBase ? `${idBase}-${t.id}` : undefined}
            data-tab={t.id}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange(t.id)}
            className={cn(
              'motion flex h-[42px] shrink-0 items-center gap-2 whitespace-nowrap font-cond text-[15px] font-700 uppercase tracking-[0.06em] disabled:opacity-45',
              'pointer-coarse:h-11',
              stretch && 'flex-1 justify-center',
              on ? 'text-ink' : 'text-muted hover:text-ink-2',
            )}
          >
            {t.label}
            {t.count != null && (
              <span className="rounded-full bg-surface-3 px-[7px] py-[3px] font-cond text-label font-600 leading-none tracking-[0.03em] text-ink-2 tnum">
                {t.count}
              </span>
            )}
          </button>
        )
      })}
      {bar && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-0 h-[3px] bg-[var(--team-accent)] transition-[left,width] duration-[var(--d2)] ease-[var(--ease-settle)] motion-reduce:transition-none"
          style={{ left: bar.left, width: bar.width }}
        />
      )}
    </div>
  )
}

export interface SegmentOption<K extends string = string> {
  id: K
  label: ReactNode
  icon?: ReactNode
  title?: string
}

/**
 * Segmented control: surface-2 track; the active segment is surface-3 with a
 * line-strong ring (never team-filled). Buttons carry aria-pressed.
 */
export function SegmentedControl<K extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  className,
}: {
  options: SegmentOption<K>[]
  value: K
  onChange: (id: K) => void
  label: string
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      onKeyDown={(e) => rove(e, 'button')}
      className={cn('inline-flex shrink-0 rounded-[var(--r-md)] border border-line bg-surface-2 p-[3px]', className)}
    >
      {options.map((o) => {
        const on = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            title={o.title}
            onClick={() => onChange(o.id)}
            className={cn(
              'motion flex items-center gap-1.5 whitespace-nowrap rounded-[var(--r-sm)] px-3 font-cond font-700 uppercase tracking-[0.06em]',
              size === 'sm' ? 'h-7 text-label' : 'h-[30px] text-small',
              'pointer-coarse:h-10',
              on ? 'bg-surface-3 text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]' : 'text-muted hover:text-ink-2',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Toggle chip for filters: aria-pressed with a check mark when on. */
export function FilterChip({
  pressed,
  onChange,
  children,
  count,
  className,
}: {
  pressed: boolean
  onChange: (next: boolean) => void
  children: ReactNode
  count?: number
  className?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
      className={cn(
        'motion inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 font-cond text-small font-700 uppercase tracking-[0.05em]',
        'pointer-coarse:h-11',
        pressed
          ? 'border-line-strong bg-surface-3 text-ink'
          : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
        className,
      )}
    >
      {pressed && <Check size={13} aria-hidden />}
      {children}
      {count != null && <span className="font-600 text-muted tnum">{count}</span>}
    </button>
  )
}

/** A radiogroup wrapper for OptionCards (arrow keys move between options). */
export function OptionGroup({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={(e) => rove(e, '[role="radio"]', true) ?? rove(e, '[role="radio"]')} className={cn('grid gap-2', className)}>
      {children}
    </div>
  )
}

/** A selectable card with a radio mark; distinct hover and selected states. */
export function OptionCard({
  selected,
  onSelect,
  title,
  description,
  meta,
  disabled,
  className,
}: {
  selected: boolean
  onSelect: () => void
  title: ReactNode
  description?: ReactNode
  /** Right-aligned slot (cost, rating, effect). */
  meta?: ReactNode
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'motion flex w-full items-start gap-3 rounded-[var(--r-md)] border p-3 text-left disabled:cursor-not-allowed disabled:opacity-45',
        selected
          ? 'border-line-strong bg-surface-3 shadow-[inset_3px_0_0_var(--team-accent)]'
          : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2',
          selected ? 'border-ink' : 'border-line-strong',
        )}
      >
        {selected && <span className="h-2 w-2 rounded-full bg-ink" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-cond text-row font-700 uppercase tracking-[0.02em] text-ink">{title}</span>
        {description && <span className="mt-1 block text-small text-muted">{description}</span>}
      </span>
      {meta && <span className="shrink-0 text-small text-ink-2">{meta}</span>}
    </button>
  )
}

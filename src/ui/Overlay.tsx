// ─────────────────────────────────────────────────────────────────────────────
// Overlays (UI redesign F2, spec §7): Dialog, Sheet, ConfirmSheet,
// OverflowMenu, Inspector (+ WithInspector layout).
//   • Dialog: centred on ≥640px, a bottom sheet below. role=dialog,
//     aria-modal, focus trap, Esc closes, focus returns to the trigger.
//   • ConfirmSheet: subject, Consequences key/value list, safer alternative,
//     the (only) destructive button, access note, "Logged in The Ledger".
//   • OverflowMenu (⋯): 272px surface-2 popover; destructive items come last
//     after a divider, in red TEXT only.
//   • Inspector: right column from 1280px, bottom sheet below.
// ─────────────────────────────────────────────────────────────────────────────
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { Button, IconButton } from './Controls'
import { useMediaQuery, useModal, WIDE_QUERY } from './hooks'

// ── Modal base ────────────────────────────────────────────────────────────────

function ModalFrame({
  open,
  onClose,
  mode,
  labelledBy,
  describedBy,
  size = 'md',
  children,
}: {
  open: boolean
  onClose: () => void
  /** dialog: centred ≥640px, sheet below. sheet: always a bottom sheet. */
  mode: 'dialog' | 'sheet'
  labelledBy: string
  describedBy?: string
  size?: 'sm' | 'md' | 'lg'
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useModal(panelRef, open, onClose)
  if (!open || typeof document === 'undefined') return null
  const width = size === 'sm' ? 'sm:max-w-[400px]' : size === 'lg' ? 'sm:max-w-[720px]' : 'sm:max-w-[520px]'
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6" data-kit-overlay="">
      <div
        aria-hidden
        className="kit-fade absolute inset-0 bg-[rgb(3_6_12/0.62)]"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        data-kit-modal=""
        className={cn(
          'kit-sheet relative flex max-h-[calc(100dvh-24px)] w-full flex-col overflow-hidden border-line-strong bg-surface text-ink shadow-[var(--shadow-2)] outline-none',
          'rounded-t-[20px] border-t pb-[env(safe-area-inset-bottom)]',
          mode === 'dialog'
            ? cn('sm:kit-pop sm:max-h-[calc(100dvh-48px)] sm:rounded-[var(--r-lg)] sm:border sm:pb-0', width)
            : 'sm:max-w-[560px]',
        )}
      >
        <div aria-hidden className={cn('mx-auto mt-2.5 h-[5px] w-10 shrink-0 rounded-[3px] bg-line-strong', mode === 'dialog' && 'sm:hidden')} />
        {children}
      </div>
    </div>,
    document.body,
  )
}

function OverlayHeader({
  id,
  eyebrow,
  title,
  subtitle,
  subtitleId,
  onClose,
}: {
  id: string
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  subtitleId?: string
  onClose: () => void
}) {
  return (
    <div className="flex shrink-0 items-start gap-3 px-4 pb-2 pt-3 sm:px-5 sm:pt-4">
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="label text-[var(--team-accent-text)]">{eyebrow}</div>}
        <h2 id={id} className="mt-1 font-display text-[24px] font-800 italic uppercase leading-none text-ink">
          {title}
        </h2>
        {subtitle && (
          <p id={subtitleId} className="mt-1.5 text-small text-muted">
            {subtitle}
          </p>
        )}
      </div>
      <IconButton label="Close" variant="ghost" size="sm" onClick={onClose}>
        <X size={18} />
      </IconButton>
    </div>
  )
}

/** A modal dialog: centred on desktop, a bottom sheet under 640px. */
export function Dialog({
  open,
  onClose,
  title,
  eyebrow,
  subtitle,
  footer,
  size = 'md',
  children,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  eyebrow?: ReactNode
  subtitle?: ReactNode
  /** Action row, pinned to the bottom. */
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  children?: ReactNode
}) {
  const id = useId()
  return (
    <ModalFrame open={open} onClose={onClose} mode="dialog" labelledBy={`${id}-t`} describedBy={subtitle ? `${id}-s` : undefined} size={size}>
      <OverlayHeader id={`${id}-t`} subtitleId={`${id}-s`} eyebrow={eyebrow} title={title} subtitle={subtitle} onClose={onClose} />
      {children && <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 text-body sm:px-5">{children}</div>}
      {footer && (
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-line px-4 py-3 sm:flex-row sm:justify-end sm:px-5">{footer}</div>
      )}
    </ModalFrame>
  )
}

/** A bottom sheet at every width (filters, group pickers, touch details). */
export function Sheet({
  open,
  onClose,
  title,
  eyebrow,
  subtitle,
  footer,
  children,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  eyebrow?: ReactNode
  subtitle?: ReactNode
  footer?: ReactNode
  children?: ReactNode
}) {
  const id = useId()
  return (
    <ModalFrame open={open} onClose={onClose} mode="sheet" labelledBy={`${id}-t`} describedBy={subtitle ? `${id}-s` : undefined}>
      <OverlayHeader id={`${id}-t`} subtitleId={`${id}-s`} eyebrow={eyebrow} title={title} subtitle={subtitle} onClose={onClose} />
      {children && <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 text-body">{children}</div>}
      {footer && <div className="grid shrink-0 gap-2 border-t border-line px-4 py-3">{footer}</div>}
    </ModalFrame>
  )
}

export interface Consequence {
  label: ReactNode
  value: ReactNode
  /** Colour the value (e.g. loss for "Seat vacant until hired"). */
  tone?: 'win' | 'warn' | 'loss'
}

/**
 * The review step for anything irreversible. The confirm button is the ONLY
 * place the solid destructive style appears. `saferAlternative` renders above
 * it as a secondary action ("Find a replacement first").
 */
export function ConfirmSheet({
  open,
  onClose,
  onConfirm,
  title,
  eyebrow,
  subtitle,
  consequences = [],
  confirmLabel,
  destructive = true,
  saferAlternative,
  accessNote,
  ledgerNote = 'Logged in The Ledger',
  loading = false,
  children,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  /** The subject: "Let go Miles Nakamura?" */
  title: ReactNode
  eyebrow?: ReactNode
  subtitle?: ReactNode
  consequences?: Consequence[]
  confirmLabel: ReactNode
  /** false → a primary (non-red) confirm, for reversible-but-weighty actions. */
  destructive?: boolean
  saferAlternative?: { label: ReactNode; onClick: () => void }
  /** "Sent to the GM as a recommendation" when you only advise. */
  accessNote?: ReactNode
  /** Footer note; pass null to hide. */
  ledgerNote?: ReactNode
  loading?: boolean
  children?: ReactNode
}) {
  const id = useId()
  return (
    <ModalFrame open={open} onClose={onClose} mode="dialog" labelledBy={`${id}-t`} describedBy={subtitle ? `${id}-s` : undefined} size="sm">
      <OverlayHeader id={`${id}-t`} subtitleId={`${id}-s`} eyebrow={eyebrow} title={title} subtitle={subtitle} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-1 sm:px-5">
        {consequences.length > 0 && (
          <>
            <div className="label mt-1">Consequences</div>
            <dl className="mt-1.5 overflow-hidden rounded-[var(--r-md)] border border-line">
              {consequences.map((c, i) => (
                <div key={i} className="flex justify-between gap-3 border-t border-line px-3 py-[11px] text-small first:border-t-0">
                  <dt className="text-ink-2">{c.label}</dt>
                  <dd
                    className={cn(
                      'text-right font-600 tnum',
                      c.tone === 'win' ? 'text-win' : c.tone === 'warn' ? 'text-warn' : c.tone === 'loss' ? 'text-loss' : 'text-ink',
                    )}
                  >
                    {c.value}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
        {children}
      </div>
      <div className="grid shrink-0 gap-2 px-4 pb-4 pt-3 sm:px-5">
        {saferAlternative && (
          <Button variant="secondary" size="lg" onClick={saferAlternative.onClick} data-autofocus="">
            {saferAlternative.label}
          </Button>
        )}
        <Button variant={destructive ? 'destructive' : 'primary'} size="lg" loading={loading} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button variant="quiet" size="md" onClick={onClose} className="text-ink-2" data-autofocus={saferAlternative ? undefined : ''}>
          Cancel
        </Button>
        {(accessNote || ledgerNote) && (
          <p className="text-center text-label text-muted">
            {accessNote}
            {accessNote && ledgerNote ? ' · ' : ''}
            {ledgerNote}
          </p>
        )}
      </div>
    </ModalFrame>
  )
}

// ── Overflow menu ─────────────────────────────────────────────────────────────

export interface MenuItem {
  id: string
  label: ReactNode
  /** 12px consequence line under the title. */
  description?: ReactNode
  icon?: ReactNode
  onSelect: () => void
  /** Destructive: sorted last after a divider, red text only. */
  danger?: boolean
  disabled?: boolean
}

/**
 * The ⋯ menu. The trigger is rowSafe (clicks never reach the row). Arrow keys
 * move, Home/End jump, Enter/Space select, Esc / Tab / outside click close and
 * focus returns to the trigger.
 */
export function OverflowMenu({
  items,
  label = 'More actions',
  size = 'md',
  trigger,
  className,
}: {
  items: MenuItem[]
  label?: string
  size?: 'sm' | 'md'
  /** Custom trigger content (defaults to ⋯). */
  trigger?: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const safe = items.filter((i) => !i.danger)
  const danger = items.filter((i) => i.danger)

  const close = useCallback((refocus = true) => {
    setOpen(false)
    if (refocus) btnRef.current?.focus()
  }, [])

  const place = useCallback(() => {
    const btn = btnRef.current
    const menu = menuRef.current
    if (!btn || !menu) return
    const r = btn.getBoundingClientRect()
    const w = Math.min(272, window.innerWidth - 16)
    const h = menu.offsetHeight
    let left = r.right - w
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
    let top = r.bottom + 6
    if (top + h > window.innerHeight - 8 && r.top - 6 - h > 8) top = r.top - 6 - h
    menu.style.width = `${w}px`
    menu.style.left = `${left}px`
    menu.style.top = `${Math.max(8, top)}px`
    menu.style.visibility = 'visible'
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    place()
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return
      close(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, close, place])

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const els = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])
    const i = els.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      els[(i + 1) % els.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      els[(i - 1 + els.length) % els.length]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      els[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      els[els.length - 1]?.focus()
    }
  }

  const renderItem = (it: MenuItem) => (
    <button
      key={it.id}
      type="button"
      role="menuitem"
      disabled={it.disabled}
      tabIndex={-1}
      onClick={() => {
        close()
        it.onSelect()
      }}
      className={cn(
        'motion flex w-full items-start gap-2.5 rounded-[var(--r-md)] px-2.5 py-[9px] text-left text-body outline-none',
        'hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-focus)] disabled:cursor-not-allowed disabled:opacity-45',
        it.danger ? 'text-loss' : 'text-ink',
        'pointer-coarse:min-h-11',
      )}
    >
      {it.icon && <span className={cn('mt-0.5 shrink-0', it.danger ? 'text-loss' : 'text-muted')}>{it.icon}</span>}
      <span className="min-w-0">
        <span className="block font-500">{it.label}</span>
        {it.description && <span className="mt-0.5 block text-label text-muted">{it.description}</span>}
      </span>
    </button>
  )

  return (
    <>
      {trigger ? (
        <Button
          ref={btnRef}
          variant="secondary"
          size={size}
          rowSafe
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={className}
        >
          {trigger}
        </Button>
      ) : (
        <IconButton
          ref={btnRef}
          label={label}
          size={size === 'sm' ? 'sm' : 'md'}
          rowSafe
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen((o) => !o)}
          className={className}
        >
          <MoreHorizontal size={18} />
        </IconButton>
      )}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKey}
            onClick={(e) => e.stopPropagation()}
            className="kit-wipe fixed z-[60] rounded-[var(--r-lg)] border border-line-strong bg-surface-2 p-1.5 text-ink shadow-[var(--shadow-2)]"
            style={{ left: -9999, top: -9999, visibility: 'hidden' }}
          >
            {safe.map(renderItem)}
            {danger.length > 0 && safe.length > 0 && <hr className="mx-1.5 my-1 border-0 border-t border-line" />}
            {danger.map(renderItem)}
          </div>,
          document.body,
        )}
    </>
  )
}

// ── Inspector ─────────────────────────────────────────────────────────────────

/**
 * Selection inspector. From 1280px it renders in place as a sticky right
 * column (put it in WithInspector's `inspector` slot); below 1280px the same
 * element becomes a bottom sheet. Replaces hover-only cards.
 */
export function Inspector({
  open,
  onClose,
  title,
  eyebrow,
  actions,
  children,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  eyebrow?: ReactNode
  /** Footer actions (GatedAction, OverflowMenu …). */
  actions?: ReactNode
  children: ReactNode
}) {
  const wide = useMediaQuery(WIDE_QUERY)
  const id = useId()
  if (!wide) {
    return (
      <Sheet open={open} onClose={onClose} title={title} eyebrow={eyebrow} footer={actions}>
        {children}
      </Sheet>
    )
  }
  if (!open) return null
  return (
    <aside
      aria-labelledby={`${id}-t`}
      className="sticky top-4 flex max-h-[calc(100dvh-32px)] flex-col overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface shadow-[var(--shadow-1)]"
    >
      <OverlayHeader id={`${id}-t`} eyebrow={eyebrow} title={title} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 text-body">{children}</div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2 border-t border-line px-4 py-3">{actions}</div>}
    </aside>
  )
}

/** Two-column layout: content + a 360px inspector column from 1280px. */
export function WithInspector({
  children,
  inspector,
  open = true,
  className,
}: {
  children: ReactNode
  inspector: ReactNode
  /** Reserve the column only while the inspector is open. */
  open?: boolean
  className?: string
}) {
  return (
    <div className={cn('grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 xl:items-start', open && 'xl:grid-cols-[minmax(0,1fr)_360px]', className)}>
      <div className="min-w-0">{children}</div>
      {inspector}
    </div>
  )
}

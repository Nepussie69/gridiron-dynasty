import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import { cn } from '../lib/cn'

const GAP = 8
const EDGE = 8
const OPEN_DELAY = 180
const CLOSE_DELAY = 140

/**
 * L12.5 T1: a hover / focus detail panel.
 *
 * Opens after a short hover delay (so it never flashes while the pointer crosses
 * a list) or when its ⓘ button takes keyboard focus. It renders in a portal
 * positioned `fixed` from the trigger's rect, so a scrolling column can never
 * clip it, and dismisses on mouse-leave, blur, Escape, or an outside tap.
 */
export function HoverCard({
  content,
  children,
  className,
  label = 'Show details',
  info = true,
}: {
  content: ReactNode
  children: ReactNode
  className?: string
  /** Title / accessible label for the ⓘ affordance. */
  label?: string
  /** Set false to hide the ⓘ tap target (keyboard focus still works via children). */
  info?: boolean
}) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const anchorRef = useRef<DOMRect | null>(null)
  const timerRef = useRef<number | null>(null)
  const [open, setOpen] = useState(false)

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // Position a panel below the trigger, flipping above when there is no room,
  // and clamping it inside the viewport.
  const place = useCallback((panel: HTMLElement | null, rect: DOMRect | null) => {
    if (!panel || !rect) return
    const pw = panel.offsetWidth
    const ph = panel.offsetHeight
    let left = rect.left
    let top = rect.bottom + GAP
    if (top + ph > window.innerHeight - EDGE && rect.top - GAP - ph > EDGE) top = rect.top - GAP - ph
    left = Math.min(Math.max(EDGE, left), Math.max(EDGE, window.innerWidth - pw - EDGE))
    top = Math.min(Math.max(EDGE, top), Math.max(EDGE, window.innerHeight - ph - EDGE))
    panel.style.left = `${left}px`
    panel.style.top = `${top}px`
    panel.style.visibility = 'visible'
  }, [])

  const openNow = useCallback(() => {
    clearTimer()
    if (triggerRef.current) anchorRef.current = triggerRef.current.getBoundingClientRect()
    setOpen(true)
  }, [clearTimer])

  const openSoon = useCallback(() => {
    clearTimer()
    timerRef.current = window.setTimeout(openNow, OPEN_DELAY)
  }, [clearTimer, openNow])

  // Close after a short grace, but stay open while the pointer rests on any
  // hover panel — that lets a nested card (a player inside a deal panel) open
  // without collapsing its parent.
  const scheduleClose = () => {
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      if (document.querySelector('[data-hovercard-panel]:hover')) {
        scheduleClose()
        return
      }
      setOpen(false)
    }, CLOSE_DELAY)
  }

  const closeNow = useCallback(() => {
    clearTimer()
    setOpen(false)
  }, [clearTimer])

  // Anchor the panel as soon as it mounts (measured), then follow scrolling.
  const attachPanel = useCallback(
    (node: HTMLDivElement | null) => {
      panelRef.current = node
      if (node) place(node, anchorRef.current)
    },
    [place],
  )

  useEffect(() => {
    if (!open) return
    const reposition = () =>
      place(panelRef.current, triggerRef.current?.getBoundingClientRect() ?? anchorRef.current)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [open])

  useEffect(() => clearTimer, [clearTimer])

  return (
    <span
      ref={triggerRef}
      className={cn('inline-flex max-w-full items-center gap-1', className)}
      onMouseEnter={openSoon}
      onMouseLeave={scheduleClose}
      onFocus={openNow}
      onBlur={scheduleClose}
    >
      {children}
      {info && (
        <button
          type="button"
          title={label}
          aria-label={label}
          onMouseEnter={openNow}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            if (open) closeNow()
            else openNow()
          }}
          className="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-line text-faint transition hover:border-[var(--team)] hover:text-ink"
        >
          <Info size={10} />
        </button>
      )}
      {open &&
        createPortal(
          <div
            ref={attachPanel}
            role="tooltip"
            data-hovercard-panel=""
            onMouseEnter={openNow}
            onMouseLeave={scheduleClose}
            className="fixed z-[70] max-h-[70vh] w-[360px] max-w-[calc(100vw-16px)] overflow-y-auto rounded-xl border border-line bg-surface p-3 text-ink shadow-xl"
            style={{ left: -9999, top: -9999, visibility: 'hidden' }}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  )
}

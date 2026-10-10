import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import { cn } from '../lib/cn'
import { Sheet } from '../ui/Overlay'
import { TOUCH_QUERY, useMediaQuery, useOverlayScopeClass } from '../ui/hooks'

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
 *
 * UI redesign F2: the panel is opaque (surface + shadow-2); on touch devices —
 * or any tap that comes from a touch pointer — the details open in a bottom
 * Sheet instead of a hover panel, so nothing is hover-only.
 * V1: the ⓘ dot keeps its 20px look (24px on touch) but its button is a 44px
 * hit box on phones (negative margin, so the row layout is unchanged); the
 * panel keeps the Game Day dark scope via useOverlayScopeClass().
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
  const [sheet, setSheet] = useState(false)
  const touchDevice = useMediaQuery(TOUCH_QUERY)
  const scope = useOverlayScopeClass()
  const lastPointer = useRef<string>('mouse')

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
      onPointerDown={(e) => {
        lastPointer.current = e.pointerType
      }}
      onPointerEnter={(e) => {
        lastPointer.current = e.pointerType
        if (e.pointerType === 'mouse' && !touchDevice) openSoon()
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') scheduleClose()
      }}
      onFocus={() => {
        if (!touchDevice && lastPointer.current === 'mouse') openNow()
      }}
      onBlur={scheduleClose}
    >
      {children}
      {info && (
        <button
          type="button"
          title={label}
          aria-label={label}
          aria-haspopup="dialog"
          onPointerEnter={(e) => {
            if (e.pointerType === 'mouse' && !touchDevice) openNow()
          }}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            if (touchDevice || lastPointer.current === 'touch' || lastPointer.current === 'pen') {
              closeNow()
              setSheet(true)
              return
            }
            if (open) closeNow()
            else openNow()
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className={cn(
            'group/info relative grid shrink-0 place-items-center rounded-full text-muted',
            // Desktop: the 20px dot itself is the button, with a 12px invisible ring of hit area.
            "h-5 w-5 before:absolute before:-inset-3 before:content-['']",
            // Phone width: a 44px button around the same dot; −12px margins keep the 20px footprint.
            'max-sm:pointer-fine:-m-3 max-sm:pointer-fine:h-11 max-sm:pointer-fine:w-11 max-sm:pointer-fine:before:hidden',
            // Touch: the dot grows to 24px inside a 44px button (−10px margins).
            'pointer-coarse:-m-2.5 pointer-coarse:h-11 pointer-coarse:w-11 pointer-coarse:before:hidden',
          )}
        >
          <span
            aria-hidden
            className="grid h-5 w-5 place-items-center rounded-full border border-line-strong transition group-hover/info:border-[var(--team-accent)] group-hover/info:text-ink pointer-coarse:h-6 pointer-coarse:w-6"
          >
            <Info size={12} />
          </span>
        </button>
      )}
      {/* Portal events bubble through the React tree: keep sheet taps away from row handlers. */}
      <span className="contents" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <Sheet open={sheet} onClose={() => setSheet(false)} title={label}>
          {content}
        </Sheet>
      </span>
      {open &&
        !sheet &&
        createPortal(
          <div
            ref={attachPanel}
            role="tooltip"
            data-hovercard-panel=""
            onMouseEnter={openNow}
            onMouseLeave={scheduleClose}
            className={cn(
              'fixed z-[60] max-h-[60vh] w-[280px] max-w-[calc(100vw-16px)] overflow-y-auto rounded-[var(--r-lg)] border border-line-strong bg-surface p-3 text-small text-ink shadow-[var(--shadow-2)]',
              scope,
            )}
            style={{ left: -9999, top: -9999, visibility: 'hidden' }}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  )
}

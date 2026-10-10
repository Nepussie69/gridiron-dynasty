// ─────────────────────────────────────────────────────────────────────────────
// Kit hooks (UI redesign F2). Plain .ts so the .tsx kit files export only
// components (keeps the react only-export-components lint count at 4).
// ─────────────────────────────────────────────────────────────────────────────
import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type RefObject } from 'react'
import type { ThemeName } from '../lib/teamColor'
import { useGame } from '../store/gameStore'
import { ACCESS_META, accessFor, type AccessArea, type AccessLevel } from '../game/engine/access'
import type { MenuItem } from './Overlay'

/** True while a CSS media query matches (SSR / no matchMedia → `fallback`). */
export function useMediaQuery(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
      const mq = window.matchMedia(query)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () =>
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(query).matches
        : fallback,
    () => fallback,
  )
}

/** Phone layout: under 640px (Tailwind `sm`). Tables become card rows, dialogs become sheets. */
export const PHONE_QUERY = '(max-width: 639.98px)'
/** Wide layout: the Inspector sits in a right-hand column from 1280px. */
export const WIDE_QUERY = '(min-width: 1280px)'
/** Touch-first device (no hover). HoverCards open as sheets. */
export const TOUCH_QUERY = '(hover: none) and (pointer: coarse)'

export function usePhone() {
  return useMediaQuery(PHONE_QUERY)
}

/** The theme actually showing: a pinned data-theme, else the OS preference. */
export function getResolvedTheme(): ThemeName {
  if (typeof document === 'undefined') return 'light'
  const t = document.documentElement.getAttribute('data-theme')
  if (t === 'dark' || t === 'light') return t
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function subscribeResolvedTheme(onChange: () => void) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', onChange)
  const mo = new MutationObserver(onChange)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => {
    mq.removeEventListener('change', onChange)
    mo.disconnect()
  }
}

export function useResolvedTheme(): ThemeName {
  return useSyncExternalStore(subscribeResolvedTheme, getResolvedTheme, () => 'light' as ThemeName)
}

// ── Overlay scope ────────────────────────────────────────────────────────────
/**
 * True inside an always-dark `.broadcast` surface (Game Day). Kit overlays
 * portal to document.body, outside that scope, so they read this and re-apply
 * the `broadcast` class on their portal root — a ⋯ menu, sheet or hover panel
 * opened from Game Day stays dark on the light app theme. Provided by
 * <BroadcastScope> (src/ui/Overlay.tsx).
 */
export const BroadcastScopeContext = createContext(false)

/** The extra class a portalled overlay needs to keep its opener's scope. */
export function useOverlayScopeClass(): string | undefined {
  return useContext(BroadcastScopeContext) ? 'broadcast' : undefined
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Every keyboard-focusable element inside `root`, in DOM order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true' && el.tabIndex >= 0,
  )
}

/**
 * Modal behaviour for a dialog / sheet panel while `active`:
 * focus moves inside (first [data-autofocus] element, else the first
 * focusable, else the panel), Tab / Shift+Tab wrap inside the panel, Escape
 * calls `onClose`, page scroll is locked, and focus returns to whatever had it
 * before the panel opened.
 */
export function useModal(ref: RefObject<HTMLElement | null>, active: boolean, onClose: () => void) {
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!active) return
    const panel = ref.current
    const before = document.activeElement as HTMLElement | null
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? (panel ? focusables(panel)[0] : null)
    ;(first ?? panel)?.focus({ preventScroll: true })

    const onKey = (e: KeyboardEvent) => {
      const p = ref.current
      if (!p) return
      // Only the top-most open modal reacts.
      const stack = document.querySelectorAll('[data-kit-modal]')
      if (stack.length && stack[stack.length - 1] !== p) return
      // An open ⋯ menu (portalled) handles its own keys.
      if ((e.target as HTMLElement | null)?.closest?.('[role="menu"]')) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables(p)
      if (!items.length) {
        e.preventDefault()
        p.focus()
        return
      }
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const cur = document.activeElement
      if (e.shiftKey && (cur === firstEl || !p.contains(cur))) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && (cur === lastEl || !p.contains(cur))) {
        e.preventDefault()
        firstEl.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)

    const body = document.body
    const prevOverflow = body.style.overflow
    body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey, true)
      body.style.overflow = prevOverflow
      if (before && typeof before.focus === 'function' && document.contains(before)) before.focus({ preventScroll: true })
    }
  }, [active, ref])
}

// ── Access gating (GatedAction / AccessBanner / gated ⋯ items) ───────────────

/** Your access level on an area (`override` wins; no career → 'decide'). */
export function useAccessLevel(area: AccessArea, override?: AccessLevel): AccessLevel {
  const career = useGame((s) => s.career)
  if (override) return override
  return career ? accessFor(career, area) : 'decide'
}

/**
 * Gate a ⋯ menu item by access level: 'decide' passes through; 'advise'
 * relabels it (adviseLabel, default "Recommend: <label>") and routes to
 * `onAdvise` when given; 'view' / 'locked' disable it and put the reason in
 * the consequence line.
 */
export function gateMenuItem(
  level: AccessLevel,
  item: MenuItem,
  opts: { adviseLabel?: MenuItem['label']; onAdvise?: () => void; reason?: string } = {},
): MenuItem {
  if (level === 'decide') return item
  if (level === 'advise') {
    return {
      ...item,
      label: opts.adviseLabel ?? item.label,
      description: item.description ?? 'Sent to the GM as a recommendation',
      onSelect: opts.onAdvise ?? item.onSelect,
    }
  }
  return { ...item, disabled: true, description: opts.reason ?? ACCESS_META[level].blurb }
}

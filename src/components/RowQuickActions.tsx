// ─────────────────────────────────────────────────────────────────────────────
// Row quick actions (backlog 401) — the always-visible icon buttons in a board
// row's Actions cell. They run the SAME store handlers and the SAME rules as
// the row's ⋯ menu (points, weekly limits, access level); the ⋯ menu keeps the
// full list. The caller builds both from one array, so the two can never drift.
//
//   • each button carries aria-label + title (the blocked reason when disabled,
//     the consequence when allowed) and shows a pressed look when already
//     applied (pounded / flagged)
//   • under 640px (`max-sm:hidden`) the icons collapse away and only the ⋯ menu
//     remains, so a phone row still fits on one line
//   • the focus ring is the global :focus-visible ring (index.css §6)
// ─────────────────────────────────────────────────────────────────────────────
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { IconButton } from '../ui/kit'

/** Ink for a pressed icon — token utilities only. */
const PRESSED_INK = { win: 'text-win', warn: 'text-warn' } as const

export interface QuickAction {
  id: string
  /** Button accessible name and the ⋯ menu label ("Scout prospect"). */
  label: string
  /** Tooltip / menu consequence line — the reason it is blocked when disabled. */
  hint: string
  icon: ReactNode
  onSelect: () => void
  disabled?: boolean
  /** Already applied (pounded / flagged): pressed look + aria-pressed. */
  pressed?: boolean
  /** Ink when pressed. */
  pressedInk?: 'win' | 'warn'
}

export function RowQuickActions({
  actions,
  subject,
  className,
}: {
  actions: QuickAction[]
  /** Who the actions act on — the accessible names end with it. */
  subject: string
  className?: string
}) {
  if (!actions.length) return null
  return (
    <span role="group" aria-label={`Quick actions for ${subject}`} className={cn('flex items-center gap-1 max-sm:hidden', className)}>
      {actions.map((a) => (
        <IconButton
          key={a.id}
          size="sm"
          rowSafe
          label={`${a.label} — ${subject}`}
          title={`${a.label} — ${subject}. ${a.hint}`}
          disabled={a.disabled}
          pressed={a.pressed}
          onClick={a.onSelect}
        >
          <span aria-hidden className={a.pressed && a.pressedInk ? PRESSED_INK[a.pressedInk] : undefined}>
            {a.icon}
          </span>
        </IconButton>
      ))}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #5 C3: the replay-review overlay over the field.
//
// A booth review or a thrown red flag records a `Play.review`. This card plays
// the broadcast sequence over the field — "UNDER REVIEW: ruled a catch at the
// 34" then "REVERSED: incomplete" / "CALL STANDS: BUF lose a timeout" /
// "CONFIRMED" — and then clears itself. It holds no engine state: MatchView
// hands it the review and the corrected result text.
//
// After a reversal MatchView jumps the animation to the corrected end frame
// (backlog 82: no replay flash); this card only reports what happened.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn'
import { Badge } from '../ui/kit'
import type { PlayReview } from '../game/engine/review'

/** The sequence's closing line: the corrected call, the timeout, or confirmed. */
function reviewResultText(review: PlayReview, result: string, clubAbbr?: string): string {
  if (review.outcome === 'reversed') {
    const text = result ? `${result.charAt(0).toLowerCase()}${result.slice(1)}` : 'the call is overturned'
    return `REVERSED: ${text}`
  }
  if (review.outcome === 'stands') {
    return clubAbbr ? `CALL STANDS: ${clubAbbr} lose a timeout` : 'CALL STANDS: the ruling holds, a timeout is lost'
  }
  return 'CONFIRMED'
}

/** Under review → result, over the field, then gone. Non-interactive. */
export function ReviewCard({
  review,
  result,
  clubAbbr,
  onDone,
  className,
}: {
  review: PlayReview
  /** The corrected play result (the truth after a reversal). */
  result: string
  /** The club that lost the timeout on a challenge that stood. */
  clubAbbr?: string
  onDone?: () => void
  className?: string
}) {
  const [phase, setPhase] = useState<'under' | 'done'>('under')
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  })
  useEffect(() => {
    const toResult = window.setTimeout(() => setPhase('done'), 1150)
    const toClose = window.setTimeout(() => doneRef.current?.(), 3600)
    return () => {
      window.clearTimeout(toResult)
      window.clearTimeout(toClose)
    }
  }, [])

  const reversed = review.outcome === 'reversed'
  const line = phase === 'under' ? `UNDER REVIEW: ${review.ruling}` : reviewResultText(review, result, clubAbbr)
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('pointer-events-none absolute inset-x-3 top-3 z-30 flex justify-center sm:inset-x-0', className)}
    >
      <div className="kit-pop w-full max-w-md rounded-[var(--r-lg)] border border-line-strong bg-canvas/85 p-3 text-center shadow-[0_18px_40px_-18px_rgba(0,0,0,0.85)] backdrop-blur-md">
        <div className="mb-1.5 flex items-center justify-center gap-2">
          <Badge tone={review.by === 'booth' ? 'neutral' : 'loss'}>{review.by === 'booth' ? 'Booth' : 'Challenge'}</Badge>
          <span className="font-cond text-label font-700 uppercase tracking-[0.08em] text-muted">
            {phase === 'under' ? 'Under review…' : reversed ? 'Reversed' : review.outcome === 'stands' ? 'Call stands' : 'Confirmed'}
          </span>
        </div>
        <div
          className={cn(
            'font-display text-base font-700 uppercase italic leading-tight',
            phase === 'under' ? 'text-ink' : reversed ? 'text-win' : review.outcome === 'stands' ? 'text-loss' : 'text-ink-2',
          )}
        >
          {line}
        </div>
      </div>
    </div>
  )
}

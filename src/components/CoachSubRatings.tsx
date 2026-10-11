// ─────────────────────────────────────────────────────────────────────────────
// J9 (FUTURES #32 follow-up): a coach's sub-ratings, drawn with the same tier
// colours as player ratings. The sheet is derived by the engine, so old saves
// show exactly the numbers the sim reads. Metadata lives in coachSubsUi.ts.
// ─────────────────────────────────────────────────────────────────────────────
import type { StaffMember } from '../game/types'
import { cn } from '../lib/cn'
import { RatingBar } from '../ui/kit'
import { SUB_META, subsForRole, subTitle, subValue } from './coachSubsUi'

/**
 * The sub-ratings for a coach's seat.
 *  • `chips` (default): label · tier bar · value, wrapping — for rows and cards.
 *  • `rows`: a full-labelled line with the bar beneath — for the inspector.
 * Renders nothing when the role has no sub panel.
 */
export function CoachSubRatings({
  m,
  layout = 'chips',
  className,
}: {
  m: StaffMember
  layout?: 'chips' | 'rows'
  className?: string
}) {
  const keys = subsForRole(m.role)
  if (!keys.length) return null

  if (layout === 'rows') {
    return (
      <div className={cn('space-y-2.5', className)}>
        {keys.map((k) => {
          const v = subValue(m, k)
          const title = subTitle(k, v)
          return (
            <div key={k} title={title}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-cond text-label font-700 uppercase tracking-wide text-ink-2">{SUB_META[k].label}</span>
                <span className="font-cond text-label font-700 tnum text-ink">{Math.round(v)}</span>
              </div>
              <RatingBar value={v} height={7} tone="tier" label={title} />
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <ul className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      {keys.map((k) => {
        const v = subValue(m, k)
        const title = subTitle(k, v)
        return (
          <li key={k} className="inline-flex items-center gap-1.5" title={title}>
            <span className="shrink-0 font-cond text-label font-700 uppercase leading-none tracking-[0.05em] text-muted">
              {SUB_META[k].tag}
            </span>
            <span className="w-9 shrink-0">
              <RatingBar value={v} height={5} tone="tier" label={title} />
            </span>
            <span className="shrink-0 text-label font-600 tnum text-ink-2">{Math.round(v)}</span>
          </li>
        )
      })}
    </ul>
  )
}

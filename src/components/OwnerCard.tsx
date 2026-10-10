import { Landmark } from 'lucide-react'
import { jobTone } from '../lib/format'
import { ownerName, ownerProfile } from '../game/engine/owner'
import { useGame } from '../store/gameStore'
import { Badge, Card } from '../ui/kit'
import { TONE_COLOR } from '../ui/nav'

/**
 * FUTURES 22: the club owner — personality, mandate and firing line.
 *
 * Every owner has a temperament that decides how much rope you get. The bar
 * shows where your job security sits relative to the level at which this owner
 * will make a change, so "win-now" reads very differently from a patient
 * builder. Presentation only: no sim or game result is affected.
 */
export function OwnerCard({ className }: { className?: string }) {
  const career = useGame((s) => s.career)
  if (!career) return null
  const profile = ownerProfile(career.teamId)
  const line = profile.fireLine
  const security = career.jobSecurity
  const near = security <= line + 10
  const mandate = career.ownerExpectation || profile.mandate
  // Tone follows the same scale as the top bar (jobTone), so security is never
  // red above the firing line and colour never means "below average".
  const tone = jobTone(security, line)
  const personalityTone = profile.personality === 'win-now' ? 'warn' : profile.personality === 'patient' ? 'win' : 'neutral'

  return (
    <Card className={className}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Landmark size={16} className="shrink-0 text-[var(--team-accent)]" aria-hidden />
        <h3 className="font-display text-lg font-800 italic uppercase leading-none tracking-[0.01em] text-ink">The Owner</h3>
        <Badge tone={personalityTone} className="ml-auto">
          {profile.label}
        </Badge>
      </div>

      <div className="font-display text-lg font-800 italic uppercase leading-none text-ink">{ownerName(career.teamId)}</div>
      <p className="mt-1 text-small leading-snug text-muted">{profile.blurb}</p>

      <div className="mt-3 rounded-[var(--r-md)] border border-line bg-surface-2 p-2.5">
        <div className="label mb-0.5">Mandate</div>
        <p className="text-small leading-relaxed text-ink-2">{mandate}</p>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between font-cond text-label uppercase tracking-[0.07em] text-muted">
          <span>Your job security</span>
          <span className="tnum text-ink-2">{security}%</span>
        </div>
        <div
          role="meter"
          aria-label={`Job security ${security}%; this owner makes a change at ${line}%`}
          aria-valuenow={security}
          aria-valuemin={0}
          aria-valuemax={100}
          className="relative h-3 w-full overflow-hidden rounded-full bg-surface-3"
        >
          <div
            className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${security}%`, background: TONE_COLOR[tone] }}
          />
          <div className="absolute top-[-2px] h-[calc(100%+4px)] w-0.5 bg-ink" style={{ left: `calc(${line}% - 1px)` }} />
        </div>
        <div className="mt-1 flex items-center justify-between font-cond text-label uppercase tracking-[0.07em] text-faint">
          <span>0%</span>
          <span>{line > 0 ? `Fires at ≤ ${line}%` : 'Only at rock bottom (0%)'}</span>
          <span>100%</span>
        </div>
      </div>

      {near && (
        <p className="mt-3 rounded-[var(--r-md)] border border-loss/30 bg-loss-soft px-2.5 py-2 text-small leading-snug text-loss">
          <span className="font-700 uppercase tracking-wide">On the line: </span>
          {profile.ultimatum}
        </p>
      )}
    </Card>
  )
}

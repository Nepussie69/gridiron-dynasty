import { Landmark } from 'lucide-react'
import { ownerName, ownerProfile } from '../game/engine/owner'
import { useGame } from '../store/gameStore'
import { Badge, Card } from '../ui/kit'

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
  const color = security > line + 25 ? '#05914f' : security > line + 10 ? '#d98207' : '#dc2937'

  return (
    <Card className={className}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Landmark size={16} className="shrink-0 text-[var(--team)]" />
        <h3 className="font-display text-lg font-700 uppercase tracking-wide text-ink">The Owner</h3>
        <Badge tone={profile.personality === 'win-now' ? 'loss' : profile.personality === 'patient' ? 'win' : 'gold'} className="ml-auto">
          {profile.label}
        </Badge>
      </div>

      <div className="font-display text-lg font-700 uppercase leading-none text-ink">{ownerName(career.teamId)}</div>
      <p className="mt-1 text-xs leading-snug text-muted">{profile.blurb}</p>

      <div className="mt-3 rounded-lg border border-line bg-surface-2 p-2.5">
        <div className="label mb-0.5">Mandate</div>
        <p className="text-xs leading-relaxed text-ink-2">{mandate}</p>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between font-cond text-[10px] uppercase text-muted">
          <span>Your job security</span>
          <span className="tnum text-ink-2">{security}%</span>
        </div>
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-surface-3" title={`Firing line: ${line}%`}>
          <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${security}%`, background: color }} />
          <div className="absolute top-[-2px] h-[calc(100%+4px)] w-0.5 bg-ink" style={{ left: `calc(${line}% - 1px)` }} />
        </div>
        <div className="mt-1 flex items-center justify-between font-cond text-[10px] uppercase text-faint">
          <span>0%</span>
          <span>{line > 0 ? `Fires at ≤ ${line}%` : 'Only at rock bottom (0%)'}</span>
          <span>100%</span>
        </div>
      </div>

      {near && (
        <p className="mt-3 rounded-lg border border-loss/30 bg-loss-soft px-2.5 py-2 text-[11px] leading-snug text-loss">
          <span className="font-700 uppercase tracking-wide">On the line: </span>
          {profile.ultimatum}
        </p>
      )}
    </Card>
  )
}

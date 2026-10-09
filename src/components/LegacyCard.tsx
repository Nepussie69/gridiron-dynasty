import { cn } from '../lib/cn'
import { legacyProfile } from '../game/engine/legacyPaths'
import { useGame } from '../store/gameStore'
import { Badge, Card, RatingBar } from '../ui/kit'

/**
 * Legacy paths (#17).
 *
 * Five ways to be judged at the end of a career — Champion, Builder, Talent
 * Finder, Tree Grower, Lifer. This shows the live leader (and the race), so the
 * player can steer their career toward the archetype they want.
 */
export function LegacyCard({ className }: { className?: string }) {
  const career = useGame((s) => s.career)!
  const profile = legacyProfile(career)
  const { leader, all } = profile

  return (
    <Card className={className}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">Your Legacy</h3>
        <Badge tone="gold">{leader.title}</Badge>
      </div>
      <p className="mb-1 text-xs leading-snug text-muted">{leader.blurb}</p>
      {leader.evidence.length > 0 && (
        <ul className="mb-3 space-y-0.5">
          {leader.evidence.map((e) => (
            <li key={e} className="flex items-center gap-1.5 text-[11px] text-ink-2">
              <span className="h-1 w-1 rounded-full bg-[var(--team)]" />
              {e}
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-1.5">
        {all.map((p) => (
          <div key={p.id} className="flex items-center gap-2">
            <span
              className={cn(
                'w-24 truncate font-cond text-[10px] font-700 uppercase tracking-wide',
                p.id === leader.id ? 'text-ink' : 'text-faint',
              )}
            >
              {p.title.replace('The ', '')}
            </span>
            <div className="flex-1">
              <RatingBar value={p.score} color={p.id === leader.id ? 'var(--team)' : 'var(--color-line)'} />
            </div>
            <span className="w-6 text-right font-cond text-[10px] font-700 tnum text-muted">{p.score}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px] leading-snug text-faint">
        {profile.seasons} season{profile.seasons === 1 ? '' : 's'} on the résumé. Five different ways to be
        remembered — pick one and chase it.
      </p>
    </Card>
  )
}

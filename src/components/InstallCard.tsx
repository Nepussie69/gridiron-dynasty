import { Wrench } from 'lucide-react'
import { cn } from '../lib/cn'
import { INSTALL_OPTIONS, canInstall, installEdge, type InstallPlan } from '../game/engine/install'
import { can } from '../game/engine/capabilities'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card } from '../ui/kit'

/** The plain-language status of an active install, in season. */
function installStatus(plan: InstallPlan, week: number): string {
  if (plan === 'lean') return week <= 8 ? `week ${week} of 8 hot` : 'the edge has faded'
  if (week <= 4) return `week ${week} of 4 installing`
  if (week <= 8) return `week ${week} of 8 building`
  return 'fully installed'
}

/**
 * K2 — the install plan.
 *
 * In the offseason a coordinator (for his side) or a head coach (both sides)
 * chooses how much of the system to put in. Lean starts fast and flattens; Full
 * starts slowly and finishes strongest. Once the season starts the card shrinks
 * to a status line so you can see where the curve is this week.
 */
export function InstallCard({ className }: { className?: string }) {
  const career = useGame((s) => s.career)!
  const world = useWorld()
  const chooseInstall = useGame((s) => s.chooseInstall)

  if (!can(career, 'installScheme')) return null

  // Offseason: choose (or review) the coming season's install.
  if (world.phase === 'offseason') {
    const chosen = career.install?.season === world.season + 1 ? career.install.plan : undefined
    const open = canInstall(world, career)
    return (
      <Card className={className}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 font-display text-lg font-700 uppercase tracking-wide">
            <Wrench size={15} className="text-[var(--team)]" /> Install plan
          </h3>
          <Badge tone={chosen ? 'win' : 'team'}>
            {chosen ? 'Locked in' : `Season ${world.season + 1}`}
          </Badge>
        </div>
        <p className="mb-3 text-xs leading-snug text-muted">
          {chosen
            ? `Your ${chosen === 'lean' ? 'Lean' : 'Full'} install is set for next season.`
            : 'Choose how much of the system to put in before next season. This locks once you pick.'}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {INSTALL_OPTIONS.map((o) => {
            const isChosen = chosen === o.id
            const disabled = !open
            return (
              <button
                key={o.id}
                type="button"
                disabled={disabled}
                onClick={() => chooseInstall(o.id)}
                className={cn(
                  'rounded-lg border p-3 text-left transition',
                  isChosen
                    ? 'border-[var(--team)] bg-[var(--team-soft)]'
                    : disabled
                      ? 'border-line bg-surface-2 opacity-60'
                      : 'border-line bg-surface-2 hover:border-[var(--team)] hover:bg-[var(--team-soft)]',
                )}
              >
                <span className="block text-sm font-600 text-ink">{o.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted">{o.blurb}</span>
              </button>
            )
          })}
        </div>
      </Card>
    )
  }

  // In season: a small status line for the active install.
  const active = career.install?.season === world.season ? career.install : undefined
  if (!active) return null
  const edge = installEdge(active.plan, world.week)
  const chip = edge > 0 ? `+${edge.toFixed(1)}` : edge.toFixed(1)
  return (
    <Card pad={false} className={cn('flex items-center gap-2 px-4 py-2.5', className)}>
      <Wrench size={14} className="shrink-0 text-muted" />
      <span className="text-xs text-muted">
        Install: <strong className="text-ink">{active.plan === 'lean' ? 'Lean' : 'Full'}</strong> —{' '}
        {installStatus(active.plan, world.week)}
      </span>
      <Badge tone={edge > 0 ? 'win' : edge < 0 ? 'warn' : 'neutral'} className="ml-auto">
        {chip}
      </Badge>
    </Card>
  )
}

import { Crosshair } from 'lucide-react'
import { schemeFitSummary } from '../game/engine/style'
import { useWorld } from '../store/gameStore'
import { Badge, Card, RatingBar } from '../ui/kit'

/**
 * Roster fit report for the installed coordinator scheme. Shows how much of the
 * unit is built for the system, plus the best fits and biggest mismatches — so
 * "does my roster match my coordinator?" is answerable from the Game Plan screen.
 */
export function SchemeFitReport({ teamId, side }: { teamId: string; side: 'off' | 'def' }) {
  const world = useWorld()
  const roster = world.roster[teamId] ?? []
  const staff = world.staff[teamId] ?? []
  const role = side === 'off' ? 'Offensive Coordinator' : 'Defensive Coordinator'
  const coach = staff.find((s) => s.role === role)
  const scheme = coach?.scheme ?? ''
  const summary = schemeFitSummary(roster, scheme, side === 'off' ? 'OFF' : 'DEF')

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <Crosshair size={16} className="text-muted" />
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">Scheme Fit Report</h3>
        <Badge tone="team" className="ml-auto">{scheme || 'Uninstalled'}</Badge>
      </div>

      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-muted">{coach ? coach.name : 'No coordinator'} · {role}</span>
        <span className="font-cond font-700 tnum text-ink">{summary.idealPct.toFixed(0)}% ideal</span>
      </div>
      <RatingBar
        value={summary.idealPct}
        height={8}
        color={summary.idealPct >= 55 ? '#05914f' : summary.idealPct >= 30 ? '#d98207' : '#dc2937'}
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge tone="win">{summary.ideal} Ideal</Badge>
        <Badge tone="info">{summary.good} Good</Badge>
        <Badge tone={summary.poor > 0 ? 'loss' : 'neutral'}>{summary.poor} Poor</Badge>
        <span className="ml-auto self-center text-[11px] text-muted">{summary.total} on the unit</span>
      </div>

      {summary.worst.length > 0 ? (
        <div className="mt-3 rounded-lg bg-surface-2 p-3">
          <div className="label mb-1.5">Biggest mismatches</div>
          <div className="space-y-1">
            {summary.worst.map((w) => (
              <div key={w.id} className="flex items-center gap-2 text-xs">
                <span className="w-7 font-cond font-700 uppercase text-muted">{w.pos}</span>
                <span className="flex-1 truncate font-600 text-ink">{w.name}</span>
                <Badge tone="loss">Poor</Badge>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            These players will underperform until they learn the system — or you change it.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted">
          No mismatches. This unit is built to run the {scheme || 'installed'} system.
        </p>
      )}
    </Card>
  )
}

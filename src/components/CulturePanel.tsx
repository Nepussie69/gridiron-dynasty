import { Users } from 'lucide-react'
import { cn } from '../lib/cn'
import {
  cohesionLabel,
  masteryLabel,
  unitCohesion,
  type UnitCohesion,
} from '../game/engine/playbook'
import { cultureLabel, cultureScore } from '../game/engine/culture'
import { useWorld } from '../store/gameStore'
import { Badge, Card, RatingBar } from '../ui/kit'

/**
 * "Culture" panel — surfaces team cohesion (staff continuity × unit continuity)
 * for both sides of the ball. Data is already computed per player in
 * engine/playbook.ts; this just reads it back for the front office.
 */
export function CulturePanel({ teamId, className }: { teamId: string; className?: string }) {
  const world = useWorld()
  const roster = world.roster[teamId] ?? []
  const staff = world.staff[teamId] ?? []
  const ocScheme = staff.find((s) => s.role === 'Offensive Coordinator')?.scheme ?? ''
  const dcScheme = staff.find((s) => s.role === 'Defensive Coordinator')?.scheme ?? ''
  const off = unitCohesion(roster, 'off', ocScheme, world.staffTenure?.[`${teamId}:off`] ?? 1)
  const def = unitCohesion(roster, 'def', dcScheme, world.staffTenure?.[`${teamId}:def`] ?? 1)
  const avg = (off.cohesion + def.cohesion) / 2
  const culture = cultureScore(world, teamId)
  const cl = cultureLabel(culture)

  return (
    <Card className={className}>
      <div className="mb-3 flex items-center gap-2">
        <Users size={16} className="text-muted" />
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">Culture</h3>
        <Badge tone={cl.tone} className="ml-auto">{cl.label} · {culture}</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SideUnit title="Offense" scheme={ocScheme} unit={off} />
        <SideUnit title="Defense" scheme={dcScheme} unit={def} />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">{cultureRead(avg)}</p>
    </Card>
  )
}

function SideUnit({ title, scheme, unit }: { title: string; scheme: string; unit: UnitCohesion }) {
  const label = cohesionLabel(unit.cohesion)
  const mastery = masteryLabel(unit.mastery)
  const pct = Math.round(unit.cohesion * 100)
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-cond text-xs font-700 uppercase tracking-wide text-ink">{title}</span>
        <Badge tone={label.tone}>{label.label}</Badge>
      </div>
      <div className="mb-2">
        <RatingBar
          value={pct}
          height={8}
          color={pct >= 75 ? '#05914f' : pct >= 45 ? '#d98207' : '#dc2937'}
        />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Mini label="Staff" value={`${unit.staffYears} yr${unit.staffYears === 1 ? '' : 's'}`} />
        <Mini label="Unit" value={`${unit.unitYears.toFixed(1)} yr`} />
        <Mini label="Mastery" value={`${Math.round(unit.mastery)}%`} />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
        <span className={cn('font-cond font-700 uppercase', mastery.tone === 'win' ? 'text-win' : mastery.tone === 'loss' ? 'text-loss' : mastery.tone === 'warn' ? 'text-warn' : 'text-ink-2')}>
          {mastery.label}
        </span>
        <span>{Math.round(unit.fitPct)}% ideal fits · {scheme || 'No scheme'}</span>
      </div>
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface px-1.5 py-1">
      <div className="label !text-[9px]">{label}</div>
      <div className="font-display text-sm font-700 tnum text-ink">{value}</div>
    </div>
  )
}

function cultureRead(c: number): string {
  if (c >= 0.85) return 'A tight-knit room: the staff and core have stayed together, the system is second nature, and this group plays above its paper rating.'
  if (c >= 0.65) return 'A settled program. Continuity is paying off in fewer mistakes and faster, more confident play on both sides.'
  if (c >= 0.45) return 'Still building. Keep this staff and core together and the familiarity — and the production — will keep climbing.'
  if (c >= 0.3) return 'Noticeable turnover. New faces and/or a new coordinator mean a learning curve and more self-inflicted mistakes.'
  return 'Constant churn. With this much roster and staff change, nobody ever masters the system — expect flags and stalled drives until it stabilizes.'
}

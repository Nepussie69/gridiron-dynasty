import { Users } from 'lucide-react'
import { cn } from '../lib/cn'
import {
  cohesionLabel,
  masteryLabel,
  unitCohesion,
  type UnitCohesion,
} from '../game/engine/playbook'
import { cultureLabel, cultureScore } from '../game/engine/culture'
import { leadershipCultureBonus } from '../game/engine/skills'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, RatingBar } from '../ui/kit'

/**
 * "Culture" panel — surfaces team cohesion (staff continuity × unit continuity)
 * for both sides of the ball. Data is already computed per player in
 * engine/playbook.ts; this just reads it back for the front office.
 */
export function CulturePanel({ teamId, className }: { teamId: string; className?: string }) {
  const world = useWorld()
  const career = useGame((s) => s.career)
  const roster = world.roster[teamId] ?? []
  const staff = world.staff[teamId] ?? []
  const ocScheme = staff.find((s) => s.role === 'Offensive Coordinator')?.scheme ?? ''
  const dcScheme = staff.find((s) => s.role === 'Defensive Coordinator')?.scheme ?? ''
  const off = unitCohesion(roster, 'off', ocScheme, world.staffTenure?.[`${teamId}:off`] ?? 1)
  const def = unitCohesion(roster, 'def', dcScheme, world.staffTenure?.[`${teamId}:def`] ?? 1)
  const avg = (off.cohesion + def.cohesion) / 2
  // L12.11: the user's Leadership skill lifts his own club's culture.
  const bonus = career && career.teamId === teamId ? leadershipCultureBonus(career.skills.leadership) : 0
  const culture = cultureScore(world, teamId, bonus)
  const cl = cultureLabel(culture)

  return (
    <Card className={className}>
      <div className="mb-3 flex items-center gap-2">
        <Users size={16} className="text-muted" aria-hidden />
        <h3 className="font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em]">Culture</h3>
        <Badge tone={cl.tone} className="ml-auto">{cl.label} · {culture}</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SideUnit title="Offense" scheme={ocScheme} unit={off} />
        <SideUnit title="Defense" scheme={dcScheme} unit={def} />
      </div>
      <p className="mt-3 text-small leading-relaxed text-muted">{cultureRead(avg)}</p>
    </Card>
  )
}

function SideUnit({ title, scheme, unit }: { title: string; scheme: string; unit: UnitCohesion }) {
  const label = cohesionLabel(unit.cohesion)
  const mastery = masteryLabel(unit.mastery)
  const pct = Math.round(unit.cohesion * 100)
  return (
    <div className="rounded-[var(--r-md)] border border-line bg-surface-2 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-cond text-label font-700 uppercase tracking-[0.06em] text-ink">{title}</span>
        <Badge tone={label.tone}>{label.label}</Badge>
      </div>
      <div className="mb-2">
        <RatingBar value={pct} height={8} tone="tier" />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Mini label="Staff" value={`${unit.staffYears} yr${unit.staffYears === 1 ? '' : 's'}`} />
        <Mini label="Unit" value={`${unit.unitYears.toFixed(1)} yr`} />
        <Mini label="Mastery" value={`${Math.round(unit.mastery)}%`} />
      </div>
      <div className="mt-2 flex items-center justify-between text-label text-muted">
        <span className={cn('font-cond font-700 uppercase tracking-[0.06em]', mastery.tone === 'win' ? 'text-win' : mastery.tone === 'loss' ? 'text-loss' : mastery.tone === 'warn' ? 'text-warn' : 'text-ink-2')}>
          {mastery.label}
        </span>
        <span>{Math.round(unit.fitPct)}% ideal fits · {scheme || 'No scheme'}</span>
      </div>
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--r-sm)] bg-surface px-1.5 py-1">
      <div className="label">{label}</div>
      <div className="font-display text-body font-700 tnum text-ink">{value}</div>
    </div>
  )
}

function cultureRead(c: number): string {
  if (c >= 0.85) return 'A veteran group in a stable system. Cohesion is cutting pre-snap flags and fumbles, and it sharpens execution on money downs and in the red zone.'
  if (c >= 0.65) return 'Settled. Continuity is showing up as fewer penalties and fumbles, plus better execution on third down and in the red zone.'
  if (c >= 0.45) return 'Still building. Keep this staff and core together and the penalty and fumble rates should keep falling.'
  if (c >= 0.3) return 'Noticeable turnover. New faces and/or a new coordinator mean more pre-snap flags and fumbles until the group gels.'
  return 'Constant churn. With this much roster and staff change, expect more penalties and fumbles — and a lower ceiling on what the unit can master.'
}

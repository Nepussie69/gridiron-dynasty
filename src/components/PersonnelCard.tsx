import { Users } from 'lucide-react'
import { cn } from '../lib/cn'
import { coachLabels } from '../game/engine/playsim'
import {
  DEF_PACKAGES,
  OFF_PERSONNEL,
  aiDefPackage,
  aiOffPersonnel,
  offDef,
  defDef,
  onField,
  type DefPackage,
  type OffPersonnel,
} from '../game/engine/personnel'
import { useWorld } from '../store/gameStore'
import { Badge, Card } from '../ui/kit'

/**
 * L13 personnel picker: the grouping you send onto the field for one side.
 * "Auto" is the club's scheme default and is the pre-L13 behaviour; picking a
 * package is what turns the feature on. Shared by the Game Plan tab and the
 * in-game plan overlay so the mental model is identical.
 */
export function PersonnelCard({
  side,
  value,
  onChange,
  teamId,
  oppId,
  oppScheme,
  compact = false,
}: {
  side: 'off' | 'def'
  value: OffPersonnel | DefPackage | undefined
  onChange: (v: OffPersonnel | DefPackage | undefined) => void
  teamId: string
  oppId?: string
  oppScheme?: string
  compact?: boolean
}) {
  const world = useWorld()
  const labels = coachLabels(world, teamId)
  const autoId = side === 'off' ? aiOffPersonnel(labels.ocScheme) : aiDefPackage(labels.dcScheme)
  const active = value ?? autoId
  const activeDef = side === 'off' ? offDef(active as OffPersonnel) : defDef(active as DefPackage)
  const rows = onField(world, teamId, side, active)
  const options = side === 'off'
    ? OFF_PERSONNEL.map((p) => ({ id: p.id as string, label: p.label, name: p.name, blurb: p.blurb }))
    : DEF_PACKAGES.map((p) => ({ id: p.id as string, label: p.label, name: p.name, blurb: p.blurb }))

  const body = (
    <div className={cn('space-y-3', compact && 'space-y-2.5')}>
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => onChange(undefined)}
          className={cn(
            'rounded-lg border px-3 py-1.5 text-left transition',
            value === undefined ? 'border-[var(--team)] bg-[var(--team-soft)]' : 'border-line bg-surface-2 hover:border-line-strong',
          )}
        >
          <div className={cn('font-cond text-xs font-700 uppercase tracking-wide', value === undefined ? 'text-ink' : 'text-muted')}>Auto</div>
          <div className="text-[10px] leading-snug text-muted">{side === 'off' ? offDef(autoId as OffPersonnel)?.label : defDef(autoId as DefPackage)?.label} · scheme</div>
        </button>
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => onChange(o.id as OffPersonnel | DefPackage)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-left transition',
              value === o.id ? 'border-[var(--team)] bg-[var(--team-soft)]' : 'border-line bg-surface-2 hover:border-line-strong',
            )}
          >
            <div className={cn('font-cond text-xs font-700 uppercase tracking-wide', value === o.id ? 'text-ink' : 'text-muted')}>{o.label}</div>
            <div className="text-[10px] leading-snug text-muted">{o.name}</div>
          </button>
        ))}
      </div>

      <p className="text-xs text-muted">{activeDef?.blurb}</p>

      <div>
        <div className="label mb-1">{side === 'off' ? 'On the field' : 'On the field (front + coverage)'}</div>
        <div className="flex flex-wrap gap-1">
          {rows.map((r, i) => (
            <span key={`${r.name}-${i}`} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-2">
              <span className="font-cond text-[10px] font-700 uppercase text-muted">{r.pos}</span>
              <span className="max-w-[8rem] truncate">{r.name}</span>
              <span className="font-cond text-[10px] font-700 tnum text-ink">{r.ovr}</span>
            </span>
          ))}
        </div>
      </div>

      {oppId && oppScheme && (
        <p className="text-xs text-muted">
          {side === 'off'
            ? <>Their defence leans <strong className="text-ink-2">{aiDefPackage(oppScheme) === 'base' ? 'Base' : aiDefPackage(oppScheme) === 'dime' ? 'Dime' : 'Nickel'}</strong> out of {oppScheme}.</>
            : <>Their offence leans <strong className="text-ink-2">{aiOffPersonnel(oppScheme)} personnel</strong> out of {oppScheme}.</>}
        </p>
      )}
    </div>
  )

  if (compact) {
    return (
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Users size={14} className="text-muted" />
          <span className="font-cond text-xs font-700 uppercase tracking-wide text-ink-2">Personnel</span>
          <Badge tone="team" className="ml-auto">{activeDef?.name}</Badge>
        </div>
        {body}
      </div>
    )
  }

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <Users size={16} className="text-muted" />
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">Personnel</h3>
        <Badge tone="team" className="ml-auto">{activeDef?.name}</Badge>
      </div>
      {body}
      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        Your grouping changes who lines up and the matchup that follows — a heavy offence punishes a light box,
        a spread offence attacks a base defence. Auto keeps your coordinator&rsquo;s default (and the old sim).
      </p>
    </Card>
  )
}

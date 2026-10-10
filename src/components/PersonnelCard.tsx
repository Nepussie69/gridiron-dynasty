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
import { Badge, Card, OptionCard, OptionGroup } from '../ui/kit'

/**
 * L13 personnel picker: the grouping you send onto the field for one side.
 * "Auto" is the club's scheme default and is the pre-L13 behaviour; picking a
 * package is what turns the feature on. Shared by the Game Plan tab and the
 * in-game plan overlay so the mental model is identical.
 *
 * D6: options are kit OptionCards (radio mark, distinct hover/selected states),
 * so the card reads the same standalone and inside MatchView's .broadcast scope.
 */
export function PersonnelCard({
  side,
  value,
  onChange,
  teamId,
  oppId,
  oppScheme,
  compact = false,
  disabled = false,
}: {
  side: 'off' | 'def'
  value: OffPersonnel | DefPackage | undefined
  onChange: (v: OffPersonnel | DefPackage | undefined) => void
  teamId: string
  oppId?: string
  oppScheme?: string
  compact?: boolean
  /** Access 'view' / a locked game: show the grouping without letting it change. */
  disabled?: boolean
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
  const autoName = side === 'off' ? offDef(autoId as OffPersonnel)?.name : defDef(autoId as DefPackage)?.name

  const body = (
    <div className={cn('space-y-3', compact && 'space-y-2.5')}>
      <OptionGroup
        label={side === 'off' ? 'Offensive personnel' : 'Defensive package'}
        className="sm:grid-cols-2"
      >
        <OptionCard
          selected={value === undefined}
          disabled={disabled}
          onSelect={() => onChange(undefined)}
          title="Auto"
          description={`${autoName ?? 'Scheme default'} · your coordinator's call`}
        />
        {options.map((o) => (
          <OptionCard
            key={o.id}
            selected={value === o.id}
            disabled={disabled}
            onSelect={() => onChange(o.id as OffPersonnel | DefPackage)}
            title={o.label}
            description={o.name}
          />
        ))}
      </OptionGroup>

      <p className="text-small text-muted">{activeDef?.blurb}</p>

      <div>
        <div className="label mb-1">{side === 'off' ? 'On the field' : 'On the field (front + coverage)'}</div>
        <div className="flex flex-wrap gap-1">
          {rows.map((r, i) => (
            <span key={`${r.name}-${i}`} className="inline-flex items-center gap-1 rounded-[var(--r-sm)] bg-surface-2 px-1.5 py-0.5 text-micro text-ink-2">
              <span className="font-cond text-micro font-700 uppercase text-muted">{r.pos}</span>
              <span className="max-w-[8rem] truncate">{r.name}</span>
              <span className="font-cond text-micro font-700 tnum text-ink">{r.ovr}</span>
            </span>
          ))}
        </div>
      </div>

      {oppId && oppScheme && (
        <p className="text-small text-muted">
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
          <span className="font-cond text-label font-700 uppercase tracking-wide text-ink-2">Personnel</span>
          <Badge tone="neutral" className="ml-auto">{activeDef?.label}</Badge>
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
        <Badge tone="neutral" className="ml-auto">{activeDef?.label}</Badge>
      </div>
      {body}
      <p className="mt-3 text-small leading-relaxed text-muted">
        Your grouping changes who lines up and the matchup that follows — a heavy offence punishes a light box,
        a spread offence attacks a base defence. Auto keeps your coordinator&rsquo;s default (and the old sim).
      </p>
    </Card>
  )
}

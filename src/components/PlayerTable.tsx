import { useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { ArrowDownUp, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '../lib/cn'
import { money, ratingTier } from '../lib/format'
import type { Contract, Player, Position } from '../game/types'
import { ATTRIBUTE_SCHEMA, playerAttrs } from '../game/data/ratings'
import { COMPOSITES, ratingTitle, groupForPosition, type Composite } from '../game/data/ratingInfo'
import { capSavings, deadMoney } from '../game/engine/cap'
import { fitLabel, schemeFit } from '../game/engine/style'
import { leagueMasteryMeans, masteryEffectText, masteryGroup, masteryLabel, masteryProgress, type MasteryMeans } from '../game/engine/playbook'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, DensityToggle, DevBadge, OvrBadge, RatingBar, useDensity } from '../ui/kit'
import { usePhone } from '../ui/hooks'
import { PlayerName } from './PlayerHoverCard'

type SortKey =
  | 'name' | 'age' | 'ovr' | 'pot' | 'dev' | 'pbk' | 'cap' | 'dead' | 'yrs' | 'fit'
  | `composite:${string}` | `rating:${string}`
type SortDir = 'asc' | 'desc'

const DEV_RANK: Record<string, number> = {
  'X-Factor': 6,
  Superstar: 5,
  Star: 4,
  Starter: 3,
  Depth: 2,
  Backup: 1,
}

/** One set of morale thresholds, shared with PlayerProfile (one exported binding). */
export type MoraleBand = 'thriving' | 'stable' | 'unhappy'
export const MORALE = {
  thriving: 75,
  stable: 55,
  label: {
    thriving: 'Thriving in the locker room',
    stable: 'Stable',
    unhappy: 'Unhappy',
  } as Record<MoraleBand, string>,
  color: {
    thriving: 'var(--color-win)',
    stable: 'var(--color-brand)',
    unhappy: 'var(--color-warn)',
  } as Record<MoraleBand, string>,
  band(value: number): MoraleBand {
    return value > 75 ? 'thriving' : value > 55 ? 'stable' : 'unhappy'
  },
}

/** Value used to sort a row by column, mirroring DataTable's `sortValue`. */
function sortValue(
  p: Player,
  key: SortKey,
  scheme?: string,
  defScheme?: string,
  attrs?: Record<string, number>,
  composites?: Composite[],
): number | string | null {
  switch (key) {
    case 'name':
      return p.name
    case 'age':
      return p.age
    case 'ovr':
      return p.ovr
    case 'pot':
      return p.pot
    case 'dev':
      return DEV_RANK[p.dev] ?? 0
    case 'pbk':
      return masteryProgress(p)
    case 'cap':
      return p.contract.capHit
    case 'dead':
      return deadMoney(p.contract)
    case 'yrs':
      return p.contract.years
    case 'fit': {
      if (p.side === 'ST') return -1
      const useScheme = p.side === 'DEF' ? defScheme : scheme
      return useScheme ? schemeFit(p, useScheme, p.side === 'DEF' ? 'DEF' : 'OFF') : -1
    }
    default: {
      // R4a: inline composites / ratings when a single position is filtered.
      if (key.startsWith('composite:')) {
        const c = composites?.find((x) => x.id === key.slice(10))
        return c && attrs ? c.compute(attrs) : null
      }
      return attrs?.[key.slice(7)] ?? null
    }
  }
}

/** Inline rating tint by tier (only Liability reads anything like a problem). */
function ratingTint(v: number | null | undefined): string {
  if (v == null) return 'text-faint'
  const t = ratingTier(v)
  if (t.key === 'elite') return 'font-700 text-gold'
  if (t.key === 'pro' || t.key === 'starter') return 'font-600 text-ink-2'
  return 'text-muted'
}

/**
 * Dead money if released now, plus the cap savings — with a colour cue so you
 * can see at a glance whether cutting a player helps or hurts the cap.
 */
export function DeadMoneyCell({ contract }: { contract: Contract }) {
  const dead = deadMoney(contract)
  const save = capSavings(contract)
  const hurts = save < 0
  return (
    <span className={cn('font-cond text-small font-700 tnum', hurts ? 'text-loss' : 'text-ink-2')}>
      {money(dead)}
    </span>
  )
}

/** Single injury chip: "OUT 3W" (the note rides the tooltip). */
export function InjuryChip({ player, className }: { player: Player; className?: string }) {
  if (!player.injured) return null
  return (
    <span title={player.injured.note} className="inline-flex shrink-0">
      <Badge tone="loss" className={className}>
        OUT {player.injured.games}W
      </Badge>
    </span>
  )
}

/** Scheme-fit chip: warns when a player doesn't suit the coordinator's system. */
export function FitBadge({ player, scheme, defScheme }: { player: Player; scheme?: string; defScheme?: string }) {
  if (player.side === 'ST') return <span className="text-faint">—</span>
  const useScheme = player.side === 'DEF' ? defScheme : scheme
  if (!useScheme) return <span className="text-faint">—</span>
  const fit = fitLabel(player, useScheme, player.side === 'DEF' ? 'DEF' : 'OFF')
  return (
    <Badge tone={fit === 'Ideal' ? 'win' : fit === 'Good' ? 'info' : 'warn'}>
      {fit}
    </Badge>
  )
}

interface Props {
  players: Player[]
  showContract?: boolean
  showDeadMoney?: boolean
  showCollege?: boolean
  showMorale?: boolean
  showPhysicals?: boolean
  showFit?: boolean
  scheme?: string
  defScheme?: string
  /** R4a: when a single position is filtered, show its composites + first 4 ratings. */
  inlinePos?: Position
  rank?: boolean
  right?: (p: Player) => ReactNode
  emptyText?: string
  /** Controlled sort (Roster keeps its select in sync). Omit for internal state. */
  sortKey?: SortKey | null
  sortDir?: SortDir
  onSortChange?: (key: SortKey | null, dir: SortDir) => void
}

export function PlayerTable({
  players,
  showContract = true,
  showDeadMoney = false,
  showCollege = false,
  showMorale = false,
  showPhysicals = false,
  showFit = false,
  scheme,
  defScheme,
  inlinePos,
  rank = false,
  right,
  emptyText = 'No players to show.',
  sortKey: sortKeyProp,
  sortDir: sortDirProp,
  onSortChange,
}: Props) {
  const selectPlayer = useGame((s) => s.selectPlayer)
  const world = useWorld()
  const masteryMeans = leagueMasteryMeans(world)
  const { density, fontSize } = useDensity()
  const phone = usePhone()
  const [internalKey, setInternalKey] = useState<SortKey | null>(null)
  const [internalDir, setInternalDir] = useState<SortDir>('desc')
  const controlled = sortKeyProp !== undefined
  const sortKey = controlled ? sortKeyProp : internalKey
  const dir: SortDir = controlled ? (sortDirProp ?? 'desc') : internalDir

  const inlineGroup = inlinePos ? groupForPosition(inlinePos) : null
  const inlineComposites = useMemo(() => (inlineGroup ? COMPOSITES[inlineGroup] ?? [] : []), [inlineGroup])
  const inlineRatings = useMemo(
    () => (inlinePos ? (ATTRIBUTE_SCHEMA[inlinePos] ?? []).slice(0, 4) : []),
    [inlinePos],
  )
  const attrsById = useMemo(() => {
    const m = new Map<string, Record<string, number>>()
    if (inlinePos) for (const p of players) m.set(p.id, playerAttrs(p))
    return m
  }, [players, inlinePos])

  const sorted = useMemo(() => {
    if (!sortKey) return players
    const copy = [...players]
    copy.sort((a, b) => {
      const va = sortValue(a, sortKey, scheme, defScheme, attrsById.get(a.id), inlineComposites)
      const vb = sortValue(b, sortKey, scheme, defScheme, attrsById.get(b.id), inlineComposites)
      const ma = va == null
      const mb = vb == null
      if (ma && mb) return a.name.localeCompare(b.name)
      if (ma) return 1
      if (mb) return -1
      const cmp =
        typeof va === 'string' || typeof vb === 'string'
          ? String(va).localeCompare(String(vb))
          : (va as number) - (vb as number)
      return dir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [players, sortKey, dir, scheme, defScheme, attrsById, inlineComposites])

  // First click on a new column sorts descending, matching the shared DataTable.
  const toggle = (key: SortKey) => {
    const next: SortDir = sortKey === key && dir === 'desc' ? 'asc' : 'desc'
    if (controlled) onSortChange?.(key, next)
    else {
      setInternalKey(key)
      setInternalDir(next)
    }
  }
  const setSort = (key: SortKey | null, next: SortDir) => {
    if (controlled) onSortChange?.(key, next)
    else {
      setInternalKey(key)
      setInternalDir(next)
    }
  }

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: 'name', label: 'Player' },
    { key: 'age', label: 'Age' },
    { key: 'dev', label: 'Dev' },
    { key: 'ovr', label: 'OVR' },
    { key: 'pot', label: 'POT' },
    ...inlineComposites.map((c) => ({ key: `composite:${c.id}` as SortKey, label: c.label })),
    ...inlineRatings.map((k) => ({ key: `rating:${k}` as SortKey, label: k })),
    { key: 'pbk', label: 'Playbook' },
    ...(showContract ? [{ key: 'cap' as SortKey, label: 'Cap Hit' }] : []),
    ...(showDeadMoney ? [{ key: 'dead' as SortKey, label: 'Dead $' }] : []),
    ...(showContract ? [{ key: 'yrs' as SortKey, label: 'Yrs' }] : []),
  ]

  if (!players.length) {
    return <div className="py-10 text-center text-sm text-muted">{emptyText}</div>
  }

  // ── Card rows (under 640px) ─────────────────────────────────────────────────
  if (phone) {
    return (
      <div>
        <div className="flex items-center gap-2 pb-2">
          <label className="flex min-w-0 flex-1 items-center gap-2">
            <span className="label shrink-0">Sort</span>
            <select
              value={sortKey ?? ''}
              onChange={(e) => setSort((e.target.value || null) as SortKey | null, 'desc')}
              className="h-11 min-w-0 flex-1 rounded-[var(--r-md)] border border-line-strong bg-surface px-2 text-[16px] text-ink"
            >
              <option value="">Default order</option>
              {sortOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setSort(sortKey, dir === 'asc' ? 'desc' : 'asc')}
            disabled={!sortKey}
            aria-label={`Sorted ${dir === 'asc' ? 'ascending' : 'descending'}; switch direction`}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--r-md)] border border-line-strong bg-surface text-ink-2 disabled:opacity-45"
          >
            <ArrowDownUp size={16} />
          </button>
        </div>
        {showDeadMoney && <DeadLegend className="pb-2" />}
        <div className="space-y-2" role="list">
          {sorted.map((p) => (
            <PlayerCardRow
              key={p.id}
              player={p}
              attrs={attrsById.get(p.id)}
              inlineComposites={inlineComposites}
              inlineRatings={inlineRatings}
              means={masteryMeans}
              showContract={showContract}
              showDeadMoney={showDeadMoney}
              showCollege={showCollege}
              showMorale={showMorale}
              showPhysicals={showPhysicals}
              showFit={showFit}
              scheme={scheme}
              defScheme={defScheme}
              onSelect={() => selectPlayer(p.id)}
              right={right?.(p)}
            />
          ))}
        </div>
      </div>
    )
  }

  // ── Table (≥640px) ──────────────────────────────────────────────────────────
  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-2 pb-1.5">
        {showDeadMoney ? <DeadLegend /> : <span />}
        <DensityToggle />
      </div>
      <div className="overflow-x-auto">
        <table data-density={density} className={cn('w-full border-collapse tnum', fontSize)}>
          <thead>
            <tr className="border-b border-line text-left">
              {rank && <Th className="w-8">#</Th>}
              <RatingHead sortKey={sortKey} dir={dir} onSort={toggle} />
              <Th className="sticky left-16 bg-surface" onClick={() => toggle('name')} active={sortKey === 'name'} dir={dir}>Player</Th>
              <Th className="w-12 text-right" onClick={() => toggle('age')} active={sortKey === 'age'} dir={dir}>Age</Th>
              {showPhysicals && <Th className="w-24">Ht/Wt</Th>}
              {showFit && <Th className="w-20 text-center" onClick={() => toggle('fit')} active={sortKey === 'fit'} dir={dir}>Fit</Th>}
              {showCollege && <Th className="w-40">College</Th>}
              <Th className="w-14 text-center" onClick={() => toggle('dev')} active={sortKey === 'dev'} dir={dir}>Dev</Th>
              {inlineComposites.map((c) => (
                <Th
                  key={c.id}
                  className="w-16 text-center text-ink"
                  title={c.title}
                  onClick={() => toggle(`composite:${c.id}`)}
                  active={sortKey === `composite:${c.id}`}
                  dir={dir}
                >
                  {c.label}
                </Th>
              ))}
              {inlineRatings.map((k) => (
                <Th
                  key={k}
                  className="w-12 text-center"
                  title={ratingTitle(k)}
                  onClick={() => toggle(`rating:${k}`)}
                  active={sortKey === `rating:${k}`}
                  dir={dir}
                >
                  {k}
                </Th>
              ))}
              <Th className="w-24 text-center" onClick={() => toggle('pbk')} active={sortKey === 'pbk'} dir={dir}>Playbook</Th>
              {showMorale && <Th className="w-20">Morale</Th>}
              {showContract && <Th className="w-20 text-right" onClick={() => toggle('cap')} active={sortKey === 'cap'} dir={dir}>Cap Hit</Th>}
              {showDeadMoney && <Th className="w-20 text-right" onClick={() => toggle('dead')} active={sortKey === 'dead'} dir={dir}>Dead $</Th>}
              {showContract && <Th className="w-14 text-right" onClick={() => toggle('yrs')} active={sortKey === 'yrs'} dir={dir}>Yrs</Th>}
              {right && <Th className="w-36 text-right">Action</Th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => (
              <tr
                key={p.id}
                onClick={() => selectPlayer(p.id)}
                className="motion cursor-pointer border-b border-line/60 hover:bg-[var(--team-tint)]"
              >
                {rank && <Td className="font-cond text-muted">{i + 1}</Td>}
                <Td className="sticky left-0 w-16 bg-surface">
                  <OvrBadge value={p.ovr} pot={p.pot} size={30} />
                </Td>
                <Td className="sticky left-16 bg-surface">
                  <div className="flex items-center gap-2">
                    <span className="font-cond text-micro font-700 uppercase text-muted">{p.pos}</span>
                    <PlayerName player={p} className="font-600 text-ink" />
                    <InjuryChip player={p} />
                  </div>
                </Td>
                <Td className="text-right text-ink-2">{p.age}</Td>
                {showPhysicals && (
                  <Td className="text-muted">
                    {p.height} · {p.weight}
                  </Td>
                )}
                {showFit && (
                  <Td className="text-center">
                    <FitBadge player={p} scheme={scheme} defScheme={defScheme} />
                  </Td>
                )}
                {showCollege && <Td className="truncate text-muted">{p.college}</Td>}
                <Td className="text-center">
                  <DevBadge dev={p.dev} />
                </Td>
                {inlineComposites.map((c) => {
                  const v = attrsById.get(p.id) ? c.compute(attrsById.get(p.id)!) : null
                  return (
                    <Td key={c.id} className={cn('text-center', ratingTint(v))}>
                      {v == null ? '–' : Math.round(v)}
                    </Td>
                  )
                })}
                {inlineRatings.map((k) => {
                  const v = attrsById.get(p.id)?.[k]
                  return (
                    <Td key={k} className={cn('text-center', ratingTint(v))}>
                      {v == null ? '–' : Math.round(v)}
                    </Td>
                  )
                })}
                <Td>
                  <PlaybookCell player={p} means={masteryMeans} />
                </Td>
                {showMorale && (
                  <Td>
                    <MoraleDots value={p.morale} />
                  </Td>
                )}
                {showContract && (
                  <Td className="text-right font-cond font-600 text-ink-2">{money(p.contract.capHit)}</Td>
                )}
                {showDeadMoney && (
                  <Td className="text-right">
                    <DeadMoneyCell contract={p.contract} />
                  </Td>
                )}
                {showContract && <Td className="text-right text-muted">{p.contract.years} yr</Td>}
                {right && <Td className="text-right" onClick={(e) => e.stopPropagation()}>{right(p)}</Td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** The rating column header: OVR / POT both sortable, over the sticky tile. */
function RatingHead({
  sortKey,
  dir,
  onSort,
}: {
  sortKey: SortKey | null
  dir: SortDir
  onSort: (key: SortKey) => void
}) {
  const { headPad } = useDensity()
  return (
    <th scope="col" className={cn('sticky left-0 z-20 w-16 bg-surface px-2', headPad)}>
      <span className="inline-flex items-center gap-0.5">
        {([['ovr', 'OVR', 'Sort by overall'], ['pot', 'POT', 'Sort by potential']] as const).map(([k, label, tip], i) => (
          <span key={k} className="inline-flex items-center gap-0.5">
            {i > 0 && <span className="text-faint">/</span>}
            <button
              type="button"
              title={`${tip} (first click sorts high to low)`}
              onClick={() => onSort(k)}
              className={cn(
                'label inline-flex cursor-pointer select-none items-center gap-0.5 font-700 uppercase hover:text-ink-2',
                sortKey === k && 'text-ink',
              )}
            >
              {label}
              {sortKey === k && (dir === 'asc' ? <ChevronUp size={11} aria-hidden /> : <ChevronDown size={11} aria-hidden />)}
            </button>
          </span>
        ))}
      </span>
    </th>
  )
}

/** The Dead $ column key: red means releasing now costs cap. */
function DeadLegend({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-label text-muted', className)}>
      <span aria-hidden className="h-2.5 w-2.5 rounded-[2px] bg-loss-soft shadow-[inset_0_0_0_1px_var(--color-loss)]" />
      Dead $ in red = cutting now costs cap
    </span>
  )
}

/** A phone card row: title (pos + name + injury), the rating tile, and the rest. */
function PlayerCardRow({
  player,
  attrs,
  inlineComposites,
  inlineRatings,
  means,
  showContract,
  showDeadMoney,
  showCollege,
  showMorale,
  showPhysicals,
  showFit,
  scheme,
  defScheme,
  onSelect,
  right,
}: {
  player: Player
  attrs?: Record<string, number>
  inlineComposites: Composite[]
  inlineRatings: string[]
  means?: MasteryMeans
  showContract: boolean
  showDeadMoney: boolean
  showCollege: boolean
  showMorale: boolean
  showPhysicals: boolean
  showFit: boolean
  scheme?: string
  defScheme?: string
  onSelect: () => void
  right?: ReactNode
}) {
  const fields: { label: string; value: ReactNode }[] = []
  if (showPhysicals) fields.push({ label: 'Ht/Wt', value: `${player.height} · ${player.weight}` })
  if (showFit) fields.push({ label: 'Fit', value: <FitBadge player={player} scheme={scheme} defScheme={defScheme} /> })
  if (showCollege) fields.push({ label: 'College', value: player.college || '—' })
  fields.push({ label: 'Age', value: player.age })
  if (showMorale) fields.push({ label: 'Morale', value: <MoraleDots value={player.morale} /> })
  if (showContract) {
    fields.push({ label: 'Cap Hit', value: money(player.contract.capHit) })
    fields.push({ label: 'Yrs', value: player.contract.years })
  }
  if (showDeadMoney) fields.push({ label: 'Dead $', value: <DeadMoneyCell contract={player.contract} /> })
  fields.push({ label: 'Playbook', value: <PlaybookCell player={player} means={means} /> })
  if (attrs) {
    for (const c of inlineComposites) fields.push({ label: c.label, value: Math.round(c.compute(attrs)) })
    for (const k of inlineRatings) fields.push({ label: k, value: attrs[k] == null ? '–' : Math.round(attrs[k]) })
  }

  return (
    <div role="listitem" className="rounded-[var(--r-md)] border border-line bg-surface p-3">
      <div className="flex items-start gap-3">
        <button type="button" onClick={onSelect} className="min-h-11 min-w-0 flex-1 text-left lg:min-h-0">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-cond text-micro font-700 uppercase text-muted">{player.pos}</span>
            <span className="font-cond text-row font-700 uppercase tracking-[0.02em] text-ink">{player.name}</span>
            <InjuryChip player={player} />
          </span>
          <span className="mt-1 block">
            <DevBadge dev={player.dev} />
          </span>
        </button>
        <span className="flex shrink-0 items-center gap-2">
          <OvrBadge value={player.ovr} pot={player.pot} size={30} />
          {right}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-small">
        {fields.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="label">{f.label}</dt>
            <dd className="min-w-0 text-ink tnum">{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * Playbook mastery: the % of the system this player has learned, plus a bar.
 * L12.13 M4: the tooltip explains the season's growth and how mastery shows up
 * in games (relative to the league mean for his position group).
 */
export function PlaybookCell({ player, means }: { player: Player; means?: MasteryMeans }) {
  const pct = masteryProgress(player)
  const { label, tone } = masteryLabel(pct)
  const group = masteryGroup(player.pos)
  const mean = means && group ? means[group] : 50
  const gain = player.playbook?.seasonGain ?? 0
  const games = player.stats?.length ? (player.stats[player.stats.length - 1].games ?? 0) : 0
  const role = games >= 10 ? 'starter' : games >= 4 ? 'rotation' : 'backup'
  const coach = group === 'QB' ? 'QB' : group === 'REC' ? 'WR' : (group ?? 'position')
  const effect = group ? masteryEffectText(player, mean) : ''
  const tooltip =
    `${pct}% · ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} this season (${role}, ${games} games) · ` +
    `grows with snaps, good games, AWR, your ${coach} coach, Install weeks` +
    (effect ? ` · in games: ${effect}` : '')
  const color = tone === 'win' ? 'var(--color-win)' : tone === 'info' ? 'var(--color-brand)' : tone === 'warn' ? 'var(--color-warn)' : 'var(--color-loss)'
  return (
    <div className="flex items-center gap-2" title={tooltip}>
      <span className="w-8 font-cond text-small font-700 tnum text-ink-2">{pct}%</span>
      <div className="w-12">
        <RatingBar value={pct} height={5} color={color} />
      </div>
      <span className="hidden font-cond text-label uppercase text-muted xl:inline">{label}</span>
    </div>
  )
}

function Th({
  children,
  className,
  onClick,
  active,
  dir,
  title,
}: {
  children?: ReactNode
  className?: string
  onClick?: () => void
  active?: boolean
  dir?: SortDir
  title?: string
}) {
  const { headPad } = useDensity()
  return (
    <th
      title={title}
      onClick={onClick}
      className={cn(
        'label whitespace-nowrap px-2 font-700',
        headPad,
        onClick && 'cursor-pointer select-none hover:text-ink-2',
        active && 'text-ink',
        className,
      )}
    >
      {onClick ? (
        <span className="inline-flex items-center gap-0.5">
          {children}
          {active && (dir === 'asc' ? <ChevronUp size={11} aria-hidden /> : <ChevronDown size={11} aria-hidden />)}
        </span>
      ) : (
        children
      )}
    </th>
  )
}
function Td({ children, className, onClick }: { children?: ReactNode; className?: string; onClick?: (e: MouseEvent) => void }) {
  const { rowPad } = useDensity()
  return <td onClick={onClick} className={cn('whitespace-nowrap px-2', rowPad, className)}>{children}</td>
}

function MoraleDots({ value }: { value: number }) {
  const band = MORALE.band(value)
  const level = band === 'thriving' ? 4 : band === 'stable' ? 3 : 2
  const color = MORALE.color[band]
  return (
    <div className="flex items-center gap-1" title={MORALE.label[band]}>
      {[1, 2, 3, 4].map((n) => (
        <span
          key={n}
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: n <= level ? color : 'var(--color-surface-3)' }}
        />
      ))}
    </div>
  )
}

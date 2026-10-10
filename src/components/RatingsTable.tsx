import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDownUp, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '../lib/cn'
import { money, ratingTier } from '../lib/format'
import { playerAttrs } from '../game/data/ratings'
import { COMPOSITES, RATING_COLUMNS, RATING_INFO, ratingTitle, type Composite, baseGroup } from '../game/data/ratingInfo'
import { schemeFit } from '../game/engine/style'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, DensityToggle, OvrBadge, TeamCrest, useDensity } from '../ui/kit'
import { usePhone } from '../ui/hooks'
import { FitBadge } from './PlayerTable'
import type { Player } from '../game/types'

type Dir = 'asc' | 'desc'

/** A clickable, sortable column. Composites/ratings are prefixed for lookup. */
type SortKey = 'name' | 'pos' | 'age' | 'ovr' | 'pot' | 'fit' | `composite:${string}` | `rating:${string}`

interface Props {
  players: Player[]
  group: string
  scheme?: string
  defScheme?: string
  /** Optional columns used by the league-wide Find a Player screen. */
  showTeam?: boolean
  showCap?: boolean
  showFit?: boolean
  /** A short tag rendered beside the name (e.g. "PS" for practice squad). */
  tagFor?: (p: Player) => string | null
  /** Rows for this club get the team-soft background. */
  mineTeamId?: string
  /** Cap the rows rendered; pair with `onShowMore` for a "Show more" footer. */
  limit?: number
  onShowMore?: () => void
  /** L12.8 V1: optional per-row action cell (the club page's "Trade for…"). */
  right?: (p: Player) => ReactNode
  /** Find a Player: pin the OVR/POT tile as the first sticky column. */
  ovrFirst?: boolean
}

function rawValue(
  p: Player,
  key: SortKey,
  attrs: Record<string, number> | undefined,
  composites: Composite[],
  scheme?: string,
  defScheme?: string,
): number | string | null {
  switch (key) {
    case 'name':
      return p.name
    case 'pos':
      return p.pos
    case 'age':
      return p.age
    case 'ovr':
      return p.ovr
    case 'pot':
      return p.pot
    case 'fit': {
      if (p.side === 'ST') return -1
      const useScheme = p.side === 'DEF' ? defScheme : scheme
      return useScheme ? schemeFit(p, useScheme, p.side === 'DEF' ? 'DEF' : 'OFF') : -1
    }
    default: {
      if (key.startsWith('composite:')) {
        const c = composites.find((x) => x.id === key.slice(10))
        return c && attrs ? c.compute(attrs) : null
      }
      const k = key.slice(7)
      return attrs?.[k] ?? null
    }
  }
}

/** Inline rating tint by tier (missing values are faint and sort last). */
function ratingTint(v: number | null | undefined): string {
  if (v == null) return 'text-faint'
  const t = ratingTier(v)
  if (t.key === 'elite') return 'font-700 text-gold'
  if (t.key === 'pro' || t.key === 'starter') return 'font-600 text-ink-2'
  return 'text-muted'
}

/** The combined OVR / POT header buttons. */
function RatingTh({
  sortKey,
  dir,
  onSort,
  className,
}: {
  sortKey: SortKey
  dir: Dir
  onSort: (key: SortKey) => void
  className?: string
}) {
  const { headPad } = useDensity()
  return (
    <th className={cn('label whitespace-nowrap border-b border-line px-2 font-700', headPad, className)}>
      <span className="inline-flex items-center gap-1">
        {([['ovr', 'OVR', 'Sort by overall'], ['pot', 'POT', 'Sort by potential']] as const).map(([k, label, tip], i) => (
          <span key={k} className="inline-flex items-center gap-1">
            {i > 0 && <span className="text-faint">/</span>}
            <button
              type="button"
              title={`${tip} (click again to flip)`}
              onClick={() => onSort(k)}
              className={cn('inline-flex cursor-pointer select-none items-center gap-0.5 hover:text-ink-2', sortKey === k && 'text-ink')}
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

function Th({
  children,
  sort,
  active,
  dir,
  onSort,
  className,
  title,
  solid,
}: {
  children?: ReactNode
  sort?: SortKey
  active?: boolean
  dir?: Dir
  onSort?: (key: SortKey) => void
  className?: string
  title?: string
  /** Solid (non-glass) background — used for the sticky first column. */
  solid?: boolean
}) {
  const { headPad } = useDensity()
  return (
    <th
      title={title}
      onClick={sort && onSort ? () => onSort(sort) : undefined}
      className={cn(
        'label whitespace-nowrap border-b border-line px-2 font-700',
        headPad,
        solid ? 'bg-surface' : 'glass-2',
        sort && 'cursor-pointer select-none hover:text-ink-2',
        active && 'text-ink',
        className,
      )}
    >
      {sort ? (
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

export function RatingsTable({
  players,
  group,
  scheme,
  defScheme,
  showTeam = false,
  showCap = false,
  showFit = true,
  tagFor,
  mineTeamId,
  limit,
  onShowMore,
  right,
  ovrFirst = false,
}: Props) {
  const world = useWorld()
  const selectPlayer = useGame((s) => s.selectPlayer)
  const { density, fontSize, rowPad } = useDensity()
  const phone = usePhone()
  const [sortKey, setSortKey] = useState<SortKey>('ovr')
  const [dir, setDir] = useState<Dir>('desc')
  const [helpOpen, setHelpOpen] = useState(false)

  const ratingCols = RATING_COLUMNS[baseGroup(group)] ?? RATING_COLUMNS.ALL
  const composites = useMemo(() => COMPOSITES[baseGroup(group)] ?? [], [group])
  const attrsById = useMemo(() => {
    const m = new Map<string, Record<string, number>>()
    for (const p of players) m.set(p.id, playerAttrs(p))
    return m
  }, [players])

  const sorted = useMemo(() => {
    const copy = [...players]
    copy.sort((a, b) => {
      const va = rawValue(a, sortKey, attrsById.get(a.id), composites, scheme, defScheme)
      const vb = rawValue(b, sortKey, attrsById.get(b.id), composites, scheme, defScheme)
      const ma = va == null
      const mb = vb == null
      // Missing values sort last in both directions.
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
  }, [players, sortKey, dir, attrsById, composites, scheme, defScheme])

  const toggle = (key: SortKey) => {
    if (sortKey !== key) {
      setSortKey(key)
      setDir('desc')
    } else {
      setDir(dir === 'desc' ? 'asc' : 'desc')
    }
  }

  // Shared props for a sortable header cell.
  const hdr = (key: SortKey) => ({ sort: key, active: sortKey === key, dir, onSort: toggle })

  const shown = limit != null ? sorted.slice(0, limit) : sorted

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: 'name', label: 'Name' },
    { key: 'pos', label: 'Position' },
    { key: 'age', label: 'Age' },
    { key: 'ovr', label: 'Overall' },
    { key: 'pot', label: 'Potential' },
    ...(showFit ? [{ key: 'fit' as SortKey, label: 'Scheme fit' }] : []),
    ...composites.map((c) => ({ key: `composite:${c.id}` as SortKey, label: c.label })),
    ...ratingCols.map((k) => ({ key: `rating:${k}` as SortKey, label: k })),
  ]

  const helpPanel = helpOpen && (
    <div className="grid gap-x-6 gap-y-2 border-b border-line bg-surface-2 p-3 md:grid-cols-2 xl:grid-cols-3">
      {composites.map((c) => (
        <div key={c.id}>
          <div className="font-cond text-label font-700 uppercase text-ink">{c.label} · composite</div>
          <div className="text-label text-faint">{c.title}</div>
        </div>
      ))}
      {ratingCols.map((k) => {
        const info = RATING_INFO[k]
        return (
          <div key={k}>
            <div className="font-cond text-label font-700 uppercase text-ink">
              {k} · {info?.name ?? k}
            </div>
            <div className="text-label text-muted">{info?.what ?? ''}</div>
            <div className="text-label text-faint">{info?.sim ?? 'Not used by the game sim yet'}</div>
          </div>
        )
      })}
    </div>
  )

  if (sorted.length === 0) {
    return <div className="py-10 text-center text-body text-muted">No players match these filters.</div>
  }

  // ── Card rows (under 640px) ─────────────────────────────────────────────────
  if (phone) {
    return (
      <div>
        <div className="flex items-center gap-2 p-2">
          <label className="flex min-w-0 flex-1 items-center gap-2">
            <span className="label shrink-0">Sort</span>
            <select
              value={sortKey}
              onChange={(e) => {
                setSortKey(e.target.value as SortKey)
                setDir('desc')
              }}
              className="h-11 min-w-0 flex-1 rounded-[var(--r-md)] border border-line-strong bg-surface px-2 text-[16px] text-ink"
            >
              {sortOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            aria-label={`Sorted ${dir === 'asc' ? 'ascending' : 'descending'}; switch direction`}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--r-md)] border border-line-strong bg-surface text-ink-2"
          >
            <ArrowDownUp size={16} />
          </button>
        </div>
        <div className="space-y-2 p-2 pt-0" role="list">
          {shown.map((p) => {
            const attrs = attrsById.get(p.id)
            const team = showTeam && p.teamId ? world.byId[p.teamId] : null
            const tag = tagFor?.(p) ?? null
            const mine = mineTeamId != null && p.teamId === mineTeamId
            const fields: { label: string; value: ReactNode }[] = []
            if (showTeam) {
              fields.push({
                label: 'Team',
                value: team ? (
                  <span className="inline-flex items-center gap-1.5">
                    <TeamCrest team={team} size={18} />
                    <span className="font-cond text-micro font-700 uppercase">{team.abbr}</span>
                  </span>
                ) : (
                  <span className="font-cond text-micro font-700 uppercase text-faint">FA</span>
                ),
              })
            }
            fields.push({ label: 'Position', value: p.pos })
            fields.push({ label: 'Age', value: p.age })
            if (showCap) fields.push({ label: 'Cap Hit', value: p.teamId ? money(p.contract.capHit) : '—' })
            if (showFit) fields.push({ label: 'Fit', value: <FitBadge player={p} scheme={scheme} defScheme={defScheme} /> })
            if (attrs) {
              for (const c of composites) fields.push({ label: c.label, value: Math.round(c.compute(attrs)) })
              for (const k of ratingCols) if (attrs[k] !== undefined) fields.push({ label: k, value: Math.round(attrs[k]) })
            }
            return (
              <div
                key={p.id}
                role="listitem"
                className={cn('rounded-[var(--r-md)] border border-line bg-surface p-3', mine && 'bg-[var(--team-tint)]')}
              >
                <div className="flex items-start gap-3">
                  {ovrFirst && <OvrBadge value={p.ovr} pot={p.pot} size={32} />}
                  <button type="button" onClick={() => selectPlayer(p.id)} className="min-h-11 min-w-0 flex-1 text-left lg:min-h-0">
                    <span className="flex items-center gap-1.5">
                      <span className="font-cond text-row font-700 uppercase tracking-[0.02em] text-ink">{p.name}</span>
                      {tag && <Badge tone="info">{tag}</Badge>}
                    </span>
                    <span className="mt-0.5 block text-small text-muted">
                      {p.pos} · age {p.age}
                    </span>
                  </button>
                  {!ovrFirst && <OvrBadge value={p.ovr} pot={p.pot} size={32} />}
                  {right && <span className="shrink-0">{right(p)}</span>}
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
          })}
        </div>
        {limit != null && onShowMore && sorted.length > limit && (
          <div className="border-t border-line p-3 text-center">
            <button
              onClick={onShowMore}
              className="rounded-[var(--r-md)] bg-surface-2 px-4 py-2 font-cond text-small font-700 uppercase text-ink-2 hover:bg-surface-3"
            >
              Show more ({sorted.length - limit} remaining)
            </button>
          </div>
        )}
      </div>
    )
  }

  const stickyName = !ovrFirst
  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-line px-1 py-2">
        <span className="text-label text-muted">Click a column to sort · missing ratings show “–” and sort last</span>
        <div className="flex items-center gap-2">
          <DensityToggle />
          <button
            onClick={() => setHelpOpen((o) => !o)}
            className="rounded-[var(--r-md)] border border-line bg-surface px-2.5 py-1 font-cond text-label font-700 uppercase tracking-wide text-ink-2 transition hover:bg-surface-2"
          >
            {helpOpen ? 'Hide ratings key' : 'What do these mean?'}
          </button>
        </div>
      </div>

      {helpPanel}

      <div className="max-h-[70vh] overflow-auto">
        <table data-density={density} className={cn('min-w-full border-collapse tnum', fontSize)}>
          <thead>
            <tr className="text-left">
              {ovrFirst && <RatingTh sortKey={sortKey} dir={dir} onSort={toggle} className="sticky left-0 top-0 z-30 bg-surface" />}
              <Th {...hdr('name')} title="Player name" solid={stickyName} className={stickyName ? 'sticky left-0 top-0 z-30' : 'sticky top-0 z-20'}>
                Name
              </Th>
              {showTeam && <Th className="sticky top-0 z-20">Team</Th>}
              <Th {...hdr('pos')} className="sticky top-0 z-20">Pos</Th>
              <Th {...hdr('age')} className="sticky top-0 z-20">Age</Th>
              {!ovrFirst && <RatingTh sortKey={sortKey} dir={dir} onSort={toggle} className="sticky top-0 z-20" />}
              {showCap && <Th className="sticky top-0 z-20 text-right">Cap Hit</Th>}
              {showFit && <Th {...hdr('fit')} className="sticky top-0 z-20 text-center">Fit</Th>}
              {composites.map((c) => (
                <Th
                  key={c.id}
                  {...hdr(`composite:${c.id}`)}
                  title={c.title}
                  className="sticky top-0 z-20 border-l border-line text-center text-ink"
                >
                  {c.label}
                </Th>
              ))}
              {ratingCols.map((k) => (
                <Th key={k} {...hdr(`rating:${k}`)} title={ratingTitle(k)} className="sticky top-0 z-20 text-center">
                  {k}
                </Th>
              ))}
              {right && <Th className="sticky top-0 z-20 text-right">Action</Th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const attrs = attrsById.get(p.id)
              const team = showTeam && p.teamId ? world.byId[p.teamId] : null
              const tag = tagFor?.(p) ?? null
              const mine = mineTeamId != null && p.teamId === mineTeamId
              const firstBg = mine ? 'bg-[var(--team-tint)]' : 'bg-surface'
              return (
                <tr
                  key={p.id}
                  onClick={() => selectPlayer(p.id)}
                  className={cn('motion cursor-pointer border-b border-line/60 hover:bg-[var(--team-tint)]', mine && 'bg-[var(--team-tint)]')}
                >
                  {ovrFirst && (
                    <td className={cn('sticky left-0 z-10 whitespace-nowrap px-2', rowPad, firstBg)}>
                      <OvrBadge value={p.ovr} pot={p.pot} size={28} />
                    </td>
                  )}
                  <td
                    className={cn(
                      'whitespace-nowrap px-2',
                      rowPad,
                      stickyName && cn('sticky left-0 z-10', mine ? 'bg-[var(--team-tint)]' : 'bg-surface'),
                    )}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-600 text-ink">{p.name}</span>
                      {tag && <Badge tone="info">{tag}</Badge>}
                    </span>
                  </td>
                  {showTeam && (
                    <td className={cn('whitespace-nowrap px-2', rowPad)}>
                      {team ? (
                        <span className="inline-flex items-center gap-1.5 text-ink-2">
                          <TeamCrest team={team} size={18} />
                          <span className="font-cond text-micro font-700 uppercase">{team.abbr}</span>
                        </span>
                      ) : (
                        <span className="font-cond text-micro font-700 uppercase text-faint">FA</span>
                      )}
                    </td>
                  )}
                  <td className={cn('whitespace-nowrap px-2', rowPad)}>
                    <span className="font-cond text-micro font-700 uppercase text-muted">{p.pos}</span>
                  </td>
                  <td className={cn('whitespace-nowrap px-2 text-ink-2', rowPad)}>{p.age}</td>
                  {!ovrFirst && (
                    <td className={cn('whitespace-nowrap px-2', rowPad)}>
                      <OvrBadge value={p.ovr} pot={p.pot} size={28} />
                    </td>
                  )}
                  {showCap && (
                    <td className={cn('whitespace-nowrap px-2 text-right font-cond font-600 text-ink-2', rowPad)}>
                      {p.teamId ? money(p.contract.capHit) : '—'}
                    </td>
                  )}
                  {showFit && (
                    <td className={cn('whitespace-nowrap px-2 text-center', rowPad)}>
                      <FitBadge player={p} scheme={scheme} defScheme={defScheme} />
                    </td>
                  )}
                  {composites.map((c) => {
                    const v = attrs ? c.compute(attrs) : null
                    return (
                      <td
                        key={c.id}
                        title={c.title}
                        className={cn('whitespace-nowrap border-l border-line/60 px-2 text-center', rowPad, ratingTint(v))}
                      >
                        {v == null ? '–' : Math.round(v)}
                      </td>
                    )
                  })}
                  {ratingCols.map((k) => {
                    const v = attrs?.[k]
                    return (
                      <td key={k} className={cn('whitespace-nowrap px-2 text-center', rowPad, ratingTint(v))}>
                        {v == null ? '–' : Math.round(v)}
                      </td>
                    )
                  })}
                  {right && (
                    <td className={cn('whitespace-nowrap px-2 text-right', rowPad)} onClick={(e) => e.stopPropagation()}>
                      {right(p)}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {limit != null && onShowMore && sorted.length > limit && (
        <div className="border-t border-line p-3 text-center">
          <button
            onClick={onShowMore}
            className="rounded-[var(--r-md)] bg-surface-2 px-4 py-2 font-cond text-small font-700 uppercase text-ink-2 hover:bg-surface-3"
          >
            Show more ({sorted.length - limit} remaining)
          </button>
        </div>
      )}
    </div>
  )
}

import { useMemo, useState, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { playerAttrs } from '../game/data/ratings'
import { COMPOSITES, RATING_COLUMNS, RATING_INFO, ratingTitle, type Composite, baseGroup } from '../game/data/ratingInfo'
import { schemeFit } from '../game/engine/style'
import { useGame } from '../store/gameStore'
import { OvrBadge } from '../ui/kit'
import { FitBadge } from './PlayerTable'
import type { Player } from '../game/types'

type Dir = 'asc' | 'desc'

/** A clickable, sortable column. Composites/ratings are prefixed for lookup. */
type SortKey = 'name' | 'pos' | 'age' | 'ovr' | 'fit' | `composite:${string}` | `rating:${string}`

interface Props {
  players: Player[]
  group: string
  scheme?: string
  defScheme?: string
  /** L12.8 V1: optional per-row action cell (the club page's "Trade for…"). */
  right?: (p: Player) => ReactNode
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

/** Colour tier for a rating cell (missing values are faint and sort last). */
function valueClass(v: number | null | undefined): string {
  if (v == null) return 'text-faint'
  if (v >= 90) return 'bg-win/10 text-win font-700'
  if (v >= 80) return 'bg-brand/10 text-brand font-600'
  if (v >= 70) return 'text-ink-2'
  return 'text-muted'
}

function Th({
  children,
  sort,
  active,
  dir,
  onSort,
  className,
  title,
}: {
  children?: ReactNode
  sort?: SortKey
  active?: boolean
  dir?: Dir
  onSort?: (key: SortKey) => void
  className?: string
  title?: string
}) {
  return (
    <th
      title={title}
      onClick={sort && onSort ? () => onSort(sort) : undefined}
      className={cn(
        'label whitespace-nowrap border-b border-line bg-surface-2 px-2 py-2 font-700',
        sort && 'cursor-pointer select-none hover:text-ink-2',
        active && 'text-ink',
        className,
      )}
    >
      {sort ? (
        <span className="inline-flex items-center gap-0.5">
          {children}
          {active && <span className="text-[9px] leading-none">{dir === 'asc' ? '▲' : '▼'}</span>}
        </span>
      ) : (
        children
      )}
    </th>
  )
}

export function RatingsTable({ players, group, scheme, defScheme, right }: Props) {
  const selectPlayer = useGame((s) => s.selectPlayer)
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

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-line px-1 py-2">
        <span className="text-[11px] text-muted">
          Click a column to sort · missing ratings show “–” and sort last
        </span>
        <button
          onClick={() => setHelpOpen((o) => !o)}
          className="rounded-md border border-line bg-surface px-2.5 py-1 font-cond text-[11px] font-700 uppercase tracking-wide text-ink-2 transition hover:bg-surface-2"
        >
          {helpOpen ? 'Hide ratings key' : 'What do these mean?'}
        </button>
      </div>

      {helpOpen && (
        <div className="grid gap-x-6 gap-y-2 border-b border-line bg-surface-2 p-3 md:grid-cols-2 xl:grid-cols-3">
          {composites.map((c) => (
            <div key={c.id}>
              <div className="font-cond text-xs font-700 uppercase text-ink">
                {c.label} · composite
              </div>
              <div className="text-[11px] text-faint">{c.title}</div>
            </div>
          ))}
          {ratingCols.map((k) => {
            const info = RATING_INFO[k]
            return (
              <div key={k}>
                <div className="font-cond text-xs font-700 uppercase text-ink">
                  {k} · {info?.name ?? k}
                </div>
                <div className="text-xs text-muted">{info?.what ?? ''}</div>
                <div className="text-[11px] text-faint">{info?.sim ?? 'Not used by the game sim yet'}</div>
              </div>
            )
          })}
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted">No players match these filters.</div>
      ) : (
        <div className="max-h-[70vh] overflow-auto">
          <table className="min-w-full border-collapse text-sm tnum">
            <thead>
              <tr className="text-left">
                <Th {...hdr('name')} title="Player name" className="sticky left-0 top-0 z-30 bg-surface-2">Name</Th>
                <Th {...hdr('pos')} className="sticky top-0 z-20">Pos</Th>
                <Th {...hdr('age')} className="sticky top-0 z-20">Age</Th>
                <Th {...hdr('ovr')} className="sticky top-0 z-20">OVR/POT</Th>
                <Th {...hdr('fit')} className="sticky top-0 z-20 text-center">Fit</Th>
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
              {sorted.map((p) => {
                const attrs = attrsById.get(p.id)
                return (
                  <tr
                    key={p.id}
                    onClick={() => selectPlayer(p.id)}
                    className="cursor-pointer border-b border-line/60 transition hover:bg-[var(--team-soft)]"
                  >
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-surface px-2 py-1.5">
                      <span className="font-600 text-ink">{p.name}</span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span className="font-cond text-[11px] font-700 uppercase text-muted">{p.pos}</span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-ink-2">{p.age}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <OvrBadge value={p.ovr} pot={p.pot} size={28} />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-center">
                      <FitBadge player={p} scheme={scheme} defScheme={defScheme} />
                    </td>
                    {composites.map((c) => {
                      const v = attrs ? c.compute(attrs) : null
                      return (
                        <td
                          key={c.id}
                          title={c.title}
                          className={cn(
                            'whitespace-nowrap border-l border-line/60 px-2 py-1.5 text-center',
                            valueClass(v),
                          )}
                        >
                          {v == null ? '–' : Math.round(v)}
                        </td>
                      )
                    })}
                    {ratingCols.map((k) => {
                      const v = attrs?.[k]
                      return (
                        <td
                          key={k}
                          className={cn('whitespace-nowrap px-2 py-1.5 text-center', valueClass(v))}
                        >
                          {v == null ? '–' : Math.round(v)}
                        </td>
                      )
                    })}
                    {right && (
                      <td className="whitespace-nowrap px-2 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                        {right(p)}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

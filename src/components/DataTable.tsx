import { Fragment, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowDownUp, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '../lib/cn'
import { DensityToggle, TierPips, useDensity, type Density } from '../ui/kit'
import { usePhone } from '../ui/hooks'

export interface Column<T> {
  key: string
  label: string
  /** Cell/header classes (width, alignment). */
  className?: string
  sortValue?: (row: T) => number | string
  render: (row: T) => ReactNode
  /** Cell alignment; money and numbers go right. */
  align?: 'left' | 'right' | 'center'
  /** Header tooltip explaining the column. */
  headerTitle?: string
  /**
   * Card-row mode (under 640px): `title` is the card headline (defaults to the
   * sticky column), `meta` sits under it, `aside` floats right (rating tile, ⋯),
   * `value` becomes a label/value pair (default), `hidden` is dropped.
   */
  card?: 'title' | 'meta' | 'aside' | 'value' | 'hidden'
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const

/**
 * The shared data table (UI redesign F2, spec §7).
 *  • sortable headers are buttons with aria-sort; first click sorts descending
 *  • the sticky first (or `name`) column keeps the row's hover / selected bg
 *  • keyboard rows when `onRowClick` is set: J/K or ↑/↓ move, Enter opens,
 *    "." opens the row's ⋯ menu
 *  • `groupBy` adds group header rows ("OFFENSE · System: West Coast")
 *  • density (shared setting or the `density` prop), optional rank and pips
 *  • under 640px it becomes card rows, and never nests a fixed-height scroller
 * Props from the old table (rows, columns, rowKey, onRowClick, selectedKey,
 * expandedKey, renderExpanded, defaultSortKey, defaultDir, maxHeight,
 * emptyText, rank) are unchanged.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  selectedKey,
  expandedKey,
  renderExpanded,
  defaultSortKey,
  defaultDir = 'desc',
  maxHeight = 'calc(100vh - 320px)',
  emptyText = 'Nothing to show.',
  rank = false,
  pipsFor,
  groupBy,
  groupLabel,
  stickyKey: stickyProp,
  density: densityProp,
  showDensity = true,
  cards = 'auto',
  label,
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  selectedKey?: string | null
  /** Row whose detail expands inline beneath it. */
  expandedKey?: string | null
  renderExpanded?: (row: T) => ReactNode
  defaultSortKey?: string
  defaultDir?: 'asc' | 'desc'
  /** Scroll height on ≥640px. Pass 'none' for no inner scroller. */
  maxHeight?: string
  emptyText?: string
  rank?: boolean
  /** Adds a pips column (tier 5..1) after the sticky column. */
  pipsFor?: (row: T) => number
  /** Group rows under header rows, in order of first appearance. */
  groupBy?: (row: T) => string
  groupLabel?: (group: string, rows: T[]) => ReactNode
  /** Column key to pin (default: `name`, else the first column). */
  stickyKey?: string
  density?: Density
  showDensity?: boolean
  /** Card rows under 640px ('auto'), never, or always. */
  cards?: 'auto' | 'never' | 'always'
  /** Accessible table name. */
  label?: string
}) {
  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey ?? null)
  const [dir, setDir] = useState<'asc' | 'desc'>(defaultDir)
  const shared = useDensity()
  const density = densityProp ?? shared.density
  const compact = density === 'compact'
  const rowPad = compact ? 'py-1' : 'py-2'
  const headPad = compact ? 'py-1' : 'py-2'
  const phone = usePhone()
  const asCards = cards === 'always' || (cards === 'auto' && phone)
  const bodyRef = useRef<HTMLElement | null>(null)
  const setBody = (el: HTMLElement | null) => {
    bodyRef.current = el
  }
  const stickyKey = stickyProp ?? columns.find((c) => c.key === 'name')?.key ?? columns[0]?.key

  const sorted = useMemo(() => {
    if (!sortKey) return rows
    const col = columns.find((c) => c.key === sortKey)
    if (!col?.sortValue) return rows
    const copy = [...rows]
    copy.sort((a, b) => {
      const va = col.sortValue!(a)
      const vb = col.sortValue!(b)
      const cmp =
        typeof va === 'string' || typeof vb === 'string'
          ? String(va).localeCompare(String(vb))
          : (va as number) - (vb as number)
      return dir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [rows, columns, sortKey, dir])

  // Groups keep the order in which they first appear in `rows`; rows inside a
  // group follow the current sort.
  const groups = useMemo(() => {
    if (!groupBy) return [{ key: '', rows: sorted }]
    const order: string[] = []
    for (const r of rows) {
      const g = groupBy(r)
      if (!order.includes(g)) order.push(g)
    }
    return order.map((g) => ({ key: g, rows: sorted.filter((r) => groupBy(r) === g) }))
  }, [rows, sorted, groupBy])

  const toggle = (key: string) => {
    if (sortKey === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setDir('desc')
    }
  }

  // Keyboard rows: J/K or arrows move focus, Enter / Space open, "." opens ⋯.
  const onRowKey = (e: KeyboardEvent<HTMLElement>, row: T) => {
    if (e.target !== e.currentTarget) return
    const list = Array.from(bodyRef.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])
    const i = list.indexOf(e.currentTarget)
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault()
      list[Math.min(list.length - 1, i + 1)]?.focus()
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault()
      list[Math.max(0, i - 1)]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      list[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      list[list.length - 1]?.focus()
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onRowClick?.(row)
    } else if (e.key === '.') {
      const menu = e.currentTarget.querySelector<HTMLElement>('[aria-haspopup="menu"]')
      if (menu) {
        e.preventDefault()
        menu.click()
      }
    }
  }

  if (!rows.length) {
    return <div className="py-12 text-center text-body text-muted">{emptyText}</div>
  }

  const keyboard = !!onRowClick
  const firstRow = groups.find((g) => g.rows.length)?.rows[0]
  const firstKey = firstRow ? rowKey(firstRow) : null
  const focusKey = selectedKey && rows.some((r) => rowKey(r) === selectedKey) ? selectedKey : firstKey
  const sortable = columns.filter((c) => c.sortValue)

  // ── Card rows (phone) ───────────────────────────────────────────────────────
  if (asCards) {
    const titleCol = columns.find((c) => c.card === 'title') ?? columns.find((c) => c.key === stickyKey)
    const metaCols = columns.filter((c) => c.card === 'meta')
    const asideCols = columns.filter((c) => c.card === 'aside')
    const valueCols = columns.filter(
      (c) => c !== titleCol && !metaCols.includes(c) && !asideCols.includes(c) && c.card !== 'hidden',
    )
    let n = 0
    return (
      <div>
        {sortable.length > 0 && (
          <div className="flex items-center gap-2 pb-2">
            <label className="flex min-w-0 flex-1 items-center gap-2">
              <span className="label shrink-0">Sort</span>
              <select
                value={sortKey ?? ''}
                onChange={(e) => {
                  setSortKey(e.target.value || null)
                  setDir('desc')
                }}
                className="h-11 min-w-0 flex-1 rounded-[var(--r-md)] border border-line-strong bg-surface px-2 text-[16px] text-ink"
              >
                <option value="">Default order</option>
                {sortable.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              disabled={!sortKey}
              aria-label={`Sorted ${dir === 'asc' ? 'ascending' : 'descending'}; switch direction`}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--r-md)] border border-line-strong bg-surface text-ink-2 disabled:opacity-45"
            >
              <ArrowDownUp size={16} />
            </button>
          </div>
        )}
        <div ref={setBody} aria-label={label} role="list" className="space-y-2">
          {groups.map((g) => (
            <Fragment key={g.key || '_'}>
              {groupBy && g.rows.length > 0 && (
                <div role="presentation" className="label px-1 pt-2 text-ink-2">
                  {groupLabel ? groupLabel(g.key, g.rows) : g.key}
                </div>
              )}
              {g.rows.map((row) => {
                const key = rowKey(row)
                const selected = selectedKey === key
                const expanded = expandedKey === key && !!renderExpanded
                n += 1
                return (
                  <div
                    key={key}
                    role="listitem"
                    data-row=""
                    tabIndex={keyboard ? (key === focusKey ? 0 : -1) : undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={keyboard ? (e) => onRowKey(e, row) : undefined}
                    className={cn(
                      'motion rounded-[var(--r-md)] border border-line bg-surface p-3',
                      onRowClick && 'cursor-pointer active:bg-surface-2',
                      selected && 'bg-[var(--team-tint)] shadow-[inset_3px_0_0_var(--team-accent)]',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-body font-600 text-ink">
                          {rank && <span className="font-cond text-label text-faint tnum">#{n}</span>}
                          <span className="min-w-0">{titleCol?.render(row)}</span>
                        </div>
                        {metaCols.length > 0 && (
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted">
                            {metaCols.map((c) => (
                              <span key={c.key}>{c.render(row)}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      {(asideCols.length > 0 || pipsFor) && (
                        <div className="flex shrink-0 items-center gap-2">
                          {pipsFor && <TierPips value={pipsFor(row)} />}
                          {asideCols.map((c) => (
                            <span key={c.key}>{c.render(row)}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    {valueCols.length > 0 && (
                      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-small">
                        {valueCols.map((c) => (
                          <div key={c.key} className="min-w-0">
                            <dt className="label">{c.label}</dt>
                            <dd className="min-w-0 text-ink tnum">{c.render(row)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {expanded && (
                      <div className="-mx-3 -mb-3 mt-3 border-t border-line bg-surface-2" onClick={(e) => e.stopPropagation()}>
                        {renderExpanded!(row)}
                      </div>
                    )}
                  </div>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>
    )
  }

  // ── Table ──────────────────────────────────────────────────────────────────
  const colCount = columns.length + (rank ? 1 : 0) + (pipsFor ? 1 : 0)
  const scrollStyle = !phone && maxHeight !== 'none' ? { maxHeight } : undefined
  let n = 0
  return (
    <div>
      {showDensity && (
        <div className="flex items-center justify-end px-2 pb-1.5">
          <DensityToggle />
        </div>
      )}
      <div className="overflow-auto rounded-[var(--r-md)] bg-surface" style={scrollStyle}>
        <table
          data-density={density}
          aria-label={label}
          className={cn('w-full border-collapse font-sans tnum', compact ? 'text-small' : 'text-body')}
        >
          <thead className="sticky top-0 z-10 glass">
            <tr className="border-b border-line text-left">
              {rank && (
                <th scope="col" className={cn('label w-9 px-2', headPad)}>
                  #
                </th>
              )}
              {columns.map((c) => {
                const canSort = !!c.sortValue
                const active = sortKey === c.key
                const sticky = c.key === stickyKey
                const ariaSort = canSort ? (active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined
                return (
                  <Fragment key={c.key}>
                    <th
                      scope="col"
                      aria-sort={ariaSort}
                      title={c.headerTitle}
                      className={cn(
                        'label whitespace-nowrap px-2 font-700',
                        headPad,
                        ALIGN[c.align ?? 'left'],
                        active && 'text-ink',
                        sticky && 'sticky left-0 z-20 bg-surface',
                        c.className,
                      )}
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={() => toggle(c.key)}
                          className={cn(
                            'inline-flex items-center gap-0.5 uppercase tracking-[inherit] hover:text-ink-2',
                            c.align === 'right' && 'flex-row-reverse',
                          )}
                        >
                          {c.label}
                          {active ? (
                            dir === 'asc' ? <ChevronUp size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />
                          ) : (
                            <ChevronDown size={12} aria-hidden className="opacity-0" />
                          )}
                        </button>
                      ) : (
                        c.label
                      )}
                    </th>
                    {sticky && pipsFor && (
                      <th scope="col" className={cn('label w-12 px-2', headPad)}>
                        Tier
                      </th>
                    )}
                  </Fragment>
                )
              })}
            </tr>
          </thead>
          <tbody ref={setBody}>
            {groups.map((g) => (
              <Fragment key={g.key || '_'}>
                {groupBy && g.rows.length > 0 && (
                  <tr className="border-b border-line bg-surface-2">
                    <th scope="colgroup" colSpan={colCount} className="label px-2 py-1.5 text-left text-ink-2">
                      {groupLabel ? groupLabel(g.key, g.rows) : g.key}
                    </th>
                  </tr>
                )}
                {g.rows.map((row) => {
                  const key = rowKey(row)
                  const selected = selectedKey === key
                  const expanded = expandedKey === key && !!renderExpanded
                  n += 1
                  const cellBg = selected ? 'bg-[var(--team-tint)]' : 'bg-surface group-hover:bg-surface-2'
                  return (
                    <Fragment key={key}>
                      <tr
                        data-row=""
                        data-selected={selected || undefined}
                        tabIndex={keyboard ? (key === focusKey ? 0 : -1) : undefined}
                        onClick={onRowClick ? () => onRowClick(row) : undefined}
                        onKeyDown={keyboard ? (e) => onRowKey(e, row) : undefined}
                        className={cn(
                          'motion group border-b border-line/60 focus-visible:outline-offset-[-2px]',
                          onRowClick && 'cursor-pointer',
                          selected ? 'bg-[var(--team-tint)]' : 'hover:bg-surface-2',
                        )}
                      >
                        {rank && <td className={cn('px-2 font-cond text-label text-faint', rowPad)}>{n}</td>}
                        {columns.map((c) => {
                          const sticky = c.key === stickyKey
                          return (
                            <Fragment key={c.key}>
                              <td
                                className={cn(
                                  'whitespace-nowrap px-2',
                                  rowPad,
                                  ALIGN[c.align ?? 'left'],
                                  sticky && cn('sticky left-0 z-[1]', cellBg),
                                  sticky && selected && 'shadow-[inset_3px_0_0_var(--team-accent)]',
                                  c.className,
                                )}
                              >
                                {c.render(row)}
                              </td>
                              {sticky && pipsFor && (
                                <td className={cn('px-2', rowPad)}>
                                  <TierPips value={pipsFor(row)} />
                                </td>
                              )}
                            </Fragment>
                          )
                        })}
                      </tr>
                      {expanded && (
                        <tr className="border-b border-line/60 bg-surface-2">
                          <td colSpan={colCount} className="p-0 align-top">
                            {renderExpanded!(row)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

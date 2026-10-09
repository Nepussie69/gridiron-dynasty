import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '../lib/cn'

export interface Column<T> {
  key: string
  label: string
  /** Cell/header classes (width, alignment). */
  className?: string
  sortValue?: (row: T) => number | string
  render: (row: T) => ReactNode
}

/**
 * A dense, sortable data table for big lists (recruits, prospects, free agents).
 * Rows, not cards — aimed at scanning hundreds of people quickly.
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
  maxHeight?: string
  emptyText?: string
  rank?: boolean
}) {
  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey ?? null)
  const [dir, setDir] = useState<'asc' | 'desc'>(defaultDir)

  const sorted = useMemo(() => {
    if (!sortKey) return rows
    const col = columns.find((c) => c.key === sortKey)
    if (!col?.sortValue) return rows
    const copy = [...rows]
    copy.sort((a, b) => {
      const va = col.sortValue!(a)
      const vb = col.sortValue!(b)
      const cmp = typeof va === 'string' || typeof vb === 'string'
        ? String(va).localeCompare(String(vb))
        : (va as number) - (vb as number)
      return dir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [rows, columns, sortKey, dir])

  const toggle = (key: string, sortable: boolean) => {
    if (!sortable) return
    if (sortKey === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setDir('desc')
    }
  }

  if (!rows.length) {
    return <div className="py-12 text-center text-sm text-muted">{emptyText}</div>
  }

  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full border-collapse text-sm tnum">
        <thead className="sticky top-0 z-10 glass">
          <tr className="border-b border-line text-left">
            {rank && <th className="label w-9 px-2 py-1.5">#</th>}
            {columns.map((c) => {
              const sortable = !!c.sortValue
              const active = sortKey === c.key
              return (
                <th
                  key={c.key}
                  onClick={() => toggle(c.key, sortable)}
                  className={cn(
                    'label whitespace-nowrap px-2 py-1.5 font-700',
                    sortable && 'cursor-pointer select-none hover:text-ink-2',
                    active && 'text-ink',
                    c.className,
                  )}
                >
                  <span className="inline-flex items-center gap-0.5">
                    {c.label}
                    {active && (dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => {
            const key = rowKey(row)
            const selected = selectedKey === key
            const expanded = expandedKey === key && !!renderExpanded
            return (
              <Fragment key={key}>
                <tr
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-b border-line/50 transition',
                    onRowClick && 'cursor-pointer',
                    selected ? 'bg-[var(--team-soft)]' : 'hover:bg-surface-2',
                  )}
                >
                  {rank && <td className="px-2 py-1 font-cond text-xs text-faint">{i + 1}</td>}
                  {columns.map((c) => (
                    <td key={c.key} className={cn('whitespace-nowrap px-2 py-1', c.className)}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
                {expanded && (
                  <tr className="border-b border-line/50 bg-surface-2">
                    <td colSpan={columns.length + (rank ? 1 : 0)} className="p-0 align-top">
                      {renderExpanded!(row)}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

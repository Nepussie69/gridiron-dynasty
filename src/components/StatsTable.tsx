import { baseGroup } from '../game/data/ratingInfo'
import { useMemo, useState, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
import type { Player, SeasonStats, StatLevel } from '../game/types'
import { seasonLine } from '../game/engine/stats'
import {
  COL_COV,
  COL_COV_TGT,
  COL_COV_YDS,
  COL_DEF_INT,
  COL_DROP,
  COL_FMT,
  COL_GP,
  COL_MAIN,
  COL_MT,
  COL_PASS_ATT,
  COL_PASS_INT,
  COL_PASS_TD,
  COL_PASS_YDS,
  COL_REC,
  COL_REC_TD,
  COL_REC_YDS,
  COL_RTG,
  COL_RUSH_ATT,
  COL_RUSH_AVG,
  COL_RUSH_TD,
  COL_RUSH_YDS,
  COL_SCK,
  COL_TCK,
  COL_TFL,
  COL_TGT,
  type StatCol,
} from './statsColumns'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, DensityToggle, OvrBadge, TeamCrest, useDensity } from '../ui/kit'

type Dir = 'asc' | 'desc'
type SortKey = 'name' | 'pos' | 'age' | 'ovr' | 'pot' | `col:${string}`

const QB_COLS: StatCol[] = [COL_PASS_ATT, COL_PASS_YDS, COL_PASS_TD, COL_PASS_INT, COL_RTG]

const RB_COLS: StatCol[] = [COL_RUSH_ATT, COL_RUSH_YDS, COL_RUSH_AVG, COL_RUSH_TD, COL_FMT, COL_REC, COL_REC_YDS]

const WR_COLS: StatCol[] = [COL_TGT, COL_REC, COL_REC_YDS, COL_REC_TD, COL_FMT, COL_DROP]

const FRONT_COLS: StatCol[] = [COL_TCK, COL_MT, COL_TFL, COL_SCK]

const DB_COLS: StatCol[] = [COL_TCK, COL_MT, COL_DEF_INT, COL_COV_TGT, COL_COV_YDS, COL_COV]

/** Columns for a stats-tab group. Empty groups (OL, K/P) fall back to GP. */
function columnsFor(group: string): StatCol[] {
  switch (group) {
    case 'QB':
      return QB_COLS
    case 'RB':
      return RB_COLS
    case 'WR':
    case 'TE':
      return WR_COLS
    case 'DL':
    case 'LB':
      return FRONT_COLS
    case 'CB':
    case 'S':
      return DB_COLS
    case 'ALL':
      return [COL_GP, COL_MAIN]
    default:
      return [COL_GP]
  }
}

function sortValue(
  p: Player,
  key: SortKey,
  lines: Map<string, SeasonStats | undefined>,
  cols: StatCol[],
): number | string | null {
  if (key === 'name') return p.name
  if (key === 'pos') return p.pos
  if (key === 'age') return p.age
  if (key === 'ovr') return p.ovr
  if (key === 'pot') return p.pot
  const c = cols.find((x) => `col:${x.id}` === key)
  return c ? c.get(lines.get(p.id), p) : null
}

function Th({
  children,
  className,
  onClick,
  active,
  dir,
  title,
  solid,
}: {
  children?: ReactNode
  className?: string
  onClick?: () => void
  active?: boolean
  dir?: Dir
  title?: string
  /** Solid (non-glass) background — used for the sticky first column. */
  solid?: boolean
}) {
  const { headPad } = useDensity()
  return (
    <th
      title={title}
      onClick={onClick}
      className={cn(
        'label whitespace-nowrap border-b border-line px-2 font-700',
        headPad,
        solid ? 'bg-surface' : 'glass-2',
        onClick && 'cursor-pointer select-none hover:text-ink-2',
        active && 'text-ink',
        className,
      )}
    >
      <span className="inline-flex items-center gap-0.5">
        {children}
        {active && <span className="text-[9px] leading-none">{dir === 'asc' ? '▲' : '▼'}</span>}
      </span>
    </th>
  )
}

interface Props {
  players: Player[]
  group: string
  season: number
  level: StatLevel
  /** Optional columns used by the league-wide Find a Player screen. */
  showTeam?: boolean
  showCap?: boolean
  /** A short tag rendered beside the name (e.g. "PS" for practice squad). */
  tagFor?: (p: Player) => string | null
  /** Rows for this club get the team-soft background. */
  mineTeamId?: string
  /** Cap the rows rendered; pair with `onShowMore` for a "Show more" footer. */
  limit?: number
  onShowMore?: () => void
  /** Initial sort, used when the caller remounts the table per position group. */
  defaultSortKey?: SortKey
  defaultDir?: Dir
  /** L12.8 V1: optional per-row action cell (the club page's "Trade for…"). */
  right?: (p: Player) => ReactNode
}

export function StatsTable({
  players,
  group,
  season,
  level,
  showTeam = false,
  showCap = false,
  tagFor,
  mineTeamId,
  limit,
  onShowMore,
  defaultSortKey = 'ovr',
  defaultDir = 'desc',
  right,
}: Props) {
  const world = useWorld()
  const selectPlayer = useGame((s) => s.selectPlayer)
  const { density, fontSize, rowPad, headPad } = useDensity()
  const [sortKey, setSortKey] = useState<SortKey>(defaultSortKey)
  const [dir, setDir] = useState<Dir>(defaultDir)

  const cols = useMemo(() => columnsFor(baseGroup(group)), [group])
  const lines = useMemo(() => {
    const m = new Map<string, SeasonStats | undefined>()
    for (const p of players) m.set(p.id, seasonLine(p, season, level))
    return m
  }, [players, season, level])

  const sorted = useMemo(() => {
    const copy = [...players]
    copy.sort((a, b) => {
      const va = sortValue(a, sortKey, lines, cols)
      const vb = sortValue(b, sortKey, lines, cols)
      const ma = va == null
      const mb = vb == null
      // Missing / zero-attempt rows sort last in both directions.
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
  }, [players, sortKey, dir, lines, cols])

  const toggle = (key: SortKey) => {
    if (sortKey !== key) {
      setSortKey(key)
      setDir('desc')
    } else {
      setDir(dir === 'desc' ? 'asc' : 'desc')
    }
  }

  const hdr = (key: SortKey) => ({ onClick: () => toggle(key), active: sortKey === key, dir })

  const shown = limit != null ? sorted.slice(0, limit) : sorted

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-line px-1 py-2">
        <span className="text-[11px] text-muted">
          {season} season · click a column to sort · missing or zero-attempt rows sort last
        </span>
        <DensityToggle />
      </div>

      {sorted.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted">No players match these filters.</div>
      ) : (
        <>
          <div className="max-h-[70vh] overflow-auto">
            <table data-density={density} className={cn('min-w-full border-collapse tnum', fontSize)}>
            <thead>
              <tr className="text-left">
                <Th {...hdr('name')} title="Player name" solid className="sticky left-0 top-0 z-30">Name</Th>
                {showTeam && <Th className="sticky top-0 z-20">Team</Th>}
                <Th {...hdr('pos')} className="sticky top-0 z-20">Pos</Th>
                <Th {...hdr('age')} className="sticky top-0 z-20">Age</Th>
                <th className={cn('label sticky top-0 z-20 whitespace-nowrap border-b border-line glass-2 px-2 font-700', headPad)}>
                  <span className="inline-flex items-center gap-1">
                    {([['ovr', 'OVR', 'Sort by overall'], ['pot', 'POT', 'Sort by potential']] as const).map(([k, label, tip], i) => (
                      <span key={k} className="inline-flex items-center gap-1">
                        {i > 0 && <span className="text-faint">/</span>}
                        <button type="button" title={`${tip} (click again to flip)`} onClick={() => toggle(k)} className={cn('inline-flex cursor-pointer select-none items-center gap-0.5 hover:text-ink-2', sortKey === k && 'text-ink')}>
                          {label}
                          {sortKey === k && <span className="text-[9px] leading-none">{dir === 'asc' ? '▲' : '▼'}</span>}
                        </button>
                      </span>
                    ))}
                  </span>
                </th>
                {showCap && <Th className="sticky top-0 z-20 text-right">Cap Hit</Th>}
                {cols.map((c) => (
                  <Th key={c.id} {...hdr(`col:${c.id}`)} title={c.title} className="sticky top-0 z-20 text-center">
                    {c.label}
                  </Th>
                ))}
                {right && <Th className="sticky top-0 z-20 text-right">Action</Th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const line = lines.get(p.id)
                const team = showTeam && p.teamId ? world.byId[p.teamId] : null
                const tag = tagFor?.(p) ?? null
                const mine = mineTeamId != null && p.teamId === mineTeamId
                return (
                  <tr
                    key={p.id}
                    onClick={() => selectPlayer(p.id)}
                    className={cn(
                      'motion cursor-pointer border-b border-line/60 hover:bg-[var(--team-soft)] hover:shadow-[0_6px_16px_-10px_rgba(10,22,38,0.45)]',
                      mine && 'bg-[var(--team-soft)]',
                    )}
                  >
                    <td
                      className={cn(
                        'sticky left-0 z-10 whitespace-nowrap px-2',
                        rowPad,
                        mine ? 'bg-[var(--team-soft)]' : 'bg-surface',
                      )}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <span className="font-600 text-ink">{p.name}</span>
                        {tag && <Badge tone="info">{tag}</Badge>}
                      </span>
                    </td>
                    {showTeam && (
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {team ? (
                          <span className="inline-flex items-center gap-1.5 text-ink-2">
                            <TeamCrest team={team} size={18} />
                            <span className="font-cond text-[11px] font-700 uppercase">{team.abbr}</span>
                          </span>
                        ) : (
                          <span className="font-cond text-[11px] font-700 uppercase text-faint">FA</span>
                        )}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span className="font-cond text-[11px] font-700 uppercase text-muted">{p.pos}</span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-ink-2">{p.age}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <OvrBadge value={p.ovr} pot={p.pot} size={28} />
                    </td>
                    {showCap && (
                      <td className="whitespace-nowrap px-2 py-1.5 text-right font-cond font-600 text-ink-2">
                        {p.teamId ? money(p.contract.capHit) : '—'}
                      </td>
                    )}
                    {cols.map((c) => (
                      <td key={c.id} className="whitespace-nowrap px-2 py-1.5 text-center text-ink-2">
                        {c.fmt(line, p)}
                      </td>
                    ))}
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
        {limit != null && onShowMore && sorted.length > limit && (
          <div className="border-t border-line p-3 text-center">
            <button
              onClick={onShowMore}
              className="rounded-md bg-surface-2 px-4 py-1.5 font-cond text-xs font-700 uppercase text-ink-2 hover:bg-surface-3"
            >
              Show more ({sorted.length - limit} remaining)
            </button>
          </div>
        )}
        </>
      )}
    </div>
  )
}

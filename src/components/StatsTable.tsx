import { useMemo, useState, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import type { Player, SeasonStats, StatLevel } from '../game/types'
import { coverageGrade, mainStatValue, passerRating, seasonLine } from '../game/engine/stats'
import { useGame } from '../store/gameStore'
import { OvrBadge } from '../ui/kit'

type Dir = 'asc' | 'desc'
type SortKey = 'name' | 'pos' | 'age' | 'ovr' | `col:${string}`

/** One stat column: `get` is the sort value (null = missing / zero-attempt → last). */
interface StatCol {
  id: string
  label: string
  title?: string
  get: (s: SeasonStats | undefined, p: Player) => number | null
  fmt: (s: SeasonStats | undefined, p: Player) => string
}

const num = (v: number | null | undefined) => (v == null ? '—' : String(v))

const GP_COL: StatCol = {
  id: 'gp',
  label: 'GP',
  get: (s) => s?.games ?? null,
  fmt: (s) => num(s?.games),
}

const QB_COLS: StatCol[] = [
  { id: 'att', label: 'C/ATT', get: (s) => s?.passAtt ?? null, fmt: (s) => (s ? `${s.passComp}/${s.passAtt}` : '—') },
  { id: 'yds', label: 'YDS', get: (s) => s?.passYds ?? null, fmt: (s) => num(s?.passYds) },
  { id: 'td', label: 'TD', get: (s) => s?.passTD ?? null, fmt: (s) => num(s?.passTD) },
  { id: 'int', label: 'INT', get: (s) => s?.ints ?? null, fmt: (s) => num(s?.ints) },
  {
    id: 'rtg',
    label: 'RTG',
    title: 'Passer rating',
    get: (s) => (s && s.passAtt > 0 ? passerRating(s) : null),
    fmt: (s) => (s && s.passAtt > 0 ? passerRating(s).toFixed(1) : '—'),
  },
]

const RB_COLS: StatCol[] = [
  { id: 'car', label: 'CAR', get: (s) => s?.rushAtt ?? null, fmt: (s) => num(s?.rushAtt) },
  { id: 'yds', label: 'YDS', get: (s) => s?.rushYds ?? null, fmt: (s) => num(s?.rushYds) },
  {
    id: 'ypc',
    label: 'YPC',
    title: 'Yards per carry',
    get: (s) => (s && s.rushAtt > 0 ? s.rushYds / s.rushAtt : null),
    fmt: (s) => (s && s.rushAtt > 0 ? (s.rushYds / s.rushAtt).toFixed(1) : '—'),
  },
  { id: 'td', label: 'TD', get: (s) => s?.rushTD ?? null, fmt: (s) => num(s?.rushTD) },
  { id: 'rec', label: 'REC', get: (s) => s?.rec ?? null, fmt: (s) => num(s?.rec) },
  { id: 'recyds', label: 'REC YDS', get: (s) => s?.recYds ?? null, fmt: (s) => num(s?.recYds) },
]

const WR_COLS: StatCol[] = [
  { id: 'tgt', label: 'TGT', get: (s) => s?.targets ?? null, fmt: (s) => num(s?.targets) },
  { id: 'rec', label: 'REC', get: (s) => s?.rec ?? null, fmt: (s) => num(s?.rec) },
  { id: 'yds', label: 'YDS', get: (s) => s?.recYds ?? null, fmt: (s) => num(s?.recYds) },
  { id: 'td', label: 'TD', get: (s) => s?.recTD ?? null, fmt: (s) => num(s?.recTD) },
]

const FRONT_COLS: StatCol[] = [
  { id: 'tck', label: 'TCK', get: (s) => s?.tackles ?? null, fmt: (s) => num(s?.tackles) },
  { id: 'tfl', label: 'TFL', get: (s) => s?.tfl ?? null, fmt: (s) => num(s?.tfl) },
  { id: 'sck', label: 'SCK', get: (s) => s?.defSacks ?? null, fmt: (s) => num(s?.defSacks) },
]

const DB_COLS: StatCol[] = [
  { id: 'tck', label: 'TCK', get: (s) => s?.tackles ?? null, fmt: (s) => num(s?.tackles) },
  { id: 'int', label: 'INT', get: (s) => s?.defInts ?? null, fmt: (s) => num(s?.defInts) },
  { id: 'tgt', label: 'TGT', get: (s) => s?.defTargets ?? null, fmt: (s) => num(s?.defTargets) },
  { id: 'ydsw', label: 'YDS ALW', get: (s) => s?.defYdsAllowed ?? null, fmt: (s) => num(s?.defYdsAllowed) },
  {
    id: 'cov',
    label: 'COV',
    title: 'Coverage grade 0–100 (passer rating allowed, INT bonus)',
    get: (s) => (s ? coverageGrade(s) : null),
    fmt: (s) => {
      const g = s ? coverageGrade(s) : null
      return g == null ? '—' : String(g)
    },
  },
]

const MAIN_COL: StatCol = {
  id: 'main',
  label: 'Main',
  title: 'The main stat for each player’s position',
  get: (s, p) => mainStatValue(p, s),
  fmt: (s, p) => num(mainStatValue(p, s)),
}

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
      return [GP_COL, MAIN_COL]
    default:
      return [GP_COL]
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
}: {
  children?: ReactNode
  className?: string
  onClick?: () => void
  active?: boolean
  dir?: Dir
  title?: string
}) {
  return (
    <th
      title={title}
      onClick={onClick}
      className={cn(
        'label whitespace-nowrap border-b border-line bg-surface-2 px-2 py-2 font-700',
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
}

export function StatsTable({ players, group, season, level }: Props) {
  const selectPlayer = useGame((s) => s.selectPlayer)
  const [sortKey, setSortKey] = useState<SortKey>('ovr')
  const [dir, setDir] = useState<Dir>('desc')

  const cols = useMemo(() => columnsFor(group), [group])
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

  return (
    <div>
      <div className="border-b border-line px-1 py-2 text-[11px] text-muted">
        {season} season · click a column to sort · missing or zero-attempt rows sort last
      </div>

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
                {cols.map((c) => (
                  <Th key={c.id} {...hdr(`col:${c.id}`)} title={c.title} className="sticky top-0 z-20 text-center">
                    {c.label}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const line = lines.get(p.id)
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
                    {cols.map((c) => (
                      <td key={c.id} className="whitespace-nowrap px-2 py-1.5 text-center text-ink-2">
                        {c.fmt(line, p)}
                      </td>
                    ))}
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

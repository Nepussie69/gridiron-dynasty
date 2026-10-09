import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { cn } from '../lib/cn'
import { groupPositions } from '../game/data/ratingInfo'
import type { World } from '../game/engine/generate'
import type { Player } from '../game/types'
import { useGame, useWorld } from '../store/gameStore'
import { RatingsTable } from '../components/RatingsTable'
import { StatsTable } from '../components/StatsTable'
import { Badge, Card, PageHeader } from '../ui/kit'

// ─────────────────────────────────────────────────────────────────────────────
// Find a Player — every NFL player in the league (all clubs + free agents,
// practice squad tagged) with the Roster tabs' Ratings and Stats views.
//
// Data is merged once per world tick and filtered in the browser. The heavy
// ratings work is cached per player inside RatingsTable (and here per tick).
// ─────────────────────────────────────────────────────────────────────────────

type View = 'ratings' | 'stats'

const POS_CHIPS = ['ALL', 'QB', 'RB', 'FB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K/P'] as const
type PosChip = (typeof POS_CHIPS)[number]

type AgeBand = 'any' | 'young' | 'prime' | 'vet'
const AGE_BANDS: { id: AgeBand; label: string }[] = [
  { id: 'any', label: 'Any age' },
  { id: 'young', label: '≤25' },
  { id: 'prime', label: '26–29' },
  { id: 'vet', label: '30+' },
]

const MIN_OVR = [0, 60, 65, 70, 75, 80, 85, 90]

/** The stat column the Stats view sorts by for each position chip. */
const STAT_DEFAULT: Record<string, string> = {
  ALL: 'main',
  QB: 'passYds',
  RB: 'rushYds',
  WR: 'recYds',
  TE: 'recYds',
  OL: 'gp',
  DL: 'sck',
  LB: 'tck',
  CB: 'defInt',
  S: 'defInt',
  'K/P': 'gp',
}

const PAGE = 100

interface Row {
  player: Player
  teamId: string | null
  ps: boolean
}

/** Every NFL player: rostered (incl. practice squad / IR) plus free agents. */
function mergeRows(world: World): Row[] {
  const psIds = new Set<string>()
  for (const list of Object.values(world.practiceSquad ?? {})) for (const p of list) psIds.add(p.id)
  const map = new Map<string, Row>()
  const add = (p: Player) => {
    if (map.has(p.id)) return
    map.set(p.id, { player: p, teamId: p.teamId, ps: psIds.has(p.id) })
  }
  for (const p of world.players) {
    if (p.teamId && world.byId[p.teamId]?.tier === 'NFL') add(p)
  }
  for (const p of world.freeAgents) add(p)
  return [...map.values()]
}

export function FindPlayer() {
  const world = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const tick = useGame((s) => s.tick)

  const [view, setView] = useState<View>('ratings')
  const [group, setGroup] = useState<PosChip>('ALL')
  const [team, setTeam] = useState('ALL')
  const [q, setQ] = useState('')
  const [ageBand, setAgeBand] = useState<AgeBand>('any')
  const [minOvr, setMinOvr] = useState(0)
  const [limit, setLimit] = useState(PAGE)

  // `tick` (from useGame) bumps on every store write; world arrays are mutated
  // in place, so rebuilding per tick keeps this list current.
  const rows = useMemo(() => {
    void tick
    return mergeRows(world)
  }, [world, tick])
  const psIds = useMemo(() => {
    const s = new Set<string>()
    for (const r of rows) if (r.ps) s.add(r.player.id)
    return s
  }, [rows])

  const teams = useMemo(
    () => world.teams.filter((t) => t.tier === 'NFL').sort((a, b) => a.name.localeCompare(b.name)),
    [world.teams],
  )

  const filtered = useMemo(() => {
    const positions = group === 'ALL' ? null : groupPositions(group)
    const needle = q.trim().toLowerCase()
    return rows.filter(({ player: p, teamId }) => {
      if (positions && !positions.includes(p.pos)) return false
      if (team === 'FA') {
        if (teamId != null) return false
      } else if (team !== 'ALL' && teamId !== team) {
        return false
      }
      if (needle && !p.name.toLowerCase().includes(needle)) return false
      if (ageBand === 'young' && p.age > 25) return false
      if (ageBand === 'prime' && (p.age < 26 || p.age > 29)) return false
      if (ageBand === 'vet' && p.age < 30) return false
      if (minOvr > 0 && p.ovr < minOvr) return false
      return true
    })
  }, [rows, group, team, q, ageBand, minOvr])

  const players = useMemo(() => filtered.map((r) => r.player), [filtered])
  const tagFor = (p: Player) => (psIds.has(p.id) ? 'PS' : null)

  // Every filter change resets the visible window.
  const apply = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v)
    setLimit(PAGE)
  }
  const statDefaultKey = `col:${STAT_DEFAULT[group] ?? 'main'}` as `col:${string}`

  return (
    <div>
      <PageHeader
        eyebrow="League"
        title="Find a Player"
        subtitle={`${filtered.length} of ${rows.length} NFL players · ${
          view === 'ratings' ? 'ratings & attributes' : `${world.season} season stats`
        }`}
        right={
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
            <Search size={16} className="text-faint" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setLimit(PAGE)
              }}
              placeholder="Search players…"
              className="w-44 bg-transparent text-sm outline-none placeholder:text-faint"
            />
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-surface-2 p-0.5">
          {(['ratings', 'stats'] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => apply(setView)(v)}
              className={cn(
                'rounded-md px-3 py-1.5 font-cond text-xs font-700 uppercase tracking-wide transition',
                view === v ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink-2',
              )}
            >
              {v === 'ratings' ? 'Ratings' : 'Stats'}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {POS_CHIPS.map((c) => (
            <button
              key={c}
              onClick={() => apply(setGroup)(c)}
              className={cn(
                'rounded-md px-2.5 py-1 font-cond text-xs font-700 uppercase transition',
                group === c ? 'text-[var(--team-ink)]' : 'bg-surface text-muted hover:bg-surface-2',
              )}
              style={group === c ? { background: 'var(--team)' } : undefined}
            >
              {c === 'ALL' ? 'All' : c}
            </button>
          ))}
        </div>

        <select
          value={team}
          onChange={(e) => apply(setTeam)(e.target.value)}
          className="rounded-md border border-line bg-surface-2 px-2 py-1 font-cond text-xs font-600 uppercase outline-none"
        >
          <option value="ALL">All clubs</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.city} {t.name}
            </option>
          ))}
          <option value="FA">Free agents</option>
        </select>

        <select
          value={ageBand}
          onChange={(e) => apply(setAgeBand)(e.target.value as AgeBand)}
          className="rounded-md border border-line bg-surface-2 px-2 py-1 font-cond text-xs font-600 uppercase outline-none"
        >
          {AGE_BANDS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>

        <select
          value={minOvr}
          onChange={(e) => apply(setMinOvr)(Number(e.target.value))}
          className="rounded-md border border-line bg-surface-2 px-2 py-1 font-cond text-xs font-600 uppercase outline-none"
        >
          {MIN_OVR.map((v) => (
            <option key={v} value={v}>
              {v === 0 ? 'Any OVR' : `${v}+ OVR`}
            </option>
          ))}
        </select>

        <div className="ml-auto">
          <Badge tone="neutral">{filtered.length} players</Badge>
        </div>
      </div>

      <Card pad={false}>
        {view === 'ratings' ? (
          <RatingsTable
            players={players}
            group={group}
            showTeam
            showCap
            showFit={false}
            tagFor={tagFor}
            mineTeamId={activeTeamId}
            limit={limit}
            onShowMore={() => setLimit((n) => n + PAGE)}
          />
        ) : (
          <StatsTable
            key={`stats-${group}`}
            players={players}
            group={group}
            season={world.season}
            level="NFL"
            showTeam
            showCap
            tagFor={tagFor}
            mineTeamId={activeTeamId}
            limit={limit}
            onShowMore={() => setLimit((n) => n + PAGE)}
            defaultSortKey={statDefaultKey}
            defaultDir="desc"
          />
        )}
      </Card>
    </div>
  )
}

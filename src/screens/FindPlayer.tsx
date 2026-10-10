import { useMemo, useState } from 'react'
import { Search, SlidersHorizontal } from 'lucide-react'
import { groupPositions } from '../game/data/ratingInfo'
import type { World } from '../game/engine/generate'
import type { Player } from '../game/types'
import { useGame, useWorld } from '../store/gameStore'
import { PlayerCard } from '../components/PlayerCard'
import { RatingsTable } from '../components/RatingsTable'
import { StatsTable } from '../components/StatsTable'
import { Badge, Button, Card, FilterChip, PageHeader, SegmentedControl, Sheet } from '../ui/kit'
import { usePhone } from '../ui/hooks'

// ─────────────────────────────────────────────────────────────────────────────
// Find a Player — every NFL player in the league (all clubs + free agents,
// practice squad tagged) with the Roster tabs' Ratings and Stats views.
//
// Data is merged once per world tick and filtered in the browser. The heavy
// ratings work is cached per player inside RatingsTable (and here per tick).
// ─────────────────────────────────────────────────────────────────────────────

type View = 'ratings' | 'stats' | 'cards'

const VIEWS: { id: View; label: string }[] = [
  { id: 'ratings', label: 'Ratings' },
  { id: 'stats', label: 'Stats' },
  { id: 'cards', label: 'Cards' },
]

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

const FIELD_CLASS =
  'rounded-[var(--r-md)] border border-line-strong bg-surface px-2 py-1.5 font-cond text-small font-700 uppercase text-ink outline-none max-sm:h-11 max-sm:text-[16px]'

export function FindPlayer() {
  const world = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const tick = useGame((s) => s.tick)
  const selectPlayer = useGame((s) => s.selectPlayer)
  const phone = usePhone()

  const [view, setView] = useState<View>('ratings')
  const [group, setGroup] = useState<PosChip>('ALL')
  const [team, setTeam] = useState('ALL')
  const [q, setQ] = useState('')
  const [ageBand, setAgeBand] = useState<AgeBand>('any')
  const [minOvr, setMinOvr] = useState(0)
  const [limit, setLimit] = useState(PAGE)
  const [filtersOpen, setFiltersOpen] = useState(false)

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

  const activeFilters = (group !== 'ALL' ? 1 : 0) + (team !== 'ALL' ? 1 : 0) + (q ? 1 : 0) + (ageBand !== 'any' ? 1 : 0) + (minOvr > 0 ? 1 : 0)
  const resetFilters = () => {
    setGroup('ALL')
    setTeam('ALL')
    setQ('')
    setAgeBand('any')
    setMinOvr(0)
    setLimit(PAGE)
  }

  const filters = (
    <div className="space-y-3">
      <div>
        <div className="label mb-1.5">Position</div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Position">
          {POS_CHIPS.map((c) => (
            <FilterChip key={c} pressed={group === c} onChange={() => apply(setGroup)(c)}>
              {c === 'ALL' ? 'All' : c}
            </FilterChip>
          ))}
        </div>
      </div>
      <div className={phone ? 'space-y-3' : 'flex flex-wrap items-center gap-x-4 gap-y-3'}>
        <label className="flex items-center gap-2">
          <span className="label shrink-0">Club</span>
          <select value={team} onChange={(e) => apply(setTeam)(e.target.value)} className={FIELD_CLASS}>
            <option value="ALL">All clubs</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.city} {t.name}
              </option>
            ))}
            <option value="FA">Free agents</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="label shrink-0">Age</span>
          <select value={ageBand} onChange={(e) => apply(setAgeBand)(e.target.value as AgeBand)} className={FIELD_CLASS}>
            {AGE_BANDS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="label shrink-0">Min OVR</span>
          <select value={minOvr} onChange={(e) => apply(setMinOvr)(Number(e.target.value))} className={FIELD_CLASS}>
            {MIN_OVR.map((v) => (
              <option key={v} value={v}>
                {v === 0 ? 'Any' : `${v}+`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="label mb-1.5 block">Search</span>
        <span className="flex items-center gap-2 rounded-[var(--r-md)] border border-line-strong bg-surface px-2 py-1.5">
          <Search size={16} className="shrink-0 text-faint" />
          <input
            value={q}
            onChange={(e) => apply(setQ)(e.target.value)}
            placeholder="Search players…"
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-faint max-sm:h-11 max-sm:text-[16px] sm:text-small"
          />
        </span>
      </label>
    </div>
  )

  return (
    <div>
      <PageHeader
        eyebrow="League"
        title="Find a Player"
        subtitle={`${filtered.length} of ${rows.length} NFL players · ${
          view === 'ratings' ? 'ratings & attributes' : view === 'cards' ? 'card view' : `${world.season} season stats`
        }`}
        right={
          <SegmentedControl
            label="Find a Player view"
            value={view}
            onChange={(v) => apply(setView)(v)}
            options={VIEWS.map((v) => ({ id: v.id, label: v.label }))}
          />
        }
      />

      {phone ? (
        <div className="mb-3 flex items-center gap-2">
          <Button variant="secondary" icon={<SlidersHorizontal size={16} aria-hidden />} onClick={() => setFiltersOpen(true)}>
            Filters{activeFilters ? ` (${activeFilters})` : ''}
          </Button>
          <span className="min-w-0 flex-1 text-small text-muted">{filtered.length} players</span>
        </div>
      ) : (
        <Card className="mb-3 bg-surface-2">
          {filters}
          <div className="mt-3 flex items-center gap-3 text-small text-muted">
            <span>{filtered.length} of {rows.length} players</span>
            {activeFilters > 0 && (
              <Button variant="quiet" size="sm" onClick={resetFilters}>
                Clear filters
              </Button>
            )}
          </div>
        </Card>
      )}

      <Sheet
        open={phone && filtersOpen}
        onClose={() => setFiltersOpen(false)}
        eyebrow="Find a Player"
        title={`Filters${activeFilters ? ` (${activeFilters})` : ''}`}
        footer={
          <>
            <Button variant="primary" size="lg" onClick={() => setFiltersOpen(false)}>
              Show {filtered.length} players
            </Button>
            {activeFilters > 0 && (
              <Button variant="quiet" onClick={resetFilters}>
                Clear filters
              </Button>
            )}
          </>
        }
      >
        {filters}
      </Sheet>

      {view === 'cards' ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.slice(0, limit).map(({ player, teamId }) => (
              <PlayerCard
                key={player.id}
                player={player}
                team={teamId ? world.byId[teamId] : null}
                tag={tagFor(player)}
                onClick={() => selectPlayer(player.id)}
                footer={
                  <span className="font-cond text-label font-700 uppercase tracking-wide tnum text-muted">
                    {teamId ? `$${(player.contract.capHit / 1_000_000).toFixed(1)}M · ${world.byId[teamId]?.abbr ?? ''}` : 'Free agent'}
                  </span>
                }
              />
            ))}
          </div>
          {!filtered.length && <p className="py-8 text-center text-small text-muted">No players match these filters.</p>}
          {filtered.length > limit && (
            <div className="mt-4 flex justify-center">
              <Button onClick={() => setLimit((n) => n + PAGE)}>Show more · {filtered.length - limit} left</Button>
            </div>
          )}
        </>
      ) : (
        <Card pad={false}>
          {view === 'ratings' ? (
            <RatingsTable
              players={players}
              group={group}
              showTeam
              showCap
              showFit={false}
              ovrFirst
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
      )}

      <div className="mt-3 flex justify-end">
        <Badge tone="neutral">{filtered.length} players</Badge>
      </div>
    </div>
  )
}

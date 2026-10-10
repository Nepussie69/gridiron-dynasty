import { useMemo, useState } from 'react'
import { LayoutGrid, List, Search, SlidersHorizontal, UserMinus } from 'lucide-react'
import { money } from '../lib/format'
import { deadMoney } from '../game/engine/cap'
import { masteryProgress } from '../game/engine/playbook'
import { schemeFit } from '../game/engine/style'
import { rosterOf } from '../game/selectors'
import { useGame, useWorld } from '../store/gameStore'
import { PlayerCard } from '../components/PlayerCard'
import { InjuryChip, PlayerTable } from '../components/PlayerTable'
import { RatingsTable } from '../components/RatingsTable'
import { StatsTable } from '../components/StatsTable'
import { mainStatValue, seasonLine } from '../game/engine/stats'
import { RATING_GROUPS, groupPositions } from '../game/data/ratingInfo'
import type { Player, Position, StatLevel } from '../game/types'
import {
  AccessBanner,
  Badge,
  Button,
  Card,
  ConfirmSheet,
  FilterChip,
  KpiStrip,
  KpiTile,
  OvrBadge,
  OverflowMenu,
  PageHeader,
  SegmentedControl,
  Sheet,
  Tabs,
  type Consequence,
  type MenuItem,
} from '../ui/kit'
import { useAccessLevel, usePhone } from '../ui/hooks'

const SIDES = [
  { id: 'ALL', label: 'All' },
  { id: 'OFF', label: 'Offense' },
  { id: 'DEF', label: 'Defense' },
  { id: 'ST', label: 'Special' },
] as const

const POSITIONS = ['ALL', 'QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'OG', 'C', 'DE', 'DT', 'LB', 'CB', 'S', 'K', 'P']

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'ratings', label: 'Ratings' },
  { id: 'stats', label: 'Stats' },
] as const

const RATING_POSITIONS = ['ALL', ...RATING_GROUPS.map((g) => g.id)]

const SORTS = [
  { id: 'ovr', label: 'Overall' },
  { id: 'pot', label: 'Potential' },
  { id: 'age', label: 'Age' },
  { id: 'cap', label: 'Cap Hit' },
  { id: 'name', label: 'Name' },
  { id: 'dev', label: 'Dev trait' },
  { id: 'pbk', label: 'Playbook' },
  { id: 'dead', label: 'Dead money' },
  { id: 'yrs', label: 'Years left' },
  { id: 'fit', label: 'Scheme fit' },
  { id: 'stats', label: 'Stats' },
] as const
type RosterSort = (typeof SORTS)[number]['id']

const DEV_RANK: Record<string, number> = {
  'X-Factor': 6,
  Superstar: 5,
  Star: 4,
  Starter: 3,
  Depth: 2,
  Backup: 1,
}

export function Roster() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const selectPlayer = useGame((s) => s.selectPlayer)
  const level = useAccessLevel('roster')
  const phone = usePhone()
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('overview')
  const [side, setSide] = useState<(typeof SIDES)[number]['id']>('ALL')
  const [pos, setPos] = useState('ALL')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<RosterSort>('ovr')
  const [view, setView] = useState<'table' | 'cards'>('table')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [cutting, setCutting] = useState<Player | null>(null)

  const roster = rosterOf(league, activeTeamId)
  const levelTier: StatLevel = league.byId[activeTeamId].tier === 'NFL' ? 'NFL' : 'CFB'
  const ocScheme = (league.staff[activeTeamId] ?? []).find((s) => s.role === 'Offensive Coordinator')?.scheme
  const dcScheme = (league.staff[activeTeamId] ?? []).find((s) => s.role === 'Defensive Coordinator')?.scheme

  const filtered = useMemo(() => {
    const groupPos = tab !== 'overview' ? groupPositions(pos) : null
    const out = roster.filter((p) => {
      if (side !== 'ALL' && p.side !== side) return false
      if (pos !== 'ALL') {
        if (tab !== 'overview') {
          if (groupPos && !groupPos.includes(p.pos)) return false
        } else if (p.pos !== pos) return false
      }
      if (q && !p.name.toLowerCase().includes(q.toLowerCase())) return false
      return true
    })
    const cmp = (a: Player, b: Player) => {
      switch (sort) {
        case 'stats': {
          const va = mainStatValue(a, seasonLine(a, league.season, levelTier)) ?? -1
          const vb = mainStatValue(b, seasonLine(b, league.season, levelTier)) ?? -1
          return vb - va
        }
        case 'ovr':
          return b.ovr - a.ovr
        case 'pot':
          return b.pot - a.pot || b.ovr - a.ovr
        case 'age':
          return a.age - b.age
        case 'cap':
          return b.contract.capHit - a.contract.capHit
        case 'dev':
          return (DEV_RANK[b.dev] ?? 0) - (DEV_RANK[a.dev] ?? 0)
        case 'pbk':
          return masteryProgress(b) - masteryProgress(a)
        case 'dead':
          return deadMoney(b.contract) - deadMoney(a.contract)
        case 'yrs':
          return b.contract.years - a.contract.years
        case 'fit': {
          const score = (p: Player) => {
            if (p.side === 'ST') return -1
            const sc = p.side === 'DEF' ? dcScheme : ocScheme
            return sc ? schemeFit(p, sc, p.side === 'DEF' ? 'DEF' : 'OFF') : -1
          }
          return score(b) - score(a)
        }
        default:
          return a.name.localeCompare(b.name)
      }
    }
    return [...out].sort(cmp)
  }, [roster, side, pos, q, sort, tab, league.season, levelTier, ocScheme, dcScheme])

  const avgAge = roster.length ? roster.reduce((s, p) => s + p.age, 0) / roster.length : 0
  const injured = roster.filter((p) => p.injured).length
  const isNFL = levelTier === 'NFL'
  const psCount = (league.practiceSquad?.[activeTeamId] ?? []).length
  const irCount = (league.ir?.[activeTeamId] ?? []).length

  const activeFilters = (side !== 'ALL' ? 1 : 0) + (pos !== 'ALL' ? 1 : 0) + (q ? 1 : 0)
  const resetFilters = () => {
    setSide('ALL')
    setPos('ALL')
    setQ('')
  }

  const positionList = tab === 'overview' ? POSITIONS : RATING_POSITIONS

  const filters = (
    <div className="space-y-3">
      <div>
        <div className="label mb-1.5">Side</div>
        <SegmentedControl
          label="Side of the ball"
          value={side}
          onChange={setSide}
          options={SIDES.map((s) => ({ id: s.id, label: s.label }))}
        />
      </div>
      <div>
        <div className="label mb-1.5">Position</div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Position">
          {positionList.map((p) => (
            <FilterChip key={p} pressed={pos === p} onChange={() => setPos(p)}>
              {p === 'ALL' ? 'All' : p}
            </FilterChip>
          ))}
        </div>
      </div>
      {tab === 'overview' && (
        <label className="flex items-center gap-2">
          <span className="label shrink-0">Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as RosterSort)}
            className="min-w-0 flex-1 rounded-[var(--r-md)] border border-line-strong bg-surface px-2 py-1.5 text-ink max-sm:h-11 max-sm:text-[16px] sm:text-small"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        <span className="label mb-1.5 block">Search</span>
        <span className="flex items-center gap-2 rounded-[var(--r-md)] border border-line-strong bg-surface px-2 py-1.5">
          <Search size={16} className="shrink-0 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
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
        eyebrow="Team"
        title="Roster"
        subtitle={
          tab === 'ratings'
            ? `${filtered.length} shown · click a column header to sort`
            : tab === 'stats'
              ? `${filtered.length} shown · ${league.season} season stats`
              : `${roster.length} players · sorted by ${SORTS.find((s) => s.id === sort)?.label.toLowerCase() ?? 'overall'}`
        }
        right={
          tab === 'overview' ? (
            <SegmentedControl
              label="Roster view"
              value={view}
              onChange={setView}
              options={[
                { id: 'table', label: 'Table', icon: <List size={14} aria-hidden /> },
                { id: 'cards', label: 'Cards', icon: <LayoutGrid size={14} aria-hidden /> },
              ]}
            />
          ) : undefined
        }
      />

      <Tabs
        label="Roster sections"
        value={tab}
        onChange={(id) => {
          setTab(id)
          setPos('ALL')
        }}
        stretch={phone}
        className="mb-4"
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'ratings', label: 'Ratings' },
          { id: 'stats', label: 'Stats' },
        ]}
      />

      <AccessBanner
        area="roster"
        className="mb-4"
        message={
          level === 'advise' ? (
            <>
              <b className="font-600 text-ink">The GM signs off on active-roster moves.</b> Depth, practice squad,
              injured reserve and development plans are yours to run here.
            </>
          ) : undefined
        }
      />

      <KpiStrip label="Roster summary" className="mb-4">
        <KpiTile
          label="Players"
          value={roster.length}
          unit="on the roster"
          why={
            <span className="text-muted">
              {isNFL ? 'A 53-man active roster' : 'The active squad'}
              <span className="sm:hidden"> · {injured} injured</span>
            </span>
          }
        />
        <KpiTile
          label="Injured"
          value={injured}
          unit={injured === 1 ? 'player out' : 'players out'}
          verdict={injured > 0 ? { label: 'Next men up', tone: 'warn' } : { label: 'Full health', tone: 'win' }}
          why={<span className="text-muted">Counting players on the injury report right now</span>}
        />
        <KpiTile
          label="Average age"
          value={avgAge.toFixed(1)}
          unit="years"
          why={<span className="text-muted">Roster experience across the squad</span>}
        />
        {isNFL && (
          <KpiTile
            className="max-sm:hidden"
            label="Reserve lists"
            value={psCount + irCount}
            unit="players"
            why={
              <span className="text-muted">
                {psCount} on the practice squad · {irCount} on injured reserve
              </span>
            }
          />
        )}
      </KpiStrip>

      <Card pad={false}>
        {phone ? (
          <div className="flex items-center gap-2 border-b border-line p-3">
            <Button variant="secondary" icon={<SlidersHorizontal size={16} aria-hidden />} onClick={() => setFiltersOpen(true)}>
              Filters{activeFilters ? ` (${activeFilters})` : ''}
            </Button>
            <span className="min-w-0 flex-1 text-small text-muted">{filtered.length} shown</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-line p-3">
            <div className="min-w-0 flex-1">{filters}</div>
            {activeFilters > 0 && (
              <Button variant="quiet" size="sm" onClick={resetFilters}>
                Clear filters
              </Button>
            )}
            <Badge tone="neutral">{filtered.length} shown</Badge>
          </div>
        )}

        {tab === 'overview' ? (
          view === 'cards' ? (
            <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((p) => (
                <PlayerCard key={p.id} player={p} team={league.byId[activeTeamId]} onClick={() => selectPlayer(p.id)} />
              ))}
              {!filtered.length && (
                <p className="col-span-full px-2 py-6 text-center text-small text-muted">No players match these filters.</p>
              )}
            </div>
          ) : (
            <div className="p-2">
              <PlayerTable
                players={filtered}
                showPhysicals
                showFit
                showDeadMoney
                scheme={ocScheme}
                defScheme={dcScheme}
                inlinePos={pos !== 'ALL' ? (pos as Position) : undefined}
                sortKey={sort === 'stats' ? null : sort}
                sortDir="desc"
                onSortChange={(key) => {
                  if (!key) return
                  if (SORTS.some((s) => s.id === key)) setSort(key as RosterSort)
                }}
                emptyText="No players match these filters."
              />
            </div>
          )
        ) : tab === 'ratings' ? (
          <RatingsTable players={filtered} group={pos} scheme={ocScheme} defScheme={dcScheme} />
        ) : (
          <StatsTable players={filtered} group={pos} season={league.season} level={levelTier} />
        )}
      </Card>

      {isNFL && (
        <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <PracticeSquadCard teamId={activeTeamId} onCut={setCutting} />
          <InjuredReserveCard teamId={activeTeamId} />
        </div>
      )}

      {/* Filters — phone sheet */}
      <Sheet
        open={phone && filtersOpen}
        onClose={() => setFiltersOpen(false)}
        eyebrow="Roster"
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

      {/* Practice-squad cut — the only path to releaseFromPracticeSquad. */}
      <PracticeSquadCut
        player={cutting}
        count={(league.practiceSquad?.[activeTeamId] ?? []).length}
        onClose={() => setCutting(null)}
      />
    </div>
  )
}

function PracticeSquadCard({ teamId, onCut }: { teamId: string; onCut: (p: Player) => void }) {
  const world = useWorld()
  const freeAgents = world.freeAgents
  const signToPracticeSquad = useGame((s) => s.signToPracticeSquad)
  const promote = useGame((s) => s.promoteFromPracticeSquad)
  const [pickId, setPickId] = useState('')

  const squad = world.practiceSquad?.[teamId] ?? []
  const candidates = useMemo(
    () => [...freeAgents].sort((a, b) => b.ovr - a.ovr).slice(0, 30),
    [freeAgents],
  )

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-[20px] font-800 italic uppercase leading-none text-ink">Practice Squad</h3>
        <Badge tone={squad.length >= 16 ? 'warn' : 'neutral'}>{squad.length}/16</Badge>
      </div>

      <div className="mb-3 flex gap-2">
        <select
          value={pickId}
          onChange={(e) => setPickId(e.target.value)}
          className="min-w-0 flex-1 rounded-[var(--r-md)] border border-line-strong bg-surface px-2 py-1.5 text-ink max-sm:h-11 max-sm:text-[16px] sm:text-small"
        >
          <option value="">Sign a free agent…</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.pos} {p.name} — {p.ovr}/{p.pot} OVR
            </option>
          ))}
        </select>
        <Button
          size="sm"
          disabled={!pickId || squad.length >= 16}
          onClick={() => {
            signToPracticeSquad(pickId)
            setPickId('')
          }}
        >
          Add
        </Button>
      </div>

      <div className="divide-y divide-line/60">
        {squad.length === 0 && <p className="py-3 text-small text-muted">No players on the practice squad.</p>}
        {squad.map((p) => {
          const cutItem: MenuItem = {
            id: 'cut',
            label: 'Cut from practice squad…',
            description: 'Opens a review of what it costs',
            icon: <UserMinus size={16} />,
            danger: true,
            onSelect: () => onCut(p),
          }
          return (
            <div key={p.id} className="flex items-center gap-2.5 py-2">
              <OvrBadge value={p.ovr} pot={p.pot} size={28} />
              <span className="w-8 shrink-0 font-cond text-label font-700 uppercase text-muted">{p.pos}</span>
              <span className="min-w-0 flex-1 truncate text-small font-600 text-ink">{p.name}</span>
              <Button size="sm" variant="secondary" onClick={() => promote(p.id)}>
                Promote
              </Button>
              <OverflowMenu items={[cutItem]} label={`Actions for ${p.name}`} size="sm" />
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-label leading-snug text-muted">
        The practice squad develops young players (max 16) without using an active roster spot. Promote them when they're ready.
      </p>
    </Card>
  )
}

function PracticeSquadCut({
  player,
  count,
  onClose,
}: {
  player: Player | null
  count: number
  onClose: () => void
}) {
  const release = useGame((s) => s.releaseFromPracticeSquad)
  const consequences: Consequence[] = player
    ? [
        { label: 'Reserve list', value: `${count} → ${Math.max(0, count - 1)} of 16`, tone: 'warn' },
        { label: 'His deal', value: `${money(player.contract.capHit)} · practice-squad salary` },
        { label: 'Where he goes', value: 'Back to the free-agent pool' },
        { label: 'Who decides', value: 'You (roster decisions)' },
      ]
    : []
  return (
    <ConfirmSheet
      open={!!player}
      onClose={onClose}
      eyebrow="Practice squad"
      title={player ? `Cut ${player.name}?` : ''}
      subtitle={player ? `${player.pos} · rated ${player.ovr}/${player.pot}` : undefined}
      consequences={consequences}
      confirmLabel="Cut from practice squad"
      saferAlternative={{ label: 'Keep him on the squad', onClick: onClose }}
      ledgerNote={null}
      onConfirm={() => {
        if (!player) return
        release(player.id)
        onClose()
      }}
    />
  )
}

function InjuredReserveCard({ teamId }: { teamId: string }) {
  const world = useWorld()
  const placeOnIR = useGame((s) => s.placeOnIR)
  const activate = useGame((s) => s.activateFromIR)
  const roster = world.roster[teamId] ?? []
  const ir = world.ir?.[teamId] ?? []
  const eligible = roster.filter((p) => p.injured)

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-[20px] font-800 italic uppercase leading-none text-ink">Injured Reserve</h3>
        <Badge tone={ir.length ? 'warn' : 'neutral'}>{ir.length}</Badge>
      </div>

      <div className="divide-y divide-line/60">
        {ir.length === 0 && <p className="py-3 text-small text-muted">No players on injured reserve.</p>}
        {ir.map((p) => {
          const healthy = !p.injured || p.injured.games <= 0
          return (
            <div key={p.id} className="flex items-center gap-2.5 py-2">
              <OvrBadge value={p.ovr} pot={p.pot} size={28} />
              <span className="w-8 shrink-0 font-cond text-label font-700 uppercase text-muted">{p.pos}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-small font-600 text-ink">{p.name}</span>
                <span className="block text-label text-muted">
                  {p.injured ? `${p.injured.note} · OUT ${p.injured.games}W` : 'Healthy'}
                </span>
              </span>
              <Button size="sm" variant="secondary" disabled={!healthy} onClick={() => activate(p.id)}>
                Activate
              </Button>
            </div>
          )
        })}
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <div className="label mb-2">Place on IR</div>
        <div className="space-y-1.5">
          {eligible.length === 0 && <p className="text-small text-muted">No injured players available.</p>}
          {eligible.map((p) => (
            <div key={p.id} className="flex items-center gap-2.5">
              <span className="w-8 shrink-0 font-cond text-label font-700 uppercase text-muted">{p.pos}</span>
              <span className="min-w-0 flex-1 truncate text-small text-ink-2">{p.name}</span>
              <InjuryChip player={p} />
              <Button size="sm" variant="secondary" onClick={() => placeOnIR(p.id)}>
                Place
              </Button>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 text-label leading-snug text-muted">
        Injured reserve opens an active roster spot while a player heals. Activate him once he's healthy.
      </p>
    </Card>
  )
}

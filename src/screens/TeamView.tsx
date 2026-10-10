import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowLeft, SlidersHorizontal } from 'lucide-react'
import { money, ordinal } from '../lib/format'
import { bestInk } from '../lib/teamColor'
import { capSpace, recordOf, recordStr, rosterOf } from '../game/selectors'
import { NFL_TEAMS } from '../game/data/nflTeams'
import { RATING_GROUPS, groupPositions } from '../game/data/ratingInfo'
import { teamRatings } from '../game/engine/depth'
import { coachLabels, offStyle } from '../game/engine/playsim'
import { useGame, useWorld } from '../store/gameStore'
import { requestTradeFor } from '../game/tradeRequest'
import { PlayerTable } from '../components/PlayerTable'
import { RatingsTable } from '../components/RatingsTable'
import { StatsTable } from '../components/StatsTable'
import { TopPlayers } from '../components/TopPlayers'
import { ScoutClubCard } from '../components/ScoutClub'
import { Badge, Button, Card, FilterChip, PageHeader, SegmentedControl, Sheet, TeamCrest } from '../ui/kit'
import { usePhone } from '../ui/hooks'
import type { Position, StatLevel } from '../game/types'

type Tab = 'overview' | 'ratings' | 'stats'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'ratings', label: 'Ratings' },
  { id: 'stats', label: 'Stats' },
]

const OVERVIEW_POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'OT', 'OG', 'C', 'DE', 'DT', 'LB', 'CB', 'S', 'K', 'P']
const RATING_POSITIONS = ['ALL', ...RATING_GROUPS.map((g) => g.id)]

function Info({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-2">
      <div className="label">{label}</div>
      <div className="font-display text-[18px] font-800 italic uppercase leading-none text-ink">{value}</div>
      {sub && <div className="mt-1 text-label text-muted">{sub}</div>}
    </div>
  )
}

function TradeForButton({ teamId, playerId }: { teamId: string; playerId: string }) {
  const setScreen = useGame((s) => s.setScreen)
  return (
    <Button
      size="sm"
      variant="quiet"
      title="Open the Trade Center with him loaded on the Get side"
      onClick={() => {
        requestTradeFor(teamId, playerId)
        setScreen('trades')
      }}
    >
      Trade for…
    </Button>
  )
}

/**
 * The read-only page for another club — identity band (record, division rank,
 * ratings), top players, a scout report, and the roster in the same three tabs
 * as your own Roster, with a "Trade for…" per row.
 */
export function TeamView() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const viewId = useGame((s) => s.teamViewId)
  const teamReturn = useGame((s) => s.teamReturn)
  const setScreen = useGame((s) => s.setScreen)
  const phone = usePhone()

  const [tab, setTab] = useState<Tab>('overview')
  const [pos, setPos] = useState('ALL')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const teamId = viewId && league.byId[viewId] ? viewId : activeTeamId
  const team = league.byId[teamId]
  const roster = rosterOf(league, teamId)
  const rec = recordOf(league, teamId)
  const isNFL = team.tier === 'NFL'
  const level: StatLevel = isNFL ? 'NFL' : 'CFB'

  const ratings = teamRatings(league, teamId)
  const space = capSpace(league, teamId)
  const labels = coachLabels(league, teamId)
  const style = offStyle(league, teamId)
  const staff = league.staff[teamId] ?? []
  const ocScheme = staff.find((s) => s.role === 'Offensive Coordinator')?.scheme
  const dcScheme = staff.find((s) => s.role === 'Defensive Coordinator')?.scheme

  const divTeams = isNFL
    ? NFL_TEAMS.filter((t) => t.conference === team.conference && t.division === team.division)
    : [team]
  const rank =
    divTeams
      .map((t) => ({ id: t.id, w: recordOf(league, t.id).wins, l: recordOf(league, t.id).losses }))
      .sort((a, b) => b.w - a.w || a.l - b.l)
      .findIndex((x) => x.id === teamId) + 1

  const filtered = useMemo(() => {
    const groupPos = tab !== 'overview' ? groupPositions(pos) : null
    return roster.filter((p) => {
      if (pos === 'ALL') return true
      if (tab !== 'overview') return groupPos ? groupPos.includes(p.pos) : false
      return p.pos === pos
    })
  }, [roster, tab, pos])

  const tradeFor = (p: { id: string }) => <TradeForButton teamId={teamId} playerId={p.id} />
  const positions = tab === 'overview' ? OVERVIEW_POSITIONS : RATING_POSITIONS
  const activeFilters = pos !== 'ALL' ? 1 : 0
  const pickTab = (t: Tab) => {
    setTab(t)
    setPos('ALL')
  }

  const filterChips = (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Position filter">
      {positions.map((p) => (
        <FilterChip key={p} pressed={pos === p} onChange={(next) => setPos(next ? p : 'ALL')}>
          {p === 'ALL' ? 'All' : p}
        </FilterChip>
      ))}
    </div>
  )

  const heroStyle = {
    background: `linear-gradient(120deg, ${team.primary}, ${team.secondary})`,
    '--team-on': bestInk(team.primary),
    color: 'var(--team-on)',
  } as CSSProperties

  return (
    <div>
      <Button variant="quiet" size="sm" className="mb-4" icon={<ArrowLeft size={14} aria-hidden />} onClick={() => setScreen(teamReturn)}>
        Back
      </Button>

      <PageHeader
        eyebrow={isNFL ? `${team.conference} ${team.division}` : team.conference}
        title={isNFL ? `${team.city} ${team.name}` : team.name}
        subtitle={`${recordStr(rec)} · ${ordinal(rank)} in division · read-only scouting page`}
      />

      <Card pad={false} className="mb-5 overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 p-4" style={heroStyle}>
          <TeamCrest team={team} size={48} />
          <div className="label min-w-0 flex-1 text-[var(--team-on)] opacity-80">Unit ratings</div>
          <div className="flex items-center gap-4">
            {([
              ['OVR', ratings.overall],
              ['OFF', ratings.off],
              ['DEF', ratings.def],
            ] as const).map(([k, v]) => (
              <div key={k} className="text-center">
                <div className="font-display text-[24px] font-800 italic leading-none tnum text-[var(--team-on)]">{v.toFixed(1)}</div>
                <div className="label text-[var(--team-on)] opacity-80">{k}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-3 border-t border-line p-4 sm:grid-cols-3">
          <Info label="Offense" value={labels.ocScheme} sub={`${labels.oc} · ${Math.round(style.passRate * 100)}% pass`} />
          <Info label="Defense" value={labels.dcScheme} sub={labels.dc} />
          <Info label="Cap space" value={money(space)} sub={`${roster.length} players under contract`} />
        </div>
      </Card>

      <Card className="mb-5">
        <h3 className="mb-3 font-display text-[20px] font-800 italic uppercase leading-none text-ink">Top players</h3>
        <div className="space-y-2">
          <TopPlayers teamId={teamId} side="off" n={5} label="Their offense" />
          <TopPlayers teamId={teamId} side="def" n={5} label="Their defense" />
        </div>
      </Card>

      <ScoutClubCard teamId={teamId} className="mb-5" />

      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <SegmentedControl label="Roster view" size="sm" value={tab} onChange={pickTab} options={TABS} />

          <div className="min-w-0 flex-1 max-sm:hidden">{filterChips}</div>
          {phone && (
            <Button variant="secondary" size="sm" icon={<SlidersHorizontal size={15} aria-hidden />} onClick={() => setFiltersOpen(true)}>
              Filters{activeFilters ? ` (${activeFilters})` : ''}
            </Button>
          )}

          <Badge tone="neutral" className="ml-auto">
            {filtered.length} shown
          </Badge>
        </div>

        {tab === 'overview' ? (
          <div className="p-2">
            <PlayerTable
              players={filtered}
              showPhysicals
              showFit
              showDeadMoney
              scheme={ocScheme}
              defScheme={dcScheme}
              inlinePos={pos !== 'ALL' ? (pos as Position) : undefined}
              right={tradeFor}
              emptyText="No players match these filters."
            />
          </div>
        ) : tab === 'ratings' ? (
          <RatingsTable players={filtered} group={pos} scheme={ocScheme} defScheme={dcScheme} right={tradeFor} />
        ) : (
          <StatsTable players={filtered} group={pos} season={league.season} level={level} right={tradeFor} />
        )}
      </Card>

      <Sheet open={phone && filtersOpen} onClose={() => setFiltersOpen(false)} eyebrow="Position filter" title="Show positions">
        {filterChips}
      </Sheet>
    </div>
  )
}

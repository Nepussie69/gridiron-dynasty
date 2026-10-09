import { useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
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
import { Badge, Button, Card, PageHeader, TeamCrest } from '../ui/kit'
import type { Position, StatLevel } from '../game/types'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'ratings', label: 'Ratings' },
  { id: 'stats', label: 'Stats' },
] as const

const OVERVIEW_POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'OT', 'OG', 'C', 'DE', 'DT', 'LB', 'CB', 'S', 'K', 'P']
const RATING_POSITIONS = ['ALL', ...RATING_GROUPS.map((g) => g.id)]

function ordinal(n: number): string {
  const mod = n % 100
  if (mod >= 11 && mod <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

function Info({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
      <div className="label !mb-0.5">{label}</div>
      <div className="font-display text-lg font-700 uppercase leading-none text-ink">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-muted">{sub}</div>}
    </div>
  )
}

function TradeForButton({ teamId, playerId }: { teamId: string; playerId: string }) {
  const setScreen = useGame((s) => s.setScreen)
  return (
    <Button
      size="sm"
      variant="ghost"
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
 * L12.8 V1: the read-only page for another club — header (record, division rank,
 * schemes, ratings, cap), top players (V2), a scout report (V3), and the roster
 * in the same three tabs as your own Roster, with a "Trade for…" per row.
 */
export function TeamView() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const viewId = useGame((s) => s.teamViewId)
  const teamReturn = useGame((s) => s.teamReturn)
  const setScreen = useGame((s) => s.setScreen)

  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('overview')
  const [pos, setPos] = useState('ALL')

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

  return (
    <div>
      <button
        type="button"
        onClick={() => setScreen(teamReturn)}
        className="mb-4 inline-flex items-center gap-1.5 font-cond text-xs font-700 uppercase tracking-wide text-muted transition hover:text-ink"
      >
        <ArrowLeft size={14} /> Back
      </button>

      <PageHeader
        eyebrow={isNFL ? `${team.conference} ${team.division}` : team.conference}
        title={isNFL ? `${team.city} ${team.name}` : team.name}
        subtitle={`${recordStr(rec)} · ${ordinal(rank)} in division · read-only scouting page`}
      />

      <Card pad={false} className="mb-5 overflow-hidden">
        <div
          className="flex flex-wrap items-center gap-4 p-4"
          style={{ background: `linear-gradient(120deg, ${team.primary}, ${team.secondary})` }}
        >
          <TeamCrest team={team} size={56} />
          <div className="text-white">
            <div className="label !text-white/70">
              {isNFL ? `${team.conference} ${team.division}` : team.conference}
            </div>
            <div className="font-display text-3xl font-700 uppercase leading-none">
              {isNFL ? `${team.city} ${team.name}` : team.name}
            </div>
            <div className="mt-1 font-cond text-sm text-white/80">
              {recordStr(rec)} · {ordinal(rank)} in division
            </div>
          </div>
          <div className="ml-auto flex items-center gap-4 text-white">
            {([['OVR', ratings.overall], ['OFF', ratings.off], ['DEF', ratings.def]] as const).map(([k, v]) => (
              <div key={k} className="text-center">
                <div className="font-display text-2xl font-700 leading-none tnum">{v.toFixed(1)}</div>
                <div className="label !text-[9px] !text-white/70">{k}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-3 border-t border-line p-4 sm:grid-cols-3">
          <Info
            label="Offense"
            value={labels.ocScheme}
            sub={`${labels.oc} · ${Math.round(style.passRate * 100)}% pass`}
          />
          <Info label="Defense" value={labels.dcScheme} sub={labels.dc} />
          <Info label="Cap space" value={money(space)} sub={`${roster.length} players under contract`} />
        </div>
      </Card>

      <Card className="mb-5">
        <h3 className="mb-3 font-display text-lg font-700 uppercase tracking-wide">Top players</h3>
        <div className="space-y-2">
          <TopPlayers teamId={teamId} side="off" n={5} label="Their offense" />
          <TopPlayers teamId={teamId} side="def" n={5} label="Their defense" />
        </div>
      </Card>

      <ScoutClubCard teamId={teamId} className="mb-5" />

      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <div className="flex rounded-lg bg-surface-2 p-0.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id)
                  setPos('ALL')
                }}
                className={cn(
                  'rounded-md px-3 py-1 font-cond text-xs font-700 uppercase tracking-wide transition',
                  tab === t.id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink-2',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-1">
            {(tab === 'overview' ? OVERVIEW_POSITIONS : RATING_POSITIONS).map((p) => (
              <button
                key={p}
                onClick={() => setPos(p)}
                className={cn(
                  'rounded-md px-2 py-1 font-cond text-xs font-700 uppercase transition',
                  pos === p ? 'text-[var(--team-ink)]' : 'text-muted hover:bg-surface-2',
                )}
                style={pos === p ? { background: 'var(--team)' } : undefined}
              >
                {p}
              </button>
            ))}
          </div>

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
    </div>
  )
}

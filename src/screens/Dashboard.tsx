import { ArrowRight, ChevronRight, TrendingDown, TrendingUp } from 'lucide-react'
import { money } from '../lib/format'
import { NFL_TEAMS } from '../game/data/nflTeams'
import {
  capSpace,
  defenseRating,
  offenseRating,
  positionNeeds,
  recordOf,
  recordStr,
  rosterOf,
  scheduleFor,
  teamAvgOvr,
} from '../game/selectors'
import { useGame, useWorld, type ScreenId } from '../store/gameStore'
import { overallRep } from '../game/engine/career'
import { CulturePanel } from '../components/CulturePanel'
import { Badge, Button, Card, Donut, MiniBars, OvrBadge, PageHeader, RatingBar, Stat, TeamCrest } from '../ui/kit'

export function Dashboard() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const career = useGame((s) => s.career)!
  const setScreen = useGame((s) => s.setScreen)
  const selectPlayer = useGame((s) => s.selectPlayer)

  const team = league.byId[activeTeamId]
  const roster = rosterOf(league, activeTeamId)
  const rec = recordOf(league, activeTeamId)
  const space = capSpace(league, activeTeamId)
  const isNFL = team.tier === 'NFL'

  const off = offenseRating(roster)
  const def = defenseRating(roster)
  const st = roster.filter((p) => p.side === 'ST')
  const stRating = st.length ? st.reduce((s, p) => s + p.ovr, 0) / st.length : 0
  const ovr = teamAvgOvr(roster)

  const needs = isNFL ? positionNeeds(league, activeTeamId, NFL_TEAMS).slice(0, 6) : []
  const { out: schedule } = scheduleFor(league, activeTeamId)
  const next = schedule.find((g) => g.week >= career.week)
  const opp = next ? league.byId[next.opponentId] : null

  const stars = [...roster].sort((a, b) => b.ovr - a.ovr).slice(0, 5)
  const news = league.news.slice(0, 5)

  const divTeams = isNFL
    ? NFL_TEAMS.filter((t) => t.conference === team.conference && t.division === team.division)
    : [team]
  const rank =
    divTeams
      .map((t) => ({ id: t.id, w: recordOf(league, t.id).wins, l: recordOf(league, t.id).losses }))
      .sort((a, b) => b.w - a.w || a.l - b.l)
      .findIndex((x) => x.id === activeTeamId) + 1

  return (
    <div>
      <PageHeader
        eyebrow={`${isNFL ? `${team.conference} ${team.division}` : team.conference} · Season ${career.season}`}
        title="Front Office"
        subtitle={career.ownerExpectation}
        right={
          <div className="flex gap-2">
            <Button onClick={() => setScreen('roster')}>Manage Roster</Button>
            <Button variant="team" onClick={() => setScreen(isNFL ? 'draft' : 'recruiting')}>
              {isNFL ? 'Draft Board' : 'Recruiting'} <ArrowRight size={15} />
            </Button>
          </div>
        }
      />

      {/* KPI strip */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card className="flex items-center gap-4">
          <div>
            <div className="label mb-1">Record</div>
            <div className="font-display text-3xl font-700 tnum leading-none">
              {rec.wins}-{rec.losses}
            </div>
            <div className="mt-1 flex items-center gap-1 text-xs text-muted">
              {rank === 1 ? (
                <><TrendingUp size={13} className="text-win" /> 1st in division</>
              ) : (
                <><TrendingDown size={13} className="text-muted" /> {rank}th in division</>
              )}
            </div>
          </div>
        </Card>
        <Card className="flex items-center gap-4">
          <Donut value={career.jobSecurity} color={career.jobSecurity > 60 ? '#05914f' : career.jobSecurity > 35 ? '#d98207' : '#dc2937'} />
          <Stat label="Job Security" value={`${career.jobSecurity}%`} sub={career.jobSecurity > 60 ? 'Safe' : 'On the hot seat'} />
        </Card>
        <Card>
          <Stat label="Team Overall" value={Math.round(ovr)} sub="Top-22 weighted" />
          <div className="mt-3">
            <RatingBar value={ovr} />
          </div>
        </Card>
        {isNFL ? (
          <Card>
            <Stat
              label="Cap Space"
              value={money(space)}
              sub={`of $279.2M limit`}
              tone={space < 5 ? 'loss' : space > 25 ? 'win' : undefined}
            />
            <div className="mt-3">
              <RatingBar value={Math.min(100, (space / 60) * 100 + 40)} color={space < 5 ? '#dc2937' : '#05914f'} />
            </div>
          </Card>
        ) : (
          <Card>
            <Stat label="Prestige" value={team.prestige} sub={team.conference} />
            <div className="mt-3">
              <RatingBar value={team.prestige} />
            </div>
          </Card>
        )}
        <Card>
          <Stat label="Reputation" value={overallRep(career.reputation)} sub={career.path === 'coach' ? 'Coaching track' : 'Personnel track'} />
          <div className="mt-3">
            <RatingBar value={overallRep(career.reputation)} color="#c99a2e" />
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-5">
          {/* Next game */}
          {next && opp && (
            <Card pad={false} className="overflow-hidden">
              <div className="hatch flex items-center justify-between border-b border-line px-4 py-2">
                <div className="label">Up Next · Week {next.week}</div>
                <div className="label">{next.home ? 'Home' : 'Away'}</div>
              </div>
              <div className="flex items-center gap-4 p-5">
                <div className="flex flex-1 items-center gap-3">
                  <TeamCrest team={team} size={52} />
                  <div>
                    <div className="font-display text-xl font-700 uppercase leading-none">
                      {isNFL ? team.name : team.name}
                    </div>
                    <div className="mt-1 font-cond text-sm text-muted">{recordStr(rec)}</div>
                  </div>
                </div>
                <div className="text-center">
                  <div className="font-display text-2xl font-700 uppercase text-faint">vs</div>
                  <Badge tone="info" className="mt-1">{team.abbr && isNFL ? `${team.abbr} - ${opp.abbr}` : 'Matchup'}</Badge>
                </div>
                <div className="flex flex-1 items-center justify-end gap-3">
                  <div className="text-right">
                    <div className="font-display text-xl font-700 uppercase leading-none">{opp.name}</div>
                    <div className="mt-1 font-cond text-sm text-muted">
                      {recordStr(recordOf(league, opp.id))}
                    </div>
                  </div>
                  <TeamCrest team={opp} size={52} />
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-line bg-surface-2 px-4 py-2.5">
                <span className="text-xs text-muted">Vegas line: {team.abbr} -3.5 · O/U 44.5</span>
                <Button size="sm" variant="team" onClick={() => setScreen('schedule')}>
                  Game Plan <ChevronRight size={14} />
                </Button>
              </div>
            </Card>
          )}

          {/* Ratings */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-lg font-700 uppercase tracking-wide">Unit Grades</h3>
              <Badge tone="team">Scheme: {league.staff[activeTeamId]?.[0]?.scheme ?? 'Balanced'}</Badge>
            </div>
            <MiniBars
              items={[
                { label: 'OFF', value: off, color: 'var(--team)' },
                { label: 'DEF', value: def, color: '#0b62ff' },
                { label: 'ST', value: stRating, color: '#c99a2e' },
              ]}
            />
          </Card>

          {/* Culture / cohesion */}
          <CulturePanel teamId={activeTeamId} />

          {/* Positional needs (NFL) */}
          {isNFL && (
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-display text-lg font-700 uppercase tracking-wide">Positional Needs</h3>
                <span className="text-xs text-muted">vs. league average</span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                {needs.map((n) => {
                  const bad = n.gap < -3
                  const warn = n.gap >= -3 && n.gap < 0
                  return (
                    <div key={n.pos} className="flex items-center gap-2">
                      <span className="w-8 font-cond text-xs font-700 uppercase text-muted">{n.pos}</span>
                      <div className="flex-1">
                        <RatingBar value={Math.round(n.mine)} color={bad ? '#dc2937' : warn ? '#d98207' : '#05914f'} />
                      </div>
                      <span className="w-8 text-right font-cond text-xs font-700 tnum text-ink-2">
                        {Math.round(n.mine)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {/* Stars */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-lg font-700 uppercase tracking-wide">Cornerstones</h3>
              <Button size="sm" variant="ghost" onClick={() => setScreen('roster')}>
                Full Roster <ChevronRight size={14} />
              </Button>
            </div>
            <div className="space-y-1">
              {stars.map((p) => (
                <button
                  key={p.id}
                  onClick={() => selectPlayer(p.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-surface-2"
                >
                  <OvrBadge value={p.ovr} size={30} />
                  <span className="w-8 font-cond text-[11px] font-700 uppercase text-muted">{p.pos}</span>
                  <span className="flex-1 truncate font-600 text-ink">{p.name}</span>
                  <span className="font-cond text-xs text-muted">{p.college}</span>
                  <ChevronRight size={15} className="text-faint" />
                </button>
              ))}
            </div>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-lg font-700 uppercase tracking-wide">Inbox</h3>
              <Button size="sm" variant="ghost" onClick={() => setScreen('inbox')}>
                View All
              </Button>
            </div>
            <div className="space-y-2.5">
              {news.map((n) => (
                <button
                  key={n.id}
                  onClick={() => setScreen('inbox')}
                  className="flex w-full items-start gap-3 rounded-lg border border-line/70 p-2.5 text-left transition hover:border-line-strong hover:bg-surface-2"
                >
                  <Badge tone={n.category === 'Owner' ? 'gold' : n.category === 'Injury' ? 'loss' : 'info'}>
                    {n.category}
                  </Badge>
                  <div className="min-w-0">
                    <div className="text-sm font-600 leading-snug text-ink">{n.headline}</div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-muted">{n.body}</div>
                  </div>
                </button>
              ))}
            </div>
          </Card>

          {isNFL && (
            <Card>
              <h3 className="mb-3 font-display text-lg font-700 uppercase tracking-wide">
                {team.conference} {team.division}
              </h3>
              <div className="space-y-1">
                {divTeams
                  .map((t) => ({ t, r: recordOf(league, t.id) }))
                  .sort((a, b) => b.r.wins - a.r.wins || a.r.losses - b.r.losses)
                  .map(({ t, r }) => (
                    <div
                      key={t.id}
                      className="flex items-center gap-3 rounded-lg px-2 py-1.5"
                      style={t.id === activeTeamId ? { background: 'var(--team-soft)' } : undefined}
                    >
                      <TeamCrest team={t} size={24} />
                      <span className="flex-1 font-cond text-sm font-600 text-ink">{t.name}</span>
                      <span className="font-display text-base font-700 tnum text-ink-2">
                        {r.wins}-{r.losses}
                      </span>
                    </div>
                  ))}
              </div>
            </Card>
          )}

          <Card>
            <h3 className="mb-3 font-display text-lg font-700 uppercase tracking-wide">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { label: 'Depth Chart', screen: 'depth' },
                  { label: 'Staff Hiring', screen: 'staff' },
                  { label: isNFL ? 'Trade Center' : 'Recruiting', screen: isNFL ? 'trades' : 'recruiting' },
                  { label: isNFL ? 'Salary Cap' : 'Scouting', screen: isNFL ? 'cap' : 'scouting' },
                ] as { label: string; screen: ScreenId }[]
              ).map((a) => (
                <Button key={a.label} onClick={() => setScreen(a.screen)} className="justify-start">
                  {a.label}
                </Button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

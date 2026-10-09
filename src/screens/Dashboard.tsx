import { ArrowRight, ChevronRight, TrendingDown, TrendingUp } from 'lucide-react'
import { useMemo } from 'react'
import { gradeColor, inkOn, money } from '../lib/format'
import { cn } from '../lib/cn'
import { depthGroup } from '../game/engine/depth'
import { teamStrength, type World } from '../game/engine/generate'
import type { Position } from '../game/types'
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
import { ownerPersonality, ownerPersonalityLabel, rivalTitle } from '../game/engine/people'
import { rivalFor } from '../game/engine/rivalry'
import { hasRoom } from '../game/engine/room'
import { CulturePanel } from '../components/CulturePanel'
import { KeysCard } from '../components/KeysCard'
import { OfficeScene } from '../components/OfficeScene'
import { PracticeCard } from '../components/PracticeCard'
import { RoomCard } from '../components/RoomCard'
import { WeeklyChecklist } from '../components/WeeklyChecklist'
import { WeeklyDecision } from '../components/WeeklyDecision'
import { Badge, Button, Card, Donut, MiniBars, OvrBadge, PageHeader, RatingBar, Stat, TeamCrest } from '../ui/kit'
import { TopPlayers } from '../components/TopPlayers'
import { TeamHoverCard } from '../components/TeamHoverCard'

export function Dashboard() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const career = useGame((s) => s.career)!
  const setScreen = useGame((s) => s.setScreen)
  const viewTeam = useGame((s) => s.viewTeam)
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
  const rival = opp ? rivalFor(league, opp.id) : undefined

  // U4: a broadcast-style win probability for the hero card. Reads the same
  // strength model the ghost-GM projection uses (home field worth ~0.5).
  const winProb =
    next && opp
      ? Math.min(
          0.92,
          Math.max(
            0.08,
            0.5 + (teamStrength(roster) + (next.home ? 0.5 : -0.5) - teamStrength(rosterOf(league, opp.id))) / 20,
          ),
        )
      : 0.5

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
            <Button variant="team" onClick={() => setScreen('draft')}>
              Draft Board <ArrowRight size={15} />
            </Button>
          </div>
        }
      />

      <OfficeScene className="mb-5" />
      <WeeklyDecision className="mb-5" />
      <WeeklyChecklist className="mb-5" />

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
          {/* L9 Z5: a rivalry week against a rival's club. */}
          {rival && opp && (
            <Card className="border-gold/60 bg-gold/10">
              <div className="font-cond text-sm font-700 uppercase leading-snug text-ink">
                Rivalry week: {rival.name} ({rivalTitle(rival)}) and the {opp.name}
              </div>
            </Card>
          )}
          {/* Next game — U4 broadcast hero matchup */}
          {next && opp && (
            <>
              <Card pad={false} className="overflow-hidden">
                <div className="hatch flex items-center justify-between border-b border-line px-4 py-2">
                  <div className="label">Up Next · Week {next.week}</div>
                  <div className="label">
                    {next.home ? `Home · ${team.stadium}` : `Away · ${opp.stadium}`}
                  </div>
                </div>

                <div className="relative grid grid-cols-2">
                  <TeamHoverCard team={team} className="flex">
                    <button
                      type="button"
                      onClick={() => viewTeam(team.id)}
                      className="motion relative flex min-h-[148px] flex-col justify-between overflow-hidden p-4 text-left hover:brightness-105 sm:p-5"
                      style={{ background: `linear-gradient(135deg, ${team.primary}, ${team.secondary})` }}
                    >
                      <TeamCrest team={team} size={50} />
                      <div className="relative text-white">
                        <div className="label !text-white/70">{team.conference} {team.division ?? ''}</div>
                        <div className="font-display text-2xl font-700 uppercase leading-none sm:text-3xl">
                          {isNFL ? team.name : team.name}
                        </div>
                        <div className="mt-1 font-cond text-sm font-600 text-white/85">{recordStr(rec)}</div>
                      </div>
                    </button>
                  </TeamHoverCard>

                  <TeamHoverCard team={opp} className="flex">
                    <button
                      type="button"
                      onClick={() => viewTeam(opp.id)}
                      className="motion relative flex min-h-[148px] flex-col items-end justify-between overflow-hidden p-4 text-right hover:brightness-105 sm:p-5"
                      style={{ background: `linear-gradient(225deg, ${opp.primary}, ${opp.secondary})` }}
                    >
                      <TeamCrest team={opp} size={50} />
                      <div className="relative text-white">
                        <div className="label !text-white/70">{opp.conference} {opp.division ?? ''}</div>
                        <div className="font-display text-2xl font-700 uppercase leading-none sm:text-3xl">{opp.name}</div>
                        <div className="mt-1 font-cond text-sm font-600 text-white/85">
                          {recordStr(recordOf(league, opp.id))}
                        </div>
                      </div>
                    </button>
                  </TeamHoverCard>

                  <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
                    <span className="grid h-12 w-12 place-items-center rounded-full border-4 border-surface bg-ink font-display text-lg font-700 uppercase text-canvas shadow-lg">
                      vs
                    </span>
                  </div>
                </div>

                {/* Win probability */}
                <div className="border-t border-line px-4 py-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="label !mb-0">Win probability</span>
                    <span className="font-cond text-[11px] tnum text-muted">
                      {team.abbr || team.name} {Math.round(winProb * 100)}% · {opp.abbr || opp.name}{' '}
                      {Math.round((1 - winProb) * 100)}%
                    </span>
                  </div>
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-3">
                    <span className="transition-[width] duration-500" style={{ width: `${winProb * 100}%`, background: team.primary }} />
                    <span className="flex-1" style={{ background: opp.primary }} />
                  </div>
                </div>

                {/* L12.8 V2: the opponent's best three on each side (hover for ratings). */}
                <div className="space-y-2 border-t border-line px-4 py-3">
                  <TopPlayers teamId={opp.id} side="off" n={3} label="Their offense" />
                  <TopPlayers teamId={opp.id} side="def" n={3} label="Their defense" />
                </div>
                <div className="flex items-center justify-between border-t border-line bg-surface-2 px-4 py-2.5">
                  <span className="text-xs text-muted">Vegas line: {team.abbr} -3.5 · O/U 44.5</span>
                  <Button size="sm" variant="team" onClick={() => setScreen('schedule')}>
                    Game Plan <ChevronRight size={14} />
                  </Button>
                </div>
              </Card>

              {/* Keys + practice, promoted onto the dashboard for game week. */}
              <div className="grid gap-5 lg:grid-cols-2">
                <KeysCard oppId={opp.id} />
                <PracticeCard />
              </div>
            </>
          )}

          {/* Ratings */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-lg font-700 uppercase tracking-wide">Unit Grades</h3>
              <Badge tone="team">Scheme: {league.staff[activeTeamId]?.[0]?.scheme ?? 'Balanced'}</Badge>
            </div>
            <div className="flex items-center gap-4">
              <div className="shrink-0 text-center" title="Team overall (average of the starters)">
                <OvrBadge value={Math.round(ovr)} size={52} />
                <div className="mt-1 font-cond text-[10px] font-700 uppercase tracking-wide text-muted">Overall</div>
              </div>
              <div className="min-w-0 flex-1">
                <MiniBars
                  items={[
                    { label: 'OFF', value: off, color: 'var(--team)' },
                    { label: 'DEF', value: def, color: '#0b62ff' },
                    { label: 'ST', value: stRating, color: '#c99a2e' },
                  ]}
                />
              </div>
            </div>
            {isNFL && <PositionGrades teamId={activeTeamId} />}
          </Card>

          {/* Culture / cohesion */}
          <CulturePanel teamId={activeTeamId} />

          {/* Your Room (G3) — coaching rungs below HC */}
          {hasRoom(career) && <RoomCard />}

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
                  <OvrBadge value={p.ovr} pot={p.pot} size={30} />
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
                      <TeamHoverCard team={t} className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-3">
                          <TeamCrest team={t} size={24} />
                          <span className="flex-1 truncate font-cond text-sm font-600 text-ink">{t.name}</span>
                        </span>
                      </TeamHoverCard>
                      <span className="font-display text-base font-700 tnum text-ink-2">
                        {r.wins}-{r.losses}
                      </span>
                    </div>
                  ))}
              </div>
            </Card>
          )}

          <Card>
            <h3 className="mb-3 font-display text-lg font-700 uppercase tracking-wide">Era & Mandate</h3>
            <div className="mb-2 flex items-center gap-2">
              <Badge tone="gold">{league.era?.label ?? 'Modern Era'}</Badge>
              <span className="text-xs text-muted">{ownerPersonalityLabel(ownerPersonality(activeTeamId))} owner</span>
            </div>
            <p className="text-xs leading-relaxed text-muted">{career.ownerExpectation}</p>
            <p className="mt-2 text-[11px] leading-snug text-faint">
              The league's market drifts by era — positions rise and fall in value. Build into the drift.
            </p>
          </Card>

          <Card>
            <h3 className="mb-3 font-display text-lg font-700 uppercase tracking-wide">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { label: 'Depth Chart', screen: 'depth' },
                  { label: 'Staff Hiring', screen: 'staff' },
                  { label: 'Trade Center', screen: 'trades' },
                  { label: 'Salary Cap', screen: 'cap' },
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

// User request (2026-10-08): every position group's grade beside OFF / DEF / ST,
// with its league rank. A group's grade is the average OVR of its starters on the
// depth chart (healthy players first), the same slice the sim fields.
const POSITION_GROUPS: { label: string; positions: Position[]; n: number }[] = [
  { label: 'QB', positions: ['QB'], n: 1 },
  { label: 'RB', positions: ['RB'], n: 1 },
  { label: 'FB', positions: ['FB'], n: 1 },
  { label: 'WR', positions: ['WR'], n: 3 },
  { label: 'TE', positions: ['TE'], n: 1 },
  { label: 'OL', positions: ['OT', 'OG', 'C'], n: 5 },
  { label: 'DL', positions: ['DE', 'DT'], n: 4 },
  { label: 'LB', positions: ['LB'], n: 3 },
  { label: 'CB', positions: ['CB'], n: 3 },
  { label: 'S', positions: ['S'], n: 2 },
  { label: 'K/P', positions: ['K', 'P'], n: 2 },
]

function groupGrade(world: World, teamId: string, g: (typeof POSITION_GROUPS)[number]): number {
  const list = depthGroup(world, teamId, g.positions, g.n)
  return list.length ? list.reduce((s, p) => s + p.ovr, 0) / list.length : 0
}

function PositionGrades({ teamId }: { teamId: string }) {
  const world = useWorld()
  const tick = useGame((s) => s.tick)
  const rows = useMemo(() => {
    void tick
    const clubs = world.teams.filter((t) => t.tier === 'NFL').map((t) => t.id)
    return POSITION_GROUPS.map((g) => {
      const all = clubs.map((id) => ({ id, v: groupGrade(world, id, g) })).sort((a, b) => b.v - a.v)
      const mine = all.find((x) => x.id === teamId)
      return { label: g.label, value: Math.round(mine?.v ?? 0), rank: all.findIndex((x) => x.id === teamId) + 1 }
    })
  }, [world, teamId, tick])
  return (
    <div className="mt-4 grid grid-cols-5 gap-2 border-t border-line pt-3">
      {rows.map((r) => {
        const c = gradeColor(r.value)
        return (
          <div key={r.label} className="flex flex-col items-center gap-1 rounded-lg bg-surface-2 px-1 py-2" title={`${r.label}: ${r.value} — ranked ${r.rank} of 32`}>
            <span className="font-cond text-[10px] font-700 uppercase tracking-wide text-muted">{r.label}</span>
            <span className="grid h-8 w-9 place-items-center rounded-md font-display text-sm font-700 tnum" style={{ background: c, color: inkOn(c) }}>{r.value}</span>
            <span className={cn('font-cond text-[10px] font-700 tnum', r.rank <= 8 ? 'text-win' : r.rank >= 25 ? 'text-loss' : 'text-muted')}>#{r.rank}</span>
          </div>
        )
      })}
    </div>
  )
}

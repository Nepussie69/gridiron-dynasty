import { ArrowRight, ChevronRight } from 'lucide-react'
import { useMemo } from 'react'
import { ordinal, signed } from '../lib/format'
import { depthGroup } from '../game/engine/depth'
import { type World } from '../game/engine/generate'
import { winProjection } from '../game/engine/analytics'
import type { Position } from '../game/types'
import { NFL_TEAMS } from '../game/data/nflTeams'
import {
  defenseRating,
  offenseRating,
  positionNeeds,
  recordOf,
  recordStr,
  rosterOf,
  scheduleFor,
  teamAvgOvr,
} from '../game/selectors'
import { useGame, useWorld } from '../store/gameStore'
import { overallRep } from '../game/engine/career'
import { rivalTitle } from '../game/engine/people'
import { ownerFiringLine, ownerName, ownerPersonalityLabel, ownerProfile } from '../game/engine/owner'
import { rivalFor } from '../game/engine/rivalry'
import { hasRoom } from '../game/engine/room'
import { advanceLabel, canCoach as canCoachNow, stageOf } from '../ui/nav'
import {
  Badge,
  Button,
  Card,
  KpiStrip,
  KpiTile,
  OvrBadge,
  PageHeader,
  RatingBar,
  RatingTile,
  SchemeChip,
  ScoreBlock,
  TeamCrest,
  TierLegend,
  VerdictChip,
} from '../ui/kit'
import { OfficeScene } from '../components/OfficeScene'
import { KeysCard } from '../components/KeysCard'
import { PracticeCard } from '../components/PracticeCard'
import { ByeWeekCard } from '../components/ByeWeekCard'
import { OwnerMeetingCard } from '../components/OwnerMeetingCard'
import { RoomCard } from '../components/RoomCard'
import { WeeklyChecklist } from '../components/WeeklyChecklist'
import { WeeklyDecision } from '../components/WeeklyDecision'
import { CulturePanel } from '../components/CulturePanel'
import { TopPlayers } from '../components/TopPlayers'
import { TeamHoverCard } from '../components/TeamHoverCard'
import { liveSchemes } from '../components/staffEffects'

export function Dashboard() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const career = useGame((s) => s.career)!
  const setScreen = useGame((s) => s.setScreen)
  const viewTeam = useGame((s) => s.viewTeam)
  const selectPlayer = useGame((s) => s.selectPlayer)
  const gameDay = useGame((s) => s.gameDay)
  const advanceWeek = useGame((s) => s.advanceWeek)
  const advanceStage = useGame((s) => s.advanceStage)
  const startGameDay = useGame((s) => s.startGameDay)

  const team = league.byId[activeTeamId]
  const roster = rosterOf(league, activeTeamId)
  const rec = recordOf(league, activeTeamId)
  const isNFL = team.tier === 'NFL'

  const off = offenseRating(roster)
  const def = defenseRating(roster)
  const st = roster.filter((p) => p.side === 'ST')
  const stRating = st.length ? st.reduce((s, p) => s + p.ovr, 0) / st.length : 0
  const ovr = teamAvgOvr(roster)
  const live = liveSchemes(league.staff[activeTeamId] ?? [])
  const staff = league.staff[activeTeamId] ?? []
  const hasOC = staff.some((m) => m.role === 'Offensive Coordinator')
  const hasDC = staff.some((m) => m.role === 'Defensive Coordinator')

  const needs = isNFL ? positionNeeds(league, activeTeamId, NFL_TEAMS).slice(0, 6) : []
  const { out: schedule } = scheduleFor(league, activeTeamId)
  const next = schedule.find((g) => g.week >= career.week)
  const opp = next ? league.byId[next.opponentId] : null
  const rival = opp ? rivalFor(league, opp.id) : undefined

  // U4: a broadcast-style win probability for the hero card. Reads the same
  // strength model the ghost-GM projection uses (home field worth ~0.5).
  // FUTURES 19: with analysts hired, winProjection() blends in the form model
  // and reports a confidence band — display only, the sim is unchanged.
  const wp =
    next && opp
      ? winProjection(league, activeTeamId, opp.id, next.home)
      : { base: 0.5, value: 0.5, margin: 0.16, confidence: 'low' as const, sharp: false, factors: [] }
  const winProb = wp.value

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

  const coachable = canCoachNow(league, career, !!gameDay)
  const advance = () => (stageOf(league) ? advanceStage() : void advanceWeek())

  const rep = overallRep(career.reputation)

  return (
    <div>
      <PageHeader
        eyebrow="Career"
        title="Front Office"
        subtitle={career.ownerExpectation}
        right={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setScreen('roster')}>
              Manage Roster
            </Button>
            <Button variant="secondary" onClick={() => setScreen('draft')} icon={<ArrowRight size={15} aria-hidden />}>
              Draft Board
            </Button>
          </div>
        }
      />

      <OfficeScene className="mb-4" />

      <KpiStrip label="Club standing" className="mb-4">
        <KpiTile
          label="Reputation"
          value={rep}
          unit="/ 100"
          verdict={{ label: career.path === 'coach' ? 'Coaching track' : 'Personnel track', tone: 'neutral' }}
          why={<span className="text-muted">Five pillars: evaluation, roster, leadership, results, profile.</span>}
        />
        <KpiTile
          label="Prestige"
          value={team.prestige}
          unit="/ 100"
          why={
            <span className="text-muted">
              How the league rates the {team.tier === 'NFL' ? `${team.conference} ${team.division}` : team.conference} club.
            </span>
          }
        />
        {isNFL && (
          <KpiTile
            label="Division"
            value={ordinal(rank)}
            unit="in division"
            why={
              <span className="text-muted">
                {team.conference} {team.division} · sorted by wins
              </span>
            }
          />
        )}
      </KpiStrip>

      <WeeklyDecision className="mb-4" />
      <ByeWeekCard className="mb-4" />
      <OwnerMeetingCard compact className="mb-4" />

      {/* Next game — the broadcast matchup hero. */}
      {next && opp && (
        <>
          {/* L9 Z5: a rivalry week against a rival's club. */}
          {rival && (
            <Card className="mb-4 border-gold/60 bg-gold/10">
              <div className="font-cond text-body font-700 uppercase leading-snug text-ink">
                Rivalry week: {rival.name} ({rivalTitle(rival)}) and the {opp.name}
              </div>
            </Card>
          )}

          <Card pad={false} className="mb-4 overflow-hidden">
            <div className="hatch flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
              <div className="label">Up Next · Week {next.week}</div>
              <div className="label">{next.home ? `Home · ${team.stadium}` : `Away · ${opp.stadium}`}</div>
            </div>

            <div className="grid items-center gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
              <TeamHoverCard team={team} info>
                <button type="button" onClick={() => viewTeam(team.id)} className="block w-full text-left" title={`Open the ${team.name}`}>
                  <ScoreBlock
                    team={{ abbr: team.abbr || team.name.slice(0, 3), primary: team.primary, name: team.name, city: team.city }}
                    sub={recordStr(rec)}
                    size="lg"
                    className="w-full"
                  />
                </button>
              </TeamHoverCard>

              <div className="flex flex-col items-center gap-0.5 text-center">
                <span className="font-cond text-label font-700 uppercase tracking-[0.07em] text-muted">{next.home ? 'vs' : '@'}</span>
                <span className="whitespace-nowrap font-cond text-small font-700 uppercase tracking-[0.06em] text-ink">WK {next.week}</span>
              </div>

              <TeamHoverCard team={opp} info>
                <button type="button" onClick={() => viewTeam(opp.id)} className="block w-full text-right" title={`Open the ${opp.name}`}>
                  <ScoreBlock
                    team={{ abbr: opp.abbr || opp.name.slice(0, 3), primary: opp.primary, name: opp.name, city: opp.city }}
                    sub={recordStr(recordOf(league, opp.id))}
                    size="lg"
                    align="right"
                    className="w-full"
                  />
                </button>
              </TeamHoverCard>
            </div>

            {/* Win probability */}
            <div className="border-t border-line px-4 py-3">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="label flex items-center gap-1.5">
                  Win probability
                  {wp.sharp && <Badge tone="neutral">Analytics</Badge>}
                </span>
                <span className="font-cond text-label tnum text-muted">
                  {team.abbr || team.name} {Math.round(winProb * 100)}%
                  {wp.sharp && <span className="text-faint"> ±{Math.round(wp.margin * 100)}</span>} ·{' '}
                  {opp.abbr || opp.name} {Math.round((1 - winProb) * 100)}%
                </span>
              </div>
              <div
                role="meter"
                aria-label={`Win probability: ${team.abbr || team.name} ${Math.round(winProb * 100)}%`}
                aria-valuenow={Math.round(winProb * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                className="flex h-2.5 overflow-hidden rounded-full bg-surface-3"
              >
                <span className="transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${winProb * 100}%`, background: 'var(--team-accent)' }} />
                <span className="flex-1 bg-line-strong" />
              </div>
              {wp.sharp && wp.factors.length > 0 && (
                <div className="mt-1 text-label text-faint">
                  Model: {wp.factors.join(' · ')} · {wp.confidence} confidence
                </div>
              )}
            </div>

            {/* L12.8 V2: the opponent's best three on each side (hover for ratings). */}
            <div className="space-y-2 border-t border-line px-4 py-3">
              <TopPlayers teamId={opp.id} side="off" n={3} label="Their offense" />
              <TopPlayers teamId={opp.id} side="def" n={3} label="Their defense" />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2 px-4 py-2.5">
              <Button size="sm" variant="quiet" onClick={() => setScreen('gameplan')} icon={<ChevronRight size={14} aria-hidden />}>
                Game Plan
              </Button>
              <Button variant="slab" onClick={() => (coachable ? startGameDay() : advance())}>
                {coachable ? 'Coach the game' : advanceLabel(league)}
              </Button>
            </div>
          </Card>

          {/* Keys + practice, promoted onto the dashboard for game week. */}
          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <KeysCard oppId={opp.id} />
            <PracticeCard />
          </div>
        </>
      )}

      <WeeklyChecklist className="mb-5" />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          {/* Unit grades — a rating tile per unit with the scheme that drives it. */}
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em]">Unit Grades</h3>
              <TierLegend />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <UnitTile label="Overall" value={Math.round(ovr)} hint="Top-22 weighted" />
              <UnitTile
                label="Offense"
                value={Math.round(off)}
                scheme={live.off?.scheme ?? null}
                schemeState="live"
                hint={hasOC ? `Called by OC ${live.off?.name?.split(' ').slice(-1)[0] ?? ''}` : 'No offensive coordinator — league-average until hired'}
                warn={!hasOC}
              />
              <UnitTile
                label="Defense"
                value={Math.round(def)}
                scheme={live.def?.scheme ?? null}
                schemeState="live"
                hint={hasDC ? `Called by DC ${live.def?.name?.split(' ').slice(-1)[0] ?? ''}` : 'No defensive coordinator — league-average until hired'}
                warn={!hasDC}
              />
              <UnitTile label="Special teams" value={Math.round(stRating)} scheme={null} hint="No scheme in the sim" />
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
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em]">Positional Needs</h3>
                <span className="text-label text-muted">Grade vs. league average</span>
              </div>
              <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {needs.map((n) => (
                  <div key={n.pos} className="flex items-center gap-2">
                    <span className="w-8 font-cond text-label font-700 uppercase tracking-[0.06em] text-muted">{n.pos}</span>
                    <div className="flex-1">
                      <RatingBar value={Math.round(n.mine)} tone="tier" />
                    </div>
                    <span className="w-8 text-right font-cond text-label font-700 tnum text-ink-2">{Math.round(n.mine)}</span>
                    <span className="w-14 text-right font-cond text-label tnum text-muted">{signed(n.gap, 1)} vs avg</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Stars */}
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em]">Cornerstones</h3>
              <Button size="sm" variant="quiet" onClick={() => setScreen('roster')} icon={<ChevronRight size={14} aria-hidden />}>
                Full Roster
              </Button>
            </div>
            <div className="space-y-1">
              {stars.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectPlayer(p.id)}
                  className="motion flex min-h-11 w-full items-center gap-3 rounded-[var(--r-md)] px-2 py-1.5 text-left hover:bg-surface-2"
                >
                  <OvrBadge value={p.ovr} pot={p.pot} size={30} />
                  <span className="w-8 font-cond text-label font-700 uppercase tracking-[0.06em] text-muted">{p.pos}</span>
                  <span className="flex-1 truncate font-600 text-ink">{p.name}</span>
                  <span className="text-label text-muted">{p.college}</span>
                  <ChevronRight size={15} className="text-faint" aria-hidden />
                </button>
              ))}
            </div>
          </Card>
        </div>

        {/* Right column */}
        <div className="min-w-0 space-y-5">
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em]">Inbox</h3>
              <Button size="sm" variant="quiet" onClick={() => setScreen('inbox')}>
                View All
              </Button>
            </div>
            <div className="space-y-2.5">
              {news.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setScreen('inbox')}
                  className="motion flex w-full items-start gap-3 rounded-[var(--r-md)] border border-line p-2.5 text-left hover:border-line-strong hover:bg-surface-2"
                >
                  <Badge tone={n.category === 'Injury' ? 'loss' : 'neutral'}>{n.category}</Badge>
                  <div className="min-w-0">
                    <div className="text-body font-600 leading-snug text-ink">{n.headline}</div>
                    <div className="mt-0.5 line-clamp-2 text-small text-muted">{n.body}</div>
                  </div>
                </button>
              ))}
            </div>
          </Card>

          {isNFL && (
            <Card>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em]">
                  {team.conference} {team.division}
                </h3>
                <VerdictChip tone={rank === 1 ? 'win' : 'neutral'}>{ordinal(rank)}</VerdictChip>
              </div>
              <div className="space-y-1">
                {divTeams
                  .map((t) => ({ t, r: recordOf(league, t.id) }))
                  .sort((a, b) => b.r.wins - a.r.wins || a.r.losses - b.r.losses)
                  .map(({ t, r }) => (
                    <div
                      key={t.id}
                      className={
                        t.id === activeTeamId
                          ? 'flex items-center gap-3 rounded-[var(--r-md)] bg-[var(--team-tint)] px-2 py-1.5 shadow-[inset_3px_0_0_var(--team-accent)]'
                          : 'flex items-center gap-3 rounded-[var(--r-md)] px-2 py-1.5'
                      }
                    >
                      <TeamHoverCard team={t} className="min-w-0 flex-1" info>
                        <span className="flex min-w-0 items-center gap-3">
                          <TeamCrest team={t} size={24} />
                          <span className="flex-1 truncate font-cond text-body font-600 text-ink">{t.name}</span>
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
            <h3 className="mb-3 font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em]">Era &amp; Mandate</h3>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{league.era?.label ?? 'Modern Era'}</Badge>
              <span className="text-label text-muted">
                {ownerPersonalityLabel(ownerProfile(career.teamId).personality)} owner
              </span>
            </div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="truncate font-cond text-body font-700 uppercase text-ink">{ownerName(career.teamId)}</span>
              <span className="shrink-0 font-cond text-label uppercase tracking-[0.06em] text-faint">
                {ownerFiringLine(career.teamId) > 0
                  ? `Fired at ≤ ${ownerFiringLine(career.teamId)}% security`
                  : 'Never fires early'}
              </span>
            </div>
            <p className="text-small leading-relaxed text-muted">{career.ownerExpectation}</p>
            <p className="mt-2 text-label leading-snug text-faint">
              The league's market drifts by era — positions rise and fall in value. Build into the drift.
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}

/** One unit grade: a rating tile, the scheme that drives it, and its readout. */
function UnitTile({
  label,
  value,
  scheme = null,
  schemeState = 'live',
  hint,
  warn = false,
}: {
  label: string
  value: number
  scheme?: string | null
  schemeState?: 'live' | 'na'
  hint?: string
  warn?: boolean
}) {
  return (
    <div className="rounded-[var(--r-md)] border border-line bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="label">{label}</span>
        <RatingTile value={value} size="md" label={`${label} grade`} />
      </div>
      <div className="mt-2 min-h-[24px]">
        {scheme ? (
          <SchemeChip scheme={scheme} state={schemeState} />
        ) : (
          <span className="font-cond text-label font-700 uppercase tracking-[0.06em] text-muted">No scheme in sim</span>
        )}
      </div>
      {hint && <p className={`mt-1.5 text-label leading-snug ${warn ? 'text-warn' : 'text-muted'}`}>{hint}</p>}
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
    <div className="mt-4 grid grid-cols-4 gap-2 border-t border-line pt-3 sm:grid-cols-6 lg:grid-cols-11">
      {rows.map((r) => (
        <div
          key={r.label}
          className="flex flex-col items-center gap-1 rounded-[var(--r-md)] bg-surface-2 px-1 py-2"
          title={`${r.label}: ${r.value} — ranked ${r.rank} of 32`}
        >
          <span className="font-cond text-label font-700 uppercase tracking-[0.06em] text-muted">{r.label}</span>
          <RatingTile value={r.value} size="sm" label={`${r.label} group grade`} />
          <span className={`font-cond text-label font-700 tnum ${r.rank <= 8 ? 'text-win' : r.rank >= 25 ? 'text-loss' : 'text-muted'}`}>
            #{r.rank}
          </span>
        </div>
      ))}
    </div>
  )
}

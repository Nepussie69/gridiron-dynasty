import { useState } from 'react'
import { Play, SkipForward } from 'lucide-react'
import { cn } from '../lib/cn'
import { recordOf, recordStr, scheduleFor } from '../game/selectors'
import { useGame, useWorld } from '../store/gameStore'
import { BoxScore } from '../components/MatchView'
import { TeamHoverCard } from '../components/TeamHoverCard'
import type { Team } from '../game/types'
import {
  Badge,
  Button,
  Card,
  Dialog,
  KpiStrip,
  KpiTile,
  PageHeader,
  ScoreBlock,
  VerdictChip,
  type ScoreTeam,
} from '../ui/kit'
import { canCoach as canCoachNow } from '../ui/nav'

/** A ScoreBlock team from the world's club. */
function scoreTeam(t: Team): ScoreTeam {
  return { abbr: t.abbr || t.name.slice(0, 3), primary: t.primary, name: t.name, city: t.city }
}

export function Schedule() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const career = useGame((s) => s.career)
  const openMatch = useGame((s) => s.openMatch)
  const viewTeam = useGame((s) => s.viewTeam)
  const setScreen = useGame((s) => s.setScreen)
  const gameDay = useGame((s) => s.gameDay)
  const startGameDay = useGame((s) => s.startGameDay)
  const advanceWeek = useGame((s) => s.advanceWeek)
  const [boxGameId, setBoxGameId] = useState<string | null>(null)

  const rec = recordOf(league, activeTeamId)
  const { out: games } = scheduleFor(league, activeTeamId)
  const boxGame = boxGameId ? league.schedule.find((g) => g.id === boxGameId) : null
  const team = league.byId[activeTeamId]

  // PPG / PA per game actually played (was dividing by a hard-coded 17).
  const played = rec.wins + rec.losses + rec.ties
  const ppg = played ? rec.pointsFor / played : 0
  const papg = played ? rec.pointsAgainst / played : 0
  const nextWeek = games.find((g) => !g.played)?.week
  const coachable = canCoachNow(league, career, !!gameDay)

  let w = 0
  let l = 0

  return (
    <div>
      <PageHeader
        eyebrow="Team"
        title="Schedule & Results"
        subtitle="Every game is a referendum on the roster you helped build."
      />

      <KpiStrip label="Season scoring" className="mb-4">
        <KpiTile
          label="Points / game"
          value={ppg.toFixed(1)}
          unit="scored"
          why={
            <span className="text-muted">
              <b className="font-600 text-ink tnum">{rec.pointsFor}</b> points in {played} game
              {played === 1 ? '' : 's'} played
            </span>
          }
        />
        <KpiTile
          label="Points allowed"
          value={papg.toFixed(1)}
          unit="per game"
          verdict={{ label: ppg >= papg ? 'Scoring edge' : 'Scoring deficit', tone: ppg >= papg ? 'win' : 'loss' }}
          why={
            <span className="text-muted">
              <b className="font-600 text-ink tnum">{rec.pointsAgainst}</b> conceded · margin{' '}
              <b className="font-600 text-ink tnum">
                {rec.pointsFor - rec.pointsAgainst >= 0 ? '+' : '−'}
                {Math.abs(rec.pointsFor - rec.pointsAgainst)}
              </b>
            </span>
          }
        />
        <KpiTile
          label="Streak"
          value={`${Math.abs(rec.streak)}${rec.streak >= 0 ? 'W' : 'L'}`}
          unit={rec.streak >= 0 ? 'winning' : 'losing'}
          verdict={{
            label: rec.streak >= 0 ? 'Rolling' : 'Sliding',
            tone: rec.streak > 0 ? 'win' : rec.streak < 0 ? 'loss' : 'neutral',
          }}
          why={
            <span className="text-muted">
              <span className="sm:hidden">
                {rec.pointsFor} scored · {rec.pointsAgainst} allowed
              </span>
              <span className="max-sm:hidden">Run of form entering the week's game.</span>
            </span>
          }
        />
      </KpiStrip>

      <Card pad={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <span className="label">Regular season</span>
          <span className="label text-muted">{recordStr(rec)} on the year</span>
        </div>
        <div className="divide-y divide-line/60">
          {games.map((g) => {
            const opp = league.byId[g.opponentId]
            const raw = league.schedule.find((x) => x.id === g.id)
            if (g.played) {
              if ((g.teamScore ?? 0) > (g.oppScore ?? 0)) w++
              else if ((g.teamScore ?? 0) < (g.oppScore ?? 0)) l++
            }
            const running = `${w}-${l}`
            const isNext = !g.played && g.week === nextWeek
            const win = g.played && (g.teamScore ?? 0) > (g.oppScore ?? 0)
            const tie = g.played && g.teamScore === g.oppScore
            return (
              <div
                key={g.week}
                className={cn(
                  'flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:flex-nowrap',
                  isNext && 'bg-[var(--team-tint)] shadow-[inset_3px_0_0_var(--team-accent)]',
                )}
              >
                <div className="w-14 shrink-0">
                  <div className="label">Week {g.week}</div>
                  <div className="label !normal-case text-muted">{g.home ? 'Home' : 'Away'}</div>
                </div>
                <TeamHoverCard team={opp} className="min-w-0 flex-1" info>
                  <button
                    type="button"
                    onClick={() => viewTeam(opp.id)}
                    title={`View the ${opp.name}`}
                    className="motion flex min-h-11 min-w-0 items-center gap-2.5 rounded-[var(--r-sm)] text-left hover:opacity-80"
                  >
                    <ScoreBlock team={scoreTeam(opp)} sub={g.home ? 'vs' : '@'} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate font-cond text-body font-600 text-ink">
                        {opp.tier === 'NFL' ? `${opp.city} ${opp.name}` : opp.name}
                      </span>
                      <span className="block truncate text-label text-muted">
                        {g.home ? 'Home' : 'Away'} · {recordStr(recordOf(league, opp.id))}
                      </span>
                    </span>
                    {isNext && <Badge tone="neutral">Up next</Badge>}
                  </button>
                </TeamHoverCard>

                {g.played ? (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <ScoreBlock team={scoreTeam(team)} score={g.teamScore ?? 0} size="sm" />
                    <ScoreBlock team={scoreTeam(opp)} score={g.oppScore ?? 0} size="sm" />
                    <VerdictChip tone={tie ? 'neutral' : win ? 'win' : 'loss'}>{tie ? 'Tie' : win ? 'Win' : 'Loss'}</VerdictChip>
                    <span className="w-10 text-right font-cond text-label font-600 tnum text-muted">{running}</span>
                    {raw?.box && (
                      <Button size="sm" variant="secondary" onClick={() => setBoxGameId(g.id)}>
                        Box
                      </Button>
                    )}
                    <Button size="sm" variant="quiet" onClick={() => openMatch(g.id)}>
                      Replay
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {isNext ? (
                      <>
                        <Button
                          variant="slab"
                          size="sm"
                          icon={<Play size={13} aria-hidden />}
                          onClick={() => (coachable ? startGameDay() : setScreen('gameplan'))}
                        >
                          {coachable ? 'Coach' : 'Game plan'}
                        </Button>
                        <Button variant="secondary" size="sm" icon={<SkipForward size={13} aria-hidden />} onClick={() => void advanceWeek()}>
                          Sim
                        </Button>
                      </>
                    ) : (
                      <Badge tone="neutral">Scheduled</Badge>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="border-t border-line px-4 py-2 text-label text-muted">
          Replays re-simulate the game from its seed, so a replay can differ from the recorded final. Box scores are the
          recorded result.
        </div>
      </Card>

      <Dialog
        open={!!boxGame?.box}
        onClose={() => setBoxGameId(null)}
        eyebrow={`Box score · Week ${boxGame?.week ?? ''}`}
        title={boxGame ? `${league.byId[boxGame.awayId].name} at ${league.byId[boxGame.homeId].name}` : ''}
        subtitle={
          boxGame
            ? `Final ${boxGame.awayScore ?? 0}–${boxGame.homeScore ?? 0} · ${recordStr(recordOf(league, boxGame.awayId))} / ${recordStr(recordOf(league, boxGame.homeId))}`
            : undefined
        }
        size="lg"
      >
        {boxGame?.box && (
          <div className="broadcast rounded-[var(--r-lg)] border border-line bg-canvas p-3">
            {boxGame.film && (
              <div className="mb-3 text-small text-ink-2">
                Film grade: <strong className="font-700 text-ink">{boxGame.film.letter}</strong>
                <span className="text-muted"> ({boxGame.film.grade}/100)</span>
                {boxGame.film.lines.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {boxGame.film.lines.map((line, i) => (
                      <li key={i} className="text-label text-muted">
                        • {line}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <TeamTotals name={league.byId[boxGame.awayId].name} t={boxGame.box.team[boxGame.awayId] ?? EMPTY_TOTALS} />
              <TeamTotals name={league.byId[boxGame.homeId].name} t={boxGame.box.team[boxGame.homeId] ?? EMPTY_TOTALS} />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <BoxScore world={league} teamId={boxGame.awayId} box={boxGame.box.players} onTeamClick={viewTeam} />
              <BoxScore world={league} teamId={boxGame.homeId} box={boxGame.box.players} onTeamClick={viewTeam} />
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}

const EMPTY_TOTALS = { passYds: 0, rushYds: 0, turnovers: 0, sacks: 0 }

function TeamTotals({
  name,
  t,
}: {
  name: string
  t: { passYds: number; rushYds: number; turnovers: number; sacks: number }
}) {
  const cells: [string, number][] = [
    ['Pass yds', t.passYds],
    ['Rush yds', t.rushYds],
    ['Turnovers', t.turnovers],
    ['Sacks', t.sacks],
  ]
  return (
    <div className="rounded-[var(--r-md)] border border-line bg-surface-2 p-2.5">
      <div className="label mb-1.5 truncate">{name}</div>
      <div className="grid grid-cols-4 gap-2">
        {cells.map(([label, value]) => (
          <div key={label}>
            <div className="font-display text-base font-700 tnum text-ink">{value}</div>
            <div className="label">{label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '../lib/cn'
import { recordOf, recordStr, scheduleFor } from '../game/selectors'
import { useGame, useWorld } from '../store/gameStore'
import { BoxScore } from '../components/MatchView'
import { Badge, Button, Card, PageHeader, Stat, TeamCrest } from '../ui/kit'

export function Schedule() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const openMatch = useGame((s) => s.openMatch)
  const [boxGameId, setBoxGameId] = useState<string | null>(null)

  const rec = recordOf(league, activeTeamId)
  const { out: games } = scheduleFor(league, activeTeamId)
  const boxGame = boxGameId ? league.schedule.find((g) => g.id === boxGameId) : null

  let w = 0
  let l = 0
  const nextWeek = games.find((g) => !g.played)?.week
  const totalGames = 17

  return (
    <div>
      <PageHeader
        eyebrow={`Season ${league.season} · Week ${league.week}`}
        title="Schedule & Results"
        subtitle="Every game is a referendum on the roster you helped build."
        right={<Badge tone={rec.wins >= rec.losses ? 'win' : 'loss'}>{recordStr(rec)} on the season</Badge>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><Stat label="Record" value={recordStr(rec)} sub="current" /></Card>
        <Card><Stat label="Points/Game" value={(rec.pointsFor / totalGames).toFixed(1)} sub={`${rec.pointsFor} total`} /></Card>
        <Card><Stat label="Points Allowed" value={(rec.pointsAgainst / totalGames).toFixed(1)} sub={`${rec.pointsAgainst} total`} tone={rec.pointsAgainst > rec.pointsFor ? 'loss' : 'win'} /></Card>
        <Card><Stat label="Streak" value={`${Math.abs(rec.streak)}${rec.streak >= 0 ? 'W' : 'L'}`} sub={rec.streak >= 0 ? 'winning' : 'losing'} tone={rec.streak >= 0 ? 'win' : 'loss'} /></Card>
      </div>

      <Card pad={false}>
        <div className="border-b border-line px-4 py-2.5">
          <span className="label">Regular Season</span>
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
              <div key={g.week} className={cn('flex items-center gap-4 px-4 py-2.5', isNext && 'bg-[var(--team-soft)]')}>
                <div className="w-14 shrink-0">
                  <div className="label">Week {g.week}</div>
                </div>
                <div className="w-10 shrink-0 font-cond text-xs font-700 uppercase text-muted">{g.home ? 'vs' : '@'}</div>
                <div className="flex flex-1 items-center gap-2.5">
                  <TeamCrest team={opp} size={28} />
                  <span className="font-cond text-sm font-600 text-ink">
                    {opp.tier === 'NFL' ? `${opp.city} ${opp.name}` : opp.name}
                  </span>
                  {isNext && <Badge tone="team">Up Next</Badge>}
                </div>

                {g.played ? (
                  <div className="flex items-center gap-3">
                    <span className={cn('font-display text-lg font-700 tnum', tie ? 'text-muted' : win ? 'text-win' : 'text-loss')}>
                      {g.teamScore}-{g.oppScore}
                    </span>
                    <Badge tone={tie ? 'neutral' : win ? 'win' : 'loss'}>{tie ? 'T' : win ? 'W' : 'L'}</Badge>
                    <span className="w-12 text-right font-cond text-xs font-600 tnum text-muted">{running}</span>
                    {raw?.box && (
                      <Button size="sm" variant="ghost" onClick={() => setBoxGameId(g.id)}>Box</Button>
                    )}
                    <Button size="sm" variant="ghost" title="Re-simulated — may differ from the final." onClick={() => openMatch(g.id)}>Replay</Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <Badge tone="neutral">Scheduled</Badge>
                    <span className="w-12" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      {boxGame?.box && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4 backdrop-blur-sm"
          onClick={() => setBoxGameId(null)}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-[720px] overflow-y-auto rounded-2xl border border-line bg-canvas p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setBoxGameId(null)}
              className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-lg bg-surface-2 text-muted hover:text-ink"
            >
              <X size={16} />
            </button>
            <div className="mb-3">
              <span className="label">Box Score · Week {boxGame.week}</span>
              {boxGame.film && (
                <div className="mt-1.5 text-sm text-ink-2">
                  Film grade: <strong className="font-700 text-ink">{boxGame.film.letter}</strong>
                  <span className="text-muted"> ({boxGame.film.grade}/100)</span>
                  {boxGame.film.lines.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {boxGame.film.lines.map((l, i) => (
                        <li key={i} className="text-[11px] text-muted">• {l}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div className="mb-3 grid grid-cols-2 gap-3">
              <TeamTotals name={league.byId[boxGame.awayId].name} t={boxGame.box.team[boxGame.awayId] ?? EMPTY_TOTALS} />
              <TeamTotals name={league.byId[boxGame.homeId].name} t={boxGame.box.team[boxGame.homeId] ?? EMPTY_TOTALS} />
            </div>
            <div className="grid gap-3 rounded-xl bg-[#101820] p-3 md:grid-cols-2">
              <BoxScore world={league} teamId={boxGame.awayId} box={boxGame.box.players} />
              <BoxScore world={league} teamId={boxGame.homeId} box={boxGame.box.players} />
            </div>
          </div>
        </div>
      )}
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
    ['Pass Yds', t.passYds],
    ['Rush Yds', t.rushYds],
    ['Turnovers', t.turnovers],
    ['Sacks', t.sacks],
  ]
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-2.5">
      <div className="label mb-1.5 truncate">{name}</div>
      <div className="grid grid-cols-4 gap-2">
        {cells.map(([label, value]) => (
          <div key={label}>
            <div className="font-display text-base font-700 tnum text-ink">{value}</div>
            <div className="label !text-[9px]">{label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

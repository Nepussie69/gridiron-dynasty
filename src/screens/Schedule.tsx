import { cn } from '../lib/cn'
import { recordOf, recordStr, scheduleFor } from '../game/selectors'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card, PageHeader, Stat, TeamCrest } from '../ui/kit'

export function Schedule() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const openMatch = useGame((s) => s.openMatch)

  const rec = recordOf(league, activeTeamId)
  const { out: games } = scheduleFor(league, activeTeamId)

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
                    <Button size="sm" variant="ghost" onClick={() => openMatch(g.id)}>Watch</Button>
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
    </div>
  )
}

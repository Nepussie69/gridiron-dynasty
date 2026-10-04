import { cn } from '../lib/cn'
import { NFL_DIVISIONS } from '../game/data/nflTeams'
import { CFB_CONFERENCES } from '../game/data/cfbTeams'
import { recordOf } from '../game/selectors'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, PageHeader, TeamCrest } from '../ui/kit'

export function Standings() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const team = league.byId[activeTeamId]
  const isNFL = team.tier === 'NFL'

  if (isNFL) {
    const conferences = ['AFC', 'NFC']
    return (
      <div>
        <PageHeader
          eyebrow="League"
          title="Standings"
          subtitle="Division races, wild-card chases, and the road to the Super Bowl."
        />
        <div className="grid gap-5 xl:grid-cols-2">
          {conferences.map((conf) => (
            <div key={conf} className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="h-5 w-1.5 rounded-full" style={{ background: conf === 'AFC' ? '#dc2937' : '#0b62ff' }} />
                <h2 className="font-display text-2xl font-700 uppercase tracking-wide">{conf}</h2>
              </div>
              {Object.keys(NFL_DIVISIONS)
                .filter((k) => k.startsWith(conf))
                .map((div) => (
                  <DivisionTable key={div} div={div} activeTeamId={activeTeamId} />
                ))}
            </div>
          ))}
        </div>
      </div>
    )
  }

  // College: group by conference
  const confs = [...new Set(Object.keys(CFB_CONFERENCES))]
  return (
    <div>
      <PageHeader eyebrow="League" title="Conference Standings" subtitle={`${team.conference} and the national picture.`} />
      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        {confs.map((conf) => {
          const ids = CFB_CONFERENCES[conf]
          const rows = ids
            .map((id) => ({ t: league.byId[id], r: recordOf(league, id) }))
            .sort((a, b) => b.r.wins - a.r.wins || a.r.losses - b.r.losses)
          return (
            <Card key={conf} pad={false}>
              <div
                className="border-b border-line px-4 py-2.5"
                style={conf === team.conference ? { background: 'var(--team-soft)' } : undefined}
              >
                <span className="label">{conf}</span>
              </div>
              <div className="divide-y divide-line/60">
                {rows.map(({ t, r }, i) => (
                  <div
                    key={t.id}
                    className={cn('flex items-center gap-3 px-4 py-1.5', t.id === activeTeamId && 'bg-[var(--team-soft)]')}
                  >
                    <span className="w-4 font-cond text-xs font-700 text-faint">{i + 1}</span>
                    <TeamCrest team={t} size={22} />
                    <span className="flex-1 truncate font-cond text-sm font-600 text-ink">{t.name}</span>
                    <span className="font-display text-sm font-700 tnum text-ink-2">
                      {r.wins}-{r.losses}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function DivisionTable({ div, activeTeamId }: { div: string; activeTeamId: string }) {
  const league = useWorld()
  const rows = NFL_DIVISIONS[div]
    .map((id) => ({ t: league.byId[id], r: recordOf(league, id) }))
    .sort((a, b) => b.r.wins - a.r.wins || a.r.losses - b.r.losses)

  return (
    <Card pad={false}>
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="label">{div}</span>
        <span className="label">W-L · PF-PA</span>
      </div>
      <div className="divide-y divide-line/60">
        {rows.map(({ t, r }, i) => (
          <div
            key={t.id}
            className={cn('flex items-center gap-3 px-4 py-2', t.id === activeTeamId && 'bg-[var(--team-soft)]')}
          >
            <span className="grid h-5 w-5 place-items-center rounded font-cond text-[10px] font-700" style={i === 0 ? { background: 'var(--team)', color: 'var(--team-ink)' } : { background: '#eaf0f8', color: '#5c6f86' }}>
              {i + 1}
            </span>
            <TeamCrest team={t} size={24} />
            <span className="flex-1 truncate font-cond text-sm font-600 text-ink">
              {t.city} {t.name}
            </span>
            {i === 0 && <Badge tone="win">DIV</Badge>}
            <span className="font-display text-base font-700 tnum text-ink">
              {r.wins}-{r.losses}
            </span>
            <span className="w-16 text-right font-cond text-xs tnum text-muted">
              {r.pointsFor}-{r.pointsAgainst}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}

import { useState } from 'react'
import { Award, Trophy } from 'lucide-react'
import { cn } from '../lib/cn'
import { getAwards } from '../store/gameStore'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, PageHeader, TeamCrest } from '../ui/kit'
import type { AwardWinner, HofInductee, SeasonHonors } from '../game/engine/awards'

export function Awards() {
  const world = useWorld()
  const db = useGame((s) => s.statsDb)()
  void db
  const history = getAwards()
  const [tab, setTab] = useState<'honors' | 'hof'>('honors')

  const seasons = history.seasons.filter((s) => s.level === 'NFL').sort((a, b) => b.season - a.season)
  const current = seasons[0]

  return (
    <div>
      <PageHeader
        eyebrow="League"
        title="Awards & Hall of Fame"
        subtitle="MVPs, All-Pro teams, and the legends who built careers across your league."
        right={
          <div className="flex gap-2">
            <div className="flex rounded-lg bg-surface-2 p-0.5">
              {(['honors', 'hof'] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} className={cn('rounded-md px-3 py-1.5 font-cond text-xs font-700 uppercase transition', tab === t ? 'bg-white text-ink shadow-sm' : 'text-muted')}>
                  {t === 'honors' ? 'Season Honors' : 'Hall of Fame'}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {tab === 'honors' ? (
        !current ? (
          <Card className="py-12 text-center text-sm text-muted">
            No honors yet. Awards are selected from production at the end of each season.
          </Card>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <AwardCard winner={current.mvp} label="MVP" world={world} />
              <AwardCard winner={current.opoy} label="Offensive POY" world={world} />
              <AwardCard winner={current.dpoy} label="Defensive POY" world={world} />
              <AwardCard winner={current.oroy} label="Offensive ROY" world={world} />
              <AwardCard winner={current.droy} label="Defensive ROY" world={world} />
            </div>

            <AllProCard team={current.firstTeam} season={current.season} world={world} />
            <AllProCard team={current.secondTeam} season={current.season} world={world} />

            {seasons.length > 1 && (
              <Card>
                <h3 className="mb-3 font-display text-lg font-700 uppercase tracking-wide">Past MVPs</h3>
                <div className="space-y-1">
                  {seasons.slice(1).map((s) => (
                    <div key={s.season} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm">
                      <span className="w-12 font-cond font-700 text-muted">{s.season}</span>
                      <span className="flex-1 truncate font-600 text-ink">{s.mvp?.name ?? '—'}</span>
                      <span className="font-cond text-xs text-muted">{s.mvp?.team ?? ''}</span>
                      <span className="text-xs text-muted">{s.mvp?.value ?? ''}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )
      ) : (
        <HallOfFame history={history} world={world} />
      )}
    </div>
  )
}

function AwardCard({ winner, label, world }: { winner: AwardWinner | null; label: string; world: ReturnType<typeof useWorld> }) {
  if (!winner) {
    return (
      <Card>
        <div className="label mb-2">{label}</div>
        <div className="text-sm text-muted">Not awarded</div>
      </Card>
    )
  }
  const team = Object.values(world.byId).find((t) => t.name === winner.team)
  return (
    <Card className="relative overflow-hidden">
      <div className="label mb-2 flex items-center gap-1"><Award size={11} /> {label}</div>
      <div className="flex items-center gap-2">
        {team && <TeamCrest team={team} size={28} />}
        <div className="min-w-0">
          <div className="truncate font-display text-base font-700 uppercase leading-none text-ink">{winner.name}</div>
          <div className="font-cond text-[11px] text-muted">{winner.pos} · {winner.team}</div>
        </div>
      </div>
      <div className="mt-2 font-cond text-xs text-ink-2">{winner.value}</div>
    </Card>
  )
}

function AllProCard({ team, season, world }: { team: SeasonHonors['firstTeam']; season: number; world: ReturnType<typeof useWorld> }) {
  return (
    <Card pad={false}>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="label">{season} · {team.label}</span>
        <Badge tone="gold">All-Pro</Badge>
      </div>
      <div className="grid gap-4 p-4 md:grid-cols-2">
        <div>
          <div className="label mb-2">Offense</div>
          <div className="space-y-1">
            {team.offense.map((w, i) => (
              <AllProRow key={`${w.playerId}-${i}`} w={w} world={world} />
            ))}
          </div>
        </div>
        <div>
          <div className="label mb-2">Defense</div>
          <div className="space-y-1">
            {team.defense.map((w, i) => (
              <AllProRow key={`${w.playerId}-${i}`} w={w} world={world} />
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}

function AllProRow({ w, world }: { w: AwardWinner; world: ReturnType<typeof useWorld> }) {
  const team = Object.values(world.byId).find((t) => t.name === w.team)
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1 text-sm">
      <span className="w-8 font-cond text-[10px] font-700 uppercase text-muted">{w.pos}</span>
      <span className="flex-1 truncate font-600 text-ink">{w.name}</span>
      {team && <TeamCrest team={team} size={18} />}
    </div>
  )
}

function HallOfFame({ history, world }: { history: ReturnType<typeof getAwards>; world: ReturnType<typeof useWorld> }) {
  const hof = [...history.hof].sort((a, b) => b.score - a.score)
  if (!hof.length) {
    return (
      <Card className="py-12 text-center text-sm text-muted">
        The Hall of Fame is empty. Legends are enshrined once their careers meet the bar.
      </Card>
    )
  }
  return (
    <div className="space-y-3">
      <Card className="bg-surface-2">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Trophy size={16} className="text-gold" />
          <span>
            <strong className="text-ink">{hof.length}</strong> legends enshrined from your league's history.
          </span>
        </div>
      </Card>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {hof.map((ind) => (
          <HofCard key={ind.playerId} ind={ind} world={world} />
        ))}
      </div>
    </div>
  )
}

function HofCard({ ind, world }: { ind: HofInductee; world: ReturnType<typeof useWorld> }) {
  const world2 = Object.values(world.byId).find((t) => t.name === (ind as unknown as { team?: string }).team)
  void world2
  return (
    <Card className="border-[#ecd9a8] bg-[#fbf3de]">
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-[#9a7418] text-white">
          <Trophy size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-lg font-700 uppercase leading-none text-ink">{ind.name}</div>
          <div className="mt-1 font-cond text-xs text-muted">{ind.pos} · {ind.careerYears} seasons · HOF score {ind.score}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        {ind.passYds > 0 && <MiniStat label="Pass Yds" value={ind.passYds.toLocaleString()} />}
        {ind.rushYds > 0 && <MiniStat label="Rush Yds" value={ind.rushYds.toLocaleString()} />}
        {ind.recYds > 0 && <MiniStat label="Rec Yds" value={ind.recYds.toLocaleString()} />}
        {ind.sacks > 0 && <MiniStat label="Sacks" value={ind.sacks} />}
        {ind.ints > 0 && <MiniStat label="INT" value={ind.ints} />}
        <MiniStat label="TD" value={ind.totalTD} />
      </div>
      {(ind.titles > 0 || ind.awardCount > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ind.titles > 0 && <Badge tone="gold">{ind.titles}× Champion</Badge>}
          {ind.awardCount > 0 && <Badge tone="info">{ind.awardCount} awards</Badge>}
        </div>
      )}
    </Card>
  )
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-[#ecd9a8] py-1.5">
      <div className="label !text-[9px] !text-[#9a7418]">{label}</div>
      <div className="font-display text-base font-700 tnum text-ink">{value}</div>
    </div>
  )
}

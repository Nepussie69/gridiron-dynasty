import { useState } from 'react'
import { Activity, Award, ChevronDown, Trophy } from 'lucide-react'
import { cn } from '../lib/cn'
import { getAwards } from '../store/gameStore'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, PageHeader, TeamCrest } from '../ui/kit'
import { PlayerName } from '../components/PlayerHoverCard'
import { awardRace } from '../game/engine/awards'
import type { AwardRaceGroup, AwardWinner, HofClass, HofInductee, RaceCandidate, SeasonHonors } from '../game/engine/awards'
import type { CareerDatabase } from '../game/engine/statsDb'
import type { Player } from '../game/types'
import type { StaffAward } from '../game/engine/staffAwards'

export function Awards() {
  const world = useWorld()
  const db = useGame((s) => s.statsDb)()
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
                <button key={t} onClick={() => setTab(t)} className={cn('rounded-md px-3 py-1.5 font-cond text-xs font-700 uppercase transition', tab === t ? 'bg-surface text-ink shadow-sm' : 'text-muted')}>
                  {t === 'honors' ? 'Season Honors' : 'Hall of Fame'}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {tab === 'honors' ? (
        <div className="space-y-5">
          <AwardRaceCard world={world} db={db} history={history} />
          <StaffAwardsCard world={world} />
          {!current ? (
            <Card className="py-12 text-center text-sm text-muted">
              No honors yet. Awards are selected from production at the end of each season.
            </Card>
          ) : (
            <>
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
            </>
          )}
        </div>
      ) : (
        <HallOfFame history={history} world={world} />
      )}
    </div>
  )
}

function AwardRaceCard({
  world,
  db,
  history,
}: {
  world: ReturnType<typeof useWorld>
  db: CareerDatabase
  history: ReturnType<typeof getAwards>
}) {
  const race = awardRace(world, db, history)
  const players = new Map(world.players.map((p) => [p.id, p]))

  if (!race.started) {
    return (
      <Card className="flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
          <Activity size={18} />
        </div>
        <div className="min-w-0">
          <div className="font-display text-base font-700 uppercase leading-none text-ink">Award Race</div>
          <div className="mt-1 text-sm text-muted">Race starts after week 1.</div>
        </div>
      </Card>
    )
  }

  return (
    <Card pad={false}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <span className="label flex items-center gap-1">
          <Activity size={11} className="text-brand" /> Award Race — {race.season}
        </span>
        <span className="font-cond text-xs text-muted">live thru week {race.week}</span>
      </div>
      <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
        {race.groups.map((g) => (
          <RaceGroupCard key={g.award} group={g} players={players} world={world} />
        ))}
      </div>
    </Card>
  )
}

function RaceGroupCard({
  group,
  players,
  world,
}: {
  group: AwardRaceGroup
  players: Map<string, Player>
  world: ReturnType<typeof useWorld>
}) {
  const max = group.candidates.reduce((m, c) => Math.max(m, c.score), 1)
  return (
    <div className="rounded-xl border border-line bg-surface-2/40 p-3">
      <div className="label mb-2 flex items-center gap-1">
        {group.kind === 'staff' ? <Award size={11} /> : <Trophy size={11} className="text-gold" />} {group.award}
      </div>
      {group.candidates.length === 0 ? (
        <div className="py-1 text-xs text-muted">No qualifying candidates yet.</div>
      ) : (
        <div className="space-y-2.5">
          {group.candidates.map((c, i) => (
            <RaceRow key={`${c.playerId ?? c.name}-${i}`} c={c} rank={i + 1} max={max} players={players} world={world} />
          ))}
        </div>
      )}
    </div>
  )
}

function RaceRow({
  c,
  rank,
  max,
  players,
  world,
}: {
  c: RaceCandidate
  rank: number
  max: number
  players: Map<string, Player>
  world: ReturnType<typeof useWorld>
}) {
  const pct = Math.max(0, Math.min(100, (c.score / max) * 100))
  const team = world.byId[c.teamId]
  const player = c.playerId ? players.get(c.playerId) : undefined
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="w-3.5 shrink-0 text-center font-display text-xs font-700 tnum text-muted">{rank}</span>
        {team && <TeamCrest team={team} size={18} />}
        <div className="flex min-w-0 flex-1">
          {player ? (
            <PlayerName player={player} className="min-w-0 text-sm font-600 text-ink" />
          ) : (
            <span className="block truncate text-sm font-600 text-ink">{c.name}</span>
          )}
        </div>
        <span className="shrink-0 font-cond text-[10px] font-700 uppercase text-muted">{c.pos}</span>
        <span className="shrink-0 font-cond text-[11px] tnum text-muted">{c.record}</span>
      </div>
      <div className="mt-1 pl-5">
        <div className="flex items-center gap-2">
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
          </div>
          <span className="shrink-0 font-cond text-[10px] tnum text-ink-2">{c.score.toLocaleString()}</span>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted" title={c.value}>{c.value}</div>
      </div>
    </div>
  )
}

function StaffAwardsCard({ world }: { world: ReturnType<typeof useWorld> }) {
  const [open, setOpen] = useState(false)
  const all = world.staffAwards ?? []
  if (!all.length) {
    return (
      <Card className="py-8 text-center text-sm text-muted">
        No staff awards yet. The front office and coaching honours are named at the end of each season.
      </Card>
    )
  }
  const latestSeason = Math.max(...all.map((a) => a.season))
  const latest = all.filter((a) => a.season === latestSeason)
  const earlierSeasons = [...new Set(all.filter((a) => a.season < latestSeason).map((a) => a.season))].sort(
    (a, b) => b - a,
  )
  return (
    <Card pad={false}>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="label flex items-center gap-1">
          <Award size={11} /> Front Office &amp; Staff Awards
        </span>
        <span className="font-cond text-xs text-muted">{latestSeason}</span>
      </div>
      <div className="divide-y divide-line">
        {latest.map((a) => (
          <StaffAwardRow key={a.award} a={a} world={world} />
        ))}
      </div>
      {earlierSeasons.length > 0 && (
        <>
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-center gap-1 border-t border-line px-4 py-2 font-cond text-xs font-700 uppercase text-muted hover:text-ink"
          >
            {open ? 'Hide history' : `History (${earlierSeasons.length})`}
            <ChevronDown size={12} className={cn('transition', open && 'rotate-180')} />
          </button>
          {open &&
            earlierSeasons.map((season) => (
              <div key={season} className="border-t border-line px-4 py-2">
                <div className="label mb-1">{season}</div>
                {all
                  .filter((a) => a.season === season)
                  .map((a) => (
                    <StaffAwardRow key={`${season}_${a.award}`} a={a} world={world} compact />
                  ))}
              </div>
            ))}
        </>
      )}
    </Card>
  )
}

function StaffAwardRow({ a, world, compact }: { a: StaffAward; world: ReturnType<typeof useWorld>; compact?: boolean }) {
  const team = world.byId[a.teamId]
  return (
    <div className={cn('flex items-center gap-3', compact ? 'py-1' : 'px-4 py-2.5')}>
      <span className="w-40 shrink-0 font-cond text-[11px] font-700 uppercase text-muted">{a.award}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {team && <TeamCrest team={team} size={compact ? 18 : 22} />}
        <span className="truncate font-600 text-ink">{a.name}</span>
        <span className="font-cond text-[11px] text-muted">{team?.abbr ?? a.teamId}</span>
        {a.isUser && <Badge tone="gold">You</Badge>}
      </div>
      {!compact && <span className="hidden font-cond text-[11px] text-muted sm:block">{a.line}</span>}
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
  const career = useGame((s) => s.career)
  const ledgerIds = new Set((career?.ledger ?? []).map((e) => e.playerId).filter((x): x is string => !!x))
  const classes = [...(history.classes ?? [])].sort((a, b) => b.season - a.season)
  const hof = [...history.hof].sort((a, b) => b.score - a.score)

  if (!classes.length && !hof.length) {
    return (
      <Card className="py-12 text-center text-sm text-muted">
        The Hall of Fame is empty. Legends are enshrined once they retire, sit out three seasons, and meet the bar.
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
      {classes.length ? (
        classes.map((c) => <HofClassCard key={c.season} cls={c} ledgerIds={ledgerIds} />)
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {hof.map((ind) => (
            <HofCard key={ind.playerId} ind={ind} world={world} />
          ))}
        </div>
      )}
    </div>
  )
}

/** L12.16 H3: one year's class — the enshrined, the ballot, and who missed. */
function HofClassCard({
  cls,
  ledgerIds,
}: {
  cls: HofClass
  ledgerIds: Set<string>
}) {
  const [ballot, setBallot] = useState(false)
  const inductedIds = new Set(cls.inducted.map((i) => i.playerId))
  return (
    <Card pad={false}>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="label flex items-center gap-1">
          <Trophy size={11} className="text-gold" /> Class of {cls.season}
        </span>
        <span className="font-cond text-xs text-muted">
          {cls.inducted.length} enshrined · {cls.finalists.length} finalists
        </span>
      </div>
      <div className="divide-y divide-line">
        {cls.inducted.map((ind) => (
          <HofInducteeRow key={ind.playerId} ind={ind} yours={ledgerIds.has(ind.playerId)} />
        ))}
      </div>
      {cls.finalists.length > 0 && (
        <>
          <button
            onClick={() => setBallot((v) => !v)}
            className="flex w-full items-center justify-center gap-1 border-t border-line px-4 py-2 font-cond text-xs font-700 uppercase text-muted hover:text-ink"
          >
            {ballot ? 'Hide ballot' : `Ballot — ${cls.finalists.length} finalists`}
            <ChevronDown size={12} className={cn('transition', ballot && 'rotate-180')} />
          </button>
          {ballot && (
            <div className="divide-y divide-line border-t border-line">
              {cls.finalists.map((f) => (
                <div key={f.playerId} className="flex items-center gap-3 px-4 py-1.5 text-sm">
                  <span className="w-8 font-cond text-[10px] font-700 uppercase text-muted">{f.pos}</span>
                  <span className="flex-1 truncate font-600 text-ink">{f.name}</span>
                  {ledgerIds.has(f.playerId) && <Badge tone="gold">Your guy</Badge>}
                  <span className="font-cond text-xs tnum text-muted">{f.score}</span>
                  {inductedIds.has(f.playerId) ? (
                    <Badge tone="gold">In</Badge>
                  ) : (
                    <span className="font-cond text-[10px] uppercase text-faint">Missed</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  )
}

/** One enshrined legend, with his best line and honour chips. */
function HofInducteeRow({
  ind,
  yours,
}: {
  ind: HofInductee
  yours: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="w-8 font-cond text-[10px] font-700 uppercase text-muted">{ind.pos}</span>
          <span className="truncate font-600 text-ink">{ind.name}</span>
          {yours && <Badge tone="gold">Your guy</Badge>}
        </div>
        <div className="mt-0.5 text-[11px] text-muted">
          {ind.careerYears} seasons · {ind.bestLine ?? `${ind.totalTD} TD`} · score {ind.score}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {!!ind.mvp && <Badge tone="gold">MVP×{ind.mvp}</Badge>}
        {!!ind.allPro && <Badge tone="info">All-Pro×{ind.allPro}</Badge>}
        {!!ind.titles && <Badge tone="gold">{ind.titles}× Champion</Badge>}
      </div>
    </div>
  )
}

function HofCard({ ind, world }: { ind: HofInductee; world: ReturnType<typeof useWorld> }) {
  const world2 = Object.values(world.byId).find((t) => t.name === (ind as unknown as { team?: string }).team)
  void world2
  return (
    <Card className="border-gold/30 bg-gold-soft">
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-gold text-on-accent">
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
    <div className="rounded-lg border border-gold/30 py-1.5">
      <div className="label !text-[9px] !text-gold-ink">{label}</div>
      <div className="font-display text-base font-700 tnum text-ink">{value}</div>
    </div>
  )
}

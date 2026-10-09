import { useState } from 'react'
import { cn } from '../lib/cn'
import { leagueGroups } from '../game/data/leagueGroups'
import { recordOf, rosterOf, teamAvgOvr } from '../game/selectors'
import { recordBook, teamHistory } from '../game/engine/statsDb'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, PageHeader, OvrBadge, TeamCrest } from '../ui/kit'

function TeamHistoryCard({ teamId }: { teamId: string }) {
  const db = useGame((s) => s.statsDb)()
  const book = recordBook(db, teamId)
  const history = teamHistory(db, teamId).slice(-8).reverse()
  if (!book || !history.length) {
    return (
      <Card>
        <h3 className="mb-2 font-display text-lg font-700 uppercase tracking-wide">Franchise History</h3>
        <p className="text-sm text-muted">No seasons recorded yet. History builds as you play.</p>
      </Card>
    )
  }
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">Franchise History</h3>
        <Badge tone="gold">{book.titles} title{book.titles === 1 ? '' : 's'}</Badge>
      </div>
      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <MiniStat label="Seasons" value={book.seasons} />
        <MiniStat label="Record" value={`${book.totalWins}-${book.totalLosses}`} />
        <MiniStat label="Playoffs" value={book.playoffYears} />
      </div>
      <table className="w-full text-[11px] tnum">
        <thead>
          <tr className="text-muted">
            <th className="text-left font-500">Year</th>
            <th className="text-right font-500">W-L</th>
            <th className="text-right font-500">PPG</th>
            <th className="text-right font-500">OVR</th>
            <th className="text-right font-500"></th>
          </tr>
        </thead>
        <tbody>
          {history.map((s) => (
            <tr key={`${s.season}-${s.level}`} className="text-ink-2">
              <td className="text-left">{s.season}</td>
              <td className="text-right">{s.wins}-{s.losses}</td>
              <td className="text-right">{Math.round(s.pointsFor / Math.max(1, s.wins + s.losses))}</td>
              <td className="text-right">{s.teamOvr}</td>
              <td className="text-right">
                {s.champion ? <Badge tone="gold">CHAMP</Badge> : s.playoffs ? <Badge tone="win">PO</Badge> : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-line py-1.5">
      <div className="label !text-[9px]">{label}</div>
      <div className="font-display text-base font-700 tnum text-ink">{value}</div>
    </div>
  )
}

export function League() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const viewTeam = useGame((s) => s.viewTeam)
  const [selected, setSelected] = useState<string>(activeTeamId)

  const groups = leagueGroups('NFL')
  const team = league.byId[selected]
  const roster = rosterOf(league, selected)
  const top = [...roster].sort((a, b) => b.ovr - a.ovr).slice(0, 6)

  return (
    <div>
      <PageHeader
        eyebrow="League"
        title="Team Browser"
        subtitle="Scout the entire league — all 32 NFL franchises, roster by roster."
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          {Object.entries(groups).map(([groupName, ids]) => (
            <div key={groupName}>
              <div className="mb-2 flex items-center gap-2">
                <span className="h-3.5 w-1.5 rounded-full" style={{ background: 'var(--team)' }} />
                <h3 className="font-display text-lg font-700 uppercase tracking-wide">{groupName}</h3>
                <span className="label">{ids.length} teams</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {ids.map((id) => {
                  const t = league.byId[id]
                  const r = recordOf(league, id)
                  const avg = teamAvgOvr(league.roster[id] ?? [])
                  return (
                    <button
                      key={id}
                      onClick={() => setSelected(id)}
                      className={cn(
                        'flex items-center gap-3 rounded-xl border bg-surface p-3 text-left transition hover:shadow-md',
                        selected === id ? 'border-[var(--team)] ring-1 ring-[var(--team)]' : 'border-line',
                      )}
                    >
                      <span
                        role="button"
                        tabIndex={0}
                        title={`View the ${t.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          viewTeam(id)
                        }}
                        className="cursor-pointer transition hover:opacity-80"
                      >
                        <TeamCrest team={t} size={36} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-cond text-sm font-700 uppercase text-ink">
                          {t.tier === 'NFL' ? `${t.city} ${t.name}` : t.name}
                        </div>
                        <div className="text-xs text-muted">
                          {r.wins}-{r.losses} · OVR {Math.round(avg)}
                        </div>
                      </div>
                      {id === activeTeamId && <Badge tone="team">You</Badge>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Detail */}
        <div className="space-y-4">
          <Card
            pad={false}
            className="overflow-hidden"
          >
            <div className="p-4" style={{ background: `linear-gradient(120deg, ${team.primary}, ${team.secondary})` }}>
              <div className="flex items-center gap-3">
                <TeamCrest team={team} size={48} />
                <div className="text-white">
                  <div className="label !text-white/70">
                    {team.tier === 'NFL' ? `${team.conference} ${team.division}` : team.conference}
                  </div>
                  <div className="font-display text-2xl font-700 uppercase leading-none">
                    {team.tier === 'NFL' ? `${team.city} ${team.name}` : team.name}
                  </div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-white">
                <div className="rounded-lg bg-black/20 py-1.5">
                  <div className="label !text-white/60 !text-[9px]">Record</div>
                  <div className="font-display text-lg font-700 tnum">
                    {recordOf(league, selected).wins}-{recordOf(league, selected).losses}
                  </div>
                </div>
                <div className="rounded-lg bg-black/20 py-1.5">
                  <div className="label !text-white/60 !text-[9px]">Prestige</div>
                  <div className="font-display text-lg font-700 tnum">{team.prestige}</div>
                </div>
                <div className="rounded-lg bg-black/20 py-1.5">
                  <div className="label !text-white/60 !text-[9px]">Team OVR</div>
                  <div className="font-display text-lg font-700 tnum">{Math.round(teamAvgOvr(roster))}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => viewTeam(team.id)}
                className="mt-3 w-full rounded-lg border border-white/30 bg-black/20 px-3 py-1.5 font-cond text-[11px] font-700 uppercase tracking-wide text-white transition hover:bg-black/30"
              >
                View team page
              </button>
            </div>
          </Card>

          <Card>
            <h3 className="mb-3 font-display text-lg font-700 uppercase tracking-wide">Top Players</h3>
            <div className="space-y-1">
              {top.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                  <OvrBadge value={p.ovr} pot={p.pot} size={28} />
                  <span className="w-8 font-cond text-[10px] font-700 uppercase text-muted">{p.pos}</span>
                  <span className="flex-1 truncate text-sm font-600 text-ink">{p.name}</span>
                  <span className="font-cond text-xs text-muted">{p.age}</span>
                </div>
              ))}
              {!top.length && <p className="text-sm text-muted">No roster data.</p>}
            </div>
          </Card>

          <Card>
            <h3 className="mb-3 font-display text-lg font-700 uppercase tracking-wide">Head Coach</h3>
            {league.staff[selected]?.[0] && (
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-ink font-display text-base font-700 text-canvas">
                  {league.staff[selected][0].name.split(' ').map((n) => n[0]).join('')}
                </div>
                <div>
                  <div className="font-display text-base font-700 uppercase text-ink">
                    {league.staff[selected][0].name}
                  </div>
                  <div className="font-cond text-xs text-muted">
                    {league.staff[selected][0].rating} OVR · {league.staff[selected][0].scheme}
                  </div>
                </div>
              </div>
            )}
          </Card>

          <TeamHistoryCard teamId={selected} />
        </div>
      </div>
    </div>
  )
}

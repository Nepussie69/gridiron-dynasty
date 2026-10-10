import { useState, type CSSProperties } from 'react'
import { cn } from '../lib/cn'
import { leagueGroups } from '../game/data/leagueGroups'
import { recordOf, rosterOf, teamAvgOvr } from '../game/selectors'
import { recordBook, teamHistory } from '../game/engine/statsDb'
import { bestInk } from '../lib/teamColor'
import { useGame, useWorld } from '../store/gameStore'
import {
  Avatar,
  Badge,
  Button,
  Card,
  PageHeader,
  RatingTile,
  Sheet,
  TeamCrest,
} from '../ui/kit'
import { usePhone } from '../ui/hooks'

/** Gradient hero slab with contrast-checked ink: --team-on is set for the club shown. */
function HeroSlab({ team, children }: { team: { primary: string; secondary: string }; children: React.ReactNode }) {
  const style = {
    background: `linear-gradient(120deg, ${team.primary}, ${team.secondary})`,
    '--team-on': bestInk(team.primary),
    color: 'var(--team-on)',
  } as CSSProperties
  return (
    <div className="rounded-[var(--r-lg)] p-4" style={style}>
      {children}
    </div>
  )
}

export function League() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const viewTeam = useGame((s) => s.viewTeam)
  const phone = usePhone()
  const [selected, setSelected] = useState<string>(activeTeamId)
  const [sheetOpen, setSheetOpen] = useState(false)

  const groups = leagueGroups('NFL')
  const team = league.byId[selected]

  const pick = (id: string) => {
    setSelected(id)
    if (phone) setSheetOpen(true)
  }

  return (
    <div>
      <PageHeader eyebrow="League" title="Team Browser" subtitle="Scout the entire league — all 32 NFL franchises, roster by roster." />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          {Object.entries(groups).map(([groupName, ids]) => (
            <div key={groupName} className="min-w-0">
              <div className="mb-2 flex items-center gap-2">
                <span aria-hidden className="h-3.5 w-1.5 rounded-full bg-line-strong" />
                <h3 className="font-display text-[20px] font-800 italic uppercase leading-none text-ink">{groupName}</h3>
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
                      type="button"
                      onClick={() => pick(id)}
                      aria-pressed={selected === id}
                      title={`Select the ${t.name}`}
                      className={cn(
                        'motion flex min-h-11 items-center gap-3 rounded-[var(--r-md)] border bg-surface p-3 text-left hover:bg-surface-2',
                        selected === id ? 'border-[var(--team-accent)] shadow-[inset_3px_0_0_var(--team-accent)]' : 'border-line',
                      )}
                    >
                      <TeamCrest team={t} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-cond text-body font-700 uppercase text-ink">
                          {t.tier === 'NFL' ? `${t.city} ${t.name}` : t.name}
                        </span>
                        <span className="block text-label text-muted">
                          {r.wins}-{r.losses} · OVR {Math.round(avg)}
                        </span>
                      </span>
                      {id === activeTeamId && <Badge tone="team">You</Badge>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Detail — a right column on desktop, a bottom sheet on phone. */}
        <div className="min-w-0 max-sm:hidden">
          <TeamDetail teamId={selected} activeTeamId={activeTeamId} onView={() => viewTeam(team.id)} />
        </div>
      </div>

      {phone && (
        <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} eyebrow="League" title={team.tier === 'NFL' ? `${team.city} ${team.name}` : team.name}>
          <TeamDetail teamId={selected} activeTeamId={activeTeamId} onView={() => viewTeam(team.id)} />
        </Sheet>
      )}
    </div>
  )
}

function TeamDetail({ teamId, activeTeamId, onView }: { teamId: string; activeTeamId: string; onView: () => void }) {
  const league = useWorld()
  const team = league.byId[teamId]
  const roster = rosterOf(league, teamId)
  const top = [...roster].sort((a, b) => b.ovr - a.ovr).slice(0, 6)
  const rec = recordOf(league, teamId)
  const coach = league.staff[teamId]?.[0]

  return (
    <div className="space-y-4">
      <Card pad={false} className="overflow-hidden">
        <HeroSlab team={team}>
          <div className="flex items-center gap-3">
            <TeamCrest team={team} size={48} />
            <div className="min-w-0">
              <div className="label opacity-75">{team.tier === 'NFL' ? `${team.conference} ${team.division}` : team.conference}</div>
              <div className="truncate font-display text-[26px] font-800 italic uppercase leading-none">
                {team.tier === 'NFL' ? `${team.city} ${team.name}` : team.name}
              </div>
            </div>
            {teamId === activeTeamId && <Badge tone="team" className="ml-auto self-start">You</Badge>}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <SlabStat label="Record" value={`${rec.wins}-${rec.losses}`} />
            <SlabStat label="Prestige" value={team.prestige} />
            <SlabStat label="Team OVR" value={Math.round(teamAvgOvr(roster))} />
          </div>
          <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={onView}>
            Open team page
          </Button>
        </HeroSlab>
      </Card>

      <Card>
        <h3 className="mb-3 font-display text-[20px] font-800 italic uppercase leading-none text-ink">Top Players</h3>
        <div className="space-y-1">
          {top.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-[var(--r-md)] px-2 py-1.5">
              <RatingTile value={p.ovr} size="sm" label={`${p.name} overall`} />
              <span className="w-8 font-cond text-label font-700 uppercase text-muted">{p.pos}</span>
              <span className="min-w-0 flex-1 truncate text-body font-600 text-ink">{p.name}</span>
              <span className="font-cond text-label text-muted">{p.age}</span>
            </div>
          ))}
          {!top.length && <p className="text-body text-muted">No roster data.</p>}
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 font-display text-[20px] font-800 italic uppercase leading-none text-ink">Head Coach</h3>
        {coach ? (
          <div className="flex items-center gap-3">
            <Avatar name={coach.name} size={40} />
            <div className="min-w-0">
              <div className="truncate font-display text-[18px] font-800 italic uppercase leading-none text-ink">{coach.name}</div>
              <div className="text-label text-muted">
                {coach.rating} OVR · {coach.scheme}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-body text-muted">No head coach on file.</p>
        )}
      </Card>

      <FranchiseHistory teamId={teamId} />
    </div>
  )
}

/** A stat cell on the hero slab; the ink is the slab's --team-on. */
function SlabStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[var(--r-md)] bg-[color-mix(in_srgb,var(--team-on)_18%,transparent)] py-1.5">
      <div className="label text-[var(--team-on)] opacity-80">{label}</div>
      <div className="font-display text-[18px] font-800 italic leading-none tnum text-[var(--team-on)]">{value}</div>
    </div>
  )
}

function FranchiseHistory({ teamId }: { teamId: string }) {
  const db = useGame((s) => s.statsDb)()
  const book = recordBook(db, teamId)
  const history = teamHistory(db, teamId).slice(-8).reverse()
  if (!book || !history.length) {
    return (
      <Card>
        <h3 className="mb-2 font-display text-[20px] font-800 italic uppercase leading-none text-ink">Franchise History</h3>
        <p className="text-body text-muted">No seasons recorded yet. History builds as you play.</p>
      </Card>
    )
  }
  return (
    <Card pad={false}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h3 className="font-display text-[20px] font-800 italic uppercase leading-none text-ink">Franchise History</h3>
        <Badge tone="gold">
          {book.titles} title{book.titles === 1 ? '' : 's'}
        </Badge>
      </div>
      <div className="grid grid-cols-3 gap-2 p-3 text-center">
        <MiniStat label="Seasons" value={book.seasons} />
        <MiniStat label="Record" value={`${book.totalWins}-${book.totalLosses}`} />
        <MiniStat label="Playoffs" value={book.playoffYears} />
      </div>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full border-collapse text-small tnum">
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="label px-3 py-2 font-700">
                Year
              </th>
              <th scope="col" className="label px-3 py-2 text-right font-700">
                W-L
              </th>
              <th scope="col" className="label px-3 py-2 text-right font-700">
                PPG
              </th>
              <th scope="col" className="label px-3 py-2 text-right font-700">
                OVR
              </th>
              <th scope="col" className="label px-3 py-2 text-right font-700">
                Result
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {history.map((s) => (
              <tr key={`${s.season}-${s.level}`} className="text-ink-2">
                <td className="px-3 py-2 font-600 text-ink">{s.season}</td>
                <td className="px-3 py-2 text-right">
                  {s.wins}-{s.losses}
                </td>
                <td className="px-3 py-2 text-right">{Math.round(s.pointsFor / Math.max(1, s.wins + s.losses))}</td>
                <td className="px-3 py-2 text-right">{s.teamOvr}</td>
                <td className="px-3 py-2 text-right">
                  {s.champion ? <Badge tone="gold">CHAMP</Badge> : s.playoffs ? <Badge tone="win">PO</Badge> : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[var(--r-md)] border border-line py-1.5">
      <div className="label">{label}</div>
      <div className="font-display text-[18px] font-800 italic leading-none tnum text-ink">{value}</div>
    </div>
  )
}

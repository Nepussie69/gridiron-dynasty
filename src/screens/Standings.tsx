import { useState } from 'react'
import { ChevronRight, Trophy } from 'lucide-react'
import { cn } from '../lib/cn'
import type { Team } from '../game/types'
import {
  conferenceStandings,
  divisionStandings,
  playoffPicture,
  type ClinchMarker,
  type ConferencePicture,
  type DivisionStanding,
  type TeamStanding,
} from '../game/engine/playoffs'
import { useGame, useWorld } from '../store/gameStore'
import { TeamHoverCard } from '../components/TeamHoverCard'
import { Badge, Card, PageHeader, Tabs, TeamCrest } from '../ui/kit'
import { usePhone } from '../ui/hooks'

type Tab = 'divisions' | 'picture' | 'bracket' | 'conference'

const TABS: { id: Tab; label: string }[] = [
  { id: 'divisions', label: 'Divisions' },
  { id: 'picture', label: 'Picture' },
  { id: 'bracket', label: 'Bracket' },
  { id: 'conference', label: 'AFC/NFC' },
]

/** Clinch markers. `e` is neutral: twenty clubs miss every year, so a red `e` would dilute the tone. */
const MARKER_META: Record<ClinchMarker, { tone: 'gold' | 'win' | 'info' | 'neutral'; title: string }> = {
  z: { tone: 'gold', title: 'Clinched the No. 1 seed and a first-round bye' },
  y: { tone: 'win', title: 'Clinched the division' },
  x: { tone: 'info', title: 'Clinched a playoff spot' },
  e: { tone: 'neutral', title: 'Eliminated from playoff contention' },
}

export function Standings() {
  const world = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const phone = usePhone()
  const [tab, setTab] = useState<Tab>(() => (world.phase === 'offseason' ? 'divisions' : 'picture'))

  return (
    <div>
      <PageHeader
        eyebrow="League"
        title="Standings"
        subtitle="Division races, wild-card chases, and the road to the Super Bowl."
      />

      <Tabs label="Standings sections" value={tab} onChange={setTab} stretch={phone} className="mb-3" tabs={TABS} />

      <ClinchLegend className="mb-4" />

      {tab === 'picture' && <PlayoffPicture activeTeamId={activeTeamId} />}
      {tab === 'bracket' && <BracketView activeTeamId={activeTeamId} />}
      {tab === 'divisions' && <Divisions activeTeamId={activeTeamId} />}
      {tab === 'conference' && <Conference activeTeamId={activeTeamId} />}
    </div>
  )
}

/** The clinch key — shown on every tab. */
function ClinchLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-2', className)}>
      <span className="label">Clinch key</span>
      {(['z', 'y', 'x', 'e'] as const).map((m) => (
        <span key={m} className="flex items-center gap-1.5 text-label text-muted">
          <MarkerBadge marker={m} />
          {m === 'z' ? 'No. 1 seed' : m === 'y' ? 'Division' : m === 'x' ? 'Playoff spot' : 'Eliminated'}
        </span>
      ))}
      <span className="text-label text-muted">Seeds: division winners 1–4, wild cards 5–7.</span>
    </div>
  )
}

/** Necked label chip plus a dot — identity without a status colour. */
function ConfHeading({ conf, className }: { conf: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span aria-hidden className="h-5 w-1.5 rounded-full bg-line-strong" />
      <h2 className="font-display text-[22px] font-800 italic uppercase leading-none text-ink">{conf}</h2>
      <Badge tone="neutral">{conf === 'AFC' ? 'American' : 'National'}</Badge>
    </div>
  )
}

// ── Playoff picture ───────────────────────────────────────────────────────────

function PlayoffPicture({ activeTeamId }: { activeTeamId: string }) {
  const world = useWorld()
  const afc = playoffPicture(world, 'AFC')
  const nfc = playoffPicture(world, 'NFC')

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <ConferencePanel picture={afc} activeTeamId={activeTeamId} />
      <ConferencePanel picture={nfc} activeTeamId={activeTeamId} />
    </div>
  )
}

function ConferencePanel({ picture, activeTeamId }: { picture: ConferencePicture; activeTeamId: string }) {
  const world = useWorld()
  const conf = picture.conference
  const group = (label: string, rows: TeamStanding[], opts?: { bye?: boolean; gb?: boolean }) => {
    if (!rows.length) return null
    return (
      <>
        <tr className="border-b border-line bg-surface-2">
          <th scope="colgroup" colSpan={4} className="label px-4 py-1.5 text-left text-ink-2">
            {label}
          </th>
        </tr>
        {rows.map((s) => (
          <PictureRow
            key={s.teamId}
            standing={s}
            team={world.byId[s.teamId]}
            mine={s.teamId === activeTeamId}
            bye={opts?.bye && s.seed === 1}
            showGb={opts?.gb}
          />
        ))}
      </>
    )
  }
  return (
    <div className="min-w-0 space-y-4">
      <ConfHeading conf={conf} />

      <Card pad={false} className="overflow-hidden">
        <div className="border-b border-line px-4 py-2">
          <span className="label">Playoff field</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-small tnum">
            <thead>
              <tr className="border-b border-line text-left">
                <th scope="col" className="label py-2 pl-4 pr-2 font-700">
                  Seed
                </th>
                <th scope="col" className="label px-2 py-2 font-700">
                  Team
                </th>
                <th scope="col" className="label px-2 py-2 text-right font-700">
                  W-L-T
                </th>
                <th scope="col" className="label px-2 py-2 text-right font-700">
                  Strk
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {group('Seeds', picture.seeds, { bye: true })}
              {group('In the hunt', picture.inTheHunt, { gb: true })}
              {group('Eliminated', picture.eliminated, { gb: true })}
            </tbody>
          </table>
        </div>

        <div className="border-t border-line bg-surface-2/60 px-4 py-2.5">
          <div className="label mb-1.5">Wild-card round as it stands</div>
          <div className="grid gap-1.5 sm:grid-cols-3">
            {picture.wildCard.map((m) => (
              <MatchupLine key={m.label} matchup={m} activeTeamId={activeTeamId} />
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}

/** A playoff-picture row: seed, club, record, streak (and games back). */
function PictureRow({
  standing,
  team,
  mine,
  bye,
  showGb,
}: {
  standing: TeamStanding
  team?: Team
  mine: boolean
  bye?: boolean
  showGb?: boolean
}) {
  return (
    <tr className={cn(mine && 'bg-[var(--team-tint)] shadow-[inset_3px_0_0_var(--team-accent)]')}>
      <td className="py-2 pl-4 pr-2">
        <SeedPill n={standing.seed ?? 0} leader={standing.seed === 1} />
      </td>
      <td className="px-2 py-2">
        {team ? (
          <TeamHoverCard team={team} className="min-w-0" info>
            <span className="flex min-w-0 items-center gap-2">
              <TeamCrest team={team} size={22} />
              <span className="truncate font-cond text-body font-600 text-ink">
                {team.tier === 'NFL' ? `${team.city} ${team.name}` : team.name}
              </span>
              {bye && <Badge tone="neutral">BYE</Badge>}
              <MarkerBadge marker={standing.marker} />
              {showGb && standing.gamesBack > 0 && (
                <span className="whitespace-nowrap font-cond text-label tnum text-muted">{gbLabel(standing.gamesBack)} GB</span>
              )}
            </span>
          </TeamHoverCard>
        ) : (
          <span className="flex items-center gap-2">
            <span className="h-5 w-5 shrink-0 rounded bg-surface-3" />
            <span className="truncate font-cond text-body font-600 text-ink">{standing.teamId}</span>
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-2 py-2 text-right font-display text-body font-700 tnum text-ink">{record(standing)}</td>
      <td className="whitespace-nowrap px-2 py-2 text-right font-cond text-label tnum text-muted">{streakLabel(standing.streak)}</td>
    </tr>
  )
}

function MatchupLine({ matchup, activeTeamId }: { matchup: ConferencePicture['wildCard'][number]; activeTeamId: string }) {
  const world = useWorld()
  const high = world.byId[matchup.high.teamId]
  const low = world.byId[matchup.low.teamId]
  const side = (team: Team | undefined, id: string) => (
    <span className={cn('inline-flex min-w-0 items-center gap-1 rounded-[var(--r-sm)] px-0.5', id === activeTeamId && 'bg-[var(--team-tint)]')}>
      {team ? (
        <>
          <TeamCrest team={team} size={18} />
          <span className="truncate font-cond text-label font-700 text-ink">{team.abbr}</span>
        </>
      ) : (
        <span className="truncate font-cond text-label font-700 text-ink">{id}</span>
      )}
    </span>
  )
  return (
    <div className="rounded-[var(--r-md)] border border-line bg-surface px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="label">{matchup.label}</span>
        <span className="label text-muted">
          {record(matchup.high)} · {record(matchup.low)}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {side(high, matchup.high.teamId)}
        <span className="font-cond text-label font-700 uppercase text-muted">vs</span>
        {side(low, matchup.low.teamId)}
      </div>
    </div>
  )
}

// ── Playoff bracket ───────────────────────────────────────────────────────────

interface BracketGame {
  label: string
  highId: string | null
  lowId: string | null
  highPh: string
  lowPh: string
}

function BracketView({ activeTeamId }: { activeTeamId: string }) {
  return (
    <div>
      <div className="grid gap-6 xl:grid-cols-2">
        <ConferenceBracket conf="AFC" activeTeamId={activeTeamId} />
        <ConferenceBracket conf="NFC" activeTeamId={activeTeamId} />
      </div>
      <div className="mx-auto mt-6 max-w-md">
        <div className="card-shadow rounded-[var(--r-lg)] border border-gold/40 bg-gold/10 p-4 text-center">
          <div className="mb-1 flex items-center justify-center gap-2 text-gold-ink">
            <Trophy size={16} />
            <span className="font-display text-[22px] font-800 italic uppercase leading-none">Super Bowl</span>
          </div>
          <div className="font-cond text-small text-muted">AFC champion vs NFC champion</div>
        </div>
      </div>
    </div>
  )
}

function ConferenceBracket({ conf, activeTeamId }: { conf: string; activeTeamId: string }) {
  const world = useWorld()
  const picture = playoffPicture(world, conf)
  const standingById = new Map<string, TeamStanding>()
  for (const s of [...picture.seeds, ...picture.inTheHunt, ...picture.eliminated]) standingById.set(s.teamId, s)
  const seedId = (n: number) => picture.seeds.find((s) => s.seed === n)?.teamId ?? null

  const wildCard: BracketGame[] = picture.wildCard.length
    ? picture.wildCard.map((m) => ({ label: `Wild card · ${m.label}`, highId: m.high.teamId, lowId: m.low.teamId, highPh: '—', lowPh: '—' }))
    : [
        { label: 'Wild card · 2 vs 7', highId: null, lowId: null, highPh: 'No. 2', lowPh: 'No. 7' },
        { label: 'Wild card · 3 vs 6', highId: null, lowId: null, highPh: 'No. 3', lowPh: 'No. 6' },
        { label: 'Wild card · 4 vs 5', highId: null, lowId: null, highPh: 'No. 4', lowPh: 'No. 5' },
      ]

  const divisional: BracketGame[] = [
    { label: 'Divisional · No. 1 seed', highId: seedId(1), lowId: null, highPh: 'No. 1', lowPh: 'Winner 4/5' },
    { label: 'Divisional', highId: null, lowId: null, highPh: 'Winner 2/7', lowPh: 'Winner 3/6' },
  ]
  const championship: BracketGame[] = [
    { label: `${conf} Championship`, highId: null, lowId: null, highPh: 'Divisional winner', lowPh: 'Divisional winner' },
  ]

  return (
    <div className="min-w-0 rounded-[var(--r-lg)] border border-line bg-surface-2/50 p-4">
      <ConfHeading conf={conf} className="mb-3" />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        <BracketRound title="Wild Card" games={wildCard} standingById={standingById} activeTeamId={activeTeamId} />
        <BracketChevron />
        <BracketRound title="Divisional" games={divisional} standingById={standingById} activeTeamId={activeTeamId} />
        <BracketChevron />
        <BracketRound title="Championship" games={championship} standingById={standingById} activeTeamId={activeTeamId} />
      </div>
    </div>
  )
}

function BracketChevron() {
  return (
    <div className="hidden items-center justify-center lg:flex">
      <ChevronRight size={18} className="text-muted" />
    </div>
  )
}

function BracketRound({
  title,
  games,
  standingById,
  activeTeamId,
}: {
  title: string
  games: BracketGame[]
  standingById: Map<string, TeamStanding>
  activeTeamId: string
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="label mb-2 text-center">{title}</div>
      <div className="flex h-full flex-col justify-around gap-3">
        {games.map((g, i) => (
          <BracketMatchup key={i} game={g} standingById={standingById} activeTeamId={activeTeamId} />
        ))}
      </div>
    </div>
  )
}

function BracketMatchup({
  game,
  standingById,
  activeTeamId,
}: {
  game: BracketGame
  standingById: Map<string, TeamStanding>
  activeTeamId: string
}) {
  return (
    <div className="card-shadow rounded-[var(--r-md)] border border-line bg-surface p-2">
      <div className="label mb-1">{game.label}</div>
      <BracketSide teamId={game.highId} placeholder={game.highPh} standingById={standingById} activeTeamId={activeTeamId} />
      <div className="my-1 flex items-center gap-1.5 px-1">
        <span className="h-px flex-1 bg-line" />
        <span className="font-cond text-label font-700 uppercase text-muted">vs</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <BracketSide teamId={game.lowId} placeholder={game.lowPh} standingById={standingById} activeTeamId={activeTeamId} />
    </div>
  )
}

function BracketSide({
  teamId,
  placeholder,
  standingById,
  activeTeamId,
}: {
  teamId: string | null
  placeholder: string
  standingById: Map<string, TeamStanding>
  activeTeamId: string
}) {
  const world = useWorld()
  const team = teamId ? world.byId[teamId] : null
  const standing = teamId ? standingById.get(teamId) : undefined
  const mine = !!teamId && teamId === activeTeamId
  return (
    <div className={cn('flex items-center gap-2 rounded-[var(--r-sm)] px-1.5 py-1', mine && 'bg-[var(--team-tint)] shadow-[inset_3px_0_0_var(--team-accent)]')}>
      <span className="w-5 shrink-0 text-center font-cond text-label font-700 tnum text-muted">{standing?.seed ?? ''}</span>
      {team ? <TeamCrest team={team} size={20} /> : <span className="h-5 w-5 shrink-0 rounded bg-surface-3" />}
      <span className={cn('min-w-0 flex-1 truncate font-cond text-small font-700', team ? 'text-ink' : 'text-muted')}>
        {team ? team.abbr : placeholder}
      </span>
      <span className="font-cond text-label tnum text-muted">{standing ? record(standing) : ''}</span>
    </div>
  )
}

// ── Divisions ─────────────────────────────────────────────────────────────────

function Divisions({ activeTeamId }: { activeTeamId: string }) {
  const world = useWorld()
  const divisions = divisionStandings(world)
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {divisions.map((d) => (
        <DivisionTable key={d.division} division={d} activeTeamId={activeTeamId} />
      ))}
    </div>
  )
}

function DivisionTable({ division, activeTeamId }: { division: DivisionStanding; activeTeamId: string }) {
  const world = useWorld()
  return (
    <Card pad={false} className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
        <ConfHeading conf={division.conference} />
        <span className="label">{division.division}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-small tnum">
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="label py-2 pl-4 pr-2 font-700">
                Team
              </th>
              <th scope="col" className="label px-1 py-2 text-right font-700" title="Wins">
                W
              </th>
              <th scope="col" className="label px-1 py-2 text-right font-700" title="Losses">
                L
              </th>
              <th scope="col" className="label px-1 py-2 text-right font-700" title="Ties">
                T
              </th>
              <th scope="col" className="label px-1 py-2 text-right font-700" title="Win percentage">
                PCT
              </th>
              <th scope="col" className="label px-1 py-2 text-right font-700" title="Division record">
                DIV
              </th>
              <th scope="col" className="label px-1 py-2 text-right font-700" title="Conference record">
                CONF
              </th>
              <th scope="col" className="label px-1 py-2 text-right font-700" title="Points for – points against">
                PF-PA
              </th>
              <th scope="col" className="label px-1 py-2 text-right font-700" title="Point differential">
                Diff
              </th>
              <th scope="col" className="label px-1 py-2 text-right font-700" title="Current streak">
                Strk
              </th>
              <th scope="col" className="label px-1 py-2 text-right font-700" title="Games back of the leader">
                GB
              </th>
              <th scope="col" className="label py-2 pl-1 pr-4 font-700">
                Pos
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {division.teams.map((s) => {
              const team = world.byId[s.teamId]
              const mine = s.teamId === activeTeamId
              return (
                <tr key={s.teamId} className={cn(mine && 'bg-[var(--team-tint)] shadow-[inset_3px_0_0_var(--team-accent)]')}>
                  <td className="py-2 pl-4 pr-2">
                    <span className="flex items-center gap-2">
                      <SeedPill n={division.teams.indexOf(s) + 1} leader={division.teams[0].teamId === s.teamId} />
                      {team ? (
                        <TeamHoverCard team={team} className="min-w-0" info>
                          <span className="flex min-w-0 items-center gap-2">
                            <TeamCrest team={team} size={22} />
                            <span className="truncate font-cond text-body font-600 text-ink">
                              {team.tier === 'NFL' ? `${team.city} ${team.name}` : team.name}
                            </span>
                          </span>
                        </TeamHoverCard>
                      ) : (
                        <span className="truncate font-cond text-body font-600 text-ink">{s.teamId}</span>
                      )}
                    </span>
                  </td>
                  <td className="px-1 py-2 text-right text-ink-2">{s.wins}</td>
                  <td className="px-1 py-2 text-right text-ink-2">{s.losses}</td>
                  <td className="px-1 py-2 text-right text-ink-2">{s.ties}</td>
                  <td className="px-1 py-2 text-right text-ink-2">{pctLabel(s.pct)}</td>
                  <td className="whitespace-nowrap px-1 py-2 text-right text-muted">
                    {s.divWins}-{s.divLosses}
                    {s.divTies ? `-${s.divTies}` : ''}
                  </td>
                  <td className="whitespace-nowrap px-1 py-2 text-right text-muted">
                    {s.confWins}-{s.confLosses}
                    {s.confTies ? `-${s.confTies}` : ''}
                  </td>
                  <td className="whitespace-nowrap px-1 py-2 text-right text-muted">
                    {s.pointsFor}-{s.pointsAgainst}
                  </td>
                  <td className={cn('px-1 py-2 text-right', s.diff >= 0 ? 'text-win' : 'text-loss')}>
                    {s.diff > 0 ? '+' : ''}
                    {s.diff}
                  </td>
                  <td className="px-1 py-2 text-right text-muted">{streakLabel(s.streak)}</td>
                  <td className="px-1 py-2 text-right text-ink-2">
                    {s.teamId === division.teams[0].teamId ? '—' : gbLabel(s.gamesBack)}
                  </td>
                  <td className="py-2 pl-1 pr-4">
                    <PositionBadge standing={s} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/** A playoff-position badge for a division table row. */
function PositionBadge({ standing }: { standing: TeamStanding }) {
  if (standing.marker === 'e') return <MarkerBadge marker="e" />
  if (standing.seed && standing.seed <= 7) {
    return <Badge tone={standing.marker ? MARKER_META[standing.marker].tone : 'neutral'}>#{standing.seed}</Badge>
  }
  return null
}

// ── Conference rankings ───────────────────────────────────────────────────────

function Conference({ activeTeamId }: { activeTeamId: string }) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {['AFC', 'NFC'].map((conf) => (
        <ConferenceTable key={conf} conf={conf} activeTeamId={activeTeamId} />
      ))}
    </div>
  )
}

function ConferenceTable({ conf, activeTeamId }: { conf: string; activeTeamId: string }) {
  const world = useWorld()
  const rows = conferenceStandings(world, conf)
  return (
    <div className="min-w-0 space-y-3">
      <ConfHeading conf={conf} />
      <Card pad={false} className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-small tnum">
            <thead>
              <tr className="border-b border-line text-left">
                <th scope="col" className="label py-2 pl-4 pr-2 font-700">
                  Rank
                </th>
                <th scope="col" className="label px-1 py-2 font-700">
                  Team
                </th>
                <th scope="col" className="label px-1 py-2 text-right font-700" title="Wins">
                  W
                </th>
                <th scope="col" className="label px-1 py-2 text-right font-700" title="Losses">
                  L
                </th>
                <th scope="col" className="label px-1 py-2 text-right font-700" title="Ties">
                  T
                </th>
                <th scope="col" className="label px-1 py-2 text-right font-700" title="Win percentage">
                  PCT
                </th>
                <th scope="col" className="label px-1 py-2 text-right font-700" title="Points for – points against">
                  PF-PA
                </th>
                <th scope="col" className="label px-1 py-2 text-right font-700" title="Point differential">
                  Diff
                </th>
                <th scope="col" className="label px-1 py-2 pr-4 text-right font-700" title="Current streak">
                  Strk
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {rows.map((s) => {
                const team = world.byId[s.teamId]
                const mine = s.teamId === activeTeamId
                return (
                  <tr key={s.teamId} className={cn(mine && 'bg-[var(--team-tint)] shadow-[inset_3px_0_0_var(--team-accent)]')}>
                    <td className="py-1.5 pl-4 pr-2">
                      <SeedPill n={s.seed ?? 0} leader={s.seed === 1} />
                    </td>
                    <td className="px-1 py-1.5">
                      {team ? (
                        <TeamHoverCard team={team} className="min-w-0" info>
                          <span className="flex min-w-0 items-center gap-2">
                            <TeamCrest team={team} size={22} />
                            <span className="truncate font-cond text-body font-600 text-ink">
                              {team.tier === 'NFL' ? `${team.city} ${team.name}` : team.name}
                            </span>
                            <MarkerBadge marker={s.marker} />
                          </span>
                        </TeamHoverCard>
                      ) : (
                        <span className="truncate font-cond text-body font-600 text-ink">{s.teamId}</span>
                      )}
                    </td>
                    <td className="px-1 py-1.5 text-right text-ink-2">{s.wins}</td>
                    <td className="px-1 py-1.5 text-right text-ink-2">{s.losses}</td>
                    <td className="px-1 py-1.5 text-right text-ink-2">{s.ties}</td>
                    <td className="px-1 py-1.5 text-right text-ink-2">{pctLabel(s.pct)}</td>
                    <td className="whitespace-nowrap px-1 py-1.5 text-right text-muted">
                      {s.pointsFor}-{s.pointsAgainst}
                    </td>
                    <td className={cn('px-1 py-1.5 text-right', s.diff >= 0 ? 'text-win' : 'text-loss')}>
                      {s.diff > 0 ? '+' : ''}
                      {s.diff}
                    </td>
                    <td className="px-1 py-1.5 pr-4 text-right text-muted">{streakLabel(s.streak)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ── Small shared bits ─────────────────────────────────────────────────────────

/** Seed / rank pill — neutral, never team-filled (a leader gets only an outline). */
function SeedPill({ n, leader }: { n: number; leader?: boolean }) {
  return (
    <span
      className={cn(
        'grid h-6 w-6 shrink-0 place-items-center rounded-[var(--r-sm)] bg-surface-3 font-cond text-label font-700 tnum text-ink-2',
        leader && 'shadow-[inset_0_0_0_1px_var(--color-line-strong)]',
      )}
    >
      {n}
    </span>
  )
}

function MarkerBadge({ marker }: { marker: ClinchMarker | null }) {
  if (!marker) return null
  const m = MARKER_META[marker]
  return (
    <span title={m.title} className="shrink-0">
      <Badge tone={m.tone}>{marker}</Badge>
    </span>
  )
}

function record(s: TeamStanding): string {
  return s.ties ? `${s.wins}-${s.losses}-${s.ties}` : `${s.wins}-${s.losses}`
}

/** NFL-style win percentage with the leading zero dropped (`.647`). */
function pctLabel(p: number): string {
  return p.toFixed(3).replace(/^0/, '')
}

function streakLabel(streak: number): string {
  if (streak > 0) return `W${streak}`
  if (streak < 0) return `L${-streak}`
  return '—'
}

function gbLabel(gb: number): string {
  if (!Number.isFinite(gb) || gb <= 0) return '—'
  return gb % 1 === 0 ? String(gb) : gb.toFixed(1)
}

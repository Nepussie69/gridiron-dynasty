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
import { Badge, Card, PageHeader, TeamCrest } from '../ui/kit'

type Tab = 'divisions' | 'picture' | 'bracket' | 'conference'

const CONF_COLOR: Record<string, string> = { AFC: '#dc2937', NFC: '#0b62ff' }

const MARKER_META: Record<ClinchMarker, { tone: 'gold' | 'win' | 'info' | 'loss'; title: string }> = {
  z: { tone: 'gold', title: 'Clinched the No. 1 seed and a first-round bye' },
  y: { tone: 'win', title: 'Clinched the division' },
  x: { tone: 'info', title: 'Clinched a playoff spot' },
  e: { tone: 'loss', title: 'Eliminated from playoff contention' },
}

export function Standings() {
  const world = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const [tab, setTab] = useState<Tab>(() => (world.phase === 'offseason' ? 'divisions' : 'picture'))

  const tabs: { id: Tab; label: string }[] = [
    { id: 'divisions', label: 'Divisions' },
    { id: 'picture', label: 'Playoff picture' },
    { id: 'bracket', label: 'Bracket' },
    { id: 'conference', label: 'Conference' },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="League"
        title="Standings"
        subtitle="Division races, wild-card chases, and the road to the Super Bowl."
        right={
          <div className="flex rounded-lg bg-surface-2 p-0.5">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'rounded-md px-3 py-1.5 font-cond text-xs font-700 uppercase transition',
                  tab === t.id ? 'text-[var(--team-ink)]' : 'text-muted hover:text-ink-2',
                )}
                style={tab === t.id ? { background: 'var(--team)' } : undefined}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      />

      {tab === 'picture' && <PlayoffPicture activeTeamId={activeTeamId} />}
      {tab === 'bracket' && <BracketView activeTeamId={activeTeamId} />}
      {tab === 'divisions' && <Divisions activeTeamId={activeTeamId} />}
      {tab === 'conference' && <Conference activeTeamId={activeTeamId} />}
    </div>
  )
}

// ── Playoff picture ───────────────────────────────────────────────────────────

function PlayoffPicture({ activeTeamId }: { activeTeamId: string }) {
  const world = useWorld()
  const afc = playoffPicture(world, 'AFC')
  const nfc = playoffPicture(world, 'NFC')

  return (
    <div>
      <p className="mb-4 text-xs text-muted">
        <span className="font-700 text-ink-2">z</span> clinched the No. 1 seed ·{' '}
        <span className="font-700 text-ink-2">y</span> clinched the division ·{' '}
        <span className="font-700 text-ink-2">x</span> clinched a playoff spot ·{' '}
        <span className="font-700 text-ink-2">e</span> eliminated. Seeds follow the NFL format: division
        winners 1–4, wild cards 5–7.
      </p>
      <div className="grid gap-5 xl:grid-cols-2">
        <ConferencePanel picture={afc} activeTeamId={activeTeamId} />
        <ConferencePanel picture={nfc} activeTeamId={activeTeamId} />
      </div>
    </div>
  )
}

function ConferencePanel({ picture, activeTeamId }: { picture: ConferencePicture; activeTeamId: string }) {
  const world = useWorld()
  const conf = picture.conference
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="h-5 w-1.5 rounded-full" style={{ background: CONF_COLOR[conf] }} />
        <h2 className="font-display text-2xl font-700 uppercase tracking-wide">{conf}</h2>
      </div>

      <Card pad={false}>
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <span className="label">Seeds</span>
          <span className="label">Record</span>
        </div>
        <div className="divide-y divide-line/60">
          {picture.seeds.map((s) => (
            <ClubLine
              key={s.teamId}
              standing={s}
              team={world.byId[s.teamId]}
              mine={s.teamId === activeTeamId}
              showSeed
              bye={s.seed === 1}
            />
          ))}
        </div>

        <div className="border-t border-line bg-surface-2/60 px-4 py-2">
          <div className="label mb-1.5">Wild-card round as it stands</div>
          <div className="grid gap-1.5 sm:grid-cols-3">
            {picture.wildCard.map((m) => (
              <MatchupLine key={m.label} matchup={m} activeTeamId={activeTeamId} />
            ))}
          </div>
        </div>

        <SectionRows
          title="In the hunt"
          note="Games back of the No. 7 seed"
          rows={picture.inTheHunt}
          activeTeamId={activeTeamId}
          showGb
        />
        <SectionRows
          title="Eliminated"
          note=""
          rows={picture.eliminated}
          activeTeamId={activeTeamId}
          showGb
        />
      </Card>
    </div>
  )
}

function SectionRows({
  title,
  note,
  rows,
  activeTeamId,
  showGb,
}: {
  title: string
  note: string
  rows: TeamStanding[]
  activeTeamId: string
  showGb?: boolean
}) {
  const world = useWorld()
  if (!rows.length) return null
  return (
    <div className="border-t border-line">
      <div className="flex items-center justify-between px-4 py-1.5">
        <span className="label">{title}</span>
        {note && <span className="text-[10px] uppercase tracking-wide text-faint">{note}</span>}
      </div>
      <div className="divide-y divide-line/60">
        {rows.map((s) => (
          <ClubLine
            key={s.teamId}
            standing={s}
            team={world.byId[s.teamId]}
            mine={s.teamId === activeTeamId}
            showGb={showGb}
          />
        ))}
      </div>
    </div>
  )
}

function ClubLine({
  standing,
  team,
  mine,
  showSeed,
  showGb,
  bye,
}: {
  standing: TeamStanding
  team?: Team
  mine: boolean
  showSeed?: boolean
  showGb?: boolean
  bye?: boolean
}) {
  return (
    <div className={cn('flex items-center gap-3 px-4 py-2', mine && 'bg-[var(--team-soft)]')}>
      {showSeed ? <SeedPill n={standing.seed ?? 0} leader={standing.seed === 1} /> : <span className="w-5 shrink-0" />}
      {team ? (
        <TeamCrest team={team} size={24} />
      ) : (
        <span className="h-6 w-6 shrink-0 rounded-lg bg-surface-3" />
      )}
      <span className={cn('flex-1 truncate font-cond text-sm font-600', mine ? 'text-ink' : 'text-ink')}>
        {team ? `${team.city} ${team.name}` : standing.teamId}
      </span>
      {bye && <Badge tone="neutral">BYE</Badge>}
      <MarkerBadge marker={standing.marker} />
      {showGb && (
        <span className="w-9 text-right font-cond text-xs tnum text-muted">{gbLabel(standing.gamesBack)}</span>
      )}
      <span className="w-14 text-right font-display text-sm font-700 tnum text-ink">{record(standing)}</span>
    </div>
  )
}

function MatchupLine({ matchup, activeTeamId }: { matchup: ConferencePicture['wildCard'][number]; activeTeamId: string }) {
  const world = useWorld()
  const high = world.byId[matchup.high.teamId]
  const low = world.byId[matchup.low.teamId]
  return (
    <div className="rounded-lg border border-line bg-surface px-2 py-1.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="label">{matchup.label}</span>
        <span className="label">{record(matchup.high)} · {record(matchup.low)}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={cn('inline-flex min-w-0 items-center gap-1', matchup.high.teamId === activeTeamId && 'rounded bg-[var(--team-soft)] px-1')}>
          {high && <TeamCrest team={high} size={18} />}
          <span className="truncate font-cond text-xs font-700 text-ink">{high?.abbr ?? matchup.high.teamId}</span>
        </span>
        <span className="font-cond text-[10px] font-700 uppercase text-faint">vs</span>
        <span className={cn('inline-flex min-w-0 items-center gap-1', matchup.low.teamId === activeTeamId && 'rounded bg-[var(--team-soft)] px-1')}>
          {low && <TeamCrest team={low} size={18} />}
          <span className="truncate font-cond text-xs font-700 text-ink">{low?.abbr ?? matchup.low.teamId}</span>
        </span>
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
      <p className="mb-4 text-xs text-muted">
        Projected bracket from today&apos;s seeds. The No. 1 seed gets a first-round bye and the winners advance —
        later rounds fill in as the postseason is played.
      </p>
      <div className="grid gap-6 xl:grid-cols-2">
        <ConferenceBracket conf="AFC" activeTeamId={activeTeamId} />
        <ConferenceBracket conf="NFC" activeTeamId={activeTeamId} />
      </div>
      <div className="mx-auto mt-6 max-w-md">
        <div className="card-shadow rounded-2xl border border-gold/40 bg-gold/10 p-4 text-center">
          <div className="mb-1 flex items-center justify-center gap-2 text-gold-ink">
            <Trophy size={16} />
            <span className="font-display text-lg font-700 uppercase tracking-wide">Super Bowl</span>
          </div>
          <div className="font-cond text-sm text-muted">AFC champion vs NFC champion</div>
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
    ? picture.wildCard.map((m) => ({
        label: `Wild card · ${m.label}`,
        highId: m.high.teamId,
        lowId: m.low.teamId,
        highPh: '—',
        lowPh: '—',
      }))
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
    <div className="rounded-2xl border border-line bg-surface-2/50 p-4">
      <div className="mb-3 flex items-center gap-3">
        <span className="h-5 w-1.5 rounded-full" style={{ background: CONF_COLOR[conf] }} />
        <h2 className="font-display text-2xl font-700 uppercase tracking-wide">{conf}</h2>
      </div>
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
      <ChevronRight size={18} className="text-faint" />
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
    <div className="flex-1">
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
    <div className="card-shadow rounded-xl border border-line bg-surface p-2">
      <div className="label mb-1 !text-[9px]">{game.label}</div>
      <BracketSide teamId={game.highId} placeholder={game.highPh} standingById={standingById} activeTeamId={activeTeamId} />
      <div className="my-1 flex items-center gap-1.5 px-1">
        <span className="h-px flex-1 bg-line" />
        <span className="font-cond text-[8px] font-700 uppercase text-faint">vs</span>
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
    <div className={cn('flex items-center gap-2 rounded-md px-1.5 py-1', mine && 'bg-[var(--team-soft)]')}>
      <span className="w-4 shrink-0 text-center font-cond text-[10px] font-700 tnum text-muted">
        {standing?.seed ?? ''}
      </span>
      {team ? <TeamCrest team={team} size={20} /> : <span className="h-5 w-5 shrink-0 rounded bg-surface-3" />}
      <span className={cn('min-w-0 flex-1 truncate font-cond text-xs font-700', team ? 'text-ink' : 'text-faint')}>
        {team ? team.abbr : placeholder}
      </span>
      <span className="font-cond text-[10px] tnum text-muted">{standing ? record(standing) : ''}</span>
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
    <Card pad={false}>
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="h-4 w-1.5 rounded-full" style={{ background: CONF_COLOR[division.conference] }} />
          <span className="label">{division.division}</span>
        </div>
        <span className="label">W L T · PCT · DIV · CONF · PF-PA · DIFF · STRK · GB</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs tnum">
          <tbody className="divide-y divide-line/60">
            {division.teams.map((s) => {
              const team = world.byId[s.teamId]
              const mine = s.teamId === activeTeamId
              return (
                <tr key={s.teamId} className={cn(mine && 'bg-[var(--team-soft)]')}>
                  <td className="py-2 pl-4 pr-1">
                    <span className="flex items-center gap-2">
                      <SeedPill n={division.teams.indexOf(s) + 1} leader={division.teams[0].teamId === s.teamId} />
                      {team && <TeamCrest team={team} size={22} />}
                      <span className="truncate font-cond text-sm font-600 text-ink">
                        {team ? `${team.city} ${team.name}` : s.teamId}
                      </span>
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-1 text-right font-cond text-[11px] text-ink-2">
                    {s.wins} {s.losses} {s.ties}
                  </td>
                  <td className="whitespace-nowrap px-1 text-right font-cond text-[11px] tnum text-ink-2">{pctLabel(s.pct)}</td>
                  <td className="whitespace-nowrap px-1 text-right font-cond text-[11px] tnum text-muted">{s.divWins}-{s.divLosses}{s.divTies ? `-${s.divTies}` : ''}</td>
                  <td className="whitespace-nowrap px-1 text-right font-cond text-[11px] tnum text-muted">{s.confWins}-{s.confLosses}{s.confTies ? `-${s.confTies}` : ''}</td>
                  <td className="whitespace-nowrap px-1 text-right font-cond text-[11px] tnum text-muted">
                    {s.pointsFor}-{s.pointsAgainst}
                  </td>
                  <td className={cn('whitespace-nowrap px-1 text-right font-cond text-[11px] tnum', s.diff >= 0 ? 'text-win' : 'text-loss')}>
                    {s.diff > 0 ? '+' : ''}
                    {s.diff}
                  </td>
                  <td className="whitespace-nowrap px-1 text-right font-cond text-[11px] tnum text-muted">{streakLabel(s.streak)}</td>
                  <td className="whitespace-nowrap px-1 pr-2 text-right font-cond text-[11px] tnum text-ink-2">
                    {s.teamId === division.teams[0].teamId ? '—' : gbLabel(s.gamesBack)}
                  </td>
                  <td className="py-1.5 pl-1 pr-4">
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
    return (
      <Badge tone={standing.marker ? MARKER_META[standing.marker].tone : 'neutral'}>#{standing.seed}</Badge>
    )
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
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="h-5 w-1.5 rounded-full" style={{ background: CONF_COLOR[conf] }} />
        <h2 className="font-display text-2xl font-700 uppercase tracking-wide">{conf}</h2>
      </div>
      <Card pad={false}>
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <span className="label">Rank</span>
          <span className="label">W-L-T · PCT · PF-PA · DIFF · STRK</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs tnum">
            <tbody className="divide-y divide-line/60">
              {rows.map((s) => {
                const team = world.byId[s.teamId]
                const mine = s.teamId === activeTeamId
                return (
                  <tr key={s.teamId} className={cn(mine && 'bg-[var(--team-soft)]')}>
                    <td className="py-1.5 pl-4 pr-2">
                      <span className="flex items-center gap-2">
                        <SeedPill n={s.seed ?? 0} leader={s.seed === 1} />
                        {team && <TeamCrest team={team} size={22} />}
                        <span className="truncate font-cond text-sm font-600 text-ink">
                          {team ? `${team.city} ${team.name}` : s.teamId}
                        </span>
                        <MarkerBadge marker={s.marker} />
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-1 text-right font-cond text-[11px] text-ink-2">{record(s)}</td>
                    <td className="whitespace-nowrap px-1 text-right font-cond text-[11px] tnum text-muted">{pctLabel(s.pct)}</td>
                    <td className="whitespace-nowrap px-1 text-right font-cond text-[11px] tnum text-muted">
                      {s.pointsFor}-{s.pointsAgainst}
                    </td>
                    <td className={cn('whitespace-nowrap px-1 text-right font-cond text-[11px] tnum', s.diff >= 0 ? 'text-win' : 'text-loss')}>
                      {s.diff > 0 ? '+' : ''}
                      {s.diff}
                    </td>
                    <td className="whitespace-nowrap px-1 pr-4 text-right font-cond text-[11px] tnum text-muted">{streakLabel(s.streak)}</td>
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

function SeedPill({ n, leader }: { n: number; leader?: boolean }) {
  return (
    <span
      className={cn(
        'grid h-5 w-5 shrink-0 place-items-center rounded font-cond text-[10px] font-700',
      )}
      style={leader ? { background: 'var(--team)', color: 'var(--team-ink)' } : { background: 'var(--color-surface-3)', color: 'var(--color-muted)' }}
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

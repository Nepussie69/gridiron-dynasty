import { useState, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { num } from '../lib/format'
import { teamHistory, teamSeasonStats, type CareerDatabase, type TeamSeasonRecord } from '../game/engine/statsDb'
import { tierFor } from '../game/engine/career'
import { STARTERS, depthAt } from '../game/engine/depth'
import { teamAvgOvr } from '../game/selectors'
import type { CareerState, LedgerEntry, Player, Position, SeasonStats } from '../game/types'
import type { World } from '../game/engine/generate'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, PageHeader, Sparkline, Stat, TeamCrest } from '../ui/kit'

// ─────────────────────────────────────────────────────────────────────────────
// History (L12.12).
//
// The long view of a career: every season you coached (You), every season your
// club played with its offense/defense numbers against the league (Team), and a
// snapshot of any past year (Year by year). Team stats are recorded at year end
// into `statsDb`; the season still in progress is computed live and shown the
// same way.
// ─────────────────────────────────────────────────────────────────────────────

type Tab = 'you' | 'team' | 'year'
type View = 'off' | 'def' | 'both'
type Dir = 'asc' | 'desc'

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseRecord(record: string): { w: number; l: number } {
  const m = /^(\d+)-(\d+)$/.exec(record)
  return m ? { w: Number(m[1]), l: Number(m[2]) } : { w: 0, l: 0 }
}

/** Is this player #1 on his club's depth chart at his position right now? */
function isStarterNow(world: World, p: Player): boolean {
  if (!p.teamId) return false
  const list = depthAt(world, p.teamId, p.pos)
  const idx = list.findIndex((x) => x.id === p.id)
  return idx >= 0 && idx < (STARTERS[p.pos] ?? 1)
}

interface GuyRow {
  id: string
  name: string
  pos: string
  teamId: string | null
  ovr: number
  seasons: number
  kind: string
}

const ACQUIRED: ReadonlySet<string> = new Set(['draft', 'freeAgent', 'trade'])

/** Y3: players you drafted, signed or traded for who held down a starting job. */
function acquiredGuys(world: World, career: CareerState): GuyRow[] {
  const rows: GuyRow[] = []
  for (const p of world.players) {
    const o = p.origin
    if (!o || o.by !== career.gmName || !ACQUIRED.has(o.kind)) continue
    const nfl = (p.stats ?? []).filter((s) => s.level === 'NFL')
    const bestGames = nfl.reduce((m, s) => Math.max(m, s.games), 0)
    if (!isStarterNow(world, p) && bestGames < 10) continue
    rows.push({
      id: p.id,
      name: p.name,
      pos: p.pos,
      teamId: p.teamId,
      ovr: p.ovr,
      seasons: nfl.length,
      kind: o.kind,
    })
  }
  return rows.sort((a, b) => b.ovr - a.ovr).slice(0, 10)
}

function bestWorstCall(entries: LedgerEntry[], season: number): { best: LedgerEntry | null; worst: LedgerEntry | null } {
  const graded = entries.filter((e) => e.season === season && e.myGrade != null)
  if (!graded.length) return { best: null, worst: null }
  const best = graded.reduce((a, b) => ((b.myGrade ?? 0) > (a.myGrade ?? 0) ? b : a))
  const worst = graded.reduce((a, b) => ((b.myGrade ?? 0) < (a.myGrade ?? 0) ? b : a))
  return { best, worst }
}

const OFF_POS: ReadonlySet<Position> = new Set(['QB', 'RB', 'FB', 'WR', 'TE'])
const DEF_POS: ReadonlySet<Position> = new Set(['DE', 'DT', 'LB', 'CB', 'S'])

function mainStat(pos: Position, s: SeasonStats): number {
  if (pos === 'QB') return s.passYds
  if (pos === 'RB') return s.rushYds
  if (pos === 'WR' || pos === 'TE') return s.recYds
  if (pos === 'DE' || pos === 'DT' || pos === 'LB') return s.tackles + s.defSacks * 3 + s.defInts * 5
  return s.tackles + s.defInts * 8 + s.passDef * 2
}

interface PlayerLine {
  id: string
  name: string
  pos: Position
  line: SeasonStats
}

/** Every player who logged a line for a club in a season (past or live). */
function clubSeasonPlayers(world: World, db: CareerDatabase, season: number, clubId: string): PlayerLine[] {
  const out: PlayerLine[] = []
  for (const [pid, entry] of Object.entries(db.players)) {
    const s = entry.seasons.find((x) => x.season === season && x.level === 'NFL' && x.teamId === clubId)
    if (s) out.push({ id: pid, name: entry.name, pos: entry.pos as Position, line: s })
  }
  if (!out.length) {
    for (const p of world.players) {
      const s = p.stats?.find((x) => x.season === season && x.level === 'NFL' && x.teamId === clubId)
      if (s) out.push({ id: p.id, name: p.name, pos: p.pos, line: s })
    }
  }
  return out
}

function lineSummary(pos: Position, s: SeasonStats): string {
  if (pos === 'QB') return `${num(s.passYds)} pass yds · ${s.passTD} TD`
  if (pos === 'RB') return `${num(s.rushYds)} rush yds · ${s.rushTD} TD`
  if (pos === 'WR' || pos === 'TE') return `${s.rec} rec · ${num(s.recYds)} yds · ${s.recTD} TD`
  return `${s.tackles} tkl · ${s.defSacks} sck · ${s.defInts} int`
}

// ── Screen ───────────────────────────────────────────────────────────────────

export function History() {
  const world = useWorld()
  const career = useGame((s) => s.career)!
  const db = useGame((s) => s.statsDb)()
  const [tab, setTab] = useState<Tab>('you')

  const role = tierFor(career.path, career.level)
  const tabs: { id: Tab; label: string }[] = [
    { id: 'you', label: 'You' },
    { id: 'team', label: 'Team' },
    { id: 'year', label: 'Year by year' },
  ]

  return (
    <div>
      <PageHeader
        eyebrow={career.path === 'coach' ? 'Coaching' : 'Personnel'}
        title="History"
        subtitle={`${career.gmName} · ${role.title} · the long view of your career.`}
        right={
          <div className="flex rounded-lg bg-surface-2 p-0.5">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'rounded-md px-4 py-1.5 font-cond text-xs font-700 uppercase tracking-wide transition',
                  tab === t.id ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink-2',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      />

      {tab === 'you' && <YouTab world={world} career={career} />}
      {tab === 'team' && <TeamTab world={world} db={db} defaultClub={career.teamId} />}
      {tab === 'year' && <YearTab world={world} db={db} career={career} />}
    </div>
  )
}

// ── You ──────────────────────────────────────────────────────────────────────

function YouTab({ world, career }: { world: World; career: CareerState }) {
  const entries = career.ledger ?? []
  const history = career.history

  const totals = history.reduce(
    (a, h) => {
      const r = parseRecord(h.record)
      a.w += r.w
      a.l += r.l
      return a
    },
    { w: 0, l: 0 },
  )
  const titles = history.filter((h) => /champion/i.test(h.outcome)).length
  const playoffs = history.filter((h) => /playoff|champion/i.test(h.outcome)).length
  const firings = history.filter((h) => /fired/i.test(h.outcome)).length
  const promotions = history.reduce((n, h, i) => (i > 0 && h.role !== history[i - 1].role && !/fired/i.test(h.outcome) ? n + 1 : n), 0)
  const clubs = new Set(history.map((h) => h.team)).size
  const role = tierFor(career.path, career.level)
  const team = world.byId[career.teamId]

  // Y3: the résumé the calls add up to.
  const picks = entries.filter((e) => e.kind === 'pick').length
  const trades = career.trades?.length ?? 0
  const signings = world.players.filter((p) => p.origin?.by === career.gmName && p.origin.kind === 'freeAgent').length
  const extensions = entries.filter((e) => e.kind === 'contract').length
  const coached = entries.filter((e) => e.kind === 'film').length
  const fourths = entries.filter((e) => e.kind === 'fourth')
  const fourthHits = fourths.filter((e) => e.hit === true).length
  const fourthRate = fourths.length ? Math.round((fourthHits / fourths.length) * 100) : 0
  const films = entries.filter((e) => e.kind === 'film' && e.myGrade != null)
  const filmAvg = films.length ? Math.round(films.reduce((s, e) => s + (e.myGrade ?? 0), 0) / films.length) : null

  const guys = acquiredGuys(world, career)
  const newestFirst = [...history].reverse()

  return (
    <div>
      <Card className="mb-4">
        <div className="flex items-start gap-4">
          {team && <TeamCrest team={team} size={52} />}
          <div className="min-w-0 flex-1">
            <div className="font-display text-2xl font-700 uppercase tracking-wide text-ink">{career.gmName}</div>
            <div className="mt-0.5 text-sm text-ink-2">
              {role.title}
              {team ? ` · ${team.tier === 'NFL' ? `${team.city} ${team.name}` : team.name}` : ''}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone="neutral">{history.length} season{history.length === 1 ? '' : 's'}</Badge>
              <Badge tone="neutral">{clubs} club{clubs === 1 ? '' : 's'}</Badge>
              {promotions > 0 && <Badge tone="win">{promotions} promotion{promotions === 1 ? '' : 's'}</Badge>}
              {titles > 0 && <Badge tone="gold">{titles} title{titles === 1 ? '' : 's'}</Badge>}
              {firings > 0 && <Badge tone="loss">{firings} firing{firings === 1 ? '' : 's'}</Badge>}
            </div>
          </div>
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><Stat label="Career Record" value={totals.w + totals.l ? `${totals.w}-${totals.l}` : '—'} sub={`${playoffs} playoff trip${playoffs === 1 ? '' : 's'} · ${titles} title${titles === 1 ? '' : 's'}`} /></Card>
        <Card><Stat label="Picks Made" value={picks} sub={`${signings} signings · ${trades} trades`} /></Card>
        <Card><Stat label="Extensions" value={extensions} sub="contracts you signed" /></Card>
        <Card>
          <Stat
            label="4th-Down Calls"
            value={fourths.length}
            sub={fourths.length ? `${fourthRate}% converted/agreed` : 'none yet'}
            tone={fourths.length && fourthRate >= 60 ? 'win' : undefined}
          />
        </Card>
        <Card><Stat label="Coached Games" value={coached} sub={filmAvg != null ? `film grade avg ${filmAvg}` : 'fast-sim seasons add none'} /></Card>
        <Card><Stat label="My Guys" value={guys.length} sub="drafted / signed / traded starters" /></Card>
        <Card>
          <Stat
            label="Ledger Hit Rate"
            value={(() => {
              const graded = entries.filter((e) => e.hit !== undefined)
              const hits = graded.filter((e) => e.hit).length
              return graded.length ? `${Math.round((hits / graded.length) * 100)}%` : '—'
            })()}
            sub={`${entries.length} calls logged`}
          />
        </Card>
        <Card><Stat label="Reputation" value={Math.round(career.reputation.results)} sub="Results — the score that travels" /></Card>
      </div>

      <Card pad={false} className="mb-4">
        <div className="border-b border-line px-4 py-2">
          <span className="label">Timeline · season by season</span>
        </div>
        {newestFirst.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-muted">
            No seasons finished yet. Play out a year and it lands here.
          </div>
        )}
        <div className="divide-y divide-line/60">
          {newestFirst.map((h) => {
            const club = world.byId[h.team]
            const { best, worst } = bestWorstCall(entries, h.season)
            const honors = (career.honors ?? []).filter((x) => x.season === h.season)
            const champion = /champion/i.test(h.outcome)
            const madePlayoffs = /playoff/i.test(h.outcome)
            return (
              <div key={`${h.season}-${h.team}`} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
                <div className="flex w-40 shrink-0 items-center gap-2">
                  {club && <TeamCrest team={club} size={30} />}
                  <div className="leading-tight">
                    <div className="font-display text-base font-700 tnum text-ink">{h.season}</div>
                    <div className="font-cond text-[10px] font-700 uppercase text-muted">{club?.abbr ?? h.team}</div>
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-600 text-ink">{h.role}</span>
                    <Badge tone="neutral">{h.record || '—'}</Badge>
                    {champion && <Badge tone="gold">Champions</Badge>}
                    {!champion && madePlayoffs && <Badge tone="info">Playoffs</Badge>}
                    {h.repDelta != null && h.repDelta !== 0 && (
                      <Badge tone={h.repDelta > 0 ? 'win' : 'loss'}>
                        Rep {h.repDelta > 0 ? '+' : ''}{h.repDelta}
                      </Badge>
                    )}
                    {h.objectivesTotal != null && h.objectivesTotal > 0 && (
                      <Badge tone="neutral">Objectives {h.objectivesMet ?? 0}/{h.objectivesTotal}</Badge>
                    )}
                    {h.ambitionsTotal != null && h.ambitionsTotal > 0 && (
                      <Badge tone="neutral">Ambitions {h.ambitionsMet ?? 0}/{h.ambitionsTotal}</Badge>
                    )}
                    {honors.map((a) => (
                      <Badge key={a.award} tone="gold">{a.award}</Badge>
                    ))}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-2">{h.outcome}</div>
                  {(best || worst) && (
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
                      {best && (
                        <span>
                          <span className="font-cond font-700 uppercase text-win">Best call</span> {best.name}
                          {best.myGrade != null ? ` (${best.myGrade})` : ''}
                        </span>
                      )}
                      {worst && worst.id !== best?.id && (
                        <span>
                          <span className="font-cond font-700 uppercase text-loss">Worst call</span> {worst.name}
                          {worst.myGrade != null ? ` (${worst.myGrade})` : ''}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      <Card pad={false}>
        <div className="border-b border-line px-4 py-2">
          <span className="label">My Guys · drafted, signed or traded for, then made a starter</span>
        </div>
        {guys.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted">
            Your draft picks, signings and trade acquisitions who hold down a starting job show up here.
          </div>
        )}
        <div className="divide-y divide-line/60">
          {guys.map((g) => {
            const club = g.teamId ? world.byId[g.teamId] : null
            return (
              <div key={g.id} className="flex items-center gap-3 px-4 py-2.5">
                {club ? <TeamCrest team={club} size={28} /> : <span className="grid h-7 w-7 place-items-center rounded-md bg-surface-3 text-[10px] font-700 text-muted">FA</span>}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-600 text-ink">{g.name}</div>
                  <div className="font-cond text-[11px] font-700 uppercase text-muted">
                    {g.pos} · {g.kind === 'draft' ? 'drafted' : g.kind === 'trade' ? 'traded for' : 'signed'} · {g.seasons} season{g.seasons === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="font-display text-lg font-700 tnum text-ink">{g.ovr}</div>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

// ── Team ─────────────────────────────────────────────────────────────────────

interface Col { id: string; label: string; title?: string }

const OFF_COLS: Col[] = [
  { id: 'totalYds', label: 'YDS', title: 'Total offense' },
  { id: 'passYds', label: 'PASS', title: 'Passing yards' },
  { id: 'rushYds', label: 'RUSH', title: 'Rushing yards' },
  { id: 'offTD', label: 'TD', title: 'Passing + rushing touchdowns' },
  { id: 'giveaways', label: 'GIV', title: 'Interceptions thrown' },
  { id: 'sacksTaken', label: 'SCK-T', title: 'Sacks taken' },
  { id: 'offRank', label: 'RNK', title: 'Offensive yardage rank' },
]
const DEF_COLS: Col[] = [
  { id: 'ydsAllowed', label: 'YDS', title: 'Total yards allowed' },
  { id: 'passYdsAllowed', label: 'PASS', title: 'Passing yards allowed' },
  { id: 'rushYdsAllowed', label: 'RUSH', title: 'Rushing yards allowed' },
  { id: 'takeaways', label: 'TA', title: 'Takeaways (interceptions)' },
  { id: 'sacks', label: 'SCK', title: 'Sacks' },
  { id: 'defRank', label: 'RNK', title: 'Defensive yardage rank' },
]

function statValue(row: TeamSeasonRecord, id: string): number | null {
  switch (id) {
    case 'totalYds': return row.totalYds ?? null
    case 'passYds': return row.passYds ?? null
    case 'rushYds': return row.rushYds ?? null
    case 'offTD': return row.passTD != null || row.rushTD != null ? (row.passTD ?? 0) + (row.rushTD ?? 0) : null
    case 'giveaways': return row.giveaways ?? null
    case 'sacksTaken': return row.sacksTaken ?? null
    case 'offRank': return row.ranks?.offYds ?? null
    case 'ydsAllowed': return row.ydsAllowed ?? null
    case 'passYdsAllowed': return row.passYdsAllowed ?? null
    case 'rushYdsAllowed': return row.rushYdsAllowed ?? null
    case 'takeaways': return row.takeaways ?? null
    case 'sacks': return row.sacks ?? null
    case 'defRank': return row.ranks?.defYds ?? null
    default: return null
  }
}

function sortValue(row: TeamSeasonRecord, key: string): number {
  switch (key) {
    case 'season': return row.season
    case 'wl': return row.wins - row.losses
    case 'pf': return row.pointsFor
    case 'pa': return row.pointsAgainst
    case 'diff': return row.pointsFor - row.pointsAgainst
    case 'ovr': return row.teamOvr
    default: return statValue(row, key) ?? -1
  }
}

function TeamTab({ world, db, defaultClub }: { world: World; db: CareerDatabase; defaultClub: string }) {
  const [club, setClub] = useState(defaultClub)
  const [view, setView] = useState<View>('both')
  const [sortKey, setSortKey] = useState('season')
  const [dir, setDir] = useState<Dir>('desc')

  const teams = world.teams.filter((t) => t.tier === 'NFL').sort((a, b) => a.name.localeCompare(b.name))
  const recorded = teamHistory(db, club)
  const hasLive = recorded.some((r) => r.season === world.season)
  const liveStats = teamSeasonStats(world, world.season)[club]
  const liveRec = world.standings[club]
  const liveRow: TeamSeasonRecord | null =
    !hasLive && liveStats && liveRec && world.byId[club]
      ? {
          season: world.season,
          level: 'NFL',
          teamId: club,
          teamName: world.byId[club].name,
          wins: liveRec.wins,
          losses: liveRec.losses,
          pointsFor: liveRec.pointsFor,
          pointsAgainst: liveRec.pointsAgainst,
          teamOvr: Math.round(teamAvgOvr(world.roster[club] ?? [])),
          playoffs: false,
          champion: false,
          ...liveStats,
        }
      : null

  const rows = [...recorded, ...(liveRow ? [liveRow] : [])]
  const sorted = [...rows].sort((a, b) => {
    const d = sortValue(a, sortKey) - sortValue(b, sortKey)
    return dir === 'asc' ? d : -d
  })
  const best = rows.length ? rows.reduce((a, b) => (b.wins > a.wins || (b.wins === a.wins && b.pointsFor - b.pointsAgainst > a.pointsFor - a.pointsAgainst) ? b : a)) : null
  const winsSeries = [...rows].sort((a, b) => a.season - b.season).map((r) => r.wins)
  const champ = rows.find((r) => r.champion)

  const cols: Col[] = view === 'off' ? OFF_COLS : view === 'def' ? DEF_COLS : [...OFF_COLS, ...DEF_COLS]
  const toggleSort = (key: string) => {
    if (sortKey !== key) {
      setSortKey(key)
      setDir('desc')
    } else {
      setDir(dir === 'desc' ? 'asc' : 'desc')
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={club}
          onChange={(e) => setClub(e.target.value)}
          className="rounded-md border border-line bg-surface-2 px-2 py-1.5 font-cond text-xs font-600 uppercase outline-none"
        >
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.city} {t.name}</option>
          ))}
        </select>
        <div className="flex rounded-lg bg-surface-2 p-0.5">
          {(['off', 'def', 'both'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'rounded-md px-3 py-1.5 font-cond text-xs font-700 uppercase transition',
                view === v ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink-2',
              )}
            >
              {v === 'off' ? 'Offense' : v === 'def' ? 'Defense' : 'Both'}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {champ && <Badge tone="gold">{champ.season} Champions</Badge>}
          {winsSeries.length > 1 && <Sparkline data={winsSeries} width={140} height={28} />}
        </div>
      </div>

      <Card pad={false}>
        {sorted.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted">No seasons recorded for this club yet.</div>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="min-w-full border-collapse text-sm tnum">
              <thead>
                <tr className="text-left">
                  <HdrCell className="sticky top-0 z-30" active={sortKey === 'season'} dir={dir} onClick={() => toggleSort('season')}>Season</HdrCell>
                  <HdrCell className="sticky top-0 z-30" active={sortKey === 'wl'} dir={dir} onClick={() => toggleSort('wl')}>W-L</HdrCell>
                  <HdrCell className="sticky top-0 z-30" active={sortKey === 'pf'} dir={dir} onClick={() => toggleSort('pf')}>PF</HdrCell>
                  <HdrCell className="sticky top-0 z-30" active={sortKey === 'pa'} dir={dir} onClick={() => toggleSort('pa')}>PA</HdrCell>
                  <HdrCell className="sticky top-0 z-30" active={sortKey === 'diff'} dir={dir} onClick={() => toggleSort('diff')}>Diff</HdrCell>
                  <HdrCell className="sticky top-0 z-30" active={sortKey === 'ovr'} dir={dir} onClick={() => toggleSort('ovr')}>OVR</HdrCell>
                  <th className="sticky top-0 z-30 border-b border-line bg-surface-2 px-2 py-2" />
                  {cols.map((c) => (
                    <HdrCell key={c.id} className="sticky top-0 z-30 text-center" title={c.title} active={sortKey === c.id} dir={dir} onClick={() => toggleSort(c.id)}>
                      {c.label}
                    </HdrCell>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const isBest = best != null && r.season === best.season && r.teamId === best.teamId
                  return (
                    <tr key={`${r.season}-${r.teamId}`} className={cn('border-b border-line/60', isBest && 'bg-[var(--team-soft)]')}>
                      <td className="whitespace-nowrap px-2 py-1.5 font-600 text-ink">
                        {r.season}
                        {isBest && <span className="ml-1.5 font-cond text-[10px] font-700 uppercase text-[var(--team)]">Best</span>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-ink-2">{r.wins}-{r.losses}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-ink-2">{r.pointsFor}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-ink-2">{r.pointsAgainst}</td>
                      <td className={cn('whitespace-nowrap px-2 py-1.5', r.pointsFor - r.pointsAgainst >= 0 ? 'text-win' : 'text-loss')}>
                        {r.pointsFor - r.pointsAgainst > 0 ? '+' : ''}{r.pointsFor - r.pointsAgainst}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-ink-2">{r.teamOvr}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {r.champion ? <Badge tone="gold">Champs</Badge> : r.playoffs ? <Badge tone="info">Playoffs</Badge> : null}
                      </td>
                      {cols.map((c) => {
                        const v = statValue(r, c.id)
                        const rank = c.id === 'offRank' || c.id === 'defRank'
                        return (
                          <td key={c.id} className={cn('whitespace-nowrap px-2 py-1.5 text-center', rank ? 'font-700 text-ink-2' : 'text-ink-2')}>
                            {v == null ? '—' : rank ? `#${v}` : c.id.endsWith('Yds') && !rank ? num(v) : v}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="mt-2 px-1 text-xs text-muted">
        Offense and defense are summed from the players' season lines; yards allowed come from opponents' production. Rank is 1 = best of 32.
        {liveRow && <span> Season {world.season} is live and updates as the year goes on.</span>}
      </div>
    </div>
  )
}

// ── Year by year ─────────────────────────────────────────────────────────────

function YearTab({ world, db, career }: { world: World; db: CareerDatabase; career: CareerState }) {
  const recorded = [...new Set(db.teams.map((t) => t.season))].sort((a, b) => b - a)
  const seasons = recorded.length ? recorded : [world.season]
  const [season, setSeason] = useState(seasons[0])

  // League standings snapshot for the year.
  const fromDb = db.teams.filter((t) => t.season === season)
  const standings = fromDb.length
    ? [...fromDb].sort((a, b) => b.wins - a.wins || b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst))
    : world.teams
        .filter((t) => t.tier === 'NFL')
        .map((t) => {
          const rec = world.standings[t.id]
          return {
            season,
            level: 'NFL' as const,
            teamId: t.id,
            teamName: t.tier === 'NFL' ? `${t.city} ${t.name}` : t.name,
            wins: rec?.wins ?? 0,
            losses: rec?.losses ?? 0,
            pointsFor: rec?.pointsFor ?? 0,
            pointsAgainst: rec?.pointsAgainst ?? 0,
            teamOvr: world.byId[t.id] ? Math.round(teamAvgOvr(world.roster[t.id] ?? [])) : 0,
            playoffs: false,
            champion: false,
          }
        })
        .sort((a, b) => b.wins - a.wins || b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst))
  const champion = standings.find((s) => s.champion)

  // Your club that year, and its best players.
  const myClub = career.history.find((h) => h.season === season)?.team ?? career.teamId
  const clubTeam = world.byId[myClub]
  const players = clubSeasonPlayers(world, db, season, myClub)
  const topOff = players.filter((p) => OFF_POS.has(p.pos)).sort((a, b) => mainStat(b.pos, b.line) - mainStat(a.pos, a.line)).slice(0, 5)
  const topDef = players.filter((p) => DEF_POS.has(p.pos)).sort((a, b) => mainStat(b.pos, b.line) - mainStat(a.pos, a.line)).slice(0, 5)

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <select
          value={String(season)}
          onChange={(e) => setSeason(Number(e.target.value))}
          className="rounded-md border border-line bg-surface-2 px-2 py-1.5 font-cond text-xs font-600 uppercase outline-none"
        >
          {seasons.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {champion && <Badge tone="gold">Champion: {champion.teamName}</Badge>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card pad={false}>
          <div className="border-b border-line px-4 py-2">
            <span className="label">{season} standings</span>
          </div>
          <div className="max-h-[560px] overflow-auto">
            <table className="min-w-full border-collapse text-sm tnum">
              <thead>
                <tr className="text-left">
                  <th className="sticky top-0 z-10 border-b border-line bg-surface-2 px-3 py-2 label">Team</th>
                  <th className="sticky top-0 z-10 border-b border-line bg-surface-2 px-3 py-2 label">W-L</th>
                  <th className="sticky top-0 z-10 border-b border-line bg-surface-2 px-3 py-2 label text-right">PF</th>
                  <th className="sticky top-0 z-10 border-b border-line bg-surface-2 px-3 py-2 label text-right">PA</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s) => {
                  const club = world.byId[s.teamId]
                  const mine = s.teamId === career.teamId
                  return (
                    <tr key={s.teamId} className={cn('border-b border-line/60', mine && 'bg-[var(--team-soft)]')}>
                      <td className="whitespace-nowrap px-3 py-1.5">
                        <span className="inline-flex items-center gap-2">
                          {club && <TeamCrest team={club} size={20} />}
                          <span className={cn('font-600', mine ? 'text-ink' : 'text-ink-2')}>{s.teamName}</span>
                          {s.champion && <Badge tone="gold">Champs</Badge>}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-ink-2">{s.wins}-{s.losses}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right text-ink-2">{s.pointsFor}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right text-ink-2">{s.pointsAgainst}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div>
          <Card className="mb-4">
            <div className="mb-2 flex items-center gap-2">
              {clubTeam && <TeamCrest team={clubTeam} size={28} />}
              <div>
                <div className="font-display text-lg font-700 uppercase tracking-wide text-ink">
                  {clubTeam ? (clubTeam.tier === 'NFL' ? `${clubTeam.city} ${clubTeam.name}` : clubTeam.name) : myClub}
                </div>
                <div className="label">{season} · your club that year</div>
              </div>
            </div>
          </Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <TopPlayers title="Top offense" players={topOff} />
            <TopPlayers title="Top defense" players={topDef} />
          </div>
        </div>
      </div>
    </div>
  )
}

function TopPlayers({ title, players }: { title: string; players: PlayerLine[] }) {
  return (
    <Card pad={false}>
      <div className="border-b border-line px-4 py-2">
        <span className="label">{title}</span>
      </div>
      {players.length === 0 && <div className="px-4 py-6 text-center text-xs text-muted">No lines recorded.</div>}
      <div className="divide-y divide-line/60">
        {players.map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-4 py-2">
            <span className="grid h-7 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-cond text-[10px] font-700 uppercase text-muted">{p.pos}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-600 text-ink">{p.name}</div>
              <div className="text-[11px] text-muted">{lineSummary(p.pos, p.line)}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ── Table header ─────────────────────────────────────────────────────────────

function HdrCell({
  children,
  className,
  onClick,
  active,
  dir,
  title,
}: {
  children?: ReactNode
  className?: string
  onClick?: () => void
  active?: boolean
  dir?: Dir
  title?: string
}) {
  return (
    <th
      title={title}
      onClick={onClick}
      className={cn(
        'label cursor-pointer select-none whitespace-nowrap border-b border-line bg-surface-2 px-2 py-2 font-700 hover:text-ink-2',
        active && 'text-ink',
        className,
      )}
    >
      <span className="inline-flex items-center gap-0.5">
        {children}
        {active && <span className="text-[9px] leading-none">{dir === 'asc' ? '▲' : '▼'}</span>}
      </span>
    </th>
  )
}

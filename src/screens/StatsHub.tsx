import { useState, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import {
  COL_COV,
  COL_COV_CMP,
  COL_COV_TD,
  COL_COV_TGT,
  COL_COV_YDS,
  COL_DEF_INT,
  COL_GP,
  COL_PASS_ATT,
  COL_PASS_INT,
  COL_PASS_PCT,
  COL_PASS_TD,
  COL_PASS_YDS,
  COL_PD,
  COL_REC,
  COL_REC_AVG,
  COL_REC_TD,
  COL_REC_YDS,
  COL_RTG,
  COL_RUSH_ATT,
  COL_RUSH_AVG,
  COL_RUSH_TD,
  COL_RUSH_YDS,
  COL_SCK,
  COL_TCK,
  COL_TFL,
  COL_TGT,
  type StatCol,
} from '../components/statsColumns'
import type { CareerDatabase } from '../game/engine/statsDb'
import type { World } from '../game/engine/generate'
import { emptySeason, type Player, type Position, type SeasonStats, type StatLevel } from '../game/types'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, PageHeader, TeamCrest } from '../ui/kit'

// ─────────────────────────────────────────────────────────────────────────────
// Stats Hub — live season leaderboards built from the players themselves.
//
// During a season `statsDb` is only written at year end, so the hub reads the
// current season off `player.stats` (updated every week), past seasons out of
// `statsDb.players`, and Career as the two combined. It reuses the roster Stats
// tab's column definitions (see `StatsTable.tsx`) for every value and format.
// ─────────────────────────────────────────────────────────────────────────────

const NFL: StatLevel = 'NFL'

type PosGroup = 'QB' | 'RB' | 'FB' | 'WR' | 'TE' | 'DL' | 'LB' | 'CB' | 'S'
type Tab = 'offense' | 'defense' | 'kicking'
type Scope = { kind: 'live' } | { kind: 'season'; season: number } | { kind: 'career' }
type PosFilter = 'ALL' | PosGroup
type Dir = 'asc' | 'desc'

interface ColGroup {
  label: string
  cols: StatCol[]
}

const OFFENSE_GROUPS: ColGroup[] = [
  { label: 'Passing', cols: [COL_PASS_ATT, COL_PASS_PCT, COL_PASS_YDS, COL_PASS_TD, COL_PASS_INT, COL_RTG] },
  {
    label: 'Rushing',
    cols: [{ ...COL_RUSH_ATT, label: 'ATT' }, COL_RUSH_YDS, { ...COL_RUSH_AVG, label: 'Y/A' }, COL_RUSH_TD],
  },
  { label: 'Receiving', cols: [COL_TGT, COL_REC, COL_REC_YDS, COL_REC_AVG, COL_REC_TD] },
]

const DEFENSE_GROUPS: ColGroup[] = [
  { label: 'Defense', cols: [COL_TCK, COL_TFL, COL_SCK, COL_DEF_INT, COL_PD] },
  { label: 'Coverage', cols: [COL_COV_TGT, COL_COV_CMP, { ...COL_COV_YDS, label: 'YDS' }, COL_COV_TD, COL_COV] },
]

// No FG/punt fields exist on `SeasonStats`, so the kicking tab is omitted.
const KICKING_GROUPS: ColGroup[] = []

function groupsFor(tab: Tab): ColGroup[] {
  if (tab === 'defense') return DEFENSE_GROUPS
  if (tab === 'kicking') return KICKING_GROUPS
  return OFFENSE_GROUPS
}

function posGroup(pos: Position): PosGroup | null {
  switch (pos) {
    case 'QB':
      return 'QB'
    case 'RB':
      return 'RB'
    case 'FB':
      return 'FB'
    case 'WR':
      return 'WR'
    case 'TE':
      return 'TE'
    case 'DE':
    case 'DT':
      return 'DL'
    case 'LB':
      return 'LB'
    case 'CB':
      return 'CB'
    case 'S':
      return 'S'
    default:
      return null
  }
}

function inTab(pos: Position, tab: Tab): boolean {
  const g = posGroup(pos)
  if (!g) return false
  if (tab === 'offense') return g === 'QB' || g === 'RB' || g === 'WR' || g === 'TE'
  if (tab === 'defense') return g === 'DL' || g === 'LB' || g === 'CB' || g === 'S'
  return false
}

function defaultSort(tab: Tab, pos: PosFilter): string {
  if (tab === 'defense') {
    if (pos === 'DL') return 'sck'
    if (pos === 'LB') return 'tck'
    if (pos === 'CB' || pos === 'S') return 'defInt'
    return 'tck'
  }
  switch (pos) {
    case 'QB':
      return 'passYds'
    case 'RB':
      return 'rushYds'
    case 'WR':
    case 'TE':
      return 'recYds'
    default:
      return 'totyds'
  }
}

// ── Aggregation ──────────────────────────────────────────────────────────────

function sumInto(a: SeasonStats, b: SeasonStats) {
  a.games += b.games
  a.passAtt += b.passAtt
  a.passComp += b.passComp
  a.passYds += b.passYds
  a.passTD += b.passTD
  a.ints += b.ints
  a.sacks += b.sacks ?? 0
  a.rushAtt += b.rushAtt
  a.rushYds += b.rushYds
  a.rushTD += b.rushTD
  a.targets += b.targets
  a.rec += b.rec
  a.recYds += b.recYds
  a.recTD += b.recTD
  a.tackles += b.tackles
  a.defSacks += b.defSacks
  a.defInts += b.defInts
  a.passDef += b.passDef
  a.tfl = (a.tfl ?? 0) + (b.tfl ?? 0)
  a.defTargets = (a.defTargets ?? 0) + (b.defTargets ?? 0)
  a.defComp = (a.defComp ?? 0) + (b.defComp ?? 0)
  a.defYdsAllowed = (a.defYdsAllowed ?? 0) + (b.defYdsAllowed ?? 0)
  a.defTDAllowed = (a.defTDAllowed ?? 0) + (b.defTDAllowed ?? 0)
  a.defIntsCov = (a.defIntsCov ?? 0) + (b.defIntsCov ?? 0)
}

interface HubRow {
  id: string
  name: string
  pos: Position
  teamId: string | null
  line: SeasonStats
  player?: Player
}

function buildRows(world: World, db: CareerDatabase, scope: Scope): HubRow[] {
  const map = new Map<string, HubRow>()
  const add = (id: string, name: string, pos: Position, teamId: string | null, line: SeasonStats, player?: Player) => {
    const prev = map.get(id)
    if (prev) {
      sumInto(prev.line, line)
      if (player) {
        prev.player = player
        prev.teamId = player.teamId
        prev.name = player.name
        prev.pos = player.pos
      }
    } else {
      map.set(id, { id, name, pos, teamId, line: { ...line }, player })
    }
  }
  const liveLines = (p: Player) => (p.stats ?? []).filter((s) => s.season === world.season && s.level === NFL)
  const byId = new Map(world.players.map((p) => [p.id, p]))

  if (scope.kind === 'live') {
    for (const p of world.players) {
      const lines = liveLines(p)
      if (!lines.length) continue
      const agg = emptySeason(world.season, NFL, p.teamId ?? '')
      for (const l of lines) sumInto(agg, l)
      map.set(p.id, { id: p.id, name: p.name, pos: p.pos, teamId: p.teamId, line: agg, player: p })
    }
    return [...map.values()]
  }

  if (scope.kind === 'season') {
    const S = scope.season
    for (const [pid, entry] of Object.entries(db.players)) {
      const lines = entry.seasons.filter((s) => s.season === S && s.level === NFL)
      if (!lines.length) continue
      const last = lines[lines.length - 1]
      const agg = emptySeason(S, NFL, last.teamId)
      for (const l of lines) sumInto(agg, l)
      const live = byId.get(pid)
      add(pid, live?.name ?? entry.name, live?.pos ?? (entry.pos as Position), live?.teamId ?? last.teamId, agg, live)
    }
    return [...map.values()]
  }

  // Career: every recorded NFL season, plus the live season (which is not yet
  // in the database until the year is recorded at season end).
  for (const [pid, entry] of Object.entries(db.players)) {
    const lines = entry.seasons.filter((s) => s.level === NFL && s.season !== world.season)
    if (!lines.length) continue
    const last = lines[lines.length - 1]
    const agg = emptySeason(last.season, NFL, last.teamId)
    for (const l of lines) sumInto(agg, l)
    const live = byId.get(pid)
    add(pid, live?.name ?? entry.name, live?.pos ?? (entry.pos as Position), live?.teamId ?? last.teamId, agg, live)
  }
  for (const p of world.players) {
    const lines = liveLines(p)
    if (!lines.length) continue
    const agg = emptySeason(world.season, NFL, p.teamId ?? '')
    for (const l of lines) sumInto(agg, l)
    add(p.id, p.name, p.pos, p.teamId, agg, p)
  }
  return [...map.values()]
}

// ── Filtering helpers ────────────────────────────────────────────────────────

const defProduction = (s: SeasonStats) => s.tackles + s.defSacks + s.defInts + s.passDef + (s.defTargets ?? 0)

/** Qualified = the rate-stat minimums; off = anyone with at least one attempt. */
function meetsQualifier(r: HubRow, qualified: boolean): boolean {
  const g = posGroup(r.pos)
  if (!g) return false
  const games = Math.max(1, r.line.games)
  if (!qualified) {
    switch (g) {
      case 'QB':
        return r.line.passAtt >= 1
      case 'RB':
        return r.line.rushAtt >= 1 || r.line.rec >= 1
      case 'WR':
      case 'TE':
        return r.line.targets >= 1
      default:
        return defProduction(r.line) >= 1
    }
  }
  switch (g) {
    case 'QB':
      return r.line.passAtt >= 10 * games
    case 'RB':
      return r.line.rushAtt >= 6 * games
    case 'WR':
    case 'TE':
      return r.line.targets >= 2 * games
    default:
      return defProduction(r.line) >= 1
  }
}

function groupHasData(g: ColGroup, rows: HubRow[]): boolean {
  return rows.some((r) => g.cols.some((c) => {
    const v = c.get(r.line, r.player)
    return v != null && v !== 0
  }))
}

function teamNameOf(teamId: string | null, world: World): string {
  if (!teamId) return 'FA'
  return world.byId[teamId]?.name ?? teamId
}

function hasKicking(rows: HubRow[]): boolean {
  const keys = ['fgMade', 'fgAtt', 'fgYds', 'punts', 'puntYds', 'xpMade', 'xpAtt']
  return rows.some((r) => keys.some((k) => {
    const v = (r.line as unknown as Record<string, unknown>)[k]
    return typeof v === 'number' && v > 0
  }))
}

// ── Screen ───────────────────────────────────────────────────────────────────

export function StatsHub() {
  const world = useWorld()
  const selectPlayer = useGame((s) => s.selectPlayer)
  const activeTeamId = useGame((s) => s.activeTeamId)
  const db = useGame((s) => s.statsDb)()

  const [scope, setScope] = useState<Scope>({ kind: 'live' })
  const [tab, setTab] = useState<Tab>('offense')
  const [pos, setPos] = useState<PosFilter>('ALL')
  const [team, setTeam] = useState('ALL')
  const [qualified, setQualified] = useState(true)
  const [sortKey, setSortKey] = useState('totyds')
  const [dir, setDir] = useState<Dir>('desc')
  const [limit, setLimit] = useState(50)

  const seasonsRecorded = [...new Set(db.teams.map((t) => t.season))].sort((a, b) => b - a)
  const pastSeasons = seasonsRecorded.filter((s) => s !== world.season)

  const allRows = buildRows(world, db, scope)
  const tabRows = allRows.filter((r) => inTab(r.pos, tab))
  const posRows = pos === 'ALL' ? tabRows : tabRows.filter((r) => posGroup(r.pos) === pos)
  const teamRows =
    team === 'ALL' ? posRows : posRows.filter((r) => (team === 'FA' ? r.teamId == null : r.teamId === team))
  const groups = groupsFor(tab)
  const visibleGroups = groups.filter((g) => groupHasData(g, teamRows))
  const columns = visibleGroups.flatMap((g) => g.cols)
  const qualifiedRows = teamRows.filter((r) => meetsQualifier(r, qualified))

  const sortValue = (r: HubRow, key: string): number | string | null => {
    if (key === 'name') return r.name
    if (key === 'pos') return r.pos
    if (key === 'team') return teamNameOf(r.teamId, world)
    if (key === 'gp') return r.line.games
    if (key === 'totyds') return r.line.passYds + r.line.rushYds + r.line.recYds
    const c = columns.find((x) => x.id === key)
    return c ? c.get(r.line, r.player) : null
  }

  const sorted = [...qualifiedRows].sort((a, b) => {
    const va = sortValue(a, sortKey)
    const vb = sortValue(b, sortKey)
    const ma = va == null
    const mb = vb == null
    // Missing / zero-attempt rows sort last in both directions.
    if (ma && mb) return a.name.localeCompare(b.name)
    if (ma) return 1
    if (mb) return -1
    let cmp =
      typeof va === 'string' || typeof vb === 'string'
        ? String(va).localeCompare(String(vb))
        : (va as number) - (vb as number)
    // CB/S default is INT, then coverage grade.
    if (cmp === 0 && sortKey === 'defInt') {
      cmp = (COL_COV.get(a.line, a.player) ?? -1) - (COL_COV.get(b.line, b.player) ?? -1)
    }
    return dir === 'asc' ? cmp : -cmp
  })

  const shown = sorted.slice(0, limit)
  const kickingAvailable = hasKicking(allRows)
  const tabs: Tab[] = kickingAvailable ? ['offense', 'defense', 'kicking'] : ['offense', 'defense']
  const posOptions: PosFilter[] = tab === 'defense' ? ['ALL', 'DL', 'LB', 'CB', 'S'] : ['ALL', 'QB', 'RB', 'FB', 'WR', 'TE']
  const teams = world.teams.filter((t) => t.tier === 'NFL').sort((a, b) => a.name.localeCompare(b.name))

  const applyScope = (next: Scope) => {
    setScope(next)
    setLimit(50)
  }
  const applyTab = (next: Tab) => {
    setTab(next)
    setPos('ALL')
    setSortKey(defaultSort(next, 'ALL'))
    setDir('desc')
    setLimit(50)
  }
  const applyPos = (next: PosFilter) => {
    setPos(next)
    setSortKey(defaultSort(tab, next))
    setDir('desc')
    setLimit(50)
  }
  const toggleSort = (key: string) => {
    if (sortKey !== key) {
      setSortKey(key)
      setDir('desc')
    } else {
      setDir(dir === 'desc' ? 'asc' : 'desc')
    }
  }

  const subtitle =
    scope.kind === 'live'
      ? `Through week ${world.week} — live NFL production, updated every week.`
      : scope.kind === 'season'
        ? `${scope.season} season · ${seasonsRecorded.length} season${seasonsRecorded.length === 1 ? '' : 's'} recorded.`
        : `Career totals · ${seasonsRecorded.length} season${seasonsRecorded.length === 1 ? '' : 's'} recorded.`

  return (
    <div>
      <PageHeader
        eyebrow="League"
        title="Stats Hub"
        subtitle={subtitle}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg bg-surface-2 p-0.5">
              <button
                onClick={() => applyScope({ kind: 'live' })}
                className={cn(
                  'rounded-md px-3 py-1.5 font-cond text-xs font-700 uppercase transition',
                  scope.kind === 'live' ? 'bg-surface text-ink shadow-sm' : 'text-muted',
                )}
              >
                Season {world.season}
              </button>
              <button
                onClick={() => applyScope({ kind: 'career' })}
                className={cn(
                  'rounded-md px-3 py-1.5 font-cond text-xs font-700 uppercase transition',
                  scope.kind === 'career' ? 'bg-surface text-ink shadow-sm' : 'text-muted',
                )}
              >
                Career
              </button>
            </div>
            <select
              value={scope.kind === 'season' ? String(scope.season) : ''}
              onChange={(e) => {
                const v = e.target.value
                applyScope(v ? { kind: 'season', season: Number(v) } : { kind: 'live' })
              }}
              className="rounded-md border border-line bg-surface-2 px-2 py-1.5 font-cond text-xs font-600 uppercase outline-none"
            >
              <option value="">Past seasons…</option>
              {pastSeasons.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {/* Tabs + filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-surface-2 p-0.5">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => applyTab(t)}
              className={cn(
                'rounded-md px-3 py-1.5 font-cond text-xs font-700 uppercase transition',
                tab === t ? 'text-[var(--team-ink)]' : 'text-muted hover:text-ink-2',
              )}
              style={tab === t ? { background: 'var(--team)' } : undefined}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {posOptions.map((p) => (
            <button
              key={p}
              onClick={() => applyPos(p)}
              className={cn(
                'rounded-md px-2.5 py-1 font-cond text-xs font-700 uppercase transition',
                pos === p ? 'text-[var(--team-ink)]' : 'bg-surface text-muted hover:bg-surface-2',
              )}
              style={pos === p ? { background: 'var(--team)' } : undefined}
            >
              {p === 'ALL' ? 'All' : p}
            </button>
          ))}
        </div>

        <select
          value={team}
          onChange={(e) => {
            setTeam(e.target.value)
            setLimit(50)
          }}
          className="rounded-md border border-line bg-surface-2 px-2 py-1 font-cond text-xs font-600 uppercase outline-none"
        >
          <option value="ALL">All teams</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.city} {t.name}
            </option>
          ))}
          <option value="FA">Free agents</option>
        </select>

        <button
          onClick={() => {
            setQualified(!qualified)
            setLimit(50)
          }}
          className={cn(
            'rounded-md border px-2.5 py-1 font-cond text-xs font-700 uppercase transition',
            qualified ? 'border-transparent text-[var(--team-ink)]' : 'border-line bg-surface text-muted hover:bg-surface-2',
          )}
          style={qualified ? { background: 'var(--team)' } : undefined}
        >
          Qualified only
        </button>

        <div className="ml-auto flex items-center gap-2">
          <Badge tone="neutral">{sorted.length} players</Badge>
        </div>
      </div>

      <Card pad={false}>
        {sorted.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted">
            No stats recorded yet. Play a week to see live production.
          </div>
        ) : (
          <>
            <div className="max-h-[70vh] overflow-auto">
              <table className="min-w-full border-collapse text-sm tnum">
                <thead>
                  <tr className="text-left">
                    <th className="sticky left-0 top-0 z-40 h-6 border-b border-line bg-surface-2 px-2" />
                    <th className="sticky top-0 z-30 h-6 border-b border-line bg-surface-2 px-2" />
                    <th className="sticky top-0 z-30 h-6 border-b border-line bg-surface-2 px-2" />
                    <th className="sticky top-0 z-30 h-6 border-b border-line bg-surface-2 px-2" />
                    {visibleGroups.map((g) => (
                      <th
                        key={g.label}
                        colSpan={g.cols.length}
                        className="label sticky top-0 z-30 h-6 border-b border-line bg-surface-2 px-2 text-center font-700 text-ink-2"
                      >
                        {g.label}
                      </th>
                    ))}
                  </tr>
                  <tr className="text-left">
                    <HdrCell className="sticky left-0 top-6 z-40" active={sortKey === 'name'} dir={dir} onClick={() => toggleSort('name')}>
                      Player
                    </HdrCell>
                    <HdrCell className="sticky top-6 z-30" active={sortKey === 'team'} dir={dir} onClick={() => toggleSort('team')}>
                      Team
                    </HdrCell>
                    <HdrCell className="sticky top-6 z-30" active={sortKey === 'pos'} dir={dir} onClick={() => toggleSort('pos')}>
                      Pos
                    </HdrCell>
                    <HdrCell className="sticky top-6 z-30" active={sortKey === 'gp'} dir={dir} onClick={() => toggleSort('gp')} title="Games played">
                      GP
                    </HdrCell>
                    {columns.map((c) => (
                      <HdrCell
                        key={c.id}
                        className="sticky top-6 z-30 text-center"
                        active={sortKey === c.id}
                        dir={dir}
                        title={c.title}
                        onClick={() => toggleSort(c.id)}
                      >
                        {c.label}
                      </HdrCell>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const club = world.byId[r.teamId ?? '']
                    const mine = r.teamId === activeTeamId
                    const cellBg = mine ? 'bg-[var(--team-soft)]' : 'bg-surface'
                    return (
                      <tr
                        key={r.id}
                        onClick={() => selectPlayer(r.id)}
                        className={cn('cursor-pointer border-b border-line/60 transition hover:bg-[var(--team-soft)]', mine && 'bg-[var(--team-soft)]')}
                      >
                        <td className={cn('sticky left-0 z-10 whitespace-nowrap px-2 py-1.5', cellBg)}>
                          <span className="font-600 text-ink">{r.name}</span>
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5">
                          <span className="inline-flex items-center gap-1.5 text-ink-2">
                            {club && <TeamCrest team={club} size={18} />}
                            {teamNameOf(r.teamId, world)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5">
                          <span className="font-cond text-[11px] font-700 uppercase text-muted">{r.pos}</span>
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-center text-ink-2">{COL_GP.fmt(r.line, r.player)}</td>
                        {columns.map((c) => (
                          <td key={c.id} className="whitespace-nowrap px-2 py-1.5 text-center text-ink-2">
                            {c.fmt(r.line, r.player)}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {sorted.length > limit && (
              <div className="border-t border-line p-3 text-center">
                <button
                  onClick={() => setLimit(limit + 50)}
                  className="rounded-md bg-surface-2 px-4 py-1.5 font-cond text-xs font-700 uppercase text-ink-2 hover:bg-surface-3"
                >
                  Show more ({sorted.length - limit} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}

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

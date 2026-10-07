import { useState } from 'react'
import { cn } from '../lib/cn'
import { leaderboard, type LeaderRow } from '../game/engine/statsDb'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, PageHeader, TeamCrest } from '../ui/kit'

type StatKey = 'passYds' | 'passTD' | 'passerRating' | 'rushYds' | 'rushTD' | 'rec' | 'recYds' | 'recTD' | 'sacks' | 'ints' | 'tackles'

const GROUPS: { label: string; stats: { key: StatKey; label: string }[] }[] = [
  { label: 'Passing', stats: [{ key: 'passYds', label: 'Pass Yards' }, { key: 'passTD', label: 'Pass TD' }, { key: 'passerRating', label: 'Passer Rating' }] },
  { label: 'Rushing', stats: [{ key: 'rushYds', label: 'Rush Yards' }, { key: 'rushTD', label: 'Rush TD' }] },
  { label: 'Receiving', stats: [{ key: 'rec', label: 'Receptions' }, { key: 'recYds', label: 'Rec Yards' }, { key: 'recTD', label: 'Rec TD' }] },
  { label: 'Defense', stats: [{ key: 'sacks', label: 'Sacks' }, { key: 'ints', label: 'Interceptions' }, { key: 'tackles', label: 'Tackles' }] },
]

export function StatsHub() {
  const world = useWorld()
  const selectPlayer = useGame((s) => s.selectPlayer)
  const db = useGame((s) => s.statsDb)()
  const [stat, setStat] = useState<StatKey>('passYds')
  const [scope, setScope] = useState<'season' | 'career'>('season')

  const rows = leaderboard(world, db, stat, {
    season: scope === 'season' ? world.season : undefined,
    career: scope === 'career',
    level: 'NFL',
    limit: 25,
  })

  const seasonsRecorded = [...new Set(db.teams.map((t) => t.season))].sort()

  return (
    <div>
      <PageHeader
        eyebrow="League"
        title="Stats Hub"
        subtitle={`NFL leaderboards and the career statistics database — ${seasonsRecorded.length} season${seasonsRecorded.length === 1 ? '' : 's'} recorded.`}
        right={
          <div className="flex gap-2">
            <div className="flex rounded-lg bg-surface-2 p-0.5">
              {(['season', 'career'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={cn('rounded-md px-3 py-1.5 font-cond text-xs font-700 uppercase transition', scope === s ? 'bg-white text-ink shadow-sm' : 'text-muted')}
                >
                  {s === 'season' ? `Season ${world.season}` : 'Career'}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <div className="mb-4 space-y-2">
        {GROUPS.map((g) => (
          <div key={g.label} className="flex flex-wrap items-center gap-1">
            <span className="label w-20">{g.label}</span>
            {g.stats.map((s) => (
              <button
                key={s.key}
                onClick={() => setStat(s.key)}
                className={cn(
                  'rounded-md px-2.5 py-1 font-cond text-xs font-700 uppercase transition',
                  stat === s.key ? 'text-[var(--team-ink)]' : 'bg-surface text-muted hover:bg-surface-2',
                )}
                style={stat === s.key ? { background: 'var(--team)' } : undefined}
              >
                {s.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      <Card pad={false}>
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="label">
            {scope === 'career' ? 'Career' : `${world.season}`} · Pro · {GROUPS.flatMap((g) => g.stats).find((s) => s.key === stat)?.label}
          </span>
          <Badge tone="neutral">{rows.length} players</Badge>
        </div>
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted">
            No stats recorded yet. Play seasons to build the database.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tnum">
              <thead>
                <tr className="border-b border-line text-left">
                  {['#', 'Player', 'Pos', 'Team', scope === 'career' ? 'Span' : 'Season', 'Value'].map((h) => (
                    <th key={h} className="label px-3 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <LeaderRowView key={`${r.playerId}-${r.season}`} row={r} rank={i + 1} scope={scope} onSelect={selectPlayer} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function LeaderRowView({
  row,
  rank,
  scope,
  onSelect,
}: {
  row: LeaderRow
  rank: number
  scope: 'season' | 'career'
  onSelect: (id: string) => void
}) {
  const world = useWorld()
  const team = world.byId[row.team] ?? Object.values(world.byId).find((t) => t.name === row.team)
  return (
    <tr className="cursor-pointer border-b border-line/60 hover:bg-surface-2" onClick={() => onSelect(row.playerId)}>
      <td className="px-3 py-1.5 font-display text-base font-700 text-faint">{rank}</td>
      <td className="px-3 py-1.5 font-600 text-ink">{row.name}</td>
      <td className="px-3 py-1.5 font-cond text-[11px] font-700 uppercase text-muted">{row.pos}</td>
      <td className="px-3 py-1.5">
        <span className="inline-flex items-center gap-1.5 text-ink-2">
          {team && <TeamCrest team={team} size={20} />}
          {row.team}
        </span>
      </td>
      <td className="px-3 py-1.5 text-muted">{scope === 'career' ? `${row.season}` : row.season}</td>
      <td className="px-3 py-1.5 font-display text-lg font-700 text-ink">{row.value.toLocaleString()}</td>
    </tr>
  )
}

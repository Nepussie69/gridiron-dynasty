import { rosterOf } from '../game/selectors'
import type { Player, Position } from '../game/types'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, OvrBadge, PageHeader } from '../ui/kit'

// Offensive / defensive depth chart formation, grouped by unit.
const OFF_GROUPS: { label: string; positions: Position[] }[] = [
  { label: 'Quarterback', positions: ['QB'] },
  { label: 'Running Back', positions: ['RB'] },
  { label: 'Wide Receiver', positions: ['WR'] },
  { label: 'Tight End', positions: ['TE'] },
  { label: 'Offensive Line', positions: ['OT', 'OG', 'C'] },
]
const DEF_GROUPS: { label: string; positions: Position[] }[] = [
  { label: 'Defensive Line', positions: ['DE', 'DT'] },
  { label: 'Linebackers', positions: ['LB'] },
  { label: 'Cornerbacks', positions: ['CB'] },
  { label: 'Safeties', positions: ['S'] },
]
const ST_GROUPS: { label: string; positions: Position[] }[] = [{ label: 'Specialists', positions: ['K', 'P'] }]

export function DepthChart() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const selectPlayer = useGame((s) => s.selectPlayer)
  const roster = rosterOf(league, activeTeamId)
  const staff = league.staff[activeTeamId] ?? []

  const byPos = (positions: Position[]) =>
    roster
      .filter((p) => positions.includes(p.pos))
      .sort((a, b) => b.ovr - a.ovr)

  return (
    <div>
      <PageHeader
        eyebrow="Team"
        title="Depth Chart"
        subtitle="Set your starters. Click a player to view his full profile and make moves."
        right={
          <div className="flex gap-2">
            <Badge tone="team">OFF: {staff.find((s) => s.role === 'Offensive Coordinator')?.scheme ?? 'Balanced'}</Badge>
            <Badge tone="info">DEF: {staff.find((s) => s.role === 'Defensive Coordinator')?.scheme ?? 'Multiple'}</Badge>
          </div>
        }
      />

      <div className="space-y-5">
        <Unit title="Offense" accent="var(--team)" groups={OFF_GROUPS} byPos={byPos} onSelect={selectPlayer} />
        <Unit title="Defense" accent="#0b62ff" groups={DEF_GROUPS} byPos={byPos} onSelect={selectPlayer} />
        <Unit title="Special Teams" accent="#c99a2e" groups={ST_GROUPS} byPos={byPos} onSelect={selectPlayer} />
      </div>
    </div>
  )
}

function Unit({
  title,
  accent,
  groups,
  byPos,
  onSelect,
}: {
  title: string
  accent: string
  groups: { label: string; positions: Position[] }[]
  byPos: (p: Position[]) => Player[]
  onSelect: (id: string) => void
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <span className="h-4 w-1.5 rounded-full" style={{ background: accent }} />
        <h3 className="font-display text-xl font-700 uppercase tracking-wide">{title}</h3>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => {
          const players = byPos(g.positions)
          return (
            <Card key={g.label} pad={false} className="overflow-hidden">
              <div className="border-b border-line bg-surface-2 px-3 py-1.5">
                <span className="label">{g.label}</span>
              </div>
              <div className="divide-y divide-line/60">
                {players.slice(0, 4).map((p, i) => (
                  <button
                    key={p.id}
                    onClick={() => onSelect(p.id)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-[var(--team-soft)]"
                  >
                    <span
                      className="grid h-5 w-5 shrink-0 place-items-center rounded font-cond text-[10px] font-700"
                      style={{
                        background: i === 0 ? accent : '#eaf0f8',
                        color: i === 0 ? '#fff' : '#5c6f86',
                      }}
                    >
                      {i + 1}
                    </span>
                    <OvrBadge value={p.ovr} size={26} />
                    <span className="w-8 font-cond text-[10px] font-700 uppercase text-muted">{p.pos}</span>
                    <span className="flex-1 truncate text-sm font-600 text-ink">{p.name}</span>
                    {p.injured && <Badge tone="loss">OUT</Badge>}
                  </button>
                ))}
                {!players.length && <div className="px-3 py-3 text-xs text-muted">No players</div>}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
import { capUsed, rosterOf, teamAvgOvr } from '../game/selectors'
import { useGame, useWorld } from '../store/gameStore'
import { PlayerTable } from '../components/PlayerTable'
import { Badge, Button, Card, OvrBadge, PageHeader, Stat } from '../ui/kit'

const SIDES = [
  { id: 'ALL', label: 'All' },
  { id: 'OFF', label: 'Offense' },
  { id: 'DEF', label: 'Defense' },
  { id: 'ST', label: 'Special' },
] as const

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'OT', 'OG', 'C', 'DE', 'DT', 'LB', 'CB', 'S', 'K', 'P']

export function Roster() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const [side, setSide] = useState<(typeof SIDES)[number]['id']>('ALL')
  const [pos, setPos] = useState('ALL')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'ovr' | 'age' | 'name' | 'cap'>('ovr')

  const roster = rosterOf(league, activeTeamId)

  const filtered = useMemo(() => {
    let out = roster.filter((p) => {
      if (side !== 'ALL' && p.side !== side) return false
      if (pos !== 'ALL' && p.pos !== pos) return false
      if (q && !p.name.toLowerCase().includes(q.toLowerCase())) return false
      return true
    })
    out = [...out].sort((a, b) => {
      if (sort === 'ovr') return b.ovr - a.ovr
      if (sort === 'age') return a.age - b.age
      if (sort === 'cap') return b.contract.capHit - a.contract.capHit
      return a.name.localeCompare(b.name)
    })
    return out
  }, [roster, side, pos, q, sort])

  const avgAge = roster.length ? roster.reduce((s, p) => s + p.age, 0) / roster.length : 0
  const used = capUsed(roster)
  const isNFL = league.byId[activeTeamId].tier === 'NFL'

  return (
    <div>
      <PageHeader
        eyebrow="Team"
        title="Roster"
        subtitle={`${roster.length} players · sorted by ${sort === 'ovr' ? 'overall' : sort}`}
        right={
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
            <Search size={16} className="text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search players…"
              className="w-44 bg-transparent text-sm outline-none placeholder:text-faint"
            />
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <Stat label="Players" value={roster.length} sub={`${roster.filter((p) => p.injured).length} injured`} />
        </Card>
        <Card>
          <Stat label="Team Overall" value={Math.round(teamAvgOvr(roster))} sub="Top-22 weighted" />
        </Card>
        <Card>
          <Stat label="Average Age" value={avgAge.toFixed(1)} sub="Roster experience" />
        </Card>
        <Card>
          <Stat label={isNFL ? 'Cap Used' : 'Salary Pool'} value={money(used)} sub={isNFL ? 'of $279.2M limit' : 'coaching + scholarships'} />
        </Card>
      </div>

      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <div className="flex rounded-lg bg-surface-2 p-0.5">
            {SIDES.map((s) => (
              <button
                key={s.id}
                onClick={() => setSide(s.id)}
                className={cn(
                  'rounded-md px-3 py-1 font-cond text-xs font-700 uppercase tracking-wide transition',
                  side === s.id ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink-2',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-1">
            {POSITIONS.map((p) => (
              <button
                key={p}
                onClick={() => setPos(p)}
                className={cn(
                  'rounded-md px-2 py-1 font-cond text-xs font-700 uppercase transition',
                  pos === p ? 'text-[var(--team-ink)]' : 'text-muted hover:bg-surface-2',
                )}
                style={pos === p ? { background: 'var(--team)' } : undefined}
              >
                {p}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="label">Sort</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              className="rounded-md border border-line bg-surface-2 px-2 py-1 font-cond text-xs font-600 uppercase outline-none"
            >
              <option value="ovr">Overall</option>
              <option value="age">Age</option>
              <option value="cap">Cap Hit</option>
              <option value="name">Name</option>
            </select>
            <Badge tone="team">{filtered.length} shown</Badge>
          </div>
        </div>

        <div className="p-2">
          <PlayerTable
            players={filtered}
            showPhysicals
            showFit
            showDeadMoney
            scheme={(league.staff[activeTeamId] ?? []).find((s) => s.role === 'Offensive Coordinator')?.scheme}
            defScheme={(league.staff[activeTeamId] ?? []).find((s) => s.role === 'Defensive Coordinator')?.scheme}
            emptyText="No players match these filters."
          />
        </div>
      </Card>

      {isNFL && (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <PracticeSquadCard teamId={activeTeamId} />
          <InjuredReserveCard teamId={activeTeamId} />
        </div>
      )}
    </div>
  )
}

function PracticeSquadCard({ teamId }: { teamId: string }) {
  const world = useWorld()
  const freeAgents = world.freeAgents
  const signToPracticeSquad = useGame((s) => s.signToPracticeSquad)
  const promote = useGame((s) => s.promoteFromPracticeSquad)
  const release = useGame((s) => s.releaseFromPracticeSquad)
  const [pickId, setPickId] = useState('')

  const squad = world.practiceSquad?.[teamId] ?? []
  const candidates = useMemo(
    () => [...freeAgents].sort((a, b) => b.ovr - a.ovr).slice(0, 30),
    [freeAgents],
  )

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">Practice Squad</h3>
        <Badge tone={squad.length >= 16 ? 'warn' : 'neutral'}>{squad.length}/16</Badge>
      </div>

      <div className="mb-3 flex gap-2">
        <select
          value={pickId}
          onChange={(e) => setPickId(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 font-cond text-xs font-600 outline-none"
        >
          <option value="">Sign a free agent…</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.pos} {p.name} — {p.ovr}/{p.pot} OVR
            </option>
          ))}
        </select>
        <Button
          size="sm"
          disabled={!pickId || squad.length >= 16}
          onClick={() => {
            signToPracticeSquad(pickId)
            setPickId('')
          }}
        >
          Add
        </Button>
      </div>

      <div className="divide-y divide-line/60">
        {squad.length === 0 && <p className="py-3 text-xs text-muted">No players on the practice squad.</p>}
        {squad.map((p) => (
          <div key={p.id} className="flex items-center gap-3 py-2">
            <OvrBadge value={p.ovr} pot={p.pot} size={28} />
            <span className="w-8 font-cond text-[11px] font-700 uppercase text-muted">{p.pos}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-600 text-ink">{p.name}</span>
            <Button size="sm" variant="ghost" onClick={() => promote(p.id)}>Promote</Button>
            <Button size="sm" variant="danger" onClick={() => release(p.id)}>Cut</Button>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-muted">
        The practice squad develops young players (max 16) without using an active roster spot. Promote them when they're ready.
      </p>
    </Card>
  )
}

function InjuredReserveCard({ teamId }: { teamId: string }) {
  const world = useWorld()
  const placeOnIR = useGame((s) => s.placeOnIR)
  const activate = useGame((s) => s.activateFromIR)
  const roster = world.roster[teamId] ?? []
  const ir = world.ir?.[teamId] ?? []
  const eligible = roster.filter((p) => p.injured)

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">Injured Reserve</h3>
        <Badge tone={ir.length ? 'warn' : 'neutral'}>{ir.length}</Badge>
      </div>

      <div className="divide-y divide-line/60">
        {ir.length === 0 && <p className="py-3 text-xs text-muted">No players on injured reserve.</p>}
        {ir.map((p) => {
          const healthy = !p.injured || p.injured.games <= 0
          return (
            <div key={p.id} className="flex items-center gap-3 py-2">
              <OvrBadge value={p.ovr} pot={p.pot} size={28} />
              <span className="w-8 font-cond text-[11px] font-700 uppercase text-muted">{p.pos}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-600 text-ink">{p.name}</span>
                <span className="block text-[11px] text-muted">
                  {p.injured ? `${p.injured.note} · ${p.injured.games}W` : 'Healthy'}
                </span>
              </span>
              <Button size="sm" variant="ghost" disabled={!healthy} onClick={() => activate(p.id)}>
                Activate
              </Button>
            </div>
          )
        })}
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <div className="label mb-2">Place on IR</div>
        <div className="space-y-1.5">
          {eligible.length === 0 && <p className="text-xs text-muted">No injured players available.</p>}
          {eligible.map((p) => (
            <div key={p.id} className="flex items-center gap-3">
              <span className="w-8 font-cond text-[11px] font-700 uppercase text-muted">{p.pos}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{p.name}</span>
              <span className="text-[11px] text-muted">{p.injured?.games}W</span>
              <Button size="sm" variant="default" onClick={() => placeOnIR(p.id)}>Place</Button>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-muted">
        Injured reserve opens an active roster spot while a player heals. Activate him once he's healthy.
      </p>
    </Card>
  )
}

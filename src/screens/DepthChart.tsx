import { Fragment, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react'
import { cn } from '../lib/cn'
import { capabilities, isGM } from '../game/engine/capabilities'
import { STARTERS, depthAt } from '../game/engine/depth'
import { canPitch, pitchSide } from '../game/engine/pitch'
import type { World } from '../game/engine/generate'
import type { Position } from '../game/types'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card, OvrBadge, PageHeader } from '../ui/kit'
import { PlayerName } from '../components/PlayerHoverCard'

// One card per position, so `depthAt` drives each card directly.
type CardDef = { label: string; pos: Position }

const OFF_CARDS: CardDef[] = [
  { label: 'Quarterback', pos: 'QB' },
  { label: 'Running Back', pos: 'RB' },
  { label: 'Wide Receiver', pos: 'WR' },
  { label: 'Tight End', pos: 'TE' },
  { label: 'Tackles', pos: 'OT' },
  { label: 'Guards', pos: 'OG' },
  { label: 'Center', pos: 'C' },
]
const DEF_CARDS: CardDef[] = [
  { label: 'Edge', pos: 'DE' },
  { label: 'Interior', pos: 'DT' },
  { label: 'Linebackers', pos: 'LB' },
  { label: 'Cornerbacks', pos: 'CB' },
  { label: 'Safeties', pos: 'S' },
]
const ST_CARDS: CardDef[] = [
  { label: 'Kicker', pos: 'K' },
  { label: 'Punter', pos: 'P' },
]

export function DepthChart() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const career = useGame((s) => s.career)
  const selectPlayer = useGame((s) => s.selectPlayer)
  const moveDepth = useGame((s) => s.moveDepth)
  const setStarter = useGame((s) => s.setStarter)
  const resetDepthChart = useGame((s) => s.resetDepthChart)
  const pitchStarter = useGame((s) => s.pitchStarter)
  const staff = league.staff[activeTeamId] ?? []

  const editable =
    !!career &&
    activeTeamId === career.teamId &&
    (isGM(career) || capabilities(career).can.has('gameManagement') || capabilities(career).can.has('callPlays'))

  // K3: a position coach can pitch one starter a week, for his side of the ball.
  const pitching = !!career && activeTeamId === career.teamId && canPitch(career)
  const pitchPositions = pitching && career ? pitchSide(career) : []
  const pitchUsed = !!career?.weekFlags?.pitch

  return (
    <div>
      <PageHeader
        eyebrow="Team"
        title="Depth Chart"
        subtitle={
          editable
            ? 'Set your starters. Move players up or down, or start anyone; click a player for his full profile.'
            : 'The head coach sets the depth chart. Click a player to view his full profile.'
        }
        right={
          <div className="flex items-center gap-2">
            <Badge tone="team">OFF: {staff.find((s) => s.role === 'Offensive Coordinator')?.scheme ?? 'Balanced'}</Badge>
            <Badge tone="info">DEF: {staff.find((s) => s.role === 'Defensive Coordinator')?.scheme ?? 'Multiple'}</Badge>
            {editable && (
              <Button variant="default" size="sm" onClick={resetDepthChart} title="Drop your order and fall back to ratings">
                <RotateCcw size={13} /> Reset to ratings
              </Button>
            )}
          </div>
        }
      />

      {!editable && (
        <div className="mb-4 rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-muted">
          The head coach sets the depth chart.
        </div>
      )}

      <div className="space-y-5">
        <Unit
          title="Offense"
          accent="var(--team)"
          cards={OFF_CARDS}
          world={league}
          teamId={activeTeamId}
          editable={editable}
          onSelect={selectPlayer}
          onMove={moveDepth}
          onStart={setStarter}
          pitchPositions={pitchPositions}
          pitchUsed={pitchUsed}
          onPitch={pitchStarter}
        />
        <Unit
          title="Defense"
          accent="#0b62ff"
          cards={DEF_CARDS}
          world={league}
          teamId={activeTeamId}
          editable={editable}
          onSelect={selectPlayer}
          onMove={moveDepth}
          onStart={setStarter}
          pitchPositions={pitchPositions}
          pitchUsed={pitchUsed}
          onPitch={pitchStarter}
        />
        <Unit
          title="Special Teams"
          accent="#c99a2e"
          cards={ST_CARDS}
          world={league}
          teamId={activeTeamId}
          editable={editable}
          onSelect={selectPlayer}
          onMove={moveDepth}
          onStart={setStarter}
          pitchPositions={pitchPositions}
          pitchUsed={pitchUsed}
          onPitch={pitchStarter}
        />
      </div>
    </div>
  )
}

function Unit({
  title,
  accent,
  cards,
  world,
  teamId,
  editable,
  onSelect,
  onMove,
  onStart,
  pitchPositions,
  pitchUsed,
  onPitch,
}: {
  title: string
  accent: string
  cards: CardDef[]
  world: World
  teamId: string
  editable: boolean
  onSelect: (id: string) => void
  onMove: (pos: Position, playerId: string, dir: -1 | 1) => void
  onStart: (pos: Position, playerId: string) => void
  pitchPositions: Position[]
  pitchUsed: boolean
  onPitch: (pos: Position, playerId: string) => void
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <span className="h-4 w-1.5 rounded-full" style={{ background: accent }} />
        <h3 className="font-display text-xl font-700 uppercase tracking-wide">{title}</h3>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => {
          const players = depthAt(world, teamId, c.pos)
          const starters = STARTERS[c.pos] ?? 1
          return (
            <Card key={c.pos} pad={false} className="overflow-hidden">
              <div className="border-b border-line bg-surface-2 px-3 py-1.5">
                <span className="label">{c.label}</span>
              </div>
              <div className="divide-y divide-line/60">
                {players.map((p, i) => {
                  const starter = i < starters
                  return (
                    <Fragment key={p.id}>
                      {i === starters && (
                        <div className="flex items-center gap-2 bg-surface-2 px-3 py-1">
                          <span className="h-px flex-1 bg-line" />
                          <span className="font-cond text-[9px] font-700 uppercase tracking-wider text-muted">Bench</span>
                          <span className="h-px flex-1 bg-line" />
                        </div>
                      )}
                      <div className="flex w-full items-center gap-2 px-3 py-2 transition hover:bg-[var(--team-soft)]">
                        <button
                          type="button"
                          onClick={() => onSelect(p.id)}
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                        >
                          <span
                            className="grid h-5 w-5 shrink-0 place-items-center rounded font-cond text-[10px] font-700"
                            style={{
                              background: starter ? accent : 'var(--color-surface-3)',
                              color: starter ? '#fff' : 'var(--color-muted)',
                            }}
                          >
                            {i + 1}
                          </span>
                          <OvrBadge value={p.ovr} pot={p.pot} size={26} />
                          <span className="w-8 font-cond text-[10px] font-700 uppercase text-muted">{p.pos}</span>
                          <span className="min-w-0 flex-1 truncate"><PlayerName player={p} className="text-sm font-600 text-ink" /></span>
                          {p.injured && <Badge tone="loss">OUT</Badge>}
                        </button>
                        {editable && (
                          <div className="flex shrink-0 items-center gap-1">
                            {!starter && (
                              <Button
                                variant="team"
                                size="sm"
                                title="Make starter"
                                onClick={() => onStart(c.pos, p.id)}
                              >
                                Start
                              </Button>
                            )}
                            <IconBtn
                              title="Move up"
                              disabled={i === 0}
                              onClick={() => onMove(c.pos, p.id, -1)}
                            >
                              <ChevronUp size={14} />
                            </IconBtn>
                            <IconBtn
                              title="Move down"
                              disabled={i === players.length - 1}
                              onClick={() => onMove(c.pos, p.id, 1)}
                            >
                              <ChevronDown size={14} />
                            </IconBtn>
                          </div>
                        )}
                        {pitchPositions.includes(c.pos) && i > 0 && (
                          <Button
                            variant="default"
                            size="sm"
                            disabled={pitchUsed}
                            title={pitchUsed ? 'Already pitched a starter this week' : 'Pitch him to the coordinator'}
                            onClick={() => onPitch(c.pos, p.id)}
                          >
                            Pitch
                          </Button>
                        )}
                      </div>
                    </Fragment>
                  )
                })}
                {!players.length && <div className="px-3 py-3 text-xs text-muted">No players</div>}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function IconBtn({
  children,
  title,
  disabled,
  onClick,
}: {
  children: ReactNode
  title: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid h-6 w-6 place-items-center rounded-md border border-line bg-surface text-ink-2 transition',
        'hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-30',
      )}
    >
      {children}
    </button>
  )
}

import { Fragment, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react'
import { cn } from '../lib/cn'
import { capabilities, isGM } from '../game/engine/capabilities'
import { STARTERS, depthAt } from '../game/engine/depth'
import { canPitch, pitchSide } from '../game/engine/pitch'
import { clubReturners, isReturnEligible, RETURN_INFO, returnerStatus, returnInputs, returnRating, RETURN_WEIGHTS, returnScore } from '../game/engine/returns'
import type { World } from '../game/engine/generate'
import type { Player, Position } from '../game/types'
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
  const setReturner = useGame((s) => s.setReturner)
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
        >
          <ReturnerCard
            role="kr"
            world={league}
            teamId={activeTeamId}
            editable={editable}
            onPick={(r, id) => setReturner(r, id)}
            onAuto={(r) => setReturner(r, null)}
          />
          <ReturnerCard
            role="pr"
            world={league}
            teamId={activeTeamId}
            editable={editable}
            onPick={(r, id) => setReturner(r, id)}
            onAuto={(r) => setReturner(r, null)}
          />
        </Unit>
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
  children,
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
  /** Extra cards (R6 returners) rendered in the same grid as the position cards. */
  children?: ReactNode
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
        {children}
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

/** R6: the Return rating bubble — the rounded `returnScore` the sim fields. */
function ReturnBadge({ player, size = 26, className }: { player: Player; size?: number; className?: string }) {
  return (
    <span title={`${player.name} — ${RETURN_INFO}`} className={cn('inline-flex', className)}>
      <OvrBadge value={returnRating(player)} size={size} />
    </span>
  )
}

/**
 * R6: the five sim inputs behind the Return rating, using canonical `playerAttrs`
 * with the same 70 default `returnScore` applies when a position lacks one.
 */
function returnStrip(p: Player): string {
  return returnInputs(p)
    .map((v, i) => `${RETURN_WEIGHTS[i].key} ${v}`)
    .join(' · ')
}

/**
 * R6: one Kick Returner or Punt Returner card. Shows the effective returner (the
 * auto pick, or a healthy manual choice), flags a manual pick that has fallen back
 * after injury/transfer/release, and lists every eligible WR/RB/CB on the roster
 * sorted by return ability. Read-only for clubs the user does not run.
 */
function ReturnerCard({
  role,
  world,
  teamId,
  editable,
  onPick,
  onAuto,
}: {
  role: 'kr' | 'pr'
  world: World
  teamId: string
  editable: boolean
  onPick: (role: 'kr' | 'pr', id: string) => void
  onAuto: (role: 'kr' | 'pr') => void
}) {
  const status = returnerStatus(world, teamId, role)
  const eff = status.effective
  const { kr, pr } = clubReturners(world, teamId)
  const title = role === 'kr' ? 'Kick Returner' : 'Punt Returner'
  // Every eligible player, healthy first then by return ability — no hidden top-3 cap.
  const candidates = (world.roster[teamId] ?? [])
    .filter(isReturnEligible)
    .sort((a, b) => Number(!!a.injured) - Number(!!b.injured) || returnScore(b) - returnScore(a))

  return (
    <Card pad={false} className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-3 py-1.5">
        <span className="label">{title}</span>
        {status.manual ? <Badge tone="team">Set</Badge> : <Badge tone="neutral">Auto</Badge>}
      </div>

      <div className="flex items-center gap-2.5 px-3 py-2">
        {eff ? (
          <>
            <span className="flex shrink-0 flex-col items-center gap-0.5">
              <ReturnBadge player={eff} size={30} />
              <span className="font-cond text-[9px] font-700 uppercase tracking-wide text-muted">RET</span>
            </span>
            <div className="min-w-0 flex-1">
              <PlayerName player={eff} className="text-sm font-600 text-ink" />
              <div className="truncate text-[11px] text-muted">
                {status.manual ? 'Selected' : 'Automatic pick'} · {eff.pos}
              </div>
            </div>
            {editable && status.requested && (
              <Button
                variant="ghost"
                size="sm"
                title={status.manual ? 'Clear this pick and return to Auto' : 'Clear the unavailable pick'}
                onClick={() => onAuto(role)}
              >
                {status.manual ? 'Auto' : 'Clear'}
              </Button>
            )}
          </>
        ) : (
          <div className="text-xs text-muted">No eligible returner on the roster.</div>
        )}
      </div>

      {status.requested && !status.manual && (
        <div className="mx-3 mb-2 rounded-md border border-warn/40 bg-warn/10 px-2 py-1 text-[11px] text-warn">
          {eff ? `Your pick is unavailable — ${eff.name} returns instead.` : 'Your pick is unavailable — no replacement on the roster.'}
        </div>
      )}

      {editable && (
        <div className="max-h-56 divide-y divide-line/60 overflow-y-auto border-t border-line">
          {candidates.map((p) => {
            const selected = status.manual && p.id === eff?.id
            const isKr = kr?.id === p.id
            const isPr = pr?.id === p.id
            const out = !!p.injured
            return (
              <button
                key={p.id}
                type="button"
                disabled={out}
                onClick={() => onPick(role, p.id)}
                title={out ? `${p.name} is out — unavailable` : `Make ${p.name} the ${role === 'kr' ? 'kick' : 'punt'} returner`}
                className={cn(
                  'flex w-full items-start gap-2 px-3 py-1.5 text-left transition',
                  selected ? 'bg-[var(--team-soft)]' : 'hover:bg-surface-2',
                  out ? 'cursor-not-allowed opacity-50' : '',
                )}
              >
                <ReturnBadge player={p} size={24} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1">
                    <PlayerName player={p} className="truncate text-sm font-600 text-ink" />
                    <span className="font-cond text-[10px] font-700 uppercase text-muted">{p.pos}</span>
                    {isKr && <Badge tone="team">KR</Badge>}
                    {isPr && <Badge tone="info">PR</Badge>}
                    {out && <Badge tone="loss">OUT</Badge>}
                  </span>
                  <span className="mt-0.5 block truncate font-cond text-[10px] tnum text-muted" title={RETURN_INFO}>
                    {returnStrip(p)}
                  </span>
                </span>
                {selected && <span className="shrink-0 text-xs font-700 text-win">✓</span>}
              </button>
            )
          })}
          {!candidates.length && <div className="px-3 py-3 text-xs text-muted">No eligible players.</div>}
        </div>
      )}
    </Card>
  )
}

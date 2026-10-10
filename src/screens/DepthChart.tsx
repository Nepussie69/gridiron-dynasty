import { Fragment, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react'
import { cn } from '../lib/cn'
import { capabilities, isGM } from '../game/engine/capabilities'
import { STARTERS, depthAt } from '../game/engine/depth'
import { canPitch, pitchSide } from '../game/engine/pitch'
import { clubReturners, isReturnEligible, RETURN_INFO, returnerStatus, returnInputs, returnRating, RETURN_WEIGHTS, returnScore } from '../game/engine/returns'
import type { World } from '../game/engine/generate'
import type { Player, Position } from '../game/types'
import { useGame, useWorld } from '../store/gameStore'
import {
  AccessBanner,
  Badge,
  Button,
  Card,
  Delta,
  IconButton,
  OvrBadge,
  OverflowMenu,
  PageHeader,
  SectionTitle,
  Tabs,
  type MenuItem,
} from '../ui/kit'
import { usePhone } from '../ui/hooks'
import { PlayerName } from '../components/PlayerHoverCard'
import { InjuryChip } from '../components/PlayerTable'

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

type UnitId = 'OFF' | 'DEF' | 'ST'

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
  const phone = usePhone()
  const [unitTab, setUnitTab] = useState<UnitId>('OFF')

  const editable =
    !!career &&
    activeTeamId === career.teamId &&
    (isGM(career) || capabilities(career).can.has('gameManagement') || capabilities(career).can.has('callPlays'))

  // K3: a position coach can pitch one starter a week, for his side of the ball.
  const pitching = !!career && activeTeamId === career.teamId && canPitch(career)
  const pitchPositions = pitching && career ? pitchSide(career) : []
  const pitchUsed = !!career?.weekFlags?.pitch

  const unitProps = {
    world: league,
    teamId: activeTeamId,
    editable,
    onSelect: selectPlayer,
    onMove: moveDepth,
    onStart: setStarter,
    pitchPositions,
    pitchUsed,
    onPitch: pitchStarter,
  }

  const offense = <Unit key="off" title="Offense" cards={OFF_CARDS} {...unitProps} />
  const defense = <Unit key="def" title="Defense" cards={DEF_CARDS} {...unitProps} />
  const special = (
    <Unit key="st" title="Special Teams" cards={ST_CARDS} {...unitProps}>
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
  )

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
            {editable && (
              <Button variant="secondary" size="md" onClick={resetDepthChart} title="Drop your order and fall back to ratings">
                <RotateCcw size={14} aria-hidden /> Reset to ratings
              </Button>
            )}
          </div>
        }
      />

      <AccessBanner
        area="roster"
        className="mb-4"
        message={
          !editable ? (
            <>
              <b className="font-600 text-ink">The head coach sets the depth chart.</b> You can read every unit and
              click a player for his profile.
            </>
          ) : undefined
        }
      />

      {phone ? (
        <>
          <Tabs
            label="Unit"
            value={unitTab}
            onChange={setUnitTab}
            stretch
            className="mb-4"
            tabs={[
              { id: 'OFF', label: 'Offense' },
              { id: 'DEF', label: 'Defense' },
              { id: 'ST', label: 'Special' },
            ]}
          />
          {unitTab === 'OFF' ? offense : unitTab === 'DEF' ? defense : special}
        </>
      ) : (
        <div className="space-y-5">
          {offense}
          {defense}
          {special}
        </div>
      )}
    </div>
  )
}

function Unit({
  title,
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
      <SectionTitle className="mb-2">{title}</SectionTitle>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => {
          const players = depthAt(world, teamId, c.pos)
          const starters = STARTERS[c.pos] ?? 1
          return (
            <Card key={c.pos} pad={false} className="overflow-hidden">
              <div className="border-b border-line bg-surface-2 px-3 py-1.5">
                <span className="label">{c.label}</span>
              </div>
              <div>
                {players.map((p, i) => {
                  const starter = i < starters
                  const gap = i > 0 ? players[0].ovr - p.ovr : 0
                  const startItem: MenuItem = {
                    id: 'start',
                    label: `Start ${p.name.split(' ').slice(-1)[0]}`,
                    description: starter ? 'Already the starter' : `Make him the ${c.label.toLowerCase()} starter`,
                    disabled: starter,
                    onSelect: () => onStart(c.pos, p.id),
                  }
                  return (
                    <Fragment key={p.id}>
                      {i === 0 && starters > 0 && <Band>Starter{starters > 1 ? 's' : ''}</Band>}
                      {i === starters && starters > 0 && <Band>Backups</Band>}
                      <div
                        className={cn(
                          'flex flex-wrap items-center gap-2 px-3 py-2 transition hover:bg-[var(--team-tint)]',
                          starter && 'shadow-[inset_3px_0_0_var(--team-accent)]',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => onSelect(p.id)}
                          className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 text-left lg:min-h-0"
                        >
                          <span
                            className={cn(
                              'grid h-6 w-6 shrink-0 place-items-center rounded-[var(--r-xs)] font-cond text-label font-700 tnum',
                              starter
                                ? 'bg-[var(--team-fill)] text-[var(--team-on)] shadow-[var(--team-slab-ring)]'
                                : 'bg-surface-3 text-muted',
                            )}
                          >
                            {i + 1}
                          </span>
                          <OvrBadge value={p.ovr} pot={p.pot} size={28} />
                          <span className="w-8 font-cond text-label font-700 uppercase text-muted">{p.pos}</span>
                          <span className="min-w-0 flex-1 truncate">
                            <PlayerName player={p} className="text-small font-600 text-ink" />
                          </span>
                          {gap > 0 && <Delta value={-gap} suffix="OVR" />}
                          <InjuryChip player={p} />
                        </button>
                        {editable && (
                          <div className="flex shrink-0 items-center gap-1">
                            <IconButton
                              label="Move up"
                              size="md"
                              disabled={i === 0}
                              onClick={() => onMove(c.pos, p.id, -1)}
                            >
                              <ChevronUp size={16} />
                            </IconButton>
                            <IconButton
                              label="Move down"
                              size="md"
                              disabled={i === players.length - 1}
                              onClick={() => onMove(c.pos, p.id, 1)}
                            >
                              <ChevronDown size={16} />
                            </IconButton>
                            {!starter && <OverflowMenu items={[startItem, { id: 'up', label: 'Move up', description: 'One spot up the chart', onSelect: () => onMove(c.pos, p.id, -1) }]} label={`Actions for ${p.name}`} size="sm" />}
                          </div>
                        )}
                        {pitchPositions.includes(c.pos) && i > 0 && (
                          <Button
                            variant="secondary"
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
                {!players.length && <div className="px-3 py-3 text-small text-muted">No players</div>}
              </div>
            </Card>
          )
        })}
        {children}
      </div>
    </div>
  )
}

/** A slim divider band marking the starter/backup split. */
function Band({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 bg-surface-2 px-3 py-1">
      <span className="h-px flex-1 bg-line" />
      <span className="font-cond text-micro font-700 uppercase tracking-wider text-muted">{children}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
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
        {status.manual ? <Badge tone="neutral">Set</Badge> : <Badge tone="neutral">Auto</Badge>}
      </div>

      <div className="flex items-center gap-2.5 px-3 py-2">
        {eff ? (
          <>
            <span className="flex shrink-0 flex-col items-center gap-0.5">
              <ReturnBadge player={eff} size={30} />
              <span className="font-cond text-micro font-700 uppercase tracking-wide text-muted">RET</span>
            </span>
            <div className="min-w-0 flex-1">
              <PlayerName player={eff} className="text-small font-600 text-ink" />
              <div className="truncate text-label text-muted">
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
          <div className="text-small text-muted">No eligible returner on the roster.</div>
        )}
      </div>

      {status.requested && !status.manual && (
        <div className="mx-3 mb-2 rounded-[var(--r-md)] border border-warn/40 bg-warn-soft px-2 py-1 text-label text-warn">
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
                  selected ? 'bg-[var(--team-tint)]' : 'hover:bg-surface-2',
                  out ? 'cursor-not-allowed opacity-50' : '',
                )}
              >
                <ReturnBadge player={p} size={24} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1">
                    <PlayerName player={p} className="truncate text-small font-600 text-ink" />
                    <span className="font-cond text-label font-700 uppercase text-muted">{p.pos}</span>
                    {isKr && <Badge tone="neutral">KR</Badge>}
                    {isPr && <Badge tone="info">PR</Badge>}
                    {out && <Badge tone="loss">OUT {p.injured?.games}W</Badge>}
                  </span>
                  <span className="mt-0.5 block truncate font-cond text-micro tnum text-muted" title={RETURN_INFO}>
                    {returnStrip(p)}
                  </span>
                </span>
                {selected && <span className="shrink-0 text-small font-700 text-win">✓</span>}
              </button>
            )
          })}
          {!candidates.length && <div className="px-3 py-3 text-small text-muted">No eligible players.</div>}
        </div>
      )}
    </Card>
  )
}

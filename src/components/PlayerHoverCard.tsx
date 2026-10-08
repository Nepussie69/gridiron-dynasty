import { cn } from '../lib/cn'
import { money } from '../lib/format'
import { playerAttrs } from '../game/data/ratings'
import { baseGroup, COMPOSITES, groupForPosition, RATING_COLUMNS } from '../game/data/ratingInfo'
import { fitLabel } from '../game/engine/style'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, OvrBadge } from '../ui/kit'
import { HoverCard } from './HoverCard'
import type { ReactNode } from 'react'
import type { Player } from '../game/types'

/** Same tint tiers as the Ratings tab (L12 R2). */
function valueClass(v: number): string {
  if (v >= 90) return 'bg-win/10 text-win font-700'
  if (v >= 80) return 'bg-brand/10 text-brand font-600'
  if (v >= 70) return 'text-ink-2'
  return 'text-muted'
}

/**
 * L12.5 T2: a player name whose hover / focus reveals his card without leaving
 * the Trade Center. Shows bio, contract, injury, scheme fit for YOUR club, then
 * the position group's composites and rating columns from `playerAttrs`.
 *
 * L12.8 V2: pass `children` to use a custom trigger (a compact top-player chip);
 * pass `info={false}` to drop the ⓘ button on those chips.
 */
export function PlayerHoverCard({
  player,
  className,
  children,
  info = true,
}: {
  player: Player
  className?: string
  children?: ReactNode
  info?: boolean
}) {
  const league = useWorld()
  const career = useGame((s) => s.career)
  const activeTeamId = useGame((s) => s.activeTeamId)
  const viewer = career?.teamId ?? activeTeamId

  const staff = league.staff[viewer] ?? []
  const role = player.side === 'DEF' ? 'Defensive Coordinator' : 'Offensive Coordinator'
  const scheme = staff.find((s) => s.role === role)?.scheme
  const fit = scheme ? fitLabel(player, scheme, player.side === 'DEF' ? 'DEF' : 'OFF') : null

  const attrs = playerAttrs(player)
  const group = groupForPosition(player.pos)
  const key = group ? baseGroup(group) : 'ALL'
  const composites = COMPOSITES[key] ?? []
  const ratings = (RATING_COLUMNS[key] ?? RATING_COLUMNS.ALL).filter((k) => attrs[k] !== undefined)

  const capHit = player.contract.capHit
  const years = player.contract.years

  return (
    <HoverCard
      className={className}
      info={info}
      label={`Details for ${player.name}`}
      content={
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <OvrBadge value={player.ovr} pot={player.pot} size={28} />
            <div className="min-w-0">
              <div className="truncate font-display text-sm font-700 uppercase leading-none text-ink">
                {player.name}
              </div>
              <div className="mt-0.5 text-[10px] tnum text-muted">
                {player.pos} · age {player.age} · {money(capHit)} · {years} yr{years === 1 ? '' : 's'} left
              </div>
            </div>
          </div>

          <div className="text-[10px] tnum text-muted">
            Contract: {money(player.contract.capHit)} cap hit · {years} yr{years === 1 ? '' : 's'} · {money(player.contract.guaranteed ?? 0)} guaranteed · {player.dev} dev
          </div>

          {player.traits.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {player.traits.map((t) => <Badge key={t} tone="neutral">{t}</Badge>)}
            </div>
          )}

          {player.injured && (
            <Badge tone="loss">
              OUT {player.injured.games}W · {player.injured.note}
            </Badge>
          )}

          {scheme && fit && (
            <div className="flex items-center justify-between rounded-md border border-line/60 px-1.5 py-0.5">
              <span className="truncate text-[10px] text-muted">Scheme fit · {scheme}</span>
              <Badge tone={fit === 'Ideal' ? 'win' : fit === 'Good' ? 'info' : 'loss'}>{fit}</Badge>
            </div>
          )}

          {composites.length > 0 && (
            <div>
              <div className="label mb-0.5 !text-[9px]">Composites</div>
              <div className="grid grid-cols-5 gap-0.5">
                {composites.map((c) => {
                  const v = Math.round(c.compute(attrs))
                  return (
                    <div key={c.id} title={c.title} className={cn('rounded border border-line/50 px-0.5 py-px text-center', valueClass(v))}>
                      <div className="truncate font-cond text-[8px] font-700 uppercase leading-tight opacity-80">{c.label}</div>
                      <div className="font-display text-xs font-700 leading-tight tnum">{v}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {ratings.length > 0 && (
            <div>
              <div className="label mb-0.5 !text-[9px]">Ratings</div>
              <div className="grid grid-cols-6 gap-0.5">
                {ratings.map((k) => {
                  const v = attrs[k]
                  return (
                    <div key={k} className={cn('rounded border border-line/50 px-0.5 py-px text-center', valueClass(v))}>
                      <div className="truncate font-cond text-[8px] font-700 uppercase leading-tight opacity-80">{k}</div>
                      <div className="font-display text-xs font-700 leading-tight tnum">{Math.round(v)}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      }
    >
      {children ?? <span className={cn('truncate', className)}>{player.name}</span>}
    </HoverCard>
  )
}

/** A player's name that shows his full card on hover (ratings, traits, contract) — no click needed. */
export function PlayerName({ player, className }: { player: Player; className?: string }) {
  return <PlayerHoverCard player={player} className={className} info={false} />
}

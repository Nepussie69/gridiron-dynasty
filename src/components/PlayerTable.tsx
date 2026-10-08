import { useMemo, useState, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
import type { Contract, Player, Position } from '../game/types'
import { ATTRIBUTE_SCHEMA, playerAttrs } from '../game/data/ratings'
import { COMPOSITES, ratingTitle, groupForPosition, type Composite } from '../game/data/ratingInfo'
import { capSavings, deadMoney } from '../game/engine/cap'
import { fitLabel, schemeFit } from '../game/engine/style'
import { masteryLabel, masteryProgress } from '../game/engine/playbook'
import { useGame } from '../store/gameStore'
import { Badge, DevBadge, OvrBadge, RatingBar } from '../ui/kit'
import { PlayerName } from './PlayerHoverCard'

type SortKey =
  | 'name' | 'age' | 'ovr' | 'pot' | 'dev' | 'pbk' | 'cap' | 'dead' | 'yrs' | 'fit'
  | `composite:${string}` | `rating:${string}`
type SortDir = 'asc' | 'desc'

const DEV_RANK: Record<string, number> = {
  'X-Factor': 6,
  Superstar: 5,
  Star: 4,
  Starter: 3,
  Depth: 2,
  Backup: 1,
}

/** Value used to sort a row by column, mirroring DataTable's `sortValue`. */
function sortValue(
  p: Player,
  key: SortKey,
  scheme?: string,
  defScheme?: string,
  attrs?: Record<string, number>,
  composites?: Composite[],
): number | string | null {
  switch (key) {
    case 'name':
      return p.name
    case 'age':
      return p.age
    case 'ovr':
      return p.ovr
    case 'pot':
      return p.pot
    case 'dev':
      return DEV_RANK[p.dev] ?? 0
    case 'pbk':
      return masteryProgress(p)
    case 'cap':
      return p.contract.capHit
    case 'dead':
      return deadMoney(p.contract)
    case 'yrs':
      return p.contract.years
    case 'fit': {
      if (p.side === 'ST') return -1
      const useScheme = p.side === 'DEF' ? defScheme : scheme
      return useScheme ? schemeFit(p, useScheme, p.side === 'DEF' ? 'DEF' : 'OFF') : -1
    }
    default: {
      // R4a: inline composites / ratings when a single position is filtered.
      if (key.startsWith('composite:')) {
        const c = composites?.find((x) => x.id === key.slice(10))
        return c && attrs ? c.compute(attrs) : null
      }
      return attrs?.[key.slice(7)] ?? null
    }
  }
}

/** Rating tint, matching the Ratings tab (missing values are faint). */
function ratingTint(v: number | null | undefined): string {
  if (v == null) return 'text-faint'
  if (v >= 90) return 'bg-win/10 text-win font-700'
  if (v >= 80) return 'bg-brand/10 text-brand font-600'
  if (v >= 70) return 'text-ink-2'
  return 'text-muted'
}

/**
 * Dead money if released now, plus the cap savings — with a colour cue so you
 * can see at a glance whether cutting a player helps or hurts the cap.
 */
export function DeadMoneyCell({ contract }: { contract: Contract }) {
  const dead = deadMoney(contract)
  const save = capSavings(contract)
  const hurts = save < 0
  return (
    <span className={cn('font-cond text-xs font-700 tnum', hurts ? 'text-loss' : 'text-ink-2')}>
      {money(dead)}
    </span>
  )
}

/** Scheme-fit chip: warns when a player doesn't suit the coordinator's system. */
export function FitBadge({ player, scheme, defScheme }: { player: Player; scheme?: string; defScheme?: string }) {
  if (player.side === 'ST') return <span className="text-faint">—</span>
  const useScheme = player.side === 'DEF' ? defScheme : scheme
  if (!useScheme) return <span className="text-faint">—</span>
  const fit = fitLabel(player, useScheme, player.side === 'DEF' ? 'DEF' : 'OFF')
  return (
    <Badge tone={fit === 'Ideal' ? 'win' : fit === 'Good' ? 'info' : 'loss'}>
      {fit}
    </Badge>
  )
}

export { schemeFit }

interface Props {
  players: Player[]
  showContract?: boolean
  showDeadMoney?: boolean
  showCollege?: boolean
  showMorale?: boolean
  showPhysicals?: boolean
  showFit?: boolean
  scheme?: string
  defScheme?: string
  /** R4a: when a single position is filtered, show its composites + first 4 ratings. */
  inlinePos?: Position
  rank?: boolean
  right?: (p: Player) => ReactNode
  emptyText?: string
}

export function PlayerTable({
  players,
  showContract = true,
  showDeadMoney = false,
  showCollege = false,
  showMorale = false,
  showPhysicals = false,
  showFit = false,
  scheme,
  defScheme,
  inlinePos,
  rank = false,
  right,
  emptyText = 'No players to show.',
}: Props) {
  const selectPlayer = useGame((s) => s.selectPlayer)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [dir, setDir] = useState<SortDir>('asc')

  const inlineGroup = inlinePos ? groupForPosition(inlinePos) : null
  const inlineComposites = useMemo(() => (inlineGroup ? COMPOSITES[inlineGroup] ?? [] : []), [inlineGroup])
  const inlineRatings = useMemo(
    () => (inlinePos ? (ATTRIBUTE_SCHEMA[inlinePos] ?? []).slice(0, 4) : []),
    [inlinePos],
  )
  const attrsById = useMemo(() => {
    const m = new Map<string, Record<string, number>>()
    if (inlinePos) for (const p of players) m.set(p.id, playerAttrs(p))
    return m
  }, [players, inlinePos])

  const sorted = useMemo(() => {
    if (!sortKey) return players
    const copy = [...players]
    copy.sort((a, b) => {
      const va = sortValue(a, sortKey, scheme, defScheme, attrsById.get(a.id), inlineComposites)
      const vb = sortValue(b, sortKey, scheme, defScheme, attrsById.get(b.id), inlineComposites)
      const ma = va == null
      const mb = vb == null
      if (ma && mb) return a.name.localeCompare(b.name)
      if (ma) return 1
      if (mb) return -1
      const cmp =
        typeof va === 'string' || typeof vb === 'string'
          ? String(va).localeCompare(String(vb))
          : (va as number) - (vb as number)
      return dir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [players, sortKey, dir, scheme, defScheme, attrsById, inlineComposites])

  const toggle = (key: SortKey) => {
    if (sortKey !== key) {
      setSortKey(key)
      setDir('asc')
    } else if (dir === 'asc') {
      setDir('desc')
    } else {
      setSortKey(null)
      setDir('asc')
    }
  }

  if (!players.length) {
    return <div className="py-10 text-center text-sm text-muted">{emptyText}</div>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm tnum">
        <thead>
          <tr className="border-b border-line text-left">
            {rank && <Th className="w-8">#</Th>}
            <Th className="w-10 sticky left-0 bg-surface"></Th>
            <Th className="sticky left-10 bg-surface" onClick={() => toggle('name')} active={sortKey === 'name'} dir={dir}>Player</Th>
            <Th className="w-12 text-right" onClick={() => toggle('age')} active={sortKey === 'age'} dir={dir}>Age</Th>
            {showPhysicals && <Th className="w-24">Ht/Wt</Th>}
            {showFit && <Th className="w-20 text-center" onClick={() => toggle('fit')} active={sortKey === 'fit'} dir={dir}>Fit</Th>}
            {showCollege && <Th className="w-40">College</Th>}
            <Th className="w-14 text-center" onClick={() => toggle('dev')} active={sortKey === 'dev'} dir={dir}>Dev</Th>
            <Th className="w-14 text-center" onClick={() => toggle('ovr')} active={sortKey === 'ovr'} dir={dir}>OVR</Th>
            <Th className="w-14 text-center" onClick={() => toggle('pot')} active={sortKey === 'pot'} dir={dir}>POT</Th>
            {inlineComposites.map((c) => (
              <Th
                key={c.id}
                className="w-16 text-center text-ink"
                title={c.title}
                onClick={() => toggle(`composite:${c.id}`)}
                active={sortKey === `composite:${c.id}`}
                dir={dir}
              >
                {c.label}
              </Th>
            ))}
            {inlineRatings.map((k) => (
              <Th
                key={k}
                className="w-12 text-center"
                title={ratingTitle(k)}
                onClick={() => toggle(`rating:${k}`)}
                active={sortKey === `rating:${k}`}
                dir={dir}
              >
                {k}
              </Th>
            ))}
            <Th className="w-24 text-center" onClick={() => toggle('pbk')} active={sortKey === 'pbk'} dir={dir}>Playbook</Th>
            {showMorale && <Th className="w-20">Morale</Th>}
            {showContract && <Th className="w-20 text-right" onClick={() => toggle('cap')} active={sortKey === 'cap'} dir={dir}>Cap Hit</Th>}
            {showDeadMoney && <Th className="w-20 text-right" onClick={() => toggle('dead')} active={sortKey === 'dead'} dir={dir}>Dead $</Th>}
            {showContract && <Th className="w-14 text-right" onClick={() => toggle('yrs')} active={sortKey === 'yrs'} dir={dir}>Yrs</Th>}
            {right && <Th className="w-36 text-right">Action</Th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => (
            <tr
              key={p.id}
              onClick={() => selectPlayer(p.id)}
              className="cursor-pointer border-b border-line/60 transition hover:bg-[var(--team-soft)]"
            >
              {rank && <Td className="font-cond text-muted">{i + 1}</Td>}
              <Td className="sticky left-0 bg-surface">
                <OvrBadge value={p.ovr} pot={p.pot} size={30} />
              </Td>
              <Td className="sticky left-10 bg-surface">
                <div className="flex items-center gap-2">
                  <span className="font-cond text-[11px] font-700 uppercase text-muted">{p.pos}</span>
                  <PlayerName player={p} className="font-600 text-ink" />
                  {p.injured && <Badge tone="loss">{p.injured.note}</Badge>}
                </div>
              </Td>
              <Td className="text-right text-ink-2">{p.age}</Td>
              {showPhysicals && (
                <Td className="text-muted">
                  {p.height} · {p.weight}
                </Td>
              )}
              {showFit && (
                <Td className="text-center">
                  <FitBadge player={p} scheme={scheme} defScheme={defScheme} />
                </Td>
              )}
              {showCollege && <Td className="truncate text-muted">{p.college}</Td>}
              <Td className="text-center">
                <DevBadge dev={p.dev} />
              </Td>
              <Td className="text-center font-display text-lg font-700 text-ink">{p.ovr}</Td>
              <Td className="text-center font-display text-lg font-700 text-brand">{p.pot}</Td>
              {inlineComposites.map((c) => {
                const v = attrsById.get(p.id) ? c.compute(attrsById.get(p.id)!) : null
                return (
                  <Td key={c.id} className={cn('text-center', ratingTint(v))}>
                    {v == null ? '–' : Math.round(v)}
                  </Td>
                )
              })}
              {inlineRatings.map((k) => {
                const v = attrsById.get(p.id)?.[k]
                return (
                  <Td key={k} className={cn('text-center', ratingTint(v))}>
                    {v == null ? '–' : Math.round(v)}
                  </Td>
                )
              })}
              <Td>
                <PlaybookCell player={p} />
              </Td>
              {showMorale && (
                <Td>
                  <MoraleDots value={p.morale} />
                </Td>
              )}
              {showContract && (
                <Td className="text-right font-cond font-600 text-ink-2">{money(p.contract.capHit)}</Td>
              )}
              {showDeadMoney && (
                <Td className="text-right">
                  <DeadMoneyCell contract={p.contract} />
                </Td>
              )}
              {showContract && <Td className="text-right text-muted">{p.contract.years} yr</Td>}
              {right && <Td className="text-right">{right(p)}</Td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Playbook mastery: the % of the system this player has learned, plus a bar.
 * Grows only through game reps, training, and loyalty.
 */
export function PlaybookCell({ player }: { player: Player }) {
  const pct = masteryProgress(player)
  const { label, tone } = masteryLabel(pct)
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 font-cond text-xs font-700 tnum text-ink-2">{pct}%</span>
      <div className="w-12">
        <RatingBar
          value={pct}
          height={5}
          color={tone === 'win' ? '#05914f' : tone === 'info' ? '#0b62ff' : tone === 'warn' ? '#d98207' : '#dc2937'}
        />
      </div>
      <span className="hidden font-cond text-[10px] uppercase text-muted xl:inline">{label}</span>
    </div>
  )
}

function Th({
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
  dir?: SortDir
  title?: string
}) {
  return (
    <th
      title={title}
      onClick={onClick}
      className={cn(
        'label whitespace-nowrap px-2 py-2 font-700',
        onClick && 'cursor-pointer select-none hover:text-ink-2',
        active && 'text-ink',
        className,
      )}
    >
      {onClick ? (
        <span className="inline-flex items-center gap-0.5">
          {children}
          {active && <span className="text-[9px] leading-none">{dir === 'asc' ? '▲' : '▼'}</span>}
        </span>
      ) : (
        children
      )}
    </th>
  )
}
function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn('whitespace-nowrap px-2 py-1.5', className)}>{children}</td>
}

function MoraleDots({ value }: { value: number }) {
  const level = value > 78 ? 4 : value > 62 ? 3 : value > 48 ? 2 : 1
  const color = level >= 4 ? '#05914f' : level === 3 ? '#3aa35a' : level === 2 ? '#d98207' : '#dc2937'
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4].map((n) => (
        <span
          key={n}
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: n <= level ? color : '#e6ecf4' }}
        />
      ))}
    </div>
  )
}

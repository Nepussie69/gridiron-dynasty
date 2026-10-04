import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
import type { Contract, Player } from '../game/types'
import { capSavings, deadMoney } from '../game/engine/cap'
import { fitLabel, schemeFit } from '../game/engine/style'
import { masteryLabel, masteryProgress } from '../game/engine/playbook'
import { useGame } from '../store/gameStore'
import { Badge, DevBadge, OvrBadge, RatingBar } from '../ui/kit'

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
  const fit = fitLabel(player, useScheme)
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
  rank = false,
  right,
  emptyText = 'No players to show.',
}: Props) {
  const selectPlayer = useGame((s) => s.selectPlayer)

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
            <Th className="sticky left-10 bg-surface">Player</Th>
            <Th className="w-12 text-right">Age</Th>
            {showPhysicals && <Th className="w-24">Ht/Wt</Th>}
            {showFit && <Th className="w-20 text-center">Fit</Th>}
            {showCollege && <Th className="w-40">College</Th>}
            <Th className="w-14 text-center">Dev</Th>
            <Th className="w-14 text-center">OVR</Th>
            <Th className="w-14 text-center">POT</Th>
            <Th className="w-24 text-center">Playbook</Th>
            {showMorale && <Th className="w-20">Morale</Th>}
            {showContract && <Th className="w-20 text-right">Cap Hit</Th>}
            {showDeadMoney && <Th className="w-20 text-right">Dead $</Th>}
            {showContract && <Th className="w-14 text-right">Yrs</Th>}
            {right && <Th className="w-36 text-right">Action</Th>}
          </tr>
        </thead>
        <tbody>
          {players.map((p, i) => (
            <tr
              key={p.id}
              onClick={() => selectPlayer(p.id)}
              className="cursor-pointer border-b border-line/60 transition hover:bg-[var(--team-soft)]"
            >
              {rank && <Td className="font-cond text-muted">{i + 1}</Td>}
              <Td className="sticky left-0 bg-surface">
                <OvrBadge value={p.ovr} size={30} />
              </Td>
              <Td className="sticky left-10 bg-surface">
                <div className="flex items-center gap-2">
                  <span className="font-cond text-[11px] font-700 uppercase text-muted">{p.pos}</span>
                  <span className="font-600 text-ink">{p.name}</span>
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

function Th({ children, className }: { children?: ReactNode; className?: string }) {  return (
    <th className={cn('label whitespace-nowrap px-2 py-2 font-700', className)}>
      {children}
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

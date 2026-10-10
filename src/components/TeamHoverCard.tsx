import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { recordOf, recordStr } from '../game/selectors'
import { teamRates, type TeamRateEntry } from '../game/teamRates'
import { useWorld } from '../store/gameStore'
import { TeamCrest } from '../ui/kit'
import { HoverCard } from './HoverCard'
import type { Team } from '../game/types'

/**
 * A club's name / crest whose hover (or focus) reveals a small card: lineup
 * OVR / OFF / DEF, season record, points for and against per game, and league
 * ranks — modelled on `PlayerHoverCard`.
 *
 * The numbers come from `teamRates`, a read-only selector over the season's
 * existing stats. The card body only mounts while the panel is open, so lists
 * of clubs (standings, schedule) never pay to compute a card nobody is reading.
 */
export function TeamHoverCard({
  team,
  className,
  children,
  info = false,
}: {
  team: Team
  className?: string
  children: ReactNode
  /** Show the ⓘ tap target (keyboard / touch fallback for hover). */
  info?: boolean
}) {
  return (
    <HoverCard
      className={className}
      info={info}
      label={`Details for the ${team.name}`}
      content={<TeamCardBody team={team} />}
    >
      {children}
    </HoverCard>
  )
}

function rankClass(rank: number): string {
  if (rank <= 5) return 'text-win'
  if (rank >= 28) return 'text-warn'
  return 'text-muted'
}

/** One rate line: value per game with its league rank (#1 = best). */
function RateCell({ label, value, rank, title }: { label: string; value: number | null; rank: number; title?: string }) {
  return (
    <div title={title} className="flex items-baseline justify-between gap-1 rounded-[var(--r-xs)] border border-line/50 px-1 py-0.5">
      <span className="font-cond text-label font-700 uppercase leading-tight text-muted">{label}</span>
      <span className="font-display text-small font-700 leading-tight tnum text-ink">
        {value == null ? '—' : value.toFixed(1)}
        {value != null && rank > 0 && <span className={cn('ml-0.5 font-cond text-label', rankClass(rank))}>#{rank}</span>}
      </span>
    </div>
  )
}

function UnitCell({ label, value, rank }: { label: string; value: number; rank: number }) {
  return (
    <div className="rounded-[var(--r-xs)] border border-line/50 px-1 py-0.5 text-center">
      <div className="font-cond text-label font-700 uppercase leading-tight text-muted">{label}</div>
      <div className="font-display text-small font-700 leading-tight tnum text-ink">
        {Math.round(value)}
        {rank > 0 && <span className={cn('ml-0.5 font-cond text-label', rankClass(rank))}>#{rank}</span>}
      </div>
    </div>
  )
}

/** Split out so the expensive selector only runs while the panel is mounted. */
function TeamCardBody({ team }: { team: Team }) {
  const world = useWorld()
  const rec = recordOf(world, team.id)
  const rate: TeamRateEntry | undefined = teamRates(world)[team.id]
  const name = team.tier === 'NFL' ? `${team.city} ${team.name}` : team.name

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <TeamCrest team={team} size={28} />
        <div className="min-w-0">
          <div className="truncate font-display text-sm font-700 uppercase leading-none text-ink">{name}</div>
          <div className="mt-0.5 text-label tnum text-muted">
            {recordStr(rec)} · {team.conference}
            {team.division ? ` ${team.division}` : ''} · {team.tier}
          </div>
        </div>
      </div>

      {rate ? (
        <>
          <div className="grid grid-cols-3 gap-0.5">
            <UnitCell label="OVR" value={rate.ovr} rank={rate.ranks.ovr} />
            <UnitCell label="OFF" value={rate.off} rank={rate.ranks.off} />
            <UnitCell label="DEF" value={rate.def} rank={rate.ranks.def} />
          </div>

          <div className="flex items-center justify-between">
            <span className="label">Per game</span>
            <span className="font-cond text-label uppercase text-faint">value · rank</span>
          </div>
          <div className="grid grid-cols-2 gap-x-1.5 gap-y-0.5">
            <RateCell label="PF/G" value={rate.pf} rank={rate.ranks.pf} title="Points scored per game" />
            <RateCell label="PA/G" value={rate.pa} rank={rate.ranks.pa} title="Points allowed per game" />
            <RateCell label="Pass/G" value={rate.passYds} rank={rate.ranks.passYds} title="Pass yards per game" />
            <RateCell label="PassA/G" value={rate.passYdsAllowed} rank={rate.ranks.passYdsAllowed} title="Pass yards allowed per game" />
            <RateCell label="Rush/G" value={rate.rushYds} rank={rate.ranks.rushYds} title="Rush yards per game" />
            <RateCell label="RushA/G" value={rate.rushYdsAllowed} rank={rate.ranks.rushYdsAllowed} title="Rush yards allowed per game" />
          </div>
          {rate.games === 0 && (
            <p className="text-label leading-snug text-muted">Season stats appear after the first week.</p>
          )}
        </>
      ) : (
        <p className="text-label leading-snug text-muted">Season ranks are tracked for NFL clubs.</p>
      )}
    </div>
  )
}

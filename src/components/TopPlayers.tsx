import { topPlayers } from '../game/engine/depth'
import { coverageGrade, seasonLine } from '../game/engine/stats'
import { useGame, useWorld } from '../store/gameStore'
import { OvrBadge } from '../ui/kit'
import { PlayerHoverCard } from './PlayerHoverCard'
import type { Player, SeasonStats, StatLevel } from '../game/types'

/**
 * L12.8 V2: one headline stat this season, by position. Returns null when the
 * player has no line yet (early in a season, or never used).
 */
function headline(p: Player, s: SeasonStats | undefined): string | null {
  if (!s) return null
  switch (p.pos) {
    case 'QB':
      return `${s.passYds} pass yds`
    case 'RB':
      return `${s.rushYds} rush yds`
    case 'WR':
    case 'TE':
      return `${s.recYds} rec yds`
    case 'DE':
    case 'DT':
      return s.defSacks > 0 ? `${s.defSacks} sck` : `${s.tackles} tkl`
    case 'LB':
      return `${s.tackles} tkl`
    case 'CB':
    case 'S': {
      const g = coverageGrade(s)
      return g != null ? `cov ${g}` : `${s.defInts} INT`
    }
    default:
      return null
  }
}

/**
 * L12.8 V2: compact chips for a club's best starters on one side — OVR badge,
 * name, position and one headline stat. Hovering shows the full player card
 * (`PlayerHoverCard`); clicking opens his profile.
 */
export function TopPlayers({
  teamId,
  side,
  n = 5,
  label,
}: {
  teamId: string
  side: 'off' | 'def'
  n?: number
  label: string
}) {
  const league = useWorld()
  const selectPlayer = useGame((s) => s.selectPlayer)
  const level: StatLevel = league.byId[teamId]?.tier === 'NFL' ? 'NFL' : 'CFB'
  const players = topPlayers(league, teamId, side, n)
  if (!players.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="label !mb-0 w-full sm:w-auto">{label}</span>
      {players.map((p) => {
        const stat = headline(p, seasonLine(p, league.season, level))
        return (
          <PlayerHoverCard key={p.id} player={p} info={false}>
            <span
              onClick={() => selectPlayer(p.id)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-surface px-1.5 py-1 text-xs transition hover:border-line-strong hover:bg-surface-2"
            >
              <OvrBadge value={p.ovr} size={20} />
              <span className="font-cond text-[10px] font-700 uppercase text-muted">{p.pos}</span>
              <span className="max-w-[8.5rem] truncate font-600 text-ink">{p.name}</span>
              {stat && <span className="font-cond text-[10px] tnum text-muted">{stat}</span>}
            </span>
          </PlayerHoverCard>
        )
      })}
    </div>
  )
}

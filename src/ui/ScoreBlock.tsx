// ─────────────────────────────────────────────────────────────────────────────
// ScoreBlock (UI redesign F2): the club-colour scorebug block promoted from
// MatchView, plus Scoreline (away | status | home) for Schedule, Up Next and
// the Dashboard hero. Team fill is a slab (identity only); its ink is picked by
// WCAG contrast, and very dark fills get a line-strong ring (dark-slab lift).
// ─────────────────────────────────────────────────────────────────────────────
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { bestInk, contrast, parseHex, SLAB_LIFT_BELOW, THEME_BASE } from '../lib/teamColor'
import { useResolvedTheme } from './hooks'

export interface ScoreTeam {
  abbr: string
  primary: string
  name?: string
  city?: string
}

const SIZE = {
  sm: { pad: 'px-2 py-1', abbr: 'text-label', score: 'text-[22px]', min: 'min-w-[64px]' },
  md: { pad: 'px-2.5 py-1.5', abbr: 'text-label', score: 'text-[30px]', min: 'min-w-[76px]' },
  lg: { pad: 'px-3.5 py-2', abbr: 'text-small', score: 'text-[44px]', min: 'min-w-[104px]' },
} as const

/** One side of a scorebug: abbr, big score (or a sub line), possession ball, timeout pips. */
export function ScoreBlock({
  team,
  score,
  sub,
  hasBall = false,
  timeouts,
  align = 'left',
  size = 'md',
  dim = false,
  className,
}: {
  team: ScoreTeam
  /** null / undefined → no score yet (upcoming); show `sub` instead. */
  score?: number | null
  /** Record or note under the abbr ("5–2"). */
  sub?: ReactNode
  hasBall?: boolean
  timeouts?: number
  align?: 'left' | 'right'
  size?: 'sm' | 'md' | 'lg'
  /** Loser of a final: slightly receded. */
  dim?: boolean
  className?: string
}) {
  const theme = useResolvedTheme()
  const fill = parseHex(team.primary) ? team.primary : 'var(--team-fill)'
  const ink = parseHex(team.primary) ? bestInk(team.primary) : 'var(--team-on)'
  const lift = parseHex(team.primary) ? contrast(team.primary, THEME_BASE[theme].canvas) < SLAB_LIFT_BELOW : false
  const s = SIZE[size]
  const label = `${team.city ? `${team.city} ` : ''}${team.name ?? team.abbr}${score != null ? ` ${score}` : ''}${hasBall ? ', has the ball' : ''}`
  return (
    <div
      aria-label={label}
      role="group"
      className={cn('flex min-w-0 items-center rounded-[var(--r-md)]', s.pad, s.min, align === 'right' && 'justify-end', dim && 'opacity-75', className)}
      style={{
        background: fill,
        color: ink,
        boxShadow: lift ? 'inset 0 0 0 1px var(--color-line-strong)' : 'inset 0 0 0 1px color-mix(in srgb, currentColor 18%, transparent)',
      }}
    >
      <div className={cn('flex flex-col leading-none', align === 'right' && 'items-end')}>
        <span className={cn('flex items-center gap-1 font-cond font-700 uppercase tracking-[0.06em]', s.abbr)}>
          {align === 'left' && <PossessionBall on={hasBall} />}
          {team.abbr}
          {align === 'right' && <PossessionBall on={hasBall} />}
        </span>
        {score != null ? (
          <span className={cn('font-display font-800 italic leading-none tnum', s.score)}>{score}</span>
        ) : (
          sub != null && <span className="mt-1 font-cond text-small font-600 tnum opacity-90">{sub}</span>
        )}
        {timeouts != null && <TimeoutPips n={timeouts} />}
      </div>
    </div>
  )
}

/** A small football in the block's ink; hidden (not removed) when not in possession. */
function PossessionBall({ on }: { on: boolean }) {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" aria-hidden className={cn('shrink-0', on ? 'opacity-100' : 'opacity-0')}>
      <ellipse cx="12" cy="12" rx="9.5" ry="6.2" fill="currentColor" />
      <path d="M10 10.6v2.8M12 10.4v3.2M14 10.6v2.8" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** Three timeout pips in the block's ink. */
function TimeoutPips({ n }: { n: number }) {
  return (
    <span className="mt-1 flex gap-0.5" role="img" aria-label={`${n} timeout${n === 1 ? '' : 's'} left`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-2.5 rounded-full border border-current"
          style={{ background: i < n ? 'currentColor' : 'transparent', opacity: i < n ? 0.9 : 0.4 }}
        />
      ))}
    </span>
  )
}

/** Away block · status · home block (Schedule rows, Up Next, Dashboard hero). */
export function Scoreline({
  away,
  home,
  awayScore,
  homeScore,
  awaySub,
  homeSub,
  status,
  possession,
  size = 'md',
  className,
}: {
  away: ScoreTeam
  home: ScoreTeam
  awayScore?: number | null
  homeScore?: number | null
  awaySub?: ReactNode
  homeSub?: ReactNode
  /** Centre text: "FINAL", "Q3 4:12", "WK 9 · SUN". */
  status?: ReactNode
  possession?: 'away' | 'home'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const final = awayScore != null && homeScore != null
  return (
    <div className={cn('grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2', className)}>
      <ScoreBlock
        team={away}
        score={awayScore}
        sub={awaySub}
        hasBall={possession === 'away'}
        size={size}
        dim={final && status === 'FINAL' && awayScore! < homeScore!}
      />
      <div className="flex flex-col items-center gap-0.5 px-1 text-center">
        <span className="font-cond text-label font-700 uppercase tracking-[0.07em] text-muted">{final ? 'away · home' : '@'}</span>
        {status && <span className="whitespace-nowrap font-cond text-small font-700 uppercase tracking-[0.06em] text-ink">{status}</span>}
      </div>
      <ScoreBlock
        team={home}
        score={homeScore}
        sub={homeSub}
        hasBall={possession === 'home'}
        align="right"
        size={size}
        dim={final && status === 'FINAL' && homeScore! < awayScore!}
      />
    </div>
  )
}

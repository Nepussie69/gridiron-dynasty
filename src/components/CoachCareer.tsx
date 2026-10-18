// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #44 / #51 — the coach career surface.
//
// The Staff screen's career timeline: every stop (season, club, role, record,
// overall), the growth curve of his own rating by season, his head-coaching
// record, the "Former player" badge and the interim head-coach banner. All data
// comes from the engine (`coachCareerOf`), so a legacy save shows a derived
// career with no migration. Kit components + colour tokens only.
// ─────────────────────────────────────────────────────────────────────────────

import type { StaffMember } from '../game/types'
import type { World } from '../game/engine/generate'
import { coachCareerOf, hcTenure } from '../game/engine/coachCareer'
import { formerPlayerFor, playingLine } from '../game/engine/formerPlayers'
import { cn } from '../lib/cn'
import { RatingBar, VerdictChip } from '../ui/kit'

/** The short role tag the timeline uses (keeps a 375 px row on one line). */
const SHORT: Record<string, string> = {
  'Head Coach': 'HC',
  'Offensive Coordinator': 'OC',
  'Defensive Coordinator': 'DC',
  'Special Teams Coordinator': 'ST',
  'QB Coach': 'QB',
  'OL Coach': 'OL',
  'DL Coach': 'DL',
  'Secondary Coach': 'DB',
  'WR Coach': 'WR',
  'LB Coach': 'LB',
}

function teamName(world: World | undefined, teamId: string | null | undefined): string {
  if (!teamId) return '—'
  const t = world?.byId[teamId]
  return t ? t.abbr : teamId
}

/** FUTURES #51: a chip for a coach who played in the league. */
export function FormerPlayerBadge({ m, className }: { m: StaffMember; className?: string }) {
  const p = m.career?.formerPlayer ?? formerPlayerFor(m)
  if (!p) return null
  return (
    <span
      className={cn('inline-flex items-center gap-1.5', className)}
      title={`Former player — played ${playingLine(p)} (${p.ovr} OVR, ${p.awr} AWR). His starting sub-ratings were read off his playing sheet.`}
    >
      <VerdictChip tone="neutral">Former player</VerdictChip>
      <span className="text-label text-muted tnum">{playingLine(p)}</span>
    </span>
  )
}

/**
 * FUTURES #44: the interim head-coach banner. Renders only while the interim's
 * own season is live, so it disappears when the club makes a permanent hire.
 */
export function InterimHeadCoachBanner({ m, world, className }: { m: StaffMember; world: World; className?: string }) {
  const c = m.career
  if (!c?.interim || c.interim.season !== world.season) return null
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-2',
        className,
      )}
    >
      <VerdictChip tone="warn">Interim head coach</VerdictChip>
      <span className="text-small text-ink-2">
        Promoted from the staff this season after the club’s slow start. His sub-ratings are his own — the owner decides in the offseason.
      </span>
    </div>
  )
}

/** The sparkline of a coach's overall rating season by season (his own stops). */
function CareerSpark({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null
  const w = 100
  const h = 30
  const lo = Math.min(...values) - 2
  const hi = Math.max(...values) + 2
  const span = Math.max(1, hi - lo)
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - lo) / span) * h}`)
    .join(' ')
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn('h-7 w-full', className)}
      role="img"
      aria-label={`Overall rating by season: ${values.join(', ')}`}
    >
      <polyline points={pts} fill="none" stroke="var(--team-accent)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/**
 * The full career timeline for the inspector: summary line, growth spark, then
 * each stop newest-first. Desktop and 375 px: the row wraps its record to a
 * second line instead of overflowing.
 */
export function CoachCareerTimeline({ m, world }: { m: StaffMember; world?: World }) {
  const c = coachCareerOf(m, world)
  const stops = c.stops
  const played = c.formerPlayer ?? formerPlayerFor(m)
  const rings = c.rings ?? 0
  const tenure = hcTenure(m)
  const hcStops = stops.filter((s) => s.role === 'Head Coach')
  const hcRecord = `${c.wins}-${c.losses}`

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {played && <FormerPlayerBadge m={m} />}
        <span className="text-small text-ink-2 tnum">
          <b className="font-600 text-ink">{c.seasons}</b> season{c.seasons === 1 ? '' : 's'} coaching
        </span>
        {hcStops.length > 0 && (
          <span className="text-small text-ink-2 tnum">
            <b className="font-600 text-ink">{hcRecord}</b> as a head coach{rings > 0 ? ` · ${rings} ring${rings === 1 ? '' : 's'}` : ''}
          </span>
        )}
        <span className="text-small text-muted tnum">learning {c.learning.toFixed(2)} · peak ~{c.peakAge}</span>
      </div>

      {stops.length > 1 && (
        <div>
          <div className="label mb-1">Overall by season</div>
          <CareerSpark values={stops.map((s) => s.rating)} />
        </div>
      )}

      {stops.length === 0 ? (
        <p className="text-small text-muted">
          First coaching job — {m.age} years old{played ? `, ${playingLine(played)} as a player` : ''}.
        </p>
      ) : (
        <ol className="divide-y divide-line rounded-[var(--r-md)] border border-line">
          {[...stops].reverse().map((s, i) => (
            <li key={`${s.season}-${s.teamId}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-small">
              <span className="w-10 shrink-0 font-cond font-700 tnum text-ink">{s.season}</span>
              <span className="w-8 shrink-0 font-cond text-label font-700 uppercase text-muted">{SHORT[s.role] ?? s.role.slice(0, 3)}</span>
              <span className="min-w-0 flex-1 truncate text-ink-2">{s.team ?? teamName(world, s.teamId)}</span>
              {s.role === 'Head Coach' || s.interim ? (
                <span className="text-muted tnum">
                  {s.wins}-{s.losses}
                  {s.interim ? ' (interim)' : ''}
                </span>
              ) : (
                <span className="text-muted tnum">{s.wins}-{s.losses}</span>
              )}
              <span className="w-16 shrink-0">
                <RatingBar value={s.rating} height={6} tone="tier" label={`${s.season} overall ${s.rating}`} />
              </span>
              <span className="w-7 shrink-0 text-right font-cond font-700 tnum text-ink">{s.rating}</span>
            </li>
          ))}
        </ol>
      )}

      {tenure >= 3 && (
        <p className="text-label text-muted">
          He has {tenure} straight seasons in the head coach’s chair ({'NFL median is three to four'}).
        </p>
      )}
    </div>
  )
}

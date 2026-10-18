// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #47 UI — combine & pro-day measurables.
//
// One shared surface for a prospect's testing card: his body and every drill he
// actually took, each with the percentile it sits at for HIS position. Used by
// the Scouting report (ProspectReport) and the Draft War Room's Combine view, so
// the numbers read the same everywhere. Kit pieces and tokens only.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react'
import type { DraftProspect, Position } from '../game/types'
import {
  DRILL_META,
  DRILL_ORDER,
  athleticPercentile,
  drillPercentileOf,
  formatHeight,
  formatMeasure,
  measurePercentile,
  measurablesCached,
  type DrillKey,
} from '../game/engine/measure'
import { Badge } from '../ui/kit'
import { cn } from '../lib/cn'

/** A percentile's tone: elite (gold), strong (win), ordinary (neutral), poor (warn). */
function pctTone(pct: number): 'gold' | 'win' | 'neutral' | 'warn' {
  return pct >= 95 ? 'gold' : pct >= 80 ? 'win' : pct >= 25 ? 'neutral' : 'warn'
}

/** A small percentile meter (0–100, longer = better athlete for the position). */
export function PercentileBar({ pct, className }: { pct: number; className?: string }) {
  return (
    <span className={cn('block h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)} aria-hidden>
      <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
    </span>
  )
}

/** The percentile badge shown beside a measurement. */
export function PercentileBadge({ pct, title }: { pct: number; title?: string }) {
  return (
    <span title={title} className="inline-flex">
      <Badge tone={pctTone(pct)}>{pct}</Badge>
    </span>
  )
}

/** One drill line: label, value, percentile meter, percentile badge. */
function DrillRow({ pos, drill, value }: { pos: Position; drill: DrillKey; value?: number }) {
  const meta = DRILL_META[drill]
  const pct = value == null ? null : measurePercentile(pos, drill, value)
  return (
    <div className="flex items-center gap-2">
      <span className="w-[84px] shrink-0 truncate text-small text-muted max-sm:w-[78px]">{meta.short}</span>
      <span className="w-16 shrink-0 text-right font-600 text-ink tnum">
        {value == null ? (
          <span className="text-micro font-500 uppercase text-faint">no test</span>
        ) : (
          <>
            {formatMeasure(drill, value)}
            <span className="ml-0.5 text-micro text-muted">{meta.unit}</span>
          </>
        )}
      </span>
      <span className="min-w-0 flex-1">{pct != null && <PercentileBar pct={pct} />}</span>
      <span className="w-8 shrink-0 text-right">
        {pct != null ? (
          <PercentileBadge pct={pct} title={`${pct}th percentile for his position`} />
        ) : (
          <span className="text-label text-faint">—</span>
        )}
      </span>
    </div>
  )
}

/** His combine card: body, an athletic composite, and every drill he took. */
export function MeasurablesPanel({ prospect, className }: { prospect: DraftProspect; className?: string }) {
  const m = measurablesCached(prospect)
  const ath = athleticPercentile(prospect.pos, m)
  const took = DRILL_ORDER.filter((d) => m.tested[d] != null).length
  return (
    <section className={cn('space-y-2', className)} aria-label="Combine and pro-day measurables">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="label">Testing</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {m.proDay ? <Badge tone="warn">Pro day only</Badge> : <Badge tone="neutral">Combine</Badge>}
          <Badge tone={pctTone(ath)}>{ath}th ath</Badge>
          <span className="text-label text-muted tnum">
            {took}/{DRILL_ORDER.length} drills
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink-2">
        <span>
          HT <b className="font-600 text-ink tnum">{formatHeight(m.heightIn)}</b>
        </span>
        <span>
          WT <b className="font-600 text-ink tnum">{m.weightLb}</b> lb
        </span>
        <span>
          ARM <b className="font-600 text-ink tnum">{m.armIn.toFixed(1)}</b> in
        </span>
      </div>
      <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
        {DRILL_ORDER.map((d) => (
          <DrillRow key={d} pos={prospect.pos} drill={d} value={m.tested[d]} />
        ))}
      </div>
      <p className="text-micro text-faint">
        True numbers — every club sees the same stopwatch. The department&apos;s read of what they mean is its own.
      </p>
    </section>
  )
}

/** One drill cell for the sortable Combine board (value + position percentile). */
export function DrillCell({ prospect, drill }: { prospect: DraftProspect; drill: DrillKey }): ReactNode {
  const v = measurablesCached(prospect).tested[drill]
  if (v == null) return <span className="text-micro uppercase text-faint">—</span>
  const pct = drillPercentileOf(prospect, drill)
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span className="font-600 text-ink tnum">{formatMeasure(drill, v)}</span>
      <PercentileBadge pct={pct} title={`${pct}th percentile ${DRILL_META[drill].label} for his position`} />
    </span>
  )
}

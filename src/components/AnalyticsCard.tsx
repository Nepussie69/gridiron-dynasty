import { BarChart3 } from 'lucide-react'
import {
  ANALYTICS_LEVEL_LABEL,
  analyticsState,
  tendencyReport,
  winProjection,
  type TendencyRow,
} from '../game/engine/analytics'
import { BUCKET_LABEL, type Bucket } from '../game/engine/decisions'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card } from '../ui/kit'

/**
 * FUTURES 19: the analytics department, on the Game Plan screen where the
 * information it sharpens already lives. Everything shown here is advisory —
 * the sim never reads it.
 */
export function AnalyticsCard({ oppId, home, className }: { oppId?: string; home: boolean; className?: string }) {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const setScreen = useGame((s) => s.setScreen)
  const state = analyticsState(league, career.teamId)

  if (state.level === 'none') {
    return (
      <Card className={className}>
        <div className="mb-3 flex items-center gap-2">
          <BarChart3 size={16} className="text-muted" />
          <h3 className="font-display text-lg font-700 uppercase tracking-wide">Analytics Department</h3>
          <Badge tone="neutral" className="ml-auto">Not staffed</Badge>
        </div>
        <p className="mb-3 text-sm text-muted">
          Hire an analyst to sharpen your win probability, get 4th-down recommendations on game day, and
          project the opponent&rsquo;s tendencies before kickoff. Better analysts read it more clearly.
        </p>
        <Button size="sm" variant="secondary" onClick={() => setScreen('staff')}>
          Hire an analyst
        </Button>
      </Card>
    )
  }

  const levelTone = state.level === 'elite' ? 'win' : state.level === 'sharp' ? 'info' : 'neutral'
  const wp = oppId ? winProjection(league, career.teamId, oppId, home) : null
  const rows = oppId ? tendencyReport(league, oppId, state.rating) : null

  return (
    <Card className={className}>
      <div className="mb-3 flex items-center gap-2">
        <BarChart3 size={16} className="text-muted" />
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">Analytics Department</h3>
        <Badge tone={levelTone} className="ml-auto">
          {ANALYTICS_LEVEL_LABEL[state.level]} · {state.rating} OVR
        </Badge>
      </div>

      <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
        {state.fromFrontOffice ? (
          <>
            Covered by your front office&rsquo;s analytics focus — effective rating{' '}
            <strong className="text-ink">{state.rating}</strong>. Hire a dedicated analyst to sharpen it further.
          </>
        ) : (
          <>
            <strong className="text-ink">{state.name}</strong> runs the room. The model sharpens win probability,
            4th-down calls and opponent tendencies — advice only, never a sim edge.
          </>
        )}
      </div>

      {wp && (
        <div className="mt-3 rounded-lg border border-line px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="label">Win projection</span>
            <span className="font-cond text-small font-700 tnum text-ink">
              {Math.round(wp.value * 100)}%
              <span className="text-muted"> ±{Math.round(wp.margin * 100)}</span>
            </span>
          </div>
          <div className="text-small text-muted">
            {wp.factors.join(' · ')} · {wp.confidence} confidence
          </div>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="mt-3">
          <div className="label mb-1.5">Projected opponent tendencies</div>
          <div className="overflow-hidden rounded-lg border border-line">
            {tendencyReportBuckets(rows).map(([bucket, list], i) => (
              <div key={bucket} className={i ? 'border-t border-line' : undefined}>
                <div className="bg-surface-2 px-3 py-1 font-cond text-label font-700 uppercase tracking-wide text-faint">
                  {BUCKET_LABEL[bucket]}
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 px-3 py-1.5 text-small">
                  {list.map((r) => (
                    <div key={`${r.side}-${r.bucket}`} className="flex items-center justify-between gap-2">
                      <span className="text-muted">{r.side === 'off' ? 'They call' : 'They play'}</span>
                      <span className="truncate text-ink-2">
                        {r.label}{' '}
                        <span className="text-muted">
                          {Math.round(r.share * 100)}% ±{Math.round(r.span * 100)}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-small text-muted">
        On a coached 4th down, your analyst&rsquo;s recommendation appears on the call card. It is advice you
        can ignore — the game plays out exactly as it would with nobody in the room.
      </p>
    </Card>
  )
}

/** Group the flat rows by bucket, preserving ANALYTICS_BUCKETS order. */
function tendencyReportBuckets(rows: TendencyRow[]): [Bucket, TendencyRow[]][] {
  const out: [Bucket, TendencyRow[]][] = []
  for (const r of rows) {
    let entry = out.find(([b]) => b === r.bucket)
    if (!entry) {
      entry = [r.bucket, []]
      out.push(entry)
    }
    entry[1].push(r)
  }
  return out
}

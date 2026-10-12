import { useMemo } from 'react'
import { Crosshair } from 'lucide-react'
import { cn } from '../lib/cn'
import { buildScoutReport } from '../game/engine/scoutReport'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card } from '../ui/kit'

/** J36: most opponent players one side's plan may target. */
const MAX_TARGETS = 2

// Which phase of the ball a finding is relevant to: the offence attacks the
// opponent's defenders, the defence keys on the opponent's offensive players.
const DEF_POS = new Set(['CB', 'S', 'LB', 'DE', 'DT'])
const OFF_POS = new Set(['QB', 'RB', 'WR', 'TE', 'OT', 'OG', 'C', 'FB'])

/**
 * J36 (FUTURES #36): the staff's individual scouting report on the NEXT opponent.
 *
 * Each line is a reported tendency read from that player's own ratings by the
 * club's Analyst/Tendencies coach and scouting staff — an elite staff finds more
 * real weaknesses and fewer false ones. The Target toggle writes up to two ids
 * into the current side's game plan, which the sim then keys on (offence steers
 * at the flagged defender; defence keys on the flagged offensive player).
 */
export function ScoutReportCard({
  oppId,
  side,
  disabled = false,
}: {
  oppId?: string
  side: 'off' | 'def'
  disabled?: boolean
}) {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const plan = useGame((s) => s.defaultPlan[side])
  const setPlanTargets = useGame((s) => s.setPlanTargets)

  const findings = useMemo(
    () => (oppId ? buildScoutReport(league, career.teamId, oppId) : []),
    [league, career.teamId, oppId],
  )

  if (!oppId) return null
  const opp = league.byId[oppId]
  const relevant = side === 'off' ? DEF_POS : OFF_POS
  const rows = findings.filter((f) => relevant.has(f.pos))
  const chosen = plan.targets ?? []
  const full = chosen.length >= MAX_TARGETS

  const toggle = (id: string) => {
    if (disabled) return
    const next = chosen.includes(id)
      ? chosen.filter((x) => x !== id)
      : full
        ? chosen
        : [...chosen, id]
    setPlanTargets(side, next)
  }

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <Crosshair size={16} className="text-muted" aria-hidden />
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">Scouting report</h3>
        <Badge tone="neutral" className="ml-auto">
          {side === 'off' ? 'Their defense' : 'Their offense'}
        </Badge>
      </div>

      {!rows.length ? (
        <p className="text-small text-muted">
          Your staff have no read on the {opp?.abbr ?? 'opponent'} yet — hire a sharper Analyst or scout to find their weaknesses.
        </p>
      ) : (
        <>
          <p className="mb-3 text-small text-muted">
            {opp?.name}'s tendencies this week. Target up to {MAX_TARGETS} — the plan keys on them at kickoff.
          </p>
          <ul className="space-y-1.5">
            {rows.map((f) => {
              const selected = chosen.includes(f.playerId)
              const pct = Math.round(f.confidence * 100)
              const tone = f.confidence >= 0.72 ? 'win' : f.confidence >= 0.5 ? 'info' : 'neutral'
              return (
                <li
                  key={f.playerId}
                  className="flex items-center gap-2 border-b border-line/60 pb-1.5 last:border-0 last:pb-0"
                >
                  <span className="min-w-0 flex-1 text-small leading-snug text-ink-2">{f.text}</span>
                  <Badge tone={tone}>{pct}%</Badge>
                  <button
                    type="button"
                    aria-pressed={selected}
                    disabled={disabled || (full && !selected)}
                    onClick={() => toggle(f.playerId)}
                    title={selected ? 'Remove this target' : 'Target this player'}
                    className={cn(
                      'shrink-0 rounded-[var(--r-sm)] border px-2 py-1 font-cond text-label font-700 uppercase tracking-wide transition disabled:opacity-40',
                      selected
                        ? 'border-line-strong bg-surface-3 text-ink'
                        : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
                    )}
                  >
                    {selected ? 'Targeted' : 'Target'}
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="mt-3 text-small leading-snug text-muted">
            {chosen.length
              ? `Keying on ${chosen.length} player${chosen.length > 1 ? 's' : ''} this week.`
              : 'No targets set — the plan plays it straight.'}
          </p>
        </>
      )}
    </Card>
  )
}

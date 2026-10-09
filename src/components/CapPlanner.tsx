import { useState } from 'react'
import { CalendarClock, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
import { projectCap } from '../game/engine/capPlan'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card, RatingBar } from '../ui/kit'

/** '26 from a season like 2026. */
function shortYear(season: number) {
  return `'${String(season).slice(-2)}`
}

/**
 * FUTURES 18: the 3-year cap planner.
 *
 * A forward look at the money already on the books: what each of the next three
 * league years costs, the space it leaves against the fixed cap, and who comes
 * off the books at the end of it. Purely informational — it changes no sim
 * result and needs no save fields — so it stays on for every role.
 */
export function CapPlanner({ className }: { className?: string }) {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const [open, setOpen] = useState(false)

  const roster = league.roster[career.teamId] ?? []
  const plan = projectCap(roster, league.deadMoney[career.teamId] ?? 0, league.season, 3)
  const signed = plan.players.filter((p) => p.total > 0)

  return (
    <Card className={className}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-display text-lg font-700 uppercase tracking-wide">
          <CalendarClock size={16} className="text-[var(--team)]" /> 3-Year Cap Planner
        </h3>
        <Badge tone="neutral">{plan.horizon} seasons</Badge>
      </div>
      <p className="mb-4 max-w-3xl text-sm text-muted">
        What is already committed before you sign, cut or restructure anyone: each season&apos;s cap hit,
        the space it leaves, and who comes off the books at the end of it.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        {plan.years.map((y, i) => {
          const pct = (y.committed / y.limit) * 100
          const now = y.season === league.season
          return (
            <div key={y.season} className="rounded-xl border border-line bg-surface-2 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-cond text-sm font-700 uppercase tracking-wide text-ink-2">
                  {y.season} <span className="text-muted">· {now ? 'this season' : `year ${i + 1}`}</span>
                </span>
                {now && <Badge tone="team">Now</Badge>}
              </div>

              <div className={cn('font-display text-2xl font-700 tnum leading-none', y.space < 0 ? 'text-loss' : 'text-ink')}>
                {money(y.space)}
              </div>
              <div className="mb-2 mt-0.5 text-[11px] font-cond font-700 uppercase tracking-wide text-muted">
                {y.space < 0 ? 'Over the cap' : 'Projected space'}
              </div>

              <RatingBar value={pct} color={pct > 100 ? '#dc2937' : pct > 88 ? '#d98207' : '#05914f'} height={6} />
              <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                <span className="font-cond font-700 uppercase">Committed</span>
                <span className="tnum">
                  {money(y.committed)} <span className="text-faint">({Math.round(pct)}%)</span>
                </span>
              </div>

              <div className="mt-3 space-y-1 border-t border-line pt-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted">Dead money</span>
                  <span className={cn('tnum', y.dead > 0 ? 'text-ink-2' : 'text-faint')}>
                    {y.dead > 0 ? money(y.dead) : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Expiring deals</span>
                  <span className={cn('font-cond font-700 tnum', y.expiring.length ? 'text-warn' : 'text-faint')}>
                    {y.expiring.length}
                  </span>
                </div>
              </div>

              {y.expiring.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {y.expiring.slice(0, 3).map((p) => (
                    <span
                      key={p.id}
                      className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[10px] font-600 text-ink-2"
                      title={`${p.name} · ${p.pos} · ${p.ovr} OVR`}
                    >
                      {p.name.split(' ').slice(-1)[0]} · {p.pos}
                    </span>
                  ))}
                  {y.expiring.length > 3 && (
                    <span className="px-1 py-0.5 text-[10px] text-faint">+{y.expiring.length - 3} more</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-faint">
          Baseline only — no draft picks, re-signings or next year&apos;s free-agent spend counted.
        </span>
        <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {open ? 'Hide' : 'By player'}
        </Button>
      </div>

      {open && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm tnum">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="label whitespace-nowrap px-3 py-2">Player</th>
                <th className="label whitespace-nowrap px-3 py-2">Pos</th>
                {plan.years.map((y) => (
                  <th key={y.season} className="label whitespace-nowrap px-3 py-2 text-right">
                    {shortYear(y.season)}
                  </th>
                ))}
                <th className="label whitespace-nowrap px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {signed.map(({ player, hits, total }) => (
                <tr key={player.id} className="border-b border-line/60 hover:bg-surface-2">
                  <td className="whitespace-nowrap px-3 py-1.5 font-600 text-ink">{player.name}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-cond text-[11px] font-700 uppercase text-muted">{player.pos}</td>
                  {hits.map((h, i) => (
                    <td key={i} className={cn('whitespace-nowrap px-3 py-1.5 text-right', h ? 'text-ink-2' : 'text-faint')}>
                      {h ? money(h) : '—'}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-1.5 text-right font-cond font-700 text-ink">{money(total)}</td>
                </tr>
              ))}
              <tr className="bg-surface-2">
                <td className="px-3 py-2 font-cond font-700 uppercase text-ink" colSpan={2}>
                  Committed
                </td>
                {plan.years.map((y) => (
                  <td key={y.season} className="whitespace-nowrap px-3 py-2 text-right font-cond font-700 text-ink">
                    {money(y.committed)}
                  </td>
                ))}
                <td className="whitespace-nowrap px-3 py-2 text-right font-cond font-700 text-ink">
                  {money(plan.years.reduce((s, y) => s + y.committed, 0))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

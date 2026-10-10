import { useState } from 'react'
import { CalendarClock, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
import { projectCap } from '../game/engine/capPlan'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card, RatingBar, SectionTitle } from '../ui/kit'

/** '26 from a season like 2026. */
function shortYear(season: number) {
  return `'${String(season).slice(-2)}`
}

/** Neutral commitment bar: ink under the cap, warn past 88%, loss over the cap. */
function committedColor(pct: number) {
  return pct > 100 ? 'var(--color-loss)' : pct > 88 ? 'var(--color-warn)' : 'var(--color-ink-2)'
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
  const totalCommitted = plan.years.reduce((s, y) => s + y.committed, 0)

  return (
    <Card className={className}>
      <SectionTitle right={<Badge tone="neutral">{plan.horizon} seasons</Badge>}>
        <span className="flex items-center gap-2">
          <CalendarClock size={17} className="text-[var(--team-accent-text)]" aria-hidden /> 3-Year Cap Planner
        </span>
      </SectionTitle>
      <p className="mb-4 max-w-3xl text-small text-muted">
        What is already committed before you sign, cut or restructure anyone: each season&apos;s cap hit,
        the space it leaves, and who comes off the books at the end of it.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        {plan.years.map((y, i) => {
          const pct = (y.committed / y.limit) * 100
          const now = y.season === league.season
          return (
            <div key={y.season} className="rounded-[var(--r-md)] border border-line bg-surface-2 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-cond text-small font-700 uppercase tracking-wide text-ink-2">
                  {y.season} <span className="text-muted">· {now ? 'this season' : `year ${i + 1}`}</span>
                </span>
                {now && <Badge tone="neutral">Now</Badge>}
              </div>

              <div className="font-display text-[26px] font-800 italic leading-none text-ink tnum">{money(y.space)}</div>
              <div className="mb-2 mt-0.5 font-cond text-label font-700 uppercase tracking-wide text-muted">
                {y.space < 0 ? 'Over the cap' : 'Projected space'}
              </div>

              <RatingBar value={pct} max={100} color={committedColor(pct)} height={6} label="Committed share of the cap" />
              <div className="mt-1 flex items-center justify-between text-label text-muted">
                <span className="font-cond font-700 uppercase">Committed</span>
                <span className="tnum">
                  {money(y.committed)} <span className="text-faint">({Math.round(pct)}%)</span>
                </span>
              </div>

              <div className="mt-3 space-y-1 border-t border-line pt-2 text-small">
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
                      className="rounded-[var(--r-xs)] border border-line bg-surface px-1.5 py-0.5 text-label font-600 text-ink-2"
                      title={`${p.name} · ${p.pos} · ${p.ovr} OVR`}
                    >
                      {p.name.split(' ').slice(-1)[0]} · {p.pos}
                    </span>
                  ))}
                  {y.expiring.length > 3 && (
                    <span className="px-1 py-0.5 text-label text-faint">+{y.expiring.length - 3} more</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-label text-faint">
          Baseline only — no draft picks, re-signings or next year&apos;s free-agent spend counted.
        </span>
        <Button size="sm" variant="quiet" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {open ? 'Hide' : 'By player'}
        </Button>
      </div>

      {open && (
        <div className="mt-3 overflow-x-auto rounded-[var(--r-md)] border border-line">
          <table className="w-full text-small tnum">
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
                  <td className="whitespace-nowrap px-3 py-1.5 font-cond text-label font-700 uppercase text-muted">{player.pos}</td>
                  {hits.map((h, i) => (
                    <td key={i} className={cn('whitespace-nowrap px-3 py-1.5 text-right', h ? 'text-ink-2' : 'text-faint')}>
                      {h ? money(h) : '—'}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-1.5 text-right font-600 text-ink">{money(total)}</td>
                </tr>
              ))}
              <tr className="bg-surface-2">
                <td className="px-3 py-2 font-cond font-700 uppercase text-ink" colSpan={2}>
                  Committed
                </td>
                {plan.years.map((y) => (
                  <td key={y.season} className="whitespace-nowrap px-3 py-2 text-right font-600 text-ink">
                    {money(y.committed)}
                  </td>
                ))}
                <td className="whitespace-nowrap px-3 py-2 text-right font-600 text-ink">{money(totalCommitted)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

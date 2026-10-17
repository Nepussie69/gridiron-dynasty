import { Minus, Plus, RotateCcw } from 'lucide-react'
import { money, num } from '../lib/format'
import {
  TICKET_MAX,
  TICKET_MIN,
  TICKET_STEP,
  attendanceFor,
  currentRevenue,
  defaultTicketPrice,
  interestNow,
  marketLabel,
  marketTier,
} from '../game/engine/market'
import { staffBudget } from '../game/engine/staffMarket'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card, Chip, PageHeader, SectionTitle, Stat, TeamCrest } from '../ui/kit'
import { MarketCard } from '../components/MarketCard'

/**
 * FUTURES #50: the Business view. Your club's market and this season's books on
 * one page — and the one lever you hold: the ticket price, which sets attendance
 * and the gate. Everything else (fan interest, jerseys, media, playoff gates)
 * is earned on the field.
 */
export function Business() {
  const world = useWorld()
  const career = useGame((s) => s.career)!
  const setTicketPrice = useGame((s) => s.setTicketPrice)
  const teamId = career.teamId
  const price = career.ticketPrice ?? defaultTicketPrice(teamId)
  const fair = defaultTicketPrice(teamId)
  const att = attendanceFor(world, teamId, price)
  const attLower = attendanceFor(world, teamId, Math.max(TICKET_MIN, price - TICKET_STEP * 2))
  const attHigher = attendanceFor(world, teamId, Math.min(TICKET_MAX, price + TICKET_STEP * 2))
  const rev = currentRevenue(world, teamId)
  const budget = staffBudget(world, career)

  const nfl = world.teams.filter((t) => t.tier === 'NFL')
  const rows = nfl
    .map((t) => ({ team: t, rev: currentRevenue(world, t.id), interest: interestNow(world, t.id) }))
    .sort((a, b) => b.rev.local - a.rev.local)

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Club business"
        title="Market & Revenue"
        subtitle="Where your money comes from: the gate, the jerseys, local media and playoff runs. Your market's size and your fans' interest set the ceiling; winning raises it."
        right={
          <Badge tone="team">
            {marketLabel(teamId)} market · tier {marketTier(teamId)}/10
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <MarketCard career={career} />

        <div className="space-y-4">
          <Card>
            <SectionTitle spacing="tight">Ticket price</SectionTitle>
            <p className="mb-3 text-small text-muted">
              The market price for your club is <strong className="text-ink">{money(fair)}</strong>. Charge above it
              and seats empty; cut it and the building fills — up to capacity.
            </p>
            <div className="mb-3 flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                aria-label="Lower ticket price"
                disabled={price <= TICKET_MIN}
                icon={<Minus size={14} />}
                onClick={() => setTicketPrice(price - TICKET_STEP)}
              />
              <div className="flex-1 text-center">
                <div className="font-display text-3xl font-800 italic tnum text-ink">{money(price)}</div>
                <div className="label">per seat</div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                aria-label="Raise ticket price"
                disabled={price >= TICKET_MAX}
                icon={<Plus size={14} />}
                onClick={() => setTicketPrice(price + TICKET_STEP)}
              />
            </div>
            <div className="mb-3 grid grid-cols-3 gap-2 text-center text-small">
              <div className="rounded-md bg-surface-2 px-2 py-1.5">
                <div className="label">−{money(TICKET_STEP * 2)}</div>
                <div className="tnum text-ink-2">{Math.round(attLower.pct * 100)}%</div>
              </div>
              <div className="rounded-md border border-line px-2 py-1.5">
                <div className="label">Now</div>
                <div className="tnum text-ink">{Math.round(att.pct * 100)}%</div>
              </div>
              <div className="rounded-md bg-surface-2 px-2 py-1.5">
                <div className="label">+{money(TICKET_STEP * 2)}</div>
                <div className="tnum text-ink-2">{Math.round(attHigher.pct * 100)}%</div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCcw size={14} />}
              disabled={price === fair}
              onClick={() => setTicketPrice(fair)}
            >
              Match the market ({money(fair)})
            </Button>
          </Card>

          <Card>
            <SectionTitle spacing="tight">Gate today</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Seats sold" value={num(att.seats)} sub={`of ${num(att.capacity)}`} />
              <Stat label="Gate / season" value={money(rev.tickets)} sub={`${rev.homeGames} home games`} />
              <Stat label="Local revenue" value={money(rev.local)} sub="all streams" />
              <Stat label="Staff budget" value={money(budget.budget)} sub={`${money(budget.market)} from the market`} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Chip>Fan interest {interestNow(world, teamId)}</Chip>
              <Chip>Attendance {Math.round(att.pct * 100)}%</Chip>
              <Chip>Price {money(price)}</Chip>
            </div>
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <SectionTitle spacing="tight" right={<span className="label">Local revenue, this season</span>}>
          League markets
        </SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-small">
            <thead>
              <tr className="text-left text-label font-700 uppercase tracking-wide text-faint">
                <th className="py-1.5 pr-2">#</th>
                <th className="py-1.5 pr-2">Club</th>
                <th className="py-1.5 pr-2">Market</th>
                <th className="py-1.5 pr-2 text-right">Interest</th>
                <th className="py-1.5 pr-2 text-right">Att %</th>
                <th className="py-1.5 pr-2 text-right">Ticket</th>
                <th className="py-1.5 text-right">Local</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.team.id} className={`border-t border-line ${r.team.id === teamId ? 'bg-surface-2' : ''}`}>
                  <td className="py-1 pr-2 tnum text-faint">{i + 1}</td>
                  <td className="py-1 pr-2">
                    <span className="flex items-center gap-2">
                      <TeamCrest team={r.team} size={18} />
                      <span className="truncate text-ink">
                        {r.team.abbr}
                        {r.team.id === teamId && <span className="ml-1 text-faint">(you)</span>}
                      </span>
                    </span>
                  </td>
                  <td className="py-1 pr-2 text-muted">{marketLabel(r.team.id)}</td>
                  <td className="py-1 pr-2 text-right tnum text-ink-2">{r.interest}</td>
                  <td className="py-1 pr-2 text-right tnum text-ink-2">{Math.round(r.rev.attendancePct * 100)}%</td>
                  <td className="py-1 pr-2 text-right tnum text-muted">{money(r.rev.ticketPrice)}</td>
                  <td className="py-1 text-right font-cond font-700 tnum text-ink">{money(r.rev.local)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-small text-muted">
          Big markets out-earn small ones on the same results, the way they do in the real league — and a rabid small
          market (a Green Bay) still fills its building every week.
        </p>
      </Card>
    </div>
  )
}

import { Building2, TrendingDown, TrendingUp } from 'lucide-react'
import { money, num, signed } from '../lib/format'
import {
  attendanceFor,
  currentRevenue,
  defaultTicketPrice,
  interestTrend,
  jerseyLeaders,
  marketIndex,
  marketLabel,
  marketOf,
  marketTier,
  type JerseySeller,
} from '../game/engine/market'
import type { CareerState } from '../game/types'
import { useWorld } from '../store/gameStore'
import { Badge, Card, Chip, MiniBars, SectionTitle, Sparkline, Stat } from '../ui/kit'

/**
 * FUTURES #50: the Market & Fans card. A club's city, its following, what the
 * building took in this season and which of its own players sell the most
 * jerseys. Read-only — the only club money you can steer is the ticket price,
 * and that lives beside this card on the Business view.
 */
export function MarketCard({ career, className }: { career: CareerState; className?: string }) {
  const world = useWorld()
  const teamId = career.teamId
  const m = marketOf(teamId)
  const tier = marketTier(teamId)

  const fan = world.market?.fans?.[teamId]
  const interestNow = fan?.interest ?? 0
  const trend = interestTrend(world, teamId, 6)
  const rev = currentRevenue(world, teamId)
  const att = attendanceFor(world, teamId, career.ticketPrice ?? defaultTicketPrice(teamId))
  const sellers = jerseyLeaders(world, teamId, 5)

  const interestSeries = trend.length ? trend.map((h) => h.interest) : [interestNow]
  const lastDelta = trend.length >= 2 ? trend[trend.length - 1].interest - trend[trend.length - 2].interest : 0
  const up = lastDelta >= 0

  const localStreams = [
    { label: 'Tickets', value: rev.tickets },
    { label: 'Jerseys', value: rev.jerseys },
    { label: 'Local media', value: rev.media },
    { label: 'Playoff gates', value: rev.playoffGates },
  ]

  return (
    <Card className={className}>
      <SectionTitle
        right={
          <Badge tone="team">
            {marketLabel(teamId)} market · tier {tier}/10
          </Badge>
        }
      >
        <span className="flex items-center gap-2">
          <Building2 size={18} className="text-muted" />
          Market &amp; Fans
        </span>
      </SectionTitle>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Market"
          value={`${m.metro.toFixed(m.metro < 2 ? 2 : 1)}M`}
          sub={`Metro reach · index ${marketIndex(teamId)}`}
        />
        <Stat
          label="Fan interest"
          value={interestNow}
          sub={
            <span className={up ? 'text-win' : 'text-loss'}>
              {up ? <TrendingUp size={12} className="inline" /> : <TrendingDown size={12} className="inline" />}{' '}
              {signed(lastDelta, 0, { zero: 'plain' })} since last season
            </span>
          }
        />
        <Stat
          label="Attendance"
          value={`${Math.round(rev.attendancePct * 100)}%`}
          sub={`${num(rev.attendance)} of ${num(m.capacity)}`}
        />
        <Stat label="Local revenue" value={money(rev.local)} sub={`${money(rev.total)} incl. national`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="label mb-1.5 flex items-center justify-between">
            <span>Fan interest trend</span>
            <span className="tnum text-faint">
              {trend.length ? `${trend[0].season}–${trend[trend.length - 1].season}` : 'no seasons yet'}
            </span>
          </div>
          <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
            <Sparkline data={interestSeries} width={240} height={40} color="var(--team)" />
            <div className="mt-1 flex flex-wrap gap-1.5">
              {trend.map((h) => (
                <Chip key={h.season}>
                  {h.season}: {h.interest} · {h.wins}W
                </Chip>
              ))}
              {!trend.length && <span className="text-small text-muted">Finish a season to build a trend.</span>}
            </div>
          </div>
        </div>

        <div>
          <div className="label mb-1.5">Revenue by stream</div>
          <MiniBars
            items={localStreams.map((s) => ({ label: s.label, value: s.value, title: money(s.value) }))}
            max={Math.max(1, ...localStreams.map((s) => s.value))}
          />
          <div className="mt-2 flex items-center justify-between text-small text-muted">
            <span>National media (shared, every club)</span>
            <span className="tnum text-ink-2">{money(rev.national)}</span>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="label mb-1.5">Top jersey sellers</div>
        <div className="overflow-hidden rounded-lg border border-line">
          {sellers.map((s, i) => (
            <JerseyRow key={s.player.id} seller={s} first={i === 0} />
          ))}
          {!sellers.length && <div className="px-3 py-2 text-small text-muted">No roster yet.</div>}
        </div>
      </div>

      <p className="mt-3 text-small text-muted">
        Attendance fills with the following and the price: {num(att.seats)} seats would sell today at your price.
        Everything here is the club&rsquo;s own market and its own players — never a league average.
      </p>
    </Card>
  )
}

function JerseyRow({ seller, first }: { seller: JerseySeller; first: boolean }) {
  const { player, popularity, sales } = seller
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 text-small ${first ? '' : 'border-t border-line'}`}
      title={`${player.name} · popularity ${popularity}`}
    >
      <span className="w-6 shrink-0 font-cond font-700 uppercase text-faint">{player.pos}</span>
      <span className="min-w-0 flex-1 truncate text-ink">{player.name}</span>
      <span className="shrink-0 text-muted">pop {popularity}</span>
      <span className="w-16 shrink-0 text-right font-cond font-700 tnum text-ink-2">{money(sales)}</span>
    </div>
  )
}

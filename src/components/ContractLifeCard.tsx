import { AlertTriangle, Handshake, Tag, Ticket } from 'lucide-react'
import { money } from '../lib/format'
import { canSignFreeAgents } from '../game/engine/career'
import {
  fifthYearOptionValue,
  optionEligible,
  openHoldouts,
  tagEligible,
  tagSalary,
  tagUsed,
} from '../game/engine/contractLife'
import { marketAsk } from '../game/engine/negotiation'
import { cultureDiscountFor } from '../game/engine/culture'
import { getStatsDb, useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card, OvrBadge } from '../ui/kit'

/**
 * FUTURES 12: the offseason contract-life card — holdouts, franchise/transition
 * tags and Round-1 fifth-year options for the user's own club.
 *
 * It is deliberately user-only: the AI never holds out, tags or exercises an
 * option, so nothing here changes an AI-vs-AI result. Every button is an explicit
 * opt-in decision, and simply ignoring the card changes nothing.
 */
export function ContractLifeCard({ className }: { className?: string }) {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const tagPlayer = useGame((s) => s.tagPlayer)
  const decideFifthYearOption = useGame((s) => s.decideFifthYearOption)
  const resolveHoldout = useGame((s) => s.resolveHoldout)

  // Only the front office that holds the pen sees the decisions, in the offseason.
  if (league.phase !== 'offseason' || !canSignFreeAgents(career)) return null

  const roster = league.roster[career.teamId] ?? []
  const holdouts = openHoldouts(roster, league.season)
  const taggable = roster.filter(tagEligible).sort((a, b) => b.ovr - a.ovr)
  const optionable = roster.filter((p) => optionEligible(p, league.season)).sort((a, b) => b.ovr - a.ovr)
  const franchiseUsed = tagUsed(roster, 'franchise', league.season)
  const transitionUsed = tagUsed(roster, 'transition', league.season)
  // One tag per club per offseason, of either kind.
  const tagApplied = franchiseUsed || transitionUsed

  if (!holdouts.length && !taggable.length && !optionable.length) return null

  return (
    <Card className={className}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 font-display text-lg font-700 uppercase tracking-wide">
          <Handshake size={16} className="text-[var(--team)]" /> Contracts &amp; Holdouts
        </h3>
        <Badge tone="team">Offseason</Badge>
      </div>

      {holdouts.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 flex items-center gap-1.5">
            <AlertTriangle size={13} className="text-warn" />
            <span className="label">Holdouts</span>
          </div>
          <div className="space-y-2">
            {holdouts.map((p) => {
              const disc = cultureDiscountFor(league, getStatsDb(), career.teamId, p)
              const pay = marketAsk(p, league.season, career.skills.negotiation, disc.pct)
              return (
                <div key={p.id} className="rounded-xl border border-warn/30 bg-warn-soft p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <OvrBadge value={p.ovr} pot={p.pot} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-600 text-ink">
                        {p.name} · {p.pos} · age {p.age}
                      </div>
                      <div className="text-[11px] text-muted">
                        {p.contract.years} yr{p.contract.years === 1 ? '' : 's'} left · underpaid:{' '}
                        {money(p.contract.annual)}/yr vs {money(pay)}/yr ask
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="primary" onClick={() => resolveHoldout(p.id, 'pay')}>
                      Pay {money(pay)}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={p.contract.years !== 1 || tagApplied}
                      title={
                        p.contract.years !== 1
                          ? 'Tags only apply in his final year — extend or trade him instead'
                          : tagApplied
                            ? 'Your tag is already used this season'
                            : 'Tag him instead of paying'
                      }
                      onClick={() => resolveHoldout(p.id, 'tag')}
                    >
                      Tag
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => resolveHoldout(p.id, 'trade')}>
                      Trade
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => resolveHoldout(p.id, 'report')}>
                      Let him report
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="mt-1.5 text-[10px] text-faint">
            Paying ends it for good. Tagging keeps him one more year. Trading shops him. Letting him report costs morale — the AI never holds out.
          </p>
        </div>
      )}

      {taggable.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Tag size={13} className="text-[var(--team)]" />
            <span className="label">Franchise &amp; transition tags</span>
            {tagApplied && (
              <Badge tone="neutral">{franchiseUsed ? 'Franchise tag used' : 'Transition tag used'}</Badge>
            )}
          </div>
          <div className="space-y-2">
            {taggable.map((p) => {
              const fr = tagSalary(league.players, p, 'franchise')
              const tr = tagSalary(league.players, p, 'transition')
              return (
                <div key={p.id} className="rounded-xl border border-line bg-surface-2 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <OvrBadge value={p.ovr} pot={p.pot} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-600 text-ink">
                        {p.name} · {p.pos} · age {p.age}
                      </div>
                      <div className="text-[11px] text-muted">
                        Final year · {money(p.contract.annual)}/yr · adds one guaranteed year
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={tagApplied}
                      title={tagApplied ? 'Your tag is already used this season' : 'Top-5 cap-hit rate at his position, or 120% of his salary'}
                      onClick={() => tagPlayer(p.id, 'franchise')}
                    >
                      Franchise · {money(fr)}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={tagApplied}
                      title={tagApplied ? 'Your tag is already used this season' : 'Slightly below the franchise rate'}
                      onClick={() => tagPlayer(p.id, 'transition')}
                    >
                      Transition · {money(tr)}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="mt-1.5 text-[10px] text-faint">
            One tag per season (franchise or transition). The tag guarantees one extra year at the position&apos;s top-5 cap-hit rate, or 120% of his prior salary.
          </p>
        </div>
      )}

      {optionable.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-1.5">
            <Ticket size={13} className="text-[var(--team)]" />
            <span className="label">Fifth-year options · Round 1</span>
          </div>
          <div className="space-y-2">
            {optionable.map((p) => {
              const value = fifthYearOptionValue(league.players, p)
              return (
                <div key={p.id} className="rounded-xl border border-line bg-surface-2 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <OvrBadge value={p.ovr} pot={p.pot} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-600 text-ink">
                        {p.name} · {p.pos} · age {p.age}
                      </div>
                      <div className="text-[11px] text-muted">Rookie deal, final year · option {money(value)}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="primary" onClick={() => decideFifthYearOption(p.id, true)}>
                      Exercise · {money(value)}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => decideFifthYearOption(p.id, false)}>
                      Decline
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="mt-1.5 text-[10px] text-faint">
            Exercising adds a guaranteed option year; declining lets him reach free agency after this season.
          </p>
        </div>
      )}
    </Card>
  )
}

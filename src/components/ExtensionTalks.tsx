import { useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
import { agentStyle, buildExtension, marketAsk, type AgentStyle, type ExtensionOffer } from '../game/engine/negotiation'
import { cultureDiscountFor } from '../game/engine/culture'
import { getStatsDb, useGame, useWorld } from '../store/gameStore'
import { ContractExplainer } from './ContractExplainer'
import { Badge, Button, OvrBadge } from '../ui/kit'

const STYLE_LABEL: Record<AgentStyle, string> = { hardball: 'Hardball', market: 'Market', loyal: 'Loyal' }
const STYLE_BLURB: Record<AgentStyle, string> = {
  hardball: 'Opens above market and does not blink. Needs 100% of his ask.',
  market: 'Fair weather. Needs 95% of his ask.',
  loyal: 'Values continuity. Needs 90% of his ask, or 85% if he is happy.',
}

const GUARANTEES: { id: ExtensionOffer['guarantee']; label: string; pct: number }[] = [
  { id: 'low', label: 'Low', pct: 30 },
  { id: 'mid', label: 'Mid', pct: 50 },
  { id: 'high', label: 'High', pct: 70 },
]

const YEARS = [1, 2, 3, 4, 5]

/**
 * G2: Extension Talks.
 *
 * For rungs with `negotiate`, the Cap screen's Extend button opens this instead
 * of extending instantly. The player's agent has a personality and an ask; you
 * set years, AAV (80–120% of the ask) and guarantees, and he either takes it or
 * uses up one of your three tries this season.
 */
export function ExtensionTalks({ playerId, onClose }: { playerId: string; onClose: () => void }) {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const offerExtension = useGame((s) => s.offerExtension)

  const p = (league.roster[career.teamId] ?? []).find((x) => x.id === playerId)
  const [years, setYears] = useState(3)
  const [pct, setPct] = useState(100)
  const [guarantee, setGuarantee] = useState<ExtensionOffer['guarantee']>('low')

  if (!p) return null

  const style = agentStyle(p.id)
  const disc = cultureDiscountFor(league, getStatsDb(), career.teamId, p)
  const ask = marketAsk(p, league.season, career.skills.negotiation, disc.pct)
  const aav = Math.round((ask * pct) / 100)
  const talk = career.talks?.[playerId]
  const active = talk && talk.season === league.season
  const tries = active ? talk.tries : 0
  const closed = !!active && !!talk.closed
  const triesLeft = Math.max(0, 3 - tries)

  const next = buildExtension(p, league.season, { years, aav, guarantee })
  const projectedNextYear = (next.base[1] ?? next.base[0]) + next.proration

  const makeOffer = () => {
    offerExtension(playerId, { years, aav, guarantee })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-[560px] overflow-y-auto rounded-2xl border border-line bg-canvas p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-lg bg-surface-2 text-muted hover:text-ink"
        >
          <X size={16} />
        </button>

        <div className="mb-4 flex items-center gap-3 pr-10">
          <OvrBadge value={p.ovr} pot={p.pot} size={44} />
          <div className="min-w-0">
            <div className="label">Extension Talks · {p.pos} · age {p.age}</div>
            <h2 className="truncate font-display text-2xl font-700 uppercase leading-none">{p.name}</h2>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone={style === 'hardball' ? 'loss' : style === 'loyal' ? 'win' : 'info'}>
            {STYLE_LABEL[style]} agent
          </Badge>
          <span className="text-xs text-muted">{STYLE_BLURB[style]}</span>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-line bg-surface-2 p-3">
            <div className="label">The ask</div>
            <div className="font-display text-xl font-700 tnum text-ink">
              {money(ask)}<span className="text-sm text-muted">/yr</span>
            </div>
            {disc.pct > 0 && (
              <div className="mt-1 text-[11px] font-600 text-win">
                Winning-culture discount −{disc.pct}% · {disc.reasons.join(', ')}
              </div>
            )}
          </div>
          <div className="rounded-lg border border-line bg-surface-2 p-3">
            <div className="label">Tries left</div>
            <div className={cn('font-display text-xl font-700 tnum', triesLeft === 0 ? 'text-loss' : 'text-ink')}>
              {triesLeft} <span className="text-sm text-muted">of 3</span>
            </div>
          </div>
        </div>

        {closed ? (
          <p className="rounded-lg bg-loss-soft p-3 text-sm text-loss">
            His camp has stopped taking calls this season.
          </p>
        ) : (
          <>
            <div className="mb-4">
              <div className="label mb-1.5">Years</div>
              <div className="flex gap-1.5">
                {YEARS.map((y) => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => setYears(y)}
                    className={cn(
                      'flex-1 rounded-lg border py-1.5 font-cond text-sm font-700 transition',
                      years === y
                        ? 'border-[var(--team)] bg-[var(--team-soft)] text-ink'
                        : 'border-line bg-surface-2 text-muted hover:text-ink',
                    )}
                  >
                    {y}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="label">Average annual value</span>
                <span className="font-cond text-sm font-700 tnum text-ink">
                  {money(aav)}<span className="text-muted">/yr · {pct}% of ask</span>
                </span>
              </div>
              <input
                type="range"
                min={80}
                max={120}
                step={1}
                value={pct}
                onChange={(e) => setPct(Number(e.target.value))}
                className="w-full accent-[var(--team)]"
              />
              <div className="mt-1 flex justify-between font-cond text-[10px] font-700 uppercase text-faint">
                <span>80%</span>
                <span>100%</span>
                <span>120%</span>
              </div>
            </div>

            <div className="mb-4">
              <div className="label mb-1.5">Guarantees</div>
              <div className="flex gap-1.5">
                {GUARANTEES.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setGuarantee(g.id)}
                    className={cn(
                      'flex-1 rounded-lg border py-1.5 text-center transition',
                      guarantee === g.id
                        ? 'border-[var(--team)] bg-[var(--team-soft)]'
                        : 'border-line bg-surface-2 hover:border-line-strong',
                    )}
                  >
                    <span className="block font-cond text-sm font-700 text-ink">{g.label}</span>
                    <span className="block font-cond text-[10px] font-700 uppercase text-muted">
                      {g.pct}% guaranteed
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4 flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2">
              <span className="text-xs text-muted">Projected cap hit next year</span>
              <span className="font-display text-lg font-700 tnum text-ink">{money(projectedNextYear)}</span>
            </div>

            <ContractExplainer player={p} className="mb-4 rounded-lg border border-line bg-surface-2 p-3" />

            <div className="flex items-center justify-end border-t border-line pt-3">
              <Button variant="primary" size="lg" onClick={makeOffer}>
                Make offer
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

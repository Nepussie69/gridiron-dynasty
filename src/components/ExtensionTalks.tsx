import { useState } from 'react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
import { deadMoney } from '../game/engine/cap'
import {
  agentStyle,
  buildExtension,
  judgeOffer,
  marketAsk,
  type AgentStyle,
  type ExtensionOffer,
} from '../game/engine/negotiation'
import { cultureDiscountFor } from '../game/engine/culture'
import { getStatsDb, useGame, useWorld } from '../store/gameStore'
import { ContractExplainer } from './ContractExplainer'
import {
  Badge,
  Button,
  Dialog,
  OptionCard,
  OptionGroup,
  RatingTile,
  SegmentedControl,
  VerdictChip,
} from '../ui/kit'

const STYLE_LABEL: Record<AgentStyle, string> = { hardball: 'Hardball', market: 'Market', loyal: 'Loyal' }
const STYLE_BLURB: Record<AgentStyle, string> = {
  hardball: 'Opens above market and does not blink. Needs 100% of his ask.',
  market: 'Fair weather. Needs 95% of his ask.',
  loyal: 'Values continuity. Needs 90% of his ask, or 85% if he is happy.',
}

const GUARANTEES: { id: ExtensionOffer['guarantee']; label: string; pct: number; boost: number }[] = [
  { id: 'low', label: 'Low', pct: 30, boost: 0 },
  { id: 'mid', label: 'Mid', pct: 50, boost: 4 },
  { id: 'high', label: 'High', pct: 70, boost: 8 },
]

const YEARS = [1, 2, 3, 4, 5]

/**
 * G2: Extension Talks.
 *
 * For rungs with `negotiate`, the Cap screen's Extend button opens this instead
 * of extending instantly. The player's agent has a personality and an ask; you
 * set years, AAV (80–120% of the ask) and guarantees, and he either takes it or
 * uses up one of your three tries this season.
 *
 * D4: kit Dialog; the offered contract is previewed (cap per year and dead
 * money); the AAV slider carries a threshold marker for the chosen guarantee;
 * guarantees are shown in dollars; the try count is stated plainly.
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
  const offeredYears = next.base.slice(Math.max(0, next.base.length - years))
  const newDead = deadMoney(next)
  const g = GUARANTEES.find((x) => x.id === guarantee)!
  const guaranteeDollars = Math.round(aav * years * (g.pct / 100))

  // The line the agent needs, adjusted for the guarantee you are offering.
  const judge = judgeOffer(p, league.season, { years, aav, guarantee }, career.skills.negotiation, disc.pct)
  const securityPenalty = p.age >= 29 && years >= 4 ? 3 : 0
  const threshold = Math.max(80, Math.min(120, judge.needed - g.boost + securityPenalty))
  const willAccept = judge.accepted || pct + 1e-9 >= threshold

  const makeOffer = () => {
    offerExtension(playerId, { years, aav, guarantee })
    onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      eyebrow={`Extension talks · ${p.pos} · age ${p.age}`}
      title={`${p.name}${p.name.endsWith('s') ? '' : '’s'} extension`}
      subtitle="Set the years, the money and the guarantees. He takes it, or it burns one of your three tries this season."
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="lg" disabled={closed || triesLeft === 0} onClick={makeOffer}>
            Make offer · uses 1 of 3 tries
          </Button>
        </>
      }
    >
      <div className="mb-3 flex items-center gap-3">
        <RatingTile value={p.ovr} size="lg" tierWord delta label="Overall" />
        <div className="min-w-0">
          <div className="font-display text-[20px] font-800 italic uppercase leading-none text-ink">{p.name}</div>
          <div className="mt-1 text-small text-muted">
            {p.pos} · age {p.age} · {money(p.contract.capHit)} cap hit · {p.contract.years} yr
            {p.contract.years === 1 ? '' : 's'} left
          </div>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={style === 'hardball' ? 'loss' : style === 'loyal' ? 'win' : 'info'}>{STYLE_LABEL[style]} agent</Badge>
        <span className="text-small text-muted">{STYLE_BLURB[style]}</span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-[var(--r-md)] border border-line bg-surface-2 p-3">
          <div className="label">The ask</div>
          <div className="font-display text-[24px] font-800 italic leading-none text-ink tnum">
            {money(ask)}
            <span className="ml-1 text-small font-600 not-italic text-muted">/yr</span>
          </div>
          {disc.pct > 0 && (
            <div className="mt-1 text-label font-600 text-win">
              Winning-culture discount −{disc.pct}% · {disc.reasons.join(', ')}
            </div>
          )}
        </div>
        <div className="rounded-[var(--r-md)] border border-line bg-surface-2 p-3">
          <div className="label">Tries left</div>
          <div className={cn('font-display text-[24px] font-800 italic leading-none tnum', triesLeft === 0 ? 'text-loss' : 'text-ink')}>
            {triesLeft}
            <span className="ml-1 text-small font-600 not-italic text-muted">of 3</span>
          </div>
          <div className="mt-1 text-label text-muted">Each offer uses one try this season.</div>
        </div>
      </div>

      {closed ? (
        <p className="rounded-[var(--r-md)] bg-loss-soft p-3 text-small text-loss">
          His camp has stopped taking calls this season.
        </p>
      ) : (
        <>
          <div className="mb-4">
            <div className="label mb-1.5">Years added</div>
            <SegmentedControl
              label="Extension years"
              value={String(years)}
              onChange={(v) => setYears(Number(v))}
              options={YEARS.map((y) => ({ id: String(y), label: `${y}` }))}
            />
          </div>

          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="label">Average annual value</span>
              <span className="font-cond text-small font-700 text-ink tnum">
                {money(aav)}
                <span className="text-muted">/yr · {pct}% of ask</span>
              </span>
            </div>
            <div className="relative pt-4">
              {/* Threshold marker: the % of ask the agent needs, given this guarantee. */}
              <div
                aria-hidden
                className="pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${((threshold - 80) / 40) * 100}%` }}
              >
                <span
                  className={cn(
                    'font-cond text-micro font-700 uppercase tracking-[0.05em]',
                    willAccept ? 'text-win' : 'text-warn',
                  )}
                >
                  needs {threshold}%
                </span>
                <span className={cn('mx-auto block h-2.5 w-[2px]', willAccept ? 'bg-win' : 'bg-warn')} />
              </div>
              <input
                type="range"
                min={80}
                max={120}
                step={1}
                value={pct}
                onChange={(e) => setPct(Number(e.target.value))}
                className="h-9 w-full accent-[var(--team-accent)] max-sm:h-11"
                aria-label="Offer as a percentage of the ask"
              />
            </div>
            <div className="mt-0.5 flex justify-between font-cond text-label font-700 uppercase text-faint">
              <span>Lowball · 80%</span>
              <span>Ask · 100%</span>
              <span>Above ask · 120%</span>
            </div>
            <div className="mt-1.5">
              <VerdictChip tone={willAccept ? 'win' : 'warn'}>
                {willAccept ? 'He would sign this' : 'Short of his line'}
              </VerdictChip>
            </div>
          </div>

          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="label">Guarantees</span>
              <span className="font-cond text-small font-700 text-ink tnum">{money(guaranteeDollars)} guaranteed</span>
            </div>
            <OptionGroup label="Guarantee level">
              {GUARANTEES.map((opt) => (
                <OptionCard
                  key={opt.id}
                  selected={guarantee === opt.id}
                  title={`${opt.label} · ${opt.pct}%`}
                  description={`${money(Math.round(aav * years * (opt.pct / 100)))} of ${money(aav * years)} guaranteed`}
                  onSelect={() => setGuarantee(opt.id)}
                />
              ))}
            </OptionGroup>
          </div>

          <div className="mb-4 rounded-[var(--r-md)] border border-line p-3">
            <div className="label mb-2">The offer on the table · {years} yr · {money(aav)}/yr</div>
            <dl className="divide-y divide-line rounded-[var(--r-sm)] border border-line text-small">
              {offeredYears.map((base, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-1.5">
                  <dt className="text-ink-2">Year {i + 1} cap hit</dt>
                  <dd className="font-600 text-ink tnum">{money(base + next.proration)}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between px-3 py-1.5">
                <dt className="text-ink-2">Total value</dt>
                <dd className="font-600 text-ink tnum">{money(aav * years)}</dd>
              </div>
              <div className="flex items-center justify-between px-3 py-1.5">
                <dt className="text-ink-2">Guaranteed</dt>
                <dd className="font-600 text-ink tnum">{money(guaranteeDollars)}</dd>
              </div>
              <div className="flex items-center justify-between px-3 py-1.5">
                <dt className="text-ink-2">Dead money if cut later</dt>
                <dd className="font-600 text-ink tnum">{money(newDead)}</dd>
              </div>
            </dl>
          </div>

          <ContractExplainer player={p} className="rounded-[var(--r-md)] border border-line bg-surface-2 p-3" />
        </>
      )}
    </Dialog>
  )
}

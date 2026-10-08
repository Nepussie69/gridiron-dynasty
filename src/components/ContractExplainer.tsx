import { money } from '../lib/format'
import { SALARY_CAP, deadMoney, remainingContractValue } from '../game/engine/cap'
import { marketAsk } from '../game/engine/negotiation'
import { capabilities } from '../game/engine/capabilities'
import { canAskGm } from '../game/engine/gmAsk'
import { useGame, useWorld } from '../store/gameStore'
import type { Player } from '../game/types'

/**
 * L12.14 C5: the "how it works" panel. On the extension card, the GM-ask panel and
 * the Cap screen it explains — for the rung you are actually on — who negotiates,
 * what the GM weighs, that the cap is fixed, and the dead-money rule, with the
 * live numbers for the player in front of you.
 */
export function ContractExplainer({ player, className }: { player?: Player; className?: string }) {
  const career = useGame((s) => s.career)!
  const league = useWorld()
  const caps = capabilities(career).can
  const coach = canAskGm(career)
  const ownsCap = caps.has('manageCap')
  const canNegotiate = caps.has('negotiate')

  const who = coach
    ? 'You call the plays, so you cannot sign deals: you can ask the GM to extend a player, once per player per season. The GM negotiates at market.'
    : ownsCap
      ? 'You own the cap: you negotiate and sign extensions yourself.'
      : canNegotiate
        ? 'You negotiate extensions, but the GM still signs off on anything over market or short on room.'
        : 'Contracts unlock at Director of Player Personnel. Keep climbing.'

  return (
    <div className={className}>
      <div className="label mb-1.5">How extensions work</div>
      <p className="text-xs leading-relaxed text-muted">{who}</p>
      <ul className="mt-2 space-y-1 text-xs leading-relaxed text-muted">
        <li>
          · The salary cap is <span className="font-600 text-ink-2">fixed at {money(SALARY_CAP)}</span> (the 2025
          number) every season — it never grows.
        </li>
        {coach && (
          <li>
            · The GM weighs the player&apos;s OVR, age and position value, the room the deal leaves under the cap,
            your standing (leadership {career.reputation.leadership} · job security {career.jobSecurity}) and the
            owner&apos;s mandate.
          </li>
        )}
        <li>
          · Cutting a player accelerates his <span className="font-600 text-ink-2">remaining prorated bonus</span>{' '}
          plus any <span className="font-600 text-ink-2">guaranteed salary</span> — never more than his remaining
          contract value.
        </li>
      </ul>
      {player && (
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line pt-3 sm:grid-cols-3">
          <ExplainerStat label="Cap hit" value={money(player.contract.capHit)} />
          <ExplainerStat label="AAV" value={money(player.contract.annual)} />
          <ExplainerStat label="Years left" value={player.contract.years} />
          <ExplainerStat
            label="Dead money"
            value={`${money(deadMoney(player.contract))} of ${money(remainingContractValue(player.contract))}`}
          />
          <ExplainerStat label="Market ask" value={`${money(marketAsk(player, league.season))}/yr`} />
          <ExplainerStat label="Remaining value" value={money(remainingContractValue(player.contract))} />
        </div>
      )}
    </div>
  )
}

function ExplainerStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="label !text-[9px]">{label}</div>
      <div className="font-cond text-sm font-700 tnum text-ink">{value}</div>
    </div>
  )
}

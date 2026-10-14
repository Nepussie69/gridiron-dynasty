import { isHeadCoachCareer } from '../game/engine/access'
import { useGame } from '../store/gameStore'
import { SegmentedControl } from '../ui/kit'

/**
 * Head coach only: who holds the pen on trades. "GM decides" is the default —
 * you advise and ask the GM. "I decide" takes the pen: you propose, accept and
 * execute trades yourself (Trade Center, deadline day, draft day) and the club's
 * AI GM makes none involving your club on its own. Renders nothing for any
 * other career (personnel careers already decide).
 */
export function TradeControlToggle({ size = 'md', className }: { size?: 'sm' | 'md'; className?: string }) {
  const career = useGame((s) => s.career)
  const setTradeControl = useGame((s) => s.setTradeControl)
  if (!career || !isHeadCoachCareer(career)) return null
  return (
    <SegmentedControl
      label="Trades"
      size={size}
      className={className}
      value={career.tradeControl === 'coach' ? 'coach' : 'gm'}
      onChange={setTradeControl}
      options={[
        { id: 'gm', label: 'GM decides', title: 'The GM holds the pen on trades; you advise and ask' },
        { id: 'coach', label: 'I decide', title: 'You propose, accept and execute trades yourself; the AI GM stays out of your club’s trades' },
      ]}
    />
  )
}

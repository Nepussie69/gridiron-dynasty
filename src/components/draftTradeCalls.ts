import { accessFor, coachHoldsTradePen } from '../game/engine/access'
import { draftOpen } from '../game/engine/draft'
import { buildDraftTradeDownOffers } from '../game/engine/draftTrades'
import { tradeDownOfferLimit } from '../game/engine/draftRoom'
import { useGame, useWorld } from '../store/gameStore'

/** Row 459: how many clubs are calling about the user's pick right now (the
 *  Trades view's count on the Draft screen). Same conditions as the panel. */
export function useDraftTradeCalls(): number {
  const world = useWorld()
  const career = useGame((s) => s.career)
  if (!career || !draftOpen(world) || world.draftState.complete) return 0
  if (accessFor(career, 'trades') !== 'decide') return 0
  const deciding = accessFor(career, 'draft') === 'decide'
  if (!deciding && !coachHoldsTradePen(career)) return 0
  if (world.draftOrder[world.draftState.pickIndex] !== career.teamId) return 0
  return buildDraftTradeDownOffers(world, career.teamId, tradeDownOfferLimit(world, career)).length
}

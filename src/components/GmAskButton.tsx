import { Handshake } from 'lucide-react'
import { coachHoldsTradePen } from '../game/engine/access'
import { canAskGm, gmAskCovers } from '../game/engine/gmAsk'
import { monthKeyOf } from '../game/engine/gmDesk'
import { useGame, useWorld } from '../store/gameStore'
import { Button } from '../ui/kit'
import type { Player } from '../game/types'

/**
 * L12.14 C6: a compact "ask the GM" button for player rows on the Trade Center
 * and Free Agency screens. Renders nothing unless the rung asks the GM (HC or a
 * play-caller) and the player is on the coach's side of the ball (and, for trades,
 * the head coach has not taken the trade pen from the GM). Disabled once
 * this player has already been raised this month.
 */
export function GmAskButton({
  player,
  kind,
  label,
  title,
}: {
  player: Player
  kind: 'trade' | 'sign'
  label?: string
  title?: string
}) {
  const career = useGame((s) => s.career)
  const league = useWorld()
  const requestGmTrade = useGame((s) => s.requestGmTrade)
  const requestGmSignFreeAgent = useGame((s) => s.requestGmSignFreeAgent)

  if (!career || !canAskGm(career) || !gmAskCovers(career, player.pos)) return null
  // A head coach holding the trade pen makes the deal himself — no asking the GM to get a player.
  if (kind === 'trade' && coachHoldsTradePen(career)) return null

  const asked = career.gmRequestLog?.[player.id] === monthKeyOf(league.season, league.week)
  const text = label ?? (kind === 'trade' ? 'Ask GM to get' : 'Ask GM to sign')

  return (
    <Button
      size="sm"
      variant="secondary"
      rowSafe
      disabled={asked}
      title={title ?? 'Send a request to the front office'}
      onClick={() => (kind === 'trade' ? requestGmTrade(player.id) : requestGmSignFreeAgent(player.id))}
    >
      <Handshake size={12} /> {asked ? 'Asked' : text}
    </Button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// L12.8 V1: a one-shot handoff from a club page to the Trade Center.
//
// The team page's "Trade for…" button records a request and switches screens;
// the Trade Center (a different, freshly-mounted screen) reads it once on mount
// and loads that club + player on the Get side. Kept out of the store so this
// UI-only handoff adds no persisted state.
// ─────────────────────────────────────────────────────────────────────────────

export interface TradeRequest {
  teamId: string
  playerId: string
}

let pending: TradeRequest | null = null

/** Ask the Trade Center to open with `playerId` loaded from `teamId`. */
export function requestTradeFor(teamId: string, playerId: string): void {
  pending = { teamId, playerId }
}

/** The pending request without consuming it (safe to read every render). */
export function peekTradeRequest(): TradeRequest | null {
  return pending
}

/** Clear the pending request once the Trade Center has taken it. */
export function clearTradeRequest(): void {
  pending = null
}

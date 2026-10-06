// ─────────────────────────────────────────────────────────────────────────────
// Extension talks (G2).
//
// Personnel rungs with `negotiate` negotiate second contracts instead of
// one-click extending. Every player has an agent with a personality — Hardball,
// Market or Loyal — who quotes an ask above (or below) market value and holds a
// line on what he will sign. Guarantees sweeten the deal; asking a veteran for
// four-plus years asks him to buy in. The contract made here mirrors the shape
// `extendContract` returns, but at the negotiated AAV instead of market.
// ─────────────────────────────────────────────────────────────────────────────

import type { Contract, Player } from '../types'
import { capScale, marketAAV, recomputeCapHit } from './cap'
import { hash32 } from './rng'

export type AgentStyle = 'hardball' | 'market' | 'loyal'

/** How far above (or below) market an agent opens, by personality. */
const STYLE_MULT: Record<AgentStyle, number> = {
  hardball: 1.12,
  market: 1.04,
  loyal: 0.98,
}

/** The agent's personality, fixed per player. */
export function agentStyle(playerId: string): AgentStyle {
  return (['hardball', 'market', 'loyal'] as const)[hash32(playerId, 131) % 3]
}

/**
 * The agent's opening ask: market AAV, cap-scaled, marked up by his personality,
 * rounded to the nearest $100K.
 */
export function marketAsk(p: Player, season: number): number {
  const ask = marketAAV(p.ovr, p.pos, p.age) * capScale(season) * STYLE_MULT[agentStyle(p.id)]
  return Math.round(ask / 1e5) * 1e5
}

export interface ExtensionOffer {
  years: number
  aav: number
  guarantee: 'low' | 'mid' | 'high'
}

/** The percentage of the ask each personality needs to sign. */
function acceptanceLine(p: Player, style: AgentStyle): number {
  if (style === 'hardball') return 100
  if (style === 'market') return 95
  // Loyal: a happy player gives five points of leeway.
  return p.morale >= 75 ? 85 : 90
}

/** What the agent says about an offer, and whether he takes it. */
export function judgeOffer(
  p: Player,
  season: number,
  offer: ExtensionOffer,
): { accepted: boolean; pctOfAsk: number; needed: number; message: string } {
  const style = agentStyle(p.id)
  const ask = marketAsk(p, season)
  const pctOfAsk = ask > 0 ? (offer.aav / ask) * 100 : 100
  const needed = acceptanceLine(p, style)
  // Guarantees count toward acceptance; a 4+ year ask on a veteran costs a little.
  const guaranteeBoost = offer.guarantee === 'low' ? 0 : offer.guarantee === 'mid' ? 4 : 8
  const securityPenalty = p.age >= 29 && offer.years >= 4 ? 3 : 0
  const effective = pctOfAsk + guaranteeBoost - securityPenalty
  const accepted = effective >= needed
  const label = style[0].toUpperCase() + style.slice(1)
  const message = accepted
    ? `${label} agent: ${Math.round(pctOfAsk)}% of ask gets it done.`
    : `${label} agent: ${Math.round(pctOfAsk)}% of ask won't do it.`
  return { accepted, pctOfAsk, needed, message }
}

/**
 * Build the extension contract: keeps the current deal and adds `offer.years`
 * new years at `offer.aav`, with a guarantee percentage of the new total. Shape
 * matches `extendContract` in cap.ts (base escalates, guaranteed = total * pct).
 */
export function buildExtension(p: Player, season: number, offer: ExtensionOffer): Contract {
  const c = p.contract
  const length = Math.max(1, Math.round(offer.years))
  const total = offer.aav * length
  const guaranteedPct = offer.guarantee === 'low' ? 0.3 : offer.guarantee === 'mid' ? 0.5 : 0.7
  const bonusPct = p.ovr >= 90 ? 0.46 : p.ovr >= 82 ? 0.36 : p.ovr >= 72 ? 0.24 : 0.14
  const signingBonus = Math.round(total * bonusPct)
  const totalBase = total - signingBonus
  // Escalating base schedule, normalized to the total base (mirrors extendContract).
  const weights = Array.from({ length }, (_, i) => 0.85 + i * 0.08)
  const wsum = weights.reduce((a, b) => a + b, 0)
  const base = weights.map((w) => Math.round((totalBase * w) / wsum))
  const years = c.years + length
  const next: Contract = {
    ...c,
    years,
    length: c.length + length,
    base: [...c.base, ...base],
    signingBonus: c.signingBonus + signingBonus,
    proration: c.proration + Math.round(signingBonus / length),
    guaranteed: c.guaranteed + Math.round(total * guaranteedPct),
    annual: Math.round((c.annual * c.years + offer.aav * length) / years),
    signedThrough: season + years - 1,
  }
  return recomputeCapHit(next)
}

// ─────────────────────────────────────────────────────────────────────────────
// REALISM2 #12 — player personalities in contracts.
//
// Every player has his own priorities — money, winning, loyalty, playing time
// and market — fixed deterministically from his stable id, his age and his
// agent's style. They show up wherever money changes hands: the AI re-sign pass,
// the free-agent market, extension talks with the user's club, and the rare
// holdout. Nothing here draws from the sim's `rng()` stream (it is all
// `hash32`/`h01` off the player id), and nothing here touches a snap — this
// module is contract-only, so the play sim is byte-identical with it on or off.
//
// NFL truth (analysis/r2personality_nfl.py, OverTheCap contract history,
// 9,560 players / 31,893 contracts):
//   · incumbent re-sign share ≈ 46% of successor deals (top-APY men ≈ 51–56%);
//   · an incumbent re-sign lands ≈ 3.3% below the same position×year market
//     (median residual +17.9% in house vs +21.2% on the open market) — a small,
//     real hometown discount;
//   · within a position×year the APY CV is ≈ 1.32 with p90/median ≈ 6.8 — the
//     market's deals are wide, and personality is part of why;
//   · holdouts are rare: ≈ 7 a season league-wide (~0.4% of the 1,700-man
//     league), not a routine negotiating tactic.
// Everything in this file is gated by `R2PERSONALITY.on`; with it off the
// callers take their original branch and every number below is unused.
// ─────────────────────────────────────────────────────────────────────────────

import type { Player } from '../types'
import { clamp, hash32 } from './rng'
import type { World } from './generate'

/** One exported knob object: the whole feature's calibration lives here. */
export const R2PERSONALITY = {
  on: true,
  /** How hard the money priority moves the ask away from the mean. */
  moneyW: 0.8,
  /** How hard a market-first player prices off the newest deal he has seen. */
  marketW: 0.6,
  /** The most a maximally loyal player takes off to stay (NFL truth ≈ 3.3%). */
  loyalDiscMax: 0.12,
  /** A ring-chaser leaves a little money on the table for a contender. */
  winDiscMax: 0.05,
  /** …and a losing club has to pay him over the odds. */
  losePremMax: 0.07,
  /** Snaps/reps promised move the ask a touch. */
  roleW: 0.25,
  /** Holdout base rate among qualifying (underpaid, star) candidates, in %. */
  holdoutBase: 7,
  /** Money-first players hold out more; loyal ones almost never do. */
  holdoutMoneyW: 40,
  holdoutLoyalW: 12,
  /** How strongly loyalty holds a man at home when his club comes calling. */
  resignHomeHold: 0.35,
  /** How strongly a ring-chaser walks from a club that is not close. */
  resignWinWalk: 0.4,
  /** How hard a man who thinks the club's number is under his worth tests the market. */
  resignUnderpayWalk: 2.5,
} as const

export function setR2Personality(on: boolean): void {
  ;(R2PERSONALITY as { on: boolean }).on = on
}

export function getR2Personality(): boolean {
  return R2PERSONALITY.on
}

export type ContractPriority = 'money' | 'winning' | 'loyalty' | 'playingTime' | 'market'

export interface PlayerPriorities {
  money: number
  winning: number
  loyalty: number
  playingTime: number
  market: number
}

export const PRIORITY_LABEL: Record<ContractPriority, string> = {
  money: 'Money',
  winning: 'Winning',
  loyalty: 'Loyalty',
  playingTime: 'Playing time',
  market: 'Market value',
}

/** The league's centre of gravity, before personality or age move it. */
const P_BASE: PlayerPriorities = { money: 0.32, winning: 0.17, loyalty: 0.21, playingTime: 0.14, market: 0.16 }

const PRIORITY_KEYS: ContractPriority[] = ['money', 'winning', 'loyalty', 'playingTime', 'market']

/** The agent's personality. One implementation — `negotiation.agentStyle` delegates here. */
export function styleOf(playerId: string): 'hardball' | 'market' | 'loyal' {
  return (['hardball', 'market', 'loyal'] as const)[hash32(playerId, 131) % 3]
}

function normalise(w: PlayerPriorities): PlayerPriorities {
  for (const k of PRIORITY_KEYS) w[k] = Math.max(0.02, w[k])
  const sum = PRIORITY_KEYS.reduce((s, k) => s + w[k], 0)
  for (const k of PRIORITY_KEYS) w[k] = Math.round((w[k] / sum) * 1000) / 1000
  return w
}

/**
 * What this player cares about. Deterministic from his id, age and agent style;
 * the five weights sum to 1. Jittered per man so no two are the same shape, but
 * the centre is the league's and the agent style sets the tilt (a hardball agent
 * is a money man, a loyal one prizes continuity, a market agent reads the board).
 */
export function playerPriorities(p: Player, _season = 0): PlayerPriorities {
  const j = (k: number) => ((hash32(p.id, 1301 + k) % 1000) / 1000 - 0.5) * 0.14
  const w: PlayerPriorities = {
    money: P_BASE.money + j(1),
    winning: P_BASE.winning + j(2),
    loyalty: P_BASE.loyalty + j(3),
    playingTime: P_BASE.playingTime + j(4),
    market: P_BASE.market + j(5),
  }
  const style = styleOf(p.id)
  if (style === 'hardball') w.money += 0.16
  else if (style === 'loyal') w.loyalty += 0.14
  else w.market += 0.1
  // Veterans chase a ring; the young chase reps and the bag.
  if (p.age >= 30) w.winning += 0.08
  if (p.age <= 26) {
    w.playingTime += 0.06
    w.money += 0.03
  }
  return normalise(w)
}

/** The single thing this player cares about most — what the UI shows first. */
export function primaryPriority(p: Player, season = 0): ContractPriority {
  const w = playerPriorities(p, season)
  return PRIORITY_KEYS.reduce((a, b) => (w[b] > w[a] ? b : a), 'money' as ContractPriority)
}

/** A one-line read of the man in the talks, for the extension screen. */
export function priorityRead(p: Player, season = 0): string {
  const ps = primaryPriority(p, season)
  const style = styleOf(p.id)
  const who = style === 'hardball' ? 'Hardball agent' : style === 'loyal' ? 'Loyal agent' : 'Market agent'
  return `${PRIORITY_LABEL[ps]} first · ${who}`
}

/** Is this club a place a ring-chaser would take less to join? */
export function contenderFlag(world: World, teamId: string): boolean {
  const r = world.standings?.[teamId]
  if (!r) return true
  const played = r.wins + r.losses + r.ties
  if (!played) return true
  return (r.wins + r.ties * 0.5) / played >= 0.5
}

export interface PersonalityCtx {
  /** He is talking to the club that already holds his rights. */
  incumbent?: boolean
  /** The club is a contender (only consulted when known). */
  contender?: boolean
}

/**
 * The multiplier on this man's market ask from his own priorities. 1 with the
 * toggle off; symmetric around the league's own centre, wide for a money man
 * and short for a loyal one. Small — this is a personality, not a different
 * league. `ctx` describes the club doing the asking.
 */
export function personalityAskFactor(p: Player, season: number, ctx: PersonalityCtx = {}): number {
  if (!R2PERSONALITY.on) return 1
  const w = playerPriorities(p, season)
  let f = 1
  f += (w.money - P_BASE.money) * R2PERSONALITY.moneyW
  f += (w.market - P_BASE.market) * R2PERSONALITY.marketW
  f += (w.playingTime - P_BASE.playingTime) * R2PERSONALITY.roleW
  if (ctx.incumbent) f -= w.loyalty * R2PERSONALITY.loyalDiscMax
  else f += w.loyalty * R2PERSONALITY.loyalDiscMax * 0.5
  if (ctx.contender === true) f -= w.winning * R2PERSONALITY.winDiscMax
  else if (ctx.contender === false) f += w.winning * R2PERSONALITY.losePremMax
  return clamp(f, 0.85, 1.25)
}

/** The hometown discount (per cent) a player of this makeup gives his own club. */
export function hometownDiscountPct(p: Player, season = 0): number {
  if (!R2PERSONALITY.on) return 0
  return Math.round(playerPriorities(p, season).loyalty * R2PERSONALITY.loyalDiscMax * 1000) / 10
}

/** The factor for a deal with the club that already holds his rights. */
export function extensionFactorFor(p: Player, world: World, teamId: string): number {
  return personalityAskFactor(p, world.season, { incumbent: p.teamId === teamId, contender: contenderFlag(world, teamId) })
}

/**
 * Does he re-sign with this club, and at what AAV? Returns the club's offer
 * marked by his own priorities, and whether he takes it at all: a man who
 * prizes winning will not re-up with a club that is not close, and the men who
 * do stay are the loyal ones. Deterministic (id + season), no draws.
 */
export function personalityResign(
  world: World,
  teamId: string,
  p: Player,
  offerAav: number,
): { aav: number; signs: boolean } {
  if (!R2PERSONALITY.on) return { aav: offerAav, signs: true }
  const season = world.season
  const w = playerPriorities(p, season)
  const contender = contenderFlag(world, teamId)
  const factor = personalityAskFactor(p, season, { incumbent: true, contender })
  const aav = Math.round((offerAav * factor) / 1e5) * 1e5
  // He is still free to prefer the market: a ring-chaser on a club that is not
  // close takes his chances in March, a man who believes he is worth more than
  // the club's number tests the market, and a man with no loyalty at all leaves.
  let walk = 0
  if (!contender) walk += w.winning * R2PERSONALITY.resignWinWalk
  walk += Math.max(0, factor - 1) * R2PERSONALITY.resignUnderpayWalk
  walk += Math.max(0, (P_BASE.loyalty - w.loyalty) * 0.4)
  const roll = (hash32(`${p.id}:${season}`, 3313) % 1000) / 1000
  return { aav, signs: roll >= clamp(walk, 0, 0.6) }
}

/** The holdout rate (per cent) for a qualifying underpaid star of this makeup. */
export function holdoutRatePct(p: Player, season: number): number {
  if (!R2PERSONALITY.on) return 0
  const w = playerPriorities(p, season)
  const base =
    R2PERSONALITY.holdoutBase +
    (w.money - P_BASE.money) * R2PERSONALITY.holdoutMoneyW -
    w.loyalty * R2PERSONALITY.holdoutLoyalW
  return Math.round(clamp(base, 1, 45) * 10) / 10
}

/**
 * Deterministic yes/no on the SAME hash the contract-life pass always used
 * (`${id}:${season}:holdout`, salt 977), so a switch from the flat rate to the
 * personality rate keeps the same stream shape — only the threshold moves.
 */
export function personalityHoldsOut(p: Player, season: number): boolean {
  if (!R2PERSONALITY.on) return hash32(`${p.id}:${season}:holdout`, 977) % 100 < 70
  return hash32(`${p.id}:${season}:holdout`, 977) % 100 < Math.round(holdoutRatePct(p, season))
}

/** The free-agent ask factor for a club he does not belong to yet. */
export function personalityFaaFactor(world: World, teamId: string, p: Player): number {
  return personalityAskFactor(p, world.season, { incumbent: p.teamId === teamId, contender: contenderFlag(world, teamId) })
}

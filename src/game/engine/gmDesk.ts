// ─────────────────────────────────────────────────────────────────────────────
// L12.14 C6: the GM requests desk.
//
// The head coach (and coordinators, for their side of the ball) cannot sign,
// trade, cut or restructure — the GM holds the pen. This desk lets the coach
// file a request and get a deterministic answer, using ONLY the existing
// contract / restructure / trade / free-agency functions. No rng, no new
// pricing, no changes to evaluateTrade.
//
//   · extend       → C4's gmExtendDecision
//   · restructure  → convert base to bonus on 1–3 big deals, only for a NAMED
//                    trade/FA target the room is actually needed for, and only
//                    while the club is contending
//   · trade        → findPackagesFor, protecting every fielded starter on the
//                    coach's side(s) plus up to 3 untouchables, then the best
//                    acceptable package that fits
//   · sign         → bid the market price when the space after the bid clears
//                    a reserve (restructuring first if the coach green-lit it)
//   · release      → agree only when dead money ≤ the net cap saved and he isn't
//                    a healthy, depth-order starter (or poor production backs it)
//
// Answers lean "yes" with leadership / record, "no" with low job security or
// a rebuild mandate (or win-now for cutting productive veterans).
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, Player, Position } from '../types'
import type { World } from './generate'
import { deadMoney, capSavings, restructure, summarizeCap, remainingContractValue } from './cap'
import { evaluateTrade, findPackagesFor, type DealOffer } from './trade'
import { freeAgentContract } from './progress'
import { STARTERS, depthAt, teamRatings, topPlayers } from './depth'
import { installSides } from './install'
import { mainStatValue, seasonLine } from './stats'
import { canAskGm, gmAskCovers, gmExtendDecision, gmOffer, type GmAskResult } from './gmAsk'
import { unscaleOvr } from './ovrScale'

export type GmRequestKind = 'extend' | 'restructure' | 'trade' | 'sign' | 'release'
export type GmRequestOutcome = 'done' | 'notNow' | 'declined'

export interface GmRequestPlan {
  /** Players the store should restructure, in order. */
  restructureIds: string[]
  /** Base salary converted to bonus across those deals (the future dead risk). */
  restructured: number
  /** Cap hit freed this year by those restructures. */
  capFreed: number
}

export interface GmRequestResult {
  kind: GmRequestKind
  outcome: GmRequestOutcome
  reason: string
  message: string
  /** Optional inbox headline; defaults to a generic "GM: <label> — <name>". */
  headline?: string
  playerId?: string
  playerName?: string
  /** A trade the GM executed (already applied by the store). */
  offer?: DealOffer
  /** Moved-player log for a trade. */
  moved?: string[]
  /** A restructure plan the signing needed, applied before the move. */
  plan?: GmRequestPlan
  /** Cap freed by a restructure plan. */
  capFreed?: number
  /** Base converted to bonus (dead money pushed into later years). */
  deadRisk?: number
  /** Year-one cap hit added by a signing. */
  capAdded?: number
  /** Cap saved net of dead money on a release. */
  capSaved?: number
  /** Dead money charged on a release. */
  dead?: number
}

/** How a club reads right now: strength rank, record, and whether it's pushing. */
export interface ContendView {
  rank: number
  contending: boolean
  winPct: number
}

/** Deterministic 1–32 strength ranking (record blended with the fielded lineup). */
export function contendView(world: World, teamId: string): ContendView {
  const rows = world.teams
    .filter((t) => t.tier === 'NFL')
    .map((t) => {
      const r = world.standings[t.id]
      const wins = r?.wins ?? 0
      const losses = r?.losses ?? 0
      const ties = r?.ties ?? 0
      const played = wins + losses + ties
      const pct = played ? (wins + ties * 0.5) / played : 0.5
      const score = pct * 60 + (teamRatings(world, t.id).overall - 65) * 1.2
      return { id: t.id, score, pct }
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  const idx = rows.findIndex((r) => r.id === teamId)
  const row = idx >= 0 ? rows[idx] : undefined
  const pct = row?.pct ?? 0.5
  return { rank: idx >= 0 ? idx + 1 : 32, contending: idx >= 0 && (idx < 12 || pct >= 0.55), winPct: pct }
}

/** The coach's standing with the front office, 0–100: leadership + security + record. */
export function gmTrust(world: World, career: CareerState): number {
  const r = world.standings[career.teamId]
  const wins = r?.wins ?? 0
  const losses = r?.losses ?? 0
  const ties = r?.ties ?? 0
  const played = Math.max(1, wins + losses + ties)
  const winPct = (wins + ties * 0.5) / played
  const raw = career.reputation.leadership * 0.42 + career.jobSecurity * 0.33 + winPct * 100 * 0.25
  return Math.max(0, Math.min(100, Math.round(raw)))
}

/** Owner's mandate, read the same way C4 reads it. */
function mandateOf(career: CareerState): { rebuild: boolean; winNow: boolean } {
  const m = (career.ownerExpectation ?? '').toLowerCase()
  return {
    rebuild: /draft|build|young|three-year/.test(m),
    winNow: /playoff|championship|title|win now|make a change/.test(m),
  }
}

/**
 * Which players the GM won't send away: the coach's untouchables plus every
 * fielded starter on the coach's side(s) of the ball. A coordinator protects
 * only his own side; the head coach (or a `unitFocus: 'both'` role) protects
 * both. The starters come from the same healthy, depth-ordered slices the sim
 * fields, so a stored depth chart is respected rather than OVR alone.
 */
export function protectedPlayers(world: World, career: CareerState): Set<string> {
  const out = new Set<string>()
  const rosterIds = new Set((world.roster[career.teamId] ?? []).map((p) => p.id))
  for (const id of career.gmUntouchables ?? []) {
    if (rosterIds.has(id)) out.add(id)
  }
  for (const side of installSides(career)) {
    for (const p of topPlayers(world, career.teamId, side, 99)) out.add(p.id)
  }
  return out
}

/**
 * Poor production: a healthy sample this season well under what his rating
 * implies. Used so a struggling starter can still be moved on.
 */
export function poorProduction(world: World, p: Player): boolean {
  const line = seasonLine(p, world.season, 'NFL')
  if (!line || line.games < 4) return false
  const value = mainStatValue(p, line)
  if (value == null) return false
  // A rough per-position benchmark for a 17-game starter, scaled to his snaps.
  const FULL: Record<string, number> = { QB: 3800, RB: 950, WR: 850, TE: 600, FB: 120, DE: 45, DT: 45, LB: 95, CB: 80, S: 80, K: 85, P: 0 }
  const full = FULL[p.pos] ?? 0
  if (full <= 0) return unscaleOvr(p.ovr) < 70
  const expected = (full * line.games) / 17
  return value < expected * 0.55
}

/** Cap hit a trade asset brings with it (players only). */
function capOf(world: World, id: string): number {
  const p = world.players.find((x) => x.id === id)
  return p?.contract.capHit ?? 0
}

const money = (n: number) => `$${(n / 1e6).toFixed(1)}M`

export interface GmRestructureDecision extends GmRequestResult {
  plan?: GmRequestPlan
}

/** A named trade/FA target the coach wants the GM to clear space for. */
export interface GmRestructureTarget {
  id: string
  name: string
  pos: Position
  kind: 'trade' | 'sign'
  ovr: number
  /** Cap hit that has to be cleared this year to fit him. */
  need: number
}

/** The cap room the GM would have to clear to fit one named target. */
function capNeedForTarget(
  world: World,
  career: CareerState,
  targetId: string,
): { target: Player; kind: 'trade' | 'sign'; need: number; space: number } | null {
  const cap = summarizeCap(world.roster[career.teamId] ?? [], world.deadMoney[career.teamId] ?? 0, world.season)
  const fa = world.freeAgents.find((p) => p.id === targetId)
  if (fa) {
    const hit = freeAgentContract(fa, world.season, world.week, world.phase).capHit
    return { target: fa, kind: 'sign', need: Math.max(0, hit - cap.space), space: cap.space }
  }
  const tp = world.players.find((p) => p.id === targetId)
  if (tp && tp.teamId && tp.teamId !== career.teamId) {
    return { target: tp, kind: 'trade', need: Math.max(0, tp.contract.capHit - cap.space), space: cap.space }
  }
  return null
}

/** The trade/FA targets the coach can ask the GM to clear space for: everyone he
 * is tracking on the shadow board, plus the best free agents. Reuses the cap
 * needs the decision itself checks, so the UI and the GM agree on the number.
 */
export function gmRestructureTargets(world: World, career: CareerState): GmRestructureTarget[] {
  const cap = summarizeCap(world.roster[career.teamId] ?? [], world.deadMoney[career.teamId] ?? 0, world.season)
  const out: GmRestructureTarget[] = []
  const seen = new Set<string>()
  const add = (p: Player, kind: 'trade' | 'sign') => {
    if (seen.has(p.id) || out.length >= 8) return
    // C6: a coordinator can only clear space for a target on his own side of the
    // ball; the restructure candidates themselves stay teamwide (see below).
    if (!gmAskCovers(career, p.pos)) return
    seen.add(p.id)
    const hit = kind === 'sign' ? freeAgentContract(p, world.season, world.week, world.phase).capHit : p.contract.capHit
    out.push({ id: p.id, name: p.name, pos: p.pos, kind, ovr: p.ovr, need: Math.max(0, hit - cap.space) })
  }
  for (const entry of career.shadowBoard ?? []) {
    const p = world.players.find((x) => x.id === entry.playerId)
    if (!p) continue
    if (p.teamId && p.teamId !== career.teamId) add(p, 'trade')
    else if (!p.teamId) add(p, 'sign')
  }
  const stars = world.teams
    .filter((t) => t.tier === 'NFL' && t.id !== career.teamId)
    .flatMap((t) => world.roster[t.id] ?? [])
    .filter((p) => unscaleOvr(p.ovr) >= 85)
    .sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id))
    .slice(0, 4)
  for (const p of stars) add(p, 'trade')
  for (const p of [...world.freeAgents].sort((a, b) => b.ovr - a.ovr).slice(0, 6)) add(p, 'sign')
  return out
}

/** The room the GM would have to clear for one named target, or null if it isn't a valid target. */
export function gmTargetNeed(world: World, career: CareerState, targetId: string): number | null {
  return capNeedForTarget(world, career, targetId)?.need ?? null
}

/** The named target's position (trade or free agent), for the side-of-the-ball gate. */
export function gmTargetPos(world: World, career: CareerState, targetId: string): Position | null {
  return capNeedForTarget(world, career, targetId)?.target.pos ?? null
}

/**
 * Restructure 1–3 big base salaries to clear cap for a NAMED target — but only
 * when the club is contending and the space is actually needed. C6 requires a
 * target: the GM won't borrow from next year without a specific move in mind.
 * For an automatic FA restructure the sign path passes the FA's id and the room
 * it needs as `needOverride`.
 */
export function gmRestructureDecision(
  world: World,
  career: CareerState,
  targetId?: string,
  needOverride?: number,
): GmRestructureDecision {
  const view = contendView(world, career.teamId)
  const roster = world.roster[career.teamId] ?? []

  // C6: no borrowing without a named target.
  if (!targetId) {
    return {
      kind: 'restructure',
      outcome: 'declined',
      reason: 'needsTarget',
      message: "Tell me who we're clearing space for — I don't push money into next year without a target.",
    }
  }
  const found = capNeedForTarget(world, career, targetId)
  if (!found) {
    return {
      kind: 'restructure',
      outcome: 'declined',
      reason: 'value',
      message: "I can't find that target on the market or on another roster.",
    }
  }
  // C6: a coordinator only clears space for a target on his own side of the ball.
  if (!gmAskCovers(career, found.target.pos)) {
    return {
      kind: 'restructure',
      outcome: 'declined',
      reason: 'side',
      message: `I only clear cap for a player on your side of the ball — ${found.target.name} is a ${found.target.pos}.`,
    }
  }
  const need = needOverride != null ? Math.max(0, needOverride) : found.need
  if (need <= 0) {
    return {
      kind: 'restructure',
      outcome: 'declined',
      reason: 'need',
      message: `We already have the room for ${found.target.name} — no restructuring needed.`,
    }
  }
  if (!view.contending) {
    return {
      kind: 'restructure',
      outcome: 'notNow',
      reason: 'contending',
      message: `We're ${view.rank}th in the league — not borrowing from next year to chase this season.`,
    }
  }
  const candidates = roster
    .filter((p) => p.contract.years >= 2 && (p.contract.base[0] ?? 0) > 2_000_000)
    .sort((a, b) => (b.contract.base[0] ?? 0) - (a.contract.base[0] ?? 0) || a.id.localeCompare(b.id))
  if (!candidates.length) {
    return { kind: 'restructure', outcome: 'declined', reason: 'noGain', message: 'No base salary left to convert — nothing to restructure.' }
  }
  // Convert the biggest deals first until the target's need is covered (max 3).
  const plan: GmRequestPlan = { restructureIds: [], restructured: 0, capFreed: 0 }
  for (const p of candidates) {
    if (plan.restructureIds.length >= 3) break
    const next = restructure(p.contract)
    const freed = p.contract.capHit - next.capHit
    if (freed <= 0) continue
    plan.restructureIds.push(p.id)
    plan.capFreed += freed
    plan.restructured += Math.round((p.contract.base[0] ?? 0) * 0.85)
    if (plan.capFreed >= need) break
  }
  if (!plan.restructureIds.length) {
    return { kind: 'restructure', outcome: 'declined', reason: 'noGain', message: 'Those deals are already all bonus — there is no room to convert.' }
  }
  if (plan.capFreed < need) {
    return {
      kind: 'restructure',
      outcome: 'notNow',
      reason: 'cap',
      message: `Even maxing out the restructures I can't clear ${money(need)} for ${found.target.name} — we're $${((need - plan.capFreed) / 1e6).toFixed(1)}M short.`,
    }
  }
  const trust = gmTrust(world, career)
  if (trust < 38) {
    return { kind: 'restructure', outcome: 'notNow', reason: 'trust', message: `I'm not pushing money into next year on your say-so right now (standing ${trust}).` }
  }
  return {
    kind: 'restructure',
    outcome: 'done',
    reason: 'agreed',
    plan,
    playerName: found.target.name,
    capFreed: plan.capFreed,
    deadRisk: plan.restructured,
    message: `Restructured ${plan.restructureIds.length} deal${plan.restructureIds.length === 1 ? '' : 's'} for ${found.target.name}: ${money(plan.capFreed)} freed this year, ${money(plan.restructured)} pushed into later years.`,
  }
}

/** Go get this player. The GM searches packages, protects the coach's core, and executes the best one that fits. */
export function gmTradeDecision(world: World, career: CareerState, playerId: string): GmRequestResult {
  const target = world.players.find((p) => p.id === playerId)
  if (!target || !target.teamId || target.teamId === career.teamId) {
    return { kind: 'trade', outcome: 'declined', reason: 'value', message: 'He is not on another roster — there is nobody to trade for.' }
  }
  const mandate = mandateOf(career)
  if (mandate.rebuild && target.age >= 29) {
    return { kind: 'trade', outcome: 'declined', reason: 'mandate', message: `The owner wants us building through the draft — not paying up for a ${target.age}-year-old.` }
  }
  const offers = findPackagesFor(world, career.teamId, playerId)
  if (!offers.length) {
    return { kind: 'trade', outcome: 'declined', reason: 'price', message: `No package we can put together lands ${target.name} right now.` }
  }
  const protectedIds = protectedPlayers(world, career)
  const cap = summarizeCap(world.roster[career.teamId] ?? [], world.deadMoney[career.teamId] ?? 0, world.season)
  let blockedByProtection = false
  let blockedByCap = false
  for (const offer of offers) {
    if (offer.give.some((a) => a.kind === 'player' && protectedIds.has(a.id))) {
      blockedByProtection = true
      continue
    }
    const capIn = offer.get.reduce((s, a) => s + (a.kind === 'player' ? capOf(world, a.id) : 0), 0)
    const capOut = offer.give.reduce((s, a) => s + (a.kind === 'player' ? capOf(world, a.id) : 0), 0)
    if (cap.space + capOut - capIn < 0) {
      blockedByCap = true
      continue
    }
    const trust = gmTrust(world, career)
    if (trust < 34) {
      return { kind: 'trade', outcome: 'notNow', reason: 'trust', message: `I'm not sending real assets out on this one — my read on the room says wait (standing ${trust}).` }
    }
    return {
      kind: 'trade',
      outcome: 'done',
      reason: 'agreed',
      offer,
      playerId: target.id,
      playerName: target.name,
      message: `Deal agreed for ${target.name} (${target.pos}, ${target.ovr}).`,
    }
  }
  if (blockedByCap) {
    return { kind: 'trade', outcome: 'notNow', reason: 'cap', message: `We can afford the players, but not the cap hit — it doesn't fit this year.` }
  }
  if (blockedByProtection) {
    return { kind: 'trade', outcome: 'declined', reason: 'untouchable', message: `Every package that lands ${target.name} includes a player I won't move.` }
  }
  return { kind: 'trade', outcome: 'declined', reason: 'price', message: `The price for ${target.name} is too rich for us right now.` }
}

/** Sign this free agent. Bids market; restructures first only if the coach green-lit it this season. */
export function gmSignDecision(world: World, career: CareerState, playerId: string, discountPct = 0): GmRequestResult {
  const p = world.freeAgents.find((x) => x.id === playerId)
  if (!p) {
    return { kind: 'sign', outcome: 'declined', reason: 'value', message: 'He is no longer on the market.' }
  }
  const mandate = mandateOf(career)
  if (mandate.rebuild && p.age >= 30) {
    return { kind: 'sign', outcome: 'declined', reason: 'mandate', message: `The owner wants young legs — not a ${p.age}-year-old on a one-year deal.` }
  }
  const roster = world.roster[career.teamId] ?? []
  if (roster.length >= 53) {
    return {
      kind: 'sign',
      outcome: 'declined',
      reason: 'roster',
      message: `We're at 53 — I'd have to cut someone before I can add ${p.name}.`,
    }
  }
  const contract = freeAgentContract(p, world.season, world.week, world.phase, undefined, 1, discountPct)
  const reserve = Math.max(3_000_000, Math.round(0.02 * 279_200_000))
  let cap = summarizeCap(roster, world.deadMoney[career.teamId] ?? 0, world.season)
  let plan: GmRequestPlan | undefined
  if (cap.space - contract.capHit < reserve) {
    // Only restructure if the coach already approved a push this season.
    if (career.gmRestructureSeason !== world.season) {
      return {
        kind: 'sign',
        outcome: 'notNow',
        reason: 'cap',
        message: `He wants ${money(contract.capHit)} and we'd be under our reserve — green-light a restructure and I'll make it work.`,
      }
    }
    // The FA itself is the named target; clear enough room for the deal + reserve.
    const need = Math.max(0, contract.capHit + reserve - cap.space)
    const decision = gmRestructureDecision(world, career, p.id, need)
    if (decision.outcome !== 'done' || !decision.plan) {
      return { kind: 'sign', outcome: 'notNow', reason: 'cap', message: `Even restructuring, we can't clear the room for ${p.name}.` }
    }
    plan = decision.plan
    cap = { ...cap, space: cap.space + plan.capFreed }
  }
  // The reserve stands after any restructure too.
  if (cap.space - contract.capHit < reserve) {
    return { kind: 'sign', outcome: 'notNow', reason: 'cap', message: `It still leaves us under our reserve for ${p.name}.` }
  }
  const trust = gmTrust(world, career)
  const need = mandate.rebuild ? 46 : mandate.winNow ? 38 : 42
  if (trust < need) {
    return { kind: 'sign', outcome: 'notNow', reason: 'trust', message: `Not on your word alone right now (standing ${trust}).` }
  }
  return {
    kind: 'sign',
    outcome: 'done',
    reason: 'agreed',
    playerId: p.id,
    playerName: p.name,
    capAdded: contract.capHit,
    plan,
    capFreed: plan?.capFreed,
    deadRisk: plan?.restructured,
    message: `Signed ${p.name} at market — ${money(contract.capHit)} cap hit.`,
  }
}

/** Release this player. Agree when dead money ≤ cap saved and he isn't a protected starter. */
export function gmReleaseDecision(world: World, career: CareerState, playerId: string): GmRequestResult {
  const roster = world.roster[career.teamId] ?? []
  const p = roster.find((x) => x.id === playerId)
  if (!p) {
    return { kind: 'release', outcome: 'declined', reason: 'value', message: 'He is not on our roster.' }
  }
  const dead = deadMoney(p.contract)
  const save = capSavings(p.contract)
  // The release rule: only when the dead money charged is no more than the net
  // cap saved (cap hit − dead). A merely positive saving isn't enough.
  if (save <= 0 || dead > save) {
    return {
      kind: 'release',
      outcome: 'declined',
      reason: 'savings',
      message: `Cutting ${p.name} frees ${money(Math.max(0, save))} against ${money(dead)} dead — we only cut when dead money is no more than the net cap saved.`,
    }
  }
  // Starter status from the healthy, depth-ordered chart — not OVR alone.
  const atPos = depthAt(world, career.teamId, p.pos)
  const idx = atPos.findIndex((x) => x.id === p.id)
  const starter = idx >= 0 && idx < (STARTERS[p.pos] ?? 1)
  const poor = poorProduction(world, p)
  if (starter && !poor) {
    return {
      kind: 'release',
      outcome: 'declined',
      reason: 'starter',
      message: `${p.name} is our starting ${p.pos} (No. ${idx + 1} on the depth chart) — I'm not gutting the lineup mid-season.`,
    }
  }
  const mandate = mandateOf(career)
  if (mandate.winNow && p.age >= 28 && unscaleOvr(p.ovr) >= 80 && !poor) {
    return { kind: 'release', outcome: 'declined', reason: 'mandate', message: `The owner is in win-now mode — no cutting productive veterans.` }
  }
  const trust = gmTrust(world, career)
  if (trust < 38 && !poor) {
    return { kind: 'release', outcome: 'notNow', reason: 'trust', message: `I need to see more from the room before I cut a contributor (standing ${trust}).` }
  }
  return {
    kind: 'release',
    outcome: 'done',
    reason: 'agreed',
    playerId: p.id,
    playerName: p.name,
    capSaved: save,
    dead,
    message: `Agreed — releasing ${p.name} saves ${money(save)} against ${money(dead)} dead.`,
  }
}

export interface GmDeskView {
  canRequest: boolean
  trust: number
  contenders: ContendView
  requestsThisMonth: number
  maxRequests: number
}

/** State the desk card and probes share. */
export function gmDeskView(world: World, career: CareerState, monthKey: number): GmDeskView {
  const canRequest = canAskGm(career)
  const thisMonth = (career.gmRequests ?? []).filter((r) => monthKeyOf(r.season, r.week) === monthKey).length
  return {
    canRequest,
    trust: gmTrust(world, career),
    contenders: contendView(world, career.teamId),
    requestsThisMonth: thisMonth,
    maxRequests: 3,
  }
}

/** A stable per-4-week bucket, so "1 per player per month" is deterministic. */
export function monthKeyOf(season: number, week: number): number {
  return season * 20 + Math.floor((Math.max(0, week) - 1) / 4)
}

/** Human label for a request kind (desk card + ledger). */
export const GM_REQUEST_LABEL: Record<GmRequestKind, string> = {
  extend: 'Extend player',
  restructure: 'Restructure to clear cap',
  trade: 'Go get this player',
  sign: 'Sign this free agent',
  release: 'Release this player',
}

/** Re-export the C4 decision so the desk has one entry point per request kind. */
export type { GmAskResult }
export { gmExtendDecision, gmOffer, gmAskCovers }
export { remainingContractValue, evaluateTrade }

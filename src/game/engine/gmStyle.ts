// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #49 — AI GM personalities.
//
// gmpersona (merged) gave every AI club a named General Manager and a
// temperament: his own drafting eye, trade instincts, cap management, patience
// with the coach and trade aggression, all derived from HIS id + rating
// (`generate.ts` `gmTemperament`). gmAsk.ts already reads those five numbers to
// answer your extension asks, and the draft room already leans on the GM's
// drafting/trading axes for its stance.
//
// futgmstyle: the rest of the football operation is his too. A GM's own
// temperament collapses into ONE archetype — Analytics, Old school, Trade happy,
// Cap reckless, Draft & develop — and that archetype sets the numbers this club
// uses to run the league:
//
//   · how often it works the phones and whether it pays draft picks   (progress.ts runAITrades)
//   · what its draft board is worth: need vs best-player, premium
//     positions, character risk, measurables when a class carries them (draft.ts bestAvailableFor)
//   · free-agent appetite, the price it will pay and the SHAPE of the deal
//     it hands out (front-loaded years, void years)                   (progress.ts runAIFreeAgency)
//   · how much room it insists on keeping under the cap, and therefore
//     how big a core it re-signs and how hard it trims                (progress.ts runAIResign, enforceCapCompliance)
//   · whether it keeps its own free agents with a tag                 (contractLife.ts runAITags)
//   · how it bids in the March window                                 (faFrenzy.ts aiBidDay)
//
// Every number is the individual man's: the archetype table is only a base, and
// each multiplier is then scaled by his OWN axes and a hash of his OWN id, so
// two trade-happy GMs are not the same trader. No league or unit average is ever
// read. `gmStyle(null)` (a seat the user holds) is deliberately league-ordinary.
//
// Deterministic: pure hash + the GM's own staff record. Nothing here draws from
// any rng stream, so the calibrated play sim cannot move.
// ─────────────────────────────────────────────────────────────────────────────

import type { Contract, DraftProspect, Player, StaffMember } from '../types'
import { gmTemperament, type World } from './generate'
import { dealFromAav, recomputeCapHit } from './cap'
import { hash32, clamp } from './rng'

export type GmArchetype = 'analytics' | 'oldschool' | 'tradehappy' | 'capreckless' | 'draftdev'

/** Every archetype, in display order. */
export const GM_ARCHETYPES: readonly GmArchetype[] = ['analytics', 'tradehappy', 'capreckless', 'oldschool', 'draftdev']

export interface GmStyle {
  archetype: GmArchetype
  /** Short uppercase tag for a chip on the Staff / League / Trades screens. */
  tag: string
  /** One line of plain English: what he does to the club. */
  line: string
  /**
   * Trade appetite. 1.0 is league-ordinary; his club is weighted by this when
   * the league picks who talks, and it caps how many deals he will do.
   */
  tradeFreq: number
  /**
   * Draft-pick stance, signed: POSITIVE = hoards picks (wants more, won't send
   * them), NEGATIVE = pays picks to get players now.
   */
  pickNet: number
  /**
   * Board stance, signed: POSITIVE = best player available, NEGATIVE = fills
   * need. The draft board's need bonus is scaled by this.
   */
  needVsBpa: number
  /** Premium put on the premium positions (QB / OT / DE / CB). 0 = none. */
  posValue: number
  /** Character risk: POSITIVE = passes on red flags, NEGATIVE = will live with them. */
  character: number
  /** Measurables: how much a workout number (or, without one, raw upside) moves him. */
  measurables: number
  /** Free-agent appetite: the multiplier he applies to a market ask. */
  faSpend: number
  /** Cap discipline: how much room he insists on keeping (1.0 = league-ordinary). */
  capStrict: number
  /** Contract shape: how much of the money he front-loads into year 1 (0–1.25). */
  frontLoad: number
  /** Willingness to run void years to push bonus money off this year (0–0.85). */
  voidYears: number
  /** Patience with his coach (his own 35–95 axis; 62 = league-ordinary). */
  coachPatience: number
}

/** A seat the user holds: league-ordinary on every axis. */
const NEUTRAL: GmStyle = {
  archetype: 'oldschool',
  tag: 'League standard',
  line: 'Runs the club by the book — market prices, the board, no reach.',
  tradeFreq: 1,
  pickNet: 0,
  needVsBpa: 0,
  posValue: 0.1,
  character: 0.15,
  measurables: 0.1,
  faSpend: 1,
  capStrict: 1,
  frontLoad: 0.8,
  voidYears: 0.1,
  coachPatience: 62,
}

interface ArchetypeBase {
  tag: string
  line: string
  tradeFreq: number
  pickNet: number
  needVsBpa: number
  posValue: number
  character: number
  measurables: number
  faSpend: number
  capStrict: number
  frontLoad: number
  voidYears: number
}

/**
 * The base numbers for each archetype. These are the "elite vs poor" ends the
 * league is spread across; each is then individualised per GM below.
 */
const BASE: Record<GmArchetype, ArchetypeBase> = {
  analytics: {
    tag: 'Analytics',
    line: 'Analytics-first — hoards picks, drafts on the numbers, spends only at value.',
    tradeFreq: 1.0,
    pickNet: 0.55,
    needVsBpa: 0.4,
    posValue: 0.25,
    character: 0.15,
    measurables: 0.4,
    faSpend: 0.9,
    capStrict: 1.15,
    frontLoad: 0.45,
    voidYears: 0.25,
  },
  oldschool: {
    tag: 'Old school',
    line: 'Old school — drafts for need and character, rarely trades, sticks with his coach.',
    tradeFreq: 0.3,
    pickNet: -0.1,
    needVsBpa: -0.5,
    posValue: 0,
    character: 0.5,
    measurables: 0.05,
    faSpend: 0.95,
    capStrict: 1.0,
    frontLoad: 1.15,
    voidYears: 0.1,
  },
  tradehappy: {
    tag: 'Trade happy',
    line: 'Trade happy — always on the phone, will send picks for a player who fits.',
    tradeFreq: 2.3,
    pickNet: -0.9,
    needVsBpa: -0.15,
    posValue: 0.1,
    character: 0,
    measurables: 0.15,
    faSpend: 1.15,
    capStrict: 0.85,
    frontLoad: 0.75,
    voidYears: 0.35,
  },
  capreckless: {
    tag: 'Cap reckless',
    line: 'Cap reckless — pays over the market, front-loads and voids to fit the bill.',
    tradeFreq: 1.2,
    pickNet: -0.45,
    needVsBpa: 0.05,
    posValue: 0.2,
    character: -0.1,
    measurables: 0.25,
    faSpend: 1.45,
    capStrict: 0.5,
    frontLoad: 0.35,
    voidYears: 0.85,
  },
  draftdev: {
    tag: 'Draft & develop',
    line: 'Draft & develop — builds from the draft, hoards picks, stays cheap in March.',
    tradeFreq: 0.45,
    pickNet: 0.85,
    needVsBpa: 0.2,
    posValue: -0.05,
    character: 0.3,
    measurables: 0.25,
    faSpend: 0.55,
    capStrict: 1.2,
    frontLoad: 1.0,
    voidYears: 0.05,
  },
}

/**
 * His archetype, scored from his own five temperament axes plus his front-office
 * focus and specialty. Argmax with a hash of his own id as the tie-break, so the
 * league spreads across all five rather than piling on one.
 */
export function gmArchetype(m: StaffMember | null | undefined): GmArchetype {
  if (!m) return 'oldschool'
  const t = gmTemperament(m)
  const d = t.drafting / 100
  const tr = t.trading / 100
  const c = t.cap / 100
  const pa = t.patience / 100
  const ag = t.aggression / 100
  // Middle of the league is 62 on every axis, so the terms are centred on 0.62.
  const focus = m.focus ?? ''
  const spec = m.specialty ?? ''
  // A small per-archetype offset, because the five axes sit slightly below their
  // nominal middle (the shared `gmAxis` curve averages ~60, not 62) — without it
  // the "old school" lane would swallow a third of the league. It is the same
  // number for every GM, never a league average of live people.
  const offset: Record<GmArchetype, number> = { analytics: -3, oldschool: -6, tradehappy: 3, capreckless: 4, draftdev: 2 }
  const score: Record<GmArchetype, number> = {
    // Reads the numbers: a sharp drafter who also guards the cap, or a
    // numbers-heavy specialty.
    analytics: (d - 0.62) * 40 + (c - 0.62) * 30 + (spec === 'Analytics' ? 24 : 0) + (focus === 'Cap' ? 6 : 0) + offset.analytics,
    // Reads the tape: doesn't work the phones, doesn't love the workout warriors.
    oldschool: (0.62 - tr) * 34 + (0.62 - d) * 20 + (pa - 0.62) * 24 + (spec === 'Character reads' || spec === 'Talent ID' ? 14 : 0) + offset.oldschool,
    // Lives on the phone.
    tradehappy: (tr - 0.62) * 34 + (ag - 0.62) * 40 + (focus === 'Negotiation' ? 12 : 0) + (spec === 'Negotiation' ? 10 : 0) + offset.tradehappy,
    // Spends like there is no tomorrow.
    capreckless: (0.62 - c) * 52 + (ag - 0.62) * 18 - (d - 0.62) * 8 + offset.capreckless,
    // Builds it himself.
    draftdev: (pa - 0.62) * 26 + (d - 0.62) * 16 + (0.62 - ag) * 10 + (focus === 'Pro scouting' ? 12 : 0) + offset.draftdev,
  }
  let best: GmArchetype = 'oldschool'
  let bestScore = -1e9
  // The hash order breaks every tie deterministically without a league average.
  const order = [...GM_ARCHETYPES].sort((a, b) => hash32(`gmo|${m.id}|${a}`, 307) - hash32(`gmo|${m.id}|${b}`, 307))
  for (const a of order) {
    if (score[a] > bestScore) {
      bestScore = score[a]
      best = a
    }
  }
  return best
}

/** His own axes as 0–1, from the shared temperament. */
function axes(m: StaffMember) {
  const t = gmTemperament(m)
  return {
    d: t.drafting / 100,
    tr: t.trading / 100,
    c: t.cap / 100,
    pa: t.patience / 100,
    ag: t.aggression / 100,
    t,
  }
}

/**
 * One club's GM style: the archetype base, scaled by his own axes (a 35-axis man
 * and a 95-axis man of the same archetype are different people) and a hash of
 * his own id, kept inside ±8% so no one leaves his lane. No averages involved.
 */
export function gmStyle(m: StaffMember | null | undefined): GmStyle {
  if (!m) return NEUTRAL
  const a = axes(m)
  const { d, tr, c, pa, ag } = a
  const base = BASE[gmArchetype(m)]
  // Individual jitter: his own id, his own ±8% on every number.
  const jit = (salt: number) => 0.92 + (hash32(`gms|${m.id}|${salt}`, 211) % 17) / 100
  const tradeFreq = base.tradeFreq * jit(1) * (0.85 + 0.3 * ag) * (0.9 + 0.2 * tr)
  const faSpend = base.faSpend * jit(2) * (0.92 + (1 - c) * 0.16)
  const capStrict = base.capStrict * jit(3) * (0.85 + 0.3 * c)
  return {
    archetype: gmArchetype(m),
    tag: base.tag,
    line: base.line,
    tradeFreq: round2(tradeFreq),
    pickNet: round2(base.pickNet * jit(4) * (0.8 + 0.4 * d)),
    needVsBpa: round2(base.needVsBpa * jit(5) * (0.8 + 0.4 * d)),
    posValue: round2(base.posValue * jit(6)),
    character: round2(base.character * jit(7) * (0.8 + 0.4 * pa)),
    measurables: round2(base.measurables * jit(8) * (0.8 + 0.4 * tr)),
    faSpend: round2(faSpend),
    capStrict: round2(capStrict),
    frontLoad: round2(base.frontLoad * jit(9) * (0.85 + 0.3 * ag)),
    voidYears: round2(base.voidYears * jit(10) * (0.85 + 0.3 * ag)),
    coachPatience: a.t.patience,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** How willing he is to SEND draft picks (0 = never, 1 = a real currency). */
export function gmPaysPicks(s: GmStyle): number {
  return clamp(-s.pickNet, 0, 1)
}

/** How much he hoards picks (0 = never, 1 = a real hoarder). */
export function gmHoardsPicks(s: GmStyle): number {
  return clamp(s.pickNet, 0, 1)
}

/** The one-line tendency in the UI's own words, with the numbers behind it. */
export function gmStyleWords(s: GmStyle): { tag: string; line: string } {
  return { tag: s.tag, line: s.line }
}

// ── Draft board ──────────────────────────────────────────────────────────────

/**
 * A prospect's workout profile, −1 (poor) … +1 (elite). FUTURES #47 (combine &
 * pro-day measurables) is not merged yet, so a class normally carries none: the
 * reader returns 0 and the board falls back to the man's upside (`pot` over his
 * public grade) at half weight. When a save does carry numbers they are read
 * straight off the prospect.
 */
export function measurableScore(p: DraftProspect): number {
  const m = p as unknown as { forty?: number; vertical?: number; shuttle?: number; broad?: number; weight?: number }
  const parts: number[] = []
  // 4.3 s is elite, 5.1 s is slow for a skill player.
  if (typeof m.forty === 'number') parts.push(clamp((4.75 - m.forty) / 0.45, -1, 1))
  // 42" is elite, 28" is poor.
  if (typeof m.vertical === 'number') parts.push(clamp((m.vertical - 35) / 7, -1, 1))
  if (typeof m.shuttle === 'number') parts.push(clamp((4.35 - m.shuttle) / 0.35, -1, 1))
  if (typeof m.broad === 'number') parts.push(clamp((m.broad - 115) / 15, -1, 1))
  if (!parts.length) return 0
  return clamp(parts.reduce((s, x) => s + x, 0) / parts.length, -1, 1)
}

/**
 * The draft board a GM puts his name on: how far above (or below) the club's own
 * scouting grade a prospect sits for HIM. Applied on top of the shared board
 * score in `draft.ts bestAvailableFor`, so the scouts still stack the board and
 * he has the last word on the tie-breaks he cares about.
 *
 * Returns a closure over the club's own need table. Clamped to ±7 grade points —
 * a real philosophy, not a crapshoot.
 */
export function gmBoardTilt(style: GmStyle, needs: Record<string, number>): (p: DraftProspect) => number {
  return (p) => {
    const isNeed = (needs[p.pos] ?? 0) > 0
    // Needs-first men get a real bump for a hole, and a small penalty for a
    // luxury pick; BPA men the reverse.
    const needAdj = -style.needVsBpa * (isNeed ? 1 : -0.3) * 3.5
    const premium = p.pos === 'QB' ? 3 : p.pos === 'DE' || p.pos === 'OT' || p.pos === 'CB' ? 1 : 0
    const posAdj = style.posValue * premium * 1.5
    // Character: a risk-averse man reads a low work ethic or off-field flag as
    // a discount; a risk-tolerant one shrugs it off.
    const ch = p.character
    const risk = ch ? (ch.offFieldRisk - (ch.workEthic + ch.coachability) / 2) / 100 : 0
    const charAdj = -style.character * risk * 4
    // Measurables when the class carries them; otherwise raw upside as the
    // traits proxy at half weight (POS_NOTES: "raw but rare athletic traits").
    const meas = measurableScore(p)
    const traits = meas !== 0 ? meas : clamp((p.pot - p.grade) / 8, -1, 1) * 0.5
    const measAdj = style.measurables * traits * 3
    return clamp(needAdj + posAdj + charAdj + measAdj, -7, 7)
  }
}

// ── Contracts ────────────────────────────────────────────────────────────────

/**
 * A deal in HIS shape. Starts from the shared `dealFromAav` curve (so the cap
 * model and the dead-money rules see a real contract), then:
 *   · front-loads: moves a share of every later year's base into year 1, so the
 *     club eats the money early — the contract a GM who does not want to be
 *     paying for this player in three years writes;
 *   · void years: spreads the signing bonus over dummy years, cutting this
 *     season's hit at the cost of dead money later.
 * Total value is unchanged by front-loading; the cap SHAPE is not.
 */
export function styledDeal(
  p: Player,
  season: number,
  aav: number,
  length: number,
  guaranteePct: number,
  style: GmStyle,
): Contract {
  const base = dealFromAav(p, season, aav, length, guaranteePct)
  let c: Contract = base
  const front = clamp(style.frontLoad, 0, 1.25)
  if (front > 0 && c.base.length > 1) {
    const b = [...c.base]
    const later = b.slice(1).reduce((s, x) => s + x, 0)
    const take = Math.round(later * Math.min(0.5, front * 0.3))
    if (take > 0 && later > 0) {
      let moved = 0
      for (let i = 1; i < b.length; i++) {
        const cut = Math.min(b[i], Math.round((take * b[i]) / later))
        b[i] -= cut
        moved += cut
      }
      b[0] += moved
      c = { ...c, base: b }
    }
  }
  const voidYears = Math.round(clamp(style.voidYears, 0, 0.85) * 2)
  if (voidYears > 0) {
    c = { ...c, voidYears, proration: Math.round(c.signingBonus / (c.years + voidYears)) }
  }
  return recomputeCapHit(c)
}

/** Shorthand: the club's GM style by team id (league-ordinary when the seat is the user's). */
export function gmStyleOfTeam(world: World, teamId: string): GmStyle {
  const m = (world.staff[teamId] ?? []).find((x) => x.role === 'General Manager')
  return gmStyle(m)
}

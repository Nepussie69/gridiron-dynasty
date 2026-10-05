// ─────────────────────────────────────────────────────────────────────────────
// The Ledger.
//
// Every call you make — a grade, a recommendation, a draft pick, advice to a
// director — is date-stamped. Years later it comes back: "You graded him a
// 2nd-rounder as an Area Scout in 2027; he's a 3x Pro Bowler now."
//
// The career hit rate is your batting average, and "My Guys" follows everyone
// you championed. This is what makes the one-living-universe hook felt.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, LedgerEntry, Player, Recommendation } from '../types'
import type { World } from './generate'
import { tierFor } from './career'

/** How many seasons a drafted player needs before we grade the pick. */
const PICK_EVAL_SEASONS = 2
const PICK_HIT_OVR = 78

const BAND: Record<Recommendation, [number, number]> = {
  'Blue Chip': [86, 99],
  Starter: [76, 88],
  Depth: [66, 79],
  Pass: [0, 72],
}

let LEDGER_SEQ = 0

/** Append a dated entry to the career ledger (mutates the career object). */
export function pushLedger(career: CareerState, entry: Omit<LedgerEntry, 'id' | 'season' | 'week'>): LedgerEntry {
  const full: LedgerEntry = {
    id: `led_${career.season}_${career.week}_${LEDGER_SEQ++}`,
    season: career.season,
    week: career.week,
    role: tierFor(career.path, career.level).title,
    ...entry,
  }
  if (!career.ledger) career.ledger = []
  career.ledger.unshift(full)
  if (career.ledger.length > 400) career.ledger.length = 400
  return full
}

/** Your batting average across every graded call. */
export function ledgerHitRate(career: CareerState): { calls: number; hits: number; pct: number } {
  const graded = (career.ledger ?? []).filter((e) => e.hit !== undefined)
  const hits = graded.filter((e) => e.hit).length
  return { calls: graded.length, hits, pct: graded.length ? Math.round((hits / graded.length) * 100) : 0 }
}

/** Grade one entry if enough time has passed. Returns true/false, or undefined if not ready. */
function gradeEntry(world: World, e: LedgerEntry): boolean | undefined {
  if (e.kind === 'recommendation' || e.kind === 'grade') {
    if (e.truth == null) return undefined
    if (e.recommendation) {
      const [lo, hi] = BAND[e.recommendation]
      return e.truth >= lo && e.truth <= hi
    }
    if (e.myGrade != null) return Math.abs(e.myGrade - e.truth) <= 8
    return undefined
  }
  if (e.kind === 'pick' || e.kind === 'advice') {
    const p = e.playerId ? world.players.find((x) => x.id === e.playerId) : undefined
    if (!p) return undefined
    const proSeasons = (p.stats ?? []).filter((s) => s.level === 'NFL').length
    if (proSeasons < PICK_EVAL_SEASONS) return undefined
    return p.ovr >= PICK_HIT_OVR
  }
  return undefined
}

/**
 * Re-grade the ledger (called at season end). Marks hits/misses and writes a
 * human outcome, so old calls mature over a career.
 */
export function gradeLedger(world: World, career: CareerState): { graded: number; hits: number; newly: LedgerEntry[] } {
  if (!career.ledger) return { graded: 0, hits: 0, newly: [] }
  let newlyGraded = 0
  let hits = 0
  const newly: LedgerEntry[] = []
  for (const e of career.ledger) {
    if (e.kind === 'develop') continue
    if (e.hit !== undefined && e.kind !== 'pick' && e.kind !== 'advice') continue
    const p = e.playerId ? world.players.find((x) => x.id === e.playerId) : undefined
    const result = gradeEntry(world, e)
    // For picks, refresh the outcome text as the player develops.
    if (p) {
      const tag = e.kind === 'pick' ? `Pick ${e.round ? `Rd ${e.round}` : ''}`.trim() : 'Your call'
      if (result === true) e.outcome = `${tag}: ${p.name} is a ${p.ovr} OVR${p.ovr >= 88 ? ' star' : ' contributor'} — that one landed.`
      else if (result === false) e.outcome = `${tag}: ${p.name} stalled at ${p.ovr} OVR.`
    }
    if (result !== undefined && e.hit === undefined) {
      e.hit = result
      newlyGraded++
      newly.push(e)
    }
    if (e.hit) hits++
  }
  return { graded: newlyGraded, hits, newly }
}

export interface MyGuy {
  entry: LedgerEntry
  player?: Player
  ovr?: number
}

/** Everyone you championed (picks and strong recommendations), with current status. */
export function myGuys(world: World, career: CareerState): MyGuy[] {
  const entries = (career.ledger ?? []).filter(
    (e) => e.kind === 'pick' || (e.kind === 'recommendation' && (e.recommendation === 'Blue Chip' || e.recommendation === 'Starter')),
  )
  return entries.map((entry) => {
    const player = entry.playerId ? world.players.find((x) => x.id === entry.playerId) : undefined
    return { entry, player, ovr: player?.ovr }
  })
}

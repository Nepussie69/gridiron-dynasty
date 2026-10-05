// ─────────────────────────────────────────────────────────────────────────────
// Pound the table (G2).
//
// On the Scouting class board a personnel rung with rankBoard or setBoard can
// tag up to three prospects as Conviction calls for the current draft. In advise
// mode the Director weighs them when your club is on the clock. Every tagged
// prospect is logged the moment he is drafted — by your club or anyone else —
// and graded two NFL seasons later. If your club passed and you were right, it
// counts as a vindication.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, DraftProspect, LedgerEntry } from '../types'
import type { Reputation } from './career'
import type { World } from './generate'
import { capabilities } from './capabilities'
import { pushLedger } from './ledger'
import { adviceWeight } from './draft'
import { clamp } from './rng'

export const MAX_CONVICTION = 3

/** Can this rung pound the table? Personnel only, with a board of their own. */
export function canConvict(career: CareerState): boolean {
  if (career.path !== 'personnel') return false
  const caps = capabilities(career).can
  return caps.has('rankBoard') || caps.has('setBoard')
}

/** The conviction ids, but only for the draft class they were tagged in. */
export function convictionIds(world: World, career: CareerState): string[] {
  if (career.conviction?.season !== world.season) return []
  return career.conviction.ids
}

/**
 * If the Director follows your conviction, return the highest-graded tagged
 * prospect whose board grade is within 10 of the best available pick. The
 * chance is adviceWeight + 0.2 (capped 0.95); `roll` is the seeded draw.
 */
export function convictionPick(
  world: World,
  career: CareerState,
  best: DraftProspect,
  gradeOf: (p: DraftProspect) => number,
  roll: number,
): DraftProspect | null {
  const ids = convictionIds(world, career)
  if (!ids.length) return null
  const bestScore = gradeOf(best)
  const candidates = world.draft
    .filter((p) => !p.draftedBy && ids.includes(p.id))
    .map((p) => ({ p, score: gradeOf(p) }))
    .filter((x) => bestScore - x.score <= 10)
    .sort((a, b) => b.score - a.score)
  if (!candidates.length) return null
  const chance = clamp(adviceWeight(career) + 0.2, 0, 0.95)
  if (roll >= chance) return null
  return candidates[0].p
}

/**
 * Log a ledger entry for every conviction prospect who has been drafted and is
 * not already logged. Call after any sequence of picks. Returns how many landed.
 */
export function logConvictionPicks(world: World, career: CareerState): number {
  const ids = convictionIds(world, career)
  if (!ids.length) return 0
  let logged = 0
  for (const p of world.draft) {
    if (!p.draftedBy || !ids.includes(p.id)) continue
    const already = (career.ledger ?? []).some((e) => e.conviction && e.prospectId === p.id)
    if (already) continue
    const accepted = p.draftedBy === career.teamId
    pushLedger(career, {
      kind: 'advice',
      prospectId: p.id,
      playerId: `pl_${p.id}`,
      name: p.name,
      pos: p.pos,
      college: p.college,
      myGrade: p.myGrade ?? p.grade,
      pick: p.draftPick ?? undefined,
      truth: p.trueGrade,
      accepted,
      conviction: true,
      note: accepted
        ? `Conviction: you pounded the table and the club took ${p.name}.`
        : `Conviction: you pounded the table for ${p.name}; the club went another way.`,
    })
    logged++
  }
  return logged
}

/**
 * Reputation and recap lines for conviction calls graded this season. On a
 * vindication (your club passed, he still hit) the entry is flagged and its
 * outcome rewritten. Pure-ish: mutates the entries passed in.
 */
export function convictionPayout(
  newly: LedgerEntry[],
  world?: World,
): { rep: Partial<Reputation>; lines: string[] } {
  const rep: Partial<Reputation> = {}
  const lines: string[] = []
  const add = (k: keyof Reputation, v: number) => {
    rep[k] = (rep[k] ?? 0) + v
  }
  for (const e of newly) {
    if (!e.conviction) continue
    const p = world && e.playerId ? world.players.find((x) => x.id === e.playerId) : undefined
    if (e.hit) {
      if (e.accepted === false) {
        e.vindication = true
        add('evaluation', 2)
        add('profile', 3)
        const abbr = world && p?.teamId ? world.byId[p.teamId]?.abbr ?? '—' : '—'
        e.outcome = `Called it — ${e.name} became a ${p?.ovr ?? e.truth ?? '—'} OVR player in ${abbr}. Your club passed.`
        lines.push(e.outcome)
      } else {
        add('evaluation', 2)
        add('profile', 1)
        lines.push(`Your conviction paid off: ${e.name} is a ${p?.ovr ?? '—'} OVR player.`)
      }
    } else {
      add('profile', -1)
    }
  }
  return { rep, lines }
}

// ─────────────────────────────────────────────────────────────────────────────
// Red flag (K4).
//
// On the Scouting class board a personnel rung with rankBoard or setBoard can
// take up to two prospects off their club's board for the current draft. Your
// club's simulated picks skip them. When another club drafts one, it is logged
// as an advice entry and graded two NFL seasons later: a red flag is a bet the
// prospect busts, so a low OVR is the hit. It is the mirror image of Conviction,
// and a prospect can only be one or the other.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, LedgerEntry } from '../types'
import type { Reputation } from './career'
import type { World } from './generate'
import { capabilities } from './capabilities'
import { pushLedger } from './ledger'

export const MAX_RED_FLAGS = 2

/** Can this rung red-flag prospects? Personnel only, with a board of their own. */
export function canRedFlag(career: CareerState): boolean {
  if (career.path !== 'personnel') return false
  const caps = capabilities(career).can
  return caps.has('rankBoard') || caps.has('setBoard')
}

/** The red-flag ids, but only for the draft class they were tagged in. */
export function redFlagIds(world: World, career: CareerState): string[] {
  if (career.redFlags?.season !== world.season) return []
  return career.redFlags.ids
}

/**
 * Log a ledger entry for every red-flagged prospect another club has drafted
 * and who is not already logged. A prospect our own club took is skipped (the
 * user was warned at the pick). Returns how many landed.
 */
export function logRedFlags(world: World, career: CareerState): number {
  const ids = redFlagIds(world, career)
  if (!ids.length) return 0
  let logged = 0
  for (const p of world.draft) {
    if (!p.draftedBy || p.draftedBy === career.teamId) continue
    if (!ids.includes(p.id)) continue
    const already = (career.ledger ?? []).some((e) => e.redFlag && e.prospectId === p.id)
    if (already) continue
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
      accepted: true,
      redFlag: true,
      note: 'Red flag: you took him off the board.',
    })
    logged++
  }
  return logged
}

/**
 * Reputation and recap lines for red-flag calls graded this season. A hit (he
 * busted) is worth evaluation; a miss costs profile. Evaluation is capped at +3
 * per season.
 */
export function redFlagPayout(newly: LedgerEntry[]): { rep: Partial<Reputation>; lines: string[] } {
  const rep: Partial<Reputation> = {}
  const lines: string[] = []
  let evaluation = 0
  for (const e of newly) {
    if (!e.redFlag) continue
    if (e.hit) {
      evaluation += 2
      if (e.outcome) lines.push(e.outcome)
    } else {
      rep.profile = (rep.profile ?? 0) - 1
    }
  }
  if (evaluation > 0) rep.evaluation = Math.min(3, evaluation)
  return { rep, lines }
}

/** Only a prospect the league rates (top 64 by consensus grade, ~rounds 1–2) is worth a red flag. */
export const RED_FLAG_TOP_N = 64
export function isRedFlaggable(world: World, prospectId: string): boolean {
  const ranked = [...world.draft].sort((a, b) => b.grade - a.grade).slice(0, RED_FLAG_TOP_N)
  return ranked.some((p) => p.id === prospectId)
}

// ─────────────────────────────────────────────────────────────────────────────
// The 3-year cap memo (G3).
//
// Cap rungs (Assistant GM, GM) file a memo every offseason: where they expect
// next season's year-end cap space to land, up to three priority extensions,
// and one sentence of intent. The memo locks once filed and is graded a year
// later — the forecast against the real books, and each priority against
// whether his deal actually got longer. Committing in public is the job.
// ─────────────────────────────────────────────────────────────────────────────

import type { CapMemo, CareerState } from '../types'
import type { Reputation } from './career'
import type { World } from './generate'
import { capabilities } from './capabilities'
import { summarizeCap } from './cap'

export type SpaceBucket = 'tight' | 'comfortable' | 'flush'

/** Bucket a cap-space number for the memo forecast. */
export function spaceBucket(space: number): SpaceBucket {
  if (space < 5_000_000) return 'tight'
  if (space > 25_000_000) return 'flush'
  return 'comfortable'
}

/** Tone for a cap-space figure in dollars: over the cap is a loss, tight is a warning, flush is a win. */
export function capSpaceTone(space: number): 'loss' | 'warn' | 'win' | undefined {
  if (space < 0) return 'loss'
  const bucket = spaceBucket(space)
  return bucket === 'tight' ? 'warn' : bucket === 'flush' ? 'win' : undefined
}

/** Does this rung get to file a cap memo right now? */
export function canFileMemo(world: World, career: CareerState): boolean {
  if (!capabilities(career).can.has('manageCap')) return false
  if (world.phase !== 'offseason') return false
  const memo = career.capMemo
  // One live memo per offseason — the previous one must be graded first.
  if (memo && !memo.graded && memo.filedSeason === world.season) return false
  return true
}

export interface CapMemoGrade {
  rep: Partial<Reputation>
  lines: string[]
  /** The one-line verdict, used for the ledger advice entry. */
  summary: string
}

/**
 * Grade the memo filed last offseason. Returns null until its grade year
 * arrives, or if it has already been graded.
 *
 * The forecast is right when the club's actual year-end space lands in the
 * bucket you named. Each priority pays only if he is still on the club and his
 * `signedThrough` moved past what you recorded at filing.
 */
export function gradeCapMemo(world: World, career: CareerState): CapMemoGrade | null {
  const memo: CapMemo | undefined = career.capMemo
  if (!memo || memo.graded) return null
  if (world.season !== memo.filedSeason + 1) return null

  const summary = summarizeCap(world.roster[career.teamId] ?? [], world.deadMoney[career.teamId] ?? 0, world.season)
  const right = spaceBucket(summary.space) === memo.bucket
  const rep: Partial<Reputation> = right ? { roster: 2, leadership: 1 } : {}

  const roster = world.roster[career.teamId] ?? []
  let extended = 0
  for (const pr of memo.priorities) {
    const p = roster.find((x) => x.id === pr.playerId)
    if (p && p.contract.signedThrough > pr.signedThrough) extended++
  }
  // Phase guardrail: no feature pays more than +3 in one dimension per season.
  if (extended > 0) rep.roster = Math.min(3, (rep.roster ?? 0) + extended)

  const line = `Cap memo: forecast ${memo.bucket} — ${right ? 'right' : 'wrong'}; ${extended}/${memo.priorities.length} priorities extended.`
  return { rep, lines: [line], summary: line }
}

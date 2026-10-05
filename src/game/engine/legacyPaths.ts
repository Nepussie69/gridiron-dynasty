// ─────────────────────────────────────────────────────────────────────────────
// Legacy paths (#17).
//
// At the end of a career you are not just "a GM who won X games" — you are a
// type. A Champion chases rings, a Builder turns franchises around, a Talent
// Finder lives on the Ledger, a Tree Grower populates the league with his
// people, a Lifer never leaves one building. Five different ways to win, so
// different players chase different careers.
//
// There is no explicit retirement screen yet, so this is also surfaced live on
// the Career page as "your legacy so far" — the leader updates as you go.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState } from '../types'

export type LegacyPathId = 'champion' | 'builder' | 'talentFinder' | 'treeGrower' | 'lifer'

export interface LegacyPathScore {
  id: LegacyPathId
  title: string
  blurb: string
  /** 0-100 */
  score: number
  evidence: string[]
}

export interface LegacyProfile {
  leader: LegacyPathScore
  all: LegacyPathScore[]
  seasons: number
}

const PATHS: Record<LegacyPathId, { title: string; blurb: string }> = {
  champion: { title: 'The Champion', blurb: 'Rings are the only currency that never inflates.' },
  builder: { title: 'The Builder', blurb: 'You took over bad teams and left them good.' },
  talentFinder: { title: 'The Talent Finder', blurb: 'Your board was right more often than it was wrong.' },
  treeGrower: { title: 'The Tree Grower', blurb: 'Your people run the league now.' },
  lifer: { title: 'The Lifer', blurb: 'One building, one standard, a very long time.' },
}

const ORDER: LegacyPathId[] = ['champion', 'builder', 'talentFinder', 'treeGrower', 'lifer']

function winsOf(record: string): number | null {
  const n = Number(record.split('-')[0])
  return Number.isFinite(n) ? n : null
}

/** Longest run of consecutive seasons with the same team, and its team id. */
function longestTenure(career: CareerState): { team: string; seasons: number } {
  let best = { team: career.teamId, seasons: 0 }
  let run = 0
  let runTeam = ''
  for (const h of career.history) {
    if (h.team === runTeam) run++
    else {
      runTeam = h.team
      run = 1
    }
    if (run > best.seasons) best = { team: runTeam, seasons: run }
  }
  return best
}

export function legacyProfile(career: CareerState): LegacyProfile {
  const hist = career.history
  const ledger = career.ledger ?? []
  const tree = career.tree ?? []

  // ── Champion: rings and deep runs ─────────────────────────────────────────
  const rings = hist.filter((h) => /champion/i.test(h.outcome)).length
  const playoffYears = hist.filter((h) => /playoff|champion/i.test(h.outcome)).length
  const champion = Math.min(100, rings * 30 + playoffYears * 5)
  const championEvidence = [
    rings ? `${rings} championship${rings === 1 ? '' : 's'}` : '',
    playoffYears ? `${playoffYears} playoff season${playoffYears === 1 ? '' : 's'}` : '',
  ].filter(Boolean)

  // ── Builder: teams improved while you were there ──────────────────────────
  const byTeam = new Map<string, number[]>()
  for (const h of hist) {
    const w = winsOf(h.record)
    if (w === null) continue
    byTeam.set(h.team, [...(byTeam.get(h.team) ?? []), w])
  }
  let turnarounds = 0
  let bestSwing = 0
  for (const [, wins] of byTeam) {
    if (wins.length < 2) continue
    const swing = Math.max(...wins) - wins[0]
    if (swing >= 3) turnarounds++
    bestSwing = Math.max(bestSwing, swing)
  }
  const builder = Math.min(100, turnarounds * 35 + Math.max(0, bestSwing) * 3)
  const builderEvidence = [
    turnarounds ? `${turnarounds} franchise turnaround${turnarounds === 1 ? '' : 's'}` : '',
    bestSwing >= 3 ? `Best swing: +${bestSwing} wins` : '',
  ].filter(Boolean)

  // ── Talent Finder: the Ledger ─────────────────────────────────────────────
  const hits = ledger.filter((e) => e.hit).length
  const misses = ledger.filter((e) => e.hit === false).length
  const graded = hits + misses
  const rate = graded ? Math.round((hits / graded) * 100) : 0
  const talentFinder = Math.min(100, hits * 3 + (graded >= 10 ? rate * 0.4 : 0))
  const talentEvidence = [
    hits ? `${hits} Ledger hit${hits === 1 ? '' : 's'}` : '',
    graded >= 10 ? `${rate}% hit rate` : '',
  ].filter(Boolean)

  // ── Tree Grower: protégés who took the top job ────────────────────────────
  const treeGrower = Math.min(100, tree.length * 20 + Math.round(career.reputation.leadership / 5))
  const treeEvidence = tree.length ? [`${tree.length} protégé${tree.length === 1 ? '' : 's'} now running a club`] : []

  // ── Lifer: one building, a long time ──────────────────────────────────────
  const tenure = longestTenure(career)
  const lifer = Math.min(100, tenure.seasons * 5)
  const liferEvidence = tenure.seasons >= 2 ? [`${tenure.seasons} straight seasons with one club`] : []

  const all: LegacyPathScore[] = [
    { id: 'champion', ...PATHS.champion, score: champion, evidence: championEvidence },
    { id: 'builder', ...PATHS.builder, score: builder, evidence: builderEvidence },
    { id: 'talentFinder', ...PATHS.talentFinder, score: talentFinder, evidence: talentEvidence },
    { id: 'treeGrower', ...PATHS.treeGrower, score: treeGrower, evidence: treeEvidence },
    { id: 'lifer', ...PATHS.lifer, score: lifer, evidence: liferEvidence },
  ]

  const leader = [...all].sort(
    (a, b) => b.score - a.score || ORDER.indexOf(a.id) - ORDER.indexOf(b.id),
  )[0]
  return { leader, all, seasons: hist.length }
}

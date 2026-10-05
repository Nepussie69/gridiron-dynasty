// ─────────────────────────────────────────────────────────────────────────────
// Traits earned through deeds (#10).
//
// Traits are not bought. They unlock from what you actually did, and each one
// changes how you see prospects. Your résumé then reads as a story of what each
// job taught you.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, EarnedTrait, LedgerEntry } from '../types'
import type { World } from './generate'
import { tierFor } from './career'

interface DeedDef {
  id: string
  name: string
  desc: string
  test: (ledger: LedgerEntry[]) => boolean
}

const DEEDS: DeedDef[] = [
  {
    id: 'diamondDigger',
    name: 'Diamond Digger',
    desc: 'You found three starters outside the top 300. Your read on low-rated prospects is sharper.',
    test: (ledger) => ledger.filter((e) => e.hit && (e.myGrade ?? 99) <= 70 && (e.kind === 'pick' || e.kind === 'recommendation')).length >= 3,
  },
  {
    id: 'burnedByStopwatch',
    name: 'Burned by the Stopwatch',
    desc: 'You over-graded a rare athlete who busted. You trust testing less now.',
    test: (ledger) => ledger.some((e) => e.hit === false && (e.myGrade ?? 0) >= 82),
  },
  {
    id: 'talentWhisperer',
    name: 'Talent Whisperer',
    desc: 'Five graded calls have landed. The room leans on your eye.',
    test: (ledger) => ledger.filter((e) => e.hit).length >= 5,
  },
  {
    id: 'grinder',
    name: 'The Grinder',
    desc: 'You filed a huge volume of reports before you earned a big chair.',
    test: (ledger) => ledger.filter((e) => e.kind === 'recommendation').length >= 25,
  },
]

/** Award any newly-earned traits at season end. */
export function evaluateTraits(career: CareerState): EarnedTrait[] {
  const ledger = career.ledger ?? []
  const have = new Set((career.earnedTraits ?? []).map((t) => t.id))
  const out = [...(career.earnedTraits ?? [])]
  for (const d of DEEDS) {
    if (!have.has(d.id) && d.test(ledger)) {
      out.push({ id: d.id, name: d.name, desc: d.desc, season: career.season, role: tierFor(career.path, career.level).title })
    }
  }
  return out
}

/** Width multiplier for your prospect ranges, from your traits. */
export function traitRangeFactor(career: CareerState, center: number): number {
  const ids = new Set((career.earnedTraits ?? []).map((t) => t.id))
  let f = 1
  if (ids.has('diamondDigger') && center < 72) f *= 0.75 // tighter on low-rated prospects
  if (ids.has('burnedByStopwatch') && center >= 82) f *= 1.1 // humbler on the freaks
  if (ids.has('talentWhisperer')) f *= 0.92
  return f
}

/** One-line résumé of a trait, e.g. "Area Scout, Midwest, 2028". */
export function traitOrigin(t: EarnedTrait): string {
  return `${t.role}, ${t.season}`
}

export function hasTrait(career: CareerState, id: string): boolean {
  return (career.earnedTraits ?? []).some((t) => t.id === id)
}

export { type World }

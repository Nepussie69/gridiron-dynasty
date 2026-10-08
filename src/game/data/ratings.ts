// ─────────────────────────────────────────────────────────────────────────────
// Rating model
//
// Overall ratings and the attribute schema mirror EA's Madden NFL 26 (pro) and
// EA Sports College Football 26 (college) scales, so numbers here read the same
// as the games our users know:
//   99 = generational  · 95+ = elite  · 88+ = Pro Bowl  · 80+ = starter
//   72+ = solid role player  · 65+ = depth  · <65 = camp body
//
// Reference values below are curated launch-day/season numbers for well-known
// players. They are editable and updated by the Phase 2 data pipeline, which
// ingests full Madden 26 / CFB 26 rosters (overall + full attribute set).
// ─────────────────────────────────────────────────────────────────────────────

import type { Position } from '../types'

/**
 * Per-position attribute schema, matching the fields Madden/CFB expose.
 *
 * L12 E0: every rating a position uses is present, so generated players carry the
 * same keys as the real data (and the sim can read them). New keys are appended to
 * the end of each list: `attributesFor` jitters by key index, so appending leaves
 * every existing generated value identical. STA and TGH are appended last everywhere.
 */
export const ATTRIBUTE_SCHEMA: Record<string, string[]> = {
  QB: ['SPD', 'STR', 'AGI', 'AWR', 'THP', 'SAC', 'MAC', 'DAC', 'RUN', 'PAC', 'ACC', 'TOR', 'TUP', 'BTK', 'STA', 'TGH'],
  RB: ['SPD', 'STR', 'AGI', 'AWR', 'CAR', 'BCV', 'JKM', 'TRK', 'SRR', 'CIT', 'ACC', 'COD', 'CTH', 'SPM', 'SFA', 'BTK', 'STA', 'TGH'],
  FB: ['RBK', 'IBL', 'PBK', 'CAR', 'BTK', 'TRK', 'CTH', 'SPD', 'STR', 'AWR', 'STA', 'TGH'],
  WR: ['SPD', 'STR', 'AGI', 'AWR', 'CIT', 'SRR', 'MRR', 'DRR', 'RTE', 'JMP', 'ACC', 'COD', 'CTH', 'SPC', 'RLS', 'BTK', 'STA', 'TGH'],
  TE: ['SPD', 'STR', 'AGI', 'AWR', 'CIT', 'SRR', 'RBK', 'IBL', 'ACC', 'CTH', 'SPC', 'PBK', 'BTK', 'STA', 'TGH'],
  OT: ['STR', 'AGI', 'AWR', 'PBK', 'RBK', 'IMP', 'IBL', 'STA', 'TGH'],
  OG: ['STR', 'AGI', 'AWR', 'PBK', 'RBK', 'IMP', 'IBL', 'STA', 'TGH'],
  C: ['STR', 'AGI', 'AWR', 'PBK', 'RBK', 'IMP', 'IBL', 'STA', 'TGH'],
  DE: ['SPD', 'STR', 'AGI', 'AWR', 'PMV', 'FMV', 'BSH', 'TAK', 'PUR', 'ACC', 'PRC', 'STA', 'TGH'],
  DT: ['SPD', 'STR', 'AGI', 'AWR', 'PMV', 'FMV', 'BSH', 'TAK', 'PUR', 'ACC', 'PRC', 'STA', 'TGH'],
  LB: ['SPD', 'STR', 'AGI', 'AWR', 'TAK', 'PUR', 'PRC', 'MCV', 'ZCV', 'BSH', 'ACC', 'HPW', 'PMV', 'FMV', 'STA', 'TGH'],
  CB: ['SPD', 'STR', 'AGI', 'AWR', 'MCV', 'ZCV', 'PRS', 'JMP', 'TAK', 'ACC', 'COD', 'PRC', 'STA', 'TGH'],
  S: ['SPD', 'STR', 'AGI', 'AWR', 'MCV', 'ZCV', 'PRC', 'TAK', 'PUR', 'ACC', 'HPW', 'JMP', 'STA', 'TGH'],
  K: ['KPW', 'KAC', 'AWR', 'STA', 'TGH'],
  P: ['KPW', 'KAC', 'AWR', 'STA', 'TGH'],
}

/** Madden NFL 26 overall ratings for notable players (curated reference). */
export const MADDEN_26: Record<string, number> = {
  'Josh Allen': 99,
  "Ja'Marr Chase": 99,
  'Myles Garrett': 99,
  'Jaxon Smith-Njigba': 99,
  'Micah Parsons': 98,
  'Jahmyr Gibbs': 98,
  'George Kittle': 98,
  'Patrick Mahomes': 97,
  'Lamar Jackson': 97,
  'Justin Jefferson': 97,
  'T.J. Watt': 97,
  'Saquon Barkley': 97,
  'Christian McCaffrey': 96,
  'Nick Bosa': 96,
  'Fred Warner': 96,
  'CeeDee Lamb': 96,
  'Joe Burrow': 95,
  'Amon-Ra St. Brown': 95,
  'Aidan Hutchinson': 95,
  'Pat Surtain II': 95,
  'Roquan Smith': 94,
  'Puka Nacua': 94,
  'Bijan Robinson': 94,
  'Quinnen Williams': 93,
  'Maxx Crosby': 93,
  'A.J. Brown': 93,
  'Derwin James': 93,
  'Jalen Hurts': 92,
  'Chris Jones': 93,
  'Trey McBride': 92,
  'Jonathan Taylor': 92,
  'Creed Humphrey': 92,
  'Quenton Nelson': 92,
  'Minkah Fitzpatrick': 91,
  'Sauce Gardner': 91,
  'Dexter Lawrence': 91,
  'Trent Williams': 92,
  'Drake London': 89,
  'Trevor Lawrence': 87,
  'Jared Goff': 89,
  'Baker Mayfield': 88,
  'Matthew Stafford': 91,
  'Jayden Daniels': 90,
  'C.J. Stroud': 89,
  'Justin Herbert': 90,
  'Drake Maye': 86,
  'Bo Nix': 85,
  'Caleb Williams': 86,
  'Malik Nabers': 90,
  'Marvin Harrison Jr.': 85,
  'Kyler Murray': 84,
  'Alvin Kamara': 83,
  'Mike Evans': 86,
  'Josh Jacobs': 89,
  'Jordan Love': 88,
  'Dak Prescott': 88,
  'James Cook': 89,
  'Will Anderson Jr.': 90,
  'Jeffery Simmons': 90,
  'Terry McLaurin': 89,
  'Kenneth Walker III': 86,
  'D.J. Moore': 86,
  'Bryce Young': 79,
  'Tyreek Hill': 92,
}

/** College Football 26 overall ratings for notable players (curated reference). */
export const CFB_26: Record<string, number> = {
  'Jeremiah Smith': 98,
  'Leonard Moore': 97,
  'Caleb Downs': 96,
  'Anthony Hill Jr.': 95,
  'Jeremiyah Love': 95,
  'Nicholas Singleton': 93,
  'Isaac Brown': 93,
  'Makhi Hughes': 92,
  'Garrett Nussmeier': 90,
  'Lanorris Sellers': 90,
  'Dylan Stewart': 91,
  'Malachi Nelson': 88,
}

/** Look up a real rating, or fall back to a supplied value. */
export function rated(name: string, fallback: number): number {
  return MADDEN_26[name] ?? CFB_26[name] ?? fallback
}

/**
 * Assign Madden/CFB-style attributes to a player. Until the full pipeline lands,
 * we derive a plausible spread from overall rating + a stable per-player hash,
 * weighted by position so the numbers "look right" for each spot.
 */
export function attributesFor(playerId: string, pos: Position, ovr: number): Record<string, number> {
  const keys = ATTRIBUTE_SCHEMA[pos] ?? ATTRIBUTE_SCHEMA.LB
  const out: Record<string, number> = {}
  let h = 2166136261
  for (let i = 0; i < playerId.length; i++) {
    h ^= playerId.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  for (let i = 0; i < keys.length; i++) {
    h = Math.imul(h ^ (i + 1), 16777619)
    const jitter = (((h >>> 0) % 200) / 10) - 10 // -10 .. +9
    out[keys[i]] = Math.max(40, Math.min(99, Math.round(ovr + jitter * 0.6)))
  }
  // Awareness tracks overall more tightly, like the games do.
  if (out.AWR !== undefined) out.AWR = Math.max(45, Math.min(99, Math.round(ovr - 1)))
  return out
}

/**
 * The same merge the sim uses: generated attributes first, then any exact
 * ratings the player carries. Mirrors `mkAttrs` in `playsim.ts`/`statAlloc.ts`
 * without importing from them (which keeps the engine files untouched).
 */
export function playerAttrs(p: {
  id: string
  pos: Position
  ovr: number
  attrs?: Record<string, number>
}): Record<string, number> {
  return { ...attributesFor(p.id, p.pos, p.ovr), ...(p.attrs ?? {}) }
}

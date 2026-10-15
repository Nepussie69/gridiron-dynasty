// ─────────────────────────────────────────────────────────────────────────────
// Evaluate the evaluators (#7).
//
// Every NPC scout has a blind spot — one overrates speed, one loves the blue
// bloods, one is soft on character. Their filed grade is skewed by it. As a
// Director or GM you read their reports and their Ledger, never the truth, and
// the job becomes learning your staff: "Scout B grades edge rushers 4 high."
//
// The bias is deterministic per staffer; the Ledger lets you discover it.
// ─────────────────────────────────────────────────────────────────────────────

import type { DraftProspect, ScoutBias, StaffMember } from '../types'
import { clamp, hash32 } from './rng'

const AXES: ScoutBias['axis'][] = ['speed', 'size', 'production', 'conference', 'character']

/** Programs whose brand inflates a conference-focused scout's grade. */
const BLUE_BLOODS = new Set([
  'Alabama', 'Georgia', 'Ohio State', 'LSU', 'Clemson', 'Texas', 'Oklahoma', 'Michigan',
  'USC', 'Notre Dame', 'Penn State', 'Florida', 'Auburn', 'Oregon', 'Texas A&M',
  'Florida State', 'Miami', 'Washington', 'Wisconsin', 'Iowa', 'Tennessee', 'Penn State',
])

export const AXIS_LABEL: Record<ScoutBias['axis'], string> = {
  speed: 'athletic testing',
  size: 'measurables',
  production: 'college production',
  conference: 'big-conference names',
  character: 'character',
}

/** Deterministic bias for a staffer. */
export function makeScoutBias(seed: string): ScoutBias {
  const axis = AXES[hash32(seed, 41) % AXES.length]
  const magnitude = (2 + (hash32(seed, 43) % 7)) * (hash32(seed, 44) % 2 ? 1 : -1)
  return { axis, magnitude }
}

function localRng(seed: string) {
  let s = hash32(seed, 71) >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** How strongly this prospect presses the scout's bias. */
function focusValue(axis: ScoutBias['axis'], p: DraftProspect): number {
  switch (axis) {
    case 'speed':
      return clamp((p.ovr - 60) / 40, -1, 1)
    case 'size':
      return clamp((p.ovr - 62) / 38, -1, 1)
    case 'production':
      return clamp((p.production - 62) / 38, -1, 1)
    case 'conference':
      return BLUE_BLOODS.has(p.college) ? 1 : -0.4
    case 'character':
      // Scouts can't see character either; a character-focused scout just
      // over-favours the consensus on high-character (i.e. high-production) kids.
      return clamp((p.production - 62) / 38, -1, 1)
  }
}

/**
 * L12.17 DR4: the league's read on one specific prospect — a medical, character
 * or small-school drag, occasionally a hype bump. It is a property of the player
 * (not of the club): every club's file carries it, so it moves where a man is
 * drafted without any club knowing the truth. Heavy-tailed by design, which is
 * how a true top-32 talent lasts into Day 3 once in a while — and why the men
 * who slide are the ones with a flag, not the ones the dice liked.
 */
export function prospectStock(id: string): number {
  const h = hash32(id, 61) % 100
  // L12.17 DR4c: rarer and shallower again — a true top-32 man lasting past pick
  // 64 must be the odd flagged body (target 1-5 a class), not a coin flip.
  if (h < 1) return -4 - (hash32(id, 62) % 6)
  if (h < 7) return -1 - (hash32(id, 63) % 3)
  if (h >= 97) return 3 + (hash32(id, 64) % 4)
  return 0
}

/** The grade this staffer would file on a prospect: biased and deterministic. */
export function scoutReport(member: StaffMember, p: DraftProspect): number {
  const bias = member.bias ?? { axis: 'production' as const, magnitude: 0 }
  const mod = focusValue(bias.axis, p) * bias.magnitude
  const rng = localRng(member.id + p.id)
  // L12.17 DR3b: a report is a single pair of eyes. ±4.5 was too noisy once a
  // club averaged its two evaluators (board |err| ~2.8 vs a ~4-point top-32
  // spread → true top-32 men sliding past 64). ±3 keeps a club's board a real
  // read (±2 grades) while a six-report department board still reads tighter.
  const noise = (rng() - 0.5) * 4
  return clamp(Math.round(p.trueGrade + prospectStock(p.id) + mod + noise), 40, 99)
}

/** Fold a filed report vs. the truth into the staffer's Ledger. */
export function recordReport(member: StaffMember, p: DraftProspect) {
  if (!member.reportLedger) member.reportLedger = []
  if (member.reportLedger.some((r) => r.prospectId === p.id)) return
  member.reportLedger.push({ prospectId: p.id, grade: scoutReport(member, p), truth: p.trueGrade })
  if (member.reportLedger.length > 60) member.reportLedger.shift()
}

export interface LearnedBias {
  samples: number
  avgError: number
  label: string | null
}

/** What you've learned about a staffer from their file. */
export function learnedBias(member: StaffMember): LearnedBias {
  const led = member.reportLedger ?? []
  if (!led.length) return { samples: 0, avgError: 0, label: null }
  const avg = led.reduce((s, r) => s + (r.grade - r.truth), 0) / led.length
  const rounded = Math.round(avg)
  const label =
    led.length < 3
      ? null
      : Math.abs(rounded) >= 2
        ? `Grades ${AXIS_LABEL[member.bias?.axis ?? 'production']} ~${Math.abs(rounded)} pts ${rounded > 0 ? 'high' : 'low'}`
        : 'Reads close to the truth'
  return { samples: led.length, avgError: +avg.toFixed(1), label }
}

/** Staff who file prospect reports (used for the staff board). */
export function isEvaluator(m: StaffMember): boolean {
  return (
    m.role === 'Scout' ||
    m.role === 'Director of Player Personnel' ||
    m.role === 'General Manager' ||
    m.role === 'Head Coach' ||
    m.role.endsWith('Coordinator')
  )
}

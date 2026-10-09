// ─────────────────────────────────────────────────────────────────────────────
// Quick calls (user request, 2026-10-09): "just run" / "just pass" on a play-call
// moment, and the staff picks the concept. Deterministic, no rng: it reads the
// opponent's situational tendencies (the same book the AI draws its call from),
// scores each option with the call matrix, and applies NFL situational norms —
// short yardage runs inside, 3rd & long throws past the sticks, red-zone throws
// stay inside the field.
// ─────────────────────────────────────────────────────────────────────────────

import type { World } from './generate'
import { aiTendency, type Moment } from './playsim'
import { bucketFor, callEdge, offClassFor, DEF_CALLS, type OffClass } from './decisions'
import { playbookPlay } from '../data/playbookData'
import { hash32 } from './rng'

const INSIDE_RUNS = /^(Inside Zone|Power|Iso|Duo|Trap|Sneak|Inside Zone Split)$/
const PERIMETER_RUNS = /^(Outside Zone|Toss|Pin-Pull|Jet Sweep|Counter|Read Option|RPO Run)$/
const LONG_YARDAGE_RUNS = /^(Draw|QB Draw|Counter|Trap)$/

/** The option id the staff would call for "run" or "pass" in this moment, or null. */
export function quickOffCall(world: World, oppId: string, moment: Moment, lean: 'run' | 'pass'): string | null {
  const down = moment.down ?? 1
  const distance = moment.distance ?? 10
  const yard = moment.yard
  const bucket = bucketFor(down, distance, yard)
  const theirDef = aiTendency(world, oppId, bucket).def
  const toGoal = 100 - yard
  const lateDown = down >= 3

  const options = moment.options
    .map((o) => ({ id: o.id, play: playbookPlay(o.id) }))
    .filter((o) => o.play?.type === lean)
  if (!options.length) return null

  // Expected call-matrix edge of a class against what this defense likes here.
  const expEdge = (cls: OffClass) => DEF_CALLS.reduce((t, d) => t + (theirDef[d] ?? 0) * callEdge(cls, d), 0)

  const scored: { id: string; score: number }[] = []
  for (const o of options) {
    const p = o.play!
    let score = expEdge(offClassFor(p.type, p.depth)) * 2
    if (lean === 'pass') {
      // Aim at the sticks on late downs, a medium shot on early downs.
      const target = lateDown ? Math.max(distance + 1, 4) : distance >= 8 ? 10 : 7
      const capped = Math.min(target, Math.max(3, toGoal - 2))
      score -= Math.abs(p.depth - capped) * 0.35
      if (lateDown && p.depth < distance) score -= 3 // short of the sticks on a money down
      if (p.depth > toGoal + 8) score -= 4 // no room for the route in the red zone
    } else {
      if (distance <= 2 || toGoal <= 3) score += INSIDE_RUNS.test(p.name) ? 3 : -1
      else if (distance >= 8) score += LONG_YARDAGE_RUNS.test(p.name) ? 2.5 : 0
      else score += PERIMETER_RUNS.test(p.name) ? 1 : INSIDE_RUNS.test(p.name) ? 0.8 : 0
      if (p.name === 'Sneak' && distance > 1) score -= 4
    }
    // The staff's standing pick breaks ties.
    if (o.id === moment.defaultId) score += 0.25
    scored.push({ id: o.id, score })
  }
  // Rotate among the near-best calls so the staff isn't predictable, keyed on
  // the snap (same moment -> same call, no rng).
  const top = Math.max(...scored.map((x) => x.score))
  const near = scored.filter((x) => x.score >= top - 1).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  return near[hash32(`${moment.id}:${lean}`, 7) % near.length]?.id ?? null
}

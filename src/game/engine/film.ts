// ─────────────────────────────────────────────────────────────────────────────
// Film grade (L10 G5).
//
// Reads the user's in-game decisions back and grades the calls on expected
// points. Taking the best-EV option every time grades an A (95); each call that
// gives up expected points costs 10 grade points per point. Routine PATs are
// left off the sheet so the lines show the calls that mattered.
// ─────────────────────────────────────────────────────────────────────────────

import type { World } from './generate'
import type { GameSim } from './playsim'
import { attributesFor } from '../data/ratings'
import { depthGroup } from './depth'
import { fourthDownEV, twoPointChoice, type Situation } from './decisions'

export interface FilmGrade {
  /** 0–100. */
  grade: number
  letter: string
  lines: string[]
  /** Decisions the user made in the moment (not standing orders). */
  userCalls: number
}

function letterFor(grade: number): string {
  if (grade >= 93) return 'A'
  if (grade >= 90) return 'A−'
  if (grade >= 87) return 'B+'
  if (grade >= 83) return 'B'
  if (grade >= 80) return 'B−'
  if (grade >= 77) return 'C+'
  if (grade >= 73) return 'C'
  if (grade >= 70) return 'C−'
  if (grade >= 60) return 'D'
  return 'F'
}

function fmtDelta(v: number): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`
}

function yardName(yard: number): string {
  return yard >= 50 ? `their ${100 - yard}` : `your ${yard}`
}

/** The user's kicker's combined power/accuracy, matching resolveSpecial. */
function kickPowerFor(world: World, teamId: string): number {
  const k = depthGroup(world, teamId, ['K'], 1)[0]
  if (!k) return 78
  const attrs = { ...attributesFor(k.id, k.pos, k.ovr), ...(k.attrs ?? {}) }
  return (attrs.KPW ?? 78) * 0.5 + (attrs.KAC ?? 78) * 0.5
}

/** Two-point model: one snap from the 2 vs a near-certain PAT. */
const GO2_EV = 2 * 0.48
const KICK_EV = 0.94 * 1

export function gradeGame(world: World, sim: GameSim, userTeamId: string): FilmGrade | null {
  const decisions = sim.decisions ?? []
  if (!decisions.length) return null

  const kickPower = kickPowerFor(world, userTeamId)
  const lines: string[] = []
  let sum = 0

  for (const d of decisions) {
    if (d.kind === 'fourth') {
      const sit: Situation = {
        yard: d.yard,
        down: 4,
        distance: d.distance ?? 0,
        qtr: d.qtr,
        clockSec: 0,
        margin: d.margin,
      }
      const ev = fourthDownEV(sit, kickPower)
      const allowed: ('go' | 'fg' | 'punt')[] = ev.fg == null ? ['go', 'punt'] : ['go', 'fg', 'punt']
      const evOf = (id: string) => (id === 'go' ? ev.go : id === 'fg' ? (ev.fg as number) : ev.punt)
      const best = Math.max(...allowed.map(evOf))
      const delta = evOf(d.choiceId) - best
      sum += delta
      // List the 4th downs that were real calls (the ones that pause a coached
      // game), plus any call that cost expected points; skip routine punts.
      const realCall = (d.yard >= 35 && (d.distance ?? 99) <= 5) || d.yard >= 52
      if (d.source !== 'user' && !realCall && delta > -0.05) continue
      const verb = d.choiceId === 'go' ? 'went for it' : d.choiceId === 'fg' ? 'kicked the FG' : 'punted'
      lines.push(`4th & ${d.distance} at ${yardName(d.yard)}: ${verb} (${fmtDelta(delta)} vs best)`)
    } else if (d.kind === 'two') {
      // Following the chart is always defensible, so the chart choice is best.
      const best = twoPointChoice('chart', d.margin, d.qtr)
      const evOf = (id: string) => (id === 'go2' ? GO2_EV : KICK_EV)
      const delta = evOf(d.choiceId) - evOf(best)
      sum += delta
      // A routine PAT that the chart also kicks isn't a decision worth a line.
      if (d.source !== 'user' && d.choiceId === 'kick' && best === 'kick') continue
      const verb = d.choiceId === 'go2' ? 'went for two' : 'kicked the PAT'
      lines.push(`Two-point try: ${verb} (${fmtDelta(delta)} vs best)`)
    }
  }

  const grade = Math.round(Math.max(0, Math.min(100, 95 + sum * 10)))
  const userCalls = decisions.filter((d) => d.source === 'user').length
  return { grade, letter: letterFor(grade), lines, userCalls }
}

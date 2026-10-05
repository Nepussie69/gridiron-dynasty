// ─────────────────────────────────────────────────────────────────────────────
// The weekly checklist.
//
// Turns "what does this rung actually do?" into a literal to-do list each week.
// Tasks are derived from the role's capabilities, so they change as you climb:
// an assistant director grades and works the phones; a coordinator sets the plan;
// a GM runs the whole operation. Everyone handles set pieces and stretch
// assignments when they land.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState } from '../types'
import type { World } from './generate'
import { capabilities } from './capabilities'
import { currentSetPiece } from './weekly'

export interface WeekTask {
  id: string
  label: string
  hint: string
  done: boolean
  /** Screen to jump to, if any. */
  screen?: string
  /** Marks the one action that also ends the week. */
  primary?: boolean
}

const flag = (career: CareerState, key: string) => !!career.weekFlags?.[key]

export function weeklyTasks(
  career: CareerState,
  world: World,
  opts: { scoutingPoints: number; maxPoints: number },
): WeekTask[] {
  const caps = capabilities(career)
  const c = caps.can
  const out: WeekTask[] = []

  out.push({
    id: 'hours',
    label: 'Use your weekly hours',
    hint: 'My Career → This Week (film, drive the region, phones…)',
    done: (career.hoursLeft ?? 40) < 40,
    screen: 'career',
  })

  if (c.has('grade')) {
    out.push({
      id: 'scout',
      label: 'Scout a prospect',
      hint: 'Spend scouting points to tighten a read',
      done: opts.scoutingPoints < opts.maxPoints || flag(career, 'scout'),
      screen: 'scouting',
    })
    out.push({
      id: 'grade',
      label: 'File a recommendation',
      hint: 'Blue Chip / Starter / Depth / Pass',
      done: flag(career, 'grade'),
      screen: 'scouting',
    })
    out.push({
      id: 'character',
      label: "Work the phones on a target",
      hint: "Uncover a prospect's hidden character",
      done: flag(career, 'character'),
      screen: 'scouting',
    })
  }

  if (caps.planScope !== 'none') {
    out.push({ id: 'gameplan', label: 'Set your game plan', hint: 'Run/pass, tempo, pass rush, coverage', done: flag(career, 'gameplan'), screen: 'gameplan' })
  }

  const piece = currentSetPiece(world, career)
  if (piece) {
    out.push({ id: 'setpiece', label: `Set piece: ${piece.title}`, hint: piece.blurb, done: career.setPieceDone === world.season, screen: 'career' })
  }
  if (career.stretch && !career.stretch.accepted) {
    out.push({ id: 'stretch', label: `Respond: ${career.stretch.label}`, hint: 'A stretch assignment is on the table', done: false, screen: 'career' })
  }
  if (career.wilderness) {
    out.push({ id: 'wilderness', label: 'Choose your road back', hint: 'The Wilderness is open', done: false, screen: 'career' })
  }

  out.push({ id: 'advance', label: 'Advance the week', hint: 'Top bar — sims the league and resets your points', done: false, primary: true })
  return out
}

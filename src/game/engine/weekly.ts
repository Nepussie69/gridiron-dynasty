// ─────────────────────────────────────────────────────────────────────────────
// Rung rhythm: the annual set piece (#6) and stretch / interim assignments (#8).
//
// The job used to be choosing what NOT to do with a 40-hour weekly budget. L12.9
// removed that busywork: the same effects now arrive as passive weekly gains
// (applied in the store's advanceWeek), and the choices that mattered moved to
// where they belong (opponent film on Game Plan, character reads in Scouting).
// This module keeps the rung's action list so the game knows what each role does.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, StretchTask } from '../types'
import type { World } from './generate'
import { capabilities } from './capabilities'
import { rpick, type Rng } from './rng'
import type { Reputation } from './career'

export interface WeeklyAction {
  id: string
  label: string
  blurb: string
  /** L11.5 Q6: the concrete effect, shown under the label. */
  effect: string
}

/** The rung's weekly actions, filtered to what this rung is allowed to do. */
export function weeklyActions(career: CareerState): WeeklyAction[] {
  const c = capabilities(career).can
  const out: WeeklyAction[] = [
    { id: 'film', label: 'Study film', blurb: 'Sharpen your eye on this class.', effect: '+1 Evaluation skill' },
  ]
  if (c.has('grade')) out.push({ id: 'phones', label: 'Work the phones', blurb: "Uncover a prospect's character.", effect: "Reveal a prospect's character read" })
  if (c.has('grade')) out.push({ id: 'road', label: 'Drive the region', blurb: 'Cover more ground; +Evaluation.', effect: '+1 Evaluation skill' })
  if (c.has('crossCheck') || c.has('rankBoard')) out.push({ id: 'crosscheck', label: 'Cross-check reports', blurb: 'Compare the staff board.', effect: '+1 Profile' })
  if (c.has('developRoom')) out.push({ id: 'drills', label: 'Run drills', blurb: 'Develop a young player.', effect: 'Bank development reps for your room' })
  if (c.has('callPlays')) out.push({ id: 'install', label: 'Film session', blurb: 'Prep the game plan.', effect: '+1 Scheme skill' })
  if (c.has('callPlays')) out.push({ id: 'tendencies', label: 'Opponent film', blurb: "Study this week's opponent tendencies.", effect: "Reveal this week's opponent tendencies (2nd buy: sharp read)" })
  if (c.has('assignScouts') || c.has('hireStaff')) out.push({ id: 'scouts', label: 'Scouts meeting', blurb: "Learn a scout's bias.", effect: "+1 Profile, learn a scout's bias" })
  if (c.has('negotiate') || c.has('signFreeAgents')) out.push({ id: 'agent', label: 'Agent calls', blurb: 'Advance a negotiation.', effect: '+1 Roster' })
  if (c.has('setExpectations') || c.has('hireStaff')) out.push({ id: 'owner', label: 'Owner meeting', blurb: 'Manage the mandate; +job security.', effect: '+2 job security' })
  return out
}

// ── Annual set piece (#6) ────────────────────────────────────────────────────
export interface SetPieceOption {
  id: string
  label: string
  blurb: string
}
export interface SetPiece {
  id: string
  title: string
  blurb: string
  options: SetPieceOption[]
}

/** The seasonal "boss fight" for this rung, live for a few weeks a season. */
export function currentSetPiece(world: World, career: CareerState): SetPiece | null {
  if (career.setPieceDone === world.season) return null
  if (world.week < 8 || world.week > 11) return null
  if (career.path === 'personnel') {
    if (career.level <= 1)
      return {
        id: 'lockRegion',
        title: 'Lock Your Region Board',
        blurb: 'The area meeting is here. You lock the top names for your region.',
        options: [
          { id: 'best', label: 'Best available', blurb: 'A safe, accurate board — build trust.' },
          { id: 'upside', label: 'Swing for upside', blurb: 'Chase rare traits. Higher variance.' },
        ],
      }
    if (career.level >= 4 && career.level <= 5)
      return {
        id: 'boardMeeting',
        title: 'The Board Meeting',
        blurb: "Position coaches want their guys. Spend reputation to move the board.",
        options: [
          { id: 'push', label: 'Pound the table', blurb: 'Move your guy up — costs capital with the room.' },
          { id: 'consensus', label: 'Trust consensus', blurb: 'Stay safe; bank the goodwill.' },
        ],
      }
    if (career.level >= 8)
      return {
        id: 'capCrunch',
        title: 'Deadline Cap Room',
        blurb: 'The trade deadline is here. How do you create room for a move?',
        options: [
          { id: 'restructure', label: 'Restructure the vets', blurb: 'Create room for a deadline deal. Dead money later.' },
          { id: 'stand', label: 'Hold the line', blurb: 'Keep clean books and future flexibility.' },
        ],
      }
  } else {
    // Levels 0–1 and 5 are position-level rooms: Install Week.
    if (career.level <= 1 || career.level === 5)
      return {
        id: 'install',
        title: 'Install Week',
        blurb: 'Limited install slots before a statement game.',
        options: [
          { id: 'attack', label: "Attack their weakness", blurb: 'Aggressive, higher-risk install.' },
          { id: 'fundamentals', label: 'Fundamentals', blurb: 'Clean, disciplined, low-risk.' },
        ],
      }
    // NFL Coordinator: the bye week is for turning the mirror on your own tape.
    if (career.level === 6)
      return {
        id: 'selfScout',
        title: 'Bye-Week Self-Scout',
        blurb: 'The bye is here. How do you use the extra week to sharpen the plan?',
        options: [
          { id: 'tendencies', label: 'Break your tendencies', blurb: 'Install new wrinkles. Higher variance.' },
          { id: 'double', label: 'Double down on what works', blurb: 'Lean into your identity. Steadier.' },
        ],
      }
    // NFL Head Coach: the deadline is the GM's pen, but you can push.
    if (career.level === 7)
      return {
        id: 'tradeDeadline',
        title: 'Trade Deadline',
        blurb: 'The deadline is days away. The GM holds the pen — how hard do you push?',
        options: [
          { id: 'buy', label: 'Push the GM to buy', blurb: 'Win now. Add a piece for the stretch run.' },
          { id: 'stand', label: 'Trust this roster', blurb: 'Stay the course and bank the locker room.' },
        ],
      }
  }
  return null
}

/** Apply a set-piece choice: reputation moves and a story. */
export function resolveSetPiece(
  _career: CareerState,
  piece: SetPiece,
  choice: string,
  rng: Rng,
): { repDelta: Partial<Reputation>; note: string } {
  const roll = rng()
  const table: Record<string, { repDelta: Partial<Reputation>; note: string; success?: boolean }> = {
    lockRegion: choice === 'best'
      ? { repDelta: { evaluation: 3, profile: 1 }, note: 'Your region board went in clean and hit. The room trusts your eye.' }
      : { repDelta: { evaluation: rng() < 0.5 ? 4 : 1, profile: 2 }, note: rng() < 0.5 ? 'You swung on traits — one of your upside names popped. A bold board that landed.' : 'You swung on traits and missed on a few. The director remembers.' },
    boardMeeting: choice === 'push'
      ? { repDelta: { profile: 3, roster: 1, leadership: -3 }, note: 'You spent capital to move your guy up. The room noticed the conviction — and the cost.' }
      : { repDelta: { roster: 2, leadership: 1 }, note: 'You deferred to the room. The board stayed clean and the coaches owe you one.' },
    capCrunch: choice === 'restructure'
      ? { repDelta: { roster: 3, results: 2, leadership: -1 }, note: 'You created cap space by restructuring. Win-now, dead money later.' }
      : { repDelta: { roster: 1, profile: 1 }, note: 'You held the line on spending. Clean books and full flexibility.' },
    install: choice === 'attack'
      ? { repDelta: { results: 3, profile: 2 }, note: 'You attacked their weakness. The install paid off on film.' }
      : { repDelta: { leadership: 2, results: 1 }, note: 'You kept it simple. A clean, disciplined week.' },
    selfScout: choice === 'tendencies'
      ? { repDelta: { results: 3, profile: 1, leadership: -1 }, note: 'You broke your tendencies and caught the next opponent off guard — but the room had to unlearn old habits.' }
      : { repDelta: { leadership: 3, results: 1 }, note: 'You doubled down on what works. The unit trusted the plan and executed.' },
    tradeDeadline: choice === 'buy'
      ? { repDelta: { results: 3, profile: 1, leadership: -1 }, note: 'You pushed the GM to buy. A win-now move, but a few in the room felt the squeeze.' }
      : { repDelta: { leadership: 3, roster: 1 }, note: 'You trusted this roster. The locker room noticed you believe in it.' },
    // Legacy: only reachable by old saves whose career sat on a removed rung.
    // Never offered by currentSetPiece anymore.
    signingDay: choice === 'stars'
      ? { repDelta: { profile: 3, roster: 1 }, note: 'You chased the stars and won a couple of headline battles.' }
      : { repDelta: { leadership: 3, roster: 1 }, note: 'You prioritized fit and culture. The class is built the right way.' },
  }
  void roll
  return table[piece.id] ?? { repDelta: { profile: 1 }, note: 'A big week handled.' }
}

// ── Stretch assignments & interim jobs (#8) ──────────────────────────────────
const STRETCHES: { label: string; blurb: string; kind: StretchTask['kind']; reward: number; minLevel: number }[] = [
  { label: 'Run the Southeast cross-check', blurb: 'Own a region you do not cover. Prove you can build a board anywhere.', kind: 'stretch', reward: 4, minLevel: 1 },
  { label: 'Handle the agent negotiation', blurb: 'Run point on a contract talk for the club.', kind: 'stretch', reward: 4, minLevel: 2 },
  { label: 'Call the defense for a week', blurb: 'The coordinator is out — the unit is yours for one game.', kind: 'interim', reward: 5, minLevel: 1 },
  { label: 'Lead the December cut', blurb: 'Take the board from 1,000 names to 450 with the room watching.', kind: 'stretch', reward: 4, minLevel: 3 },
  { label: 'Sit in on the owner interview', blurb: 'Represent the front office with a head-coach candidate.', kind: 'stretch', reward: 3, minLevel: 4 },
]

/** Offer a stretch assignment from the rung above, at most one a season. */
export function maybeStretch(world: World, career: CareerState, rng: Rng): StretchTask | null {
  if (career.stretch) return null
  if (world.week < 3 || world.week > 6) return null
  if (rng() > 0.5) return null
  const pool = STRETCHES.filter((s) => career.level >= s.minLevel)
  if (!pool.length) return null
  const pick = rpick(rng, pool)
  return {
    id: `stretch_${world.season}_${world.week}`,
    label: pick.label,
    blurb: pick.blurb,
    kind: pick.kind,
    accepted: false,
    reward: pick.reward,
    season: world.season,
  }
}

/** Resolve an accepted stretch task at season end. */
export function stretchOutcome(task: StretchTask, success: boolean): { repDelta: Partial<Reputation>; note: string } {
  if (success) {
    return {
      repDelta: task.kind === 'interim' ? { results: task.reward, leadership: 2 } : { evaluation: task.reward, profile: 2 },
      note: `Stretch assignment delivered: ${task.label}. Word travels — the people above you noticed.`,
    }
  }
  return {
    repDelta: { profile: -1 },
    note: `The stretch assignment (${task.label}) got away from you. A missed chance to show the next rung.`,
  }
}

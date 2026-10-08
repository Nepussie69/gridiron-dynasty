// ─────────────────────────────────────────────────────────────────────────────
// Keys to the game (L12 W2).
//
// Before kickoff a coach promises two keys — the things he believes decide the
// game. They have NO sim effect: they are a promise, graded against the final
// box score. Both hit builds a little leadership reputation; neither does the
// opposite. AI clubs never pick keys; a coordinator only picks for his side.
// Every read here is deterministic (no rng).
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState } from '../types'
import type { World } from './generate'
import type { GameSim } from './playsim'
import { capabilities, isHeadCoach } from './capabilities'
import { depthGroup, teamRatings } from './depth'
import { boxScore } from './stats'

export type GameKeyId = 'turnovers' | 'run120' | 'stopRun' | 'sacks3' | 'wr1' | 'third40' | 'clean' | 'redzone'

export interface GameKey {
  id: GameKeyId
  label: string
  /** Which side a coordinator may promise it for ('both' = either). */
  side: 'off' | 'def' | 'both'
  blurb: string
}

export const GAME_KEYS: GameKey[] = [
  { id: 'turnovers', label: 'Win the turnover battle', side: 'both', blurb: 'Finish with more takeaways than giveaways.' },
  { id: 'run120', label: 'Rush for 120+', side: 'off', blurb: 'Lean on the ground game for 120 yards.' },
  { id: 'stopRun', label: 'Hold them under 90 rushing', side: 'def', blurb: 'Shut down their run game.' },
  { id: 'sacks3', label: 'Get 3+ sacks', side: 'def', blurb: 'Win up front and get home.' },
  { id: 'wr1', label: 'Their top WR under 60 yards', side: 'def', blurb: 'Erase their No. 1 receiver.' },
  { id: 'third40', label: 'Convert 40%+ on 3rd down', side: 'off', blurb: 'Stay on the field on money downs.' },
  { id: 'clean', label: 'Allow 1 sack or fewer', side: 'off', blurb: 'Protect the quarterback.' },
  { id: 'redzone', label: 'Score a TD on every trip (1+)', side: 'off', blurb: 'Finish drives in the end zone.' },
]

export const MAX_KEYS = 2

/** Can this rung pick keys — i.e. call plays? */
export function canPickKeys(career: CareerState): boolean {
  return capabilities(career).can.has('callPlays')
}

/** The keys a role may promise: a coordinator is limited to his side. */
export function pickableKeys(career: CareerState): GameKey[] {
  if (!canPickKeys(career)) return []
  if (isHeadCoach(career) || career.unitFocus === 'both') return GAME_KEYS
  const side = career.unitFocus === 'def' ? 'def' : 'off'
  return GAME_KEYS.filter((k) => k.side === side || k.side === 'both')
}

export type KeyEstimate = 'Likely' | 'Coin flip' | 'Long shot'

/**
 * A deterministic staff read on a key from both clubs' headline ratings. A
 * positive matchup edge reads Likely; a negative one Long shot; otherwise a
 * coin flip. No rng.
 */
export function keyEstimate(world: World, myTeamId: string, oppId: string, id: GameKeyId): KeyEstimate {
  const mine = teamRatings(world, myTeamId)
  const theirs = teamRatings(world, oppId)
  const offKeys: GameKeyId[] = ['run120', 'third40', 'redzone']
  const defKeys: GameKeyId[] = ['stopRun', 'sacks3', 'wr1']
  const diff = offKeys.includes(id)
    ? mine.off - theirs.def
    : defKeys.includes(id)
      ? mine.def - theirs.off
      : (mine.off - theirs.def + (mine.def - theirs.off)) / 2
  if (diff >= 3) return 'Likely'
  if (diff <= -3) return 'Long shot'
  return 'Coin flip'
}

export interface KeyGrade {
  id: GameKeyId
  label: string
  hit: boolean
  /** The actual result, e.g. "132 rush yds" or "3/9 on 3rd down". */
  detail: string
}

const isScrimmage = (p: { type: string }) => p.type === 'run' || p.type === 'pass'

/** Turnovers committed by a team's offense (INTs + lost fumbles). */
function giveaways(sim: GameSim, offId: string): number {
  return sim.plays.filter((p) => p.offId === offId && isScrimmage(p) && p.turnover).length
}

/**
 * Red-zone trips and touchdowns for one offense. A drive runs together as long
 * as the same offense has the ball — penalties and kicks never split it. A
 * *trip* is a scrimmage snap taken from inside the opponent's 20 (startYard
 * ≥ 80), so a long touchdown scored from outside the red zone, on its own, is
 * not a trip.
 */
function redZone(sim: GameSim, offId: string): { trips: number; tds: number } {
  let trips = 0
  let tds = 0
  let driveOpen = false
  let driveTrip = false
  let driveTd = false
  const flush = () => {
    if (driveOpen && driveTrip) {
      trips += 1
      if (driveTd) tds += 1
    }
    driveOpen = false
    driveTrip = false
    driveTd = false
  }
  for (const p of sim.plays) {
    if (p.offId !== offId) {
      flush()
      continue
    }
    driveOpen = true
    if (isScrimmage(p) && p.startYard >= 80) driveTrip = true
    if (isScrimmage(p) && p.result === 'TOUCHDOWN!') driveTd = true
  }
  flush()
  return { trips, tds }
}

/**
 * Grade the user's picked keys against a finished game. `world` and `sim` are
 * required so the opponent's *depth-chart* WR1 and the real per-player box score
 * are used — not the post-game leading receiver. Returns one row per key (in
 * the order picked) with a hit flag and the actual number.
 */
export function gradeKeys(world: World, sim: GameSim, userTeamId: string, ids: GameKeyId[]): KeyGrade[] {
  const oppId = sim.homeId === userTeamId ? sim.awayId : sim.homeId
  const us = sim.homeId === userTeamId ? sim.stats.home : sim.stats.away
  const them = sim.homeId === userTeamId ? sim.stats.away : sim.stats.home
  const box = sim.box ?? boxScore(world, sim)
  // Their No. 1 receiver by the depth chart (healthy starters first), not the
  // receiver who happened to lead the final box score.
  const theirWr1 = depthGroup(world, oppId, ['WR'], 1)[0]
  const wr1Line = theirWr1 ? box.find((b) => b.playerId === theirWr1.id) : undefined
  const rz = redZone(sim, userTeamId)
  const thirdPct = us.thirdDownAtt > 0 ? us.thirdDownConv / us.thirdDownAtt : 0

  const out: KeyGrade[] = []
  for (const id of ids) {
    const def = GAME_KEYS.find((k) => k.id === id)
    if (!def) continue
    let hit = false
    let detail = ''
    switch (id) {
      case 'turnovers': {
        const take = giveaways(sim, oppId)
        const give = giveaways(sim, userTeamId)
        hit = take > give
        detail = `${take} takeaways, ${give} giveaways`
        break
      }
      case 'run120':
        hit = us.rushYds >= 120
        detail = `${us.rushYds} rush yds`
        break
      case 'stopRun':
        hit = them.rushYds < 90
        detail = `${them.rushYds} rush yds allowed`
        break
      case 'sacks3':
        hit = us.sacks >= 3
        detail = `${us.sacks} sacks`
        break
      case 'wr1': {
        const yds = wr1Line?.line.recYds ?? 0
        hit = !!theirWr1 && yds < 60
        detail = theirWr1 ? `${theirWr1.name} ${yds} yds` : 'no WR on the depth chart'
        break
      }
      case 'third40':
        hit = us.thirdDownAtt > 0 && thirdPct >= 0.4
        detail = `${us.thirdDownConv}/${us.thirdDownAtt} on 3rd down`
        break
      case 'clean':
        hit = us.sacksTaken <= 1
        detail = `${us.sacksTaken} sacks allowed`
        break
      case 'redzone':
        hit = rz.trips >= 1 && rz.tds === rz.trips
        detail = `${rz.tds}/${rz.trips} red-zone trips`
        break
    }
    out.push({ id, label: def.label, hit, detail })
  }
  return out
}

/**
 * Leadership reputation from a graded promise: both keys hit → +1, one → 0,
 * neither → −1. A partial promise (fewer than two keys) is not graded — no
 * selection means no reward and no penalty.
 */
export function keysReward(grades: KeyGrade[]): number {
  if (grades.length < MAX_KEYS) return 0
  const hits = grades.filter((g) => g.hit).length
  if (hits === grades.length) return 1
  if (hits === 0) return -1
  return 0
}

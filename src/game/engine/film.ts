// ─────────────────────────────────────────────────────────────────────────────
// Film grade (L10 G5, extended in G13).
//
// Reads the user's in-game decisions back and grades the calls on expected
// points. Taking the best-EV option every time grades an A (95); each call that
// gives up expected points costs 10 grade points per point. Routine PATs are
// left off the sheet so the lines show the calls that mattered. G13 adds the
// play calls, halftime adjustments, the two-minute drill, timeouts and a QB
// switch, each worth a couple of grade points.
// ─────────────────────────────────────────────────────────────────────────────

import type { World } from './generate'
import type { GameSim, Play } from './playsim'
import { isSack } from './playsim'
import { attributesFor } from '../data/ratings'
import { depthGroup } from './depth'
import {
  fourthDownEV,
  twoPointChoice,
  DEF_CALL_LABEL,
  OFF_CLASS_LABEL,
  type Situation,
  type DefCall,
  type OffClass,
} from './decisions'

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

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function clockSec(clock: string): number {
  const [m, s] = clock.split(':').map(Number)
  return (m || 0) * 60 + (s || 0)
}

/** The user's kicker's combined power/accuracy, matching resolveSpecial. */
export function kickPowerFor(world: World, teamId: string): number {
  const k = depthGroup(world, teamId, ['K'], 1)[0]
  if (!k) return 78
  const attrs = { ...attributesFor(k.id, k.pos, k.ovr), ...(k.attrs ?? {}) }
  return (attrs.KPW ?? 78) * 0.5 + (attrs.KAC ?? 78) * 0.5
}

/** Two-point model: one snap from the 2 vs a near-certain PAT. */
const GO2_EV = 2 * 0.48
const KICK_EV = 0.94 * 1

// ── L10 G13 helpers ──────────────────────────────────────────────────────────

const FIX_LABEL: Record<string, string> = {
  maxProtect: 'Max protect',
  quickGame: 'Quick game',
  thirdDownHeat: 'Third-down heat',
  loadTheBox: 'Load the box',
  twoDeep: 'Two-deep',
}
const FIX_METRIC: Record<string, string> = {
  maxProtect: 'pass protection',
  quickGame: 'run game',
  thirdDownHeat: 'third-down defense',
  loadTheBox: 'run defense',
  twoDeep: 'explosives allowed',
}

/** The play index a moment was raised at, parsed from `${kind}-${n}`. */
export function playIndexOf(momentId: string): number {
  const n = Number(momentId.slice(momentId.lastIndexOf('-') + 1))
  return Number.isFinite(n) ? n : 0
}

/** Did the user's offense score on the drive that started at `start`? */
function driveScored(plays: Play[], start: number, teamId: string): boolean {
  for (let i = start; i < plays.length && i < start + 20; i++) {
    const p = plays[i]
    if (p.offId === teamId) {
      if (p.result === 'TOUCHDOWN!' || (p.type === 'fg' && p.result.includes('is good'))) return true
    } else if (p.type !== 'kickoff' && p.type !== 'pat' && p.type !== 'end') {
      return false
    }
  }
  return false
}

/** The clock when the user's offense next takes a scrimmage snap, or null. */
function gotBallBackClock(plays: Play[], start: number, teamId: string): number | null {
  for (let i = start; i < plays.length; i++) {
    const p = plays[i]
    if (p.offId === teamId && (p.type === 'run' || p.type === 'pass' || p.type === 'fg' || p.type === 'punt')) {
      return clockSec(p.clock)
    }
  }
  return null
}

/** Did the targeted metric improve in the second half after this halftime fix? */
function halftimeImproved(plays: Play[], teamId: string, fix: string): boolean {
  const half = (p: Play) => (p.qtr <= 2 ? 0 : 1)
  if (fix === 'maxProtect') {
    const sacks = [0, 0]
    for (const p of plays) if (p.offId === teamId && isSack(p)) sacks[half(p)] += 1
    return sacks[0] >= 1 && sacks[1] < sacks[0]
  }
  if (fix === 'quickGame') {
    const att = [0, 0]
    const yds = [0, 0]
    for (const p of plays) if (p.offId === teamId && p.type === 'run') { att[half(p)] += 1; yds[half(p)] += Math.max(0, p.yards) }
    return att[0] >= 1 && att[1] >= 1 && yds[1] / att[1] > yds[0] / att[0]
  }
  if (fix === 'thirdDownHeat') {
    const att = [0, 0]
    const conv = [0, 0]
    for (const p of plays) {
      if (p.defId !== teamId || p.down !== 3 || (p.type !== 'run' && p.type !== 'pass')) continue
      att[half(p)] += 1
      if (!p.turnover && (p.endYard >= 100 || p.yards >= (p.distance ?? 99))) conv[half(p)] += 1
    }
    return att[0] >= 1 && att[1] >= 1 && conv[1] / att[1] < conv[0] / att[0]
  }
  if (fix === 'loadTheBox') {
    const att = [0, 0]
    const yds = [0, 0]
    for (const p of plays) if (p.defId === teamId && p.type === 'run') { att[half(p)] += 1; yds[half(p)] += Math.max(0, p.yards) }
    return att[0] >= 1 && att[1] >= 1 && yds[1] / att[1] < yds[0] / att[0]
  }
  if (fix === 'twoDeep') {
    const ex = [0, 0]
    for (const p of plays) if (p.defId === teamId && p.type === 'pass' && p.yards >= 25 && !p.turnover) ex[half(p)] += 1
    return ex[0] >= 1 && ex[1] < ex[0]
  }
  return false
}

/** The QB with the most attempts in a quarter range. */
function topQb(plays: Play[], qMin: number, qMax: number): string | null {
  const counts = new Map<string, number>()
  for (const p of plays) {
    if (p.type !== 'pass' || !p.qbId || p.qtr < qMin || p.qtr > qMax) continue
    counts.set(p.qbId, (counts.get(p.qbId) ?? 0) + 1)
  }
  let best: string | null = null
  let n = -1
  for (const [id, v] of counts) if (v > n) { n = v; best = id }
  return best
}

/** Standard NFL passer rating for one QB over a quarter range. */
function passerRating(plays: Play[], qbId: string, qMin: number, qMax: number): number | null {
  let att = 0, comp = 0, yds = 0, td = 0, ints = 0
  for (const p of plays) {
    if (p.qbId !== qbId || p.type !== 'pass' || p.qtr < qMin || p.qtr > qMax) continue
    if (isSack(p)) continue
    att += 1
    if (p.turnover) { ints += 1; continue }
    if (p.result === 'Incomplete') continue
    comp += 1
    yds += Math.max(0, p.yards)
    if (p.result === 'TOUCHDOWN!') td += 1
  }
  if (!att) return null
  const term = (x: number) => Math.max(0, Math.min(2.375, x))
  const a = term((comp / att - 0.3) * 5)
  const b = term((yds / att - 3) * 0.25)
  const c = term((td / att) * 20)
  const d = term(2.375 - (ints / att) * 25)
  return ((a + b + c + d) / 6) * 100
}

export function gradeGame(world: World, sim: GameSim, userTeamId: string): FilmGrade | null {
  const decisions = sim.decisions ?? []
  if (!decisions.length) return null

  const plays = sim.plays
  const kickPower = kickPowerFor(world, userTeamId)
  const lines: string[] = []
  let sum = 0
  let bonus = 0

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
    } else if (d.kind === 'call' || d.kind === 'defCall') {
      // The matrix only tracks a call the user made; a standing order has no outcome.
      if (!d.outcome) continue
      const delta = d.outcome === 'won' ? 2 : d.outcome === 'lost' ? -2 : 0
      bonus += delta
      const who =
        d.kind === 'call'
          ? `Call: ${d.choiceId} vs ${DEF_CALL_LABEL[d.vs as DefCall] ?? d.vs ?? '?'}`
          : `Defensive call: ${DEF_CALL_LABEL[d.choiceId as DefCall] ?? d.choiceId} vs ${OFF_CLASS_LABEL[d.vs as OffClass] ?? d.vs ?? '?'}`
      lines.push(`${who} — ${d.outcome} (${fmtDelta(delta)})`)
    } else if (d.kind === 'halftime') {
      if (d.choiceId === 'stayCourse') continue
      if (halftimeImproved(plays, userTeamId, d.choiceId)) {
        bonus += 2
        lines.push(`Halftime: ${FIX_LABEL[d.choiceId] ?? d.choiceId} — the ${FIX_METRIC[d.choiceId] ?? 'plan'} improved (+2.0)`)
      }
    } else if (d.kind === 'twoMinute') {
      if (driveScored(plays, playIndexOf(d.momentId), userTeamId)) {
        bonus += 2
        lines.push('Two-minute drill: drive scored (+2.0)')
      }
    } else if (d.kind === 'clock') {
      const sec = gotBallBackClock(plays, playIndexOf(d.momentId), userTeamId)
      if (sec != null && sec >= 40) {
        bonus += 1
        lines.push(`Timeouts: got the ball back with ${fmtClock(sec)} (+1.0)`)
      }
    } else if (d.kind === 'qbChange') {
      if (d.choiceId !== 'switch') continue
      const starter = topQb(plays, 1, 2)
      const backup = topQb(plays, 3, 5)
      const sr = starter ? passerRating(plays, starter, 1, 2) : null
      const br = backup ? passerRating(plays, backup, 3, 5) : null
      if (sr != null && br != null) {
        const delta = br > sr ? 2 : -2
        bonus += delta
        lines.push(`QB switch: the backup ${br > sr ? 'outplayed' : 'struggled against'} the starter (${fmtDelta(delta)})`)
      }
    }
  }

  const grade = Math.round(Math.max(0, Math.min(100, 95 + sum * 10 + bonus)))
  const userCalls = decisions.filter((d) => d.source === 'user').length
  return { grade, letter: letterFor(grade), lines, userCalls }
}

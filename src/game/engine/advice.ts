// ─────────────────────────────────────────────────────────────────────────────
// Coordinator advice (L11.5 Q5).
//
// Before kickoff the OC and DC read the matchup and suggest a game plan. The
// advice only ever picks from the balanced presets (Q4), so following it is a
// sensible default rather than a dominant edge. Its quality scales with the
// coordinator's rating: a weak assistant sometimes just says "Balanced", and
// confidence drops. Everything is deterministic — seeded by the week and club.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, Player } from '../types'
import type { World } from './generate'
import { depthGroup, teamRatings } from './depth'
import { coachLabels, offStyle } from './playsim'
import { makeRng, hash32, clamp } from './rng'

export type AdviceSide = 'off' | 'def'
export type AdviceConfidence = 'high' | 'medium' | 'low'

export interface CoordinatorAdvice {
  side: AdviceSide
  /** The user's coordinator giving the advice. */
  coach: string
  /** A preset id from `PLAN_PRESETS` for the suggested side. */
  presetId: string
  reason: string
  confidence: AdviceConfidence
}

function mean(players: Player[]): number {
  if (!players.length) return 0
  return players.reduce((s, p) => s + p.ovr, 0) / players.length
}

/** Mean OVR of the first `n` healthy starters at a position group. */
function unit(world: World, teamId: string, positions: Player['pos'][], n: number): number {
  return mean(depthGroup(world, teamId, positions, n))
}

function confidenceFor(rating: number): AdviceConfidence {
  return rating >= 82 ? 'high' : rating >= 70 ? 'medium' : 'low'
}

function coordinator(world: World, teamId: string, side: AdviceSide) {
  const role = side === 'off' ? 'Offensive Coordinator' : 'Defensive Coordinator'
  return (world.staff[teamId] ?? []).find((s) => s.role === role)
}

const BALANCED_OFF = 'balanced'
const BALANCED_DEF = 'balanced-def'

/**
 * What the user's coordinators think the plan should be against `oppId`.
 * Returns one entry per coordinator that exists on the staff.
 */
export function coordinatorAdvice(world: World, career: CareerState, oppId: string): CoordinatorAdvice[] {
  const opp = world.byId[oppId]
  if (!opp) return []
  const labels = coachLabels(world, career.teamId)
  const oppRatings = teamRatings(world, oppId)
  const oppOff = oppRatings.off
  const oppDef = oppRatings.def
  const oppSecondary = unit(world, oppId, ['CB', 'S'], 5)
  const oppDl = unit(world, oppId, ['DE', 'DT'], 4)
  const oppRb = unit(world, oppId, ['RB'], 1)
  const oppOl = unit(world, oppId, ['OT', 'OG', 'C'], 5)
  const myOl = unit(world, career.teamId, ['OT', 'OG', 'C'], 5)
  const myDl = unit(world, career.teamId, ['DE', 'DT'], 4)

  const oppStyle = offStyle(world, oppId)
  const oppPassRate = oppStyle.passRate
  const oppDc = (world.staff[oppId] ?? []).find((s) => s.role === 'Defensive Coordinator')
  const oppDcSchemeName = oppDc?.scheme ?? 'Multiple'

  const rng = makeRng(world.seed + world.season * 8161 + world.week * 131 + hash32(career.teamId, 7))

  const out: CoordinatorAdvice[] = []

  // ── Offense: the OC reads their defense ─────────────────────────────────────
  const oc = coordinator(world, career.teamId, 'off')
  if (oc) {
    const rating = oc.rating ?? 70
    const confidence = confidenceFor(rating)
    const genericP = rating >= 70 ? 0 : clamp((70 - rating) / 45, 0, 0.55)
    let presetId = BALANCED_OFF
    let reason = ''
    if (rng() < genericP) {
      reason = 'I do not have a strong read on this one. Stay balanced and take what they give us.'
    } else if (oppDcSchemeName === 'Blitz Heavy') {
      presetId = 'quick-game'
      reason = `They bring pressure (${oppDc?.name ?? 'their DC'} blitzes): get it out fast on rhythm throws.`
    } else if (oppSecondary <= oppDef - 2.5) {
      presetId = 'play-action'
      reason = `Their secondary is the weak spot (DBs ${oppSecondary.toFixed(0)} vs a ${oppDef.toFixed(0)} defense): play-action should open the deep ball.`
    } else if (oppDl >= oppDef + 2.5) {
      presetId = 'quick-game'
      reason = myOl < 78
        ? `Their front (${oppDl.toFixed(0)}) outmatches our line (${myOl.toFixed(0)}): quick throws, ball out before the rush gets home.`
        : `They can rush the passer (DL ${oppDl.toFixed(0)}): quick throws keep us out of third-and-long.`
    } else if (oppPassRate <= 0.5) {
      reason = 'They want to shorten the game with the run. Stay balanced and make our possessions count.'
    } else {
      reason = `Nothing jumps off the tape (their defense is ${oppDef.toFixed(0)}). Stay balanced.`
    }
    out.push({ side: 'off', coach: labels.oc, presetId, reason, confidence })
  }

  // ── Defense: the DC reads their offense ─────────────────────────────────────
  const dc = coordinator(world, career.teamId, 'def')
  if (dc) {
    const rating = dc.rating ?? 70
    const confidence = confidenceFor(rating)
    const genericP = rating >= 70 ? 0 : clamp((70 - rating) / 45, 0, 0.55)
    let presetId = BALANCED_DEF
    let reason = ''
    if (rng() < genericP) {
      reason = 'I do not have a strong read on this one. Stay balanced and trust the front.'
    } else if (oppPassRate >= 0.6) {
      presetId = 'two-high'
      reason = `They throw it all over the yard (${oppOff.toFixed(0)} offense): two deep safeties keep the lid on.`
    } else if (oppPassRate <= 0.48) {
      presetId = 'stack-box'
      reason = `They are run-first (${oppOff.toFixed(0)} offense): load the box and make them throw.`
    } else if (oppOl <= 75.5) {
      presetId = myDl >= oppOl + 3 ? 'blitz' : 'fire-zone'
      reason = `Their line (OL ${oppOl.toFixed(0)}) is vulnerable: send pressure and get home.`
    } else if (oppRb >= oppOff + 4) {
      presetId = 'stack-box'
      reason = `Their back is their best weapon (RB ${oppRb.toFixed(0)}): put an extra man in the box and make the QB beat us.`
    } else {
      reason = `They are balanced (${oppOff.toFixed(0)} offense). Nothing to overplay — stay multiple.`
    }
    out.push({ side: 'def', coach: labels.dc, presetId, reason, confidence })
  }

  return out
}

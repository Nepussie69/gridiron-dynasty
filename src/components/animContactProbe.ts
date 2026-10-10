// ─────────────────────────────────────────────────────────────────────────────
// Visible catch / tackle contact and full special-teams unit audit
// (backlog 128–129, request 133).
//
// Independent of the animation implementation: it rebuilds each real play's
// animation and measures, from the finished keyframes only,
//   • whether the ball meets the real catcher (≤ 0.25 yd) at the holder change,
//   • whether an eligible opposing actor is within 1 yd of the carrier at the
//     terminal contact and arrives within 0.5 s of the carrier stopping,
//   • that every recorded end spot is reproduced exactly,
//   • the largest frame-to-frame movement delta across all dots,
//   • request 133: that a kickoff or punt fields two full 11-man units (22
//     distinct, correctly-clubbed players including the real returner and the
//     real kicker/punter), that the return blockers physically meet their cover
//     defenders (proximity with overlapping arrival and a near-zero relative
//     speed — a real engagement, not a clip-through), and that the coverage
//     moves and converges on the returner's line.
// Kick returns, punt returns and completed passes are reported separately, and
// the excluded outcomes (TD, out of bounds, fair catch, downed, touchback,
// incomplete, interception, fumble) are counted rather than audited. Pure: no
// React, no DOM.
// ─────────────────────────────────────────────────────────────────────────────

import type { World } from '../game/engine/generate'
import { simulatePlayByPlay, type Play } from '../game/engine/playsim'
import { depthGroup } from '../game/engine/depth'
import { buildPlayAnim, posAt, targetKey, changeSpot, type PlayAnim } from './playAnim'
import { actorPlayers } from './jersey'

const clampX = (x: number) => Math.max(1, Math.min(119, x))
const FRAME = 1 / 60
const CATCH_TOL = 0.25
const CONTACT_TOL = 1.0
const ARRIVE_WINDOW = 0.5
const DEF_KEYS = ['dl0', 'dl1', 'dl2', 'dl3', 'lb0', 'lb1', 'lb2', 'cb0', 'cb1', 's0', 's1']
const OFF_KEYS = ['ol0', 'ol1', 'ol2', 'ol3', 'ol4', 'qb', 'rb', 'wr0', 'wr1', 'wr2', 'te']
const PUNT_COV = OFF_KEYS
// Request 133 thresholds: a block is a real engagement when the two actors get
// within a yard and a half while moving at nearly the same velocity.
const BLOCK_TOL = 1.5
const REL_TOL = 2.0
const MIN_ENGAGED = 6
const MOVE_MIN = 6
const CONVERGE_TOL = 12

interface Cat {
  n: number
  catchOk: number
  catchMiss: number
  endOk: number
  contactOk: number
  contactMiss: number
  fallback: number
  credited: number
  worstCatch: number
  worstContact: number
  worstGap: number
  gaps: number[]
}

const blank = (): Cat => ({
  n: 0, catchOk: 0, catchMiss: 0, endOk: 0, contactOk: 0, contactMiss: 0,
  fallback: 0, credited: 0, worstCatch: 0, worstContact: 0, worstGap: 0, gaps: [],
})

/** One kickoff/punt play's special-teams-unit measurements. */
interface UnitPlay {
  actors22: boolean
  distinct22: boolean
  clubOk: boolean
  returnerOk: boolean
  specialistOk: boolean
  specialistExpected: boolean
  engaged: number
  minBlockDist: number
  coverageMoved: number
  converge: number
}

export interface UnitAudit {
  n: number
  actors22: number
  distinct22: number
  clubOk: number
  returnerOk: number
  specialistOk: number
  specialistExpected: number
  blockPlays: number
  blocksTotal: number
  blocksMin: number
  blockedCounts: number[]
  coverageMoved: number
  coverageTotal: number
  converge: number
  convergeTotal: number
  worstBlockDist: number
}

const blankUnit = (): UnitAudit => ({
  n: 0, actors22: 0, distinct22: 0, clubOk: 0, returnerOk: 0, specialistOk: 0, specialistExpected: 0,
  blockPlays: 0, blocksTotal: 0, blocksMin: Infinity, blockedCounts: [], coverageMoved: 0,
  coverageTotal: 0, converge: 0, convergeTotal: 0, worstBlockDist: 0,
})

/** Earliest normalised time the path reaches (within eps of) its final point. */
function stopTime(path: { t: number; x: number; y: number }[]): number {
  if (!path.length) return 1
  const last = path[path.length - 1]
  for (const w of path) if (Math.hypot(w.x - last.x, w.y - last.y) < 0.05) return w.t
  return last.t
}

/** Nearest eligible actor to `target` at time t. */
function nearest(anim: PlayAnim, keys: string[], target: { x: number; y: number }, t: number) {
  let key: string | null = null
  let bd = Infinity
  for (const k of keys) {
    const a = anim.actors.find((x) => x.key === k)
    if (!a) continue
    const p = posAt(a.path, t)
    const d = Math.hypot(p.x - target.x, p.y - target.y)
    if (d < bd) { bd = d; key = k }
  }
  return { key, d: bd }
}

/** Total path length of an actor (yd). */
function pathLength(path: { x: number; y: number }[]): number {
  let s = 0
  for (let i = 1; i < path.length; i++) s += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
  return s
}

/** Largest frame-to-frame movement delta (yd/s) across every dot. */
function frameDelta(anim: PlayAnim): number {
  let maxDelta = 0
  const frames = Math.max(2, Math.round(anim.duration / 1000 / FRAME))
  for (const a of anim.actors) {
    let prev = posAt(a.path, 0)
    let prevV = 0
    for (let k = 1; k <= frames; k++) {
      const p = posAt(a.path, k / frames)
      const v = Math.hypot(p.x - prev.x, p.y - prev.y) / FRAME
      if (k > 1) maxDelta = Math.max(maxDelta, Math.abs(v - prevV))
      prev = p
      prevV = v
    }
  }
  return maxDelta
}

/**
 * Audit one kickoff/punt play's two special-teams units. `retKeys`/`covKeys`
 * are the return/coverage dots; `retClub`/`covClub` the clubs they must belong
 * to. Blocking is measured between every coverage dot and every return blocker
 * over 150 samples: an engagement is a closest approach within BLOCK_TOL with a
 * relative speed under REL_TOL (they arrive together and stay engaged, rather
 * than one clipping through the other at speed).
 */
function auditUnit(
  anim: PlayAnim,
  actors: Map<string, { id: string }>,
  retKey: string,
  retKeys: string[],
  covKeys: string[],
  returnerId: string | undefined,
  specialistId: string | undefined,
  clubOf: (id: string) => string | undefined,
  retClub: string,
  covClub: string,
): UnitPlay {
  const offP = retKeys.map((k) => actors.get(k))
  const defP = covKeys.map((k) => actors.get(k))
  const actors22 = offP.every(Boolean) && defP.every(Boolean) && offP.length === 11 && defP.length === 11
  const ids = [...offP, ...defP].filter(Boolean).map((p) => p!.id)
  const distinct22 = new Set(ids).size === 22 && ids.length === 22
  const clubOk = [
    ...retKeys.map((k) => actors.get(k)?.id),
    ...covKeys.map((k) => actors.get(k)?.id),
  ].every((id, i) => (i < 11 ? clubOf(id!) === retClub : clubOf(id!) === covClub))
  const returnerOk = !!returnerId && actors.get(retKey)?.id === returnerId
  const specialistExpected = !!specialistId
  const specialistOk = !!specialistId && covKeys.some((k) => actors.get(k)?.id === specialistId)

  const blockers = retKeys.filter((k) => k !== retKey)
  const samples = 150
  const dur = Math.max(1, anim.duration / 1000)
  const pos = new Map<string, { x: number; y: number }[]>()
  for (const k of [...blockers, ...covKeys]) {
    const a = anim.actors.find((x) => x.key === k)
    const arr: { x: number; y: number }[] = []
    for (let s = 0; s <= samples; s++) arr.push(posAt(a!.path, s / samples))
    pos.set(k, arr)
  }
  const speed = (arr: { x: number; y: number }[], s: number) => {
    const a = arr[Math.max(0, s - 1)]
    const b = arr[s]
    return { x: (b.x - a.x) / (dur / samples), y: (b.y - a.y) / (dur / samples) }
  }
  let engaged = 0
  let worst = Infinity
  for (const c of covKeys) {
    const ca = pos.get(c)!
    let best = Infinity
    let isEngaged = false
    for (const b of blockers) {
      const ba = pos.get(b)!
      for (let s = 1; s < samples; s++) {
        const d = Math.hypot(ca[s].x - ba[s].x, ca[s].y - ba[s].y)
        if (d < best) best = d
        if (d <= BLOCK_TOL) {
          const cv = speed(ca, s)
          const bv = speed(ba, s)
          const rel = Math.hypot(cv.x - bv.x, cv.y - bv.y)
          // Proximity *and* overlapping arrival: the two are engaged at the
          // same place and time, moving together (near-zero relative speed),
          // rather than one clipping through the other at speed.
          if (rel <= REL_TOL) isEngaged = true
        }
      }
    }
    worst = Math.min(worst, best)
    if (isEngaged) engaged++
  }

  let coverageMoved = 0
  let converge = 0
  const rf = posAt(anim.actors.find((a) => a.key === retKey)!.path, 1)
  for (const c of covKeys) {
    const a = anim.actors.find((x) => x.key === c)!
    if (pathLength(a.path) > MOVE_MIN) coverageMoved++
    const e = posAt(a.path, 1)
    if (Math.hypot(e.x - rf.x, e.y - rf.y) <= CONVERGE_TOL) converge++
  }
  return { actors22, distinct22, clubOk, returnerOk, specialistOk, specialistExpected, engaged, minBlockDist: worst, coverageMoved, converge }
}

function mergeUnit(u: UnitAudit, p: UnitPlay): void {
  u.n++
  if (p.actors22) u.actors22++
  if (p.distinct22) u.distinct22++
  if (p.clubOk) u.clubOk++
  if (p.returnerOk) u.returnerOk++
  if (p.specialistExpected) u.specialistExpected++
  if (p.specialistOk) u.specialistOk++
  if (p.engaged >= MIN_ENGAGED) u.blockPlays++
  u.blocksTotal += p.engaged
  u.blocksMin = Math.min(u.blocksMin, p.engaged)
  u.blockedCounts.push(p.engaged)
  u.coverageMoved += p.coverageMoved
  u.coverageTotal += 11
  u.converge += p.converge
  u.convergeTotal += 11
  u.worstBlockDist = Math.max(u.worstBlockDist, p.minBlockDist === Infinity ? 0 : p.minBlockDist)
}

export interface ContactAudit {
  games: number
  kickReturn: Cat
  puntReturn: Cat
  passCatch: Cat
  kickUnit: UnitAudit
  puntUnit: UnitAudit
  exclusions: Record<string, number>
  maxFrameDelta: number
  endSpots: { match: number; total: number }
  /** Kickoff fumbles: ball-step continuity and ball→recovery-actor gap at the change. */
  fumbles: { n: number; ballJumpMax: number; holderGapMax: number }
}

export function animContactAudit(world: World, games = 20, seeds?: number[]): ContactAudit {
  const nfl = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
  const byId = new Map(world.players.map((p) => [p.id, p]))
  const clubOf = (id: string) => world.players.find((p) => p.id === id)?.teamId ?? undefined
  const kickReturn = blank()
  const puntReturn = blank()
  const passCatch = blank()
  const kickUnit = blankUnit()
  const puntUnit = blankUnit()
  const exclusions: Record<string, number> = { td: 0, oob: 0, fairCatch: 0, downed: 0, touchback: 0, incomplete: 0, interception: 0, fumble: 0 }
  let maxFrame = 0
  let endMatch = 0
  let endTotal = 0
  const fumbles = { n: 0, ballJumpMax: 0, holderGapMax: 0 }
  const done = new Set<number>()

  const audit = (
    cat: Cat,
    anim: PlayAnim,
    carrierKey: string,
    oppKeys: string[],
    wantX: number,
    credited: boolean,
    td: boolean,
    oob: boolean,
    puntTD = false,
  ) => {
    cat.n++
    const carrier = anim.actors.find((a) => a.key === carrierKey)
    if (!carrier) { cat.contactMiss++; return }
    const final = posAt(carrier.path, 1)
    const carrierStop = stopTime(carrier.path)
    // Catch: the ball must meet the carrier's dot at the holder change.
    const catchEntry = anim.holders.find((h) => h.key === carrierKey)
    if (catchEntry) {
      const bp = posAt(anim.ball, catchEntry.t)
      const cp = posAt(carrier.path, catchEntry.t)
      const d = Math.hypot(bp.x - cp.x, bp.y - cp.y)
      cat.worstCatch = Math.max(cat.worstCatch, d)
      if (d <= CATCH_TOL) cat.catchOk++
      else cat.catchMiss++
    }
    // End spot. A touchdown may finish anywhere on/past the goal line.
    endTotal++
    const endOk = Math.abs(final.x - wantX) < 1e-3 || (td && final.x >= wantX - 1e-3) || (puntTD && final.x <= 10 + 1e-3)
    if (endOk) { endMatch++; cat.endOk++ }
    if (td || oob) return
    // Contact: an eligible actor must be within 1 yd of the carrier's recorded
    // final spot while his arrival overlaps the carrier's stop (the window).
    let bestD = Infinity
    let bestOff = 0
    const steps = 40
    for (let s = -ARRIVE_WINDOW; s <= ARRIVE_WINDOW + 1e-9; s += (ARRIVE_WINDOW * 2) / steps) {
      const t = Math.max(0, Math.min(1, carrierStop + s))
      const d = nearest(anim, oppKeys, final, t).d
      if (d < bestD) { bestD = d; bestOff = s }
    }
    cat.worstContact = Math.max(cat.worstContact, bestD)
    if (bestD <= CONTACT_TOL) {
      cat.contactOk++
      cat.gaps.push(bestOff)
      cat.worstGap = Math.max(cat.worstGap, Math.abs(bestOff))
    } else cat.contactMiss++
    if (credited) cat.credited++
    else cat.fallback++
  }

  for (let g = 0; g < games; g++) {
    const home = nfl[g % nfl.length]
    const away = nfl[(g + 1) % nfl.length]
    if (!home || !away || home.id === away.id) continue
    const seed = seeds?.[g] ?? world.seed + g * 7919 + 13
    if (done.has(seed)) continue
    done.add(seed)
    const sim = simulatePlayByPlay(world, home.id, away.id, seed)
    for (let i = 0; i < sim.plays.length; i++) {
      const play = sim.plays[i] as Play
      const next = sim.plays[i + 1] as Play | undefined
      const specialDef = play.offId === home.id ? away.id : home.id
      if (play.type === 'kickoff' && play.returnerId) {
        if (play.returnKind === 'touchback') { exclusions.touchback++; continue }
        const actors = actorPlayers(world, play, specialDef, null)
        const anim = buildPlayAnim(play, { next, actors })
        maxFrame = Math.max(maxFrame, frameDelta(anim))
        if (play.turnover) {
          exclusions.fumble++
          // The loose ball must not jump: its per-frame step stays small and the
          // recovery actor is on the ball when the holder changes to him.
          fumbles.n++
          const frames = Math.max(2, Math.round(anim.duration / 1000 / FRAME))
          let prev = posAt(anim.ball, 0)
          for (let k = 1; k <= frames; k++) {
            const p = posAt(anim.ball, k / frames)
            fumbles.ballJumpMax = Math.max(fumbles.ballJumpMax, Math.hypot(p.x - prev.x, p.y - prev.y))
            prev = p
          }
          const rec = [...anim.holders].reverse().find((h) => h.key && h.key !== 'rb')
          const recActor = rec?.key ? anim.actors.find((a) => a.key === rec.key) : undefined
          if (rec && recActor) {
            const bp = posAt(anim.ball, rec.t)
            const ap = posAt(recActor.path, rec.t)
            fumbles.holderGapMax = Math.max(fumbles.holderGapMax, Math.hypot(bp.x - ap.x, bp.y - ap.y))
          }
          continue
        }
        const spec = depthGroup(world, specialDef, ['K'], 1)[0]
        mergeUnit(kickUnit, auditUnit(anim, actors, 'rb', OFF_KEYS, DEF_KEYS, play.returnerId, spec?.id, clubOf, play.offId, specialDef))
        if (play.returnTD) exclusions.td++
        audit(kickReturn, anim, 'rb', DEF_KEYS, clampX(10 + play.endYard), false, !!play.returnTD, false)
        continue
      }
      if (play.type === 'punt') {
        if (play.returnKind === 'fairCatch') { exclusions.fairCatch++; continue }
        if (play.returnKind === 'downed') { exclusions.downed++; continue }
        if (play.returnKind === 'touchback') { exclusions.touchback++; continue }
        if (play.returnKind === 'muff') { exclusions.fumble++; continue }
        if (play.returnKind !== 'return' || !play.returnerId) continue
        const actors = actorPlayers(world, play, specialDef, null)
        const anim = buildPlayAnim(play, { next, actors })
        maxFrame = Math.max(maxFrame, frameDelta(anim))
        const spec = depthGroup(world, play.offId, ['P'], 1)[0]
        mergeUnit(puntUnit, auditUnit(anim, actors, 's0', DEF_KEYS, PUNT_COV, play.returnerId, spec?.id, clubOf, specialDef, play.offId))
        if (play.returnTD) exclusions.td++
        const want = play.returnTD ? 10 : clampX(changeSpot(play, next) ?? 10 + play.startYard + play.yards)
        audit(puntReturn, anim, 's0', PUNT_COV, want, false, !!play.returnTD, false, !!play.returnTD)
        continue
      }
      if (play.type !== 'pass') continue
      if (play.result.startsWith('Sack')) continue
      if (play.result.startsWith('Incomplete')) { exclusions.incomplete++; continue }
      if (play.result.startsWith('Interception')) { exclusions.interception++; continue }
      if (play.turnover) { exclusions.fumble++; continue }
      const defId = play.offId === home.id ? away.id : home.id
      const tKey = play.targetId ? targetKey(play, { targetPos: byId.get(play.targetId)?.pos }) : null
      if (!tKey) continue
      const actors = actorPlayers(world, play, defId, tKey)
      const anim = buildPlayAnim(play, { next, targetPos: play.targetId ? byId.get(play.targetId)?.pos : undefined, actors })
      maxFrame = Math.max(maxFrame, frameDelta(anim))
      if (play.outOfBounds) exclusions.oob++
      if (play.endYard >= 100) exclusions.td++
      const creditId = play.tackleIds?.[0]
      const credited = !!creditId && DEF_KEYS.some((k) => actors.get(k)?.id === creditId)
      audit(passCatch, anim, tKey, DEF_KEYS, clampX(10 + play.endYard), credited, play.endYard >= 100, !!play.outOfBounds)
    }
  }

  return {
    games,
    kickReturn,
    puntReturn,
    passCatch,
    kickUnit,
    puntUnit,
    exclusions,
    maxFrameDelta: +maxFrame.toFixed(3),
    endSpots: { match: endMatch, total: endTotal },
    fumbles: { n: fumbles.n, ballJumpMax: +fumbles.ballJumpMax.toFixed(3), holderGapMax: +fumbles.holderGapMax.toFixed(3) },
  }
}

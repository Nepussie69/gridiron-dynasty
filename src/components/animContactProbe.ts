// ─────────────────────────────────────────────────────────────────────────────
// Visible catch / tackle contact audit (backlog 128–129).
//
// Independent of the animation implementation: it rebuilds each real play's
// animation and measures, from the finished keyframes only,
//   • whether the ball meets the real catcher (≤ 0.25 yd) at the holder change,
//   • whether an eligible opposing actor is within 1 yd of the carrier at the
//     terminal contact and arrives within 0.5 s of the carrier stopping,
//   • that every recorded end spot is reproduced exactly,
//   • the largest frame-to-frame movement delta across all dots.
// Kick returns, punt returns and completed passes are reported separately, and
// the excluded outcomes (TD, out of bounds, fair catch, downed, touchback,
// incomplete) are counted rather than audited. Pure: no React, no DOM.
// ─────────────────────────────────────────────────────────────────────────────

import type { World } from '../game/engine/generate'
import { simulatePlayByPlay, type Play } from '../game/engine/playsim'
import { buildPlayAnim, posAt, targetKey, changeSpot, type PlayAnim } from './playAnim'
import { actorPlayers } from './jersey'

const clampX = (x: number) => Math.max(1, Math.min(119, x))
const FRAME = 1 / 60
const CATCH_TOL = 0.25
const CONTACT_TOL = 1.0
const ARRIVE_WINDOW = 0.5
const DEF_KEYS = ['dl0', 'dl1', 'dl2', 'dl3', 'lb0', 'lb1', 'lb2', 'cb0', 'cb1', 's0', 's1']
const PUNT_COV = ['ol0', 'ol1', 'ol2', 'ol3', 'ol4', 'qb', 'rb', 'wr0', 'wr1', 'wr2', 'te']

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

export interface ContactAudit {
  games: number
  kickReturn: Cat
  puntReturn: Cat
  passCatch: Cat
  exclusions: Record<string, number>
  maxFrameDelta: number
  endSpots: { match: number; total: number }
}

export function animContactAudit(world: World, games = 20, seeds?: number[]): ContactAudit {
  const nfl = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
  const byId = new Map(world.players.map((p) => [p.id, p]))
  const kickReturn = blank()
  const puntReturn = blank()
  const passCatch = blank()
  const exclusions: Record<string, number> = { td: 0, oob: 0, fairCatch: 0, downed: 0, touchback: 0, incomplete: 0, interception: 0, fumble: 0 }
  let maxFrame = 0
  let endMatch = 0
  let endTotal = 0
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
        if (play.turnover) { exclusions.fumble++; continue }
        const actors = actorPlayers(world, play, specialDef, null)
        const anim = buildPlayAnim(play, { next, actors })
        maxFrame = Math.max(maxFrame, frameDelta(anim))
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

  return { games, kickReturn, puntReturn, passCatch, exclusions, maxFrameDelta: +maxFrame.toFixed(3), endSpots: { match: endMatch, total: endTotal } }
}

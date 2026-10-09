// ─────────────────────────────────────────────────────────────────────────────
// Animation probe (L12.10 B5).
//
// Measures, over a run of simulated plays, that the animation is rating-driven
// and never distorts the sim's result:
//   • per play type, the carrier's / target's top speed vs his SPD,
//   • the largest frame-to-frame speed change across all 22 dots,
//   • that every recorded end spot is reproduced exactly.
// Pure: no React, no DOM, so the offline verification script can import it.
// ─────────────────────────────────────────────────────────────────────────────

import type { World } from './generate'
import { simulatePlayByPlay, type Play } from './playsim'
import { buildPlayAnim, changeSpot, posAt, targetKey, attrOf, type PlayAnim, type AnimContext } from '../../components/playAnim'
import { actorPlayers } from '../../components/jersey'
import type { Player } from '../types'

const clampX = (x: number) => Math.max(1, Math.min(119, x))
const FRAME = 1 / 60

/** Top speed per dot and the largest frame-to-frame speed change (yd/s). */
function measure(anim: PlayAnim) {
  const top: Record<string, number> = {}
  let maxDelta = 0
  for (const a of anim.actors) {
    const frames = Math.max(2, Math.round(anim.duration / 1000 / FRAME))
    let prev = posAt(a.path, 0)
    let prevV = 0
    let t = 0
    for (let k = 1; k <= frames; k++) {
      const p = posAt(a.path, k / frames)
      const v = Math.hypot(p.x - prev.x, p.y - prev.y) / FRAME
      if (k > 1) maxDelta = Math.max(maxDelta, Math.abs(v - prevV))
      t = Math.max(t, v)
      prev = p
      prevV = v
    }
    top[a.key] = t
  }
  return { top, maxDelta }
}

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const quantile = (a: number[], f: number) => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * f)))]
}

interface Sample { type: 'run' | 'pass'; spd: number; top: number }

/** A clone of a player with SPD/ACC forced to `spd`, to isolate the pace formula. */
function withSpeed(p: Player | undefined, spd: number): Player {
  const base = (p ?? ({} as Player)) as Player
  return { ...base, attrs: { ...(base.attrs ?? {}), SPD: spd, ACC: spd } }
}

/**
 * Run `games` simulated games and report the animation's rating behaviour and
 * end-spot fidelity. `seeds` can be supplied for reproducibility.
 */
export function animProbe(world: World, games = 2, seeds?: number[]) {
  const nfl = world.teams.filter((t) => t.tier === 'NFL' && (world.roster[t.id]?.length ?? 0) > 0)
  if (nfl.length < 2) return { error: 'no NFL teams' }
  const byId = new Map(world.players.map((p) => [p.id, p]))
  let plays = 0
  let endMatch = 0
  let endTotal = 0
  let maxDelta = 0
  const samples: Sample[] = []
  interface Case { play: Play; defId: string; key: string; ctx: AnimContext; actors: Map<string, Player> }
  let runCase: Case | null = null
  let passCase: Case | null = null
  const done = new Set<number>()
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
      const specialDef = play.offId === home.id ? away.id : home.id
      // R6: the real returner catches and returns to the recorded end spot.
      if ((play.type === 'kickoff' || play.type === 'punt') && play.returnKind === 'return' && play.returnerId) {
        const actors = actorPlayers(world, play, specialDef, null)
        const anim = buildPlayAnim(play, { next: sim.plays[i + 1], actors })
        const key = play.type === 'kickoff' ? 'rb' : 's0'
        const want = play.type === 'kickoff'
          ? clampX(10 + play.endYard)
          : play.returnTD
            ? 110
            : clampX(changeSpot(play, sim.plays[i + 1]) ?? 10 + play.startYard + play.yards)
        const path = anim.actors.find((a) => a.key === key)?.path
        const got = path ? posAt(path, 1).x : NaN
        endTotal++
        if (Math.abs(got - want) < 1e-3) endMatch++
        plays++
        continue
      }
      if (play.type !== 'run' && play.type !== 'pass') continue
      if (play.type === 'pass' && play.result.startsWith('Sack')) continue
      const defId = play.offId === home.id ? away.id : home.id
      const ctx = {
        next: sim.plays[i + 1],
        targetPos: play.targetId ? byId.get(play.targetId)?.pos : undefined,
        carrierIsQB: play.type === 'run' && !!play.carrierId && byId.get(play.carrierId)?.pos === 'QB',
      }
      const tKey = play.type === 'pass' && play.targetId ? targetKey(play, ctx) : null
      const actors = actorPlayers(world, play, defId, tKey)
      const anim = buildPlayAnim(play, { ...ctx, actors })
      const { top, maxDelta: md } = measure(anim)
      maxDelta = Math.max(maxDelta, md)
      const key = play.type === 'run' ? (ctx.carrierIsQB ? 'qb' : 'rb') : (tKey ?? 'wr0')
      const spd = attrOf(actors.get(key), 'SPD')
      const ts = top[key] ?? 0
      if (ts > 0) samples.push({ type: play.type, spd, top: ts })
      if (!runCase && play.type === 'run' && play.yards > 6) runCase = { play, defId, key, ctx, actors }
      if (!passCase && play.type === 'pass' && !play.turnover && !play.result.startsWith('Incomplete') && !play.result.startsWith('Interception')) {
        passCase = { play, defId, key, ctx, actors }
      }
      const completed = play.type === 'run' ||
        (!play.turnover && !play.result.startsWith('Incomplete') && !play.result.startsWith('Interception'))
      if (completed) {
        const want = clampX(10 + play.endYard)
        const path = anim.actors.find((a) => a.key === key)?.path
        const got = path ? posAt(path, 1).x : NaN
        endTotal++
        // A touchdown may finish anywhere in the end zone (caught there, not walked back).
        if (Math.abs(got - want) < 1e-3 || (want >= 110 && got >= want)) endMatch++
      }
      plays++
    }
  }

  const row = (type: 'run' | 'pass') => {
    const s = samples.filter((x) => x.type === type)
    const spds = s.map((x) => x.spd)
    const lo = quantile(spds, 0.25)
    const hi = quantile(spds, 0.75)
    const hiTop = avg(s.filter((x) => x.spd >= hi).map((x) => x.top))
    const loTop = avg(s.filter((x) => x.spd <= lo).map((x) => x.top))
    return {
      n: s.length,
      avgSPD: +avg(spds).toFixed(1),
      avgTop: +avg(s.map((x) => x.top)).toFixed(2),
      hiSPD: +avg(s.filter((x) => x.spd >= hi).map((x) => x.spd)).toFixed(1),
      loSPD: +avg(s.filter((x) => x.spd <= lo).map((x) => x.spd)).toFixed(1),
      hiTop: +hiTop.toFixed(2),
      loTop: +loTop.toFixed(2),
      ratio: +(loTop > 0 ? hiTop / loTop : 0).toFixed(2),
    }
  }

  // Synthetic pace check: force the agent's SPD/ACC to 95 then 70 on the same
  // recorded play and compare his top speed (the acceptance ratio).
  const synth = (c: Case | null) => {
    if (!c) return null
    const out: Record<string, number> = {}
    for (const spd of [95, 70]) {
      const map = new Map(c.actors)
      map.set(c.key, withSpeed(c.actors.get(c.key), spd))
      const a = buildPlayAnim(c.play, { ...c.ctx, actors: map })
      out[spd] = +(measure(a).top[c.key] ?? 0).toFixed(2)
    }
    return { spd95: out[95], spd70: out[70], ratio: +(out[70] > 0 ? out[95] / out[70] : 0).toFixed(2) }
  }

  return {
    plays,
    maxFrameDelta: +maxDelta.toFixed(3),
    endSpot: { match: endMatch, total: endTotal },
    run: row('run'),
    pass: row('pass'),
    synthetic: { run: synth(runCase), pass: synth(passCase) },
  }
}

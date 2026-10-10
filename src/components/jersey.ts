// ─────────────────────────────────────────────────────────────────────────────
// Jersey numbers for the game-day field, and which real player each animated
// dot stands for.
//
// The data carries no jersey numbers, so each player gets a stable one from his
// position's usual NFL range (a hash of his id picks the preferred number; a
// clash moves to the next free one). Purely visual — nothing is saved and the
// sim never reads it.
// ─────────────────────────────────────────────────────────────────────────────

import type { World } from '../game/engine/generate'
import type { Play } from '../game/engine/playsim'
import { depthAt, depthGroup } from '../game/engine/depth'
import { hash32 } from '../game/engine/rng'
import type { Player, Position } from '../game/types'

const RANGES: Record<Position, [number, number][]> = {
  QB: [[1, 19]],
  K: [[1, 19]],
  P: [[1, 19]],
  RB: [[20, 49], [1, 19]],
  FB: [[20, 49], [40, 49]],
  WR: [[10, 19], [80, 89], [1, 9]],
  TE: [[80, 89], [40, 49]],
  OT: [[60, 79], [50, 59]],
  OG: [[60, 79], [50, 59]],
  C: [[50, 79]],
  DE: [[90, 99], [50, 59], [40, 49]],
  DT: [[90, 99], [50, 79]],
  LB: [[40, 59], [90, 99]],
  CB: [[20, 39], [1, 19]],
  S: [[20, 49], [1, 19]],
}

/** Stable jersey numbers for one club's roster (player id → number). */
export function teamJerseys(world: World, teamId: string): Map<string, number> {
  const out = new Map<string, number>()
  const taken = new Set<number>()
  const roster = [...(world.roster[teamId] ?? [])].sort((a, b) => (b.ovr - a.ovr) || (a.id < b.id ? -1 : 1))
  for (const p of roster) {
    const ranges = RANGES[p.pos] ?? [[1, 99]]
    const nums = ranges.flatMap(([lo, hi]) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i))
    const [lo, hi] = ranges[0]
    const start = (hash32(p.id, 7) >>> 0) % (hi - lo + 1)
    let pick: number | undefined
    for (let i = 0; i < nums.length; i++) {
      const n = nums[(start + i) % nums.length]
      if (!taken.has(n)) {
        pick = n
        break
      }
    }
    if (pick !== undefined) {
      taken.add(pick)
      out.set(p.id, pick)
    }
  }
  return out
}

// ── request 133: full special-teams units ───────────────────────────────────
/** Where a coverage unit's players come from — gunners and back-end tacklers. */
const COVER_POS: Position[] = ['LB', 'S', 'CB', 'TE', 'RB', 'FB', 'WR', 'DE', 'DT', 'OT', 'OG', 'C']
/** Where a return unit's blockers come from — big bodies and athletes. */
const RETURN_POS: Position[] = ['FB', 'TE', 'LB', 'RB', 'OT', 'OG', 'C', 'S', 'CB', 'WR', 'DE', 'DT']

/**
 * A plausible healthy 11-man special-teams unit for one club: the specialist
 * (the real returner, or the kicking side's kicker/punter) is included by id;
 * the rest are healthy backups drawn from the positions that actually play the
 * unit, then healthy starters, then an injured body as a last resort — all
 * distinct. Returns fewer than 11 only if the club cannot field them.
 */
function stUnit(world: World, teamId: string, role: 'coverage' | 'return', specialistId?: string): Player[] {
  const out: Player[] = []
  const used = new Set<string>()
  const add = (p: Player | undefined) => {
    if (p && !used.has(p.id) && out.length < 11) {
      used.add(p.id)
      out.push(p)
    }
  }
  if (specialistId) add(world.players.find((p) => p.id === specialistId))
  const priority = role === 'coverage' ? COVER_POS : RETURN_POS
  const groups = priority.map((pos) => depthAt(world, teamId, pos))
  for (let pass = 0; pass < 3 && out.length < 11; pass++) {
    for (const list of groups) {
      for (let i = 0; i < list.length && out.length < 11; i++) {
        const p = list[i]
        // pass 0: backups only, healthy. pass 1: any healthy. pass 2: anyone.
        if (pass === 0 && (i === 0 || p.injured)) continue
        if (pass === 1 && p.injured) continue
        add(p)
      }
      if (out.length >= 11) break
    }
  }
  return out
}

/**
 * Which real player each animation key (qb, rb, wr0…, dl0…, s1) stands for on
 * this play: the depth chart's starters, with the play's own QB, ball carrier
 * and target moved onto the dots the animation gives them.
 *
 * Request 133: a kickoff or punt animates *both* full 11-man special-teams
 * units, so the returning side (the real returner plus ten blockers) and the
 * kicking side (the real kicker or punter plus ten coverage players) each field
 * eleven distinct, healthy, correctly-clubbed players.
 */
export function actorPlayers(
  world: World,
  play: Play,
  defId: string,
  targetKey: string | null,
): Map<string, Player> {
  const off = play.offId
  const map = new Map<string, Player>()
  const put = (keys: string[], players: Player[]) => keys.forEach((k, i) => players[i] && map.set(k, players[i]))
  const one = (team: string, pos: Position, n: number) => depthGroup(world, team, [pos], n)

  // Request 133: full special-teams units (see stUnit). Placed before the base
  // formation so no starter identity leaks onto a special-teams snap.
  if (play.type === 'kickoff' || play.type === 'punt') {
    const recvId = play.type === 'kickoff' ? off : defId
    const kickId = play.type === 'kickoff' ? defId : off
    const ret = stUnit(world, recvId, 'return', play.returnerId)
    const spec = stUnit(world, kickId, 'coverage', one(kickId, play.type === 'kickoff' ? 'K' : 'P', 1)[0]?.id)
    const offKeys = ['ol0', 'ol1', 'ol2', 'ol3', 'ol4', 'qb', 'rb', 'wr0', 'wr1', 'wr2', 'te']
    const defKeys = ['dl0', 'dl1', 'dl2', 'dl3', 'lb0', 'lb1', 'lb2', 'cb0', 'cb1', 's0', 's1']
    if (play.type === 'kickoff') {
      // Returner on `rb`, ten blockers on the rest of the offense's dots.
      if (ret[0]) map.set('rb', ret[0])
      ret.slice(1, 11).forEach((p, i) => { const k = offKeys.filter((x) => x !== 'rb')[i]; if (k) map.set(k, p) })
      // Kicker on the deep safety dot; ten coverage players across the line.
      spec.slice(1, 11).forEach((p, i) => { const k = defKeys[i]; if (k) map.set(k, p) })
      if (spec[0]) map.set('s1', spec[0])
    } else {
      // Punter on `qb`; ten coverage players across the rest of the punt team.
      if (spec[0]) map.set('qb', spec[0])
      spec.slice(1, 11).forEach((p, i) => { const k = offKeys.filter((x) => x !== 'qb')[i]; if (k) map.set(k, p) })
      // Returner on `s0`; ten blockers on the rest of the receiving dots.
      if (ret[0]) map.set('s0', ret[0])
      ret.slice(1, 11).forEach((p, i) => { const k = defKeys.filter((x) => x !== 's0')[i]; if (k) map.set(k, p) })
    }
    return map
  }

  const ot = one(off, 'OT', 2)
  const og = one(off, 'OG', 2)
  put(['ol0', 'ol1', 'ol2', 'ol3', 'ol4'], [ot[0], og[0], one(off, 'C', 1)[0], og[1], ot[1]])
  put(['qb'], one(off, 'QB', 1))
  put(['rb'], one(off, 'RB', 1))
  put(['wr0', 'wr1', 'wr2'], one(off, 'WR', 3))
  put(['te'], one(off, 'TE', 1))
  const de = one(defId, 'DE', 2)
  const dt = one(defId, 'DT', 2)
  put(['dl0', 'dl1', 'dl2', 'dl3'], [de[0], dt[0], dt[1], de[1]])
  put(['lb0', 'lb1', 'lb2'], one(defId, 'LB', 3))
  put(['cb0', 'cb1'], one(defId, 'CB', 2))
  put(['s0', 's1'], one(defId, 'S', 2))

  // Special teams: the kicker and the holder / punter.
  if (play.type === 'fg' || (play.type === 'pat' && play.concept !== 'Two-point try')) {
    put(['rb'], one(off, 'K', 1))
    put(['qb'], one(off, 'P', 1))
  }

  // Move a specific player onto a key, swapping with whoever had it.
  const place = (key: string, id: string | undefined) => {
    if (!id) return
    const p = world.players.find((x) => x.id === id)
    if (!p) return
    const prevKey = [...map.entries()].find(([, v]) => v.id === id)?.[0]
    const displaced = map.get(key)
    map.set(key, p)
    if (prevKey && prevKey !== key) {
      if (displaced) map.set(prevKey, displaced)
      else map.delete(prevKey)
    }
  }
  if (play.qbId) place('qb', play.qbId)
  if (play.type === 'run' && play.carrierId) {
    const c = world.players.find((x) => x.id === play.carrierId)
    if (c?.pos === 'QB') place('qb', c.id)
    else if (c) place('rb', c.id)
  }
  if (play.type === 'pass' && play.targetId && targetKey) place(targetKey, play.targetId)
  return map
}

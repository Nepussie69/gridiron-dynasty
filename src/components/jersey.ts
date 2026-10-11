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
import { getJ12, j12DefPlan, j12OffPlan, type Play } from '../game/engine/playsim'
import { depthAt, depthGroup } from '../game/engine/depth'
import { hash32 } from '../game/engine/rng'
import { formationForConcept, formationHasFullback } from '../game/data/playbookData'
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
function stUnit(world: World, teamId: string, role: 'coverage' | 'return', specialistId?: string, must: string[] = []): Player[] {
  const out: Player[] = []
  const used = new Set<string>()
  const add = (p: Player | undefined) => {
    if (p && !used.has(p.id) && out.length < 11) {
      used.add(p.id)
      out.push(p)
    }
  }
  if (specialistId) add(world.players.find((p) => p.id === specialistId))
  // animflow r6b: every credited player of this club (tackler, missed tackler,
  // forced fumble, recovery) is in the drawn unit.
  const roster = world.roster[teamId] ?? []
  for (const id of must) add(roster.find((p) => p.id === id))
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
/**
 * animflow r6d (J12): the game plan the sim ran on this snap — the AI's DOUBLE / CHIP of the best
 * rusher and SHADOW of the WR1 / SPY on the QB (j12OffPlan / j12DefPlan are pure hashes of the snap
 * number and the coordinators, so the animation reads the same call the engine made). A user club's
 * own matchup choice (career.matchups) overrides the AI's for that side when the caller passes it.
 */
export interface AnimPlan {
  off?: 'doubleRusher' | 'chipEdge' | 'targetWeakCB'
  def?: 'shadowWR1' | 'spyQB'
}
const ACTOR_PLAN = new WeakMap<Map<string, Player>, AnimPlan>()
/** The J12 plan recorded for an actor map built by actorPlayers (undefined when none). */
export function planOf(actors: Map<string, Player> | undefined): AnimPlan | undefined {
  return actors ? ACTOR_PLAN.get(actors) : undefined
}

export function actorPlayers(
  world: World,
  play: Play,
  defId: string,
  targetKey: string | null,
  user?: { teamId?: string; matchups?: AnimPlan },
): Map<string, Player> {
  const map = actorPlayersRaw(world, play, defId, targetKey)
  if (play.type === 'pass' && !play.spike) {
    try {
      const on = getJ12()
      const userOff = !!user?.teamId && user.teamId === play.offId
      const userDef = !!user?.teamId && user.teamId === defId
      const off = (userOff ? user?.matchups?.off : undefined) ?? (on ? j12OffPlan(world, play.n, play.offId, defId) : undefined)
      const def = (userDef ? user?.matchups?.def : undefined) ?? (on ? j12DefPlan(world, play.n, play.offId, defId) : undefined)
      if (off || def) ACTOR_PLAN.set(map, { off, def })
    } catch {
      // A world without staff / ratings (tests): no plan.
    }
  }
  return map
}

function actorPlayersRaw(
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
    const must = creditedIds(play)
    const ret = stUnit(world, recvId, 'return', play.returnerId, must)
    const spec = stUnit(world, kickId, 'coverage', one(kickId, play.type === 'kickoff' ? 'K' : 'P', 1)[0]?.id, must)
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

  // animflow r6b (ratings audit item 2): the recorded on-field eleven of this
  // snap (fatigue subs, nickel/dime, 12/13/21 personnel, the user's packages),
  // not a fixed depth-chart 11v11. Old saves without it use the depth chart.
  const rec = (globalThis as { __noRec?: boolean }).__noRec ? null : recordedEleven(world, play, defId)
  if (rec) {
    for (const [k, p] of rec) map.set(k, p)
    placeCredited(world, play, map, targetKey)
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

  placeCredited(world, play, map, targetKey)
  return map
}

/** Move the play's QB, ball carrier and target onto the dots the animation gives them. */
function placeCredited(world: World, play: Play, map: Map<string, Player>, targetKey: string | null): void {
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
}

/** Every player a play credits (tackler, coverage man, returner…), for the cast audit. */
export function creditedIds(play: Play): string[] {
  const out = [
    play.qbId, play.carrierId, play.targetId, play.sackId, play.intId, play.coverId, play.fumbleId, play.returnerId,
    play.pressureId, play.tipId, play.dropId, ...(play.tackleIds ?? []), ...(play.missedTackleIds ?? []), ...(play.forcedMissedIds ?? []),
  ]
  return [...new Set(out.filter((x): x is string => !!x))]
}

/** The offence's dots in a formation (FB sets trade the slot for the fullback). */
export function offenseKeys(play: Play): string[] {
  const fb = formationHasFullback(formationForConcept(play.concept))
  return ['ol0', 'ol1', 'ol2', 'ol3', 'ol4', 'qb', 'rb', 'wr0', 'wr1', ...(fb ? ['fb'] : ['wr2']), 'te']
}

const DEF_DOTS = ['dl0', 'dl1', 'dl2', 'dl3', 'lb0', 'lb1', 'lb2', 'cb0', 'cb1', 's0', 's1']

/**
 * The recorded eleven per side mapped onto the animation's dots by position:
 * the natural spot first (OT/OG/C on the line, DE on the edges …), then the
 * nearest equivalent (a 12-personnel second TE in the slot, a nickel corner on
 * a linebacker dot, a 3-4 outside backer on an edge). Null when the play has
 * no recorded personnel.
 */
export function recordedEleven(world: World, play: Play, defId: string): Map<string, Player> | null {
  const offIds = play.onFieldOff
  const defIds = play.onFieldDef
  if (!offIds?.length || !defIds?.length) return null
  if (play.type !== 'run' && play.type !== 'pass') return null
  const byId = (id: string) => (world.roster[play.offId] ?? []).find((p) => p.id === id) ?? (world.roster[defId] ?? []).find((p) => p.id === id) ?? world.players.find((p) => p.id === id)
  const out = new Map<string, Player>()
  const fill = (ids: string[], keys: string[], natural: Partial<Record<Position, string[]>>, pref: Partial<Record<Position, string[]>>) => {
    const ps = ids.map(byId).filter((p): p is Player => !!p)
    const left: Player[] = []
    for (const p of ps) {
      const k = (natural[p.pos] ?? []).find((x) => keys.includes(x) && !out.has(x))
      if (k) out.set(k, p)
      else left.push(p)
    }
    const rest: Player[] = []
    for (const p of left) {
      const k = (pref[p.pos] ?? []).find((x) => keys.includes(x) && !out.has(x))
      if (k) out.set(k, p)
      else rest.push(p)
    }
    for (const p of rest) {
      const k = keys.find((x) => !out.has(x))
      if (k) out.set(k, p)
    }
  }
  fill(offIds, offenseKeys(play), {
    QB: ['qb'], OT: ['ol0', 'ol4'], OG: ['ol1', 'ol3'], C: ['ol2'], RB: ['rb'], FB: ['fb'], TE: ['te'], WR: ['wr0', 'wr1', 'wr2'],
  }, {
    OT: ['ol1', 'ol3', 'ol2', 'te'], OG: ['ol2', 'ol0', 'ol4', 'te'], C: ['ol1', 'ol3'], RB: ['fb', 'wr2', 'te'], FB: ['rb', 'te', 'wr2'],
    TE: ['wr2', 'fb', 'wr1', 'wr0'], WR: ['te', 'fb'], QB: ['wr2'],
  })
  fill(defIds, DEF_DOTS, {
    DE: ['dl0', 'dl3'], DT: ['dl1', 'dl2'], LB: ['lb1', 'lb0', 'lb2'], CB: ['cb0', 'cb1'], S: ['s0', 's1'],
  }, {
    DE: ['dl1', 'dl2', 'lb0', 'lb2'], DT: ['dl0', 'dl3', 'lb1'], LB: ['dl3', 'dl0', 'dl2', 'dl1'], CB: ['lb2', 'lb0', 'lb1', 's1', 's0'], S: ['lb2', 'lb0', 'lb1', 'cb1', 'cb0'],
  })
  return out
}

import type { CareerState, DraftProspect, Player, PlayerOrigin, Position } from '../types'
import { makeRookieContract } from './cap'
import { canDraft } from './career'
import { computeDraftOrder } from './sim'
import { ensureDraftPicks } from './picks'
import { pushLedger } from './ledger'
import { departmentGrade } from './department'
import { convictionPick } from './conviction'
import { redFlagIds } from './redflag'
import { makeCharacter } from './character'
import { type World, indexPlayers } from './generate'
import { clamp, hash32, makeRng } from './rng'

export const DRAFT_ROUNDS = 7
export const DRAFT_TEAMS = 32
export const TOTAL_PICKS = DRAFT_ROUNDS * DRAFT_TEAMS

export function initDraft(world: World) {
  const picks = ensureDraftPicks(world, world.season + 1)
  world.draftPicks = picks
  const built = buildDraftOrder(world)
  world.draftOrder = built.order
  world.draftRounds = built.rounds
  world.draftPickIds = built.ids
  world.draftState = { round: 1, pickIndex: 0, complete: false, log: [] }
  for (const p of world.draft) {
    p.draftedBy = null
    p.draftPick = null
  }
}

/**
 * Build the round-by-round selection order from pick ownership. Original slots
 * order the board (worst record first); traded picks keep their original slot
 * but belong to their new owner; comp picks go last in their round.
 */
export function buildDraftOrder(world: World): { order: string[]; rounds: number[]; ids: string[] } {
  const upcoming = world.season + 1
  const picks = ensureDraftPicks(world, upcoming)
  const base = computeDraftOrder(world)
  const slot = new Map(base.map((id, i) => [id, i]))
  const order: string[] = []
  const rounds: number[] = []
  const ids: string[] = []
  for (let r = 1; r <= DRAFT_ROUNDS; r++) {
    const group = picks
      .filter((p) => p.season === upcoming && p.round === r)
      .sort((a, b) => {
        const ac = a.comp ? 1 : 0
        const bc = b.comp ? 1 : 0
        if (ac !== bc) return ac - bc
        return (slot.get(a.originalTeam) ?? 99) - (slot.get(b.originalTeam) ?? 99)
      })
    for (const p of group) {
      order.push(p.ownerTeam)
      rounds.push(r)
      ids.push(p.id)
    }
  }
  return { order, rounds, ids }
}

/** Number of selections in the current draft (varies with trades/comp picks). */
export function totalPicks(world: World) {
  return world.draftOrder.length || TOTAL_PICKS
}

export function overallPick(world: World) {
  return world.draftState.pickIndex + 1
}
export function currentRound(world: World) {
  if (world.draftRounds?.length) return world.draftRounds[world.draftState.pickIndex] ?? DRAFT_ROUNDS
  return Math.min(DRAFT_ROUNDS, Math.floor(world.draftState.pickIndex / DRAFT_TEAMS) + 1)
}
export function currentTeamId(world: World): string | null {
  if (world.draftState.complete) return null
  return world.draftOrder[world.draftState.pickIndex] ?? null
}

const NEED_TARGETS: Record<string, number> = {
  QB: 3, RB: 3, WR: 6, TE: 3, OT: 4, OG: 4, C: 2, DE: 4, DT: 4, LB: 6, CB: 6, S: 4, K: 1, P: 1,
}

export function userOnClock(world: World, career: CareerState | null) {
  if (!career || !canDraft(career)) return false
  return currentTeamId(world) === career.teamId
}

function teamNeeds(roster: Player[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const p of roster) counts[p.pos] = (counts[p.pos] ?? 0) + 1
  const needs: Record<string, number> = {}
  for (const pos of Object.keys(NEED_TARGETS)) {
    needs[pos] = Math.max(0, (NEED_TARGETS[pos] ?? 0) - (counts[pos] ?? 0))
  }
  return needs
}

/** A user's ranked board, folded into the AI's decision while they lack draft authority. */
export interface BoardAdvice {
  board: string[]
  weight: number
}

/** How much a director trusts your board, from your evaluation reputation + skill. */
export function adviceWeight(career: CareerState): number {
  return clamp(0.15 + (career.reputation.evaluation / 100) * 0.5 + (career.skills.evaluation / 100) * 0.35, 0.15, 1)
}

/** Best available prospect for a team, weighing talent vs. positional need. */
export function bestAvailableFor(
  world: World,
  teamId: string,
  advice?: BoardAdvice,
  gradeOf?: (p: DraftProspect) => number,
): DraftProspect | null {
  const available = world.draft.filter((p) => !p.draftedBy)
  if (!available.length) return null
  const needs = teamNeeds(world.roster[teamId] ?? [])
  const scored = available.map((p) => {
    const needBonus = (needs[p.pos] ?? 0) > 0 ? 6 : 0
    const posPremium = p.pos === 'QB' || p.pos === 'DE' || p.pos === 'OT' || p.pos === 'CB' ? 2 : 0
    let adviceBonus = 0
    if (advice) {
      const idx = advice.board.indexOf(p.id)
      if (idx >= 0) adviceBonus = advice.weight * Math.max(4, 30 - idx * 4)
    }
    return { p, score: (gradeOf ? gradeOf(p) : p.grade) + needBonus + posPremium + adviceBonus }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0].p
}

export function prospectToPlayer(world: World, prospect: DraftProspect, teamId: string, pick: number, season: number, origin?: PlayerOrigin): Player {
  void world
  const contract = makeRookieContract(pick, season)
  return {
    id: `pl_${prospect.id}`,
    name: prospect.name,
    pos: prospect.pos,
    side: posSide(prospect.pos),
    age: prospect.age,
    height: heightFor(prospect),
    weight: weightFor(prospect),
    college: prospect.college,
    ovr: Math.min(prospect.pot, Math.round(prospect.ovr + 3)),
    pot: prospect.pot,
    dev: devFor(prospect.pot),
    traits: prospect.traits,
    contract,
    teamId,
    morale: 80,
    character: prospect.character ?? makeCharacter(prospect.id),
    generated: prospect.generated ?? true,
    origin: origin ?? { kind: 'draft', season, round: prospect.projectedRound, by: null },
  }
}

function posSide(pos: Position): Player['side'] {
  if (['QB', 'RB', 'WR', 'TE', 'OT', 'OG', 'C'].includes(pos)) return 'OFF'
  if (['K', 'P'].includes(pos)) return 'ST'
  return 'DEF'
}
function devFor(pot: number): Player['dev'] {
  if (pot >= 95) return 'X-Factor'
  if (pot >= 89) return 'Superstar'
  if (pot >= 83) return 'Star'
  if (pot >= 76) return 'Starter'
  return 'Depth'
}
function heightFor(p: DraftProspect) {
  const h = hash32(p.id, 7) % 8
  return `${6}'${2 + h}"`
}
function weightFor(p: DraftProspect) {
  return 190 + (hash32(p.id, 11) % 130)
}

/** Record a pick for whoever is on the clock. */
export function makePick(world: World, prospect: DraftProspect, teamId: string, by?: string | null) {
  const pick = overallPick(world)
  prospect.draftedBy = teamId
  prospect.draftPick = pick
  const player = prospectToPlayer(world, prospect, teamId, pick, world.season + 1, {
    kind: 'draft',
    season: world.season,
    round: currentRound(world),
    pick,
    by: by ?? null,
    pickId: world.draftPickIds?.[world.draftState.pickIndex],
  })
  world.players.push(player)
  ;(world.roster[teamId] ??= []).push(player)
  world.draftState.log.unshift(
    `Rd ${currentRound(world)} · Pick ${pick} — ${world.byId[teamId].abbr} selects ${prospect.name} (${prospect.pos}, ${prospect.college})`,
  )
  advancePick(world)
  return player
}

function advancePick(world: World) {
  world.draftState.pickIndex += 1
  world.draftState.round = currentRound(world)
  if (world.draftState.pickIndex >= totalPicks(world)) world.draftState.complete = true
}

/** Run AI picks until the user is on the clock or the draft ends. */
export function simUntilUser(world: World, career: CareerState | null, max = 0) {
  const cap = max || totalPicks(world)
  let steps = 0
  while (!world.draftState.complete && steps < cap) {
    if (career && canDraft(career) && currentTeamId(world) === career.teamId) break
    const teamId = currentTeamId(world)
    if (!teamId) break
    // If the user lacks draft authority but has filed a board, the NPC weighs it.
    const advising = !!career && career.teamId === teamId && !canDraft(career) && (career.userBoard?.length ?? 0) > 0
    const advice: BoardAdvice | undefined = advising ? { board: career!.userBoard!, weight: adviceWeight(career!) } : undefined
    // The user's club drafts from the department grade (G1), not public consensus.
    let gradeOf = career && teamId === career.teamId ? (p: DraftProspect) => departmentGrade(world, career!, p) ?? p.grade : undefined
    // K4: your club's simulated picks skip prospects you red-flagged.
    if (gradeOf && career) {
      const flagged = redFlagIds(world, career)
      if (flagged.length) {
        const base = gradeOf
        gradeOf = (p: DraftProspect) => (flagged.includes(p.id) ? -999 : base(p))
      }
    }
    let prospect = bestAvailableFor(world, teamId, advice, gradeOf)
    // G2: in advise mode the Director may pound the table for a conviction call.
    if (prospect && career && teamId === career.teamId && !canDraft(career)) {
      const roll = makeRng(world.seed + world.season * 97 + world.draftState.pickIndex)()
      prospect = convictionPick(world, career, prospect, gradeOf ?? ((p) => p.grade), roll) ?? prospect
    }
    if (!prospect) {
      world.draftState.complete = true
      break
    }
    const round = currentRound(world)
    const player = makePick(world, prospect, teamId)
    if (advising && advice && career) {
      const onBoard = advice.board.includes(prospect.id)
      pushLedger(career, {
        kind: 'advice',
        prospectId: prospect.id,
        playerId: player.id,
        name: prospect.name,
        pos: prospect.pos,
        college: prospect.college,
        myGrade: prospect.myGrade ?? prospect.grade,
        round,
        pick: prospect.draftPick ?? undefined,
        truth: prospect.trueGrade,
        accepted: onBoard,
        note: onBoard
          ? 'The Director followed your board.'
          : 'The Director went another way over your board.',
      })
    }
    steps++
  }
  return steps
}

export function simulateRestOfDraft(world: World, career: CareerState | null) {
  let guard = totalPicks(world) + 5
  while (!world.draftState.complete && guard-- > 0) {
    simUntilUser(world, career, totalPicks(world))
    if (world.draftState.complete) break
    const teamId = currentTeamId(world)
    if (!teamId) break
    // The user's club is on the clock but the user chose to auto-finish: take best available for them.
    const gradeOf = career && teamId === career.teamId ? (p: DraftProspect) => departmentGrade(world, career!, p) ?? p.grade : undefined
    const prospect = bestAvailableFor(world, teamId, undefined, gradeOf)
    if (!prospect) {
      world.draftState.complete = true
      break
    }
    makePick(world, prospect, teamId, career && teamId === career.teamId ? career.gmName : null)
  }
  return world.draftState.complete
}

// ── Compensatory picks ───────────────────────────────────────────────────────
/**
 * Award compensatory picks for the upcoming draft based on net free agents lost
 * last cycle. Teams that lost more qualifying veterans than they signed get one
 * or two extra selections, placed at the end of a round like the real rule.
 */
export function awardCompensatoryPicks(world: World): number {
  const picks = ensureDraftPicks(world, world.season + 1)
  const ledger = world.compLedger ?? {}
  let awarded = 0
  const MAX_COMPS = 32
  for (const t of world.teams) {
    if (t.tier !== 'NFL') continue
    if (awarded >= MAX_COMPS) break
    const l = ledger[t.id]
    if (!l) continue
    const net = l.lost - l.gained
    const count = net >= 4 ? 2 : net >= 2 ? 1 : 0
    const rounds = count === 2 ? [3, 5] : [3]
    for (const r of rounds) {
      if (awarded >= MAX_COMPS) break
      picks.push({
        id: `pk_${world.season + 1}_${r}_${t.id}_comp${awarded}`,
        season: world.season + 1,
        round: r,
        originalTeam: t.id,
        ownerTeam: t.id,
        comp: true,
      })
      awarded++
    }
  }
  // Reset the ledger; the next cycle starts fresh.
  for (const k of Object.keys(ledger)) ledger[k] = { lost: 0, gained: 0 }
  return awarded
}

/** Teams sign a couple of undrafted free agents after the draft. */
export function runUDFAs(world: World) {
  const rng = makeRng(world.seed + world.season * 40503)
  const udfa = world.draft.filter((p) => !p.draftedBy).sort((a, b) => b.grade - a.grade).slice(0, 180)
  const teams = world.teams.filter((t) => t.tier === 'NFL')
  for (const prospect of udfa) {
    const team = teams[hash32(prospect.id, 3) % teams.length]
    const player = prospectToPlayer(world, prospect, team.id, 250 + Math.floor(rng() * 10), world.season + 1, {
      kind: 'udfa',
      season: world.season,
      by: null,
    })
    player.contract = makeRookieContract(224, world.season + 1)
    player.ovr = Math.max(55, player.ovr - 5)
    world.players.push(player)
    world.roster[team.id].push(player)
    prospect.draftedBy = team.id
  }
  // Z1b: every UDFA signed must also be a canonical `world.players` entry.
  indexPlayers(world)
}

// ─────────────────────────────────────────────────────────────────────────────
// Personal ambitions (#11).
//
// Each season you pick up to three goals that YOU chose — "Find a starter after
// Round 4", "Beat the Saints", "End the year cap-clean". They are deliberately
// different from the objectives the job assigns: the job tells you what it wants,
// ambitions are what you want. Met ambitions pay a small reputation dividend.
//
// The pool is generated deterministically from (seed, season, team) so a save
// reloads the same menu. Ambitions are cleared at the start of each season.
// ─────────────────────────────────────────────────────────────────────────────

import type { Ambition, CareerState } from '../types'
import { NFL_TEAMS } from '../data/nflTeams'
import type { World } from './generate'
import { summarizeCap } from './cap'
import { capabilities } from './capabilities'
import { hash32, makeRng, rpick } from './rng'
import { unitRanks, type Reputation } from './career'
import { unscaleOvr } from './ovrScale'

export const MAX_AMBITIONS = 3

function divisionRival(world: World, career: CareerState): string {
  const me = world.byId[career.teamId]
  const pool = NFL_TEAMS.filter(
    (t) => t.id !== career.teamId && t.conference === me.conference && t.division === me.division,
  )
  return rpick(makeRng(world.seed + hash32(career.teamId, 53) + world.season * 977), pool).id
}

/** The menu of ambitions for this season. */
export function makeAmbitionPool(world: World, career: CareerState): Ambition[] {
  const rng = makeRng(world.seed + hash32(career.teamId, 59) + world.season * 4_217)
  const caps = capabilities(career)
  const rivalId = divisionRival(world, career)
  const rival = world.byId[rivalId]
  const rec = world.standings[career.teamId]
  const lastWins = rec?.wins ?? 8
  const side: 'off' | 'def' = career.path === 'coach' && career.unitFocus === 'def' ? 'def' : 'off'
  const out: Ambition[] = []

  const add = (a: Omit<Ambition, 'id' | 'season'>) => out.push({ ...a, id: `amb_${world.season}_${a.kind}${a.meta?.teamId ?? ''}${a.meta?.side ?? ''}`, season: world.season })

  add({
    kind: 'winRecord',
    label: `Win ${Math.min(15, Math.max(6, lastWins + 2))} games`,
    blurb: 'Set a bar above last year and clear it.',
    meta: { target: Math.min(15, Math.max(6, lastWins + 2)) },
    reward: { results: 3 },
  })
  add({
    kind: 'makePlayoffs',
    label: 'Make the playoffs',
    blurb: 'The only measuring stick that never lies.',
    reward: { results: 3, profile: 2 },
  })
  add({
    kind: 'winDivision',
    label: `Win the ${divisionLabel(world, career)}`,
    blurb: 'Take the division and the home game that comes with it.',
    reward: { results: 3, leadership: 1, profile: 2 },
  })
  add({
    kind: 'top10Unit',
    label: `Finish with a top-10 ${side === 'def' ? 'defense' : 'offense'}`,
    blurb: 'Talent on paper is not a ranking. Earn one.',
    meta: { side },
    reward: { results: 3, profile: 1 },
  })
  add({
    kind: 'beatRival',
    label: `Beat the ${rival?.name ?? 'rival'}`,
    blurb: 'The fans circled this one in the summer.',
    meta: { teamId: rivalId },
    reward: { results: 1, profile: 1 },
  })
  if (caps.can.has('grade')) {
    add({
      kind: 'scoutAccuracy',
      label: 'File 8+ reports at 65% accuracy',
      blurb: 'Your board should be right more often than not.',
      reward: { evaluation: 3 },
    })
  }
  if (caps.can.has('draft') || caps.can.has('rankBoard') || caps.can.has('grade')) {
    add({
      kind: 'draftStarter',
      label: 'Find a starter after Round 4',
      blurb: 'The best drafts are won on day three.',
      reward: { evaluation: 3, roster: 2 },
    })
  }
  if (caps.can.has('manageCap') || caps.can.has('signFreeAgents') || caps.can.has('negotiate')) {
    add({
      kind: 'capClean',
      label: 'End the year cap-clean ($8M+ space)',
      blurb: 'Flexibility is a weapon. Keep yours.',
      reward: { roster: 3 },
    })
  }
  add({
    kind: 'developYoung',
    label: 'Develop one of your guys to 80 OVR',
    blurb: 'A player you brought in, under 25, at 80 or better.',
    reward: { roster: 3, leadership: 1 },
  })

  // Deterministic menu: shuffle then take four, but never drop the signature
  // goals (win record + playoffs) so every menu is playable.
  const priority = out.filter((a) => a.kind === 'winRecord' || a.kind === 'makePlayoffs')
  const rest = out.filter((a) => !priority.includes(a))
  const shuffled = rest
    .map((a) => ({ a, k: rng() }))
    .sort((x, y) => x.k - y.k)
    .map((x) => x.a)
  return [...priority, ...shuffled.slice(0, 4)]
}

function divisionLabel(world: World, career: CareerState): string {
  const t = world.byId[career.teamId]
  return `${t.conference} ${t.division}`
}

export interface AmbitionGrade {
  results: Ambition[]
  repDelta: Partial<Reputation>
  met: number
}

/** Evaluate the player's chosen ambitions with a season of hindsight. */
export function gradeAmbitions(
  world: World,
  career: CareerState,
  ctx: { wins: number; losses: number; madePlayoffs: boolean; wonTitle: boolean },
): AmbitionGrade {
  const ambitions = career.ambitions ?? []
  const ranks = unitRanks(world, 'NFL')[career.teamId]
  const roster = world.roster[career.teamId] ?? []
  const cap = summarizeCap(roster, world.deadMoney[career.teamId] ?? 0, world.season)
  const seasonRecs = career.seasonRecs
  const accuracy = seasonRecs ? Math.round((career.seasonHits / seasonRecs) * 100) : 0
  const repDelta: Partial<Reputation> = {}
  let met = 0

  const results = ambitions.map((a) => {
    let done = false
    switch (a.kind) {
      case 'makePlayoffs':
        done = ctx.madePlayoffs
        break
      case 'winDivision': {
        const div = NFL_TEAMS.filter(
          (t) => t.conference === world.byId[career.teamId].conference && t.division === world.byId[career.teamId].division,
        )
        const best = div
          .map((t) => ({ id: t.id, w: world.standings[t.id]?.wins ?? 0, l: world.standings[t.id]?.losses ?? 0 }))
          .sort((x, y) => y.w - x.w || x.l - y.l)[0]
        done = best?.id === career.teamId
        break
      }
      case 'top10Unit':
        done = (a.meta?.side === 'def' ? ranks.def : ranks.off) <= 10
        break
      case 'beatRival': {
        const rivalId = a.meta?.teamId
        if (rivalId) {
          done = world.schedule.some(
            (g) =>
              g.played &&
              ((g.homeId === career.teamId && g.awayId === rivalId && (g.homeScore ?? 0) > (g.awayScore ?? 0)) ||
                (g.awayId === career.teamId && g.homeId === rivalId && (g.awayScore ?? 0) > (g.homeScore ?? 0))),
          )
        }
        break
      }
      case 'scoutAccuracy':
        done = seasonRecs >= 8 && accuracy >= 65
        break
      case 'draftStarter': {
        const rookies = (career.ledger ?? []).filter(
          (e) => e.kind === 'pick' && (e.round ?? 0) >= 4 && e.season >= world.season - 1 && e.playerId,
        )
        const top24 = new Set([...roster].sort((x, y) => y.ovr - x.ovr).slice(0, 24).map((p) => p.id))
        done = rookies.some((e) => e.playerId && top24.has(e.playerId))
        break
      }
      case 'capClean':
        done = cap.space >= 8_000_000
        break
      case 'developYoung':
        done = roster.some((p) => p.age <= 25 && unscaleOvr(p.ovr) >= 80 && p.origin?.by === career.gmName)
        break
      case 'winRecord':
        done = ctx.wins >= (a.meta?.target ?? 9)
        break
    }
    if (done) {
      met++
      for (const [k, v] of Object.entries(a.reward)) {
        ;(repDelta as unknown as Record<string, number>)[k] =
          ((repDelta as unknown as Record<string, number>)[k] ?? 0) + (v as number)
      }
    }
    return { ...a, done }
  })

  return { results, repDelta, met }
}

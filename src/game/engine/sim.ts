import type { TeamRecord } from '../types'
import { teamStrength, type Game, type World } from './generate'
import { statGame } from './statAlloc'
import { clamp, gauss, hash32, makeRng, type Rng } from './rng'
import { attributesFor } from '../data/ratings'
import { POS_MEAN } from './ratingMeans'

/**
 * L12 W1: the user's weekly practice plan, applied only to the user's club. AI
 * clubs pass nothing, so league-wide injuries are unchanged.
 */
export interface WeekRecovery {
  /** The user's club — the only roster a practice plan may affect. */
  teamId?: string
  /** Weekly minor-injury threshold multiplier (1 = normal). */
  injuryMult?: number
  /** Rest week: injured players can shed one extra game (deterministic, no rng). */
  restHeal?: boolean
  /** Rest week: the club's players shed 10 fatigue (deterministic, no rng). */
  fatigueRelief?: boolean
}

const HOME_ADV = 2.4

/** Simulate one game and write the result + standings. */
export function simGame(world: World, game: Game, rng: Rng) {
  const homeStr = teamStrength(world.roster[game.homeId] ?? [])
  const awayStr = teamStrength(world.roster[game.awayId] ?? [])
  const diff = homeStr - awayStr + (game.postseason ? 0 : HOME_ADV)
  const margin = gauss(rng, diff * 1.05, 9.5)

  let homeScore = Math.round(21 + margin / 2 + gauss(rng, 0, 3.6))
  let awayScore = Math.round(21 - margin / 2 + gauss(rng, 0, 3.6))
  homeScore = clamp(homeScore, 0, 70)
  awayScore = clamp(awayScore, 0, 70)
  if (homeScore === awayScore) homeScore += rng() > 0.5 ? 3 : -3
  if (homeScore === awayScore) homeScore += 3

  game.homeScore = homeScore
  game.awayScore = awayScore
  game.played = true

  applyResult(world.standings[game.homeId], homeScore, awayScore)
  applyResult(world.standings[game.awayId], awayScore, homeScore)
}

/** Apply a known final score to a game + standings (used by the play-by-play sim). */
export function finalizeGame(world: World, game: Game, homeScore: number, awayScore: number) {
  game.homeScore = homeScore
  game.awayScore = awayScore
  game.played = true
  applyResult(world.standings[game.homeId], homeScore, awayScore)
  applyResult(world.standings[game.awayId], awayScore, homeScore)
}

function applyResult(rec: TeamRecord, scored: number, allowed: number) {
  if (!rec) return
  rec.pointsFor += scored
  rec.pointsAgainst += allowed
  if (scored > allowed) {
    rec.wins++
    rec.streak = rec.streak >= 0 ? rec.streak + 1 : 1
  } else if (scored < allowed) {
    rec.losses++
    rec.streak = rec.streak <= 0 ? rec.streak - 1 : -1
  } else {
    rec.ties++
    rec.streak = 0
  }
}

/** Simulate every unplayed game in a given week, then recover players a bit. */
export function simWeek(world: World, week: number, exceptGameId?: string, recovery?: WeekRecovery) {
  const rng = makeRng(world.seed + week * 7919)
  for (const game of world.schedule) {
    if (game.week === week && !game.played && game.id !== exceptGameId) simGame(world, game, rng)
  }
  healPlayers(world, rng, week, recovery)
  // Give every completed game outside the user's a distributed box score.
  allocateWeekStats(world, week, exceptGameId)
}

/** Weekly recovery only — used by the authentic league path, which sims elsewhere. */
export function healAfterWeek(world: World, week: number, recovery?: WeekRecovery) {
  healPlayers(world, makeRng(world.seed + week * 7919 + 101), week, recovery)
}

/** Fill league-wide player stats for games that were score-simulated. */
function allocateWeekStats(world: World, week: number, exceptGameId?: string) {
  for (const game of world.schedule) {
    if (game.week !== week || !game.played || game.id === exceptGameId) continue
    if (game.statsDone) continue
    statGame(world, game, world.season, 'NFL')
    game.statsDone = true
  }
}

function healPlayers(world: World, rng: Rng, week: number, recovery?: WeekRecovery) {
  const mult = recovery?.injuryMult ?? 1
  for (const p of world.players) {
    if (p.injured) {
      p.injured.games -= 1
      if (p.injured.games <= 0) p.injured = undefined
    }
    // Minor injury risk. The user's practice plan can raise or lower the odds —
    // the threshold is all that changes, so the number of rng() draws is fixed.
    // L12 E2: a player's TGH moves his own threshold (relative to his position mean).
    if (!p.injured && p.teamId) {
      const m = recovery?.teamId === p.teamId ? mult : 1
      const tghMean = POS_MEAN[p.pos]?.TGH
      const tgh = (p.attrs?.TGH ?? attributesFor(p.id, p.pos, p.ovr).TGH ?? tghMean ?? 70)
      const tghMult = tghMean === undefined ? 1 : clamp(1 + (tghMean - tgh) / 150, 0.6, 1.4)
      if (rng() < 0.012 * m * tghMult) {
        p.injured = { games: 1 + Math.floor(rng() * 3), note: pickNote(rng) }
      }
    }
  }
  // L12 W1 Rest: the user's dinged players can shed one extra game 25% of the
  // time. A deterministic hash (no rng), applied after the loop so the draw
  // sequence above is untouched.
  if (recovery?.restHeal && recovery.teamId) {
    for (const p of world.players) {
      if (!p.injured || p.teamId !== recovery.teamId) continue
      if (hash32(p.id, week) % 100 < 25) {
        p.injured.games -= 1
        if (p.injured.games <= 0) p.injured = undefined
      }
    }
  }
  // L12 W1 Rest: the user's club sheds 10 fatigue. No rng.
  if (recovery?.fatigueRelief && recovery.teamId) {
    for (const p of world.players) {
      if (p.teamId !== recovery.teamId) continue
      p.fatigue = Math.max(0, (p.fatigue ?? 0) - 10)
    }
  }
}

function pickNote(rng: Rng) {
  const notes = ['Hamstring', 'Ankle', 'Concussion', 'Knee', 'Shoulder', 'Groin', 'Hand']
  return notes[Math.floor(rng() * notes.length)]
}

export interface PlayoffResult {
  champion: string
  runnerUp: string
  seeds: string[]
  rounds: { round: string; matchup: string; winner: string }[]
}

/** Simulate a top-7-per-conference NFL playoff bracket. */
export function simulatePlayoffs(world: World): PlayoffResult {
  const rng = makeRng(world.seed + world.season * 104729)
  const nfl = world.teams.filter((t) => t.tier === 'NFL')
  const byConf = (conf: string) =>
    nfl
      .filter((t) => t.conference === conf)
      .map((t) => ({ id: t.id, rec: world.standings[t.id] }))
      .sort((a, b) => b.rec.wins - a.rec.wins || a.rec.losses - b.rec.losses || b.rec.pointsFor - a.rec.pointsFor)
      .slice(0, 7)

  const afc = byConf('AFC')
  const nfc = byConf('NFC')
  const rounds: PlayoffResult['rounds'] = []

  const play = (a: string, b: string, round: string) => {
    const sa = teamStrength(world.roster[a] ?? [])
    const sb = teamStrength(world.roster[b] ?? [])
    const diff = sa - sb + 1.5
    const margin = gauss(rng, diff * 0.8, 9)
    const winner = margin >= 0 ? a : b
    const loser = winner === a ? b : a
    rounds.push({
      round,
      matchup: `${world.byId[a].abbr} vs ${world.byId[b].abbr}`,
      winner: world.byId[winner].abbr,
    })
    return { winner, loser }
  }

  const confChamp = (seeds: { id: string }[]) => {
    const wc = seeds.slice(1, 7).map((s) => s.id)
    const bye = seeds[0].id
    // Wild card: 2v7, 3v6, 4v5
    const r1w = [play(wc[0], wc[5], 'Wild Card').winner, play(wc[1], wc[4], 'Wild Card').winner, play(wc[2], wc[3], 'Wild Card').winner]
    const divW = [play(bye, r1w[2], 'Divisional').winner, play(r1w[0], r1w[1], 'Divisional').winner]
    return play(divW[0], divW[1], 'Conference Championship').winner
  }

  const afcChamp = confChamp(afc)
  const nfcChamp = confChamp(nfc)
  const sb = play(afcChamp, nfcChamp, 'Super Bowl')
  world.lastChampion = sb.winner
  return { champion: sb.winner, runnerUp: sb.loser, seeds: [...afc.map((s) => s.id), ...nfc.map((s) => s.id)], rounds }
}

/** Draft order: worst record picks first; tiebreak on points against. */
export function computeDraftOrder(world: World): string[] {
  return world.teams
    .filter((t) => t.tier === 'NFL')
    .map((t) => ({ id: t.id, rec: world.standings[t.id] }))
    .sort((a, b) => a.rec.wins - b.rec.wins || b.rec.pointsAgainst - a.rec.pointsAgainst)
    .map((t) => t.id)
}

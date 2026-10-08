// ─────────────────────────────────────────────────────────────────────────────
// Forks & legacy.
//
// #17 Getting fired is not a reset — it opens "The Wilderness", a set of paths
//     back with different benefits.
// #19 Your own Hall-of-Fame case, tallied from rings, the Ledger, the players
//     you found who made Canton, and your coaching tree.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState } from '../types'
import type { World } from './generate'
import type { AwardHistory } from './awards'
import type { CareerDatabase } from './statsDb'
import { NFL_TEAMS } from '../data/nflTeams'
import { clamp, makeRng, rpick } from './rng'
import { ladderFor, minNflLevel, salaryFor, tierFor, type Reputation } from './career'

export interface WildernessPath {
  id: string
  label: string
  blurb: string
}

export const WILDERNESS_PATHS: WildernessPath[] = [
  { id: 'tv', label: 'A year on TV', blurb: 'Raise your profile and see every team. A slower road back with a higher ceiling.' },
  { id: 'consult', label: 'Consult for a rival', blurb: 'Stay sharp on the cap and roster. Instant credibility when you return.' },
  { id: 'agency', label: 'Join a sports agency', blurb: 'Learn the other side of the contract desk and rebuild your network.' },
  { id: 'ufl', label: 'The UFL', blurb: 'The hardest road back — but you will coach again.' },
]

/** Apply the chosen Wilderness path. */
export function applyWilderness(world: World, career: CareerState, pathId: string): CareerState {
  const path = WILDERNESS_PATHS.find((p) => p.id === pathId) ?? WILDERNESS_PATHS[0]
  const rng = makeRng(world.seed + world.season * 31 + pathId.length)
  const rep: Reputation = { ...career.reputation }
  const minLevel = minNflLevel(career.path)
  let level = Math.max(minLevel, career.level - 1)
  if (pathId === 'tv') {
    rep.profile = clamp(rep.profile + 8, 0, 100)
  } else if (pathId === 'consult') {
    rep.roster = clamp(rep.roster + 6, 0, 100)
    level = Math.max(minLevel, career.level - 1)
  } else if (pathId === 'agency') {
    rep.profile = clamp(rep.profile + 4, 0, 100)
    rep.leadership = clamp(rep.leadership + 3, 0, 100)
    level = Math.max(minLevel, career.level - 1)
  } else {
    level = Math.max(minLevel, career.level - 2)
  }
  level = clamp(level, minLevel, ladderFor(career.path).length - 1)
  // The only universe is the NFL; you land with a league club.
  const teamId = rpick(rng, NFL_TEAMS).id
  return {
    ...career,
    level,
    tier: 'NFL',
    teamId,
    salary: salaryFor(career.path, level),
    jobSecurity: 55,
    reputation: rep,
    wilderness: null,
    history: [
      ...career.history,
      { season: world.season, team: career.teamId, role: tierFor(career.path, career.level).title, record: '', outcome: `The Wilderness: ${path.label}` },
    ],
  }
}

// ── Legacy (#19) ─────────────────────────────────────────────────────────────
export interface LegacyCase {
  rings: number
  ledgerHits: number
  myGuys: number
  cantonPlayers: number
  tree: number
  /** L12.16 H4: honours (MVP/POY/All-Pro…) won by players on your club in your seasons. */
  honoursForYourPlayers: number
  /** L12.16 H4: ballot finalists you found (they appear on your Ledger). */
  finalistsYouFound: number
  score: number
  threshold: number
  inducted: boolean
}

const HOF_THRESHOLD = 45

export function legacyCase(
  career: CareerState,
  inductedIds: Set<string>,
  awards?: AwardHistory,
  db?: CareerDatabase,
): LegacyCase {
  const rings = career.history.filter((h) => /champion/i.test(h.outcome)).length
  const ledgerHits = (career.ledger ?? []).filter((e) => e.hit).length
  const myGuys = (career.ledger ?? []).filter((e) => e.kind === 'pick').length
  const ids = new Set((career.ledger ?? []).map((e) => e.playerId).filter((x): x is string => !!x))
  const cantonPlayers = [...ids].filter((id) => inductedIds.has(id)).length
  const tree = (career.tree ?? []).length

  // L12.16 H4: honours won by players who were on your club in the season they
  // won them, plus the ballot finalists your Ledger found.
  let honoursForYourPlayers = 0
  let finalistsYouFound = 0
  if (awards) {
    const teamBySeason = new Map(career.history.map((h) => [h.season, h.team]))
    const teamOf = (playerId: string, season: number): string | undefined => {
      if (!db) return undefined
      return db.players[playerId]?.seasons.find((s) => s.season === season)?.teamId
    }
    const count = (w: { playerId: string } | null | undefined, season: number) => {
      if (!w) return
      const teamId = teamOf(w.playerId, season)
      if (teamId && teamId === teamBySeason.get(season)) honoursForYourPlayers += 1
    }
    for (const s of awards.seasons) {
      count(s.mvp, s.season)
      count(s.opoy, s.season)
      count(s.dpoy, s.season)
      count(s.oroy, s.season)
      count(s.droy, s.season)
      for (const w of [...s.firstTeam.offense, ...s.firstTeam.defense, ...s.secondTeam.offense, ...s.secondTeam.defense]) {
        count(w, s.season)
      }
    }
    const ledgerIds = new Set((career.ledger ?? []).map((e) => e.playerId).filter((x): x is string => !!x))
    const found = new Set<string>()
    for (const cls of awards.classes ?? []) {
      for (const f of cls.finalists) if (ledgerIds.has(f.playerId)) found.add(f.playerId)
    }
    finalistsYouFound = found.size
  }
  // The two new terms together are worth at most +10 (H4 guardrail).
  const bonus = Math.min(10, honoursForYourPlayers * 2 + finalistsYouFound * 3)
  const score = rings * 25 + Math.min(20, ledgerHits) + cantonPlayers * 8 + tree * 5 + bonus
  return {
    rings,
    ledgerHits,
    myGuys,
    cantonPlayers,
    tree,
    honoursForYourPlayers,
    finalistsYouFound,
    score,
    threshold: HOF_THRESHOLD,
    inducted: score >= HOF_THRESHOLD,
  }
}

/** Start a successor: a protégé who inherits part of your reputation and network. */
export function makeSuccessor(world: World, career: CareerState, name: string): CareerState {
  const rep: Reputation = {
    evaluation: Math.round(career.reputation.evaluation * 0.35),
    roster: Math.round(career.reputation.roster * 0.25),
    leadership: Math.round(career.reputation.leadership * 0.35),
    results: 5,
    profile: clamp(Math.round(career.reputation.profile * 0.5) + 10, 0, 100),
  }
  return {
    gmName: name,
    path: career.path,
    archetype: career.archetype,
    teamId: career.teamId,
    season: world.season,
    week: world.week,
    reputation: rep,
    skills: { ...career.skills, evaluation: Math.round(career.skills.evaluation * 0.6) },
    level: minNflLevel(career.path),
    salary: salaryFor(career.path, minNflLevel(career.path)),
    jobSecurity: 70,
    ownerExpectation: career.ownerExpectation,
    tier: 'NFL',
    recommendationsMade: 0,
    hits: 0,
    misses: 0,
    seasonRecs: 0,
    seasonHits: 0,
    hoursLeft: 40,
    ledger: [],
    contacts: (career.contacts ?? []).slice(0, 2),
    earnedTraits: [],
    mentor: career.mentor,
    tree: [],
    history: [{ season: world.season, team: career.teamId, role: 'Successor', record: '', outcome: `Picked up the torch from ${career.gmName}` }],
  }
}

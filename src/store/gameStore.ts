import { create } from 'zustand'
import {
  buildWorld,
  regenerateSchedule,
  teamStrength,
  zeroRecord,
  type World,
} from '../game/engine/generate'
import { finalizeGame, simWeek, simulateCollegePlayoff, simulatePlayoffs } from '../game/engine/sim'
import { simulatePlayByPlay, setUserCoaching, setLivePlan, type GameSim } from '../game/engine/playsim'
import { BALANCED_PLAN, type GamePlan } from '../game/engine/gameplan'
import { userBonusFromSkills } from '../game/engine/coaching'
import {
  gainGameReps,
  gainSeasonTraining,
  initPlaybook,
  refreshCohesion,
  teamCohesion,
} from '../game/engine/playbook'
import { applyHire, attemptHire, openCandidates } from '../game/engine/hiring'
import {
  leaderboard,
  newDatabase,
  recordBook,
  recordPlayerSeasons,
  recordTeamSeasons,
  teamHistory,
  type CareerDatabase,
  type LeaderRow,
  type TeamSeasonRecord,
} from '../game/engine/statsDb'
import { setSchemeLookup } from '../game/engine/stats'
import {
  computeHallOfFame,
  newAwardHistory,
  selectHonors,
  type AwardHistory,
  type SeasonHonors,
} from '../game/engine/awards'
import { recordGameStats, boxScore } from '../game/engine/stats'
import {
  developPlayers,
  evaluateScouting,
  refreshProspectClass,
  runAIFreeAgency,
  tickAllContracts,
  type ScoutingReport,
} from '../game/engine/progress'
import {
  canSignFreeAgents,
  demote,
  generateJobOffers,
  gradeObjectives,
  ladderFor,
  makeInterview,
  promote,
  resolveInterview,
  reviewSeason,
  roleObjectives,
  salaryFor,
  tierFor,
  unitRanks,
  ZERO_REP,
  ZERO_SKILLS,
  type Objective,
  type Reputation,
  type Skills,
} from '../game/engine/career'
import { clamp } from '../game/engine/rng'
import {
  currentRound,
  currentTeamId,
  initDraft,
  buildDraftOrder,
  makePick,
  overallPick,
  runUDFAs,
  simUntilUser,
  simulateRestOfDraft,
  userOnClock,
  awardCompensatoryPicks,
} from '../game/engine/draft'
import { freshDraftPicks, ledgerFreeAgent } from '../game/engine/picks'
import { evaluateTrade, executeTrade, type TradeAsset } from '../game/engine/trade'
import {
  capSavings,
  deadMoney,
  extendContract,
  makeVeteranContract,
  restructure,
  summarizeCap,
} from '../game/engine/cap'
import { makeRng } from '../game/engine/rng'
import type { CareerPath, CareerState, JobOffer, LeagueTier, NewsItem } from '../game/types'
import { loadGame, saveGame, clearSave } from '../game/persistence'
import { loadRealData, getRealData } from '../game/data/realData'
import { loadCalibration } from '../game/data/calibration'

export type ScreenId =
  | 'career' | 'dashboard' | 'roster' | 'depth' | 'gameplan' | 'staff' | 'scouting' | 'draft'
  | 'recruiting' | 'freeagency' | 'trades' | 'cap' | 'schedule' | 'standings'
  | 'stats' | 'awards' | 'league' | 'inbox'

export interface ScreenMeta {
  id: ScreenId
  label: string
  group: 'Career' | 'Team' | 'Personnel' | 'League' | 'Club'
  tiers: LeagueTier[]
}

export const SCREENS: ScreenMeta[] = [
  { id: 'career', label: 'My Career', group: 'Career', tiers: ['NFL', 'FBS', 'FCS'] },
  { id: 'dashboard', label: 'Dashboard', group: 'Career', tiers: ['NFL', 'FBS', 'FCS'] },
  { id: 'scouting', label: 'Scouting', group: 'Career', tiers: ['NFL', 'FBS', 'FCS'] },
  { id: 'roster', label: 'Roster', group: 'Team', tiers: ['NFL', 'FBS', 'FCS'] },
  { id: 'depth', label: 'Depth Chart', group: 'Team', tiers: ['NFL', 'FBS', 'FCS'] },
  { id: 'gameplan', label: 'Game Plan', group: 'Team', tiers: ['NFL', 'FBS', 'FCS'] },
  { id: 'schedule', label: 'Schedule', group: 'Team', tiers: ['NFL', 'FBS', 'FCS'] },
  { id: 'draft', label: 'Draft Board', group: 'Personnel', tiers: ['NFL'] },
  { id: 'recruiting', label: 'Recruiting', group: 'Personnel', tiers: ['FBS', 'FCS'] },
  { id: 'freeagency', label: 'Free Agency', group: 'Personnel', tiers: ['NFL'] },
  { id: 'trades', label: 'Trade Center', group: 'Personnel', tiers: ['NFL'] },
  { id: 'cap', label: 'Salary Cap', group: 'Club', tiers: ['NFL'] },
  { id: 'staff', label: 'Staff & Hiring', group: 'Club', tiers: ['NFL', 'FBS', 'FCS'] },
  { id: 'standings', label: 'Standings', group: 'League', tiers: ['NFL', 'FBS', 'FCS'] },
  { id: 'stats', label: 'Stats Hub', group: 'League', tiers: ['NFL', 'FBS', 'FCS'] },
  { id: 'awards', label: 'Awards & HOF', group: 'League', tiers: ['NFL', 'FBS', 'FCS'] },
  { id: 'league', label: 'League', group: 'League', tiers: ['NFL', 'FBS', 'FCS'] },
  { id: 'inbox', label: 'Inbox', group: 'Club', tiers: ['NFL', 'FBS', 'FCS'] },
]

export const MAX_SCOUT_POINTS = 6

/** A game being managed live: we keep the game id and re-simulate deterministically. */
export interface LiveGame {
  gameId: string
  off: GamePlan
  def: GamePlan
}

let world: World = buildWorld(20261004)
let statDb: CareerDatabase = newDatabase()
let awards: AwardHistory = newAwardHistory()
export function getWorld() {
  return world
}
export function getStatsDb(): CareerDatabase {
  return statDb
}
export function getAwards(): AwardHistory {
  return awards
}
export { leaderboard, teamHistory, recordBook, type LeaderRow, type TeamSeasonRecord, type SeasonHonors }

/** The scheme a team runs on a given side, for stat/familiarity tracking. */
function schemeFor(teamId: string, side: 'off' | 'def'): string {
  const staff = world.staff[teamId] ?? []
  const role = side === 'off' ? 'Offensive Coordinator' : 'Defensive Coordinator'
  return staff.find((s) => s.role === role)?.scheme ?? ''
}

/** Give every player a playbook state matching his team + scheme + cohesion. */
function initAllPlaybooks() {
  for (const [teamId, players] of Object.entries(world.roster)) {
    for (const side of ['off', 'def'] as const) {
      const unit = players.filter((p) => (p.side === 'DEF' ? 'def' : 'off') === side)
      if (!unit.length) continue
      const avgYears = unit.reduce((s, p) => s + (p.playbook?.teamYears ?? 0), 0) / unit.length
      const tenure = world.staffTenure[`${teamId}:${side}`] ?? 1
      for (const p of unit) {
        const scheme = schemeFor(teamId, side)
        p.playbook = initPlaybook(p, teamId, scheme, p.playbook, tenure, Math.max(1, avgYears))
      }
    }
  }
}

/** Recompute every player's cohesion cap after roster or staff changes. */
function refreshAllCohesion() {
  for (const [teamId, players] of Object.entries(world.roster)) {
    for (const side of ['off', 'def'] as const) {
      const unit = players.filter((p) => (p.side === 'DEF' ? 'def' : 'off') === side)
      if (!unit.length) continue
      const avgYears = unit.reduce((s, p) => s + (p.playbook?.teamYears ?? 0), 0) / unit.length
      const tenure = world.staffTenure[`${teamId}:${side}`] ?? 1
      for (const p of unit) {
        const next = refreshCohesion(p, tenure, Math.max(1, avgYears))
        if (next) p.playbook = next
      }
    }
  }
}

/** Grow mastery for players who appeared in a completed game. */
function growPlaybookFromGame(world: World, sim: GameSim) {
  const playedIds = new Set<string>()
  for (const line of sim.box ?? []) playedIds.add(line.playerId)
  for (const teamId of [sim.homeId, sim.awayId]) {
    for (const p of world.roster[teamId] ?? []) {
      const next = gainGameReps(p, playedIds.has(p.id))
      if (next) p.playbook = next
    }
  }
}
// Teach the stats layer to stamp each season with the scheme played.
setSchemeLookup((teamId, level) => (level === 'NFL' || level === 'CFB' ? schemeFor(teamId, 'off') : ''))

/** Dev-only: inspect hiring candidates for the current career. */
export function hiringProbe() {
  const c = useGame.getState().career
  if (!c) return { error: 'no career' }
  const poolSize = world.staffPool.length
  const available = world.staffPool.filter((m) => m.status === 'Available').length
  const candidates = openCandidates(world, c.teamId, c.reputation)
  return { poolSize, available, candidates: candidates.length, top: candidates.slice(0, 3).map((x) => `${x.name} ${x.role} ${x.rating} interest ${x.interest}`) }
}
export function useWorld(): World {
  useGame((s) => s.tick)
  return world
}

export interface SeasonSummary {
  season: number
  champion: string | null
  collegeChampion: string | null
  mvp: string | null
  scout: ScoutingReport | null
  record: string
  reviewNote: string
  objectives?: Objective[]
  objectivesDone?: number
}

interface GameStore {
  tick: number
  ready: boolean
  screen: ScreenId
  career: CareerState | null
  activeTeamId: string
  selectedPlayerId: string | null
  selectedProspectId: string | null
  readNews: Record<string, boolean>
  toast: string | null
  scoutingPoints: number
  offers: JobOffer[]
  modal: 'none' | 'seasonReview' | 'offers'
  summary: SeasonSummary | null
  match: GameSim | null
  statsDb: () => CareerDatabase
  liveGame: LiveGame | null
  startLiveGame: () => void
  setPlan: (side: 'off' | 'def', plan: GamePlan) => void
  simLiveChunk: () => void
  finishLiveGame: () => void
  /** Saved pre-game plan, applied every week. */
  defaultPlan: { off: GamePlan; def: GamePlan }
  setDefaultPlan: (side: 'off' | 'def', plan: GamePlan) => void
  setScreen: (s: ScreenId) => void
  setActiveTeam: (id: string) => void
  selectPlayer: (id: string | null) => void
  selectProspect: (id: string | null) => void
  startCareer: (opts: { name: string; path: CareerPath; archetype: string; teamId: string; startLevel?: number }) => void
  resetCareer: () => void
  advanceWeek: () => void
  startNextSeason: () => void
  dismissModal: () => void
  openMatch: (gameId: string) => void
  closeMatch: () => void

  scoutProspect: (id: string) => void
  setRecommendation: (id: string, rec: 'Blue Chip' | 'Starter' | 'Depth' | 'Pass') => void

  acceptOffer: (offer: JobOffer) => void
  declineOffers: () => void

  userOnClock: () => boolean
  draftProspect: (id: string) => void
  simToMyPick: () => void
  finishDraft: () => void

  signFreeAgent: (id: string) => void
  releasePlayer: (id: string) => void
  hireStaff: (candidateId: string, salary: number, scheme?: string) => void
  fireStaff: (staffId: string) => void
  restructurePlayer: (id: string) => void
  extendPlayer: (id: string) => void

  // Practice squad & injured reserve
  signToPracticeSquad: (id: string) => void
  promoteFromPracticeSquad: (id: string) => void
  releaseFromPracticeSquad: (id: string) => void
  placeOnIR: (id: string) => void
  activateFromIR: (id: string) => void

  // Trades
  proposeTrade: (partnerId: string, give: TradeAsset[], get: TradeAsset[]) => { accepted: boolean; message: string }

  markRead: (id: string) => void
  showToast: (msg: string) => void
  clearToast: () => void
  save: () => void
  hydrate: () => Promise<void>
}

function bump(set: (p: Partial<GameStore>) => void, get: () => GameStore) {
  set({ tick: get().tick + 1 })
}

export const useGame = create<GameStore>((set, get) => ({
  tick: 0,
  ready: false,
  screen: 'career',
  career: null,
  activeTeamId: 'BUF',
  selectedPlayerId: null,
  selectedProspectId: null,
  readNews: {},
  toast: null,
  scoutingPoints: MAX_SCOUT_POINTS,
  offers: [],
  modal: 'none',
  summary: null,
  match: null,
  liveGame: null,
  defaultPlan: { off: { ...BALANCED_PLAN }, def: { ...BALANCED_PLAN } },

  statsDb: () => statDb,
  setScreen: (screen) => set({ screen }),
  setActiveTeam: (activeTeamId) => set({ activeTeamId }),
  selectPlayer: (selectedPlayerId) => set({ selectedPlayerId }),
  selectProspect: (selectedProspectId) => set({ selectedProspectId }),

  startCareer: ({ name, path, archetype, teamId, startLevel = 0 }) => {
    world = buildWorld(Date.now() % 2147483647, getRealData())
    initAllPlaybooks()
    const ladder = ladderFor(path)
    const level = Math.max(0, Math.min(ladder.length - 1, startLevel))
    const tier = tierFor(path, level).tier
    const resolvedTeam = world.byId[teamId]?.tier === tier ? teamId : tier === 'NFL' ? 'BUF' : teamId
    // Starting at a higher rung seeds the reputation needed to have earned it.
    const seedRep: Reputation = { ...ZERO_REP }
    for (const [k, v] of Object.entries(ladder[level].gate)) {
      ;(seedRep as unknown as Record<string, number>)[k] = Math.max(
        (seedRep as unknown as Record<string, number>)[k] ?? 0,
        (v as number) + 2,
      )
    }
    const career: CareerState = {
      gmName: name,
      path,
      archetype,
      teamId: resolvedTeam,
      season: world.season,
      week: world.week,
      reputation: seedRep,
      skills: { ...ZERO_SKILLS },
      level,
      salary: salaryFor(path, level),
      jobSecurity: 70,
      unitFocus: path === 'coach' ? (archetype === 'def' ? 'def' : archetype === 'ceo' ? 'both' : 'off') : undefined,
      ownerExpectation:
        tier === 'NFL' ? 'Reach the playoffs and build a sustainable contender' : 'Find and deliver talent for this program',
      tier,
      recommendationsMade: 0,
      hits: 0,
      misses: 0,
      seasonRecs: 0,
      seasonHits: 0,
      history: [],
    }
    set({
      career,
      activeTeamId: resolvedTeam,
      screen: 'career',
      scoutingPoints: MAX_SCOUT_POINTS,
      offers: [],
      modal: 'none',
      summary: null,
      match: null,
      tick: get().tick + 1,
    })
    get().save()
  },

  resetCareer: () => {
    world = buildWorld(20261004, getRealData())
    initAllPlaybooks()
    void clearSave()
    set({ career: null, screen: 'career', tick: get().tick + 1, summary: null, modal: 'none', offers: [], match: null })
  },

  advanceWeek: () => {
    const career = get().career
    if (!career) return
    if (world.phase === 'offseason') {
      get().startNextSeason()
      return
    }
    const week = world.week
    // Apply the saved pre-game plan to the user's game this week.
    const plan = get().defaultPlan
    const userGameForPlan = world.schedule.find(
      (g) => !g.played && g.week === week && (g.homeId === career.teamId || g.awayId === career.teamId),
    )
    if (userGameForPlan) {
      const isHome = userGameForPlan.homeId === career.teamId
      setLivePlan({ offTeamId: career.teamId, defTeamId: isHome ? userGameForPlan.awayId : userGameForPlan.homeId, off: plan.off, def: plan.def })
    }
    // The user's game is simulated play-by-play so it can be watched in 2D.
    applyUserCoaching(career)
    const userGame = world.schedule.find(
      (g) => g.week === week && !g.played && (g.homeId === career.teamId || g.awayId === career.teamId),
    )
    simWeek(world, week, userGame?.id)
    let sim: GameSim | null = null
    if (userGame) {
      sim = simulatePlayByPlay(world, userGame.homeId, userGame.awayId, world.seed + week * 7919 + 101)
      finalizeGame(world, userGame, sim.homeScore, sim.awayScore)
      // Record career stats for both teams' players (college or pro).
      const level = world.byId[userGame.homeId].tier === 'NFL' ? 'NFL' : 'CFB'
      sim.box = boxScore(world, sim)
      recordGameStats(world, sim, world.season, level)
      growPlaybookFromGame(world, sim)
    }
    if (week >= 18) {
      runEndOfRegularSeason(set, get)
    } else {
      world.week = week + 1
      set({ scoutingPoints: MAX_SCOUT_POINTS })
    }
    const c = get().career!
    set({ career: { ...c, week: world.week, season: world.season }, match: sim, tick: get().tick + 1 })
    setLivePlan(null)
    get().save()
  },

  openMatch: (gameId) => {
    const game = world.schedule.find((g) => g.id === gameId)
    const career = get().career
    if (!game || !game.played || !career) return
    if (game.homeId !== career.teamId && game.awayId !== career.teamId) {
      get().showToast("Only your team's games have full play-by-play.")
      return
    }
    const sim = simulatePlayByPlay(world, game.homeId, game.awayId, world.seed + game.week * 7919 + 101)
    sim.box = boxScore(world, sim)
    set({ match: sim, tick: get().tick + 1 })  },
  closeMatch: () => set({ match: null }),

  startLiveGame: () => {
    const career = get().career
    if (!career) return
    const { off, def } = get().defaultPlan
    set({ modal: 'none', summary: null, tick: get().tick + 1 })
    // Re-sim the user's current-week game under live control.
    startLiveSim(get, set, off, def)
  },

  setPlan: (side, plan) => {
    const lg = get().liveGame
    if (!lg) return
    const next = { ...lg, [side]: plan } as LiveGame
    set({ liveGame: next })
    startLiveSim(get, set, next.off, next.def)
  },

  simLiveChunk: () => {
    // With deterministic full-game sim, "advance" just re-simulates; kept for UI parity.
    const lg = get().liveGame
    if (!lg) return
    startLiveSim(get, set, lg.off, lg.def)
  },

  finishLiveGame: () => {
    const lg = get().liveGame
    const career = get().career
    if (!lg || !career) return
    const game = world.schedule.find((g) => g.id === lg.gameId)
    if (!game) return
    // Finalise the game with the managed result and record stats.
    const sim = simulatePlayByPlay(world, game.homeId, game.awayId, world.seed + game.week * 7919 + 101)
    finalizeGame(world, game, sim.homeScore, sim.awayScore)
    const level = world.byId[game.homeId]?.tier === 'NFL' ? 'NFL' : 'CFB'
    sim.box = boxScore(world, sim)
    recordGameStats(world, sim, world.season, level)
    const c = get().career!
    set({
      career: { ...c, week: world.week, season: world.season },
      match: sim,
      liveGame: null,
      tick: get().tick + 1,
    })
    get().showToast('Game finished. Your plan is on the record.')
    get().save()
  },

  setDefaultPlan: (side, plan) => {
    set({ defaultPlan: { ...get().defaultPlan, [side]: plan }, tick: get().tick + 1 })
    get().save()
  },

  startNextSeason: () => {
    const career = get().career
    if (!career) return
    if (world.phase !== 'offseason') return
    if (!world.draftState.complete) {
      simulateRestOfDraft(world, career)
      runUDFAs(world)
      world.draftState.complete = true
    }
    runAIFreeAgency(world)
    world.season += 1
    world.week = 1
    world.phase = 'regular'
    world.awards = {}
    // Fresh draft capital for the next cycle's Trade Center.
    world.draftPicks = freshDraftPicks(world.season + 1)
    world.draftRounds = []
    for (const id of Object.keys(world.standings)) world.standings[id] = zeroRecord(id)
    for (const id of Object.keys(world.deadMoney)) world.deadMoney[id] = 0
    regenerateSchedule(world)
    refreshProspectClass(world)
    set({
      career: { ...career, season: world.season, week: 1, seasonRecs: 0, seasonHits: 0 },
      scoutingPoints: MAX_SCOUT_POINTS,
      modal: 'none',
      summary: null,
      match: null,
      tick: get().tick + 1,
    })
    get().showToast(`Season ${world.season} is underway.`)
    get().save()
  },

  dismissModal: () => {
    const { modal, offers } = get()
    if (modal === 'seasonReview' && offers.length) set({ modal: 'offers' })
    else set({ modal: 'none' })
  },

  scoutProspect: (id) => {
    const p = world.draft.find((d) => d.id === id)
    if (!p) return
    if (get().scoutingPoints <= 0) {
      get().showToast('No scouting points left this week. Advance the week to reset.')
      return
    }
    const target = p.trueGrade
    const current = p.myGrade ?? p.grade
    p.myGrade = Math.round(current + (target - current) * 0.4 + (Math.random() - 0.5) * 6)
    p.confidence = Math.min(100, p.confidence + 24)
    p.scoutConfidence = Math.min(100, p.scoutConfidence + 20)
    set({ scoutingPoints: get().scoutingPoints - 1, tick: get().tick + 1 })
    get().save()
  },

  setRecommendation: (id, rec) => {
    const p = world.draft.find((d) => d.id === id)
    if (!p) return
    const isNew = !p.recommendation
    p.recommendation = rec
    const career = get().career
    if (career && isNew) {
      set({
        career: { ...career, recommendationsMade: career.recommendationsMade + 1, seasonRecs: career.seasonRecs + 1 },
        tick: get().tick + 1,
      })
    } else {
      bump(set, get)
    }
    get().save()
  },

  acceptOffer: (offer) => {
    const career = get().career
    if (!career) return
    // Offers now run through an interview: submit and roll against a rival candidate.
    const invite = makeInterview(offer, world, career)
    const rng = makeRng(world.seed + world.season * 31 + offer.teamId.length + career.level)
    const won = resolveInterview(invite, rng)
    if (!won) {
      get().showToast(`${world.byId[offer.teamId].name} hired ${invite.rival} instead. Your interview fell short.`)
      set({ offers: get().offers.filter((o) => o.id !== offer.id), tick: get().tick + 1 })
      get().save()
      return
    }
    const promoted = promote(career, offer)
    set({ career: promoted, activeTeamId: offer.teamId, offers: [], modal: 'none', tick: get().tick + 1 })
    get().showToast(`You won the job — ${offer.title} for the ${world.byId[offer.teamId].name}.`)
    get().save()
  },
  declineOffers: () => set({ offers: [], modal: 'none' }),

  userOnClock: () => userOnClock(world, get().career),

  draftProspect: (id) => {
    const career = get().career
    if (!career || !userOnClock(world, career)) return
    const prospect = world.draft.find((d) => d.id === id)
    if (!prospect) return
    makePick(world, prospect, career.teamId)
    bump(set, get)
    get().save()
  },
  simToMyPick: () => {
    simUntilUser(world, get().career)
    bump(set, get)
    get().save()
  },
  finishDraft: () => {
    simulateRestOfDraft(world, get().career)
    runUDFAs(world)
    world.draftState.complete = true
    bump(set, get)
    get().showToast('The draft is complete. Undrafted free agents have signed.')
    get().save()
  },

  signFreeAgent: (id) => {
    const career = get().career
    if (!career) return
    if (!canSignFreeAgents(career)) {
      get().showToast('You do not have roster control yet — keep climbing.')
      return
    }
    const idx = world.freeAgents.findIndex((p) => p.id === id)
    if (idx < 0) return
    const p = world.freeAgents[idx]
    const cap = summarizeCap(world.roster[career.teamId] ?? [], world.deadMoney[career.teamId] ?? 0, world.season)
    if (cap.space < p.contract.annual) {
      get().showToast('Not enough cap space to sign this player.')
      return
    }
    world.freeAgents.splice(idx, 1)
    p.teamId = career.teamId
    world.roster[career.teamId].push(p)
    ledgerFreeAgent(world, career.teamId, 'gained', p.ovr)
    bump(set, get)
    get().showToast(`${p.name} signed with the ${world.byId[career.teamId].name}.`)
    get().save()
  },

  releasePlayer: (id) => {
    const career = get().career
    if (!career) return
    const roster = world.roster[career.teamId] ?? []
    const idx = roster.findIndex((p) => p.id === id)
    if (idx < 0) return
    const p = roster[idx]
    const dead = deadMoney(p.contract)
    world.deadMoney[career.teamId] = (world.deadMoney[career.teamId] ?? 0) + dead
    roster.splice(idx, 1)
    p.teamId = null
    p.contract = { ...p.contract, years: 0, base: [0], proration: 0, guaranteed: 0, capHit: 0 }
    world.freeAgents.push(p)
    bump(set, get)
    get().showToast(`${p.name} released. Dead money: $${(dead / 1e6).toFixed(1)}M.`)
    get().save()
  },

  restructurePlayer: (id) => {
    const career = get().career
    if (!career) return
    const p = (world.roster[career.teamId] ?? []).find((x) => x.id === id)
    if (!p) return
    const before = p.contract.capHit
    p.contract = restructure(p.contract)
    bump(set, get)
    get().showToast(`Restructured ${p.name}: cap hit $${(before / 1e6).toFixed(1)}M → $${(p.contract.capHit / 1e6).toFixed(1)}M.`)
    get().save()
  },

  extendPlayer: (id) => {
    const career = get().career
    if (!career) return
    const p = (world.roster[career.teamId] ?? []).find((x) => x.id === id)
    if (!p) return
    const rng = makeRng(world.seed + world.season * 7 + p.id.length)
    p.contract = extendContract(p.contract, rng, p.ovr, p.pos, p.age, world.season)
    bump(set, get)
    get().showToast(`${p.name} extended through ${p.contract.signedThrough}.`)
    get().save()
  },

  // ── Practice squad & injured reserve ──────────────────────────────────────
  signToPracticeSquad: (id) => {
    const career = get().career
    if (!career) return
    const ps = (world.practiceSquad[career.teamId] ??= [])
    if (ps.length >= 16) {
      get().showToast('Practice squad is full (16 players).')
      return
    }
    const idx = world.freeAgents.findIndex((p) => p.id === id)
    if (idx < 0) return
    const p = world.freeAgents.splice(idx, 1)[0]
    p.teamId = career.teamId
    ps.push(p)
    bump(set, get)
    get().showToast(`${p.name} signed to the practice squad.`)
    get().save()
  },

  promoteFromPracticeSquad: (id) => {
    const career = get().career
    if (!career) return
    const ps = world.practiceSquad[career.teamId] ?? []
    const idx = ps.findIndex((p) => p.id === id)
    if (idx < 0) return
    const roster = (world.roster[career.teamId] ??= [])
    if (roster.length >= 53) {
      get().showToast('Active roster is full (53). Release a player first.')
      return
    }
    const p = ps.splice(idx, 1)[0]
    roster.push(p)
    const side = p.side === 'DEF' ? 'def' : 'off'
    p.playbook = initPlaybook(
      p,
      career.teamId,
      schemeFor(career.teamId, side),
      p.playbook,
      world.staffTenure[`${career.teamId}:${side}`] ?? 1,
      1,
    )
    bump(set, get)
    get().showToast(`${p.name} promoted to the active roster.`)
    get().save()
  },

  releaseFromPracticeSquad: (id) => {
    const career = get().career
    if (!career) return
    const ps = world.practiceSquad[career.teamId] ?? []
    const idx = ps.findIndex((p) => p.id === id)
    if (idx < 0) return
    const p = ps.splice(idx, 1)[0]
    p.teamId = null
    world.freeAgents.push(p)
    bump(set, get)
    get().showToast(`${p.name} released from the practice squad.`)
    get().save()
  },

  placeOnIR: (id) => {
    const career = get().career
    if (!career) return
    const roster = world.roster[career.teamId] ?? []
    const idx = roster.findIndex((p) => p.id === id)
    if (idx < 0) return
    const p = roster[idx]
    if (!p.injured) {
      get().showToast('Only injured players can be placed on IR.')
      return
    }
    roster.splice(idx, 1)
    p.injured = { games: Math.max(p.injured.games, 4), note: p.injured.note }
    ;(world.ir[career.teamId] ??= []).push(p)
    bump(set, get)
    get().showToast(`${p.name} placed on injured reserve.`)
    get().save()
  },

  activateFromIR: (id) => {
    const career = get().career
    if (!career) return
    const list = world.ir[career.teamId] ?? []
    const idx = list.findIndex((p) => p.id === id)
    if (idx < 0) return
    const p = list[idx]
    if (p.injured && p.injured.games > 0) {
      get().showToast(`${p.name} is not healthy enough to activate (${p.injured.games}W).`)
      return
    }
    list.splice(idx, 1)
    ;(world.roster[career.teamId] ??= []).push(p)
    bump(set, get)
    get().showToast(`${p.name} activated off injured reserve.`)
    get().save()
  },

  proposeTrade: (partnerId, give, get2) => {
    const career = get().career
    if (!career) return { accepted: false, message: 'No career.' }
    const verdict = evaluateTrade(world, partnerId, career.teamId, give, get2)
    if (!verdict.accepted) {
      get().showToast(verdict.reason)
      return { accepted: false, message: verdict.reason }
    }
    const log = executeTrade(world, career.teamId, partnerId, give, get2)
    bump(set, get)
    const msg = `Trade with the ${world.byId[partnerId].name} completed — ${log.join(', ')}.`
    get().showToast(msg)
    get().save()
    return { accepted: true, message: msg }
  },

  hireStaff: (candidateId, salary, scheme) => {
    const career = get().career
    if (!career) return
    const candidate = openCandidates(world, career.teamId, career.reputation).find((c) => c.id === candidateId)
    if (!candidate) {
      get().showToast('That candidate is no longer available.')
      return
    }
    const rng = makeRng(world.seed + world.season * 3607 + candidateId.length + Math.round(salary))
    const res = attemptHire(world, career.teamId, career.reputation, candidate, salary, rng)
    if (res.signed) {
      applyHire(world, career.teamId, candidate, salary, scheme)
      get().showToast(
        scheme ? `${res.message.replace(/\.$/, '')} — installing the ${scheme} system.` : res.message,
      )
    } else {
      get().showToast(res.message)
    }
    bump(set, get)
    get().save()
  },

  fireStaff: (staffId) => {
    const career = get().career
    if (!career) return
    const staff = world.staff[career.teamId] ?? []
    const idx = staff.findIndex((m) => m.id === staffId)
    if (idx < 0) return
    const m = staff[idx]
    staff.splice(idx, 1)
    // Move them back to the open market.
    world.staffPool.push({ ...m, teamId: null, status: 'Available' })
    bump(set, get)
    get().showToast(`${m.name} was let go as ${m.role}.`)
    get().save()
  },

  markRead: (id) => set((s) => ({ readNews: { ...s.readNews, [id]: true } })),

  showToast: (toast) => {
    set({ toast })
    setTimeout(() => get().clearToast(), 2800)
  },
  clearToast: () => set({ toast: null }),

  save: () => {
    const { career, activeTeamId, screen, readNews } = get()
    void saveGame({ world, career, activeTeamId, screen, readNews })
  },

  hydrate: async () => {
    // Pull the exact-ratings datasets (Madden 26 / CFB 26) so new worlds use them.
    await Promise.all([loadRealData(), loadCalibration()])
    const saved = await loadGame<{
      world: World; career: CareerState | null; activeTeamId: string
      screen: ScreenId; readNews: Record<string, boolean>
    }>()
    if (saved?.world && saved.career) {
      world = migrateWorld(saved.world)
      // Migrate saves created before the multi-dimensional reputation system.
      const career = migrateCareer(saved.career)
      set({
        career,
        activeTeamId: saved.activeTeamId ?? career.teamId,
        screen: saved.screen ?? 'career',
        readNews: saved.readNews ?? {},
        ready: true,
        tick: get().tick + 1,
      })
    } else {
      set({ ready: true })
    }
  },
}))

/** Push the user's coaching skill into the play engine before simulating. */
function applyUserCoaching(career: CareerState | null) {
  if (!career || career.path !== 'coach' || career.level < 2) {
    setUserCoaching(null)
    return
  }
  const b = userBonusFromSkills(career.skills, true, career.unitFocus === 'both' ? 'both' : career.unitFocus ?? 'both')
  setUserCoaching({
    teamId: career.teamId,
    off: b.off,
    def: b.def,
    development: b.development,
    situational: b.situational,
  })
}

/**
 * Live game driver: re-simulate the user's current-week game with the chosen
 * plan applied. The sim is deterministic, so changing a dial immediately shows
 * how the game plays out under those calls.
 */
function startLiveSim(
  get: () => GameStore,
  set: (p: Partial<GameStore>) => void,
  off: GamePlan,
  def: GamePlan,
) {
  const career = get().career
  if (!career) return
  const game = world.schedule.find(
    (g) => !g.played && g.week === world.week && (g.homeId === career.teamId || g.awayId === career.teamId),
  )
  if (!game) return
  const isHome = game.homeId === career.teamId
  setLivePlan({
    offTeamId: career.teamId,
    defTeamId: isHome ? game.awayId : game.homeId,
    off,
    def,
  })
  const sim = simulatePlayByPlay(world, game.homeId, game.awayId, world.seed + game.week * 7919 + 101)
  sim.box = boxScore(world, sim)
  setLivePlan(null)
  set({ liveGame: { gameId: game.id, off, def }, match: sim, tick: get().tick + 1 })
}

/** Add a career milestone to the inbox. */
function pushCareerNews(world: World, career: CareerState, item: { category: NewsItem['category']; headline: string; body: string }) {
  world.news.unshift({
    id: `career_${world.season}_${world.news.length}_${career.level}`,
    week: world.week,
    season: world.season,
    category: item.category,
    headline: item.headline,
    body: item.body,
    teamId: career.teamId,
    read: false,
  })
}

/** Bring a legacy save up to the current world shape (new fields + pick ownership). */
function migrateWorld(w: World): World {
  w.staffTenure ??= {}
  w.draftPicks ??= []
  w.draftRounds ??= []
  w.practiceSquad ??= {}
  w.ir ??= {}
  w.compLedger ??= {}
  if (!w.draftPicks.length) w.draftPicks = freshDraftPicks(w.season + 1)
  return w
}

/** Bring a legacy save (numeric reputation, single ladder) up to the current shape. */
function migrateCareer(c: CareerState): CareerState {
  const rep = c.reputation as unknown
  if (rep && typeof rep === 'object' && 'evaluation' in (rep as object)) {
    // Already migrated; just ensure skills exist.
    if (!c.skills || typeof c.skills !== 'object') {
      return { ...c, skills: { ...ZERO_SKILLS } }
    }
    return c
  }
  const legacy = typeof rep === 'number' ? rep : 20
  return {
    ...c,
    reputation: {
      evaluation: clamp(legacy, 0, 100),
      roster: clamp(Math.round(legacy * 0.7), 0, 100),
      leadership: clamp(Math.round(legacy * 0.6), 0, 100),
      results: clamp(Math.round(legacy * 0.5), 0, 100),
      profile: clamp(Math.round(legacy * 0.55), 0, 100),
    },
    skills: { ...ZERO_SKILLS },
  }
}

// ── Season transition ────────────────────────────────────────────────────────
function runEndOfRegularSeason(
  set: (p: Partial<GameStore>) => void,
  get: () => GameStore,
) {
  const career = get().career
  const playoffs = simulatePlayoffs(world)
  const collegeChampion = simulateCollegePlayoff(world)
  const mvp = computeMVP()
  world.awards = { mvp: mvp ?? undefined }

  const retired = developPlayers(world)
  tickAllContracts(world)

  // Coaching continuity: a settled staff ages up; a churned side resets to year 1.
  // Tenure lives entirely in world.staffTenure, keyed `${teamId}:off|def`.
  for (const key of Object.keys(world.staffTenure)) {
    const [teamId, side] = key.split(':')
    const role = side === 'off' ? 'Offensive Coordinator' : 'Defensive Coordinator'
    const coach = (world.staff[teamId] ?? []).find((s) => s.role === role)
    if (!coach || coach.scheme !== coach.scheme) {
      world.staffTenure[key] = 1
    } else {
      world.staffTenure[key] = (world.staffTenure[key] ?? 1) + 1
    }
  }

  // Playbook mastery grows between seasons (training, OTAs, camp).
  for (const teamId of Object.keys(world.roster)) {
    for (const p of world.roster[teamId]) {
      const next = gainSeasonTraining(p)
      if (next) p.playbook = next
    }
  }

  // Re-apply the cohesion cap now that tenures have advanced.
  refreshAllCohesion()

  // Snapshot the season into the career statistics database.
  recordTeamSeasons(world, statDb, { playoffSeeds: playoffs.seeds, champion: playoffs.champion, level: 'NFL' })
  recordTeamSeasons(world, statDb, { collegeChampion: collegeChampion ?? undefined, level: 'CFB' })
  recordPlayerSeasons(statDb, world.players)

  // Select this season's awards and All-Pro/All-Conference teams from production.
  const nflHonors = selectHonors(world, world.season, 'NFL')
  const cfbHonors = selectHonors(world, world.season, 'CFB')
  if (nflHonors) awards.seasons.push(nflHonors)
  if (cfbHonors) awards.seasons.push(cfbHonors)

  // Induct newly eligible legends into the Hall of Fame.
  const newInductees = computeHallOfFame(world, statDb, new Set(awards.inducted))
  for (const ind of newInductees) {
    awards.inducted.push(ind.playerId)
    awards.hof.push(ind)
  }

  let scout: ScoutingReport | null = null
  let careerNext = career
  let objs: Objective[] = []
  let graded: { repDelta: Partial<Reputation>; doneCount: number } = { repDelta: {}, doneCount: 0 }
  if (career) {
    scout = evaluateScouting(world, career)
    const rec = world.standings[career.teamId]
    // Did the team make the playoffs / win it all? (NFL seasons)
    const madePlayoffs = playoffs.seeds?.includes(career.teamId) ?? false
    const wonTitle = playoffs.champion === career.teamId || collegeChampion === career.teamId
    const review = reviewSeason(world, career, { wins: rec?.wins ?? 0, losses: rec?.losses ?? 0 }, madePlayoffs, wonTitle)

    // Per-role objectives for the season just played. Grade against the season
    // that was just recorded (scout results are folded in below via seasonHits).
    const seasonCareer: CareerState = {
      ...career,
      seasonRecs: scout.graded,
      seasonHits: scout.hits,
    }
    objs = roleObjectives(world, seasonCareer, { wins: rec?.wins ?? 0, losses: rec?.losses ?? 0 }, unitRanks(world, career.tier === 'NFL' ? 'NFL' : 'FBS')[career.teamId])
    graded = gradeObjectives(objs)

    // Fold the season into the multi-dimensional reputation.
    const rep: Reputation = { ...career.reputation }
    rep.evaluation = clamp(rep.evaluation + scout.repDelta, 0, 100)
    for (const [k, v] of Object.entries(review.repDelta)) {
      ;(rep as unknown as Record<string, number>)[k] = clamp(
        ((rep as unknown as Record<string, number>)[k] ?? 0) + (v as number),
        0,
        100,
      )
    }
    for (const [k, v] of Object.entries(graded.repDelta)) {
      ;(rep as unknown as Record<string, number>)[k] = clamp(
        ((rep as unknown as Record<string, number>)[k] ?? 0) + (v as number),
        0,
        100,
      )
    }
    // Skills grow with performance.
    const skills: Skills = { ...career.skills }
    skills.evaluation = clamp(skills.evaluation + (scout.accuracy >= 60 ? 3 : scout.graded > 0 ? 1 : 0), 0, 99)
    for (const [k, v] of Object.entries(review.skillDelta)) {
      ;(skills as unknown as Record<string, number>)[k] = clamp(
        ((skills as unknown as Record<string, number>)[k] ?? 0) + (v as number),
        0,
        99,
      )
    }
    // Exceptional scouting earns profile (connections) — the accelerator.
    if (scout.graded >= 5 && scout.accuracy >= 80) rep.profile = clamp(rep.profile + 4, 0, 100)
    if (wonTitle) rep.profile = clamp(rep.profile + 8, 0, 100)

    let nextSecurity = clamp(career.jobSecurity + review.securityDelta, 0, 100)
    // Fired if security bottoms out in a meaningful role.
    let demoted = false
    if (nextSecurity <= 0 && career.level > 0) {
      demoted = true
    }

    careerNext = {
      ...career,
      reputation: rep,
      skills,
      hits: career.hits + scout.hits,
      misses: career.misses + scout.misses,
      seasonHits: scout.hits,
      jobSecurity: nextSecurity,
      history: [
        ...career.history,
        {
          season: career.season,
          team: career.teamId,
          role: tierFor(career.path, career.level).title,
          record: `${rec?.wins ?? 0}-${rec?.losses ?? 0}`,
          outcome: wonTitle
            ? 'Won a championship'
            : madePlayoffs
              ? 'Made the playoffs'
              : `${scout.graded} recommends · ${scout.accuracy}% hit rate${retired ? ` · ${retired} retirements` : ''}`,
        },
      ],
    }
    if (demoted) {
      careerNext = demote(world, careerNext)
      pushCareerNews(world, careerNext, {
        category: 'Career',
        headline: `Fired: ${tierFor(career.path, career.level).title} role ends`,
        body: `After a season that fell short, you were let go as ${tierFor(career.path, career.level).title} for the ${world.byId[career.teamId].name}. You have landed on your feet as ${tierFor(careerNext.path, careerNext.level).title} with the ${world.byId[careerNext.teamId].name}. The climb restarts here.`,
      })
    } else if (wonTitle) {
      pushCareerNews(world, careerNext, {
        category: 'Career',
        headline: `Champions! Your ${world.byId[career.teamId].name} win it all`,
        body: `A title puts your name on every shortlist in football. Reputation and profile have surged heading into the offseason.`,
      })
    } else if (madePlayoffs) {
      pushCareerNews(world, careerNext, {
        category: 'Career',
        headline: `Playoff berth secured`,
        body: `Your team reached the postseason. League decision-makers are taking notice of your work.`,
      })
    } else {
      // Every season produces a review note, so the inbox always reflects your climb.
      const met = graded.doneCount
      const totalObjs = objs.length
      pushCareerNews(world, careerNext, {
        category: 'Career',
        headline: `${world.season} season review: ${tierFor(career.path, career.level).title}`,
        body: `You finished ${rec?.wins ?? 0}-${rec?.losses ?? 0} with the ${world.byId[career.teamId].name}, meeting ${met} of ${totalObjs} objectives. ${
          met >= totalObjs - 0
            ? 'A strong body of work — your stock is rising.'
            : met > 0
              ? 'Partial progress. Keep building.'
              : 'No objectives met. The pressure is real.'
        } Reputation: evaluation ${Math.round(rep.evaluation)}, roster ${Math.round(rep.roster)}, leadership ${Math.round(rep.leadership)}, results ${Math.round(rep.results)}, profile ${Math.round(rep.profile)}.`,
      })
    }
  }

  awardCompensatoryPicks(world)
  initDraft(world)
  const offers = careerNext ? generateJobOffers(world, careerNext) : []
  world.phase = 'offseason'

  const rec = world.standings[careerNext?.teamId ?? 'BUF']
  const summary: SeasonSummary = {
    season: world.season,
    champion: playoffs.champion,
    collegeChampion,
    mvp,
    scout,
    record: `${rec?.wins ?? 0}-${rec?.losses ?? 0}`,
    reviewNote: scout
      ? scout.graded === 0
        ? 'You filed no recommendations this cycle. Get on the road next season.'
        : `${scout.hits} hits / ${scout.misses} misses · reputation ${scout.repDelta >= 0 ? '+' : ''}${scout.repDelta}`
      : '',
    objectives: objs,
    objectivesDone: graded.doneCount,
  }

  set({
    career: careerNext,
    offers,
    summary,
    modal: 'seasonReview',
    tick: get().tick + 1,
  })
}

function computeMVP(): string | null {
  const nfl = world.teams.filter((t) => t.tier === 'NFL')
  let best: { name: string; score: number } | null = null
  for (const t of nfl) {
    const rec = world.standings[t.id]
    const winBonus = (rec?.wins ?? 0) * 1.4
    for (const p of world.roster[t.id] ?? []) {
      const posBonus = p.pos === 'QB' ? 6 : p.side === 'OFF' ? 2 : 0
      const score = p.ovr + winBonus + posBonus
      if (!best || score > best.score) best = { name: p.name, score }
    }
  }
  return best?.name ?? null
}

export { teamStrength, capSavings, makeVeteranContract, currentTeamId, overallPick, currentRound }

/** Dev-only probe: prove staff quality changes scoring. */
export function staffProbe(games = 60) {
  const nfl = world.teams.filter((t) => t.tier === 'NFL')
  const rng = makeRng(world.seed + 4242)
  // Rank teams by head-coach + coordinator quality.
  const byStaff = [...nfl].sort((a, b) => {
    const q = (id: string) => {
      const s = world.staff[id] ?? []
      return s.filter((m) => ['Head Coach', 'Offensive Coordinator', 'Defensive Coordinator'].includes(m.role))
        .reduce((sum, m) => sum + m.rating, 0)
    }
    return q(b.id) - q(a.id)
  })
  const good = byStaff.slice(0, 8)
  const bad = byStaff.slice(-8)
  const play = (a: typeof nfl[0], b: typeof nfl[0]) => {
    const s = simulatePlayByPlay(world, a.id, b.id, world.seed + games * 31 + a.id.length + b.id.length)
    return s
  }
  let goodTotal = 0
  let badTotal = 0
  let n = 0
  for (let i = 0; i < games; i++) {
    const g1 = good[Math.floor(rng() * good.length)]
    const b1 = bad[Math.floor(rng() * bad.length)]
    const s1 = play(g1, b1)
    // g1 is home; good staff should outscore bad staff
    goodTotal += Math.max(s1.homeScore, s1.awayScore) === s1.homeScore ? s1.homeScore : s1.awayScore
    badTotal += Math.max(s1.homeScore, s1.awayScore) === s1.homeScore ? s1.awayScore : s1.homeScore
    n++
  }
  return { games: n, eliteStaffPoints: +(goodTotal / n).toFixed(1), poorStaffPoints: +(badTotal / n).toFixed(1) }
}

/** Dev-only probe: does cohesion change penalties and scoring? */
export function cohesionProbe(games = 60) {
  const nfl = world.teams.filter((t) => t.tier === 'NFL')
  const scored = nfl.map((t) => ({
    t,
    c: teamCohesion(world.roster[t.id] ?? [], world.staffTenure, t.id).avg,
  }))
  scored.sort((a, b) => b.c - a.c)
  const tight = scored.slice(0, 6)
  const churn = scored.slice(-6)
  let tightPen = 0
  let churnPen = 0
  let tightPts = 0
  let churnPts = 0
  let n = 0
  for (let i = 0; i < games; i++) {
    const a = tight[i % tight.length].t
    const b = churn[i % churn.length].t
    const sim = simulatePlayByPlay(world, a.id, b.id, world.seed + 51000 + i * 7919)
    for (const p of sim.plays) {
      if (p.type !== 'penalty') continue
      const penalized = p.concept === 'Offensive Penalty' ? p.offId : p.defId
      if (penalized === a.id) tightPen++
      if (penalized === b.id) churnPen++
    }
    if (a.id === sim.homeId) {
      tightPts += sim.homeScore
      churnPts += sim.awayScore
    } else {
      tightPts += sim.awayScore
      churnPts += sim.homeScore
    }
    n++
  }
  return {
    games: n,
    tightCohesion: +(tight.reduce((s, x) => s + x.c, 0) / tight.length).toFixed(2),
    churnCohesion: +(churn.reduce((s, x) => s + x.c, 0) / churn.length).toFixed(2),
    tightPenaltiesPerGame: +(tightPen / n).toFixed(2),
    churnPenaltiesPerGame: +(churnPen / n).toFixed(2),
    tightPoints: +(tightPts / n).toFixed(1),
    churnPoints: +(churnPts / n).toFixed(1),
  }
}

/** Dev-only probe: inspect draft-pick ownership and the built draft order. */
export function draftProbe() {
  const picks = world.draftPicks ?? []
  const nfl = world.teams.filter((t) => t.tier === 'NFL').length
  const byOwner = new Map<string, number>()
  for (const p of picks) byOwner.set(p.ownerTeam, (byOwner.get(p.ownerTeam) ?? 0) + 1)
  const built = buildDraftOrder(world)
  return {
    totalPicks: picks.length,
    expectedBase: nfl * 7,
    compPicks: picks.filter((p) => p.comp).length,
    teamsWithExtraPicks: [...byOwner.values()].filter((v) => v > 7).length,
    orderLength: built.order.length,
    roundsSpan: built.rounds.length ? [built.rounds[0], built.rounds[built.rounds.length - 1]] : [],
    firstFive: built.order.slice(0, 5).map((id) => world.byId[id]?.abbr ?? id),
  }
}

/** Dev-only probe: sample a trade evaluation against a partner. */
export function tradeProbe(partnerId = 'MIA', userTeamId = 'BUF') {
  const user = [...(world.roster[userTeamId] ?? [])].sort((a, b) => b.ovr - a.ovr).find((p) => p.ovr >= 75)
  const their = [...(world.roster[partnerId] ?? [])].sort((a, b) => b.ovr - a.ovr).find((p) => p.ovr >= 75)
  if (!user || !their) return { error: 'no sample players' }
  const give = [{ kind: 'player' as const, id: user.id }]
  const get = [{ kind: 'player' as const, id: their.id }]
  return {
    userTeam: userTeamId,
    userAsset: `${user.name} (${user.ovr}, age ${user.age})`,
    partnerAsset: `${their.name} (${their.ovr}, age ${their.age})`,
    verdict: evaluateTrade(world, partnerId, userTeamId, give, get),
  }
}

/** Dev-only probe: run the end-of-season contract/comp/draft flow on a clone. */
export function seasonProbe() {
  const clone = structuredClone(world) as World
  clone.compLedger = { BUF: { lost: 3, gained: 0 }, MIA: { lost: 1, gained: 2 } }
  tickAllContracts(clone)
  const awarded = awardCompensatoryPicks(clone)
  initDraft(clone)
  return {
    freeAgents: clone.freeAgents.length,
    compAwarded: awarded,
    orderLength: clone.draftOrder.length,
    picks: clone.draftPicks.length,
    compPicks: clone.draftPicks.filter((p) => p.comp).length,
  }
}

/** Dev-only probe: verify comp-pick awards feed into the built draft order. */
export function draftFlowProbe() {
  const clone = structuredClone(world) as World
  clone.compLedger = {
    BUF: { lost: 4, gained: 1 },
    MIA: { lost: 2, gained: 0 },
    NYJ: { lost: 1, gained: 0 },
    DAL: { lost: 0, gained: 3 },
  }
  const awarded = awardCompensatoryPicks(clone)
  const built = buildDraftOrder(clone)
  const compPicks = clone.draftPicks.filter((p) => p.comp)
  return {
    awarded,
    orderLength: built.order.length,
    expectedLength: 224 + awarded,
    compPicks: compPicks.length,
    compRecipients: [...new Set(compPicks.map((p) => p.ownerTeam))],
    compRounds: compPicks.map((p) => p.round),
  }
}

/** Dev-only balance probe: simulate many matchups and report per-team-per-game stats. */
export function simTest(games = 80, tier: 'NFL' | 'FBS' = 'NFL') {
  const pool = world.teams.filter((t) => t.tier === tier)
  const rng = makeRng(world.seed + 999331)
  const keys = ['points', 'plays', 'passAtt', 'passComp', 'passYds', 'passTD', 'ints', 'rushAtt', 'rushYds', 'rushTD', 'sacks', 'firstDowns', 'thirdDownAtt', 'thirdDownConv', 'fgAtt', 'fgMade', 'td', 'top'] as const
  const acc: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]))
  let made = 0
  let margin = 0
  let rzTrips = 0
  let rzTD = 0
  let rzFG = 0
  let drives = 0
  while (made < games) {
    const h = pool[Math.floor(rng() * pool.length)]
    const a = pool[Math.floor(rng() * pool.length)]
    if (h.id === a.id) continue
    const sim = simulatePlayByPlay(world, h.id, a.id, world.seed + made * 7919 + 101)
    for (const k of keys) acc[k] += sim.stats.home[k]
    margin += Math.abs(sim.homeScore - sim.awayScore)
    // drive/red-zone accounting for the home team
    let inRZ = false
    let reachedRZ = false
    for (const p of sim.plays) {
      if (p.offId !== h.id) continue
      if (p.down === 1 && p.startYard <= 40 === false) drives++
      if (p.startYard >= 80 && !reachedRZ) { reachedRZ = true; rzTrips++; inRZ = true }
      if (p.result === 'TOUCHDOWN!' && inRZ) rzTD++
      if (/FG is good/.test(p.result) && inRZ) rzFG++
      if (/End of|TOUCHDOWN|no good|Interception|Turnover/.test(p.result) || p.result.includes('halftime')) inRZ = false
    }
    if (reachedRZ && !inRZ) inRZ = false
    made++
  }
  const avg = (k: string) => acc[k] / made
  return {
    tier,
    games: made,
    points: +avg('points').toFixed(1),
    td: +avg('td').toFixed(2),
    fgMade: +avg('fgMade').toFixed(2),
    rzTripsPerGame: +(rzTrips / made).toFixed(2),
    rzTDPerGame: +(rzTD / made).toFixed(2),
    rzFGPerGame: +(rzFG / made).toFixed(2),
    rzTDPct: +((rzTD / Math.max(1, rzTrips)) * 100).toFixed(1),
    plays: +avg('plays').toFixed(1),
    passAtt: +avg('passAtt').toFixed(1),
    passComp: +avg('passComp').toFixed(1),
    compPct: +((avg('passComp') / Math.max(1, avg('passAtt'))) * 100).toFixed(1),
    passYds: +avg('passYds').toFixed(1),
    passTD: +avg('passTD').toFixed(1),
    ints: +avg('ints').toFixed(2),
    rushAtt: +avg('rushAtt').toFixed(1),
    rushYds: +avg('rushYds').toFixed(1),
    ypc: +(avg('rushYds') / Math.max(1, avg('rushAtt'))).toFixed(2),
    rushTD: +avg('rushTD').toFixed(2),
    sacks: +avg('sacks').toFixed(2),
    firstDowns: +avg('firstDowns').toFixed(1),
    thirdDownPct: +((avg('thirdDownConv') / Math.max(1, avg('thirdDownAtt'))) * 100).toFixed(1),
    fgAtt: +avg('fgAtt').toFixed(2),
    totalYds: Math.round(avg('passYds') + avg('rushYds')),
    topSec: Math.round(avg('top')),
    avgMargin: +(margin / made).toFixed(1),
  }
}

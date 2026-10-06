import { create } from 'zustand'
import {
  buildWorld,
  fitToCap,
  regenerateSchedule,
  teamStrength,
  zeroRecord,
  ERAS,
  type World,
} from '../game/engine/generate'
import { finalizeGame, healAfterWeek, simWeek, simulatePlayoffs } from '../game/engine/sim'
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
import { recordGameStats, boxScore, recordBoxLines } from '../game/engine/stats'
import { simLeagueGames } from '../game/engine/leagueSim'
import {
  developPlayers,
  evaluateScouting,
  refreshProspectClass,
  runAIFreeAgency,
  runAIResign,
  runAITrades,
  enforceCapCompliance,
  tickAllContracts,
  updateStaffLedgers,
  type ScoutingReport,
} from '../game/engine/progress'
import {
  canSignFreeAgents,
  generateJobOffers,
  gradeObjectives,
  ladderFor,
  makeInterview,
  minNflLevel,
  promote,
  resolveInterview,
  reviewSeason,
  roleObjectives,
  salaryFor,
  tierFor,
  unitRanks,
  updateRoleMastery,
  ZERO_REP,
  ZERO_SKILLS,
  type Objective,
  type Reputation,
  type Skills,
} from '../game/engine/career'
import { snapshotDevBaseline } from '../game/engine/objectives'
import { clamp, hash32 } from '../game/engine/rng'
import {
  currentRound,
  currentTeamId,
  initDraft,
  buildDraftOrder,
  DRAFT_ROUNDS,
  makePick,
  overallPick,
  runUDFAs,
  simUntilUser,
  simulateRestOfDraft,
  userOnClock,
  awardCompensatoryPicks,
} from '../game/engine/draft'
import { freshDraftPicks, ledgerFreeAgent } from '../game/engine/picks'
import { canSetTrust, calibrationGain } from '../game/engine/department'
import { MAX_CONVICTION, canConvict, convictionPayout, logConvictionPicks } from '../game/engine/conviction'
import { pitchBonus, portfolioItems } from '../game/engine/portfolio'
import { MAX_ROOM_FOCUS, applyRoomDevelopment, hasRoom, roomPlayers, type RoomGain } from '../game/engine/room'
import { evaluateTrade, executeTrade, type TradeAsset } from '../game/engine/trade'
import { recordTrade, resolveTradePicks } from '../game/engine/tradeTree'
import { accessFor } from '../game/engine/access'
import { moveInDepth, resetDepth, setStarterInDepth } from '../game/engine/depth'
import {
  advanceContacts,
  advanceRivals,
  growCoachingTree,
  makeContacts,
  mediaItems,
  mentorFor,
  ownerMandate,
} from '../game/engine/people'
import { evaluateTraits } from '../game/engine/earnedTraits'
import { applyWilderness, makeSuccessor } from '../game/engine/legacy'
import { pushLedger, gradeLedger } from '../game/engine/ledger'
import { CHARACTER_FACETS, FACET_LABEL, revealFacet } from '../game/engine/character'
import { learnedBias, scoutReport, isEvaluator } from '../game/engine/scoutBias'
import { currentDilemma, applyDilemma } from '../game/engine/dilemma'
import { recordGhostSeason } from '../game/engine/ghost'
import { makeSeasonQuestion, answerSeasonQuestion, topMoments, fingerprintSummary, seasonHeadline, logMoment } from '../game/engine/recap'
import { MAX_AMBITIONS, makeAmbitionPool, gradeAmbitions } from '../game/engine/ambitions'
import {
  WEEK_HOURS,
  weeklyActions,
  currentSetPiece,
  resolveSetPiece as applySetPiece,
  maybeStretch,
  stretchOutcome,
} from '../game/engine/weekly'
import {
  capForSeason,
  capSavings,
  deadMoney,
  extendContract,
  makeVeteranContract,
  restructure,
  summarizeCap,
} from '../game/engine/cap'
import { makeRng } from '../game/engine/rng'
import { applyScenario, scenarioById } from '../game/engine/scenarios'
import type { CareerPath, CareerState, JobOffer, LeagueTier, NewsItem, Position, ScenarioId, SeasonMoment, SeasonQuestion } from '../game/types'
import { loadGame, loadBackup, saveGame, clearSave, exportSave, importSave } from '../game/persistence'
import { loadRealData, getRealData } from '../game/data/realData'
import { NFL_TEAMS } from '../game/data/nflTeams'
import { loadCalibration } from '../game/data/calibration'
import { runBalance } from '../game/engine/balance'

export type ScreenId =
  | 'career' | 'dashboard' | 'ledger' | 'roster' | 'depth' | 'gameplan' | 'staff' | 'scouting' | 'draft'
  | 'freeagency' | 'trades' | 'cap' | 'schedule' | 'standings'
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
  { id: 'ledger', label: 'The Ledger', group: 'Career', tiers: ['NFL', 'FBS', 'FCS'] },
  { id: 'scouting', label: 'Scouting', group: 'Career', tiers: ['NFL', 'FBS', 'FCS'] },
  { id: 'roster', label: 'Roster', group: 'Team', tiers: ['NFL', 'FBS', 'FCS'] },
  { id: 'depth', label: 'Depth Chart', group: 'Team', tiers: ['NFL', 'FBS', 'FCS'] },
  { id: 'gameplan', label: 'Game Plan', group: 'Team', tiers: ['NFL', 'FBS', 'FCS'] },
  { id: 'schedule', label: 'Schedule', group: 'Team', tiers: ['NFL', 'FBS', 'FCS'] },
  { id: 'draft', label: 'Draft Board', group: 'Personnel', tiers: ['NFL'] },
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
  mvp: string | null
  scout: ScoutingReport | null
  record: string
  reviewNote: string
  objectives?: Objective[]
  objectivesDone?: number
  // #20 recap
  headline?: string
  winsDelta?: number
  moments?: SeasonMoment[]
  fingerprint?: { drafted: number; signed: number; total: number }
  question?: SeasonQuestion
  ghost?: { actualWins: number; ghostWins: number; delta: number }
  // #11 ambitions
  ambitions?: { label: string; done: boolean }[]
}

/** The persisted payload. Kept independent of store internals for migration. */
export interface SaveData {
  world: World
  career: CareerState | null
  activeTeamId: string
  screen: ScreenId
  readNews: Record<string, boolean>
}

/** A human-readable summary of an available save for the "Continue" card. */
export interface SaveInfo {
  savedAt: number
  season: number
  teamName: string
  title: string
  tier: LeagueTier
  usedBackup: boolean
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
  /** A validated save waiting to be resumed from the career hub. */
  pendingSave: SaveData | null
  saveInfo: SaveInfo | null
  /** Set when the last load recovered from a problem (shown on the hub). */
  saveError: string | null
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
  /** Opt-in: run the whole league's games through true play-by-play (Web Worker). */
  leaguePbp: boolean
  setLeaguePbp: (v: boolean) => void
  setScreen: (s: ScreenId) => void
  setActiveTeam: (id: string) => void
  selectPlayer: (id: string | null) => void
  selectProspect: (id: string | null) => void
  /** Depth chart: move a player up/down or promote him to starter for your club. */
  moveDepth: (pos: Position, playerId: string, dir: -1 | 1) => void
  setStarter: (pos: Position, playerId: string) => void
  /** Depth chart: drop your club's stored order and fall back to ratings. */
  resetDepthChart: () => void
  startCareer: (opts: { name: string; path: CareerPath; archetype: string; teamId: string; startLevel?: number; seed?: number; scenarioId?: ScenarioId }) => void
  resetCareer: () => void
  advanceWeek: () => void
  startNextSeason: () => void
  dismissModal: () => void
  /** Resume the validated save held by the career hub. */
  continueCareer: () => void
  /** Abandon the available save (used by "start fresh" on the hub). */
  discardSave: () => void
  openMatch: (gameId: string) => void
  closeMatch: () => void

  scoutProspect: (id: string) => void
  setRecommendation: (id: string, rec: 'Blue Chip' | 'Starter' | 'Depth' | 'Pass') => void
  /** Advise mode: add/remove a prospect from your ranked board for the draft. */
  toggleUserBoard: (id: string) => void
  /** G1: set how much you trust an evaluator's reports (Fade / Normal / Lean on). */
  setScoutTrust: (staffId: string, level: 'fade' | 'normal' | 'lean') => void
  /** G2: tag/untag a prospect as a conviction call for this draft (max 3). */
  toggleConviction: (prospectId: string) => void
  /** G3: add/remove a player from your room's focus list (max 3). */
  toggleRoomFocus: (playerId: string) => void
  /** G3: choose your room's practice plan (Concentrate or Spread). */
  setRoomPlan: (plan: 'concentrate' | 'spread') => void
  /** Work the phones to uncover one hidden character facet of a prospect. */
  investigateCharacter: (id: string) => void
  /** Spend part of the weekly time budget on an action (#5). */
  spendHours: (id: string) => void
  /** Resolve this season's annual set piece (#6). */
  resolveSetPiece: (choice: string) => void
  resolveDilemma: (choice: string) => void
  pickAmbition: (id: string) => void
  dropAmbition: (id: string) => void
  /** Accept/decline a stretch assignment (#8). */
  acceptStretch: () => void
  declineStretch: () => void
  /** Pick a road back after a firing (#17). */
  chooseWilderness: (pathId: string) => void
  /** Retire and continue as a protégé (#19). */
  startSuccessor: (name: string) => void
  /** Export/import saves as JSON files. */
  exportSaveText: () => Promise<string | null>
  importSaveText: (text: string) => Promise<void>

  acceptOffer: (offer: JobOffer, pitch?: string[]) => void
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

/** Mark a weekly-checklist task complete on the career (immutably). */
function withFlag(career: CareerState, key: string): CareerState {
  return { ...career, weekFlags: { ...(career.weekFlags ?? {}), [key]: true } }
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
  pendingSave: null,
  saveInfo: null,
  saveError: null,
  match: null,
  liveGame: null,
  defaultPlan: { off: { ...BALANCED_PLAN }, def: { ...BALANCED_PLAN } },
  leaguePbp: false,

  statsDb: () => statDb,
  setScreen: (screen) => set({ screen }),
  setActiveTeam: (activeTeamId) => set({ activeTeamId }),
  selectPlayer: (selectedPlayerId) => set({ selectedPlayerId }),
  selectProspect: (selectedProspectId) => set({ selectedProspectId }),

  moveDepth: (pos, playerId, dir) => {
    const career = get().career
    if (!career) return
    moveInDepth(world, career.teamId, pos, playerId, dir)
    bump(set, get)
    get().save()
  },
  setStarter: (pos, playerId) => {
    const career = get().career
    if (!career) return
    setStarterInDepth(world, career.teamId, pos, playerId)
    bump(set, get)
    get().save()
  },
  resetDepthChart: () => {
    const career = get().career
    if (!career) return
    resetDepth(world, career.teamId)
    bump(set, get)
    get().save()
  },

  startCareer: ({ name, path: chosenPath, archetype, teamId: chosenTeamId, startLevel = 0, seed, scenarioId }) => {
    world = buildWorld(seed ?? (Date.now() % 2147483647), getRealData())
    initAllPlaybooks()
    // A scenario can override the path, the starting rung and the club.
    const scenario = scenarioById(scenarioId)
    const path = scenario.path ?? chosenPath
    const teamId = scenario.forceLowestPrestige
      ? [...NFL_TEAMS].sort((a, b) => a.prestige - b.prestige)[0].id
      : chosenTeamId
    const ladder = ladderFor(path)
    const level = scenario.level ?? Math.max(minNflLevel(path), Math.min(ladder.length - 1, startLevel))
    const tier = tierFor(path, level).tier
    const resolvedTeam = world.byId[teamId]?.tier === tier ? teamId : 'BUF'
    // Starting at a higher rung seeds the reputation needed to have earned it.
    const seedRep: Reputation = { ...ZERO_REP }
    for (const [k, v] of Object.entries(ladder[level].gate)) {
      ;(seedRep as unknown as Record<string, number>)[k] = Math.max(
        (seedRep as unknown as Record<string, number>)[k] ?? 0,
        (v as number) + 2,
      )
    }
    let career: CareerState = {
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
      ownerExpectation: ownerMandate(resolvedTeam, tier),
      tier,
      recommendationsMade: 0,
      hits: 0,
      misses: 0,
      seasonRecs: 0,
      seasonHits: 0,
      hoursLeft: WEEK_HOURS,
      ledger: [],
      contacts: makeContacts(makeRng(world.seed + world.season * 77), 'National'),
      earnedTraits: [],
      mentor: mentorFor(world, resolvedTeam),
      weekFlags: {},
      tree: [],
      history: [],
      seasonMoments: [],
      ambitions: [],
    }
    career = applyScenario(world, career, scenario)
    career.seasonQuestion = makeSeasonQuestion(world, career)
    career.devBaseline = snapshotDevBaseline(world, career)
    set({
      career,
      activeTeamId: resolvedTeam,
      screen: 'career',
      scoutingPoints: MAX_SCOUT_POINTS,
      offers: [],
      modal: 'none',
      summary: null,
      pendingSave: null,
      saveInfo: null,
      saveError: null,
      match: null,
      tick: get().tick + 1,
    })
    get().save()
  },

  resetCareer: () => {
    world = buildWorld(20261004, getRealData())
    initAllPlaybooks()
    void clearSave()
    set({ career: null, screen: 'career', tick: get().tick + 1, summary: null, modal: 'none', offers: [], match: null, pendingSave: null, saveInfo: null, saveError: null })
  },

  advanceWeek: async () => {
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
    // Authentic mode runs the whole league through play-by-play in a worker,
    // falling back to the fast allocator if the worker is unavailable.
    if (get().leaguePbp) {
      const ok = await simulateLeagueWeek(world, week, userGame?.id)
      if (!ok) simWeek(world, week, userGame?.id)
    } else {
      simWeek(world, week, userGame?.id)
    }
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
    let nextCareer: CareerState = { ...c, week: world.week, season: world.season, hoursLeft: WEEK_HOURS, weekFlags: {} }
    // #20: log only the notable results — blowouts and thrillers — so the
    // season recap has a handful of real moments, not 18.
    if (sim && userGame) {
      const isHome = userGame.homeId === c.teamId
      const myScore = isHome ? sim.homeScore : sim.awayScore
      const oppScore = isHome ? sim.awayScore : sim.homeScore
      const oppTeam = world.byId[isHome ? userGame.awayId : userGame.homeId]
      const margin = myScore - oppScore
      if (margin >= 17) nextCareer = logMoment(nextCareer, { week, text: `Blew out the ${oppTeam.name} ${myScore}-${oppScore}.`, tone: 'win' })
      else if (margin >= 1 && margin <= 3) nextCareer = logMoment(nextCareer, { week, text: `Won a thriller over the ${oppTeam.name}, ${myScore}-${oppScore}.`, tone: 'win' })
      else if (margin <= -17) nextCareer = logMoment(nextCareer, { week, text: `Routed by the ${oppTeam.name}, ${myScore}-${oppScore}.`, tone: 'loss' })
    }
    // The week's ONE big decision (#2). Generated from the new week's state.
    nextCareer = { ...nextCareer, dilemma: currentDilemma(world, nextCareer) ?? undefined }
    // Offer a stretch assignment from the rung above (once a season).
    if (!nextCareer.stretch && world.phase === 'regular') {
      const offer = maybeStretch(world, nextCareer, makeRng(world.seed + world.season * 613 + world.week))
      if (offer) {
        nextCareer = { ...nextCareer, stretch: offer }
        pushCareerNews(world, nextCareer, {
          category: 'Career',
          headline: `Stretch assignment offered: ${offer.label}`,
          body: offer.blurb,
        })
      }
    }
    // Media layer: the world notices you (#13).
    if (world.phase === 'regular' && makeRng(world.seed + world.season * 911 + world.week * 13 + 1)() < 0.6) {
      for (const m of mediaItems(world, nextCareer, makeRng(world.seed + world.season * 911 + world.week))) {
        world.news.unshift({ id: `media_${world.season}_${world.week}_${world.news.length}`, week: world.week, season: world.season, category: m.category, headline: m.headline, body: m.body, teamId: nextCareer.teamId, read: false })
      }
    }
    set({ career: nextCareer, match: sim, tick: get().tick + 1 })
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
    const career = get().career
    set({
      defaultPlan: { ...get().defaultPlan, [side]: plan },
      career: career ? withFlag(career, 'gameplan') : career,
      tick: get().tick + 1,
    })
    get().save()
  },

  setLeaguePbp: (v) => {
    set({ leaguePbp: v, tick: get().tick + 1 })
    get().showToast(v ? 'Authentic league sim ON — every game runs play-by-play.' : 'Fast league sim restored.')
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
    // G2: log conviction calls for anyone drafted before the class rolls over.
    logConvictionPicks(world, career)
    runAIFreeAgency(world, career.teamId)
    runAITrades(world)
    world.season += 1
    world.week = 1
    world.phase = 'regular'
    world.awards = {}
    // #18: the league changes over the eras every few seasons.
    if (world.season % 6 === 0) world.era = ERAS[Math.floor(world.season / 6) % ERAS.length]
    // Fresh draft capital for the next cycle's Trade Center.
    resolveTradePicks(world, career)
    world.draftPicks = freshDraftPicks(world.season + 1)
    world.draftRounds = []
    for (const id of Object.keys(world.standings)) world.standings[id] = zeroRecord(id)
    for (const id of Object.keys(world.deadMoney)) world.deadMoney[id] = 0
    regenerateSchedule(world)
    refreshProspectClass(world)
    enforceCapCompliance(world)
    // If a firing was never resolved, take the default road back (#17).
    const resolved = career.wilderness && !career.wilderness.path ? applyWilderness(world, career, 'consult') : career
    // #11/#20: a fresh season question, clean moment log, and a new ambition slate.
    const seasonCareer: CareerState = {
      ...resolved,
      season: world.season,
      week: 1,
      seasonRecs: 0,
      seasonHits: 0,
      seasonMoments: [],
      ambitions: [],
    }
    seasonCareer.seasonQuestion = makeSeasonQuestion(world, seasonCareer)
    seasonCareer.devBaseline = snapshotDevBaseline(world, seasonCareer)
    // G3: a new season empties the rep bank and drops anyone who left the room.
    if (hasRoom(seasonCareer)) {
      const still = new Set(roomPlayers(world, seasonCareer).map((p) => p.id))
      const room: NonNullable<CareerState['room']> = seasonCareer.room ?? { focus: [], plan: 'concentrate', reps: 0 }
      seasonCareer.room = { ...room, reps: 0, focus: room.focus.filter((id) => still.has(id)) }
    }
    set({
      career: seasonCareer,
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

  continueCareer: () => {
    const p = get().pendingSave
    if (!p || !p.career) return
    world = migrateWorld(p.world)
    const career = reconcileCareerTeam(world, migrateCareer(p.career))
    set({
      career,
      activeTeamId: p.activeTeamId && world.byId[p.activeTeamId] ? p.activeTeamId : career.teamId,
      screen: p.screen ?? 'career',
      readNews: p.readNews ?? {},
      pendingSave: null,
      saveInfo: null,
      saveError: null,
      tick: get().tick + 1,
    })
    get().showToast('Career resumed.')
  },

  discardSave: () => {
    void clearSave()
    set({ pendingSave: null, saveInfo: null, saveError: null, tick: get().tick + 1 })
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
    p.myGrade = Math.round(current + (target - current) * 0.4 + (makeRng(hash32(p.id, world.season * 31 + (p.confidence | 0)))() - 0.5) * 6)
    p.confidence = Math.min(100, p.confidence + 24)
    p.scoutConfidence = Math.min(100, p.scoutConfidence + 20)
    const c = get().career
    set({ scoutingPoints: get().scoutingPoints - 1, career: c ? withFlag(c, 'scout') : c, tick: get().tick + 1 })
    get().save()
  },

  setRecommendation: (id, rec) => {
    const p = world.draft.find((d) => d.id === id)
    if (!p) return
    const isNew = !p.recommendation
    p.recommendation = rec
    const career = get().career
    if (career && isNew) {
      // Every filed recommendation is a dated call in the Ledger.
      pushLedger(career, {
        kind: 'recommendation',
        prospectId: p.id,
        name: p.name,
        pos: p.pos,
        college: p.college,
        myGrade: p.myGrade ?? p.grade,
        recommendation: rec,
        truth: p.trueGrade,
        note: `${rec} — ${p.pos}, ${p.college}`,
      })
      set({
        career: withFlag(
          { ...career, recommendationsMade: career.recommendationsMade + 1, seasonRecs: career.seasonRecs + 1 },
          'grade',
        ),
        tick: get().tick + 1,
      })
    } else if (career) {
      set({ career: withFlag(career, 'grade'), tick: get().tick + 1 })
    } else {
      bump(set, get)
    }
    get().save()
  },

  toggleUserBoard: (id) => {
    const career = get().career
    if (!career) return
    if (accessFor(career, 'draft') === 'decide') {
      get().showToast('You hold the pen here — set your board and draft directly.')
      return
    }
    const board = [...(career.userBoard ?? [])]
    const i = board.indexOf(id)
    if (i >= 0) board.splice(i, 1)
    else board.push(id)
    set({ career: { ...career, userBoard: board }, tick: get().tick + 1 })
    get().save()
  },

  setScoutTrust: (staffId, level) => {
    const career = get().career
    if (!career || !canSetTrust(career)) return
    set({
      career: { ...career, scoutTrust: { ...(career.scoutTrust ?? {}), [staffId]: level } },
      tick: get().tick + 1,
    })
    get().save()
  },

  toggleConviction: (prospectId) => {
    const career = get().career
    if (!career || !canConvict(career)) return
    const current = career.conviction?.season === world.season ? career.conviction.ids : []
    let ids: string[]
    if (current.includes(prospectId)) {
      ids = current.filter((id) => id !== prospectId)
    } else {
      if (current.length >= MAX_CONVICTION) {
        get().showToast(`Pound the table is full — ${MAX_CONVICTION} calls per draft.`)
        return
      }
      ids = [...current, prospectId]
    }
    set({
      career: { ...career, conviction: { season: world.season, ids } },
      tick: get().tick + 1,
    })
    get().save()
  },

  toggleRoomFocus: (playerId) => {
    const career = get().career
    if (!career || !hasRoom(career)) return
    const room = career.room ?? { focus: [], plan: 'concentrate', reps: 0 }
    const focus = [...room.focus]
    const i = focus.indexOf(playerId)
    if (i >= 0) focus.splice(i, 1)
    else {
      if (focus.length >= MAX_ROOM_FOCUS) {
        get().showToast(`Your room focuses on ${MAX_ROOM_FOCUS} players at a time.`)
        return
      }
      focus.push(playerId)
    }
    set({ career: { ...career, room: { ...room, focus } }, tick: get().tick + 1 })
    get().save()
  },

  setRoomPlan: (plan) => {
    const career = get().career
    if (!career || !hasRoom(career)) return
    const room = career.room ?? { focus: [], plan: 'concentrate', reps: 0 }
    set({ career: { ...career, room: { ...room, plan } }, tick: get().tick + 1 })
    get().save()
  },

  investigateCharacter: (id) => {
    const career = get().career
    if (!career) return
    const p = world.draft.find((d) => d.id === id)
    if (!p || !p.character) return
    if (get().scoutingPoints <= 0) {
      get().showToast('No scouting points left this week.')
      return
    }
    const reads = p.characterReads ?? []
    if (reads.length >= CHARACTER_FACETS.length) {
      get().showToast('You already know everything about him off the field.')
      return
    }
    // Accuracy from your Evaluation skill and reputation.
    const accuracy = clamp(0.4 + career.skills.evaluation / 200 + career.reputation.evaluation / 500, 0.4, 0.92)
    const rng = makeRng(world.seed + world.season * 811 + hash32(p.id, 9))
    const read = revealFacet(p.character, reads, accuracy, rng)
    if (!read) return
    p.characterReads = [...reads, read]
    const c2 = get().career
    set({ scoutingPoints: get().scoutingPoints - 1, career: c2 ? withFlag(c2, 'character') : c2, tick: get().tick + 1 })
    get().showToast(`Worked the phones: ${FACET_LABEL[read.facet]} — ${read.label}.`)
    get().save()
  },

  spendHours: (id) => {
    const career = get().career
    if (!career) return
    const action = weeklyActions(career).find((a) => a.id === id)
    if (!action) return
    const left = career.hoursLeft ?? WEEK_HOURS
    if (left < action.cost) {
      get().showToast('Not enough hours left this week.')
      return
    }
    const rep: Reputation = { ...career.reputation }
    const skills: Skills = { ...career.skills }
    let note = ''
    let jobSecurity = career.jobSecurity
    let nextRoom: CareerState['room']
    switch (id) {
      case 'film':
        skills.evaluation = clamp(skills.evaluation + 1, 0, 99)
        note = 'Film study: your eye sharpens (+Evaluation).'
        break
      case 'phones': {
        const cand = [...world.draft]
          .filter((p) => p.character && (p.characterReads ?? []).length < 4)
          .sort((a, b) => b.confidence - a.confidence)[0]
        if (cand && cand.character) {
          const accuracy = clamp(0.4 + skills.evaluation / 200 + rep.evaluation / 500, 0.4, 0.92)
          const rng = makeRng(world.seed + world.season * 811 + hash32(cand.id, 13))
          const r = revealFacet(cand.character, cand.characterReads ?? [], accuracy, rng)
          if (r) {
            cand.characterReads = [...(cand.characterReads ?? []), r]
            note = `Worked the phones on ${cand.name}: ${FACET_LABEL[r.facet]} — ${r.label}.`
          }
        } else note = 'No new character intel to gather right now.'
        break
      }
      case 'road':
        rep.evaluation = clamp(rep.evaluation + 1, 0, 100)
        note = 'Covered more ground: +Evaluation.'
        break
      case 'crosscheck':
        rep.profile = clamp(rep.profile + 1, 0, 100)
        note = 'Cross-checked the room: +Profile.'
        break
      case 'drills': {
        if (career.weekFlags?.drills) {
          get().showToast('Drills already run this week.')
          return
        }
        if (!hasRoom(career)) {
          get().showToast('No room to run.')
          return
        }
        const room: NonNullable<CareerState['room']> = career.room ?? { focus: [], plan: 'concentrate', reps: 0 }
        nextRoom = { ...room, reps: Math.min(17, (room.reps ?? 0) + 1) }
        note = `Drills: ${nextRoom.reps} reps banked for your room.`
        break
      }
      case 'install':
        skills.scheme = clamp(skills.scheme + 1, 0, 99)
        note = 'Film session: +Scheme.'
        break
      case 'scouts':
        updateStaffLedgers(world, career.teamId)
        rep.profile = clamp(rep.profile + 1, 0, 100)
        note = 'Scouts meeting: you learned more about your evaluators.'
        break
      case 'agent':
        rep.roster = clamp(rep.roster + 1, 0, 100)
        note = 'Agent calls: advanced a negotiation (+Roster).'
        break
      case 'owner':
        jobSecurity = clamp(jobSecurity + 2, 0, 100)
        note = 'Owner meeting: the mandate is clearer (+job security).'
        break
    }
    let nextCareer = withFlag(
      { ...career, hoursLeft: left - action.cost, reputation: rep, skills, jobSecurity, ...(nextRoom ? { room: nextRoom } : {}) },
      'hours',
    )
    if (id === 'drills') nextCareer = withFlag(nextCareer, 'drills')
    set({ career: nextCareer, tick: get().tick + 1 })
    get().showToast(note)
    get().save()
  },

  resolveSetPiece: (choice) => {
    const career = get().career
    if (!career) return
    const piece = currentSetPiece(world, career)
    if (!piece) return
    const rng = makeRng(world.seed + world.season * 97 + career.level + choice.length)
    const res = applySetPiece(career, piece, choice, rng)
    const rep: Reputation = { ...career.reputation }
    for (const [k, v] of Object.entries(res.repDelta)) {
      ;(rep as unknown as Record<string, number>)[k] = clamp(((rep as unknown as Record<string, number>)[k] ?? 0) + (v as number), 0, 100)
    }
    pushLedger(career, { kind: 'advice', name: piece.title, pos: '—', college: '—', note: res.note })
    set({ career: withFlag({ ...career, reputation: rep, setPieceDone: world.season }, 'setpiece'), tick: get().tick + 1 })
    get().showToast(res.note)
    get().save()
  },

  resolveDilemma: (choice) => {
    const career = get().career
    if (!career) return
    const card = currentDilemma(world, career)
    if (!card || card.resolved) return
    const chosen = card.choices.find((c) => c.id === choice) ?? card.choices[0]
    const res = applyDilemma(career, card, choice)
    // Culture is derived from player character + staff, so a card's culture
    // swing lands on the people it affects: the club's veteran leaders lose a
    // little work-ethic/maturity when you cut or slight them, gain it when you
    // back them. Small, and only when the card actually moves culture.
    if (res.culture !== 0) {
      const leaders = [...(world.roster[career.teamId] ?? [])].sort((a, b) => b.ovr - a.ovr).slice(0, 8)
      const step = res.culture * 0.6
      for (const p of leaders) {
        if (!p.character) continue
        p.character = {
          ...p.character,
          maturity: clamp(p.character.maturity + step, 0, 100),
          workEthic: clamp(p.character.workEthic + step, 0, 100),
        }
      }
    }
    const nextCareer: CareerState = {
      ...res.career,
      jobSecurity: clamp(career.jobSecurity + res.security, 0, 100),
      dilemma: { ...card, resolved: chosen.id },
    }
    pushLedger(nextCareer, { kind: 'advice', name: card.title, pos: '—', college: '—', note: chosen.outcome })
    set({ career: withFlag(nextCareer, 'dilemma'), tick: get().tick + 1 })
    get().showToast(chosen.outcome)
    get().save()
  },

  pickAmbition: (id) => {
    const career = get().career
    if (!career) return
    const current = career.ambitions ?? []
    if (current.length >= MAX_AMBITIONS) {
      get().showToast(`You can carry at most ${MAX_AMBITIONS} ambitions.`)
      return
    }
    if (current.some((a) => a.id === id)) return
    const option = makeAmbitionPool(world, career).find((a) => a.id === id)
    if (!option) return
    set({ career: { ...career, ambitions: [...current, option] }, tick: get().tick + 1 })
    get().save()
  },

  dropAmbition: (id) => {
    const career = get().career
    if (!career) return
    set({
      career: { ...career, ambitions: (career.ambitions ?? []).filter((a) => a.id !== id) },
      tick: get().tick + 1,
    })
    get().save()
  },

  acceptStretch: () => {
    const career = get().career
    if (!career?.stretch) return
    set({ career: withFlag({ ...career, stretch: { ...career.stretch, accepted: true } }, 'stretch'), tick: get().tick + 1 })
    get().showToast(`Accepted: ${career.stretch.label}.`)
    get().save()
  },

  declineStretch: () => {
    const career = get().career
    if (!career) return
    set({ career: { ...career, stretch: undefined }, tick: get().tick + 1 })
    get().save()
  },

  chooseWilderness: (pathId) => {
    const career = get().career
    if (!career) return
    const next = applyWilderness(world, career, pathId)
    set({ career: next, activeTeamId: next.teamId, tick: get().tick + 1 })
    get().showToast(`The Wilderness: ${pathId}. The climb restarts.`)
    get().save()
  },

  startSuccessor: (name) => {
    const career = get().career
    if (!career) return
    const heir = makeSuccessor(world, career, name)
    set({ career: heir, activeTeamId: heir.teamId, screen: 'career', tick: get().tick + 1 })
    get().showToast(`${name} picks up the torch.`)
    get().save()
  },

  acceptOffer: (offer, pitch) => {
    const career = get().career
    if (!career) return
    // Offers now run through an interview: submit and roll against a rival candidate.
    const invite = makeInterview(offer, world, career, pitch)
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
    let msg = `You won the job — ${offer.title} for the ${world.byId[offer.teamId].name}.`
    if (pitch?.length) {
      const { matched } = pitchBonus(offer, career.path, portfolioItems(world, career), pitch)
      if (matched.length) msg += ` Your pitch landed: ${matched.join(', ')}.`
    }
    get().showToast(msg)
    get().save()
  },
  declineOffers: () => set({ offers: [], modal: 'none' }),

  userOnClock: () => userOnClock(world, get().career),

  draftProspect: (id) => {
    const career = get().career
    if (!career || !userOnClock(world, career)) return
    const prospect = world.draft.find((d) => d.id === id)
    if (!prospect) return
    const round = currentRound(world)
    const player = makePick(world, prospect, career.teamId, career.gmName)
    pushLedger(career, {
      kind: 'pick',
      prospectId: prospect.id,
      playerId: player.id,
      name: prospect.name,
      pos: prospect.pos,
      college: prospect.college,
      myGrade: prospect.myGrade ?? prospect.grade,
      round,
      pick: prospect.draftPick ?? undefined,
      truth: prospect.trueGrade,
      note: `Drafted ${prospect.name} (${prospect.pos}, ${prospect.college})`,
    })
    logConvictionPicks(world, career)
    set({ career: { ...career }, tick: get().tick + 1 })
    announceDraftPicks(world, career)
    resolveTradePicks(world, career)
    get().save()
  },
  simToMyPick: () => {
    simUntilUser(world, get().career)
    const career = get().career
    if (career) logConvictionPicks(world, career)
    if (career) announceDraftPicks(world, career)
    if (career) resolveTradePicks(world, career)
    bump(set, get)
    get().save()
  },
  finishDraft: () => {
    simulateRestOfDraft(world, get().career)
    runUDFAs(world)
    world.draftState.complete = true
    const career = get().career
    if (career) logConvictionPicks(world, career)
    if (career) announceDraftPicks(world, career)
    if (career) resolveTradePicks(world, career)
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
    p.origin = { kind: 'freeAgent', season: world.season, by: career.gmName, fromTeamId: null }
    world.roster[career.teamId].push(p)
    ledgerFreeAgent(world, career.teamId, 'gained', p.ovr)
    bump(set, get)
    get().showToast(`${p.name} signed with the ${world.byId[career.teamId].name}.`)
    get().save()
  },

  releasePlayer: (id) => {
    const career = get().career
    if (!career) return
    if (accessFor(career, 'roster') !== 'decide') {
      get().showToast('You do not have roster authority yet.')
      return
    }
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
    if (accessFor(career, 'cap') !== 'decide') {
      get().showToast('Cap authority comes with a higher rung.')
      return
    }
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
    if (accessFor(career, 'cap') !== 'decide') {
      get().showToast('Contract authority comes with a higher rung.')
      return
    }
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
    if (accessFor(career, 'trades') !== 'decide') {
      get().showToast('You do not have trade authority yet — keep climbing.')
      return { accepted: false, message: 'No trade authority.' }
    }
    const verdict = evaluateTrade(world, partnerId, career.teamId, give, get2)
    if (!verdict.accepted) {
      get().showToast(verdict.reason)
      return { accepted: false, message: verdict.reason }
    }
    const rec = recordTrade(world, career, partnerId, give, get2)
    const log = executeTrade(world, career.teamId, partnerId, give, get2)
    // #5: stamp incoming players as your acquisitions.
    for (const a of get2) {
      if (a.kind !== 'player') continue
      const p = (world.roster[career.teamId] ?? []).find((x) => x.id === a.id)
      if (p) p.origin = { kind: 'trade', season: world.season, by: career.gmName, fromTeamId: partnerId }
    }
    // #6: log the trade for the Trade Tree (newest last, capped).
    const trades = [...(career.trades ?? []), rec].slice(-60)
    set({ career: { ...career, trades } })
    bump(set, get)
    const msg = `Trade with the ${world.byId[partnerId].name} completed — ${log.join(', ')}.`
    get().showToast(msg)
    get().save()
    return { accepted: true, message: msg }
  },

  hireStaff: (candidateId, salary, scheme) => {
    const career = get().career
    if (!career) return
    if (accessFor(career, 'staff') !== 'decide') {
      get().showToast('You do not hire staff at this rung yet.')
      return
    }
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
    if (accessFor(career, 'staff') !== 'decide') {
      get().showToast('You do not make staff decisions at this rung.')
      return
    }
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

  exportSaveText: () => exportSave(),

  importSaveText: async (text) => {
    const data = await importSave<SaveData>(text)
    if (!data || !data.career) {
      get().showToast('That save file could not be read.')
      return
    }
    world = migrateWorld(data.world)
    const career = reconcileCareerTeam(world, migrateCareer(data.career))
    set({
      career,
      activeTeamId: data.activeTeamId && world.byId[data.activeTeamId] ? data.activeTeamId : career.teamId,
      screen: data.screen ?? 'career',
      readNews: data.readNews ?? {},
      pendingSave: null,
      saveInfo: null,
      saveError: null,
      tick: get().tick + 1,
    })
    get().showToast('Save imported.')
    get().save()
  },

  hydrate: async () => {
    // Pull the exact-ratings datasets (Madden 26 / CFB 26) so new worlds use them.
    await Promise.all([loadRealData(), loadCalibration()])
    const primary = await loadGame<SaveData>()
    let payload: SaveData | null = null
    let savedAt = primary?.savedAt ?? 0
    let usedBackup = false
    let saveError: string | null = null

    if (primary && isSaveValid(primary.data)) {
      payload = primary.data
    } else {
      if (primary) saveError = 'Your most recent save looked corrupted. Restoring the backup…'
      const backup = await loadBackup<SaveData>()
      if (backup && isSaveValid(backup.data)) {
        payload = backup.data
        savedAt = backup.savedAt
        usedBackup = true
        saveError = 'Recovered from backup — the last save was damaged.'
      } else if (primary) {
        saveError = 'No usable save was found. The damaged save was cleared.'
        await clearSave()
      }
    }

    if (payload && payload.career) {
      set({
        pendingSave: payload,
        saveInfo: describeSave(payload, savedAt, usedBackup),
        saveError,
        ready: true,
        tick: get().tick + 1,
      })
    } else {
      set({ ready: true, saveError, tick: get().tick + 1 })
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

/**
 * Authentic league week: simulate every non-user game play-by-play in a worker
 * and apply the results with real box scores. Returns false on worker failure so
 * the caller can fall back to the fast allocator.
 */
async function simulateLeagueWeek(world: World, week: number, exceptGameId?: string): Promise<boolean> {
  const games = world.schedule.filter((g) => g.week === week && !g.played && g.id !== exceptGameId)
  if (!games.length) return true
  const reqs = games.map((g, i) => ({
    id: g.id,
    homeId: g.homeId,
    awayId: g.awayId,
    seed: world.seed + week * 7919 + 101 + i * 131,
  }))
  const results = await simLeagueGames(world, reqs)
  if (!results) return false
  const byId = new Map(results.map((r) => [r.id, r]))
  for (const g of games) {
    const r = byId.get(g.id)
    if (!r) continue
    finalizeGame(world, g, r.homeScore, r.awayScore)
    const level = world.byId[g.homeId]?.tier === 'NFL' ? 'NFL' : 'CFB'
    recordBoxLines(world, r.box, world.season, level)
    g.statsDone = true
  }
  healAfterWeek(world, week)
  return true
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

/** Ping the inbox whenever one of your guys comes off the board (#20). */
function announceDraftPicks(world: World, career: CareerState) {
  const board = new Set(career.userBoard ?? [])
  const guys = new Set((career.ledger ?? []).map((e) => e.prospectId).filter((x): x is string => !!x))
  for (const p of world.draft) {
    if (!p.draftedBy) continue
    if (!board.has(p.id) && !guys.has(p.id)) continue
    const id = `draftping_${p.id}`
    if (world.news.some((n) => n.id === id)) continue
    world.news.unshift({
      id,
      week: world.week,
      season: world.season,
      category: 'Draft',
      headline: `${p.name} drafted at #${p.draftPick ?? '?'}`,
      body: `One of your guys is off the board — ${p.pos} from ${p.college} to the ${world.byId[p.draftedBy]?.abbr ?? p.draftedBy}. This is the payoff of the climb.`,
      teamId: career.teamId,
      read: false,
    })
  }
}

/**
 * One-time repair for legacy saves whose contracts were crushed to the league
 * minimum by the old dollar-vs-fraction cap bug (L6.5 V1). Runs only when nearly
 * every rostered player has a zero AAV, then rebuilds market contracts and re-fits
 * each club to the corrected cap target, so it never runs twice. Free agents are
 * left alone; recent rookie deals are preserved.
 */
function repairCrushedContracts(w: World): void {
  const rostered = w.players.filter((p) => p.teamId && w.byId[p.teamId])
  if (!rostered.length) return
  const crushed = rostered.filter((p) => p.contract.annual === 0).length
  if (crushed / rostered.length < 0.9) return
  for (const t of w.teams) {
    const players = w.roster[t.id]
    if (!players?.length) continue
    for (const p of players) {
      const keepRookie = p.origin?.kind === 'draft' && p.origin.season >= w.season - 3
      if (keepRookie) continue
      p.contract = makeVeteranContract(makeRng(hash32(p.id, 77)), p.ovr, p.pos, p.age, w.season)
    }
    fitToCap(players, Math.round(capForSeason(w.season) * (t.prestige > 80 ? 0.86 : 0.79)))
  }
  w.news.unshift({
    id: `repair_${w.season}_${w.news.length}`,
    week: w.week,
    season: w.season,
    category: 'League',
    headline: 'League office: contracts restated for the new league year.',
    body: 'After a review of the ledger, the league office restated player contracts to market value for the new league year.',
    read: false,
  })
}

/**
 * Re-link roster / practice-squad / IR entries to the canonical player objects
 * in `w.players` (L6.5 V2b). A save imported from JSON holds a separate copy of
 * each player in every list, so edits to one list never reach the others.
 * Idempotent: once linked, every entry is the same object.
 */
function relinkPlayers(w: World): void {
  const byId = new Map(w.players.map((p) => [p.id, p]))
  const relink = (list: World['roster'][string]): World['roster'][string] =>
    list.map((p) => byId.get(p.id) ?? p)
  for (const t of Object.keys(w.roster)) w.roster[t] = relink(w.roster[t])
  for (const t of Object.keys(w.practiceSquad ?? {})) w.practiceSquad[t] = relink(w.practiceSquad[t])
  for (const t of Object.keys(w.ir ?? {})) w.ir[t] = relink(w.ir[t])
  // Roster entries with no canonical player are adopted into `w.players`.
  for (const list of Object.values(w.roster)) {
    for (const p of list) {
      if (byId.has(p.id)) continue
      byId.set(p.id, p)
      w.players.push(p)
    }
  }
}

/** Bring a legacy save up to the current world shape (new fields + pick ownership). */
function migrateWorld(w: World): World {
  relinkPlayers(w)
  w.staffTenure ??= {}
  w.draft ??= []
  w.draftPicks ??= []
  w.draftRounds ??= []
  w.practiceSquad ??= {}
  w.ir ??= {}
  w.compLedger ??= {}
  w.rivals ??= []
  w.era ??= { id: 'modern', label: 'Modern Spread Era', positionBias: {}, capSpike: 1 }
  // The college universe is gone: drop any CFB/FCS teams and their data so a
  // legacy save opens as a clean 32-club NFL world.
  const nflTeams = w.teams.filter((t) => t.tier === 'NFL')
  const nflIds = new Set(nflTeams.map((t) => t.id))
  w.teams = nflTeams
  for (const id of Object.keys(w.roster)) if (!nflIds.has(id)) delete w.roster[id]
  for (const id of Object.keys(w.standings)) if (!nflIds.has(id)) delete w.standings[id]
  for (const id of Object.keys(w.deadMoney)) if (!nflIds.has(id)) delete w.deadMoney[id]
  for (const id of Object.keys(w.byId)) if (!nflIds.has(id)) delete w.byId[id]
  for (const id of Object.keys(w.staff)) if (!nflIds.has(id)) delete w.staff[id]
  w.schedule = w.schedule.filter((g) => nflIds.has(g.homeId) && nflIds.has(g.awayId))
  w.players = w.players.filter((p) => !p.teamId || nflIds.has(p.teamId))
  w.freeAgents = w.freeAgents.filter((p) => !p.teamId || nflIds.has(p.teamId))
  w.rivals = w.rivals.map((r) => ({ ...r, tier: 'NFL' as const }))
  if (w.draftOrder) w.draftOrder = w.draftOrder.filter((id) => nflIds.has(id))
  if (!w.draftPicks.length) w.draftPicks = freshDraftPicks(w.season + 1)
  // Older saves stored a 32-team draft order; rebuild the ownership-aware one
  // (preserving the current pick index) unless the draft is already finished.
  if ((w.draftOrder?.length ?? 0) < DRAFT_ROUNDS * 32 && !w.draftState?.complete) {
    const built = buildDraftOrder(w)
    w.draftOrder = built.order
    w.draftRounds = built.rounds
    w.draftPickIds = built.ids
  }
  repairCrushedContracts(w)
  return w
}

/** Validate a loaded payload before trusting it. Never throws. */
function isSaveValid(p: SaveData | null | undefined): p is SaveData {
  try {
    if (!p || typeof p !== 'object') return false
    const w = p.world as World | undefined
    if (!w || typeof w !== 'object') return false
    if (typeof w.seed !== 'number') return false
    if (!w.byId || typeof w.byId !== 'object') return false
    if (!w.roster || typeof w.roster !== 'object') return false
    if (!Array.isArray(w.teams) || !Array.isArray(w.players) || !Array.isArray(w.schedule)) return false
    if (!Array.isArray(w.news)) return false
    const anyTeam = Object.keys(w.roster)[0]
    if (anyTeam && !Array.isArray(w.roster[anyTeam])) return false
    const c = p.career
    if (!c || typeof c !== 'object') return false
    if (typeof c.teamId !== 'string' || !c.reputation) return false
    if (!Array.isArray(c.history)) return false
    return true
  } catch {
    return false
  }
}

/** Build the "Continue" card metadata from a validated payload. */
function describeSave(p: SaveData, savedAt: number, usedBackup: boolean): SaveInfo {
  const c = p.career!
  const team = p.world.byId?.[c.teamId]
  return {
    savedAt,
    season: c.season,
    teamName: team ? (team.tier === 'NFL' ? `${team.city} ${team.name}` : team.name) : c.teamId,
    title: tierFor(c.path, c.level).title,
    tier: c.tier,
    usedBackup,
  }
}

/** Bring a legacy save (numeric reputation, single ladder) up to the current shape. */
function migrateCareer(c: CareerState): CareerState {
  const rep = c.reputation as unknown
  const path: CareerState['path'] = c.path === 'coach' || c.path === 'personnel' ? c.path : 'personnel'
  const minLevel = minNflLevel(path)
  // The college side is gone: any career saved below the NFL floor moves up to it.
  const base: CareerState =
    c.level < minLevel
      ? { ...c, path, level: minLevel, tier: 'NFL', salary: salaryFor(path, minLevel) }
      : { ...c, path }
  if (rep && typeof rep === 'object' && 'evaluation' in (rep as object)) {
    // Already migrated; just ensure skills exist.
    if (!base.skills || typeof base.skills !== 'object') {
      return { ...base, skills: { ...ZERO_SKILLS } }
    }
    return base
  }
  const legacy = typeof rep === 'number' ? rep : 20
  return {
    ...base,
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

/** After migrating a legacy world/career pair, make sure the career sits on a
 * real NFL team. The college universe the save was built on no longer exists. */
function reconcileCareerTeam(w: World, c: CareerState): CareerState {
  const team = w.byId[c.teamId]
  if (team && team.tier === 'NFL') return c
  const fallback = w.teams.find((t) => t.tier === 'NFL')?.id ?? 'BUF'
  return { ...c, teamId: fallback, tier: 'NFL' }
}

// ── Season transition ────────────────────────────────────────────────────────
function runEndOfRegularSeason(
  set: (p: Partial<GameStore>) => void,
  get: () => GameStore,
) {
  const career = get().career
  const playoffs = simulatePlayoffs(world)
  const mvp = computeMVP()
  world.awards = { mvp: mvp ?? undefined }

  const retired = developPlayers(world)
  // G3: your room's banked reps turn into OVR gains at season end.
  let roomGains: RoomGain[] = []
  if (career && hasRoom(career)) {
    roomGains = applyRoomDevelopment(world, career).gains
    for (const g of roomGains) {
      const gain = g.to - g.from
      if (gain < 2) continue
      const p = world.players.find((x) => x.id === g.id)
      pushLedger(career, {
        kind: 'develop',
        playerId: g.id,
        name: g.name,
        pos: p?.pos ?? '—',
        college: p?.college ?? '—',
        gain,
        note: `Developed ${g.name}: ${g.from} → ${g.to}`,
      })
    }
  }
  runAIResign(world)
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
  recordTeamSeasons(world, statDb, { playoffSeeds: playoffs.seeds, champion: playoffs.champion })
  recordPlayerSeasons(statDb, world.players)

  // Select this season's awards and All-Pro teams from production.
  const nflHonors = selectHonors(world, world.season, 'NFL')
  if (nflHonors) awards.seasons.push(nflHonors)

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
    const wonTitle = playoffs.champion === career.teamId
    const review = reviewSeason(world, career, { wins: rec?.wins ?? 0, losses: rec?.losses ?? 0 }, madePlayoffs, wonTitle)

    // Per-role objectives for the season just played. Grade against the season
    // that was just recorded (scout results are folded in below via seasonHits).
    const seasonCareer: CareerState = {
      ...career,
      seasonRecs: scout.graded,
      seasonHits: scout.hits,
    }
    objs = roleObjectives(world, seasonCareer, { wins: rec?.wins ?? 0, losses: rec?.losses ?? 0 }, unitRanks(world, 'NFL')[career.teamId])
    graded = gradeObjectives(objs)

    // Track how well you did your actual job — this carries into the next rung.
    const recWins = rec?.wins ?? 0
    const recLosses = rec?.losses ?? 0
    const winPct = recWins / Math.max(1, recWins + recLosses)
    const roleMasteryMap = updateRoleMastery(career, graded.doneCount, objs.length, winPct)

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
    skills.evaluation = clamp(skills.evaluation + (scout.accuracy >= 60 ? 4 : scout.graded > 0 ? 2 : 0), 0, 99)
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
      roleMastery: roleMasteryMap,
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
    // #8: how did the season compare to a replacement-level manager?
    careerNext = recordGhostSeason(world, careerNext, rec?.wins ?? 0)
    // #11: grade the ambitions the player chose for themselves.
    {
      const grade = gradeAmbitions(world, careerNext, {
        wins: rec?.wins ?? 0,
        losses: rec?.losses ?? 0,
        madePlayoffs,
        wonTitle,
      })
      const rep2: Reputation = { ...careerNext.reputation }
      for (const [k, v] of Object.entries(grade.repDelta)) {
        ;(rep2 as unknown as Record<string, number>)[k] = clamp(
          ((rep2 as unknown as Record<string, number>)[k] ?? 0) + (v as number),
          0,
          100,
        )
      }
      careerNext = { ...careerNext, reputation: rep2, ambitions: grade.results }
    }
    // G1: trust calibrated well beats the all-normal board — reward the read.
    if (canSetTrust(career)) {
      const gain = calibrationGain(world, career)
      if (gain >= 1) {
        const rep3: Reputation = { ...careerNext.reputation }
        for (const [k, v] of Object.entries({ evaluation: 2, leadership: 1 })) {
          ;(rep3 as unknown as Record<string, number>)[k] = clamp(
            ((rep3 as unknown as Record<string, number>)[k] ?? 0) + (v as number),
            0,
            100,
          )
        }
        careerNext = { ...careerNext, reputation: rep3 }
        careerNext = logMoment(careerNext, {
          week: career.week,
          text: `Your read on the staff sharpened the department board (+${gain} pts accuracy).`,
          tone: 'win',
        })
      }
    }
    if (demoted) {
      // #17: getting fired opens The Wilderness — a fork, not a reset.
      careerNext = {
        ...careerNext,        jobSecurity: 30,
        wilderness: { path: '', untilSeason: world.season, blurb: 'You were let go. Choose the road back.' },
      }
      pushCareerNews(world, careerNext, {
        category: 'Career',
        headline: `Fired: ${tierFor(career.path, career.level).title} role ends`,
        body: `After a season that fell short, you were let go as ${tierFor(career.path, career.level).title} for the ${world.byId[career.teamId].name}. The Wilderness is open — a year on TV, consulting, college, or the UFL. Pick your road back.`,
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
  // Mature the Ledger with a season of hindsight, and reset the advise board
  // for the new draft class.
  if (careerNext) {
    // G2: conviction calls that matured this season pay out evaluation/profile.
    const newly = gradeLedger(world, careerNext).newly
    const payout = convictionPayout(newly, world)
    if (Object.keys(payout.rep).length) {
      const repC: Reputation = { ...careerNext.reputation }
      for (const [k, v] of Object.entries(payout.rep)) {
        ;(repC as unknown as Record<string, number>)[k] = clamp(
          ((repC as unknown as Record<string, number>)[k] ?? 0) + (v as number),
          0,
          100,
        )
      }
      careerNext = { ...careerNext, reputation: repC }
    }
    for (const line of payout.lines) {
      careerNext = logMoment(careerNext, { week: careerNext.week, text: line, tone: 'win' })
    }
    // G3: summarise what the room's reps produced.
    if (roomGains.length) {
      const total = roomGains.reduce((s, g) => s + (g.to - g.from), 0)
      careerNext = logMoment(careerNext, {
        week: careerNext.week,
        text: `Your room put in the work: ${roomGains.length} player${roomGains.length === 1 ? '' : 's'} gained ${total} OVR.`,
        tone: 'win',
      })
    }
    // Fold the club's evaluators' reports into their ledgers so their biases
    // can be learned over time.
    updateStaffLedgers(world, careerNext.teamId)
    // Resolve an accepted stretch assignment — how it went shapes the résumé.
    if (careerNext.stretch && careerNext.stretch.accepted) {
      const r = careerNext.reputation
      const success = (r.evaluation + r.results + r.leadership) / 3 >= 45
      const out = stretchOutcome(careerNext.stretch, success)
      const rep2: Reputation = { ...r }
      for (const [k, v] of Object.entries(out.repDelta)) {
        ;(rep2 as unknown as Record<string, number>)[k] = clamp(((rep2 as unknown as Record<string, number>)[k] ?? 0) + (v as number), 0, 100)
      }
      careerNext = { ...careerNext, reputation: rep2 }
      pushCareerNews(world, careerNext, { category: 'Career', headline: success ? 'Stretch assignment delivered' : 'Stretch assignment missed', body: out.note })
    }
    // People & the world keep moving (#9, #11, #12, #13).
    const rngPeople = makeRng(world.seed + world.season * 331)
    careerNext = {
      ...careerNext,
      contacts: advanceContacts(careerNext.contacts ?? [], rngPeople),
      tree: growCoachingTree(world, careerNext, rngPeople).tree ?? careerNext.tree,
    }
    world.rivals = advanceRivals(world, makeRng(world.seed + world.season * 719))
    for (const m of mediaItems(world, careerNext, makeRng(world.seed + world.season * 811))) {
      pushCareerNews(world, careerNext, m)
    }
    // #10: earn traits from what you actually did.
    const beforeTraits = new Set((careerNext.earnedTraits ?? []).map((t) => t.id))
    const traits = evaluateTraits(careerNext)
    for (const t of traits.filter((x) => !beforeTraits.has(x.id))) {
      pushCareerNews(world, careerNext, { category: 'Career', headline: `Trait earned: ${t.name}`, body: t.desc })
    }
    careerNext = { ...careerNext, earnedTraits: traits }
    careerNext = { ...careerNext, userBoard: [], stretch: undefined, setPieceDone: undefined, dilemma: undefined }
  }
  const offers = careerNext ? generateJobOffers(world, careerNext) : []
  world.phase = 'offseason'

  const rec = world.standings[careerNext?.teamId ?? 'BUF']
  // #20: assemble the broadcast recap from what actually happened.
  const wins = rec?.wins ?? 0
  const losses = rec?.losses ?? 0
  const prevLine = career?.history?.[career.history.length - 1]?.record
  const hasPrev = !!prevLine
  const prevWins = prevLine ? Number(prevLine.split('-')[0]) || 0 : wins
  const winsDelta = wins - prevWins
  const fingerprint = careerNext ? fingerprintSummary(world, careerNext) : { drafted: 0, signed: 0, total: 0 }
  const moments = careerNext ? topMoments(careerNext, 3) : []
  // The season just played belongs to the pre-transition team.
  const seasonTeamId = career?.teamId ?? careerNext?.teamId ?? 'BUF'
  const madePlayoffs = playoffs.seeds?.includes(seasonTeamId) ?? false
  const wonTitle = playoffs.champion === seasonTeamId
  const headline = seasonHeadline({ wins, losses, madePlayoffs, wonTitle, winsDelta })
  const ghost = careerNext?.ghostHistory?.[careerNext.ghostHistory.length - 1]
  const question = careerNext?.seasonQuestion
    ? answerSeasonQuestion(careerNext.seasonQuestion, {
        wins,
        losses,
        madePlayoffs,
        wonTitle,
        winsDelta,
        security: careerNext.jobSecurity,
      })
    : undefined
  if (careerNext && question) careerNext = { ...careerNext, seasonQuestion: question }

  const summary: SeasonSummary = {
    season: world.season,
    champion: playoffs.champion,
    mvp,
    scout,
    record: `${wins}-${losses}`,
    reviewNote: scout
      ? scout.graded === 0
        ? 'You filed no recommendations this cycle. Get on the road next season.'
        : `${scout.hits} hits / ${scout.misses} misses · reputation ${scout.repDelta >= 0 ? '+' : ''}${scout.repDelta}`
      : '',
    objectives: objs,
    objectivesDone: graded.doneCount,
    // #20 recap
    headline,
    winsDelta: hasPrev ? winsDelta : undefined,
    moments,
    fingerprint,
    question,
    ghost: ghost ? { actualWins: ghost.actualWins, ghostWins: ghost.ghostWins, delta: ghost.delta } : undefined,
    ambitions: (careerNext?.ambitions ?? []).map((a) => ({ label: a.label, done: !!a.done })),
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

/** Dev-only probe: check no single game-plan setting dominates the sim (#F). */
export function dominanceProbe(games = 60) {
  const nfl = world.teams.filter((t) => t.tier === 'NFL')
  const plans: { id: string; off: GamePlan }[] = [
    { id: 'balanced', off: { ...BALANCED_PLAN } },
    { id: 'airItOut', off: { passBias: 2, tempo: 0.4, aggression: 0.5, coverage: 1 } },
    { id: 'runHeavy', off: { passBias: -2, tempo: -0.5, aggression: 0.5, coverage: 1 } },
  ]
  const rng = makeRng(world.seed + 424242)
  // Paired design: every plan runs the same matchup with the same seed.
  const matchups: { h: string; a: string; seed: number }[] = []
  for (let i = 0; i < games; i++) {
    const h = nfl[Math.floor(rng() * nfl.length)]
    const a = nfl[Math.floor(rng() * nfl.length)]
    if (h.id === a.id) continue
    matchups.push({ h: h.id, a: a.id, seed: world.seed + i * 7919 + 101 })
  }
  const out: Record<string, number> = {}
  const wins: Record<string, number> = {}
  for (const p of plans) {
    let pts = 0
    let w = 0
    for (const m of matchups) {
      setUserCoaching(null)
      setLivePlan({ offTeamId: m.h, defTeamId: m.a, off: p.off, def: BALANCED_PLAN })
      const sim = simulatePlayByPlay(world, m.h, m.a, m.seed)
      pts += sim.homeScore
      if (sim.homeScore > sim.awayScore) w++
    }
    setLivePlan(null)
    out[p.id] = +(pts / Math.max(1, matchups.length)).toFixed(1)
    wins[p.id] = +((w / Math.max(1, matchups.length)) * 100).toFixed(0)
  }
  const vals = Object.values(out)
  const spread = +(Math.max(...vals) - Math.min(...vals)).toFixed(1)
  const wr = Object.values(wins)
  const winSpread = Math.max(...wr) - Math.min(...wr)
  return {
    games: matchups.length,
    pointsByPlan: out,
    winRateByPlan: wins,
    spread,
    winSpread,
    dominant: winSpread > 12 ? Object.entries(wins).sort((x, y) => y[1] - x[1])[0]?.[0] : null,
  }
}

/** Dev-only probe: AI re-signing and AI-to-AI trades (#F, deeper rosters). */
export function aiManagerProbe() {
  const clone = structuredClone(world) as World
  const before = clone.freeAgents.length
  runAIResign(clone)
  runAIFreeAgency(clone)
  runAITrades(clone)
  const tradeNews = clone.news.filter((n) => n.id.startsWith('aitrade_'))
  return {
    freeAgentsBefore: before,
    freeAgentsAfter: clone.freeAgents.length,
    aiTrades: tradeNews.length,
    sample: tradeNews.slice(0, 3).map((n) => n.headline),
  }
}

/** Dev-only probe: weekly rhythm state (hours, actions, set piece, stretch). */
export function rhythmProbe() {
  const career = useGame.getState().career
  const w = getWorld()
  return {
    week: w.week,
    season: w.season,
    level: career?.level,
    path: career?.path,
    hours: career?.hoursLeft,
    setPieceDone: career?.setPieceDone,
    actions: career ? weeklyActions(career).map((a) => a.id) : [],
    piece: career ? currentSetPiece(w, career) : null,
    stretch: career?.stretch ?? null,
  }
}

/** Dev-only probe: evaluator biases and what their ledger reveals. */
export function scoutBiasProbe() {
  const career = useGame.getState().career
  const teamId = career?.teamId ?? 'BUF'
  // Simulate a season of filed reports so the ledger has signal.
  updateStaffLedgers(world, teamId)
  const evaluators = (world.staff[teamId] ?? []).filter(isEvaluator)
  const sample = world.draft[0]
  return {
    teamId,
    evaluators: evaluators.map((m) => ({
      name: m.name,
      role: m.role,
      hiddenBias: m.bias,
      learned: learnedBias(m),
      reportOnTop: sample ? scoutReport(m, sample) : null,
    })),
    truthTop: sample?.trueGrade,
  }
}

/** Dev-only probe: hidden character generation and development spread. */
export function characterProbe() {
  const sample = world.draft.slice(0, 5).map((p) => ({
    name: p.name,
    pos: p.pos,
    character: p.character,
    generated: p.generated,
  }))
  // Compare average ovr growth for high vs low work ethic among young players.
  const young = world.players.filter((p) => p.character && p.age <= 25 && p.teamId)
  const hi = young.filter((p) => (p.character!.workEthic ?? 0) >= 70)
  const lo = young.filter((p) => (p.character!.workEthic ?? 100) < 45)
  const avgPot = (arr: typeof young) => (arr.length ? +(arr.reduce((s, p) => s + (p.pot - p.ovr), 0) / arr.length).toFixed(2) : 0)
  return {
    sample,
    youngHighMotor: { n: hi.length, avgUpside: avgPot(hi) },
    youngLowMotor: { n: lo.length, avgUpside: avgPot(lo) },
    realPlayersFlagged: world.players.filter((p) => p.generated === false).length,
  }
}

/** Dev-only probe: verify the draft "advise" flow (NPC follows/overrides your board). */
export function adviceProbe() {
  const clone = structuredClone(world) as World
  initDraft(clone)
  const top = [...clone.draft].sort((a, b) => b.grade - a.grade).slice(0, 5).map((p) => p.id)
  const career: CareerState = {
    gmName: 'Advise Bot',
    path: 'personnel',
    archetype: 'scout',
    teamId: 'BUF',
    season: clone.season,
    week: clone.week,
    reputation: { ...ZERO_REP, evaluation: 65 },
    skills: { ...ZERO_SKILLS, evaluation: 55 },
    level: 4,
    salary: 0,
    jobSecurity: 70,
    ownerExpectation: '',
    tier: 'NFL',
    recommendationsMade: 0,
    hits: 0,
    misses: 0,
    seasonRecs: 0,
    seasonHits: 0,
    ledger: [],
    userBoard: top,
    history: [],
  }
  simUntilUser(clone, career)
  const advice = (career.ledger ?? []).filter((e) => e.kind === 'advice')
  const bufPicks = clone.draft.filter((p) => p.draftedBy === 'BUF')
  return {
    adviceEntries: advice.length,
    accepted: advice.filter((e) => e.accepted).length,
    sample: advice.slice(0, 3).map((e) => ({ name: e.name, accepted: e.accepted, pick: e.pick })),
    bufTopPick: bufPicks[0]?.name,
    bufTopOnBoard: bufPicks[0] ? top.includes(bufPicks[0].id) : false,
  }
}

/** Dev-only balance probe: run whole seasons headlessly and report the long arc. */
export function balanceProbe(seasons = 10, path: 'coach' | 'personnel' = 'personnel') {
  return runBalance({ seasons, path, seed: world.seed, data: getRealData() })
}

/** Dev-only probe: run the league play-by-play worker on the current week (no mutation). */
export async function leaguePbpProbe(count = 8) {
  const week = world.week
  const games = world.schedule.filter((g) => g.week === week && !g.played).slice(0, count)
  const reqs = games.map((g, i) => ({
    id: g.id,
    homeId: g.homeId,
    awayId: g.awayId,
    seed: world.seed + week * 7919 + 101 + i * 131,
  }))
  const t0 = Date.now()
  const results = await simLeagueGames(world, reqs)
  return {
    ms: Date.now() - t0,
    requested: reqs.length,
    got: results?.length ?? 0,
    fallback: results === null,
    sample: (results ?? []).slice(0, 3).map((r) => ({ id: r.id, home: r.homeScore, away: r.awayScore, lines: r.box.length })),
  }
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

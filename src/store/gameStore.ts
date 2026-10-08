import { create } from 'zustand'
import {
  buildWorld,
  fitToCap,
  indexPlayers,
  regenerateSchedule,
  retargetSeedNews,
  teamStrength,
  zeroRecord,
  ERAS,
  type World,
} from '../game/engine/generate'
import { finalizeGame, healAfterWeek, simWeek, simulatePlayoffs, type WeekRecovery } from '../game/engine/sim'
import { simulatePlayByPlay, createGame, runToMoment, runUntil, answerMoment, finishGame, setUserCoaching, setLivePlan, offStyle, type GameSim, type GameCtx, type GameState, type Moment, type PlanChange } from '../game/engine/playsim'
import { DEFAULT_CALL_SHEET, emptyBook, bucketFor, offClassFor, type CallSheet, type DefCall, type OffClass } from '../game/engine/decisions'
import { BALANCED_PLAN, PLAN_PRESETS, type GamePlan } from '../game/engine/gameplan'
import { NO_USER_BONUS, userBonusFromSkills } from '../game/engine/coaching'
import {
  gainGameReps,
  gainSeasonTraining,
  initPlaybook,
  refreshCohesion,
  teamCohesion,
} from '../game/engine/playbook'
import { applyHire, attemptHire, focusOptions, openCandidates, frontOfficeProfile, isFrontOfficeRole } from '../game/engine/hiring'
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
import {
  COACH_OF_YEAR,
  EXEC_OF_YEAR,
  computeStaffAwards,
  type StaffAward,
} from '../game/engine/staffAwards'
import { counterOffer } from '../game/engine/counter'
import { rivalFor } from '../game/engine/rivalry'
import { recordGameStats, boxScore, recordBoxLines, boxPlayerLines, boxTeamTotals } from '../game/engine/stats'
import { simLeagueGames } from '../game/engine/leagueSim'
import { gradeGame } from '../game/engine/film'
import {
  developPlayers,
  evaluateScouting,
  experienceLabel,
  freeAgentContract,
  refreshProspectClass,
  runAIFreeAgency,
  runAIResign,
  runAITrades,
  enforceCapCompliance,
  tickAllContracts,
  trimNflRosters,
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
  stageOf,
  draftOpen,
  rescaleLegacyRookies,
} from '../game/engine/draft'
import { ensureDraftWindow, ledgerFreeAgent } from '../game/engine/picks'
import { canSetTrust, calibrationGain } from '../game/engine/department'
import { MAX_CONVICTION, canConvict, convictionIds, convictionPayout, logConvictionPicks } from '../game/engine/conviction'
import { MAX_RED_FLAGS, RED_FLAG_TOP_N, canRedFlag, logRedFlags, redFlagIds, redFlagPayout, isRedFlaggable } from '../game/engine/redflag'
import { DEF_WRINKLES, OFF_WRINKLES, canWrinkle, wrinkleBonus, wrinkleSides } from '../game/engine/wrinkle'
import { canInstall, installBonus } from '../game/engine/install'
import { canPractice, practiceEdge, practiceInjuryMult, practiceIsRest, practiceMasteryMult, PRACTICE_OPTIONS, type PracticePlan } from '../game/engine/practice'
import { canPickKeys, gradeKeys, keysReward, pickableKeys, MAX_KEYS, type GameKeyId, type KeyGrade } from '../game/engine/keys'
import { canPitch, judgePitch, pitchSide } from '../game/engine/pitch'
import { pitchBonus, portfolioItems } from '../game/engine/portfolio'
import { MAX_ROOM_FOCUS, applyRoomDevelopment, hasRoom, roomPlayers, type RoomGain } from '../game/engine/room'
import { evaluateTrade, executeTrade, findDeals, type TradeAsset } from '../game/engine/trade'
import { recordTrade, resolveTradePicks } from '../game/engine/tradeTree'
import { accessFor } from '../game/engine/access'
import { capabilities } from '../game/engine/capabilities'
import { aiInjuryMoves, aiWaiverClaims, clearWaivers, placeOnWaivers, processWaivers, waiverBlockedReason } from '../game/engine/waivers'
import { STARTERS, depthAt, moveInDepth, resetDepth, setStarterInDepth } from '../game/engine/depth'
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
import { pushLedger, gradeLedger, logCoachCalls } from '../game/engine/ledger'
import { CHARACTER_FACETS, FACET_LABEL, revealFacet } from '../game/engine/character'
import { learnedBias, scoutReport, isEvaluator } from '../game/engine/scoutBias'
import { currentDilemma, applyDilemma } from '../game/engine/dilemma'
import { recordGhostSeason } from '../game/engine/ghost'
import { makeSeasonQuestion, answerSeasonQuestion, topMoments, fingerprintSummary, seasonHeadline, logMoment } from '../game/engine/recap'
import { MAX_AMBITIONS, makeAmbitionPool, gradeAmbitions } from '../game/engine/ambitions'
import { MAX_SHADOW, canShadow, gradeShadowBoard, isOnShadowBoard, pruneShadowBoard, shadowHits, toggleShadow } from '../game/engine/shadow'
import { buildExtension, judgeOffer, marketAsk, type ExtensionOffer } from '../game/engine/negotiation'
import { canFileMemo, gradeCapMemo } from '../game/engine/capMemo'
import { applyCombine, combineOpen, type CombineKind } from '../game/engine/combine'
import {
  weeklyActions,
  currentSetPiece,
  resolveSetPiece as applySetPiece,
  maybeStretch,
  stretchOutcome,
} from '../game/engine/weekly'
import {
  capForSeason,
  capSavings,
  capScale,
  deadMoney,
  extendContract,
  makeVeteranContract,
  marketAAV,
  restructure,
  summarizeCap,
} from '../game/engine/cap'
import { makeRng } from '../game/engine/rng'
import { applyScenario, scenarioById } from '../game/engine/scenarios'
import type { CapMemo, CareerPath, CareerState, JobOffer, LeagueTier, MatchupSet, NewsItem, Player, Position, ScenarioId, SeasonMoment, SeasonQuestion, UsageSet } from '../game/types'
import { loadGame, loadBackup, saveGame, clearSave, exportSave, importSave } from '../game/persistence'
import { money } from '../lib/format'
import { loadRealData, getRealData } from '../game/data/realData'
import { NFL_TEAMS } from '../game/data/nflTeams'
import { loadCalibration } from '../game/data/calibration'
import { runBalance, runRookieProbe } from '../game/engine/balance'

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

/** A game being coached play by play: the resumable sim plus the pending moment. */
export interface GameDay {
  gameId: string
  state: GameState
  moment: Moment | null
  /** L11.5 Q3: the live plan for the rest of this game (next week uses defaultPlan). */
  plan: { off: GamePlan; def: GamePlan }
  /** L11.5 Q3: every mid-game plan switch, shown in the post-game film card. */
  changes: PlanChange[]
  /** L12.6: call mode at kickoff and each mid-game switch (play count it applied from), so the game can be rebuilt exactly. */
  callStart?: 'off' | 'def' | 'both'
  callSwitches?: { at: number; mode: 'off' | 'def' | 'both' | undefined }[]
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
function growPlaybookFromGame(world: World, sim: GameSim, gainMult = 1, bonusTeamId?: string) {
  const playedIds = new Set<string>()
  for (const line of sim.box ?? []) playedIds.add(line.playerId)
  for (const teamId of [sim.homeId, sim.awayId]) {
    const mult = bonusTeamId && teamId === bonusTeamId ? gainMult : 1
    for (const p of world.roster[teamId] ?? []) {
      const next = gainGameReps(p, playedIds.has(p.id), mult)
      if (next) p.playbook = next
    }
  }
}

/** L10 G8: fold a completed user game's snaps into the season tendency book. */
function updateUserBook(world: World, sim: GameSim, teamId: string) {
  if (world.userBook && (world.userBook.season !== world.season || world.userBook.teamId !== teamId)) {
    world.userBook = undefined
  }
  if (!world.userBook) world.userBook = { season: world.season, teamId, book: emptyBook() }
  const book = world.userBook.book
  for (const p of sim.plays) {
    if (p.type !== 'run' && p.type !== 'pass') continue
    const bucket = bucketFor(p.down ?? 1, p.distance ?? 10, p.startYard)
    if (p.offId === teamId && p.offClass) book.off[bucket][p.offClass] += 1
    else if (p.defId === teamId && p.defCall) book.def[bucket][p.defCall] += 1
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
  /** L9 Z2: this season's front-office/staff award winners. */
  staffAwards?: StaffAward[]
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
  /** Bumped whenever a fresh replay opens, so the match view resets its playback. */
  matchSeq: number
  /** The user's game in progress, coached moment by moment (not persisted). */
  gameDay: GameDay | null
  startGameDay: () => void
  /** L11.5 Q2: advance the live game by play, drive, or to the next moment. */
  gameDayAdvance: (stop: 'play' | 'drive' | 'moment') => Promise<void>
  /** L11.5 Q3: adjust one side of the live plan for the rest of the game. */
  setGameDayPlan: (side: 'off' | 'def', plan: GamePlan) => void
  answerGameMoment: (choiceId: string) => Promise<void>
  /** L12.6: how often a coached game asks for your call (applies from the next snap). */
  setCallMode: (mode: 'key' | 'off' | 'def' | 'both', keepPlays?: number) => boolean
  simGameDayToEnd: () => Promise<void>
  abandonGameDay: () => void
  statsDb: () => CareerDatabase
  setPlan: (side: 'off' | 'def', plan: GamePlan) => void
  /** Saved pre-game plan, applied every week. */
  defaultPlan: { off: GamePlan; def: GamePlan }
  setDefaultPlan: (side: 'off' | 'def', plan: GamePlan) => void
  /** L10 G4: the user's 4th-down / 2-point / timeout call sheet. */
  setCallSheet: (sheet: CallSheet) => void
  /** L10 G10: the user's opening script (ordered concept names, max 8). */
  setScript: (concepts: string[]) => void
  /** L10 G11: pre-game matchup assignments for your club. */
  setMatchups: (matchups: MatchupSet) => void
  /** L10 G12: running-back workload and defensive-line rotation. */
  setUsage: (usage: UsageSet) => void
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
  advanceWeek: (opts?: { userSim?: GameSim }) => Promise<void>
  /** L12.6 C1: step the offseason calendar one stage (resign → FA → draft → camp → season). */
  advanceStage: () => void
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
  /** K4: add/remove a prospect from your red-flag list for this draft (max 2). */
  toggleRedFlag: (prospectId: string) => void
  /** K1: pick (or clear) this week's game-plan wrinkle for a side. */
  pickWrinkle: (side: 'off' | 'def', id: string) => void
  /** K2: choose this offseason's install plan for the coming season. */
  chooseInstall: (plan: 'lean' | 'full') => void
  /** L12 W1: pick this week's practice plan (kept week to week). */
  pickPractice: (plan: PracticePlan) => void
  /** L12 W2: add or remove a key to the game (up to two). */
  toggleKey: (id: GameKeyId) => void
  /** K3: pitch a starter on your side to the coordinator (once a week). */
  pitchStarter: (pos: Position, playerId: string) => void
  /** G3: add/remove a player from your room's focus list (max 3). */
  toggleRoomFocus: (playerId: string) => void
  /** G3: choose your room's practice plan (Concentrate or Spread). */
  setRoomPlan: (plan: 'concentrate' | 'spread') => void
  /** Work the phones to uncover one hidden character facet of a prospect. */
  investigateCharacter: (id: string) => void
  /** L12.9 H1: study this week's opponent (free; a second read same week is sharp). */
  studyOpponent: () => void
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
  /** L9 Z4: accept the current owner's counteroffer and stay put. */
  acceptCounter: () => void
  declineOffers: () => void

  userOnClock: () => boolean
  draftProspect: (id: string) => void
  simToMyPick: () => void
  finishDraft: () => void

  signFreeAgent: (id: string) => void
  releasePlayer: (id: string) => void
  /** L11 W4: file / withdraw a waiver claim (resolves on Tuesday, at most 3 open). */
  claimWaiver: (playerId: string) => void
  cancelWaiverClaim: (playerId: string) => void
  hireStaff: (candidateId: string, salary: number, scheme?: string) => void
  fireStaff: (staffId: string) => void
  /** L11.5 Q8: change a front-office staffer's focus (once per season). */
  setStaffFocus: (staffId: string, focus: string) => void
  restructurePlayer: (id: string) => void
  extendPlayer: (id: string) => void
  /** G2: negotiate an extension with a player's agent (negotiate rungs). */
  offerExtension: (playerId: string, offer: ExtensionOffer) => void
  /** G1: add/remove a non-own player from the shadow board (proScout rungs). */
  toggleShadowBoard: (playerId: string) => void
  /** G3: file this offseason's cap memo (manageCap rungs). */
  fileCapMemo: (bucket: 'tight' | 'comfortable' | 'flush', priorityIds: string[], note: string) => void
  /** G4: spend combine-week hours on a prospect (interview / workout / film). */
  combineAction: (prospectId: string, kind: CombineKind) => void

  // Practice squad & injured reserve
  signToPracticeSquad: (id: string) => void
  promoteFromPracticeSquad: (id: string) => void
  releaseFromPracticeSquad: (id: string) => void
  placeOnIR: (id: string) => void
  activateFromIR: (id: string) => void

  // Trades
  proposeTrade: (partnerId: string, give: TradeAsset[], get: TradeAsset[]) => { accepted: boolean; message: string }
  /** L12.5 T5: add/remove a player from your trade block (max 5). */
  toggleTradeBlock: (playerId: string) => void

  markRead: (id: string) => void
  /** L11.5 Q12: mark every current news item read. */
  markAllNewsRead: () => void
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

/** The club the user plays this week, or null on a bye. */
function weekOpponent(world: World, teamId: string): string | null {
  const g = world.schedule.find((x) => !x.played && x.week === world.week && (x.homeId === teamId || x.awayId === teamId))
  if (!g) return null
  return g.homeId === teamId ? g.awayId : g.homeId
}

/**
 * L12.9 H1: the weekly hours actions are gone, but their effects remain.
 *
 * Each rung's unmoved actions (film, road, cross-check, install, agent, owner)
 * now trickle in passively at one point every six weeks — the old menu's
 * average spend, smoothed. Fractional amounts accumulate in `passiveBank` and
 * pay out whole points. Runs meeting bias reveals one scout every four weeks;
 * the room banks one development rep a week for rungs that ran drills.
 */
const PASSIVE_PER_WEEK = 1 / 6

function applyPassiveGains(career: CareerState, world: World): CareerState {
  const actions = new Set(weeklyActions(career).map((a) => a.id))
  const rep: Reputation = { ...career.reputation }
  const skills: Skills = { ...career.skills }
  let jobSecurity = career.jobSecurity
  const bank: Record<string, number> = { ...(career.passiveBank ?? {}) }
  // Accrue a fraction each week; pay out whole points only.
  const accrue = (key: string, apply: (whole: number) => void) => {
    bank[key] = (bank[key] ?? 0) + PASSIVE_PER_WEEK
    const whole = Math.floor(bank[key])
    if (whole > 0) {
      bank[key] -= whole
      apply(whole)
    }
  }
  if (actions.has('film')) accrue('film', (n) => { skills.evaluation = clamp(skills.evaluation + n, 0, 99) })
  if (actions.has('road')) accrue('road', (n) => { rep.evaluation = clamp(rep.evaluation + n, 0, 100) })
  if (actions.has('crosscheck')) accrue('crosscheck', (n) => { rep.profile = clamp(rep.profile + n, 0, 100) })
  if (actions.has('install')) accrue('install', (n) => { skills.scheme = clamp(skills.scheme + n, 0, 99) })
  if (actions.has('agent')) accrue('agent', (n) => { rep.roster = clamp(rep.roster + n, 0, 100) })
  if (actions.has('owner')) accrue('owner', (n) => { jobSecurity = clamp(jobSecurity + n, 0, 100) })
  // A scouts meeting surfaces one evaluator's bias every four weeks.
  if (actions.has('scouts')) {
    bank.scouts = (bank.scouts ?? 0) + 1
    if (bank.scouts >= 4) {
      bank.scouts = 0
      updateStaffLedgers(world, career.teamId)
    }
  }
  // Run drills: the room banks one rep a week automatically.
  let room = career.room
  if (actions.has('drills') && hasRoom(career)) {
    const base = room ?? { focus: [], plan: 'concentrate' as const, reps: 0 }
    room = { ...base, reps: Math.min(17, (base.reps ?? 0) + 1) }
  }
  return { ...career, reputation: rep, skills, jobSecurity, passiveBank: bank, ...(room ? { room } : {}) }
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
  matchSeq: 0,
  gameDay: null,
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
    // L11.5 Q14: the opening inbox was written for Buffalo; re-point it at this club.
    retargetSeedNews(world, career.teamId)
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

  advanceWeek: async (opts) => {
    const career = get().career
    if (!career) return
    // While a coached game is in progress, only its own finish may advance the week.
    if (get().gameDay && !opts?.userSim) return
    if (world.phase === 'offseason') {
      get().startNextSeason()
      return
    }
    const week = world.week
    // L11 W2/W4: Waiver Tuesday — AI clubs add claims to entries from an earlier
    // week, then those entries resolve before any game is simulated. Snapshot the
    // open entries first so the result can be reported back to the user's inbox.
    const openWaivers = (world.waivers ?? []).map((e) => ({
      playerId: e.playerId,
      fromTeamId: e.fromTeamId,
      userClaimed: e.claims.includes(career.teamId),
    }))
    aiWaiverClaims(world, career.teamId)
    const waiveResult = processWaivers(world, career.teamId)
    const waiverMoments = waiveNews(world, career.teamId, openWaivers, waiveResult)
    // L11 W3: AI clubs replace injured starters from the free-agent pool.
    aiInjuryMoves(world, career.teamId)
    // Apply the saved pre-game plan to the user's game this week.
    const plan = get().defaultPlan
    const userGameForPlan = world.schedule.find(
      (g) => !g.played && g.week === week && (g.homeId === career.teamId || g.awayId === career.teamId),
    )
    if (userGameForPlan) {
      setLivePlan({ teamId: career.teamId, off: plan.off, def: plan.def })
    }
    // The user's game is simulated play-by-play so it can be watched in 2D.
    applyUserCoaching(career)
    const userGame = world.schedule.find(
      (g) => g.week === week && !g.played && (g.homeId === career.teamId || g.awayId === career.teamId),
    )
    // L12 W1: the week's practice plan shapes the user's club only — its weekly
    // injury odds, Rest healing/fatigue, and (below) Install's mastery gain. AI
    // clubs pass no recovery, so league-wide injuries are unchanged.
    const recovery: WeekRecovery = {
      teamId: career.teamId,
      injuryMult: practiceInjuryMult(career, world),
      restHeal: practiceIsRest(career, world),
      fatigueRelief: practiceIsRest(career, world),
    }
    // Authentic mode runs the whole league through play-by-play in a worker,
    // falling back to the fast allocator if the worker is unavailable.
    if (get().leaguePbp) {
      const ok = await simulateLeagueWeek(world, week, userGame?.id, recovery)
      if (!ok) simWeek(world, week, userGame?.id, recovery)
    } else {
      simWeek(world, week, userGame?.id, recovery)
    }
    let sim: GameSim | null = null
    let qbSwitchLine: string | null = null
    let rbInjuryLine: string | null = null
    let keysRepDelta = 0
    if (userGame) {
      // G3: a coached game hands us its finished result; fast sim answers every
      // moment with the user's standing orders.
      sim = opts?.userSim ?? simulatePlayByPlay(world, userGame.homeId, userGame.awayId, world.seed + week * 7919 + 101, userCtx(career))
      finalizeGame(world, userGame, sim.homeScore, sim.awayScore)
      // Record career stats for both teams' players (college or pro).
      const level = world.byId[userGame.homeId].tier === 'NFL' ? 'NFL' : 'CFB'
      sim.box = boxScore(world, sim)
      // R4: keep a season-scoped box score for the user's game.
      userGame.box = { players: boxPlayerLines(sim.box), team: boxTeamTotals(sim.box) }
      recordGameStats(world, sim, world.season, level)
      growPlaybookFromGame(world, sim, practiceMasteryMult(career, world), career.teamId)
      // L10 G8: every user snap feeds the tendency book opponents will exploit.
      updateUserBook(world, sim, career.teamId)
      // L10 G5: grade the user's fourth-down and two-point calls; keep the film
      // on the game (one season, cleared with the box).
      const film = gradeGame(world, sim, career.teamId)
      if (film) {
        userGame.film = film
        sim.film = film
      }
      // L12 W2: grade the promises you made before kickoff against the real box
      // score. Only the keys picked for this week count; none picked = nothing
      // graded. The leadership swing is capped at ±3 per season by a ledger.
      const pickedKeys: GameKeyId[] =
        career.keys && career.keys.season === world.season && career.keys.week === week
          ? (career.keys.ids as GameKeyId[])
          : []
      let keyGrades: KeyGrade[] = []
      if (pickedKeys.length) {
        const grades = gradeKeys(world, sim, career.teamId, pickedKeys)
        if (grades.length) {
          keyGrades = grades
          userGame.keys = grades
          sim.keys = grades
          keysRepDelta = keysReward(grades)
        }
      }
      // L12.9 L1: date and grade this game's coaching calls in the Ledger.
      logCoachCalls(career, world, sim, career.teamId, keyGrades, film)
      // L10 G6: a halftime QB change costs the benched starter's confidence.
      const switchedQb = (sim.decisions ?? []).some((d) => d.kind === 'qbChange' && d.choiceId === 'switch' && d.source === 'user')
      if (switchedQb) {
        const starter = depthAt(world, career.teamId, 'QB').filter((p) => !p.injured)[0]
        const backup = depthAt(world, career.teamId, 'QB').filter((p) => !p.injured)[1]
        // Mutate in place: roster entries must stay the canonical world.players objects.
        if (starter) starter.morale = clamp(starter.morale - 8, 1, 100)
        qbSwitchLine = `Benched ${starter?.name ?? 'the starter'} at halftime for ${backup?.name ?? 'the backup'}.`
      }
      // L10 G12: a heavy RB workload carries a deterministic injury risk. The
      // roll is seeded and the canonical roster player is mutated in place.
      const rbUsage = career.usage?.rb
      if (rbUsage === 'feature') {
        const rb1 = depthAt(world, career.teamId, 'RB')[0]
        if (rb1 && !rb1.injured) {
          // Only the feature workload adds risk on top of the league's normal injuries.
          const risk = 0.05
          const roll = makeRng(world.seed + week * 7919 + 4242)
          if (roll() < risk) {
            const notes = ['Hamstring', 'Ankle', 'Knee', 'Groin']
            const note = notes[Math.floor(roll() * notes.length)]
            rb1.injured = { games: 1 + Math.floor(roll() * 3), note }
            rbInjuryLine = `${rb1.name} (${note}) is out ${rb1.injured.games} ${rb1.injured.games === 1 ? 'game' : 'games'} after a heavy workload.`
          }
        }
      }
    }
    // K1: fold this week's wrinkles into the film history, then clear the pick.
    if (career.wrinkles?.pick && career.wrinkles.pick.week === week) {
      const { pick } = career.wrinkles
      const entries: { week: number; side: 'off' | 'def'; id: string }[] = []
      if (pick.off) entries.push({ week, side: 'off', id: pick.off })
      if (pick.def) entries.push({ week, side: 'def', id: pick.def })
      career.wrinkles = {
        ...career.wrinkles,
        history: [...career.wrinkles.history, ...entries].slice(-8),
        pick: undefined,
      }
    }
    if (week >= 18) {
      runEndOfRegularSeason(set, get)
    } else {
      world.week = week + 1
      set({ scoutingPoints: MAX_SCOUT_POINTS })
    }
    const c = get().career!
    let nextCareer: CareerState = { ...c, week: world.week, season: world.season, weekFlags: {} }
    // L12.9 H1: the weekly hours card is gone; its effects arrive passively.
    nextCareer = applyPassiveGains(nextCareer, world)
    // L12 W2: fold the graded keys into this season's leadership ledger, capped
    // at ±3 net per season (the applied amount is what actually moves the rep).
    if (keysRepDelta !== 0) {
      const priorNet = c.keysLedger?.season === world.season ? c.keysLedger.net : 0
      const net = clamp(priorNet + keysRepDelta, -3, 3)
      const applied = net - priorNet
      nextCareer = {
        ...nextCareer,
        keysLedger: { season: world.season, net },
        reputation: applied
          ? { ...nextCareer.reputation, leadership: clamp(nextCareer.reputation.leadership + applied, 0, 100) }
          : nextCareer.reputation,
      }
    }
    // L10 G6: remember a halftime QB switch in the season's story.
    if (qbSwitchLine) nextCareer = logMoment(nextCareer, { week, text: qbSwitchLine, tone: 'info' })
    if (rbInjuryLine) nextCareer = logMoment(nextCareer, { week, text: rbInjuryLine, tone: 'loss' })
    // L11 W4: the waiver turn's result for the user's club (win -> a moment).
    for (const line of waiverMoments) nextCareer = logMoment(nextCareer, { week, text: line.text, tone: line.tone })
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
    // L9 Z5: a rivalry game against a rival's club — the result sticks.
    if (sim && userGame) {
      const isHome = userGame.homeId === c.teamId
      const oppId = isHome ? userGame.awayId : userGame.homeId
      const rival = rivalFor(world, oppId)
      if (rival) {
        const myScore = isHome ? sim.homeScore : sim.awayScore
        const oppScore = isHome ? sim.awayScore : sim.homeScore
        const oppName = world.byId[oppId].name
        if (myScore > oppScore) {
          const already = nextCareer.rivalWins?.season === world.season ? nextCareer.rivalWins.wins : 0
          if (already < 2) {
            nextCareer = {
              ...nextCareer,
              reputation: { ...nextCareer.reputation, profile: clamp(nextCareer.reputation.profile + 1, 0, 100) },
              rivalWins: { season: world.season, wins: already + 1 },
            }
          }
          nextCareer = logMoment(nextCareer, { week, text: `Beat ${rival.name}'s ${oppName}.`, tone: 'win' })
        } else if (myScore < oppScore) {
          nextCareer = logMoment(nextCareer, { week, text: `${rival.name} got the better of you.`, tone: 'loss' })
        }
      }
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
    // X3: once a season (week 12), warn a contract-owning user about expiring deals.
    const ownsContracts = capabilities(career).can.has('negotiate') || capabilities(career).can.has('manageCap')
    if (ownsContracts && world.phase === 'regular' && world.week === 12 && !world.news.some((n) => n.id === `expiring_${world.season}`)) {
      const expiring = (world.roster[career.teamId] ?? []).filter((p) => p.contract.years <= 1 && p.ovr >= 70)
      if (expiring.length) {
        const names = [...expiring].sort((a, b) => b.ovr - a.ovr).slice(0, 6).map((p) => `${p.name} (${p.pos}, ${p.ovr})`).join(', ')
        world.news.unshift({
          id: `expiring_${world.season}`,
          week: world.week,
          season: world.season,
          category: 'Roster',
          headline: `${expiring.length} contracts expire after this season`,
          body: `${names}… Extend them from the Cap screen or they hit free agency.`,
          teamId: career.teamId,
          read: false,
        })
      }
    }
    set({ career: nextCareer, match: sim, matchSeq: get().matchSeq + 1, tick: get().tick + 1 })
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
    sim.film = game.film
    sim.keys = game.keys
    set({ match: sim, matchSeq: get().matchSeq + 1, tick: get().tick + 1 })
  },
  closeMatch: () => set({ match: null }),

  setCallMode: (mode, keepPlays) => {
    const career = get().career
    if (!career) return false
    const callMode = mode === 'key' ? undefined : mode
    const gd = get().gameDay
    let applied = true
    if (gd?.state.ctx) {
      // User (2026-10-08): "make it apply straight away". The sim may already be
      // ahead of the replay. Rebuild the game up to the play on screen by replaying
      // the same seed with the same answers (the sim is deterministic), check every
      // watched play is identical, then switch mode — so the very next snap obeys it.
      const old = gd.state
      const oldCtx = gd.state.ctx
      const game = world.schedule.find((g) => g.id === gd.gameId)
      if (keepPlays !== undefined && game && keepPlays < old.plays.length && !old.done) {
        const switches = (gd.callSwitches ?? []).filter((w) => w.at <= keepPlays)
        const rebuilt = createGame(world, game.homeId, game.awayId, world.seed + game.week * 7919 + 101, { ...oldCtx, callAll: gd.callStart })
        let ok = true
        let guard = 4000
        while (ok && rebuilt.plays.length < keepPlays && !rebuilt.done && guard-- > 0) {
          // Re-apply earlier mid-game switches at the play they took effect.
          for (const w of switches) if (w.at === rebuilt.plays.length) rebuilt.ctx!.callAll = w.mode
          const m = runUntil(world, rebuilt, 'play')
          if (m) {
            const choice = old.answers[m.id]
            if (choice === undefined) ok = false
            else answerMoment(rebuilt, choice, old.autoAnswered?.[m.id] ? 'standing' : 'user')
          }
        }
        ok = ok && rebuilt.plays.length === keepPlays && rebuilt.plays.every((p, i) => {
          const q = old.plays[i]
          return q && q.offId === p.offId && q.concept === p.concept && q.result === p.result && q.yards === p.yards
        })
        if (ok) {
          rebuilt.ctx!.callAll = callMode
          set({ gameDay: { ...gd, state: rebuilt, moment: null, callSwitches: [...switches, { at: keepPlays, mode: callMode }] }, match: finishGame(rebuilt) })
        } else {
          oldCtx.callAll = callMode
          set({ gameDay: { ...gd, callSwitches: [...(gd.callSwitches ?? []), { at: old.plays.length, mode: callMode }] } })
          applied = false
        }
      } else {
        oldCtx.callAll = callMode
        set({ gameDay: { ...gd, callSwitches: [...(gd.callSwitches ?? []), { at: old.plays.length, mode: callMode }] } })
      }
    }
    set({ career: { ...career, callMode }, tick: get().tick + 1 })
    get().save()
    return applied
  },

  startGameDay: () => {
    const career = get().career
    if (!career) return
    const ctx = userCtx(career)
    if (!ctx) return
    const week = world.week
    const game = world.schedule.find(
      (g) => !g.played && g.week === week && (g.homeId === career.teamId || g.awayId === career.teamId),
    )
    if (!game) return
    const { off, def } = get().defaultPlan
    // The live game gets its own copy, so mid-game edits never touch next week's plan.
    const plan = { off: { ...off }, def: { ...def } }
    setLivePlan({ teamId: career.teamId, off: plan.off, def: plan.def })
    applyUserCoaching(career)
    // L12.6: "call every play" only applies to a coached game, never to fast sim.
    const state = createGame(world, game.homeId, game.awayId, world.seed + week * 7919 + 101, { ...ctx, callAll: career.callMode })
    // L11.5 Q2: run out the first drive so the user sees the game start.
    const moment = runUntil(world, state, 'drive')
    set({
      gameDay: { gameId: game.id, state, moment, plan, changes: [], callStart: career.callMode, callSwitches: [] },
      match: finishGame(state),
      matchSeq: get().matchSeq + 1,
      tick: get().tick + 1,
    })
    // A game that ended during the opening drive (e.g. no user moments left)
    // is already over — record it straight away on standing orders.
    if (state.done) void get().simGameDayToEnd()
  },

  setGameDayPlan: (side, plan) => {
    const gd = get().gameDay
    const career = get().career
    if (!gd || !career) return
    const next = { ...gd.plan, [side]: plan }
    // Apply from the next snap for the rest of the game (never next week).
    setLivePlan({ teamId: career.teamId, off: next.off, def: next.def })
    const preset = PLAN_PRESETS.find((p) => p.side === side && JSON.stringify(p.plan) === JSON.stringify(plan))?.label ?? 'Custom'
    const clock = clockText(gd.state.clock)
    const last = gd.changes[gd.changes.length - 1]
    const changes: PlanChange[] =
      last && last.side === side && last.preset === preset
        ? [...gd.changes.slice(0, -1), { ...last, qtr: gd.state.qtr, clock }]
        : [...gd.changes, { qtr: gd.state.qtr, clock, side, preset }]
    set({ gameDay: { ...gd, plan: next, changes }, tick: get().tick + 1 })
  },

  gameDayAdvance: async (stop) => {
    const gd = get().gameDay
    if (!gd) return
    // Never advance the sim while a moment is waiting to be answered.
    if (gd.state.pending) return
    const moment = runUntil(world, gd.state, stop)
    if (!gd.state.done) {
      set({ gameDay: { ...gd, moment }, match: finishGame(gd.state), tick: get().tick + 1 })
      return
    }
    await finishGameDay(set, get)
  },

  answerGameMoment: async (choiceId) => {
    const gd = get().gameDay
    if (!gd) return
    answerMoment(gd.state, choiceId)
    // L11.5 Q2: no more automatic run-to-moment after an answer — resolve the
    // call with one play, then hand control back to the navigation bar.
    await get().gameDayAdvance('play')
  },

  simGameDayToEnd: async () => {
    const gd = get().gameDay
    if (!gd) return
    // Answer the pending moment, then every remaining one, on standing orders.
    let m = gd.state.pending ?? runToMoment(world, gd.state)
    while (m) {
      answerMoment(gd.state, m.defaultId, 'standing')
      m = runToMoment(world, gd.state)
    }
    await finishGameDay(set, get)
  },

  abandonGameDay: () => {
    // Nothing is recorded — the week is exactly as it was before kickoff.
    setLivePlan(null)
    set({ gameDay: null, match: null, tick: get().tick + 1 })
  },

  setPlan: (side, plan) => {
    // The old live path re-simulated the game; now this only edits the saved plan.
    get().setDefaultPlan(side, plan)
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

  setCallSheet: (sheet) => {
    const career = get().career
    if (!career) return
    set({ career: { ...career, callSheet: sheet }, tick: get().tick + 1 })
    get().save()
  },

  setScript: (concepts) => {
    const career = get().career
    if (!career) return
    // Only concepts the club's scheme actually runs, capped at eight.
    const valid = new Set(offStyle(world, career.teamId).concepts.map((c) => c.name))
    const script = concepts.filter((c) => valid.has(c)).slice(0, 8)
    set({ career: withFlag({ ...career, script }, 'gameplan'), tick: get().tick + 1 })
    get().save()
  },

  setMatchups: (matchups) => {
    const career = get().career
    if (!career) return
    set({ career: withFlag({ ...career, matchups }, 'gameplan'), tick: get().tick + 1 })
    get().save()
  },

  setUsage: (usage) => {
    const career = get().career
    if (!career) return
    set({ career: withFlag({ ...career, usage }, 'gameplan'), tick: get().tick + 1 })
    get().save()
  },

  setLeaguePbp: (v) => {
    set({ leaguePbp: v, tick: get().tick + 1 })
    get().showToast(v ? 'Authentic league sim ON — every game runs play-by-play.' : 'Fast league sim restored.')
  },

  advanceStage: () => {
    const career = get().career
    if (!career) return
    if (world.phase !== 'offseason') return
    const stage = stageOf(world)
    const done = (world.offseasonDone ??= {})
    if (stage === 'resign') {
      world.offseasonStage = 'freeAgency'
      pushCareerNews(world, career, {
        category: 'Roster',
        headline: 'March: free agency opens',
        body: 'The market is open. Expiring contracts and released veterans are up for bid — go get your guys.',
      })
    } else if (stage === 'freeAgency') {
      // Leaving March: the AI clubs have their first crack at what is left.
      if (!done.fa) {
        runAIFreeAgency(world, career.teamId)
        done.fa = true
      }
      world.offseasonStage = 'draft'
      pushCareerNews(world, career, {
        category: 'Draft',
        headline: 'April: the draft is open',
        body: 'The war room is live. Stack your board and make the call when your club is on the clock.',
      })
    } else if (stage === 'draft') {
      // Leaving April with the class unfinished completes it, then camp opens.
      if (!done.draft) completeDraft(world, career)
      world.offseasonStage = 'camp'
      if (!done.trades) {
        runAITrades(world)
        done.trades = true
      }
      pushCareerNews(world, career, {
        category: 'League',
        headline: 'August: training camp',
        body: 'UDFAs are signed and the league has reshuffled. Free agency leftovers are still available before kickoff.',
      })
    } else {
      // August → kickoff: run the new-season code with every stage done.
      get().startNextSeason()
      return
    }
    set({ tick: get().tick + 1 })
    get().save()
  },

  startNextSeason: () => {
    const career = get().career
    if (!career) return
    if (world.phase !== 'offseason') return
    // L11 W2: defensively clear any lingering waiver entries into free agency.
    clearWaivers(world)
    // R4: box scores are kept for one season only.
    for (const g of world.schedule) {
      delete g.box
      delete g.film
    }
    // L12.6 C1: if the calendar was skipped (fast path, legacy save), run the
    // remaining stages — AI free agency, draft + UDFAs, AI trades — in order.
    completeOffseasonStages(world, career)
    world.season += 1
    world.week = 1
    world.phase = 'regular'
    world.offseasonStage = undefined
    world.offseasonDone = undefined
    world.awards = {}
    // #18: the league changes over the eras every few seasons.
    if (world.season % 6 === 0) world.era = ERAS[Math.floor(world.season / 6) % ERAS.length]
    // Fresh draft capital for the next cycle's Trade Center. L11.5 Q11: keep the
    // future-pick window rolling — drop drafts already held, retain owned future
    // picks, and top up the newest year.
    resolveTradePicks(world, career)
    world.draftPicks = world.draftPicks.filter((p) => p.season > world.season)
    ensureDraftWindow(world, world.season + 1)
    world.draftRounds = []
    for (const id of Object.keys(world.standings)) world.standings[id] = zeroRecord(id)
    for (const id of Object.keys(world.deadMoney)) world.deadMoney[id] = 0
    regenerateSchedule(world)
    refreshProspectClass(world)
    enforceCapCompliance(world)
    // Z1b: adopt every roster/practice-squad/IR/free-agent player into `players`.
    indexPlayers(world)
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
    // L12 W1/W2: the weekly practice plan, the keys you promised and the
    // season's leadership ledger all belong to the season that set them.
    seasonCareer.practice = undefined
    seasonCareer.keys = undefined
    seasonCareer.keysLedger = undefined
    // K1: opponents' film resets with the new season.
    seasonCareer.wrinkles = seasonCareer.wrinkles ? { season: world.season, history: [] } : undefined
    // L10 G8: opponents start a new book on your tendencies; the old read is stale.
    world.userBook = undefined
    seasonCareer.oppRead = undefined
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
      if (redFlagIds(world, career).includes(prospectId)) {
        get().showToast('He is red-flagged — clear the flag first.')
        return
      }
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

  toggleRedFlag: (prospectId) => {
    const career = get().career
    if (!career || !canRedFlag(career)) return
    // Flagging an obvious late-rounder proves nothing (and would farm reputation).
    if (!redFlagIds(world, career).includes(prospectId) && !isRedFlaggable(world, prospectId)) {
      get().showToast('Save red flags for prospects the league rates — the top 64 of the class.')
      return
    }
    if (convictionIds(world, career).includes(prospectId)) {
      get().showToast('He is a conviction call — a prospect can only be one.')
      return
    }
    const current = career.redFlags?.season === world.season ? career.redFlags.ids : []
    let ids: string[]
    if (current.includes(prospectId)) {
      ids = current.filter((id) => id !== prospectId)
    } else {
      if (current.length >= MAX_RED_FLAGS) {
        get().showToast(`Red flags are full — ${MAX_RED_FLAGS} per draft.`)
        return
      }
      ids = [...current, prospectId]
    }
    set({
      career: { ...career, redFlags: { season: world.season, ids } },
      tick: get().tick + 1,
    })
    get().save()
  },

  pickWrinkle: (side, id) => {
    const career = get().career
    if (!career || !canWrinkle(career)) return
    if (!wrinkleSides(career).includes(side)) return
    const list = side === 'off' ? OFF_WRINKLES : DEF_WRINKLES
    if (!list.some((w) => w.id === id)) return
    // A new season opens a clean film history.
    const current: NonNullable<CareerState['wrinkles']> =
      career.wrinkles && career.wrinkles.season === world.season
        ? career.wrinkles
        : { season: world.season, history: [] }
    const pick: { off?: string; def?: string; week: number } =
      current.pick && current.pick.week === world.week ? { ...current.pick } : { week: world.week }
    if (pick[side] === id) delete pick[side]
    else pick[side] = id
    set({ career: { ...career, wrinkles: { ...current, pick } }, tick: get().tick + 1 })
    get().save()
  },

  chooseInstall: (plan) => {
    const career = get().career
    if (!career || !canInstall(world, career)) return
    if (plan !== 'lean' && plan !== 'full') return
    set({ career: { ...career, install: { season: world.season + 1, plan } }, tick: get().tick + 1 })
    get().save()
  },

  pickPractice: (plan) => {
    const career = get().career
    if (!career || !canPractice(career)) return
    if (!PRACTICE_OPTIONS.some((o) => o.id === plan)) return
    const current = career.practice
    // Selecting the active plan again is a no-op; otherwise record the new plan
    // (the `week` marks the week it took effect, for Install's next-week payoff).
    if (current && current.season === world.season && current.plan === plan && current.week === world.week) return
    // Remember the plan that was in effect last week so a one-week Install payoff
    // survives changing — or re-picking — next week's plan.
    let prev = current?.prev
    if (current && current.season === world.season && current.week < world.week) {
      prev = { plan: current.plan, week: world.week - 1 }
    }
    set({ career: { ...career, practice: { plan, week: world.week, season: world.season, prev } }, tick: get().tick + 1 })
    get().save()
  },

  toggleKey: (id) => {
    const career = get().career
    if (!career || !canPickKeys(career)) return
    // Keys lock at kickoff: once the game is being coached (past the first user
    // decision) or the week's game is already played, the promise is final.
    const gd = get().gameDay
    if (gd && (gd.state.done || (gd.state.decisions ?? []).some((d) => d.source === 'user'))) return
    const game = world.schedule.find(
      (g) => g.week === world.week && (g.homeId === career.teamId || g.awayId === career.teamId),
    )
    if (game?.played) return
    if (!pickableKeys(career).some((k) => k.id === id)) return
    const current = career.keys && career.keys.season === world.season && career.keys.week === world.week ? career.keys.ids : []
    let ids: string[]
    if (current.includes(id)) ids = current.filter((x) => x !== id)
    else if (current.length >= MAX_KEYS) {
      get().showToast(`You can promise only ${MAX_KEYS} keys a game.`)
      return
    } else ids = [...current, id]
    set({ career: { ...career, keys: { week: world.week, season: world.season, ids } }, tick: get().tick + 1 })
    get().save()
  },

  pitchStarter: (pos, playerId) => {
    const career = get().career
    if (!career || !canPitch(career)) return
    if (career.weekFlags?.pitch) {
      get().showToast('You already pitched a starter this week.')
      return
    }
    const verdict = judgePitch(world, career, pos, playerId)
    if ('error' in verdict) {
      get().showToast(verdict.error)
      return
    }
    // A pitch is spent whether the coordinator buys it or passes.
    let next = withFlag(career, 'pitch')
    if (verdict.accepted) {
      const current =
        next.pitches && next.pitches.season === world.season
          ? next.pitches
          : { season: world.season, accepted: 0 }
      next = { ...next, pitches: { season: world.season, accepted: current.accepted + 1 } }
      // L12.9 L1: an accepted pitch is a dated call — graded at season end.
      const player = world.players.find((p) => p.id === playerId)
      pushLedger(next, {
        kind: 'pitch',
        playerId,
        name: player?.name ?? playerId,
        pos,
        college: player?.college ?? '—',
        note: `Pitched ${player?.name ?? 'a starter'} to the coordinator — accepted.`,
      })
    }
    set({ career: next, tick: get().tick + 1 })
    get().showToast(verdict.message)
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
    // L12.9 H1: the old "work the phones" hours action is now a free Character
    // read, capped at two a week.
    const used = (career.weekFlags?.character ? 1 : 0) + (career.weekFlags?.character2 ? 1 : 0)
    if (used >= 2) {
      get().showToast('Two character reads a week — the phones are busy.')
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
    if (!c2) return
    set({ career: withFlag(c2, used === 0 ? 'character' : 'character2'), tick: get().tick + 1 })
    get().showToast(`Character read on ${p.name}: ${FACET_LABEL[read.facet]} — ${read.label}.`)
    get().save()
  },

  // L12.9 H1: opponent film moved from the hours card to the Game Plan screen.
  studyOpponent: () => {
    const career = get().career
    if (!career) return
    if (!capabilities(career).can.has('callPlays')) return
    const oppId = weekOpponent(world, career.teamId)
    if (!oppId) {
      get().showToast('No opponent this week to scout.')
      return
    }
    const prev = career.oppRead
    if (prev && prev.week === world.week && prev.oppId === oppId && prev.sharp) {
      get().showToast('Your read on this opponent is already sharp.')
      return
    }
    // The first look this week is fuzzy; a second sharpens it.
    const sharp = !!prev && prev.week === world.week && prev.oppId === oppId
    set({ career: { ...career, oppRead: { week: world.week, oppId, sharp } }, tick: get().tick + 1 })
    get().showToast(
      sharp
        ? `Sharp film read on the ${world.byId[oppId].name} — their tendencies are clear.`
        : `Studied the ${world.byId[oppId].name} — a fuzzy read on their tendencies.`,
    )
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
  acceptCounter: () => {
    const career = get().career
    if (!career) return
    const counter = career.counter
    // The counter is only live for the season that produced it, and only once.
    if (!counter || counter.season !== world.season || counter.taken) return
    const team = world.byId[career.teamId]
    const next: CareerState = {
      ...career,
      salary: Math.round(career.salary * 1.25),
      jobSecurity: clamp(career.jobSecurity + 15, 0, 100),
      reputation: { ...career.reputation, leadership: clamp(career.reputation.leadership + 1, 0, 100) },
      counter: { ...counter, taken: true },
    }
    const withMoment = logMoment(next, {
      week: next.week,
      text: `You stayed: the ${team.name} owner matched with a raise.`,
      tone: 'win',
    })
    set({ career: withMoment, offers: [], modal: 'none', tick: get().tick + 1 })
    get().showToast(`The ${team.name} matched the offer. You are staying.`)
    get().save()
  },
  declineOffers: () => set({ offers: [], modal: 'none' }),

  userOnClock: () => userOnClock(world, get().career),

  draftProspect: (id) => {
    const career = get().career
    if (!career) return
    // L12.6 C2: the draft is an April event — no drafting during the season.
    if (!draftOpen(world)) {
      get().showToast('The draft is in April — scout the class now.')
      return
    }
    if (!userOnClock(world, career)) return
    const prospect = world.draft.find((d) => d.id === id)
    if (!prospect) return
    if (redFlagIds(world, career).includes(prospect.id)) {
      get().showToast(`${prospect.name} is on your red-flag list — drafting him anyway.`)
    }
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
    logRedFlags(world, career)
    set({ career: { ...career }, tick: get().tick + 1 })
    announceDraftPicks(world, career)
    resolveTradePicks(world, career)
    get().save()
  },
  simToMyPick: () => {
    if (!draftOpen(world)) {
      get().showToast('The draft is in April — scout the class now.')
      return
    }
    simUntilUser(world, get().career)
    const career = get().career
    if (career) logConvictionPicks(world, career)
    if (career) logRedFlags(world, career)
    if (career) announceDraftPicks(world, career)
    if (career) resolveTradePicks(world, career)
    bump(set, get)
    get().save()
  },
  finishDraft: () => {
    // L12.6 C2: only April opens the draft; in season this is a no-op.
    if (!draftOpen(world)) {
      get().showToast('The draft is in April — scout the class now.')
      return
    }
    const career = get().career
    completeDraft(world, career)
    if (career) announceDraftPicks(world, career)
    if (career) resolveTradePicks(world, career)
    bump(set, get)
    get().showToast('The draft is complete. Undrafted free agents have signed.')
    get().save()
  },

  signFreeAgent: (id) => {
    const career = get().career
    if (!career) return
    // L12.6 C3: the true market opens in March; February is the re-sign window.
    if (world.phase === 'offseason' && stageOf(world) === 'resign') {
      get().showToast('Free agency opens in March.')
      return
    }
    if (!canSignFreeAgents(career)) {
      get().showToast('You do not have roster control yet — keep climbing.')
      return
    }
    const idx = world.freeAgents.findIndex((p) => p.id === id)
    if (idx < 0) return
    const p = world.freeAgents[idx]
    // W1: a released player carries a zeroed contract, so price the signing
    // here (one year at market, pro-rated for the weeks left in season).
    const contract = freeAgentContract(p, world.season, world.week, world.phase)
    const cap = summarizeCap(world.roster[career.teamId] ?? [], world.deadMoney[career.teamId] ?? 0, world.season)
    if (cap.space < contract.capHit) {
      get().showToast('Not enough cap space to sign this player.')
      return
    }
    world.freeAgents.splice(idx, 1)
    p.teamId = career.teamId
    p.contract = contract
    p.origin = { kind: 'freeAgent', season: world.season, by: career.gmName, fromTeamId: null }
    if (isOnShadowBoard(career, p.id)) p.origin.note = '(from your shadow board)'
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
    const original = { ...p.contract }
    p.contract = { ...p.contract, years: 0, base: [0], proration: 0, guaranteed: 0, capHit: 0 }
    // W2: in-season releases go on the waiver wire, not straight to free agency.
    if (world.phase === 'regular') {
      placeOnWaivers(world, p, career.teamId, original, dead)
    } else {
      world.freeAgents.push(p)
    }
    bump(set, get)
    get().showToast(`${p.name} released. Dead money: $${(dead / 1e6).toFixed(1)}M.`)
    get().save()
  },

  claimWaiver: (playerId) => {
    const career = get().career
    if (!career) return
    if (!canSignFreeAgents(career)) {
      get().showToast('You do not have roster control yet — keep climbing.')
      return
    }
    const waivers = world.waivers ?? []
    const entry = waivers.find((e) => e.playerId === playerId)
    if (!entry) return
    if (entry.fromTeamId === career.teamId) {
      get().showToast('You cannot claim a player you just released.')
      return
    }
    const mine = waivers.filter((e) => e.claims.includes(career.teamId)).length
    if (!entry.claims.includes(career.teamId) && mine >= 3) {
      get().showToast('You already have three open waiver claims.')
      return
    }
    // W4: the same cap / roster test the Tuesday processing will apply; the UI
    // shows the reason up front so a filed claim is never silently dead.
    const blocked = waiverBlockedReason(world, career.teamId, entry, true)
    if (blocked === 'cap') {
      get().showToast('Not enough cap space to take on this contract.')
      return
    }
    if (blocked === 'roster') {
      get().showToast('No roster spot — every position is already at its floor.')
      return
    }
    if (!entry.claims.includes(career.teamId)) entry.claims.push(career.teamId)
    const p = world.players.find((x) => x.id === playerId)
    bump(set, get)
    get().showToast(`Waiver claim filed for ${p?.name ?? 'the player'}. It resolves on Tuesday.`)
    get().save()
  },

  cancelWaiverClaim: (playerId) => {
    const career = get().career
    if (!career) return
    if (!canSignFreeAgents(career)) return
    const entry = (world.waivers ?? []).find((e) => e.playerId === playerId)
    if (!entry || !entry.claims.includes(career.teamId)) return
    entry.claims = entry.claims.filter((t) => t !== career.teamId)
    bump(set, get)
    get().showToast('Waiver claim withdrawn.')
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

  offerExtension: (playerId, offer) => {
    const career = get().career
    if (!career) return
    if (!capabilities(career).can.has('negotiate')) {
      get().showToast('Extension talks open higher up the ladder.')
      return
    }
    const p = (world.roster[career.teamId] ?? []).find((x) => x.id === playerId)
    if (!p || p.contract.years > 2) {
      get().showToast('He is not eligible for an extension.')
      return
    }
    // Bookkeeping: a new season resets the table; three rejections ends talks.
    const talks = { ...(career.talks ?? {}) }
    const record = talks[playerId]
    const fresh = !record || record.season !== world.season
    const tries = fresh ? 0 : (record?.tries ?? 0)
    if (!fresh && (record?.closed || tries >= 3)) {
      get().showToast('His camp has stopped taking calls this season.')
      return
    }
    const verdict = judgeOffer(p, world.season, offer)
    if (!verdict.accepted) {
      const nextTries = tries + 1
      talks[playerId] = { season: world.season, tries: nextTries, closed: nextTries >= 3 }
      set({ career: { ...career, talks } })
      get().showToast(verdict.message)
      bump(set, get)
      get().save()
      return
    }
    // Accepted — unless you own the cap, the GM still has to sign off.
    const next = buildExtension(p, world.season, offer)
    if (!capabilities(career).can.has('manageCap')) {
      const market = Math.round(marketAAV(p.ovr, p.pos, p.age) * capScale(world.season))
      if (offer.aav > market * 1.1) {
        get().showToast(`The GM killed the deal: ${money(offer.aav)}/yr is over 110% of market.`)
        return
      }
      const cap = summarizeCap(world.roster[career.teamId] ?? [], world.deadMoney[career.teamId] ?? 0, world.season)
      if (cap.space + p.contract.capHit - next.capHit < 0) {
        get().showToast("The GM killed the deal: it doesn't fit under the cap.")
        return
      }
    }
    p.contract = next
    talks[playerId] = { season: world.season, tries, closed: true }
    pushLedger(career, {
      kind: 'contract',
      playerId: p.id,
      name: p.name,
      pos: p.pos,
      college: '—',
      aav: offer.aav,
      ovrAtSign: p.ovr,
      note: `Extended ${p.name}: ${offer.years} yrs, ${money(offer.aav)}/yr`,
    })
    set({ career: { ...career, talks } })
    bump(set, get)
    get().showToast(`${p.name} extended: ${offer.years} yrs, ${money(offer.aav)}/yr.`)
    get().save()
  },

  toggleShadowBoard: (playerId) => {
    const career = get().career
    if (!career || !canShadow(career)) return
    const { board, message } = toggleShadow(world, career, playerId)
    set({ career: { ...career, shadowBoard: board } })
    get().showToast(message)
    bump(set, get)
    get().save()
  },

  fileCapMemo: (bucket, priorityIds, note) => {
    const career = get().career
    if (!career || !canFileMemo(world, career)) return
    const roster = world.roster[career.teamId] ?? []
    const priorities = priorityIds
      .map((id) => roster.find((p) => p.id === id))
      .filter((p): p is Player => !!p && p.contract.years <= 2)
      .slice(0, 3)
      .map((p) => ({ playerId: p.id, signedThrough: p.contract.signedThrough }))
    const memo: CapMemo = {
      filedSeason: world.season,
      bucket,
      priorities,
      note: note.slice(0, 120),
    }
    set({ career: { ...career, capMemo: memo } })
    get().showToast('Cap memo filed. It will be graded at the end of next season.')
    bump(set, get)
    get().save()
  },

  combineAction: (prospectId, kind) => {
    const career = get().career
    if (!career) return
    const rng = makeRng(world.seed + world.season * 433 + hash32(prospectId + kind, 3))
    const result = applyCombine(world, career, prospectId, kind, rng)
    if ('error' in result) {
      get().showToast(result.error)
      return
    }
    set({ career: result.career })
    get().showToast(result.message)
    bump(set, get)
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
    // W1: PS deals are priced too, at the flat practice-squad salary.
    p.contract = freeAgentContract(p, world.season, world.week, world.phase, 250_000)
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
      if (p) {
        p.origin = { kind: 'trade', season: world.season, by: career.gmName, fromTeamId: partnerId }
        if (isOnShadowBoard(career, p.id)) p.origin.note = '(from your shadow board)'
      }
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

  // L12.5 T5: your side of the trade block (max 5, pruned to the current roster).
  toggleTradeBlock: (playerId) => {
    const career = get().career
    if (!career) return
    const rosterIds = new Set((world.roster[career.teamId] ?? []).map((p) => p.id))
    const current = (career.tradeBlock ?? []).filter((id) => rosterIds.has(id))
    const on = current.includes(playerId)
    let next = current
    if (on) {
      next = current.filter((id) => id !== playerId)
    } else if (rosterIds.has(playerId)) {
      if (current.length >= 5) {
        get().showToast('Your trade block is full (5 players).')
      } else {
        next = [...current, playerId]
      }
    }
    set({ career: { ...career, tradeBlock: next }, tick: get().tick + 1 })
    get().save()
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

  // L11.5 Q8: front-office staffer changes focus (once per season per staffer).
  setStaffFocus: (staffId, focus) => {
    const career = get().career
    if (!career) return
    if (accessFor(career, 'staff') !== 'decide') {
      get().showToast('You do not make staff decisions at this rung.')
      return
    }
    const staff = world.staff[career.teamId] ?? []
    const m = staff.find((s) => s.id === staffId)
    if (!m || !isFrontOfficeRole(m.role)) return
    if (!focusOptions(m.role).includes(focus)) return
    if (m.focusChanged === world.season) {
      get().showToast(`${m.name} already changed focus this season.`)
      return
    }
    m.focus = focus
    m.focusChanged = world.season
    bump(set, get)
    get().showToast(`${m.name} now focuses on ${focus}.`)
    get().save()
  },

  markRead: (id) => set((s) => ({ readNews: { ...s.readNews, [id]: true } })),

  // L11.5 Q12: clear the whole inbox at once.
  markAllNewsRead: () => {
    const readNews: Record<string, boolean> = {}
    for (const n of world.news) {
      readNews[n.id] = true
      n.read = true
    }
    set({ readNews })
    get().save()
  },

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
  if (!career) {
    setUserCoaching(null)
    return
  }
  const holdsRole = career.path === 'coach' && career.level >= 2
  // K1/K2 can apply even outside the normal coaching-skill path; an HC,
  // coordinator or installer always holds the role, so in practice this is the same.
  if (!holdsRole && !canWrinkle(career) && !capabilities(career).can.has('installScheme')) {
    setUserCoaching(null)
    return
  }
  const b = holdsRole
    ? userBonusFromSkills(career.skills, true, career.unitFocus === 'both' ? 'both' : career.unitFocus ?? 'both')
    : NO_USER_BONUS
  // K1/K2/W1: the combined per-side bonus is clamped so it can never blow up the sim.
  const wrinkle = wrinkleBonus(career, world.week)
  const install = installBonus(career, world)
  const practice = practiceEdge(career, world)
  const extra = {
    off: wrinkle.off + install.off + practice.off,
    def: wrinkle.def + install.def + practice.def,
  }
  setUserCoaching({
    teamId: career.teamId,
    off: b.off + clamp(extra.off, -0.6, 1.5),
    def: b.def + clamp(extra.def, -0.6, 1.5),
    development: b.development,
    situational: b.situational,
  })
}

/**
 * The user's per-game context from their career: `planScope` decides whether
 * they call moments at all, and `unitFocus` narrows a coordinator to one side.
 */
export function userCtx(career: CareerState | null): GameCtx | undefined {
  if (!career) return undefined
  const scope = capabilities(career).planScope
  if (scope === 'none') return undefined
  const callSheet = career.callSheet ?? DEFAULT_CALL_SHEET
  // G10: the script is an offense-side tool; a defensive coordinator never runs it.
  const hasOff = scope === 'both' || career.unitFocus !== 'def'
  const script = hasOff ? career.script ?? [] : []
  const scriptEdgeMult = career.install?.season === world.season && career.install.plan === 'full' ? 1.5 : 1
  const oppRead = career.oppRead
  const matchups = career.matchups
  const usage = career.usage
  if (scope === 'both') return { userTeamId: career.teamId, scope: 'hc', callSheet, script, scriptEdgeMult, oppRead, matchups, usage }
  const focus = career.unitFocus ?? 'both'
  return {
    userTeamId: career.teamId,
    scope: focus === 'off' ? 'off' : focus === 'def' ? 'def' : 'both',
    callSheet, script, scriptEdgeMult, oppRead, matchups, usage,
  }
}

/**
 * Record a completed game-day sim through `advanceWeek` exactly as a fast-simmed
 * user game would be (L11.5 Q2/Q3).
 */
async function finishGameDay(
  set: (p: Partial<GameStore>) => void,
  get: () => GameStore,
) {
  const gd = get().gameDay
  if (!gd) return
  const sim = finishGame(gd.state)
  if (gd.changes.length) sim.planChanges = gd.changes
  setLivePlan(null)
  set({ gameDay: null, match: sim, tick: get().tick + 1 })
  await get().advanceWeek({ userSim: sim })
}

/** L11.5 Q3: game clock as `m:ss`, for the film-card plan changes. */
function clockText(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Authentic league week: simulate every non-user game play-by-play in a worker
 * and apply the results with real box scores. Returns false on worker failure so
 * the caller can fall back to the fast allocator.
 */
async function simulateLeagueWeek(world: World, week: number, exceptGameId?: string, recovery?: WeekRecovery): Promise<boolean> {
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
  healAfterWeek(world, week, recovery)
  return true
}

/**
 * L11 W4: turn a resolved waiver turn into news for the inbox, and return the
 * season moments to log. A user claim won gets a news item and a moment; a claim
 * lost gets news; an AI club claiming a player the user released gets news.
 */
function waiveNews(
  world: World,
  teamId: string,
  open: { playerId: string; fromTeamId: string; userClaimed: boolean }[],
  result: { claimed: { playerId: string; teamId: string }[]; cleared: string[] },
): { text: string; tone: SeasonMoment['tone'] }[] {
  const meta = new Map(open.map((e) => [e.playerId, e]))
  const moments: { text: string; tone: SeasonMoment['tone'] }[] = []
  const news = (id: string, headline: string, body: string) =>
    world.news.unshift({
      id,
      week: world.week,
      season: world.season,
      category: 'Roster',
      headline,
      body,
      teamId,
      read: false,
    })
  for (const c of result.claimed) {
    const p = world.players.find((x) => x.id === c.playerId)
    const m = meta.get(c.playerId)
    if (!p || !m) continue
    const winner = world.byId[c.teamId]?.name ?? c.teamId
    const from = world.byId[m.fromTeamId]?.name ?? m.fromTeamId
    if (c.teamId === teamId) {
      news(
        `waiverwin_${world.season}_${world.week}_${p.id}`,
        `Claimed ${p.name} off waivers`,
        `You won the claim for ${p.name} (${p.pos}, ${p.ovr}) from the ${from}.`,
      )
      moments.push({ text: `Claimed ${p.name} off waivers from the ${from}.`, tone: 'win' })
    } else {
      if (m.userClaimed) {
        news(
          `waiverlose_${world.season}_${world.week}_${p.id}`,
          `${winner} claimed ${p.name} ahead of you.`,
          `Your waiver claim for ${p.name} (${p.pos}, ${p.ovr}) lost to the ${winner}.`,
        )
      }
      if (m.fromTeamId === teamId) {
        news(
          `waivercut_${world.season}_${world.week}_${p.id}`,
          `${winner} claimed ${p.name} off waivers.`,
          `The ${winner} took over ${p.name}'s original contract after you released him.`,
        )
      }
    }
  }
  return moments
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
  // L12.7: rookies drafted under the old college-scale rule get the NFL rookie scale, once.
  rescaleLegacyRookies(w)
  // Z1b: legacy saves can hold roster/PS/IR/free-agent players with no canonical
  // `players` entry; adopt them so development and lookups can see everyone.
  indexPlayers(w)
  w.staffTenure ??= {}
  w.draft ??= []
  w.draftPicks ??= []
  w.draftRounds ??= []
  w.practiceSquad ??= {}
  w.ir ??= {}
  w.compLedger ??= {}
  w.rivals ??= []
  w.waivers ??= []
  // L12.6 C1: a legacy offseason save lands on the right stage — the draft if
  // the class is unfinished, otherwise camp.
  if (w.phase === 'offseason' && !w.offseasonStage) {
    w.offseasonStage = w.draftState?.complete ? 'camp' : 'draft'
  }
  w.era ??= { id: 'modern', label: 'Modern Spread Era', positionBias: {}, capSpike: 1 }
  // L10 G8: a tendency book from a past season is stale — drop it.
  if (w.userBook && w.userBook.season !== w.season) w.userBook = undefined
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
  // L11.5 Q11: make sure the rolling window of tradeable picks exists; a legacy
  // save gets the missing draft years created (owned by the original team).
  ensureDraftWindow(w, w.season + 1)
  // Older saves stored a 32-team draft order; rebuild the ownership-aware one
  // (preserving the current pick index) unless the draft is already finished.
  if ((w.draftOrder?.length ?? 0) < DRAFT_ROUNDS * 32 && !w.draftState?.complete) {
    const built = buildDraftOrder(w)
    w.draftOrder = built.order
    w.draftRounds = built.rounds
    w.draftPickIds = built.ids
  }
  // L11.5 Q8: front-office staff get a focus + front-office specialty. Deterministic
  // from the id, so a legacy save lands on the same values every load.
  const applyFrontOffice = (m: import('../game/types').StaffMember) => {
    if (!isFrontOfficeRole(m.role)) return
    const prof = frontOfficeProfile(m.role, m.id)
    if (prof.focus) m.focus ??= prof.focus
    if (prof.specialty) m.specialty = prof.specialty
  }
  for (const team of Object.keys(w.staff)) for (const m of w.staff[team]) applyFrontOffice(m)
  for (const m of w.staffPool) applyFrontOffice(m)
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
  // L10 G10: optional opening script defaults to empty.
  base.script ??= []
  // L11.5 Q6: per-week action counts (optional on legacy saves).
  base.weekActionCounts ??= {}
  // L10 G11/G12: matchup and workload defaults (optional on legacy saves).
  base.matchups ??= {}
  base.usage ??= { rb: 'normal', dl: 'starters' }
  if (rep && typeof rep === 'object' && 'evaluation' in (rep as object)) {
    // Already migrated; just ensure skills exist.
    const sheet = base.callSheet ?? DEFAULT_CALL_SHEET
    if (!base.skills || typeof base.skills !== 'object') {
      return { ...base, skills: { ...ZERO_SKILLS }, callSheet: sheet }
    }
    return { ...base, callSheet: sheet }
  }
  const legacy = typeof rep === 'number' ? rep : 20
  return {
    ...base,
    callSheet: base.callSheet ?? DEFAULT_CALL_SHEET,
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
  if (team && team.tier === 'NFL') {
    retargetSeedNews(w, c.teamId)
    return c
  }
  const fallback = w.teams.find((t) => t.tier === 'NFL')?.id ?? 'BUF'
  retargetSeedNews(w, fallback)
  return { ...c, teamId: fallback, tier: 'NFL' }
}

// ── Season transition ────────────────────────────────────────────────────────

/**
 * L12.6 C1/C2: finish the draft class — the AI picks out the board, UDFAs sign —
 * and log the conviction / red-flag calls. Idempotent: once the class is complete
 * it only re-runs the (also idempotent) logging. Marks the stage done.
 */
function completeDraft(world: World, career: CareerState | null) {
  if (!world.draftState.complete) {
    simulateRestOfDraft(world, career)
    runUDFAs(world)
    world.draftState.complete = true
  }
  if (career) {
    logConvictionPicks(world, career)
    logRedFlags(world, career)
  }
  ;(world.offseasonDone ??= {}).draft = true
}

/**
 * L12.6 C1: run every offseason stage that hasn't happened yet, in calendar
 * order and exactly once. `startNextSeason` calls this so a fast path from any
 * stage (probe, import, stall) still produces a legal new season.
 */
function completeOffseasonStages(world: World, career: CareerState | null) {
  const done = (world.offseasonDone ??= {})
  if (!done.fa) {
    runAIFreeAgency(world, career?.teamId)
    done.fa = true
  }
  if (!done.draft) completeDraft(world, career)
  if (!done.trades) {
    runAITrades(world)
    done.trades = true
  }
  // The draft + UDFAs can push rosters over 53; the FA trim ran before them, so
  // cut back to a legal 53 here (same trimmer the FA market uses).
  trimNflRosters(world)
}

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
  // L12.7 D3: a season-end development report on your young players, using the
  // lastGrowth stamp each player earned in developPlayers.
  if (career) {
    const young = (world.roster[career.teamId] ?? [])
      .filter((p) => p.age <= 26 && p.lastGrowth?.season === world.season)
      .sort((a, b) => (b.lastGrowth!.to - b.lastGrowth!.from) - (a.lastGrowth!.to - a.lastGrowth!.from))
    if (young.length) {
      const lines = young.map((p) => {
        const g = p.lastGrowth!
        return `${p.name} (${p.pos}) ${g.from} → ${g.to} — ${experienceLabel(g.experience)}`
      })
      pushCareerNews(world, career, {
        category: 'Roster',
        headline: 'Development report',
        body: lines.join(' · '),
      })
    }
  }
  // A GM/owner who owns contracts negotiates his own re-signings; only an NPC
  // front office (scout, coach) has the AI handle them.
  const ownsContracts = career
    ? capabilities(career).can.has('negotiate') || capabilities(career).can.has('manageCap')
    : false
  runAIResign(world, ownsContracts && career ? career.teamId : undefined)
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
    // G1: grade the shadow board against who actually grew — or who you landed.
    if (canShadow(career)) {
      const shadow = gradeShadowBoard(world, career)
      if (shadow.hits) {
        const repS: Reputation = { ...careerNext.reputation }
        for (const [k, v] of Object.entries(shadow.rep)) {
          ;(repS as unknown as Record<string, number>)[k] = clamp(
            ((repS as unknown as Record<string, number>)[k] ?? 0) + (v as number),
            0,
            100,
          )
        }
        careerNext = { ...careerNext, reputation: repS }
        // Hits feed the Résumé as recommendations, so portfolio picks them up.
        for (const h of shadowHits(world, career)) {
          const sp = world.players.find((x) => x.id === h.entry.playerId)
          pushLedger(career, {
            kind: 'recommendation',
            recommendation: 'Starter',
            playerId: h.entry.playerId,
            name: h.entry.name,
            pos: h.entry.pos,
            college: sp?.college ?? '—',
            note: 'Shadow board hit',
            hit: true,
          })
        }
        for (const line of shadow.lines) {
          careerNext = logMoment(careerNext, { week: careerNext.week, text: line, tone: 'win' })
        }
      }
      // Retired players fall off the board; hits are booked and leave it, and the
      // misses carry over re-based to today's rating so nothing is paid twice.
      const hitIds = new Set(shadowHits(world, career).map((h) => h.entry.playerId))
      careerNext = {
        ...careerNext,
        shadowBoard: pruneShadowBoard(world, career)
          .filter((e) => !hitIds.has(e.playerId))
          .map((e) => ({ ...e, ovrAtAdd: world.players.find((x) => x.id === e.playerId)?.ovr ?? e.ovrAtAdd, season: world.season })),
      }
    }
    // G3: grade the cap memo filed last offseason now that this season is done.
    const capMemo = careerNext.capMemo
    if (capMemo && !capMemo.graded) {
      const memoGrade = gradeCapMemo(world, careerNext)
      if (memoGrade) {
        const repMemo: Reputation = { ...careerNext.reputation }
        for (const [k, v] of Object.entries(memoGrade.rep)) {
          ;(repMemo as unknown as Record<string, number>)[k] = clamp(
            ((repMemo as unknown as Record<string, number>)[k] ?? 0) + (v as number),
            0,
            100,
          )
        }
        pushLedger(careerNext, {
          kind: 'advice',
          name: 'Cap memo',
          pos: '—',
          college: '—',
          note: memoGrade.summary,
        })
        careerNext = { ...careerNext, reputation: repMemo, capMemo: { ...capMemo, graded: true } }
        for (const line of memoGrade.lines) {
          careerNext = logMoment(careerNext, { week: careerNext.week, text: line, tone: 'info' })
        }
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
    // K4: red-flag calls that matured this season pay out evaluation/profile.
    const rfPayout = redFlagPayout(newly)
    if (Object.keys(rfPayout.rep).length) {
      const repR: Reputation = { ...careerNext.reputation }
      for (const [k, v] of Object.entries(rfPayout.rep)) {
        ;(repR as unknown as Record<string, number>)[k] = clamp(
          ((repR as unknown as Record<string, number>)[k] ?? 0) + (v as number),
          0,
          100,
        )
      }
      careerNext = { ...careerNext, reputation: repR }
    }
    for (const line of rfPayout.lines) {
      careerNext = logMoment(careerNext, { week: careerNext.week, text: line, tone: 'win' })
    }
    // K3: the coordinator who bought your pitches vouches for your eye — a
    // position coach builds a leadership reputation one accepted pitch at a time.
    const acceptedPitches = career?.pitches?.season === world.season ? career.pitches.accepted : 0
    if (acceptedPitches > 0) {
      const repP: Reputation = { ...careerNext.reputation }
      repP.leadership = clamp(repP.leadership + Math.min(3, acceptedPitches), 0, 100)
      careerNext = { ...careerNext, reputation: repP }
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
    // Z2: stamp each rival's reputation before they advance, so the Rising Star
    // award can score the year-over-year gain.
    world.rivals = world.rivals.map((r) => ({ ...r, prevReputation: r.reputation }))
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

  // ── L9 Z2: staff awards (deterministic, no rng) ────────────────────────────
  if (careerNext) {
    const cn = careerNext
    const before = career?.reputation
    const repGain = Math.round(
      (Object.keys(cn.reputation) as (keyof Reputation)[]).reduce(
        (s, k) => s + (cn.reputation[k] - (before ? before[k] : 0)),
        0,
      ),
    )
    const seasonAwards = computeStaffAwards(world, cn, graded.doneCount, repGain)
    world.staffAwards = [...(world.staffAwards ?? []), ...seasonAwards].slice(-40)
    // Write this season's win totals so next year's awards can score improvement.
    world.lastWins = Object.fromEntries(world.teams.map((t) => [t.id, world.standings[t.id]?.wins ?? 0]))

    const userAwards = seasonAwards.filter((a) => a.isUser)
    if (userAwards.length) {
      // +2 profile per honour, +1 more for Exec/Coach of the Year; the whole
      // feature is capped at +3 profile in a season (reputation guardrail).
      const gain = Math.min(
        3,
        userAwards.reduce(
          (s, a) => s + (a.award === EXEC_OF_YEAR || a.award === COACH_OF_YEAR ? 3 : 2),
          0,
        ),
      )
      careerNext = {
        ...cn,
        reputation: { ...cn.reputation, profile: clamp(cn.reputation.profile + gain, 0, 100) },
      }
      for (const a of userAwards) {
        careerNext = {
          ...careerNext,
          honors: [...(careerNext.honors ?? []), { season: world.season, award: a.award }],
        }
        careerNext = logMoment(careerNext, { week: careerNext.week, text: `You were named ${a.award}.`, tone: 'win' })
        pushCareerNews(world, careerNext, {
          category: 'Career',
          headline: `You were named ${a.award}`,
          body: `${a.award} for the ${world.season} season. ${a.line}`,
        })
      }
    }
  }

  // ── L10 G5: reward a season of sound in-game calls (once, within the cap) ────
  if (careerNext) {
    const seasonTeam = career?.teamId ?? careerNext.teamId
    // Only games you actually coached (at least one call made in the moment)
    // count, and it takes a real sample: fast-simmed standing orders earn nothing.
    const filmGames = world.schedule.filter(
      (g) => g.played && g.film && (g.film.userCalls ?? 0) > 0 && (g.homeId === seasonTeam || g.awayId === seasonTeam),
    )
    if (filmGames.length >= 4) {
      const avg = filmGames.reduce((s, g) => s + (g.film?.grade ?? 0), 0) / filmGames.length
      const bonus = avg >= 90 ? 2 : avg >= 85 ? 1 : 0
      if (bonus > 0) {
        careerNext = {
          ...careerNext,
          reputation: {
            ...careerNext.reputation,
            leadership: clamp(careerNext.reputation.leadership + bonus, 0, 100),
          },
        }
        careerNext = logMoment(careerNext, {
          week: careerNext.week,
          text: `Your film grade averaged ${avg.toFixed(1)} — the staff learned from your calls (leadership +${bonus}).`,
          tone: 'win',
        })
      }
    }
  }

  const offers = careerNext ? generateJobOffers(world, careerNext) : []
  // L9 Z4: if a rival club comes calling, the current owner may counter to keep
  // you — once a season, and only for owners who invest in their people.
  if (careerNext && (!careerNext.counter || careerNext.counter.season !== world.season)) {
    if (counterOffer(world, careerNext, offers)) {
      careerNext = { ...careerNext, counter: { season: world.season, taken: false } }
    }
  }
  // L11 W2: the wire closes with the regular season — anything left clears to FA.
  clearWaivers(world)
  world.phase = 'offseason'
  // L12.6 C1: the calendar opens with the February re-sign window.
  world.offseasonStage = 'resign'
  world.offseasonDone = {}

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
    staffAwards: (world.staffAwards ?? []).filter((a) => a.season === world.season),
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
      setLivePlan({ teamId: m.h, off: p.off, def: BALANCED_PLAN })
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

/** Dev-only probe: check no single game-plan setting dominates the sim (#L10 F2).
 * For each of up to 8 NFL opponents and each preset, plays `n` games with the
 * user's club as the home team and reports points against/by preset. */
export function planMatrix(n = 60) {
  const career = useGame.getState().career
  const userTeam = career?.teamId ?? 'BUF'
  const nfl = world.teams.filter((t) => t.tier === 'NFL')
  const opponents = nfl.filter((t) => t.id !== userTeam).slice(0, 8)
  const defPresets = PLAN_PRESETS.filter((p) => p.side === 'def')
  const offPresets = PLAN_PRESETS.filter((p) => p.side === 'off')
  // Paired seeds: every preset faces the exact same games.
  const seeds = Array.from({ length: n }, (_, i) => world.seed + i * 7919 + 101)

  const runSide = (side: 'off' | 'def', presets: typeof PLAN_PRESETS) => {
    const perOpp: Record<string, Record<string, number>> = {}
    for (const opp of opponents) {
      const row: Record<string, number> = {}
      for (const preset of presets) {
        let total = 0
        for (const seed of seeds) {
          setLivePlan(
            side === 'def'
              ? { teamId: userTeam, off: BALANCED_PLAN, def: preset.plan }
              : { teamId: userTeam, off: preset.plan, def: BALANCED_PLAN },
          )
          const sim = simulatePlayByPlay(world, userTeam, opp.id, seed)
          // Point margin for the user's club, so offense and defense are judged alike
          // (a hurry-up offense that scores more but gives up more is not "better").
          total += sim.homeScore - sim.awayScore
        }
        row[preset.label] = +(total / n).toFixed(2)
      }
      perOpp[opp.id] = row
    }
    setLivePlan(null)
    const labels = presets.map((p) => p.label)
    const bestCount: Record<string, number> = Object.fromEntries(labels.map((l) => [l, 0]))
    const edgeVsBalanced: Record<string, number> = Object.fromEntries(labels.map((l) => [l, 0]))
    for (const opp of opponents) {
      const row = perOpp[opp.id]
      const best = Math.max(...labels.map((l) => row[l]))
      for (const l of labels) if (row[l] === best) bestCount[l] += 1
      for (const l of labels) edgeVsBalanced[l] += row[l] - (row.Balanced ?? 0)
    }
    for (const l of labels) edgeVsBalanced[l] = +(edgeVsBalanced[l] / Math.max(1, opponents.length)).toFixed(2)
    // Opponent keys sit at the top level alongside the summary maps.
    return { ...perOpp, bestCount, edgeVsBalanced }
  }

  return {
    n,
    userTeam,
    opponents: opponents.map((t) => t.id),
    defense: runSide('def', defPresets),
    offense: runSide('off', offPresets),
  }
}

/** Dev-only probe: prove game-day pauses never change the RNG stream (L10 G1). */
export function gameDayEquivalence(n = 20) {
  const career = useGame.getState().career
  if (!career) return { error: 'no career' }
  const nfl = world.teams.filter((t) => t.tier === 'NFL')
  const ctx: GameCtx = { userTeamId: career.teamId, scope: 'hc', callSheet: career.callSheet ?? DEFAULT_CALL_SHEET }
  const pick = (g: GameSim) => JSON.stringify({ h: g.homeScore, a: g.awayScore, p: g.plays, s: g.stats })
  let identical = 0
  let total = 0
  for (let i = 0; i < n; i++) {
    const opp = nfl.filter((t) => t.id !== career.teamId)[i % Math.max(1, nfl.length - 1)]
    if (!opp) continue
    const seed = world.seed + i * 7919 + 101
    const a = simulatePlayByPlay(world, career.teamId, opp.id, seed, ctx)
    const s = createGame(world, career.teamId, opp.id, seed, ctx)
    for (let m = runToMoment(world, s); m; m = runToMoment(world, s)) answerMoment(s, m.defaultId, 'standing')
    const b = finishGame(s)
    if (pick(a) === pick(b)) identical++
    total++
  }
  return { identical, total }
}

/**
 * Dev-only probe (L10 G13): does any "always X" call policy beat the standing
 * order? For each offensive call class and each defensive call, play `n` games
 * against four opponents, answering only that moment (with source 'user') and
 * leaving every other moment on its standing order. Reports the average point
 * margin from the user's side and the standing baseline.
 */
export function decisionProbe(n = 100) {
  const career = useGame.getState().career
  if (!career) return { error: 'no career' }
  const nfl = world.teams.filter((t) => t.tier === 'NFL')
  const opponents = nfl.filter((t) => t.id !== career.teamId).slice(0, 4)
  const ctx: GameCtx = { userTeamId: career.teamId, scope: 'hc', callSheet: career.callSheet ?? DEFAULT_CALL_SHEET }
  const concepts = offStyle(world, career.teamId).concepts
  const classOf = (name: string): OffClass | undefined => {
    const c = concepts.find((x) => x.name === name)
    return c ? offClassFor(c.type, c.depth) : undefined
  }
  type CallPolicy = 'standing' | 'run' | 'short' | 'deep'
  type DefPolicy = 'standing' | DefCall
  const callPolicies: CallPolicy[] = ['standing', 'run', 'short', 'deep']
  const defPolicies: DefPolicy[] = ['standing', 'blitz', 'man', 'zone', 'stack']

  const margin = (call: CallPolicy, def: DefPolicy): number => {
    let total = 0
    let games = 0
    for (let i = 0; i < n; i++) {
      const opp = opponents[i % Math.max(1, opponents.length)]
      if (!opp) continue
      const s = createGame(world, career.teamId, opp.id, world.seed + i * 7919 + 101, ctx)
      for (let m = runToMoment(world, s); m; m = runToMoment(world, s)) {
        let choiceId = m.defaultId
        let source: 'user' | 'standing' = 'standing'
        if (m.kind === 'call' && call !== 'standing') {
          const pick = m.options.find((o) => classOf(o.id) === call)
          if (pick) { choiceId = pick.id; source = 'user' }
        } else if (m.kind === 'defCall' && def !== 'standing') {
          const pick = m.options.find((o) => o.id === def)
          if (pick) { choiceId = pick.id; source = 'user' }
        }
        answerMoment(s, choiceId, source)
      }
      const sim = finishGame(s)
      total += sim.homeScore - sim.awayScore
      games++
    }
    return +(total / Math.max(1, games)).toFixed(2)
  }

  const call: Record<string, number> = {}
  for (const p of callPolicies) call[p] = margin(p, 'standing')
  const def: Record<string, number> = {}
  for (const p of defPolicies) def[p] = margin('standing', p)
  return { games: n, opponents: opponents.map((t) => t.id), call, def, standingBaseline: call.standing }
}

/** Dev-only probe: timeouts spent and two-minute drives per game (L10 G7). */
export function clockProbe(n = 20) {
  const career = useGame.getState().career
  if (!career) return { error: 'no career' }
  const nfl = world.teams.filter((t) => t.tier === 'NFL')
  const ctx: GameCtx = { userTeamId: career.teamId, scope: 'hc', callSheet: career.callSheet ?? DEFAULT_CALL_SHEET }
  let userTo = 0
  let oppTo = 0
  let drives = 0
  let twoMinDecisions = 0
  let games = 0
  for (let i = 0; i < n; i++) {
    const opp = nfl.filter((t) => t.id !== career.teamId)[i % Math.max(1, nfl.length - 1)]
    if (!opp) continue
    const s = createGame(world, career.teamId, opp.id, world.seed + i * 7919 + 101, ctx)
    for (let m = runToMoment(world, s); m; m = runToMoment(world, s)) answerMoment(s, m.defaultId, 'standing')
    userTo += s.timeoutsUsed[career.teamId] ?? 0
    oppTo += s.timeoutsUsed[opp.id] ?? 0
    drives += s.twoMinDrives
    twoMinDecisions += s.decisions.filter((d) => d.kind === 'twoMinute').length
    games++
  }
  const per = (v: number) => +(v / Math.max(1, games)).toFixed(2)
  return {
    games,
    userTimeoutsPerGame: per(userTo),
    oppTimeoutsPerGame: per(oppTo),
    twoMinDrivesPerGame: per(drives),
    twoMinDecisionsPerGame: per(twoMinDecisions),
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

/**
 * Dev-only probe: exercise the L11 waiver wire for a full regular season on a
 * clone of the current world. Injuries are simulated with `healAfterWeek`; each
 * week AI clubs file claims and replace injured starters (which backfills the
 * wire when a signing pushes a roster past 53). Reports the season's volume.
 */
export function waiverProbe(weeks = 17) {
  const clone = structuredClone(world) as World
  clone.phase = 'regular'
  clone.week = 1
  clone.waivers = []
  // A fresh season: everyone 0-0, so priority is deterministic.
  for (const id of Object.keys(clone.standings)) clone.standings[id] = zeroRecord(id)
  const nfl = clone.teams.filter((t) => t.tier === 'NFL')
  let claims = 0
  let cleared = 0
  let injurySignings = 0
  let maxRoster = 0
  let minRoster = Infinity
  for (let w = 1; w <= weeks; w++) {
    clone.week = w
    aiWaiverClaims(clone)
    const res = processWaivers(clone)
    claims += res.claimed.length
    cleared += res.cleared.length
    // AI injury moves are the only free-agent consumers between waiver turns;
    // a signing removes exactly one free agent and releases a surplus onto the
    // wire when the roster is at 53.
    const freeBefore = clone.freeAgents.length
    aiInjuryMoves(clone)
    injurySignings += freeBefore - clone.freeAgents.length
    const sizes = nfl.map((t) => (clone.roster[t.id] ?? []).length)
    maxRoster = Math.max(maxRoster, ...sizes)
    minRoster = Math.min(minRoster, ...sizes)
    // Week-end recovery, which also seeds the next week's minor injuries.
    healAfterWeek(clone, w)
  }
  const open = clone.waivers?.length ?? 0
  return {
    weeks,
    releases: claims + cleared + open,
    claims,
    cleared,
    injurySignings,
    maxRoster,
    minRoster: Number.isFinite(minRoster) ? minRoster : 0,
  }
}

/** Games a player has appeared in this season (summed across any team entries). */
function gamesThisSeason(p: Player | undefined, season: number): number {
  if (!p?.stats?.length) return 0
  return p.stats.filter((s) => s.season === season && s.level === 'NFL').reduce((n, s) => n + (s.games ?? 0), 0)
}

/**
 * L12.6 C3 dev probe: exercise the in-season release → waivers → FA → new club
 * path on a throwaway clone of the live world. It releases a starter from an AI
 * club and from the user's club, then runs two weeks of the REAL weekly flow
 * (AI waiver claims, Tuesday resolution, AI injury signings, games) and reports
 * each player's path and the snaps (games) he actually played.
 */
export function faFlowProbe() {
  const clone = structuredClone(world) as World
  const career = useGame.getState().career
  const userTeamId = career?.teamId && clone.roster[career.teamId] ? career.teamId : 'BUF'
  clone.phase = 'regular'
  clone.week = 1
  clone.waivers = []
  for (const id of Object.keys(clone.standings)) clone.standings[id] = zeroRecord(id)
  // Re-open weeks 1–2 so the probe always has games to simulate/stat.
  for (const g of clone.schedule) {
    if (g.week > 2) continue
    g.played = false
    g.homeScore = null
    g.awayScore = null
    g.statsDone = false
  }
  const gamesBefore = new Map(clone.players.map((p) => [p.id, gamesThisSeason(p, clone.season)]))

  const aiTeamId = clone.teams.find((t) => t.tier === 'NFL' && t.id !== userTeamId)?.id ?? userTeamId
  // Prefer an offensive starter: the weekly allocator builds offensive box lines
  // from the depth chart, so the signed player's snaps are visible immediately.
  const OFF_SKILL: Position[] = ['QB', 'RB', 'WR', 'TE']
  const releaseStarter = (teamId: string): { p: Player; from: string } | null => {
    const roster = clone.roster[teamId] ?? []
    const skill = roster.filter((p) => OFF_SKILL.includes(p.pos))
    const p = [...(skill.length ? skill : roster)].sort((a, b) => b.ovr - a.ovr || (a.id < b.id ? -1 : 1))[0]
    if (!p) return null
    roster.splice(roster.indexOf(p), 1)
    const original = { ...p.contract }
    const dead = deadMoney(p.contract)
    clone.deadMoney[teamId] = (clone.deadMoney[teamId] ?? 0) + dead
    p.contract = { ...p.contract, years: 0, base: [0], proration: 0, guaranteed: 0, capHit: 0 }
    placeOnWaivers(clone, p, teamId, original, dead)
    return { p, from: teamId }
  }
  const aiRel = releaseStarter(aiTeamId)
  const userRel = releaseStarter(userTeamId)

  const describe = (rel: { p: Player; from: string } | null) => {
    if (!rel) return null
    const live = clone.players.find((x) => x.id === rel.p.id)
    return {
      name: live?.name ?? rel.p.name,
      pos: live?.pos ?? rel.p.pos,
      ovr: live?.ovr ?? rel.p.ovr,
      releasedFrom: rel.from,
      currentTeamId: live?.teamId ?? null,
      depthRank: live?.teamId ? depthAt(clone, live.teamId, live.pos).findIndex((x) => x.id === live.id) + 1 : 0,
      onWaivers: (clone.waivers ?? []).some((e) => e.playerId === rel.p.id),
      freeAgent: clone.freeAgents.some((x) => x.id === rel.p.id),
      gamesPlayed: gamesThisSeason(live, clone.season) - (gamesBefore.get(rel.p.id) ?? 0),
    }
  }

  const weeks: unknown[] = []
  for (let i = 0; i < 2; i++) {
    // Mirror advanceWeek's order exactly: AI claims → Tuesday resolution → AI
    // injury moves (the in-season free-agent consumer) → games.
    aiWaiverClaims(clone, userTeamId)
    const res = processWaivers(clone, userTeamId)
    aiInjuryMoves(clone, userTeamId)
    const week = clone.week
    simWeek(clone, week)
    clone.week += 1
    weeks.push({
      week,
      claimed: res.claimed.map((c) => c.playerId),
      cleared: res.cleared,
      ai: describe(aiRel),
      user: describe(userRel),
    })
  }
  return { userTeam: userTeamId, aiTeam: aiTeamId, ai: describe(aiRel), user: describe(userRel), weeks }
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
    setPieceDone: career?.setPieceDone,
    actions: career ? weeklyActions(career).map((a) => a.id) : [],
    passiveBank: career?.passiveBank ?? {},
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

/**
 * Dev-only probe (L12.7 D4): run whole seasons headlessly and report rookie OVR
 * by round, league starter-talent drift, and how often rookies reach their
 * ceiling — starters vs. bench. Offline-safe (own throwaway world).
 */
export function rookieProbe(seasons = 8) {
  return runRookieProbe({ seasons, seed: world.seed, data: getRealData() })
}

/** One caught failure from the career smoke probe (Z1). */
export interface SmokeError {
  season: number
  week: number
  action: string
  error: string
}

/** The career smoke probe's report (Z1). */
export interface SmokeReport {
  seasons: number
  path: 'personnel' | 'coach'
  finalLevel: number
  errors: SmokeError[]
  violations: string[]
  featuresExercised: Record<string, number>
}

/**
 * Dev-only career smoke probe (L9 Z1): start a fresh career and drive every
 * L5–L8 feature through the store for `seasons`, accepting the first job offer
 * each year so the career climbs the ladder. Every feature call is wrapped in
 * try/catch with the error recorded — nothing is swallowed. After each season a
 * batch of cross-system invariants is checked and any breach is appended to
 * `violations`. Returns the report for the orchestrator to inspect.
 *
 * This is a real career: it resets the live world to the seeded one it starts.
 */
export async function careerSmoke(
  seasons = 6,
  path: 'personnel' | 'coach' = 'personnel',
  seed = 4242,
): Promise<SmokeReport> {
  const get = () => useGame.getState()
  const errors: SmokeError[] = []
  const violations: string[] = []
  const featuresExercised: Record<string, number> = {}
  const mark = (action: string) => {
    featuresExercised[action] = (featuresExercised[action] ?? 0) + 1
  }
  const fail = (action: string, e: unknown) => {
    errors.push({
      season: world.season,
      week: world.week,
      action,
      error: e instanceof Error ? e.message : String(e),
    })
  }
  /** Call a feature: count it when it ran clean, record it when it threw. */
  const exercise = (action: string, fn: () => void) => {
    try {
      fn()
      mark(action)
    } catch (e) {
      fail(action, e)
    }
  }
  /** Call a store/engine step whose result we don't count as a feature. */
  const attempt = (action: string, fn: () => void) => {
    try {
      fn()
    } catch (e) {
      fail(action, e)
    }
  }
  const attemptAsync = async (action: string, fn: () => void | Promise<void>) => {
    try {
      await fn()
    } catch (e) {
      fail(action, e)
    }
  }

  // 1. Start the career on the requested rung (coach 5 / personnel 4).
  const startLevel = path === 'coach' ? 5 : 4
  get().startCareer({
    name: 'Smoke',
    path,
    archetype: path === 'coach' ? 'off' : 'scout',
    teamId: 'CLE',
    seed,
    startLevel,
  })

  /** Once a season: features that aren't tied to a specific week. */
  const exerciseOncePerSeason = () => {
    const career = get().career
    if (!career) return
    // G1: trust your evaluators' reports.
    const staff = world.staff[career.teamId] ?? []
    const evaluator = staff.find(isEvaluator) ?? staff[0]
    if (evaluator && canSetTrust(career)) {
      exercise('setScoutTrust', () => get().setScoutTrust(evaluator.id, 'lean'))
    }
    // G2: pound the table for the two best players in the class.
    const ranked = [...world.draft].sort((a, b) => b.grade - a.grade)
    const top2 = ranked.slice(0, 2)
    if (canConvict(career)) {
      for (const p of top2) exercise('toggleConviction', () => get().toggleConviction(p.id))
    }
    // K4: red-flag one of the league's top-64 prospects.
    if (canRedFlag(career)) {
      const flagged = ranked
        .slice(0, RED_FLAG_TOP_N)
        .find((p) => !top2.some((t) => t.id === p.id) && isRedFlaggable(world, p.id))
      if (flagged) exercise('toggleRedFlag', () => get().toggleRedFlag(flagged.id))
    }
    // G1: put three players who aren't yours on the shadow board.
    if (canShadow(career)) {
      const outside = world.players
        .filter((p) => p.teamId !== career.teamId && p.ovr >= 68)
        .sort((a, b) => b.ovr - a.ovr)
        .slice(0, 3)
      for (const p of outside) {
        exercise('toggleShadowBoard', () => get().toggleShadowBoard(p.id))
      }
    }
    // G3: focus the room and choose its practice plan.
    if (hasRoom(career)) {
      const focused = new Set(career.room?.focus ?? [])
      const picks = roomPlayers(world, career)
        .filter((p) => !focused.has(p.id))
        .slice(0, MAX_ROOM_FOCUS)
      for (const p of picks) exercise('toggleRoomFocus', () => get().toggleRoomFocus(p.id))
      exercise('setRoomPlan', () => get().setRoomPlan('concentrate'))
    }
    // G2: negotiate one extension at 100% of the agent's ask.
    if (capabilities(career).can.has('negotiate')) {
      const expiring = (world.roster[career.teamId] ?? []).filter((p) => p.contract.years <= 2)
      const p = expiring[0]
      if (p) {
        const offer: ExtensionOffer = { years: 3, aav: marketAsk(p, world.season), guarantee: 'mid' }
        exercise('offerExtension', () => get().offerExtension(p.id, offer))
      }
    }
    // Trade Center: shop one player around the league (pure engine search).
    const shop = [...(world.roster[career.teamId] ?? [])].sort((a, b) => b.ovr - a.ovr)[0]
    if (shop) exercise('findDeals', () => { findDeals(world, career.teamId, shop.id) })
  }

  /** Every week: the features a rung uses on a week-to-week rhythm. */
  const exerciseWeekly = () => {
    const career = get().career
    if (!career) return
    // L12.9 H1: hours are gone. Exercise the actions they moved to instead:
    // opponent film (Game Plan) and the Scouting character read.
    exercise('studyOpponent', () => get().studyOpponent())
    const target = world.draft.find((p) => p.character && (p.characterReads ?? []).length < CHARACTER_FACETS.length)
    if (target) exercise('investigateCharacter', () => get().investigateCharacter(target.id))
    // K1: rotate the weekly wrinkle so the film never settles.
    if (canWrinkle(career)) {
      for (const side of wrinkleSides(career)) {
        const list = side === 'off' ? OFF_WRINKLES : DEF_WRINKLES
        const id = list[world.week % list.length]?.id
        if (id) exercise('pickWrinkle', () => get().pickWrinkle(side, id))
      }
    }
    // L12 W1: run the weekly practice plan (cycles through Install/Sharpen/Rest/
    // Balanced so the Install payoff and the recovery paths all get exercised).
    if (canPractice(career)) {
      const plans: PracticePlan[] = ['install', 'sharpen', 'rest', 'balanced']
      exercise('pickPractice', () => get().pickPractice(plans[(world.week - 1) % plans.length]))
    }
    // L12 W2: promise two keys to the game.
    if (canPickKeys(career)) {
      for (const k of pickableKeys(career).slice(0, MAX_KEYS)) {
        exercise('toggleKey', () => get().toggleKey(k.id))
      }
    }
    // K3: pitch the first backup on your side of the ball.
    if (canPitch(career) && !career.weekFlags?.pitch) {
      for (const pos of pitchSide(career)) {
        const list = depthAt(world, career.teamId, pos)
        const backup = list[STARTERS[pos] ?? 1]
        if (backup) {
          exercise('pitchStarter', () => get().pitchStarter(pos, backup.id))
          break
        }
      }
    }
  }

  /** In the offseason: the features that only open between seasons. */
  const exerciseOffseason = () => {
    const career = get().career
    if (!career) return
    // K2: a full install for the coming season.
    if (canInstall(world, career)) {
      exercise('chooseInstall', () => get().chooseInstall('full'))
    }
    // G4: spend a combine hour on a prospect.
    if (combineOpen(world, career)) {
      const prospect = world.draft[0]
      if (prospect) exercise('combineAction', () => get().combineAction(prospect.id, 'interview'))
    }
    // G3: file the cap memo.
    if (canFileMemo(world, career)) {
      const priorities = (world.roster[career.teamId] ?? [])
        .filter((p) => p.contract.years <= 2)
        .slice(0, 3)
        .map((p) => p.id)
      exercise('fileCapMemo', () => get().fileCapMemo('comfortable', priorities, 'Smoke probe memo.'))
    }
  }

  /** Take the first job offer that appears so the career climbs. */
  const acceptFirstOffer = () => {
    for (const offer of [...get().offers]) {
      attempt('acceptOffer', () => get().acceptOffer(offer))
      if (get().offers.length === 0) break
    }
  }

  /** Post-season invariants across every system the probe touched. */
  const checkInvariants = (seasonNo: number) => {
    const career = get().career
    const where = `season ${seasonNo + 1}`
    if (!career) {
      violations.push(`${where}: no career after the season`)
      return
    }
    // Reputation stays a finite 0–100 in every dimension.
    for (const [k, v] of Object.entries(career.reputation)) {
      if (!Number.isFinite(v) || v < 0 || v > 100) {
        violations.push(`${where}: reputation.${k}=${v} outside 0–100`)
      }
    }
    // Every club carries a legal roster and fits under the cap.
    const cap = capForSeason(world.season)
    for (const [teamId, roster] of Object.entries(world.roster)) {
      if (roster.length < 45 || roster.length > 60) {
        violations.push(`${where}: ${teamId} roster has ${roster.length} players (need 45–60)`)
      }
      const used = roster.reduce((s, p) => s + p.contract.capHit, 0) + (world.deadMoney[teamId] ?? 0)
      if (used > cap * 1.05) {
        violations.push(
          `${where}: ${teamId} cap used $${(used / 1e6).toFixed(1)}M over 105% of $${(cap / 1e6).toFixed(1)}M`,
        )
      }
    }
    // Roster entries are the same objects as their world.players entry.
    const byId = new Map(world.players.map((p) => [p.id, p]))
    let unlinked = 0
    for (const roster of Object.values(world.roster)) {
      for (const p of roster) if (byId.get(p.id) !== p) unlinked++
    }
    if (unlinked) violations.push(`${where}: ${unlinked} roster entries are not the canonical player object`)
    // Draft ids are unique.
    const draftIds = new Set(world.draft.map((p) => p.id))
    if (draftIds.size !== world.draft.length) {
      violations.push(`${where}: world.draft has ${world.draft.length - draftIds.size} duplicate ids`)
    }
    // The boards keep their caps.
    const shadowLen = (career.shadowBoard ?? []).length
    if (shadowLen > MAX_SHADOW) violations.push(`${where}: shadowBoard has ${shadowLen} (max ${MAX_SHADOW})`)
    const convLen = career.conviction?.ids.length ?? 0
    if (convLen > MAX_CONVICTION) violations.push(`${where}: conviction has ${convLen} (max ${MAX_CONVICTION})`)
    const rfLen = career.redFlags?.ids.length ?? 0
    if (rfLen > MAX_RED_FLAGS) violations.push(`${where}: redFlags has ${rfLen} (max ${MAX_RED_FLAGS})`)
    // The applied wrinkle/install/practice extra stays inside its sim clamp.
    const wrinkle = wrinkleBonus(career, world.week)
    const install = installBonus(career, world)
    const practice = practiceEdge(career, world)
    for (const side of ['off', 'def'] as const) {
      const extra = clamp(wrinkle[side] + install[side] + practice[side], -0.6, 1.5)
      if (extra < -0.6 || extra > 1.5) {
        violations.push(`${where}: ${side} wrinkle/install/practice extra ${extra.toFixed(2)} outside [-0.6, 1.5]`)
      }
    }
  }

  for (let seasonNo = 0; seasonNo < seasons; seasonNo++) {
    exerciseOncePerSeason()
    let weeks = 0
    while (world.phase === 'regular' && weeks < 30) {
      weeks++
      exerciseWeekly()
      await attemptAsync('advanceWeek', () => get().advanceWeek())
      if (get().modal !== 'none') get().dismissModal()
    }
    if (world.phase === 'regular') {
      violations.push(`season ${seasonNo + 1}: regular season never ended after ${weeks} advances`)
      break
    }
    exerciseOffseason()
    acceptFirstOffer()
    attempt('finishDraft', () => get().finishDraft())
    await attemptAsync('advanceWeek', () => get().advanceWeek())
    checkInvariants(seasonNo)
  }

  return {
    seasons,
    path,
    finalLevel: get().career?.level ?? -1,
    errors,
    violations,
    featuresExercised,
  }
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
  // L11.5 Q11: the pool holds a 3-draft window; this reports the upcoming draft.
  const picks = (world.draftPicks ?? []).filter((p) => p.season === world.season + 1)
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
  const keys = ['points', 'plays', 'passAtt', 'passComp', 'passYds', 'passTD', 'ints', 'rushAtt', 'rushYds', 'rushTD', 'sacks', 'sacksTaken', 'firstDowns', 'thirdDownAtt', 'thirdDownConv', 'fgAtt', 'fgMade', 'td', 'top'] as const
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

/**
 * Dev-only probe (L12 S4): how a game's production is shared between players,
 * against NFL bands. AI-vs-AI games on the current world; prints ✅/❌ per row.
 */
export function statShape(games = 200) {
  const nfl = world.teams.filter((t) => t.tier === 'NFL').map((t) => t.id)
  const pos = new Map(world.players.map((p) => [p.id, p.pos]))
  const med = (a: number[]) => {
    const s = [...a].sort((x, y) => x - y)
    return s.length ? s[s.length >> 1] : 0
  }
  const share = (a: number[], f: (x: number) => boolean) => (a.length ? a.filter(f).length / a.length : 0)
  const topShare: number[] = []
  const topTargets: number[] = []
  const withCatch: number[] = []
  const rb1Share: number[] = []
  const rb2Share: number[] = []
  const qbShare: number[] = []
  const rb1Yds: number[] = []
  const rb1Car: number[] = []
  const tackles: number[] = []
  const topTackler: number[] = []
  const tgPos: Record<string, number> = { WR: 0, TE: 0, RB: 0 }
  const tkPos: Record<string, number> = { LB: 0, DL: 0, S: 0, CB: 0 }
  const skPos: Record<string, number> = { DL: 0, LB: 0, DB: 0 }
  const inPos: Record<string, number> = { CB: 0, S: 0, LB: 0, DL: 0 }
  const group = (p?: string) => (p === 'DE' || p === 'DT' ? 'DL' : p ?? '')
  setLivePlan(null)
  for (let g = 0; g < games; g++) {
    const home = nfl[g % nfl.length]
    const away = nfl[(g * 7 + 5) % nfl.length]
    if (home === away) continue
    const sim = simulatePlayByPlay(world, home, away, world.seed + 7000 + g)
    const box = boxScore(world, sim)
    for (const team of [home, away]) {
      const rows = box.filter((b) => b.teamId === team)
      const tg = rows.reduce((s, b) => s + (b.line.targets ?? 0), 0)
      const top = rows.reduce((m, b) => Math.max(m, b.line.targets ?? 0), 0)
      if (tg) {
        topShare.push(top / tg)
        topTargets.push(top)
      }
      withCatch.push(rows.filter((b) => (b.line.rec ?? 0) > 0).length)
      const rushes = rows.reduce((s, b) => s + (b.line.rushAtt ?? 0), 0)
      const rbs = rows.filter((b) => pos.get(b.playerId) === 'RB').sort((x, y) => (y.line.rushAtt ?? 0) - (x.line.rushAtt ?? 0))
      if (rushes) {
        rb1Share.push((rbs[0]?.line.rushAtt ?? 0) / rushes)
        rb2Share.push((rbs[1]?.line.rushAtt ?? 0) / rushes)
        qbShare.push(rows.filter((b) => pos.get(b.playerId) === 'QB').reduce((s, b) => s + (b.line.rushAtt ?? 0), 0) / rushes)
      }
      rb1Yds.push(rbs[0]?.line.rushYds ?? 0)
      rb1Car.push(rbs[0]?.line.rushAtt ?? 0)
      tackles.push(rows.reduce((s, b) => s + (b.line.tackles ?? 0), 0))
      topTackler.push(rows.reduce((m, b) => Math.max(m, b.line.tackles ?? 0), 0))
      for (const b of rows) {
        const p = pos.get(b.playerId)
        const gp = group(p)
        if (p && tgPos[p] !== undefined) tgPos[p] += b.line.targets ?? 0
        if (tkPos[gp] !== undefined) tkPos[gp] += b.line.tackles ?? 0
        const sk = gp === 'CB' || gp === 'S' ? 'DB' : gp
        if (skPos[sk] !== undefined) skPos[sk] += b.line.defSacks ?? 0
        if (inPos[gp] !== undefined) inPos[gp] += b.line.defInts ?? 0
      }
    }
  }
  const frac = (o: Record<string, number>) => {
    const t = Object.values(o).reduce((a, b) => a + b, 0) || 1
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +(v / t).toFixed(2)]))
  }
  const tg = frac(tgPos)
  const tk = frac(tkPos)
  const sk = frac(skPos)
  const it = frac(inPos)
  const within = (v: number, lo: number, hi: number) => (v >= lo && v <= hi ? '✅' : '❌')
  const rows: [string, number | string, string, string][] = [
    ['Top receiver share of targets (median)', +med(topShare).toFixed(2), '0.22–0.32', within(med(topShare), 0.22, 0.32)],
    ['Top receiver share (p90)', +[...topShare].sort((a, b) => a - b)[Math.floor(topShare.length * 0.9)].toFixed(2), '≤ 0.45', within([...topShare].sort((a, b) => a - b)[Math.floor(topShare.length * 0.9)], 0, 0.45)],
    ['15+ target games', +share(topTargets, (x) => x >= 15).toFixed(3), '≤ 0.05', within(share(topTargets, (x) => x >= 15), 0, 0.05)],
    ['Players with a catch (median)', med(withCatch), '≥ 5', within(med(withCatch), 5, 99)],
    ['Targets WR / TE / RB', `${tg.WR} / ${tg.TE} / ${tg.RB}`, '~0.62 / 0.20 / 0.18', within(tg.WR, 0.55, 0.7) === '✅' && within(tg.RB, 0.1, 0.22) === '✅' ? '✅' : '❌'],
    ['RB1 share of team rushes', +med(rb1Share).toFixed(2), '0.50–0.65', within(med(rb1Share), 0.5, 0.65)],
    ['RB2 share', +med(rb2Share).toFixed(2), '0.15–0.30', within(med(rb2Share), 0.15, 0.3)],
    ['QB share of rushes', +med(qbShare).toFixed(2), '0.08–0.18', within(med(qbShare), 0.08, 0.18)],
    ['RB1 rush yards (median)', med(rb1Yds), '50–75', within(med(rb1Yds), 50, 75)],
    ['RB1 100-yard games', +share(rb1Yds, (x) => x >= 100).toFixed(2), '0.12–0.25', within(share(rb1Yds, (x) => x >= 100), 0.12, 0.25)],
    ['RB1 30+ carry games', +share(rb1Car, (x) => x >= 30).toFixed(3), '≤ 0.02', within(share(rb1Car, (x) => x >= 30), 0, 0.02)],
    ['Tackles credited per team-game', med(tackles), '45–60', within(med(tackles), 45, 60)],
    ['Tackles LB / S / CB / DL', `${tk.LB} / ${tk.S} / ${tk.CB} / ${tk.DL}`, '0.35–0.45 / 0.18–0.26 / 0.15–0.22 / 0.15–0.22', within(tk.LB, 0.35, 0.45) === '✅' && within(tk.S, 0.18, 0.26) === '✅' ? '✅' : '❌'],
    ['Top tackler (median)', med(topTackler), '7–10', within(med(topTackler), 7, 10)],
    ['Sacks DL / LB / DB', `${sk.DL} / ${sk.LB} / ${sk.DB}`, '0.70–0.85 / 0.10–0.25 / ≤0.08', within(sk.DL, 0.7, 0.85)],
    ['INTs CB / S / LB', `${it.CB} / ${it.S} / ${it.LB}`, '0.40–0.55 / 0.30–0.45 / 0.08–0.18', within(it.CB, 0.4, 0.55) === '✅' && within(it.S, 0.3, 0.47) === '✅' ? '✅' : '❌'],
  ]
  return rows.map(([measure, value, band, ok]) => ({ measure, value, band, ok }))
}

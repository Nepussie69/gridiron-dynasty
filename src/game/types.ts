// Core domain types for Gridiron Dynasty.
// Phase 1 uses these shapes with generated mock data; Phase 2 swaps in real rosters.

export type LeagueTier = 'NFL' | 'FBS' | 'FCS'

export type Position =
  | 'QB'
  | 'RB'
  | 'WR'
  | 'TE'
  | 'OT'
  | 'OG'
  | 'C'
  | 'DE'
  | 'DT'
  | 'LB'
  | 'CB'
  | 'S'
  | 'K'
  | 'P'

export type Side = 'OFF' | 'DEF' | 'ST'

export interface Team {
  id: string
  abbr: string
  city: string
  name: string
  tier: LeagueTier
  conference: string
  division?: string
  primary: string
  secondary: string
  stadium: string
  prestige: number // 1-100, drives recruiting / job appeal
  tradition?: number
}

export interface Contract {
  years: number // remaining years (display)
  length: number // original length
  base: number[] // base salary per remaining year, in dollars
  signingBonus: number // total signing bonus, dollars
  proration: number // per-year bonus proration, dollars
  guaranteed: number // remaining guaranteed base salary, dollars
  capHit: number // current-year cap hit, dollars
  annual: number // average annual value, dollars
  signedThrough: number // last season year under contract
  voidYears: number // dummy years used to spread bonus
  rookie?: boolean
  fifthYearOption?: boolean
}

export type StatLevel = 'CFB' | 'NFL'

/**
 * How well a player knows the current playbook. Grows with games played and
 * training reps, but is CAPPED by collective continuity: how long his unit and
 * his coaches have stayed together. Constant roster and staff churn means nobody
 * ever builds chemistry, no matter how many snaps he personally takes.
 */
export interface PlaybookState {
  /** 0-100 effective mastery (reps/training/experience, capped by cohesion). */
  pct: number
  /** Raw experience accumulated in this system (0-100), before the cohesion cap. */
  experience: number
  /** Snaps/games of experience in this system. */
  reps: number
  /** Consecutive seasons this player has been with this team. */
  teamYears: number
  /** Consecutive seasons the coaching staff has held together. */
  staffYears: number
  /** Cohesion 0-1: how intact the unit + staff are around him. Caps mastery. */
  cohesion: number
  /** The scheme this mastery is for — a change resets progress. */
  scheme: string
  /** Team the player learned it with. */
  teamId: string
}

/** One season of production. Same shape for college and pro. */
export interface SeasonStats {
  season: number
  level: StatLevel
  teamId: string
  games: number
  scheme?: string // offensive scheme the player played in
  teamSchemeYears?: number // consecutive seasons in the same system
  // passing
  passAtt: number
  passComp: number
  passYds: number
  passTD: number
  ints: number
  sacks: number
  // rushing
  rushAtt: number
  rushYds: number
  rushTD: number
  // receiving
  targets: number
  rec: number
  recYds: number
  recTD: number
  // defense
  tackles: number
  defSacks: number
  defInts: number
  passDef: number
  // honors
  awards?: string[]
}

export function emptySeason(season: number, level: StatLevel, teamId: string): SeasonStats {
  return {
    season, level, teamId, games: 0,
    passAtt: 0, passComp: 0, passYds: 0, passTD: 0, ints: 0, sacks: 0,
    rushAtt: 0, rushYds: 0, rushTD: 0,
    targets: 0, rec: 0, recYds: 0, recTD: 0,
    tackles: 0, defSacks: 0, defInts: 0, passDef: 0,
  }
}

export interface GameStatLine {
  playerId: string
  passAtt?: number
  passComp?: number
  passYds?: number
  passTD?: number
  ints?: number
  rushAtt?: number
  rushYds?: number
  rushTD?: number
  targets?: number
  rec?: number
  recYds?: number
  recTD?: number
  tackles?: number
  defSacks?: number
  defInts?: number
}

export interface Player {
  id: string
  name: string
  pos: Position
  side: Side
  age: number
  height: string
  weight: number
  college: string
  ovr: number
  pot: number
  dev: 'X-Factor' | 'Superstar' | 'Star' | 'Starter' | 'Depth' | 'Backup'
  traits: string[]
  attrs?: Record<string, number> // exact ratings (Madden 26 / CFB 26) when available
  contract: Contract
  teamId: string | null
  morale: number // 1-100
  fatigue?: number
  injured?: { games: number; note: string }
  /** Hidden character. Drives development and bust risk, not current ratings. */
  character?: Character
  /** Facets of character uncovered through relationships. */
  characterReads?: CharacterRead[]
  /** True for procedurally generated players (guards real-player narratives). */
  generated?: boolean
  // college-only fields
  classYear?: 'FR' | 'SO' | 'JR' | 'SR' | 'RS-SR'
  stars?: 1 | 2 | 3 | 4 | 5
  // draft-only fields
  draftGrade?: number
  draftRound?: number
  draftPick?: number
  // career production: one entry per season, spanning college (CFB) and pro (NFL)
  stats?: SeasonStats[]
  /** Playbook mastery with the current team+scheme. See engine/playbook.ts */
  playbook?: PlaybookState
  /** How this player got to his current club (#5) — the fingerprints of a career. */
  origin?: PlayerOrigin
}

/**
 * Provenance for the "your fingerprints" layer (#5). Every arrival is stamped so
 * the game can say "drafted by you", "signed by you", "your scout found him",
 * "you let him walk". `by` is the career name when YOU did it, else the club/AI.
 */
export interface PlayerOrigin {
  kind: 'draft' | 'freeAgent' | 'trade' | 'udfa' | 'initial' | 'waiver'
  /** Season it happened. */
  season: number
  /** Round (draft) or note. */
  round?: number
  pick?: number
  /** The career gmName when the user's club made the move; null for AI/pre-existing. */
  by?: string | null
  /** Team the player came from, for trades/free agency. */
  fromTeamId?: string | null
}

/**
 * Character: the second rating film can't show. It drives whether a player
 * develops or busts — never his current on-field rating — so the sim's
 * calibration stays intact.
 */
export interface Character {
  workEthic: number // 0-100, higher = better
  coachability: number // 0-100
  maturity: number // 0-100
  offFieldRisk: number // 0-100, higher = worse
}

/** One facet of character uncovered by working the phones. */
export interface CharacterRead {
  facet: keyof Character
  /** The observed value (noisy vs. the truth). */
  value: number
  label: string
  confidence: number
}

export type StaffRole =
  | 'Head Coach'
  | 'Offensive Coordinator'
  | 'Defensive Coordinator'
  | 'Special Teams Coordinator'
  | 'QB Coach'
  | 'OL Coach'
  | 'DL Coach'
  | 'Secondary Coach'
  | 'Scout'
  | 'Director of Player Personnel'
  | 'General Manager'

export interface StaffMember {
  id: string
  name: string
  role: StaffRole
  age: number
  rating: number // 1-100
  specialty: string
  scheme: string
  annual: number
  contractYears: number
  teamId: string | null
  status: 'Hired' | 'Available' | 'Interviewing' | 'Target'
  notes?: string
  /** A scouting bias you can learn by reading their Ledger (engine/scoutBias.ts). */
  bias?: ScoutBias
  /** Past reports vs. outcomes, used to learn the bias over time. */
  reportLedger?: { prospectId: string; grade: number; truth: number }[]
}

/** An evaluator's blind spot: which trait they over/under-weight. */
export interface ScoutBias {
  axis: 'speed' | 'size' | 'production' | 'conference' | 'character'
  magnitude: number // signed points, e.g. +5 = grades that axis 5 high
}

export interface GameResult {
  week: number
  opponentId: string
  home: boolean
  teamScore: number
  oppScore: number
  result: 'W' | 'L' | 'T'
  played: boolean
}

export interface TeamRecord {
  teamId: string
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  streak: number // + = wins, - = losses
  confWins?: number
  confLosses?: number
  rank?: number
}

export interface NewsItem {
  id: string
  week: number
  season: number
  category:
    | 'Owner'
    | 'Roster'
    | 'Draft'
    | 'Trade'
    | 'Injury'
    | 'League'
    | 'Staff'
    | 'Career'
  headline: string
  body: string
  teamId?: string
  read: boolean
}

/**
 * A draft selection and who owns it. Picks are assets that can be traded, so
 * ownership is tracked separately from the original slot. `comp` marks an
 * awarded compensatory pick (placed at the end of its round).
 */
export interface DraftPick {
  id: string
  /** Draft year (the season the draft feeds). */
  season: number
  /** 1-7. */
  round: number
  /** The team whose slot this pick originally is. */
  originalTeam: string
  /** The team that currently owns/uses the pick. */
  ownerTeam: string
  /** Awarded as a compensatory pick. */
  comp?: boolean
}


export type Recommendation = 'Blue Chip' | 'Starter' | 'Depth' | 'Pass'

export interface DraftProspect {
  id: string
  name: string
  pos: Position
  college: string
  age: number
  ovr: number
  pot: number
  grade: number // public consensus grade
  trueGrade: number // hidden actual ceiling (revealed through scouting + outcomes)
  myGrade: number | null // your assigned evaluation (null = not scouted)
  confidence: number // 0-100, how well you know him
  recommendation: Recommendation | null
  projectedRound: number
  projectedPick: number
  scoutConfidence: number
  traits: string[]
  notes: string
  classYear: 'FR' | 'SO' | 'JR' | 'SR'
  production: number // 0-100 college production score
  committedTo?: string | null
  draftedBy?: string | null
  draftPick?: number | null
  /** Hidden character + uncovered facets. See engine/character.ts */
  character?: Character
  characterReads?: CharacterRead[]
  generated?: boolean
  /** Recruiting: relationship per coach key ('user' or assistant id), 0-100. */
  relations?: Record<string, number>
  /** Head Coach has approved an offer for this recruit. */
  offered?: boolean
  /** Who led the recruitment when he committed, and their name. */
  leadRecruiter?: string
  leadRecruiterName?: string
  /** Coordinator's recommended NIL split for this target (advisory). */
  nilRecommend?: number
}

export type CareerPath = 'coach' | 'personnel'
export interface CareerTier {
  level: number
  title: string
  tier: LeagueTier
  repRequired: number
  blurb: string
}

export interface JobOffer {
  id: string
  title: string
  teamId: string
  tier: LeagueTier
  level: number
  salary: number
  years: number
  interest: number // 0-100
  note: string
}

export type LedgerKind = 'grade' | 'recommendation' | 'pick' | 'advice'
export interface LedgerEntry {
  id: string
  season: number
  week: number
  kind: LedgerKind
  prospectId?: string
  playerId?: string
  name: string
  pos: string
  college: string
  /** The role you held when you made the call. */
  role?: string
  /** What you said at the time. */
  myGrade?: number
  recommendation?: Recommendation
  round?: number
  pick?: number
  note: string
  /** Filled in later, once we know how it turned out. */
  outcome?: string
  hit?: boolean
  /** Advice entries: did the NPC follow your call? */
  accepted?: boolean
  /** Hidden truth captured at call time, so we can grade it later. */
  truth?: number
}

export interface CareerState {
  gmName: string
  path: CareerPath
  archetype: string
  teamId: string
  season: number
  week: number
  reputation: import('./engine/career').Reputation
  skills: import('./engine/career').Skills
  level: number // index into the path's ladder
  salary: number
  jobSecurity: number // 0-100
  ownerExpectation: string
  tier: LeagueTier
  unitFocus?: import('./engine/career').UnitFocus
  recommendationsMade: number
  hits: number
  misses: number
  seasonRecs: number
  seasonHits: number
  /** Per-role mastery (0-100), keyed `${path}:${level}`. Excellence carries over. */
  roleMastery?: Record<string, number>
  /** Every call you've made: grades, recommendations, picks, advice. */
  ledger?: LedgerEntry[]
  /** Your ranked board for the upcoming draft (prospect ids, best first). */
  userBoard?: string[]
  /** The region you're assigned to scout (drives information scope). */
  scoutRegion?: string
  /** Weekly time budget (#5). Reset each week. */
  hoursLeft?: number
  /** Season in which the annual set piece was resolved (#6). */
  setPieceDone?: number
  /** Current stretch assignment / interim job (#8). */
  stretch?: StretchTask
  /** The week's one big decision and its resolution (#2). */
  dilemma?: WeeklyDilemma
  /** Season-by-season ghost-GM comparison (#8). */
  ghostHistory?: GhostSeason[]
  /** The question this season is trying to answer (#11). */
  seasonQuestion?: SeasonQuestion
  /** Key moments logged during the season, for the recap (#20). */
  seasonMoments?: SeasonMoment[]
  /** Self-chosen season ambitions (#11). Up to three per season. */
  ambitions?: Ambition[]
  /** Relationships that travel with you (#9). */
  contacts?: Contact[]
  /** Traits earned by deeds, not spent (#10). */
  earnedTraits?: EarnedTrait[]
  /** The boss who is shaping you (#11). */
  mentor?: { name: string; philosophy: string; teamId: string }
  /** People you developed who now run their own programs (#11). */
  tree?: { name: string; role: string; teamId: string; season: number }[]
  /** The Wilderness after a firing (#17). */
  wilderness?: { path: string; untilSeason: number; blurb: string } | null
  /** College NIL collective budget (#15). */
  nilBudget?: number
  /** Recruiting territory (region) assigned to this coaching role. */
  recruitTerritory?: string
  /** Position group this coach owns (position coaches). */
  recruitGroup?: Position[]
  /** Players whose recruitment you led (credited to your career). */
  recruited?: { name: string; pos: string; season: number; schoolId: string }[]
  /** Actions completed this week, for the weekly checklist. Reset on advance. */
  weekFlags?: Record<string, boolean>
  /** Your stated philosophy (#14). */
  philosophy?: string
  history: { season: number; team: string; role: string; record: string; outcome: string }[]
}

/** One choice on the week's big decision card (#2). */
export interface DilemmaChoice {
  id: string
  label: string
  blurb: string
  effect: import('./engine/dilemma').DilemmaEffect
  /** What actually happened, shown after the call. */
  outcome: string
}

/** The one big decision this week (#2). Everything else in the week is optional. */
export interface WeeklyDilemma {
  id: string
  season: number
  week: number
  kind: 'roster' | 'game' | 'culture' | 'draft' | 'pressure'
  title: string
  body: string
  prompt: string
  choices: DilemmaChoice[]
  /** The chosen id, or null if still open. */
  resolved: string | null
}

/** One season's ghost-GM comparison (#8). */
export interface GhostSeason {
  season: number
  actualWins: number
  ghostWins: number
  /** actual minus schedule-aware replacement expectation (+ = you beat the ghost). */
  delta: number
}

/** A recurring question the season is trying to answer (#11, used by the recap #20). */
export interface SeasonQuestion {
  season: number
  text: string
  /** How it resolved, filled at season review. */
  answer?: string
  good?: boolean
}

/** A self-chosen season goal (#11) — different from the objectives the job assigns. */
export type AmbitionKind =
  | 'makePlayoffs'
  | 'winDivision'
  | 'top10Unit'
  | 'draftStarter'
  | 'developYoung'
  | 'beatRival'
  | 'capClean'
  | 'scoutAccuracy'
  | 'winRecord'

export interface Ambition {
  id: string
  kind: AmbitionKind
  label: string
  blurb: string
  season: number
  /** Graded at season review. */
  done?: boolean
  /** Context the evaluator needs (rival id, side, target). */
  meta?: { teamId?: string; side?: 'off' | 'def'; target?: number }
  reward: Partial<import('./engine/career').Reputation>
}

/** One key moment in the season, for the broadcast recap (#20). */
export interface SeasonMoment {
  week: number
  text: string
  tone: 'win' | 'loss' | 'info'
}

/** A stretch assignment handed down by a boss (#8). */
export interface StretchTask {  id: string
  label: string
  blurb: string
  kind: 'stretch' | 'interim'
  accepted: boolean
  reward: number
  season: number
}

/** A relationship in your contact book (#9). */
export interface Contact {
  id: string
  name: string
  kind: 'High School Coach' | 'Trainer' | 'NFL Scout' | 'Agent' | 'Beat Writer'
  region: string
  relationship: number // 0-100
  /** Where they've climbed to by now. */
  role?: string
  teamId?: string
}

/** A trait earned through deeds (#10). */
export interface EarnedTrait {
  id: string
  name: string
  desc: string
  season: number
  role: string
}

/** An NPC climbing the same ladder alongside you (#12). */
export interface Rival {
  id: string
  name: string
  path: CareerPath
  level: number
  tier: LeagueTier
  teamId: string
  reputation: number
  startSeason: number
}


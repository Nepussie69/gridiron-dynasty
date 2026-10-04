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
    | 'Recruiting'
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
  history: { season: number; team: string; role: string; record: string; outcome: string }[]
}


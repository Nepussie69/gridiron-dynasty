import type {
  DraftPick, DraftProspect, JobOffer, NewsItem, Player, Position, Side, StaffMember, StaffRole,
  Team, TeamRecord, CareerPath, LeagueTier, Rival,
} from '../types'
import { CFB_TEAMS } from '../data/cfbTeams'
import { NFL_TEAMS } from '../data/nflTeams'
import { SALARY_CAP, capForSeason, makeRookieContract, makeVeteranContract, recomputeCapHit } from './cap'
import { FIRST, LAST, SPECIALTIES } from './names'
import { frontOfficeProfile, generateAnalyticsPool } from './hiring'
import { freshDraftWindow } from './picks'
import { makeCharacter } from './character'
import { makeScoutBias } from './scoutBias'
import { hash32, makeRng, rchance, rint, rpick, type Rng } from './rng'
import { rescaleOvr, rescaleQuantile, unscaleOvr } from './ovrScale'
import { STARS } from './starSeed'
import type { RealCfbPlayer, RealCfbTeam, RealData, RealNflPlayer } from '../data/realData'
import type { PlayerBoxScore } from './stats'
import type { WaiverEntry } from './waivers'

/** Team offensive/defensive totals summed from a game's player box-score lines. */
export interface GameBoxTotals {
  passYds: number
  rushYds: number
  turnovers: number
  sacks: number
}

export interface Game {
  id: string
  week: number
  homeId: string
  awayId: string
  homeScore: number | null
  awayScore: number | null
  played: boolean
  tier: 'NFL' | 'FBS' | 'FCS'
  postseason?: boolean
  statsDone?: boolean
  /** Season-scoped box score (only kept for the current season). */
  box?: {
    players: PlayerBoxScore[]
    team: Record<string, GameBoxTotals>
  }
  /** L10 G5: film grade of the user's decisions (kept with the box, one season). */
  film?: { grade: number; letter: string; lines: string[]; userCalls?: number }
  /** L12 W2: the graded keys to the game (kept with the box, one season). */
  keys?: import('./keys').KeyGrade[]
}

export interface World {
  seed: number
  season: number
  week: number
  /** Consecutive seasons each coordinator has held his job, keyed `${teamId}:${side}`. */
  staffTenure: Record<string, number>
  phase: 'regular' | 'offseason'
  /** L12.7: set once real-data rookies are on the NFL rookie scale (old saves are rescaled on load). */
  rookieScaleV2?: boolean
  /** L12.15 S3: set once every player has been moved onto the new (rare-stars) OVR scale. */
  ovrScaleV2?: boolean
  /** L12.10 B0: set once legacy utility/blocking backs have been moved to fullback. */
  fbMigrated?: boolean
  /** L12.13 M1: set once starting mastery has been seeded (old saves are reseeded on load). */
  masterySeedV2?: boolean
  teams: Team[]
  byId: Record<string, Team>
  players: Player[]
  roster: Record<string, Player[]>
  staff: Record<string, StaffMember[]>
  staffPool: StaffMember[]
  /** FUTURES 19: analysts the user can hire (never touched by the AI). Optional
   *  save field — a legacy save gets it on load. */
  analyticsPool?: StaffMember[]
  standings: Record<string, TeamRecord>
  news: NewsItem[]
  /** NFL draft pool — draft-eligible COLLEGE players. */
  draft: DraftProspect[]
  freeAgents: Player[]
  schedule: Game[]
  deadMoney: Record<string, number>
  draftOrder: string[]
  lastChampion: string | null
  awards: { mvp?: string; opoy?: string; dpoy?: string; roy?: string }
  jobMarket: JobOffer[]
  draftState: { round: number; pickIndex: number; complete: boolean; log: string[] }
  /** Tradeable draft selections, including traded and compensatory picks. */
  draftPicks: DraftPick[]
  /** Round number for each index of `draftOrder` (parallel arrays). */
  draftRounds: number[]
  /** The DraftPick.id for each slot of `draftOrder` (parallel array). */
  draftPickIds?: string[]
  /** Players on the practice squad, keyed by team (max 16). */
  practiceSquad: Record<string, Player[]>
  /** Players on injured reserve, keyed by team. */
  ir: Record<string, Player[]>
  /** Stored depth-chart order per team and position (ordered player ids). */
  depth?: Record<string, Partial<Record<Position, string[]>>>
  /** R6: optional kick/punt returner overrides per club (player ids); unset = auto. */
  returners?: Record<string, { kr?: string; pr?: string }>
  /** NPCs who began the climb the same year you did (#12). */
  rivals: import('../types').Rival[]
  /** The current era: market drift that changes over decades (#18). */
  era: { id: string; label: string; positionBias: Partial<Record<Position, number>>; capSpike: number }
  /** Free agents lost/gained last cycle, used to award compensatory picks. */
  compLedger: Record<string, { lost: number; gained: number }>
  /** L9 Z2: the last 40 front-office/staff awards, newest last. */
  staffAwards?: import('./staffAwards').StaffAward[]
  /** L9 Z2: wins by team at the end of last season, for year-over-year awards. */
  lastWins?: Record<string, number>
  /** L10 G8: the user's tendency book for this season (offense classes + defensive calls). */
  userBook?: { season: number; teamId: string; book: import('./decisions').TendencyBook }
  /** L11 W2: players placed on waivers this season, awaiting the Tuesday turn. */
  waivers?: WaiverEntry[]
  /** L12.6 C1: the step of the offseason calendar (resign → free agency → draft → camp). */
  offseasonStage?: import('./draft').OffseasonStage
  /** L12.6 C1: the offseason stages already run this cycle, so a fast path can't double-run them. */
  offseasonDone?: { fa?: boolean; draft?: boolean; trades?: boolean }
}

// Backwards-compatible alias used by screen/selector imports.
export type League = World

const POS_SIDE: Record<Position, Side> = {
  QB: 'OFF', RB: 'OFF', FB: 'OFF', WR: 'OFF', TE: 'OFF', OT: 'OFF', OG: 'OFF', C: 'OFF',
  DE: 'DEF', DT: 'DEF', LB: 'DEF', CB: 'DEF', S: 'DEF', K: 'ST', P: 'ST',
}

const NFL_SLOTS: Position[] = [
  'QB', 'QB', 'QB', 'RB', 'RB', 'RB', 'FB', 'WR', 'WR', 'WR', 'WR', 'WR', 'WR', 'WR',
  'TE', 'TE', 'TE', 'OT', 'OT', 'OT', 'OT', 'OG', 'OG', 'OG', 'OG', 'C', 'C',
  'DE', 'DE', 'DE', 'DE', 'DT', 'DT', 'DT', 'DT', 'LB', 'LB', 'LB', 'LB', 'LB', 'LB',
  'CB', 'CB', 'CB', 'CB', 'CB', 'CB', 'CB', 'S', 'S', 'S', 'S', 'K', 'P',
]

const TRAITS_BY_POS: Record<string, string[]> = {
  QB: ['Cannon Arm', 'Field General', 'Improviser', 'Pocket Passer', 'Dual Threat'],
  RB: ['Elusive', 'Power Back', 'Receiving Back', 'Home Run Hitter'],
  FB: ['Blocking Back', 'Short-Yardage', 'Utility'],
  WR: ['Deep Threat', 'Route Technician', 'Contested Catch', 'YAC Monster'],
  TE: ['Red Zone Threat', 'Blocking TE', 'Seam Threat'],
  OT: ['Blind Side', 'Mauler', 'Zone Specialist'],
  OG: ['Road Grader', 'Anchor', 'Puller'],
  C: ['Line Caller', 'Anchor'],
  DE: ['Speed Rusher', 'Power Rusher', 'Edge Setter'],
  DT: ['Run Stuffer', 'Penetrator', 'Two-Gapper'],
  LB: ['Sideline-to-Sideline', 'Blitzer', 'Coverage LB', 'Thumper'],
  CB: ['Shutdown', 'Ball Hawk', 'Slot Corner', 'Press Man'],
  S: ['Center Fielder', 'Box Safety', 'Hybrid'],
  K: ['Clutch', 'Big Leg'],
  P: ['Coffin Corner', 'Hang Time'],
}

const PHYS: Record<string, { ht: [number, number]; wt: [number, number] }> = {
  QB: { ht: [74, 78], wt: [210, 240] }, RB: { ht: [68, 73], wt: [195, 230] },
  FB: { ht: [70, 75], wt: [235, 265] },
  WR: { ht: [70, 76], wt: [180, 215] }, TE: { ht: [75, 79], wt: [240, 265] },
  OT: { ht: [76, 79], wt: [300, 340] }, OG: { ht: [75, 78], wt: [300, 340] },
  C: { ht: [74, 77], wt: [295, 320] }, DE: { ht: [74, 79], wt: [250, 285] },
  DT: { ht: [74, 78], wt: [295, 340] }, LB: { ht: [72, 77], wt: [225, 255] },
  CB: { ht: [69, 74], wt: [180, 205] }, S: { ht: [70, 75], wt: [195, 220] },
  K: { ht: [70, 74], wt: [180, 210] }, P: { ht: [72, 76], wt: [190, 220] },
}

function heightFor(rng: Rng, pos: Position) {
  const [lo, hi] = PHYS[pos]?.ht ?? [72, 76]
  const inches = rint(rng, lo, hi)
  return `${Math.floor(inches / 12)}'${inches % 12}"`
}
function weightFor(rng: Rng, pos: Position) {
  const [lo, hi] = PHYS[pos]?.wt ?? [200, 240]
  return rint(rng, lo, hi)
}

function devFor(ovr: number, pot: number): Player['dev'] {
  const rawOvr = unscaleOvr(ovr)
  const rawPot = unscaleOvr(pot)
  if (rawOvr >= 95) return 'X-Factor'
  if (rawOvr >= 89) return 'Superstar'
  if (rawOvr >= 83) return 'Star'
  if (rawOvr >= 76 || rawPot - rawOvr >= 8) return 'Starter'
  if (rawOvr >= 68) return 'Depth'
  return 'Backup'
}

function traitsFor(rng: Rng, pos: Position, ovr: number) {
  const pool = TRAITS_BY_POS[pos] ?? []
  if (!pool.length) return []
  const rawOvr = unscaleOvr(ovr)
  const n = rawOvr >= 90 ? 2 : rawOvr >= 80 ? 1 : rng() > 0.5 ? 1 : 0
  const out = new Set<string>()
  while (out.size < n && out.size < pool.length) out.add(rpick(rng, pool))
  return [...out]
}

let PID = 0
const nextPid = () => `p${PID++}`

function makePlayer(
  rng: Rng, teamId: string | null, pos: Position, rawOvr: number, season: number, name?: string,
): Player {
  // L12.15 S1: generated players share the same (new) scale as real-data ones.
  const ovr = rescaleOvr(rawOvr)
  const age = rint(rng, 22, 34)
  // Ceiling headroom is a *raw-scale* number of points, then remapped — so a
  // generated player's growth room matches the old game, not new-scale points.
  const rawPot = Math.min(99, rawOvr + (age < 26 ? rint(rng, 0, 9) : rint(rng, 0, 2)))
  const pot = Math.max(ovr, rescaleOvr(rawPot))
  const rookie = age <= 24 && rchance(rng, 0.6)
  const contract = rookie
    ? makeRookieContract(rint(rng, 1, 224), season)
    : makeVeteranContract(rng, ovr, pos, age, season)
  return {
    id: nextPid(),
    name: name ?? `${rpick(rng, FIRST)} ${rpick(rng, LAST)}`,
    pos,
    side: POS_SIDE[pos],
    age,
    height: heightFor(rng, pos),
    weight: weightFor(rng, pos),
    college: rpick(rng, CFB_TEAMS).name,
    ovr,
    pot,
    dev: devFor(ovr, pot),
    traits: traitsFor(rng, pos, ovr),
    contract,
    teamId,
    morale: rint(rng, 55, 95),
    injured: rchance(rng, 0.07)
      ? { games: rint(rng, 1, 4), note: rpick(rng, ['Hamstring', 'Ankle', 'Concussion', 'Knee', 'Shoulder']) }
      : undefined,
  }
}

function ovrFor(rng: Rng, prestige: number, pos: Position) {
  const center = 62 + (prestige - 55) * 0.42
  const posPremium = pos === 'QB' ? 2 : 0
  return Math.max(50, Math.min(95, Math.round(center + posPremium + (rng() - 0.5) * 18)))
}

/**
 * Q1: a club's biggest deals (its top QB and top-8 AAVs) are "premium" and keep
 * their market value when the cap forces a haircut; the compression is pushed
 * onto the middle of the roster and backups. A single flat factor used to drag
 * the elite market (top-5 QB ~$62M) down to ~$44M signed.
 */
const PREMIUM_DEALS = 8
/** Premium deals keep this share of market when a club has to fit the cap. */
const PREMIUM_KEEP = 0.93
/** Never compress a contract below this share of market. */
const MIN_FACTOR = 0.2
/**
 * Hard roster-spending ceiling as a share of the cap. Leaves room for a club's
 * dead money so the flat starting dead-money roll never pushes it over the cap.
 */
const FIT_CEILING = 0.9

/**
 * Scale a team's contracts so total cap usage lands near a target — while its
 * premium deals (top QB + biggest AAVs) stay near market and the mid/low tier
 * and backups take the haircut. After generation the league's top-5 signed AAV
 * at each position sits in the real 2025 bands instead of a uniform ~0.70 cut.
 */
export function fitToCap(roster: Player[], target: number) {
  const used = roster.reduce((s, p) => s + p.contract.capHit, 0)
  if (used <= 0) return
  const uniform = target / used
  if (uniform > 0.999 && uniform < 1.001) return

  // Rank by market AAV: the club's biggest deals (and its starting QB) lead.
  const byAnnual = [...roster].sort((a, b) => b.contract.annual - a.contract.annual)
  const premium = new Set(byAnnual.slice(0, PREMIUM_DEALS).map((p) => p.id))
  const qb = byAnnual.find((p) => p.pos === 'QB')
  if (qb) premium.add(qb.id)

  const premiumHit = roster.reduce((s, p) => s + (premium.has(p.id) ? p.contract.capHit : 0), 0)
  const restHit = used - premiumHit

  let fPremium: number
  let fRest: number
  if (uniform >= 1) {
    // Under the target: share the (small) increase evenly rather than distort.
    fPremium = fRest = uniform
  } else {
    // Over the target: the premium tier keeps market (mild PREMIUM_KEEP trim so
    // the league top-5 lands in band); the rest absorbs the difference.
    fPremium = Math.max(uniform, PREMIUM_KEEP)
    fRest = restHit > 0 ? (target - premiumHit * fPremium) / restHit : fPremium
    if (fRest < MIN_FACTOR) {
      // Backups cannot absorb enough on their own — pull the premium tier down.
      fRest = MIN_FACTOR
      fPremium = premiumHit > 0 ? (target - restHit * MIN_FACTOR) / premiumHit : fPremium
    }
  }
  // The 900K base floor means the low tier can bottom out before the arithmetic
  // target is reached. That is fine (moves us toward a top-heavy, real-NFL
  // shape), but a club may not breach the hard ceiling, which leaves room for
  // its dead money under the cap. When it would, pull the premium tier down
  // until it fits: `hit` is the real cap-hit sum under the floor.
  const hit = (fp: number, fr: number) =>
    roster.reduce((s, p) => {
      const f = premium.has(p.id) ? fp : fr
      return s + Math.max(900_000, Math.round((p.contract.base[0] ?? 0) * f)) + Math.max(0, Math.round(p.contract.proration * f))
    }, 0)
  const ceiling = Math.round(SALARY_CAP * FIT_CEILING)
  if (uniform < 1 && fPremium > 0 && hit(fPremium, fRest) > ceiling) {
    let lo = 0
    let hi = fPremium
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      if (hit(mid, fRest) > ceiling) hi = mid
      else lo = mid
    }
    fPremium = lo
  }
  // Scale down only when needed; never inflate past market on a haircut pass.
  fRest = Math.min(fRest, 1)
  fPremium = Math.min(fPremium, 1)

  for (const p of roster) {
    const c = p.contract
    const factor = premium.has(p.id) ? fPremium : fRest
    const base = c.base.map((b) => Math.max(900_000, Math.round(b * factor)))
    const signingBonus = Math.round(c.signingBonus * factor)
    const proration = Math.max(0, Math.round(c.proration * factor))
    p.contract = recomputeCapHit({
      ...c,
      base,
      signingBonus,
      proration,
      guaranteed: Math.min(Math.round(c.guaranteed * factor), base.reduce((a, b) => a + b, 0)),
      annual: Math.round(c.annual * factor),
    })
  }
}

function generateNFLRoster(rng: Rng, team: Team, season: number): Player[] {
  const stars = STARS[team.id] ?? []
  const slots = [...NFL_SLOTS]
  const players: Player[] = []
  for (const [name, pos, ovr] of stars) {
    const idx = slots.indexOf(pos)
    if (idx >= 0) {
      slots.splice(idx, 1)
      players.push(makePlayer(rng, team.id, pos, ovr, season, name))
    }
  }
  for (const pos of slots) players.push(makePlayer(rng, team.id, pos, ovrFor(rng, team.prestige, pos), season))
  return players
}

// ── Staff ────────────────────────────────────────────────────────────────────
const NFL_STAFF_ROLES: StaffRole[] = [
  'Head Coach', 'Offensive Coordinator', 'Defensive Coordinator', 'Special Teams Coordinator',
  'QB Coach', 'OL Coach', 'DL Coach', 'Secondary Coach', 'Scout', 'Director of Player Personnel',
]
const SCHEMES_OFF = ['Air Raid', 'Pro Style', 'Spread', 'West Coast', 'RPO Heavy']
const SCHEMES_DEF = ['4-3 Base', '3-4 Base', '4-2-5 Nickel', 'Multiple', 'Blitz Heavy']

function makeStaff(rng: Rng, teamId: string, role: StaffRole, rating: number, season: number): StaffMember {
  const def = role.includes('Defensive') || role === 'DL Coach' || role === 'Secondary Coach'
  const id = `s_${teamId}_${role.replace(/\s/g, '')}`
  return {
    id,
    name: `${rpick(rng, FIRST)} ${rpick(rng, LAST)}`,
    role,
    age: rint(rng, 34, 63),
    rating,
    specialty: rpick(rng, SPECIALTIES),
    scheme: def ? rpick(rng, SCHEMES_DEF) : rpick(rng, SCHEMES_OFF),
    annual: Math.round((rating / 100) * (role === 'Head Coach' ? 14 : role.includes('Coordinator') ? 4.5 : 2) * 1_000_000),
    contractYears: rint(rng, 1, 4),
    teamId,
    status: 'Hired',
    notes: `Signed through ${season + rint(rng, 1, 3)}`,
    bias: makeScoutBias(`${teamId}|${role}|${rating}`),
    // Q8: front-office roles get a deterministic focus + front-office specialty.
    ...frontOfficeProfile(role, id),
  }
}

/** NPC rivals who started the climb the same year you did (#12). */
function generateRivals(rng: Rng, season: number): Rival[] {
  const paths: CareerPath[] = ['personnel', 'coach', 'personnel', 'coach', 'personnel', 'coach']
  return paths.map((path, i) => ({
    id: `rival_${season}_${i}`,
    name: `${rpick(rng, FIRST)} ${rpick(rng, LAST)}`,
    path,
    level: path === 'coach' ? 5 : 4, // first NFL rung of each ladder
    tier: 'NFL' as LeagueTier,
    teamId: rpick(rng, NFL_TEAMS).id,
    reputation: 30 + rint(rng, 0, 12),
    startSeason: season,
  }))
}

/** The current era: a market drift you can exploit (#18). */
export const ERAS: World['era'][] = [
  { id: 'modern', label: 'Modern Spread Era', positionBias: { QB: 1.08, WR: 1.12, TE: 1.05, RB: 0.94, LB: 0.97 }, capSpike: 1 },
  { id: 'trenches', label: 'Trenches Era', positionBias: { OT: 1.14, OG: 1.1, DE: 1.12, DT: 1.12, WR: 0.95 }, capSpike: 1 },
  { id: 'track', label: 'Track Meet Era', positionBias: { WR: 1.16, CB: 1.12, S: 1.08, RB: 0.9 }, capSpike: 1.05 },
  { id: 'bully', label: 'Bully-Ball Era', positionBias: { RB: 1.2, TE: 1.1, LB: 1.1, C: 1.06, WR: 0.94 }, capSpike: 1 },
]
function makeEra(rng: Rng): World['era'] {
  return rpick(rng, ERAS)
}

function generateStaffPool(rng: Rng, count: number): StaffMember[] {
  const roles: StaffRole[] = [
    'Head Coach', 'Offensive Coordinator', 'Defensive Coordinator', 'Special Teams Coordinator',
    'QB Coach', 'OL Coach', 'DL Coach', 'Secondary Coach', 'Scout', 'Director of Player Personnel',
  ]
  return Array.from({ length: count }, (_, i) => {
    const role = rpick(rng, roles)
    const m = makeStaff(rng, '', role, rint(rng, 52, 92), 2026)
    const id = `av${i}`
    return { ...m, id, ...frontOfficeProfile(role, id), status: 'Available' as const }
  })
}

// ── Prospects ────────────────────────────────────────────────────────────────
const PROSPECT_POS: Position[] = [
  'QB', 'QB', 'QB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'WR', 'WR', 'WR',
  'TE', 'TE', 'OT', 'OT', 'OT', 'OT', 'OG', 'OG', 'OG', 'C', 'C',
  'DE', 'DE', 'DE', 'DE', 'DT', 'DT', 'DT', 'LB', 'LB', 'LB', 'LB', 'LB', 'LB',
  'CB', 'CB', 'CB', 'CB', 'CB', 'S', 'S', 'S', 'S', 'K', 'P',
] as Position[]

const POS_NOTES = [
  'Elite first-step quickness; needs functional strength.',
  'Team captain, high football IQ. Day-one starter tools.',
  'Raw but rare athletic traits. High ceiling, scheme-dependent.',
  'Most pro-ready technician in the class.',
  'Medical flag — played through a shoulder issue.',
  'Explosive in space; will test off the charts.',
  'Length and bend off the edge; pads need to fill out.',
  'Instinctive in zone; can be exposed in man.',
  'Elite ball skills; tracks the deep ball naturally.',
  'Plays with a nasty streak; penalty-prone.',
]

/**
 * L12.15 S4: the new-scale ceiling target for a generated prospect, by his
 * hidden true-grade quantile. The body of the class is a deliberate 60–79
 * depth layer (none of it sub-60), and the top few percent are the scarce
 * 80+ ceilings that `generatedCeiling` then sharpens by class standing.
 */
function prospectNewPot(trueGrade: number): number {
  const u = Math.min(1, Math.max(0, (trueGrade - 58) / 34))
  if (u < 0.36) return 60 + (u / 0.36) * 9
  if (u < 0.96) return 70 + ((u - 0.36) / 0.6) * 9
  return 80 + ((u - 0.96) / 0.04) * 4
}

export function generateProspectClass(rng: Rng, season: number, count = 170): DraftProspect[] {
  return Array.from({ length: count }, (_, i) => {
    const pos = rpick(rng, PROSPECT_POS)
    // Public consensus grade with noise vs. hidden true grade.
    const trueGrade = Math.max(52, Math.min(99, Math.round(70 + (rng() - 0.35) * 34)))
    const noise = Math.round((rng() - 0.5) * 18)
    const grade = Math.max(45, Math.min(99, trueGrade + noise))
    const rank = i + 1
    const id = `d${season}_${i}`
    return {
      id,
      name: `${rpick(rng, FIRST)} ${rpick(rng, LAST)}`,
      pos,
      college: rpick(rng, CFB_TEAMS).name,
      age: rint(rng, 20, 23),
      ovr: Math.round(48 + grade * 0.24),
      // L12.15 S4: the ceiling is drawn on the *new* scale (a deliberate 60–79
      // depth layer with a thin 80–84 tail), then inverted through the same map
      // so `rookieRatings`' `rescaleOvr` lands it back where intended. The
      // handful of prospects who can grow into the league's top bands are
      // assigned a new-scale ceiling by *class standing* in `rookieRatings`.
      pot: Math.round(unscaleOvr(prospectNewPot(trueGrade))),
      grade,
      trueGrade,
      myGrade: null,
      confidence: rint(rng, 5, 25),
      recommendation: null,
      projectedRound: Math.max(1, Math.ceil(rank / 32)),
      projectedPick: ((rank - 1) % 32) + 1,
      scoutConfidence: rint(rng, 20, 60),
      traits: traitsFor(rng, pos, trueGrade),
      notes: rpick(rng, POS_NOTES),
      classYear: (['JR', 'SR', 'SR', 'SO'] as const)[rint(rng, 0, 3)],
      production: rint(rng, 40, 99),
      character: makeCharacter(id),
      generated: true,
      committedTo: null,
      draftedBy: null,
      draftPick: null,
    }
  })
}

// ── Schedule ─────────────────────────────────────────────────────────────────
function shuffle<T>(rng: Rng, arr: T[]) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function buildSchedule(rng: Rng, teams: Team[], weeks: number, startWeek: number, withBye: boolean): Game[] {
  const games: Game[] = []
  const ids = shuffle(rng, teams.map((t) => t.id))
  const byeWeek: Record<string, number> = {}
  if (withBye) for (const id of ids) byeWeek[id] = rint(rng, startWeek, startWeek + weeks - 1)
  for (let w = startWeek; w < startWeek + weeks; w++) {
    const active = shuffle(
      rng,
      teams.filter((t) => !withBye || byeWeek[t.id] !== w).map((t) => t.id),
    )
    for (let i = 0; i + 1 < active.length; i += 2) {
      games.push({
        id: `g_${w}_${active[i]}_${active[i + 1]}`,
        week: w,
        homeId: active[i],
        awayId: active[i + 1],
        homeScore: null,
        awayScore: null,
        played: false,
        tier: teams[0].tier,
      })
    }
  }
  return games
}

function buildNews(teamId: string, teamName: string, _teamTier: string): NewsItem[] {
  const raw: [NewsItem['category'], string, string][] = [
    ['Owner', `${teamName} leadership sets expectations`, `The owner wants measurable progress this season. Performance will be reviewed at year end.`],
    ['Draft', `Scouting department finalizing the board`, `Area scouts are filing final grades. The war room convenes to stack the board and hunt for trade-back scenarios.`],
    ['League', `League confirms a flat salary cap`, `The cap is fixed for the foreseeable future, so every extension is a direct trade against the rest of the roster.`],
    ['Injury', `Starting defender day-to-day`, `A soft-tissue strain will be monitored through the week. No IR decision yet.`],
    ['Staff', `Coordinator interviews on the horizon`, `League sources expect a busy hiring cycle this winter.`],
    ['League', `Combine invites go out to the draft class`, `The top prospects in the class will work out for every club in Indianapolis.`],
  ]
  return raw.map(([category, headline, body], i) => ({
    id: `n${i}`, week: 1, season: 2026, category, headline, body, teamId, read: i > 1,
  }))
}

/**
 * L11.5 Q14: the opening inbox is written before the GM picks a club, so it uses
 * Buffalo. Once the career exists, re-point every seeded club-specific item
 * (ids n0–n5) at the user's actual club.
 */
export function retargetSeedNews(world: World, teamId: string): void {
  const team = world.byId[teamId]
  if (!team) return
  const name = team.tier === 'NFL' ? `${team.city} ${team.name}` : team.name
  for (const n of world.news) {
    if (!/^n[0-5]$/.test(n.id)) continue
    n.teamId = teamId
    n.headline = n.headline.replace(
      /^Buffalo Bills leadership sets expectations$/,
      `${name} leadership sets expectations`,
    )
  }
}

// ── Real-data mapping (exact Madden 26 / CFB 26 ratings) ──────────────────────
const NFL_ALIASES: Record<string, string> = { 'NY Giants': 'NYG', 'NY Jets': 'NYJ' }
function nflTeamIdByName(name: string): string | undefined {
  if (NFL_ALIASES[name]) return NFL_ALIASES[name]
  return NFL_TEAMS.find((t) => `${t.city} ${t.name}` === name)?.id
}
const CFB_ALIASES: Record<string, string> = {
  'Appalachian State': 'App State',
  'Miami (FL)': 'Miami',
  'South Florida': 'USF',
}
function cfbTeamIdBySchool(school: string): string | undefined {
  const s = school.replace(/&amp;/g, '&').trim()
  const norm = CFB_ALIASES[s] ?? s
  return CFB_TEAMS.find((t) => t.name === norm)?.id
}

function realNflPlayer(rng: Rng, teamId: string, p: RealNflPlayer, season: number, newOvr = rescaleOvr(p.ovr)): Player {
  // L12.10 B0: Madden lists fullbacks as RBs; utility/blocking backs become FBs.
  const pos: Position = p.pos === 'RB' && /Utility|Blocking/i.test(p.archetype) ? 'FB' : p.pos
  const rookie = p.age <= 24 && rchance(rng, 0.5)
  const contract = rookie
    ? makeRookieContract(rint(rng, 1, 224), season)
    : makeVeteranContract(rng, newOvr, pos, p.age, season)
  // L12.15 S1: the ceiling is remapped too (never below the new overall).
  const pot = Math.max(newOvr, rescaleOvr(Math.min(99, p.ovr + (p.age <= 25 ? rint(rng, 0, 8) : rint(rng, 0, 2)))))
  return {
    id: nextPid(),
    name: p.name,
    pos,
    side: POS_SIDE[pos],
    age: p.age + 1, // Madden 26 ages are for the 2025 season; this world starts in 2026
    height: p.height,
    weight: p.weight,
    college: p.college || rpick(rng, CFB_TEAMS).name,
    ovr: newOvr,
    pot,
    dev: devFor(newOvr, pot),
    traits: p.archetype ? [p.archetype] : traitsFor(rng, p.pos, newOvr),
    attrs: p.attrs,
    contract,
    teamId,
    morale: rint(rng, 55, 95),
    injured: rchance(rng, 0.07)
      ? { games: rint(rng, 1, 4), note: rpick(rng, ['Hamstring', 'Ankle', 'Concussion', 'Knee', 'Shoulder']) }
      : undefined,
  }
}

/**
 * Cut an NFL roster down to 53 by moving its lowest-rated surplus players to free
 * agency — a realistic roster cutdown that keeps every player a real, exact-rated one.
 */
function cutTo53(players: Player[], freeAgents: Player[], rawOvr?: Map<Player, number>) {
  if (players.length <= 53) return
  const FLOOR: Record<string, number> = {
    QB: 2, RB: 2, FB: 1, WR: 4, TE: 2, OT: 3, OG: 3, C: 1, DE: 3, DT: 3, LB: 4, CB: 4, S: 3, K: 1, P: 1,
  }
  const counts: Record<string, number> = {}
  for (const p of players) counts[p.pos] = (counts[p.pos] ?? 0) + 1
  // L12.15 S1: order the cut by the pre-remap OVR when we have it. The compressed
  // scale rounds adjacent ranks together, and a remap must not change who a club
  // keeps — so the tie-break stays the original OVR order (ties keep data order).
  const key = (p: Player) => rawOvr?.get(p) ?? unscaleOvr(p.ovr)
  for (const p of [...players].sort((a, b) => key(a) - key(b))) {
    if (players.length <= 53) break
    if ((counts[p.pos] ?? 0) <= (FLOOR[p.pos] ?? 2)) continue
    const idx = players.indexOf(p)
    if (idx < 0) continue
    players.splice(idx, 1)
    counts[p.pos] -= 1
    p.teamId = null
    freeAgents.push(p)
  }
}

/** Build the draft/scouting class from real CFB final-year players. */
function realProspectClass(rng: Rng, cfbTeams: RealCfbTeam[], season: number, count = 220): DraftProspect[] {
  const all: { p: RealCfbPlayer; school: string }[] = []
  for (const t of cfbTeams) {
    const teamId = cfbTeamIdBySchool(t.school)
    const schoolName = teamId ?? t.school
    for (const p of t.players) {
      if (p.cls !== 'JR' && p.cls !== 'SR') continue
      all.push({ p, school: schoolName })
    }
  }
  all.sort((a, b) => b.p.ovr - a.p.ovr)
  return all.slice(0, count).map(({ p, school }, i) => {
    const trueGrade = p.ovr
    const noise = Math.round((rng() - 0.5) * 10)
    const grade = Math.max(45, Math.min(99, trueGrade + noise))
    const rank = i + 1
    const id = `d${season}_${i}`
    return {
      id,
      name: p.name,
      pos: p.pos,
      college: school,
      age: 20 + rint(rng, 0, 3),
      ovr: p.ovr,
      pot: Math.min(99, p.ovr + rint(rng, 0, 9)),
      grade,
      trueGrade,
      myGrade: null,
      confidence: rint(rng, 5, 25),
      recommendation: null,
      projectedRound: Math.max(1, Math.ceil(rank / 32)),
      projectedPick: ((rank - 1) % 32) + 1,
      scoutConfidence: rint(rng, 20, 60),
      traits: traitsFor(rng, p.pos, trueGrade),
      notes: rpick(rng, POS_NOTES),
      classYear: p.cls,
      production: Math.max(40, Math.min(99, trueGrade + rint(rng, -8, 6))),
      character: makeCharacter(id),
      generated: false,
      committedTo: null,
      draftedBy: null,
      draftPick: null,
    }
  })
}

export function buildWorld(seed = 20261004, data?: RealData | null): World {
  const rng = makeRng(seed)
  PID = 0
  const season = 2026
  const nflReal: Record<string, RealNflPlayer[]> = {}
  // L12.15 S1: rank every real player once so ties at the top spread across the
  // target bands (a pure per-OVR map would leave all seven 99s in one band).
  const newOvrByPlayer = new Map<RealNflPlayer, number>()
  if (data) {
    for (const p of data.nfl) {
      const id = nflTeamIdByName(p.team)
      if (id) (nflReal[id] ??= []).push(p)
    }
    // Ties in the source OVR are spread across the target bands, and (so the
    // league's own roster cutdown `cutTo53` still removes exactly the same
    // players as before the remap) the *later* data row takes the higher band.
    // That way the ascending new-OVR order reproduces the old ascending OVR
    // order, ties included — no roster churn from the remap itself.
    const sorted = data.nfl.map((p, i) => ({ p, i })).sort((a, b) => b.p.ovr - a.p.ovr || b.i - a.i)
    for (let r = 0; r < sorted.length; r++) {
      newOvrByPlayer.set(sorted[r].p, rescaleQuantile((r + 0.5) / sorted.length))
    }
  }
  const teams: Team[] = [...NFL_TEAMS]
  const byId: Record<string, Team> = {}
  const roster: Record<string, Player[]> = {}
  const staff: Record<string, StaffMember[]> = {}
  const standings: Record<string, TeamRecord> = {}
  const deadMoney: Record<string, number> = {}
  const allPlayers: Player[] = []
  const freeAgents: Player[] = []

  for (const t of NFL_TEAMS) {
    byId[t.id] = t
    let players: Player[]
    if (nflReal[t.id]?.length) {
      const rawOvr = new Map<Player, number>()
      players = nflReal[t.id].map((p) => {
        const pl = realNflPlayer(rng, t.id, p, season, newOvrByPlayer.get(p))
        rawOvr.set(pl, p.ovr)
        return pl
      })
      cutTo53(players, freeAgents, rawOvr)
    } else {
      players = generateNFLRoster(rng, t, season)
    }
    fitToCap(players, Math.round(capForSeason(season) * (t.prestige > 80 ? 0.86 : 0.79)))
    roster[t.id] = players
    allPlayers.push(...players)
    staff[t.id] = NFL_STAFF_ROLES.map((r) =>
      makeStaff(rng, t.id, r, Math.min(96, Math.round(t.prestige * 0.9 + (rng() - 0.5) * 18)), season),
    )
    standings[t.id] = zeroRecord(t.id)
    deadMoney[t.id] = Math.round(rng() * 22_000_000)
  }

  const schedule = buildSchedule(rng, NFL_TEAMS, 18, 1, true)

  // Z1b: free agents cut from the starting rosters must also live in `players`,
  // or they never age/develop/retire and can't be found by trades or the ledger.
  {
    const seen = new Set(allPlayers.map((p) => p.id))
    for (const p of freeAgents) {
      if (seen.has(p.id)) continue
      seen.add(p.id)
      allPlayers.push(p)
    }
  }

  // Give every player a hidden character. Real-data players keep theirs hidden
  // from negative narratives; generated players can be the subject of them.
  for (const p of allPlayers) {
    if (!p.character) p.character = makeCharacter(p.id)
    if (p.generated === undefined) p.generated = !(p.attrs && Object.keys(p.attrs).length > 0)
  }

  // The draft has 224+ picks (with comp picks) but the real class only holds
  // 220 prospects, so top it up. Generated ids would collide with the real
  // class (`d${season}_${i}`), so remap them to a distinct namespace.
  let draft = data ? realProspectClass(rng, data.cfb, season) : generateProspectClass(rng, season)
  if (draft.length < 260) {
    const extra = generateProspectClass(rng, season, 260 - draft.length)
    draft = draft.concat(extra.map((p, i) => ({ ...p, id: `dx${season}_${i}` })))
  }

  return {
    seed,
    season,
    week: 1,
    phase: 'regular',
    rookieScaleV2: true,
    ovrScaleV2: true,
    teams,
    byId,
    players: allPlayers,
    roster,
    staff,
    staffPool: generateStaffPool(rng, 44),
    analyticsPool: generateAnalyticsPool(seed),
    standings,
    news: buildNews('BUF', 'Buffalo Bills', 'NFL'),
    draft,
    freeAgents,
    schedule,
    deadMoney,
    draftOrder: [],
    lastChampion: null,
    awards: {},
    jobMarket: [],
    staffTenure: seedStaffTenure(rng),
    draftState: { round: 1, pickIndex: 0, complete: false, log: [] },
    draftPicks: freshDraftWindow(season + 1),
    draftRounds: [],
    practiceSquad: {},
    ir: {},
    compLedger: {},
    rivals: generateRivals(rng, season),
    era: makeEra(rng),
  }
}

export function zeroRecord(teamId: string): TeamRecord {
  return { teamId, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, streak: 0 }
}

/**
 * Z1b: make sure every player who lives on a roster, practice squad, IR list or
 * free-agent pool also has a canonical entry in `world.players`. Without this,
 * players signed out of the starting pool (or added by AI moves) exist only in
 * `roster[*]`, so development and `findPlayer` never see them.
 */
export function indexPlayers(world: World): void {
  const seen = new Set(world.players.map((p) => p.id))
  const adopt = (p: Player) => {
    if (seen.has(p.id)) return
    seen.add(p.id)
    world.players.push(p)
  }
  for (const list of Object.values(world.roster)) for (const p of list) adopt(p)
  for (const list of Object.values(world.practiceSquad ?? {})) for (const p of list) adopt(p)
  for (const list of Object.values(world.ir ?? {})) for (const p of list) adopt(p)
  for (const p of world.freeAgents) adopt(p)
}

/** Team strength used by the simulation (top-22 weighted overall). */
export function teamStrength(players: Player[]): number {
  if (!players.length) return 60
  const top = [...players].sort((a, b) => b.ovr - a.ovr).slice(0, 22)
  // L12.15 S2: report on the old (sim) scale so fast-sim/playoff/AI results hold.
  // Invert each player then average (the remap is nonlinear, so inverting the
  // mean is not the same score).
  return top.reduce((s, p) => s + unscaleOvr(p.ovr), 0) / top.length
}

export { hash32 }

/** Rebuild every team's schedule for a new season. */
/** Random starting staff tenure for every team+side, so programs vary in stability. */
function seedStaffTenure(rng: Rng): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of NFL_TEAMS) {
    out[`${t.id}:off`] = rint(rng, 1, 7)
    out[`${t.id}:def`] = rint(rng, 1, 7)
  }
  return out
}

export function regenerateSchedule(world: World) {
  const rng = makeRng(world.seed + world.season * 8161)
  world.schedule = buildSchedule(rng, NFL_TEAMS, 18, 1, true)
}

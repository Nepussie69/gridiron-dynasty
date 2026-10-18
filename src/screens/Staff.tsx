// ─────────────────────────────────────────────────────────────────────────────
// Staff & Hiring — the UI redesign reference screen (F4). Pattern notes for the
// other screens live in src/screens/README-pattern.md.
//
// Every number on this screen comes from the engine (coachEffect via
// components/staffEffects.ts). Store actions are called exactly as before:
//   hireStaff(candidateId, salary, scheme?) · fireStaff(id) · setStaffFocus(id, focus)
// Access: those three actions only work at 'decide'. There is no store-backed
// staff recommendation yet, so at 'advise' (NFL head coach, scouting directors)
// they render as GATED with a visible reason — never a dead "Recommend…" button
// that ends in a toast.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, type ReactNode } from 'react'
import { ChevronDown, LayoutGrid, List, Search, SlidersHorizontal, Star, UserMinus, UserRound, Compass } from 'lucide-react'
import { cn } from '../lib/cn'
import { ELITE, money, mult, signed, STAFF_BASELINE } from '../lib/format'
import type { CareerState, StaffMember, StaffRole } from '../game/types'
import { useGame, useWorld } from '../store/gameStore'
import {
  AccessBanner,
  Avatar,
  BudgetMeter,
  Button,
  Card,
  ConfirmSheet,
  Delta,
  DivergingMeter,
  Effect,
  FilterChip,
  GatedAction,
  GmStyleTag,
  Inspector,
  KpiStrip,
  KpiTile,
  OptionCard,
  OptionGroup,
  OverflowMenu,
  PageHeader,
  RatingTile,
  SchemeChip,
  SectionTitle,
  SegmentedControl,
  Sheet,
  Tabs,
  TierLegend,
  TierPips,
  TierScale,
  VacantSeat,
  VerdictChip,
  WithInspector,
  type Consequence,
  type MenuItem,
} from '../ui/kit'
import { gateMenuItem, useAccessLevel, useMediaQuery, usePhone, WIDE_QUERY } from '../ui/hooks'
import { DataTable, type Column } from '../components/DataTable'
import { DraftStanceChips } from '../components/DraftPhilosophyCard'
import { CoachSubRatings } from '../components/CoachSubRatings'
import { CoachCareerTimeline, FormerPlayerBadge, InterimHeadCoachBanner } from '../components/CoachCareer'
import { isCoachSeat } from '../game/engine/coachCareer'
import { isSubKey, SUB_FLOOR, SUB_META, subsForRole, subValue, type SubKey } from '../components/coachSubsUi'
import { staffGrade, coordinatorEdge, type CoachEffect } from '../game/engine/coaching'
import {
  ANALYTICS_ROLE,
  DEF_SCHEMES,
  OFF_SCHEMES,
  computeInterest,
  focusOptions,
  hireProbability,
  isFrontOfficeRole,
  openCandidates,
  schemesForRole,
  type HireCandidate,
} from '../game/engine/hiring'
import { ownerStaffBudgetBonus } from '../game/engine/ownerMeeting'
import {
  canAffordHire,
  cheapestStaffAsk,
  coachProfile,
  contractYearsForSalary,
  staffBudget as staffBudgetEngine,
  staffBuyout,
  type StaffBudget,
} from '../game/engine/staffMarket'
import { ACCESS_META, type AccessLevel } from '../game/engine/access'
import {
  PHILOSOPHY_STEP_HINT,
  PHILOSOPHY_STEPS,
  roomSeats,
  type RoomSeat,
} from '../game/engine/draftRoom'
import type { Reputation } from '../game/engine/career'
import { gmCreatedSeason, gmTemperamentWords, type World } from '../game/engine/generate'
import { gmStyle } from '../game/engine/gmStyle'
import {
  boostText,
  buyoutPlan,
  callPreview,
  callsText,
  COACH_UNIT,
  cultureLines,
  devPace,
  engineLimits,
  EXPLOIT_LABEL,
  groupEffectFor,
  impactText,
  inGroup,
  installCost,
  interimProjection,
  leagueRank,
  liveSchemes,
  memberEffect,
  onFieldState,
  poachRisk,
  schemeStateOf,
  seatHolds,
  staffChangeImpact,
  staffCoachEffect,
  staffEffectLines,
  staffTenureFor,
  TONE_TEXT,
  userCoordinatorSeat,
  vacancyCost,
  type EngineLimits,
  type LiveSchemes,
  type RoleGroup,
  type UserSeat,
} from '../components/staffEffects'

// ── Seats, labels, persistence ───────────────────────────────────────────────

/** The 13 seats on a user club staff (the vacant count is out of these, not 10). */
const SEATS = [
  'Head Coach',
  'Offensive Coordinator',
  'Defensive Coordinator',
  'Special Teams Coordinator',
  'QB Coach',
  'OL Coach',
  'DL Coach',
  'Secondary Coach',
  // FUTURES #28 §3: market-only seats; the AI never holds them, so their dev
  // multiplier stays 1. Optional, but they count as (initially) vacant seats here.
  'WR Coach',
  'LB Coach',
  'Scout',
  'Director of Player Personnel',
  ANALYTICS_ROLE,
] as const
const FRONT_SEATS = ['Scout', 'Director of Player Personnel', ANALYTICS_ROLE]

const ROLE_GROUPS: { id: RoleGroup; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'hc', label: 'Head Coach' },
  { id: 'coord', label: 'Coordinators' },
  { id: 'pos', label: 'Position' },
  { id: 'front', label: 'Front office' },
]

/** Hiring-market role chips (short labels). */
const MARKET_ROLES: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'Head Coach', label: 'HC' },
  { id: 'Offensive Coordinator', label: 'OC' },
  { id: 'Defensive Coordinator', label: 'DC' },
  { id: 'Special Teams Coordinator', label: 'ST' },
  { id: 'QB Coach', label: 'QB' },
  { id: 'OL Coach', label: 'OL' },
  { id: 'DL Coach', label: 'DL' },
  { id: 'Secondary Coach', label: 'DB' },
  { id: 'WR Coach', label: 'WR' },
  { id: 'LB Coach', label: 'LB' },
  { id: 'Scout', label: 'Scout' },
  { id: 'Director of Player Personnel', label: 'DPP' },
  { id: ANALYTICS_ROLE, label: 'Analytics' },
]

const SORTS = [
  { id: 'ovr', label: 'OVR' },
  { id: 'fit', label: 'Scheme fit' },
  { id: 'teach', label: 'Best teacher' },
  { id: 'salary', label: 'Salary' },
  { id: 'age', label: 'Age' },
  { id: 'value', label: 'OVR / $M' },
] as const
type SortKey = (typeof SORTS)[number]['id'] | SubKey
type View = 'chart' | 'table'

/** The base sorts plus one option per sub-rating relevant to the picked role. */
function marketSorts(role: string): { id: SortKey; label: string }[] {
  return [
    ...SORTS.map((s) => ({ id: s.id as SortKey, label: s.label })),
    ...subsForRole(role as StaffRole).map((k) => ({ id: k as SortKey, label: SUB_META[k].label })),
  ]
}

const KEY_GROUP = 'gd.staff.roleGroup'
const KEY_VIEW = 'gd.staff.view'
const KEY_MROLE = 'gd.staff.marketRole'

function load<T extends string>(key: string, allowed: readonly string[], fallback: T): T {
  try {
    const saved = localStorage.getItem(key)
    if (saved && allowed.includes(saved)) return saved as T
  } catch {
    /* localStorage unavailable */
  }
  return fallback
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* localStorage unavailable */
  }
}

const SHORT_ROLE: Record<string, string> = {
  'Head Coach': 'Head Coach',
  'Offensive Coordinator': 'Off. Coordinator',
  'Defensive Coordinator': 'Def. Coordinator',
  'Special Teams Coordinator': 'ST Coordinator',
  'QB Coach': 'QB Coach',
  'OL Coach': 'OL Coach',
  'DL Coach': 'DL Coach',
  'Secondary Coach': 'Secondary Coach',
  'WR Coach': 'WR Coach',
  'LB Coach': 'LB Coach',
  Scout: 'Scout',
  'Director of Player Personnel': 'Dir. Player Personnel',
  Analytics: 'Analytics',
  'General Manager': 'General Manager',
}

/** Two/three-letter tag for unit and role chips. */
const ROLE_TAG: Record<string, string> = {
  'Head Coach': 'HC',
  'Offensive Coordinator': 'OC',
  'Defensive Coordinator': 'DC',
  'Special Teams Coordinator': 'STC',
  'QB Coach': 'QB',
  'OL Coach': 'OL',
  'DL Coach': 'DL',
  'Secondary Coach': 'DB',
  'WR Coach': 'WR',
  'LB Coach': 'LB',
  Scout: 'SC',
  'Director of Player Personnel': 'DPP',
  'General Manager': 'GM',
  Analytics: 'AN',
}

/** "Find a better OC" wording. */
const FIND_LABEL: Record<string, string> = {
  'Head Coach': 'head coach',
  'Offensive Coordinator': 'OC',
  'Defensive Coordinator': 'DC',
  'Special Teams Coordinator': 'ST coordinator',
  'QB Coach': 'QB coach',
  'OL Coach': 'OL coach',
  'DL Coach': 'DL coach',
  'Secondary Coach': 'secondary coach',
  'WR Coach': 'WR coach',
  'LB Coach': 'LB coach',
  Scout: 'scout',
  'Director of Player Personnel': 'personnel director',
  Analytics: 'analyst',
}

const lastName = (n: string) => n.split(' ').slice(-1)[0]

/** §66: the floor edge a vacant coordinator seat costs (coaching.ts coordinatorEdge(null)). */
const VACANCY_EDGE = signed(coordinatorEdge(null))

type Unit = 'Head coach' | 'Offense' | 'Defense' | 'Special teams' | 'Front office'
function unitOf(role: string): Unit {
  if (role === 'Head Coach') return 'Head coach'
  if (role === 'Offensive Coordinator' || role === 'QB Coach' || role === 'OL Coach' || role === 'WR Coach') return 'Offense'
  if (role === 'Defensive Coordinator' || role === 'DL Coach' || role === 'Secondary Coach' || role === 'LB Coach') return 'Defense'
  if (role === 'Special Teams Coordinator') return 'Special teams'
  return 'Front office'
}

/** Why a gated staff control is off, shown next to it. */
function gateReason(level: AccessLevel): string {
  if (level === 'advise') return 'The GM signs off on staff moves at your rung'
  return ACCESS_META[level].blurb
}

/** Shared per-render context passed to the pieces below. */
interface Ctx {
  world: World
  teamId: string
  /** The live career — the budget/buyout engine reads it. */
  career: CareerState
  /** §8: the club's staff budget and where it stands (payroll + dead money). */
  budget: StaffBudget
  /** §8: the cheapest available ask — the always-reachable escape hatch. */
  cheapestAsk: number
  /** Your reputation, so the market can show live interest as the offer moves. */
  rep: Reputation
  staff: StaffMember[]
  eff: CoachEffect
  /** The coordinator chair the user holds on this club (never vacant; backlog 193). */
  seat: UserSeat
  lim: EngineLimits
  live: LiveSchemes
  payroll: number
  /** Real access level on 'staff'. */
  level: AccessLevel
  /** Level used for the controls: 'advise' has no store action yet → gated. */
  gate: AccessLevel
  bestId: string | null
  lowestId: string | null
  menuFor: (m: StaffMember) => MenuItem[]
  inspect: (m: StaffMember) => void
  findFor: (role: string) => void
  /** FUTURES #27 DF3: this member's seat in the draft room, when he holds one. */
  stanceFor: (m: StaffMember) => RoomSeat | null
}

// ── Screen ───────────────────────────────────────────────────────────────────

export function Staff() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const career = useGame((s) => s.career)!
  const hireStaff = useGame((s) => s.hireStaff)
  const fireStaff = useGame((s) => s.fireStaff)
  const setStaffFocus = useGame((s) => s.setStaffFocus)
  const promoteInterimAction = useGame((s) => s.promoteInterim)
  const level = useAccessLevel('staff')
  const gate: AccessLevel = level === 'advise' ? 'view' : level
  const canAct = gate === 'decide'
  const phone = usePhone()

  const staff = league.staff[activeTeamId] ?? []
  const [tab, setTab] = useState<'staff' | 'market'>('staff')
  const [view, setView] = useState<View>(() => load<View>(KEY_VIEW, ['chart', 'table'], 'chart'))
  const [roleGroup, setRoleGroup] = useState<RoleGroup>(() =>
    load<RoleGroup>(KEY_GROUP, ROLE_GROUPS.map((g) => g.id), 'all'),
  )
  const [marketRole, setMarketRole] = useState<string>(() => load(KEY_MROLE, MARKET_ROLES.map((r) => r.id), 'all'))
  const [schemeFilter, setSchemeFilter] = useState<string>('all')
  const [minOvr, setMinOvr] = useState(0)
  const [minTeaching, setMinTeaching] = useState(0)
  const [maxSalary, setMaxSalary] = useState(0) // 0 = no cap
  const [fitsOnly, setFitsOnly] = useState(false)
  const [fitsBudget, setFitsBudget] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('ovr')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [firing, setFiring] = useState<StaffMember | null>(null)
  const [focusing, setFocusing] = useState<StaffMember | null>(null)
  const [interim, setInterim] = useState<'off' | 'def' | null>(null)
  const [hiring, setHiring] = useState<{ c: HireCandidate; salary: number; scheme?: string } | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sysOpen, setSysOpen] = useState(false)
  const [frontOpen, setFrontOpen] = useState(false)

  const pickGroup = (g: RoleGroup) => {
    setRoleGroup(g)
    save(KEY_GROUP, g)
  }
  const pickView = (v: View) => {
    setView(v)
    save(KEY_VIEW, v)
  }
  const pickMarketRole = (r: string) => {
    setMarketRole(r)
    save(KEY_MROLE, r)
    // A sub sort only exists for the roles that read that sub.
    if (isSubKey(sortKey) && !subsForRole(r as StaffRole).includes(sortKey)) setSortKey('ovr')
  }
  const openMarket = (role: string) => {
    setTab('market')
    pickMarketRole(role)
  }

  // ── Engine readings ──
  // Staff-only effect with backlog 193's vacancy rule: an empty OC/DC chair
  // costs the floor unless the user sits in it (coordinator rungs 2 and 6).
  const seat = userCoordinatorSeat(career, activeTeamId)
  const eff = staffCoachEffect(league, activeTeamId, seat)
  const lim = engineLimits(league)
  const on = onFieldState(eff, lim)
  const grade = staffGrade(eff)
  const live = liveSchemes(staff)
  const payroll = staff.reduce((s, m) => s + m.annual, 0)
  const avg = staff.length ? Math.round(staff.reduce((s, m) => s + m.rating, 0) / staff.length) : 0
  const elite = staff.filter((m) => m.rating >= ELITE).length
  const holderOf = (role: string) => staff.find((m) => m.role === role)
  const vacant = SEATS.filter((r) => !holderOf(r))
  const filled = SEATS.length - vacant.length
  const posCoaches = staff.filter((m) => COACH_UNIT[m.role])
  const pace = devPace(eff.development)
  const sorted = [...staff].sort((a, b) => b.rating - a.rating)
  const bestId = sorted.length > 1 ? sorted[0].id : null
  const lowestId = sorted.length > 1 ? sorted[sorted.length - 1].id : null

  // FUTURES #28 §8: the staff budget now comes from the engine (staffMarket.staffBudget),
  // so headroom counts payroll AND dead staff money, and the personality multiplier.
  const budget: StaffBudget = staffBudgetEngine(league, career)
  const staffBudget = budget.budget
  const headroom = budget.headroom
  const ownerBonus = ownerStaffBudgetBonus(career, league.season)
  const ownerFundedHire = budget.ownerFund
  const cheapestAsk = cheapestStaffAsk(league)

  // ── Market (display filters only; the hire action is unchanged) ──
  const candidates = openCandidates(league, career.teamId, career.reputation, marketRole === 'all' ? undefined : marketRole)
  const schemesInMarket = Array.from(new Set(candidates.map((c) => c.scheme).filter(Boolean))).sort()
  const mySchemeFor = (role: string): string | null => {
    const wantsDef = role.includes('Defensive') || role === 'DL Coach' || role === 'Secondary Coach' || role === 'LB Coach'
    return (wantsDef ? live.def : live.off)?.scheme ?? null
  }
  const fitsMyScheme = (role: string, scheme: string): boolean => {
    if (!schemesForRole(role).length) return true // front office / ST have no install scheme
    const mine = mySchemeFor(role)
    return !mine || mine === scheme
  }
  /** §66: does the asking price fit the club's real headroom (owner fund covers anything)? */
  const fitsClubBudget = (c: HireCandidate): boolean => ownerFundedHire || c.askingSalary <= headroom
  const visibleCandidates = candidates
    .filter((c) => marketRole === 'all' || c.role === marketRole)
    .filter((c) => (schemeFilter === 'all' ? true : c.scheme === schemeFilter))
    .filter((c) => c.rating >= minOvr)
    .filter((c) => coachProfile(c).teaching >= minTeaching)
    .filter((c) => (maxSalary === 0 ? true : c.askingSalary <= maxSalary))
    .filter((c) => (fitsOnly ? fitsMyScheme(c.role, c.scheme) : true))
    .filter((c) => (fitsBudget ? fitsClubBudget(c) : true))
    .sort((a, b) => {
      if (isSubKey(sortKey)) return subValue(b, sortKey) - subValue(a, sortKey)
      if (sortKey === 'teach') return coachProfile(b).teaching - coachProfile(a).teaching
      if (sortKey === 'salary') return a.askingSalary - b.askingSalary
      if (sortKey === 'age') return a.age - b.age
      if (sortKey === 'value') return b.rating / b.askingSalary - a.rating / a.askingSalary
      if (sortKey === 'fit') {
        const fa = fitsMyScheme(a.role, a.scheme) ? 1 : 0
        const fb = fitsMyScheme(b.role, b.scheme) ? 1 : 0
        if (fa !== fb) return fb - fa
      }
      return b.rating - a.rating
    })
  const activeFilters =
    (marketRole !== 'all' ? 1 : 0) +
    (schemeFilter !== 'all' ? 1 : 0) +
    (minOvr > 0 ? 1 : 0) +
    (minTeaching > 0 ? 1 : 0) +
    (maxSalary > 0 ? 1 : 0) +
    (fitsOnly ? 1 : 0) +
    (fitsBudget ? 1 : 0)
  // Base sorts + one per sub the picked role reads (FUTURES #32 follow-up).
  const sortOptions = marketSorts(marketRole)

  /** "Find a better OC": market for the role, rated above him (52+ while a coordinator sits at the floor), live scheme first. */
  const findFor = (role: string) => {
    const cur = holderOf(role)
    const isCoord = role === 'Offensive Coordinator' || role === 'Defensive Coordinator'
    const floorMin = isCoord && cur && cur.rating < lim.floorExit ? lim.floorExit : 0
    openMarket(role)
    setMinOvr(Math.max(floorMin, cur ? cur.rating + 1 : 0))
    setSchemeFilter('all')
    setMaxSalary(0)
    setFitsOnly(false)
    setSortKey('fit')
    setSelectedId(null)
  }
  const findMin = (m: StaffMember) => {
    const isCoord = m.role === 'Offensive Coordinator' || m.role === 'Defensive Coordinator'
    return Math.max(isCoord && m.rating < lim.floorExit ? lim.floorExit : 0, m.rating + 1)
  }

  const menuFor = (m: StaffMember): MenuItem[] => {
    // gmpersona: the General Manager is the owner's man, not yours. Inspect only —
    // no "find a better GM", no focus change, no firing. (At the GM rung the user
    // sits in that chair himself, so there is no AI GM to show here.)
    if (m.role === 'General Manager') {
      return [
        {
          id: 'readout',
          label: 'View full readout',
          description: 'Effects, contract, league rank',
          icon: <UserRound size={16} />,
          onSelect: () => setSelectedId(m.id),
        },
      ]
    }
    const liveFor = mySchemeFor(m.role)
    const items: MenuItem[] = [
      {
        id: 'readout',
        label: 'View full readout',
        description: 'Effects, contract, league rank',
        icon: <UserRound size={16} />,
        onSelect: () => setSelectedId(m.id),
      },
      {
        id: 'find',
        label: `Find a better ${FIND_LABEL[m.role] ?? m.role}`,
        description: `Market filtered to ${findMin(m)}+${schemesForRole(m.role).length && liveFor ? `, ${liveFor} first` : ''}`,
        icon: <Search size={16} />,
        onSelect: () => findFor(m.role),
      },
    ]
    if (focusOptions(m.role).length) {
      const used = m.focusChanged === league.season
      items.push(
        gateMenuItem(
          gate,
          {
            id: 'focus',
            label: 'Change focus…',
            description: used ? 'Already changed this season' : `Now ${m.focus ?? 'none'} · once per season`,
            icon: <Compass size={16} />,
            disabled: used,
            onSelect: () => setFocusing(m),
          },
          { reason: gateReason(level) },
        ),
      )
    }
    items.push(
      gateMenuItem(
        gate,
        {
          id: 'fire',
          label: 'Let go…',
          description: 'Opens a review of what it costs',
          icon: <UserMinus size={16} />,
          danger: true,
          onSelect: () => setFiring(m),
        },
        { reason: gateReason(level) },
      ),
    )
    return items
  }

  // FUTURES #27 DF3: the draft room's seats by staff id, for your own club only —
  // the room the engine builds for your picks. AI clubs keep their own logic.
  const seatByStaff = new Map(
    (activeTeamId === career.teamId ? roomSeats(league, career) : []).map((s) => [s.id, s] as const),
  )

  const ctx: Ctx = {
    world: league,
    teamId: activeTeamId,
    career,
    budget,
    cheapestAsk,
    rep: career.reputation,
    staff,
    eff,
    seat,
    lim,
    live,
    payroll,
    level,
    gate,
    bestId,
    lowestId,
    menuFor,
    inspect: (m) => setSelectedId(m.id),
    findFor,
    stanceFor: (m) => seatByStaff.get(m.id) ?? null,
  }

  const selected = staff.find((m) => m.id === selectedId) ?? null
  const wide = useMediaQuery(WIDE_QUERY)

  // ── Fire review (decide only) ──
  const fireConsequences = (m: StaffMember): Consequence[] => {
    const rows = staffChangeImpact(league, activeTeamId, m.role, { removeId: m.id }, seat)
    const plan = buyoutPlan(m, league.season)
    const out: Consequence[] = [
      { label: 'Staff payroll', value: `${money(payroll)} → ${money(payroll - m.annual)}` },
      {
        label: 'Buyout (dead money)',
        value: plan.total > 0 ? `${money(plan.total)} · 50% of remaining years` : 'None — the deal is expiring',
        tone: plan.total > 0 ? 'warn' : undefined,
      },
    ]
    if (plan.years > 0) {
      out.push({
        label: `Dead money · ${plan.years} season${plan.years === 1 ? '' : 's'}`,
        value: plan.perSeason.map((p) => `${p.season}: ${money(p.amount)}`).join('  ·  '),
      })
    }
    out.push({ label: `${SHORT_ROLE[m.role] ?? m.role} seat`, value: 'Vacant until hired', tone: 'warn' })
    for (const r of rows) {
      out.push({
        label: r.label,
        value: `${impactText(r)}${r.note ? ` (${r.note})` : ''}`,
        tone: r.better === false ? 'loss' : r.better ? 'win' : undefined,
      })
    }
    if (!rows.length) out.push({ label: 'Sim effect', value: vacancyCost(m.role, seatHolds(seat, m.role)) })
    if (m.role === 'Offensive Coordinator' || m.role === 'Defensive Coordinator')
      out.push({ label: 'Install reset', value: 'Tenure back to year 1 · cohesion and mastery dip' })
    out.push({ label: 'Who decides', value: 'You (Decision Maker)' })
    return out
  }

  // ── Hire review (when it replaces someone; vacant seats hire directly as before) ──
  const hireConsequences = (c: HireCandidate, salary: number, scheme?: string): Consequence[] => {
    const cur = holderOf(c.role)
    const after = payroll - (cur?.annual ?? 0) + salary
    const rows = staffChangeImpact(league, activeTeamId, c.role, { add: { ...c, scheme: scheme ?? c.scheme } }, seat)
    const years = contractYearsForSalary(salary)
    const dead = cur ? staffBuyout(cur) : 0
    const out: Consequence[] = [
      { label: 'Offer', value: `${money(salary)}/yr × ${years} yr` },
      cur
        ? { label: 'Replaces', value: `${cur.name} (${cur.rating}) leaves the club`, tone: 'warn' }
        : { label: 'Seat', value: 'Fills a vacant seat' },
      { label: 'Staff payroll', value: `${money(payroll)} → ${money(after)}` },
      {
        label: 'Budget headroom',
        value: headroom - (after - payroll) >= 0 ? `${money(headroom - (after - payroll))} left` : `Over by ${money(after - payroll - headroom)}`,
        tone: headroom - (after - payroll) >= 0 ? undefined : 'warn',
      },
    ]
    if (dead > 0) out.push({ label: 'Their buyout', value: `${money(dead)} dead staff money`, tone: 'warn' })
    for (const r of rows) {
      out.push({
        label: r.label,
        value: `${impactText(r)}${r.note ? ` (${r.note})` : ''}`,
        tone: r.better === false ? 'loss' : r.better ? 'win' : undefined,
      })
    }
    if (scheme) out.push({ label: 'Installs', value: `${scheme} · tenure resets to year 1` })
    out.push({ label: 'His interest', value: `${c.interest}% · he can still turn it down` })
    return out
  }

  // ── KPI strip ──
  const onVerdict =
    on.clamp === 'floor'
      ? { label: 'At the floor', tone: 'loss' as const }
      : on.clamp === 'cap'
        ? { label: 'At the cap', tone: 'win' as const }
        : on.total <= -1
          ? { label: 'Costing you', tone: 'warn' as const }
          : on.total >= 1
            ? { label: 'An edge', tone: 'win' as const }
            : { label: 'Even', tone: 'neutral' as const }
  const gradeTone = grade === 'Poor' ? 'loss' : grade === 'Average' ? 'neutral' : 'win'

  const kpis = (
    <KpiStrip label="Staff summary" columns="0.9fr 1.1fr 1.5fr 1.3fr 1.2fr" className="mb-4">
      <KpiTile
        className="max-sm:hidden"
        label="Staff"
        value={filled}
        unit={`of ${SEATS.length} seats`}
        why={
          <>
            <b className="font-600 text-ink">{elite} elite</b> (rated {ELITE}+)
            <br />
            <span className="text-muted">
              {vacant.length ? `${vacant.length} vacant: ${vacant.map((r) => SHORT_ROLE[r] ?? r).join(', ')}` : 'Every seat filled'}
            </span>
          </>
        }
      />
      <KpiTile
        label="Staff rating"
        value={avg}
        unit={`avg of ${staff.length}`}
        verdict={{ label: `${grade} staff`, tone: gradeTone }}
        why={
          <span className="text-muted">
            {avg === STAFF_BASELINE
              ? 'Level with the league average'
              : `${Math.abs(avg - STAFF_BASELINE)} ${avg < STAFF_BASELINE ? 'below' : 'above'} the league average`}
            <span className="max-sm:hidden"> · the grade reads the coordinators' edge</span>
          </span>
        }
      >
        <TierScale value={avg} avg={STAFF_BASELINE} label="Staff rating" />
      </KpiTile>
      <KpiTile
        label="On-field impact"
        value={signed(on.total, 1)}
        unit="pts / snap"
        verdict={onVerdict}
        why={
          <>
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              <Effect value={eff.offEdge} unit="OFF" clamp={on.off} />
              <Effect value={eff.defEdge} unit="DEF" clamp={on.def} />
            </span>
            <span className="mt-1 block text-muted max-sm:hidden">
              {on.off === 'floor' || on.def === 'floor'
                ? `Each side bottoms out at ${signed(-lim.edge, 1)}. A coordinator rated ${lim.floorExit}+ is the first hire that moves it.`
                : `Each coordinator adds (rating − ${STAFF_BASELINE}) × 0.2, held between ${signed(-lim.edge, 1)} and ${signed(lim.edge, 1)}.`}
            </span>
          </>
        }
      >
        <DivergingMeter value={on.total} min={on.min} max={on.max} floor={on.min} cap={on.max} label="On-field impact" />
      </KpiTile>
      <KpiTile
        label="Development"
        value={mult(eff.development)}
        unit="growth"
        verdict={{ label: pace.label, tone: eff.development <= lim.devFloor + 1e-9 ? 'loss' : pace.tone }}
        why={
          <span className="max-sm:hidden">
            Average of your {posCoaches.length} position coach{posCoaches.length === 1 ? '' : 'es'}, applied to{' '}
            <b className="font-600 text-ink">every</b> player. ×1.00 is normal; the floor is {mult(lim.devFloor)}.
          </span>
        }
      >
        <DivergingMeter
          value={eff.development}
          min={lim.devFloor}
          max={2 - lim.devFloor}
          mid={1}
          floor={lim.devFloor}
          format={(n) => mult(n)}
          label="Program development"
        />
      </KpiTile>
      <KpiTile
        label="Staff payroll"
        value={money(payroll)}
        verdict={headroom < 0 ? { label: `Over by ${money(-headroom)}`, tone: 'warn' } : { label: `${money(headroom)} left`, tone: 'neutral' }}
        why={
          <span className="text-muted">
            Budget {money(staffBudget)} · {money(headroom)} headroom
            {budget.deadMoney > 0 && (
              <>
                <br />
                <span className="text-warn">{money(budget.deadMoney)} dead money</span> (buyouts) also counts
              </>
            )}
            <span className="sm:hidden">
              <br />
              {filled} of {SEATS.length} seats · {elite} elite
            </span>
          </span>
        }
      >
        <BudgetMeter used={payroll + budget.deadMoney} total={staffBudget} />
      </KpiTile>
    </KpiStrip>
  )

  return (
    <div>
      <PageHeader
        eyebrow="Club"
        title="Staff & Hiring"
        subtitle="Your coaching tree and front office, what each seat does to the sim, and who is available to replace them."
        right={
          tab === 'staff' ? (
            <SegmentedControl
              label="Staff view"
              value={view}
              onChange={pickView}
              options={[
                { id: 'chart', label: 'Chart', icon: <LayoutGrid size={14} aria-hidden /> },
                { id: 'table', label: 'Table', icon: <List size={14} aria-hidden /> },
              ]}
            />
          ) : undefined
        }
      />

      <Tabs
        label="Staff sections"
        value={tab}
        onChange={setTab}
        stretch={phone}
        className="mb-4"
        tabs={[
          { id: 'staff', label: 'My Staff', count: `${filled} / ${SEATS.length}` },
          { id: 'market', label: 'Hiring Market', count: candidates.length },
        ]}
      />

      <AccessBanner
        area="staff"
        className="mb-4"
        message={
          level === 'advise' ? (
            <>
              <b className="font-600 text-ink">At your rung the GM makes staff moves.</b> Hiring, letting go and focus
              changes are his call, so they are locked here. Use this screen to see what each seat does to the sim.
            </>
          ) : undefined
        }
      />

      {kpis}

      {(ownerBonus > 0 || ownerFundedHire) && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--r-md)] border border-line bg-[var(--team-tint)] px-3 py-2 text-small text-ink-2">
          <span className="label text-[var(--team-accent-text)]">Owner meeting</span>
          {ownerBonus > 0 && (
            <span>
              The owner added <b className="font-600 text-ink">{money(ownerBonus)}</b> to the staff budget this season.
            </span>
          )}
          {ownerFundedHire && (
            <span>
              One staff hire this season is <b className="font-600 text-ink">owner-funded</b>: he leans hard on your target.
            </span>
          )}
        </div>
      )}

      {tab === 'staff' ? (
        <WithInspector
          open={!!selected && wide}
          inspector={
            <Inspector
              open={!!selected}
              onClose={() => setSelectedId(null)}
              eyebrow={selected ? (SHORT_ROLE[selected.role] ?? selected.role) : undefined}
              title={selected?.name ?? ''}
              actions={
                selected && (
                  <>
                    <Button variant="secondary" size="sm" icon={<Search size={14} aria-hidden />} onClick={() => findFor(selected.role)}>
                      Compare with market
                    </Button>
                    <span className="ml-auto">
                      <OverflowMenu items={menuFor(selected)} label={`Actions for ${selected.name}`} size="sm" />
                    </span>
                  </>
                )
              }
            >
              {selected && (
                <InspectorBody
                  m={selected}
                  ctx={ctx}
                  onFocus={(f) => setStaffFocus(selected.id, f)}
                  canAct={canAct}
                />
              )}
            </Inspector>
          }
        >
          <SystemCheck ctx={ctx} phone={phone} open={sysOpen} onOpen={setSysOpen} />
          {view === 'chart' ? (
            <OrgChart
              ctx={ctx}
              holderOf={holderOf}
              onVacant={openMarket}
              onInterim={setInterim}
              canAct={canAct}
              frontOpen={frontOpen}
              onFrontOpen={setFrontOpen}
            />
          ) : (
            <StaffTable
              ctx={ctx}
              roleGroup={roleGroup}
              onGroup={pickGroup}
              selectedId={selectedId}
              onSelect={(m) => setSelectedId(m.id)}
            />
          )}
        </WithInspector>
      ) : (
        <Market
          phone={phone}
          visible={visibleCandidates}
          total={candidates.length}
          headroomText={money(Math.max(0, headroom))}
          deadMoney={budget.deadMoney}
          ownerFund={ownerFundedHire}
          filtersOpen={filtersOpen}
          onFiltersOpen={setFiltersOpen}
          activeFilters={activeFilters}
          filters={
            <MarketFilters
              marketRole={marketRole}
              onRole={pickMarketRole}
              schemeFilter={schemeFilter}
              onScheme={setSchemeFilter}
              schemes={schemesInMarket}
              minOvr={minOvr}
              onMinOvr={setMinOvr}
              minTeaching={minTeaching}
              onMinTeaching={setMinTeaching}
              maxSalary={maxSalary}
              onMaxSalary={setMaxSalary}
              fitsOnly={fitsOnly}
              onFits={setFitsOnly}
              fitsBudget={fitsBudget}
              onFitsBudget={setFitsBudget}
              sortKey={sortKey}
              onSort={setSortKey}
              sorts={sortOptions}
              phone={phone}
            />
          }
          onReset={() => {
            pickMarketRole('all')
            setSchemeFilter('all')
            setMinOvr(0)
            setMinTeaching(0)
            setMaxSalary(0)
            setFitsOnly(false)
            setFitsBudget(false)
          }}
          sortLabel={sortOptions.find((s) => s.id === sortKey)?.label ?? 'OVR'}
          renderCard={(c) => (
            <MarketCard
              key={c.id}
              candidate={c}
              ctx={ctx}
              current={holderOf(c.role)}
              onHire={(salary, scheme) => {
                // Same call as before; a replacement goes through the review sheet first.
                if (holderOf(c.role)) setHiring({ c, salary, scheme })
                else hireStaff(c.id, salary, scheme)
              }}
            />
          )}
        />
      )}

      {/* Let go — the only path to fireStaff (decide level). */}
      <ConfirmSheet
        open={!!firing}
        onClose={() => setFiring(null)}
        eyebrow="Staff move"
        title={firing ? `Let go ${firing.name}?` : ''}
        subtitle={
          firing
            ? `${firing.role} · rated ${firing.rating}${isFrontOfficeRole(firing.role) ? '' : ` · ${firing.scheme}`}`
            : undefined
        }
        consequences={firing ? fireConsequences(firing) : []}
        confirmLabel={firing ? `Let go ${lastName(firing.name)}` : 'Let go'}
        saferAlternative={
          firing
            ? {
                label: 'Find a replacement first',
                onClick: () => {
                  const role = firing.role
                  setFiring(null)
                  findFor(role)
                },
              }
            : undefined
        }
        ledgerNote={null}
        onConfirm={() => {
          if (!firing) return
          fireStaff(firing.id)
          if (selectedId === firing.id) setSelectedId(null)
          setFiring(null)
        }}
      >
        {firing && (firing.role === 'Offensive Coordinator' || firing.role === 'Defensive Coordinator') && (
          <p className="mt-2 text-small text-muted">
            An empty coordinator seat costs the floor (<b className="font-600 text-ink-2 tnum">{VACANCY_EDGE} edge</b>) until you
            fill it, and the side's tenure resets to year 1.
          </p>
        )}
        {firing && firing.role === 'Head Coach' && (
          <p className="mt-2 text-small text-muted">4th downs, timeouts and discipline play at the floor until you hire.</p>
        )}
      </ConfirmSheet>

      {/* Replace — review before hireStaff when someone loses his seat. */}
      <ConfirmSheet
        open={!!hiring}
        onClose={() => setHiring(null)}
        eyebrow="Hiring market"
        title={hiring ? `Hire ${hiring.c.name}?` : ''}
        subtitle={hiring ? `${hiring.c.role} · rated ${hiring.c.rating}` : undefined}
        consequences={hiring ? hireConsequences(hiring.c, hiring.salary, hiring.scheme) : []}
        confirmLabel={hiring ? `Replace ${lastName(holderOf(hiring.c.role)?.name ?? '')} · ${money(hiring.salary)}` : 'Hire'}
        ledgerNote={null}
        onConfirm={() => {
          if (!hiring) return
          hireStaff(hiring.c.id, hiring.salary, hiring.scheme)
          setHiring(null)
        }}
      />

      {/* Promote interim — fill a vacant OC/DC from the best position coach (decide only). */}
      {canAct && (
        <InterimSheet
          seat={interim}
          ctx={ctx}
          onClose={() => setInterim(null)}
          onConfirm={() => {
            if (interim) promoteInterimAction(interim)
            setInterim(null)
          }}
        />
      )}

      {/* Front-office focus (once per season, decide level). */}
      <Sheet
        open={!!focusing}
        onClose={() => setFocusing(null)}
        eyebrow={focusing ? SHORT_ROLE[focusing.role] : undefined}
        title={focusing ? `${lastName(focusing.name)}'s focus` : ''}
        subtitle="The lane he works in the market and on draft reports. Once per season."
      >
        {focusing && (
          <OptionGroup label="Focus">
            {focusOptions(focusing.role).map((f) => (
              <OptionCard
                key={f}
                selected={f === focusing.focus}
                disabled={focusing.focusChanged === league.season || !canAct}
                title={f}
                onSelect={() => {
                  if (f === focusing.focus) return
                  setStaffFocus(focusing.id, f)
                  setFocusing(null)
                }}
              />
            ))}
          </OptionGroup>
        )}
      </Sheet>
    </div>
  )
}

// ── Small pieces ─────────────────────────────────────────────────────────────

/** Skewed team tag for units and roles (team colour is identity, never status). */
function RoleTag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-grid h-[22px] min-w-[30px] shrink-0 place-items-center rounded-[2px] bg-[var(--team-fill)] px-1.5 font-cond text-label font-700 uppercase leading-none tracking-[0.06em] text-[var(--team-on)] shadow-[var(--team-slab-ring)] [transform:skewX(var(--skew))]',
        className,
      )}
    >
      <span className="[transform:skewX(calc(var(--skew)*-1))]">{children}</span>
    </span>
  )
}

function NameButton({ m, onClick, className }: { m: StaffMember; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-w-0 text-left hover:underline hover:decoration-line-strong hover:underline-offset-4',
        // Phone / touch: a ≥44px-tall hit box around the name; the negative margin keeps the row height.
        'max-sm:-my-[13px] max-sm:py-[13px] pointer-coarse:-my-[13px] pointer-coarse:py-[13px]',
        className,
      )}
      title={`Open ${m.name}'s readout`}
    >
      {m.name}
    </button>
  )
}

function StaffTags({ m, ctx }: { m: StaffMember; ctx: Ctx }) {
  if (m.id !== ctx.bestId && m.id !== ctx.lowestId) return null
  return (
    <span className="whitespace-nowrap rounded-[var(--r-xs)] bg-surface-3 px-1.5 py-[3px] font-cond text-label font-700 uppercase leading-none tracking-[0.06em] text-ink-2">
      {m.id === ctx.bestId ? 'Best on staff' : 'Lowest rated'}
    </span>
  )
}

function MemberEffect({ m, ctx }: { m: StaffMember; ctx: Ctx }) {
  const e = memberEffect(m, ctx.eff, ctx.lim)
  if (e.kind === 'none') {
    return <span className="text-small text-muted">{isFrontOfficeRole(m.role) ? `Focus: ${m.focus ?? 'none'}` : 'No sim effect'}</span>
  }
  return <Effect value={e.value} kind={e.kind} label={e.label} clamp={e.clamp} className="text-small" />
}

/** FUTURES #28 §5: how the coach in this chair actually calls games (coachTendency). */
function CallsReadout({ m, ctx, className }: { m: StaffMember; ctx: Ctx; className?: string }) {
  const p = callPreview(ctx.world, ctx.teamId, m)
  return (
    <span className={cn('text-small text-muted', className)} title="decisions.ts coachTendency() with this coach in the seat — the live game-day calls">
      Calls {callsText(p)}
      {p.exploit ? ` · ${EXPLOIT_LABEL[p.exploit]}` : ''}
    </span>
  )
}

/** FUTURES #28: the seat's C1 group-dev readout + boost chip, from staffMarket.ts. */
function GroupEffectChip({ m, ctx }: { m: StaffMember; ctx: Ctx }) {
  const ge = groupEffectFor(ctx.world, ctx.teamId, m)
  if (!ge) return null
  const boost = boostText(m)
  return (
    <>
      <span className="whitespace-nowrap text-small text-muted tnum" title={`staffMarket.ts groupDevMultiplier() for ${ge.group}`}>
        {ge.group} group ×{ge.g.toFixed(3)}
      </span>
      {boost && (
        <VerdictChip tone="win" className="tnum">
          {boost}
        </VerdictChip>
      )}
    </>
  )
}

function SchemeFor({ m, ctx }: { m: StaffMember; ctx: Ctx }) {
  const s = schemeStateOf(m, ctx.live, OFF_SCHEMES, DEF_SCHEMES)
  if (!s) return <span className="text-small text-muted">{m.focus ? `${m.focus} (focus)` : 'Front office'}</span>
  return <SchemeChip scheme={m.scheme} state={s.state} against={s.against} />
}

function Contract({ m, stacked = false }: { m: StaffMember; stacked?: boolean }) {
  return (
    <span className={cn('whitespace-nowrap text-small tnum text-muted', stacked && 'flex flex-col items-end')}>
      <b className="font-600 text-ink">{money(m.annual)}/yr</b>
      {stacked ? '' : ' · '}
      {m.contractYears} yr left
    </span>
  )
}

// ── System check ─────────────────────────────────────────────────────────────

function SystemCheck({ ctx, phone, open, onOpen }: { ctx: Ctx; phone: boolean; open: boolean; onOpen: (v: boolean) => void }) {
  const others = ctx.staff
    .filter((m) => !isFrontOfficeRole(m.role) && m.role !== 'Offensive Coordinator' && m.role !== 'Defensive Coordinator')
    .map((m) => ({ m, s: schemeStateOf(m, ctx.live, OFF_SCHEMES, DEF_SCHEMES)! }))
  const offSide = others.filter((o) => o.s.against === 'OC')
  const defSide = others.filter((o) => o.s.against === 'DC' || o.s.state === 'na')
  const clashes = others.filter((o) => o.s.state === 'off')
  const headline = clashes.length
    ? `${clashes.length} coach${clashes.length === 1 ? '' : 'es'} off-system`
    : 'Everyone teaches the live schemes'

  const side = (title: string, holder: StaffMember | null, tag: 'OC' | 'DC', rows: typeof others) => (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="label">{title} runs</span>
        {holder ? (
          <>
            <SchemeChip scheme={holder.scheme} state="live" />
            <span className="text-small text-muted">
              {tag} {lastName(holder.name)} · drives play-calling
            </span>
          </>
        ) : (
          <span className="text-small text-warn">No {tag} · no live scheme</span>
        )}
      </div>
      <ul className="mt-2 divide-y divide-line">
        {rows.map(({ m, s }) => (
          <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
            <button type="button" onClick={() => ctx.inspect(m)} className="min-w-[120px] text-left text-small text-ink-2 hover:text-ink">
              <span className="font-cond font-700 uppercase tracking-[0.05em]">{ROLE_TAG[m.role] ?? m.role}</span>{' '}
              <span className="text-muted">{lastName(m.name)}</span>
            </button>
            <SchemeChip scheme={m.scheme} state={s.state} against={s.against} />
          </li>
        ))}
        {!rows.length && <li className="py-1.5 text-small text-muted">No other coaches on this side.</li>}
      </ul>
    </div>
  )

  const body = (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {side('Offense', ctx.live.off, 'OC', offSide)}
        {side('Defense', ctx.live.def, 'DC', defSide)}
      </div>
      <p className="mt-3 text-small text-muted">
        Only the coordinators' schemes reach the sim. Everyone else's scheme is what he teaches; a mismatch is flagged,
        not scored. Special teams has no scheme in the sim.
      </p>
    </>
  )

  if (phone) {
    return (
      <>
        <button
          type="button"
          onClick={() => onOpen(true)}
          className="motion mb-4 flex min-h-11 w-full items-center gap-2 rounded-[var(--r-md)] border border-line bg-surface px-3 py-2 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="label block">System check</span>
            <span className="block truncate text-small text-ink">
              {clashes.length} scheme clash{clashes.length === 1 ? '' : 'es'} · {ctx.live.off?.scheme ?? 'no OC'} /{' '}
              {ctx.live.def?.scheme ?? 'no DC'}
            </span>
          </span>
          {clashes.length > 0 && <VerdictChip tone="warn">{clashes.length} off</VerdictChip>}
          <ChevronDown size={16} className="-rotate-90 text-muted" aria-hidden />
        </button>
        <Sheet open={open} onClose={() => onOpen(false)} eyebrow="System check" title={headline}>
          {body}
        </Sheet>
      </>
    )
  }

  return (
    <Card className="mb-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="label text-[var(--team-accent-text)]">System check</div>
          <h3 className="mt-1 font-display text-[22px] font-800 italic uppercase leading-none text-ink">{headline}</h3>
        </div>
        {clashes.length > 0 && <VerdictChip tone="warn">{clashes.length} off-system</VerdictChip>}
      </div>
      {body}
    </Card>
  )
}

// ── Org chart ────────────────────────────────────────────────────────────────

function OrgChart({
  ctx,
  holderOf,
  onVacant,
  onInterim,
  canAct,
  frontOpen,
  onFrontOpen,
}: {
  ctx: Ctx
  holderOf: (role: string) => StaffMember | undefined
  onVacant: (role: string) => void
  onInterim: (seat: 'off' | 'def') => void
  canAct: boolean
  frontOpen: boolean
  onFrontOpen: (v: boolean) => void
}) {
  const hc = holderOf('Head Coach')
  // gmpersona: the man in the GM chair. On the personnel path below the GM rung
  // he is above you (the HC works with you); on the coach path he is your boss.
  const gm = holderOf('General Manager')
  const personnelBelowGm = ctx.career.path === 'personnel' && ctx.career.level < 8
  const frontFilled = FRONT_SEATS.filter((r) => holderOf(r))
  const frontVacant = FRONT_SEATS.filter((r) => !holderOf(r))
  const isCoord = (role: string) => role === 'Offensive Coordinator' || role === 'Defensive Coordinator'
  const vacantSeat = (role: string, compact = false) => {
    const held = seatHolds(ctx.seat, role)
    // §66: an empty OC/DC chair costs the floor (−4.5) until it is filled.
    const showFloor = isCoord(role) && !held
    return (
      <VacantSeat
        key={role}
        role={SHORT_ROLE[role] ?? role}
        consequence={
          <>
            {showFloor && (
              <>
                <b className="font-600 text-ink-2 tnum">{VACANCY_EDGE} edge</b> until filled
                {' · '}
              </>
            )}
            {vacancyCost(role, held)}
            {subsForRole(role as StaffRole).length > 0 && (
              <>
                {' · '}plays at floor <b className="font-600 text-ink-2 tnum">{SUB_FLOOR}</b>
              </>
            )}
          </>
        }
        compact={compact}
        action={
          isCoord(role) ? (
            <span className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => onVacant(role)}>
                Find a hire
              </Button>
              {canAct ? (
                <Button variant="quiet" size="sm" onClick={() => onInterim(role === 'Offensive Coordinator' ? 'off' : 'def')}>
                  Promote interim
                </Button>
              ) : (
                <span className="text-small text-muted">Promote interim: {gateReason(ctx.level).toLowerCase()}</span>
              )}
            </span>
          ) : (
            { label: 'Find a hire', onClick: () => onVacant(role) }
          )
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <SectionTitle spacing="tight">Coaching tree</SectionTitle>
      <TierLegend className="mb-3" />

      {hc ? <HeadCoachSlab m={hc} ctx={ctx} withYou={personnelBelowGm} /> : vacantSeat('Head Coach')}

      <div className="grid gap-3 lg:grid-cols-3">
        <UnitColumn
          tag="OFF"
          title="Offense"
          coordinatorRole="Offensive Coordinator"
          coordLine="calls your offense"
          coachRoles={['QB Coach', 'OL Coach', 'WR Coach']}
          ctx={ctx}
          holderOf={holderOf}
          vacantSeat={vacantSeat}
        />
        <UnitColumn
          tag="DEF"
          title="Defense"
          coordinatorRole="Defensive Coordinator"
          coordLine="calls your defense"
          coachRoles={['DL Coach', 'Secondary Coach', 'LB Coach']}
          ctx={ctx}
          holderOf={holderOf}
          vacantSeat={vacantSeat}
        />
        <UnitColumn
          tag="ST"
          title="Special teams"
          coordinatorRole="Special Teams Coordinator"
          coordLine="kicking game"
          coachRoles={[]}
          ctx={ctx}
          holderOf={holderOf}
          vacantSeat={vacantSeat}
          footer={
            <>
              Dev share is one program-wide number: the position coaches average to{' '}
              <b className="font-600 text-ink-2 tnum">{mult(ctx.eff.development)}</b> for every player, not per unit.
            </>
          }
        />
      </div>

      <Card pad={false}>
        {gm && <GmSlab m={gm} ctx={ctx} boss={!(ctx.career.path === 'personnel' && ctx.career.level >= 8)} />}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <h3 className="font-cond text-row font-700 uppercase tracking-[0.02em] text-ink">Front office &amp; scouting</h3>
          <span className="label">{frontFilled.length} filled</span>
          {!frontOpen && frontVacant.map((r) => (
            <span key={r} className="whitespace-nowrap rounded-[var(--r-sm)] border border-dashed border-line-strong px-2 py-1 font-cond text-small font-700 uppercase tracking-[0.05em] text-muted">
              + {SHORT_ROLE[r]} · vacant
            </span>
          ))}
          <Button
            variant="quiet"
            size="sm"
            className="ml-auto"
            aria-expanded={frontOpen}
            onClick={() => onFrontOpen(!frontOpen)}
            icon={<ChevronDown size={14} className={cn('motion', frontOpen && 'rotate-180')} aria-hidden />}
          >
            {frontOpen ? 'Hide seats' : `Show ${FRONT_SEATS.length} seats`}
          </Button>
        </div>
        {frontOpen && (
          <div className="grid gap-2 border-t border-line p-3 md:grid-cols-3">
            {FRONT_SEATS.map((role) => {
              const m = holderOf(role)
              if (!m) return vacantSeat(role)
              return <CompactRow key={role} m={m} ctx={ctx} tag={ROLE_TAG[role]} sub={<MemberEffect m={m} ctx={ctx} />} />
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

function HeadCoachSlab({ m, ctx, withYou = false }: { m: StaffMember; ctx: Ctx; withYou?: boolean }) {
  return (
    <Card tier="feature">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-[260px]">
          {/* gmpersona: on the personnel ladder the head coach is not you — he is
              the man who coaches the team you build. */}
          <div className="label">{withYou ? 'Head Coach · you work with him' : 'Head Coach · leads every unit'}</div>
          <h3 className="mt-1 font-display text-[26px] font-800 italic uppercase leading-none text-ink sm:text-[30px]">
            <NameButton m={m} onClick={() => ctx.inspect(m)} />
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <SchemeFor m={m} ctx={ctx} />
            <MemberEffect m={m} ctx={ctx} />
            <StaffTags m={m} ctx={ctx} />
            <FormerPlayerBadge m={m} />
          </div>
          <SeatStance m={m} ctx={ctx} className="mt-1.5" />
          <InterimHeadCoachBanner m={m} world={ctx.world} className="mt-2" />
          <CoachSubRatings m={m} className="mt-2" />
        </div>
        <RatingTile value={m.rating} size="lg" tierWord delta label="Staff rating" />
        <Contract m={m} stacked />
        <OverflowMenu items={ctx.menuFor(m)} label={`Actions for ${m.name}`} />
      </div>
    </Card>
  )
}

/**
 * gmpersona: the club's General Manager — the man you work for (coach path) or
 * the man above the personnel ladder. Same row anatomy as the other staff: name,
 * rating tile, contract, tenure, tags, plus the two lines that matter to you —
 * his draft-room stance and his gmAsk temperament in plain words. Inspect only:
 * the owner fills this chair, not you.
 */
function GmSlab({ m, ctx, boss }: { m: StaffMember; ctx: Ctx; boss: boolean }) {
  const words = gmTemperamentWords(m)
  const style = gmStyle(m)
  const tenure = Math.max(1, ctx.world.season - gmCreatedSeason(m) + 1)
  const seat = ctx.stanceFor(m)
  const hint = (axis: 'board' | 'tradeDown') => {
    const step = seat?.vector[axis]
    const i = step ? (PHILOSOPHY_STEPS[axis] as readonly string[]).indexOf(step) : -1
    return i < 0 ? null : PHILOSOPHY_STEP_HINT[axis][i]
  }
  return (
    <div className="border-b border-line px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-[260px]">
          <div className="label">General Manager · {boss ? 'your boss' : 'works for you'}</div>
          <h3 className="mt-1 font-display text-[22px] font-800 italic uppercase leading-none text-ink sm:text-[26px]">
            <NameButton m={m} onClick={() => ctx.inspect(m)} />
          </h3>
          <GmStyleTag tag={style.tag} line={style.line} className="mt-2" />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <RoleTag>GM</RoleTag>
            <SchemeFor m={m} ctx={ctx} />
            <MemberEffect m={m} ctx={ctx} />
            <StaffTags m={m} ctx={ctx} />
            <span className="whitespace-nowrap text-small text-muted tnum" title="Seasons in the chair — his id carries the year he was hired">
              {tenure} yr{tenure === 1 ? '' : 's'} in the chair
            </span>
          </div>
          <SeatStance m={m} ctx={ctx} className="mt-1.5" />
          <p className="mt-2 text-small leading-snug text-ink-2">
            <b className="font-600 text-ink">Works with you:</b> {words.patience}, {words.aggression}, {words.cap}.
            {hint('board') && <> On the board: {hint('board')!.toLowerCase()}</>}
            {hint('tradeDown') && <> In trade talks: {hint('tradeDown')!.toLowerCase()}</>}
          </p>
          <p className="mt-1 text-label leading-snug text-muted">
            He answers to the owner: you cannot hire or fire him from this screen. His rating and temperament are his own — they
            decide how much rope your extensions get and how the draft room uses his pen.
          </p>
        </div>
        <RatingTile value={m.rating} size="lg" tierWord delta label="Staff rating" />
        <Contract m={m} stacked />
        <OverflowMenu items={ctx.menuFor(m)} label={`Actions for ${m.name}`} />
      </div>
    </div>
  )
}

function UnitColumn({
  tag,
  title,
  coordinatorRole,
  coordLine,
  coachRoles,
  ctx,
  holderOf,
  vacantSeat,
  footer,
}: {
  tag: string
  title: string
  coordinatorRole: string
  coordLine: string
  coachRoles: string[]
  ctx: Ctx
  holderOf: (role: string) => StaffMember | undefined
  vacantSeat: (role: string, compact?: boolean) => ReactNode
  footer?: ReactNode
}) {
  const coord = holderOf(coordinatorRole)
  const liveScheme = coordinatorRole === 'Special Teams Coordinator' ? null : coord?.scheme
  return (
    <Card pad={false} className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <RoleTag>{tag}</RoleTag>
        <h3 className="font-display text-[20px] font-800 italic uppercase leading-none text-ink">{title}</h3>
        <span className="ml-auto">
          {liveScheme ? <SchemeChip scheme={liveScheme} state="live" /> : <span className="label">No scheme in sim</span>}
        </span>
      </div>
      <div className="px-4 py-3">
        {coord ? (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2">
            <div className="min-w-0">
              <RoleTag className="mb-1.5">{ROLE_TAG[coordinatorRole]}</RoleTag>
              <div className="font-display text-[20px] font-800 italic uppercase leading-tight text-ink">
                <NameButton m={coord} onClick={() => ctx.inspect(coord)} />
              </div>
              <div className="text-small text-muted">
                {coordinatorRole} · {coordLine}
              </div>
            </div>
            <RatingTile value={coord.rating} size="md" tierWord delta label="Staff rating" className="self-start" />
            <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              {coordinatorRole === 'Special Teams Coordinator' && <SchemeFor m={coord} ctx={ctx} />}
              <MemberEffect m={coord} ctx={ctx} />
              <StaffTags m={coord} ctx={ctx} />
              {coordinatorRole !== 'Special Teams Coordinator' && <CallsReadout m={coord} ctx={ctx} />}
            </div>
            <SeatStance m={coord} ctx={ctx} className="col-span-2" />
            <CoachSubRatings m={coord} className="col-span-2" />
            <div className="col-span-2 flex items-center justify-between gap-2">
              <Contract m={coord} />
              <OverflowMenu items={ctx.menuFor(coord)} label={`Actions for ${coord.name}`} size="sm" />
            </div>
          </div>
        ) : (
          vacantSeat(coordinatorRole)
        )}
      </div>
      {coachRoles.length > 0 && (
        <div className="border-t border-line px-4 py-3">
          <div className="mb-2 flex justify-between">
            <span className="label">Position coaches</span>
            <span className="label">Dev share</span>
          </div>
          <div className="space-y-2">
            {coachRoles.map((role) => {
              const m = holderOf(role)
              if (!m) return vacantSeat(role, true)
              return (
                <CompactRow
                  key={role}
                  m={m}
                  ctx={ctx}
                  tag={ROLE_TAG[role]}
                  sub={
                    <>
                      <SchemeFor m={m} ctx={ctx} />
                      <MemberEffect m={m} ctx={ctx} />
                      <GroupEffectChip m={m} ctx={ctx} />
                      <span className="text-small text-muted">feeds program {mult(ctx.eff.development)}</span>
                    </>
                  }
                />
              )
            })}
          </div>
        </div>
      )}
      {footer && <div className="mt-auto border-t border-line px-4 py-3 text-small text-muted">{footer}</div>}
    </Card>
  )
}

/** FUTURES #27 DF3: the member's own draft-room stance, when he holds a seat there. */
function SeatStance({ m, ctx, className }: { m: StaffMember; ctx: Ctx; className?: string }) {
  const seat = ctx.stanceFor(m)
  if (!seat) return null
  return <DraftStanceChips seat={seat} max={2} className={className} />
}

/** A compact staff row: tag, name + sub line, rating tile, ⋯. Used for position coaches and the front office. */
function CompactRow({ m, ctx, tag, sub }: { m: StaffMember; ctx: Ctx; tag: string; sub: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[var(--r-md)] border border-line bg-surface-2 px-2.5 py-2">
      <span className="mt-0.5 w-8 shrink-0 font-cond text-label font-700 uppercase tracking-[0.06em] text-[var(--team-accent-text)]">{tag}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <NameButton m={m} onClick={() => ctx.inspect(m)} className="font-cond text-row font-700 uppercase tracking-[0.02em] text-ink" />
          <StaffTags m={m} ctx={ctx} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">{sub}</div>
        <SeatStance m={m} ctx={ctx} className="mt-1" />
        <CoachSubRatings m={m} className="mt-1" />
        <div className="mt-1">
          <Contract m={m} />
        </div>
      </div>
      <RatingTile value={m.rating} size="sm" label="Staff rating" />
      <OverflowMenu items={ctx.menuFor(m)} label={`Actions for ${m.name}`} size="sm" />
    </div>
  )
}

// ── Table view ───────────────────────────────────────────────────────────────

const UNIT_ORDER: Unit[] = ['Head coach', 'Offense', 'Defense', 'Special teams', 'Front office']

function StaffTable({
  ctx,
  roleGroup,
  onGroup,
  selectedId,
  onSelect,
}: {
  ctx: Ctx
  roleGroup: RoleGroup
  onGroup: (g: RoleGroup) => void
  selectedId: string | null
  onSelect: (m: StaffMember) => void
}) {
  const rows = ctx.staff
    .filter((m) => inGroup(m.role, roleGroup))
    .sort((a, b) => UNIT_ORDER.indexOf(unitOf(a.role)) - UNIT_ORDER.indexOf(unitOf(b.role)))

  const columns: Column<StaffMember>[] = [
    {
      key: 'name',
      label: 'Coach',
      card: 'title',
      sortValue: (m) => m.name,
      render: (m) => (
        <span className="block min-w-0">
          <span className="block font-600 text-ink">{m.name}</span>
          <span className="block text-small text-muted">{SHORT_ROLE[m.role] ?? m.role}</span>
          {isCoachSeat(m.role) && <FormerPlayerBadge m={m} className="mt-0.5" />}
        </span>
      ),
    },
    {
      key: 'scheme',
      label: 'Scheme',
      card: 'meta',
      sortValue: (m) => (isFrontOfficeRole(m.role) ? (m.focus ?? '') : m.scheme),
      render: (m) => <SchemeFor m={m} ctx={ctx} />,
    },
    {
      key: 'effect',
      label: 'Effect',
      card: 'meta',
      headerTitle: 'What the seat does in the sim; sorts by size (edges in points, development as (× − 1) × 10)',
      sortValue: (m) => memberEffect(m, ctx.eff, ctx.lim).sort,
      render: (m) => <MemberEffect m={m} ctx={ctx} />,
    },
    {
      key: 'subs',
      label: 'Sub-ratings',
      card: 'meta',
      headerTitle: 'The individual coaching sub-ratings his seat reads in the sim (FUTURES #32)',
      render: (m) => <CoachSubRatings m={m} />,
    },
    {
      key: 'ovr',
      label: 'Rating',
      align: 'right',
      card: 'aside',
      sortValue: (m) => m.rating,
      render: (m) => <RatingTile value={m.rating} size="sm" label="Staff rating" />,
    },
    {
      key: 'delta',
      label: 'Δ vs avg',
      align: 'right',
      card: 'value',
      headerTitle: `Rating against the league-average staffer (${STAFF_BASELINE})`,
      sortValue: (m) => m.rating - STAFF_BASELINE,
      render: (m) => <Delta value={m.rating - STAFF_BASELINE} />,
    },
    {
      key: 'contract',
      label: 'Contract',
      align: 'right',
      card: 'value',
      sortValue: (m) => m.annual,
      render: (m) => (
        <span className="tnum">
          {money(m.annual)} × {m.contractYears}y
        </span>
      ),
    },
    { key: 'age', label: 'Age', align: 'right', card: 'value', sortValue: (m) => m.age, render: (m) => m.age },
    {
      key: 'specialty',
      label: 'Specialty',
      card: 'hidden',
      sortValue: (m) => m.specialty,
      render: (m) => <span className="text-muted">{m.specialty}</span>,
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      card: 'aside',
      render: (m) => <OverflowMenu items={ctx.menuFor(m)} label={`Actions for ${m.name}`} size="sm" />,
    },
  ]

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Role group">
        {ROLE_GROUPS.map((g) => (
          <FilterChip key={g.id} pressed={roleGroup === g.id} onChange={() => onGroup(g.id)}>
            {g.label}
          </FilterChip>
        ))}
      </div>
      <Card pad={false} className="overflow-hidden p-1 sm:p-0">
        <DataTable
          label="Staff"
          rows={rows}
          columns={columns}
          rowKey={(m) => m.id}
          defaultSortKey="ovr"
          pipsFor={(m) => m.rating}
          groupBy={(m) => unitOf(m.role)}
          groupLabel={(g) => {
            const sys = g === 'Offense' ? ctx.live.off?.scheme : g === 'Defense' ? ctx.live.def?.scheme : null
            return `${g}${sys ? ` · System: ${sys}` : g === 'Special teams' ? ' · no scheme in sim' : ''}`
          }}
          onRowClick={onSelect}
          selectedKey={selectedId}
          maxHeight="none"
          emptyText="No staff in this role group."
        />
      </Card>
    </div>
  )
}

// ── Inspector ────────────────────────────────────────────────────────────────

/** §7/§66: "Promote interim" review — the engine's own projection, before → after. */
function InterimSheet({
  seat,
  ctx,
  onClose,
  onConfirm,
}: {
  seat: 'off' | 'def' | null
  ctx: Ctx
  onClose: () => void
  onConfirm: () => void
}) {
  const proj = seat ? interimProjection(ctx.world, ctx.teamId, seat) : null
  const roleLabel = seat === 'off' ? 'Offensive Coordinator' : 'Defensive Coordinator'
  const who = proj?.member
  const consequences: Consequence[] = proj
    ? [
        { label: 'Edge now', value: `${signed(proj.edgeBefore)} / snap`, tone: proj.edgeBefore < 0 ? 'loss' : undefined },
        {
          label: 'Edge with interim',
          value: `${signed(proj.edgeAfter)} / snap`,
          tone: proj.edgeAfter > proj.edgeBefore ? 'win' : proj.edgeAfter < proj.edgeBefore ? 'loss' : undefined,
        },
        {
          label: 'Promotes',
          value: who ? `${who.name} · ${who.rating} OVR (his own seat −4)` : 'No position coach available',
          tone: who ? undefined : 'warn',
        },
        { label: 'His old seat', value: proj.vacated ? `${proj.vacated} opens · group dev → ×1.000` : '—', tone: 'warn' },
        { label: 'Install reset', value: 'Tenure back to year 1 · cohesion and mastery dip' },
      ]
    : []
  return (
    <ConfirmSheet
      open={!!seat}
      onClose={onClose}
      eyebrow="Vacant coordinator"
      title={`Promote an interim ${roleLabel}?`}
      subtitle="The best position coach takes the chair at rating −4 until you hire a full-time coordinator."
      consequences={consequences}
      confirmLabel={who ? `Promote ${lastName(who.name)}` : 'Promote interim'}
      destructive={false}
      ledgerNote={null}
      onConfirm={onConfirm}
    >
      <p className="mt-2 text-small text-muted">
        He keeps his salary and his old seat becomes vacant — he can no longer coach his own group, so that group's
        development falls back to ×1.000.
      </p>
    </ConfirmSheet>
  )
}

function InspectorBody({
  m,
  ctx,
  onFocus,
  canAct,
}: {
  m: StaffMember
  ctx: Ctx
  onFocus: (focus: string) => void
  canAct: boolean
}) {
  const { rank, of } = leagueRank(ctx.world, m)
  const lines = staffEffectLines(ctx.world, ctx.teamId, m, ctx.eff)
  const s = schemeStateOf(m, ctx.live, OFF_SCHEMES, DEF_SCHEMES)
  const tenure = staffTenureFor(ctx.world, ctx.teamId, m.role)
  const opts = focusOptions(m.role)
  const used = m.focusChanged === ctx.world.season
  const share = ctx.payroll ? Math.round((m.annual / ctx.payroll) * 100) : 0
  const plan = buyoutPlan(m, ctx.world.season)
  const risk = poachRisk(ctx.teamId, m)
  const ge = groupEffectFor(ctx.world, ctx.teamId, m)
  let schemeLine: string
  if (!s) schemeLine = `Front office: works the ${m.focus ?? 'general'} lane; no scheme reaches the sim.`
  else if (s.state === 'live') schemeLine = `His ${m.scheme} is the live scheme: it drives your play-calling.`
  else if (s.state === 'match') schemeLine = `Teaches ${m.scheme}, the same system the ${s.against} runs.`
  else if (s.state === 'off') schemeLine = `Teaches ${m.scheme}; your ${s.against} runs ${s.liveScheme}. Only coordinator schemes reach the sim.`
  else schemeLine = `${m.scheme} is cosmetic here: no effect on the sim.`

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <RatingTile value={m.rating} size="lg" tierWord delta label="Staff rating" />
        <div className="min-w-0 text-small text-ink-2">
          <div>
            <b className="font-600 text-ink tnum">
              #{rank} of {of}
            </b>{' '}
            league-wide at his seat
          </div>
          <div className="text-muted">
            Age {m.age} · {m.specialty}
          </div>
          {tenure && <div className="text-muted">{tenure}</div>}
        </div>
      </div>

      {risk.eligible && (
        <div className="flex flex-wrap items-center gap-2">
          <VerdictChip tone={risk.hot ? 'warn' : 'neutral'}>
            {risk.hot ? `Hot name — ${risk.clubs} clubs asking` : `${risk.clubs} club asking`}
          </VerdictChip>
          <span className="text-small text-muted">
            Rivals can offer a promotion: rating 78+, one year left. A lateral move you can block; a promotion you cannot.
          </span>
        </div>
      )}
      <TierScale value={m.rating} label="Staff rating" />

      <section>
        <div className="label mb-1">What he does</div>
        <dl className="divide-y divide-line rounded-[var(--r-md)] border border-line">
          {lines.map((l, i) => (
            <div key={`${l.label}-${i}`} className="flex justify-between gap-3 px-3 py-2 text-small" title={l.hint}>
              <dt className="text-ink-2">{l.label}</dt>
              <dd className={cn('text-right font-600 tnum', TONE_TEXT[l.tone ?? 'neutral'])}>{l.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <div className="label mb-1">Scheme</div>
        <p className="text-small text-ink-2">{schemeLine}</p>
      </section>

      {subsForRole(m.role).length > 0 && (
        <section>
          <div className="label mb-1.5">Sub-ratings</div>
          <CoachSubRatings m={m} layout="rows" />
        </section>
      )}

      {isCoachSeat(m.role) && (
        <section>
          <div className="label mb-1.5">Career</div>
          <CoachCareerTimeline m={m} world={ctx.world} />
        </section>
      )}

      {ge && (
        <section>
          <div className="label mb-1.5">Teaching &amp; boost</div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="flex items-center gap-2 text-small text-ink-2">
              Teaching <b className="font-600 text-ink tnum">{ge.teaching}</b>
              <TierPips value={ge.teaching} />
            </span>
            {boostText(m) && <VerdictChip tone="win">{boostText(m)}</VerdictChip>}
            <span className="text-small text-muted tnum">
              {ge.group} group ×{ge.g.toFixed(3)} · install {ge.install} wk
            </span>
          </div>
        </section>
      )}

      <section>
        <div className="label mb-1">Contract</div>
        <p className="text-small text-ink-2 tnum">
          <b className="font-600 text-ink">{money(m.annual)}/yr</b> · {m.contractYears} yr left ·{' '}
          {money(m.annual * m.contractYears)} remaining · {share}% of staff payroll
        </p>
        <p className="mt-1 text-small text-muted tnum">
          Buyout if let go now:{' '}
          <b className="font-600 text-ink">{plan.total > 0 ? money(plan.total) : 'none — deal expiring'}</b>
          {plan.years > 0 && ` · dead money ${plan.perSeason.map((p) => `${p.season}: ${money(p.amount)}`).join('  ·  ')}`}
        </p>
      </section>

      {opts.length > 0 && (
        <section>
          <div className="label mb-1">Focus · once per season</div>
          {canAct ? (
            <div className="flex flex-wrap gap-1.5">
              {opts.map((f) => (
                <FilterChip key={f} pressed={f === m.focus} onChange={() => !used && f !== m.focus && onFocus(f)} className={cn(used && f !== m.focus && 'opacity-45')}>
                  {f}
                </FilterChip>
              ))}
            </div>
          ) : (
            <p className="text-small text-muted">
              Now {m.focus ?? 'none'} · {gateReason(ctx.level)}
            </p>
          )}
          {canAct && used && <p className="mt-1 text-label text-muted">Already changed this season.</p>}
        </section>
      )}

      <section>
        <div className="label mb-1">Staff-wide continuity</div>
        <dl className="divide-y divide-line rounded-[var(--r-md)] border border-line">
          {cultureLines(ctx.eff).map((l) => (
            <div key={l.label} className="flex justify-between gap-3 px-3 py-2 text-small" title={l.hint}>
              <dt className="text-ink-2">{l.label}</dt>
              <dd className={cn('text-right font-600 tnum', TONE_TEXT[l.tone ?? 'neutral'])}>{l.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}

// ── Hiring market ────────────────────────────────────────────────────────────

function Market({
  phone,
  visible,
  total,
  headroomText,
  deadMoney,
  ownerFund,
  filters,
  filtersOpen,
  onFiltersOpen,
  activeFilters,
  onReset,
  sortLabel,
  renderCard,
}: {
  phone: boolean
  visible: HireCandidate[]
  total: number
  headroomText: string
  deadMoney: number
  ownerFund: boolean
  filters: ReactNode
  filtersOpen: boolean
  onFiltersOpen: (v: boolean) => void
  activeFilters: number
  onReset: () => void
  sortLabel: string
  renderCard: (c: HireCandidate) => ReactNode
}) {
  return (
    <>
      <p className="mb-3 max-w-3xl text-small text-ink-2">
        Coaches weigh your <b className="font-600 text-ink">destination</b>, your <b className="font-600 text-ink">reputation</b> and
        the <b className="font-600 text-ink">money</b>. Elite coaches turn down weak programs; offer above the ask to land
        them. Budget headroom: <b className="font-600 text-ink tnum">{headroomText}</b>
        {deadMoney > 0 && (
          <>
            {' '}
            <span className="text-warn">after {money(deadMoney)} of dead staff money</span>
          </>
        )}
        {ownerFund && <> · the owner fund covers one hire this season.</>}.
      </p>

      {phone ? (
        <div className="mb-3 flex items-center gap-2">
          <Button variant="secondary" icon={<SlidersHorizontal size={16} aria-hidden />} onClick={() => onFiltersOpen(true)}>
            Filters{activeFilters ? ` (${activeFilters})` : ''}
          </Button>
          <span className="min-w-0 flex-1 text-small text-muted">
            {visible.length} of {total} · sorted by {sortLabel}
          </span>
        </div>
      ) : (
        <Card className="mb-3 bg-surface-2">
          {filters}
          <div className="mt-3 flex items-center gap-3 text-small text-muted">
            <span>
              {visible.length} of {total} available
            </span>
            {activeFilters > 0 && (
              <Button variant="quiet" size="sm" onClick={onReset}>
                Clear filters
              </Button>
            )}
          </div>
        </Card>
      )}

      <Sheet
        open={phone && filtersOpen}
        onClose={() => onFiltersOpen(false)}
        title={`Filters${activeFilters ? ` (${activeFilters})` : ''}`}
        eyebrow="Hiring market"
        footer={
          <>
            <Button variant="primary" size="lg" onClick={() => onFiltersOpen(false)}>
              Show {visible.length} coaches
            </Button>
            {activeFilters > 0 && (
              <Button variant="quiet" onClick={onReset}>
                Clear filters
              </Button>
            )}
          </>
        }
      >
        {filters}
      </Sheet>

      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {visible.map(renderCard)}
        {!visible.length && (
          <Card className="grid place-items-center border-dashed text-center text-body text-muted md:col-span-2 2xl:col-span-3">
            No candidates match these filters.
          </Card>
        )}
      </div>
    </>
  )
}

function MarketFilters({
  marketRole,
  onRole,
  schemeFilter,
  onScheme,
  schemes,
  minOvr,
  onMinOvr,
  minTeaching,
  onMinTeaching,
  maxSalary,
  onMaxSalary,
  fitsOnly,
  onFits,
  fitsBudget,
  onFitsBudget,
  sortKey,
  onSort,
  sorts,
  phone,
}: {
  marketRole: string
  onRole: (r: string) => void
  schemeFilter: string
  onScheme: (s: string) => void
  schemes: string[]
  minOvr: number
  onMinOvr: (n: number) => void
  minTeaching: number
  onMinTeaching: (n: number) => void
  maxSalary: number
  onMaxSalary: (n: number) => void
  fitsOnly: boolean
  onFits: (v: boolean) => void
  fitsBudget: boolean
  onFitsBudget: (v: boolean) => void
  sortKey: SortKey
  onSort: (k: SortKey) => void
  /** Base sorts + the picked role's sub-ratings (FUTURES #32 follow-up). */
  sorts: { id: SortKey; label: string }[]
  phone: boolean
}) {
  const field = 'h-9 rounded-[var(--r-md)] border border-line-strong bg-surface px-2 text-ink max-sm:h-11 max-sm:text-[16px] sm:text-small'
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Role">
        <span className="label mr-1 w-full sm:w-auto">Role</span>
        {MARKET_ROLES.map((r) => (
          <FilterChip key={r.id} pressed={marketRole === r.id} onChange={() => onRole(r.id)}>
            {r.label}
          </FilterChip>
        ))}
      </div>
      <div className={cn('flex flex-wrap items-center gap-x-5 gap-y-3', phone && 'flex-col items-stretch')}>
        <label className="flex items-center gap-2">
          <span className="label w-20 sm:w-auto">Scheme</span>
          <select value={schemeFilter} onChange={(e) => onScheme(e.target.value)} className={cn(field, 'min-w-0 flex-1 sm:flex-none')}>
            <option value="all">Any</option>
            {schemes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="label w-20 sm:w-auto">Min OVR</span>
          <input
            type="range"
            min={0}
            max={95}
            step={1}
            value={minOvr}
            onChange={(e) => onMinOvr(Number(e.target.value))}
            className="h-9 min-w-0 flex-1 accent-[var(--team-accent)] max-sm:h-11 sm:w-28 sm:flex-none"
          />
          <span className="w-7 text-right text-small font-600 text-ink tnum">{minOvr}</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="label w-20 sm:w-auto">Teaching ≥</span>
          <input
            type="range"
            min={0}
            max={95}
            step={1}
            value={minTeaching}
            onChange={(e) => onMinTeaching(Number(e.target.value))}
            className="h-9 min-w-0 flex-1 accent-[var(--team-accent)] max-sm:h-11 sm:w-28 sm:flex-none"
          />
          <span className="w-7 text-right text-small font-600 text-ink tnum">{minTeaching}</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="label w-20 sm:w-auto">Max salary</span>
          <select value={maxSalary} onChange={(e) => onMaxSalary(Number(e.target.value))} className={cn(field, 'min-w-0 flex-1 sm:flex-none')}>
            <option value={0}>Any</option>
            <option value={2_000_000}>≤ $2M</option>
            <option value={4_000_000}>≤ $4M</option>
            <option value={6_000_000}>≤ $6M</option>
            <option value={10_000_000}>≤ $10M</option>
            <option value={15_000_000}>≤ $15M</option>
          </select>
        </label>
        <FilterChip pressed={fitsOnly} onChange={onFits} className="self-start">
          Fits my scheme
        </FilterChip>
        <FilterChip pressed={fitsBudget} onChange={onFitsBudget} className="self-start">
          Fits budget
        </FilterChip>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="label mr-1 w-full sm:w-auto">Sort</span>
        <div className="max-w-full overflow-x-auto">
          <SegmentedControl label="Sort candidates" size="sm" value={sortKey} onChange={onSort} options={sorts} />
        </div>
      </div>
    </div>
  )
}

function MarketCard({
  candidate,
  ctx,
  current,
  onHire,
}: {
  candidate: HireCandidate
  ctx: Ctx
  current?: StaffMember
  onHire: (salary: number, scheme?: string) => void
}) {
  const schemes = schemesForRole(candidate.role)
  const front = isFrontOfficeRole(candidate.role)
  const [offer, setOffer] = useState(candidate.askingSalary)
  const [scheme, setScheme] = useState(candidate.scheme)
  const [open, setOpen] = useState(false)

  const salary = open ? offer : candidate.askingSalary
  // Backlog 398: interest — and the odds he signs — move live with the offer.
  const liveInterest = computeInterest(ctx.world, ctx.teamId, ctx.rep, candidate, salary)
  const liveChance = hireProbability(liveInterest, candidate.rating)
  const interest =
    liveInterest >= 65
      ? { label: 'Keen', tone: 'win' as const }
      : liveInterest >= 40
        ? { label: 'Warm', tone: 'neutral' as const }
        : { label: 'Cold', tone: 'warn' as const }

  // FUTURES #28 §1/§4/§5: the C1 profile, the call preview and the install cost.
  const profile = coachProfile(candidate)
  const calls = callPreview(ctx.world, ctx.teamId, candidate)
  const cost = installCost(ctx.world, ctx.teamId, candidate)
  const boost = boostText(candidate)

  const payrollAfter = ctx.payroll - (current?.annual ?? 0) + salary
  const budget = ctx.budget
  const headroom = budget.budget - budget.deadMoney - payrollAfter
  const affordable = canAffordHire(ctx.world, ctx.career, salary, ctx.cheapestAsk)
  const impact = staffChangeImpact(
    ctx.world,
    ctx.teamId,
    candidate.role,
    { add: { ...candidate, scheme: schemes.length ? scheme : candidate.scheme } },
    ctx.seat,
  )
  const shownScheme = schemes.length ? scheme : candidate.scheme
  const s = schemeStateOf({ role: candidate.role, scheme: shownScheme }, ctx.live, OFF_SCHEMES, DEF_SCHEMES)
  // A coordinator candidate is compared with the coordinator he would replace
  // (hired, his scheme becomes the live one); other coaches with the live scheme.
  const coordHolder = candidate.role === 'Defensive Coordinator' ? ctx.live.def : candidate.role === 'Offensive Coordinator' ? ctx.live.off : null
  const chipState =
    s?.state === 'live' ? (!coordHolder ? 'na' : coordHolder.scheme === shownScheme ? 'match' : 'off') : s?.state
  const against = candidate.role === 'Defensive Coordinator' ? 'DC' : candidate.role === 'Offensive Coordinator' ? 'OC' : s?.against

  return (
    <Card className="flex flex-col">
      <div className="flex items-start gap-3">
        <Avatar name={candidate.name} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-display text-[20px] font-800 italic uppercase leading-none text-ink">{candidate.name}</span>
            {candidate.rating >= ELITE && <Star size={14} className="shrink-0 fill-current text-gold" aria-label="Elite" />}
          </div>
          <div className="mt-1 text-small text-muted">
            {candidate.role} · {candidate.specialty}
          </div>
        </div>
        <RatingTile value={candidate.rating} size="md" tierWord label="Rating" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <VerdictChip tone={interest.tone}>
          {interest.label} {liveInterest}%
        </VerdictChip>
        {front ? (
          <span className="text-small text-muted">Focus: {candidate.focus ?? 'none'}</span>
        ) : chipState ? (
          <SchemeChip scheme={shownScheme} state={chipState} against={against} />
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-small">
        <span className="flex items-center gap-1.5 text-ink-2" title="staffMarket.ts coachProfile().teaching — scales his group's boost and the install speed">
          Teaching <b className="font-600 text-ink tnum">{profile.teaching}</b>
          <TierPips value={profile.teaching} />
        </span>
        {boost && <VerdictChip tone="win">{boost}</VerdictChip>}
        {!front && (
          <span className="text-muted" title="decisions.ts coachTendency() with this candidate in the seat">
            Calls {callsText(calls)}
            {calls.exploit ? ` · ${EXPLOIT_LABEL[calls.exploit]}` : ''}
          </span>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
        <MiniStat label="Age" value={candidate.age} />
        <MiniStat label={front ? 'Focus' : 'Scheme'} value={front ? (candidate.focus ?? '—') : candidate.scheme.split(' ')[0]} />
        <MiniStat label="Asking" value={money(candidate.askingSalary)} />
        <MiniStat label="Deal" value={`${contractYearsForSalary(candidate.askingSalary)} yr`} />
      </dl>

      <CoachSubRatings m={candidate} className="mt-2" />

      <div className="mt-2 space-y-1 rounded-[var(--r-md)] bg-surface-2 px-3 py-2 text-small">
        {current ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-muted">vs {lastName(current.name)}</span>
            <Delta value={candidate.rating - current.rating} suffix="OVR" />
            <Delta value={profile.teaching - coachProfile(current).teaching} suffix="teach" />
            <Effect value={candidate.askingSalary - current.annual} kind="money" goodWhen="down" unit="/yr" />
          </div>
        ) : (
          <div className="text-muted">No current {SHORT_ROLE[candidate.role] ?? candidate.role}: {vacancyCost(candidate.role, seatHolds(ctx.seat, candidate.role))}.</div>
        )}
        {impact.map((r) => (
          <div key={r.label} className="flex flex-wrap items-center gap-x-2">
            <span className="text-muted">{r.label}</span>
            {r.kind === 'edge' ? (
              <Effect value={r.after - r.before} kind="edge" />
            ) : (
              <span className="font-600 text-ink tnum">{impactText(r)}</span>
            )}
            {r.note && <span className="text-muted">· {r.note}</span>}
          </div>
        ))}
        {cost && (
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="text-muted">Install</span>
            <span className="font-600 text-ink tnum">
              {cost.resets ? `tenure y${cost.tenureBefore} → y1` : 'tenure holds'} · mastery {cost.masteryBefore}% → {cost.masteryAfter}%
            </span>
            <span className="text-muted">· {cost.weeks} wk to full · teaching {cost.teaching}</span>
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <VerdictChip tone={headroom >= 0 ? 'neutral' : affordable ? 'neutral' : 'warn'}>
          {headroom >= 0
            ? `Fits · ${money(headroom)} left`
            : affordable
              ? 'Over budget — owner notified'
              : `Over budget by ${money(-headroom)}`}
        </VerdictChip>
        <span className="flex flex-wrap items-center gap-2 text-small text-muted">
          {budget.ownerFund && headroom < 0 && <span className="text-ink-2">owner fund open</span>}
          {current && <span>replaces {money(current.annual)}/yr</span>}
        </span>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
        <Button variant="secondary" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide offer' : 'Adjust offer'}
        </Button>
        {liveInterest < 15 ? (
          <Button variant="secondary" size="sm" disabled className="flex-1">
            Not interested
          </Button>
        ) : (
          <GatedAction
            area="staff"
            level={ctx.gate}
            variant="primary"
            size="sm"
            className="flex-1"
            label={current ? `Replace ${lastName(current.name)} · ${money(salary)}` : `Hire · ${money(salary)}`}
            reason={gateReason(ctx.level)}
            onDecide={() => onHire(salary, schemes.length ? scheme : undefined)}
          />
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-3 rounded-[var(--r-md)] border border-line p-3">
          {schemes.length > 0 && (
            <div>
              <div className="label mb-1.5">Install scheme</div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Install scheme">
                {schemes.map((sc) => (
                  <FilterChip key={sc} pressed={scheme === sc} onChange={() => setScheme(sc)}>
                    {sc}
                  </FilterChip>
                ))}
              </div>
            </div>
          )}
          <label className="block">
            <span className="mb-1 flex items-center justify-between">
              <span className="label">Your offer</span>
              <span className="text-small font-600 text-ink tnum">{money(offer)}</span>
            </span>
            <input
              type="range"
              min={Math.round(candidate.askingSalary * 0.6)}
              max={Math.round(candidate.askingSalary * 1.5)}
              step={50000}
              value={offer}
              onChange={(e) => setOffer(Number(e.target.value))}
              className="h-9 w-full accent-[var(--team-accent)] max-sm:h-11"
            />
            <span className="mt-0.5 flex justify-between text-label text-muted">
              <span>Lowball</span>
              <span>Above ask</span>
            </span>
          </label>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-[var(--r-md)] bg-surface-2 px-3 py-2 text-small">
            <span className="text-muted">With this offer</span>
            <span className="flex items-center gap-2">
              <VerdictChip tone={interest.tone}>Interest {liveInterest}%</VerdictChip>
              <span className="font-600 text-ink tnum">{Math.round(liveChance * 100)}% to sign</span>
            </span>
          </div>
        </div>
      )}
    </Card>
  )
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 rounded-[var(--r-md)] bg-surface-2 py-1.5">
      <dt className="label truncate px-1">{label}</dt>
      <dd className="truncate px-1 text-small font-600 text-ink tnum">{value}</dd>
    </div>
  )
}

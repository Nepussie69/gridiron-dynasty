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
import type { StaffMember } from '../game/types'
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
  TierScale,
  VacantSeat,
  VerdictChip,
  WithInspector,
  type Consequence,
  type MenuItem,
} from '../ui/kit'
import { gateMenuItem, useAccessLevel, useMediaQuery, usePhone, WIDE_QUERY } from '../ui/hooks'
import { DataTable, type Column } from '../components/DataTable'
import { coachEffect, staffGrade, type CoachEffect } from '../game/engine/coaching'
import {
  ANALYTICS_ROLE,
  DEF_SCHEMES,
  OFF_SCHEMES,
  focusOptions,
  isFrontOfficeRole,
  openCandidates,
  schemesForRole,
  type HireCandidate,
} from '../game/engine/hiring'
import { ownerStaffBudgetBonus, ownerStaffFundOpen } from '../game/engine/ownerMeeting'
import { ACCESS_META, type AccessLevel } from '../game/engine/access'
import type { World } from '../game/engine/generate'
import {
  COACH_UNIT,
  cultureLines,
  devPace,
  engineLimits,
  impactText,
  inGroup,
  leagueRank,
  liveSchemes,
  memberEffect,
  onFieldState,
  schemeStateOf,
  staffChangeImpact,
  staffEffectLines,
  staffTenureFor,
  TONE_TEXT,
  vacancyCost,
  type EngineLimits,
  type LiveSchemes,
  type RoleGroup,
} from '../components/staffEffects'

// ── Seats, labels, persistence ───────────────────────────────────────────────

/** The 11 seats on a club staff (the vacant count is out of these, not 10). */
const SEATS = [
  'Head Coach',
  'Offensive Coordinator',
  'Defensive Coordinator',
  'Special Teams Coordinator',
  'QB Coach',
  'OL Coach',
  'DL Coach',
  'Secondary Coach',
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
  { id: 'Scout', label: 'Scout' },
  { id: 'Director of Player Personnel', label: 'DPP' },
  { id: ANALYTICS_ROLE, label: 'Analytics' },
]

const SORTS = [
  { id: 'ovr', label: 'OVR' },
  { id: 'fit', label: 'Scheme fit' },
  { id: 'salary', label: 'Salary' },
  { id: 'age', label: 'Age' },
  { id: 'value', label: 'OVR / $M' },
] as const
type SortKey = (typeof SORTS)[number]['id']
type View = 'chart' | 'table'

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
  Scout: 'SC',
  'Director of Player Personnel': 'DPP',
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
  Scout: 'scout',
  'Director of Player Personnel': 'personnel director',
  Analytics: 'analyst',
}

const lastName = (n: string) => n.split(' ').slice(-1)[0]

type Unit = 'Head coach' | 'Offense' | 'Defense' | 'Special teams' | 'Front office'
function unitOf(role: string): Unit {
  if (role === 'Head Coach') return 'Head coach'
  if (role === 'Offensive Coordinator' || role === 'QB Coach' || role === 'OL Coach') return 'Offense'
  if (role === 'Defensive Coordinator' || role === 'DL Coach' || role === 'Secondary Coach') return 'Defense'
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
  staff: StaffMember[]
  eff: CoachEffect
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
}

// ── Screen ───────────────────────────────────────────────────────────────────

export function Staff() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const career = useGame((s) => s.career)!
  const hireStaff = useGame((s) => s.hireStaff)
  const fireStaff = useGame((s) => s.fireStaff)
  const setStaffFocus = useGame((s) => s.setStaffFocus)
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
  const [maxSalary, setMaxSalary] = useState(0) // 0 = no cap
  const [fitsOnly, setFitsOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('ovr')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [firing, setFiring] = useState<StaffMember | null>(null)
  const [focusing, setFocusing] = useState<StaffMember | null>(null)
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
  }
  const openMarket = (role: string) => {
    setTab('market')
    pickMarketRole(role)
  }

  // ── Engine readings ──
  const eff = coachEffect(league, activeTeamId)
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

  // Display-only staff budget (prestige pot + owner top-up) — unchanged maths.
  const ownerBonus = ownerStaffBudgetBonus(career, league.season)
  const staffBudget = Math.round((18 + league.byId[career.teamId].prestige * 0.3) * 1_000_000) + ownerBonus
  const headroom = staffBudget - payroll
  const ownerFundedHire = ownerStaffFundOpen(career, league.season)

  // ── Market (display filters only; the hire action is unchanged) ──
  const candidates = openCandidates(league, career.teamId, career.reputation, marketRole === 'all' ? undefined : marketRole)
  const schemesInMarket = Array.from(new Set(candidates.map((c) => c.scheme).filter(Boolean))).sort()
  const mySchemeFor = (role: string): string | null => {
    const wantsDef = role.includes('Defensive') || role === 'DL Coach' || role === 'Secondary Coach'
    return (wantsDef ? live.def : live.off)?.scheme ?? null
  }
  const fitsMyScheme = (role: string, scheme: string): boolean => {
    if (!schemesForRole(role).length) return true // front office / ST have no install scheme
    const mine = mySchemeFor(role)
    return !mine || mine === scheme
  }
  const visibleCandidates = candidates
    .filter((c) => marketRole === 'all' || c.role === marketRole)
    .filter((c) => (schemeFilter === 'all' ? true : c.scheme === schemeFilter))
    .filter((c) => c.rating >= minOvr)
    .filter((c) => (maxSalary === 0 ? true : c.askingSalary <= maxSalary))
    .filter((c) => (fitsOnly ? fitsMyScheme(c.role, c.scheme) : true))
    .sort((a, b) => {
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
    (maxSalary > 0 ? 1 : 0) +
    (fitsOnly ? 1 : 0)

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

  const ctx: Ctx = {
    world: league,
    teamId: activeTeamId,
    staff,
    eff,
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
  }

  const selected = staff.find((m) => m.id === selectedId) ?? null
  const wide = useMediaQuery(WIDE_QUERY)

  // ── Fire review (decide only) ──
  const fireConsequences = (m: StaffMember): Consequence[] => {
    const rows = staffChangeImpact(league, activeTeamId, m.role, { removeId: m.id })
    const out: Consequence[] = [
      { label: 'Remaining contract', value: `${money(m.annual * m.contractYears)} (${m.contractYears} yr) · no buyout` },
      { label: 'Staff payroll', value: `${money(payroll)} → ${money(payroll - m.annual)}` },
      { label: `${SHORT_ROLE[m.role] ?? m.role} seat`, value: 'Vacant until hired', tone: 'warn' },
    ]
    for (const r of rows) {
      out.push({
        label: r.label,
        value: `${impactText(r)}${r.note ? ` (${r.note})` : ''}`,
        tone: r.better === false ? 'loss' : r.better ? 'win' : undefined,
      })
    }
    if (!rows.length) out.push({ label: 'Sim effect', value: vacancyCost(m.role) })
    out.push({ label: 'Who decides', value: 'You (Decision Maker)' })
    return out
  }

  // ── Hire review (when it replaces someone; vacant seats hire directly as before) ──
  const hireConsequences = (c: HireCandidate, salary: number, scheme?: string): Consequence[] => {
    const cur = holderOf(c.role)
    const after = payroll - (cur?.annual ?? 0) + salary
    const rows = staffChangeImpact(league, activeTeamId, c.role, { add: { ...c, scheme: scheme ?? c.scheme } })
    const out: Consequence[] = [
      { label: 'Offer', value: `${money(salary)}/yr × 3 yr` },
      cur
        ? { label: 'Replaces', value: `${cur.name} (${cur.rating}) leaves the club`, tone: 'warn' }
        : { label: 'Seat', value: 'Fills a vacant seat' },
      { label: 'Staff payroll', value: `${money(payroll)} → ${money(after)}` },
      {
        label: 'Budget headroom',
        value: staffBudget - after >= 0 ? `${money(staffBudget - after)} left` : `Over by ${money(after - staffBudget)}`,
        tone: staffBudget - after >= 0 ? undefined : 'warn',
      },
    ]
    for (const r of rows) {
      out.push({
        label: r.label,
        value: `${impactText(r)}${r.note ? ` (${r.note})` : ''}`,
        tone: r.better === false ? 'loss' : r.better ? 'win' : undefined,
      })
    }
    if (scheme) out.push({ label: 'Installs', value: scheme })
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
        verdict={headroom < 0 ? { label: 'Over budget', tone: 'warn' } : undefined}
        why={
          <span className="text-muted">
            Budget is advisory · separate from the player cap
            <span className="sm:hidden">
              <br />
              {filled} of {SEATS.length} seats · {elite} elite
            </span>
          </span>
        }
      >
        <BudgetMeter used={payroll} total={staffBudget} />
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
              maxSalary={maxSalary}
              onMaxSalary={setMaxSalary}
              fitsOnly={fitsOnly}
              onFits={setFitsOnly}
              sortKey={sortKey}
              onSort={setSortKey}
              phone={phone}
            />
          }
          onReset={() => {
            pickMarketRole('all')
            setSchemeFilter('all')
            setMinOvr(0)
            setMaxSalary(0)
            setFitsOnly(false)
          }}
          sortLabel={SORTS.find((s) => s.id === sortKey)?.label ?? 'OVR'}
          renderCard={(c) => (
            <MarketCard
              key={c.id}
              candidate={c}
              ctx={ctx}
              current={holderOf(c.role)}
              staffBudget={staffBudget}
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
        {firing && (firing.role === 'Offensive Coordinator' || firing.role === 'Defensive Coordinator' || firing.role === 'Head Coach') && (
          <p className="mt-2 text-small text-muted">An empty seat counts as league average in the sim until you hire.</p>
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
      className={cn('min-w-0 text-left hover:underline hover:decoration-line-strong hover:underline-offset-4', className)}
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
  frontOpen,
  onFrontOpen,
}: {
  ctx: Ctx
  holderOf: (role: string) => StaffMember | undefined
  onVacant: (role: string) => void
  frontOpen: boolean
  onFrontOpen: (v: boolean) => void
}) {
  const hc = holderOf('Head Coach')
  const frontFilled = FRONT_SEATS.filter((r) => holderOf(r))
  const frontVacant = FRONT_SEATS.filter((r) => !holderOf(r))
  const vacantSeat = (role: string, compact = false) => (
    <VacantSeat
      key={role}
      role={SHORT_ROLE[role] ?? role}
      consequence={vacancyCost(role)}
      compact={compact}
      action={{ label: 'Find a hire', onClick: () => onVacant(role) }}
    />
  )

  return (
    <div className="space-y-4">
      <SectionTitle className="!mb-2">Coaching tree</SectionTitle>
      <TierLegend className="mb-3" />

      {hc ? <HeadCoachSlab m={hc} ctx={ctx} /> : vacantSeat('Head Coach')}

      <div className="grid gap-3 lg:grid-cols-3">
        <UnitColumn
          tag="OFF"
          title="Offense"
          coordinatorRole="Offensive Coordinator"
          coordLine="calls your offense"
          coachRoles={['QB Coach', 'OL Coach']}
          ctx={ctx}
          holderOf={holderOf}
          vacantSeat={vacantSeat}
        />
        <UnitColumn
          tag="DEF"
          title="Defense"
          coordinatorRole="Defensive Coordinator"
          coordLine="calls your defense"
          coachRoles={['DL Coach', 'Secondary Coach']}
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

function HeadCoachSlab({ m, ctx }: { m: StaffMember; ctx: Ctx }) {
  return (
    <Card tier="feature">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-[260px]">
          <div className="label">Head Coach · leads every unit</div>
          <h3 className="mt-1 font-display text-[26px] font-800 italic uppercase leading-none text-ink sm:text-[30px]">
            <NameButton m={m} onClick={() => ctx.inspect(m)} />
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <SchemeFor m={m} ctx={ctx} />
            <MemberEffect m={m} ctx={ctx} />
            <StaffTags m={m} ctx={ctx} />
          </div>
        </div>
        <RatingTile value={m.rating} size="lg" tierWord delta label="Staff rating" />
        <Contract m={m} stacked />
        <OverflowMenu items={ctx.menuFor(m)} label={`Actions for ${m.name}`} />
      </div>
    </Card>
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
            </div>
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

      <section>
        <div className="label mb-1">Contract</div>
        <p className="text-small text-ink-2 tnum">
          <b className="font-600 text-ink">{money(m.annual)}/yr</b> · {m.contractYears} yr left ·{' '}
          {money(m.annual * m.contractYears)} remaining · {share}% of staff payroll
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
        them. Budget headroom: <b className="font-600 text-ink tnum">{headroomText}</b>.
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
  maxSalary,
  onMaxSalary,
  fitsOnly,
  onFits,
  sortKey,
  onSort,
  phone,
}: {
  marketRole: string
  onRole: (r: string) => void
  schemeFilter: string
  onScheme: (s: string) => void
  schemes: string[]
  minOvr: number
  onMinOvr: (n: number) => void
  maxSalary: number
  onMaxSalary: (n: number) => void
  fitsOnly: boolean
  onFits: (v: boolean) => void
  sortKey: SortKey
  onSort: (k: SortKey) => void
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
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="label mr-1 w-full sm:w-auto">Sort</span>
        <div className="max-w-full overflow-x-auto">
          <SegmentedControl label="Sort candidates" size="sm" value={sortKey} onChange={onSort} options={SORTS.map((s) => ({ id: s.id, label: s.label }))} />
        </div>
      </div>
    </div>
  )
}

function MarketCard({
  candidate,
  ctx,
  current,
  staffBudget,
  onHire,
}: {
  candidate: HireCandidate
  ctx: Ctx
  current?: StaffMember
  staffBudget: number
  onHire: (salary: number, scheme?: string) => void
}) {
  const schemes = schemesForRole(candidate.role)
  const front = isFrontOfficeRole(candidate.role)
  const [offer, setOffer] = useState(candidate.askingSalary)
  const [scheme, setScheme] = useState(candidate.scheme)
  const [open, setOpen] = useState(false)

  const interest =
    candidate.interest >= 65
      ? { label: 'Keen', tone: 'win' as const }
      : candidate.interest >= 40
        ? { label: 'Warm', tone: 'neutral' as const }
        : { label: 'Cold', tone: 'warn' as const }

  const salary = open ? offer : candidate.askingSalary
  const payrollAfter = ctx.payroll - (current?.annual ?? 0) + salary
  const headroom = staffBudget - payrollAfter
  const impact = staffChangeImpact(ctx.world, ctx.teamId, candidate.role, {
    add: { ...candidate, scheme: schemes.length ? scheme : candidate.scheme },
  })
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
          {interest.label} {candidate.interest}%
        </VerdictChip>
        {front ? (
          <span className="text-small text-muted">Focus: {candidate.focus ?? 'none'}</span>
        ) : chipState ? (
          <SchemeChip scheme={shownScheme} state={chipState} against={against} />
        ) : null}
      </div>

      <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
        <MiniStat label="Age" value={candidate.age} />
        <MiniStat label={front ? 'Focus' : 'Scheme'} value={front ? (candidate.focus ?? '—') : candidate.scheme.split(' ')[0]} />
        <MiniStat label="Asking" value={money(candidate.askingSalary)} />
        <MiniStat label="Deal" value="3 yr" />
      </dl>

      <div className="mt-2 space-y-1 rounded-[var(--r-md)] bg-surface-2 px-3 py-2 text-small">
        {current ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-muted">vs {lastName(current.name)}</span>
            <Delta value={candidate.rating - current.rating} suffix="OVR" />
            <Effect value={candidate.askingSalary - current.annual} kind="money" goodWhen="down" unit="/yr" />
          </div>
        ) : (
          <div className="text-muted">No current {SHORT_ROLE[candidate.role] ?? candidate.role}: {vacancyCost(candidate.role)}.</div>
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
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <VerdictChip tone={headroom >= 0 ? 'neutral' : 'warn'}>
          {headroom >= 0 ? `Fits · ${money(headroom)} left` : `Over budget by ${money(-headroom)}`}
        </VerdictChip>
        {current && <span className="text-small text-muted">replaces {money(current.annual)}/yr</span>}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
        <Button variant="secondary" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide offer' : 'Adjust offer'}
        </Button>
        {candidate.interest < 15 ? (
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

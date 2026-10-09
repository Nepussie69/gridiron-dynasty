import { useState } from 'react'
import { Briefcase, LayoutGrid, List, Star } from 'lucide-react'
import { cn } from '../lib/cn'
import { gradeColor, inkOn, money } from '../lib/format'
import type { StaffMember, StaffRole } from '../game/types'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card, PageHeader, Stat } from '../ui/kit'
import { DataTable, type Column } from '../components/DataTable'
import { coachEffect, staffGrade, type CoachEffect } from '../game/engine/coaching'
import { focusOptions, isFrontOfficeRole, openCandidates, schemesForRole, type HireCandidate } from '../game/engine/hiring'
import { HoverCard } from '../components/HoverCard'
import { ownerStaffBudgetBonus, ownerStaffFundOpen } from '../game/engine/ownerMeeting'
import { InitialsAvatar, StaffHoverCard, VacantChip } from '../components/StaffReadout'
import {
  COACH_UNIT,
  cultureLines,
  displaySystem,
  edgeOf,
  effectSummary,
  inGroup,
  signed,
  unitDevMultiplier,
  type EffectLine,
  type RoleGroup,
} from '../components/staffEffects'

const ROLE_GROUPS: { id: RoleGroup; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'hc', label: 'Head Coach' },
  { id: 'coord', label: 'Coordinators' },
  { id: 'pos', label: 'Position Coaches' },
  { id: 'front', label: 'Front Office & Scouting' },
]

/** Hiring-market role chips (short labels so the row stays on one line). */
const MARKET_ROLES: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'Head Coach', label: 'Head Coach' },
  { id: 'Offensive Coordinator', label: 'OC' },
  { id: 'Defensive Coordinator', label: 'DC' },
  { id: 'Special Teams Coordinator', label: 'ST' },
  { id: 'QB Coach', label: 'QB' },
  { id: 'OL Coach', label: 'OL' },
  { id: 'DL Coach', label: 'DL' },
  { id: 'Secondary Coach', label: 'DB' },
  { id: 'Scout', label: 'Scout' },
  { id: 'Director of Player Personnel', label: 'DPP' },
  { id: 'Analytics', label: 'Analytics' },
]

type View = 'chart' | 'table'
type SortKey = 'ovr' | 'salary' | 'age' | 'value'

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

/** Short position label for the org-chart chips. */
const SHORT_ROLE: Record<string, string> = {
  'Head Coach': 'Head Coach',
  'Offensive Coordinator': 'Off. Coordinator',
  'Defensive Coordinator': 'Def. Coordinator',
  'Special Teams Coordinator': 'ST Coordinator',
  'QB Coach': 'QB Coach',
  'OL Coach': 'OL Coach',
  'DL Coach': 'DL Coach',
  'Secondary Coach': 'Secondary',
  Scout: 'Scout',
  'Director of Player Personnel': 'Dir. Player Personnel',
  Analytics: 'Analytics',
  'General Manager': 'General Manager',
}

export function Staff() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const career = useGame((s) => s.career)!

  const staff = league.staff[activeTeamId] ?? []
  const [tab, setTab] = useState<'staff' | 'market'>('staff')
  const [view, setView] = useState<View>(() => load<View>(KEY_VIEW, ['chart', 'table'], 'chart'))
  const [roleGroup, setRoleGroup] = useState<RoleGroup>(() =>
    load<RoleGroup>(KEY_GROUP, ROLE_GROUPS.map((g) => g.id), 'all'),
  )
  const [marketRole, setMarketRole] = useState<string>(() =>
    load(KEY_MROLE, MARKET_ROLES.map((r) => r.id), 'all'),
  )
  const [schemeFilter, setSchemeFilter] = useState<string>('all')
  const [minOvr, setMinOvr] = useState(0)
  const [maxSalary, setMaxSalary] = useState(0) // 0 = no cap
  const [fitsOnly, setFitsOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('ovr')

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

  const payroll = staff.reduce((s, m) => s + m.annual, 0)
  const effect = coachEffect(league, activeTeamId)
  const grade = staffGrade(effect)
  const hireStaff = useGame((s) => s.hireStaff)
  const fireStaff = useGame((s) => s.fireStaff)
  const setStaffFocus = useGame((s) => s.setStaffFocus)
  const candidates = openCandidates(
    league,
    career.teamId,
    career.reputation,
    marketRole === 'all' ? undefined : marketRole,
  )
  const visibleStaff = staff.filter((m) => inGroup(m.role, roleGroup))

  // Existing display-only staff budget: prestige-scaled pot minus current payroll.
  // FUTURES 25: an owner meeting can top this up for the season, and grant a
  // one-time owner-funded hire that pulls a candidate harder.
  const ownerBonus = ownerStaffBudgetBonus(career, league.season)
  const staffBudget = Math.round((18 + league.byId[career.teamId].prestige * 0.3) * 1_000_000) + ownerBonus
  const localeBudget = Math.max(0, staffBudget - payroll)
  const ownerFundedHire = ownerStaffFundOpen(career, league.season)

  const holderOf = (role: string) => staff.find((m) => m.role === role)

  // ── Market filtering + sorting (display only, the hire action is unchanged) ──
  const schemesInMarket = Array.from(new Set(candidates.map((c) => c.scheme).filter(Boolean))).sort()
  const mySchemeFor = (role: string): string | null => {
    const wantsDef =
      role.includes('Defensive') || role === 'DL Coach' || role === 'Secondary Coach'
    const cur = staff.find((m) => m.role === (wantsDef ? 'Defensive Coordinator' : 'Offensive Coordinator'))
    return cur?.scheme ?? null
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
      return b.rating - a.rating
    })

  return (
    <div>
      <PageHeader
        eyebrow="Club"
        title="Staff & Hiring"
        subtitle="Build your coaching tree and scouting department. The right staff multiplies player development."
        right={
          <div className="flex rounded-lg bg-surface-2 p-0.5">
            {[
              { id: 'staff' as const, label: 'My Staff' },
              { id: 'market' as const, label: 'Hiring Market' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'rounded-md px-4 py-1.5 font-cond text-xs font-700 uppercase tracking-wide transition',
                  tab === t.id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink-2',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <HoverCard
            className="w-full"
            label="What the Staff KPI counts"
            info
            content={<KpiList lines={staffCountLines(staff)} />}
          >
            <span className="block">
              <Stat label="Staff" value={staff.length} sub={`${staff.filter((s) => s.rating > 80).length} elite`} />
            </span>
          </HoverCard>
        </Card>
        <Card>
          <HoverCard
            className="w-full"
            label="What the Staff Rating KPI counts"
            info
            content={<KpiList lines={staffRatingLines(staff, grade)} />}
          >
            <span className="block">
              <Stat
                label="Staff Rating"
                value={Math.round(staff.reduce((s, m) => s + m.rating, 0) / (staff.length || 1))}
                sub={grade + ' staff'}
              />
            </span>
          </HoverCard>
        </Card>
        <Card>
          <HoverCard
            className="w-full"
            label="What makes the on-field impact"
            info
            content={<KpiList lines={onFieldLines(staff, effect)} />}
          >
            <span className="block">
              <Stat
                label="On-Field Impact"
                value={`${effect.offEdge + effect.defEdge >= 0 ? '+' : ''}${(effect.offEdge + effect.defEdge).toFixed(1)}`}
                sub={`Dev ×${effect.development.toFixed(2)}`}
                tone={
                  effect.offEdge + effect.defEdge >= 1
                    ? 'win'
                    : effect.offEdge + effect.defEdge <= -1
                      ? 'loss'
                      : undefined
                }
              />
            </span>
          </HoverCard>
        </Card>
        <Card>
          <HoverCard
            className="w-full"
            label="Payroll breakdown"
            info
            content={<KpiList lines={payrollLines(staff, payroll, staffBudget)} />}
          >
            <span className="block">
              <Stat label="Payroll" value={money(payroll)} sub={`${money(localeBudget)} headroom`} />
            </span>
          </HoverCard>
        </Card>
      </div>

      {(ownerBonus > 0 || ownerFundedHire) && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--team)] bg-[var(--team-soft)] px-3 py-2">
          <Badge tone="team">Owner meeting</Badge>
          {ownerBonus > 0 && (
            <span className="text-xs text-ink-2">
              The owner added <strong className="text-ink">{money(ownerBonus)}</strong> to the staff budget this season.
            </span>
          )}
          {ownerFundedHire && (
            <span className="text-xs text-ink-2">
              One staff hire this season is <strong className="text-ink">owner-funded</strong> — he leans hard on your target.
            </span>
          )}
        </div>
      )}

      {tab === 'staff' ? (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex rounded-lg bg-surface-2 p-0.5">
              {[
                { id: 'chart' as const, label: 'Chart', icon: LayoutGrid },
                { id: 'table' as const, label: 'Table', icon: List },
              ].map((v) => {
                const Icon = v.icon
                return (
                  <button
                    key={v.id}
                    onClick={() => pickView(v.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-3 py-1 font-cond text-[11px] font-700 uppercase tracking-wide transition',
                      view === v.id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink-2',
                    )}
                  >
                    <Icon size={12} />
                    {v.label}
                  </button>
                )
              })}
            </div>
            {view === 'table' && (
              <div className="flex flex-wrap items-center gap-1.5">
                {ROLE_GROUPS.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => pickGroup(g.id)}
                    className={cn(
                      'rounded-md border px-3 py-1 font-cond text-[11px] font-700 uppercase tracking-wide transition',
                      roleGroup === g.id
                        ? 'border-transparent bg-ink text-canvas'
                        : 'border-line text-muted hover:bg-surface-2',
                    )}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {view === 'chart' ? (
            <OrgChart
              staff={staff}
              world={league}
              teamId={activeTeamId}
              onVacant={openMarket}
              onFire={fireStaff}
              onFocusChange={setStaffFocus}
            />
          ) : (
            <StaffTable
              staff={visibleStaff}
              world={league}
              teamId={activeTeamId}
              effect={effect}
              onFire={fireStaff}
              onFocusChange={setStaffFocus}
            />
          )}
        </>
      ) : (
        <>
          <Card className="mb-3 bg-surface-2">
            <div className="text-xs leading-relaxed text-muted">
              Coaches weigh your <strong>destination</strong>, your <strong>reputation</strong>, and the{' '}
              <strong>money</strong>. Elite coaches will turn down a weak program — offer above their asking price to
              land them. Budget available: <strong className="text-ink">{money(localeBudget)}</strong> of headroom.
            </div>
          </Card>

          <div className="mb-3 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="label mr-1">Role</span>
              {MARKET_ROLES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => pickMarketRole(r.id)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 font-cond text-[11px] font-700 uppercase tracking-wide transition',
                    marketRole === r.id
                      ? 'border-transparent bg-ink text-canvas'
                      : 'border-line text-muted hover:bg-surface-2',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5">
                <span className="label">Scheme</span>
                <select
                  value={schemeFilter}
                  onChange={(e) => setSchemeFilter(e.target.value)}
                  className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
                >
                  <option value="all">Any</option>
                  {schemesInMarket.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                <span className="label">Min OVR</span>
                <input
                  type="range"
                  min={0}
                  max={95}
                  step={1}
                  value={minOvr}
                  onChange={(e) => setMinOvr(Number(e.target.value))}
                  className="w-24 accent-[var(--team)]"
                />
                <span className="w-6 font-cond text-xs font-700 tnum text-ink">{minOvr}</span>
              </label>
              <label className="flex items-center gap-1.5">
                <span className="label">Max salary</span>
                <select
                  value={maxSalary}
                  onChange={(e) => setMaxSalary(Number(e.target.value))}
                  className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
                >
                  <option value={0}>Any</option>
                  <option value={2_000_000}>≤ $2M</option>
                  <option value={4_000_000}>≤ $4M</option>
                  <option value={6_000_000}>≤ $6M</option>
                  <option value={10_000_000}>≤ $10M</option>
                  <option value={15_000_000}>≤ $15M</option>
                </select>
              </label>
              <button
                onClick={() => setFitsOnly((v) => !v)}
                className={cn(
                  'rounded-md border px-2.5 py-1 font-cond text-[11px] font-700 uppercase tracking-wide transition',
                  fitsOnly ? 'border-transparent bg-ink text-canvas' : 'border-line text-muted hover:bg-surface-2',
                )}
              >
                Fits my scheme
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="label mr-1">Sort</span>
              {(
                [
                  { id: 'ovr' as const, label: 'OVR' },
                  { id: 'salary' as const, label: 'Salary' },
                  { id: 'age' as const, label: 'Age' },
                  { id: 'value' as const, label: 'Value (OVR/$M)' },
                ]
              ).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSortKey(s.id)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 font-cond text-[11px] font-700 uppercase tracking-wide transition',
                    sortKey === s.id
                      ? 'border-transparent bg-[var(--team)] text-[var(--team-ink)]'
                      : 'border-line text-muted hover:bg-surface-2',
                  )}
                >
                  {s.label}
                </button>
              ))}
              <span className="ml-1 text-[11px] text-faint">
                {visibleCandidates.length} of {candidates.length} available
              </span>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleCandidates.map((c) => (
              <MarketCard
                key={c.id}
                candidate={c}
                world={league}
                teamId={activeTeamId}
                current={holderOf(c.role)}
                payroll={payroll}
                staffBudget={staffBudget}
                fits={fitsMyScheme(c.role, c.scheme)}
                onHire={(salary, scheme) => hireStaff(c.id, salary, scheme)}
              />
            ))}
            {!visibleCandidates.length && (
              <Card className="grid place-items-center border-dashed text-center text-sm text-muted md:col-span-2 xl:col-span-3">
                No candidates match these filters.
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── KPI hover breakdowns ─────────────────────────────────────────────────────
function KpiList({ lines }: { lines: EffectLine[] }) {
  return (
    <div className="space-y-1">
      <div className="label !text-[9px]">Breakdown</div>
      <div className="divide-y divide-line/40">
        {lines.map((l, i) => (
          <div key={`${l.label}-${i}`} className="flex items-start justify-between gap-2 py-0.5" title={l.hint}>
            <span className="text-[10px] text-muted">{l.label}</span>
            <span
              className={cn(
                'text-right text-[11px] font-600 tnum',
                l.tone === 'win' ? 'text-win' : l.tone === 'loss' ? 'text-loss' : l.tone === 'warn' ? 'text-warn' : 'text-ink-2',
              )}
            >
              {l.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function staffCountLines(staff: StaffMember[]): EffectLine[] {
  return [
    { label: 'Coaches & scouts', value: `${staff.length}` },
    { label: 'Elite (>80 OVR)', value: `${staff.filter((s) => s.rating > 80).length}` },
    { label: 'Vacant roles', value: `${Math.max(0, 10 - staff.length)}` },
  ]
}

function staffRatingLines(staff: StaffMember[], grade: string): EffectLine[] {
  const avg = Math.round(staff.reduce((s, m) => s + m.rating, 0) / (staff.length || 1))
  return [
    ...staff
      .slice()
      .sort((a, b) => b.rating - a.rating)
      .map((m) => ({ label: `${m.name} · ${SHORT_ROLE[m.role] ?? m.role}`, value: `${m.rating}` })),
    { label: 'Average', value: `${avg} (${grade})`, hint: 'staffGrade() grades the on-field edge, not the raw average' },
  ]
}

function onFieldLines(staff: StaffMember[], effect: CoachEffect): EffectLine[] {
  const oc = staff.find((m) => m.role === 'Offensive Coordinator')
  const dc = staff.find((m) => m.role === 'Defensive Coordinator')
  const hc = staff.find((m) => m.role === 'Head Coach')
  const hcSit = ((hc?.rating ?? 74) - 74) * 0.12
  const tone = (n: number): EffectLine['tone'] => (n > 0.05 ? 'win' : n < -0.05 ? 'loss' : 'neutral')
  return [
    {
      label: `Offense · OC ${oc ? `${oc.name.split(' ').slice(-1)[0]} ${oc.rating}` : 'vacant'}`,
      value: signed(edgeOf(oc?.rating)),
      tone: tone(edgeOf(oc?.rating)),
      hint: 'coaching.ts offEdge = clamp((OC OVR − 74) × 0.2, ±4.5)',
    },
    {
      label: `Defense · DC ${dc ? `${dc.name.split(' ').slice(-1)[0]} ${dc.rating}` : 'vacant'}`,
      value: signed(edgeOf(dc?.rating)),
      tone: tone(edgeOf(dc?.rating)),
      hint: 'coaching.ts defEdge = clamp((DC OVR − 74) × 0.2, ±4.5)',
    },
    {
      label: 'On-field total',
      value: signed(effect.offEdge + effect.defEdge),
      tone: tone(effect.offEdge + effect.defEdge),
      hint: 'the number shown on the card: offEdge + defEdge',
    },
    {
      label: `Head coach ${hc ? `${hc.name.split(' ').slice(-1)[0]} ${hc.rating}` : 'vacant'}`,
      value: `${signed(hcSit)} situational`,
      tone: tone(hcSit),
      hint: 'coaching.ts situational = (HC OVR − 74) × 0.12 (+ ST + continuity)',
    },
    { label: 'Development', value: `×${effect.development.toFixed(3)}`, tone: effect.development >= 1 ? 'win' : 'loss' },
    { label: 'Discipline', value: `×${effect.discipline.toFixed(2)}`, tone: effect.discipline >= 1 ? 'win' : 'loss' },
    ...cultureLines(effect),
  ]
}

function payrollLines(staff: StaffMember[], payroll: number, budget: number): EffectLine[] {
  return [
    ...staff
      .slice()
      .sort((a, b) => b.annual - a.annual)
      .map((m) => ({ label: `${m.name} · ${SHORT_ROLE[m.role] ?? m.role}`, value: money(m.annual) })),
    { label: 'Total payroll', value: money(payroll) },
    {
      label: 'Staff budget',
      value: money(budget),
      hint: 'display-only: (18 + prestige × 0.3) million',
    },
    {
      label: 'Headroom',
      value: money(Math.max(0, budget - payroll)),
      tone: budget - payroll >= 0 ? 'win' : 'loss',
    },
  ]
}

// ── Org chart ────────────────────────────────────────────────────────────────
function OrgChart({
  staff,
  world,
  teamId,
  onVacant,
  onFire,
  onFocusChange,
}: {
  staff: StaffMember[]
  world: ReturnType<typeof useWorld>
  teamId: string
  onVacant: (role: string) => void
  onFire: (id: string) => void
  onFocusChange: (id: string, focus: string) => void
}) {
  const byRole = (role: string) => staff.find((m) => m.role === role)
  const hc = byRole('Head Coach')

  return (
    <div className="space-y-3">
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <span className="label">Head Coach</span>
          <span className="text-[10px] text-faint">leads every unit below</span>
        </div>
        <div className="mx-auto max-w-md">
          <ChartChip
            member={hc}
            role="Head Coach"
            world={world}
            teamId={teamId}
            onVacant={() => onVacant('Head Coach')}
            onFire={onFire}
            onFocusChange={onFocusChange}
          />
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <UnitColumn
          title="Offense"
          coordinatorRole="Offensive Coordinator"
          coachRoles={['QB Coach', 'OL Coach']}
          staff={staff}
          world={world}
          teamId={teamId}
          onVacant={onVacant}
          onFire={onFire}
          onFocusChange={onFocusChange}
        />
        <UnitColumn
          title="Defense"
          coordinatorRole="Defensive Coordinator"
          coachRoles={['DL Coach', 'Secondary Coach']}
          staff={staff}
          world={world}
          teamId={teamId}
          onVacant={onVacant}
          onFire={onFire}
          onFocusChange={onFocusChange}
        />
        <UnitColumn
          title="Special Teams"
          coordinatorRole="Special Teams Coordinator"
          coachRoles={[]}
          staff={staff}
          world={world}
          teamId={teamId}
          onVacant={onVacant}
          onFire={onFire}
          onFocusChange={onFocusChange}
        />
      </div>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <span className="label">Front Office &amp; Scouting</span>
          <span className="text-[10px] text-faint">evaluates the draft class</span>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {(['Scout', 'Director of Player Personnel', 'Analytics'] as StaffRole[]).map((role) => (
            <ChartChip
              key={role}
              member={byRole(role)}
              role={role}
              world={world}
              teamId={teamId}
              onVacant={() => onVacant(role)}
              onFire={onFire}
              onFocusChange={onFocusChange}
            />
          ))}
        </div>
      </Card>
    </div>
  )
}

function UnitColumn({
  title,
  coordinatorRole,
  coachRoles,
  staff,
  world,
  teamId,
  onVacant,
  onFire,
  onFocusChange,
}: {
  title: string
  coordinatorRole: string
  coachRoles: string[]
  staff: StaffMember[]
  world: ReturnType<typeof useWorld>
  teamId: string
  onVacant: (role: string) => void
  onFire: (id: string) => void
  onFocusChange: (id: string, focus: string) => void
}) {
  const byRole = (role: string) => staff.find((m) => m.role === role)
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <span className="label">{title}</span>
        <span className="text-[10px] text-faint">coordinator → position coaches</span>
      </div>
      <div className="space-y-2">
        <ChartChip
          member={byRole(coordinatorRole)}
          role={coordinatorRole}
          world={world}
          teamId={teamId}
          onVacant={() => onVacant(coordinatorRole)}
          onFire={onFire}
          onFocusChange={onFocusChange}
        />
        {coachRoles.length > 0 && (
          <div className="ml-3 space-y-2 border-l border-dashed border-line pl-3">
            {coachRoles.map((role) => (
              <ChartChip
                key={role}
                member={byRole(role)}
                role={role}
                world={world}
                teamId={teamId}
                onVacant={() => onVacant(role)}
                onFire={onFire}
                onFocusChange={onFocusChange}
              />
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

function ChartChip({
  member,
  role,
  world,
  teamId,
  onVacant,
  onFire,
  onFocusChange,
}: {
  member?: StaffMember
  role: string
  world: ReturnType<typeof useWorld>
  teamId: string
  onVacant: () => void
  onFire: (id: string) => void
  onFocusChange: (id: string, focus: string) => void
}) {
  if (!member) return <VacantChip role={SHORT_ROLE[role] ?? role} onClick={onVacant} />
  const color = gradeColor(member.rating)
  const front = isFrontOfficeRole(member.role)
  const focusOpts = focusOptions(member.role)
  const changed = member.focusChanged === world.season
  return (
    <div className="rounded-xl border border-line bg-surface px-2.5 py-2 transition hover:shadow-[0_1px_6px_rgba(10,22,38,0.08)]">
      <div className="flex items-center gap-2.5">
        <InitialsAvatar name={member.name} size={32} />
        <StaffHoverCard member={member} world={world} teamId={teamId} info={false} className="min-w-0 flex-1">
          <span className="block min-w-0 flex-1 cursor-help">
            <span className="flex items-center gap-1">
              <span className="truncate font-cond text-sm font-700 uppercase leading-tight text-ink">
                {member.name}
              </span>
              {member.rating >= 88 && <Star size={11} className="shrink-0 text-gold" fill="#c99a2e" />}
            </span>
            <span className="block truncate text-[10px] text-muted">
              {SHORT_ROLE[member.role] ?? member.role} · {front ? member.focus ?? 'Front office' : member.scheme}
            </span>
            <span className="block truncate text-[10px] text-ink-2">{effectSummary(member)}</span>
          </span>
        </StaffHoverCard>
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md font-display text-sm font-700 tnum"
          style={{ background: color, color: inkOn(color) }}
          title={`${member.rating} OVR`}
        >
          {member.rating}
        </span>
      </div>
      {front && focusOpts.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 border-t border-line/50 pt-1.5">
          {focusOpts.map((f) => (
            <button
              key={f}
              disabled={changed || f === member.focus}
              onClick={() => onFocusChange(member.id, f)}
              className={cn(
                'rounded border px-1.5 py-0.5 font-cond text-[9px] font-700 uppercase tracking-wide transition disabled:opacity-40',
                f === member.focus ? 'border-transparent bg-ink text-canvas' : 'border-line text-muted hover:bg-surface-2',
              )}
            >
              {f}
            </button>
          ))}
        </div>
      )}
      <div className="mt-1.5 flex items-center justify-between">
        <span className="font-cond text-[10px] text-faint">{money(member.annual)}/yr · {member.contractYears} yr</span>
        <Button size="sm" variant="danger" onClick={() => onFire(member.id)}>
          Let Go
        </Button>
      </div>
    </div>
  )
}

// ── Table view ───────────────────────────────────────────────────────────────
function StaffTable({
  staff,
  world,
  teamId,
  effect,
  onFire,
  onFocusChange,
}: {
  staff: StaffMember[]
  world: ReturnType<typeof useWorld>
  teamId: string
  effect: CoachEffect
  onFire: (id: string) => void
  onFocusChange: (id: string, focus: string) => void
}) {
  const columns: Column<StaffMember>[] = [
    {
      key: 'role',
      label: 'Role',
      sortValue: (m) => m.role,
      render: (m) => <Badge tone="team">{m.role}</Badge>,
    },
    {
      key: 'name',
      label: 'Name',
      sortValue: (m) => m.name,
      render: (m) => (
        <StaffHoverCard member={m} world={world} teamId={teamId} info className="min-w-0">
          <span className="cursor-help truncate font-600 text-ink underline decoration-dotted decoration-line underline-offset-2">
            {m.name}
          </span>
        </StaffHoverCard>
      ),
    },
    {
      key: 'ovr',
      label: 'OVR',
      className: 'text-right',
      sortValue: (m) => m.rating,
      render: (m) => {
        const c = gradeColor(m.rating)
        return (
          <span
            className="inline-grid h-6 min-w-7 place-items-center rounded font-display text-xs font-700 tnum"
            style={{ background: c, color: inkOn(c) }}
          >
            {m.rating}
          </span>
        )
      },
    },
    {
      key: 'specialty',
      label: 'Specialty',
      sortValue: (m) => m.specialty,
      render: (m) => <span className="text-muted">{m.specialty}</span>,
    },
    {
      key: 'scheme',
      label: 'Scheme',
      sortValue: (m) => displaySystem(m),
      render: (m) => <span className="text-ink-2">{isFrontOfficeRole(m.role) ? `${m.focus ?? '—'} (focus)` : m.scheme}</span>,
    },
    { key: 'age', label: 'Age', className: 'text-right', sortValue: (m) => m.age, render: (m) => m.age },
    {
      key: 'salary',
      label: 'Salary',
      className: 'text-right',
      sortValue: (m) => m.annual,
      render: (m) => money(m.annual),
    },
    {
      key: 'years',
      label: 'Years',
      className: 'text-right',
      sortValue: (m) => m.contractYears,
      render: (m) => `${m.contractYears} yr`,
    },
    {
      key: 'effect',
      label: 'Effect',
      sortValue: (m) => effectSummary(m, effect),
      render: (m) => <span className="text-[11px] text-muted">{effectSummary(m, effect)}</span>,
    },
    {
      key: 'actions',
      label: '',
      className: 'text-right',
      render: (m) => (
        <div className="flex flex-wrap items-center justify-end gap-1">
          {focusOptions(m.role).length > 0 && (
            <FocusMenu member={m} season={world.season} onFocusChange={onFocusChange} />
          )}
          <Button size="sm" variant="danger" onClick={() => onFire(m.id)}>
            Let Go
          </Button>
        </div>
      ),
    },
  ]

  if (!staff.length) {
    return (
      <Card className="grid place-items-center border-dashed text-center text-sm text-muted">
        <div>
          <Briefcase size={22} className="mx-auto mb-2 text-faint" />
          No staff in this role group.
        </div>
      </Card>
    )
  }

  return (
    <Card pad={false} className="overflow-hidden">
      <DataTable rows={staff} columns={columns} rowKey={(m) => m.id} defaultSortKey="ovr" />
    </Card>
  )
}

function FocusMenu({
  member,
  season,
  onFocusChange,
}: {
  member: StaffMember
  season: number
  onFocusChange: (id: string, focus: string) => void
}) {
  const [open, setOpen] = useState(false)
  const opts = focusOptions(member.role)
  const changed = member.focusChanged === season
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Button size="sm" onClick={() => setOpen((v) => !v)} title="Change focus (once per season)">
        Focus
      </Button>
      {open &&
        opts.map((f) => (
          <button
            key={f}
            disabled={changed || f === member.focus}
            onClick={() => {
              onFocusChange(member.id, f)
              setOpen(false)
            }}
            className={cn(
              'rounded border px-1.5 py-0.5 font-cond text-[10px] font-700 uppercase tracking-wide transition disabled:opacity-40',
              f === member.focus ? 'bg-ink text-canvas' : 'border-line text-muted hover:bg-surface-2',
            )}
          >
            {f}
          </button>
        ))}
    </span>
  )
}

// ── Hiring market row ────────────────────────────────────────────────────────
function MarketCard({
  candidate,
  world,
  teamId,
  current,
  payroll,
  staffBudget,
  fits,
  onHire,
}: {
  candidate: HireCandidate
  world: ReturnType<typeof useWorld>
  teamId: string
  current?: StaffMember
  payroll: number
  staffBudget: number
  fits: boolean
  onHire: (salary: number, scheme?: string) => void
}) {
  const schemes = schemesForRole(candidate.role)
  const front = isFrontOfficeRole(candidate.role)
  const [offer, setOffer] = useState(candidate.askingSalary)
  const [scheme, setScheme] = useState(candidate.scheme)
  const [open, setOpen] = useState(false)

  const interestTone = candidate.interest >= 65 ? 'win' : candidate.interest >= 40 ? 'warn' : 'loss'
  const interestLabel = candidate.interest >= 65 ? 'Keen' : candidate.interest >= 40 ? 'Warm' : 'Cold'

  // Salary the user would actually commit (offer when negotiating, else asking).
  const salary = open ? offer : candidate.askingSalary
  const payrollAfter = payroll - (current?.annual ?? 0) + salary
  const headroom = staffBudget - payrollAfter

  const ovrDelta = current ? candidate.rating - current.rating : null
  const salaryDelta = current ? candidate.askingSalary - current.annual : null
  const isUnit = !!COACH_UNIT[candidate.role]
  const impactDelta = current
    ? isUnit
      ? unitDevMultiplier(candidate.rating) - unitDevMultiplier(current.rating)
      : edgeOf(candidate.rating) - edgeOf(current.rating)
    : null
  const impactLabel = isUnit ? 'dev' : 'edge'

  const confirmedHire = () => {
    if (current && !window.confirm(`Replace ${current.name} (${current.rating} OVR) with ${candidate.name} (${candidate.rating} OVR)?`))
      return
    onHire(salary, schemes.length ? scheme : undefined)
  }

  return (
    <Card>
      <div className="flex items-start gap-3">
        <InitialsAvatar name={candidate.name} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StaffHoverCard member={candidate} world={world} teamId={teamId} info={false} className="min-w-0">
              <span className="truncate font-display text-lg font-700 uppercase leading-none text-ink">
                {candidate.name}
              </span>
            </StaffHoverCard>
            {candidate.rating >= 88 && <Star size={14} className="shrink-0 text-gold" fill="#c99a2e" />}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone="team">{candidate.role}</Badge>
            <Badge tone={candidate.rating >= 85 ? 'gold' : candidate.rating >= 75 ? 'info' : 'neutral'}>
              {candidate.rating} OVR
            </Badge>
            <Badge tone={interestTone as 'win' | 'warn' | 'loss'}>
              {interestLabel} {candidate.interest}%
            </Badge>
            <Badge tone="neutral">{candidate.specialty}</Badge>
            {schemes.length > 0 && (
              <Badge tone={fits ? 'win' : 'neutral'}>{fits ? 'fits my scheme' : 'different scheme'}</Badge>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        <MiniStat label="Age" value={candidate.age} />
        <MiniStat label={front ? 'Focus' : 'Scheme'} value={front ? candidate.focus ?? '—' : candidate.scheme.split(' ')[0]} />
        <MiniStat label="Asking" value={money(candidate.askingSalary)} />
        <MiniStat label="Deal" value="3 yr" />
      </div>

      <div className="mt-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[11px]">
        {current ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-muted">vs {current.name.split(' ').slice(-1)[0]}:</span>
            <span className={deltaClass(ovrDelta ?? 0)}>{signed(ovrDelta ?? 0, 0)} OVR</span>
            <span className={deltaClass(impactDelta ?? 0)}>
              {signed(impactDelta ?? 0, isUnit ? 3 : 1)} {impactLabel}
            </span>
            <span className={deltaClass(-(salaryDelta ?? 0))}>
              {salaryDelta && salaryDelta > 0 ? '+' : ''}
              {money(salaryDelta ?? 0)}/yr
            </span>
          </div>
        ) : (
          <span className="text-muted">No current {SHORT_ROLE[candidate.role] ?? candidate.role} — a free run at the hire.</span>
        )}
      </div>

      <div className="mt-1.5 flex items-center justify-between">
        <Badge tone={headroom >= 0 ? 'win' : 'loss'}>
          {headroom >= 0 ? `Fits · ${money(headroom)} left` : `Over by ${money(-headroom)}`}
        </Badge>
        {current && (
          <span className="text-[10px] text-faint">replaces {money(current.annual)}/yr</span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-line px-2 py-1 font-cond text-[10px] font-700 uppercase tracking-wide text-muted transition hover:bg-surface-2"
        >
          {open ? 'Hide offer' : 'Adjust offer'}
        </button>
        <Button
          size="sm"
          variant="team"
          className="flex-1"
          disabled={candidate.interest < 15}
          onClick={confirmedHire}
        >
          {candidate.interest < 15
            ? 'Not interested'
            : current
              ? `Replace ${current.name.split(' ').slice(-1)[0]} · ${money(salary)}`
              : `Hire · ${money(salary)}`}
        </Button>
      </div>

      {open && (
        <div className="mt-2 rounded-lg border border-line/60 p-2">
          {schemes.length > 0 && (
            <div className="mb-2">
              <div className="label mb-1">Install scheme</div>
              <div className="flex flex-wrap gap-1">
                {schemes.map((s) => (
                  <button
                    key={s}
                    onClick={() => setScheme(s)}
                    className={cn(
                      'rounded-md border px-2 py-1 font-cond text-[11px] font-700 uppercase transition',
                      scheme === s ? 'border-transparent bg-ink text-canvas' : 'border-line text-muted hover:bg-surface-2',
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="label">Your offer</span>
              <span className="font-cond text-xs font-700 tnum text-ink">{money(offer)}</span>
            </div>
            <input
              type="range"
              min={Math.round(candidate.askingSalary * 0.6)}
              max={Math.round(candidate.askingSalary * 1.5)}
              step={50000}
              value={offer}
              onChange={(e) => setOffer(Number(e.target.value))}
              className="w-full accent-[var(--team)]"
            />
            <div className="mt-0.5 flex justify-between text-[10px] text-faint">
              <span>Lowball</span>
              <span>Above ask</span>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

function deltaClass(n: number): string {
  if (n > 0.0001) return 'font-700 text-win'
  if (n < -0.0001) return 'font-700 text-loss'
  return 'text-muted'
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-surface-2 py-1.5">
      <div className="label !text-[9px]">{label}</div>
      <div className="font-cond text-sm font-700 tnum text-ink">{value}</div>
    </div>
  )
}

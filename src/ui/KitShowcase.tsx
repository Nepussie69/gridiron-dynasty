// ─────────────────────────────────────────────────────────────────────────────
// /kit — hidden dev showcase for every kit primitive (UI redesign F2).
// Open with the URL hash  #/kit  (e.g. http://localhost:5173/#/kit).
// The page renders the gallery twice: in the app theme (switch with the theme
// control) and inside the always-dark `.broadcast` scope, with the club picker
// writing the same contrast-checked team tokens AppShell writes.
// ─────────────────────────────────────────────────────────────────────────────
import { lazy, Suspense, useLayoutEffect, useState, type ReactNode } from 'react'
import { ArrowRight, BarChart3, Eye, LayoutGrid, Search, Table2, UserMinus, UserSearch } from 'lucide-react'
import { NFL_TEAMS } from '../game/data/nflTeams'
import { rootTeamVars, TEAM_VAR_NAMES } from '../lib/teamColor'
import { cn } from '../lib/cn'
import { DataTable, type Column } from '../components/DataTable'
import { HoverCard } from '../components/HoverCard'
import { useResolvedTheme } from './hooks'
import {
  AccessBanner,
  Avatar,
  Badge,
  BudgetMeter,
  Button,
  Card,
  Chip,
  ConfirmSheet,
  DensityToggle,
  DevBadge,
  Dialog,
  DivergingMeter,
  Effect,
  FilterChip,
  GatedAction,
  IconButton,
  Inspector,
  KpiStrip,
  KpiTile,
  Delta,
  Money,
  OptionCard,
  OptionGroup,
  OverflowMenu,
  OvrBadge,
  PageHeader,
  RatingBar,
  RatingTile,
  RookieRangeBadges,
  SchemeChip,
  Scoreline,
  ScoreBlock,
  SectionTitle,
  SegmentedControl,
  Sheet,
  Stat,
  Tabs,
  ThemeToggle,
  TierLegend,
  TierScale,
  VacantSeat,
  WithInspector,
} from './kit'

// Broadcast 2.5D B2: field + stadium renderer preview (own chunk).
const BroadcastFieldPreview = lazy(() => import('../components/broadcast/BroadcastFieldPreview'))

const SAMPLE_RATINGS = [93, 85, 77, 69, 61, 57, 53, 48, 45]

interface StaffRow {
  id: string
  name: string
  role: string
  unit: 'OFFENSE' | 'DEFENSE' | 'SPECIAL TEAMS'
  scheme: string
  live: boolean
  rating: number
  effect: number
  annual: number
  years: number
}

const STAFF: StaffRow[] = [
  { id: 'oc', name: 'Reggie Dawson', role: 'OC', unit: 'OFFENSE', scheme: 'West Coast', live: true, rating: 53, effect: -4.5, annual: 2_200_000, years: 3 },
  { id: 'qb', name: 'Tom Ellery', role: 'QB', unit: 'OFFENSE', scheme: 'Spread', live: false, rating: 61, effect: 0.84, annual: 900_000, years: 2 },
  { id: 'ol', name: 'Sam Okafor', role: 'OL', unit: 'OFFENSE', scheme: 'Pro Style', live: false, rating: 46, effect: 0.84, annual: 750_000, years: 1 },
  { id: 'dc', name: 'Chris Barnett', role: 'DC', unit: 'DEFENSE', scheme: '4-3 Base', live: true, rating: 48, effect: -4.5, annual: 2_000_000, years: 2 },
  { id: 'dl', name: 'Andre Vos', role: 'DL', unit: 'DEFENSE', scheme: '4-2-5 Nickel', live: false, rating: 72, effect: 0.84, annual: 800_000, years: 3 },
  { id: 'db', name: 'Lou Marchetti', role: 'DB', unit: 'DEFENSE', scheme: '3-4 Base', live: false, rating: 45, effect: 0.84, annual: 700_000, years: 1 },
  { id: 'st', name: 'Pete Kowalski', role: 'ST', unit: 'SPECIAL TEAMS', scheme: 'West Coast', live: false, rating: 84, effect: 0, annual: 1_100_000, years: 4 },
]

function Section({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-line pt-5">
      <SectionTitle>{title}</SectionTitle>
      {note && <p className="-mt-2 text-small text-muted">{note}</p>}
      {children}
    </section>
  )
}

function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-3', className)}>{children}</div>
}

function Gallery({ id }: { id: string }) {
  const [tab, setTab] = useState<'staff' | 'market'>('staff')
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [filters, setFilters] = useState({ live: true, vacant: false, elite: false })
  const [option, setOption] = useState('balanced')
  const [confirm, setConfirm] = useState(false)
  const [dialog, setDialog] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [log, setLog] = useState('—')
  const sel = STAFF.find((s) => s.id === selected) ?? null

  const columns: Column<StaffRow>[] = [
    { key: 'name', label: 'Coach', sortValue: (r) => r.name, render: (r) => <span className="font-600">{r.name}</span>, card: 'title' },
    { key: 'role', label: 'Role', render: (r) => r.role, card: 'meta' },
    {
      key: 'scheme',
      label: 'Scheme',
      render: (r) => (
        <SchemeChip
          scheme={r.scheme}
          state={r.live ? 'live' : r.unit === 'SPECIAL TEAMS' ? 'na' : 'off'}
          against={r.unit === 'OFFENSE' ? 'OC' : 'DC'}
        />
      ),
    },
    {
      key: 'effect',
      label: 'Effect',
      align: 'right',
      sortValue: (r) => r.effect,
      render: (r) =>
        r.live ? (
          <Effect value={r.effect} kind="edge" clamp="floor" />
        ) : r.unit === 'SPECIAL TEAMS' ? (
          <span className="text-muted">—</span>
        ) : (
          <Effect value={r.effect} kind="mult" />
        ),
    },
    { key: 'rating', label: 'Rating', align: 'right', sortValue: (r) => r.rating, render: (r) => <RatingTile value={r.rating} size="sm" />, card: 'aside' },
    { key: 'delta', label: 'Δ vs avg', align: 'right', sortValue: (r) => r.rating - 74, render: (r) => <Delta value={r.rating - 74} /> },
    { key: 'contract', label: 'Contract', align: 'right', sortValue: (r) => r.annual, render: (r) => <span>{`$${(r.annual / 1e6).toFixed(1)}M × ${r.years}y`}</span> },
    {
      key: 'more',
      label: '',
      card: 'aside',
      render: (r) => (
        <OverflowMenu
          size="sm"
          label={`Actions for ${r.name}`}
          items={[
            { id: 'view', label: 'View readout', icon: <Eye size={16} />, onSelect: () => setSelected(r.id) },
            { id: 'find', label: `Find a better ${r.role}`, description: 'Market pre-filtered to 52+, live scheme first', icon: <UserSearch size={16} />, onSelect: () => setLog(`find ${r.role}`) },
            { id: 'let', label: 'Recommend letting go…', description: 'Opens a review with the remaining contract', icon: <UserMinus size={16} />, danger: true, onSelect: () => setConfirm(true) },
          ]}
        />
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Club"
        title="Staff & Hiring"
        subtitle="PageHeader: accent eyebrow with skewed bar, 40px italic title (28px on phone)."
        right={
          <SegmentedControl
            label="View"
            value={view}
            onChange={setView}
            options={[
              { id: 'chart', label: 'Chart', icon: <LayoutGrid size={14} aria-hidden /> },
              { id: 'table', label: 'Table', icon: <Table2 size={14} aria-hidden /> },
            ]}
          />
        }
      />
      <Tabs
        label="Staff sections"
        value={tab}
        onChange={setTab}
        idBase={`${id}-tabs`}
        tabs={[
          { id: 'staff', label: 'My Staff', count: '10/11' },
          { id: 'market', label: 'Hiring Market', count: 24 },
        ]}
      />
      <AccessBanner area="staff" level="advise" message={<><b className="font-600 text-ink">At your rung the GM makes staff moves.</b> Actions send a recommendation.</>} action={{ label: 'What can I do?', onClick: () => setLog('access help') }} />

      <Section title="Rating tiles" note="Elite / Pro Bowl / Starter / Rotation are fills; Depth, Weak and Liability are outlines (no red walls). Pips repeat the tier.">
        <TierLegend />
        <Row>
          {SAMPLE_RATINGS.map((v) => (
            <RatingTile key={`lg${v}`} value={v} size="lg" tierWord />
          ))}
        </Row>
        <Row>
          {SAMPLE_RATINGS.map((v) => (
            <RatingTile key={`md${v}`} value={v} size="md" />
          ))}
        </Row>
        <Row>
          {SAMPLE_RATINGS.map((v) => (
            <RatingTile key={`sm${v}`} value={v} size="sm" pips />
          ))}
        </Row>
        <Row>
          <RatingTile value={57} size="lg" tierWord delta label="Staff rating" />
          <RatingTile value={48} size="md" tierWord delta label="Staff rating" />
          <RatingTile value={66} size="sm" college label="Grade" />
        </Row>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <div className="label mb-2">Legacy exports (same props)</div>
            <Row>
              <OvrBadge value={84} pot={91} />
              <OvrBadge value={57} pot={68} size={30} />
              <OvrBadge value={45} />
              <RookieRangeBadges now={[64, 69]} ceiling={[80, 88]} />
              <RookieRangeBadges now={[48, 55]} ceiling={[58, 66]} compact />
              <DevBadge dev="X-Factor" />
              <DevBadge dev="Superstar" />
              <DevBadge dev="Star" />
              <DevBadge dev="Starter" />
              <DevBadge dev="Depth" />
            </Row>
          </Card>
          <Card>
            <div className="label mb-2">RatingBar (segments use the value's tier)</div>
            <div className="space-y-2">
              {[91, 77, 55, 44].map((v) => (
                <RatingBar key={v} value={v} segments={10} height={8} />
              ))}
              <RatingBar value={62} tone="tier" />
              <RatingBar value={62} />
            </div>
          </Card>
        </div>
      </Section>

      <Section title="KPI strip" note="Neutral values; colour only in the verdict chip and the meter.">
        <KpiStrip columns="1fr 1.25fr 1.45fr 1.35fr 1.1fr" label="Staff KPIs">
          <KpiTile label="Staff" value="10" unit="of 11" why={<>0 elite (90+) · 1 vacant: Analytics</>} />
          <KpiTile label="Staff rating" value="49" verdict={{ label: 'Poor staff', tone: 'warn' }} why="Average of 10 coaches">
            <TierScale value={49} label="Staff rating" />
          </KpiTile>
          <KpiTile
            label="On-field impact"
            value={'−9.0'}
            unit="pts / snap"
            verdict={{ label: 'At the floor', tone: 'loss' }}
            why="OFF −4.5 + DEF −4.5. A coordinator rated 52+ is the first hire that moves it."
            aside={
              <HoverCard label="How the edge is clamped" content={<p className="text-small">Each unit edge is clamped to −4.5…+4.5; both sit on the floor.</p>}>
                <span className="sr-only">Edge details</span>
              </HoverCard>
            }
          >
            <DivergingMeter value={-9} min={-9} max={9} floor={-9} label="On-field impact" />
          </KpiTile>
          <KpiTile label="Development" value="×0.84" verdict={{ label: '16% slower', tone: 'warn' }} why="Avg of 4 position coaches, applied to every player; floor ×0.80">
            <DivergingMeter value={0.84} min={0.8} max={1.2} mid={1} floor={0.8} format={(n) => `×${n.toFixed(2)}`} label="Development multiplier" />
          </KpiTile>
          <KpiTile label="Payroll" value="$20.3M" why="Budget is advisory">
            <BudgetMeter used={20_300_000} total={35_400_000} />
          </KpiTile>
        </KpiStrip>
        <Row>
          <Stat label="Legacy Stat" value={42} sub="still compiles" />
          <Stat label="Toned" value="5–2" tone="win" />
        </Row>
      </Section>

      <Section title="Values: Delta, Effect, Money, Scheme">
        <Row>
          <Delta value={-17} suffix="vs avg" />
          <Effect value={-2.0} label="situational" />
          <Effect value={-4.5} clamp="floor" unit="edge" />
          <Effect value={0.84} kind="mult" label="feeds program" />
          <Effect value={1.5} />
          <Effect value={-3_000_000} kind="money" goodWhen="down" label="cap hit" />
        </Row>
        <Row>
          <Money value={6_600_000} />
          <Money value={4_200_000} sign tone="freed" />
          <Money value={-1_800_000} tone="cost" />
          <Money value={-250_000} tone="auto" />
        </Row>
        <Row>
          <SchemeChip scheme="West Coast" state="live" />
          <SchemeChip scheme="4-3 Base" state="match" />
          <SchemeChip scheme="RPO Heavy" state="off" against="OC" />
          <SchemeChip scheme="West Coast" state="na" />
        </Row>
      </Section>

      <Section title="Buttons & controls" note="Slab is the one CTA per view; destructive (solid red) appears only inside ConfirmSheet. Legacy variants still compile.">
        <Row>
          <Button variant="slab" icon={<ArrowRight size={16} aria-hidden />}>Advance week</Button>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="quiet">Quiet</Button>
          <Button variant="destructive">Destructive (confirm only)</Button>
          <Button
            variant="secondary"
            loading={loading}
            onClick={() => {
              setLoading(true)
              window.setTimeout(() => setLoading(false), 1200)
            }}
          >
            Loading state
          </Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
        </Row>
        <Row>
          <span className="label">Legacy:</span>
          <Button>default</Button>
          <Button variant="ghost">ghost</Button>
          <Button variant="team">team</Button>
          <Button variant="danger">danger</Button>
          <Button size="sm" variant="primary">
            sm
          </Button>
          <Button size="lg" variant="primary">
            lg
          </Button>
        </Row>
        <Row>
          <IconButton label="Search (⌘K)">
            <Search size={18} />
          </IconButton>
          <IconButton label="Inbox" dot>
            <BarChart3 size={18} />
          </IconButton>
          <IconButton label="Compact view" variant="ghost" pressed>
            <Table2 size={18} />
          </IconButton>
          <OverflowMenu
            items={[
              { id: 'a', label: 'View readout', icon: <Eye size={16} />, onSelect: () => setLog('view') },
              { id: 'b', label: 'Find a better OC', description: 'Market pre-filtered to 52+, West Coast first', icon: <UserSearch size={16} />, onSelect: () => setLog('find') },
              { id: 'c', label: 'Recommend letting go…', description: '$6.6M remains on his deal', icon: <UserMinus size={16} />, danger: true, onSelect: () => setConfirm(true) },
            ]}
          />
          <DensityToggle />
          <ThemeToggle />
        </Row>
        <Row>
          <FilterChip pressed={filters.live} onChange={(v) => setFilters((f) => ({ ...f, live: v }))}>
            Live scheme
          </FilterChip>
          <FilterChip pressed={filters.vacant} onChange={(v) => setFilters((f) => ({ ...f, vacant: v }))} count={1}>
            Vacant seats
          </FilterChip>
          <FilterChip pressed={filters.elite} onChange={(v) => setFilters((f) => ({ ...f, elite: v }))}>
            Elite 90+
          </FilterChip>
        </Row>
        <OptionGroup label="Practice focus" className="sm:grid-cols-3">
          {[
            { id: 'balanced', t: 'Balanced', d: 'No bias; standard fatigue.' },
            { id: 'install', t: 'Install', d: 'Faster scheme familiarity.', m: '+2 fam' },
            { id: 'recovery', t: 'Recovery', d: 'Lower injury risk this week.', m: '−8% inj' },
          ].map((o) => (
            <OptionCard key={o.id} selected={option === o.id} onSelect={() => setOption(o.id)} title={o.t} description={o.d} meta={o.m} />
          ))}
        </OptionGroup>
        <p className="text-small text-muted">
          Last menu action: <b className="text-ink">{log}</b>
        </p>
      </Section>

      <Section title="Access gating" note="decide → action; advise → Recommend…; view / locked → disabled with a visible reason.">
        <div className="grid gap-2">
          {(['decide', 'advise', 'view', 'locked'] as const).map((lv) => (
            <Row key={lv}>
              <span className="label w-16">{lv}</span>
              <GatedAction area="staff" level={lv} label="Hire" adviseLabel="Recommend hire…" onDecide={() => setLog(`hire (${lv})`)} />
            </Row>
          ))}
        </div>
        <AccessBanner area="trades" level="view" />
      </Section>

      <Section title="Overlays">
        <Row>
          <Button variant="secondary" onClick={() => setConfirm(true)}>
            ConfirmSheet
          </Button>
          <Button variant="secondary" onClick={() => setDialog(true)}>
            Dialog
          </Button>
          <Button variant="secondary" onClick={() => setSheet(true)}>
            Sheet
          </Button>
          <HoverCard label="Details for Reggie Dawson" content={<div className="space-y-1"><b>Reggie Dawson</b><p className="text-muted">OC · West Coast · 53 Weak</p></div>}>
            <span className="font-600">HoverCard trigger</span>
          </HoverCard>
        </Row>
      </Section>

      <Section title="People, seats, cards">
        <Row>
          <Avatar name="Miles Nakamura" />
          <Avatar name="Reggie Dawson" size={40} ring="line" />
          <Badge>neutral</Badge>
          <Badge tone="team">team</Badge>
          <Badge tone="win">win</Badge>
          <Badge tone="warn">warn</Badge>
          <Badge tone="loss">loss</Badge>
          <Badge tone="gold">gold</Badge>
          <Badge tone="info">info</Badge>
          <Chip>Chip</Chip>
        </Row>
        <VacantSeat role="Analytics" consequence="No analytics read on 4th-down and 2-pt calls" action={{ label: 'Recommend a hire', onClick: () => setLog('vacant') }} />
        <div className="grid gap-3 md:grid-cols-3">
          <Card>Base card · surface, line, shadow-1, 10px radius.</Card>
          <Card tier="feature">Feature card · team slab block on the left.</Card>
          <Card tier="call" callLabel="Needs a call">
            Needs-a-call card · 2px warn edge.
          </Card>
        </div>
      </Section>

      <Section title="ScoreBlock">
        <Row>
          <ScoreBlock team={NFL_TEAMS[6]} score={24} hasBall timeouts={2} />
          <ScoreBlock team={NFL_TEAMS[7]} score={17} align="right" timeouts={3} />
          <ScoreBlock team={NFL_TEAMS[13]} sub="5–2" size="sm" />
        </Row>
        <Scoreline away={NFL_TEAMS[6]} home={NFL_TEAMS[13]} awayScore={24} homeScore={27} status="FINAL" size="lg" className="max-w-xl" />
        <Scoreline away={NFL_TEAMS[7]} home={NFL_TEAMS[6]} awaySub="6–1" homeSub="5–2" status="WK 9 · SUN" className="max-w-md" />
      </Section>

      <Section title="DataTable + Inspector" note="Grouped rows, sticky column, aria-sort, J/K + Enter, '.' opens ⋯, pips; card rows under 640px. Select a row: inspector column ≥1280px, sheet below.">
        <WithInspector
          open={!!sel}
          inspector={
            <Inspector
              open={!!sel}
              onClose={() => setSelected(null)}
              eyebrow={sel?.role}
              title={sel?.name ?? ''}
              actions={<GatedAction area="staff" level="advise" label="Let go" adviseLabel="Recommend letting go…" onDecide={() => setConfirm(true)} />}
            >
              {sel && (
                <div className="space-y-3">
                  <RatingTile value={sel.rating} size="lg" tierWord delta label="Staff rating" />
                  <TierScale value={sel.rating} />
                  <p className="text-small text-ink-2">What he does: sets the {sel.unit.toLowerCase()} {sel.live ? 'play-calling' : 'position development'}.</p>
                  <Money value={sel.annual * sel.years} />
                </div>
              )}
            </Inspector>
          }
        >
          <DataTable
            label="Coaching staff"
            rows={STAFF}
            columns={columns}
            rowKey={(r) => r.id}
            onRowClick={(r) => setSelected(r.id)}
            selectedKey={selected}
            groupBy={(r) => r.unit}
            groupLabel={(g) => (g === 'OFFENSE' ? 'Offense · System: West Coast' : g === 'DEFENSE' ? 'Defense · System: 4-3 Base' : 'Special teams · no scheme effect')}
            pipsFor={(r) => r.rating}
            rank
            maxHeight="none"
          />
        </WithInspector>
      </Section>

      <ConfirmSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false)
          setLog('confirmed let go')
        }}
        eyebrow="Recommend · Staff"
        title="Let go Reggie Dawson?"
        subtitle="Offensive coordinator · West Coast · 53 Weak"
        consequences={[
          { label: 'Remaining contract', value: '$6.6M (3 yr)' },
          { label: 'Seat', value: 'Vacant until hired', tone: 'warn' },
          { label: 'Offense edge', value: '−4.5 → −4.5 (already at floor)' },
          { label: 'Who decides', value: 'GM (you recommend)' },
        ]}
        saferAlternative={{ label: 'Find a replacement first', onClick: () => { setConfirm(false); setLog('safer: find replacement') } }}
        confirmLabel="Recommend letting go"
        accessNote="Sent to the GM as a recommendation"
      />
      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        eyebrow="Dialog"
        title="Contract preview"
        subtitle="Centred on desktop, a bottom sheet under 640px."
        footer={
          <>
            <Button variant="quiet" onClick={() => setDialog(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setDialog(false)}>
              Save
            </Button>
          </>
        }
      >
        <p className="text-ink-2">Focus is trapped here; Esc closes; focus returns to the trigger.</p>
        <label className="mt-3 block">
          <span className="label">Years</span>
          <input className="mt-1 h-11 w-full rounded-[var(--r-md)] border border-line-strong bg-surface px-3 text-[16px] text-ink" defaultValue={3} />
        </label>
      </Dialog>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Filters (3)" footer={<Button variant="primary" size="lg" onClick={() => setSheet(false)}>Show 24 coaches</Button>}>
        <Row>
          <FilterChip pressed={filters.live} onChange={(v) => setFilters((f) => ({ ...f, live: v }))}>
            Live scheme
          </FilterChip>
          <FilterChip pressed={filters.elite} onChange={(v) => setFilters((f) => ({ ...f, elite: v }))}>
            Elite 90+
          </FilterChip>
        </Row>
      </Sheet>
    </div>
  )
}

export default function KitShowcase() {
  const theme = useResolvedTheme()
  const [abbr, setAbbr] = useState('CLE')
  const team = NFL_TEAMS.find((t) => t.abbr === abbr) ?? NFL_TEAMS[0]

  useLayoutEffect(() => {
    const el = document.documentElement
    for (const [k, v] of Object.entries(rootTeamVars(team.primary, team.secondary, theme))) el.style.setProperty(k, v)
    return () => {
      for (const k of TEAM_VAR_NAMES) el.style.removeProperty(k)
    }
  }, [team.primary, team.secondary, theme])

  return (
    <div className="min-h-full bg-canvas text-ink">
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3 sm:px-8">
        <div className="font-display text-[20px] font-800 italic uppercase leading-none">
          Gridiron <span className="text-[var(--team-accent-text)]">Kit</span>
        </div>
        <SegmentedControl
          label="Club"
          size="sm"
          value={['CLE', 'PIT', 'KC'].includes(abbr) ? abbr : 'other'}
          onChange={(v) => v !== 'other' && setAbbr(v)}
          options={[
            { id: 'CLE', label: 'CLE' },
            { id: 'PIT', label: 'PIT' },
            { id: 'KC', label: 'KC' },
            { id: 'other', label: 'Other' },
          ]}
        />
        <label className="flex items-center gap-2">
          <span className="label">Club</span>
          <select
            value={abbr}
            onChange={(e) => setAbbr(e.target.value)}
            className="h-9 rounded-[var(--r-md)] border border-line-strong bg-surface px-2 text-[16px] text-ink sm:text-small"
          >
            {NFL_TEAMS.map((t) => (
              <option key={t.abbr} value={t.abbr}>
                {t.abbr} · {t.name}
              </option>
            ))}
          </select>
        </label>
        <div className="w-full sm:ml-auto sm:w-56">
          <ThemeToggle />
        </div>
        <a href="#" className="font-cond text-small font-700 uppercase tracking-[0.06em] text-brand">
          ← Back to the game
        </a>
      </header>
      <main className="mx-auto max-w-[1500px] space-y-10 p-4 sm:p-8">
        <div>
          <div className="label mb-3">App theme ({theme})</div>
          <Gallery id="app" />
        </div>
        <div className="broadcast rounded-[var(--r-lg)] bg-canvas p-4 sm:p-6">
          <div className="label mb-3">.broadcast scope (always dark)</div>
          <Gallery id="bc" />
        </div>
        <Section
          title="Broadcast field (2.5D, B2)"
          note="Canvas renderer: perspective camera, field, stands and LED ribbons, LOS + first-down line on the turf. Sample: 3rd & 6 at the opponent 38; the club picker is the home club. Drift stops under reduced motion."
        >
          <Suspense fallback={<div className="label">Loading broadcast field…</div>}>
            <BroadcastFieldPreview homeId={team.id} />
          </Suspense>
        </Section>
      </main>
    </div>
  )
}

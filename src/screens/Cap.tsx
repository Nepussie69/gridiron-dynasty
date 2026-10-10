import { useMemo, useState } from 'react'
import { FileText, Handshake, Lock } from 'lucide-react'
import { cn } from '../lib/cn'
import { MINUS, money } from '../lib/format'
import { capSavings, deadMoney, remainingContractValue, restructure } from '../game/engine/cap'
import { canSignFreeAgents } from '../game/engine/career'
import { useAccessLevel } from '../ui/hooks'
import { capVerdict } from '../ui/nav'
import { capabilities } from '../game/engine/capabilities'
import { canFileMemo, spaceBucket, type SpaceBucket } from '../game/engine/capMemo'
import { canAskGm, gmAskCovers } from '../game/engine/gmAsk'
import { monthKeyOf } from '../game/engine/gmDesk'
import { capSummary } from '../game/selectors'
import { useGame, useWorld } from '../store/gameStore'
import type { Player, Position } from '../game/types'
import {
  AccessBanner,
  Badge,
  Button,
  Card,
  ConfirmSheet,
  FilterChip,
  KpiStrip,
  KpiTile,
  OverflowMenu,
  PageHeader,
  RatingBar,
  SectionTitle,
  TierNumber,
  type Consequence,
  type MenuItem,
} from '../ui/kit'
import { DataTable, type Column } from '../components/DataTable'
import { ExtensionTalks } from '../components/ExtensionTalks'
import { ContractExplainer } from '../components/ContractExplainer'
import { GmRestructureRequest } from '../components/GmRestructureRequest'
import { CapPlanner } from '../components/CapPlanner'
import { ContractLifeCard } from '../components/ContractLifeCard'

const CAP_TEXT: Record<'win' | 'neutral' | 'warn' | 'loss', string> = {
  win: 'text-win',
  neutral: 'text-ink-2',
  warn: 'text-warn',
  loss: 'text-loss',
}

// Money below this reads as "no meaningful change" and shows a muted $0.
const FREED_EPSILON = 50_000
/** Signed cap-space-freed money with a real minus sign; muted "$0" near zero. */
function freedMoney(n: number) {
  if (Math.abs(n) < FREED_EPSILON) return money(0)
  return `${n > 0 ? '+' : MINUS}${money(Math.abs(n))}`
}
function freedTone(n: number) {
  if (Math.abs(n) < FREED_EPSILON) return 'text-muted'
  return n > 0 ? 'text-win' : 'text-warn'
}

// L11.5 Q9: cap allocation is grouped by position family, in this order.
const POSITION_GROUPS: { label: string; positions: Position[] }[] = [
  { label: 'QB', positions: ['QB'] },
  { label: 'RB', positions: ['RB'] },
  { label: 'FB', positions: ['FB'] },
  { label: 'WR', positions: ['WR'] },
  { label: 'TE', positions: ['TE'] },
  { label: 'OL', positions: ['OT', 'OG', 'C'] },
  { label: 'DL', positions: ['DE', 'DT'] },
  { label: 'LB', positions: ['LB'] },
  { label: 'CB', positions: ['CB'] },
  { label: 'S', positions: ['S'] },
  { label: 'K/P', positions: ['K', 'P'] },
]

type Pending = { kind: 'restructure' | 'extend' | 'cut'; player: Player }

export function Cap() {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const restructurePlayer = useGame((s) => s.restructurePlayer)
  const releasePlayer = useGame((s) => s.releasePlayer)
  const extendPlayer = useGame((s) => s.extendPlayer)
  const [talkId, setTalkId] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const level = useAccessLevel('cap')

  const summary = capSummary(league, career.teamId)
  const roster = league.roster[career.teamId] ?? []
  const canMove = canSignFreeAgents(career)
  const canNegotiate = capabilities(career).can.has('negotiate')

  // Ledger default order: biggest cap hits first. (Kept as a memo; `roster` is a
  // freshly built array each render, so it swallows the deps lint the same way
  // the original did.)
  const contracts = useMemo(() => [...roster].sort((a, b) => b.contract.capHit - a.contract.capHit), [roster])

  const capV = capVerdict(summary.space)

  const openTalk = (p: Player) => {
    if (canNegotiate) setTalkId(p.id)
    else setPending({ kind: 'extend', player: p })
  }

  const menuFor = (p: Player): MenuItem[] => [
    {
      id: 'restructure',
      label: 'Restructure…',
      description: 'Convert base to bonus; opens a review of the year-one saving',
      onSelect: () => setPending({ kind: 'restructure', player: p }),
    },
    {
      id: 'extend',
      label: 'Extend…',
      description:
        canNegotiate && p.contract.years > 2
          ? 'Only players with two or fewer years left'
          : canNegotiate
            ? 'Open extension talks'
            : 'Review a market extension',
      disabled: canNegotiate && p.contract.years > 2,
      onSelect: () => openTalk(p),
    },
    {
      id: 'cut',
      label: 'Cut…',
      description: `Frees ${freedMoney(capSavings(p.contract))} this year`,
      danger: true,
      onSelect: () => setPending({ kind: 'cut', player: p }),
    },
  ]

  const pendingView = (pd: Pending): { title: string; subtitle: string; confirm: string; consequences: Consequence[]; onConfirm: () => void } => {
    const c = pd.player.contract
    if (pd.kind === 'restructure') {
      const next = restructure(c)
      const saving = c.capHit - next.capHit
      return {
        title: `Restructure ${pd.player.name}?`,
        subtitle: `${pd.player.pos} · ${money(c.capHit)} cap hit · converts base salary to signing bonus`,
        confirm: `Restructure · saves ${money(saving)}`,
        consequences: [
          { label: 'Cap hit this year', value: `${money(c.capHit)} → ${money(next.capHit)}`, tone: 'win' },
          { label: 'Space freed this year', value: money(saving), tone: 'win' },
          { label: 'Added void years', value: `${c.voidYears} → ${next.voidYears}` },
          { label: 'Dead money if cut later', value: money(deadMoney(next)), tone: 'warn' },
        ],
        onConfirm: () => restructurePlayer(pd.player.id),
      }
    }
    if (pd.kind === 'extend') {
      return {
        title: `Extend ${pd.player.name}?`,
        subtitle: `${pd.player.pos} · age ${pd.player.age} · adds years at market`,
        confirm: 'Extend at market',
        consequences: [
          { label: 'Current deal', value: `${money(c.annual)}/yr · ${c.years} yr left` },
          { label: 'Market ask', value: `${money(c.annual)} → market`, tone: 'warn' },
          { label: 'Dead money now', value: money(deadMoney(c)) },
          { label: 'Void years', value: c.voidYears },
        ],
        onConfirm: () => extendPlayer(pd.player.id),
      }
    }
    const saving = capSavings(c)
    const after = summary.space + saving
    return {
      title: `Cut ${pd.player.name}?`,
      subtitle: `${pd.player.pos} · age ${pd.player.age} · ${c.years} yr${c.years === 1 ? '' : 's'} left`,
      confirm: `Cut · ${freedMoney(saving)}`,
      consequences: [
        { label: 'Cap freed this year', value: freedMoney(saving), tone: saving >= 0 ? 'win' : 'warn' },
        { label: 'Dead money accelerated', value: money(deadMoney(c)), tone: 'warn' },
        { label: 'Remaining contract', value: money(remainingContractValue(c)) },
        { label: 'Void years', value: c.voidYears },
        { label: 'Cap space', value: `${money(summary.space)} → ${money(after)}`, tone: after < 0 ? 'loss' : undefined },
        { label: 'Roster spot', value: 'Opens one spot', tone: 'win' },
      ],
      onConfirm: () => releasePlayer(pd.player.id),
    }
  }

  const columns: Column<Player>[] = [
    {
      key: 'name',
      label: 'Player',
      card: 'title',
      sortValue: (p) => p.name,
      render: (p) => <span className="block min-w-0 font-600 text-ink">{p.name}</span>,
    },
    {
      key: 'pos',
      label: 'Pos',
      card: 'meta',
      sortValue: (p) => p.pos,
      render: (p) => <span className="font-cond text-label font-700 uppercase text-muted">{p.pos}</span>,
    },
    { key: 'age', label: 'Age', align: 'right', card: 'value', sortValue: (p) => p.age, render: (p) => <span className="tnum text-ink-2">{p.age}</span> },
    {
      key: 'ovr',
      label: 'OVR',
      align: 'right',
      card: 'value',
      headerTitle: 'Overall (neutral number; see the tier pips on the player column)',
      sortValue: (p) => p.ovr,
      render: (p) => <TierNumber value={p.ovr} />,
    },
    { key: 'pot', label: 'POT', align: 'right', card: 'value', sortValue: (p) => p.pot, render: (p) => <span className="tnum text-muted">{p.pot}</span> },
    {
      key: 'capHit',
      label: 'Cap hit',
      align: 'right',
      card: 'value',
      sortValue: (p) => p.contract.capHit,
      render: (p) => <span className="font-600 text-ink tnum">{money(p.contract.capHit)}</span>,
    },
    { key: 'annual', label: 'AAV', align: 'right', card: 'value', sortValue: (p) => p.contract.annual, render: (p) => <span className="tnum text-ink-2">{money(p.contract.annual)}</span> },
    { key: 'guaranteed', label: 'Guaranteed', align: 'right', card: 'value', sortValue: (p) => p.contract.guaranteed, render: (p) => <span className="tnum text-muted">{money(p.contract.guaranteed)}</span> },
    { key: 'years', label: 'Yrs', align: 'right', card: 'value', sortValue: (p) => p.contract.years, render: (p) => <span className="tnum text-ink-2">{p.contract.years}</span> },
    {
      key: 'dead',
      label: 'Dead $',
      align: 'right',
      card: 'value',
      headerTitle: 'Dead money if released now (accelerated bonus plus guaranteed base)',
      sortValue: (p) => deadMoney(p.contract),
      render: (p) => {
        const dead = deadMoney(p.contract)
        return <span className={cn('tnum', dead > p.contract.capHit ? 'text-warn' : 'text-muted')}>{money(dead)}</span>
      },
    },
    {
      key: 'freed',
      label: 'Cap freed',
      align: 'right',
      card: 'value',
      headerTitle: 'Cap space freed this season if released now (cap hit − dead money). Negative = releasing costs cap space.',
      sortValue: (p) => capSavings(p.contract),
      render: (p) => <span className={cn('font-600 tnum', freedTone(capSavings(p.contract)))}>{freedMoney(capSavings(p.contract))}</span>,
    },
    {
      key: 'pct',
      label: '% cap',
      align: 'right',
      card: 'value',
      headerTitle: 'Share of the fixed cap',
      sortValue: (p) => p.contract.capHit,
      render: (p) => {
        const pct = (p.contract.capHit / summary.limit) * 100
        return (
          <span className="inline-flex items-center gap-2">
            <span className="w-12">
              <RatingBar value={pct} max={100} color="var(--color-ink-2)" height={5} label="Share of the cap" />
            </span>
            <span className="tnum text-muted">{pct.toFixed(1)}%</span>
          </span>
        )
      },
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      card: 'aside',
      render: (p) =>
        canMove ? (
          <OverflowMenu items={menuFor(p)} label={`Contract actions for ${p.name}`} size="sm" />
        ) : (
          <GmCapRowActions player={p} />
        ),
    },
  ]

  return (
    <div>
      <PageHeader
        eyebrow="Club"
        title="Salary Cap"
        subtitle="Every dollar is a decision. Restructure to win now, or clear the books for tomorrow."
        right={
          <div className="flex items-center gap-2">
            <Badge tone="neutral">2025 cap · fixed</Badge>
            <Badge tone={summary.overTheCap ? 'loss' : summary.meetsFloor ? 'win' : 'warn'}>
              {summary.overTheCap ? 'Over the cap' : summary.meetsFloor ? 'Cap compliant' : 'Below the floor'}
            </Badge>
          </div>
        }
      />

      <AccessBanner
        area="cap"
        className="mb-4"
        message={
          level === 'advise' ? (
            <>
              <b className="font-600 text-ink">The cap is the GM&apos;s department at your rung.</b> Review the books and
              shape the plan — the GM makes the final call on contracts. Ask him to restructure or cut from the ledger.
            </>
          ) : undefined
        }
      />

      <CapMemoCard className="mb-4" />

      <ContractLifeCard className="mb-4" />

      <KpiStrip label="Cap summary" columns="1.2fr 1fr 1fr 1fr" className="mb-4">
        <KpiTile
          label="Cap space"
          value={money(summary.space)}
          unit={`of ${money(summary.limit)}`}
          verdict={{ label: capV.label, tone: capV.tone }}
          why={
            <span className="text-muted">
              Limit {money(summary.limit)} · floor {money(summary.floor)}. Space is the limit minus every cap hit and all
              dead money.
            </span>
          }
        >
          <RatingBar value={Math.min(100, Math.max(0, (summary.used / summary.limit) * 100))} max={100} color={summary.overTheCap ? 'var(--color-loss)' : 'var(--color-ink-2)'} height={6} label="Cap used" />
        </KpiTile>
        <KpiTile
          label="Cap used"
          value={money(summary.used)}
          unit={`${Math.round((summary.used / summary.limit) * 100)}% of limit`}
          why={<span className="text-muted">Active contracts plus dead money against the fixed 2025 cap.</span>}
        />
        <KpiTile
          label="Dead money"
          value={money(summary.dead)}
          unit="accelerated"
          why={<span className="text-muted">Bonus already paid but not yet on the cap; charged the moment a deal ends.</span>}
        />
        <KpiTile
          label="Top-5 hits"
          value={money(summary.top5)}
          unit={`${Math.round((summary.top5 / Math.max(1, summary.used)) * 100)}% of payroll`}
          why={<span className="text-muted">Concentration in your five biggest deals — the cap risk if one goes wrong.</span>}
        />
      </KpiStrip>

      <CapPlanner className="mb-4" />

      <div className="mb-4 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle right={<span className="label">by position group</span>}>Cap Allocation</SectionTitle>
          <div className="space-y-2">
            {POSITION_GROUPS.map((g) => {
              const total = roster.filter((p) => g.positions.includes(p.pos)).reduce((s, p) => s + p.contract.capHit, 0)
              // One denominator everywhere: the fixed limit.
              const pct = (total / Math.max(1, summary.limit)) * 100
              return (
                <div key={g.label} className="flex items-center gap-3">
                  <span className="w-9 font-cond text-label font-700 uppercase text-muted">{g.label}</span>
                  <div className="flex-1">
                    <RatingBar value={pct} max={100} color="var(--color-ink-2)" height={10} label={`${g.label} share of the cap`} />
                  </div>
                  <span className="w-20 text-right font-cond text-small font-700 text-ink-2 tnum">{money(total)}</span>
                  <span className="w-12 text-right font-cond text-label text-muted tnum">{pct.toFixed(1)}%</span>
                </div>
              )
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2 text-label text-muted">
            {(['OFF', 'DEF', 'ST'] as const).map((side) => {
              const total = roster.filter((p) => p.side === side).reduce((s, p) => s + p.contract.capHit, 0)
              return (
                <span key={side} className="font-cond font-700 uppercase">
                  {side} <span className="text-ink-2">{money(total)}</span>
                </span>
              )
            })}
            <span className="ml-auto">Percentages are of the {money(summary.limit)} cap.</span>
          </div>
        </Card>
        <Card>
          <SectionTitle>Cap Health</SectionTitle>
          <div className="space-y-3">
            <HealthRow
              label="Flexibility"
              value={Math.round(Math.max(8, Math.min(95, 50 + (summary.space / summary.limit) * 120)))}
              unit="/100 · higher is better"
              why="How much room you have left against the fixed cap; 50 is level with the league."
              good={summary.space >= 0}
            />
            <HealthRow
              label="Future commitments"
              value={Math.round(Math.min(95, (summary.used / summary.limit) * 100))}
              unit="% of the cap already committed"
              why="Share of this year's cap tied up in contracts; under 90% leaves room to work."
              good={summary.used / summary.limit < 0.9}
            />
            <HealthRow
              label="Dead-money load"
              value={Math.round(Math.min(95, (summary.dead / summary.limit) * 300))}
              unit="index · under 18 is healthy"
              why={`Dead money is ${Math.round((summary.dead / summary.limit) * 100)}% of the cap; below 6% keeps the index under 18.`}
              good={summary.dead / summary.limit < 0.06}
            />
          </div>
          <div className="mt-3 rounded-[var(--r-md)] bg-surface-2 p-3 text-small leading-relaxed text-muted">
            {summary.overTheCap
              ? 'You are over the cap. Restructure a veteran deal or cut a surplus contract before you can sign anyone.'
              : summary.space < 8e6
                ? 'Thin flexibility. Be careful with extensions.'
                : 'Healthy flexibility. You can absorb an extension or a deadline addition.'}
          </div>
        </Card>
      </div>

      <Card className="mb-4">
        <ContractExplainer player={contracts[0]} />
      </Card>

      <GmRestructureCard className="mb-4" />

      <Card pad={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <span className="label">Contract Ledger</span>
          <span className="flex items-center gap-2">
            <span className={cn('font-cond text-small font-700 uppercase tracking-wide', CAP_TEXT[capV.tone])}>
              {capV.label} · {money(summary.space)}
            </span>
            <Badge tone="neutral">{contracts.length} active · floor {money(summary.floor)}</Badge>
          </span>
        </div>
        <div className="p-1 sm:p-0">
          <DataTable
            label="Contract ledger"
            rows={contracts}
            columns={columns}
            rowKey={(p) => p.id}
            defaultSortKey="capHit"
            pipsFor={(p) => p.ovr}
            maxHeight="none"
            emptyText="No contracts on the books."
          />
        </div>
      </Card>

      {talkId && <ExtensionTalks key={talkId} playerId={talkId} onClose={() => setTalkId(null)} />}

      {pending && (
        <ConfirmSheet
          open
          onClose={() => setPending(null)}
          eyebrow="Contract move"
          title={pendingView(pending).title}
          subtitle={pendingView(pending).subtitle}
          destructive={pending.kind === 'cut'}
          confirmLabel={pendingView(pending).confirm}
          ledgerNote={null}
          consequences={pendingView(pending).consequences}
          onConfirm={() => {
            pendingView(pending).onConfirm()
            setPending(null)
          }}
        />
      )}
    </div>
  )
}

function HealthRow({
  label,
  value,
  unit,
  why,
  good,
}: {
  label: string
  value: number
  unit: string
  why: string
  good: boolean
}) {
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="font-cond text-small font-700 uppercase text-ink-2">{label}</span>
        <span className={cn('font-cond text-small font-700 tnum', good ? 'text-ink-2' : 'text-warn')}>{value}</span>
      </div>
      <RatingBar value={value} max={100} color={good ? 'var(--color-ink-2)' : 'var(--color-warn)'} label={label} />
      <div className="mt-1 text-label text-muted">
        {unit} · {why}
      </div>
    </div>
  )
}

/**
 * L12.14 C6: per-row GM requests on the Cap ledger. Coaching rungs that can't
 * touch contracts themselves ask the GM to extend or cut a player; both buttons
 * lock once he's been raised this month. Renders nothing for personnel rungs
 * (who restructure/extend/cut directly) or a coordinator's wrong side of the ball.
 */
function GmCapRowActions({ player }: { player: Player }) {
  const career = useGame((s) => s.career)!
  const league = useWorld()
  const askGmToExtend = useGame((s) => s.askGmToExtend)
  const requestGmRelease = useGame((s) => s.requestGmRelease)

  if (!canAskGm(career) || !gmAskCovers(career, player.pos)) return null

  const asked = career.gmRequestLog?.[player.id] === monthKeyOf(league.season, league.week)
  const eligibleExt = player.contract.years <= 2

  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
      <Button
        size="sm"
        variant="secondary"
        rowSafe
        disabled={asked || !eligibleExt}
        title={eligibleExt ? 'Ask the GM to extend him' : `${player.contract.years} years left — the GM only extends players with two or fewer.`}
        onClick={() => askGmToExtend(player.id)}
      >
        <Handshake size={12} /> {asked ? 'Asked' : 'Extend'}
      </Button>
      <Button size="sm" variant="secondary" rowSafe disabled={asked} title="Ask the GM to cut him" onClick={() => requestGmRelease(player.id)}>
        <Handshake size={12} /> {asked ? 'Asked' : 'Cut'}
      </Button>
    </span>
  )
}

/**
 * L12.14 C6: the team-level GM restructure request on the Cap screen. The coach
 * picks a named trade/FA target, then asks the GM to convert base to bonus on
 * 1–3 big deals to clear the cap need; the GM only does it while the club reads
 * as a contender. Personnel rungs restructure directly, so this renders nothing
 * for them.
 */
function GmRestructureCard({ className }: { className?: string }) {
  const league = useWorld()
  const career = useGame((s) => s.career)!

  if (!canAskGm(career)) return null

  return (
    <Card className={className}>
      <SectionTitle right={<Badge tone="info">Ask the GM</Badge>}>Ask the GM to restructure</SectionTitle>
      <p className="mb-3 mt-1 max-w-2xl text-small leading-relaxed text-muted">
        You shape the plan; the GM holds the pen. Name the target you want room for and he converts base to bonus on
        1–3 big deals — only while the club reads as a contender. He reports the space freed this year against the
        extra dead money pushed into later years.
      </p>
      <GmRestructureRequest />
      <p className="mt-3 text-label text-muted">
        Restructures only help for a specific, named move. An unnecessary one is refused.
      </p>
      {career.gmRestructureSeason === league.season && (
        <p className="mt-1 text-label text-muted">
          Restructure green-lit this season: a free-agent bid that doesn&apos;t fit will trigger one automatically.
        </p>
      )}
    </Card>
  )
}

const MEMO_BUCKETS: { id: SpaceBucket; label: string; sub: string }[] = [
  { id: 'tight', label: 'Tight', sub: 'under $5M' },
  { id: 'comfortable', label: 'Comfortable', sub: '$5–25M' },
  { id: 'flush', label: 'Flush', sub: 'over $25M' },
]

/**
 * G3: the 3-year cap memo.
 *
 * In the offseason a manageCap rung forecasts next season's year-end cap space,
 * names up to three priority extensions, and writes one sentence of intent. The
 * memo locks once filed. It grades a year later, so it shows as a locked plan
 * until then.
 */
function CapMemoCard({ className }: { className?: string }) {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const fileCapMemo = useGame((s) => s.fileCapMemo)
  const [bucket, setBucket] = useState<SpaceBucket>('comfortable')
  const [picked, setPicked] = useState<string[]>([])
  const [note, setNote] = useState('')

  if (!capabilities(career).can.has('manageCap')) return null

  const memo = career.capMemo
  const canFile = canFileMemo(league, career)
  const summary = capSummary(league, career.teamId)
  const roster = league.roster[career.teamId] ?? []
  const eligible = roster.filter((p) => p.contract.years <= 2)

  const togglePick = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 3 ? cur : [...cur, id]))

  // Locked: a memo for this offseason is already on file.
  if (!canFile) {
    if (!memo) return null
    return (
      <Card className={className}>
        <SectionTitle right={<Badge tone={memo.graded ? 'win' : 'info'}>{memo.graded ? 'Graded' : 'Filed'}</Badge>}>
          <span className="flex items-center gap-2">
            <Lock size={15} className="text-[var(--team-accent-text)]" aria-hidden /> Cap Memo
          </span>
        </SectionTitle>
        <p className="mb-3 text-small text-muted">
          Filed for {memo.filedSeason}. Graded at the end of {memo.filedSeason + 1}.
        </p>

        <div className="mb-3 rounded-[var(--r-md)] border border-line bg-surface-2 p-3">
          <div className="label">Forecast: next season&apos;s year-end space</div>
          <div className="font-display text-[20px] font-800 italic uppercase text-ink">
            {MEMO_BUCKETS.find((b) => b.id === memo.bucket)?.label ?? memo.bucket}
          </div>
        </div>

        <div className="mb-3">
          <div className="label mb-1.5">Priority extensions</div>
          {memo.priorities.length ? (
            <div className="space-y-1.5">
              {memo.priorities.map((pr) => {
                const p = roster.find((x) => x.id === pr.playerId)
                const extended = !!p && p.contract.signedThrough > pr.signedThrough
                return (
                  <div key={pr.playerId} className="flex items-center justify-between rounded-[var(--r-sm)] border border-line px-2.5 py-1.5">
                    <span className="truncate text-small font-600 text-ink">
                      {p ? `${p.name} · ${p.pos}` : 'Departed'}
                    </span>
                    <span className={cn('font-cond text-label font-700 uppercase', extended ? 'text-win' : p ? 'text-muted' : 'text-loss')}>
                      {extended ? 'Extended' : p ? 'Not extended' : 'Left club'}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-small text-muted">No priority extensions named.</p>
          )}
        </div>

        {memo.note && <p className="rounded-[var(--r-md)] bg-surface-2 p-3 text-small italic text-ink-2">&ldquo;{memo.note}&rdquo;</p>}
      </Card>
    )
  }

  // Open: the offseason form.
  return (
    <Card className={className}>
      <SectionTitle right={<Badge tone="neutral">Offseason</Badge>}>
        <span className="flex items-center gap-2">
          <FileText size={15} className="text-[var(--team-accent-text)]" aria-hidden /> Cap Memo
        </span>
      </SectionTitle>
      <p className="mb-3 text-small text-muted">
        Commit in public: forecast next season&apos;s year-end cap space and name up to three priority extensions. The
        memo locks once filed and grades a year from now.
      </p>

      <div className="mb-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="label">Forecast: next season&apos;s year-end space</span>
          <span className="font-cond text-label text-muted">
            today {money(summary.space)} · {spaceBucket(summary.space)}
          </span>
        </div>
        <div className="flex gap-1.5">
          {MEMO_BUCKETS.map((b) => (
            <button
              key={b.id}
              type="button"
              aria-pressed={bucket === b.id}
              onClick={() => setBucket(b.id)}
              className={cn(
                'motion flex-1 rounded-[var(--r-md)] border py-1.5 text-center',
                bucket === b.id ? 'border-line-strong bg-surface-3 text-ink' : 'border-line bg-surface-2 text-ink-2 hover:border-line-strong',
              )}
            >
              <span className="block font-cond text-small font-700 text-ink">{b.label}</span>
              <span className="block font-cond text-label font-700 uppercase text-muted">{b.sub}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="label">Priority extensions</span>
          <span className="font-cond text-label text-muted">
            {picked.length}/3 · {eligible.length} eligible
          </span>
        </div>
        {eligible.length ? (
          <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
            {eligible.map((p) => (
              <FilterChip key={p.id} pressed={picked.includes(p.id)} onChange={() => togglePick(p.id)}>
                {p.name}
                <span className="ml-1 font-600 text-muted tnum">
                  {p.pos} · {p.contract.years} yr{p.contract.years === 1 ? '' : 's'}
                </span>
              </FilterChip>
            ))}
          </div>
        ) : (
          <p className="text-small text-muted">No players are extension-eligible (2 years or fewer) right now.</p>
        )}
      </div>

      <div className="mb-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="label">Intent</span>
          <span className="font-cond text-label font-700 uppercase text-faint">{note.length}/120</span>
        </div>
        <input
          type="text"
          maxLength={120}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="One sentence: what this cap plan is for."
          className="w-full rounded-[var(--r-md)] border border-line-strong bg-surface-2 px-3 py-2 text-[16px] text-ink outline-none sm:text-small"
        />
      </div>

      <div className="flex items-center justify-end border-t border-line pt-3">
        <Button variant="primary" onClick={() => fileCapMemo(bucket, picked, note)}>
          File memo
        </Button>
      </div>
    </Card>
  )
}

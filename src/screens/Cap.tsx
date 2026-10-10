import { useMemo, useState } from 'react'
import { FileText, Handshake, Lock } from 'lucide-react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
import { capSavings, deadMoney } from '../game/engine/cap'
import { canSignFreeAgents } from '../game/engine/career'
import { accessFor } from '../game/engine/access'
import { capabilities } from '../game/engine/capabilities'
import { canFileMemo, spaceBucket, type SpaceBucket } from '../game/engine/capMemo'
import { canAskGm, gmAskCovers } from '../game/engine/gmAsk'
import { monthKeyOf } from '../game/engine/gmDesk'
import { capSummary } from '../game/selectors'
import { useGame, useWorld } from '../store/gameStore'
import type { Player } from '../game/types'
import { Badge, Button, Card, OvrBadge, PageHeader, RatingBar, Stat } from '../ui/kit'
import { ExtensionTalks } from '../components/ExtensionTalks'
import { ContractExplainer } from '../components/ContractExplainer'
import { GmRestructureRequest } from '../components/GmRestructureRequest'
import { CapPlanner } from '../components/CapPlanner'
import { ContractLifeCard } from '../components/ContractLifeCard'

type LedgerKey = 'name' | 'pos' | 'age' | 'ovr' | 'pot' | 'capHit' | 'annual' | 'guaranteed' | 'years' | 'dead' | 'freed' | 'pct'
const LEDGER_SORT: Record<LedgerKey, (p: Player) => number | string> = {
  name: (p) => p.name,
  pos: (p) => p.pos,
  age: (p) => p.age,
  ovr: (p) => p.ovr,
  pot: (p) => p.pot,
  capHit: (p) => p.contract.capHit,
  annual: (p) => p.contract.annual,
  guaranteed: (p) => p.contract.guaranteed,
  years: (p) => p.contract.years,
  dead: (p) => deadMoney(p.contract),
  freed: (p) => capSavings(p.contract),
  pct: (p) => p.contract.capHit,
}
const FREED_TITLE = 'Cap space freed this season if released now (cap hit \u2212 dead money). Negative = releasing costs cap space.'
// Money below this reads as "no meaningful change" and shows a muted $0.
const FREED_EPSILON = 50_000
/** Signed cap-space-freed money with a real minus sign; muted "$0" near zero. */
function freedMoney(n: number) {
  if (Math.abs(n) < FREED_EPSILON) return money(0)
  return `${n > 0 ? '+' : '\u2212'}${money(Math.abs(n))}`
}
function freedTone(n: number) {
  if (Math.abs(n) < FREED_EPSILON) return 'text-muted'
  return n > 0 ? 'text-win' : 'text-loss'
}
const LEDGER_COLS: [string, LedgerKey | null, string?][] = [
  ['Player', 'name'], ['Pos', 'pos'], ['Age', 'age'], ['OVR', 'ovr'], ['POT', 'pot'], ['Cap Hit', 'capHit'], ['AAV', 'annual'],
  ['Guaranteed', 'guaranteed'], ['Yrs', 'years'], ['Dead $', 'dead'], ['Cap Freed', 'freed', FREED_TITLE], ['% Cap', 'pct'], ['', null],
]
import type { Position } from '../game/types'

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

export function Cap() {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const restructurePlayer = useGame((s) => s.restructurePlayer)
  const releasePlayer = useGame((s) => s.releasePlayer)
  const extendPlayer = useGame((s) => s.extendPlayer)
  const [talkId, setTalkId] = useState<string | null>(null)

  const summary = capSummary(league, career.teamId)
  const roster = league.roster[career.teamId] ?? []
  const canMove = canSignFreeAgents(career)
  const canNegotiate = capabilities(career).can.has('negotiate')
  const access = accessFor(career, 'cap')
  // Sortable ledger: click a header to sort by it, click again to flip.
  const [sortKey, setSortKey] = useState<LedgerKey>('capHit')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)
  const contracts = useMemo(() => {
    const val = LEDGER_SORT[sortKey]
    return [...roster].sort((a, b) => {
      const x = val(a)
      const y = val(b)
      const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number)
      return c * sortDir || b.contract.capHit - a.contract.capHit
    })
  }, [roster, sortKey, sortDir])
  const sortBy = (k: LedgerKey) => {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1))
    else {
      setSortKey(k)
      // Text columns start A→Z, numbers start biggest first.
      setSortDir(k === 'name' || k === 'pos' ? 1 : -1)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow={`${league.byId[career.teamId].name} · ${league.season}`}
        title="Salary Cap"
        subtitle="Every dollar is a decision. Restructure to win now, or clear the books for tomorrow."
        right={<div className="flex items-center gap-2">
          <Badge tone="neutral">2025 cap · fixed</Badge>
          <Badge tone={summary.overTheCap ? 'loss' : summary.meetsFloor ? 'win' : 'warn'}>
            {summary.overTheCap ? 'Over the cap' : summary.meetsFloor ? 'Cap compliant' : 'Below the floor'}
          </Badge>
        </div>}
      />

      {!canMove && (
        <div className="mb-4 rounded-xl border border-warn/30 bg-warn-soft p-3 text-sm text-warn">
          {access === 'advise'
            ? 'The cap is the GM\u2019s department. You can review the books and shape the plan \u2014 the GM makes the final call on contracts.'
            : 'Contract moves unlock at Director of Player Personnel. You can review the books now.'}
        </div>
      )}

      <CapMemoCard className="mb-4" />

      <ContractLifeCard className="mb-4" />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <Stat label="Cap Space" value={money(summary.space)} tone={summary.space < 0 ? 'loss' : summary.space > 25e6 ? 'win' : undefined} sub={`Limit ${money(summary.limit)}`} />
          <div className="mt-3">
            <RatingBar value={(summary.used / summary.limit) * 100} color={summary.used > summary.limit ? '#dc2937' : '#05914f'} />
          </div>
        </Card>
        <Card><Stat label="Cap Used" value={money(summary.used)} sub={`${Math.round((summary.used / summary.limit) * 100)}% of limit`} /></Card>
        <Card><Stat label="Dead Money" value={money(summary.dead)} sub="accelerated charges" /></Card>
        <Card><Stat label="Top-5 Hits" value={money(summary.top5)} sub={`${Math.round((summary.top5 / Math.max(1, summary.used)) * 100)}% of payroll`} /></Card>
      </div>

      <CapPlanner className="mb-4" />

      <div className="mb-4 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-lg font-700 uppercase tracking-wide">Cap Allocation</h3>
            <span className="text-xs text-muted">by position group</span>
          </div>
          <div className="space-y-2">
            {POSITION_GROUPS.map((g) => {
              const total = roster
                .filter((p) => g.positions.includes(p.pos))
                .reduce((s, p) => s + p.contract.capHit, 0)
              const pct = (total / Math.max(1, summary.limit)) * 100
              return (
                <div key={g.label} className="flex items-center gap-3">
                  <span className="w-9 font-cond text-xs font-700 uppercase text-muted">{g.label}</span>
                  <div className="flex-1">
                    <RatingBar value={(total / Math.max(1, summary.used)) * 100} color="var(--team)" height={10} />
                  </div>
                  <span className="w-20 text-right font-cond text-sm font-700 tnum text-ink-2">{money(total)}</span>
                  <span className="w-12 text-right font-cond text-xs tnum text-muted">{pct.toFixed(1)}%</span>
                </div>
              )
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2 text-[11px] text-muted">
            {(['OFF', 'DEF', 'ST'] as const).map((side) => {
              const total = roster.filter((p) => p.side === side).reduce((s, p) => s + p.contract.capHit, 0)
              return (
                <span key={side} className="font-cond font-700 uppercase">
                  {side} <span className="text-ink-2">{money(total)}</span>
                </span>
              )
            })}
          </div>
        </Card>
        <Card>
          <h3 className="mb-3 font-display text-lg font-700 uppercase tracking-wide">Cap Health</h3>
          <div className="space-y-3">
            <HealthRow label="Flexibility" value={Math.round(Math.max(8, Math.min(95, 50 + (summary.space / summary.limit) * 120)))} good />
            <HealthRow label="Future Commitments" value={Math.round(Math.min(95, (summary.used / summary.limit) * 100))} good={summary.used / summary.limit < 0.9} />
            <HealthRow label="Dead Money Load" value={Math.round(Math.min(95, (summary.dead / summary.limit) * 300))} good={summary.dead / summary.limit < 0.06} />
          </div>
          <div className="mt-3 rounded-lg bg-surface-2 p-3 text-xs leading-relaxed text-muted">
            {summary.overTheCap
              ? 'You are over the cap. Restructure a veteran deal or release a surplus contract before you can sign anyone.'
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
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="label">Contract Ledger</span>
          <Badge tone="neutral">{contracts.length} active · floor {money(summary.floor)}</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tnum">
            <thead>
              <tr className="border-b border-line text-left">
                {LEDGER_COLS.map(([h, k, tip]) => (
                  <th key={h} className="label whitespace-nowrap px-3 py-2">
                    {k ? (
                      <button
                        type="button"
                        onClick={() => sortBy(k)}
                        className={cn('inline-flex items-center gap-1 uppercase hover:text-ink', sortKey === k && 'text-ink')}
                        title={tip ?? `Sort by ${h}`}
                      >
                        {h}
                        <span className="text-[9px]">{sortKey === k ? (sortDir === 1 ? '▲' : '▼') : ''}</span>
                      </button>
                    ) : (
                      h
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {contracts.map((p) => {
                const pct = (p.contract.capHit / summary.limit) * 100
                const dead = deadMoney(p.contract)
                const save = capSavings(p.contract)
                return (
                  <tr key={p.id} className="border-b border-line/60 hover:bg-surface-2">
                    <td className="px-3 py-1.5 font-600 text-ink">{p.name}</td>
                    <td className="px-3 py-1.5 font-cond text-[11px] font-700 uppercase text-muted">{p.pos}</td>
                    <td className="px-3 py-1.5 text-ink-2">{p.age}</td>
                    <td className="px-3 py-1.5"><OvrBadge value={p.ovr} size={22} /></td>
                    <td className="px-3 py-1.5"><OvrBadge value={p.pot} size={22} /></td>
                    <td className="px-3 py-1.5 font-cond font-700 text-ink">{money(p.contract.capHit)}</td>
                    <td className="px-3 py-1.5 text-ink-2">{money(p.contract.annual)}</td>
                    <td className="px-3 py-1.5 text-muted">{money(p.contract.guaranteed)}</td>
                    <td className="px-3 py-1.5 text-ink-2">{p.contract.years}</td>
                    <td className={cn('px-3 py-1.5', dead > p.contract.capHit ? 'text-loss' : 'text-muted')}>{money(dead)}</td>
                    <td className={cn('px-3 py-1.5 font-cond font-700 tnum', freedTone(save))}>{freedMoney(save)}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <div className="w-12">
                          <RatingBar value={pct * 3} color={pct > 7 ? '#dc2937' : pct > 5 ? '#d98207' : '#05914f'} height={5} />
                        </div>
                        <span className="font-cond text-xs text-muted">{pct.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex justify-end gap-1.5">
                        {canMove ? (
                          <>
                            <Button size="sm" variant="ghost" disabled={!canMove} title="Convert base salary to signing bonus" onClick={() => restructurePlayer(p.id)}>
                              Restructure
                            </Button>
                            <Button size="sm" variant="ghost" disabled={!canMove || (canNegotiate && p.contract.years > 2)} onClick={() => (canNegotiate ? setTalkId(p.id) : extendPlayer(p.id))}>
                              Extend
                            </Button>
                            <Button size="sm" variant="danger" disabled={!canMove} title={`Savings ${freedMoney(save)}`} onClick={() => releasePlayer(p.id)}>
                              Cut
                            </Button>
                          </>
                        ) : (
                          <GmCapRowActions player={p} />
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {talkId && <ExtensionTalks key={talkId} playerId={talkId} onClose={() => setTalkId(null)} />}
    </div>
  )
}

function HealthRow({ label, value, good }: { label: string; value: number; good: boolean }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="font-cond text-xs font-600 uppercase text-ink-2">{label}</span>
        <span className={cn('font-cond text-xs font-700 tnum', good ? 'text-win' : 'text-warn')}>{value}</span>
      </div>
      <RatingBar value={value} color={good ? '#05914f' : '#d98207'} />
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
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={asked || !eligibleExt}
        title={eligibleExt ? 'Ask the GM to extend him' : `${player.contract.years} years left — the GM only extends players with two or fewer.`}
        onClick={() => askGmToExtend(player.id)}
      >
        <Handshake size={12} /> {asked ? 'Asked' : 'Extend'}
      </Button>
      <Button size="sm" variant="danger" disabled={asked} title="Ask the GM to cut him" onClick={() => requestGmRelease(player.id)}>
        <Handshake size={12} /> {asked ? 'Asked' : 'Cut'}
      </Button>
    </>
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
      <h3 className="flex items-center gap-1.5 font-display text-lg font-700 uppercase tracking-wide">
        <Handshake size={16} className="text-[var(--team)]" /> Ask the GM
      </h3>
      <p className="mb-3 mt-1 max-w-2xl text-xs leading-relaxed text-muted">
        You shape the plan; the GM holds the pen. Name the target you want room for and he converts base to bonus on
        1&ndash;3 big deals &mdash; only while the club reads as a contender. He reports the space freed this year
        against the extra dead money pushed into later years.
      </p>
      <GmRestructureRequest />
      <p className="mt-3 text-[10px] text-faint">
        Restructures only help for a specific, named move. An unnecessary one is refused.
      </p>
      {career.gmRestructureSeason === league.season && (
        <p className="mt-1 text-[10px] text-faint">
          Restructure green-lit this season: a free-agent bid that doesn&apos;t fit will trigger one automatically.
        </p>
      )}
    </Card>
  )
}

const MEMO_BUCKETS: { id: SpaceBucket; label: string; sub: string }[] = [
  { id: 'tight', label: 'Tight', sub: 'under $5M' },
  { id: 'comfortable', label: 'Comfortable', sub: '$5\u201325M' },
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
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 font-display text-lg font-700 uppercase tracking-wide">
            <Lock size={15} className="text-[var(--team)]" /> Cap Memo
          </h3>
          <Badge tone={memo.graded ? 'win' : 'info'}>{memo.graded ? 'Graded' : 'Filed'}</Badge>
        </div>
        <p className="mb-3 text-sm text-muted">
          Filed for {memo.filedSeason}. Graded at the end of {memo.filedSeason + 1}.
        </p>

        <div className="mb-3 rounded-lg border border-line bg-surface-2 p-3">
          <div className="label">Forecast: next season&apos;s year-end space</div>
          <div className="font-display text-xl font-700 uppercase text-ink">
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
                  <div
                    key={pr.playerId}
                    className="flex items-center justify-between rounded-lg border border-line px-2.5 py-1.5"
                  >
                    <span className="truncate text-sm font-600 text-ink">
                      {p ? `${p.name} · ${p.pos}` : 'Departed'}
                    </span>
                    <span
                      className={cn(
                        'font-cond text-[11px] font-700 uppercase',
                        extended ? 'text-win' : p ? 'text-muted' : 'text-loss',
                      )}
                    >
                      {extended ? 'Extended' : p ? 'Not extended' : 'Left club'}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted">No priority extensions named.</p>
          )}
        </div>

        {memo.note && (
          <p className="rounded-lg bg-surface-2 p-3 text-sm italic text-ink-2">&ldquo;{memo.note}&rdquo;</p>
        )}
      </Card>
    )
  }

  // Open: the offseason form.
  return (
    <Card className={className}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 font-display text-lg font-700 uppercase tracking-wide">
          <FileText size={15} className="text-[var(--team)]" /> Cap Memo
        </h3>
        <Badge tone="team">Offseason</Badge>
      </div>
      <p className="mb-3 text-sm text-muted">
        Commit in public: forecast next season&apos;s year-end cap space and name up to three priority
        extensions. The memo locks once filed and grades a year from now.
      </p>

      <div className="mb-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="label">Forecast: next season&apos;s year-end space</span>
          <span className="font-cond text-xs text-muted">
            today {money(summary.space)} · {spaceBucket(summary.space)}
          </span>
        </div>
        <div className="flex gap-1.5">
          {MEMO_BUCKETS.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBucket(b.id)}
              className={cn(
                'flex-1 rounded-lg border py-1.5 text-center transition',
                bucket === b.id
                  ? 'border-[var(--team)] bg-[var(--team-soft)]'
                  : 'border-line bg-surface-2 hover:border-line-strong',
              )}
            >
              <span className="block font-cond text-sm font-700 text-ink">{b.label}</span>
              <span className="block font-cond text-[10px] font-700 uppercase text-muted">{b.sub}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="label">Priority extensions</span>
          <span className="font-cond text-xs text-muted">
            {picked.length}/3 · {eligible.length} eligible
          </span>
        </div>
        {eligible.length ? (
          <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
            {eligible.map((p) => {
              const on = picked.includes(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => togglePick(p.id)}
                  className={cn(
                    'rounded-lg border px-2.5 py-1 text-left transition',
                    on
                      ? 'border-[var(--team)] bg-[var(--team-soft)]'
                      : 'border-line bg-surface-2 hover:border-line-strong',
                  )}
                >
                  <span className="block text-xs font-600 text-ink">{p.name}</span>
                  <span className="block font-cond text-[10px] font-700 uppercase text-muted">
                    {p.pos} · {p.contract.years} yr{p.contract.years === 1 ? '' : 's'} left
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-muted">
            No players are extension-eligible (2 years or fewer) right now.
          </p>
        )}
      </div>

      <div className="mb-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="label">Intent</span>
          <span className="font-cond text-[10px] font-700 uppercase text-faint">{note.length}/120</span>
        </div>
        <input
          type="text"
          maxLength={120}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="One sentence: what this cap plan is for."
          className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-[var(--team)]"
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

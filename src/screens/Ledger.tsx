import { useState } from 'react'
import { BookOpen, Check, Minus, Target, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { COACHING_KINDS, ledgerHitRate, myGuys } from '../game/engine/ledger'
import { tradeTree, type TradeNode, type TradeVerdict } from '../game/engine/tradeTree'
import type { LedgerEntry, TradeAssetSnap } from '../game/types'
import type { World } from '../game/engine/generate'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, KpiStrip, KpiTile, PageHeader, SegmentedControl, Tabs, TeamCrest } from '../ui/kit'

// Category chips are neutral by design; hit / miss is the only verdict colour.
const KIND_LABEL: Record<LedgerEntry['kind'], string> = {
  recommendation: 'Call',
  grade: 'Grade',
  pick: 'Pick',
  advice: 'Advice',
  develop: 'Develop',
  contract: 'Contract',
  // L12.9 L1: the coaching track.
  fourth: '4th down',
  two: '2-pt try',
  playCall: 'Play calls',
  keys: 'Keys',
  film: 'Film',
  pitch: 'Pitch',
  gmRequest: 'GM request',
}

const VERDICT_TONE: Record<TradeVerdict, 'win' | 'loss' | 'neutral' | 'info'> = {
  Won: 'win',
  Lost: 'loss',
  Even: 'neutral',
  'Too early': 'info',
}

function TradeAssetRow({ snap }: { snap: TradeAssetSnap }) {
  return (
    <div className="flex items-center justify-between gap-2 text-small">
      <span className="min-w-0 truncate text-ink-2">{snap.label}</span>
      {snap.kind === 'pick' && snap.resolvedName && (
        <span className="shrink-0 text-muted">→ became {snap.resolvedName}</span>
      )}
    </div>
  )
}

/** One trade, with any later trades that reused its incoming assets nested beneath. */
function TradeTreeNode({ world, node }: { world: World; node: TradeNode }) {
  const partner = world.byId[node.record.partnerId]
  return (
    <div>
      <Card>
        <div className="flex items-start gap-3">
          {partner && <TeamCrest team={partner} size={36} />}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-600 text-ink">Season {node.record.season}</span>
              <span className="font-cond text-label font-700 uppercase tracking-[0.06em] text-muted">
                Wk {node.record.week} · with {partner?.abbr ?? node.record.partnerId}
              </span>
              <Badge tone={VERDICT_TONE[node.verdict]}>{node.verdict}</Badge>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <div className="label mb-1">Gave</div>
                {node.record.gave.length === 0 && <div className="text-small text-muted">—</div>}
                {node.record.gave.map((s) => <TradeAssetRow key={s.id} snap={s} />)}
              </div>
              <div>
                <div className="label mb-1">Got</div>
                {node.record.got.length === 0 && <div className="text-small text-muted">—</div>}
                {node.record.got.map((s) => <TradeAssetRow key={s.id} snap={s} />)}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-3 font-cond text-label font-700 uppercase tracking-[0.06em] text-muted">
              <span>Gave {node.gave} value</span>
              <span>Got {node.got} value</span>
            </div>
          </div>
        </div>
      </Card>
      {node.children.length > 0 && (
        <div className="ml-6 space-y-2 border-l border-line pl-4 pt-2">
          {node.children.map((c) => <TradeTreeNode key={c.record.id} world={world} node={c} />)}
        </div>
      )}
    </div>
  )
}

/** A best / worst call as a plain text row rather than a KPI number. */
function CallRow({ label, entry, good }: { label: string; entry?: LedgerEntry; good: boolean }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <span className={cn('mt-0.5 w-20 shrink-0 font-cond text-label font-700 uppercase tracking-[0.07em]', good ? 'text-win' : 'text-loss')}>
        {label}
      </span>
      <div className="min-w-0 flex-1">
        {entry ? (
          <>
            <div className="truncate text-body font-600 text-ink">{entry.name}</div>
            <div className="mt-0.5 text-small text-muted">
              {KIND_LABEL[entry.kind]} · {entry.season} · {entry.note}
            </div>
            {entry.outcome && <div className="mt-1 text-small text-ink-2">{entry.outcome}</div>}
          </>
        ) : (
          <div className="text-small text-muted">No graded calls yet.</div>
        )}
      </div>
      {entry?.myGrade != null && (
        <span className="shrink-0 font-display text-body font-700 tnum text-ink-2">Grd {entry.myGrade}</span>
      )}
    </div>
  )
}

export function Ledger() {
  const world = useWorld()
  const career = useGame((s) => s.career)!
  const [tab, setTab] = useState<'calls' | 'guys' | 'trades'>('calls')
  const [filter, setFilter] = useState<'all' | 'coaching'>('all')

  const rate = ledgerHitRate(career)
  const entries = career.ledger ?? []
  const guys = myGuys(world, career)
  const tree = tradeTree(world, career)
  // L12.9 L1: the coaching track's header and its résumé of graded calls.
  const isCoach = career.path === 'coach'
  const coaching = entries.filter((e) => COACHING_KINDS.has(e.kind))
  const seasonCalls = entries.filter((e) => e.season === career.season)
  const ranked = [...coaching].filter((e) => e.myGrade != null).sort((a, b) => (b.myGrade ?? 0) - (a.myGrade ?? 0))
  const bestCall = ranked.find((e) => e.hit === true) ?? ranked[0]
  const worstCall = [...ranked].reverse().find((e) => e.hit === false) ?? ranked[ranked.length - 1]
  const shown = filter === 'coaching' ? coaching : entries
  const rateTone = rate.pct >= 60 ? 'win' : rate.pct >= 45 ? 'neutral' : 'loss'

  return (
    <div>
      <PageHeader
        eyebrow={`${isCoach ? 'Coaching' : 'Personnel'} Track · Season ${career.season}`}
        title="The Ledger"
        subtitle="Every call you've made, dated and graded. Years later it comes back — hit or miss."
        right={
          tab === 'calls' ? (
            <SegmentedControl
              label="Ledger filter"
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'all', label: 'All' },
                { id: 'coaching', label: `Coaching (${coaching.length})` },
              ]}
            />
          ) : undefined
        }
      />

      <Tabs
        label="Ledger sections"
        value={tab}
        onChange={setTab}
        className="mb-4"
        tabs={[
          { id: 'calls', label: 'All Calls', count: entries.length },
          { id: 'guys', label: 'My Guys', count: guys.length },
          { id: 'trades', label: 'Trade Tree', count: tree.length },
        ]}
      />

      <KpiStrip label="Ledger summary" className="mb-5">
        {isCoach ? (
          <>
            <KpiTile label="Calls This Season" value={seasonCalls.length} unit="logged" why={`${coaching.length} on the coaching résumé`} />
            <KpiTile
              label="Success Rate"
              value={rate.calls ? `${rate.pct}%` : '—'}
              verdict={rate.calls ? { label: rate.pct >= 60 ? 'Strong' : rate.pct >= 45 ? 'Even' : 'Cold', tone: rateTone } : undefined}
              why={`${rate.hits} of ${rate.calls} graded`}
            />
          </>
        ) : (
          <>
            <KpiTile
              label="Success Rate"
              value={rate.calls ? `${rate.pct}%` : '—'}
              verdict={rate.calls ? { label: rate.pct >= 60 ? 'Strong' : rate.pct >= 45 ? 'Even' : 'Cold', tone: rateTone } : undefined}
              why={`${rate.hits} of ${rate.calls} graded`}
            />
            <KpiTile label="Total Calls" value={entries.length} unit="logged" why="Everything on your résumé" />
            <KpiTile label="My Guys" value={guys.length} unit="tracked" why="Picks & blue-chip calls" />
            <KpiTile label="Awaiting Grade" value={entries.filter((e) => e.hit === undefined).length} unit="too early" why="Too early to judge" />
          </>
        )}
      </KpiStrip>

      {isCoach && (
        <Card className="mb-5">
          <h3 className="mb-1 font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">
            Best &amp; worst calls
          </h3>
          <div className="divide-y divide-line">
            <CallRow label="Best call" entry={bestCall} good />
            <CallRow label="Worst call" entry={worstCall} good={false} />
          </div>
        </Card>
      )}

      {tab === 'calls' ? (
        <Card pad={false}>
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <span className="label">Career Ledger</span>
            <span className="ml-auto font-cond text-label font-700 uppercase tracking-[0.07em] text-muted tnum">{shown.length}</span>
          </div>
          <div className="max-h-[640px] divide-y divide-line/60 overflow-y-auto max-lg:max-h-none">
            {shown.length === 0 && (
              <div className="px-4 py-10 text-center text-body text-muted">
                {isCoach || filter === 'coaching'
                  ? 'No calls yet. Your 4th-down and 2-point decisions, play calls, keys to the game, film grades and starter pitches land here, graded.'
                  : 'No calls yet. Scout a prospect, file a recommendation, and make a pick — it all lands here.'}
              </div>
            )}
            {shown.map((e) => (
              <div key={e.id} className="flex items-start gap-3 px-4 py-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--r-md)] bg-surface-3">
                  <BookOpen size={15} className="text-muted" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="neutral">{KIND_LABEL[e.kind]}</Badge>
                    {e.conviction && <Badge tone="neutral">Conviction</Badge>}
                    {e.vindication && <Badge tone="win">Called it</Badge>}
                    {e.redFlag && <Badge tone="warn">Red flag</Badge>}
                    {e.redFlag && e.hit === true && <Badge tone="win">Red flag held</Badge>}
                    <span className="truncate font-600 text-ink">{e.name}</span>
                    {(e.pos || e.college) && (
                      <span className="font-cond text-label font-700 uppercase tracking-[0.06em] text-muted">
                        {[e.pos, e.college].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-small text-muted">
                    {e.season} · {e.role ?? '—'} · {e.note}
                  </div>
                  {e.outcome && <div className={cn('mt-1 text-small', e.hit ? 'text-win' : e.hit === false ? 'text-loss' : 'text-ink-2')}>{e.outcome}</div>}
                </div>
                <div className="shrink-0 text-right">
                  {e.recommendation && <div className="font-cond text-label font-700 uppercase tracking-[0.06em] text-ink-2">{e.recommendation}</div>}
                  {e.myGrade != null && !e.recommendation && <div className="font-display text-body font-700 tnum text-ink-2">Grd {e.myGrade}</div>}
                  {e.round && <div className="font-cond text-label uppercase tracking-[0.06em] text-muted">Rd {e.round}</div>}
                  <div className="mt-0.5">
                    {e.hit === true ? (
                      <Badge tone="win"><Check size={11} aria-hidden /> Hit</Badge>
                    ) : e.hit === false ? (
                      <Badge tone="loss"><X size={11} aria-hidden /> Miss</Badge>
                    ) : (
                      <Badge tone="neutral"><Minus size={11} aria-hidden /> Pending</Badge>
                    )}
                  </div>
                  {e.accepted !== undefined && (
                    <div className="mt-1 font-cond text-label uppercase tracking-[0.06em] text-muted">
                      {e.accepted ? 'Director listened' : 'Overridden'}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : tab === 'guys' ? (
        <Card pad={false}>
          <div className="border-b border-line px-4 py-2.5">
            <span className="label">My Guys · everyone you championed</span>
          </div>
          <div className="max-h-[640px] divide-y divide-line/60 overflow-y-auto max-lg:max-h-none">
            {guys.length === 0 && (
              <div className="px-4 py-10 text-center text-body text-muted">
                Draft someone or file a Blue Chip / Starter call and they&rsquo;ll show up here — tracked for their whole career.
              </div>
            )}
            {guys.map((g) => (
              <div key={g.entry.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--r-md)] bg-surface-3">
                  <Target size={15} className="text-muted" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-600 text-ink">{g.entry.name}</div>
                  <div className="text-small text-muted">
                    {g.entry.pos} · {g.entry.college} · called {g.entry.season} as {g.entry.role ?? '—'}
                  </div>
                  {g.entry.outcome && <div className="mt-0.5 text-small text-ink-2">{g.entry.outcome}</div>}
                </div>
                <div className="shrink-0 text-right">
                  {g.player ? (
                    <>
                      <div className="font-display text-lg font-700 tnum text-ink">{g.ovr}</div>
                      <div className="font-cond text-label uppercase tracking-[0.06em] text-muted">
                        {g.player.teamId ? world.byId[g.player.teamId]?.abbr ?? '—' : 'FA'}
                      </div>
                    </>
                  ) : (
                    <Badge tone="neutral">On the board</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {tree.length === 0 && (
            <Card>
              <div className="px-4 py-10 text-center text-body text-muted">
                No trades yet — trade authority unlocks higher up the ladder.
              </div>
            </Card>
          )}
          {tree.map((n) => <TradeTreeNode key={n.record.id} world={world} node={n} />)}
        </div>
      )}
    </div>
  )
}

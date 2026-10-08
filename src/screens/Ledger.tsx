import { useState } from 'react'
import { BookOpen, Check, Minus, Target, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { COACHING_KINDS, ledgerHitRate, myGuys } from '../game/engine/ledger'
import { tradeTree, type TradeNode, type TradeVerdict } from '../game/engine/tradeTree'
import type { LedgerEntry, TradeAssetSnap } from '../game/types'
import type { World } from '../game/engine/generate'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, PageHeader, Stat, TeamCrest } from '../ui/kit'

const KIND_META: Record<LedgerEntry['kind'], { label: string; tone: 'win' | 'loss' | 'warn' | 'info' | 'gold' | 'neutral' }> = {
  recommendation: { label: 'Call', tone: 'info' },
  grade: { label: 'Grade', tone: 'neutral' },
  pick: { label: 'Pick', tone: 'gold' },
  advice: { label: 'Advice', tone: 'warn' },
  develop: { label: 'Develop', tone: 'win' },
  contract: { label: 'Contract', tone: 'info' },
  // L12.9 L1: the coaching track.
  fourth: { label: '4th down', tone: 'warn' },
  two: { label: '2-pt try', tone: 'warn' },
  playCall: { label: 'Play calls', tone: 'info' },
  keys: { label: 'Keys', tone: 'info' },
  film: { label: 'Film', tone: 'neutral' },
  pitch: { label: 'Pitch', tone: 'gold' },
}

const VERDICT_TONE: Record<TradeVerdict, 'win' | 'loss' | 'neutral' | 'info'> = {
  Won: 'win',
  Lost: 'loss',
  Even: 'neutral',
  'Too early': 'info',
}

function TradeAssetRow({ snap }: { snap: TradeAssetSnap }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
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
              <span className="font-cond text-[11px] font-700 uppercase text-muted">
                Wk {node.record.week} · with {partner?.abbr ?? node.record.partnerId}
              </span>
              <Badge tone={VERDICT_TONE[node.verdict]}>{node.verdict}</Badge>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <div className="label mb-1">Gave</div>
                {node.record.gave.length === 0 && <div className="text-xs text-muted">—</div>}
                {node.record.gave.map((s) => <TradeAssetRow key={s.id} snap={s} />)}
              </div>
              <div>
                <div className="label mb-1">Got</div>
                {node.record.got.length === 0 && <div className="text-xs text-muted">—</div>}
                {node.record.got.map((s) => <TradeAssetRow key={s.id} snap={s} />)}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-3 font-cond text-[11px] font-700 uppercase text-muted">
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

  return (
    <div>
      <PageHeader
        eyebrow={`${career.path === 'coach' ? 'Coaching' : 'Personnel'} Track · Season ${career.season}`}
        title="The Ledger"
        subtitle="Every call you've made, dated and graded. Years later it comes back — hit or miss."
        right={
          <div className="flex rounded-lg bg-surface-2 p-0.5">
            {(['calls', 'guys', 'trades'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'rounded-md px-4 py-1.5 font-cond text-xs font-700 uppercase tracking-wide transition',
                  tab === t ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink-2',
                )}
              >
                {t === 'calls' ? 'All Calls' : t === 'guys' ? `My Guys (${guys.length})` : 'Trade Tree'}
              </button>
            ))}
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {isCoach ? (
          <>
            <Card><Stat label="Calls This Season" value={seasonCalls.length} sub={`${coaching.length} on the coaching résumé`} /></Card>
            <Card>
              <Stat label="Success Rate" value={rate.calls ? `${rate.pct}%` : '—'} sub={`${rate.hits} / ${rate.calls} graded`} tone={rate.pct >= 60 ? 'win' : rate.pct >= 45 ? undefined : 'loss'} />
            </Card>
            <Card><Stat label="Best Call" value={bestCall?.name ?? '—'} sub={bestCall?.note ?? 'No graded calls yet'} tone={bestCall ? 'win' : undefined} /></Card>
            <Card><Stat label="Worst Call" value={worstCall?.name ?? '—'} sub={worstCall?.note ?? 'No graded calls yet'} tone={worstCall ? 'loss' : undefined} /></Card>
          </>
        ) : (
          <>
            <Card>
              <Stat label="Success Rate" value={rate.calls ? `${rate.pct}%` : '—'} sub={`${rate.hits} / ${rate.calls} graded`} tone={rate.pct >= 60 ? 'win' : rate.pct >= 45 ? undefined : 'loss'} />
            </Card>
            <Card><Stat label="Total Calls" value={entries.length} sub="logged to your résumé" /></Card>
            <Card><Stat label="My Guys" value={guys.length} sub="picks & blue-chip calls" /></Card>
            <Card><Stat label="Awaiting Grade" value={entries.filter((e) => e.hit === undefined).length} sub="too early to judge" /></Card>
          </>
        )}
      </div>

      {tab === 'calls' ? (
        <Card pad={false}>
          <div className="flex items-center gap-2 border-b border-line px-4 py-2">
            <span className="label">Career Ledger</span>
            <div className="ml-auto flex rounded-lg bg-surface-2 p-0.5">
              {(['all', 'coaching'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn('rounded-md px-3 py-1 font-cond text-[11px] font-700 uppercase', filter === f ? 'bg-white text-ink shadow-sm' : 'text-muted')}
                >
                  {f === 'all' ? 'All' : `Coaching (${coaching.length})`}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[640px] divide-y divide-line/60 overflow-y-auto">
            {shown.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-muted">
                {isCoach || filter === 'coaching'
                  ? 'No calls yet. Your 4th-down and 2-point decisions, play calls, keys to the game, film grades and starter pitches land here, graded.'
                  : 'No calls yet. Scout a prospect, file a recommendation, and make a pick — it all lands here.'}
              </div>
            )}
            {shown.map((e) => {
              const meta = KIND_META[e.kind]
              return (
                <div key={e.id} className="flex items-start gap-3 px-4 py-2.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3">
                    <BookOpen size={15} className="text-muted" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      {e.conviction && <Badge tone="gold">Conviction</Badge>}
                      {e.vindication && <Badge tone="win">Called it</Badge>}
                      {e.redFlag && <Badge tone="warn">Red flag</Badge>}
                      {e.redFlag && e.hit === true && <Badge tone="win">Red flag held</Badge>}
                      <span className="truncate font-600 text-ink">{e.name}</span>
                      {(e.pos || e.college) && (
                        <span className="font-cond text-[11px] font-700 uppercase text-muted">{[e.pos, e.college].filter(Boolean).join(' · ')}</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {e.season} · {e.role ?? '—'} · {e.note}
                    </div>
                    {e.outcome && <div className={cn('mt-1 text-xs', e.hit ? 'text-win' : e.hit === false ? 'text-loss' : 'text-ink-2')}>{e.outcome}</div>}
                  </div>
                  <div className="shrink-0 text-right">
                    {e.recommendation && <div className="font-cond text-xs font-700 uppercase text-ink-2">{e.recommendation}</div>}
                    {e.myGrade != null && !e.recommendation && <div className="font-display text-sm font-700 tnum text-ink-2">Grd {e.myGrade}</div>}
                    {e.round && <div className="font-cond text-[10px] uppercase text-muted">Rd {e.round}</div>}
                    <div className="mt-0.5">
                      {e.hit === true ? (
                        <Badge tone="win"><Check size={11} /> Hit</Badge>
                      ) : e.hit === false ? (
                        <Badge tone="loss"><X size={11} /> Miss</Badge>
                      ) : (
                        <Badge tone="neutral"><Minus size={11} /> Pending</Badge>
                      )}
                    </div>
                    {e.accepted !== undefined && (
                      <div className="mt-1 font-cond text-[10px] uppercase text-muted">
                        {e.accepted ? 'Director listened' : 'Overridden'}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      ) : tab === 'guys' ? (
        <Card pad={false}>
          <div className="border-b border-line px-4 py-2">
            <span className="label">My Guys · everyone you championed</span>
          </div>
          <div className="max-h-[640px] divide-y divide-line/60 overflow-y-auto">
            {guys.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-muted">
                Draft someone or file a Blue Chip / Starter call and they'll show up here — tracked for their whole career.
              </div>
            )}
            {guys.map((g) => (
              <div key={g.entry.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3">
                  <Target size={15} className="text-muted" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-600 text-ink">{g.entry.name}</div>
                  <div className="text-xs text-muted">
                    {g.entry.pos} · {g.entry.college} · called {g.entry.season} as {g.entry.role ?? '—'}
                  </div>
                  {g.entry.outcome && <div className="mt-0.5 text-xs text-ink-2">{g.entry.outcome}</div>}
                </div>
                <div className="shrink-0 text-right">
                  {g.player ? (
                    <>
                      <div className="font-display text-lg font-700 tnum text-ink">{g.ovr}</div>
                      <div className="font-cond text-[10px] uppercase text-muted">
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
              <div className="px-4 py-10 text-center text-sm text-muted">
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

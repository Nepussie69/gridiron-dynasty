import { useState } from 'react'
import { BookOpen, Check, Minus, Target, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { ledgerHitRate, myGuys } from '../game/engine/ledger'
import type { LedgerEntry } from '../game/types'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, PageHeader, Stat } from '../ui/kit'

const KIND_META: Record<LedgerEntry['kind'], { label: string; tone: 'win' | 'loss' | 'warn' | 'info' | 'gold' | 'neutral' }> = {
  recommendation: { label: 'Call', tone: 'info' },
  grade: { label: 'Grade', tone: 'neutral' },
  pick: { label: 'Pick', tone: 'gold' },
  advice: { label: 'Advice', tone: 'warn' },
}

export function Ledger() {
  const world = useWorld()
  const career = useGame((s) => s.career)!
  const [tab, setTab] = useState<'calls' | 'guys'>('calls')

  const rate = ledgerHitRate(career)
  const entries = career.ledger ?? []
  const guys = myGuys(world, career)

  return (
    <div>
      <PageHeader
        eyebrow={`${career.path === 'coach' ? 'Coaching' : 'Personnel'} Track · Season ${career.season}`}
        title="The Ledger"
        subtitle="Every call you've made, dated and graded. Years later it comes back — hit or miss."
        right={
          <div className="flex rounded-lg bg-surface-2 p-0.5">
            {(['calls', 'guys'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'rounded-md px-4 py-1.5 font-cond text-xs font-700 uppercase tracking-wide transition',
                  tab === t ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink-2',
                )}
              >
                {t === 'calls' ? 'All Calls' : `My Guys (${guys.length})`}
              </button>
            ))}
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <Stat label="Batting Average" value={rate.calls ? `${rate.pct}%` : '—'} sub={`${rate.hits} / ${rate.calls} graded`} tone={rate.pct >= 60 ? 'win' : rate.pct >= 45 ? undefined : 'loss'} />
        </Card>
        <Card><Stat label="Total Calls" value={entries.length} sub="logged to your résumé" /></Card>
        <Card><Stat label="My Guys" value={guys.length} sub="picks & blue-chip calls" /></Card>
        <Card><Stat label="Awaiting Grade" value={entries.filter((e) => e.hit === undefined).length} sub="too early to judge" /></Card>
      </div>

      {tab === 'calls' ? (
        <Card pad={false}>
          <div className="border-b border-line px-4 py-2">
            <span className="label">Career Ledger</span>
          </div>
          <div className="max-h-[640px] divide-y divide-line/60 overflow-y-auto">
            {entries.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-muted">
                No calls yet. Scout a prospect, file a recommendation, and make a pick — it all lands here.
              </div>
            )}
            {entries.map((e) => {
              const meta = KIND_META[e.kind]
              return (
                <div key={e.id} className="flex items-start gap-3 px-4 py-2.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3">
                    <BookOpen size={15} className="text-muted" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      <span className="truncate font-600 text-ink">{e.name}</span>
                      <span className="font-cond text-[11px] font-700 uppercase text-muted">{e.pos} · {e.college}</span>
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
      ) : (
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
      )}
    </div>
  )
}

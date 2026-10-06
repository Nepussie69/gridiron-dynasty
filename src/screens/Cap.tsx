import { useMemo, useState } from 'react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
import { capSavings, deadMoney } from '../game/engine/cap'
import { canSignFreeAgents } from '../game/engine/career'
import { accessFor } from '../game/engine/access'
import { capabilities } from '../game/engine/capabilities'
import { capSummary } from '../game/selectors'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card, PageHeader, RatingBar, Stat } from '../ui/kit'
import { ExtensionTalks } from '../components/ExtensionTalks'

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
  const contracts = useMemo(() => [...roster].sort((a, b) => b.contract.capHit - a.contract.capHit), [roster])

  return (
    <div>
      <PageHeader
        eyebrow={`${league.byId[career.teamId].name} · ${league.season}`}
        title="Salary Cap"
        subtitle="Every dollar is a decision. Restructure to win now, or clear the books for tomorrow."
        right={<Badge tone={summary.overTheCap ? 'loss' : summary.meetsFloor ? 'win' : 'warn'}>
          {summary.overTheCap ? 'Over the cap' : summary.meetsFloor ? 'Cap compliant' : 'Below the floor'}
        </Badge>}
      />

      {!canMove && (
        <div className="mb-4 rounded-xl border border-[#f3ddb8] bg-[#fdf0dc] p-3 text-sm text-warn">
          {access === 'advise'
            ? 'The cap is the GM\u2019s department. You can review the books and shape the plan \u2014 the GM makes the final call on contracts.'
            : 'Contract moves unlock at Director of Player Personnel. You can review the books now.'}
        </div>
      )}

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

      <div className="mb-4 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-lg font-700 uppercase tracking-wide">Cap Allocation</h3>
            <span className="text-xs text-muted">by unit</span>
          </div>
          <div className="space-y-2.5">
            {['OFF', 'DEF', 'ST'].map((side) => {
              const group = roster.filter((p) => p.side === side)
              const total = group.reduce((s, p) => s + p.contract.capHit, 0)
              return (
                <div key={side} className="flex items-center gap-3">
                  <span className="w-9 font-cond text-xs font-700 uppercase text-muted">{side}</span>
                  <div className="flex-1">
                    <RatingBar value={(total / Math.max(1, summary.used)) * 100} color={side === 'OFF' ? 'var(--team)' : side === 'DEF' ? '#0b62ff' : '#c99a2e'} height={10} />
                  </div>
                  <span className="w-20 text-right font-cond text-sm font-700 tnum text-ink-2">{money(total)}</span>
                </div>
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

      <Card pad={false}>
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="label">Contract Ledger</span>
          <Badge tone="neutral">{contracts.length} active · floor {money(summary.floor)}</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tnum">
            <thead>
              <tr className="border-b border-line text-left">
                {['Player', 'Pos', 'Age', 'Cap Hit', 'AAV', 'Guaranteed', 'Yrs', 'Dead $', '% Cap', ''].map((h) => (
                  <th key={h} className="label whitespace-nowrap px-3 py-2">{h}</th>
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
                    <td className="px-3 py-1.5 font-cond font-700 text-ink">{money(p.contract.capHit)}</td>
                    <td className="px-3 py-1.5 text-ink-2">{money(p.contract.annual)}</td>
                    <td className="px-3 py-1.5 text-muted">{money(p.contract.guaranteed)}</td>
                    <td className="px-3 py-1.5 text-ink-2">{p.contract.years}</td>
                    <td className={cn('px-3 py-1.5', dead > p.contract.capHit ? 'text-loss' : 'text-muted')}>{money(dead)}</td>
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
                        <Button size="sm" variant="ghost" disabled={!canMove} title="Convert base salary to signing bonus" onClick={() => restructurePlayer(p.id)}>
                          Restructure
                        </Button>
                        <Button size="sm" variant="ghost" disabled={!canMove || (canNegotiate && p.contract.years > 2)} onClick={() => (canNegotiate ? setTalkId(p.id) : extendPlayer(p.id))}>
                          Extend
                        </Button>
                        <Button size="sm" variant="danger" disabled={!canMove} title={`Savings ${money(save)}`} onClick={() => releasePlayer(p.id)}>
                          Cut
                        </Button>
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

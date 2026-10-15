// ─────────────────────────────────────────────────────────────────────────────
// offseason90: Cutdown day view (user 2026-10-15).
//
// The user's club may carry an NFL offseason camp — free agency, the draft,
// UDFAs, waiver claims, practice-squad promotions and trades all push it past
// 53 — but week 1 needs 53 or fewer. This is the Roster-screen mode the season
// start lands on when the club is over: the roster by position with OVR, age,
// cap hit and the cap saving / dead money of cutting each, the position counts
// against ROSTER_FLOOR, a running "N to cut", the staff's recommended cuts (the
// same lowest-value-first order the league's trimmer uses), one button to make
// them, and a per-player Cut through the normal release path.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react'
import { Scissors, UserMinus } from 'lucide-react'
import { cn } from '../lib/cn'
import { MINUS, money } from '../lib/format'
import { capSavings, deadMoney, remainingContractValue } from '../game/engine/cap'
import { ROSTER_FLOOR, ROSTER_TARGET, recommendedCuts } from '../game/engine/progress'
import { capSummary } from '../game/selectors'
import { useGame, useWorld } from '../store/gameStore'
import type { Player } from '../game/types'
import { Badge, Button, Card, ConfirmSheet, KpiStrip, KpiTile, OvrBadge, SectionTitle, type Consequence } from '../ui/kit'

/** The order the front office reads a roster in. */
const POS_ORDER = ['QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'OG', 'C', 'DE', 'DT', 'LB', 'CB', 'S', 'K', 'P']

/** Money below this reads as "no meaningful change" (same rule as the Cap screen). */
const FREED_EPSILON = 50_000
function freedMoney(n: number) {
  if (Math.abs(n) < FREED_EPSILON) return money(0)
  return `${n > 0 ? '+' : MINUS}${money(Math.abs(n))}`
}
function freedTone(n: number) {
  if (Math.abs(n) < FREED_EPSILON) return 'text-muted'
  return n > 0 ? 'text-win' : 'text-warn'
}

export function Cutdown() {
  const league = useWorld()
  const career = useGame((s) => s.career)
  const closeCutdown = useGame((s) => s.closeCutdown)
  const applyRecommendedCuts = useGame((s) => s.applyRecommendedCuts)
  const releasePlayer = useGame((s) => s.releasePlayer)
  const [cutting, setCutting] = useState<Player | null>(null)

  const teamId = career?.teamId ?? ''
  const roster = useMemo(() => league.roster[teamId] ?? [], [league, teamId])
  const summary = capSummary(league, teamId)
  const toCut = Math.max(0, roster.length - ROSTER_TARGET)

  // The staff's recommendation: lowest-rated surplus first, every position floor
  // kept (the same ordering the league's own trimmer uses).
  const recommended = useMemo(() => recommendedCuts(roster, ROSTER_TARGET), [roster])
  const recommendedIds = useMemo(() => new Set(recommended.map((p) => p.id)), [recommended])
  const recSaving = recommended.reduce((s, p) => s + capSavings(p.contract), 0)
  const recDead = recommended.reduce((s, p) => s + deadMoney(p.contract), 0)

  // Position counts against their ROSTER_FLOOR minimums.
  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const p of roster) map[p.pos] = (map[p.pos] ?? 0) + 1
    return map
  }, [roster])
  const floorPositions = useMemo(() => {
    const pos = new Set([...Object.keys(ROSTER_FLOOR), ...Object.keys(counts)])
    return [...pos].sort((a, b) => {
      const ia = POS_ORDER.indexOf(a)
      const ib = POS_ORDER.indexOf(b)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || (a < b ? -1 : a > b ? 1 : 0)
    })
  }, [counts])

  // The roster by position (deepest position first), highest rated first inside it.
  const byPosition = useMemo(() => {
    return floorPositions
      .filter((pos) => (counts[pos] ?? 0) > 0)
      .map((pos) => ({
        pos,
        players: roster
          .filter((p) => p.pos === pos)
          .sort((a, b) => b.ovr - a.ovr || b.contract.capHit - a.contract.capHit || (a.id < b.id ? -1 : 1)),
      }))
  }, [floorPositions, counts, roster])

  const consequences = (p: Player): Consequence[] => {
    const c = p.contract
    const saving = capSavings(c)
    const after = summary.space + saving
    return [
      { label: 'Cap freed this year', value: freedMoney(saving), tone: saving >= 0 ? 'win' : 'warn' },
      { label: 'Dead money accelerated', value: money(deadMoney(c)), tone: 'warn' },
      { label: 'Remaining contract', value: money(remainingContractValue(c)) },
      { label: 'Cap space', value: `${money(summary.space)} → ${money(after)}`, tone: after < 0 ? 'loss' : undefined },
      { label: 'Roster spot', value: `${roster.length} → ${roster.length - 1} (need ${ROSTER_TARGET})`, tone: 'win' },
      { label: 'Where he goes', value: 'Free agency — he can be signed to the practice squad' },
    ]
  }

  return (
    <div className="space-y-4">
      <KpiStrip label="Cutdown summary">
        <KpiTile
          label="On the roster"
          value={roster.length}
          unit={`need ${ROSTER_TARGET} by week 1`}
          verdict={toCut > 0 ? { label: `${toCut} to cut`, tone: 'warn' } : { label: 'Legal', tone: 'win' }}
          why={<span className="text-muted">A 90-man offseason camp must be down to 53 before the opener</span>}
        />
        <KpiTile
          label="Cap space"
          value={money(summary.space)}
          why={<span className="text-muted">{money(summary.used)} committed · {money(summary.dead)} dead money</span>}
        />
        <KpiTile
          className="max-sm:hidden"
          label="Recommended cuts"
          value={recommended.length}
          unit="players"
          why={
            <span className="text-muted">
              frees {freedMoney(recSaving)} this year · {money(recDead)} dead money
            </span>
          }
        />
      </KpiStrip>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <SectionTitle spacing="tight">Recommended cuts</SectionTitle>
            <p className="text-label leading-snug text-muted">
              Lowest value first, keeping at least the position minimums
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              icon={<Scissors size={15} aria-hidden />}
              disabled={toCut === 0 || recommended.length === 0}
              onClick={() => applyRecommendedCuts()}
            >
              Make the recommended cuts
            </Button>
            <Button variant="quiet" onClick={closeCutdown}>
              Back to roster
            </Button>
          </div>
        </div>
        {toCut === 0 ? (
          <p className="text-small text-muted">The roster is already at {ROSTER_TARGET} or fewer.</p>
        ) : (
          <>
            <ul className="divide-y divide-line/60">
              {recommended.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                  <OvrBadge value={p.ovr} pot={p.pot} size={28} />
                  <span className="w-8 shrink-0 font-cond text-label font-700 uppercase text-muted">{p.pos}</span>
                  <span className="min-w-0 flex-1 truncate text-small font-600 text-ink">{p.name}</span>
                  <span className="tnum text-label text-muted">{money(p.contract.capHit)} cap</span>
                  <span className={cn('tnum text-label', freedTone(capSavings(p.contract)))}>
                    {freedMoney(capSavings(p.contract))} freed
                  </span>
                  <span className="tnum text-label text-warn">{money(deadMoney(p.contract))} dead</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-label leading-snug text-muted">
              {recommended.length} player{recommended.length === 1 ? '' : 's'} — cutting them lands the roster on{' '}
              {roster.length - recommended.length} and every position keeps its minimum.
            </p>
          </>
        )}
      </Card>

      <Card>
        <SectionTitle spacing="tight">Positions</SectionTitle>
        <p className="mb-3 text-label leading-snug text-muted">Count against the minimum the roster must always carry.</p>
        <div className="flex flex-wrap gap-1.5">
          {floorPositions.map((pos) => {
            const n = counts[pos] ?? 0
            const floor = ROSTER_FLOOR[pos] ?? 2
            const atFloor = n <= floor
            return (
              <span key={pos} title={`${pos}: ${n} on the roster, minimum ${floor}`}>
                <Badge tone={atFloor ? 'warn' : 'neutral'}>
                  {pos} {n}
                  <span className="ml-1 text-muted">/{floor}</span>
                </Badge>
              </span>
            )
          })}
        </div>
        <p className="mt-2 text-label leading-snug text-muted">
          A position at its minimum cannot be cut — the staff will look elsewhere.
        </p>
      </Card>

      {byPosition.map(({ pos, players }) => (
        <Card key={pos} pad={false}>
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="font-cond text-label font-700 uppercase text-ink">{pos}</span>
              <Badge tone="neutral">{players.length}</Badge>
            </div>
            <span className="text-label text-muted">
              min {ROSTER_FLOOR[pos] ?? 2} · {players.length - (ROSTER_FLOOR[pos] ?? 2) > 0 ? `${players.length - (ROSTER_FLOOR[pos] ?? 2)} spare` : 'at the minimum'}
            </span>
          </div>
          <ul className="divide-y divide-line/60">
            {players.map((p) => {
              const rec = recommendedIds.has(p.id)
              return (
                <li key={p.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2', rec && 'bg-warn-soft')}>
                  <OvrBadge value={p.ovr} pot={p.pot} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-small font-600 text-ink">
                      {p.name}
                      {rec && <span className="ml-2 text-label font-700 uppercase text-warn">recommended</span>}
                    </span>
                    <span className="block text-label text-muted">
                      age {p.age} · {money(p.contract.capHit)} cap hit
                    </span>
                  </span>
                  <span className={cn('tnum text-label', freedTone(capSavings(p.contract)))}>
                    {freedMoney(capSavings(p.contract))}
                    <span className="ml-1 text-muted">saved</span>
                  </span>
                  <span className="tnum text-label text-warn">
                    {money(deadMoney(p.contract))}
                    <span className="ml-1 text-muted">dead</span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<UserMinus size={14} aria-hidden />}
                    onClick={() => setCutting(p)}
                  >
                    Cut
                  </Button>
                </li>
              )
            })}
          </ul>
        </Card>
      ))}

      <ConfirmSheet
        open={!!cutting}
        onClose={() => setCutting(null)}
        eyebrow="Cutdown day"
        title={cutting ? `Cut ${cutting.name}?` : ''}
        subtitle={
          cutting
            ? `${cutting.pos} · age ${cutting.age} · ${cutting.contract.years} yr${cutting.contract.years === 1 ? '' : 's'} left`
            : undefined
        }
        consequences={cutting ? consequences(cutting) : []}
        confirmLabel={cutting ? `Cut · frees ${freedMoney(capSavings(cutting.contract))}` : 'Cut'}
        saferAlternative={cutting ? { label: 'Keep him', onClick: () => setCutting(null) } : undefined}
        ledgerNote="Logged in The Ledger"
        onConfirm={() => {
          if (!cutting) return
          releasePlayer(cutting.id)
          setCutting(null)
        }}
      />
    </div>
  )
}

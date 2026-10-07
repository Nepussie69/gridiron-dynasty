import { useMemo, useState } from 'react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
import { canSignFreeAgents } from '../game/engine/career'
import { freeAgentContract } from '../game/engine/progress'
import { waiverBlockedReason, waiverPriority } from '../game/engine/waivers'
import { canShadow } from '../game/engine/shadow'
import { accessFor } from '../game/engine/access'
import { capSummary } from '../game/selectors'
import { useGame, useWorld } from '../store/gameStore'
import { PlayerTable } from '../components/PlayerTable'
import { ShadowBoardCard, ShadowStar } from '../components/ShadowBoardCard'
import { Badge, Button, Card, PageHeader, Stat } from '../ui/kit'

const POS_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'OT', 'OG', 'C', 'DE', 'DT', 'LB', 'CB', 'S']

/** 14 -> "14th", 1 -> "1st", &c. */
function ordinal(n: number): string {
  const rem10 = n % 10
  const rem100 = n % 100
  if (rem10 === 1 && rem100 !== 11) return `${n}st`
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`
  return `${n}th`
}

export function FreeAgency() {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const signFreeAgent = useGame((s) => s.signFreeAgent)
  const claimWaiver = useGame((s) => s.claimWaiver)
  const cancelWaiverClaim = useGame((s) => s.cancelWaiverClaim)
  const [pos, setPos] = useState('ALL')
  const [q, setQ] = useState('')

  const canSign = canSignFreeAgents(career)
  const canScout = canShadow(career)
  const access = accessFor(career, 'freeagency')
  const cap = capSummary(league, career.teamId)

  // L11 W4: the waiver wire. Priority is worst-record-first; the user's own
  // released players stay on the list but cannot be re-claimed by them.
  const waiverRows = [...(league.waivers ?? [])]
    .sort((a, b) => a.week - b.week || (b.contract.capHit - a.contract.capHit))
    .map((entry) => ({ entry, player: league.players.find((p) => p.id === entry.playerId) }))
  const myPriority = Math.max(1, waiverPriority(league).indexOf(career.teamId) + 1)
  const myClaims = (league.waivers ?? []).filter((e) => e.claims.includes(career.teamId)).length

  const agents = useMemo(() => {
    let out = league.freeAgents.filter((p) => pos === 'ALL' || p.pos === pos)
    if (q) out = out.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
    return [...out].sort((a, b) => b.ovr - a.ovr)
  }, [league.freeAgents, pos, q])

  const top = league.freeAgents.reduce((best, p) => (p.ovr > best.ovr ? p : best), league.freeAgents[0])

  return (
    <div>
      <PageHeader
        eyebrow="Personnel"
        title="Free Agency"
        subtitle="Outbid rivals, structure contracts, and fill holes without mortgaging the future."
        right={
          <div className="rounded-lg border border-line bg-surface px-3 py-2">
            <span className="label">Cap Space</span>
            <div className={cn('font-display text-lg font-700 tnum leading-none', cap.space < 0 ? 'text-loss' : 'text-win')}>
              {money(cap.space)}
            </div>
          </div>
        }
      />

      {!canSign && (
        <div className="mb-4 rounded-xl border border-[#f3ddb8] bg-[#fdf0dc] p-3 text-sm text-warn">
          {access === 'advise'
            ? 'Roster building is the GM\u2019s call. You influence who the club targets \u2014 the GM signs the deal.'
            : <>You don't have roster control yet. Reach <strong>Director of Player Personnel</strong> or higher to sign free agents.</>}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><Stat label="Free Agents" value={league.freeAgents.length} sub="available now" /></Card>
        <Card><Stat label="Top Available" value={top?.ovr ?? 0} sub={top?.name} /></Card>
        <Card><Stat label="Cap Space" value={money(cap.space)} sub={`of ${money(cap.limit)}`} tone={cap.space < 5e6 ? 'loss' : 'win'} /></Card>
        <Card><Stat label="Roster Size" value={league.roster[career.teamId]?.length ?? 0} sub="53-man target" /></Card>
      </div>

      {canScout && <ShadowBoardCard className="mb-4" />}

      {/* L11 W4: Waiver Tuesday — this week's released players, worst team picks first. */}
      <Card pad={false} className="mb-4">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <div>
            <span className="label">Waiver Wire</span>
            <div className="font-display text-sm font-700">Waiver Tuesday</div>
          </div>
          <Badge tone="neutral">You pick {ordinal(myPriority)} of 32</Badge>
          <Badge tone={myClaims > 0 ? 'info' : 'neutral'}>{myClaims} of 3 claims filed</Badge>
          <span className="ml-auto text-xs text-muted">Claims resolve when you advance the week.</span>
        </div>
        {waiverRows.length === 0 ? (
          <div className="p-3 text-sm text-muted">
            No players on waivers. In-season releases land here until Tuesday.
          </div>
        ) : (
          <div className="divide-y divide-line">
            {waiverRows.map(({ entry, player }) => {
              const mine = entry.claims.includes(career.teamId)
              const fromMe = entry.fromTeamId === career.teamId
              const blocked = waiverBlockedReason(league, career.teamId, entry, true)
              const atMax = !mine && myClaims >= 3
              const disabled = !canSign || blocked !== null || atMax
              const label = !canSign
                ? 'GM decides'
                : blocked === 'cap'
                  ? 'No cap room'
                  : blocked === 'roster'
                    ? 'No roster spot'
                    : atMax
                      ? 'Max 3 claims'
                      : `Claim · ${money(entry.contract.capHit)}`
              return (
                <div key={entry.playerId} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0">
                    <div className="truncate font-600">{player?.name ?? 'Unknown'}</div>
                    <div className="text-xs text-muted">
                      {player ? `${player.pos} · ${player.ovr} OVR · age ${player.age}` : '—'}
                    </div>
                  </div>
                  <div className="text-xs text-muted">
                    {money(entry.contract.capHit)} · {entry.contract.years} yr
                  </div>
                  <div className="text-xs text-muted">
                    from {league.byId[entry.fromTeamId]?.abbr ?? entry.fromTeamId}
                  </div>
                  {fromMe ? (
                    <span className="ml-auto text-xs text-faint">Released by you</span>
                  ) : mine ? (
                    <Button
                      className="ml-auto"
                      size="sm"
                      variant="ghost"
                      onClick={() => cancelWaiverClaim(entry.playerId)}
                    >
                      Cancel claim
                    </Button>
                  ) : (
                    <Button
                      className="ml-auto"
                      size="sm"
                      variant="team"
                      disabled={disabled}
                      onClick={() => claimWaiver(entry.playerId)}
                    >
                      {label}
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <div className="flex flex-wrap gap-1">
            {POS_FILTERS.map((p) => (
              <button
                key={p}
                onClick={() => setPos(p)}
                className={cn(
                  'rounded-md px-2 py-1 font-cond text-xs font-700 uppercase transition',
                  pos === p ? 'text-[var(--team-ink)]' : 'text-muted hover:bg-surface-2',
                )}
                style={pos === p ? { background: 'var(--team)' } : undefined}
              >
                {p}
              </button>
            ))}
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search free agents…"
            className="ml-auto w-48 rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm outline-none placeholder:text-faint"
          />
          <Badge tone="neutral">{agents.length} listed</Badge>
        </div>
        <div className="p-2">
          <PlayerTable
            players={agents}
            showCollege
            right={(p) => {
              // W1: a released player's stored contract is zeroed; the real cost
              // is the priced one-year deal (pro-rated during the season).
              const deal = freeAgentContract(p, league.season, league.week, league.phase)
              const noRoom = cap.space < deal.capHit
              return (
                <div className="flex items-center justify-end gap-1.5">
                  <ShadowStar playerId={p.id} />
                  <Button
                    size="sm"
                    variant="team"
                    disabled={!canSign || noRoom}
                    onClick={() => signFreeAgent(p.id)}
                  >
                    {!canSign ? 'GM decides' : noRoom ? 'No cap room' : `Sign · ${money(deal.capHit)}`}
                  </Button>
                </div>
              )
            }}
          />
        </div>
      </Card>
    </div>
  )
}

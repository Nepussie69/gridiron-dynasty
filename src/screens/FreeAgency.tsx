import { useMemo, useState } from 'react'
import { money, ordinal } from '../lib/format'
import { canSignFreeAgents } from '../game/engine/career'
import { stageOf } from '../game/engine/draft'
import { freeAgentContract } from '../game/engine/progress'
import { cultureDiscountFor } from '../game/engine/culture'
import { negotiationAskMultiplier } from '../game/engine/skills'
import { waiverBlockedReason, waiverPriority } from '../game/engine/waivers'
import { canShadow } from '../game/engine/shadow'
import { canAskGm } from '../game/engine/gmAsk'
import { useAccessLevel, usePhone } from '../ui/hooks'
import { capVerdict } from '../ui/nav'
import { capSummary } from '../game/selectors'
import { getStatsDb, useGame, useWorld } from '../store/gameStore'
import type { CareerState, Player } from '../game/types'
import type { World } from '../game/engine/generate'
import { PlayerTable } from '../components/PlayerTable'
import { ShadowBoardCard, ShadowStar } from '../components/ShadowBoardCard'
import { GmAskButton } from '../components/GmAskButton'
import {
  AccessBanner,
  Badge,
  Button,
  Card,
  ConfirmSheet,
  FilterChip,
  KpiStrip,
  KpiTile,
  OvrBadge,
  PageHeader,
} from '../ui/kit'

const POS_FILTERS = ['ALL', 'QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'OG', 'C', 'DE', 'DT', 'LB', 'CB', 'S']

/** The priced one-year deal for a free agent, plus the culture discount applied. */
function dealFor(league: World, career: CareerState, p: Player) {
  const disc = cultureDiscountFor(league, getStatsDb(), career.teamId, p)
  const deal = freeAgentContract(
    p,
    league.season,
    league.week,
    league.phase,
    undefined,
    negotiationAskMultiplier(career.skills.negotiation),
    disc.pct,
  )
  return { deal, disc }
}

export function FreeAgency() {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const signFreeAgent = useGame((s) => s.signFreeAgent)
  const claimWaiver = useGame((s) => s.claimWaiver)
  const cancelWaiverClaim = useGame((s) => s.cancelWaiverClaim)
  const level = useAccessLevel('freeagency')
  const phone = usePhone()
  const [pos, setPos] = useState('ALL')
  const [q, setQ] = useState('')
  const [review, setReview] = useState<{ player: Player; capHit: number; annual: number; years: number } | null>(null)

  const canSign = canSignFreeAgents(career)
  const canScout = canShadow(career)
  const askGm = canAskGm(career)
  const cap = capSummary(league, career.teamId)
  const capV = capVerdict(cap.space)
  // L12.6 C3: the true market opens in March. February previews the pool only.
  const faClosed = league.phase === 'offseason' && stageOf(league) === 'resign'

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

  /** The Sign control: decide → review; coach → a single ask-the-GM recommendation; else gated. */
  const signControl = (p: Player, capHit: number, annual: number) => {
    if (canSign) {
      return (
        <Button
          size="sm"
          variant="primary"
          rowSafe
          disabled={faClosed || cap.space < capHit}
          title={
            faClosed
              ? 'Free agency opens in March'
              : cap.space < capHit
                ? `No cap room — ${money(capHit)} needed`
                : undefined
          }
          onClick={() => setReview({ player: p, capHit, annual, years: 1 })}
        >
          {faClosed ? 'Opens in March' : cap.space < capHit ? 'No cap room' : `Sign · ${money(capHit)}`}
        </Button>
      )
    }
    if (askGm) return <GmAskButton player={p} kind="sign" label={`Ask GM · ${money(capHit)}`} />
    return (
      <Button size="sm" variant="secondary" disabled title="Roster control unlocks at Director of Player Personnel">
        Sign · {money(capHit)}
      </Button>
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow="Personnel"
        title="Free Agency"
        subtitle="Outbid rivals, structure contracts, and fill holes without mortgaging the future."
      />

      <AccessBanner
        area="freeagency"
        className="mb-4"
        message={
          level === 'advise' ? (
            <>
              <b className="font-600 text-ink">Roster building is the GM&apos;s call at your rung.</b> You influence who
              the club targets — ask the GM to sign a player and he holds the pen.
            </>
          ) : undefined
        }
      />

      {faClosed && (
        <div className="mb-4 rounded-[var(--r-md)] bg-warn-soft p-3 text-small text-warn">
          Free agency opens in March. February is the re-sign window — extend your own expiring players first. The pool
          below is a preview.
        </div>
      )}

      <KpiStrip label="Free agency summary" columns="1fr 1fr 1.2fr 1fr" className="mb-4">
        <KpiTile label="Free agents" value={league.freeAgents.length} unit="available now" why={<span className="text-muted">The whole open market this week.</span>} />
        <KpiTile
          label="Top available"
          value={top?.ovr ?? 0}
          unit={top?.pos}
          why={<span className="text-muted">{top?.name ?? 'No free agents'} — the best rating on the board.</span>}
        />
        <KpiTile
          label="Cap space"
          value={money(cap.space)}
          unit={`of ${money(cap.limit)}`}
          verdict={{ label: capV.label, tone: capV.tone }}
          why={
            <span className="text-muted">
              Limit {money(cap.limit)} · floor {money(cap.floor)}. A deal only fits if its cap hit is inside this.
            </span>
          }
        />
        <KpiTile
          label="Roster size"
          value={league.roster[career.teamId]?.length ?? 0}
          unit="of 53"
          why={<span className="text-muted">Claims and signings both need a roster spot.</span>}
        />
      </KpiStrip>

      {canScout && <ShadowBoardCard className="mb-4" />}

      {/* L11 W4: Waiver Tuesday — this week's released players, worst team picks first. */}
      <Card pad={false} className="mb-4">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <div>
            <span className="label">Waiver wire</span>
            <div className="font-display text-[17px] font-800 italic uppercase text-ink">Waiver Tuesday</div>
          </div>
          <Badge tone="neutral">You pick {ordinal(myPriority)} of 32</Badge>
          <Badge tone={myClaims > 0 ? 'info' : 'neutral'}>{myClaims} of 3 claims filed</Badge>
          <span className="ml-auto text-label text-muted">Claims resolve when you advance the week.</span>
        </div>
        {waiverRows.length === 0 ? (
          <div className="p-3 text-small text-muted">No players on waivers. In-season releases land here until Tuesday.</div>
        ) : (
          <div className="divide-y divide-line">
            {waiverRows.map(({ entry, player }) => {
              const mine = entry.claims.includes(career.teamId)
              const fromMe = entry.fromTeamId === career.teamId
              const blocked = waiverBlockedReason(league, career.teamId, entry, true)
              const atMax = !mine && myClaims >= 3
              const disabled = !canSign || blocked !== null || atMax
              const label = blocked === 'cap' ? 'No cap room' : blocked === 'roster' ? 'No roster spot' : atMax ? 'Max 3 claims' : `Claim · ${money(entry.contract.capHit)}`
              return (
                <div key={entry.playerId} className="flex flex-wrap items-center gap-3 p-3">
                  {player ? <OvrBadge value={player.ovr} pot={player.pot} size={28} /> : null}
                  <div className="min-w-0">
                    <div className="truncate font-600 text-ink">{player?.name ?? 'Unknown player'}</div>
                    <div className="text-label text-muted">
                      {player ? `${player.pos} · ${player.ovr}/${player.pot} OVR · age ${player.age}` : 'No longer in the league'}
                    </div>
                  </div>
                  <div className="text-label text-muted tnum">
                    {money(entry.contract.capHit)} · {entry.contract.years} yr
                  </div>
                  <div className="text-label text-muted">from {league.byId[entry.fromTeamId]?.abbr ?? entry.fromTeamId}</div>
                  {fromMe ? (
                    <span className="ml-auto text-label text-muted">Released by you</span>
                  ) : mine ? (
                    <Button className="ml-auto" size="sm" variant="secondary" rowSafe onClick={() => cancelWaiverClaim(entry.playerId)}>
                      Cancel claim
                    </Button>
                  ) : canSign ? (
                    <Button
                      className="ml-auto"
                      size="sm"
                      variant="primary"
                      rowSafe
                      disabled={disabled}
                      onClick={() => claimWaiver(entry.playerId)}
                    >
                      {label}
                    </Button>
                  ) : (
                    <span className="ml-auto">
                      <Button size="sm" variant="secondary" disabled title="Waiver claims unlock with roster control">
                        {label}
                      </Button>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Position">
            {POS_FILTERS.map((p) => (
              <FilterChip key={p} pressed={pos === p} onChange={() => setPos(p)}>
                {p}
              </FilterChip>
            ))}
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search free agents…"
            className="ml-auto h-11 w-full max-w-xs rounded-[var(--r-md)] border border-line-strong bg-surface px-3 text-[16px] text-ink outline-none placeholder:text-faint sm:h-9 sm:text-small"
          />
          <Badge tone="neutral">{agents.length} listed</Badge>
        </div>
        <div className="p-2">
          {phone ? (
            <div className="space-y-2">
              {agents.map((p) => {
                const { deal, disc } = dealFor(league, career, p)
                return (
                  <div key={p.id} className="rounded-[var(--r-md)] border border-line bg-surface p-3">
                    <div className="flex items-start gap-3">
                      <OvrBadge value={p.ovr} pot={p.pot} size={32} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-600 text-ink">{p.name}</div>
                        <div className="text-label text-muted">
                          {p.pos} · age {p.age} · {money(deal.annual)}/yr · cap hit {money(deal.capHit)}
                        </div>
                        {disc.pct > 0 && (
                          <div className="mt-0.5 text-label font-600 text-win">
                            Winning-culture discount −{disc.pct}%
                          </div>
                        )}
                      </div>
                      <ShadowStar playerId={p.id} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {signControl(p, deal.capHit, deal.annual)}
                      <GmAskButton player={p} kind="sign" label={`Ask GM · ${money(deal.capHit)}`} />
                    </div>
                  </div>
                )
              })}
              {!agents.length && <div className="py-10 text-center text-small text-muted">No free agents match.</div>}
            </div>
          ) : (
            <PlayerTable
              players={agents}
              showCollege
              right={(p) => {
                // W1: a released player's stored contract is zeroed; the real cost
                // is the priced one-year deal (pro-rated during the season).
                // L12.9 K2: a winning-culture club gets a small discount on the ask.
                const { deal, disc } = dealFor(league, career, p)
                return (
                  <div className="flex flex-col items-end justify-end gap-1">
                    <div className="flex items-center justify-end gap-1.5">
                      <ShadowStar playerId={p.id} />
                      {signControl(p, deal.capHit, deal.annual)}
                    </div>
                    {disc.pct > 0 && (
                      <span className="text-label font-600 text-win">
                        Winning-culture discount −{disc.pct}% · {disc.reasons.join(', ')}
                      </span>
                    )}
                    <GmAskButton player={p} kind="sign" label={`Ask GM · ${money(deal.capHit)}`} />
                  </div>
                )
              }}
            />
          )}
        </div>
      </Card>

      {/* Sign review: shows the offered contract's years, total and guarantees. */}
      <ConfirmSheet
        open={!!review}
        onClose={() => setReview(null)}
        eyebrow="Free agency"
        title={review ? `Sign ${review.player.name}?` : ''}
        subtitle={review ? `${review.player.pos} · age ${review.player.age} · rated ${review.player.ovr}` : undefined}
        destructive={false}
        confirmLabel={review ? `Sign · ${money(review.capHit)}` : 'Sign'}
        ledgerNote={null}
        consequences={
          review
            ? [
                { label: 'Length', value: `${review.years} year` },
                { label: 'Total value', value: money(review.annual * review.years) },
                { label: 'Guaranteed', value: money(0) },
                { label: 'Cap hit this season', value: money(review.capHit), tone: 'warn' },
                { label: 'Cap space after', value: money(cap.space - review.capHit), tone: cap.space - review.capHit < 0 ? 'loss' : undefined },
              ]
            : []
        }
        onConfirm={() => {
          if (!review) return
          signFreeAgent(review.player.id)
          setReview(null)
        }}
      >
        <p className="mt-2 text-small text-muted">
          A one-year, unguaranteed deal at the priced ask. He can still turn it down if a rival outbids you.
        </p>
      </ConfirmSheet>
    </div>
  )
}

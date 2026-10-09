import { Handshake, Lock, PhoneCall, X, Zap } from 'lucide-react'
import { cn } from '../lib/cn'
import { playerById } from '../game/selectors'
import { assetValue, type TradeAsset } from '../game/engine/trade'
import { deadlineAssetName, type DeadlineOffer } from '../game/engine/deadline'
import type { World } from '../game/engine/generate'
import { accessFor } from '../game/engine/access'
import { useGame, useWorld } from '../store/gameStore'
import { PlayerHoverCard } from './PlayerHoverCard'
import { Badge, Button, Card, OvrBadge, SectionTitle, TeamCrest } from '../ui/kit'

/**
 * L14: trade deadline day. Shows the offers the league sent your club this week
 * and lets you take or turn each one down. Every offer is a deal `evaluateTrade`
 * already accepted, so Accept just executes it. The league-wide AI flurry is a
 * separate, off-by-default toggle because it changes rosters (and results).
 *
 * Used as the "Deadline" tab of the Trade Center and as a card on My Career.
 */
export function DeadlinePanel({ className }: { className?: string }) {
  const world = useWorld()
  const career = useGame((s) => s.career)
  const accept = useGame((s) => s.acceptDeadlineOffer)
  const decline = useGame((s) => s.declineDeadlineOffer)
  const setAI = useGame((s) => s.setDeadlineAI)

  const dl = career?.deadline
  const live = !!dl && dl.season === world.season && dl.week === world.week
  const canAct = !!career && accessFor(career, 'trades') === 'decide'

  const toggle = (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--team)]"
          checked={career?.deadlineAI === true}
          onChange={(e) => setAI(e.target.checked)}
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 font-cond text-xs font-700 uppercase tracking-wide text-ink">
            <Zap size={13} /> Let AI clubs trade on deadline day
          </span>
          <span className="mt-0.5 block text-[11px] leading-snug text-muted">
            Off by default. When on, contenders around the league buy from sellers for draft capital — that moves real
            rosters and changes game results. Your own offers below are unaffected either way.
          </span>
        </span>
      </label>
    </div>
  )

  if (!live) {
    return (
      <Card className={className}>
        <SectionTitle right={<Badge tone="neutral">Week 8</Badge>}>Trade deadline</SectionTitle>
        <p className="text-sm text-muted">
          The deadline lands midseason. When it does, contenders and sellers call your club with concrete offers — take
          one or leave it before the week is out.
        </p>
        <div className="mt-3">{toggle}</div>
      </Card>
    )
  }

  const unresolved = dl!.offers.filter((o) => !dl!.resolved.includes(o.id))
  const answered = dl!.offers.filter((o) => dl!.resolved.includes(o.id))

  return (
    <div className={cn('space-y-4', className)}>
      <Card className="border-[var(--team)]">
        <SectionTitle
          right={<Badge tone="team">Live · Week {dl!.week}</Badge>}
        >
          <span className="flex items-center gap-2">
            <PhoneCall size={18} style={{ color: 'var(--team)' }} /> Trade deadline
          </span>
        </SectionTitle>
        <p className="mb-3 text-sm text-muted">
          The phones are open. These offers are already on the table — accepting one executes the deal immediately. The
          market closes when you advance to next week.
        </p>

        {!canAct && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-warn-soft px-3 py-2 text-xs font-600 text-warn">
            <Lock size={14} /> You do not have trade authority at this rung — the club's GM handles the calls.
          </div>
        )}

        {unresolved.length ? (
          <div className="space-y-3">
            {unresolved.map((o) => (
              <OfferRow
                key={o.id}
                world={world}
                offer={o}
                resolved={false}
                canAct={canAct}
                onAccept={accept}
                onDecline={decline}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-lg bg-surface-2 px-3 py-4 text-sm text-muted">
            {dl!.offers.length
              ? 'You have answered every call. The deadline is done for this club.'
              : 'No club made a serious offer for your roster this year.'}
          </p>
        )}

        <div className="mt-4">{toggle}</div>
      </Card>

      {answered.length > 0 && (
        <Card>
          <SectionTitle right={<Badge tone="neutral">{answered.length}</Badge>}>Answered</SectionTitle>
          <div className="space-y-2">
            {answered.map((o) => {
              const accepted = dl!.resolved.includes(o.id)
              return (
                <div key={o.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2">
                  <TeamCrest team={world.byId[o.partnerId]} size={22} />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-2">{o.headline}</span>
                  <Badge tone={accepted ? 'win' : 'neutral'}>{accepted ? 'Accepted' : 'Passed'}</Badge>
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}

function OfferRow({
  world,
  offer,
  resolved,
  canAct,
  onAccept,
  onDecline,
}: {
  world: World
  offer: DeadlineOffer
  resolved: boolean
  canAct: boolean
  onAccept: (id: string) => void
  onDecline: (id: string) => void
}) {
  const gives = offer.give.reduce((s, a) => s + assetValue(world, a), 0)
  const gets = offer.get.reduce((s, a) => s + assetValue(world, a), 0)
  const net = gets - gives
  const disabled = resolved || !canAct
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-start gap-3">
        <TeamCrest team={world.byId[offer.partnerId]} size={30} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-cond text-sm font-700 uppercase tracking-wide text-ink">{offer.headline}</span>
            <Badge tone={offer.kind === 'buy' ? 'win' : 'warn'}>{offer.kind === 'buy' ? 'Buying' : 'Selling'}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted">{offer.blurb}</p>

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <AssetBox world={world} title="You give" refs={offer.give} />
            <AssetBox world={world} title="You get" refs={offer.get} />
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] tnum text-muted">
            <span>
              Value chart · give {gives.toLocaleString()} · get {gets.toLocaleString()}
            </span>
            <span className={cn('font-cond font-700 uppercase', net >= 0 ? 'text-win' : 'text-loss')}>
              Net {net >= 0 ? '+' : ''}
              {net.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <Button variant="team" size="sm" disabled={disabled} onClick={() => onAccept(offer.id)}>
          <Handshake size={14} /> Accept
        </Button>
        <Button variant="ghost" size="sm" disabled={resolved} onClick={() => onDecline(offer.id)}>
          <X size={13} /> Pass
        </Button>
      </div>
    </div>
  )
}

function AssetBox({ world, title, refs }: { world: World; title: string; refs: TradeAsset[] }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-2 px-2.5 py-2">
      <div className="label mb-1">{title}</div>
      <div className="space-y-1.5">
        {refs.map((a) => (
          <AssetLine key={`${a.kind}:${a.id}`} world={world} asset={a} />
        ))}
      </div>
    </div>
  )
}

function AssetLine({ world, asset }: { world: World; asset: TradeAsset }) {
  if (asset.kind === 'player') {
    const p = playerById(world, asset.id)
    if (!p) return null
    return (
      <div className="flex items-center gap-2">
        <OvrBadge value={p.ovr} pot={p.pot} size={26} />
        <div className="min-w-0 flex-1">
          <PlayerHoverCard player={p} className="min-w-0 text-xs font-600 text-ink" />
          <div className="truncate text-[11px] tnum text-muted">
            {p.pos} · age {p.age} · {p.contract.years} yr{p.contract.years === 1 ? '' : 's'}
          </div>
        </div>
      </div>
    )
  }
  return <div className="truncate text-xs font-600 text-ink">{deadlineAssetName(world, asset)}</div>
}

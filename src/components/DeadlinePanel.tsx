import { useState } from 'react'
import { Handshake, Lock, PhoneCall, X, Zap } from 'lucide-react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
import { playerById } from '../game/selectors'
import { assetValue, type TradeAsset } from '../game/engine/trade'
import { deadlineAssetName, type DeadlineOffer } from '../game/engine/deadline'
import type { World } from '../game/engine/generate'
import { accessFor } from '../game/engine/access'
import { useGame, useWorld } from '../store/gameStore'
import { PlayerHoverCard } from './PlayerHoverCard'
import { Badge, Button, Card, ConfirmSheet, OvrBadge, SectionTitle, TeamCrest } from '../ui/kit'

/**
 * L14: trade deadline day. Shows the offers the league sent your club this week
 * and lets you take or turn each one down. Every offer is a deal `evaluateTrade`
 * already accepted, so Accept just executes it. The league-wide AI flurry is a
 * separate, off-by-default toggle because it changes rosters (and results).
 *
 * Used as the "Deadline" tab of the Trade Center and as a card on My Career.
 *
 * D4: the accepted/passed history is tracked from the decision you made here
 * (`resolved` only records that an offer was answered, not how); each asset
 * shows its cap hit; and Pass is gated by trade authority like Accept.
 */
export function DeadlinePanel({ className }: { className?: string }) {
  const world = useWorld()
  const career = useGame((s) => s.career)
  const accept = useGame((s) => s.acceptDeadlineOffer)
  const decline = useGame((s) => s.declineDeadlineOffer)
  const setAI = useGame((s) => s.setDeadlineAI)

  // How each offer was answered this session (accept vs pass); the store only
  // records that it was resolved. Kept local — no save field.
  const [answers, setAnswers] = useState<Record<string, 'accept' | 'pass'>>({})
  const [confirm, setConfirm] = useState<{ offer: DeadlineOffer; action: 'accept' | 'pass' } | null>(null)

  const dl = career?.deadline
  const live = !!dl && dl.season === world.season && dl.week === world.week
  const canAct = !!career && accessFor(career, 'trades') === 'decide'

  const resolve = (offer: DeadlineOffer, action: 'accept' | 'pass') => {
    setAnswers((cur) => ({ ...cur, [offer.id]: action }))
    if (action === 'accept') accept(offer.id)
    else decline(offer.id)
  }

  const toggle = (
    <div className="rounded-[var(--r-md)] border border-line bg-surface-2 p-3">
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--team-accent)]"
          checked={career?.deadlineAI === true}
          onChange={(e) => setAI(e.target.checked)}
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 font-cond text-small font-700 uppercase tracking-wide text-ink">
            <Zap size={13} aria-hidden /> Let AI clubs trade on deadline day
          </span>
          <span className="mt-0.5 block text-label leading-snug text-muted">
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
        <p className="text-small text-muted">
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
      <Card className="border-[var(--team-accent)]">
        <SectionTitle right={<Badge tone="neutral">Live · Week {dl!.week}</Badge>}>
          <span className="flex items-center gap-2">
            <PhoneCall size={18} className="text-[var(--team-accent-text)]" aria-hidden /> Trade deadline
          </span>
        </SectionTitle>
        <p className="mb-3 text-small text-muted">
          The phones are open. These offers are already on the table — accepting one executes the deal immediately. The
          market closes when you advance to next week.
        </p>

        {!canAct && (
          <div className="mb-3 flex items-center gap-2 rounded-[var(--r-sm)] bg-warn-soft px-3 py-2 text-small font-600 text-warn">
            <Lock size={14} aria-hidden /> You do not have trade authority at this rung — the club&apos;s GM handles the
            calls, so Accept and Pass are locked here.
          </div>
        )}

        {unresolved.length ? (
          <div className="space-y-3">
            {unresolved.map((o) => (
              <OfferRow
                key={o.id}
                world={world}
                offer={o}
                canAct={canAct}
                onAsk={(action) => setConfirm({ offer: o, action })}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-[var(--r-sm)] bg-surface-2 px-3 py-4 text-small text-muted">
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
              const decision = answers[o.id]
              return (
                <div key={o.id} className="flex flex-wrap items-center gap-2 rounded-[var(--r-sm)] bg-surface-2 px-3 py-2">
                  <TeamCrest team={world.byId[o.partnerId]} size={22} />
                  <span className="min-w-0 flex-1 truncate text-small text-ink-2">{o.headline}</span>
                  <CapLine world={world} give={o.give} get={o.get} className="w-full sm:w-auto" />
                  <Badge tone={decision === 'accept' ? 'win' : decision === 'pass' ? 'neutral' : 'neutral'}>
                    {decision === 'accept' ? 'Accepted' : decision === 'pass' ? 'Passed' : 'Answered'}
                  </Badge>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {confirm && (
        <ConfirmSheet
          open
          onClose={() => setConfirm(null)}
          eyebrow="Deadline call"
          title={confirm.action === 'accept' ? 'Accept this offer?' : 'Pass on this offer?'}
          subtitle={confirm.offer.headline}
          destructive={confirm.action === 'pass'}
          confirmLabel={confirm.action === 'accept' ? 'Accept the trade' : 'Pass'}
          ledgerNote={null}
          consequences={[
            { label: 'You give', value: confirm.offer.give.map((a) => deadlineAssetName(world, a)).join(', ') || 'Nothing' },
            { label: 'You get', value: confirm.offer.get.map((a) => deadlineAssetName(world, a)).join(', ') || 'Nothing' },
            {
              label: 'Cap this season',
              value: `${money(capNet(world, confirm.offer.give, confirm.offer.get), { sign: true })}`,
            },
          ]}
          onConfirm={() => {
            resolve(confirm.offer, confirm.action)
            setConfirm(null)
          }}
        >
          <p className="mt-2 text-small text-muted">
            {confirm.action === 'accept'
              ? 'This executes the deal immediately. The phones close when you advance the week.'
              : 'Declining is final for this offer; the club may not call again.'}
          </p>
        </ConfirmSheet>
      )}
    </div>
  )
}

function capOf(world: World, a: TradeAsset): number {
  if (a.kind !== 'player') return 0
  return playerById(world, a.id)?.contract.capHit ?? 0
}

/** Incoming minus outgoing cap hits for the user this season. */
function capNet(world: World, give: TradeAsset[], get: TradeAsset[]): number {
  return get.reduce((s, a) => s + capOf(world, a), 0) - give.reduce((s, a) => s + capOf(world, a), 0)
}

function CapLine({ world, give, get, className }: { world: World; give: TradeAsset[]; get: TradeAsset[]; className?: string }) {
  const inCap = get.reduce((s, a) => s + capOf(world, a), 0)
  const outCap = give.reduce((s, a) => s + capOf(world, a), 0)
  const net = inCap - outCap
  return (
    <span className={cn('text-label tnum text-muted', className)}>
      cap in {money(inCap)} · out {money(outCap)} ·{' '}
      <b className={cn('font-700', net > 0 ? 'text-warn' : net < 0 ? 'text-win' : 'text-ink-2')}>
        {net > 0 ? `costs ${money(net)}` : net < 0 ? `frees ${money(-net)}` : 'no change'}
      </b>
    </span>
  )
}

function OfferRow({
  world,
  offer,
  canAct,
  onAsk,
}: {
  world: World
  offer: DeadlineOffer
  canAct: boolean
  onAsk: (action: 'accept' | 'pass') => void
}) {
  const gives = offer.give.reduce((s, a) => s + assetValue(world, a), 0)
  const gets = offer.get.reduce((s, a) => s + assetValue(world, a), 0)
  const net = gets - gives
  return (
    <div className="rounded-[var(--r-md)] border border-line p-3">
      <div className="flex items-start gap-3">
        <TeamCrest team={world.byId[offer.partnerId]} size={30} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-cond text-body font-700 uppercase tracking-wide text-ink">{offer.headline}</span>
            <Badge tone={offer.kind === 'buy' ? 'win' : 'warn'}>{offer.kind === 'buy' ? 'Buying' : 'Selling'}</Badge>
          </div>
          <p className="mt-1 text-small text-muted">{offer.blurb}</p>

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <AssetBox world={world} title="You give" refs={offer.give} />
            <AssetBox world={world} title="You get" refs={offer.get} />
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-label tnum text-muted">
            <span>
              Value chart · give {gives.toLocaleString()} · get {gets.toLocaleString()} pts
            </span>
            <span className={cn('font-cond font-700 uppercase', net >= 0 ? 'text-win' : 'text-loss')}>
              Net {net >= 0 ? '+' : ''}
              {net.toLocaleString()} pts
            </span>
          </div>
          <CapLine world={world} give={offer.give} get={offer.get} className="mt-1 block" />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" disabled={!canAct} onClick={() => onAsk('accept')}>
          <Handshake size={14} /> Accept…
        </Button>
        <Button variant="secondary" size="sm" disabled={!canAct} onClick={() => onAsk('pass')}>
          <X size={13} /> Pass…
        </Button>
      </div>
    </div>
  )
}

function AssetBox({ world, title, refs }: { world: World; title: string; refs: TradeAsset[] }) {
  return (
    <div className="min-w-0 rounded-[var(--r-sm)] bg-surface-2 px-2.5 py-2">
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
          <PlayerHoverCard player={p} className="min-w-0 text-small font-600 text-ink" />
          <div className="truncate text-label tnum text-muted">
            {p.pos} · age {p.age} · {money(p.contract.capHit)} · {p.contract.years} yr{p.contract.years === 1 ? '' : 's'}
          </div>
        </div>
      </div>
    )
  }
  return <div className="truncate text-small font-600 text-ink">{deadlineAssetName(world, asset)}</div>
}

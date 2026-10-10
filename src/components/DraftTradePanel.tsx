import { Clock, Handshake, Lock, TrendingDown, TrendingUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '../lib/cn'
import { accessFor } from '../game/engine/access'
import { currentRound, draftOpen, overallPick } from '../game/engine/draft'
import {
  buildDraftTradeDownOffers,
  buildDraftTradeUpTargets,
  draftAssetName,
  type DraftTradeOffer,
} from '../game/engine/draftTrades'
import type { World } from '../game/engine/generate'
import type { TradeAsset } from '../game/engine/trade'
import { playerById } from '../game/selectors'
import { useGame, useWorld } from '../store/gameStore'
import { PlayerHoverCard } from './PlayerHoverCard'
import { Badge, Button, Card, ConfirmSheet, OvrBadge, SectionTitle, TeamCrest, type Consequence } from '../ui/kit'

/** Seconds on the optional pick clock. */
const CLOCK_SECONDS = 90

/**
 * L14: draft-day trades. While your club is on the clock, rival clubs call with
 * concrete offers for the pick, priced by the draft value chart — take one to
 * move back, or make your selection. Before your pick comes up, buy a club out
 * of its slot to move up. The pick clock is off by default; when on, it auto-takes
 * the top name on your board at zero. AI-vs-AI drafts are untouched unless you act.
 *
 * Rendered on the Draft screen. Accepting is irreversible, so every deal opens a
 * ConfirmSheet that lists both sides and the value-chart net before it lands.
 */
export function DraftTradePanel({ className }: { className?: string }) {
  const world = useWorld()
  const career = useGame((s) => s.career)
  const accept = useGame((s) => s.acceptDraftTradeOffer)
  const tradeUp = useGame((s) => s.proposeDraftTradeUp)
  const setClock = useGame((s) => s.setDraftClock)
  const expire = useGame((s) => s.draftClockExpired)
  const [pending, setPending] = useState<{ offer: DraftTradeOffer; up: boolean } | null>(null)

  const open = draftOpen(world) && !world.draftState.complete
  const canTrade = !!career && accessFor(career, 'trades') === 'decide'
  const deciding = !!career && accessFor(career, 'draft') === 'decide'
  const pickIndex = world.draftState.pickIndex
  const mine = open && deciding && !!career && world.draftOrder[pickIndex] === career.teamId

  // The engine memoises both searches per world/stamp, so calling them every
  // render is cheap and always reflects the current slot.
  const down = open && mine && canTrade && career ? buildDraftTradeDownOffers(world, career.teamId) : []
  const up = open && !mine && canTrade && deciding && career ? buildDraftTradeUpTargets(world, career.teamId, 5) : []

  const clockOn = career?.draftClock === true

  if (!open) {
    return (
      <Card className={className}>
        <SectionTitle right={<Badge tone="neutral">April</Badge>}>Draft-day trades</SectionTitle>
        <p className="text-small text-muted">
          On draft day, rival clubs call about your picks. Trade back for a package, or move up for a prospect you
          covet — every offer is priced by the draft value chart.
        </p>
      </Card>
    )
  }

  const pendingConsequences = (p: { offer: DraftTradeOffer; up: boolean }): Consequence[] => {
    const net = p.offer.getValue - p.offer.giveValue
    return [
      { label: 'You give', value: <AssetNames world={world} refs={p.offer.give} /> },
      { label: 'You get', value: <AssetNames world={world} refs={p.offer.get} /> },
      {
        label: 'Value chart',
        value: `give ${p.offer.giveValue.toLocaleString()} · get ${p.offer.getValue.toLocaleString()}`,
      },
      {
        label: 'Net',
        value: `${net >= 0 ? '+' : ''}${net.toLocaleString()} pts`,
        tone: net >= 0 ? 'win' : 'loss',
      },
      { label: 'Partner', value: world.byId[p.offer.partnerId]?.name ?? p.offer.partnerId },
    ]
  }

  return (
    <Card className={cn(mine && 'border-line-strong', className)}>
      <SectionTitle
        right={
          mine ? (
            <Badge tone="warn">On the clock</Badge>
          ) : (
            <Badge tone="neutral">
              Rd {currentRound(world)} · Pick {overallPick(world)}
            </Badge>
          )
        }
      >
        <span className="flex items-center gap-2">
          <Handshake size={18} className="text-[var(--team-accent-text)]" aria-hidden /> Draft-day trades
        </span>
      </SectionTitle>

      {!canTrade && (
        <div className="mb-3 flex items-center gap-2 rounded-[var(--r-md)] bg-warn-soft px-3 py-2 text-small font-600 text-warn">
          <Lock size={14} aria-hidden /> You do not have trade authority at this rung — the club&rsquo;s GM handles the calls.
        </div>
      )}

      <div className="mb-3 rounded-[var(--r-md)] border border-line bg-surface-2 p-3">
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--team-accent)]"
            checked={clockOn}
            onChange={(e) => setClock(e.target.checked)}
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 font-cond text-small font-700 uppercase tracking-wide text-ink">
              <Clock size={13} aria-hidden /> Pick clock
              {clockOn && mine && <PickClock key={pickIndex} on onExpire={expire} />}
            </span>
            <span className="mt-0.5 block text-micro leading-snug text-muted">
              Off by default. When on, a 90-second clock runs while you are on the clock; if it runs out your club takes
              the top name on your board.
            </span>
          </span>
        </label>
      </div>

      {mine ? (
        down.length ? (
          <div className="space-y-3">
            <p className="text-small text-muted">
              Calls are coming in for the pick on the clock. Accept one to move back and stockpile assets.
            </p>
            {down.map((o) => (
              <OfferRow key={o.id} world={world} offer={o} canAct={canTrade} onAsk={() => setPending({ offer: o, up: false })} />
            ))}
          </div>
        ) : (
          <p className="rounded-[var(--r-md)] bg-surface-2 px-3 py-4 text-small text-muted">
            No club has made a serious offer for this pick. Make your selection.
          </p>
        )
      ) : up.length ? (
        <div className="space-y-3">
          <p className="text-small text-muted">
            Your pick is still ahead. Buy a club out of its slot to move up for a prospect you covet.
          </p>
          {up.map((o) => (
            <OfferRow key={o.id} world={world} offer={o} canAct={canTrade} onAsk={() => setPending({ offer: o, up: true })} up />
          ))}
        </div>
      ) : (
        <p className="rounded-[var(--r-md)] bg-surface-2 px-3 py-4 text-small text-muted">
          No trade-up offers available right now. Sim to your pick, or let the board come to you.
        </p>
      )}

      <ConfirmSheet
        open={!!pending}
        onClose={() => setPending(null)}
        eyebrow="Draft-day trade"
        title={pending ? pending.offer.headline : ''}
        subtitle={pending ? (pending.up ? 'Move up for a prospect you covet' : 'Move back and stockpile assets') : undefined}
        destructive={false}
        consequences={pending ? pendingConsequences(pending) : []}
        confirmLabel={pending ? (pending.up ? 'Trade up' : 'Accept the trade') : 'Accept'}
        ledgerNote={null}
        onConfirm={() => {
          if (!pending) return
          if (pending.up) tradeUp(pending.offer.id)
          else accept(pending.offer.id)
          setPending(null)
        }}
      />
    </Card>
  )
}

/** A live countdown for the current pick. Remounts per pick, so it always starts fresh. */
function PickClock({ on, onExpire }: { on: boolean; onExpire: () => void }) {
  const [left, setLeft] = useState(CLOCK_SECONDS)
  useEffect(() => {
    if (!on) return
    const t0 = Date.now()
    const iv = window.setInterval(() => {
      const remain = CLOCK_SECONDS - Math.floor((Date.now() - t0) / 1000)
      setLeft(remain)
      if (remain <= 0) {
        window.clearInterval(iv)
        onExpire()
      }
    }, 500)
    return () => window.clearInterval(iv)
  }, [on, onExpire])
  const safe = Math.max(0, left)
  const mm = Math.floor(safe / 60)
  const ss = safe % 60
  return (
    <span className={cn('font-cond text-small font-700 tnum', safe <= 15 ? 'text-loss' : 'text-ink')}>
      {mm}:{String(ss).padStart(2, '0')}
    </span>
  )
}

function OfferRow({
  world,
  offer,
  canAct,
  onAsk,
  up = false,
}: {
  world: World
  offer: DraftTradeOffer
  canAct: boolean
  onAsk: () => void
  up?: boolean
}) {
  const net = offer.getValue - offer.giveValue
  return (
    <div className="rounded-[var(--r-md)] border border-line p-3">
      <div className="flex items-start gap-3">
        <TeamCrest team={world.byId[offer.partnerId]} size={30} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 font-cond text-small font-700 uppercase tracking-wide text-ink">
              {offer.headline}
            </span>
            <Badge tone={up ? 'win' : 'neutral'}>
              {up ? <TrendingUp size={11} aria-hidden /> : <TrendingDown size={11} aria-hidden />} {up ? 'Move up' : 'Move back'}
            </Badge>
          </div>
          <p className="mt-1 text-small text-muted">{offer.blurb}</p>

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <AssetBox world={world} title="You give" refs={offer.give} />
            <AssetBox world={world} title="You get" refs={offer.get} />
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-small tnum text-muted">
            <span>
              Value chart · give {offer.giveValue.toLocaleString()} · get {offer.getValue.toLocaleString()}
            </span>
            <span className={cn('font-cond font-700 uppercase', net >= 0 ? 'text-win' : 'text-loss')}>
              Net {net >= 0 ? '+' : ''}
              {net.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3">
        <Button variant="secondary" size="sm" disabled={!canAct} onClick={onAsk}>
          <Handshake size={14} aria-hidden /> Review {up ? 'trade' : 'offer'}
        </Button>
      </div>
    </div>
  )
}

function AssetBox({ world, title, refs }: { world: World; title: string; refs: TradeAsset[] }) {
  return (
    <div className="min-w-0 rounded-[var(--r-md)] bg-surface-2 px-2.5 py-2">
      <div className="label mb-1">{title}</div>
      <div className="space-y-1.5">
        {refs.map((a) => (
          <AssetLine key={`${a.kind}:${a.id}`} world={world} asset={a} />
        ))}
      </div>
    </div>
  )
}

/** The asset list as a plain string for the ConfirmSheet key/value rows. */
function AssetNames({ world, refs }: { world: World; refs: TradeAsset[] }) {
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      {refs.map((a) => (
        <span key={`${a.kind}:${a.id}`}>{a.kind === 'player' ? (playerById(world, a.id)?.name ?? 'Player') : draftAssetName(world, a)}</span>
      ))}
    </span>
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
          <div className="truncate text-micro tnum text-muted">
            {p.pos} · age {p.age} · {p.contract.years} yr{p.contract.years === 1 ? '' : 's'}
          </div>
        </div>
      </div>
    )
  }
  return <div className="truncate text-small font-600 text-ink">{draftAssetName(world, asset)}</div>
}

import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { ArrowLeftRight, Handshake, Plus, Search, Tag, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
import { capSummary, playerById, rosterOf } from '../game/selectors'
import { picksOwnedBy } from '../game/engine/picks'
import {
  assetValue,
  evaluateTrade,
  findDeals,
  findPackagesFor,
  findTargetsAtPosition,
  isTradeablePick,
  pickTradeValue,
  playerTradeValue,
  upcomingDraftSeason,
  type DealOffer,
  type TradeAsset,
} from '../game/engine/trade'
import { tradeBlock, type TradeBlockEntry } from '../game/engine/tradeBlock'
import { clearTradeRequest, peekTradeRequest } from '../game/tradeRequest'
import { canShadow } from '../game/engine/shadow'
import { NFL_TEAMS } from '../game/data/nflTeams'
import type { Player, Position } from '../game/types'
import type { World } from '../game/engine/generate'
import { useGame, useWorld } from '../store/gameStore'
import { ShadowBoardCard, ShadowStar } from '../components/ShadowBoardCard'
import { DeadlinePanel } from '../components/DeadlinePanel'
import { GmAskButton } from '../components/GmAskButton'
import { HoverCard } from '../components/HoverCard'
import { PlayerHoverCard } from '../components/PlayerHoverCard'
import { Badge, Button, Card, ConfirmSheet, FilterChip, IconButton, OvrBadge, PageHeader, SectionTitle, Tabs, TeamCrest } from '../ui/kit'
import { usePhone } from '../ui/hooks'

interface Asset {
  id: string
  kind: 'player' | 'pick'
  label: string
  sub: string
  value: number
  ovr?: number
  pot?: number
  round?: number
  season?: number
}

const toRef = (a: Asset): TradeAsset => ({ kind: a.kind, id: a.id })

/** Which way the deal card reads: selling one of your players, or buying theirs. */
type DealMode = 'sell' | 'buy'

/** L12.5 T5: the Trade Center's tabs (L14 adds the deadline board). */
type TabId = 'deadline' | 'build' | 'block' | 'position'

const TABS: [TabId, string][] = [
  ['deadline', 'Deadline'],
  ['build', 'Build a trade'],
  ['block', 'Trade block'],
  ['position', 'Find by position'],
]

export function Trades() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const career = useGame((s) => s.career)
  const proposeTrade = useGame((s) => s.proposeTrade)
  const toggleTradeBlock = useGame((s) => s.toggleTradeBlock)
  const viewTeam = useGame((s) => s.viewTeam)

  // L12.8 V1: a club page can hand off "trade for this player". Consume it once.
  const request = peekTradeRequest()

  // D4: open on the Deadline tab when the league has live offers on the table.
  const [tab, setTab] = useState<TabId>(() => {
    const d = career?.deadline
    const open =
      d && d.season === league.season && d.week === league.week ? d.offers.filter((o) => !d.resolved.includes(o.id)).length : 0
    return open > 0 ? 'deadline' : 'build'
  })
  const phone = usePhone()
  const [review, setReview] = useState(false)
  // U4: the middle tray highlights while an asset is dragged over it.
  const [dragOver, setDragOver] = useState(false)
  const [partnerId, setPartnerId] = useState(
    () => (request && league.byId[request.teamId] ? request.teamId : NFL_TEAMS.find((t) => t.id !== activeTeamId)!.id),
  )
  const [give, setGive] = useState<Asset[]>([])
  const [get, setGet] = useState<Asset[]>(() => {
    if (!request) return []
    const asset = assetsFor(league, request.teamId).find((a) => a.id === request.playerId)
    return asset ? [asset] : []
  })
  const [deal, setDeal] = useState<{ asset: Asset; mode: DealMode } | null>(null)
  const [deals, setDeals] = useState<DealOffer[]>([])

  useEffect(() => {
    clearTradeRequest()
  }, [])

  const team = league.byId[activeTeamId]
  const partner = league.byId[partnerId]
  const canScout = !!career && canShadow(career)
  const blockIds = career?.tradeBlock ?? []
  // L14: how many deadline offers are still unanswered this week (tab badge).
  const dl = career?.deadline
  const deadlineLive = !!dl && dl.season === league.season && dl.week === league.week
  const deadlineOpen = deadlineLive ? dl!.offers.filter((o) => !dl!.resolved.includes(o.id)).length : 0

  const myAssets = useMemo(() => assetsFor(league, activeTeamId), [league, activeTeamId])
  const theirAssets = useMemo(() => assetsFor(league, partnerId), [league, partnerId])

  const giveVal = give.reduce((s, a) => s + a.value, 0)
  const getVal = get.reduce((s, a) => s + a.value, 0)
  // D4: the tray carries the cap picture too (this season's incoming hits,
  // outgoing hits, and the space left after the deal).
  const capIn = get.reduce((s, a) => s + capOf(league, toRef(a)), 0)
  const capOut = give.reduce((s, a) => s + capOf(league, toRef(a)), 0)
  const capNet = capIn - capOut
  const capSpace = capSummary(league, activeTeamId).space
  const capAfter = capSpace - capNet

  const verdict = useMemo(
    () => evaluateTrade(league, partnerId, activeTeamId, give.map(toRef), get.map(toRef)),
    [league, partnerId, activeTeamId, give, get],
  )

  const toggle = (list: Asset[], setList: (a: Asset[]) => void, asset: Asset) => {
    setList(list.some((a) => a.id === asset.id) ? list.filter((a) => a.id !== asset.id) : [...list, asset])
  }

  const onPropose = () => {
    const res = proposeTrade(partnerId, give.map(toRef), get.map(toRef))
    if (res.accepted) {
      setGive([])
      setGet([])
    }
  }

  const onFindDeals = (a: Asset, mode: DealMode) => {
    setDeal({ asset: a, mode })
    setDeals(mode === 'sell' ? findDeals(league, activeTeamId, a.id) : findPackagesFor(league, activeTeamId, a.id))
  }

  const onLoadDeal = (o: DealOffer) => {
    setPartnerId(o.partnerId)
    setGive(resolveAssets(league, activeTeamId, o.give))
    setGet(resolveAssets(league, o.partnerId, o.get))
    setDeal(null)
    setTab('build')
  }

  const canTrade = give.length > 0 && get.length > 0

  // U4: drag an asset row into the middle tray (click-to-add still works).
  const addAsset = (a: Asset, kind: 'give' | 'get') => {
    if (kind === 'give') setGive((list) => (list.some((x) => x.id === a.id) ? list : [...list, a]))
    else setGet((list) => (list.some((x) => x.id === a.id) ? list : [...list, a]))
  }

  const onTrayDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }

  const onTrayDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const raw = e.dataTransfer.getData('application/gd-asset') || e.dataTransfer.getData('text/plain')
    if (!raw) return
    try {
      const { id, kind } = JSON.parse(raw) as { id: string; kind: 'give' | 'get' }
      const a = (kind === 'give' ? myAssets : theirAssets).find((x) => x.id === id)
      if (a) addAsset(a, kind)
    } catch {
      /* ignore malformed payloads */
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Personnel"
        title="Trade Center"
        subtitle="Draft capital is currency. Find a partner, balance the value chart, and pull the trigger — the other club has to want the deal."
        right={
          <select
            value={partnerId}
            onChange={(e) => {
              setPartnerId(e.target.value)
              setGet([])
            }}
            className="rounded-lg border border-line bg-surface min-h-11 px-3 py-2 font-cond text-base font-600 outline-none lg:min-h-0 lg:text-sm"
          >
            {NFL_TEAMS.filter((t) => t.id !== activeTeamId).map((t) => (
              <option key={t.id} value={t.id}>
                {t.city} {t.name}
              </option>
            ))}
          </select>
        }
      />

      <Tabs
        label="Trade Center sections"
        value={tab}
        onChange={setTab}
        stretch={phone}
        className="mb-4"
        tabs={TABS.map(([id, label]) => ({
          id,
          label,
          count: id === 'deadline' && deadlineOpen > 0 ? deadlineOpen : undefined,
        }))}
      />

      {tab === 'deadline' && <DeadlinePanel className="mb-4" />}

      {tab === 'build' && (
        <>
          {canScout && <ShadowBoardCard className="mb-4" />}

          {deal && (
        <Card className="mb-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="font-display text-lg font-700 uppercase tracking-wide text-ink">
              {deal.mode === 'sell' ? `Deals for ${deal.asset.label}` : `Packages for ${deal.asset.label}`}
            </h3>
            <IconButton label="Close deals list" size="sm" onClick={() => setDeal(null)}>
              <X size={16} />
            </IconButton>
          </div>
          {deals.length ? (
            <div className="grid gap-2 md:grid-cols-2">
              {deals.map((o) => {
                const cost = o.give.reduce((s, a) => s + assetValue(league, a), 0)
                return (
                  <div
                    key={`${o.partnerId}-${o.give.map((a) => a.id).join('-')}`}
                    className="flex items-center gap-3 rounded-lg border border-line px-3 py-2"
                  >
                    <TeamCrest team={league.byId[o.partnerId]} size={26} />
                    <DealHover world={league} offer={o} className="min-w-0 flex-1">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-600 text-ink">{o.summary}</div>
                        <div className="text-label tnum text-muted">
                          {deal.mode === 'sell'
                            ? `Value back ${Math.round(o.userValue).toLocaleString()} pts · for ${Math.round(deal.asset.value).toLocaleString()} pts`
                            : `You give ${Math.round(cost).toLocaleString()} pts · get ${Math.round(o.userValue).toLocaleString()} pts`}
                        </div>
                      </div>
                    </DealHover>
                    <Button variant="primary" onClick={() => onLoadDeal(o)}>
                      Load deal
                    </Button>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted">
              {deal.mode === 'sell'
                ? `No club will pay real value for ${deal.asset.label} right now.`
                : `No package you can put together lands ${deal.asset.label} right now.`}
            </p>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_300px_1fr]">
        <AssetColumn
          title={`${team.abbr} Sends`}
          teamId={activeTeamId}
          assets={myAssets}
          selected={give}
          dragKind="give"
          onToggle={(a) => toggle(give, setGive, a)}
          onFindDeals={(a) => onFindDeals(a, 'sell')}
          blockIds={blockIds}
          onToggleBlock={(a) => toggleTradeBlock(a.id)}
          onTeamClick={() => viewTeam(activeTeamId)}
        />

        <div
          onDragOver={onTrayDragOver}
          onDragLeave={(e) => {
            // Ignore dragleave events that fire when the pointer crosses into a child.
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
          }}
          onDrop={onTrayDrop}
          className={cn(
            'flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-3 transition-colors',
            dragOver ? 'border-[var(--team)] bg-[var(--team-soft)]' : 'border-transparent',
          )}
        >
          <div className="grid h-14 w-14 place-items-center rounded-full bg-ink text-canvas">
            <ArrowLeftRight size={22} />
          </div>
          <div className="w-full rounded-[var(--r-lg)] border border-line bg-surface p-4 text-center">
            <div className="label mb-2">Trade Value</div>
            <div className="flex items-end justify-between">
              <div>
                <div className="font-display text-[26px] font-800 italic leading-none text-ink tnum">{giveVal.toLocaleString()}</div>
                <div className="label">You give · pts</div>
              </div>
              <div>
                <div className="font-display text-[26px] font-800 italic leading-none text-ink-2 tnum">{getVal.toLocaleString()}</div>
                <div className="label">You get · pts</div>
              </div>
            </div>
            <div className="mt-1.5 text-label text-muted tnum">
              Net value{' '}
              <b className={cn('font-700', getVal - giveVal >= 0 ? 'text-win' : 'text-loss')}>
                {getVal - giveVal >= 0 ? '+' : '−'}
                {Math.abs(getVal - giveVal).toLocaleString()} pts
              </b>
            </div>

            <div
              className={cn(
                'mt-3 rounded-[var(--r-sm)] px-3 py-2 font-cond text-small font-700 uppercase',
                !give.length && !get.length
                  ? 'bg-surface-2 text-muted'
                  : verdict.verdict === 'accept' ? 'bg-win-soft text-win' : verdict.verdict === 'close' ? 'bg-warn-soft text-warn' : 'bg-loss-soft text-loss',
              )}
            >
              {!give.length && !get.length
                ? 'Add players or picks to build a trade'
                : verdict.verdict === 'accept'
                  ? 'They accept'
                  : verdict.verdict === 'close'
                    ? 'Close — needs more'
                    : 'They decline'}
            </div>
            {canTrade && <p className="mt-2 text-label leading-snug text-muted">{verdict.reason}</p>}

            <dl className="mt-3 space-y-1 rounded-[var(--r-sm)] bg-surface-2 px-3 py-2 text-left text-label tnum">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">Cap in (you get)</dt>
                <dd className="font-600 text-ink">{money(capIn)}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">Cap out (you send)</dt>
                <dd className="font-600 text-ink">{money(capOut)}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">Space after</dt>
                <dd className={cn('font-700', capAfter < 0 ? 'text-loss' : 'text-ink')}>
                  {money(capAfter)}
                  <span className="ml-1 font-600 text-muted">
                    ({capNet >= 0 ? '+' : '−'}
                    {money(Math.abs(capNet))})
                  </span>
                </dd>
              </div>
            </dl>

            <p className={cn('mt-2 text-label', dragOver ? 'font-600 text-ink' : 'text-faint')}>
              {dragOver ? 'Drop to add it to the deal' : 'Drag assets here — click still works.'}
            </p>

            {career && career.tier !== 'NFL' ? (
              <div className="mt-3">
                <Button variant="secondary" className="w-full" disabled>
                  <Handshake size={15} /> Propose Trade
                </Button>
                <p className="mt-2 text-label text-warn">Trades unlock in the NFL.</p>
              </div>
            ) : (
              <Button variant="primary" className="mt-3 w-full" disabled={!canTrade} onClick={() => setReview(true)}>
                <Handshake size={15} /> Review trade
              </Button>
            )}
          </div>
        </div>

        <AssetColumn
          title={`${partner.abbr} Sends`}
          teamId={partnerId}
          assets={theirAssets}
          selected={get}
          dragKind="get"
          onToggle={(a) => toggle(get, setGet, a)}
          onFindDeals={(a) => onFindDeals(a, 'buy')}
          showShadow={canScout}
          showGmAsk
          onTeamClick={() => viewTeam(partnerId)}
        />
      </div>
        </>
      )}

      {tab === 'position' && <PositionFinder onLoadDeal={onLoadDeal} />}
      {tab === 'block' && <TradeBlockTab onLoadDeal={onLoadDeal} />}

      <ConfirmSheet
        open={review}
        onClose={() => setReview(false)}
        eyebrow="Trade review"
        title={`Propose to the ${partner.name}?`}
        subtitle={`${giveVal.toLocaleString()} pts out · ${getVal.toLocaleString()} pts in · they read it as "${verdict.verdict === 'accept' ? 'accept' : verdict.verdict === 'close' ? 'close' : 'decline'}"`}
        destructive={false}
        confirmLabel="Send the offer"
        ledgerNote={null}
        consequences={[
          { label: 'You give', value: give.map((a) => a.label).join(', ') || 'Nothing' },
          { label: 'You get', value: get.map((a) => a.label).join(', ') || 'Nothing' },
          {
            label: 'Value',
            value: `${giveVal.toLocaleString()} → ${getVal.toLocaleString()} pts (net ${getVal - giveVal >= 0 ? '+' : '−'}${Math.abs(getVal - giveVal).toLocaleString()})`,
          },
          { label: 'Cap in / out', value: `${money(capIn)} / ${money(capOut)}` },
          {
            label: 'Cap space after',
            value: money(capAfter),
            tone: capAfter < 0 ? 'loss' : undefined,
          },
          {
            label: 'Their read',
            value:
              verdict.verdict === 'accept' ? 'They accept' : verdict.verdict === 'close' ? 'Close — needs more' : 'They decline',
            tone: verdict.verdict === 'accept' ? 'win' : verdict.verdict === 'close' ? 'warn' : 'loss',
          },
        ]}
        onConfirm={() => {
          setReview(false)
          onPropose()
        }}
      >
        <p className="mt-2 text-small text-muted">{verdict.reason}</p>
      </ConfirmSheet>
    </div>
  )
}

// ── T4: find by position ─────────────────────────────────────────────────────

const POSITIONS: Position[] = ['QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'OG', 'C', 'DE', 'DT', 'LB', 'CB', 'S', 'K', 'P']
const POSITION_FILTERS: (Position | 'ALL')[] = ['ALL', ...POSITIONS]
const MIN_OVR_OPTIONS = [60, 65, 70, 75, 80, 85, 90, 95]
const MAX_AGE_OPTIONS: (number | 'any')[] = ['any', 26, 29, 32]

/**
 * L12.5 T4: "I want a WR". Picks a position (and optional OVR / age floor),
 * then on Search lists the best gettable players with the cheapest package the
 * user could offer for each. Load deal drops it onto the Build tab.
 */
function PositionFinder({ onLoadDeal }: { onLoadDeal: (o: DealOffer) => void }) {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const [pos, setPos] = useState<Position>('WR')
  const [minOvr, setMinOvr] = useState(75)
  const [maxAge, setMaxAge] = useState<number | 'any'>('any')
  const [results, setResults] = useState<{ player: Player; teamId: string; offer: DealOffer }[]>([])

  const search = () => {
    setResults(
      findTargetsAtPosition(league, activeTeamId, pos, {
        minOvr,
        maxAge: maxAge === 'any' ? undefined : maxAge,
      }),
    )
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <div className="label mb-1">Position</div>
          <div className="flex flex-wrap gap-1">
            {POSITIONS.map((p) => (
              <FilterChip key={p} pressed={pos === p} onChange={() => setPos(p)}>
                {p}
              </FilterChip>
            ))}
          </div>
        </div>
        <div>
          <div className="label mb-1">Min OVR</div>
          <select
            value={minOvr}
            onChange={(e) => setMinOvr(Number(e.target.value))}
            className="rounded-lg border border-line bg-surface px-2 py-1.5 font-cond text-sm font-600 outline-none"
          >
            {MIN_OVR_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="label mb-1">Max age</div>
          <select
            value={String(maxAge)}
            onChange={(e) => setMaxAge(e.target.value === 'any' ? 'any' : Number(e.target.value))}
            className="rounded-lg border border-line bg-surface px-2 py-1.5 font-cond text-sm font-600 outline-none"
          >
            {MAX_AGE_OPTIONS.map((v) => (
              <option key={String(v)} value={String(v)}>
                {v === 'any' ? 'Any' : v}
              </option>
            ))}
          </select>
        </div>
        <Button variant="primary" onClick={search}>
          <Search size={14} /> Search
        </Button>
      </div>

      {results.length ? (
        <div className="grid gap-2">
          {results.map((r) => (
            <div key={r.player.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
              <TeamCrest team={league.byId[r.teamId]} size={26} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <PlayerHoverCard player={r.player} className="min-w-0 text-sm font-600 text-ink" />
                  <span className="font-cond text-label font-700 uppercase text-muted">{r.player.pos}</span>
                </div>
                <div className="text-label tnum text-muted">
                  Age {r.player.age} · {money(r.player.contract.capHit)} · value{' '}
                  {playerTradeValue(r.player).toLocaleString()} pts
                </div>
                <DealHover world={league} offer={r.offer} className="mt-0.5 min-w-0">
                  <span className="truncate text-label text-ink-2">{r.offer.summary}</span>
                </DealHover>
              </div>
              <OvrBadge value={r.player.ovr} pot={r.player.pot} size={30} />
              <GmAskButton player={r.player} kind="trade" />
              <Button variant="primary" onClick={() => onLoadDeal(r.offer)}>
                Load deal
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">
          Pick a position and press Search to see who's gettable — and what it would cost.
        </p>
      )}
    </Card>
  )
}

// ── T5: the trade block ──────────────────────────────────────────────────────

function reasonTone(reason: string): 'info' | 'warn' | 'gold' | 'loss' {
  if (reason.startsWith('Surplus')) return 'info'
  if (reason.startsWith('Rebuilding')) return 'warn'
  if (reason.startsWith('Expiring')) return 'gold'
  return 'loss'
}

/**
 * L12.5 T5: the AI clubs' shopping lists this week, plus your own block. Purely
 * informational — being listed never changes what a club pays. Filter by
 * position / OVR, sort it, and shop a listing with Find deals in place.
 */
function TradeBlockTab({ onLoadDeal }: { onLoadDeal: (o: DealOffer) => void }) {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const career = useGame((s) => s.career)
  const canScout = !!career && canShadow(career)

  const [pos, setPos] = useState<Position | 'ALL'>('ALL')
  const [minOvr, setMinOvr] = useState(0)
  const [sort, setSort] = useState<'ovr' | 'value' | 'age'>('ovr')
  const [deals, setDeals] = useState<{ playerId: string; offers: DealOffer[] } | null>(null)

  const rosterIds = useMemo(
    () => new Set(rosterOf(league, activeTeamId).map((p) => p.id)),
    [league, activeTeamId],
  )

  // The league's block for this week (deterministic, no rng).
  const board = useMemo(() => tradeBlock(league, activeTeamId), [league, activeTeamId])

  const rows = useMemo(() => {
    const withPlayer = board
      .map((e) => ({ e, p: playerById(league, e.playerId) }))
      .filter((r): r is { e: TradeBlockEntry; p: Player } => !!r.p)
    const filtered = withPlayer.filter(
      ({ p }) => (pos === 'ALL' || p.pos === pos) && p.ovr >= minOvr,
    )
    filtered.sort((a, b) => {
      if (sort === 'value') return playerTradeValue(b.p) - playerTradeValue(a.p)
      if (sort === 'age') return a.p.age - b.p.age || b.p.ovr - a.p.ovr
      return b.p.ovr - a.p.ovr
    })
    return filtered
  }, [board, league, pos, minOvr, sort])

  const mine = useMemo(() => {
    const ids = (career?.tradeBlock ?? []).filter((id) => rosterIds.has(id))
    return ids
      .map((id) => {
        const p = playerById(league, id)
        return p ? { player: p, offers: findDeals(league, activeTeamId, id).slice(0, 3) } : null
      })
      .filter((x): x is { player: Player; offers: DealOffer[] } => !!x)
  }, [career?.tradeBlock, rosterIds, league, activeTeamId])

  const onFind = (playerId: string) => {
    setDeals({ playerId, offers: findPackagesFor(league, activeTeamId, playerId) })
  }

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle right={<Badge tone={mine.length ? 'info' : 'neutral'}>{mine.length}/5</Badge>}>
          Your block
        </SectionTitle>
        {mine.length ? (
          <div className="space-y-2">
            {mine.map(({ player, offers }) => (
              <div key={player.id} className="rounded-lg border border-line px-3 py-2">
                <div className="flex items-center gap-2">
                  <OvrBadge value={player.ovr} pot={player.pot} size={28} />
                  <PlayerHoverCard player={player} className="min-w-0 text-sm font-600 text-ink" />
                  <span className="font-cond text-label font-700 uppercase text-muted">{player.pos}</span>
                  <span className="ml-auto text-label tnum text-muted">{money(player.contract.capHit)}</span>
                </div>
                {offers.length ? (
                  <div className="mt-1.5 space-y-1">
                    {offers.map((o) => (
                      <div
                        key={o.partnerId}
                        className="flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1"
                      >
                        <TeamCrest team={league.byId[o.partnerId]} size={20} />
                        <DealHover world={league} offer={o} className="min-w-0 flex-1">
                          <span className="truncate text-label text-ink-2">{o.summary}</span>
                        </DealHover>
                        <span className="text-label tnum text-muted">
                          back {Math.round(o.userValue).toLocaleString()} pts
                        </span>
                        <Button size="sm" variant="primary" onClick={() => onLoadDeal(o)}>
                          Load
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-label text-muted">No club is offering for him right now.</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">
            Star a player with the tag button in your column on the Build tab to shop him here.
          </p>
        )}
      </Card>

      <Card>
        <SectionTitle right={<Badge tone="neutral">{rows.length}</Badge>}>League trade block</SectionTitle>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1">
            {POSITION_FILTERS.map((p) => (
              <FilterChip key={p} pressed={pos === p} onChange={() => setPos(p)}>
                {p}
              </FilterChip>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="label">Min OVR</span>
            <select
              value={minOvr}
              onChange={(e) => setMinOvr(Number(e.target.value))}
              className="rounded-lg border border-line bg-surface px-2 py-1 font-cond text-xs font-600 outline-none"
            >
              {[0, 65, 70, 75, 80].map((v) => (
                <option key={v} value={v}>
                  {v === 0 ? 'Any' : v}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span className="label">Sort</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as 'ovr' | 'value' | 'age')}
              className="rounded-lg border border-line bg-surface px-2 py-1 font-cond text-xs font-600 outline-none"
            >
              <option value="ovr">OVR</option>
              <option value="value">Trade value</option>
              <option value="age">Age</option>
            </select>
          </div>
        </div>

        {rows.length ? (
          <div className="space-y-2">
            {rows.map(({ e, p }) => (
              <div key={p.id} className="rounded-lg border border-line">
                <div className="flex items-center gap-3 px-3 py-2">
                  <TeamCrest team={league.byId[e.teamId]} size={24} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <PlayerHoverCard player={p} className="min-w-0 text-sm font-600 text-ink" />
                      <span className="font-cond text-label font-700 uppercase text-muted">{p.pos}</span>
                      <Badge tone={reasonTone(e.reason)}>{e.reason}</Badge>
                    </div>
                    <div className="text-label tnum text-muted">
                      Age {p.age} · {money(p.contract.capHit)} · value {playerTradeValue(p).toLocaleString()} pts
                    </div>
                  </div>
                  <OvrBadge value={p.ovr} pot={p.pot} size={28} />
                  <GmAskButton player={p} kind="trade" label="Ask GM" />
                  <IconButton label={`Find deals for ${p.name}`} size="sm" onClick={() => onFind(p.id)}>
                    <Search size={14} />
                  </IconButton>
                  {canScout && <ShadowStar playerId={p.id} />}
                </div>
                {deals?.playerId === p.id && (
                  <div className="space-y-1 border-t border-line bg-surface-2 px-3 py-2">
                    {deals.offers.length ? (
                      deals.offers.map((o) => (
                        <div
                          key={o.give.map((a) => a.id).join('-')}
                          className="flex items-center gap-2 rounded-md bg-surface px-2 py-1"
                        >
                          <DealHover world={league} offer={o} className="min-w-0 flex-1">
                            <span className="truncate text-label text-ink-2">{o.summary}</span>
                          </DealHover>
                          <span className="text-label tnum text-muted">
                            give {o.give.reduce((s, a) => s + assetValue(league, a), 0).toLocaleString()} pts
                          </span>
                          <Button size="sm" variant="primary" onClick={() => onLoadDeal(o)}>
                            Load
                          </Button>
                        </div>
                      ))
                    ) : (
                      <p className="text-label text-muted">No package you can offer lands him right now.</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No clubs are shopping players at these filters.</p>
        )}
      </Card>
    </div>
  )
}

// ── T1: the itemized deal panel ──────────────────────────────────────────────

function DealHover({
  world,
  offer,
  children,
  className,
}: {
  world: World
  offer: DealOffer
  children: ReactNode
  className?: string
}) {
  return (
    <HoverCard className={className} label="Full deal" content={<DealDetail world={world} offer={offer} />}>
      {children}
    </HoverCard>
  )
}

function capOf(world: World, a: TradeAsset): number {
  if (a.kind !== 'player') return 0
  return playerById(world, a.id)?.contract.capHit ?? 0
}

function DealDetail({ world, offer }: { world: World; offer: DealOffer }) {
  const giveVal = offer.give.reduce((s, a) => s + assetValue(world, a), 0)
  const getVal = offer.get.reduce((s, a) => s + assetValue(world, a), 0)
  const capIn = offer.get.reduce((s, a) => s + capOf(world, a), 0)
  const capOut = offer.give.reduce((s, a) => s + capOf(world, a), 0)
  const net = capIn - capOut
  return (
    <div className="space-y-2.5">
      <DealSide title="You give" world={world} refs={offer.give} />
      <DealSide title="You get" world={world} refs={offer.get} />
      <div className="flex items-center justify-between border-t border-line pt-2 text-label tnum">
        <span className="text-muted">
          Value · give {giveVal.toLocaleString()} pts · get {getVal.toLocaleString()} pts
        </span>
        <span className={cn('font-cond font-700 uppercase', net > 0 ? 'text-warn' : net < 0 ? 'text-win' : 'text-ink-2')}>
          Cap {money(net, { sign: true })}
        </span>
      </div>
      <p className="text-label text-faint">This season&apos;s cap change for you (incoming hits minus outgoing).</p>
    </div>
  )
}

function DealSide({ title, world, refs }: { title: string; world: World; refs: TradeAsset[] }) {
  return (
    <div>
      <div className="label mb-1">{title}</div>
      {refs.length ? (
        <div className="space-y-1">
          {refs.map((r) => (
            <DealAssetRow key={`${r.kind}:${r.id}`} world={world} asset={r} />
          ))}
        </div>
      ) : (
        <div className="text-xs text-muted">Nothing</div>
      )}
    </div>
  )
}

function DealAssetRow({ world, asset }: { world: World; asset: TradeAsset }) {
  if (asset.kind === 'player') {
    const p = playerById(world, asset.id)
    if (!p) return null
    return (
      <div className="flex items-center gap-2">
        <OvrBadge value={p.ovr} pot={p.pot} size={26} />
        <div className="min-w-0 flex-1">
          <PlayerHoverCard player={p} className="text-xs font-600 text-ink" />
          <div className="truncate text-label tnum text-muted">
            {p.pos} · age {p.age} · {money(p.contract.capHit)} · {p.contract.years} yr
            {p.contract.years === 1 ? '' : 's'}
          </div>
        </div>
        <span className="font-cond text-label font-700 tnum text-muted">
          {assetValue(world, asset).toLocaleString()} pts
        </span>
      </div>
    )
  }
  const pk = world.draftPicks.find((x) => x.id === asset.id)
  if (!pk) return null
  const via = world.byId[pk.originalTeam]
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-6 w-6 place-items-center rounded-md bg-ink font-display text-label font-700 text-canvas">
        R{pk.round}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-600 text-ink">
          {pk.season} Round {pk.round} Pick{pk.comp ? ' (comp)' : ''}
        </div>
        <div className="truncate text-label text-muted">via {via?.abbr ?? pk.originalTeam}</div>
      </div>
      <span className="font-cond text-label font-700 tnum text-muted">
        {assetValue(world, asset).toLocaleString()} pts
      </span>
    </div>
  )
}

// ── Asset helpers & columns ──────────────────────────────────────────────────

function assetsFor(world: World, teamId: string): Asset[] {
  const players: Player[] = [...rosterOf(world, teamId)].sort(
    (a, b) => playerTradeValue(b) - playerTradeValue(a),
  )
  const playerAssets: Asset[] = players.map((p) => ({
    id: p.id,
    kind: 'player',
    label: p.name,
    sub: `${p.pos} · ${p.age} yrs · ${money(p.contract.capHit)}`,
    value: playerTradeValue(p),
    ovr: p.ovr,
    pot: p.pot,
  }))
  const pickAssets: Asset[] = picksOwnedBy(world, teamId).filter((pk) => isTradeablePick(world, pk)).map((pk) => ({
    id: pk.id,
    kind: 'pick' as const,
    label: `${pk.season} Round ${pk.round} Pick${pk.comp ? ' (comp)' : ''}`,
    sub: pk.originalTeam === teamId ? 'Own pick' : `via ${world.byId[pk.originalTeam]?.abbr ?? pk.originalTeam}`,
    value: pickTradeValue(pk, upcomingDraftSeason(world)),
    round: pk.round,
    season: pk.season,
  }))
  return [...playerAssets, ...pickAssets]
}

/** Map trade references back to the screen's Asset objects for a given club. */
function resolveAssets(world: World, teamId: string, refs: TradeAsset[]): Asset[] {
  const all = assetsFor(world, teamId)
  return refs.map((r) => all.find((a) => a.id === r.id)).filter((a): a is Asset => !!a)
}

/** L12.8 backlog #30: position chips on each asset column. Picks are their own chip. */
const COLUMN_POSITIONS: { id: string; positions?: Position[]; picks?: boolean }[] = [
  { id: 'ALL' },
  { id: 'QB', positions: ['QB'] },
  { id: 'RB', positions: ['RB'] },
  { id: 'WR', positions: ['WR'] },
  { id: 'TE', positions: ['TE'] },
  { id: 'OL', positions: ['OT', 'OG', 'C'] },
  { id: 'DL', positions: ['DE', 'DT'] },
  { id: 'LB', positions: ['LB'] },
  { id: 'CB', positions: ['CB'] },
  { id: 'S', positions: ['S'] },
  { id: 'K/P', positions: ['K', 'P'] },
  { id: 'Picks', picks: true },
]

type AssetSort = 'trade' | 'ovr' | 'pot' | 'age' | 'cap'

const ASSET_SORTS: [AssetSort, string][] = [
  ['trade', 'Trade value'],
  ['ovr', 'OVR'],
  ['pot', 'POT'],
  ['age', 'Age'],
  ['cap', 'Cap hit'],
]

function AssetColumn({
  title,
  teamId,
  assets,
  selected,
  dragKind,
  onToggle,
  onFindDeals,
  showShadow,
  showGmAsk,
  blockIds,
  onToggleBlock,
  onTeamClick,
}: {
  title: string
  teamId: string
  assets: Asset[]
  selected: Asset[]
  /** U4: which side of the deal dragging from this column feeds. */
  dragKind: 'give' | 'get'
  onToggle: (a: Asset) => void
  onFindDeals?: (a: Asset) => void
  showShadow?: boolean
  /** L12.14 C6: show the "ask the GM to get him" button (partner column only). */
  showGmAsk?: boolean
  blockIds?: string[]
  onToggleBlock?: (a: Asset) => void
  /** L12.8 V1: make the club header open its team page. */
  onTeamClick?: () => void
}) {
  const league = useWorld()
  const team = league.byId[teamId]
  const [pos, setPos] = useState('ALL')
  const [sort, setSort] = useState<AssetSort>('trade')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')

  // Filtering/sorting is display-only: `selected` lives in the parent, so assets
  // stay selected even when a filter hides them.
  const filtered = useMemo(() => {
    const group = COLUMN_POSITIONS.find((g) => g.id === pos)
    const matches = assets.filter((a) => {
      if (pos === 'ALL') return true
      if (group?.picks) return a.kind === 'pick'
      if (a.kind !== 'player') return false
      const p = playerById(league, a.id)
      return !!p && !!group?.positions?.includes(p.pos)
    })
    const val = (a: Asset): number | null => {
      if (sort === 'trade') return a.value
      if (a.kind === 'pick') return null
      const p = playerById(league, a.id)
      if (!p) return null
      if (sort === 'ovr') return a.ovr ?? p.ovr
      if (sort === 'pot') return a.pot ?? p.pot
      if (sort === 'age') return p.age
      return p.contract.capHit
    }
    const copy = [...matches]
    copy.sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      return dir === 'asc' ? va - vb : vb - va
    })
    return copy
  }, [assets, pos, sort, dir, league])

  const hiddenSelected = selected.filter((s) => !filtered.some((f) => f.id === s.id)).length

  return (
    <Card pad={false} className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2.5">
        {onTeamClick ? (
          <button
            type="button"
            onClick={onTeamClick}
            title={`View the ${team.name}`}
            className="flex min-h-11 min-w-0 items-center gap-2 transition hover:opacity-80 lg:min-h-0"
          >
            <TeamCrest team={team} size={26} />
            <span className="truncate font-display text-base font-700 uppercase tracking-wide text-ink underline-offset-2 hover:underline">
              {title}
            </span>
          </button>
        ) : (
          <>
            <TeamCrest team={team} size={26} />
            <span className="font-display text-base font-700 uppercase tracking-wide text-ink">{title}</span>
          </>
        )}
        <Badge tone="neutral" className="ml-auto">
          {filtered.length}
          {hiddenSelected > 0 ? ` +${hiddenSelected}` : ''}
        </Badge>
      </div>

      <div className="space-y-1.5 border-b border-line bg-surface-2 px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {COLUMN_POSITIONS.map((g) => (
            <FilterChip key={g.id} pressed={pos === g.id} onChange={() => setPos(g.id)}>
              {g.id}
            </FilterChip>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="label !mb-0">Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as AssetSort)}
            className="rounded-md border border-line bg-surface min-h-11 px-2 py-1 font-cond text-base font-600 outline-none lg:min-h-0 lg:text-xs"
          >
            {ASSET_SORTS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <IconButton
            label={dir === 'desc' ? 'Sorted descending; switch to ascending' : 'Sorted ascending; switch to descending'}
            size="sm"
            onClick={() => setDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
          >
            {dir === 'desc' ? '▼' : '▲'}
          </IconButton>
          {hiddenSelected > 0 && (
            <span className="ml-auto font-cond text-label font-700 uppercase tracking-wide text-warn">
              {hiddenSelected} selected hidden
            </span>
          )}
        </div>
      </div>

      <div className="max-h-[560px] divide-y divide-line/60 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted">No assets match this filter.</div>
        ) : (
          filtered.map((a, i) => {
            const on = selected.some((s) => s.id === a.id)
            const prev = filtered[i - 1]
            const showYear = a.kind === 'pick' && (!prev || prev.kind !== 'pick' || prev.season !== a.season)
            const player = a.kind === 'player' ? playerById(league, a.id) : undefined
            const blocked = !!blockIds?.includes(a.id)
            return (
              <div key={a.id}>
                {showYear && (
                  <div className="bg-surface-2 px-4 py-1 font-cond text-label font-700 uppercase tracking-widest text-muted">
                    {a.season} Draft
                  </div>
                )}
                <div
                  onClick={() => onToggle(a)}
                  draggable
                  onDragStart={(e) => {
                    const payload = JSON.stringify({ id: a.id, kind: dragKind })
                    e.dataTransfer.effectAllowed = 'copy'
                    e.dataTransfer.setData('application/gd-asset', payload)
                    e.dataTransfer.setData('text/plain', payload)
                  }}
                  className={cn(
                    'flex w-full cursor-grab items-center gap-3 px-4 py-2 text-left transition active:cursor-grabbing',
                    on ? 'bg-[var(--team-soft)]' : 'hover:bg-surface-2',
                  )}
                >
                  {a.kind === 'player' ? (
                    <OvrBadge value={a.ovr!} pot={a.pot} size={30} />
                  ) : (
                    <span className="grid h-7 w-7 place-items-center rounded-md bg-ink font-display text-xs font-700 text-canvas">
                      R{a.round}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    {player ? (
                      <PlayerHoverCard player={player} className="min-w-0 text-sm font-600 text-ink" />
                    ) : (
                      <span className="block truncate text-sm font-600 text-ink">{a.label}</span>
                    )}
                    <span className="block truncate text-xs text-muted">{a.sub}</span>
                  </span>
                  <span className="font-cond text-xs font-700 tnum text-muted">{a.value.toLocaleString()} pts</span>
                  {a.kind === 'player' && showGmAsk && player && <GmAskButton player={player} kind="trade" label="Ask GM" />}
                  {a.kind === 'player' && showShadow && <ShadowStar playerId={a.id} />}
                  {onFindDeals && (
                    <IconButton
                      label={a.kind === 'pick' ? 'Find deals for this pick' : `Find deals for ${a.label}`}
                      size="sm"
                      rowSafe
                      onClick={() => onFindDeals(a)}
                    >
                      <Search size={14} />
                    </IconButton>
                  )}
                  {a.kind === 'player' && onToggleBlock && (
                    <IconButton
                      label={blocked ? `Remove ${a.label} from your trade block` : `Add ${a.label} to your trade block`}
                      size="sm"
                      rowSafe
                      pressed={blocked}
                      onClick={() => onToggleBlock(a)}
                    >
                      <Tag size={14} fill={blocked ? 'currentColor' : 'none'} />
                    </IconButton>
                  )}
                  <span
                    className={cn(
                      'grid h-6 w-6 place-items-center rounded-md border',
                      on ? 'border-transparent bg-ink text-canvas' : 'border-line text-faint',
                    )}
                  >
                    {on ? <X size={13} /> : <Plus size={13} />}
                  </span>
                </div>
              </div>
            )
          })
        )}
      </div>
    </Card>
  )
}

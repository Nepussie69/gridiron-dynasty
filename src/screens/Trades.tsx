import { useMemo, useState } from 'react'
import { ArrowLeftRight, Handshake, Plus, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
import { rosterOf } from '../game/selectors'
import { picksOwnedBy } from '../game/engine/picks'
import {
  evaluateTrade,
  pickTradeValue,
  playerTradeValue,
  type TradeAsset,
} from '../game/engine/trade'
import { NFL_TEAMS } from '../game/data/nflTeams'
import type { Player } from '../game/types'
import type { World } from '../game/engine/generate'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card, PageHeader, OvrBadge, TeamCrest } from '../ui/kit'

interface Asset {
  id: string
  kind: 'player' | 'pick'
  label: string
  sub: string
  value: number
  ovr?: number
  round?: number
}

const toRef = (a: Asset): TradeAsset => ({ kind: a.kind, id: a.id })

export function Trades() {
  const league = useWorld()
  const activeTeamId = useGame((s) => s.activeTeamId)
  const career = useGame((s) => s.career)
  const proposeTrade = useGame((s) => s.proposeTrade)

  const [partnerId, setPartnerId] = useState(NFL_TEAMS.find((t) => t.id !== activeTeamId)!.id)
  const [give, setGive] = useState<Asset[]>([])
  const [get, setGet] = useState<Asset[]>([])

  const team = league.byId[activeTeamId]
  const partner = league.byId[partnerId]

  const myAssets = useMemo(() => assetsFor(league, activeTeamId), [league, activeTeamId])
  const theirAssets = useMemo(() => assetsFor(league, partnerId), [league, partnerId])

  const giveVal = give.reduce((s, a) => s + a.value, 0)
  const getVal = get.reduce((s, a) => s + a.value, 0)

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

  const canTrade = give.length > 0 && get.length > 0

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
            className="rounded-lg border border-line bg-surface px-3 py-2 font-cond text-sm font-600 outline-none"
          >
            {NFL_TEAMS.filter((t) => t.id !== activeTeamId).map((t) => (
              <option key={t.id} value={t.id}>
                {t.city} {t.name}
              </option>
            ))}
          </select>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_300px_1fr]">
        <AssetColumn
          title={`${team.abbr} Sends`}
          teamId={activeTeamId}
          assets={myAssets}
          selected={give}
          onToggle={(a) => toggle(give, setGive, a)}
        />

        <div className="flex flex-col items-center justify-center gap-3">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-ink text-white">
            <ArrowLeftRight size={22} />
          </div>
          <div className="w-full rounded-xl border border-line bg-surface p-4 text-center">
            <div className="label mb-2">Trade Value</div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-display text-2xl font-700 tnum text-ink">{giveVal.toLocaleString()}</div>
                <div className="label !text-[9px]">You give</div>
              </div>
              <div>
                <div className="font-display text-2xl font-700 tnum text-ink-2">{getVal.toLocaleString()}</div>
                <div className="label !text-[9px]">You get</div>
              </div>
            </div>

            <div
              className={cn(
                'mt-3 rounded-lg px-3 py-2 font-cond text-sm font-700 uppercase',
                verdict.verdict === 'accept' ? 'bg-[#e5f6ec] text-win' : verdict.verdict === 'close' ? 'bg-[#fdf0dc] text-warn' : 'bg-[#fdeaec] text-loss',
              )}
            >
              {verdict.verdict === 'accept'
                ? 'They accept'
                : verdict.verdict === 'close'
                  ? 'Close — needs more'
                  : 'They decline'}
            </div>
            {canTrade && <p className="mt-2 text-[11px] leading-snug text-muted">{verdict.reason}</p>}

            <Button variant="team" className="mt-3 w-full" disabled={!canTrade} onClick={onPropose}>
              <Handshake size={15} /> Propose Trade
            </Button>
            {career && career.tier !== 'NFL' && (
              <p className="mt-2 text-[11px] text-warn">Trades unlock in the NFL.</p>
            )}
          </div>
        </div>

        <AssetColumn
          title={`${partner.abbr} Sends`}
          teamId={partnerId}
          assets={theirAssets}
          selected={get}
          onToggle={(a) => toggle(get, setGet, a)}
        />
      </div>
    </div>
  )
}

function assetsFor(world: World, teamId: string): Asset[] {
  const players: Player[] = [...rosterOf(world, teamId)].sort(
    (a, b) => playerTradeValue(b) - playerTradeValue(a),
  )
  const playerAssets: Asset[] = players.map((p) => ({
    id: p.id,
    kind: 'player',
    label: p.name,
    sub: `${p.pos} · ${p.age} yrs · ${money(p.contract.annual)}`,
    value: playerTradeValue(p),
    ovr: p.ovr,
  }))
  const pickAssets: Asset[] = picksOwnedBy(world, teamId).map((pk) => ({
    id: pk.id,
    kind: 'pick' as const,
    label: `${pk.season} Round ${pk.round} Pick${pk.comp ? ' (comp)' : ''}`,
    sub: pk.originalTeam === teamId ? 'Own pick' : `via ${world.byId[pk.originalTeam]?.abbr ?? pk.originalTeam}`,
    value: pickTradeValue(pk),
    round: pk.round,
  }))
  return [...playerAssets, ...pickAssets]
}

function AssetColumn({
  title,
  teamId,
  assets,
  selected,
  onToggle,
}: {
  title: string
  teamId: string
  assets: Asset[]
  selected: Asset[]
  onToggle: (a: Asset) => void
}) {
  const league = useWorld()
  const team = league.byId[teamId]
  return (
    <Card pad={false} className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2.5">
        <TeamCrest team={team} size={26} />
        <span className="font-display text-base font-700 uppercase tracking-wide text-ink">{title}</span>
        <Badge tone="neutral" className="ml-auto">
          {assets.length}
        </Badge>
      </div>
      <div className="max-h-[560px] divide-y divide-line/60 overflow-y-auto">
        {assets.map((a) => {
          const on = selected.some((s) => s.id === a.id)
          return (
            <button
              key={a.id}
              onClick={() => onToggle(a)}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-2 text-left transition',
                on ? 'bg-[var(--team-soft)]' : 'hover:bg-surface-2',
              )}
            >
              {a.kind === 'player' ? (
                <OvrBadge value={a.ovr!} size={30} />
              ) : (
                <span className="grid h-7 w-7 place-items-center rounded-md bg-ink font-display text-xs font-700 text-white">
                  R{a.round}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-600 text-ink">{a.label}</span>
                <span className="block truncate text-xs text-muted">{a.sub}</span>
              </span>
              <span className="font-cond text-xs font-700 tnum text-muted">{a.value.toLocaleString()}</span>
              <span
                className={cn(
                  'grid h-6 w-6 place-items-center rounded-md border',
                  on ? 'border-transparent bg-[var(--team)] text-[var(--team-ink)]' : 'border-line text-faint',
                )}
              >
                {on ? <X size={13} /> : <Plus size={13} />}
              </span>
            </button>
          )
        })}
      </div>
    </Card>
  )
}

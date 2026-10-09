import { X } from 'lucide-react'
import { gradeColor, money } from '../lib/format'
import { attributesFor, playerAttrs, ATTRIBUTE_SCHEMA } from '../game/data/ratings'
import { COMPOSITES, RATING_INFO, groupForPosition, ratingTitle } from '../game/data/ratingInfo'
import { fitLabel, schemeFit } from '../game/engine/style'
import { careerTotals, coverageGrade, seasonLine } from '../game/engine/stats'
import { experienceLabel } from '../game/engine/progress'
import { canAskGm, gmAskCovers } from '../game/engine/gmAsk'
import { gmTargetNeed, monthKeyOf } from '../game/engine/gmDesk'
import { useGame, useWorld } from '../store/gameStore'
import { ContractExplainer } from './ContractExplainer'
import { PlayerSilhouette } from './PlayerCard'
import { Badge, Button, DevBadge, MiniBars, OvrBadge, RadarChart, RatingBar, Sparkline, TeamCrest } from '../ui/kit'
import type { Contract, Player, Team } from '../game/types'

export function PlayerProfile() {
  const selectedPlayerId = useGame((s) => s.selectedPlayerId)
  const selectPlayer = useGame((s) => s.selectPlayer)
  const league = useWorld()

  if (!selectedPlayerId) return null
  const player: Player | undefined = league.players.find((p) => p.id === selectedPlayerId)
  if (!player) return null

  const team = player.teamId ? league.byId[player.teamId] : null
  const close = () => selectPlayer(null)

  const attrs = player.attrs && Object.keys(player.attrs).length
    ? player.attrs
    : attributesFor(player.id, player.pos, player.ovr)
  const order = ATTRIBUTE_SCHEMA[player.pos] ?? Object.keys(attrs)
  const posGroups = order
    .filter((k) => attrs[k] !== undefined)
    .slice(0, 6)
    .map((k) => ({
      label: k,
      value: attrs[k],
      title: ratingTitle(k),
      sim: !!RATING_INFO[k]?.sim,
    }))

  // U3b: the position's engine composites, shown as a radar + segmented bars.
  const posGroup = groupForPosition(player.pos)
  const composites = posGroup ? COMPOSITES[posGroup] ?? [] : []
  const attrValues = playerAttrs(player)
  const compositeItems = composites.map((c) => ({
    id: c.id,
    label: c.label,
    title: c.title,
    value: c.compute(attrValues),
  }))
  const radarItems = compositeItems.slice(0, 6).map((c) => ({ label: c.label, value: c.value }))
  if (radarItems.length < 3) {
    // A radar needs at least three axes — top up with the position's headline ratings.
    const labels = new Set(radarItems.map((r) => r.label))
    for (const k of order) {
      if (radarItems.length >= 5) break
      if (labels.has(k)) continue
      const v = attrValues[k]
      if (v == null) continue
      radarItems.push({ label: k, value: v })
    }
  }

  const schemeLabel = team
    ? (league.staff[team.id] ?? []).find((s) =>
        s.role === (player.side === 'DEF' ? 'Defensive Coordinator' : 'Offensive Coordinator'),
      )?.scheme
    : undefined
  const fit = schemeLabel ? fitLabel(player, schemeLabel, player.side === 'DEF' ? 'DEF' : 'OFF') : null
  void schemeFit

  // D3 (L12.7): young players show where their ceiling is and how they grew.
  const g = player.lastGrowth
  const devGames = g ? seasonLine(player, g.season, 'NFL')?.games ?? 0 : 0
  const devLine =
    g && g.experience >= 0.3
      ? `Ceiling ${player.pot} · grew ${g.to - g.from >= 0 ? '+' : ''}${g.to - g.from} last season (${experienceLabel(g.experience)}, ${devGames} games)`
      : `Ceiling ${player.pot} · needs snaps to grow`

  // U4: an OVR-history sparkline from the last season-end development step. We do
  // not store a full rating history, so this is the honest last-step trend.
  const ovrTrend = g ? [g.from, g.to] : []

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-[1px]" onClick={close}>
      <div
        className="h-full w-full max-w-[520px] overflow-y-auto bg-canvas shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="relative overflow-hidden p-5"
          style={{
            background: team
              ? `linear-gradient(120deg, ${team.primary}, ${team.secondary})`
              : 'linear-gradient(120deg, #0a1626, #26374b)',
          }}
        >
          <div className="pointer-events-none absolute -bottom-6 right-2 h-44 w-44 opacity-[0.13]" aria-hidden>
            <PlayerSilhouette className="h-full w-full" fill="#ffffff" />
          </div>
          <button
            onClick={close}
            className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-lg bg-black/25 text-white hover:bg-black/40"
          >
            <X size={16} />
          </button>
          <div className="relative flex items-start gap-4">
            <OvrBadge value={player.ovr} pot={player.pot} size={76} />
            <div className="min-w-0 text-white">
              <div className="label !text-white/70">
                {player.pos} · {player.side} · {player.height} · {player.weight} lbs
              </div>
              <h2 className="font-display text-3xl font-700 uppercase leading-tight">{player.name}</h2>
              <div className="mt-1 flex items-center gap-2">
                {team && <TeamCrest team={team} size={22} />}
                <span className="font-cond text-sm font-600">
                  {team ? (team.tier === 'NFL' ? `${team.city} ${team.name}` : team.name) : 'Free Agent'}
                </span>
                <span className="text-white/50">·</span>
                <span className="font-cond text-sm">Age {player.age}</span>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            <DevBadge dev={player.dev} />
            {player.injured && <Badge tone="loss">OUT {player.injured.games}W · {player.injured.note}</Badge>}
            {player.traits.map((t) => (
              <span key={t} className="rounded-full bg-black/25 px-2 py-0.5 text-[11px] font-500 text-white">
                {t}
              </span>
            ))}
          </div>
        </div>

        <div className="space-y-4 p-5">
          {player.college && (
            <div>
              <div className="label mb-1">College</div>
              <div className="font-cond font-600 text-ink">{player.college}</div>
            </div>
          )}

          <div className="rounded-xl border border-line bg-surface p-4">
            <div className="label mb-3">Attributes</div>
            <MiniBars items={posGroups} segments={10} />
          </div>

          {composites.length > 0 && (
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="label mb-3">Position composites</div>
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                {radarItems.length >= 3 && <RadarChart items={radarItems} size={208} className="shrink-0" />}
                <div className="w-full flex-1 space-y-3">
                  {compositeItems.map((c) => (
                    <div key={c.id} title={c.title}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="font-cond text-xs font-700 uppercase tracking-wide text-ink-2">{c.label}</span>
                        <span className="font-cond text-xs font-700 tnum text-ink">{Math.round(c.value)}</span>
                      </div>
                      <RatingBar value={c.value} segments={10} height={8} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {(player.age <= 26 || ovrTrend.length) && (
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="label mb-1">Development</div>
              <div className="font-cond text-sm font-600 text-ink">{devLine}</div>
              {ovrTrend.length >= 2 && (
                <div className="mt-3 flex items-center gap-4 border-t border-line pt-3">
                  <Sparkline data={ovrTrend} width={150} height={44} color={gradeColor(player.ovr)} />
                  <div>
                    <div className="label !text-[9px]">OVR history</div>
                    <div className="font-display text-lg font-700 tnum leading-none text-ink">
                      {ovrTrend[0]} <span className="text-faint">→</span> {ovrTrend[ovrTrend.length - 1]}
                    </div>
                    <div
                      className={
                        ovrTrend[ovrTrend.length - 1] >= ovrTrend[0]
                          ? 'text-[11px] font-600 text-win'
                          : 'text-[11px] font-600 text-loss'
                      }
                    >
                      {ovrTrend[ovrTrend.length - 1] - ovrTrend[0] >= 0 ? '+' : ''}
                      {ovrTrend[ovrTrend.length - 1] - ovrTrend[0]} last season
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="label mb-3">Overall / Potential</div>
              <div className="flex items-end gap-4">
                <div>
                  <div className="font-display text-3xl font-700 tnum text-ink">{player.ovr}</div>
                  <div className="label">Current</div>
                </div>
                <div>
                  <div className="font-display text-3xl font-700 tnum text-brand">{player.pot}</div>
                  <div className="label">Ceiling</div>
                </div>
              </div>
              <div className="mt-3">
                <RatingBar value={player.pot} />
              </div>
            </div>
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="label mb-3">Morale</div>
              <div className="font-display text-3xl font-700 tnum text-ink">{player.morale}</div>
              <div className="mt-3">
                <RatingBar
                  value={player.morale}
                  color={player.morale > 75 ? '#05914f' : player.morale > 55 ? '#d98207' : '#dc2937'}
                />
              </div>
              <div className="mt-2 text-xs text-muted">
                {player.morale > 80 ? 'Thriving in the locker room' : player.morale > 60 ? 'Stable' : 'Unhappy'}
              </div>
            </div>
          </div>

          {schemeLabel && fit && (
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="label mb-2">Scheme Fit</div>
              <div className="flex items-center justify-between">
                <span className="font-cond text-sm font-600 text-ink-2">{schemeLabel}</span>
                <Badge tone={fit === 'Ideal' ? 'win' : fit === 'Good' ? 'info' : 'loss'}>{fit}</Badge>
              </div>
              <div className="mt-3 mb-1 flex items-center justify-between">
                <span className="label">Playbook Mastery</span>
                <span className="font-cond text-xs font-700 tnum text-ink">{player.playbook?.pct ?? 0}%</span>
              </div>
              <RatingBar value={player.playbook?.pct ?? 0} color="#c99a2e" height={8} />
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted">
                <span>
                  {player.playbook?.reps ?? 0} game reps · {player.playbook?.teamYears ?? 0} yr
                  {(player.playbook?.teamYears ?? 0) === 1 ? '' : 's'} with the team
                </span>
              </div>
              <p className="mt-2 text-xs text-muted">
                {(player.playbook?.pct ?? 0) >= 75
                  ? 'Knows the system cold — he is playing faster than his raw rating.'
                  : (player.playbook?.pct ?? 0) >= 45
                    ? 'Getting comfortable. More reps and time will raise his production.'
                    : 'New to the system. Expect a learning curve before he hits full speed.'}
              </p>
            </div>
          )}

          <CareerStats player={player} />

          <div className="rounded-xl border border-line bg-surface p-4">
            <div className="label mb-3">Contract</div>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="AAV" value={money(player.contract.annual)} />
              <Stat label="Cap Hit" value={money(player.contract.capHit)} />
              <Stat label="Years" value={player.contract.years} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <Stat label="Guaranteed" value={money(player.contract.guaranteed)} />
              <Stat label="Through" value={player.contract.signedThrough} />
              <Stat label="Dev" value={player.dev} />
            </div>
            <ContractTimeline contract={player.contract} team={team} />
          </div>

          <GmRequestPanel player={player} />

          <div className="flex gap-2">
            <Button className="flex-1">Trade Block</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * L12.14 C4 + C6: the coach cannot sign, trade, cut or restructure — he asks
 * the GM. One panel covers the three contexts a player profile can be in:
 * one of your own (extend / release / protect), another club's (go get him),
 * or a free agent (sign him). The C5 explainer closes it out.
 */
function GmRequestPanel({ player }: { player: Player }) {
  const career = useGame((s) => s.career)!
  const league = useWorld()
  const askGmToExtend = useGame((s) => s.askGmToExtend)
  const requestGmTrade = useGame((s) => s.requestGmTrade)
  const requestGmSignFreeAgent = useGame((s) => s.requestGmSignFreeAgent)
  const requestGmRelease = useGame((s) => s.requestGmRelease)
  const requestGmRestructure = useGame((s) => s.requestGmRestructure)
  const toggleGmUntouchable = useGame((s) => s.toggleGmUntouchable)

  if (!canAskGm(career)) return null

  const mine = player.teamId === career.teamId
  const freeAgent = !player.teamId
  const covers = gmAskCovers(career, player.pos)
  const asked = career.gmRequestLog?.[player.id] === monthKeyOf(league.season, league.week)
  const untouchables = career.gmUntouchables ?? []
  const untouchable = untouchables.includes(player.id)
  const eligibleExt = mine && player.contract.years <= 2

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="label mb-2">Ask the GM</div>
      {!covers ? (
        <p className="text-xs leading-relaxed text-muted">Coordinators only get a say on their side of the ball.</p>
      ) : (
        <>
          <p className="mb-3 text-xs leading-relaxed text-muted">
            {mine
              ? 'Send the front office a recommendation. The GM decides from value, the room the deal leaves, your standing and the owner\u2019s mandate.'
              : freeAgent
                ? 'The GM bids at market when the space after the bid clears his reserve.'
                : 'The GM shops a package, protecting your untouchables and your side\u2019s starters.'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {mine && (
              <Button
                variant="team"
                size="sm"
                disabled={asked || !eligibleExt}
                title={eligibleExt ? undefined : `${player.contract.years} years left — the GM only extends players with two or fewer.`}
                onClick={() => askGmToExtend(player.id)}
              >
                {eligibleExt ? 'Extend' : 'No extension'}
              </Button>
            )}
            {mine && (
              <Button variant="danger" size="sm" disabled={asked} onClick={() => requestGmRelease(player.id)}>
                Release
              </Button>
            )}
            {mine && (
              <Button
                variant={untouchable ? 'primary' : 'ghost'}
                size="sm"
                disabled={!untouchable && untouchables.length >= 3}
                title={untouchable ? 'Remove trade protection' : 'Never offer him in a trade (max 3)'}
                onClick={() => toggleGmUntouchable(player.id)}
              >
                {untouchable ? 'Untouchable \u2713' : 'Untouchable'}
              </Button>
            )}
            {!mine && !freeAgent && (
              <Button variant="team" size="sm" disabled={asked} onClick={() => requestGmTrade(player.id)}>
                Go get him
              </Button>
            )}
            {freeAgent && (
              <Button variant="team" size="sm" disabled={asked} onClick={() => requestGmSignFreeAgent(player.id)}>
                Sign him
              </Button>
            )}
            {!mine && (gmTargetNeed(league, career, player.id) ?? 0) > 0 && (
              <Button
                variant="ghost"
                size="sm"
                title="Ask the GM to restructure to clear room for him"
                onClick={() => requestGmRestructure(player.id)}
              >
                Clear cap for him
              </Button>
            )}
          </div>
          {asked && <p className="mt-2 text-[11px] text-faint">Already asked the GM about him this month.</p>}
        </>
      )}
      <ContractExplainer player={player} className="mt-3 border-t border-line pt-3" />
    </div>
  )
}

function CareerStats({ player }: { player: Player }) {
  const seasons = player.stats ?? []
  if (!seasons.length) {
    return (
      <div className="rounded-xl border border-line bg-surface p-4">
        <div className="label mb-1">Career Stats</div>
        <p className="text-xs text-muted">No games recorded yet. Stats accumulate as the season is played.</p>
      </div>
    )
  }
  const t = careerTotals(player)
  const showCov = player.side === 'DEF'
  const levels = [
    { level: 'CFB' as const, label: 'College' },
    { level: 'NFL' as const, label: 'Pro' },
  ]
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="label mb-2">Career Stats</div>
      <div className="mb-3 grid grid-cols-4 gap-2 text-center">
        <MiniStat label="Games" value={t.games} />
        {player.pos === 'QB' ? (
          <>
            <MiniStat label="Pass Yds" value={t.passYds.toLocaleString()} />
            <MiniStat label="Pass TD" value={t.passTD} />
            <MiniStat label="INT" value={t.ints} />
          </>
        ) : player.pos === 'RB' ? (
          <>
            <MiniStat label="Rush Yds" value={t.rushYds.toLocaleString()} />
            <MiniStat label="Rush TD" value={t.rushTD} />
            <MiniStat label="Rec" value={t.rec} />
          </>
        ) : player.pos === 'WR' || player.pos === 'TE' ? (
          <>
            <MiniStat label="Rec" value={t.rec} />
            <MiniStat label="Rec Yds" value={t.recYds.toLocaleString()} />
            <MiniStat label="Rec TD" value={t.recTD} />
          </>
        ) : (
          <>
            <MiniStat label="Tackles" value={t.tackles} />
            <MiniStat label="Sacks" value={t.defSacks} />
            <MiniStat label="INT" value={t.defInts} />
          </>
        )}
      </div>
      <div className="space-y-2">
        {levels.map(({ level, label }) => {
          const rows = seasons.filter((s) => s.level === level).sort((a, b) => a.season - b.season)
          if (!rows.length) return null
          return (
            <div key={level}>
              <div className="label !text-[9px]">{label}</div>
              <table className="w-full text-[11px] tnum">
                <thead>
                  <tr className="text-muted">
                    <th className="text-left font-500">Yr</th>
                    <th className="text-right font-500">GP</th>
                    <th className="text-right font-500">Yds</th>
                    <th className="text-right font-500">TD</th>
                    {showCov && <th className="text-right font-500">COV</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const yds = s.passYds + s.rushYds + s.recYds
                    const td = s.passTD + s.rushTD + s.recTD
                    const cov = coverageGrade(s)
                    return (
                      <tr key={`${s.season}-${level}`} className="text-ink-2">
                        <td className="text-left">{s.season}</td>
                        <td className="text-right">{s.games}</td>
                        <td className="text-right">{yds.toLocaleString()}</td>
                        <td className="text-right">{td}</td>
                        {showCov && <td className="text-right">{cov == null ? '—' : cov}</td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * U4 — a per-season contract timeline. Each column is one remaining year: the
 * bar height is that year's cap hit (base + prorated bonus), the club colour
 * marks the guaranteed years, and the gold foot is the prorated signing bonus.
 */
function ContractTimeline({ contract, team }: { contract: Contract; team?: Team | null }) {
  const years = Math.max(1, contract.years)
  const start = contract.signedThrough - years + 1
  const rows = Array.from({ length: years }, (_, i) => {
    const base = contract.base[i] ?? contract.base[contract.base.length - 1] ?? 0
    return { year: start + i, base, cap: base + contract.proration }
  })
  const max = Math.max(...rows.map((r) => r.cap), 1)
  let cum = 0
  const guaranteedRows = rows.map((r) => {
    cum += r.base
    return cum <= contract.guaranteed + 1
  })
  const color = team?.primary ?? 'var(--team)'

  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="label !mb-0">Contract timeline</span>
        <span className="font-cond text-[10px] text-muted">cap hit per remaining season</span>
      </div>
      <div className="flex items-end gap-1.5">
        {rows.map((r, i) => {
          const h = Math.max(6, Math.round((r.cap / max) * 62))
          const bonusH = Math.round((contract.proration / max) * 62)
          return (
            <div
              key={r.year}
              className="flex min-w-0 flex-1 flex-col items-center gap-1"
              title={`${r.year}: ${money(r.cap)} cap hit (${money(r.base)} base + ${money(contract.proration)} prorated bonus)`}
            >
              <span className="font-cond text-[9px] tnum text-muted">{money(r.cap)}</span>
              <span className="relative flex w-full items-end justify-center rounded-sm bg-surface-2" style={{ height: 62 }}>
                <span
                  className="w-full rounded-sm"
                  style={{
                    height: h,
                    background: guaranteedRows[i] ? color : 'var(--color-line-strong)',
                    boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)',
                  }}
                />
                {contract.proration > 0 && (
                  <span
                    className="absolute bottom-0 w-full rounded-b-sm"
                    style={{ height: Math.max(3, bonusH), background: 'var(--color-gold)', opacity: 0.9 }}
                  />
                )}
              </span>
              <span className="font-cond text-[10px] font-700 tnum text-ink-2">{r.year}</span>
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-muted">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm" style={{ background: color }} /> guaranteed
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-[var(--color-line-strong)]" /> unguaranteed
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm" style={{ background: 'var(--color-gold)' }} /> prorated bonus
        </span>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="font-cond text-base font-700 tnum text-ink">{value}</div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-line py-1.5">
      <div className="label !text-[9px]">{label}</div>
      <div className="font-display text-base font-700 tnum text-ink">{value}</div>
    </div>
  )
}

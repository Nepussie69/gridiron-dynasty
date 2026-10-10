import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { money, tierStroke } from '../lib/format'
import { attributesFor, playerAttrs, ATTRIBUTE_SCHEMA } from '../game/data/ratings'
import { COMPOSITES, RATING_INFO, groupForPosition, ratingTitle } from '../game/data/ratingInfo'
import { fitLabel } from '../game/engine/style'
import { careerTotals, coverageGrade, seasonLine } from '../game/engine/stats'
import { isReturnEligible, returnInputs, returnRating, RETURN_INFO, RETURN_WEIGHTS, returnScore } from '../game/engine/returns'
import { experienceLabel } from '../game/engine/progress'
import { canAskGm, gmAskCovers } from '../game/engine/gmAsk'
import { gmTargetNeed, monthKeyOf } from '../game/engine/gmDesk'
import { useGame, useWorld } from '../store/gameStore'
import { ContractExplainer } from './ContractExplainer'
import { PlayerSilhouette } from './PlayerCard'
import { InjuryChip, MORALE } from './PlayerTable'
import {
  Badge,
  Button,
  ConfirmSheet,
  DevBadge,
  MiniBars,
  OverflowMenu,
  OvrBadge,
  RadarChart,
  RatingBar,
  Sparkline,
  TeamCrest,
} from '../ui/kit'
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
  // R6: eligible returners show how the sim reads their return ability.
  const retEligible = isReturnEligible(player)
  const retInputs = retEligible ? returnInputs(player) : []
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

  const morale = MORALE.band(player.morale)

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-[rgb(3_6_12/0.62)] backdrop-blur-[1px]" onClick={close}>
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
              : 'linear-gradient(120deg, var(--color-slab), var(--color-surface-3))',
          }}
        >
          <div className="pointer-events-none absolute -bottom-6 right-2 h-44 w-44 opacity-[0.13]" aria-hidden>
            <PlayerSilhouette className="h-full w-full" fill="var(--team-on)" />
          </div>
          <button
            onClick={close}
            title="Close profile"
            className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-[var(--r-md)] text-[var(--team-on)] transition hover:opacity-80"
            style={{ background: 'color-mix(in srgb, var(--team-on) 22%, transparent)' }}
          >
            <X size={18} />
          </button>
          <div className="relative flex items-start gap-4">
            <OvrBadge value={player.ovr} pot={player.pot} size={76} />
            <div className="min-w-0 text-[var(--team-on)]">
              <div className="label opacity-70">
                {player.pos} · {player.side} · {player.height} · {player.weight} lbs
              </div>
              <h2 className="font-display text-[30px] font-800 italic uppercase leading-none">{player.name}</h2>
              <div className="mt-1 flex items-center gap-2">
                {team && <TeamCrest team={team} size={22} />}
                <span className="font-cond text-small font-600">
                  {team ? (team.tier === 'NFL' ? `${team.city} ${team.name}` : team.name) : 'Free Agent'}
                </span>
                <span className="opacity-50">·</span>
                <span className="font-cond text-small">Age {player.age}</span>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            <DevBadge dev={player.dev} />
            <InjuryChip player={player} />
            {player.traits.map((t) => (
              <span
                key={t}
                className="rounded-full px-2 py-0.5 text-label font-500"
                style={{ background: 'color-mix(in srgb, var(--team-on) 18%, transparent)', color: 'var(--team-on)' }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        <div className="space-y-4 p-5">
          {/* 1 · Contract */}
          <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4">
            <div className="label mb-3">Contract</div>
            {(player.holdout?.status === 'open' ||
              player.tag?.season === league.season ||
              player.optionDecision?.season === league.season) && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {player.holdout?.status === 'open' && (
                  <Badge tone="loss">Holdout · asks {money(player.holdout.demand)}</Badge>
                )}
                {player.tag?.season === league.season && (
                  <Badge tone="neutral">
                    {player.tag.kind === 'franchise' ? 'Franchise tag' : 'Transition tag'}
                  </Badge>
                )}
                {player.optionDecision?.season === league.season && (
                  <Badge tone="neutral">
                    5th-year option {player.optionDecision.kind === 'exercise' ? 'exercised' : 'declined'}
                    {player.optionDecision.value ? ` · ${money(player.optionDecision.value)}` : ''}
                  </Badge>
                )}
              </div>
            )}
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

          {/* 2 · Fit */}
          {schemeLabel && fit && (
            <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4">
              <div className="label mb-2">Scheme Fit</div>
              <div className="flex items-center justify-between">
                <span className="font-cond text-small font-600 text-ink-2">{schemeLabel}</span>
                <Badge tone={fit === 'Ideal' ? 'win' : fit === 'Good' ? 'info' : 'warn'}>{fit}</Badge>
              </div>
              <div className="mt-3 mb-1 flex items-center justify-between">
                <span className="label">Playbook Mastery</span>
                <span className="font-cond text-small font-700 tnum text-ink">{player.playbook?.pct ?? 0}%</span>
              </div>
              <RatingBar value={player.playbook?.pct ?? 0} tone="tier" height={8} />
              <div className="mt-1.5 flex items-center justify-between text-label text-muted">
                <span>
                  {player.playbook?.reps ?? 0} game reps · {player.playbook?.teamYears ?? 0} yr
                  {(player.playbook?.teamYears ?? 0) === 1 ? '' : 's'} with the team
                </span>
              </div>
              <p className="mt-2 text-label text-muted">
                {(player.playbook?.pct ?? 0) >= 75
                  ? 'Knows the system cold — he is playing faster than his raw rating.'
                  : (player.playbook?.pct ?? 0) >= 45
                    ? 'Getting comfortable. More reps and time will raise his production.'
                    : 'New to the system. Expect a learning curve before he hits full speed.'}
              </p>
            </div>
          )}

          {/* 3 · Composites */}
          <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4">
            <div className="label mb-3">Attributes</div>
            <MiniBars items={posGroups} segments={10} />
          </div>

          {composites.length > 0 && (
            <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4">
              <div className="label mb-3">Position composites</div>
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                {radarItems.length >= 3 && <RadarChart items={radarItems} size={208} className="shrink-0" />}
                <div className="w-full flex-1 space-y-3">
                  {compositeItems.map((c) => (
                    <div key={c.id} title={c.title}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="font-cond text-label font-700 uppercase tracking-wide text-ink-2">{c.label}</span>
                        <span className="font-cond text-label font-700 tnum text-ink">{Math.round(c.value)}</span>
                      </div>
                      <RatingBar value={c.value} segments={10} height={8} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {retEligible && (
            <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="label">Return ability</div>
                <span title={RETURN_INFO} className="cursor-help">
                  <OvrBadge value={returnRating(player)} size={34} />
                </span>
              </div>
              <RatingBar value={returnScore(player)} segments={10} height={8} />
              <div className="mt-3 space-y-2">
                {RETURN_WEIGHTS.map((w, i) => (
                  <div key={w.key} title={`${w.label} — ${Math.round(w.weight * 100)}% of the Return rating`}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-cond text-label font-700 uppercase tracking-wide text-ink-2">
                        {w.label} <span className="text-faint">{w.key}</span> · {Math.round(w.weight * 100)}%
                      </span>
                      <span className="font-cond text-label font-700 tnum text-ink">{retInputs[i]}</span>
                    </div>
                    <RatingBar value={retInputs[i]} segments={10} height={6} />
                  </div>
                ))}
              </div>
              <p className="mt-3 text-label leading-relaxed text-muted">
                Kick and punt returner. The Return rating is the sim's return ability, built from the five athletics
                above with the weights shown.
              </p>
            </div>
          )}

          {/* 4 · Development */}
          {(player.age <= 26 || ovrTrend.length > 0) && (
            <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4">
              <div className="label mb-1">Development</div>
              <div className="font-cond text-small font-600 text-ink">{devLine}</div>
              {ovrTrend.length >= 2 && (
                <div className="mt-3 flex items-center gap-4 border-t border-line pt-3">
                  <Sparkline data={ovrTrend} width={150} height={44} color={tierStroke(player.ovr)} />
                  <div>
                    <div className="label">OVR history</div>
                    <div className="font-display text-[20px] font-700 tnum leading-none text-ink">
                      {ovrTrend[0]} <span className="text-faint">→</span> {ovrTrend[ovrTrend.length - 1]}
                    </div>
                    <div
                      className={
                        ovrTrend[ovrTrend.length - 1] >= ovrTrend[0]
                          ? 'text-label font-600 text-win'
                          : 'text-label font-600 text-loss'
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
            <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4">
              <div className="label mb-3">Overall / Potential</div>
              <div className="flex items-end gap-4">
                <div>
                  <div className="font-display text-[30px] font-700 tnum text-ink">{player.ovr}</div>
                  <div className="label">Current</div>
                </div>
                <div>
                  <div className="font-display text-[30px] font-700 tnum text-ink">{player.pot}</div>
                  <div className="label">Ceiling</div>
                </div>
              </div>
              <div className="mt-3">
                <RatingBar value={player.pot} tone="tier" />
              </div>
            </div>
            <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4">
              <div className="label mb-3">Morale</div>
              <div className="font-display text-[30px] font-700 tnum text-ink">{player.morale}</div>
              <div className="mt-3">
                <RatingBar value={player.morale} color={MORALE.color[morale]} />
              </div>
              <div className="mt-2 text-label text-muted">{MORALE.label[morale]}</div>
            </div>
          </div>

          {/* 5 · Stats */}
          <CareerStats player={player} />

          {/* 6 · College */}
          {player.college && (
            <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4">
              <div className="label mb-1">College</div>
              <div className="font-cond font-600 text-ink">{player.college}</div>
            </div>
          )}

          <GmRequestPanel player={player} />
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
  const [releaseOpen, setReleaseOpen] = useState(false)

  if (!canAskGm(career)) return null

  const mine = player.teamId === career.teamId
  const freeAgent = !player.teamId
  const covers = gmAskCovers(career, player.pos)
  const asked = career.gmRequestLog?.[player.id] === monthKeyOf(league.season, league.week)
  const untouchables = career.gmUntouchables ?? []
  const untouchable = untouchables.includes(player.id)
  const eligibleExt = mine && player.contract.years <= 2

  return (
    <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4">
      <div className="label mb-2">Ask the GM</div>
      {!covers ? (
        <p className="text-label leading-relaxed text-muted">Coordinators only get a say on their side of the ball.</p>
      ) : (
        <>
          <p className="mb-3 text-label leading-relaxed text-muted">
            {mine
              ? 'Send the front office a recommendation. The GM decides from value, the room the deal leaves, your standing and the owner\u2019s mandate.'
              : freeAgent
                ? 'The GM bids at market when the space after the bid clears his reserve.'
                : 'The GM shops a package, protecting your untouchables and your side\u2019s starters.'}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {mine && (
              <Button
                variant="secondary"
                size="sm"
                disabled={asked || !eligibleExt}
                title={eligibleExt ? undefined : `${player.contract.years} years left — the GM only extends players with two or fewer.`}
                onClick={() => askGmToExtend(player.id)}
              >
                {eligibleExt ? 'Extend' : 'No extension'}
              </Button>
            )}
            {mine && (
              <Button
                variant={untouchable ? 'primary' : 'secondary'}
                size="sm"
                disabled={!untouchable && untouchables.length >= 3}
                title={untouchable ? 'Remove trade protection' : 'Never offer him in a trade (max 3)'}
                onClick={() => toggleGmUntouchable(player.id)}
              >
                {untouchable ? 'Untouchable \u2713' : 'Untouchable'}
              </Button>
            )}
            {!mine && !freeAgent && (
              <Button variant="secondary" size="sm" disabled={asked} onClick={() => requestGmTrade(player.id)}>
                Go get him
              </Button>
            )}
            {freeAgent && (
              <Button variant="primary" size="sm" disabled={asked} onClick={() => requestGmSignFreeAgent(player.id)}>
                Sign him
              </Button>
            )}
            {!mine && (gmTargetNeed(league, career, player.id) ?? 0) > 0 && (
              <Button
                variant="secondary"
                size="sm"
                title="Ask the GM to restructure to clear room for him"
                onClick={() => requestGmRestructure(player.id)}
              >
                Clear cap for him
              </Button>
            )}
            {mine && (
              <OverflowMenu
                size="sm"
                label="More roster requests"
                items={[
                  {
                    id: 'release',
                    label: 'Ask the GM to release…',
                    description: 'Opens a review of the cap consequences',
                    danger: true,
                    onSelect: () => setReleaseOpen(true),
                  },
                ]}
              />
            )}
          </div>
          {asked && <p className="mt-2 text-label text-faint">Already asked the GM about him this month.</p>}
        </>
      )}
      <ContractExplainer player={player} className="mt-3 border-t border-line pt-3" />

      <ConfirmSheet
        open={releaseOpen}
        onClose={() => setReleaseOpen(false)}
        eyebrow="Ask the GM"
        title={`Release ${player.name}?`}
        subtitle={`${player.pos} · rated ${player.ovr} · ${player.contract.years} yr left`}
        destructive={false}
        consequences={[
          { label: 'Cap hit', value: money(player.contract.capHit) },
          { label: 'Guaranteed left', value: money(player.contract.guaranteed) },
          { label: 'Who decides', value: 'The GM — you advise', tone: 'warn' },
        ]}
        confirmLabel="Send release request"
        accessNote="Sent to the GM as a recommendation"
        onConfirm={() => {
          requestGmRelease(player.id)
          setReleaseOpen(false)
        }}
      />
    </div>
  )
}

function CareerStats({ player }: { player: Player }) {
  const seasons = player.stats ?? []
  if (!seasons.length) {
    return (
      <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4">
        <div className="label mb-1">Career Stats</div>
        <p className="text-label text-muted">No games recorded yet. Stats accumulate as the season is played.</p>
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
    <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4">
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
              <div className="label">{label}</div>
              <table className="w-full text-label tnum">
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
  const color = team?.primary ?? 'var(--team-accent)'

  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="label">Contract timeline</span>
        <span className="font-cond text-micro text-muted">cap hit per remaining season</span>
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
              <span className="font-cond text-micro tnum text-muted">{money(r.cap)}</span>
              <span className="relative flex w-full items-end justify-center rounded-sm bg-surface-2" style={{ height: 62 }}>
                <span
                  className="w-full rounded-sm"
                  style={{
                    height: h,
                    background: guaranteedRows[i] ? color : 'var(--color-line-strong)',
                  }}
                />
                {contract.proration > 0 && (
                  <span
                    className="absolute bottom-0 w-full rounded-b-sm"
                    style={{ height: Math.max(3, bonusH), background: 'var(--color-gold)', opacity: 0.9 }}
                  />
                )}
              </span>
              <span className="font-cond text-micro font-700 tnum text-ink-2">{r.year}</span>
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-micro text-muted">
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

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="font-cond text-[15px] font-700 tnum text-ink">{value}</div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[var(--r-md)] border border-line py-1.5">
      <div className="label">{label}</div>
      <div className="font-display text-[15px] font-700 tnum text-ink">{value}</div>
    </div>
  )
}

import { X } from 'lucide-react'
import { money } from '../lib/format'
import { attributesFor, ATTRIBUTE_SCHEMA } from '../game/data/ratings'
import { RATING_INFO, ratingTitle } from '../game/data/ratingInfo'
import { fitLabel, schemeFit } from '../game/engine/style'
import { careerTotals, coverageGrade } from '../game/engine/stats'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, DevBadge, MiniBars, OvrBadge, RatingBar, TeamCrest } from '../ui/kit'
import type { Player } from '../game/types'

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

  const schemeLabel = team
    ? (league.staff[team.id] ?? []).find((s) =>
        s.role === (player.side === 'DEF' ? 'Defensive Coordinator' : 'Offensive Coordinator'),
      )?.scheme
    : undefined
  const fit = schemeLabel ? fitLabel(player, schemeLabel, player.side === 'DEF' ? 'DEF' : 'OFF') : null
  void schemeFit

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/40 backdrop-blur-[1px]" onClick={close}>
      <div
        className="h-full w-full max-w-[520px] overflow-y-auto bg-canvas shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="relative p-5"
          style={{
            background: team
              ? `linear-gradient(120deg, ${team.primary}, ${team.secondary})`
              : 'linear-gradient(120deg, #0a1626, #26374b)',
          }}
        >
          <button
            onClick={close}
            className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg bg-black/25 text-white hover:bg-black/40"
          >
            <X size={16} />
          </button>
          <div className="flex items-start gap-4">
            <OvrBadge value={player.ovr} pot={player.pot} size={64} />
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
            <MiniBars items={posGroups} />
          </div>

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
          </div>

          <div className="flex gap-2">
            <Button variant="team" className="flex-1">Offer Extension</Button>
            <Button className="flex-1">Trade Block</Button>
          </div>
        </div>
      </div>
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

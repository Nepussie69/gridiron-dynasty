import { Eye, Search } from 'lucide-react'
import { coordinatorAdvice } from '../game/engine/advice'
import {
  DEF_CALL_LABEL,
  DEF_CALLS,
  OFF_CLASS_LABEL,
  OFF_CLASSES,
  topKey,
  type Bucket,
} from '../game/engine/decisions'
import { aiTendency } from '../game/engine/playsim'
import { seasonLine } from '../game/engine/stats'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card } from '../ui/kit'
import { PlayerHoverCard } from './PlayerHoverCard'
import type { CareerState, Player, SeasonStats, StatLevel } from '../game/types'

function isScouted(career: CareerState | null, season: number, week: number, teamId: string): boolean {
  const s = career?.scoutedClubs
  return !!s && s.season === season && s.week === week && s.teamIds.includes(teamId)
}

/** L12.8 V3: scout this club once a week. */
export function ScoutButton({ teamId, className }: { teamId: string; className?: string }) {
  const league = useWorld()
  const career = useGame((s) => s.career)
  const scoutClub = useGame((s) => s.scoutClub)
  const done = isScouted(career, league.season, league.week, teamId)
  return (
    <Button
      size="sm"
      variant={done ? 'ghost' : 'team'}
      disabled={done}
      onClick={() => scoutClub(teamId)}
      className={className}
    >
      <Search size={13} /> {done ? 'Scouted' : `Scout ${league.byId[teamId]?.abbr ?? 'club'}`}
    </Button>
  )
}

/** The one-line tendency read the AI defense uses against this club. */
function tendencyLine(world: ReturnType<typeof useWorld>, teamId: string, bucket: Bucket, side: 'off' | 'def'): string {
  const dist = aiTendency(world, teamId, bucket)
  if (side === 'off') {
    const t = topKey(dist.off, OFF_CLASSES)
    return `${OFF_CLASS_LABEL[t.key]} ${Math.round(t.share * 100)}%`
  }
  const t = topKey(dist.def, DEF_CALLS)
  return `${DEF_CALL_LABEL[t.key].toLowerCase()} ${Math.round(t.share * 100)}%`
}

/**
 * L12.8 V3: the report a scouting visit reveals — this season's tendencies, the
 * two most-targeted receivers, the top pass rusher, and the coordinator's
 * one-line plan for beating them. Deterministic; no sim edge.
 */
export function ScoutClubCard({ teamId, className }: { teamId: string; className?: string }) {
  const league = useWorld()
  const career = useGame((s) => s.career)
  const team = league.byId[teamId]
  const done = isScouted(career, league.season, league.week, teamId)
  const level: StatLevel = team?.tier === 'NFL' ? 'NFL' : 'CFB'
  const roster = league.roster[teamId] ?? []

  const withLine = roster
    .map((p) => ({ p, s: seasonLine(p, league.season, level) }))
    .filter((x): x is { p: Player; s: SeasonStats } => !!x.s)

  const receivers = [...withLine]
    .filter((x) => (x.s.targets ?? 0) > 0)
    .sort((a, b) => (b.s.targets ?? 0) - (a.s.targets ?? 0))
    .slice(0, 2)
  const rusher = [...withLine]
    .filter((x) => (x.s.defSacks ?? 0) > 0)
    .sort((a, b) => (b.s.defSacks ?? 0) - (a.s.defSacks ?? 0))[0]
  const advice = career ? coordinatorAdvice(league, career, teamId) : []
  const beat = (advice.find((a) => a.side === 'off') ?? advice[0])?.reason

  return (
    <Card className={className}>
      <div className="mb-3 flex items-center gap-2">
        <Eye size={16} className="text-muted" />
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">Scout the {team?.name}</h3>
        <Badge tone={done ? 'win' : 'neutral'} className="ml-auto">
          {done ? 'Scouted this week' : 'Once per week'}
        </Badge>
      </div>

      {!done ? (
        <p className="mb-3 text-sm text-muted">
          Send your staff to break down the {team?.name}: this season&rsquo;s tendencies, their two
          most-targeted receivers and top pass rusher, and how to attack them.
        </p>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="rounded-lg bg-surface-2 p-3">
            <div className="label mb-1.5">Tendencies this season</div>
            <div className="text-ink-2">
              Offense: {tendencyLine(league, teamId, '1st', 'off')} on 1st down ·{' '}
              {tendencyLine(league, teamId, '3rd-long', 'off')} on 3rd &amp; long.
            </div>
            <div className="mt-1 text-ink-2">
              Defense: {tendencyLine(league, teamId, '1st', 'def')} on 1st down ·{' '}
              {tendencyLine(league, teamId, '3rd-long', 'def')} on 3rd &amp; long.
            </div>
          </div>

          <div>
            <div className="label mb-1.5">Most-targeted receivers</div>
            {receivers.length ? (
              <div className="space-y-1">
                {receivers.map(({ p, s }) => (
                  <div key={p.id} className="flex items-center gap-2">
                    <PlayerHoverCard player={p} className="min-w-0 text-sm font-600 text-ink" />
                    <span className="font-cond text-[10px] font-700 uppercase text-muted">{p.pos}</span>
                    <span className="ml-auto font-cond text-xs tnum text-muted">
                      {s.targets} tgt · {s.rec} rec · {s.recYds} yds
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted">No targets recorded yet this season.</p>
            )}
          </div>

          <div>
            <div className="label mb-1.5">Top pass rusher</div>
            {rusher ? (
              <div className="flex items-center gap-2">
                <PlayerHoverCard player={rusher.p} className="min-w-0 text-sm font-600 text-ink" />
                <span className="font-cond text-[10px] font-700 uppercase text-muted">{rusher.p.pos}</span>
                <span className="ml-auto font-cond text-xs tnum text-muted">
                  {rusher.s.defSacks} sck · {rusher.s.tackles} tkl
                </span>
              </div>
            ) : (
              <p className="text-xs text-muted">No sacks recorded yet this season.</p>
            )}
          </div>

          {beat && (
            <div className="rounded-lg border border-line px-3 py-2 text-ink-2">
              <span className="label mr-1">How to beat them:</span>
              {beat}
            </div>
          )}
        </div>
      )}

      <ScoutButton teamId={teamId} className="mt-3" />
    </Card>
  )
}

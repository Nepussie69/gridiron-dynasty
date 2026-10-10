import { AlertTriangle, Shield, Sparkles, Users } from 'lucide-react'
import { cn } from '../lib/cn'
import {
  MAX_CAPTAINS,
  MAX_MENTEES,
  avgMorale,
  leaderScore,
  lockerEffort,
  lockerRoomState,
  menteesOf,
  problemPlayers,
  problemScore,
  rankedLeaders,
} from '../game/engine/lockerRoom'
import type { Player } from '../game/types'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card, OvrBadge, RatingBar } from '../ui/kit'
import { TONE_COLOR } from '../ui/nav'
import type { Tone } from '../lib/format'

const SELECT_CLASS =
  'min-w-0 rounded-[var(--r-md)] border border-line-strong bg-surface-2 px-2 py-1 font-cond text-label font-700 uppercase tracking-[0.06em] text-ink outline-none pointer-coarse:min-h-11'

/** Morale band: tone for the effort meter (neutral when healthy, red only when sour). */
function moraleTone(v: number): Tone {
  return v >= 80 ? 'win' : v >= 65 ? 'warn' : 'loss'
}

/**
 * L15 (FUTURES row 16): the Locker Room.
 *
 * Name captains, pair young players with a captain to learn from, and see who
 * the room's problems are. Mentoring speeds a young player's offseason growth;
 * the effort toggle (off by default) turns the room's morale into a small
 * on-field edge for your club only.
 */
export function LockerRoomCard({ teamId, className }: { teamId: string; className?: string }) {
  const world = useWorld()
  const career = useGame((s) => s.career)
  const toggleCaptain = useGame((s) => s.toggleLockerCaptain)
  const assignMentor = useGame((s) => s.assignMentor)
  const toggleEffort = useGame((s) => s.toggleLockerEffort)
  const autoLockerRoom = useGame((s) => s.autoLockerRoom)
  const selectPlayer = useGame((s) => s.selectPlayer)

  if (!career) return null

  const state = lockerRoomState(career, world.season)
  const captains = state.captains
  const leaders = rankedLeaders(world, teamId).slice(0, 8)
  const problems = problemPlayers(world, teamId).slice(0, 4)
  const mentees = menteesOf(world, teamId)
  const morale = avgMorale(world, teamId)
  const effort = lockerEffort(world, career)
  const mentored = Object.keys(state.mentors).length
  const captainPlayers = captains
    .map((id) => (world.roster[teamId] ?? []).find((p) => p.id === id))
    .filter((p): p is Player => !!p)

  return (
    <Card className={className}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Shield size={16} className="shrink-0 text-[var(--team-accent)]" aria-hidden />
        <h3 className="font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">Locker Room</h3>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          <Badge tone="neutral">
            {captains.length}/{MAX_CAPTAINS} captains
          </Badge>
          <Badge tone={mentored ? 'win' : 'neutral'}>
            {mentored}/{MAX_MENTEES} mentored
          </Badge>
          <Button size="sm" variant="secondary" onClick={autoLockerRoom} title="Name the best leaders and pair every young player">
            <Sparkles size={13} aria-hidden /> Auto
          </Button>
        </div>
      </div>

      <p className="mb-3 text-body leading-snug text-muted">
        Captains settle the room, and a young player paired with one learns faster at season&apos;s end. Your club only —
        the AI never carries a program.
      </p>

      <div className="mb-3 rounded-[var(--r-md)] border border-line bg-surface-2 p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="label mb-1">Room morale</div>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <RatingBar value={morale} color={TONE_COLOR[moraleTone(morale)]} height={8} />
              </div>
              <span className="shrink-0 font-display text-body font-700 tnum text-ink">{Math.round(morale)}</span>
            </div>
          </div>
          <Button
            size="sm"
            variant={effort.on ? 'primary' : 'secondary'}
            aria-pressed={effort.on}
            onClick={toggleEffort}
            title="When on, your squad's morale nudges your club's on-field effort. Off by default."
          >
            {effort.on ? 'Effort edge: ON' : 'Effort edge: OFF'}
          </Button>
        </div>
        <p className="mt-2 text-label leading-snug text-muted">
          {effort.on
            ? `Morale is feeding a ${effort.off >= 0 ? '+' : ''}${effort.off.toFixed(2)} effort edge on both sides of the ball. This is opt-in and only touches your club.`
            : 'Off by default, so morale never changes a game result. Turn it on and a settled, happy room plays a little harder — a sour one lets down.'}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <Users size={13} className="text-muted" aria-hidden />
            <span className="font-cond text-label font-700 uppercase tracking-[0.06em] text-ink-2">Leaders</span>
            <span className="text-label text-muted">· tap to name a captain</span>
          </div>
          <div className="divide-y divide-line/60 rounded-[var(--r-md)] border border-line">
            {leaders.map((p) => {
              const on = captains.includes(p.id)
              const score = leaderScore(p)
              return (
                <div key={p.id} className="flex items-center gap-2 px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => selectPlayer(p.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left max-sm:min-h-11 pointer-coarse:min-h-11"
                    title="Open player profile"
                  >
                    <OvrBadge value={p.ovr} size={26} />
                    <span className="min-w-0">
                      <span className="block truncate text-body font-600 text-ink">{p.name}</span>
                      <span className="block truncate text-label text-muted">
                        {p.pos} · {p.age} yrs · leadership {score}
                      </span>
                    </span>
                  </button>
                  <Button
                    size="sm"
                    variant={on ? 'primary' : 'secondary'}
                    aria-pressed={on}
                    className="shrink-0"
                    onClick={() => toggleCaptain(p.id)}
                    title={on ? 'Remove captain' : 'Name captain'}
                  >
                    {on ? 'Captain' : 'Name'}
                  </Button>
                </div>
              )
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-center gap-1.5">
              <Sparkles size={13} className="text-muted" aria-hidden />
              <span className="font-cond text-label font-700 uppercase tracking-[0.06em] text-ink-2">Mentoring</span>
              <span className="text-label text-muted">· pair a young player with a captain</span>
            </div>
            {mentees.length ? (
              <div className="max-h-64 divide-y divide-line/60 overflow-y-auto rounded-[var(--r-md)] border border-line">
                {mentees.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => selectPlayer(p.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left max-sm:min-h-11 pointer-coarse:min-h-11"
                      title="Open player profile"
                    >
                      <OvrBadge value={p.ovr} pot={p.pot} size={26} />
                      <span className="min-w-0">
                        <span className="block truncate text-body font-600 text-ink">{p.name}</span>
                        <span className="block truncate text-label text-muted">
                          {p.pos} · {p.age} yrs · {p.pot - p.ovr} to ceiling
                        </span>
                      </span>
                    </button>
                    <select
                      className={cn(SELECT_CLASS, 'max-w-[48%]', state.mentors[p.id] ? 'text-ink' : 'text-muted')}
                      value={state.mentors[p.id] ?? ''}
                      disabled={!captainPlayers.length}
                      title={captainPlayers.length ? 'Pick a mentor' : 'Name a captain first'}
                      onChange={(e) => assignMentor(p.id, e.target.value || null)}
                    >
                      <option value="">No mentor</option>
                      {captainPlayers
                        .filter((c) => c.id !== p.id)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-line px-2 py-3 text-sm text-muted">
                No young players (age 23 &amp; under) to mentor right now.
              </p>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center gap-1.5">
              <AlertTriangle size={13} className="text-warn" aria-hidden />
              <span className="font-cond text-label font-700 uppercase tracking-[0.06em] text-ink-2">Watch list</span>
              <span className="text-label text-muted">· the room&apos;s distractions</span>
            </div>
            {problems.length ? (
              <div className="divide-y divide-line/60 rounded-[var(--r-md)] border border-line">
                {problems.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => selectPlayer(p.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left max-sm:min-h-11 pointer-coarse:min-h-11"
                      title="Open player profile"
                    >
                      <OvrBadge value={p.ovr} size={26} />
                      <span className="min-w-0">
                        <span className="block truncate text-body font-600 text-ink">{p.name}</span>
                        <span className="block truncate text-label text-muted">
                          {p.pos} · {p.age} yrs · morale {Math.round(p.morale)}
                        </span>
                      </span>
                    </button>
                    <Badge tone={problemScore(p) >= 72 ? 'loss' : 'warn'} className="shrink-0">
                      {problemScore(p) >= 72 ? 'Problem' : 'Watch'}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-line px-2 py-3 text-sm text-muted">
                No problem players. A quiet room.
              </p>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

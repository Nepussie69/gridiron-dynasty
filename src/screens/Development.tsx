import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { cn } from '../lib/cn'
import { useGame, useWorld } from '../store/gameStore'
import { coachEffect } from '../game/engine/coaching'
import {
  DEV_GROUP_LABEL,
  DEV_GROUP_ORDER,
  MAX_DEV_AGE,
  devFocusById,
  devGroupFor,
  focusKeysFor,
  focusOptionsFor,
  type DevFocusId,
} from '../game/engine/devPlan'
import type { Player } from '../game/types'
import { LockerRoomCard } from '../components/LockerRoomCard'
import { Badge, Button, Card, OvrBadge, PageHeader, Stat } from '../ui/kit'

const SELECT_CLASS =
  'min-w-0 rounded-md border border-line bg-surface-2 px-2 py-1 font-cond text-xs font-700 uppercase tracking-wide text-ink outline-none'

/** L15 (FUTURES row 13): set a development focus for each young player. */
export function Development() {
  const world = useWorld()
  const career = useGame((s) => s.career)
  const activeTeamId = useGame((s) => s.activeTeamId)
  const setDevFocus = useGame((s) => s.setDevFocus)
  const autoDevPlans = useGame((s) => s.autoDevPlans)
  const selectAllDevFocus = useGame((s) => s.selectAllDevFocus)
  const selectPlayer = useGame((s) => s.selectPlayer)
  // One pending "select all" focus per group, held only in the UI.
  const [pick, setPick] = useState<Record<string, DevFocusId | ''>>({})

  const teamId = career?.teamId ?? activeTeamId
  const team = world.byId[teamId]
  const roster = world.roster[teamId] ?? []

  const young = roster.filter((p) => p.age <= MAX_DEV_AGE)

  // Group the young players by position group, most room to grow first.
  const grouped = new Map<string, Player[]>()
  for (const p of young) {
    const g = devGroupFor(p.pos)
    const list = grouped.get(g) ?? []
    list.push(p)
    grouped.set(g, list)
  }
  for (const list of grouped.values()) list.sort((a, b) => b.pot - b.ovr - (a.pot - a.ovr) || b.ovr - a.ovr)

  const program = team ? coachEffect(world, teamId).development : 1
  const planned = young.filter((p) => p.devFocus).length
  const groups = DEV_GROUP_ORDER.filter((g) => grouped.has(g))

  return (
    <div>
      <PageHeader
        eyebrow="Team"
        title="Development"
        subtitle={`Set a focus for your young players (age ${MAX_DEV_AGE} and under). They bank focused rating points with playing time, so starters and producers grow fastest.`}
        right={
          <Button variant="primary" size="md" onClick={() => autoDevPlans()}>
            <Sparkles size={15} /> Auto plan all
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <Stat label="Young Players" value={young.length} sub={`age ${MAX_DEV_AGE} & under`} />
        </Card>
        <Card>
          <Stat label="Plans Set" value={planned} sub={`${young.length - planned} without a focus`} tone={planned ? 'win' : undefined} />
        </Card>
        <Card>
          <Stat label="Program" value={`×${program.toFixed(2)}`} sub="position-coach development" />
        </Card>
        <Card>
          <Stat label="Max Per Skill" value={'+6'} sub="banked over a career" />
        </Card>
      </div>

      <Card className="mb-4">
        <p className="text-sm leading-relaxed text-muted">
          A focus decides <span className="font-600 text-ink-2">which ratings</span> a young player works on with his
          position coach. At season&apos;s end he banks focused points based on his snaps and production — a bench
          player earns nothing, and a strong development program (better position coaches) pays off more. Auto picks
          the weakest area for each player; Select all stamps one focus across a whole group. Plans only affect your
          club, and a player with no focus develops exactly as before.
        </p>
      </Card>

      <LockerRoomCard teamId={teamId} className="mb-4" />

      {!groups.length && (
        <Card>
          <p className="py-6 text-center text-sm text-muted">
            No young players on the {team?.name ?? 'club'} to plan for right now.
          </p>
        </Card>
      )}

      <div className="space-y-4">
        {groups.map((g) => {
          const list = grouped.get(g)!
          const options = focusOptionsFor(list[0].pos)
          const pending = pick[g] ?? ''
          return (
            <Card key={g}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h3 className="font-display text-lg font-700 uppercase tracking-wide text-ink">{DEV_GROUP_LABEL[g]}</h3>
                <Badge tone="neutral">{list.length}</Badge>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => autoDevPlans(g)}>
                    Auto
                  </Button>
                  <select
                    className={SELECT_CLASS}
                    value={pending}
                    onChange={(e) => setPick((p) => ({ ...p, [g]: (e.target.value as DevFocusId) || '' }))}
                  >
                    <option value="">Select focus…</option>
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="default"
                    disabled={!pending}
                    onClick={() => pending && selectAllDevFocus(g, pending)}
                  >
                    Select all
                  </Button>
                </div>
              </div>

              <div className="divide-y divide-line/60">
                {list.map((p) => {
                  const opts = focusOptionsFor(p.pos)
                  const def = devFocusById(p.devFocus)
                  const keys = def ? focusKeysFor(p.pos, def) : []
                  const gains = p.devRatings ?? {}
                  const gained = Object.keys(gains).filter((k) => gains[k] > 0)
                  return (
                    <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
                      <button
                        type="button"
                        onClick={() => selectPlayer(p.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        title="Open player profile"
                      >
                        <OvrBadge value={p.ovr} pot={p.pot} size={28} />
                        <span className="w-8 shrink-0 font-cond text-[11px] font-700 uppercase text-muted">{p.pos}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-600 text-ink">{p.name}</span>
                          <span className="block truncate text-[11px] text-muted">
                            {p.age} yrs
                            {p.pot - p.ovr > 0 ? ` · ${p.pot - p.ovr} to ceiling` : ' · at ceiling'}
                            {keys.length ? ` · trains ${keys.join(' · ')}` : ''}
                          </span>
                        </span>
                      </button>

                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {gained.length > 0 && (
                          <span className="hidden items-center gap-1 sm:flex">
                            {gained.map((k) => (
                              <span
                                key={k}
                                title={`Development-plan gain: ${k} +${gains[k]}`}
                                className="rounded-md border border-win/30 bg-win-soft px-1.5 py-0.5 font-cond text-[10px] font-700 uppercase tracking-wide text-win"
                              >
                                {k} +{gains[k]}
                              </span>
                            ))}
                          </span>
                        )}
                        <select
                          className={cn(SELECT_CLASS, def ? 'text-ink' : 'text-muted')}
                          value={p.devFocus ?? ''}
                          title={def ? def.blurb : 'No development plan'}
                          onChange={(e) => setDevFocus(p.id, ((e.target.value as DevFocusId) || null) as DevFocusId | null)}
                        >
                          <option value="">No plan</option>
                          {opts.map((o) => (
                            <option key={o.id} value={o.id} title={o.blurb}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

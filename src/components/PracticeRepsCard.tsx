import { useState } from 'react'
import { ClipboardCheck, RotateCcw } from 'lucide-react'
import {
  PADDED_CAP,
  autoInstall,
  canPractice,
  installBudget,
  installPicks,
  opponentOf,
  playInfo,
  practicePlan,
  repGroupView,
  repGroupsFor,
  repLoad,
  userWeekReps,
  weekStructure,
  type RepWeekState,
} from '../game/engine/practice'
import { PLAYBOOK } from '../game/data/playbookData'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, Chip, OptionCard, OptionGroup, RatingBar } from '../ui/kit'
import { Button } from '../ui/Controls'
import { cn } from '../lib/cn'

/**
 * FUTURES #45 — the practice week.
 *
 * One row per position group: how the week's reps split between the ones and the
 * backups, the staff's Auto split, and what that split does to THESE men — their
 * Sunday readiness, the soft-tissue load it puts on them, and the development a
 * young backup banks. Below it, the opponent-specific install: the concepts the
 * coordinator has bought with his own budget.
 *
 * Desktop is a two-column grid (groups | install); the phone stacks it, and the
 * sliders grow to a touch-sized track.
 */
export function PracticeRepsCard({ className, disabled = false }: { className?: string; disabled?: boolean }) {
  const career = useGame((s) => s.career)!
  const world = useWorld()
  const pickRepSplit = useGame((s) => s.pickRepSplit)
  const setRepAuto = useGame((s) => s.setRepAuto)
  const pickInstall = useGame((s) => s.pickInstall)
  const autoRepWeek = useGame((s) => s.autoRepWeek)
  const [openGroup, setOpenGroup] = useState<string | null>(null)

  if (!canPractice(career)) return null

  const plan = practicePlan(career, world)
  const state: RepWeekState = userWeekReps(world, career)
  const struct = weekStructure(world, career.teamId, world.week)
  const paddedLeft = Math.max(0, PADDED_CAP - state.padded)
  const { padded, load, note } = repLoad(struct, plan, paddedLeft)
  const groups = repGroupsFor(world, career.teamId)
  const budget = installBudget(world, career.teamId)
  const picks = installPicks(state, budget)
  const opp = opponentOf(world, career.teamId, world.week)
  const oppName = opp ? world.byId[opp]?.abbr ?? world.byId[opp]?.name ?? opp : undefined
  const staffPicks = autoInstall(world, career.teamId, opp, budget)
  const chosen = picks.join('|') === staffPicks.join('|')
  const allAuto = groups.every((g) => state.auto.includes(g))

  // Readiness/load at a glance, across the men the split actually moves.
  const views = groups.map((g) => repGroupView(world, career.teamId, g, state.split[g] ?? 0.65, load, picks))
  const readyAvg = views.length ? views.reduce((s, v) => s + v.starterReady, 0) / views.length : 0
  const riskHi = views.reduce((s, v) => Math.max(s, v.riskHi), 1)
  const devTop = views.reduce((s, v) => Math.max(s, v.devWeek), 0)

  return (
    <Card className={className}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-display text-lg font-700 uppercase tracking-wide">
          <ClipboardCheck size={15} className="text-[var(--team-accent)]" aria-hidden /> Practice week
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={paddedLeft > 0 ? 'neutral' : 'warn'}>
            {state.padded}/{PADDED_CAP} pads used
          </Badge>
          <Badge tone={readyAvg > 0.1 ? 'win' : readyAvg < -0.1 ? 'warn' : 'neutral'}>
            {readyAvg >= 0 ? '+' : ''}
            {readyAvg.toFixed(1)} readiness
          </Badge>
          {allAuto ? <Badge tone="info">Staff Auto</Badge> : <Badge tone="neutral">Your split</Badge>}
        </div>
      </div>

      {/* The week's shape: which days, how many in pads, short week or not. */}
      <div className="mb-3 rounded-[var(--r-sm)] border border-line bg-surface-2 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {struct.days.length ? (
            struct.days.map((d) => (
              <Chip key={d} className={d === 'Thu' && padded > 0 ? 'border-line-strong' : undefined}>
                {d}
                {d === 'Thu' && padded > 0 ? ' · pads' : ''}
              </Chip>
            ))
          ) : (
            <Chip>No game</Chip>
          )}
          <span className="text-small text-muted">{note}</span>
        </div>
        {padded > 0 && (
          <p className="mt-1 text-micro text-faint">
            {padded} padded practice{padded === 1 ? '' : 's'} this week · {paddedLeft} left of the CBA’s {PADDED_CAP} in-season cap.
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* ── Rep split per position group ─────────────────────────────────── */}
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="label">Rep split — starters vs backups</div>
            <Button size="sm" variant="quiet" disabled={disabled} onClick={autoRepWeek} icon={<RotateCcw size={13} aria-hidden />}>
              Auto all
            </Button>
          </div>
          <div className="space-y-2.5">
            {views.map((v) => {
              const auto = state.auto.includes(v.group)
              const share = state.split[v.group] ?? 0.65
              const open = openGroup === v.group
              return (
                <div key={v.group} className="rounded-[var(--r-sm)] border border-line px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-cond text-small font-700 uppercase tracking-wide text-ink">{v.label}</span>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant={auto ? 'primary' : 'secondary'}
                        disabled={disabled}
                        onClick={() => setRepAuto(v.group, !auto)}
                      >
                        Auto
                      </Button>
                      <span className="font-cond text-small font-700 tnum text-ink">
                        {Math.round(share * 100)}% ones
                      </span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={30}
                    max={95}
                    step={5}
                    value={Math.round(share * 100)}
                    disabled={disabled || auto}
                    aria-label={`${v.label}: starters' share of the reps`}
                    onChange={(e) => pickRepSplit(v.group, Number(e.target.value) / 100)}
                    className="mt-1 h-9 w-full accent-[var(--team-accent)] max-sm:h-11 disabled:opacity-45"
                  />
                  <div className="flex justify-between text-micro text-faint">
                    <span>All backups</span>
                    <span>All ones</span>
                  </div>

                  <div className="mt-1.5 grid grid-cols-3 gap-2">
                    <div>
                      <div className="text-micro text-faint">Ready</div>
                      <div className={cn('font-cond text-small font-700 tnum', v.starterReady >= 0 ? 'text-win' : 'text-warn')}>
                        {v.starterReady >= 0 ? '+' : ''}
                        {v.starterReady.toFixed(1)}
                      </div>
                    </div>
                    <div>
                      <div className="text-micro text-faint">Dev / wk</div>
                      <div className="font-cond text-small font-700 tnum text-ink">+{v.devWeek.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-micro text-faint">Soft-tissue</div>
                      <div className="font-cond text-small font-700 tnum text-ink">
                        ×{v.riskLo.toFixed(2)}–{v.riskHi.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <RatingBar value={Math.max(0, v.starterReady) * 30} max={100} height={5} label={`${v.label} starters' readiness`} />
                    <button
                      type="button"
                      className="text-micro text-brand underline-offset-2 hover:underline"
                      aria-expanded={open}
                      onClick={() => setOpenGroup(open ? null : v.group)}
                    >
                      {open ? 'Hide' : 'Men'}
                    </button>
                  </div>
                  {open && (
                    <ul className="mt-1 space-y-0.5">
                      {v.names.map((n) => (
                        <li key={n.id} className="flex items-center justify-between text-small text-muted">
                          <span>
                            <b className="font-600 text-ink">{n.name}</b> · {n.starter ? 'one' : 'backup'} · {n.age}
                          </span>
                          <span className="font-cond tnum">{n.ovr}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
          <p className="mt-2 text-small leading-snug text-muted">
            Starter reps sharpen Sunday’s execution in the men who take them, and load them: {riskHi.toFixed(2)}× soft-tissue risk at the
            top of a group. Backup reps develop young players (up to +{devTop.toFixed(2)} a week, banked, paid out at season end) and keep
            them ready to play.
          </p>
        </div>

        {/* ── Install ──────────────────────────────────────────────────────── */}
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="label">
              Install {oppName ? `vs ${oppName}` : ''}
            </div>
            <Badge tone={picks.length >= budget ? 'warn' : 'neutral'}>
              {picks.length} of {budget} concepts
            </Badge>
          </div>
          <p className="mb-2 text-small leading-snug text-muted">
            Your coordinator’s own install budget this week. An installed concept executes a little better Sunday, and the men in a group it
            touches are sharper in it.
          </p>
          <OptionGroup label="Installed concepts" className="sm:grid-cols-2">
            {(chosen ? staffPicks : picks).map((name) => {
              const info = playInfo(name)
              if (!info) return null
              return (
                <OptionCard
                  key={name}
                  selected
                  disabled={disabled}
                  onSelect={() => pickInstall(name)}
                  title={name}
                  description={`${info.type === 'run' ? 'Run' : 'Pass'} · ${info.formation} · ${info.personnel} personnel`}
                />
              )
            })}
          </OptionGroup>
          <div className="mt-2">
            <div className="label mb-1.5">Available</div>
            <div className="flex flex-wrap gap-1.5">
              {PLAYBOOK.filter((p) => !p.trick)
                .filter((p) => !(chosen ? staffPicks : picks).includes(p.name))
                .filter((p) => p.personnel === '11' || p.personnel === '12' || p.personnel === '21')
                .slice(0, 12)
                .map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    disabled={disabled}
                    onClick={() => pickInstall(p.name)}
                    className="rounded-[var(--r-xs)] border border-line bg-surface-2 px-2 py-1 text-small text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-45"
                  >
                    {p.name}
                  </button>
                ))}
            </div>
            <p className="mt-1.5 text-micro text-faint">
              Picking replaces the oldest of the {budget} installed concepts — the coordinator’s budget is fixed for the week.
            </p>
          </div>
        </div>
      </div>
    </Card>
  )
}

import { cn } from '../lib/cn'
import {
  BALANCED_PLAN,
  PLAN_PRESETS,
  describePlan,
  planEffects,
  type GamePlan,
} from '../game/engine/gameplan'
import { OptionCard, OptionGroup, RatingBar } from '../ui/kit'

/**
 * The plan editor: preset cards plus the dials for one side. Shared by the
 * pre-game "Game Plan" tab and the in-game overlay so the mental model is
 * identical. Offense edits only Run/Pass + Tempo; defense only Pass Rush +
 * Coverage. Hidden dials keep their current values.
 *
 * D6: presets are kit OptionCards (radio mark, distinct hover/selected states).
 * The "What this does" bars are neutral ink — never red for a high value.
 */
export function PlanEditor({
  plan,
  onChange,
  side,
  compact = false,
  disabled = false,
}: {
  plan: GamePlan
  onChange: (p: GamePlan) => void
  side: 'off' | 'def'
  compact?: boolean
  /** Access 'view' / a locked game: show the plan without letting it be edited. */
  disabled?: boolean
}) {
  const eff = planEffects(plan, false)
  const defEff = planEffects(plan, true)
  const presets = PLAN_PRESETS.filter((p) => p.side === side)

  const dial = (
    label: string,
    key: keyof GamePlan,
    min: number,
    max: number,
    step: number,
    leftLabel: string,
    rightLabel: string,
  ) => (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="label">{label}</span>
        <span className="font-cond text-small font-700 tnum text-ink">{plan[key].toFixed(1)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={plan[key]}
        disabled={disabled}
        onChange={(e) => onChange({ ...plan, [key]: Number(e.target.value) })}
        className="h-9 w-full accent-[var(--team-accent)] max-sm:h-11 disabled:opacity-45"
      />
      <div className="mt-0.5 flex justify-between text-micro text-faint">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  )

  return (
    <div className={cn('space-y-4', compact && 'space-y-3')}>
      {!compact && (
        <div>
          <div className="label mb-2">Presets</div>
          <OptionGroup
            label={`${side === 'off' ? 'Offense' : 'Defense'} preset`}
            className="sm:grid-cols-2 lg:grid-cols-3"
          >
            {presets.map((p) => {
              const active = JSON.stringify(p.plan) === JSON.stringify(plan)
              return (
                <OptionCard
                  key={p.id}
                  selected={active}
                  disabled={disabled}
                  onSelect={() => onChange({ ...p.plan })}
                  title={p.label}
                  description={p.blurb}
                />
              )
            })}
          </OptionGroup>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {side === 'off' ? (
          <>
            {dial('Run / Pass', 'passBias', -2, 2, 0.2, 'Run heavy', 'Pass heavy')}
            {dial('Tempo', 'tempo', -1, 1, 0.2, 'Drain clock', 'Hurry up')}
          </>
        ) : (
          <>
            {dial('Pass Rush', 'aggression', 0, 2, 0.2, 'Conservative', 'All-out blitz')}
            {dial('Coverage', 'coverage', 0, 2, 0.2, 'Soft zone', 'Press man')}
          </>
        )}
      </div>

      <div className="rounded-[var(--r-md)] bg-surface-2 p-3">
        <div className="label mb-1.5">What this does</div>
        <div className="grid gap-2 text-small text-ink-2 sm:grid-cols-2">
          {side === 'off' ? (
            <>
              <MiniBar label="Pass tendency" value={50 + eff.passAdj * 400} />
              <MiniBar label="Clock used/play" value={50 + (eff.timeScale - 1) * 220} />
            </>
          ) : (
            <>
              <MiniBar label="Blitz rate" value={50 + defEff.blitz * 250} />
              <MiniBar label="Big-play risk" value={50 + (defEff.bigPlayRisk - 1) * 220} />
            </>
          )}
        </div>
        <div className="mt-2 text-small text-muted">{describePlan(plan, side)}</div>
      </div>

      {!compact && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ ...BALANCED_PLAN })}
          className="inline-flex min-h-11 items-center font-cond text-small font-600 uppercase lg:min-h-0 tracking-wide text-muted hover:text-ink-2 disabled:opacity-45"
        >
          Reset to balanced
        </button>
      )}
    </div>
  )
}

/** A neutral 0–100 read of one plan dial; no status colour, no red for "high". */
function MiniBar({ label, value }: { label: string; value: number }) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 font-cond text-label font-700 uppercase text-muted">{label}</span>
      <div className="flex-1">
        <RatingBar value={clamped} height={6} color="var(--color-ink-2)" label={label} />
      </div>
    </div>
  )
}

import { useState } from 'react'
import { ClipboardList, Repeat } from 'lucide-react'
import { cn } from '../lib/cn'
import { describePlan, type GamePlan } from '../game/engine/gameplan'
import { DEFAULT_CALL_SHEET, type CallSheet, type FourthStyle } from '../game/engine/decisions'
import { capabilities } from '../game/engine/capabilities'
import { PlanEditor } from '../components/PlanEditor'
import { CulturePanel } from '../components/CulturePanel'
import { SchemeFitReport } from '../components/SchemeFitReport'
import { WrinkleCard } from '../components/WrinkleCard'
import { InstallCard } from '../components/InstallCard'
import { canWrinkle } from '../game/engine/wrinkle'
import { teamRatings } from '../game/engine/depth'
import { coachLabels } from '../game/engine/playsim'
import { recordOf, scheduleFor } from '../game/selectors'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, PageHeader, TeamCrest } from '../ui/kit'

export function GamePlanScreen() {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const defaultPlan = useGame((s) => s.defaultPlan)
  const setDefaultPlan = useGame((s) => s.setDefaultPlan)
  const [side, setSide] = useState<'off' | 'def'>('off')

  const team = league.byId[career.teamId]
  const coaches = coachLabels(league, career.teamId)
  const { out: schedule } = scheduleFor(league, career.teamId)
  const next = schedule.find((g) => !g.played)
  const opp = next ? league.byId[next.opponentId] : null

  const myRatings = teamRatings(league, career.teamId)
  const oppRatings = opp ? teamRatings(league, opp.id) : null

  const plan: GamePlan = defaultPlan[side]
  const opponentScheme = opp
    ? side === 'off'
      ? coachLabels(league, opp.id).dcScheme
      : coachLabels(league, opp.id).ocScheme
    : undefined

  return (
    <div>
      <PageHeader
        eyebrow={`${team.tier === 'NFL' ? `${team.conference} ${team.division}` : team.conference} · Week ${league.week}`}
        title="Game Plan"
        subtitle="Set how you want to play before kickoff. Your plan is applied to every game until you change it — fast sim plays it out with your standing orders."
        right={
          <div className="flex rounded-lg bg-surface-2 p-0.5">
            {(['off', 'def'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSide(s)}
                className={cn(
                  'rounded-md px-4 py-1.5 font-cond text-xs font-700 uppercase tracking-wide transition',
                  side === s ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink-2',
                )}
              >
                {s === 'off' ? 'Offense' : 'Defense'}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          <Card>
            <div className="mb-3 flex items-center gap-2">
              <ClipboardList size={16} className="text-muted" />
              <h3 className="font-display text-lg font-700 uppercase tracking-wide">
                {side === 'off' ? 'Offensive Plan' : 'Defensive Plan'}
              </h3>
              <Badge tone="team" className="ml-auto">{side === 'off' ? coaches.ocScheme : coaches.dcScheme}</Badge>
            </div>
            <PlanEditor plan={plan} onChange={(p) => setDefaultPlan(side, p)} side={side} />
          </Card>

          <SchemeFitReport teamId={team.id} side={side} />
          {canWrinkle(career) && <WrinkleCard />}
          <InstallCard />
          <CallSheetCard />
          <CulturePanel teamId={team.id} />
        </div>

        <div className="space-y-5">
          {next && opp && oppRatings && (
            <Card pad={false} className="overflow-hidden">
              <div className="border-b border-line bg-surface-2 px-4 py-2">
                <span className="label">Up Next · Week {next.week}</span>
              </div>
              <div className="flex items-center gap-4 p-4">
                <TeamCrest team={team} size={44} />
                <div className="flex-1">
                  <div className="font-display text-lg font-700 uppercase leading-none">{team.name}</div>
                  <div className="font-cond text-xs text-muted">{recordOf(league, team.id).wins}-{recordOf(league, team.id).losses}</div>
                </div>
                <span className="font-display text-faint">vs</span>
                <div className="flex-1 text-right">
                  <div className="font-display text-lg font-700 uppercase leading-none">{opp.name}</div>
                  <div className="font-cond text-xs text-muted">{recordOf(league, opp.id).wins}-{recordOf(league, opp.id).losses}</div>
                </div>
                <TeamCrest team={opp} size={44} />
              </div>
              <div className="grid grid-cols-2 gap-4 border-t border-line px-4 py-3">
                <RatingColumn label="You" r={myRatings} />
                <RatingColumn label={opp.name} r={oppRatings} right />
              </div>
              <div className="space-y-1.5 border-t border-line bg-surface-2/40 px-4 py-2.5">
                <MatchupLine text="Your offense" mine={myRatings.off} other="their defense" theirs={oppRatings.def} />
                <MatchupLine text="Your defense" mine={myRatings.def} other="their offense" theirs={oppRatings.off} />
              </div>
              <div className="border-t border-line px-4 py-2.5 text-xs text-muted">
                Opponent runs <strong className="text-ink">{opponentScheme}</strong>
                {side === 'off' ? ' defense' : ' offense'} — plan accordingly.
              </div>
            </Card>
          )}

          <Card>
            <h3 className="mb-3 font-display text-lg font-700 uppercase tracking-wide">Coordinator Notes</h3>
            <div className="space-y-3 text-sm">
              <div className="rounded-lg bg-surface-2 p-3">
                <div className="label mb-0.5">{coaches.oc} · OC</div>
                <div className="text-ink-2">{coaches.ocScheme}</div>
                <div className="mt-1 text-xs text-muted">
                  {describePlan(defaultPlan.off, 'off')}
                </div>
              </div>
              <div className="rounded-lg bg-surface-2 p-3">
                <div className="label mb-0.5">{coaches.dc} · DC</div>
                <div className="text-ink-2">{coaches.dcScheme}</div>
                <div className="mt-1 text-xs text-muted">
                  {describePlan(defaultPlan.def, 'def')}
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-start gap-2 text-xs leading-relaxed text-muted">
              <Repeat size={14} className="mt-0.5 shrink-0" />
              <span>
                Plans are saved and reused every week. When a game kicks off, “Coach the game”
                pauses at the big moments so you can make the call — otherwise fast sim answers
                them with these standing orders.
              </span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

const FOURTH_HINT: Record<FourthStyle, string> = {
  conservative: 'Goes for it only on 4th & 1 past midfield.',
  standard: 'Takes the best expected value — goes for it on 4th & short.',
  aggressive: 'Goes for it on 4th & 6 or less when the numbers are close.',
}

function CallSheetCard() {
  const career = useGame((s) => s.career)!
  const setCallSheet = useGame((s) => s.setCallSheet)
  const scope = capabilities(career).planScope
  if (scope === 'none') return null
  const sheet: CallSheet = career.callSheet ?? DEFAULT_CALL_SHEET
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <ClipboardList size={16} className="text-muted" />
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">Call Sheet</h3>
      </div>
      {scope === 'own-side' ? (
        <p className="text-sm text-muted">4th downs and 2-point tries belong to the head coach.</p>
      ) : (
        <div className="space-y-3">
          <CallSheetRow
            label="4th down"
            value={sheet.fourth}
            onChange={(fourth) => setCallSheet({ ...sheet, fourth })}
            options={(['conservative', 'standard', 'aggressive'] as FourthStyle[]).map((id) => ({
              id,
              label: id[0].toUpperCase() + id.slice(1),
              hint: FOURTH_HINT[id],
            }))}
          />
          <CallSheetRow
            label="2-point tries"
            value={sheet.twoPoint}
            onChange={(twoPoint) => setCallSheet({ ...sheet, twoPoint })}
            options={[
              { id: 'chart', label: 'Chart', hint: 'Follow the chart by score and quarter.' },
              { id: 'kick', label: 'Always kick', hint: 'Always take the extra point.' },
            ]}
          />
          <CallSheetRow
            label="Timeouts"
            value={sheet.timeouts}
            onChange={(timeouts) => setCallSheet({ ...sheet, timeouts })}
            options={[
              { id: 'save', label: 'Save', hint: 'Hold them for the end of the half.' },
              { id: 'aggressive', label: 'Use aggressively', hint: 'Stop the clock when you need the ball.' },
            ]}
          />
        </div>
      )}
    </Card>
  )
}

function CallSheetRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { id: T; label: string; hint: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div>
      <div className="label mb-1">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-left transition',
              value === o.id
                ? 'border-[var(--team)] bg-[var(--team-soft)]'
                : 'border-line bg-surface-2 hover:border-line-strong',
            )}
          >
            <div className={cn('font-cond text-xs font-700 uppercase tracking-wide', value === o.id ? 'text-ink' : 'text-muted')}>
              {o.label}
            </div>
            <div className="text-[10px] leading-snug text-muted">{o.hint}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function RatingColumn({
  label,
  r,
  right,
}: {
  label: string
  r: { off: number; def: number; overall: number }
  right?: boolean
}) {
  return (
    <div className={cn(right && 'text-right')}>
      <div className="label mb-1.5 truncate">{label}</div>
      <div className={cn('flex items-center gap-4', right && 'justify-end')}>
        {(['off', 'def', 'overall'] as const).map((k) => (
          <div key={k}>
            <div className="font-display text-base font-700 leading-none tnum text-ink">{r[k].toFixed(1)}</div>
            <div className="label mt-0.5 !text-[9px]">{k === 'overall' ? 'OVR' : k.toUpperCase()}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function MatchupLine({
  text,
  mine,
  other,
  theirs,
}: {
  text: string
  mine: number
  other: string
  theirs: number
}) {
  const edge = mine >= theirs
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-ink-2">
        {text} <strong className="text-ink tnum">{mine.toFixed(1)}</strong> vs {other}{' '}
        <strong className="text-ink tnum">{theirs.toFixed(1)}</strong>
      </span>
      <span
        className={cn(
          'ml-auto inline-flex items-center rounded-md border px-1.5 py-0.5 font-cond text-[10px] font-700 uppercase tracking-wide',
          edge ? 'border-[#bfe6cd] bg-[#e5f6ec] text-win' : 'border-[#f6c9ce] bg-[#fdeaec] text-loss',
        )}
      >
        {edge ? '▲' : '▼'} Edge
      </span>
    </div>
  )
}

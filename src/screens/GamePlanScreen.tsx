import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronRight, ClipboardList, Repeat, Search, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { signed } from '../lib/format'
import { PLAN_PRESETS, describePlan, type GamePlan } from '../game/engine/gameplan'
import { DEFAULT_ST, stRecordText, alertness } from '../game/engine/specialCalls'
import { coachTendency, DEFAULT_CALL_SHEET, BUCKETS, BUCKET_LABEL, OFF_CLASSES, DEF_CALLS, OFF_CLASS_LABEL, DEF_CALL_LABEL, topKey, type CallSheet, type FourthStyle } from '../game/engine/decisions'
import { capabilities } from '../game/engine/capabilities'
import { coordinatorAdvice } from '../game/engine/advice'
import { PlanEditor } from '../components/PlanEditor'
import { PersonnelCard } from '../components/PersonnelCard'
import { CulturePanel } from '../components/CulturePanel'
import { SchemeFitReport } from '../components/SchemeFitReport'
import { WrinkleCard } from '../components/WrinkleCard'
import { InstallCard } from '../components/InstallCard'
import { KeysCard } from '../components/KeysCard'
import { PracticeCard } from '../components/PracticeCard'
import { canWrinkle } from '../game/engine/wrinkle'
import { teamRatings } from '../game/engine/depth'
import { coachLabels } from '../game/engine/playsim'
import { FORMATIONS, PLAYBOOK } from '../game/data/playbookData'
import { RouteDiagram } from '../components/RouteDiagram'
import { recordOf, scheduleFor } from '../game/selectors'
import { teamRates, type TeamRateEntry } from '../game/teamRates'
import { useGame, useWorld } from '../store/gameStore'
import { TopPlayers } from '../components/TopPlayers'
import { TeamHoverCard } from '../components/TeamHoverCard'
import { ScoutButton } from '../components/ScoutClub'
import { AnalyticsCard } from '../components/AnalyticsCard'
import {
  AccessBanner,
  Badge,
  Button,
  Card,
  Delta,
  OptionCard,
  OptionGroup,
  PageHeader,
  SchemeChip,
  ScoreBlock,
  SectionTitle,
  SegmentedControl,
  VerdictChip,
} from '../ui/kit'
import { useAccessLevel } from '../ui/hooks'

export function GamePlanScreen() {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const defaultPlan = useGame((s) => s.defaultPlan)
  const setDefaultPlan = useGame((s) => s.setDefaultPlan)
  const setPersonnel = useGame((s) => s.setPersonnel)
  const viewTeam = useGame((s) => s.viewTeam)
  const tick = useGame((s) => s.tick)
  const level = useAccessLevel('gameplan')
  // At 'view' (the GM rung) the plan reads, it is not edited — no dead control.
  const readOnly = level !== 'decide'
  const [side, setSide] = useState<'off' | 'def'>('off')

  const team = league.byId[career.teamId]
  const coaches = coachLabels(league, career.teamId)
  const { out: schedule } = scheduleFor(league, career.teamId)
  const next = schedule.find((g) => !g.played)
  const opp = next ? league.byId[next.opponentId] : null

  const myRatings = teamRatings(league, career.teamId)
  const oppRatings = opp ? teamRatings(league, opp.id) : null
  // Read-only per-game rates + league ranks (recomputed when the world ticks).
  const rates = useMemo(() => {
    void tick
    return teamRates(league)
  }, [league, tick])

  const plan: GamePlan = defaultPlan[side]
  const scheme = side === 'off' ? coaches.ocScheme : coaches.dcScheme
  const opponentScheme = opp
    ? side === 'off'
      ? coachLabels(league, opp.id).dcScheme
      : coachLabels(league, opp.id).ocScheme
    : undefined
  const oppTend = opp ? coachTendency(league, opp.id) : null
  // FUTURES #4: the opponent's special-teams tendencies this season (if any).
  const oppSt = opp && league.stMemory?.season === league.season ? stRecordText(league.stMemory.teams[opp.id]) : ''

  const awayTeam = next ? (next.home ? opp : team) : null
  const homeTeam = next ? (next.home ? team : opp) : null

  return (
    <div>
      <PageHeader
        eyebrow="Team"
        title="Game Plan"
        subtitle="Set how you want to play before kickoff. Your plan is applied to every game until you change it — fast sim plays it out with your standing orders."
        right={
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <span className="label">Plan side</span>
            <SegmentedControl
              label="Plan side: offense or defense"
              value={side}
              onChange={setSide}
              options={[
                { id: 'off', label: 'Offense' },
                { id: 'def', label: 'Defense' },
              ]}
            />
          </div>
        }
      />

      <AccessBanner area="gameplan" className="mb-4" />

      {/* Up Next — the ScoreBlock hero, first on every breakpoint. */}
      {next && opp && oppRatings && awayTeam && homeTeam && (
        <Card pad={false} className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2">
            <span className="label">Up next · Week {next.week}</span>
            <span className="ml-auto label">{next.home ? 'Home' : 'Away'}</span>
          </div>

          <div className="flex items-center gap-2 p-4 sm:gap-4">
            <TeamHoverCard team={awayTeam} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => viewTeam(awayTeam.id)}
                className="min-w-0 w-full text-left transition hover:opacity-90"
              >
                <ScoreBlock
                  team={awayTeam}
                  sub={`${recordOf(league, awayTeam.id).wins}–${recordOf(league, awayTeam.id).losses}`}
                  size="md"
                />
                <span className="mt-1.5 block truncate font-display text-lg font-700 uppercase leading-none text-ink">
                  {awayTeam.name}
                </span>
              </button>
            </TeamHoverCard>

            <div className="flex shrink-0 flex-col items-center gap-0.5 px-1 text-center">
              <span className="font-display text-faint">{next.home ? 'vs' : '@'}</span>
              <span className="whitespace-nowrap font-cond text-label font-700 uppercase tracking-[0.07em] text-muted">
                Wk {next.week}
              </span>
            </div>

            <TeamHoverCard team={homeTeam} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => viewTeam(homeTeam.id)}
                className="min-w-0 w-full text-right transition hover:opacity-90"
              >
                <ScoreBlock
                  team={homeTeam}
                  sub={`${recordOf(league, homeTeam.id).wins}–${recordOf(league, homeTeam.id).losses}`}
                  size="md"
                  align="right"
                />
                <span className="mt-1.5 block truncate font-display text-lg font-700 uppercase leading-none text-ink">
                  {homeTeam.name}
                </span>
              </button>
            </TeamHoverCard>
          </div>

          <div className="grid grid-cols-2 gap-2 border-t border-line px-3 py-3 sm:gap-4 sm:px-4">
            <RatingColumn label="You" r={myRatings} ranks={rates[team.id]?.ranks} />
            <RatingColumn label={opp.name} r={oppRatings} ranks={rates[opp.id]?.ranks} right />
          </div>

          <div className="space-y-2.5 border-t border-line bg-surface-2 px-4 py-3">
            <MatchupLine text="Your offense" mine={myRatings.off} other="their defense" theirs={oppRatings.def} />
            <MatchupLine text="Your defense" mine={myRatings.def} other="their offense" theirs={oppRatings.off} />
          </div>

          <RateColumns mine={rates[team.id]} theirs={rates[opp.id]} myLabel="You" theirLabel={opp.name} />

          {/* L12.8 V2/V3: their best players (hover for ratings) and a scout visit. */}
          <div className="space-y-2 border-t border-line px-4 py-3">
            <TopPlayers teamId={opp.id} side="off" n={5} label="Their offense" />
            <TopPlayers teamId={opp.id} side="def" n={5} label="Their defense" />
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button size="sm" variant="ghost" onClick={() => viewTeam(opp.id)}>
                View team <ChevronRight size={14} aria-hidden />
              </Button>
              <ScoutButton teamId={opp.id} />
            </div>
          </div>

          <div className="border-t border-line px-4 py-2.5 text-small text-muted">
            Opponent runs <strong className="text-ink">{opponentScheme}</strong>
            {side === 'off' ? ' defense' : ' offense'} — plan accordingly.
            {oppTend && (
              <div className="mt-0.5">
                Coach {oppTend.fourth === 'aggressive' ? 'attacks on 4th' : oppTend.fourth === 'conservative' ? 'plays it safe on 4th' : 'is by the book on 4th'} ·{' '}
                <strong className="text-ink-2">{oppTend.passRate >= 0.58 ? 'pass-heavy' : oppTend.passRate <= 0.5 ? 'run-leaning' : 'balanced'}</strong> ·{' '}
                {oppTend.tempo >= 0.25 ? 'up-tempo' : oppTend.tempo <= -0.15 ? 'deliberate' : 'normal tempo'}
              </div>
            )}
            {oppSt && <div className="mt-0.5">Special teams: <strong className="text-ink-2">{oppSt}</strong></div>}
          </div>
        </Card>
      )}

      {/* ── This week: the orders the side switch edits. ──────────────────────── */}
      <section className="mt-6">
        <SectionTitle
          right={
            <span className="hidden text-small text-muted sm:block">
              Side switch edits the plan, personnel &amp; scheme fit
            </span>
          }
        >
          This week
        </SectionTitle>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Card className="lg:col-span-2">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <ClipboardList size={16} className="text-muted" aria-hidden />
              <h3 className="font-display text-lg font-700 uppercase tracking-wide">
                {side === 'off' ? 'Offensive plan' : 'Defensive plan'}
              </h3>
              {scheme ? (
                <SchemeChip scheme={scheme} state="live" />
              ) : (
                <span className="text-small text-warn">No coordinator · no live scheme</span>
              )}
              <Badge tone="neutral" className="ml-auto">{side === 'off' ? 'Offense' : 'Defense'}</Badge>
            </div>
            <PlanEditor plan={plan} onChange={(p) => setDefaultPlan(side, p)} side={side} disabled={readOnly} />
          </Card>

          {capabilities(career).planScope !== 'none' && (
            <PersonnelCard
              side={side}
              value={side === 'off' ? career.personnel?.off : career.personnel?.def}
              onChange={(v) => setPersonnel({ ...career.personnel, [side]: v })}
              teamId={team.id}
              oppId={opp?.id}
              oppScheme={opponentScheme}
              disabled={readOnly}
            />
          )}

          <SchemeFitReport teamId={team.id} side={side} />
          <KeysCard oppId={opp?.id} disabled={readOnly} />
          <PracticeCard disabled={readOnly} />
          <InstallCard disabled={readOnly} />
          {canWrinkle(career) && <WrinkleCard disabled={readOnly} />}
          <ScriptCard disabled={readOnly} />
        </div>
      </section>

      {/* ── Situational: the calls made in the moment. ───────────────────────── */}
      <section className="mt-6">
        <SectionTitle>Situational</SectionTitle>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <CallSheetCard disabled={readOnly} />
          <MatchupCard disabled={readOnly} />
          <UsageCard disabled={readOnly} />
          <SpecialTeamsCard disabled={readOnly} />
        </div>
      </section>

      {/* ── Review: what you know about them, and about yourself. ────────────── */}
      <section className="mt-6">
        <SectionTitle>Review</SectionTitle>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <StudyOpponentCard oppId={opp?.id} />
          <SelfScoutCard />
          <AnalyticsCard oppId={opp?.id} home={!!next?.home} />
          <CoordinatorAdviceCard oppId={opp?.id} />
          <CulturePanel teamId={team.id} className="lg:col-span-2" />
        </div>
      </section>

      <Card className="mt-5">
        <div className="flex items-start gap-2 text-small leading-relaxed text-muted">
          <Repeat size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Plans are saved and reused every week. When a game kicks off, “Coach the game”
            pauses at the big moments so you can make the call — otherwise fast sim answers
            them with these standing orders.
          </span>
        </div>
      </Card>
    </div>
  )
}

/** L12.9 H1: opponent film moved here from the removed weekly hours card. */
function StudyOpponentCard({ oppId }: { oppId?: string }) {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const studyOpponent = useGame((s) => s.studyOpponent)
  if (!capabilities(career).can.has('callPlays') || !oppId) return null
  const opp = league.byId[oppId]
  const read = career.oppRead && career.oppRead.week === league.week && career.oppRead.oppId === oppId ? career.oppRead : null
  const sharp = !!read?.sharp
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <Search size={16} className="text-muted" aria-hidden />
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">Opponent Film</h3>
        {read && <Badge tone={sharp ? 'win' : 'info'} className="ml-auto">{sharp ? 'Sharp read' : 'Fuzzy read'}</Badge>}
      </div>
      <p className="mb-3 text-small text-muted">
        {sharp
          ? `You have a sharp read on the ${opp.name} — their tendencies are clear this week.`
          : read
            ? `You have a fuzzy read on the ${opp.name}. Study again to sharpen it.`
            : `Study the ${opp.name} to learn their tendencies before kickoff.`}
      </p>
      <Button size="sm" variant={sharp ? 'secondary' : 'primary'} disabled={sharp} onClick={studyOpponent}>
        {read ? `Sharpen the read on the ${opp.abbr}` : `Study ${opp.name}`}
      </Button>
    </Card>
  )
}

/** L11.5 Q5: the coordinators read the matchup and suggest a plan you can apply. */
function CoordinatorAdviceCard({ oppId }: { oppId?: string }) {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const defaultPlan = useGame((s) => s.defaultPlan)
  const setDefaultPlan = useGame((s) => s.setDefaultPlan)
  const advice = oppId ? coordinatorAdvice(league, career, oppId) : []
  const tone: Record<string, 'win' | 'info' | 'warn'> = { high: 'win', medium: 'info', low: 'warn' }
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <ClipboardList size={16} className="text-muted" aria-hidden />
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">Coordinator Notes</h3>
      </div>
      {!advice.length ? (
        <p className="text-small text-muted">No upcoming opponent to scout.</p>
      ) : (
        <div className="space-y-3 text-small">
          {advice.map((a) => {
            const preset = PLAN_PRESETS.find((p) => p.id === a.presetId && p.side === a.side)
            if (!preset) return null
            const applied = JSON.stringify(defaultPlan[a.side]) === JSON.stringify(preset.plan)
            return (
              <div key={a.side} className="rounded-[var(--r-md)] bg-surface-2 p-3">
                <div className="flex items-center gap-2">
                  <span className="label">{a.coach} · {a.side === 'off' ? 'OC' : 'DC'}</span>
                  <Badge tone={tone[a.confidence]} className="ml-auto">{a.confidence}</Badge>
                </div>
                <div className="mt-1 text-ink-2">
                  <strong className="text-ink">{preset.label}</strong> — {a.reason}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant={applied ? 'secondary' : 'primary'}
                    disabled={applied}
                    onClick={() => setDefaultPlan(a.side, { ...preset.plan })}
                  >
                    {applied ? 'Applied' : 'Apply'}
                  </Button>
                  <span className="text-micro text-muted">
                    Current: {describePlan(defaultPlan[a.side], a.side)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

const FOURTH_HINT: Record<FourthStyle, string> = {
  conservative: 'Goes for it only on 4th & 1 past midfield.',
  standard: 'Takes the best expected value — goes for it on 4th & short.',
  aggressive: 'Goes for it on 4th & 6 or less when the numbers are close.',
}

function CallSheetCard({ disabled = false }: { disabled?: boolean }) {
  const career = useGame((s) => s.career)!
  const setCallSheet = useGame((s) => s.setCallSheet)
  const scope = capabilities(career).planScope
  if (scope === 'none') return null
  const sheet: CallSheet = career.callSheet ?? DEFAULT_CALL_SHEET
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <ClipboardList size={16} className="text-muted" aria-hidden />
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">Call Sheet</h3>
      </div>
      {scope === 'own-side' ? (
        <p className="text-small text-muted">4th downs and 2-point tries belong to the head coach.</p>
      ) : (
        <div className="space-y-3">
          <CallSheetRow
            label="4th down"
            value={sheet.fourth}
            disabled={disabled}
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
            disabled={disabled}
            onChange={(twoPoint) => setCallSheet({ ...sheet, twoPoint })}
            options={[
              { id: 'chart', label: 'Chart', hint: 'Follow the chart by score and quarter.' },
              { id: 'kick', label: 'Always kick', hint: 'Always take the extra point.' },
            ]}
          />
          <CallSheetRow
            label="Timeouts"
            value={sheet.timeouts}
            disabled={disabled}
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
  disabled = false,
}: {
  label: string
  value: T
  options: { id: T; label: string; hint: string }[]
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div>
      <div className="label mb-1.5">{label}</div>
      <OptionGroup label={label} className="sm:grid-cols-2">
        {options.map((o) => (
          <OptionCard
            key={o.id}
            selected={value === o.id}
            disabled={disabled}
            onSelect={() => onChange(o.id)}
            title={o.label}
            description={o.hint}
          />
        ))}
      </OptionGroup>
    </div>
  )
}

/** FUTURES #4: kickoff/punt strategy and kick/punt-return strategy, with hints. */
function SpecialTeamsCard({ disabled = false }: { disabled?: boolean }) {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const setSpecialTeams = useGame((s) => s.setSpecialTeams)
  const scope = capabilities(career).planScope
  if (scope === 'none') return null
  const st = career.specialTeams ?? DEFAULT_ST
  const own = league.stMemory?.season === league.season ? league.stMemory.teams[career.teamId] : undefined
  const readable = stRecordText(own)
  const predictable = alertness(own) >= 0.34
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <ClipboardList size={16} className="text-muted" aria-hidden />
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">Special Teams</h3>
        {predictable && <Badge tone="warn" className="ml-auto">Predictable</Badge>}
      </div>
      <div className="space-y-3">
        <CallSheetRow
          label="Kickoff"
          value={st.kickoff}
          disabled={disabled}
          onChange={(kickoff) => setSpecialTeams({ ...st, kickoff })}
          options={[
            { id: 'default', label: 'Touchback', hint: 'Kick it deep — the safe, default call.' },
            { id: 'directional', label: 'Directional', hint: 'Pooch it: fewer touchbacks, shorter returns.' },
          ]}
        />
        <CallSheetRow
          label="Punt"
          value={st.punt}
          disabled={disabled}
          onChange={(punt) => setSpecialTeams({ ...st, punt })}
          options={[
            { id: 'default', label: 'Default', hint: 'A normal punt.' },
            { id: 'directional', label: 'Directional', hint: 'Aim it: fewer returns, slightly shorter net.' },
          ]}
        />
        <CallSheetRow
          label="Kick returns"
          value={st.kr}
          disabled={disabled}
          onChange={(kr) => setSpecialTeams({ ...st, kr })}
          options={[
            { id: 'safe', label: 'Take touchbacks', hint: 'Kneel / fair catch: fewer returns, fewer fumbles.' },
            { id: 'default', label: 'Default', hint: 'Return it when it is worth it.' },
            { id: 'aggressive', label: 'Aggressive', hint: 'Bring it out: longer returns, more variance and fumbles.' },
          ]}
        />
        <CallSheetRow
          label="Punt returns"
          value={st.pr}
          disabled={disabled}
          onChange={(pr) => setSpecialTeams({ ...st, pr })}
          options={[
            { id: 'safe', label: 'Fair catch', hint: 'Take the fair catch: fewer chances to muff it.' },
            { id: 'default', label: 'Default', hint: 'Return it when it is worth it.' },
            { id: 'aggressive', label: 'Aggressive', hint: 'Field every punt: longer returns, more fumbles.' },
          ]}
        />
      </div>
      <p className="mt-3 text-small leading-snug text-muted">
        {readable
          ? <>Opponents have scouted you: <strong className="text-ink-2">{readable}</strong> — switch it up.</>
          : 'AI clubs play the default. Fakes and onsides you show are remembered — and scouted.'}
      </p>
    </Card>
  )
}

function RatingColumn({
  label,
  r,
  ranks,
  right,
}: {
  label: string
  r: { off: number; def: number; overall: number }
  ranks?: TeamRateEntry['ranks']
  right?: boolean
}) {
  return (
    <div className={cn('min-w-0', right && 'text-right')}>
      <div className="label mb-1.5 truncate">{label}</div>
      <div className={cn('flex flex-wrap items-start gap-x-2 gap-y-1 sm:gap-x-4', right && 'justify-end')}>
        {(['off', 'def', 'overall'] as const).map((k) => {
          const rank = ranks?.[k === 'overall' ? 'ovr' : k] ?? 0
          return (
            <div key={k} className="min-w-0">
              <div className="font-display text-small font-700 leading-none tnum text-ink sm:text-base">
                {r[k].toFixed(1)}
                {rank > 0 && <span className={cn('ml-0.5 font-cond text-micro sm:ml-1', rankColor(rank))}>#{rank}</span>}
              </div>
              <div className="label mt-0.5 leading-none">{k === 'overall' ? 'OVR' : k.toUpperCase()}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 1 = best; green near the top of the league, red near the bottom. */
function rankColor(rank: number): string {
  if (rank <= 5) return 'text-win'
  if (rank >= 28) return 'text-loss'
  return 'text-muted'
}

/** L12.17: per-game offense and defense for both clubs, with league ranks. */
function RateColumns({ mine, theirs, myLabel, theirLabel }: {
  mine?: TeamRateEntry
  theirs?: TeamRateEntry
  myLabel: string
  theirLabel: string
}) {
  if (!mine && !theirs) return null
  return (
    <div className="grid grid-cols-2 gap-3 border-t border-line px-3 py-3 sm:gap-4 sm:px-4">
      <RateList label={myLabel} rate={mine} />
      <RateList label={theirLabel} rate={theirs} right />
    </div>
  )
}

function RateList({ label, rate, right }: { label: string; rate?: TeamRateEntry; right?: boolean }) {
  const row = (l: string, v: number | null, rank: number, title: string) => (
    <div key={l} title={title} className="flex items-baseline justify-between gap-2 text-small">
      <span className="truncate text-muted">{l}</span>
      <span className="shrink-0 font-600 tnum text-ink-2">
        {v == null ? '—' : v.toFixed(1)}
        {v != null && rank > 0 && <span className={cn('ml-1 font-cond text-micro', rankColor(rank))}>#{rank}</span>}
      </span>
    </div>
  )
  return (
    <div className={cn('min-w-0', right && 'text-right')}>
      <div className="label mb-1 truncate">{label}</div>
      {rate ? (
        <div className="space-y-0.5">
          <div className="label text-faint">Offense</div>
          {row('Points/G', rate.pf, rate.ranks.pf, 'Points scored per game')}
          {row('Pass yds/G', rate.passYds, rate.ranks.passYds, 'Passing yards per game')}
          {row('Rush yds/G', rate.rushYds, rate.ranks.rushYds, 'Rushing yards per game')}
          <div className="label mt-1 text-faint">Defense</div>
          {row('Pts allowed/G', rate.pa, rate.ranks.pa, 'Points allowed per game')}
          {row('Pass allowed/G', rate.passYdsAllowed, rate.ranks.passYdsAllowed, 'Pass yards allowed per game')}
          {row('Rush allowed/G', rate.rushYdsAllowed, rate.ranks.rushYdsAllowed, 'Rush yards allowed per game')}
        </div>
      ) : (
        <div className="text-small text-muted">—</div>
      )}
    </div>
  )
}

/**
 * A unit-vs-unit edge as a divergent bar: grey neutral band around zero, the
 * magnitude (Delta) and a chip. Inside the band reads "Even" — no win/loss.
 */
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
  const edge = mine - theirs
  const BAND = 2
  const SPAN = 12
  const neutral = Math.abs(edge) < BAND
  const tone = neutral ? 'neutral' : edge > 0 ? 'win' : 'loss'
  const pct = Math.min(50, (Math.abs(edge) / SPAN) * 50)
  const bandPct = (BAND / SPAN) * 50
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="text-small text-ink-2">
          {text} <span className="text-muted">vs {other}</span>
        </span>
        <span className="flex items-center gap-2">
          <Delta value={edge} digits={1} />
          <VerdictChip tone={tone}>{neutral ? 'Even' : edge > 0 ? 'Edge' : 'Trailing'}</VerdictChip>
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="w-9 shrink-0 text-micro tnum text-muted">{mine.toFixed(1)}</span>
        <span
          className="relative block h-2 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-surface-3"
          role="img"
          aria-label={`${text} ${mine.toFixed(1)} vs ${other} ${theirs.toFixed(1)}, ${signed(edge, 1)}`}
        >
          <span
            aria-hidden
            className="absolute inset-y-0 bg-line-strong/35"
            style={{ left: `${50 - bandPct}%`, width: `${bandPct * 2}%` }}
          />
          {!neutral && (
            <span
              aria-hidden
              className="absolute inset-y-0 rounded-[3px]"
              style={{
                left: edge > 0 ? '50%' : `${50 - pct}%`,
                width: `${pct}%`,
                background: edge > 0 ? 'var(--color-win)' : 'var(--color-loss)',
              }}
            />
          )}
        </span>
        <span className="w-9 shrink-0 text-right text-micro tnum text-muted">{theirs.toFixed(1)}</span>
      </div>
    </div>
  )
}

/** L10 G10: order the first offensive snaps from the scheme's concepts. */
function ScriptCard({ disabled = false }: { disabled?: boolean }) {
  const career = useGame((s) => s.career)!
  const setScript = useGame((s) => s.setScript)
  const scope = capabilities(career).planScope
  const [formation, setFormation] = useState(FORMATIONS[0]?.name ?? 'Gun Trips')
  // The script is an offense-side tool.
  if (scope === 'none' || career.unitFocus === 'def') return null
  const script = career.script ?? []
  const add = (name: string) => {
    if (script.length >= 8 || script.includes(name)) return
    setScript([...script, name])
  }
  const remove = (i: number) => setScript(script.filter((_, j) => j !== i))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= script.length) return
    const next = [...script]
    const tmp = next[i]
    next[i] = next[j]
    next[j] = tmp
    setScript(next)
  }
  const plays = PLAYBOOK.filter((p) => p.formation === formation)
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <ClipboardList size={16} className="text-muted" aria-hidden />
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">Opening Script</h3>
        <Badge tone="neutral" className="ml-auto">{script.length}/8</Badge>
      </div>
      {script.length === 0 ? (
        <p className="mb-3 text-small text-muted">
          Pick the first calls of the game. Scripted snaps get a small execution edge on your opening drive —
          but a script that repeats itself gets read.
        </p>
      ) : (
        <ol className="mb-3 space-y-1.5">
          {script.map((name, i) => (
            <li key={`${name}-${i}`} className="flex items-center gap-2 rounded-[var(--r-md)] bg-surface-2 px-2 py-1.5">
              <span className="font-cond text-label font-700 text-muted">{i + 1}</span>
              <span className="text-small text-ink-2">{name}</span>
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={disabled || i === 0}
                  className="rounded-[var(--r-sm)] p-1 text-muted hover:text-ink disabled:opacity-30 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                  aria-label="Move up"
                >
                  <ArrowUp size={12} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={disabled || i === script.length - 1}
                  className="rounded-[var(--r-sm)] p-1 text-muted hover:text-ink disabled:opacity-30 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                  aria-label="Move down"
                >
                  <ArrowDown size={12} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  disabled={disabled}
                  className="rounded-[var(--r-sm)] p-1 text-muted hover:text-loss disabled:opacity-30 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                  aria-label="Remove"
                >
                  <X size={12} aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="label mb-1.5">Formation</div>
      <div className="mb-2 flex flex-wrap gap-1">
        {FORMATIONS.map((f) => (
          <button
            key={f.name}
            type="button"
            disabled={disabled}
            aria-pressed={formation === f.name}
            onClick={() => setFormation(f.name)}
            className={cn(
              'motion min-h-11 rounded-full border px-2.5 py-1 font-cond lg:min-h-0 text-label font-700 uppercase tracking-wide disabled:opacity-45',
              formation === f.name
                ? 'border-line-strong bg-surface-3 text-ink'
                : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
            )}
          >
            {f.name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {plays.map((p) => {
          const used = script.includes(p.name)
          const full = script.length >= 8
          return (
            <button
              key={p.name}
              type="button"
              disabled={disabled || used || full}
              onClick={() => add(p.name)}
              title={p.description}
              className={cn(
                'flex flex-col gap-1 rounded-[var(--r-md)] border p-1.5 text-left transition',
                used || full ? 'border-line bg-surface-2 opacity-55' : 'border-line bg-surface hover:border-line-strong',
              )}
            >
              <RouteDiagram name={p.name} className="h-14 w-full rounded-[var(--r-sm)]" />
              <span className="flex items-center gap-1">
                <span className="font-cond text-label font-700 uppercase text-ink">{p.name}</span>
                <span className="ml-auto font-cond text-micro uppercase text-muted">{p.type}</span>
              </span>
            </button>
          )
        })}
      </div>
    </Card>
  )
}

/** L10 G11: pre-game matchup assignments, limited to the side(s) you control. */
function MatchupCard({ disabled = false }: { disabled?: boolean }) {
  const career = useGame((s) => s.career)!
  const setMatchups = useGame((s) => s.setMatchups)
  const scope = capabilities(career).planScope
  if (scope === 'none') return null
  const focus = career.unitFocus ?? 'both'
  const hasOff = scope === 'both' || focus !== 'def'
  const hasDef = scope === 'both' || focus !== 'off'
  const m = career.matchups ?? {}
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <ClipboardList size={16} className="text-muted" aria-hidden />
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">Matchups</h3>
      </div>
      <div className="space-y-3">
        {hasOff && (
          <CallSheetRow
            label="Offense"
            value={m.off ?? 'none'}
            disabled={disabled}
            onChange={(off) => setMatchups({ ...m, off: off === 'none' ? undefined : off })}
            options={[
              { id: 'none', label: 'None', hint: 'No special assignment.' },
              { id: 'doubleRusher', label: 'Double the rusher', hint: 'Chip their best edge — he rushes at half speed. Costs a target (top 3 receivers).' },
              { id: 'targetWeakCB', label: 'Target the weak CB', hint: 'On 35% of throws key their weakest corner — but safety help raises interception risk.' },
            ]}
          />
        )}
        {hasDef && (
          <CallSheetRow
            label="Defense"
            value={m.def ?? 'none'}
            disabled={disabled}
            onChange={(def) => setMatchups({ ...m, def: def === 'none' ? undefined : def })}
            options={[
              { id: 'none', label: 'None', hint: 'No special assignment.' },
              { id: 'shadowWR1', label: 'Shadow their WR1', hint: 'Your CB1 trails their top receiver; helps over the top on everyone else.' },
              { id: 'spyQB', label: 'Spy the QB', hint: 'Contains scrambles and QB runs, but one fewer rusher (−4 pressure).' },
            ]}
          />
        )}
      </div>
    </Card>
  )
}

/** L10 G12: RB workload and defensive-line rotation, limited to your side(s). */
function UsageCard({ disabled = false }: { disabled?: boolean }) {
  const career = useGame((s) => s.career)!
  const setUsage = useGame((s) => s.setUsage)
  const scope = capabilities(career).planScope
  if (scope === 'none') return null
  const focus = career.unitFocus ?? 'both'
  const hasOff = scope === 'both' || focus !== 'def'
  const hasDef = scope === 'both' || focus !== 'off'
  const u = career.usage ?? { rb: 'normal' as const, dl: 'starters' as const }
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <ClipboardList size={16} className="text-muted" aria-hidden />
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">Workload</h3>
      </div>
      <div className="space-y-3">
        {hasOff && (
          <CallSheetRow
            label="Running backs"
            value={u.rb}
            disabled={disabled}
            onChange={(rb) => setUsage({ ...u, rb })}
            options={[
              { id: 'normal', label: 'Normal', hint: 'RB2 gets 20% of the carries. Modest injury risk (2.5%).' },
              { id: 'feature', label: 'Feature back', hint: 'RB1 takes every carry (run edge +1); higher injury risk (6%).' },
              { id: 'committee', label: 'Committee', hint: 'RB2 gets 40% of the carries (run edge −0.5); lowest injury risk (1%).' },
            ]}
          />
        )}
        {hasDef && (
          <CallSheetRow
            label="Defensive line"
            value={u.dl}
            disabled={disabled}
            onChange={(dl) => setUsage({ ...u, dl })}
            options={[
              { id: 'starters', label: 'Starters', hint: 'Full pressure early; −3 pressure in the 4th (fatigue).' },
              { id: 'rotate', label: 'Rotate', hint: 'Fresh legs: −1.5 pressure early, +1.5 in the 4th.' },
            ]}
          />
        )}
      </div>
    </Card>
  )
}

/** L10 G8: your own habits, bucket by bucket — flagged when you get predictable. */
function SelfScoutCard() {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  if (capabilities(career).planScope === 'none') return null
  const book = league.userBook && league.userBook.season === league.season ? league.userBook.book : null
  const rows = BUCKETS.map((b) => ({
    b,
    off: book ? topKey(book.off[b], OFF_CLASSES) : null,
    def: book ? topKey(book.def[b], DEF_CALLS) : null,
  })).filter((r) => (r.off?.total ?? 0) + (r.def?.total ?? 0) > 0)
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <ClipboardList size={16} className="text-muted" aria-hidden />
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">Self-Scout</h3>
      </div>
      {!book || !rows.length ? (
        <p className="text-small text-muted">Play a game and your tendencies show up here — so do your opponents&rsquo;.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map(({ b, off, def }) => (
            <div key={b} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line/60 pb-1.5 last:border-0 last:pb-0">
              <span className="w-20 shrink-0 font-cond text-label font-700 uppercase tracking-wide text-muted">{BUCKET_LABEL[b]}</span>
              <span className="text-small text-ink-2">
                Off <strong className="text-ink">{off && off.total ? OFF_CLASS_LABEL[off.key] : '—'}</strong>
                {off && off.total >= 8 && <span className="text-muted"> {Math.round(off.share * 100)}%</span>}
              </span>
              <span className="text-small text-ink-2">
                Def <strong className="text-ink">{def && def.total ? DEF_CALL_LABEL[def.key] : '—'}</strong>
                {def && def.total >= 8 && <span className="text-muted"> {Math.round(def.share * 100)}%</span>}
              </span>
              <div className="ml-auto flex gap-1">
                {off && off.total >= 8 && off.share >= 0.7 && <Badge tone="warn">Predictable</Badge>}
                {def && def.total >= 8 && def.share >= 0.7 && <Badge tone="warn">Predictable</Badge>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

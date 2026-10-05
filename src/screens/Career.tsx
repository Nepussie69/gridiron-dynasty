import { ArrowUp, Briefcase, CheckCircle2, Circle, Copy, Repeat2, Star, Target, TrendingUp } from 'lucide-react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
import {
  isGM,
  ladderFor,
  masteryCarryOver,
  overallRep,
  progressToNext,
  roleMastery as getRoleMastery,
  roleObjectives,
  salaryFor,
  tierFor,
  unitRanks,
  VERB_BLURB,
  type Reputation,
} from '../game/engine/career'
import { ALL_CAPABILITIES, capabilities } from '../game/engine/capabilities'
import { ghostVerdict } from '../game/engine/ghost'
const CAP_LABELS: Record<string, string> = {
  grade: 'Grade prospects',
  rankBoard: 'Rank the board',
  crossCheck: 'Cross-check reports',
  assignScouts: 'Assign scouts',
  setBoard: 'Set the final board',
  proScout: 'Pro scouting',
  negotiate: 'Negotiate contracts',
  manageCap: 'Manage the cap',
  draft: 'Make draft picks',
  signFreeAgents: 'Sign free agents',
  developRoom: 'Develop a room',
  callPlays: 'Call plays',
  installScheme: 'Install scheme',
  hireStaff: 'Hire staff',
  gameManagement: 'Game management',
  setExpectations: 'Own expectations',
}
import { recordOf, recordStr } from '../game/selectors'
import { formatSeed } from '../game/engine/seed'
import { scenarioById } from '../game/engine/scenarios'
import { useGame, useWorld } from '../store/gameStore'
import { CareerRhythm } from '../components/CareerRhythm'
import { CareerPeople } from '../components/CareerPeople'
import { WeeklyChecklist } from '../components/WeeklyChecklist'
import { AmbitionsCard } from '../components/AmbitionsCard'
import { LegacyCard } from '../components/LegacyCard'
import { VoicesCard } from '../components/VoicesCard'
import { Badge, Button, Card, PageHeader, RatingBar, TeamCrest } from '../ui/kit'

const REP_LABELS: { key: keyof Reputation; label: string; desc: string }[] = [
  { key: 'evaluation', label: 'Evaluation', desc: 'Scouting eye and talent ID' },
  { key: 'roster', label: 'Roster Building', desc: 'Draft, cap, and free agency' },
  { key: 'leadership', label: 'Leadership', desc: 'Staff, culture, development' },
  { key: 'results', label: 'Results', desc: 'Wins, playoffs, titles' },
  { key: 'profile', label: 'Profile', desc: 'Connections and pedigree' },
]

export function Career() {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const offers = useGame((s) => s.offers)
  const acceptOffer = useGame((s) => s.acceptOffer)
  const declineOffers = useGame((s) => s.declineOffers)
  const setScreen = useGame((s) => s.setScreen)
  const showToast = useGame((s) => s.showToast)

  function copySeed() {
    try {
      void navigator.clipboard?.writeText(formatSeed(league.seed))?.catch(() => {})
    } catch {
      // clipboard unavailable in this context
    }
    showToast('Seed copied')
  }

  const team = league.byId[career.teamId]
  const ladder = ladderFor(career.path)
  const current = tierFor(career.path, career.level)
  const next = ladder[career.level + 1]
  const rec = recordOf(league, career.teamId)
  const overall = overallRep(career.reputation)
  const hitRate = career.hits + career.misses ? Math.round((career.hits / (career.hits + career.misses)) * 100) : 0
  const prog = progressToNext(career.reputation, career.path, career.level)
  const caps = capabilities(career)
  const thisMastery = getRoleMastery(career)
  const objectives = roleObjectives(
    league,
    career,
    { wins: rec.wins, losses: rec.losses },
    unitRanks(league, 'NFL')[career.teamId],
  )

  return (
    <div>
      <PageHeader
        eyebrow={`${career.path === 'coach' ? 'Coaching' : 'Personnel'} Track · Season ${league.season} · Week ${league.week}`}
        title="My Career"
        subtitle={current.blurb}
        right={
          <div className="flex items-center gap-2">
            {career.scenario && career.scenario !== 'climb' && (
              <Badge tone="gold">{scenarioById(career.scenario).title}</Badge>
            )}
            <div className="flex rounded-lg bg-surface-2 p-0.5">
              <Badge tone="team">
                {isGM(career) ? 'General Manager' : `${current.title}`}
              </Badge>
            </div>
          </div>
        }
      />

      {/* Identity strip */}
      <Card pad={false} className="mb-5 overflow-hidden">
        <div
          className="flex flex-wrap items-center gap-4 p-5"
          style={{ background: `linear-gradient(115deg, ${team.primary}, ${team.secondary})` }}
        >
          <TeamCrest team={team} size={56} />
          <div className="min-w-0">
            <div className="label !text-white/70">{career.gmName}</div>
            <div className="font-display text-3xl font-700 uppercase leading-none text-white">{current.title}</div>
            <div className="font-cond text-sm text-white/80">
              {team.tier === 'NFL' ? `${team.city} ${team.name}` : team.name} · {team.conference}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <HeadStat label="Overall Rep" value={overall} />
            <HeadStat label="Salary" value={money(career.salary)} />
            <HeadStat label="Record" value={recordStr(rec)} />
            <HeadStat label="Hit Rate" value={`${hitRate}%`} />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/15 px-5 pb-4 pt-3">
          <div>
            <span className="font-cond text-[11px] font-700 uppercase tracking-wide text-white/70">
              This rung&apos;s verb
            </span>
            <div className="font-display text-sm font-700 uppercase tracking-wide text-white">
              {VERB_BLURB[current.verb]}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-cond text-[11px] font-700 uppercase tracking-wide text-white/70">
              World seed {formatSeed(league.seed)}
            </span>
            <button
              type="button"
              onClick={copySeed}
              className="inline-flex items-center gap-1 rounded-md border border-white/25 px-2 py-1 font-cond text-[10px] font-700 uppercase tracking-wide text-white/90 transition hover:bg-white/10"
            >
              <Copy size={12} /> Copy
            </button>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          <WeeklyChecklist />
          <CareerRhythm />
          {/* The ladder */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-lg font-700 uppercase tracking-wide">
                {career.path === 'coach' ? 'Coaching Ladder' : 'Personnel Ladder'}
              </h3>
              <Badge tone="team">Level {career.level + 1} of {ladder.length}</Badge>
            </div>
            <div className="space-y-1">
              {ladder.map((rung) => {
                const done = rung.level < career.level
                const active = rung.level === career.level
                return (
                  <div
                    key={rung.level}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border px-3 py-2',
                      active ? 'border-transparent bg-[var(--team-soft)]' : done ? 'border-line opacity-70' : 'border-line',
                    )}
                  >
                    {done ? (
                      <CheckCircle2 size={18} className="text-win" />
                    ) : active ? (
                      <Star size={18} style={{ color: 'var(--team)' }} />
                    ) : (
                      <Circle size={18} className="text-faint" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className={cn('font-cond text-sm font-700 uppercase', active ? 'text-ink' : 'text-ink-2')}>
                        {rung.title}
                      </div>
                      <div className="text-xs text-muted">{rung.blurb}</div>
                    </div>
                    <div className="hidden text-right sm:block">
                      <div className="label !text-[9px]">Requires</div>
                      <div className="font-cond text-[11px] text-muted">
                        {Object.entries(rung.gate).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>

          {/* History */}
          <Card>
            <h3 className="mb-3 font-display text-lg font-700 uppercase tracking-wide">Career History</h3>
            {career.history.length === 0 ? (
              <p className="py-4 text-sm text-muted">
                No seasons on record yet. Do your job, build your reputation, and the offers will come.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left">
                      {['Season', 'Role', 'Team', 'Record', 'Outcome'].map((h) => (
                        <th key={h} className="label px-2 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...career.history].reverse().map((h, i) => (
                      <tr key={i} className="border-b border-line/60">
                        <td className="px-2 py-1.5 font-cond font-700 text-ink">{h.season}</td>
                        <td className="px-2 py-1.5 text-ink-2">{h.role}</td>
                        <td className="px-2 py-1.5 text-ink-2">{league.byId[h.team]?.name ?? h.team}</td>
                        <td className="px-2 py-1.5 font-cond tnum text-ink-2">{h.record}</td>
                        <td className="px-2 py-1.5 text-muted">{h.outcome}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Right rail */}
        <div className="space-y-5">
          <CareerPeople />
          <AmbitionsCard />
          <GhostCard />
          <LegacyCard />
          <VoicesCard />
          {/* Your role: what this job can actually do */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-lg font-700 uppercase tracking-wide">Your Role</h3>
              <Badge tone="team">{current.title}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {ALL_CAPABILITIES.map((cap) => {
                const has = caps.can.has(cap)
                return (
                  <div key={cap} className={cn('flex items-center gap-1.5 text-xs', has ? 'text-ink' : 'text-faint')}>
                    {has ? <CheckCircle2 size={13} className="shrink-0 text-win" /> : <Circle size={13} className="shrink-0" />}
                    <span className="capitalize">{CAP_LABELS[cap] ?? cap}</span>
                  </div>
                )
              })}
            </div>
            {caps.prospectScope !== undefined && (
              <p className="mt-3 rounded-lg bg-surface-2 p-2.5 text-[11px] text-muted">
                Scope: you track <strong className="text-ink">{caps.prospectScope} prospects</strong> — climbing widens your view.
              </p>
            )}
            {caps.planScope !== 'none' && (
              <p className="mt-2 rounded-lg bg-surface-2 p-2.5 text-[11px] text-muted">
                Game plan control: <strong className="text-ink">{caps.planScope === 'both' ? 'both sides' : 'your side of the ball'}</strong>.
              </p>
            )}
          </Card>

          {/* How well you're doing THIS job — feeds the next one */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-lg font-700 uppercase tracking-wide">Role Mastery</h3>
              <span className="font-display text-xl font-700 tnum text-ink">{thisMastery}</span>
            </div>
            <RatingBar value={thisMastery} color={thisMastery >= 70 ? '#05914f' : thisMastery >= 45 ? 'var(--team)' : '#d98207'} height={8} />
            <p className="mt-2 text-[11px] text-muted">
              {thisMastery >= 75
                ? 'Thriving in this role. Excellence here gives you a head start at the next level.'
                : thisMastery >= 50
                  ? 'Solid. Meet your objectives to build a stronger résumé for the next job.'
                  : 'Struggling in this role. Your next step will be harder.'}
            </p>
            {next && (
              <div className="mt-3 rounded-lg bg-surface-2 p-2.5 text-[11px] text-muted">
                Prior-role carry-over: <strong className="text-ink">
                  +{Math.max(0, Math.round((masteryCarryOver(career).profile ?? 0)))} profile
                </strong> toward becoming {next.title}.
              </div>
            )}
          </Card>

          {/* Next step */}
          <Card>
            <h3 className="mb-3 font-display text-lg font-700 uppercase tracking-wide">Next Step</h3>
            {next ? (
              <>
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-cond text-sm font-700 uppercase text-ink">{next.title}</span>
                  <span className="font-cond text-xs text-muted">{next.tier}</span>
                </div>
                <RatingBar value={prog.pct * 100} color={prog.pct >= 1 ? '#05914f' : 'var(--team)'} height={10} />
                <div className="mt-2 text-xs text-muted">
                  {prog.pct >= 1 ? 'Qualified — offers arrive in the offseason.' : `Needs: ${prog.missing.join(' · ')}`}
                </div>
                <p className="mt-3 rounded-lg bg-surface-2 p-3 text-xs leading-relaxed text-muted">
                  {prog.pct >= 1
                    ? 'You have earned a look at the next level.'
                    : 'Win games, grade prospects accurately, and build your profile. Exceptional work earns offers faster.'}
                </p>
              </>
            ) : (
              <div className="flex items-center gap-2 text-sm text-win">
                <CheckCircle2 size={18} /> You have reached the top of this ladder.
              </div>
            )}
          </Card>

          {/* Reputation */}
          <Card>
            <h3 className="mb-3 font-display text-lg font-700 uppercase tracking-wide">This Season's Objectives</h3>
            <div className="space-y-2">
              {objectives.map((o) => (
                <div key={o.id} className="rounded-lg border border-line p-2.5">
                  <div className="flex items-center gap-2">
                    {o.done ? (
                      <CheckCircle2 size={15} className="shrink-0 text-win" />
                    ) : (
                      <Circle size={15} className="shrink-0 text-faint" />
                    )}
                    <span className="flex-1 text-xs font-600 text-ink">{o.label}</span>
                    <span className={cn('font-cond text-xs font-700 tnum', o.done ? 'text-win' : 'text-muted')}>
                      {o.current}/{o.target}
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <RatingBar
                      value={(o.current / o.target) * 100}
                      color={o.done ? '#05914f' : 'var(--team)'}
                      height={5}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Reputation */}
          <Card>
            <h3 className="mb-3 font-display text-lg font-700 uppercase tracking-wide">Reputation</h3>
            <div className="space-y-3">
              {REP_LABELS.map(({ key, label, desc }) => (
                <div key={key}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-cond text-xs font-600 uppercase text-ink-2">{label}</span>
                    <span className="font-cond text-xs font-700 tnum text-ink">{Math.round(career.reputation?.[key] ?? 0)}</span>
                  </div>
                  <RatingBar value={career.reputation?.[key] ?? 0} color={(career.reputation?.[key] ?? 0) >= 70 ? '#05914f' : (career.reputation?.[key] ?? 0) >= 40 ? 'var(--team)' : '#d98207'} height={7} />
                  <div className="mt-0.5 text-[10px] text-faint">{desc}</div>
                </div>
              ))}
            </div>
          </Card>

          {/* Skills */}
          <Card>
            <h3 className="mb-3 font-display text-lg font-700 uppercase tracking-wide">Skills</h3>
            <div className="space-y-3">
              {Object.entries(career.skills ?? {}) .map(([k, v]) => (
                <div key={k}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-cond text-xs font-600 uppercase text-ink-2">{k}</span>
                    <span className="font-cond text-xs font-700 tnum text-ink">{v}</span>
                  </div>
                  <RatingBar value={v} color="#c99a2e" height={7} />
                </div>
              ))}
            </div>
          </Card>

          {/* Offers */}
          <Card>
            <div className="mb-3 flex items-center gap-2">
              <Briefcase size={16} className="text-muted" />
              <h3 className="font-display text-lg font-700 uppercase tracking-wide">Job Offers</h3>
              {offers.length > 0 && <Badge tone="gold">{offers.length} new</Badge>}
            </div>
            {offers.length === 0 ? (
              <p className="text-sm text-muted">
                No offers on the table. Offers arrive during the offseason once your reputation clears the next rung.
              </p>
            ) : (
              <div className="space-y-3">
                {offers.map((o) => (
                  <div key={o.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-center gap-2">
                      <TeamCrest team={league.byId[o.teamId]} size={30} />
                      <div className="min-w-0 flex-1">
                        <div className="font-cond text-sm font-700 uppercase text-ink">{o.title}</div>
                        <div className="text-xs text-muted">
                          {league.byId[o.teamId].tier === 'NFL'
                            ? `${league.byId[o.teamId].city} ${league.byId[o.teamId].name}`
                            : league.byId[o.teamId].name}{' '}
                          · {o.years} yrs · {money(o.salary)}/yr
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="label !text-[9px]">Interest</div>
                        <div className="font-cond text-sm font-700 tnum text-ink">{o.interest}%</div>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-muted">{o.note}</p>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="team" className="flex-1" onClick={() => acceptOffer(o)}>
                        <ArrowUp size={13} /> Accept
                      </Button>
                    </div>
                  </div>
                ))}
                <Button size="sm" variant="ghost" className="w-full" onClick={declineOffers}>
                  Stay at {current.title}
                </Button>
              </div>
            )}
          </Card>

          <Card>
            <h3 className="mb-3 font-display text-lg font-700 uppercase tracking-wide">Your Job</h3>
            <div className="space-y-2 text-sm text-ink-2">
              <Button className="w-full justify-start" onClick={() => setScreen('scouting')}>
                <Target size={15} /> Scouting Board
              </Button>
              <Button className="w-full justify-start" onClick={() => setScreen('dashboard')}>
                <TrendingUp size={15} /> Program Dashboard
              </Button>
              <div className="flex items-center gap-2 rounded-lg bg-surface-2 p-3 text-xs text-muted">
                <Repeat2 size={14} />
                Salary by rung: {ladder.map((r) => money(salaryFor(career.path, r.level))).join(' · ')}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function HeadStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-black/20 px-3 py-1.5 text-white">
      <div className="label !text-white/60">{label}</div>
      <div className="font-display text-lg font-700 tnum leading-none">{value}</div>
    </div>
  )
}

/**
 * The "ghost GM" verdict (#8): your wins versus a replacement-level manager on
 * the same talent and schedule. The most honest score the game can give you.
 */
function GhostCard() {
  const career = useGame((s) => s.career)!
  const verdict = ghostVerdict(career)
  const hist = career.ghostHistory ?? []
  const last = hist[hist.length - 1]
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">Ghost GM</h3>
        {verdict && <Badge tone={verdict.totalDelta >= 0 ? 'win' : 'loss'}>{verdict.label}</Badge>}
      </div>
      {!verdict ? (
        <p className="text-sm text-muted">
          Finish a season to see how you did against a replacement-level manager on the same roster.
        </p>
      ) : (
        <div className="space-y-3">
          {last && (
            <div className="rounded-lg bg-surface-2 p-3">
              <div className="label !text-[10px]">Last season · {last.season}</div>
              <div className="font-display text-2xl font-700 tnum text-ink">
                {last.delta >= 0 ? '+' : ''}
                {last.delta.toFixed(1)} wins over replacement
              </div>
              <div className="mt-0.5 text-[11px] text-muted">
                You won {last.actualWins}; the ghost projected {last.ghostWins}.
              </div>
            </div>
          )}
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{verdict.seasons} season{verdict.seasons === 1 ? '' : 's'} tracked</span>
            <span className={verdict.totalDelta >= 0 ? 'font-700 text-win' : 'font-700 text-loss'}>
              {verdict.totalDelta >= 0 ? '+' : ''}
              {verdict.totalDelta.toFixed(1)} career
            </span>
          </div>
        </div>
      )}
    </Card>
  )
}

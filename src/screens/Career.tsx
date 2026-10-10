import { useState } from 'react'
import { ArrowUp, Briefcase, CheckCircle2, Circle, Copy, Plus, Repeat2, Sparkles, Star, Target, TrendingUp } from 'lucide-react'
import { cn } from '../lib/cn'
import { jobTone, money, type Tone } from '../lib/format'
import {
  masteryCarryOver,
  nflLadder,
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
import { ownerFiringLine } from '../game/engine/owner'
import {
  SKILL_BLURBS,
  SKILL_KEYS,
  SKILL_LABELS,
  skillActive,
  skillEffectText,
  skillUsedFrom,
  type SkillKey,
} from '../game/engine/skills'
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
import { recordOf } from '../game/selectors'
import { formatSeed } from '../game/engine/seed'
import { scenarioById } from '../game/engine/scenarios'
import { portfolioItems } from '../game/engine/portfolio'
import { counterOffer } from '../game/engine/counter'
import type { JobOffer } from '../game/types'
import type { World } from '../game/engine/generate'
import { useGame, useWorld } from '../store/gameStore'
import { CareerRhythm } from '../components/CareerRhythm'
import { DeadlinePanel } from '../components/DeadlinePanel'
import { CareerPeople } from '../components/CareerPeople'
import { GmRequestsDesk } from '../components/GmRequestsDesk'
import { WeeklyChecklist } from '../components/WeeklyChecklist'
import { AmbitionsCard } from '../components/AmbitionsCard'
import { LegacyCard } from '../components/LegacyCard'
import { PortfolioCard } from '../components/PortfolioCard'
import { InterviewPrep } from '../components/InterviewPrep'
import { VoicesCard } from '../components/VoicesCard'
import { DataTable, type Column } from '../components/DataTable'
import { usePhone } from '../ui/hooks'
import {
  Button,
  Badge,
  Card,
  ConfirmSheet,
  OverflowMenu,
  PageHeader,
  RatingBar,
  Tabs,
  TeamCrest,
  VerdictChip,
  type Consequence,
  type MenuItem,
} from '../ui/kit'

const REP_LABELS: { key: keyof Reputation; label: string; desc: string }[] = [
  { key: 'evaluation', label: 'Evaluation', desc: 'Scouting eye and talent ID' },
  { key: 'roster', label: 'Roster Building', desc: 'Draft, cap, and free agency' },
  { key: 'leadership', label: 'Leadership', desc: 'Staff, culture, development' },
  { key: 'results', label: 'Results', desc: 'Wins, playoffs, titles' },
  { key: 'profile', label: 'Profile', desc: 'Connections and pedigree' },
]

const JOB_WORD: Record<Tone, string> = { win: 'Secure', neutral: 'Stable', warn: 'Hot seat', loss: 'Firing line' }

type CareerTab = 'week' | 'progress' | 'people' | 'legacy' | 'role'

/** The bar tone for a 0-100 value against the tiers the game already uses. */
function repBarColor(v: number): string {
  return v >= 70 ? 'var(--color-win)' : v >= 40 ? 'var(--color-ink-2)' : 'var(--color-warn)'
}

export function Career() {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const offers = useGame((s) => s.offers)
  const acceptOffer = useGame((s) => s.acceptOffer)
  const acceptCounter = useGame((s) => s.acceptCounter)
  const declineOffers = useGame((s) => s.declineOffers)
  const spendSkillPoint = useGame((s) => s.spendSkillPoint)
  const setScreen = useGame((s) => s.setScreen)
  const showToast = useGame((s) => s.showToast)
  const phone = usePhone()
  const [prep, setPrep] = useState<JobOffer | null>(null)
  const [tab, setTab] = useState<CareerTab>('week')
  const [pendingSkill, setPendingSkill] = useState<SkillKey | null>(null)

  const myTeam = league.byId[career.teamId]
  const liveCounter = career.counter?.season === league.season && !career.counter.taken
  const counter = liveCounter ? counterOffer(league, career, offers) : null

  function copySeed() {
    try {
      void navigator.clipboard?.writeText(formatSeed(league.seed))?.catch(() => {})
    } catch {
      // clipboard unavailable in this context
    }
    showToast('Seed copied')
  }

  const team = league.byId[career.teamId]
  const resume = portfolioItems(league, career)
  // Only the NFL rungs are reachable in this build, so the player sees the NFL
  // ladder — and, because nflLadder filters rungs, rung.level is not its index.
  const ladder = nflLadder(career.path)
  const current = tierFor(career.path, career.level)
  const currentRung = ladder.findIndex((r) => r.level === career.level)
  const next = ladder.find((r) => r.level > career.level)
  const rec = recordOf(league, career.teamId)
  const overall = overallRep(career.reputation)
  const hitRate = career.hits + career.misses ? Math.round((career.hits / (career.hits + career.misses)) * 100) : 0
  const prog = progressToNext(career.reputation, career.path, career.level)
  const caps = capabilities(career)
  const thisMastery = getRoleMastery(career)
  const skillPoints = career.skillPoints ?? 0
  const objectives = roleObjectives(
    league,
    career,
    { wins: rec.wins, losses: rec.losses },
    unitRanks(league, 'NFL')[career.teamId],
  )
  // The next objective to chase: highest progress, but only fall back to the
  // universal security goal when nothing else is left.
  const jobThisWeek =
    [...objectives]
      .filter((o) => !o.done && o.id !== 'security')
      .sort((a, b) => b.current / b.target - a.current / a.target)[0] ?? objectives.find((o) => !o.done)

  const shellTone = jobTone(career.jobSecurity, ownerFiringLine(career.teamId))
  const slabCell = { background: 'color-mix(in srgb, var(--team-on) 14%, transparent)' }

  const careerMenu: MenuItem[] = [
    {
      id: 'seed',
      label: `Copy world seed · ${formatSeed(league.seed)}`,
      description: 'Same seed, same league',
      icon: <Copy size={16} aria-hidden />,
      onSelect: copySeed,
    },
  ]

  const tabs: { id: CareerTab; label: string; badge?: number }[] = [
    { id: 'week', label: 'This Week', badge: offers.length || undefined },
    { id: 'progress', label: 'Progress' },
    { id: 'people', label: 'People' },
    { id: 'legacy', label: 'Legacy' },
    { id: 'role', label: 'Role' },
  ]

  const skillValue = pendingSkill ? career.skills[pendingSkill] : 0
  const skillNext = Math.min(99, skillValue + 2)
  const skillCons: Consequence[] = pendingSkill
    ? [
        { label: 'Skill', value: SKILL_LABELS[pendingSkill] },
        { label: 'Rating', value: `${skillValue} → ${skillNext}`, tone: 'win' },
        { label: 'Effect', value: `${skillEffectText(pendingSkill, skillValue)} → ${skillEffectText(pendingSkill, skillNext)}` },
        { label: 'Points left', value: `${skillPoints} → ${skillPoints - 1}`, tone: 'warn' },
      ]
    : []

  return (
    <div>
      <PageHeader
        eyebrow="Career"
        title={current.title}
        subtitle={`${career.gmName} · ${career.path === 'coach' ? 'Coaching' : 'Personnel'} track · ${
          team.tier === 'NFL' ? `${team.city} ${team.name}` : team.name
        } · ${VERB_BLURB[current.verb]}`}
        right={<OverflowMenu items={careerMenu} label="Career actions" />}
      />

      {/* ── Identity: one strip with everything at a glance ───────────────── */}
      <Card pad={false} className="mb-4 overflow-hidden">
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4"
          style={{ background: 'var(--team-fill)', color: 'var(--team-on)', boxShadow: 'var(--team-slab-ring)' }}
        >
          <TeamCrest team={team} size={52} />
          <div className="min-w-0">
            <div className="font-cond text-label font-600 uppercase tracking-[0.07em] opacity-80">
              Season {league.season} · Week {league.week} · {team.tier === 'NFL' ? `${team.conference} ${team.division}` : team.conference}
            </div>
            <div className="font-display text-[28px] font-800 italic uppercase leading-none">
              {team.tier === 'NFL' ? `${team.city} ${team.name}` : team.name}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {career.scenario && career.scenario !== 'climb' && (
              <span
                className="rounded-[var(--r-xs)] px-2 py-1 font-cond text-label font-700 uppercase tracking-[0.06em]"
                style={{ background: 'color-mix(in srgb, var(--team-on) 18%, transparent)' }}
              >
                {scenarioById(career.scenario).title}
              </span>
            )}
            <HeadStat label="Overall Rep" value={overall} />
            <HeadStat label="Next rung" value={next ? `${Math.round(Math.min(1, prog.pct) * 100)}%` : 'Top'} />
            <div className="rounded-[var(--r-md)] px-3 py-1.5" style={slabCell}>
              <div className="font-cond text-label font-600 uppercase tracking-[0.07em] opacity-75">Job security</div>
              <div className="flex items-center gap-1.5">
                <span className="font-display text-lg font-700 tnum leading-none">{career.jobSecurity}%</span>
                <VerdictChip tone={shellTone}>{JOB_WORD[shellTone]}</VerdictChip>
              </div>
            </div>
            <HeadStat label="Salary" value={money(career.salary)} />
            <HeadStat label="Hit Rate" value={`${hitRate}%`} />
          </div>
        </div>
      </Card>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <Tabs
        label="Career sections"
        value={tab}
        onChange={setTab}
        stretch={phone}
        className="mb-4"
        tabs={tabs.map((t) => ({ id: t.id, label: t.label, count: t.badge }))}
      />

      {tab === 'week' && (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-4">
            {(offers.length > 0 || counter) && (
              <>
                <Card>
                  <div className="mb-3 flex items-center gap-2">
                    <Briefcase size={16} className="text-muted" aria-hidden />
                    <h3 className="font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">Job Offers</h3>
                    {offers.length > 0 && <Badge tone="info">{offers.length} new</Badge>}
                  </div>
                  {counter && (
                    <div className="mb-3 rounded-[var(--r-md)] border border-gold/60 bg-gold/10 p-3">
                      <div className="mb-1 flex items-center gap-1.5">
                        <Star size={13} className="text-gold" aria-hidden />
                        <div className="font-cond text-body font-700 uppercase tracking-[0.02em] text-ink">
                          Counteroffer — stay with the {myTeam.name}
                        </div>
                      </div>
                      <p className="text-small text-ink-2">{counter.text}</p>
                      <Button size="sm" variant="primary" className="mt-2 w-full" onClick={acceptCounter}>
                        Accept counter
                      </Button>
                    </div>
                  )}
                  {offers.length === 0 ? (
                    <p className="text-body text-muted">
                      No offers on the table. Offers arrive during the offseason once your reputation clears the next rung.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {offers.map((o) => (
                        <div key={o.id} className="rounded-[var(--r-md)] border border-line p-3">
                          <div className="flex items-center gap-2">
                            <TeamCrest team={league.byId[o.teamId]} size={30} />
                            <div className="min-w-0 flex-1">
                              <div className="font-cond text-body font-700 uppercase tracking-[0.02em] text-ink">{o.title}</div>
                              <div className="text-small text-muted">
                                {league.byId[o.teamId].tier === 'NFL'
                                  ? `${league.byId[o.teamId].city} ${league.byId[o.teamId].name}`
                                  : league.byId[o.teamId].name}{' '}
                                · {o.years} yrs · {money(o.salary)}/yr
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="label">Interest</div>
                              <div className="font-cond text-body font-700 tnum text-ink">{o.interest}%</div>
                            </div>
                          </div>
                          <p className="mt-2 text-small text-muted">{o.note}</p>
                          <div className="mt-2 flex gap-2">
                            <Button
                              size="sm"
                              variant="primary"
                              className="flex-1"
                              onClick={() => (resume.length ? setPrep(o) : acceptOffer(o))}
                            >
                              <ArrowUp size={13} aria-hidden /> Accept
                            </Button>
                          </div>
                        </div>
                      ))}
                      <Button size="sm" variant="secondary" className="w-full" onClick={declineOffers}>
                        Stay at {current.title}
                      </Button>
                    </div>
                  )}
                </Card>
              </>
            )}
            {career.deadline && career.deadline.season === league.season && career.deadline.week === league.week && (
              <DeadlinePanel />
            )}
            <CareerRhythm />
          </div>
          <div className="space-y-4">
            <WeeklyChecklist />
            <GmRequestsDesk />
            <Card>
              <div className="label mb-1">Your job this week</div>
              <p className="text-body font-600 text-ink">
                {jobThisWeek
                  ? `${jobThisWeek.label} (${jobThisWeek.current}/${jobThisWeek.target})`
                  : 'Every objective met — keep it rolling.'}
              </p>
            </Card>
            <Card>
              <h3 className="mb-3 font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">
                This Season&rsquo;s Objectives
              </h3>
              <div className="space-y-2">
                {objectives.map((o) => (
                  <div key={o.id} className="rounded-[var(--r-md)] border border-line p-2.5">
                    <div className="flex items-center gap-2">
                      {o.done ? (
                        <CheckCircle2 size={15} className="shrink-0 text-win" aria-hidden />
                      ) : (
                        <Circle size={15} className="shrink-0 text-faint" aria-hidden />
                      )}
                      <span className="flex-1 text-small font-600 text-ink">{o.label}</span>
                      <span className={cn('font-cond text-small font-700 tnum', o.done ? 'text-win' : 'text-muted')}>
                        {o.current}/{o.target}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <RatingBar
                        value={(o.current / o.target) * 100}
                        color={o.done ? 'var(--color-win)' : 'var(--color-ink-2)'}
                        height={5}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'progress' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <Card>
              <h3 className="mb-3 font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">Next Step</h3>
              {next ? (
                <>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-cond text-body font-700 uppercase tracking-[0.02em] text-ink">{next.title}</span>
                    <span className="font-cond text-small text-muted">{next.tier}</span>
                  </div>
                  <RatingBar value={prog.pct * 100} color={prog.pct >= 1 ? 'var(--color-win)' : 'var(--color-ink-2)'} height={10} />
                  <div className="mt-2 text-small text-muted">
                    {prog.pct >= 1 ? 'Qualified — offers arrive in the offseason.' : `Needs: ${prog.missing.join(' · ')}`}
                  </div>
                  <p className="mt-3 rounded-[var(--r-md)] bg-surface-2 p-3 text-small leading-relaxed text-muted">
                    {prog.pct >= 1
                      ? 'You have earned a look at the next level.'
                      : 'Win games, grade prospects accurately, and build your profile. Exceptional work earns offers faster.'}
                  </p>
                </>
              ) : (
                <div className="flex items-center gap-2 text-body text-win">
                  <CheckCircle2 size={18} aria-hidden /> You have reached the top of this ladder.
                </div>
              )}
            </Card>
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">Role Mastery</h3>
                <span className="font-display text-xl font-700 tnum text-ink">{thisMastery}</span>
              </div>
              <RatingBar value={thisMastery} color={thisMastery >= 70 ? 'var(--color-win)' : thisMastery >= 45 ? 'var(--color-ink-2)' : 'var(--color-warn)'} height={8} />
              <p className="mt-2 text-label text-muted">
                {thisMastery >= 75
                  ? 'Thriving in this role. Excellence here gives you a head start at the next level.'
                  : thisMastery >= 50
                    ? 'Solid. Meet your objectives to build a stronger résumé for the next job.'
                    : 'Struggling in this role. Your next step will be harder.'}
              </p>
              {next && (
                <div className="mt-3 rounded-[var(--r-md)] bg-surface-2 p-2.5 text-label text-muted">
                  Prior-role carry-over:{' '}
                  <strong className="text-ink">+{Math.max(0, Math.round(masteryCarryOver(career).profile ?? 0))} profile</strong> toward
                  becoming {next.title}.
                </div>
              )}
            </Card>
            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <h3 className="mb-3 font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">Reputation</h3>
                <div className="space-y-3">
                  {REP_LABELS.map(({ key, label, desc }) => {
                    const v = career.reputation?.[key] ?? 0
                    return (
                      <div key={key}>
                        <div className="mb-1 flex items-center justify-between">
                          <span className="font-cond text-small font-600 uppercase tracking-[0.04em] text-ink-2">{label}</span>
                          <span className="font-cond text-small font-700 tnum text-ink">{Math.round(v)}</span>
                        </div>
                        <RatingBar value={v} color={repBarColor(v)} height={7} />
                        <div className="mt-0.5 text-label text-faint">{desc}</div>
                      </div>
                    )
                  })}
                </div>
              </Card>
              <Card>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">Skills</h3>
                  <Badge tone={skillPoints > 0 ? 'warn' : 'neutral'}>
                    <span className="inline-flex items-center gap-1">
                      <Sparkles size={11} aria-hidden /> {skillPoints} point{skillPoints === 1 ? '' : 's'} to spend
                    </span>
                  </Badge>
                </div>
                <div className="space-y-2.5">
                  {SKILL_KEYS.map((key) => {
                    const value = career.skills[key]
                    const nextValue = Math.min(99, value + 2)
                    const active = skillActive(key, career.path, career.level)
                    const from = skillUsedFrom(key, career.path)
                    return (
                      <div key={key} className={cn('rounded-[var(--r-md)] border border-line p-2.5', !active && 'opacity-60')}>
                        <div className="flex items-center gap-2">
                          <span className="font-cond text-small font-600 uppercase tracking-[0.04em] text-ink-2">{SKILL_LABELS[key]}</span>
                          <span className="ml-auto font-cond text-body font-700 tnum text-ink">{value}</span>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={skillPoints <= 0 || value >= 99}
                            title="Spend 1 point for +2"
                            aria-label={`Spend a point on ${SKILL_LABELS[key]}`}
                            icon={<Plus size={14} aria-hidden />}
                            onClick={() => setPendingSkill(key)}
                          />
                        </div>
                        <div className="mt-1.5">
                          <RatingBar value={value} color={active ? 'var(--color-gold)' : 'var(--color-faint)'} height={6} />
                        </div>
                        <p className="mt-1 text-label text-muted">{SKILL_BLURBS[key]}</p>
                        <p className="mt-0.5 text-label text-faint">
                          {value}: {skillEffectText(key, value)}
                          {value < 99 ? ` → ${nextValue}: ${skillEffectText(key, nextValue)}` : ' · maxed'}
                        </p>
                        {!active && from && (
                          <p className="mt-0.5 text-label text-warn">Used from {from} — points still count, just not yet.</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </Card>
            </div>
          </div>
          <div className="space-y-4">
            <Card>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">
                  {career.path === 'coach' ? 'Coaching Ladder' : 'Personnel Ladder'}
                </h3>
                <Badge tone="neutral">Level {currentRung >= 0 ? currentRung + 1 : 1} of {ladder.length}</Badge>
              </div>
              <div className="space-y-1">
                {ladder.map((rung) => {
                  const done = rung.level < career.level
                  const active = rung.level === career.level
                  return (
                    <div
                      key={rung.level}
                      className={cn(
                        'flex items-center gap-3 rounded-[var(--r-md)] border px-3 py-2',
                        active ? 'border-line-strong bg-[var(--team-tint)] shadow-[inset_3px_0_0_var(--team-accent)]' : done ? 'border-line opacity-70' : 'border-line',
                      )}
                    >
                      {done ? (
                        <CheckCircle2 size={18} className="text-win" aria-hidden />
                      ) : active ? (
                        <Star size={18} className="text-[var(--team-accent)]" aria-hidden />
                      ) : (
                        <Circle size={18} className="text-faint" aria-hidden />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className={cn('font-cond text-body font-700 uppercase tracking-[0.02em]', active ? 'text-ink' : 'text-ink-2')}>
                          {rung.title}
                        </div>
                        <div className="text-small text-muted">{rung.blurb}</div>
                      </div>
                      <div className="hidden text-right sm:block">
                        <div className="label">Requires</div>
                        <div className="font-cond text-label text-muted">
                          {Object.entries(rung.gate).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'people' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <CareerPeople />
          </div>
          <div className="space-y-4">
            <AmbitionsCard />
            <VoicesCard />
          </div>
        </div>
      )}

      {tab === 'legacy' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <LegacyCard />
            <GhostCard />
          </div>
          <div className="space-y-4">
            <PortfolioCard />
            <Card>
              <h3 className="mb-3 font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">Career History</h3>
              {career.history.length === 0 ? (
                <p className="py-4 text-body text-muted">
                  No seasons on record yet. Do your job, build your reputation, and the offers will come.
                </p>
              ) : (
                <DataTable
                  label="Career history"
                  rows={[...career.history].reverse()}
                  rowKey={(h) => `${h.season}-${h.role}-${h.team}`}
                  maxHeight="none"
                  columns={HIST_COLUMNS(league)}
                />
              )}
            </Card>
          </div>
        </div>
      )}

      {tab === 'role' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">Your Role</h3>
              <Badge tone="neutral">{current.title}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {ALL_CAPABILITIES.map((cap) => {
                const has = caps.can.has(cap)
                return (
                  <div key={cap} className={cn('flex items-center gap-1.5 text-small', has ? 'text-ink' : 'text-faint')}>
                    {has ? <CheckCircle2 size={13} className="shrink-0 text-win" aria-hidden /> : <Circle size={13} className="shrink-0" aria-hidden />}
                    <span>{CAP_LABELS[cap] ?? cap}</span>
                  </div>
                )
              })}
            </div>
            {caps.prospectScope !== undefined && (
              <p className="mt-3 rounded-[var(--r-md)] bg-surface-2 p-2.5 text-label text-muted">
                Scope: you track <strong className="text-ink">{caps.prospectScope} prospects</strong> — climbing widens your view.
              </p>
            )}
            {caps.planScope !== 'none' && (
              <p className="mt-2 rounded-[var(--r-md)] bg-surface-2 p-2.5 text-label text-muted">
                Game plan control: <strong className="text-ink">{caps.planScope === 'both' ? 'both sides' : 'your side of the ball'}</strong>.
              </p>
            )}
          </Card>
          <Card>
            <h3 className="mb-3 font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">Your Job</h3>
            <div className="space-y-2 text-body text-ink-2">
              <Button variant="secondary" className="w-full justify-start" icon={<Target size={15} aria-hidden />} onClick={() => setScreen('scouting')}>
                Scouting Board
              </Button>
              <Button variant="secondary" className="w-full justify-start" icon={<TrendingUp size={15} aria-hidden />} onClick={() => setScreen('dashboard')}>
                Program Dashboard
              </Button>
              <div className="flex items-center gap-2 rounded-[var(--r-md)] bg-surface-2 p-3 text-small text-muted">
                <Repeat2 size={14} aria-hidden />
                Salary by rung: {ladder.map((r) => money(salaryFor(career.path, r.level))).join(' · ')}
              </div>
            </div>
          </Card>
        </div>
      )}

      {tab !== 'week' && offers.length > 0 && (
        <button
          type="button"
          onClick={() => setTab('week')}
          className="motion mt-4 w-full rounded-[var(--r-lg)] border border-gold/60 bg-gold/10 px-4 py-3 text-left font-cond text-body font-700 uppercase tracking-[0.02em] text-ink"
        >
          {offers.length} job offer{offers.length === 1 ? '' : 's'} waiting — open This Week
        </button>
      )}

      {/* Skill points are one-way: +2 to a skill for good, so review it first. */}
      <ConfirmSheet
        open={!!pendingSkill}
        onClose={() => setPendingSkill(null)}
        eyebrow={pendingSkill ? SKILL_LABELS[pendingSkill] : undefined}
        title={pendingSkill ? `Spend a point on ${SKILL_LABELS[pendingSkill]}?` : 'Spend a skill point?'}
        subtitle="Skill points are earned with reputation and never come back."
        consequences={skillCons}
        destructive={false}
        confirmLabel="Spend 1 point"
        ledgerNote={null}
        onConfirm={() => {
          if (pendingSkill) spendSkillPoint(pendingSkill)
          setPendingSkill(null)
        }}
      />

      {prep && <InterviewPrep offer={prep} onCancel={() => setPrep(null)} />}
    </div>
  )
}

/** One row of the résumé's season history. */
interface HistoryRow {
  season: number
  role: string
  team: string
  record: string
  outcome: string
}

/** Career-history table columns (kept out of render so the DataTable can memoise). */
function HIST_COLUMNS(league: World): Column<HistoryRow>[] {
  return [
    { key: 'season', label: 'Season', card: 'title', sortValue: (h) => h.season, render: (h) => <span className="font-cond font-700 tnum text-ink">{h.season}</span> },
    { key: 'role', label: 'Role', card: 'meta', sortValue: (h) => h.role, render: (h) => h.role },
    { key: 'team', label: 'Team', card: 'meta', sortValue: (h) => h.team, render: (h) => league.byId[h.team]?.name ?? h.team },
    { key: 'record', label: 'Record', align: 'right', card: 'value', sortValue: (h) => h.record, render: (h) => <span className="font-cond tnum">{h.record}</span> },
    { key: 'outcome', label: 'Outcome', card: 'value', render: (h) => <span className="text-muted">{h.outcome}</span> },
  ]
}

function HeadStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[var(--r-md)] px-3 py-1.5" style={{ background: 'color-mix(in srgb, var(--team-on) 14%, transparent)' }}>
      <div className="font-cond text-label font-600 uppercase tracking-[0.07em] opacity-75">{label}</div>
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
        <h3 className="font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">Ghost GM</h3>
        {verdict && <VerdictChip tone={verdict.totalDelta >= 0 ? 'win' : 'loss'}>{verdict.label}</VerdictChip>}
      </div>
      {!verdict ? (
        <p className="text-body text-muted">
          Finish a season to see how you did against a replacement-level manager on the same roster.
        </p>
      ) : (
        <div className="space-y-3">
          {last && (
            <div className="rounded-[var(--r-md)] bg-surface-2 p-3">
              <div className="label">Last season · {last.season}</div>
              <div className="font-display text-2xl font-800 italic tnum text-ink">
                {last.delta >= 0 ? '+' : ''}
                {last.delta.toFixed(1)} wins over replacement
              </div>
              <div className="mt-0.5 text-label text-muted">
                You won {last.actualWins}; the ghost projected {last.ghostWins}.
              </div>
            </div>
          )}
          <div className="flex items-center justify-between text-small text-muted">
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

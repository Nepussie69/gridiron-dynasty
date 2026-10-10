import { useState, type ReactNode } from 'react'
import { ArrowRight, ChevronDown, Play, Search, Shield, Sparkles, TriangleAlert, TrendingUp } from 'lucide-react'
import { cn } from '../lib/cn'
import { NFL_TEAMS } from '../game/data/nflTeams'
import { minNflLevel, nflLadder, tierFor } from '../game/engine/career'
import { capabilities } from '../game/engine/capabilities'
import { SCENARIOS, scenarioById } from '../game/engine/scenarios'
import { parseSeedCode } from '../game/engine/seed'
import type { CareerPath, ScenarioId } from '../game/types'
import { useGame } from '../store/gameStore'
import { Badge, Button, Card, ConfirmSheet, OptionCard, OptionGroup, SegmentedControl, TeamCrest } from '../ui/kit'

const ARCHETYPES: Record<CareerPath, { id: string; name: string; desc: string }[]> = {
  personnel: [
    { id: 'scout', name: 'Talent Evaluator', desc: 'Elite eye for the draft. Reads the tape better than anyone.' },
    { id: 'cap', name: 'Cap Strategist', desc: 'Builds rosters through contracts and the numbers.' },
    { id: 'dealmaker', name: 'Deal Maker', desc: 'Wins trades and free agency. Aggressive roster builder.' },
  ],
  coach: [
    { id: 'qb', name: 'QB Guru', desc: 'Develops elite passers and offensive skill talent.' },
    { id: 'def', name: 'Defensive Mind', desc: 'Scheme-driven. Finds NFL defenders others miss.' },
    { id: 'ceo', name: 'Program CEO', desc: 'Elite staff builder and culture setter.' },
  ],
}

/**
 * The only universe in this build: 32 NFL clubs. A new career is a rebuild, so
 * the franchise list offers only the league's worst clubs — its lowest-prestige
 * franchises — sorted from worst to least-bad.
 */
const pool = [...NFL_TEAMS].sort((a, b) => a.prestige - b.prestige).slice(0, 8)

/**
 * What each rung actually consists of. `does` is the week-to-week job; `controls`
 * is what you're allowed to decide; `promo` is what earns the next rung. Keyed by
 * the rung's original ladder level so it stays stable if the ladder is reindexed.
 */
const ROLE_DETAIL: Record<number, { does: string; controls: string; promo: string }> = {
  4: {
    does: 'Break down the college board: grade prospects, cross-check the area scouts, and keep the department’s reports honest and on schedule.',
    controls: 'You advise on grades and run the room, but the Director still owns the final draft board and the picks.',
    promo: 'File accurate, high-volume reports and lift the department’s hit rate — Evaluation is the rep that gates you.',
  },
  5: {
    does: 'Own the draft board for the club. Stack your board against consensus, run the war-room meetings, and hand the GM a class you can defend.',
    controls: 'Your board drives the picks. You’re the last voice before the GM on who the club takes.',
    promo: 'Deliver graded classes that hit, keep the board clean, and pile up Roster Building rep.',
  },
  6: {
    does: 'Run pro and college scouting together — free-agent evaluations, trade targets, and the contract conversations that shape the roster.',
    controls: 'Real say over who you sign and how the roster is built, alongside the cap team.',
    promo: 'Win the roster battle: value signings, cap health, and a scouting department that’s right more often than not.',
  },
  7: {
    does: 'Run the building day to day — set the scouting calendar, manage the staff, and own the plan the GM signs off on.',
    controls: 'Near-total control of football operations short of the final call on the 53.',
    promo: 'Show you can lead people, not just evaluate them. Leadership and Profile open the GM door.',
  },
  8: {
    does: 'Final say on the 53. Own the draft, free agency, and the cap, hire the head coach, and answer to the owner for the results.',
    controls: 'The roster and the cap — the final call is yours. You don\u2019t get in the way of football operations: the head coach runs the scheme, the game plan, and the room.',
    promo: 'Win. Championships and playoff runs are the only thing left to chase.',
  },
  // Coaching ladder
  9: {
    does: 'Coach a position room or run quality control: develop players, install techniques, and prove you can teach at the pro level.',
    controls: 'Your room’s development and technique. Game-plan input goes through the coordinator.',
    promo: 'Produce contributors, win your unit’s reps, and build the Leadership rep that a coordinator job demands.',
  },
  10: {
    does: 'Run one side of the ball — install the scheme, call the plays, and own the unit’s weekly game plan.',
    controls: 'Full control of your side: scheme, personnel groupings, and in-game calls.',
    promo: 'Field a top unit. A top-10 offense or defense makes you the next head-coach name.',
  },
  11: {
    does: 'Run the whole team: scheme, training, game management, the staff, and the locker room. You set the standard and take the blame.',
    controls: 'Complete control of football operations — the game plan, the scheme, and the coaching room. On the roster and the cap you influence the GM, who makes the final call.',
    promo: 'Win games and championships. You answer to the owner now.',
  },
}
/** Coaching rungs are numbered separately; map their ladder levels onto the detail keys. */
function roleDetail(path: CareerPath, level: number) {
  const key = path === 'coach' ? level + 4 : level
  return ROLE_DETAIL[key] ?? { does: '', controls: '', promo: '' }
}

/** Friendly names for the things a capability unlocks on screen. */
const UNLOCK_LABEL: Partial<Record<string, string>> = {
  grade: 'File prospect grades',
  rankBoard: 'Rank your own board',
  crossCheck: 'Cross-check other scouts',
  assignScouts: 'Direct the scouting staff',
  setBoard: 'Own the final draft board',
  proScout: 'Pro scouting',
  negotiate: 'Negotiate contracts',
  manageCap: 'Manage the cap sheet',
  draft: 'Make draft picks',
  signFreeAgents: 'Sign free agents',
  developRoom: 'Develop a position room',
  callPlays: 'Call the plays',
  installScheme: 'Install your scheme',
  hireStaff: 'Hire coaches',
  gameManagement: 'Game-day decisions',
  setExpectations: 'Own the results',
}

/** Everything a rung is allowed to do — its full set of powers, so it reads
 * cleanly on its own (not just the delta vs. the rung below). */
function unlocksFor(path: CareerPath, level: number): string[] {
  const fake = { path, level } as unknown as Parameters<typeof capabilities>[0]
  const caps = capabilities(fake)
  const powers = [...caps.can].map((c) => UNLOCK_LABEL[c]).filter(Boolean) as string[]
  if (caps.planScope === 'own-side') powers.push('Set your side of the game plan')
  if (caps.planScope === 'both') powers.push('Run the whole game plan')
  return powers
}

export function CareerHub() {
  const startCareer = useGame((s) => s.startCareer)
  const continueCareer = useGame((s) => s.continueCareer)
  const discardSave = useGame((s) => s.discardSave)
  const saveInfo = useGame((s) => s.saveInfo)
  const saveError = useGame((s) => s.saveError)
  const [name, setName] = useState('A. Reeves')
  const [path, setPath] = useState<CareerPath>('personnel')
  const [archetype, setArchetype] = useState('scout')
  const [advanced, setAdvanced] = useState(false)
  const [level, setLevel] = useState(minNflLevel('personnel'))
  const [teamId, setTeamId] = useState(pool[0].id)
  const [seedText, setSeedText] = useState('')
  const [scenarioId, setScenarioId] = useState<ScenarioId>('climb')
  const [openRung, setOpenRung] = useState<number | null>(null)
  const [freshOpen, setFreshOpen] = useState(false)

  const seedValue = parseSeedCode(seedText)
  const seedInvalid = seedText.trim() !== '' && seedValue === null
  const selected = pool.find((t) => t.id === teamId) ?? pool[0]
  const ladder = nflLadder(path)
  const rung = tierFor(path, level)
  const startSalary = salaryForLevel(path, level)
  const scenario = scenarioById(scenarioId)
  const scenarioLocked = scenarioId !== 'climb'

  function choosePath(p: CareerPath) {
    setPath(p)
    setArchetype(ARCHETYPES[p][0].id)
    setLevel(minNflLevel(p))
  }

  function chooseScenario(id: ScenarioId) {
    setScenarioId(id)
    const s = scenarioById(id)
    if (s.path) {
      setPath(s.path)
      setArchetype(ARCHETYPES[s.path][0].id)
    }
    if (s.level !== null) setLevel(s.level)
    if (s.forceLowestPrestige) setTeamId(pool[0].id)
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-[1240px] px-6 py-10">
        {/* Continue first: on phone the resumable save leads, before the pitch. */}
        {saveInfo && (
          <div className="mx-auto mb-8 max-w-[760px] rounded-[var(--r-lg)] border border-line-strong bg-surface p-5 shadow-[var(--shadow-1)]">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="label">Continue Career</div>
              {saveInfo.usedBackup && <Badge tone="warn">Recovered from backup</Badge>}
            </div>
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[var(--r-md)] bg-surface-3 text-ink-2">
                <Play size={20} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-display text-xl font-800 italic uppercase leading-none text-ink">{saveInfo.title}</div>
                <div className="mt-0.5 font-cond text-small text-muted">
                  {saveInfo.teamName} · Season {saveInfo.season} · {saveInfo.tier}
                </div>
                {saveInfo.savedAt > 0 && (
                  <div className="mt-0.5 text-label text-faint">Saved {new Date(saveInfo.savedAt).toLocaleString()}</div>
                )}
              </div>
            </div>
            <Button variant="primary" size="lg" className="mt-3 w-full" icon={<Play size={16} aria-hidden />} onClick={continueCareer}>
              Continue
            </Button>
            <Button variant="quiet" size="sm" className="mt-2 w-full" onClick={() => setFreshOpen(true)}>
              Start fresh (erase this save)
            </Button>
          </div>
        )}

        {saveError && !saveInfo && (
          <div className="mx-auto mb-8 flex max-w-[760px] items-start gap-2 rounded-[var(--r-lg)] border border-warn/30 bg-warn-soft p-3 text-small text-warn">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
            <span>{saveError}</span>
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-[1.05fr_1fr]">
          {/* Hero */}
          <div>
            <div className="mb-6 flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-[var(--r-md)] bg-slab text-on-slab">
                <Shield size={24} strokeWidth={2.4} aria-hidden />
              </div>
              <div>
                <div className="font-display text-3xl font-800 italic uppercase leading-none tracking-wide">
                  Gridiron <span className="text-brand">Dynasty</span>
                </div>
                <div className="label mt-1">Front Office Football Career</div>
              </div>
            </div>

            <h1 className="font-display text-[40px] font-800 italic uppercase leading-[0.95] tracking-tight text-ink">
              Start in the league.
              <br />
              <span className="text-brand">Run an NFL franchise.</span>
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted">
              Every game is an NFL game. You begin as a{' '}
              {path === 'coach' ? 'position coach / quality-control assistant' : 'assistant director of college scouting'} making{' '}
              {path === 'coach' ? '$700k' : '$260k'}. Four reputations and your skills decide how fast you rise:{' '}
              <strong>Evaluation</strong>, <strong>Roster Building</strong>, <strong>Leadership</strong>,{' '}
              <strong>Results</strong>, and <strong>Profile</strong>. Excel and you skip rungs — stumble and you can be
              fired. The endpoint is the same: <strong>General Manager</strong>.
            </p>

            <div className="mt-6 space-y-2">
              {ladder.map((r, i) => {
                const open = openRung === r.level
                const isCurrent = r.level === level
                const d = roleDetail(path, r.level)
                const unlocks = unlocksFor(path, r.level)
                return (
                  <div key={r.level} className={cn('overflow-hidden rounded-[var(--r-lg)] border', isCurrent ? 'border-line-strong' : 'border-line')}>
                    <button
                      type="button"
                      onClick={() => setOpenRung(open ? null : r.level)}
                      aria-expanded={open}
                      className={cn('flex min-h-11 w-full items-center gap-4 p-3 text-left transition', open ? 'bg-surface' : 'bg-surface hover:bg-surface-2')}
                    >
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--r-md)] bg-surface-3 font-display text-base font-700 text-ink-2">
                        {i + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-display text-base font-700 uppercase leading-none text-ink">{r.title}</div>
                        <div className="mt-0.5 font-cond text-small text-muted">{r.blurb}</div>
                      </div>
                      {isCurrent && <Badge tone="neutral">Current level</Badge>}
                      <Badge tone="neutral">NFL</Badge>
                      <ChevronDown size={16} className={cn('shrink-0 text-faint transition-transform', open && 'rotate-180')} aria-hidden />
                    </button>

                    {open && d.does && (
                      <div className="space-y-2.5 border-t border-line bg-surface-2 p-3.5">
                        <RoleLine icon={<Search size={13} />} title="What you do" body={d.does} />
                        <RoleLine icon={<Shield size={13} />} title="What you control" body={d.controls} />
                        <RoleLine icon={<TrendingUp size={13} />} title="How you get promoted" body={d.promo} />
                        {unlocks.length > 0 && (
                          <div className="flex gap-2.5">
                            <span className="mt-0.5 shrink-0 text-[var(--team-accent)]">
                              <Sparkles size={13} aria-hidden />
                            </span>
                            <div className="text-small leading-relaxed text-ink-2">
                              <strong className="font-600 text-ink">What you unlock:</strong>{' '}
                              <span className="flex flex-wrap gap-1.5 pt-1.5">
                                {unlocks.map((u) => (
                                  <span key={u} className="rounded-[var(--r-xs)] bg-surface-3 px-1.5 py-0.5 font-cond text-label font-700 uppercase tracking-[0.06em] text-ink-2">
                                    {u}
                                  </span>
                                ))}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="mt-3 text-label leading-relaxed text-muted">
              The ladder is on the wall for reference — you set your starting level below.
            </p>

            <div className="mt-6 flex items-center gap-2 rounded-[var(--r-lg)] bg-brand-soft p-3.5 text-small text-brand">
              <Shield size={18} aria-hidden />
              <span>
                <strong className="font-600">One living league:</strong> the prospects you grade today become
                tomorrow&rsquo;s NFL stars. Reputation is earned, not given.
              </span>
            </div>
          </div>

          {/* Setup card */}
          <div className="space-y-4">
            <Card>
              <div className="label mb-1">New Career</div>
              <h2 className="mb-5 font-display text-2xl font-800 italic uppercase leading-none tracking-[0.01em] text-ink">
                Build Your Resumé
              </h2>

              <label className="label mb-1 block" htmlFor="hub-name">Your Name</label>
              <input
                id="hub-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mb-5 w-full rounded-[var(--r-md)] border border-line-strong bg-surface-2 px-3 py-2 text-[16px] font-600 text-ink outline-none focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]"
              />

              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="label">Track</span>
                {scenarioLocked && <span className="font-cond text-label font-700 uppercase tracking-[0.06em] text-muted">Set by scenario</span>}
              </div>
              <div className={cn('mb-5', scenarioLocked && 'pointer-events-none opacity-60')}>
                <SegmentedControl
                  label="Career track"
                  value={path}
                  onChange={(p) => {
                    if (!scenarioLocked) choosePath(p)
                  }}
                  options={[
                    { id: 'personnel', label: 'Personnel' },
                    { id: 'coach', label: 'Coaching' },
                  ]}
                />
              </div>

              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="label">Scenario</span>
              </div>
              <OptionGroup label="Scenario" className="mb-2">
                {SCENARIOS.map((s) => (
                  <OptionCard
                    key={s.id}
                    selected={scenarioId === s.id}
                    title={s.title}
                    description={s.desc}
                    onSelect={() => chooseScenario(s.id)}
                  />
                ))}
              </OptionGroup>
              <p className="mb-5 text-label leading-relaxed text-muted">
                Scenarios skip the climb — the Standard Climb is the intended way to play.
              </p>

              <div className="label mb-1.5">Archetype</div>
              <OptionGroup label="Archetype" className="mb-5">
                {ARCHETYPES[path].map((a) => (
                  <OptionCard key={a.id} selected={archetype === a.id} title={a.name} description={a.desc} onSelect={() => setArchetype(a.id)} />
                ))}
              </OptionGroup>

              {advanced && (
                <>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <span className="label">Starting Level (advanced)</span>
                    {scenarioLocked && <span className="font-cond text-label font-700 uppercase tracking-[0.06em] text-muted">Set by scenario</span>}
                  </div>
                  <div className="mb-4 flex flex-wrap gap-1.5">
                    {ladder.map((r) => (
                      <button
                        key={r.level}
                        type="button"
                        onClick={() => setLevel(r.level)}
                        disabled={scenarioLocked}
                        aria-pressed={level === r.level}
                        className={cn(
                          'motion pointer-coarse:min-h-11 rounded-[var(--r-sm)] border px-2 py-1 font-cond text-label font-700 uppercase tracking-[0.06em]',
                          scenarioLocked && 'cursor-not-allowed opacity-60',
                          level === r.level ? 'border-line-strong bg-surface-3 text-ink' : 'border-line text-muted hover:bg-surface-2',
                        )}
                      >
                        {r.title}
                      </button>
                    ))}
                  </div>

                  <label className="label mb-1.5 block" htmlFor="hub-seed">World seed</label>
                  <input
                    id="hub-seed"
                    value={seedText}
                    onChange={(e) => setSeedText(e.target.value)}
                    placeholder="Blank = random"
                    className="mb-1 w-full rounded-[var(--r-md)] border border-line-strong bg-surface-2 px-3 py-2 text-[16px] font-600 text-ink outline-none focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]"
                  />
                  <p className="text-label leading-relaxed text-muted">Same seed → same league. Leave blank for random.</p>
                  {seedInvalid && <p className="mt-1 text-label font-600 text-loss">That seed isn&apos;t valid.</p>}
                </>
              )}

              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="label">Choose Your Franchise</span>
                <span className="font-cond text-label font-700 uppercase tracking-[0.06em] text-muted">
                  {scenario.forceLowestPrestige ? 'Set by scenario' : 'Rebuild jobs · weakest clubs'}
                </span>
              </div>
              <div className="mb-2 max-h-[180px] overflow-y-auto rounded-[var(--r-md)] border border-line bg-surface-2 p-2">
                <div className="grid grid-cols-2 gap-1">
                  {pool.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTeamId(t.id)}
                      disabled={scenario.forceLowestPrestige}
                      aria-pressed={teamId === t.id}
                      className={cn(
                        'motion flex items-center gap-2 rounded-[var(--r-sm)] px-2 py-1.5 text-left',
                        scenario.forceLowestPrestige && 'cursor-not-allowed opacity-60',
                        teamId === t.id ? 'bg-surface-3 ring-1 ring-line-strong' : 'hover:bg-surface-3',
                      )}
                    >
                      <TeamCrest team={t} size={22} />
                      <span className="truncate font-cond text-small font-600 text-ink">{t.name}</span>
                    </button>
                  ))}
                </div>
              </div>
              <p className="mb-5 text-label leading-relaxed text-muted">
                You&rsquo;re unproven, so only the league&rsquo;s worst clubs will take a chance on you. Build your
                reputation and relationships, and better franchises will come calling for your next job.
              </p>

              <div
                className="mb-4 flex items-center gap-3 rounded-[var(--r-lg)] p-3"
                style={{ background: 'var(--team-fill)', color: 'var(--team-on)', boxShadow: 'var(--team-slab-ring)' }}
              >
                <TeamCrest team={selected} size={38} />
                <div>
                  <div className="font-cond text-label font-600 uppercase tracking-[0.07em] opacity-80">First Job</div>
                  <div className="font-display text-lg font-800 italic uppercase leading-none">{rung.title}</div>
                  <div className="font-cond text-small opacity-90">
                    {selected.city} {selected.name}
                  </div>
                </div>
                <div className="ml-auto text-right">
                  <div className="font-cond text-label font-600 uppercase tracking-[0.07em] opacity-80">First Contract</div>
                  <div className="font-display text-lg font-700 tnum">${(startSalary / 1000).toFixed(0)}k</div>
                </div>
              </div>

              <Button
                variant="primary"
                size="lg"
                className="w-full"
                icon={<Search size={16} aria-hidden />}
                onClick={() => selected && startCareer({ name, path, archetype, teamId: selected.id, startLevel: level, seed: seedValue ?? undefined, scenarioId })}
              >
                Begin: {scenario.title} <ArrowRight size={15} aria-hidden />
              </Button>

              <Button variant="quiet" size="sm" className="mt-3 w-full" onClick={() => setAdvanced((a) => !a)}>
                {advanced ? 'Hide advanced options' : 'Advanced: choose a starting level'}
              </Button>
            </Card>
          </div>
        </div>
      </div>
      <div className="pb-10 text-center text-label text-faint">
        Real team brands · ratings seeded from Madden NFL 26 · 32-club league sim
      </div>

      {/* Erasing the save is one-way: review it first. */}
      <ConfirmSheet
        open={freshOpen}
        onClose={() => setFreshOpen(false)}
        eyebrow="Save file"
        title="Start fresh?"
        subtitle="This erases the saved career on this device. It can't be undone."
        consequences={
          saveInfo
            ? [
                { label: 'Saved career', value: `${saveInfo.title} · ${saveInfo.teamName}` },
                { label: 'Season', value: `Season ${saveInfo.season} · ${saveInfo.tier}` },
                { label: 'What replaces it', value: 'Nothing — you begin again from the bottom', tone: 'warn' },
              ]
            : []
        }
        confirmLabel="Erase save"
        ledgerNote={null}
        onConfirm={() => {
          discardSave()
          setFreshOpen(false)
        }}
      />
    </div>
  )
}

/** One labelled line in the role-detail card. */
function RoleLine({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 shrink-0 text-[var(--team-accent)]">{icon}</span>
      <p className="text-small leading-relaxed text-ink-2">
        <strong className="font-600 text-ink">{title}:</strong> {body}
      </p>
    </div>
  )
}

/** Local salary lookup so the hub does not depend on career internals. */
function salaryForLevel(path: CareerPath, level: number): number {
  const coach = [40_000, 180_000, 600_000, 1_800_000, 6_500_000, 700_000, 2_200_000, 9_000_000]
  const personnel = [45_000, 85_000, 110_000, 145_000, 260_000, 430_000, 760_000, 1_200_000, 3_500_000]
  const arr = path === 'coach' ? coach : personnel
  return arr[Math.max(0, Math.min(arr.length - 1, level))]
}

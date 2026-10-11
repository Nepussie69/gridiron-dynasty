import { useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronDown, Download, Pencil, Play, Plus, Save, Search, Shield, Sparkles, Trash2, TriangleAlert, TrendingUp, Upload, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { NFL_TEAMS } from '../game/data/nflTeams'
import { minNflLevel, nflLadder, tierFor } from '../game/engine/career'
import { capabilities } from '../game/engine/capabilities'
import { SCENARIOS, scenarioById } from '../game/engine/scenarios'
import { parseSeedCode } from '../game/engine/seed'
import { SLOT_COUNT, type SlotView } from '../game/persistence'
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

/** Trigger a JSON download without leaving the page. */
function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

function savedStamp(ms: number): string {
  return ms > 0 ? new Date(ms).toLocaleString() : 'Not saved yet'
}

/** A slot's display name: its custom label, else "Slot N". */
function slotName(s: SlotView): string {
  const label = s.meta?.label?.trim()
  return label || `Slot ${s.slot}`
}

export function CareerHub() {
  const startCareer = useGame((s) => s.startCareer)
  const continueSlot = useGame((s) => s.continueSlot)
  const renameSlot = useGame((s) => s.renameSlot)
  const deleteSlot = useGame((s) => s.deleteSlot)
  const exportSlotText = useGame((s) => s.exportSlotText)
  const importSlotText = useGame((s) => s.importSlotText)
  const closeSaves = useGame((s) => s.closeSaves)
  const career = useGame((s) => s.career)
  const slots = useGame((s) => s.slots)
  const activeSlot = useGame((s) => s.activeSlot)
  const saveInfo = useGame((s) => s.saveInfo)
  const saveError = useGame((s) => s.saveError)
  const slotError = useGame((s) => s.slotError)
  const busy = useGame((s) => s.busy)
  const [name, setName] = useState('A. Reeves')
  const [path, setPath] = useState<CareerPath>('personnel')
  const [archetype, setArchetype] = useState('scout')
  const [advanced, setAdvanced] = useState(false)
  const [level, setLevel] = useState(minNflLevel('personnel'))
  const [teamId, setTeamId] = useState(pool[0].id)
  const [seedText, setSeedText] = useState('')
  const [scenarioId, setScenarioId] = useState<ScenarioId>('climb')
  const [openRung, setOpenRung] = useState<number | null>(null)
  const [targetSlot, setTargetSlot] = useState<number | null>(slots.find((s) => !s.occupied)?.slot ?? null)
  const [renaming, setRenaming] = useState<number | null>(null)
  const [renameText, setRenameText] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [confirmImport, setConfirmImport] = useState<{ slot: number; text: string } | null>(null)

  const seedValue = parseSeedCode(seedText)
  const seedInvalid = seedText.trim() !== '' && seedValue === null
  const selected = pool.find((t) => t.id === teamId) ?? pool[0]
  const ladder = nflLadder(path)
  const rung = tierFor(path, level)
  const startSalary = salaryForLevel(path, level)
  const scenario = scenarioById(scenarioId)
  const scenarioLocked = scenarioId !== 'climb'
  // Always show every slot, even before hydrate has read them.
  const slotRows: SlotView[] = slots.length ? slots : Array.from({ length: SLOT_COUNT }, (_, i) => ({ slot: i + 1, occupied: false, meta: null }))
  const allFull = slotRows.every((s) => s.occupied)
  // The New Career target: the chosen empty slot, or the first empty one if the
  // chosen slot is gone/filled. Derived during render — no effect needed.
  const firstEmpty = slotRows.find((s) => !s.occupied)?.slot ?? null
  const targetOccupied = targetSlot !== null && slotRows.some((s) => s.slot === targetSlot && s.occupied)
  const effectiveTargetSlot = targetSlot === null || targetOccupied ? firstEmpty : targetSlot
  const deleting = confirmDelete !== null ? slotRows.find((s) => s.slot === confirmDelete) ?? null : null
  const importing = confirmImport ? slotRows.find((s) => s.slot === confirmImport.slot) ?? null : null

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

  async function begin() {
    if (!selected || effectiveTargetSlot === null || busy) return
    // startCareer commits the current career's autosave and claims the target
    // slot atomically (never overwrites an occupied slot); it reports its own failure.
    await startCareer({
      name,
      path,
      archetype,
      teamId: selected.id,
      startLevel: level,
      seed: seedValue ?? undefined,
      scenarioId,
      slot: effectiveTargetSlot,
    })
  }

  function newCareerIn(slot: number) {
    setTargetSlot(slot)
    document.getElementById('hub-new-career')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function startRename(s: SlotView) {
    setRenaming(s.slot)
    setRenameText(slotName(s))
  }

  async function commitRename(slot: number) {
    await renameSlot(slot, renameText)
    setRenaming(null)
  }

  async function doExport(slot: number) {
    const text = await exportSlotText(slot)
    if (!text) return
    downloadText(text, `gridiron-slot${slot}-save.json`)
  }

  async function doImport(slot: number, file: File | undefined) {
    if (!file) return
    const text = await file.text()
    // Overwriting an occupied slot is reviewed first; an empty slot imports directly.
    if (slotRows.find((s) => s.slot === slot)?.occupied) setConfirmImport({ slot, text })
    else await importSlotText(text, slot)
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-[1240px] px-6 py-10">
        {career && (
          <div className="mx-auto mb-4 max-w-[860px]">
            <Button variant="secondary" size="sm" icon={<ArrowLeft size={14} aria-hidden />} onClick={closeSaves}>
              Back to your career
            </Button>
          </div>
        )}

        {(slotError || saveError) && (
          <div className="mx-auto mb-4 flex max-w-[860px] items-start gap-2 rounded-[var(--r-lg)] border border-warn/30 bg-warn-soft p-3 text-small text-warn">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
            <span>{slotError ?? saveError}</span>
          </div>
        )}

        {/* Save slots lead the page: load a career, or start a new one in an empty slot. */}
        <section aria-labelledby="hub-saves" className="mx-auto mb-8 max-w-[860px] rounded-[var(--r-lg)] border border-line-strong bg-surface p-5 shadow-[var(--shadow-1)]">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="hub-saves" className="font-display text-xl font-800 italic uppercase leading-none text-ink">
              Career Saves
            </h2>
            <span className="font-cond text-label font-700 uppercase tracking-[0.06em] text-muted">
              {slotRows.filter((s) => s.occupied).length} / {SLOT_COUNT} used · each slot autosaves separately
            </span>
          </div>

          <div className="space-y-2">
            {slotRows.map((s) => {
              const isActive = s.slot === activeSlot
              const isLive = isActive && !!career
              return s.occupied ? (
                <div
                  key={s.slot}
                  data-slot={s.slot}
                  className={cn('rounded-[var(--r-md)] border p-3', isActive ? 'border-line-strong bg-surface-2' : 'border-line')}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--r-md)] bg-slab font-display text-lg font-800 text-on-slab">
                      {s.slot}
                    </span>
                    <div className="min-w-0 flex-1">
                      {renaming === s.slot ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            aria-label={`Name for slot ${s.slot}`}
                            value={renameText}
                            // Focus + preselect once on open so typing replaces the old name.
                            ref={(el) => {
                              if (el && document.activeElement !== el) {
                                el.focus()
                                el.select()
                              }
                            }}
                            maxLength={28}
                            onChange={(e) => setRenameText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void commitRename(s.slot)
                              if (e.key === 'Escape') setRenaming(null)
                            }}
                            className="min-w-0 flex-1 rounded-[var(--r-sm)] border border-line-strong bg-surface px-2 py-1 text-[16px] font-600 text-ink outline-none focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]"
                          />
                          <IconAction label="Save name" onClick={() => void commitRename(s.slot)} icon={<Check size={16} aria-hidden />} />
                          <IconAction label="Cancel rename" onClick={() => setRenaming(null)} icon={<X size={16} aria-hidden />} />
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate font-display text-base font-800 italic uppercase leading-none text-ink">
                            Save {s.slot}
                            {slotName(s) !== `Slot ${s.slot}` ? ` · ${slotName(s)}` : ''}
                          </span>
                          {isActive && <Badge tone="win">{isLive ? 'Playing' : 'Last played'}</Badge>}
                          {s.meta?.recoveredAt ? <Badge tone="warn">Recovered</Badge> : null}
                        </div>
                      )}
                      <div className="mt-1 truncate font-cond text-small font-600 text-ink-2">
                        {s.meta?.managerName || 'Unknown manager'}
                        {s.meta?.roleTitle ? ` · ${s.meta.roleTitle}` : ''}
                      </div>
                      <div className="truncate font-cond text-small text-muted">
                        {s.meta?.teamName || '—'} · Season {s.meta?.season ?? '—'} · Week {s.meta?.week ?? '—'}
                      </div>
                      <div className="text-label text-muted">Saved {savedStamp(s.meta?.savedAt ?? 0)}</div>
                    </div>
                    <Button
                      variant="primary"
                      size="md"
                      className="max-sm:w-full"
                      disabled={busy}
                      icon={<Play size={14} aria-hidden />}
                      onClick={() => (isLive ? closeSaves() : void continueSlot(s.slot))}
                    >
                      {isLive ? `Resume ${s.slot}` : `Load ${s.slot}`}
                    </Button>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5 sm:pl-[52px]">
                    <SlotAction onClick={() => startRename(s)} icon={<Pencil size={12} aria-hidden />} label="Rename" />
                    <SlotAction onClick={() => void doExport(s.slot)} icon={<Download size={12} aria-hidden />} label="Export" />
                    <label className={SLOT_ACTION}>
                      <Upload size={12} aria-hidden /> Import
                      <input
                        type="file"
                        accept="application/json"
                        className="sr-only"
                        onChange={(e) => {
                          void doImport(s.slot, e.target.files?.[0])
                          e.target.value = ''
                        }}
                      />
                    </label>
                    <SlotAction onClick={() => setConfirmDelete(s.slot)} icon={<Trash2 size={12} aria-hidden />} label="Delete" danger />
                  </div>
                </div>
              ) : (
                <div key={s.slot} data-slot={s.slot} className="flex flex-wrap items-center gap-3 rounded-[var(--r-md)] border border-dashed border-line p-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--r-md)] bg-surface-3 font-display text-lg font-800 text-muted">
                    {s.slot}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-base font-800 italic uppercase leading-none text-ink-2">Save {s.slot}</div>
                    <div className="mt-1 text-small text-muted">Empty</div>
                  </div>
                  <label className={SLOT_ACTION}>
                    <Upload size={12} aria-hidden /> Import
                    <input
                      type="file"
                      accept="application/json"
                      className="sr-only"
                      onChange={(e) => {
                        void doImport(s.slot, e.target.files?.[0])
                        e.target.value = ''
                      }}
                    />
                  </label>
                  <Button
                    variant={effectiveTargetSlot === s.slot ? 'primary' : 'secondary'}
                    size="md"
                    className="max-sm:w-full"
                    disabled={busy}
                    icon={<Plus size={14} aria-hidden />}
                    onClick={() => newCareerIn(s.slot)}
                  >
                    New career in Save {s.slot}
                  </Button>
                </div>
              )
            })}
          </div>
          {allFull && (
            <p className="mt-3 text-small text-muted">All {SLOT_COUNT} slots are full. Delete one to start a new career.</p>
          )}
          {saveInfo?.usedBackup && (
            <p className="mt-3 flex items-center gap-1.5 text-small text-warn">
              <Save size={14} aria-hidden /> Your last career was recovered from its backup.
            </p>
          )}
        </section>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[1.05fr_1fr]">
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
              <div id="hub-new-career" className="mb-1 flex scroll-mt-4 items-center justify-between gap-2">
                <div className="label">New Career</div>
                {effectiveTargetSlot !== null && <Badge tone="neutral">Saves to Save {effectiveTargetSlot}</Badge>}
              </div>
              <h2 className="mb-5 font-display text-2xl font-800 italic uppercase leading-none tracking-[0.01em] text-ink">
                Build Your Resumé
              </h2>

              <label className="label mb-1 block" htmlFor="hub-name">Your Name</label>
              <input
                id="hub-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mb-5 w-full rounded-[var(--r-md)] border border-line-strong bg-surface-2 px-3 py-2 text-[16px] font-600 max-sm:h-11 text-ink outline-none focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]"
              />

              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="label">Track</span>
                {scenarioLocked && <span className="font-cond text-label font-700 uppercase tracking-[0.06em] text-muted">Set by scenario</span>}
              </div>
              <div className="mb-5">
                <SegmentedControl
                  label="Career track"
                  value={path}
                  disabled={scenarioLocked}
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
                        'motion flex items-center gap-2 rounded-[var(--r-sm)] px-2 py-1.5 text-left max-sm:min-h-11 pointer-coarse:min-h-11',
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

              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="label">Save to</span>
                <span className="font-cond text-label font-700 uppercase tracking-[0.06em] text-muted">Other slots are never touched</span>
              </div>
              <div className="mb-5 flex flex-wrap gap-1.5" role="group" aria-label="Save slot for the new career">
                {slotRows.map((s) => (
                  <button
                    key={s.slot}
                    type="button"
                    onClick={() => setTargetSlot(s.slot)}
                    disabled={s.occupied}
                    aria-pressed={effectiveTargetSlot === s.slot}
                    title={s.occupied ? `Slot ${s.slot} holds ${slotName(s)}. Delete it first to reuse it.` : `Start this career in slot ${s.slot}`}
                    className={cn(
                      'motion pointer-coarse:min-h-11 max-sm:min-h-11 rounded-[var(--r-sm)] border px-2.5 py-1 font-cond text-label font-700 uppercase tracking-[0.06em]',
                      s.occupied && 'cursor-not-allowed opacity-60',
                      effectiveTargetSlot === s.slot ? 'border-line-strong bg-surface-3 text-ink' : 'border-line text-muted hover:bg-surface-2',
                    )}
                  >
                    Save {s.slot}
                    {s.occupied ? ' · Used' : ''}
                  </button>
                ))}
              </div>

              <Button
                variant="primary"
                size="lg"
                className="w-full"
                icon={<Search size={16} aria-hidden />}
                disabled={busy || effectiveTargetSlot === null}
                onClick={() => void begin()}
              >
                {busy ? (
                  'Working…'
                ) : effectiveTargetSlot === null ? (
                  'All slots are full'
                ) : (
                  <>
                    Begin in Save {effectiveTargetSlot}: {scenario.title} <ArrowRight size={15} aria-hidden />
                  </>
                )}
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

      <ConfirmSheet
        open={deleting !== null}
        onClose={() => setConfirmDelete(null)}
        eyebrow={deleting ? `Save ${deleting.slot}` : 'Save slot'}
        title={deleting ? `Delete ${slotName(deleting)}?` : 'Delete this save?'}
        subtitle="Only this slot and its backup are removed. Your other slots are not touched. There is no undo."
        consequences={
          deleting
            ? [
                { label: 'Career', value: `${deleting.meta?.managerName || 'Unknown'} · ${deleting.meta?.teamName || '—'}` },
                { label: 'Season', value: `Season ${deleting.meta?.season ?? '—'} · Week ${deleting.meta?.week ?? '—'}` },
                { label: `Save ${deleting.slot}`, value: 'Erased', tone: 'loss' },
              ]
            : []
        }
        saferAlternative={deleting ? { label: 'Export it first', onClick: () => void doExport(deleting.slot) } : undefined}
        confirmLabel="Delete this save"
        ledgerNote={null}
        onConfirm={() => {
          if (confirmDelete !== null) void deleteSlot(confirmDelete)
          setConfirmDelete(null)
        }}
      />
      <ConfirmSheet
        open={confirmImport !== null}
        onClose={() => setConfirmImport(null)}
        eyebrow={importing ? `Save ${importing.slot}` : 'Import'}
        title={importing ? `Replace ${slotName(importing)}?` : 'Replace this save?'}
        subtitle="The imported file replaces the career in this slot and its backup. Other slots are not touched."
        consequences={
          importing
            ? [
                { label: 'Current career', value: `${importing.meta?.managerName || 'Unknown'} · ${importing.meta?.teamName || '—'}` },
                { label: `Save ${importing.slot}`, value: 'Replaced by the file', tone: 'loss' },
              ]
            : []
        }
        confirmLabel="Replace with file"
        ledgerNote={null}
        onConfirm={() => {
          const pending = confirmImport
          setConfirmImport(null)
          if (pending) void importSlotText(pending.text, pending.slot)
        }}
      />
    </div>
  )
}

const SLOT_ACTION =
  'motion inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-[var(--r-sm)] border border-line bg-surface px-2 font-cond text-label font-700 uppercase tracking-[0.06em] text-muted hover:text-ink focus-within:outline-2 focus-within:outline-[var(--color-focus)] pointer-coarse:min-h-11'

/** One small secondary action on a save slot card. */
function SlotAction({ onClick, icon, label, danger }: { onClick: () => void; icon: ReactNode; label: string; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn(SLOT_ACTION, danger && 'hover:text-loss')}>
      {icon} {label}
    </button>
  )
}

/** A compact icon-only action (rename confirm/cancel). */
function IconAction({ onClick, icon, label }: { onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className="motion grid h-8 w-8 place-items-center rounded-[var(--r-sm)] text-ink-2 hover:bg-surface-3 pointer-coarse:h-11 pointer-coarse:w-11">
      {icon}
    </button>
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

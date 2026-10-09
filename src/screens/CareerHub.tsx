import { useState, type ReactNode } from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  Pencil,
  Play,
  Search,
  Shield,
  Sparkles,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react'
import { cn } from '../lib/cn'
import { NFL_TEAMS } from '../game/data/nflTeams'
import { minNflLevel, nflLadder, tierFor } from '../game/engine/career'
import { capabilities } from '../game/engine/capabilities'
import { SCENARIOS, scenarioById } from '../game/engine/scenarios'
import { parseSeedCode } from '../game/engine/seed'
import { SLOT_COUNT, type SlotView } from '../game/persistence'
import type { CareerPath, ScenarioId } from '../game/types'
import { useGame } from '../store/gameStore'
import { Badge, Button, TeamCrest } from '../ui/kit'

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

export function CareerHub() {
  const startCareer = useGame((s) => s.startCareer)
  const continueCareer = useGame((s) => s.continueCareer)
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
  const [targetSlot, setTargetSlot] = useState<number | null>(slots.find((s) => !s.occupied)?.slot ?? null)
  const [renaming, setRenaming] = useState<number | null>(null)
  const [renameText, setRenameText] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)

  const seedValue = parseSeedCode(seedText)
  const seedInvalid = seedText.trim() !== '' && seedValue === null
  const selected = pool.find((t) => t.id === teamId) ?? pool[0]
  const ladder = nflLadder(path)
  const rung = tierFor(path, level)
  const startSalary = salaryForLevel(path, level)
  const scenario = scenarioById(scenarioId)
  const scenarioLocked = scenarioId !== 'climb'
  const allFull = slots.length > 0 && slots.every((s) => s.occupied)
  // The New Career target: the chosen empty slot, or the first empty one if the
  // chosen slot is gone/filled. Derived during render — no effect needed.
  const firstEmpty = slots.find((s) => !s.occupied)?.slot ?? null
  const targetOccupied = targetSlot !== null && slots.some((s) => s.slot === targetSlot && s.occupied)
  const effectiveTargetSlot = targetSlot === null || targetOccupied ? firstEmpty : targetSlot

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
    // slot atomically; it reports its own failure, so there is nothing to do here.
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

  function startRename(s: SlotView) {
    setRenaming(s.slot)
    setRenameText(s.meta?.label ?? `Slot ${s.slot}`)
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
    const occupied = slots.find((s) => s.slot === slot)?.occupied
    if (occupied) {
      const label = slots.find((s) => s.slot === slot)?.meta?.label ?? `Slot ${slot}`
      const ok = window.confirm(
        `Overwrite “${label}” in slot ${slot} with the imported file? This replaces that career and its backup.`,
      )
      if (!ok) return
    }
    await importSlotText(text, slot)
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto grid max-w-[1240px] grid-cols-[minmax(0,1fr)] gap-8 px-6 py-10 lg:grid-cols-[1.05fr_1fr]">
        {/* Hero */}
        <div>
          <div className="mb-6 flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-ink text-canvas">
              <Shield size={24} strokeWidth={2.4} />
            </div>
            <div>
              <div className="font-display text-3xl font-700 uppercase leading-none tracking-wide">
                Gridiron <span className="text-brand">Dynasty</span>
              </div>
              <div className="label mt-1">Front Office Football Career</div>
            </div>
          </div>

          <h1 className="font-display text-5xl font-700 uppercase leading-[0.95] tracking-tight text-ink">
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

          <div className="mt-6 flex rounded-lg bg-surface-2 p-0.5">
            {(['personnel', 'coach'] as CareerPath[]).map((p) => (
              <button
                key={p}
                onClick={() => choosePath(p)}
                className={cn(
                  'flex-1 rounded-md px-3 py-2 font-cond text-xs font-700 uppercase tracking-wide transition',
                  path === p ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink-2',
                )}
              >
                {p === 'coach' ? 'Coaching Ladder' : 'Personnel Ladder'}
              </button>
            ))}
          </div>

          <div className="mt-4 space-y-2">
            {ladder.map((r, i) => {
              const active = r.level === level
              const d = roleDetail(path, r.level)
              const unlocks = unlocksFor(path, r.level)
              return (
                <div key={r.level} className={cn('overflow-hidden rounded-xl border shadow-[0_1px_2px_rgba(10,22,38,0.05)]', active ? 'border-[var(--team)] ring-1 ring-[var(--team)]' : 'border-line')}>
                  <button
                    type="button"
                    onClick={() => setLevel(active ? -1 : r.level)}
                    aria-expanded={active}
                    className={cn(
                      'flex w-full items-center gap-4 p-3 text-left transition',
                      active ? 'bg-surface' : 'bg-surface hover:bg-surface-2',
                    )}
                  >
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink font-display text-base font-700 text-canvas">
                      {i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-base font-700 uppercase leading-none text-ink">{r.title}</div>
                      <div className="mt-0.5 font-cond text-xs text-muted">{r.blurb}</div>
                    </div>
                    <Badge tone="loss">NFL</Badge>
                    <ChevronDown size={16} className={cn('shrink-0 text-faint transition-transform', active && 'rotate-180')} />
                  </button>

                  {active && d.does && (
                    <div className="space-y-2.5 border-t border-line bg-surface-2 p-3.5">
                      <RoleLine icon={<Search size={13} />} title="What you do" body={d.does} />
                      <RoleLine icon={<Shield size={13} />} title="What you control" body={d.controls} />
                      <RoleLine icon={<TrendingUp size={13} />} title="How you get promoted" body={d.promo} />
                      {unlocks.length > 0 && (
                        <div className="flex gap-2.5">
                          <span className="mt-0.5 shrink-0 text-[var(--team)]">
                            <Sparkles size={13} />
                          </span>
                          <div className="text-xs leading-relaxed text-ink-2">
                            <strong className="font-600 text-ink">What you unlock:</strong>{' '}
                            <span className="flex flex-wrap gap-1.5 pt-1.5">
                              {unlocks.map((u) => (
                                <span key={u} className="rounded-md bg-[var(--team-soft)] px-1.5 py-0.5 font-cond text-[11px] font-700 uppercase tracking-wide text-[var(--team)]">
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

          <div className="mt-6 flex items-center gap-2 rounded-xl bg-brand-soft p-3.5 text-sm text-brand">
            <Shield size={18} />
            <span>
              <strong className="font-600">One living league:</strong> the prospects you grade today become
              tomorrow's NFL stars. Reputation is earned, not given.
            </span>
          </div>
        </div>

        {/* Slots + setup */}
        <div className="space-y-4">
          {career && (
            <button
              onClick={closeSaves}
              className="motion flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 font-cond text-xs font-700 uppercase tracking-wide text-muted hover:text-ink-2"
            >
              ← Back to your career
            </button>
          )}

          {(slotError || saveError) && (
            <div className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn-soft p-3 text-xs text-warn">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" />
              <span>{slotError ?? saveError}</span>
            </div>
          )}

          {/* Save slots */}
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-[0_8px_30px_rgba(10,22,38,0.08)]">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="label">Career Saves</div>
              <span className="font-cond text-[10px] font-700 uppercase tracking-wide text-faint">
                {slots.filter((s) => s.occupied).length} / {SLOT_COUNT} used
              </span>
            </div>

            <div className="space-y-2.5">
              {(slots.length ? slots : Array.from({ length: SLOT_COUNT }, (_, i) => ({ slot: i + 1, occupied: false, meta: null }))).map((s) =>
                s.occupied ? (
                  <div
                    key={s.slot}
                    className={cn(
                      'rounded-xl border p-3',
                      s.slot === activeSlot ? 'border-[var(--team)] ring-1 ring-[var(--team)]' : 'border-line',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ink font-display text-sm font-700 text-canvas">
                        {s.slot}
                      </span>
                      {renaming === s.slot ? (
                        <div className="flex min-w-0 flex-1 items-center gap-1.5">
                          <input
                            value={renameText}
                            autoFocus
                            maxLength={28}
                            onChange={(e) => setRenameText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void commitRename(s.slot)
                              if (e.key === 'Escape') setRenaming(null)
                            }}
                            className="min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2 py-1 font-cond text-sm font-600 text-ink outline-none focus:border-[var(--team)]"
                          />
                          <button onClick={() => void commitRename(s.slot)} title="Save name" className="text-[var(--team)]">
                            <Check size={16} />
                          </button>
                          <button onClick={() => setRenaming(null)} title="Cancel" className="text-muted">
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-display text-base font-700 uppercase leading-none text-ink">
                            {s.meta?.label ?? `Slot ${s.slot}`}
                          </div>
                        </div>
                      )}
                      {s.slot === activeSlot && <Badge tone="win">Active</Badge>}
                      {s.meta?.recoveredAt ? <Badge tone="warn">Recovered</Badge> : null}
                    </div>

                    <div className="mt-2 space-y-0.5 pl-9">
                      <div className="font-cond text-xs font-600 text-ink-2">
                        {s.meta?.managerName || 'Unknown manager'}
                        {s.meta?.roleTitle ? ` · ${s.meta.roleTitle}` : ''}
                      </div>
                      <div className="font-cond text-[11px] text-muted">
                        {s.meta?.teamName || '—'} · Season {s.meta?.season ?? '—'} · Week {s.meta?.week ?? '—'}
                      </div>
                      <div className="text-[11px] text-faint">Saved {savedStamp(s.meta?.savedAt ?? 0)}</div>
                    </div>

                    <div className="mt-2.5 flex flex-wrap gap-1.5 pl-9">
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={busy}
                        onClick={() => (s.slot === activeSlot && career ? closeSaves() : void continueSlot(s.slot))}
                      >
                        <Play size={13} /> {s.slot === activeSlot && career ? 'Resume' : 'Continue'}
                      </Button>
                      <SlotAction onClick={() => startRename(s)} icon={<Pencil size={12} />} label="Rename" />
                      <SlotAction onClick={() => void doExport(s.slot)} icon={<Download size={12} />} label="Export" />
                      <label className="motion inline-flex cursor-pointer items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 font-cond text-[10px] font-700 uppercase tracking-wide text-muted hover:text-ink-2">
                        <Upload size={12} /> Import
                        <input
                          type="file"
                          accept="application/json"
                          className="hidden"
                          onChange={(e) => {
                            void doImport(s.slot, e.target.files?.[0])
                            e.target.value = ''
                          }}
                        />
                      </label>
                      <SlotAction
                        onClick={() => setConfirmDelete(s.slot)}
                        icon={<Trash2 size={12} />}
                        label="Delete"
                        danger
                      />
                    </div>

                    {confirmDelete === s.slot && (
                      <div className="mt-2.5 ml-9 rounded-lg border border-loss/30 bg-loss-soft p-2.5 text-[11px] text-ink-2">
                        <div>
                          Delete <strong>“{s.meta?.label ?? `Slot ${s.slot}`}”</strong> (
                          {s.meta?.managerName || 'this career'})? Only slot {s.slot} and its backup are removed.
                        </div>
                        <div className="mt-2 flex gap-1.5">
                          <button
                            onClick={() => {
                              void deleteSlot(s.slot)
                              setConfirmDelete(null)
                            }}
                            className="rounded-md bg-loss px-2 py-1 font-cond text-[10px] font-700 uppercase tracking-wide text-white"
                          >
                            Delete career
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="rounded-md border border-line px-2 py-1 font-cond text-[10px] font-700 uppercase tracking-wide text-muted"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div key={s.slot} className="flex items-center gap-3 rounded-xl border border-dashed border-line p-3">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-2 font-display text-sm font-700 text-muted">
                      {s.slot}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-cond text-sm font-700 uppercase text-ink-2">Slot {s.slot}</div>
                      <div className="text-[11px] text-faint">Empty</div>
                    </div>
                    <Button
                      variant={effectiveTargetSlot === s.slot ? 'primary' : 'default'}
                      size="sm"
                      onClick={() => setTargetSlot(s.slot)}
                    >
                      {effectiveTargetSlot === s.slot ? 'Selected' : 'New Career'}
                    </Button>
                  </div>
                ),
              )}
            </div>
          </div>

          {/* Recent continue card (landing) */}
          {saveInfo && !career && (
            <button
              onClick={continueCareer}
              className="flex w-full items-center gap-3 rounded-2xl border border-[var(--team)] bg-surface p-4 text-left shadow-[0_8px_30px_rgba(10,22,38,0.08)]"
            >
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ink text-canvas">
                <Play size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="label">Most recent</div>
                <div className="truncate font-display text-lg font-700 uppercase leading-none text-ink">{saveInfo.title}</div>
                <div className="mt-0.5 truncate font-cond text-xs text-muted">
                  {saveInfo.teamName} · Season {saveInfo.season} · {saveInfo.tier}
                </div>
              </div>
              <ArrowRight size={18} className="shrink-0 text-[var(--team)]" />
            </button>
          )}

          {/* New career setup */}
          {allFull ? (
            <div className="rounded-2xl border border-line bg-surface p-5 text-sm text-muted shadow-[0_8px_30px_rgba(10,22,38,0.08)]">
              All five slots are full. Continue a career above, or delete one to start a new one.
            </div>
          ) : (
            <div className="rounded-2xl border border-line bg-surface p-5 shadow-[0_8px_30px_rgba(10,22,38,0.08)]">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="label">New Career</div>
                <span className="font-cond text-[10px] font-700 uppercase tracking-wide text-faint">
                  {effectiveTargetSlot !== null ? `Slot ${effectiveTargetSlot}` : 'Choose a slot'}
                </span>
              </div>
              <h2 className="mb-5 font-display text-2xl font-700 uppercase tracking-wide">Build Your Resumé</h2>

              <label className="label mb-1 block">Your Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mb-5 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-cond text-base font-600 text-ink outline-none focus:border-[var(--team)]"
              />

              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="label">Track</span>
                {scenarioLocked && <span className="font-cond text-[10px] font-700 uppercase tracking-wide text-muted">Set by scenario</span>}
              </div>
              <div className="mb-5 grid grid-cols-2 gap-2">
                {(['personnel', 'coach'] as CareerPath[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => choosePath(p)}
                    disabled={scenarioLocked}
                    className={cn(
                      'rounded-lg border px-3 py-2.5 text-left transition',
                      scenarioLocked && 'cursor-not-allowed opacity-60',
                      path === p ? 'border-transparent bg-ink text-canvas' : 'border-line bg-surface-2 text-ink hover:border-line-strong',
                    )}
                  >
                    <div className="font-display text-base font-700 uppercase leading-none">
                      {p === 'coach' ? 'Coaching' : 'Personnel'}
                    </div>
                    <div className={cn('mt-1 text-[11px]', path === p ? 'text-white/70' : 'text-muted')}>
                      {p === 'coach' ? 'On-field → GM' : 'Scout → GM'}
                    </div>
                  </button>
                ))}
              </div>

              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="label">Scenario</span>
                {scenarioLocked && <span className="font-cond text-[10px] font-700 uppercase tracking-wide text-muted">Set by scenario</span>}
              </div>
              <div className="mb-1.5 space-y-1.5">
                {SCENARIOS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => chooseScenario(s.id)}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-lg border p-2.5 text-left transition',
                      scenarioId === s.id ? 'border-[var(--team)] bg-[var(--team-soft)]' : 'border-line hover:bg-surface-2',
                    )}
                  >
                    <div className={cn('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border', scenarioId === s.id ? 'border-[var(--team)]' : 'border-line-strong')}>
                      {scenarioId === s.id && <span className="h-2 w-2 rounded-full" style={{ background: 'var(--team)' }} />}
                    </div>
                    <div>
                      <div className="font-cond text-sm font-700 uppercase text-ink">{s.title}</div>
                      <div className="text-xs text-muted">{s.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
              <p className="mb-5 text-[11px] leading-relaxed text-muted">
                Scenarios skip the climb — the Standard Climb is the intended way to play.
              </p>

              <div className="label mb-1.5">Archetype</div>
              <div className="mb-5 space-y-1.5">
                {ARCHETYPES[path].map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setArchetype(a.id)}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-lg border p-2.5 text-left transition',
                      archetype === a.id ? 'border-[var(--team)] bg-[var(--team-soft)]' : 'border-line hover:bg-surface-2',
                    )}
                  >
                    <div className={cn('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border', archetype === a.id ? 'border-[var(--team)]' : 'border-line-strong')}>
                      {archetype === a.id && <span className="h-2 w-2 rounded-full" style={{ background: 'var(--team)' }} />}
                    </div>
                    <div>
                      <div className="font-cond text-sm font-700 uppercase text-ink">{a.name}</div>
                      <div className="text-xs text-muted">{a.desc}</div>
                    </div>
                  </button>
                ))}
              </div>

              {advanced && (
                <>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <span className="label">Starting Level (advanced)</span>
                    {scenarioLocked && <span className="font-cond text-[10px] font-700 uppercase tracking-wide text-muted">Set by scenario</span>}
                  </div>
                  <div className="mb-4 flex flex-wrap gap-1.5">
                    {ladder.map((r) => (
                      <button
                        key={r.level}
                        onClick={() => setLevel(r.level)}
                        disabled={scenarioLocked}
                        className={cn(
                          'rounded-md border px-2 py-1 font-cond text-[11px] font-700 uppercase transition',
                          scenarioLocked && 'cursor-not-allowed opacity-60',
                          level === r.level ? 'border-transparent text-[var(--team-ink)]' : 'border-line text-muted hover:bg-surface-2',
                        )}
                        style={level === r.level ? { background: 'var(--team)' } : undefined}
                      >
                        {r.title}
                      </button>
                    ))}
                  </div>

                  <div className="label mb-1.5">World seed</div>
                  <input
                    value={seedText}
                    onChange={(e) => setSeedText(e.target.value)}
                    placeholder="Blank = random"
                    className="mb-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-cond text-sm font-600 text-ink outline-none focus:border-[var(--team)]"
                  />
                  <p className="text-[11px] leading-relaxed text-muted">Same seed → same league. Leave blank for random.</p>
                  {seedInvalid && (
                    <p className="mt-1 text-[11px] font-600 text-loss">That seed isn&apos;t valid.</p>
                  )}
                </>
              )}

              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="label">Choose Your Franchise</span>
                <span className="font-cond text-[10px] font-700 uppercase tracking-wide text-muted">
                  {scenario.forceLowestPrestige ? 'Set by scenario' : 'Rebuild jobs · weakest clubs'}
                </span>
              </div>
              <div className="mb-2 max-h-[180px] overflow-y-auto rounded-lg border border-line bg-surface-2 p-2">
                <div className="grid grid-cols-2 gap-1">
                  {pool.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTeamId(t.id)}
                      disabled={scenario.forceLowestPrestige}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition',
                        scenario.forceLowestPrestige && 'cursor-not-allowed opacity-60',
                        teamId === t.id ? 'bg-surface shadow-sm ring-1 ring-[var(--team)]' : 'hover:bg-surface-2',
                      )}
                    >
                      <TeamCrest team={t} size={22} />
                      <span className="truncate font-cond text-xs font-600 text-ink">{t.name}</span>
                    </button>
                  ))}
                </div>
              </div>
              <p className="mb-5 text-[11px] leading-relaxed text-muted">
                You're unproven, so only the league's worst clubs will take a chance on you. Build your
                reputation and relationships, and better franchises will come calling for your next job.
              </p>

              <div
                className="mb-4 flex items-center gap-3 rounded-xl p-3"
                style={{ background: selected ? `linear-gradient(110deg, ${selected.primary}, ${selected.secondary})` : undefined }}
              >
                {selected && (
                  <>
                    <TeamCrest team={selected} size={38} />
                    <div className="text-white">
                      <div className="label !text-white/70">First Job</div>
                      <div className="font-display text-lg font-700 uppercase leading-none">{rung.title}</div>
                      <div className="font-cond text-xs text-white/80">
                        {selected.city} {selected.name}
                      </div>
                    </div>
                    <div className="ml-auto text-right text-white">
                      <div className="label !text-white/70">First Contract</div>
                      <div className="font-display text-lg font-700 tnum">${(startSalary / 1000).toFixed(0)}k</div>
                    </div>
                  </>
                )}
              </div>

              <Button
                variant="primary"
                size="lg"
                className="w-full"
                disabled={busy || effectiveTargetSlot === null}
                onClick={() => void begin()}
              >
                <Search size={16} /> {busy ? 'Working…' : <>Begin in Slot {effectiveTargetSlot ?? '—'} <ArrowRight size={15} /></>}
              </Button>

              <button
                onClick={() => setAdvanced((a) => !a)}
                className="mt-3 w-full text-center font-cond text-xs font-600 uppercase tracking-wide text-muted hover:text-ink-2"
              >
                {advanced ? 'Hide advanced options' : 'Advanced: choose a starting level'}
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="pb-10 text-center text-xs text-faint">
        Real team brands · ratings seeded from Madden NFL 26 · 32-club league sim
      </div>
    </div>
  )
}

/** One small secondary action on a save slot card. */
function SlotAction({
  onClick,
  icon,
  label,
  danger,
}: {
  onClick: () => void
  icon: ReactNode
  label: string
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'motion inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 font-cond text-[10px] font-700 uppercase tracking-wide',
        danger ? 'text-muted hover:text-loss' : 'text-muted hover:text-ink-2',
      )}
    >
      {icon} {label}
    </button>
  )
}

/** One labelled line in the role-detail card. */
function RoleLine({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 shrink-0 text-[var(--team)]">{icon}</span>
      <p className="text-xs leading-relaxed text-ink-2">
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

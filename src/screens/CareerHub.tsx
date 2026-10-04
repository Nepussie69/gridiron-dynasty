import { useState } from 'react'
import { ArrowRight, GraduationCap, Play, Search, Shield, TriangleAlert, TrendingUp } from 'lucide-react'
import { cn } from '../lib/cn'
import { CFB_TEAMS } from '../game/data/cfbTeams'
import { NFL_TEAMS } from '../game/data/nflTeams'
import { ladderFor, tierFor } from '../game/engine/career'
import type { CareerPath, LeagueTier } from '../game/types'
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

const FBS = CFB_TEAMS.filter((t) => t.tier === 'FBS')

function poolFor(path: CareerPath, level: number) {
  const tier: LeagueTier = tierFor(path, level).tier
  if (tier === 'NFL') return NFL_TEAMS
  if (level <= 1) return FBS.filter((t) => t.prestige <= 74) // small programs
  return FBS
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
  const [level, setLevel] = useState(0)
  const [teamId, setTeamId] = useState('Toledo')

  const pool = poolFor(path, level)
  const selected = pool.find((t) => t.id === teamId) ?? pool[0]
  const ladder = ladderFor(path)
  const rung = tierFor(path, level)

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto grid max-w-[1240px] gap-8 px-6 py-10 lg:grid-cols-[1.05fr_1fr]">
        {/* Hero */}
        <div>
          <div className="mb-6 flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-ink text-white">
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
            Start at the bottom.
            <br />
            <span className="text-brand">Run an NFL franchise.</span>
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted">
            You begin as a grad assistant or local scout making {path === 'coach' ? '$40k' : '$45k'}.
            Four reputations and your skills decide how fast you rise: <strong>Evaluation</strong>,
            <strong> Roster Building</strong>, <strong>Leadership</strong>, <strong>Results</strong>, and
            <strong> Profile</strong>. Excel and choose the right programs, and you skip rungs. Stumble,
            and you can be fired and drop back down. The endpoint is the same:{' '}
            <strong>General Manager</strong>.
          </p>

          <div className="mt-6 flex rounded-lg bg-surface-2 p-0.5">
            {(['personnel', 'coach'] as CareerPath[]).map((p) => (
              <button
                key={p}
                onClick={() => { setPath(p); setLevel(0); setArchetype(ARCHETYPES[p][0].id); setTeamId(poolFor(p, 0)[0]?.id ?? teamId) }}
                className={cn(
                  'flex-1 rounded-md px-3 py-2 font-cond text-xs font-700 uppercase tracking-wide transition',
                  path === p ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink-2',
                )}
              >
                {p === 'coach' ? 'Coaching Ladder' : 'Personnel Ladder'}
              </button>
            ))}
          </div>

          <div className="mt-4 space-y-2">
            {ladder.map((r, i) => (
              <div
                key={r.level}
                className={cn(
                  'flex items-center gap-4 rounded-xl border p-3 shadow-[0_1px_2px_rgba(10,22,38,0.05)]',
                  i === level ? 'border-[var(--team)] bg-surface' : 'border-line bg-surface',
                )}
              >
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink font-display text-base font-700 text-white">
                  {i}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-base font-700 uppercase leading-none text-ink">{r.title}</div>
                  <div className="mt-0.5 font-cond text-xs text-muted">{r.blurb}</div>
                </div>
                <Badge tone={r.tier === 'NFL' ? 'loss' : 'info'}>{r.tier}</Badge>
                <TrendingUp size={16} className="text-faint" />
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-2 rounded-xl bg-[#e7efff] p-3.5 text-sm text-brand">
            <GraduationCap size={18} />
            <span>
              <strong className="font-600">One living universe:</strong> the prospects you grade today become
              tomorrow's NFL stars. Reputation is earned, not given.
            </span>
          </div>
        </div>

        {/* Setup card */}
        <div className="space-y-4">
          {saveInfo && (
            <div className="rounded-2xl border border-[var(--team)] bg-surface p-5 shadow-[0_8px_30px_rgba(10,22,38,0.08)]">
              <div className="mb-3 flex items-center justify-between">
                <div className="label">Continue Career</div>
                {saveInfo.usedBackup && <Badge tone="warn">Recovered from backup</Badge>}
              </div>
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-ink text-white">
                  <Play size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-xl font-700 uppercase leading-none text-ink">
                    {saveInfo.title}
                  </div>
                  <div className="mt-0.5 font-cond text-xs text-muted">
                    {saveInfo.teamName} · Season {saveInfo.season} · {saveInfo.tier}
                  </div>
                  {saveInfo.savedAt > 0 && (
                    <div className="mt-0.5 text-[11px] text-faint">
                      Saved {new Date(saveInfo.savedAt).toLocaleString()}
                    </div>
                  )}
                </div>
              </div>
              <Button variant="primary" size="lg" className="mt-3 w-full" onClick={continueCareer}>
                <Play size={16} /> Continue
              </Button>
              <button
                onClick={discardSave}
                className="mt-2 w-full text-center font-cond text-xs font-600 uppercase tracking-wide text-muted hover:text-loss"
              >
                Start fresh (erase this save)
              </button>
            </div>
          )}

          {saveError && !saveInfo && (
            <div className="flex items-start gap-2 rounded-xl border border-[#f3ddb8] bg-[#fdf0dc] p-3 text-xs text-warn">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" />
              <span>{saveError}</span>
            </div>
          )}

          <div className="rounded-2xl border border-line bg-surface p-5 shadow-[0_8px_30px_rgba(10,22,38,0.08)]">
            <div className="label mb-1">New Career</div>
          <h2 className="mb-5 font-display text-2xl font-700 uppercase tracking-wide">Build Your Resumé</h2>

          <label className="label mb-1 block">Your Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mb-5 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-cond text-base font-600 text-ink outline-none focus:border-[var(--team)]"
          />

          <div className="label mb-1.5">Track</div>
          <div className="mb-5 grid grid-cols-2 gap-2">
            {(['personnel', 'coach'] as CareerPath[]).map((p) => (
              <button
                key={p}
                onClick={() => {
                  setPath(p)
                  setArchetype(ARCHETYPES[p][0].id)
                }}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-left transition',
                  path === p ? 'border-transparent bg-ink text-white' : 'border-line bg-surface-2 text-ink hover:border-line-strong',
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
              <div className="label mb-1.5">Starting Level (advanced)</div>
              <div className="mb-4 flex flex-wrap gap-1.5">
                {ladder.map((r) => (
                  <button
                    key={r.level}
                    onClick={() => {
                      setLevel(r.level)
                      const np = poolFor(path, r.level)
                      setTeamId(np[0]?.id ?? teamId)
                    }}
                    className={cn(
                      'rounded-md border px-2 py-1 font-cond text-[11px] font-700 uppercase transition',
                      level === r.level ? 'border-transparent text-white' : 'border-line text-muted hover:bg-surface-2',
                    )}
                    style={level === r.level ? { background: 'var(--team)' } : undefined}
                  >
                    {r.title}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="label mb-1.5">
            {tierFor(path, level).tier === 'NFL' ? 'Choose Your Franchise' : level <= 1 ? 'Choose Your Small Program' : 'Choose Your Program'}
          </div>
          <div className="mb-5 max-h-[180px] overflow-y-auto rounded-lg border border-line bg-surface-2 p-2">
            <div className="grid grid-cols-2 gap-1">
              {pool.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTeamId(t.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition',
                    teamId === t.id ? 'bg-white shadow-sm ring-1 ring-[var(--team)]' : 'hover:bg-white/60',
                  )}
                >
                  <TeamCrest team={t} size={22} />
                  <span className="truncate font-cond text-xs font-600 text-ink">{t.name}</span>
                </button>
              ))}
            </div>
          </div>

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
                    {selected.tier === 'NFL' ? `${selected.city} ${selected.name}` : selected.name}
                  </div>
                </div>
                <div className="ml-auto text-right text-white">
                  <div className="label !text-white/70">Prestige</div>
                  <div className="font-display text-lg font-700 tnum">{selected.prestige}</div>
                </div>
              </>
            )}
          </div>

          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={() => selected && startCareer({ name, path, archetype, teamId: selected.id, startLevel: level })}
          >
            <Search size={16} /> Begin as {rung.title} <ArrowRight size={15} />
          </Button>

          <button
            onClick={() => setAdvanced((a) => !a)}
            className="mt-3 w-full text-center font-cond text-xs font-600 uppercase tracking-wide text-muted hover:text-ink-2"
          >
            {advanced ? 'Hide advanced options' : 'Advanced: choose a starting level'}
          </button>
          </div>
        </div>
      </div>
      <div className="pb-10 text-center text-xs text-faint">
        Real team brands · ratings seeded from Madden NFL 26 / College Football 26 · full career sim
      </div>
    </div>
  )
}

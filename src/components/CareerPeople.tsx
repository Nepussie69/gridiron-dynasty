import { useState } from 'react'
import { GraduationCap, Network, Trophy, Users } from 'lucide-react'
import { cn } from '../lib/cn'
import { contactIntel, philosophyLabel, rivalTitle } from '../game/engine/people'
import { WILDERNESS_PATHS, legacyCase } from '../game/engine/legacy'
import { traitOrigin } from '../game/engine/earnedTraits'
import { overallRep } from '../game/engine/career'
import { accessFor } from '../game/engine/access'
import { getAwards, getStatsDb, useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card, ConfirmSheet, RatingBar, TeamCrest } from '../ui/kit'
import { OwnerCard } from './OwnerCard'
import { OwnerMeetingCard } from './OwnerMeetingCard'

/** #9 contacts, #10 traits, #11 mentor + tree, #12 rival class, #17 wilderness, #19 legacy. */
export function CareerPeople() {
  const world = useWorld()
  const career = useGame((s) => s.career)!
  const chooseWilderness = useGame((s) => s.chooseWilderness)
  const startSuccessor = useGame((s) => s.startSuccessor)
  const poach = useGame((s) => s.poachAssistant)
  const [retiring, setRetiring] = useState(false)
  const [successorName, setSuccessorName] = useState('R. Hale')
  const contacts = career.contacts ?? []
  const tree = career.tree ?? []
  const traits = career.earnedTraits ?? []
  const canHireStaff = accessFor(career, 'staff') === 'decide'
  const myScore = overallRep(career.reputation)
  const myLevel = career.level
  const legacy = legacyCase(career, new Set(getAwards().inducted), getAwards(), getStatsDb())
  const legacyPct = Math.min(100, Math.round((legacy.score / legacy.threshold) * 100))

  const rivals = [...(world.rivals ?? [])].sort((a, b) => b.level - a.level || b.reputation - a.reputation)
  const ladder = [
    { id: 'you', name: career.gmName, level: myLevel, reputation: myScore, title: 'You', teamId: career.teamId, you: true },
    ...rivals.map((r) => ({ id: r.id, name: r.name, level: r.level, reputation: r.reputation, title: rivalTitle(r), teamId: r.teamId, you: false })),
  ].sort((a, b) => b.level - a.level || b.reputation - a.reputation)

  return (
    <div className="space-y-5">
      {career.wilderness && !career.wilderness.path && (
        <Card tier="call" callLabel="The Wilderness">
          <h3 className="mb-1 font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">The Wilderness</h3>
          <p className="mb-3 text-body text-muted">{career.wilderness.blurb}</p>
          <div className="space-y-2">
            {WILDERNESS_PATHS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => chooseWilderness(p.id)}
                className="motion min-h-11 w-full rounded-[var(--r-md)] border border-line p-2.5 text-left hover:border-line-strong hover:bg-surface-2"
              >
                <div className="font-cond text-body font-700 uppercase tracking-[0.02em] text-ink">{p.label}</div>
                <div className="text-small text-muted">{p.blurb}</div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* FUTURES 22: who you answer to, and how much rope you have. */}
      <OwnerCard />

      {/* FUTURES 25: the periodic sit-down with the owner. */}
      <OwnerMeetingCard />

      {career.mentor && (
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <GraduationCap size={16} className="text-muted" aria-hidden />
            <h3 className="font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">Your Mentor</h3>
            <Badge tone="neutral" className="ml-auto">{philosophyLabel(career.mentor.philosophy)}</Badge>
          </div>
          <div className="font-display text-lg font-800 italic uppercase leading-none text-ink">{career.mentor.name}</div>
          <div className="font-cond text-small text-muted">
            {world.byId[career.mentor.teamId]?.name ?? career.mentor.teamId} · your boss
          </div>
          <p className="mt-2 text-label leading-snug text-muted">
            A boss shapes what you learn. A {philosophyLabel(career.mentor.philosophy).toLowerCase()} mentor rubs off on how you build.
          </p>
        </Card>
      )}

      {traits.length > 0 && (
        <Card>
          <h3 className="mb-3 font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">Earned Traits</h3>
          <div className="space-y-2">
            {traits.map((t) => (
              <div key={t.id} className="rounded-[var(--r-md)] border border-line p-2.5">
                <div className="font-cond text-body font-700 uppercase tracking-[0.02em] text-ink">{t.name}</div>
                <div className="mt-0.5 text-small text-muted">{t.desc}</div>
                <div className="mt-1 font-cond text-label uppercase tracking-[0.06em] text-faint">Earned: {traitOrigin(t)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <Trophy size={16} className="text-gold" aria-hidden />
          <h3 className="font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">Legacy Case</h3>
          <Badge tone={legacy.inducted ? 'gold' : 'neutral'} className="ml-auto">
            {legacy.inducted ? 'Hall-worthy' : `${legacy.score}/${legacy.threshold}`}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center">
          <StatCell label="Rings" value={legacy.rings} />
          <StatCell label="Ledger Hits" value={legacy.ledgerHits} />
          <StatCell label="Guys in Canton" value={legacy.cantonPlayers} />
          <StatCell label="Coaching Tree" value={legacy.tree} />
          <StatCell label="Player Honours" value={legacy.honoursForYourPlayers} />
          <StatCell label="Ballot Finalists" value={legacy.finalistsYouFound} />
        </div>
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between font-cond text-label uppercase tracking-[0.07em] text-muted">
            <span>Progress to the Hall</span>
            <span className="tnum">{legacy.score}/{legacy.threshold}</span>
          </div>
          <RatingBar value={legacyPct} height={6} color={legacy.inducted ? 'var(--color-gold)' : 'var(--color-ink-2)'} />
        </div>
        <p className="mt-2 text-label leading-snug text-muted">
          <span className="font-600 text-ink-2">What gets you in:</span> rings ×25 · Ledger hits (max 20) · Guys in Canton ×8 ·
          coaching tree ×5 plus your protégés' wins and rings (+8 max) · honours your players won and finalists you found (+10).
        </p>
        <p className="mt-1 text-label leading-snug text-muted">
          When you retire, this is your Hall-of-Fame case as a contributor. Then you can keep playing as a protégé.
        </p>
        <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={() => setRetiring(true)}>
          Retire &amp; continue as a protégé
        </Button>
      </Card>

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <Users size={16} className="text-muted" aria-hidden />
          <h3 className="font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">Contact Book</h3>
          <Badge tone="neutral" className="ml-auto">{contacts.length}</Badge>
        </div>
        <div className="space-y-2">
          {contacts.map((c) => (
            <div key={c.id} className="rounded-[var(--r-md)] border border-line p-2.5">
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate text-body font-600 text-ink">{c.name}</span>
                <Badge tone="neutral">{c.kind}</Badge>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-label text-muted">
                <span className="flex-1">{c.role ?? c.kind} · {c.region}</span>
                <span className="tnum">{c.relationship}%</span>
              </div>
              <div className="mt-1.5">
                <RatingBar value={c.relationship} height={4} color="var(--color-ink-2)" />
              </div>
              <div className="mt-1 text-label text-faint">{contactIntel(c)}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <Network size={16} className="text-muted" aria-hidden />
          <h3 className="font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">Your Class</h3>
          <span className="ml-auto text-label text-faint">who started when you did</span>
        </div>
        <div className="space-y-1">
          {ladder.map((r, i) => (
            <div key={r.id} className={cn('flex items-center gap-3 rounded-[var(--r-md)] px-2 py-1.5', r.you && 'bg-[var(--team-tint)] shadow-[inset_3px_0_0_var(--team-accent)]')}>
              <span className="w-5 font-display text-body font-700 tnum text-faint">{i + 1}</span>
              {r.teamId && world.byId[r.teamId] && <TeamCrest team={world.byId[r.teamId]} size={22} />}
              <span className={cn('flex-1 truncate text-body', r.you ? 'font-700 text-ink' : 'font-600 text-ink-2')}>{r.name}</span>
              <span className="hidden truncate text-label text-muted sm:block">{r.you ? 'You' : r.title}</span>
              <span className="font-cond text-small font-700 tnum text-ink-2">{r.reputation}</span>
            </div>
          ))}
        </div>
      </Card>

      {tree.length > 0 && (
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <Network size={16} className="text-muted" aria-hidden />
            <h3 className="font-display text-[20px] font-800 italic uppercase leading-none tracking-[0.01em] text-ink">Coaching Tree</h3>
            <Badge tone="neutral" className="ml-auto">{tree.length}</Badge>
          </div>
          <div className="space-y-2">
            {tree.map((t, i) => {
              const w = t.wins ?? 0
              const l = t.losses ?? 0
              const sitting = t.status !== 'available'
              return (
                <div key={`${t.name}-${t.season}-${i}`} className="rounded-[var(--r-md)] border border-line p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate font-600 text-ink">{t.name}</span>
                    <Badge tone={sitting ? 'info' : 'warn'}>{sitting ? 'Head Coach' : 'Available'}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-label text-muted">
                    <span>{t.fromRole ?? t.role}</span>
                    <span aria-hidden>·</span>
                    <span>{world.byId[t.teamId]?.name ?? t.teamId}</span>
                    {(t.seasons ?? 0) > 0 && (
                      <span className="tnum">
                        {w}-{l}
                        {t.rings ? ` · ${t.rings} ring${t.rings === 1 ? '' : 's'}` : ''}
                      </span>
                    )}
                    <span className="ml-auto font-cond text-label text-faint">left {t.season}</span>
                  </div>
                  {canHireStaff && t.id && (
                    <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={() => poach(t.name, t.season)}>
                      {sitting ? `Poach ${t.name.split(' ').slice(-1)[0]} back` : `Bring ${t.name.split(' ').slice(-1)[0]} back`}
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
          <p className="mt-2 text-label leading-snug text-muted">
            Assistants you developed who now run their own club. Their wins as a head coach count toward your legacy — and
            once a club moves on, you can bring them home.
          </p>
        </Card>
      )}

      {/* Retiring hands the file to a protégé: one-way, so it is reviewed first. */}
      <ConfirmSheet
        open={retiring}
        onClose={() => setRetiring(false)}
        eyebrow="Legacy"
        title="Retire and name your successor?"
        subtitle="This ends your career as a coach or executive and continues the file as the protégé you name."
        consequences={[
          { label: 'Your Hall case', value: legacy.inducted ? 'Hall-worthy' : `${legacy.score}/${legacy.threshold}`, tone: legacy.inducted ? 'win' : undefined },
          { label: 'Your protégé', value: successorName.trim() || '—' },
          { label: 'After this', value: 'You cannot return to the retiring persona', tone: 'warn' },
        ]}
        destructive={false}
        confirmLabel={successorName.trim() ? `Retire · continue as ${successorName.trim()}` : 'Retire & continue'}
        ledgerNote={null}
        onConfirm={() => {
          const name = successorName.trim()
          setRetiring(false)
          if (name) startSuccessor(name)
        }}
      >
        <div className="mt-3">
          <label className="label mb-1 block" htmlFor="successor-name">
            Name your successor
          </label>
          <input
            id="successor-name"
            value={successorName}
            onChange={(e) => setSuccessorName(e.target.value)}
            className="w-full rounded-[var(--r-md)] border border-line-strong bg-surface-2 px-3 py-2 text-[16px] font-600 text-ink outline-none focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]"
          />
        </div>
      </ConfirmSheet>
    </div>
  )
}

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--r-md)] border border-line py-1.5">
      <div className="label">{label}</div>
      <div className="font-display text-lg font-700 tnum text-ink">{value}</div>
    </div>
  )
}

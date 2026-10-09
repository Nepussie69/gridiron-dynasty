import { GraduationCap, Network, Trophy, Users } from 'lucide-react'
import { cn } from '../lib/cn'
import { contactIntel, philosophyLabel, rivalTitle } from '../game/engine/people'
import { WILDERNESS_PATHS, legacyCase } from '../game/engine/legacy'
import { traitOrigin } from '../game/engine/earnedTraits'
import { overallRep } from '../game/engine/career'
import { getAwards, getStatsDb, useGame, useWorld } from '../store/gameStore'
import { Badge, Button, Card, RatingBar, TeamCrest } from '../ui/kit'
import { OwnerCard } from './OwnerCard'
import { OwnerMeetingCard } from './OwnerMeetingCard'

/** #9 contacts, #10 traits, #11 mentor + tree, #12 rival class, #17 wilderness, #19 legacy. */
export function CareerPeople() {
  const world = useWorld()
  const career = useGame((s) => s.career)!
  const chooseWilderness = useGame((s) => s.chooseWilderness)
  const startSuccessor = useGame((s) => s.startSuccessor)
  const contacts = career.contacts ?? []
  const tree = career.tree ?? []
  const traits = career.earnedTraits ?? []
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
        <Card className="border-[var(--team)]">
          <h3 className="mb-1 font-display text-lg font-700 uppercase tracking-wide">The Wilderness</h3>
          <p className="mb-3 text-sm text-muted">{career.wilderness.blurb}</p>
          <div className="space-y-2">
            {WILDERNESS_PATHS.map((p) => (
              <button
                key={p.id}
                onClick={() => chooseWilderness(p.id)}
                className="w-full rounded-lg border border-line p-2.5 text-left transition hover:border-line-strong hover:bg-surface-2"
              >
                <div className="font-cond text-sm font-700 uppercase text-ink">{p.label}</div>
                <div className="text-xs text-muted">{p.blurb}</div>
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
            <GraduationCap size={16} className="text-muted" />
            <h3 className="font-display text-lg font-700 uppercase tracking-wide">Your Mentor</h3>
            <Badge tone="info" className="ml-auto">{philosophyLabel(career.mentor.philosophy)}</Badge>
          </div>
          <div className="font-display text-lg font-700 uppercase leading-none text-ink">{career.mentor.name}</div>
          <div className="font-cond text-xs text-muted">
            {world.byId[career.mentor.teamId]?.name ?? career.mentor.teamId} · your boss
          </div>
          <p className="mt-2 text-[11px] leading-snug text-muted">
            A boss shapes what you learn. A {philosophyLabel(career.mentor.philosophy).toLowerCase()} mentor rubs off on how you build.
          </p>
        </Card>
      )}

      {traits.length > 0 && (
        <Card>
          <h3 className="mb-3 font-display text-lg font-700 uppercase tracking-wide">Earned Traits</h3>
          <div className="space-y-2">
            {traits.map((t) => (
              <div key={t.id} className="rounded-lg border border-line p-2.5">
                <div className="font-cond text-sm font-700 uppercase text-ink">{t.name}</div>
                <div className="mt-0.5 text-xs text-muted">{t.desc}</div>
                <div className="mt-1 font-cond text-[10px] uppercase text-faint">Earned: {traitOrigin(t)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <Trophy size={16} className="text-gold" />
          <h3 className="font-display text-lg font-700 uppercase tracking-wide">Legacy Case</h3>
          <Badge tone={legacy.inducted ? 'gold' : 'neutral'} className="ml-auto">
            {legacy.inducted ? 'Hall-worthy' : `${legacy.score}/${legacy.threshold}`}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center">
          <Stat label="Rings" value={legacy.rings} />
          <Stat label="Ledger Hits" value={legacy.ledgerHits} />
          <Stat label="Guys in Canton" value={legacy.cantonPlayers} />
          <Stat label="Coaching Tree" value={legacy.tree} />
          <Stat label="Player Honours" value={legacy.honoursForYourPlayers} />
          <Stat label="Ballot Finalists" value={legacy.finalistsYouFound} />
        </div>
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between font-cond text-[10px] uppercase text-muted">
            <span>Progress to the Hall</span>
            <span className="tnum">{legacy.score}/{legacy.threshold}</span>
          </div>
          <RatingBar
            value={legacyPct}
            height={6}
            color={legacy.inducted ? 'var(--color-gold-ink)' : 'var(--team)'}
          />
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted">
          <span className="font-600 text-ink-2">What gets you in:</span> rings ×25 · Ledger hits (max 20) · Guys in Canton ×8 ·
          coaching tree ×5 · honours your players won and finalists you found (+10).
        </p>
        <p className="mt-1 text-[11px] leading-snug text-muted">
          When you retire, this is your Hall-of-Fame case as a contributor. Then you can keep playing as a protégé.
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="mt-2 w-full"
          onClick={() => {
            const name = window.prompt('Name your successor', 'R. Hale') ?? ''
            if (name.trim()) startSuccessor(name.trim())
          }}
        >
          Retire & continue as a protégé
        </Button>
      </Card>

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <Users size={16} className="text-muted" />
          <h3 className="font-display text-lg font-700 uppercase tracking-wide">Contact Book</h3>
          <Badge tone="neutral" className="ml-auto">{contacts.length}</Badge>
        </div>
        <div className="space-y-2">
          {contacts.map((c) => (
            <div key={c.id} className="rounded-lg border border-line p-2.5">
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm font-600 text-ink">{c.name}</span>
                <Badge tone="neutral">{c.kind}</Badge>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                <span className="flex-1">{c.role ?? c.kind} · {c.region}</span>
                <span className="tnum">{c.relationship}%</span>
              </div>
              <div className="mt-1.5"><RatingBar value={c.relationship} height={4} color={c.relationship >= 70 ? '#05914f' : 'var(--team)'} /></div>
              <div className="mt-1 text-[10px] text-faint">{contactIntel(c)}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <Network size={16} className="text-muted" />
          <h3 className="font-display text-lg font-700 uppercase tracking-wide">Your Class</h3>
          <span className="ml-auto text-[10px] text-faint">who started when you did</span>
        </div>
        <div className="space-y-1">
          {ladder.map((r, i) => (
            <div key={r.id} className={cn('flex items-center gap-3 rounded-lg px-2 py-1.5', r.you && 'bg-[var(--team-soft)]')}>
              <span className="w-5 font-display text-sm font-700 tnum text-faint">{i + 1}</span>
              {r.teamId && world.byId[r.teamId] && <TeamCrest team={world.byId[r.teamId]} size={22} />}
              <span className={cn('flex-1 truncate text-sm', r.you ? 'font-700 text-ink' : 'font-600 text-ink-2')}>{r.name}</span>
              <span className="hidden truncate text-[11px] text-muted sm:block">{r.you ? 'You' : r.title}</span>
              <span className="font-cond text-xs font-700 tnum text-ink-2">{r.reputation}</span>
            </div>
          ))}
        </div>
      </Card>

      {tree.length > 0 && (
        <Card>
          <h3 className="mb-3 font-display text-lg font-700 uppercase tracking-wide">Coaching Tree</h3>
          <div className="space-y-1.5">
            {tree.map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate font-600 text-ink">{t.name}</span>
                <span className="text-[11px] text-muted">{t.role} · {world.byId[t.teamId]?.name ?? t.teamId}</span>
                <span className="font-cond text-[10px] text-faint">{t.season}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line py-1.5">
      <div className="label !text-[9px]">{label}</div>
      <div className="font-display text-lg font-700 tnum text-ink">{value}</div>
    </div>
  )
}


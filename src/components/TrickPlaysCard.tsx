// ─────────────────────────────────────────────────────────────────────────────
// FUTURES #24 (T2 UI): this week's trick-play package.
//
// Install up to two of the four calls. Each shows the league's read on it
// (Fresh / Seen / Alert) and the staff line; the card goes "Predictable" once an
// opponent has scouted one. The OC toggle lets the staff take one when the look
// is right. Everything comes from the T1 engine (`engine/trickPlays.ts`); this
// card only chooses the package and shows the scouting read.
// ─────────────────────────────────────────────────────────────────────────────

import { Zap } from 'lucide-react'
import { capabilities } from '../game/engine/capabilities'
import { TRICK, trickRecordText } from '../game/engine/trickPlays'
import { trickInstallState, trickMotionLine, trickRecordFor } from '../lib/trickUi'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Card, OptionCard, OptionGroup, VerdictChip } from '../ui/kit'

export function TrickPlaysCard({ disabled = false }: { disabled?: boolean }) {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const setTrickPackage = useGame((s) => s.setTrickPackage)
  const setOcTricks = useGame((s) => s.setOcTricks)

  // Hidden for every personnel rung that never calls a game plan.
  if (capabilities(career).planScope === 'none') return null

  // Tricks are an offense-side tool (the store hands them to the OC only).
  const offSide = career.unitFocus !== 'def'
  const scouted = trickRecordFor(league, career.teamId)
  const install = trickInstallState(career, scouted, disabled || !offSide)
  const own = trickRecordText(scouted)
  const oc = career.ocTricks === true

  const toggle = (kind: (typeof install.rows)[number]['kind']) => {
    const installed = install.installed
    const next = installed.includes(kind)
      ? installed.filter((k) => k !== kind)
      : installed.length < TRICK.maxPackage
        ? [...installed, kind]
        : installed
    setTrickPackage(next)
  }

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <Zap size={16} className="text-muted" aria-hidden />
        <h3 className="font-display text-lg font-700 uppercase tracking-wide">Trick Plays</h3>
        {install.predictable && <Badge tone="warn" className="ml-auto">Predictable</Badge>}
        <Badge tone={install.installed.length ? 'info' : 'neutral'} className={install.predictable ? '' : 'ml-auto'}>
          {install.installed.length}/{TRICK.maxPackage}
        </Badge>
      </div>
      <p className="mb-3 text-small leading-snug text-muted">
        Install up to two calls this week. They pay off when the defence is not expecting them — and the league
        remembers every one you show.
      </p>

      {!offSide ? (
        <p className="rounded-[var(--r-md)] bg-surface-2 px-3 py-2 text-small text-muted">
          Tricks are an offensive call — the OC installs them.
        </p>
      ) : (
        <>
          <OptionGroup label="Tricks this week" className="sm:grid-cols-2">
            {install.rows.map((row) => (
              <OptionCard
                key={row.kind}
                selected={row.selected}
                disabled={row.disabled}
                onSelect={() => toggle(row.kind)}
                title={row.label}
                description={row.hint}
                meta={<VerdictChip tone={row.tone}>{row.chip}</VerdictChip>}
              />
            ))}
          </OptionGroup>

          {install.installed.length > 0 && (
            <div className="mt-3 rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-2.5">
              <p className="font-cond text-label font-700 uppercase tracking-wide text-ink-2">Game-day motion</p>
              <ul className="mt-1 space-y-1">
                {install.installed.map((kind) => (
                  <li key={kind} className="flex flex-col gap-0.5 text-label leading-snug text-muted sm:flex-row sm:items-baseline sm:gap-2">
                    <span className="font-600 text-ink-2">{install.rows.find((r) => r.kind === kind)?.label}</span>
                    <span className="min-w-0">{trickMotionLine(kind)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-label leading-snug text-muted">
                On game day the broadcast draws each exchange as it happened, and the defence's own reaction to the fake.
              </p>
            </div>
          )}

          <div className="mt-3 rounded-[var(--r-md)] border border-line bg-surface-2 p-3">
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--team-accent)]"
                checked={oc}
                disabled={disabled || !install.installed.length}
                onChange={(e) => setOcTricks(e.target.checked)}
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-cond text-small font-700 uppercase tracking-wide text-ink">
                  <Zap size={13} aria-hidden /> Let the OC call one
                </span>
                <span className="mt-0.5 block text-label leading-snug text-muted">
                  {install.installed.length
                    ? 'The staff takes one of the installed tricks when the look is right — and never a call you have not installed.'
                    : 'Install at least one trick first.'}
                </span>
              </span>
            </label>
          </div>

          <p className="mt-3 text-small leading-snug text-muted">
            {install.full && 'Two installed — unselect one to change the package. '}
            {own ? (
              <>Opponents have scouted you: <strong className="text-ink-2">{own}</strong>.</>
            ) : (
              'The league has no read on your tricks yet — keep it that way.'
            )}
          </p>
        </>
      )}
    </Card>
  )
}

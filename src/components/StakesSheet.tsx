import { mult, signed } from '../lib/format'
import type { World } from '../game/engine/generate'
import { SEASON_PROFILE_CAP, SEASON_SECURITY_CAP, type Stakes } from '../game/engine/primetime'
import type { CareerState } from '../game/types'
import { Chip, Sheet } from '../ui/kit'

/** The stakes chip: opens the sheet. */
export function StakesChip({ label, onOpen, title }: { label: string; onOpen: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={title}
      className="motion inline-flex items-center rounded-full pointer-coarse:min-h-11"
    >
      <Chip className="border-gold/40 bg-gold-soft text-gold-ink">{label}</Chip>
    </button>
  )
}

/**
 * The stakes read for a game: the swing table and this season's remaining caps.
 * Values mirror primetimeSwing / applyStakesSwing in engine/primetime.ts.
 */
export function StakesSheet({
  open,
  onClose,
  world,
  career,
  title,
  stakes,
}: {
  open: boolean
  onClose: () => void
  world: World
  career: CareerState
  title: string
  stakes: Stakes
}) {
  const cap =
    career.stakes && career.stakes.season === world.season
      ? career.stakes
      : { season: world.season, profile: 0, security: 0 }
  const profileLeft = Math.max(0, SEASON_PROFILE_CAP - cap.profile)
  const rows: [string, string][] = [
    ['Win', `Profile ${signed(1)} · job security ${signed(1)} · squad morale ${signed(2)}`],
    ['Loss', `Job security ${signed(-1)} · squad morale ${signed(-1)}`],
    ['Loss by 17+', `Job security ${signed(-2)} · squad morale ${signed(-3)}`],
    ['1–3 point game', `Profile ${signed(1)} either way`],
  ]
  return (
    <Sheet open={open} onClose={onClose} eyebrow="Stakes" title={title}>
      <p className="text-small leading-relaxed text-muted">
        Primetime and rivalry games move the career needle more than a normal Sunday. A normal game is ×1.0; a primetime
        or rivalry game is ×1.5; both at once is ×2.0. The numbers below are before that multiplier, and this game is
        worth {mult(stakes.mult, 1)}.
      </p>
      <dl className="mt-3 overflow-hidden rounded-[var(--r-md)] border border-line">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 border-t border-line px-3 py-2.5 text-small first:border-t-0">
            <dt className="text-ink-2">{label}</dt>
            <dd className="text-right font-600 text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-label leading-snug text-faint">
        A win against a rival coach also adds +1 profile on its own, at most twice a season.
      </p>
      <div className="label mt-4">Season caps — remaining</div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <Chip>
          Profile {profileLeft} of {SEASON_PROFILE_CAP} left
        </Chip>
        <Chip>Job security {signed(cap.security)} · cap ±{SEASON_SECURITY_CAP}</Chip>
      </div>
      <p className="mt-2 text-label leading-snug text-faint">
        The caps keep the season review — and the owner&rsquo;s firing line — in charge. Morale is uncapped but only
        touches the sim when the locker-room toggle is on.
      </p>
    </Sheet>
  )
}

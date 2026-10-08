import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { cn } from '../lib/cn'
import { gmRestructureTargets } from '../game/engine/gmDesk'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button } from '../ui/kit'

/**
 * L12.14 C6: the GM only restructures to clear cap for a NAMED target, so this
 * picker (reusing the Cap-memo chip pattern) makes you name one. Shared by the
 * GM requests desk and the Cap screen. Personnel rungs never see it.
 */
export function GmRestructureRequest({ className, compact }: { className?: string; compact?: boolean }) {
  const league = useWorld()
  const career = useGame((s) => s.career)!
  const requestGmRestructure = useGame((s) => s.requestGmRestructure)
  const [targetId, setTargetId] = useState<string | null>(null)

  const targets = gmRestructureTargets(league, career)
  const greenlit = career.gmRestructureSeason === league.season
  const picked = targets.find((t) => t.id === targetId) ?? null
  const bothSides = career.level >= 7 || career.unitFocus === 'both'

  return (
    <div className={className}>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="label">Restructure to clear cap — pick a target</span>
        {greenlit && <Badge tone="win">Green-lit this season</Badge>}
      </div>

      {targets.length === 0 ? (
        <p className="text-xs leading-relaxed text-muted">
          No {bothSides ? 'trade or free-agent' : 'same-side trade or free-agent'} target to clear space for. Track
          someone on the shadow board, or open Free Agency or the Trade Center first.
        </p>
      ) : (
        <>
          <div className={cn('flex flex-wrap gap-1.5', compact && 'max-h-36 overflow-y-auto')}>
            {targets.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTargetId((cur) => (cur === t.id ? null : t.id))}
                className={cn(
                  'rounded-lg border px-2.5 py-1 text-left transition',
                  t.id === targetId
                    ? 'border-[var(--team)] bg-[var(--team-soft)]'
                    : 'border-line bg-surface-2 hover:border-line-strong',
                )}
              >
                <span className="block text-xs font-600 text-ink">{t.name}</span>
                <span className="block font-cond text-[10px] font-700 uppercase text-muted">
                  {t.kind === 'sign' ? 'FA' : 'Trade'} · {t.pos} {t.ovr} ·{' '}
                  {t.need > 0 ? `needs $${(t.need / 1e6).toFixed(1)}M` : 'already fits'}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              variant="team"
              size="sm"
              disabled={!picked}
              title={picked ? `Ask the GM to clear cap for ${picked.name}` : 'Pick a target first'}
              onClick={() => picked && requestGmRestructure(picked.id)}
            >
              <Sparkles size={14} /> Restructure for {picked ? picked.name : 'a target'}
            </Button>
            {picked && picked.need <= 0 && (
              <span className="text-[11px] text-muted">Already fits — the GM will refuse an unnecessary restructure.</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

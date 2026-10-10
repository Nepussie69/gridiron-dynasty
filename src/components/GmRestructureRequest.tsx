import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
import { gmRestructureTargets } from '../game/engine/gmDesk'
import { useGame, useWorld } from '../store/gameStore'
import { Badge, Button, OptionCard, OptionGroup } from '../ui/kit'

/**
 * L12.14 C6: the GM only restructures to clear cap for a NAMED target, so this
 * picker (reusing the Cap-memo chip pattern) makes you name one. Shared by the
 * GM requests desk and the Cap screen. Personnel rungs never see it.
 *
 * D4: neutral option cards (no team fill), and the request is a real
 * `requestGmRestructure` call — the coach's recommendation, not a dead control.
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
        <p className="text-small leading-relaxed text-muted">
          No {bothSides ? 'trade or free-agent' : 'same-side trade or free-agent'} target to clear space for. Track
          someone on the shadow board, or open Free Agency or the Trade Center first.
        </p>
      ) : (
        <>
          <OptionGroup
            label="Restructure target"
            className={cn('max-h-60 overflow-y-auto', compact && 'max-h-36')}
          >
            {targets.map((t) => (
              <OptionCard
                key={t.id}
                selected={t.id === targetId}
                title={t.name}
                description={
                  <>
                    {t.kind === 'sign' ? 'Free agent' : 'Trade target'} · {t.pos} {t.ovr}
                  </>
                }
                meta={
                  t.need > 0 ? (
                    <span className="whitespace-nowrap text-small font-600 text-ink-2 tnum">
                      needs {money(t.need)}
                    </span>
                  ) : (
                    <span className="text-small text-muted">already fits</span>
                  )
                }
                onSelect={() => setTargetId((cur) => (cur === t.id ? null : t.id))}
              />
            ))}
          </OptionGroup>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!picked}
              title={picked ? `Ask the GM to clear cap for ${picked.name}` : 'Pick a target first'}
              onClick={() => picked && requestGmRestructure(picked.id)}
            >
              <Sparkles size={14} /> Restructure for {picked ? picked.name : 'a target'}
            </Button>
            {picked && picked.need <= 0 && (
              <span className="text-small text-muted">Already fits — the GM will refuse an unnecessary restructure.</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

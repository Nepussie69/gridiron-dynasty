import { Eye, Gavel, Lock, PenLine } from 'lucide-react'
import { ACCESS_META, accessFor, type AccessArea } from '../game/engine/access'
import { useGame } from '../store/gameStore'
import { Badge } from '../ui/kit'

/** A small badge showing your access level on a screen: Locked / View / Advise / Decide. */
export function AccessBadge({ area, className }: { area: AccessArea; className?: string }) {
  const career = useGame((s) => s.career)
  if (!career) return null
  const level = accessFor(career, area)
  const meta = ACCESS_META[level]
  const Icon = level === 'locked' ? Lock : level === 'decide' ? Gavel : level === 'advise' ? PenLine : Eye
  return (
    <Badge tone={meta.tone} className={className}>
      <Icon size={11} /> {meta.label}
    </Badge>
  )
}

/** One-line explanation of what this access level means on this screen. */
export function AccessNote({ area }: { area: AccessArea }) {
  const career = useGame((s) => s.career)
  if (!career) return null
  const meta = ACCESS_META[accessFor(career, area)]
  return <p className="text-xs text-muted">{meta.blurb}</p>
}

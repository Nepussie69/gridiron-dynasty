import {
  Building2,
  Car,
  ClipboardList,
  Coffee,
  Laptop,
  Map,
  Monitor,
  Phone,
  Shield,
  Sparkles,
  Star,
  Target,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '../lib/cn'
import { useGame } from '../store/gameStore'
import { Card } from '../ui/kit'

/**
 * "Your office is the progress bar" (#19).
 *
 * A small header scene that visibly grows with each promotion: a scout starts
 * with a car, a laptop and a region map; a director gets the draft room; the
 * head coach gets the film room; the GM gets the war room. The set of objects
 * is the career, told without a number.
 */
interface DeskItem {
  Icon: LucideIcon
  label: string
}
interface Office {
  title: string
  blurb: string
  items: DeskItem[]
}

const item = (Icon: LucideIcon, label: string): DeskItem => ({ Icon, label })

const OFFICES: Record<string, Office> = {
  // Personnel ladder
  'personnel:4': {
    title: 'The Scouting Cubicle',
    blurb: 'A shared room, a region map, and a lot of windshield time.',
    items: [item(Car, 'The road car'), item(Laptop, 'Laptop'), item(Map, 'Region map'), item(ClipboardList, 'Area reports')],
  },
  'personnel:5': {
    title: 'The Draft Room',
    blurb: 'The board is on the wall now, and the picks are yours to defend.',
    items: [item(ClipboardList, 'The big board'), item(Monitor, 'Tape station'), item(Target, 'Consensus board'), item(Phone, 'War-room line')],
  },
  'personnel:6': {
    title: 'The Personnel Office',
    blurb: 'Pro and college, one door. The agents have your number.',
    items: [item(Phone, 'Agent line'), item(ClipboardList, 'Pro board'), item(Users, 'Scouting staff'), item(Star, 'Priority list')],
  },
  'personnel:7': {
    title: 'The Executive Suite',
    blurb: 'You run the building day to day. The plan lands on the GM\u2019s desk.',
    items: [item(Building2, 'Corner office'), item(Phone, 'Ownership line'), item(Users, 'Department heads'), item(Trophy, 'Division banner')],
  },
  'personnel:8': {
    title: 'The War Room',
    blurb: 'Final say on the 53. The whole operation runs through this table.',
    items: [item(Trophy, 'Lombardi shelf'), item(Target, 'The 53'), item(Users, 'Full staff'), item(Shield, 'The franchise'), item(Building2, 'The building')],
  },
  // Coaching ladder
  'coach:5': {
    title: 'The Position Room',
    blurb: 'A whiteboard, a projector, and your guys.',
    items: [item(Monitor, 'Install tape'), item(ClipboardList, 'Drill plan'), item(Users, 'Your room')],
  },
  'coach:6': {
    title: 'The Coordinator\u2019s Film Room',
    blurb: 'One side of the ball is yours. The call sheet is on the desk.',
    items: [item(Monitor, 'Film wall'), item(Target, 'Call sheet'), item(Users, 'Unit meetings'), item(Sparkles, 'The scheme')],
  },
  'coach:7': {
    title: 'The Head Coach\u2019s Office',
    blurb: 'The standard is yours to set. The building answers to this room.',
    items: [item(Shield, 'The standard'), item(Users, 'The locker room'), item(Target, 'Game management'), item(Trophy, 'Championship wall'), item(Coffee, 'Long Mondays')],
  },
}

export function OfficeScene({ className }: { className?: string }) {
  const career = useGame((s) => s.career)!
  const office = OFFICES[`${career.path}:${career.level}`]
  if (!office) return null
  return (
    <Card className={cn('overflow-hidden', className)} pad={false}>
      <div className="hatch flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <div className="min-w-[220px]">
          <div className="label">Your office · {career.path === 'coach' ? 'Coaching' : 'Personnel'}</div>
          <div className="font-display text-lg font-700 uppercase tracking-wide text-ink">{office.title}</div>
          <div className="text-xs text-muted">{office.blurb}</div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {office.items.map(({ Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5"
              title={label}
            >
              <Icon size={15} className="text-[var(--team)]" />
              <span className="font-cond text-[10px] font-700 uppercase tracking-wide text-ink-2">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

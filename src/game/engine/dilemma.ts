// ─────────────────────────────────────────────────────────────────────────────
// The week's ONE big decision (#2).
//
// Each week puts a single card at the centre that needs a call. Everything else
// in the week is optional. The card is drawn from live world state — a contract
// standoff, a hot-seat game, a banged-up star, a locker-room crisis — and every
// choice trades wins against culture against reputation. None of them is
// "correct"; the point is the trade-off, not the answer.
//
// The card is generated deterministically from (seed, season, week) so a save
// re-loads the same decision, and it is keyed to the rung's verb (#1): a scout
// predicts, a director persuades, a coordinator adapts, a head coach leads, a GM
// allocates.
// ─────────────────────────────────────────────────────────────────────────────

import type { CareerState, DilemmaChoice, WeeklyDilemma } from '../types'
import type { World } from './generate'
import { hash32, makeRng, rpick, type Rng } from './rng'
import { verbFor, type Reputation } from './career'

/** The visible axes every card moves. Opposed where the drama demands it. */
export interface DilemmaEffect {
  repDelta: Partial<Reputation>
  /** Job-security swing, -12..+12. */
  security: number
  /** Culture/cohesion swing, -8..+8. */
  culture: number
}

interface DilemmaTemplate {
  id: string
  /** Which verbs this card is appropriate for. */
  verbs: string[]
  build: (world: World, career: CareerState, rng: Rng) => Omit<WeeklyDilemma, 'id' | 'season' | 'week' | 'resolved'>
}

const NAMES_FIRST = ['Darnell', 'Cody', 'Emeka', 'Jalen', 'Brody', 'Malik', 'Trey', 'Kenny', 'Rasheed', 'Wes']
const NAMES_LAST = ['Okafor', 'Whitfield', 'Cabrera', 'Nowak', 'Randle', 'Bissett', 'Marlowe', 'Pruitt', 'Vega', 'Hurst']
const REPORTERS = ['Dana Cole', 'Mike Bircher', 'Priya Raman', 'Sal Torres']

/** Small helper so template verb lists read cleanly. */
const verbSet = (...v: string[]) => v

/** A made-up player, used for anything dark (#10). Never a real player. */
function aPlayer(rng: Rng): { name: string; pos: string } {
  return {
    name: `${rpick(rng, NAMES_FIRST)} ${rpick(rng, NAMES_LAST)}`,
    pos: rpick(rng, ['WR', 'CB', 'LB', 'RB', 'S', 'TE', 'DT']),
  }
}

const TEMPLATES: DilemmaTemplate[] = [
  // ── Contract standoff: the player wants to be paid (alloc/persuade) ─────────
  {
    id: 'contractStandoff',
    verbs: verbSet('allocate', 'persuade', 'lead'),
    build: (_world, _career, rng) => {
      const who = aPlayer(rng)
      return {
        kind: 'roster',
        title: `${who.name} wants a new deal`,
        body: `Your starting ${who.pos} is a year from free agency and his agent is making noise. Pay him now, or let it ride and risk the locker room?`,
        prompt: 'What do you do?',
        choices: [
          {
            id: 'pay',
            label: 'Pay him now',
            blurb: 'Lock up a good player — but set a precedent every agent will quote.',
            effect: { repDelta: { roster: 3, leadership: 1, results: 1 }, security: 3, culture: 2 },
            outcome: `You paid ${who.name}. The room is happy; the cap is tighter, and his agent is already telling other agents.`,
          },
          {
            id: 'wait',
            label: 'Let it play out',
            blurb: 'Keep flexibility. A cheaper deal might come — or a holdout.',
            effect: { repDelta: { roster: 1, leadership: -2, profile: 1 }, security: -1, culture: -3 },
            outcome: `${who.name} stews. No holdout yet, but the locker room noticed you didn't back your guy.`,
          },
        ],
      }
    },
  },

  // ── Injury gamble: play the banged-up star (lead/adapt) ─────────────────────
  {
    id: 'injuryGamble',
    verbs: verbSet('lead', 'adapt'),
    build: (_world, _career, rng) => {
      const who = aPlayer(rng)
      return {
        kind: 'game',
        title: `${who.name} is banged up`,
        body: `Your star ${who.pos} is nursing a bad hamstring but insists he can go in a game you need. One wrong cut and you lose him for the year.`,
        prompt: 'Does he suit up?',
        choices: [
          {
            id: 'play',
            label: 'Play him',
            blurb: 'Swing for the win. Risky — a re-injury costs you the season.',
            effect: { repDelta: { results: 3, profile: 1, leadership: -1 }, security: 2, culture: 1 },
            outcome: `You ran him out there. He survived the game and made two plays that mattered — this time.`,
          },
          {
            id: 'rest',
            label: 'Sit him',
            blurb: 'Protect your guy and the long season. Take the weaker lineup.',
            effect: { repDelta: { leadership: 3, results: -1 }, security: -2, culture: 3 },
            outcome: `You sat ${who.name}. He appreciated it — the players notice when you protect them. The owner only sees the loss column.`,
          },
        ],
      }
    },
  },

  // ── Beloved veteran: cut him a year early (lead/allocate) ───────────────────
  {
    id: 'belovedVet',
    verbs: verbSet('lead', 'allocate', 'persuade'),
    build: (_world, _career, rng) => {
      const who = aPlayer(rng)
      return {
        kind: 'culture',
        title: `Cut ${who.name} a year early?`,
        body: `${who.name} is a franchise favorite whose play is starting to slip. Cutting him now saves cap and a roster spot — but he's the heart of the locker room.`,
        prompt: 'The call is yours.',
        choices: [
          {
            id: 'cut',
            label: 'Move on early',
            blurb: 'Clean cap, younger roster — a colder room.',
            effect: { repDelta: { roster: 3, leadership: -3 }, security: 1, culture: -5 },
            outcome: `You released ${who.name}. The cap sheet looks better. Several veterans went quiet with you for a while.`,
          },
          {
            id: 'keep',
            label: 'Let him finish here',
            blurb: 'Loyalty and leadership — at the cost of flexibility.',
            effect: { repDelta: { leadership: 3, roster: -1 }, security: -1, culture: 4 },
            outcome: `You kept ${who.name}. The room loved it. The roster math got harder.`,
          },
        ],
      }
    },
  },

  // ── Hot-seat game: the owner wants a win now (lead/persuade/adapt) ──────────
  {
    id: 'hotSeat',
    verbs: verbSet('lead', 'adapt', 'persuade'),
    build: (_world, _career, rng) => {
      const rep = rpick(rng, REPORTERS)
      return {
        kind: 'pressure',
        title: 'The owner wants answers',
        body: `After a rough stretch, ${rep} reports the owner has questions. Do you go win-now to save your job, or stay the course you believe in?`,
        prompt: 'How do you respond?',
        choices: [
          {
            id: 'winnow',
            label: 'Go win-now',
            blurb: 'Trade future assets for help today. Saves the season — maybe.',
            effect: { repDelta: { results: 3, profile: 2, roster: -2 }, security: 5, culture: -1 },
            outcome: `You pushed your chips in. The owner saw a team trying to win — the future got a little dimmer.`,
          },
          {
            id: 'process',
            label: 'Stay the course',
            blurb: 'Trust the plan in public. Risky if the losses pile up.',
            effect: { repDelta: { leadership: 2, profile: -1 }, security: -4, culture: 3 },
            outcome: `You defended the process to the owner. He listened — for now. The room respected the backbone.`,
          },
        ],
      }
    },
  },

  // ── Board push: your guy vs the room (persuade) ─────────────────────────────
  {
    id: 'boardPush',
    verbs: verbSet('persuade', 'predict'),
    build: (_world, _career, rng) => {
      const mine = aPlayer(rng)
      const theirs = aPlayer(rng)
      return {
        kind: 'draft',
        title: `Your board vs. the room`,
        body: `You love ${mine.name} a round higher than the room has him. The consensus name is ${theirs.name}. Do you pound the table for your guy?`,
        prompt: 'Which name goes on the board?',
        choices: [
          {
            id: 'mine',
            label: `Fight for ${mine.name}`,
            blurb: 'Trust your eye. Spend credibility with the room.',
            effect: { repDelta: { evaluation: 3, profile: 2, leadership: -2 }, security: -1, culture: -2 },
            outcome: `You pushed your grade. If ${mine.name} hits, this becomes your signature call; if he busts, the room remembers.`,
          },
          {
            id: 'consensus',
            label: `Defer on ${theirs.name}`,
            blurb: 'Keep the room together. Bank goodwill for a bigger fight.',
            effect: { repDelta: { leadership: 2, evaluation: -1 }, security: 1, culture: 2 },
            outcome: `You let consensus win. The room felt heard — but you filed away the disagreement.`,
          },
        ],
      }
    },
  },

  // ── The favor: an agent asks you to look at his guy (persuade/predict) ──────
  {
    id: 'agentFavor',
    verbs: verbSet('persuade', 'predict'),
    build: (_world, _career, rng) => {
      const who = aPlayer(rng)
      return {
        kind: 'roster',
        title: `An agent calls in a favor`,
        body: `A power agent who has sent you good info before wants you to take a longer look at his client, ${who.name}. Return the favor, or stay strictly on the tape?`,
        prompt: 'How do you handle it?',
        choices: [
          {
            id: 'favor',
            label: 'Do him the solid',
            blurb: 'Build the relationship — blur the line a little.',
            effect: { repDelta: { profile: 2, evaluation: -1 }, security: 0, culture: 0 },
            outcome: `You took the extra look and told the agent you did. He'll remember — some say that's how the game works.`,
          },
          {
            id: 'tape',
            label: 'Tape only',
            blurb: 'Protect your process and your scouting staff.',
            effect: { repDelta: { evaluation: 2, leadership: 1, profile: -1 }, security: 1, culture: 1 },
            outcome: `You graded ${who.name} on the tape alone. The staff noticed your process held even under a favor.`,
          },
        ],
      }
    },
  },
]

/**
 * The one card for this week, or null if there isn't one (quiet weeks, the
 * offseason). Deterministic per (seed, season, week, team).
 */
export function currentDilemma(world: World, career: CareerState): WeeklyDilemma | null {
  if (world.phase !== 'regular') return null
  // One card a week, from week 2 on — week 1 is orientation.
  if (world.week < 2 || world.week > 18) return null
  const rng = makeRng(world.seed + hash32(career.teamId, 17) + world.season * 4_099 + world.week * 131)
  const verb = verbFor(career.path, career.level) as string
  const eligible = TEMPLATES.filter((t) => t.verbs.includes(verb))
  const pool = eligible.length ? eligible : TEMPLATES
  const pick = rpick(rng, pool)
  const built = pick.build(world, career, rng)
  return {
    id: `dl_${world.season}_${world.week}_${pick.id}`,
    season: world.season,
    week: world.week,
    resolved: career.dilemma?.id === `dl_${world.season}_${world.week}_${pick.id}` ? career.dilemma!.resolved : null,
    ...built,
  }
}

/** Apply a resolved card: reputation, security and culture move, and a story. */
export function applyDilemma(
  career: CareerState,
  dilemma: WeeklyDilemma,
  choiceId: string,
): { career: CareerState; note: string; security: number; culture: number } {
  const choice = dilemma.choices.find((c) => c.id === choiceId) ?? dilemma.choices[0]
  const rep: Reputation = { ...career.reputation }
  for (const [k, v] of Object.entries(choice.effect.repDelta)) {
    ;(rep as unknown as Record<string, number>)[k] = Math.max(0, Math.min(100, ((rep as unknown as Record<string, number>)[k] ?? 0) + (v as number)))
  }
  return {
    career: { ...career, reputation: rep },
    note: choice.outcome,
    security: choice.effect.security,
    culture: choice.effect.culture,
  }
}

export type { DilemmaChoice }

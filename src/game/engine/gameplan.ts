// ─────────────────────────────────────────────────────────────────────────────
// In-game play calling.
//
// You don't need to pick every play — you set a GAME PLAN that bends the sim,
// and it applies until you change it. Presets cover the common situations
// (run the clock, air it out, sell out vs. the run), and every dial can be
// nudged individually.
// ─────────────────────────────────────────────────────────────────────────────

export interface GamePlan {
  /** −2 = run-heavy … 0 = balanced … +2 = pass-heavy */
  passBias: number
  /** −1 = deliberate (drain clock) … 0 = normal … +1 = hurry-up */
  tempo: number
  /** 0 = conservative (keep everything in front) … 1 = sell out to stop the run … 2 = all-out blitz */
  aggression: number
  /** 0 = zone (no big plays) … 1 = balanced … 2 = press man */
  coverage: number
}

export const BALANCED_PLAN: GamePlan = { passBias: 0, tempo: 0, aggression: 0.5, coverage: 1 }

export interface PlanPreset {
  id: string
  label: string
  blurb: string
  plan: GamePlan
}

export const PLAN_PRESETS: PlanPreset[] = [
  { id: 'balanced', label: 'Balanced', blurb: 'Standard calls. Take what the defense gives.', plan: { ...BALANCED_PLAN } },
  { id: 'run-heavy', label: 'Run Heavy', blurb: 'Lean on the ground game. Shorten the game.', plan: { passBias: -1.6, tempo: -0.5, aggression: 0.5, coverage: 1 } },
  { id: 'air-it-out', label: 'Air It Out', blurb: 'Pass-first. Push the ball downfield.', plan: { passBias: 1.6, tempo: 0.4, aggression: 0.5, coverage: 1 } },
  { id: 'clock-killer', label: 'Clock Killer', blurb: 'Deliberate tempo, run the ball, protect the lead.', plan: { passBias: -1.2, tempo: -1, aggression: 0.4, coverage: 0 } },
  { id: 'hurry-up', label: 'Hurry Up', blurb: 'Fast tempo, throw to stop the clock.', plan: { passBias: 1.2, tempo: 1, aggression: 0.5, coverage: 1 } },
  { id: 'blitz', label: 'All-Out Blitz', blurb: 'Send the house. Risk the big play for pressure.', plan: { passBias: 0, tempo: 0.3, aggression: 2, coverage: 1.6 } },
  { id: 'bend-dont-break', label: "Bend Don't Break", blurb: 'Soft zone, no big plays, tackle in front.', plan: { passBias: 0, tempo: -0.4, aggression: 0.2, coverage: 0 } },
  { id: 'stack-box', label: 'Stack the Box', blurb: 'Sell out to stop the run. Dare them to throw.', plan: { passBias: 0.2, tempo: 0, aggression: 1.4, coverage: 0.4 } },
]

// ── How a plan bends the sim ─────────────────────────────────────────────────
export interface PlanEffects {
  passAdj: number // added to the OC's pass-rate tendency
  timeScale: number // multiplies seconds burned per play (>1 = slower game)
  blitz: number // added to the DC's blitz rate
  coverageAdj: number // 0 = zone … 1 = man, overrides scheme lean
  bigPlayRisk: number // multiplier on explosive-play chance allowed (defense)
  aggression: number // 0..2, used for run-stuff vs. pass-rush tradeoff
}

export function planEffects(plan: GamePlan, defensive: boolean): PlanEffects {
  // Pass tendency bends both sides: offense throws more, and a defense facing
  // a pass-heavy plan can tee off.
  const passAdj = plan.passBias * 0.11

  // Tempo: deliberate burns more clock, hurry-up burns less.
  const timeScale = 1 - plan.tempo * 0.28

  // Aggression drives pressure but concedes explosives.
  const blitz = (plan.aggression - 0.5) * 0.16
  const bigPlayRisk = 1 + (plan.aggression - 0.5) * 0.22

  // Coverage: 0 (zone) → fewer big plays, softer; 2 (press man) → tighter but riskier.
  const coverageAdj = plan.coverage <= 0 ? 0 : plan.coverage >= 2 ? 1 : 0.5
  const covBig = plan.coverage <= 0 ? 0.86 : plan.coverage >= 2 ? 1.1 : 1

  return {
    passAdj,
    timeScale,
    blitz: defensive ? blitz : 0,
    coverageAdj,
    bigPlayRisk: (defensive ? bigPlayRisk * covBig : 1),
    aggression: plan.aggression,
  }
}

/** One-line read of the plan for the UI. */
export function describePlan(plan: GamePlan): string {
  const pass =
    plan.passBias > 1.3 ? 'pass-heavy' : plan.passBias > 0.4 ? 'pass-leaning' : plan.passBias < -1.3 ? 'run-heavy' : plan.passBias < -0.4 ? 'run-leaning' : 'balanced'
  const tempo = plan.tempo > 0.5 ? 'hurry-up' : plan.tempo < -0.5 ? 'clock-draining' : 'normal tempo'
  const def =
    plan.aggression > 1.5 ? 'all-out pressure' : plan.aggression > 0.9 ? 'aggressive' : plan.aggression < 0.3 ? 'conservative' : 'balanced pressure'
  const cov = plan.coverage <= 0.3 ? 'soft zone' : plan.coverage >= 1.7 ? 'press man' : 'mixed coverage'
  return `${pass}, ${tempo} · ${def}, ${cov}`
}

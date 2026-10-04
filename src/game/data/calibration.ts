// Empirical distributions mined from real NFL play-by-play (nflverse 2024-2025).
// scripts/mine_gamelogs.py → public/data/calibration.json

export interface Calibration {
  source: string
  totals: {
    plays: number
    rush: number
    pass: number
    complete: number
    incomplete: number
    sack: number
    int: number
    td: number
    first_down: number
    comp_rate: number
    sack_per_dropback: number
    int_per_att: number
    third_down_pct: number
  }
  runDist: Record<string, number>
  runCdf: Record<string, number>
  passDist: Record<string, number>
  passCdf: Record<string, number>
  byDown: Record<string, [number, number]>
  redZone: { rush: number; pass: number; td: number; plays: number; fg: number }
  goalLine: { rush: number; pass: number; td: number; plays: number }
  compByAirDepth: Record<string, number>
}

let cal: Calibration | null = null
let cfbCal: Calibration | null = null

/** Fallback table (real 2024-25 values) so the sim works before the fetch resolves. */
const FALLBACK: Calibration = {
  source: 'nflverse 2024-2025 (embedded fallback)',
  totals: {
    plays: 69682, rush: 30000, pass: 39682, complete: 0, incomplete: 0, sack: 0, int: 0,
    td: 0, first_down: 0, comp_rate: 0.6455, sack_per_dropback: 0.069, int_per_att: 0.0214, third_down_pct: 0.4353,
  },
  runDist: {
    '-6-': 0.0037, '-1to-5': 0.0826, '0': 0.083, '1-3': 0.3612, '4-6': 0.2408,
    '7-9': 0.113, '10-14': 0.0668, '15-24': 0.0341, '25-49': 0.0121, '50+': 0.0027,
  },
  runCdf: {
    '-6-': 0.0037, '-1to-5': 0.0863, '0': 0.1693, '1-3': 0.5305, '4-6': 0.7713,
    '7-9': 0.8843, '10-14': 0.9511, '15-24': 0.9852, '25-49': 0.9973, '50+': 1.0,
  },
  passDist: {
    '-6-': 0.0671, '-1to-5': 0.0546, '0': 0.0216, '1-4': 0.1563, '5-9': 0.3092,
    '10-14': 0.1713, '15-24': 0.1465, '25-49': 0.0654, '50+': 0.008,
  },
  passCdf: {
    '-6-': 0.0671, '-1to-5': 0.1217, '0': 0.1433, '1-4': 0.2996, '5-9': 0.6088,
    '10-14': 0.7801, '15-24': 0.9266, '25-49': 0.992, '50+': 1.0,
  },
  byDown: { '1': [16033, 14270], '2': [9463, 13583], '3': [3710, 10599], '4': [662, 1084] },
  redZone: { rush: 5405, pass: 5282, td: 2138, plays: 10687, fg: 0 },
  goalLine: { rush: 1667, pass: 723, td: 1145, plays: 2943 },
  compByAirDepth: { behind: 0.779, '0-2': 0.735, '3-5': 0.749, '6-10': 0.632, '11-15': 0.559, '16-20': 0.5, '21-30': 0.376, '31+': 0.293 },
}

export function getCalibration(tier: 'NFL' | 'FBS' = 'NFL'): Calibration {
  if (tier === 'FBS' && cfbCal) return cfbCal
  return cal ?? FALLBACK
}
export function setCalibration(c: Calibration | null) {
  cal = c
}
export async function loadCalibration(): Promise<Calibration | null> {
  if (cal && cfbCal) return cal
  try {
    const base = import.meta.env.BASE_URL ?? '/'
    const [nflRes, cfbRes] = await Promise.all([
      fetch(`${base}data/calibration.json`),
      fetch(`${base}data/calibration_cfb.json`),
    ])
    if (nflRes.ok) cal = (await nflRes.json()) as Calibration
    if (cfbRes.ok) cfbCal = (await cfbRes.json()) as Calibration
    return cal
  } catch {
    return null
  }
}

/** Sample a yardage bucket for a play type (0..1 random → bucket label). */
export function sampleBucket(cdf: Record<string, number>, r: number): string {
  let last = ''
  for (const [bucket, cum] of Object.entries(cdf)) {
    last = bucket
    if (r <= cum) return bucket
  }
  return last
}

/** Convert a bucket label into a concrete yard gain. */
export function bucketYards(bucket: string, rng: () => number, isPass: boolean): number {
  switch (bucket) {
    case '-6-': return -Math.round(6 + rng() * 6)
    case '-1to-5': return -Math.round(1 + rng() * 5)
    case '0': return 0
    case '1-3': return 1 + Math.floor(rng() * 3)
    case '1-4': return 1 + Math.floor(rng() * 4)
    case '4-6': return 4 + Math.floor(rng() * 3)
    case '5-9': return 5 + Math.floor(rng() * 5)
    case '7-9': return 7 + Math.floor(rng() * 3)
    case '10-14': return 10 + Math.floor(rng() * 5)
    case '15-24': return 15 + Math.floor(rng() * 10)
    case '25-49': return 25 + Math.floor(rng() * 25)
    case '50+': return 50 + Math.floor(rng() * (isPass ? 40 : 30))
    default: return 1 + Math.floor(rng() * 4)
  }
}

/**
 * CFB raw play-by-play carries more explosive plays than the college box score
 * reflects (long gains come against weaker opponents and blowouts). We sample the
 * real curve, then cap the outliers so per-game yards land near the FBS average.
 */
export const CFB_CHUNK_DAMP = { '25-49': 0.55, '50+': 0.3 }

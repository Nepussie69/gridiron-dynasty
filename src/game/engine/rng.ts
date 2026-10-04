// Deterministic RNG + small helpers shared across the engine.

export type Rng = () => number

export function makeRng(seed: number): Rng {
  let s = seed >>> 0
  return function rng() {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const rint = (rng: Rng, min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min
export const rpick = <T,>(rng: Rng, arr: T[]): T => arr[Math.floor(rng() * arr.length)]
export const rchance = (rng: Rng, p: number) => rng() < p

/** Random draw from a normal distribution (Box-Muller). */
export function gauss(rng: Rng, mean = 0, sd = 1) {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

/** Stable hash for an id + salt, useful for deterministic per-entity jitter. */
export function hash32(str: string, salt = 0) {
  let h = 2166136261 ^ salt
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

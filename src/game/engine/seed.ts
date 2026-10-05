// Seeded-run helpers: turn user input into a stable world seed and back again.

import { hash32 } from './rng'

const MOD = 2147483647

/**
 * Parse a raw seed input. Empty input means "no seed" (random).
 * Digits are used as-is; any other text is hashed so "HARSH" always means the
 * same league.
 */
export function parseSeed(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (/^\d+$/.test(trimmed)) return Number(trimmed) % MOD
  return hash32(trimmed.toUpperCase()) % MOD
}

/** Render a seed as the shareable `GD-` code. */
export function formatSeed(seed: number): string {
  return 'GD-' + seed.toString(36).toUpperCase()
}

/**
 * Parse a shareable code back to a seed. Accepts a `GD-XXXX` code, otherwise
 * falls back to the plain seed parser.
 */
export function parseSeedCode(code: string): number | null {
  const trimmed = code.trim()
  const match = /^GD-([0-9A-Z]+)$/i.exec(trimmed)
  if (match) {
    const decoded = parseInt(match[1], 36)
    if (!Number.isNaN(decoded)) return decoded % MOD
  }
  return parseSeed(code)
}

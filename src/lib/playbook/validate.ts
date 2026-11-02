/**
 * Checks on what the owner types into the Playbook, each returning a message
 * or null. Pure and client-safe: the dialog runs them as the owner types, and
 * the service runs them again before writing.
 */
import Decimal from 'decimal.js'
import type { ExtraTarget } from './types'

/** Leg ratings and the risk override are whole numbers 1–10. */
export function ratingProblem(rating: number | null): string | null {
  if (rating === null) return null
  return Number.isInteger(rating) && rating >= 1 && rating <= 10 ? null : 'A rating is a whole number from 1 to 10.'
}

function decimalOf(value: string): Decimal | null {
  try {
    const parsed = new Decimal(value)
    return parsed.isFinite() ? parsed : null
  } catch {
    return null
  }
}

/** Each price positive, each fraction in (0, 1], and the fractions together at most 1. */
export function extraTargetsProblem(targets: readonly ExtraTarget[]): string | null {
  let total = new Decimal(0)
  for (const target of targets) {
    const price = decimalOf(target.price)
    const fraction = decimalOf(target.fraction)
    if (!price || price.lte(0)) return 'Each target needs a price above zero.'
    if (!fraction || fraction.lte(0) || fraction.gt(1)) return 'Each target sells a fraction between 0 and 1.'
    total = total.add(fraction)
  }
  return total.gt(1) ? 'The extra targets sell more than the whole position.' : null
}

/**
 * A static plan's stop below entry and Target 1 above it — the other way round
 * the framework would invert, as `createExitRule` refuses support at or above
 * entry for the same reason.
 */
export function staticPlanProblem(
  entryPrice: Decimal | null,
  stop: Decimal | null,
  target1: Decimal | null,
): string | null {
  if (stop?.lte(0)) return 'The stop must be above zero.'
  if (entryPrice === null) return null
  if (stop?.gte(entryPrice)) return 'The stop must sit below the entry price.'
  if (target1?.lte(entryPrice)) return 'Target 1 must sit above the entry price.'
  return null
}

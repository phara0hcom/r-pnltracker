/**
 * The `?scope=` search parameter behind the All / NISA / 特定 switch.
 *
 * Kept apart from the component so routes can declare it without pulling in
 * React and a stylesheet — and so it is testable on its own, which matters:
 * the whole point of this parameter is that it survives every route.
 *
 * Named `scope`, deliberately not `account`. The Trades screen already owns
 * `account` for a different, four-way vocabulary (`NISA_GROWTH` and friends);
 * sharing the key meant the two filters overwrote each other and the switch was
 * lost the moment you visited Trades.
 */
import { z } from 'zod'
import { ACCOUNT_FILTERS, type AccountFilter } from './domain/types'

/**
 * `.catch()` like every other filter here: a stale bookmark or a hand-edited
 * URL falls back to the full view instead of erroring the route.
 */
export const accountScopeSchema = z.object({
  scope: z.enum(['ALL', 'NISA', 'SPECIFIC']).catch('ALL').optional(),
})

/**
 * For routes that do not offer the switch but must not swallow it. A zod object
 * strips unknown keys, so without declaring the field those screens silently
 * discard the value and it cannot come back.
 */
export const accountScopePassthrough = accountScopeSchema

/** Narrow an untrusted search value to the three buckets. */
export function toAccountFilter(raw: unknown): AccountFilter {
  return ACCOUNT_FILTERS.includes(raw as AccountFilter) ? (raw as AccountFilter) : 'ALL'
}

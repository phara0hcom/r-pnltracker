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
 *
 * Routes that do not offer the switch still have to declare this, because a zod
 * object strips unknown keys — without it those screens silently discard the
 * value and it cannot come back.
 */
export const accountScopeSchema = z.object({
  scope: z.enum(['ALL', 'NISA', 'SPECIFIC']).catch('ALL').optional(),
})

/** Narrow an untrusted search value to the three buckets. */
export function toAccountFilter(raw: unknown): AccountFilter {
  return ACCOUNT_FILTERS.includes(raw as AccountFilter) ? (raw as AccountFilter) : 'ALL'
}

/**
 * The same narrowing as a server-function `.validator`.
 *
 * Shared rather than written per screen so the client and the server cannot
 * disagree about what a bad `scope` means: both degrade to the full view, never
 * throw. A validator that rejected instead would turn a stale bookmark into a
 * 500 on a screen the URL was only mildly wrong about.
 */
export function accountFilterInput(data?: { account?: string }): { account: AccountFilter } {
  return { account: toAccountFilter(data?.account) }
}

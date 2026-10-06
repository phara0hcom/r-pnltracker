/**
 * The `?market=` search parameter and the server input behind the Positions
 * screen's All / JP / US switch.
 *
 * Its own key, beside `scope` rather than folded into it: the two answer
 * independent questions — taxed or not, yen or dollars — and a user can hold
 * any combination, so one parameter would have to enumerate all six.
 */
import { z } from 'zod'
import { accountFilterInput } from './accountScope'
import { MARKET_FILTERS, type AccountFilter, type MarketFilter } from './domain/types'

/**
 * `.catch()` like `accountScopeSchema`: a stale bookmark or a hand-edited URL
 * falls back to both markets instead of erroring the route. `ALL` is the default
 * and is left out of the URL, so the unfiltered view keeps its clean address.
 */
export const marketScopeSchema = z.object({
  market: z.enum(['ALL', 'JP', 'US']).catch('ALL').optional(),
})

/** Narrow an untrusted search value to the three choices. */
export function toMarketFilter(raw: unknown): MarketFilter {
  return MARKET_FILTERS.includes(raw as MarketFilter) ? (raw as MarketFilter) : 'ALL'
}

/**
 * The account and market together, as a server-function `.validator`.
 *
 * Built from `accountFilterInput` so both halves degrade the same way — to the
 * full view, never to a thrown 500 on a screen the URL was only mildly wrong about.
 */
export function positionsInput(data?: { account?: string; market?: string }): {
  account: AccountFilter
  market: MarketFilter
} {
  return { ...accountFilterInput(data), market: toMarketFilter(data?.market) }
}

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
 * A stale bookmark or a hand-edited URL falls back to both markets instead of
 * erroring the route — and falls back to *absent*, not to `'ALL'`. `ALL` is the
 * default and is kept out of the URL; catching to the value itself would hand
 * it to the next `(prev) => ({ ...prev, … })` navigation, which would write
 * `?market=ALL` into the address on the first click of a column header.
 */
export const marketScopeSchema = z.object({
  market: z.enum(MARKET_FILTERS).optional().catch(undefined),
})

/**
 * The `market` search param for a choice: absent for both markets. The one
 * place `ALL` is kept out of the URL — the switch and every link use it.
 */
export const marketParam = (market: MarketFilter): Exclude<MarketFilter, 'ALL'> | undefined =>
  market === 'ALL' ? undefined : market

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

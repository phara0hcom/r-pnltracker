/**
 * Writes into the shared price cache.
 *
 * `price_cache` is deliberately global — one row per instrument, no `userId` —
 * because a quote is market data and is the same for everyone. That is what
 * lets the TradingView webhook write here at all: it is unauthenticated, so it
 * has no user to file a price under, and it does not need one.
 *
 * A hand-entered `price_overrides` row still wins, because the screens resolve
 * `override ?? cached`. Nothing here has to know about overrides.
 */
import { lt } from 'drizzle-orm'
import { priceCache } from './schema'
import { db } from './index'
import type { AssetClass } from '~/lib/domain/types'
import { feedCurrencyFor } from '~/lib/prices/feed'

export interface FeedClose {
  instrumentId: string
  assetClass: AssetClass
  close: string
  /** When the bar closed — see the caller for why this is delivery time. */
  asOf: Date
}

/**
 * Publishes a daily bar's close as the instrument's current price.
 *
 * Conditional on `asOf`, in the statement rather than around it. Two writers
 * touch this row — the webhook and `refreshPrices` — and a read-then-write
 * would let a slow delivery overwrite a quote fetched while it was in flight.
 * `setWhere` makes the row move forward in time or not at all.
 *
 * Returns whether the row actually moved, which is only ever used for logging:
 * a skipped write means something fresher was already there, and that is a
 * correct outcome rather than a failure.
 */
export async function cacheFeedClose(input: FeedClose): Promise<boolean> {
  const currency = feedCurrencyFor(input.assetClass)
  if (currency === null) return false

  const written = await db
    .insert(priceCache)
    .values({
      instrumentId: input.instrumentId,
      price: input.close,
      currency,
      asOf: input.asOf,
      source: 'FEED',
    })
    .onConflictDoUpdate({
      target: priceCache.instrumentId,
      set: {
        price: input.close,
        currency,
        asOf: input.asOf,
        source: 'FEED',
        fetchedAt: new Date(),
      },
      setWhere: lt(priceCache.asOf, input.asOf),
    })
    .returning({ instrumentId: priceCache.instrumentId })

  return written.length > 0
}

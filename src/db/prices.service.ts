/**
 * The only writer of the shared price cache.
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

/**
 * The sources the column accepts, read off the schema rather than restated.
 *
 * `PriceSource` in `lib/prices/providers.ts` is deliberately narrower: it is
 * what a *provider* may return, and no provider returns `FEED`. Inferring this
 * one means adding a source to the schema cannot leave a second list behind.
 */
type CachedSource = (typeof priceCache.$inferInsert)['source']

export interface CachedQuote {
  instrumentId: string
  price: string
  currency: 'JPY' | 'USD'
  asOf: Date
  source: CachedSource
}

/**
 * Upserts one row, and reports whether the row actually moved.
 *
 * Two callers reach this — the Refresh button in Settings and the TradingView
 * webhook — and stating the columns and the conflict target once is the point:
 * a column added to `price_cache` has one write to update, not two that can
 * silently disagree about what a cached price consists of.
 *
 * `onlyIfNewer` refuses to go backwards in time, in the statement rather than
 * around it. A read-then-write would let a slow write overwrite a value that
 * landed while it was in flight, and both callers can be slow.
 *
 * It is off by default, and the refresh path leaves it off deliberately. The
 * two timestamps are not as comparable as they look: a feed bar is stamped with
 * its *delivery* time, while a provider stamps the same close with the *market*
 * time a few seconds earlier. Guarding refresh would make a press of the button
 * immediately after a bar landed skip, count nothing updated, and so look
 * broken while behaving correctly.
 */
export async function cacheQuote(
  quote: CachedQuote,
  { onlyIfNewer = false }: { onlyIfNewer?: boolean } = {},
): Promise<boolean> {
  const written = await db
    .insert(priceCache)
    .values({
      instrumentId: quote.instrumentId,
      price: quote.price,
      currency: quote.currency,
      asOf: quote.asOf,
      source: quote.source,
    })
    .onConflictDoUpdate({
      target: priceCache.instrumentId,
      set: {
        price: quote.price,
        currency: quote.currency,
        asOf: quote.asOf,
        source: quote.source,
        fetchedAt: new Date(),
      },
      setWhere: onlyIfNewer ? lt(priceCache.asOf, quote.asOf) : undefined,
    })
    .returning({ instrumentId: priceCache.instrumentId })

  return written.length > 0
}

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
 * Guarded, unlike the refresh path: a replayed bar is a thing that actually
 * happens here — TradingView resends after a chart reload — and its close must
 * not become the current price. A skipped write means something fresher was
 * already there, which is a correct outcome rather than a failure.
 */
export async function cacheFeedClose(input: FeedClose): Promise<boolean> {
  const currency = feedCurrencyFor(input.assetClass)
  if (currency === null) return false

  return cacheQuote(
    {
      instrumentId: input.instrumentId,
      price: input.close,
      currency,
      asOf: input.asOf,
      source: 'FEED',
    },
    { onlyIfNewer: true },
  )
}

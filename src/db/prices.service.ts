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
import { eq, lt, sql } from 'drizzle-orm'
import { exitFeedBars, priceCache } from './schema'
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
 *
 * `onlyIfNewestBar` is the feed's second guard, and is described where it is
 * used. Both are conditions on the row being written, which is why the values
 * go in through a `select` rather than `values` — one statement shape, gated or
 * not, so the two callers cannot drift apart in what a cached price consists
 * of.
 */
export async function cacheQuote(
  quote: CachedQuote,
  {
    onlyIfNewer = false,
    onlyIfNewestBar,
  }: { onlyIfNewer?: boolean; onlyIfNewestBar?: string } = {},
): Promise<boolean> {
  const written = await db
    .insert(priceCache)
    .select(
      // Column for column, in table order — `insert … select` requires it. Each
      // value is bound through its own column so it is encoded exactly as
      // `values()` would have: a bare `Date` reaches the driver as local time,
      // and lands in a `timestamp` column shifted by the process's UTC offset.
      db
        .select({
          instrumentId: sql`${sql.param(quote.instrumentId, priceCache.instrumentId)}`.as('instrument_id'),
          price: sql`${sql.param(quote.price, priceCache.price)}`.as('price'),
          currency: sql`${sql.param(quote.currency, priceCache.currency)}`.as('currency'),
          asOf: sql`${sql.param(quote.asOf, priceCache.asOf)}`.as('as_of'),
          source: sql`${sql.param(quote.source, priceCache.source)}`.as('source'),
          fetchedAt: sql`${sql.param(new Date(), priceCache.fetchedAt)}`.as('fetched_at'),
        })
        .from(sql`(select 1) as row`)
        .where(onlyIfNewestBar === undefined ? undefined : newestBarIs(quote.instrumentId, onlyIfNewestBar)),
    )
    .onConflictDoUpdate({
      target: priceCache.instrumentId,
      set: {
        price: sql`excluded.price`,
        currency: sql`excluded.currency`,
        asOf: sql`excluded.as_of`,
        source: sql`excluded.source`,
        fetchedAt: sql`excluded.fetched_at`,
      },
      setWhere: onlyIfNewer ? lt(priceCache.asOf, sql`excluded.as_of`) : undefined,
    })
    .returning({ instrumentId: priceCache.instrumentId })

  return written.length > 0
}

/**
 * True when no bar later than `tradingDay` is held for the instrument.
 *
 * Asked inside the write rather than before it. The webhook used to read the
 * newest day back in a statement of its own and then decide, which cost a round
 * trip and still left a gap: a later bar could commit between the read and the
 * write. Here the two are one statement, so the answer cannot go stale between
 * being given and being used.
 */
function newestBarIs(instrumentId: string, tradingDay: string) {
  return sql`${tradingDay}::date >= coalesce((select max(${exitFeedBars.tradingDay}) from ${exitFeedBars}
    where ${eq(exitFeedBars.instrumentId, sql`${sql.param(instrumentId, exitFeedBars.instrumentId)}`)}), ${tradingDay}::date)`
}

export interface FeedClose {
  instrumentId: string
  assetClass: AssetClass
  close: string
  /** When the bar closed — see the caller for why this is delivery time. */
  asOf: Date
  /** The bar's own session date, which decides whether its close is current. */
  tradingDay: string
}

/**
 * Publishes a daily bar's close as the instrument's current price.
 *
 * Guarded twice, unlike the refresh path, because a replayed bar is a thing
 * that actually happens here — TradingView resends after a chart reload — and
 * its close must not become the current price. `onlyIfNewestBar` refuses a bar
 * that a later session has already superseded; `onlyIfNewer` refuses a delivery
 * that a fresher quote has overtaken. A skipped write means something better
 * was already there, which is a correct outcome rather than a failure.
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
    { onlyIfNewer: true, onlyIfNewestBar: input.tradingDay },
  )
}

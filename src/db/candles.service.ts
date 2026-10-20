/**
 * The candle store the playbook alert writes and chart capture reads.
 */
import { and, asc, desc, eq, gt, lte, sql } from 'drizzle-orm'
import { candleBars } from './schema'
import { db } from './index'
import { BARS_AFTER, BARS_BEFORE, type CandleDelivery } from '~/lib/playbook/candles'
import type { Candle } from '~/lib/playbook/types'

/**
 * One statement for the whole delivery.
 *
 * The route answers TradingView before this runs (see its header), but a
 * statement per bar would still hold a pooled connection for 30 round trips
 * on every bar close of every chart carrying the alert.
 */
export async function storeCandles(delivery: CandleDelivery): Promise<number> {
  if (delivery.bars.length === 0) return 0
  const rows = delivery.bars.map((bar) => ({
    ticker: delivery.ticker,
    interval: delivery.interval,
    barTime: new Date(bar.t),
    exchange: delivery.exchange,
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
  }))
  const stored = await db
    .insert(candleBars)
    .values(rows)
    .onConflictDoUpdate({
      target: [candleBars.ticker, candleBars.interval, candleBars.barTime],
      // The newest delivery wins: the bar still forming when one alert fired
      // is final by the next.
      set: {
        open: sql`excluded.open`,
        high: sql`excluded.high`,
        low: sql`excluded.low`,
        close: sql`excluded.close`,
        volume: sql`excluded.volume`,
        exchange: sql`excluded.exchange`,
        receivedAt: new Date(),
      },
    })
    .returning({ barTime: candleBars.barTime })
  return stored.length
}

const toCandle = (row: typeof candleBars.$inferSelect): Candle => ({
  t: row.barTime.getTime(),
  o: row.open,
  h: row.high,
  l: row.low,
  c: row.close,
  v: row.volume,
})

/**
 * The stored bars a chart around `from`…`to` needs: `BARS_BEFORE` up to the
 * first fill, everything between, and `BARS_AFTER` beyond the last.
 *
 * Counted in bars rather than a time range, because a range wide enough for
 * an hourly chart over a weekend is wildly wrong for a weekly one.
 */
export async function storedCandles(
  ticker: string,
  interval: string,
  from: number,
  to: number,
): Promise<Candle[]> {
  const series = and(eq(candleBars.ticker, ticker), eq(candleBars.interval, interval))
  const [before, between, after] = await Promise.all([
    db
      .select()
      .from(candleBars)
      .where(and(series, lte(candleBars.barTime, new Date(from))))
      .orderBy(desc(candleBars.barTime))
      .limit(BARS_BEFORE),
    db
      .select()
      .from(candleBars)
      .where(
        and(series, gt(candleBars.barTime, new Date(from)), lte(candleBars.barTime, new Date(to))),
      )
      .orderBy(asc(candleBars.barTime)),
    db
      .select()
      .from(candleBars)
      .where(and(series, gt(candleBars.barTime, new Date(Math.max(from, to)))))
      .orderBy(asc(candleBars.barTime))
      .limit(BARS_AFTER),
  ])
  return [...before.reverse(), ...between, ...after].map(toCandle)
}

/** Which timeframes have bars for a ticker — what the capture menu can offer from TradingView. */
export async function storedIntervals(
  ticker: string,
): Promise<{ interval: string; bars: number; latest: Date }[]> {
  const rows = await db
    .select({
      interval: candleBars.interval,
      bars: sql<number>`count(*)::int`,
      latest: sql<Date>`max(${candleBars.barTime})`,
    })
    .from(candleBars)
    .where(eq(candleBars.ticker, ticker))
    .groupBy(candleBars.interval)
  return rows.map((row) => ({ ...row, latest: new Date(row.latest) }))
}

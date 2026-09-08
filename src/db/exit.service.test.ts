/**
 * The shape of the statement one delivery sends.
 *
 * The webhook is only ever hit in bursts — every alert of the day fires at the
 * same close — and each round trip is paid per delivery against a database on
 * another continent. So the thing worth pinning is not what the SQL computes
 * but how much of it there is: resolving the ticker, upserting the bar and
 * backfilling the entry ATR are one statement, and a change that quietly splits
 * them again is a change that halves how many alerts can land together.
 *
 * No database: drizzle builds the statement locally, so a proxy driver that
 * records the SQL instead of executing it exercises the real query builder.
 * Whether Postgres honours the upsert and runs a CTE it never reads is the
 * server's business, and is asked of a real one in `priceCache.db.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const recorder = vi.hoisted(() => ({
  sent: [] as { sql: string; params: unknown[] }[],
  /** The row the outer select returns — empty stands for an unknown ticker. */
  rows: [['i1', '7203', 'JP_EQUITY', '2026-09-04', 0]] as unknown[][],
}))

vi.mock('~/db/index', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy')
  return {
    db: drizzle((sql: string, params: unknown[]) => {
      recorder.sent.push({ sql, params })
      return Promise.resolve({ rows: recorder.rows })
    }),
  }
})

const { storeFeedBar } = await import('./exit.service')

const delivery = (jp: string, us = jp) => ({
  ticker: '7203',
  tradingDay: { jp, us },
  barTime: new Date(`${jp}T06:00:00Z`),
  exchange: 'TSE',
  close: '2684',
  sma10: '2700',
  sma20: '2750',
  rsi14: '31.4',
  macd: '-12',
  macdSignal: '-10',
  macdHist: '-2',
  atr14: '88',
})

const only = () => {
  expect(recorder.sent).toHaveLength(1)
  return recorder.sent[0]!
}

beforeEach(() => {
  recorder.sent.length = 0
  recorder.rows = [['i1', '7203', 'JP_EQUITY', '2026-09-04', 0]]
})

describe('storeFeedBar', () => {
  it('sends one statement, not three', async () => {
    await storeFeedBar(delivery('2026-09-04'))

    const { sql } = only()
    expect(sql).toContain('insert into "exit_feed_bars"')
    expect(sql).toContain('update "exit_rules"')
    expect(sql).toContain('from "instruments"')
  })

  it('picks the trading day from the asset class the row already carries', async () => {
    // The zone `zoneFor` falls back to depends on the asset class, and only the
    // database holds it. Choosing in SQL is what lets the lookup and the write
    // be one statement instead of two — see `tradingDayCandidates`.
    await storeFeedBar(delivery('2026-09-04', '2026-09-03'))

    const { sql, params } = only()
    expect(sql).toContain(`case when "asset_class" = 'US_EQUITY'`)
    expect(params).toContain('2026-09-03')
    expect(params).toContain('2026-09-04')
  })

  it('upserts on (instrument, day), so a resent bar corrects rather than duplicates', async () => {
    // TradingView fires twice for the same close after a chart reload, and a
    // duplicated bar would distort the five-reading momentum window.
    await storeFeedBar(delivery('2026-09-04'))

    expect(only().sql).toContain('on conflict ("instrument_id","trading_day") do update')
  })

  it('backfills only an entry ATR that is still missing, for that day alone', async () => {
    // Not a recalculation — the framework forbids those. It completes a value
    // that was missing because the alert postdates the position.
    await storeFeedBar(delivery('2026-09-04'))

    const { sql } = only()
    expect(sql).toContain('"exit_rules"."entry_atr" is null')
    expect(sql).toContain('"exit_rules"."entry_date" = "trading_day"')
  })

  it('reports what the delivery resolved to', async () => {
    recorder.rows = [['i7', '7203', 'JP_EQUITY', '2026-09-04', 2]]

    expect(await storeFeedBar(delivery('2026-09-04'))).toEqual({
      instrumentId: 'i7',
      symbol: '7203',
      assetClass: 'JP_EQUITY',
      tradingDay: '2026-09-04',
      backfilled: 2,
    })
  })

  it('returns nothing when no instrument carries the ticker', async () => {
    // The resolve is a CTE, so an unknown ticker writes nothing and selects
    // nothing — one statement still answers both questions.
    recorder.rows = []

    expect(await storeFeedBar(delivery('2026-09-04'))).toBeNull()
  })
})

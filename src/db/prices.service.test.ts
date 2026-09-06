/**
 * The guard on the price cache, read off the SQL that is actually sent.
 *
 * This table has two writers with deliberately different rules — the feed
 * refuses to go backwards in time, the refresh button always writes — and the
 * difference is one optional clause that is invisible at every call site. The
 * tempting cleanup is to "unify" them, which would silently break one of the
 * two; the tempting simplification is to drop `onlyIfNewer`, which would let a
 * replayed bar overwrite a newer price. Neither shows up on screen.
 *
 * No database: drizzle builds the statement locally, so a proxy driver that
 * records the SQL instead of executing it exercises the real query builder.
 * That means this pins *what is sent*, not that Postgres honours it — the
 * behaviour of `on conflict … where` is Postgres's business, not ours.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Shared with the mock below, which is hoisted above these imports. */
const recorder = vi.hoisted(() => {
  const sent: { sql: string; params: unknown[] }[] = []
  /** Rows the fake returns — `cacheQuote` reads its length to report a write. */
  const rows: unknown[][] = [['i1']]
  return { sent, rows }
})

vi.mock('~/db/index', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy')
  return {
    db: drizzle((sql: string, params: unknown[]) => {
      recorder.sent.push({ sql, params })
      return Promise.resolve({ rows: recorder.rows })
    }),
  }
})

const { cacheFeedClose, cacheQuote } = await import('./prices.service')

const only = () => {
  expect(recorder.sent).toHaveLength(1)
  return recorder.sent[0]!
}

beforeEach(() => {
  recorder.sent.length = 0
  recorder.rows.splice(0, recorder.rows.length, ['i1'])
})

const QUOTE = {
  instrumentId: 'i1',
  price: '214.30',
  currency: 'USD' as const,
  asOf: new Date('2026-09-04T20:00:00Z'),
  source: 'FINNHUB' as const,
}

describe('cacheQuote', () => {
  it('writes unconditionally by default, which is what the Refresh button needs', async () => {
    // A feed bar is stamped with its delivery time and a provider stamps the
    // same close with the market time seconds earlier, so guarding this path
    // would make a press right after a bar landed skip and count nothing.
    await cacheQuote(QUOTE)
    expect(only().sql).not.toContain('where')
  })

  it('adds an as_of comparison when asked not to go backwards', async () => {
    await cacheQuote(QUOTE, { onlyIfNewer: true })
    const { sql, params } = only()
    expect(sql).toContain('on conflict')
    expect(sql).toContain('where "price_cache"."as_of" <')
    // The comparison is against the incoming timestamp, and the last parameter
    // is that bound. Worth asserting separately from the clause: bound to
    // `now()` instead — a plausible slip, since `fetchedAt` is right beside it
    // in the same statement — the guard would still read correctly in the SQL
    // and would let every late delivery through.
    expect(params.at(-1)).toBe(QUOTE.asOf.toISOString())
  })

  it('reports whether the row actually moved', async () => {
    expect(await cacheQuote(QUOTE, { onlyIfNewer: true })).toBe(true)
    recorder.rows.length = 0
    expect(await cacheQuote(QUOTE, { onlyIfNewer: true })).toBe(false)
  })
})

describe('cacheFeedClose', () => {
  const BAR = {
    instrumentId: 'i1',
    close: '2684',
    asOf: new Date('2026-09-04T06:00:00Z'),
  }

  it('is always guarded — a replayed bar must not become the current price', async () => {
    await cacheFeedClose({ ...BAR, assetClass: 'JP_EQUITY' })
    expect(only().sql).toContain('where "price_cache"."as_of" <')
  })

  it('files the close under the market its instrument trades in', async () => {
    await cacheFeedClose({ ...BAR, assetClass: 'JP_EQUITY' })
    expect(only().params).toContain('JPY')

    recorder.sent.length = 0
    await cacheFeedClose({ ...BAR, assetClass: 'US_EQUITY' })
    expect(only().params).toContain('USD')
  })

  it('marks the row FEED, so Settings can tell it from a fetched quote', async () => {
    await cacheFeedClose({ ...BAR, assetClass: 'US_EQUITY' })
    expect(only().params).toContain('FEED')
  })

  it('sends no statement at all for a fund', async () => {
    // 基準価額 is quoted per 10,000 口. Refusing before the query is what makes
    // the rule unconditional rather than something the database might allow.
    expect(await cacheFeedClose({ ...BAR, assetClass: 'FUND' })).toBe(false)
    expect(recorder.sent).toHaveLength(0)
  })
})

/**
 * The price cache against a real Postgres.
 *
 * Everything else about these writes can be checked without a database — that
 * the guard clause is emitted, that a fund sends no statement at all. What
 * cannot is the only thing that actually protects the price: whether Postgres
 * honours `on conflict … do update … where`, and therefore whether a bar that
 * arrives late is refused or quietly overwrites a newer quote. That is a claim
 * about the server, and the only honest way to test it is to ask one.
 *
 * The schema comes from `drizzle/0000_baseline.sql`, so this doubles as a check
 * that the baseline still builds a database from nothing.
 *
 * Not part of `npm test` — see `vitest.config.ts`. Run with `npm run test:db`,
 * and it skips itself when no container runtime is present.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type * as ExitService from './exit.service'
import type * as PricesService from './prices.service'

/**
 * Finds a container runtime and points testcontainers at it.
 *
 * A socket check rather than a trial container: this decides whether the suite
 * reports "skipped" or spends two minutes timing out, so it has to be quick and
 * certain. Covers Docker and Podman, including the machine socket Podman
 * Desktop creates — testcontainers looks for Docker's paths only, so a Podman
 * socket has to be handed to it through `DOCKER_HOST` or it finds nothing.
 *
 * Returns whether the suite can run at all.
 */
function findContainerRuntime(): boolean {
  const home = process.env.HOME ?? ''

  // An explicit DOCKER_HOST is the developer's decision; never second-guess it.
  const host =
    process.env.DOCKER_HOST ??
    [
      `${home}/.local/share/containers/podman/machine/podman.sock`,
      `${home}/.docker/run/docker.sock`,
      '/var/run/docker.sock',
    ]
      .filter((path) => existsSync(path))
      .map((path) => `unix://${path}`)[0]

  if (host === undefined) return false
  process.env.DOCKER_HOST = host

  /*
   * Ryuk is testcontainers' reaper: a sidecar that bind-mounts the container
   * socket and removes anything left behind if the run is killed. On macOS a
   * Podman machine socket cannot be bind-mounted at all — the daemon answers
   * `statfs … operation not supported` — so with Podman the reaper is not
   * optional to skip, it simply cannot start.
   *
   * The cost is the safety net, not correctness: `afterAll` stops the container
   * on any normal finish, including a failing test. Only a hard kill mid-run
   * can strand one, and `podman ps` / `podman rm` clears it.
   */
  if (host.includes('podman')) process.env.TESTCONTAINERS_RYUK_DISABLED ??= 'true'

  return true
}

/** The schema, in the order `drizzle/meta/_journal.json` says it was built. */
function migrationFiles(): string[] {
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
    entries: { tag: string }[]
  }
  return journal.entries.map((entry) => join('drizzle', `${entry.tag}.sql`))
}

const available = findContainerRuntime()

let container: StartedPostgreSqlContainer | undefined
let sql: Pool | undefined
let prices: typeof PricesService | undefined
let exits: typeof ExitService | undefined
/** The pool the services share, so teardown can close it before the server goes. */
let servicePool: { end: () => Promise<void> } | undefined

const INSTRUMENT = 'i-test-1'
/** Exit plans are user-scoped, so the backfill needs an owner to hang one on. */
const USER = 'u-test-1'

beforeAll(async () => {
  if (!available) return

  container = await new PostgreSqlContainer('postgres:17-alpine').start()

  /*
   * Set before the services are imported, not after: `db/index.ts` reads
   * DATABASE_URL at module scope and builds its pool once, so a static import
   * would have already connected to whatever the environment said at load.
   */
  process.env.DATABASE_URL = container.getConnectionUri()

  sql = new Pool({ connectionString: container.getConnectionUri() })
  /*
   * The baseline plus every migration after it, in the journal's own order.
   * Reading only the baseline was enough while it was the whole schema, and
   * stopped being enough the moment one table arrived in a later file — the
   * suite then failed on a table the application had and the test database did
   * not, which reads as a code fault rather than a fixture one.
   */
  for (const file of migrationFiles()) {
    await sql.query(readFileSync(file, 'utf8').replaceAll('--> statement-breakpoint', ''))
  }
  await sql.query(
    `insert into instruments (id, symbol, name, asset_class, currency)
     values ($1, '7203', 'トヨタ自動車', 'JP_EQUITY', 'JPY')`,
    [INSTRUMENT],
  )
  await sql.query(
    `insert into "user" (id, name, email, email_verified, created_at, updated_at)
     values ($1, 'owner', 'owner@example.com', true, now(), now())`,
    [USER],
  )

  prices = await import('./prices.service')
  exits = await import('./exit.service')
  servicePool = (await import('./index')).db.$client
})

afterAll(async () => {
  /*
   * Order matters. `db/index.ts` opens a pool at module scope and keeps its
   * connections open; stopping the container first severs them mid-flight and
   * `pg` raises "Connection terminated unexpectedly" with no test to attach it
   * to. Vitest reports that as an unhandled error and warns it may be masking a
   * real failure — so the clients are closed before the server they point at.
   */
  await sql?.end()
  await servicePool?.end()
  await container?.stop()
})

/** The single cached row, or undefined. */
async function cached(): Promise<{ price: string; source: string; currency: string } | undefined> {
  const { rows } = await sql!.query<{ price: string; source: string; currency: string }>(
    'select price, source, currency from price_cache where instrument_id = $1',
    [INSTRUMENT],
  )
  return rows[0]
}

const LATER = new Date('2026-09-04T20:00:00Z')
const EARLIER = new Date('2026-09-04T19:00:00Z')

/**
 * Puts a known row in place, so a test that needs a starting price says so.
 *
 * Written through the service rather than raw SQL: `numeric(24,8)` round-trips
 * through the same path the assertions read back, so an expected value never
 * has to guess at the scale.
 */
async function seed(price: string, asOf: Date): Promise<void> {
  await prices!.cacheQuote({
    instrumentId: INSTRUMENT,
    price,
    currency: 'JPY',
    asOf,
    source: 'FINNHUB',
  })
}

/*
 * Every test starts from an empty cache, no bars and no plans.
 *
 * These ran in order and each leaned on the row the last one left, which passes
 * only while the whole file runs start to finish — and the first thing anyone
 * does with a failure is re-run that one test on its own.
 */
beforeEach(async () => {
  if (!available) return
  await sql!.query('delete from price_cache')
  await sql!.query('delete from exit_feed_bars')
  await sql!.query('delete from exit_rules')
  await sql!.query('delete from exit_feed_deliveries')
})

describe.skipIf(!available)('price cache, against a real Postgres', () => {
  it('accepts the FEED source, proving the enum migration landed', async () => {
    // If drizzle/0004 had not been applied this insert is what would fail, and
    // it is the failure the webhook catches and logs rather than 500s on.
    await expect(
      prices!.cacheQuote({
        instrumentId: INSTRUMENT,
        price: '100',
        currency: 'JPY',
        asOf: EARLIER,
        source: 'FEED',
      }),
    ).resolves.toBe(true)
    expect((await cached())?.source).toBe('FEED')
  })

  it('refuses to move the price backwards when guarded', async () => {
    await seed('500', LATER)

    const wrote = await prices!.cacheQuote(
      { instrumentId: INSTRUMENT, price: '999', currency: 'JPY', asOf: EARLIER, source: 'FEED' },
      { onlyIfNewer: true },
    )

    // This is the assertion the whole file exists for.
    expect(wrote).toBe(false)
    expect((await cached())?.price).toBe('500.00000000')
  })

  it('refuses an equal timestamp, which is not newer', async () => {
    await seed('500', LATER)

    const wrote = await prices!.cacheQuote(
      { instrumentId: INSTRUMENT, price: '999', currency: 'JPY', asOf: LATER, source: 'FEED' },
      { onlyIfNewer: true },
    )

    // A redelivery of the bar already stored carries the same stamp. Nothing to
    // do, and `<` rather than `<=` is what makes that a no-op.
    expect(wrote).toBe(false)
    expect((await cached())?.price).toBe('500.00000000')
  })

  it('lets a genuinely newer reading through', async () => {
    await seed('500', EARLIER)

    const wrote = await prices!.cacheQuote(
      { instrumentId: INSTRUMENT, price: '750', currency: 'JPY', asOf: LATER, source: 'FEED' },
      { onlyIfNewer: true },
    )
    expect(wrote).toBe(true)
    expect((await cached())?.price).toBe('750.00000000')
  })

  it('overwrites regardless when unguarded, which is what Refresh relies on', async () => {
    // Seeded *newer* than the write that follows, so only the absence of the
    // guard can explain the overwrite.
    await seed('500', LATER)

    const wrote = await prices!.cacheQuote({
      instrumentId: INSTRUMENT,
      price: '123',
      currency: 'JPY',
      asOf: EARLIER,
      source: 'FINNHUB',
    })
    expect(wrote).toBe(true)
    expect((await cached())?.price).toBe('123.00000000')
  })

  it('publishes a bar close as FEED, guarded, in the instrument’s currency', async () => {
    const wrote = await prices!.cacheFeedClose({
      instrumentId: INSTRUMENT,
      assetClass: 'JP_EQUITY',
      close: '2684',
      asOf: LATER,
      tradingDay: '2026-09-04',
    })
    expect(wrote).toBe(true)
    expect(await cached()).toMatchObject({ price: '2684.00000000', source: 'FEED', currency: 'JPY' })

    // A replayed bar, stamped before the row it would overwrite.
    const replay = await prices!.cacheFeedClose({
      instrumentId: INSTRUMENT,
      assetClass: 'JP_EQUITY',
      close: '1',
      asOf: EARLIER,
      tradingDay: '2026-09-04',
    })
    expect(replay).toBe(false)
    expect((await cached())?.price).toBe('2684.00000000')
  })

  it('never writes a fund, whose price is on a different scale', async () => {
    await seed('500', EARLIER)

    expect(
      await prices!.cacheFeedClose({
        instrumentId: INSTRUMENT,
        assetClass: 'FUND',
        close: '12345',
        // Newer than the seeded row, so the guard cannot be what stops it.
        asOf: new Date('2027-01-01T00:00:00Z'),
        tradingDay: '2026-09-04',
      }),
    ).toBe(false)
    expect((await cached())?.price).toBe('500.00000000')
  })
})

describe.skipIf(!available)('feed bars, against a real Postgres', () => {
  const delivery = (tradingDay: string, close: string, ticker = '7203') => ({
    ticker,
    // Both zones agree here, so these tests are about the write rather than
    // about which day the bar belongs to — `webhook.test.ts` covers that.
    tradingDay: { jp: tradingDay, us: tradingDay },
    barTime: new Date(`${tradingDay}T06:00:00Z`),
    exchange: 'TSE',
    close,
    sma10: '2700',
    sma20: '2750',
    rsi14: '31.4',
    macd: '-12',
    macdSignal: '-10',
    macdHist: '-2',
    atr14: '88',
  })

  /** The plan the ATR backfill is aimed at, with its entry ATR still missing. */
  async function plan(entryDate: string, entryAtr: string | null = null): Promise<void> {
    await sql!.query(
      `insert into exit_rules (id, user_id, instrument_id, account_type, entry_date,
         entry_price, total_shares, support_level, entry_atr, lot_size)
       values ('rule-1', $1, $2, 'SPECIFIC', $3, '2500', '100', '2400', $4, 100)`,
      [USER, INSTRUMENT, entryDate, entryAtr],
    )
  }

  const entryAtr = async (): Promise<string | null> => {
    const { rows } = await sql!.query<{ entry_atr: string | null }>(
      'select entry_atr from exit_rules where id = $1',
      ['rule-1'],
    )
    return rows[0]?.entry_atr ?? null
  }

  it('resolves, upserts and backfills in one statement', async () => {
    await plan('2026-09-04')

    const stored = await exits!.storeFeedBar(delivery('2026-09-04', '2684'))

    // The whole point of the fused statement: the ticker resolved, the bar
    // landed and the plan was completed without a second round trip.
    expect(stored).toMatchObject({
      instrumentId: INSTRUMENT,
      symbol: '7203',
      assetClass: 'JP_EQUITY',
      tradingDay: '2026-09-04',
      backfilled: 1,
    })
    expect(await entryAtr()).toBe('88.00000000')
  })

  it('writes the bar even though nothing reads the CTE back', async () => {
    // A data-modifying CTE runs to completion whether or not the outer query
    // selects from it. That is a claim about Postgres, and the fused statement
    // rests on it entirely — the insert's output is never read.
    await exits!.storeFeedBar(delivery('2026-09-04', '2684'))

    const { rows } = await sql!.query<{ close: string }>(
      'select close::text as close from exit_feed_bars where instrument_id = $1',
      [INSTRUMENT],
    )
    expect(rows).toEqual([{ close: '2684.00000000' }])
  })

  it('corrects a resent bar rather than duplicating it', async () => {
    await exits!.storeFeedBar(delivery('2026-09-04', '2684'))
    await exits!.storeFeedBar(delivery('2026-09-04', '2700'))

    const { rows } = await sql!.query<{ count: string; close: string }>(
      `select count(*)::text as count, max(close)::text as close
       from exit_feed_bars where instrument_id = $1 and trading_day = '2026-09-04'`,
      [INSTRUMENT],
    )
    // One row, carrying the corrected close — a duplicate would distort the
    // five-reading momentum window the time stop reads.
    expect(rows[0]?.count).toBe('1')
    expect(rows[0]?.close).toBe('2700.00000000')
  })

  it('writes nothing at all for a ticker no instrument carries', async () => {
    expect(await exits!.storeFeedBar(delivery('2026-09-04', '2684', 'NOPE'))).toBeNull()

    const { rows } = await sql!.query<{ count: string }>(
      'select count(*)::text as count from exit_feed_bars',
    )
    expect(rows[0]?.count).toBe('0')
  })

  it('leaves an entry ATR that is already set, and one for another day', async () => {
    // The framework forbids recalculation: the stop is fixed at entry, so the
    // ATR it rests on is frozen beside it.
    await plan('2026-09-04', '12.5')
    await exits!.storeFeedBar(delivery('2026-09-04', '2684'))
    expect(await entryAtr()).toBe('12.50000000')

    await sql!.query('delete from exit_rules')
    await plan('2026-09-07')
    await exits!.storeFeedBar(delivery('2026-09-04', '2684'))
    expect(await entryAtr()).toBeNull()
  })

  it('refuses to publish a close a later session has superseded', async () => {
    await exits!.storeFeedBar(delivery('2026-09-07', '2750'))
    await prices!.cacheFeedClose({
      instrumentId: INSTRUMENT,
      assetClass: 'JP_EQUITY',
      close: '2750',
      asOf: EARLIER,
      tradingDay: '2026-09-07',
    })

    // The replay case. Its own row is still corrected by the upsert; only the
    // right to publish its close as *current* is withheld — and the test of
    // that is inside the write, so a later bar cannot land in between.
    await exits!.storeFeedBar(delivery('2026-08-28', '2600'))
    const published = await prices!.cacheFeedClose({
      instrumentId: INSTRUMENT,
      assetClass: 'JP_EQUITY',
      close: '2600',
      // Newer than the row already there, so only the day can refuse it.
      asOf: LATER,
      tradingDay: '2026-08-28',
    })

    expect(published).toBe(false)
    expect((await cached())?.price).toBe('2750.00000000')
  })

  it('publishes the newest bar held, including the very first', async () => {
    await exits!.storeFeedBar(delivery('2026-09-04', '2684'))

    expect(
      await prices!.cacheFeedClose({
        instrumentId: INSTRUMENT,
        assetClass: 'JP_EQUITY',
        close: '2684',
        asOf: LATER,
        tradingDay: '2026-09-04',
      }),
    ).toBe(true)
    expect((await cached())?.price).toBe('2684.00000000')
  })
})

describe.skipIf(!available)('the delivery log, against a real Postgres', () => {
  const delivery = (over: Partial<Parameters<typeof ExitService.recordFeedDelivery>[0]> = {}) => ({
    receivedAt: new Date('2026-09-04T06:00:00Z'),
    durationMs: 120,
    outcome: 'STORED' as const,
    status: 200,
    ticker: '7203',
    exchange: 'TSE',
    instrumentId: INSTRUMENT,
    tradingDay: '2026-09-04',
    backfilled: 0,
    priced: true,
    detail: null,
    ...over,
  })

  it('files a delivery and reads it back with its instrument resolved', async () => {
    await exits!.recordFeedDelivery(delivery())

    const [row] = await exits!.recentFeedDeliveries(10)
    expect(row).toMatchObject({
      ticker: '7203',
      symbol: '7203',
      name: 'トヨタ自動車',
      outcome: 'STORED',
      status: 200,
      durationMs: 120,
      tradingDay: '2026-09-04',
      priced: true,
    })
    // Stamped in UTC, like every other timestamp this app writes — the screen
    // renders it in the reader's zone and would be an hour out either way.
    expect(row?.receivedAt.toISOString()).toBe('2026-09-04T06:00:00.000Z')
  })

  it('keeps a ticker that matched nothing, which is the whole finding', async () => {
    await exits!.recordFeedDelivery(
      delivery({
        outcome: 'UNKNOWN_TICKER',
        status: 404,
        ticker: 'NOPE',
        instrumentId: null,
        tradingDay: null,
        backfilled: null,
        priced: null,
      }),
    )

    const [row] = await exits!.recentFeedDeliveries(10)
    // The left join has to survive the unresolved case: an inner one would have
    // hidden exactly the rows worth looking at.
    expect(row).toMatchObject({ ticker: 'NOPE', symbol: null, name: null, outcome: 'UNKNOWN_TICKER' })
  })

  it('records two deliveries of the same bar as two events', async () => {
    // A resend is the thing this log makes visible. An id derived from the
    // payload would have collapsed the pair and erased it.
    await exits!.recordFeedDelivery(delivery())
    await exits!.recordFeedDelivery(delivery({ durationMs: 5000 }))

    expect(await exits!.recentFeedDeliveries(10)).toHaveLength(2)
  })

  it('returns the newest first, and no more than asked for', async () => {
    for (const [index, minute] of ['01', '02', '03'].entries()) {
      await exits!.recordFeedDelivery(
        delivery({ receivedAt: new Date(`2026-09-04T06:${minute}:00Z`), durationMs: index }),
      )
    }

    const rows = await exits!.recentFeedDeliveries(2)
    expect(rows.map((row) => row.durationMs)).toEqual([2, 1])
  })

  it('tallies only the window asked about', async () => {
    const now = new Date('2026-09-04T12:00:00Z')
    await exits!.recordFeedDelivery(delivery({ receivedAt: new Date('2026-09-04T11:00:00Z') }))
    await exits!.recordFeedDelivery(
      delivery({
        receivedAt: new Date('2026-09-04T11:30:00Z'),
        outcome: 'UNKNOWN_TICKER',
        status: 404,
        durationMs: 900,
      }),
    )
    // Outside the window — must not be counted, or "today's feed" quietly
    // becomes "every delivery ever".
    await exits!.recordFeedDelivery(delivery({ receivedAt: new Date('2026-09-01T11:00:00Z') }))

    expect(await exits!.feedDeliveryTally(new Date(now.getTime() - 24 * 3600 * 1000))).toEqual({
      total: 2,
      stored: 1,
      failed: 1,
      slowestMs: 900,
    })
  })

  it('reports an empty window as zeroes rather than nulls', async () => {
    // `count(*)` over no rows is 0, but `max()` is null, and the screen renders
    // the pair — a null total would print as blank where a 0 is the answer.
    expect(await exits!.feedDeliveryTally(new Date('2030-01-01T00:00:00Z'))).toEqual({
      total: 0,
      stored: 0,
      failed: 0,
      slowestMs: null,
    })
  })
})

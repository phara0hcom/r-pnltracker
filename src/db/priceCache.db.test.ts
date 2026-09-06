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

const available = findContainerRuntime()

let container: StartedPostgreSqlContainer | undefined
let sql: Pool | undefined
let prices: typeof PricesService | undefined
let exits: typeof ExitService | undefined
/** The pool the services share, so teardown can close it before the server goes. */
let servicePool: { end: () => Promise<void> } | undefined

const INSTRUMENT = 'i-test-1'

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
  await sql.query(
    readFileSync('drizzle/0000_baseline.sql', 'utf8').replaceAll('--> statement-breakpoint', ''),
  )
  await sql.query(
    `insert into instruments (id, symbol, name, asset_class, currency)
     values ($1, '7203', 'トヨタ自動車', 'JP_EQUITY', 'JPY')`,
    [INSTRUMENT],
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
 * Every test starts from an empty cache and no bars.
 *
 * These ran in order and each leaned on the row the last one left, which passes
 * only while the whole file runs start to finish — and the first thing anyone
 * does with a failure is re-run that one test on its own.
 */
beforeEach(async () => {
  if (!available) return
  await sql!.query('delete from price_cache')
  await sql!.query('delete from exit_feed_bars')
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
    })
    expect(wrote).toBe(true)
    expect(await cached()).toMatchObject({ price: '2684.00000000', source: 'FEED', currency: 'JPY' })

    // A replayed bar, stamped before the row it would overwrite.
    const replay = await prices!.cacheFeedClose({
      instrumentId: INSTRUMENT,
      assetClass: 'JP_EQUITY',
      close: '1',
      asOf: EARLIER,
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
      }),
    ).toBe(false)
    expect((await cached())?.price).toBe('500.00000000')
  })
})

describe.skipIf(!available)('feed bars, against a real Postgres', () => {
  const bar = (tradingDay: string, close: string) => ({
    instrumentId: INSTRUMENT,
    tradingDay,
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

  it('corrects a resent bar rather than duplicating it', async () => {
    await exits!.recordFeedBar(bar('2026-09-04', '2684'))
    await exits!.recordFeedBar(bar('2026-09-04', '2700'))

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

  it('calls the first bar of all the latest', async () => {
    expect(await exits!.recordFeedBar(bar('2026-09-04', '2684'))).toEqual({ isLatest: true })
  })

  it('refuses a replay that a newer session has superseded', async () => {
    await exits!.recordFeedBar(bar('2026-09-07', '2750'))
    // Arriving after it, but for an earlier session.
    expect(await exits!.recordFeedBar(bar('2026-08-28', '2600'))).toEqual({ isLatest: false })
  })
})

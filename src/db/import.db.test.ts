/**
 * Import restatement against a real Postgres.
 *
 * The planning half is pure and is tested in `lib/import/plan.test.ts`. What
 * needs a server is the commit: a restatement rewrites `source_row_hash` on a
 * row that the unique index `(user_id, source_row_hash)` already covers, and
 * whether that lands — or trips the index, or silently matches nothing — is a
 * claim about Postgres. So is the thing the fix is actually for: that after
 * both exports have been imported the stored history holds *one* sell, and the
 * engine reading it back no longer warns `close with no open position`.
 *
 * Not part of `npm test` — see `vitest.config.ts`. Run with `npm run test:db`,
 * and it skips itself when no container runtime is present.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import iconv from 'iconv-lite'
import { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { runEngine } from '../lib/pnl/engine'
import type * as ImportService from './import.service'
import type * as TradesService from './trades.service'

/** Same probe as `priceCache.db.test.ts`; see the long note there. */
function findContainerRuntime(): boolean {
  const home = process.env.HOME ?? ''
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
  if (host.includes('podman')) process.env.TESTCONTAINERS_RYUK_DISABLED ??= 'true'
  return true
}

function migrationFiles(): string[] {
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
    entries: { tag: string }[]
  }
  return journal.entries.map((entry) => join('drizzle', `${entry.tag}.sql`))
}

const available = findContainerRuntime()

let container: StartedPostgreSqlContainer | undefined
let sql: Pool | undefined
let imports: typeof ImportService | undefined
let tradesService: typeof TradesService | undefined
let servicePool: { end: () => Promise<void> } | undefined

const USER = 'u-test-1'

beforeAll(async () => {
  if (!available) return

  container = await new PostgreSqlContainer('postgres:17-alpine').start()
  // Before the services are imported: `db/index.ts` builds its pool at module
  // scope from whatever DATABASE_URL said at load.
  process.env.DATABASE_URL = container.getConnectionUri()

  sql = new Pool({ connectionString: container.getConnectionUri() })
  for (const file of migrationFiles()) {
    await sql.query(readFileSync(file, 'utf8').replaceAll('--> statement-breakpoint', ''))
  }
  await sql.query(
    `insert into "user" (id, name, email, email_verified, created_at, updated_at)
     values ($1, 'owner', 'owner@example.com', true, now(), now())`,
    [USER],
  )

  imports = await import('./import.service')
  tradesService = await import('./trades.service')
  servicePool = (await import('./index')).db.$client
})

afterAll(async () => {
  await sql?.end()
  await servicePool?.end()
  await container?.stop()
})

beforeEach(async () => {
  if (!available) return
  await sql!.query('delete from trades')
  await sql!.query('delete from import_batches')
  await sql!.query('delete from instruments')
})

const US_HEADER =
  '約定日,受渡日,ティッカー,銘柄名,口座,取引区分,売買区分,信用区分,弁済期限,決済通貨,' +
  '数量［株］,単価［USドル］,約定代金［USドル］,為替レート,手数料［USドル］,税金［USドル］,' +
  '受渡金額［USドル］,受渡金額［円］'

/** The production CAG rows, Shift-JIS encoded exactly as Rakuten writes them. */
const exportBytes = (rows: string[]): Uint8Array =>
  Uint8Array.from(iconv.encode([US_HEADER, ...rows].join('\r\n'), 'Shift_JIS'))

const buy = (tradeDate: string, settleDate: string, qty: string, price: string, jpy: string) =>
  `"${tradeDate}","${settleDate}","CAG","CONAGRA BRANDS","特定","現物","買付","-","-","円",` +
  `"${qty}","${price}","1,506.00","160.860","6.77","0.67","-","${jpy}"`

/** Only 約定日 and 為替レート differ between the two exports of this sell. */
const sell = (tradeDate: string, fxRate: string) =>
  `"${tradeDate}","2026/9/8","CAG","CONAGRA BRANDS","特定","現物","売付","-","-","ＵＳドル",` +
  `"250","15.8900","3,972.50","${fxRate}","17.96","1.78","3,952.76","-"`

const BUYS = [
  buy('2026/7/31', '2026/8/4', '100', '15.0600', '243,452.00'),
  buy('2026/7/31', '2026/8/4', '100', '15.0400', '243,128.00'),
  buy('2026/8/5', '2026/8/7', '50', '14.9150', '118,328.00'),
]
const BEFORE = 'tradehistory(US)_20260904.csv'
const AFTER = 'tradehistory(US)_20260910.csv'

const beforeSettlement = () => exportBytes([...BUYS, sell('2026/9/3', '155.340')])
const afterSettlement = () => exportBytes([...BUYS, sell('2026/9/4', '155.640')])

async function storedSells() {
  const { rows } = await sql!.query<{
    id: string
    trade_date: string
    net_amount_jpy: string
    source_row_hash: string
    source_file: string
  }>(
    `select id, to_char(trade_date, 'YYYY-MM-DD') as trade_date, net_amount_jpy,
            source_row_hash, source_file
       from trades where side = 'SELL' and deleted_at is null order by trade_date`,
  )
  return rows
}

describe.skipIf(!available)('a fill the broker re-dated after settlement', () => {
  it('updates the stored sell in place instead of storing a second one', async () => {
    await imports!.commitImport(USER, BEFORE, beforeSettlement())
    const [original] = await storedSells()
    expect(original!.trade_date).toBe('2026-09-03')

    const result = await imports!.commitImport(USER, AFTER, afterSettlement())
    expect(result.tradesInserted).toBe(0)
    expect(result.tradesRestated).toBe(1)

    const sells = await storedSells()
    expect(sells).toHaveLength(1)
    // Same row — so its memo, journal and any open URL survive the correction.
    expect(sells[0]!.id).toBe(original!.id)
    expect(sells[0]!.trade_date).toBe('2026-09-04')
    expect(sells[0]!.source_file).toBe(AFTER)
    // The settlement FX rate, not the provisional one: ¥614,022 → ¥615,208.
    expect(sells[0]!.net_amount_jpy).toBe('615208.00000000')
    // The hash moved with it, past the unique index it shares with every other
    // row — which is the half of this that only a real server can answer.
    expect(sells[0]!.source_row_hash).not.toBe(original!.source_row_hash)
  })

  it('leaves the engine with one sell and no warning', async () => {
    // The symptom the Sentry issue reported: the duplicate sell met an empty
    // pool, because the first copy had already consumed all 250 shares.
    await imports!.commitImport(USER, BEFORE, beforeSettlement())
    await imports!.commitImport(USER, AFTER, afterSettlement())

    const records = await tradesService!.listTrades(USER)
    const engine = runEngine(records.map((row) => row.trade))
    expect(engine.warnings).toEqual([])
    expect(engine.realized).toHaveLength(1)
    expect(engine.positions).toEqual([])
    // Realized on the settled proceeds, not the ones derived pre-settlement.
    expect(engine.realized[0]!.proceedsJpy.toFixed()).toBe('615208')
  })

  it('is idempotent — the settled export can be re-imported freely', async () => {
    await imports!.commitImport(USER, BEFORE, beforeSettlement())
    await imports!.commitImport(USER, AFTER, afterSettlement())

    const again = await imports!.commitImport(USER, AFTER, afterSettlement())
    expect(again.tradesInserted).toBe(0)
    expect(again.tradesRestated).toBe(0)
    expect(await storedSells()).toHaveLength(1)
  })

  it('does not revert when the older export is uploaded again afterwards', async () => {
    await imports!.commitImport(USER, BEFORE, beforeSettlement())
    await imports!.commitImport(USER, AFTER, afterSettlement())

    const stale = await imports!.commitImport(USER, BEFORE, beforeSettlement())
    expect(stale.tradesInserted).toBe(0)
    expect(stale.tradesRestated).toBe(0)

    const sells = await storedSells()
    expect(sells).toHaveLength(1)
    expect(sells[0]!.trade_date).toBe('2026-09-04')
    expect(sells[0]!.net_amount_jpy).toBe('615208.00000000')
  })

  it('never overwrites a hand-corrected row', async () => {
    await imports!.commitImport(USER, BEFORE, beforeSettlement())
    const [original] = await storedSells()
    await sql!.query('update trades set is_edited = true where id = $1', [original!.id])

    const result = await imports!.commitImport(USER, AFTER, afterSettlement())
    expect(result.tradesInserted).toBe(0)
    expect(result.tradesRestated).toBe(0)

    const sells = await storedSells()
    expect(sells).toHaveLength(1)
    expect(sells[0]!.trade_date).toBe('2026-09-03')
  })
})

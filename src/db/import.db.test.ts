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
import iconv from 'iconv-lite'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { runEngine } from '../lib/pnl/engine'
import type * as ImportService from './import.service'
import type * as TradesService from './trades.service'
import {
  containerAvailable,
  startPostgres,
  stopPostgres,
  TEST_USER,
} from '~/test/postgres'

let sql: Pool | undefined
let imports: typeof ImportService | undefined
let tradesService: typeof TradesService | undefined

const USER = TEST_USER

beforeAll(async () => {
  sql = await startPostgres()
  if (!sql) return

  // Imported here, not at module scope: `db/index.ts` binds its pool to
  // DATABASE_URL on first load, which `startPostgres` has only just set.
  imports = await import('./import.service')
  tradesService = await import('./trades.service')
})

afterAll(stopPostgres)

beforeEach(async () => {
  if (!containerAvailable) return
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

/** Live sells by default; `withDeleted` includes tombstones. */
async function storedSells({ withDeleted = false } = {}) {
  const { rows } = await sql!.query<{
    id: string
    trade_date: string
    net_amount_jpy: string
    source_row_hash: string
    source_file: string
    deleted_at: Date | null
  }>(
    `select id, to_char(trade_date, 'YYYY-MM-DD') as trade_date, net_amount_jpy,
            source_row_hash, source_file, deleted_at
       from trades
      where side = 'SELL' ${withDeleted ? '' : 'and deleted_at is null'}
      order by trade_date`,
  )
  return rows
}

describe.skipIf(!containerAvailable)('a fill the broker re-dated after settlement', () => {
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

/**
 * A fill that was deleted, then came back re-dated.
 *
 * Soft delete exists because a hard one lets the next import resurrect the row:
 * dedupe matches on `sourceRowHash`, and a hash that is no longer in the table
 * matches nothing. A restatement is the case that reaches past that guard on
 * its own — the fill returns under a *different* hash, so the tombstone cannot
 * recognise it however carefully it was kept.
 *
 * Which is why the restatement pass considers tombstoned rows at all, and why
 * the update leaves `deleted_at` alone: the deleted fill absorbs its own
 * restatement and stays deleted, instead of reappearing beside itself as a live
 * sell. That is the whole of the guarantee, and none of it is visible without a
 * database, so it is checked here.
 */
describe.skipIf(!containerAvailable)('a re-dated fill that was deleted', () => {
  /** Import the pre-settlement export, then delete the sell it brought in. */
  async function importThenDeleteTheSell(): Promise<string> {
    await imports!.commitImport(USER, BEFORE, beforeSettlement())
    const [sold] = await storedSells()
    await tradesService!.deleteTrade(USER, sold!.id)
    expect(await storedSells()).toHaveLength(0)
    return sold!.id
  }

  it('stays deleted when the settled export re-dates it', async () => {
    const deletedId = await importThenDeleteTheSell()

    const result = await imports!.commitImport(USER, AFTER, afterSettlement())
    // Absorbed by the tombstone, not inserted beside it.
    expect(result.tradesInserted).toBe(0)
    expect(result.tradesRestated).toBe(1)

    const all = await storedSells({ withDeleted: true })
    expect(all).toHaveLength(1)
    expect(all[0]!.id).toBe(deletedId)
    expect(all[0]!.deleted_at).not.toBeNull()
    // Re-dated in place, so the tombstone now carries the hash a later import
    // of the settled export will match — and the deletion goes on sticking.
    expect(all[0]!.trade_date).toBe('2026-09-04')
  })

  it('leaves the engine with the position still open', async () => {
    // The point of the deletion: 250 shares are held, not sold. A resurrected
    // sell would close the pool and book a gain the user said was not theirs.
    await importThenDeleteTheSell()
    await imports!.commitImport(USER, AFTER, afterSettlement())

    const records = await tradesService!.listTrades(USER)
    const engine = runEngine(records.map((row) => row.trade))
    expect(engine.warnings).toEqual([])
    expect(engine.realized).toEqual([])
    expect(engine.positions).toHaveLength(1)
    expect(engine.positions[0]!.quantity.toFixed()).toBe('250')
  })

  it('goes on sticking when either export is uploaded again', async () => {
    await importThenDeleteTheSell()
    await imports!.commitImport(USER, AFTER, afterSettlement())

    // The settled export matches the tombstone's new hash; the pre-settlement
    // one is a day earlier than it, which the plan reads as older evidence.
    for (const [name, bytes] of [
      [AFTER, afterSettlement()],
      [BEFORE, beforeSettlement()],
    ] as const) {
      const again = await imports!.commitImport(USER, name, bytes)
      expect(again.tradesInserted).toBe(0)
      expect(again.tradesRestated).toBe(0)
    }

    expect(await storedSells()).toHaveLength(0)
    expect(await storedSells({ withDeleted: true })).toHaveLength(1)
  })
})

/**
 * A JP day regrouped at settlement — the production 8729 sell of 2026-09-15.
 *
 * The intraday export listed the order's fills so far as 1,000 + 800 + 2,600
 * with no commission; the settled one lists the same 4,400 shares as 1,800 +
 * 2,600, commission split across them. What only a database can answer is
 * whether the commit leaves exactly the settled pair live, with the 2,600's
 * figures replaced in place and the partials tombstoned rather than removed.
 */
describe.skipIf(!containerAvailable)('a JP day regrouped at settlement', () => {
  const JP_HEADER =
    '約定日,受渡日,銘柄コード,銘柄名,市場名称,口座区分,取引区分,売買区分,信用区分,弁済期限,' +
    '数量［株］,単価［円］,手数料［円］,税金等［円］,諸費用［円］,税区分,受渡金額［円］,建約定日,' +
    '建単価［円］,建手数料［円］,建手数料消費税［円］,金利（支払）〔円〕,金利（受取）〔円〕,' +
    '逆日歩／特別空売り料（支払）〔円〕,逆日歩（受取）〔円〕,貸株料,事務管理費〔円〕（税抜）,' +
    '名義書換料〔円〕（税抜）'
  const jpBytes = (rows: string[]): Uint8Array =>
    Uint8Array.from(iconv.encode([JP_HEADER, ...rows].join('\r\n'), 'Shift_JIS'))
  const tail = '"-","0.0","0","0","0","0","0","0","0","0","0"'
  const bought = `"2026/9/14","2026/9/16","8729","ソニーフィナンシャルグループ","東証","特定","現物","買付","-","-","4,400","160.3","0","0","0","-","705,320",${tail}`
  const sold = (qty: string, fee: string, tax: string, amount: string) =>
    `"2026/9/15","2026/9/17","8729","ソニーフィナンシャルグループ","東証","特定","現物","売付","-","-","${qty}","163.2","${fee}","${tax}","0","源徴あり","${amount}",${tail}`
  const later = `"2026/9/18","2026/9/25","2502","アサヒＧＨＤ","東証","特定","現物","買付","-","-","200","1631.9","0","0","0","-","-",${tail}`

  const intraday = () =>
    jpBytes([bought, sold('1,000', '0', '0', '-'), sold('800', '0', '0', '-'), sold('2,600', '0', '0', '-')])
  const settled = () =>
    jpBytes([bought, sold('1,800', '198', '18', '293,544'), sold('2,600', '289', '30', '424,001'), later])

  async function sells(withDeleted = false) {
    const { rows } = await sql!.query<{ quantity: string; net_amount_jpy: string; is_settled: boolean; deleted_at: Date | null }>(
      `select quantity::float::text as quantity, net_amount_jpy::float::text as net_amount_jpy, is_settled, deleted_at
         from trades where side = 'SELL' ${withDeleted ? '' : 'and deleted_at is null'}
        order by trades.quantity`,
    )
    return rows
  }

  it('keeps the settled pair live, settles the 2,600 in place, and tombstones the partials', async () => {
    await imports!.commitImport(USER, 'tradehistory(JP)_20260915.csv', intraday())
    const result = await imports!.commitImport(USER, 'tradehistory(JP)_20260918.csv', settled())
    expect(result.tradesInserted).toBe(2) // the 1,800 and the later buy
    expect(result.tradesRestated).toBe(3) // the 2,600 settled, the 1,000 and 800 replaced

    expect(await sells()).toEqual([
      { quantity: '1800', net_amount_jpy: '293544', is_settled: true, deleted_at: null },
      { quantity: '2600', net_amount_jpy: '424001', is_settled: true, deleted_at: null },
    ])
    expect((await sells(true)).filter((row) => row.deleted_at != null).map((row) => row.quantity)).toEqual([
      '800',
      '1000',
    ])

    const records = await tradesService!.listTrades(USER)
    const engine = runEngine(records.map((row) => row.trade))
    expect(engine.warnings).toEqual([])
    // Both sells book, and between them they close the 4,400 bought.
    expect(engine.realized.map((close) => close.quantity.toFixed()).sort()).toEqual(['1800', '2600'])
    expect(engine.positions.filter((position) => position.symbol === '8729')).toEqual([])
  })

  it('does not bring the partials back when the intraday export is uploaded again', async () => {
    await imports!.commitImport(USER, 'tradehistory(JP)_20260915.csv', intraday())
    await imports!.commitImport(USER, 'tradehistory(JP)_20260918.csv', settled())
    const again = await imports!.commitImport(USER, 'tradehistory(JP)_20260915.csv', intraday())
    expect(again.tradesInserted).toBe(0)
    expect(again.tradesRestated).toBe(0)
    expect((await sells()).map((row) => row.quantity)).toEqual(['1800', '2600'])
  })
})

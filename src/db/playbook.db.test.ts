/**
 * The Playbook's storage against a real Postgres.
 *
 * Which streak a position is, and everything derived from it, is pure and
 * tested in `lib/playbook/streaks.test.ts`. What needs a server is what the
 * schema promises: the partial unique indexes on a position's anchor and a
 * setup's name, the cascades and `set null`s, that a position whose anchor
 * trade was soft-deleted still finds its streak, and that an id stored as a
 * value has to be the caller's own.
 *
 * Not part of `npm test` — run with `npm run test:db`; it skips itself when no
 * container runtime is present.
 */
import Decimal from 'decimal.js'
import type { Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type * as Mappers from './mappers'
import type * as PlaybookService from './playbook.service'
import type * as Schema from './schema'
import type * as Database from './index'
import type { NormalizedTrade } from '~/lib/domain/types'
import { resolvePosition } from '~/lib/playbook/streaks'
import { containerAvailable, startPostgres, stopPostgres, TEST_USER } from '~/test/postgres'
import { makeTrade } from '~/test/trade'

let sql: Pool | undefined
let playbook: typeof PlaybookService | undefined
let mappers: typeof Mappers | undefined
let database: typeof Database | undefined
let schema: typeof Schema | undefined

const USER = TEST_USER

beforeAll(async () => {
  sql = await startPostgres()
  if (!sql) return
  // After `startPostgres` has set DATABASE_URL — `db/index.ts` binds on load.
  playbook = await import('./playbook.service')
  mappers = await import('./mappers')
  database = await import('./index')
  schema = await import('./schema')
})

afterAll(stopPostgres)

beforeEach(async () => {
  if (!containerAvailable) return
  await sql!.query('delete from exit_rules')
  await sql!.query('delete from journal_entries')
  await sql!.query('delete from setups')
  await sql!.query('delete from trades')
  await sql!.query('delete from instruments')
})

/** Stores trades as an import would, returning their row ids in order. */
const store = (...list: NormalizedTrade[]) => storeFor(USER, ...list)

async function storeFor(userId: string, ...list: NormalizedTrade[]): Promise<string[]> {
  const { db } = database!
  const { instruments, trades } = schema!
  const rows = list.map((trade) => mappers!.toTradeRow({ userId, trade }))
  await db
    .insert(instruments)
    .values(mappers!.toInstrumentRow({ symbol: '8411', name: 'みずほ', assetClass: 'JP_EQUITY', currency: 'JPY' }))
    .onConflictDoNothing()
  await db.insert(trades).values(rows)
  return rows.map((row) => row.id)
}

const buy = (date: string, qty = 100) =>
  makeTrade({ side: 'BUY', tradeDate: date, quantity: new Decimal(qty), unitPrice: new Decimal(3000) })
const sell = (date: string, qty = 100) =>
  makeTrade({ side: 'SELL', tradeDate: date, quantity: new Decimal(qty), unitPrice: new Decimal(3200) })

const position = (over: Partial<PlaybookService.JournalEntryInput> = {}): PlaybookService.JournalEntryInput => ({
  kind: 'REAL',
  setupId: null,
  symbol: '8411',
  name: 'みずほ',
  assetClass: 'JP_EQUITY',
  accountType: 'SPECIFIC',
  entryDate: '2026-09-01',
  anchorTradeId: null,
  stopPrice: null,
  target1Price: null,
  extraTargets: [],
  accountEquity: null,
  legs: [],
  ...over,
})

const typedBuy: PlaybookService.TypedLegInput = {
  side: 'ENTRY',
  date: '2026-09-01',
  executedAt: new Date('2026-09-01T00:15:00Z'),
  price: '3000',
  quantity: '100',
  fee: '0',
  rating: 8,
  note: 'bounce off the 20d',
}

const value = <T>(result: PlaybookService.PlaybookResult<T>): T => {
  if (!result.ok) throw new Error(result.message)
  return result.value
}

describe.skipIf(!containerAvailable)('setups', () => {
  it('refuses a second live setup of the same name, and frees it on archive', async () => {
    const input = { name: 'Pullback to 20d', description: '', criteria: [{ text: 'Uptrend' }] }
    const first = value(await playbook!.createSetup(USER, input))
    expect(await playbook!.createSetup(USER, input)).toEqual({
      ok: false,
      message: 'There is already a setup called Pullback to 20d.',
    })
    await playbook!.archiveSetup(USER, first)
    expect((await playbook!.createSetup(USER, input)).ok).toBe(true)
  })

  it('has the index behind the check, in case two writes race', async () => {
    await playbook!.createSetup(USER, { name: 'Breakout', description: '', criteria: [] })
    await expect(
      sql!.query(`insert into setups (id, user_id, name) values ('dup', $1, 'Breakout')`, [USER]),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('keeps a criterion id across a rename', async () => {
    const id = value(await playbook!.createSetup(USER, { name: 'S', description: '', criteria: [{ text: 'Volume' }] }))
    const [setup] = await playbook!.listSetups(USER)
    const criterion = setup!.criteria[0]!
    await playbook!.updateSetup(USER, id, { name: 'S', description: '', criteria: [{ id: criterion.id, text: 'Volume ×2' }] })
    expect((await playbook!.listSetups(USER))[0]!.criteria).toEqual([{ id: criterion.id, text: 'Volume ×2' }])
  })

  it('leaves a position without its setup when the setup row goes', async () => {
    const setupId = value(await playbook!.createSetup(USER, { name: 'S', description: '', criteria: [] }))
    const id = value(await playbook!.createJournalEntry(USER, position({ setupId, legs: [typedBuy] })))
    await sql!.query('delete from setups where id = $1', [setupId])
    expect((await playbook!.getJournalEntry(USER, id))?.setupId).toBeNull()
  })
})

describe.skipIf(!containerAvailable)('positions', () => {
  it('files one position per streak, and refuses a second', async () => {
    const [anchor] = await store(buy('2026-09-01'), sell('2026-09-05'))
    expect((await playbook!.createJournalEntry(USER, position({ anchorTradeId: anchor! }))).ok).toBe(true)
    expect(await playbook!.createJournalEntry(USER, position({ anchorTradeId: anchor! }))).toEqual({
      ok: false,
      message: '8411 from 2026-09-01 is already in the Playbook.',
    })
    await expect(
      sql!.query(
        `insert into journal_entries (id, user_id, kind, instrument_id, account_type, entry_date, anchor_trade_id)
         select 'dup', user_id, kind, instrument_id, account_type, entry_date, anchor_trade_id from journal_entries`,
      ),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('refuses a trade that does not open a streak', async () => {
    const [, close] = await store(buy('2026-09-01'), sell('2026-09-05'))
    expect((await playbook!.createJournalEntry(USER, position({ anchorTradeId: close! }))).ok).toBe(false)
  })

  it('creates the instrument for a position filed before any import', async () => {
    await playbook!.createJournalEntry(USER, position({ symbol: '7203', name: 'トヨタ', legs: [typedBuy] }))
    const { rows } = await sql!.query<{ symbol: string }>('select symbol from instruments')
    expect(rows.map((row) => row.symbol)).toEqual(['7203'])
  })

  it('still finds its streak when the anchor trade is soft-deleted', async () => {
    const [anchor] = await store(buy('2026-09-01'))
    const id = value(await playbook!.createJournalEntry(USER, position({ anchorTradeId: anchor! })))
    // Settlement regrouping tombstones the row and inserts its replacement.
    await sql!.query('update trades set deleted_at = now() where id = $1', [anchor])
    await store(buy('2026-09-01'))

    const entry = (await playbook!.getJournalEntry(USER, id))!
    expect(entry.anchorTradeId).toBe(anchor)
    const resolved = resolvePosition({ ...entry, accountType: 'SPECIFIC' }, await playbook!.streaksFor(USER))
    expect(resolved).toMatchObject({ kind: 'FOUND', via: 'FALLBACK' })
  })

  it('cascades legs on delete, and leaves its exit plan unlinked', async () => {
    const id = value(await playbook!.createJournalEntry(USER, position({ legs: [typedBuy] })))
    await sql!.query(
      `insert into exit_rules (id, user_id, instrument_id, account_type, entry_date, entry_price, total_shares, support_level, journal_id)
       select 'plan', user_id, instrument_id, account_type, entry_date, 3000, 100, 2900, id from journal_entries`,
    )
    await playbook!.deleteJournalEntry(USER, id)
    expect((await sql!.query('select 1 from journal_legs')).rowCount).toBe(0)
    expect((await sql!.query<{ journal_id: string | null }>('select journal_id from exit_rules')).rows).toEqual([
      { journal_id: null },
    ])
  })

  it('archives its live exit plan with it', async () => {
    const id = value(await playbook!.createJournalEntry(USER, position({ legs: [typedBuy] })))
    await sql!.query(
      `insert into exit_rules (id, user_id, instrument_id, account_type, entry_date, entry_price, total_shares, support_level, journal_id)
       select 'plan', user_id, instrument_id, account_type, entry_date, 3000, 100, 2900, id from journal_entries`,
    )
    await playbook!.archiveJournalEntry(USER, id)
    const { rows } = await sql!.query<{ archived: boolean }>('select archived_at is not null as archived from exit_rules')
    expect(rows).toEqual([{ archived: true }])
  })
})

describe.skipIf(!containerAvailable)('linking a position awaiting import', () => {
  it('offers the matching streak, links it, and turns the typed leg into an annotation', async () => {
    const id = value(await playbook!.createJournalEntry(USER, position({ legs: [typedBuy] })))
    const [anchor] = await store(buy('2026-09-01'), buy('2026-09-01'))

    const candidates = await playbook!.candidatesFor(USER, id)
    expect(candidates.map((streak) => streak.anchorId)).toEqual([anchor])
    value(await playbook!.linkJournalEntry(USER, id, anchor!))

    const entry = (await playbook!.getJournalEntry(USER, id))!
    expect(entry.anchorTradeId).toBe(anchor)
    expect(entry.legs).toMatchObject([
      { firstTradeId: anchor, rating: 8, note: 'bounce off the 20d', price: null, quantity: null },
    ])
    // The typed time reached both fills of the leg.
    const { rows } = await sql!.query<{ executed_at: Date }>('select executed_at from trades')
    expect(rows.map((row) => row.executed_at.toISOString())).toEqual([
      '2026-09-01T00:15:00.000Z',
      '2026-09-01T00:15:00.000Z',
    ])
  })

  it('offers nothing another position already resolves to', async () => {
    const [anchor] = await store(buy('2026-09-01'))
    await playbook!.createJournalEntry(USER, position({ anchorTradeId: anchor! }))
    const id = value(await playbook!.createJournalEntry(USER, position({ legs: [typedBuy] })))
    expect(await playbook!.candidatesFor(USER, id)).toEqual([])
    expect((await playbook!.linkJournalEntry(USER, id, anchor!)).ok).toBe(false)
  })

  it('creates a linked leg annotation on first rating, then updates it', async () => {
    const [anchor] = await store(buy('2026-09-01'))
    const id = value(await playbook!.createJournalEntry(USER, position({ anchorTradeId: anchor! })))
    const leg = { side: 'ENTRY' as const, date: '2026-09-01', firstTradeId: anchor!, note: null }
    value(await playbook!.setLegAnnotation(USER, id, { ...leg, rating: 6 }))
    value(await playbook!.setLegAnnotation(USER, id, { ...leg, rating: 9 }))
    expect((await playbook!.getJournalEntry(USER, id))!.legs.map((row) => row.rating)).toEqual([9])
    expect((await playbook!.setLegAnnotation(USER, id, { ...leg, rating: 11 })).ok).toBe(false)
  })
})

describe.skipIf(!containerAvailable)('an id stored as a value', () => {
  const OTHER = 'u-test-2'

  beforeEach(async () => {
    await sql!.query(
      `insert into "user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, 'other', 'other@example.com', true, now(), now())
       on conflict do nothing`,
      [OTHER],
    )
  })

  const theirSetup = async () => value(await playbook!.createSetup(OTHER, { name: 'S', description: '', criteria: [] }))
  const theirTrade = async () => (await storeFor(OTHER, buy('2026-09-01')))[0]!

  it("refuses someone else's setup when filing a position", async () => {
    const setupId = await theirSetup()
    expect(await playbook!.createJournalEntry(USER, position({ setupId, legs: [typedBuy] }))).toEqual({
      ok: false,
      message: 'That setup no longer exists.',
    })
  })

  it("refuses someone else's setup on an update, and still allows clearing it", async () => {
    const setupId = await theirSetup()
    const id = value(await playbook!.createJournalEntry(USER, position({ legs: [typedBuy] })))
    expect((await playbook!.updateJournalEntry(USER, id, { setupId })).ok).toBe(false)
    expect((await playbook!.getJournalEntry(USER, id))?.setupId).toBeNull()
    expect((await playbook!.updateJournalEntry(USER, id, { setupId: null })).ok).toBe(true)
  })

  it('refuses any anchor on a paper position', async () => {
    const paper = { kind: 'PAPER' as const, accountType: null, legs: [typedBuy] }
    const [mine] = await store(buy('2026-09-01'))
    expect((await playbook!.createJournalEntry(USER, position({ ...paper, anchorTradeId: mine! }))).ok).toBe(false)
    expect((await playbook!.createJournalEntry(USER, position({ ...paper, anchorTradeId: await theirTrade() }))).ok).toBe(false)
    expect((await playbook!.createJournalEntry(USER, position(paper))).ok).toBe(true)
  })

  it("refuses someone else's trade on a leg annotation", async () => {
    const firstTradeId = await theirTrade()
    const id = value(await playbook!.createJournalEntry(USER, position({ legs: [typedBuy] })))
    const annotation = { side: 'ENTRY' as const, date: '2026-09-01', firstTradeId, rating: 6, note: null }
    expect((await playbook!.setLegAnnotation(USER, id, annotation)).ok).toBe(false)
    expect((await playbook!.getJournalEntry(USER, id))!.legs).toHaveLength(1)
  })

  it("refuses someone else's trade when reattaching, and accepts one's own", async () => {
    const firstTradeId = await theirTrade()
    const [mine] = await store(buy('2026-09-01'))
    const id = value(await playbook!.createJournalEntry(USER, position({ legs: [typedBuy] })))
    const legId = (await playbook!.getJournalEntry(USER, id))!.legs[0]!.id
    const leg = { side: 'ENTRY' as const, date: '2026-09-01' }
    expect((await playbook!.reattachAnnotation(USER, legId, { ...leg, firstTradeId })).ok).toBe(false)
    expect((await playbook!.getJournalEntry(USER, id))!.legs[0]!.firstTradeId).toBeNull()
    expect((await playbook!.reattachAnnotation(USER, legId, { ...leg, firstTradeId: mine! })).ok).toBe(true)
  })
})

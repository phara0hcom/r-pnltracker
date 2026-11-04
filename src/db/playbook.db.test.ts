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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ImageStore from './imageStore'
import type * as Mappers from './mappers'
import type * as PlaybookService from './playbook.service'
import type * as Schema from './schema'
import type * as Database from './index'
import type { NormalizedTrade } from '~/lib/domain/types'
import type * as Report from '~/lib/observability/report'
import { resolvePosition } from '~/lib/playbook/streaks'
import { containerAvailable, startPostgres, stopPostgres, TEST_USER } from '~/test/postgres'
import { makeTrade } from '~/test/trade'

const stores = vi.hoisted(() => ({
  put: vi.fn(),
  del: vi.fn(),
  report: vi.fn(),
  /** What `waitUntil` was handed: the deletes that outlive the response. */
  deferred: [] as Promise<unknown>[],
}))

vi.mock('@vercel/functions', () => ({
  waitUntil: (promise: Promise<unknown>) => {
    stores.deferred.push(promise)
  },
}))
vi.mock('./imageStore', async (importOriginal) => ({
  ...(await importOriginal<typeof ImageStore>()),
  put: stores.put,
  del: stores.del,
}))
vi.mock('~/lib/observability/report', async (importOriginal) => ({
  ...(await importOriginal<typeof Report>()),
  reportError: stores.report,
}))

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

describe.skipIf(!containerAvailable)('opening a position with a live plan', () => {
  const live = (): PlaybookService.LivePlanInput => ({
    rule: {
      symbol: '8411',
      accountType: 'SPECIFIC' as const,
      entryDate: '2026-09-01',
      entryPrice: '3000',
      totalShares: '100',
      supportLevel: '2900',
      lotSize: 100,
      trailingMethod: null,
      note: null,
    },
    multiples: { stopAtr: '2', target: '1.5' },
  })

  it('creates the plan in the same write, linked and with its own multiples', async () => {
    const id = value(await playbook!.createJournalEntry(USER, position({ legs: [typedBuy] }), live()))
    const { rows } = await sql!.query<{ journal_id: string; entry_stop_atr_multiple: string; entry_target_multiple: string }>(
      'select journal_id, entry_stop_atr_multiple, entry_target_multiple from exit_rules',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.journal_id).toBe(id)
    expect(Number(rows[0]!.entry_stop_atr_multiple)).toBe(2)
    expect(Number(rows[0]!.entry_target_multiple)).toBe(1.5)
  })

  it('archives the old plan in the same transaction when its position is closed', async () => {
    const [first] = await store(buy('2026-08-01'), sell('2026-08-10'))
    const closed = value(await playbook!.createJournalEntry(USER, position({ anchorTradeId: first!, entryDate: '2026-08-01' })))
    await sql!.query(
      `insert into exit_rules (id, user_id, instrument_id, account_type, entry_date, entry_price, total_shares, support_level, journal_id)
       select 'old', user_id, instrument_id, account_type, entry_date, 3000, 100, 2900, id from journal_entries where id = $1`,
      [closed],
    )
    value(await playbook!.createJournalEntry(USER, position({ legs: [typedBuy] }), live()))
    const { rows } = await sql!.query<{ id: string; archived: boolean }>(
      'select id, archived_at is not null as archived from exit_rules order by id = $1 desc',
      ['old'],
    )
    expect(rows.map((row) => row.archived)).toEqual([true, false])
  })

  it('refuses a new plan while the old one still describes an open position, writing nothing', async () => {
    const [first] = await store(buy('2026-08-01'))
    const held = value(await playbook!.createJournalEntry(USER, position({ anchorTradeId: first!, entryDate: '2026-08-01' })))
    await sql!.query(
      `insert into exit_rules (id, user_id, instrument_id, account_type, entry_date, entry_price, total_shares, support_level, journal_id)
       select 'old', user_id, instrument_id, account_type, entry_date, 3000, 100, 2900, id from journal_entries where id = $1`,
      [held],
    )
    const result = await playbook!.createJournalEntry(USER, position({ legs: [typedBuy] }), live())
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('Archive it') as string })
    expect((await sql!.query('select 1 from journal_entries')).rowCount).toBe(1)
    expect((await sql!.query('select 1 from exit_rules where archived_at is null')).rowCount).toBe(1)
  })

  it('stores the streak’s start as the fallback key, not a date typed for the plan', async () => {
    const [anchor] = await store(buy('2026-09-01'))
    const id = value(
      await playbook!.createJournalEntry(USER, position({ anchorTradeId: anchor!, entryDate: '2026-09-03' })),
    )
    expect((await playbook!.getJournalEntry(USER, id))!.entryDate).toBe('2026-09-01')
  })
})

describe.skipIf(!containerAvailable)('from scratch', () => {
  const pool = { symbol: '8411', accountType: 'SPECIFIC' as const }

  it('is refused while the pool holds units, or already waits for an export', async () => {
    expect(await playbook!.scratchProblem(USER, pool)).toBeNull()
    await store(buy('2026-09-01'))
    expect(await playbook!.scratchProblem(USER, pool)).toContain('from the holding')
    await sql!.query('delete from trades')
    value(await playbook!.createJournalEntry(USER, position({ legs: [typedBuy] })))
    expect(await playbook!.scratchProblem(USER, pool)).toContain('awaiting import')
  })
})

describe.skipIf(!containerAvailable)('linking with a plan to correct', () => {
  const insertPlan = () =>
    sql!.query(
      `insert into exit_rules (id, user_id, instrument_id, account_type, entry_date, entry_price, total_shares, support_level, journal_id)
       select 'plan', user_id, instrument_id, account_type, entry_date, 3001, 100, 2900, id from journal_entries`,
    )

  it('corrects the plan to the imported entry only when asked', async () => {
    const id = value(await playbook!.createJournalEntry(USER, position({ legs: [typedBuy] })))
    await insertPlan()
    const [anchor] = await store(buy('2026-09-01'))
    value(await playbook!.linkJournalEntry(USER, id, anchor!, { correctPlan: true }))
    const { rows } = await sql!.query<{ entry_price: string }>('select entry_price from exit_rules')
    expect(Number(rows[0]!.entry_price)).toBe(3000)
  })

  it('leaves the plan alone otherwise', async () => {
    const id = value(await playbook!.createJournalEntry(USER, position({ legs: [typedBuy] })))
    await insertPlan()
    const [anchor] = await store(buy('2026-09-01'))
    value(await playbook!.linkJournalEntry(USER, id, anchor!))
    const { rows } = await sql!.query<{ entry_price: string }>('select entry_price from exit_rules')
    expect(Number(rows[0]!.entry_price)).toBe(3001)
  })

  it('moves the plan to the streak’s date with the correction, dropping the old day’s ATR', async () => {
    const id = value(await playbook!.createJournalEntry(USER, position({ legs: [typedBuy] })))
    await insertPlan()
    await sql!.query('update exit_rules set entry_atr = 50')
    const [anchor] = await store(buy('2026-09-05'))
    value(await playbook!.linkJournalEntry(USER, id, anchor!, { correctPlan: true }))
    const { rows } = await sql!.query<{ entry_date: string; entry_atr: string | null }>(
      'select entry_date::text, entry_atr from exit_rules',
    )
    expect(rows[0]).toEqual({ entry_date: '2026-09-05', entry_atr: null })
  })

  it('keeps the plan’s date without the correction', async () => {
    const id = value(await playbook!.createJournalEntry(USER, position({ legs: [typedBuy] })))
    await insertPlan()
    const [anchor] = await store(buy('2026-09-05'))
    value(await playbook!.linkJournalEntry(USER, id, anchor!))
    const { rows } = await sql!.query<{ entry_date: string }>('select entry_date::text from exit_rules')
    expect(rows[0]!.entry_date).toBe('2026-09-01')
  })

  it('refuses a correction that would put the entry above a manual Target 1', async () => {
    const id = value(await playbook!.createJournalEntry(USER, position({ legs: [typedBuy] })))
    await insertPlan()
    await sql!.query('update exit_rules set target1_override = 2950, support_level = 2800')
    const [anchor] = await store(buy('2026-09-01'))
    const linked = await playbook!.linkJournalEntry(USER, id, anchor!, { correctPlan: true })
    expect(linked.ok).toBe(false)
    const { rows } = await sql!.query<{ entry_price: string }>('select entry_price from exit_rules')
    expect(Number(rows[0]!.entry_price)).toBe(3001)
  })

  it('moves the live plan with a corrected typed leg, and leaves it when the date stands', async () => {
    const id = value(await playbook!.createJournalEntry(USER, position({ legs: [typedBuy] })))
    await insertPlan()
    await sql!.query('update exit_rules set entry_atr = 50')
    const leg = { side: 'ENTRY', executedAt: null, price: '3100', quantity: '100', fee: '0' } as const
    const plan = () =>
      sql!.query<{ entry_date: string; entry_atr: string | null }>('select entry_date::text, entry_atr from exit_rules')

    value(await playbook!.replaceTypedLegs(USER, id, [{ ...leg, date: '2026-09-01' }]))
    expect(Number((await plan()).rows[0]!.entry_atr)).toBe(50)

    value(await playbook!.replaceTypedLegs(USER, id, [{ ...leg, date: '2026-08-30' }]))
    expect((await plan()).rows[0]).toEqual({ entry_date: '2026-08-30', entry_atr: null })
  })

  it('offers a relink to a position that lost its trades', async () => {
    const [anchor] = await store(buy('2026-09-01'))
    const id = value(await playbook!.createJournalEntry(USER, position({ anchorTradeId: anchor! })))
    await sql!.query('update trades set deleted_at = now() where id = $1', [anchor])
    const [next] = await store(buy('2026-09-05'))
    expect((await playbook!.candidatesFor(USER, id)).map((streak) => streak.anchorId)).toEqual([next])
    value(await playbook!.linkJournalEntry(USER, id, next!))
    expect((await playbook!.getJournalEntry(USER, id))!.anchorTradeId).toBe(next)
  })
})

describe.skipIf(!containerAvailable)('the shared note', () => {
  it('writes to the leg for a trade in a position, without touching the trade', async () => {
    const [anchor, second] = await store(buy('2026-09-01'), buy('2026-09-01'))
    const id = value(await playbook!.createJournalEntry(USER, position({ anchorTradeId: anchor! })))
    await playbook!.saveTradeNote(USER, second!, 'the why')

    const entry = (await playbook!.getJournalEntry(USER, id))!
    expect(entry.legs.map((leg) => leg.note)).toEqual(['the why'])
    const { rows } = await sql!.query<{ memo: string | null; is_edited: boolean }>('select memo, is_edited from trades')
    expect(rows.every((row) => row.memo === null && !row.is_edited)).toBe(true)
  })

  it('keeps a rating when the note is saved, and stores an emptied note as empty', async () => {
    const [anchor] = await store(buy('2026-09-01'))
    const id = value(await playbook!.createJournalEntry(USER, position({ anchorTradeId: anchor! })))
    value(await playbook!.setLegAnnotation(USER, id, { side: 'ENTRY', date: '2026-09-01', firstTradeId: anchor!, rating: 7 }))
    await playbook!.saveTradeNote(USER, anchor!, 'a note')
    await playbook!.saveTradeNote(USER, anchor!, null)
    expect((await playbook!.getJournalEntry(USER, id))!.legs).toMatchObject([{ rating: 7, note: '' }])
  })

  it('writes to the memo for a trade outside any position', async () => {
    const [anchor] = await store(buy('2026-09-01'))
    await playbook!.saveTradeNote(USER, anchor!, 'plain memo')
    const { rows } = await sql!.query<{ memo: string; is_edited: boolean }>('select memo, is_edited from trades')
    expect(rows).toEqual([{ memo: 'plain memo', is_edited: false }])
  })

  it('shows the memo again once the position is deleted', async () => {
    const [anchor] = await store(buy('2026-09-01'))
    await playbook!.saveTradeNote(USER, anchor!, 'memo first')
    const id = value(await playbook!.createJournalEntry(USER, position({ anchorTradeId: anchor! })))
    const { listTrades } = await import('./trades.service')
    expect((await playbook!.sharedNotesFor(USER, await listTrades(USER))).get(anchor!)?.note).toBe('memo first')
    await playbook!.deleteJournalEntry(USER, id)
    expect((await playbook!.sharedNotesFor(USER, await listTrades(USER))).size).toBe(0)
  })
})

describe.skipIf(!containerAvailable)('a leg’s time', () => {
  it('writes through only to fills that have none', async () => {
    const [anchor, second] = await store(buy('2026-09-01'), buy('2026-09-01'))
    const id = value(await playbook!.createJournalEntry(USER, position({ anchorTradeId: anchor! })))
    const earlier = new Date('2026-09-01T00:05:00.000Z')
    await sql!.query('update trades set executed_at = $1 where id = $2', [earlier, second])
    value(await playbook!.setLegTime(USER, id, anchor!, new Date('2026-09-01T00:30:00.000Z')))
    const { rows } = await sql!.query<{ id: string; executed_at: Date }>('select id, executed_at from trades')
    const at = new Map(rows.map((row) => [row.id, row.executed_at.toISOString()]))
    expect(at.get(anchor!)).toBe('2026-09-01T00:30:00.000Z')
    expect(at.get(second!)).toBe('2026-09-01T00:05:00.000Z')
  })
})

describe.skipIf(!containerAvailable)('saving a trade’s shared note', () => {
  it('writes nothing when the note is the one already showing, so a memo is not copied', async () => {
    const [anchor] = await store(buy('2026-09-01'))
    await sql!.query(`update trades set memo = 'why' where id = $1`, [anchor])
    value(await playbook!.createJournalEntry(USER, position({ anchorTradeId: anchor! })))

    await playbook!.saveTradeNote(USER, anchor!, 'why')
    expect((await sql!.query('select id from journal_legs')).rows).toHaveLength(0)

    await playbook!.saveTradeNote(USER, anchor!, 'changed my mind')
    const { rows } = await sql!.query<{ note: string }>('select note from journal_legs')
    expect(rows).toEqual([{ note: 'changed my mind' }])
  })
})

describe.skipIf(!containerAvailable)('typed legs', () => {
  it('replaces them, keeping a kept leg’s rating and moving the entry date', async () => {
    const id = value(await playbook!.createJournalEntry(USER, position({ legs: [typedBuy] })))
    const [stored] = (await playbook!.getJournalEntry(USER, id))!.legs
    value(
      await playbook!.replaceTypedLegs(USER, id, [
        { id: stored!.id, side: 'ENTRY', date: '2026-08-30', executedAt: null, price: '3100', quantity: '100', fee: '0' },
        { side: 'EXIT', date: '2026-09-05', executedAt: null, price: '3300', quantity: '100', fee: '0' },
      ]),
    )
    const entry = (await playbook!.getJournalEntry(USER, id))!
    expect(entry.entryDate).toBe('2026-08-30')
    expect(entry.legs.map((leg) => leg.side)).toEqual(['ENTRY', 'EXIT'])
    expect(entry.legs[0]).toMatchObject({ rating: 8, note: 'bounce off the 20d' })
  })

  it('refuses on a linked position, whose figures come from its trades', async () => {
    const [anchor] = await store(buy('2026-09-01'))
    const id = value(await playbook!.createJournalEntry(USER, position({ anchorTradeId: anchor! })))
    expect((await playbook!.replaceTypedLegs(USER, id, [])).ok).toBe(false)
  })

  it('refuses to leave a position with no buy', async () => {
    const id = value(await playbook!.createJournalEntry(USER, position({ legs: [typedBuy] })))
    expect((await playbook!.replaceTypedLegs(USER, id, [])).ok).toBe(false)
  })
})

describe.skipIf(!containerAvailable)('filing existing plans', () => {
  const plan = (id: string, entryDate: string) =>
    sql!.query(
      `insert into instruments (id, symbol, name, asset_class, currency)
       values ($1, '8411', 'みずほ', 'JP_EQUITY', 'JPY') on conflict do nothing`,
      [mappers!.instrumentId('8411')],
    ).then(() =>
      sql!.query(
        `insert into exit_rules (id, user_id, instrument_id, account_type, entry_date, entry_price, total_shares, support_level)
         values ($1, $2, $3, 'SPECIFIC', $4, 3000, 100, 2900)`,
        [id, USER, mappers!.instrumentId('8411'), entryDate],
      ),
    )

  it('anchors each plan to its streak and sets journal_id', async () => {
    const [anchor] = await store(buy('2026-09-01'))
    await plan('old', '2026-09-01')
    expect(await playbook!.fileExistingPlans(USER)).toEqual({ filed: 1, skipped: 0 })
    const { rows } = await sql!.query<{ journal_id: string }>('select journal_id from exit_rules')
    const entry = (await playbook!.getJournalEntry(USER, rows[0]!.journal_id))!
    expect(entry.anchorTradeId).toBe(anchor)
    expect(entry.setupId).toBeNull()
  })

  it('skips a plan with no streak, leaving it to be archived', async () => {
    await plan('old', '2026-09-01')
    expect(await playbook!.fileExistingPlans(USER)).toEqual({ filed: 0, skipped: 1 })
    expect((await sql!.query('select 1 from journal_entries')).rowCount).toBe(0)
  })

  it('files nothing twice', async () => {
    await store(buy('2026-09-01'))
    await plan('old', '2026-09-01')
    await playbook!.fileExistingPlans(USER)
    expect(await playbook!.fileExistingPlans(USER)).toEqual({ filed: 0, skipped: 0 })
  })
})

describe.skipIf(!containerAvailable)('deleting a position', () => {
  it('archives its live plan as it unlinks it, so nothing pushes about a deleted position', async () => {
    const id = value(await playbook!.createJournalEntry(USER, position({ legs: [typedBuy] })))
    await sql!.query(
      `insert into exit_rules (id, user_id, instrument_id, account_type, entry_date, entry_price, total_shares, support_level, journal_id)
       select 'plan', user_id, instrument_id, account_type, entry_date, 3000, 100, 2900, id from journal_entries`,
    )
    await playbook!.deleteJournalEntry(USER, id)
    const { rows } = await sql!.query<{ journal_id: string | null; archived: boolean }>(
      'select journal_id, archived_at is not null as archived from exit_rules',
    )
    expect(rows).toEqual([{ journal_id: null, archived: true }])
  })
})

describe.skipIf(!containerAvailable)('images', () => {
  const OTHER = 'u-test-other'
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64')

  const upload = (journalId: string, over: Partial<PlaybookService.ImageUpload> = {}): PlaybookService.ImageUpload => ({
    journalId,
    phase: 'ENTRY',
    timeframe: '1D',
    caption: 'bounce',
    image: { base64: PNG, contentType: 'image/png', width: 2000, height: 1000 },
    thumb: { base64: PNG, contentType: 'image/png', width: 480, height: 240 },
    ...over,
  })

  const paper = async (userId = USER) =>
    value(
      await playbook!.createJournalEntry(
        userId,
        position({ kind: 'PAPER', accountType: null, legs: [typedBuy] }),
      ),
    )

  const settled = () => Promise.all(stores.deferred.splice(0))

  beforeEach(async () => {
    if (!containerAvailable) return
    vi.clearAllMocks()
    stores.put.mockResolvedValue(undefined)
    stores.del.mockResolvedValue(undefined)
    stores.deferred.length = 0
    await sql!.query(
      `insert into "user" (id, name, email, email_verified, created_at, updated_at)
       values ($1, 'other', 'images-other@example.com', true, now(), now()) on conflict do nothing`,
      [OTHER],
    )
  })

  it('stores both files under the owner and position, with the type the bytes prove', async () => {
    const journalId = await paper()
    const id = value(await playbook!.addJournalImage(USER, upload(journalId)))
    const [image] = await playbook!.listJournalImages(USER, journalId)
    expect(image).toMatchObject({ id, phase: 'ENTRY', timeframe: '1D', caption: 'bounce', contentType: 'image/png' })
    expect(image?.pathname).toMatch(new RegExp(`^users/${USER}/${journalId}/[0-9a-f-]+\\.png$`))
    expect(image?.thumbPathname).toMatch(new RegExp(`^users/${USER}/${journalId}/[0-9a-f-]+\\.thumb\\.png$`))
    expect(stores.put.mock.calls.map((call) => call[0] as string)).toEqual([image?.pathname, image?.thumbPathname])
  })

  it('refuses another user’s position before storing anything', async () => {
    const theirs = await paper(OTHER)
    expect(await playbook!.addJournalImage(USER, upload(theirs))).toEqual({
      ok: false,
      message: 'That position no longer exists.',
    })
    expect(stores.put).not.toHaveBeenCalled()
  })

  it('refuses bytes that are not an image, whatever they claim, before storing anything', async () => {
    const journalId = await paper()
    const html = Buffer.from('<html><script>alert(1)</script>').toString('base64')
    const result = await playbook!.addJournalImage(
      USER,
      upload(journalId, { image: { base64: html, contentType: 'image/png', width: 10, height: 10 } }),
    )
    expect(result.ok).toBe(false)
    expect(stores.put).not.toHaveBeenCalled()
    expect(await playbook!.listJournalImages(USER, journalId)).toEqual([])
  })

  it('hides an image from everyone but its owner', async () => {
    const id = value(await playbook!.addJournalImage(USER, upload(await paper())))
    expect(await playbook!.getJournalImage(OTHER, id)).toBeNull()
    expect((await playbook!.updateJournalImage(OTHER, id, { phase: 'EXIT', timeframe: null, caption: 'x' })).ok).toBe(false)
    await playbook!.deleteJournalImage(OTHER, id)
    await settled()
    expect(stores.del).not.toHaveBeenCalled()
    expect((await playbook!.getJournalImage(USER, id))?.caption).toBe('bounce')
  })

  it('edits phase, timeframe and caption, moving a re-phased image to the end of its group', async () => {
    const journalId = await paper()
    const first = value(await playbook!.addJournalImage(USER, upload(journalId, { phase: 'EXIT' })))
    const second = value(await playbook!.addJournalImage(USER, upload(journalId, { phase: 'ENTRY' })))
    value(await playbook!.updateJournalImage(USER, second, { phase: 'EXIT', timeframe: '5m', caption: 'out' }))
    const images = await playbook!.listJournalImages(USER, journalId)
    expect(images.map((image) => [image.id, image.phase, image.timeframe, image.caption])).toEqual([
      [first, 'EXIT', '1D', 'bounce'],
      [second, 'EXIT', '5m', 'out'],
    ])
  })

  it('removes what it stored when the row cannot be written', async () => {
    const journalId = await paper()
    // The position goes between the ownership check and the insert.
    stores.put.mockImplementationOnce(async () => {
      await sql!.query('delete from journal_entries where id = $1', [journalId])
    })
    const result = await playbook!.addJournalImage(USER, upload(journalId))
    await settled()
    expect(result).toEqual({ ok: false, message: 'The image could not be saved.' })
    const stored = stores.put.mock.calls.map((call) => call[0] as string)
    expect(stored).toHaveLength(2)
    expect(stores.del).toHaveBeenCalledWith(stored)
    expect(stores.report).toHaveBeenCalledOnce()
    // Free text must not reach Sentry on the back of Drizzle's "params:" message.
    expect((stores.report.mock.calls[0]?.[0] as Error).message).not.toContain('bounce')
  })

  it('removes the first file when the second cannot be stored, and says storage is down', async () => {
    const journalId = await paper()
    stores.put.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('store down'))
    const result = await playbook!.addJournalImage(USER, upload(journalId))
    await settled()
    expect(result).toEqual({ ok: false, message: 'Image storage is unavailable, so the image was not saved.' })
    expect(stores.del).toHaveBeenCalledWith([stores.put.mock.calls[0]?.[0]])
    expect(await playbook!.listJournalImages(USER, journalId)).toEqual([])
  })

  it('deleting an image removes the row first, then both files, after the answer', async () => {
    const id = value(await playbook!.addJournalImage(USER, upload(await paper())))
    const stored = await playbook!.getJournalImage(USER, id)
    let rowGoneWhenDeleting = false
    stores.del.mockImplementation(async () => {
      rowGoneWhenDeleting = (await sql!.query('select 1 from journal_images where id = $1', [id])).rowCount === 0
    })
    await playbook!.deleteJournalImage(USER, id)
    await settled()
    expect(rowGoneWhenDeleting).toBe(true)
    expect(stores.del).toHaveBeenCalledWith([stored?.pathname, stored?.thumbPathname])
  })

  it('deleting a position discards every image the cascade removes, and only after it commits', async () => {
    const journalId = await paper()
    const other = await paper()
    await playbook!.addJournalImage(USER, upload(journalId, { phase: 'ENTRY' }))
    await playbook!.addJournalImage(USER, upload(journalId, { phase: 'EXIT' }))
    const kept = value(await playbook!.addJournalImage(USER, upload(other)))
    const stored = await playbook!.listJournalImages(USER, journalId)

    let rowsWhenDeleting = -1
    stores.del.mockImplementation(async () => {
      rowsWhenDeleting = (await sql!.query('select 1 from journal_images where journal_id = $1', [journalId])).rowCount ?? -1
    })
    await playbook!.deleteJournalEntry(USER, journalId)
    await settled()

    expect(rowsWhenDeleting).toBe(0)
    expect(stores.del).toHaveBeenCalledOnce()
    expect((stores.del.mock.calls[0]?.[0] as string[]).toSorted()).toEqual(
      stored.flatMap((image) => [image.pathname, image.thumbPathname]).toSorted(),
    )
    expect(await playbook!.getJournalImage(USER, kept)).not.toBeNull()
  })

  it('deletes nothing when someone else asks to delete the position', async () => {
    const journalId = await paper()
    await playbook!.addJournalImage(USER, upload(journalId))
    await playbook!.deleteJournalEntry(OTHER, journalId)
    await settled()
    expect(stores.del).not.toHaveBeenCalled()
    expect(await playbook!.listJournalImages(USER, journalId)).toHaveLength(1)
  })

  it('reports a failed delete without failing the position’s removal', async () => {
    const journalId = await paper()
    await playbook!.addJournalImage(USER, upload(journalId))
    const outage = new Error('store down')
    stores.del.mockRejectedValue(outage)
    await expect(playbook!.deleteJournalEntry(USER, journalId)).resolves.toBeUndefined()
    await settled()
    expect(stores.report).toHaveBeenCalledWith(outage, { route: 'playbook.images', phase: 'delete', count: 2 })
    expect(await playbook!.getJournalEntry(USER, journalId)).toBeNull()
  })

  it('archiving keeps the images, still readable, and asks the store to delete nothing', async () => {
    const journalId = await paper()
    const id = value(await playbook!.addJournalImage(USER, upload(journalId)))
    await playbook!.archiveJournalEntry(USER, journalId)
    await settled()
    expect(stores.del).not.toHaveBeenCalled()
    expect(await playbook!.getJournalImage(USER, id)).not.toBeNull()
  })
})

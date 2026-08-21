/**
 * These pin the property the optimistic updates depend on: every patch touches
 * one field and leaves the rest of the month alone.
 *
 * The rollback path is why. An earlier version reverted a failed save by
 * restoring a snapshot of the whole cached month, which also discarded any edit
 * applied while the request was in flight — and a day dialog runs one of these
 * mutations per trade, so overlapping saves are the normal case, not a corner.
 */
import { describe, expect, it } from 'vitest'
import { withNote, withTradeJournal } from './calendarPatch'
import type { CalendarDay } from '~/server/screens'

const trade = (id: string): CalendarDay['trades'][number] => ({
  id,
  symbol: '7203',
  name: 'トヨタ自動車',
  accountType: 'SPECIFIC',
  assetClass: 'JP_EQUITY',
  side: 'SELL',
  quantity: '100',
  unitPrice: '2800.0',
  currency: 'JPY',
  amountJpy: '280000',
  realizedJpy: '12000',
  returnPct: 0.04,
  entryPrice: '2680.0',
  holdingDays: 21,
  memo: null,
  motivation: null,
})

const note = (title: string): CalendarDay['note'] => ({
  title,
  body: '',
  mood: 4,
  motivation: 3,
  tags: [],
})

const month = (): CalendarDay[] => [
  { date: '2026-08-03', realizedJpy: '12000', tradeCount: 2, trades: [trade('a'), trade('b')], note: null },
  { date: '2026-08-04', realizedJpy: null, tradeCount: 0, trades: [], note: note('kept') },
]

describe('withNote', () => {
  it('replaces one day and leaves the others untouched', () => {
    const patched = withNote(month(), '2026-08-03', note('new'))
    expect(patched?.[0]?.note?.title).toBe('new')
    expect(patched?.[1]?.note?.title).toBe('kept')
  })

  it('clears an entry with null, which is also how a delete rolls back', () => {
    const cleared = withNote(month(), '2026-08-04', null)
    expect(cleared?.[1]?.note).toBeNull()
    // Round trip: re-applying the previous value restores it exactly.
    expect(withNote(cleared, '2026-08-04', note('kept'))?.[1]?.note?.title).toBe('kept')
  })

  it('leaves a day’s figures alone — a journal entry cannot move P&L', () => {
    const patched = withNote(month(), '2026-08-03', note('new'))
    expect(patched?.[0]?.realizedJpy).toBe('12000')
    expect(patched?.[0]?.tradeCount).toBe(2)
  })

  it('is a no-op on an uncached month', () => {
    expect(withNote(undefined, '2026-08-03', note('new'))).toBeUndefined()
  })
})

describe('withTradeJournal', () => {
  it('patches the matching trade only', () => {
    const patched = withTradeJournal(month(), 'a', { memo: 'chased it', motivation: 2 })
    expect(patched?.[0]?.trades[0]?.memo).toBe('chased it')
    expect(patched?.[0]?.trades[1]?.memo).toBeNull()
  })

  it('rolls one trade back without disturbing a sibling saved meanwhile', () => {
    // The exact overlap the snapshot-restore rollback got wrong: A is saved,
    // B is saved before A's request returns, then A fails.
    const withA = withTradeJournal(month(), 'a', { memo: 'A', motivation: 5 })
    const withBoth = withTradeJournal(withA, 'b', { memo: 'B', motivation: 1 })

    const rolledBack = withTradeJournal(withBoth, 'a', { memo: null, motivation: null })

    expect(rolledBack?.[0]?.trades[0]?.memo).toBeNull()
    expect(rolledBack?.[0]?.trades[0]?.motivation).toBeNull()
    expect(rolledBack?.[0]?.trades[1]?.memo).toBe('B')
    expect(rolledBack?.[0]?.trades[1]?.motivation).toBe(1)
  })

  it('leaves the trade’s figures alone', () => {
    const patched = withTradeJournal(month(), 'a', { memo: 'note', motivation: 3 })
    expect(patched?.[0]?.trades[0]?.realizedJpy).toBe('12000')
    expect(patched?.[0]?.trades[0]?.quantity).toBe('100')
  })
})

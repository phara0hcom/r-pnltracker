import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import type { NormalizedTrade } from '../domain/types'
import { openEntryStreaks, streakFor } from './entry'

const d = (value: string | number) => new Decimal(value)

/** Only the fields the streak walk reads; the rest never influence it. */
const trade = (
  tradeDate: string,
  side: NormalizedTrade['side'],
  quantity: number,
  unitPrice: number,
): NormalizedTrade =>
  ({
    tradeDate,
    settleDate: tradeDate,
    symbol: '7203',
    name: 'トヨタ自動車',
    assetClass: 'JP_EQUITY',
    accountType: 'SPECIFIC',
    side,
    quantity: d(quantity),
    unitPrice: d(unitPrice),
    currency: 'JPY',
    fee: d(0),
    feeTax: d(0),
    otherCost: d(0),
    fxRate: d(1),
    grossAmount: d(quantity * unitPrice),
    netAmount: d(quantity * unitPrice),
    netAmountJpy: d(quantity * unitPrice),
    isSettled: true,
    sourceRowHash: `${tradeDate}-${side}-${String(quantity)}`,
    sourceFile: 'test',
  }) satisfies NormalizedTrade

const only = (trades: NormalizedTrade[]) => streakFor(openEntryStreaks(trades), '7203', 'SPECIFIC')

describe('openEntryStreaks', () => {
  it('starts the streak at the buy that reopened the position', () => {
    const streak = only([trade('2026-06-01', 'BUY', 500, 1000)])
    expect(streak?.entryDate).toBe('2026-06-01')
    expect(streak?.totalShares.toString()).toBe('500')
    expect(streak?.sharesSold.toString()).toBe('0')
  })

  it('blends the entry price across a position scaled into', () => {
    // 500 @ 1000 then 500 @ 1200 → 1100 blended, which is the price the risk
    // unit R has to be measured from.
    const streak = only([
      trade('2026-06-01', 'BUY', 500, 1000),
      trade('2026-06-02', 'BUY', 500, 1200),
    ])
    expect(streak?.entryPrice.toString()).toBe('1100')
    expect(streak?.totalShares.toString()).toBe('1000')
  })

  it('records a partial sell without ending the streak', () => {
    const streak = only([
      trade('2026-06-01', 'BUY', 500, 1000),
      trade('2026-06-10', 'SELL', 200, 1100),
    ])
    expect(streak?.entryDate).toBe('2026-06-01')
    expect(streak?.sharesSold.toString()).toBe('200')
  })

  it('keeps the sell recorded after a later top-up', () => {
    // The case that broke `partialTaken`: the pool is back above the entry size,
    // but the Target 1 partial has still been taken.
    const streak = only([
      trade('2026-06-01', 'BUY', 500, 1000),
      trade('2026-06-10', 'SELL', 200, 1100),
      trade('2026-06-12', 'BUY', 300, 1150),
    ])
    expect(streak?.sharesSold.toString()).toBe('200')
    expect(streak?.totalShares.toString()).toBe('800')
  })

  it('starts a fresh streak after the position goes flat', () => {
    const streak = only([
      trade('2026-05-01', 'BUY', 500, 900),
      trade('2026-05-20', 'SELL', 500, 950),
      trade('2026-06-01', 'BUY', 300, 1000),
    ])
    expect(streak?.entryDate).toBe('2026-06-01')
    expect(streak?.totalShares.toString()).toBe('300')
    // The previous streak's sells must not carry over.
    expect(streak?.sharesSold.toString()).toBe('0')
  })

  it('omits a pool that is closed', () => {
    expect(
      only([trade('2026-05-01', 'BUY', 500, 900), trade('2026-05-20', 'SELL', 500, 950)]),
    ).toBeNull()
  })
})

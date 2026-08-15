import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { ONE, ZERO, type NormalizedTrade } from '../domain/types'
import { loadAllTrades } from '../import/loadFixtures'
import { holdingWindows, longestHoldBySymbol } from './holdings'

function t(over: Partial<NormalizedTrade>): NormalizedTrade {
  const quantity = over.quantity ?? new Decimal(1)
  const unitPrice = over.unitPrice ?? new Decimal(100)
  const gross = quantity.mul(unitPrice)
  return {
    tradeDate: '2025-01-01',
    settleDate: '2025-01-03',
    symbol: 'TEST',
    name: 'Test',
    assetClass: 'US_EQUITY',
    accountType: 'SPECIFIC',
    side: 'BUY',
    quantity,
    unitPrice,
    currency: 'USD',
    fee: ZERO,
    feeTax: ZERO,
    otherCost: ZERO,
    fxRate: ONE,
    grossAmount: gross,
    netAmount: gross,
    netAmountJpy: gross,
    isSettled: true,
    sourceRowHash: Math.random().toString(36),
    sourceFile: 'synthetic',
    ...over,
  }
}

const AS_OF = '2026-08-04'

describe('holdingWindows', () => {
  it('measures a simple open-to-close hold', () => {
    const w = holdingWindows(
      [
        t({ tradeDate: '2026-01-01', side: 'BUY', quantity: new Decimal(10) }),
        t({ tradeDate: '2026-01-31', side: 'SELL', quantity: new Decimal(10) }),
      ],
      AS_OF,
    )
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ from: '2026-01-01', to: '2026-01-31', days: 30 })
  })

  it('reports a same-day round trip as zero days, not as a phantom window', () => {
    // The sell must not be processed before the buy — that would close a
    // position that does not exist and lose the real window entirely.
    const w = holdingWindows(
      [
        t({ tradeDate: '2026-07-21', side: 'SELL', quantity: new Decimal(5) }),
        t({ tradeDate: '2026-07-21', side: 'BUY', quantity: new Decimal(5) }),
      ],
      AS_OF,
    )
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ from: '2026-07-21', to: '2026-07-21', days: 0 })
  })

  it('keeps one window open across a partial sell', () => {
    const w = holdingWindows(
      [
        t({ tradeDate: '2026-01-01', side: 'BUY', quantity: new Decimal(10) }),
        t({ tradeDate: '2026-01-10', side: 'SELL', quantity: new Decimal(4) }),
        t({ tradeDate: '2026-03-01', side: 'SELL', quantity: new Decimal(6) }),
      ],
      AS_OF,
    )
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ from: '2026-01-01', to: '2026-03-01', days: 59 })
  })

  it('does not restart the window when adding to an open position', () => {
    const w = holdingWindows(
      [
        t({ tradeDate: '2026-01-01', side: 'BUY', quantity: new Decimal(10) }),
        t({ tradeDate: '2026-02-01', side: 'BUY', quantity: new Decimal(10) }),
        t({ tradeDate: '2026-03-01', side: 'SELL', quantity: new Decimal(20) }),
      ],
      AS_OF,
    )
    expect(w).toHaveLength(1)
    expect(w[0]?.from).toBe('2026-01-01')
  })

  it('splits re-entry into separate windows', () => {
    const w = holdingWindows(
      [
        t({ tradeDate: '2026-01-01', side: 'BUY', quantity: new Decimal(1) }),
        t({ tradeDate: '2026-01-11', side: 'SELL', quantity: new Decimal(1) }),
        t({ tradeDate: '2026-02-01', side: 'BUY', quantity: new Decimal(1) }),
        t({ tradeDate: '2026-02-21', side: 'SELL', quantity: new Decimal(1) }),
      ],
      AS_OF,
    )
    expect(w.map((x) => x.days)).toEqual([10, 20])
  })

  it('measures a still-open position against the as-of date', () => {
    const w = holdingWindows(
      [t({ tradeDate: '2026-07-31', side: 'BUY', quantity: new Decimal(55) })],
      AS_OF,
    )
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ to: null, days: 4 })
  })

  it('separates windows per symbol', () => {
    const w = holdingWindows(
      [
        t({ symbol: 'AAA', tradeDate: '2026-01-01', side: 'BUY' }),
        t({ symbol: 'BBB', tradeDate: '2026-01-01', side: 'BUY' }),
        t({ symbol: 'AAA', tradeDate: '2026-01-06', side: 'SELL' }),
      ],
      AS_OF,
    )
    expect(w.find((x) => x.symbol === 'AAA')?.days).toBe(5)
    expect(w.find((x) => x.symbol === 'BBB')?.to).toBeNull()
  })
})

describe('holdingWindows against the real US trades', () => {
  const usTrades = loadAllTrades().trades.filter((t) => t.assetClass === 'US_EQUITY')
  const windows = holdingWindows(usTrades, AS_OF)
  const longest = longestHoldBySymbol(windows)

  it('produces a window for every US ticker traded', () => {
    const traded = new Set(usTrades.map((t) => t.symbol))
    expect(longest.size).toBe(traded.size)
  })

  it('never reports a negative hold', () => {
    expect(windows.every((w) => w.days >= 0)).toBe(true)
  })

  it('finds the long-held names', () => {
    // AMD and BRK B were the only US positions carried for the better part of a
    // year; neither pays a dividend, which is why no US income exists despite it.
    expect(longest.get('AMD')).toBeGreaterThan(300)
    expect(longest.get('BRK B')).toBeGreaterThan(300)
  })
})

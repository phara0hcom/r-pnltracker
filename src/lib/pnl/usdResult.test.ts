/**
 * The SOXL round trip, worked the way its owner works it: price only.
 *
 * Bought 29 @ 142.1166, sold 20 @ 146.0497, bought 2 @ 144.94, sold 11 @
 * 143.75 — $90.9826 over the round trip. Rakuten's export carries no execution
 * time and dates the 2-share buy a day *before* the 20-share sell, so the
 * engine pools it first; that moves dollars between the two sells but cannot
 * change their sum.
 */
import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { ZERO, type NormalizedTrade } from '../domain/types'
import { runEngine } from './engine'
import { usdResult } from './usdResult'

function fill(side: 'BUY' | 'SELL', tradeDate: string, qty: number, price: string): NormalizedTrade {
  const quantity = new Decimal(qty)
  const unitPrice = new Decimal(price)
  const gross = quantity.mul(unitPrice)
  return {
    tradeDate,
    settleDate: '2026-09-28',
    symbol: 'SOXL',
    name: 'SOXL',
    assetClass: 'US_EQUITY',
    accountType: 'SPECIFIC',
    side,
    quantity,
    unitPrice,
    currency: 'USD',
    fee: ZERO,
    feeTax: ZERO,
    otherCost: ZERO,
    fxRate: new Decimal(158),
    grossAmount: gross,
    netAmount: gross,
    netAmountJpy: gross.mul(158).round(),
    isSettled: true,
    sourceRowHash: `${side}${String(qty)}`,
    sourceFile: 'synthetic',
  }
}

const gains = (trades: NormalizedTrade[]) =>
  runEngine(trades).realized.map((close) => usdResult(close, new Decimal(150))!.gainUsd)

describe('price-only dollar result', () => {
  it('matches the round trip worked in the order it happened', () => {
    const result = gains([
      fill('BUY', '2026-09-21', 29, '142.1166'),
      fill('SELL', '2026-09-22', 20, '146.0497'),
      fill('BUY', '2026-09-23', 2, '144.94'),
      fill('SELL', '2026-09-24', 11, '143.75'),
    ])
    expect(result).toEqual(['78.66', '12.32'])
    expect(result.reduce((sum, gain) => sum.add(gain), ZERO).toFixed(2)).toBe('90.98')
  })

  it('keeps the total when the export dates the small buy first', () => {
    const result = gains([
      fill('BUY', '2026-09-23', 2, '144.94'),
      fill('SELL', '2026-09-24', 20, '146.0497'),
      fill('BUY', '2026-09-24', 29, '142.1166'),
      fill('SELL', '2026-09-24', 11, '143.75'),
    ])
    expect(result).toEqual(['75.02', '15.96'])
    expect(result.reduce((sum, gain) => sum.add(gain), ZERO).toFixed(2)).toBe('90.98')
  })

  it('values the gain at the latest rate, and is null for a yen close', () => {
    const [close] = runEngine([
      fill('BUY', '2026-09-21', 10, '100'),
      fill('SELL', '2026-09-22', 10, '101'),
    ]).realized
    expect(usdResult(close!, new Decimal(150))!.gainJpyNow).toBe('1500')
    expect(usdResult(close!, null)!.gainJpyNow).toBeNull()
    expect(usdResult({ ...close!, assetClass: 'JP_EQUITY' }, null)).toBeNull()
  })
})

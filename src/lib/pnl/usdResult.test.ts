/**
 * A US close in dollars, the way Rakuten's 実現損益 screen states it: the sale,
 * less what the shares cost with their buy commission.
 *
 * The fills are real September 2026 ones, copied from the export, and every
 * expected dollar figure is the one Rakuten's app showed for that sell.
 */
import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { ZERO, type NormalizedTrade } from '../domain/types'
import { runEngine } from './engine'
import { usdGain, usdResult } from './usdResult'

/** One fill as the export states it: 約定代金 and 受渡金額 in dollars. */
function fill(
  symbol: string,
  side: 'BUY' | 'SELL',
  tradeDate: string,
  qty: number,
  price: string,
  gross: string,
  net: string,
  fx = '158',
): NormalizedTrade {
  const netAmount = new Decimal(net)
  return {
    tradeDate,
    settleDate: '2026-09-28',
    symbol,
    name: symbol,
    assetClass: 'US_EQUITY',
    accountType: 'SPECIFIC',
    side,
    quantity: new Decimal(qty),
    unitPrice: new Decimal(price),
    currency: 'USD',
    fee: ZERO,
    feeTax: ZERO,
    otherCost: ZERO,
    fxRate: new Decimal(fx),
    grossAmount: new Decimal(gross),
    netAmount,
    netAmountJpy: netAmount.mul(fx).round(),
    isSettled: true,
    sourceRowHash: `${symbol}${side}${String(qty)}${tradeDate}`,
    sourceFile: 'synthetic',
  }
}

const gains = (trades: NormalizedTrade[]) =>
  runEngine(trades).realized.map((close) => usdResult(close)!.gainUsd)

describe('dollar result', () => {
  it('matches Rakuten: the sale, less cost with buy commission, sell commission not taken off', () => {
    expect(
      gains([
        fill('SOFI', 'BUY', '2026-08-25', 200, '18.85', '3770.00', '3788.65'),
        fill('SOFI', 'SELL', '2026-09-02', 200, '16.99', '3398.00', '3381.12'),
      ]),
    ).toEqual(['-390.65'])
    expect(
      gains([
        fill('SMCI', 'BUY', '2026-08-26', 50, '38.66', '1933.00', '1942.55'),
        fill('SMCI', 'SELL', '2026-09-02', 50, '36.51', '1825.50', '1816.43'),
      ]),
    ).toEqual(['-117.05'])
    expect(
      gains([
        fill('AMZN', 'BUY', '2026-09-04', 44, '259.315', '11409.86', '11431.86'),
        fill('AMZN', 'SELL', '2026-09-10', 44, '252.88', '11126.72', '11104.49'),
      ]),
    ).toEqual(['-305.14'])
  })

  it('matches Rakuten on SOXL, bought and sold twice in one day', () => {
    // No execution time in the export, so the day's buys pool first — which
    // is also how Rakuten counts it: both sells reproduce to the cent.
    expect(
      gains([
        fill('SOXL', 'BUY', '2026-09-23', 2, '144.94', '289.88', '291.31'),
        fill('SOXL', 'SELL', '2026-09-24', 11, '143.75', '1581.25', '1573.39'),
        fill('SOXL', 'BUY', '2026-09-24', 29, '142.1166', '4121.38', '4141.77'),
        fill('SOXL', 'SELL', '2026-09-24', 20, '146.0497', '2920.99', '2906.47'),
      ]),
    ).toEqual(['8.22', '60.94'])
  })

  it('keeps the after-commission figure and the yen, currency included, beside it', () => {
    // Bought at ¥159/$ and sold above the dollar cost at ¥155/$: a gain in
    // dollars, a loss in yen.
    const [close] = runEngine([
      fill('X', 'BUY', '2026-09-23', 10, '100', '1000.00', '1000.00', '159'),
      fill('X', 'SELL', '2026-09-24', 10, '102', '1020.00', '1015.00', '155'),
    ]).realized
    const result = usdResult(close!)!
    expect(result.gainUsd).toBe('20.00')
    expect(result.netUsd).toBe('15.00')
    expect(result.gainJpy).toBe('-1675')
    expect(result.returnPct).toBeCloseTo(0.02)
  })

  it('scales the sale down when the engine clamps an oversized close', () => {
    const [close] = runEngine([
      fill('X', 'BUY', '2026-09-23', 10, '100', '1000.00', '1000.00'),
      fill('X', 'SELL', '2026-09-24', 20, '101', '2020.00', '2020.00'),
    ]).realized
    expect(usdGain(close!).toFixed(2)).toBe('10.00')
  })

  it('is null for a yen close', () => {
    const [close] = runEngine([
      fill('X', 'BUY', '2026-09-23', 10, '100', '1000.00', '1000.00'),
      fill('X', 'SELL', '2026-09-24', 10, '101', '1010.00', '1010.00'),
    ]).realized
    expect(usdResult({ ...close!, assetClass: 'JP_EQUITY' })).toBeNull()
  })
})

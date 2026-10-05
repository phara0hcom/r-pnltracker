/**
 * A US stock's row on Stats reads in dollars, as Rakuten shows it, while its
 * yen stays the figure the ranking compares across markets.
 *
 * Built from synthetic trades rather than the real exports `stats.test.ts`
 * loads, so it runs in a clone without `csv/`.
 */
import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { ONE, ZERO, type NormalizedTrade } from '../domain/types'
import { runEngine } from '../pnl/engine'
import { bySymbol } from './stats'

function trade(over: Partial<NormalizedTrade>): NormalizedTrade {
  const quantity = over.quantity ?? new Decimal(10)
  const unitPrice = over.unitPrice ?? new Decimal(100)
  const gross = quantity.mul(unitPrice)
  return {
    tradeDate: '2026-09-01',
    settleDate: '2026-09-03',
    symbol: '8411',
    name: 'みずほフィナンシャルグループ',
    assetClass: 'JP_EQUITY',
    accountType: 'SPECIFIC',
    side: 'BUY',
    quantity,
    unitPrice,
    currency: 'JPY',
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

/** Ten shares of a US stock at a price and a USD/JPY rate. */
function us(side: 'BUY' | 'SELL', tradeDate: string, price: number, fx: number): NormalizedTrade {
  const gross = new Decimal(price).mul(10)
  return trade({
    symbol: 'SOFI',
    name: 'SoFi Technologies Inc',
    assetClass: 'US_EQUITY',
    currency: 'USD',
    side,
    tradeDate,
    unitPrice: new Decimal(price),
    fxRate: new Decimal(fx),
    grossAmount: gross,
    netAmount: gross,
    netAmountJpy: gross.mul(fx),
  })
}

const ranked = bySymbol(
  runEngine([
    trade({ side: 'BUY', tradeDate: '2026-09-01' }),
    trade({ side: 'SELL', tradeDate: '2026-09-02', unitPrice: new Decimal(110), netAmountJpy: new Decimal(1100) }),
    // $10 made in dollars while the yen strengthened from 160 to 150: a loss in yen.
    us('BUY', '2026-09-01', 100, 160),
    us('SELL', '2026-09-02', 101, 150),
  ]).realized,
)

describe('bySymbol in dollars', () => {
  it('gives a US stock its dollar result beside the yen', () => {
    const sofi = ranked.find((row) => row.symbol === 'SOFI')
    expect(sofi?.netUsd?.toFixed(2)).toBe('10.00')
    // 1,010 × 150 − 1,000 × 160.
    expect(sofi?.netPnl.toFixed(0)).toBe('-8500')
  })

  it('leaves anything else in yen alone', () => {
    const mizuho = ranked.find((row) => row.symbol === '8411')
    expect(mizuho?.netUsd).toBeNull()
    expect(mizuho?.netPnl.toFixed(0)).toBe('100')
  })

  it('still ranks by yen, the one measure both markets share', () => {
    expect(ranked.map((row) => row.symbol)).toEqual(['8411', 'SOFI'])
  })
})

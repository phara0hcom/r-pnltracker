import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { ONE, ZERO, type NormalizedTrade } from '../domain/types'
import { runEngine } from './engine'
import { splitByDay, splitByMarket, toSplitView } from './markets'

function trade(over: Partial<NormalizedTrade>): NormalizedTrade {
  const quantity = over.quantity ?? new Decimal(10)
  const unitPrice = over.unitPrice ?? new Decimal(100)
  const gross = quantity.mul(unitPrice)
  return {
    tradeDate: '2026-09-01',
    settleDate: '2026-09-03',
    symbol: '8411',
    name: '8411',
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

/** A US fill at a given USD/JPY, with its yen worked out from the dollars. */
function us(side: 'BUY' | 'SELL', tradeDate: string, price: number, fx: number): NormalizedTrade {
  const gross = new Decimal(price).mul(10)
  return trade({
    symbol: 'SOFI',
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

const closes = runEngine([
  trade({ side: 'BUY', tradeDate: '2026-09-01' }),
  trade({ side: 'SELL', tradeDate: '2026-09-02', unitPrice: new Decimal(110), netAmountJpy: new Decimal(1100) }),
  // $10 made in dollars, while the yen strengthened from 160 to 150.
  us('BUY', '2026-09-01', 100, 160),
  us('SELL', '2026-09-02', 101, 150),
]).realized

describe('splitByMarket', () => {
  it('keeps the yen side in yen and the US side in dollars, with its yen alongside', () => {
    const view = toSplitView(splitByMarket(closes))
    expect(view.jpyRealizedJpy).toBe('100')
    expect(view.usdRealizedUsd).toBe('10.00')
    // 1,010 × 150 − 1,000 × 160: the dollar gain is a yen loss.
    expect(view.usdRealizedJpy).toBe('-8500')
  })

  it('totals in yen with the currency move included', () => {
    expect(splitByMarket(closes).totalJpy.toFixed()).toBe('-8400')
  })

  it('leaves a side null when nothing closed there', () => {
    const view = toSplitView(splitByMarket(closes.filter((close) => close.assetClass !== 'US_EQUITY')))
    expect(view.usdRealizedUsd).toBeNull()
    expect(view.usdRealizedJpy).toBeNull()
    expect(view.totalJpy).toBe('100')
    expect(toSplitView(splitByMarket([])).totalJpy).toBe('0')
  })

  it('splits per 約定日 for the calendar', () => {
    const days = splitByDay(closes)
    expect([...days.keys()]).toEqual(['2026-09-02'])
    expect(days.get('2026-09-02')?.totalJpy.toFixed()).toBe('-8400')
  })
})

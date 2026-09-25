import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import type { PositionState } from './engine'
import { valuePosition } from './positionValue'

// 10 shares bought at $100 when the dollar cost ¥159: ¥159,000 paid.
const soxl: PositionState = {
  symbol: 'SOXL',
  name: 'SOXL',
  assetClass: 'US_EQUITY',
  accountType: 'SPECIFIC',
  quantity: new Decimal(10),
  costBasisJpy: new Decimal(159_000),
  costBasisNative: new Decimal(1000),
  avgFxRate: new Decimal(159),
  avgPriceNative: new Decimal(100),
}

describe('valuePosition', () => {
  it('shows a US holding up in dollars as a gain, though the yen weakened', () => {
    const value = valuePosition(soxl, '102', new Decimal(150))
    expect(value.unrealizedUsd).toBe('20.00')
    expect(value.unrealizedPct).toBeCloseTo(0.02)
    expect(value.unrealizedJpy).toBe('3000')
    // The taxable figure still carries the currency move.
    expect(value.unrealizedTaxJpy).toBe('-6000')
  })

  it('makes value − cost = unrealized in yen on the row', () => {
    const value = valuePosition(soxl, '102.37', new Decimal('149.83'))
    expect(
      Number(value.marketValueJpy) - Number(value.costShownJpy),
    ).toBe(Number(value.unrealizedJpy))
    expect(value.costUsd).toBe('1000.00')
    expect(value.marketValueUsd).toBe('1023.70')
  })

  it('falls back to the entry rate until a rate has ever been fetched', () => {
    const value = valuePosition(soxl, '102', null)
    expect(value.usdJpy).toBe('159.00')
    expect(value.unrealizedJpy).toBe('3180')
  })

  it('values nothing without a price, but still shows the cost', () => {
    const value = valuePosition(soxl, null, new Decimal(150))
    expect(value.marketValueJpy).toBeNull()
    expect(value.unrealizedJpy).toBeNull()
    expect(value.costShownJpy).toBe('150000')
  })

  it('leaves a yen position against its yen cost basis', () => {
    const jp: PositionState = {
      ...soxl,
      symbol: '8411',
      assetClass: 'JP_EQUITY',
      quantity: new Decimal(100),
      costBasisJpy: new Decimal(300_000),
      costBasisNative: new Decimal(300_000),
      avgFxRate: new Decimal(1),
      avgPriceNative: new Decimal(3000),
    }
    const value = valuePosition(jp, '3100', new Decimal(150))
    expect(value.unrealizedJpy).toBe('10000')
    expect(value.costShownJpy).toBe('300000')
    expect(value.costUsd).toBeNull()
    expect(value.usdJpy).toBeNull()
  })
})

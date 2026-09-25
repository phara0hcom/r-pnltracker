/**
 * Realized P&L in the instrument's own currency.
 *
 * Synthetic on purpose, and kept out of `engine.test.ts`, which loads the real
 * exports at module scope — this must hold on a clone without `csv/`.
 *
 * The SOXL round trip is taken from the Trades screen: two buys and two sells
 * inside two days, entered at ~¥159/$ and exited at ¥155–158/$. Each sell
 * cleared the average dollar cost, yet the yen figure — each trade converted at
 * its own rate, which is how it is taxed — is a loss on both.
 */
import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { ZERO, type NormalizedTrade } from '../domain/types'
import { runEngine } from './engine'

const d = (value: string | number) => new Decimal(value)

/**
 * A US fill as the parser emits it. `netAmountJpy` is given rather than derived
 * so the yen side reproduces the screen to the yen.
 */
function usFill(
  side: 'BUY' | 'SELL',
  tradeDate: string,
  quantity: number,
  unitPrice: string,
  gross: string,
  costs: string,
  fxRate: string,
  netAmountJpy: number,
): NormalizedTrade {
  const grossAmount = d(gross)
  return {
    tradeDate,
    settleDate: '2026-09-28',
    symbol: 'SOXL',
    name: 'DRX SEMICONDUCTOR BULL 3X',
    assetClass: 'US_EQUITY',
    accountType: 'SPECIFIC',
    side,
    quantity: d(quantity),
    unitPrice: d(unitPrice),
    currency: 'USD',
    fee: d(costs),
    feeTax: ZERO,
    otherCost: ZERO,
    fxRate: d(fxRate),
    grossAmount,
    netAmount: side === 'BUY' ? grossAmount.add(costs) : grossAmount.sub(costs),
    netAmountJpy: d(netAmountJpy),
    isSettled: true,
    sourceRowHash: `${side}${String(quantity)}`,
    sourceFile: 'synthetic',
  }
}

const soxl = [
  usFill('BUY', '2026-09-23', 2, '144.94', '289.88', '1.43', '158.15', 46_071),
  usFill('SELL', '2026-09-24', 20, '146.0497', '2920.99', '14.54', '155.47', 451_866),
  usFill('BUY', '2026-09-24', 29, '142.1166', '4121.38', '20.39', '159.20', 659_353),
  usFill('SELL', '2026-09-24', 11, '143.75', '1581.25', '7.86', '158.04', 248_659),
]

describe('native-currency realized P&L', () => {
  const { realized, positions } = runEngine(soxl)
  const [first, second] = realized

  it('reproduces the yen loss the Trades screen showed', () => {
    expect(first!.realizedJpy.toFixed()).toBe('-3246')
    expect(second!.realizedJpy.toFixed()).toBe('-1653')
  })

  it('reports the same closes as dollar gains', () => {
    // Pool: $291.31 + $4,141.77 = $4,433.08 over 31 shares, buy commission in.
    // 20 of them cost $2,860.05, the remaining 11 cost $1,573.03.
    expect(first!.costNative.toFixed(2)).toBe('2860.05')
    expect(first!.realizedNative.toFixed(2)).toBe('46.40')
    expect(second!.costNative.toFixed(2)).toBe('1573.03')
    expect(second!.realizedNative.toFixed(2)).toBe('0.36')
  })

  it('is net of selling costs — adding them back gives the price-only gain', () => {
    // (sell price − average cost) × shares, before the $22.40 of commission,
    // tax and SEC fee taken off the two sells.
    const beforeCosts = first!.realizedNative.add('14.54').add(second!.realizedNative).add('7.86')
    expect(beforeCosts.toFixed(2)).toBe('69.16')
  })

  it('empties the dollar pool with the yen one on a full exit', () => {
    expect(positions).toEqual([])
    const totalCost = first!.costNative.add(second!.costNative)
    expect(totalCost.toFixed(2)).toBe('4433.08')
  })

  it('carries the dollar cost on an open position', () => {
    const open = runEngine(soxl.slice(0, 3)).positions
    expect(open).toHaveLength(1)
    expect(open[0]!.quantity.toFixed()).toBe('11')
    expect(open[0]!.costBasisNative.toFixed(2)).toBe('1573.03')
  })

  it('matches the yen figure for a yen instrument', () => {
    const jp = (side: 'BUY' | 'SELL', tradeDate: string, amount: number): NormalizedTrade => ({
      ...usFill(side, tradeDate, 100, '1000', '100000', '0', '1', amount),
      symbol: '8411',
      assetClass: 'JP_EQUITY',
      currency: 'JPY',
      netAmount: d(amount),
    })
    const [close] = runEngine([
      jp('BUY', '2026-01-05', 100_000),
      jp('SELL', '2026-02-05', 112_500),
    ]).realized
    expect(close!.realizedNative.toFixed()).toBe('12500')
    expect(close!.realizedNative.eq(close!.realizedJpy)).toBe(true)
  })
})

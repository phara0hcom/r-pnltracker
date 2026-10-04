/**
 * The cost each unit of a close is measured against, as the calendar shows it
 * beside the result: quantity × (price − cost per unit) has to give that result
 * back, which the average buy price does not once there is a commission.
 */
import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { ONE, ZERO, type NormalizedTrade } from '../domain/types'
import { costPerUnit } from './costPerUnit'
import { runEngine } from './engine'
import { usdResult } from './usdResult'

function trade(over: Partial<NormalizedTrade> & Pick<NormalizedTrade, 'side' | 'tradeDate'>): NormalizedTrade {
  const quantity = over.quantity ?? ONE
  const unitPrice = over.unitPrice ?? new Decimal(100)
  const gross = quantity.mul(unitPrice)
  return {
    settleDate: over.tradeDate,
    symbol: 'TEST',
    name: 'Test',
    assetClass: 'JP_EQUITY',
    accountType: 'SPECIFIC',
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
    sourceRowHash: `${over.side}${over.tradeDate}`,
    sourceFile: 'synthetic',
    ...over,
  }
}

describe('costPerUnit', () => {
  it('gives back a US close’s dollar result, buy commission included', () => {
    // SOFI, September 2026: −$390.65 on Rakuten's 実現損益 screen.
    const usd = { assetClass: 'US_EQUITY', currency: 'USD', fxRate: new Decimal(158) } as const
    const [close] = runEngine([
      trade({
        ...usd,
        side: 'BUY',
        tradeDate: '2026-08-25',
        quantity: new Decimal(200),
        unitPrice: new Decimal('18.85'),
        grossAmount: new Decimal('3770.00'),
        netAmount: new Decimal('3788.65'),
        netAmountJpy: new Decimal(598607),
      }),
      trade({
        ...usd,
        side: 'SELL',
        tradeDate: '2026-09-02',
        quantity: new Decimal(200),
        unitPrice: new Decimal('16.99'),
        grossAmount: new Decimal('3398.00'),
        netAmount: new Decimal('3381.12'),
        netAmountJpy: new Decimal(534217),
      }),
    ]).realized
    if (!close) throw new Error('no close')

    expect(costPerUnit(close).toFixed(4)).toBe('18.9433')
    expect(close.exitPriceNative.sub(costPerUnit(close)).mul(close.quantity).toFixed(2)).toBe(
      usdResult(close)?.gainUsd,
    )
    // The average buy price misses it by the commission.
    expect(close.entryPriceNative.toFixed(2)).toBe('18.85')
  })

  it('carries a Japanese stock’s commission and its round-up to the whole yen', () => {
    // ¥301 for three shares is ¥100.33 each, which Rakuten rounds up to ¥101.
    const [close] = runEngine([
      trade({ side: 'BUY', tradeDate: '2026-05-01', quantity: new Decimal(3), fee: ONE, netAmount: new Decimal(301), netAmountJpy: new Decimal(301) }),
      trade({ side: 'SELL', tradeDate: '2026-05-07', quantity: new Decimal(3), unitPrice: new Decimal(110) }),
    ]).realized
    if (!close) throw new Error('no close')

    expect(costPerUnit(close).toFixed()).toBe('101')
    expect(close.exitPriceNative.sub(costPerUnit(close)).mul(close.quantity).toFixed(0)).toBe(
      close.realizedJpy.toFixed(0),
    )
    expect(close.entryPriceNative.toFixed()).toBe('100')
  })
})

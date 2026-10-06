/**
 * The market switch filters trades *before* the engine, as the account switch
 * does. It is exact for a simpler reason: a symbol has one asset class, so a
 * market is a set of whole pools, and dropping one cannot touch another.
 *
 * Asserted here on a synthetic book built to tempt the two kinds of
 * interference that would break it — the same account holding both markets,
 * and trades of both markets on one day under a hand-set order — and against
 * the real history in `accountFilter.test.ts`.
 */
import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { matchesMarketFilter, type NormalizedTrade } from '../domain/types'
import { runEngine } from './engine'
import { makeTrade as trade, US_TRADE as usd } from '~/test/trade'

const BOOK: NormalizedTrade[] = [
  // 特定 holds both markets, bought and part-sold on the same days.
  trade({ symbol: '8411', tradeDate: '2026-09-01', quantity: new Decimal(100), unitPrice: new Decimal(3001) }),
  trade({ ...usd, symbol: 'NVDA', tradeDate: '2026-09-01', quantity: new Decimal(5), unitPrice: new Decimal(120.5) }),
  trade({ symbol: '8411', tradeDate: '2026-09-02', quantity: new Decimal(50), unitPrice: new Decimal(3100) }),
  trade({ ...usd, symbol: 'NVDA', tradeDate: '2026-09-02', side: 'SELL', quantity: new Decimal(2), unitPrice: new Decimal(125) }),
  trade({ symbol: '8411', tradeDate: '2026-09-02', side: 'SELL', quantity: new Decimal(30), unitPrice: new Decimal(3150) }),
  // NISA: a fund (JP), and a US stock whose day is ordered by hand — sell, then
  // buy, against the engine's default of opens first, so the order changes the
  // close's cost. A JP buy on the same day in the same account carries no order,
  // which is what tempts a filter to change the outcome: the hand-set order
  // holds per pool-day, and must not depend on which other pools are present.
  trade({ symbol: 'eMAXIS Slim', assetClass: 'FUND', accountType: 'NISA_TSUMITATE', quantity: new Decimal(12345), unitPrice: new Decimal('2.9876') }),
  trade({ ...usd, symbol: 'VOO', accountType: 'NISA_GROWTH', tradeDate: '2026-09-02', quantity: new Decimal(2), unitPrice: new Decimal(450) }),
  trade({ ...usd, symbol: 'VOO', accountType: 'NISA_GROWTH', tradeDate: '2026-09-03', side: 'SELL', quantity: new Decimal(1), unitPrice: new Decimal(500), daySequence: 1 }),
  trade({ ...usd, symbol: 'VOO', accountType: 'NISA_GROWTH', tradeDate: '2026-09-03', quantity: new Decimal(3), unitPrice: new Decimal(490), daySequence: 2 }),
  trade({ symbol: '7203', accountType: 'NISA_GROWTH', tradeDate: '2026-09-03', quantity: new Decimal(100), unitPrice: new Decimal(2800) }),
]

const positionKeys = (result: ReturnType<typeof runEngine>) =>
  result.positions
    .map((p) => [p.symbol, p.accountType, p.quantity.toFixed(), p.costBasisJpy.toFixed(), p.avgPriceNative.toFixed()].join('|'))
    .sort()

const realizedKeys = (result: ReturnType<typeof runEngine>) =>
  result.realized
    .map((e) => [e.tradeDate, e.symbol, e.accountType, e.quantity.toFixed(), e.realizedJpy.toFixed(), e.costJpy.toFixed()].join('|'))
    .sort()

describe('filtering by market before the engine is exact', () => {
  const full = runEngine(BOOK)

  for (const market of ['JP', 'US'] as const) {
    const filtered = runEngine(BOOK.filter((t) => matchesMarketFilter(t.assetClass, market)))
    const subset = {
      ...full,
      positions: full.positions.filter((p) => matchesMarketFilter(p.assetClass, market)),
      realized: full.realized.filter((e) => matchesMarketFilter(e.assetClass, market)),
    }

    it(`leaves the ${market} positions and closes identical to the unfiltered run`, () => {
      expect(filtered.positions.length).toBeGreaterThan(0)
      expect(filtered.realized.length).toBeGreaterThan(0)
      expect(positionKeys(filtered)).toEqual(positionKeys(subset))
      expect(realizedKeys(filtered)).toEqual(realizedKeys(subset))
    })
  }

  it('honours the hand-set order in the book it is checked against', () => {
    // Without this, the case above could pass on a day the order did not matter:
    // the sale is costed at the 2026-09-02 buy alone ($450), not averaged with
    // the later $490 one, which an opens-first order would do.
    const sale = full.realized.find((event) => event.symbol === 'VOO')
    expect(sale?.costJpy.toFixed()).toBe(new Decimal(450).mul(150).toFixed())
  })

  it('partitions the book — JP and US sum back to ALL, warnings included', () => {
    const jp = runEngine(BOOK.filter((t) => matchesMarketFilter(t.assetClass, 'JP')))
    const us = runEngine(BOOK.filter((t) => matchesMarketFilter(t.assetClass, 'US')))
    expect(jp.positions.length + us.positions.length).toBe(full.positions.length)
    expect(jp.realized.length + us.realized.length).toBe(full.realized.length)
    expect(jp.warnings.length + us.warnings.length).toBe(full.warnings.length)
  })
})

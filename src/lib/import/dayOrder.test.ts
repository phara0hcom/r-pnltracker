import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { ONE, ZERO, type NormalizedTrade } from '../domain/types'
import { runEngine } from '../pnl/engine'
import { daysToOrder, orderProblem, type OrderCandidate } from './dayOrder'

function trade(side: 'BUY' | 'SELL', date: string, qty: number, price: string, symbol = 'SOXL'): NormalizedTrade {
  const quantity = new Decimal(qty)
  const unitPrice = new Decimal(price)
  const gross = quantity.mul(unitPrice)
  return {
    tradeDate: date,
    settleDate: '2026-09-28',
    symbol,
    name: symbol,
    assetClass: 'US_EQUITY',
    accountType: 'SPECIFIC',
    side,
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
    sourceRowHash: `${side}${String(qty)}${date}`,
    sourceFile: 'synthetic',
  }
}

const candidate = (id: string, t: NormalizedTrade, incoming = true): OrderCandidate => ({
  id,
  trade: t,
  incoming,
})

describe('daysToOrder', () => {
  it('offers a day where one pool is both bought and sold, opens first', () => {
    const days = daysToOrder(
      [],
      [
        candidate('s20', trade('SELL', '2026-09-24', 20, '146.0497')),
        candidate('b29', trade('BUY', '2026-09-24', 29, '142.1166')),
        candidate('s11', trade('SELL', '2026-09-24', 11, '143.75')),
        candidate('b2', trade('BUY', '2026-09-24', 2, '144.94')),
      ],
    )
    expect(days).toHaveLength(1)
    expect(days[0]!.trades.map((c) => c.id)).toEqual(['b29', 'b2', 's20', 's11'])
  })

  it('skips days where order cannot matter', () => {
    const days = daysToOrder(
      [],
      [
        candidate('a', trade('BUY', '2026-09-24', 1, '10', 'AAA')),
        candidate('b', trade('SELL', '2026-09-24', 1, '10', 'BBB')),
      ],
    )
    expect(days).toEqual([])
  })

  it('includes stored trades of the day, and moves a restated one to its new date', () => {
    const stored = [
      candidate('b29', trade('BUY', '2026-09-24', 29, '142.1166'), false),
      candidate('b2', trade('BUY', '2026-09-23', 2, '144.94'), false),
    ]
    const days = daysToOrder(stored, [
      candidate('b2', trade('BUY', '2026-09-24', 2, '144.94')),
      candidate('s20', trade('SELL', '2026-09-24', 20, '146.0497')),
    ])
    expect(days.map((day) => day.date)).toEqual(['2026-09-24'])
    expect(days[0]!.trades.map((c) => [c.id, c.incoming])).toEqual([
      ['b29', false],
      ['b2', true],
      ['s20', true],
    ])
  })
})

describe('a day ordered by hand', () => {
  const day = [
    trade('BUY', '2026-09-24', 29, '142.1166'),
    trade('SELL', '2026-09-24', 20, '146.0497'),
    trade('BUY', '2026-09-24', 2, '144.94'),
    trade('SELL', '2026-09-24', 11, '143.75'),
  ]
  const gains = (trades: NormalizedTrade[]) =>
    runEngine(trades).realized.map((close) =>
      close.exitPriceNative.sub(close.entryPriceNative).mul(close.quantity).toFixed(2),
    )

  it('is averaged in that order', () => {
    const sequenced = day.map((t, index) => ({ ...t, daySequence: index }))
    expect(gains(sequenced)).toEqual(['78.66', '12.32'])
  })

  it('does not depend on other pools on the date, so the account filter cannot move it', () => {
    const sequenced = day.map((t, index) => ({ ...t, daySequence: index }))
    const nisa = { ...trade('BUY', '2026-09-24', 5, '100', 'SOXL'), accountType: 'NISA_GROWTH' as const }
    expect(gains([...sequenced, nisa])).toEqual(['78.66', '12.32'])
  })

  it('falls back to opens-first while any trade on the day is unordered', () => {
    const partial = day.map((t, index) => (index === 3 ? t : { ...t, daySequence: index }))
    expect(gains(partial)).toEqual(['75.02', '15.96'])
  })
})

describe('orderProblem', () => {
  const records = [
    { id: 'b29', trade: trade('BUY', '2026-09-24', 29, '142.1166') },
    { id: 's20', trade: trade('SELL', '2026-09-24', 20, '146.0497') },
    { id: 'b2', trade: trade('BUY', '2026-09-24', 2, '144.94') },
    { id: 's11', trade: trade('SELL', '2026-09-24', 11, '143.75') },
  ]
  const order = (ids: string[]) => new Map(ids.map((id, index) => [id, index]))

  it('accepts the order it happened in', () => {
    expect(orderProblem(records, '2026-09-24', order(['b29', 's20', 'b2', 's11']))).toBeNull()
  })

  it('refuses a sale placed before the buy it needs', () => {
    expect(orderProblem(records, '2026-09-24', order(['s20', 'b29', 'b2', 's11']))).toBe(
      'That order sells SOXL before enough of it was bought.',
    )
  })
})

describe('orderProblem against a history already short', () => {
  // 30 held, a sale of 50 and a buy of 10 the same day: short either way.
  const records = [
    { id: 'b30', trade: trade('BUY', '2026-09-20', 30, '100') },
    { id: 's50', trade: trade('SELL', '2026-09-24', 50, '110') },
    { id: 'b10', trade: trade('BUY', '2026-09-24', 10, '105') },
  ]
  const order = (ids: string[]) => new Map(ids.map((id, index) => [id, index]))

  it('accepts an order that is short by no more than before', () => {
    // Opens-first already has the buy ahead of the sale: 40 held, 10 short.
    expect(orderProblem(records, '2026-09-24', order(['b10', 's50']))).toBeNull()
  })

  it('refuses one that is shorter, though the warning text differs either way', () => {
    expect(orderProblem(records, '2026-09-24', order(['s50', 'b10']))).toBe(
      'That order sells SOXL before enough of it was bought.',
    )
  })
})

/**
 * Engine tests.
 *
 * The valuable assertions here are the ground-truth ones — figures that come
 * from Rakuten's own official documents rather than from this codebase. If the
 * engine drifts, these break.
 */
import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import type { NormalizedTrade } from '../domain/types'
import { ONE, ZERO } from '../domain/types'
import { loadAllTrades } from '../import/loadFixtures'
import { bySettlementYear, runEngine, sortTradesForEngine, totalRealized } from './engine'

const trades = loadAllTrades().trades
const engine = runEngine(trades)

/** Minimal synthetic trade for unit-level cases. */
function t(over: Partial<NormalizedTrade>): NormalizedTrade {
  const quantity = over.quantity ?? new Decimal(1)
  const unitPrice = over.unitPrice ?? new Decimal(100)
  const gross = quantity.mul(unitPrice)
  return {
    tradeDate: '2025-01-01',
    settleDate: '2025-01-03',
    symbol: 'TEST',
    name: 'Test',
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

describe('trade ordering', () => {
  it('places same-day opens before closes', () => {
    // 8411 is bought and sold on 2026-07-29. Processing the sell first would
    // hit an empty pool and lose the trade entirely.
    const sameDay = [
      t({ side: 'SELL', tradeDate: '2026-01-01', symbol: 'X' }),
      t({ side: 'BUY', tradeDate: '2026-01-01', symbol: 'X' }),
    ]
    const sorted = sortTradesForEngine(sameDay)
    expect(sorted[0]!.side).toBe('BUY')
  })

  it('resolves the real same-day 8411 round trip without warnings', () => {
    const w = engine.warnings.filter((x) => x.symbol === '8411')
    expect(w).toEqual([])
  })
})

describe('cost basis', () => {
  it('uses moving weighted average, not FIFO', () => {
    // Buy 100@100 then 100@200 → avg 150. Selling 100@200 realizes 50/unit
    // under weighted average, but 100/unit under FIFO.
    const r = runEngine([
      t({ side: 'BUY', quantity: new Decimal(100), unitPrice: new Decimal(100) }),
      t({
        side: 'BUY',
        tradeDate: '2025-02-01',
        quantity: new Decimal(100),
        unitPrice: new Decimal(200),
      }),
      t({
        side: 'SELL',
        tradeDate: '2025-03-01',
        quantity: new Decimal(100),
        unitPrice: new Decimal(200),
      }),
    ])
    expect(r.realized).toHaveLength(1)
    expect(r.realized[0]!.realizedJpy.toFixed()).toBe('5000') // (200−150)×100
    expect(r.positions[0]!.costBasisJpy.toFixed()).toBe('15000')
  })

  it('keeps 特定 and NISA pools independent for the same ticker', () => {
    const r = runEngine([
      t({ accountType: 'SPECIFIC', quantity: new Decimal(10), unitPrice: new Decimal(100) }),
      t({ accountType: 'NISA_GROWTH', quantity: new Decimal(10), unitPrice: new Decimal(500) }),
      t({
        side: 'SELL',
        tradeDate: '2025-06-01',
        accountType: 'SPECIFIC',
        quantity: new Decimal(10),
        unitPrice: new Decimal(200),
      }),
    ])
    // If pools were commingled the average would be 300 and this would be a loss.
    expect(r.realized[0]!.realizedJpy.toFixed()).toBe('1000')
    expect(r.realized[0]!.isTaxable).toBe(true)
  })

  it('treats reinvestment as a cost-basis-bearing buy', () => {
    const r = runEngine([
      t({ assetClass: 'FUND', quantity: new Decimal(100), unitPrice: new Decimal(10) }),
      t({
        side: 'REINVEST',
        tradeDate: '2025-02-01',
        assetClass: 'FUND',
        quantity: new Decimal(10),
        unitPrice: new Decimal(10),
      }),
    ])
    const p = r.positions[0]!
    expect(p.quantity.toFixed()).toBe('110')
    // Ignoring the reinvestment's cost would leave basis at 1000 and overstate gains.
    expect(p.costBasisJpy.toFixed()).toBe('1100')
  })

  it('flags a close with no open position rather than going negative', () => {
    const r = runEngine([t({ side: 'SELL', quantity: new Decimal(5) })])
    expect(r.realized).toHaveLength(0)
    expect(r.warnings).toHaveLength(1)
    expect(r.positions).toHaveLength(0)
  })
})

describe('real portfolio', () => {
  it('processes all 315 trades', () => {
    expect(trades).toHaveLength(315)
  })

  it('leaves no position with negative quantity or basis', () => {
    for (const p of engine.positions) {
      expect(p.quantity.gt(0)).toBe(true)
      expect(p.costBasisJpy.gte(0)).toBe(true)
    }
  })

  it('realizes every closing trade, with no unmatched closes', () => {
    const closes = trades.filter((x) => x.side === 'SELL' || x.side === 'REDEEM')
    // Every close must find a pool. A non-empty warning list here means the
    // trade history is incomplete or an instrument identity is wrong.
    expect(engine.warnings).toEqual([])
    expect(engine.realized.length).toBe(closes.length)
  })

  it('tracks entry FX only for US positions', () => {
    // Collected rather than asserted in-loop so a failure names every offending
    // position instead of stopping at the first.
    const badUs = engine.positions
      .filter((p) => p.assetClass === 'US_EQUITY')
      .filter((p) => !(p.avgFxRate.gt(100) && p.avgFxRate.lt(200)))
      .map((p) => `${p.symbol}: fx=${p.avgFxRate.toFixed()}`)
    expect(badUs).toEqual([])

    const badJpy = engine.positions
      .filter((p) => p.assetClass !== 'US_EQUITY')
      .filter((p) => !p.avgFxRate.eq(1))
      .map((p) => `${p.symbol}: fx=${p.avgFxRate.toFixed()}`)
    expect(badJpy).toEqual([])
  })
})

describe('ground truth — official 特定口座年間取引報告書 (2025)', () => {
  const taxable = engine.realized.filter((e) => e.isTaxable)
  const byYear = bySettlementYear(taxable)

  it('reports zero taxable realized gains for 2025', () => {
    // The official XML has 0 in every 譲渡 field for 2025, and the trade data
    // independently contains no 特定 sells settling that year. Two unrelated
    // sources agreeing — the strongest check available.
    const y2025 = byYear.get(2025) ?? []
    expect(y2025).toHaveLength(0)
    expect(totalRealized(y2025).toFixed()).toBe('0')
  })

  it('concentrates taxable disposals in 2026', () => {
    const y2026 = byYear.get(2026) ?? []
    expect(y2026.length).toBe(72)
  })

  it('attributes to settlement year, not trade year', () => {
    // A trade executed in Dec settling in Jan belongs to the later tax year.
    const r = runEngine([
      t({ tradeDate: '2025-06-01', quantity: new Decimal(10), unitPrice: new Decimal(100) }),
      t({
        side: 'SELL',
        tradeDate: '2025-12-30',
        settleDate: '2026-01-06',
        quantity: new Decimal(10),
        unitPrice: new Decimal(150),
      }),
    ])
    const years = bySettlementYear(r.realized)
    expect(years.has(2025)).toBe(false)
    expect(years.get(2026)).toHaveLength(1)
  })
})

describe('holding period', () => {
  it('measures from the quantity-weighted mean entry date', () => {
    const r = runEngine([
      t({ tradeDate: '2025-01-01', quantity: new Decimal(100), unitPrice: new Decimal(10) }),
      t({ tradeDate: '2025-01-31', quantity: new Decimal(100), unitPrice: new Decimal(10) }),
      t({
        side: 'SELL',
        tradeDate: '2025-03-02',
        quantity: new Decimal(200),
        unitPrice: new Decimal(20),
      }),
    ])
    // Mean entry is 2025-01-16; 2025-03-02 is 45 days later.
    expect(r.realized[0]!.avgEntryDate).toBe('2025-01-16')
    expect(r.realized[0]!.holdingDays).toBe(45)
  })

  it('never reports a negative holding period on real data', () => {
    for (const e of engine.realized) expect(e.holdingDays).toBeGreaterThanOrEqual(0)
  })
})

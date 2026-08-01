/**
 * Stats and FX attribution tests.
 *
 * Emphasis on the degenerate cases — no losses, no trades, a monotonic curve —
 * because those are where naive implementations emit Infinity or NaN into the UI.
 */
import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { loadAllTrades } from '../import/loadFixtures'
import { runEngine } from '../pnl/engine'
import type { RealizedEvent } from '../pnl/engine'
import { attributeFx, attributeOne } from '../pnl/fxAttribution'
import { bySymbol, computeStats, dailyPnl } from './stats'

const trades = loadAllTrades().trades
const engine = runEngine(trades)

function ev(over: Partial<RealizedEvent>): RealizedEvent {
  return {
    tradeDate: '2026-01-01',
    settleDate: '2026-01-05',
    symbol: 'X',
    name: 'X',
    assetClass: 'JP_EQUITY',
    accountType: 'SPECIFIC',
    quantity: new Decimal(1),
    proceedsJpy: new Decimal(100),
    costJpy: new Decimal(100),
    realizedJpy: new Decimal(0),
    entryPriceNative: new Decimal(100),
    exitPriceNative: new Decimal(100),
    entryFxRate: new Decimal(1),
    exitFxRate: new Decimal(1),
    avgEntryDate: '2025-01-01',
    holdingDays: 0,
    isTaxable: true,
    ...over,
  }
}

describe('degenerate cases', () => {
  it('returns nulls, not NaN, with no trades', () => {
    const s = computeStats([])
    expect(s.tradeCount).toBe(0)
    expect(s.winRate).toBeNull()
    expect(s.profitFactor).toBeNull()
    expect(s.avgWin).toBeNull()
    expect(s.avgLoss).toBeNull()
    expect(s.avgHoldingDays).toBeNull()
    expect(s.medianHoldingDays).toBeNull()
    expect(s.maxDrawdown.toFixed()).toBe('0')
    expect(s.equityCurve).toEqual([])
  })

  it('reports profit factor as null when there are no losses', () => {
    // Infinity would render as "∞" or crash a chart axis; undefined is honest.
    const s = computeStats([ev({ realizedJpy: new Decimal(500) })])
    expect(s.profitFactor).toBeNull()
    expect(s.winRate).toBe(1)
    expect(s.payoffRatio).toBeNull()
  })

  it('reports zero drawdown on a monotonically rising curve', () => {
    const s = computeStats([
      ev({ tradeDate: '2026-01-01', realizedJpy: new Decimal(100) }),
      ev({ tradeDate: '2026-01-02', realizedJpy: new Decimal(200) }),
    ])
    expect(s.maxDrawdown.toFixed()).toBe('0')
  })

  it('counts an immediate loss as drawdown rather than ignoring it', () => {
    const s = computeStats([ev({ realizedJpy: new Decimal(-1000) })])
    expect(s.maxDrawdown.toFixed()).toBe('1000')
  })
})

describe('core statistics', () => {
  const events = [
    ev({ tradeDate: '2026-01-01', realizedJpy: new Decimal(300) }),
    ev({ tradeDate: '2026-01-02', realizedJpy: new Decimal(-100) }),
    ev({ tradeDate: '2026-01-03', realizedJpy: new Decimal(200) }),
    ev({ tradeDate: '2026-01-04', realizedJpy: new Decimal(-50) }),
  ]
  const s = computeStats(events)

  it('computes win rate, averages and profit factor', () => {
    expect(s.winRate).toBe(0.5)
    expect(s.grossProfit.toFixed()).toBe('500')
    expect(s.grossLoss.toFixed()).toBe('150')
    expect(s.netPnl.toFixed()).toBe('350')
    expect(s.avgWin!.toFixed()).toBe('250')
    expect(s.avgLoss!.toFixed()).toBe('75')
    expect(s.profitFactor).toBeCloseTo(500 / 150, 6)
  })

  it('measures drawdown from the running peak', () => {
    // Curve: 300, 200, 400, 350. Peak 300 → 200 is a 100 fall.
    expect(s.maxDrawdown.toFixed()).toBe('100')
    expect(s.maxDrawdownPct).toBeCloseTo(100 / 300, 6)
  })

  it('tracks streaks in date order', () => {
    const streaky = computeStats([
      ev({ tradeDate: '2026-01-01', realizedJpy: new Decimal(1) }),
      ev({ tradeDate: '2026-01-02', realizedJpy: new Decimal(1) }),
      ev({ tradeDate: '2026-01-03', realizedJpy: new Decimal(1) }),
      ev({ tradeDate: '2026-01-04', realizedJpy: new Decimal(-1) }),
      ev({ tradeDate: '2026-01-05', realizedJpy: new Decimal(-1) }),
    ])
    expect(streaky.longestWinStreak).toBe(3)
    expect(streaky.longestLossStreak).toBe(2)
  })

  it('weights holding period by position size', () => {
    const weighted = computeStats([
      ev({ costJpy: new Decimal(1_000_000), holdingDays: 100 }),
      ev({ costJpy: new Decimal(10_000), holdingDays: 1 }),
    ])
    // A tiny 1-day flip must not drag the average toward 50.
    expect(weighted.avgHoldingDays!).toBeGreaterThan(95)
    expect(weighted.medianHoldingDays).toBe(50.5)
  })
})

describe('filters', () => {
  it('restricts by account, asset class and date', () => {
    const all = computeStats(engine.realized)
    const nisaOnly = computeStats(engine.realized, {
      accountTypes: ['NISA_GROWTH', 'NISA_TSUMITATE', 'NISA_OLD'],
    })
    const usOnly = computeStats(engine.realized, { assetClasses: ['US_EQUITY'] })
    const y2026 = computeStats(engine.realized, { from: '2026-01-01', to: '2026-12-31' })

    expect(nisaOnly.tradeCount).toBeLessThan(all.tradeCount)
    expect(usOnly.tradeCount).toBeLessThan(all.tradeCount)
    expect(y2026.tradeCount).toBeLessThan(all.tradeCount)
    expect(nisaOnly.tradeCount + computeStats(engine.realized, {
      accountTypes: ['SPECIFIC'],
    }).tradeCount).toBe(all.tradeCount)
  })
})

describe('FX attribution', () => {
  it('splits P&L exactly — components always reconstruct the total', () => {
    const a = attributeOne(
      ev({
        assetClass: 'US_EQUITY',
        quantity: new Decimal(10),
        entryPriceNative: new Decimal(100),
        exitPriceNative: new Decimal(120),
        entryFxRate: new Decimal(150),
        exitFxRate: new Decimal(160),
        realizedJpy: new Decimal(120).mul(160).mul(10).sub(new Decimal(100).mul(150).mul(10)),
      }),
    )
    // stock: (120−100)×160×10 = 32,000 ; fx: 100×(160−150)×10 = 10,000
    expect(a.stockEffectJpy.toFixed()).toBe('32000')
    expect(a.fxEffectJpy.toFixed()).toBe('10000')
    expect(a.costEffectJpy.toFixed()).toBe('0')
    expect(a.stockEffectJpy.add(a.fxEffectJpy).add(a.costEffectJpy).toFixed()).toBe(
      a.totalJpy.toFixed(),
    )
  })

  it('reports zero FX effect when the rate did not move', () => {
    const a = attributeOne(
      ev({
        assetClass: 'US_EQUITY',
        quantity: new Decimal(5),
        entryPriceNative: new Decimal(10),
        exitPriceNative: new Decimal(20),
        entryFxRate: new Decimal(150),
        exitFxRate: new Decimal(150),
      }),
    )
    expect(a.fxEffectJpy.toFixed()).toBe('0')
  })

  it('attributes a pure currency move entirely to FX', () => {
    const a = attributeOne(
      ev({
        assetClass: 'US_EQUITY',
        quantity: new Decimal(1),
        entryPriceNative: new Decimal(100),
        exitPriceNative: new Decimal(100),
        entryFxRate: new Decimal(140),
        exitFxRate: new Decimal(160),
      }),
    )
    expect(a.stockEffectJpy.toFixed()).toBe('0')
    expect(a.fxEffectJpy.toFixed()).toBe('2000')
  })

  it('reconstructs every real US close exactly (property test)', () => {
    const summary = attributeFx(engine.realized)
    expect(summary.events.length).toBeGreaterThan(30)
    for (const e of summary.events) {
      const sum = e.stockEffectJpy.add(e.fxEffectJpy).add(e.costEffectJpy)
      // Exact to the yen across all closes — no drift, no residual.
      expect(sum.sub(e.totalJpy).abs().lt(new Decimal('0.0000001'))).toBe(true)
    }
    const totalSum = summary.stockEffectJpy.add(summary.fxEffectJpy).add(summary.costEffectJpy)
    expect(totalSum.sub(summary.totalJpy).abs().lt(new Decimal('0.0000001'))).toBe(true)
  })

  it('excludes JPY-native instruments, where a currency split is meaningless', () => {
    const summary = attributeFx(engine.realized)
    for (const e of summary.events) {
      expect(e.entryFxRate.gt(1)).toBe(true)
    }
    expect(summary.events.length).toBeLessThan(engine.realized.length)
  })
})

describe('real portfolio', () => {
  const s = computeStats(engine.realized)

  it('produces a coherent summary', () => {
    expect(s.tradeCount).toBe(engine.realized.length)
    expect(s.winCount + s.lossCount + s.breakevenCount).toBe(s.tradeCount)
    expect(s.grossProfit.sub(s.grossLoss).toFixed()).toBe(s.netPnl.toFixed())
    expect(s.equityCurve.at(-1)!.value.toFixed()).toBe(s.netPnl.toFixed())
  })

  it('ranks symbols by contribution', () => {
    const ranked = bySymbol(engine.realized)
    expect(ranked.length).toBeGreaterThan(5)
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.netPnl.gte(ranked[i]!.netPnl)).toBe(true)
    }
  })

  it('buckets realized P&L by day for the calendar', () => {
    const daily = dailyPnl(engine.realized)
    const total = [...daily.values()].reduce((a, v) => a.add(v), new Decimal(0))
    expect(total.toFixed()).toBe(s.netPnl.toFixed())
  })
})

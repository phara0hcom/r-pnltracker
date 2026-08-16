/**
 * NISA quota tests.
 *
 * The four rules are each tested in isolation with synthetic data, then against
 * the real portfolio where one figure is externally verifiable: 2026 成長投資枠
 * lands exactly on the ¥2,400,000 annual cap.
 */
import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import type { NormalizedTrade } from '../domain/types'
import { ONE, ZERO } from '../domain/types'
import { loadAllTrades } from '../import/loadFixtures'
import { runEngine } from '../pnl/engine'
import {
  ANNUAL_GROWTH_LIMIT,
  ANNUAL_TSUMITATE_LIMIT,
  LIFETIME_GROWTH_SUBCAP,
  LIFETIME_LIMIT,
  annualUsage,
  buildNisaReport,
  legacyNisaBookValue,
  lifetimeUsage,
} from './quota'

const trades = loadAllTrades().trades
const engine = runEngine(trades)

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
    accountType: 'NISA_GROWTH',
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

/** A buy of a given yen amount in a given frame and year. */
const buy = (year: number, account: NormalizedTrade['accountType'], amount: number) =>
  t({
    tradeDate: `${year}-06-01`,
    settleDate: `${year}-06-03`,
    accountType: account,
    quantity: new Decimal(1),
    unitPrice: new Decimal(amount),
  })

describe('rule 1 — limits are measured at acquisition cost, not market value', () => {
  it('counts book value only, so gains never consume quota', () => {
    const list = [buy(2025, 'NISA_GROWTH', 1_000_000)]
    const { realized } = runEngine(list)
    const life = lifetimeUsage(list, realized, 2025)
    expect(life.used.toFixed()).toBe('1000000')

    // Sell for 5× the purchase price. Quota consumed is unchanged — only the
    // ¥1,000,000 book value ever occupied the pool.
    const withSale = [
      ...list,
      t({
        tradeDate: '2025-09-01',
        side: 'SELL',
        accountType: 'NISA_GROWTH',
        quantity: new Decimal(1),
        unitPrice: new Decimal(5_000_000),
      }),
    ]
    const r2 = runEngine(withSale)
    const life2 = lifetimeUsage(withSale, r2.realized, 2025)
    expect(life2.used.toFixed()).toBe('1000000')
    expect(life2.pendingRestoration.toFixed()).toBe('1000000') // cost, not proceeds
  })
})

describe('rule 2 — sales restore lifetime quota the FOLLOWING January', () => {
  const list = [
    buy(2025, 'NISA_GROWTH', 2_000_000),
    t({
      tradeDate: '2026-03-01',
      side: 'SELL',
      accountType: 'NISA_GROWTH',
      quantity: new Decimal(1),
      unitPrice: new Decimal(3_000_000),
    }),
  ]
  const { realized } = runEngine(list)

  it('does not free quota within the year of the sale', () => {
    const life = lifetimeUsage(list, realized, 2026)
    expect(life.used.toFixed()).toBe('2000000')
    expect(life.pendingRestoration.toFixed()).toBe('2000000')
    expect(life.restorationDate).toBe('2027-01')
  })

  it('frees it once the next year arrives', () => {
    const life = lifetimeUsage(list, realized, 2027)
    expect(life.used.toFixed()).toBe('0')
    expect(life.pendingRestoration.toFixed()).toBe('0')
  })
})

describe('rule 3 — annual frames never restore', () => {
  it('keeps annual usage at the purchase amount even after selling', () => {
    const list = [
      buy(2026, 'NISA_GROWTH', 2_400_000),
      t({
        tradeDate: '2026-08-01',
        side: 'SELL',
        accountType: 'NISA_GROWTH',
        quantity: new Decimal(1),
        unitPrice: new Decimal(2_400_000),
      }),
    ]
    const annual = annualUsage(list).find((left) => left.year === 2026)!
    // Selling does not hand back this year's ¥2.4M — it is spent.
    expect(annual.used.toFixed()).toBe('2400000')
    expect(annual.remaining.toFixed()).toBe('0')
    expect(annual.isMaxed).toBe(true)
  })

  it('applies the right cap to each frame', () => {
    const list = [buy(2026, 'NISA_GROWTH', 100), buy(2026, 'NISA_TSUMITATE', 100)]
    const annual = annualUsage(list)
    expect(annual.find((left) => left.frame === 'NISA_GROWTH')!.limit.toFixed()).toBe(
      ANNUAL_GROWTH_LIMIT.toFixed(),
    )
    expect(annual.find((left) => left.frame === 'NISA_TSUMITATE')!.limit.toFixed()).toBe(
      ANNUAL_TSUMITATE_LIMIT.toFixed(),
    )
  })
})

describe('rule 4 — 旧NISA is a separate system', () => {
  it('excludes 旧NISA from the lifetime pool entirely', () => {
    const list = [buy(2023, 'NISA_OLD', 1_200_000), buy(2025, 'NISA_GROWTH', 500_000)]
    const { realized } = runEngine(list)
    const life = lifetimeUsage(list, realized, 2025)
    expect(life.used.toFixed()).toBe('500000')
  })

  it('excludes 旧NISA from annual frames', () => {
    const list = [buy(2023, 'NISA_OLD', 1_200_000)]
    expect(annualUsage(list)).toHaveLength(0)
  })

  it('still reports 旧NISA book value separately', () => {
    const list = [buy(2023, 'NISA_OLD', 1_200_000)]
    expect(legacyNisaBookValue(runEngine(list).positions).toFixed()).toBe('1200000')
  })

  it('never reports a negative 旧NISA book value after a profitable sale', () => {
    // Netting sale proceeds against purchases drives this below zero the moment
    // anything is sold at a gain; remaining cost basis is the correct measure.
    const list = [
      buy(2023, 'NISA_OLD', 1_000_000),
      t({
        tradeDate: '2026-02-18',
        side: 'SELL',
        accountType: 'NISA_OLD',
        quantity: new Decimal(1),
        unitPrice: new Decimal(3_000_000),
      }),
    ]
    expect(legacyNisaBookValue(runEngine(list).positions).toFixed()).toBe('0')
  })

  it('reports the real portfolio 旧NISA book value as non-negative', () => {
    expect(legacyNisaBookValue(engine.positions).gte(0)).toBe(true)
  })
})

describe('成長投資枠 ¥12M sub-cap', () => {
  it('tracks the growth sub-cap independently of the ¥18M total', () => {
    const list = [buy(2025, 'NISA_GROWTH', 2_000_000), buy(2025, 'NISA_TSUMITATE', 1_000_000)]
    const { realized } = runEngine(list)
    const life = lifetimeUsage(list, realized, 2025)
    expect(life.used.toFixed()).toBe('3000000')
    expect(life.growthUsed.toFixed()).toBe('2000000')
    expect(life.growthRemaining.toFixed()).toBe(
      LIFETIME_GROWTH_SUBCAP.sub(2_000_000).toFixed(),
    )
    expect(life.remaining.toFixed()).toBe(LIFETIME_LIMIT.sub(3_000_000).toFixed())
  })
})

describe('real portfolio', () => {
  const report = buildNisaReport(trades, engine.realized, 2026)

  it('has 2026 成長投資枠 exactly at the annual cap', () => {
    // Externally verifiable: filling a frame to the yen is deliberate, and it
    // confirms quota is counted on trade date rather than settlement date.
    const growth2026 = report.annual.find(
      (left) => left.year === 2026 && left.frame === 'NISA_GROWTH',
    )!
    expect(growth2026.used.toFixed()).toBe('2400000')
    expect(growth2026.remaining.toFixed()).toBe('0')
    expect(growth2026.isMaxed).toBe(true)
  })

  it('never reports usage above an annual cap', () => {
    for (const a of report.annual) {
      expect(a.used.lte(a.limit)).toBe(true)
    }
  })

  it('excludes the 旧NISA purchases from the lifetime total', () => {
    const legacy = trades
      .filter((item) => item.accountType === 'NISA_OLD' && item.side === 'BUY')
      .reduce((acc, x) => acc.add(x.netAmountJpy), new Decimal(0))
    expect(legacy.gt(2_000_000)).toBe(true) // 旧NISA buys exist and are substantial

    const newNisaBuys = trades
      .filter((item) => (item.accountType === 'NISA_GROWTH' || item.accountType === 'NISA_TSUMITATE') && item.side === 'BUY')
      .reduce((acc, x) => acc.add(x.netAmountJpy), new Decimal(0))

    // Lifetime used must never include the 旧NISA money.
    expect(report.lifetime.used.lte(newNisaBuys)).toBe(true)
  })

  it('stays well inside the ¥18M lifetime cap', () => {
    expect(report.lifetime.used.lt(LIFETIME_LIMIT)).toBe(true)
    expect(report.lifetime.remaining.gt(0)).toBe(true)
    expect(report.lifetime.utilization).toBeLessThan(1)
  })

  it('reports pending restoration for this year’s NISA sales', () => {
    // Several NISA positions were sold in 2026; that book value returns 2027-01.
    expect(report.lifetime.pendingRestoration.gt(0)).toBe(true)
    expect(report.lifetime.restorationDate).toBe('2027-01')
  })

  it('produces a contribution series covering the new-NISA years', () => {
    const years = report.contributionsByYear.map((cell) => cell.year)
    expect(years).toEqual([2024, 2025, 2026])
  })
})

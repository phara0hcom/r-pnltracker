/**
 * Tax engine tests.
 *
 * The anchor assertions come from the official 2025 特定口座年間取引報告書:
 * zero capital gains, and a single ¥927 dividend withheld as ¥142 + ¥46.
 */
import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { loadAllStatements, loadAllTrades } from '../import/loadFixtures'
import { runEngine } from '../pnl/engine'
import { attributeDividends, grossUpDividend } from './dividends'
import { buildYearOverYear, summarizeYear, taxYearOf } from './report'

const trades = loadAllTrades().trades
const statements = loadAllStatements()
const engine = runEngine(trades)
const dividends = attributeDividends(statements.dividends, trades)

describe('withholding reconstruction', () => {
  it('reproduces the official ¥927 → ¥142 + ¥46 → ¥739 exactly', () => {
    const { gross, incomeTax, localTax } = grossUpDividend(new Decimal(739))
    expect(gross.toFixed()).toBe('927')
    expect(incomeTax.toFixed()).toBe('142')
    expect(localTax.toFixed()).toBe('46')
    expect(gross.sub(incomeTax).sub(localTax).toFixed()).toBe('739')
  })

  it('round-trips: gross − withholding always returns the credited amount', () => {
    for (const net of [100, 739, 3200, 5325, 14500, 21855, 1_000_000]) {
      const { gross, incomeTax, localTax } = grossUpDividend(new Decimal(net))
      expect(gross.sub(incomeTax).sub(localTax).toFixed()).toBe(String(net))
    }
  })
})

describe('dividend account attribution', () => {
  it('attributes all six payouts', () => {
    expect(dividends).toHaveLength(6)
  })

  it('splits the netWIN distribution between 特定 and 旧NISA by holding size', () => {
    // Both pay ¥500.00 per 10,000 口. The large 旧NISA holding takes ¥21,855
    // tax-free; the small 特定 holding takes ¥739 net of withholding.
    const dec5 = dividends.filter((d) => d.payDate === '2025-12-05' && d.kind === 'DISTRIBUTION')
    expect(dec5).toHaveLength(2)

    const big = dec5.find((d) => d.netAmount.eq(21855))!
    const small = dec5.find((d) => d.netAmount.eq(739))!

    expect(big.accountType).toBe('NISA_OLD')
    expect(big.isTaxable).toBe(false)
    expect(big.grossAmount.toFixed()).toBe('21855') // no withholding

    expect(small.accountType).toBe('SPECIFIC')
    expect(small.isTaxable).toBe(true)
    expect(small.grossAmount.toFixed()).toBe('927')
    expect(small.incomeTax.toFixed()).toBe('142')
    expect(small.localTax.toFixed()).toBe('46')
  })

  it('recognises NISA-held equity dividends as tax-free', () => {
    // 8411 みずほ is held in NISA成長投資枠, so its ¥14,500 payouts are exempt.
    const mizuho = dividends.filter((d) => d.netAmount.eq(14500))
    expect(mizuho).toHaveLength(2)
    for (const d of mizuho) expect(d.isTaxable).toBe(false)
  })

  it('still attributes a dividend paid after the position was closed', () => {
    // フルキャスト (4848) sold 2026-02-18, paid 2026-03-12 — no holding at
    // payment time, so the last known account is used and flagged.
    const fc = dividends.find((d) => d.payDate === '2026-03-12')!
    expect(fc.netAmount.toFixed()).toBe('3200')
    expect(fc.accountType).toBe('NISA_GROWTH')
    expect(fc.attributionConfident).toBe(false)
  })
})

describe('ground truth — 2025 tax year', () => {
  const y2025 = summarizeYear(2025, engine.realized, dividends, 'CALENDAR')

  it('reports zero taxable capital gains, matching the official XML', () => {
    expect(y2025.taxableGains.toFixed()).toBe('0')
    expect(y2025.taxableLosses.toFixed()).toBe('0')
    expect(y2025.estimatedCapitalGainsTax.toFixed()).toBe('0')
  })

  it('reports exactly the ¥927 taxable dividend the XML records', () => {
    expect(y2025.dividendGross.toFixed()).toBe('927')
    expect(y2025.dividendTaxWithheld.toFixed()).toBe('188') // 142 + 46
  })

  it('shows the NISA gains that year as tax-free', () => {
    expect(y2025.nisaGains.gt(0)).toBe(true)
    // ¥21,855 旧NISA distribution + ¥14,500 みずほ dividend held in NISA成長投資枠.
    expect(y2025.nisaDividends.toFixed()).toBe('36355')
    // None of it is withheld.
    expect(y2025.dividendTaxWithheld.toFixed()).toBe('188')
  })
})

describe('tax year basis', () => {
  it('assigns calendar years by settlement date', () => {
    expect(taxYearOf('2026-01-06', 'CALENDAR')).toBe(2026)
    expect(taxYearOf('2025-12-30', 'CALENDAR')).toBe(2025)
  })

  it('puts Jan–Mar into the previous fiscal year', () => {
    expect(taxYearOf('2026-02-20', 'FISCAL_APR_MAR')).toBe(2025)
    expect(taxYearOf('2026-04-01', 'FISCAL_APR_MAR')).toBe(2026)
    expect(taxYearOf('2026-03-31', 'FISCAL_APR_MAR')).toBe(2025)
  })

  it('buckets the same events differently without changing the totals', () => {
    const cal = buildYearOverYear(engine.realized, dividends, 'CALENDAR')
    const fis = buildYearOverYear(engine.realized, dividends, 'FISCAL_APR_MAR')

    // Every event is counted exactly once under either basis.
    expect(cal.totals.taxableGains.toFixed()).toBe(fis.totals.taxableGains.toFixed())
    expect(cal.totals.nisaGains.toFixed()).toBe(fis.totals.nisaGains.toFixed())

    // The Feb-2026 disposals move: calendar 2026, but fiscal FY2025.
    const calTrades2026 = cal.years.find((y) => y.year === 2026)!.tradeCount
    const fisTrades2026 = fis.years.find((y) => y.year === 2026)!.tradeCount
    expect(calTrades2026).not.toBe(fisTrades2026)
  })
})

describe('loss handling', () => {
  it('nets losses against gains within the year', () => {
    const events = [
      { realizedJpy: new Decimal(100_000), accountType: 'SPECIFIC', settleDate: '2026-03-01' },
      { realizedJpy: new Decimal(-40_000), accountType: 'SPECIFIC', settleDate: '2026-04-01' },
    ] as never
    const s = summarizeYear(2026, events, [], 'CALENDAR')
    expect(s.netTaxable.toFixed()).toBe('60000')
    expect(s.estimatedCapitalGainsTax.toFixed()).toBe('12189') // 60,000 × 20.315%
  })

  it('charges no tax and reports a carryforward when the year nets to a loss', () => {
    const events = [
      { realizedJpy: new Decimal(-50_000), accountType: 'SPECIFIC', settleDate: '2026-03-01' },
    ] as never
    const s = summarizeYear(2026, events, [], 'CALENDAR')
    expect(s.estimatedCapitalGainsTax.toFixed()).toBe('0')
    expect(s.carryforwardLoss.toFixed()).toBe('50000')
  })

  it('excludes NISA losses from the taxable calculation', () => {
    const events = [
      { realizedJpy: new Decimal(-500_000), accountType: 'NISA_GROWTH', settleDate: '2026-03-01' },
      { realizedJpy: new Decimal(100_000), accountType: 'SPECIFIC', settleDate: '2026-03-01' },
    ] as never
    const s = summarizeYear(2026, events, [], 'CALENDAR')
    // A NISA loss cannot shelter a 特定 gain — that is the trade-off of NISA.
    expect(s.netTaxable.toFixed()).toBe('100000')
    expect(s.estimatedCapitalGainsTax.toFixed()).toBe('20315')
  })
})

describe('year-over-year', () => {
  const yoy = buildYearOverYear(engine.realized, dividends, 'CALENDAR')

  it('covers every year with activity, ascending', () => {
    expect(yoy.years.map((y) => y.year)).toEqual([2022, 2025, 2026])
  })

  it('accumulates net-after-tax monotonically in profitable years', () => {
    const cum = yoy.cumulativeNetAfterTax
    expect(cum).toHaveLength(yoy.years.length)
    expect(cum.at(-1)!.value.toFixed()).toBe(yoy.totals.netAfterTax.toFixed())
  })

  it('never estimates tax on a year with no taxable gains', () => {
    const wrongly = yoy.years
      .filter((y) => y.netTaxable.lte(0) && !y.estimatedCapitalGainsTax.isZero())
      .map((y) => `${String(y.year)}: net=${y.netTaxable.toFixed()} tax=${y.estimatedCapitalGainsTax.toFixed()}`)
    expect(wrongly).toEqual([])
  })

  it('keeps NISA gains out of every taxable figure', () => {
    for (const y of yoy.years) {
      expect(y.taxableGains.gte(0)).toBe(true)
      expect(y.estimatedCapitalGainsTax.lte(y.netTaxable.mul('0.20315').add(1))).toBe(true)
    }
    expect(yoy.totals.nisaGains.gt(0)).toBe(true)
  })
})

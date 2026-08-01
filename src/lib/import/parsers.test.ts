/**
 * Parser tests against the real Rakuten exports.
 *
 * Assertions are anchored to figures verified independently — by hand against
 * the raw CSVs, and against the official 特定口座年間取引報告書 — rather than to
 * whatever the code currently produces.
 */
import { basename } from 'node:path'
import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import {
  loadAllStatements,
  loadAllTrades,
  readShiftJisFile,
  torizanFiles,
  tradeHistoryFiles,
} from './loadFixtures'
import { detectFormat } from './tradeHistory'
import { parseAccountType, parseDate, parseNum, parsePointsUsed, toHalfWidth } from './util'

describe('primitives', () => {
  it('parses comma-grouped and full-width numbers', () => {
    expect(parseNum('1,234,567')?.toFixed()).toBe('1234567')
    expect(parseNum('32,760.0')?.toFixed()).toBe('32760')
    expect(parseNum('１２３')?.toFixed()).toBe('123')
    expect(parseNum('▲500')?.toFixed()).toBe('-500')
  })

  it('reads only the settled amount when Rakuten points were used', () => {
    // Regression: 受渡金額 encodes point usage as `1,000,000(2,251)` — ¥1,000,000
    // settled, ¥2,251 of it paid with points. Stripping punctuation and
    // concatenating digits yields ¥10,000,002,251, which inflated the 純金ファンド
    // cost basis to ¥10.8bn.
    expect(parseNum('1,000,000(2,251)')?.toFixed()).toBe('1000000')
    expect(parseNum('861,259(160)')?.toFixed()).toBe('861259')
    expect(parsePointsUsed('1,000,000(2,251)')?.toFixed()).toBe('2251')
    expect(parsePointsUsed('861,259(160)')?.toFixed()).toBe('160')
    // No parentheses → no points.
    expect(parsePointsUsed('1,500,000')).toBeNull()
  })

  it('treats Rakuten blank markers as null, not zero', () => {
    // Critical: "-" means "not yet settled", which is different from ¥0.
    expect(parseNum('-')).toBeNull()
    expect(parseNum('')).toBeNull()
    expect(parseNum('　')).toBeNull()
  })

  it('normalizes the several date formats across exports', () => {
    expect(parseDate('2026/7/29')).toBe('2026-07-29')
    expect(parseDate('2026.07.22')).toBe('2026-07-22')
    expect(parseDate('2026/07/29')).toBe('2026-07-29')
    expect(parseDate('-')).toBeNull()
  })

  it('maps every account label variant across formats', () => {
    expect(parseAccountType('特定')).toBe('SPECIFIC')
    expect(parseAccountType('旧NISA')).toBe('NISA_OLD')
    expect(parseAccountType('NISA成長投資枠')).toBe('NISA_GROWTH')
    expect(parseAccountType('NISAつみたて投資枠')).toBe('NISA_TSUMITATE')
    // Abbreviated forms used by the monthly statement.
    expect(parseAccountType('Ｎ成長')).toBe('NISA_GROWTH')
    expect(parseAccountType('Ｎ積立')).toBe('NISA_TSUMITATE')
  })

  it('folds full-width tickers to match across files', () => {
    expect(toHalfWidth('ＡＡＰＬ')).toBe('AAPL')
    expect(toHalfWidth('８４１１')).toBe('8411')
  })
})

describe('format detection', () => {
  it('identifies each export type from its header', () => {
    // Built as a map so a failure shows every file at once, and so the
    // assertion runs unconditionally.
    const detected = Object.fromEntries(
      tradeHistoryFiles().map((p) => {
        const name = basename(p)
        const kind = name.includes('(JP)') ? 'JP' : name.includes('(US)') ? 'US' : 'INVST'
        return [kind, detectFormat(readShiftJisFile(p))]
      }),
    )
    expect(detected).toEqual({ JP: 'JP', US: 'US', INVST: 'INVST' })

    const statements = torizanFiles().map((p) => detectFormat(readShiftJisFile(p)))
    expect(new Set(statements)).toEqual(new Set(['TORIZAN']))
  })
})

describe('trade history', () => {
  const result = loadAllTrades()

  it('parses every row without errors', () => {
    expect(result.errors).toEqual([])
    expect(result.trades.length).toBe(315)
  })

  it('covers the full date range', () => {
    const dates = result.trades.map((t) => t.tradeDate).sort()
    expect(dates[0]).toBe('2022-06-01')
    expect(dates.at(-1)).toBe('2026-07-29')
  })

  it('derives amounts for unsettled rows instead of dropping them', () => {
    // 6 JP rows dated 2026-07-29 had 受渡金額 = "-" at export time.
    const unsettled = result.trades.filter((t) => !t.isSettled)
    expect(unsettled.length).toBe(6)
    for (const t of unsettled) {
      expect(t.netAmountJpy.isZero()).toBe(false)
      expect(t.netAmountJpy.isFinite()).toBe(true)
    }
  })

  it('applies fee direction correctly for JP trades', () => {
    // buy pays fees on top; sell nets them off.
    const jp = result.trades.filter((t) => t.assetClass === 'JP_EQUITY' && t.isSettled)
    for (const t of jp) {
      const costs = t.fee.add(t.feeTax).add(t.otherCost)
      const expected =
        t.side === 'BUY' ? t.grossAmount.add(costs) : t.grossAmount.sub(costs)
      expect(t.netAmount.toFixed()).toBe(expected.toFixed())
    }
    expect(jp.length).toBeGreaterThan(60)
  })

  it('converts fund unit prices from the per-10,000-口 basis', () => {
    // 96,016 口 @ 20,830 → ¥200,000 (verified by hand against the raw CSV).
    const t = result.trades.find(
      (x) => x.assetClass === 'FUND' && x.quantity.eq(96016) && x.tradeDate === '2022-06-01',
    )
    expect(t).toBeDefined()
    expect(t!.unitPrice.toFixed(4)).toBe('2.0830')
    expect(t!.grossAmount.toNumber()).toBeCloseTo(200_001, 0)
    expect(t!.netAmountJpy.toFixed()).toBe('200000')
  })

  it('treats fund reinvestments as cost-basis-bearing buys', () => {
    const reinvests = result.trades.filter((t) => t.side === 'REINVEST')
    expect(reinvests.length).toBe(10)
    for (const t of reinvests) {
      // Real acquisition cost even though no external cash moved.
      expect(t.netAmountJpy.gt(0)).toBe(true)
      expect(t.quantity.gt(0)).toBe(true)
    }
  })

  it('keeps point-funded purchases at their true cost basis', () => {
    // The two 純金ファンド buys that used points. Basis must be the full settled
    // amount — points are a payment method, not a discount.
    const pointTrades = result.trades.filter((t) => t.pointsUsed)
    expect(pointTrades).toHaveLength(2)

    const feb = pointTrades.find((t) => t.tradeDate === '2026-02-02')!
    expect(feb.netAmountJpy.toFixed()).toBe('1000000')
    expect(feb.pointsUsed!.toFixed()).toBe('2251')

    const mar = pointTrades.find((t) => t.tradeDate === '2026-03-05')!
    expect(mar.netAmountJpy.toFixed()).toBe('861259')
    expect(mar.pointsUsed!.toFixed()).toBe('160')
  })

  it('expresses every JPY amount in whole yen', () => {
    // The yen has no subunit. A fractional amount here means an FX conversion
    // escaped rounding, which pushed 2026 NISA growth usage 0.238 yen over its
    // legal cap before this was enforced.
    for (const t of result.trades) {
      expect(t.netAmountJpy.mod(1).isZero()).toBe(true)
    }
  })

  it('has no trade with an implausible amount', () => {
    // Catches any future parsing corruption of the same shape.
    for (const t of result.trades) {
      expect(t.netAmountJpy.abs().lt(50_000_000)).toBe(true)
    }
  })

  it('converts US trades to JPY at the row FX rate', () => {
    const us = result.trades.filter((t) => t.assetClass === 'US_EQUITY')
    expect(us.length).toBeGreaterThan(80)
    for (const t of us) {
      expect(t.fxRate.gt(100)).toBe(true) // USD/JPY sanity
      expect(t.fxRate.lt(200)).toBe(true)
      expect(t.currency).toBe('USD')
      expect(t.netAmountJpy.gt(0)).toBe(true)
    }
  })

  it('handles both JPY- and USD-settled US trades', () => {
    const us = result.trades.filter((t) => t.assetClass === 'US_EQUITY')
    // Both settlement currencies appear; neither branch may be dead.
    const ratios = us.map((t) => t.netAmountJpy.div(t.netAmount).toNumber())
    expect(Math.min(...ratios)).toBeGreaterThan(100)
    expect(Math.max(...ratios)).toBeLessThan(200)
  })

  it('assigns every trade to a known account type', () => {
    const accounts = new Set(result.trades.map((t) => t.accountType))
    expect([...accounts].sort()).toEqual([
      'NISA_GROWTH',
      'NISA_OLD',
      'NISA_TSUMITATE',
      'SPECIFIC',
    ])
  })

  it('is idempotent — re-parsing the same files yields no new rows', () => {
    const again = loadAllTrades()
    const a = new Set(result.trades.map((t) => t.sourceRowHash))
    const b = new Set(again.trades.map((t) => t.sourceRowHash))
    expect(b.size).toBe(a.size)
    // Hashes must be stable across runs, not merely unique within one.
    for (const h of b) expect(a.has(h)).toBe(true)
  })
})

describe('monthly statements', () => {
  const result = loadAllStatements()

  it('extracts every dividend and distribution', () => {
    // 6 payouts totalling ¥60,119, verified by hand across the 11 statements.
    expect(result.dividends.length).toBe(6)
    const total = result.dividends.reduce((a, d) => a.add(d.netAmount), new Decimal(0))
    expect(total.toFixed()).toBe('60119')
  })

  it('distinguishes equity dividends from fund distributions', () => {
    const divs = result.dividends.filter((d) => d.kind === 'DIVIDEND')
    const dists = result.dividends.filter((d) => d.kind === 'DISTRIBUTION')
    expect(divs.length).toBe(4)
    expect(dists.length).toBe(2)
  })

  it('finds the ¥739 distribution that the official tax XML reports', () => {
    // ¥927 gross − ¥142 income − ¥46 local = ¥739 net.
    const d = result.dividends.find((x) => x.netAmount.eq(739))
    expect(d).toBeDefined()
    expect(d!.payDate).toBe('2025-12-05')
    expect(d!.kind).toBe('DISTRIBUTION')
  })

  it('captures month-end position snapshots across all statements', () => {
    expect(result.snapshots.length).toBeGreaterThan(100)
    // 10 monthly statements: 2025-09 through 2026-06.
    const months = new Set(result.snapshots.map((s) => s.asOf))
    expect(months.size).toBe(10)
    expect([...months].sort()[0]).toBe('2025-09-30')
    expect([...months].sort().at(-1)).toBe('2026-06-30')
    for (const s of result.snapshots) {
      expect(s.quantity.gt(0)).toBe(true)
      expect(s.valuationJpy.gt(0)).toBe(true)
    }
  })

  it('reads the cash ledger', () => {
    expect(result.cashMovements.length).toBeGreaterThan(50)
  })

  it('parses statements without errors', () => {
    expect(result.errors).toEqual([])
  })
})

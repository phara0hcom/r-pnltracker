/**
 * Positions totals, summed on the server from the rows' own strings.
 */
import { describe, expect, it } from 'vitest'
import { summarizePositions, type SummaryInput } from './positionSummary'

const row = (overrides: Partial<SummaryInput>): SummaryInput => ({
  symbol: '7203',
  name: 'トヨタ自動車',
  assetClass: 'JP_EQUITY',
  accountType: 'SPECIFIC',
  costShownJpy: '100000',
  marketValueJpy: '110000',
  unrealizedJpy: '10000',
  unrealizedPct: 0.1,
  ...overrides,
})

const BOOK = [
  row({ symbol: 'ACWI', assetClass: 'FUND', accountType: 'NISA_TSUMITATE', costShownJpy: '1649962', marketValueJpy: '2116444', unrealizedJpy: '466482', unrealizedPct: 0.2827 }),
  row({ symbol: '8306', accountType: 'NISA_GROWTH', costShownJpy: '781200', marketValueJpy: '1228800', unrealizedJpy: '447600', unrealizedPct: 0.573 }),
  row({ symbol: '9433', costShownJpy: '270886', marketValueJpy: '256100', unrealizedJpy: '-14786', unrealizedPct: -0.0546 }),
  row({ symbol: 'COST', assetClass: 'US_EQUITY', costShownJpy: '421097', marketValueJpy: '421614', unrealizedJpy: '517', unrealizedPct: 0.0012 }),
  row({ symbol: '4755', costShownJpy: '474000', marketValueJpy: null, unrealizedJpy: null, unrealizedPct: null }),
]

describe('summarizePositions', () => {
  it('totals the book, leaving an unpriced holding out of all but cost', () => {
    const { total } = summarizePositions(BOOK)
    expect(total.count).toBe(5)
    expect(total.unpriced).toBe(1)
    expect(total.costShownJpy).toBe('3597145')
    expect(total.unpricedCostJpy).toBe('474000')
    expect(total.marketValueJpy).toBe('4022958')
    expect(total.unrealizedJpy).toBe('899813')
    // Over the priced cost (3,123,145), not the whole of it.
    expect(total.unrealizedPct).toBeCloseTo(899813 / 3123145, 10)
    expect(total.weight).toBe(1)
  })

  it('gives each account its own totals, largest first', () => {
    const { accounts } = summarizePositions(BOOK)
    expect(accounts.map((account) => account.accountType)).toEqual(['NISA_TSUMITATE', 'NISA_GROWTH', 'SPECIFIC'])
    const specific = accounts.find((account) => account.accountType === 'SPECIFIC')
    expect(specific?.count).toBe(3)
    expect(specific?.unpriced).toBe(1)
    expect(specific?.marketValueJpy).toBe('677714')
    expect(specific?.unrealizedJpy).toBe('-14269')
    expect(specific?.unrealizedPct).toBeCloseTo(-14269 / 691983, 10)
    expect(specific?.weight).toBeCloseTo(677714 / 4022958, 10)
  })

  it('splits value by asset class and weighs every row', () => {
    const { classes, weights } = summarizePositions(BOOK)
    expect(classes.map((entry) => [entry.assetClass, entry.marketValueJpy])).toEqual([
      ['FUND', '2116444'],
      ['JP_EQUITY', '1484900'],
      ['US_EQUITY', '421614'],
    ])
    expect(weights[0]).toBeCloseTo(2116444 / 4022958, 10)
    expect(weights[4]).toBeNull()
  })

  it('names the largest, best and weakest holdings among the priced', () => {
    const { highlights } = summarizePositions(BOOK)
    expect(highlights.largest?.symbol).toBe('ACWI')
    expect(highlights.best?.symbol).toBe('8306')
    expect(highlights.weakest?.symbol).toBe('9433')
  })

  it('does not name one holding as both best and weakest', () => {
    const { highlights } = summarizePositions([BOOK[1]!, BOOK[4]!])
    expect(highlights.best?.symbol).toBe('8306')
    expect(highlights.weakest).toBeNull()
  })

  it('copes with nothing priced', () => {
    const { total, classes, highlights } = summarizePositions([BOOK[4]!])
    expect(total.unrealizedPct).toBeNull()
    expect(total.weight).toBeNull()
    expect(classes).toEqual([])
    expect(highlights.largest).toBeNull()
  })
})

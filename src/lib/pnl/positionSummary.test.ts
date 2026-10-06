/**
 * Positions totals, summed on the server from the rows' own strings.
 */
import { describe, expect, it } from 'vitest'
import { inGroup, positionsView, splitFor, summarizePositions, type SummaryInput } from './positionSummary'

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

describe('groups', () => {
  const both = { market: true, account: true }
  const shape = (groups: ReturnType<typeof summarizePositions>['groups']) =>
    groups.map((group) => [group.market, group.accountType, group.count])

  /*
   * A US holding in NISA too, so no block is only ever one thing — and a small
   * one, so the orders disagree: across the book NISA 成長 (¥1,528,800) outranks
   * 特定 (¥677,714), but within US 特定's COST (¥421,614) outranks VOO. Which one
   * the US blocks follow is then visible.
   */
  const MIXED = [
    ...BOOK,
    row({ symbol: 'VOO', assetClass: 'US_EQUITY', accountType: 'NISA_GROWTH', costShownJpy: '250000', marketValueJpy: '300000', unrealizedJpy: '50000', unrealizedPct: 0.2 }),
  ]

  it('cuts by market then account, JP first and accounts in the book-wide order under each', () => {
    const { groups } = summarizePositions(MIXED, both)
    expect(shape(groups)).toEqual([
      ['JP', 'NISA_TSUMITATE', 1],
      ['JP', 'NISA_GROWTH', 1],
      ['JP', 'SPECIFIC', 2],
      // Not re-ranked within US, where 特定 holds more.
      ['US', 'NISA_GROWTH', 1],
      ['US', 'SPECIFIC', 1],
    ])
  })

  it('leaves out blocks that hold nothing', () => {
    const jpOnly = BOOK.filter((entry) => entry.assetClass !== 'US_EQUITY')
    expect(shape(summarizePositions(jpOnly, both).groups)).toEqual([
      ['JP', 'NISA_TSUMITATE', 1],
      ['JP', 'NISA_GROWTH', 1],
      ['JP', 'SPECIFIC', 2],
    ])
  })

  it('cuts by market alone when the account is not split', () => {
    const { groups } = summarizePositions(MIXED, { market: true, account: false })
    expect(shape(groups)).toEqual([
      ['JP', null, 4],
      ['US', null, 2],
    ])
  })

  it('reuses the account totals when the market is not split — the default', () => {
    const { groups, accounts } = summarizePositions(MIXED)
    expect(groups).toEqual(accounts.map((account) => ({ ...account, market: null })))
  })

  it('is one block, the whole book, when neither axis is split', () => {
    const { groups, total } = summarizePositions(MIXED, { market: false, account: false })
    expect(groups).toEqual([{ ...total, market: null, accountType: null }])
  })

  it('has no blocks for an empty book', () => {
    for (const split of [both, { market: false, account: false }, { market: false, account: true }]) {
      expect(summarizePositions([], split).groups).toEqual([])
    }
  })

  it('totals a block from its own rows, but weighs it against the whole book', () => {
    const { groups, total } = summarizePositions(MIXED, both)
    const usSpecific = groups.find((group) => group.market === 'US' && group.accountType === 'SPECIFIC')
    expect(usSpecific?.marketValueJpy).toBe('421614')
    expect(usSpecific?.unrealizedJpy).toBe('517')
    expect(usSpecific?.weight).toBeCloseTo(421614 / Number(total.marketValueJpy), 10)
  })

  it('adds up: the blocks together are the whole book', () => {
    const { groups, total } = summarizePositions(MIXED, both)
    const sum = (pick: (group: (typeof groups)[number]) => string) =>
      groups.reduce((running, group) => running + Number(pick(group)), 0)
    expect(sum((group) => group.marketValueJpy)).toBe(Number(total.marketValueJpy))
    expect(sum((group) => group.costShownJpy)).toBe(Number(total.costShownJpy))
    expect(groups.reduce((running, group) => running + group.count, 0)).toBe(total.count)
  })
})

describe('splitFor', () => {
  const jp = { assetClass: 'JP_EQUITY' } as const
  const fund = { assetClass: 'FUND' } as const
  const us = { assetClass: 'US_EQUITY' } as const

  it('splits on account unless the switch is on 特定', () => {
    expect(splitFor([jp, us], { account: 'ALL', market: 'ALL' }).account).toBe(true)
    expect(splitFor([jp, us], { account: 'NISA', market: 'ALL' }).account).toBe(true)
    expect(splitFor([jp, us], { account: 'SPECIFIC', market: 'ALL' }).account).toBe(false)
  })

  it('splits on market only when the switch is on both and both are held', () => {
    expect(splitFor([jp, us], { account: 'ALL', market: 'ALL' }).market).toBe(true)
    // Stocks and funds are one market, so this is a JP-only book.
    expect(splitFor([jp, fund], { account: 'ALL', market: 'ALL' }).market).toBe(false)
    expect(splitFor([us], { account: 'ALL', market: 'ALL' }).market).toBe(false)
    expect(splitFor([], { account: 'ALL', market: 'ALL' }).market).toBe(false)
    expect(splitFor([jp], { account: 'ALL', market: 'JP' }).market).toBe(false)
  })
})

describe('inGroup', () => {
  const us = { assetClass: 'US_EQUITY', accountType: 'NISA_GROWTH' } as const
  const fund = { assetClass: 'FUND', accountType: 'SPECIFIC' } as const

  it('matches on whichever sides the block names', () => {
    expect(inGroup(us, { market: 'US', accountType: 'NISA_GROWTH' })).toBe(true)
    expect(inGroup(us, { market: 'JP', accountType: 'NISA_GROWTH' })).toBe(false)
    expect(inGroup(us, { market: 'US', accountType: 'SPECIFIC' })).toBe(false)
    expect(inGroup(us, { market: 'US', accountType: null })).toBe(true)
    expect(inGroup(us, { market: null, accountType: 'NISA_GROWTH' })).toBe(true)
    expect(inGroup(us, { market: null, accountType: null })).toBe(true)
  })

  it('files a fund under JP', () => {
    expect(inGroup(fund, { market: 'JP', accountType: null })).toBe(true)
    expect(inGroup(fund, { market: 'US', accountType: null })).toBe(false)
  })
})

describe('positionsView', () => {
  it('weighs each row in place and cuts the blocks by what the filters left', () => {
    const jpOnly = BOOK.filter((entry) => entry.assetClass !== 'US_EQUITY')
    const view = positionsView(jpOnly, { account: 'ALL', market: 'ALL' })
    expect(view.rows.map((entry) => entry.symbol)).toEqual(jpOnly.map((entry) => entry.symbol))
    expect(view.rows.map((entry) => entry.weight)).toEqual(summarizePositions(jpOnly).weights)
    // One market held, so no market blocks, though the switch is on both.
    expect(view.groups.map((group) => [group.market, group.accountType])).toEqual([
      [null, 'NISA_TSUMITATE'],
      [null, 'NISA_GROWTH'],
      [null, 'SPECIFIC'],
    ])
    expect(view).not.toHaveProperty('weights')
  })

  it('splits by market when both are held and the switch is on both', () => {
    const view = positionsView(BOOK, { account: 'SPECIFIC', market: 'ALL' })
    expect(view.groups.map((group) => [group.market, group.accountType])).toEqual([
      ['JP', null],
      ['US', null],
    ])
  })
})

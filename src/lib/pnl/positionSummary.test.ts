/**
 * Positions totals, summed on the server from the rows' own strings.
 */
import { describe, expect, it } from 'vitest'
import { inGroup, inMarket, positionsView, splitFor, summarizePositions, type SummaryInput } from './positionSummary'

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
  /** Each block as its account and count, then each market inside it. */
  const shape = (groups: ReturnType<typeof summarizePositions>['groups']) =>
    groups.map((group) => [group.accountType, group.count, group.markets.map((m) => [m.market, m.count])])

  /*
   * A US holding in NISA too, so an account holds both markets. Across the book
   * NISA 成長 (¥1,528,800) outranks 特定 (¥677,714) — and that is the order the
   * accounts take, each keeping its markets together beneath it.
   */
  const MIXED = [
    ...BOOK,
    row({ symbol: 'VOO', assetClass: 'US_EQUITY', accountType: 'NISA_GROWTH', costShownJpy: '250000', marketValueJpy: '300000', unrealizedJpy: '50000', unrealizedPct: 0.2 }),
  ]

  it('keeps each account together, its JP and US holdings beneath it', () => {
    const { groups } = summarizePositions(MIXED, both)
    expect(shape(groups)).toEqual([
      ['NISA_TSUMITATE', 1, [['JP', 1]]],
      ['NISA_GROWTH', 2, [['JP', 1], ['US', 1]]],
      ['SPECIFIC', 3, [['JP', 2], ['US', 1]]],
    ])
  })

  it('gives an account only the markets it holds', () => {
    const { groups } = summarizePositions(MIXED, both)
    expect(groups.find((group) => group.accountType === 'NISA_TSUMITATE')?.markets.map((m) => m.market)).toEqual(['JP'])
  })

  it('keeps the account totals on the block, and sums each market inside it', () => {
    const { groups, accounts } = summarizePositions(MIXED, both)
    const specific = groups.find((group) => group.accountType === 'SPECIFIC')
    const { markets, ...head } = specific!
    expect(head).toEqual(accounts.find((account) => account.accountType === 'SPECIFIC'))
    const us = markets.find((m) => m.market === 'US')
    expect(us?.marketValueJpy).toBe('421614')
    expect(us?.unrealizedJpy).toBe('517')
    // 9433 priced, 4755 not: the unpriced cost stays with its market.
    const jp = markets.find((m) => m.market === 'JP')
    expect(jp?.unpriced).toBe(1)
    expect(jp?.unpricedCostJpy).toBe('474000')
  })

  it('weighs a market against the whole book, not its account', () => {
    const { groups, total } = summarizePositions(MIXED, both)
    const us = groups.find((group) => group.accountType === 'SPECIFIC')?.markets.find((m) => m.market === 'US')
    expect(us?.weight).toBeCloseTo(421614 / Number(total.marketValueJpy), 10)
  })

  it('adds up: each account’s markets are the account, and the accounts the book', () => {
    const { groups, total } = summarizePositions(MIXED, both)
    for (const group of groups) {
      const sum = (pick: (m: (typeof group.markets)[number]) => string) =>
        group.markets.reduce((running, m) => running + Number(pick(m)), 0)
      expect(sum((m) => m.marketValueJpy)).toBe(Number(group.marketValueJpy))
      expect(sum((m) => m.costShownJpy)).toBe(Number(group.costShownJpy))
      expect(group.markets.reduce((running, m) => running + m.count, 0)).toBe(group.count)
    }
    expect(groups.reduce((running, group) => running + group.count, 0)).toBe(total.count)
  })

  it('is one block, the book, with its markets, when the account is not split', () => {
    const { groups, total } = summarizePositions(MIXED, { market: true, account: false })
    expect(shape(groups)).toEqual([[null, 6, [['JP', 4], ['US', 2]]]])
    const { markets, ...head } = groups[0]!
    expect(head).toEqual({ ...total, accountType: null })
    expect(markets).toHaveLength(2)
  })

  it('is the accounts alone when the market is not split — the default', () => {
    const { groups, accounts } = summarizePositions(MIXED)
    expect(groups).toEqual(accounts.map((account) => ({ ...account, markets: [] })))
  })

  it('is one block, the whole book, when neither axis is split', () => {
    const { groups, total } = summarizePositions(MIXED, { market: false, account: false })
    expect(groups).toEqual([{ ...total, accountType: null, markets: [] }])
  })

  it('has no blocks for an empty book', () => {
    for (const split of [both, { market: false, account: false }, { market: false, account: true }]) {
      expect(summarizePositions([], split).groups).toEqual([])
    }
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

describe('inGroup and inMarket', () => {
  const us = { assetClass: 'US_EQUITY', accountType: 'NISA_GROWTH' } as const
  const fund = { assetClass: 'FUND', accountType: 'SPECIFIC' } as const

  it('matches a block by its account, or any row when it names none', () => {
    expect(inGroup(us, { accountType: 'NISA_GROWTH' })).toBe(true)
    expect(inGroup(us, { accountType: 'SPECIFIC' })).toBe(false)
    expect(inGroup(us, { accountType: null })).toBe(true)
  })

  it('files a fund under JP', () => {
    expect(inMarket(fund, 'JP')).toBe(true)
    expect(inMarket(fund, 'US')).toBe(false)
    expect(inMarket(us, 'US')).toBe(true)
  })
})

describe('positionsView', () => {
  it('weighs each row in place and cuts the blocks by what the filters left', () => {
    const jpOnly = BOOK.filter((entry) => entry.assetClass !== 'US_EQUITY')
    const view = positionsView(jpOnly, { account: 'ALL', market: 'ALL' })
    expect(view.rows.map((entry) => entry.symbol)).toEqual(jpOnly.map((entry) => entry.symbol))
    expect(view.rows.map((entry) => entry.weight)).toEqual(summarizePositions(jpOnly).weights)
    // One market held, so no market parts, though the switch is on both.
    expect(view.groups.map((group) => [group.accountType, group.markets.length])).toEqual([
      ['NISA_TSUMITATE', 0],
      ['NISA_GROWTH', 0],
      ['SPECIFIC', 0],
    ])
    expect(view).not.toHaveProperty('weights')
  })

  it('splits by market when both are held and the switch is on both', () => {
    const view = positionsView(BOOK, { account: 'SPECIFIC', market: 'ALL' })
    expect(view.groups.map((group) => [group.accountType, group.markets.map((m) => m.market)])).toEqual([
      [null, ['JP', 'US']],
    ])
  })
})

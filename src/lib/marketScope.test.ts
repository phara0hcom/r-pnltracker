/**
 * The market switch's parameter, and that Positions keeps it beside `scope`.
 *
 * The easy way to break this is the one `accountScope.test.ts` already guards
 * for `scope`: a zod object strips keys it does not declare, so a search schema
 * that forgets one silently drops it the moment a header is clicked.
 */
import { describe, expect, it } from 'vitest'
import { marketOf, matchesMarketFilter } from './domain/types'
import { marketScopeSchema, positionsInput, toMarketFilter } from './marketScope'
import { positionSearchSchema } from './positionSearch'

describe('toMarketFilter', () => {
  it('accepts the three choices', () => {
    expect(toMarketFilter('ALL')).toBe('ALL')
    expect(toMarketFilter('JP')).toBe('JP')
    expect(toMarketFilter('US')).toBe('US')
  })

  it('falls back to ALL for anything else', () => {
    // Includes the asset-class vocabulary, which is close enough to arrive from a
    // hand-edited URL.
    expect(toMarketFilter('US_EQUITY')).toBe('ALL')
    expect(toMarketFilter('us')).toBe('ALL')
    expect(toMarketFilter(undefined)).toBe('ALL')
    expect(toMarketFilter(7)).toBe('ALL')
  })
})

describe('marketScopeSchema', () => {
  it('keeps a valid market', () => {
    expect(marketScopeSchema.parse({ market: 'US' })).toEqual({ market: 'US' })
  })

  it('drops a bad one to absent, not to ALL', () => {
    // Caught to 'ALL', the value would ride the next `{ ...prev }` navigation
    // into the URL as `?market=ALL` — not the default view's canonical address.
    expect(marketScopeSchema.parse({ market: 'BOGUS' }).market).toBeUndefined()
  })

  it('leaves an absent market absent, so the default view has a clean URL', () => {
    expect(marketScopeSchema.parse({})).toEqual({})
  })
})

describe('positionsInput', () => {
  it('narrows both halves independently', () => {
    expect(positionsInput({ account: 'NISA', market: 'US' })).toEqual({ account: 'NISA', market: 'US' })
    expect(positionsInput({ account: 'SPECIFIC' })).toEqual({ account: 'SPECIFIC', market: 'ALL' })
    expect(positionsInput({ market: 'JP' })).toEqual({ account: 'ALL', market: 'JP' })
  })

  it('degrades anything else to the full view rather than throwing', () => {
    expect(positionsInput({ account: 'NISA_GROWTH', market: 'EU' })).toEqual({ account: 'ALL', market: 'ALL' })
    expect(positionsInput()).toEqual({ account: 'ALL', market: 'ALL' })
  })
})

describe('positionSearchSchema', () => {
  it('carries scope and market together through a sort', () => {
    expect(
      positionSearchSchema.parse({ scope: 'NISA', market: 'US', sortBy: 'unrealizedPct', sortDir: 'asc' }),
    ).toEqual({ scope: 'NISA', market: 'US', sortBy: 'unrealizedPct', sortDir: 'asc' })
  })

  it('defaults both filters out of the URL and the sort to value, descending', () => {
    expect(positionSearchSchema.parse({})).toEqual({ sortBy: 'marketValueJpy', sortDir: 'desc' })
  })

  it('keeps a bad market out of the search a sort spreads back into the URL', () => {
    const parsed = positionSearchSchema.parse({ market: 'EU', sortBy: 'symbol' })
    expect(parsed.market).toBeUndefined()
    expect(parsed.sortBy).toBe('symbol')
  })
})

describe('matchesMarketFilter', () => {
  it('files funds under JP, as the yen account does', () => {
    expect(marketOf('JP_EQUITY')).toBe('JP')
    expect(marketOf('FUND')).toBe('JP')
    expect(marketOf('US_EQUITY')).toBe('US')
  })

  it('keeps everything under ALL and one side under JP or US', () => {
    const classes = ['JP_EQUITY', 'FUND', 'US_EQUITY'] as const
    expect(classes.filter((c) => matchesMarketFilter(c, 'ALL'))).toEqual(['JP_EQUITY', 'FUND', 'US_EQUITY'])
    expect(classes.filter((c) => matchesMarketFilter(c, 'JP'))).toEqual(['JP_EQUITY', 'FUND'])
    expect(classes.filter((c) => matchesMarketFilter(c, 'US'))).toEqual(['US_EQUITY'])
  })
})

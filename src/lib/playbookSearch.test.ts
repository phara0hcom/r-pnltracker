import { describe, expect, it } from 'vitest'
import { matchesPlaybookFilters, playbookSearchSchema, setupPageSearchSchema, type PlaybookFilters } from './playbookSearch'

const real = { kind: 'REAL', accountType: 'SPECIFIC', assetClass: 'JP_EQUITY', setupId: 's1', status: 'OPEN' } as const
const paper = { ...real, kind: 'PAPER', accountType: null, assetClass: 'US_EQUITY' } as const
const filters: PlaybookFilters = { account: 'ALL', market: 'ALL', kind: 'REAL' }

describe('matchesPlaybookFilters', () => {
  it('defaults to real positions', () => {
    expect(matchesPlaybookFilters(real, filters)).toBe(true)
    expect(matchesPlaybookFilters(paper, filters)).toBe(false)
  })

  it('filters by account, market, setup and status', () => {
    expect(matchesPlaybookFilters(real, { ...filters, account: 'NISA' })).toBe(false)
    expect(matchesPlaybookFilters(real, { ...filters, market: 'US' })).toBe(false)
    expect(matchesPlaybookFilters(real, { ...filters, setup: 's2' })).toBe(false)
    expect(matchesPlaybookFilters(real, { ...filters, status: 'CLOSED' })).toBe(false)
    expect(matchesPlaybookFilters(real, { ...filters, account: 'SPECIFIC', market: 'JP', setup: 's1', status: 'OPEN' })).toBe(true)
  })

  it('ignores the account switch on the Paper view, where it has nothing to say', () => {
    expect(matchesPlaybookFilters(paper, { ...filters, kind: 'PAPER', account: 'NISA' })).toBe(true)
  })

  it('leaves paper out of a narrowed account on the mixed view', () => {
    expect(matchesPlaybookFilters(paper, { ...filters, kind: 'ALL' })).toBe(true)
    expect(matchesPlaybookFilters(paper, { ...filters, kind: 'ALL', account: 'SPECIFIC' })).toBe(false)
  })
})

describe('playbookSearchSchema', () => {
  it('drops a bad value to absent, so no default is written into the address', () => {
    expect(playbookSearchSchema.parse({ kind: 'NOPE', status: 'NOPE', sortBy: 'NOPE', sortDir: 'up' })).toEqual({})
  })
})

describe('setupPageSearchSchema', () => {
  it('keeps the account and market scopes, which a zod object would otherwise strip', () => {
    expect(setupPageSearchSchema.parse({ scope: 'NISA', rank: 'R' })).toMatchObject({ scope: 'NISA', rank: 'R' })
  })

  it('reads anything it does not know as absent', () => {
    const parsed = setupPageSearchSchema.parse({ rank: 'LUCK', kind: 'ALL', sortBy: 'nope' })
    expect(parsed.rank).toBeUndefined()
    expect(parsed.kind).toBeUndefined()
    expect(parsed.sortBy).toBeUndefined()
  })
})

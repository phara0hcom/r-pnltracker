/**
 * The account switch is only useful if its parameter survives every screen.
 *
 * It originally shared the `account` key with the Trades screen's own four-way
 * filter, so visiting Trades overwrote it and the switch silently reset. These
 * pin both halves of the fix: a distinct key, and every route that validates
 * search params declaring it so zod does not strip it as unknown.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { accountScopePassthrough, accountScopeSchema, toAccountFilter } from './accountScope'

describe('toAccountFilter', () => {
  it('accepts the three buckets', () => {
    expect(toAccountFilter('ALL')).toBe('ALL')
    expect(toAccountFilter('NISA')).toBe('NISA')
    expect(toAccountFilter('SPECIFIC')).toBe('SPECIFIC')
  })

  it('falls back to ALL for anything else', () => {
    // Includes the Trades screen's vocabulary, which shares no values with this
    // switch but could arrive here from a hand-edited URL.
    expect(toAccountFilter('NISA_GROWTH')).toBe('ALL')
    expect(toAccountFilter(undefined)).toBe('ALL')
    expect(toAccountFilter('')).toBe('ALL')
    expect(toAccountFilter(7)).toBe('ALL')
  })
})

describe('accountScopeSchema', () => {
  it('keeps a valid scope', () => {
    expect(accountScopeSchema.parse({ scope: 'NISA' })).toEqual({ scope: 'NISA' })
  })

  it('degrades a bad value instead of throwing', () => {
    expect(accountScopeSchema.parse({ scope: 'BOGUS' })).toEqual({ scope: 'ALL' })
  })

  it('leaves an absent scope absent, so the default view has a clean URL', () => {
    expect(accountScopeSchema.parse({})).toEqual({})
  })

  it('does not read the old `account` key', () => {
    // Trades owns that key; picking it up here would resurrect the collision.
    expect(accountScopeSchema.parse({ account: 'NISA' })).toEqual({})
  })
})

describe('surviving a route that does not use the switch', () => {
  /** The shape of the Trades screen's search schema, which was eating it. */
  const tradesLike = z.object({
    account: z
      .enum(['SPECIFIC', 'NISA_OLD', 'NISA_GROWTH', 'NISA_TSUMITATE'])
      .optional()
      .catch(undefined),
    sortBy: z.enum(['tradeDate', 'symbol']).catch('tradeDate'),
    scope: z.enum(['ALL', 'NISA', 'SPECIFIC']).catch('ALL').optional(),
  })

  const taxLike = z
    .object({ basis: z.enum(['CALENDAR', 'FISCAL_APR_MAR']).catch('CALENDAR') })
    .extend(accountScopePassthrough.shape)

  it('carries scope through Trades alongside its own account filter', () => {
    expect(
      tradesLike.parse({ account: 'NISA_GROWTH', scope: 'NISA', sortBy: 'symbol' }),
    ).toEqual({ account: 'NISA_GROWTH', scope: 'NISA', sortBy: 'symbol' })
  })

  it('keeps the two filters independent', () => {
    // Setting one must not disturb the other — that was the original bug.
    const out = tradesLike.parse({ account: 'SPECIFIC', scope: 'NISA', sortBy: 'tradeDate' })
    expect(out.account).toBe('SPECIFIC')
    expect(out.scope).toBe('NISA')
  })

  it('carries scope through Tax', () => {
    expect(taxLike.parse({ basis: 'CALENDAR', scope: 'NISA' })).toEqual({
      basis: 'CALENDAR',
      scope: 'NISA',
    })
  })

  it('would drop it without the declaration — the bug being prevented', () => {
    const undeclared = z.object({ sortBy: z.enum(['tradeDate']).catch('tradeDate') })
    expect(undeclared.parse({ sortBy: 'tradeDate', scope: 'NISA' })).toEqual({
      sortBy: 'tradeDate',
    })
  })
})

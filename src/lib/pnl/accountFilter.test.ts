/**
 * The account switch filters trades *before* the engine runs. That is only
 * legitimate because pools are keyed `(symbol × accountType)` — dropping whole
 * accounts must leave the surviving pools bit-identical to a full run.
 *
 * If that ever stops holding, every figure behind the switch is quietly wrong,
 * so it is asserted against the real trade history rather than a fixture.
 */
import { describe, expect, it } from 'vitest'
import { matchesAccountFilter, type AccountFilter } from '../domain/types'
import { loadAllTrades } from '../import/loadFixtures'
import { runEngine } from './engine'

const allTrades = loadAllTrades().trades
const full = runEngine(allTrades)

const forFilter = (f: AccountFilter) =>
  runEngine(allTrades.filter((t) => matchesAccountFilter(t.accountType, f)))

describe('matchesAccountFilter', () => {
  it('treats every NISA frame as NISA, 旧NISA included', () => {
    expect(matchesAccountFilter('NISA_OLD', 'NISA')).toBe(true)
    expect(matchesAccountFilter('NISA_GROWTH', 'NISA')).toBe(true)
    expect(matchesAccountFilter('NISA_TSUMITATE', 'NISA')).toBe(true)
    expect(matchesAccountFilter('SPECIFIC', 'NISA')).toBe(false)
  })

  it('treats only 特定 as the taxable bucket', () => {
    expect(matchesAccountFilter('SPECIFIC', 'SPECIFIC')).toBe(true)
    expect(matchesAccountFilter('NISA_OLD', 'SPECIFIC')).toBe(false)
  })

  it('is exhaustive — NISA and SPECIFIC partition ALL', () => {
    const accounts = [...new Set(allTrades.map((t) => t.accountType))]
    for (const a of accounts) {
      expect(matchesAccountFilter(a, 'ALL')).toBe(true)
      // Exactly one of the two buckets claims each account.
      expect(
        Number(matchesAccountFilter(a, 'NISA')) + Number(matchesAccountFilter(a, 'SPECIFIC')),
      ).toBe(1)
    }
  })
})

describe('filtering before the engine is exact', () => {
  /*
   * Compared as sorted multisets, not by looking each row up.
   *
   * A key of (date, symbol, account, quantity) is not unique: 8053 has two
   * sells of 100 on 2026-07-17 at different prices, so a `find` matches the
   * first and silently compares the wrong pair.
   */
  const positionKeys = (ps: typeof full.positions) =>
    ps
      .map((p) =>
        [
          p.symbol,
          p.accountType,
          p.quantity.toFixed(),
          p.costBasisJpy.toFixed(),
          p.avgPriceNative.toFixed(),
        ].join('|'),
      )
      .sort()

  const realizedKeys = (rs: typeof full.realized) =>
    rs
      .map((e) =>
        [
          e.tradeDate,
          e.symbol,
          e.accountType,
          e.quantity.toFixed(),
          e.realizedJpy.toFixed(),
          e.costJpy.toFixed(),
        ].join('|'),
      )
      .sort()

  it('leaves surviving positions identical to the unfiltered run', () => {
    for (const f of ['NISA', 'SPECIFIC'] as const) {
      expect(positionKeys(forFilter(f).positions)).toEqual(
        positionKeys(full.positions.filter((p) => matchesAccountFilter(p.accountType, f))),
      )
    }
  })

  it('leaves realized events identical to the unfiltered run', () => {
    for (const f of ['NISA', 'SPECIFIC'] as const) {
      expect(realizedKeys(forFilter(f).realized)).toEqual(
        realizedKeys(full.realized.filter((e) => matchesAccountFilter(e.accountType, f))),
      )
    }
  })

  it('partitions the whole history — the two buckets sum back to ALL', () => {
    const nisa = forFilter('NISA')
    const specific = forFilter('SPECIFIC')

    expect(nisa.positions.length + specific.positions.length).toBe(full.positions.length)
    expect(nisa.realized.length + specific.realized.length).toBe(full.realized.length)

    const sum = (rs: typeof full.realized) =>
      rs.reduce((a, r) => a.add(r.realizedJpy), full.realized[0]!.realizedJpy.mul(0))
    expect(sum(nisa.realized).add(sum(specific.realized)).toFixed()).toBe(
      sum(full.realized).toFixed(),
    )
  })

  it('introduces no warnings that the full run did not have', () => {
    // A sell processed against a pool that was filtered away would surface here.
    const nisa = forFilter('NISA')
    const specific = forFilter('SPECIFIC')
    expect(nisa.warnings.length + specific.warnings.length).toBe(full.warnings.length)
  })
})

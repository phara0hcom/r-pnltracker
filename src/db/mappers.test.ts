/**
 * Round-trip tests for the DB boundary.
 *
 * The risk here is silent precision loss: `numeric` arrives from the driver as
 * a string, and any accidental trip through a JS `number` would quietly corrupt
 * fund unit counts and cost basis. These assert exact equality over the real
 * portfolio, not approximate.
 */
import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { loadAllTrades } from '../lib/import/loadFixtures'
import { dec, fromTradeRow, idFor, instrumentId, num, toTradeRow } from './mappers'
import type { DbTrade } from './schema'

const trades = loadAllTrades().trades
const USER = 'user_test'

describe('numeric conversion', () => {
  it('never emits exponential notation', () => {
    // Postgres numeric accepts it, but it defeats string comparison in tests
    // and reads badly in logs.
    expect(num(new Decimal('0.00000001'))).toBe('0.00000001')
    expect(num(new Decimal('1e21'))).toBe('1000000000000000000000')
    expect(num(new Decimal(1_032_403))).toBe('1032403')
  })

  it('treats null as zero, not NaN', () => {
    expect(dec(null).toFixed()).toBe('0')
    expect(dec(undefined).toFixed()).toBe('0')
  })

  it('preserves the precision of a large fund unit count', () => {
    const units = new Decimal('1032403.12345678')
    expect(dec(num(units)).eq(units)).toBe(true)
  })
})

describe('deterministic ids', () => {
  it('produces the same id for the same input', () => {
    expect(idFor('trade', USER, 'abc')).toBe(idFor('trade', USER, 'abc'))
    expect(instrumentId('8411')).toBe(instrumentId('8411'))
  })

  it('separates different inputs', () => {
    expect(idFor('trade', USER, 'abc')).not.toBe(idFor('trade', USER, 'abd'))
    expect(instrumentId('8411')).not.toBe(instrumentId('8412'))
  })

  it('keeps ids stable across re-imports so upserts are true no-ops', () => {
    const a = trades.map((t) => toTradeRow({ userId: USER, trade: t }).id)
    const b = loadAllTrades().trades.map((t) => toTradeRow({ userId: USER, trade: t }).id)
    expect(b).toEqual(a)
    expect(new Set(a).size).toBe(trades.length)
  })
})

describe('trade round-trip', () => {
  it('survives domain → row → domain with exact values', () => {
    const mismatches: string[] = []

    for (const original of trades) {
      const row = toTradeRow({ userId: USER, trade: original })
      // Simulate what the driver returns: every numeric column as a string.
      const back = fromTradeRow(row as unknown as DbTrade, {
        symbol: original.symbol,
        name: original.name,
        assetClass: original.assetClass,
      })

      const checks: [string, Decimal, Decimal][] = [
        ['quantity', original.quantity, back.quantity],
        ['unitPrice', original.unitPrice, back.unitPrice],
        ['fee', original.fee, back.fee],
        ['feeTax', original.feeTax, back.feeTax],
        ['otherCost', original.otherCost, back.otherCost],
        ['fxRate', original.fxRate, back.fxRate],
        ['grossAmount', original.grossAmount, back.grossAmount],
        ['netAmount', original.netAmount, back.netAmount],
        ['netAmountJpy', original.netAmountJpy, back.netAmountJpy],
      ]
      for (const [field, a, b] of checks) {
        if (!a.eq(b)) mismatches.push(`${original.symbol} ${field}: ${a.toFixed()} → ${b.toFixed()}`)
      }
      if (back.tradeDate !== original.tradeDate) mismatches.push(`${original.symbol} tradeDate`)
      if (back.settleDate !== original.settleDate) mismatches.push(`${original.symbol} settleDate`)
      if (back.isSettled !== original.isSettled) mismatches.push(`${original.symbol} isSettled`)
    }

    expect(mismatches).toEqual([])
  })

  it('carries points through without loss', () => {
    const withPoints = trades.filter((t) => t.pointsUsed)
    expect(withPoints).toHaveLength(2)
    for (const t of withPoints) {
      const row = toTradeRow({ userId: USER, trade: t })
      expect(row.pointsUsed).toBe(t.pointsUsed!.toFixed())
    }
  })

  it('leaves points null when none were used', () => {
    const without = trades.find((t) => !t.pointsUsed)!
    expect(toTradeRow({ userId: USER, trade: without }).pointsUsed).toBeNull()
  })

  it('maps every trade to exactly one instrument id per symbol', () => {
    const bySymbol = new Map<string, Set<string>>()
    for (const t of trades) {
      const set = bySymbol.get(t.symbol) ?? new Set()
      set.add(toTradeRow({ userId: USER, trade: t }).instrumentId)
      bySymbol.set(t.symbol, set)
    }
    const ambiguous = [...bySymbol.entries()].filter(([, ids]) => ids.size !== 1)
    expect(ambiguous).toEqual([])
  })
})

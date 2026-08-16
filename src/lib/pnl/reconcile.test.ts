/**
 * Reconciliation against Rakuten's own month-end statements.
 *
 * This is the strongest correctness check available: for each of the 10 monthly
 * 取引残高報告書, the engine is replayed over everything settled up to that date
 * and the resulting positions are compared to what Rakuten actually reported
 * holding. A cost-basis or ordering bug that drifts silently would pass an
 * end-state check but fails here at the month it starts.
 *
 * Positions are compared on a settlement-date basis, which is what a custody
 * balance reflects — a trade executed on the 30th settling on the 2nd is not
 * yet held at month end.
 */
import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { resolveStatementFund } from '../domain/instruments'
import type { AccountType } from '../domain/types'
import { loadAllStatements, loadAllTrades } from '../import/loadFixtures'
import { toHalfWidth } from '../import/util'
import { runEngine } from './engine'

const allTrades = loadAllTrades().trades
const snapshots = loadAllStatements().snapshots

const key = (symbol: string, account: AccountType) => `${symbol}\0${account}`

/**
 * US holdings appear in the balance report by company name, not ticker
 * (`TENABLE HLD`), while the engine keys on ticker. The trade history carries
 * both columns, so this index is derived from the data rather than hardcoded —
 * it stays correct automatically as new tickers are traded.
 */
const usNameToTicker = new Map<string, string>(
  allTrades
    .filter((trade) => trade.assetClass === 'US_EQUITY' && trade.name)
    .map((trade) => [toHalfWidth(trade.name), trade.symbol]),
)

/** Engine positions as of a date, on a settlement basis. */
function positionsAsOf(asOf: string): Map<string, Decimal> {
  const settled = allTrades.filter((trade) => trade.settleDate <= asOf)
  const { positions } = runEngine(settled)
  const m = new Map<string, Decimal>()
  for (const p of positions) m.set(key(p.symbol, p.accountType), p.quantity)
  return m
}

/** Snapshot rows resolved to canonical symbols; unmapped rows reported separately. */
function expectedAsOf(asOf: string): { matched: Map<string, Decimal>; unmapped: string[] } {
  const matched = new Map<string, Decimal>()
  const unmapped: string[] = []
  for (const s of snapshots.filter((item) => item.asOf === asOf)) {
    // JP equity codes are numeric and join directly; funds need the name map.
    const isCode = /^\d{4}$/.test(s.symbol)
    const symbol = isCode
      ? s.symbol
      : (resolveStatementFund(s.symbol) ?? usNameToTicker.get(toHalfWidth(s.symbol)) ?? null)
    if (!symbol) {
      unmapped.push(s.symbol)
      continue
    }
    const k = key(symbol, s.accountType)
    matched.set(k, (matched.get(k) ?? new Decimal(0)).add(s.quantity))
  }
  return { matched, unmapped }
}

const months = [...new Set(snapshots.map((entry) => entry.asOf))].sort()

describe('month-end reconciliation vs 取引残高報告書', () => {
  it('has 10 monthly statements to check against', () => {
    expect(months).toHaveLength(10)
  })

  for (const asOf of months) {
    it(`matches Rakuten's reported holdings at ${asOf}`, () => {
      const actual = positionsAsOf(asOf)
      const { matched: expected, unmapped } = expectedAsOf(asOf)

      // Every JP equity and fund in the statement must be mappable; an unmapped
      // name means a fund was renamed or newly bought and the map is stale.
      expect(unmapped).toEqual([])

      const mismatches: string[] = []
      for (const [k, qty] of expected) {
        // `k` is already "<symbol> <accountType>".
        const got = actual.get(k)
        if (!got) {
          mismatches.push(`${k}: expected ${qty.toFixed()}, engine holds none`)
        } else if (!got.eq(qty)) {
          mismatches.push(`${k}: expected ${qty.toFixed()}, got ${got.toFixed()}`)
        }
      }
      expect(mismatches).toEqual([])
    })
  }

  it('reconciles the renamed 日経225 fund across the Oct-2024 migration', () => {
    // The alias is what makes this work: units bought under 楽天・日経225 must
    // appear under 楽天・プラス・日経225 in later statements.
    const asOf = '2026-06-30'
    const actual = positionsAsOf(asOf)
    const canonical = resolveStatementFund('楽天P日経225')!
    const growth = actual.get(key(canonical, 'NISA_GROWTH'))
    expect(growth?.toFixed()).toBe('1032403')
  })
})

/**
 * Manual trade entry, editing and deletion.
 *
 * The important cases are the interactions with CSV import: a hand-entered
 * trade must survive an import untouched, an edited import must not be
 * reverted, and a deleted import must not come back.
 */
import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { emptyParseResult } from '../domain/types'
import { loadAllTrades } from '../import/loadFixtures'
import { planImport } from '../import/plan'
import { runEngine } from '../pnl/engine'
import {
  applyTradeEdit,
  buildManualTrade,
  validateManualTrade,
  type ManualTradeInput,
} from './manual'

const base: ManualTradeInput = {
  symbol: '7203',
  name: 'トヨタ自動車',
  assetClass: 'JP_EQUITY',
  accountType: 'SPECIFIC',
  side: 'BUY',
  tradeDate: '2026-07-01',
  quantity: '100',
  unitPrice: '3000',
}

const parse = (over: Partial<ManualTradeInput> = {}) => {
  const r = validateManualTrade({ ...base, ...over })
  if (!r.ok) throw new Error(`unexpected validation failure: ${JSON.stringify(r.errors)}`)
  return r.value
}

/**
 * Field errors for an invalid input, as a plain object.
 * Returns `{}` on unexpected success so assertions stay unconditional and a
 * failure reports the whole error map rather than stopping at the first field.
 */
const errorsFor = (over: Partial<ManualTradeInput>): Record<string, string> => {
  const r = validateManualTrade({ ...base, ...over })
  return r.ok ? {} : r.errors
}

describe('validation', () => {
  it('accepts a well-formed JP equity trade', () => {
    expect(validateManualTrade(base).ok).toBe(true)
  })

  it('rejects zero or negative quantity and price', () => {
    expect(errorsFor({ quantity: '0' }).quantity).toMatch(/greater than zero/)
    expect(errorsFor({ unitPrice: '-5' }).unitPrice).toMatch(/greater than zero/)
  })

  it('rejects a settlement date before the trade date', () => {
    expect(errorsFor({ settleDate: '2026-06-30' }).settleDate).toMatch(/before the trade date/)
  })

  it('requires an FX rate for US trades', () => {
    // Without this a $200 stock would book at ¥200 — a 150× understatement.
    expect(errorsFor({ symbol: 'AAPL', assetClass: 'US_EQUITY' }).fxRate).toMatch(/required/)
  })

  it('flags an FX rate that looks like a typo', () => {
    const errs = errorsFor({
      symbol: 'AAPL',
      assetClass: 'US_EQUITY',
      fxRate: '15.5', // decimal point slipped
    })
    expect(errs.fxRate).toMatch(/decimal point/)
  })

  it('restricts fund-only sides to funds', () => {
    expect(errorsFor({ side: 'REINVEST' }).side).toMatch(/funds only/)
  })

  it('rejects a malformed date', () => {
    expect(errorsFor({ tradeDate: '01/07/2026' }).tradeDate).toMatch(/YYYY-MM-DD/)
  })
})

describe('construction', () => {
  it('computes amounts the same way the CSV parser does', () => {
    const t = buildManualTrade(parse({ fee: '250', feeTax: '25' }))
    expect(t.grossAmount.toFixed()).toBe('300000')
    // Buy pays fees on top.
    expect(t.netAmount.toFixed()).toBe('300275')
    expect(t.netAmountJpy.toFixed()).toBe('300275')
  })

  it('nets fees off a sell instead of adding them', () => {
    const t = buildManualTrade(parse({ side: 'SELL', fee: '250', feeTax: '25' }))
    expect(t.netAmount.toFixed()).toBe('299725')
  })

  it('divides fund prices by 10,000 as Rakuten quotes them', () => {
    const t = buildManualTrade(
      parse({
        symbol: 'eMAXIS Slim 米国株式(S&P500)',
        assetClass: 'FUND',
        quantity: '10000',
        unitPrice: '20830',
      }),
    )
    expect(t.unitPrice.toFixed(4)).toBe('2.0830')
    expect(t.grossAmount.toFixed()).toBe('20830')
  })

  it('converts USD trades to whole yen', () => {
    const t = buildManualTrade(
      parse({
        symbol: 'AAPL',
        assetClass: 'US_EQUITY',
        quantity: '10',
        unitPrice: '250.55',
        fxRate: '157.33',
      }),
    )
    expect(t.currency).toBe('USD')
    // 2505.5 × 157.33 = 394,190.315 → whole yen
    expect(t.netAmountJpy.toFixed()).toBe('394190')
    expect(t.netAmountJpy.mod(1).isZero()).toBe(true)
  })

  it('defaults settlement to T+2 when omitted', () => {
    expect(buildManualTrade(parse()).settleDate).toBe('2026-07-03')
  })

  it('honours an explicit settlement date', () => {
    expect(buildManualTrade(parse({ settleDate: '2026-07-06' })).settleDate).toBe('2026-07-06')
  })

  it('distinguishes repeated identical entries by sequence', () => {
    const a = buildManualTrade(parse(), 0)
    const b = buildManualTrade(parse(), 1)
    expect(a.sourceRowHash).not.toBe(b.sourceRowHash)
  })
})

describe('interaction with CSV import', () => {
  const imported = loadAllTrades()

  it('never collides with an imported row', () => {
    const manual = buildManualTrade(parse())
    const importedHashes = new Set(imported.trades.map((t) => t.sourceRowHash))
    expect(importedHashes.has(manual.sourceRowHash)).toBe(false)
  })

  it('leaves manual trades untouched when a CSV is imported', () => {
    // Manual trade already stored; importing the full CSV must not remove,
    // duplicate, or match it.
    const manual = buildManualTrade(parse())
    const stored = new Set([manual.sourceRowHash])

    const plan = planImport(imported, stored)
    expect(plan.newTrades).toHaveLength(315)
    expect(plan.duplicateTrades).toBe(0)
    expect(plan.newTrades.some((t) => t.sourceRowHash === manual.sourceRowHash)).toBe(false)
  })

  it('keeps an edited import recognisable so the correction survives re-import', () => {
    const original = imported.trades[0]!
    const edited = applyTradeEdit(original, parse({ quantity: '999' }))

    // Identity is preserved...
    expect(edited.sourceRowHash).toBe(original.sourceRowHash)
    // ...but the values are the corrected ones.
    expect(edited.quantity.toFixed()).toBe('999')

    // Re-importing the CSV therefore skips the row rather than reverting it.
    const stored = new Set(imported.trades.map((t) => t.sourceRowHash))
    const plan = planImport(loadAllTrades(), stored)
    expect(plan.newTrades).toHaveLength(0)
  })

  it('does not resurrect a deleted import, because the tombstone keeps the hash', () => {
    // Soft delete: the row stays with `deletedAt` set, so its hash is still
    // present and the importer recognises it as already seen.
    const deleted = imported.trades[5]!
    const stored = new Set(imported.trades.map((t) => t.sourceRowHash))
    const plan = planImport(loadAllTrades(), stored)
    expect(plan.newTrades.some((t) => t.sourceRowHash === deleted.sourceRowHash)).toBe(false)
  })

  it('would resurrect a hard-deleted row — the reason deletion is soft', () => {
    // Demonstrates the failure mode the tombstone prevents.
    const hardDeleted = imported.trades[5]!
    const stored = new Set(
      imported.trades.filter((t) => t !== hardDeleted).map((t) => t.sourceRowHash),
    )
    const plan = planImport(loadAllTrades(), stored)
    expect(plan.newTrades.some((t) => t.sourceRowHash === hardDeleted.sourceRowHash)).toBe(true)
  })
})

describe('engine treats manual trades identically', () => {
  it('computes P&L across a mixed manual and imported history', () => {
    const buy = buildManualTrade(
      parse({ symbol: 'TEST9', tradeDate: '2026-01-05', quantity: '100', unitPrice: '1000' }),
    )
    const sell = buildManualTrade(
      parse({
        symbol: 'TEST9',
        tradeDate: '2026-03-05',
        side: 'SELL',
        quantity: '100',
        unitPrice: '1500',
      }),
    )
    const result = runEngine([buy, sell])
    expect(result.warnings).toEqual([])
    expect(result.realized).toHaveLength(1)
    expect(result.realized[0]!.realizedJpy.toFixed()).toBe('50000')
  })

  it('lets a manual trade close a position opened by an import', () => {
    // The realistic case: Rakuten has not exported today's fill yet, so it is
    // entered by hand and must close against imported lots.
    const all = loadAllTrades().trades
    // Chosen from the data rather than hardcoded: 8411 was day-traded flat on
    // 2026-07-29, so it has no open lot to close.
    const held = runEngine(all).positions.find(
      (p) => p.assetClass === 'JP_EQUITY' && p.quantity.gt(0),
    )
    expect(held).toBeDefined()
    if (!held) throw new Error('no open JP equity position to close')

    const sameInstrument = all.filter(
      (t) => t.symbol === held.symbol && t.accountType === held.accountType,
    )
    const combined = emptyParseResult()

    const manualSell = buildManualTrade(
      parse({
        symbol: held.symbol,
        accountType: held.accountType,
        tradeDate: '2026-07-30',
        side: 'SELL',
        quantity: held.quantity.toFixed(),
        unitPrice: '8000',
      }),
    )
    combined.trades.push(...sameInstrument, manualSell)

    const result = runEngine(combined.trades)
    expect(result.warnings).toEqual([])
    const last = result.realized.at(-1)!
    expect(last.tradeDate).toBe('2026-07-30')
    expect(last.quantity.eq(held.quantity)).toBe(true)
  })
})

describe('editing preserves engine invariants', () => {
  it('keeps JPY amounts whole after an edit', () => {
    const original = buildManualTrade(parse())
    const edited = applyTradeEdit(
      original,
      parse({
        symbol: 'AAPL',
        assetClass: 'US_EQUITY',
        quantity: '7',
        unitPrice: '199.99',
        fxRate: '158.44',
      }),
    )
    expect(edited.netAmountJpy.mod(1).isZero()).toBe(true)
    expect(edited.netAmountJpy.gt(new Decimal(0))).toBe(true)
  })
})

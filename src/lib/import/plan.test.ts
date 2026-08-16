/**
 * Re-import safety.
 *
 * These simulate what actually happens in use: exporting fresh CSVs from
 * Rakuten every few weeks, where each new export overlaps everything before it.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyParseResult, type ParseResult } from '../domain/types'
import {
  loadAllStatements,
  loadAllTrades,
  readShiftJisFile,
  torizanFiles,
  tradeHistoryFiles,
} from './loadFixtures'
import { orderFilesForImport, planImport } from './plan'
import { parseTorizan } from './torizan'
import { parseTradeHistory } from './tradeHistory'

const fresh = loadAllTrades()
const statements = loadAllStatements()

/** Re-parse a single file, as an upload would. */
function parseFile(path: string): ParseResult {
  return parseTradeHistory(readShiftJisFile(path), basename(path))
}

describe('first import', () => {
  it('accepts everything into an empty database', () => {
    const plan = planImport(fresh, new Set())
    expect(plan.newTrades).toHaveLength(315)
    expect(plan.duplicateTrades).toBe(0)
    expect(plan.errors).toEqual([])
  })
})

describe('re-importing the same files', () => {
  it('adds nothing the second time', () => {
    const stored = new Set(fresh.trades.map((trade) => trade.sourceRowHash))
    const plan = planImport(loadAllTrades(), stored)
    expect(plan.newTrades).toHaveLength(0)
    expect(plan.duplicateTrades).toBe(315)
  })

  it('adds nothing on a third and fourth run either', () => {
    const stored = new Set<string>()
    const insertedPerRun: number[] = []
    for (let run = 0; run < 4; run++) {
      const plan = planImport(loadAllTrades(), stored)
      insertedPerRun.push(plan.newTrades.length)
      for (const t of plan.newTrades) stored.add(t.sourceRowHash)
    }
    // Everything lands on the first pass; every later pass is a no-op.
    expect(insertedPerRun).toEqual([315, 0, 0, 0])
    expect(stored.size).toBe(315)
  })

  it('is stable per file, not just in aggregate', () => {
    for (const path of tradeHistoryFiles()) {
      const first = parseFile(path)
      const stored = new Set(first.trades.map((trade) => trade.sourceRowHash))
      const second = planImport(parseFile(path), stored)
      expect(second.newTrades).toHaveLength(0)
      expect(second.duplicateTrades).toBe(first.trades.length)
    }
  })
})

describe('overlapping exports', () => {
  it('adds only the genuinely new trades from a later export', () => {
    // Simulates: imported everything through 2026-06-30, then exported again
    // later. The new file repeats all the old rows plus some new ones.
    const cutoff = '2026-06-30'
    const earlier = fresh.trades.filter((trade) => trade.tradeDate <= cutoff)
    const stored = new Set(earlier.map((trade) => trade.sourceRowHash))
    const expectedNew = fresh.trades.length - earlier.length
    expect(expectedNew).toBeGreaterThan(0)

    const plan = planImport(loadAllTrades(), stored)
    expect(plan.newTrades).toHaveLength(expectedNew)
    expect(plan.duplicateTrades).toBe(earlier.length)
    // Nothing already stored may reappear.
    for (const t of plan.newTrades) expect(t.tradeDate > cutoff).toBe(true)
  })

  it('keeps all executions of a split order across a re-import', () => {
    // KO was filled 8 times on 2026-07-21, and 3 of those fills are byte-identical
    // (1 share @ $85.58). A date-filtered export contains either all of a day's
    // fills or none, so their ordinals — and therefore their hashes — match
    // between a partial export and a full one.
    const ko = fresh.trades.filter((trade) => trade.symbol === 'KO' && trade.tradeDate === '2026-07-21')
    expect(ko).toHaveLength(8)

    const identical = ko.filter((trade) => trade.quantity.eq(1) && trade.unitPrice.eq('85.58'))
    expect(identical).toHaveLength(3)

    // Every fill must remain individually addressable.
    expect(new Set(ko.map((trade) => trade.sourceRowHash)).size).toBe(8)

    // Re-importing must not duplicate them.
    const stored = new Set(fresh.trades.map((trade) => trade.sourceRowHash))
    const plan = planImport(loadAllTrades(), stored)
    expect(plan.newTrades.filter((trade) => trade.symbol === 'KO')).toHaveLength(0)
  })

  it('deduplicates within a single upload of the same file twice', () => {
    // Uploading the same file twice in one batch must not double-insert.
    const path = tradeHistoryFiles()[0]!
    const a = parseFile(path)
    const combined = emptyParseResult()
    combined.trades.push(...a.trades, ...parseFile(path).trades)
    const plan = planImport(combined, new Set())
    expect(plan.newTrades).toHaveLength(a.trades.length)
    expect(plan.duplicateTrades).toBe(a.trades.length)
  })
})

describe('dividends', () => {
  it('does not re-add dividends from overlapping monthly statements', () => {
    const stored = new Set(statements.dividends.map((day) => day.sourceRowHash))
    const again = loadAllStatements()
    const plan = planImport(again, new Set(), stored)
    expect(plan.newDividends).toHaveLength(0)
    expect(plan.duplicateDividends).toBe(6)
  })

  it('accepts dividends from a statement not yet imported', () => {
    const files = torizanFiles()
    const allButLast = files.slice(0, -1)
    const stored = new Set(
      allButLast
        .flatMap((point) => parseTorizan(readShiftJisFile(point), basename(point)).dividends)
        .map((day) => day.sourceRowHash),
    )
    const last = parseTorizan(readShiftJisFile(files.at(-1)!), basename(files.at(-1)!))
    const plan = planImport(last, new Set(), stored)
    // The June 2026 statement carries the ¥14,500 みずほ dividend.
    expect(plan.newDividends.length).toBeGreaterThan(0)
  })
})

describe('commit ordering', () => {
  /** Raw bytes, as an upload delivers them — the parser reads them undecoded. */
  const load = (path: string) => ({ filename: basename(path), bytes: readFileSync(path) })

  it('puts trade histories ahead of statements however they were dropped in', () => {
    const statement = load(torizanFiles()[0]!)
    const history = load(tradeHistoryFiles()[0]!)

    // Worst case: the user drags the statement in first.
    const ordered = orderFilesForImport([statement, history])
    expect(ordered.map((file) => file.filename)).toEqual([history.filename, statement.filename])
  })

  it('leaves files of the same kind in the order they were given', () => {
    const histories = tradeHistoryFiles().map(load)
    expect(orderFilesForImport(histories).map((file) => file.filename)).toEqual(
      histories.map((file) => file.filename),
    )

    const statements = torizanFiles().map(load)
    expect(orderFilesForImport(statements).map((file) => file.filename)).toEqual(
      statements.map((file) => file.filename),
    )
  })
})

describe('points are handled on any future import, not just the known rows', () => {
  it('parses the point format generically', () => {
    // The fix lives in the shared number parser, so it applies to every column
    // of every format — not a patch of two known values.
    const plan = planImport(loadAllTrades(), new Set())
    const withPoints = plan.newTrades.filter((trade) => trade.pointsUsed)
    expect(withPoints).toHaveLength(2)
    for (const t of plan.newTrades) {
      expect(t.netAmountJpy.abs().lt(50_000_000)).toBe(true)
    }
  })
})

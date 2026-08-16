/**
 * Loads the real Rakuten exports from `csv/` for tests and CLI inspection.
 *
 * These are the user's actual statements, gitignored, and are the only
 * meaningful correctness fixture — synthetic data would not reproduce the
 * quirks (unsettled rows, per-10,000-unit fund pricing, dual-currency
 * settlement) that this code exists to handle.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { emptyParseResult, type ParseResult } from '../domain/types'
import { parseTorizan } from './torizan'
import { parseTradeHistory } from './tradeHistory'
import { decodeShiftJis } from './util'

export const CSV_DIR = join(process.cwd(), 'csv')
export const STATEMENT_DIR = join(CSV_DIR, 'statements')

export function readShiftJisFile(path: string): string {
  return decodeShiftJis(readFileSync(path))
}

function listFiles(dir: string, pattern: RegExp): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => pattern.test(name))
    .sort()
    .map((name) => join(dir, name))
}

export const tradeHistoryFiles = (): string[] => listFiles(CSV_DIR, /^tradehistory\(.+\)\.?.*\.csv$/i)
export const torizanFiles = (): string[] => listFiles(STATEMENT_DIR, /_torizan\.csv$/i)

/** Merge many ParseResults into one. */
export function mergeResults(results: ParseResult[]): ParseResult {
  const out = emptyParseResult()
  for (const result of results) {
    out.trades.push(...result.trades)
    out.dividends.push(...result.dividends)
    out.snapshots.push(...result.snapshots)
    out.cashMovements.push(...result.cashMovements)
    out.errors.push(...result.errors)
  }
  return out
}

/** Deduplicate by `sourceRowHash`, mirroring what the DB unique index does. */
export function dedupeTrades(result: ParseResult): ParseResult {
  const seen = new Set<string>()
  result.trades = result.trades.filter((trade) => {
    if (seen.has(trade.sourceRowHash)) return false
    seen.add(trade.sourceRowHash)
    return true
  })
  const seenDiv = new Set<string>()
  result.dividends = result.dividends.filter((payout) => {
    if (seenDiv.has(payout.sourceRowHash)) return false
    seenDiv.add(payout.sourceRowHash)
    return true
  })
  return result
}

/** All trades from the three tradehistory exports. */
export function loadAllTrades(): ParseResult {
  const results = tradeHistoryFiles().map((path) =>
    parseTradeHistory(readShiftJisFile(path), basename(path)),
  )
  return dedupeTrades(mergeResults(results))
}

/** All monthly statements — dividends, cash ledger, position snapshots. */
export function loadAllStatements(): ParseResult {
  const results = torizanFiles().map((path) =>
    parseTorizan(readShiftJisFile(path), basename(path)),
  )
  return dedupeTrades(mergeResults(results))
}

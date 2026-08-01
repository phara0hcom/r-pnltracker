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
    .filter((f) => pattern.test(f))
    .sort()
    .map((f) => join(dir, f))
}

export const tradeHistoryFiles = (): string[] => listFiles(CSV_DIR, /^tradehistory\(.+\)\.?.*\.csv$/i)
export const torizanFiles = (): string[] => listFiles(STATEMENT_DIR, /_torizan\.csv$/i)

/** Merge many ParseResults into one. */
export function mergeResults(results: ParseResult[]): ParseResult {
  const out = emptyParseResult()
  for (const r of results) {
    out.trades.push(...r.trades)
    out.dividends.push(...r.dividends)
    out.snapshots.push(...r.snapshots)
    out.cashMovements.push(...r.cashMovements)
    out.errors.push(...r.errors)
  }
  return out
}

/** Deduplicate by `sourceRowHash`, mirroring what the DB unique index does. */
export function dedupeTrades(result: ParseResult): ParseResult {
  const seen = new Set<string>()
  result.trades = result.trades.filter((t) => {
    if (seen.has(t.sourceRowHash)) return false
    seen.add(t.sourceRowHash)
    return true
  })
  const seenDiv = new Set<string>()
  result.dividends = result.dividends.filter((d) => {
    if (seenDiv.has(d.sourceRowHash)) return false
    seenDiv.add(d.sourceRowHash)
    return true
  })
  return result
}

/** All trades from the three tradehistory exports. */
export function loadAllTrades(): ParseResult {
  const results = tradeHistoryFiles().map((p) =>
    parseTradeHistory(readShiftJisFile(p), basename(p)),
  )
  return dedupeTrades(mergeResults(results))
}

/** All monthly statements — dividends, cash ledger, position snapshots. */
export function loadAllStatements(): ParseResult {
  const results = torizanFiles().map((p) => parseTorizan(readShiftJisFile(p), basename(p)))
  return dedupeTrades(mergeResults(results))
}

/**
 * Import planning — decides what a file would actually add before anything is
 * written, so an import can be previewed and re-running one is harmless.
 *
 * Identity is `sourceRowHash`: the trade's identifying fields plus a per-file
 * occurrence ordinal. The ordinal exists because a single order is often filled
 * as several byte-identical executions (3× KO @ $85.58 on 2026-07-21); without
 * it those collapse into one and real trades vanish.
 *
 * The ordinal is safe across partial re-exports because the hashed key includes
 * the trade date — any date-filtered export contains either all executions of a
 * given key or none, so the ordinals it assigns match those of the full export.
 */
import type { NormalizedDividend, NormalizedTrade, ParseResult } from '../domain/types'
import { detectFormat } from './tradeHistory'
import { decodeShiftJis } from './util'

/**
 * Order a batch so trade histories commit before statements.
 *
 * Two things are resolved from the trade history and cannot be resolved without
 * it: an instrument's asset class, and which account held the units a dividend
 * was paid on. A 取引残高報告書 committed first therefore falls back to what its
 * own section headers say, which is weaker — and for the asset class that answer
 * used to stick permanently, because nothing later overwrote it.
 *
 * The upload screen stages files in whatever order the OS hands over the
 * `FileList` — drag order, or alphabetical, neither of which is meaningful — so
 * the ordering is enforced rather than left to how the user dropped them. The
 * sort is stable, so files of the same kind keep their original order.
 */
export function orderFilesForImport<T extends { bytes: Uint8Array }>(files: T[]): T[] {
  const isStatement = (f: T) => detectFormat(decodeShiftJis(f.bytes)) === 'TORIZAN'
  return files
    .map((f, i) => ({ f, i, rank: isStatement(f) ? 1 : 0 }))
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.i - b.i))
    .map(({ f }) => f)
}

export interface ImportPlan {
  /** Rows not already stored — these would be inserted. */
  newTrades: NormalizedTrade[]
  newDividends: NormalizedDividend[]
  /** Rows already stored, skipped. */
  duplicateTrades: number
  duplicateDividends: number
  /** Rows that failed to parse. Never blocks the rest of the import. */
  errors: ParseResult['errors']
}

/**
 * Compare a parse result against what is already stored.
 *
 * `existingTradeHashes` / `existingDividendHashes` come from the DB's unique
 * index on `sourceRowHash`, so this mirrors exactly what the database would
 * accept — the preview cannot disagree with the commit.
 */
export function planImport(
  parsed: ParseResult,
  existingTradeHashes: ReadonlySet<string>,
  existingDividendHashes: ReadonlySet<string> = new Set(),
): ImportPlan {
  const seenTrades = new Set(existingTradeHashes)
  const newTrades: NormalizedTrade[] = []
  let duplicateTrades = 0

  for (const t of parsed.trades) {
    // Guards both against re-importing a stored row and against the same row
    // appearing twice within one upload batch.
    if (seenTrades.has(t.sourceRowHash)) {
      duplicateTrades++
      continue
    }
    seenTrades.add(t.sourceRowHash)
    newTrades.push(t)
  }

  const seenDividends = new Set(existingDividendHashes)
  const newDividends: NormalizedDividend[] = []
  let duplicateDividends = 0

  for (const d of parsed.dividends) {
    if (seenDividends.has(d.sourceRowHash)) {
      duplicateDividends++
      continue
    }
    seenDividends.add(d.sourceRowHash)
    newDividends.push(d)
  }

  return {
    newTrades,
    newDividends,
    duplicateTrades,
    duplicateDividends,
    errors: parsed.errors,
  }
}

/** Human-readable summary for the import preview screen. */
export function describePlan(plan: ImportPlan): string {
  const parts = [
    `${plan.newTrades.length} new trade${plan.newTrades.length === 1 ? '' : 's'}`,
  ]
  if (plan.newDividends.length) parts.push(`${plan.newDividends.length} new dividends`)
  if (plan.duplicateTrades) parts.push(`${plan.duplicateTrades} already imported`)
  if (plan.duplicateDividends) parts.push(`${plan.duplicateDividends} dividends already imported`)
  if (plan.errors.length) parts.push(`${plan.errors.length} unreadable rows`)
  return parts.join(', ')
}

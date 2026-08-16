/**
 * Persists a parse result to the database.
 *
 * Two-phase by design: `previewImport` reports exactly what would change
 * without writing anything, and `commitImport` applies it. The preview uses the
 * same `planImport` the commit does, so the numbers shown can never disagree
 * with what actually happens.
 *
 * Everything runs in a single transaction. A file that fails halfway leaves the
 * database untouched rather than half-imported, which matters because a partial
 * trade history produces confidently wrong cost basis.
 */
import { and, eq, sql } from 'drizzle-orm'
import { emptyParseResult, type ParseResult } from '../lib/domain/types'
import { describePlan, planImport, type ImportPlan } from '../lib/import/plan'
import { parseTorizan } from '../lib/import/torizan'
import { detectFormat, parseTradeHistory } from '../lib/import/tradeHistory'
import { decodeShiftJis } from '../lib/import/util'
import { attributeDividends } from '../lib/tax/dividends'
import {
  fromTradeRow,
  idFor,
  toCashRow,
  toDividendRow,
  toInstrumentRow,
  toSnapshotRow,
  toTradeRow,
} from './mappers'
import {
  cashMovements,
  dividends,
  importBatches,
  instruments,
  positionSnapshots,
  trades,
} from './schema'
import { db } from './index'

export interface ImportPreview {
  filename: string
  format: string
  plan: ImportPlan
  summary: string
  snapshotCount: number
  cashCount: number
}

/** Parse a single uploaded file. Never throws on a bad row. */
export function parseFile(filename: string, bytes: Uint8Array): ParseResult {
  const text = decodeShiftJis(bytes)
  const format = detectFormat(text)

  switch (format) {
    case 'JP':
    case 'US':
    case 'INVST':
      return parseTradeHistory(text, filename)
    case 'TORIZAN':
      return parseTorizan(text, filename)
    case 'TORIHOU':
    case 'GAIKABU':
    case null:
    default: {
      // Daily reports duplicate the trade history; accepting them would add
      // nothing and risk double-counting under a different hash.
      const result = emptyParseResult()
      result.errors.push({
        file: filename,
        line: 0,
        message:
          format === null
            ? 'Unrecognised file. Expected a Rakuten tradehistory or 取引残高報告書 CSV.'
            : `${format} files duplicate the trade history and are not imported.`,
      })
      return result
    }
  }
}

/** Hashes already stored, tombstones included, so deletions are respected. */
async function existingHashes(userId: string): Promise<{
  trades: Set<string>
  dividends: Set<string>
}> {
  const [tradeRows, dividendRows] = await Promise.all([
    db.select({ h: trades.sourceRowHash }).from(trades).where(eq(trades.userId, userId)),
    db.select({ h: dividends.sourceRowHash }).from(dividends).where(eq(dividends.userId, userId)),
  ])
  return {
    trades: new Set(tradeRows.map((row) => row.h)),
    dividends: new Set(dividendRows.map((row) => row.h)),
  }
}

/** Dry run — reports what a commit would do, writing nothing. */
export async function previewImport(
  userId: string,
  filename: string,
  bytes: Uint8Array,
): Promise<ImportPreview> {
  const parsed = parseFile(filename, bytes)
  const existing = await existingHashes(userId)
  const plan = planImport(parsed, existing.trades, existing.dividends)

  return {
    filename,
    format: detectFormat(decodeShiftJis(bytes)) ?? 'UNKNOWN',
    plan,
    summary: describePlan(plan),
    snapshotCount: parsed.snapshots.length,
    cashCount: parsed.cashMovements.length,
  }
}

export interface ImportResult {
  batchId: string
  tradesInserted: number
  dividendsInserted: number
  snapshotsInserted: number
  cashInserted: number
  duplicatesSkipped: number
  errors: number
}

/**
 * Apply an import.
 *
 * Dividends are attributed to accounts before insert, which requires the full
 * trade history — including anything this same file just added — so the trades
 * are written first and then re-read inside the transaction.
 */
export async function commitImport(
  userId: string,
  filename: string,
  bytes: Uint8Array,
): Promise<ImportResult> {
  const parsed = parseFile(filename, bytes)
  const existing = await existingHashes(userId)
  const plan = planImport(parsed, existing.trades, existing.dividends)

  const format = detectFormat(decodeShiftJis(bytes)) ?? 'UNKNOWN'
  const batchId = idFor('batch', userId, filename, new Date().toISOString())

  return db.transaction(async (tx) => {
    await tx.insert(importBatches).values({
      id: batchId,
      userId,
      filename,
      fileType: format,
      rowsParsed: parsed.trades.length + parsed.dividends.length,
      rowsInserted: plan.newTrades.length + plan.newDividends.length,
      rowsSkipped: plan.duplicateTrades + plan.duplicateDividends,
      errors: plan.errors.map((error) => ({ line: error.line, message: error.message })),
    })

    // Instruments first — trades, dividends and snapshots all reference them.
    //
    // Both sources state an asset class, but they are not equally trustworthy:
    // the trade history carries full metadata, while a statement only knows what
    // its section header said. So snapshots insert weakly and the trade history
    // overwrites, which also repairs any row an earlier statement-first import
    // classified wrongly — that used to be permanent, because the class is read
    // back from this table for every trade the engine sees.
    const dedupe = <T extends { id: string }>(rows: T[]): T[] => {
      const seen = new Set<string>()
      return rows.filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)))
    }

    const fromSnapshots = dedupe(
      parsed.snapshots.map((snapshot) =>
        toInstrumentRow({
          symbol: snapshot.symbol,
          name: snapshot.name,
          assetClass: snapshot.assetClass,
          currency: snapshot.assetClass === 'US_EQUITY' ? 'USD' : 'JPY',
        }),
      ),
    )
    if (fromSnapshots.length) {
      await tx.insert(instruments).values(fromSnapshots).onConflictDoNothing()
    }

    const fromTrades = dedupe(
      plan.newTrades.map((trade) =>
        toInstrumentRow({
          symbol: trade.symbol,
          name: trade.name,
          assetClass: trade.assetClass,
          currency: trade.currency,
        }),
      ),
    )
    if (fromTrades.length) {
      await tx
        .insert(instruments)
        .values(fromTrades)
        .onConflictDoUpdate({
          target: instruments.symbol,
          set: {
            name: sql`excluded.name`,
            assetClass: sql`excluded.asset_class`,
            currency: sql`excluded.currency`,
          },
        })
    }

    if (plan.newTrades.length) {
      await tx
        .insert(trades)
        .values(
          plan.newTrades.map((trade) =>
            toTradeRow({ userId, trade, importBatchId: batchId, origin: 'IMPORT' }),
          ),
        )
        /**
         * Normally a duplicate is a no-op, with one exception.
         *
         * A trade exported before it settled has `受渡金額 = "-"`, so its amount
         * was derived rather than reported. Re-importing after settlement must
         * be allowed to replace that with Rakuten's own figure — otherwise the
         * `unsettled` flag is permanent and the row never becomes authoritative.
         *
         * `setWhere` restricts this to rows that are still unsettled and have
         * not been hand-corrected, so a user's edit is never overwritten.
         */
        .onConflictDoUpdate({
          target: [trades.userId, trades.sourceRowHash],
          set: {
            netAmount: sql`excluded.net_amount`,
            netAmountJpy: sql`excluded.net_amount_jpy`,
            fee: sql`excluded.fee`,
            feeTax: sql`excluded.fee_tax`,
            otherCost: sql`excluded.other_cost`,
            isSettled: sql`excluded.is_settled`,
            updatedAt: new Date(),
          },
          setWhere: and(
            eq(trades.isSettled, false),
            eq(trades.isEdited, false),
            sql`excluded.is_settled = true`,
          ),
        })
    }

    // Attribution needs every trade, not just this file's, to resolve which
    // account held the units on the pay date.
    if (plan.newDividends.length) {
      const allTrades = await tx
        .select({ trade: trades, instrument: instruments })
        .from(trades)
        .innerJoin(instruments, eq(trades.instrumentId, instruments.id))
        .where(eq(trades.userId, userId))

      const history = allTrades.map((row) =>
        fromTradeRow(row.trade, {
          symbol: row.instrument.symbol,
          name: row.instrument.name,
          assetClass: row.instrument.assetClass,
        }),
      )

      const attributed = attributeDividends(plan.newDividends, history)
      await tx
        .insert(dividends)
        .values(attributed.map((payout) => toDividendRow(userId, payout)))
        .onConflictDoNothing()
    }

    if (parsed.snapshots.length) {
      await tx
        .insert(positionSnapshots)
        .values(parsed.snapshots.map((snapshot) => toSnapshotRow(userId, snapshot)))
        .onConflictDoNothing()
    }

    if (parsed.cashMovements.length) {
      await tx
        .insert(cashMovements)
        .values(parsed.cashMovements.map((movement) => toCashRow(userId, movement)))
        .onConflictDoNothing()
    }

    return {
      batchId,
      tradesInserted: plan.newTrades.length,
      dividendsInserted: plan.newDividends.length,
      snapshotsInserted: parsed.snapshots.length,
      cashInserted: parsed.cashMovements.length,
      duplicatesSkipped: plan.duplicateTrades + plan.duplicateDividends,
      errors: plan.errors.length,
    }
  })
}


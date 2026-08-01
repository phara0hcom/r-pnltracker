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
import { and, eq, inArray, sql } from 'drizzle-orm'
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
      const r = emptyParseResult()
      r.errors.push({
        file: filename,
        line: 0,
        message:
          format === null
            ? 'Unrecognised file. Expected a Rakuten tradehistory or 取引残高報告書 CSV.'
            : `${format} files duplicate the trade history and are not imported.`,
      })
      return r
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
    trades: new Set(tradeRows.map((r) => r.h)),
    dividends: new Set(dividendRows.map((r) => r.h)),
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
      errors: plan.errors.map((e) => ({ line: e.line, message: e.message })),
    })

    // Instruments first — trades, dividends and snapshots all reference them.
    // Built from each source separately: trades carry full metadata, whereas a
    // snapshot only knows a symbol, so they cannot share one mapping step.
    const fromTrades = plan.newTrades.map((t) =>
      toInstrumentRow({
        symbol: t.symbol,
        name: t.name,
        assetClass: t.assetClass,
        currency: t.currency,
      }),
    )
    const fromSnapshots = parsed.snapshots.map((s) =>
      toInstrumentRow({
        symbol: s.symbol,
        name: s.name,
        // A snapshot row does not state the asset class; the trade history is
        // authoritative and `onConflictDoNothing` keeps whatever is already there.
        assetClass: 'FUND',
        currency: 'JPY',
      }),
    )

    const seenInstruments = new Set<string>()
    const uniqueInstruments = [...fromTrades, ...fromSnapshots].filter((r) => {
      if (seenInstruments.has(r.id)) return false
      seenInstruments.add(r.id)
      return true
    })
    if (uniqueInstruments.length) {
      await tx.insert(instruments).values(uniqueInstruments).onConflictDoNothing()
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

      const history = allTrades.map((r) =>
        fromTradeRow(r.trade, {
          symbol: r.instrument.symbol,
          name: r.instrument.name,
          assetClass: r.instrument.assetClass,
        }),
      )

      const attributed = attributeDividends(plan.newDividends, history)
      await tx
        .insert(dividends)
        .values(attributed.map((d) => toDividendRow(userId, d)))
        .onConflictDoNothing()
    }

    if (parsed.snapshots.length) {
      await tx
        .insert(positionSnapshots)
        .values(parsed.snapshots.map((s) => toSnapshotRow(userId, s)))
        .onConflictDoNothing()
    }

    if (parsed.cashMovements.length) {
      await tx
        .insert(cashMovements)
        .values(parsed.cashMovements.map((c) => toCashRow(userId, c)))
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

/**
 * Undo an import batch.
 *
 * Hard-deletes only the rows that batch created, and only those still untouched
 * — an edited trade is left alone, because the edit is the user's work rather
 * than the importer's.
 */
export async function revertImport(userId: string, batchId: string): Promise<number> {
  const rows = await db
    .select({ id: trades.id })
    .from(trades)
    .where(
      and(
        eq(trades.userId, userId),
        eq(trades.importBatchId, batchId),
        eq(trades.isEdited, false),
        eq(trades.origin, 'IMPORT'),
      ),
    )

  if (!rows.length) return 0
  await db.delete(trades).where(
    inArray(
      trades.id,
      rows.map((r) => r.id),
    ),
  )
  return rows.length
}

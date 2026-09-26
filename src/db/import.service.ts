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
import * as Sentry from '@sentry/tanstackstart-react'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { emptyParseResult, type ParseResult } from '../lib/domain/types'
import { decodeShiftJis } from '../lib/import/decode'
import {
  describePlan,
  figuresOf,
  planImport,
  type ImportPlan,
  type StoredTrade,
} from '../lib/import/plan'
import { parseTorizan } from '../lib/import/torizan'
import { detectFormat, parseTradeHistory } from '../lib/import/tradeHistory'
import { attributeDividends } from '../lib/tax/dividends'
import {
  dec,
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

/**
 * What is already stored, tombstones included, so deletions are respected.
 *
 * Trades come back as whole identities rather than bare hashes because the
 * planner has to recognise a fill Rakuten has re-dated, whose hash therefore
 * no longer matches. See the restatement note in `lib/import/plan.ts`.
 */
async function existingRows(userId: string): Promise<{
  trades: StoredTrade[]
  dividends: Set<string>
}> {
  const [tradeRows, dividendRows] = await Promise.all([
    db
      .select({
        id: trades.id,
        sourceRowHash: trades.sourceRowHash,
        symbol: instruments.symbol,
        accountType: trades.accountType,
        side: trades.side,
        quantity: trades.quantity,
        unitPrice: trades.unitPrice,
        tradeDate: trades.tradeDate,
        settleDate: trades.settleDate,
        isEdited: trades.isEdited,
        origin: trades.origin,
        isSettled: trades.isSettled,
        deletedAt: trades.deletedAt,
        fee: trades.fee,
        feeTax: trades.feeTax,
        otherCost: trades.otherCost,
        fxRate: trades.fxRate,
        grossAmount: trades.grossAmount,
        netAmount: trades.netAmount,
        netAmountJpy: trades.netAmountJpy,
      })
      .from(trades)
      .innerJoin(instruments, eq(trades.instrumentId, instruments.id))
      .where(eq(trades.userId, userId)),
    db.select({ h: dividends.sourceRowHash }).from(dividends).where(eq(dividends.userId, userId)),
  ])
  return {
    // `numeric(24,8)` comes back as `250.00000000` while the parser's Decimal
    // renders `250`. Both sides are normalised here or the planner's key never
    // matches and every restatement looks like a new trade.
    trades: tradeRows.map((row) => ({
      id: row.id,
      sourceRowHash: row.sourceRowHash,
      symbol: row.symbol,
      accountType: row.accountType,
      side: row.side,
      quantity: dec(row.quantity).toFixed(),
      unitPrice: dec(row.unitPrice).toFixed(),
      tradeDate: row.tradeDate,
      settleDate: row.settleDate,
      isEdited: row.isEdited,
      origin: row.origin,
      isSettled: row.isSettled,
      isDeleted: row.deletedAt != null,
      figures: figuresOf({
        fee: dec(row.fee),
        feeTax: dec(row.feeTax),
        otherCost: dec(row.otherCost),
        fxRate: dec(row.fxRate),
        grossAmount: dec(row.grossAmount),
        netAmount: dec(row.netAmount),
        netAmountJpy: dec(row.netAmountJpy),
      }),
    })),
    dividends: new Set(dividendRows.map((row) => row.h)),
  }
}

/** Dry run — reports what a commit would do, writing nothing. */
export async function previewImport(
  userId: string,
  filename: string,
  bytes: Uint8Array,
  /**
   * Rows earlier files in the same upload would add, planned as if stored —
   * which by the time the commit reaches this file, they are. Without them a
   * fill exported both before and after settlement in one upload is previewed
   * as two new trades, where the commit inserts one and restates it.
   */
  pending: readonly StoredTrade[] = [],
): Promise<ImportPreview> {
  return Sentry.startSpan(
    { name: 'previewImport', op: 'import.preview', attributes: { bytes: bytes.length } },
    async (span) => {
      /*
       * `parseFile` decodes Shift-JIS and parses; `detectFormat` below decodes a
       * second time. Both are CPU over the whole file and neither is measured
       * anywhere else, so they get their own spans — a 40-file upload is 40
       * sequential passes through here and it is worth knowing what that costs
       * before deciding whether the duplicated decode matters.
       */
      const parsed = Sentry.startSpan({ name: 'parseFile', op: 'import.parse' }, () =>
        parseFile(filename, bytes),
      )
      const existing = await Sentry.startSpan({ name: 'existingRows', op: 'db.query' }, () =>
        existingRows(userId),
      )
      const pendingIds = new Set(pending.map((row) => row.id))
      const plan = planImport(
        parsed,
        [...existing.trades.filter((row) => !pendingIds.has(row.id)), ...pending],
        existing.dividends,
      )

      span.setAttribute('newTrades', plan.newTrades.length)
      span.setAttribute('restatedTrades', plan.restatedTrades.length)
      span.setAttribute('settledTrades', plan.settledTrades.length)
      span.setAttribute('supersededTrades', plan.supersededTrades.length)
      span.setAttribute('duplicateTrades', plan.duplicateTrades)

      return {
        filename,
        format: detectFormat(decodeShiftJis(bytes)) ?? 'UNKNOWN',
        plan,
        summary: describePlan(plan),
        snapshotCount: parsed.snapshots.length,
        cashCount: parsed.cashMovements.length,
      }
    },
  )
}

export interface ImportResult {
  batchId: string
  tradesInserted: number
  /**
   * Stored rows the broker restated — re-dated, settled, re-rated, or
   * regrouped at settlement — updated or replaced rather than added.
   */
  tradesRestated: number
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
  const parsed = Sentry.startSpan({ name: 'parseFile', op: 'import.parse' }, () =>
    parseFile(filename, bytes),
  )
  const existing = await Sentry.startSpan({ name: 'existingRows', op: 'db.query' }, () =>
    existingRows(userId),
  )
  const plan = planImport(parsed, existing.trades, existing.dividends)

  const format = detectFormat(decodeShiftJis(bytes)) ?? 'UNKNOWN'
  const batchId = idFor('batch', userId, filename, new Date().toISOString())

  /*
   * One span for the whole transaction rather than one per statement.
   *
   * The statements inside are not independently interesting — they succeed or the
   * transaction rolls back together — but the transaction holds a pooled
   * connection to a database ~75ms away for its entire duration, and it re-reads
   * every trade inside itself when dividends are present. That total is the
   * number that decides whether a 40-file upload is tolerable.
   */
  return Sentry.startSpan(
    {
      name: 'commitImport.transaction',
      op: 'db.transaction',
      attributes: { format, newTrades: plan.newTrades.length },
    },
    () => db.transaction(async (tx) => {
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
        // A stored hash never reaches here — the plan routes it to
        // `settledTrades` or counts it a duplicate — so a conflict is only a
        // concurrent import of the same file, and the first one stands.
        .onConflictDoNothing()
    }

    /*
     * Rows the file states at their final figures: a JP fill now settled, with
     * its commission and 受渡金額, or a US fill at the day's settled rate.
     *
     * Only the money moves. The date, hash and day order stay, being the same
     * execution on the same day. `isEdited` and `deletedAt` are re-checked in
     * the WHERE for the reason given on the restatements below.
     */
    for (const settled of plan.settledTrades) {
      const row = toTradeRow({ userId, trade: settled.trade, importBatchId: batchId, origin: 'IMPORT' })
      await tx
        .update(trades)
        .set({
          fee: row.fee,
          feeTax: row.feeTax,
          otherCost: row.otherCost,
          fxRate: row.fxRate,
          grossAmount: row.grossAmount,
          netAmount: row.netAmount,
          netAmountJpy: row.netAmountJpy,
          pointsUsed: row.pointsUsed,
          isSettled: row.isSettled,
          sourceFile: row.sourceFile,
          importBatchId: batchId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(trades.userId, userId),
            eq(trades.id, settled.id),
            eq(trades.isEdited, false),
            isNull(trades.deletedAt),
          ),
        )
    }

    /*
     * Intraday fills the settled export has regrouped: soft-deleted, so the
     * hash stays claimed and the intraday export cannot bring them back. Only
     * a row still unsettled and untouched by hand qualifies, re-checked here.
     */
    const supersededIds = plan.supersededTrades.map((row) => row.id)
    if (supersededIds.length) {
      await tx
        .update(trades)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(trades.userId, userId),
            inArray(trades.id, supersededIds),
            eq(trades.isSettled, false),
            eq(trades.isEdited, false),
            isNull(trades.deletedAt),
          ),
        )
    }

    /*
     * Fills the broker re-dated: updated in place, never inserted.
     *
     * `onConflictDoUpdate` above cannot reach these — its target is the hash,
     * and the hash is exactly what a restatement changes. The new hash is
     * written along with the rest so re-importing the *same* file afterwards
     * is an ordinary duplicate, and the row id is deliberately left alone so
     * its memo, journal and any open URL survive.
     *
     * `isEdited` is re-checked in the WHERE rather than trusted from the plan:
     * the plan was made outside this transaction, and a hand-correction made
     * in between must still win.
     */
    for (const restated of plan.restatedTrades) {
      const row = toTradeRow({
        userId,
        trade: restated.trade,
        importBatchId: batchId,
        origin: 'IMPORT',
      })
      await tx
        .update(trades)
        .set({
          tradeDate: row.tradeDate,
          settleDate: row.settleDate,
          fee: row.fee,
          feeTax: row.feeTax,
          otherCost: row.otherCost,
          // The settlement rate, replacing the provisional one the
          // pre-settlement export carried — and with it the JPY cost basis.
          fxRate: row.fxRate,
          grossAmount: row.grossAmount,
          netAmount: row.netAmount,
          netAmountJpy: row.netAmountJpy,
          pointsUsed: row.pointsUsed,
          isSettled: row.isSettled,
          sourceRowHash: row.sourceRowHash,
          sourceFile: row.sourceFile,
          importBatchId: batchId,
          // Its place was in the old day's order; the new day has to be
          // ordered with it in, which the import preview offers.
          daySequence: null,
          updatedAt: new Date(),
        })
        .where(
          and(eq(trades.userId, userId), eq(trades.id, restated.id), eq(trades.isEdited, false)),
        )
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
      tradesRestated:
        plan.restatedTrades.length + plan.settledTrades.length + plan.supersededTrades.length,
      dividendsInserted: plan.newDividends.length,
      snapshotsInserted: parsed.snapshots.length,
      cashInserted: parsed.cashMovements.length,
      duplicatesSkipped: plan.duplicateTrades + plan.duplicateDividends,
      errors: plan.errors.length,
    }
    }),
  )
}


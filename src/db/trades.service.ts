/**
 * Trade persistence: read, hand-create, edit, delete, restore.
 *
 * Every read filters out tombstones (`deletedAt IS NULL`), so a deleted trade
 * disappears from P&L, tax and NISA figures without being erased — which is
 * what keeps a later CSV import from resurrecting it.
 */
import type Decimal from 'decimal.js'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { NormalizedTrade } from '../lib/domain/types'
import {
  applyTradeEdit,
  buildManualTrade,
  type ManualTradeParsed,
} from '../lib/trades/manual'
import { fromTradeRow, idFor, instrumentId, toInstrumentRow, toTradeRow } from './mappers'
import { instruments, trades } from './schema'
import { db } from './index'

export interface TradeRecord {
  id: string
  trade: NormalizedTrade
  origin: 'IMPORT' | 'MANUAL'
  isEdited: boolean
  memo: string | null
  /** 1–5, recorded per trade rather than per day. */
  motivation: number | null
}

/** Every live trade, chronologically — the engine's input. */
export async function listTrades(userId: string): Promise<TradeRecord[]> {
  const rows = await db
    .select({ trade: trades, instrument: instruments })
    .from(trades)
    .innerJoin(instruments, eq(trades.instrumentId, instruments.id))
    .where(and(eq(trades.userId, userId), isNull(trades.deletedAt)))
    .orderBy(asc(trades.tradeDate), asc(trades.createdAt))

  return rows.map((r) => ({
    id: r.trade.id,
    trade: fromTradeRow(r.trade, {
      symbol: r.instrument.symbol,
      name: r.instrument.name,
      assetClass: r.instrument.assetClass,
    }),
    origin: r.trade.origin,
    isEdited: r.trade.isEdited,
    memo: r.trade.memo,
    motivation: r.trade.motivation,
  }))
}

/** Hashes already stored, including tombstones — the import dedupe set. */
export async function storedTradeHashes(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ hash: trades.sourceRowHash })
    .from(trades)
    .where(eq(trades.userId, userId))
  return new Set(rows.map((r) => r.hash))
}

/** Ensure the instrument exists before a trade references it. */
async function upsertInstrument(trade: NormalizedTrade): Promise<void> {
  await db
    .insert(instruments)
    .values(toInstrumentRow(trade))
    .onConflictDoUpdate({
      target: instruments.symbol,
      // Keep the most recent display name; the symbol is the stable identity.
      set: { name: trade.name },
    })
}

/**
 * How many manual trades already share this natural key.
 *
 * Used as the sequence salt so entering the same fill twice on purpose produces
 * two distinct rows rather than a silent no-op.
 */
async function manualSequence(userId: string, input: ManualTradeParsed): Promise<number> {
  const probe = buildManualTrade(input, 0)
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(trades)
    .where(
      and(
        eq(trades.userId, userId),
        eq(trades.origin, 'MANUAL'),
        eq(trades.tradeDate, probe.tradeDate),
        eq(trades.instrumentId, instrumentId(probe.symbol)),
        eq(trades.accountType, probe.accountType),
        eq(trades.side, probe.side),
        eq(trades.quantity, probe.quantity.toFixed()),
        eq(trades.unitPrice, probe.unitPrice.toFixed()),
      ),
    )
  return row?.n ?? 0
}

export async function createManualTrade(
  userId: string,
  input: ManualTradeParsed,
): Promise<TradeRecord> {
  const seq = await manualSequence(userId, input)
  const trade = buildManualTrade(input, seq)
  await upsertInstrument(trade)

  const [row] = await db
    .insert(trades)
    .values(
      toTradeRow({
        userId,
        trade,
        origin: 'MANUAL',
        memo: input.memo ?? null,
      }),
    )
    .returning()

  if (!row) throw new Error('failed to insert trade')
  return {
    id: row.id,
    trade,
    origin: 'MANUAL',
    isEdited: false,
    memo: row.memo,
    motivation: row.motivation,
  }
}

/**
 * Correct an existing trade.
 *
 * `sourceRowHash` is preserved by `applyTradeEdit`, so an imported row stays
 * recognisable to future imports of the same CSV and the correction is not
 * reverted. Edits are marked so the UI can show which figures are no longer
 * exactly what Rakuten reported.
 */
export async function updateTrade(
  userId: string,
  tradeId: string,
  input: ManualTradeParsed,
): Promise<TradeRecord> {
  const existing = await getTrade(userId, tradeId)
  if (!existing) throw new Error(`trade ${tradeId} not found`)

  const updated = applyTradeEdit(existing.trade, input)
  await upsertInstrument(updated)

  const row = toTradeRow({
    userId,
    trade: updated,
    origin: existing.origin,
    isEdited: true,
    memo: input.memo ?? existing.memo,
  })

  const [saved] = await db
    .update(trades)
    .set({
      instrumentId: row.instrumentId,
      tradeDate: row.tradeDate,
      settleDate: row.settleDate,
      accountType: row.accountType,
      side: row.side,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      currency: row.currency,
      fee: row.fee,
      feeTax: row.feeTax,
      otherCost: row.otherCost,
      fxRate: row.fxRate,
      grossAmount: row.grossAmount,
      netAmount: row.netAmount,
      netAmountJpy: row.netAmountJpy,
      isSettled: row.isSettled,
      isEdited: true,
      editedAt: new Date(),
      memo: row.memo,
      updatedAt: new Date(),
    })
    .where(and(eq(trades.userId, userId), eq(trades.id, tradeId)))
    .returning()

  if (!saved) throw new Error(`trade ${tradeId} not found`)
  return {
    id: saved.id,
    trade: updated,
    origin: saved.origin,
    isEdited: true,
    memo: saved.memo,
    motivation: saved.motivation,
  }
}

export async function getTrade(userId: string, tradeId: string): Promise<TradeRecord | null> {
  const [row] = await db
    .select({ trade: trades, instrument: instruments })
    .from(trades)
    .innerJoin(instruments, eq(trades.instrumentId, instruments.id))
    .where(and(eq(trades.userId, userId), eq(trades.id, tradeId)))

  if (!row) return null
  return {
    id: row.trade.id,
    trade: fromTradeRow(row.trade, {
      symbol: row.instrument.symbol,
      name: row.instrument.name,
      assetClass: row.instrument.assetClass,
    }),
    origin: row.trade.origin,
    isEdited: row.trade.isEdited,
    memo: row.trade.memo,
    motivation: row.trade.motivation,
  }
}

/**
 * Soft delete.
 *
 * The row is kept so its `sourceRowHash` still participates in import dedupe.
 * A hard delete would let the next import of the same CSV bring the trade back.
 */
export async function deleteTrade(userId: string, tradeId: string): Promise<void> {
  await db
    .update(trades)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(trades.userId, userId), eq(trades.id, tradeId)))
}

export async function restoreTrade(userId: string, tradeId: string): Promise<void> {
  await db
    .update(trades)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(and(eq(trades.userId, userId), eq(trades.id, tradeId)))
}

/**
 * Permanently remove a hand-entered trade.
 *
 * Only ever safe for `origin = 'MANUAL'`: there is no CSV that could recreate
 * it, so no tombstone is needed. Imported rows must use the soft delete.
 */
export async function purgeManualTrade(userId: string, tradeId: string): Promise<void> {
  await db
    .delete(trades)
    .where(
      and(eq(trades.userId, userId), eq(trades.id, tradeId), eq(trades.origin, 'MANUAL')),
    )
}

export async function listDeletedTrades(userId: string): Promise<TradeRecord[]> {
  const rows = await db
    .select({ trade: trades, instrument: instruments })
    .from(trades)
    .innerJoin(instruments, eq(trades.instrumentId, instruments.id))
    .where(and(eq(trades.userId, userId), sql`${trades.deletedAt} is not null`))
    .orderBy(asc(trades.tradeDate))

  return rows.map((r) => ({
    id: r.trade.id,
    trade: fromTradeRow(r.trade, {
      symbol: r.instrument.symbol,
      name: r.instrument.name,
      assetClass: r.instrument.assetClass,
    }),
    origin: r.trade.origin,
    isEdited: r.trade.isEdited,
    memo: r.trade.memo,
    motivation: r.trade.motivation,
  }))
}

export const tradeIdFor = (userId: string, hash: string): string => idFor('trade', userId, hash)
export type { Decimal }

/**
 * Per-trade journal: a memo and how motivated the trade felt.
 *
 * Deliberately separate from `updateTrade`: journalling must never touch the
 * numbers, so this cannot mark a row `isEdited` or disturb its cost basis.
 */
export async function setTradeJournal(
  userId: string,
  tradeId: string,
  input: { memo?: string | null; motivation?: number | null },
): Promise<void> {
  await db
    .update(trades)
    .set({
      ...(input.memo !== undefined ? { memo: input.memo } : {}),
      ...(input.motivation !== undefined ? { motivation: input.motivation } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(trades.userId, userId), eq(trades.id, tradeId)))
}

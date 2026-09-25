/**
 * Conversion between domain objects (`Decimal`) and database rows (`numeric`,
 * which the pg driver surfaces as `string`).
 *
 * This is the one place precision can silently vanish, so every numeric column
 * goes through `dec()` / `num()` rather than being touched directly. Passing a
 * JS `number` through here would be a bug: `0.1 + 0.2` is not `0.3`, and fund
 * unit counts exceed what a float can represent exactly.
 */
import { createHash } from 'node:crypto'
import Decimal from 'decimal.js'
import type {
  AccountType,
  AssetClass,
  Currency,
  NormalizedCashMovement,
  NormalizedTrade,
  PositionSnapshot,
} from '../lib/domain/types'
import type { AttributedDividend } from '../lib/tax/dividends'
import type { DbDividend, DbTrade, NewDbTrade } from './schema'

/** DB numeric (string) → Decimal. */
export const dec = (v: string | null | undefined): Decimal =>
  v == null ? new Decimal(0) : new Decimal(v)

/** Decimal → DB numeric. Fixed notation, never exponential. */
export const num = (d: Decimal): string => d.toFixed()

/** Optional variants, for nullable columns. */
export const decOrNull = (v: string | null | undefined): Decimal | null =>
  v == null ? null : new Decimal(v)
export const numOrNull = (d: Decimal | null | undefined): string | null =>
  d == null ? null : d.toFixed()

/**
 * Deterministic id derived from the natural key.
 *
 * Using a hash rather than a random uuid means re-running an import produces
 * the same ids, so `onConflictDoNothing` is a true no-op and foreign keys stay
 * stable across re-imports.
 */
export const idFor = (...parts: string[]): string =>
  createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32)

export const instrumentId = (symbol: string): string => idFor('instrument', symbol)

export interface TradeRowInput {
  userId: string
  trade: NormalizedTrade
  importBatchId?: string
  /** Hand-entered rows are never rewritten by a later import. */
  origin?: 'IMPORT' | 'MANUAL'
  isEdited?: boolean
  memo?: string | null
}

export function toTradeRow({
  userId,
  trade,
  importBatchId,
  origin = 'IMPORT',
  isEdited = false,
  memo = null,
}: TradeRowInput): NewDbTrade {
  return {
    id: idFor('trade', userId, trade.sourceRowHash),
    userId,
    instrumentId: instrumentId(trade.symbol),
    tradeDate: trade.tradeDate,
    settleDate: trade.settleDate,
    accountType: trade.accountType,
    side: trade.side,
    quantity: num(trade.quantity),
    unitPrice: num(trade.unitPrice),
    currency: trade.currency,
    fee: num(trade.fee),
    feeTax: num(trade.feeTax),
    otherCost: num(trade.otherCost),
    fxRate: num(trade.fxRate),
    grossAmount: num(trade.grossAmount),
    netAmount: num(trade.netAmount),
    netAmountJpy: num(trade.netAmountJpy),
    pointsUsed: numOrNull(trade.pointsUsed),
    isSettled: trade.isSettled,
    sourceRowHash: trade.sourceRowHash,
    sourceFile: trade.sourceFile,
    importBatchId: importBatchId ?? null,
    origin,
    isEdited,
    editedAt: isEdited ? new Date() : null,
    memo,
    daySequence: trade.daySequence ?? null,
  }
}

/** DB row → engine input. The engine only ever sees Decimals. */
export function fromTradeRow(
  row: DbTrade,
  instrument: { symbol: string; name: string; assetClass: AssetClass },
): NormalizedTrade {
  return {
    tradeDate: row.tradeDate,
    settleDate: row.settleDate,
    symbol: instrument.symbol,
    name: instrument.name,
    assetClass: instrument.assetClass,
    accountType: row.accountType,
    side: row.side,
    quantity: dec(row.quantity),
    unitPrice: dec(row.unitPrice),
    currency: row.currency,
    fee: dec(row.fee),
    feeTax: dec(row.feeTax),
    otherCost: dec(row.otherCost),
    fxRate: dec(row.fxRate),
    grossAmount: dec(row.grossAmount),
    netAmount: dec(row.netAmount),
    netAmountJpy: dec(row.netAmountJpy),
    pointsUsed: decOrNull(row.pointsUsed) ?? undefined,
    isSettled: row.isSettled,
    daySequence: row.daySequence ?? undefined,
    sourceRowHash: row.sourceRowHash,
    sourceFile: row.sourceFile,
  }
}

export function toInstrumentRow(trade: {
  symbol: string
  name: string
  assetClass: AssetClass
  currency: Currency
}): {
  id: string
  symbol: string
  name: string
  assetClass: AssetClass
  currency: Currency
} {
  return {
    id: instrumentId(trade.symbol),
    symbol: trade.symbol,
    name: trade.name,
    assetClass: trade.assetClass,
    currency: trade.currency,
  }
}

export function toDividendRow(userId: string, d: AttributedDividend) {
  return {
    id: idFor('dividend', userId, d.sourceRowHash),
    userId,
    instrumentId: instrumentId(d.symbol),
    payDate: d.payDate,
    accountType: d.accountType,
    kind: d.kind,
    grossAmount: num(d.grossAmount),
    incomeTax: num(d.incomeTax),
    localTax: num(d.localTax),
    netAmount: num(d.netAmount),
    currency: d.currency,
    isTaxable: d.isTaxable,
    attributionConfident: d.attributionConfident,
    sourceRowHash: d.sourceRowHash,
    sourceFile: d.sourceFile,
  }
}

export function fromDividendRow(row: DbDividend): AttributedDividend {
  return {
    payDate: row.payDate,
    symbol: '',
    name: '',
    accountType: row.accountType,
    kind: row.kind,
    netAmount: dec(row.netAmount),
    currency: row.currency,
    sourceRowHash: row.sourceRowHash,
    sourceFile: row.sourceFile,
    grossAmount: dec(row.grossAmount),
    incomeTax: dec(row.incomeTax),
    localTax: dec(row.localTax),
    isTaxable: row.isTaxable,
    attributionConfident: row.attributionConfident,
  }
}

export function toCashRow(userId: string, c: NormalizedCashMovement) {
  return {
    id: idFor('cash', userId, c.sourceRowHash),
    userId,
    date: c.date,
    kind: c.kind,
    description: c.description,
    amount: num(c.amount),
    currency: c.currency,
    sourceRowHash: c.sourceRowHash,
  }
}

export function toSnapshotRow(userId: string, s: PositionSnapshot) {
  return {
    id: idFor('snapshot', userId, s.asOf, s.symbol, s.accountType),
    userId,
    instrumentId: instrumentId(s.symbol),
    asOf: s.asOf,
    symbol: s.symbol,
    accountType: s.accountType satisfies AccountType,
    quantity: num(s.quantity),
    valuationJpy: num(s.valuationJpy),
  }
}

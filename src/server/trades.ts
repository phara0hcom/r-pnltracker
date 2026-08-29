/**
 * Trade server functions for the table screen.
 *
 * Edits go through the same `validateManualTrade` → `updateTrade` path as
 * hand-entered trades, so there is one validated code path rather than a
 * separate, laxer one for inline editing.
 */
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { authed } from './middleware'
import { db } from '~/db'
import { cashMovements, dividends, instruments } from '~/db/schema'
import {
  createManualTrade,
  deleteTrade,
  listTrades,
  restoreTrade,
  updateTrade,
} from '~/db/trades.service'
import type { AssetClass } from '~/lib/domain/types'
import { runEngine } from '~/lib/pnl/engine'
import { validateManualTrade, type ManualTradeInput } from '~/lib/trades/manual'

/** One row as the table needs it. Decimals are strings — exact on the wire. */
export interface TradeRow {
  id: string
  tradeDate: string
  settleDate: string
  symbol: string
  name: string
  assetClass: 'JP_EQUITY' | 'US_EQUITY' | 'FUND'
  accountType: 'SPECIFIC' | 'NISA_OLD' | 'NISA_GROWTH' | 'NISA_TSUMITATE'
  side: 'BUY' | 'SELL' | 'REINVEST' | 'REDEEM'
  quantity: string
  /** For funds this is the per-10,000-口 figure, matching how Rakuten quotes it. */
  displayPrice: string
  fee: string
  feeTax: string
  /**
   * Every cost of the transaction: commission, its consumption tax, and 諸費用
   * (SEC fee on US sells). Summed here rather than in the client because
   * `otherCost` is not otherwise on this row, and because adding money is
   * `Decimal` work — the client would be doing it in floats.
   */
  commission: string
  fxRate: string
  currency: 'JPY' | 'USD'
  netAmountJpy: string
  /** Present only on closing trades. */
  realizedJpy: string | null
  /** Cost basis of the units sold — the denominator for return %. */
  costJpy: string | null
  /**
   * Realized P&L as a fraction of the cost of the units sold, so a ¥10k gain on
   * a ¥20k position (+50%) is not read the same as ¥10k on ¥2M (+0.5%).
   */
  returnPct: number | null
  isSettled: boolean
  origin: 'IMPORT' | 'MANUAL'
  isEdited: boolean
  memo: string | null
}

/**
 * Funds are stored per single 口 but displayed per 10,000, so the form round-trips
 * the same number the user sees on Rakuten's site.
 */
const FUND_DISPLAY_MULTIPLIER = 10_000

export const listTradeRows = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(async ({ context }): Promise<TradeRow[]> => {
    const records = await listTrades(context.userId)
    const engine = runEngine(records.map((r) => r.trade))

    // Realized P&L belongs to a closing event, not a trade row, so it is matched
    // back by (date, symbol, account, quantity) — the engine's own key.
    const realizedBy = new Map<string, { realized: string; cost: string; pct: number | null }>()
    for (const e of engine.realized) {
      realizedBy.set(`${e.tradeDate}|${e.symbol}|${e.accountType}|${e.quantity.toFixed()}`, {
        realized: e.realizedJpy.toFixed(),
        cost: e.costJpy.toFixed(),
        // A zero cost basis would divide by zero; report null rather than Infinity.
        pct: e.costJpy.gt(0) ? e.realizedJpy.div(e.costJpy).toNumber() : null,
      })
    }

    return records.map(({ id, trade, origin, isEdited, memo }) => {
      const displayPrice =
        trade.assetClass === 'FUND'
          ? trade.unitPrice.mul(FUND_DISPLAY_MULTIPLIER).toFixed()
          : trade.unitPrice.toFixed()

      const key = `${trade.tradeDate}|${trade.symbol}|${trade.accountType}|${trade.quantity.toFixed()}`
      const isClose = trade.side === 'SELL' || trade.side === 'REDEEM'
      const hit = realizedBy.get(key)

      return {
        id,
        tradeDate: trade.tradeDate,
        settleDate: trade.settleDate,
        symbol: trade.symbol,
        name: trade.name,
        assetClass: trade.assetClass,
        accountType: trade.accountType,
        side: trade.side,
        quantity: trade.quantity.toFixed(),
        displayPrice,
        fee: trade.fee.toFixed(),
        feeTax: trade.feeTax.toFixed(),
        commission: trade.fee.add(trade.feeTax).add(trade.otherCost).toFixed(),
        fxRate: trade.fxRate.toFixed(),
        currency: trade.currency,
        netAmountJpy: trade.netAmountJpy.toFixed(),
        realizedJpy: isClose ? (hit?.realized ?? null) : null,
        costJpy: isClose ? (hit?.cost ?? null) : null,
        returnPct: isClose ? (hit?.pct ?? null) : null,
        isSettled: trade.isSettled,
        origin,
        isEdited,
        memo,
      }
    })
  })

export interface MutationResult {
  ok: boolean
  /** Field-level messages keyed by form path, for inline display. */
  errors?: Record<string, string>
  id?: string
}

export const saveTrade = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: { id: string; patch: ManualTradeInput }) => data)
  .handler(async ({ data, context }): Promise<MutationResult> => {
    const parsed = validateManualTrade(data.patch)
    if (!parsed.ok) return { ok: false, errors: parsed.errors }

    const saved = await updateTrade(context.userId, data.id, parsed.value)
    return { ok: true, id: saved.id }
  })

export const addTrade = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: ManualTradeInput) => data)
  .handler(async ({ data, context }): Promise<MutationResult> => {
    const parsed = validateManualTrade(data)
    if (!parsed.ok) return { ok: false, errors: parsed.errors }

    const created = await createManualTrade(context.userId, parsed.value)
    return { ok: true, id: created.id }
  })

export const removeTrade = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: { id: string }) => data)
  .handler(async ({ data, context }): Promise<MutationResult> => {
    // Soft delete — keeps the tombstone so a later CSV import cannot resurrect it.
    await deleteTrade(context.userId, data.id)
    return { ok: true, id: data.id }
  })

export const undoRemoveTrade = createServerFn({ method: 'POST' })
  .middleware([authed])
  .validator((data: { id: string }) => data)
  .handler(async ({ data, context }): Promise<MutationResult> => {
    await restoreTrade(context.userId, data.id)
    return { ok: true, id: data.id }
  })

// ── Cash ledger ─────────────────────────────────────────────────────────────

/**
 * Everything that moves cash without being a trade.
 *
 * Only the TradingView export reads this. It is one round trip rather than two
 * because the two halves are useless apart: a cash balance that counts deposits
 * but not the dividends credited alongside them is wrong in a way that is
 * harder to spot than having neither.
 *
 * Trade settlements are deliberately absent — `parseTorizan` drops them,
 * because `tradehistory` is authoritative for trades and the importer would
 * otherwise book every purchase twice.
 */
export interface CashLedger {
  cash: {
    date: string
    /** Signed as the statement reports it: money in is positive, out negative. */
    amount: string
    currency: 'JPY' | 'USD'
    /** 摘要 — the only thing separating tax withholding from a bank transfer. */
    description: string
  }[]
  dividends: {
    payDate: string
    symbol: string
    assetClass: AssetClass
    /** As credited, after withholding — the figure that actually reached cash. */
    netAmount: string
  }[]
}

export const listCashLedger = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(async ({ context }): Promise<CashLedger> => {
    const [cash, payouts] = await Promise.all([
      db
        .select({
          date: cashMovements.date,
          amount: cashMovements.amount,
          currency: cashMovements.currency,
          description: cashMovements.description,
        })
        .from(cashMovements)
        .where(eq(cashMovements.userId, context.userId)),
      // Joined, not left-joined: a payout whose instrument never resolved has no
      // symbol to chart and could not be exported anyway.
      db
        .select({
          payDate: dividends.payDate,
          netAmount: dividends.netAmount,
          symbol: instruments.symbol,
          assetClass: instruments.assetClass,
        })
        .from(dividends)
        .innerJoin(instruments, eq(dividends.instrumentId, instruments.id))
        .where(eq(dividends.userId, context.userId)),
    ])

    return { cash, dividends: payouts }
  })

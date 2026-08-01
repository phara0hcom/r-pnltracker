/**
 * Hand-entered and hand-corrected trades.
 *
 * Manual trades are first-class: once created they are indistinguishable to the
 * P&L engine from imported ones, because both produce the same
 * `NormalizedTrade`. What differs is provenance and how imports treat them.
 *
 * Three rules govern the interaction with CSV import:
 *
 *  1. A manual trade is never matched, overwritten, or removed by an import.
 *     Its hash is salted with `MANUAL` so it can never collide with a CSV row.
 *  2. Editing an imported trade keeps its original `sourceRowHash`, so
 *     re-importing the same CSV still recognises the row and skips it — the
 *     edit wins rather than being silently reverted.
 *  3. Deleting is a soft delete. A hard delete would let the next import
 *     resurrect the row, since dedupe matches on a hash that would no longer
 *     exist in the table.
 */
import Decimal from 'decimal.js'
import { z } from 'zod'
import { canonicalSymbol } from '../domain/instruments'
import {
  FUND_UNIT_DIVISOR,
  ONE,
  ZERO,
  type AssetClass,
  type NormalizedTrade,
} from '../domain/types'
import { rowHash, toYen } from '../import/util'

const decimalString = z
  .string()
  .trim()
  .min(1, 'required')
  .refine((v) => {
    try {
      return new Decimal(v).isFinite()
    } catch {
      return false
    }
  }, 'must be a number')

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'not a real date')

/**
 * Input shape for the manual-entry form.
 *
 * Numbers arrive as strings because that is what an `<input>` produces, and
 * parsing them here rather than in the component keeps `Number()` — and its
 * precision loss — out of the path entirely.
 */
export const manualTradeSchema = z
  .object({
    symbol: z.string().trim().min(1, 'symbol is required').max(128),
    name: z.string().trim().max(256).optional(),
    assetClass: z.enum(['JP_EQUITY', 'US_EQUITY', 'FUND']),
    accountType: z.enum(['SPECIFIC', 'NISA_OLD', 'NISA_GROWTH', 'NISA_TSUMITATE']),
    side: z.enum(['BUY', 'SELL', 'REINVEST', 'REDEEM']),
    tradeDate: isoDate,
    /** Defaults to trade date + 2 business days if omitted. */
    settleDate: isoDate.optional(),
    quantity: decimalString,
    /**
     * For funds this is 基準価額 — quoted per 10,000 口, matching what Rakuten
     * shows — and is divided down on the way in.
     */
    unitPrice: decimalString,
    fee: decimalString.optional(),
    feeTax: decimalString.optional(),
    otherCost: decimalString.optional(),
    /** Required for USD instruments; forced to 1 otherwise. */
    fxRate: decimalString.optional(),
    memo: z.string().trim().max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    const qty = new Decimal(v.quantity)
    if (qty.lte(0)) {
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'must be greater than zero' })
    }
    const price = new Decimal(v.unitPrice)
    if (price.lte(0)) {
      ctx.addIssue({ code: 'custom', path: ['unitPrice'], message: 'must be greater than zero' })
    }
    if (v.settleDate && v.settleDate < v.tradeDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['settleDate'],
        message: 'cannot settle before the trade date',
      })
    }
    // A US trade priced in dollars with no rate would silently book at ¥1/$.
    if (v.assetClass === 'US_EQUITY') {
      if (!v.fxRate) {
        ctx.addIssue({
          code: 'custom',
          path: ['fxRate'],
          message: 'USD/JPY rate is required for US trades',
        })
      } else {
        const fx = new Decimal(v.fxRate)
        if (fx.lte(0)) {
          ctx.addIssue({ code: 'custom', path: ['fxRate'], message: 'must be greater than zero' })
        } else if (fx.lt(50) || fx.gt(400)) {
          // Not a hard error — a typo like 15.5 or 1550 is far likelier than a
          // real rate outside this band, but the user may know better.
          ctx.addIssue({
            code: 'custom',
            path: ['fxRate'],
            message: `${fx.toFixed()} looks wrong for USD/JPY — check the decimal point`,
          })
        }
      }
    }
    // 再投資 only exists for funds; allowing it elsewhere would mis-book basis.
    if (v.side === 'REINVEST' && v.assetClass !== 'FUND') {
      ctx.addIssue({
        code: 'custom',
        path: ['side'],
        message: 'reinvestment applies to funds only',
      })
    }
    if (v.side === 'REDEEM' && v.assetClass !== 'FUND') {
      ctx.addIssue({ code: 'custom', path: ['side'], message: 'redemption applies to funds only' })
    }
  })

export type ManualTradeInput = z.input<typeof manualTradeSchema>
export type ManualTradeParsed = z.output<typeof manualTradeSchema>

/** Trade date + 2 calendar days, matching typical T+2 settlement. */
function defaultSettleDate(tradeDate: string): string {
  const d = new Date(`${tradeDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 2)
  return d.toISOString().slice(0, 10)
}

const dec = (v: string | undefined): Decimal => (v ? new Decimal(v) : ZERO)

/**
 * Build a `NormalizedTrade` from validated form input.
 *
 * `seq` disambiguates several identical manual entries — the same use case the
 * per-file occurrence ordinal serves for CSV rows. Callers pass the count of
 * existing manual trades sharing the same natural key.
 */
export function buildManualTrade(
  input: ManualTradeParsed,
  seq = 0,
): NormalizedTrade {
  const assetClass: AssetClass = input.assetClass
  const symbol = canonicalSymbol(input.symbol.trim())
  const isUsd = assetClass === 'US_EQUITY'
  const displayName = input.name?.trim() ?? ''

  const quantity = new Decimal(input.quantity)
  const rawPrice = new Decimal(input.unitPrice)
  // Funds are quoted per 10,000 口, exactly as in the CSV export.
  const unitPrice = assetClass === 'FUND' ? rawPrice.div(FUND_UNIT_DIVISOR) : rawPrice

  const fee = dec(input.fee)
  const feeTax = dec(input.feeTax)
  const otherCost = dec(input.otherCost)
  const fxRate = isUsd ? new Decimal(input.fxRate!) : ONE

  const gross = quantity.mul(unitPrice)
  const costs = fee.add(feeTax).add(otherCost)
  const isOpening = input.side === 'BUY' || input.side === 'REINVEST'
  const netAmount = isOpening ? gross.add(costs) : gross.sub(costs)
  const netAmountJpy = toYen(netAmount.mul(fxRate))

  return {
    tradeDate: input.tradeDate,
    settleDate: input.settleDate ?? defaultSettleDate(input.tradeDate),
    symbol,
    // An explicitly blank name falls back to the symbol, so `??` would be
    // wrong here — it would keep the empty string.
    name: displayName.length > 0 ? displayName : symbol,
    assetClass,
    accountType: input.accountType,
    side: input.side,
    quantity,
    unitPrice,
    currency: isUsd ? 'USD' : 'JPY',
    fee,
    feeTax,
    otherCost,
    fxRate,
    grossAmount: gross,
    netAmount,
    netAmountJpy,
    // Hand-entered trades are recorded as already settled.
    isSettled: true,
    // The MANUAL salt guarantees a hand-entered row can never collide with a
    // CSV row, so an import will neither match nor overwrite it.
    sourceRowHash: rowHash([
      'MANUAL',
      input.tradeDate,
      symbol,
      input.accountType,
      input.side,
      quantity,
      unitPrice,
      seq,
    ]),
    sourceFile: 'manual',
  }
}

/**
 * Apply an edit to an existing trade.
 *
 * `sourceRowHash` is deliberately preserved. For an imported trade that keeps
 * the row recognisable to future imports of the same CSV, so the correction is
 * not silently undone; for a manual trade it keeps the identity stable.
 */
export function applyTradeEdit(
  existing: NormalizedTrade,
  input: ManualTradeParsed,
): NormalizedTrade {
  const rebuilt = buildManualTrade(input)
  return {
    ...rebuilt,
    sourceRowHash: existing.sourceRowHash,
    sourceFile: existing.sourceFile,
  }
}

/** Field-level errors keyed by path, ready for the form to render. */
export function validateManualTrade(
  raw: unknown,
): { ok: true; value: ManualTradeParsed } | { ok: false; errors: Record<string, string> } {
  const result = manualTradeSchema.safeParse(raw)
  if (result.success) return { ok: true, value: result.data }

  const errors: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_'
    // Keep the first message per field — forms show one error at a time.
    errors[key] ??= issue.message
  }
  return { ok: false, errors }
}

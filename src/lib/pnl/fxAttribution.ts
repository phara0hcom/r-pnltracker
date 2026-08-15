/**
 * Splits the JPY P&L of a US position into stock movement vs currency movement.
 *
 * With entry price/rate `P₀,R₀` and exit `P₁,R₁` over quantity `q`:
 *
 *   stockEffect = (P₁ − P₀) × R₁ × q     stock move, valued at the exit rate
 *   fxEffect    = P₀ × (R₁ − R₀) × q     yen move, applied to the original cost
 *   ────────────────────────────────────
 *   sum         = P₁R₁q − P₀R₀q          gross JPY P&L, exactly
 *
 * This two-term form is chosen over the textbook stock/FX/cross-product split
 * because it is exact with no residual interaction term, so the two components
 * always add up to the headline figure — there is never an unexplained
 * remainder to reconcile in the UI.
 *
 * `costEffect` carries whatever those two terms do not: it is a residual, not a
 * fee tally. It reconciles the split to the engine's figure exactly, and the
 * three parts always reconstruct net realized P&L.
 *
 * The identity on line 9 holds for a single acquisition. `P₀` and `R₀` are each
 * quantity-weighted averages over the pool, and the weighted mean of a product
 * is not the product of the weighted means, so a position built from lots at
 * different price/rate combinations leaves `P₀R₀q ≠ costJpy`. That gap lands in
 * `costEffect` alongside the fees. It nets to zero across a full round trip and
 * never touches `totalJpy`, but it does mean the stock/currency split is an
 * approximation whenever a position was accumulated at moving rates.
 *
 * Making it exact is possible — deriving the entry rate as `costJpy / (P₀ × q)`
 * reproduces the real cost basis by construction — at the cost of an entry rate
 * that no longer matches the `avgEntryFx` shown beside it. Left as-is
 * deliberately; the two figures agreeing is worth more than the residual.
 */
import type Decimal from 'decimal.js'
import { ZERO, type AccountType } from '../domain/types'
import type { RealizedEvent } from './engine'

export interface FxAttribution {
  symbol: string
  name: string
  accountType: AccountType
  tradeDate: string
  quantity: Decimal
  entryPriceUsd: Decimal
  exitPriceUsd: Decimal
  entryFxRate: Decimal
  exitFxRate: Decimal
  /** Attributable to the share price moving. */
  stockEffectJpy: Decimal
  /** Attributable to USD/JPY moving. */
  fxEffectJpy: Decimal
  /**
   * Residual: commissions, SEC fees, whole-yen rounding, and the weighted-average
   * cross-term described in the module header. Not a pure fee figure.
   */
  costEffectJpy: Decimal
  /** stock + fx + cost — equals the engine's realized figure. */
  totalJpy: Decimal
  /** P&L in USD terms, ignoring currency movement entirely. */
  totalUsd: Decimal
}

export interface FxAttributionSummary {
  events: FxAttribution[]
  stockEffectJpy: Decimal
  fxEffectJpy: Decimal
  costEffectJpy: Decimal
  totalJpy: Decimal
  /** Share of gross P&L explained by currency, 0–1. Null when gross is zero. */
  fxShare: number | null
  /** Quantity-weighted average entry and exit rates across all closes. */
  avgEntryFx: Decimal
  avgExitFx: Decimal
}

/** Decompose one realized close. Only meaningful for USD-quoted instruments. */
export function attributeOne(e: RealizedEvent): FxAttribution {
  const q = e.quantity
  const p0 = e.entryPriceNative
  const p1 = e.exitPriceNative
  const r0 = e.entryFxRate
  const r1 = e.exitFxRate

  const stockEffectJpy = p1.sub(p0).mul(r1).mul(q)
  const fxEffectJpy = p0.mul(r1.sub(r0)).mul(q)
  const grossJpy = stockEffectJpy.add(fxEffectJpy)
  // Residual — mostly transaction cost and rounding, plus the averaging
  // cross-term when the pool was built at more than one price/rate.
  const costEffectJpy = e.realizedJpy.sub(grossJpy)

  return {
    symbol: e.symbol,
    name: e.name,
    accountType: e.accountType,
    tradeDate: e.tradeDate,
    quantity: q,
    entryPriceUsd: p0,
    exitPriceUsd: p1,
    entryFxRate: r0,
    exitFxRate: r1,
    stockEffectJpy,
    fxEffectJpy,
    costEffectJpy,
    totalJpy: e.realizedJpy,
    totalUsd: p1.sub(p0).mul(q),
  }
}

/**
 * Portfolio-level attribution across every US close.
 *
 * JP equities and funds are excluded — they are natively JPY, so a currency
 * split is meaningless and would dilute the figure with structural zeros.
 */
export function attributeFx(realized: RealizedEvent[]): FxAttributionSummary {
  const events = realized
    .filter((e) => e.assetClass === 'US_EQUITY')
    .map(attributeOne)

  const stockEffectJpy = events.reduce((a, e) => a.add(e.stockEffectJpy), ZERO)
  const fxEffectJpy = events.reduce((a, e) => a.add(e.fxEffectJpy), ZERO)
  const costEffectJpy = events.reduce((a, e) => a.add(e.costEffectJpy), ZERO)
  const totalJpy = events.reduce((a, e) => a.add(e.totalJpy), ZERO)

  const totalQty = events.reduce((a, e) => a.add(e.quantity), ZERO)
  const avgEntryFx = totalQty.gt(0)
    ? events.reduce((a, e) => a.add(e.entryFxRate.mul(e.quantity)), ZERO).div(totalQty)
    : ZERO
  const avgExitFx = totalQty.gt(0)
    ? events.reduce((a, e) => a.add(e.exitFxRate.mul(e.quantity)), ZERO).div(totalQty)
    : ZERO

  const grossAbs = stockEffectJpy.abs().add(fxEffectJpy.abs())

  return {
    events,
    stockEffectJpy,
    fxEffectJpy,
    costEffectJpy,
    totalJpy,
    fxShare: grossAbs.isZero() ? null : fxEffectJpy.abs().div(grossAbs).toNumber(),
    avgEntryFx,
    avgExitFx,
  }
}

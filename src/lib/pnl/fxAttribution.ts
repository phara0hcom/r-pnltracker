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
export function attributeOne(close: RealizedEvent): FxAttribution {
  // Named after the module header's notation: P₀/P₁ are entry and exit price,
  // R₀/R₁ the matching FX rates.
  const quantity = close.quantity
  const entryPrice = close.entryPriceNative
  const exitPrice = close.exitPriceNative
  const entryRate = close.entryFxRate
  const exitRate = close.exitFxRate

  const stockEffectJpy = exitPrice.sub(entryPrice).mul(exitRate).mul(quantity)
  const fxEffectJpy = entryPrice.mul(exitRate.sub(entryRate)).mul(quantity)
  const grossJpy = stockEffectJpy.add(fxEffectJpy)
  // Residual — mostly transaction cost and rounding, plus the averaging
  // cross-term when the pool was built at more than one price/rate.
  const costEffectJpy = close.realizedJpy.sub(grossJpy)

  return {
    symbol: close.symbol,
    name: close.name,
    accountType: close.accountType,
    tradeDate: close.tradeDate,
    quantity,
    entryPriceUsd: entryPrice,
    exitPriceUsd: exitPrice,
    entryFxRate: entryRate,
    exitFxRate: exitRate,
    stockEffectJpy,
    fxEffectJpy,
    costEffectJpy,
    totalJpy: close.realizedJpy,
    totalUsd: exitPrice.sub(entryPrice).mul(quantity),
  }
}

/**
 * Portfolio-level attribution across every US close.
 *
 * JP equities and funds are excluded — they are natively JPY, so a currency
 * split is meaningless and would dilute the figure with structural zeros.
 */
export function attributeFx(realized: RealizedEvent[]): FxAttributionSummary {
  const events = realized.filter((close) => close.assetClass === 'US_EQUITY').map(attributeOne)

  const sumOf = (pick: (event: FxAttribution) => Decimal) =>
    events.reduce((running, event) => running.add(pick(event)), ZERO)

  const stockEffectJpy = sumOf((event) => event.stockEffectJpy)
  const fxEffectJpy = sumOf((event) => event.fxEffectJpy)
  const costEffectJpy = sumOf((event) => event.costEffectJpy)
  const totalJpy = sumOf((event) => event.totalJpy)

  // Weighted by quantity: a 100-share close should move the average rate more
  // than a 1-share close did.
  const totalQuantity = sumOf((event) => event.quantity)
  const weightedRate = (pick: (event: FxAttribution) => Decimal) =>
    totalQuantity.gt(0)
      ? sumOf((event) => pick(event).mul(event.quantity)).div(totalQuantity)
      : ZERO

  const avgEntryFx = weightedRate((event) => event.entryFxRate)
  const avgExitFx = weightedRate((event) => event.exitFxRate)

  // Absolute, so a gain and an offsetting loss do not cancel into a zero
  // denominator and report currency as explaining none of the movement.
  const grossAbsolute = stockEffectJpy.abs().add(fxEffectJpy.abs())

  return {
    events,
    stockEffectJpy,
    fxEffectJpy,
    costEffectJpy,
    totalJpy,
    fxShare: grossAbsolute.isZero() ? null : fxEffectJpy.abs().div(grossAbsolute).toNumber(),
    avgEntryFx,
    avgExitFx,
  }
}

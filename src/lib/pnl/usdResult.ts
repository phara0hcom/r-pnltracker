/**
 * How a US close is shown: in dollars, on price alone.
 *
 * The yen figure on a `RealizedEvent` is the tax one — every trade converted at
 * its own day's rate — so a weaker yen can turn a dollar gain into a loss. A
 * position traded and settled in dollars is judged the way its owner works it
 * out: (sell price − average buy price) × shares. Commission is left out of
 * that headline because it is on every row in the Fee column already; the
 * figure after it on both sides is carried as `netUsd`.
 */
import Decimal from 'decimal.js'
import type { RealizedEvent } from './engine'

export interface UsdResult {
  /** (exit price − average entry price) × quantity, before commission. */
  gainUsd: string
  /** Average entry price × quantity — the denominator for `returnPct`. */
  costUsd: string
  /** After commission on both sides: what the dollar balance actually moved by. */
  netUsd: string
  /** `gainUsd` at the latest stored USD/JPY. Null when no rate has been fetched. */
  gainJpyNow: string | null
  /** The rate `gainJpyNow` used. */
  usdJpy: string | null
  returnPct: number | null
}

/** Whole yen, rounded the way every JPY figure in the engine is. */
const toYen = (value: Decimal): Decimal => value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP)

/** Null for anything that is not a US close. */
export function usdResult(close: RealizedEvent, liveFx: Decimal | null): UsdResult | null {
  if (close.assetClass !== 'US_EQUITY') return null
  const cost = close.entryPriceNative.mul(close.quantity)
  const gain = close.exitPriceNative.mul(close.quantity).sub(cost)
  return {
    gainUsd: gain.toFixed(2),
    costUsd: cost.toFixed(2),
    netUsd: close.realizedNative.toFixed(2),
    gainJpyNow: liveFx ? toYen(gain.mul(liveFx)).toFixed(0) : null,
    usdJpy: liveFx ? liveFx.toFixed(2) : null,
    returnPct: cost.gt(0) ? gain.div(cost).toNumber() : null,
  }
}

/**
 * A close with its yen figures replaced by what the performance screens show.
 *
 * A US close becomes its price-only dollar result — and the dollar cost it is
 * measured against — at the latest USD/JPY, so the dashboard and calendar
 * total the figure the rows display rather than the tax one, which a weaker
 * yen can turn negative. Everything else passes through unchanged, as does a
 * US close while no rate has ever been fetched.
 *
 * For performance totals only. Tax, NISA quota and the stock/currency split
 * must keep reading the engine's own events.
 */
export function asShown(close: RealizedEvent, liveFx: Decimal | null): RealizedEvent {
  if (close.assetClass !== 'US_EQUITY' || !liveFx) return close
  const cost = close.entryPriceNative.mul(close.quantity)
  const gain = close.exitPriceNative.mul(close.quantity).sub(cost)
  return { ...close, realizedJpy: toYen(gain.mul(liveFx)), costJpy: toYen(cost.mul(liveFx)) }
}

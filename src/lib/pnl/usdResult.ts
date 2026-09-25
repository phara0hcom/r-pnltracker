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
import type Decimal from 'decimal.js'
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

/** Null for anything that is not a US close. */
export function usdResult(close: RealizedEvent, liveFx: Decimal | null): UsdResult | null {
  if (close.assetClass !== 'US_EQUITY') return null
  const cost = close.entryPriceNative.mul(close.quantity)
  const gain = close.exitPriceNative.mul(close.quantity).sub(cost)
  return {
    gainUsd: gain.toFixed(2),
    costUsd: cost.toFixed(2),
    netUsd: close.realizedNative.toFixed(2),
    gainJpyNow: liveFx ? gain.mul(liveFx).toFixed(0) : null,
    usdJpy: liveFx ? liveFx.toFixed(2) : null,
    returnPct: cost.gt(0) ? gain.div(cost).toNumber() : null,
  }
}

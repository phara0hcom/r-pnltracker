/**
 * How a US close is shown: in dollars, the way Rakuten's 実現損益 screen shows it.
 *
 * Sell price × shares, less what those shares cost *including* the buy
 * commission. The sell-side commission is not taken off: Rakuten's dollar
 * figure leaves it out, and all nine US closes of September 2026 reproduce
 * that screen to the cent this way (−$818.86 in total) and in no other. The
 * figure after commission on both sides is carried as `netUsd`.
 *
 * Beside it, in brackets as Rakuten puts it, goes the yen result — the
 * engine's own figure, every trade at its own day's rate, so it carries the
 * currency move and both commissions. That is the one totals add up across
 * markets. Rakuten's bracketed yen converts by a method no export discloses
 * and lands a few percent from it; the dollar figure is the one that matches.
 */
import type Decimal from 'decimal.js'
import type { RealizedEvent } from './engine'

export interface UsdResult {
  /** Sell price × shares − cost of those shares, buy commission included. */
  gainUsd: string
  /** Cost of the shares sold, buy commission included — the denominator for `returnPct`. */
  costUsd: string
  /** After commission on both sides: what the dollar balance actually moved by. */
  netUsd: string
  /** The yen result including the currency move — the engine's figure. */
  gainJpy: string
  returnPct: number | null
}

/**
 * The dollar result of a US close, as a number to add up.
 *
 * The sale side is the broker's own 約定代金, already rounded to the cent as
 * Rakuten rounds it, scaled down only if the engine clamped the quantity.
 * `costNative` is the pool's dollar cost of exactly these shares and already
 * holds the buy commission.
 */
export function usdGain(close: RealizedEvent): Decimal {
  const { trade } = close
  const sale = trade.quantity.eq(close.quantity)
    ? trade.grossAmount
    : trade.grossAmount.mul(close.quantity).div(trade.quantity)
  return sale.sub(close.costNative)
}

/** Null for anything that is not a US close. */
export function usdResult(close: RealizedEvent): UsdResult | null {
  if (close.assetClass !== 'US_EQUITY') return null
  const gain = usdGain(close)
  return {
    gainUsd: gain.toFixed(2),
    costUsd: close.costNative.toFixed(2),
    netUsd: close.realizedNative.toFixed(2),
    gainJpy: close.realizedJpy.toFixed(0),
    returnPct: close.costNative.gt(0) ? gain.div(close.costNative).toNumber() : null,
  }
}

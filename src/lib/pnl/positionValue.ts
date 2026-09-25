/**
 * What an open position is worth, and what it is up or down.
 *
 * A US holding is judged in dollars, as its closes are (see `usdResult.ts`): a
 * weaker yen since the buy is not a loss on shares that rose. Its yen figures
 * are then that dollar result at one rate — the latest USD/JPY — so value,
 * cost and unrealized add up on the row. The taxable figure, which does carry
 * the currency move, is kept beside it.
 */
import Decimal from 'decimal.js'
import type { PositionState } from './engine'

export interface PositionValue {
  /** Null when there is no price — the app never invents a valuation. */
  marketValueJpy: string | null
  /** For a US position, `marketValueJpy − costShownJpy`. */
  unrealizedJpy: string | null
  /** In dollars for a US position. */
  unrealizedPct: number | null
  /** The yen cost basis, or for a US position its dollar cost at `usdJpy`. */
  costShownJpy: string
  /** Average buy price × quantity. US positions only, as are the next four. */
  costUsd: string | null
  marketValueUsd: string | null
  /** (price − average buy price) × quantity, before commission. */
  unrealizedUsd: string | null
  /** Value at `usdJpy` minus the yen paid at each buy's own rate. */
  unrealizedTaxJpy: string | null
  usdJpy: string | null
}

export function valuePosition(
  position: PositionState,
  currentPrice: string | null,
  liveFx: Decimal | null,
): PositionValue {
  const isUsd = position.assetClass === 'US_EQUITY'
  // The entry rate stands in only until a rate has ever been fetched; it makes
  // the currency component read as zero, which is wrong but at least not
  // invented.
  const rate = isUsd ? (liveFx ?? position.avgFxRate) : new Decimal(1)
  const costUsd = isUsd ? position.avgPriceNative.mul(position.quantity) : null
  const costShown = costUsd ? costUsd.mul(rate) : position.costBasisJpy

  const base: PositionValue = {
    marketValueJpy: null,
    unrealizedJpy: null,
    unrealizedPct: null,
    costShownJpy: costShown.toFixed(0),
    costUsd: costUsd?.toFixed(2) ?? null,
    marketValueUsd: null,
    unrealizedUsd: null,
    unrealizedTaxJpy: null,
    usdJpy: isUsd ? rate.toFixed(2) : null,
  }
  if (!currentPrice) return base

  const valueNative = new Decimal(currentPrice).mul(position.quantity)
  const marketValue = valueNative.mul(rate)

  if (!costUsd) {
    const gain = marketValue.sub(position.costBasisJpy)
    return {
      ...base,
      marketValueJpy: marketValue.toFixed(0),
      unrealizedJpy: gain.toFixed(0),
      unrealizedPct: position.costBasisJpy.gt(0) ? gain.div(position.costBasisJpy).toNumber() : null,
    }
  }

  const gainUsd = valueNative.sub(costUsd)
  return {
    ...base,
    marketValueJpy: marketValue.toFixed(0),
    // Differenced in whole yen, so the row's three yen figures add up exactly
    // rather than to within a rounding.
    unrealizedJpy: marketValue.round().sub(costShown.round()).toFixed(0),
    unrealizedPct: costUsd.gt(0) ? gainUsd.div(costUsd).toNumber() : null,
    marketValueUsd: valueNative.toFixed(2),
    unrealizedUsd: gainUsd.toFixed(2),
    unrealizedTaxJpy: marketValue.sub(position.costBasisJpy).toFixed(0),
  }
}

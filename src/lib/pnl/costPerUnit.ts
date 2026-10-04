/**
 * What each unit of a close cost: the figure its shown result is measured
 * against.
 *
 * Not the average buy *price* (`entryPriceNative`). That leaves out the buy
 * commission and, for a Japanese stock, the round-up to the whole yen that
 * Rakuten applies to the average — so the calendar, which showed it as "avg
 * cost", set beside each sale a figure that quantity × (price − avg cost) did
 * not reproduce. It differed from this on 30 of 34 JP and 41 of 46 US closes
 * in the real history.
 *
 * In dollars for a US close, whose result is shown in dollars (`usdResult`);
 * in yen for anything else, as its result is. For a yen holding this is the
 * figure Positions shows as Avg cost. A US holding's Avg cost there is its buy
 * price, because its unrealized is judged on price, before commission. A
 * fund's is per single 口 — show it through `quotedPrice`.
 */
import type Decimal from 'decimal.js'
import type { RealizedEvent } from './engine'

export function costPerUnit(close: RealizedEvent): Decimal {
  const cost = close.assetClass === 'US_EQUITY' ? close.costNative : close.costJpy
  return cost.div(close.quantity)
}

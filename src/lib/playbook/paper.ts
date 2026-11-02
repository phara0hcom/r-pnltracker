/**
 * A paper position's result, from its typed-in legs.
 *
 * Moving-average cost, as the engine uses for real trades, but computed here:
 * a paper trade never reaches the engine or any figure outside the Playbook.
 * The yen average is kept exact rather than rounded up per day as a real JP
 * pool's is — nothing on a paper trade is checked against a broker.
 */
import type Decimal from 'decimal.js'
import { ZERO } from '../domain/types'
import type { LegSide, PositionStatus } from './types'

export interface PaperLeg {
  side: LegSide
  date: string
  executedAt: Date | null
  price: Decimal
  quantity: Decimal
  fee: Decimal
}

export interface PaperResult {
  sharesBought: Decimal
  sharesSold: Decimal
  sharesHeld: Decimal
  /** Weighted average of the entry prices, fees excluded — the R baseline. */
  entryPrice: Decimal | null
  /** Native currency, net of fees on both sides. */
  realized: Decimal
  /** Cost of the units closed, fees included. */
  costClosed: Decimal
  /** realized ÷ costClosed; null before anything is closed. */
  returnPct: Decimal | null
}

/** Date, then time where both have one, then entries before exits. */
function chronological(left: PaperLeg, right: PaperLeg): number {
  if (left.date !== right.date) return left.date < right.date ? -1 : 1
  if (left.executedAt && right.executedAt) return left.executedAt.getTime() - right.executedAt.getTime()
  return (left.side === 'ENTRY' ? 0 : 1) - (right.side === 'ENTRY' ? 0 : 1)
}

export function paperResult(legs: readonly PaperLeg[]): PaperResult {
  let held = ZERO
  let cost = ZERO
  let bought = ZERO
  let sold = ZERO
  let paid = ZERO
  let realized = ZERO
  let costClosed = ZERO
  for (const leg of [...legs].sort(chronological)) {
    if (leg.side === 'ENTRY') {
      held = held.add(leg.quantity)
      cost = cost.add(leg.price.mul(leg.quantity)).add(leg.fee)
      bought = bought.add(leg.quantity)
      paid = paid.add(leg.price.mul(leg.quantity))
      continue
    }
    // Clamped as the engine clamps a real sale: more than is held sells what is.
    const units = leg.quantity.gt(held) ? held : leg.quantity
    if (units.lte(0)) continue
    const share = units.div(leg.quantity)
    const unitCost = cost.div(held).mul(units)
    const proceeds = leg.price.mul(units).sub(leg.fee.mul(share))
    realized = realized.add(proceeds.sub(unitCost))
    costClosed = costClosed.add(unitCost)
    cost = cost.sub(unitCost)
    held = held.sub(units)
    sold = sold.add(units)
  }
  return {
    sharesBought: bought,
    sharesSold: sold,
    sharesHeld: held,
    entryPrice: bought.gt(0) ? paid.div(bought) : null,
    realized,
    costClosed,
    returnPct: costClosed.gt(0) ? realized.div(costClosed) : null,
  }
}

/** Open while it holds units, closed once it has sold them all. */
export function paperStatus(result: PaperResult): PositionStatus {
  return result.sharesHeld.gt(0) || result.sharesBought.lte(0) ? 'OPEN' : 'CLOSED'
}

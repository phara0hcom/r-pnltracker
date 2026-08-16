/**
 * Cost-basis and realized-P&L engine.
 *
 * Method: 移動平均法 (moving weighted average), which is what Rakuten uses for
 * 特定口座 and what Japanese tax rules require. FIFO would produce different —
 * and for filing purposes, wrong — numbers.
 *
 * Pools are keyed by (symbol × accountType). A ticker held in both 特定 and
 * NISA is two independent tax lots; commingling them would corrupt both the
 * realized P&L and the NISA quota calculation.
 *
 * Everything is tracked in JPY. For US positions the weighted-average entry FX
 * rate is carried alongside the cost basis so realized P&L can later be split
 * into stock movement vs currency movement (see fxAttribution.ts).
 */
import Decimal from 'decimal.js'
import {
  CLOSING_SIDES,
  OPENING_SIDES,
  ZERO,
  type AccountType,
  type AssetClass,
  type NormalizedTrade,
} from '../domain/types'

// Average cost per unit is a division, and fund positions run to 7 significant
// digits, so the default 20-digit precision leaves visible artefacts in the
// last places — and makes summation order affect the result. 40 digits keeps
// intermediate values exact enough that grouping never changes a total.
Decimal.set({ precision: 40 })

/** Realized P&L is booked in whole yen, like every other JPY figure. */
const toYen = (d: Decimal): Decimal => d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP)

export interface PositionState {
  symbol: string
  name: string
  assetClass: AssetClass
  accountType: AccountType
  /** Units currently held. */
  quantity: Decimal
  /** Total JPY acquisition cost of those units. */
  costBasisJpy: Decimal
  /** Quantity-weighted average entry FX rate (1 for JPY instruments). */
  avgFxRate: Decimal
  /** Quantity-weighted average entry price in the instrument's native currency. */
  avgPriceNative: Decimal
}

/** One closing trade, with everything needed for tax, stats, and attribution. */
export interface RealizedEvent {
  tradeDate: string
  settleDate: string
  symbol: string
  name: string
  assetClass: AssetClass
  accountType: AccountType
  quantity: Decimal
  /** Net JPY received. */
  proceedsJpy: Decimal
  /** JPY cost of exactly the units sold. */
  costJpy: Decimal
  /** proceeds − cost. */
  realizedJpy: Decimal
  /** Weighted-average entry price, native currency. */
  entryPriceNative: Decimal
  exitPriceNative: Decimal
  /** Weighted-average entry FX; 1 for JPY instruments. */
  entryFxRate: Decimal
  exitFxRate: Decimal
  /** Quantity-weighted mean acquisition date of the units sold. */
  avgEntryDate: string
  holdingDays: number
  isTaxable: boolean
}

export interface EngineResult {
  positions: PositionState[]
  realized: RealizedEvent[]
  /** Rows that could not be processed — e.g. a sell with no matching position. */
  warnings: EngineWarning[]
}

export interface EngineWarning {
  tradeDate: string
  symbol: string
  accountType: AccountType
  message: string
}

interface Pool extends PositionState {
  /** Running Σ(qty × entryDateEpochDays), for weighted mean holding period. */
  weightedDateSum: Decimal
}

const poolKey = (symbol: string, account: AccountType) => `${symbol}\0${account}`

const toEpochDays = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000)

const fromEpochDays = (days: number): string =>
  new Date(Math.round(days) * 86_400_000).toISOString().slice(0, 10)

/**
 * Chronological ordering with a deliberate tie-break.
 *
 * Same-day round trips exist in the data (8411 bought and sold on 2026-07-29).
 * Without forcing opens ahead of closes on the same date, the sell can be
 * processed against a position that does not exist yet and the whole pool goes
 * negative. Ordering by trade date, then opens-first, then original file order.
 */
export function sortTradesForEngine(trades: NormalizedTrade[]): NormalizedTrade[] {
  return trades
    // The original index is carried alongside so the sort stays stable: equal
    // keys fall back to file order rather than an arbitrary engine ordering.
    .map((trade, fileOrder) => ({ trade, fileOrder }))
    .sort((left, right) => {
      if (left.trade.tradeDate !== right.trade.tradeDate)
        return left.trade.tradeDate < right.trade.tradeDate ? -1 : 1
      const leftOpens = OPENING_SIDES.includes(left.trade.side) ? 0 : 1
      const rightOpens = OPENING_SIDES.includes(right.trade.side) ? 0 : 1
      if (leftOpens !== rightOpens) return leftOpens - rightOpens
      return left.fileOrder - right.fileOrder
    })
    .map(({ trade }) => trade)
}

export function runEngine(trades: NormalizedTrade[]): EngineResult {
  const pools = new Map<string, Pool>()
  const realized: RealizedEvent[] = []
  const warnings: EngineWarning[] = []

  for (const trade of sortTradesForEngine(trades)) {
    const key = poolKey(trade.symbol, trade.accountType)
    let pool = pools.get(key)

    if (OPENING_SIDES.includes(trade.side)) {
      if (!pool) {
        pool = {
          symbol: trade.symbol,
          name: trade.name,
          assetClass: trade.assetClass,
          accountType: trade.accountType,
          quantity: ZERO,
          costBasisJpy: ZERO,
          avgFxRate: trade.fxRate,
          avgPriceNative: ZERO,
          weightedDateSum: ZERO,
        }
        pools.set(key, pool)
      }

      const newQty = pool.quantity.add(trade.quantity)
      // REINVEST carries a real acquisition cost (the distribution rolled in),
      // so it increases basis exactly like a cash buy.
      pool.costBasisJpy = pool.costBasisJpy.add(trade.netAmountJpy)
      pool.avgFxRate = weightedAvg(pool.avgFxRate, pool.quantity, trade.fxRate, trade.quantity, newQty)
      pool.avgPriceNative = weightedAvg(
        pool.avgPriceNative,
        pool.quantity,
        trade.unitPrice,
        trade.quantity,
        newQty,
      )
      pool.weightedDateSum = pool.weightedDateSum.add(trade.quantity.mul(toEpochDays(trade.tradeDate)))
      pool.quantity = newQty
      continue
    }

    if (!CLOSING_SIDES.includes(trade.side)) continue

    if (!pool || pool.quantity.lte(0)) {
      warnings.push({
        tradeDate: trade.tradeDate,
        symbol: trade.symbol,
        accountType: trade.accountType,
        message: 'close with no open position — trade history may be incomplete',
      })
      continue
    }

    // Guard against selling more than held (data gaps before the export window).
    let qty = trade.quantity
    if (qty.gt(pool.quantity)) {
      warnings.push({
        tradeDate: trade.tradeDate,
        symbol: trade.symbol,
        accountType: trade.accountType,
        message: `close qty ${qty.toFixed()} exceeds held ${pool.quantity.toFixed()} — clamped`,
      })
      qty = pool.quantity
    }

    const avgCostPerUnit = pool.costBasisJpy.div(pool.quantity)
    // Round to whole yen: the division above is exact only by luck, and leaving
    // fractions here propagates them into realized P&L, tax and daily totals.
    const costJpy = toYen(avgCostPerUnit.mul(qty))
    // Scale proceeds if the quantity was clamped, so P&L stays consistent.
    const proceedsJpy = toYen(
      trade.quantity.eq(qty) ? trade.netAmountJpy : trade.netAmountJpy.mul(qty).div(trade.quantity),
    )

    const avgEntryDays = pool.weightedDateSum.div(pool.quantity)
    const avgEntryDate = fromEpochDays(avgEntryDays.toNumber())

    realized.push({
      tradeDate: trade.tradeDate,
      settleDate: trade.settleDate,
      symbol: trade.symbol,
      name: trade.name || pool.name,
      assetClass: trade.assetClass,
      accountType: trade.accountType,
      quantity: qty,
      proceedsJpy,
      costJpy,
      realizedJpy: proceedsJpy.sub(costJpy),
      entryPriceNative: pool.avgPriceNative,
      exitPriceNative: trade.unitPrice,
      entryFxRate: pool.avgFxRate,
      exitFxRate: trade.fxRate,
      avgEntryDate,
      holdingDays: Math.max(0, toEpochDays(trade.tradeDate) - Math.round(avgEntryDays.toNumber())),
      isTaxable: trade.accountType === 'SPECIFIC',
    })

    // Reduce the pool proportionally; average cost per unit is unchanged by a sale.
    const remaining = pool.quantity.sub(qty)
    pool.weightedDateSum = remaining.isZero()
      ? ZERO
      : pool.weightedDateSum.mul(remaining).div(pool.quantity)
    pool.costBasisJpy = pool.costBasisJpy.sub(costJpy)
    pool.quantity = remaining
    if (remaining.isZero()) {
      pool.costBasisJpy = ZERO
      pool.avgPriceNative = ZERO
    }
  }

  const positions = [...pools.values()]
    .filter((position) => position.quantity.gt(0))
    .map(({ weightedDateSum: _drop, ...rest }) => rest)

  return { positions, realized, warnings }
}

/** Quantity-weighted average of two values. Returns `next` when the total is zero. */
function weightedAvg(
  prev: Decimal,
  prevQty: Decimal,
  next: Decimal,
  nextQty: Decimal,
  total: Decimal,
): Decimal {
  if (total.lte(0)) return next
  if (prevQty.lte(0)) return next
  return prev.mul(prevQty).add(next.mul(nextQty)).div(total)
}

/** Total realized P&L, optionally filtered. */
export function totalRealized(
  events: RealizedEvent[],
  filter?: (e: RealizedEvent) => boolean,
): Decimal {
  return events
    .filter((close) => filter?.(close) ?? true)
    .reduce((running, close) => running.add(close.realizedJpy), new Decimal(0))
}

/**
 * Group realized events by settlement-date year.
 *
 * Tax attribution is on 受渡日, not 約定日 — a trade executed in December and
 * settling in January belongs to the later tax year. Confirmed against 楽天証券
 * and 国税庁 guidance.
 */
export function bySettlementYear(events: RealizedEvent[]): Map<number, RealizedEvent[]> {
  const out = new Map<number, RealizedEvent[]>()
  for (const close of events) {
    const year = Number(close.settleDate.slice(0, 4))
    const list = out.get(year)
    if (list) list.push(close)
    else out.set(year, [close])
  }
  return out
}

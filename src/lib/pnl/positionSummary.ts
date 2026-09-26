/**
 * The Positions screen's totals: the whole book, each account, each asset
 * class, every row's share of the book, and the three holdings worth naming.
 *
 * Summed here, from the exact decimal strings `valuePosition` produced, so the
 * screen only renders — it used to rebuild these from floats in the browser,
 * the one place the UI did financial arithmetic.
 *
 * A holding with no price has a cost and nothing else. It counts towards cost
 * and the number of positions, and is left out of value, unrealized, weights
 * and percentages: a percentage over a cost that includes an unvalued holding
 * reads as a loss that is not there.
 */
import Decimal from 'decimal.js'
import type { AccountType, AssetClass } from '../domain/types'

export interface SummaryInput {
  symbol: string
  name: string
  assetClass: AssetClass
  accountType: AccountType
  /** The yen cost the row shows — for a US holding its dollar cost at today's rate. */
  costShownJpy: string
  marketValueJpy: string | null
  unrealizedJpy: string | null
  unrealizedPct: number | null
}

export interface PositionTotal {
  count: number
  /** Positions with no price, left out of every figure but cost. */
  unpriced: number
  costShownJpy: string
  /** The part of `costShownJpy` that has no value beside it. */
  unpricedCostJpy: string
  marketValueJpy: string
  unrealizedJpy: string
  /** Unrealized over the cost of the priced positions. Null when none is priced. */
  unrealizedPct: number | null
  /** Share of the whole book's value. Null when nothing is priced. */
  weight: number | null
}

export interface AccountTotal extends PositionTotal {
  accountType: AccountType
}

export interface ClassTotal {
  assetClass: AssetClass
  marketValueJpy: string
  weight: number | null
}

export interface Highlight {
  symbol: string
  name: string
  assetClass: AssetClass
  accountType: AccountType
  weight: number | null
  unrealizedPct: number | null
}

export interface PositionSummary {
  total: PositionTotal
  /** Largest value first. */
  accounts: AccountTotal[]
  /** Largest value first; classes with nothing priced are left out. */
  classes: ClassTotal[]
  /** Each row's share of the book's value, by input index. */
  weights: (number | null)[]
  highlights: {
    largest: Highlight | null
    best: Highlight | null
    /**
     * The lowest return — named "weakest" because it need not be a loss. Null
     * with fewer than two to rank, where it would only repeat `best`.
     */
    weakest: Highlight | null
  }
}

const ZERO = new Decimal(0)

const isPriced = (row: SummaryInput): row is SummaryInput & { marketValueJpy: string; unrealizedJpy: string } =>
  row.marketValueJpy != null && row.unrealizedJpy != null

function totalOf(rows: readonly SummaryInput[], bookValue: Decimal): PositionTotal {
  let cost = ZERO
  let pricedCost = ZERO
  let value = ZERO
  let unrealized = ZERO
  let priced = 0
  for (const row of rows) {
    cost = cost.add(row.costShownJpy)
    if (!isPriced(row)) continue
    priced++
    pricedCost = pricedCost.add(row.costShownJpy)
    value = value.add(row.marketValueJpy)
    unrealized = unrealized.add(row.unrealizedJpy)
  }
  return {
    count: rows.length,
    unpriced: rows.length - priced,
    costShownJpy: cost.toFixed(0),
    unpricedCostJpy: cost.sub(pricedCost).toFixed(0),
    marketValueJpy: value.toFixed(0),
    unrealizedJpy: unrealized.toFixed(0),
    unrealizedPct: pricedCost.gt(0) ? unrealized.div(pricedCost).toNumber() : null,
    weight: bookValue.gt(0) ? value.div(bookValue).toNumber() : null,
  }
}

export function summarizePositions(rows: readonly SummaryInput[]): PositionSummary {
  const bookValue = rows.reduce((running, row) => (isPriced(row) ? running.add(row.marketValueJpy) : running), ZERO)
  const shareOf = (value: string | null) =>
    value == null || !bookValue.gt(0) ? null : new Decimal(value).div(bookValue).toNumber()

  const byAccount = new Map<AccountType, SummaryInput[]>()
  for (const row of rows) {
    const list = byAccount.get(row.accountType)
    if (list) list.push(row)
    else byAccount.set(row.accountType, [row])
  }
  const accounts = [...byAccount]
    .map(([accountType, list]) => ({ accountType, ...totalOf(list, bookValue) }))
    // Largest first; an account holding only unpriced positions goes by cost.
    .sort(
      (left, right) =>
        new Decimal(right.marketValueJpy).cmp(left.marketValueJpy) ||
        new Decimal(right.costShownJpy).cmp(left.costShownJpy),
    )

  const byClass = new Map<AssetClass, Decimal>()
  for (const row of rows) {
    if (!isPriced(row)) continue
    byClass.set(row.assetClass, (byClass.get(row.assetClass) ?? ZERO).add(row.marketValueJpy))
  }
  const classes = [...byClass]
    .filter(([, value]) => value.gt(0))
    .sort(([, left], [, right]) => right.cmp(left))
    .map(([assetClass, value]) => ({
      assetClass,
      marketValueJpy: value.toFixed(0),
      weight: bookValue.gt(0) ? value.div(bookValue).toNumber() : null,
    }))

  const highlight = (row: SummaryInput | undefined): Highlight | null =>
    row
      ? {
          symbol: row.symbol,
          name: row.name,
          assetClass: row.assetClass,
          accountType: row.accountType,
          weight: shareOf(row.marketValueJpy),
          unrealizedPct: row.unrealizedPct,
        }
      : null
  const priced = rows.filter(isPriced)
  const withReturn = priced.filter((row) => row.unrealizedPct != null)
  const largest = priced.reduce<SummaryInput | undefined>(
    (best, row) => (!best || new Decimal(row.marketValueJpy).gt(best.marketValueJpy ?? 0) ? row : best),
    undefined,
  )
  const best = withReturn.reduce<SummaryInput | undefined>(
    (top, row) => (!top || (row.unrealizedPct ?? 0) > (top.unrealizedPct ?? 0) ? row : top),
    undefined,
  )
  const weakest = withReturn.reduce<SummaryInput | undefined>(
    (bottom, row) => (!bottom || (row.unrealizedPct ?? 0) < (bottom.unrealizedPct ?? 0) ? row : bottom),
    undefined,
  )

  return {
    total: totalOf(rows, bookValue),
    accounts,
    classes,
    weights: rows.map((row) => (isPriced(row) ? shareOf(row.marketValueJpy) : null)),
    highlights: {
      largest: highlight(largest),
      best: highlight(best),
      weakest: withReturn.length > 1 ? highlight(weakest) : null,
    },
  }
}

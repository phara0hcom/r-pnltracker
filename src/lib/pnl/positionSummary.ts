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
import {
  marketOf,
  MARKETS,
  type AccountFilter,
  type AccountType,
  type AssetClass,
  type Market,
  type MarketFilter,
} from '../domain/types'

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

/**
 * One block of the table: a market, an account, both, or — when the filters
 * have already narrowed the screen to one of each — neither, which is the whole
 * list with no heading. A null side is "not split on this".
 */
export interface GroupTotal extends PositionTotal {
  market: Market | null
  accountType: AccountType | null
}

/** Which axes the table is cut along. */
export interface GroupSplit {
  market: boolean
  account: boolean
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
  /**
   * The table's blocks, in display order: JP before US, then the accounts in
   * `accounts`' order — largest across the book, not re-ranked per market. Only
   * blocks holding something are present.
   */
  groups: GroupTotal[]
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

/** Whether a row belongs to a block — the client's way of filling one with rows. */
export function inGroup(
  row: Pick<SummaryInput, 'assetClass' | 'accountType'>,
  group: Pick<GroupTotal, 'market' | 'accountType'>,
): boolean {
  return (
    (group.market == null || marketOf(row.assetClass) === group.market) &&
    (group.accountType == null || row.accountType === group.accountType)
  )
}

/**
 * Which axes the table is cut along, given the two filters and what they left.
 *
 * Accounts split unless the switch is on 特定, the one taxable account. Markets
 * split only when the switch is on both *and* both are held: a book of Japanese
 * holdings alone would otherwise put one "JP stocks & funds" heading over the
 * whole table, repeating the total, and prefix every account heading with it.
 */
export function splitFor(
  rows: readonly Pick<SummaryInput, 'assetClass'>[],
  filters: { account: AccountFilter; market: MarketFilter },
): GroupSplit {
  return {
    market: filters.market === 'ALL' && new Set(rows.map((row) => marketOf(row.assetClass))).size > 1,
    account: filters.account !== 'SPECIFIC',
  }
}

/**
 * Totals for each block of the table, in display order: JP before US, and
 * within a market the accounts in `accounts`' order — largest across the whole
 * book, so the accounts read the same way under JP as under US rather than each
 * market ranking them afresh.
 *
 * Summed here, not by the screen, for the reason the rest of this file exists:
 * a block's heading carries a total, and adding it up in the browser is
 * financial arithmetic in the UI. Weights stay shares of the whole book shown,
 * not of the block.
 *
 * Unsplit on market, a block is an account and its totals are `accounts`' own;
 * unsplit on both, the one block is the book. Only the cross needs summing.
 */
function groupTotals(
  rows: readonly SummaryInput[],
  bookValue: Decimal,
  total: PositionTotal,
  accounts: readonly AccountTotal[],
  split: GroupSplit,
): GroupTotal[] {
  if (!split.market) {
    return split.account
      ? accounts.map((entry) => ({ ...entry, market: null }))
      : rows.length > 0
        ? [{ ...total, market: null, accountType: null }]
        : []
  }

  const accountTypes = split.account ? accounts.map((entry) => entry.accountType) : [null]
  return MARKETS.flatMap((market) => accountTypes.map((accountType) => ({ market, accountType })))
    .map((block) => ({ block, members: rows.filter((row) => inGroup(row, block)) }))
    .filter(({ members }) => members.length > 0)
    .map(({ block, members }) => ({ ...block, ...totalOf(members, bookValue) }))
}

export function summarizePositions(
  rows: readonly SummaryInput[],
  split: GroupSplit = { market: false, account: true },
): PositionSummary {
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

  const total = totalOf(rows, bookValue)
  return {
    total,
    accounts,
    groups: groupTotals(rows, bookValue, total, accounts, split),
    classes,
    weights: rows.map((row) => (isPriced(row) ? shareOf(row.marketValueJpy) : null)),
    highlights: {
      largest: highlight(largest),
      best: highlight(best),
      weakest: withReturn.length > 1 ? highlight(weakest) : null,
    },
  }
}

/** The screen's figures: every row with its weight, and the totals and blocks over them. */
export type PositionsView<R> = Omit<PositionSummary, 'weights'> & { rows: (R & { weight: number | null })[] }

/**
 * Everything the Positions screen shows about the rows a pair of filters left,
 * as `getPositions` returns it — the pure half of that handler, here so it is
 * tested as written rather than through a copy. The filters only pick the
 * blocks (`splitFor`); the rows must already be the filtered ones, which
 * `engineFor` sees to before the engine runs.
 */
export function positionsView<R extends SummaryInput>(
  rows: readonly R[],
  filters: { account: AccountFilter; market: MarketFilter },
): PositionsView<R> {
  const { weights, ...summary } = summarizePositions(rows, splitFor(rows, filters))
  return { ...summary, rows: rows.map((row, index) => ({ ...row, weight: weights[index] ?? null })) }
}

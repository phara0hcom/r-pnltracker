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

/** One market's share of a block — JP stocks and funds, or US stocks. */
export interface MarketTotal extends PositionTotal {
  market: Market
}

/**
 * One block of the table: an account, and within it each market it holds.
 *
 * Account first, because that is how the book is read — 特定 or NISA decides
 * how a holding is taxed, which matters more than the currency it is priced in.
 * `accountType` is null when the account is not split (under 特定, the one
 * taxable account), and the block is then the whole book; `markets` is empty
 * when the market is not split.
 */
export interface GroupTotal extends PositionTotal {
  accountType: AccountType | null
  /** JP before US. Only markets the block holds. */
  markets: MarketTotal[]
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
  /** The table's blocks, in `accounts`' order, each holding something. */
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

/** Whether a row belongs to a block's account. */
export function inGroup(
  row: Pick<SummaryInput, 'accountType'>,
  group: Pick<GroupTotal, 'accountType'>,
): boolean {
  return group.accountType == null || row.accountType === group.accountType
}

/** Whether a row belongs to one market's part of a block. */
export const inMarket = (row: Pick<SummaryInput, 'assetClass'>, market: Market): boolean =>
  marketOf(row.assetClass) === market

/**
 * Which axes the table is cut along, given the two filters and what they left.
 *
 * Accounts split unless the switch is on 特定, the one taxable account. Markets
 * split only when the switch is on both *and* both are held: a book of Japanese
 * holdings alone would otherwise give every account one "JP stocks & funds"
 * sub-heading repeating the account's own total.
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
 * Totals for each block of the table and each market within it.
 *
 * The blocks are the accounts, in `accounts`' order (largest across the book)
 * and with `accounts`' own totals — or, when the account is not split, one
 * block that is the book. Within each, JP before US, and only the markets that
 * block holds.
 *
 * Summed here, not by the screen, for the reason the rest of this file exists:
 * a heading carries a total, and adding it up in the browser is financial
 * arithmetic in the UI. Weights stay shares of the whole book shown.
 */
function groupTotals(
  rows: readonly SummaryInput[],
  bookValue: Decimal,
  total: PositionTotal,
  accounts: readonly AccountTotal[],
  split: GroupSplit,
): GroupTotal[] {
  const blocks: { head: PositionTotal; accountType: AccountType | null }[] = split.account
    ? accounts.map((entry) => ({ head: entry, accountType: entry.accountType }))
    : rows.length > 0
      ? [{ head: total, accountType: null }]
      : []

  return blocks.map(({ head, accountType }) => {
    const members = rows.filter((row) => inGroup(row, { accountType }))
    const markets = split.market
      ? MARKETS.map((market) => ({ market, inside: members.filter((row) => inMarket(row, market)) }))
          .filter(({ inside }) => inside.length > 0)
          .map(({ market, inside }) => ({ market, ...totalOf(inside, bookValue) }))
      : []
    return { ...head, accountType, markets }
  })
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

/**
 * Trades → TradingView's Portfolio import CSV.
 *
 * `Symbol,Side,Qty,Fill Price,Commission,Closing Time` — TradingView's own
 * shape, so the file can be uploaded straight into a portfolio rather than
 * merely read.
 *
 * Two things follow from writing for a machine rather than for Excel:
 *
 * - no byte-order mark (see `CsvEncoding`), because it would ride along into
 *   the first header cell and stop `Symbol` from matching;
 * - a row TradingView cannot resolve is worse than no row, so anything without
 *   a real TradingView symbol is dropped rather than guessed at.
 */
import { OPENING_SIDES, type AssetClass } from '../domain/types'
import { todayLocal } from '../localDate'
import { tradingViewSymbol } from '../tradingview'
import { csvDocument } from './csv'

/**
 * The fields the export reads, declared structurally so `lib` need not import
 * the server's `TradeRow` — that type satisfies this one, not the reverse.
 */
export interface TradeCsvRow {
  tradeDate: string
  symbol: string
  assetClass: AssetClass
  side: 'BUY' | 'SELL' | 'REINVEST' | 'REDEEM'
  quantity: string
  displayPrice: string
  commission: string
}

const HEADER = ['Symbol', 'Side', 'Qty', 'Fill Price', 'Commission', 'Closing Time'] as const

/**
 * 再投資 is a real fill — it adds units *and* cost basis, just with no external
 * cash — so it is a Buy, not a category of its own. 解約 (REDEEM) is a fund
 * redemption, economically a Sell. TradingView has no vocabulary for either
 * distinction and does not need one.
 */
const SIDE: Record<TradeCsvRow['side'], 'Buy' | 'Sell'> = {
  BUY: 'Buy',
  REINVEST: 'Buy',
  SELL: 'Sell',
  REDEEM: 'Sell',
}

/**
 * TradingView's `Closing Time` is a timestamp; Rakuten publishes 約定日 as a
 * date and no more. Midnight is the honest widening of a date, and matches how
 * TradingView's own example file writes an equity fill.
 *
 * The trade date, not the settlement date: this column is when the fill
 * happened. 受渡日 drives tax year and NISA framing elsewhere in the app, and
 * is the wrong answer here.
 */
const closingTime = (tradeDate: string): string => `${tradeDate} 0:00:00`

/** Opens sort ahead of closes within a day. Keyed off the domain's own list. */
const opensFirst = (side: TradeCsvRow['side']): number => (OPENING_SIDES.includes(side) ? 0 : 1)

export function tradesCsv(rows: readonly TradeCsvRow[]): string {
  // Oldest first, whatever order the screen was sorted in. An importer that
  // replays fills in file order would otherwise meet a Sell before its Buy and
  // could open a phantom short.
  //
  // The tie-break is what makes that true for a same-day round trip. Rakuten
  // dates fills to the day and no finer, so a buy and the sell that closes it
  // can be indistinguishable by date — and the rows arrive in the table's sort
  // order, which for `realizedJpy` puts every close first (realized P&L is null
  // on an open, and `sortRows` sends nulls last in both directions).
  const chronological = [...rows].sort(
    (left, right) =>
      left.tradeDate.localeCompare(right.tradeDate) || opensFirst(left.side) - opensFirst(right.side),
  )

  const body: string[][] = []
  for (const row of chronological) {
    const symbol = tradingViewSymbol(row.symbol, row.assetClass)
    // Null covers two cases, and both must be dropped: 投資信託, which
    // TradingView lists no 基準価額 series for, and the display-name
    // instruments the statement parser can mint ("ADVANCED M D INC").
    if (symbol === null) continue

    body.push([
      symbol,
      SIDE[row.side],
      row.quantity,
      // Native currency, deliberately unconverted. TradingView reads the quote
      // currency off the symbol — TSE:8411 in yen, AAPL in dollars — so a fill
      // converted to JPY would be priced against a USD chart.
      row.displayPrice,
      row.commission,
      closingTime(row.tradeDate),
    ])
  }

  return csvDocument([HEADER, ...body], 'plain')
}

/**
 * Named for its destination, not just its contents: this file is shaped for
 * TradingView and is not the one to open in a spreadsheet.
 *
 * Dated from `todayLocal`, never `toISOString`: the latter names the file with
 * yesterday's date every JST morning before 09:00.
 */
export function tradesCsvFilename(today = todayLocal()): string {
  return `trades-tradingview-${today}.csv`
}

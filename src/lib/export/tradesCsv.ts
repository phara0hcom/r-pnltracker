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

/** One line of the statement's cash ledger. */
export interface CashCsvRow {
  date: string
  /** Signed: money in is positive, out negative. The side carries the direction. */
  amount: string
  currency: 'JPY' | 'USD'
  description: string
}

/** One credited payout. */
export interface DividendCsvRow {
  payDate: string
  symbol: string
  assetClass: AssetClass
  netAmount: string
}

const HEADER = ['Symbol', 'Side', 'Qty', 'Fill Price', 'Commission', 'Closing Time'] as const

/** TradingView's pseudo-instrument for the account's own cash balance. */
const CASH_SYMBOL = '$CASH'

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

/**
 * Order within a single date.
 *
 * Rakuten dates everything to the day, so a deposit and the purchase it funded
 * are indistinguishable by date alone. An importer replaying the file in order
 * needs the cash present before it is spent and gone only after, or it reports
 * a balance that dipped negative on a day it never did.
 */
const RANK = { cashIn: 0, dividend: 1, open: 2, close: 3, cashOut: 4 } as const

/** A row plus the two keys it sorts on, before it is flattened into the file. */
interface Entry {
  date: string
  rank: number
  cells: string[]
}

/**
 * Which of TradingView's cash sides a ledger line is.
 *
 * Direction comes from the sign, not from the statement's own 入金/出金/振替
 * label: 振替 covers both directions and, in practice, four unrelated things —
 * Rakuten Cash top-ups, 譲渡益税 withheld at source, its refund when a later
 * loss offsets the gain, and one leg of an FX conversion.
 *
 * Null means the line has no place in a JPY cash balance. That is only ever a
 * non-JPY row: TradingView's `$CASH` has no currency of its own, so a USD leg
 * would be counted as though it were yen. Those rows are always one half of a
 * conversion whose JPY half is recorded separately, so dropping them loses
 * nothing and double-counting them would invent money.
 */
function cashSide(row: CashCsvRow): 'Deposit' | 'Withdrawal' | 'Taxes and fees' | null {
  if (row.currency !== 'JPY') return null
  if (row.amount.startsWith('-')) return TAX_OR_FEE.test(row.description) ? 'Taxes and fees' : 'Withdrawal'
  return Number(row.amount) === 0 ? null : 'Deposit'
}

/**
 * 譲渡益税 (capital gains withheld at source) and 手数料, which Rakuten writes
 * in katakana in the ledger. A refund (譲渡益税還付) is positive and so never
 * reaches this test — it is money in, and `Deposit` is the honest side for it.
 */
const TAX_OR_FEE = /譲渡益税|手数料|テスウリョウ/

/** Strips the sign as text. The side already carries the direction, and `Math.abs` would be float maths on money. */
const unsigned = (amount: string): string => amount.replace(/^-/, '')

export function tradesCsv(
  trades: readonly TradeCsvRow[],
  ledger: { cash?: readonly CashCsvRow[]; dividends?: readonly DividendCsvRow[] } = {},
): string {
  const entries: Entry[] = []

  for (const row of trades) {
    const symbol = tradingViewSymbol(row.symbol, row.assetClass)
    // Null covers two cases, and both must be dropped: 投資信託, which
    // TradingView lists no 基準価額 series for, and the display-name
    // instruments the statement parser can mint ("ADVANCED M D INC").
    if (symbol === null) continue

    // 再投資 is a real fill — it adds units *and* cost basis, just with no
    // external cash — so it is a Buy. 解約 (REDEEM) is a fund redemption,
    // economically a Sell. TradingView needs neither distinction.
    const opening = OPENING_SIDES.includes(row.side)
    entries.push({
      date: row.tradeDate,
      rank: opening ? RANK.open : RANK.close,
      cells: [
        symbol,
        opening ? 'Buy' : 'Sell',
        row.quantity,
        // Native currency, deliberately unconverted. TradingView reads the quote
        // currency off the symbol — TSE:8411 in yen, AAPL in dollars — so a fill
        // converted to JPY would be priced against a USD chart.
        row.displayPrice,
        row.commission,
        closingTime(row.tradeDate),
      ],
    })
  }

  for (const row of ledger.dividends ?? []) {
    // Same rule as a trade: no resolvable symbol, no row. A fund distribution
    // drops out here, and the 再投資 buy it funded drops out above — so the two
    // halves leave together and the cash balance stays consistent.
    const symbol = tradingViewSymbol(row.symbol, row.assetClass)
    if (symbol === null) continue

    entries.push({
      date: row.payDate,
      rank: RANK.dividend,
      // Net, not gross: withholding never reached the account, and the gross
      // figure would credit cash that was never there.
      cells: [symbol, 'Dividend', row.netAmount, '', '', closingTime(row.payDate)],
    })
  }

  for (const row of ledger.cash ?? []) {
    const side = cashSide(row)
    if (side === null) continue

    entries.push({
      date: row.date,
      rank: side === 'Deposit' ? RANK.cashIn : RANK.cashOut,
      cells: [CASH_SYMBOL, side, unsigned(row.amount), '', '', closingTime(row.date)],
    })
  }

  // Oldest first, whatever order the screen was sorted in. An importer that
  // replays fills in file order would otherwise meet a Sell before its Buy and
  // could open a phantom short.
  entries.sort((left, right) => left.date.localeCompare(right.date) || left.rank - right.rank)

  return csvDocument([HEADER, ...entries.map((entry) => entry.cells)], 'plain')
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

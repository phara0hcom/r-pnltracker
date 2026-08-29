/**
 * The rules worth guarding all come from TradingView being a machine, not a
 * reader: the header must match byte for byte, an unresolvable symbol is worse
 * than a missing row, and fills replayed out of order can open a phantom short.
 */
import { describe, expect, it } from 'vitest'
import { todayLocal } from '../localDate'
import { tradesCsv, tradesCsvFilename, type TradeCsvRow } from './tradesCsv'

const trade = (over: Partial<TradeCsvRow> = {}): TradeCsvRow => ({
  tradeDate: '2026-03-14',
  symbol: '8411',
  assetClass: 'JP_EQUITY',
  side: 'BUY',
  quantity: '300',
  displayPrice: '2510',
  commission: '55',
  ...over,
})

const lines = (csv: string) => csv.trimEnd().split('\r\n')

describe('tradesCsv', () => {
  it("writes TradingView's header exactly", () => {
    expect(lines(tradesCsv([]))[0]).toBe('Symbol,Side,Qty,Fill Price,Commission,Closing Time')
  })

  it('carries no byte-order mark, which would corrupt the first header cell', () => {
    // The positions CSV needs a BOM for Excel; this one is parsed, not read.
    expect(tradesCsv([trade()]).startsWith('﻿')).toBe(false)
  })

  it('prefixes JP equities with the 東証 venue and leaves US tickers bare', () => {
    const output = lines(tradesCsv([trade(), trade({ symbol: 'AAPL', assetClass: 'US_EQUITY' })]))
    expect(output[1]).toMatch(/^TSE:8411,/)
    expect(output[2]).toMatch(/^AAPL,/)
  })

  it('maps 再投資 to Buy and 解約 to Sell', () => {
    // Both are real fills; TradingView has no vocabulary for the distinction.
    const output = lines(
      tradesCsv([
        trade({ side: 'REINVEST', tradeDate: '2026-01-01' }),
        trade({ side: 'REDEEM', tradeDate: '2026-01-02' }),
        trade({ side: 'SELL', tradeDate: '2026-01-03' }),
      ]),
    )
    expect(output[1]).toContain(',Buy,')
    expect(output[2]).toContain(',Sell,')
    expect(output[3]).toContain(',Sell,')
  })

  it('drops funds, which TradingView lists no 基準価額 series for', () => {
    const csv = tradesCsv([
      trade(),
      trade({ symbol: 'eMAXIS Slim 米国株式(S&P500)', assetClass: 'FUND' }),
    ])
    expect(lines(csv)).toHaveLength(2)
    expect(csv).not.toContain('eMAXIS')
  })

  it('drops display-name instruments rather than emitting a row that cannot resolve', () => {
    // The statement parser can mint these; TradingView would fail the import.
    const csv = tradesCsv([trade({ symbol: 'ADVANCED M D INC', assetClass: 'US_EQUITY' })])
    expect(lines(csv)).toHaveLength(1)
  })

  it('writes fills oldest-first regardless of the order it is given', () => {
    // A Sell replayed before its Buy could open a phantom short.
    const output = lines(
      tradesCsv([
        trade({ tradeDate: '2026-06-02', side: 'SELL' }),
        trade({ tradeDate: '2026-03-14', side: 'BUY' }),
      ]),
    )
    expect(output[1]).toContain('2026-03-14')
    expect(output[2]).toContain('2026-06-02')
  })

  it('puts an open ahead of the close it funds on the same day', () => {
    // Rakuten dates fills to the day only, so date alone cannot separate a
    // same-day round trip. The input here is the order the table hands over when
    // sorted by realized P&L: closes first, because realizedJpy is null on opens
    // and sortRows sends nulls last in both directions.
    const output = lines(
      tradesCsv([
        trade({ tradeDate: '2026-06-15', side: 'SELL', displayPrice: '3120' }),
        trade({ tradeDate: '2026-06-15', side: 'BUY', displayPrice: '2510' }),
      ]),
    )
    expect(output[1]).toContain(',Buy,')
    expect(output[2]).toContain(',Sell,')
  })

  it('widens the trade date to midnight, as the template does', () => {
    expect(lines(tradesCsv([trade()]))[1]?.endsWith(',2026-03-14 0:00:00')).toBe(true)
  })

  it('writes native prices, not yen-converted ones', () => {
    // TradingView reads the quote currency off the symbol, so a USD fill
    // converted to JPY would be priced against a USD chart.
    const [, row = ''] = lines(
      tradesCsv([
        trade({ symbol: 'AAPL', assetClass: 'US_EQUITY', quantity: '12', displayPrice: '182.45' }),
      ]),
    )
    expect(row).toBe('AAPL,Buy,12,182.45,55,2026-03-14 0:00:00')
  })

  it('emits a header-only file when every row is unexportable', () => {
    expect(lines(tradesCsv([trade({ assetClass: 'FUND' })]))).toHaveLength(1)
  })

  it('converts a space-separated share class to the dot notation TradingView wants', () => {
    // Rakuten exports Berkshire class B as "BRK B".
    const csv = tradesCsv([trade({ symbol: 'BRK B', assetClass: 'US_EQUITY' })])
    expect(lines(csv)[1]).toMatch(/^BRK\.B,/)
  })
})

describe('tradesCsvFilename', () => {
  it('names the file for its destination, not its contents', () => {
    expect(tradesCsvFilename('2026-08-29')).toBe('trades-tradingview-2026-08-29.csv')
  })

  it('defaults to the local calendar date, not the UTC one', () => {
    // Guards against someone reaching for `toISOString()`, which for JST names
    // the file with yesterday's date every morning before 09:00.
    expect(tradesCsvFilename()).toBe(`trades-tradingview-${todayLocal()}.csv`)
  })
})

describe('tradesCsv cash ledger', () => {
  const cash = (over = {}) => ({
    date: '2026-02-02',
    amount: '499979',
    currency: 'JPY' as const,
    description: '',
    ...over,
  })

  it('writes money in against the $CASH pseudo-instrument', () => {
    const [, row = ''] = lines(tradesCsv([], { cash: [cash()] }))
    expect(row).toBe('$CASH,Deposit,499979,,,2026-02-02 0:00:00')
  })

  it('strips the sign from an outflow, since the side already carries direction', () => {
    // The ledger signs a withdrawal negative; TradingView wants a bare amount.
    const [, row = ''] = lines(tradesCsv([], { cash: [cash({ amount: '-102901' })] }))
    expect(row).toBe('$CASH,Withdrawal,102901,,,2026-02-02 0:00:00')
  })

  it('books 譲渡益税 withheld at source as Taxes and fees, not a withdrawal', () => {
    const [, row = ''] = lines(
      tradesCsv([], { cash: [cash({ amount: '-695', description: '特定譲渡益税徴収　国税' })] }),
    )
    expect(row).toBe('$CASH,Taxes and fees,695,,,2026-02-02 0:00:00')
  })

  it('books a 譲渡益税 refund as money in', () => {
    // 還付 is positive — a later loss offset an earlier gain and the withholding
    // came back. It never reaches the tax branch, and Deposit is honest for it.
    const [, row = ''] = lines(
      tradesCsv([], { cash: [cash({ amount: '1204', description: '特定譲渡益税還付　国税' })] }),
    )
    expect(row).toContain(',Deposit,1204,')
  })

  it('books a katakana fee as Taxes and fees', () => {
    const [, row = ''] = lines(
      tradesCsv([], {
        cash: [cash({ amount: '-1100', description: 'ショウメイショトウハッコウテスウリョウ' })],
      }),
    )
    expect(row).toContain(',Taxes and fees,1100,')
  })

  it('drops a non-JPY leg rather than counting dollars as yen', () => {
    // $CASH has no currency of its own. The USD rows in the ledger are one half
    // of an FX conversion whose JPY half is recorded separately, so keeping both
    // would invent money.
    const csv = tradesCsv([], {
      cash: [cash({ amount: '-5.82', currency: 'USD', description: '振替' })],
    })
    expect(lines(csv)).toHaveLength(1)
  })

  it('ignores a zero-amount line', () => {
    expect(lines(tradesCsv([], { cash: [cash({ amount: '0' })] }))).toHaveLength(1)
  })
})

describe('tradesCsv dividends', () => {
  const payout = (over = {}) => ({
    payDate: '2026-06-28',
    symbol: '8411',
    assetClass: 'JP_EQUITY' as const,
    netAmount: '9963',
    ...over,
  })

  it('credits the payout to its instrument, net of withholding', () => {
    // Gross would credit cash that never arrived.
    const [, row = ''] = lines(tradesCsv([], { dividends: [payout()] }))
    expect(row).toBe('TSE:8411,Dividend,9963,,,2026-06-28 0:00:00')
  })

  it('drops a fund distribution, whose 再投資 buy is dropped too', () => {
    // Both halves leave together, so the cash balance stays consistent.
    const csv = tradesCsv(
      [trade({ assetClass: 'FUND', side: 'REINVEST', symbol: 'eMAXIS Slim 米国株式(S&P500)' })],
      { dividends: [payout({ symbol: 'eMAXIS Slim 米国株式(S&P500)', assetClass: 'FUND' })] },
    )
    expect(lines(csv)).toHaveLength(1)
  })
})

describe('tradesCsv ordering across sources', () => {
  it('lands cash before the fills it funds and after the ones it settles', () => {
    // Everything shares one date, so only the rank separates them. An importer
    // replaying in file order must never see a balance dip negative.
    const output = lines(
      tradesCsv([trade({ tradeDate: '2026-04-10', side: 'SELL' }), trade({ tradeDate: '2026-04-10', side: 'BUY' })], {
        cash: [
          { date: '2026-04-10', amount: '500000', currency: 'JPY', description: '' },
          { date: '2026-04-10', amount: '-200000', currency: 'JPY', description: '' },
        ],
        dividends: [{ payDate: '2026-04-10', symbol: '8411', assetClass: 'JP_EQUITY', netAmount: '900' }],
      }),
    )
    expect(output[1]).toContain(',Deposit,')
    expect(output[2]).toContain(',Dividend,')
    expect(output[3]).toContain(',Buy,')
    expect(output[4]).toContain(',Sell,')
    expect(output[5]).toContain(',Withdrawal,')
  })
})

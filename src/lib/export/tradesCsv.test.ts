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

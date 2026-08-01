import { describe, expect, it } from 'vitest'
import { tradingViewSymbol, tradingViewUrl } from './tradingview'

describe('tradingViewSymbol', () => {
  it('prefixes Japanese equities and ETFs with the 東証 venue', () => {
    expect(tradingViewSymbol('8411', 'JP_EQUITY')).toBe('TSE:8411')
    // 1459 is an ETF, not an ordinary share — same venue, same prefix.
    expect(tradingViewSymbol('1459', 'JP_EQUITY')).toBe('TSE:1459')
  })

  it('accepts the newer alphanumeric 東証 codes', () => {
    expect(tradingViewSymbol('130A', 'JP_EQUITY')).toBe('TSE:130A')
  })

  it('passes US tickers through unprefixed', () => {
    expect(tradingViewSymbol('AAPL', 'US_EQUITY')).toBe('AAPL')
  })

  it('converts a space-separated share class to dot notation', () => {
    // Rakuten exports Berkshire class B as "BRK B"; TradingView needs "BRK.B".
    expect(tradingViewSymbol('BRK B', 'US_EQUITY')).toBe('BRK.B')
  })

  it('returns null for mutual funds, which TradingView does not list', () => {
    expect(tradingViewSymbol('eMAXIS Slim 米国株式(S&P500)', 'FUND')).toBeNull()
    expect(tradingViewSymbol('楽天・プラス・日経225インデックス・ファンド', 'FUND')).toBeNull()
  })

  it('returns null rather than guessing when a symbol is not a real ticker', () => {
    // The statement parser can mint instruments keyed by display name; those
    // must never become links.
    expect(tradingViewSymbol('ADVANCED M D INC', 'US_EQUITY')).toBeNull()
    expect(tradingViewSymbol('日経225', 'JP_EQUITY')).toBeNull()
    expect(tradingViewSymbol('', 'US_EQUITY')).toBeNull()
  })
})

describe('tradingViewUrl', () => {
  it('escapes the venue separator so the query parameter survives', () => {
    expect(tradingViewUrl('8411', 'JP_EQUITY')).toBe(
      'https://www.tradingview.com/chart/?symbol=TSE%3A8411',
    )
  })

  it('is null exactly when there is no symbol to chart', () => {
    expect(tradingViewUrl('iTrust インド株式', 'FUND')).toBeNull()
  })
})

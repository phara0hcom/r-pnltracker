/**
 * Maps an instrument to its TradingView chart.
 *
 * Rakuten's exports carry no exchange field, so the venue is derived from the
 * asset class instead. That is safe here because the account only holds two
 * listed venues: every JP equity and ETF in the data trades on 東証, and every
 * US position is on a venue TradingView resolves from the bare ticker.
 *
 * Japanese mutual funds (投資信託) return null: TradingView lists no 基準価額
 * series for them, so a link would land on a search miss rather than a chart.
 */
import type { AssetClass } from './domain/types'

const BASE = 'https://www.tradingview.com/chart/'

/** 東証-listed codes are 4 digits, sometimes with a trailing letter (e.g. 130A). */
const JP_CODE = /^\d{3}[\dA-Z]$/

/** 1–5 letters, optionally a single share-class suffix ("BRK B" / "BRK.B"). */
const US_TICKER = /^[A-Z]{1,5}([ .][A-Z])?$/

export function tradingViewSymbol(symbol: string, assetClass: AssetClass): string | null {
  switch (assetClass) {
    case 'JP_EQUITY':
      return JP_CODE.test(symbol) ? `TSE:${symbol}` : null

    case 'US_EQUITY':
      // Deliberately strict. The statement parser can mint instruments keyed by
      // company display name ("ADVANCED M D INC"), and linking one of those
      // would send you to a search miss dressed up as a chart.
      return US_TICKER.test(symbol) ? symbol.trim().replace(' ', '.') : null

    case 'FUND':
      return null
  }
}

export function tradingViewUrl(symbol: string, assetClass: AssetClass): string | null {
  const tv = tradingViewSymbol(symbol, assetClass)
  return tv === null ? null : `${BASE}?symbol=${encodeURIComponent(tv)}`
}

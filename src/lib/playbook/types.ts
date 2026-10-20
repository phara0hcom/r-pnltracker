/**
 * Shared shapes for the playbook: candles, ratings, and the legs of a review.
 */

/** Entry, exit and risk ratings run 1–10; the overall score is on the same scale. */
export const RATING_MIN = 1
export const RATING_MAX = 10

/**
 * One OHLC bar. Prices are exact decimal strings, as everywhere else money is;
 * `t` is the bar's *open* in Unix milliseconds, which is what both TradingView
 * and Yahoo report.
 */
export interface Candle {
  t: number
  o: string
  h: string
  l: string
  c: string
  /** Null when the source has none — TradingView sends `na` for some indices. */
  v: string | null
}

export type CandleSource = 'TRADINGVIEW' | 'YAHOO'
export type LegKind = 'ENTRY' | 'EXIT'
export type ReviewKind = 'REAL' | 'PAPER'

/** The timeframes offered when capturing a chart. Any `normalizeInterval` form is storable. */
export const CHART_INTERVALS = ['5m', '15m', '1h', '4h', '1D', '1W'] as const

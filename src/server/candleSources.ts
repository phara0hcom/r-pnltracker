/**
 * Fetching candles for a chart capture, from either source.
 *
 * No `createServerFn` export: `playbook.ts` calls this from inside handlers,
 * which keeps the database import out of anything client-reachable — see
 * `docs/server-only-modules.md`.
 *
 * Nothing here throws for a source being down. Like `lib/prices/providers.ts`,
 * an outage is an answer with a reason, which the capture dialog shows.
 */
import { storedCandles } from '~/db/candles.service'
import type { AssetClass } from '~/lib/domain/types'
import { candleTicker, parseYahooChart, windowAround, yahooRequest } from '~/lib/playbook/candles'
import type { Candle, CandleSource } from '~/lib/playbook/types'

const TIMEOUT_MS = 8000

export type CandleFetch = { ok: true; bars: Candle[] } | { ok: false; error: string }

async function fromYahoo(
  symbol: string,
  assetClass: AssetClass,
  interval: string,
  from: number,
  to: number,
): Promise<CandleFetch> {
  const request = yahooRequest(symbol, assetClass, interval, from, to, Date.now())
  if (!request.ok) return request

  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, TIMEOUT_MS)
  try {
    const res = await fetch(request.url, { signal: controller.signal })
    // Yahoo rate-limits by IP under light use — worth saying, since waiting fixes it.
    if (res.status === 429)
      return { ok: false, error: 'Yahoo is rate-limiting this server — try again in a minute' }
    const bars = parseYahooChart(await res.json())
    if (bars.length === 0)
      return { ok: false, error: `Yahoo returned no ${interval} bars for ${symbol} then` }
    return { ok: true, bars: windowAround(bars, from, to) }
  } catch {
    return { ok: false, error: 'Yahoo did not answer' }
  } finally {
    clearTimeout(timer)
  }
}

async function fromTradingView(
  symbol: string,
  assetClass: AssetClass,
  interval: string,
  from: number,
  to: number,
): Promise<CandleFetch> {
  const ticker = candleTicker(symbol, assetClass)
  if (ticker === null) return { ok: false, error: `TradingView has no chart for ${symbol}` }
  const bars = await storedCandles(ticker, interval, from, to)
  if (bars.length === 0) {
    return {
      ok: false,
      error: `No ${interval} bars from TradingView for ${ticker} yet — add the Playbook Candles alert to a ${interval} chart`,
    }
  }
  return { ok: true, bars }
}

/** Bars around `from`…`to` — the review's first and last fill — on one timeframe. */
export function fetchCandles(
  source: CandleSource,
  symbol: string,
  assetClass: AssetClass,
  interval: string,
  from: number,
  to: number,
): Promise<CandleFetch> {
  return source === 'YAHOO'
    ? fromYahoo(symbol, assetClass, interval, from, to)
    : fromTradingView(symbol, assetClass, interval, from, to)
}

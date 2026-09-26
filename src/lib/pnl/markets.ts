/**
 * Realized results split the way Rakuten's app splits them.
 *
 * The yen side — Japanese stocks and funds — is in yen. The US side is in
 * dollars as `usdResult` states them, which is the figure Rakuten's US screen
 * shows, with its yen result beside it. That yen result is the engine's, so it
 * carries the currency move, and it is what the overall total adds: a US trade
 * that made dollars while the yen strengthened counts for what it made in yen.
 *
 * The dashboard and the calendar both total through here, so the two cannot
 * disagree about a day or a month.
 */
import type Decimal from 'decimal.js'
import { ZERO } from '../domain/types'
import type { RealizedEvent } from './engine'
import { usdGain } from './usdResult'

export interface MarketSplit {
  /** Japanese stocks and funds. Null when none closed. */
  jpy: { realizedJpy: Decimal; closes: number } | null
  /** US stocks. Null when none closed. */
  usd: {
    /** In dollars, as Rakuten's US screen shows it. */
    realizedUsd: Decimal
    /** In yen, the currency move included. */
    realizedJpy: Decimal
    closes: number
  } | null
  /** Both sides in yen, the currency move included. */
  totalJpy: Decimal
}

/** Decimal-free, for the wire. Nulls mean nothing closed on that side. */
export interface MarketSplitView {
  jpyRealizedJpy: string | null
  usdRealizedUsd: string | null
  usdRealizedJpy: string | null
  totalJpy: string
}

export const isUsClose = (close: RealizedEvent): boolean => close.assetClass === 'US_EQUITY'

export function splitByMarket(closes: readonly RealizedEvent[]): MarketSplit {
  let yenSide = ZERO
  let yenCloses = 0
  let usSideUsd = ZERO
  let usSideJpy = ZERO
  let usCloses = 0
  for (const close of closes) {
    if (isUsClose(close)) {
      usSideUsd = usSideUsd.add(usdGain(close))
      usSideJpy = usSideJpy.add(close.realizedJpy)
      usCloses++
    } else {
      yenSide = yenSide.add(close.realizedJpy)
      yenCloses++
    }
  }
  return {
    jpy: yenCloses ? { realizedJpy: yenSide, closes: yenCloses } : null,
    usd: usCloses ? { realizedUsd: usSideUsd, realizedJpy: usSideJpy, closes: usCloses } : null,
    totalJpy: yenSide.add(usSideJpy),
  }
}

export function toSplitView(split: MarketSplit): MarketSplitView {
  return {
    jpyRealizedJpy: split.jpy?.realizedJpy.toFixed(0) ?? null,
    usdRealizedUsd: split.usd?.realizedUsd.toFixed(2) ?? null,
    usdRealizedJpy: split.usd?.realizedJpy.toFixed(0) ?? null,
    totalJpy: split.totalJpy.toFixed(0),
  }
}

/** One split per 約定日 — the calendar's days. */
export function splitByDay(closes: readonly RealizedEvent[]): Map<string, MarketSplit> {
  const byDate = new Map<string, RealizedEvent[]>()
  for (const close of closes) {
    const list = byDate.get(close.tradeDate)
    if (list) list.push(close)
    else byDate.set(close.tradeDate, [close])
  }
  return new Map([...byDate].map(([date, list]) => [date, splitByMarket(list)]))
}

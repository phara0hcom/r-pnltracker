/**
 * Continuous holding windows per instrument — when a position was open, and for
 * how long.
 *
 * Distinct from the engine's `holdingDays`, which is the quantity-weighted mean
 * age of the units in one sale. This answers a different question: was the
 * position open across some external date, such as a dividend record date.
 *
 * Windows are per symbol, not per (symbol × accountType): a record date does not
 * care which tax bucket the shares sit in.
 */
import Decimal from 'decimal.js'
import { OPENING_SIDES, type NormalizedTrade } from '../domain/types'
import { sortTradesForEngine } from './engine'

export interface HoldingWindow {
  symbol: string
  from: string
  /** Null while the position is still open. */
  to: string | null
  days: number
}

const dayDiff = (from: string, to: string): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)

export function holdingWindows(trades: NormalizedTrade[], asOf: string): HoldingWindow[] {
  const bySymbol = new Map<string, NormalizedTrade[]>()
  // Engine ordering, so a same-day round trip does not appear to close before it
  // opened — which otherwise yields a phantom window and loses the real one.
  for (const t of sortTradesForEngine(trades)) {
    bySymbol.set(t.symbol, [...(bySymbol.get(t.symbol) ?? []), t])
  }

  const out: HoldingWindow[] = []

  for (const [symbol, list] of bySymbol) {
    let quantity = new Decimal(0)
    let openedAt: string | null = null

    for (const t of list) {
      if (OPENING_SIDES.includes(t.side)) {
        // Only a move off flat starts a window; adding to a position does not.
        if (quantity.lte(0)) openedAt = t.tradeDate
        quantity = quantity.add(t.quantity)
        continue
      }

      quantity = quantity.sub(t.quantity)
      // A partial sell leaves the position open, so the window continues.
      if (quantity.lte(0) && openedAt !== null) {
        out.push({ symbol, from: openedAt, to: t.tradeDate, days: dayDiff(openedAt, t.tradeDate) })
        openedAt = null
      }
    }

    if (openedAt !== null && quantity.gt(0)) {
      out.push({ symbol, from: openedAt, to: null, days: dayDiff(openedAt, asOf) })
    }
  }

  return out
}

/** Longest continuous hold per symbol. */
export function longestHoldBySymbol(windows: HoldingWindow[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const w of windows) {
    out.set(w.symbol, Math.max(out.get(w.symbol) ?? 0, w.days))
  }
  return out
}

/**
 * Trading statistics over closed round trips.
 *
 * Every figure is computed from `RealizedEvent`s, so a "trade" here means a
 * closing transaction with its matched cost basis — not an order.
 *
 * Degenerate cases are represented as `null` rather than `Infinity` or `NaN`,
 * so the UI renders an em dash instead of a nonsense number: profit factor with
 * no losing trades is undefined, not infinite.
 */
import type Decimal from 'decimal.js'
import { ZERO, type AccountType, type AssetClass } from '../domain/types'
import type { RealizedEvent } from '../pnl/engine'

export interface StatsFilter {
  accountTypes?: AccountType[]
  assetClasses?: AssetClass[]
  /** Inclusive, on trade date. */
  from?: string
  to?: string
}

export interface TradingStats {
  tradeCount: number
  winCount: number
  lossCount: number
  breakevenCount: number
  /** Null when there are no closes at all. */
  winRate: number | null
  grossProfit: Decimal
  grossLoss: Decimal
  netPnl: Decimal
  avgWin: Decimal | null
  avgLoss: Decimal | null
  largestWin: RealizedEvent | null
  largestLoss: RealizedEvent | null
  /** Σgains / |Σlosses|. Null when there are no losses — undefined, not infinite. */
  profitFactor: number | null
  /** Avg win ÷ avg loss. Null when either side is absent. */
  payoffRatio: number | null
  /** Deepest peak-to-trough fall of the cumulative realized curve. */
  maxDrawdown: Decimal
  maxDrawdownPct: number | null
  longestWinStreak: number
  longestLossStreak: number
  /** Size-weighted mean holding period, in days. */
  avgHoldingDays: number | null
  /** Unweighted median, less distorted by one large position. */
  medianHoldingDays: number | null
  /** Cumulative realized P&L over time — the equity curve. */
  equityCurve: { date: string; value: Decimal }[]
}

export function applyFilter(
  events: RealizedEvent[],
  filter: StatsFilter = {},
): RealizedEvent[] {
  return events.filter((close) => {
    if (filter.accountTypes?.length && !filter.accountTypes.includes(close.accountType)) return false
    if (filter.assetClasses?.length && !filter.assetClasses.includes(close.assetClass)) return false
    if (filter.from && close.tradeDate < filter.from) return false
    if (filter.to && close.tradeDate > filter.to) return false
    return true
  })
}

/**
 * Peak-to-trough decline of the cumulative realized curve.
 *
 * The peak starts at zero rather than at the first value, so an immediately
 * losing start is measured as drawdown instead of being ignored.
 */
function drawdown(curve: Decimal[]): { max: Decimal; pct: number | null } {
  let peak = ZERO
  let deepestFall = ZERO
  let pctAtDeepest: number | null = null

  for (const value of curve) {
    if (value.gt(peak)) peak = value
    const fallFromPeak = peak.sub(value)
    if (fallFromPeak.gt(deepestFall)) {
      deepestFall = fallFromPeak
      pctAtDeepest = peak.gt(0) ? fallFromPeak.div(peak).toNumber() : null
    }
  }
  return { max: deepestFall, pct: pctAtDeepest }
}

function longestStreak(events: RealizedEvent[], winning: boolean): number {
  let longest = 0
  let current = 0
  for (const close of events) {
    const continuesStreak = winning ? close.realizedJpy.gt(0) : close.realizedJpy.lt(0)
    current = continuesStreak ? current + 1 : 0
    if (current > longest) longest = current
  }
  return longest
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((low, high) => low - high)
  const mid = Math.floor(sorted.length / 2)
  // Even counts have no single middle, so average the two straddling it.
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export function computeStats(
  events: RealizedEvent[],
  filter: StatsFilter = {},
): TradingStats {
  // Chronological order matters for streaks and the equity curve.
  const closes = applyFilter(events, filter).sort((left, right) =>
    left.tradeDate < right.tradeDate ? -1 : left.tradeDate > right.tradeDate ? 1 : 0,
  )

  const wins = closes.filter((close) => close.realizedJpy.gt(0))
  const losses = closes.filter((close) => close.realizedJpy.lt(0))
  const breakeven = closes.filter((close) => close.realizedJpy.isZero())

  const grossProfit = wins.reduce((running, close) => running.add(close.realizedJpy), ZERO)
  const grossLoss = losses.reduce((running, close) => running.add(close.realizedJpy.abs()), ZERO)
  const netPnl = grossProfit.sub(grossLoss)

  const avgWin = wins.length ? grossProfit.div(wins.length) : null
  const avgLoss = losses.length ? grossLoss.div(losses.length) : null

  let cumulative = ZERO
  const equityCurve = closes.map((close) => {
    cumulative = cumulative.add(close.realizedJpy)
    return { date: close.tradeDate, value: cumulative }
  })

  const { max: maxDrawdown, pct: maxDrawdownPct } = drawdown(
    equityCurve.map((point) => point.value),
  )

  // Weight holding period by position size — a 3-day flip of ¥5,000 should not
  // count the same as a 2-year hold of ¥2,000,000.
  const totalCost = closes.reduce((running, close) => running.add(close.costJpy.abs()), ZERO)
  const avgHoldingDays = totalCost.gt(0)
    ? closes
        .reduce(
          (running, close) => running.add(close.costJpy.abs().mul(close.holdingDays)),
          ZERO,
        )
        .div(totalCost)
        .toNumber()
    : null

  return {
    tradeCount: closes.length,
    winCount: wins.length,
    lossCount: losses.length,
    breakevenCount: breakeven.length,
    winRate: closes.length ? wins.length / closes.length : null,
    grossProfit,
    grossLoss,
    netPnl,
    avgWin,
    avgLoss,
    largestWin: wins.length
      ? wins.reduce((best, close) => (close.realizedJpy.gt(best.realizedJpy) ? close : best))
      : null,
    largestLoss: losses.length
      ? losses.reduce((worst, close) => (close.realizedJpy.lt(worst.realizedJpy) ? close : worst))
      : null,
    // No losses means the ratio is undefined, not infinite.
    profitFactor: grossLoss.isZero() ? null : grossProfit.div(grossLoss).toNumber(),
    payoffRatio: avgWin && avgLoss?.gt(0) ? avgWin.div(avgLoss).toNumber() : null,
    maxDrawdown,
    maxDrawdownPct,
    longestWinStreak: longestStreak(closes, true),
    longestLossStreak: longestStreak(closes, false),
    avgHoldingDays,
    medianHoldingDays: median(closes.map((close) => close.holdingDays)),
    equityCurve,
  }
}

/** Per-symbol contribution, ranked — surfaces which names actually make money. */
export interface SymbolPerformance {
  symbol: string
  name: string
  assetClass: AssetClass
  tradeCount: number
  netPnl: Decimal
  winCount: number
  winRate: number
}

export function bySymbol(events: RealizedEvent[], filter: StatsFilter = {}): SymbolPerformance[] {
  const bySymbolKey = new Map<string, RealizedEvent[]>()
  for (const close of applyFilter(events, filter)) {
    const existing = bySymbolKey.get(close.symbol)
    if (existing) existing.push(close)
    else bySymbolKey.set(close.symbol, [close])
  }

  return [...bySymbolKey.entries()]
    .map(([symbol, symbolCloses]) => {
      const winCount = symbolCloses.filter((close) => close.realizedJpy.gt(0)).length
      return {
        symbol,
        name: symbolCloses[0]!.name,
        assetClass: symbolCloses[0]!.assetClass,
        tradeCount: symbolCloses.length,
        netPnl: symbolCloses.reduce((running, close) => running.add(close.realizedJpy), ZERO),
        winCount,
        winRate: winCount / symbolCloses.length,
      }
    })
    .sort((left, right) => right.netPnl.cmp(left.netPnl))
}

/**
 * Realized P&L grouped by calendar day — drives the calendar heat map.
 * Keyed on trade date, since the journal is about how a day felt to trade.
 */
export function dailyPnl(events: RealizedEvent[]): Map<string, Decimal> {
  const byDate = new Map<string, Decimal>()
  for (const close of events) {
    byDate.set(close.tradeDate, (byDate.get(close.tradeDate) ?? ZERO).add(close.realizedJpy))
  }
  return byDate
}

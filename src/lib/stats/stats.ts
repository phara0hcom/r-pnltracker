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

export function applyFilter(events: RealizedEvent[], f: StatsFilter = {}): RealizedEvent[] {
  return events.filter((e) => {
    if (f.accountTypes?.length && !f.accountTypes.includes(e.accountType)) return false
    if (f.assetClasses?.length && !f.assetClasses.includes(e.assetClass)) return false
    if (f.from && e.tradeDate < f.from) return false
    if (f.to && e.tradeDate > f.to) return false
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
  let max = ZERO
  let pctAtMax: number | null = null

  for (const v of curve) {
    if (v.gt(peak)) peak = v
    const dd = peak.sub(v)
    if (dd.gt(max)) {
      max = dd
      pctAtMax = peak.gt(0) ? dd.div(peak).toNumber() : null
    }
  }
  return { max, pct: pctAtMax }
}

function longestStreak(events: RealizedEvent[], winning: boolean): number {
  let best = 0
  let run = 0
  for (const e of events) {
    const match = winning ? e.realizedJpy.gt(0) : e.realizedJpy.lt(0)
    run = match ? run + 1 : 0
    if (run > best) best = run
  }
  return best
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

export function computeStats(
  events: RealizedEvent[],
  filter: StatsFilter = {},
): TradingStats {
  // Chronological order matters for streaks and the equity curve.
  const list = applyFilter(events, filter).sort((a, b) =>
    a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : 0,
  )

  const wins = list.filter((e) => e.realizedJpy.gt(0))
  const losses = list.filter((e) => e.realizedJpy.lt(0))
  const breakeven = list.filter((e) => e.realizedJpy.isZero())

  const grossProfit = wins.reduce((a, e) => a.add(e.realizedJpy), ZERO)
  const grossLoss = losses.reduce((a, e) => a.add(e.realizedJpy.abs()), ZERO)
  const netPnl = grossProfit.sub(grossLoss)

  const avgWin = wins.length ? grossProfit.div(wins.length) : null
  const avgLoss = losses.length ? grossLoss.div(losses.length) : null

  let running = ZERO
  const equityCurve = list.map((e) => {
    running = running.add(e.realizedJpy)
    return { date: e.tradeDate, value: running }
  })

  const { max: maxDrawdown, pct: maxDrawdownPct } = drawdown(equityCurve.map((p) => p.value))

  // Weight holding period by position size — a 3-day flip of ¥5,000 should not
  // count the same as a 2-year hold of ¥2,000,000.
  const totalCost = list.reduce((a, e) => a.add(e.costJpy.abs()), ZERO)
  const avgHoldingDays = totalCost.gt(0)
    ? list
        .reduce((a, e) => a.add(e.costJpy.abs().mul(e.holdingDays)), ZERO)
        .div(totalCost)
        .toNumber()
    : null

  return {
    tradeCount: list.length,
    winCount: wins.length,
    lossCount: losses.length,
    breakevenCount: breakeven.length,
    winRate: list.length ? wins.length / list.length : null,
    grossProfit,
    grossLoss,
    netPnl,
    avgWin,
    avgLoss,
    largestWin: wins.length
      ? wins.reduce((a, e) => (e.realizedJpy.gt(a.realizedJpy) ? e : a))
      : null,
    largestLoss: losses.length
      ? losses.reduce((a, e) => (e.realizedJpy.lt(a.realizedJpy) ? e : a))
      : null,
    // No losses means the ratio is undefined, not infinite.
    profitFactor: grossLoss.isZero() ? null : grossProfit.div(grossLoss).toNumber(),
    payoffRatio: avgWin && avgLoss?.gt(0) ? avgWin.div(avgLoss).toNumber() : null,
    maxDrawdown,
    maxDrawdownPct,
    longestWinStreak: longestStreak(list, true),
    longestLossStreak: longestStreak(list, false),
    avgHoldingDays,
    medianHoldingDays: median(list.map((e) => e.holdingDays)),
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
  const groups = new Map<string, RealizedEvent[]>()
  for (const e of applyFilter(events, filter)) {
    const list = groups.get(e.symbol)
    if (list) list.push(e)
    else groups.set(e.symbol, [e])
  }

  return [...groups.entries()]
    .map(([symbol, list]) => {
      const winCount = list.filter((e) => e.realizedJpy.gt(0)).length
      return {
        symbol,
        name: list[0]!.name,
        assetClass: list[0]!.assetClass,
        tradeCount: list.length,
        netPnl: list.reduce((a, e) => a.add(e.realizedJpy), ZERO),
        winCount,
        winRate: winCount / list.length,
      }
    })
    .sort((a, b) => b.netPnl.cmp(a.netPnl))
}

/**
 * Realized P&L grouped by calendar day — drives the calendar heat map.
 * Keyed on trade date, since the journal is about how a day felt to trade.
 */
export function dailyPnl(events: RealizedEvent[]): Map<string, Decimal> {
  const out = new Map<string, Decimal>()
  for (const e of events) {
    out.set(e.tradeDate, (out.get(e.tradeDate) ?? ZERO).add(e.realizedJpy))
  }
  return out
}

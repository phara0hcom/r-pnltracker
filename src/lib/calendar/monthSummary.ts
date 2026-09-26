/**
 * The Calendar's month in figures: its best and worst day, how many days were
 * green, and the average per trading day.
 *
 * Worked out on the server from the days' exact yen strings, so the screen
 * renders them rather than adding them up in the browser as it used to.
 *
 * A trading day is a day with any trade in view. A day of buys alone has
 * nothing realized, so it counts towards the average's divisor — it was a day
 * spent trading — but is neither green nor red, and cannot be the best or
 * worst day.
 */
import Decimal from 'decimal.js'

export interface SummaryDay {
  date: string
  tradeCount: number
  /** Null when nothing closed that day. */
  realizedJpy: string | null
}

export interface DayResult {
  date: string
  realizedJpy: string
}

export interface MonthSummary {
  tradingDays: number
  /** Days with at least one close. */
  closeDays: number
  greenDays: number
  redDays: number
  best: DayResult | null
  /** Null with fewer than two days closed, where it would only repeat `best`. */
  worst: DayResult | null
  /** The month's realized over its trading days. Null with none. */
  avgPerTradingDayJpy: string | null
}

export function summarizeMonth(days: readonly SummaryDay[]): MonthSummary {
  let total = new Decimal(0)
  let tradingDays = 0
  let greenDays = 0
  let redDays = 0
  let best: { date: string; value: Decimal } | null = null
  let worst: { date: string; value: Decimal } | null = null
  const closed: string[] = []

  for (const day of days) {
    if (day.tradeCount > 0) tradingDays++
    if (day.realizedJpy == null) continue
    const value = new Decimal(day.realizedJpy)
    closed.push(day.date)
    total = total.add(value)
    if (value.gt(0)) greenDays++
    if (value.lt(0)) redDays++
    if (!best || value.gt(best.value)) best = { date: day.date, value }
    if (!worst || value.lt(worst.value)) worst = { date: day.date, value }
  }

  const result = (entry: { date: string; value: Decimal } | null): DayResult | null =>
    entry && { date: entry.date, realizedJpy: entry.value.toFixed(0) }

  return {
    tradingDays,
    closeDays: closed.length,
    greenDays,
    redDays,
    best: result(best),
    worst: closed.length > 1 ? result(worst) : null,
    avgPerTradingDayJpy: tradingDays > 0 ? total.div(tradingDays).toFixed(0) : null,
  }
}

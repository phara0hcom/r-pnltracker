/**
 * Portfolio server functions.
 *
 * The engines run server-side and return plain JSON. `Decimal` values are
 * serialised as strings at this boundary rather than numbers, so exact money
 * crosses the wire intact and the client never reconstructs it from a float.
 */
import { createServerFn } from '@tanstack/react-start'
import { authed } from './middleware'
import { listTrades } from '~/db/trades.service'
import { accountFilterInput } from '~/lib/accountScope'
import { matchesAccountFilter, ZERO } from '~/lib/domain/types'
import { buildNisaReport } from '~/lib/nisa/quota'
import { runEngine, type RealizedEvent } from '~/lib/pnl/engine'
import { attributeFx } from '~/lib/pnl/fxAttribution'
import { computeStats } from '~/lib/stats/stats'

/** Aggregates for one time window — reused for week, month and all-time. */
export interface PeriodSummary {
  label: string
  /** Net realized: gains minus losses. */
  realizedJpy: string
  /** Sum of winning closes only. */
  grossProfitJpy: string
  /** Sum of losing closes, as a positive magnitude. */
  grossLossJpy: string
  /** Cost basis of everything closed in the window — the return denominator. */
  costJpy: string
  /**
   * Net realized as a fraction of what those closes cost.
   *
   * Return on the capital actually released in the window, matching the monthly
   * chart. Null when nothing closed.
   */
  returnPct: number | null
  tradeCount: number
  winCount: number
  lossCount: number
  winRate: number | null
}

export interface MonthlyPoint {
  /** YYYY-MM */
  month: string
  realizedJpy: string
  /** Cost basis of the positions closed that month — the return denominator. */
  costJpy: string
  /**
   * Realized P&L as a fraction of what those closes cost.
   *
   * This is a return on the capital actually released that month, not on the
   * whole portfolio: closing a ¥100k position for ¥110k is +10%, regardless of
   * how much else sits untouched. Null when nothing closed.
   */
  returnPct: number | null
  tradeCount: number
}

export interface DashboardData {
  tradeCount: number
  openPositions: number
  realizedJpy: string
  /** Total acquisition cost of positions still held — capital currently invested. */
  investedAtCostJpy: string
  /** All-time gross loss, as a positive magnitude. */
  grossLossJpy: string
  grossProfitJpy: string
  winRate: number | null
  profitFactor: number | null
  maxDrawdownJpy: string
  week: PeriodSummary
  month: PeriodSummary
  monthly: MonthlyPoint[]
  nisaLifetimeUsed: string
  nisaLifetimeRemaining: string
  nisaPendingRestoration: string
  nisaRestorationDate: string
  nisaGrowthMaxedYear: number | null
  stockEffectJpy: string
  fxEffectJpy: string
  /** FX effect as a share of stock + FX effect combined. Null when both are zero. */
  fxShare: number | null
  equityCurve: { date: string; value: string }[]
}

/** Monday-start week containing `now`, as an inclusive ISO date range. */
function currentWeek(now: Date): { from: string; to: string } {
  const midnightUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  // getUTCDay is Sunday-based; shift so Monday is 0.
  const offsetFromMonday = (midnightUtc.getUTCDay() + 6) % 7
  const monday = new Date(midnightUtc)
  monday.setUTCDate(midnightUtc.getUTCDate() - offsetFromMonday)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) }
}

/**
 * Summarize closes inside a window.
 *
 * Uses trade date, not settlement date: this is "how did I do this week", a
 * performance question, not a tax one.
 */
function summarize(events: RealizedEvent[], label: string, from: string, to: string): PeriodSummary {
  const inRange = events.filter((close) => close.tradeDate >= from && close.tradeDate <= to)
  const wins = inRange.filter((close) => close.realizedJpy.gt(0))
  const losses = inRange.filter((close) => close.realizedJpy.lt(0))

  const grossProfit = wins.reduce((running, close) => running.add(close.realizedJpy), ZERO)
  const grossLoss = losses.reduce((running, close) => running.add(close.realizedJpy.abs()), ZERO)
  const cost = inRange.reduce((running, close) => running.add(close.costJpy), ZERO)
  const net = grossProfit.sub(grossLoss)

  return {
    label,
    realizedJpy: net.toFixed(0),
    grossProfitJpy: grossProfit.toFixed(0),
    grossLossJpy: grossLoss.toFixed(0),
    costJpy: cost.toFixed(0),
    // Guard the divide: a zero cost basis would yield Infinity.
    returnPct: cost.gt(0) ? net.div(cost).toNumber() : null,
    tradeCount: inRange.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: inRange.length ? wins.length / inRange.length : null,
  }
}

/**
 * Realized P&L per calendar month, gap-filled across the whole history.
 *
 * Gap-filling matters: a month with no closes must still occupy space, or the
 * axis misrepresents time. The full series is returned and the client windows
 * it, so paging back through history costs no round-trip — ~48 rows of three
 * fields is far cheaper to send once than to re-fetch per page.
 */
function monthlySeries(events: RealizedEvent[]): MonthlyPoint[] {
  if (events.length === 0) return []

  const byMonth = new Map<string, { total: typeof ZERO; cost: typeof ZERO; count: number }>()
  for (const close of events) {
    const key = close.tradeDate.slice(0, 7)
    const running = byMonth.get(key) ?? { total: ZERO, cost: ZERO, count: 0 }
    byMonth.set(key, {
      total: running.total.add(close.realizedJpy),
      cost: running.cost.add(close.costJpy),
      count: running.count + 1,
    })
  }

  const keys = [...byMonth.keys()].sort()
  const firstKey = keys[0]
  const lastKey = keys.at(-1)
  if (!firstKey || !lastKey) return []

  // Months with no closes must still appear, or the axis lies about time.
  const out: MonthlyPoint[] = []
  const [firstYear, firstMonth] = firstKey.split('-').map(Number)
  const [lastYear, lastMonth] = lastKey.split('-').map(Number)
  const cursor = new Date(Date.UTC(firstYear ?? 2022, (firstMonth ?? 1) - 1, 1))
  const end = new Date(Date.UTC(lastYear ?? 2026, (lastMonth ?? 12) - 1, 1))

  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 7)
    const month = byMonth.get(key)
    out.push({
      month: key,
      realizedJpy: (month?.total ?? ZERO).toFixed(0),
      costJpy: (month?.cost ?? ZERO).toFixed(0),
      // Guard the divide: a zero cost basis would yield Infinity.
      returnPct: month?.cost.gt(0) ? month.total.div(month.cost).toNumber() : null,
      tradeCount: month?.count ?? 0,
    })
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return out
}

export const getDashboard = createServerFn({ method: 'GET' })
  .middleware([authed])
  .validator(accountFilterInput)
  .handler(async ({ data, context }): Promise<DashboardData> => {
    const records = await listTrades(context.userId)
    // Filtered before the engine runs: pools are keyed (symbol × accountType),
    // so removing whole accounts leaves the rest identical.
    const trades = records
      .map((record) => record.trade)
      .filter((trade) => matchesAccountFilter(trade.accountType, data.account))

    const engine = runEngine(trades)
    const stats = computeStats(engine.realized)
    const now = new Date()
    const nisa = buildNisaReport(trades, engine.realized, now.getFullYear())
    const fx = attributeFx(engine.realized)

    const maxedGrowth = nisa.annual.find((frame) => frame.frame === 'NISA_GROWTH' && frame.isMaxed)
    const invested = engine.positions.reduce(
      (running, position) => running.add(position.costBasisJpy),
      ZERO,
    )

    const week = currentWeek(now)
    const monthStart = `${now.toISOString().slice(0, 7)}-01`
    const monthEnd = `${now.toISOString().slice(0, 7)}-31`

    return {
      tradeCount: trades.length,
      openPositions: engine.positions.length,
      realizedJpy: stats.netPnl.toFixed(0),
      investedAtCostJpy: invested.toFixed(0),
      grossLossJpy: stats.grossLoss.toFixed(0),
      grossProfitJpy: stats.grossProfit.toFixed(0),
      winRate: stats.winRate,
      profitFactor: stats.profitFactor,
      maxDrawdownJpy: stats.maxDrawdown.toFixed(0),
      week: summarize(engine.realized, 'This week', week.from, week.to),
      month: summarize(engine.realized, 'This month', monthStart, monthEnd),
      monthly: monthlySeries(engine.realized),
      nisaLifetimeUsed: nisa.lifetime.used.toFixed(0),
      nisaLifetimeRemaining: nisa.lifetime.remaining.toFixed(0),
      nisaPendingRestoration: nisa.lifetime.pendingRestoration.toFixed(0),
      nisaRestorationDate: nisa.lifetime.restorationDate,
      nisaGrowthMaxedYear: maxedGrowth?.year ?? null,
      stockEffectJpy: fx.stockEffectJpy.toFixed(0),
      fxEffectJpy: fx.fxEffectJpy.toFixed(0),
      fxShare: fx.fxShare,
      equityCurve: stats.equityCurve.map((point) => ({
        date: point.date,
        value: point.value.toFixed(0),
      })),
    }
  })

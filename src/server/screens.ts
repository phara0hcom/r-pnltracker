/**
 * Server functions backing the analysis screens.
 *
 * Each returns a flat, already-formatted shape so the client does no financial
 * arithmetic — `Decimal` values cross the wire as strings and are only ever
 * formatted for display, never recomputed.
 */
import { createServerFn } from '@tanstack/react-start'
import { and, eq } from 'drizzle-orm'
import { authed } from './middleware'
import { db } from '~/db'
import { fromDividendRow, instrumentId } from '~/db/mappers'
import { listNotes } from '~/db/notes.service'
import {
  dividends as dividendsTable,
  fxRates,
  instruments,
  priceCache,
  priceOverrides,
} from '~/db/schema'
import { listTrades } from '~/db/trades.service'
import { accountFilterInput } from '~/lib/accountScope'
import {
  matchesAccountFilter,
  OPENING_SIDES,
  ZERO,
  type AccountFilter,
  type AssetClass,
  type TradeSide,
} from '~/lib/domain/types'
import { todayLocal } from '~/lib/localDate'
import { daysUntilYearEnd } from '~/lib/nisa/daysLeft'
import {
  ANNUAL_GROWTH_LIMIT,
  ANNUAL_TSUMITATE_LIMIT,
  buildNisaReport,
  legacyNisaBookValue,
} from '~/lib/nisa/quota'
import { runEngine } from '~/lib/pnl/engine'
import { attributeFx } from '~/lib/pnl/fxAttribution'
import { holdingWindows, longestHoldBySymbol } from '~/lib/pnl/holdings'
import { bySymbol, computeStats, dailyPnl } from '~/lib/stats/stats'
import { findReinvestment } from '~/lib/tax/reinvestment'
import { buildYearOverYear, type TaxYearBasis } from '~/lib/tax/report'

/**
 * Loads trades and runs the engine once — every screen starts here.
 *
 * The account filter is applied to the trades *before* the engine runs, which
 * is exact rather than approximate: pools are keyed `(symbol × accountType)`,
 * so dropping whole accounts cannot alter the pools that remain. Filtering the
 * engine's *output* instead would be wrong — a 特定 sell would still have been
 * averaged against NISA units.
 */
export async function engineFor(userId: string, account: AccountFilter = 'ALL') {
  const records = await listTrades(userId)
  const everyTrade = records.map((record) => record.trade)
  const list = everyTrade.filter((trade) => matchesAccountFilter(trade.accountType, account))
  // `unfilteredTrades` is returned for the rare lookup that must see across the
  // switch — matching a 再投資 to its dividend, where Rakuten's two rows can sit
  // in different accounts. Everything else wants `trades`.
  //
  // `records` carries the row ids, memos and per-trade journals alongside. The
  // calendar needs those and used to re-read them with a second `listTrades`,
  // which fetched and re-mapped the whole history twice per month viewed.
  return { records, trades: list, unfilteredTrades: everyTrade, engine: runEngine(list) }
}

/** This user's hand-entered prices, keyed by instrument id. */
async function overridesFor(userId: string) {
  const rows = await db
    .select({ instrumentId: priceOverrides.instrumentId, price: priceOverrides.price })
    .from(priceOverrides)
    .where(eq(priceOverrides.userId, userId))
  return new Map(rows.map((row) => [row.instrumentId, row.price]))
}

/**
 * Last fetched USD/JPY, or null when none has ever been stored.
 *
 * Unscoped by user on purpose: an exchange rate is market data, not user data.
 */
async function usdJpyRate() {
  const [row] = await db
    .select({ rate: fxRates.rate })
    .from(fxRates)
    .where(and(eq(fxRates.base, 'USD'), eq(fxRates.quote, 'JPY')))
  return row ? ZERO.add(row.rate) : null
}

/** Attributed dividends, read back from storage rather than re-derived. */
async function dividendsFor(userId: string) {
  const rows = await db
    .select()
    .from(dividendsTable)
    .where(eq(dividendsTable.userId, userId))
  return rows.map(fromDividendRow)
}

// ── Positions ───────────────────────────────────────────────────────────────

export interface PositionRow {
  symbol: string
  name: string
  assetClass: 'JP_EQUITY' | 'US_EQUITY' | 'FUND'
  accountType: string
  quantity: string
  costBasisJpy: string
  avgCostPerUnit: string
  avgPriceNative: string
  avgFxRate: string
  currency: 'JPY' | 'USD'
  /** Null when no price is cached — the app never invents a valuation. */
  currentPrice: string | null
  priceAsOf: string | null
  priceSource: string | null
  marketValueJpy: string | null
  unrealizedJpy: string | null
  unrealizedPct: number | null
}

export const getPositions = createServerFn({ method: 'GET' })
  .middleware([authed])
  .validator(accountFilterInput)
  .handler(async ({ data, context }): Promise<PositionRow[]> => {
    const { engine } = await engineFor(context.userId, data.account)

    const [priced, overrides, liveFx] = await Promise.all([
      db
        .select({ price: priceCache, instrument: instruments })
        .from(priceCache)
        .innerJoin(instruments, eq(priceCache.instrumentId, instruments.id)),
      overridesFor(context.userId),
      usdJpyRate(),
    ])
    const priceBySymbol = new Map(priced.map((row) => [row.instrument.symbol, row.price]))

    return engine.positions
      .map((position) => {
        const avgCost = position.costBasisJpy.div(position.quantity)
        const cached = priceBySymbol.get(position.symbol)
        const override = overrides.get(instrumentId(position.symbol)) ?? null
        // A manual override always wins over a fetched quote.
        const currentPrice = override ?? cached?.price ?? null

        let marketValueJpy: string | null = null
        let unrealizedJpy: string | null = null
        let unrealizedPct: number | null = null

        if (currentPrice) {
          // USD quotes convert at the live rate, so unrealized P&L includes the
          // currency move — for a JPY-based holder that is a real part of the
          // position's value, not a rounding detail. The entry rate is used only
          // until a rate has ever been fetched; it makes the currency component
          // read as zero, which is wrong but at least not invented.
          const rate =
            position.assetClass === 'US_EQUITY' ? (liveFx ?? position.avgFxRate) : ZERO.add(1)
          const marketValue = ZERO.add(currentPrice).mul(position.quantity).mul(rate)
          marketValueJpy = marketValue.toFixed(0)
          const gain = marketValue.sub(position.costBasisJpy)
          unrealizedJpy = gain.toFixed(0)
          unrealizedPct = position.costBasisJpy.gt(0)
            ? gain.div(position.costBasisJpy).toNumber()
            : null
        }

        return {
          symbol: position.symbol,
          name: position.name,
          assetClass: position.assetClass,
          accountType: position.accountType,
          quantity: position.quantity.toFixed(),
          costBasisJpy: position.costBasisJpy.toFixed(0),
          avgCostPerUnit: avgCost.toFixed(4),
          avgPriceNative: position.avgPriceNative.toFixed(4),
          avgFxRate: position.avgFxRate.toFixed(2),
          currency: position.assetClass === 'US_EQUITY' ? ('USD' as const) : ('JPY' as const),
          currentPrice,
          priceAsOf: cached?.asOf.toISOString() ?? null,
          priceSource: override ? 'MANUAL' : (cached?.source ?? null),
          marketValueJpy,
          unrealizedJpy,
          unrealizedPct,
        }
      })
      .sort((left, right) => Number(right.costBasisJpy) - Number(left.costBasisJpy))
  })

// ── NISA ────────────────────────────────────────────────────────────────────

export interface NisaScreenData {
  year: number
  lifetimeUsed: string
  lifetimeLimit: string
  lifetimeRemaining: string
  lifetimeUtilization: number
  growthUsed: string
  growthSubCap: string
  growthRemaining: string
  tsumitateUsed: string
  pendingRestoration: string
  restorationDate: string
  legacyBookValue: string
  /** Days from today to 31 December — the current year's annual frames expire then. */
  daysLeftInYear: number
  annual: {
    year: number
    frame: 'NISA_GROWTH' | 'NISA_TSUMITATE'
    limit: string
    used: string
    remaining: string
    utilization: number
    isMaxed: boolean
  }[]
  contributions: { year: number; growth: string; tsumitate: string }[]
}

export const getNisa = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(async ({ context }): Promise<NisaScreenData> => {
    const { trades: list, engine } = await engineFor(context.userId)
    const year = new Date().getFullYear()
    const report = buildNisaReport(list, engine.realized, year)

    return {
      year,
      lifetimeUsed: report.lifetime.used.toFixed(0),
      lifetimeLimit: report.lifetime.limit.toFixed(0),
      lifetimeRemaining: report.lifetime.remaining.toFixed(0),
      lifetimeUtilization: report.lifetime.utilization,
      growthUsed: report.lifetime.growthUsed.toFixed(0),
      growthSubCap: report.lifetime.growthSubCap.toFixed(0),
      growthRemaining: report.lifetime.growthRemaining.toFixed(0),
      tsumitateUsed: report.lifetime.tsumitateUsed.toFixed(0),
      pendingRestoration: report.lifetime.pendingRestoration.toFixed(0),
      restorationDate: report.lifetime.restorationDate,
      legacyBookValue: legacyNisaBookValue(engine.positions).toFixed(0),
      daysLeftInYear: daysUntilYearEnd(todayLocal()),
      annual: report.annual.map((frame) => ({
        year: frame.year,
        frame: frame.frame,
        limit: frame.limit.toFixed(0),
        used: frame.used.toFixed(0),
        remaining: frame.remaining.toFixed(0),
        utilization: frame.utilization,
        isMaxed: frame.isMaxed,
      })),
      contributions: report.contributionsByYear.map((contribution) => ({
        year: contribution.year,
        growth: contribution.growth.toFixed(0),
        tsumitate: contribution.tsumitate.toFixed(0),
      })),
    }
  })

export const NISA_ANNUAL_LIMITS = {
  growth: ANNUAL_GROWTH_LIMIT.toFixed(0),
  tsumitate: ANNUAL_TSUMITATE_LIMIT.toFixed(0),
}

// ── Tax ─────────────────────────────────────────────────────────────────────

export interface TaxScreenData {
  basis: TaxYearBasis
  years: {
    year: number
    taxableGains: string
    taxableLosses: string
    netTaxable: string
    estimatedTax: string
    incomePortion: string
    localPortion: string
    dividendGross: string
    dividendWithheld: string
    nisaGains: string
    nisaDividends: string
    carryforwardLoss: string
    tradeCount: number
    winRate: number | null
    netAfterTax: string
    /** `estimatedTax / taxableGains`, as a share of *gross* gains. Null when there were none. */
    effectiveRate: number | null
  }[]
  totals: {
    taxableGains: string
    estimatedTax: string
    nisaGains: string
    netAfterTax: string
  }
  cumulative: { year: number; value: string }[]
  dividends: {
    payDate: string
    kind: string
    accountType: string
    grossAmount: string
    tax: string
    netAmount: string
    isTaxable: boolean
    confident: boolean
  }[]
}

export const getTax = createServerFn({ method: 'GET' })
  .middleware([authed])
  .validator((data: { basis?: TaxYearBasis } | undefined) => data ?? {})
  .handler(async ({ data, context }): Promise<TaxScreenData> => {
    const basis: TaxYearBasis = data.basis ?? 'CALENDAR'
    const { engine } = await engineFor(context.userId)
    const divs = await dividendsFor(context.userId)
    const yoy = buildYearOverYear(engine.realized, divs, basis)

    return {
      basis,
      years: yoy.years.map((summary) => ({
        year: summary.year,
        taxableGains: summary.taxableGains.toFixed(0),
        taxableLosses: summary.taxableLosses.toFixed(0),
        netTaxable: summary.netTaxable.toFixed(0),
        estimatedTax: summary.estimatedCapitalGainsTax.toFixed(0),
        incomePortion: summary.incomeTaxPortion.toFixed(0),
        localPortion: summary.localTaxPortion.toFixed(0),
        dividendGross: summary.dividendGross.toFixed(0),
        dividendWithheld: summary.dividendTaxWithheld.toFixed(0),
        nisaGains: summary.nisaGains.toFixed(0),
        nisaDividends: summary.nisaDividends.toFixed(0),
        carryforwardLoss: summary.carryforwardLoss.toFixed(0),
        tradeCount: summary.tradeCount,
        winRate: summary.winRate,
        netAfterTax: summary.netAfterTax.toFixed(0),
        effectiveRate: summary.taxableGains.gt(0)
          ? summary.estimatedCapitalGainsTax.div(summary.taxableGains).toNumber()
          : null,
      })),
      totals: {
        taxableGains: yoy.totals.taxableGains.toFixed(0),
        estimatedTax: yoy.totals.estimatedTax.toFixed(0),
        nisaGains: yoy.totals.nisaGains.toFixed(0),
        netAfterTax: yoy.totals.netAfterTax.toFixed(0),
      },
      cumulative: yoy.cumulativeNetAfterTax.map((point) => ({
        year: point.year,
        value: point.value.toFixed(0),
      })),
      dividends: divs.map((payout) => ({
        payDate: payout.payDate,
        kind: payout.kind,
        accountType: payout.accountType,
        grossAmount: payout.grossAmount.toFixed(0),
        tax: payout.incomeTax.add(payout.localTax).toFixed(0),
        netAmount: payout.netAmount.toFixed(0),
        isTaxable: payout.isTaxable,
        confident: payout.attributionConfident,
      })),
    }
  })

// ── Dividends ───────────────────────────────────────────────────────────────

export interface DividendRow {
  payDate: string
  symbol: string
  name: string
  assetClass: AssetClass
  accountType: string
  /** DIVIDEND = equity 配当金; DISTRIBUTION = fund 分配金. */
  kind: string
  grossAmount: string
  incomeTax: string
  localTax: string
  netAmount: string
  isTaxable: boolean
  /**
   * False when the paying account had to be inferred — the statement's cash
   * ledger has no account column, so a payment arriving after the position
   * closed cannot be tied back with certainty.
   */
  confident: boolean
  /**
   * The 再投資 trade this distribution was rolled into, when one matches.
   * A fund distribution is income *and* a cost-basis-bearing buy; showing only
   * the income half is what makes fund P&L look overstated.
   */
  reinvestedJpy: string | null
  reinvestedUnits: string | null
}

export interface DividendScreenData {
  rows: DividendRow[]
  totals: {
    gross: string
    tax: string
    net: string
    /** Received into NISA — no withholding, and none is ever owed. */
    taxFreeGross: string
    taxableGross: string
    count: number
  }
  byYear: { year: number; gross: string; tax: string; net: string; count: number }[]
  bySymbol: {
    symbol: string
    name: string
    assetClass: AssetClass
    gross: string
    net: string
    count: number
    lastPaid: string
  }[]
  /** True when any row's account was inferred rather than matched. */
  hasInferred: boolean
  /**
   * US trading shape, for the "no US income recorded" note.
   *
   * Whether US dividends are actually missing or were simply never earned is not
   * answerable from the exports, so the note reports holding periods and lets
   * the reader judge — a position closed inside a month rarely crosses a
   * quarterly record date.
   */
  usHoldings: {
    tickerCount: number
    longestHoldDays: number
    /** Tickers whose longest continuous hold stayed under a month. */
    shortHoldCount: number
    /** Tickers held long enough to plausibly span a quarterly record date. */
    quarterSpanning: { symbol: string; days: number }[]
  }
}

export const getDividends = createServerFn({ method: 'GET' })
  .middleware([authed])
  .validator(accountFilterInput)
  .handler(async ({ data, context }): Promise<DividendScreenData> => {
    const [allRows, { trades: scopedTrades, unfilteredTrades }] = await Promise.all([
      db
        .select({ d: dividendsTable, instrument: instruments })
        .from(dividendsTable)
        .leftJoin(instruments, eq(dividendsTable.instrumentId, instruments.id))
        .where(eq(dividendsTable.userId, context.userId)),
      engineFor(context.userId, data.account),
    ])

    // Dividends carry their own attributed account, so they are filtered on
    // that rather than inherited from the trade filter — a payment can land in
    // an account whose position has since been closed.
    const rows = allRows.filter((row) => matchesAccountFilter(row.d.accountType, data.account))

    const out: DividendRow[] = rows.map(({ d: payout, instrument }) => {
      const netAmount = ZERO.add(payout.netAmount).toFixed(0)
      const symbol = instrument?.symbol ?? ''
      // Matched against *every* trade, deliberately not `scopedTrades`: Rakuten
      // can file the 再投資 under a different account than the payment, and
      // scoping the search drops one half of a real pair.
      const reinvested =
        payout.kind === 'DISTRIBUTION'
          ? findReinvestment(unfilteredTrades, symbol, payout.payDate, netAmount)
          : null

      return {
        payDate: payout.payDate,
        symbol,
        name: instrument?.name ?? symbol,
        assetClass: instrument?.assetClass ?? 'JP_EQUITY',
        accountType: payout.accountType,
        kind: payout.kind,
        grossAmount: ZERO.add(payout.grossAmount).toFixed(0),
        incomeTax: ZERO.add(payout.incomeTax).toFixed(0),
        localTax: ZERO.add(payout.localTax).toFixed(0),
        netAmount,
        isTaxable: payout.isTaxable,
        confident: payout.attributionConfident,
        reinvestedJpy: reinvested ? reinvested.netAmountJpy.toFixed(0) : null,
        reinvestedUnits: reinvested ? reinvested.quantity.toFixed() : null,
      }
    })

    // Newest first.
    out.sort((left, right) =>
      left.payDate === right.payDate ? 0 : left.payDate < right.payDate ? 1 : -1,
    )

    const sumRows = (rows: DividendRow[], pick: (row: DividendRow) => string) =>
      rows.reduce((running, row) => running.add(pick(row)), ZERO)

    /** Groups rows in place; the push form avoids rebuilding the array per row. */
    const groupBy = <K,>(keyOf: (row: DividendRow) => K) => {
      const groups = new Map<K, DividendRow[]>()
      for (const row of out) {
        const key = keyOf(row)
        const existing = groups.get(key)
        if (existing) existing.push(row)
        else groups.set(key, [row])
      }
      return groups
    }

    const byYear = groupBy((row) => Number(row.payDate.slice(0, 4)))
    const bySymbolKey = groupBy((row) => row.symbol)

    return {
      rows: out,
      totals: {
        gross: sumRows(out, (row) => row.grossAmount).toFixed(0),
        tax: sumRows(out, (row) => row.incomeTax)
          .add(sumRows(out, (row) => row.localTax))
          .toFixed(0),
        net: sumRows(out, (row) => row.netAmount).toFixed(0),
        taxFreeGross: sumRows(
          out.filter((row) => !row.isTaxable),
          (row) => row.grossAmount,
        ).toFixed(0),
        taxableGross: sumRows(
          out.filter((row) => row.isTaxable),
          (row) => row.grossAmount,
        ).toFixed(0),
        count: out.length,
      },
      byYear: [...byYear.entries()]
        // Newest year first, matching the row order above.
        .sort(([left], [right]) => right - left)
        .map(([year, rows]) => ({
          year,
          gross: sumRows(rows, (row) => row.grossAmount).toFixed(0),
          tax: sumRows(rows, (row) => row.incomeTax)
            .add(sumRows(rows, (row) => row.localTax))
            .toFixed(0),
          net: sumRows(rows, (row) => row.netAmount).toFixed(0),
          count: rows.length,
        })),
      bySymbol: [...bySymbolKey.values()]
        .map((rows) => {
          const first = rows[0]!
          return {
            symbol: first.symbol,
            name: first.name,
            assetClass: first.assetClass,
            gross: sumRows(rows, (row) => row.grossAmount).toFixed(0),
            net: sumRows(rows, (row) => row.netAmount).toFixed(0),
            count: rows.length,
            // Rows are already newest-first, so the first is the latest payment.
            lastPaid: first.payDate,
          }
        })
        .sort((left, right) => Number(right.gross) - Number(left.gross)),
      hasInferred: out.some((row) => !row.confident),
      usHoldings: (() => {
        const longestBySymbol = longestHoldBySymbol(
          holdingWindows(
            // Scoped, unlike the 再投資 lookup above: this describes how long
            // the selected accounts held US names, so it must follow the switch.
            scopedTrades.filter((trade) => trade.assetClass === 'US_EQUITY'),
            todayLocal(),
          ),
        )
        const entries = [...longestBySymbol.entries()]
        const A_MONTH = 31
        const A_QUARTER = 90
        return {
          tickerCount: entries.length,
          longestHoldDays: Math.max(0, ...entries.map(([, days]) => days)),
          shortHoldCount: entries.filter(([, days]) => days < A_MONTH).length,
          quarterSpanning: entries
            .filter(([, days]) => days >= A_QUARTER)
            .map(([symbol, days]) => ({ symbol, days }))
            .sort((left, right) => right.days - left.days),
        }
      })(),
    }
  })

// ── Stats ───────────────────────────────────────────────────────────────────

export interface StatsScreenData {
  tradeCount: number
  winCount: number
  lossCount: number
  winRate: number | null
  grossProfit: string
  grossLoss: string
  netPnl: string
  avgWin: string | null
  avgLoss: string | null
  payoffRatio: number | null
  profitFactor: number | null
  maxDrawdown: string
  maxDrawdownPct: number | null
  longestWinStreak: number
  longestLossStreak: number
  avgHoldingDays: number | null
  medianHoldingDays: number | null
  equityCurve: { date: string; value: string }[]
  byAccount: { key: string; tradeCount: number; winRate: number | null; netPnl: string; profitFactor: number | null }[]
  byAssetClass: { key: string; tradeCount: number; winRate: number | null; netPnl: string; profitFactor: number | null }[]
  symbols: { symbol: string; name: string; tradeCount: number; netPnl: string; winRate: number }[]
  fx: {
    closes: number
    stockEffect: string
    fxEffect: string
    costEffect: string
    total: string
    fxShare: number | null
    avgEntryFx: string
    avgExitFx: string
  }
  /** Realized P&L per day, paired with that day's journal entry. */
  moodCorrelation: { mood: number; days: number; totalPnl: string; avgPnl: string }[]
  motivationCorrelation: { motivation: number; days: number; totalPnl: string; avgPnl: string }[]
  /**
   * Every close, oldest first — the trade-distribution section's own data.
   *
   * Sent whole rather than per period so paging through months or weeks costs
   * no round-trip, the same trade the dashboard's monthly chart makes. It is
   * also what lets the circle and axis scales be fixed to the full history:
   * a window-at-a-time feed could only ever scale to what it could see.
   */
  closes: StatsClose[]
}

/** One realized close, as the trade-distribution table and chart render it. */
export interface StatsClose {
  /** Trade date of the sale, `YYYY-MM-DD`. Not the settlement date: this is a
   *  behavioural view of when you traded, not a tax one. */
  date: string
  symbol: string
  name: string
  accountType: string
  quantity: string
  /** JPY cost of exactly the units sold. */
  costJpy: string
  realizedJpy: string
  /**
   * Realized ÷ cost basis of the units sold.
   *
   * Null when that basis is zero — a pool built entirely from 再投資 rows can
   * close with nothing to measure the return against. Such a close still
   * appears in the table; it has no height on the chart, so it is left out
   * there and counted in the note beneath it.
   */
  returnPct: number | null
  holdingDays: number
}

export const getStats = createServerFn({ method: 'GET' })
  .middleware([authed])
  .validator(accountFilterInput)
  .handler(async ({ data, context }): Promise<StatsScreenData> => {
    const { engine } = await engineFor(context.userId, data.account)
    const stats = computeStats(engine.realized)
    const fx = attributeFx(engine.realized)
    const daily = dailyPnl(engine.realized)
    const journal = await listNotes(context.userId)

    /** Same stats recomputed per bucket, dropping buckets with no closes. */
    const group = (keys: string[], filterFor: (key: string) => Parameters<typeof computeStats>[1]) =>
      keys
        .map((key) => {
          const bucketStats = computeStats(engine.realized, filterFor(key))
          return {
            key,
            tradeCount: bucketStats.tradeCount,
            winRate: bucketStats.winRate,
            netPnl: bucketStats.netPnl.toFixed(0),
            profitFactor: bucketStats.profitFactor,
          }
        })
        .filter((bucketStats) => bucketStats.tradeCount > 0)

    /** Bucket each journalled day's realized P&L by its 1–5 score. */
    const bucket = (field: 'mood' | 'motivation') => {
      const byScore = new Map<number, { days: number; total: typeof ZERO }>()
      for (const note of journal) {
        const score = note[field]
        if (score == null) continue
        const dayPnl = daily.get(note.date)
        if (!dayPnl) continue
        const running = byScore.get(score) ?? { days: 0, total: ZERO }
        byScore.set(score, { days: running.days + 1, total: running.total.add(dayPnl) })
      }
      return [...byScore.entries()]
        .sort(([lowerScore], [higherScore]) => lowerScore - higherScore)
        .map(([score, totals]) => ({
          [field]: score,
          days: totals.days,
          totalPnl: totals.total.toFixed(0),
          avgPnl: totals.total.div(totals.days).toFixed(0),
        }))
    }

    return {
      tradeCount: stats.tradeCount,
      winCount: stats.winCount,
      lossCount: stats.lossCount,
      winRate: stats.winRate,
      grossProfit: stats.grossProfit.toFixed(0),
      grossLoss: stats.grossLoss.toFixed(0),
      netPnl: stats.netPnl.toFixed(0),
      avgWin: stats.avgWin?.toFixed(0) ?? null,
      avgLoss: stats.avgLoss?.toFixed(0) ?? null,
      payoffRatio: stats.payoffRatio,
      profitFactor: stats.profitFactor,
      maxDrawdown: stats.maxDrawdown.toFixed(0),
      maxDrawdownPct: stats.maxDrawdownPct,
      longestWinStreak: stats.longestWinStreak,
      longestLossStreak: stats.longestLossStreak,
      avgHoldingDays: stats.avgHoldingDays,
      medianHoldingDays: stats.medianHoldingDays,
      equityCurve: stats.equityCurve.map((point) => ({
        date: point.date,
        value: point.value.toFixed(0),
      })),
      byAccount: group(['SPECIFIC', 'NISA_GROWTH', 'NISA_TSUMITATE', 'NISA_OLD'], (accountType) => ({
        accountTypes: [accountType as 'SPECIFIC'],
      })),
      byAssetClass: group(['JP_EQUITY', 'US_EQUITY', 'FUND'], (assetClass) => ({
        assetClasses: [assetClass as 'JP_EQUITY'],
      })),
      symbols: bySymbol(engine.realized).map((performance) => ({
        symbol: performance.symbol,
        name: performance.name,
        tradeCount: performance.tradeCount,
        netPnl: performance.netPnl.toFixed(0),
        winRate: performance.winRate,
      })),
      fx: {
        closes: fx.events.length,
        stockEffect: fx.stockEffectJpy.toFixed(0),
        fxEffect: fx.fxEffectJpy.toFixed(0),
        costEffect: fx.costEffectJpy.toFixed(0),
        total: fx.totalJpy.toFixed(0),
        fxShare: fx.fxShare,
        avgEntryFx: fx.avgEntryFx.toFixed(2),
        avgExitFx: fx.avgExitFx.toFixed(2),
      },
      moodCorrelation: bucket('mood') as StatsScreenData['moodCorrelation'],
      motivationCorrelation: bucket('motivation') as StatsScreenData['motivationCorrelation'],
      // Already chronological — the engine emits closes in the order it
      // processes them — so the client can take the first and last as the range
      // it may page over without sorting again.
      closes: engine.realized.map((close) => ({
        date: close.tradeDate,
        symbol: close.symbol,
        name: close.name,
        accountType: close.accountType,
        quantity: close.quantity.toFixed(),
        costJpy: close.costJpy.toFixed(0),
        realizedJpy: close.realizedJpy.toFixed(0),
        returnPct: close.costJpy.gt(0) ? close.realizedJpy.div(close.costJpy).toNumber() : null,
        holdingDays: close.holdingDays,
      })),
    }
  })

// ── Calendar ────────────────────────────────────────────────────────────────

/** One trade as the calendar day dialog shows it. */
export interface CalendarTrade {
  id: string
  symbol: string
  name: string
  accountType: string
  /** Drives the TradingView venue prefix — funds have no chart to link to. */
  assetClass: AssetClass
  side: TradeSide
  quantity: string
  /** Per unit, in the instrument's own currency. Funds are per 10,000 口. */
  unitPrice: string
  currency: string
  /** Cash paid on a buy, or received on a sell. Always JPY. */
  amountJpy: string
  /** Null on opening trades — a buy has no realized P&L. */
  realizedJpy: string | null
  returnPct: number | null
  /**
   * Weighted-average cost of the units sold, in the instrument's own currency.
   *
   * There is no link back to an individual buy: 移動平均法 pools units, so a
   * sell closes against the pool average rather than an identified lot. This is
   * the closest thing to "what this sell was measured against".
   */
  entryPrice: string | null
  /** Days from the quantity-weighted mean acquisition date to this sale. */
  holdingDays: number | null
  memo: string | null
  motivation: number | null
}

export interface CalendarDay {
  date: string
  realizedJpy: string | null
  tradeCount: number
  trades: CalendarTrade[]
  note: {
    title: string
    body: string
    mood: number | null
    motivation: number | null
    tags: string[]
  } | null
}

export const getCalendar = createServerFn({ method: 'GET' })
  .middleware([authed])
  .validator((data: { month: string; account?: string }) => ({
    month: data.month,
    ...accountFilterInput(data),
  }))
  .handler(async ({ data, context }): Promise<CalendarDay[]> => {
    // `month` is YYYY-MM; build the inclusive day range for it.
    const [y, m] = data.month.split('-').map(Number)
    const year = y ?? new Date().getFullYear()
    const month = m ?? new Date().getMonth() + 1
    const first = `${String(year)}-${String(month).padStart(2, '0')}-01`
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const last = `${String(year)}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    const { engine, records } = await engineFor(context.userId, data.account)
    const daily = dailyPnl(engine.realized)

    // Realized events keyed the same way the engine keys them, so a close can
    // be matched back to the row that produced it.
    const realizedByKey = new Map<
      string,
      { realized: string; pct: number | null; entryPrice: string; holdingDays: number }
    >()
    for (const close of engine.realized) {
      realizedByKey.set(
        `${close.tradeDate}|${close.symbol}|${close.accountType}|${close.quantity.toFixed()}`,
        {
          realized: close.realizedJpy.toFixed(0),
          pct: close.costJpy.gt(0) ? close.realizedJpy.div(close.costJpy).toNumber() : null,
          // Same per-10,000 convention as the exit price, so the two are
          // directly comparable on screen.
          entryPrice:
            close.assetClass === 'FUND'
              ? close.entryPriceNative.mul(10_000).toFixed(0)
              : close.entryPriceNative.toFixed(close.assetClass === 'US_EQUITY' ? 2 : 1),
          holdingDays: close.holdingDays,
        },
      )
    }

    const byDate = new Map<string, CalendarTrade[]>()
    for (const record of records) {
      const trade = record.trade
      if (trade.tradeDate < first || trade.tradeDate > last) continue
      if (!matchesAccountFilter(trade.accountType, data.account)) continue
      const isClose = trade.side === 'SELL' || trade.side === 'REDEEM'
      const realized = realizedByKey.get(
        `${trade.tradeDate}|${trade.symbol}|${trade.accountType}|${trade.quantity.toFixed()}`,
      )
      const dayTrades = byDate.get(trade.tradeDate) ?? []
      dayTrades.push({
        id: record.id,
        symbol: trade.symbol,
        name: trade.name,
        accountType: trade.accountType,
        assetClass: trade.assetClass,
        side: trade.side,
        quantity: trade.quantity.toFixed(),
        // Funds are stored per single 口 but quoted per 10,000, so display the
        // figure Rakuten shows rather than the internal one.
        unitPrice:
          trade.assetClass === 'FUND'
            ? trade.unitPrice.mul(10_000).toFixed(0)
            : trade.unitPrice.toFixed(trade.currency === 'USD' ? 2 : 1),
        currency: trade.currency,
        amountJpy: trade.netAmountJpy.toFixed(0),
        realizedJpy: isClose ? (realized?.realized ?? null) : null,
        returnPct: isClose ? (realized?.pct ?? null) : null,
        entryPrice: isClose ? (realized?.entryPrice ?? null) : null,
        holdingDays: isClose ? (realized?.holdingDays ?? null) : null,
        memo: record.memo,
        motivation: record.motivation,
      })
      byDate.set(trade.tradeDate, dayTrades)
    }

    // Rakuten's exports carry no execution time — only 約定日 — so there is no
    // true intraday order to restore. Group by instrument instead, opens before
    // closes, which puts a same-day round trip on adjacent rows and matches the
    // order the engine processed that pool in.
    for (const dayTrades of byDate.values()) {
      dayTrades.sort((left, right) => {
        if (left.symbol !== right.symbol) return left.symbol.localeCompare(right.symbol)
        if (left.accountType !== right.accountType)
          return left.accountType.localeCompare(right.accountType)
        const leftOpens = OPENING_SIDES.includes(left.side) ? 0 : 1
        const rightOpens = OPENING_SIDES.includes(right.side) ? 0 : 1
        return leftOpens - rightOpens
      })
    }

    const journal = new Map(
      (await listNotes(context.userId, first, last)).map((note) => [note.date, note]),
    )

    const days: CalendarDay[] = []
    for (let dayOfMonth = 1; dayOfMonth <= lastDay; dayOfMonth++) {
      const date = `${String(year)}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`
      const pnl = daily.get(date)
      const note = journal.get(date)
      const dayTrades = byDate.get(date) ?? []
      days.push({
        date,
        realizedJpy: pnl ? pnl.toFixed(0) : null,
        tradeCount: dayTrades.length,
        trades: dayTrades,
        note: note
          ? {
              title: note.title,
              body: note.body,
              mood: note.mood,
              motivation: note.motivation,
              tags: note.tags,
            }
          : null,
      })
    }
    return days
  })

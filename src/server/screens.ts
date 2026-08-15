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
import { OPENING_SIDES, ZERO, type AssetClass, type TradeSide } from '~/lib/domain/types'
import { todayLocal } from '~/lib/localDate'
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
import { buildYearOverYear, type TaxYearBasis } from '~/lib/tax/report'

/** Loads trades and runs the engine once — every screen starts here. */
async function engineFor(userId: string) {
  const records = await listTrades(userId)
  const list = records.map((r) => r.trade)
  return { trades: list, engine: runEngine(list) }
}

/** This user's hand-entered prices, keyed by instrument id. */
async function overridesFor(userId: string) {
  const rows = await db
    .select({ instrumentId: priceOverrides.instrumentId, price: priceOverrides.price })
    .from(priceOverrides)
    .where(eq(priceOverrides.userId, userId))
  return new Map(rows.map((r) => [r.instrumentId, r.price]))
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
  .handler(async ({ context }): Promise<PositionRow[]> => {
    const { engine } = await engineFor(context.userId)

    const [priced, overrides, liveFx] = await Promise.all([
      db
        .select({ price: priceCache, instrument: instruments })
        .from(priceCache)
        .innerJoin(instruments, eq(priceCache.instrumentId, instruments.id)),
      overridesFor(context.userId),
      usdJpyRate(),
    ])
    const priceBySymbol = new Map(priced.map((p) => [p.instrument.symbol, p.price]))

    return engine.positions
      .map((p) => {
        const avgCost = p.costBasisJpy.div(p.quantity)
        const cached = priceBySymbol.get(p.symbol)
        const override = overrides.get(instrumentId(p.symbol)) ?? null
        // A manual override always wins over a fetched quote.
        const raw = override ?? cached?.price ?? null

        let marketValueJpy: string | null = null
        let unrealizedJpy: string | null = null
        let unrealizedPct: number | null = null

        if (raw) {
          // USD quotes convert at the live rate, so unrealized P&L includes the
          // currency move — for a JPY-based holder that is a real part of the
          // position's value, not a rounding detail. The entry rate is used only
          // until a rate has ever been fetched; it makes the currency component
          // read as zero, which is wrong but at least not invented.
          const fx = p.assetClass === 'US_EQUITY' ? (liveFx ?? p.avgFxRate) : ZERO.add(1)
          const value = ZERO.add(raw).mul(p.quantity).mul(fx)
          marketValueJpy = value.toFixed(0)
          const gain = value.sub(p.costBasisJpy)
          unrealizedJpy = gain.toFixed(0)
          unrealizedPct = p.costBasisJpy.gt(0) ? gain.div(p.costBasisJpy).toNumber() : null
        }

        return {
          symbol: p.symbol,
          name: p.name,
          assetClass: p.assetClass,
          accountType: p.accountType,
          quantity: p.quantity.toFixed(),
          costBasisJpy: p.costBasisJpy.toFixed(0),
          avgCostPerUnit: avgCost.toFixed(4),
          avgPriceNative: p.avgPriceNative.toFixed(4),
          avgFxRate: p.avgFxRate.toFixed(2),
          currency: p.assetClass === 'US_EQUITY' ? ('USD' as const) : ('JPY' as const),
          currentPrice: raw,
          priceAsOf: cached?.asOf.toISOString() ?? null,
          priceSource: override ? 'MANUAL' : (cached?.source ?? null),
          marketValueJpy,
          unrealizedJpy,
          unrealizedPct,
        }
      })
      .sort((a, b) => Number(b.costBasisJpy) - Number(a.costBasisJpy))
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
  pendingRestoration: string
  restorationDate: string
  legacyBookValue: string
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
      pendingRestoration: report.lifetime.pendingRestoration.toFixed(0),
      restorationDate: report.lifetime.restorationDate,
      legacyBookValue: legacyNisaBookValue(engine.positions).toFixed(0),
      annual: report.annual.map((a) => ({
        year: a.year,
        frame: a.frame,
        limit: a.limit.toFixed(0),
        used: a.used.toFixed(0),
        remaining: a.remaining.toFixed(0),
        utilization: a.utilization,
        isMaxed: a.isMaxed,
      })),
      contributions: report.contributionsByYear.map((c) => ({
        year: c.year,
        growth: c.growth.toFixed(0),
        tsumitate: c.tsumitate.toFixed(0),
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
      years: yoy.years.map((y) => ({
        year: y.year,
        taxableGains: y.taxableGains.toFixed(0),
        taxableLosses: y.taxableLosses.toFixed(0),
        netTaxable: y.netTaxable.toFixed(0),
        estimatedTax: y.estimatedCapitalGainsTax.toFixed(0),
        incomePortion: y.incomeTaxPortion.toFixed(0),
        localPortion: y.localTaxPortion.toFixed(0),
        dividendGross: y.dividendGross.toFixed(0),
        dividendWithheld: y.dividendTaxWithheld.toFixed(0),
        nisaGains: y.nisaGains.toFixed(0),
        nisaDividends: y.nisaDividends.toFixed(0),
        carryforwardLoss: y.carryforwardLoss.toFixed(0),
        tradeCount: y.tradeCount,
        winRate: y.winRate,
        netAfterTax: y.netAfterTax.toFixed(0),
      })),
      totals: {
        taxableGains: yoy.totals.taxableGains.toFixed(0),
        estimatedTax: yoy.totals.estimatedTax.toFixed(0),
        nisaGains: yoy.totals.nisaGains.toFixed(0),
        netAfterTax: yoy.totals.netAfterTax.toFixed(0),
      },
      cumulative: yoy.cumulativeNetAfterTax.map((c) => ({
        year: c.year,
        value: c.value.toFixed(0),
      })),
      dividends: divs.map((d) => ({
        payDate: d.payDate,
        kind: d.kind,
        accountType: d.accountType,
        grossAmount: d.grossAmount.toFixed(0),
        tax: d.incomeTax.add(d.localTax).toFixed(0),
        netAmount: d.netAmount.toFixed(0),
        isTaxable: d.isTaxable,
        confident: d.attributionConfident,
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
  .handler(async ({ context }): Promise<DividendScreenData> => {
    const [rows, { trades: allTrades }] = await Promise.all([
      db
        .select({ d: dividendsTable, instrument: instruments })
        .from(dividendsTable)
        .leftJoin(instruments, eq(dividendsTable.instrumentId, instruments.id))
        .where(eq(dividendsTable.userId, context.userId)),
      engineFor(context.userId),
    ])

    // Rakuten books the 再投資 a few days before the payment date and does not
    // always file it under the account the payment was attributed to, so the
    // match is on instrument + exact amount within a short window rather than
    // on an id — there is no id linking the two in any export.
    const reinvestments = allTrades.filter((t) => t.side === 'REINVEST')
    const findReinvestment = (symbol: string, payDate: string, net: string) =>
      reinvestments.find(
        (t) =>
          t.symbol === symbol &&
          t.netAmountJpy.toFixed(0) === net &&
          Math.abs(Date.parse(t.tradeDate) - Date.parse(payDate)) <= 7 * 86_400_000,
      ) ?? null

    const out: DividendRow[] = rows.map(({ d, instrument }) => {
      const net = ZERO.add(d.netAmount).toFixed(0)
      const symbol = instrument?.symbol ?? ''
      const reinvested = d.kind === 'DISTRIBUTION' ? findReinvestment(symbol, d.payDate, net) : null

      return {
        payDate: d.payDate,
        symbol,
        name: instrument?.name ?? symbol,
        assetClass: instrument?.assetClass ?? 'JP_EQUITY',
        accountType: d.accountType,
        kind: d.kind,
        grossAmount: ZERO.add(d.grossAmount).toFixed(0),
        incomeTax: ZERO.add(d.incomeTax).toFixed(0),
        localTax: ZERO.add(d.localTax).toFixed(0),
        netAmount: net,
        isTaxable: d.isTaxable,
        confident: d.attributionConfident,
        reinvestedJpy: reinvested ? reinvested.netAmountJpy.toFixed(0) : null,
        reinvestedUnits: reinvested ? reinvested.quantity.toFixed() : null,
      }
    })

    out.sort((a, b) => (a.payDate === b.payDate ? 0 : a.payDate < b.payDate ? 1 : -1))

    const sum = (pick: (r: DividendRow) => string) =>
      out.reduce((acc, r) => acc.add(pick(r)), ZERO)

    const byYear = new Map<number, DividendRow[]>()
    for (const r of out) {
      const y = Number(r.payDate.slice(0, 4))
      byYear.set(y, [...(byYear.get(y) ?? []), r])
    }

    const bySym = new Map<string, DividendRow[]>()
    for (const r of out) {
      bySym.set(r.symbol, [...(bySym.get(r.symbol) ?? []), r])
    }

    return {
      rows: out,
      totals: {
        gross: sum((r) => r.grossAmount).toFixed(0),
        tax: sum((r) => r.incomeTax).add(sum((r) => r.localTax)).toFixed(0),
        net: sum((r) => r.netAmount).toFixed(0),
        taxFreeGross: out
          .filter((r) => !r.isTaxable)
          .reduce((a, r) => a.add(r.grossAmount), ZERO)
          .toFixed(0),
        taxableGross: out
          .filter((r) => r.isTaxable)
          .reduce((a, r) => a.add(r.grossAmount), ZERO)
          .toFixed(0),
        count: out.length,
      },
      byYear: [...byYear.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([year, list]) => ({
          year,
          gross: list.reduce((a, r) => a.add(r.grossAmount), ZERO).toFixed(0),
          tax: list.reduce((a, r) => a.add(r.incomeTax).add(r.localTax), ZERO).toFixed(0),
          net: list.reduce((a, r) => a.add(r.netAmount), ZERO).toFixed(0),
          count: list.length,
        })),
      bySymbol: [...bySym.values()]
        .map((list) => {
          const first = list[0]!
          return {
            symbol: first.symbol,
            name: first.name,
            assetClass: first.assetClass,
            gross: list.reduce((a, r) => a.add(r.grossAmount), ZERO).toFixed(0),
            net: list.reduce((a, r) => a.add(r.netAmount), ZERO).toFixed(0),
            count: list.length,
            // Rows are already newest-first, so the first is the latest payment.
            lastPaid: first.payDate,
          }
        })
        .sort((a, b) => Number(b.gross) - Number(a.gross)),
      hasInferred: out.some((r) => !r.confident),
      usHoldings: (() => {
        const longest = longestHoldBySymbol(
          holdingWindows(
            allTrades.filter((t) => t.assetClass === 'US_EQUITY'),
            todayLocal(),
          ),
        )
        const entries = [...longest.entries()]
        return {
          tickerCount: entries.length,
          longestHoldDays: Math.max(0, ...entries.map(([, d]) => d)),
          shortHoldCount: entries.filter(([, d]) => d < 31).length,
          quarterSpanning: entries
            .filter(([, d]) => d >= 90)
            .map(([symbol, days]) => ({ symbol, days }))
            .sort((a, b) => b.days - a.days),
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
}

export const getStats = createServerFn({ method: 'GET' })
  .middleware([authed])
  .handler(async ({ context }): Promise<StatsScreenData> => {
    const { engine } = await engineFor(context.userId)
    const s = computeStats(engine.realized)
    const fx = attributeFx(engine.realized)
    const daily = dailyPnl(engine.realized)
    const journal = await listNotes(context.userId)

    const group = (keys: string[], pick: (k: string) => Parameters<typeof computeStats>[1]) =>
      keys
        .map((key) => {
          const g = computeStats(engine.realized, pick(key))
          return {
            key,
            tradeCount: g.tradeCount,
            winRate: g.winRate,
            netPnl: g.netPnl.toFixed(0),
            profitFactor: g.profitFactor,
          }
        })
        .filter((g) => g.tradeCount > 0)

    /** Bucket each journalled day's realized P&L by its 1–5 score. */
    const bucket = (field: 'mood' | 'motivation') => {
      const acc = new Map<number, { days: number; total: typeof ZERO }>()
      for (const note of journal) {
        const score = note[field]
        if (score == null) continue
        const pnl = daily.get(note.date)
        if (!pnl) continue
        const cur = acc.get(score) ?? { days: 0, total: ZERO }
        acc.set(score, { days: cur.days + 1, total: cur.total.add(pnl) })
      }
      return [...acc.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([score, v]) => ({
          [field]: score,
          days: v.days,
          totalPnl: v.total.toFixed(0),
          avgPnl: v.total.div(v.days).toFixed(0),
        }))
    }

    return {
      tradeCount: s.tradeCount,
      winCount: s.winCount,
      lossCount: s.lossCount,
      winRate: s.winRate,
      grossProfit: s.grossProfit.toFixed(0),
      grossLoss: s.grossLoss.toFixed(0),
      netPnl: s.netPnl.toFixed(0),
      avgWin: s.avgWin?.toFixed(0) ?? null,
      avgLoss: s.avgLoss?.toFixed(0) ?? null,
      payoffRatio: s.payoffRatio,
      profitFactor: s.profitFactor,
      maxDrawdown: s.maxDrawdown.toFixed(0),
      maxDrawdownPct: s.maxDrawdownPct,
      longestWinStreak: s.longestWinStreak,
      longestLossStreak: s.longestLossStreak,
      avgHoldingDays: s.avgHoldingDays,
      medianHoldingDays: s.medianHoldingDays,
      equityCurve: s.equityCurve.map((p) => ({ date: p.date, value: p.value.toFixed(0) })),
      byAccount: group(['SPECIFIC', 'NISA_GROWTH', 'NISA_TSUMITATE', 'NISA_OLD'], (k) => ({
        accountTypes: [k as 'SPECIFIC'],
      })),
      byAssetClass: group(['JP_EQUITY', 'US_EQUITY', 'FUND'], (k) => ({
        assetClasses: [k as 'JP_EQUITY'],
      })),
      symbols: bySymbol(engine.realized).map((r) => ({
        symbol: r.symbol,
        name: r.name,
        tradeCount: r.tradeCount,
        netPnl: r.netPnl.toFixed(0),
        winRate: r.winRate,
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
  .validator((data: { month: string }) => data)
  .handler(async ({ data, context }): Promise<CalendarDay[]> => {
    // `month` is YYYY-MM; build the inclusive day range for it.
    const [y, m] = data.month.split('-').map(Number)
    const year = y ?? new Date().getFullYear()
    const month = m ?? new Date().getMonth() + 1
    const first = `${String(year)}-${String(month).padStart(2, '0')}-01`
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const last = `${String(year)}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    const { engine } = await engineFor(context.userId)
    const daily = dailyPnl(engine.realized)

    // Realized events keyed the same way the engine keys them, so a close can
    // be matched back to the row that produced it.
    const realizedByKey = new Map<
      string,
      { realized: string; pct: number | null; entryPrice: string; holdingDays: number }
    >()
    for (const e of engine.realized) {
      realizedByKey.set(
        `${e.tradeDate}|${e.symbol}|${e.accountType}|${e.quantity.toFixed()}`,
        {
          realized: e.realizedJpy.toFixed(0),
          pct: e.costJpy.gt(0) ? e.realizedJpy.div(e.costJpy).toNumber() : null,
          // Same per-10,000 convention as the exit price, so the two are
          // directly comparable on screen.
          entryPrice:
            e.assetClass === 'FUND'
              ? e.entryPriceNative.mul(10_000).toFixed(0)
              : e.entryPriceNative.toFixed(e.assetClass === 'US_EQUITY' ? 2 : 1),
          holdingDays: e.holdingDays,
        },
      )
    }

    const records = await listTrades(context.userId)
    const byDate = new Map<string, CalendarTrade[]>()
    for (const r of records) {
      const t = r.trade
      if (t.tradeDate < first || t.tradeDate > last) continue
      const isClose = t.side === 'SELL' || t.side === 'REDEEM'
      const hit = realizedByKey.get(
        `${t.tradeDate}|${t.symbol}|${t.accountType}|${t.quantity.toFixed()}`,
      )
      const list = byDate.get(t.tradeDate) ?? []
      list.push({
        id: r.id,
        symbol: t.symbol,
        name: t.name,
        accountType: t.accountType,
        assetClass: t.assetClass,
        side: t.side,
        quantity: t.quantity.toFixed(),
        // Funds are stored per single 口 but quoted per 10,000, so display the
        // figure Rakuten shows rather than the internal one.
        unitPrice:
          t.assetClass === 'FUND'
            ? t.unitPrice.mul(10_000).toFixed(0)
            : t.unitPrice.toFixed(t.currency === 'USD' ? 2 : 1),
        currency: t.currency,
        amountJpy: t.netAmountJpy.toFixed(0),
        realizedJpy: isClose ? (hit?.realized ?? null) : null,
        returnPct: isClose ? (hit?.pct ?? null) : null,
        entryPrice: isClose ? (hit?.entryPrice ?? null) : null,
        holdingDays: isClose ? (hit?.holdingDays ?? null) : null,
        memo: r.memo,
        motivation: r.motivation,
      })
      byDate.set(t.tradeDate, list)
    }

    // Rakuten's exports carry no execution time — only 約定日 — so there is no
    // true intraday order to restore. Group by instrument instead, opens before
    // closes, which puts a same-day round trip on adjacent rows and matches the
    // order the engine processed that pool in.
    for (const list of byDate.values()) {
      list.sort((a, b) => {
        if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol)
        if (a.accountType !== b.accountType) return a.accountType.localeCompare(b.accountType)
        const ao = OPENING_SIDES.includes(a.side) ? 0 : 1
        const bo = OPENING_SIDES.includes(b.side) ? 0 : 1
        return ao - bo
      })
    }

    const journal = new Map((await listNotes(context.userId, first, last)).map((n) => [n.date, n]))

    const days: CalendarDay[] = []
    for (let d = 1; d <= lastDay; d++) {
      const date = `${String(year)}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
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

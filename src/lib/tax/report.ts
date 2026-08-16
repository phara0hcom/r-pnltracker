/**
 * Japanese capital-gains tax estimation and year-over-year comparison.
 *
 * Scope and basis, both load-bearing:
 *  - Only 特定口座 gains are taxable. Every NISA frame is exempt and is reported
 *    separately so the tax-free portion stays visible.
 *  - Years run 1 Jan – 31 Dec on a 受渡日 (settlement-date) basis, matching the
 *    特定口座年間取引報告書 and what Rakuten actually withholds. April–March is
 *    the fiscal year (年度) used for budgets, not individual securities tax; it
 *    is offered only as a labelled secondary view.
 *
 * This is an estimate, not tax advice. Under 源泉徴収あり Rakuten withholds and
 * files on your behalf.
 */
import Decimal from 'decimal.js'
// TAX_RATE_LOCAL is deliberately absent: the local portion is derived as the
// remainder of the rounded total, never rated independently. See below.
import { TAX_RATE_INCOME, TAX_RATE_TOTAL, ZERO, type AccountType } from '../domain/types'
import type { RealizedEvent } from '../pnl/engine'
import type { AttributedDividend } from './dividends'

const ROUND = Decimal.ROUND_HALF_UP

/**
 * How long a 譲渡損失 may be carried.
 *
 * A loss arising in year Y offsets gains in Y+1 through Y+3 and then lapses —
 * it is not an indefinite credit. Without the limit a single bad year keeps
 * suppressing the estimate forever, which understates tax owed by a growing
 * margin the further out you look.
 */
export const CARRYFORWARD_YEARS = 3

/** Which 12-month window a year label covers. */
export type TaxYearBasis = 'CALENDAR' | 'FISCAL_APR_MAR'

export interface TaxYearSummary {
  year: number
  basis: TaxYearBasis
  /** Realized gains in 特定口座 — the only taxable capital gains. */
  taxableGains: Decimal
  taxableLosses: Decimal
  /** gains − losses; may be negative. */
  netTaxable: Decimal
  /** Dividend income in 特定口座, before withholding. */
  dividendGross: Decimal
  /** 20.315% of positive net gains. Zero when the year nets to a loss. */
  estimatedCapitalGainsTax: Decimal
  /** Already withheld at source on dividends. */
  dividendTaxWithheld: Decimal
  /** Capital gains tax + dividend withholding. */
  totalTax: Decimal
  incomeTaxPortion: Decimal
  localTaxPortion: Decimal
  /** Realized P&L inside NISA — tax-free, shown for contrast. */
  nisaGains: Decimal
  nisaDividends: Decimal
  /** Loss available to carry forward, if a return is filed. */
  carryforwardLoss: Decimal
  tradeCount: number
  winCount: number
  lossCount: number
  winRate: number | null
  netAfterTax: Decimal
}

export interface YearOverYear {
  years: TaxYearSummary[]
  /** Running total of net-after-tax across years. */
  cumulativeNetAfterTax: { year: number; value: Decimal }[]
  totals: {
    taxableGains: Decimal
    estimatedTax: Decimal
    nisaGains: Decimal
    netAfterTax: Decimal
  }
}

const TAXABLE_ACCOUNT: AccountType = 'SPECIFIC'

/**
 * Year label for a settlement date under the chosen basis.
 *
 * Under the fiscal basis, Jan–Mar belongs to the previous label: 2026-02-20
 * falls in FY2025 (Apr 2025 – Mar 2026).
 */
export function taxYearOf(settleDate: string, basis: TaxYearBasis): number {
  const calendarYear = Number(settleDate.slice(0, 4))
  if (basis === 'CALENDAR') return calendarYear
  const month = Number(settleDate.slice(5, 7))
  // Jan–Mar still belongs to the fiscal year that opened the previous April.
  return month <= 3 ? calendarYear - 1 : calendarYear
}

/** Human label — fiscal years are marked so they are never mistaken for tax-official. */
export function formatTaxYear(year: number, basis: TaxYearBasis): string {
  return basis === 'CALENDAR' ? String(year) : `FY${year} (Apr–Mar)`
}

export function summarizeYear(
  year: number,
  realized: RealizedEvent[],
  dividends: AttributedDividend[],
  basis: TaxYearBasis,
  priorCarryforward: Decimal = ZERO,
): TaxYearSummary {
  const closes = realized.filter((close) => taxYearOf(close.settleDate, basis) === year)
  const payouts = dividends.filter((payout) => taxYearOf(payout.payDate, basis) === year)

  const taxableCloses = closes.filter((close) => close.accountType === TAXABLE_ACCOUNT)
  const nisaCloses = closes.filter((close) => close.accountType !== TAXABLE_ACCOUNT)

  const taxableGains = taxableCloses
    .filter((close) => close.realizedJpy.gt(0))
    .reduce((running, close) => running.add(close.realizedJpy), ZERO)
  const taxableLosses = taxableCloses
    .filter((close) => close.realizedJpy.lt(0))
    .reduce((running, close) => running.add(close.realizedJpy.abs()), ZERO)

  // Losses offset gains within the year; a prior-year carryforward reduces it
  // further, but only if a return was filed (informational — not automatic).
  const netTaxable = taxableGains.sub(taxableLosses).sub(priorCarryforward)

  const dividendGross = payouts
    .filter((payout) => payout.isTaxable)
    .reduce((running, payout) => running.add(payout.grossAmount), ZERO)
  const dividendTaxWithheld = payouts.reduce(
    (running, payout) => running.add(payout.incomeTax).add(payout.localTax),
    ZERO,
  )

  const positiveNet = Decimal.max(ZERO, netTaxable)
  const estimatedCapitalGainsTax = positiveNet.mul(TAX_RATE_TOTAL).toDecimalPlaces(0, ROUND)

  // Only the income portion is rounded independently; the local portion is the
  // remainder. Rounding both against the raw net would let them sum to ±1 yen
  // away from `estimatedCapitalGainsTax`, which rounds the combined 20.315%
  // once — and that figure is what drives `totalTax`, so the displayed total
  // would not equal its own parts (38,352 → 7,791 total vs 7,792 split).
  const capitalGainsIncomeTax = positiveNet.mul(TAX_RATE_INCOME).toDecimalPlaces(0, ROUND)
  const capitalGainsLocalTax = estimatedCapitalGainsTax.sub(capitalGainsIncomeTax)

  // Dividend withholding is already whole yen per payout, rounded by Rakuten
  // itself, so it adds in without disturbing the identity above.
  const incomeTaxPortion = capitalGainsIncomeTax.add(
    payouts.reduce((running, payout) => running.add(payout.incomeTax), ZERO),
  )
  const localTaxPortion = capitalGainsLocalTax.add(
    payouts.reduce((running, payout) => running.add(payout.localTax), ZERO),
  )

  const nisaGains = nisaCloses.reduce((running, close) => running.add(close.realizedJpy), ZERO)
  const nisaDividends = payouts
    .filter((payout) => !payout.isTaxable)
    .reduce((running, payout) => running.add(payout.netAmount), ZERO)

  const wins = closes.filter((close) => close.realizedJpy.gt(0)).length
  const losses = closes.filter((close) => close.realizedJpy.lt(0)).length

  const totalTax = estimatedCapitalGainsTax.add(dividendTaxWithheld)
  const grossPnl = taxableGains.sub(taxableLosses).add(nisaGains).add(dividendGross).add(nisaDividends)

  return {
    year,
    basis,
    taxableGains,
    taxableLosses,
    netTaxable,
    dividendGross,
    estimatedCapitalGainsTax,
    dividendTaxWithheld,
    totalTax,
    incomeTaxPortion,
    localTaxPortion,
    nisaGains,
    nisaDividends,
    carryforwardLoss: Decimal.max(ZERO, netTaxable.neg()),
    tradeCount: closes.length,
    winCount: wins,
    lossCount: losses,
    winRate: closes.length ? wins / closes.length : null,
    netAfterTax: grossPnl.sub(totalTax),
  }
}

/**
 * Full year-over-year comparison.
 *
 * Carryforward is threaded between years so a losing year reduces the next
 * year's estimate — the 繰越控除 allowance. It is informational: under
 * 源泉徴収あり it applies only if a return is actually filed.
 */
export function buildYearOverYear(
  realized: RealizedEvent[],
  dividends: AttributedDividend[],
  basis: TaxYearBasis = 'CALENDAR',
  applyCarryforward = false,
): YearOverYear {
  const years = new Set<number>()
  for (const close of realized) years.add(taxYearOf(close.settleDate, basis))
  for (const payout of dividends) years.add(taxYearOf(payout.payDate, basis))

  const orderedYears = [...years].sort((earlier, later) => earlier - later)
  const summaries: TaxYearSummary[] = []

  /**
   * Unused losses with the year each arose, oldest first.
   *
   * Tracked per originating year rather than as one running total, because a
   * loss expires on its own schedule: a single figure cannot say how much of it
   * is about to lapse. Expiry is by calendar year, so a gap with no trading
   * still consumes the allowance.
   */
  let lossLots: { year: number; remaining: Decimal }[] = []

  for (const year of orderedYears) {
    // Anything past its window simply lapses, whether or not it was ever used.
    lossLots = lossLots.filter((lot) => year - lot.year <= CARRYFORWARD_YEARS)
    const availableRelief = lossLots.reduce((running, lot) => running.add(lot.remaining), ZERO)

    const summary = summarizeYear(
      year,
      realized,
      dividends,
      basis,
      applyCarryforward ? availableRelief : ZERO,
    )
    summaries.push(summary)

    if (applyCarryforward) {
      // Oldest first — those expire soonest, so spending them first is what
      // keeps the most relief alive.
      let gainsToAbsorb = Decimal.max(ZERO, summary.taxableGains.sub(summary.taxableLosses))
      for (const lot of lossLots) {
        const used = Decimal.min(lot.remaining, gainsToAbsorb)
        lot.remaining = lot.remaining.sub(used)
        gainsToAbsorb = gainsToAbsorb.sub(used)
      }
      lossLots = lossLots.filter((lot) => lot.remaining.gt(0))

      const lossThisYear = Decimal.max(ZERO, summary.taxableLosses.sub(summary.taxableGains))
      if (lossThisYear.gt(0)) lossLots.push({ year, remaining: lossThisYear })
    }
  }

  let cumulative = ZERO
  const cumulativeNetAfterTax = summaries.map((summary) => {
    cumulative = cumulative.add(summary.netAfterTax)
    return { year: summary.year, value: cumulative }
  })

  const sumOf = (pick: (summary: TaxYearSummary) => Decimal) =>
    summaries.reduce((running, summary) => running.add(pick(summary)), ZERO)

  return {
    years: summaries,
    cumulativeNetAfterTax,
    totals: {
      taxableGains: sumOf((summary) => summary.taxableGains),
      estimatedTax: sumOf((summary) => summary.totalTax),
      nisaGains: sumOf((summary) => summary.nisaGains),
      netAfterTax: sumOf((summary) => summary.netAfterTax),
    },
  }
}

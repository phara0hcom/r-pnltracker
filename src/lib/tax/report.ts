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
import {
  TAX_RATE_INCOME,
  TAX_RATE_LOCAL,
  TAX_RATE_TOTAL,
  ZERO,
  type AccountType,
} from '../domain/types'
import type { RealizedEvent } from '../pnl/engine'
import type { AttributedDividend } from './dividends'

const ROUND = Decimal.ROUND_HALF_UP

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
  const y = Number(settleDate.slice(0, 4))
  if (basis === 'CALENDAR') return y
  const m = Number(settleDate.slice(5, 7))
  return m <= 3 ? y - 1 : y
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
  const events = realized.filter((e) => taxYearOf(e.settleDate, basis) === year)
  const divs = dividends.filter((d) => taxYearOf(d.payDate, basis) === year)

  const taxable = events.filter((e) => e.accountType === TAXABLE_ACCOUNT)
  const nisa = events.filter((e) => e.accountType !== TAXABLE_ACCOUNT)

  const taxableGains = taxable
    .filter((e) => e.realizedJpy.gt(0))
    .reduce((a, e) => a.add(e.realizedJpy), ZERO)
  const taxableLosses = taxable
    .filter((e) => e.realizedJpy.lt(0))
    .reduce((a, e) => a.add(e.realizedJpy.abs()), ZERO)

  // Losses offset gains within the year; a prior-year carryforward reduces it
  // further, but only if a return was filed (informational — not automatic).
  const netTaxable = taxableGains.sub(taxableLosses).sub(priorCarryforward)

  const dividendGross = divs
    .filter((d) => d.isTaxable)
    .reduce((a, d) => a.add(d.grossAmount), ZERO)
  const dividendTaxWithheld = divs.reduce((a, d) => a.add(d.incomeTax).add(d.localTax), ZERO)

  const positiveNet = Decimal.max(ZERO, netTaxable)
  const estimatedCapitalGainsTax = positiveNet.mul(TAX_RATE_TOTAL).toDecimalPlaces(0, ROUND)

  const incomeTaxPortion = positiveNet
    .mul(TAX_RATE_INCOME)
    .toDecimalPlaces(0, ROUND)
    .add(divs.reduce((a, d) => a.add(d.incomeTax), ZERO))
  const localTaxPortion = positiveNet
    .mul(TAX_RATE_LOCAL)
    .toDecimalPlaces(0, ROUND)
    .add(divs.reduce((a, d) => a.add(d.localTax), ZERO))

  const nisaGains = nisa.reduce((a, e) => a.add(e.realizedJpy), ZERO)
  const nisaDividends = divs.filter((d) => !d.isTaxable).reduce((a, d) => a.add(d.netAmount), ZERO)

  const wins = events.filter((e) => e.realizedJpy.gt(0)).length
  const losses = events.filter((e) => e.realizedJpy.lt(0)).length

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
    tradeCount: events.length,
    winCount: wins,
    lossCount: losses,
    winRate: events.length ? wins / events.length : null,
    netAfterTax: grossPnl.sub(totalTax),
  }
}

/**
 * Full year-over-year comparison.
 *
 * Carryforward is threaded between years so a losing year reduces the next
 * year's estimate — the 3-year 繰越控除 allowance. It is informational: under
 * 源泉徴収あり it applies only if a return is actually filed.
 */
export function buildYearOverYear(
  realized: RealizedEvent[],
  dividends: AttributedDividend[],
  basis: TaxYearBasis = 'CALENDAR',
  applyCarryforward = false,
): YearOverYear {
  const years = new Set<number>()
  for (const e of realized) years.add(taxYearOf(e.settleDate, basis))
  for (const d of dividends) years.add(taxYearOf(d.payDate, basis))

  const ordered = [...years].sort((a, b) => a - b)
  const summaries: TaxYearSummary[] = []
  let carry = ZERO

  for (const y of ordered) {
    const s = summarizeYear(y, realized, dividends, basis, applyCarryforward ? carry : ZERO)
    summaries.push(s)
    if (applyCarryforward) {
      // A loss rolls forward; a profitable year consumes what it used.
      carry = s.carryforwardLoss
    }
  }

  let running = ZERO
  const cumulativeNetAfterTax = summaries.map((s) => {
    running = running.add(s.netAfterTax)
    return { year: s.year, value: running }
  })

  return {
    years: summaries,
    cumulativeNetAfterTax,
    totals: {
      taxableGains: summaries.reduce((a, s) => a.add(s.taxableGains), ZERO),
      estimatedTax: summaries.reduce((a, s) => a.add(s.totalTax), ZERO),
      nisaGains: summaries.reduce((a, s) => a.add(s.nisaGains), ZERO),
      netAfterTax: summaries.reduce((a, s) => a.add(s.netAfterTax), ZERO),
    },
  }
}

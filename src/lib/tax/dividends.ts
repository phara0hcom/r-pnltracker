/**
 * Dividend account attribution and withholding reconstruction.
 *
 * The monthly statement's cash ledger reports dividends as a bare credit with
 * no account column — but tax treatment depends entirely on which account held
 * the units: 特定 is withheld at 20.315%, every NISA frame is exempt.
 *
 * Attribution works because distributions are strictly proportional to units
 * held. Where one instrument is held across several accounts, the statement
 * emits one ledger row per account, so sorting holdings and amounts by size and
 * pairing them recovers the split.
 *
 * Verified against the 2025-12-05 netWIN distribution, which pays ¥500.00 per
 * 10,000 口 to both accounts:
 *   旧NISA  437,094 口 → ¥21,855 exempt
 *   特定      18,535 口 → ¥927 gross → ¥142 income + ¥46 local → ¥739 net
 * The ¥927/¥142/¥46 triple matches the official 特定口座年間取引報告書 exactly.
 */
import Decimal from 'decimal.js'
import { createStatementResolver } from '../domain/instruments'
import {
  TAX_EXEMPT_ACCOUNTS,
  TAX_RATE_INCOME,
  TAX_RATE_LOCAL,
  TAX_RATE_TOTAL,
  ZERO,
  type AccountType,
  type NormalizedDividend,
  type NormalizedTrade,
} from '../domain/types'
import { toHalfWidth } from '../import/util'
import { runEngine } from '../pnl/engine'

const ROUND = Decimal.ROUND_HALF_UP

export interface AttributedDividend extends NormalizedDividend {
  /** Before withholding. Equals `netAmount` for tax-exempt accounts. */
  grossAmount: Decimal
  /** 所得税 + 復興特別所得税 (15.315%). Zero when exempt. */
  incomeTax: Decimal
  /** 住民税 (5%). Zero when exempt. */
  localTax: Decimal
  isTaxable: boolean
  /** False when no holding could be found and the account was inferred. */
  attributionConfident: boolean
}

/**
 * Reconstruct the pre-withholding amount from the credited figure.
 *
 * Rakuten reports dividends net. Japanese withholding is 15.315% income +
 * 5% local, each rounded independently, so the gross is recovered by dividing
 * by the combined rate and rounding to the yen.
 */
export function grossUpDividend(net: Decimal): {
  gross: Decimal
  incomeTax: Decimal
  localTax: Decimal
} {
  const withholdingFor = (gross: Decimal) => ({
    incomeTax: gross.mul(TAX_RATE_INCOME).toDecimalPlaces(0, ROUND),
    localTax: gross.mul(TAX_RATE_LOCAL).toDecimalPlaces(0, ROUND),
  })

  const estimate = net.div(new Decimal(1).sub(TAX_RATE_TOTAL)).toDecimalPlaces(0, ROUND)

  // The two taxes are rounded independently, so the naive estimate can miss the
  // exact gross by a yen or two. Probe the neighbourhood for the value whose
  // withholding reproduces the credited amount, so gross − tax always ties back
  // to what Rakuten actually paid.
  for (const delta of [0, 1, -1, 2, -2, 3, -3]) {
    const gross = estimate.add(delta)
    if (gross.lte(0)) continue
    const { incomeTax, localTax } = withholdingFor(gross)
    if (gross.sub(incomeTax).sub(localTax).eq(net)) return { gross, incomeTax, localTax }
  }

  // Unreachable net (rounding makes some values impossible) — return the
  // closest estimate rather than failing the import.
  return { gross: estimate, ...withholdingFor(estimate) }
}

/** Units held per account for one instrument, as of a date (settlement basis). */
function holdingsAt(
  trades: NormalizedTrade[],
  symbol: string,
  asOf: string,
): { accountType: AccountType; quantity: Decimal }[] {
  const upTo = trades.filter((t) => t.settleDate <= asOf)
  return runEngine(upTo)
    .positions.filter((p) => p.symbol === symbol && p.quantity.gt(0))
    .map((p) => ({ accountType: p.accountType, quantity: p.quantity }))
    .sort((a, b) => b.quantity.cmp(a.quantity))
}

/**
 * The last account that held an instrument before a date.
 *
 * Needed because a dividend's record date precedes its payment date: フルキャスト
 * was sold on 2026-02-18 but paid out on 2026-03-12, so there is no holding at
 * payment time even though the dividend is genuinely owed to that account.
 */
function lastKnownAccount(
  trades: NormalizedTrade[],
  symbol: string,
  before: string,
): AccountType | null {
  const prior = trades
    .filter((t) => t.symbol === symbol && t.tradeDate <= before)
    .sort((a, b) => (a.tradeDate < b.tradeDate ? 1 : -1))
  return prior[0]?.accountType ?? null
}

/**
 * Assign each dividend to the account that earned it and compute withholding.
 *
 * Dividends for the same instrument and date are matched to accounts by size:
 * the largest holding receives the largest payment, because the per-unit rate
 * is identical across accounts.
 */
export function attributeDividends(
  dividends: NormalizedDividend[],
  trades: NormalizedTrade[],
): AttributedDividend[] {
  // Statements name instruments; the engine keys on codes and canonical fund
  // names. Without this bridge no dividend matches a holding.
  const resolve = createStatementResolver(trades, toHalfWidth)

  const groups = new Map<string, NormalizedDividend[]>()
  for (const d of dividends) {
    const k = `${d.symbol}|${d.payDate}`
    const list = groups.get(k)
    if (list) list.push(d)
    else groups.set(k, [d])
  }

  const out: AttributedDividend[] = []

  for (const [, rows] of groups) {
    const first = rows[0]!
    const resolved = resolve(first.symbol)
    const holdings = resolved ? holdingsAt(trades, resolved, first.payDate) : []
    // Largest payment ↔ largest holding.
    const sorted = [...rows].sort((a, b) => b.netAmount.cmp(a.netAmount))

    sorted.forEach((d, i) => {
      let account = holdings[i]?.accountType ?? null
      let confident = account != null

      if (!account && resolved) {
        // Paid after the position closed — a dividend's record date precedes
        // its payment date, so fall back to whoever last held it.
        account = lastKnownAccount(trades, resolved, d.payDate)
        confident = false
      }

      const accountType: AccountType = account ?? 'SPECIFIC'
      const isTaxable = !TAX_EXEMPT_ACCOUNTS.includes(accountType)

      const { gross, incomeTax, localTax } = isTaxable
        ? grossUpDividend(d.netAmount)
        : { gross: d.netAmount, incomeTax: ZERO, localTax: ZERO }

      out.push({
        ...d,
        symbol: resolved ?? d.symbol,
        accountType,
        grossAmount: gross,
        incomeTax,
        localTax,
        isTaxable,
        attributionConfident: confident,
      })
    })
  }

  return out.sort((a, b) => (a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : 0))
}

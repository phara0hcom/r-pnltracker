/**
 * A synthetic trade for engine tests.
 *
 * The default is a settled ¥100 × 10 buy of 8411 in 特定 on 2026-09-01, with
 * its amounts worked out from quantity, price and rate — so a test overrides
 * only the fields under test and the yen still agrees with them. Each call gets
 * its own source hash, as each row of a real export does.
 */
import Decimal from 'decimal.js'
import { ONE, ZERO, type NormalizedTrade } from '~/lib/domain/types'

let serial = 0

export function makeTrade(over: Partial<NormalizedTrade> = {}): NormalizedTrade {
  const quantity = over.quantity ?? new Decimal(10)
  const unitPrice = over.unitPrice ?? new Decimal(100)
  const fxRate = over.fxRate ?? ONE
  const gross = quantity.mul(unitPrice)
  serial += 1
  return {
    tradeDate: '2026-09-01',
    settleDate: '2026-09-03',
    symbol: '8411',
    name: '8411',
    assetClass: 'JP_EQUITY',
    accountType: 'SPECIFIC',
    side: 'BUY',
    quantity,
    unitPrice,
    currency: 'JPY',
    fee: ZERO,
    feeTax: ZERO,
    otherCost: ZERO,
    fxRate,
    grossAmount: gross,
    netAmount: gross,
    netAmountJpy: gross.mul(fxRate),
    isSettled: true,
    sourceRowHash: `synthetic-${String(serial)}`,
    sourceFile: 'synthetic',
    ...over,
  }
}

/** The fields that make `makeTrade` a US stock at ¥150 to the dollar. */
export const US_TRADE = { assetClass: 'US_EQUITY', currency: 'USD', fxRate: new Decimal(150) } as const

/**
 * What a TradingView bar may be published as.
 *
 * Pure and DB-free like the rest of `lib/`, so the one rule worth pinning here
 * can be tested without a database.
 */
import type { AssetClass } from '~/lib/domain/types'

/**
 * The currency a feed close is quoted in, or `null` if it may not be published.
 *
 * Funds are excluded deliberately, and the exclusion is the point of this
 * function. They carry no ticker in any Rakuten export, so no TradingView alert
 * can exist for one — but their 基準価額 is quoted per 10,000 口 and divided
 * down at parse time, so a raw close filed against a fund would be wrong by four
 * orders of magnitude rather than merely absent. Whatever makes a fund reachable
 * here later, it must not arrive by someone adding a row to this map.
 */
export function feedCurrencyFor(assetClass: AssetClass): 'JPY' | 'USD' | null {
  switch (assetClass) {
    case 'US_EQUITY':
      return 'USD'
    case 'JP_EQUITY':
      return 'JPY'
    case 'FUND':
      return null
  }
}

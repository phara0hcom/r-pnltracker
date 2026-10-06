/**
 * The All / JP / US switch, the Positions screen's second filter.
 *
 * Beside the account switch, not in place of it: they are independent — NISA
 * holds both Japanese and US stocks, and so does 特定 — so a view is any
 * pairing of the two. The choice lives in the URL (`?market=`), and is not
 * copied onto the sidebar links: no other screen splits by market, so carrying
 * it there would be a filter that silently does nothing.
 */
import { FilterSwitch, type FilterOption } from './FilterSwitch'
import type { MarketFilter } from '~/lib/domain/types'

/**
 * What each choice covers. The one surprise is funds: an S&P 500 投資信託 is
 * bought and valued in yen, so it is a JP holding — the split Rakuten's own two
 * accounts make — and the US hint says so, where someone looking for it would.
 */
const MARKET_SCOPE_HINT: Record<MarketFilter, string> = {
  ALL: 'Japanese and US holdings',
  JP: 'Japanese stocks and all funds',
  US: 'US stocks only — funds count as JP',
}

const MARKET_OPTIONS: readonly FilterOption<MarketFilter>[] = [
  { value: 'ALL', label: 'All' },
  { value: 'JP', label: 'JP' },
  { value: 'US', label: 'US' },
]

export function MarketFilterControl({
  value,
  onChange,
}: {
  value: MarketFilter
  onChange: (next: MarketFilter) => void
}) {
  return (
    <FilterSwitch
      label="Filter by market"
      options={MARKET_OPTIONS}
      hints={MARKET_SCOPE_HINT}
      value={value}
      onChange={onChange}
    />
  )
}

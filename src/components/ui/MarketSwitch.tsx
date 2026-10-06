/**
 * All / JP / US switch, the Positions screen's second filter.
 *
 * Beside the account switch, not in place of it: they are independent — NISA
 * holds both Japanese and US stocks, and so does 特定 — so a view is any
 * pairing of the two. The choice lives in the URL (`?market=`) for the reasons
 * `AccountSwitch` gives, and is not copied onto the sidebar links: no other
 * screen splits by market, so carrying it there would be a filter that
 * silently does nothing.
 *
 * Styled by `AccountSwitch`'s own sheet so the two controls are the same size
 * and colour — a second look for the same kind of control would read as a
 * different kind of filter.
 */
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { useNavigate, useSearch } from '@tanstack/react-router'
import styles from './AccountSwitch.module.scss'
import { cx } from '~/lib/cx'
import type { MarketFilter } from '~/lib/domain/types'
import { toMarketFilter } from '~/lib/marketScope'

/**
 * Current market filter, and a setter that writes it back to the URL.
 *
 * `replace` and `resetScroll: false` for the same reasons as `useAccountFilter`.
 */
export function useMarketFilter(): [MarketFilter, (next: MarketFilter) => void] {
  const market = useSearch({ strict: false, select: (s) => toMarketFilter(s.market) })
  const navigate = useNavigate()

  return [
    market,
    (next) => {
      void navigate({
        to: '.',
        // `ALL` is the default, so it is omitted — one canonical URL for it.
        search: (prev) => ({ ...prev, market: next === 'ALL' ? undefined : next }),
        replace: true,
        resetScroll: false,
      })
    },
  ]
}

/**
 * What each choice covers. Funds are in JP because they are bought and valued
 * in yen — the same split Rakuten's two accounts make.
 */
export const MARKET_SCOPE_HINT: Record<MarketFilter, string> = {
  ALL: 'Japanese and US holdings',
  JP: 'Japanese stocks and funds, in yen',
  US: 'US stocks, in dollars',
}

const OPTIONS: { value: MarketFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'JP', label: 'JP' },
  { value: 'US', label: 'US' },
]

export function MarketSwitch({
  value,
  onChange,
  fill = false,
}: {
  value: MarketFilter
  onChange: (next: MarketFilter) => void
  /** Full width with 40px-tall segments, for a phone. */
  fill?: boolean
}) {
  return (
    <ToggleGroup.Root
      type="single"
      className={cx(styles.group, fill && styles.fill)}
      value={value}
      aria-label="Filter by market"
      onValueChange={(next) => {
        // Radix emits '' when the active item is pressed again; a filter with
        // nothing selected would be a dead screen, so that is not a change.
        if (next) onChange(next as MarketFilter)
      }}
    >
      {OPTIONS.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          className={styles.item}
          title={MARKET_SCOPE_HINT[o.value]}
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}

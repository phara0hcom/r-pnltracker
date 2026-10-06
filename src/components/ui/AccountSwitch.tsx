/**
 * All / NISA / 特定 switch, shared by every analysis screen: its URL state,
 * choices and hints. `AccountFilterControl` renders it through `FilterSwitch`.
 *
 * The selection lives in the URL (`?scope=`) rather than in component state,
 * like every other filter here, so a view stays shareable and survives a
 * refresh. `AppShell` copies the current value onto the sidebar links, so it
 * also follows you from screen to screen.
 *
 * Three buckets, not four: the question is "taxed or not", and all three NISA
 * frames answer it the same way. Isolating a single frame is a quota question —
 * that is what the NISA screen is for.
 */
import { useNavigate, useSearch } from '@tanstack/react-router'
import type { FilterOption } from './FilterSwitch'
import { toAccountFilter } from '~/lib/accountScope'
import type { AccountFilter } from '~/lib/domain/types'

/**
 * Current account filter, and a setter that writes it back to the URL.
 *
 * `replace: true` — flipping a filter is refining one view, not a new
 * destination, so Back should leave the screen rather than walk through every
 * toggle you tried. `resetScroll: false` for the same reason Stats' own
 * `setSearch` needs it: the router scrolls to the top on every navigation by
 * default, and this switch lives in the page header, so a reader scrolled
 * halfway down the screen would otherwise get thrown back up by their own tap.
 */
export function useAccountFilter(): [AccountFilter, (next: AccountFilter) => void] {
  /*
   * Read loosely, then narrow. `strict: false` widens the field to the union
   * across every route, so anything outside this switch's three values is
   * treated as the default rather than trusted.
   */
  const account = useSearch({ strict: false, select: (s) => toAccountFilter(s.scope) })
  const navigate = useNavigate()

  return [
    account,
    (next) => {
      void navigate({
        // `to: '.'` keeps the current route; without it the search reducer has
        // no route to resolve against and infers away to `never`.
        to: '.',
        // `ALL` is the default, so it is omitted rather than written — a clean
        // URL for the default view, and one canonical form for it.
        search: (prev) => ({ ...prev, scope: next === 'ALL' ? undefined : next }),
        replace: true,
        resetScroll: false,
      })
    },
  ]
}

/** What each bucket covers, said beside the switch rather than only in a tooltip. */
export const ACCOUNT_SCOPE_HINT: Record<AccountFilter, string> = {
  ALL: 'Every account',
  NISA: 'Tax-free: 旧NISA, 成長投資枠, つみたて投資枠',
  SPECIFIC: 'Taxable account only',
}

export const ACCOUNT_OPTIONS: readonly FilterOption<AccountFilter>[] = [
  { value: 'ALL', label: 'All' },
  { value: 'NISA', label: 'NISA' },
  { value: 'SPECIFIC', label: '特定' },
]

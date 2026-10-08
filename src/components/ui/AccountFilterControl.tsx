/**
 * The All / NISA / 特定 switch, with a line saying what the choice covers.
 *
 * One component rather than a choice made per screen: the same control appears
 * on five, and they must not drift into "collapses on Positions but not on
 * Dashboard" for no reason a user could infer.
 *
 * Inline on a phone too, full width under the title. It used to sit behind a
 * Filters button there, which hid the one fact every figure on the screen
 * depends on — whether it covers every account, NISA, or 特定 — behind a badge
 * reading "1".
 */
import { ACCOUNT_OPTIONS, ACCOUNT_SCOPE_HINT } from './AccountSwitch'
import { FilterSwitch } from './FilterSwitch'
import type { AccountFilter } from '~/lib/domain/types'

export function AccountFilterControl({
  value,
  onChange,
}: {
  value: AccountFilter
  onChange: (next: AccountFilter) => void
}) {
  return (
    <FilterSwitch
      label="Filter by account"
      options={ACCOUNT_OPTIONS}
      hints={ACCOUNT_SCOPE_HINT}
      value={value}
      onChange={onChange}
    />
  )
}

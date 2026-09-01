/**
 * The All / NISA / 特定 switch, inline on desktop and behind a Filter button on
 * SP.
 *
 * One component rather than a choice made per screen: the same control appears
 * on five, and the two arrangements would otherwise drift into "collapses on
 * Positions but not on Dashboard" for no reason a user could infer.
 *
 * Rendered once either way — see `useIsMobile` for why this is a branch rather
 * than two copies hidden by CSS.
 */
import styles from './AccountFilterControl.module.scss'
import { AccountSwitch } from './AccountSwitch'
import { FilterDialog } from './FilterDialog'
import { useIsMobile } from './useIsMobile'
import type { AccountFilter } from '~/lib/domain/types'

export function AccountFilterControl({
  value,
  onChange,
}: {
  value: AccountFilter
  onChange: (next: AccountFilter) => void
}) {
  const isMobile = useIsMobile()

  if (!isMobile) return <AccountSwitch value={value} onChange={onChange} />

  return (
    // `ALL` is the default rather than a choice, so it does not count as a
    // filter being applied.
    <FilterDialog activeCount={value === 'ALL' ? 0 : 1}>
      <div className={styles.field}>
        <span className={styles.label}>Account</span>
        <AccountSwitch value={value} onChange={onChange} />
      </div>
    </FilterDialog>
  )
}

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
import styles from './AccountFilterControl.module.scss'
import { ACCOUNT_SCOPE_HINT, AccountSwitch } from './AccountSwitch'
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

  return (
    <div className={styles.control}>
      <AccountSwitch value={value} onChange={onChange} fill={isMobile} />
      <span className={styles.hint}>{ACCOUNT_SCOPE_HINT[value]}</span>
    </div>
  )
}

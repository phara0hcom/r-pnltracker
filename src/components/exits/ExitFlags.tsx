/**
 * The four state badges a plan can carry.
 *
 * Shared by the action card, the on-track row and the dialog so that "Target 1
 * hit" cannot come to mean one colour in the list and another in the detail.
 */
import styles from './ExitFlags.module.scss'
import { cx } from '~/lib/cx'
import type { ExitRuleRow } from '~/server/exit'

export function ExitFlags({
  row,
  /** The table's Flags column, where a badge shares a 40px row with figures. */
  compact = false,
}: {
  row: ExitRuleRow
  compact?: boolean
}) {
  const badge = cx(styles.badge, compact && styles.compact)

  /* Most plans carry none. Returning nothing keeps an empty element out of
     every on-track row's Flags cell and off the card's header row. */
  if (!row.target1Hit && !row.trailingActive && !row.timeStopFlag && !row.stale) return null

  return (
    <span className={styles.flags}>
      {row.target1Hit ? <span className={cx(badge, styles.hit)}>Target 1 hit</span> : null}
      {row.trailingActive ? (
        <span className={cx(badge, styles.trail)}>Trail {row.trailingMethod}</span>
      ) : null}
      {row.timeStopFlag ? <span className={cx(badge, styles.warn)}>Time stop</span> : null}
      {row.stale ? (
        <span className={cx(badge, styles.warn)}>Stale {row.staleTradingDays}d</span>
      ) : null}
    </span>
  )
}

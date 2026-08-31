import styles from './AccountDot.module.scss'
import { cx } from '~/lib/cx'

const CLASS: Record<string, string | undefined> = {
  SPECIFIC: styles.specific,
  NISA_GROWTH: styles.nisaGrowth,
  NISA_TSUMITATE: styles.nisaTsumitate,
  NISA_OLD: styles.nisaOld,
}

/**
 * 6px round colour indicator preceding an account label.
 *
 * Decorative only — the label text it always sits beside already carries the
 * meaning, colour is a shortcut for a reader who has learned the mapping.
 */
export function AccountDot({ accountType }: { accountType: string }) {
  return <span className={cx(styles.dot, CLASS[accountType])} aria-hidden="true" />
}

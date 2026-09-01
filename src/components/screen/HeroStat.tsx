import styles from './HeroStat.module.scss'
import { cx } from '~/lib/cx'

/**
 * The one hero figure a redesigned screen leads with.
 *
 * `aside` renders beside the label/value column — Dashboard's trend line is
 * the only user of this. `children` renders below the context line —
 * Positions' allocation bar uses this. A screen needing neither gets the
 * plain card.
 */
export function HeroStat({
  label,
  value,
  tone,
  context,
  aside,
  children,
}: {
  label: string
  value: React.ReactNode
  tone?: 'profit' | 'loss' | 'flat'
  context?: React.ReactNode
  aside?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className={cx(styles.hero, aside != null && styles.withAside)}>
      <div className={styles.main}>
        <span className={styles.label}>{label}</span>
        <span
          className={cx(
            styles.value,
            tone === 'profit' && styles.profit,
            tone === 'loss' && styles.loss,
          )}
        >
          {value}
        </span>
        {context ? <span className={styles.context}>{context}</span> : null}
        {children}
      </div>
      {aside ? <div className={styles.aside}>{aside}</div> : null}
    </div>
  )
}

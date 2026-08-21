import styles from './Stat.module.scss'
import { cx } from '~/lib/cx'

/** One headline figure, with an optional line of context beneath it. */
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: 'profit' | 'loss' | 'flat'
}) {
  return (
    <div className={styles.stat}>
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
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </div>
  )
}

import styles from './StripCell.module.scss'
import { cx } from '~/lib/cx'

/** One label/value/hint cell inside a `StatStrip`. */
export function StripCell({
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
    <div className={styles.cell}>
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

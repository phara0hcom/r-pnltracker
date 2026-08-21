import styles from './Meter.module.scss'
import { cx } from '~/lib/cx'

/**
 * Horizontal progress meter.
 *
 * `max` is the cap being measured against; overflow is clamped visually but the
 * caller still shows the true figure, so a maxed quota reads as full rather
 * than as a bar running off the end.
 */
export function Meter({
  value,
  max,
  label,
  caption,
  tone = 'accent',
}: {
  value: number
  max: number
  label: string
  caption?: React.ReactNode
  tone?: 'accent' | 'profit' | 'warn'
}) {
  const fraction = max > 0 ? Math.min(value / max, 1) : 0

  return (
    <div className={styles.row}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        {caption ? <span className={styles.caption}>{caption}</span> : null}
      </div>
      <div
        className={styles.track}
        role="meter"
        aria-valuenow={Math.round(fraction * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={cx(styles.fill, styles[`meter_${tone}`])}
          style={{ width: `${String(fraction * 100)}%` }}
        />
      </div>
    </div>
  )
}

import styles from './Stat.module.scss'
import { cx } from '~/lib/cx'

/** One headline figure, with an optional line of context beneath it. */
export function Stat({
  label,
  value,
  hint,
  tone,
  meter,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: 'profit' | 'loss' | 'flat'
  /** Fraction 0–1: a thin accent fill under the value, coloured by `tone`. */
  meter?: number
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
      {meter != null ? (
        <div className={styles.meterTrack}>
          <div
            className={cx(
              styles.meterFill,
              tone === 'profit' && styles.meterProfit,
              tone === 'loss' && styles.meterLoss,
            )}
            style={{ width: `${String(Math.min(Math.max(meter, 0), 1) * 100)}%` }}
          />
        </div>
      ) : null}
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </div>
  )
}

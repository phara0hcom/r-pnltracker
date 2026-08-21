/**
 * One component of the US currency attribution, as a signed bar.
 *
 * Width is the share of the largest component rather than of the signed total:
 * the three parts can offset each other, so scaling by the total would make a
 * large component look tiny whenever the net happens to be near zero.
 */
import styles from './AttrBar.module.scss'
import { tone, yenSigned } from '~/components/format'
import { cx } from '~/lib/cx'

export function AttrBar({
  label,
  value,
  total,
}: {
  label: string
  value: string
  total: string
}) {
  const v = Number(value)
  const scale = Math.max(Math.abs(Number(total)), Math.abs(v)) || 1
  const width = (Math.abs(v) / scale) * 100

  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <div className={styles.track}>
        <div
          className={v >= 0 ? styles.fillPos : styles.fillNeg}
          style={{ width: `${String(Math.min(width, 100))}%` }}
        />
      </div>
      <span className={cx(styles.value, tone(value))}>{yenSigned(value)}</span>
    </div>
  )
}

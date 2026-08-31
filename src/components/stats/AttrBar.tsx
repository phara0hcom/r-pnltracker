/**
 * One component of the US currency attribution, as a signed bar.
 *
 * `scale` is the largest magnitude *among all the components being compared*,
 * computed once by the caller and shared by every bar — not derived from this
 * bar's own value and the signed total. The three parts can offset each
 * other, so a component larger than the total (common when two components
 * partly cancel) would otherwise draw past 100% or, worse, make the actually
 * largest component look smaller than a partner it is being compared against.
 */
import styles from './AttrBar.module.scss'
import { tone, yenSigned } from '~/components/format'
import { cx } from '~/lib/cx'

export function AttrBar({
  label,
  value,
  scale,
}: {
  label: string
  value: string
  scale: number
}) {
  const v = Number(value)
  const width = scale > 0 ? (Math.abs(v) / scale) * 100 : 0

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

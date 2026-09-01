import styles from './ZeroBar.module.scss'
import { zeroBarGeometry } from '~/lib/charts/zeroBar'
import { cx } from '~/lib/cx'

/**
 * A zero-origin bar track: a positive fill grows right from the zero line, a
 * negative fill grows left.
 *
 * `maxPos`/`maxNeg` are the largest magnitude on each side *across every row
 * being compared*, not this row's own value — scaling each side to its own
 * extent independently is what makes a ¥100k gain and a ¥100k loss draw the
 * same length even when the dataset's ups and downs are lopsided. The placement
 * arithmetic lives in `~/lib/charts/zeroBar`, where it is tested.
 *
 * Renders only the track. Callers supply their own flanking label/value —
 * the column widths around it differ too much per screen (a month row, a day
 * row, a table cell) to bake one row layout in here.
 *
 * `size="compact"` is the 12px table-cell track; the default 16px suits a
 * standalone row list, where there's a full line height to fill.
 */
export function ZeroBar({
  value,
  maxPos,
  maxNeg,
  size = 'default',
}: {
  value: number
  maxPos: number
  maxNeg: number
  size?: 'default' | 'compact'
}) {
  const { zeroPct, posPct, negPct } = zeroBarGeometry(value, maxPos, maxNeg)

  return (
    <div className={cx(styles.track, size === 'compact' && styles.compact)}>
      <div className={styles.zero} style={{ left: `${String(zeroPct)}%` }} />
      {posPct > 0 ? (
        <div
          className={styles.pos}
          style={{ left: `${String(zeroPct)}%`, width: `${String(posPct)}%` }}
        />
      ) : null}
      {negPct > 0 ? (
        <div
          className={styles.neg}
          style={{ right: `${String(100 - zeroPct)}%`, width: `${String(negPct)}%` }}
        />
      ) : null}
    </div>
  )
}

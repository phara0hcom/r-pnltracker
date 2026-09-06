/**
 * The stop → Target 1 axis, with the effective stop and the last close marked.
 *
 * One implementation for the four places a plan is drawn — the action card, the
 * on-track row, the read dialog, and both of their phone forms — because the
 * marks are positioned by arithmetic, and a second copy of that arithmetic is a
 * second chance for the two to disagree about where "now" sits.
 *
 * `aria-hidden` throughout: every value it encodes is written out beside it, so
 * to a screen reader this is decoration and nothing is lost by skipping it.
 */
import styles from './ExitLadder.module.scss'
import { money } from '~/components/format'
import { cx } from '~/lib/cx'
import type { ExitRuleRow } from '~/server/exit'

/**
 * Where a price sits between the initial stop and Target 1, as a 0–1 fraction.
 *
 * Clamped, because a position past its target or through its stop is exactly
 * when the number goes out of range and exactly when the plan still has to
 * render.
 */
function fraction(value: string | null, row: ExitRuleRow): number | null {
  if (value === null) return null
  const low = Number(row.initialStop)
  const high = Number(row.target1)
  if (!(high > low)) return null
  return Math.min(1, Math.max(0, (Number(value) - low) / (high - low)))
}

export function ExitLadder({
  row,
  /** Prints the two ends of the axis under the track. */
  ends = false,
  /** `lg` is the dialog, where the ladder is the full width of the panel. */
  size = 'sm',
  className,
}: {
  row: ExitRuleRow
  ends?: boolean
  size?: 'sm' | 'lg'
  className?: string
}) {
  const now = fraction(row.currentPrice, row)
  /*
   * No last close means no axis worth drawing: the stop tick alone says nothing
   * the "Eff. stop" figure does not already say, and an empty track reads as a
   * plan with no room left rather than as a plan with no data.
   */
  if (now === null) return null

  const stop = fraction(row.currentStop, row) ?? 0

  return (
    <div className={cx(styles.ladder, size === 'lg' && styles.large, className)} aria-hidden="true">
      <div className={styles.track}>
        <span className={styles.stop} style={{ left: `${String(stop * 100)}%` }} />
        <span className={styles.now} style={{ left: `${String(now * 100)}%` }} />
      </div>
      {ends ? (
        <div className={styles.ends}>
          <span>{money(row.initialStop, row.currency)}</span>
          <span>{money(row.target1, row.currency)}</span>
        </div>
      ) : null}
    </div>
  )
}

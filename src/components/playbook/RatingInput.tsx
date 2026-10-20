/**
 * A 1–10 rating as a row of buttons, clearable.
 *
 * Buttons rather than a slider: a slider has no "not rated yet", and an
 * unrated entry must stay out of the score rather than count as whatever the
 * thumb's resting position happened to be.
 */
import styles from './RatingInput.module.scss'
import { cx } from '~/lib/cx'
import { RATING_MAX, RATING_MIN } from '~/lib/playbook/types'

const VALUES = Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => RATING_MIN + i)

export function RatingInput({
  value,
  onChange,
  label,
}: {
  value: number | null
  onChange: (value: number | null) => void
  label: string
}) {
  return (
    <div className={styles.row} role="group" aria-label={label}>
      {VALUES.map((n) => (
        <button
          key={n}
          type="button"
          className={cx(
            styles.step,
            value !== null && n <= value && styles.filled,
            value === n && styles.current,
          )}
          aria-pressed={value === n}
          aria-label={`${String(n)} of ${String(RATING_MAX)}`}
          onClick={() => {
            onChange(value === n ? null : n)
          }}
        >
          {n}
        </button>
      ))}
    </div>
  )
}

/**
 * 1–5 selector as a radio group.
 *
 * Radios rather than a slider: five discrete values are faster to hit, and a
 * radio group is announced properly by screen readers where a range input only
 * reads a number.
 *
 * Clicking the selected value clears it, so "not recorded" stays reachable —
 * otherwise a mis-click could never be undone.
 */
import styles from './ScoreGroup.module.scss'
import { cx } from '~/lib/cx'

export function ScoreGroup({
  legend,
  labels,
  value,
  onChange,
  name,
}: {
  legend: string
  /** 1-indexed, so `labels[0]` is unused padding. */
  labels: string[]
  value: number | null
  onChange: (v: number | null) => void
  name: string
}) {
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.label}>
        {legend}
        {value ? <span className={styles.scoreLabel}>{labels[value]}</span> : null}
      </legend>
      <div className={styles.scores}>
        {[1, 2, 3, 4, 5].map((score) => (
          <label key={score} className={cx(styles.score, value === score && styles.scoreActive)}>
            <input
              type="radio"
              name={name}
              className="visually-hidden"
              checked={value === score}
              onChange={() => {
                onChange(score)
              }}
              onClick={() => {
                if (value === score) onChange(null)
              }}
            />
            <span aria-hidden="true">{score}</span>
            <span className="visually-hidden">{labels[score]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

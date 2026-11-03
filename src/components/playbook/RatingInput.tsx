/**
 * A 1–10 rating: ten radios, one name, so the arrow keys move along them natively
 * and a screen reader announces a group of ten rather than ten stray buttons.
 * Clearable, because "not rated" is a value the score treats differently from any
 * number — it drops the part and marks the score provisional.
 */
import { useId } from 'react'
import styles from './RatingInput.module.scss'
import { cx } from '~/lib/cx'

const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

export function RatingInput({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string
  value: number | null
  onChange: (next: number | null) => void
  disabled?: boolean
}) {
  const name = useId()
  return (
    <fieldset className={styles.group} disabled={disabled}>
      <legend className={styles.legend}>{label}</legend>
      <div className={styles.row}>
        {VALUES.map((option) => (
          <label key={option} className={cx(styles.option, value === option && styles.chosen)}>
            <input
              type="radio"
              className="visually-hidden"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => {
                onChange(option)
              }}
            />
            {option}
          </label>
        ))}
        {value === null ? null : (
          <button
            type="button"
            className={styles.clear}
            onClick={() => {
              onChange(null)
            }}
          >
            Clear<span className="visually-hidden"> {label}</span>
          </button>
        )}
      </div>
    </fieldset>
  )
}

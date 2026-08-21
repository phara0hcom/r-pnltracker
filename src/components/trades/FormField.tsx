/**
 * One labelled field in the manual-trade form.
 *
 * The error slot replaces the hint rather than stacking under it: the two say
 * the same thing about the same input, and showing both pushes the row heights
 * around as you type.
 */
import styles from './FormField.module.scss'

export function FormField({
  label,
  error,
  hint,
  children,
}: {
  label: string
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      {children}
      {error ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className={styles.hint}>{hint}</span>
      ) : null}
    </label>
  )
}

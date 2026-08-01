/**
 * A destructive action that requires two clicks.
 *
 * Inline two-step rather than a modal: these live inside table rows and repeated
 * lists, where a dialog per row is heavy and steals focus for an action that is
 * usually reversible. The second click is still a deliberate, separate decision.
 *
 * The armed state reverts automatically, so a button left half-pressed cannot
 * sit there waiting to fire on an unrelated click later.
 */
import { useEffect, useRef, useState } from 'react'
import styles from './ConfirmButton.module.scss'
import { cx } from '~/lib/cx'

const REVERT_MS = 4000

export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = 'Sure?',
  disabled,
  className,
  title,
  size = 'normal',
}: {
  onConfirm: () => void
  children: React.ReactNode
  /** Shown once armed. Keep it short — it replaces the label in place. */
  confirmLabel?: string
  disabled?: boolean
  className?: string
  title?: string
  size?: 'normal' | 'small'
}) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const disarm = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setArmed(false)
  }

  // Clear the pending timer if the row unmounts mid-arm.
  useEffect(() => disarm, [])

  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      className={cx(
        styles.button,
        size === 'small' && styles.small,
        armed && styles.armed,
        className,
      )}
      // Announced so a screen reader hears the state change rather than only
      // seeing a relabelled control.
      aria-live="polite"
      onClick={() => {
        if (armed) {
          disarm()
          onConfirm()
          return
        }
        setArmed(true)
        timer.current = setTimeout(disarm, REVERT_MS)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && armed) {
          e.preventDefault()
          disarm()
        }
      }}
      onBlur={disarm}
    >
      {armed ? confirmLabel : children}
    </button>
  )
}

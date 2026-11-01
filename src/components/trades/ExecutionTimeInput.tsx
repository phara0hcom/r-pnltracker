/**
 * An optional execution time in JST, with what it resolves to.
 *
 * Shared by the import preview and the Trades edit row. A US fill gets a
 * "+1 day" toggle — after midnight JST it lands on the day after its stored
 * 約定日, or not, depending on whether the export was taken before settlement
 * — and shows the instant in New York time, so the owner can see which
 * session it falls in. A time outside every session warns; it never blocks.
 */
import { useId } from 'react'
import styles from './ExecutionTimeInput.module.scss'
import {
  formatEt,
  formatJst,
  resolveExecutedAt,
  sessionWarning,
  type TimeInput,
} from '~/lib/import/executionTime'

export function ExecutionTimeInput({
  tradeDate,
  market,
  value,
  onChange,
  label,
}: {
  tradeDate: string
  market: 'JP' | 'US'
  value: TimeInput
  onChange: (next: TimeInput) => void
  /** Names the input for screen readers, e.g. "BUY 100 8729". */
  label: string
}) {
  const hintId = useId()
  const at = resolveExecutedAt(tradeDate, value)
  const warning = at ? sessionWarning(at, market) : null

  return (
    <span className={styles.field}>
      <input
        type="time"
        className={styles.time}
        value={value.time}
        aria-label={`Time (JST) of ${label}`}
        aria-describedby={at ? hintId : undefined}
        onChange={(event) => {
          onChange({ ...value, time: event.target.value })
        }}
      />
      {market === 'US' ? (
        <label className={styles.nextDay}>
          <input
            type="checkbox"
            checked={value.nextDay}
            onChange={(event) => {
              onChange({ ...value, nextDay: event.target.checked })
            }}
          />
          +1 day
        </label>
      ) : null}
      {at ? (
        <span id={hintId} className={warning ? styles.warning : styles.resolved}>
          {market === 'US' ? `${formatJst(at)} = ${formatEt(at)}` : formatJst(at)}
          {warning ? ` · ${warning}` : ''}
        </span>
      ) : null}
    </span>
  )
}

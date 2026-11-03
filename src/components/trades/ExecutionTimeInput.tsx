/**
 * An optional execution time in JST, with what it resolves to.
 *
 * Shared by the import preview and the Trades edit row. A US fill gets a day
 * selector — its JST date can be either side of its stored 約定日, depending on
 * midnight and on whether the export was taken before settlement — and shows
 * the instant in New York time, so the owner can see which session it falls
 * in. A time outside every session warns; it never blocks.
 */
import { useId } from 'react'
import styles from './ExecutionTimeInput.module.scss'
import {
  formatEt,
  formatJst,
  resolveExecutedAt,
  sessionWarning,
  type DayOffset,
  type TimeInput,
} from '~/lib/import/executionTime'

const DAY_OFFSETS: { value: DayOffset; label: string }[] = [
  { value: -1, label: '−1 day' },
  { value: 0, label: 'Same day' },
  { value: 1, label: '+1 day' },
]

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
        <select
          className={styles.day}
          value={value.dayOffset}
          aria-label={`Day of ${label}, relative to its trade date`}
          onChange={(event) => {
            onChange({ ...value, dayOffset: Number(event.target.value) as DayOffset })
          }}
        >
          {DAY_OFFSETS.map((offset) => (
            <option key={offset.value} value={offset.value}>
              {offset.label}
            </option>
          ))}
        </select>
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

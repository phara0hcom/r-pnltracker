/** An image's phase, timeframe and caption: while it is held, and once it is stored. */
import { useId } from 'react'
import styles from './Images.module.scss'
import { FormField } from '~/components/trades/FormField'
import { MAX_CAPTION, MAX_TIMEFRAME, PHASE_LABEL, TIMEFRAME_SUGGESTIONS } from '~/lib/playbook/images'
import { IMAGE_PHASES, type ImagePhase } from '~/lib/playbook/types'

export interface ImageFieldValues {
  phase: ImagePhase
  timeframe: string
  caption: string
}

export function PhaseSelect({
  value,
  labelledBy,
  onChange,
}: {
  value: ImagePhase
  labelledBy?: string
  onChange: (phase: ImagePhase) => void
}) {
  return (
    <select
      className={styles.input}
      aria-labelledby={labelledBy}
      value={value}
      onChange={(event) => {
        onChange(event.target.value as ImagePhase)
      }}
    >
      {IMAGE_PHASES.map((phase) => (
        <option key={phase} value={phase}>
          {PHASE_LABEL[phase]}
        </option>
      ))}
    </select>
  )
}

export function ImageFields({
  value,
  onChange,
}: {
  value: ImageFieldValues
  onChange: (value: ImageFieldValues) => void
}) {
  const suggestions = useId()
  return (
    <div className={styles.fields}>
      <FormField label="Phase">
        <PhaseSelect
          value={value.phase}
          onChange={(phase) => {
            onChange({ ...value, phase })
          }}
        />
      </FormField>
      <FormField label="Timeframe">
        <input
          className={styles.input}
          list={suggestions}
          maxLength={MAX_TIMEFRAME}
          placeholder="1D"
          value={value.timeframe}
          onChange={(event) => {
            onChange({ ...value, timeframe: event.target.value })
          }}
        />
        <datalist id={suggestions}>
          {TIMEFRAME_SUGGESTIONS.map((timeframe) => (
            <option key={timeframe} value={timeframe} />
          ))}
        </datalist>
      </FormField>
      <div className={styles.captionField}>
        <FormField label="Caption">
          <input
            className={styles.input}
            maxLength={MAX_CAPTION}
            value={value.caption}
            onChange={(event) => {
              onChange({ ...value, caption: event.target.value })
            }}
          />
        </FormField>
      </div>
    </div>
  )
}

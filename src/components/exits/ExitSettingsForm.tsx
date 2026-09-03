/**
 * The framework's tunables.
 *
 * Every one of these is a judgement the framework deliberately leaves open —
 * target 1.5–2.0 R, partial 33–50%, time stop 10–15 sessions — so none of them
 * is hardcoded. The hints carry the framework's own suggested ranges rather than
 * the input's hard limits, which are wider: the point is to say what is sensible,
 * not to prevent experimenting outside it.
 *
 * Saving re-evaluates every open position, because the levels are derived on
 * read rather than stored. The one thing a change here cannot do is move a stop
 * that is already locked: `initialStop` and R are fixed from the entry-date bar,
 * so a new ATR multiple applies to the next plan, not to the ones already open.
 */
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import styles from './ExitSettingsForm.module.scss'
import { FormField } from '~/components/trades/FormField'
import { cx } from '~/lib/cx'
import { TRAILING_METHODS, type TrailingMethod } from '~/lib/exit/types'
import { saveExitSettings, type ExitSettingsView } from '~/server/exit'

const METHOD_LABEL: Record<TrailingMethod, string> = {
  ATR: 'ATR chandelier (highest close − k×ATR)',
  SMA10: 'SMA 10, while rising',
  SMA20: 'SMA 20, while rising',
}

export function ExitSettingsForm({
  settings,
  onSaved,
}: {
  settings: ExitSettingsView
  onSaved: () => void
}) {
  const [form, setForm] = useState<ExitSettingsView>(settings)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Re-seed when the loader returns different values (another tab, a refetch).
  const [previous, setPrevious] = useState(settings)
  if (previous !== settings) {
    setPrevious(settings)
    setForm(settings)
  }

  const save = useMutation({
    mutationFn: () =>
      saveExitSettings({
        data: {
          targetMultiple: form.targetMultiple,
          partialExitFraction: form.partialExitFraction,
          initialStopAtrMultiple: form.initialStopAtrMultiple,
          trailingAtrMultiple: form.trailingAtrMultiple,
          timeStopDays: form.timeStopDays,
          trailingMethod: form.trailingMethod,
          staleTradingDays: form.staleTradingDays,
        },
      }),
    onSuccess: () => {
      setErrors({})
      onSaved()
    },
    onError: (error: unknown) => {
      const issues = (error as { issues?: { path: (string | number)[]; message: string }[] }).issues
      if (issues) {
        setErrors(
          Object.fromEntries(issues.map((issue) => [String(issue.path[0] ?? 'form'), issue.message])),
        )
        return
      }
      setErrors({ form: error instanceof Error ? error.message : 'Could not save' })
    },
  })

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <div className={styles.grid}>
        <FormField label="Target 1 multiple" error={errors.targetMultiple} hint="1.5–2.0 × R">
          <input
            className={styles.input}
            inputMode="decimal"
            value={form.targetMultiple}
            onChange={(event) => { setForm({ ...form, targetMultiple: event.target.value }) }}
          />
        </FormField>

        <FormField
          label="Partial exit fraction"
          error={errors.partialExitFraction}
          hint="0.33–0.50 of entry size"
        >
          <input
            className={styles.input}
            inputMode="decimal"
            value={form.partialExitFraction}
            onChange={(event) => { setForm({ ...form, partialExitFraction: event.target.value }) }}
          />
        </FormField>

        <FormField
          label="Initial stop ATR ×"
          error={errors.initialStopAtrMultiple}
          hint="Applies to new plans only"
        >
          <input
            className={styles.input}
            inputMode="decimal"
            value={form.initialStopAtrMultiple}
            onChange={(event) => { setForm({ ...form, initialStopAtrMultiple: event.target.value }) }}
          />
        </FormField>

        <FormField label="Trailing ATR ×" error={errors.trailingAtrMultiple} hint="3 is standard">
          <input
            className={styles.input}
            inputMode="decimal"
            value={form.trailingAtrMultiple}
            onChange={(event) => { setForm({ ...form, trailingAtrMultiple: event.target.value }) }}
          />
        </FormField>

        <FormField label="Time stop (sessions)" error={errors.timeStopDays} hint="10–15">
          <input
            className={styles.input}
            inputMode="numeric"
            value={String(form.timeStopDays)}
            onChange={(event) => {
              setForm({ ...form, timeStopDays: Number(event.target.value) || 0 })
            }}
          />
        </FormField>

        <FormField
          label="Stale after (sessions)"
          error={errors.staleTradingDays}
          hint="Missed payloads before warning"
        >
          <input
            className={styles.input}
            inputMode="numeric"
            value={String(form.staleTradingDays)}
            onChange={(event) => {
              setForm({ ...form, staleTradingDays: Number(event.target.value) || 0 })
            }}
          />
        </FormField>

        <FormField
          label="Default trailing method"
          error={errors.trailingMethod}
          hint="Overridable per plan"
        >
          <select
            className={styles.input}
            value={form.trailingMethod}
            onChange={(event) => {
              setForm({ ...form, trailingMethod: event.target.value as TrailingMethod })
            }}
          >
            {TRAILING_METHODS.map((method) => (
              <option key={method} value={method}>
                {METHOD_LABEL[method]}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      {errors.form ? (
        <p className={styles.formError} role="alert">
          {errors.form}
        </p>
      ) : null}

      <div className={styles.actions}>
        {save.isSuccess ? <span className={styles.saved}>Saved</span> : null}
        <button
          type="submit"
          className={cx(styles.primary, save.isPending && styles.busy)}
          disabled={save.isPending}
        >
          {save.isPending ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  )
}

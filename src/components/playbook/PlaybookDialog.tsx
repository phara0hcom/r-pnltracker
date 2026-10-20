/**
 * Creates or edits a playbook: a type of play, and what has to be true to take it.
 *
 * The criteria are the useful half. A review ticks off the ones that held at
 * entry, which is what lets the playbook screen ask whether trades taken
 * against the plan do worse than trades taken on it.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import styles from './PlaybookDialogs.module.scss'
import { toFieldErrors } from '~/components/exits/fieldErrors'
import { FormField } from '~/components/trades/FormField'
import { useDialogHistory } from '~/components/ui/useDialogHistory'
import { cx } from '~/lib/cx'
import { reportError } from '~/lib/observability/report'
import { savePlaybookFn, type PlaybookView } from '~/server/playbook'

/** A criterion row. The key keeps an input's focus and text with it when a row above is removed. */
interface Criterion {
  key: number
  text: string
}

interface Form {
  name: string
  description: string
  criteria: Criterion[]
}

let nextKey = 0
const row = (text: string): Criterion => ({ key: nextKey++, text })

const fromPlaybook = (playbook: PlaybookView | null): Form => ({
  name: playbook?.name ?? '',
  description: playbook?.description ?? '',
  // One empty row to type into, so the list never opens with nothing to click.
  criteria: playbook && playbook.criteria.length > 0 ? playbook.criteria.map(row) : [row('')],
})

export function PlaybookDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: PlaybookView | null
  onSaved: () => void
}) {
  useDialogHistory(open, () => {
    onOpenChange(false)
  })
  const [form, setForm] = useState<Form>(() => fromPlaybook(editing))
  const [errors, setErrors] = useState<Record<string, string>>({})

  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setForm(fromPlaybook(editing))
      setErrors({})
    }
  }

  const save = useMutation({
    mutationFn: () =>
      savePlaybookFn({
        data: {
          id: editing?.id,
          name: form.name,
          description: form.description,
          criteria: form.criteria.map((criterion) => criterion.text.trim()).filter(Boolean),
        },
      }),
    onSuccess: () => {
      onOpenChange(false)
      onSaved()
    },
    onError: (error: unknown) => {
      reportError(error, { mutation: 'savePlaybook' })
      setErrors(toFieldErrors(error))
    },
  })

  const setCriterion = (key: number, text: string) => {
    setForm({
      ...form,
      criteria: form.criteria.map((old) => (old.key === key ? { key, text } : old)),
    })
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <Dialog.Title className={styles.title}>
            {editing ? `Edit ${editing.name}` : 'New playbook'}
          </Dialog.Title>
          <Dialog.Description className={styles.description}>
            A type of play — a breakout, a pullback to the 20-day — and the conditions that make a
            trade one.
          </Dialog.Description>

          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault()
              setErrors({})
              save.mutate()
            }}
          >
            <FormField label="Name" error={errors.name}>
              <input
                className={styles.input}
                value={form.name}
                onChange={(event) => {
                  setForm({ ...form, name: event.target.value })
                }}
                placeholder="Breakout from base"
                required
              />
            </FormField>

            <FormField label="Description" error={errors.description}>
              <textarea
                className={cx(styles.input, styles.textarea)}
                value={form.description}
                onChange={(event) => {
                  setForm({ ...form, description: event.target.value })
                }}
                placeholder="What the setup looks like, where the stop goes, how it is managed"
              />
            </FormField>

            <fieldset className={styles.criteria}>
              <legend className={styles.description}>
                Entry criteria — what must be true to take it
              </legend>
              {form.criteria.map((criterion, index) => (
                <div key={criterion.key} className={styles.criterion}>
                  <input
                    className={styles.input}
                    value={criterion.text}
                    aria-label={`Criterion ${String(index + 1)}`}
                    onChange={(event) => {
                      setCriterion(criterion.key, event.target.value)
                    }}
                    placeholder="Closes above the 20-day high on volume"
                  />
                  <button
                    type="button"
                    className={styles.remove}
                    aria-label={`Remove criterion ${String(index + 1)}`}
                    onClick={() => {
                      setForm({
                        ...form,
                        criteria: form.criteria.filter((kept) => kept.key !== criterion.key),
                      })
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={styles.add}
                onClick={() => {
                  setForm({ ...form, criteria: [...form.criteria, row('')] })
                }}
              >
                + Add criterion
              </button>
            </fieldset>

            {errors.form ? (
              <p className={styles.formError} role="alert">
                {errors.form}
              </p>
            ) : null}

            <div className={styles.footer}>
              <Dialog.Close asChild>
                <button type="button" className={styles.secondary}>
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                className={cx(styles.primary, save.isPending && styles.busy)}
                disabled={save.isPending}
              >
                {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create playbook'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

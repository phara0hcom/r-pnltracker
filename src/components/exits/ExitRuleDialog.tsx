/**
 * Opens an exit plan over a holding, or corrects one already open.
 *
 * The holding picker is the whole design of the create path. Everything except
 * the support level is already known — the engine has the pool, and
 * `openEntryStreaks` has the date and blended price the current swing was
 * entered at — so choosing a position fills the form and leaves exactly one
 * judgement to make, which is the one the framework actually asks a human for.
 *
 * The prefilled values stay editable and are frozen into the plan on save: the
 * pool average drifts with the next top-up, the price this swing was entered at
 * does not.
 *
 * Edit mode exists for a narrower reason. The locked entry facts are immutable
 * against the *market* — no later ATR or shifted support may move them — but a
 * mistyped support level is a different thing entirely, and correcting the
 * record is not the same as letting price move it. Which is why the instrument
 * and entry date are fixed once a plan exists: changing those would not be a
 * correction, it would be a different trade.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import styles from './ExitRuleDialog.module.scss'
import { ACCOUNT_LABEL } from '~/components/format'
import { FormField } from '~/components/trades/FormField'
import { cx } from '~/lib/cx'
import { TRAILING_METHODS, type TrailingMethod } from '~/lib/exit/types'
import {
  createExitRule,
  updateExitRule,
  type EligibleHolding,
  type ExitRuleRow,
} from '~/server/exit'

interface Form {
  /** Index into `eligible`, as a string — it is a `<select>` value. */
  holding: string
  entryDate: string
  entryPrice: string
  totalShares: string
  supportLevel: string
  trailingMethod: TrailingMethod | ''
  note: string
}

const blank = (): Form => ({
  holding: '',
  entryDate: '',
  entryPrice: '',
  totalShares: '',
  supportLevel: '',
  trailingMethod: '',
  note: '',
})

const fromRow = (row: ExitRuleRow): Form => ({
  holding: '',
  entryDate: row.entryDate,
  entryPrice: row.entryPrice,
  totalShares: row.totalShares,
  supportLevel: row.supportLevel,
  trailingMethod: row.trailingMethodOverride ?? '',
  note: row.note ?? '',
})

const METHOD_LABEL: Record<TrailingMethod, string> = {
  ATR: 'ATR chandelier',
  SMA10: 'SMA 10',
  SMA20: 'SMA 20',
}

/** Field errors come back keyed by path; anything else is shown whole. */
function toFieldErrors(error: unknown): Record<string, string> {
  const issues = (error as { issues?: { path: (string | number)[]; message: string }[] }).issues
  if (issues) {
    return Object.fromEntries(
      issues.map((issue) => [String(issue.path[0] ?? 'form'), issue.message]),
    )
  }
  return { form: error instanceof Error ? error.message : 'Could not save' }
}

export function ExitRuleDialog({
  open,
  onOpenChange,
  eligible,
  editing,
  defaultMethod,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  eligible: EligibleHolding[]
  /** The plan being corrected, or null to open a new one. */
  editing: ExitRuleRow | null
  /** The global setting, shown as the "use default" option's label. */
  defaultMethod: TrailingMethod
  onSaved: () => void
}) {
  const [form, setForm] = useState<Form>(blank)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Re-seed on open rather than in an effect — React's documented
  // reset-on-prop-change pattern, and it avoids a frame of stale form.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setForm(editing ? fromRow(editing) : blank())
      setErrors({})
    }
  }

  const picked = form.holding === '' ? null : eligible[Number(form.holding)]
  const currency = editing?.currency ?? picked?.currency ?? 'JPY'
  const unit = currency === 'USD' ? ' ($)' : ' (¥)'

  /** Choosing a holding refills every derived field; support stays the user's. */
  const pick = (index: string) => {
    const holding = index === '' ? null : eligible[Number(index)]
    setForm((previous) => ({
      ...previous,
      holding: index,
      entryDate: holding?.entryDate ?? '',
      entryPrice: holding?.entryPrice ?? '',
      totalShares: holding?.quantity ?? '',
    }))
  }

  const save = useMutation({
    mutationFn: () => {
      const trailingMethod = form.trailingMethod === '' ? null : form.trailingMethod
      const note = form.note.trim() === '' ? null : form.note.trim()

      if (editing) {
        return updateExitRule({
          data: {
            id: editing.id,
            entryPrice: form.entryPrice,
            totalShares: form.totalShares,
            supportLevel: form.supportLevel,
            trailingMethod,
            note,
          },
        })
      }

      if (!picked) throw new Error('pick a holding')
      return createExitRule({
        data: {
          symbol: picked.symbol,
          accountType: picked.accountType,
          entryDate: form.entryDate,
          entryPrice: form.entryPrice,
          totalShares: form.totalShares,
          supportLevel: form.supportLevel,
          lotSize: picked.lotSize,
          trailingMethod,
          note,
        },
      })
    },
    onSuccess: () => {
      onOpenChange(false)
      onSaved()
    },
    onError: (error: unknown) => {
      setErrors(toFieldErrors(error))
    },
  })

  const submit = (event: React.SyntheticEvent) => {
    event.preventDefault()
    setErrors({})
    save.mutate()
  }

  const nothingToPlan = !editing && eligible.length === 0

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <Dialog.Title className={styles.title}>
            {editing ? `Edit plan — ${editing.symbol}` : 'New exit plan'}
          </Dialog.Title>
          <Dialog.Description className={styles.description}>
            {editing
              ? 'Corrects the locked entry facts. The instrument and entry date are fixed — changing those would be a different trade, not a correction.'
              : 'Entry date, price and size are prefilled from the current holding streak and locked in on save. Only the support level is yours to judge.'}
          </Dialog.Description>

          {nothingToPlan ? (
            <p className={styles.empty}>
              Every open equity position already has a plan. Close one, or import a new trade first.
            </p>
          ) : (
            <form className={styles.form} onSubmit={submit}>
              {editing ? (
                <div className={styles.fixed}>
                  <span className={styles.fixedLabel}>Holding</span>
                  <span className={styles.fixedValue}>
                    {editing.symbol} · {editing.name} ·{' '}
                    {ACCOUNT_LABEL[editing.accountType] ?? editing.accountType} · entered{' '}
                    {editing.entryDate}
                  </span>
                </div>
              ) : (
                <FormField label="Holding" error={errors.symbol}>
                  <select
                    className={styles.input}
                    value={form.holding}
                    onChange={(event) => {
                      pick(event.target.value)
                    }}
                    required
                  >
                    <option value="">Choose a position…</option>
                    {eligible.map((holding, index) => (
                      <option key={`${holding.symbol}-${holding.accountType}`} value={String(index)}>
                        {holding.symbol} · {holding.name} ·{' '}
                        {ACCOUNT_LABEL[holding.accountType] ?? holding.accountType}
                      </option>
                    ))}
                  </select>
                </FormField>
              )}

              <div className={styles.row}>
                {editing ? null : (
                  <FormField label="Entry date" error={errors.entryDate}>
                    <input
                      className={styles.input}
                      type="date"
                      value={form.entryDate}
                      onChange={(event) => {
                        setForm({ ...form, entryDate: event.target.value })
                      }}
                      required
                    />
                  </FormField>
                )}

                <FormField
                  label={`Entry price${unit}`}
                  error={errors.entryPrice}
                  hint="Blended over the streak"
                >
                  <input
                    className={styles.input}
                    inputMode="decimal"
                    value={form.entryPrice}
                    onChange={(event) => {
                      setForm({ ...form, entryPrice: event.target.value })
                    }}
                    required
                  />
                </FormField>

                {editing ? (
                  <FormField label="Total shares" error={errors.totalShares} hint="Size at entry">
                    <input
                      className={styles.input}
                      inputMode="decimal"
                      value={form.totalShares}
                      onChange={(event) => {
                        setForm({ ...form, totalShares: event.target.value })
                      }}
                      required
                    />
                  </FormField>
                ) : null}
              </div>

              <div className={styles.row}>
                {editing ? null : (
                  <FormField
                    label="Total shares"
                    error={errors.totalShares}
                    hint={picked ? `${String(picked.lotSize)}-share lots` : undefined}
                  >
                    <input
                      className={styles.input}
                      inputMode="decimal"
                      value={form.totalShares}
                      onChange={(event) => {
                        setForm({ ...form, totalShares: event.target.value })
                      }}
                      required
                    />
                  </FormField>
                )}

                <FormField
                  label={`Support level${unit}`}
                  error={errors.supportLevel}
                  hint="Must sit below entry"
                >
                  <input
                    className={styles.input}
                    inputMode="decimal"
                    value={form.supportLevel}
                    onChange={(event) => {
                      setForm({ ...form, supportLevel: event.target.value })
                    }}
                    required
                  />
                </FormField>

                <FormField
                  label="Trailing method"
                  error={errors.trailingMethod}
                  hint="Applies only after Target 1"
                >
                  <select
                    className={styles.input}
                    value={form.trailingMethod}
                    onChange={(event) => {
                      setForm({ ...form, trailingMethod: event.target.value as TrailingMethod | '' })
                    }}
                  >
                    <option value="">Use default ({METHOD_LABEL[defaultMethod]})</option>
                    {TRAILING_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {METHOD_LABEL[method]}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>

              <FormField label="Note" error={errors.note}>
                <input
                  className={styles.input}
                  value={form.note}
                  onChange={(event) => {
                    setForm({ ...form, note: event.target.value })
                  }}
                  placeholder="Thesis, catalyst, why this level"
                />
              </FormField>

              {/*
                The entry ATR is stored, not re-read, so a plan created before its
                entry-day bar arrived rests on support alone until the webhook
                backfills it. Saying so here is the only place the user can act on it.
              */}
              {editing?.stopFromSupportOnly ? (
                <p className={styles.hintBox}>
                  No entry-date bar has arrived for this plan, so the initial stop is the support
                  level alone. It fills in automatically if a payload for {editing.entryDate} ever
                  lands.
                </p>
              ) : null}

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
                  disabled={save.isPending || (!editing && !picked)}
                >
                  {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create plan'}
                </button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

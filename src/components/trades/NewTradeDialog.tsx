/**
 * Manual trade entry.
 *
 * Posts through the same zod schema and service the inline editor uses, so a
 * hand-entered trade and a corrected import are validated identically. Field
 * errors come back keyed by path and render against the field they belong to.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import styles from './NewTradeDialog.module.scss'
import { cx } from '~/lib/cx'
import { todayLocal } from '~/lib/localDate'
import { addTrade } from '~/server/trades'

interface Form {
  symbol: string
  name: string
  assetClass: 'JP_EQUITY' | 'US_EQUITY' | 'FUND'
  accountType: 'SPECIFIC' | 'NISA_GROWTH' | 'NISA_TSUMITATE' | 'NISA_OLD'
  side: 'BUY' | 'SELL' | 'REINVEST' | 'REDEEM'
  tradeDate: string
  settleDate: string
  quantity: string
  unitPrice: string
  fee: string
  feeTax: string
  fxRate: string
  memo: string
}

/**
 * A function, not a constant: the default trade date has to be read at the
 * moment the form opens or resets. A module-level object freezes it at import
 * time, so a tab left open overnight keeps pre-filling yesterday.
 */
const blank = (): Form => ({
  symbol: '',
  name: '',
  assetClass: 'JP_EQUITY',
  accountType: 'SPECIFIC',
  side: 'BUY',
  tradeDate: todayLocal(),
  settleDate: '',
  quantity: '',
  unitPrice: '',
  fee: '',
  feeTax: '',
  fxRate: '',
  memo: '',
})

export function NewTradeDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [form, setForm] = useState<Form>(blank)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // The dialog stays mounted while closed, so anything computed on the first
  // render would live as long as the route. Re-blanking on open is what makes
  // `todayLocal()` read the day the user is on rather than the day the page was
  // loaded; it also drops errors left over from a previous attempt.
  //
  // Adjusted during render rather than in an effect — React's documented
  // reset-on-prop-change pattern, and it avoids a frame of stale form.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setForm(blank())
      setErrors({})
    }
  }

  const create = useMutation({
    mutationFn: () =>
      addTrade({
        data: {
          symbol: form.symbol,
          name: form.name || undefined,
          assetClass: form.assetClass,
          accountType: form.accountType,
          side: form.side,
          tradeDate: form.tradeDate,
          settleDate: form.settleDate || undefined,
          quantity: form.quantity,
          unitPrice: form.unitPrice,
          fee: form.fee || undefined,
          feeTax: form.feeTax || undefined,
          fxRate: form.fxRate || undefined,
          memo: form.memo || undefined,
        },
      }),
    onSuccess: (r) => {
      if (r.ok) {
        setForm(blank())
        setErrors({})
        onCreated()
        onOpenChange(false)
      } else {
        setErrors(r.errors ?? { _: 'Could not save.' })
      }
    },
  })

  const set = <K extends keyof Form>(key: K) => (v: Form[K]) => {
    setForm((f) => ({ ...f, [key]: v }))
  }

  const isUsd = form.assetClass === 'US_EQUITY'
  const isFund = form.assetClass === 'FUND'

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <div className={styles.head}>
            <div>
              <Dialog.Title className={styles.title}>Add trade</Dialog.Title>
              <Dialog.Description className={styles.subtitle}>
                For fills Rakuten has not exported yet.
              </Dialog.Description>
            </div>
            <Dialog.Close className={styles.close} aria-label="Close">
              ×
            </Dialog.Close>
          </div>

          <div className={styles.body}>
            <div className={styles.row}>
              <Field label="Asset class" error={errors.assetClass}>
                <select
                  className={styles.input}
                  value={form.assetClass}
                  onChange={(e) => {
                    set('assetClass')(e.target.value as Form['assetClass'])
                  }}
                >
                  <option value="JP_EQUITY">JP equity</option>
                  <option value="US_EQUITY">US equity</option>
                  <option value="FUND">Fund</option>
                </select>
              </Field>

              <Field label="Account" error={errors.accountType}>
                <select
                  className={styles.input}
                  value={form.accountType}
                  onChange={(e) => {
                    set('accountType')(e.target.value as Form['accountType'])
                  }}
                >
                  <option value="SPECIFIC">特定 (taxable)</option>
                  <option value="NISA_GROWTH">NISA 成長投資枠</option>
                  <option value="NISA_TSUMITATE">NISA つみたて投資枠</option>
                  <option value="NISA_OLD">旧NISA</option>
                </select>
              </Field>

              <Field label="Side" error={errors.side}>
                <select
                  className={styles.input}
                  value={form.side}
                  onChange={(e) => {
                    set('side')(e.target.value as Form['side'])
                  }}
                >
                  <option value="BUY">Buy</option>
                  <option value="SELL">Sell</option>
                  {isFund ? <option value="REINVEST">Reinvest</option> : null}
                  {isFund ? <option value="REDEEM">Redeem</option> : null}
                </select>
              </Field>
            </div>

            <div className={styles.row}>
              <Field
                label={isFund ? 'Fund name' : 'Symbol'}
                error={errors.symbol}
                hint={isFund ? 'Funds are identified by name' : 'e.g. 8411 or AAPL'}
              >
                <input
                  className={cx(styles.input, styles.grow)}
                  value={form.symbol}
                  onChange={(e) => {
                    set('symbol')(e.target.value)
                  }}
                />
              </Field>
              <Field label="Display name" error={errors.name} hint="Optional">
                <input
                  className={cx(styles.input, styles.grow)}
                  value={form.name}
                  onChange={(e) => {
                    set('name')(e.target.value)
                  }}
                />
              </Field>
            </div>

            <div className={styles.row}>
              <Field label="Trade date" error={errors.tradeDate}>
                <input
                  type="date"
                  className={styles.input}
                  value={form.tradeDate}
                  onChange={(e) => {
                    set('tradeDate')(e.target.value)
                  }}
                />
              </Field>
              <Field label="Settle date" error={errors.settleDate} hint="Defaults to T+2">
                <input
                  type="date"
                  className={styles.input}
                  value={form.settleDate}
                  onChange={(e) => {
                    set('settleDate')(e.target.value)
                  }}
                />
              </Field>
            </div>

            <div className={styles.row}>
              <Field label="Quantity" error={errors.quantity}>
                <input
                  inputMode="decimal"
                  className={cx(styles.input, styles.num)}
                  value={form.quantity}
                  onChange={(e) => {
                    set('quantity')(e.target.value)
                  }}
                />
              </Field>
              <Field
                label={isFund ? 'Price (per 10,000 口)' : isUsd ? 'Price (USD)' : 'Price (¥)'}
                error={errors.unitPrice}
                hint={isFund ? '基準価額, as Rakuten shows it' : undefined}
              >
                <input
                  inputMode="decimal"
                  className={cx(styles.input, styles.num)}
                  value={form.unitPrice}
                  onChange={(e) => {
                    set('unitPrice')(e.target.value)
                  }}
                />
              </Field>
              {isUsd ? (
                <Field label="USD/JPY" error={errors.fxRate} hint="Required for US trades">
                  <input
                    inputMode="decimal"
                    className={cx(styles.input, styles.num)}
                    value={form.fxRate}
                    onChange={(e) => {
                      set('fxRate')(e.target.value)
                    }}
                  />
                </Field>
              ) : null}
            </div>

            <div className={styles.row}>
              <Field label="Fee" error={errors.fee}>
                <input
                  inputMode="decimal"
                  className={cx(styles.input, styles.num)}
                  value={form.fee}
                  onChange={(e) => {
                    set('fee')(e.target.value)
                  }}
                />
              </Field>
              <Field label="Fee tax" error={errors.feeTax} hint="Consumption tax on commission">
                <input
                  inputMode="decimal"
                  className={cx(styles.input, styles.num)}
                  value={form.feeTax}
                  onChange={(e) => {
                    set('feeTax')(e.target.value)
                  }}
                />
              </Field>
            </div>

            <Field label="Memo" error={errors.memo}>
              <input
                className={cx(styles.input, styles.grow)}
                value={form.memo}
                onChange={(e) => {
                  set('memo')(e.target.value)
                }}
                placeholder="Rationale, thesis, mistake…"
              />
            </Field>

            {errors._ ? (
              <p className={styles.formError} role="alert">
                {errors._}
              </p>
            ) : null}
          </div>

          <div className={styles.footer}>
            <Dialog.Close className={styles.button}>Cancel</Dialog.Close>
            <button
              type="button"
              className={cx(styles.button, styles.primary)}
              disabled={create.isPending}
              onClick={() => {
                create.mutate()
              }}
            >
              {create.isPending ? 'Saving…' : 'Add trade'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Field({
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

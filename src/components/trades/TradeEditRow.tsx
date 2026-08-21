/**
 * One trade's cells turned into inputs.
 *
 * Saving posts the whole row through the same zod schema and `updateTrade`
 * service that hand-entered trades use, so validation cannot diverge between the
 * two paths. Amount, realized and return are not editable — they are engine
 * output, recomputed from the fields above.
 */
import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ACCOUNT_LABEL } from './accountLabel'
import styles from './TradesTable.module.scss'
import { cx } from '~/lib/cx'
import { saveTrade, type TradeRow } from '~/server/trades'

/** The editable form fields. Strings throughout — never `number`, to keep precision. */
interface Draft {
  tradeDate: string
  settleDate: string
  symbol: string
  quantity: string
  unitPrice: string
  fee: string
  feeTax: string
  fxRate: string
  memo: string
}

export function TradeEditRow({
  row,
  onCancel,
  onSaved,
}: {
  row: TradeRow
  onCancel: () => void
  onSaved: () => void
}) {
  const [draft, setDraft] = useState<Draft>({
    tradeDate: row.tradeDate,
    settleDate: row.settleDate,
    symbol: row.symbol,
    quantity: row.quantity,
    unitPrice: row.displayPrice,
    fee: row.fee,
    feeTax: row.feeTax,
    fxRate: row.fxRate,
    memo: row.memo ?? '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const firstField = useRef<HTMLInputElement>(null)

  // Focus the first field on entering edit mode so keyboard users are not left
  // hunting for where the row became editable.
  useEffect(() => {
    firstField.current?.focus()
  }, [])

  const save = useMutation({
    mutationFn: () =>
      saveTrade({
        data: {
          id: row.id,
          patch: {
            symbol: draft.symbol,
            name: row.name,
            assetClass: row.assetClass,
            accountType: row.accountType,
            side: row.side,
            tradeDate: draft.tradeDate,
            settleDate: draft.settleDate,
            quantity: draft.quantity,
            unitPrice: draft.unitPrice,
            fee: draft.fee || undefined,
            feeTax: draft.feeTax || undefined,
            fxRate: row.currency === 'USD' ? draft.fxRate : undefined,
            memo: draft.memo || undefined,
          },
        },
      }),
    onSuccess: (result) => {
      if (result.ok) {
        setErrors({})
        onSaved()
      } else {
        setErrors(result.errors ?? { _: 'Could not save.' })
      }
    },
  })

  const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraft((current) => ({ ...current, [key]: e.target.value }))
  }

  /** Enter saves, Escape cancels — expected of any inline editor. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      save.mutate()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  const err = (field: string) => errors[field]

  return (
    <>
      <tr className={styles.editing} onKeyDown={onKeyDown}>
        <td>
          <input
            ref={firstField}
            type="date"
            className={cx(styles.cellInput, err('tradeDate') && styles.inputError)}
            value={draft.tradeDate}
            onChange={set('tradeDate')}
            aria-label="Trade date"
          />
        </td>
        <td>
          <input
            type="date"
            className={cx(styles.cellInput, err('settleDate') && styles.inputError)}
            value={draft.settleDate}
            onChange={set('settleDate')}
            aria-label="Settlement date"
          />
        </td>
        <td>
          <input
            type="text"
            className={cx(styles.cellInput, styles.wide, err('symbol') && styles.inputError)}
            value={draft.symbol}
            onChange={set('symbol')}
            aria-label="Symbol"
          />
        </td>
        <td>
          <span className={styles.readonlyCell}>{ACCOUNT_LABEL[row.accountType]}</span>
        </td>
        <td>
          <span className={styles.readonlyCell}>{row.side}</span>
        </td>
        <td>
          <input
            type="text"
            inputMode="decimal"
            className={cx(styles.cellInput, styles.num, err('quantity') && styles.inputError)}
            value={draft.quantity}
            onChange={set('quantity')}
            aria-label="Quantity"
          />
        </td>
        <td>
          <input
            type="text"
            inputMode="decimal"
            className={cx(styles.cellInput, styles.num, err('unitPrice') && styles.inputError)}
            value={draft.unitPrice}
            onChange={set('unitPrice')}
            aria-label={row.assetClass === 'FUND' ? 'Price per 10,000 units' : 'Unit price'}
          />
        </td>
        <td>
          <input
            type="text"
            inputMode="decimal"
            className={cx(styles.cellInput, styles.num, err('fee') && styles.inputError)}
            value={draft.fee}
            onChange={set('fee')}
            aria-label="Fee"
          />
        </td>
        <td>
          {row.currency === 'USD' ? (
            <input
              type="text"
              inputMode="decimal"
              className={cx(styles.cellInput, styles.num, err('fxRate') && styles.inputError)}
              value={draft.fxRate}
              onChange={set('fxRate')}
              aria-label="USD/JPY rate"
            />
          ) : (
            <span className={styles.readonlyCell}>—</span>
          )}
        </td>
        <td className={styles.numeric}>
          <span className={styles.recalcHint}>recalc</span>
        </td>
        <td className={styles.numeric}>
          <span className={styles.recalcHint}>recalc</span>
        </td>
        <td className={styles.numeric}>
          <span className={styles.recalcHint}>recalc</span>
        </td>
        <td className={styles.actions}>
          <div className={styles.actions}>
            <button
              type="button"
              className={cx(styles.action, styles.primary)}
              onClick={() => {
                save.mutate()
              }}
              disabled={save.isPending}
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className={styles.action} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </td>
      </tr>

      <tr className={styles.editingAux}>
        <td colSpan={13}>
          <div className={styles.auxRow}>
            <label className={styles.memoField}>
              <span className={styles.memoLabel}>Memo</span>
              <input
                type="text"
                className={styles.memoInput}
                value={draft.memo}
                onChange={set('memo')}
                placeholder="Rationale, thesis, mistake…"
              />
            </label>

            {row.assetClass === 'FUND' ? (
              <span className={styles.note}>
                Price is 基準価額 per 10,000 口, as Rakuten shows it.
              </span>
            ) : null}

            {Object.keys(errors).length > 0 ? (
              <ul className={styles.errorList} role="alert">
                {Object.entries(errors).map(([field, message]) => (
                  <li key={field}>{field === '_' ? message : `${field}: ${message}`}</li>
                ))}
              </ul>
            ) : (
              <span className={styles.note}>Enter saves · Escape cancels</span>
            )}
          </div>
        </td>
      </tr>
    </>
  )
}

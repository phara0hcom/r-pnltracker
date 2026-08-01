/**
 * Trades table with per-row inline editing.
 *
 * An Edit button turns one row's cells into inputs. Saving posts the whole row
 * through the same zod schema and `updateTrade` service that hand-entered trades
 * use, so validation cannot diverge between the two paths.
 *
 * Only one row is editable at a time — concurrent edits to a cost-basis chain
 * would let two saves race and produce a pool that matches neither.
 */
import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import styles from './TradesTable.module.scss'
import { useColumnWidths, type ColumnWidths } from './useColumnWidths'
import { ConfirmButton } from '~/components/ui/ConfirmButton'
import { cx } from '~/lib/cx'
import { removeTrade, saveTrade, undoRemoveTrade, type TradeRow } from '~/server/trades'

type SortKey =
  | 'tradeDate'
  | 'settleDate'
  | 'symbol'
  | 'quantity'
  | 'displayPrice'
  | 'netAmountJpy'
  | 'realizedJpy'
  | 'returnPct'

/**
 * Starting widths in px. Every column is user-resizable from here, and the
 * values persist per browser.
 */
const COLUMNS = [
  'tradeDate',
  'settleDate',
  'symbol',
  'account',
  'side',
  'quantity',
  'price',
  'fee',
  'fx',
  'amount',
  'realized',
  'returnPct',
  'actions',
] as const

const DEFAULT_WIDTHS: ColumnWidths = {
  tradeDate: 92,
  settleDate: 92,
  symbol: 200,
  account: 90,
  side: 74,
  quantity: 84,
  price: 96,
  fee: 76,
  fx: 68,
  amount: 116,
  realized: 116,
  returnPct: 84,
  actions: 190,
}

interface Props {
  rows: TradeRow[]
  sortBy: SortKey
  sortDir: 'asc' | 'desc'
  onSort: (key: SortKey) => void
  editingId: string | null
  onEdit: (id: string | null) => void
  onSaved: () => void
  onDeleted: () => void
}

const ACCOUNT_LABEL: Record<TradeRow['accountType'], string> = {
  SPECIFIC: '特定',
  NISA_GROWTH: 'N成長',
  NISA_TSUMITATE: 'Nつみたて',
  NISA_OLD: '旧NISA',
}

const yen = (v: string | null) =>
  v == null ? '—' : '¥' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })

const qty = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 })

export function TradesTable({
  rows,
  sortBy,
  sortDir,
  onSort,
  editingId,
  onEdit,
  onSaved,
  onDeleted,
}: Props) {
  const [justDeleted, setJustDeleted] = useState<TradeRow | null>(null)
  const { widths, onResizeStart, onResizeKey, reset } = useColumnWidths(DEFAULT_WIDTHS)

  const del = useMutation({
    mutationFn: (id: string) => removeTrade({ data: { id } }),
    onSuccess: () => {
      onDeleted()
    },
  })

  const undo = useMutation({
    mutationFn: (id: string) => undoRemoveTrade({ data: { id } }),
    onSuccess: () => {
      setJustDeleted(null)
      onDeleted()
    },
  })

  return (
    <>
      {justDeleted ? (
        <div className={styles.undoBar} role="status">
          <span>
            Deleted {justDeleted.symbol} {justDeleted.tradeDate}.
          </span>
          <button
            type="button"
            className={styles.undoButton}
            onClick={() => {
              undo.mutate(justDeleted.id)
            }}
          >
            Undo
          </button>
        </div>
      ) : null}

      <div className={styles.toolbar}>
        <span className={styles.hint}>Drag a column edge to resize · ← → when focused</span>
        <button type="button" className={styles.resetButton} onClick={reset}>
          Reset widths
        </button>
      </div>

      <div className={styles.wrap}>
        {/* `table-layout: fixed` plus a colgroup is what makes the widths
            authoritative and lets overflowing text ellipsize instead of
            stretching the column. */}
        <table className={styles.table}>
          <caption className="visually-hidden">
            Trades, sorted by {sortBy} {sortDir === 'asc' ? 'ascending' : 'descending'}
          </caption>
          <colgroup>
            {COLUMNS.map((c) => (
              <col key={c} style={{ width: `${String(widths[c] ?? DEFAULT_WIDTHS[c] ?? 100)}px` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <Th colKey="tradeDate" col="tradeDate" label="Trade" {...{ sortBy, sortDir, onSort, onResizeStart, onResizeKey }} />
              <Th colKey="settleDate" col="settleDate" label="Settle" {...{ sortBy, sortDir, onSort, onResizeStart, onResizeKey }} />
              <Th colKey="symbol" col="symbol" label="Instrument" {...{ sortBy, sortDir, onSort, onResizeStart, onResizeKey }} />
              <Th colKey="account" label="Account" {...{ onResizeStart, onResizeKey }} />
              <Th colKey="side" label="Side" {...{ onResizeStart, onResizeKey }} />
              <Th colKey="quantity" col="quantity" label="Qty" numeric {...{ sortBy, sortDir, onSort, onResizeStart, onResizeKey }} />
              <Th colKey="price" col="displayPrice" label="Price" numeric {...{ sortBy, sortDir, onSort, onResizeStart, onResizeKey }} />
              <Th colKey="fee" label="Fee" numeric {...{ onResizeStart, onResizeKey }} />
              <Th colKey="fx" label="FX" numeric {...{ onResizeStart, onResizeKey }} />
              <Th colKey="amount" col="netAmountJpy" label="Amount ¥" numeric {...{ sortBy, sortDir, onSort, onResizeStart, onResizeKey }} />
              <Th colKey="realized" col="realizedJpy" label="Realized ¥" numeric {...{ sortBy, sortDir, onSort, onResizeStart, onResizeKey }} />
              <Th
                colKey="returnPct"
                col="returnPct"
                label="Return"
                numeric
                {...{ sortBy, sortDir, onSort, onResizeStart, onResizeKey }}
              />
              <Th colKey="actions" label="Actions" hideLabel {...{ onResizeStart, onResizeKey }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) =>
              editingId === row.id ? (
                <EditRow
                  key={row.id}
                  row={row}
                  onCancel={() => {
                    onEdit(null)
                  }}
                  onSaved={onSaved}
                />
              ) : (
                <ReadRow
                  key={row.id}
                  row={row}
                  onEdit={() => {
                    onEdit(row.id)
                  }}
                  onDelete={() => {
                    setJustDeleted(row)
                    del.mutate(row.id)
                  }}
                  deleting={del.isPending}
                />
              ),
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

/**
 * A header cell. Sorting is optional — some columns are display-only — but every
 * column carries a resize handle.
 */
function Th({
  colKey,
  col,
  label,
  numeric,
  hideLabel,
  sortBy,
  sortDir,
  onSort,
  onResizeStart,
  onResizeKey,
}: {
  colKey: string
  col?: SortKey
  label: string
  numeric?: boolean
  hideLabel?: boolean
  sortBy?: SortKey
  sortDir?: 'asc' | 'desc'
  onSort?: (key: SortKey) => void
  onResizeStart: (key: string, event: React.PointerEvent) => void
  onResizeKey: (key: string, event: React.KeyboardEvent) => void
}) {
  const sortable = col != null && onSort != null
  const active = sortable && sortBy === col

  return (
    <th
      scope="col"
      className={cx(numeric && styles.numeric)}
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <div className={styles.thInner}>
        {sortable ? (
          <button
            type="button"
            className={cx(styles.sortButton, active && styles.sortActive)}
            onClick={() => {
              onSort(col)
            }}
          >
            <span className={styles.thLabel}>{label}</span>
            <span aria-hidden="true" className={styles.sortArrow}>
              {active ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </span>
          </button>
        ) : (
          <span className={cx(styles.thLabel, hideLabel && 'visually-hidden')}>{label}</span>
        )}

        {/* A button rather than a focusable `separator`: both are valid ARIA for
            a splitter, but a button is unambiguously interactive to every AT and
            gets keyboard focus without a manual tabIndex. */}
        <button
          type="button"
          aria-label={`Resize ${label} column. Use arrow keys to adjust.`}
          className={styles.resizeHandle}
          onPointerDown={(e) => {
            onResizeStart(colKey, e)
          }}
          onKeyDown={(e) => {
            onResizeKey(colKey, e)
          }}
        />
      </div>
    </th>
  )
}

function ReadRow({
  row,
  onEdit,
  onDelete,
  deleting,
}: {
  row: TradeRow
  onEdit: () => void
  onDelete: () => void
  deleting: boolean
}) {
  const realized = row.realizedJpy == null ? null : Number(row.realizedJpy)

  return (
    <tr>
      <td className={styles.date}>{row.tradeDate}</td>
      <td className={styles.date}>{row.settleDate}</td>
      <td>
        <span className={styles.symbol}>{row.symbol}</span>
        <span className={styles.name}>{row.name}</span>
      </td>
      <td>
        <span className={cx(styles.badge, styles[`acct_${row.accountType}`])}>
          {ACCOUNT_LABEL[row.accountType]}
        </span>
      </td>
      <td>
        <span className={cx(styles.side, row.side === 'BUY' || row.side === 'REINVEST' ? styles.sideBuy : styles.sideSell)}>
          {row.side}
        </span>
      </td>
      <td className={styles.numeric}>{qty(row.quantity)}</td>
      <td className={styles.numeric}>
        {Number(row.displayPrice).toLocaleString('en-US', { maximumFractionDigits: 4 })}
        {row.currency === 'USD' ? <span className={styles.unit}>$</span> : null}
      </td>
      <td className={styles.numeric}>{Number(row.fee) === 0 ? '—' : yen(row.fee)}</td>
      <td className={styles.numeric}>
        {row.currency === 'USD' ? Number(row.fxRate).toFixed(2) : '—'}
      </td>
      <td className={styles.numeric}>{yen(row.netAmountJpy)}</td>
      <td className={cx(styles.numeric, realized != null && (realized >= 0 ? styles.profit : styles.loss))}>
        {yen(row.realizedJpy)}
      </td>
      <td
        className={cx(
          styles.numeric,
          row.returnPct != null && (row.returnPct >= 0 ? styles.profit : styles.loss),
        )}
        title={row.costJpy ? `on ${yen(row.costJpy)} cost basis` : undefined}
      >
        {row.returnPct == null
          ? '—'
          : `${row.returnPct >= 0 ? '+' : ''}${(row.returnPct * 100).toFixed(1)}%`}
      </td>
      <td>
        <div className={styles.actions}>
        {row.origin === 'MANUAL' ? (
          <span className={styles.tag} title="Hand-entered">
            manual
          </span>
        ) : null}
        {row.isEdited ? (
          <span className={styles.tag} title="Corrected by hand — no longer exactly as Rakuten reported">
            edited
          </span>
        ) : null}
        {!row.isSettled ? (
          <span className={styles.tag} title="Amount derived; Rakuten had not settled this yet">
            unsettled
          </span>
        ) : null}
        <button type="button" className={styles.action} onClick={onEdit}>
          Edit
        </button>
        <ConfirmButton
          onConfirm={onDelete}
          disabled={deleting}
          className={styles.action}
          confirmLabel="Delete?"
          title="Soft delete — recoverable, and a re-import will not resurrect it"
        >
          Delete
        </ConfirmButton>
        </div>
      </td>
    </tr>
  )
}

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

function EditRow({
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
    setDraft((d) => ({ ...d, [key]: e.target.value }))
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
                  <li key={field}>
                    {field === '_' ? message : `${field}: ${message}`}
                  </li>
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

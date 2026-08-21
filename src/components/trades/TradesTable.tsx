/**
 * Trades table with per-row inline editing.
 *
 * An Edit button turns one row's cells into inputs — see `TradeEditRow`. Only
 * one row is editable at a time: concurrent edits to a cost-basis chain would
 * let two saves race and produce a pool that matches neither.
 *
 * The header cells, both row kinds and this container share
 * `TradesTable.module.scss`. That is deliberate — `table-layout: fixed`, the
 * numeric alignment and selectors like `.numeric .thInner` are one system, and
 * splitting them per component would only invite drift.
 */
import { useMutation } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { TradeEditRow } from './TradeEditRow'
import { TradeHeaderCell } from './TradeHeaderCell'
import { TradeReadRow } from './TradeReadRow'
import styles from './TradesTable.module.scss'
import { useColumnWidths, type ColumnWidths } from './useColumnWidths'
import type { TradeSortKey } from '~/lib/tradeSearch'
import { removeTrade, undoRemoveTrade, type TradeRow } from '~/server/trades'

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
  sortBy: TradeSortKey
  sortDir: 'asc' | 'desc'
  onSort: (key: TradeSortKey) => void
  editingId: string | null
  onEdit: (id: string | null) => void
  onSaved: () => void
  onDeleted: () => void
}

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

  // `del.mutate` rather than `del`: react-query hands back a fresh result object
  // every render, and depending on it would make this — and the memoised body
  // below — change identity on every one.
  const deleteMutate = del.mutate
  const onDelete = useCallback(
    (row: TradeRow) => {
      setJustDeleted(row)
      deleteMutate(row.id)
    },
    [deleteMutate],
  )

  /*
   * Dragging a column edge sets state on every pointer move, and the widths only
   * feed the `<colgroup>` below — so the body is memoised out of that path.
   * Without it a full page of rows was rebuilt on every frame of a drag.
   */
  const body = useMemo(
    () =>
      rows.map((row) =>
        editingId === row.id ? (
          <TradeEditRow
            key={row.id}
            row={row}
            onCancel={() => {
              onEdit(null)
            }}
            onSaved={onSaved}
          />
        ) : (
          <TradeReadRow
            key={row.id}
            row={row}
            onEdit={onEdit}
            onDelete={onDelete}
            deleting={del.isPending}
          />
        ),
      ),
    [rows, editingId, onEdit, onSaved, onDelete, del.isPending],
  )

  const headerProps = { onResizeStart, onResizeKey }
  const sortProps = { sortBy, sortDir, onSort, ...headerProps }

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
            {COLUMNS.map((column) => (
              <col
                key={column}
                style={{ width: `${String(widths[column] ?? DEFAULT_WIDTHS[column] ?? 100)}px` }}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              <TradeHeaderCell colKey="tradeDate" col="tradeDate" label="Trade" {...sortProps} />
              <TradeHeaderCell colKey="settleDate" col="settleDate" label="Settle" {...sortProps} />
              <TradeHeaderCell colKey="symbol" col="symbol" label="Instrument" {...sortProps} />
              <TradeHeaderCell colKey="account" label="Account" {...headerProps} />
              <TradeHeaderCell colKey="side" label="Side" {...headerProps} />
              <TradeHeaderCell colKey="quantity" col="quantity" label="Qty" numeric {...sortProps} />
              <TradeHeaderCell colKey="price" col="displayPrice" label="Price" numeric {...sortProps} />
              <TradeHeaderCell colKey="fee" label="Fee" numeric {...headerProps} />
              <TradeHeaderCell colKey="fx" label="FX" numeric {...headerProps} />
              <TradeHeaderCell colKey="amount" col="netAmountJpy" label="Amount ¥" numeric {...sortProps} />
              <TradeHeaderCell colKey="realized" col="realizedJpy" label="Realized ¥" numeric {...sortProps} />
              <TradeHeaderCell colKey="returnPct" col="returnPct" label="Return" numeric {...sortProps} />
              <TradeHeaderCell colKey="actions" label="Actions" hideLabel {...headerProps} />
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>
    </>
  )
}

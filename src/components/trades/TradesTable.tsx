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
import * as Popover from '@radix-ui/react-popover'
import { useMutation } from '@tanstack/react-query'
import { useCallback, useMemo, useRef, useState } from 'react'
import { TradeEditRow } from './TradeEditRow'
import { TradeHeaderCell } from './TradeHeaderCell'
import { TradeReadRow } from './TradeReadRow'
import styles from './TradesTable.module.scss'
import { useColumnWidths, type ColumnWidths } from './useColumnWidths'
import { TableToolbar } from '~/components/screen'
import { ColumnMenu } from '~/components/ui/ColumnMenu'
import { FilterDialog } from '~/components/ui/FilterDialog'
import { useColumnVisibility } from '~/components/ui/useColumnVisibility'
import { useIsMobile } from '~/components/ui/useIsMobile'
import type { TableColumn } from '~/lib/table/columns'
import type { TradeSortKey } from '~/lib/tradeSearch'
import { removeTrade, undoRemoveTrade, type TradeRow } from '~/server/trades'

/**
 * Every column, in render order: its label, whether it sorts, and whether it
 * can be turned off.
 *
 * One list rather than the three that used to run in parallel here — a key
 * order for the colgroup, a width map, and thirteen hand-written header cells.
 * Adding a column meant editing all three and noticing if you missed one.
 *
 * Four are locked. Trade date and instrument place and name the row; side is
 * what makes a quantity at a price mean anything at all, since without it a
 * purchase and a sale look identical; and Actions holds the only Edit and
 * Delete buttons there are.
 */
interface TradeColumn extends TableColumn<string> {
  /** Present when the column sorts; absent for display-only ones. */
  col?: TradeSortKey
  numeric?: boolean
  hideLabel?: boolean
}

const TRADE_COLUMNS: TradeColumn[] = [
  { key: 'tradeDate', label: 'Trade', col: 'tradeDate', locked: true },
  { key: 'settleDate', label: 'Settle', col: 'settleDate' },
  { key: 'symbol', label: 'Instrument', col: 'symbol', locked: true },
  { key: 'account', label: 'Account' },
  { key: 'side', label: 'Side', locked: true },
  { key: 'quantity', label: 'Qty', col: 'quantity', numeric: true },
  { key: 'price', label: 'Price', col: 'displayPrice', numeric: true, locked: true },
  { key: 'fee', label: 'Fee', numeric: true },
  { key: 'fx', label: 'FX', numeric: true },
  { key: 'amount', label: 'Amount ¥', col: 'netAmountJpy', numeric: true },
  { key: 'realized', label: 'Realized ¥', col: 'realizedJpy', numeric: true },
  { key: 'returnPct', label: 'Return', col: 'returnPct', numeric: true },
  { key: 'actions', label: 'Actions', hideLabel: true, locked: true },
]

/**
 * Column widths on SP, where the stored ones are too wide to be useful.
 *
 * `table-layout: fixed` makes the `<colgroup>` authoritative, so the CSS cap on
 * the instrument name does not narrow the column that holds it — the cell just
 * ends up 200px wide with 100px of content and 100px of nothing. These are the
 * cap plus the 12px of horizontal padding on each side, so the column is
 * exactly as wide as what it can show.
 *
 * Keep in step with the `mobile` caps in `TradesTable.module.scss`.
 */
const SP_WIDTHS: Record<string, number> = {
  symbol: 124,
}

/** Starting widths in px. Every column is user-resizable, and the values persist. */
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
  /** Column keys an active filter has pinned to a single value — see the route. */
  redundant: readonly string[]
  /**
   * The filter controls, when the route wants them in this toolbar's dialog
   * rather than inline above the table. Null on desktop, where they have room.
   */
  filters: React.ReactNode
  activeFilters: number
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
  redundant,
  filters,
  activeFilters,
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
  const isMobile = useIsMobile()
  const columns = useColumnVisibility('trades', TRADE_COLUMNS, redundant)

  /*
   * A stored width is a preference set with a mouse, so on SP it is clamped
   * rather than obeyed — dragging is not available there to undo it.
   */
  const columnWidth = useCallback(
    (key: string) => {
      const width = widths[key] ?? DEFAULT_WIDTHS[key] ?? 100
      const cap = isMobile ? SP_WIDTHS[key] : undefined
      return cap == null ? width : Math.min(width, cap)
    },
    [widths, isMobile],
  )
  const shown = useMemo(
    () => TRADE_COLUMNS.filter((column) => columns.visible.has(column.key)),
    [columns.visible],
  )

  /*
   * The instrument name a long press revealed, plus the cell it came from.
   *
   * `virtualRef` lets one popover follow whichever name was pressed, so the
   * table carries a single `Popover.Root` instead of one per row.
   */
  const [fullName, setFullName] = useState<string | null>(null)
  const anchor = useRef<{ getBoundingClientRect: () => DOMRect } | null>(null)

  const onReveal = useCallback((element: HTMLElement, name: string) => {
    anchor.current = { getBoundingClientRect: () => element.getBoundingClientRect() }
    setFullName(name)
  }, [])

  /*
   * Paging or re-sorting unmounts the anchored cell, and a popover left open
   * would measure a detached node and jump to the corner of the screen.
   * Adjusted during render rather than in an effect — the documented way to
   * reset state when a prop changes, and it avoids a second render pass.
   */
  const [renderedRows, setRenderedRows] = useState(rows)
  if (rows !== renderedRows) {
    setRenderedRows(rows)
    setFullName(null)
  }

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
            visible={columns.visible}
            onCancel={() => {
              onEdit(null)
            }}
            onSaved={onSaved}
          />
        ) : (
          <TradeReadRow
            key={row.id}
            row={row}
            visible={columns.visible}
            onReveal={onReveal}
            onEdit={onEdit}
            onDelete={onDelete}
            deleting={del.isPending}
          />
        ),
      ),
    [rows, editingId, onEdit, onSaved, onDelete, del.isPending, columns.visible, onReveal],
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

      <TableToolbar>
        {/* Describes a pointer gesture, so it is hidden where there is no
            pointer — see the stylesheet. */}
        <span className={styles.hint}>Drag a column edge to resize · ← → when focused</span>
        <button type="button" className={styles.resetButton} onClick={reset}>
          Reset widths
        </button>
        {filters ? <FilterDialog activeCount={activeFilters}>{filters}</FilterDialog> : null}
        <ColumnMenu
          columns={TRADE_COLUMNS}
          hidden={columns.hidden}
          redundant={redundant}
          hiddenCount={columns.hiddenCount}
          onToggle={columns.toggle}
          onReset={columns.reset}
          label="Choose trade columns"
        />
      </TableToolbar>

      <Popover.Root
        open={fullName !== null}
        onOpenChange={(open) => {
          if (!open) setFullName(null)
        }}
      >
        <Popover.Anchor virtualRef={anchor} />
        <Popover.Portal>
          <Popover.Content
            className={styles.fullName}
            side="bottom"
            align="start"
            sideOffset={4}
            // Nothing here is interactive, and there is no trigger to hand focus
            // back to on close — moving it would strand the caret mid-table.
            onOpenAutoFocus={(event) => {
              event.preventDefault()
            }}
          >
            {fullName}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <div className={styles.wrap}>
        {/* `table-layout: fixed` plus a colgroup is what makes the widths
            authoritative and lets overflowing text ellipsize instead of
            stretching the column. */}
        <table className={styles.table}>
          <caption className="visually-hidden">
            Trades, sorted by {sortBy} {sortDir === 'asc' ? 'ascending' : 'descending'}
          </caption>
          <colgroup>
            {shown.map((column) => (
              <col
                key={column.key}
                style={{ width: `${String(columnWidth(column.key))}px` }}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              {shown.map((column) => (
                <TradeHeaderCell
                  key={column.key}
                  colKey={column.key}
                  col={column.col}
                  label={column.label}
                  numeric={column.numeric}
                  hideLabel={column.hideLabel}
                  {...sortProps}
                />
              ))}
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>
    </>
  )
}

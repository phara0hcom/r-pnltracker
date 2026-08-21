/**
 * A header cell for the trades table.
 *
 * Sorting is optional — some columns are display-only — but every column carries
 * a resize handle. Styles come from the table's own stylesheet: the header,
 * rows and the fixed layout are one system, and `.numeric .thInner` alone would
 * not survive being split across modules.
 */
import styles from './TradesTable.module.scss'
import { cx } from '~/lib/cx'
import type { TradeSortKey } from '~/lib/tradeSearch'

export function TradeHeaderCell({
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
  col?: TradeSortKey
  label: string
  numeric?: boolean
  hideLabel?: boolean
  sortBy?: TradeSortKey
  sortDir?: 'asc' | 'desc'
  onSort?: (key: TradeSortKey) => void
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
          onPointerDown={(event) => {
            onResizeStart(colKey, event)
          }}
          onKeyDown={(event) => {
            onResizeKey(colKey, event)
          }}
        />
      </div>
    </th>
  )
}

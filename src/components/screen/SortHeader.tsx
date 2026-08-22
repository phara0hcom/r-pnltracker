import styles from './Table.module.scss'
import { cx } from '~/lib/cx'
import type { SortDir } from '~/lib/sortRows'

/**
 * The sort state a table hands to every one of its headers.
 *
 * Generic over the key so a screen's own union of column names is checked at
 * the call site — a header naming a column the schema does not sort by is a
 * compile error, not a dead button.
 */
export interface SortState<K extends string> {
  sortBy: K
  sortDir: SortDir
  onSort: (key: K) => void
}

/**
 * A sortable header cell for `Table`.
 *
 * Styles come from the table's own stylesheet: `[data-numeric]` alignment and
 * the header live in one system, and splitting them across modules would only
 * invite drift.
 */
export function SortHeader<K extends string>({
  col,
  label,
  numeric,
  sortBy,
  sortDir,
  onSort,
}: SortState<K> & {
  col: K
  label: string
  numeric?: boolean
}) {
  const active = sortBy === col

  return (
    <th
      scope="col"
      data-numeric={numeric ? '' : undefined}
      // Only the active column carries `aria-sort`; marking the rest "none"
      // is valid but makes a screen reader announce it on all ten.
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <button
        type="button"
        className={cx(styles.sortButton, active && styles.sortActive)}
        onClick={() => {
          onSort(col)
        }}
      >
        <span>{label}</span>
        {/* Reserves its width whether or not it is showing an arrow, so
            re-sorting does not shift the header labels sideways. */}
        <span aria-hidden="true" className={styles.sortArrow}>
          {active ? (sortDir === 'asc' ? '↑' : '↓') : ''}
        </span>
      </button>
    </th>
  )
}

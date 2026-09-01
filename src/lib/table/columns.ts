/**
 * Which of a table's columns are currently shown.
 *
 * Pure and DB-free like the rest of `lib`: a column list and a set of hidden
 * keys in, the visible keys out. No storage, no React — the hook and the menu
 * that wrap this are the parts that need a browser.
 *
 * Two rules decide what shows, and they pull in opposite directions.
 *
 * `locked` columns carry a row's identity: hide the ticker and every remaining
 * figure belongs to nothing in particular, hide a trade's side and its quantity
 * and price stop meaning anything. Those are refused rather than merely
 * discouraged, because a table that can be configured into nonsense will be.
 *
 * `redundant` columns are the opposite case — a filter has pinned them to a
 * single value, so the column repeats one word down the whole table and the
 * filter above it already says so. Redundancy beats the lock: under
 * `side=SELL` the reason for locking Side (a buy and a sell must be
 * distinguishable) is exactly what the filter has already guaranteed.
 */

export interface TableColumn<K extends string> {
  key: K
  /** As shown in the menu, and normally as the header reads. */
  label: string
  /** Locked columns are always visible; the menu shows them checked and disabled. */
  locked?: boolean
}

/** Hidden column keys, as persisted. Unknown keys are ignored, not an error. */
export type HiddenColumns = readonly string[]

export function isHideable<K extends string>(
  columns: readonly TableColumn<K>[],
  key: string,
): boolean {
  return columns.some((column) => column.key === key && column.locked !== true)
}

/**
 * The columns to render, in declaration order.
 *
 * Order comes from `columns` rather than from anything the user did, so hiding
 * a column and showing it again puts it back where it was instead of appending
 * it to the end.
 */
export function visibleColumns<K extends string>(
  columns: readonly TableColumn<K>[],
  hidden: HiddenColumns,
  redundant: HiddenColumns = [],
): K[] {
  const shown = columns.filter((column) =>
    redundant.includes(column.key)
      ? false
      : column.locked === true || !hidden.includes(column.key),
  )
  // Only reachable for a table that declares no locked column at all. A table
  // rendered down to zero columns is a dead screen, so the last one survives.
  return (shown.length > 0 ? shown : columns.slice(0, 1)).map((column) => column.key)
}

/**
 * Flip one column, returning the next hidden set.
 *
 * Returns the input unchanged for a locked or unknown key — the caller does not
 * have to check first, and a stale stored key cannot resurrect a column that no
 * longer exists.
 */
export function toggleColumn<K extends string>(
  columns: readonly TableColumn<K>[],
  hidden: HiddenColumns,
  key: string,
): HiddenColumns {
  if (!isHideable(columns, key)) return hidden
  return hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key]
}

/**
 * How many columns the user has hidden — the menu's badge.
 *
 * Counts only what the menu actually offers, so the badge and the list agree.
 * A column the filter has pinned is not something the user turned off, and
 * showing it in the count would point at an entry that is not there.
 */
export function hiddenCount<K extends string>(
  columns: readonly TableColumn<K>[],
  hidden: HiddenColumns,
  redundant: HiddenColumns = [],
): number {
  return columns.filter(
    (column) =>
      column.locked !== true && !redundant.includes(column.key) && hidden.includes(column.key),
  ).length
}

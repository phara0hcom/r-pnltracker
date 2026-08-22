/**
 * Client-side table sorting.
 *
 * A column declares how to read its own sort value, so the ordering always
 * follows the cell you can see rather than a second, parallel notion of what
 * the column "really" holds — the two drift the moment a column is rendered
 * from more than one field.
 *
 * Pure and DB-free like the rest of `lib`: no rounding, no currency, no
 * arithmetic that survives past the comparison. It only decides row order.
 */

export type SortDir = 'asc' | 'desc'

export interface SortColumn<T> {
  /**
   * The value this column sorts on. `null` means "unknown" and always sorts
   * last — see the comparator.
   */
  value: (row: T) => string | number | null
  /**
   * Compare as numbers. Money arrives as exact decimal strings, and those must
   * never be compared lexically: "9" would sort above "10".
   */
  numeric?: boolean
}

/**
 * Sort a copy of `rows` by one column.
 *
 * Unknown values sort last in *both* directions. A position with no cached
 * price is not worth less than one at a loss — it is unmeasured, and flipping
 * the arrow should not parade the gaps to the top.
 */
export function sortRows<T, K extends string>(
  rows: readonly T[],
  columns: Record<K, SortColumn<T>>,
  key: K,
  dir: SortDir,
): T[] {
  const column = columns[key]
  const direction = dir === 'asc' ? 1 : -1

  return [...rows].sort((left, right) => {
    const leftValue = column.value(left)
    const rightValue = column.value(right)
    if (leftValue == null) return rightValue == null ? 0 : 1
    if (rightValue == null) return -1
    if (column.numeric) return (Number(leftValue) - Number(rightValue)) * direction
    return String(leftValue).localeCompare(String(rightValue)) * direction
  })
}

/**
 * The next sort state after clicking a header.
 *
 * A new column starts descending — for money columns that is the interesting
 * end, and starting ascending would put the smallest holdings on top of every
 * first click. Clicking the active column flips it.
 */
export function nextSort<K extends string>(
  clicked: K,
  sortBy: K,
  sortDir: SortDir,
): { sortBy: K; sortDir: SortDir } {
  return {
    sortBy: clicked,
    sortDir: sortBy === clicked && sortDir === 'desc' ? 'asc' : 'desc',
  }
}

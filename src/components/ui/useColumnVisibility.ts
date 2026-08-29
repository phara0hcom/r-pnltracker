/**
 * Persisted column visibility, one stored set per table.
 *
 * `localStorage` rather than the URL, matching `useColumnWidths` and for the
 * same reason: which columns you keep is a personal display preference, and a
 * colleague opening your filtered link should not inherit it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  hiddenCount,
  toggleColumn,
  visibleColumns,
  type HiddenColumns,
  type TableColumn,
} from '~/lib/table/columns'

const storageKey = (tableId: string) => `pnl.table.columns.${tableId}`

/** Stable identity so the initial state does not change on every render. */
const NONE: HiddenColumns = []

function load(tableId: string): HiddenColumns {
  if (typeof window === 'undefined') return NONE
  try {
    const raw = window.localStorage.getItem(storageKey(tableId))
    if (!raw) return NONE
    const parsed: unknown = JSON.parse(raw)
    // Anything else is a corrupted or outgrown value; fall back rather than throw.
    return Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string') : NONE
  } catch {
    return NONE
  }
}

/**
 * `columns` must be a stable reference — declare it at module scope. The
 * returned `visible` set is memoised against it, and `TradeReadRow` is
 * `memo`'d on exactly that: a fresh array each render would rebuild every cell
 * on every frame of a column drag.
 */
export function useColumnVisibility<K extends string>(
  tableId: string,
  columns: readonly TableColumn<K>[],
  /**
   * Keys a filter has pinned to a single value, hidden for as long as it is
   * applied. Memoise it at the call site — `visible` is derived from it, and a
   * fresh array each render would defeat the memo this hook exists to keep.
   */
  redundant: HiddenColumns = NONE,
) {
  // The server render must not read localStorage, so the first paint shows
  // every column and the stored set is adopted after mount. Anything else is a
  // hydration mismatch.
  const [hidden, setHidden] = useState<HiddenColumns>(NONE)

  useEffect(() => {
    setHidden(load(tableId))
  }, [tableId])

  const persist = useCallback(
    (next: HiddenColumns) => {
      setHidden(next)
      try {
        window.localStorage.setItem(storageKey(tableId), JSON.stringify(next))
      } catch {
        // Private browsing or a full quota — the choice still holds for this session.
      }
    },
    [tableId],
  )

  const toggle = useCallback(
    (key: string) => {
      persist(toggleColumn(columns, hidden, key))
    },
    [columns, hidden, persist],
  )

  const reset = useCallback(() => {
    persist(NONE)
  }, [persist])

  const visible = useMemo(
    () => new Set<K>(visibleColumns(columns, hidden, redundant)),
    [columns, hidden, redundant],
  )

  return {
    /** Keys currently rendered, in declaration order. */
    visible,
    hidden,
    hiddenCount: hiddenCount(columns, hidden, redundant),
    toggle,
    reset,
  }
}
